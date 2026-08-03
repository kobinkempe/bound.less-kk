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

export function ringsTouchRings(aRings, bRings, tolerance = 1e-9) {
    if (!aRings || !aRings.length || !bRings || !bRings.length) return false;
    const box = (rings) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of rings) for (const [x, y] of ring) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y);
            x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        return { x0, y0, x1, y1 };
    };
    const a = box(aRings), b = box(bRings);
    if (a.x1 < b.x0 - tolerance || b.x1 < a.x0 - tolerance ||
        a.y1 < b.y0 - tolerance || b.y1 < a.y0 - tolerance) return false;
    for (const ring of aRings) for (const p of ring) {
        if (windingOfPoint(bRings, p) !== 0) return true;
    }
    for (const ring of bRings) for (const p of ring) {
        if (windingOfPoint(aRings, p) !== 0) return true;
    }
    for (const ar of aRings) {
        for (let ai = 0; ai < ar.length; ai++) {
            const a0 = ar[ai], a1 = ar[(ai + 1) % ar.length];
            for (const br of bRings) {
                for (let bi = 0; bi < br.length; bi++) {
                    if (distSegToSeg(a0, a1, br[bi], br[(bi + 1) % br.length]) <= tolerance) {
                        return true;
                    }
                }
            }
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

function orient(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(p, a, b, eps = 1e-9) {
    if (Math.abs(orient(a, b, p)) > eps) return false;
    return p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps &&
        p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps;
}

export function pointInRingInclusive(ring, p, eps = 1e-9) {
    let inside = false;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        const a = ring[j], b = ring[i];
        if (pointOnSegment(p, a, b, eps)) return true;
        if ((a[1] > p[1]) !== (b[1] > p[1]) &&
            p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

// True when the CLOSED segments cross anywhere other than a shared/touching
// boundary. Lasso containment permits touching, so callers use this only after
// all candidate vertices have passed the inclusive point test.
function properSegmentCross(a, b, c, d, eps) {
    const abC = orient(a, b, c), abD = orient(a, b, d);
    const cdA = orient(c, d, a), cdB = orient(c, d, b);
    return ((abC > eps && abD < -eps) || (abC < -eps && abD > eps)) &&
        ((cdA > eps && cdB < -eps) || (cdA < -eps && cdB > eps));
}

// Every ring segment must stay inside a possibly-concave lasso. Testing only
// vertices is insufficient: a long edge can leave and re-enter a concavity.
export function ringsFullyInsideLasso(rings, lasso, eps = 1e-9) {
    if (!lasso || lasso.length < 3) return false;
    for (const ring of rings || []) {
        if (!ring.length) continue;
        for (const p of ring) if (!pointInRingInclusive(lasso, p, eps)) return false;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            for (let j = 0; j < lasso.length; j++) {
                if (properSegmentCross(a, b, lasso[j], lasso[(j + 1) % lasso.length], eps)) return false;
            }
        }
    }
    return true;
}
