/**
 * PLAN §3 row 1, the Stage's half (A2-scene.md §6.4): a stored plate's generation is monotone, and a
 * plate is exact iff `plate.G >= dirtySince(key)` — for real document events. A Document, LevelMap,
 * TileStore and Stage (no renderer), the G-keyed PlateStore, and a fake pool whose jobs are packed at
 * dispatch (the job's G is the Stage's then) and answered out of order. Seeded random steps: adds,
 * removes, table changes, re-homes, geometry edits, frame re-addresses, some inside `stage.batch`;
 * dispatches for cells of three frames and four levels; arrivals; evictions. After every step:
 * (a) no stored plate's G decreased; (b) a plate some later change touched is never exact — "touched"
 * recomputed independently, the changed natives' drawn boxes before and after through
 * `LevelMap.mapRectObj`, a re-addressed frame's whole content mapped before and after the move;
 * (c) an arrival newer than the stored plate replaced it (F106), an older or equal one did not.
 * The long run is `stage.fresh.probe.js`.
 */
import { runFresh } from "./__testkit__/stageFresh";

describe("freshness by G for real document events (PLAN §3 row 1, the Stage's half)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        test("seed " + seed + ": 400 steps", () => {
            const fails = [];
            const c = runFresh(seed, 400, (m) => { if (fails.length < 5) fails.push(m); });
            expect(fails).toEqual([]);
            // Not vacuous: plates were stored and judged, and changes staled some of them.
            expect(c.stored).toBeGreaterThan(20);
            expect(c.checks).toBeGreaterThan(200);
            expect(c.commits).toBeGreaterThan(40);
            expect(c.checks - c.exactChecked).toBeGreaterThan(0);
        });
    }
});

describe("the family rule (PLAN §5.1 Q15)", () => {
    const setup = (isNeutral = null) => {
        const { default: Document } = require("./Document");
        const { default: LevelMap } = require("./LevelMap");
        const { default: TileStore } = require("./TileStore");
        const { default: Stage } = require("./Stage");
        const { default: PlateStore } = require("./raster/PlateStore");
        const { createPlacementModel } = require("./placementModel");
        const { plateKey, zqOf } = require("./raster/plate");
        const cfg = { enter: 256, base: 1 / 16, exit: 1 / 32, scale: 1000, arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, cullPx: 0.3, fadeLoPx: 0.15, fatWidthPx: 4000, lineTolPx: 0.25 };
        const lm = new LevelMap(cfg, 800, 600);
        const doc = new Document(); doc.lm = lm; doc.frameFactor = (a, b) => lm.frameFactor(a, b);
        const store = new TileStore(lm, doc, cfg);
        const stage = new Stage({ doc, lm, store, model: createPlacementModel({ doc, lm, store }), cfg, isNeutral });
        const plates = new PlateStore({ fresh: stage, doc: null });
        stage.sync("0", { left: -4096, top: -4096, right: 4096, bottom: 4096 });
        const ring = (x0, y0, x1, y1, cw) => (cw ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
        const fill = (x0, y0, x1, y1, cw = false) => ({ type: "fill", origin: "native", id: doc.allocId(), editId: 500, color: "rgb(20,20,20)", opacity: 1, polys: [ring(x0, y0, x1, y1, cw)] });
        let job = 0;
        const plateAt = (x, y) => {
            const i = Math.floor(x / 512), j = Math.floor(y / 512), key = plateKey("0", 0, i, j), G = stage.generation;
            plates.beginJob(++job, { frameId: "0", q: 0, Zq: zqOf(0) }, [{ i, j }], G);
            plates.put({ key, frameId: "0", q: 0, Zq: zqOf(0), i, j, G, jobId: job, bytes: 1 });
            plates.endJob(job);
            return key;
        };
        return { doc, stage, plates, fill, plateAt, exact: (k) => plates.isExact(plates.get(k)) };
    };
    test("a member that flips the family's routing stales the plates of its untouched siblings; one that does not, does not", () => {
        const { doc, stage, fill, plateAt, exact } = setup();
        doc.add(fill(0, 0, 400, 400), "0");                          // two siblings, far apart, same winding
        doc.add(fill(2000, 2000, 2400, 2400), "0");
        stage.sync("0", stage.window);
        const far = plateAt(2100, 2100);
        doc.add(fill(100, 100, 200, 200), "0");                      // same-wound, overlapping sibling 1: no flip
        expect(exact(far)).toBe(true);
        expect(stage.stats.familyFlips).toBe(0);
        doc.add(fill(350, 350, 450, 450, true), "0");                // wound against it, across its edge: the union pass
        expect(stage.stats.familyFlips).toBe(1);
        expect(exact(far)).toBe(false);                              // red without the rule: the far sibling's plate kept
    });
    test("an erase step under its mark is exempt", () => {
        let neutral = false;
        const mark = { id: 9999, _home: "0", type: "shape", loops: [] };
        const { doc, stage, fill, plateAt, exact } = setup(() => (neutral ? mark : null));
        doc.add(fill(0, 0, 400, 400), "0");
        doc.add(fill(2000, 2000, 2400, 2400), "0");
        stage.sync("0", stage.window);
        const far = plateAt(2100, 2100);
        neutral = true;
        doc.add(fill(350, 350, 450, 450, true), "0");
        neutral = false;
        expect(stage.stats.familyFlips).toBe(0);
        expect(exact(far)).toBe(true);
    });
});
