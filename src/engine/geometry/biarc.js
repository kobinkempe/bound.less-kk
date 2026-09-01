/**
 * biarc.js — the stroke centerline as circular arcs instead of cubics.
 *
 * WHY. Today a stroke is one cubic per sample gap (`centerlineCubics`, the
 * Two.js cardinal spline). The exact offset of a cubic is not a cubic — there
 * is a square root in the unit normal — so both edges have to be FITTED, and
 * every question asked downstream (where do the edges cross, which fragment is
 * buried) is then asked of an approximation while burial is judged against the
 * exact centerline. Those two disagree by the fit error, and at a shallow
 * crossing the disagreement is amplified by 1/sin θ. That is the family F15
 * and F20 belong to.
 *
 * An arc does not have the problem. The offset of a circular arc is a
 * CONCENTRIC arc: same centre, radius r ± the pen. Exact, closed form, and
 * drawable by SVG (`A`) and canvas (`ctx.arc`) without conversion. Crossings
 * become circle-circle intersections — one quadratic, no Newton polish.
 *
 * WHY TWO ARCS. One arc cannot replace one cubic: an arc through two points
 * with the tangent fixed at BOTH ends is over-determined. Two arcs meeting
 * tangentially have exactly the freedom needed. That is a biarc, and it costs
 * two arcs per gap where today costs one cubic — but it costs ZERO fitted
 * offset pieces, where today costs ten or more per gap per side.
 *
 * WHAT IS PRESERVED. The tangents come from the cardinal spline the app
 * already draws, so the chain passes through every sample and leaves every
 * sample in the same direction as today. Only the shape strictly BETWEEN two
 * samples can differ, and `chainFor` subdivides any gap where that difference
 * exceeds `tol` — which is where the pen turned hard. Both curves are
 * tangent-continuous and neither is curvature-continuous, so this does not
 * change the smoothness class users already see: no creases either way.
 *
 * NOTHING HERE BAKES. This is the centerline only.
 */
import { cubicAt, cubicTangent, splitCubic } from "./curveOutline";
import { controlsFor } from "./polyline";

const TAU = Math.PI * 2;

/**
 * An arc piece is `{ line:false, C, r, a0, sweep, A, B }` or, where the three
 * points are collinear, `{ line:true, A, B }`. `A`/`B` are carried explicitly
 * rather than recomputed from the angles: consecutive pieces must share
 * endpoint coordinates BIT FOR BIT or a fill leaks at the seam, and
 * `C + r·(cos a, sin a)` does not reproduce the point it was derived from.
 */

/**
 * The unique arc leaving `A` along unit tangent `TA` and passing through `B`.
 *
 * Both end tangents are stored. The far one is the REFLECTION of `TA` across
 * the chord — a circle's chord makes equal angles with the tangents at its two
 * ends — which is exact arithmetic. Recovering it from `a0 + sweep` instead
 * costs about 1e-6 radians on the huge-radius arcs a nearly straight gap
 * produces, and a junction that agrees only to 1e-6 is a junction the stitcher
 * has to be told to trust.
 */
export function arcThrough(A, TA, B) {
    const vx = B[0] - A[0], vy = B[1] - A[1];
    const vv = vx * vx + vy * vy;
    if (vv < 1e-24) return { line: true, A, B, T0: TA, T1: TA, len: 0 };
    const Nx = -TA[1], Ny = TA[0];              // left normal
    const den = 2 * (vx * Nx + vy * Ny);
    const L = Math.sqrt(vv);
    // Straight within rounding. The quantity to test is the SAGITTA — how far
    // the arc bows off its chord — and that is exactly `den / 8`, since
    // R = |v|^2 / den and sagitta ~ |v|^2 / (8R).
    //
    // The earlier test compared `den` against `vv`, a length against a squared
    // length, which is both scale-dependent and far too strict. Too strict is
    // not harmless: a gap that is collinear to one part in 1e8 — which is what
    // the spline's DEGENERATE END HANDLES produce, because the tangent there
    // comes from a central difference rather than a control point — came back
    // as a real arc of radius 8e8 with a centre 1.7e9 units away. It bows by
    // 2e-8 of a unit, so it is a line by any measure that matters, but canvas
    // and SVG rasterise in float32, where the quantum at 1.7e9 is 199 UNITS.
    // The renderer then placed the arc's start hundreds of units from its
    // stored endpoint and joined the two with a straight line: a huge visible
    // spur at each end of an otherwise straight stroke.
    //
    // 1e-6 of the chord caps the radius at about 1.25e5 chords. A genuinely
    // gentle curve is nowhere near that — a 12-unit gap on a 100,000-unit
    // radius still bows 15x more than this — so nothing real is flattened.
    if (Math.abs(den) < 8e-6 * L) return { line: true, A, B, T0: TA, T1: TA, len: L };
    const ux = vx / L, uy = vy / L;
    const dp = 2 * (TA[0] * ux + TA[1] * uy);
    const T1 = [dp * ux - TA[0], dp * uy - TA[1]];
    const R = vv / den;                         // SIGNED: >0 turns left
    const C = [A[0] + R * Nx, A[1] + R * Ny];
    const r = Math.abs(R);
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
    const a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
    let sweep = a1 - a0;
    if (R > 0) { while (sweep <= 0) sweep += TAU; while (sweep > TAU) sweep -= TAU; }
    else { while (sweep >= 0) sweep -= TAU; while (sweep < -TAU) sweep += TAU; }
    return { line: false, C, r, a0, sweep, A, B, T0: TA, T1, len: r * Math.abs(sweep) };
}

export function arcPoint(a, s) {
    // The ends come from the stored points, never from the angles. On a
    // near-straight gap the radius runs to 1e5 and up, and `C + r·(cos, sin)`
    // then reproduces its own endpoint only to about 1e-6 — a gap that would
    // be welded shut downstream by the very repair pass this representation
    // exists to make unnecessary.
    if (s <= 0) return [a.A[0], a.A[1]];
    if (s >= 1) return [a.B[0], a.B[1]];
    if (a.line) return [a.A[0] + (a.B[0] - a.A[0]) * s, a.A[1] + (a.B[1] - a.A[1]) * s];
    const th = a.a0 + a.sweep * s;
    return [a.C[0] + a.r * Math.cos(th), a.C[1] + a.r * Math.sin(th)];
}

export function arcTangent(a, s) {
    if (s <= 0 && a.T0) return a.T0;
    if (s >= 1 && a.T1) return a.T1;
    if (a.line) {
        const dx = a.B[0] - a.A[0], dy = a.B[1] - a.A[1], L = Math.hypot(dx, dy);
        return L > 0 ? [dx / L, dy / L] : [1, 0];
    }
    const th = a.a0 + a.sweep * s, g = a.sweep > 0 ? 1 : -1;
    return [-Math.sin(th) * g, Math.cos(th) * g];
}

/** Distance from a point to the arc piece (not to its full circle). */
export function arcDist(a, p) {
    if (a.line) {
        const dx = a.B[0] - a.A[0], dy = a.B[1] - a.A[1], L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a.A[0]) * dx + (p[1] - a.A[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return Math.hypot(p[0] - (a.A[0] + t * dx), p[1] - (a.A[1] + t * dy));
    }
    const th = Math.atan2(p[1] - a.C[1], p[0] - a.C[0]);
    // `a0` can sit outside [-pi,pi] once an arc has been reversed, so normalise
    // the DIFFERENCE into [0,TAU) — trusting either angle's branch reports a
    // point in the middle of the arc as being off its end, and the fallback
    // then returns a distance-to-endpoint the size of the whole arc.
    let d = th - a.a0;
    d -= TAU * Math.floor(d / TAU);
    const inside = a.sweep > 0 ? (d <= a.sweep) : ((d - TAU) >= a.sweep);
    if (inside) return Math.abs(Math.hypot(p[0] - a.C[0], p[1] - a.C[1]) - a.r);
    return Math.min(Math.hypot(p[0] - a.A[0], p[1] - a.A[1]),
                    Math.hypot(p[0] - a.B[0], p[1] - a.B[1]));
}

/**
 * The two arcs joining (P0,T0) to (P1,T1), tangentially at both ends and at
 * their own junction. The joint is placed by the equal-tangent-length rule
 * (d1 = d2), the standard choice: it is the one that stays symmetric under
 * reversing the stroke, so drawing a shape and drawing it backwards give the
 * same curve.
 */
export function biarc(P0, T0, P1, T1) {
    const vx = P1[0] - P0[0], vy = P1[1] - P0[1];
    const vv = vx * vx + vy * vy;
    if (vv < 1e-24) return [];
    const tx = T0[0] + T1[0], ty = T0[1] + T1[1];
    const vt = vx * tx + vy * ty;
    const dot = T0[0] * T1[0] + T0[1] * T1[1];
    const den = 2 * (1 - dot);
    let d;
    if (den < 1e-9) {
        // Tangents parallel: the quadratic degenerates to a linear equation.
        d = Math.abs(vt) > 1e-12 ? vv / (2 * vt) : Math.sqrt(vv) / 2;
    } else {
        d = (-vt + Math.sqrt(Math.max(vt * vt + den * vv, 0))) / den;
    }
    if (!(d > 0) || !isFinite(d)) d = Math.sqrt(vv) / 3;   // hairpin fallback
    const J = [(P0[0] + P1[0]) / 2 + d * (T0[0] - T1[0]) / 2,
               (P0[1] + P1[1]) / 2 + d * (T0[1] - T1[1]) / 2];
    const a1 = arcThrough(P0, T0, J);
    // The second arc is built BACKWARDS from P1 (where its tangent is known)
    // and then reversed, so both ends are exact by construction rather than
    // one end being exact and the other landing wherever the arithmetic puts it.
    const b = arcThrough(P1, [-T1[0], -T1[1]], J);
    // Reversing flips the stored tangents, and the joint's tangent is then
    // snapped to the one the first arc reports — the two are the same direction
    // analytically, and making them the same NUMBER is what lets a junction be
    // trusted without a tolerance.
    const a2 = b.line
        ? { line: true, A: J, B: P1, T0: a1.T1, T1, len: b.len }
        : { line: false, C: b.C, r: b.r, a0: b.a0 + b.sweep, sweep: -b.sweep,
            A: J, B: P1, T0: a1.T1, T1, len: b.len };
    return [a1, a2];
}

/** Worst distance from the cubic to the arcs meant to stand in for it. */
export function gapError(cubic, arcs, probes = 16) {
    let worst = 0;
    for (let j = 1; j < probes; j++) {
        const p = cubicAt(cubic, j / probes);
        let best = Infinity;
        for (const a of arcs) { const d = arcDist(a, p); if (d < best) best = d; }
        if (best > worst) worst = best;
    }
    return worst;
}

const MAX_SPLIT = 16;

/**
 * One gap's worth of arcs. Where the pen turned hard enough that two arcs
 * cannot follow the cubic within `tol`, the gap is halved and each half gets
 * its own biarc — and because the left half's start tangent IS the parent's
 * start tangent, splitting never introduces a kink.
 *
 * `tol <= 0` or a non-finite tol means "never split": the plain two-arcs-per-gap
 * chain, which is what the shape looks like with no safety net at all.
 */
export function arcsForGap(cubic, tol, out = [], depth = 0) {
    const T0 = cubicTangent(cubic, 0), T1 = cubicTangent(cubic, 1);
    const pair = biarc(cubic[0], T0, cubic[3], T1);
    if (!pair.length) return out;                       // zero-length gap
    const split = tol > 0 && isFinite(tol) && depth < MAX_SPLIT;
    if (!split || gapError(cubic, pair) <= tol) { out.push(pair[0], pair[1]); return out; }
    const [l, r] = splitCubic(cubic, 0.5);
    arcsForGap(l, tol, out, depth + 1);
    arcsForGap(r, tol, out, depth + 1);
    return out;
}

/**
 * A REPEATED SAMPLE HAS NO SPLINE, and pretending otherwise severs the outline.
 *
 * `controlsFor` gives up on an anchor whose neighbour is nearer than this and
 * collapses both of its handles onto the point. The two cubics either side then
 * have a vanishing derivative at the joint they share, and `cubicTangent`
 * recovers a limit direction for each from its OWN control polygon — two
 * different answers. The centerline gets a kink at a joint every consumer here
 * is entitled to assume is smooth: `ChainBuilder` takes the shared rail vertex
 * from one side's tangent and hands it to BOTH neighbouring pieces, so across a
 * 163.7 degree kink the piece before it ended 11.9 units — 2r, the whole pen —
 * from where its own arc ends. The boundary is severed there, the stitch cannot
 * close it, and the stroke is sealed shut with a chord across its own middle.
 *
 * Measured on a phone: two of five ordinary pen strokes, each drawn with a pause
 * in the middle. A touch digitizer repeats a coordinate whenever the finger
 * rests, where a mouse reports nothing at all — which is why this never appeared
 * on the desktop. Dropping the repeat costs nothing: on the three strokes that
 * had none away from pen-down, the resolved area was identical to the decimal.
 *
 * The threshold is `controlsFor`'s own rather than a judgement of its own.
 * Keeping only samples at least this far apart IS the condition under which no
 * interior anchor can collapse — so the guarantee is by construction, not by
 * margin.
 */
export const MIN_SPAN = 0.0001;

/**
 * The samples with every repeat dropped, in order. Returns the original array
 * when there is nothing to drop, which is the overwhelmingly common case.
 */
export function distinctSamples(pts) {
    let first = -1;
    for (let i = 1; i < pts.length; i++) {
        if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < MIN_SPAN) { first = i; break; }
    }
    if (first < 0) return pts;
    const out = pts.slice(0, first);
    for (let i = first; i < pts.length; i++) {
        const q = out[out.length - 1];
        if (q && Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) < MIN_SPAN) continue;
        out.push(pts[i]);
    }
    return out;
}

/** The cardinal spline's cubics — the reference this chain is measured against. */
export function splineCubics(raw) {
    const out = [];
    const pts = distinctSamples(raw);
    const n = pts.length;
    if (n < 2) return out;
    if (n === 2) { out.push([pts[0], pts[0], pts[1], pts[1]]); return out; }
    const last = n - 1, ctrl = new Array(n);
    for (let i = 0; i < n; i++) ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
    for (let i = 1; i < n; i++) out.push([pts[i - 1], ctrl[i - 1].right, ctrl[i].left, pts[i]]);
    return out;
}

/**
 * Whole stroke in one pass. `{ gaps, arcs, stats }`.
 *
 * `measure: false` skips the how-far-from-the-old-curve pass, which is a second
 * 24-probe sweep over every gap and exists only to fill a readout. It was 40%
 * of the wall clock of a bake that does not need the number.
 */
export function chainFor(pts, opts = {}) {
    const tol = opts.tol == null ? 0 : opts.tol;
    const measure = opts.measure !== false;
    const cubics = splineCubics(pts);
    const gaps = [], arcs = [];
    let split = 0, worst = 0, minR = Infinity;
    for (const c of cubics) {
        const g = arcsForGap(c, tol);
        if (g.length > 2) split++;
        if (measure) {
            const e = gapError(c, g, 24);
            if (e > worst) worst = e;
        }
        for (const a of g) if (!a.line && a.r < minR) minR = a.r;
        gaps.push(g);
        for (const a of g) arcs.push(a);
    }
    return { gaps, arcs, cubics, stats: {
        samples: pts.length, gaps: cubics.length, arcs: arcs.length, splitGaps: split,
        worstDev: worst, minRadius: isFinite(minR) ? minR : null,
    } };
}

/**
 * The same thing built a sample at a time, which is how a pen delivers points.
 *
 * A sample changes the cardinal spline's handles at its two nearest neighbours
 * and nowhere else, so exactly the last two gaps are rebuilt per sample. Every
 * older gap is already final — this is O(1) per point, not O(n).
 */
export class BiarcPen {
    constructor(opts = {}) {
        this.tol = opts.tol == null ? 0 : opts.tol;
        this.pts = [];
        this.ctrl = [];
        this.gaps = [];          // gaps[i] = arcs from pts[i] to pts[i+1]
    }
    addSample(p) {
        const pts = this.pts;
        // The same rule the batch chain applies in `distinctSamples`, applied one
        // sample at a time. It has to be the same rule: biarc.test.js pins the
        // live chain and the batch chain as identical, and the live pen is what
        // the renderer paints until the bake lands.
        const prev = pts[pts.length - 1];
        if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < MIN_SPAN) return;
        pts.push([p[0], p[1]]);
        const n = pts.length;
        if (n < 2) return;
        const last = n - 1;
        // Adding pts[last] changes the handles at last-1 and creates them at last.
        for (let i = Math.max(0, last - 1); i <= last; i++) {
            this.ctrl[i] = controlsFor(pts[Math.max(i - 1, 0)], pts[i], pts[Math.min(i + 1, last)]);
        }
        if (n === 2) this.ctrl[0] = controlsFor(pts[0], pts[0], pts[1]);
        // Gaps last-2 and last-1 both touch a handle that just moved.
        for (let g = Math.max(0, last - 2); g <= last - 1; g++) {
            this.gaps[g] = arcsForGap(this._cubic(g), this.tol);
        }
        this.gaps.length = last;
    }
    _cubic(g) {
        const pts = this.pts;
        if (pts.length === 2) return [pts[0], pts[0], pts[1], pts[1]];
        return [pts[g], this.ctrl[g].right, this.ctrl[g + 1].left, pts[g + 1]];
    }
    /** Flat arc list. Rebuilt on demand — the pen path itself walks `gaps`. */
    arcs() { const out = []; for (const g of this.gaps) for (const a of g) out.push(a); return out; }
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

/** How far the arc bows off its own chord. Stable for tiny sweeps. */
export function arcSagitta(a) {
    if (a.line) return 0;
    const s = Math.sin(a.sweep / 4);
    return 2 * a.r * s * s;
}

/**
 * Should this piece be DRAWN as a line?
 *
 * Separate from whether it IS a line. The geometry can hold an arc of any
 * radius quite happily in doubles, but both canvas and SVG rasterise in
 * float32, where a centre a few million units away cannot place its own rim to
 * better than a unit. An arc that bows less than `flatTol` is a line on screen
 * anyway, so drawing it as one costs nothing and avoids handing the rasteriser
 * a number it cannot hold. Pass `flatTol` in world units — the caller knows the
 * zoom, this module does not.
 */
const drawFlat = (a, flatTol) => a.line || !isFinite(a.r) || arcSagitta(a) <= flatTol;

/** Lay the chain into a canvas path. `ctx.arc` rasterises the true arc. */
export function tracePath(ctx, gaps, flatTol = 0) {
    let started = false;
    for (const g of gaps) {
        for (const a of g) {
            if (!started) { ctx.moveTo(a.A[0], a.A[1]); started = true; }
            if (drawFlat(a, flatTol)) ctx.lineTo(a.B[0], a.B[1]);
            else ctx.arc(a.C[0], a.C[1], a.r, a.a0, a.a0 + a.sweep, a.sweep < 0);
        }
    }
    return started;
}

/**
 * One arc as cubics, for consumers that only speak cubics (Two.js, and the
 * existing loop pipeline). Quarter-circle pieces keep the standard 4/3·tan(θ/4)
 * handle error under 2e-4·r, which is far inside display tolerance — but note
 * this is a RENDERING conversion. The arc stays the geometric truth.
 */
export function arcToCubics(a) {
    if (a.line) return [[a.A, a.A, a.B, a.B]];
    const n = Math.max(1, Math.ceil(Math.abs(a.sweep) / (Math.PI / 2)));
    const step = a.sweep / n, k = (4 / 3) * Math.tan(step / 4);
    const out = [];
    for (let i = 0; i < n; i++) {
        const s0 = a.a0 + step * i, s1 = s0 + step;
        const p0 = i === 0 ? a.A : [a.C[0] + a.r * Math.cos(s0), a.C[1] + a.r * Math.sin(s0)];
        const p1 = i === n - 1 ? a.B : [a.C[0] + a.r * Math.cos(s1), a.C[1] + a.r * Math.sin(s1)];
        out.push([p0,
            [p0[0] - k * a.r * Math.sin(s0), p0[1] + k * a.r * Math.cos(s0)],
            [p1[0] + k * a.r * Math.sin(s1), p1[1] - k * a.r * Math.cos(s1)],
            p1]);
    }
    return out;
}

/**
 * The exact offset of an arc: the SAME centre, radius ± the pen. This is the
 * whole point of the representation, so it is one line of arithmetic and there
 * is nothing to fit. A negative radius means the arc is tighter than the pen
 * and this side has inverted — a real self-overlap, reported rather than hidden.
 */
export function offsetArc(a, pen, side) {
    if (a.line) {
        const dx = a.B[0] - a.A[0], dy = a.B[1] - a.A[1], L = Math.hypot(dx, dy);
        if (!(L > 0)) return null;
        const nx = -dy / L * pen * side, ny = dx / L * pen * side;
        return { line: true, A: [a.A[0] + nx, a.A[1] + ny], B: [a.B[0] + nx, a.B[1] + ny], inverted: false };
    }
    const grow = a.sweep > 0 ? -side : side;
    const rr = a.r + grow * pen;
    const inverted = rr < 0;
    const r = Math.abs(rr);
    const a0 = inverted ? a.a0 + Math.PI : a.a0;
    const at = (th) => [a.C[0] + r * Math.cos(th), a.C[1] + r * Math.sin(th)];
    return { line: false, C: a.C, r, a0, sweep: a.sweep, A: at(a0), B: at(a0 + a.sweep), inverted };
}
