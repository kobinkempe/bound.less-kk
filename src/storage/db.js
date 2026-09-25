/**
 * db.js — the browser-side store, on IndexedDB.
 *
 * WHY NOT localStorage (F33, measured 2026-08-26). A drawing is a few hundred
 * perimeters, each a few hundred numbers, and every number written as JSON text
 * costs ~16 characters — 32 bytes in localStorage's UTF-16 — where a double
 * costs 8. Compressing that text back down was 97% of a 6.8 s save on the
 * phone, on the main thread, every ten seconds, and the whole origin still
 * shared a ~5 MB cap with 251 thumbnail keys. IndexedDB takes structured data
 * (the numbers stay doubles), has no 5 MB cap, and its writes are asynchronous.
 * So: no JSON.stringify, no lz-string, nothing to compress.
 *
 * SHAPE. One record per canvas HEADER (meta, camera, the frame lattice, and the
 * list of frame ids), and one record per FRAME holding that frame's natives.
 * A save writes only the frames that changed — the document already announces
 * every change with its frame id (`Document.subscribe`), so the dirty set is
 * free — plus the header, in one transaction, so a torn write cannot leave a
 * header pointing at frames that are not there. Thumbnails, the recycle-bin
 * payloads and the pre-pull backups have their own stores. The small things
 * that are read synchronously all over the shell — the gallery index, the
 * trash index, the device id — stay in localStorage; they are a few KB.
 *
 * Nothing here knows about the engine. `localCanvases.js` is the store's
 * public face and the only importer.
 */

import LZString from "lz-string";

export const DB_NAME = "boundless";
// Version 2 (2026-09-08, the kobin-2 store — DESIGN.md §13): a frame's natives as
// JSON headers plus one Float64Array of geometry (`frames2`), and an append-only
// op log (`log`); the v1 `frames` store stays so an old canvas opens, and its
// records go on the first full v2 write of that canvas.
export const DB_VERSION = 2;

let dbPromise = null;

export function idbAvailable() {
    try { return typeof indexedDB !== "undefined" && indexedDB != null; } catch (err) { return false; }
}

/** The one connection, opened on first use. Resolves null where IndexedDB is missing or refused. */
export function openDb() {
    if (dbPromise) return dbPromise;
    if (!idbAvailable()) { dbPromise = Promise.resolve(null); return dbPromise; }
    dbPromise = new Promise((resolve) => {
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) { resolve(null); return; }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("canvases")) db.createObjectStore("canvases", { keyPath: "id" });
            if (!db.objectStoreNames.contains("frames")) {
                const s = db.createObjectStore("frames", { keyPath: ["canvasId", "frameId"] });
                s.createIndex("byCanvas", "canvasId");
            }
            if (!db.objectStoreNames.contains("thumbs")) {
                const s = db.createObjectStore("thumbs", { keyPath: ["canvasId", "sceneId"] });
                s.createIndex("byCanvas", "canvasId");
                s.createIndex("byUsed", "usedAt");
            }
            if (!db.objectStoreNames.contains("trash")) db.createObjectStore("trash", { keyPath: "id" });
            if (!db.objectStoreNames.contains("backups")) db.createObjectStore("backups", { keyPath: "id" });
            if (!db.objectStoreNames.contains("frames2")) {
                const s = db.createObjectStore("frames2", { keyPath: ["canvasId", "frameId"] });
                s.createIndex("byCanvas", "canvasId");
            }
            if (!db.objectStoreNames.contains("log")) {
                const s = db.createObjectStore("log", { keyPath: ["canvasId", "seq"] });
                s.createIndex("byCanvas", "canvasId");
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            // A newer build in another tab wants to upgrade: let it.
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => { console.warn("bound.less: IndexedDB unavailable", req.error); resolve(null); };
    });
    return dbPromise;
}

/** Tests only: forget the cached connection (fake-indexeddb is reset between tests). */
export function _resetDbForTests() {
    if (dbPromise) dbPromise.then((db) => { try { db && db.close(); } catch (err) { /* ignore */ } });
    dbPromise = null;
}

const reqp = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
});

/**
 * Run `fn(...stores)` inside one transaction and resolve with its value once
 * the transaction commits. `fn` may be async, but every request it issues
 * after an `await` must follow directly from a request that just completed —
 * an IndexedDB transaction auto-commits the moment it has nothing in flight.
 * Resolves null (does nothing) where there is no database.
 */
export async function tx(names, mode, fn) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        let t;
        try { t = db.transaction(names, mode); } catch (err) { reject(err); return; }
        let out;
        let failed = null;
        t.oncomplete = () => (failed ? reject(failed) : resolve(out));
        t.onerror = () => { failed = failed || t.error; };
        t.onabort = () => reject(failed || t.error || new Error("IndexedDB transaction aborted"));
        const stores = names.map((n) => t.objectStore(n));
        try {
            const r = fn(...stores);
            if (r && typeof r.then === "function") {
                r.then((v) => { out = v; }, (err) => { failed = err; try { t.abort(); } catch (e2) { /* already done */ } });
            } else out = r;
        } catch (err) {
            failed = err;
            try { t.abort(); } catch (e2) { /* already done */ }
        }
    });
}

const only = (v) => IDBKeyRange.only(v);

// ---- canvases: one header + one record per frame ----

/**
 * Write a canvas. `header` is the kobin-1 envelope without `natives`, plus
 * whatever listing fields the caller wants kept with it (name, strokes,
 * levels, savedAt). `frames` maps frame id -> that frame's serialized natives;
 * `frameIds` is the FULL current set. With `full` false only `frames` are
 * written and frames that left the set since the last write are deleted;
 * with `full` true the stored set is made to match exactly.
 *
 * Returns false — writing nothing — when asked for an incremental write of a
 * canvas that has no header on disk: the frames not in `frames` would be
 * missing, and a header that lists frames the store does not hold is a
 * drawing that loads with holes. The caller retries as a full write.
 */
export function putCanvas(id, { header, frames, frameIds, full }) {
    return tx(["canvases", "frames"], "readwrite", async (canvases, store) => {
        const prev = await reqp(canvases.get(id));
        if (!prev && !full) return false;
        const now = new Set(frameIds);
        if (full) {
            const keys = await reqp(store.index("byCanvas").getAllKeys(only(id)));
            for (const k of keys) if (!now.has(k[1])) store.delete(k);
        } else {
            for (const fid of prev.frameIds || []) if (!now.has(fid)) store.delete([id, fid]);
        }
        for (const fid of Object.keys(frames || {})) {
            store.put({ canvasId: id, frameId: fid, objects: frames[fid] });
        }
        canvases.put({
            ...header,
            id,
            frameIds: [...frameIds],
            savedAt: header.savedAt || new Date().toISOString(),
        });
        return true;
    });
}


function headerToDoc(h, natives) {
    const doc = { format: h.format, version: h.version, meta: h.meta, camera: h.camera, crossings: h.crossings, natives };
    return doc;
}

/** Header only (no frames read) — listing fields and meta. */
export function getCanvasHeader(id) {
    return tx(["canvases"], "readonly", (canvases) => reqp(canvases.get(id)));
}

export function listCanvasHeaders() {
    return tx(["canvases"], "readonly", (canvases) => reqp(canvases.getAll())).then((l) => l || []);
}

/**
 * Rewrite the header through `fn(header) -> header`; no frames touched. With `writer`, refused
 * ("fenced") when another tab holds the store (SYNC-PLAN R2); without one (the gallery) it is not.
 */
export function patchCanvasHeader(id, fn, writer = null) {
    return tx(["canvases"], "readwrite", async (canvases) => {
        const h = await reqp(canvases.get(id));
        if (!h) return false;
        if (writer != null && h.writer && h.writer !== writer) return "fenced";
        canvases.put({ ...fn(h), id });
        return true;
    });
}

export function deleteCanvas(id) {
    return tx(["canvases", "frames", "frames2", "log"], "readwrite", async (canvases, store, frames2, log) => {
        canvases.delete(id);
        for (const s of [store, frames2, log]) {
            const keys = await reqp(s.index("byCanvas").getAllKeys(only(id)));
            for (const k of keys) s.delete(k);
        }
        return true;
    });
}
/** Frame and log records whose canvas header is gone (a torn delete). Returns how many went. */
export function deleteOrphanFrames() {
    return tx(["canvases", "frames", "frames2", "log"], "readwrite", async (canvases, store, frames2, log) => {
        const ids = new Set(await reqp(canvases.getAllKeys()));
        let n = 0;
        for (const s of [store, frames2, log]) {
            const keys = await reqp(s.getAllKeys());
            for (const k of keys) if (!ids.has(k[0])) { s.delete(k); n++; }
        }
        return n;
    }).then((n) => n || 0);
}

// ---- the kobin-2 store: snapshots per frame plus the op log ----
// A frame record: { canvasId, frameId, seq, objects, geo: ArrayBuffer }; a log record:
// { canvasId, seq, t, op, geo: ArrayBuffer | null, touches }. The header carries
// `store: "kobin-2"`, `frameSeq` (frame id -> seq of its snapshot) and `seq` (the last
// entry). Buffers are stored as they are: a structured clone of one is a copy of bytes.
const bufferOf = (geo) => (geo.byteOffset === 0 && geo.byteLength === geo.buffer.byteLength
    ? geo.buffer : geo.buffer.slice(geo.byteOffset, geo.byteOffset + geo.byteLength));
export const STORE_V2 = "kobin-2";
// The sync's bookkeeping in the header (SYNC-PLAN R1/R3): `base` the cloud head last pulled or
// pushed, `intent` the head a push is committing, `pending` its chunks not yet confirmed, `writer`
// the tab holding the store. The saver's header never names them, so every write carries them.
export const SYNC_FIELDS = ["base", "intent", "pending", "writer"];

/**
 * Write a canvas in the kobin-2 store, in one transaction: the header, the frames in
 * `snapshots` ({ frameId: { objects, geo, seq } }), the new log `entries` (ascending
 * seq), and — with `dropBelow` — the entries older than it, gone. `frameIds` is the full
 * current set. `full` makes the stored frame set match exactly and deletes the canvas's
 * v1 frame records (the first v2 write of a migrated canvas); `resetLog` empties the log
 * first (a document that started over). Returns false, writing nothing, for an
 * incremental write of a canvas with no header on disk; "fenced" when `writer` is not the tab
 * holding the store (SYNC-PLAN R2); "stale" when the header's seq is behind the stored one and
 * `rewind` is not set (a document the store was pulled into under must not overwrite it; only a
 * whole-document write or a pull rewinds).
 */
export function putCanvas2(id, { header, snapshots = {}, frameIds, entries = [], full = false, resetLog = false, dropBelow = 0, writer = null, rewind = false }) {
    return tx(["canvases", "frames", "frames2", "log"], "readwrite", async (canvases, v1, frames2, log) => {
        const prev = await reqp(canvases.get(id));
        if (!prev && !full) return false;
        if (prev && writer != null && prev.writer && prev.writer !== writer) return "fenced";
        if (prev && !rewind && prev.store === STORE_V2 && (header.seq || 0) < (prev.seq || 0)) return "stale";
        const now = new Set(frameIds);
        const frameSeq = { ...((prev && prev.store === STORE_V2 && prev.frameSeq) || {}) };
        if (full) {
            for (const k of await reqp(frames2.index("byCanvas").getAllKeys(only(id)))) if (!now.has(k[1])) frames2.delete(k);
            for (const k of await reqp(v1.index("byCanvas").getAllKeys(only(id)))) v1.delete(k);
        } else if (prev.frameIds) {
            for (const fid of prev.frameIds) if (!now.has(fid)) frames2.delete([id, fid]);
        }
        for (const fid of Object.keys(frameSeq)) if (!now.has(fid)) delete frameSeq[fid];
        if (resetLog) {
            for (const k of await reqp(log.index("byCanvas").getAllKeys(only(id)))) log.delete(k);
        } else if (dropBelow > 0) {
            log.delete(IDBKeyRange.bound([id, 0], [id, dropBelow], false, true));
        }
        for (const fid of Object.keys(snapshots)) {
            const s = snapshots[fid];
            frames2.put({ canvasId: id, frameId: fid, seq: s.seq || 0, objects: s.objects, geo: bufferOf(s.geo) });
            frameSeq[fid] = s.seq || 0;
        }
        for (const e of entries) {
            log.put({ canvasId: id, seq: e.seq, t: e.t, op: e.op, geo: e.geo && e.geo.length ? bufferOf(e.geo) : null, touches: e.touches || [] });
        }
        const sync = {};
        if (prev) for (const k of SYNC_FIELDS) if (prev[k] !== undefined && !(k in header)) sync[k] = prev[k];
        if (writer != null) sync.writer = writer;
        canvases.put({
            ...sync,
            ...header,
            id,
            store: STORE_V2,
            frameIds: [...frameIds],
            frameSeq,
            seq: header.seq || 0,
            savedAt: header.savedAt || new Date().toISOString(),
        });
        return true;
    });
}
/**
 * The stored canvas: `{ header, frames: [{ frameId, seq, objects, geo: Float64Array }],
 * entries: [{ seq, t, op, geo: Float64Array | null, touches }] }` for a kobin-2 canvas,
 * `{ legacy: kobin1Doc }` for one the v1 store holds, or null.
 */
export function getCanvas2(id) {
    return tx(["canvases", "frames", "frames2", "log"], "readonly", async (canvases, v1, frames2, log) => {
        const h = await reqp(canvases.get(id));
        if (!h) return null;
        if (h.store !== STORE_V2) {
            const recs = await reqp(v1.index("byCanvas").getAll(only(id)));
            const natives = {};
            for (const r of recs) natives[r.frameId] = r.objects;
            return { legacy: headerToDoc(h, natives) };
        }
        const frames = (await reqp(frames2.index("byCanvas").getAll(only(id)))).map((r) => ({
            frameId: r.frameId, seq: r.seq || 0, objects: r.objects, geo: new Float64Array(r.geo),
        }));
        const entries = (await reqp(log.index("byCanvas").getAll(only(id))))
            .map((r) => ({ seq: r.seq, t: r.t, op: r.op, geo: r.geo ? new Float64Array(r.geo) : new Float64Array(0), touches: r.touches || [] }))
            .sort((a, b) => a.seq - b.seq);
        return { header: h, frames, entries };
    });
}

/**
 * Copy a stored canvas, every record, to `toId` in one transaction (a conflict's copy, R5):
 * the header through `patch(header)`, the frames and the log as they are. False when `fromId`
 * has no header.
 */
export function copyCanvas2(fromId, toId, patch = (h) => h) {
    return tx(["canvases", "frames", "frames2", "log"], "readwrite", async (canvases, v1, frames2, log) => {
        const h = await reqp(canvases.get(fromId));
        if (!h) return false;
        for (const s of [v1, frames2, log]) {
            const recs = await reqp(s.index("byCanvas").getAll(only(fromId)));
            for (const r of recs) s.put({ ...r, canvasId: toId });
        }
        canvases.put({ ...patch({ ...h }), id: toId });
        return true;
    }).then((ok) => ok === true);
}

// ---- whole-canvas reads and copies in short transactions ----
// A transaction's scope is a store, not a canvas: one that reads or copies a whole canvas blocks
// every read-write on these stores across the origin while it runs. Measured 2026-09-22 in Chrome
// on a store the size of the Magnum Opus (60 frames, 42,856 objects, 60 MB of geometry): a
// one-transaction read 400–500 ms and a copy 1.4 s, a small write elsewhere waiting all of it;
// one frame per transaction, 25 ms at most, the small write waiting 1–3 ms.

// The header's fingerprint: every write changes `savedAt`.
const stamp = (h) => (h ? `${h.seq}|${h.savedAt}|${JSON.stringify(h.frameSeq || {})}|${(h.frameIds || []).join(",")}` : "");

/**
 * getCanvas2 one frame per transaction. The header is read again at the end; a store written in
 * between is read again (three tries), then in one transaction. `onChunk` is for tests.
 */
export async function getCanvas2Chunked(id, { onChunk = null } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const h = await tx(["canvases"], "readonly", (c) => reqp(c.get(id)));
        if (!h) return null;
        if (h.store !== STORE_V2) return getCanvas2(id);
        const frames = [];
        for (const fid of h.frameIds || []) {
            const r = await tx(["frames2"], "readonly", (f) => reqp(f.get([id, fid])));
            if (r) frames.push({ frameId: r.frameId, seq: r.seq || 0, objects: r.objects, geo: new Float64Array(r.geo) });
            if (onChunk) await onChunk();
        }
        const logs = await tx(["log"], "readonly", (l) => reqp(l.index("byCanvas").getAll(only(id))));
        const h2 = await tx(["canvases"], "readonly", (c) => reqp(c.get(id)));
        if (stamp(h2) !== stamp(h)) continue;
        const entries = (logs || [])
            .map((r) => ({ seq: r.seq, t: r.t, op: r.op, geo: r.geo ? new Float64Array(r.geo) : new Float64Array(0), touches: r.touches || [] }))
            .sort((a, b) => a.seq - b.seq);
        return { header: h2, frames, entries };
    }
    return getCanvas2(id);
}
/**
 * copyCanvas2 one frame per transaction, the header LAST (a copy torn midway has no header, and
 * the gallery's sweep deletes its records: deleteOrphanFrames). The source must not change
 * meanwhile (the session holds its pen and has the saver off); if it did, the copy is made again
 * in one transaction. True when the copy landed.
 */
export async function copyCanvas2Chunked(fromId, toId, patch = (h) => h) {
    const h = await tx(["canvases"], "readonly", (c) => reqp(c.get(fromId)));
    if (!h) return false;
    if (h.store !== STORE_V2) return copyCanvas2(fromId, toId, patch);
    for (const fid of h.frameIds || []) {
        await tx(["frames2"], "readwrite", async (f) => {
            const r = await reqp(f.get([fromId, fid]));
            if (r) f.put({ ...r, canvasId: toId });
        });
    }
    await tx(["log"], "readwrite", async (l) => {
        for (const r of await reqp(l.index("byCanvas").getAll(only(fromId)))) l.put({ ...r, canvasId: toId });
    });
    const ok = await tx(["canvases"], "readwrite", async (c) => {
        const cur = await reqp(c.get(fromId));
        if (stamp(cur) !== stamp(h)) return false;
        c.put({ ...patch({ ...cur }), id: toId });
        return true;
    });
    if (ok === true) return true;
    await deleteCanvas(toId);
    return copyCanvas2(fromId, toId, patch);
}

// ---- trash + backups: whole documents ----

export function putTrashDoc(id, doc, deletedAt = new Date().toISOString()) {
    return tx(["trash"], "readwrite", (trash) => { trash.put({ id, doc, deletedAt }); return true; });
}
export function getTrashDoc(id) {
    return tx(["trash"], "readonly", (trash) => reqp(trash.get(id))).then((r) => (r ? r.doc : null));
}
export function deleteTrashDoc(id) {
    return tx(["trash"], "readwrite", (trash) => { trash.delete(id); return true; });
}
export function listTrashIds() {
    return tx(["trash"], "readonly", (trash) => reqp(trash.getAllKeys())).then((l) => l || []);
}

export function putBackup(id, doc, at = new Date().toISOString()) {
    return tx(["backups"], "readwrite", (b) => { b.put({ id, doc, at }); return true; });
}
export function getBackup(id) {
    return tx(["backups"], "readonly", (b) => reqp(b.get(id))).then((r) => (r ? r.doc : null));
}
/** Drop backups older than `maxAgeMs`. Returns how many went. */
export function sweepBackups(maxAgeMs) {
    return tx(["backups"], "readwrite", async (b) => {
        const all = await reqp(b.getAll());
        const cutoff = Date.now() - maxAgeMs;
        let n = 0;
        for (const r of all) {
            const t = Date.parse(r.at);
            if (!Number.isFinite(t) || t < cutoff) { b.delete(r.id); n++; }
        }
        return n;
    }).then((n) => n || 0);
}

// ---- thumbnails: JPEG bytes, LRU under a hard budget ----
// Stored as { canvasId, sceneId, hash, type, bytes: ArrayBuffer, size, usedAt }.
// Bytes rather than a Blob so the record clones identically in every
// IndexedDB, the test double included; rather than a data URL because base64
// is a third bigger and the old UTF-16 keys were 2.7x the image.

/** A hard ceiling on what thumbnails may hold. They are derived data: over it, the least recently used go first. */
export const THUMB_BUDGET_BYTES = 12 * 1024 * 1024;

export function dataUrlToBytes(dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
    if (!m) return null;
    const type = m[1] || "application/octet-stream";
    if (!m[2]) {
        const s = decodeURIComponent(m[3]);
        const u8 = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
        return { type, bytes: u8.buffer };
    }
    const bin = atob(m[3]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { type, bytes: u8.buffer };
}

export function bytesToDataUrl(type, bytes) {
    const u8 = new Uint8Array(bytes);
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return `data:${type};base64,` + btoa(bin);
}

/** `map`: { sceneId: { hash, data: dataURL } }. Writes, then trims to the budget. */
export function putThumbs(canvasId, map) {
    const now = Date.now();
    return tx(["thumbs"], "readwrite", async (thumbs) => {
        for (const [sid, t] of Object.entries(map || {})) {
            if (!t || typeof t.data !== "string") continue;
            const b = dataUrlToBytes(t.data);
            if (!b) continue;
            thumbs.put({ canvasId, sceneId: sid, hash: t.hash || "", type: b.type, bytes: b.bytes, size: b.bytes.byteLength, usedAt: now });
        }
        await trimThumbs(thumbs, THUMB_BUDGET_BYTES);
        return true;
    });
}

/** Evict least-recently-used thumbnails until the store is under `budget` bytes. */
async function trimThumbs(thumbs, budget) {
    const all = await reqp(thumbs.getAll());
    let total = 0;
    for (const r of all) total += r.size || 0;
    if (total <= budget) return 0;
    all.sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0));
    let n = 0;
    for (const r of all) {
        if (total <= budget) break;
        thumbs.delete([r.canvasId, r.sceneId]);
        total -= r.size || 0;
        n++;
    }
    return n;
}

/** { sceneId: { hash, data: dataURL } } for the requested scenes; touches usedAt on the ones found. */
export function getThumbs(canvasId, sceneIds) {
    const now = Date.now();
    return tx(["thumbs"], "readwrite", async (thumbs) => {
        const out = {};
        const recs = await Promise.all(sceneIds.map((sid) => reqp(thumbs.get([canvasId, sid]))));
        for (const r of recs) {
            if (!r) continue;
            out[r.sceneId] = { hash: r.hash || "", data: bytesToDataUrl(r.type, r.bytes) };
            thumbs.put({ ...r, usedAt: now });
        }
        return out;
    }).then((o) => o || {});
}

export function deleteThumbs(canvasId) {
    return tx(["thumbs"], "readwrite", async (thumbs) => {
        const keys = await reqp(thumbs.index("byCanvas").getAllKeys(only(canvasId)));
        for (const k of keys) thumbs.delete(k);
        return keys.length;
    }).then((n) => n || 0);
}

/** Delete every thumbnail whose canvas is not in `keepIds`, then trim to `budget`. */
export function sweepThumbs(keepIds, budget = THUMB_BUDGET_BYTES) {
    const keep = new Set(keepIds);
    return tx(["thumbs"], "readwrite", async (thumbs) => {
        const keys = await reqp(thumbs.getAllKeys());
        let n = 0;
        for (const k of keys) if (!keep.has(k[0])) { thumbs.delete(k); n++; }
        n += await trimThumbs(thumbs, budget);
        return n;
    }).then((n) => n || 0);
}

export function thumbBytesTotal() {
    return tx(["thumbs"], "readonly", async (thumbs) => {
        const all = await reqp(thumbs.getAll());
        let total = 0;
        for (const r of all) total += r.size || 0;
        return total;
    }).then((n) => n || 0);
}

// ---- the old localStorage slots: read once, moved, deleted ----
// Everything the app used to keep in localStorage besides the two indexes and
// the device id. `packSlot`/`unpackSlot` are the lz-string form those slots
// were written in; they exist now only to read them and for the cloud codec's
// tests.

const SLOT_LZ_PREFIX = "lz1:";
export function packSlot(json) { return SLOT_LZ_PREFIX + LZString.compressToUTF16(json); }
export function unpackSlot(raw) {
    if (raw == null) return null;
    if (raw.startsWith(SLOT_LZ_PREFIX)) return LZString.decompressFromUTF16(raw.slice(SLOT_LZ_PREFIX.length));
    return raw;
}

export const MIGRATED_FLAG = "kobin.idb.migrated";

/**
 * Move every document, trash payload and thumbnail out of localStorage into
 * the database, then delete the keys — including the ones nothing reads any
 * more (`boundlessDrawing:*` from the deleted CanvasV2 page, `kobinSnapshot`,
 * the `.bak` copies). Runs once; a key that will not parse is left in place
 * and named in the console rather than thrown away. `docToRecord(doc)` turns
 * a kobin-1 document into the {header, frames, frameIds} `putCanvas` takes —
 * it lives with the store's public face, so it is passed in.
 */
export async function migrateLocalStorage(docToRecord) {
    let flagged = false;
    try { flagged = !!localStorage.getItem(MIGRATED_FLAG); } catch (err) { return { skipped: true }; }
    if (flagged) return { skipped: true };
    const db = await openDb();
    if (!db) return { skipped: true };
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    const out = { canvases: 0, trash: 0, thumbs: 0, removed: 0, failed: [] };
    const remove = (k) => { try { localStorage.removeItem(k); out.removed++; } catch (err) { /* ignore */ } };
    const thumbBatches = {};
    for (const k of keys) {
        if (!k) continue;
        try {
            if (k.startsWith("kobin.canvas.")) {
                if (k.endsWith(".bak")) { remove(k); continue; }
                const id = k.slice("kobin.canvas.".length);
                const doc = JSON.parse(unpackSlot(localStorage.getItem(k)));
                await putCanvas(id, { ...docToRecord(doc), full: true });
                out.canvases++;
                remove(k);
            } else if (k.startsWith("kobin.trash.")) {
                const id = k.slice("kobin.trash.".length);
                const doc = JSON.parse(unpackSlot(localStorage.getItem(k)));
                await putTrashDoc(id, doc);
                out.trash++;
                remove(k);
            } else if (k.startsWith("kobin.thumb.")) {
                const rest = k.slice("kobin.thumb.".length);
                const dot = rest.indexOf(".");
                if (dot < 0) { remove(k); continue; }
                const cid = rest.slice(0, dot), sid = rest.slice(dot + 1);
                const t = JSON.parse(localStorage.getItem(k));
                if (t && typeof t.data === "string") (thumbBatches[cid] = thumbBatches[cid] || {})[sid] = t;
                out.thumbs++;
                remove(k);
            } else if (k.startsWith("boundlessDrawing") || k === "kobinSnapshot") {
                remove(k);
            }
        } catch (err) {
            out.failed.push(k);
        }
    }
    for (const [cid, map] of Object.entries(thumbBatches)) {
        try { await putThumbs(cid, map); } catch (err) { out.failed.push("thumbs:" + cid); }
    }
    if (out.failed.length) console.warn("bound.less: left in localStorage, could not be read:", out.failed);
    try { localStorage.setItem(MIGRATED_FLAG, new Date().toISOString()); } catch (err) { /* next load retries */ }
    return out;
}

// ---- quota ----

/** { usage, quota } in bytes from the browser, or null where it will not say. */
export async function storageEstimate() {
    try {
        if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate) return null;
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (err) { return null; }
}

/**
 * Ask the browser not to evict this origin's storage under pressure. Chrome
 * grants it silently by engagement; Firefox prompts; Safari ignores it. A
 * signed-out user's drawings exist nowhere else, so the ask is worth making.
 */
export async function requestPersistentStorage() {
    try {
        if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return false;
        if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch (err) { return false; }
}

/**
 * What a push sends, read in ONE transaction so the header, the frames and the entries agree:
 * the header, the frames whose stored seq differs from `cloudFrameSeq` (frame id -> seq), and the
 * entries in (`fromSeq`, header.seq]. Null for a canvas not in the kobin-2 store.
 */
export function readPushState(id, cloudFrameSeq, fromSeq) {
    return tx(["canvases", "frames2", "log"], "readonly", async (canvases, frames2, log) => {
        const header = await reqp(canvases.get(id));
        if (!header || header.store !== STORE_V2) return null;
        const localSeq = header.frameSeq || {};
        const need = (header.frameIds || []).filter((fid) => !(fid in cloudFrameSeq) || cloudFrameSeq[fid] !== (localSeq[fid] || 0));
        const recs = (await Promise.all(need.map((fid) => reqp(frames2.get([id, fid]))))).filter(Boolean);
        const top = header.seq || 0;
        const logs = top > fromSeq ? await reqp(log.getAll(IDBKeyRange.bound([id, fromSeq], [id, top], true, false))) : [];
        return {
            header,
            frames: recs.map((r) => ({ frameId: r.frameId, seq: r.seq || 0, objects: r.objects, geo: new Float64Array(r.geo) })),
            entries: logs.map((r) => ({ seq: r.seq, t: r.t, op: r.op, geo: r.geo ? new Float64Array(r.geo) : new Float64Array(0), touches: r.touches || [] }))
                .sort((a, b) => a.seq - b.seq),
        };
    });
}
