/**
 * rasterJob.js — the wire between the main thread and a raster worker: the typed-array
 * layouts of RASTERISER-PLAN §3.3 (the job) and §3.4 (the result), the buffer pool the job's
 * arrays come from, and the staleness rule the epochs exist for (§5.4, D25).
 *
 * Everything crosses as typed arrays and every one of them is in the transfer list — an
 * ImageBitmap is serializable as well as transferable, so leaving one out silently copies
 * 1.05 MB per plate instead of moving it (§3.4).
 *
 * This file holds the format and nothing else: no geometry, no canvas, no worker. The packer
 * (`rasterPack.js`) fills the layouts, the core (`rasterCore.js`) reads them, and stage 3's
 * client and worker carry them.
 */

import { PLATE_PX } from "./plate";

/** §3.3: 8 words an item in `meta`, 9 doubles an item in `attr`, 3 bytes an item in `rgb`. */
export const META_WORDS = 8;
export const ATTR_DOUBLES = 9;
export const RGB_BYTES = 3;

/** `meta` word names, in order, so a reader of a dump does not count columns. */
export const META_NAMES = ["kind", "fam", "geomStart", "geomLen", "subStart", "subCount", "flags", "masks"];
/**
 * `attr` double names: the box is in frame units with `res` ALREADY added (§3.3). The ninth is
 * §3.3's one-time reserved double, spent by D90 on the family's union sign (+1, −1, or 0 for an
 * item that is not a union item).
 */
export const ATTR_NAMES = ["x0", "y0", "x1", "y1", "resX", "resY", "lwFrame", "alpha", "unionSign"];

/** `meta[0]`: 0 = the `geometry/loop.js` grammar, 1 = flat rings. There is no kind 2 (§3.3). */
export const KIND_LOOPS = 0;
export const KIND_RINGS = 1;

/** `meta[6]` bits. `union` says this item's rings may overlap, so it takes the union pass (§4.2). */
export const FLAG_COVERS = 1;
export const FLAG_ERASE = 2;
export const FLAG_UNION = 4;
/**
 * A pending eraser mark: it paints nothing and masks the ink it has not baked (Kobin, 2026-09-23).
 * Its `meta[7]` is its mask's index; every other item's `meta[7]` is the bits of the masks over it.
 */
export const FLAG_MASK = 8;
/** Masks one job may carry; a mark past the last shares it. */
export const MASKS_MAX = 8;

/** §8.2, §8.3: what one plate and one job report back. The names are the report's column heads. */
export const TIMINGS_PER_PLATE = 7;
export const COUNTS_PER_PLATE = 8;
export const GUARDS_PER_JOB = 7;
export const TIMING_NAMES = ["recvToStartMs", "startToFinishMs", "engClipMs", "engLocalMs", "rasEdgesMs", "rasUnionMs", "rasAccumMs"];
export const COUNT_NAMES = ["items", "itemsDrawn", "families", "unionItems", "edges", "chords", "rowsTouched", "coveredPx"];
export const GUARD_NAMES = ["xsGrown", "unionSplits", "unionRefills", "fullClears", "nonFinite", "arcClamped", "arcOverTurn"];

/** The fields of a job that cross as typed arrays, in the order they are wired. */
const JOB_ARRAYS = ["epochs", "plates", "paper", "meta", "attr", "rgb", "subs", "geom", "ids"];

const BYTES = (a) => (a ? a.byteLength : 0);

/**
 * A free list of ArrayBuffers by size class, so a three-octave zoom does not allocate and
 * detach the screen's geometry twelve times over (§3.6). `take` hands back a view of exactly
 * the length asked for; `give` takes the raw buffer the worker returned in `recycled`.
 */
export class BufferPool {
    /** @param {number} maxBytes the pool's own cap; buffers over it are dropped rather than held */
    constructor(maxBytes = 8 << 20) {
        this.maxBytes = maxBytes;
        this.bytes = 0;
        this.takes = 0; this.hits = 0; this.allocBytes = 0;
        /** @type {Map<number, ArrayBuffer[]>} by buffer byteLength */
        this._free = new Map();
    }
    /** A view of `len` elements of `ctor`, over a pooled buffer when one fits. */
    take(ctor, len) {
        const want = classOf(len * ctor.BYTES_PER_ELEMENT);
        this.takes++;
        const list = this._free.get(want);
        if (list && list.length) {
            const buf = list.pop();
            this.bytes -= buf.byteLength;
            this.hits++;
            return new ctor(buf, 0, len);
        }
        this.allocBytes += want;
        return new ctor(new ArrayBuffer(want), 0, len);
    }
    /** Put a buffer (or a view's buffer) back. A detached buffer is ignored. */
    give(b) {
        const buf = b && b.buffer ? b.buffer : b;
        if (!buf || !buf.byteLength) return;
        if (this.bytes + buf.byteLength > this.maxBytes) return;
        let list = this._free.get(buf.byteLength);
        if (!list) { list = []; this._free.set(buf.byteLength, list); }
        list.push(buf);
        this.bytes += buf.byteLength;
    }
    clear() { this._free.clear(); this.bytes = 0; }
}

/** Size classes: 4 KiB up to 64 KiB, then powers of two, so one class serves many jobs. */
function classOf(n) {
    let c = 4096;
    while (c < n) c *= 2;
    return c;
}

/**
 * The job as it goes on the wire, with its transfer list. Every typed array is transferred:
 * the main thread must not keep a live view of a buffer the worker owns.
 * @returns {{ msg: object, transfer: ArrayBuffer[] }}
 */
export function wireJob(job) {
    validateJob(job);
    const msg = {
        kind: "raster-job",
        jobId: job.jobId, frameSeq: job.frameSeq, postedAt: job.postedAt,
        q: job.q, Zq: job.Zq, plateW: job.plateW != null ? job.plateW : PLATE_PX,
        nItems: job.nItems,
    };
    const transfer = [];
    for (const k of JOB_ARRAYS) {
        const a = job[k];
        msg[k] = a;
        if (a && a.buffer && transfer.indexOf(a.buffer) < 0) transfer.push(a.buffer);
    }
    return { msg, transfer };
}

/** The job the worker reads, from the message it received. The arrays are the same bytes. */
export function unwireJob(msg) {
    const job = {
        jobId: msg.jobId, frameSeq: msg.frameSeq, postedAt: msg.postedAt,
        q: msg.q, Zq: msg.Zq, plateW: msg.plateW, nItems: msg.nItems,
    };
    for (const k of JOB_ARRAYS) job[k] = msg[k];
    validateJob(job);
    return job;
}

/**
 * The checks a wire bug would otherwise hide: the core reads loop k's end from entry k + 1, so
 * a `subs` table that is not ascending, or one entry short, reads a length as an offset and the
 * ink disappears with no error and no counter (§3.3, D36). O(items + subs), no geometry.
 * Throws, because a job that fails this paints a wrong picture rather than a slow one.
 */
export function validateJob(job) {
    const n = job.nItems | 0;
    if (!(n >= 0)) throw new Error("rasterJob: nItems is not a count");
    if (job.meta.length < n * META_WORDS) throw new Error("rasterJob: meta is short");
    if (job.attr.length < n * ATTR_DOUBLES) throw new Error("rasterJob: attr is short");
    if (job.rgb.length < n * RGB_BYTES) throw new Error("rasterJob: rgb is short");
    if (job.ids && job.ids.length < n) throw new Error("rasterJob: ids is short");
    if (job.plates.length % 2) throw new Error("rasterJob: plates is not [i, j, …]");
    if (job.epochs && job.epochs.length * 2 !== job.plates.length) {
        throw new Error("rasterJob: one epoch per plate (§5.4)");
    }
    let fam = -1;
    for (let it = 0; it < n; it++) {
        const m = it * META_WORDS;
        const kind = job.meta[m], gs = job.meta[m + 2], gl = job.meta[m + 3];
        const ss = job.meta[m + 4], sc = job.meta[m + 5];
        if (kind !== KIND_LOOPS && kind !== KIND_RINGS) throw new Error("rasterJob: item " + it + " has kind " + kind);
        if (gs + gl > job.geom.length) throw new Error("rasterJob: item " + it + " runs past geom");
        if (ss + sc > job.subs.length) throw new Error("rasterJob: item " + it + " runs past subs");
        if (sc < 1) throw new Error("rasterJob: item " + it + " has no sub-chain");
        if (job.meta[m + 1] < fam) throw new Error("rasterJob: family indices must ascend in paint order");
        fam = job.meta[m + 1];
        const scale = kind === KIND_LOOPS ? 1 : 2;
        let prev = -1;
        for (let k = 0; k < sc; k++) {
            const off = job.subs[ss + k] * scale;
            if (off <= prev) throw new Error("rasterJob: item " + it + " sub " + k + " does not ascend (D36)");
            if (off >= gl) throw new Error("rasterJob: item " + it + " sub " + k + " starts past its geom span");
            prev = off;
        }
    }
    return job;
}

/**
 * The result as it goes back, with its transfer list (§3.4). `bitmaps` may hold nulls for
 * empty plates; a null is not transferable and is skipped.
 * @returns {{ msg: object, transfer: any[] }}
 */
export function wireResult(res) {
    const msg = {
        kind: "raster-result",
        jobId: res.jobId, frameSeq: res.frameSeq,
        plates: res.plates, epochs: res.epochs,
        bitmaps: res.bitmaps || null, pixels: res.pixels || null,
        idOff: res.idOff, idSet: res.idSet,
        timings: res.timings, counts: res.counts, guards: res.guards,
        recycled: res.recycled || [],
        serialiseMs: res.serialiseMs || 0,
    };
    const transfer = [];
    const push = (x) => { if (x && transfer.indexOf(x) < 0) transfer.push(x); };
    for (const k of ["plates", "epochs", "idOff", "idSet", "timings", "counts", "guards"]) {
        if (msg[k] && msg[k].buffer) push(msg[k].buffer);
    }
    if (msg.bitmaps) for (const b of msg.bitmaps) if (b) push(b);
    if (msg.pixels) for (const p of msg.pixels) if (p) push(p.buffer || p);
    for (const r of msg.recycled) push(r.buffer || r);
    return { msg, transfer };
}

/** The result the main thread reads. */
export function unwireResult(msg) {
    return {
        jobId: msg.jobId, frameSeq: msg.frameSeq,
        plates: msg.plates, epochs: msg.epochs,
        bitmaps: msg.bitmaps, pixels: msg.pixels,
        idOff: msg.idOff, idSet: msg.idSet,
        timings: msg.timings, counts: msg.counts, guards: msg.guards,
        recycled: msg.recycled || [],
        serialiseMs: msg.serialiseMs || 0,
    };
}

/**
 * Which plates of an arrived result are stale, by the epoch the store holds for each key now
 * (§5.4, D25): a plate posted before a document change and arrived after it must be discarded
 * and re-posted, because the event that should have dropped it has already been consumed.
 * `epochOf(i, j)` returns the store's current epoch for that plate.
 * @returns {{ stale: number[], why: string } | null}
 */
export function resultStale(res, epochOf) {
    const stale = [];
    for (let p = 0; p * 2 < res.plates.length; p++) {
        const i = res.plates[p * 2], j = res.plates[p * 2 + 1];
        if (res.epochs[p] !== epochOf(i, j)) stale.push(p);
    }
    return stale.length ? { stale, why: "epoch" } : null;
}

/**
 * One plate's pixels out of the worker's RGBA scratch. This is a COPY and has to be: the
 * scratch is reused by the next plate of the strip, `new ImageData(u8c, w, h)` aliases rather
 * than copies, and a transferred buffer is detached (§3.5). 1.05 MB a plate, which is the
 * fallback path's honest cost and measurement 7's other column.
 */
export function copyPlate(rgba) {
    return new Uint8ClampedArray(rgba);
}

/** The job's bytes on the wire — `bytesIn` of §8.3, which is per JOB and never per plate. */
export function jobBytes(job) {
    let n = 0;
    for (const k of JOB_ARRAYS) n += BYTES(job[k]);
    return n;
}

/** The result's bytes, counting a plate's pixels at PLATE_PX² × 4 whichever path carried them. */
export function resultBytes(res) {
    let n = BYTES(res.idOff) + BYTES(res.idSet) + BYTES(res.timings) + BYTES(res.counts) + BYTES(res.guards)
        + BYTES(res.plates) + BYTES(res.epochs);
    const px = PLATE_PX * PLATE_PX * 4;
    if (res.pixels) for (const p of res.pixels) { if (p) n += p.byteLength != null ? p.byteLength : px; }
    else if (res.bitmaps) for (const b of res.bitmaps) if (b) n += px;
    return n;
}
