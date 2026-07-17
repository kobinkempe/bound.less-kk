// Plain hit-test geometry (no Two.js). Shared by the engine's eraser.

// Shortest distance from point p to a polyline.
export function distToPolyline(pts, p) {
    if (pts.length === 1) return Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]);
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        if (d < best) best = d;
    }
    return best;
}

function distPointToSeg(p, u, v) {
    const dx = v[0] - u[0], dy = v[1] - u[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(u[0] + t * dx - p[0], u[1] + t * dy - p[1]);
}

// Shortest distance between segments [a,b] and [c,d] (0 when they cross).
export function distSegToSeg(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0; // proper crossing
    return Math.min(distPointToSeg(c, a, b), distPointToSeg(d, a, b),
        distPointToSeg(a, c, d), distPointToSeg(b, c, d));
}

// Shortest distance from segment [a,b] to a polyline — the eraser SWEEP test
// (a point-only test lets a fast drag hop clean over thin strokes).
export function distSegToPolyline(a, b, pts) {
    if (pts.length === 1) return distPointToSeg(pts[0], a, b);
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const d = distSegToSeg(a, b, pts[i], pts[i + 1]);
        if (d < best) { best = d; if (best === 0) return 0; }
    }
    return best;
}

// Does the swept capsule [a,b] radius r touch a compound fill's ink?
export function capsuleTouchesRings(a, b, r, rings) {
    if (windingOfPoint(rings, a) !== 0 || windingOfPoint(rings, b) !== 0) return true;
    for (const ring of rings) {
        for (let i = 0, n = ring.length; i < n; i++) {
            if (distSegToSeg(a, b, ring[i], ring[(i + 1) % n]) <= r) return true;
        }
    }
    return false;
}

// Nonzero winding of p across rings (a compound fill's holes cancel out).
export function windingOfPoint(rings, p) {
    let w = 0;
    for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            if (a[1] <= p[1]) { if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++; }
            else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w;
}
