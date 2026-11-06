import {getAuth, initializeAuth, Auth} from 'firebase/auth';
// @ts-ignore Firebase 12 exposes this at runtime for React Native but omits its declaration.
import {getReactNativePersistence} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {app, db, firebaseConfig, isFirebaseConfigured} from './firebaseConfig';

let auth: Auth | null = null;
if (app) {
  try {
    auth = initializeAuth(app, {persistence: getReactNativePersistence(AsyncStorage)});
  } catch {
    auth = getAuth(app);
  }
}

export {app, auth, db, firebaseConfig, isFirebaseConfigured};
