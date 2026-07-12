/**
 * cut.js — boolean ("true") erase geometry: cut an open polyline with a disc.
 *
 * The eraser is a disc (center c, radius r) in the STROKE'S OWN frame; the
 * caller has already folded the stroke's half-width into r (r = eraser radius
 * + lw/2), so removing every part of the CENTERLINE inside the disc clears all
 * painted ink the eraser touched — and the surviving pieces' round caps
 * (lw/2 past their endpoints) land exactly tangent to the eraser disc, never
 * inside it.
 *
 * Cut points are exact circle/segment intersections (quadratic in the segment
 * parameter), so the kept runs end ON the disc boundary. The cut operates on
 * the stroke's control points; a spline-rendered stroke deviates from its
 * control polyline by at most the sample spacing (freehand points are raw
 * pointer samples), which is far below the eraser radius — and the deviation
 * only matters in the region being erased anyway.
 */

// Returns:
//   null  — the disc doesn't touch the centerline (nothing to do),
//   []    — the whole centerline is inside (erase the object),
//   runs  — the kept sub-polylines (each >= 2 points), with exact
//           entry/exit points inserted at the disc boundary.
export function cutPolylineWithDisc(pts, c, r) {
    const r2 = r * r;
    const inside = (p) => {
        const dx = p[0] - c[0], dy = p[1] - c[1];
        return dx * dx + dy * dy < r2;
    };
    if (pts.length === 1) return inside(pts[0]) ? [] : null;

    const runs = [];
    let cur = null;
    let touched = false;
    const endRun = () => { if (cur && cur.length >= 2) runs.push(cur); cur = null; };
    const at = (a, b, t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

    let aIn = inside(pts[0]);
    if (!aIn) cur = [pts[0]]; else touched = true;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const bIn = inside(b);
        // circle/segment: |a + t(b-a) - c|^2 = r^2, t in [0,1]
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const fx = a[0] - c[0], fy = a[1] - c[1];
        const A = dx * dx + dy * dy;
        const B = 2 * (fx * dx + fy * dy);
        const C = fx * fx + fy * fy - r2;
        let t0 = null, t1 = null;
        if (A > 0) {
            const disc = B * B - 4 * A * C;
            if (disc > 0) {
                const s = Math.sqrt(disc);
                t0 = (-B - s) / (2 * A); // entry (into the disc)
                t1 = (-B + s) / (2 * A); // exit
            }
        }
        if (aIn && bIn) {
            // fully inside — nothing kept
            touched = true;
        } else if (aIn && !bIn) {
            // exits the disc at t1 (t1 can only be missing to float grazing —
            // then cut at `a`, the conservative end)
            touched = true;
            cur = [at(a, b, t1 != null ? clamp01(t1) : 0), b];
        } else if (!aIn && bIn) {
            // enters the disc at t0 (grazing fallback: cut at `b`)
            touched = true;
            if (cur) { cur.push(at(a, b, t0 != null ? clamp01(t0) : 1)); endRun(); }
        } else {
            // both endpoints outside: the segment may still dip through the disc
            if (t0 != null && t0 > 0 && t0 < 1 && t1 > 0 && t1 < 1 && t1 > t0) {
                touched = true;
                if (cur) { cur.push(at(a, b, t0)); endRun(); }
                cur = [at(a, b, t1), b];
            } else if (cur) {
                cur.push(b);
            }
        }
        aIn = bIn;
    }
    endRun();
    if (!touched) return null;
    return runs;
}

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
