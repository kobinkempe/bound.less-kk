/**
 * arcPerimeter.js — resolve a biarc stroke into one outline, exactly.
 *
 * This is schedule A (batch at pen-up) rebuilt on the arc representation. The
 * shape of the algorithm is the classic three phases and is unchanged from
 * `curvePerimeter`: build both offset rails plus caps as ONE closed chain, cut
 * it at its own self-crossings, throw away the fragments that are buried under
 * the pen, restitch the survivors into closed loops.
 *
 * What changes is that every step is now exact.
 *
 *   OFFSET     the offset of an arc is a concentric arc, radius +/- the pen.
 *              Nothing is fitted, so there is no `fitTol`, no Tiller-Hanson,
 *              no subdivision-until-close-enough, and no fitted-vs-true gap for
 *              a shallow crossing to amplify.
 *
 *   CONNECT    the centerline is G1, so at a shared vertex both neighbours have
 *              the same tangent and therefore the same normal. The offset point
 *              is computed ONCE PER VERTEX and handed to both pieces, so the
 *              rail is watertight by construction rather than by welding.
 *              Round joins do not exist here: there is no corner to fill.
 *
 *   CROSS      arc-arc is circle-circle: one square root. No Newton polish, no
 *              subdivision bracket, and no chance of one crossing being found
 *              twice at two slightly different places — which was the defect
 *              behind F15 and, through the unbalanced junctions it left, F20.
 *
 *   CUT        splitting an arc at a crossing is arithmetic on the angle. The
 *              two halves share the crossing POINT, not two roundings of it.
 *
 * Burial is still judged by distance to the centerline, and still with a
 * margin, because that test is inherently a measurement. It is the only
 * approximate step left, and it degrades locally: a fragment misjudged costs
 * that fragment, not everything downstream of it.
 */
import { arcTangent, arcDist, offsetArc, BiarcPen } from "./biarc";

const TAU = Math.PI * 2;
const norm = (d) => d - TAU * Math.floor(d / TAU);   // into [0, TAU)

// ---------------------------------------------------------------------------
// piece primitives — a piece is a biarc arc/line, plus explicit A and B
// ---------------------------------------------------------------------------

export function ptAt(p, s) {
    if (s <= 0) return [p.A[0], p.A[1]];
    if (s >= 1) return [p.B[0], p.B[1]];
    if (p.line) return [p.A[0] + (p.B[0] - p.A[0]) * s, p.A[1] + (p.B[1] - p.A[1]) * s];
    const th = p.a0 + p.sweep * s;
    return [p.C[0] + p.r * Math.cos(th), p.C[1] + p.r * Math.sin(th)];
}

/** Where on the piece does this point sit? Returns s, or null if off the ends. */
export function paramOf(p, q, eps) {
    if (p.line) {
        const dx = p.B[0] - p.A[0], dy = p.B[1] - p.A[1], L2 = dx * dx + dy * dy;
        if (L2 <= 0) return null;
        const s = ((q[0] - p.A[0]) * dx + (q[1] - p.A[1]) * dy) / L2;
        const slack = eps / Math.sqrt(L2);
        return (s >= -slack && s <= 1 + slack) ? Math.min(1, Math.max(0, s)) : null;
    }
    const th = Math.atan2(q[1] - p.C[1], q[0] - p.C[0]);
    const d = norm(th - p.a0);
    // Signed offset along the sweep, then normalised to [0,1].
    const along = p.sweep > 0 ? d : d - TAU;
    const s = along / p.sweep;
    const slack = eps / Math.max(p.r * Math.abs(p.sweep), 1e-12);
    return (s >= -slack && s <= 1 + slack) ? Math.min(1, Math.max(0, s)) : null;
}

export function pieceBBox(p) {
    let x0 = Math.min(p.A[0], p.B[0]), x1 = Math.max(p.A[0], p.B[0]);
    let y0 = Math.min(p.A[1], p.B[1]), y1 = Math.max(p.A[1], p.B[1]);
    if (!p.line) {
        // The circle's axis extremes, but only those the sweep actually reaches.
        for (let k = 0; k < 4; k++) {
            const th = k * Math.PI / 2;
            const d = norm(th - p.a0);
            const inside = p.sweep > 0 ? (d <= p.sweep) : ((d - TAU) >= p.sweep);
            if (!inside) continue;
            const x = p.C[0] + p.r * Math.cos(th), y = p.C[1] + p.r * Math.sin(th);
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    return [x0, y0, x1, y1];
}

/** The part of `p` between s0 and s1, with its endpoints supplied exactly. */
export function subPiece(p, s0, s1, A, B) {
    // `ci` travels with the fragment. Without it an uncut piece keeps its chain
    // position and a cut one silently loses it, so any later adjacency test
    // compares a number against undefined and quietly answers false.
    if (p.line) return { line: true, A, B, src: p.src, ci: p.ci, rl: p.rl };
    return { line: false, C: p.C, r: p.r, a0: p.a0 + p.sweep * s0,
        sweep: p.sweep * (s1 - s0), A, B, src: p.src, ci: p.ci, rl: p.rl };
}

// ---------------------------------------------------------------------------
// the boundary chain
// ---------------------------------------------------------------------------

/** Half-turn cap at `pivot`, from `from` to `to`, bulging away from `inward`. */
function cap(pivot, r, from, to, tangent) {
    // Sweep through the OUTWARD direction (along the travel tangent at the end,
    // against it at the start), which is a half turn; the sign says which way
    // round, and picking it from the tangent rather than from the endpoints is
    // what keeps a cap from ever being drawn the long way round.
    const a0 = Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
    const mid = Math.atan2(tangent[1], tangent[0]);
    const forward = norm(mid - a0) < Math.PI;
    return { line: false, C: [pivot[0], pivot[1]], r, a0,
        sweep: forward ? Math.PI : -Math.PI, A: from, B: to, src: -1 };
}

/**
 * Both rails and both caps as one closed chain.
 *
 * Offset points are computed per VERTEX and shared, so consecutive pieces agree
 * bit for bit. That is the difference between a chain that closes because the
 * arithmetic worked out and one that closes because it was built that way.
 */
export function boundaryChain(centre, r) {
    const b = new ChainBuilder(centre, r);
    while (!b.step(Infinity)) { /* run to completion */ }
    return b.out;
}

/**
 * The same construction with a cursor in it, so a pen-up bake can put down a
 * long chain a few thousand pieces at a time instead of holding the frame. The
 * emitted ORDER is identical to the one-shot version — left rail, end cap,
 * right rail backwards, start cap — and that matters: chain position is what
 * the adjacency skip is judged on later.
 */
export class ChainBuilder {
    constructor(centre, r) {
        this.centre = centre; this.r = r;
        this.n = centre.length;
        this.T = new Array(this.n + 1);
        this.V = new Array(this.n + 1);
        this.L = new Array(this.n + 1);
        this.R = new Array(this.n + 1);
        this.stage = this.n ? 0 : 4;
        this.i = 0;
        this.out = [];
        // A rail is a run of pieces that are neighbours ALONG the chain. An open
        // stroke has one (both rails plus both caps, in a single cycle); a closed
        // one has two, each closed on itself. `railLen` lets the cut step ask
        // "are these two pieces neighbours" cyclically within a rail, which is
        // the question the adjacency skip is actually about.
        this.railLen = [];
        this.closed = false;
        this.cusp = false;
    }
    // Tangent at each vertex. `biarc` snapped the joint tangents, so the two
    // sides of a vertex hold the identical vector — not merely equal ones — and
    // the offset point computed here is handed to BOTH neighbouring pieces.
    _vertex(i) {
        const c = this.centre, n = this.n, r = this.r;
        const T = i < n ? arcTangent(c[i], 0) : arcTangent(c[n - 1], 1);
        const V = i < n ? c[i].A : c[n - 1].B;
        this.T[i] = T; this.V[i] = V;
        this.L[i] = [V[0] - T[1] * r, V[1] + T[0] * r];
        this.R[i] = [V[0] + T[1] * r, V[1] - T[0] * r];
    }
    /**
     * A stroke that ends exactly where it began has NO ENDS, and giving it caps
     * is what breaks it.
     *
     * The two half-turn caps would sit on the SAME circle — same centre, same
     * radius — and two arcs of one circle have no transverse crossing to find,
     * so the pair is invisible to `circleCircle` however much they overlap. The
     * overlap is then a stretch of doubled boundary where every point is at
     * distance exactly r from BOTH generators, burial is a coin flip, and the
     * resolve keeps fragments whose partners it drops: measured on a 36-point
     * ring, an unclosed loop of 72 pieces, which then shredded every boolean it
     * was fed to.
     *
     * So the rails are closed on themselves instead. The seam tangent is the
     * mean of the two one-sided tangents the spline gives there — they differ by
     * ~3e-4 radians because the spline treats the stroke as open — and taking it
     * once means L[0] and L[n] are the SAME POINT rather than two points a few
     * thousandths apart. There is nothing left to weld.
     */
    _closeSeam() {
        const n = this.n;
        const a = this.V[0], b = this.V[n];
        if (a[0] !== b[0] || a[1] !== b[1]) return false;
        const t0 = this.T[0], t1 = this.T[n];
        let mx = t0[0] + t1[0], my = t0[1] + t1[1];
        const len = Math.hypot(mx, my);
        // Exactly opposed tangents: the stroke doubles back onto its own start,
        // which is a genuine cusp and genuinely wants caps — but it wants the
        // two DIFFERENT halves of one circle, and by default it gets the same
        // half twice.
        //
        // The reason is that both caps are then built from the same data. The
        // end vertex offsets to L[n] = V + perp(T0)·r and the start vertex to
        // R[0] = V + perp(T0)·r — the same point — and both caps are handed the
        // same outward direction, so `cap` picks the same sweep for both. Half
        // the circle is drawn twice and the other half not at all, which leaves
        // the boundary open by exactly that half: measured, a 104-unit fabricated
        // edge on a 200-unit stroke. Flagging it here makes the start cap sweep
        // the other way, and the two halves complete the circle.
        if (!(len > 1e-9)) { this.cusp = true; return false; }
        mx /= len; my /= len;
        const r = this.r;
        const T = [mx, my];
        this.T[0] = T; this.T[n] = T;
        this.L[0] = [a[0] - my * r, a[1] + mx * r];
        this.R[0] = [a[0] + my * r, a[1] - mx * r];
        // The SAME arrays, so the rails close bit for bit and not by tolerance.
        this.L[n] = this.L[0];
        this.R[n] = this.R[0];
        return true;
    }
    /** Do up to `budget` items of work. Returns true when the chain is built. */
    step(budget) {
        const n = this.n, r = this.r, out = this.out;
        let left = budget;
        while (left > 0) {
            if (this.stage === 0) {
                if (this.i > n) {
                    this.closed = this._closeSeam();
                    this.stage = 1; this.i = 0;
                    continue;
                }
                this._vertex(this.i++); left--;
            } else if (this.stage === 1) {
                // left rail
                if (this.i >= n) {
                    if (this.closed) { this.railLen.push(out.length); this.stage = 2; this.i = n - 1; continue; }
                    out.push({ ...cap(this.V[n], r, this.L[n], this.R[n], this.T[n]), rl: 0 });
                    this.stage = 2; this.i = n - 1; left--; continue;
                }
                const i = this.i++;
                const o = offsetArc(this.centre[i], r, 1);
                if (o) out.push({ ...o, A: this.L[i], B: this.L[i + 1], src: i, rl: 0 });
                left--;
            } else if (this.stage === 2) {
                // right rail, travelling backwards
                if (this.i < 0) {
                    if (this.closed) { this.railLen.push(out.length - this.railLen[0]); this.stage = 4; continue; }
                    const back = this.cusp ? this.T[0] : [-this.T[0][0], -this.T[0][1]];
                    out.push({ ...cap(this.V[0], r, this.R[0], this.L[0], back), rl: 0 });
                    this.railLen.push(out.length);
                    this.stage = 4; left--; continue;
                }
                const i = this.i--;
                const o = offsetArc(this.centre[i], r, -1);
                if (o) {
                    const rev = o.line
                        ? { line: true }
                        : { line: false, C: o.C, r: o.r, a0: o.a0 + o.sweep, sweep: -o.sweep };
                    out.push({ ...rev, A: this.R[i + 1], B: this.R[i], src: i, rl: this.closed ? 1 : 0 });
                }
                left--;
            } else return true;
        }
        return this.stage === 4;
    }
}

// ---------------------------------------------------------------------------
// intersections — all closed form
// ---------------------------------------------------------------------------

function circleCircle(C1, r1, C2, r2, out) {
    const dx = C2[0] - C1[0], dy = C2[1] - C1[1];
    const d2 = dx * dx + dy * dy;
    if (d2 <= 0) return out;
    const d = Math.sqrt(d2);
    if (d > r1 + r2 || d < Math.abs(r1 - r2)) return out;
    const a = (r1 * r1 - r2 * r2 + d2) / (2 * d);
    const h2 = r1 * r1 - a * a;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;
    const mx = C1[0] + a * dx / d, my = C1[1] + a * dy / d;
    if (h === 0) { out.push([mx, my]); return out; }
    out.push([mx + h * dy / d, my - h * dx / d]);
    out.push([mx - h * dy / d, my + h * dx / d]);
    return out;
}

function circleSegment(C, r, A, B, out) {
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const fx = A[0] - C[0], fy = A[1] - C[1];
    const a = dx * dx + dy * dy;
    if (a <= 0) return out;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return out;
    const sq = Math.sqrt(disc);
    for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t >= -1e-9 && t <= 1 + 1e-9) out.push([A[0] + t * dx, A[1] + t * dy]);
    }
    return out;
}

function segSeg(A, B, C, D, out) {
    const r1x = B[0] - A[0], r1y = B[1] - A[1];
    const r2x = D[0] - C[0], r2y = D[1] - C[1];
    const den = r1x * r2y - r1y * r2x;
    if (den === 0) return out;
    const t = ((C[0] - A[0]) * r2y - (C[1] - A[1]) * r2x) / den;
    const u = ((C[0] - A[0]) * r1y - (C[1] - A[1]) * r1x) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
        out.push([A[0] + t * r1x, A[1] + t * r1y]);
    }
    return out;
}

/** Candidate crossing POINTS of two pieces, before range filtering. */
export function pieceIntersections(p, q) {
    const out = [];
    if (p.line && q.line) return segSeg(p.A, p.B, q.A, q.B, out);
    if (p.line) return circleSegment(q.C, q.r, p.A, p.B, out);
    if (q.line) return circleSegment(p.C, p.r, q.A, q.B, out);
    return circleCircle(p.C, p.r, q.C, q.r, out);
}

// ---------------------------------------------------------------------------
// broad phase
// ---------------------------------------------------------------------------

class Grid {
    constructor(cell) { this.cell = Math.max(cell, 1e-9); this.map = new Map(); }
    _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
    insert(bb, idx) {
        const c = this.cell;
        const x0 = Math.floor(bb[0] / c), x1 = Math.floor(bb[2] / c);
        const y0 = Math.floor(bb[1] / c), y1 = Math.floor(bb[3] / c);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const k = this._key(x, y);
                let a = this.map.get(k);
                if (!a) { a = []; this.map.set(k, a); }
                a.push(idx);
            }
        }
    }
    near(bb, fn) {
        const c = this.cell;
        const x0 = Math.floor(bb[0] / c), x1 = Math.floor(bb[2] / c);
        const y0 = Math.floor(bb[1] / c), y1 = Math.floor(bb[3] / c);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const a = this.map.get(this._key(x, y));
                if (a) for (const i of a) fn(i);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// the burial oracle
// ---------------------------------------------------------------------------

/**
 * Distance to the centerline — EXACTLY.
 *
 * The cubic version had to flatten the centerline into a polyline to answer
 * this and lived with the resulting `oracleTol`. That tolerance turned out to
 * be the binding constraint on the whole bake, for a reason worth stating:
 *
 *   Every point of an offset piece is at distance exactly r from its own
 *   generator, so an EXPOSED piece reads exactly r and a BURIED one dips below.
 *   A fragment caught between two crossings that are close together dips only a
 *   little. Classify by "is it more than tol + margin below r" and every such
 *   shallow sliver reads as exposed, is kept, and leaves a junction with one
 *   more way in than out — which is what an open chain is.
 *
 *   Measured on the captured stroke: flattening at r/512 left 122 open chains,
 *   r/4096 left 25, r/32768 left none. That is not a tolerance wanting tuning,
 *   it is a tolerance wanting removal.
 *
 * Point-to-arc distance is closed form, so the grid holds the arcs themselves
 * and there is no flattening at all. The only approximation left is `margin`,
 * which exists solely to keep a point sitting at exactly r off a coin flip.
 */
class Oracle {
    constructor(centre, r, lazy) {
        this.arcs = centre;
        this.bbs = new Array(centre.length);
        this.grid = new Grid(Math.max(r, 1e-9));
        this.n = 0;
        if (!lazy) this.fill(Infinity);
    }
    /** Index up to `budget` more arcs. True once every one is in. */
    fill(budget) {
        let left = budget;
        while (this.n < this.arcs.length && left-- > 0) {
            const i = this.n++;
            this.bbs[i] = pieceBBox(this.arcs[i]);
            this.grid.insert(this.bbs[i], i);
        }
        return this.n >= this.arcs.length;
    }
    /** True when the point is inside the pen by more than `margin`. */
    buried(x, y, r, margin) {
        const eff = r - margin;
        if (eff <= 0) return false;
        let hit = false;
        const p = [x, y];
        const e2 = eff * eff;
        this.grid.near([x - eff, y - eff, x + eff, y + eff], (i) => {
            if (hit) return;
            // Point-to-rectangle first. A grid cell the size of the pen holds
            // hundreds of arcs on a dense stroke and the exact test costs an
            // atan2 apiece, so the cheap rejection is most of the work.
            const b = this.bbs[i];
            const dx = x < b[0] ? b[0] - x : (x > b[2] ? x - b[2] : 0);
            const dy = y < b[1] ? b[1] - y : (y > b[3] ? y - b[3] : 0);
            if (dx * dx + dy * dy >= e2) return;
            if (arcDist(this.arcs[i], p) < eff) hit = true;
        });
        return hit;
    }
}

// ---------------------------------------------------------------------------
// stitching
// ---------------------------------------------------------------------------

/**
 * Shared vertex identity by position.
 *
 * Neighbouring cells are searched as well as the point's own, because a pair of
 * coordinates either side of a cell boundary is not a pair of different places.
 * Endpoints are registered BEFORE any crossing, so a crossing that lands on an
 * endpoint adopts that endpoint's identity rather than inventing a vertex a
 * millionth of a unit away from it — which is how a junction ends up with one
 * more way in than out.
 */
class VertexSet {
    constructor(q) { this.q = q; this.map = new Map(); this.pts = []; }
    id(p) {
        const cx = Math.round(p[0] / this.q), cy = Math.round(p[1] / this.q);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const v = this.map.get(`${cx + dx},${cy + dy}`);
                if (v !== undefined) return v;
            }
        }
        const v = this.pts.length;
        this.map.set(`${cx},${cy}`, v);
        this.pts.push([p[0], p[1]]);
        return v;
    }
}

// ---------------------------------------------------------------------------
// the bake
// ---------------------------------------------------------------------------

const PH = { CENTERLINE: 0, CHAIN: 1, ORACLE: 2, PRECULL: 3, CUT: 4, CLASSIFY: 5, STITCH: 6, FINISH: 7, DONE: 8 };
const PH_NAME = ["centerline", "chain", "oracle", "precull", "cut", "classify", "stitch", "finish"];
// Items between clock reads, ADAPTIVE.
//
// A fixed count cannot work, because the per-item cost differs by orders between
// phases and between strokes: adding a sample to the pen is nanoseconds, while
// cutting one piece of a dense scribble tests it against every piece crowding
// its own grid cell. Measured with a fixed 64, a 1,500-sample scribble took
// 181 ms over 12 slices — but its WORST slice was 53.9 ms, seven times the
// budget it had been asked for, and a dropped frame however small that budget.
//
// So every phase starts small and tunes itself towards a chunk of about a
// millisecond. The clock is then read often enough to respect the budget and
// rarely enough not to become the cost itself.
const NO_CUTS = [];
const CHUNK0 = 8;
const CHUNK_TARGET_MS = 1;
// A HARD CEILING as well as a target. Per-item cost inside one phase varies by
// orders — `buried()` rejects a piece far from the ink on a bounding box and
// walks hundreds of arcs for one inside it — so a chunk sized from cheap items
// and then handed expensive ones overruns however carefully it was tuned. At 64
// the clock is read often enough to bound that, and `performance.now()` at once
// per 64 items is nothing.
const CHUNK_MAX = 64;

/**
 * The bake with a cursor in it.
 *
 * Every phase is resumable, because "defer the bake" is not the same thing as
 * "the bake never blocks". The old pipeline deferred between OBJECTS and handed
 * out one whole object per slice, so a single heavy stroke was an indivisible
 * multi-second job with no point inside it where control came back — that is
 * F9, and it is the freeze Kobin actually hit. Slicing has to go all the way
 * down or it does not count.
 *
 * `step(budgetMs)` does at most that many milliseconds of work and returns true
 * when the shape is finished. Nothing is published until then: `result` is null
 * for the whole run, so a half-resolved perimeter can never be drawn, stored or
 * erased against.
 *
 * @param {number[][]} pts    pen samples (ignored if `opts.centre` is given)
 * @param {number}     width  pen width
 * @param {object}     opts   { tol, margin, centre }
 *   `centre` lets a caller hand over an arc chain it already built — the pen
 *   maintains one WHILE DRAWING at O(1) a sample, so at pen-up the first phase
 *   is already paid for.
 */
export class ArcBakeJob {
    constructor(pts, width, opts = {}) {
        this.pts = pts || [];
        this.r = width / 2;
        this.opts = opts;
        this.tol = opts.tol == null ? 0.25 : opts.tol;
        this.ms = {};
        this.busyMs = 0;
        this._phaseBusy = 0;
        this.result = null;
        this.centre = opts.centre || null;
        this.phase = this.centre ? PH.CHAIN : PH.CENTERLINE;
        this.i = 0;
        this.chunk = CHUNK0;
        if (!this.centre && !this.pts.length) {
            this.result = { loops: [], stats: { ms: 0, empty: true } };
            this.phase = PH.DONE;
        }
    }

    /** 0..1, good enough to drive a progress hint; never used for correctness. */
    progress() {
        if (this.result) return 1;
        return Math.min(0.99, this.phase / PH_NAME.length);
    }

    step(budgetMs = 8) {
        if (this.result) return true;
        const sliceStart = now();
        this._sliceStart = sliceStart;
        const deadline = sliceStart + Math.max(0, budgetMs);
        for (;;) {
            switch (this.phase) {
                case PH.CENTERLINE: this._centerline(deadline); break;
                case PH.CHAIN: this._chain(deadline); break;
                case PH.ORACLE: this._oracle(deadline); break;
                case PH.PRECULL: this._precull(deadline); break;
                case PH.CUT: this._cut(deadline); break;
                case PH.CLASSIFY: this._classify(deadline); break;
                case PH.STITCH: this._stitch(deadline); break;
                case PH.FINISH: this._finishPhase(deadline); break;
                default: break;
            }
            if (this.result || this.phase === PH.DONE) {
                this._charge();
                if (!this.result) this._finish();
                return true;
            }
            if (now() >= deadline) { this._charge(); return false; }
        }
    }

    // Bill the time spent so far in this slice. Wall time BETWEEN slices is the
    // user drawing, not the bake, so per-phase costs have to be accumulated at
    // every boundary rather than read off a start timestamp.
    _charge() {
        const t = now();
        this.busyMs += t - this._sliceStart;
        this._sliceStart = t;
    }

    /** Aim the next chunk at ~1 ms, from what the last one actually cost. */
    _tune(ms, n) {
        if (!(n > 0)) return;
        const per = Math.max(ms, 1e-4) / n;
        // Grow at most 2x a step. Per-item cost is wildly uneven inside a phase
        // — one piece of a dense scribble is tested against every piece crowding
        // its grid cell and its neighbour against none — so a chunk that happened
        // to be cheap would otherwise set a chunk hundreds of times larger, and
        // the next one would run 35 ms before it ever looked at the clock.
        // Shrinking is unbounded: reacting fast to expensive work is the point.
        const want = Math.round(CHUNK_TARGET_MS / per);
        this.chunk = Math.max(1, Math.min(CHUNK_MAX, this.chunk * 2, want));
    }

    _endPhase(next) {
        this._charge();
        this.ms[PH_NAME[this.phase]] = +(this.busyMs - this._phaseBusy).toFixed(1);
        this._phaseBusy = this.busyMs;
        this.phase = next;
        this.i = 0;
        // Each phase measures itself: the rate of the previous one says nothing
        // about this one.
        this.chunk = CHUNK0;
    }

    // ---- 1. the centerline -------------------------------------------------
    // `BiarcPen` is the incremental form of `chainFor` and produces the
    // identical chain (pinned by biarc.test.js), so feeding it in chunks is
    // both resumable and the very same code the live pen runs.
    _centerline(deadline) {
        if (!this.pen) { this.pen = new BiarcPen({ tol: this.tol }); this.i = 0; }
        const pts = this.pts;
        while (this.i < pts.length) {
            const t = now(), from = this.i;
            const stop = Math.min(pts.length, this.i + this.chunk);
            for (; this.i < stop; this.i++) this.pen.addSample(pts[this.i]);
            this._tune(now() - t, this.i - from);
            if (this.i < pts.length && now() >= deadline) return;
        }
        this.centre = this.pen.arcs();
        this.pen = null;
        this._endPhase(PH.CHAIN);
    }

    // ---- 2. both rails and both caps as one closed chain --------------------
    _chain(deadline) {
        if (!this.centre.length) {
            // A dot: the pen's own circle, which needs none of what follows.
            const c = this.pts[0] || [0, 0];
            const r = this.r;
            this.loops = [[
                { line: false, C: [c[0], c[1]], r, a0: 0, sweep: Math.PI, A: [c[0] + r, c[1]], B: [c[0] - r, c[1]], src: -1 },
                { line: false, C: [c[0], c[1]], r, a0: Math.PI, sweep: Math.PI, A: [c[0] - r, c[1]], B: [c[0] + r, c[1]], src: -1 },
            ]];
            this.trivial = true;
            this.oriented = this.loops;
            this.open = 0; this.unbalanced = 0; this.hairlines = 0;
            this._endPhase(PH.DONE);
            return;
        }
        if (!this.builder) this.builder = new ChainBuilder(this.centre, this.r);
        for (;;) {
            const t = now(), n = this.chunk;
            if (this.builder.step(n)) break;
            this._tune(now() - t, n);
            if (now() >= deadline) return;
        }
        this.pieces = this.builder.out;
        this.railLen = this.builder.railLen;
        this.builder = null;
        // Position WITHIN ITS RAIL travels with each piece from here on.
        // Adjacency has to be judged on the chain, not on the surviving array —
        // after a pre-cull the two are not the same thing — and it has to be
        // judged per rail, because a closed stroke has TWO closed rails and the
        // last piece of one is not a neighbour of the first piece of the other.
        const at = [0, 0];
        for (const p of this.pieces) { p.ci = at[p.rl]++; }
        this.M = this.pieces.length;
        this._endPhase(PH.ORACLE);
    }

    // ---- 3. the burial oracle ----------------------------------------------
    _oracle(deadline) {
        if (!this.oracle) this.oracle = new Oracle(this.centre, this.r, true);
        for (;;) {
            const t = now(), n = this.chunk;
            if (this.oracle.fill(n)) break;
            this._tune(now() - t, n);
            if (now() >= deadline) return;
        }
        // With an exact oracle the margin is no longer absorbing a flattening
        // error — it only keeps a point sitting at exactly r off a coin flip.
        this.margin = this.opts.margin > 0 ? this.opts.margin : this.r * 1e-7;
        this.live = []; this.bbs = [];
        this.sub = 0;
        this._endPhase(PH.PRECULL);
    }

    // ---- 4. drop what is wholly inside the pen -----------------------------
    //
    // Three sub-stages, all sliced. The cull loop is the obvious cost, but the
    // two that FOLLOW it are the ones that were dropping frames: a dense stroke
    // leaves ten thousand live pieces, and inserting each into the broad-phase
    // grid and registering its two endpoints is tens of thousands of operations
    // with nowhere to yield. Measured: a 62 ms slice against an 8 ms budget,
    // entirely here, with every chunked loop already behaving.
    _precull(deadline) {
        const { pieces, oracle, r, margin, live, bbs } = this;
        if (this.sub === 0) {
            while (this.i < pieces.length) {
                const t = now(), from = this.i;
                const stop = Math.min(pieces.length, this.i + this.chunk);
                for (; this.i < stop; this.i++) {
                    const p = pieces[this.i];
                    const bb = pieceBBox(p);
                    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
                    const half = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2;
                    // Conservative: only drop when the WHOLE bbox is buried.
                    // Sampling the piece instead is what dropped real boundary in F19.
                    if (oracle.buried(cx, cy, r, margin + half)) continue;
                    live.push(p); bbs.push(bb);
                }
                this._tune(now() - t, this.i - from);
                if (this.i < pieces.length && now() >= deadline) return;
            }
            this.N = live.length;
            this.grid = new Grid(Math.max(r, 1e-9));
            // One vertex set for the whole bake, endpoints registered FIRST so a
            // crossing landing on one adopts its identity instead of inventing a
            // near-duplicate. `weld` swallows the fuzz in a near-tangential
            // circle-circle hit, about 1e-8 of the radius involved.
            this.vs = new VertexSet(Math.max(r * 1e-6, 1e-12));
            this.endV = new Array(this.N * 2);
            this.sub = 1; this.i = 0; this.chunk = CHUNK0;
        }
        if (this.sub === 1) {
            while (this.i < this.N) {
                const t = now(), from = this.i;
                const stop = Math.min(this.N, this.i + this.chunk);
                for (; this.i < stop; this.i++) this.grid.insert(bbs[this.i], this.i);
                this._tune(now() - t, this.i - from);
                if (this.i < this.N && now() >= deadline) return;
            }
            this.sub = 2; this.i = 0; this.chunk = CHUNK0;
        }
        while (this.i < this.N) {
            const t = now(), from = this.i;
            const stop = Math.min(this.N, this.i + this.chunk);
            for (; this.i < stop; this.i++) {
                this.endV[this.i * 2] = this.vs.id(live[this.i].A);
                this.endV[this.i * 2 + 1] = this.vs.id(live[this.i].B);
            }
            this._tune(now() - t, this.i - from);
            if (this.i < this.N && now() >= deadline) return;
        }
        // Holey, and filled only where a crossing actually lands. Allocating one
        // array per piece up front is twenty thousand allocations in a single
        // unyielding statement on a dense stroke, and nearly every one of them
        // would stay empty.
        this.cuts = new Array(this.N);
        this.nX = 0;
        this.sub = 0;
        this._endPhase(PH.CUT);
    }

    // ---- 5. cut the chain at its own self-crossings -------------------------
    _cut(deadline) {
        const { live, bbs, grid, cuts, vs, M, N, r } = this;
        const eps = r * 1e-7;
        while (this.i < N) {
            const t = now(), from = this.i;
            const stop = Math.min(N, this.i + this.chunk);
            for (; this.i < stop; this.i++) {
                const i = this.i;
                grid.near(bbs[i], (j) => {
                    if (j <= i) return;
                    // Consecutive pieces share a point AND a tangent there, which
                    // makes their circles tangent circles — and two tangent
                    // circles meet at exactly one point, the one they already
                    // share. So an immediate neighbour has nothing to contribute
                    // and everything to confuse. (Stronger than it was for
                    // cubics, where fitted offsets of neighbours genuinely could
                    // cross elsewhere.)
                    //
                    // Cyclically, and WITHIN A RAIL. An open stroke is one rail
                    // and this is exactly the old rule; a closed one is two, and
                    // treating the whole array as a single cycle would both skip
                    // a pair that is not adjacent (the two rails' ends) and test
                    // one that is (each rail's own seam).
                    if (live[i].rl === live[j].rl) {
                        const d = Math.abs(live[i].ci - live[j].ci);
                        const L = this.railLen[live[i].rl] || M;
                        if (d <= 1 || d >= L - 1) return;
                    }
                    const bj = bbs[j];
                    if (bj[0] > bbs[i][2] || bj[2] < bbs[i][0] || bj[1] > bbs[i][3] || bj[3] < bbs[i][1]) return;
                    for (const q of pieceIntersections(live[i], live[j])) {
                        const si = paramOf(live[i], q, eps);
                        if (si == null) continue;
                        const sj = paramOf(live[j], q, eps);
                        if (sj == null) continue;
                        // ONE vertex id for the crossing, so both pieces are cut
                        // at the very same point rather than at two roundings.
                        const v = vs.id(q);
                        (cuts[i] || (cuts[i] = [])).push([si, v]);
                        (cuts[j] || (cuts[j] = [])).push([sj, v]);
                        this.nX++;
                    }
                });
            }
            this._tune(now() - t, this.i - from);
            if (this.i < N && now() >= deadline) return;
        }
        this.kept = [];
        this._endPhase(PH.CLASSIFY);
    }

    // ---- 6. split, and throw away what the pen covers -----------------------
    _classify(deadline) {
        const { live, cuts, endV, vs, oracle, r, margin, kept, N } = this;
        while (this.i < N) {
            const t = now(), from = this.i;
            const stop = Math.min(N, this.i + this.chunk);
            for (; this.i < stop; this.i++) {
                const i = this.i;
                const p = live[i];
                const va = endV[i * 2], vb = endV[i * 2 + 1];
                // A crossing that resolved to one of this piece's own ends is
                // not a cut — and dropping it here, by VERTEX rather than by
                // parameter, drops it on the other piece too, because both saw
                // the same vertex.
                const seen = new Set();
                const cl = [];
                for (const c of (cuts[i] || NO_CUTS)) {
                    if (c[1] === va || c[1] === vb || seen.has(c[1])) continue;
                    seen.add(c[1]);
                    cl.push(c);
                }
                let segs;
                if (!cl.length) segs = [p];
                else {
                    cl.sort((a, b) => a[0] - b[0]);
                    segs = [];
                    let s0 = 0, A = p.A;
                    for (const [s, v] of cl) {
                        const P = vs.pts[v];
                        segs.push(subPiece(p, s0, s, A, P));
                        s0 = s; A = P;
                    }
                    segs.push(subPiece(p, s0, 1, A, p.B));
                }
                for (const s of segs) {
                    const m = ptAt(s, 0.5);
                    if (!oracle.buried(m[0], m[1], r, margin)) kept.push(s);
                }
            }
            this._tune(now() - t, this.i - from);
            if (this.i < N && now() >= deadline) return;
        }
        this.outAt = new Map();
        this.used = new Uint8Array(kept.length);
        this.loops = [];
        this.walk = null;
        this.sub = 0;
        this._endPhase(PH.STITCH);
    }

    // ---- 7. restitch the survivors into closed loops ------------------------
    _stitch(deadline) {
        const { kept, vs, outAt, used } = this;
        if (this.sub === 0) {
            while (this.i < kept.length) {
                const t = now(), from = this.i;
                const stop = Math.min(kept.length, this.i + this.chunk);
                for (; this.i < stop; this.i++) {
                    const a = vs.id(kept[this.i].A);
                    let arr = outAt.get(a);
                    if (!arr) { arr = []; outAt.set(a, arr); }
                    arr.push(this.i);
                }
                this._tune(now() - t, this.i - from);
                if (this.i < kept.length && now() >= deadline) return;
            }
            this.sub = 1; this.i = 0;
        }
        if (this.sub === 1) {
            // Resumable MID-LOOP. One loop of a dense scribble runs to thousands
            // of pieces, and chunking on start indices meant a slice could pick
            // one up and follow it to the end with nowhere to stop: measured at
            // 13 ms on a 1,500-sample stroke.
            for (;;) {
                const t = now();
                let n = 0;
                while (n < this.chunk) {
                    if (!this.walk) {
                        while (this.i < kept.length && used[this.i]) this.i++;
                        if (this.i >= kept.length) break;
                        const A = kept[this.i].A;
                        this.walk = { cur: this.i, loop: [], startV: vs.id(A), ox: A[0], oy: A[1], area: 0, per: 0 };
                    }
                    const w = this.walk;
                    used[w.cur] = 1;
                    const pc = kept[w.cur];
                    w.loop.push(pc);
                    // Area and perimeter accrue AS the loop is walked. Measuring
                    // them afterwards is two more passes over every piece in the
                    // shape, and those passes were the last thing in the bake
                    // with nowhere to yield.
                    w.area += (pc.A[0] - w.ox) * (pc.B[1] - w.oy) - (pc.B[0] - w.ox) * (pc.A[1] - w.oy);
                    if (pc.line || !isFinite(pc.r)) {
                        w.per += Math.hypot(pc.B[0] - pc.A[0], pc.B[1] - pc.A[1]);
                    } else {
                        w.area += pc.r * pc.r * (pc.sweep - Math.sin(pc.sweep));
                        w.per += Math.abs(pc.r * pc.sweep);
                    }
                    n++;
                    const bv = vs.id(kept[w.cur].B);
                    if (bv === w.startV) { this._closeWalk(true); continue; }
                    const cand = outAt.get(bv);
                    let nxt = -1;
                    if (cand) for (const c of cand) if (!used[c]) { nxt = c; break; }
                    if (nxt < 0 || used[nxt]) { this._closeWalk(false); continue; }
                    w.cur = nxt;
                }
                this._tune(now() - t, n);
                if (this.i >= kept.length && !this.walk) break;
                if (now() >= deadline) return;
            }
            this.sub = 2;
        }
        this.sub = 0;
        this._endPhase(PH.FINISH);
    }

    /** Close off the loop being walked, carrying its measurements with it. */
    _closeWalk(closed) {
        const w = this.walk;
        w.loop.closed = closed;
        w.loop.area = w.area / 2;
        w.loop.per = w.per;
        this.loops.push(w.loop);
        this.walk = null;
    }

    // ---- 8. hairlines, orientation, junction balance -----------------------
    _finishPhase(deadline) {
        if (this.sub === 0) {
            // Hairlines go first, before anything counts loops or junctions.
            // O(loops), because the walk already measured each one.
            const before = this.loops.length;
            this.loops = this.loops.filter((l) => l.per > 0 && (2 * Math.abs(l.area)) / l.per > this.r * 1e-3);
            this.hairlines = before - this.loops.length;
            // `openChains` counts the ones that SURVIVED. An unclosed chain is
            // what gets painted shut with a straight line across the shape, so
            // it stays the health check it always was — but a hairline that
            // never closed is a fragment, not an unclosed boundary.
            this.open = this.loops.reduce((n, l) => n + (l.closed === false ? 1 : 0), 0);
            let area = 0;
            for (const l of this.loops) area += l.area;
            this.flip = area < 0;
            this.sub = 1; this.i = 0; this.k = 0; this.chunk = CHUNK0;
            this.oriented = [];
            this.deg = new Map();
        }
        if (this.sub === 1) {
            // One canonical handedness on the way out. Which way the chain wound
            // is an accident of walking the left rail before the right one;
            // every consumer downstream — the boolean, severance, the fill rule
            // — is easier to reason about if solid area is positive, and a
            // GLOBAL flip is the only correction that never disturbs the
            // relative winding of an outer loop and its holes.
            // Over PIECES, with a cursor into the loop as well as across them.
            // Chunking by loop is no chunking at all here: a dense scribble
            // resolves to two loops of three thousand pieces each, so one
            // "chunk" of two items was the entire phase — 20 ms in a single
            // slice, which is the whole thing this machinery exists to avoid.
            while (this.i < this.loops.length) {
                const t = now();
                let n = 0;
                while (n < this.chunk && this.i < this.loops.length) {
                    const src = this.loops[this.i];
                    if (this.k === 0) {
                        const dst = [];
                        dst.closed = src.closed;
                        this.oriented.push(dst);
                    }
                    const dst = this.oriented[this.oriented.length - 1];
                    const take = Math.min(src.length - this.k, this.chunk - n);
                    for (let j = 0; j < take; j++) {
                        // Reversing turns the loop inside out, so it is built
                        // back to front as well as piece by piece.
                        const q = src[this.flip ? src.length - 1 - (this.k + j) : this.k + j];
                        dst.push(this.flip ? reversePiece(q) : q);
                    }
                    this.k += take; n += take;
                    if (this.k >= src.length) { this.i++; this.k = 0; }
                }
                this._tune(now() - t, n);
                if (this.i < this.loops.length && now() >= deadline) return;
            }
            this.sub = 2; this.i = 0; this.k = 0; this.chunk = CHUNK0;
        }
        // Junction balance is the health check that mattered in F20: a boundary
        // that closes by construction has every vertex entered exactly as often
        // as it is left. Counted over the SURVIVORS — a hairline that has been
        // dropped took its own two loose ends with it, and reporting those would
        // be reporting a fragment that is no longer in the shape.
        if (this.vs) {
            while (this.i < this.oriented.length) {
                const t = now();
                let n = 0;
                while (n < this.chunk && this.i < this.oriented.length) {
                    const loop = this.oriented[this.i];
                    const take = Math.min(loop.length - this.k, this.chunk - n);
                    for (let j = 0; j < take; j++) {
                        const q = loop[this.k + j];
                        const a = this.vs.id(q.A), b = this.vs.id(q.B);
                        this.deg.set(a, (this.deg.get(a) || 0) + 1);
                        this.deg.set(b, (this.deg.get(b) || 0) - 1);
                    }
                    this.k += take; n += take;
                    if (this.k >= loop.length) { this.i++; this.k = 0; }
                }
                this._tune(now() - t, n);
                if (this.i < this.oriented.length && now() >= deadline) return;
            }
        }
        this.unbalanced = 0;
        for (const k of this.deg.values()) if (k !== 0) this.unbalanced++;
        this._endPhase(PH.DONE);
    }

    _finish() {
        const loops = this.oriented || this.loops;
        if (this.trivial) {
            this.result = { loops, stats: { ms: +this.busyMs.toFixed(1), trivial: true, arcs: 2 } };
            return;
        }
        this.result = { loops, stats: {
            ms: +this.busyMs.toFixed(1), phases: this.ms,
            samples: this.pts.length, centreArcs: this.centre.length, chainPieces: this.M,
            live: this.N, crossings: this.nX, kept: this.kept.length,
            loops: loops.length, openChains: this.open, unbalanced: this.unbalanced,
            hairlines: this.hairlines,
            arcsPerGap: +(this.centre.length / Math.max(1, this.pts.length - 1)).toFixed(2),
        } };
    }
}

/**
 * The whole bake at once. Identical output to running the job to completion —
 * it IS the job, driven with no budget.
 *
 * @param {number[][]} pts     pen samples
 * @param {number}     width   pen width
 * @param {object}     opts    { tol } centerline arc tolerance (0.125 is the app's)
 * @returns {{loops, stats}}   loops are arrays of arc pieces
 */
export function bakeArcPerimeter(pts, width, opts = {}) {
    const job = new ArcBakeJob(pts, width, opts);
    while (!job.step(Infinity)) { /* run to completion */ }
    return job.result;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------------------
// orientation
// ---------------------------------------------------------------------------

const reversePiece = (p) => (p.line
    ? { line: true, A: p.B, B: p.A, src: p.src, ci: p.ci }
    : { line: false, C: p.C, r: p.r, a0: p.a0 + p.sweep, sweep: -p.sweep, A: p.B, B: p.A, src: p.src, ci: p.ci });
const reverseLoop = (loop) => {
    const out = new Array(loop.length);
    for (let i = 0; i < loop.length; i++) out[i] = reversePiece(loop[loop.length - 1 - i]);
    return out;
};

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

/** Lay resolved loops into a canvas path. `flatTol` guards the float32 rim. */
export function traceLoops(ctx, loops, flatTol = 0) {
    for (const loop of loops) {
        if (!loop.length) continue;
        ctx.moveTo(loop[0].A[0], loop[0].A[1]);
        for (const p of loop) {
            const flat = p.line || !isFinite(p.r)
                || 2 * p.r * Math.pow(Math.sin(p.sweep / 4), 2) <= flatTol;
            if (flat) ctx.lineTo(p.B[0], p.B[1]);
            else ctx.arc(p.C[0], p.C[1], p.r, p.a0, p.a0 + p.sweep, p.sweep < 0);
        }
        ctx.closePath();
    }
}

export { Oracle, Grid };
