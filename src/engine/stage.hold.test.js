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
import PyramidStore, { levelCell } from "./raster/PyramidStore";
import { createPlacementModel } from "./placementModel";
import { rectLoop } from "./geometry/arcShape";
import { addOffset } from "./geometry/offsets";
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
    const plates = new PyramidStore({ fresh: stage, doc: null });
    stage.onCommit((G, info) => { for (const p of info.drop) plates.dropFrames(p); });
    lm.ensureSpine(1);
    stage.sync("0", { left: -W, top: -W, right: W, bottom: W });
    const shape = (x, y, s = 400) => {
        const o = { type: "shape", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, w: 3, loops: rectLoop({ left: x, top: y, right: x + s, bottom: y + s }) };
        doc.add(o, "0");
        return o;
    };
    // A stored plate over a rect of frame 0 (level 0: 512 units a plate), exact at the current G.
    let job = 0;
    const plateAt = (x, y) => {
        const c = levelCell("0", 0, 1, Math.floor(x / 512), Math.floor(y / 512)), G = stage.generation;
        plates.beginJob(++job, [c], G);
        plates.put({ ...c, G, jobId: job, bytes: 1 });
        plates.endJob(job);
        return c.key;
    };
    const exact = (key) => plates.exact(plates.get(key));
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
        const cF = levelCell(F.id, 0, 1, 0, 0), inF = cF.key;
        plates.beginJob(99, [cF], stage.generation);
        plates.put({ ...cF, G: stage.generation, jobId: 99, bytes: 1 });
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
        expect(plates.exact(plates.get(oldCell))).toBe(false);       // the subtree left from there
    });

    test("a reset during a hold ends it", () => {
        const { doc, stage, shape } = world();
        const a = shape(0, 0);
        stage.hold({ ids: [a.id] });
        doc.loadNatives({ 0: [] });
        expect(stage.holding).toBe(false);
    });
});

const sq = (x, y, s) => ({ left: x, top: y, right: x + s, bottom: y + s });
const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
const met = (rs, r) => rs.some((x) => meets(x, r));

describe("a drop's dirt (F153): a moved shape's boundary sweep, else its boxes before and after", () => {
    test("a geometry replaced during the hold dirties both boxes, the old interior included", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 5000);
        stage.track("inside", "0", sq(2000, 2000, 10));
        const G = stage.generation;
        stage.hold({ ids: [a.id] });
        doc.setGeometryById(a.id, { loops: rectLoop(sq(100, 100, 100)) });
        stage.release();
        expect(stage.stats.swept).toBe(0);
        expect(stage.dirtySince("inside")).toBeGreaterThan(G);       // red as a sweep: the old interior kept
        expect(met(stage.dirtyRects("0", G), sq(2000, 2000, 10))).toBe(true);
    });

    test("257 moved shapes, past RECTS_MAX: every square's place before and after is dirt", () => {
        const { doc, stage, shape } = world(), ids = [];
        stage.batch(() => { for (let n = 0; n < 257; n++) ids.push(shape(n * 8, 0, 6).id); });
        const G = stage.generation;
        stage.hold({ ids });
        for (const id of ids) doc.setOffsetsById(id, addOffset(undefined, 0, 0, 20).below);
        stage.release();
        expect(stage.stats.swept).toBe(0);                          // `_grouped` would box them: none is made
        const rs = stage.dirtyRects("0", G);
        for (let n = 0; n < 257; n++) for (const y of [3, 23]) expect(met(rs, sq(n * 8 + 3, y, 0))).toBe(true);
    });

    test("a moved stroke dirties its two whole footprints", () => {
        const { doc, stage } = world();
        const o = { type: "stroke", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, pts: [[0, 0], [100, 0]], lwFrame: 20 };
        doc.add(o, "0");
        const G = stage.generation;
        stage.hold({ ids: [o.id] });
        doc.setOffsetsById(o.id, addOffset(undefined, 0, 0, 40).below);
        stage.release();
        expect(stage.stats.swept).toBe(0);
        const rs = stage.dirtyRects("0", G);
        for (const y of [-9, 49]) expect(met(rs, sq(50, y, 0))).toBe(true);
    });

    // 200 squares: the sweep is asked per box beside them; 300 and two drops: past RECTS_MAX states `_grouped` boxes the sweeps.
    test.each([[200, 1], [300, 2]])("%i new squares and %i drops in one commit: every moved edge and every square are dirt", (n, drops) => {
        const { doc, stage, shape } = world(), moved = [];
        for (let k = 0; k < drops; k++) moved.push(shape(k * 20000, 0, 5000));
        const G = stage.generation;
        stage.batch(() => {
            for (let k = 0; k < n; k++) shape(k * 10, 6000, 5);
            stage.hold({ ids: moved.map((o) => o.id) });
            for (const o of moved) doc.setOffsetsById(o.id, addOffset(undefined, 0, 40, 0).below);
            stage.release();
        });
        const rs = stage.dirtyRects("0", G);
        expect(rs.length).toBeLessThanOrEqual(256);
        for (let k = 0; k < drops; k++) for (const x of [20, 5020]) expect(met(rs, sq(k * 20000 + x, 2500, 0))).toBe(true);
        for (let k = 0; k < n; k++) expect(met(rs, sq(k * 10 + 2, 6002, 0))).toBe(true);
    });

    test("asked per cell: a coarse cell over both of a moved square's edges is dirt, a fine one between them is not", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 5000);
        const coarse = sq(0, 0, 8192), fine = sq(1024, 1024, 512);
        stage.track("coarse", "0", coarse);
        stage.track("fine", "0", fine);
        const G = stage.generation;
        stage.hold({ ids: [a.id] });
        doc.setOffsetsById(a.id, addOffset(undefined, 0, 40, 0).below);
        stage.release();
        expect(stage.stats.swept).toBe(1);
        expect(stage.dirtySince("coarse")).toBeGreaterThan(G);
        expect(stage.dirtySince("fine")).toBe(0);                    // the coarse cell's two edges merged, handed out frame-wide, would dirty it
        expect(stage.dirtyRects("0", G, fine)).toEqual([]);
        stage.track("late", "0", fine, G);
        expect(stage.dirtySince("late")).toBe(0);
        const rs = stage.dirtyRects("0", G, coarse);
        expect(rs.length).toBeGreaterThan(0);
        expect(rs.every((r) => r.left >= coarse.left && r.right <= coarse.right && r.top >= coarse.top && r.bottom <= coarse.bottom)).toBe(true);
    });

    test("a far move: where it was and where it is are dirt, the cells on the way between are not", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 100);
        stage.track("way", "0", sq(1000, 40, 20));
        stage.track("from", "0", sq(40, 40, 10));
        stage.track("to", "0", sq(2040, 40, 10));
        const G = stage.generation;
        stage.hold({ ids: [a.id] });
        doc.setOffsetsById(a.id, addOffset(undefined, 0, 2000, 0).below);
        stage.release();
        expect(stage.stats.swept).toBe(1);
        expect(stage.dirtySince("way")).toBe(0);                     // red with the sweep not cut to its boxes: the left edge crosses it
        expect(stage.dirtySince("from")).toBeGreaterThan(G);
        expect(stage.dirtySince("to")).toBeGreaterThan(G);
        expect(stage.dirtyRects("0", G, sq(1000, 40, 20))).toEqual([]);
        const half = stage.dirtyRects("0", G, { left: -10, top: -10, right: 1000, bottom: 110 });   // where it was and half the way
        expect(half.length).toBe(1);
        expect(half[0].right).toBeLessThanOrEqual(100);              // red with the pieces' sweep not cut to its boxes: x 1,000
    });

    test("a native another event changed in the hold, or whose look changed, keeps its boxes: its whole interior is dirt", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 5000), b = shape(10000, 0, 5000), c = shape(20000, 0, 5000);
        stage.track("inA", "0", sq(2000, 2000, 10));
        stage.track("inB", "0", sq(12000, 2000, 10));
        stage.track("inC", "0", sq(22000, 2000, 10));
        const G = stage.generation;
        stage.hold({ ids: [a.id, b.id, c.id] });
        doc.setZById(a.id, -5);                                      // drawn under everything now
        doc.getById(b.id).obj.color = "#456";                        // changed with no event
        doc.setHandledById(c.id, 99999);                             // a mark's bake dealt with it: what masks it changed
        for (const o of [a, b, c]) doc.setOffsetsById(o.id, addOffset(undefined, 0, 40, 0).below);
        stage.release();
        expect(stage.stats.swept).toBe(0);
        expect(stage.dirtySince("inA")).toBeGreaterThan(G);          // red as a sweep: its order changed everywhere
        expect(stage.dirtySince("inB")).toBeGreaterThan(G);          // red as a sweep: its colour changed everywhere
        expect(stage.dirtySince("inC")).toBeGreaterThan(G);          // red as a sweep: its mask may have changed everywhere
    });

    test("a sweep's mapping follows the lattice: re-addressed, its frame's dirt is asked where the frame now is", () => {
        const { lm, doc, stage } = world();
        const K = lm.cellChild("0", 7, 7);
        const kid = { type: "shape", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, w: 3, loops: rectLoop(sq(0, 0, 900)) };
        doc.add(kid, K.id);
        stage.sync("0", stage.window);
        const G = stage.generation;
        stage.hold({ ids: [kid.id] });
        doc.setOffsetsById(kid.id, addOffset(undefined, 0, 90, 0).below);
        stage.release();
        expect(stage.stats.swept).toBe(1);
        const was = stage.dirtyRects("0", G);
        expect(was.length).toBe(1);
        lm.readdress(K.id, "0", 9, 7);
        const now = stage.dirtyRects("0", G);
        expect(now[0].left - was[0].left).toBeCloseTo(2 * 32, 6);     // red with a mapping kept across the re-address
        expect(now[0].top).toBeCloseTo(was[0].top, 6);
    });

    test("a commit's cells classified in one descent agree with each cell asked alone, over 400 random boxes", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 5000), b = shape(6000, 1000, 300);
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const boxes = Array.from({ length: 400 }, () => sq(rnd() * 7000 - 500, rnd() * 6000 - 500, 1 + rnd() * 600));
        boxes.forEach((x, k) => stage.track("c" + k, "0", x));
        const G = stage.generation;
        stage.hold({ ids: [a.id, b.id] });
        doc.setOffsetsById(a.id, addOffset(undefined, 0, 37, -23).below);
        doc.setOffsetsById(b.id, addOffset(undefined, 0, -800, 400).below);   // farther than it is wide
        stage.release();
        expect(stage.stats.swept).toBe(2);
        let dirt = 0;
        boxes.forEach((x, k) => {
            stage.track("late" + k, "0", x, G);
            const once = stage.dirtySince("c" + k) > G, alone = stage.dirtySince("late" + k) > G;
            expect(once).toBe(alone);
            if (alone) expect(stage.dirtyRects("0", G, x).length).toBeGreaterThan(0);
            if (once) dirt++;
        });
        expect(dirt).toBeGreaterThan(10);
        expect(dirt).toBeLessThan(boxes.length);
    });

    test("a snapshot read before the drop is not fresh after it; a cell tracked later from before it is dirty; a far one is not", () => {
        const { doc, stage, shape } = world(), a = shape(0, 0, 5000);
        stage.track("far", "0", sq(10000, 10000, 10));
        const snap = stage.snapshot("0", sq(-1, 100, 10)), G = stage.generation;
        stage.hold({ ids: [a.id] });
        doc.setOffsetsById(a.id, addOffset(undefined, 0, 40, 0).below);
        stage.release();
        expect(snap.fresh()).toBe(false);
        stage.track("late", "0", sq(-1, 100, 10), G);
        expect(stage.dirtySince("late")).toBeGreaterThan(G);
        expect(stage.dirtySince("far")).toBe(0);
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
