import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where, setDoc, writeBatch
} from 'firebase/firestore';
import {db} from '../firebase';

export type ViewerAccessStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type ViewerLanguage = 'en' | 'ta';
export type ViewerAccessRequest = {
  uid: string;
  fullName: string;
  normalizedMobileNumber: string;
  status: ViewerAccessStatus;
  preferredLanguage: ViewerLanguage;
  registeredAt?: any;
  approvalDate?: any;
  approverUid?: string;
  decisionAt?: any;
  decidedBy?: string;
  decisionNote?: string;
  revokedAt?: any;
  revokedBy?: string;
  legacy?: boolean;
};

const accessPath = (uid: string) => doc(db!, 'viewerAccess', uid);
const phonePath = (phone: string) => doc(db!, 'viewerPhoneIndex', phone);

export function normalizePhoneNumber(value: string): string {
  const normalized = value.trim().replace(/[\s().-]/g, '');
  return /^\d{10}$/.test(normalized) ? `+91${normalized}` : normalized;
}

export function canContinueWithApprovedSession(
  authenticatedUid: string | null | undefined,
  request: ViewerAccessRequest | null | undefined,
  mobileNumber: string
): boolean {
  return Boolean(
    authenticatedUid &&
    request?.uid === authenticatedUid &&
    request.status === 'approved' &&
    normalizePhoneNumber(mobileNumber) === request.normalizedMobileNumber
  );
}

export async function registerViewerRequest(
  uid: string,
  phone: string,
  fullName: string,
  preferredLanguage: ViewerLanguage
) {
  if (!db) throw new Error('Firebase is not configured.');
  const normalizedMobileNumber = normalizePhoneNumber(phone);
  if (!/^\+[1-9]\d{7,14}$/.test(normalizedMobileNumber)) {
    throw new Error('Enter a mobile number in international format, including the + country code.');
  }
  const name = fullName.trim();
  if (name.length < 2 || name.length > 120) throw new Error('Enter your full name (2–120 characters).');
  if (preferredLanguage !== 'en' && preferredLanguage !== 'ta') throw new Error('Choose English or Tamil.');

  await setDoc(accessPath(uid), {
    uid,
    fullName: name,
    normalizedMobileNumber,
    status: 'pending',
    preferredLanguage,
    registeredAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
}

export async function saveViewerLanguage(uid: string, preferredLanguage: ViewerLanguage) {
  if (!db) throw new Error('Firebase is not configured.');
  if (preferredLanguage !== 'en' && preferredLanguage !== 'ta') throw new Error('Choose English or Tamil.');
  await updateDoc(accessPath(uid), {preferredLanguage, updatedAt: serverTimestamp()});
}

export async function saveLegacyViewerLanguage(uid: string, preferredLanguage: ViewerLanguage) {
  if (!db) throw new Error('Firebase is not configured.');
  if (preferredLanguage !== 'en' && preferredLanguage !== 'ta') throw new Error('Choose English or Tamil.');
  await updateDoc(doc(db, 'users', uid), {preferredLanguage, updatedAt: serverTimestamp()});
}

export function subscribeViewerRequest(
  uid: string,
  onChange: (request: ViewerAccessRequest | null) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase is not configured.'));
    return () => {};
  }
  return onSnapshot(accessPath(uid), snapshot => {
    onChange(snapshot.exists() ? snapshot.data() as ViewerAccessRequest : null);
  }, onError);
}

export async function getViewerRequest(uid: string): Promise<ViewerAccessRequest | null> {
  if (!db) throw new Error('Firebase is not configured.');
  const snapshot = await getDoc(accessPath(uid));
  return snapshot.exists() ? snapshot.data() as ViewerAccessRequest : null;
}

export function subscribeViewerRequests(
  onChange: (requests: ViewerAccessRequest[]) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase is not configured.'));
    return () => {};
  }
  return onSnapshot(collection(db, 'viewerAccess'), snapshot => {
      const requests = snapshot.docs.map(item => item.data() as ViewerAccessRequest);
      requests.sort((a, b) => (b.registeredAt?.toMillis?.() || 0) - (a.registeredAt?.toMillis?.() || 0));
    onChange(requests);
  }, onError);
}

export function subscribeLegacyViewers(
  onChange: (requests: ViewerAccessRequest[]) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase is not configured.'));
    return () => {};
  }
  const memberQuery = query(collection(db, 'users'), where('projectId', '==', 'ksk'), where('role', '==', 'viewer'));
  return onSnapshot(memberQuery, snapshot => {
    onChange(snapshot.docs.map(item => ({
      uid: item.id,
      fullName: String(item.data().fullName || item.data().displayName || 'Existing viewer'),
      normalizedMobileNumber: '',
      status: 'approved',
      preferredLanguage: 'en',
      legacy: true
    })));
  }, onError);
}

export async function decideViewerAccess(
  request: ViewerAccessRequest,
  action: 'approved' | 'rejected' | 'revoked',
  approverUid: string
) {
  if (!db) throw new Error('Firebase is not configured.');
  if (action === 'revoked' && request.status !== 'approved') throw new Error('Only approved viewers can be revoked.');
  if (action !== 'revoked' && request.status !== 'pending' && !(action === 'approved' && request.status === 'revoked')) {
    throw new Error('This viewer request can no longer be decided.');
  }

  const changes: Record<string, unknown> = {
    status: action,
    decidedBy: approverUid,
    decisionAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    decisionNote: ''
  };
  if (action === 'approved') {
    changes.approverUid = approverUid;
    changes.approvalDate = serverTimestamp();
    changes.revokedBy = null;
    changes.revokedAt = null;
  } else if (action === 'revoked') {
    changes.revokedBy = approverUid;
    changes.revokedAt = serverTimestamp();
  }

  const phoneIndex = await getDoc(phonePath(request.normalizedMobileNumber));
  const batch = writeBatch(db);
  batch.update(accessPath(request.uid), changes);
  if (phoneIndex.exists()) {
    batch.update(phonePath(request.normalizedMobileNumber), {
      status: action,
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

export async function revokeLegacyViewer(request: ViewerAccessRequest, ownerUid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  if (!request.legacy) throw new Error('This is not a legacy viewer account.');
  await setDoc(accessPath(request.uid), {
    uid: request.uid,
    fullName: request.fullName,
    normalizedMobileNumber: '',
    status: 'revoked',
    preferredLanguage: request.preferredLanguage,
    createdAt: serverTimestamp(),
    legacy: true,
    revokedAt: serverTimestamp(),
    revokedBy: ownerUid,
    decisionAt: serverTimestamp(),
    decidedBy: ownerUid,
    decisionNote: 'Legacy viewer access revoked by owner.',
    updatedAt: serverTimestamp()
  });
}
