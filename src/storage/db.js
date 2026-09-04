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
export const DB_VERSION = 1;

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

/** The stored kobin-1 document, reassembled, or null. */
export function getCanvas(id) {
    return tx(["canvases", "frames"], "readonly", async (canvases, store) => {
        const h = await reqp(canvases.get(id));
        if (!h) return null;
        const recs = await reqp(store.index("byCanvas").getAll(only(id)));
        const natives = {};
        for (const r of recs) natives[r.frameId] = r.objects;
        return headerToDoc(h, natives);
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

/** Rewrite the header through `fn(header) -> header`; no frames touched. */
export function patchCanvasHeader(id, fn) {
    return tx(["canvases"], "readwrite", async (canvases) => {
        const h = await reqp(canvases.get(id));
        if (!h) return false;
        canvases.put({ ...fn(h), id });
        return true;
    });
}

export function deleteCanvas(id) {
    return tx(["canvases", "frames"], "readwrite", async (canvases, store) => {
        canvases.delete(id);
        const keys = await reqp(store.index("byCanvas").getAllKeys(only(id)));
        for (const k of keys) store.delete(k);
        return true;
    });
}

/** Frame records whose canvas header is gone (a torn delete). Returns how many went. */
export function deleteOrphanFrames() {
    return tx(["canvases", "frames"], "readwrite", async (canvases, store) => {
        const ids = new Set(await reqp(canvases.getAllKeys()));
        const keys = await reqp(store.getAllKeys());
        let n = 0;
        for (const k of keys) if (!ids.has(k[0])) { store.delete(k); n++; }
        return n;
    }).then((n) => n || 0);
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
export function deleteBackup(id) {
    return tx(["backups"], "readwrite", (b) => { b.delete(id); return true; });
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
