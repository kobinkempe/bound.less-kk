/**
 * Frame GC (OPEN-FLAGS F94). Kobin, 2026-09-23: "I would kind of prefer the frame to automatically
 * delete when everything is deleted out of it ... Then you can know that if there ever is a frame,
 * it has stuff in it." His phone drawing held 471 empty frames of 495, the trails of subtree drags,
 * whose every pointer event minted the containers its target chains passed through (since A1 C2 a
 * drag mints nothing until its drop, which mints the final chains' only).
 *
 * The rule as built: a frame with no natives and no kids goes at a gesture's end or a change of the
 * camera's frame — a resident with co-residents handing its cell to one (A1 C3) — unless the camera is
 * in it or passed through it lately (its chain and the last few frames it left) or an undo or redo op
 * names it (undo puts things back there by id).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import { W } from "./frameLattice";
import { rectLoop } from "./geometry/arcShape";
import { collectFrames, CAM_TRAIL } from "./frameGc";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";

const rects = (E, frame, n, seed) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(),
            loops: rectLoop({ left: x, top: y, right: x + 50 + (i % 900), bottom: y + 40 }), color: "#123", opacity: 1, w: 8 };
        E.doc.add(o, frame); ids.push(o.id);
    }
    return ids;
};
const fixture = (n = 60) => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 700, -700), L = E.lm.cellChild(K.id, 1, 1);
    const ids = { R: rects(E, R.id, n, 1), K: rects(E, K.id, n, 2), L: rects(E, L.id, n, 3) };
    E._render();
    return { E, R, K, L, ids };
};
const addrOf = (E, id) => { const f = E.lm.frame(id); return f ? { parent: f.parent, i: f.cell.i, j: f.cell.j } : null; };
const bytes = (E) => {
    const n = E.doc.serializeNatives();
    return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].slice().sort((a, b) => a.id - b.id)]));
};
const lattice = (E) => JSON.stringify([...E.lm.frames.values()].map((f) => [f.id, f.parent, f.cell.i, f.cell.j, f.shift]).sort());
const press = (E, frameId) => E._levelPointToScreen(frameId, 0, 0);
/** Frames that hold nothing and nothing keeps: what the rule says cannot exist after a trigger. */
function strays(E) {
    const keep = new Set(E._camTrail || []);
    for (let f = E.lm.frame(E.cam.frame); f; f = f.parent != null ? E.lm.frame(f.parent) : null) keep.add(f.id);
    const named = E.doc.namedFrames();
    const out = [];
    for (const f of E.lm.frames.values()) {
        if (f.parent == null || keep.has(f.id) || named.has(f.id)) continue;
        if (E.doc.count(f.id) || (f._kids && f._kids.size)) continue;
        out.push(f.id);
    }
    return out;
}
/** A drag of the selection through `steps` pointer events along a wandering path. */
function wander(E, p, steps, span = 90) {
    E.setTool("select");
    E.pointerDown(p[0], p[1]);
    for (let k = 1; k <= steps; k++) E.pointerMove(p[0] + span * Math.sin(k / 5) + k, p[1] + span * Math.cos(k / 7) - 40);
}

describe("a frame holds something (frame GC, F94)", () => {
    useEngines();

    test("G1 a 40-step subtree drag mints nothing until its drop, leaves no empty frame behind, and undo and redo are exact", () => {
        const { E, R, K, L } = fixture();
        const start = { bytes: bytes(E), lattice: lattice(E), R: addrOf(E, R.id), K: addrOf(E, K.id), L: addrOf(E, L.id) };
        const n0 = E.lm.frames.size;
        E._setSelection([], [R.id]);
        wander(E, press(E, R.id), 40);
        expect(E.lm.frames.size - n0).toBe(0);                   // A1 C2: the pre-C2 drag minted a container trail here
        E.pointerUp();
        expect(strays(E)).toEqual([]);                            // what the drop's chains minted and left empty went
        const after = { bytes: bytes(E), R: addrOf(E, R.id), K: addrOf(E, K.id), L: addrOf(E, L.id) };
        E.undo();
        expect(bytes(E)).toBe(start.bytes);
        expect([addrOf(E, R.id), addrOf(E, K.id), addrOf(E, L.id)]).toEqual([start.R, start.K, start.L]);
        E.redo();
        for (const k of [...E.lm.frames.keys()]) E.doc.at(k);
        expect(bytes(E)).toBe(after.bytes);
        expect([addrOf(E, R.id), addrOf(E, K.id), addrOf(E, L.id)]).toEqual([after.R, after.K, after.L]);
        expect(strays(E)).toEqual([]);
    });

    test("G2 a cancelled drag leaves the lattice as it was", () => {
        const { E, R } = fixture();
        const start = lattice(E);
        E._setSelection([], [R.id]);
        wander(E, press(E, R.id), 30);
        E.cancelSelectGesture(false);
        expect(lattice(E)).toBe(start);                          // red: the drag's containers stay
    });

    test("G3 a deleted subtree leaves the lattice at once (A1 C3); an undo puts it back; nothing of it outlives its op", () => {
        const { E, R, K, L } = fixture();
        E._setSelection([], [R.id]);
        E.deleteSelection();
        expect([E.lm.frame(R.id), E.lm.frame(K.id), E.lm.frame(L.id)]).toEqual([undefined, undefined, undefined]);
        E.sweepFrames();
        E.undo();
        expect(E.doc.count(R.id) + E.doc.count(K.id) + E.doc.count(L.id)).toBe(180);   // red when the sweep took R's container
        E.redo();
        for (let k = 0; k < 200; k++) E.doc.pushUndo({ op: "noop" });                   // the delete falls off the 200-op history
        collectFrames(E);
        expect([E.lm.frame(R.id), E.lm.frame(K.id), E.lm.frame(L.id)]).toEqual([undefined, undefined, undefined]);
        expect(strays(E)).toEqual([]);
    });

    test("G11 a deleted subtree's natives are gone for good once GC forgets its frames: no ghost, no table, no crash", () => {
        const { E, R, K, L, ids } = fixture(20);
        const all = [...ids.R, ...ids.K, ...ids.L];
        for (const id of ids.R.slice(0, 3)) E.doc.setOffsetsById(id, [[0, 30, -20]]);
        expect(E.doc.offsetIds().size).toBe(3);
        E._setSelection([], [R.id]);
        E.deleteSelection();
        for (let k = 0; k < 200; k++) E.doc.pushUndo({ op: "noop" });                   // the delete leaves history
        collectFrames(E);
        expect(E.lm.frame(R.id)).toBeUndefined();
        expect(all.filter((id) => E.doc.getById(id))).toEqual([]);                        // red: ghosts back in `_byId`
        expect(E.doc.offsetIds().size).toBe(0);
        const again = E.lm.cellChild("1", 5, 5);                                          // the same cell, visited again
        expect(E.doc.count(again.id)).toBe(0);
        const loop = [[-1e6, -1e6], [1e6, -1e6], [1e6, 1e6], [-1e6, 1e6]];
        expect(E._lassoFind(loop).ids.filter((id) => all.includes(id))).toEqual([]);
        expect(() => E.doc.rehomeManyById(ids.R.slice(0, 3), again.id)).not.toThrow();
        void K; void L;
    });

    test("G4 the camera keeps the frames it is in and the last few it left; past them an empty cell goes", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(2);
        const ink = E.lm.cellChild("0", -9, -9);
        rects(E, ink.id, 3, 5);
        const cells = [];
        for (let k = 0; k < CAM_TRAIL + 2; k++) {                 // each cell minted as the camera arrives, as a crossing mints it
            cells.push(E.lm.cellChild("0", k * 3, 7).id);
            E.jumpTo(cells[k], { x: -1000, y: -1000, w: 2000, h: 2000 });
            expect(E.cam.frame).toBe(cells[k]);
        }
        expect(E.lm.frame(cells[0])).toBeUndefined();            // red: left, empty, and not in the trail
        expect(E.lm.frame(cells[cells.length - 1])).toBeTruthy();   // the camera is in it
        for (const c of cells.slice(-1 - CAM_TRAIL, -1)) expect(E.lm.frame(c)).toBeTruthy();   // the trail
        expect(E.lm.frame(ink.id)).toBeTruthy();
    });

    test("G4b a frame the camera just left, emptied under no op, stays while it is in the trail", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(2);
        const view = { x: -1000, y: -1000, w: 2000, h: 2000 };
        const X = E.lm.cellChild("0", 1, 7);
        const [nid] = rects(E, X.id, 1, 5);
        E.jumpTo(X.id, view);
        const go = (k) => { const id = E.lm.cellChild("0", 10 + k * 3, 7).id; E.jumpTo(id, view); expect(E.cam.frame).toBe(id); };   // minted as the camera arrives
        go(0);
        E.doc.removeById(nid);                                    // a mark consumed: no op names X
        go(1);
        expect(E.lm.frame(X.id)).toBeTruthy();                    // red: collected though the camera may come back
        for (let k = 2; k <= CAM_TRAIL + 1; k++) go(k);
        expect(E.lm.frame(X.id)).toBeUndefined();                 // off the trail: gone
    });

    test("G5 a drawing saved with empty frames: a load collects none; the host's sweep takes them", () => {
        const { E } = fixture(10);
        for (let k = 0; k < 30; k++) E.lm.cellChild("1", -40 + k, 30);   // empties, as his phone drawing held
        const snap = E.snapshot();
        const B = mkEngine(800, 600);
        B.loadSnapshot(snap);
        const loaded = B.lm.frames.size;
        expect(loaded).toBe(E.lm.frames.size);
        B.undo();                                                 // a gesture end: the load's frames are no candidates
        collectFrames(B);
        expect(B.lm.frames.size).toBe(loaded);                    // red: the load's frames were candidates
        expect(B.sweepFrames()).toBe(30);                         // once the store's state is in (useKobinEngine)
        expect(B.lm.frames.size).toBe(loaded - 30);
        expect(strays(B)).toEqual([]);
    });

    test("G7 saved through the op log and reloaded: the same natives and lattice, and undo and redo match the live engine", () => {
        // oplog.test.js's reload: every frame's snapshot, the entries since, the header's lattice (every write carries it).
        const snapshot = (E, log) => {
            const frames = {}, frameSeq = {};
            for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
            return { frames, frameSeq, crossings: E.lm.serialize(), camera: E.cam.state() };
        };
        const restore = (snap, entries, crossings) => {
            const F = mkEngine(800, 600);
            const nat = {};
            for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
            F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings, natives: nat });
            const log = new OpLog(F);
            log.replay(entries, snap.frameSeq);
            return F;
        };
        const nat = (E) => { const n = E.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
        const same = (F, E) => { expect(nat(F)).toBe(nat(E)); expect(JSON.stringify(F.lm.serialize())).toBe(JSON.stringify(E.lm.serialize())); };
        const { E, R } = fixture();
        const log = new OpLog(E);
        log.drain();
        const snap = snapshot(E, log);
        E._setSelection([], [R.id]);
        wander(E, press(E, R.id), 40);
        E.pointerUp();
        expect(strays(E)).toEqual([]);
        const d = log.drain();
        const F = restore(snap, d.entries, E.lm.serialize());
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        E.redo(); F.redo(); same(F, E);
        E.undo(); F.undo(); same(F, E);
    });

    test("G8 nothing is collected mid-gesture; the drop collects", () => {
        const { E, R } = fixture(10);
        E._setSelection([], [R.id]);
        const p = press(E, R.id);
        E.setTool("select"); E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 12; k++) E.pointerMove(p[0] + 7 * k, p[1] - 3 * k);
        E._gcCand.add(E.lm.cellChild("1", -30, 30).id);          // an empty frame waiting (a drag itself mints none, A1 C2)
        const mid = lattice(E);
        expect(collectFrames(E)).toBe(0);                        // red: collected from under the gesture
        expect(lattice(E)).toBe(mid);
        E.pointerUp();
        expect(strays(E)).toEqual([]);
    });

    test("G9 a parent a forgotten frame empties goes with it", () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(2);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const P = E.lm.cellChild("1", 20, 20), C = E.lm.cellChild(P.id, 3, 3);
        E._gcCand.clear(); E._gcCand.add(C.id);
        expect(collectFrames(E)).toBe(2);
        expect([E.lm.frame(C.id), E.lm.frame(P.id)]).toEqual([undefined, undefined]);   // red: P stays, empty
    });

    test("G13 a collected frame's tiles go with it: minted again, it shows ink added over its cell meanwhile (REVIEWER-3 RENDER-1)", () => {
        const E = mkEngine(800, 600);
        const shot = E.cam.state();
        for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
        const X = E.cam.frame;
        expect(X).not.toBe("0");
        E._render();                                                   // X's tiles, read from "0" magnified
        expect([...E.store.cache.values()].some((t) => String(t.level) === X)).toBe(true);
        // kept past the camera's leaving, as the prefetch's warm reads are
        for (const [k, t] of E.store.cache) if (String(t.level) === X) E.store._warm.add(k);
        E.cam.set(shot); E._render();
        expect([...E.store.cache.values()].some((t) => String(t.level) === X)).toBe(true);
        E._camTrail.length = 0; E._gcCand.add(X);
        expect(collectFrames(E)).toBeGreaterThan(0);
        expect(E.lm.frame(X)).toBeFalsy();
        const c = E.cam.screenToFrame(400, 300);
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, w: 8,
            loops: rectLoop({ left: c[0] - 40, top: c[1] - 40, right: c[0] + 40, bottom: c[1] + 40 }) };
        E.doc.add(o, "0");                                             // over X's cell, while X is gone
        for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
        expect(E.cam.frame).toBe(X);                                   // minted again, the same id
        E._render();
        expect(E._lastList.some((p) => p.id === o.id)).toBe(true);     // red before: the old tile, without it
    });

    test("G12 an undo and a redo collect a frame minted meanwhile by a read (the TESTER's random session: a plate drop's mapping)", () => {
        const { E, ids } = fixture(4);
        E.doc.removeById(ids.R[0]);
        E.doc.pushUndo({ op: "noop" });
        for (const op of ["undo", "redo"]) {
            const minted = E.lm.cellChild("1", -40, 31);                  // an empty frame, a candidate like any mint
            expect(E.lm.frame(minted.id)).toBeTruthy();
            if (op === "undo") E.undo(); else E.redo();
            expect(E.lm.frame(minted.id)).toBeFalsy();                  // red before: kept until the next gesture
        }
    });

    test("G10 a drop's container stays while the redo names it: undo, a sweep, redo are exact", () => {
        const { E, R } = fixture(10);
        const members = rects(E, E.lm.cellChild("1", -3, 2).id, 8, 3);
        const drop = (dx) => {
            E._setSelection(members, [R.id]);
            const p = press(E, R.id);
            E._dragSel = { start: [p[0], p[1]], moved: false };
            E._dragSelection(p[0] + dx, p[1]);
            E.pointerUp();
        };
        drop(40); drop(40);
        const second = E.doc.getById(members[0]).level;
        for (const k of [...E.lm.frames.keys()]) E.doc.at(k);
        const after = bytes(E);
        E.undo();
        expect(E.doc.count(second)).toBe(0);
        E.sweepFrames();
        expect(E.lm.frame(second)).toBeTruthy();                 // red: collected though the redo puts the members back there
        E.redo();
        for (const k of [...E.lm.frames.keys()]) E.doc.at(k);
        expect(bytes(E)).toBe(after);
        expect(E.doc.getById(members[0]).level).toBe(second);
    });

    // The camera's frame's ink drawn a cell over: the render mints the empty frame its picture is read from.
    const shiftedSource = () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(2);
        E.cam.set({ activeLevel: 2, frame: "2", inScale: 1, inPanX: 400, inPanY: 300 });
        E._render();
        drawStroke(E, [[300, 300], [500, 320]], 10);
        const had = new Set(E.lm.frames.keys());
        E.doc.setFrameShift("2", [1.3 * W, 0]);
        E._render();
        return { E, src: [...E.lm.frames.keys()].find((id) => !had.has(id)) };
    };

    test("G14 a frame the camera table reads a moved picture from stays a candidate, not forgotten (F139); it goes once the table stops reading it", () => {
        const { E, src } = shiftedSource();
        expect(src).toBeTruthy();
        expect(E.stage.sourceFrames().has(src)).toBe(true);
        E._gcCand.add(src);
        collectFrames(E);
        expect(E.lm.frame(src)).toBeTruthy();                      // red before: forgotten, and the next render minted and baked it again
        expect(E._gcCand.has(src)).toBe(true);
        E.stage.sourceFrames = () => new Set();                    // as once the table stops reading it
        collectFrames(E);
        expect(E.lm.frame(src)).toBeUndefined();                   // still a candidate: the next collection takes it
    });

    test("G15 a forgotten frame's camera pins stay: minted again, its tiles are pinned and a drop's batch write keeps them (F151)", () => {
        const { E, src } = shiftedSource();
        const keys = [...E.store.cache.keys()].filter((k) => k.startsWith(src + "|"));
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.every((k) => E.store._pins.has(k))).toBe(true);
        E.stage.sourceFrames = () => new Set();                    // as once the table no longer reads it
        E._gcCand.add(src);
        collectFrames(E);
        expect(E.lm.frame(src)).toBeUndefined();
        expect(keys.every((k) => E.store._pins.has(k))).toBe(true);   // red before: `TileStore.forgetFrame` deleted them
        E._render();                                               // minted again, its tiles read again
        expect(E.lm.frame(src)).toBeTruthy();
        expect(keys.filter((k) => E.store.cache.has(k)).every((k) => E.store._pins.has(k))).toBe(true);
    });

    test("G6 a forgotten moved frame's id is never minted again elsewhere in the session", () => {
        const E = mkEngine(800, 600);
        const a = E.lm.cellChild("0", 4, 4);
        E.lm.readdressMany([{ id: a.id, depth: a.depth, parent: "0", i: 9, j: 9 }]);   // moved: its id names (4, 4)
        collectFrames(E);
        expect(E.lm.frame(a.id)).toBeUndefined();
        const b = E.lm.cellChild("0", 4, 4);
        expect(b.id).not.toBe(a.id);                             // a cached tile or plate under that id is (9, 9)'s
    });
});
