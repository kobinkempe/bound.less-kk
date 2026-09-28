/**
 * erase.rule.test.js — the erase rule's document side (A2 §4, §5): Kobin's semantics traced through
 * the fields; the landing's one commit; the pick; the load-time derivation for a kobin-1 file and a
 * kobin-2 store written before `targets`; undo, redo and a replay after a reload agreeing (§4.10); and
 * the parallel bake leaving the serial bake's ids, steps and log (§4.7).
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";
import { setEraseTransport } from "./eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "./eraseDescent";
import { underMask } from "./eraseRule";
import { lcg } from "./__testkit__/rasterLists";

useEngines();
jest.setTimeout(60000);
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
        const G0 = E.stage.generation;
        E.flushBakes();
        expect(M.targets).toEqual([T.id]);
        expect(E.stage.landedAt(M.id)).toBe(G0 + 1);                          // one commit: the shape, the frames pass, the targets
        expect(underMask(T, M)).toBe(true);
        E.doc.moveById(Y.id, 280, -180);                                      // across the mark, after its registration
        expect(underMask(E.doc.getById(Y.id).obj, M)).toBe(false);
        const cut = new Set();
        E.doc.subscribeOps((ev) => { if (ev.kind === "bake" && ev.step.removed) cut.add(ev.step.removed.obj.id); });
        E.flushErases();
        expect([...cut]).toEqual([T.id]);
        expect(E.doc.getById(Y.id)).not.toBeNull();
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
        E._scheduleBake = () => {};
        const bars = [fill(E, 200, 200, 600, 240, "rgb(200,40,40)"), fill(E, 200, 280, 600, 320, "rgb(40,160,40)"), fill(E, 200, 360, 600, 400, "rgb(40,40,200)")];
        E._render();
        eraseGesture(E, [[400, 150], [400, 450]], 20);
        return { E, bars, M: E._eraseStrokes()[0].obj };
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
        const { E, bars, M } = oldDrawing();
        const R = mkEngine(800, 600); R._scheduleBake = () => {};
        R.loadDrawing(E.serializeDrawing()); R.flushErases();
        const want = shapes(R);
        const log = new OpLog(E);
        const snap = snapshot(E, log);
        E._bakeNext();
        const entries = log.drain().entries.filter((e) => e.op.k !== "attr");
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
    const cases = {
        "the mark undone mid-bake, then redone: its targets pending again, the bake resumes": (E) => {
            fill(E, 200, 200, 600, 240); fill(E, 200, 280, 600, 320);
            E._render();
            eraseGesture(E, [[400, 150], [400, 450]], 20);
            E._bakeNext();
            return () => { E.undo(); };
        },
        "an older erase undone after a newer one was drawn over its pieces": (E) => {
            fill(E, 200, 250, 600, 350);
            E._render();
            eraseGesture(E, [[300, 200], [300, 400]], 20);
            settle(E);                                                        // K baked and spent
            eraseGesture(E, [[250, 300], [550, 300]], 20);                     // M over K's pieces
            return () => { E.undo(); E.undo(); };
        },
        "a mark undone, its target cut by another mark, the mark redone": (E) => {
            fill(E, 200, 250, 600, 350);
            E._render();
            eraseGesture(E, [[300, 200], [300, 400]], 20);                     // M1
            eraseGesture(E, [[500, 200], [500, 400]], 20);                     // M2
            const M2 = E._eraseStrokes()[1].obj;
            E.flushErases(new Set([M2.id]));                                   // M2 cuts the target M1 still waits on
            return () => { E.undo(); E.redo(); };
        },
    };
    for (const [name, build] of Object.entries(cases)) {
        test(name, () => {
            const E = mkEngine(800, 600);
            E._scheduleBake = () => {};
            const log = new OpLog(E);
            const d0 = log.drain();
            const snap = snapshot(E, log);
            const then = build(E);
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
