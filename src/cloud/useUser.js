import { useEffect, useState } from "react";
import {
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";
import { auth } from "./firebaseApp";

/** Live auth state: { user, ready }. `ready` flips once Firebase has resolved. */
export default function useUser() {
    const [user, setUser] = useState(null);
    const [ready, setReady] = useState(false);
    useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); }), []);
    return { user, ready };
}

export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
}

export function signOutUser() {
    return signOut(auth);
}
