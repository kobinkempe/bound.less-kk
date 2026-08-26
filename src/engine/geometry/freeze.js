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
 *      anyways." The test is the SAGITTA of the chopped piece, computed from
 *      local data only — (chord/2) * |tan(sweep/4)| — never from the centre,
 *      which at depth is not a computable number (section 3.1a).
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
 * the next tile along holds properly, cut short; if the level below measured it
 * for straightness it would freeze it to a chord that tile disagrees with. So
 * the clip marks the ends it made (seamA / seamB, carried through every
 * transform) and a piece carrying one stays an arc. Always safe: an arc is exact
 * at any depth, merely dearer.
 */
import { ptAt, subPiece } from "./arcPerimeter";
import { TILE, objTileRange, objTilesRect } from "../frameLattice";

const TAU = Math.PI * 2;
const wrap = (d) => d - TAU * Math.floor(d / TAU);

// A cut this close to an end would make a zero-length piece, which describes
// nothing and is a hazard to every consumer downstream.
const EPS = 1e-12;

/**
 * How far a piece bulges from its own chord, in the piece's own units.
 *
 * (chord/2) * |tan(sweep/4)| — the sagitta written with the BULGE, which is
 * tan(sweep/4) and is dimensionless, so the whole expression is local and the
 * radius never appears. A piece sweeping more than half a turn cannot be
 * straight by any measure and is reported as infinitely bulged rather than run
 * through a tangent that is about to change sign.
 */
export function pieceSagitta(p) {
    if (p.line) return 0;
    const a = Math.abs(p.sweep);
    if (!(a > 0)) return 0;
    if (a > Math.PI) return Infinity;
    const dx = p.B[0] - p.A[0], dy = p.B[1] - p.A[1];
    return (Math.hypot(dx, dy) / 2) * Math.abs(Math.tan(a / 4));
}

/** The chord of a piece, as a line. Its endpoints are carried through untouched. */
export function freezePiece(p) {
    return { line: true, A: p.A, B: p.B, src: p.src, ci: p.ci, rl: p.rl };
}

/** Parameters at which an ARC piece meets the grid line k on axis. */
function arcCuts(p, k, axis, out) {
    const u = (k - p.C[axis]) / p.r;
    if (!(u > -1 && u < 1)) return out;
    const t = axis === 0 ? Math.acos(u) : Math.asin(u);
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
 * Chop every piece on the object's tile grid, and freeze the ones that have
 * gone straight.
 *
 * Loop STRUCTURE is untouched: a chop splits one piece into pieces that share
 * their endpoints bit for bit, and a freeze changes a piece's curvature and
 * nothing else, so the chain still closes exactly where it did.
 *
 * cells is the window of tiles whose pieces come out FULLY chopped — the
 * caller's cache rect, expressed in tiles. Anything outside it is passed
 * through exactly as it arrived: it has not been cut at every grid line that
 * crosses it, so its extent is not the object's own and it must not be measured
 * for straightness. It is also, by construction, outside the rect the caller is
 * about to clip to, so it is already on its way to being discarded.
 */
export function chopFreezeLoops(loops, phase, tol, cells) {
    if (!loops || !loops.length) return loops || [];
    const px = phase[0], py = phase[1];
    const h = TILE / 2;
    const xs = [], ys = [];
    for (let i = cells.i0; i <= cells.i1 + 1; i++) xs.push(px + i * TILE - h);
    for (let j = cells.j0; j <= cells.j1 + 1; j++) ys.push(py + j * TILE - h);
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

    // "Fully chopped" is asked as: is it inside the lines this pass applied?
    // Cheaper and stricter than working out which tile it sits in, and it is
    // the property that actually matters — the piece's extent has to be the
    // object's own, not the window's.
    const whole = (b) => b[0] >= xlo && b[2] <= xhi && b[1] >= ylo && b[3] <= yhi;

    const settle = (q, seamA, seamB) => {
        if (q.line) return q;
        const sag = pieceSagitta(q);
        if (!seamA && !seamB && sag <= tol && whole(boxOf(q, sag))) return freezePiece(q);
        if (!!seamA === !!q.seamA && !!seamB === !!q.seamB) return q;
        const r = { ...q };
        if (seamA) r.seamA = true; else delete r.seamA;
        if (seamB) r.seamB = true; else delete r.seamB;
        return r;
    };

    const cuts = [];
    return loops.map((loop) => {
        const out = [];
        for (const p of loop) {
            // A LINE IS ALREADY WHAT A FREEZE WOULD MAKE IT. Cutting one on a
            // tile boundary yields two pieces of the same line, so the chop
            // changes nothing about it and nothing downstream can read a
            // difference — and below the freeze depth a shape is ALL lines,
            // which is exactly where this runs most often. Skipping them is why
            // the chop costs what a bounding box costs rather than what the clip
            // it precedes costs.
            if (p.line) { out.push(p); continue; }
            const b = boxOf(p, pieceSagitta(p));
            if (b[2] < xlo || b[0] > xhi || b[3] < ylo || b[1] > yhi) { out.push(p); continue; }
            cuts.length = 0;
            for (let n = 0; n < xs.length; n++) {
                const k = xs[n];
                if (k > b[0] && k < b[2]) arcCuts(p, k, 0, cuts);
            }
            for (let n = 0; n < ys.length; n++) {
                const k = ys[n];
                if (k > b[1] && k < b[3]) arcCuts(p, k, 1, cuts);
            }
            if (!cuts.length) { out.push(settle(p, p.seamA, p.seamB)); continue; }
            cuts.sort((x, y) => x - y);
            let prev = 0, A = p.A;
            for (const t of cuts) {
                if (!(t > prev + EPS)) continue;
                const B = ptAt(p, t);
                // Only the sub-piece that actually touches an overhang end is
                // held back. Its siblings are bounded by the grid and are free
                // to freeze, or one seam would suppress the freeze across
                // everything it touched.
                out.push(settle(subPiece(p, prev, t, A, B), prev === 0 ? p.seamA : false, false));
                prev = t; A = B;
            }
            out.push(settle(subPiece(p, prev, 1, A, p.B), prev === 0 ? p.seamA : false, p.seamB));
        }
        return out;
    });
}

/**
 * Mark the ends the SEAM OVERHANG clip made — see the note at the top. Whatever
 * that clip cut, it cut on the rect's boundary, so standing on the boundary is
 * exactly the test. The rect's own edges come back as pieces too; they are lines
 * and a line has nothing to freeze.
 */
export function markSeamEnds(loops, rect) {
    const ex = Math.abs(rect.right - rect.left) * 1e-12;
    const ey = Math.abs(rect.bottom - rect.top) * 1e-12;
    const on = (q) => (Math.abs(q[0] - rect.left) <= ex || Math.abs(q[0] - rect.right) <= ex
        || Math.abs(q[1] - rect.top) <= ey || Math.abs(q[1] - rect.bottom) <= ey);
    return loops.map((loop) => loop.map((p) => {
        if (p.line) return p;
        const a = on(p.A), b = on(p.B);
        if (!a && !b) return p;
        const r = { ...p };
        if (a) r.seamA = true;
        if (b) r.seamB = true;
        return r;
    }));
}

/**
 * The tiles of an object's grid that a cache rect reaches. A tile is the same
 * size as a frame (D4), so a cache tile plus its seam pad can only ever reach
 * two of them per axis — the window is bounded by construction and wants no
 * clamp.
 */
export function tileWindow(phase, rect) { return objTileRange(phase[0], phase[1], rect); }

/** ...and the rect those tiles span, which is what geometry is clipped to. */
export function tileClipRect(phase, cells) { return objTilesRect(phase[0], phase[1], cells); }
