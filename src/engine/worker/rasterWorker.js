/* eslint-env worker */
/* eslint-disable no-restricted-globals */
/**
 * rasterWorker.js — one strip of plates, one cut or one RAM-tier restore (`kind: "ram-restore"`, F161) per message
 * (bundled to public/raster-worker.js by `npm run build:worker`; plates and cuts share the pool, PLAN §1.6). A `ram`
 * job's whole plates also go back packed (`plateCodec.js`) from the RGBA scratch. A cut (`kind: "cut-job"`) runs
 * `cutJob` or `descentJob`, the functions the main thread would run (`runCut`), and answers
 * `kind: "cut-result"`. A strip's job arrives as RASTERISER-PLAN §3.3's transferred typed arrays,
 * `rasterCore.renderPlate` draws each plate into the one RGBA scratch, and the pixels, the
 * per-plate timings and counts, the job's seven guard words and the job's own buffers go back
 * as §3.4's result. Nothing here knows about a document, a camera or a canvas.
 *
 * Five rules a reader needs in order not to break it:
 *  - THE RGBA SCRATCH IS REUSED BY THE NEXT PLATE, so a plate is serialised — a bitmap awaited,
 *    or the bytes copied — BEFORE the next one is drawn (§3.5). `new ImageData(u8c, w, h)`
 *    aliases rather than copies.
 *  - DURATIONS ONLY, NEVER ABSOLUTE TIMES (§8.2, X6). A worker's `performance.timeOrigin` is
 *    its own creation time, so an absolute stamp from here differs from the main thread's by
 *    the worker's age. The main thread owns `postedAt` and `arrivedAt` and subtracts.
 *  - THE TIMINGS PARTITION THE WORKER'S TIME. Σ recvToStartMs + Σ startToFinishMs + serialiseMs
 *    is receipt-to-post, the tail after the last plate included, so the client's queueing
 *    subtraction cannot hide a phase in a gap.
 *  - AN EMPTY PLATE IS NEVER ALLOCATED (§3.4): its bitmap (or pixel block) is null. The caller
 *    paints paper over that rectangle rather than leaving what was there — a null is "nothing is
 *    drawn here", never "keep the old plate" (§6.2). **Empty means no item survived the PRUNE**,
 *    a box test, not a count of painted pixels (D177). A clipped plate (`job.clips`, A3 §3.1) is
 *    its clip's rectangle alone, and its null is paper over the clip. The result carries the
 *    job's generation `G` back unchanged (A2 §3.1).
 *  - THE GUARDS ARE THE JOB'S, RESET WHEN IT IS TAKEN (§3.4). `nonFinite`, `fullClears`,
 *    `arcClamped` and `arcOverTurn` are the only evidence that a record was refused; a wire
 *    that drops them makes that invisible in the report as well as in the picture.
 *
 * `runJob` is exported because `rasterWorkerClient`'s inline fallback runs it on the main
 * thread — jsdom always takes that path, so every raster suite checks the same pixels.
 */

import "../../polyfills";
import {
    unwireJob, wireResult, copyPlate,
    TIMINGS_PER_PLATE, COUNTS_PER_PLATE, GUARDS_PER_JOB, GUARD_NAMES,
} from "../raster/rasterJob";
import { renderPlate, coreStats, TW, TH } from "../raster/rasterCore";
import { encodePlate, decodePlate } from "../raster/plateCodec";
import { cutJob, unwireJob as unwireCut, wireResult as wireCutResult } from "../eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "../eraseDescent";

/** The one plate of scratch this worker ever holds (§3.5): 1.05 MB, allocated once. */
const RGBA = new Uint8ClampedArray(TW * TH * 4);
/** A restore's own scratch: restores run one at a time (`restoring`), between and during jobs. */
let RESTORE = null;
let restoring = Promise.resolve();

/** The job's own buffers, handed back for the main thread's pool (§3.6). */
const RECYCLE = ["geom", "meta", "attr", "subs", "rgb", "runs", "subRun"];

const CLOCK = typeof performance !== "undefined" ? performance : Date;

/** Zero the core's counters: this job's guards are its own (§3.4). */
function resetGuards() {
    for (const k of GUARD_NAMES) coreStats[k] = 0;
}

/**
 * One job: every plate of the strip, in the order the job lists them.
 *
 * @param {object} msg §3.3's job as it arrived (the arrays are the message's own)
 * @param {object} [opts]
 *   receivedAt  the worker's own clock when the message arrived; defaults to now
 *   clock       an object with `now()`, for the suite's offset-origin case (X6)
 *   bitmaps     force the ImageBitmap path on or off; defaults to what this global scope has
 * @returns {Promise<{ msg: object, transfer: any[] }>} §3.4's result, wired and ready to post
 */
export async function runJob(msg, opts) {
    const o = opts || {};
    const clock = o.clock || CLOCK;
    let mark = o.receivedAt != null ? o.receivedAt : clock.now();

    resetGuards();
    const job = unwireJob(msg);
    const nPlates = job.plates.length / 2;
    const timings = new Float64Array(TIMINGS_PER_PLATE * nPlates);
    const counts = new Uint32Array(COUNTS_PER_PLATE * nPlates);
    const useBitmap = o.bitmaps != null
        ? !!o.bitmaps
        : (typeof createImageBitmap === "function" && typeof ImageData === "function");
    const bitmaps = useBitmap ? new Array(nPlates).fill(null) : null;
    const pixels = useBitmap ? null : new Array(nPlates).fill(null);
    const packed = job.ram && !job.clips ? new Array(nPlates).fill(null) : null;
    let serialiseMs = 0, encodeMs = 0;

    for (let p = 0; p < nPlates; p++) {
        const t0 = clock.now();
        timings[p * TIMINGS_PER_PLATE] = t0 - mark;
        const clip = job.clips ? job.clips.subarray(p * 4, p * 4 + 4) : null;
        renderPlate(job, p, RGBA,
            counts.subarray(p * COUNTS_PER_PLATE, (p + 1) * COUNTS_PER_PLATE),
            timings.subarray(p * TIMINGS_PER_PLATE, (p + 1) * TIMINGS_PER_PLATE), clip);
        const t1 = clock.now();
        timings[p * TIMINGS_PER_PLATE + 1] = t1 - t0;

        const drawn = counts[p * COUNTS_PER_PLATE + 1];
        if (drawn > 0) {
            // The RAM tier's copy (F161), from the pixels this worker already holds.
            if (packed) { const te = clock.now(); packed[p] = encodePlate(RGBA); encodeMs += clock.now() - te; }
            // Serialised here and not after the loop: the next plate overwrites RGBA (§3.5).
            if (useBitmap) {
                const img = new ImageData(RGBA, TW, TH);
                bitmaps[p] = await (clip ? createImageBitmap(img, clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]) : createImageBitmap(img));
            } else pixels[p] = copyPlate(RGBA, clip);
        }
        const t2 = clock.now();
        serialiseMs += t2 - t1;
        mark = t2;
    }

    const guards = new Uint32Array(GUARDS_PER_JOB);
    for (let g = 0; g < GUARD_NAMES.length; g++) guards[g] = coreStats[GUARD_NAMES[g]] | 0;

    const recycled = [];
    for (const k of RECYCLE) if (job[k] && job[k].buffer) recycled.push(job[k]);

    const out = wireResult({
        jobId: job.jobId, frameSeq: job.frameSeq, G: job.G,
        plates: job.plates, clips: job.clips || null,
        bitmaps, pixels, packed,
        timings, counts, guards,
        recycled, serialiseMs, encodeMs,
    });
    // The tail — the guards and the transfer list — is serialisation too. Leaving it
    // out would leave a phase in no bucket, and the main thread's subtraction would report it as
    // queueing (§8.2). With it the three phases partition receipt-to-post; W2 asserts that.
    out.msg.serialiseMs = serialiseMs + (clock.now() - mark);
    return out;
}

/**
 * One RAM-tier plate unpacked (F161): `{ id, bytes }` (`plateCodec`'s words) in, `{ kind: "ram-result", id, ok,
 * bitmap | pixels, ms }` out — a bitmap where the scope makes one, else the plate's own pixels. Serialised (`restoring`):
 * the bitmap path decodes into the one restore scratch and awaits its bitmap before the next. The inline path (no
 * worker) runs this same function on the main thread.
 * @returns {Promise<{ msg: object, transfer: any[] }>}
 */
export function runRestore(msg, opts) {
    const p = restoring.then(() => restoreOne(msg, opts || {}));
    restoring = p.catch(() => null);
    return p;
}

async function restoreOne(msg, o) {
    const useBitmap = o.bitmaps != null ? !!o.bitmaps : (typeof createImageBitmap === "function" && typeof ImageData === "function");
    const t0 = CLOCK.now();
    if (!useBitmap) {
        const px = decodePlate(msg.bytes, new Uint8ClampedArray(TW * TH * 4));
        return { msg: { kind: "ram-result", id: msg.id, ok: true, pixels: px, ms: CLOCK.now() - t0 }, transfer: [px.buffer] };
    }
    if (!RESTORE) RESTORE = new Uint8ClampedArray(TW * TH * 4);
    decodePlate(msg.bytes, RESTORE);
    const bitmap = await createImageBitmap(new ImageData(RESTORE, TW, TH));
    return { msg: { kind: "ram-result", id: msg.id, ok: true, bitmap, ms: CLOCK.now() - t0 }, transfer: [bitmap] };
}

/**
 * One cut or descent (`kind` "cut" | "descent"), its wired job in and its wired result out — the inline
 * path (a broken pool) runs this same function on the main thread.
 * @returns {{ msg: object, transfer: any[] }}
 */
export function runCut(kind, job) {
    if (kind === "descent") { const { world, input } = unwireDescent(job); return wireDescentResult(descentJob(world, input)); }
    return wireCutResult(cutJob(unwireCut(job)));
}

// The entry itself. A dedicated worker has no `window`; the main thread and jsdom do, and
// assigning `self.onmessage` there would take over the page's own message handler.
if (typeof window === "undefined" && typeof self !== "undefined" && typeof self.postMessage === "function") {
    self.onmessage = (e) => {
        const msg = (e && e.data) || {};
        if (msg.kind === "ram-restore") {
            runRestore(msg).then((out) => self.postMessage(out.msg, out.transfer),
                (err) => self.postMessage({ kind: "ram-result", id: msg.id, ok: false, err: String((err && err.message) || err) }));
            return;
        }
        if (msg.kind === "cut-job") {
            let out;
            try { out = runCut(msg.cut, msg.job); } catch (err) {
                self.postMessage({ kind: "cut-result", jobId: msg.jobId, ok: false, err: String((err && err.message) || err) });
                return;
            }
            self.postMessage({ kind: "cut-result", jobId: msg.jobId, ok: true, out: out.msg }, out.transfer);
            return;
        }
        const receivedAt = CLOCK.now();
        Promise.resolve()
            .then(() => runJob(msg, { receivedAt }))
            .then((out) => self.postMessage(out.msg, out.transfer))
            .catch((err) => self.postMessage({
                kind: "raster-error", jobId: msg.jobId, frameSeq: msg.frameSeq,
                err: String((err && err.message) || err),
            }));
    };
}
