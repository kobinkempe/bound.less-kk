/**
 * lasso.js — "everything FULLY BOUNDED by the loop is selected".
 *
 * Fully bounded, not merely touched. Two consequences fall straight out of that
 * rule and both are wanted (bible §5.3):
 *
 *  - An object far too small to see is selected as readily as a visible one —
 *    it has a position and an extent whether or not the screen can show them.
 *  - An object far LARGER than the view is never selected, because a loop drawn
 *    on screen cannot possibly contain it. That is the same set of objects whose
 *    motion the engine cannot record accurately, so the two rules agree by
 *    accident and the accident is a happy one.
 */

// Even-odd containment of a point in a closed polygon.
export function pointInPolygon(poly, p) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) &&
            p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

function segsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 !== o2 && o3 !== o4;
}

/**
 * The loop, prepared to answer "is this ring wholly inside?" many times.
 *
 * A closed ring lies wholly on one side of the loop unless some loop edge
 * crosses some ring segment, so one vertex inside plus no crossing is the
 * whole test — the same argument `rectInsidePolygon` makes for a box. The
 * crossing test is the cost: a hand-drawn loop is a few hundred edges and a
 * flattened scribble a few thousand segments, and asking every pair was
 * 30 ms an object on Kobin's 2026-09-03 drawing. So the edges are bucketed
 * once into a grid over the loop's box, and each ring segment (short, by
 * construction of the flatten) asks only the cells it touches.
 */
export function loopTester(poly) {
    const n = poly ? poly.length : 0;
    if (n < 3) return { inside: () => false, ringInside: () => false };
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of poly) {
        if (p[0] < l) l = p[0];
        if (p[0] > r) r = p[0];
        if (p[1] < t) t = p[1];
        if (p[1] > b) b = p[1];
    }
    const G = 32;
    const w = Math.max(r - l, 1e-9), h = Math.max(b - t, 1e-9);
    const cx = (x) => Math.min(G - 1, Math.max(0, Math.floor(((x - l) / w) * G)));
    const cy = (y) => Math.min(G - 1, Math.max(0, Math.floor(((y - t) / h) * G)));
    const cells = new Array(G * G);
    for (let i = 0; i < n; i++) {
        const a = poly[i], c = poly[(i + 1) % n];
        const x0 = cx(Math.min(a[0], c[0])), x1 = cx(Math.max(a[0], c[0]));
        const y0 = cy(Math.min(a[1], c[1])), y1 = cy(Math.max(a[1], c[1]));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const k = y * G + x;
            (cells[k] || (cells[k] = [])).push(i);
        }
    }
    const stamp = new Int32Array(n);
    let tick = 0;
    const segmentCrosses = (p, q) => {
        // Outside the loop's box entirely: no edge can be there.
        if (Math.max(p[0], q[0]) < l || Math.min(p[0], q[0]) > r ||
            Math.max(p[1], q[1]) < t || Math.min(p[1], q[1]) > b) return false;
        tick++;
        const x0 = cx(Math.min(p[0], q[0])), x1 = cx(Math.max(p[0], q[0]));
        const y0 = cy(Math.min(p[1], q[1])), y1 = cy(Math.max(p[1], q[1]));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const list = cells[y * G + x];
            if (!list) continue;
            for (const i of list) {
                if (stamp[i] === tick) continue;
                stamp[i] = tick;
                if (segsCross(poly[i], poly[(i + 1) % n], p, q)) return true;
            }
        }
        return false;
    };
    return {
        inside: (p) => pointInPolygon(poly, p),
        ringInside: (ring) => {
            const m = ring ? ring.length : 0;
            if (m < 1) return false;
            if (!pointInPolygon(poly, ring[0])) return false;
            for (let k = 0; k < m; k++) {
                if (segmentCrosses(ring[k], ring[(k + 1) % m])) return false;
            }
            return true;
        },
    };
}

/**
 * Is the polyline (an ink outline ring) entirely inside the closed polygon?
 * `loopTester(poly).ringInside(ring)`, for one ring; build the tester once when
 * asking about many.
 */
export function polylineInsidePolygon(poly, ring) {
    return loopTester(poly).ringInside(ring);
}

/**
 * Is the axis-aligned rect entirely inside the closed polygon?
 *
 * Exact, and deliberately not just a corner test: for a concave loop all four
 * corners can be inside while the loop's own boundary dips through the middle.
 * One corner inside PLUS no edge crossing the rect is enough — if the boundary
 * never enters the rect, the rect lies wholly on one side of it.
 */
export function rectInsidePolygon(poly, rect) {
    if (!poly || poly.length < 3) return false;
    if (!(rect.right >= rect.left && rect.bottom >= rect.top)) return false;
    if (!pointInPolygon(poly, [rect.left, rect.top])) return false;
    const corners = [
        [rect.left, rect.top], [rect.right, rect.top],
        [rect.right, rect.bottom], [rect.left, rect.bottom],
    ];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        // Cheap reject: this edge cannot touch the rect at all.
        if (Math.max(a[0], b[0]) < rect.left || Math.min(a[0], b[0]) > rect.right ||
            Math.max(a[1], b[1]) < rect.top || Math.min(a[1], b[1]) > rect.bottom) continue;
        for (let k = 0; k < 4; k++) {
            if (segsCross(a, b, corners[k], corners[(k + 1) % 4])) return false;
        }
        // An edge fully inside the rect never crosses its sides but still means
        // the boundary passes through, so the rect is not wholly enclosed.
        if (a[0] >= rect.left && a[0] <= rect.right && a[1] >= rect.top && a[1] <= rect.bottom) return false;
    }
    return true;
}
