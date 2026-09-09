/**
 * eraseWorkerClient.js — one cut at a time, off the main thread.
 *
 * The worker script is `public/erase-worker.js`, built by `npm run build:worker`
 * (esbuild bundles worker/eraseWorker.js with the geometry layer; CRA 4 has no worker
 * syntax webpack 4 accepts). Where there is no Worker, or the script fails to load,
 * `runCutAsync` returns null and the pipeline runs `cutJob` inline — jsdom always does,
 * so every erase suite checks the same geometry. A test can stand in a transport with
 * `setEraseTransport` to exercise the asynchronous path.
 */
import { wireJob, unwireResult } from "./eraseJob";
import { wireDescent, unwireDescentResult } from "./eraseDescent";

let worker = null;
let broken = false;
let seq = 0;
const pending = new Map();
let transport = null;   // (msg, transfer) => Promise<resultMsg>; tests only

export function setEraseTransport(t) { transport = t || null; }

function workerUrl() {
    const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) || "";
    return base + "/erase-worker.js";
}

function getWorker() {
    if (broken) return null;
    if (worker) return worker;
    if (typeof Worker === "undefined") { broken = true; return null; }
    try {
        worker = new Worker(workerUrl());
    } catch (err) {
        broken = true;
        return null;
    }
    worker.onmessage = (e) => {
        const { id, ok, out, err } = e.data || {};
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.resolve(out); else p.reject(new Error(err || "erase worker failed"));
    };
    worker.onerror = (e) => {
        // The script did not load (a 404, a CSP) or threw outside a job: every
        // waiting job goes back to the main thread, and so does every later one.
        broken = true;
        const failed = [...pending.values()];
        pending.clear();
        try { worker.terminate(); } catch (err2) { /* ignore */ }
        worker = null;
        for (const p of failed) p.reject(new Error("erase worker unavailable"));
        if (e && e.preventDefault) e.preventDefault();
    };
    return worker;
}

/** Is there somewhere to send a cut? (Once false, false for the session.) */
export function eraseWorkerAvailable() { return !!transport || !!getWorker(); }

/**
 * The cut off the main thread: a promise of the result (regions as Loops), or null
 * where there is no worker. The job's loops are copied for the message; the caller's
 * stay its own.
 */
export function runCutAsync(job) {
    const { msg, transfer } = wireJob(job);
    return post("cut", msg, transfer, unwireResult);
}
/** The descent off the main thread (eraseDescent.js): a promise of the steps, or null where there is no worker. */
export function runDescentAsync(world, input) {
    const { msg, transfer } = wireDescent(world, input);
    return post("descent", msg, transfer, unwireDescentResult);
}
function post(kind, msg, transfer, unwire) {
    if (transport) return transport(msg, transfer, kind).then(unwire);
    const w = getWorker();
    if (!w) return null;
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        try { w.postMessage({ id, kind, job: msg }, transfer); } catch (err) { pending.delete(id); reject(err); }
    }).then(unwire);
}

/** Dev/diagnostics: how many cuts have gone through the worker. */
export function eraseWorkerStats() { return { seq, pending: pending.size, broken, transport: !!transport }; }
