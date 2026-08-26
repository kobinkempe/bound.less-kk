/**
 * Test-only ink oracle and sampling helpers. NOT part of the app bundle and NOT
 * collected by jest (the directory is `__testkit__`, not `__tests__`).
 *
 * Trap T-1: `_hitTest` is not an ink oracle. It grants strokes a 6 px grab
 * margin and fills none, so the same target reads 6 px fatter as a stroke than
 * it does the moment an erase turns it into fills, and every mark-vs-hole
 * comparison picks up a spurious fringe right round the object. Everything here
 * is slop-free: shapes and fills by winding, strokes by exact band membership.
 */
import { insideShape, pieceBBox, loopsBBox } from "../geometry/arcShape";


// Winding number of p with respect to a ring set (nonzero rule) — the same rule
// the renderer fills with, so "inked" here means "painted" there.
export function winding(rings, p) {
    let w = 0;
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            if (a[1] <= p[1]) {
                if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++;
            } else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w;
}

export function distToSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
export function distToPolyline(pts, p) {
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    let d = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const q = distToSeg(p, pts[i], pts[i + 1]);
        if (q < d) d = q;
    }
    return d;
}

// Is `p` painted by this one piece? Round caps and joins never reach past half
// the linewidth from the centerline, so band membership is exact.
/**
 * Is `p` EXACTLY on this shape's boundary?
 *
 * Used by `inks` for one case and one case only — see the note there. A point on
 * a boundary is not INSIDE: a ray cast from there grazes whichever way it goes,
 * and the winding query correctly declines to answer.
 *
 * The tolerance is a ROUNDING distance and not a margin. Where this matters the
 * edge is bit-identical on both sides — one cut put it there — so the quantity
 * that should be zero comes out zero, and a few ulps is all that is needed.
 * Anything wider would start hiding real hairlines, which is the class of defect
 * this suite exists to catch.
 */
const EDGE_EPS = 1e-12;
const TAU = Math.PI * 2;
export function onShapeEdge(loops, p) {
    for (const loop of loops) {
        for (const q of loop) {
            const eps = EDGE_EPS * Math.max(Math.abs(q.A[0]), Math.abs(q.A[1]),
                Math.abs(q.B[0]), Math.abs(q.B[1]), 1);
            const b = pieceBBox(q);
            if (p[0] < b[0] - eps || p[0] > b[2] + eps || p[1] < b[1] - eps || p[1] > b[3] + eps) continue;
            if (q.line) {
                if (distToSeg(p, q.A, q.B) <= eps) return true;
                continue;
            }
            // An arc whose centre has run away cannot answer this — the hypot
            // is quantized long before eps — so it simply declines, which is
            // the conservative direction.
            if (Math.abs(Math.hypot(p[0] - q.C[0], p[1] - q.C[1]) - q.r) > eps) continue;
            let off = (Math.atan2(p[1] - q.C[1], p[0] - q.C[0]) - q.a0) % TAU;
            if (off < 0) off += TAU;
            const t = (q.sweep > 0 ? off : off - TAU) / q.sweep;
            if (t >= -1e-9 && t <= 1 + 1e-9) return true;
        }
    }
    return false;
}
/** The same question for polygon rings. */
export function onRingEdge(rings, p) {
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            const eps = EDGE_EPS * Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), 1);
            if (distToSeg(p, a, b) <= eps) return true;
        }
    }
    return false;
}

export function pieceInks(o, p) {
    // A resolved perimeter answers this EXACTLY — no flattening, no slop — which
    // is what makes it a better oracle than the polygon rings it replaced. It
    // also walks every piece to do it, and the precision suite asks the question
    // tens of thousands of times while bisecting for an edge, so reject on the
    // bounding box first. Cached on the object: geometry is immutable between
    // edits, and `_ver` moves when it is not.
    if (o.type === "shape") {
        if (o._inkBox == null || o._inkBoxVer !== o._ver) {
            o._inkBox = loopsBBox(o.loops);
            o._inkBoxVer = o._ver;
        }
        const b = o._inkBox;
        if (!b || p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) return false;
        return insideShape(o.loops, p);
    }
    if (o.type === "fill") return winding(o.polys, p) !== 0;
    return distToPolyline(o.pts, p) <= o.lwFrame / 2;
}
/** Is `p` on this piece's boundary, whatever kind of piece it is? */
export function onEdgeOf(o, p) {
    if (o.type === "shape") return onShapeEdge(o.loops, p);
    if (o.type === "fill") return onRingEdge(o.polys, p);
    return false;
}

/**
 * Is `p` painted by ANY piece in the list? (optionally restricted to one id)
 *
 * WHERE TWO OBJECTS ABUT, THE SEAM IS PAINTED. A point standing exactly on the
 * shared edge of two different objects is strictly inside neither, so the loop
 * below finds nothing — and yet the picture has no gap there: the renderer fills
 * both closed paths and they meet on that line. Answering "no ink" would be
 * describing the probe rather than the drawing.
 *
 * This became routine the moment a cache tile became the size of a frame (bible
 * D4): a child cell sitting on its parent's tile boundary is ordinary, two cedes
 * either side of it produce natives that abut exactly, and the seam lands on the
 * frame origin — which is exactly where a zoomed-in test probes. Measured on
 * CP-1: every screen position from 380 to 420 read ink except that single one.
 *
 * TWO DIFFERENT OBJECTS is the whole of the rule, and it is what keeps a HOLE a
 * hole. The edge of a hole belongs to ONE object: standing on it is standing on
 * the line where that object's ink stops, and it reads as no ink exactly as it
 * always has. Only a seam — two ids, both claiming the same line — is filled
 * from both sides.
 */
export function inks(list, p, id) {
    let seam = null;
    for (const o of list) {
        if (id != null && o.id !== id) continue;
        if (pieceInks(o, p)) return true;
        if (onEdgeOf(o, p)) {
            if (!seam) seam = new Set();
            seam.add(o.id);
            if (seam.size >= 2) return true;
        }
    }
    return false;
}
// Which pieces paint `p`.
export function inkers(list, p, id) {
    const out = [];
    for (const o of list) {
        if (id != null && o.id !== id) continue;
        if (pieceInks(o, p)) out.push(o);
    }
    return out;
}

// Sample `n` points along a segment, inclusive of both ends.
export function samples(from, to, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
    }
    return out;
}

// The x-extent a given id's pieces reach, split by which side of `xSplit` each
// piece's own centre sits on. Returns { aHi, bLo, overlap } where overlap > 0
// means the two sides genuinely overlap rather than abut.
export function seamOverlapX(list, id, xSplit) {
    let aHi = -Infinity, bLo = Infinity;
    for (const o of list) {
        if (id != null && o.id !== id) continue;
        const xs = [];
        if (o.type === "shape") {
            // Piece boxes, so an arc's bulge counts — a chord would understate a
            // half-turn cap by a whole pen radius and hide a real seam.
            for (const loop of o.loops) for (const q of loop) { const b = pieceBBox(q); xs.push(b[0], b[2]); }
        } else if (o.type === "fill") { for (const r of o.polys) for (const q of r) xs.push(q[0]); }
        else for (const q of o.pts) xs.push(q[0]);
        if (!xs.length) continue;
        let lo = Infinity, hi = -Infinity;
        for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
        // A stroke paints half a linewidth past its centerline in every direction.
        const m = (o.type === "fill" || o.type === "shape") ? 0 : (o.lwFrame || 0) / 2;
        lo -= m; hi += m;
        if ((lo + hi) / 2 < xSplit) aHi = Math.max(aHi, hi);
        else bLo = Math.min(bLo, lo);
    }
    return { aHi, bLo, overlap: aHi - bLo };
}
