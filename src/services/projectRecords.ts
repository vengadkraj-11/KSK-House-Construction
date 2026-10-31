import {
  collection, doc, onSnapshot, query, serverTimestamp,
  Timestamp, writeBatch
} from 'firebase/firestore';
import {db} from '../firebase';

export type ProjectRecordType = 'payments' | 'stock' | 'progress' | 'diary' | 'approvals' | 'reminders';
export type ProjectRecord = {
  id: string;
  type: ProjectRecordType;
  createdAt?: any;
  createdBy?: string;
  [key: string]: any;
};

const PROJECT_ID = 'ksk';
const path = (type: ProjectRecordType) => collection(db!, 'projects', PROJECT_ID, type);

export function subscribeProjectRecords(
  type: ProjectRecordType,
  onChange: (items: ProjectRecord[]) => void,
  onError: (message: string) => void
) {
  if (!db) return () => {};
  return onSnapshot(
    // Subscribe to the full collection: financial summaries must never silently
    // omit older records because of a UI page-size limit. Sort locally so legacy
    // documents without createdAt remain visible too.
    query(path(type)),
    snapshot => onChange(snapshot.docs
      .map(item => ({id: item.id, type, ...item.data()} as ProjectRecord))
      .sort((a, b) => recordTime(b) - recordTime(a))),
    error => onError(error.message)
  );
}

function recordTime(record: ProjectRecord): number {
  const value = record.date || record.dueDate || record.createdAt;
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function addProjectRecord(
  type: ProjectRecordType,
  values: Record<string, any>,
  uid: string
): Promise<string> {
  if (!db) throw new Error('Firebase is not configured.');
  if (!uid) throw new Error('Sign in is required.');
  const numericFields = ['amount', 'quantity', 'agreedAmount', 'advance', 'unitRate', 'lowStockLevel'];
  for (const key of numericFields) {
    if (values[key] !== undefined) {
      const value = Number(values[key]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Enter a valid non-negative ${key}.`);
      values[key] = value;
    }
  }
  const amount = values.amount === undefined ? undefined : Number(values.amount);
  const quantity = values.quantity === undefined ? undefined : Number(values.quantity);
  const payload: Record<string, any> = {
    ...values,
    createdBy: uid,
    createdAt: serverTimestamp(),
    schemaVersion: 1
  };
  if (amount !== undefined) payload.amount = amount;
  if (quantity !== undefined) payload.quantity = quantity;
  if (values.percent !== undefined) {
    const percent = Number(values.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error('Progress must be between 0 and 100.');
    }
    payload.percent = percent;
  }
  for (const key of ['date', 'dueDate', 'plannedDate', 'actualDate']) {
    if (values[key] !== undefined && values[key] !== '') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(values[key]));
      const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
      if (!match || !date || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
        throw new Error(`${key} must be a valid date in YYYY-MM-DD format.`);
      }
    }
  }
  const batch = writeBatch(db);
  const recordRef = doc(path(type));
  const activityRef = doc(collection(db, 'projects', PROJECT_ID, 'activity'));
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  batch.set(recordRef, payload);
  batch.set(activityRef, {
    title: `Added ${label} record`,
    body: `${label} record added to Project Records`,
    actorUid: uid,
    actorName: 'Project owner',
    sheetId: `module_${type}`,
    sheetName: label,
    changeType: 'edited',
    itemName: label,
    details: `${label} record created`,
    createdAt: serverTimestamp()
  });
  await batch.commit();
  return recordRef.id;
}

export function dateLabel(value: any): string {
  if (!value) return '—';
  const date = value instanceof Timestamp ? value.toDate() : value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}
