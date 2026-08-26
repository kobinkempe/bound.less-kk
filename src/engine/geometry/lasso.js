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
