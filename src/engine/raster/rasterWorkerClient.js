/**
 * rasterWorkerClient.js — the worker pool, the one strip queue, and the inline fallback.
 * RASTERISER-PLAN §3.6 (the strips and the buffer pool), §8.2 (the queueing subtraction) and
 * §8.4 rule 4 (a stale strip is dropped BEFORE it is packed, not after it is rastered).
 *
 * The shape of one render (§5.1 steps 4–6): the caller hands `submitPlates` the plates its
 * `PlateStore.want` missed; this file cuts them into strips of `ceil(plates / (workers × 2))`,
 * and a worker that finishes pulls the next strip — one queue, so a dense column and three
 * empty ones cannot leave one worker with the whole screen. Packing is the CALLER's, called
 * here at dispatch and not at submit, so a strip superseded while it waited costs no packing
 * at all — 357–598 ms for a screen, §8.6 measurement 4.
 *
 * Six things a reader needs in order not to break it:
 *  - THE PACK CALLBACK IS WHERE `PlateStore.beginJob` GOES. It is handed the strip's plates and
 *    the job id, and the job it returns carries the generation `G` it was packed at (A2 §3.1),
 *    which its result brings back. A strip dropped before it is packed was never begun, and
 *    `onDrop` says so with `jobId` null.
 *  - THE endJob CONTRACT (stage 4's handoff, §15.3 Q7): **the caller calls
 *    `PlateStore.endJob(jobId)` for every job id it ever sees, success or failure.** One rule
 *    with no exception, because `put()` already ends a key and a late `endJob` on a clean job
 *    returns 0. This file guarantees it can: every minted id goes to `pack(plates, jobId, pool)`
 *    first, every job that will not deliver plates fires `onDrop` carrying that id, and
 *    `abandonInFlight` reports everything still in flight at a teardown. Without the last of those, a teardown
 *    leaves those keys in `PlateStore.inflight` for ever, `want` returns them as in-flight
 *    rather than as misses, and the screen keeps a permanent hole with every suite green.
 *  - THE MAIN THREAD OWNS EVERY ABSOLUTE TIME (§8.2). The worker returns durations; `postedAt`
 *    and `arrivedAt` are taken here and `queueingMs` is the subtraction.
 *  - THE JOB'S BUFFERS COME BACK IN `recycled` AND GO TO THE POOL (§3.6). A three-octave zoom
 *    re-packs the screen twelve times; without the pool that is 55.93 MB allocated and detached
 *    inside one gesture (§8.6 measurement 6).
 *  - `onerror` BEFORE ANY WORKER HAS ANSWERED MARKS THE POOL BROKEN FOR THE SESSION, as the
 *    erase client does (`eraseWorkerClient.js:44-54`): the script did not load, so every later
 *    strip takes the inline path. After one has answered, an error or a job silent past
 *    `WATCHDOG_MS` replaces the pool, `MAX_RESPAWNS` times, before going inline (RW-1).
 *  - **ONE LIVE `frameSeq` PER `q`, AND A DROP TOUCHES THE QUEUE ONLY** (§8.4 rule 4, D182).
 *    `submitPlates` drops the queued strips of an OLDER `frameSeq` **at the same `q`**, and `pump`
 *    re-checks each waiting strip against the newest `frameSeq` for its own `q` (`why: "frame"`
 *    and `"stale"`, `jobId` null — never packed, never begun). Requests at different `q` are live
 *    together, because one frame's misses belong to two quanta whenever 5a holds the old quantum
 *    while the new one fills (§6.3). Three things that rule does NOT do:
 *      · **A second call at the same `q` in the same frame drops nothing.** The two frames are
 *        equal, so both calls stand and both raster. "At most ONE call per `q` per frame" is
 *        **5b's** rule (§10 stage 5b); nothing here can tell a second call from the first.
 *      · **No drop recalls a job already DISPATCHED.** It arrives and is answered normally, and
 *        `abandonInFlight` or the plate store's generation rule is what deals with it.
 *      · **A newer submit at another `q` does not drop a dead quantum's strips** — that is the
 *        per-`q` rule doing its work. The caller drops those itself, `dropQueued(why, deadQ)`
 *        with the dead `q` (§10 stage 5b); `stillWanted`, checked at dispatch, is the safety net
 *        and costs a pull and no pack.
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

const queue = [];            // { req, plates, id } — strips waiting for a free worker
const inFlight = new Map();  // jobId -> { req, plates, postedAt, slot, bytesOut }
// Abandoned jobs with no slot object to mark — the inline path and a transport. The COUNT is
// their hold: `freeSlot` adds it to `inFlight.size`, so the one RGBA scratch of §3.5 is not
// handed a second job while the first is still drawing into it (D175).
let heldNoSlot = 0;
// `q` -> the newest `frameSeq` submitted at that quantum. A MAP and not one pair, because a frame
// holds misses at two quanta while 5a's view is held at the old one (§6.3, D182); a key with
// nothing queued and nothing in flight is forgotten in `dropStale`, so a session's zoom quanta
// cannot accumulate here.
const current = new Map();
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
 * Report every job in flight as dropped, carrying its id. The caller owes
 * `PlateStore.endJob(jobId)` on each; a re-render asks for whatever of those plates it still
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

/**
 * The script did not load (a 404, a CSP) or a worker threw outside a job. Every strip in flight
 * goes back on the queue — its plates are this file's own copy, so it is re-packed rather than
 * resumed — and every later strip takes the inline path (`eraseWorkerClient.js:44-54`).
 *
 * Each stranded strip is reported dropped AND re-queued: the re-pack mints a new job id, so the
 * caller owes `PlateStore.endJob` on the old one or those keys stay in flight for ever.
 */
function onWorkerError(e) { failPool(e, answered); }

/**
 * Every strip in flight reported and re-queued, the pool terminated; a new pool when `respawn`
 * and respawns are left, else the inline path for the session. `silent`: the record the watchdog
 * found silent — its `onRequeue` hears "watchdog", every other record's "worker".
 */
function failPool(e, respawn, silent = null) {
    const stranded = [...inFlight.values()];
    inFlight.clear();
    terminateWorkers();                  // the strips are reported and re-queued below, not abandoned
    for (const f of stranded) {
        stats.failed++;
        // A `JobQueue` strip (the pyramid's) goes back to the head of its priority there (H7), not into this queue.
        if (f.req.onRequeue) { f.req.onRequeue(f.jobId, f === silent ? "watchdog" : "worker"); continue; }
        if (f.req.onDrop) f.req.onDrop({ jobId: f.jobId, plates: f.plates, why: "worker", before: false });
    }
    for (const f of stranded) if (!f.req.onRequeue) queue.push({ req: f.req, plates: f.plates });
    if (respawn && respawns < MAX_RESPAWNS) { respawns++; stats.respawns++; spawnPool(false); }
    else broken = true;
    if (e && e.preventDefault) e.preventDefault();
    pump();
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
 * Strips a worker, so a strip is a fraction of a worker's share and a free worker has one to
 * steal (§3.6). **Raising it is NOT the lever if the imbalance ratio misses its bar**: measured
 * over ten runs of §8.6 measurement 11 (15 plates, 4 workers) the ratio is 1.44–1.54 against a
 * bar of 1.5, and one plate a strip — the same lever at its limit — reads 1.35–1.62 and packs
 * more. One plate of that screen is 15–20× the median and no strip rule can split a plate.
 */
export const STRIPS_PER_WORKER = 2;

/** How many plates one strip holds: `ceil(plates / (workers × STRIPS_PER_WORKER))` (§3.6). */
export function stripSizeFor(nPlates, workerCount) {
    const n = workerCount != null ? workerCount : activeCount();
    return Math.max(1, Math.ceil(nPlates / Math.max(1, n * STRIPS_PER_WORKER)));
}

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
 * One render's missing plates (§5.1 step 6). Strips from an older frame are dropped where they
 * stand: a newer render asks for whatever of them it still wants.
 *
 * @param {object} req
 *   frameSeq, q, Zq   the render this belongs to (§8.4 rules 1 and 4)
 *   plates            Int32Array|number[] [i, j, …] — the misses, in the order to draw them
 *   pack(plates, jobId, pool) -> job|null   the caller packs (and calls `PlateStore.beginJob`)
 *   onResult(res, info)                     per job, on the main thread
 *   onDrop({ jobId, plates, why, before })  a strip dropped before dispatch, or a job that failed
 *   stillWanted(plates) -> boolean          optional: the store's own answer at dispatch time
 * @returns {number} the strips queued
 */
export function submitPlates(req) {
    const plates = req.plates instanceof Int32Array ? req.plates : Int32Array.from(req.plates || []);
    dropStale(req.frameSeq, req.q);
    current.set(req.q, req.frameSeq);
    const per = stripSizeFor(plates.length / 2) * 2;
    let n = 0;
    for (let at = 0; at < plates.length; at += per) {
        queue.push({ req, plates: plates.slice(at, at + per), prio: req.prio != null ? req.prio : 1 });
        n++;
    }
    pump();
    return n;
}

/**
 * Everything queued for an older frame **at this `q`**, dropped with why and when (§8.4 rule 4).
 * A strip at another `q` stays: its own request is still the newest there, which is what lets 5b
 * post the view's misses and the held quantum's in the same frame (D182). Only the QUEUE is
 * touched — a dispatched job is never recalled (the header's sixth rule).
 */
function dropStale(frameSeq, q) {
    for (let k = queue.length - 1; k >= 0; k--) {
        const e = queue[k];
        if (e.req.q !== q || e.req.frameSeq === frameSeq) continue;
        queue.splice(k, 1);
        stats.dropsBefore++;
        if (e.req.onDrop) e.req.onDrop({ jobId: null, plates: e.plates, why: "frame", before: true });
    }
    pruneCurrent();
}

/**
 * Forget every `q` with nothing queued and nothing in flight, so `current` holds one entry per
 * live request (`liveRequests`) rather than a session's zoom quanta, and `pump`'s check never
 * meets a `q` whose newest frame was forgotten. A `q` whose only strips are IN FLIGHT stays: a
 * worker error re-queues those strips, and `pump` would then read their `q` as stale.
 * Called from the two DROP paths, `dropStale` and `dropQueued`; `submitPlates` re-adds its own `q`
 * after. `pump`'s own stale drop does NOT prune, so a `q` whose last strip is dropped at the pull
 * stays counted until the next of those two calls — which is what `liveRequests` documents.
 */
function pruneCurrent() {
    const live = new Set();
    for (const e of queue) live.add(e.req.q);
    for (const f of inFlight.values()) live.add(f.req.q);
    for (const k of [...current.keys()]) if (!live.has(k)) current.delete(k);
}

/**
 * Drop the waiting strips of one `q`, or every waiting strip where `q` is omitted — a settle, a
 * quantum change, a teardown. **At a quantum change 5b passes the DEAD `q`** (§10 stage 5b): a
 * bare call also empties the newest quantum's strips and the settle's at `"e"`, which is the drop
 * D182 exists to stop. Only the QUEUE is touched — a dispatched job still arrives and is answered.
 * @param {string} [why] the reason carried to `onDrop`
 * @param {number|string} [q] that quantum's strips only; null or omitted means every strip
 * @returns {number} how many strips were dropped
 */
export function dropQueued(why, q) {
    let n = 0;
    for (let k = queue.length - 1; k >= 0; k--) {
        const e = queue[k];
        if (q != null && e.req.q !== q) continue;
        queue.splice(k, 1);
        stats.dropsBefore++;
        n++;
        if (e.req.onDrop) e.req.onDrop({ jobId: null, plates: e.plates, why: why || "dropped", before: true });
    }
    pruneCurrent();
    return n;
}

/** Hand strips to free workers while there are both. One job per worker (§8.4 rule 4). */
function pump() {
    for (;;) {
        if (!queue.length) return;
        const slot = freeSlot();
        if (slot === undefined) return;
        const k = bestIndex();
        if (k < 0) return;
        const e = queue.splice(k, 1)[0];
        if (current.get(e.req.q) !== e.req.frameSeq
            || (e.req.stillWanted && !e.req.stillWanted(e.plates))) {
            stats.dropsBefore++;
            if (e.req.onDrop) e.req.onDrop({ jobId: null, plates: e.plates, why: "stale", before: true });
            continue;
        }
        dispatch(e, slot);
    }
}

/** Requests of this `prio` or lower are speculative (the prebake, a snapshot) and may hold at most `workers − 1` slots. */
const LOW_PRIO = 3;

/**
 * The strip to run next (PAPER-PLAN §7.4): the lowest `prio`, and within one `prio` the oldest —
 * the FIFO a bare shift was. A preview re-queued by `dropStale` on every gesture frame is the newest
 * of `prio` 0, so it dispatches the moment a worker frees; without this it sat behind the previous
 * step's strips for the whole zoom-out it exists for. Speculative strips are skipped while their
 * kind holds `workers − 1` slots. The queue is a few screenfuls of strips; this runs once a dispatch.
 * @returns {number} the queue index, or -1 where nothing may run now
 */
function bestIndex() {
    let low = 0;
    for (const r of inFlight.values()) if ((r.req.prio != null ? r.req.prio : 1) >= LOW_PRIO) low++;
    const lowCap = Math.max(1, rasterWorkerCount() - 1);
    let best = -1, bestPrio = Infinity;
    for (let k = 0; k < queue.length; k++) {
        const p = queue[k].prio;
        if (p >= bestPrio) continue;
        if (p >= LOW_PRIO && low >= lowCap) continue;
        best = k; bestPrio = p;
        if (p === 0) break;
    }
    return best;
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
    if (!rec) { if (releaseAbandoned(slot)) pump(); return; }
    if (!data.ok) { onFailed(data.jobId, new Error(data.err || "cut failed"), slot); return; }
    inFlight.delete(data.jobId);
    if (rec.slot) rec.slot.jobId = null;
    stats.cutMs += now() - rec.postedAt;
    rec.req.onResult(data.out);
    pump();
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
 * is free or the pack declined. The queue above (`submitPlates`) is the old path's.
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
        if (releaseAbandoned(slot || null)) pump();
        return;
    }
    inFlight.delete(jobId);
    if (rec.slot) rec.slot.jobId = null;
    stats.failed++;
    if (rec.req.onDrop) {
        rec.req.onDrop({ jobId, plates: rec.plates, why: String((err && err.message) || err || "failed"), before: false });
    }
    pump();
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
        if (releaseAbandoned(slot)) pump();
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
    pump();
}

/**
 * One plate's RGBA as an `ImageBitmap`, which is the form `PictureLayer` composes — 5a's hand-off
 * (§15.3): a raw-pixel result becomes a bitmap HERE, before `PlateStore.put`, because the layer
 * composes bitmaps only and counts anything else in `noBitmap`. Returns null where the scope has
 * no `createImageBitmap` (jsdom, and any browser where §6.2's transfer path was never an option);
 * the caller then puts `pixels`, which the store accepts. The record `put` wants is
 * `{ frameId, q, Zq, i, j, G, bitmap|pixels }` and is the renderer's to build — this file knows the
 * plate indices and the job, not the frame id.
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
 * holds its share for the session, and without this field that reads as `inFlight: 0` with
 * `queued` climbing — a pool drawing with three workers, indistinguishable from a slow packer.
 *
 * `liveRequests` is how many quanta `current` still holds a newest `frameSeq` for (D182), so a
 * frame holding the old quantum while the new one fills reads 2 and a session's zoom quanta piling
 * up in the map would read as a number that only climbs. **Exactly when it falls**: `current` is
 * pruned at each `submitPlates` and each `dropQueued`, of every `q` with nothing queued and
 * nothing in flight — never when a job merely arrives, so a `q` whose last job has just been
 * answered is still counted until the next of those two calls.
 */
export function rasterWorkerReport() {
    let held = heldNoSlot;
    for (const s of workers) if (s.jobId === ABANDONED) held++;
    return {
        mode: transport ? "transport" : workers.length ? "workers" : "inline",
        workers: workers.length, wanted: rasterWorkerCount(), broken, respawns: stats.respawns, silent: stats.silent,
        queued: queue.length, inFlight: inFlight.size, heldSlots: held, liveRequests: current.size,
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
 * The suite's reset: counters, queue, pool and the broken flag. Does not spawn, and does NOT
 * report what is in flight — there is no caller left to report to between two tests. A live
 * teardown is `destroyRasterPool`, which does.
 */
export function resetRasterWorkerClient() {
    queue.length = 0;
    inFlight.clear();
    heldNoSlot = 0;
    terminateWorkers();
    broken = false;
    answered = false; respawns = 0;
    if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
    seq = 0;
    current.clear();
    countOverride = null;
    pool.clear();
    pool.takes = 0; pool.hits = 0; pool.allocBytes = 0;
    for (const k of Object.keys(stats)) stats[k] = 0;
    guardTotals.fill(0);
    countTotals.fill(0);
}
