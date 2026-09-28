/**
 * The drag's hold, moved into the scene (A2-scene.md §2.7, B-SCENE's phase; PAPER-PLAN R3): while a
 * drag stands, events about its natives and about natives under its frames are held — the table keeps
 * the picture the drag plane was aimed from and they dirty nothing — and `release` applies them as ONE
 * commit whose dirt is where the selection started and where it ended.
 */
import Document from "./Document";
import LevelMap from "./LevelMap";
import TileStore from "./TileStore";
import Stage from "./Stage";
import PlateStore from "./raster/PlateStore";
import { createPlacementModel } from "./placementModel";
import { rectLoop } from "./geometry/arcShape";
import { addOffset } from "./geometry/offsets";
import { plateKey, zqOf } from "./raster/plate";
import { BASE, ENTER, EXIT, W } from "./frameLattice";
import { mkEngine, useEngines } from "./__testkit__/harness";

useEngines();

const CFG = { enter: ENTER, base: BASE, exit: EXIT, scale: 1000, arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3,
    cullPx: 0.3, fadeLoPx: 0.15, fatWidthPx: 4000, lineTolPx: 0.25 };

function world() {
    const lm = new LevelMap(CFG, 800, 600);
    const doc = new Document();
    doc.lm = lm;
    doc.frameFactor = (a, b) => lm.frameFactor(a, b);
    const store = new TileStore(lm, doc, CFG);
    const stage = new Stage({ doc, lm, store, model: createPlacementModel({ doc, lm, store }), cfg: CFG });
    const plates = new PlateStore({ fresh: stage, doc: null });
    stage.onCommit((G, info) => { for (const p of info.drop) plates.dropFrames(p); });
    lm.ensureSpine(1);
    stage.sync("0", { left: -W, top: -W, right: W, bottom: W });
    const shape = (x, y, s = 400) => {
        const o = { type: "shape", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, w: 3, loops: rectLoop({ left: x, top: y, right: x + s, bottom: y + s }) };
        doc.add(o, "0");
        return o;
    };
    // A stored plate over a rect of frame 0 (q 0: 512 units a plate), exact at the current G.
    let job = 0;
    const plateAt = (x, y) => {
        const i = Math.floor(x / 512), j = Math.floor(y / 512), key = plateKey("0", 0, i, j), G = stage.generation;
        plates.beginJob(++job, { frameId: "0", q: 0, Zq: zqOf(0) }, [{ i, j }], G);
        plates.put({ key, frameId: "0", q: 0, Zq: zqOf(0), i, j, G, jobId: job, bytes: 1 });
        plates.endJob(job);
        return key;
    };
    const exact = (key) => plates.isExact(plates.get(key));
    return { lm, doc, store, stage, plates, shape, plateAt, exact };
}

describe("the Stage's hold (A2 §2.7)", () => {
    test("200 drag steps of two held natives commit nothing and dirty nothing; the release is one commit, start and end", () => {
        const { doc, stage, shape, plateAt, exact } = world();
        const a = shape(-3000, -200), b = shape(-2000, -200), c = shape(6000, 3000);
        stage.sync("0", stage.window);
        const atStart = plateAt(-2900, -100), atEnd = plateAt(-2900 + 3000, -100), elsewhere = plateAt(6100, 3100), between = plateAt(-2900 + 1500, -100 + 4000);
        const itemsBefore = stage.itemsOf(a.id).length + stage.itemsOf(b.id).length;
        stage.hold({ ids: [a.id, b.id] });
        const G0 = stage.generation, commits = stage.stats.commits;
        for (let k = 1; k <= 200; k++) {
            for (const o of [a, b]) doc.setOffsetsById(o.id, addOffset(undefined, 0, (3000 * k) / 200, 0).below);
        }
        expect(stage.generation).toBe(G0);                          // red with the hold off: 400 commits
        expect(stage.stats.commits).toBe(commits);
        expect([atStart, atEnd, elsewhere, between].every(exact)).toBe(true);
        expect(stage.itemsOf(a.id).length + stage.itemsOf(b.id).length).toBe(itemsBefore);
        // A native outside the hold is applied as ever, meanwhile.
        doc.setOffsetsById(c.id, addOffset(undefined, 0, 10, 0).below);
        expect(stage.generation).toBe(G0 + 1);
        expect(exact(elsewhere)).toBe(false);
        expect(stage.release()).toBe(400);                           // the held events, applied
        expect(stage.generation).toBe(G0 + 2);                       // one commit for the drag
        expect(exact(atStart)).toBe(false);                          // where it was
        expect(exact(atEnd)).toBe(false);                            // where it is
        expect(exact(between)).toBe(true);                           // nowhere it passed through
        expect(stage.holding).toBe(false);
        // The table followed the release: the members are drawn where the drop put them.
        for (const o of [a, b]) for (const it of stage.itemsOf(o.id)) expect(it.off).toEqual([3000, 0]);
    });

    test("a held frame: its re-address is held, and the release removes the plates of frames under it", () => {
        const { lm, doc, stage, plates, plateAt } = world();
        const F = lm.cellChild("0", 7, 7);
        const kid = { type: "shape", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, w: 3, loops: rectLoop({ left: 0, top: 0, right: 900, bottom: 900 }) };
        doc.add(kid, F.id);
        stage.sync("0", stage.window);
        const inF = plateKey(F.id, 0, 0, 0);
        plates.beginJob(99, { frameId: F.id, q: 0, Zq: zqOf(0) }, [{ i: 0, j: 0 }], stage.generation);
        plates.put({ key: inF, frameId: F.id, q: 0, Zq: zqOf(0), i: 0, j: 0, G: stage.generation, jobId: 99, bytes: 1 });
        plates.endJob(99);
        const oldCell = plateAt(7 * 32, 7 * 32);
        stage.hold({ ids: [], frames: [F.id] });
        const G0 = stage.generation;
        const from = { parent: "0", i: 7, j: 7 }, to = { parent: "0", i: 9, j: 7 };
        lm.readdress(F.id, "0", 9, 7);
        doc.noteRefile(F.id, from, to);
        expect(stage.generation).toBe(G0);                           // held
        expect(plates.get(inF)).toBeTruthy();
        stage.release();
        expect(stage.generation).toBe(G0 + 1);
        expect(plates.get(inF)).toBeUndefined();                     // its id now means another place
        expect(plates.isExact(plates.get(oldCell))).toBe(false);     // the subtree left from there
    });

    test("a reset during a hold ends it", () => {
        const { doc, stage, shape } = world();
        const a = shape(0, 0);
        stage.hold({ ids: [a.id] });
        doc.loadNatives({ 0: [] });
        expect(stage.holding).toBe(false);
    });
});

describe("changesSince (A2 §2.4)", () => {
    test("a family re-key and a new paint key are changes of the items they move", () => {
        const { doc, stage, shape } = world();
        const a = shape(0, 0), b = shape(1000, 0);
        const G0 = stage.generation;
        a.editId = b.id; doc.keysChanged([a.id]);            // a family join: `fam` moved, the box did not
        expect(stage.changesSince(G0).changed.map((c) => c.item.id)).toEqual([a.id]);
        const G1 = stage.generation;
        doc.setZById(b.id, -5);                               // paint order moved
        expect(stage.changesSince(G1).changed.map((c) => c.item.id)).toEqual([b.id]);
    });
});

describe("bulk changes commit once (A2 §2.5)", () => {
    test("the undo and the redo of a 40-object delete are one commit each", () => {
        const E = mkEngine();
        const ids = [];
        for (let k = 0; k < 40; k++) {
            const x = -300 + (k % 8) * 70, y = -200 + Math.floor(k / 8) * 70;
            const o = { type: "fill", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, polys: [[[x, y], [x + 50, y], [x + 50, y + 50], [x, y + 50]]] };
            E.doc.add(o, "0");
            ids.push(o.id);
        }
        E._render();
        E._setSelection(ids, []);
        E.deleteSelection();
        expect(E.doc.getById(ids[0])).toBeFalsy();
        let c0 = E.stage.stats.commits;
        E.undo();                                               // red before: one commit a re-inserted object
        expect(E.doc.getById(ids[0])).toBeTruthy();
        expect(E.stage.stats.commits - c0).toBe(1);
        c0 = E.stage.stats.commits;
        E.redo();
        expect(E.doc.getById(ids[0])).toBeFalsy();
        expect(E.stage.stats.commits - c0).toBe(1);
    });
});
