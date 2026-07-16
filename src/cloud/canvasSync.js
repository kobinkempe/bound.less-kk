/**
 * Firestore persistence for canvases, mirroring the local index/slot model:
 *
 *   users/{uid}/canvases/{canvasId}         — { name, savedAt, levels, strokes, size, parts, codec }
 *   users/{uid}/canvases/{canvasId}/parts/{i} — { data: Bytes (lz1) | string (legacy) }
 *
 * The kobin-1 JSON is lz-string compressed (codec "lz1") and stored as binary
 * chunks under the parent doc: a Firestore document caps at 1 MiB, and a single
 * commit at ~10 MiB — so parts are chunked at 700 KiB and committed in groups,
 * with the parent doc written LAST (readers key off parent.parts/codec, so a
 * torn save never looks complete). Legacy plain-string parts still load.
 * Metadata stays on the parent so gallery listing never downloads drawings.
 */
import {
    collection, doc, getDoc, getDocs, setDoc, writeBatch, Bytes,
} from "firebase/firestore";
import LZString from "lz-string";
import { getDb } from "./firebaseApp";

const LEGACY_CHUNK_CHARS = 900000; // pre-lz1 string chunks (readers only)
const BIN_CHUNK_BYTES = 700 * 1024; // compressed binary chunk per part doc
const PARTS_PER_COMMIT = 6; // ≤ ~4.2 MiB per commit, under the 10 MiB cap
export const CANVAS_CODEC = "lz1";

const canvasesCol = (uid) => collection(getDb(), "users", uid, "canvases");
const canvasDoc = (uid, id) => doc(getDb(), "users", uid, "canvases", id);
const partDoc = (uid, id, i) => doc(getDb(), "users", uid, "canvases", id, "parts", String(i));

// ---- pure payload codec (unit-tested without Firestore) ----

/** kobin-1 JSON string → { codec, chunks: Uint8Array[] } (≥ 1 chunk). */
export function encodeCanvasPayload(json) {
    const u8 = LZString.compressToUint8Array(json || "");
    const chunks = [];
    for (let i = 0; i < u8.length; i += BIN_CHUNK_BYTES) {
        chunks.push(u8.subarray(i, i + BIN_CHUNK_BYTES));
    }
    if (chunks.length === 0) chunks.push(new Uint8Array(0));
    return { codec: CANVAS_CODEC, chunks };
}

/**
 * Stored parts (Uint8Array for lz1, strings for legacy) → kobin-1 JSON string.
 * `codec` comes from the parent doc; absent/unknown means legacy plain strings.
 */
export function decodeCanvasPayload(parts, codec) {
    if (codec === CANVAS_CODEC) {
        let total = 0;
        for (const p of parts) total += p.length;
        const u8 = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { u8.set(p, off); off += p.length; }
        return LZString.decompressFromUint8Array(u8) ?? "";
    }
    return parts.map((p) => (typeof p === "string" ? p : "")).join("");
}

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
    const { codec, chunks } = encodeCanvasPayload(json);

    const prev = await getDoc(canvasDoc(uid, entry.id));
    const prevParts = prev.exists() ? prev.data().parts || 0 : 0;
    const prevThumbs = prev.exists() ? prev.data().thumbs || null : null;
    const prevEditing = prev.exists() ? prev.data().editing || null : null;
    const mergedThumbs = thumbs || prevThumbs
        ? boundedThumbs({ ...(prevThumbs || {}), ...(thumbs || {}) })
        : null;

    // Parts first, in bounded commits (a huge drawing overflows one batch's
    // ~10 MiB request cap — the old single-batch write failed wholesale).
    for (let start = 0; start < chunks.length; start += PARTS_PER_COMMIT) {
        const batch = writeBatch(getDb());
        chunks.slice(start, start + PARTS_PER_COMMIT).forEach((data, j) => {
            batch.set(partDoc(uid, entry.id, start + j), { data: Bytes.fromUint8Array(data) });
        });
        await batch.commit();
    }

    // Parent last: readers only trust parts/codec published here.
    const finalBatch = writeBatch(getDb());
    finalBatch.set(canvasDoc(uid, entry.id), {
        name: entry.name || "Untitled canvas",
        savedAt: entry.savedAt || new Date().toISOString(),
        levels: entry.levels || 0,
        strokes: entry.strokes || 0,
        size: json.length,
        parts: chunks.length,
        codec,
        ...(mergedThumbs ? { thumbs: mergedThumbs } : {}),
        // Whole-doc set — carry the presence heartbeat through, or a save
        // would blank the "open on another device" signal for up to 30s.
        ...(prevEditing ? { editing: prevEditing } : {}),
    });
    for (let i = chunks.length; i < prevParts; i++) finalBatch.delete(partDoc(uid, entry.id, i));
    await finalBatch.commit();
}

/**
 * → [{ id, name, savedAt, levels, strokes, deletedAt? }] sorted newest first.
 * Includes recycle-bin tombstones (`deletedAt` set) — callers filter for
 * display but need the full set so deletions propagate instead of a stale
 * device re-uploading a deleted canvas.
 */
export async function cloudListCanvases(uid) {
    const snap = await getDocs(canvasesCol(uid));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    return list;
}

/** Parent metadata only (1 read — no drawing download), or null. */
export async function cloudGetCanvasMeta(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    return parent.exists() ? { id, ...parent.data() } : null;
}

/**
 * → { json, thumbs, meta } (kobin-1 JSON string, stored thumbnails, parent
 * metadata), or null. `meta.name` is authoritative over the name embedded in
 * the JSON — gallery renames only touch the parent doc.
 */
export async function cloudLoadCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return null;
    const meta = parent.data();
    const n = meta.parts || 0;
    const reads = [];
    for (let i = 0; i < n; i++) reads.push(getDoc(partDoc(uid, id, i)));
    const snaps = await Promise.all(reads);
    const parts = snaps.map((p) => {
        if (!p.exists()) return "";
        const d = p.data().data;
        return d && typeof d.toUint8Array === "function" ? d.toUint8Array() : d;
    });
    return {
        json: decodeCanvasPayload(parts, meta.codec),
        thumbs: meta.thumbs || null,
        meta: { id, ...meta },
    };
}

// ---- recycle bin (soft delete) ----
// Deleting tombstones the parent doc (`deletedAt`) and leaves the parts in
// place, so restore is a one-field write and other devices can both hide the
// canvas and move their local copy to their own recycle bin. A later full
// save (parent doc is a whole-doc set) clears the tombstone automatically —
// editing a canvas anywhere resurrects it.

export async function cloudTrashCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return false;
    await setDoc(canvasDoc(uid, id), { deletedAt: new Date().toISOString() }, { merge: true });
    return true;
}

export async function cloudRestoreCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return false;
    await setDoc(canvasDoc(uid, id), { deletedAt: null }, { merge: true });
    return true;
}

/**
 * Rename without re-uploading the drawing: parent-doc-only merge. `savedAt`
 * should match the local index bump so freshest-wins pulls stay symmetric.
 */
export async function cloudRenameCanvas(uid, id, name, savedAt = new Date().toISOString()) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return false;
    await setDoc(canvasDoc(uid, id), { name, savedAt }, { merge: true });
    return true;
}

// ---- presence heartbeat ("open on another device" warning) ----
// The editor stamps `editing: { device, at }` on the parent doc every 30s
// while a signed-in canvas is open in a visible tab. Another device seeing a
// fresh stamp that isn't its own shows the overwrite warning banner.

/** Stamp our heartbeat. Call only for canvases that already exist in cloud. */
export async function cloudSetEditing(uid, id, deviceId) {
    await setDoc(canvasDoc(uid, id), {
        editing: { device: deviceId, at: new Date().toISOString() },
    }, { merge: true });
}

/** Clear our heartbeat on exit — but never clobber another device's. */
export async function cloudClearEditing(uid, id, deviceId) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return;
    const cur = parent.data().editing;
    if (!cur || cur.device !== deviceId) return;
    await setDoc(canvasDoc(uid, id), { editing: null }, { merge: true });
}

export async function cloudDeleteCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    const n = parent.exists() ? parent.data().parts || 0 : 0;
    const batch = writeBatch(getDb());
    for (let i = 0; i < n; i++) batch.delete(partDoc(uid, id, i));
    batch.delete(canvasDoc(uid, id));
    await batch.commit();
}

export { LEGACY_CHUNK_CHARS };
