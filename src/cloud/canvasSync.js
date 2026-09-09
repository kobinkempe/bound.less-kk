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
import { compressToUint8Array, decompressFromUint8Array } from "./lzWorker";
import { compression, gunzipAs } from "./gzip";
import { packFrameChunk, unpackFrameChunk, packLogChunk, unpackLogChunk, splitParts } from "./store2";

const BIN_CHUNK_BYTES = 700 * 1024; // compressed binary chunk per part doc
// One part a commit. Six (4.2 MiB a batch, under the 10 MiB request cap) made Firestore's
// write stream answer "resource-exhausted: Write stream exhausted maximum allowed queued
// writes" on every batch of the 12,849-object canvas, serialised pushes included; the SDK
// then retried each batch a minute or two apart (2026-09-08, Kobin's Chrome).
const PARTS_PER_COMMIT = 1;
export const CANVAS_CODEC = "lz1";

const canvasesCol = (uid) => collection(getDb(), "users", uid, "canvases");
const canvasDoc = (uid, id) => doc(getDb(), "users", uid, "canvases", id);
const partDoc = (uid, id, i) => doc(getDb(), "users", uid, "canvases", id, "parts", String(i));

// ---- pure payload codec (unit-tested without Firestore) ----

function chunk(u8) {
    const chunks = [];
    for (let i = 0; i < u8.length; i += BIN_CHUNK_BYTES) {
        chunks.push(u8.subarray(i, i + BIN_CHUNK_BYTES));
    }
    if (chunks.length === 0) chunks.push(new Uint8Array(0));
    return { codec: CANVAS_CODEC, chunks };
}

/** kobin-1 JSON string → { codec, chunks: Uint8Array[] } (≥ 1 chunk). Synchronous; the tests' form. */
export function encodeCanvasPayload(json) {
    return chunk(LZString.compressToUint8Array(json || ""));
}

/**
 * The same, with the compression in a worker where there is one. The save
 * path uses this: on the phone the compressor was 97% of a multi-second
 * freeze (F33), and the 30 s background sync ran it on the main thread.
 */
export async function encodeCanvasPayloadAsync(json) {
    return chunk(await compressToUint8Array(json || ""));
}

/**
 * Stored parts (Uint8Array for lz1, strings for legacy) → kobin-1 JSON string.
 * `codec` comes from the parent doc; absent/unknown means legacy plain strings.
 */
export function decodeCanvasPayload(parts, codec) {
    if (codec === CANVAS_CODEC) return LZString.decompressFromUint8Array(joinParts(parts)) ?? "";
    return parts.map((p) => (typeof p === "string" ? p : "")).join("");
}

/** The same, decompressing in the worker. Opening a big drawing paid the freeze too. */
export async function decodeCanvasPayloadAsync(parts, codec) {
    if (codec === CANVAS_CODEC) return decompressFromUint8Array(joinParts(parts));
    return parts.map((p) => (typeof p === "string" ? p : "")).join("");
}

function joinParts(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const u8 = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { u8.set(p, off); off += p.length; }
    return u8;
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

const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * entry: { id, name, savedAt, levels, strokes }; json: kobin-1 JSON string;
 * thumbs (optional): { sceneId: { hash, data } } — merged over the stored set.
 * Resolves with timings for the perf log: { packMs, putMs, bytes, parts }.
 */
export async function cloudSaveCanvas(uid, entry, json, thumbs = null) {
    const t0 = perfNow();
    const { codec, chunks } = await encodeCanvasPayloadAsync(json);
    const tPack = perfNow();
    let bytes = 0;
    for (const c of chunks) bytes += c.length;

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
    return { packMs: +(tPack - t0).toFixed(1), putMs: +(perfNow() - tPack).toFixed(1), bytes, parts: chunks.length };
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
        json: await decodeCanvasPayloadAsync(parts, meta.codec),
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

// ---- the kobin-2 cloud copy (DESIGN.md §13; .claude/SAVE-FORMAT-PLAN.md) ----
//
//   users/{uid}/canvases/{id}                — the MANIFEST: format "kobin-2", codec,
//                                              meta/camera/crossings, frames {fid: {chunk,
//                                              parts, seq, bytes}}, log [{chunk, parts,
//                                              seqFrom, seqTo, bytes}], seq, device, and
//                                              the listing fields the gallery reads
//   users/{uid}/canvases/{id}/parts/{chunk~i} — one part of a gzipped chunk
//
// A push mirrors the local store: the frames whose stored snapshot is newer than the
// cloud's, the log entries past the cloud's seq, then the manifest, written LAST so a
// torn push never looks complete; parts a manifest no longer names are deleted after.
// A copy pushed by another device, or an old lz1 copy, is replaced whole.
export const FORMAT2_CLOUD = "kobin-2";
const DELETES_PER_COMMIT = 400;
const partDoc2 = (uid, id, chunkId, i) => doc(getDb(), "users", uid, "canvases", id, "parts", `${chunkId}~${i}`);
const chunkKey = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, (c) => c === "/" ? "." : c === "," ? "_" : "-");

async function commitAll(items, per, fn) {
    for (let i = 0; i < items.length; i += per) {
        const batch = writeBatch(getDb());
        for (const it of items.slice(i, i + per)) fn(batch, it);
        await batch.commit();
    }
}
/**
 * Push the local store's state. `source` = `{ header, readFrames(ids), readLog(fromSeq) }`
 * (storage/localCanvases.cloudPushSource); `entry` the listing fields; `deviceId` ours;
 * `dropBelow` the local compaction floor (log chunks wholly under it go). Resolves with
 * timings and counts for the perf log.
 */
export async function cloudPushCanvas2(uid, entry, source, { deviceId = "", thumbs = null, dropBelow = 0 } = {}) {
    const t0 = perfNow();
    const { header, readFrames, readLog } = source;
    const codec = compression();
    const prev = await getDoc(canvasDoc(uid, entry.id));
    const pm = prev.exists() ? prev.data() : null;
    const mirror = pm && pm.format === FORMAT2_CLOUD && pm.device === deviceId ? pm : null;
    const cloudFrames = mirror ? { ...(mirror.frames || {}) } : {};
    const cloudLog = mirror ? [...(mirror.log || [])] : [];
    const cloudSeq = mirror ? mirror.seq || 0 : 0;
    const localSeq = header.frameSeq || {};
    const frameIds = header.frameIds || [];
    const need = frameIds.filter((fid) => !cloudFrames[fid] || (cloudFrames[fid].seq || 0) < (localSeq[fid] || 0));
    const frames = need.length ? await readFrames(need) : [];
    const entries = await readLog(cloudSeq);
    const writes = [], deletes = [];
    const nextFrames = {};
    let bytes = 0;
    for (const fid of frameIds) if (cloudFrames[fid] && !need.includes(fid)) nextFrames[fid] = cloudFrames[fid];
    for (const f of frames) {
        const zipped = await codec.gzip(packFrameChunk(f));
        const parts = splitParts(zipped);
        const chunkId = `f_${chunkKey(f.frameId)}_${f.seq}`;
        parts.forEach((p, i) => writes.push({ ref: partDoc2(uid, entry.id, chunkId, i), data: { data: Bytes.fromUint8Array(p) } }));
        const old = cloudFrames[f.frameId];
        if (old && old.chunk !== chunkId) for (let i = 0; i < old.parts; i++) deletes.push(partDoc2(uid, entry.id, old.chunk, i));
        nextFrames[f.frameId] = { chunk: chunkId, parts: parts.length, seq: f.seq, bytes: zipped.length };
        bytes += zipped.length;
    }
    for (const fid of Object.keys(cloudFrames)) {
        if (frameIds.includes(fid)) continue;
        const old = cloudFrames[fid];
        for (let i = 0; i < old.parts; i++) deletes.push(partDoc2(uid, entry.id, old.chunk, i));
    }
    let nextLog = cloudLog;
    if (entries.length) {
        const zipped = await codec.gzip(packLogChunk(entries));
        const parts = splitParts(zipped);
        const chunkId = `l_${entries[0].seq}_${entries[entries.length - 1].seq}`;
        parts.forEach((p, i) => writes.push({ ref: partDoc2(uid, entry.id, chunkId, i), data: { data: Bytes.fromUint8Array(p) } }));
        nextLog = [...cloudLog, { chunk: chunkId, parts: parts.length, seqFrom: entries[0].seq, seqTo: entries[entries.length - 1].seq, bytes: zipped.length }];
        bytes += zipped.length;
    }
    if (dropBelow > 0) {
        nextLog = nextLog.filter((c) => {
            if (c.seqTo >= dropBelow) return true;
            for (let i = 0; i < c.parts; i++) deletes.push(partDoc2(uid, entry.id, c.chunk, i));
            return false;
        });
    }
    // A copy that is not our mirror is replaced whole: its parts go once the manifest is ours.
    if (pm && !mirror) {
        if (pm.format === FORMAT2_CLOUD) {
            for (const f of Object.values(pm.frames || {})) for (let i = 0; i < f.parts; i++) deletes.push(partDoc2(uid, entry.id, f.chunk, i));
            for (const c of pm.log || []) for (let i = 0; i < c.parts; i++) deletes.push(partDoc2(uid, entry.id, c.chunk, i));
        } else {
            for (let i = 0; i < (pm.parts || 0); i++) deletes.push(partDoc(uid, entry.id, i));
        }
    }
    const tPack = perfNow();
    await commitAll(writes, PARTS_PER_COMMIT, (b, w) => b.set(w.ref, w.data));
    const prevThumbs = pm ? pm.thumbs || null : null;
    const mergedThumbs = thumbs || prevThumbs ? boundedThumbs({ ...(prevThumbs || {}), ...(thumbs || {}) }) : null;
    let total = 0;
    for (const f of Object.values(nextFrames)) total += f.bytes || 0;
    for (const c of nextLog) total += c.bytes || 0;
    await setDoc(canvasDoc(uid, entry.id), {
        format: FORMAT2_CLOUD, codec: codec.name, device: deviceId,
        version: header.version || 1, meta: header.meta || {}, camera: header.camera || null, crossings: header.crossings || {},
        frameIds, frames: nextFrames, log: nextLog, seq: header.seq || 0,
        name: entry.name || "Untitled canvas",
        savedAt: entry.savedAt || new Date().toISOString(),
        levels: entry.levels || 0, strokes: entry.strokes || 0, size: total,
        ...(mergedThumbs ? { thumbs: mergedThumbs } : {}),
        ...(pm && pm.editing ? { editing: pm.editing } : {}),
    });
    await commitAll(deletes, DELETES_PER_COMMIT, (b, ref) => b.delete(ref));
    return { packMs: +(tPack - t0).toFixed(1), putMs: +(perfNow() - tPack).toFixed(1), bytes, frames: frames.length, entries: entries.length, parts: writes.length, deleted: deletes.length };
}
/**
 * The kobin-2 cloud copy as the local store's shape — `{ header, frames: { fid: {
 * objects, geo, seq } }, entries, thumbs, meta }` — or null when there is none or it
 * is not kobin-2 (`cloudLoadCanvas` reads those).
 */
export async function cloudLoadCanvas2(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return null;
    const m = parent.data();
    if (m.format !== FORMAT2_CLOUD) return null;
    const readChunk = async (c) => {
        const reads = [];
        for (let i = 0; i < c.parts; i++) reads.push(getDoc(partDoc2(uid, id, c.chunk, i)));
        const snaps = await Promise.all(reads);
        const parts = snaps.map((p) => { if (!p.exists()) throw new Error(`cloud copy is missing part ${c.chunk}~${snaps.indexOf(p)}`); return p.data().data.toUint8Array(); });
        return gunzipAs(m.codec, joinParts(parts));
    };
    const frames = {};
    for (const [fid, c] of Object.entries(m.frames || {})) {
        const f = unpackFrameChunk(await readChunk(c));
        frames[fid] = { objects: f.objects, geo: f.geo, seq: f.seq };
    }
    let entries = [];
    for (const c of (m.log || []).slice().sort((a, b) => a.seqFrom - b.seqFrom)) entries = entries.concat(unpackLogChunk(await readChunk(c)));
    const frameSeq = {};
    for (const [fid, c] of Object.entries(m.frames || {})) frameSeq[fid] = c.seq || 0;
    const header = {
        format: "boundless-drawing", version: m.version || 1, meta: m.meta || {}, camera: m.camera || null, crossings: m.crossings || {},
        name: m.name, seq: m.seq || 0, frameSeq, frameIds: Object.keys(frames), savedAt: m.savedAt,
    };
    return { header, frames, entries, thumbs: m.thumbs || null, meta: { id, ...m } };
}
