import {
  arrayUnion, collection, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, startAfter, Timestamp, updateDoc, where, writeBatch
} from 'firebase/firestore';
import {auth, db, firebaseConfig} from '../firebase';
import {isDuplicatePaymentRetry, validatePaymentRecord} from './paymentMath';

export type ProjectRecordType = 'payments' | 'contracts' | 'stock' | 'progress' | 'diary' | 'approvals' | 'reminders';
export type ProjectRecord = {id: string; type: ProjectRecordType; createdAt?: any; createdBy?: string; [key: string]: any};
export type PermissionCheck = {operation: string; path: string; status: 'passed'|'failed'|'skipped'; errorCode?: string};
export type PermissionDiagnostics = {firebaseProjectId: string; expectedFirebaseProjectId: string; role: string|null; membership: string; checks: PermissionCheck[]};
type MembershipDiagnosticStatus = 'loading'|'verified'|'missing'|'wrong-project'|'invalid-role'|'unavailable'|'signed-out';
let membershipDiagnosticStatus: MembershipDiagnosticStatus = 'loading';
let membershipDiagnosticRole: string|null = null;
export function setProjectMembershipDiagnostic(status: MembershipDiagnosticStatus, role: string|null) {
  membershipDiagnosticStatus = status;
  membershipDiagnosticRole = role;
}

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
export function subscribeProjectRecords(type: ProjectRecordType, onChange: (items: ProjectRecord[]) => void, onError: (message: string) => void, expectedUid: string) {
  if (!db) { onError('Firebase is not configured. Project Records cannot be loaded.'); return () => {}; }
  if (firebaseConfig.projectId !== 'ksk-house-construction' || db.app.options.projectId !== firebaseConfig.projectId) {
    onError(`Wrong Firebase project ID: expected ksk-house-construction, got ${db.app.options.projectId || firebaseConfig.projectId || '(unset)'}.`);
    return () => {};
  }
  if (!auth?.currentUser?.uid) { onError('Authentication is not ready. Sign in again before loading payment records.'); return () => {}; }
  if (!expectedUid || auth.currentUser.uid !== expectedUid) { onError('Authentication changed before the project listener started. Sign in again to refresh membership.'); return () => {}; }
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
      } catch (error: any) { if (!stopped) onError(describeFirestoreError(error, 'read', type)); }
    } while (refreshAgain && !stopped);
    refreshing = false;
  };
  void refresh();
  // A bounded listener detects additions and edits on the most recent page. Full
  // reload remains paginated and includes legacy records without createdAt.
  // No orderBy here: legacy documents may not have updatedAt, and Firestore
  // excludes them from ordered queries. A bounded listener still detects edits.
  const stop = onSnapshot(query(path(type), limit(250)), () => { void refresh(); }, error => onError(describeFirestoreError(error, 'listener', type)));
  return () => { stopped = true; stop(); };
}

function describeFirestoreError(error: any, operation: 'read'|'listener'|'write', type: ProjectRecordType): string {
  const code = String(error?.code || 'unknown');
  const collectionPath = `projects/${PROJECT_ID}/${type}`;
  const activityPath = operation === 'write' ? `projects/${PROJECT_ID}/activity` : undefined;
  if (__DEV__) console.warn('[project-records]', {operation: type === 'payments' && operation === 'write' ? 'payment+activity transaction' : type === 'payments' && operation === 'read' ? 'payment read' : type === 'payments' && operation === 'listener' ? 'payment listener' : operation, collectionPath, activityPath, code, firebaseProjectId: db?.app.options.projectId || firebaseConfig.projectId || '(unset)', membership: membershipDiagnosticStatus, role: membershipDiagnosticRole});
  if (code === 'permission-denied') return operation === 'read' || operation === 'listener'
    ? `${type === 'payments' ? 'Payment' : type} ${operation === 'listener' ? 'listener' : 'read'} permission denied for ${collectionPath}. Verify users/{uid} membership and deployed Firestore rules.`
    : type === 'payments'
      ? `Payment or activity write permission denied for ${collectionPath} and ${activityPath}. Both writes are atomic; verify owner membership and both deployed Firestore rules.`
      : `${type} write permission denied for ${collectionPath}. Verify owner membership and deployed Firestore rules.`;
  if (code === 'unauthenticated') return `Authentication is not ready or expired while trying to ${operation} ${collectionPath}. Sign in again.`;
  if (code === 'not-found') return `A required Firestore document was not found while trying to ${operation} ${collectionPath}. Check the contract reference and project path.`;
  if (code === 'invalid-argument') return `Invalid ${type} data or query while trying to ${operation} ${collectionPath}.`;
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'network-request-failed') return `Network failure while trying to ${operation} ${collectionPath}. Check the connection and retry.`;
  return `Could not ${operation === 'write' ? 'save' : 'load'} ${collectionPath} (${code}).`;
}

/** Read-only access checks. No project records or attachments are written. */
export async function runProjectPermissionDiagnostics(): Promise<PermissionDiagnostics> {
  const firestore = db;
  const checks: PermissionCheck[] = [];
  const report: PermissionDiagnostics = {
    firebaseProjectId: db?.app.options.projectId || firebaseConfig.projectId || '(unset)',
    expectedFirebaseProjectId: 'ksk-house-construction', role: null, membership: 'not-checked', checks
  };
  checks.push({operation: 'Firebase project configuration', path: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', status: report.firebaseProjectId === report.expectedFirebaseProjectId ? 'passed' : 'failed', ...(report.firebaseProjectId === report.expectedFirebaseProjectId ? {} : {errorCode: 'project-id-mismatch'})});
  const user = auth?.currentUser;
  if (!firestore || !user) {
    report.membership = user ? 'firestore-unavailable' : 'authentication-not-ready';
    setProjectMembershipDiagnostic(user ? 'unavailable' : 'signed-out', null);
    return report;
  }

  try {
    const memberSnapshot = await getDoc(doc(firestore, 'users', user.uid));
    const member = memberSnapshot.data();
    report.role = member?.role === 'owner' || member?.role === 'viewer' ? member.role : null;
    report.membership = !memberSnapshot.exists() ? 'missing'
      : member?.projectId !== PROJECT_ID ? 'wrong-project'
        : report.role ? 'verified' : 'invalid-role';
    setProjectMembershipDiagnostic(report.membership as MembershipDiagnosticStatus, report.role);
    checks.push({operation: 'membership read', path: 'users/{authenticatedUid}', status: report.membership === 'verified' ? 'passed' : 'failed', ...(report.membership === 'verified' ? {} : {errorCode: report.membership})});
    if (__DEV__) console.info('[permission-diagnostics]', {operation: 'membership read', path: 'users/{authenticatedUid}', code: report.membership === 'verified' ? 'ok' : report.membership, firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
  } catch (error: any) {
    report.membership = 'read-failed';
    setProjectMembershipDiagnostic('unavailable', null);
    const code = String(error?.code || 'unknown');
    checks.push({operation: 'membership read', path: 'users/{authenticatedUid}', status: 'failed', errorCode: code});
    if (__DEV__) console.warn('[permission-diagnostics]', {operation: 'membership read', path: 'users/{authenticatedUid}', code, firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
  }

  const readCollection = async (operation: string, type: ProjectRecordType) => {
    const collectionPath = `projects/${PROJECT_ID}/${type}`;
    try {
      const snapshot = await getDocs(query(collection(firestore, 'projects', PROJECT_ID, type), limit(1)));
      checks.push({operation, path: collectionPath, status: 'passed'});
      if (__DEV__) console.info('[permission-diagnostics]', {operation, path: collectionPath, code: 'ok', firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
      return snapshot.docs[0]?.id;
    } catch (error: any) {
      const code = String(error?.code || 'unknown');
      checks.push({operation, path: collectionPath, status: 'failed', errorCode: code});
      if (__DEV__) console.warn('[permission-diagnostics]', {operation, path: collectionPath, code, firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
      return undefined;
    }
  };
  const paymentId = await readCollection('payment collection read', 'payments');
  await Promise.all([
    readCollection('stock collection read', 'stock'),
    readCollection('contracts collection read', 'contracts')
  ]);

  const paymentPath = `projects/${PROJECT_ID}/payments`;
  await new Promise<void>(resolve => {
    let settled = false;
    let stop = () => {};
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (check: PermissionCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      checks.push(check);
      if (__DEV__) (check.status === 'passed' ? console.info : console.warn)('[permission-diagnostics]', {operation: 'payment realtime listener', path: paymentPath, code: check.errorCode || 'ok', firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
      resolve();
    };
    timeout = setTimeout(() => finish({operation: 'payment realtime listener', path: paymentPath, status: 'failed', errorCode: 'unavailable'}), 12000);
    stop = onSnapshot(query(collection(firestore, 'projects', PROJECT_ID, 'payments'), limit(1)),
      () => finish({operation: 'payment realtime listener', path: paymentPath, status: 'passed'}),
      error => finish({operation: 'payment realtime listener', path: paymentPath, status: 'failed', errorCode: String(error?.code || 'unknown')}));
  });

  if (paymentId) {
    const receiptPath = `projects/${PROJECT_ID}/bills/${paymentId}/images`;
    try {
      await getDocs(query(collection(firestore, 'projects', PROJECT_ID, 'bills', paymentId, 'images'), limit(1)));
      checks.push({operation: 'receipt image read', path: receiptPath, status: 'passed'});
      if (__DEV__) console.info('[permission-diagnostics]', {operation: 'receipt image read', path: receiptPath, code: 'ok', firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
    } catch (error: any) {
      const code = String(error?.code || 'unknown');
      checks.push({operation: 'receipt image read', path: receiptPath, status: 'failed', errorCode: code});
      if (__DEV__) console.warn('[permission-diagnostics]', {operation: 'receipt image read', path: receiptPath, code, firebaseProjectId: report.firebaseProjectId, membership: report.membership, role: report.role});
    }
  } else checks.push({operation: 'receipt image read', path: `projects/${PROJECT_ID}/bills/{paymentId}/images`, status: 'skipped'});
  return report;
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
  if (!uid || !auth?.currentUser) throw new Error('Authentication is not ready. Sign in again before saving.');
  if (auth.currentUser.uid !== uid) throw new Error('Authentication changed. Reopen Project Records and retry.');
  if (firebaseConfig.projectId !== 'ksk-house-construction' || db.app.options.projectId !== firebaseConfig.projectId) throw new Error(`Wrong Firebase project ID. Expected ksk-house-construction; got ${db.app.options.projectId || firebaseConfig.projectId || '(unset)'}.`);
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
    try { validatePaymentRecord(clean); }
    catch (error: any) { throw new Error(`Invalid payment data: ${error?.message || 'Check amount, date, and payee.'}`); }
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
    try {
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(recordRef);
        if (isDuplicatePaymentRetry(existing.exists())) return;
        transaction.set(recordRef, payload);
        transaction.set(activityRef, {title: 'Added Payment record', body: 'Payment record added in Project Records', actorUid: uid, actorName: 'Project owner', sheetId: 'module_payments', sheetName: 'Payments', changeType: 'edited', itemName: clean.paymentId || recordRef.id, details: 'Payment record created', createdAt: serverTimestamp()});
      });
    } catch (error: any) {
      const message = describeFirestoreError(error, 'write', type);
      throw new Error(type === 'payments' && clean.contractId && error?.code === 'permission-denied'
        ? `${message} The selected contract must exist in this project and its person must match the payment person.`
        : message);
    }
    return recordRef.id;
  }
  if (existingId) {
    const {createdAt, createdBy, ...changes} = payload;
    batch.update(recordRef, {...changes, updatedBy:uid});
  } else batch.set(recordRef, payload);
  batch.set(activityRef, {title: `${existingId?'Updated':'Added'} ${label} record`, body: `${label} record ${existingId?'updated':'added'} in Project Records`, actorUid: uid, actorName: 'Project owner', sheetId: `module_${type}`, sheetName: label, changeType: 'edited', itemName: clean.paymentId || label, details: `${label} record ${existingId?'updated':'created'}`, createdAt: serverTimestamp()});
  try { await batch.commit(); }
  catch (error: any) { throw new Error(describeFirestoreError(error, 'write', type)); }
  return recordRef.id;
}

/** Delete one payment and its own activity/receipt records atomically. */
export async function deletePaymentRecord(payment: ProjectRecord, uid: string): Promise<void> {
  if (!db || !uid || !auth?.currentUser) throw new Error('Sign in as the project owner to delete payments.');
  if (auth.currentUser.uid !== uid) throw new Error('Authentication changed. Sign in again and retry.');
  if (firebaseConfig.projectId !== 'ksk-house-construction' || db.app.options.projectId !== firebaseConfig.projectId) throw new Error('Wrong Firebase project. Payment deletion was stopped.');
  if (!payment?.id || payment.type !== 'payments') throw new Error('This payment record is invalid or no longer available.');

  const paymentRef = doc(db, 'projects', PROJECT_ID, 'payments', payment.id);
  const activityQuery = query(collection(db, 'projects', PROJECT_ID, 'activity'), where('sheetId', '==', 'module_payments'));
  const receiptQuery = query(collection(db, 'projects', PROJECT_ID, 'bills', payment.id, 'images'));
  const [current, activitySnapshot, receiptSnapshot] = await Promise.all([
    getDoc(paymentRef), getDocs(activityQuery), getDocs(receiptQuery)
  ]);
  if (!current.exists()) throw new Error('This payment was already deleted or no longer exists.');
  const paymentId = String(current.data().paymentId || payment.id);
  const relatedActivity = activitySnapshot.docs.filter(item => {
    const data = item.data();
    return data.sheetId === 'module_payments' && (data.itemName === paymentId || data.itemName === payment.id);
  });
  if (relatedActivity.length + receiptSnapshot.size + 1 > 500) throw new Error('This payment has too many linked records to remove safely in one operation. Contact support.');
  const batch = writeBatch(db);
  batch.delete(paymentRef);
  relatedActivity.forEach(item => batch.delete(item.ref));
  receiptSnapshot.docs.forEach(item => batch.delete(item.ref));
  await batch.commit();
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
