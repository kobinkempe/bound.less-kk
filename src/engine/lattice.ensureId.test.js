/**
 * `LevelMap.ensureId` re-mints a frame a drawing's natives name and its lattice lacks, with the
 * EXACT id, `#n` segments included (OPEN-FLAGS F99: 42 ceded kids homed under a `#2` twin's child,
 * never drawn, so their parents showed rectangular holes near the Earth's city).
 */
import LevelMap from "./LevelMap";

jest.setTimeout(30000);

describe("EI — ensureId", () => {
    test("EI-1 a missing child under a #2 twin is minted with its exact id in its birth cell", () => {
        const lm = new LevelMap();
        lm._addFrame("0/3,4#2", "0", { i: 3, j: 4 }, 1);
        const f = lm.ensureId("0/3,4#2/5,-6");
        expect(f && f.id).toBe("0/3,4#2/5,-6");
        expect([f.parent, f.cell.i, f.cell.j, f.depth]).toEqual(["0/3,4#2", 5, -6, 2]);
        expect(lm.findCellChild("0/3,4#2", 5, -6)).toBe(f);
    });
    test("EI-2 a missing frame whose cell has a resident comes back as its shadow", () => {
        const lm = new LevelMap();
        const r = lm.cellChild("0", 7, 8);
        const f = lm.ensureId("0/7,8#2");
        expect(f && f.id).toBe("0/7,8#2");
        expect(f.shadowOf).toBe(r.id);
        expect(r._shadows && r._shadows.has(f.id)).toBe(true);
        expect(lm.findCellChild("0", 7, 8)).toBe(r);            // the resident keeps the cell
    });
    test("EI-3 an id no frame can have mints nothing", () => {
        const lm = new LevelMap();
        const before = lm.frames.size;
        expect(lm.ensureId("0/3,4/oops/5,6")).toBeNull();
        expect(lm.frames.size).toBe(before);
    });

    test("EI-5 a merged frame whose parent is missing re-mints the parent instead of being skipped", () => {
        const lm = new LevelMap();
        expect(lm.merge({ frames: [{ id: "0/3,4#2/5,6", parent: "0/3,4#2", i: 5, j: 6, depth: 2 }] })).toBe(1);
        const f = lm.frame("0/3,4#2/5,6");
        expect(f && lm.frame("0/3,4#2")).toBeTruthy();
        expect(lm.findCellChild("0/3,4#2", 5, 6)).toBe(f);
    });
    test("EI-6 a loaded frame whose parent the file lacks is reachable, not an orphan", () => {
        const lm = new LevelMap();
        lm.load({ __lattice: 1, frames: [{ id: "0", parent: null, i: 0, j: 0, depth: 0 }, { id: "0/3,4#2/5,6", parent: "0/3,4#2", i: 5, j: 6, depth: 2 }] });
        expect(lm.findCellChild("0/3,4#2", 5, 6)).toBe(lm.frame("0/3,4#2/5,6"));
        let f = lm.frame("0/3,4#2/5,6"), hops = 0;
        while (f && f.parent != null && hops++ < 10) f = lm.frame(f.parent);
        expect(f && f.id).toBe("0");                               // its chain reaches the root
    });
});
