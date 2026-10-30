import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, writeBatch
} from 'firebase/firestore';
import {db} from '../firebase';
import {LOCAL_WORKBOOK, QUOTE_TEMPLATE} from '../data';
import {SheetDocument, SheetMap} from '../types';

const PROJECT_ID = 'ksk';
const sheetsPath = () => collection(db!, 'projects', PROJECT_ID, 'sheets');
const sheetPath = (id: string) => doc(db!, 'projects', PROJECT_ID, 'sheets', id);

export function subscribeSheets(
  onChange: (sheets: SheetMap, count: number) => void,
  onError: (message: string) => void
) {
  if (!db) return () => {};
  return onSnapshot(sheetsPath(), snapshot => {
    const next: SheetMap = {};
    snapshot.docs.forEach(d => {
      const value = d.data() as SheetDocument;
      next[d.id] = value;
    });
    onChange(next, snapshot.size);
  }, error => onError(error.message));
}

export async function seedWorkbook(uid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  const existing = await getDocs(sheetsPath());
  if (!existing.empty) throw new Error('Cloud workbook already contains data. Import was stopped to protect it.');
  const batch = writeBatch(db);
  Object.entries(LOCAL_WORKBOOK).forEach(([id, sheet]) => {
    batch.set(sheetPath(id), {
      ...sheet,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      importedFrom: 'KSK_House_Cost.xlsx',
      schemaVersion: 1
    });
  });
  await batch.commit();
}

export async function saveSheet(id: string, sheet: SheetDocument, uid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  await setDoc(sheetPath(id), {
    ...sheet,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    schemaVersion: 1
  });
}

export async function ensureQuoteSheet(uid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  const ref = doc(db, 'projects', PROJECT_ID, 'sheets', 'quotation_compare');
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {...QUOTE_TEMPLATE, values: [QUOTE_TEMPLATE.values[0]], updatedAt: serverTimestamp(), updatedBy: uid, extraModule: true});
  }
}

export function subscribeActivities(onChange: (items: any[]) => void, onError: (message: string) => void) {
  if (!db) return () => {};
  const q = query(collection(db, 'projects', PROJECT_ID, 'activity'), orderBy('createdAt', 'desc'), limit(35));
  return onSnapshot(q, snapshot => {
    onChange(snapshot.docs.map(d => ({id: d.id, ...d.data()})));
  }, error => onError(error.message));
}

export async function registerDevice(uid: string, token: string, platform: string) {
  if (!db || !token) return;
  const safeId = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  await setDoc(doc(db, 'users', uid, 'devices', safeId), {
    token, platform, updatedAt: serverTimestamp(), enabled: true
  }, {merge: true});
}
