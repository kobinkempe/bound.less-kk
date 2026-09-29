/**
 * svgAnchors.js — how a piece becomes Two.js anchors, for the SVG ink (`Renderer`) and the live stroke
 * (`LiveStrokeLayer`): one implementation. Anchors are relative to an origin `og` (float32 in the browser,
 * DESIGN.md §9 "Per-scene origin"); an arc is written by the plan `arcShape.planArc` makes once per piece.
 * Why each arc is written as it is: `Renderer.js`'s header, WHICH CURVE and HOW LONG (F40). `_mid` on an
 * anchor is its part's midpoint, for the thin rescale's thickness estimate.
 */
import Two from "two.js";
import { chordCubic, chordArcMid, planArc } from "../geometry/arcShape";
import { onRectEdge } from "../geometry/antRuns";

export function pushMove(verts, pt, og) {
    verts.push(new Two.Anchor(pt[0] - og.x, pt[1] - og.y, undefined, undefined, undefined, undefined, Two.Commands.move));
}
export function pushLine(verts, A, B, og, ctx) {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let n = 1;
    if (ctx && ctx.segMax > 0 && len > ctx.segMax && !(ctx.clip && onRectEdge({ line: true, A, B }, ctx.clip.rect, ctx.clip.eps))) {
        n = Math.ceil(len / ctx.segMax - 1e-9);
    }
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = i === n ? B[0] : A[0] + (B[0] - A[0]) * t, y = i === n ? B[1] : A[1] + (B[1] - A[1]) * t;
        verts.push(new Two.Anchor(x - og.x, y - og.y, undefined, undefined, undefined, undefined, Two.Commands.line));
    }
}
export function pushArcPiece(verts, p, og, ctx) {
    const r = Math.abs(p.r);
    if (p.line || !isFinite(r) || !(r > 0)) { pushLine(verts, p.A, p.B, og, ctx); return; }
    const plan = planArc(p, ctx);
    const sweepFlag = p.sweep > 0 ? 1 : 0;
    // The SVG sweep flag is the direction of increasing angle in the page's
    // y-down frame — exactly the sign of `sweep` in the engine's own
    // parametrisation P(θ) = C + r·(cos θ, sin θ), whichever side of C the
    // radius was written from.
    for (const q of plan.parts) {
        const m = chordArcMid(q);
        let a;
        if (plan.command === "A") {
            a = new Two.Anchor(q.B[0] - og.x, q.B[1] - og.y, undefined, undefined, undefined, undefined, Two.Commands.arc);
            a.rx = r; a.ry = r; a.xAxisRotation = 0; a.largeArcFlag = 0; a.sweepFlag = sweepFlag;
        } else {
            // One cubic. Its first handle belongs to the anchor it leaves — the
            // previous anchor, whatever command that one carries — so reach
            // back and set it there (relative, Two's own convention).
            const c = chordCubic(q);
            const prev = verts[verts.length - 1];
            if (prev) {
                if (!prev.controls) Two.Anchor.AppendCurveProperties(prev);
                prev.controls.right.x = c[1][0] - (prev.x + og.x);
                prev.controls.right.y = c[1][1] - (prev.y + og.y);
            }
            a = new Two.Anchor(c[3][0] - og.x, c[3][1] - og.y, c[2][0] - c[3][0], c[2][1] - c[3][1], 0, 0, Two.Commands.curve);
        }
        a._mid = [m[0] - og.x, m[1] - og.y];
        verts.push(a);
    }
}

/**
 * One biarc gap's arcs, as anchors, continuing whatever is already there. Each
 * new arc touches nothing behind it (a cubic reaches back only for its first
 * handle), which is what lets the live pen extend its path in O(1) instead of
 * rebuilding it.
 */
export function pushGapAnchors(verts, gap, og, ctx) {
    for (const a of gap) {
        if (!verts.length) pushMove(verts, a.A, og);
        pushArcPiece(verts, a, og, ctx);
    }
}

/**
 * A resolved arc perimeter as Two.js anchors, appended to `verts`.
 *
 * Each loop ends exactly where it began and the path stays OPEN: a fill
 * auto-closes its subpaths, while Two's `closed` flag would rule a stray
 * segment from the end of one loop back to the start of the whole path.
 */
export function pushShapeAnchors(verts, loops, og, ctx) {
    for (const loop of loops) {
        if (!loop.length) continue;
        pushMove(verts, loop.at(0).A, og);
        for (const p of loop) pushArcPiece(verts, p, og, ctx);
    }
}

/**
 * A polygon ring as anchors: a move and lines, the closing edge written out
 * (and chopped like any other) when it is long, because the fill's implicit
 * close would carry its far endpoints' rounding just the same.
 */
export function pushRingAnchors(verts, poly, og, ctx) {
    if (poly.length < 2) return;
    pushMove(verts, poly[0], og);
    for (let i = 1; i < poly.length; i++) pushLine(verts, poly[i - 1], poly[i], og, ctx);
    const last = poly[poly.length - 1], first = poly[0];
    if ((last[0] !== first[0] || last[1] !== first[1]) && ctx && ctx.segMax > 0 && Math.hypot(first[0] - last[0], first[1] - last[1]) > ctx.segMax) {
        pushLine(verts, last, first, og, ctx);
    }
}

// Two.js's Collection takes its initial contents with
// `Array.prototype.push.apply(this, verts)`, and `apply` gives out once the
// array is longer than the engine's argument limit — measured in V8: fine at
// 100,000 anchors, "Maximum call stack size exceeded" at 131,072.
//
// That is reachable by DRAWING, not only by pathological input. A fat stroke's
// capsule outline runs ~13 cubics per centerline anchor, so a few thousand
// points of one scribbled drag crosses it; an erased fill is worse. And it
// surfaces as a crash with no ink at all, not as a slow render, because the
// throw happens before the path reaches the scene.
//
// So never hand Two.js an unbounded array. Build the path empty and push in
// bounded chunks — through Collection.push, so each anchor still raises the
// `insert` event that Path binds its renderer flags to. Pushing onto the
// collection with Array.prototype.push would skip that and leave the new
// anchors untracked.
const ANCHOR_CHUNK = 4096;
export function mkPath(verts, closed, curved, manual) {
    const path = new Two.Path([], closed, curved, manual);
    for (let i = 0; i < verts.length; i += ANCHOR_CHUNK) {
        path.vertices.push(...verts.slice(i, i + ANCHOR_CHUNK));
    }
    return path;
}
