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
