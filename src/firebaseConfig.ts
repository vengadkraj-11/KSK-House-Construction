import {initializeApp, getApps, FirebaseApp} from 'firebase/app';
import {getFirestore, Firestore} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || ''
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId &&
  firebaseConfig.appId && firebaseConfig.messagingSenderId
);

export const app: FirebaseApp | null = isFirebaseConfigured
  ? getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
  : null;

export const db: Firestore | null = app ? getFirestore(app) : null;
