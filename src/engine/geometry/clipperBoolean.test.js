/**
 * `strokeOutline` - the Clipper offset-and-union. Shape only; the INTEGER
 * LATTICE that Clipper imposes, and how far from the origin it starts to drift,
 * is measured separately in `lattice.test.js`.
 *
 * Split out of `clipperOutline.test.js` on 2026-08-31, when the pure float64
 * geometry moved to `polyline.js` and this stayed behind with `clipper-lib`.
 */
import { strokeOutline } from "./clipperBoolean";

// nonzero winding of p w.r.t. rings
function winding(rings, p) {
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
function ringArea(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
        const p = r[i], q = r[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}

describe("strokeOutline", () => {
    test("a single point becomes a dot of radius width/2", () => {
        const rings = strokeOutline([[10, 20]], 4);
        expect(rings.length).toBeGreaterThan(0);
        for (const ring of rings) for (const p of ring) {
            const d = Math.hypot(p[0] - 10, p[1] - 20);
            expect(d).toBeGreaterThan(1.8);
            expect(d).toBeLessThan(2.05);
        }
    });

    test("a straight segment becomes a capsule of the right size", () => {
        const rings = strokeOutline([[0, 0], [100, 0]], 10);
        expect(rings.length).toBe(1);
        const ring = rings[0];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ring) {
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
        }
        expect(Math.abs(x0 - -5)).toBeLessThan(0.3);
        expect(Math.abs(x1 - 105)).toBeLessThan(0.3);
        expect(Math.abs(y0 - -5)).toBeLessThan(0.3);
        expect(Math.abs(y1 - 5)).toBeLessThan(0.3);
        const want = 100 * 10 + Math.PI * 25; // rectangle + two half-disc caps
        expect(Math.abs(Math.abs(ringArea(ring)) - want) / want).toBeLessThan(0.02);
    });

    test("a self-crossing stroke unions cleanly", () => {
        const rings = strokeOutline([[0, 0], [100, 100], [100, 0], [0, 100]], 8);
        expect(rings.length).toBeGreaterThan(0);
        expect(winding(rings, [50, 50])).not.toBe(0); // the crossing point is ink, once-filled
    });
});
