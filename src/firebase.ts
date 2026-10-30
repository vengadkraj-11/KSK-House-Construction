import {initializeApp, getApps, FirebaseApp} from 'firebase/app';
import {initializeAuth, getAuth, getReactNativePersistence, Auth} from 'firebase/auth';
import {getFirestore, Firestore} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || ''
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId &&
  firebaseConfig.appId && firebaseConfig.messagingSenderId
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  try {
    authInstance = initializeAuth(app, {persistence: getReactNativePersistence(AsyncStorage)});
  } catch {
    authInstance = getAuth(app);
  }
  dbInstance = getFirestore(app);
}

export const auth = authInstance;
export const db = dbInstance;
