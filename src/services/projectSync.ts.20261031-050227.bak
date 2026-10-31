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

// Store rows inside maps because Firestore does not support nested arrays.
function encodeRows(rows: any[][]) {
  return Object.fromEntries(
    (rows || []).map((row, index) => [String(index), row])
  );
}

// Restore Firestore maps to normal Excel-style row arrays.
function decodeRows(data: any): any[][] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  return Object.keys(data)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => data[key] || []);
}

function encodeSheet(sheet: SheetDocument) {
  return {
    ...sheet,
    values: encodeRows(sheet.values || []),
    formulas: encodeRows(sheet.formulas || [])
  };
}

function decodeSheet(data: any): SheetDocument {
  return {
    ...data,
    values: decodeRows(data.values),
    formulas: decodeRows(data.formulas)
  } as SheetDocument;
}

export function subscribeSheets(
  onChange: (sheets: SheetMap, count: number) => void,
  onError: (message: string) => void
) {
  if (!db) return () => {};

  return onSnapshot(
    sheetsPath(),
    snapshot => {
      const next: SheetMap = {};

      snapshot.docs.forEach(d => {
        next[d.id] = decodeSheet(d.data());
      });

      onChange(next, snapshot.size);
    },
    error => onError(error.message)
  );
}

export async function seedWorkbook(uid: string) {
  if (!db) throw new Error('Firebase is not configured.');

  const existing = await getDocs(sheetsPath());

  if (!existing.empty) {
    throw new Error(
      'Cloud workbook already contains data. Import was stopped to protect it.'
    );
  }

  const batch = writeBatch(db);

  Object.entries(LOCAL_WORKBOOK).forEach(([id, sheet]) => {
    batch.set(sheetPath(id), {
      ...encodeSheet(sheet),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      importedFrom: 'KSK_House_Cost.xlsx',
      schemaVersion: 1
    });
  });

  await batch.commit();
}

export async function saveSheet(
  id: string,
  sheet: SheetDocument,
  uid: string
) {
  if (!db) throw new Error('Firebase is not configured.');

  await setDoc(sheetPath(id), {
    ...encodeSheet(sheet),
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
    const quoteSheet = {
      ...QUOTE_TEMPLATE,
      values: [QUOTE_TEMPLATE.values[0]],
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      extraModule: true
    };

    await setDoc(ref, {
      ...encodeSheet(quoteSheet),
    });
  }
}

export function subscribeActivities(
  onChange: (items: any[]) => void,
  onError: (message: string) => void
) {
  if (!db) return () => {};

  const q = query(
    collection(db, 'projects', PROJECT_ID, 'activity'),
    orderBy('createdAt', 'desc'),
    limit(35)
  );

  return onSnapshot(
    q,
    snapshot => {
      onChange(snapshot.docs.map(d => ({id: d.id, ...d.data()})));
    },
    error => onError(error.message)
  );
}

export async function registerDevice(
  uid: string,
  token: string,
  platform: string
) {
  if (!db || !token) return;

  const safeId = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);

  await setDoc(
    doc(db, 'users', uid, 'devices', safeId),
    {
      token,
      platform,
      updatedAt: serverTimestamp(),
      enabled: true
    },
    {merge: true}
  );
}
