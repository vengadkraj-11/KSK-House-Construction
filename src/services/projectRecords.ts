import {
  arrayUnion, collection, doc, documentId, getDocs, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, startAfter, Timestamp, updateDoc, writeBatch
} from 'firebase/firestore';
import {db} from '../firebase';
import {validatePaymentRecord} from './paymentMath';

export type ProjectRecordType = 'payments' | 'contracts' | 'stock' | 'progress' | 'diary' | 'approvals' | 'reminders';
export type ProjectRecord = {id: string; type: ProjectRecordType; createdAt?: any; createdBy?: string; [key: string]: any};

const PROJECT_ID = 'ksk';
const PAGE_SIZE = 250;
const path = (type: ProjectRecordType) => collection(db!, 'projects', PROJECT_ID, type);

/** Allocate once per form submission so a retry after a lost response cannot
 * create a second payment document. */
export function newProjectRecordId(type: ProjectRecordType): string {
  if (!db) throw new Error('Firebase is not configured.');
  return doc(path(type)).id;
}

async function readAll(type: ProjectRecordType): Promise<ProjectRecord[]> {
  if (!db) return [];
  const result: ProjectRecord[] = [];
  let cursor: any;
  while (true) {
    const constraints = [orderBy(documentId()), limit(PAGE_SIZE)];
    const pageQuery = query(path(type), ...(cursor ? [startAfter(cursor)] : []), ...constraints);
    const page = await getDocs(pageQuery);
    // Firestore paths are the canonical identity even if old data contains
    // conflicting `id` / `type` fields.
    result.push(...page.docs.map(item => ({...item.data(), id: item.id, type} as ProjectRecord)));
    if (page.size < PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }
    return result.sort((a, b) => recordTime(b) - recordTime(a) || timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
}

/** Loads in bounded pages; callers get complete data for accurate totals. */
export function subscribeProjectRecords(type: ProjectRecordType, onChange: (items: ProjectRecord[]) => void, onError: (message: string) => void) {
  if (!db) { onError('Firebase is not configured. Project Records cannot be loaded.'); return () => {}; }
  let stopped = false;
  let refreshing = false;
  let refreshAgain = false;
  let lastSignature = '';
  const refresh = async () => {
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    do {
      refreshAgain = false;
      try {
        const items = await readAll(type);
        if (stopped) return;
        const signature = JSON.stringify(items);
        if (signature !== lastSignature) { lastSignature = signature; onChange(items); }
      } catch (error: any) { if (!stopped) onError(error?.message || 'Could not load project records.'); }
    } while (refreshAgain && !stopped);
    refreshing = false;
  };
  void refresh();
  // A bounded listener detects additions and edits on the most recent page. Full
  // reload remains paginated and includes legacy records without createdAt.
  // No orderBy here: legacy documents may not have updatedAt, and Firestore
  // excludes them from ordered queries. A bounded listener still detects edits.
  const stop = onSnapshot(query(path(type), limit(250)), () => { void refresh(); }, error => onError(`Could not watch ${type} records: ${error.message}`));
  return () => { stopped = true; stop(); };
}

function recordTime(record: ProjectRecord): number {
  const value = record.date || record.dueDate || record.createdAt;
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function timestampMillis(value:any):number{return value?.toMillis?.()||value?.toDate?.().getTime?.()||0;}

function validDate(value: any, key: string) {
  if (value === undefined || value === '') return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!match || !date || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
}

export async function addProjectRecord(type: ProjectRecordType, values: Record<string, any>, uid: string, existingId?: string, createId?: string, operationId?: string): Promise<string> {
  if (!db) throw new Error('Firebase is not configured.');
  if (!uid) throw new Error('Sign in is required.');
  const clean = {...values};
  for (const key of ['amount', 'quantity', 'agreedAmount', 'unitRate', 'lowStockLevel']) {
    if (clean[key] !== undefined) {
      const number = Number(clean[key]);
      if (!Number.isFinite(number) || number < 0) throw new Error(`Enter a valid non-negative ${key}.`);
      clean[key] = number;
    }
  }
  for (const key of ['date', 'dueDate', 'plannedDate', 'actualDate', 'startDate']) validDate(clean[key], key);
  if (clean.percent !== undefined && (!Number.isFinite(Number(clean.percent)) || Number(clean.percent) < 0 || Number(clean.percent) > 100)) throw new Error('Progress must be between 0 and 100.');
  if (clean.percent !== undefined) clean.percent=Number(clean.percent);

  if (type === 'approvals') {
    clean.status = 'pending';
    clean.requestNote = clean.decisionNote || '';
    delete clean.decisionNote;
  }
  const payload: Record<string, any> = {...clean, createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 2};
  if (type === 'contracts') {
    payload.agreedAmount = Number(clean.agreedAmount);
    if (!payload.person || !Number.isFinite(payload.agreedAmount)) throw new Error('A person and agreed amount are required for an agreement.');
  }
  if (type === 'payments') {
    validatePaymentRecord(clean);
    payload.amount = Number(clean.amount);
    payload.paymentKind = clean.paymentKind === 'advance' ? 'advance' : 'payment';
    if (clean.paymentTo && !clean.person) payload.person = clean.paymentTo;
    delete payload.agreedAmount;
  }
  if (type === 'stock') {
    if (!['purchase', 'received', 'returned-to-stock', 'returned-to-supplier', 'used', 'wastage'].includes(String(clean.direction).toLowerCase())) throw new Error('Choose a supported material movement.');
    if (!clean.material || !clean.unit) throw new Error('Material and unit are required.');
  }

  const batch = writeBatch(db);
  const recordRef = existingId ? doc(path(type), existingId) : createId ? doc(path(type), createId) : doc(path(type));
  const activityRef = operationId ? doc(db, 'projects', PROJECT_ID, 'activity', operationId) : doc(collection(db, 'projects', PROJECT_ID, 'activity'));
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  if (type === 'payments' && !existingId) {
    // Reuse the stable client allocated ID on retries, and treat an already
    // committed record as success. This prevents a second payment on a retry.
    await runTransaction(db, async transaction => {
      const existing = await transaction.get(recordRef);
      if (existing.exists()) return;
      transaction.set(recordRef, payload);
      transaction.set(activityRef, {title: 'Added Payment record', body: 'Payment record added in Project Records', actorUid: uid, actorName: 'Project owner', sheetId: 'module_payments', sheetName: 'Payments', changeType: 'edited', itemName: clean.paymentId || recordRef.id, details: 'Payment record created', createdAt: serverTimestamp()});
    });
    return recordRef.id;
  }
  if (existingId) {
    const {createdAt, createdBy, ...changes} = payload;
    batch.update(recordRef, {...changes, updatedBy:uid});
  } else batch.set(recordRef, payload);
  batch.set(activityRef, {title: `${existingId?'Updated':'Added'} ${label} record`, body: `${label} record ${existingId?'updated':'added'} in Project Records`, actorUid: uid, actorName: 'Project owner', sheetId: `module_${type}`, sheetName: label, changeType: 'edited', itemName: clean.paymentId || label, details: `${label} record ${existingId?'updated':'created'}`, createdAt: serverTimestamp()});
  await batch.commit();
  return recordRef.id;
}

export async function decideApproval(id: string, status: 'approved' | 'rejected', note: string, uid: string) {
  if (!db || !uid) throw new Error('Sign in as the project owner to decide approvals.');
  const ref = doc(db, 'projects', PROJECT_ID, 'approvals', id);
  const historyEntry = {status, note: note.trim(), actorUid: uid, decidedAt: Timestamp.now()};
  await runTransaction(db, async transaction => {
    const current = await transaction.get(ref);
    if (!current.exists()) throw new Error('Approval request no longer exists.');
    if (String(current.data().status||'').trim().toLowerCase() !== 'pending') throw new Error('This approval has already been decided.');
    transaction.update(ref, {status, decisionNote: note.trim(), decidedBy: uid, decidedAt: serverTimestamp(), updatedAt: serverTimestamp(), history: arrayUnion(historyEntry)});
  });
}

export async function setReminderDate(id:string, dueDate:string, uid:string) {
  if (!db || !uid) throw new Error('Sign in as the owner to edit reminders.');
  validDate(dueDate,'dueDate');
  await updateDoc(doc(db,'projects',PROJECT_ID,'reminders',id),{dueDate,updatedBy:uid,updatedAt:serverTimestamp(),status:'scheduled'});
}

export async function cancelReminderRecord(id:string, uid:string) {
  if (!db || !uid) throw new Error('Sign in as the owner to cancel reminders.');
  await updateDoc(doc(db,'projects',PROJECT_ID,'reminders',id),{status:'cancelled',cancelledBy:uid,cancelledAt:serverTimestamp(),updatedAt:serverTimestamp()});
}

export function dateLabel(value: any): string {
  if (!value) return '—';
  const date = value instanceof Timestamp ? value.toDate() : value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}
