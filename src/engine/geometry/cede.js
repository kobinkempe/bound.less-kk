/**
 * Ceding a tile: cutting a rect out of an object's ink, EXACTLY, and finding
 * out what that leaves it in.
 *
 * This is the primitive the tile/window design turns on once the parent is
 * genuinely cut rather than merely recording a rect it has given away. Two
 * properties are non-negotiable:
 *
 *  1. The cut edge must be the tile rect to the last bit. The child fills that
 *     rect and the two are viewed together at 3000x the parent's scale, so a
 *     parent edge rounded by one lattice step — 1e-3 parent units — lands three
 *     whole units out down there, which is hundreds of screen pixels of crack or
 *     overlap. So the geometry is float-only: `rectSubtract` gives the ≤4
 *     disjoint rects that tile (bbox minus hole), and `clipRingsToRect` is plain
 *     float64 Sutherland-Hodgman. No integer lattice is involved anywhere.
 *
 *  2. What is left has to be grouped into CONNECTED pieces, because that is what
 *     makes severance cheap later: if the parent is already in the right number
 *     of pieces the moment it cedes, deciding it has come apart is re-labelling
 *     rather than re-cutting. Chunks abut along the guillotine lines, so two of
 *     them are joined exactly when their ink overlaps along the line they share
 *     — a 1-D interval test, not another boolean.
 *
 * Note the cut is precision-safe in a way that baking the ERASE into the parent
 * never was: a tile is 12.8 parent units, 1/3000 of the parent's own frame,
 * where an erase made that far down is ~1e-8 of it and rounds to nothing.
 */
import { clipRingsToRect } from "./clipperOutline";
import { rectSubtract } from "./derive";
import { windingOfPoint } from "./hittest";

export function ringsBbox(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings || []) for (const [x, y] of r) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}
const asLTRB = (r) => (r.left != null
    ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    : { left: r.x0, top: r.y0, right: r.x1, bottom: r.y1 });

const signedArea = (ring) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        s += p[0] * q[1] - q[0] * p[1];
    }
    return s / 2;
};
const pointInRing = (ring, p) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) &&
            p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
};
/**
 * A point strictly INSIDE a simple ring.
 *
 * A vertex will not do, and that is not a nicety. Every ring here has been
 * clipped to the same cell, so rings routinely share edges with each other and
 * with the cell boundary; a vertex of one lands exactly ON another's edge, where
 * a crossing test is a coin flip. At the lexicographically lowest vertex the
 * boundary is locally convex, so a short step along the bisector of its two
 * edges is inside — try vertices in turn until one gives a usable bisector,
 * since a spike can make the two edges anti-parallel.
 */
function interiorPoint(ring) {
    const n = ring.length;
    if (n < 3) return ring[0];
    const order = ring.map((_, i) => i).sort((i, j) =>
        (ring[i][1] - ring[j][1]) || (ring[i][0] - ring[j][0]));
    for (const k of order) {
        const v = ring[k], a = ring[(k - 1 + n) % n], b = ring[(k + 1) % n];
        const la = Math.hypot(a[0] - v[0], a[1] - v[1]);
        const lb = Math.hypot(b[0] - v[0], b[1] - v[1]);
        if (!(la > 0) || !(lb > 0)) continue;
        const dx = (a[0] - v[0]) / la + (b[0] - v[0]) / lb;
        const dy = (a[1] - v[1]) / la + (b[1] - v[1]) / lb;
        const m = Math.hypot(dx, dy);
        if (!(m > 1e-9)) continue;                  // a spike: the wedge has no width
        const e = Math.min(la, lb) * 1e-6;
        const p = [v[0] + (dx / m) * e, v[1] + (dy / m) * e];
        if (pointInRing(ring, p)) return p;
    }
    return ring[0];
}

const key2 = (p) => p[0] + "|" + p[1];

/**
 * Undo Sutherland-Hodgman's ZERO-WIDTH CORRIDORS.
 *
 * The clip emits one ring per input ring, always — so when the clip genuinely
 * parts the ink in two it cannot say so. It runs the boundary along the clip
 * line from one lump across to the other and later back again, leaving a
 * corridor of no width at all. Nothing is painted in it. Left in place it makes
 * two separate lumps read as one ring, and there is no ring-level test that can
 * tell the difference: the corridor's bounding box spans both lumps, its
 * winding is theirs, its vertices are shared.
 *
 * This is not an exotic case. It is what §3's progressive thinning produces
 * every round: the previous round's notch reaches the tile edge, so cutting the
 * tile out leaves the shelf in halves joined by exactly one such corridor. DS-2
 * reported one parent piece after a gesture that had cut clean through the neck.
 *
 * A corridor is a stretch of a clip edge the ring walks in BOTH directions.
 * Cut the ring at the two ends of that stretch and the lumps fall apart, with
 * no change to the ink: the corridor had no area to lose.
 */
function splitCorridors(ring, cell, tol) {
    const lines = [
        [1, cell.top], [1, cell.bottom], [0, cell.left], [0, cell.right],
    ];
    const cuts = [];
    for (const [axis, v] of lines) {
        const o = axis ^ 1;
        const on = [];
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (Math.abs(a[axis] - v) > tol || Math.abs(b[axis] - v) > tol) continue;
            on.push({ lo: Math.min(a[o], b[o]), hi: Math.max(a[o], b[o]), dir: Math.sign(b[o] - a[o]) });
        }
        for (let i = 0; i < on.length; i++) {
            for (let j = i + 1; j < on.length; j++) {
                const A = on[i], B = on[j];
                if (!A.dir || !B.dir || A.dir === B.dir) continue;
                const lo = Math.max(A.lo, B.lo), hi = Math.min(A.hi, B.hi);
                if (hi - lo <= tol) continue;
                for (const w of [lo, hi]) {
                    const p = axis ? [w, v] : [v, w];
                    cuts.push(p);
                }
            }
        }
    }
    if (!cuts.length) return [ring];
    // Put the cut points ON the ring, so both traversals of the corridor pass
    // through the very same vertex and the split below can see the repeat.
    const seen = new Set();
    const pts = cuts.filter((p) => { const k = key2(p); if (seen.has(k)) return false; seen.add(k); return true; });
    const grown = [];
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        grown.push(a);
        const mid = pts.filter((p) => onSegment(a, b, p, tol) && key2(p) !== key2(a) && key2(p) !== key2(b));
        mid.sort((p, q) => (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])
            - ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])));
        for (const p of mid) grown.push(p);
    }
    // Split only at the corridor ends. A ring that touches itself anywhere else
    // is left alone: a point contact is a contact (connect.js counts one), and
    // over-severing is the direction that loses a user's work.
    const at = new Map(), stack = [], out = [];
    for (const p of grown) {
        const k = key2(p);
        if (seen.has(k) && at.has(k)) {
            const s = at.get(k);
            const loop = stack.splice(s + 1);
            for (const q of loop) at.delete(key2(q));
            if (loop.length >= 2) out.push([stack[s], ...loop]);
        } else {
            if (seen.has(k)) at.set(k, stack.length);
            stack.push(p);
        }
    }
    if (stack.length >= 3) out.push(stack);
    const rings = out.filter((r) => r.length >= 3);
    return rings.length ? rings : [ring];
}
function onSegment(a, b, p, tol) {
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(len > 0) || Math.abs(cross) > tol * len) return false;
    const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
    return dot >= -tol * len && dot <= len * len + tol * len;
}

/**
 * Split one cell's clipped rings into components, holes kept with the ink they
 * are holes in.
 *
 * WHY A CELL IS NOT A CHUNK. rectSubtract leaves at most four cells around the
 * hole, and treating each as one lump is wrong exactly when it matters most:
 * anything being ceded has usually been erased before, so the ink left in one
 * cell is routinely two separate lumps with an old notch between them. Call
 * them one and everything either lump touches becomes one piece — the object is
 * reported whole when it has genuinely come apart. That is §3's progressive
 * thinning every single round, and it kept DS-2 returning one parent piece
 * after a gesture that had cut clean through the neck.
 *
 * WHICH DIRECTION TO ERR. An object wrongly left whole renders correctly and
 * merely moves as one lump; an object wrongly severed comes apart under the
 * user's hands and cannot be put back. So every test here is sound in the
 * direction of NOT splitting:
 *
 *  - ink or hole is decided by WINDING, the same predicate the renderer fills by
 *    and hit-testing reads: a ring whose own interior has zero total winding is
 *    a hole. Nesting depth would be cheaper and is wrong, because rings are not
 *    always properly nested — a fill's rings routinely OVERLAP (an outline
 *    emits one per segment, and a boolean can leave two lumps sharing an edge),
 *    and an overlapping ring's interior point sits at depth 1 and reads as a
 *    hole. Winding does not care how the rings are arranged.
 *  - separation is conservative. Two lumps are declared apart only when their
 *    bounding boxes do not even touch, which proves it. Overlapping boxes are
 *    kept together whether or not the ink actually meets — the CD-3 case, in
 *    reverse. That costs an under-severed object in shapes an erase gesture
 *    does not produce on its own (the notch a sweep leaves is axis-aligned, and
 *    a disjoint box is exactly what catches those), and it never invents one.
 *
 * The cross-cell relation is a different matter and stays exact: chunks abut
 * along a guillotine line, so they are joined exactly where their edges overlap
 * along it.
 */
function ringComponents(rings, tol) {
    // Sutherland-Hodgman leaves zero-extent rings wherever a clip line lies
    // along an edge. They paint nothing, but their boxes span the whole line
    // and would bridge every lump on it.
    const live = rings.filter((r) => {
        const b = ringsBbox([r]);
        return b && b.x1 - b.x0 > tol && b.y1 - b.y0 > tol;
    });
    const n = live.length;
    if (n <= 1) return n ? [live] : [];
    const area = live.map((r) => Math.abs(signedArea(r)));
    const box = live.map((r) => ringsBbox([r]));
    const rep = live.map(interiorPoint);
    const isInk = rep.map((p) => windingOfPoint(live, p) !== 0);
    // The innermost hole a ring sits inside, if any. Two lumps of ink separated
    // by one of these are an island and its surround: never the same piece,
    // however much their boxes overlap.
    const holeOf = [];
    for (let i = 0; i < n; i++) {
        let best = -1;
        for (let j = 0; j < n; j++) {
            if (i === j || isInk[j] || !(area[j] > area[i]) || !pointInRing(live[j], rep[i])) continue;
            if (best < 0 || area[j] < area[best]) best = j;
        }
        holeOf[i] = best;
    }
    const p = live.map((_, i) => i);
    const find = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) p[b] = a; };
    // A hole belongs to the smallest lump of ink it is cut into.
    for (let i = 0; i < n; i++) {
        if (isInk[i]) continue;
        let best = -1;
        for (let j = 0; j < n; j++) {
            if (i === j || !isInk[j] || !(area[j] > area[i]) || !pointInRing(live[j], rep[i])) continue;
            if (best < 0 || area[j] < area[best]) best = j;
        }
        if (best >= 0) union(best, i);
    }
    for (let i = 0; i < n; i++) {
        if (!isInk[i]) continue;
        for (let j = i + 1; j < n; j++) {
            if (!isInk[j] || holeOf[i] !== holeOf[j]) continue;
            const A = box[i], B = box[j];
            if (A.x1 + tol < B.x0 || B.x1 + tol < A.x0 || A.y1 + tol < B.y0 || B.y1 + tol < A.y0) continue;
            union(i, j);
        }
    }
    const out = new Map();
    for (let i = 0; i < n; i++) {
        const k = find(i);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(live[i]);
    }
    return [...out.values()];
}

/**
 * The stretches, along `axis` (0 = a vertical line x = v, 1 = horizontal y = v),
 * where `rings` have an edge lying ON that line. Two chunks that abut on the
 * line are joined exactly where these overlap.
 */
function edgeSpans(rings, axis, v, tol) {
    const spans = [];
    for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (Math.abs(a[axis] - v) > tol || Math.abs(b[axis] - v) > tol) continue;
            const o = axis ^ 1;
            spans.push(a[o] <= b[o] ? [a[o], b[o]] : [b[o], a[o]]);
        }
    }
    return spans;
}
const spansOverlap = (A, B, tol) => {
    for (const a of A) for (const b of B) {
        if (a[0] - tol <= b[1] && b[0] - tol <= a[1]) return true;
    }
    return false;
};

/**
 * Cut `hole` out of `rings`. Returns the surviving ink as an array of CONNECTED
 * groups, each an array of rings, all float-exact.
 *
 * `hole` and the ring coordinates are in the same frame. Anything of `hole` that
 * falls outside the ink simply has no effect.
 */
export function cedeRect(rings, hole, opts = {}) {
    const bb = ringsBbox(rings);
    if (!bb) return [];
    const H = asLTRB(hole);
    const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0, 1);
    const tol = opts.tol != null ? opts.tol : span * 1e-9;
    const pad = span * 0.01 + 1;
    const box = { left: bb.x0 - pad, top: bb.y0 - pad, right: bb.x1 + pad, bottom: bb.y1 + pad };
    // ≤4 disjoint float rects tiling (box minus hole) — no quantization.
    const cells = rectSubtract(box, [{ x0: H.left, y0: H.top, x1: H.right, y1: H.bottom }]);
    const chunks = [];
    for (const c of cells) {
        const piece = clipRingsToRect(rings, c);
        if (!piece || !piece.length) continue;
        // A CELL IS NOT A CHUNK, and neither is a RING. Ink inside one cell can
        // be several separate lumps — see ringComponents — and a single ring can
        // be two of them joined by a corridor of no width — see splitCorridors.
        const split = [];
        for (const r of piece) for (const s of splitCorridors(r, c, tol)) split.push(s);
        for (const comp of ringComponents(split, tol)) chunks.push({ cell: c, rings: comp });
    }
    if (chunks.length <= 1) return chunks.map((c) => c.rings);

    // Union chunks that share a guillotine line AND have ink meeting along it.
    const parent = chunks.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[b] = a; };
    for (let i = 0; i < chunks.length; i++) {
        for (let j = i + 1; j < chunks.length; j++) {
            const A = chunks[i], B = chunks[j];
            if (A.cell === B.cell) continue;   // same cell: already components
            // vertical shared line?
            let axis = -1, v = 0;
            if (Math.abs(A.cell.right - B.cell.left) <= tol) { axis = 0; v = A.cell.right; }
            else if (Math.abs(B.cell.right - A.cell.left) <= tol) { axis = 0; v = B.cell.right; }
            else if (Math.abs(A.cell.bottom - B.cell.top) <= tol) { axis = 1; v = A.cell.bottom; }
            else if (Math.abs(B.cell.bottom - A.cell.top) <= tol) { axis = 1; v = B.cell.bottom; }
            if (axis < 0) continue;
            if (spansOverlap(edgeSpans(A.rings, axis, v, tol), edgeSpans(B.rings, axis, v, tol), tol)) union(i, j);
        }
    }
    const byRoot = new Map();
    for (let i = 0; i < chunks.length; i++) {
        const r = find(i);
        if (!byRoot.has(r)) byRoot.set(r, []);
        for (const ring of chunks[i].rings) byRoot.get(r).push(ring);
    }
    return [...byRoot.values()];
}

/**
 * Do these rings reach the boundary of `rect`? Used to decide which pieces on
 * either side of a ceded tile are candidates for being joined through it.
 */
export function touchesRect(rings, rect, tol) {
    const R = asLTRB(rect);
    const t = tol != null ? tol : Math.max(R.right - R.left, R.bottom - R.top, 1) * 1e-9;
    for (const ring of rings || []) for (const [x, y] of ring) {
        if ((Math.abs(x - R.left) <= t || Math.abs(x - R.right) <= t) && y >= R.top - t && y <= R.bottom + t) return true;
        if ((Math.abs(y - R.top) <= t || Math.abs(y - R.bottom) <= t) && x >= R.left - t && x <= R.right + t) return true;
    }
    return false;
}
