import { useEffect, useState } from "react";
import {
    GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebaseApp";

/** Live auth state: { user, ready }. `ready` flips once Firebase has resolved. */
export default function useUser() {
    const [user, setUser] = useState(null);
    const [ready, setReady] = useState(false);
    useEffect(() => onAuthStateChanged(getFirebaseAuth(), (u) => { setUser(u); setReady(true); }), []);
    return { user, ready };
}

export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    const auth = getFirebaseAuth();
    try {
        const cred = await signInWithPopup(auth, provider);
        return cred.user;
    } catch (err) {
        // Phones (and strict browsers) block popups — fall back to the
        // full-page redirect flow; onAuthStateChanged picks it up on return.
        if (err && (err.code === "auth/popup-blocked"
            || err.code === "auth/operation-not-supported-in-this-environment")) {
            await signInWithRedirect(auth, provider);
            return null;
        }
        throw err;
    }
}

export function signOutUser() {
    return signOut(getFirebaseAuth());
}
