/**
 * Connectivity across a ceded window — the arithmetic behind bible §3's relay.
 *
 * A window is the one and only place two levels of the same object meet: the
 * parent paints everything outside the rect, the child everything inside, and
 * they share exactly the rect's boundary. So "are these two lumps of ink still
 * one object?" is answerable WITHOUT ever building the object globally: walk the
 * rect's perimeter and see whether the parent's ink and the child's ink are in
 * contact along the same stretch of it.
 *
 * That is the whole trick. `t` below is a NORMALIZED perimeter parameter — one
 * unit per side, clockwise from the top-left corner, so t ∈ [0, 4). Normalized
 * because the parent measures the rect in its own units and the child measures
 * the same rect 3000× bigger in its; in `t` those are the same number, which is
 * what lets a contact found at one level be compared with a contact found at the
 * next without ever composing a transform between them.
 *
 * The failure this guards against is severing too eagerly. An object wrongly
 * left whole still renders correctly and merely moves as one; an object wrongly
 * severed comes apart under the user's hands. Everything here therefore rounds
 * towards contact: corners count on both sides, a bare vertex touch counts as an
 * arc, and the tolerance is generous.
 */

export function asRect(r) {
    if (!r) return null;
    return r.x0 != null
        ? { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }
        : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
}

// The sides a point lies on, within `tol`. A corner lies on TWO, which is why
// this is a list and not a number: a ring that turns the corner has to be able
// to stay on the boundary through it, or a contact reads as two separate ones.
function sidesOf(R, x, y, tol) {
    const out = [];
    const inX = x >= R.x0 - tol && x <= R.x1 + tol;
    const inY = y >= R.y0 - tol && y <= R.y1 + tol;
    if (inX && Math.abs(y - R.y0) <= tol) out.push(0);
    if (inY && Math.abs(x - R.x1) <= tol) out.push(1);
    if (inX && Math.abs(y - R.y1) <= tol) out.push(2);
    if (inY && Math.abs(x - R.x0) <= tol) out.push(3);
    return out;
}
function tOn(R, side, x, y) {
    const w = R.x1 - R.x0 || 1, h = R.y1 - R.y0 || 1;
    const u = Math.min(1, Math.max(0, (x - R.x0) / w));
    const v = Math.min(1, Math.max(0, (y - R.y0) / h));
    if (side === 0) return u;
    if (side === 1) return 1 + v;
    if (side === 2) return 2 + (1 - u);
    return 3 + (1 - v);
    // NB the left side runs to t = 4, NOT round to 0. Wrapping it here silently
    // turns a short arc up the left edge into one spanning almost the whole
    // perimeter ([3.47, 4] read as [0, 3.47]), which then overlaps everything and
    // reports every cut as still-joined. The circularity belongs in arcsTouch,
    // which compares against ±4 shifts, and nowhere else.
}

// Sort and coalesce, so a ring with a thousand boundary vertices costs the same
// downstream as one with two.
function merge(arcs, eps) {
    if (arcs.length < 2) return arcs;
    arcs.sort((a, b) => a[0] - b[0]);
    const out = [arcs[0]];
    for (let i = 1; i < arcs.length; i++) {
        const last = out[out.length - 1], a = arcs[i];
        if (a[0] <= last[1] + eps) { if (a[1] > last[1]) last[1] = a[1]; } else out.push(a);
    }
    return out;
}

/**
 * Where `rings` touch `rect`'s boundary, as normalized perimeter intervals.
 *
 * `tol` is in the rings' OWN coordinates (the same units the rect is given in).
 * A ring edge with both ends on one side contributes that whole stretch; a lone
 * vertex on the boundary contributes a zero-length arc, which is recorded but
 * does NOT by itself mean two regions are joined — see `arcsTouch`.
 */
export function contactArcs(rings, rect, tol = 0) {
    const R = asRect(rect);
    if (!R || !rings) return [];
    const span = Math.max(R.x1 - R.x0, R.y1 - R.y0, 1e-12);
    const eps = Math.max(tol, span * 1e-9);
    const arcs = [];
    for (const ring of rings) {
        const n = ring.length;
        if (!n) continue;
        const on = ring.map((p) => sidesOf(R, p[0], p[1], eps));
        for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const sa = on[i], sb = on[(i + 1) % n];
            if (!sa.length) continue;
            let shared = -1;
            for (const s of sa) if (sb.indexOf(s) >= 0) { shared = s; break; }
            if (shared >= 0) {
                const t0 = tOn(R, shared, a[0], a[1]), t1 = tOn(R, shared, b[0], b[1]);
                arcs.push(t0 <= t1 ? [t0, t1] : [t1, t0]);
            } else {
                for (const s of sa) { const t = tOn(R, s, a[0], a[1]); arcs.push([t, t]); }
            }
        }
    }
    return merge(arcs, span > 0 ? eps / span : 1e-9);
}

/**
 * Do two arc sets share a STRETCH of the boundary? `tol` is in normalized
 * perimeter units.
 *
 * A shared stretch, not a shared point. The distinction is the whole question a
 * cut asks: when an erase reaches the edge of a tile, the two pieces it leaves
 * necessarily meet that edge at the SAME point — the one the eraser crossed —
 * so a point contact is the signature of a completed cut, not of a join.
 * Accepting it (this used to test for overlap-or-abut) meant a tile cut cleanly
 * in two still reported itself as connected to both halves of its parent, and
 * the object never came apart however carefully it was cut. Measured on Kobin's
 * simplest case: the lower half's contact with the upper parent was [0.19,
 * 0.19] — one point, against a real contact of 1.47 of the perimeter.
 *
 * Ink has width, so anything genuinely crossing a tile edge crosses it over an
 * interval; `tol` only has to exceed rounding.
 */
export function arcsTouch(A, B, tol = 1e-6) {
    for (const a of A) {
        for (const b of B) {
            // The perimeter is a circle, so compare against b shifted either way
            // too — an arc that straddles t = 0 is split across both ends.
            for (const d of [-4, 0, 4]) {
                const lo = Math.max(a[0], b[0] + d);
                const hi = Math.min(a[1], b[1] + d);
                if (hi - lo > tol) return true;
            }
        }
    }
    return false;
}

/**
 * The perimeter parameters a point sits at, or [] if it is not on the rect at
 * all. A corner gives two, for the same reason `sidesOf` does.
 *
 * This is `contactArcs` asked about one point instead of a ring, and it exists
 * so the erase-debug overlay can colour a boundary by ASKING the same question
 * severance asks: it walks a piece's own outline and, for each little stretch,
 * looks up whether that stretch's t falls inside a contact interval. Sharing
 * `tOn` with `contactArcs` is the whole point — a classification built on a
 * second, parallel notion of "where on the rect is this" would drift from the
 * one the engine actually severs on, and then the picture would lie.
 */
export function tOfPoint(rect, x, y, tol = 0) {
    const R = asRect(rect);
    if (!R) return [];
    return sidesOf(R, x, y, tol).map((s) => tOn(R, s, x, y));
}

/**
 * The stretches two contact sets actually SHARE, as intervals — the same
 * question `arcsTouch` answers yes/no, kept whole so it can be drawn.
 */
export function arcOverlaps(A, B, tol = 1e-6) {
    const out = [];
    for (const a of A) {
        for (const b of B) {
            for (const d of [-4, 0, 4]) {
                const lo = Math.max(a[0], b[0] + d);
                const hi = Math.min(a[1], b[1] + d);
                if (hi - lo > tol) out.push([lo, hi]);
            }
        }
    }
    return out;
}

/** Minimal union-find over integer ids. */
export class Groups {
    constructor(n = 0) { this.p = []; for (let i = 0; i < n; i++) this.p.push(i); }
    add() { this.p.push(this.p.length); return this.p.length - 1; }
    find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
    union(i, j) { const a = this.find(i), b = this.find(j); if (a !== b) this.p[b] = a; return a; }
    classes(ids) {
        const m = new Map();
        for (const i of ids) {
            const r = this.find(i);
            if (!m.has(r)) m.set(r, []);
            m.get(r).push(i);
        }
        return [...m.values()];
    }
}
