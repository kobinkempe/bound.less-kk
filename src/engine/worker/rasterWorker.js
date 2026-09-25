/* eslint-env worker */
/* eslint-disable no-restricted-globals */
/**
 * rasterWorker.js — one strip of plates per message (bundled to public/raster-worker.js by
 * `npm run build:worker`). The job arrives as RASTERISER-PLAN §3.3's transferred typed arrays,
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
 *  - AN EMPTY PLATE IS NEVER ALLOCATED (§3.4): its bitmap (or pixel block) is null and its id
 *    run is empty. The caller paints paper over that rectangle rather than leaving what was
 *    there — a null is "nothing is drawn here", never "keep the old plate" (§6.2). **Empty means
 *    no item survived the PRUNE**, which is a box test, not a count of painted pixels: a plate
 *    every item reaches and none paints still allocates. That is the safe direction — the id set
 *    stays a superset, so an invalidation drops too much rather than too little (D177).
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
import { renderPlate, coreStats, drawnFlags, TW, TH } from "../raster/rasterCore";

/** The one plate of scratch this worker ever holds (§3.5): 1.05 MB, allocated once. */
const RGBA = new Uint8ClampedArray(TW * TH * 4);

/** The job's own buffers, handed back for the main thread's pool (§3.6). */
const RECYCLE = ["geom", "meta", "attr", "subs", "rgb", "ids"];

const CLOCK = typeof performance !== "undefined" ? performance : Date;

/** Zero the core's counters: this job's guards are its own (§3.4). */
function resetGuards() {
    for (const k of GUARD_NAMES) coreStats[k] = 0;
}

/**
 * The plate's painted-id set, built from the core's OWN prune flags (`drawnFlags`, D163): every
 * item that survived the prune, ascending and without repeats, which is what `PlateStore`
 * binary-searches (D84). Derived pieces of one object share an id, so the set is usually shorter
 * than `counts[itemsDrawn]`. Call it straight after `renderPlate` — the flags are that plate's.
 */
function idsForPlate(job) {
    const n = job.nItems | 0;
    const drawn = drawnFlags();
    const out = [];
    for (let it = 0; it < n; it++) if (drawn[it]) out.push(job.ids[it]);
    out.sort((u, v) => u - v);
    let w = 0;
    for (let k = 0; k < out.length; k++) if (k === 0 || out[k] !== out[k - 1]) out[w++] = out[k];
    out.length = w;
    return out;
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
    const idOff = new Uint32Array(nPlates);
    const useBitmap = o.bitmaps != null
        ? !!o.bitmaps
        : (typeof createImageBitmap === "function" && typeof ImageData === "function");
    const bitmaps = useBitmap ? new Array(nPlates).fill(null) : null;
    const pixels = useBitmap ? null : new Array(nPlates).fill(null);
    const ids = [];
    let serialiseMs = 0;

    for (let p = 0; p < nPlates; p++) {
        const t0 = clock.now();
        timings[p * TIMINGS_PER_PLATE] = t0 - mark;
        renderPlate(job, p, RGBA,
            counts.subarray(p * COUNTS_PER_PLATE, (p + 1) * COUNTS_PER_PLATE),
            timings.subarray(p * TIMINGS_PER_PLATE, (p + 1) * TIMINGS_PER_PLATE));
        const t1 = clock.now();
        timings[p * TIMINGS_PER_PLATE + 1] = t1 - t0;

        idOff[p] = ids.length;
        const drawn = counts[p * COUNTS_PER_PLATE + 1];
        if (drawn > 0) {
            const set = idsForPlate(job);
            for (let k = 0; k < set.length; k++) ids.push(set[k]);
            // Serialised here and not after the loop: the next plate overwrites RGBA (§3.5).
            if (useBitmap) bitmaps[p] = await createImageBitmap(new ImageData(RGBA, TW, TH));
            else pixels[p] = copyPlate(RGBA);
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
        jobId: job.jobId, frameSeq: job.frameSeq,
        plates: job.plates, epochs: job.epochs,
        bitmaps, pixels,
        idOff, idSet: Int32Array.from(ids),
        timings, counts, guards,
        recycled, serialiseMs,
    });
    // The tail — the guards, the id set and the transfer list — is serialisation too. Leaving it
    // out would leave a phase in no bucket, and the main thread's subtraction would report it as
    // queueing (§8.2). With it the three phases partition receipt-to-post; W2 asserts that.
    out.msg.serialiseMs = serialiseMs + (clock.now() - mark);
    return out;
}

// The entry itself. A dedicated worker has no `window`; the main thread and jsdom do, and
// assigning `self.onmessage` there would take over the page's own message handler.
if (typeof window === "undefined" && typeof self !== "undefined" && typeof self.postMessage === "function") {
    self.onmessage = (e) => {
        const msg = (e && e.data) || {};
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
