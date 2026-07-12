/**
 * Firestore persistence for canvases, mirroring the local index/slot model:
 *
 *   users/{uid}/canvases/{canvasId}         — { name, savedAt, levels, strokes, size, parts }
 *   users/{uid}/canvases/{canvasId}/parts/{i} — { data: <string chunk> }
 *
 * The kobin-1 JSON is stored as string chunks under the parent doc because a
 * Firestore document caps at 1 MiB; splitting at 900k chars leaves headroom.
 * Metadata stays on the parent so gallery listing never downloads drawings.
 */
import {
    collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
} from "firebase/firestore";
import { db } from "./firebaseApp";

const CHUNK_CHARS = 900000;

const canvasesCol = (uid) => collection(db, "users", uid, "canvases");
const canvasDoc = (uid, id) => doc(db, "users", uid, "canvases", id);
const partDoc = (uid, id, i) => doc(db, "users", uid, "canvases", id, "parts", String(i));

/** entry: { id, name, savedAt, levels, strokes }; json: kobin-1 JSON string. */
export async function cloudSaveCanvas(uid, entry, json) {
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK_CHARS) parts.push(json.slice(i, i + CHUNK_CHARS));
    if (parts.length === 0) parts.push("");

    const prev = await getDoc(canvasDoc(uid, entry.id));
    const prevParts = prev.exists() ? prev.data().parts || 0 : 0;

    const batch = writeBatch(db);
    batch.set(canvasDoc(uid, entry.id), {
        name: entry.name || "Untitled canvas",
        savedAt: entry.savedAt || new Date().toISOString(),
        levels: entry.levels || 0,
        strokes: entry.strokes || 0,
        size: json.length,
        parts: parts.length,
    });
    parts.forEach((data, i) => batch.set(partDoc(uid, entry.id, i), { data }));
    for (let i = parts.length; i < prevParts; i++) batch.delete(partDoc(uid, entry.id, i));
    await batch.commit();
}

/** → [{ id, name, savedAt, levels, strokes }] sorted newest first. */
export async function cloudListCanvases(uid) {
    const snap = await getDocs(canvasesCol(uid));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    return list;
}

/** → kobin-1 JSON string, or null if absent. */
export async function cloudLoadCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return null;
    const n = parent.data().parts || 0;
    const reads = [];
    for (let i = 0; i < n; i++) reads.push(getDoc(partDoc(uid, id, i)));
    const parts = await Promise.all(reads);
    return parts.map((p) => (p.exists() ? p.data().data : "")).join("");
}

export async function cloudDeleteCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    const n = parent.exists() ? parent.data().parts || 0 : 0;
    const batch = writeBatch(db);
    for (let i = 0; i < n; i++) batch.delete(partDoc(uid, id, i));
    batch.delete(canvasDoc(uid, id));
    await batch.commit();
}
