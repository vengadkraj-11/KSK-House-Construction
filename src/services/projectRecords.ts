import {
  collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp,
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
    query(path(type), orderBy('createdAt', 'desc'), limit(150)),
    snapshot => onChange(snapshot.docs.map(item => ({id: item.id, type, ...item.data()} as ProjectRecord))),
    error => onError(error.message)
  );
}

export async function addProjectRecord(
  type: ProjectRecordType,
  values: Record<string, any>,
  uid: string
): Promise<string> {
  if (!db) throw new Error('Firebase is not configured.');
  if (!uid) throw new Error('Sign in is required.');
  const amount = values.amount === undefined ? undefined : Number(values.amount);
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    throw new Error('Enter a valid non-negative amount.');
  }
  const quantity = values.quantity === undefined ? undefined : Number(values.quantity);
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity < 0)) {
    throw new Error('Enter a valid non-negative quantity.');
  }
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
