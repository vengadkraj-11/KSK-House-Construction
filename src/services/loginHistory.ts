import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import {Platform} from 'react-native';
import {
  addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import {User} from 'firebase/auth';
import {db} from '../firebase';

const PROJECT_ID = 'ksk';
const INSTALLATION_KEY = 'ksk.house.installation-id.v1';
export type LoginHistoryEntry = {
  id: string; userId: string; email?: string; displayName?: string; role: 'owner'|'viewer';
  installationId: string; deviceModel: string; deviceManufacturer: string; deviceName: string;
  platform: string; loginAt?: any; lastActiveAt?: any;
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
  });
  return {
    id: ref.id,
    userId: user.uid,
    touch: async () => updateDoc(ref, {lastActiveAt: serverTimestamp()}),
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
    ? query(base, orderBy('loginAt', 'desc'), limit(100))
    : query(base, where('userId', '==', uid), limit(50));
  return onSnapshot(q, snapshot => {
    const items = snapshot.docs.map(item => ({...item.data(), id: item.id} as LoginHistoryEntry));
    if (role === 'viewer') items.sort((a, b) => timestampMillis(b.loginAt) - timestampMillis(a.loginAt));
    onChange(items);
  }, error => onError(error?.code === 'permission-denied'
    ? 'Login history permission denied. Deploy the updated Firestore rules.'
    : error?.message || 'Could not load login history.'));
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
