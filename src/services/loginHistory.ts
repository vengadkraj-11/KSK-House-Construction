import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import {Platform} from 'react-native';
import {
  addDoc, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch
} from 'firebase/firestore';
import {User} from 'firebase/auth';
import {auth, db} from '../firebase';

const PROJECT_ID = 'ksk';
const INSTALLATION_KEY = 'ksk.house.installation-id.v1';
export type LoginHistoryEntry = {
  id: string; userId: string; email?: string; displayName?: string; role: 'owner'|'viewer';
  installationId: string; deviceModel: string; deviceManufacturer: string; deviceName: string;
  platform: string; loginAt?: any; lastActiveAt?: any; status?: 'active' | 'ended' | 'revoked';
};

async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (existing) return existing;
  const created = `ksk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export async function createLoginHistorySession(user: User, role: 'owner'|'viewer') {
  if (!db || !user?.uid) throw new Error('Login history requires an authenticated Firebase account.');
  const installationId = await getInstallationId();
  const ref = await addDoc(collection(db, 'projects', PROJECT_ID, 'login_history'), {
    userId: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    role,
    installationId,
    deviceModel: Device.modelName || 'Unknown model',
    deviceManufacturer: Device.manufacturer || 'Unknown manufacturer',
    deviceName: Device.deviceName || 'Unnamed device',
    platform: Platform.OS,
    loginAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    status: 'active',
  });
  return {
    id: ref.id,
    userId: user.uid,
    touch: async () => updateDoc(ref, {lastActiveAt: serverTimestamp()}),
    end: async () => updateDoc(ref, {status: 'ended', endedAt: serverTimestamp()}),
  };
}

export function subscribeLoginHistory(
  uid: string,
  role: 'owner'|'viewer',
  onChange: (items: LoginHistoryEntry[]) => void,
  onError: (message: string) => void,
) {
  if (!db || !uid) { onError('Sign in to view login history.'); return () => {}; }
  const base = collection(db, 'projects', PROJECT_ID, 'login_history');
  const q = role === 'owner'
    ? query(base, orderBy('loginAt', 'desc'))
    : query(base, where('userId', '==', uid), limit(50));
  return onSnapshot(q, snapshot => {
    const items = snapshot.docs.map(item => ({...item.data(), id: item.id} as LoginHistoryEntry));
    if (role === 'viewer') items.sort((a, b) => timestampMillis(b.loginAt) - timestampMillis(a.loginAt));
    onChange(items);
  }, error => onError(error?.code === 'permission-denied'
    ? 'Login history permission denied. Deploy the updated Firestore rules.'
    : error?.message || 'Could not load login history.'));
}


export async function clearLoginHistory(): Promise<number> {
  if (!db || !auth?.currentUser) {
    throw new Error('Sign in before clearing login history.');
  }

  const currentUid = auth.currentUser.uid;
  const currentInstallationId = await getInstallationId();
  const snapshot = await getDocs(collection(db, 'projects', PROJECT_ID, 'login_history'));

  // Keep this device's active session so its last-active timestamp can continue updating.
  const oldSessions = snapshot.docs.filter(item => {
    const data = item.data();
    return !(data.userId === currentUid && data.installationId === currentInstallationId);
  });

  for (let offset = 0; offset < oldSessions.length; offset += 450) {
    const batch = writeBatch(db);
    oldSessions.slice(offset, offset + 450).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }

  return oldSessions.length;
}

export async function clearLoginHistoryEntries(ids: string[]): Promise<number> {
  if (!db || !auth?.currentUser) throw new Error('Sign in before clearing device history.');
  let clearedCount = 0;
  for (let offset = 0; offset < ids.length; offset += 450) {
    const batch = writeBatch(db);
    ids.slice(offset, offset + 450).forEach(id => {
      batch.delete(doc(db!, 'projects', PROJECT_ID, 'login_history', id));
    });
    await batch.commit();
    clearedCount += Math.min(450, ids.length - offset);
  }
  return clearedCount;
}

export async function updateLoginHistorySession(
  sessionId: string,
  status: 'revoked',
  actorUid: string
) {
  if (!db || !auth?.currentUser) throw new Error('Sign in before changing device access.');
  await updateDoc(doc(db, 'projects', PROJECT_ID, 'login_history', sessionId), {
    status,
    revokedBy: actorUid,
    revokedAt: serverTimestamp()
  });
}

export async function revokeLoginHistoryForUser(userId: string, actorUid: string): Promise<number> {
  if (!db || !auth?.currentUser) throw new Error('Sign in before changing device access.');
  const sessions = await getDocs(query(
    collection(db, 'projects', PROJECT_ID, 'login_history'),
    where('userId', '==', userId)
  ));
  for (let offset = 0; offset < sessions.size; offset += 450) {
    const batch = writeBatch(db);
    sessions.docs.slice(offset, offset + 450).forEach(session => batch.update(session.ref, {
      status: 'revoked',
      revokedBy: actorUid,
      revokedAt: serverTimestamp()
    }));
    await batch.commit();
  }
  return sessions.size;
}

function timestampMillis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function loginHistoryDate(value: any): string {
  if (!value) return 'Pending';
  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? 'Pending' : date.toLocaleString();
}
