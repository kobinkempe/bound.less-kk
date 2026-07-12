/**
 * Firebase app bootstrap for bound-less-kk.
 *
 * The web config below is public by design (it identifies the project; access
 * control lives in Firestore security rules + Auth). Modular v9 SDK so the
 * bundler tree-shakes what the app doesn't use.
 */
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyB4deh5K8C8JGhLpb55hkSIRVTym_DrmiU",
    authDomain: "bound-less-kk.firebaseapp.com",
    projectId: "bound-less-kk",
    storageBucket: "bound-less-kk.firebasestorage.app",
    messagingSenderId: "119856093116",
    appId: "1:119856093116:web:f391611f9fcb6608e3bdb9",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
