import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth';
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
  if (auth && typeof auth.signInWithPopup === 'function') {
    return signInWithPopup(auth, googleProvider);
  }
  console.error("Auth not initialized correctly");
  return Promise.reject("Auth not initialized");
};

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
