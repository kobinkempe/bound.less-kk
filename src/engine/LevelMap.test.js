/**
 * LM — the frame LATTICE.
 *
 * This file used to golden-compare against KobinEngineV0's crossing records,
 * because a frame was then "a region anchored wherever you first crossed into
 * it" and V0 was the definition of that. A frame is now a lattice CELL, so
 * there is nothing to compare against: the edge is a pure function of the cell
 * index, the grid is a constant, and no part of it is fitted to the camera.
 *
 * What is tested instead is the property that replaced all of it — WHICH FRAME
 * YOU ARE IN IS A FUNCTION OF WHERE YOU ARE (P4). F-B was the old model's
 * failure mode and it is the first thing here.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, R, W, G, HALF_W, HALF_R } from "./frameLattice";

const CFG = { base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 };
const cellOfPoint = ([x, y]) => ({ i: Math.round(x / G), j: Math.round(y / G) });
const mkMap = (w = 800, h = 600) => new LevelMap(CFG, w, h);

// Put the view centre at frame point (x, y) at a given in-frame zoom.
const aimAt = (M, x, y, inScale = ENTER) => ({
    inScale, inPanX: M.width / 2 - x * inScale, inPanY: M.height / 2 - y * inScale,
});

describe("LM-1 — a frame is a cell, and re-entry is a lookup (the F-B fix)", () => {
    test("crossing up from the same place always lands in the same frame", () => {
        const M = mkMap();
        const a = aimAt(M, 40, 40);
        const f1 = M.ensureChild("0", a.inScale, a.inPanX, a.inPanY);
        const f2 = M.ensureChild("0", a.inScale, a.inPanX, a.inPanY);
        expect(f2).toBe(f1);
        expect(f1.cell).toEqual({ i: 1, j: 1 });   // 40 / G = 1.25
    });

    test("the whole descent is a pure function of where you aimed", () => {
        // F-B measured on the old model: the frame you got depended on HOW YOU
        // GOT THERE, so two descents to the same place disagreed from depth 3
        // downward. Here the same aim gives the same chain, on a map that has
        // never seen it before and on one that has been all over the document.
        const walk = (M, x0) => {
            const ids = [];
            let id = "0", x = x0, y = -x0 / 3;
            for (let d = 0; d < 6; d++) {
                const a = aimAt(M, x, y);
                const f = M.ensureChild(id, a.inScale, a.inPanX, a.inPanY);
                ids.push(f.id);
                id = f.id;
                const p = M.toChild([x, y], f.id);   // the same world point, one level in
                x = p[0]; y = p[1];
            }
            return ids;
        };
        const fresh = mkMap(), used = mkMap();
        for (const x of [-9000, 12345.5, 3, -1]) walk(used, x);   // wander first
        expect(walk(used, 5.3)).toEqual(walk(fresh, 5.3));
    });

    test("an aim error only matters once it crosses a cell edge", () => {
        // A pixel of aim error IS a real difference in where you are, and six
        // levels down it is a whole screen — landing elsewhere is then correct,
        // not a bug. What must not happen is the answer changing while the
        // point stays put inside one cell.
        const M = mkMap();
        const at = (x) => { const a = aimAt(M, x, 0); return M.ensureChild("0", a.inScale, a.inPanX, a.inPanY).id; };
        const px = 1 / ENTER;
        expect(at(32 + px)).toBe(at(32));       // dead centre of cell 1: same cell
        expect(at(32 - px)).toBe(at(32));
        expect(at(48.1)).not.toBe(at(47.9));    // across the seam at i*G + G/2: different, and rightly so
    });

    test("going somewhere else and coming back returns the SAME frames", () => {
        const M = mkMap();
        const here = aimAt(M, 16, 16), there = aimAt(M, -5000, 3000);
        const first = M.ensureChild("0", here.inScale, here.inPanX, here.inPanY);
        M.ensureChild("0", there.inScale, there.inPanX, there.inPanY);   // wander off
        const again = M.ensureChild("0", here.inScale, here.inPanX, here.inPanY);
        expect(again).toBe(first);
    });

    test("findChild has no side effects and agrees with ensureChild", () => {
        const M = mkMap();
        const a = aimAt(M, 100, -100);
        expect(M.findChild("0", a.inScale, a.inPanX, a.inPanY)).toBeNull();
        const made = M.ensureChild("0", a.inScale, a.inPanX, a.inPanY);
        expect(M.findChild("0", a.inScale, a.inPanX, a.inPanY)).toBe(made);
    });
});

describe("LM-2 — ids are stable, and the spine keeps its legacy name", () => {
    test("the origin chain is still \"0\", \"1\", \"2\"", () => {
        const M = mkMap();
        const a = aimAt(M, 0, 0);
        let id = "0";
        for (let d = 1; d <= 4; d++) {
            id = M.ensureChild(id, a.inScale, a.inPanX, a.inPanY).id;
            expect(id).toBe(String(d));
            expect(M.spineAt(d)).toBe(String(d));
        }
    });

    test("an off-origin cell gets a structured id, and keeps it when the tree grows down", () => {
        const M = mkMap();
        const a = aimAt(M, 40, 72);
        const f = M.ensureChild("0", a.inScale, a.inPanX, a.inPanY);
        expect(f.id).toBe("0/1,2");
        // growing a coarser root must not rename anything already minted
        M.ensureParent("0");
        expect(M.frame("0/1,2")).toBe(f);
        expect(M.frame("0").parent).toBe("-1");
        expect(M.spineAt(-1)).toBe("-1");
    });
});

describe("LM-3 — cells tile space; the transform is exact", () => {
    test("a child's extent is exactly the frame, and the scale is exactly R", () => {
        const M = mkMap();
        const f = M.cellChild("0", 7, -3);
        expect(M.toChild([7 * G, -3 * G], f.id)).toEqual([0, 0]);                       // centre to centre
        expect(M.toChild([7 * G - G / 2, -3 * G - G / 2], f.id)).toEqual([-HALF_W, -HALF_W]);
        expect(M.toChild([7 * G + G / 2, -3 * G + G / 2], f.id)).toEqual([HALF_W, HALF_W]);
        expect(M.frameFactor("0", f.id)).toBe(R);
        expect(M.frameFactor(f.id, "0")).toBe(1 / R);
    });

    // Descend into the cell the point is actually in, N times, then climb back.
    const roundTrip = (start, N) => {
        const M = mkMap();
        const ids = [];
        let id = "0", p = [start, -start / 3];
        for (let d = 0; d < N; d++) {
            const c = cellOfPoint(p);
            const f = M.cellChild(id, c.i, c.j);
            ids.push(f.id); id = f.id;
            p = M.toChild(p, f.id);
        }
        for (const k of [...ids].reverse()) p = M.toParent(p, k);
        return Math.abs(p[0] - start);
    };

    test("the round-trip error DOES NOT COMPOUND with depth", () => {
        // This is the property the whole chain rests on, and the one the old
        // constants could not have: 3000 is not representable, so every crossing
        // spent an ulp and eight of them spent eight. Here the error at eight
        // levels is the SAME NUMBER as at one — whatever is lost is lost once,
        // at the first step, and only because a point sitting near its parent's
        // origin is held more precisely there than a child cell can express.
        for (const start of [3.14159, 1234.5678, -55555.5, 0.001]) {
            const one = roundTrip(start, 1);
            for (const N of [2, 3, 5, 8]) expect(roundTrip(start, N)).toBe(one);
            expect(one).toBeLessThanOrEqual(4 * Number.EPSILON * Math.max(Math.abs(start), 1));
        }
    });

    test("a point the child can hold exactly round-trips bit for bit", () => {
        for (const start of [1234.5678, -55555.5, 16, 0]) expect(roundTrip(start, 8)).toBe(0);
    });

    test("a point outside the cell it is mapped into still round-trips tightly", () => {
        // Legal, just not the hot path: the error is bounded by the ulp of the
        // frame size, not amplified by the descent.
        const M = mkMap();
        const ids = [];
        let id = "0";
        for (let d = 0; d < 5; d++) { const f = M.cellChild(id, d - 2, 1 - d); ids.push(f.id); id = f.id; }
        const p = [3.14159, -2.71828];
        let q = p;
        for (const k of ids) q = M.toChild(q, k);
        for (const k of [...ids].reverse()) q = M.toParent(q, k);
        expect(Math.abs(q[0] - p[0])).toBeLessThan(1e-9);
        expect(Math.abs(q[1] - p[1])).toBeLessThan(1e-9);
    });

    test("mapPointF across five levels is exact both ways", () => {
        const M = mkMap();
        let id = "0";
        for (let d = 0; d < 5; d++) id = M.cellChild(id, 1, -1).id;
        const p = [123.456, -78.9];
        const down = M.mapPointF(p, "0", id);
        expect(M.mapPointF(down, id, "0")).toEqual(p);
        expect(M.frameFactor("0", id)).toBe(Math.pow(R, 5));
    });

    test("sibling cells are exactly one frame apart", () => {
        const M = mkMap();
        const a = M.cellChild("0", 0, 0), b = M.cellChild("0", 1, 0);
        expect(M.frameFactor(a.id, b.id)).toBe(1);
        expect(M.mapPointF([0, 0], a.id, b.id)).toEqual([-W, 0]);
    });
});

describe("LM-4 — neighbours, and the carry that finds them", () => {
    test("a neighbour inside the parent is a plain digit step", () => {
        const M = mkMap();
        const f = M.cellChild("0", 5, 5);
        const n = M.neighbour(f.id, 1, -1);
        expect(n.cell).toEqual({ i: 6, j: 4 });
        expect(n.parent).toBe("0");
    });

    test("a neighbour past the parent's edge carries into a new parent", () => {
        const M = mkMap();
        M.ensureParent("0");                       // give depth 0 a parent to carry into
        const f = M.cellChild("0", HALF_R - 1, 0); // hard against the parent's right edge
        const n = M.neighbour(f.id, 1, 0);
        expect(n.depth).toBe(1);
        expect(n.parent).not.toBe("0");            // it lives under the next cell along
        expect(n.cell).toEqual({ i: -HALF_R, j: 0 });
        // and it really is adjacent: exactly one frame away
        expect(M.mapPointF([0, 0], f.id, n.id)).toEqual([-W, 0]);
    });

    test("stepping there and back returns the frame you started in", () => {
        const M = mkMap();
        M.ensureParent("0");
        const f = M.cellChild("0", HALF_R - 1, HALF_R - 1);
        const there = M.neighbour(f.id, 3, 3);
        expect(M.neighbour(there.id, -3, -3).id).toBe(f.id);
    });
});

describe("LM-5 — grids are lattice constants (P6)", () => {
    test("the grid does not depend on canvas size, and never changes on resize", () => {
        const a = mkMap(800, 600), b = mkMap(1504, 868), c = mkMap(411, 750);
        expect(a.makeGrid()).toEqual(b.makeGrid());
        expect(b.makeGrid()).toEqual(c.makeGrid());
        const before = a.makeGrid();
        a.resize(3000, 2000);
        expect(a.makeGrid()).toEqual(before);
    });

    test("tiles are exact, contiguous, and cover the frame", () => {
        const M = mkMap();
        const g = M.makeGrid();
        expect(Number.isInteger(Math.log2(g.w))).toBe(true);
        for (const i of [-2, -1, 0, 1, 2]) {
            expect(M.tileRect("0", i, 0).right).toBe(M.tileRect("0", i + 1, 0).left);
        }
        const r = M.tileRange("0", { left: -HALF_W, top: -HALF_W, right: HALF_W - 1, bottom: HALF_W - 1 });
        expect(M.tileRect("0", r.i0, r.j0).left).toBeLessThanOrEqual(-HALF_W);
        expect(M.tileRect("0", r.i1, r.j1).right).toBeGreaterThanOrEqual(HALF_W - 1);
    });

    test("the frame origin sits at the CENTRE of a tile, never on a corner", () => {
        // A centred zoom leaves the view exactly at the frame origin, so a grid
        // cornered there would split every cede four ways, at every depth.
        const M = mkMap();
        const t = M.tileRect("0", 0, 0);
        expect((t.left + t.right) / 2).toBe(0);
        expect((t.top + t.bottom) / 2).toBe(0);
        expect(M.tileRange("0", { left: 0, top: 0, right: 0, bottom: 0 })).toEqual({ i0: 0, i1: 0, j0: 0, j1: 0 });
    });
});

describe("LM-6 — addresses", () => {
    test("chainFrom and frameAtChain are inverses", () => {
        const M = mkMap();
        let id = "0";
        const cells = [{ i: 2, j: -3 }, { i: 0, j: 0 }, { i: -7, j: 11 }];
        for (const c of cells) id = M.cellChild(id, c.i, c.j).id;
        expect(M.chainFrom("0", id)).toEqual(cells);
        expect(M.frameAtChain("0", cells).id).toBe(id);
    });

    test("chainFrom returns null when the root is not an ancestor", () => {
        const M = mkMap();
        const a = M.cellChild("0", 1, 0), b = M.cellChild("0", 2, 0);
        expect(M.chainFrom(a.id, b.id)).toBeNull();
    });

    test("commonAncestor finds the fork", () => {
        const M = mkMap();
        const stem = M.cellChild("0", 4, 4);
        const a = M.cellChild(stem.id, 1, 1), b = M.cellChild(stem.id, -1, -1);
        expect(M.commonAncestor(a.id, b.id)).toBe(stem.id);
        expect(M.commonAncestor(M.cellChild(a.id, 0, 0).id, b.id)).toBe(stem.id);
    });
});

describe("LM-7 — serialization", () => {
    test("round-trips the whole tree, edges and all", () => {
        const M = mkMap();
        let id = "0";
        for (const c of [[1, 2], [-3, 4], [0, 0]]) id = M.cellChild(id, c[0], c[1]).id;
        M.ensureParent("0");
        const snap = M.serialize();
        const M2 = mkMap();
        M2.load(snap);
        expect(M2.serialize()).toEqual(snap);
        expect(M2.frame(id).edge).toEqual(M.frame(id).edge);
        expect(M2.frameFactor("0", id)).toBe(M.frameFactor("0", id));
        expect(M2.spineAt(-1)).toBe("-1");
    });

    test("a pre-lattice file is REFUSED, never converted (D8)", () => {
        // Kobin: "I haven't saved anything I need to keep... Nobody else has
        // drawn anything besides me." Converting would mean rewriting stored
        // coordinates, which is the one operation this design exists to avoid.
        const M = mkMap();
        const legacy = { 1: { s: 300, t: { x: 5, y: 6 }, grid: { w: 1, h: 1, ox: 0, oy: 0 } } };
        expect(() => M.load(legacy)).toThrow(/pre-lattice/);
        try { M.load(legacy); } catch (e) { expect(e.code).toBe("LEGACY_FORMAT"); }
        // an empty/absent map is not a legacy file — it is a new drawing
        expect(() => M.load({})).not.toThrow();
        expect(() => M.load(null)).not.toThrow();
    });
});

describe("LM-8 — ensureSpine still works for depth-int callers", () => {
    test("extends in both directions and keeps the ids", () => {
        const M = mkMap();
        expect(M.ensureSpine(3)).toBe("3");
        expect(M.ensureSpine(-2)).toBe("-2");
        expect(M.depthOf("3")).toBe(3);
        expect(M.frameFactor("-2", "3")).toBe(Math.pow(R, 5));
    });
});
