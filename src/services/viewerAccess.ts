import {
  collection, doc, getDoc, getDocFromServer, getDocs, limit, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch
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
  projectId?: 'ksk';
  role?: 'viewer';
  registeredAt?: any;
  approvalDate?: any;
  approverUid?: string;
  manualInvite?: boolean;
  decisionAt?: any;
  decidedBy?: string;
  decisionNote?: string;
  revokedAt?: any;
  revokedBy?: string;
  legacy?: boolean;
};
export type ViewerPhoneIndex = {uid: string; status: ViewerAccessStatus};
export type ViewerLookupResult = {
  uid: string;
  status: ViewerAccessStatus;
  request?: ViewerAccessRequest;
  currentSession: boolean;
};
export type ViewerRecoveryRequest = {
  uid: string;
  normalizedMobileNumber: string;
  status: 'pending' | 'rejected' | 'restored';
  createdAt?: any;
  decidedBy?: string;
  decisionAt?: any;
};
export type ViewerRequestHistoryItem =
  | {kind: 'access'; request: ViewerAccessRequest}
  | {kind: 'recovery'; request: ViewerRecoveryRequest};
export type ViewerAccessHistoryEntry = {
  id: string;
  uid: string;
  fullName: string;
  normalizedMobileNumber: string;
  action: 'registered' | 'approved' | 'rejected' | 'revoked' | 'recovery_requested' | 'recovery_rejected' | 'recovery_restored' | 'history_cleared' | 'account_deleted';
  status: string;
  previousStatus?: string;
  actorUid: string;
  createdAt?: any;
  installationId?: string;
};

const accessPath = (uid: string) => doc(db!, 'viewerAccess', uid);
const phonePath = (phone: string) => doc(db!, 'viewerPhoneIndex', phone);
const phoneStatusPath = (phone: string) => doc(db!, 'viewerPhoneStatus', phone);
const recoveryPath = (uid: string) => doc(db!, 'viewerRecoveryRequests', uid);
const accountDeletionPath = (uid: string) => doc(db!, 'viewerAccountDeletions', uid);
const historyCollection = () => collection(db!, 'viewerAccessHistory');

export function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  if (/^00[1-9]\d{7,14}$/.test(digits)) return `+${digits.slice(2)}`;
  return trimmed.startsWith('+') ? `+${digits}` : `+${digits}`;
}

const isValidNormalizedPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

export function canContinueWithApprovedSession(
  authenticatedUid: string | null | undefined,
  request: ViewerAccessRequest | null | undefined,
  mobileNumber: string
): boolean {
  return Boolean(
    authenticatedUid &&
    request?.uid === authenticatedUid &&
    request.status === 'approved' &&
    !!request.approvalDate &&
    (request.projectId === undefined || request.projectId === 'ksk') &&
    (request.role === undefined || request.role === 'viewer') &&
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
  if (!isValidNormalizedPhone(normalizedMobileNumber)) {
    throw new Error('Enter a mobile number in international format, including the + country code.');
  }
  const name = fullName.trim();
  if (name.length < 2 || name.length > 120) throw new Error('Enter your full name (2–120 characters).');
  if (preferredLanguage !== 'en' && preferredLanguage !== 'ta') throw new Error('Choose English or Tamil.');
  const database = db;

  return runTransaction(database, async transaction => {
    const requestRef = accessPath(uid);
    const phoneRef = phonePath(normalizedMobileNumber);
    const phoneStatusRef = phoneStatusPath(normalizedMobileNumber);
    const existingRequest = await transaction.get(requestRef);

    if (existingRequest.exists()) {
      const request = existingRequest.data() as ViewerAccessRequest;
      if (request.normalizedMobileNumber !== normalizedMobileNumber) {
        throw new Error('This authenticated session is already linked to another mobile number.');
      }
      return {uid, status: request.status, created: false, currentSession: true};
    }

    const timestamp = serverTimestamp();
    transaction.set(requestRef, {
      uid,
      fullName: name,
      normalizedMobileNumber,
      status: 'pending',
      preferredLanguage,
      registeredAt: timestamp,
      createdAt: timestamp
    });
    transaction.set(phoneRef, {
      uid,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    transaction.set(phoneStatusRef, {
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    transaction.set(doc(historyCollection()), {
      uid,
      fullName: name,
      normalizedMobileNumber,
      action: 'registered',
      status: 'pending',
      actorUid: uid,
      createdAt: timestamp
    });
    return {uid, status: 'pending' as const, created: true, currentSession: true};
  });
}

export async function addApprovedViewer(
  fullName: string,
  phone: string,
  ownerUid: string,
  preferredLanguage: ViewerLanguage
) {
  if (!db) throw new Error('Firebase is not configured.');
  if (!ownerUid) throw new Error('Only the authenticated project owner can add a member.');
  const normalizedMobileNumber = normalizePhoneNumber(phone);
  if (!isValidNormalizedPhone(normalizedMobileNumber)) {
    throw new Error('Enter a mobile number in international format, including the + country code.');
  }
  const name = fullName.trim();
  if (name.length < 2 || name.length > 120) throw new Error('Enter your full name (2–120 characters).');
  if (preferredLanguage !== 'en' && preferredLanguage !== 'ta') throw new Error('Choose English or Tamil.');

  const database = db;
  const inviteUid = `manual_${doc(collection(database, 'viewerAccess')).id}`;
  const memberRef = accessPath(inviteUid);
  const indexRef = phonePath(normalizedMobileNumber);
  const statusRef = phoneStatusPath(normalizedMobileNumber);

  await runTransaction(database, async transaction => {
    const [member, index, status] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(indexRef),
      transaction.get(statusRef)
    ]);
    if (member.exists()) throw new Error('Could not create a unique member invitation. Please try again.');
    if (index.exists() || status.exists()) throw new Error('This mobile number already has a member or invitation.');

    const timestamp = serverTimestamp();
    transaction.set(memberRef, {
      uid: inviteUid,
      fullName: name,
      normalizedMobileNumber,
      status: 'approved',
      preferredLanguage,
      projectId: 'ksk',
      role: 'viewer',
      manualInvite: true,
      registeredAt: timestamp,
      createdAt: timestamp,
      approvalDate: timestamp,
      approverUid: ownerUid
    });
    transaction.set(indexRef, {
      uid: inviteUid,
      status: 'approved',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    transaction.set(statusRef, {
      status: 'approved',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    transaction.set(doc(historyCollection()), {
      uid: inviteUid,
      fullName: name,
      normalizedMobileNumber,
      action: 'approved',
      status: 'approved',
      actorUid: ownerUid,
      createdAt: timestamp
    });
  });

  return {
    uid: inviteUid,
    fullName: name,
    normalizedMobileNumber,
    status: 'approved' as const,
    preferredLanguage,
    manualInvite: true
  };
}

export async function lookupViewerAccessByPhone(
  authenticatedUid: string | null | undefined,
  phone: string
): Promise<ViewerLookupResult | null> {
  if (!db) throw new Error('Firebase is not configured.');
  const normalizedMobileNumber = normalizePhoneNumber(phone);
  if (!isValidNormalizedPhone(normalizedMobileNumber)) {
    throw new Error('Enter a mobile number in international format, including the + country code.');
  }

  const currentRequest = authenticatedUid ? await getDocFromServer(accessPath(authenticatedUid)) : null;
  if (currentRequest?.exists()) {
    const request = currentRequest.data() as ViewerAccessRequest;
    const memberPhone = normalizePhoneNumber(request.normalizedMobileNumber || '');
    if (memberPhone === normalizedMobileNumber) {
      const currentMember = {...request, normalizedMobileNumber: memberPhone};
      return {uid: authenticatedUid!, status: currentMember.status, request: currentMember, currentSession: true};
    }
  }
  return null;
}

export async function requestViewerRecovery(uid: string, phone: string) {
  if (!db) throw new Error('Firebase is not configured.');
  const normalizedMobileNumber = normalizePhoneNumber(phone);
  if (!isValidNormalizedPhone(normalizedMobileNumber)) {
    throw new Error('Enter a mobile number in international format, including the + country code.');
  }
  const database = db;

  return runTransaction(database, async transaction => {
    const recoveryRef = recoveryPath(uid);
    const requestRef = accessPath(uid);
    const [recovery, currentRequest] = await Promise.all([
      transaction.get(recoveryRef),
      transaction.get(requestRef)
    ]);
    if (currentRequest.exists()) {
      const current = currentRequest.data() as ViewerAccessRequest;
      const memberPhone = normalizePhoneNumber(current.normalizedMobileNumber || '');
      if (memberPhone === normalizedMobileNumber) {
        const request = {...current, normalizedMobileNumber: memberPhone};
        return {status: request.status, created: false, currentSession: true, request};
      }
      throw new Error('This session already has a family access record. Contact the project owner for account recovery.');
    }
    if (recovery.exists()) {
      const existing = recovery.data() as ViewerRecoveryRequest;
      if (normalizePhoneNumber(existing.normalizedMobileNumber || '') !== normalizedMobileNumber) {
        throw new Error('This session already has a recovery request for another mobile number.');
      }
      return {status: existing.status, created: false, currentSession: false};
    }

    const timestamp = serverTimestamp();
    transaction.set(recoveryRef, {
      uid,
      normalizedMobileNumber,
      status: 'pending',
      createdAt: timestamp
    });
    transaction.set(doc(historyCollection()), {
      uid,
      fullName: '',
      normalizedMobileNumber,
      action: 'recovery_requested',
      status: 'pending',
      actorUid: uid,
      createdAt: timestamp
    });
    return {status: 'pending' as const, created: true, currentSession: false};
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

export async function ensureViewerPhoneIndex(request: ViewerAccessRequest) {
  if (!db || request.legacy || !request.normalizedMobileNumber) return;
  const phone = normalizePhoneNumber(request.normalizedMobileNumber);
  if (!isValidNormalizedPhone(phone)) return;
  const database = db;

  await runTransaction(database, async transaction => {
    const requestRef = accessPath(request.uid);
    const phoneRef = phonePath(phone);
    const phoneStatusRef = phoneStatusPath(phone);
    const [savedRequest, phoneIndex, phoneStatus] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(phoneRef),
      transaction.get(phoneStatusRef)
    ]);
    if (!savedRequest.exists()) return;
    const saved = savedRequest.data() as ViewerAccessRequest;
    if (saved.normalizedMobileNumber !== phone) return;
    if (phoneIndex.exists()) {
      if ((phoneIndex.data() as ViewerPhoneIndex).uid !== request.uid) {
        throw new Error(`More than one viewer record uses ${phone}. Resolve the duplicate before changing access.`);
      }
    }
    const timestamp = serverTimestamp();
    if (phoneIndex.exists()) {
      transaction.update(phoneRef, {status: saved.status, updatedAt: timestamp});
    } else {
      transaction.set(phoneRef, {
        uid: request.uid,
        status: saved.status,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    if (phoneStatus.exists()) {
      transaction.update(phoneStatusRef, {status: saved.status, updatedAt: timestamp});
    } else {
      transaction.set(phoneStatusRef, {
        status: saved.status,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  });
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

export function subscribeViewerRecoveryRequests(
  onChange: (requests: ViewerRecoveryRequest[]) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase is not configured.'));
    return () => {};
  }
  return onSnapshot(collection(db, 'viewerRecoveryRequests'), snapshot => {
    const requests = snapshot.docs.map(item => item.data() as ViewerRecoveryRequest);
    requests.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    onChange(requests);
  }, onError);
}

export function subscribeViewerAccessHistory(
  onChange: (events: ViewerAccessHistoryEntry[]) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase is not configured.'));
    return () => {};
  }
  return onSnapshot(historyCollection(), snapshot => {
    const events = snapshot.docs.map(item => ({...item.data(), id: item.id} as ViewerAccessHistoryEntry));
    events.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
    onChange(events);
  }, onError);
}

export async function clearViewerAccessHistory(ids: string[]): Promise<number> {
  if (!db) throw new Error('Firebase is not configured.');
  let clearedCount = 0;
  for (let offset = 0; offset < ids.length; offset += 450) {
    const batch = writeBatch(db);
    ids.slice(offset, offset + 450).forEach(id => batch.delete(doc(db!, 'viewerAccessHistory', id)));
    await batch.commit();
    clearedCount += Math.min(450, ids.length - offset);
  }
  return clearedCount;
}

export async function clearViewerRequestHistory(
  items: ViewerRequestHistoryItem[],
  ownerUid: string
): Promise<number> {
  if (!db) throw new Error('Firebase is not configured.');

  let clearedCount = 0;
  for (let offset = 0; offset < items.length; offset += 5) {
    const chunk = items.slice(offset, offset + 5);
    clearedCount += await runTransaction(db, async transaction => {
      const entries = chunk.map(item => {
        const requestRef = item.kind === 'access' ? accessPath(item.request.uid) : recoveryPath(item.request.uid);
        const indexRef = item.kind === 'access' && item.request.normalizedMobileNumber
          ? phonePath(normalizePhoneNumber(item.request.normalizedMobileNumber))
          : null;
        const statusRef = item.kind === 'access' && item.request.normalizedMobileNumber
          ? phoneStatusPath(normalizePhoneNumber(item.request.normalizedMobileNumber))
          : null;
        return {item, requestRef, indexRef, statusRef};
      });
      const snapshots = await Promise.all(entries.flatMap(({requestRef, indexRef, statusRef}) =>
        [requestRef, indexRef, statusRef].filter((reference): reference is NonNullable<typeof reference> => reference !== null)
          .map(reference => transaction.get(reference))
      ));

      let snapshotIndex = 0;
      let chunkClearedCount = 0;
      for (const {item, requestRef, indexRef, statusRef} of entries) {
        const requestSnapshot = snapshots[snapshotIndex++];
        const indexSnapshot = indexRef ? snapshots[snapshotIndex++] : null;
        const statusSnapshot = statusRef ? snapshots[snapshotIndex++] : null;
        if (!requestSnapshot.exists()) continue;

        const currentRequest = requestSnapshot.data() as ViewerAccessRequest | ViewerRecoveryRequest;
        if (item.kind === 'recovery') {
          if (!['pending', 'rejected', 'restored'].includes(currentRequest.status)) continue;
          const recovery = currentRequest as ViewerRecoveryRequest;
          transaction.set(doc(historyCollection()), {
            uid: recovery.uid,
            fullName: '',
            normalizedMobileNumber: recovery.normalizedMobileNumber,
            action: 'history_cleared',
            status: 'cleared',
            previousStatus: recovery.status,
            actorUid: ownerUid,
            createdAt: serverTimestamp()
          });
          transaction.delete(requestRef);
          chunkClearedCount += 1;
          continue;
        }

        const accessRequest = currentRequest as ViewerAccessRequest;
        if (accessRequest.legacy || !['pending', 'rejected'].includes(accessRequest.status)) continue;
        transaction.set(doc(historyCollection()), {
          uid: accessRequest.uid,
          fullName: accessRequest.fullName,
          normalizedMobileNumber: accessRequest.normalizedMobileNumber,
          action: 'history_cleared',
          status: 'cleared',
          previousStatus: accessRequest.status,
          actorUid: ownerUid,
          createdAt: serverTimestamp()
        });
        transaction.delete(requestRef);
        if (indexSnapshot?.exists()) {
          const index = indexSnapshot.data() as ViewerPhoneIndex;
          if (index.uid === accessRequest.uid && ['pending', 'rejected'].includes(index.status)) {
            transaction.delete(indexRef!);
          }
        }
        if (statusSnapshot?.exists()) {
          const status = statusSnapshot.data() as {status: ViewerAccessStatus};
          const indexBelongsToRequest = !indexSnapshot?.exists()
            || (indexSnapshot.data() as ViewerPhoneIndex).uid === accessRequest.uid;
          if (indexBelongsToRequest && ['pending', 'rejected'].includes(status.status)) {
            transaction.delete(statusRef!);
          }
        }
        chunkClearedCount += 1;
      }
      return chunkClearedCount;
    });
  }
  return clearedCount;
}

export async function deleteViewerAccount(request: ViewerAccessRequest, ownerUid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  if (!ownerUid || request.uid === ownerUid) throw new Error('The owner account cannot be deleted here.');
  const database = db;
  const accountRef = accessPath(request.uid);
  const profileRef = doc(database, 'users', request.uid);
  const [accessSnapshot, profileSnapshot] = await Promise.all([
    getDoc(accountRef),
    getDoc(profileRef)
  ]);
  const access = accessSnapshot.exists() ? accessSnapshot.data() as ViewerAccessRequest : null;
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
  if (profile?.projectId === 'ksk' && profile?.role === 'owner') {
    throw new Error('The owner account cannot be deleted here.');
  }
  if (!access && !(profile?.projectId === 'ksk' && profile?.role === 'viewer')) {
    throw new Error('This viewer account no longer exists.');
  }

  const deviceQuery = collection(database, 'users', request.uid, 'devices');
  for (;;) {
    const devices = await getDocs(query(deviceQuery, limit(450)));
    if (devices.empty) break;
    const batch = writeBatch(database);
    devices.docs.forEach(device => batch.delete(device.ref));
    await batch.commit();
  }

  await runTransaction(database, async transaction => {
    const [currentAccessSnapshot, currentProfileSnapshot, recoverySnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(profileRef),
      transaction.get(recoveryPath(request.uid))
    ]);
    const currentAccess = currentAccessSnapshot.exists()
      ? currentAccessSnapshot.data() as ViewerAccessRequest
      : null;
    const currentProfile = currentProfileSnapshot.exists() ? currentProfileSnapshot.data() : null;
    if (currentProfile?.projectId === 'ksk' && currentProfile?.role === 'owner') {
      throw new Error('The owner account cannot be deleted here.');
    }
    if (!currentAccess && !(currentProfile?.projectId === 'ksk' && currentProfile?.role === 'viewer')) {
      throw new Error('This viewer account no longer exists.');
    }
    const deletionRef = accountDeletionPath(request.uid);
    if ((await transaction.get(deletionRef)).exists()) {
      throw new Error('This viewer account has already been deleted.');
    }

    const phone = currentAccess?.normalizedMobileNumber
      ? normalizePhoneNumber(currentAccess.normalizedMobileNumber)
      : '';
    const indexRef = phone && isValidNormalizedPhone(phone) ? phonePath(phone) : null;
    const statusRef = phone && isValidNormalizedPhone(phone) ? phoneStatusPath(phone) : null;
    const [indexSnapshot, statusSnapshot] = indexRef && statusRef
      ? await Promise.all([transaction.get(indexRef), transaction.get(statusRef)])
      : [null, null];

    transaction.set(doc(historyCollection()), {
      uid: request.uid,
      fullName: currentAccess?.fullName || String(currentProfile?.fullName || currentProfile?.displayName || request.fullName),
      normalizedMobileNumber: phone,
      action: 'account_deleted',
      status: 'deleted',
      previousStatus: currentAccess?.status || 'approved',
      actorUid: ownerUid,
      createdAt: serverTimestamp()
    });
    transaction.set(deletionRef, {
      uid: request.uid,
      actorUid: ownerUid,
      createdAt: serverTimestamp()
    });
    if (currentAccessSnapshot.exists()) transaction.delete(accountRef);
    if (currentProfileSnapshot.exists() && currentProfile?.projectId === 'ksk' && currentProfile?.role === 'viewer') {
      transaction.delete(profileRef);
    }
    if (recoverySnapshot.exists()) transaction.delete(recoveryPath(request.uid));
    const indexBelongsToRequest = !indexSnapshot?.exists()
      || (indexSnapshot.data() as ViewerPhoneIndex).uid === request.uid;
    if (indexSnapshot?.exists() && indexBelongsToRequest) {
      transaction.delete(indexRef!);
    }
    if (statusSnapshot?.exists() && indexBelongsToRequest) transaction.delete(statusRef!);
  });

  let deviceHistoryCount = 0;
  const sessions = collection(database, 'projects', 'ksk', 'login_history');
  for (;;) {
    const snapshot = await getDocs(query(sessions, where('userId', '==', request.uid), limit(450)));
    if (snapshot.empty) break;
    const batch = writeBatch(database);
    snapshot.docs.forEach(item => batch.delete(item.ref));
    await batch.commit();
    deviceHistoryCount += snapshot.size;
  }
  return {authAccountDeleted: false, deviceHistoryCount};
}

function timestampMillis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
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
    changes.projectId = 'ksk';
    changes.role = 'viewer';
    changes.revokedBy = null;
    changes.revokedAt = null;
  } else if (action === 'revoked') {
    changes.projectId = 'ksk';
    changes.role = 'viewer';
    changes.revokedBy = approverUid;
    changes.revokedAt = serverTimestamp();
  }

  const normalizedMobileNumber = normalizePhoneNumber(request.normalizedMobileNumber);
  if (!isValidNormalizedPhone(normalizedMobileNumber)) {
    throw new Error('This viewer record has no valid mobile number. Contact the project administrator.');
  }
  const indexReference = phonePath(normalizedMobileNumber);
  const statusReference = phoneStatusPath(normalizedMobileNumber);
  const phoneIndex = await getDoc(indexReference);
  const phoneStatus = await getDoc(statusReference);
  if (phoneIndex.exists() && (phoneIndex.data() as ViewerPhoneIndex).uid !== request.uid) {
    throw new Error('Another viewer record already uses this mobile number.');
  }
  const batch = writeBatch(db);
  batch.update(accessPath(request.uid), changes);
  batch.set(doc(historyCollection()), {
    uid: request.uid,
    fullName: request.fullName,
    normalizedMobileNumber,
    action,
    status: action,
    actorUid: approverUid,
    createdAt: serverTimestamp()
  });
  const statusChanges = {status: action, updatedAt: serverTimestamp()};
  if (phoneStatus.exists()) batch.update(statusReference, statusChanges);
  else batch.set(statusReference, {
    ...statusChanges,
    createdAt: serverTimestamp()
  });
  if (phoneIndex.exists()) {
    batch.update(indexReference, {
      uid: request.uid,
      status: action,
      updatedAt: serverTimestamp()
    });
  } else {
    batch.set(indexReference, {
      uid: request.uid,
      status: action,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

export async function decideViewerRecovery(
  request: ViewerRecoveryRequest,
  action: 'restore' | 'rejected',
  ownerUid: string
) {
  if (!db) throw new Error('Firebase is not configured.');
  const database = db;

  await runTransaction(database, async transaction => {
    const recoveryRef = recoveryPath(request.uid);
    const recoverySnapshot = await transaction.get(recoveryRef);
    if (!recoverySnapshot.exists()) throw new Error('This recovery request no longer exists.');
    const currentRecovery = recoverySnapshot.data() as ViewerRecoveryRequest;
    if (currentRecovery.status !== 'pending') throw new Error('This recovery request has already been decided.');

    if (action === 'rejected') {
      transaction.update(recoveryRef, {
        status: 'rejected',
        decidedBy: ownerUid,
        decisionAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      transaction.set(doc(historyCollection()), {
        uid: request.uid,
        fullName: '',
        normalizedMobileNumber: currentRecovery.normalizedMobileNumber,
        action: 'recovery_rejected',
        status: 'rejected',
        actorUid: ownerUid,
        createdAt: serverTimestamp()
      });
      return;
    }

    const phoneRef = phonePath(currentRecovery.normalizedMobileNumber);
    const phoneStatusRef = phoneStatusPath(currentRecovery.normalizedMobileNumber);
    const newAccessRef = accessPath(request.uid);
    const [phoneIndexSnapshot, phoneStatusSnapshot, newAccessSnapshot] = await Promise.all([
      transaction.get(phoneRef),
      transaction.get(phoneStatusRef),
      transaction.get(newAccessRef)
    ]);
    if (!phoneIndexSnapshot.exists() || !phoneStatusSnapshot.exists()) throw new Error('The approved member record could not be found.');
    const phoneIndex = phoneIndexSnapshot.data() as ViewerPhoneIndex;
    if (phoneIndex.status !== 'approved' || phoneIndex.uid === request.uid) {
      throw new Error('This mobile number is no longer available for account recovery.');
    }
    if (newAccessSnapshot.exists()) throw new Error('This session already has a viewer account.');
    const oldAccessRef = accessPath(phoneIndex.uid);
    const oldAccessSnapshot = await transaction.get(oldAccessRef);
    if (!oldAccessSnapshot.exists()) throw new Error('The approved member record could not be found.');
    const oldAccess = oldAccessSnapshot.data() as ViewerAccessRequest;
    if (oldAccess.status !== 'approved' || oldAccess.normalizedMobileNumber !== currentRecovery.normalizedMobileNumber) {
      throw new Error('The approved member record no longer matches this recovery request.');
    }

    const timestamp = serverTimestamp();
    transaction.update(oldAccessRef, {
      status: 'revoked',
      revokedAt: timestamp,
      revokedBy: ownerUid,
      decidedBy: ownerUid,
      decisionAt: timestamp,
      decisionNote: 'Approved access transferred to a verified replacement session.',
      updatedAt: timestamp
    });
    transaction.set(newAccessRef, {
      uid: request.uid,
      fullName: oldAccess.fullName,
      normalizedMobileNumber: currentRecovery.normalizedMobileNumber,
      status: 'approved',
      preferredLanguage: oldAccess.preferredLanguage,
      projectId: 'ksk',
      role: 'viewer',
      registeredAt: timestamp,
      createdAt: timestamp,
      approvalDate: oldAccess.approvalDate,
      approverUid: oldAccess.approverUid
    });
    transaction.update(phoneRef, {
      uid: request.uid,
      status: 'approved',
      updatedAt: timestamp
    });
    transaction.update(phoneStatusRef, {status: 'approved', updatedAt: timestamp});
    transaction.update(recoveryRef, {
      status: 'restored',
      decidedBy: ownerUid,
      decisionAt: timestamp,
      updatedAt: timestamp
    });
    transaction.set(doc(historyCollection()), {
      uid: request.uid,
      fullName: oldAccess.fullName,
      normalizedMobileNumber: currentRecovery.normalizedMobileNumber,
      action: 'recovery_restored',
      status: 'approved',
      actorUid: ownerUid,
      createdAt: timestamp
    });
  });
}

export async function revokeLegacyViewer(request: ViewerAccessRequest, ownerUid: string) {
  if (!db) throw new Error('Firebase is not configured.');
  if (!request.legacy) throw new Error('This is not a legacy viewer account.');
  const batch = writeBatch(db);
  batch.set(accessPath(request.uid), {
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
  batch.set(doc(historyCollection()), {
    uid: request.uid,
    fullName: request.fullName,
    normalizedMobileNumber: '',
    action: 'revoked',
    status: 'revoked',
    actorUid: ownerUid,
    createdAt: serverTimestamp()
  });
  await batch.commit();
}
