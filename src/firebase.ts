import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let app;
let auth: any;
let db: any;
let googleProvider: any;

try {
  // Validate config to prevent white screen crashes
  if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) {
    throw new Error("Firebase configuration is missing or incomplete. Please check firebase-applet-config.json");
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  googleProvider = new GoogleAuthProvider();
} catch (error) {
  console.error("Firebase Initialization Error:", error);
  // Provide dummy objects to prevent crashes on import
  auth = { currentUser: null, onAuthStateChanged: () => () => {} };
  db = {};
  googleProvider = {};
}

export { auth, db, googleProvider };

export const signInWithGoogle = () => {
  if (auth && auth.app && googleProvider && googleProvider.addScope) {
    return signInWithPopup(auth, googleProvider);
  }
  const errorMsg = "Firebase Auth is not initialized. Please check your configuration in firebase-applet-config.json";
  console.error(errorMsg);
  return Promise.reject(errorMsg);
};

export const loginAnonymously = () => {
  if (auth && auth.app) {
    return signInAnonymously(auth).catch(error => {
      if (error.code === 'auth/admin-restricted-operation') {
        console.error("Anonymous authentication is not enabled in the Firebase Console. Please enable it under Authentication > Sign-in method.");
      }
      throw error;
    });
  }
  return Promise.reject("Auth not initialized");
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

// Connection test as per guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client appears to be offline.");
    }
  }
}
testConnection();
