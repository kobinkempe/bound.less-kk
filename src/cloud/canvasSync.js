/**
 * Firestore persistence for canvases, under `users/{uid}/<col>` — `canvases` for the deployed
 * app, `dev-canvases` for a development build (R7 below). Two formats: kobin-2 (the manifest
 * and its chunk parts, at the end of this file) and the old lz1 copy:
 *
 *   users/{uid}/<col>/{canvasId}         — { name, savedAt, levels, strokes, size, parts, codec }
 *   users/{uid}/<col>/{canvasId}/parts/{i} — { data: Bytes (lz1) | string (legacy) }
 *
 * The kobin-1 JSON is lz-string compressed (codec "lz1") and stored as binary
 * chunks under the parent doc: a Firestore document caps at 1 MiB, and a single
 * commit at ~10 MiB — so parts are chunked at 700 KiB and committed in groups,
 * with the parent doc written LAST (readers key off parent.parts/codec, so a
 * torn save never looks complete). Legacy plain-string parts still load.
 * Metadata stays on the parent so gallery listing never downloads drawings.
 */
import {
    collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, runTransaction, onSnapshot, Bytes,
} from "firebase/firestore";
import LZString from "lz-string";
import { getDb } from "./firebaseApp";
import { compressToUint8Array, decompressFromUint8Array } from "./lzWorker";
import { compression, gunzipAs } from "./gzip";
import { packFrameChunk, unpackFrameChunk, packLogChunk, unpackLogChunk, splitParts, joinParts } from "./store2";
import { docFromStore } from "../storage/foldStore";
import { headOf, sameHead, leaseState, intentLanded, newEpoch, LEASE_TTL_MS, LEASE_SKEW_MS } from "./syncCore";

const BIN_CHUNK_BYTES = 700 * 1024; // compressed binary chunk per part doc
// One part a commit. Six (4.2 MiB a batch, under the 10 MiB request cap) made Firestore's
// write stream answer "resource-exhausted: Write stream exhausted maximum allowed queued
// writes" on every batch of the 12,849-object canvas, serialised pushes included; the SDK
// then retried each batch a minute or two apart (2026-09-08, Kobin's Chrome).
const PARTS_PER_COMMIT = 1;
export const CANVAS_CODEC = "lz1";

// ---- where the copy lives (SYNC-PLAN R7) ----
// Only a production build on the deployed app's own hosts touches `canvases`; every other build or
// host (the dev server, a test, localhost, a LAN IP, *.localhost, a Hosting preview channel) reads
// and writes `users/{uid}/dev-canvases`. The dev server and the deployed app share one Firebase
// project. Every builder below uses CANVAS_COLLECTION; the real collection is reachable for reads
// only (`realCanvasDoc`).
export const REAL_COLLECTION = "canvases";
export const DEV_COLLECTION = "dev-canvases";
export const REAL_HOSTS = ["bound-less-kk.web.app", "bound-less-kk.firebaseapp.com"];
export function isDevBuild(env = process.env.NODE_ENV, host = typeof window !== "undefined" && window.location ? window.location.hostname : "") {
    return env !== "production" || !REAL_HOSTS.includes(String(host || "").toLowerCase());
}
export const CANVAS_COLLECTION = isDevBuild() ? DEV_COLLECTION : REAL_COLLECTION;

const canvasesCol = (uid) => collection(getDb(), "users", uid, CANVAS_COLLECTION);
const canvasDoc = (uid, id) => doc(getDb(), "users", uid, CANVAS_COLLECTION, id);
const partDoc = (uid, id, i) => doc(getDb(), "users", uid, CANVAS_COLLECTION, id, "parts", String(i));
// Reads of the real collection from a dev build (the dev panel's copy-in). Never written through.
const realCanvasDoc = (uid, id) => doc(getDb(), "users", uid, REAL_COLLECTION, id);
const realPartDoc2 = (uid, id, chunkId, i) => doc(getDb(), "users", uid, REAL_COLLECTION, id, "parts", `${chunkId}~${i}`);

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
 * The old lz1 copy, for a canvas still in the v1 local store. entry: { id, name, savedAt, levels,
 * strokes }; json: kobin-1 JSON string; thumbs (optional): { sceneId: { hash, data } } — merged
 * over the stored set. Refuses (SyncConflict) to write over a kobin-2 copy. Runs in the page's
 * one push lane. Resolves with timings for the perf log: { packMs, putMs, bytes, parts }.
 */
export function cloudSaveCanvas(uid, entry, json, thumbs = null, { laneMs = LANE_MS } = {}) {
    return inLane((run) => saveCanvasLz1(uid, entry, json, thumbs, run), { ms: laneMs });
}
async function saveCanvasLz1(uid, entry, json, thumbs, run) {
    const t0 = perfNow();
    const { codec, chunks } = await encodeCanvasPayloadAsync(json);
    const tPack = perfNow();
    let bytes = 0;
    for (const c of chunks) bytes += c.length;

    const prev = await getDoc(canvasDoc(uid, entry.id));
    if (prev.exists() && prev.data().format === FORMAT2_CLOUD) throw new SyncConflict("a kobin-2 copy exists", headOf(prev.data()));
    const prevThumbs = prev.exists() ? prev.data().thumbs || null : null;
    const mergedThumbs = thumbs || prevThumbs
        ? boundedThumbs({ ...(prevThumbs || {}), ...(thumbs || {}) })
        : null;

    // Parts first, one a commit (a huge drawing overflows one batch's ~10 MiB request cap), each
    // marking progress on the push lane; let go past its deadline, it writes nothing more.
    for (let start = 0; start < chunks.length; start += PARTS_PER_COMMIT) {
        if (run.dead) throw pushDead();
        run.tick();
        const batch = writeBatch(getDb());
        chunks.slice(start, start + PARTS_PER_COMMIT).forEach((data, j) => {
            batch.set(partDoc(uid, entry.id, start + j), { data: Bytes.fromUint8Array(data) });
        });
        await batch.commit();
    }

    // Parent last, in a transaction that refuses a kobin-2 copy written meanwhile: readers only
    // trust parts/codec published here.
    await runTransaction(getDb(), async (t) => {
        const snap = await t.get(canvasDoc(uid, entry.id));
        const cur = snap.exists() ? snap.data() : null;
        if (cur && cur.format === FORMAT2_CLOUD) throw new SyncConflict("a kobin-2 copy exists", headOf(cur));
        t.set(canvasDoc(uid, entry.id), {
            name: entry.name || "Untitled canvas",
            savedAt: entry.savedAt || new Date().toISOString(),
            levels: entry.levels || 0,
            strokes: entry.strokes || 0,
            size: json.length,
            parts: chunks.length,
            codec,
            ...(mergedThumbs ? { thumbs: mergedThumbs } : {}),
        });
        for (let i = chunks.length; i < ((cur && cur.parts) || 0); i++) t.delete(partDoc(uid, entry.id, i));
    });
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
 * the JSON — gallery renames only touch the parent doc. A kobin-2 copy is
 * pulled whole and folded, its log tail included (F86).
 */
export async function cloudLoadCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    if (!parent.exists()) return null;
    const meta = parent.data();
    if (meta.format === FORMAT2_CLOUD) {
        const pulled = await cloudPullCanvas2(uid, id);
        const doc = pulled && docFromStore(pulled);
        return doc ? { json: JSON.stringify(doc), thumbs: meta.thumbs || null, meta: { id, ...meta } } : null;
    }
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

export async function cloudDeleteCanvas(uid, id) {
    const parent = await getDoc(canvasDoc(uid, id));
    const m = parent.exists() ? parent.data() : null;
    const refs = [];
    if (m && m.format === FORMAT2_CLOUD) for (const c of chunksOf(m)) for (let i = 0; i < c.parts; i++) refs.push(partDoc2(uid, id, c.chunk, i));
    else for (let i = 0; i < ((m && m.parts) || 0); i++) refs.push(partDoc(uid, id, i));
    await commitAll(refs, DELETES_PER_COMMIT, (b, ref) => b.delete(ref));
    await deleteDoc(canvasDoc(uid, id));
}

// ---- the kobin-2 cloud copy (DESIGN.md §13; .claude/SAVE-FORMAT-PLAN.md; SYNC-PLAN) ----
//
//   users/{uid}/<col>/{id}                — the MANIFEST: format "kobin-2", codec, meta/camera/
//                                           crossings, frames {fid: {chunk, parts, seq, bytes}},
//                                           log [{chunk, parts, seqFrom, seqTo, bytes}], seq,
//                                           head {epoch, seq}, lease {device, tab, name, epoch,
//                                           until, want?}, device, and the gallery's listing fields
//   users/{uid}/<col>/{id}/parts/{chunk~i} — one part of a gzipped chunk
//
// A push never overwrites (R3): its parts get names no other push uses (`_<epoch>` on every chunk
// id), and the manifest is written LAST in a transaction that requires the cloud head to be this
// device's base and the lease to be this device's. A push whose check fails leaves only parts no
// manifest names; the next push sweeps them (`pending` in the local header).
export const FORMAT2_CLOUD = "kobin-2";
const DELETES_PER_COMMIT = 400;
const partDoc2 = (uid, id, chunkId, i) => doc(getDb(), "users", uid, CANVAS_COLLECTION, id, "parts", `${chunkId}~${i}`);
const chunkKey = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, (c) => c === "/" ? "." : c === "," ? "_" : "-");

/** The cloud head moved past this device's base: the push is refused, nothing named by a manifest was touched. */
export class SyncConflict extends Error {
    constructor(why, head) { super(why); this.name = "SyncConflict"; this.head = head || null; }
}
/** Another device or tab has the pen (the manifest's lease is not this push's epoch). */
export class LeaseLost extends Error {
    constructor(holder) { super("another device or tab has the pen"); this.name = "LeaseLost"; this.holder = holder || null; }
}

// `before` runs ahead of each commit and may throw to stop the rest.
async function commitAll(items, per, fn, before = null) {
    for (let i = 0; i < items.length; i += per) {
        if (before) await before();
        const batch = writeBatch(getDb());
        for (const it of items.slice(i, i + per)) fn(batch, it);
        await batch.commit();
    }
}
// One push at a time per page, from any session or canvas: the write stream refuses overlapping
// uploads ("Write stream exhausted maximum allowed queued writes", memory firestore-write-stream).
// A session restarted mid-push (Fast Refresh, a remount) queues here behind the old one. A push
// that makes no progress for `ms` (a commit that never answers; `run.tick()` marks progress) lets
// the next one go and is marked dead, so a commit that answers late writes nothing more; a slow
// push that keeps committing keeps the lane. `onStart` is called as it leaves the queue.
const LANE_MS = 5 * 60000;
let lane = Promise.resolve();
function inLane(fn, { ms = LANE_MS, onStart = null } = {}) {
    const run = { dead: false, tick: () => {} };
    const go = () => {
        if (onStart) onStart();
        let t = null, over = false, release;
        const released = new Promise((r) => { release = r; });
        run.tick = () => {
            if (over || run.dead) return;
            clearTimeout(t);
            t = setTimeout(() => { run.dead = true; release(); }, ms);
        };
        run.tick();
        const p = Promise.resolve().then(() => fn(run));
        const end = () => { over = true; clearTimeout(t); release(); };
        p.then(end, end);
        return { p, released };
    };
    const started = lane.then(go, go);
    lane = started.then((x) => x.released);
    return started.then((x) => x.p);
}
const pushDead = () => Object.assign(new Error("the push passed its deadline and was let go"), { name: "PushDead" });
function chunksOf(m) {
    const out = [];
    for (const f of Object.values((m && m.frames) || {})) out.push({ chunk: f.chunk, parts: f.parts });
    for (const c of (m && m.log) || []) out.push({ chunk: c.chunk, parts: c.parts });
    return out;
}
const partsOf = (uid, id, chunks) => {
    const refs = [];
    for (const c of chunks) for (let i = 0; i < c.parts; i++) refs.push(partDoc2(uid, id, c.chunk, i));
    return refs;
};

/**
 * Push the local store's state (R3). `source` = `{ read(cloudFrameSeq, fromSeq), setSync(patch),
 * alive() }` (storage/localCanvases.cloudPushSource: the header, the frames the cloud lacks and the
 * entries past its seq in one transaction; `alive` false once another tab claimed the store), or
 * the older `{ header, readFrames, readLog, setSync }`; `entry` the listing fields; `epoch` the
 * lease this device holds; `lease` a lease to write when this push CREATES the copy (null from the
 * gallery). Runs in the page's one push lane. Throws SyncConflict when the cloud head is not the
 * header's `base`, LeaseLost when the lease is not `epoch` or the store was claimed mid-push.
 * Resolves with timings, counts and the new `head`.
 */
export function cloudPushCanvas2(uid, entry, source, opts = {}) {
    return inLane((run) => pushCanvas2(uid, entry, source, opts, run), { ms: opts.laneMs || LANE_MS, onStart: opts.onStart || null });
}
async function pushCanvas2(uid, entry, source, { deviceId = "", epoch = null, lease = null, thumbs = null, dropBelow = 0 } = {}, run = { dead: false }) {
    const t0 = perfNow();
    const setSync = source.setSync || (async () => true);
    const col = CANVAS_COLLECTION;
    const ref = canvasDoc(uid, entry.id);
    const tag = String(epoch || (lease && lease.epoch) || newEpoch());
    // Every chunk name is this push's alone: two pushes never share a part (review major 3).
    const nonce = Math.random().toString(36).slice(2, 7);
    const codec = compression();
    const prev = await getDoc(ref);
    const pm = prev.exists() ? prev.data() : null;
    const mirror = pm && pm.format === FORMAT2_CLOUD ? pm : null;
    const cloudFrames = mirror ? { ...(mirror.frames || {}) } : {};
    const cloudLog = mirror ? [...(mirror.log || [])] : [];
    const cloudSeq = mirror ? headOf(mirror).seq : 0;
    const cloudFrameSeq = {};
    for (const [fid, c] of Object.entries(cloudFrames)) cloudFrameSeq[fid] = c.seq || 0;
    let header, frames, entries;
    if (source.read) {
        const st = await source.read(cloudFrameSeq, cloudSeq);
        if (!st) throw new Error("nothing in the local store to push");
        ({ header, frames, entries } = st);
    } else {
        header = source.header;
        const ls = header.frameSeq || {};
        const need = (header.frameIds || []).filter((fid) => !(fid in cloudFrameSeq) || cloudFrameSeq[fid] !== (ls[fid] || 0));
        frames = need.length ? await source.readFrames(need) : [];
        entries = (await source.readLog(cloudSeq)).filter((e) => e.seq <= (header.seq || 0));
    }
    // A torn push whose manifest landed (its tab closed before recording it) is this device's base.
    const base = intentLanded(header.intent, pm, col) ? { epoch: header.intent.epoch, seq: header.intent.seq || 0, col }
        : header.base && header.base.col === col ? header.base : null;
    // Throws when a push planned against `cur` may not land.
    const check = (cur) => {
        if (!cur || cur.format !== FORMAT2_CLOUD) return;                 // none yet, or an lz1 copy replaced
        if (!base || !sameHead(headOf(cur), base)) throw new SyncConflict("the cloud copy moved", headOf(cur));
        if (!cur.lease || String(cur.lease.epoch) !== String(epoch)) throw new LeaseLost(cur.lease);
    };
    check(pm);
    const frameIds = header.frameIds || [];
    const writes = [], made = [];
    const nextFrames = {};
    let bytes = 0;
    const sent = new Set(frames.map((f) => f.frameId));
    for (const fid of frameIds) if (cloudFrames[fid] && !sent.has(fid)) nextFrames[fid] = cloudFrames[fid];
    for (const f of frames) {
        const zipped = await codec.gzip(packFrameChunk(f));
        const parts = splitParts(zipped);
        const chunkId = `f_${chunkKey(f.frameId)}_${f.seq}_${chunkKey(tag)}_${nonce}`;
        parts.forEach((p, i) => writes.push({ ref: partDoc2(uid, entry.id, chunkId, i), data: { data: Bytes.fromUint8Array(p) } }));
        made.push({ chunk: chunkId, parts: parts.length });
        nextFrames[f.frameId] = { chunk: chunkId, parts: parts.length, seq: f.seq, bytes: zipped.length };
        bytes += zipped.length;
    }
    let nextLog = cloudLog;
    if (entries.length) {
        const zipped = await codec.gzip(packLogChunk(entries));
        const parts = splitParts(zipped);
        const chunkId = `l_${entries[0].seq}_${entries[entries.length - 1].seq}_${chunkKey(tag)}_${nonce}`;
        parts.forEach((p, i) => writes.push({ ref: partDoc2(uid, entry.id, chunkId, i), data: { data: Bytes.fromUint8Array(p) } }));
        made.push({ chunk: chunkId, parts: parts.length });
        nextLog = [...cloudLog, { chunk: chunkId, parts: parts.length, seqFrom: entries[0].seq, seqTo: entries[entries.length - 1].seq, bytes: zipped.length }];
        bytes += zipped.length;
    }
    if (dropBelow > 0) nextLog = nextLog.filter((c) => c.seqTo >= dropBelow);
    // The head is kept only when nothing went up (a rename, a camera): the history did not move.
    // Anything uploaded at an unchanged seq still gets a head of its own.
    const seq = header.seq || 0;
    const next = base && !made.length && seq === (base.seq || 0) ? { epoch: base.epoch, seq, col }
        : { epoch: base && seq === (base.seq || 0) ? `${tag}.${nonce}` : tag, seq, col };
    const pending = [...(header.pending || []), ...made];
    // Recorded before any part is written: a tab closed from here on leaves parts the next push
    // sweeps, and a manifest that lands is recognised by its chunks.
    const noted = await setSync({ addPending: made, intent: { ...next, chunks: made.map((c) => c.chunk) } });
    if (noted === "fenced") throw new LeaseLost(null);
    const tPack = perfNow();
    // A tab that lost the store mid-push stops at the next part; its parts are pending, swept later.
    // Past its lane deadline (another push may be on the wire) it stops too.
    const stillOurs = async () => {
        if (run.dead) throw pushDead();
        run.tick();
        if (source.alive && !(await source.alive())) throw new LeaseLost(null);
    };
    await commitAll(writes, PARTS_PER_COMMIT, (b, w) => b.set(w.ref, w.data), stillOurs);
    if (run.dead) throw pushDead();
    run.tick();
    let total = 0;
    for (const f of Object.values(nextFrames)) total += f.bytes || 0;
    for (const c of nextLog) total += c.bytes || 0;
    const manifestOf = (cur) => {
        const prevThumbs = cur ? cur.thumbs || null : null;
        const mergedThumbs = thumbs || prevThumbs ? boundedThumbs({ ...(prevThumbs || {}), ...(thumbs || {}) }) : null;
        const keepLease = cur && cur.format === FORMAT2_CLOUD ? cur.lease || null : null;
        return {
            format: FORMAT2_CLOUD, codec: codec.name, device: deviceId,
            version: header.version || 1, meta: header.meta || {}, camera: header.camera || null, crossings: header.crossings || {},
            frameIds, frames: nextFrames, log: nextLog, seq: next.seq, head: { epoch: next.epoch, seq: next.seq },
            lease: keepLease || lease || null,
            name: entry.name || "Untitled canvas",
            savedAt: entry.savedAt || new Date().toISOString(),
            levels: entry.levels || 0, strokes: entry.strokes || 0, size: total,
            ...(mergedThumbs ? { thumbs: mergedThumbs } : {}),
        };
    };
    let replaced = [];
    let lz1Parts = 0;
    let manifest = null;
    try {
        await runTransaction(getDb(), async (t) => {
            const snap = await t.get(ref);
            const cur = snap.exists() ? snap.data() : null;
            check(cur);
            if (!cur !== !pm) throw new SyncConflict("the cloud copy appeared or went during the push", headOf(cur));
            manifest = manifestOf(cur);
            const keep = new Set(chunksOf(manifest).map((c) => c.chunk));
            replaced = cur && cur.format === FORMAT2_CLOUD
                ? chunksOf(cur).filter((c) => !keep.has(c.chunk))
                : [];
            lz1Parts = cur && cur.format !== FORMAT2_CLOUD ? cur.parts || 0 : 0;
            t.set(ref, manifest);
        });
    } catch (err) {
        // A transaction can fail after its commit landed (a lost reply): the head says which.
        let landed = null;
        try { const s = await getDoc(ref); landed = s.exists() ? s.data() : null; } catch (e2) { /* offline: the intent decides at the next open */ }
        if (!(landed && sameHead(headOf(landed), next))) {
            if (landed) await sweep(uid, entry.id, pending, landed, setSync);
            throw err;
        }
        manifest = landed;
    }
    // The manifest names this push: it is the base from here, whatever the cleanup does.
    const named = new Set(chunksOf(manifest).map((c) => c.chunk));
    const stale = [...pending.filter((c) => !named.has(c.chunk)), ...replaced];
    await setSync({ base: next, intent: null, addPending: replaced });
    const deletes = partsOf(uid, entry.id, stale);
    for (let i = 0; i < lz1Parts; i++) deletes.push(partDoc(uid, entry.id, i));
    if (run.dead) {
        // Landed, but let go: the deletes wait for the next push's sweep (they are pending).
        await setSync({ dropPending: made.map((c) => c.chunk) });
        return { packMs: +(tPack - t0).toFixed(1), putMs: +(perfNow() - tPack).toFixed(1), bytes, frames: frames.length, entries: entries.length, parts: writes.length, deleted: 0, head: next };
    }
    run.tick();
    await commitAll(deletes, DELETES_PER_COMMIT, (b, r) => b.delete(r), async () => run.tick());
    await setSync({ dropPending: [...stale.map((c) => c.chunk), ...made.map((c) => c.chunk)] });
    return { packMs: +(tPack - t0).toFixed(1), putMs: +(perfNow() - tPack).toFixed(1), bytes, frames: frames.length, entries: entries.length, parts: writes.length, deleted: deletes.length, head: next };
}
// Deletes the pending chunks `manifest` does not name; what stays pending is what could not go.
async function sweep(uid, id, pending, manifest, setSync) {
    const named = new Set(chunksOf(manifest).map((c) => c.chunk));
    const gone = pending.filter((c) => !named.has(c.chunk));
    try {
        await commitAll(partsOf(uid, id, gone), DELETES_PER_COMMIT, (b, r) => b.delete(r));
        await setSync({ dropPending: gone.map((c) => c.chunk) });
    } catch (err) { /* left pending: the next push sweeps again */ }
}

/**
 * The kobin-2 cloud copy as the local store's shape — `{ header, frames: { fid: { objects, geo,
 * seq } }, entries, head, full, thumbs, meta }` — or null when there is none or it is not kobin-2.
 * With `have` (`{ frameSeq, seq }`, a local copy the cloud's history extends) only the frames
 * whose snapshot differs and the entries past `have.seq` are downloaded (R4's fast-forward).
 * `real` reads the real collection from a dev build (R7's copy-in); nothing writes there.
 */
export async function cloudPullCanvas2(uid, id, { have = null, real = false } = {}) {
    const manifestRef = real ? realCanvasDoc(uid, id) : canvasDoc(uid, id);
    const partRef = real ? realPartDoc2 : partDoc2;
    const parent = await getDoc(manifestRef);
    if (!parent.exists()) return null;
    const m = parent.data();
    if (m.format !== FORMAT2_CLOUD) return null;
    const readChunk = async (c) => {
        const reads = [];
        for (let i = 0; i < c.parts; i++) reads.push(getDoc(partRef(uid, id, c.chunk, i)));
        const snaps = await Promise.all(reads);
        const parts = snaps.map((p, i) => { if (!p.exists()) throw new Error(`cloud copy is missing part ${c.chunk}~${i}`); return p.data().data.toUint8Array(); });
        return gunzipAs(m.codec, joinParts(parts));
    };
    const haveSeq = have ? have.frameSeq || {} : null;
    const frames = {};
    for (const [fid, c] of Object.entries(m.frames || {})) {
        if (haveSeq && fid in haveSeq && (haveSeq[fid] || 0) === (c.seq || 0)) continue;
        const f = unpackFrameChunk(await readChunk(c));
        frames[fid] = { objects: f.objects, geo: f.geo, seq: f.seq };
    }
    const from = have ? have.seq || 0 : -1;
    let entries = [];
    for (const c of (m.log || []).slice().sort((a, b) => a.seqFrom - b.seqFrom)) {
        if (c.seqTo <= from) continue;
        entries = entries.concat(unpackLogChunk(await readChunk(c)).filter((e) => e.seq > from));
    }
    const frameSeq = {};
    for (const [fid, c] of Object.entries(m.frames || {})) frameSeq[fid] = c.seq || 0;
    const header = {
        format: "boundless-drawing", version: m.version || 1, meta: m.meta || {}, camera: m.camera || null, crossings: m.crossings || {},
        name: m.name, seq: m.seq || 0, frameSeq, frameIds: m.frameIds || Object.keys(m.frames || {}), savedAt: m.savedAt,
        strokes: m.strokes || 0, levels: m.levels || 0,
    };
    // The pusher's compaction floor as the manifest carries it: nothing below its lowest log chunk (SAVE-3).
    const logFloor = (m.log || []).length ? Math.min(...m.log.map((c) => c.seqFrom)) : (m.seq || 0) + 1;
    return { header, frames, entries, logFloor, head: headOf(m), full: !have, thumbs: m.thumbs || null, meta: { id, ...m } };
}
/** The whole kobin-2 cloud copy (`cloudPullCanvas2` without a local copy), or null. */
export function cloudLoadCanvas2(uid, id, { real = false } = {}) {
    return cloudPullCanvas2(uid, id, { real });
}

// ---- the lease: one editor at a time (SYNC-PLAN R2) ----
// `lease: { device, tab, name, epoch, until, want? }` on the manifest, taken and renewed in
// transactions. `until` is the holder's clock plus LEASE_TTL_MS; a lease past it is free. Another
// device asks with `want`; the holder saves, pushes and lets go (`until: 0`), or the asker takes
// it anyway after a wait. Every lease write mints or keeps an epoch; a push names it.

const leaseFor = ({ device, tab, name }, now, ttl) => ({ device, tab: tab || null, name: name || null, epoch: newEpoch(), until: now + ttl });

/**
 * Take the pen: `{ ok, lease, head }`, or `{ ok: false, holder, head }` when another device holds
 * a live lease (unless `force`, or `ifLease` names the lease still there). `{ ok: true, absent }` when there is no cloud copy, `legacy` for
 * an lz1 copy (no lease possible there).
 */
export async function cloudTakeLease(uid, id, who, { force = false, ifLease = null, now = Date.now(), ttl = LEASE_TTL_MS, skewMs = LEASE_SKEW_MS } = {}) {
    const ref = canvasDoc(uid, id);
    return runTransaction(getDb(), async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists()) return { ok: true, absent: true, lease: null, head: null };
        const cur = snap.data();
        if (cur.format !== FORMAT2_CLOUD) return { ok: true, legacy: true, lease: null, head: null };
        const st = leaseState(cur.lease, { device: who.device, now, skewMs });
        // `ifLease`: the lease a follower watched unchanged for a TTL; taken only if it is still that
        // one. A lease let go to an asker who never took it falls back this way too (SYNC-PLAN §6).
        const watched = ifLease && cur.lease && String(cur.lease.epoch) === String(ifLease.epoch) && cur.lease.until === ifLease.until;
        if (!st.free && !force && !watched) return { ok: false, holder: st.holder, head: headOf(cur) };
        const lease = leaseFor(who, now, ttl);
        t.update(ref, { lease });
        return { ok: true, lease, head: headOf(cur) };
    });
}
/** Keep the pen: `{ ok, want, head }`, or `{ ok: false, lost, holder }` when the lease is no longer `epoch`. */
export async function cloudRenewLease(uid, id, epoch, { now = Date.now(), ttl = LEASE_TTL_MS } = {}) {
    const ref = canvasDoc(uid, id);
    return runTransaction(getDb(), async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists()) return { ok: false, absent: true, holder: null };
        const cur = snap.data();
        const L = cur.lease;
        if (!L || String(L.epoch) !== String(epoch) || !(L.until > 0)) return { ok: false, lost: true, holder: L || null, head: headOf(cur) };
        t.update(ref, { lease: { ...L, until: now + ttl } });
        return { ok: true, want: L.want || null, head: headOf(cur) };
    });
}
/** Let go of the pen (`until: 0`); `to` reserves it for the device that asked (leaseState). */
export async function cloudReleaseLease(uid, id, epoch, { to = null } = {}) {
    const ref = canvasDoc(uid, id);
    return runTransaction(getDb(), async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists()) return false;
        const L = snap.data().lease;
        if (!L || String(L.epoch) !== String(epoch)) return false;
        t.update(ref, { lease: { ...L, until: 0, to: to || null } });
        return true;
    });
}
/** Ask for the pen: taken at once when free (`{ ok, lease }`), else `want` set (`{ ok: false, asked, holder }`). */
export async function cloudAskLease(uid, id, who, { now = Date.now(), ttl = LEASE_TTL_MS, skewMs = LEASE_SKEW_MS } = {}) {
    const ref = canvasDoc(uid, id);
    return runTransaction(getDb(), async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists()) return { ok: true, absent: true, lease: null, head: null };
        const cur = snap.data();
        const st = leaseState(cur.lease, { device: who.device, now, skewMs });
        if (st.free) {
            const lease = leaseFor(who, now, ttl);
            t.update(ref, { lease });
            return { ok: true, lease, head: headOf(cur) };
        }
        t.update(ref, { lease: { ...cur.lease, want: { device: who.device, tab: who.tab || null, name: who.name || null, at: now } } });
        return { ok: false, asked: true, holder: cur.lease, head: headOf(cur) };
    });
}
/** Watch the manifest: `onChange(manifest | null)` on every change; returns the unsubscribe. */
export function cloudWatchManifest(uid, id, onChange, onError) {
    return onSnapshot(canvasDoc(uid, id), (snap) => onChange(snap.exists() ? snap.data() : null), onError || (() => {}));
}
