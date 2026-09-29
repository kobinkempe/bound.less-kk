/**
 * rasterWorkerClient.js — the worker pool and the inline fallback, behind `rasterPool` (`{size, free, submit}`): the
 * face `jobQueue.js` dispatches through, one strip or one cut at a time (A3 §4.4, PLAN §1.6). RASTERISER-PLAN §3.6
 * (the buffer pool) and §8.2 (the queueing subtraction). Packing is the caller's, at dispatch — a strip superseded
 * while it waited costs no packing at all (357–598 ms for a screen, §8.6 measurement 4).
 *
 * Five things a reader needs in order not to break it:
 *  - THE PACK CALLBACK IS WHERE `beginJob` GOES. It is handed the strip's plates and the job id, and the job it returns
 *    carries the generation `G` it was packed at (A2 §3.1), which its result brings back. A strip whose pack declines
 *    fires `onDrop` with `before: true`.
 *  - THE endJob CONTRACT (§15.3 Q7): **the caller ends every job id it ever sees, success or failure.** Every minted id
 *    goes to `pack(plates, jobId, pool)` first, every job that will not deliver fires `onDrop` or `onRequeue` with it,
 *    and `abandonInFlight` reports everything still in flight at a teardown; without that last, a teardown leaves those
 *    keys in flight for ever and the screen keeps a permanent hole with every suite green.
 *  - THE MAIN THREAD OWNS EVERY ABSOLUTE TIME (§8.2). The worker returns durations; `postedAt` and `arrivedAt` are taken
 *    here and `queueingMs` is the subtraction.
 *  - THE JOB'S BUFFERS COME BACK IN `recycled` AND GO TO THE POOL (§3.6): a three-octave zoom re-packs the screen twelve
 *    times, 55.93 MB allocated and detached inside one gesture without it (§8.6 measurement 6).
 *  - `onerror` BEFORE ANY WORKER HAS ANSWERED MARKS THE POOL BROKEN FOR THE SESSION: the script did not load, so every
 *    later job takes the inline path. After one has answered, an error or a job silent past `WATCHDOG_MS` replaces the
 *    pool, `MAX_RESPAWNS` times, before going inline (RW-1); what was in flight goes back through `onRequeue`.
 */

import {
    wireJob, unwireResult, jobBytes, resultBytes, BufferPool,
    GUARD_NAMES, COUNT_NAMES, GUARDS_PER_JOB, COUNTS_PER_PLATE, TIMINGS_PER_PLATE,
} from "./rasterJob";
import { runJob, runCut } from "../worker/rasterWorker";
import { PLATE_PX } from "./plate";

/** §6.6's one rule for the worker count, and the ceiling that makes a strip half a worker's share. */
export const MAX_WORKERS = 4;
/** Pool replacements after a worker error or a silent job, before the session goes inline (REVIEWER-2 RW-1). */
export const MAX_RESPAWNS = 3;
/** A job in flight this long is looked at once more, a check later, then its pool is replaced (RW-1). */
export const WATCHDOG_MS = 30000;

let workers = [];            // { w, jobId } — `jobId` non-null while it holds one (the cap is 1)
let broken = false;          // the script did not load, or the pool failed past its respawns
let answered = false;        // a worker has answered: the script loads, so a later failure is the worker's
let respawns = 0;
let watchdog = null;
let spawned = false;
let transport = null;        // (msg, transfer) => Promise<resultMsg>; tests only
let countOverride = null;
let seq = 0;                 // job ids, monotonic per session (§3.3)

const inFlight = new Map();  // jobId -> { req, plates, postedAt, slot, bytesOut }
// Abandoned jobs with no slot object to mark — the inline path and a transport. The COUNT is
// their hold: `freeSlot` adds it to `inFlight.size`, so the one RGBA scratch of §3.5 is not
// handed a second job while the first is still drawing into it (D175).
let heldNoSlot = 0;
let onFreed = null;          // the queue's pump, for a slot an abandoned job's own answer frees (`releaseAbandoned`)
const pool = new BufferPool(8 << 20);

const stats = {
    jobs: 0, plates: 0, failed: 0,
    dropsBefore: 0,
    bytesOut: 0, bytesIn: 0,
    workerMs: 0, poolReadyMs: 0,
    // §8.1's two main-thread transfer timers. `postMs` is the wire and the post; `recvMs` is the
    // unwire and the pool's take-back. Without them stage 6's residual absorbs both (§8.4 rule 2).
    postMs: 0, recvMs: 0,
    // The pool should be spawned from the engine's constructor or its first idle callback
    // (§8.5); a late spawn works but costs the first render the bundle's load. Non-zero says so.
    spawnedLate: 0,
    respawns: 0, silent: 0,         // RW-1: pools replaced, and how many of those for a silent job
    cuts: 0, cutMs: 0,              // cuts and descents posted (PLAN §1.6), and their post-to-answer time
};

/** §8.5: the seven `guards` per job and the eight `counts` per plate, totalled over the session. */
const guardTotals = new Float64Array(GUARDS_PER_JOB);
const countTotals = new Float64Array(COUNTS_PER_PLATE);
const named = (names, a) => { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A transport stands in for the whole pool: `(msg, transfer) => Promise<resultMsg>`. Tests only. */
export function setRasterTransport(t) { transport = t || null; }

/** The URL override of §6.6, and the suite's own hook. `null` restores the measured rule. */
export function setRasterWorkerCount(n) { countOverride = n == null ? null : Math.max(1, n | 0); }

/** Called when an abandoned job's answer frees its slot: nothing else reports that capacity, so the queue pumps here. */
export function setOnSlotFreed(fn) { onFreed = fn || null; }
/** A released hold pumps the queue in front. */
const freed = (released) => { if (released && onFreed) onFreed(); };

/**
 * `min(4, max(1, hardwareConcurrency − 1))` (§6.6), overridden by `?rasterWorkers=N` so stage 7
 * can sweep 1, 2 and 4 in a real browser with no rebuild.
 */
export function rasterWorkerCount() {
    if (countOverride != null) return countOverride;
    const url = urlOverride();
    if (url != null) return url;
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 1;
    return Math.min(MAX_WORKERS, Math.max(1, cores - 1));
}

// `window.location`, not the bare global: this file runs on the MAIN thread, where eslint's
// no-restricted-globals is right about `location` (the worker file disables that rule because it
// is a worker). No window — a node child, a probe — means no override.
function urlOverride() {
    if (typeof window === "undefined" || !window.location) return null;
    return workerCountFromSearch(window.location.search);
}

/** `?rasterWorkers=N`, capped at the rule's own ceiling; `null` where the query says nothing. */
export function workerCountFromSearch(search) {
    if (!search) return null;
    const m = /[?&]rasterWorkers=(\d+)/.exec(search);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n > 0 ? Math.min(MAX_WORKERS, n) : null;
}

function workerUrl() {
    const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) || "";
    return base + "/raster-worker.js";
}

/**
 * Spawn the pool. Called from the engine's constructor or its first idle callback, never on the
 * first render: four workers each loading and parsing the bundle costs tens of milliseconds on a
 * desktop and can cost a hundred each on a phone (§8.5). Returns the number of live workers — 0
 * where there is none, which is the inline path.
 */
export function ensureRasterPool() { return spawnPool(false); }

function spawnPool(late) {
    if (transport || broken || spawned) return workers.length;
    spawned = true;
    if (late) stats.spawnedLate++;
    if (typeof Worker === "undefined") { broken = true; return 0; }
    const t0 = now();
    const want = rasterWorkerCount();
    for (let k = 0; k < want; k++) {
        let w;
        try {
            w = new Worker(workerUrl());
        } catch (err) {
            broken = true;
            terminateWorkers();          // not destroyRasterPool: nothing in flight is abandoned
            return 0;
        }
        const slot = { w, jobId: null };
        w.onmessage = (e) => onMessage(slot, (e && e.data) || {});
        w.onerror = (e) => onWorkerError(e);
        workers.push(slot);
    }
    stats.poolReadyMs = now() - t0;
    return workers.length;
}

/** Terminate every worker and forget the pool. Nothing is reported: `destroyRasterPool` does that. */
function terminateWorkers() {
    for (const s of workers) { try { s.w.terminate(); } catch (err) { /* already gone */ } }
    workers = [];
    spawned = false;
}

/**
 * Teardown: terminate every worker AND report every job still in flight, because a terminated
 * worker never answers and its `endJob` would never be called (the header's contract).
 */
export function destroyRasterPool() {
    if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
    terminateWorkers();
    abandonInFlight("destroyed");
}

/**
 * The job id of a slot whose job was abandoned. A worker draws every plate of its job into ONE
 * RGBA scratch and awaits `createImageBitmap` between plates (§3.5), so a second job posted into
 * it while it is still rastering overwrites pixels the first job's `ImageData` aliases.
 */
const ABANDONED = -1;

/**
 * Report every job in flight as dropped, carrying its id. The caller owes the store's
 * `endJob(jobId)` on each; a re-render asks for whatever of those plates it still
 * wants. A job whose result arrives after this is ignored — `onMessage` finds no record — so a
 * job id is still reported exactly once.
 *
 * The slot is marked `ABANDONED` and NOT freed: the worker is still rastering, and its own answer
 * is the only proof it has stopped. `destroyRasterPool` terminates first, so its slots are off
 * the pool before they are marked and no strip ever waits on them. A job with NO slot — the
 * inline path, and a transport — is held by `heldNoSlot` instead, because the cap those two
 * paths run under is a count and not a slot object.
 * @returns {number} how many were abandoned
 */
export function abandonInFlight(why) {
    const stranded = [...inFlight.values()];
    inFlight.clear();
    for (const f of stranded) {
        if (f.slot) f.slot.jobId = ABANDONED;
        else heldNoSlot++;
        stats.failed++;
        if (f.req.onDrop) f.req.onDrop({ jobId: f.jobId, plates: f.plates, why: why || "abandoned", before: false });
    }
    return stranded.length;
}

/**
 * An abandoned job's own answer releases its hold — the worker's slot, or, where there is none,
 * one of `heldNoSlot`. Anything else (a result for a job already failed over) leaves both alone.
 * @returns {boolean} true where a hold was released, so the caller pumps
 */
function releaseAbandoned(slot) {
    if (slot) {
        if (slot.jobId !== ABANDONED) return false;
        slot.jobId = null;
        return true;
    }
    if (heldNoSlot === 0) return false;
    heldNoSlot--;
    return true;
}

/** A worker threw outside a job, or the script did not load (a 404, a CSP): `failPool`. */
function onWorkerError(e) { failPool(e, answered); }

/**
 * Every job in flight handed back (`onRequeue`: the queue's strip goes to the head of its priority, H7; the re-pack
 * mints a new id, so the caller ends the old one), the pool terminated; a new pool when `respawn` and respawns are
 * left, else the inline path for the session. `silent`: the record the watchdog found silent — its `onRequeue` hears
 * "watchdog", every other record's "worker".
 */
function failPool(e, respawn, silent = null) {
    const stranded = [...inFlight.values()];
    inFlight.clear();
    terminateWorkers();
    for (const f of stranded) {
        stats.failed++;
        if (f.req.onRequeue) f.req.onRequeue(f.jobId, f === silent ? "watchdog" : "worker");
        else if (f.req.onDrop) f.req.onDrop({ jobId: f.jobId, plates: f.plates, why: "worker", before: false });
    }
    if (respawn && respawns < MAX_RESPAWNS) { respawns++; stats.respawns++; spawnPool(false); }
    else broken = true;
    if (e && e.preventDefault) e.preventDefault();
}

/** While a worker holds a job, a check every half `WATCHDOG_MS`. */
function armWatchdog() {
    if (watchdog != null || transport || !workers.length) return;
    watchdog = setTimeout(checkWatchdog, WATCHDOG_MS / 2);
}

/**
 * A job past `WATCHDOG_MS` is marked, and replaced only if still unanswered at the next check: an
 * answer queued behind a long main-thread task lands before then (RW-1).
 */
function checkWatchdog() {
    watchdog = null;
    const t = now();
    for (const rec of inFlight.values()) {
        if (!rec.slot || t - rec.postedAt < WATCHDOG_MS) continue;
        if (!rec.suspect) { rec.suspect = t; continue; }
        stats.silent++;
        failPool(null, true, rec);
        return;
    }
    for (const rec of inFlight.values()) if (rec.slot) { armWatchdog(); return; }
}
/** One watchdog check now. Tests only. */
export function _checkWatchdogForTests() { if (watchdog != null) { clearTimeout(watchdog); watchdog = null; } checkWatchdog(); }

/**
 * The workers actually available: the pool's, or the one inline slot. A spawn from here is LATE
 * — the first render pays the bundle's load — so it is counted and stays visible in the report
 * rather than being refused (§8.5, §15.3 Q10).
 */
function activeCount() {
    if (transport) return rasterWorkerCount();
    spawnPool(true);
    return workers.length || 1;
}

/**
 * A worker holding no job; `null` where there is no worker object — a transport, which takes as
 * many jobs at once as the pool would, or the inline path, which is this thread and takes one.
 * `undefined` means everything is busy. Both slotless caps count `heldNoSlot` with what is in
 * flight, so an abandoned job holds its share until it answers, exactly as a marked slot does.
 */
function freeSlot() {
    if (transport) return inFlight.size + heldNoSlot < rasterWorkerCount() ? null : undefined;
    if (!broken) spawnPool(true);
    if (workers.length) {
        for (const s of workers) if (s.jobId == null) return s;
        return undefined;
    }
    return inFlight.size + heldNoSlot === 0 ? null : undefined;   // inline: one at a time, here
}

/** Pack and post one entry into `slot`. False when the pack declined or threw (`onDrop` has fired with the id). */
function dispatch(entry, slot) {
    if (entry.req.cut) return dispatchCut(entry, slot);
    const jobId = ++seq;
    let job;
    try {
        job = entry.req.pack(entry.plates, jobId, pool);
    } catch (err) {
        stats.failed++;
        if (entry.req.onDrop) entry.req.onDrop({ jobId, plates: entry.plates, why: "pack", before: true });
        return false;
    }
    if (!job) {
        stats.dropsBefore++;
        if (entry.req.onDrop) entry.req.onDrop({ jobId, plates: entry.plates, why: "empty", before: true });
        return false;
    }
    job.jobId = jobId;
    if (job.frameSeq == null) job.frameSeq = entry.req.frameSeq;
    const bytesOut = jobBytes(job);
    const postedAt = now();
    job.postedAt = postedAt;
    const { msg, transfer } = wireJob(job);
    const rec = { req: entry.req, plates: entry.plates, postedAt, slot, jobId, bytesOut, postMs: 0 };
    inFlight.set(jobId, rec);
    stats.jobs++;
    stats.bytesOut += bytesOut;
    if (slot) slot.jobId = jobId;

    // §8.1's `xfer.out`: the wire and the post, on this thread. The inline path's own work is
    // the worker's and is on a later turn, so this is the wire alone there.
    const donePost = () => { rec.postMs = now() - postedAt; stats.postMs += rec.postMs; };
    if (transport) {
        const p = transport(msg, transfer);
        donePost();
        p.then((out) => onMessage(slot, out || {}), (err) => onFailed(jobId, err, slot));
        return true;
    }
    if (slot) {
        try {
            slot.w.postMessage(msg, transfer);
            donePost();
            armWatchdog();
        } catch (err) {
            onFailed(jobId, err, slot);
        }
        return true;
    }
    // The inline path: the worker's own entry on this thread, so both paths draw the same
    // pixels and jsdom checks the shipped one (§10 stage 3).
    donePost();
    Promise.resolve().then(() => runJob(msg, { receivedAt: now() }))
        .then((out) => onMessage(null, out.msg), (err) => onFailed(jobId, err, null));
    return true;
}

/**
 * A cut or a descent (`req.cut`, PLAN §1.6) posted into `slot`: `req.wire()` gives its message, `req.onResult(out)`
 * gets the worker's wired answer. A transport is called `(msg, transfer, kind)`; with no worker (a broken pool) the
 * worker's own `runCut` runs on this thread a turn later.
 */
function dispatchCut(entry, slot) {
    const jobId = ++seq, r = entry.req;
    let w;
    try { w = r.wire(); } catch (err) {
        stats.failed++;
        r.onDrop({ jobId, plates: null, why: "pack", before: true });
        return false;
    }
    const rec = { req: r, plates: null, postedAt: now(), slot, jobId, bytesOut: 0, postMs: 0 };
    inFlight.set(jobId, rec);
    stats.cuts++;
    if (slot) slot.jobId = jobId;
    const answer = (out) => onCutMessage(slot, { kind: "cut-result", jobId, ok: true, out });
    if (transport) {
        transport(w.msg, w.transfer, r.cut).then(answer, (err) => onFailed(jobId, err, slot));
        return true;
    }
    if (slot) {
        try { slot.w.postMessage({ kind: "cut-job", cut: r.cut, jobId, job: w.msg }, w.transfer); armWatchdog(); } catch (err) { onFailed(jobId, err, slot); }
        return true;
    }
    Promise.resolve().then(() => runCut(r.cut, w.msg)).then((out) => answer(out.msg), (err) => onFailed(jobId, err, null));
    return true;
}

/** A cut's answer: its record ended and its `onResult` called, or a job that threw in the worker failed (`onDrop`). */
function onCutMessage(slot, data) {
    if (slot) answered = true;
    const rec = inFlight.get(data.jobId);
    if (!rec) { freed(releaseAbandoned(slot)); return; }
    if (!data.ok) { onFailed(data.jobId, new Error(data.err || "cut failed"), slot); return; }
    inFlight.delete(data.jobId);
    if (rec.slot) rec.slot.jobId = null;
    stats.cutMs += now() - rec.postedAt;
    rec.req.onResult(data.out);
}

/** The pool is broken: no transport, and no worker — the script did not load, or the pool failed past its respawns. */
export function poolBroken() {
    if (transport) return false;
    if (!broken) spawnPool(true);
    return broken || !workers.length;
}

/** Free slots now: idle workers, a transport's spare capacity, or the one inline slot when nothing is in flight. */
function freeSlots() {
    if (transport) return Math.max(0, rasterWorkerCount() - inFlight.size - heldNoSlot);
    if (!broken) spawnPool(true);
    if (workers.length) { let n = 0; for (const s of workers) if (s.jobId == null) n++; return n; }
    return inFlight.size + heldNoSlot === 0 ? 1 : 0;
}

/**
 * The pool as `jobQueue.js` sees it (the picture pyramid's path, A3 §4.4): its size, its free slots, and a
 * submit that dispatches one `{ req: { pack, onResult, onDrop, prio }, plates }` at once — false when no slot
 * is free or the pack declined.
 */
export const rasterPool = Object.freeze({
    size: () => activeCount(),
    free: () => freeSlots(),
    submit: (entry) => { const slot = freeSlot(); return slot === undefined ? false : dispatch(entry, slot); },
});

/** A job's terminal failure. `slot` is the one it was posted into, null on the slotless paths. */
function onFailed(jobId, err, slot) {
    const rec = inFlight.get(jobId);
    // No record: an orphan. An ABANDONED job answering with a failure is the proof its worker (or
    // this thread) stopped, and that answer is what releases the hold (D175); anything else here
    // is a job already failed over, which holds nothing.
    if (!rec) {
        freed(releaseAbandoned(slot || null));
        return;
    }
    inFlight.delete(jobId);
    if (rec.slot) rec.slot.jobId = null;
    stats.failed++;
    if (rec.req.onDrop) {
        rec.req.onDrop({ jobId, plates: rec.plates, why: String((err && err.message) || err || "failed"), before: false });
    }
}

function onMessage(slot, data) {
    if (data.kind === "cut-result") { onCutMessage(slot, data); return; }
    const arrivedAt = now();                           // the main thread's own clock, first (§8.2)
    if (slot) answered = true;
    if (data.kind === "raster-error") {
        onFailed(data.jobId, new Error(data.err), slot);   // an orphan's hold is released there
        return;
    }
    const res = unwireResult(data);
    const rec = inFlight.get(res.jobId);
    // A result for a job already failed over: ignored, and its slot needs nothing — `onFailed`
    // and `onWorkerError` free the slot with the record, so freeing it here would free a slot
    // already holding the NEXT job. An ABANDONED slot is the one exception: nobody freed it,
    // because this answer is the proof that worker stopped drawing into its scratch (§3.5).
    if (!rec) {
        freed(releaseAbandoned(slot));
        return;
    }
    inFlight.delete(res.jobId);
    if (rec.slot) rec.slot.jobId = null;

    for (const b of res.recycled) pool.give(b);
    res.recycled.length = 0;
    const recvMs = now() - arrivedAt;                  // §8.1's `xfer.in`: the unwire and the pool

    const nPlates = res.plates.length / 2;
    let phases = res.serialiseMs || 0;
    for (let p = 0; p < nPlates; p++) {
        // slots 0 and 1 of §8.2's stride: receipt-to-start and start-to-finish, the two phases
        // the worker's own clock owns. The stride is the constant, never a 7 written here.
        phases += res.timings[p * TIMINGS_PER_PLATE] + res.timings[p * TIMINGS_PER_PLATE + 1];
    }
    const wallMs = arrivedAt - rec.postedAt;
    const info = {
        jobId: res.jobId, frameSeq: res.frameSeq, plates: rec.plates,
        postedAt: rec.postedAt, arrivedAt, wallMs,
        // §8.2: the worker's clock is not ours, so its phases are subtracted from our own wall.
        queueingMs: wallMs - phases,
        postMs: rec.postMs, recvMs,
        bytesOut: rec.bytesOut, bytesIn: resultBytes(res),
        inline: !slot && !transport,
    };
    stats.plates += nPlates;
    stats.bytesIn += info.bytesIn;
    stats.workerMs += phases;
    stats.recvMs += recvMs;
    if (res.guards) for (let g = 0; g < GUARDS_PER_JOB; g++) guardTotals[g] += res.guards[g];
    if (res.counts) for (let c = 0; c < res.counts.length; c++) countTotals[c % COUNTS_PER_PLATE] += res.counts[c];
    if (rec.req.onResult) rec.req.onResult(res, info);
}

/**
 * One plate's RGBA as an `ImageBitmap`, the form the pyramid composes cheapest: a raw-pixel result becomes a bitmap
 * before it is stored. Null where the scope has no `createImageBitmap` (jsdom); the caller then keeps the pixels.
 * @param {Uint8ClampedArray|null} px one plate's RGBA, PLATE_PX² × 4 (`res.pixels[p]`)
 * @returns {Promise<ImageBitmap|null>}
 */
export async function plateBitmap(px) {
    if (!px || typeof createImageBitmap !== "function" || typeof ImageData !== "function") return null;
    return createImageBitmap(new ImageData(px, PLATE_PX, PLATE_PX));
}

/**
 * What stage 6 puts in the report's `raster` section (§8.5). Durations are the worker's own.
 * `guards` carries the seven totals §8.5 asks for — `nonFinite`, `fullClears`, `arcClamped` and
 * `arcOverTurn` are the four that mean a record was refused — and `counts` the eight per-plate
 * columns summed over every plate of the session.
 *
 * `heldSlots` is the capacity an abandoned job is still holding (D175): a worker slot marked
 * `ABANDONED`, or one of `heldNoSlot` where there is no slot object. An orphan that never answers
 * holds its share for the session, and without this field that reads as `inFlight: 0` with the
 * queue's strips climbing — a pool drawing with three workers, indistinguishable from a slow packer.
 */
export function rasterWorkerReport() {
    let held = heldNoSlot;
    for (const s of workers) if (s.jobId === ABANDONED) held++;
    return {
        mode: transport ? "transport" : workers.length ? "workers" : "inline",
        workers: workers.length, wanted: rasterWorkerCount(), broken, respawns: stats.respawns, silent: stats.silent,
        inFlight: inFlight.size, heldSlots: held,
        jobs: stats.jobs, plates: stats.plates, failed: stats.failed, cuts: stats.cuts, cutMs: stats.cutMs,
        dropsBefore: stats.dropsBefore,
        bytesOut: stats.bytesOut, bytesIn: stats.bytesIn,
        workerMs: stats.workerMs, poolReadyMs: stats.poolReadyMs,
        postMs: stats.postMs, recvMs: stats.recvMs, spawnedLate: stats.spawnedLate,
        guards: named(GUARD_NAMES, guardTotals),
        counts: named(COUNT_NAMES, countTotals),
        pool: { takes: pool.takes, hits: pool.hits, allocBytes: pool.allocBytes, bytes: pool.bytes },
    };
}

/**
 * The suite's reset: counters, the pool and the broken flag. Does not spawn, and does NOT report
 * what is in flight — there is no caller left to report to between two tests. A live teardown is
 * `destroyRasterPool`, which does.
 */
export function resetRasterWorkerClient() {
    inFlight.clear();
    heldNoSlot = 0;
    terminateWorkers();
    broken = false;
    answered = false; respawns = 0;
    if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
    seq = 0;
    countOverride = null;
    pool.clear();
    pool.takes = 0; pool.hits = 0; pool.allocBytes = 0;
    for (const k of Object.keys(stats)) stats[k] = 0;
    guardTotals.fill(0);
    countTotals.fill(0);
}
