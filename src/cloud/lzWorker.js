/**
 * lz-string compression for the cloud payload, in a Web Worker.
 *
 * The worker script is `public/lz-worker.js` (a plain file, not bundled — CRA 4
 * has no worker syntax webpack 4 accepts without a loader, and the eslint
 * preset refuses loader syntax). Where there is no Worker, or the script fails
 * to load, or a job errors, the work runs synchronously on the main thread
 * instead, which is what the app did before. So the fallback is never worse
 * than the old behaviour; the worker is only ever better.
 */
import LZString from "lz-string";

let worker = null;
let broken = false;
let seq = 0;
const pending = new Map();

function workerUrl() {
    const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) || "";
    return base + "/lz-worker.js";
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
        if (ok) p.resolve(out); else p.reject(new Error(err || "lz worker failed"));
    };
    worker.onerror = (e) => {
        // The script did not load (a 404, a CSP) or threw outside a job: every
        // waiting job falls back to the main thread, and so does every later one.
        broken = true;
        const failed = [...pending.values()];
        pending.clear();
        try { worker.terminate(); } catch (err2) { /* ignore */ }
        worker = null;
        for (const p of failed) p.reject(new Error("lz worker unavailable"));
        if (e && e.preventDefault) e.preventDefault();
    };
    return worker;
}

function run(op, data, transfer) {
    const w = getWorker();
    if (!w) return null;
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        try { w.postMessage({ id, op, data }, transfer || []); }
        catch (err) { pending.delete(id); reject(err); }
    });
}

/** kobin-1 JSON string -> compressed bytes, off the main thread when possible. */
export async function compressToUint8Array(json) {
    const job = run("compress", json);
    if (job) {
        try { return await job; } catch (err) { /* fall through */ }
    }
    return LZString.compressToUint8Array(json);
}

/** Compressed bytes -> the JSON string ("" for nothing). The bytes are copied first; the worker takes ownership of its copy. */
export async function decompressFromUint8Array(u8) {
    const job = run("decompress", u8.slice(), null);
    if (job) {
        try {
            const out = await job;
            return out == null ? "" : out;
        } catch (err) { /* fall through */ }
    }
    return LZString.decompressFromUint8Array(u8) ?? "";
}

/** Tests only. */
export function _resetLzWorkerForTests() {
    if (worker) { try { worker.terminate(); } catch (err) { /* ignore */ } }
    worker = null; broken = false; pending.clear();
}
