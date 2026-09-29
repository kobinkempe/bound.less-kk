/**
 * erase.rule.test.js — the erase rule's document side (A2 §4, §5): Kobin's semantics traced through
 * the fields; the landing's one commit; the pick; the load-time derivation for a kobin-1 file and a
 * kobin-2 store written before `targets`; undo, redo and a replay after a reload agreeing (§4.10); and
 * the parallel bake leaving the serial bake's ids, steps and log (§4.7).
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, descend, topView } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";
import { setEraseTransport } from "./eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "./eraseDescent";
import { underMask, inLineage } from "./eraseRule";
import Document from "./Document";
import { shapeFromRings, normalizeLoops } from "./geometry/arcShape";
import { lcg } from "./__testkit__/rasterLists";
import { buildReport } from "./report";

// The rule with its `handledBy` clause switchable off, everywhere it is read (the pack, the bake, the
// barriers): the wrong rule the step budget must survive (PLAN §5.8 item 3).
let mockWrongRule = false;
jest.mock("./eraseRule", () => {
    const actual = jest.requireActual("./eraseRule");
    return { ...actual, underMask: (o, M) => (mockWrongRule ? actual.inLineage(o, M) : actual.underMask(o, M)) };
});

useEngines();
jest.setTimeout(60000);
afterEach(() => { mockWrongRule = false; });
afterEach(() => setEraseTransport(null));

const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const fill = (E, x0, y0, x1, y1, color = "rgb(40,40,200)") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] }, "0");
const live = (E) => { const out = []; for (const L of E.doc.levels()) for (const o of E.doc.list(L)) out.push(o); return out; };
/** The document as a set: each frame's natives by id, as headers. */
const state = (E) => {
    const n = E.doc.serializeNatives(), out = [];
    for (const k of Object.keys(n).sort()) if (n[k].length) out.push([k, n[k].map((o) => JSON.stringify(o)).sort()]);
    return JSON.stringify(out);
};
const settle = (E) => { E.flushErases(); E.flushBakes(); };
function snapshot(E, log) {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
    return { frames, frameSeq, camera: E.cam.state() };
}
function restore(snap, entries, crossings, strip = false) {
    const F = mkEngine();
    F._scheduleBake = () => {};
    const nat = {};
    for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
    if (strip) for (const L of Object.keys(nat)) for (const o of nat[L]) { delete o.targets; delete o.targetOf; delete o.handledBy; }
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings, natives: nat }, { render: false });
    const log = new OpLog(F);
    log.replay(entries, snap.frameSeq, Object.keys(snap.frames));
    F._eraseLoaded();
    return { F, log };
}

test("the rule as a function: each clause decides on its own (A2 §4.2)", () => {
    // The engine cannot reach the first three today (registration names only natives below the mark,
    // and a native's z never changes); the rule states them, and these pin them.
    const M = { id: 7, z: 7, erase: true, targets: [3] };
    const T = { id: 3, targetOf: [7] };
    expect(underMask(T, M)).toBe(true);
    expect(underMask(T, { ...M, targets: undefined })).toBe(false);          // a mark that has not landed
    expect(underMask({ ...T, z: 9 }, M)).toBe(false);                        // above the mark
    expect(underMask({ ...T, erase: true }, M)).toBe(false);                 // a mark is never masked
    expect(underMask({ ...T, targetOf: [5] }, M)).toBe(false);               // not in the lineage
    expect(underMask({ ...T, handledBy: [7] }, M)).toBe(false);              // handled
    expect(inLineage({ ...T, handledBy: [7] }, M)).toBe(true);
    expect(inLineage({ ...T, z: 9 }, M) || inLineage(T, { ...M, targets: undefined })).toBe(false);
});

test("a cede passes the lineage on: its pieces keep `targetOf`, gain `by` in `handledBy`, and its events carry `by` (A2 §4.3)", () => {
    const d = new Document();
    const src = { type: "fill", origin: "native", id: d.allocId(), polys: [[[0, 0], [100, 0], [100, 100], [0, 100]]],
        color: "#000", opacity: 1, targetOf: [7, 9], handledBy: [4] };
    d.add(src, "0");
    const by = [];
    d.subscribe((ev) => { if (ev.kind === "add" || ev.kind === "remove") by.push(ev.by); });
    const rect = { x0: 10, y0: 10, x1: 90, y1: 90 };
    const step = d.cedeTileById(src.id, "1", [normalizeLoops(shapeFromRings([[[10, 20], [40, 20], [40, 80], [10, 80]]]))],
        rect, rect, undefined, undefined, undefined, undefined, 7);
    expect(step.pieces.length).toBeGreaterThan(1);                          // the cut parent and the kid
    for (const p of step.pieces) {
        expect(p.obj.targetOf).toEqual([7, 9]);
        expect(p.obj.handledBy).toEqual([4, 7]);
    }
    expect(by.length).toBeGreaterThan(1);
    expect(by.every((b) => b === 7)).toBe(true);
});

describe("A2 §5: Kobin's semantics, through the fields", () => {
    test("5.1 the landing records the targets in the commit that lands the shape; an object dragged across is not one, never cut", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 300, 250, 500, 350), Y = fill(E, 80, 420, 180, 500, "rgb(30,160,30)");
        E._render();
        E.setEraserSize(20); E.setTool("erasePartial");
        E.pointerDown(400, 200); E.pointerMove(400, 400); E.pointerUp();
        const M = E._marks.get(E.doc._nextId - 1);
        expect(M.type).toBe("stroke");                                        // pending in the scene: unlanded
        expect(M.targets).toBeUndefined();
        const G0 = E.stage.generation, bare = [];
        const off = E.stage.onCommit((G) => { const r = E.doc.getById(M.id); if (r && r.obj.type === "shape" && r.obj.targets === undefined) bare.push(G); });
        E.flushBakes();
        off();
        expect(M.targets).toEqual([T.id]);
        expect(E.stage.landedAt(M.id)).toBe(G0 + 1);                          // one commit: the shape, the frames pass, the targets
        expect(bare).toEqual([]);                                             // no commit shows the shape without its targets
        expect(E.stage.generation).toBe(G0 + 1);
        expect(underMask(T, M)).toBe(true);
        E.doc.moveById(Y.id, 280, -180);                                      // across the mark, after its registration
        expect(underMask(E.doc.getById(Y.id).obj, M)).toBe(false);
        const cut = new Set();
        E.doc.subscribeOps((ev) => { if (ev.kind === "bake" && ev.step.removed) cut.add(ev.step.removed.obj.id); });
        E.flushErases();
        expect([...cut]).toEqual([T.id]);
        expect(E.doc.getById(Y.id)).not.toBeNull();
    });

    test("a cut on a pending pair dirties the target's box inside the mark's box, and the dust it dropped wherever it lies (PLAN §5.3 A2-Q2)", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        // a body with a hairline tail to the right: the cut at x 410..430 leaves the tail's far part as dust (0.1 wide)
        const T = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(40,40,200)", opacity: 1,
            polys: [[[300, 270], [400, 270], [400, 299.95], [560, 299.95], [560, 300.05], [400, 300.05], [400, 330], [300, 330]]] }, "0");
        E.doc.fillToShapeById(T.id);                                           // a shape, as ink is (a fill's promotion is a change of its own)
        E._render();
        eraseGesture(E, [[420, 200], [420, 400]], 10);
        const M = E._eraseStrokes()[0].obj;
        expect(M.targets).toEqual([T.id]);
        const G = E.stage.generation;
        E._bakeNext();
        expect(E.doc.getById(T.id)).toBeNull();
        const rects = E.stage.dirtyRects("0", G);
        const covers = (x, y) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        expect(covers(420, 300)).toBe(true);                                   // the band under the mark
        expect(covers(500, 300)).toBe(true);                                   // the dust, outside the mark's box
        expect(covers(350, 300)).toBe(false);                                  // the rest of the body: its pixels did not change
        expect(E.stage.stats.neutral).toBeGreaterThan(0);
    });

    test("malformed fields are dropped on load and the objects kept; the lineage is derived again from the marks", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 300, 250, 500, 350);
        E._render();
        eraseGesture(E, [[400, 200], [400, 400]], 20);
        const M = E._eraseStrokes()[0].obj;
        const d = E.serializeDrawing();
        const h = d.natives["0"].find((o) => o.id === T.id), m = d.natives["0"].find((o) => o.id === M.id);
        h.targetOf = ["x", 2]; h.handledBy = [M.id, M.id]; m.targets = "garbage";
        const F = mkEngine(800, 600);
        F._scheduleBake = () => {};
        F.loadDrawing(d);
        const o = F.doc.getById(T.id).obj, FM = F.doc.getById(M.id).obj;
        expect(FM.targets).toEqual([T.id]);                                    // registered again, by the scan under its z
        expect(o.targetOf).toEqual([M.id]);                                    // derived from it
        expect(o.handledBy).toEqual([M.id]);                                   // an id list, deduplicated
    });

    test("5.2 a stroke drawn over a pending mark is above it, no target, never cut", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 300, 250, 500, 350);
        E._render();
        eraseGesture(E, [[400, 200], [400, 400]], 20);
        const M = E._eraseStrokes()[0].obj;
        const S = drawStroke(E, [[320, 300], [480, 300]], 10);
        expect(S.id > M.id && !underMask(S, M)).toBe(true);
        E.flushErases();
        expect(E.doc.getById(S.id)).not.toBeNull();
        expect(E.doc.getById(T.id)).toBeNull();
    });

    test("5.3 a piece its mark has baked is handled: never masked by it, wherever it is dragged; still masked by an older mark not yet baked", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 200, 250, 600, 350);
        E._render();
        eraseGesture(E, [[300, 200], [300, 400]], 20);                         // M0, older
        eraseGesture(E, [[500, 200], [500, 400]], 20);                         // M
        const [M0, M] = E._eraseStrokes().map((m) => m.obj);
        const r = E._dispatchPair(E.doc.getById(M.id), E.doc.getById(T.id), { inline: true });   // M first, out of the serial order (a test's reach)
        expect(r).toBe("applied");
        const pieces = live(E).filter((o) => !o.erase);
        for (const p of pieces) {
            expect(p.handledBy).toEqual([M.id]);
            expect(underMask(p, M)).toBe(false);                               // shows over M
            expect(underMask(p, M0)).toBe(p.targetOf.includes(M0.id));         // still under M0 until M0 cuts it
        }
    });

    test("the pick follows the mask; a press in the first slices after an eraser's pen-up lands the mark first (A2 §4.12)", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 300, 250, 500, 350);
        E._render();
        E.setEraserSize(20); E.setTool("erasePartial");
        E.pointerDown(400, 200); E.pointerMove(400, 400); E.pointerUp();       // not landed yet
        E.setTool("select");
        E.pointerDown(400, 300);                                               // on the mark's ink, over T
        expect(E._eraseStrokes()).toHaveLength(1);                            // landed by the press
        expect(E._selPress.hit).toBeNull();                                    // T is hidden there: nothing picked
        E.pointerUp();
        expect(E.hitTestAt(330, 300)).toBe(T.id);                              // off the mark, T shows and is picked
    });

    test("nothing moves under a mark before its targets are recorded: until the landing its op is on top of the undo stack", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 300, 250, 500, 350);
        E._render();
        E.setEraserSize(20); E.setTool("erasePartial");
        E.pointerDown(400, 200); E.pointerMove(400, 400); E.pointerUp();
        const top = E.doc._undo[E.doc._undo.length - 1];
        expect(top.op).toBe("eraseCommit");
        expect(E.doc.getById(top.strokeId).obj.type).toBe("stroke");          // the mark, unlanded
        E.undo();                                                              // the only undo there is takes the mark
        expect(E._marks.size).toBe(0);
        expect(E.doc.getById(T.id).obj.targetOf).toBeUndefined();
    });
});

describe("A2 §4.9: the load-time derivation for a file from before `targets`", () => {
    /** Three bars under one mark; the old bake's first step cut the top bar and stepped the mark's z below it. */
    const oldDrawing = () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);                                             // attached from the start, as the saver's is
        E._scheduleBake = () => {};
        const bars = [fill(E, 200, 200, 600, 240, "rgb(200,40,40)"), fill(E, 200, 280, 600, 320, "rgb(40,160,40)"), fill(E, 200, 360, 600, 400, "rgb(40,40,200)")];
        E._render();
        eraseGesture(E, [[400, 150], [400, 450]], 20);
        return { E, log, bars, M: E._eraseStrokes()[0].obj };
    };
    const shapes = (E) => live(E).filter((o) => !o.erase).map((o) => [o.z != null ? o.z : o.id, o.color, JSON.stringify(o.loops.map((l) => Array.from(l.buf)))].join("|")).sort();
    test("kobin-1: the mark registers by its stepped z, and the bake ends as an uninterrupted one", () => {
        const { E, bars, M } = oldDrawing();
        const R = mkEngine(800, 600); R._scheduleBake = () => {};
        R.loadDrawing(E.serializeDrawing()); R.flushErases();
        const want = shapes(R);
        E._bakeNext();                                                        // the top bar (z 3) cut
        const d = E.serializeDrawing();
        for (const k of Object.keys(d.natives)) for (const o of d.natives[k]) {
            delete o.targetOf; delete o.handledBy; delete o.targets;          // written before the fields
            if (o.erase) o.z = bars[2].id - 0.5;                              // and the old bake's step below the bar it cut
        }
        const F = mkEngine(800, 600); F._scheduleBake = () => {};
        F.loadDrawing(d);
        const FM = F._eraseStrokes()[0].obj;
        expect(FM.targets).toEqual([bars[0].id, bars[1].id]);                 // the cut bar's pieces lie above the stepped z
        F.flushErases();
        expect(shapes(F)).toEqual(want);
        expect(M).toBeTruthy();
    });
    test("kobin-2: a mark's log names what its bake had done; those pieces are handled, not targets, and the derivation is logged once", () => {
        const { E, log, bars, M } = oldDrawing();
        const R = mkEngine(800, 600); R._scheduleBake = () => {};
        R.loadDrawing(E.serializeDrawing()); R.flushErases();
        const want = shapes(R);
        const d0 = log.drain();
        const snap = snapshot(E, log);
        E._bakeNext();
        const entries = [...d0.entries, ...log.drain().entries].filter((e) => e.op.k !== "attr");   // an old build logs no `attr`
        for (const e of entries) for (const o of [e.op.obj, e.op.removed && e.op.removed.obj, ...(e.op.pieces || [])]) if (o) { delete o.targetOf; delete o.handledBy; delete o.targets; }
        const { F, log: FL } = restore(snap, entries, E.lm.serialize(), true);
        const FM = F.doc.getById(M.id).obj;
        expect(FM.targets).toEqual([bars[0].id, bars[1].id]);                 // not the pieces the log's bake entry named
        const pieces = live(F).filter((o) => o.color === "rgb(40,40,200)");
        expect(pieces.length).toBe(2);
        for (const p of pieces) expect(p.handledBy).toEqual([M.id]);
        const again = FL.drain().entries.filter((e) => e.op.k === "attr" && e.op.id === M.id && e.op.set.targets);
        expect(again).toHaveLength(1);                                         // `targets` logged: the derivation runs once
        F.flushErases();
        expect(shapes(F)).toEqual(want);                                       // nothing cut twice
    });
});

describe("A2 §4.10: undo, redo and a replay after a reload agree", () => {
    const walk = (E) => {
        settle(E);
        const states = [state(E)];
        while (E.doc.canUndo()) { E.undo(); settle(E); states.push(state(E)); }
        for (let k = states.length - 2; k >= 0; k--) { E.redo(); settle(E); expect(state(E) === states[k]).toBe(true); }
        return states;
    };
    // Each case draws its ink (`fill` adds no op), `snap()` stores the frames, then its gestures run.
    const cases = {
        "the mark undone mid-bake, then redone: its targets pending again, the bake resumes": (E, snap) => {
            fill(E, 200, 200, 600, 240); fill(E, 200, 280, 600, 320);
            E._render(); snap();
            eraseGesture(E, [[400, 150], [400, 450]], 20);
            E._bakeNext();
            return () => { E.undo(); };
        },
        "an older erase undone after a newer one was drawn over its pieces": (E, snap) => {
            fill(E, 200, 250, 600, 350);
            E._render(); snap();
            eraseGesture(E, [[300, 200], [300, 400]], 20);
            settle(E);                                                        // K baked and spent
            eraseGesture(E, [[250, 300], [550, 300]], 20);                     // M over K's pieces
            return () => { E.undo(); E.undo(); };
        },
        "a mark undone, its target cut by another mark, the mark redone": (E, snap) => {
            fill(E, 200, 250, 600, 350);
            E._render(); snap();
            eraseGesture(E, [[300, 200], [300, 400]], 20);                     // M1
            eraseGesture(E, [[500, 200], [500, 400]], 20);                     // M2
            const M2 = E._eraseStrokes()[1].obj;
            E.flushErases(new Set([M2.id]));                                   // M2 cuts the target M1 still waits on
            return () => { E.undo(); E.redo(); };
        },
    };
    for (const [name, build] of Object.entries(cases)) {
        test(`${name}`, () => {
            const E = mkEngine(800, 600);
            E._scheduleBake = () => {};
            const log = new OpLog(E);
            let d0 = null, snap = null;
            const then = build(E, () => { d0 = log.drain(); snap = snapshot(E, log); });
            then();
            const d1 = log.drain();
            const { F } = restore(snap, [...d0.entries, ...d1.entries], E.lm.serialize());
            expect(state(F) === state(E)).toBe(true);
            expect(F.doc._undo.length).toBe(E.doc._undo.length);
            expect(F.doc._redo.length).toBe(E.doc._redo.length);
            const a = walk(E), b = walk(F);
            expect(JSON.stringify(b) === JSON.stringify(a)).toBe(true);
        });
    }
});

describe("undo under a newer mark (A2-Q9, R-ERASE item 7)", () => {
    const names = (E, m) => live(E).filter((o) => (o.targetOf || []).includes(m) || (o.handledBy || []).includes(m)).map((o) => o.id);
    const setup = () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const T = fill(E, 200, 250, 600, 350);
        E._render();
        eraseGesture(E, [[300, 200], [300, 400]], 20);                         // K, baked and spent
        const K = E._eraseStrokes()[0].obj;
        settle(E);
        eraseGesture(E, [[250, 300], [550, 300]], 20);                         // M over K's pieces, pending
        const M = E._eraseStrokes()[0].obj;
        return { E, T, K, M };
    };
    test("undo takes the newer mark first, then the older erase; redo gives back the same drawing, and the newer mark re-cuts", () => {
        const { E, T, K, M } = setup();
        const pending = state(E);
        expect(M.targets.length).toBeGreaterThan(0);
        E.undo();                                                               // M: pending, removed whole
        expect(E._eraseStrokes()).toHaveLength(0);
        E.undo();                                                               // K: its source back whole
        settle(E);
        expect(E.doc.getById(T.id)).not.toBeNull();
        expect(names(E, K.id)).toEqual([]);                                     // a spent mark named by nothing live
        E.redo(); E.redo();
        expect(state(E) === pending).toBe(true);                                // M pending over K's pieces again
        settle(E);
        const ref = setup();
        settle(ref.E);
        expect(state(E) === state(ref.E)).toBe(true);                           // as if never undone
    });
    test("drawing after the undos drops the redo branch: nothing live names its marks", () => {
        const { E, M } = setup();
        E.undo(); E.undo(); E.redo();                                           // K back; M still on the redo stack
        expect(names(E, M.id).length).toBeGreaterThan(0);                       // K's pieces carry M: it can return
        drawStroke(E, [[100, 100], [140, 120]], 6);                             // a new op: M can never return
        expect(names(E, M.id)).toEqual([]);
    });
    test("a mark undone, redone and spent is not kept alive by its gesture's stale record", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        fill(E, 200, 250, 600, 290); fill(E, 200, 310, 600, 350, "rgb(200,60,40)");
        E._render();
        eraseGesture(E, [[400, 200], [400, 400]], 20);
        const K = E._eraseStrokes()[0].obj;
        E.undo(); E.redo();
        E._bakeNext();                                                          // K cuts the upper target first
        const piece = live(E).find((o) => (o.handledBy || []).includes(K.id));
        E._setSelection([piece.id]); E.deleteSelection();                       // a piece out while K is pending
        settle(E);                                                              // K spent
        expect(E.doc.getById(K.id)).toBeNull();
        E.undo();                                                               // the delete: the piece comes back
        expect(E.doc.getById(piece.id)).not.toBeNull();
        expect(names(E, K.id)).toEqual([]);
    });
});

describe("PLAN §5.8 item 3: the bake terminates — a step budget per mark", () => {
    const stack = (E) => {
        E._scheduleBake = () => {};
        fill(E, 200, 200, 600, 260); fill(E, 220, 300, 580, 360, "rgb(200,60,40)"); fill(E, 260, 380, 540, 440, "rgb(40,160,60)");
        E._render();
        eraseGesture(E, [[300, 150], [320, 480]], 20);
        eraseGesture(E, [[480, 150], [460, 480]], 24);
        eraseGesture(E, [[180, 330], [620, 330]], 16);                     // over the first two marks' pieces
    };
    /** The mark's steps against what it was given, read as each mark is spent. */
    const ratios = (E) => {
        const out = [], spend = E._spendMark.bind(E);
        E._spendMark = (Erec) => { const b = E._budget.get(Erec.obj.id); if (b) out.push(b.n / Math.max(1, b.supply)); spend(Erec); };
        return out;
    };
    /** A deliberately wrong rule: `handledBy` ignored, so a mark's own pieces are pending under it and its bake never empties. */
    const wrongRule = () => { mockWrongRule = true; };
    const quiet = () => jest.spyOn(console, "error").mockImplementation(() => {});

    test("the correct rule never reaches the budget: each pending id costs one step, through undo and redo mid-bake", () => {
        const E = mkEngine(800, 600);
        stack(E);
        const seen = ratios(E);
        E._bakeNext(); E._bakeNext();
        E.undo(); E.redo();                                                     // the newest mark's gesture, mid-bake
        E._bakeNext();
        E.undo(); E.undo(); E.redo(); E.redo();
        settle(E);
        expect(E._eraseStrokes()).toHaveLength(0);
        expect(E._eraseAborted).toEqual([]);
        expect(seen.length).toBeGreaterThan(2);
        expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    });

    test("a frame set aside and returned under a pending mark grows its budget: twenty targets back, no false abort", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        fill(E, 380, 280, 420, 320);                                            // X, at the root
        descend(E, 1, 400, 300);
        const F = E.cam.frame, [cx, cy] = E.cam.screenToFrame(400, 300);
        for (let k = 0; k < 20; k++) E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(40,40,200)", opacity: 1, polys: [[[cx - 300 + 30 * k, cy - 40], [cx - 280 + 30 * k, cy - 40], [cx - 280 + 30 * k, cy + 40], [cx - 300 + 30 * k, cy + 40]]] }, F);
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), z: 1e9, color: "#000", opacity: 1, polys: [[[cx + 900, cy], [cx + 910, cy], [cx + 910, cy + 10], [cx + 900, cy + 10]]] }, F);   // drawn above any mark: M does not take F whole
        topView(E);
        eraseGesture(E, [[330, 300], [470, 300]], 30);                          // M over X and the whole of F's ink
        const M = E._eraseStrokes()[0].obj;
        expect(M.targets.length).toBe(21);
        const aside = E.doc.removeFrameSubtree(F);                              // as another mark's frames pass would
        E._bakeNext();                                                          // M's first step: its budget is taken with F away
        E.doc.insertFrameSubtree(aside);                                        // that mark undone: F's twenty back, pending under M
        const err = quiet();
        E.flushErases();
        expect(E._eraseAborted).toEqual([]);
        expect(err).not.toHaveBeenCalled();
        err.mockRestore();
    });

    test("targets an undo returns after a mark's first step grow its budget: twenty back, no false abort", () => {
        const E = mkEngine(800, 600);
        E._scheduleBake = () => {};
        const X = fill(E, 180, 290, 200, 310);
        const ts = [];
        for (let k = 0; k < 20; k++) ts.push(fill(E, 250 + 16 * k, 280, 260 + 16 * k, 320, "rgb(200,60,40)"));
        E._render();
        eraseGesture(E, [[150, 300], [650, 300]], 12);                          // M over X and the twenty
        const M = E._eraseStrokes()[0].obj;
        expect(M.targets).toContain(X.id);
        E._setSelection(ts.map((t) => t.id)); E.deleteSelection();              // the twenty out
        E._bakeNext();                                                          // M's first step, on X: its budget taken with them away
        E.undo();                                                               // the delete: the twenty back, pending under M
        const err = quiet();
        E.flushErases();
        expect(E._eraseAborted).toEqual([]);
        expect(err).not.toHaveBeenCalled();
        err.mockRestore();
    });

    test("a wrong rule fails loudly within the budget instead of hanging: flushErases", async () => {
        const E = mkEngine(800, 600);
        stack(E);
        wrongRule(E);
        const err = quiet();
        E.flushErases();
        expect(E._eraseStrokes()).toHaveLength(0);
        expect(E._eraseAborted.length).toBeGreaterThan(0);
        for (const a of E._eraseAborted) expect(a.steps).toBeLessThanOrEqual(a.limit);
        expect(err).toHaveBeenCalled();
        expect(E._eraseStatus().aborted).toBe(E._eraseAborted.length);
        const rep = await buildReport(E);
        expect(rep.erase.counters.aborted.map((a) => a.mark)).toEqual(E._eraseAborted.map((a) => a.mark));
        err.mockRestore();
    });

    test("a wrong rule fails loudly within the budget: the tick, through a pool of three", async () => {
        const E = mkEngine(800, 600);
        stack(E);
        wrongRule(E);
        const err = quiet();
        setEraseTransport((msg, transfer, kind) => later(1).then(() => (kind === "descent"
            ? wireDescentResult(descentJob(...Object.values(unwireDescent(msg)))).msg
            : wireResult(cutJob(unwireJob(msg))).msg)));
        let k = 0;
        for (; k < 3000 && (E._eraseStrokes().length || E._eraseBusy()); k++) { E._bakeTickInner(); await later(2); }
        expect(k).toBeLessThan(3000);
        expect(E._eraseStrokes()).toHaveLength(0);
        expect(E._eraseAborted.length).toBeGreaterThan(0);
        err.mockRestore();
    });

    test("a wrong rule in an inline barrier with no worker: the tap completes, every mark within its budget", () => {
        const E = mkEngine(800, 600);
        stack(E);
        wrongRule(E);
        const err = quiet();
        E.setTool("select");
        const id = E.select(250, 305);                                          // the second fill: under all three marks
        expect(E._barrier).toBeNull();                                          // the rounds end (a pair its own step left pending is set aside)
        for (const a of E._eraseAborted) expect(a.steps).toBeLessThanOrEqual(a.limit);
        E.flushErases();                                                        // and the rest fails loudly within the budget
        expect(E._eraseStrokes()).toHaveLength(0);
        expect(E._eraseAborted.length).toBeGreaterThan(0);
        expect(id == null || E.doc.getById(id) != null).toBe(true);
        err.mockRestore();
    });
});

describe("A2 §4.7: the parallel bake leaves the serial bake's document, ids, steps and log", () => {
    const build = (E, seed) => {
        const rnd = lcg(seed);
        E._scheduleBake = () => {};
        for (let k = 0; k < 9; k++) { const x = 150 + rnd() * 350, y = 150 + rnd() * 250; fill(E, x, y, x + 60 + rnd() * 160, y + 40 + rnd() * 120, "rgb(" + (20 + 20 * k) + ",90,150)"); }
        E._render();
        eraseGesture(E, [[180, 200], [620, 420]], 16);
        eraseGesture(E, [[200, 420], [600, 180]], 24);
        eraseGesture(E, [[400, 120], [410, 480]], 12);
    };
    const steps = (E) => E.doc._undo.filter((op) => op.op === "eraseCommit").map((op) => op.baked.map((st) => [st._seq, st.removed ? st.removed.obj.id : null, (st.pieces || []).map((p) => p.obj.id)]));
    const entries = (log) => log.drain().entries.map((e) => [e.seq, JSON.stringify(e.op), e.touches]);
    for (const seed of [2, 5, 8]) {
        test("seed " + seed + ": shuffled arrivals from three workers", async () => {
            const S = mkEngine(800, 600), SL = new OpLog(S);
            build(S, seed);
            SL.drain();
            for (let k = 0; k < 1000 && S._eraseStrokes().length; k++) S._bakeTickInner();
            const P = mkEngine(800, 600), PL = new OpLog(P);
            build(P, seed);
            PL.drain();
            const rnd = lcg(seed * 7 + 1);
            setEraseTransport((msg, transfer, kind) => later(1 + Math.floor(rnd() * 12)).then(() => (kind === "descent"
                ? wireDescentResult(descentJob(...Object.values(unwireDescent(msg)))).msg
                : wireResult(cutJob(unwireJob(msg))).msg)));
            let flying = 0;
            for (let k = 0; k < 400 && (P._eraseStrokes().length || P._eraseBusy()); k++) {
                P._bakeTickInner();
                flying = Math.max(flying, [...P._cuts.values()].filter((c) => c.state === "flight").length);
                await later(3);
            }
            expect(P._eraseStrokes()).toHaveLength(0);
            expect(flying).toBeGreaterThan(1);                                   // the lookahead ran ahead of the head
            expect(JSON.stringify(P.doc.serializeNatives())).toBe(JSON.stringify(S.doc.serializeNatives()));
            expect(steps(P)).toEqual(steps(S));
            expect(entries(PL)).toEqual(entries(SL));
        });
    }
});
