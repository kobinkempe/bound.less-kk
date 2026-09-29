/**
 * antPaint.js — the selection indicator's painter. One crawl phase of one decision, into a
 * screen-space RGBA plane. A dash is a ROTATED RECTANGLE of fixed half-width; its coverage is
 * the separable `clamp(0.5 + (h − |d⊥|)) · clamp(0.5 ± d∥)` a shader would use, composited
 * with `max`. Pure: no DOM, no canvas, no camera, no engine, no `rasterCore`.
 *
 * Why not through `rasterCore`: one crawl phase of F39's own report camera (4,756 runs,
 * 9,512 dashes) costs 107–190 ms of raster plus 45–149 ms of packing through the general core
 * — 2–4× what Chrome's dasher costs today — against 14.2–33.9 ms here (RASTERISER-PLAN §0,
 * §8.6 row 16). The general core is the wrong tool for a ribbon of fixed width.
 *
 * Four rules, each a defect if it is dropped:
 *  1. THE COMPOSITE IS `max`, NOT A SUM. Two ant runs that cross paint solid — never a dark
 *     spot, never a winding. Its error is confined to a pixel two partial covers reach in
 *     different parts (N7).
 *  2. THE BAND AND THE DASH ARE CSS PIXELS, THE PLANE IS DEVICE PIXELS, THE GEOMETRY IS
 *     RETAINED UNITS. Two conversions, each in one place: `view.k` takes geometry to device px,
 *     where the dash intervals become points, and `css.dpr` takes the band and the cycle with
 *     it. Conflating them is how the design's first draft got the speck wrong.
 *  3. `kt` SCALES THE RUNS AND NEVER THE MARKS (`svgOverlay.renderSelAnts`, the runs against the
 *     marks) — a speck is already the floor `kt` falls to, so scaling it twice
 *     shrinks it below its own band.
 *  4. THE PHASE IS A FRACTION OF EACH RUN'S OWN FITTED CYCLE. `svgOverlay`'s `fitDash` writes
 *     `--ao = −(cycle·k)·2` and the keyframe animates from 0 to `--ao`, so the pattern travels
 *     TWO cycles in 0.8 s: a step is `cycle/8`, there are EIGHT distinct phases, and a global
 *     offset would make long-cycle runs crawl faster than short ones (N14).
 *
 * Four facts about the geometry a reader needs:
 *  - NOTHING PERSISTS. An arc is stepped in chords whose sagitta is 1/16 device px — §4.4's own
 *    tolerance, the same bar the ink is painted to — and the chords live for one stamp. The
 *    decision (`overlays.js`, `geometry/antRuns.js`) flattens nothing, and this does not change
 *    that.
 *  - THE CHORD RULE IS TAKEN AT THE BAND'S OUTER EDGE, `chordStep(R²/(R + h))`: the notch
 *    between two chords is `(R + h)(1 − cos(dth/2))` and not the centreline's own sagitta
 *    (`appendPiece`).
 *  - A DASH IS ONE POLYLINE, ACROSS PIECES, AND ITS JOINS ARE MITERED (`stampPolyline`) — the
 *    seam where a closed run's first and last stretches meet included (`seamJoinExt`). A SPECK
 *    IS A DISC (`stampDisc`). All three are defects if they are dropped, and each is measured
 *    where it is written.
 *  - THE ARC WALK USES THE PIECE'S OWN CENTRE, where the ink's flattener is centre-free. The
 *    ink's reason is float32 and far frames; this is float64 over render-list coordinates the
 *    packer's guard bounds at 2.6e5 frame units (§10 D1b), where `C + r·cosθ` cancels to
 *    5.7e-11 frame units — under 1e-6 device px at any camera, against a 1/16 px bar.
 *
 * There is NO CAP of any kind (F38: the 24,000 px budget is gone and must not come back in a
 * new spelling). What bounds the work is the decision's cut to the retained window, and a
 * piece whose device box misses the plane is not stamped (N10).
 *
 * The look constants below are transcribed from `svgOverlay.js` rather than imported:
 * that module is the DOM renderer, and this one is a leaf that a worker can take (N13 — it
 * imports `geometry/antRuns.js` and nothing else). If a constant changes there it must change
 * here; `raster.ants.test.js` transcribes them a third time so the comparison is never with
 * itself.
 */

import { pieceLength } from "../geometry/antRuns";

/** `.8s steps(16,end)` travels TWO cycles, so eight phases are distinct (design §A3). */
export const ANT_PHASES = 8;
/** 0.8 s / 16 — the crawl's step, unchanged from the CSS animation it replaces. */
export const ANT_STEP_MS = 50;

/** The chord that keeps an arc inside 1/16 device px: sagitta = c²/8R with c = sqrt(R/2). */
export const chordStep = (rPx) => Math.sqrt(rPx / 2);

/** `SEL_INK` — `oklch(0.6 0.17 35)` in 8-bit sRGB, computed (209.5, 80.3, 48.5) and rounded. */
export const SEL_INK_RGB = [210, 80, 48];

// The indicator's look, in CSS pixels, from `svgOverlay.js`. A run's band and pattern are
// scaled by `kt`; a mark's are not (rule 3).
const SEL_ANT_W = 2.5, SEL_ANT_ON = 7, SEL_ANT_OFF = 5.6;
const SEL_FINE_W = 1.75, SEL_FINE_ON = 3.5, SEL_FINE_OFF = 2.8;
const SEL_THIN_REF = 10, SEL_THIN_MIN = SEL_FINE_W / SEL_ANT_W;   // 1.75 / 2.5 = 0.7

/** The same numbers as one object, for the layer that draws the screen-edge runs (stage 5d). */
export const ANT_LOOK = {
    W: SEL_ANT_W, ON: SEL_ANT_ON, OFF: SEL_ANT_OFF,
    FINE_W: SEL_FINE_W, FINE_ON: SEL_FINE_ON, FINE_OFF: SEL_FINE_OFF,
};

/** The thin-mark shrink, `svgOverlay.selAntScale`. A mark never takes it. */
export const selAntScale = (inkPx) => (inkPx == null || !isFinite(inkPx) ? 1
    : Math.max(SEL_THIN_MIN, Math.min(1, inkPx / SEL_THIN_REF)));

/**
 * What the painter refused and what it wrote. `allocs` is every typed array this module
 * allocates after its first use: a phase must add none (N8, §2.7 FC5).
 */
export const antStats = {
    dashes: 0,       // lit intervals placed, runs and marks together
    stamps: 0,       // rotated rectangles composited; a dash is one stamp per chord
    pixels: 0,       // pixels whose alpha this phase raised
    nonFinite: 0,    // pieces refused for a non-finite coordinate, radius or sweep
    offPlane: 0,     // pieces whose device box misses the plane; the retained window is wider
    refused: 0,      // runs refused whole: no `pieces` array, or a view that is not finite
    allocs: 0,
};

const ARC_TOL = 1 / 16;        // device px; §4.4's own tolerance, applied to the ants
const MIN_ARC_R = 1 / 16;      // a circle smaller than this is one chord (§10 5c risk ii)
const JOIN_PX = 0.5;           // device px of overlap at an internal chord join, so the two
                               // axial ramps reach 1 there instead of meeting at 0.5

// Scratch, allocated once and grown with a count. Reused by every call; a phase allocates none.
let IV = new Float64Array(2048);        // dash intervals, start/end pairs
let LENS = new Float64Array(256);       // one piece length each, in device px
let FLAG = new Uint8Array(256);         // 0 paint, 1 refused (counted), 2 off the plane
let PTS = new Float64Array(512);        // one stamped polyline, device px
let SAMP = new Float64Array(512);       // one cubic's samples, device px
let CUM = new Float64Array(256);        // those samples' cumulative length
let EXT = new Float64Array(256);        // one stamped polyline's per-vertex join extension

function needIV(pairs) {
    if (IV.length >= pairs * 2) return;
    let n = IV.length; while (n < pairs * 2) n *= 2;
    IV = new Float64Array(n); antStats.allocs++;
}
function needPieces(n) {
    if (LENS.length >= n) return;
    let m = LENS.length; while (m < n) m *= 2;
    LENS = new Float64Array(m); FLAG = new Uint8Array(m); antStats.allocs += 2;
}
function needPts(n) {
    if (PTS.length >= n * 2) return;
    let m = PTS.length; while (m < n * 2) m *= 2;
    const next = new Float64Array(m); next.set(PTS); PTS = next; antStats.allocs++;
}
function needExt(n) {
    if (EXT.length >= n) return;
    let m = EXT.length; while (m < n) m *= 2;
    EXT = new Float64Array(m); antStats.allocs++;
}
function needSamp(n) {
    if (CUM.length >= n) return;
    let m = CUM.length; while (m < n) m *= 2;
    SAMP = new Float64Array(m * 2); CUM = new Float64Array(m); antStats.allocs += 2;
}

/**
 * The screen plane the painter owns: RGBA, device px, NON-premultiplied, so the blit is one
 * `putImageData`. Constructed once and reused for the layer's life (§2.7 FC1) — `resize`
 * reallocates only on a real size change, and nothing else here allocates.
 */
export class OverlayBuffer {
    constructor(w, h) {
        this._w = 0; this._h = 0; this._data = null;
        this._py0 = 0; this._py1 = 0;                       // rows the last phase painted
        this._dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };       // §2.7 FC4's `screenRect`
        this.resize(w, h);
    }
    get width() { return this._w; }
    get height() { return this._h; }
    get data() { return this._data; }
    get bytes() { return this._w * this._h * 4; }
    /**
     * What has changed since the canvas last saw the plane: the rows the last `clearTouched`
     * emptied unioned with what this phase painted. Integers, half-open, device px, origin the
     * ink canvas's top-left (§2.7 FC4). One object, mutated in place — never a fresh literal.
     */
    get dirty() { return this._dirty; }

    resize(w, h) {
        w = Math.max(0, Math.round(w)); h = Math.max(0, Math.round(h));
        if (w === this._w && h === this._h && this._data) return false;
        this._w = w; this._h = h;
        this._data = new Uint8ClampedArray(w * h * 4); antStats.allocs++;
        this._py0 = 0; this._py1 = 0;
        this._dirty.x0 = 0; this._dirty.y0 = 0; this._dirty.x1 = 0; this._dirty.y1 = 0;
        return true;
    }

    /** Clear the rows the last phase painted, and only those: 0.049 ms for a 200-row band. */
    clearTouched() {
        const y0 = this._py0, y1 = this._py1;
        if (y1 > y0) this._data.fill(0, y0 * this._w * 4, y1 * this._w * 4);
        this._py0 = 0; this._py1 = 0;
        this._dirty.x0 = 0; this._dirty.y0 = y0; this._dirty.x1 = y1 > y0 ? this._w : 0; this._dirty.y1 = y1;
    }
}

function noteRows(buf, y0, y1, x0, x1) {
    if (buf._py1 <= buf._py0) { buf._py0 = y0; buf._py1 = y1; } else {
        if (y0 < buf._py0) buf._py0 = y0;
        if (y1 > buf._py1) buf._py1 = y1;
    }
    const d = buf._dirty;
    if (d.x1 <= d.x0 || d.y1 <= d.y0) { d.x0 = x0; d.y0 = y0; d.x1 = x1; d.y1 = y1; return; }
    if (x0 < d.x0) d.x0 = x0; if (x1 > d.x1) d.x1 = x1;
    if (y0 < d.y0) d.y0 = y0; if (y1 > d.y1) d.y1 = y1;
}

/**
 * The lit intervals of ONE run at one phase, in that run's own arc length (device px), written
 * into `out` as start/end pairs and clipped to [0, len].
 *
 * `fitDash`'s arithmetic (`svgOverlay.js`): a run of at least one cycle carries
 * `n = max(1, round(len/cyc))` WHOLE cycles scaled by `k = len/(n·cyc)`, so no dash is a runt;
 * a run under one cycle is never fitted — it carries the pattern at full size and slides, which
 * is what keeps a zoomed-out selection moving. The phase offset is `phase/8` of THIS run's own
 * fitted cycle, so every run closes its cycle in the same 0.4 s (rule 4).
 *
 * @param {boolean} [fit=true] false for a MARK, whose pattern is never fitted
 *          (`svgOverlay.renderSelAnts`) — it carries the full-size cycle and slides, which is the blink.
 * @returns {number} the pairs the run NEEDS. At most `out.length / 2` are written, so a caller
 *          handed a count above that grows its array and calls again (§2.7 FC5 — the returned
 *          array of the design's sketch allocates one per run per phase and fails N8).
 */
export function dashIntervals(len, on, off, phase, out, fit = true) {
    const cyc = on + off;
    if (!(len > 0) || !isFinite(len) || !(cyc > 0) || !isFinite(cyc)) return 0;
    let ON = on, C = cyc;
    if (fit && len >= cyc) {
        const n = Math.max(1, Math.round(len / cyc));
        const k = len / (n * cyc);
        ON = on * k; C = cyc * k;
    }
    const ph = ((phase % ANT_PHASES) + ANT_PHASES) % ANT_PHASES;
    const p = (ph / ANT_PHASES) * C;
    const cap = out ? out.length >> 1 : 0;
    let m = 0;
    for (let i = Math.floor(-p / C); ; i++) {
        const s = i * C + p;
        if (s >= len) break;
        const e = s + ON;
        if (e <= 0) continue;
        const a = s > 0 ? s : 0, b = e < len ? e : len;
        // A cycle boundary that lands on the run's end is `len` short of it by a rounding
        // error, not a dash: without this the fitted run carries n + 1 intervals, the last of
        // them 1e-14 long, and both N3's count and the stamp count are one out.
        if (b > a + 1e-9 * C) {
            if (m < cap) { out[m * 2] = a; out[m * 2 + 1] = b; }
            m++;
        }
    }
    return m;
}

/**
 * One dash: a rotated rectangle of half-width `h` from (ax, ay) to (bx, by), device px,
 * MAX-composited onto alpha. Coverage is `clamp01(h + 0.5 − |d⊥|) · clamp01(0.5 + d∥) ·
 * clamp01(0.5 + L − d∥)` — exact for an axis-aligned edge (N1), an approximation of area for a
 * rotated one, worst at a 45° corner.
 * @returns {number} pixels whose alpha it raised
 */
export function stampSegment(buf, ax, ay, bx, by, h, ink) {
    const W = buf._w, H = buf._h, data = buf._data;
    if (!(W > 0) || !(H > 0)) return 0;
    if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by) || !(h > 0)) { antStats.nonFinite++; return 0; }
    const dx = bx - ax, dy = by - ay;
    const L = Math.sqrt(dx * dx + dy * dy);
    // A zero-length dash is a dot, not a refusal: the caps alone paint a disc of radius h.
    const ux = L > 0 ? dx / L : 1, uy = L > 0 ? dy / L : 0;
    const R = h + 0.5;
    let x0 = Math.floor(Math.min(ax, bx) - R), x1 = Math.ceil(Math.max(ax, bx) + R);
    let y0 = Math.floor(Math.min(ay, by) - R), y1 = Math.ceil(Math.max(ay, by) + R);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > W) x1 = W; if (y1 > H) y1 = H;
    if (x0 >= x1 || y0 >= y1) return 0;
    const r = ink[0], g = ink[1], b = ink[2];
    let px0 = W, px1 = 0, py0 = H, py1 = 0, wrote = 0;
    for (let y = y0; y < y1; y++) {
        // Per row, both constraints are linear in x, so the span where coverage can be
        // non-zero is exact: walking the whole box instead costs 2–3× the pixels on a diagonal.
        const Y = y + 0.5 - ay;
        let lo = x0, hi = x1;
        // |d⊥| < R, with d⊥ = −X·uy + Y·ux
        const k1 = Y * ux;
        if (uy > 1e-12 || uy < -1e-12) {
            const a1 = (k1 - R) / uy, b1 = (k1 + R) / uy;
            const s1 = a1 < b1 ? a1 : b1, t1 = a1 < b1 ? b1 : a1;
            const n0 = Math.ceil(s1 + ax - 0.5), n1 = Math.floor(t1 + ax - 0.5) + 1;
            if (n0 > lo) lo = n0; if (n1 < hi) hi = n1;
        } else if (k1 >= R || k1 <= -R) continue;
        // −0.5 < d∥ < L + 0.5, with d∥ = X·ux + Y·uy
        const k2 = Y * uy;
        if (ux > 1e-12 || ux < -1e-12) {
            const a2 = (-0.5 - k2) / ux, b2 = (L + 0.5 - k2) / ux;
            const s2 = a2 < b2 ? a2 : b2, t2 = a2 < b2 ? b2 : a2;
            const n0 = Math.ceil(s2 + ax - 0.5), n1 = Math.floor(t2 + ax - 0.5) + 1;
            if (n0 > lo) lo = n0; if (n1 < hi) hi = n1;
        } else if (k2 <= -0.5 || k2 >= L + 0.5) continue;
        if (lo >= hi) continue;
        let X = lo + 0.5 - ax;
        let t = X * ux + k2, d = -X * uy + k1;
        let i = (y * W + lo) << 2;
        for (let x = lo; x < hi; x++, t += ux, d -= uy, i += 4) {
            let cov = R - (d < 0 ? -d : d);
            if (cov <= 0) continue;
            if (cov > 1) cov = 1;
            let c2 = t + 0.5;
            if (c2 <= 0) continue;
            if (c2 < 1) cov *= c2;
            c2 = L - t + 0.5;
            if (c2 <= 0) continue;
            if (c2 < 1) cov *= c2;
            const a = cov >= 1 ? 255 : (cov * 255 + 0.5) | 0;
            if (a > data[i + 3]) {
                data[i + 3] = a; data[i] = r; data[i + 1] = g; data[i + 2] = b;
                wrote++;
                if (x < px0) px0 = x; if (x >= px1) px1 = x + 1;
                if (y < py0) py0 = y; if (y >= py1) py1 = y + 1;
            }
        }
    }
    antStats.stamps++;
    antStats.pixels += wrote;
    if (wrote) noteRows(buf, py0, py1, px0, px1);
    return wrote;
}

/**
 * How far past a join the segment arriving on chord (d1, L1) and the one leaving on (d2, L2)
 * are each extended, in device px: `0.5` for the axial ramps, which otherwise meet at 0.5 each
 * and leave the band half covered along the join, plus the miter's own reach `h·tan(turn/2)`,
 * which fills the wedge the two rectangles leave on the OUTSIDE of the turn (D132). The MITER
 * term is capped at half the shorter adjoining chord, so the extension is at most
 * `0.5 + min(L1, L2)/2` — uncapped, a tight turn inflated a speck by 34 % — and a reversal,
 * where the tangent form collapses, takes `4h` into that same cap.
 */
function joinExt(d1x, d1y, L1, d2x, d2y, L2, h) {
    const cross = Math.abs(d1x * d2y - d1y * d2x), dot = d1x * d2x + d1y * d2y;
    const den = L1 * L2 + dot;
    const miter = den > 1e-12 ? h * (cross / den) : 4 * h;      // h·tan(turn/2)
    const cap = 0.5 * (L1 < L2 ? L1 : L2);
    return JOIN_PX + (miter < cap ? miter : cap);
}

/**
 * A polyline of `n` device-space points in `pts`, stamped with its joins overlapped: every
 * interior join takes `joinExt`, and `e0` and `e1` are the device px the polyline's own two ends
 * take — 0 for a cap, `JOIN_PX` where the tangent carries on into a stretch this call does not
 * stamp, and `joinExt`'s own value at a closed run's seam, which is a corner like any other
 * (D132, `seamJoinExt`).
 */
function stampPolyline(buf, pts, n, h, ink, e0, e1) {
    if (n < 2) return;
    needExt(n);
    EXT[0] = e0;
    EXT[n - 1] = e1;
    for (let j = 1; j + 1 < n; j++) {
        const ax = pts[2 * j - 2], ay = pts[2 * j - 1], bx = pts[2 * j], by = pts[2 * j + 1];
        const cx = pts[2 * j + 2], cy = pts[2 * j + 3];
        const d1x = bx - ax, d1y = by - ay, d2x = cx - bx, d2y = cy - by;
        const L1 = Math.sqrt(d1x * d1x + d1y * d1y), L2 = Math.sqrt(d2x * d2x + d2y * d2y);
        EXT[j] = joinExt(d1x, d1y, L1, d2x, d2y, L2, h);
    }
    for (let j = 0; j + 1 < n; j++) {
        let ax = pts[2 * j], ay = pts[2 * j + 1], bx = pts[2 * j + 2], by = pts[2 * j + 3];
        const s = EXT[j], e = EXT[j + 1];
        if (s > 0 || e > 0) {
            const dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy);
            if (L > 1e-12) {
                const ux = dx / L, uy = dy / L;
                ax -= ux * s; ay -= uy * s;
                bx += ux * e; by += uy * e;
            }
        }
        stampSegment(buf, ax, ay, bx, by, h, ink);
    }
}

/**
 * A solid dot of radius `r`, MAX-composited: `clamp01(r + 0.5 − dist)`, the radial form of the
 * band's own ramp. THE SPECK IS A DISC, not a ring of chords — once the band's half-width
 * reaches the circle's radius the ring has closed over its own centre, and twelve
 * max-composited rectangles around a 0.375 px circle leave wedges at every join that no chord
 * count fixes (measured 12 % short across, and 34 % too fat when the extensions are widened
 * enough to fill them). One stamp, and it is what `overlays.js:50-60` describes.
 */
function stampDisc(buf, cx, cy, r, ink) {
    const W = buf._w, H = buf._h, data = buf._data;
    if (!isFinite(cx) || !isFinite(cy) || !(r > 0)) { antStats.nonFinite++; return 0; }
    const R = r + 0.5;
    let x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R), y0 = Math.floor(cy - R), y1 = Math.ceil(cy + R);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > W) x1 = W; if (y1 > H) y1 = H;
    if (x0 >= x1 || y0 >= y1) return 0;
    const ir = ink[0], ig = ink[1], ib = ink[2];
    let px0 = W, px1 = 0, py0 = H, py1 = 0, wrote = 0;
    for (let y = y0; y < y1; y++) {
        const dy = y + 0.5 - cy;
        const half = Math.sqrt(Math.max(0, R * R - dy * dy));
        let lo = Math.ceil(cx - half - 0.5), hi = Math.floor(cx + half - 0.5) + 1;
        if (lo < x0) lo = x0; if (hi > x1) hi = x1;
        let i = (y * W + lo) << 2;
        for (let x = lo; x < hi; x++, i += 4) {
            const dx = x + 0.5 - cx;
            let cov = R - Math.sqrt(dx * dx + dy * dy);
            if (cov <= 0) continue;
            if (cov > 1) cov = 1;
            const a = cov >= 1 ? 255 : (cov * 255 + 0.5) | 0;
            if (a > data[i + 3]) {
                data[i + 3] = a; data[i] = ir; data[i + 1] = ig; data[i + 2] = ib;
                wrote++;
                if (x < px0) px0 = x; if (x >= px1) px1 = x + 1;
                if (y < py0) py0 = y; if (y >= py1) py1 = y + 1;
            }
        }
    }
    antStats.stamps++;
    antStats.pixels += wrote;
    if (wrote) noteRows(buf, py0, py1, px0, px1);
    return wrote;
}

const isCubic = (p) => Array.isArray(p);
// `antRuns`' own rule, so the lengths this walks and the lengths `pieceLength` returns agree.
const isLine = (p) => !!p.line || !isFinite(p.r) || !(p.r > 0);

function finitePt(p) { return !!p && isFinite(p[0]) && isFinite(p[1]); }

/** Is every number this piece is drawn from finite? */
function pieceOk(p) {
    if (isCubic(p)) return p.length === 4 && finitePt(p[0]) && finitePt(p[1]) && finitePt(p[2]) && finitePt(p[3]);
    if (isLine(p)) return finitePt(p.A) && finitePt(p.B);
    return finitePt(p.A) && finitePt(p.B) && finitePt(p.C) && isFinite(p.a0) && isFinite(p.sweep);
}

/**
 * Is this run one circle whose band has closed over its own centre — a speck? `circleLoop`
 * (`geometry/antRuns.js:472`) builds a mark as two half-turns about one centre, and
 * `_selDecide` floors a mark's radius at a quarter of a CSS pixel against a band of 1.75, so
 * this is every mark on screen and nothing else.
 * @returns {number} the circle's device radius, or 0
 */
function speckRadius(pieces, h, k) {
    if (!pieces.length || pieces.length > 4) return 0;
    const first = pieces[0];
    if (isCubic(first) || isLine(first)) return 0;
    const R = first.r * k;
    if (!(R > 0) || R > h) return 0;
    let turn = 0;
    for (const p of pieces) {
        if (isCubic(p) || isLine(p) || p.r !== first.r) return 0;
        if (p.C[0] !== first.C[0] || p.C[1] !== first.C[1]) return 0;
        turn += p.sweep;
    }
    return Math.abs(Math.abs(turn) - 2 * Math.PI) < 1e-9 ? R : 0;
}

/** The piece's device-space box, conservative, for the plane test. */
function pieceBox(p, k, tx, ty, out) {
    let x0, y0, x1, y1;
    if (isCubic(p)) {
        x0 = Math.min(p[0][0], p[1][0], p[2][0], p[3][0]); x1 = Math.max(p[0][0], p[1][0], p[2][0], p[3][0]);
        y0 = Math.min(p[0][1], p[1][1], p[2][1], p[3][1]); y1 = Math.max(p[0][1], p[1][1], p[2][1], p[3][1]);
    } else if (isLine(p)) {
        x0 = Math.min(p.A[0], p.B[0]); x1 = Math.max(p.A[0], p.B[0]);
        y0 = Math.min(p.A[1], p.B[1]); y1 = Math.max(p.A[1], p.B[1]);
    } else if (Math.abs(p.sweep) <= Math.PI) {
        // The arc leaves its chord by at most r·(1 − cos(sweep/2)).
        const bulge = p.r * (1 - Math.cos(p.sweep / 2));
        x0 = Math.min(p.A[0], p.B[0]) - bulge; x1 = Math.max(p.A[0], p.B[0]) + bulge;
        y0 = Math.min(p.A[1], p.B[1]) - bulge; y1 = Math.max(p.A[1], p.B[1]) + bulge;
    } else {
        x0 = p.C[0] - p.r; x1 = p.C[0] + p.r; y0 = p.C[1] - p.r; y1 = p.C[1] + p.r;
    }
    out[0] = x0 * k + tx; out[1] = y0 * k + ty; out[2] = x1 * k + tx; out[3] = y1 * k + ty;
}
const BOX = [0, 0, 0, 0];

/**
 * The cubic's own point at parameter t, in device px. Transcribed from `curveOutline.cubicAt`,
 * which N13 forbids importing, with the device transform folded in.
 */
function cubicAt(p, t, k, tx, ty, out) {
    const s = 1 - t, a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
    out[0] = (a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0]) * k + tx;
    out[1] = (a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]) * k + ty;
}
const PT = [0, 0];

/** Push one device-space point onto the polyline, dropping a repeat of the last one. */
function pushPt(n, x, y) {
    if (n > 0 && Math.abs(PTS[2 * n - 2] - x) < 1e-12 && Math.abs(PTS[2 * n - 1] - y) < 1e-12) return n;
    needPts(n + 1);
    PTS[2 * n] = x; PTS[2 * n + 1] = y;
    return n + 1;
}

/**
 * Append one lit stretch [u0, u1] of one piece — device px along that piece — to the polyline
 * in `PTS`. A DASH IS ONE POLYLINE, ACROSS PIECES: a dash that spans a run's pieces is stamped
 * as one, so the piece boundary inside it gets the same miter join every chord boundary gets
 * (`stampPolyline`). Stamping piece by piece leaves the wedge at every boundary unfilled — on a
 * speck, whose two half-circle pieces meet on the x axis, it read 214 rather than 255 a pixel
 * out and the dot was 12 % short across.
 * @returns {number} the new point count
 */
function appendPiece(p, u0, u1, L, h, k, tx, ty, n) {
    if (isCubic(p)) {
        // Rare — an unresolved stroke's capsule outline. Sampled to the same 1/16 px bar, and
        // the lit stretch is cut out of the SAMPLES' own cumulative length, so the dashes do
        // not bunch where the curve is slow.
        const ns = cubicSamples(p, k, tx, ty);
        const total = CUM[ns];
        if (!(total > 0)) return pushPt(n, SAMP[0], SAMP[1]);
        const sc = total / L;                  // the piece's length is `pieceLength`'s, not the samples'
        const a0 = u0 * sc, a1 = u1 * sc;
        sampleAt(ns, a0, PT, 0);
        n = pushPt(n, PT[0], PT[1]);
        for (let i = 0; i <= ns; i++) {
            if (CUM[i] <= a0 || CUM[i] >= a1) continue;
            n = pushPt(n, SAMP[2 * i], SAMP[2 * i + 1]);
        }
        sampleAt(ns, a1, PT, 0);
        return pushPt(n, PT[0], PT[1]);
    }
    if (isLine(p)) {
        const ax = p.A[0], ay = p.A[1];
        const fx = (p.B[0] - ax) / L * k, fy = (p.B[1] - ay) / L * k;   // device px per unit of u
        const bx = ax * k + tx, by = ay * k + ty;
        n = pushPt(n, bx + fx * u0, by + fy * u0);
        return pushPt(n, bx + fx * u1, by + fy * u1);
    }
    const R = p.r * k;
    const cx = p.C[0] * k + tx, cy = p.C[1] * k + ty;
    const th0 = p.a0 + p.sweep * (u0 / L), th1 = p.a0 + p.sweep * (u1 / L);
    // The chord rule is applied at the BAND's OUTER edge, because that is where the notch
    // between two chords is: a chord subtending dth leaves the outer edge short by
    // (R + h)·(1 − cos(dth/2)), which is (R + h)/R times the centreline's own sagitta. For a
    // band far thinner than its circle that is `chordStep(R)` to within a per cent; for a
    // speck, where h is four times R, it is what keeps the dot round (N5).
    const m = R <= MIN_ARC_R ? 1 : Math.max(1, Math.ceil((u1 - u0) / chordStep(R * R / (R + h))));
    const dth = (th1 - th0) / m;
    // Each chord is pushed out by half its own sagitta, so the painted band straddles the true
    // circle at ±1/32 px instead of sitting 1/16 px inside it at every chord's middle.
    const rr = Math.abs(dth) <= 1 ? R + R * (1 - Math.cos(dth / 2)) / 2 : R;
    for (let i = 0; i <= m; i++) {
        const th = th0 + dth * i;
        n = pushPt(n, cx + rr * Math.cos(th), cy + rr * Math.sin(th));
    }
    return n;
}

/**
 * Sample one cubic into `SAMP` with its cumulative lengths in `CUM`, at the 1/16 px bar: the
 * chord of a cubic split `m` ways is within `dev / 4m²` of it, and `m = ceil(sqrt(dev/tol))` is
 * twice what that needs.
 * @returns {number} the number of SEGMENTS (so the samples are 0…n)
 */
function cubicSamples(p, k, tx, ty) {
    const cx = p[3][0] - p[0][0], cy = p[3][1] - p[0][1];
    const cl = Math.sqrt(cx * cx + cy * cy);
    let dev;
    if (cl > 1e-12) {
        const nx = -cy / cl, ny = cx / cl;
        dev = Math.max(Math.abs((p[1][0] - p[0][0]) * nx + (p[1][1] - p[0][1]) * ny),
            Math.abs((p[2][0] - p[0][0]) * nx + (p[2][1] - p[0][1]) * ny)) * k;
    } else {
        dev = Math.max(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]),
            Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1])) * k;
    }
    const ns = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(dev / ARC_TOL))));
    needSamp(ns + 1);
    let total = 0;
    for (let i = 0; i <= ns; i++) {
        cubicAt(p, i / ns, k, tx, ty, PT);
        SAMP[2 * i] = PT[0]; SAMP[2 * i + 1] = PT[1];
        if (i > 0) total += Math.hypot(PT[0] - SAMP[2 * i - 2], PT[1] - SAMP[2 * i - 1]);
        CUM[i] = total;
    }
    return ns;
}

/** The sampled polyline's point at length `s` along it, into `out[2·slot]`. */
function sampleAt(ns, s, out, slot) {
    let i = 0;
    while (i < ns - 1 && CUM[i + 1] < s) i++;
    const span = CUM[i + 1] - CUM[i];
    let f = span > 0 ? (s - CUM[i]) / span : 0;
    if (f < 0) f = 0; else if (f > 1) f = 1;
    out[2 * slot] = SAMP[2 * i] + (SAMP[2 * i + 2] - SAMP[2 * i]) * f;
    out[2 * slot + 1] = SAMP[2 * i + 1] + (SAMP[2 * i + 3] - SAMP[2 * i + 1]) * f;
}

const SEAM = [0, 0, 0, 0, 0, 0, 0, 0];   // the seam's two chords: the tail's A,B then the head's

/**
 * The extension a CLOSED run's SEAM takes, in device px. The run's first and last lit stretches
 * are the two halves of one dash, cut by the point where the loop closes, so the seam is a join
 * like every other and takes `joinExt` (D132) — the seam vertex is `loop[0].A`, a corner on any
 * polygon or cut shape, and with the bare overlap it reads 0 against 223 at the outer pixel of a
 * 90° corner where `runPathData`'s own "Z" miters today. The two chords are built by
 * `appendPiece` itself, so they are the chords the stamp will use; a seam whose piece is off the
 * plane has no stretch to join and takes the bare overlap.
 */
function seamJoinExt(pieces, n, firstEnd, lastStart, total, h, k, tx, ty) {
    let head = false, tail = false;
    for (let j = 0; j < n; j++) {
        if (!(LENS[j] > 0)) continue;
        const L = LENS[j], u1 = firstEnd < L ? firstEnd : L;
        if (FLAG[j] !== 2 && u1 > 0 && appendPiece(pieces[j], 0, u1, L, h, k, tx, ty, 0) > 1) {
            SEAM[4] = PTS[0]; SEAM[5] = PTS[1]; SEAM[6] = PTS[2]; SEAM[7] = PTS[3]; head = true;
        }
        break;
    }
    for (let j = n - 1; j >= 0; j--) {
        if (!(LENS[j] > 0)) continue;
        const L = LENS[j], st = total - L, u0 = lastStart > st ? lastStart - st : 0;
        if (FLAG[j] !== 2 && L > u0) {
            const c = appendPiece(pieces[j], u0, L, L, h, k, tx, ty, 0);
            if (c > 1) {
                SEAM[0] = PTS[2 * c - 4]; SEAM[1] = PTS[2 * c - 3];
                SEAM[2] = PTS[2 * c - 2]; SEAM[3] = PTS[2 * c - 1]; tail = true;
            }
        }
        break;
    }
    if (!head || !tail) return JOIN_PX;
    const d1x = SEAM[2] - SEAM[0], d1y = SEAM[3] - SEAM[1];
    const d2x = SEAM[6] - SEAM[4], d2y = SEAM[7] - SEAM[5];
    return joinExt(d1x, d1y, Math.sqrt(d1x * d1x + d1y * d1y),
        d2x, d2y, Math.sqrt(d2x * d2x + d2y * d2y), h);
}

/** `antRuns`' own `samePt` (`antRuns.js:379`), which that module does not export. */
const samePt = (a, b) => Math.abs(a[0] - b[0]) <= 1e-9 * (1 + Math.abs(a[0]))
    && Math.abs(a[1] - b[1]) <= 1e-9 * (1 + Math.abs(a[1]));

/**
 * Does this run's geometry close on itself? Read only when the caller says nothing: `loopRuns`
 * flags a loop `closed` (`antRuns.js:83`) but a MARK is built by `circleLoop` and may carry no
 * flag, and without the flag the speck is a ring of chords rather than one disc (D134).
 */
function geometryCloses(pieces, n) {
    let a = null, b = null;
    for (let i = 0; i < n; i++) if (pieceOk(pieces[i])) { a = isCubic(pieces[i]) ? pieces[i][0] : pieces[i].A; break; }
    for (let i = n - 1; i >= 0; i--) if (pieceOk(pieces[i])) { b = isCubic(pieces[i]) ? pieces[i][3] : pieces[i].B; break; }
    return !!a && !!b && samePt(a, b);
}

/** One run or mark: its pieces measured, its lit intervals placed, its lit stretches stamped. */
function paintRun(buf, pieces, closed, h, on, off, phase, k, tx, ty, ink, fit) {
    if (!pieces || !pieces.length) { antStats.refused++; return; }
    const n = pieces.length;
    needPieces(n);
    const W = buf._w, H = buf._h, pad = h + 1;
    let total = 0;
    for (let i = 0; i < n; i++) {
        const p = pieces[i];
        if (!pieceOk(p)) { LENS[i] = 0; FLAG[i] = 1; antStats.nonFinite++; continue; }
        const L = pieceLength(p) * k;
        if (!(L > 0) || !isFinite(L)) { LENS[i] = 0; FLAG[i] = 0; continue; }
        LENS[i] = L; total += L;
        pieceBox(p, k, tx, ty, BOX);
        FLAG[i] = (BOX[2] < -pad || BOX[0] > W + pad || BOX[3] < -pad || BOX[1] > H + pad) ? 2 : 0;
        if (FLAG[i] === 2) antStats.offPlane++;
    }
    if (!(total > 0)) return;
    let m = dashIntervals(total, on, off, phase, IV, fit);
    if (m * 2 > IV.length) { needIV(m); m = dashIntervals(total, on, off, phase, IV, fit); }
    antStats.dashes += m;
    // A CLOSED run's first and last lit stretches are the two halves of ONE dash, cut by the
    // seam where the loop closes — so they are joined, not capped, or the loop shows a bead
    // where it closes and a speck shorter than one dash paints at 56 % instead of solid.
    const cl = closed == null ? geometryCloses(pieces, n) : !!closed;
    const wrap = cl && m > 0 && IV[0] <= 0 && IV[2 * m - 1] >= total;
    if (wrap && m === 1) {
        const R = speckRadius(pieces, h, k);
        if (R > 0) {
            stampDisc(buf, pieces[0].C[0] * k + tx, pieces[0].C[1] * k + ty, R + h, ink);
            return;
        }
    }
    // The seam is a join, so its extension is the miter's, computed once from the two chords
    // that meet there (D132). The intervals are clipped to [0, total], so the polyline's own
    // ends are joins only at that seam and where an off-plane piece splits a stretch.
    const sx = wrap ? seamJoinExt(pieces, n, IV[1], IV[2 * m - 2], total, h, k, tx, ty) : 0;
    let i = 0, s = 0;                      // the piece the walk is on, and where it starts
    for (let q = 0; q < m; q++) {
        const a = IV[2 * q], b = IV[2 * q + 1];
        while (i < n && s + LENS[i] <= a) { s += LENS[i]; i++; }
        let j = i, sj = s, cnt = 0, e0 = wrap && a <= 0 ? sx : 0;
        while (j < n && sj < b) {
            const L = LENS[j];
            if (L > 0 && FLAG[j] === 2) {
                // Off the plane: stamp what stands and start again past it. Nothing is lost —
                // the skipped stretch has no pixel on this screen (N10).
                if (cnt > 1) stampPolyline(buf, PTS, cnt, h, ink, e0, JOIN_PX);
                cnt = 0; e0 = JOIN_PX;
            } else if (L > 0) {
                const u0 = (a > sj ? a : sj) - sj, u1 = (b < sj + L ? b : sj + L) - sj;
                if (u1 > u0) cnt = appendPiece(pieces[j], u0, u1, L, h, k, tx, ty, cnt);
            }
            sj += L; j++;
        }
        if (cnt > 1) stampPolyline(buf, PTS, cnt, h, ink, e0, wrap && b >= total ? sx : 0);
        else if (cnt === 1) stampSegment(buf, PTS[0], PTS[1], PTS[0], PTS[1], h, ink);
    }
}

function inkOf(css) {
    const v = css && css.ink;
    if (!v) return SEL_INK_RGB;
    if (typeof v === "number") return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    return v;
}

/**
 * One crawl phase of one decision, into `buf`. The buffer's last phase is cleared first, so a
 * phase is a pure function of (dec, view, phase, css) and of nothing the buffer holds (N12).
 *
 * @param {OverlayBuffer} buf
 * @param {object} dec   `_selDecide`'s own arrays: `{ runs: [{ pieces, closed, len }],
 *                       marks: [{ pieces, closed }], inkPx }`, in RETAINED units. `len` is not
 *                       read — the pieces are measured here, which is what bounds the work to
 *                       the retained window (N10, F38). `closed` is what joins a run's seam and
 *                       what makes a speck one disc (D132, D134); omitted, the geometry decides
 *                       (`geometryCloses`), and `false` on a loop paints a bead at its seam.
 * @param {object} view  `{ k, tx, ty }` — device px = p·k + t, float64, no origin (§2.7 FC6).
 * @param {number} phase any integer; phases repeat every `ANT_PHASES`.
 * @param {object} css   `{ dpr, ink }` — `ink` 8-bit sRGB, `[r,g,b]` or 0xRRGGBB.
 * @returns {object} what this call placed, refused and wrote
 */
export function paintPhase(buf, dec, view, phase, css) {
    const d0 = antStats.dashes, s0 = antStats.stamps, p0 = antStats.pixels;
    const n0 = antStats.nonFinite, r0 = antStats.refused, o0 = antStats.offPlane;
    buf.clearTouched();
    const k = view ? view.k : NaN, tx = view ? view.tx : NaN, ty = view ? view.ty : NaN;
    if (dec && isFinite(k) && k > 0 && isFinite(tx) && isFinite(ty)) {
        const dpr = css && css.dpr > 0 ? css.dpr : 1;
        const ink = inkOf(css);
        const kt = selAntScale(dec.inkPx);
        const runs = dec.runs || [], marks = dec.marks || [];
        // The runs: band and pattern scaled by `kt`, and fitted to a whole number of cycles.
        const rh = SEL_ANT_W * kt * dpr / 2, ron = SEL_ANT_ON * kt * dpr, roff = SEL_ANT_OFF * kt * dpr;
        for (let i = 0; i < runs.length; i++) paintRun(buf, runs[i].pieces, runs[i].closed, rh, ron, roff, phase, k, tx, ty, ink, true);
        // The marks: `kt` never reaches them (rule 3), and a speck is NEVER fitted — its
        // pattern slides across it whole, which is what makes it blink (`svgOverlay.renderSelAnts`).
        const mh = SEL_FINE_W * dpr / 2, mon = SEL_FINE_ON * dpr, moff = SEL_FINE_OFF * dpr;
        for (let i = 0; i < marks.length; i++) paintRun(buf, marks[i].pieces, marks[i].closed, mh, mon, moff, phase, k, tx, ty, ink, false);
    } else if (dec) antStats.refused++;
    return {
        dashes: antStats.dashes - d0, stamps: antStats.stamps - s0, pixels: antStats.pixels - p0,
        nonFinite: antStats.nonFinite - n0, refused: antStats.refused - r0,
        offPlane: antStats.offPlane - o0,
    };
}

/** Zero the counters. The layer does this per phase if it reports per phase; tests do it too. */
export function resetAntStats() {
    antStats.dashes = 0; antStats.stamps = 0; antStats.pixels = 0;
    antStats.nonFinite = 0; antStats.offPlane = 0; antStats.refused = 0; antStats.allocs = 0;
}
