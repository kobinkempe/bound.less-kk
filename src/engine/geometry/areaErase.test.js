/**
 * Area-erase geometry: capsulePoly (the eraser's swept footprint),
 * subtractPolys (ink minus footprint, grouped into disjoint regions), and the
 * sweep hit-tests (distSegToPolyline / capsuleTouchesRings).
 */
import { capsulePoly, subtractPolys, netRingsArea } from "./clipperOutline";
import { distSegToPolyline, distSegToSeg, capsuleTouchesRings, windingOfPoint } from "./hittest";

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe("capsulePoly", () => {
    test("degenerates to a circle when a === b", () => {
        const ring = capsulePoly([10, 10], [10, 10], 5);
        expect(ring.length).toBeGreaterThanOrEqual(8);
        for (const [x, y] of ring) expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(5, 9);
    });

    test("sweeps a segment: every vertex sits r from the spine, both caps present", () => {
        const a = [0, 0], b = [100, 0], r = 10;
        const ring = capsulePoly(a, b, r);
        for (const p of ring) expect(distSegToPolyline(a, b, [p])).toBeCloseTo(r, 9);
        const xs = ring.map((p) => p[0]);
        expect(Math.min(...xs)).toBeCloseTo(-r, 6);      // cap behind a
        expect(Math.max(...xs)).toBeCloseTo(100 + r, 6); // cap past b
        expect(netRingsArea([ring])).toBeGreaterThan(100 * 2 * r * 0.98); // ≈ rect + circle
    });
});

describe("subtractPolys", () => {
    test("a capsule across the middle splits a bar into two regions", () => {
        const bar = [square(0, 0, 100, 20)];
        const regions = subtractPolys(bar, [capsulePoly([50, -30], [50, 50], 8)]);
        expect(regions).toHaveLength(2);
        const [left, right] = regions.sort((p, q) => p[0][0][0] - q[0][0][0]);
        for (const [x] of left[0]) expect(x).toBeLessThan(50);
        for (const [x] of right[0]) expect(x).toBeGreaterThan(50);
        const total = regions.reduce((s, r) => s + netRingsArea(r), 0);
        expect(total).toBeLessThan(2000);
        expect(total).toBeGreaterThan(2000 - 16 * 20 - 1); // lost ≈ the 16×20 swath
    });

    test("a hole punched inside stays ONE region with a hole ring (winding 0 inside)", () => {
        const slab = [square(0, 0, 100, 100)];
        const regions = subtractPolys(slab, [capsulePoly([50, 50], [50, 50], 10)]);
        expect(regions).toHaveLength(1);
        expect(regions[0].length).toBe(2); // outer + hole
        expect(windingOfPoint(regions[0], [50, 50])).toBe(0);   // inside the hole: empty
        expect(windingOfPoint(regions[0], [5, 5])).not.toBe(0); // corner: still ink
        expect(netRingsArea(regions[0])).toBeCloseTo(10000 - Math.PI * 100, -1.5);
    });

    test("full coverage leaves nothing; no clip returns the subject as one batch", () => {
        expect(subtractPolys([square(10, 10, 20, 20)], [square(0, 0, 100, 100)])).toEqual([]);
        const untouched = subtractPolys([square(0, 0, 10, 10)], []);
        expect(untouched).toHaveLength(1);
        expect(netRingsArea(untouched[0])).toBeCloseTo(100, 6);
    });

    test("nested leftovers: a ring-shaped subject keeps its own hole", () => {
        // Donut = outer square minus inner square (as subject rings), then bite it.
        const donut = subtractPolys([square(0, 0, 100, 100)], [square(30, 30, 70, 70)]);
        expect(donut).toHaveLength(1);
        expect(donut[0].length).toBe(2);
        const bitten = subtractPolys(donut[0], [capsulePoly([0, 50], [30, 50], 6)]);
        // Still one region (the bite doesn't sever the ring), hole intact.
        const all = bitten.reduce((s, r) => s + netRingsArea(r), 0);
        expect(windingOfPoint(bitten[0], [50, 50])).toBe(0);  // center still empty
        expect(windingOfPoint(bitten[0], [15, 50])).toBe(0);  // the bite is empty too
        expect(all).toBeLessThan(netRingsArea(donut[0]));
    });
});

describe("sweep hit-tests", () => {
    test("distSegToPolyline sees a crossing the endpoints miss", () => {
        const wall = [[50, -100], [50, 100]];
        expect(distSegToPolyline([0, 0], [100, 0], wall)).toBe(0);      // sweep crosses
        expect(distSegToPolyline([0, 0], [40, 0], wall)).toBeCloseTo(10, 9); // stops short
        expect(distSegToSeg([0, 0], [10, 0], [20, 0], [30, 0])).toBeCloseTo(10, 9); // collinear gap
    });

    test("capsuleTouchesRings: inside, near-edge, and clean miss", () => {
        const rings = [square(0, 0, 100, 100)];
        expect(capsuleTouchesRings([50, 50], [60, 50], 5, rings)).toBe(true);   // inside
        expect(capsuleTouchesRings([-10, 50], [-4, 50], 5, rings)).toBe(true);  // within r of the edge
        expect(capsuleTouchesRings([-30, 50], [-20, 50], 5, rings)).toBe(false); // miss
        // Sweep that crosses the square while both endpoints sit outside.
        expect(capsuleTouchesRings([-20, 50], [120, 50], 5, rings)).toBe(true);
    });
});
