/**
 * freeze.js — the object's tile grid, the chop, and the freeze.
 *
 * See docs/frame-lattice-design-bible.md D2, D3, sections 4.3-4.5 and 6.6.
 * Three rules, and every one of them is Kobin's:
 *
 *   1. THE TILE IS WHERE YOU CHOP. "The tile is where you chop the arc, so you
 *      don't have to calculate the whole thing... The important thing is that
 *      it's done the same, every time. You can't chop the arc in one place one
 *      time then somewhere slightly different the next time." The grid is
 *      anchored to the OBJECT (frameLattice: TILE, childTilePhase), so a move
 *      cannot slide the cuts along it.
 *
 *   2. A CURVE BECOMES A LINE WHEN IT IS WITHIN A QUARTER PIXEL OVER A TILE.
 *      "Keep freezing for cheapness. The arc will get comically straight
 *      anyways." Since 2026-09-06 the test is ONE RADIUS (Kobin: "can't that
 *      just become a constant arc radius, for the tile diagonal length, where
 *      that is true? Then you can just gate it on if the arc radius is greater
 *      than that amount, in tile units"): an arc's bow over a chord c is
 *      c²/(8r), no chord inside a tile is longer than the tile's diagonal, so
 *      every arc whose radius is at or above `freezeRadius(tol)` is within
 *      the tolerance everywhere in a tile, and every arc under it is kept.
 *      The radius maps down a level exactly, and a tile is the same size at
 *      every level in its own units, so that is one number for the whole
 *      engine (about 8.8e12 units at a quarter pixel), the same in every
 *      cache square and for every fragment of the same arc — a nick cannot
 *      change the decision, and neither can the window. The centre never
 *      enters (section 3.1a): the radius is a stored number. Before this the
 *      test was the sagitta of the chopped piece, guarded by "does its
 *      bow-grown box lie inside the lines this chop applied", and a piece cut
 *      ON one of those lines always failed the guard by its own bow, so deep
 *      arcs survived unfrozen to where their centres are 1e16 units away
 *      (OPEN-FLAGS F44, the crossing jump). The one guard left is exact: both
 *      endpoints must lie between the applied lines, so the unbounded stubs
 *      beyond the outermost line are never measured.
 *
 *   3. THE FROZEN LINE IS THE CHORD BETWEEN THE PIECE'S OWN ENDPOINTS, never a
 *      best fit (section 6.9). Both endpoints are then bit-identical before and
 *      after, so a neighbouring piece that has NOT frozen still meets it
 *      exactly — which is the whole of Kobin's tile-seam worry: "we'd be
 *      looking at two lines, and they have to meet at one point."
 *
 * A FRAME NEVER CUTS ANYTHING. Kobin, 2026-08-19: there are two kinds of
 * trimming and only two — the TILE trims geometry, and the FRAME decides which
 * objects are looked at at all. So the chain clips to the object's own tile
 * (`tileClipRect`), never to the render cache's frame-aligned square. Two
 * squares holding the same stretch of curve hold bit-identical pieces of it, and
 * there is nothing for the freeze to be ambiguous about.
 *
 * An earlier build clipped to the square. Its edge is not a tile boundary, so
 * two neighbouring squares held one arc cut in two different places, froze each
 * to its own chord, and disagreed by a quarter pixel where it happened and by
 * 1,000 px one level down.
 *
 * THE SEAM OVERHANG is the one thing that reaches past a tile, and it is not a
 * cut in the same sense. Adjacent pieces have to overlap by about a pixel or
 * antialiasing leaves a hairline down every boundary (derive.js seamPad, and S-1
 * measures it: every other kind of piece overlaps by 2*pad, and a shape clipped
 * to the bare tile overlapped by 0). So the clip rect is the tile GROWN BY THE
 * PAD — a property of the object and the tile, identical in every square that
 * holds that tile, and so still nothing the frame decided.
 *
 * What the overhang is NOT is the object's own edge. It is a duplicate of what
 * the next tile along holds properly, cut short. Until 2026-09-06 the clip
 * marked the ends it made (seamA / seamB, carried through every transform) so
 * that the level below would not measure such a stub for straightness and
 * freeze it to a chord the next tile disagrees with. The radius gate does not
 * measure the piece at all, and the endpoint guard refuses the stub anyway
 * (its outer end lies past the outermost applied line), so the freeze stopped
 * reading the marks that day, and on 2026-09-07 the marks went: `markSeamEnds`
 * and the carrying code in arcShape and arcPerimeter were deleted, and a
 * piece has no seam fields. The endpoint guard is the whole of the rule now.
 */
import { ptAt, subPiece, canonArc, arcDir, arcPieceOf, canonPos, canonOf } from "./arcPerimeter";
import { sagittaOf } from "./chordMath";
import { TILE, ENTER, TileGrid, R as HOP } from "../frameLattice";
import { acos, asin, hypot } from "./detMath";

const TAU = Math.PI * 2;

/**
 * THE FREEZE RADIUS. The radius at which an arc's bow over the tile's diagonal
 * is exactly `tol` — from s = r − √(r² − (c/2)²) with c = TILE·√2, i.e.
 * r = ((c/2)² + s²) / (2s). At or above it an arc is within `tol` of straight
 * over ANY chord that fits in a tile, so it freezes wherever it is; under it
 * it stays an arc. `tol` is in the level's units, the tile is TILE units at
 * every level, so the radius is the same number at every level.
 */
export const freezeRadius = (tol) => (TILE * TILE / 2 + tol * tol) / (2 * tol);
/** The gate at the engine's own tolerance: a quarter pixel at a level's deepest zoom (KobinEngine cfg: arcTolerancePx 0.25, enter). */
export const DEFAULT_FREEZE_R = freezeRadius((0.25 * 0.5) / ENTER);
const wrap = (d) => d - TAU * Math.floor(d / TAU);

// A cut this close to an end would make a zero-length piece, which describes
// nothing and is a hazard to every consumer downstream.
const EPS = 1e-12;

/**
 * How far a piece bulges from its own chord, in the piece's own units — the
 * radius-free `(chord/2)·|tan(sweep/4)|`, which is `chordMath.sagittaOf` (the
 * rasteriser's flattener sizes itself with the same expression; chordMath.test.js
 * M2 asserts the two are bit-identical). Over half a turn it is Infinity rather
 * than a tangent about to change sign.
 */
export function pieceSagitta(p) {
    if (p.line) return 0;
    return sagittaOf(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep);
}

/** The chord of a piece, as a line. Its endpoints are carried through untouched. */
export function freezePiece(p) {
    return { line: true, A: p.A, B: p.B, src: p.src, ci: p.ci, rl: p.rl };
}

/** Parameters at which an ARC piece meets the grid line k on axis. */
function arcCuts(p, k, axis, out) {
    const u = (k - p.C[axis]) / p.r;
    if (!(u > -1 && u < 1)) return out;
    const t = axis === 0 ? acos(u) : asin(u);
    const t2 = axis === 0 ? -t : Math.PI - t;
    for (let n = 0; n < 2; n++) {
        const d = wrap((n ? t2 : t) - p.a0);
        const along = p.sweep > 0 ? d : d - TAU;
        const s = along / p.sweep;
        if (s > EPS && s < 1 - EPS) out.push(s);
    }
    return out;
}

/**
 * THE CHORD FRAME (F44 layer 3, 2026-09-06) — an arc at or over the freeze
 * radius, expressed from its own chord and never through its centre.
 *
 * Such an arc is about to freeze (rule 2), so its cut points are where its
 * frozen chords will end, and the level below inherits them. Found through the
 * centre they are wrong by the centre's float64 step (8 units at r = 3e16),
 * and a grid line running across the top of such a circle turns that into
 * thirty through the arcsine — measured as a 1.9 px jump of the edge at the
 * crossing into the freeze level, on Kobin's join arc. From the chord: put the
 * origin at the chord's midpoint M, û along the chord, n̂ towards the bulge;
 * the circle's height above the chord at abscissa a is
 *
 *     h(a) = ((L/2)² − a²) / (d + √(r² − a²)),   d = √(r² − (L/2)²),
 *
 * (the intersecting-chords theorem written so nothing cancels: the numerator
 * is two moderate numbers, the denominator is about 2r and only its relative
 * precision matters). A grid line `axis = k` meets the arc where
 * M + a·û + h(a)·n̂ has that coordinate — a quadratic in `a` to first order in
 * h, solved in the stable form and polished with two or three Newton steps on
 * the exact h — and the point is M + a·û + h(a)·n̂ with the cut coordinate
 * set to k exactly, so the fragment's end stands on the line it was cut on.
 * Everything here is O(1) per cut and uses r only as a number of moderate
 * relative size. (The arc's parameter along the piece is taken as the chord
 * fraction (a + L/2)/L: it orders the cuts, and the only pieces that keep an
 * angular parametrisation afterwards are the stubs beyond the outermost line,
 * which the clip discards.)
 */
export function chordFrame(p) {
    const A = p.A, B = p.B;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = hypot(dx, dy);
    const r = Math.abs(p.r), half = L / 2;
    if (!(L > 0) || !(r > half)) return null;
    const ux = dx / L, uy = dy / L;
    // Travelling counter-clockwise (a positive sweep) the centre is on the
    // left, so the arc bulges to the RIGHT of the chord: n̂ = (uy, −ux).
    const sg = p.sweep > 0 ? 1 : -1;
    return { Mx: (A[0] + B[0]) / 2, My: (A[1] + B[1]) / 2, ux, uy, nx: sg * uy, ny: -sg * ux, half, L, r, d: Math.sqrt((r - half) * (r + half)) };
}
function chordPt(f, a, axis, k) {
    const h = ((f.half - a) * (f.half + a)) / (f.d + Math.sqrt((f.r - a) * (f.r + a)));
    const x = f.Mx + a * f.ux + h * f.nx, y = f.My + a * f.uy + h * f.ny;
    return axis === 0 ? [k, y] : [x, k];
}
/**
 * Chord abscissae at which the arc meets the line ν·X = c, for a unit normal
 * ν = (nx, ny) — every root, polished; the callers decide what is inside the
 * piece. `chordCuts` asks with an axis, ν = (1, 0) or (0, 1), where the
 * products are exact and the bits are the chain's own (2026-09-07: this is
 * the routine `chordCuts` always was, with the axis written as a normal, and
 * the axis case rounds identically); the winding query (`arcShape.rayCross`)
 * asks with the ray's normal, which is how a query about an arc of radius
 * 5e12 stops going through its centre.
 *
 * Each root comes back with the RESIDUAL of the line equation at it. The
 * quadratic is first order in h, so for a line that crosses the arc — every
 * grid line the chop asks about — it starts within h²/r of the answer and
 * three Newton steps polish it; the chop's `steps` is 3 and stays 3, because
 * where its cuts land is a saved drawing's deep picture. A ray can miss the
 * arc altogether, and then the quadratic's roots are fiction and Newton has
 * nowhere to go: measured 2026-09-07 on a 23-unit piece of a 175-unit circle,
 * a ray 130 units away "crossed" it at chord fraction 0.22 with the line
 * equation off by 64 units, and CX-4 lost its depth-2 tile to that. The ray
 * query asks for more steps and discards any root whose residual is not
 * small against the chord.
 */
export function chordLineRoots(f, nx, ny, c, steps = 3) {
    const m = f.Mx * nx + f.My * ny, u = f.ux * nx + f.uy * ny, n = f.nx * nx + f.ny * ny;
    const twoR = f.d + f.r;
    const qa = -n / twoR, qb = u, qc = m - c + (n * f.half * f.half) / twoR;
    const out = [];
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return out;
    const sq = Math.sqrt(disc);
    const q = -(qb + (qb >= 0 ? sq : -sq)) / 2;
    const roots = [];
    if (q !== 0) { roots.push(qc / q); if (qa !== 0) roots.push(q / qa); }
    else if (qa !== 0) roots.push(-qb / (2 * qa));
    const residual = (a) => {
        const N = (f.half - a) * (f.half + a), S = Math.sqrt((f.r - a) * (f.r + a));
        return Math.abs(m - c + a * u + (N / (f.d + S)) * n);
    };
    for (let a of roots) {
        if (!Number.isFinite(a)) continue;
        for (let it = 0; it < steps; it++) {
            const N = (f.half - a) * (f.half + a), S = Math.sqrt((f.r - a) * (f.r + a)), D = f.d + S;
            if (!(S > 0)) break;
            const hv = N / D;
            const hp = (-2 * a * D + (N * a) / S) / (D * D);
            const fa = m - c + a * u + hv * n, fp = u + hp * n;
            if (!fp) break;
            const step = fa / fp;
            a -= step;
            if (Math.abs(step) <= 1e-13 * Math.max(1, Math.abs(a))) break;
        }
        out.push({ a, res: residual(a) });
    }
    return out;
}
/**
 * The arc at chord abscissa `a`: the point, the (unnormalised) tangent in the
 * piece's direction of travel — û plus h'(a) n̂ — and the chord fraction `s`.
 * For the winding query; the chop snaps its cut coordinate instead (`chordPt`).
 */
export function chordHit(f, a) {
    const N = (f.half - a) * (f.half + a), S = Math.sqrt((f.r - a) * (f.r + a)), D = f.d + S;
    const h = N / D;
    const hp = S > 0 ? (-2 * a * D + (N * a) / S) / (D * D) : 0;
    return { x: f.Mx + a * f.ux + h * f.nx, y: f.My + a * f.uy + h * f.ny,
        tx: f.ux + hp * f.nx, ty: f.uy + hp * f.ny, s: (a + f.half) / f.L };
}
/**
 * A line chopped on the grid lines `xs`, `ys` (OPEN-FLAGS F181), or null where none crosses it. A crossing is the
 * canonical line's, from differences, `t = (g − P) / (Q − P)` on the crossed axis, with that coordinate g itself, so
 * frames a whole number of tiles apart compute the same bits. A cut line is chopped as its canonical line and each
 * fragment trimmed to the piece's stretch: one it covers whole is a plain line between the crossings, as the uncut
 * line's chop makes it, the rest are cut lines on their fragment. The piece's own ends keep their points.
 */
function chopLine(p, xs, ys) {
    const [P, Q] = canonOf(p), dx = Q[0] - P[0], dy = Q[1] - P[1];
    const recs = [];
    if (dx !== 0) for (const g of xs) if ((g - P[0]) * (g - Q[0]) < 0) { const t = (g - P[0]) / dx; recs.push({ t, pt: [g, P[1] + t * dy] }); }
    if (dy !== 0) for (const g of ys) if ((g - P[1]) * (g - Q[1]) < 0) { const t = (g - P[1]) / dy; recs.push({ t, pt: [P[0] + t * dx, g] }); }
    if (!recs.length) return null;
    recs.sort((a, b) => a.t - b.t);
    const ts = [0], pts = [P];
    for (const r of recs) if (r.t > ts[ts.length - 1] + EPS && r.t < 1 - EPS) { ts.push(r.t); pts.push(r.pt); }
    if (ts.length === 1) return null;
    ts.push(1); pts.push(Q);
    const fwd = !p.P || p.sb >= p.sa, Plo = fwd ? p.A : p.B, Phi = fwd ? p.B : p.A;
    // An own end standing on a crossing (a cede border's corner, which `borderJoin` solves by this arithmetic) is it.
    const posOf = (s, V) => { for (let k = 1; k < ts.length - 1; k++) if (pts[k][0] === V[0] && pts[k][1] === V[1]) return ts[k]; return s; };
    const lo = p.P ? posOf(Math.min(p.sa, p.sb), Plo) : 0, hi = p.P ? posOf(Math.max(p.sa, p.sb), Phi) : 1;
    const last = ts.length - 2;
    let kLo = 0, kHi = last;
    while (kLo < last && ts[kLo + 1] <= lo) kLo++;
    while (kHi > 0 && ts[kHi] >= hi) kHi--;
    if (kLo > kHi) return null;
    const out = [];
    for (let k = kLo; k <= kHi; k++) {
        const s0 = ts[k], s1 = ts[k + 1], L = s1 - s0, F0 = pts[k], F1 = pts[k + 1];
        const a = k === kLo ? (lo - s0) / L : 0, b = k === kHi ? (hi - s0) / L : 1;
        const A = k === kLo ? Plo : F0, B = k === kHi ? Phi : F1;
        const whole = a === 0 && b === 1 && A[0] === F0[0] && A[1] === F0[1] && B[0] === F1[0] && B[1] === F1[1];
        const q = { line: true, A: fwd ? A : B, B: fwd ? B : A, src: p.src, ci: p.ci, rl: p.rl };
        if (!whole) { q.P = F0; q.Q = F1; q.sa = fwd ? a : b; q.sb = fwd ? b : a; }
        out.push(q);
    }
    if (!fwd) out.reverse();
    return out;
}

/** Chord abscissae at which the arc meets the line `axis = k`, strictly inside the piece. */
function chordCuts(f, k, axis, out) {
    for (const { a } of chordLineRoots(f, axis === 0 ? 1 : 0, axis === 0 ? 0 : 1, k)) {
        const s = (a + f.half) / f.L;
        if (s > EPS && s < 1 - EPS) out.push(a);
    }
    return out;
}

/**
 * Chop every piece on the object's tile grid, and freeze the ones that have
 * gone straight.
 *
 * Loop STRUCTURE is untouched: a chop splits one piece into pieces that share
 * their endpoints bit for bit, and a freeze changes a piece's curvature and
 * nothing else, so the chain still closes exactly where it did.
 *
 * cells is the caller's cache rect in tiles; the pieces come out FULLY chopped
 * over those tiles and one more on each side, which holds the seam pad (F175).
 * Anything beyond is passed through as it arrived: it has not been cut at every
 * grid line that crosses it, so it must not be measured for straightness, and
 * it lies outside the rect the caller is about to clip to.
 *
 * COMPATIBILITY: the chop and the freeze decide the stored-to-derived chain's
 * bits at every level below an object's home, and those bits are not stored
 * anywhere in a saved drawing. Changing where a cut lands or which piece
 * freezes moves the deep picture of every existing drawing by the change
 * times 4096 per level. See the note on `deriveStep` (geometry/derive.js) —
 * the 1.0 decision on storing visited tiles or versioning the derivation has
 * to be made before this ships. The one-radius freeze of 2026-09-06 IS such
 * a change, sitting in the working tree undeployed.
 */
export function chopFreezeLoops(loops, phase, tol, cells) {
    if (!loops || !loops.length) return loops || [];
    const px = phase[0], py = phase[1];
    const h = TILE / 2;
    const xs = [], ys = [];
    // One line past each side: the seam pad lies in the tiles next door, and a stretch there is chopped and frozen
    // as their own chain does it, not left a stub the clip straightens to the whole stub's chord (OPEN-FLAGS F175).
    for (let i = cells.i0 - 1; i <= cells.i1 + 2; i++) xs.push(px + i * TILE - h);
    for (let j = cells.j0 - 1; j <= cells.j1 + 2; j++) ys.push(py + j * TILE - h);
    const xlo = xs[0], xhi = xs[xs.length - 1], ylo = ys[0], yhi = ys[ys.length - 1];

    // A piece's extent, WITHOUT going near its centre. The arc never leaves its
    // own chord by more than the sagitta, so the chord's box grown by that is a
    // bound — and one that costs a hypot and a tangent instead of `pieceBBox`'s
    // four angle probes. Being conservative is free here: a slightly larger box
    // can only ever decline to freeze a piece that could have, which is safe
    // (an arc is exact, merely dearer) and just as deterministic.
    const boxOf = (q, sag) => [
        Math.min(q.A[0], q.B[0]) - sag, Math.min(q.A[1], q.B[1]) - sag,
        Math.max(q.A[0], q.B[0]) + sag, Math.max(q.A[1], q.B[1]) + sag];

    // THE GATE (rule 2 above): the radius, and both ends between the lines
    // this pass applied — the fragments beyond the outermost line were not cut
    // at every line that crosses them, so their extent is not the object's
    // own and a chord of one could be wrong inside the window. An end the chop
    // made lies ON a line, to the precision its own centre allows (a cut point
    // is computed through the centre, and at r = 1e13 that is a thousandth of
    // a unit off the line), so the test carries that much slack and no more.
    const R = freezeRadius(tol);
    const within = (p, e) => p[0] >= xlo - e && p[0] <= xhi + e && p[1] >= ylo - e && p[1] <= yhi + e;
    const flat = (q) => {
        const r = Math.abs(q.r);
        if (!(r >= R)) return false;
        const e = Math.max(tol, r * Number.EPSILON * 8);
        return within(q.A, e) && within(q.B, e);
    };

    const settle = (q) => (q.line || !flat(q) ? q : freezePiece(q));
    /**
     * `settle` for the stretch [lo, hi] of a CUT arc's canonical fragment `kf`
     * (F43 — the arc half). The decision is the chain's decision on `kf`, and
     * what comes out is what the chain's piece would have become with the
     * stretch marked on it: the arc with `kf` as its canonical arc, or, where
     * the chain freezes `kf` to its chord, a cut LINE on that chord whose
     * canonical points are the chord's ends. The piece's own end points
     * (`Plo`, `Phi`) are kept as they are — a nick's end stays where the
     * erase put it, and the next transform re-anchors a cut line's ends to the
     * chord (`mapLine`) exactly as it does every other cut line.
     */
    const settleCut = (kf, lo, hi, Plo, Phi, dir) => {
        if (flat(kf)) {
            // The chain's `freezePiece(kf)`, on the piece's own end points —
            // they ARE kf's ends whenever the chop made them, and where the
            // piece owns one it is the point its neighbour shares.
            if (lo === 0 && hi === 1 && dir > 0) return { line: true, A: Plo, B: Phi, src: kf.src, ci: kf.ci, rl: kf.rl };
            const P = kf.A, Q = kf.B;
            const sa = lo === 0 ? 0 : canonPos(P, Q, Plo), sb = hi === 1 ? 1 : canonPos(P, Q, Phi);
            const q = { line: true, P, Q, src: kf.src, ci: kf.ci, rl: kf.rl };
            if (dir > 0) { q.A = Plo; q.B = Phi; q.sa = sa; q.sb = sb; } else { q.A = Phi; q.B = Plo; q.sa = sb; q.sb = sa; }
            return q;
        }
        return arcPieceOf(kf, lo, hi, Plo, Phi, dir);
    };

    // A cede's border (F178): a cut arc ending on one of this pass's lines, where a line lying on that grid line takes
    // over, ends at its canonical arc's own cut point there, and the line follows as a plain line. Both sides of the
    // border then hold the chain's pieces from this level down. `snapTol` is the level above's tolerance, here.
    const xset = new Set(xs), yset = new Set(ys), snapTol = tol * HOP;
    const borderAt = (q, V) => {
        if (!q.line) return null;
        if (q.A[0] === q.B[0] && V[0] === q.A[0] && xset.has(V[0])) return { ax: 0, g: V[0] };
        if (q.A[1] === q.B[1] && V[1] === q.A[1] && yset.has(V[1])) return { ax: 1, g: V[1] };
        return null;
    };

    const cuts = [];
    return loops.map((loop) => {
        const out = [], n = loop.length, lineAt = [];   // per line: its index, then its first and last piece in `out`
        let snaps = null;   // vertex i (the start of piece i) -> its new point
        for (let i = 0; i < n; i++) {
            const p = loop[i];
            // A line is chopped too, so its pieces' supports are the grid's crossings and never a window's (F181).
            if (p.line) {
                const first = out.length, parts = chopLine(p, xs, ys);
                if (parts) for (const q of parts) out.push(q); else out.push(p);
                lineAt.push(i, first, out.length - 1);
                continue;
            }
            // A CUT arc is chopped as its CANONICAL arc would be (F43): the
            // same box, the same grid lines, the same cuts and cut points, the
            // same fragments re-parametrised the same way and settled by the
            // same rule — then each fragment is trimmed to the piece's own
            // stretch, and only the fragments it reaches come out.
            const k = p.K ? canonArc(p) : p;
            const b = boxOf(k, pieceSagitta(k));
            if (b[2] < xlo || b[0] > xhi || b[3] < ylo || b[1] > yhi) { out.push(p); continue; }
            // WHERE THE CUTS FALL, AND THE POINTS THEY MAKE. An arc under the
            // gate is cut through its centre as it always was (`arcCuts`):
            // that centre is at most R away, whose float64 step is a thousandth
            // of a unit. An arc at or over the gate is cut in its own chord
            // frame (`chordCuts`, above), because it is about to freeze and the
            // level below inherits exactly these points.
            const cf = Math.abs(k.r) >= R ? chordFrame(k) : null;
            const recs = [];
            if (cf) {
                for (const g of xs) if (g > b[0] && g < b[2]) for (const a of chordCuts(cf, g, 0, [])) recs.push({ s: (a + cf.half) / cf.L, pt: chordPt(cf, a, 0, g), ax: 0, g });
                for (const g of ys) if (g > b[1] && g < b[3]) for (const a of chordCuts(cf, g, 1, [])) recs.push({ s: (a + cf.half) / cf.L, pt: chordPt(cf, a, 1, g), ax: 1, g });
            } else {
                for (const g of xs) if (g > b[0] && g < b[2]) { cuts.length = 0; for (const s of arcCuts(k, g, 0, cuts)) recs.push({ s, pt: null, ax: 0, g }); }
                for (const g of ys) if (g > b[1] && g < b[3]) { cuts.length = 0; for (const s of arcCuts(k, g, 1, cuts)) recs.push({ s, pt: null, ax: 1, g }); }
            }
            recs.sort((x, y) => x.s - y.s);
            // A cut stands on its grid line, as a line's does: the crossed coordinate is g itself (F181).
            const ptOf = (rec) => { if (!rec.pt) { rec.pt = ptAt(k, rec.s); rec.pt[rec.ax] = rec.g; } return rec.pt; };
            if (!p.K) {
                if (!recs.length) { out.push(settle(p)); continue; }
                let prev = 0, A = p.A;
                for (const rec of recs) {
                    if (!(rec.s > prev + EPS)) continue;
                    const B = ptOf(rec);
                    out.push(settle(subPiece(p, prev, rec.s, A, B)));
                    prev = rec.s; A = B;
                }
                out.push(settle(subPiece(p, prev, 1, A, p.B)));
                continue;
            }
            const dir = arcDir(p);
            let ua = p.ua, ub = p.ub, ownLo = dir > 0 ? p.A : p.B, ownHi = dir > 0 ? p.B : p.A;
            if (!recs.length) { out.push(settleCut(k, ua, ub, ownLo, ownHi, dir)); continue; }
            for (const isA of [true, false]) {
                const at = isA ? borderAt(loop[(i + n - 1) % n], p.A) : borderAt(loop[(i + 1) % n], p.B);
                if (!at) continue;
                const V = isA ? p.A : p.B, low = isA === (dir > 0);
                let best = null, bd = snapTol;
                for (const rec of recs) {
                    if (rec.ax !== at.ax || rec.g !== at.g) continue;
                    const pt = ptOf(rec), d = hypot(pt[0] - V[0], pt[1] - V[1]);
                    if (d <= bd) { best = rec; best.pt = pt; bd = d; }
                }
                if (!best || !(low ? best.s < ub : best.s > ua)) continue;
                if (low) { ua = best.s; ownLo = best.pt; } else { ub = best.s; ownHi = best.pt; }
                (snaps || (snaps = new Map())).set(isA ? i : (i + 1) % n, best.pt);
            }
            // The chain's fragments of K, in K's direction...
            const frags = [];
            let prev = 0, A = k.A;
            for (const rec of recs) {
                if (!(rec.s > prev + EPS)) continue;
                const B = ptOf(rec);
                frags.push([prev, rec.s, A, B]);
                prev = rec.s; A = B;
            }
            frags.push([prev, 1, A, k.B]);
            // ...trimmed to the piece's stretch. An end the piece owns keeps its
            // own point, so the loop stays shared end to end; an end the chop
            // made is the chop's point, the chain's own.
            const mine = [];
            for (const [s0, s1, Af, Bf] of frags) {
                if (s1 <= ua || s0 >= ub) continue;
                const kf = subPiece(k, s0, s1, Af, Bf);
                const lo = s0 >= ua ? 0 : (ua - s0) / (s1 - s0);
                const hi = s1 <= ub ? 1 : (ub - s0) / (s1 - s0);
                mine.push(settleCut(kf, lo, hi, s0 > ua ? Af : ownLo, s1 < ub ? Bf : ownHi, dir));
            }
            if (dir < 0) mine.reverse();
            for (const q of mine) out.push(q);
        }
        if (snaps) {
            const plain = (q, A, B) => ({ line: true, A, B, src: q.src, ci: q.ci, rl: q.rl });
            for (let m = 0; m < lineAt.length; m += 3) {
                const i = lineAt[m], f = lineAt[m + 1], l = lineAt[m + 2], a = snaps.get(i), b = snaps.get((i + 1) % n);
                if (f === l) { if (a || b) out[f] = plain(out[f], a || out[f].A, b || out[f].B); continue; }
                if (a) out[f] = plain(out[f], a, out[f].B);
                if (b) out[l] = plain(out[l], out[l].A, b);
            }
        }
        return out;
    });
}

/**
 * The tiles of an object's grid that a cache rect reaches. A tile is the same
 * size as a frame (D4), so a cache tile plus its seam pad can only ever reach
 * two of them per axis — the window is bounded by construction and wants no
 * clamp.
 */
export function tileWindow(phase, rect) { return TileGrid.at(phase).range(rect); }

/** ...and the rect those tiles span, which is what geometry is clipped to. */
export function tileClipRect(phase, cells) { return TileGrid.at(phase).span(cells); }
