/**
 * eraseWorkerClient.js — cuts and descents off the main thread: an interim pool of erase workers
 * behind `submit` (A2-scene.md §4.7, PLAN §5.3 A2-Q5), until the raster pool's queue takes the cut
 * kind — a transport swap behind the same call.
 *
 * `submit({kind, prio, barrier, job, key})` returns a promise of the result, or null where there is
 * no worker (jsdom, a script that did not load, a pool past its respawns): the caller then runs the
 * job inline, so every erase suite checks the same geometry. One queue — a barrier's jobs first,
 * then by `prio`, then in submission order — and a free worker takes its head. The worker script is
 * `public/erase-worker.js` (`npm run build:worker`).
 *
 * RW-1's discipline (`raster/rasterWorkerClient.js`): an error before any worker has answered marks
 * the pool broken for the session; after one has, an error or a job silent past `WATCHDOG_MS`
 * replaces the pool, `MAX_RESPAWNS` times, then the session goes inline. A job lost that way
 * rejects, and the caller runs it inline. `setEraseTransport` stands in for the pool in tests.
 */
import { wireJob, unwireResult } from "./eraseJob";
import { wireDescent, unwireDescentResult } from "./eraseDescent";
import { rasterWorkerCount, MAX_RESPAWNS, WATCHDOG_MS } from "./raster/rasterWorkerClient";

/** The erase pool's ceiling (A2 §4.7: 3 on 8 cores, 1 on 4). */
export const MAX_ERASE_WORKERS = 3;

let workers = [];          // { w, rec } — `rec` the job it holds, or null
let broken = false;
let answered = false;
let respawns = 0;
let watchdog = null;
let seq = 0;
let transport = null;      // (msg, transfer, kind) => Promise<resultMsg>; tests only
let transportSlots = MAX_ERASE_WORKERS;
let inTransport = 0;
const queue = [];          // records waiting for a free worker
const stats = { jobs: 0, inline: 0, failed: 0, respawns: 0, silent: 0 };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * A transport in place of the pool: `(msg, transfer, kind) => Promise<resultMsg>`, at most `slots`
 * jobs out at once. Tests only; null restores the pool.
 */
export function setEraseTransport(t, { slots = MAX_ERASE_WORKERS } = {}) {
    transport = t || null;
    transportSlots = Math.max(1, slots | 0);
    inTransport = 0;
}

/** `max(1, min(3, cores − 1 − rasterWorkers))` (A2 §4.7). */
export function eraseWorkerCount() {
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 1;
    return Math.max(1, Math.min(MAX_ERASE_WORKERS, cores - 1 - rasterWorkerCount()));
}

function workerUrl() {
    const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) || "";
    return base + "/erase-worker.js";
}

function spawn() {
    if (broken || workers.length) return workers.length;
    if (typeof Worker === "undefined") { broken = true; return 0; }
    const n = eraseWorkerCount();
    for (let k = 0; k < n; k++) {
        let w;
        try { w = new Worker(workerUrl()); } catch (err) { broken = true; terminate(); return 0; }
        const slot = { w, rec: null };
        w.onmessage = (e) => onMessage(slot, (e && e.data) || {});
        w.onerror = (e) => failPool(e, answered);
        workers.push(slot);
    }
    return workers.length;
}

function terminate() {
    for (const s of workers) { try { s.w.terminate(); } catch (err) { /* already gone */ } }
    workers = [];
}

/**
 * The job off the main thread: a promise of its result (a cut's regions as Loops, a descent's
 * steps), or null where there is no worker. `job` is `cutJob`'s input, or `{world, input}` for a
 * descent; its buffers are copied for the message, the caller's stay its own. `key` rides along for
 * the caller's own bookkeeping.
 */
export function submit({ kind, prio = 3, barrier = false, job, key = null }) {
    if (!transport && !spawn()) { stats.inline++; return null; }
    return new Promise((resolve, reject) => {
        queue.push({ id: ++seq, kind, prio, barrier: !!barrier, job, key, resolve, reject, postedAt: 0, suspect: 0 });
        stats.jobs++;
        pump();
    });
}

/** How many more jobs the pool would take now. */
export function eraseFreeSlots() {
    if (transport) return Math.max(0, transportSlots - inTransport);
    if (!spawn()) return 0;
    let n = 0;
    for (const s of workers) if (!s.rec) n++;
    return Math.max(0, n - queue.length);
}

function takeHead() {
    let best = -1;
    for (let k = 0; k < queue.length; k++) {
        const a = queue[k], b = best < 0 ? null : queue[best];
        if (!b || (a.barrier && !b.barrier) || (a.barrier === b.barrier && (a.prio < b.prio || (a.prio === b.prio && a.id < b.id)))) best = k;
    }
    return best < 0 ? null : queue.splice(best, 1)[0];
}

function wire(rec) {
    return rec.kind === "descent" ? wireDescent(rec.job.world, rec.job.input) : wireJob(rec.job);
}
function unwire(rec, out) {
    return rec.kind === "descent" ? unwireDescentResult(out) : unwireResult(out);
}

function pump() {
    if (transport) {
        while (queue.length && inTransport < transportSlots) {
            const rec = takeHead();
            const { msg, transfer } = wire(rec);
            inTransport++;
            const t = transport;
            t(msg, transfer, rec.kind).then(
                (out) => { if (t === transport) inTransport--; rec.resolve(unwire(rec, out)); pump(); },
                (err) => { if (t === transport) inTransport--; stats.failed++; rec.reject(err); pump(); },
            );
        }
        return;
    }
    for (const slot of workers) {
        if (slot.rec || !queue.length) continue;
        const rec = takeHead();
        let posted;
        try { posted = wire(rec); } catch (err) { rec.reject(err); continue; }
        slot.rec = rec;
        rec.postedAt = now();
        try { slot.w.postMessage({ id: rec.id, kind: rec.kind, job: posted.msg }, posted.transfer); } catch (err) { slot.rec = null; rec.reject(err); continue; }
        armWatchdog();
    }
}

function onMessage(slot, data) {
    const rec = slot.rec;
    if (!rec || rec.id !== data.id) return;
    answered = true;
    slot.rec = null;
    if (data.ok) {
        let out;
        try { out = unwire(rec, data.out); } catch (err) { rec.reject(err); pump(); return; }
        rec.resolve(out);
    } else { stats.failed++; rec.reject(new Error(data.err || "erase worker failed")); }
    pump();
}

/** The pool failed: every job it held rejects (the caller runs it inline); a new pool, or inline for the session. */
function failPool(e, respawn) {
    const held = workers.map((s) => s.rec).filter(Boolean);
    terminate();
    for (const rec of held) { stats.failed++; rec.reject(new Error("erase worker unavailable")); }
    if (respawn && respawns < MAX_RESPAWNS) { respawns++; stats.respawns++; spawn(); }
    else {
        broken = true;
        const waiting = queue.splice(0);
        for (const rec of waiting) rec.reject(new Error("erase worker unavailable"));
    }
    if (e && e.preventDefault) e.preventDefault();
    pump();
}

function armWatchdog() {
    if (watchdog != null || !workers.length) return;
    watchdog = setTimeout(checkWatchdog, WATCHDOG_MS / 2);
}

/** A job past `WATCHDOG_MS` is marked, and its pool replaced only if still unanswered at the next check (RW-1). */
function checkWatchdog() {
    watchdog = null;
    const t = now();
    for (const s of workers) {
        const rec = s.rec;
        if (!rec || t - rec.postedAt < WATCHDOG_MS) continue;
        if (!rec.suspect) { rec.suspect = t; continue; }
        stats.silent++;
        failPool(null, true);
        return;
    }
    if (workers.some((s) => s.rec)) armWatchdog();
}

/** Dev/diagnostics: the pool's state and counts. */
export function eraseWorkerStats() {
    return { ...stats, seq, workers: workers.length, busy: workers.filter((s) => s.rec).length, queued: queue.length,
        broken, transport: !!transport, inTransport };
}
