/**
 * The selection indicator's geometry, on ARCS.
 *
 * Nothing here flattens. The ants run along the pieces the renderer is already
 * drawing — arcs and lines, clipped to their tiles by the exact arc boolean —
 * and everything the indicator needs from them is analytic: a piece's length
 * is r·|sweep| or a hypot, a seam is a straight piece lying on the rectangle
 * that cut it, an arc goes to the browser as an SVG arc exactly as the ink
 * does, and where the ink meets the side of the screen is found by crossing the
 * boundary with that side's line and counting winding. Kobin, 2026-09-03:
 * "I don't think we need to flatten anything ... we're just passing the objects
 * that we already have saved to the renderer."
 *
 * A piece is `{ A, B }` with `line: true`, or `{ A, B, C, r, a0, sweep }` — the
 * arc from A to B about centre C, starting at angle a0 and turning through
 * `sweep` (signed). Consecutive pieces of a loop share endpoints exactly.
 *
 * A piece may also be a CUBIC, `[p0, p1, p2, p3]`: that is what the capsule
 * outline of a stroke that has not yet resolved to a perimeter is made of
 * (`curveOutline.strokeLoops`), and there are only ever a few of those on
 * screen. A cubic's length is estimated, its crossings with a line are found
 * by sampling and bisection, and it never lies along a cut.
 */
import { chordCubic, planArc } from "./arcShape";

const isCubic = (p) => Array.isArray(p);
const isLine = (p) => !!p.line || !isFinite(p.r) || !(p.r > 0);
const startOf = (p) => (isCubic(p) ? p[0] : p.A);

/** Length of one piece. A cubic's is the usual estimate, the mean of its chord and its control polygon. */
export function pieceLength(p) {
    if (isCubic(p)) {
        const chord = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]);
        const poly = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) + Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]);
        return (chord + poly) / 2;
    }
    if (isLine(p)) return Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1]);
    return Math.abs(p.sweep) * p.r;
}

/** Length of a run (or a whole loop). */
export function runLength(pieces) {
    let s = 0;
    for (const p of pieces) s += pieceLength(p);
    return s;
}

/**
 * Does this piece lie ALONG one side of `rect` (`{x0,y0,x1,y1}`), within
 * `eps`? Only a straight piece can: an arc crosses a line or grazes it, it
 * never runs along one. The boolean that clips a shape to its tile emits the
 * tile's own sides as line pieces, so a piece that lies on one is a cut, not
 * an edge the ink actually has — a tile seam, or the window a re-homed piece
 * was ceded through.
 */
export function onRectEdge(p, rect, eps) {
    if (isCubic(p) || !isLine(p)) return false;
    const [ax, ay] = p.A, [bx, by] = p.B;
    if (Math.abs(ax - rect.x0) <= eps && Math.abs(bx - rect.x0) <= eps) return true;
    if (Math.abs(ax - rect.x1) <= eps && Math.abs(bx - rect.x1) <= eps) return true;
    if (Math.abs(ay - rect.y0) <= eps && Math.abs(by - rect.y0) <= eps) return true;
    if (Math.abs(ay - rect.y1) <= eps && Math.abs(by - rect.y1) <= eps) return true;
    return false;
}

/**
 * One loop split into runs at its seams. `rects` is `[{ rect, eps }]`. A loop
 * with no seam is one closed run; otherwise the runs are open, each the stretch
 * of free edge between two cuts, and the ants stop at the cut and pick up again
 * on the neighbouring piece — which is what "no ants on the tile edge" means.
 */
export function loopRuns(loop, rects) {
    const n = loop.length;
    if (!n) return [];
    let any = false;
    const seam = new Array(n);
    for (let i = 0; i < n; i++) {
        let s = false;
        for (const r of rects) if (onRectEdge(loop.at(i), r.rect, r.eps)) { s = true; break; }
        seam[i] = s;
        if (s) any = true;
    }
    if (!any) return [{ pieces: loop.slice(), closed: true }];
    let start = 0;
    while (!seam[start]) start++;
    const runs = [];
    let cur = null;
    for (let k = 1; k <= n; k++) {
        const i = (start + k) % n;
        if (seam[i]) {
            if (cur) runs.push({ pieces: cur, closed: false });
            cur = null;
        } else {
            if (!cur) cur = [];
            cur.push(loop.at(i));
        }
    }
    if (cur) runs.push({ pieces: cur, closed: false });
    return runs;
}

/**
 * SVG path data for a run, with every coordinate taken relative to `(ox, oy)`
 * and scaled by `k` — the same fold the renderer applies to the ink, so the
 * numbers that reach the browser are screen-sized however deep the frame.
 * Arcs go exactly as the ink does (Renderer `pushArcPiece`, arcShape
 * `planArc`): the arc command while its float32 centre is within a quarter
 * pixel at this scale, else the cubics the sixth-root law demands, from the
 * endpoints and sweep alone. The scale handed to the plan is `k` times the
 * quarter-octave a decision is allowed to drift before it is remade, so the
 * plan holds for the life of the decision. Lines as lines; a capsule's cubics
 * as cubics.
 */
export function runPathData(run, ox, oy, k, plan = { enter: k * 1.25, tol: 0.25 }) {
    // toFixed keeps the sign of a negative zero ("-0.00"); the browser does not
    // care, a byte-compare of path data does.
    const fx = (v) => { const s = v.toFixed(2); return s === "-0.00" ? "0.00" : s; };
    const X = (p) => fx((p[0] - ox) * k), Y = (p) => fx((p[1] - oy) * k);
    const pieces = run.pieces;
    if (!pieces.length) return "";
    const s0 = startOf(pieces[0]);
    let d = "M" + X(s0) + "," + Y(s0);
    for (const p of pieces) {
        if (isCubic(p)) { d += "C" + X(p[1]) + "," + Y(p[1]) + " " + X(p[2]) + "," + Y(p[2]) + " " + X(p[3]) + "," + Y(p[3]); continue; }
        if (isLine(p)) { d += "L" + X(p.B) + "," + Y(p.B); continue; }
        const pl = planArc(p, plan);
        if (pl.command === "C") {
            for (const q of pl.parts) {
                const c = chordCubic(q);
                d += "C" + X(c[1]) + "," + Y(c[1]) + " " + X(c[2]) + "," + Y(c[2]) + " " + X(c[3]) + "," + Y(c[3]);
            }
            continue;
        }
        const r = fx(Math.abs(p.r) * k), sf = p.sweep > 0 ? 1 : 0;
        for (const q of pl.parts) d += "A" + r + "," + r + " 0 0," + sf + " " + X(q.B) + "," + Y(q.B);
    }
    return run.closed ? d + "Z" : d;
}

/** Axis-aligned bounds of loops: `{x0,y0,x1,y1}`, arcs included exactly. */
export function loopsBounds(loops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (x, y) => {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    };
    for (const loop of loops) {
        for (const p of loop) {
            // A cubic lies within the hull of its control points.
            if (isCubic(p)) { for (const q of p) take(q[0], q[1]); continue; }
            take(p.A[0], p.A[1]); take(p.B[0], p.B[1]);
            if (isLine(p)) continue;
            // An arc reaches past its chord wherever it passes a cardinal angle.
            for (let q = 0; q < 4; q++) {
                const th = q * Math.PI / 2;
                if (arcHasAngle(p, th)) take(p.C[0] + p.r * Math.cos(th), p.C[1] + p.r * Math.sin(th));
            }
        }
    }
    return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}

const TAU = Math.PI * 2;
const norm = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

/**
 * Where along the arc's sweep angle `th` falls: the offset from the start
 * (0 at the start, |sweep| at the end), or -1 when the arc does not pass it.
 * An angle a rounding error short of the start reads as the start, not as a
 * full turn away from it.
 */
const ANG_EPS = 1e-9;
function arcOffset(p, th) {
    let d = p.sweep >= 0 ? norm(th - p.a0) : norm(p.a0 - th);
    if (d > TAU - ANG_EPS) d = 0;
    const span = Math.abs(p.sweep);
    if (d <= span + ANG_EPS) return d;
    return -1;
}
function arcHasAngle(p, th) { return arcOffset(p, th) >= 0; }

/**
 * Where the ink meets the SIDES of `rect`.
 *
 * For each side, the boundary's crossings of that side's whole line are
 * collected with their direction, sorted along the line, and walked: the
 * winding number starts at zero far out (the ink is bounded) and changes by
 * the crossing's sign at each, and wherever it is non-zero the line is inside
 * the ink. The intervals that fall within the side are the spans. Arcs are
 * crossed with the line analytically, and a vertex on the line is counted
 * exactly once by the usual half-open rule (a point on the line is on the low
 * side; a crossing counts where the sides before and after differ).
 *
 * The line scanned is `inset` INSIDE the side, not on it. A boundary that
 * runs exactly along the side — the ink stopping at the edge of the view — is
 * degenerate for a winding scan, and the question is anyway whether the ink
 * just inside the view reaches the edge, not whether ink outside touches it.
 * A hair in from the edge answers that.
 *
 * `covered` is the ink flooding the view: every side spanned end to end, which
 * happens with crossings far outside or with none at all — the latter decided
 * by `inside(centre)`, supplied by the caller.
 *
 * Returns `{ left, right, top, bottom, covered }`, left/right as y-intervals
 * and top/bottom as x-intervals, each `[[a, b], ...]` already clipped to the
 * side.
 */
export function edgeSpans(loops, rect, inside, inset = 0) {
    const cross = { left: [], right: [], top: [], bottom: [] };
    for (const loop of loops) {
        for (const p of loop) {
            crossVertical(p, rect.x0 + inset, cross.left);
            crossVertical(p, rect.x1 - inset, cross.right);
            crossHorizontal(p, rect.y0 + inset, cross.top);
            crossHorizontal(p, rect.y1 - inset, cross.bottom);
        }
    }
    const out = { left: [], right: [], top: [], bottom: [], covered: false };
    const any = cross.left.length || cross.right.length || cross.top.length || cross.bottom.length;
    if (!any) {
        if (inside && inside([(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2])) {
            out.covered = true;
            out.left.push([rect.y0, rect.y1]); out.right.push([rect.y0, rect.y1]);
            out.top.push([rect.x0, rect.x1]); out.bottom.push([rect.x0, rect.x1]);
        }
        return out;
    }
    out.left = spansOf(cross.left, rect.y0, rect.y1);
    out.right = spansOf(cross.right, rect.y0, rect.y1);
    out.top = spansOf(cross.top, rect.x0, rect.x1);
    out.bottom = spansOf(cross.bottom, rect.x0, rect.x1);
    const tol = 4 * inset + 1e-9 * Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0);
    const full = (spans, lo, hi) => spans.length === 1 && spans[0][0] <= lo + tol && spans[0][1] >= hi - tol;
    out.covered = full(out.left, rect.y0, rect.y1) && full(out.right, rect.y0, rect.y1)
        && full(out.top, rect.x0, rect.x1) && full(out.bottom, rect.x0, rect.x1);
    return out;
}

/** Crossings `[pos, dir]` sorted along the line into inside-intervals within [lo, hi]. */
function spansOf(cross, lo, hi) {
    if (!cross.length) return [];
    cross.sort((a, b) => a[0] - b[0]);
    const out = [];
    let w = 0;
    for (let i = 0; i < cross.length; i++) {
        w += cross[i][1];
        if (w === 0 || i === cross.length - 1) continue;
        const a = Math.max(lo, cross[i][0]), b = Math.min(hi, cross[i + 1][0]);
        if (b > a) {
            const last = out[out.length - 1];
            if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
            else out.push([a, b]);
        }
    }
    return out;
}

// Half-open side test: a point exactly on the line counts as the low side, so
// a vertex on the line is crossed by exactly one of the two pieces that meet
// there.
const above = (v, line) => v > line;

/** Crossings of piece `p` with the vertical line x = X, pushed as [y, dir]. */
function crossVertical(p, X, out) {
    if (isCubic(p)) { crossCubic(p, 0, X, out); return; }
    if (isLine(p)) {
        const [ax, ay] = p.A, [bx, by] = p.B;
        if (above(ax, X) === above(bx, X)) return;
        const t = (X - ax) / (bx - ax);
        out.push([ay + t * (by - ay), bx > ax ? 1 : -1]);
        return;
    }
    const dx = X - p.C[0];
    if (Math.abs(dx) > p.r) return;
    const base = Math.acos(Math.max(-1, Math.min(1, dx / p.r)));
    for (const th of base === 0 || Math.abs(base - Math.PI) < 1e-15 ? [base] : [base, -base]) {
        // Direction of travel along x at this angle: d/dθ of (C + r cos θ) times the sweep's sign.
        const vx = -Math.sin(th) * Math.sign(p.sweep);
        if (!arcCrossCounts(p, th, vx)) continue;
        out.push([p.C[1] + p.r * Math.sin(th), vx > 0 ? 1 : -1]);
    }
}

/**
 * The half-open rule for an arc meeting a line at angle `th`, where `v` is the
 * arc's velocity across the line there. Away from its ends an arc that is not
 * grazing crosses. At its START the point is on the line (the low side) and the
 * crossing counts if the arc leaves to the high side; at its END it counts if
 * the arc arrived from the high side. The line rule says the same thing about a
 * vertex, so a vertex on the line is counted exactly once whichever pieces meet
 * there.
 */
function arcCrossCounts(p, th, v) {
    if (v === 0) return false;                                   // grazing
    const off = arcOffset(p, th);
    if (off < 0) return false;
    const span = Math.abs(p.sweep);
    const atStart = off < ANG_EPS, atEnd = Math.abs(off - span) < ANG_EPS;
    if (atStart && v > 0) return true;
    if (atEnd && v < 0) return true;
    return !atStart && !atEnd;
}

/**
 * Crossings of a cubic with the line `coord = V` (axis 0 for x, 1 for y):
 * sampled along t with the same half-open rule as a polyline's vertices, each
 * sign change then bisected to a hair. Pushes `[other coordinate, dir]`.
 */
function crossCubic(c, axis, V, out) {
    const at = (t) => {
        const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
        return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
    };
    const N = 24;
    let prev = at(0), prevAbove = above(prev[axis], V);
    for (let i = 1; i <= N; i++) {
        const t1 = i / N;
        const cur = at(t1), curAbove = above(cur[axis], V);
        if (curAbove !== prevAbove) {
            let lo = (i - 1) / N, hi = t1, loAbove = prevAbove;
            for (let k = 0; k < 40; k++) {
                const mid = (lo + hi) / 2;
                if (above(at(mid)[axis], V) === loAbove) lo = mid; else hi = mid;
            }
            const q = at((lo + hi) / 2);
            out.push([q[1 - axis], curAbove ? 1 : -1]);
        }
        prev = cur; prevAbove = curAbove;
    }
}

/** Crossings of piece `p` with the horizontal line y = Y, pushed as [x, dir]. */
function crossHorizontal(p, Y, out) {
    if (isCubic(p)) { crossCubic(p, 1, Y, out); return; }
    if (isLine(p)) {
        const [ax, ay] = p.A, [bx, by] = p.B;
        if (above(ay, Y) === above(by, Y)) return;
        const t = (Y - ay) / (by - ay);
        out.push([ax + t * (bx - ax), by > ay ? 1 : -1]);
        return;
    }
    const dy = Y - p.C[1];
    if (Math.abs(dy) > p.r) return;
    const base = Math.asin(Math.max(-1, Math.min(1, dy / p.r)));
    const cands = Math.abs(Math.abs(base) - Math.PI / 2) < 1e-15 ? [base] : [base, Math.PI - base];
    for (const th of cands) {
        const vy = Math.cos(th) * Math.sign(p.sweep);
        if (!arcCrossCounts(p, th, vy)) continue;
        out.push([p.C[0] + p.r * Math.cos(th), vy > 0 ? 1 : -1]);
    }
}

/**
 * Is `pt` inside the ink bounded by `loops`? Non-zero winding, from the
 * crossings of the ray running from the point to +x — the same crossing code
 * the edge scan uses, so lines, arcs and cubics are all answered.
 */
export function insideLoops(loops, pt) {
    const cross = [];
    for (const loop of loops) for (const p of loop) crossHorizontal(p, pt[1], cross);
    let w = 0;
    for (const [x, dir] of cross) if (x > pt[0]) w += dir;
    return w !== 0;
}

// ---- cutting a run to a window ----------------------------------------------
//
// Off-screen ink is what the rasteriser must never be asked to dash: the
// 2026-08-22 stall was 350,958 dashes on a rectangle of which a few hundred
// were on screen. The pieces the renderer draws are cut to TILES, and a tile
// can be many screens across, so a run is cut again here to the window the
// indicator retains. This is a cut of the BOUNDARY, not of the ink, so it
// needs no boolean: a line is cut by Liang–Barsky, an arc at the angles where
// it crosses the window's sides, and a cubic (rare, and short) is kept whole
// when its hull meets the window.

const samePt = (a, b) => Math.abs(a[0] - b[0]) <= 1e-9 * (1 + Math.abs(a[0])) && Math.abs(a[1] - b[1]) <= 1e-9 * (1 + Math.abs(a[1]));
const endOf = (p) => (isCubic(p) ? p[3] : p.B);
const inRect = (q, r) => q[0] >= r.x0 && q[0] <= r.x1 && q[1] >= r.y0 && q[1] <= r.y1;

/** Offsets along the arc (0..|sweep|, interior only) where it crosses coord `axis` = V. */
function arcSideOffsets(p, axis, V, out) {
    const d = V - p.C[axis];
    if (Math.abs(d) > p.r) return;
    const base = axis === 0 ? Math.acos(Math.max(-1, Math.min(1, d / p.r))) : Math.asin(Math.max(-1, Math.min(1, d / p.r)));
    const cands = axis === 0 ? [base, -base] : [base, Math.PI - base];
    for (const th of cands) {
        const off = arcOffset(p, th);
        if (off > ANG_EPS && off < Math.abs(p.sweep) - ANG_EPS) out.push(off);
    }
}

/** The parts of one piece inside `rect`, in order along the piece. */
function clipPiece(p, rect) {
    if (isCubic(p)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        return (x1 < rect.x0 || x0 > rect.x1 || y1 < rect.y0 || y0 > rect.y1) ? [] : [p];
    }
    if (isLine(p)) {
        const [ax, ay] = p.A, [bx, by] = p.B;
        const dx = bx - ax, dy = by - ay;
        let t0 = 0, t1 = 1;
        const clipT = (q, r) => {
            if (q === 0) return r >= 0;
            const t = r / q;
            if (q < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
            return true;
        };
        if (!clipT(-dx, ax - rect.x0) || !clipT(dx, rect.x1 - ax) || !clipT(-dy, ay - rect.y0) || !clipT(dy, rect.y1 - ay)) return [];
        if (t0 <= 0 && t1 >= 1) return [p];
        if (t1 - t0 <= 0) return [];
        return [{ line: true, A: [ax + t0 * dx, ay + t0 * dy], B: [ax + t1 * dx, ay + t1 * dy] }];
    }
    const offs = [];
    arcSideOffsets(p, 0, rect.x0, offs); arcSideOffsets(p, 0, rect.x1, offs);
    arcSideOffsets(p, 1, rect.y0, offs); arcSideOffsets(p, 1, rect.y1, offs);
    const span = Math.abs(p.sweep), sgn = p.sweep >= 0 ? 1 : -1;
    const at = (off) => { const th = p.a0 + sgn * off; return [p.C[0] + p.r * Math.cos(th), p.C[1] + p.r * Math.sin(th)]; };
    if (!offs.length) return inRect(at(span / 2), rect) ? [p] : [];
    offs.sort((a, b) => a - b);
    const cuts = [0];
    for (const o of offs) if (o - cuts[cuts.length - 1] > ANG_EPS) cuts.push(o);
    if (span - cuts[cuts.length - 1] > ANG_EPS) cuts.push(span); else cuts[cuts.length - 1] = span;
    const parts = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
        const o0 = cuts[i], o1 = cuts[i + 1];
        if (!inRect(at((o0 + o1) / 2), rect)) continue;
        const A = i === 0 ? p.A : at(o0), B = i + 2 === cuts.length ? p.B : at(o1);
        parts.push({ A, B, C: p.C, r: p.r, a0: p.a0 + sgn * o0, sweep: sgn * (o1 - o0) });
    }
    return parts;
}

/**
 * A run cut to `rect`: the runs of its pieces that lie inside, in order. A
 * closed run that is entirely inside stays closed; one that leaves and comes
 * back is opened, and its two ends — the stretch before the first exit and
 * the stretch after the last return — are one run, because they meet.
 */
export function clipRunToRect(run, rect) {
    const out = [];
    let cur = null, whole = true;
    const flush = () => { if (cur && cur.length) out.push({ pieces: cur, closed: false }); cur = null; };
    for (const p of run.pieces) {
        const parts = clipPiece(p, rect);
        if (!parts.length) { whole = false; flush(); continue; }
        if (parts.length !== 1 || parts[0] !== p) whole = false;
        for (const q of parts) {
            if (cur && !samePt(endOf(cur[cur.length - 1]), startOf(q))) flush();
            if (!cur) cur = [];
            cur.push(q);
        }
        if (!samePt(endOf(parts[parts.length - 1]), endOf(p))) flush();
    }
    flush();
    if (!out.length) return out;
    if (whole && run.closed) { out[0].closed = true; return out; }
    if (run.closed && out.length > 1) {
        const first = out[0], last = out[out.length - 1];
        if (samePt(endOf(last.pieces[last.pieces.length - 1]), startOf(first.pieces[0]))) {
            out.pop();
            out[0] = { pieces: last.pieces.concat(first.pieces), closed: false };
        }
    }
    return out;
}

/** A circle as a loop of two arcs, for the dots. */
export function circleLoop(cx, cy, r) {
    const A = [cx + r, cy], B = [cx - r, cy];
    return [
        { A, B, C: [cx, cy], r, a0: 0, sweep: Math.PI },
        { A: B, B: A, C: [cx, cy], r, a0: Math.PI, sweep: Math.PI },
    ];
}

/** A rectangle as a loop of four lines. */
export function rectLoopOf(rect) {
    const c = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]];
    const loop = [];
    for (let i = 0; i < 4; i++) loop.push({ line: true, A: c[i], B: c[(i + 1) % 4] });
    return loop;
}
