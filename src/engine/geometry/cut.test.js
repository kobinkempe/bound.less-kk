/**
 * cutPolylineWithDisc — the boolean-erase cut. Exactness invariants: cut
 * endpoints land ON the disc boundary, kept geometry is untouched, and the
 * null / [] / runs trichotomy is honored.
 */
import { cutPolylineWithDisc } from "./cut";

const dist = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1]);

test("disc across the middle splits a segment into two runs with exact boundary endpoints", () => {
    const pts = [[0, 0], [100, 0]];
    const runs = cutPolylineWithDisc(pts, [50, 0], 10);
    expect(runs).toHaveLength(2);
    expect(runs[0][0]).toEqual([0, 0]);
    expect(runs[0][1][0]).toBeCloseTo(40, 9); // exact circle intersection
    expect(runs[0][1][1]).toBeCloseTo(0, 9);
    expect(runs[1][0][0]).toBeCloseTo(60, 9);
    expect(runs[1][1]).toEqual([100, 0]);
    for (const r of runs) for (const p of r) expect(dist(p, [50, 0])).toBeGreaterThanOrEqual(10 - 1e-9);
});

test("disc off-center cuts at the true chord (not the nearest point)", () => {
    const pts = [[0, 0], [100, 0]];
    const runs = cutPolylineWithDisc(pts, [50, 6], 10); // chord half-length = 8
    expect(runs).toHaveLength(2);
    expect(runs[0][1][0]).toBeCloseTo(42, 9);
    expect(runs[1][0][0]).toBeCloseTo(58, 9);
});

test("disc past the end shortens the polyline to one run", () => {
    const pts = [[0, 0], [100, 0]];
    const runs = cutPolylineWithDisc(pts, [100, 0], 15);
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).toEqual([0, 0]);
    expect(runs[0][runs[0].length - 1][0]).toBeCloseTo(85, 9);
});

test("disc covering everything returns [] (erase the object)", () => {
    expect(cutPolylineWithDisc([[0, 0], [10, 0], [10, 10]], [5, 5], 50)).toEqual([]);
    expect(cutPolylineWithDisc([[3, 3]], [0, 0], 10)).toEqual([]); // 1-pt dot inside
});

test("disc that misses returns null (untouched)", () => {
    expect(cutPolylineWithDisc([[0, 0], [100, 0]], [50, 30], 10)).toBeNull();
    expect(cutPolylineWithDisc([[3, 3]], [50, 50], 10)).toBeNull();
    // near-miss: bbox overlaps but the disc never reaches the line
    expect(cutPolylineWithDisc([[0, 0], [100, 0]], [50, 10.5], 10)).toBeNull();
});

test("multi-point polyline: interior points inside the disc are consumed", () => {
    const pts = [[0, 0], [40, 0], [50, 0], [60, 0], [100, 0]];
    const runs = cutPolylineWithDisc(pts, [50, 0], 15);
    expect(runs).toHaveLength(2);
    expect(runs[0].map((p) => p[0])).toEqual([0, 35]); // 40 was inside
    expect(runs[1].map((p) => p[0])).toEqual([65, 100]);
});

test("zig-zag through the disc produces one run per crossing", () => {
    // three horizontal passes (y = 0, 20, 40) all cross the r=25 disc at (50,20)
    const pts = [[0, 0], [100, 0], [100, 20], [0, 20], [0, 40], [100, 40]];
    const runs = cutPolylineWithDisc(pts, [50, 20], 25);
    expect(runs.length).toBe(4); // start..in, out..in, out..in, out..end
    for (const r of runs) {
        expect(r.length).toBeGreaterThanOrEqual(2);
        for (const p of r) expect(dist(p, [50, 20])).toBeGreaterThanOrEqual(25 - 1e-9);
    }
});

test("degenerate duplicate points don't break the walk", () => {
    const pts = [[0, 0], [0, 0], [100, 0], [100, 0]];
    const runs = cutPolylineWithDisc(pts, [50, 0], 10);
    expect(runs).toHaveLength(2);
});
