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
    collection, doc, getDoc, getDocs, writeBatch,
} from "firebase/firestore";
import { getDb } from "./firebaseApp";

const CHUNK_CHARS = 900000;

const canvasesCol = (uid) => collection(getDb(), "users", uid, "canvases");
const canvasDoc = (uid, id) => doc(getDb(), "users", uid, "canvases", id);
const partDoc = (uid, id, i) => doc(getDb(), "users", uid, "canvases", id, "parts", String(i));

// The parent doc caps at 1 MiB; thumbnails share it with the metadata, so cap
// their combined payload well below that (cover first, then insertion order).
const THUMBS_BUDGET = 700000;

function boundedThumbs(thumbs) {
    if (!thumbs) return null;
    const entries = Object.entries(thumbs).filter(([, t]) => t && typeof t.data === "string");
    entries.sort(([a], [b]) => (a === "cover" ? -1 : b === "cover" ? 1 : 0));
    const out = {};
    let used = 0;
    for (const [sid, t] of entries) {
        const cost = t.data.length + 40;
        if (used + cost > THUMBS_BUDGET) break;
        out[sid] = { hash: t.hash || "", data: t.data };
        used += cost;
    }
    return out;
}

/**
 * entry: { id, name, savedAt, levels, strokes }; json: kobin-1 JSON string;
 * thumbs (optional): { sceneId: { hash, data } } — merged over the stored set.
 */
export async function cloudSaveCanvas(uid, entry, json, thumbs = null) {
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK_CHARS) parts.push(json.slice(i, i + CHUNK_CHARS));
    if (parts.length === 0) parts.push("");

    const prev = await getDoc(canvasDoc(uid, entry.id));
    const prevParts = prev.exists() ? prev.data().parts || 0 : 0;
    const prevThumbs = prev.exists() ? prev.data().thumbs || null : null;
    const mergedThumbs = thumbs || prevThumbs
        ? boundedThumbs({ ...(prevThumbs || {}), ...(thumbs || {}) })
        : null;

    const batch = writeBatch(getDb());
    batch.set(canvasDoc(uid, entry.id), {
        name: entry.name || "Untitled canvas",
        savedAt: entry.savedAt || new Date().toISOString(),
        levels: entry.levels || 0,
        strokes: entry.strokes || 0,
        size: json.length,
        parts: parts.length,
        ...(mergedThumbs ? { thumbs: mergedThumbs } : {}),
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

/** → { json, thumbs } (kobin-1 JSON string + stored thumbnails), or null. */
export async function cloudLoadCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return null;
    const n = parent.data().parts || 0;
    const reads = [];
    for (let i = 0; i < n; i++) reads.push(getDoc(partDoc(uid, id, i)));
    const parts = await Promise.all(reads);
    return {
        json: parts.map((p) => (p.exists() ? p.data().data : "")).join(""),
        thumbs: parent.data().thumbs || null,
    };
}

export async function cloudDeleteCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    const n = parent.exists() ? parent.data().parts || 0 : 0;
    const batch = writeBatch(getDb());
    for (let i = 0; i < n; i++) batch.delete(partDoc(uid, id, i));
    batch.delete(canvasDoc(uid, id));
    await batch.commit();
}
