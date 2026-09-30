/**
 * rasterPack.js — the main thread's half of the raster path (RASTERISER-PLAN §4.8, §5.2, §3.3).
 * It turns a render list into the typed-array job the core eats: the item box without `res`,
 * the plate binner, the ring packer, the stroke band, the union flag, family grouping, colour,
 * and the §3.3 layout filled from a buffer pool.
 *
 * Four rules a reader has to hold on to:
 *   - the item box is memoised WITHOUT `res` and `res` is added at the point of use, because
 *     a move changes an item's `res` with no `_ver` bump (F55) and a box memoised with it folded in
 *     culls a moved object out of the plates it has just arrived in;
 *   - an EDIT does rebuild the entry, and so does a FIT: the render list carries the Document's
 *     own natives at the active frame and `_afterEdit` mutates them in place, bumping `_ver`
 *     (`Document.js:1012`), while the idle fitter sets `_outline` and bumps nothing
 *     (`KobinEngine._queueIdleFits`), so the entry's identity is all three (D96, D98);
 *   - the stroke band is built here, once per item per zoom quantum, never per plate: two plates
 *     that band the same stroke against their own rectangles disagree at the boundary (§4.8);
 *   - nothing here copies a coordinate for an item that does not touch the job's plates, which
 *     is the whole of the cull (§5.2, edge case 4.4) — with one exception, and the family's union
 *     sign is what forces it: a culled STROKE in a family that IS drawn still builds its band,
 *     because that band's own winding is the sign every plate of the family must agree on (D102);
 *   - every ring of a band ships wound POSITIVE, whatever built it, because a family accumulates
 *     as ONE nonzero-winding path (§4.5) and two of its items wound against each other cancel to
 *     a hole — which is not a sign the union pass can correct, it is a winding count (D105).
 *     A family wound against itself is counted in `packStats.mixedWinding`: measured, a negative
 *     band nested in a positive fill loses 19,625 units of 152,000, and the bake builds such a
 *     family — a fat stroke's solid-tier quad against its own bands, OPEN-FLAGS F76 (D106).
 */

import { PLATE_PX } from "./plate";
import {
    META_WORDS, ATTR_DOUBLES, RGB_BYTES, KIND_LOOPS, KIND_RINGS,
    FLAG_COVERS, FLAG_ERASE, FLAG_UNION, FLAG_MASK, MASKS_MAX,
} from "./rasterJob";
import { loopBBox, loopsBBox, loopArea } from "../geometry/arcShape";
import { strokeStripNear, ringSignedArea, flattenCurve, controlsFor } from "../geometry/polyline";
import { flattenLoops, cubicLoopsBBox } from "../geometry/curveOutline";
import { underMask } from "../eraseRule";
import { sagittaOf } from "../geometry/chordMath";
import { bboxOf } from "../geometry/derive";
import { perfNow } from "../now";

/** A band and a chord count are memoised per quarter octave of their zoom (`bandFor`, `itemChords`). */
const MEMO_STEPS_PER_OCTAVE = 4;

/**
 * The arc flattening tolerance, in device px — the same 1/16 as `rasterCore.ARC_TOL` (§4.4).
 * It is stated again here rather than imported so that packing does not pull the core's
 * 2.81 MB of module-level scratch (§3.5) onto the main thread in a worker-only render.
 */
export const ARC_TOL = 1 / 16;
/** §4.6's bound on a render-list coordinate, in frame units: 2W + 48 with `res` on top. */
export const COORD_BOUND = 2.6e5;
/**
 * §3.7's budget for everything memoised here — boxes, packed rings, stroke bands. A pack's prepass reads every item of
 * its list, so a camera table whose entries outgrow the memo rebuilds them all at every commit: the synthetic stack's
 * table (~2,860 items, ~20 MiB of entries) under a bake with a selection up took 47 s (the list path) and 91 s (the
 * pyramid) at 10 MiB, 5.6 s and 7.0 s at 64 (B-PYRAMID-2 P5, PLAN §5.9 item 2). A phone takes half.
 */
export const PACK_BUDGET = 64 << 20;
export const PACK_BUDGET_PHONE = 32 << 20;
const DEFAULT_BUDGET = PACK_BUDGET;

/**
 * What the packer counted this session. `nonFinite` and `overBound` are the two that mean the
 * input is wrong. `coordsCopied` is the doubles copied OUT OF an item's own geometry, which is
 * zero for an item the cull rejects (edge case 4.4) — except a culled STROKE in a drawn family,
 * which builds its band for the family's sign and so walks its whole centreline without this
 * counter moving (D102); the job's own size is `job.geom.length`.
 * `mixedWinding` counts the items of a family wound against the family's own total: where two
 * such items overlap, the family's ink cancels to a hole that no declared sign repairs (D106).
 */
export const packStats = {
    items: 0, packed: 0, culled: 0, faded: 0, rejected: 0,
    nonFinite: 0, overBound: 0, mixedFamily: 0, mixedWinding: 0,
    coordsCopied: 0, unionItems: 0, familyUnion: 0, overlapCapped: 0,
    bandsBuilt: 0, bandHits: 0, boxWalks: 0, rebuilt: 0,
    prepasses: 0, prepassHits: 0, famRefills: 0, famReused: 0,   // S3: the per-list half built, reused, a family refilled, a family's union rule kept
    recs: 0, recsBuilt: 0, prepassMs: 0,            // the prepass records kept (the last list's at each key), built, its time
    masked: 0,                                      // items packed under a pending mark's mask
    maskOverflow: 0,                                // marks past MASKS_MAX sharing a slot they over-hide in (A2 §4.4)
    memoBytes: 0, memoEntries: 0, evictions: 0, logs: 0,
};

export function resetPackStats() {
    for (const k of Object.keys(packStats)) packStats[k] = 0;
    packStats.memoBytes = memoBytes;
    packStats.memoEntries = MEMO.size;
}

const LOGGED = new Set();
/** One line per distinct fault per session: a guard that logs every frame is a guard nobody reads. */
function logOnce(what, detail) {
    packStats.logs++;
    if (LOGGED.has(what)) return;
    LOGGED.add(what);
    // eslint-disable-next-line no-console
    console.warn("rasterPack: " + what + " — " + detail);
}

// ---------------------------------------------------------------------------
// The memo. §3.7 asks for a byte budget with LRU over the item boxes, the packed rings and the
// stroke bands. It is a Map and not a WeakMap because a WeakMap cannot be walked and so cannot
// be evicted by a byte cap; the cap is what bounds the retention instead (D92).
// ---------------------------------------------------------------------------

const MEMO = new Map();
let memoBytes = 0;
let budget = DEFAULT_BUDGET;

export function setPackBudget(bytes) { budget = bytes; evict(); }
export function packMemoBytes() { return memoBytes; }
/** Drops every memo, and the "logged once" set with them, so a fresh session logs its faults. */
export function clearPackCaches() {
    for (const e of MEMO.values()) e.dropped = true;
    MEMO.clear(); memoBytes = 0; COLOURS.clear(); LOGGED.clear();
    PREPASS = new WeakMap();
    RECS = new Map(); packStats.recs = 0;
}

function touch(item, e) { MEMO.delete(item); MEMO.set(item, e); }

function evict() {
    while (memoBytes > budget && MEMO.size > 1) {
        const first = MEMO.keys().next().value;
        const e = MEMO.get(first);
        MEMO.delete(first);
        memoBytes -= e.bytes;
        e.dropped = true;
        packStats.evictions++;
    }
    packStats.memoBytes = memoBytes;
    packStats.memoEntries = MEMO.size;
}

/**
 * Bytes are counted while the entry is in the memo. An entry evicted mid-pack is still held by
 * the job being packed and still flattens its geometry, but charging it would add bytes nothing
 * can ever subtract, and the cap would tighten a little more with every pass.
 */
function charge(e, bytes) {
    if (e.dropped) return;
    e.bytes += bytes;
    memoBytes += bytes;
    evict();
}

// ---------------------------------------------------------------------------
// The item: its box, its sub-chains' boxes and signs, and its flat geometry.
// ---------------------------------------------------------------------------

/** The array an item's own geometry lives in — the memo's second key, beside `_ver` and `_outline`. */
const geomRef = (item) => (item.type === "shape" ? item.loops : item.type === "fill" ? item.polys : item.pts);

/** One entry: everything geometry has to be walked for, walked once. The coordinates are not
 *  COPIED here — that is `flattenGeom`, on the first plate that keeps the item (edge case 4.4). */
function build(item, cfg) {
    const e = {
        kind: item.type === "shape" ? KIND_LOOPS : KIND_RINGS,
        box: null, subBox: null, subSign: null, geom: null, subs: null, geomLen: 0,
        bands: null, union: false, bad: false, maxAbs: 0, area: 0, bytes: 0,
        ver: item._ver, src: geomRef(item), outline: item._outline, dropped: false,
        // §6.5's chord estimate, memoised per zoom quantum; the entry's own identity (the
        // object, `_ver`, the geometry array and `_outline`) is what makes it safe (D96, D98).
        chordQ: null, chordN: 0,
    };
    packStats.boxWalks++;
    if (item.type === "shape") buildShape(item, e);
    else if (item.type === "fill") buildFill(item, e);
    else buildStroke(item, e, cfg);
    if (!e.bad && e.subBox) {
        e.union = ringsNeedUnion(e.subBox, e.subSign, e.subBox.length / 4);
        // The item's own rings' TRUE signed area, one quantity for a shape (`arcShape.loopArea`)
        // and a fill (`polyline.ringSignedArea`): `unionSignOf` sums it across a family and the
        // sign of that sum is the family's union orientation (D97). A stroke has no rings here —
        // its area is the band it ships, read where the band is built (D102).
        for (let k = 0; k < e.subSign.length; k++) e.area += e.subSign[k];
    }
    return e;
}

/**
 * The finite gate over an item's own numbers, without copying one. §4.6's bound is read off the
 * box (`finishEntry`): a near-straight arc's centre and radius run far past it and the core never
 * reads them (D287).
 */
function scanNums(nums) {
    for (let i = 0; i < nums.length; i++) if (!isFinite(nums[i])) return false;
    return true;
}

function buildShape(item, e) {
    const loops = item.loops || [];
    const n = loops.length;
    if (!n) { e.bad = true; return; }
    e.subBox = new Float64Array(4 * n);
    e.subSign = new Float64Array(n);
    let len = 0;
    for (let k = 0; k < n; k++) {
        const b = loopBBox(loops[k]);
        if (!b) { e.bad = true; return; }
        e.subBox[k * 4] = b.x0; e.subBox[k * 4 + 1] = b.y0;
        e.subBox[k * 4 + 2] = b.x1; e.subBox[k * 4 + 3] = b.y1;
        e.subSign[k] = loopArea(loops[k]);
        const nums = numbersOf(loops[k]);
        if (!scanNums(nums)) { e.bad = true; return; }
        len += nums.length;
    }
    const bb = loopsBBox(loops);
    if (!bb) { e.bad = true; return; }
    e.box = Float64Array.from([bb.x0, bb.y0, bb.x1, bb.y1]);
    // The box must carry an arc's BULGE and not only its endpoints, or the family's box misses
    // the rows the arc reaches and the bounded clear leaves them for the next family
    // (§4.3's debug check catches it). `loopsBBox` is exact about bulges (arcShape.js:73-96).
    e.geomLen = len;
    finishEntry(e);
}

/** A `Loop`'s own Float64Array, or the numbers of a loop still in the builders' piece form. */
function numbersOf(loop) {
    if (loop && loop.buf) return loop.buf;
    if (loop instanceof Float64Array) return loop;
    throw new Error("rasterPack: a shape's loop is neither a Loop nor a Float64Array");
}

function buildFill(item, e) {
    const rings = item.polys || [];
    const n = rings.length;
    if (!n) { e.bad = true; return; }
    e.subBox = new Float64Array(4 * n);
    e.subSign = new Float64Array(n);
    let pts = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k++) {
        const ring = rings[k];
        let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
        for (const p of ring) {
            if (!isFinite(p[0]) || !isFinite(p[1])) { e.bad = true; return; }
            if (p[0] < rx0) rx0 = p[0];
            if (p[0] > rx1) rx1 = p[0];
            if (p[1] < ry0) ry0 = p[1];
            if (p[1] > ry1) ry1 = p[1];
        }
        pts += ring.length;
        e.subBox[k * 4] = rx0; e.subBox[k * 4 + 1] = ry0;
        e.subBox[k * 4 + 2] = rx1; e.subBox[k * 4 + 3] = ry1;
        e.subSign[k] = ringSignedArea(ring);
        if (rx0 < x0) x0 = rx0;
        if (ry0 < y0) y0 = ry0;
        if (rx1 > x1) x1 = rx1;
        if (ry1 > y1) y1 = ry1;
    }
    e.box = Float64Array.from([x0, y0, x1, y1]);
    e.geomLen = pts * 2;
    finishEntry(e);
}

/**
 * A stroke's cull box: the centreline box inflated by half the pen and the outline fit's own
 * tolerance, UNIONED with `_outline`'s control-point box once the fitter has set one. The BAND is
 * not built here — it depends on the zoom quantum and the cull must cost four comparisons (§5.2,
 * D96) — but the inflated centreline box does NOT contain a fitted band and the union is what
 * makes the cull sound (D100): the miter ribbon puts a vertex `half / max(0.5, dot)` from its
 * centreline vertex, up to 2·`half` at a near-reversal (`polyline.js:364`), and a native stroke's
 * curved `_outline` bulges outside the point polygon by a fraction of the SEGMENT length, which
 * no multiple of the pen bounds. A cubic lies inside its control points and `flattenLoops` emits
 * points on the curve, so the hull box contains the band. The unfitted round band reaches `half`
 * past its centreline, and a native stroke's centreline is the curve through its samples
 * (`bandFor`), inside its spline's control points, which the box takes in.
 */
function buildStroke(item, e, cfg) {
    const pts = item.pts || [];
    if (!pts.length) { e.bad = true; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (p) => {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
    };
    for (const p of pts) take(p);
    if (strokeCurved(item)) {
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const c = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, n - 1)]);
            take(c.left); take(c.right);
        }
    }
    const half = (item.lwFrame || 0) / 2;
    const fit = cfg && cfg.arcTolerancePx && cfg.enter ? cfg.arcTolerancePx / cfg.enter : 0;
    const pad = half + fit;
    // A non-finite width is refused here, not left to make a NaN box: a NaN comparison is false,
    // so such a box is neither culled nor drawn and the item disappears with nothing counted.
    if (!isFinite(pad)) { e.bad = true; return; }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    if (item._outline) {
        // An empty or non-finite outline leaves every comparison false and the box as it was.
        const h = cubicLoopsBBox(item._outline);
        if (h.x0 < x0) x0 = h.x0;
        if (h.y0 < y0) y0 = h.y0;
        if (h.x1 > x1) x1 = h.x1;
        if (h.y1 > y1) y1 = h.y1;
    }
    e.box = Float64Array.from([x0, y0, x1, y1]);
    e.subBox = null; e.subSign = null;
    e.bands = new Map();
    e.union = true;                       // every band is overlapping rings by construction (§4.2)
    for (const p of pts) {
        if (!isFinite(p[0]) || !isFinite(p[1])) { e.bad = true; return; }
        const m = Math.max(Math.abs(p[0]), Math.abs(p[1]));
        if (m > e.maxAbs) e.maxAbs = m;
    }
    // `e.area` stays 0 here: a stroke's declared area is the band's own signed area, which is not
    // known until the band is built (D102) — positive, since D105 normalises every ring the band
    // ships, but its MAGNITUDE still weighs the family's sign against its other items.
    charge(e, 32 + pts.length * 16);
}

/** The shared tail of the two flat kinds: the box's own finite check and the charge. */
function finishEntry(e) {
    const b = e.box;
    for (let i = 0; i < 4; i++) {
        if (!isFinite(b[i])) { e.bad = true; return; }
        const m = Math.abs(b[i]);
        if (m > e.maxAbs) e.maxAbs = m;
    }
    charge(e, (e.subBox ? e.subBox.byteLength : 0) + (e.subSign ? e.subSign.byteLength : 0) + 64);
}

/**
 * The item's own coordinates, copied into the entry on the first plate that KEEPS it and never
 * for one the cull rejects (§5.2, edge case 4.4). `subs` is one ascending offset per loop or
 * ring, in numbers for the loop grammar and in points for flat rings (D36, §3.3).
 */
function flattenGeom(e, item) {
    if (e.geom) return;
    const geom = new Float64Array(e.geomLen);
    let subs, at = 0;
    if (e.kind === KIND_LOOPS) {
        const loops = item.loops || [];
        subs = new Uint32Array(loops.length);
        for (let k = 0; k < loops.length; k++) {
            const nums = numbersOf(loops[k]);
            subs[k] = at;
            geom.set(nums, at);
            at += nums.length;
        }
    } else {
        const rings = item.polys || [];
        subs = new Uint32Array(rings.length);
        for (let k = 0; k < rings.length; k++) {
            subs[k] = at;
            for (const p of rings[k]) { geom[at * 2] = p[0]; geom[at * 2 + 1] = p[1]; at++; }
        }
    }
    e.geom = geom; e.subs = subs;
    packStats.coordsCopied += geom.length;
    charge(e, geom.byteLength + subs.byteLength);
}

/**
 * §4.2's per-item routing, and the ONE implementation of it — `raster.oracle.test.js` calls this
 * rather than keeping a copy of the rule. Do two of these rings need the exact-winding pass?
 * @param {Float64Array|number[]} boxes four numbers a ring: x0, y0, x1, y1
 * @param {Float64Array|number[]} signs one signed area a ring; its sign is the winding's
 * @param {number} n how many rings
 */
export function ringsNeedUnion(boxes, signs, n) {
    if (n < 2) return false;
    let tests = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (++tests > 20000) { packStats.overlapCapped++; return true; }
            if (pairNeedsUnion(boxes, i, signs[i], boxes, j, signs[j])) return true;
        }
    }
    return false;
}

function boxesOverlap(a, i, b, j) {
    return a[i * 4] <= b[j * 4 + 2] && b[j * 4] <= a[i * 4 + 2]
        && a[i * 4 + 1] <= b[j * 4 + 3] && b[j * 4 + 1] <= a[i * 4 + 3];
}
const boxContains = (a, i, b, j) => a[i * 4] <= b[j * 4] && a[i * 4 + 1] <= b[j * 4 + 1]
    && a[i * 4 + 2] >= b[j * 4 + 2] && a[i * 4 + 3] >= b[j * 4 + 3];

/**
 * Two loops (or rings) need the exact-winding pass only where accumulation is not exact (§4.2):
 * SAME-wound boxes that overlap double-count their shared area, and OPPOSITE-wound ones that
 * overlap only partly cancel to blank. A hole nested inside its body — opposite-wound, its box
 * inside the body's — is the one case accumulation gets right by construction (w ∈ {0, 1}), and
 * it is most of what the boolean emits, so routing it to the union pass would buy nothing and
 * cost 16 sub-scanlines a row: measured at the phone camera, 61 % of a screen's raster time was
 * the union pass on items of this shape (§8.6 measurement 4, D91).
 * A zero-area loop has no winding to read and is treated as same-wound, which is the safe side.
 */
function pairNeedsUnion(ba, i, sa, bb, j, sb) {
    if (!boxesOverlap(ba, i, bb, j)) return false;
    if (sa === 0 || sb === 0 || (sa > 0) === (sb > 0)) return true;
    return !(boxContains(ba, i, bb, j) || boxContains(bb, j, ba, i));
}

/**
 * The entry for an item, built once and memoised (§3.7), and rebuilt when the item is EDITED.
 * The render list carries the Document's own natives at the active frame (the model's `nativesIn`),
 * and `_afterEdit` mutates them in place and bumps `_ver` (`Document.js:1012-1017`), so an entry
 * keyed on the object alone would paint a re-rastered plate from the pre-edit numbers. A MOVE
 * must not rebuild — it changes the item's `res` with no `_ver` bump (F55) — which is why this
 * reads `_ver` and the geometry array and never a coordinate.
 * `_outline` is in the identity for the same reason and with no `_ver` bump behind it either:
 * `curveOutline.strokeLoops` caches it on the object (`curveOutline.js:406`) and the idle fitter
 * sets it on every crossing (`KobinEngine._queueIdleFits`), and §4.8 bands a fitted stroke from
 * `_outline` and an unfitted one with round joins — two different bands (D98).
 */
export function entryFor(item, cfg) {
    // Keyed by the geometry: a Stage item is a wrapper (`piece`), and a snapshot wraps the same pieces anew each read,
    // so a wrapper key rebuilt every snapshot's entries and churned the memo (B-PYRAMID-2 P5). No entry reads `res`.
    const key = item.piece || item;
    let e = MEMO.get(key);
    if (e && (e.ver !== item._ver || e.src !== geomRef(item) || e.outline !== item._outline)) {
        MEMO.delete(key);
        memoBytes -= e.bytes;
        e.dropped = true;                 // its bands go with it: they are the same entry
        packStats.rebuilt++;
        e = null;
    }
    if (e) { touch(key, e); return e; }
    e = build(item, cfg);
    MEMO.set(key, e);
    packStats.memoEntries = MEMO.size;
    evict();
    return e;
}

/**
 * The item's box in frame units, WITHOUT `res` (§5.2). `cfg` only sizes a stroke's fit slack.
 * @returns {Float64Array|null} [x0, y0, x1, y1], or null for an item with no drawable geometry
 */
export function itemBox(item, cfg) {
    const e = entryFor(item, cfg);
    return e.bad ? null : e.box;
}

/**
 * Whether an item cannot draw inside `win` (frame units), read off its cached drawn box (`bboxOf`, memoised on the
 * geometry) without building its pack entry: a scan that builds every entry of a table larger than the memo rebuilds
 * them all each time (the dense drawing thrashed the 10 MiB memo, B-PYRAMID-2 P5). Conservative: a stroke's box is
 * widened by half its width and, for its curve's overshoot past its points, a quarter of its extent.
 */
export function outsideWin(item, win) {
    const g = item.piece || item;
    if (!g || !g.type) return false;
    const b = bboxOf(g);
    if (!b || !(b.x1 >= b.x0) || !(b.y1 >= b.y0)) return false;
    const m = g.type === "shape" || g.type === "fill" ? 0 : (g.lwFrame || 0) / 2 + 0.25 * Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const r = item.res, dx = r ? r[0] : 0, dy = r ? r[1] : 0;
    return b.x1 + dx + m < win.left || b.x0 + dx - m > win.right || b.y1 + dy + m < win.top || b.y0 + dy - m > win.bottom;
}

// ---------------------------------------------------------------------------
// The visible chord estimate (§6.5): the one number the sync/plates switch is
// decided on. Stage 5b's (§15.3 Q10, decision 7).
// ---------------------------------------------------------------------------

/**
 * Chords a banded stroke costs per centreline point. §8.6 row 13 measured **6.75–14.74 edges a
 * centreline point** over six readings, growing with the pen (6.75 at 20 frame units of width,
 * 14.74 at 2,000). Taken near the TOP of that band on purpose: over-estimating costs a soft
 * zoom on a medium drawing, under-estimating costs a main-thread stall on every zoom step,
 * which is the trade §6.5 states. No band is built here — that is `bandFor`, and the cull must
 * not build one (D96).
 */
export const STROKE_CHORD_MULT = 12;
/**
 * Chords a raw native stroke costs per point of its FLATTENED curve, which is what F92 bands it along:
 * 7.0–7.9 measured over widths 4–200 and zooms 1–64× (12 a sample underpriced it 2–40×: the curve has
 * 2.6–60 flattened points a sample, growing with the zoom).
 */
const CURVE_CHORD_MULT = 8;

/**
 * The chords one arc piece would be flattened into at zoom `Z`, by §4.4's own arithmetic:
 * `n ≥ θ / (2·arccos(1 − 2·tol·sin(θ/2)/L))`, emitted as `2^ceil(log2 n)`, with the `FORCED`
 * floor for a sweep over a quarter turn and the `MAXD` clamp.
 *
 * It is an ESTIMATE and not the generator's count: the core takes the max over the `2^FORCED`
 * sub-arcs and this takes the whole arc's, which differ by at most one bisection. What it feeds
 * is a budget decision (§6.5), not a bar.
 */
function arcChords(ax, ay, bx, by, sweep, tol) {
    const th = Math.abs(sweep);
    if (!(th > 0) || !isFinite(th)) return 1;
    if (sagittaOf(ax, ay, bx, by, sweep) <= tol) return 1;      // one chord is already inside the bar
    const forced = th <= Math.PI / 2 ? 0 : th <= Math.PI ? 1 : 2;
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy);
    let d = forced;
    if (L > 0) {
        const u = 1 - (2 * tol * Math.sin(Math.min(th, Math.PI) / 2)) / L;
        const n = u > -1 && u < 1 ? th / (2 * Math.acos(u)) : 1;
        if (isFinite(n) && n > 1) d = Math.max(forced, Math.ceil(Math.log2(n)));
    }
    return Math.pow(2, Math.min(d, 24));
}

/** One item's chords at zoom `Z`, memoised on the pack entry per quarter octave. */
function itemChords(item, Z, cfg, e) {
    if (e.bad) return 0;
    const qz = Math.round(Math.log2(Z) * MEMO_STEPS_PER_OCTAVE);
    if (e.chordQ === qz) return e.chordN;
    let n = 0;
    if (e.bands) {
        // §4.8's band, priced not built; a raw native stroke along its flattened curve (`bandFor`)
        if (!item._outline && strokeCurved(item)) n = flattenCurve(item.pts, ARC_TOL / Z).length * CURVE_CHORD_MULT;
        else n = (item.pts ? item.pts.length : 0) * STROKE_CHORD_MULT;
        // A band's rings are as tall as the pen: each crosses that many sub-scanlines. A 337 px pen priced
        // by length alone stayed on the sync path at pen-up and rastered for 20 s on the main thread (F130).
        n *= Math.max(1, ((item.lwFrame || 0) * Z) / 32);
    } else if (e.kind === KIND_LOOPS) {
        const tol = ARC_TOL / Z;                                    // device px → frame units
        for (const loop of item.loops || []) {
            for (const p of loop) n += p.line ? 1 : arcChords(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep, tol);
        }
    } else {
        for (const ring of item.polys || []) n += ring.length;      // one chord an edge
    }
    e.chordQ = qz; e.chordN = n;
    return n;
}

/** One item's chords at zoom `Z` as `visibleChords` counts them (memoised on its entry): a patch estimate's term. */
export function itemChordsAt(item, Z, cfg) { return itemChords(item, Z, cfg, entryFor(item, cfg)); }

/**
 * The visible chord estimate — the E of the pyramid's inline estimate (A3 §2.2): Σ over the items the window
 * touches of the chords they would be flattened into **at the zoom `Z`** the job renders at.
 *
 * It EXITS EARLY at `cap`, returning `cap + 1`, because the answer is only ever compared with a budget: §8.6
 * row 4's screen is 77,317 pieces, and walking all of them is 8–15 ms, while the exit makes a dense screen
 * O(a few dozen items).
 *
 * @param {object[]} list the render list
 * @param {{left:number,top:number,right:number,bottom:number}} win the viewport in frame units
 * @param {number} Z device px per frame unit, exact
 * @param {object} cfg the engine cfg
 * @param {number} cap the count above which the caller stops caring
 * @returns {number} the estimate, or `cap + 1`
 */
export function visibleChords(list, win, Z, cfg, cap) {
    if (!(Z > 0) || !isFinite(Z)) return cap + 1;
    let n = 0;
    for (let k = 0; k < list.length; k++) {
        const o = list[k];
        if (outsideWin(o, win)) continue;
        const e = entryFor(o, cfg);
        if (e.bad) continue;
        const b = e.box, r = o.res;
        const x0 = r ? b[0] + r[0] : b[0], y0 = r ? b[1] + r[1] : b[1];
        const x1 = r ? b[2] + r[0] : b[2], y1 = r ? b[3] + r[1] : b[3];
        if (x1 < win.left || x0 > win.right || y1 < win.top || y0 > win.bottom) continue;
        n += itemChords(o, Z, cfg, e);
        if (n > cap) return cap + 1;
    }
    return n;
}

// ---------------------------------------------------------------------------
// The stroke band (§4.8).
// ---------------------------------------------------------------------------

/**
 * A stroke's fillable rings at one zoom, flat, memoised on `(item, quarter octave of Zq)`.
 *
 * **The key is derived from `Zq`** (F77): the geometry is flattened at `ARC_TOL / Zq`, so a memo keyed on anything
 * else returns a band flattened at whatever zoom came first (1.0 device px of chord error at 4×, against Kobin's
 * quarter-pixel bar). A COARSER request reuses a cached FINER band: a finer flattening is inside the tolerance at
 * every coarser zoom. The reverse is never done.
 *
 * A fitted stroke uses its own `_outline` — the single definition of "how a stroke becomes an
 * outline", which the eraser's footprint goes through too — flattened at the plate tolerance.
 * An unfitted one is banded with round joins and caps along the line the SVG renderer strokes: a
 * native stroke's curve through its samples (`strokeCurved`; through a phone's sparse samples a
 * polyline drew corners, Kobin 2026-09-23), a derived piece's own points. Fitting is never run
 * here: that is `needsFatFlip`'s job (§4.8).
 * Every ring of the band is wound POSITIVE whichever of the two built it, so a fitted stroke and
 * an unfitted one paint the same picture and two BANDS of one family never cancel (D105).
 * @returns {{geom: Float64Array, subs: Uint32Array, box: Float64Array, area: number}} `area` is
 *   the signed area of the rings this band ships — non-negative, and what `attr[8]` is summed
 *   from (D102, `unionAreaOf`)
 */
export function bandFor(item, q, Zq, cfg) {
    const e = entryFor(item, cfg);
    if (e.bad) return null;
    if (!e.bands) return null;
    const key = Math.round(Math.log2(Zq) * MEMO_STEPS_PER_OCTAVE);
    const had = e.bands.get(key);
    if (had) { packStats.bandHits++; return had; }
    for (const [k, band] of e.bands) {
        if (k > key) { packStats.bandHits++; return band; }   // a finer band is exact at a coarser zoom
    }
    const tol = ARC_TOL / Zq;
    let band;
    if (item._outline) {
        const polys = flattenLoops(item._outline, tol);
        band = flatten(polys);
    } else {
        const line = strokeCurved(item) ? flattenCurve(item.pts, tol) : item.pts;
        const r = strokeStripNear(line, item.lwFrame, null, { joins: "round", tol });
        band = fromWriter(r);
    }
    if (!band) return null;
    packStats.bandsBuilt++;
    // Two quanta an item: the one in force and the one a gesture just left. More than that is
    // memory spent on zooms nobody is coming back to inside one gesture.
    if (e.bands.size >= 2) {
        const oldest = e.bands.keys().next().value;
        const drop = e.bands.get(oldest);
        e.bands.delete(oldest);
        charge(e, -(drop.geom.byteLength + drop.subs.byteLength));
    }
    e.bands.set(key, band);
    charge(e, band.geom.byteLength + band.subs.byteLength);
    return band;
}

/** Is this stroke drawn as the curve through its samples (a native one, as `Renderer` and the hit test draw it)? */
function strokeCurved(item) { return item.origin === "native" && item.pts.length > 2; }

/**
 * `flattenLoops`'s nested rings to the flat pair, with the box and the band's own signed area.
 * Every ring is written POSITIVE, whatever winding built it, because a family accumulates as one
 * nonzero-winding path (§4.5): two items of one family wound against each other cancel to a hole
 * where they overlap, and the union pass counts their joint winding before `attr[8]`'s sign is
 * applied, so no sign can repair it (D105). Positive is the winding of a boolean `shape` and of
 * every band this packer ships, and NOT of `strokeStripNear`'s default tail, which winds every
 * derived fat-stroke `fill` negative (§4.8 rule 4, D106).
 * The area is the shipped rings' own shoelace, which is what `attr[8]` must agree with (D102).
 */
function flatten(polys) {
    let n = 0;
    for (const p of polys) n += p.length;
    if (!n) return null;
    const geom = new Float64Array(n * 2), subs = new Uint32Array(polys.length);
    let at = 0, area = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < polys.length; k++) {
        subs[k] = at;
        const ring = polys[k], a = ringSignedArea(ring), back = a < 0;
        area += back ? -a : a;
        for (let i = 0; i < ring.length; i++) {
            const p = ring[back ? ring.length - 1 - i : i];
            geom[at * 2] = p[0]; geom[at * 2 + 1] = p[1]; at++;
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        }
    }
    return { geom, subs, box: Float64Array.from([x0, y0, x1, y1]), area };
}

/** `strokeStripRound`'s writer output, trimmed to its own length. Its `area` is the same shoelace
 *  the writer's own ring normalisation computes, so this band's area is never negative (D105). */
function fromWriter(r) {
    if (!r.pts || !r.rings) return null;
    const geom = r.xy.slice(0, r.pts * 2), subs = r.ring.slice(0, r.rings);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.pts; i++) {
        const x = geom[i * 2], y = geom[i * 2 + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    }
    return { geom, subs, box: Float64Array.from([x0, y0, x1, y1]), area: r.area };
}

// ---------------------------------------------------------------------------
// Colour (§4.7): parsed once per string into 8-bit sRGB. No colour management, no gradients.
// ---------------------------------------------------------------------------

const COLOURS = new Map();
const NAMED = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], transparent: [0, 0, 0] };

/** @returns {number[]} [r, g, b]; an unparseable colour is black and is logged once. */
export function parseColour(css) {
    if (css == null) return [0, 0, 0];
    const had = COLOURS.get(css);
    if (had) return had;
    let out = null;
    const s = String(css).trim().toLowerCase();
    if (s[0] === "#") {
        const h = s.slice(1);
        if (h.length === 3 || h.length === 4) {
            out = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
        } else if (h.length === 6 || h.length === 8) {
            out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
    } else if (s.startsWith("rgb")) {
        const m = s.match(/-?[\d.]+/g);
        if (m && m.length >= 3) out = [clamp255(+m[0]), clamp255(+m[1]), clamp255(+m[2])];
    } else if (NAMED[s]) {
        out = NAMED[s].slice();
    }
    if (!out || out.some((v) => !isFinite(v))) {
        logOnce("unparseable colour", JSON.stringify(css) + " painted black");
        out = [0, 0, 0];
    }
    COLOURS.set(css, out);
    return out;
}
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// ---------------------------------------------------------------------------
// The fade and the family key (§4.5), both evaluated at the plate's QUANTISED zoom (D12).
// ---------------------------------------------------------------------------

/** `Renderer._fade` at the quantum: `inScaleQ = Zq / dpr`, because `Zq` is device px per unit. */
export function fadeQ(item, Zq, dpr, cfg) {
    if (item.fadeTag == null) return 1;
    const px = (item.fadeTag * (Zq / dpr)) / cfg.enter;
    // A non-finite reading would ramp to NaN, and a NaN alpha paints nothing at all — the one
    // failure mode of this function is a blank picture, so it reads as fully present instead.
    if (!isFinite(px)) return 1;
    const lo = cfg.fadeLoPx != null ? cfg.fadeLoPx : 0.15;
    const hi = cfg.cullPx != null ? cfg.cullPx : 0.3;
    return Math.max(0, Math.min(1, (px - lo) / (hi - lo)));
}

/** `Renderer.js:579` verbatim, on the quantised fade: the tag's presence is not the test. */
export function renderIdOf(item, fade) {
    return item.editId != null && fade >= 1 ? item.editId : item.id;
}

// ---------------------------------------------------------------------------
// The binner (§5.2): a uniform grid over the job's plates.
// ---------------------------------------------------------------------------

export class PlateBinner {
    /**
     * @param {Int32Array|number[]} plates [i, j, i, j, …] — the plates this grid covers
     * @param {number} Zq device px per frame unit
     * @param {number[][]|null} [clips] one `[x0, y0, x1, y1]` (plate px) a plate: a clipped job files an item into a plate
     *        only where its box meets that plate's clip (PLAN §5.18) — a clipped render reads nothing else (A3 §3.1)
     */
    constructor(plates, Zq, clips = null) {
        this.Zq = Zq;
        this.cells = new Map();
        this.clips = null;
        this.i0 = Infinity; this.i1 = -Infinity; this.j0 = Infinity; this.j1 = -Infinity;
        for (let p = 0; p * 2 < plates.length; p++) {
            const i = plates[p * 2], j = plates[p * 2 + 1], c = clips && clips[p];
            this.cells.set(i + "," + j, []);
            if (c && !(c[0] <= 0 && c[1] <= 0 && c[2] >= PLATE_PX && c[3] >= PLATE_PX)) (this.clips || (this.clips = new Map())).set(i + "," + j, c);
            if (i < this.i0) this.i0 = i;
            if (i > this.i1) this.i1 = i;
            if (j < this.j0) this.j0 = j;
            if (j > this.j1) this.j1 = j;
        }
    }
    /**
     * File an item's box (frame units, `res` already added) into every plate it touches — and, for a plate with a clip,
     * whose clip it touches: the pixels its box's edges fall in, floored as the plate cull floors, so an item ending
     * inside a clip's edge pixel is filed.
     * @returns {boolean} whether it touched any plate of this grid — the cull's own answer
     */
    add(index, box) {
        const s = this.Zq / PLATE_PX;
        let i0 = Math.floor(box[0] * s), i1 = Math.floor(box[2] * s);
        let j0 = Math.floor(box[1] * s), j1 = Math.floor(box[3] * s);
        if (i1 < this.i0 || i0 > this.i1 || j1 < this.j0 || j0 > this.j1) return false;
        i0 = Math.max(i0, this.i0); i1 = Math.min(i1, this.i1);
        j0 = Math.max(j0, this.j0); j1 = Math.min(j1, this.j1);
        let hit = false;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const key = i + "," + j, c = this.cells.get(key);
                if (!c) continue;
                const k = this.clips && this.clips.get(key);
                if (k) {
                    const Z = this.Zq, x0 = Math.floor(box[0] * Z) - i * PLATE_PX, x1 = Math.floor(box[2] * Z) - i * PLATE_PX;
                    const y0 = Math.floor(box[1] * Z) - j * PLATE_PX, y1 = Math.floor(box[3] * Z) - j * PLATE_PX;
                    if (x1 < k[0] || x0 >= k[2] || y1 < k[1] || y0 >= k[3]) continue;
                }
                c.push(index); hit = true;
            }
        }
        return hit;
    }
    /** The item indices filed into one plate, in the order they were added. */
    itemsFor(i, j) { return this.cells.get(i + "," + j) || []; }
}

// ---------------------------------------------------------------------------
// The job (§3.3).
// ---------------------------------------------------------------------------

const alloc = (pool, ctor, len) => (pool ? pool.take(ctor, len) : new ctor(len));

/**
 * The strip-independent half of a pack (PAPER-PLAN §10, S3): the families in paint order, each item's entry, fade and
 * box with `res`, and per family its union rule and sign. Kept per list and key, so the strips of one request walk the
 * list once (on the Magnum Opus's 15,192 pieces a strip cost 25 ms before its first plate, jsdom). Across lists — every
 * commit makes one, and a snapshot wraps the same pieces anew — each item's record is kept by its geometry (the memo's
 * key) per zoom, dpr, cfg and offset, and rebuilt only where the item changed: its entry, fade, z, family, erase flag or
 * `res` (a held drag moves `res` with no document write; a drop writes the placement). A family keeps its union rule
 * and sign while its records are the same objects. The records kept are the last whole list's at each of RECS_KEYS
 * keys; a subset's pack (a drag plane's `only` or `omit`) adds to them and drops none.
 * PLAN §5.15 item 1: refilling the families of a list after a snapshot's (wrappers never matched) was 18–33 ms of the
 * undo's 45–64 ms inline pack on the dense drawing.
 */
let PREPASS = new WeakMap();                     // list -> Map(key -> prepass), at most PREPASS_KEYS a list
const PREPASS_KEYS = 4;
let RECS = new Map();                            // zoom|dpr|cfg|offset -> { recs: Map(geometry -> record), fams: Map(rid -> family) }
const RECS_KEYS = 8;
const IDS = new WeakMap();
let idSeq = 0;
const idOf = (x) => { if (x == null) return 0; let v = IDS.get(x); if (!v) IDS.set(x, (v = ++idSeq)); return v; };

function prepassFor(list, q, Zq, dpr, cfg, only, omit, offset) {
    const rk = Zq + "|" + dpr + "|" + idOf(cfg) + "|" + (offset ? offset[0] + "," + offset[1] : "");
    const key = rk + "|" + idOf(only) + "|" + idOf(omit);
    let m = PREPASS.get(list);
    if (!m) PREPASS.set(list, (m = new Map()));
    const hit = m.get(key);
    if (hit) { packStats.prepassHits++; return hit; }
    packStats.prepasses++;
    const t0 = perfNow();
    if (m.size >= PREPASS_KEYS) m.delete(m.keys().next().value);
    const R = RECS.get(rk) || { recs: new Map(), fams: new Map() };
    RECS.delete(rk); RECS.set(rk, R);
    if (RECS.size > RECS_KEYS) RECS.delete(RECS.keys().next().value);
    const sub = !!(only || omit), was = R.recs, recs = sub ? was : new Map(), fams = new Map();
    let faded = 0;
    for (let k = 0; k < list.length; k++) {
        const o = list[k];
        // A pending mark is in every job, whatever it packs: it masks the items the erase rule names.
        if (only && !only.has(o.id) && !o.erase) continue;
        if (omit && omit.has(o.id) && !o.erase) continue;
        const fade = fadeQ(o, Zq, dpr, cfg);
        if (fade <= 0) { faded++; continue; }
        const rid = renderIdOf(o, fade);
        let f = fams.get(rid);
        if (!f) {
            f = { rid, z: o.z != null ? o.z : rid, items: [], all: [], recs: [], isFam: o.editId != null && rid === o.editId,
                union: null, unionSign: 0, mixed: 0, rejected: 0, over: 0 };
            fams.set(rid, f);
        }
        const g = o.piece || o;
        const r = recFor(sub ? was.get(g) : was.get(g) || recs.get(g), o, fade, cfg, offset);
        recs.set(g, r);
        f.items.push({ o, fade, idx: k });
        famAdd(f, r, o, fade, k);
    }
    const order = Array.from(fams.values()).sort((a, b) => (a.z - b.z) || (a.rid - b.rid));
    for (const f of order) {
        const g = R.fams.get(f.rid);
        if (g && g.union !== null && sameRecs(g.recs, f.recs)) { f.union = g.union; f.unionSign = g.unionSign; f.mixed = g.mixed; packStats.famReused++; }
    }
    if (!sub) { R.recs = recs; R.fams = fams; }
    let n = 0;
    for (const x of RECS.values()) n += x.recs.size;
    packStats.recs = n;
    const pre = { order, faded, n: list.length, recs, offset };
    m.set(key, pre);
    packStats.prepassMs += perfNow() - t0;
    return pre;
}

/**
 * Item `o`'s prepass record: `r` when its entry is live and its fade, z, family, erase flag and `res` (by value) are the
 * ones it was built with, else a new one. A kept record does not touch the memo's LRU (a delete and a set a list item
 * was most of a 26 ms prepass on the dense drawing), as the families it replaced did not.
 */
function recFor(r, o, fade, cfg, offset) {
    const own = o.res || null;
    if (r && r.fade === fade && r.z === o.z && r.editId === o.editId && r.erase === !!o.erase && sameRes(r.own, own) && entryLive(r.e, o)) return r;
    const e = entryFor(o, cfg), res = withOffset(own, offset);
    packStats.recsBuilt++;
    return { e, fade, z: o.z, editId: o.editId, erase: !!o.erase, own, res, box: e.bad ? null : boxWithRes(e.box, res) };
}

/** Is memo entry `e` still item `o`'s: not evicted, its geometry and outline the ones it was built from? */
const entryLive = (e, o) => !e.dropped && e.ver === o._ver && e.src === geomRef(o) && e.outline === o._outline;
const sameRes = (a, b) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
function sameRecs(a, b) {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
    return true;
}

/** Record `r` into family `f` as item `o`'s drawn record, or its rejection counted. */
function famAdd(f, r, o, fade, idx) {
    f.recs.push(r);
    const e = r.e;
    if (e.bad) {
        f.rejected++;
        logOnce("a non-finite coordinate", "item id " + o.id + " (" + o.type + ") refused; it paints nothing");
        return;
    }
    if (e.maxAbs > COORD_BOUND) {
        f.over++;
        logOnce("a render-list coordinate past the bound", "item id " + o.id + " reaches " + e.maxAbs.toExponential(2)
            + " frame units, over §4.6's " + COORD_BOUND.toExponential(1) + "; the plate stays float64-exact to ~1.5e-8 px below it");
    }
    f.all.push({ o, e, fade, box: r.box, res: r.res, idx });
}

/** An item's residual with the pack's `offset` added (frame units); the residual itself when there is none. */
const withOffset = (own, offset) => (offset ? [(own ? own[0] : 0) + offset[0], (own ? own[1] : 0) + offset[1]] : own);

/** A family's records again, each rebuilt where its item changed since the prepass (`famStale`). */
function famFill(f, pre, cfg) {
    f.all = []; f.recs = []; f.rejected = 0; f.over = 0; f.union = null; f.unionSign = 0; f.mixed = 0;
    for (const m of f.items) {
        const g = m.o.piece || m.o, r = recFor(pre.recs.get(g), m.o, m.fade, cfg, pre.offset);
        pre.recs.set(g, r);
        famAdd(f, r, m.o, m.fade, m.idx);
    }
}

/**
 * The families of `list` in the pack's own paint order at one zoom, each with its drawn items'
 * boxes (`f.all[k].box`, `res` applied) — the pre-pass `packJob` uses, so a caller that splits a
 * picture by z (the drag plane's layers, PAPER-PLAN §10 S4z) splits it exactly where the pack paints.
 */
export function paintFamilies(list, q, Zq, dpr, cfg) {
    const pre = prepassFor(list, q, Zq, dpr, cfg, null, null, null);
    for (const f of pre.order) if (famStale(f)) { famFill(f, pre, cfg); packStats.famRefills++; }
    return pre.order;
}

/** Has any item of the family been edited, fitted, evicted from the memo or re-placed (`res`, by value) since its prepass? */
function famStale(f) {
    for (let k = 0; k < f.items.length; k++) {
        const o = f.items[k].o, r = f.recs[k];
        if (!entryLive(r.e, o) || !sameRes(r.own, o.res || null)) return true;
    }
    return false;
}

/**
 * One strip of plates and the items that touch it, in §3.3's layout.
 *
 * @param {object[]} list the render list, already sorted by (z ?? id, id)
 * @param {object} opts
 *   plates    Int32Array [i, j, …] — this job's plates
 *   q, Zq     the zoom quantum and its device px per frame unit
 *   dpr       devicePixelRatio, for the quantised fade only
 *   cfg       the engine cfg (enter, cullPx, fadeLoPx, arcTolerancePx)
 *   paper     [r, g, b]
 *   G         the scene's generation the list was read at (A2 §3.1): every plate of the job carries it
 *   jobId, frameSeq, postedAt
 *   pool      a `BufferPool`, or null to allocate fresh
 *   only/omit id Sets, never both (PAPER-PLAN R3): a selection job packs `only` the dragged
 *             ids, every other job while that drag is live `omit`s them. Whole families by
 *             construction — `_selectionMembers` expands an id to its edit group and a lasso
 *             takes a family whole — so the union sign never differs between the two jobs.
 *   clips     one `[x0, y0, x1, y1]` (plate px) a plate, or null: a clipped job's cull keeps only the items whose
 *             box meets a plate's clip (PLAN §5.18); the families' union rule and sign still see every item
 *   offset    `[dx, dy]` in frame units, added to every item's `res` — the way a caller that
 *             wants an arbitrary rectangle on ONE plate moves the world instead of the grid
 *             (SCENES-PLAN S1). The core already applies `res` per item, nothing goes on the
 *             wire, and no memo is polluted: `entryFor`'s box is memoised without `res` and
 *             `bandFor`'s key is the zoom.
 * @returns {object} the job `rasterCore.renderPlate` and `rasterJob.wireJob` both read
 */
export function packJob(list, opts) {
    const { plates, q = 0, Zq, dpr = 1, cfg, paper = [255, 255, 255], pool = null, offset = null, only = null, omit = null, clips = null } = opts;
    const binner = new PlateBinner(plates, Zq, clips);

    // 1 — the families, in the order the SVG renderer stacks them: (z, renderId) ascending,
    //     with z the group's, which is `rep.z ?? renderId` (`Renderer._insertSorted:829`) —
    //     built once per list and zoom (`prepassFor`); the counters still read per pack.
    const pre = prepassFor(list, q, Zq, dpr, cfg, only, omit, offset);
    packStats.items += pre.n;
    packStats.faded += pre.faded;

    // 2 — the cull and the per-family union rule. Four comparisons an item; no coordinate is
    //     copied for one that misses the strip (§5.2, edge case 4.4).
    const kept = [];
    for (const f of pre.order) {
        if (famStale(f)) { famFill(f, pre, cfg); packStats.famRefills++; }
        packStats.rejected += f.rejected; packStats.nonFinite += f.rejected; packStats.overBound += f.over;
        const all = f.all;
        if (!all.length) continue;
        const drawn = [];
        for (const d of all) {
            // The binner files the item's index in the RENDER LIST, so a per-plate query answers
            // in the caller's own terms rather than in this job's packing order.
            if (!binner.add(d.idx, d.box)) { packStats.culled++; continue; }
            drawn.push(d);
        }
        // The cull runs FIRST so a family with nothing on this strip pays no pairwise box test.
        // The union routing and the union sign are taken over EVERY item of the family, not over
        // the ones this strip happens to see: both decide the picture, and a plate that took the
        // fast path where its neighbour took the union pass — or the opposite sign — is the seam
        // class S1–S6 exists to catch (D64, D90). Neither depends on the strip, so both are kept.
        if (!drawn.length) continue;
        if (f.union === null) { f.union = familyUnion(all); f.unionSign = unionSignOf(all, f, q, Zq, cfg); }
        if (f.union) packStats.familyUnion++;
        packStats.mixedWinding += f.mixed;
        for (const d of drawn) { d.fam = f; kept.push(d); }
    }
    if (!kept.length) return emptyJob(opts, plates, paper, pool);

    // 3 — the sizes, then one allocation per array, then the copy.
    let nGeom = 0, nSubs = 0;
    for (const d of kept) {
        const g = geomOf(d, q, Zq, cfg);
        d.skip = !g;                    // the pre-pass's item records are reused: set, never left over
        if (!g) { packStats.rejected++; continue; }
        d.g = g;
        nGeom += g.geom.length;
        nSubs += g.subs.length;
    }
    const items = kept.filter((d) => !d.skip);
    if (!items.length) return emptyJob(opts, plates, paper, pool);

    // Pending eraser marks paint nothing: each masks the items the erase rule names where the boxes
    // meet (`underMask`: its targets and their pieces not yet handled, A2 §4.4), so an object moved
    // under it after its shape landed, drawn after it, or already baked shows (PLAN §0 decision 3).
    const markOf = new Map(), marks = [];
    for (const d of items) {
        if (!d.o.erase) continue;
        let M = markOf.get(d.fam);
        if (!M) { markOf.set(d.fam, (M = { i: marks.length, k: 0, o: d.o, box: [Infinity, Infinity, -Infinity, -Infinity] })); marks.push(M); }
        const b = d.g.box ? boxWithRes(d.g.box, d.res) : d.box;
        if (b[0] < M.box[0]) M.box[0] = b[0];
        if (b[1] < M.box[1]) M.box[1] = b[1];
        if (b[2] > M.box[2]) M.box[2] = b[2];
        if (b[3] > M.box[3]) M.box[3] = b[3];
    }
    const maskedBy = marks.length ? maskSlots(items, marks) : null;

    const n = items.length;
    const meta = alloc(pool, Uint32Array, n * META_WORDS);
    const attr = alloc(pool, Float64Array, n * ATTR_DOUBLES);
    const rgb = alloc(pool, Uint8Array, n * RGB_BYTES);
    const subs = alloc(pool, Uint32Array, nSubs);
    const geom = alloc(pool, Float64Array, nGeom);
    const ids = new Int32Array(n);                   // this thread's (the suites'); not wired, so never the pool's

    let famIndex = -1, lastFam = null, gAt = 0, sAt = 0;
    for (let k = 0; k < n; k++) {
        const d = items[k], o = d.o, f = d.fam;
        if (f !== lastFam) { famIndex++; lastFam = f; f.rgbv = parseColour(o.color); f.alpha = alphaOf(o, f, d.fade); }
        const alpha = alphaOf(o, f, d.fade);
        const col = parseColour(o.color);
        if (alpha !== f.alpha || col[0] !== f.rgbv[0] || col[1] !== f.rgbv[1] || col[2] !== f.rgbv[2]) {
            packStats.mixedFamily++;
            logOnce("a family whose items disagree on colour or alpha",
                "family " + f.rid + ": the core paints the whole family with the first drawn item's, §3.3");
        }
        const m = k * META_WORDS;
        meta[m] = d.g.kind;
        meta[m + 1] = famIndex;
        meta[m + 2] = gAt;
        meta[m + 3] = d.g.geom.length;
        meta[m + 4] = sAt;
        meta[m + 5] = d.g.subs.length;
        const isUnion = f.union || d.e.union;
        const box = d.g.box ? boxWithRes(d.g.box, d.res) : d.box;
        const M = o.erase ? markOf.get(f) : null;
        let bits = 0;
        if (!M && maskedBy) { const under = maskedBy.get(d); if (under) for (const K of under) bits |= 1 << K.k; }
        meta[m + 6] = (o.covers ? FLAG_COVERS : 0) | (o.erase ? FLAG_ERASE : 0) | (isUnion ? FLAG_UNION : 0) | (M ? FLAG_MASK : 0);
        meta[m + 7] = M ? M.k : bits;
        if (isUnion) packStats.unionItems++;
        if (bits) packStats.masked++;

        const a = k * ATTR_DOUBLES;
        attr[a] = box[0]; attr[a + 1] = box[1]; attr[a + 2] = box[2]; attr[a + 3] = box[3];
        attr[a + 4] = d.res ? d.res[0] : 0;
        attr[a + 5] = d.res ? d.res[1] : 0;
        attr[a + 6] = o.lwFrame || 0;
        attr[a + 7] = alpha;
        // §3.3's reserved double is the family's union sign (D90): +1 where the family's union
        // geometry is wound positive, −1 where it is negative, 0 for an item that is not a union
        // item. The core reads it instead of summing shoelaces, and it is the same number on
        // every plate and in every strip.
        attr[a + 8] = isUnion ? f.unionSign : 0;

        rgb[k * 3] = f.rgbv[0]; rgb[k * 3 + 1] = f.rgbv[1]; rgb[k * 3 + 2] = f.rgbv[2];
        ids[k] = o.id | 0;

        geom.set(d.g.geom, gAt);
        for (let s = 0; s < d.g.subs.length; s++) subs[sAt + s] = d.g.subs[s];
        gAt += d.g.geom.length;
        sAt += d.g.subs.length;
        packStats.packed++;
    }

    return {
        jobId: opts.jobId != null ? opts.jobId : 0,
        frameSeq: opts.frameSeq != null ? opts.frameSeq : 0,
        postedAt: opts.postedAt != null ? opts.postedAt : 0,
        G: opts.G != null ? opts.G : 0,
        // Every array in the job is the packer's OWN copy: `wireJob` transfers them, which
        // detaches the buffer, and a job that aliased the caller's plate list would leave the
        // store holding a zero-length array after the first post.
        q, Zq, plateW: PLATE_PX,
        plates: Int32Array.from(plates),
        paper: Uint8Array.from(paper),
        nItems: n, meta, attr, rgb, subs, geom, ids,
    };
}

/**
 * The job's mask slots (A2 §4.4): each item's masking marks by the rule, and each mark's slot. The
 * core masks a family whole, by the bits of all its items, so marks share a slot only where it is
 * exact per family: no family whose box meets both has one and not the other among its items'
 * marks. The shared plane is the max of their coverages; a family under both reads 1 − max for
 * (1 − a)(1 − b), which differ only where the two edges overlap. Past MASKS_MAX a mark joins the
 * slot it over-hides the fewest families in (`maskOverflow`): never white ink, which would hide what
 * the rule says shows. Returns item -> its masking marks.
 */
function maskSlots(items, marks) {
    const m = marks.length, maskedBy = new Map(), conflict = new Float64Array(m * m), fams = new Map();
    for (const d of items) {
        if (d.o.erase) continue;
        const b = d.g.box ? boxWithRes(d.g.box, d.res) : d.box;
        let F = fams.get(d.fam);
        if (!F) fams.set(d.fam, (F = { box: [b[0], b[1], b[2], b[3]], hit: null }));
        else {
            if (b[0] < F.box[0]) F.box[0] = b[0];
            if (b[1] < F.box[1]) F.box[1] = b[1];
            if (b[2] > F.box[2]) F.box[2] = b[2];
            if (b[3] > F.box[3]) F.box[3] = b[3];
        }
        let hit = null;
        for (const K of marks) {
            if (b[0] > K.box[2] || b[2] < K.box[0] || b[1] > K.box[3] || b[3] < K.box[1]) continue;
            if (!underMask(d.o, K.o)) continue;
            (hit || (hit = [])).push(K);
            if (!F.hit) F.hit = new Set();
            F.hit.add(K);
        }
        if (hit) maskedBy.set(d, hit);
    }
    for (const F of fams.values()) {
        const b = F.box, under = [];
        for (const K of marks) if (!(b[0] > K.box[2] || b[2] < K.box[0] || b[1] > K.box[3] || b[3] < K.box[1])) under.push(K);
        for (let x = 0; x < under.length; x++) {
            for (let y = x + 1; y < under.length; y++) {
                const A = under[x], B = under[y];
                if (!!(F.hit && F.hit.has(A)) !== !!(F.hit && F.hit.has(B))) { conflict[A.i * m + B.i]++; conflict[B.i * m + A.i]++; }
            }
        }
    }
    const slots = [];
    for (const K of marks) {
        let best = -1, cost = Infinity;
        for (let s = 0; s < slots.length && cost > 0; s++) {
            let c = 0;
            for (const J of slots[s]) c += conflict[K.i * m + J.i];
            if (c < cost) { cost = c; best = s; }
        }
        if (cost > 0 && slots.length < MASKS_MAX) { best = slots.length; slots.push([]); }
        else if (cost > 0) packStats.maskOverflow++;
        slots[best].push(K);
        K.k = best;
    }
    return maskedBy;
}

function emptyJob(opts, plates, paper, pool) {
    return {
        jobId: opts.jobId != null ? opts.jobId : 0,
        frameSeq: opts.frameSeq != null ? opts.frameSeq : 0,
        postedAt: opts.postedAt != null ? opts.postedAt : 0,
        G: opts.G != null ? opts.G : 0,
        q: opts.q || 0, Zq: opts.Zq, plateW: PLATE_PX,
        plates: Int32Array.from(plates),
        paper: Uint8Array.from(paper),
        nItems: 0,
        meta: alloc(pool, Uint32Array, 0), attr: alloc(pool, Float64Array, 0), rgb: alloc(pool, Uint8Array, 0),
        subs: alloc(pool, Uint32Array, 0), geom: alloc(pool, Float64Array, 0), ids: new Int32Array(0),
    };
}

/** `Renderer.js:904`: a family group is painted at full presence; anything else at its own fade. */
function alphaOf(o, f, fade) {
    const op = o.opacity == null ? 1 : o.opacity;
    return f.isFam ? op : op * fade;
}

const boxWithRes = (b, res) => (res ? Float64Array.from([b[0] + res[0], b[1] + res[1], b[2] + res[0], b[3] + res[1]]) : b);

/**
 * §4.2's family rule, narrowed to the overlaps the seam pad leaves inexact (D95): a family takes
 * the union pass when two of its items have loops whose boxes overlap AND whose signed areas are
 * of OPPOSITE sign — one item's hole would otherwise cancel another's body to winding zero. A
 * SAME-wound overlap between two items of one family stays on the fast path, because the engine's
 * 48-unit seam pad is ≥ 1.5 device px (`derive.js:272-278`, §4.5), so inside such an overlap the
 * accumulated value is ≥ 1 and at its outer boundary only one piece contributes. A ring of exactly
 * zero area has no winding to read, so it joins BOTH sides of the split and is paired with
 * everything — `pairNeedsUnion` then reads it as same-wound, which is the safe side and what its
 * own comment says. The per-item rules are `ringsNeedUnion`'s, decided in `build`.
 */
function familyUnion(drawn) {
    // An item that is already a union item by its own rings does not make its SIBLINGS union
    // ones: §4.2 leaves a union item and a fast-path item of one family sharing the buffer.
    const boxes = [], signs = [], owner = [];
    for (let k = 0; k < drawn.length; k++) {
        const e = drawn[k].e;
        if (!e.subBox) continue;
        const res = drawn[k].res;
        for (let s = 0; s < e.subSign.length; s++) {
            boxes.push(res ? [e.subBox[s * 4] + res[0], e.subBox[s * 4 + 1] + res[1], e.subBox[s * 4 + 2] + res[0], e.subBox[s * 4 + 3] + res[1]]
                : [e.subBox[s * 4], e.subBox[s * 4 + 1], e.subBox[s * 4 + 2], e.subBox[s * 4 + 3]]);
            signs.push(e.subSign[s]);
            owner.push(k);
        }
    }
    const flat = new Float64Array(boxes.length * 4);
    for (let i = 0; i < boxes.length; i++) flat.set(boxes[i], i * 4);
    // Only a CROSS-wound pair of DIFFERENT items can need the pass, so the rings are split by
    // winding and a same-owner pair is skipped before the 20,000-pair cap counts it. What the cap
    // counts is exactly the family rule's candidate set: counting anything else caps a family that
    // needs nothing and sends its fast-path siblings down the union pass, which is the 61 % of a
    // screen D91 removed. A zero-signed-area ring joins both lists, so the split reaches it (D101).
    const pos = [], neg = [];
    for (let k = 0; k < boxes.length; k++) {
        if (signs[k] >= 0) pos.push(k);
        if (signs[k] <= 0) neg.push(k);
    }
    let tests = 0;
    for (const i of pos) {
        for (const j of neg) {
            if (owner[i] === owner[j]) continue;
            if (++tests > 20000) { packStats.overlapCapped++; return true; }
            if (pairNeedsUnion(flat, i, signs[i], flat, j, signs[j])) return true;
        }
    }
    return false;
}

/**
 * The family's union orientation: the sign of the signed area of every union item it has, drawn
 * or not (D90). It is what the union pass deposits with, so it decides whether the family's union
 * ink ADDS to a fast-path sibling or cuts a hole in it — and it must be the same number on every
 * plate. An empty or exactly-zero sum returns −1, which the core reads as the +1 deposit its own
 * `sh === 0` fallback gives (`rasterCore.js:1001`: `uSign = sh > 0 ? −1 : 1`).
 *
 * It counts, on the same areas, the items wound AGAINST the family's own total into `f.mixed`,
 * which every pack that draws the family adds to `mixedWinding`.
 * A family accumulates as one nonzero-winding path (§4.5), so where two of its items of opposite
 * winding overlap the ink cancels to a hole, and routing them to the union pass does not repair
 * it: that pass walks the family's union items together and emits where their JOINT winding is
 * non-zero (measured, D106). Today's bake DOES build one: `classifyUp`'s solid tier ships a
 * POSITIVE `covers` quad (`derive.solidQuad`, `derive.js:489`) for a tile a fat stroke's pen
 * covers, while the same object's EDGE tiles ship `bandRings` fills, which are NEGATIVE, and the
 * two overlap by the 2 × 48-unit seam pad — 49,152 units of ink of 262,144 blanked on one plate,
 * `docs/OPEN-FLAGS.md` F76. So a non-zero count is that flag until it is closed in the producer,
 * and a tripwire on the invariant afterwards.
 * The area read here is `unionAreaOf` and not `e.subSign`, because a stroke has no rings in its
 * entry at all and its winding is the band's.
 */
function unionSignOf(all, f, q, Zq, cfg) {
    let sum = 0, tot = 0, pos = 0, neg = 0;
    for (const d of all) {
        // Free for a shape and a fill (the entry's own total) and, for a stroke, the band the
        // sign needs anyway: every stroke is a union item (`buildStroke`), so reading every item
        // here builds no band the family's sign did not already require (D102).
        const a = unionAreaOf(d, q, Zq, cfg);
        if (f.union || d.e.union) sum += a;
        tot += a;
        if (a > 0) pos++;
        else if (a < 0) neg++;
    }
    f.mixed = 0;
    if (pos && neg) {
        const mixed = tot < 0 ? pos : neg;
        f.mixed = mixed;                   // counted by each pack that draws the family
        logOnce("a family whose items are wound against each other",
            "family " + f.rid + ": " + mixed + " of " + (pos + neg) + " items are wound against its total; "
            + "where two of them overlap the ink cancels to a hole, which no declared sign repairs (§4.2)");
    }
    return sum > 0 ? 1 : -1;
}

/**
 * A family's union routing, union sign, colour and alpha as `packJob` decides them, over `items` (the
 * family's items in paint order, render-list shaped): what a change of membership can flip for every
 * item of the family (PLAN §5.1 Q15). Null for a family holding a stroke, whose band's winding is
 * decided per zoom quantum.
 */
export function familyTraits(items, cfg) {
    const all = [];
    for (const o of items) {
        const e = entryFor(o, cfg);
        if (e.bands) return null;
        if (!e.bad) all.push({ o, e, res: o.res || null });
    }
    if (!all.length) return { union: false, sign: 0, colour: "", alpha: 0 };
    const f = { union: familyUnion(all) };
    const sign = unionSignOf(all, f, 0, 1, cfg);
    const first = all[0].o;
    return { union: f.union, sign, colour: String(first.color), alpha: first.opacity == null ? 1 : first.opacity };
}

/**
 * The signed area an item weighs the family's sign with: its own rings for a shape or a fill, and
 * for a stroke the BAND it ships, whose winding a fitted outline decides and no formula predicts
 * (D102). A culled stroke in a drawn family is banded here for that number alone, which is the one
 * thing this file does for an item the cull rejected: the sign must be the same on every plate,
 * and `bandFor` memoises, so the band is built once per item per quantum however many strips ask.
 */
function unionAreaOf(d, q, Zq, cfg) {
    if (!d.e.bands) return d.e.area;
    const band = bandFor(d.o, q, Zq, cfg);
    return band ? band.area : 0;   // a stroke that ships no band paints nothing and weighs nothing
}

/** The flat geometry one kept item contributes, and its exact box when the band supplies one. */
function geomOf(d, q, Zq, cfg) {
    const e = d.e;
    if (e.bands) {
        const band = bandFor(d.o, q, Zq, cfg);
        return band ? { kind: KIND_RINGS, geom: band.geom, subs: band.subs, box: band.box } : null;
    }
    if (!e.geomLen) return null;
    flattenGeom(e, d.o);
    return { kind: e.kind, geom: e.geom, subs: e.subs, box: null };
}
