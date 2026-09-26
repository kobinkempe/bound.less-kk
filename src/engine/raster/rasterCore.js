/**
 * rasterCore.js — the coverage rasteriser. Signed-area accumulation into a dense buffer,
 * one family at a time, over that family's own pixel box inside one plate (512 device
 * pixels square — a plate is pixels; the lattice's tiles and cache squares are frame
 * units, F36). Every coordinate and every intermediate is float64; only the accumulation
 * buffer is Float32 (ACC_F32, decided by §8.6 measurement 2).
 *
 * The inner arithmetic — addEdge / addStep / depositRun — is transcribed from font-rs's
 * `draw_line` (Raph Levien, Apache-2.0), modified four ways: float64 coordinates, the
 * x-clamp taken as a clamp of x(y) rather than of the two endpoints, per-family pixel
 * boxes instead of a whole-plate clear, and per-row touched-column ranges so the clear
 * and the resolve cost the ink rather than the area. The licence and the note of
 * modification are in docs/reference/third-party-notices.md.
 *
 * Four facts a reader needs in order not to break it:
 *  - CLEAR ONLY WHAT WAS TOUCHED (ROWMIN/ROWMAX). Clearing the whole buffer per family is
 *    100–200 ms per plate at 800 families — worse than the renderer being replaced (§4.3).
 *  - A CLAMPED ROW IS PAINTED TO ITS EDGE BY THE ROWMAX CLAMP (D32), not by the tail below
 *    it: a deposit at column TW leaves ROWMAX = TW − 1, so the resolve's own run ends at TW.
 *    The tail's TAIL_EPS is a guard — at 1e-9 the float32 residue of a closed loop painted
 *    the right of every row and added 15 % to a thin shape's coverage (§4.3, D33).
 *  - THE X-CLAMP IS A CLAMP OF x(y). An edge from x = −3 to x = 0.5 across one row covers
 *    0.964 of pixel 0; clamping the endpoints reports 0.750 (R11).
 *  - ACCUMULATION IS EXACT ONLY FOR LOOPS THAT DO NOT OVERLAP. It computes ∫w over the
 *    pixel, and min(∫w,1) is not ∫min(w,1). An item whose rings may overlap — every fat
 *    stroke the engine bakes — carries the union flag and takes the union pass (§4.2, D23).
 *
 * Pure: no DOM, no canvas, no Loop object, no engine, no boolean. It imports plate.js for
 * PLATE_PX and geometry/chordMath.js for the two arc identities — two constant leaves, so
 * the worker bundle stays small and a wasm port stays mechanical (§2.6), and nothing else.
 *
 * ARCS ARE FLATTENED HERE AND NOWHERE ELSE, and the chords live for one plate job: they
 * are never stored, never inherited by another level, and never seen by the hit test,
 * which reads the render list's exact arcs (§4.4). This is not the per-zoom flattening
 * Kobin's rule forbids — nothing that persists is ever flattened.
 */

import { PLATE_PX } from "./plate";
import { bulgeK, chordMidK, sagittaOf, arcAreaTerm } from "../geometry/chordMath";

export const TW = PLATE_PX;
export const TH = PLATE_PX;

/** Float32 accumulation: half the memory traffic, worst error 6e-5 of coverage at 1,000 edges in a row (§3.5). */
export const ACC_F32 = true;
/** Sub-scanlines per pixel row in the union pass: an edge lands within 1/32 device px of its true y (§4.2). */
export const UNION_K = 16;
/**
 * The running sum a row's tail must exceed to be painted. A fifth of one 8-bit alpha step, so
 * nothing visible is lost, and above the float32 accumulation residue of a closed loop —
 * E·2⁻²⁴, 6e-5 at a thousand edges in one row (research §5.2). At 1e-9 the residue painted
 * the whole right of every row of a thin shape and cost 15 % of its measured coverage.
 */
export const TAIL_EPS = 1 / 2048;

const MAX_UEDGE = 16384;            // union edges held for one family; more is walked in row bands
const ACC_STRIDE = TW + 2;          // two spill columns, written by a step clamped at x = TW
const BOX_SLACK = 1e-6;             // device px of outward slack on a family's box; see renderPlate

let ACC = ACC_F32 ? new Float32Array(ACC_STRIDE * TH) : new Float64Array(ACC_STRIDE * TH);
const ROWMIN = new Int32Array(TH);  // first column touched in this row
const ROWMAX = new Int32Array(TH);  // last VISIBLE column touched, never above TW − 1 (R14)
const UEDGE = new Float64Array(4 * MAX_UEDGE);  // yTop, yBot, x at yTop, dx/dy
const UDIR = new Int8Array(MAX_UEDGE);          // +1 for an edge running down the screen
const UHEAD = new Int32Array(TH);               // first edge starting in this row, −1 for none
const UNEXT = new Int32Array(MAX_UEDGE);        // the links of that per-row list
const UACT = new Int32Array(MAX_UEDGE);         // the active-edge list of the y walk
let XS = new Float64Array(2 * 2048);            // one sub-scanline's crossings: x, direction
let DRAWN = new Uint8Array(1024);               // per item, this plate: 1 = not culled
const FLAG_MASK = 8;                            // rasterJob.FLAG_MASK: the core imports its two leaves only (§2.6)
let FAMS = new Int32Array(1024);                // this plate's families: [first item, last item] pairs
/** Coverage a family must reach at every pixel to hide what is under it: what is left is < 0.07 of a byte. */
const COVER_MIN = 1 - 1 / 4096;
/** The occlusion cull, on unless a test turns it off (`setOcclusion`). */
let OCCLUSION = true;
export function setOcclusion(on) { OCCLUSION = !!on; }
/** The cull's own counts (not a wire guard): families left unpainted under a cover, candidate covers that fell short. */
export const occStats = { occluded: 0, coverMisses: 0 };
let CORE_KEYS = null, CORE_SNAP = null;
const MASKS = [];                               // a pending mark's coverage on this plate, by mask index
let maskLive = 0;                               // the masks filled this plate

/** Counters the perf record reads; a worker resets them per job and returns them as §3.4's `guards`. */
export const coreStats = {
    xsGrown: 0,          // a sub-scanline with more crossings than XS held
    unionSplits: 0,      // row bands split off because a family's union edges did not fit; one per split
    unionRefills: 0,     // extra buffer-fulls a single pixel row needed; each costs that row UNION_K
                         // more passes over its geometry, and loses no ink (F75)
    fullClears: 0,       // a non-finite coordinate forced a whole-buffer clear
    nonFinite: 0,        // records refused for a non-finite number: a coordinate on either path,
                         // an arc's sweep, or a whole turn's centre (D54, D65, D68). An arc whose
                         // two ends are finite is drawn as its chord, whichever of those three
                         // refused it, so only a non-finite END or a line's own coordinate leaves
                         // the outline open (D71)
    arcClamped: 0,       // an arc whose bisection depth was clamped to MAXD: its chords may sit
                         // further than ARC_TOL from the arc, by an unbounded amount — measured
                         // 0.11 device px at 1e14 px of screen radius and 1.13 at 1e15 (§4.4)
    arcOverTurn: 0,      // arc records refused for a |sweep| past a whole turn, §4.4's bound: the
                         // antipode split is not their midpoint, so drawing one paints the wrong
                         // picture — 46,262 units of ink at 3π against the oracle's 25,441 for the
                         // true disc (D67). The record is drawn as its chord instead (D71). Counted
                         // once per family however many band loads its geometry takes (D72)
};

let DEBUG = false;
// A TRANSPARENT plate (paper alpha 0, PAPER-PLAN §10 S4, B §3.3): the resolve writes alpha too and
// the plate is un-premultiplied at its end. Set per plate by `renderPlate`.
let ALPHA_OUT = false;
let famY0 = 0, famY1 = TH;
let needFullClear = false;
// The clip box of the plate being drawn, plate-local px, half-open: the whole plate unless `renderPlate` was
// handed one. Rows are restricted to it and x is not folded at its edges, so every sum inside it runs as the
// whole plate's does (A3 §3.1; rasterCore.clip.test.js).
let CX0 = 0, CY0 = 0, CX1 = TW, CY1 = TH;

/** Debug checks: every edge must land inside its family's declared box, or the clear misses a row. */
export function setDebugChecks(on) { DEBUG = !!on; }

/**
 * Swap the accumulation buffer's precision. Bench and R12 only — the shipped path allocates
 * once and never reallocates (§3.5); this exists so measurement 2 can compare the two.
 * @param {"f32"|"f64"} kind
 */
export function useAccumPrecision(kind) {
    const want32 = kind === "f32";
    if (want32 === (ACC instanceof Float32Array)) return;
    ACC = want32 ? new Float32Array(ACC_STRIDE * TH) : new Float64Array(ACC_STRIDE * TH);
}
/** Which precision the buffer holds now. */
export const accumPrecision = () => (ACC instanceof Float32Array ? "f32" : "f64");
/** One accumulation cell, for the tests and the bench; the running sum over a row is the coverage. */
export const readAcc = (x, y) => ACC[y * ACC_STRIDE + x];
/** This row's touched-column range, [first, last]; last is never above TW − 1 (R14). */
export const rowRange = (y) => [ROWMIN[y], ROWMAX[y]];
/**
 * The prune flags the LAST `renderPlate` filled: `DRAWN[it]` is 1 where item `it`'s box reached
 * that plate. The worker builds the plate's painted-id set from them (§3.4, D84) so the prune
 * rule has one copy. The array is longer than the job's item count and is refilled by the next
 * `renderPlate`, so read it before that call and only below `nItems`.
 */
export const drawnFlags = () => DRAWN;

// ---------------------------------------------------------------------------
// The deposit. font-rs's draw_line body: float64, the stride, and the touched range.
// ---------------------------------------------------------------------------

/** One step of an edge inside row `y`, from xs to xe (both inside [0, TW]), signed height `d`. */
function depositRun(y, xs, xe, d) {
    if (d === 0) return;
    const base = y * ACC_STRIDE;
    const xlo = xs < xe ? xs : xe, xhi = xs < xe ? xe : xs;
    const x0f = Math.floor(xlo), x0i = x0f | 0;
    const x1c = Math.ceil(xhi), x1i = x1c | 0;

    if (x1i <= x0i + 1) {                       // the step stays in one pixel column
        const xmf = 0.5 * (xs + xe) - x0f;
        ACC[base + x0i] += d * (1 - xmf);
        ACC[base + x0i + 1] += d * xmf;
    } else {                                    // the step spans several columns
        const s = 1 / (xhi - xlo);
        const x0r = xlo - x0f;
        const a0 = 0.5 * s * (1 - x0r) * (1 - x0r);
        const x1r = xhi - x1c + 1;
        const am = 0.5 * s * x1r * x1r;
        ACC[base + x0i] += d * a0;
        if (x1i === x0i + 2) {
            ACC[base + x0i + 1] += d * (1 - a0 - am);
        } else {
            const a1 = s * (1.5 - x0r);
            ACC[base + x0i + 1] += d * (a1 - a0);
            for (let xi = x0i + 2; xi < x1i - 1; xi++) ACC[base + xi] += d * s;
            const a2 = a1 + (x1i - x0i - 3) * s;
            ACC[base + x1i - 1] += d * (1 - a2 - am);
        }
        ACC[base + x1i] += d * am;
    }
    if (x0i < ROWMIN[y]) ROWMIN[y] = x0i;
    const hi = x1i > TW - 1 ? TW - 1 : x1i;     // the resolve never reads past TW − 1; the clear adds 2
    if (hi > ROWMAX[y]) ROWMAX[y] = hi;
}

/**
 * One step of an edge inside row `y`, before clamping. The clamp is of x(y): the step is
 * split where x crosses 0 and where it crosses TW, and each outside part becomes a vertical
 * edge at the bound. Clamping the two endpoints instead is wrong by 0.214 of a pixel on the
 * R11 case.
 */
function addStep(y, xs, xe, d) {
    if (xs === xe) {
        const v = xs < 0 ? 0 : (xs > TW ? TW : xs);
        depositRun(y, v, v, d);
        return;
    }
    let a = xs, b = xe, da = d;
    if (a < 0 && b < 0) { depositRun(y, 0, 0, d); return; }
    if (a > TW && b > TW) { depositRun(y, TW, TW, d); return; }
    if (a < 0 || b < 0) {
        const f = (0 - a) / (b - a);
        if (a < 0) { depositRun(y, 0, 0, d * f); a = 0; da = d * (1 - f); }
        else { depositRun(y, 0, 0, d * (1 - f)); b = 0; da = d * f; }
    }
    if (a > TW || b > TW) {
        const f = (TW - a) / (b - a);
        if (b > TW) { depositRun(y, TW, TW, da * (1 - f)); b = TW; da = da * f; }
        else { depositRun(y, TW, TW, da * f); a = TW; da = da * (1 - f); }
    }
    depositRun(y, a, b, da);
}

/**
 * One straight edge, in plate-local device pixels. Returns 1 if it deposited anything, 0 if
 * it was horizontal, off the plate in y, or dropped as non-finite — a non-finite coordinate
 * survives the bounded clear (ROWMIN/ROWMAX are kept by comparisons, which are false against
 * NaN), so it is dropped here and a full clear is forced at the end of the family (§3.5).
 */
export function addEdge(x0, y0, x1, y1) {
    if (!(isFinite(x0) && isFinite(y0) && isFinite(x1) && isFinite(y1))) {
        coreStats.nonFinite++; needFullClear = true; return 0;
    }
    if (y0 === y1) return 0;
    let dir = 1;
    if (y0 > y1) { const tx = x0; x0 = x1; x1 = tx; const ty = y0; y0 = y1; y1 = ty; dir = -1; }
    if (y1 <= CY0 || y0 >= CY1) return 0;

    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0, ytop = y0;
    if (y0 < 0) { x = x0 - y0 * dxdy; ytop = 0; }
    const ybot = y1 < TH ? y1 : TH;
    if (DEBUG) {
        const r0 = Math.max(Math.floor(ytop), CY0), r1 = Math.min(Math.ceil(ybot), CY1);
        if (r0 < famY0 || r1 > famY1) {
            throw new Error("rasterCore: rows " + r0 + ".." + r1
                + " are outside the family box " + famY0 + ".." + famY1 + ", so the clear will miss one");
        }
    }

    // A row above the clip is walked and not deposited: x reaches the clip by the same additions as on
    // the whole plate, so the clip's deposits are the whole plate's to the bit.
    let y = Math.floor(ytop);
    while (y < ybot && y < CY1) {
        const rowTop = y > ytop ? y : ytop;
        const rowBot = (y + 1) < ybot ? (y + 1) : ybot;
        const dy = rowBot - rowTop;
        const xnext = x + dxdy * dy;
        if (y >= CY0) addStep(y, x, xnext, dy * dir);
        x = xnext;
        y++;
    }
    return 1;
}

// ---------------------------------------------------------------------------
// One family: reset, deposit, resolve, clear.
// ---------------------------------------------------------------------------

/** Start a family over rows [y0, y1): reset the touched-column ranges those rows will keep. */
export function beginFamily(y0, y1) {
    famY0 = y0; famY1 = y1;
    for (let y = y0; y < y1; y++) { ROWMIN[y] = TW + 2; ROWMAX[y] = -1; }
}

/**
 * The running sum turns the accumulation into coverage and blends it onto the plate:
 * C = min(|∫w|, 1), alpha = 255·C·opacity, blended on the sRGB bytes as every browser does
 * (§4.7). `maskBits` names the pending marks over the family: its coverage is C·Π(1 − mask).
 * Returns the number of pixels it painted.
 */
export function resolveFamily(out, r, g, b, alpha, y0, y1, maskBits = 0) {
    let covered = 0;
    const M = maskBits && (maskBits & (maskBits - 1)) === 0 ? MASKS[31 - Math.clz32(maskBits)] : null;
    for (let y = y0; y < y1; y++) {
        const xa = ROWMIN[y];
        if (xa > TW - 1) continue;
        const base = y * ACC_STRIDE, row = y * TW;
        const rm = ROWMAX[y];
        const xb = rm + 1 < TW ? rm + 1 : TW;
        // The sum starts at the row's first touched column wherever the clip does: left of the clip it
        // is summed and not written.
        let acc = 0, x = xa;
        for (; x < xb && x < CX0; x++) acc += ACC[base + x];
        const xe = xb < CX1 ? xb : CX1;
        let p = (row + x) * 4;
        for (; x < xe; x++, p += 4) {
            acc += ACC[base + x];
            let c = acc < 0 ? -acc : acc;
            if (c > 1) c = 1;
            if (maskBits) c *= M ? 1 - M[row + x] : keepAt(maskBits, row + x);
            const a = c * alpha;
            if (a <= 0) continue;
            if (a >= 1) {                             // an opaque interior pixel: no read, no multiply
                out[p] = r; out[p + 1] = g; out[p + 2] = b;
                if (ALPHA_OUT) out[p + 3] = 255;
            } else {
                const inv = 1 - a;
                out[p] = r * a + out[p] * inv;
                out[p + 1] = g * a + out[p + 1] * inv;
                out[p + 2] = b * a + out[p + 2] * inv;
                // Over transparent black the three above are PREMULTIPLIED; alpha is source-over too.
                if (ALPHA_OUT) out[p + 3] = 255 * a + out[p + 3] * inv;
            }
            covered++;
        }
        if (xb >= CX1) continue;
        // The tail. A row whose sum is still non-zero here was clamped at x = TW, which forces
        // ROWMAX = TW − 1 (D32) — so xb is TW and this loop is empty: the clamp, not the tail,
        // is what paints a clamped row to its edge. What TAIL_EPS earns is the other case — at
        // 1e-9 the f32 residue of a closed loop (~6e-8) blended every remaining column of every
        // row of a thin shape and added 15 % to its coverage (D33).
        const xt = xb > CX0 ? xb : CX0;
        p = (row + xt) * 4;
        if ((acc > TAIL_EPS || acc < -TAIL_EPS) && maskBits) {
            let c = acc < 0 ? -acc : acc;
            if (c > 1) c = 1;
            for (let x2 = xt; x2 < CX1; x2++, p += 4) {
                const a = c * alpha * (M ? 1 - M[row + x2] : keepAt(maskBits, row + x2));
                if (a <= 0) continue;
                const inv = 1 - a;
                out[p] = r * a + out[p] * inv;
                out[p + 1] = g * a + out[p + 1] * inv;
                out[p + 2] = b * a + out[p + 2] * inv;
                if (ALPHA_OUT) out[p + 3] = 255 * a + out[p + 3] * inv;
                covered++;
            }
        } else if (acc > TAIL_EPS || acc < -TAIL_EPS) {
            let c = acc < 0 ? -acc : acc;
            if (c > 1) c = 1;
            const a = c * alpha;
            if (a >= 1) {
                for (let x2 = xt; x2 < CX1; x2++, p += 4) { out[p] = r; out[p + 1] = g; out[p + 2] = b; if (ALPHA_OUT) out[p + 3] = 255; covered++; }
            } else if (a > 0) {
                const inv = 1 - a;
                for (let x2 = xt; x2 < CX1; x2++, p += 4) {
                    out[p] = r * a + out[p] * inv;
                    out[p + 1] = g * a + out[p + 1] * inv;
                    out[p + 2] = b * a + out[p + 2] * inv;
                    if (ALPHA_OUT) out[p + 3] = 255 * a + out[p + 3] * inv;
                    covered++;
                }
            }
        }
    }
    return covered;
}

/**
 * One family's coverage into ACC over rows [y0, y1): its fast-path items' edges, then the union pass
 * for its union items. Returns the edges deposited.
 */
function depositFamily(job, it, last, ox, oy, Zq, y0, y1) {
    const meta = job.meta, attr = job.attr;
    let edges = 0, hasUnion = false;
    beginFamily(y0, y1);
    for (let k = it; k <= last; k++) {
        if (!DRAWN[k]) continue;
        if (meta[k * 8 + 6] & 4) { hasUnion = true; continue; }
        const a = k * 9;
        edges += emitItem(job, k, attr[a + 4], attr[a + 5], ox, oy, Zq);
    }
    if (hasUnion) {
        // The deposit's sign is the family's own orientation and must not depend on which of its
        // items this plate happens to see, or one plate paints ink where its neighbour cuts a hole
        // (D64). `attr[8]` carries the packer's sign, taken over every union item of the family
        // whether or not it reaches this strip (D90); a hand-built job leaves it 0 and the shoelace
        // below is the fallback, summed over the family's union items DRAWN OR NOT for the same reason.
        let sh = 0, declared = 0;
        for (let k = it; k <= last; k++) {
            if ((meta[k * 8 + 6] & 4) === 0) continue;
            declared += attr[k * 9 + 8];
        }
        for (let k = it; k <= last && declared === 0; k++) {
            if ((meta[k * 8 + 6] & 4) === 0) continue;
            const a = k * 9;
            sh += itemShoelace(job, k, attr[a + 4], attr[a + 5], ox, oy, Zq);
        }
        if (declared !== 0) sh = declared;
        // The deposit carries the geometry's own orientation, so a union item and a fast-path
        // item of one family add where they meet instead of cancelling.
        uSign = sh > 0 ? -1 : 1;
        unionPass(job, it, last, ox, oy, Zq, y0, y1);
    }
    return edges;
}

/** Could this family hide the whole clip: opaque, under no mark, not a mark, its drawn boxes spanning the clip? */
function coverCandidate(job, it, last, ox, oy, Zq) {
    const meta = job.meta, attr = job.attr;
    let first = -1, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = it; k <= last; k++) {
        if (meta[k * 8 + 6] & FLAG_MASK) return false;
        if (maskLive && (meta[k * 8 + 7] & maskLive)) return false;
        if (!DRAWN[k]) continue;
        if (first < 0) first = k;
        const a = k * 9;
        if (attr[a] < x0) x0 = attr[a];
        if (attr[a + 1] < y0) y0 = attr[a + 1];
        if (attr[a + 2] > x1) x1 = attr[a + 2];
        if (attr[a + 3] > y1) y1 = attr[a + 3];
    }
    if (first < 0 || !(attr[first * 9 + 7] >= 1)) return false;
    return x0 * Zq - ox <= CX0 && y0 * Zq - oy <= CY0 && x1 * Zq - ox >= CX1 && y1 * Zq - oy >= CY1;
}

/** Does the coverage in ACC fill every pixel of the clip (to COVER_MIN)? The sum runs from column 0. */
function fillsPlate() {
    for (let y = CY0; y < CY1; y++) {
        const base = y * ACC_STRIDE, rm = ROWMAX[y];
        const xb = rm + 1 < TW ? rm + 1 : TW;
        const xe = xb < CX1 ? xb : CX1;
        let acc = 0;
        for (let x = 0; x < xe; x++) {
            acc += ACC[base + x];
            if (x >= CX0 && (acc < 0 ? -acc : acc) < COVER_MIN) return false;
        }
        if (xb < CX1 && (acc < 0 ? -acc : acc) < COVER_MIN) return false;
    }
    return true;
}

/** What several masks leave of pixel `i`: Π(1 − mask). */
function keepAt(bits, i) {
    let keep = 1;
    for (let k = 0; bits; k++, bits >>>= 1) if (bits & 1) keep *= 1 - MASKS[k][i];
    return keep;
}

/**
 * A pending mark's family resolved into mask `k` instead of onto the plate: its coverage, the max over its
 * items. The plane is a whole plate, written and read inside the clip only.
 */
function resolveMask(k, y0, y1) {
    let M = MASKS[k];
    if (!M) M = MASKS[k] = new Float32Array(TW * TH);
    if (!(maskLive & (1 << k))) { M.fill(0); maskLive |= 1 << k; }
    for (let y = y0; y < y1; y++) {
        const xa = ROWMIN[y];
        if (xa > TW - 1) continue;
        const base = y * ACC_STRIDE, row = y * TW, rm = ROWMAX[y];
        const xb = rm + 1 < TW ? rm + 1 : TW;
        let acc = 0, x = xa;
        for (; x < xb && x < CX0; x++) acc += ACC[base + x];
        const xe = xb < CX1 ? xb : CX1;
        for (; x < xe; x++) {
            acc += ACC[base + x];
            let c = acc < 0 ? -acc : acc;
            if (c > 1) c = 1;
            if (c > M[row + x]) M[row + x] = c;
        }
        if (xb >= CX1) continue;
        if (acc > TAIL_EPS || acc < -TAIL_EPS) {
            let c = acc < 0 ? -acc : acc;
            if (c > 1) c = 1;
            for (let x2 = xb > CX0 ? xb : CX0; x2 < CX1; x2++) if (c > M[row + x2]) M[row + x2] = c;
        }
    }
}

/** Clear exactly what the family touched: its rows, and in each the columns plus the two spill ones. */
export function clearFamily(y0, y1) {
    for (let y = y0; y < y1; y++) {
        const base = y * ACC_STRIDE;
        const hi = ROWMAX[y] + 2;
        for (let x = ROWMIN[y]; x <= hi; x++) ACC[base + x] = 0;
    }
    if (needFullClear) { ACC.fill(0); needFullClear = false; coreStats.fullClears++; }
}

/** Rows this family actually touched, for the counts. */
function rowsTouched(y0, y1) {
    let n = 0;
    for (let y = y0; y < y1; y++) if (ROWMIN[y] <= TW - 1) n++;
    return n;
}

// ---------------------------------------------------------------------------
// The union pass (§4.2, D23): exact-winding sub-scanlines, deposited as a winding-1 region.
// ---------------------------------------------------------------------------

let uCount = 0, uSign = 1;
// The chunked row walk (F75): edges whose index among the ones this band would store is below
// uSkip were taken by an earlier buffer-full and are counted, not stored. uSkip is 0 everywhere
// but inside walkRowChunked, so the loader has one form and the skip is stable between passes.
let uSkip = 0, uSeen = 0;

/** Load one clipped edge for the y walk; returns false when the buffer is full. */
function pushUnionEdge(ax, ay, bx, by, yb0, yb1) {
    if (!(isFinite(ax) && isFinite(ay) && isFinite(bx) && isFinite(by))) { coreStats.nonFinite++; needFullClear = true; return true; }
    if (ay === by) return true;
    let dir = 1;
    if (ay > by) { const tx = ax; ax = bx; bx = tx; const ty = ay; ay = by; by = ty; dir = -1; }
    if (by <= yb0 || ay >= yb1) return true;
    const dxdy = (bx - ax) / (by - ay);
    let yTop = ay, xTop = ax;
    if (yTop < yb0) { xTop = ax + (yb0 - ay) * dxdy; yTop = yb0; }
    const yBot = by < yb1 ? by : yb1;
    if (!(yBot > yTop)) return true;
    if (uSeen++ < uSkip) return true;
    if (uCount >= MAX_UEDGE) return false;
    const o = uCount * 4;
    UEDGE[o] = yTop; UEDGE[o + 1] = yBot; UEDGE[o + 2] = xTop; UEDGE[o + 3] = dxdy;
    UDIR[uCount] = dir;
    uCount++;
    return true;
}

/**
 * Sort `n` crossings held in XS as (x, dir) pairs, ascending in x, stably. A scanline usually holds a
 * handful (insertion sort); a wide pen's band crosses one hundreds of times (598 on average, 1,132 at
 * most, for a 337 px scribble), and the insertion sort made that plate 4–16 s (F130): past 32, a
 * bottom-up merge sort, which is as stable, so the picture is the same to the byte.
 */
function sortCrossings(n) {
    if (n > 32) { mergeCrossings(n); return; }
    for (let i = 1; i < n; i++) {
        const x = XS[2 * i], d = XS[2 * i + 1];
        let j = i - 1;
        while (j >= 0 && XS[2 * j] > x) { XS[2 * j + 2] = XS[2 * j]; XS[2 * j + 3] = XS[2 * j + 1]; j--; }
        XS[2 * j + 2] = x; XS[2 * j + 3] = d;
    }
}
let XT = new Float64Array(2 * 2048);             // the merge sort's other buffer
/** Sub-scanlines merge-sorted (F130). Not in `coreStats`, whose keys are the worker's wire order. */
export const sortStats = { mergeSorts: 0 };
function mergeCrossings(n) {
    if (XT.length < XS.length) XT = new Float64Array(XS.length);
    sortStats.mergeSorts++;
    let a = XS, b = XT;
    for (let w = 1; w < n; w *= 2) {
        for (let lo = 0; lo < n; lo += 2 * w) {
            const mid = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
            let i = lo, j = mid, k = lo;
            while (i < mid && j < hi) {
                if (a[2 * j] < a[2 * i]) { b[2 * k] = a[2 * j]; b[2 * k + 1] = a[2 * j + 1]; j++; }
                else { b[2 * k] = a[2 * i]; b[2 * k + 1] = a[2 * i + 1]; i++; }
                k++;
            }
            while (i < mid) { b[2 * k] = a[2 * i]; b[2 * k + 1] = a[2 * i + 1]; i++; k++; }
            while (j < hi) { b[2 * k] = a[2 * j]; b[2 * k + 1] = a[2 * j + 1]; j++; k++; }
        }
        const t = a; a = b; b = t;
    }
    if (a !== XS) XS.set(a.subarray(0, 2 * n));
}
/** Test hook: sort pairs through the shipped path, in XS. */
export function sortCrossingsForTest(pairs) {
    const n = pairs.length / 2;
    while (XS.length < pairs.length) growXS();
    XS.set(pairs);
    sortCrossings(n);
    return Array.from(XS.subarray(0, pairs.length));
}

/** Grow the crossing buffer; the shipped path never reaches this, and it is counted when it does. */
function growXS() {
    const bigger = new Float64Array(XS.length * 2);
    bigger.set(XS);
    XS = bigger;
    coreStats.xsGrown++;
}

/** The crossings of UACT[0..nAct) with sub-scanline `ys`, appended after `n`; returns the new n. */
function gatherCrossings(ys, n, nAct) {
    for (let a = 0; a < nAct; a++) {
        const e = UACT[a], o = e * 4;
        if (UEDGE[o] > ys || UEDGE[o + 1] <= ys) continue;
        if (2 * n + 2 > XS.length) growXS();
        XS[2 * n] = UEDGE[o + 2] + (ys - UEDGE[o]) * UEDGE[o + 3];
        XS[2 * n + 1] = UDIR[e];
        n++;
    }
    return n;
}

/**
 * One sub-scanline's `n` crossings resolved into covered runs and deposited into row `y` at
 * weight `w`. A run is O(1), not O(its length): the running sum carries a constant across an
 * interval for nothing, so only the two end cells are written.
 */
function emitRuns(y, n, w) {
    if (n < 2) return;
    sortCrossings(n);
    let wind = 0, xa = 0;
    for (let c = 0; c < n; c++) {
        const was = wind;
        wind += XS[2 * c + 1];
        if (was === 0 && wind !== 0) xa = XS[2 * c];
        else if (was !== 0 && wind === 0) {
            let a = xa, b = XS[2 * c];
            if (a < 0) a = 0; else if (a > TW) a = TW;
            if (b < 0) b = 0; else if (b > TW) b = TW;
            if (a === b) continue;
            depositRun(y, a, a, w);
            depositRun(y, b, b, -w);
        }
    }
}

/**
 * Walk the loaded edges over rows [yb0, yb1) at K sub-scanlines each, and deposit the true
 * covered runs into ACC as a winding-1 region.
 */
function walkUnion(yb0, yb1) {
    for (let y = yb0; y < yb1; y++) UHEAD[y] = -1;
    for (let e = 0; e < uCount; e++) {
        let row = Math.floor(UEDGE[e * 4]) | 0;
        if (row < yb0) row = yb0; else if (row >= yb1) row = yb1 - 1;
        UNEXT[e] = UHEAD[row]; UHEAD[row] = e;
    }
    const step = 1 / UNION_K, half = step / 2, w = step * uSign;
    let nAct = 0;
    for (let y = yb0; y < yb1; y++) {
        for (let e = UHEAD[y]; e !== -1; e = UNEXT[e]) UACT[nAct++] = e;
        for (let k = 0; k < UNION_K; k++) emitRuns(y, gatherCrossings(y + half + k * step, 0, nAct), w);
        let keep = 0;                                 // drop the edges that end inside this row
        const yNext = y + 1;
        for (let a = 0; a < nAct; a++) { const e = UACT[a]; if (UEDGE[e * 4 + 1] > yNext) UACT[keep++] = e; }
        nAct = keep;
    }
}

// ---------------------------------------------------------------------------
// The plate.
// ---------------------------------------------------------------------------

/**
 * Paint the plate the paper colour; the plate is opaque, so a blit is a copy (D7) — except a
 * TRANSPARENT plate (`a` 0), the drag plane's ink (PAPER-PLAN §10 S4), which `unpremultiply` ends.
 * `rect` = [x0, y0, x1, y1] paints only that box (a clipped render); null, the whole plate.
 */
export function fillPaper(out, r, g, b, a = 255, rect = null) {
    if ((out.byteOffset & 3) === 0 && out.length === TW * TH * 4) {
        const u32 = new Uint32Array(out.buffer, out.byteOffset, TW * TH);
        const at = rect ? rect[1] * TW + rect[0] : 0;
        out[at * 4] = r; out[at * 4 + 1] = g; out[at * 4 + 2] = b; out[at * 4 + 3] = a;
        const v = u32[at];                            // one pixel written in this platform's byte order
        if (!rect) { u32.fill(v); return; }
        for (let y = rect[1]; y < rect[3]; y++) u32.fill(v, y * TW + rect[0], y * TW + rect[2]);
        return;
    }
    if (!rect) { for (let p = 0; p < out.length; p += 4) { out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a; } return; }
    for (let y = rect[1]; y < rect[3]; y++) {
        for (let p = (y * TW + rect[0]) * 4, e = (y * TW + rect[2]) * 4; p < e; p += 4) { out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a; }
    }
}

/**
 * A transparent plate's resolve accumulated premultiplied colour; `ImageData` is straight alpha,
 * so each partly covered pixel is divided back. Without it every antialiased edge darkens (B §3.3).
 * `rect` as `fillPaper`'s.
 */
export function unpremultiply(out, rect = null) {
    const x0 = rect ? rect[0] : 0, y0 = rect ? rect[1] : 0, x1 = rect ? rect[2] : TW, y1 = rect ? rect[3] : TH;
    for (let y = y0; y < y1; y++) {
        for (let p = (y * TW + x0) * 4, e = (y * TW + x1) * 4; p < e; p += 4) {
            const A = out[p + 3];
            if (A === 0 || A === 255) continue;
            const k = 255 / A;
            out[p] = out[p] * k; out[p + 1] = out[p + 1] * k; out[p + 2] = out[p + 2] * k;
        }
    }
}

// The loop grammar (geometry/loop.js:1-25): record code → numbers in the record. Kept here as
// four numbers rather than an import, so the worker bundle holds no Loop class (§2.6).
const RECORD_WIDTH = { 0: 3, 1: 8, 2: 9, 3: 16 };
const widthOf = (code) => RECORD_WIDTH[code] || 8;

// ---------------------------------------------------------------------------
// Arcs: centre-free bisection, pruned against the plate (§4.4).
// ---------------------------------------------------------------------------

/** Device pixels a chord may depart from its arc: a quarter of Kobin's quarter-pixel bar (§4.4). */
export const ARC_TOL = 1 / 16;
/** The deepest bisection. A clamp to it is counted, because it breaks ARC_TOL by an unbounded amount. */
const MAXD = 24;
const TAU = Math.PI * 2;
// Within this of a whole turn a record's two ends coincide, so neither the bisection nor the
// chord-form area can be taken from them: both readers go to the centre instead (D54, D60).
const WHOLE_TURN = TAU - 1e-9;
// §4.4's bound on a record: |sweep| is at most a whole turn, which the engine's own arcs are
// normalised to (`geometry/biarc.js:93`; every later operation only scales a sweep down). Past
// it the antipode split is not the arc's own midpoint and the picture is wrong, so the record
// is refused (D67). The 1e-9 slack mirrors WHOLE_TURN, so a record rounded a hair past a turn
// still draws its circle.
const MAX_SWEEP = TAU + 1e-9;
const HALF_PI = Math.PI / 2;
// A descent that pops one node and pushes both children holds up to D + 1, and a write past
// a typed array's end is SILENTLY DROPPED — the geometry would vanish with no error anywhere.
const STACK = new Float64Array(6 * (MAXD + 2));   // Ax, Ay, Bx, By, sweep, depth
const KTAB = new Float64Array(MAXD + 1);          // the bulge coefficient at each depth: one tan per depth
const SUBPT = new Float64Array(2 * 9);            // the forced sub-arcs' endpoints, for the depth
const MID = new Float64Array(2);
const ARC_EDGE = 0, ARC_UNION = 1;
let arcChords = 0;                                // Σ 2^D over the plate's arc pieces: counts[5]

/**
 * The splits forced before a pruning box can be computed: the smallest f with
 * |sweep|/2^f ≤ π/2. `sagittaOf` is Infinity over a half turn, the chord-count formula
 * divides by sin(θ/2) and by the chord, and the cheap small-angle form is only good to
 * 6 % beyond a quarter turn — so a piece is bisected f times before anything is asked of
 * it. `emitArc` refuses a sweep past a whole turn (D67), so f is at most 2 there; the cap at
 * 3 bounds a direct caller — this and `arcDepth` are exported for the tests.
 */
export function arcForced(sweep) {
    let a = Math.abs(sweep), f = 0;
    while (a > HALF_PI && f < 3) { a *= 0.5; f++; }
    return f;
}

/**
 * The bisection depth for one piece: 2^D chords, each within ARC_TOL of the arc.
 *
 * A FUNCTION OF THE PIECE AND THE TOLERANCE ONLY, never of the plate — that is what makes
 * two neighbouring plates flatten one arc to the same chords and agree at the seam (§4.4,
 * and the same trap DESIGN.md §5 solved for the freeze). The count comes from
 * n ≥ θ / (2·arccos(1 − 2·tol·sin(θ/2)/L)), which has no radius in it, taken over the
 * forced sub-arcs and rounded up to a power of two.
 *
 * Both clamps are load-bearing: under a screen radius of tol/2 the arccos argument falls
 * below −1 and returns NaN, and between tol/2 and tol the count is under 1 and the depth
 * would come out below FORCED — either way `depth === D` never fires and the descent does
 * not terminate (A9).
 */
export function arcDepth(ax, ay, bx, by, sweep) {
    if (sagittaOf(ax, ay, bx, by, sweep) <= ARC_TOL) return 0;   // one chord is already inside the bar
    const forced = arcForced(sweep);
    const n = 1 << forced;
    SUBPT[0] = ax; SUBPT[1] = ay; SUBPT[2 * n] = bx; SUBPT[2 * n + 1] = by;
    let s = sweep;
    for (let d = 0; d < forced; d++) {
        const k = bulgeK(s), span = n >> d, half = span >> 1;
        for (let i = 0; i < n; i += span) {
            chordMidK(SUBPT[2 * i], SUBPT[2 * i + 1], SUBPT[2 * (i + span)], SUBPT[2 * (i + span) + 1], k, MID);
            SUBPT[2 * (i + half)] = MID[0]; SUBPT[2 * (i + half) + 1] = MID[1];
        }
        s *= 0.5;
    }
    const th = Math.abs(s);
    let deepest = 0;
    for (let i = 0; i < n; i++) {
        const dx = SUBPT[2 * (i + 1)] - SUBPT[2 * i], dy = SUBPT[2 * (i + 1) + 1] - SUBPT[2 * i + 1];
        const L = Math.hypot(dx, dy);
        if (!(L > 0)) continue;
        let u = 1 - (2 * ARC_TOL * Math.sin(th / 2)) / L;        // 1 − tol/R, written without the radius
        if (u < -1) u = -1; else if (u > 1) u = 1;
        const ac = Math.acos(u);
        const cnt = ac > 0 ? th / (2 * ac) : Infinity;
        const di = cnt > 1 ? Math.ceil(Math.log2(cnt)) : 0;
        if (di > deepest) deepest = di;
    }
    let D = forced + deepest;
    if (!(D <= MAXD)) { D = MAXD; coreStats.arcClamped++; }      // catches Infinity and NaN with it
    return D < forced ? forced : D;
}

/**
 * One straight edge from A to B in whichever mode the caller is in: what a refused arc record
 * leaves behind, so its loop closes (D71). Scale-only coordinates in, plate-local out, as the
 * flattener's own leaves are. Returns the edges deposited, or −1 when the union buffer filled.
 */
function chordOf(ax, ay, bx, by, ox, oy, mode, yb0, yb1) {
    if (mode === ARC_EDGE) return addEdge(ax - ox, ay - oy, bx - ox, by - oy);
    return pushUnionEdge(ax - ox, ay - oy, bx - ox, by - oy, yb0, yb1) ? 0 : -1;
}

/**
 * One arc piece's chords. The coordinates are scaled frame units with the residual in —
 * the plate origin is subtracted at the leaf, and that is the one exact integer
 * subtraction of §4.6, so every plate flattens the piece to the SAME chords and only its
 * prune decisions differ.
 *
 * ARC_EDGE deposits the chords and returns how many edges were deposited; ARC_UNION loads
 * them into the union edge buffer and returns −1 if the buffer filled.
 */
function emitArc(ax, ay, bx, by, sweep, cx, cy, ox, oy, mode, yb0, yb1) {
    // The item gate: a malformed record is counted and DRAWN AS ITS CHORD, whichever of the
    // three refusals below takes it, because a loop with
    // an edge missing is not an item with a record missing — accumulation is signed, so an open
    // outline leaks: the D67 test's triangle painted 34,944 units of ink out to the plate's
    // right edge where the item is 7,110, and its union copy painted nothing at all (D71). The
    // chord is also the term `itemShoelace` gives such a record, so the two agree. A non-finite
    // END has no chord, so that one case keeps the gap — as `addEdge` does for a line.
    if (!(isFinite(ax) && isFinite(ay) && isFinite(bx) && isFinite(by))) {
        coreStats.nonFinite++; needFullClear = true; return 0;   // 0, not −1: −1 is the union overflow
    }
    // A non-finite SWEEP re-entered the whole-turn split for ever — half of Infinity is
    // Infinity — and threw a RangeError out of `renderPlate` (D65). A non-finite END is refused
    // above (D68): an INFINITE end makes the chord infinite, so the count comes back Infinity,
    // the depth is clamped to MAXD and the descent walks all 16,777,216 of its leaves —
    // about 0.7 s for one record, 620–817 ms over the runs recorded; a NaN end costs one chord
    // and 5 ms.
    if (!isFinite(sweep)) {
        coreStats.nonFinite++;
        return chordOf(ax, ay, bx, by, ox, oy, mode, yb0, yb1);
    }
    // Past a whole turn the antipode below is not the arc's own midpoint, so the split paints
    // the wrong picture: measured at 3π, 46,262 units of ink against the oracle's 25,441 for
    // the true disc, and at 12 rad the plate floods. The engine cannot emit one —
    // `biarc.js:92-95` normalises a sweep into (0, 2π] or [−2π, 0) and every later operation
    // only scales one down — so it is refused rather than split (D67), and `setDebugChecks`
    // turns that into the throw a packer test needs.
    if (Math.abs(sweep) > MAX_SWEEP) {
        coreStats.arcOverTurn++;
        if (DEBUG) throw new Error("rasterCore: an arc sweep of " + sweep + " is past a whole turn, which §4.4 bounds at 2π");
        return chordOf(ax, ay, bx, by, ox, oy, mode, yb0, yb1);
    }
    // A WHOLE TURN is the one arc its own two ends do not describe: every circle through A
    // is a solution. It is split once at the antipode — the only place the record's centre
    // is read — and everything below that is centre-free. Without this a full-turn piece
    // collapses to its start point and the circle disappears; the SVG renderer defends
    // against the same case in `planArc` (arcShape.js:936). With no finite centre there is
    // no split, so the record is refused — and drawn as its chord, like the two branches
    // above: its ends can be distinct, and then an open outline leaks 34,944 units of ink
    // out to the plate's edge on the fast path and loses the whole item on the union path
    // (D54, D71).
    if (Math.abs(sweep) >= WHOLE_TURN) {
        if (!(isFinite(cx) && isFinite(cy))) {
            coreStats.nonFinite++;
            return chordOf(ax, ay, bx, by, ox, oy, mode, yb0, yb1);
        }
        const mx = cx + (cx - ax), my = cy + (cy - ay), h = sweep / 2;
        const a = emitArc(ax, ay, mx, my, h, cx, cy, ox, oy, mode, yb0, yb1);
        if (a < 0) return -1;
        const b = emitArc(mx, my, bx, by, h, cx, cy, ox, oy, mode, yb0, yb1);
        return b < 0 ? -1 : a + b;
    }
    const D = arcDepth(ax, ay, bx, by, sweep), f = arcForced(sweep);
    const forced = f < D ? f : D;                                // D = 0 means one chord, so nothing is forced
    // 2^D is what §4.4's estimate predicted; `edges` is what survived the prune. A family
    // walked in row bands (§3.5) walks its arcs once per band and counts them once per band.
    arcChords += 1 << D;
    let s = sweep;
    for (let d = 0; d <= D; d++) { KTAB[d] = bulgeK(s); s *= 0.5; }

    const px1 = ox + TW, py0 = oy + CY0, py1 = oy + CY1;     // the clip's rows: nothing outside them is read
    let edges = 0, sp = 6;
    STACK[0] = ax; STACK[1] = ay; STACK[2] = bx; STACK[3] = by; STACK[4] = sweep; STACK[5] = 0;
    while (sp > 0) {
        sp -= 6;
        const nax = STACK[sp], nay = STACK[sp + 1], nbx = STACK[sp + 2], nby = STACK[sp + 3];
        const nsw = STACK[sp + 4], d = STACK[sp + 5], k = KTAB[d];
        if (d >= forced) {
            // The chord's box grown by the sagitta along the chord's normal. The rotated
            // chord vector carries the chord's length, so the growth is |dy·k| in x and
            // |dx·k| in y — the sagitta resolved onto the axes, with no hypot and no radius.
            const gx = Math.abs((nby - nay) * k), gy = Math.abs((nbx - nax) * k);
            const ylo = (nay < nby ? nay : nby) - gy, yhi = (nay < nby ? nby : nay) + gy;
            if (yhi < py0 || ylo > py1) continue;                // no row of this plate
            const xlo = (nax < nbx ? nax : nbx) - gx, xhi = (nax < nbx ? nbx : nax) + gx;
            if (xlo > px1) {
                // Right of the plate. The fast path's deposits there land past every column
                // the resolve reads, so dropping is exact; a union crossing right of TW is
                // what CLOSES a run, so there the subtree leaves its own net height at TW.
                if (mode === ARC_EDGE) continue;
                if (!pushUnionEdge(TW, nay - oy, TW, nby - oy, yb0, yb1)) return -1;
                continue;
            }
            if (xhi < ox) {
                // Left of the plate: exactly its own dy at column 0, for either path — the
                // net crossing of any row is the separation of the subtree's own ends.
                if (mode === ARC_EDGE) edges += addEdge(0, nay - oy, 0, nby - oy);
                else if (!pushUnionEdge(0, nay - oy, 0, nby - oy, yb0, yb1)) return -1;
                continue;
            }
            if (d === D) {
                if (mode === ARC_EDGE) edges += addEdge(nax - ox, nay - oy, nbx - ox, nby - oy);
                else if (!pushUnionEdge(nax - ox, nay - oy, nbx - ox, nby - oy, yb0, yb1)) return -1;
                continue;
            }
        }
        chordMidK(nax, nay, nbx, nby, k, MID);                   // one tan per depth, shared by every pair
        const mx = MID[0], my = MID[1], hs = nsw * 0.5, nd = d + 1;
        STACK[sp] = mx; STACK[sp + 1] = my; STACK[sp + 2] = nbx; STACK[sp + 3] = nby;
        STACK[sp + 4] = hs; STACK[sp + 5] = nd;
        STACK[sp + 6] = nax; STACK[sp + 7] = nay; STACK[sp + 8] = mx; STACK[sp + 9] = my;
        STACK[sp + 10] = hs; STACK[sp + 11] = nd;
        sp += 12;                                                // the near half pops first: path order
    }
    return edges;
}

/**
 * Every edge of one item, transformed to plate-local device pixels and deposited.
 * §4.6 exactly: px = (x + resX)·Zq − i·PLATE_PX. The residual is added BEFORE the scale and
 * the plate origin subtracted after, because `i·PLATE_PX` is an exact integer and the
 * subtraction is therefore exact — which is what makes two neighbouring plates describe a
 * shared point to the last bit. Adding the residual after the scale rounds twice and the two
 * plates then disagree by ~1e-8 px at every seam.
 *
 * An arc piece keeps the scale-only coordinates and hands them to the flattener, which
 * subtracts the plate origin at each chord it emits: the bisection is then the same
 * arithmetic at every plate (§4.4), not merely the same depth.
 * Returns the number of edges deposited.
 */
function emitItem(job, it, rx, ry, ox, oy, Zq) {
    const meta = job.meta, geom = job.geom, subs = job.subs;
    const kind = meta[it * 8], gs = meta[it * 8 + 2], gl = meta[it * 8 + 3];
    const ss = meta[it * 8 + 4], sc = meta[it * 8 + 5];
    let edges = 0;
    if (kind === 0) {
        for (let k = 0; k < sc; k++) {
            const lo = gs + subs[ss + k];
            const hi = k + 1 < sc ? gs + subs[ss + k + 1] : gs + gl;
            if (hi - lo < 5) continue;
            let ax = (geom[lo] + rx) * Zq, ay = (geom[lo + 1] + ry) * Zq;
            const fx = ax, fy = ay;
            for (let o = lo + 2; o < hi; o += widthOf(geom[o])) {
                const code = geom[o];
                let bx, by, sweep = 0;
                if (code === 0) { bx = geom[o + 1]; by = geom[o + 2]; }
                else if (code === 2) { bx = geom[o + 7]; by = geom[o + 8]; }
                else if (code === 1) { bx = geom[o + 6]; by = geom[o + 7]; sweep = geom[o + 5]; }
                else { bx = geom[o + 14]; by = geom[o + 15]; sweep = geom[o + 5]; }
                bx = (bx + rx) * Zq; by = (by + ry) * Zq;
                if (sweep !== 0) {
                    edges += emitArc(ax, ay, bx, by, sweep, (geom[o + 1] + rx) * Zq, (geom[o + 2] + ry) * Zq,
                        ox, oy, ARC_EDGE, 0, TH);
                } else {
                    edges += addEdge(ax - ox, ay - oy, bx - ox, by - oy);
                }
                ax = bx; ay = by;
            }
            edges += addEdge(ax - ox, ay - oy, fx - ox, fy - oy);
        }
    } else {
        for (let k = 0; k < sc; k++) {
            const lo = gs + 2 * subs[ss + k];
            const hi = k + 1 < sc ? gs + 2 * subs[ss + k + 1] : gs + gl;
            if (hi - lo < 4) continue;
            const fx = (geom[lo] + rx) * Zq - ox, fy = (geom[lo + 1] + ry) * Zq - oy;
            let ax = fx, ay = fy;
            for (let o = lo + 2; o < hi; o += 2) {
                const bx = (geom[o] + rx) * Zq - ox, by = (geom[o + 1] + ry) * Zq - oy;
                edges += addEdge(ax, ay, bx, by);
                ax = bx; ay = by;
            }
            edges += addEdge(ax, ay, fx, fy);
        }
    }
    return edges;
}

/**
 * The signed area of one item's rings, ×2, in plate-local pixels; its sign is the winding's,
 * and that sign is all the union pass takes from it. An arc contributes its chord's term plus
 * its circular segment (`chordMath.arcAreaTerm`), so the area is exact without flattening —
 * a lens of two arcs has the sign of its arcs, not of its degenerate chord polygon. The one
 * arc that needs its centre here is the whole turn, below (D60).
 */
function itemShoelace(job, it, rx, ry, ox, oy, Zq) {
    const meta = job.meta, geom = job.geom, subs = job.subs;
    const kind = meta[it * 8], gs = meta[it * 8 + 2], gl = meta[it * 8 + 3];
    const ss = meta[it * 8 + 4], sc = meta[it * 8 + 5];
    let sum = 0;
    for (let k = 0; k < sc; k++) {
        const lo = kind === 0 ? gs + subs[ss + k] : gs + 2 * subs[ss + k];
        const hi = k + 1 < sc ? (kind === 0 ? gs + subs[ss + k + 1] : gs + 2 * subs[ss + k + 1]) : gs + gl;
        if (hi - lo < 4) continue;
        const fx = (geom[lo] + rx) * Zq - ox, fy = (geom[lo + 1] + ry) * Zq - oy;
        let ax = fx, ay = fy;
        if (kind === 0) {
            for (let o = lo + 2; o < hi; o += widthOf(geom[o])) {
                const code = geom[o];
                let bx, by, sweep = 0;
                if (code === 0) { bx = geom[o + 1]; by = geom[o + 2]; }
                else if (code === 2) { bx = geom[o + 7]; by = geom[o + 8]; }
                else if (code === 1) { bx = geom[o + 6]; by = geom[o + 7]; sweep = geom[o + 5]; }
                else { bx = geom[o + 14]; by = geom[o + 15]; sweep = geom[o + 5]; }
                bx = (bx + rx) * Zq - ox; by = (by + ry) * Zq - oy;
                sum += ax * by - bx * ay;
                // A record `emitArc` refuses gets its chord's term and no arc term — a
                // non-finite sweep (D65) and one past a whole turn (D67) alike — which is
                // exactly what `emitArc` then deposits for it (D71). Both pass
                // `|sweep| ≥ WHOLE_TURN`, so the branch below would otherwise credit a record
                // the core draws as nothing with 2π r² about its centre and invert the item's
                // sign: measured, a hole came out a filled disc.
                const arc = sweep !== 0 && isFinite(sweep) && Math.abs(sweep) <= MAX_SWEEP;
                if (arc && Math.abs(sweep) >= WHOLE_TURN) {
                    // A whole turn's ends coincide, so its chord term and `arcAreaTerm` are both
                    // zero and the ring would carry no sign at all — the deposit would come out
                    // +1 whichever way the ring is wound, and a reversed one paints the inverse
                    // picture. Its area is the circle's, read from the record's centre, which is
                    // where `emitArc`'s antipode split reads it too (D54, D60). With no finite
                    // centre `rr` is NaN and nothing is added, so such a record keeps its chord's
                    // term alone — which is what `emitArc` then deposits for it (D71).
                    const ccx = (geom[o + 1] + rx) * Zq - ox, ccy = (geom[o + 2] + ry) * Zq - oy;
                    const rr = Math.hypot(ax - ccx, ay - ccy);
                    if (rr > 0 && isFinite(rr)) sum += (sweep > 0 ? TAU : -TAU) * rr * rr;
                } else if (arc) {
                    sum += arcAreaTerm(ax, ay, bx, by, sweep);
                }
                ax = bx; ay = by;
            }
        } else {
            for (let o = lo + 2; o < hi; o += 2) {
                const bx = (geom[o] + rx) * Zq - ox, by = (geom[o + 1] + ry) * Zq - oy;
                sum += ax * by - bx * ay; ax = bx; ay = by;
            }
        }
        sum += ax * fy - fx * ay;
    }
    return sum;
}

/** One item's ring/loop segments loaded into the union edge buffer; false when it overflowed. */
function loadUnionItem(job, it, rx, ry, ox, oy, Zq, yb0, yb1) {
    const meta = job.meta, geom = job.geom, subs = job.subs;
    const kind = meta[it * 8], gs = meta[it * 8 + 2], gl = meta[it * 8 + 3];
    const ss = meta[it * 8 + 4], sc = meta[it * 8 + 5];
    for (let k = 0; k < sc; k++) {
        const lo = kind === 0 ? gs + subs[ss + k] : gs + 2 * subs[ss + k];
        const hi = k + 1 < sc ? (kind === 0 ? gs + subs[ss + k + 1] : gs + 2 * subs[ss + k + 1]) : gs + gl;
        if (hi - lo < 4) continue;
        if (kind === 0) {
            // scale-only coordinates, as emitItem keeps them: the flattener subtracts the
            // plate origin per chord, so every plate loads the same edges
            let ax = (geom[lo] + rx) * Zq, ay = (geom[lo + 1] + ry) * Zq;
            const gfx = ax, gfy = ay;
            for (let o = lo + 2; o < hi; o += widthOf(geom[o])) {
                const code = geom[o];
                let bx, by, sweep = 0;
                if (code === 0) { bx = geom[o + 1]; by = geom[o + 2]; }
                else if (code === 2) { bx = geom[o + 7]; by = geom[o + 8]; }
                else if (code === 1) { bx = geom[o + 6]; by = geom[o + 7]; sweep = geom[o + 5]; }
                else { bx = geom[o + 14]; by = geom[o + 15]; sweep = geom[o + 5]; }
                bx = (bx + rx) * Zq; by = (by + ry) * Zq;
                if (sweep !== 0) {
                    if (emitArc(ax, ay, bx, by, sweep, (geom[o + 1] + rx) * Zq, (geom[o + 2] + ry) * Zq,
                        ox, oy, ARC_UNION, yb0, yb1) < 0) return false;
                } else if (!pushUnionEdge(ax - ox, ay - oy, bx - ox, by - oy, yb0, yb1)) {
                    return false;
                }
                ax = bx; ay = by;
            }
            if (!pushUnionEdge(ax - ox, ay - oy, gfx - ox, gfy - oy, yb0, yb1)) return false;
            continue;
        }
        const fx = (geom[lo] + rx) * Zq - ox, fy = (geom[lo + 1] + ry) * Zq - oy;
        let ax = fx, ay = fy;
        for (let o = lo + 2; o < hi; o += 2) {
            const bx = (geom[o] + rx) * Zq - ox, by = (geom[o + 1] + ry) * Zq - oy;
            if (!pushUnionEdge(ax, ay, bx, by, yb0, yb1)) return false;
            ax = bx; ay = by;
        }
        if (!pushUnionEdge(ax, ay, fx, fy, yb0, yb1)) return false;
    }
    return true;
}

/** Every union item of the family, clipped to rows [yb0, yb1), into the edge buffer; false = full. */
function loadUnionBand(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1) {
    uCount = 0; uSeen = 0;
    for (let it = first; it <= last; it++) {
        if (!DRAWN[it] || (meta[it * 8 + 6] & 4) === 0) continue;
        if (!loadUnionItem(job, it, attr[it * 9 + 4], attr[it * 9 + 5], ox, oy, Zq, yb0, yb1)) return false;
    }
    return true;
}

// The three guards that count RECORDS — a family's geometry is re-read once per row band, once
// per halving attempt and UNION_K times per buffer-full of a chunked row, and every read refuses
// the same records again, so one over-turn record read 16 in a row needing a second buffer-full.
// They are taken from the first COMPLETE load (the first that fits, which enumerates every
// record) and restored by `unionPass`; counts[5] has the same rule (D61, D72).
let gOver = 0, gNonFinite = 0, gClamped = 0, gHave = false;

/** One band load, keeping the first complete load's guard deltas. */
function loadBandCounted(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1) {
    const o0 = coreStats.arcOverTurn, f0 = coreStats.nonFinite, c0 = coreStats.arcClamped;
    const fits = loadUnionBand(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1);
    if (fits && !gHave) {
        gOver = coreStats.arcOverTurn - o0;
        gNonFinite = coreStats.nonFinite - f0;
        gClamped = coreStats.arcClamped - c0;
        gHave = true;
    }
    return fits;
}

/**
 * One pixel row whose union edges do not fit the buffer even alone — there is nothing left to
 * band, so the row is walked once per sub-scanline and each sub-scanline's crossings are
 * gathered over as many buffer-fulls as the row holds. The winding walked is the whole row's,
 * so no ink is lost (F75); the price is the row's geometry read UNION_K times per extra
 * buffer-full — 41–43 ns an edge a pass, +1.2 % of F75's own fixture (§8.6 measurement 15).
 *
 * Depositing one buffer-full's union and then the next would be cheaper and wrong: where two
 * buffer-fulls overlap their coverage would be added twice (§4.2's row 3).
 */
function walkRowChunked(job, meta, attr, first, last, ox, oy, Zq, y) {
    const step = 1 / UNION_K, half = step / 2, w = step * uSign;
    // The row's arcs are re-flattened on every pass below, so `arcChords` is taken from the ONE
    // pass that walked all of the geometry — the last of the first sub-scanline's, the pass that
    // did not fill the buffer. Left as it accumulates, counts[5] would read 16× the refills too
    // high and §8.3's chords-against-edges reading would be meaningless here (D61).
    const chords0 = arcChords;
    let rowChords = 0, refills = 0;
    for (let k = 0; k < UNION_K; k++) {
        const ys = y + half + k * step;
        let n = 0, skip = 0, fits = false;
        while (!fits) {
            const c0 = arcChords;
            uSkip = skip;
            fits = loadBandCounted(job, meta, attr, first, last, ox, oy, Zq, y, y + 1);
            if (fits && k === 0) rowChords = arcChords - c0;
            for (let e = 0; e < uCount; e++) UACT[e] = e;
            n = gatherCrossings(ys, n, uCount);
            skip += uCount;                           // a full buffer holds MAX_UEDGE, so this advances
            if (!fits && k === 0) refills++;
        }
        emitRuns(y, n, w);
    }
    uSkip = 0;
    arcChords = chords0 + rowChords;
    coreStats.unionRefills += refills;
}

/** The union items of one family over rows [y0, y1), in as few row bands as their edges need. */
function unionPass(job, first, last, ox, oy, Zq, y0, y1) {
    const meta = job.meta, attr = job.attr;
    uSkip = 0;
    const over0 = coreStats.arcOverTurn, nonFin0 = coreStats.nonFinite, clamp0 = coreStats.arcClamped;
    gOver = 0; gNonFinite = 0; gClamped = 0; gHave = false;
    let yb0 = y0;
    while (yb0 < y1) {
        let yb1 = y1;
        let fits = loadBandCounted(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1);
        while (!fits && yb1 - yb0 > 1) {
            yb1 = yb0 + ((yb1 - yb0) >> 1);
            coreStats.unionSplits++;
            fits = loadBandCounted(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1);
        }
        if (fits) walkUnion(yb0, yb1);
        else walkRowChunked(job, meta, attr, first, last, ox, oy, Zq, yb0);
        yb0 = yb1;
    }
    // One complete load saw every record this family has, so the guards read records and not
    // passes; `unionSplits` and `unionRefills` are the passes, and they are costs (D72).
    coreStats.arcOverTurn = over0 + gOver;
    coreStats.nonFinite = nonFin0 + gNonFinite;
    coreStats.arcClamped = clamp0 + gClamped;
}

/**
 * One plate of a job: paper, then every family in paint order (§4.3). `out` is the caller's
 * RGBA scratch, PLATE_PX² × 4 bytes; `counts` is §8.3's 8 words and `timings` §8.2's 7
 * doubles — pass `timings` to turn the phase clocks on, which costs four clock reads a family.
 *
 * `clip` = [x0, y0, x1, y1], plate-local integer px, half-open: only those pixels are written, each
 * the byte the whole plate holds there (A3 §3.1, PLAN §3's partial re-render row). Omitted, the whole
 * plate, byte for byte as before the clip existed.
 *
 * The job is §3.3's format: meta 8 words an item, attr 9 doubles, geom the numbers, subs the
 * start of each loop's numbers (kind 0) or each ring's first point (kind 1) within the item's
 * geom span — the next entry, or the item's end, is where it stops.
 *
 * @param {object} job
 * @param {number} plateIndex which pair of job.plates to draw
 * @param {Uint8ClampedArray} out
 * @param {Uint32Array} [counts]
 * @param {Float64Array} [timings]
 * @param {ArrayLike<number>} [clip]
 */
export function renderPlate(job, plateIndex, out, counts, timings, clip) {
    if (clip) setClip(clip);
    try { return paintPlate(job, plateIndex, out, counts, timings); }
    finally { CX0 = 0; CY0 = 0; CX1 = TW; CY1 = TH; }
}

/** Take a clip box; one that is not integral or not inside the plate would write other rows, so it throws. */
function setClip(c) {
    const x0 = c[0], y0 = c[1], x1 = c[2], y1 = c[3];
    if (!(Number.isInteger(x0) && Number.isInteger(y0) && Number.isInteger(x1) && Number.isInteger(y1)
        && x0 >= 0 && y0 >= 0 && x0 < x1 && y0 < y1 && x1 <= TW && y1 <= TH)) {
        throw new Error("rasterCore: the clip " + Array.from(c).join(",") + " is not an integral box inside the plate");
    }
    CX0 = x0; CY0 = y0; CX1 = x1; CY1 = y1;
}

function paintPlate(job, plateIndex, out, counts, timings) {
    const clock = timings ? (typeof performance !== "undefined" ? performance : Date) : null;
    const meta = job.meta, attr = job.attr, rgb = job.rgb;
    const n = job.nItems | 0, Zq = job.Zq;
    const ox = job.plates[plateIndex * 2] * TW, oy = job.plates[plateIndex * 2 + 1] * TH;
    ALPHA_OUT = job.paper.length > 3 && job.paper[3] === 0;
    const clipped = CX0 !== 0 || CY0 !== 0 || CX1 !== TW || CY1 !== TH;
    const rect = clipped ? [CX0, CY0, CX1, CY1] : null;
    fillPaper(out, job.paper[0], job.paper[1], job.paper[2], ALPHA_OUT ? 0 : 255, rect);
    if (DRAWN.length < n) DRAWN = new Uint8Array(n + 256);

    if (!CORE_KEYS) { CORE_KEYS = Object.keys(coreStats); CORE_SNAP = new Float64Array(CORE_KEYS.length); }
    let nFam = 0, nUnion = 0, nDrawn = 0, nEdges = 0, nRows = 0, nCovered = 0;
    let tClip = 0, tEdges = 0, tUnion = 0, tAccum = 0;
    arcChords = 0;

    // The prune (the bucket is called eng.clip, D19): an item whose pixel box misses the plate
    // deposits nothing that the resolve can read, so dropping it is exact, not an approximation.
    let t0 = clock ? clock.now() : 0;
    let hasMask = false;
    for (let it = 0; it < n; it++) {
        const a = it * 9;
        const x0 = attr[a] * Zq - ox, x1 = attr[a + 2] * Zq - ox;
        const y0 = attr[a + 1] * Zq - oy, y1 = attr[a + 3] * Zq - oy;
        DRAWN[it] = (x1 >= 0 && x0 <= TW && y1 >= 0 && y0 <= TH) ? 1 : 0;
        nDrawn += DRAWN[it];
        if (DRAWN[it] && (meta[it * 8 + 6] & FLAG_MASK)) hasMask = true;
    }
    if (clock) tClip = clock.now() - t0;
    maskLive = 0;

    // The families, as [start, last] item ranges in paint order.
    let nF = 0;
    for (let it = 0; it < n;) {
        const fam = meta[it * 8 + 1];
        let last = it;
        while (last + 1 < n && meta[(last + 1) * 8 + 1] === fam) last++;
        if (last + 1 < n && meta[(last + 1) * 8 + 1] < fam) {
            throw new Error("rasterCore: family indices must ascend in paint order (§3.3)");
        }
        if (FAMS.length < 2 * (nF + 1)) { const g = new Int32Array(FAMS.length * 2 + 512); g.set(FAMS); FAMS = g; }
        FAMS[2 * nF] = it; FAMS[2 * nF + 1] = last; nF++;
        it = last + 1;
    }

    // Pass 0 resolves the pending marks into their masks; pass 1 paints the rest, masked, from the
    // topmost family that covers the whole clip opaquely: everything under it is hidden (Kobin,
    // 2026-09-23; 41 whole-plate backdrops a plate under the Magnum Opus's nucleus).
    for (let pass = hasMask ? 0 : 1; pass < 2; pass++) {
        let from = 0, covered = -1;
        if (pass === 1 && OCCLUSION) {
            t0 = clock ? clock.now() : 0;
            for (let f = nF - 1; f >= 0; f--) {
                const it = FAMS[2 * f], last = FAMS[2 * f + 1];
                if (!coverCandidate(job, it, last, ox, oy, Zq)) continue;
                // A candidate that falls short is deposited again when it is painted: its counts are taken back.
                const chords = arcChords;
                for (let k = 0; k < CORE_KEYS.length; k++) CORE_SNAP[k] = coreStats[CORE_KEYS[k]];
                const edges = depositFamily(job, it, last, ox, oy, Zq, CY0, CY1);
                if (fillsPlate()) { nEdges += edges; from = f; covered = f; occStats.occluded += f; break; }
                arcChords = chords;
                for (let k = 0; k < CORE_KEYS.length; k++) coreStats[CORE_KEYS[k]] = CORE_SNAP[k];
                occStats.coverMisses++;
                clearFamily(CY0, CY1);
            }
            if (clock) tEdges += clock.now() - t0;
        }
        for (let f = from; f < nF; f++) {
            const it = FAMS[2 * f], last = FAMS[2 * f + 1];
            const isMask = (meta[it * 8 + 6] & FLAG_MASK) !== 0;
            if (isMask !== (pass === 0)) continue;
            // the family's pixel box: the union of its drawn items' boxes, rounded outward
            let by0 = Infinity, by1 = -Infinity, bx0 = Infinity, bx1 = -Infinity, first = -1;
            for (let k = it; k <= last; k++) {
                if (!DRAWN[k]) continue;
                const a = k * 9;
                const t = attr[a + 1] * Zq - oy, b = attr[a + 3] * Zq - oy;
                if (t < by0) by0 = t;
                if (b > by1) by1 = b;
                if (clipped) {
                    const l = attr[a] * Zq - ox, r = attr[a + 2] * Zq - ox;
                    if (l < bx0) bx0 = l;
                    if (r > bx1) bx1 = r;
                }
                if (first < 0) first = k;
                if (meta[k * 8 + 6] & 4) nUnion++;
            }
            if (first < 0) continue;
            // A family whose box misses the clip grown by 2 px (a deposit spills a column right) writes no
            // pixel of it and is skipped whole. Its items are never pruned one by one: their sums still run.
            if (clipped && f !== covered && (bx1 < CX0 - 2 || bx0 > CX1 + 2 || by1 < CY0 - 2 || by0 > CY1 + 2)) continue;
            // Rounded outward with a hair of slack: the box and the edges are mapped by two
            // expressions that can differ by an ulp, and a row outside the box is a row the
            // clear never visits and the next family inherits.
            let y0 = Math.max(CY0, Math.floor(by0 - BOX_SLACK)), y1 = Math.min(CY1, Math.ceil(by1 + BOX_SLACK));
            if (f === covered) { y0 = CY0; y1 = CY1; }           // its accumulation is already in ACC
            if (y1 <= y0) continue;
            nFam++;
            t0 = clock ? clock.now() : 0;
            if (f !== covered) nEdges += depositFamily(job, it, last, ox, oy, Zq, y0, y1);
            if (clock) { const t = clock.now(); tEdges += t - t0; t0 = t; }
            const c = first * 3;
            nRows += rowsTouched(y0, y1);
            if (isMask) resolveMask(meta[first * 8 + 7], y0, y1);
            else {
                let bits = 0;
                if (maskLive) for (let k = it; k <= last; k++) bits |= meta[k * 8 + 7];
                nCovered += resolveFamily(out, rgb[c], rgb[c + 1], rgb[c + 2], attr[first * 9 + 7], y0, y1, bits & maskLive);
            }
            clearFamily(y0, y1);
            if (clock) tAccum += clock.now() - t0;
        }
    }

    if (ALPHA_OUT) { unpremultiply(out, rect); ALPHA_OUT = false; }
    if (counts) {
        counts[0] = n; counts[1] = nDrawn; counts[2] = nFam; counts[3] = nUnion;
        counts[4] = nEdges; counts[5] = arcChords; counts[6] = nRows; counts[7] = nCovered;
    }
    if (timings) { timings[2] = tClip; timings[3] = 0; timings[4] = tEdges; timings[5] = tUnion; timings[6] = tAccum; }
    return counts;
}
