/**
 * oplog.js — what a session records replays onto a snapshot to the same document,
 * with the same undo/redo stacks, and a half-baked eraser picks up where it left
 * off. No storage here: snapshots are format2 frames in memory.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture, descend, drag, click } from "./__testkit__/harness";
import { encodeObjects, decodeObjects } from "./format2";
import { OpLog } from "./oplog";
import { underMask } from "./eraseRule";
import { rectLoop } from "./geometry/arcShape";

useEngines();

const natives = (E) => JSON.stringify(E.doc.serializeNatives());
// Every frame as a kobin-2 snapshot, stamped with the log's seq.
function snapshot(E, log) {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
    return { frames, frameSeq, crossings: E.lm.serialize(), camera: E.cam.state(), meta: E.docMeta };
}
// A fresh engine from a snapshot plus the entries since. The lattice is the header's, which
// every write carries: pass the one the last drain's write would have held.
function restore(snap, entries, crossings = snap.crossings) {
    const F = mkEngine(800, 600);
    const nat = {};
    for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings, natives: nat });
    const log = new OpLog(F);
    const stats = log.replay(entries, snap.frameSeq);
    return { F, log, stats };
}
const strokes = (E, n, y0 = 100) => { for (let i = 0; i < n; i++) drawStroke(E, [[80 + i * 70, y0], [140 + i * 70, y0 + 200], [90 + i * 70, y0 + 360]], 8 + (i % 4)); };

describe("the op log", () => {
    test("entries since a snapshot replay to the same document, undo stack included", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 3);
        const d1 = log.drain();
        expect(d1.entries.map((e) => e.op.k)).toEqual(["add", "add", "add"]);
        const snap = snapshot(E, log);
        strokes(E, 2, 140);
        eraseGesture(E, [[60, 300], [400, 305]], 18); E.flushErases();
        const d2 = log.drain();
        const kinds = d2.entries.map((e) => e.op.k);
        expect(kinds.slice(0, 2)).toEqual(["add", "add"]);
        expect(kinds).toContain("mark"); expect(kinds).toContain("bake");
        const { F, stats } = restore(snap, [...d1.entries, ...d2.entries]);
        expect(natives(F)).toBe(natives(E));
        expect(stats.undo).toBe(E.doc._undo.length);
        expect(F.doc._nextId).toBe(E.doc._nextId);
        // undo works on the restored side exactly as on the live one
        E.undo(); F.undo();
        expect(natives(F)).toBe(natives(E));
        E.undo(); F.undo();
        expect(natives(F)).toBe(natives(E));
        E.redo(); F.redo();
        expect(natives(F)).toBe(natives(E));
    });

    test("an undo before the save comes back undoable and redoable", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 2);
        E.undo();
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["add", "add", "undo"]);
        const snap = snapshot(E, log);
        const { F, stats } = restore(snap, d.entries);
        expect(natives(F)).toBe(natives(E));
        expect(stats).toMatchObject({ undo: 1, redo: 1 });
        E.redo(); F.redo();
        expect(natives(F)).toBe(natives(E));
        expect(F.doc.canRedo()).toBe(false);
    });

    test("a snapshot taken after everything skips the applies but still rebuilds the stacks", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 3);
        eraseGesture(E, [[60, 300], [400, 305]], 18); E.flushErases();
        E.undo();
        const d = log.drain();
        const snap = snapshot(E, log);                 // everything is in the frames
        const { F, stats } = restore(snap, d.entries);
        expect(natives(F)).toBe(natives(E));
        expect(stats).toMatchObject({ undo: 3, redo: 1 });
        // and replaying the same entries again changes nothing (idempotent applies)
        new OpLog(F).replay(d.entries, {});
        expect(natives(F)).toBe(natives(E));
    });

    test("a move at depth, its frames forced to snapshot, replays and undoes alike", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 2);
        descend(E, 2);
        drawStroke(E, [[300, 200], [420, 330], [350, 420]], 6);
        const snap = snapshot(E, log);
        log.drain();
        E.setTool("select"); click(E, 300, 200); drag(E, [300, 200], [360, 250]);
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toContain("move");
        expect(d.forced.length).toBeGreaterThan(0);
        const { F } = restore(snap, d.entries);
        expect(natives(F)).toBe(natives(E));
        E.undo(); F.undo();
        expect(natives(F)).toBe(natives(E));
    });

    test("a moveMany's tables replay and undo to the same bytes, applied and skipped alike (row 11)", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 3); descend(E, 2);
        drawStroke(E, [[300, 200], [420, 330], [350, 420]], 6);
        const snap = snapshot(E, log); log.drain();
        const ids = []; for (const L of E.doc.levels()) for (const o of E.doc.at(L)) ids.push(o.id);
        E._setSelection(ids);
        expect(E.hitTestAt(380, 265)).not.toBeNull();
        E.setTool("select"); E.pointerDown(380, 265); E.pointerMove(400, 280); E.pointerMove(416, 291); E.pointerUp();
        const d = log.drain();
        const mv = d.entries.find((e) => e.op.k === "move");
        expect(mv.op.many).toBe(true);
        for (const m of mv.op.moves) { expect(m).toHaveProperty("belowBefore"); expect(m).not.toHaveProperty("base"); }
        expect(mv.geo.length).toBeLessThan(mv.op.moves.length * 400);   // one geometry copy a member (obj), not three
        const { F } = restore(snap, d.entries);
        expect(natives(F)).toBe(natives(E));
        E.undo(); F.undo(); expect(natives(F)).toBe(natives(E));
        E.redo(); F.redo(); expect(natives(F)).toBe(natives(E));
        // a snapshot from after the drag: the apply is skipped, the inverse comes from the entry's data
        const snap2 = snapshot(E, log);
        const { F: G } = restore(snap2, d.entries);
        expect(natives(G)).toBe(natives(E));
        E.undo(); G.undo(); expect(natives(G)).toBe(natives(E));
    });

    test("a half-baked eraser resumes where it left off, to the same result", () => {
        // A: the uninterrupted bake.
        const A = mkEngine(800, 600);
        strokes(A, 8, 60);
        eraseGesture(A, [[40, 260], [640, 262]], 14); A.flushErases();
        // B: the same drawing, the bake interrupted after three steps.
        const B = mkEngine(800, 600);
        const log = new OpLog(B);
        strokes(B, 8, 60);
        const snap = snapshot(B, log);                 // the store before the erase
        log.drain();
        eraseGesture(B, [[40, 260], [640, 262]], 14);  // pending: its mark is in the document
        B._scheduleBake = () => {};
        B.flushBakes();
        const mark = B._eraseStrokes()[0];
        expect(mark).toBeTruthy();
        for (let i = 0; i < 3; i++) B._bakeNext();
        const handled = (E) => { const out = []; for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if ((o.handledBy || []).includes(mark.obj.id)) out.push(o.id); return out.sort((x, y) => x - y); };
        const pending = (E) => { const M = E.doc.getById(mark.obj.id).obj, out = []; for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (underMask(o, M)) out.push(o.id); return out.sort((x, y) => x - y); };
        expect(handled(B).length).toBeGreaterThan(0);
        const d = log.drain();
        expect(d.entries.filter((e) => e.op.k === "bake").length).toBe(3);
        // C: reopened from the snapshot plus the log: the handled pieces and the pending targets from the headers.
        const { F: C, stats } = restore(snap, d.entries);
        expect(stats.marks).toBe(1);
        expect(C._eraseCommits.has(mark.obj.id)).toBe(true);
        expect(handled(C)).toEqual(handled(B));
        expect(pending(C)).toEqual(pending(B));
        expect(pending(C).length).toBeGreaterThan(0);
        expect(natives(C)).toBe(natives(B));
        C.flushErases();
        expect(natives(C)).toBe(natives(A));
        // and undo of the whole gesture still covers the steps done before the reopen
        C.undo();
        expect(C._eraseStrokes().length).toBe(0);
        expect(Object.values(C.doc.nativesByLevel).reduce((n, a) => n + a.length, 0)).toBe(8);
    });
});

// F70/F71 (Kobin, 2026-09-08, report 21-23-56 and the tab): after a reload, a piece cut
// out of a stroke, moved, then cut again came back from a redo with the table it had
// before the second cut — its two records had decoded to two objects, and the undo of
// its moves had reset only one of them. And every redo of a move wiped the store's log.
describe("the op log after a reload", () => {
    const setup = () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        strokes(E, 3);
        eraseGesture(E, [[60, 300], [400, 305]], 18); E.flushErases();
        const p = E.doc.at("0").find((o) => !o.erase && o.type === "shape" && o.id > 3);
        const r = E._rectInActive(p, "0");
        const c = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
        drag(E, c, [c[0] + 200, c[1]]);
        expect(p.below).toBeTruthy();
        eraseGesture(E, [[c[0] + 200, c[1] - 60], [c[0] + 200, c[1] + 60]], 18); E.flushErases();
        expect(E.doc.getById(p.id)).toBeNull();                // consumed by the second cut
        return { E, log, id: p.id };
    };
    const objectsFor = (F, id) => {
        const out = new Set(); const seen = new Set();
        const walk = (v, depth) => {
            if (!v || typeof v !== "object" || depth > 6 || seen.has(v) || ArrayBuffer.isView(v)) return;
            seen.add(v);
            if (v.id === id && v.type) { out.add(v); return; }
            if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
            for (const k of Object.keys(v)) if (k !== "loops") walk(v[k], depth + 1);
        };
        for (const op of F.doc._undo) walk(op, 0);
        for (const op of F.doc._redo) walk(op, 0);
        return out;
    };

    test("one object per id across the records, and the undo history exact (F70)", () => {
        const { E, log, id } = setup();
        const d = log.drain();
        const snap = snapshot(E, log);                          // every entry older than the snapshots
        const { F } = restore(snap, d.entries);
        expect(natives(F)).toBe(natives(E));
        expect(objectsFor(F, id).size).toBe(1);
        const n = E.doc._undo.length;
        for (let i = 0; i < n; i++) { E.undo(); F.undo(); expect(natives(F)).toBe(natives(E)); }
        for (let i = 0; i < n; i++) { E.redo(); F.redo(); expect(natives(F)).toBe(natives(E)); }
        E.undo(); F.undo();                                     // the second cut: the piece comes back with its table
        expect(F.doc.getById(id).obj.below).toEqual(E.doc.getById(id).obj.below);
        expect(natives(F)).toBe(natives(E));
    });

    test("a redo of a move is logged as a redo, never as a reason to reset the log (F71)", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        drawStroke(E, [[100, 100], [160, 140]]);
        drag(E, [130, 120], [330, 120]);
        E.undo();
        log.drain();
        E.redo();
        const d = log.drain();
        expect(d.full).toBe(false);
        expect(d.entries.map((e) => e.op.k)).toEqual(["redo"]);
    });
});

describe("a moved stroke replayed before its stale move's redo (REVIEWER-3's save lane, seed 715)", () => {
    // Five gestures: the object is in the full snapshot, the add and move entries are stale, and only the
    // immediate rewind of the replayed object (U-2) puts the undo's inverse back at the move's table.
    const STROKE = [[536,375],[529.5,372.75],[527,371.5],[522.25,369.75],[516.5,369.25],[511.25,369],[506.25,369.25],[499.75,368],[493.75,365],[487.5,362.25],[485.25,357.75],[483,355],[480.5,350.75],[474.5,348.5],[471.25,344.25],[468.25,340.5],[465,335.5],[463.25,329.25],[461.25,324.25],[459.25,319],[456.25,316],[455,312.75],[451.5,307.25],[450.5,304.75],[451.75,298],[453.25,295.5],[453.25,288.5],[451.25,284.25],[450.5,280.5],[450,273],[449.5,270],[449.5,262.75],[449.75,258.75],[449.5,253],[450,248.5],[450.75,241.5],[450.5,236],[448.25,232.75],[446,227.5],[444.25,222.5],[443,219],[439.5,217],[435,212],[430.25,208.25],[426.75,206],[423.5,201.5],[420.5,195.25],[414.75,192.25],[412.5,190],[405.75,189.25],[402.75,189.25],[397.5,190],[391.75,189.25],[389.25,188.75],[386,190.5],[379.75,192],[376.5,194.25],[369.25,194.25],[364.75,192.25],[359,191.5],[352.25,191.25],[345.25,192.5],[339.25,193.25],[335.25,194],[330.25,193.25],[327,192],[320.5,193.25],[316,194.75],[312.25,195.5],[306,198],[303.25,199.75],[296.75,200.75],[293.25,201.75],[289,203],[285.5,206.75],[279.75,208.75],[277.25,209],[270,208.75],[267.25,207],[262.25,204.25],[259.5,197.5],[256.75,192.5],[255.5,189],[252.5,183.25],[252,178.75],[252,172.75],[251,166.25],[248.25,163.25],[245.25,160.25],[241.75,158.25],[238,153.75],[236.75,147.75],[235.25,145],[234.75,140.25],[232.5,137.25],[231.75,130.75],[233,128],[237.25,123.5],[241,119.5],[244.25,113.75],[248.5,111.75],[254.25,108.75],[257.5,106.75],[263.75,104.25],[270.25,101.5],[272.75,99.25],[276.25,96],[278.25,89.5],[281.5,84.25],[284.75,78],[286.5,74],[287.5,68],[288,61.75],[290.25,58.5],[292.75,55.75],[295,49.5],[297.25,45.25],[299,42.75],[300,40.25],[304.5,35.5],[307,30.75],[310,27.5],[312.5,23.75],[314,17],[314,15],[312.75,22],[313.5,28.75],[313.25,34.75],[314.75,39.5],[316.75,41.75],[320.75,43.25],[324.25,48],[325.75,53],[327,56.5],[328,61.25],[330.5,67.5],[333,71],[336,75.75],[338,77.5],[340,82.75],[341.75,86],[343.5,88.5],[344,94],[345,97.25],[349.25,99],[354.25,102.25],[356.75,106.25],[361.75,109],[365.25,113],[367.5,115.25],[374.25,115.75],[380.25,114.25],[387,113.25],[389.75,114],[395.75,114.5],[402.5,114.5],[409.5,112.5],[412.5,108.5],[417,106.5],[421.5,105],[425.25,102.25],[431.75,100.5],[439.25,101],[442.25,99.75],[445.5,98.75],[448.5,97],[451.25,94.25],[456.5,94.25],[459,95],[461.75,96.25],[467.25,99],[473.25,102.25],[475.25,106.25],[478.25,110.5],[478.75,114],[480,118.5],[479.75,123],[479,126.25],[477.5,132],[474.25,137],[472.75,139.5],[472.25,143.5],[470.5,148.75],[467.75,152.75],[466.75,155.75],[466.25,162],[466.25,168.75],[465.75,175.5],[465,182],[463.25,184.75],[462,190.5],[459.5,194.5],[455.75,198],[450.5,200],[444.5,201.5],[439.25,204],[434.5,208.25],[430.75,212.5],[428.25,214.75],[423.75,217],[417.5,218.75],[412.75,219.25],[409.75,217.75],[403,218.25],[396.75,219.5],[393.5,222.25],[390,223.25],[384.75,222],[380.25,220.75],[373.25,219.25],[368,218.75],[361.75,218],[358.25,215.25],[354.5,213.25],[351,210.75],[343.5,211],[338.75,210.25],[334.25,209.5],[329.25,207.75],[322.75,204.75],[319.75,200.75],[314,199.25],[310,200],[305.75,200.75],[298.75,201.25],[294.25,199.75],[288.75,199.75],[286,199],[283,197.5],[280.5,197.75],[275.25,195.5],[269.75,194.75],[265.75,193],[262.25,190.75],[255.25,189.75],[249,189.5],[243,190.5],[236,191.75],[231.75,192.75],[229,194.25],[223.25,193.5],[216.75,192.75],[211.75,190.75],[208.5,187.25],[203.75,185]];
    const ERASER = [[229,115],[229.5,111.25],[229.5,104],[228,99.75],[228.25,95],[231,89.75],[232,82.5],[234.25,78],[238.25,74.75],[240,71.5],[242.25,66],[244,58.5],[242.75,52.5],[240.75,49.75],[239.75,43.75],[238.25,39],[236.75,31.75],[232,25.75],[223.75,22.5],[216.75,20.75],[211.25,15.75],[205.5,15],[200.75,17.5],[196.75,20],[192.75,24.5],[189.5,28.75],[187,33.5],[185,37.25],[183,40],[179.75,47.5],[177.5,55.75],[172.5,61.25],[168.75,67],[165.25,68.75],[156.25,69],[152.75,69.75],[147.5,70.5],[139,72.25],[134,72.25],[130.75,72.5]];
    test("a history walk, a full save and a reload: the undos agree with the live engine", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        E.setColor("#5533cc");
        const s = drawStroke(E, STROKE, 30);
        drag(E, [418, 186], [275, 143]);
        expect(E.doc.getById(s.id).obj.below).toBeTruthy();
        eraseGesture(E, ERASER, 3);                                  // a pending mark
        E.flushErases(); E.flushBakes();
        while (E.doc.canUndo()) E.undo();
        while (E.doc.canRedo()) E.redo();
        const entries = log.drain().entries;
        const snap = snapshot(E, log);                              // a full save
        const { F } = restore(snap, entries, E.lm.serialize());
        const nat = (X) => { const n = X.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
        E.undo(); F.undo();
        expect(F.doc.getById(s.id) && F.doc.getById(s.id).obj.below).toEqual(E.doc.getById(s.id) && E.doc.getById(s.id).obj.below);   // red without the rewind: null
        while (E.doc.canUndo()) { E.undo(); F.undo(); expect(nat(F) === nat(E)).toBe(true); }
    });
});

describe("a frame deleted in the tick its strokes were drawn (REVIEWER-3 SAVE-4)", () => {
    test("their add entries are kept: a reload's undo stack and undos agree with the live engine", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        const snap = snapshot(E, log);
        for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
        const F = E.cam.frame;
        strokes(E, 3);
        for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 1 / 16);
        E.deselect();
        E.setTool("select");
        const loop = [[200, 100], [600, 100], [600, 500], [200, 500], [200, 102]];
        E.pointerDown(loop[0][0], loop[0][1]);
        for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect(E.selection.frames).toContain(F);
        E.deleteSelection();
        const d = log.drain();
        expect(d.entries.filter((e) => e.op.k === "add").length).toBe(3);   // red: 0, set aside before the drain
        const { F: G } = restore(snap, d.entries, E.lm.serialize());
        expect(G.doc._undo.map((o) => o.op)).toEqual(E.doc._undo.map((o) => o.op));
        // empty buckets aside: a load drops them, the live engine keeps "0"
        const nat = (X) => { const n = X.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
        for (let k = 0; k < 4; k++) { E.undo(); G.undo(); expect(nat(G) === nat(E)).toBe(true); }
    });
});

// The subtree move in the log (SUBTREE-O1-PLAN §2.8): the header's lattice is the authority on
// addresses, shifts and shadows (a shift is placement, written into no table: A1 C1); a deleted
// subtree's natives ride the entry; a merge is recorded on its op. Reloads agree with the live
// engine byte for byte, undo and redo included.
describe("the op log and a subtree moved as frames", () => {
    const rects = (E, frame, n, seed, size = 900) => {
        const ids = [];
        for (let i = 0; i < n; i++) {
            const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000;
            const o = { type: "shape", origin: "native", id: E.doc.allocId(),
                loops: rectLoop({ left: x, top: y, right: x + 50 + (i % size), bottom: y + 40 }), color: "#123", opacity: 1, w: 8 };
            E.doc.add(o, frame); ids.push(o.id);
        }
        return ids;
    };
    const press = (E, frameId) => E._levelPointToScreen(frameId, 0, 0);
    const dragDirect = (E, p, dx, dy) => {
        E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        E._dragSelection(p[0] + dx, p[1] + dy);
    };
    const moveFrame = (E, R, dx) => { E._setSelection([], [R.id]); dragDirect(E, press(E, R.id), dx, 0); E.pointerUp(); };
    const lattice = (E) => JSON.stringify(E.lm.serialize());
    // The stored bytes, empty buckets aside (a load drops them; the live engine's "0" starts empty).
    const nat = (E) => { const n = E.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
    // Byte-equal, with the first difference in the message rather than two 40 KB strings.
    const firstDiff = (x, y) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return x.slice(Math.max(0, i - 60), i + 100) + "   |||   " + y.slice(Math.max(0, i - 60), i + 100); };
    const same = (F, E) => {
        const a = nat(F), b = nat(E);
        if (a !== b) throw new Error("natives differ (reloaded ||| live) near: " + firstDiff(a, b));
        const la = lattice(F), lb = lattice(E);
        if (la !== lb) throw new Error("lattice differs (reloaded ||| live) near: " + firstDiff(la, lb));
    };
    // The camera at depth 1; R a level below it, K two, L three; `size` 1 keeps R's natives
    // under the cull at the camera's deepest zoom, so no render reads R.
    const fixture = (size = 900) => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 7, -7), L = E.lm.cellChild(K.id, 1, 1);
        const ids = { R: rects(E, R.id, 120, 1, size), K: rects(E, K.id, 120, 2, size), L: rects(E, L.id, 120, 3, size) };
        E._render();
        log.drain();
        return { E, log, R, K, L, ids, snap: snapshot(E, log) };
    };

    test("a move with its natives drawn: one op and no table entry, the shift in the header; undo and redo exact after the reload", () => {
        const { E, log, R, snap } = fixture();
        moveFrame(E, R, 40);                                          // R's natives are visible: the drag's render reads them, writes nothing (A1 C1)
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["moveFrames"]);
        expect(d.forced).toEqual([]);                                 // no member changed frames: no snapshot forced
        const mf = d.entries[d.entries.length - 1];
        expect(mf.op.frames.find((f) => f.id === R.id).settled).toBeUndefined();
        expect(E.lm.serialize().frames.find((f) => f.id === R.id).shift).toBeTruthy();
        expect(mf.geo.length).toBe(0);                                // no geometry in a frame move
        const { F, stats } = restore(snap, d.entries, E.lm.serialize());
        expect(stats.undo).toBe(1);
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        E.redo(); F.redo(); same(F, E);
        E.undo(); F.undo(); same(F, E);
    });

    test("a redone move and the next drag: undo and redo after a reload agree (REVIEWER-3 SAVE-2)", () => {
        const { E, log, R, snap } = fixture();
        moveFrame(E, R, 40);
        E.undo(); E.redo();                                           // R's shift back on the frame
        moveFrame(E, R, 40);                                          // the next drag adds to it
        const d = log.drain();
        const { F } = restore(snap, d.entries, E.lm.serialize());
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        E.undo(); F.undo(); same(F, E);                               // red: the first op's undo took the second's shift
        E.redo(); F.redo(); same(F, E);
        E.redo(); F.redo(); same(F, E);
    });

    test("a frame's shift rides the header: no read writes an entry, and a reload at any point agrees", () => {
        const { E, log, R, K, snap } = fixture(1);                    // K's natives: 64 units, 0.001 px at the camera's deepest zoom, never read
        // 1/1024 unit more than a cell and a quarter: K, two levels down, takes a rest of its own.
        moveFrame(E, R, 40 + 1 / 1024);
        const d1 = log.drain();
        expect(d1.entries.map((e) => e.op.k)).toEqual(["moveFrames"]);
        expect(E.lm.frame(K.id).shift).toEqual([16384, 0]);
        const cr1 = E.lm.serialize();
        const { F: G } = restore(snap, d1.entries, cr1);
        expect(G.lm.frame(K.id).shift).toEqual([16384, 0]);
        same(G, E);
        G.doc.at(K.id); E.doc.at(K.id); E._render();
        expect(nat(G)).toBe(nat(E));
        const d2 = log.drain();
        expect(d2.entries).toEqual([]);                               // a read writes nothing (A1 C1)
        const { F } = restore(snap, [...d1.entries, ...d2.entries], E.lm.serialize());
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        E.redo(); F.redo(); same(F, E);
        // A reload after an undo still agrees.
        E.undo();
        const d3 = log.drain();
        expect(d3.entries.filter((e) => e.op.k === "undo").length).toBe(2);
        expect(d3.entries.filter((e) => e.op.k === "redo").length).toBe(1);
        const { F: H } = restore(snap, [...d1.entries, ...d2.entries, ...d3.entries], E.lm.serialize());
        same(H, E);
        E.redo(); H.redo(); same(H, E);
        const d4 = log.drain();
        // And from a snapshot taken after everything: every apply skipped, the stacks rebuilt. Reading K
        // for its row writes nothing, so the saver's second drain is empty.
        const late = snapshot(E, log);
        const d5 = log.drain();
        expect(d5.entries).toEqual([]);
        const { F: J, stats } = restore(late, [...d1.entries, ...d2.entries, ...d3.entries, ...d4.entries, ...d5.entries], E.lm.serialize());
        same(J, E);
        expect(stats.undo).toBe(1);
        E.undo(); J.undo(); same(J, E);
    });

    test("a deleted subtree rides the entry: its rows gone, undo brings the natives back", () => {
        const { E, log, R, snap } = fixture();
        const before = nat(E);
        E._setSelection([], [R.id]);
        expect(E.deleteSelection()).toBe(true);
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["removeFrames"]);
        expect(d.entries[0].geo.length).toBeGreaterThan(0);
        expect(d.entries[0].op.records.length).toBe(3);
        const later = snapshot(E, log);                              // the rows R, K, L have gone with the write
        expect(Object.keys(later.frames)).not.toContain(R.id);
        const { F } = restore(later, d.entries, E.lm.serialize());
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        expect(nat(F)).toBe(before);
        E.redo(); F.redo(); same(F, E);
        // From the older snapshot the entry detaches the rows it still finds.
        const { F: G } = restore(snap, d.entries, E.lm.serialize());
        same(G, E);
        E.undo(); G.undo(); same(G, E);
        expect(nat(G)).toBe(before);
    });

    test("a loose native and a frame deleted together are one entry and one undo", () => {
        const { E, log, R, snap } = fixture();
        const loose = rects(E, "1", 1, 9)[0];
        log.drain();
        const before = nat(E);
        E._setSelection([loose], [R.id]);
        expect(E.deleteSelection()).toBe(true);
        expect(E.doc._undo[E.doc._undo.length - 1].op).toBe("deleteMany");
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["deleteMany"]);
        const later = snapshot(E, log);
        const { F, stats } = restore(later, d.entries, E.lm.serialize());
        expect(stats.undo).toBe(1);
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        expect(nat(F)).toBe(before);
        E.redo(); F.redo(); same(F, E);
        const { F: G } = restore(snap, d.entries, E.lm.serialize());
        G.undo(); E.undo(); same(G, E);
    });

    test("an erase that takes a frame whole is a bakeFrames entry with the natives; undo after a reload restores them", () => {
        const { E, log, R, K, snap } = fixture();
        const before = nat(E);
        eraseGesture(E, [[500, 460], [620, 460]], 130);
        E.flushErases();
        expect(E.doc.count(R.id)).toBe(0);
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["mark", "bakeFrames", "spent"]);
        expect(d.entries[1].op.frames.map((f) => f.frame).sort()).toEqual([R.id, K.id, E.lm.cellChild(K.id, 1, 1).id].sort());
        expect(d.entries[1].geo.length).toBeGreaterThan(0);
        const later = snapshot(E, log);                              // the three rows have gone
        const { F, stats } = restore(later, d.entries, E.lm.serialize());
        expect(stats.undo).toBe(1);
        same(F, E);
        E.undo(); F.undo(); same(F, E);
        expect(nat(F)).toBe(before);
        E.redo(); F.redo(); same(F, E);
        expect(F.doc.count(R.id)).toBe(0);
        const { F: G } = restore(snap, d.entries, E.lm.serialize());   // the old rows: detached by the entry
        same(G, E);
        E.undo(); G.undo(); same(G, E);
    });

    test("a frame dropped on an occupied cell, merged at the resident's read: the merge is on the op after a reload", () => {
        const E = mkEngine(800, 600);
        const log = new OpLog(E);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const A = E.lm.cellChild("1", 10, 0), A1 = E.lm.cellChild(A.id, 1, 1);
        const B = E.lm.cellChild("1", 12, 0);
        rects(E, A.id, 60, 1); rects(E, A1.id, 20, 2); rects(E, B.id, 60, 3); E.lm.cellChild(B.id, 2, 2);
        E._render();
        log.drain();
        const snap = snapshot(E, log);
        moveFrame(E, A, 64);
        E.doc.at(B.id);                                                // the merge
        const d = log.drain();
        expect(d.entries.map((e) => e.op.k)).toEqual(["moveFrames", "mergeFrame"]);
        expect(d.entries[1].op.of).toBe(d.entries[0].seq);
        expect(d.forced).toContain(B.id);
        expect(E.lm.frame(A.id)).toBeUndefined();
        // What the write holds: the old rows, except B's (forced: it has A's natives now) and
        // A's (gone with the write). The merge entry finds nothing left to fold.
        const later = snapshot(E, log);
        const mixed = { ...snap, frames: { ...snap.frames, [B.id]: later.frames[B.id] }, frameSeq: { ...snap.frameSeq, [B.id]: later.frameSeq[B.id] } };
        delete mixed.frames[A.id]; delete mixed.frameSeq[A.id];
        const { F } = restore(mixed, d.entries, E.lm.serialize());
        same(F, E);
        expect(F.doc._undo[0].frames[0].merged.length).toBe(1);
        E.undo(); F.undo(); same(F, E);
        expect(F.lm.frame(A.id).parent).toBe("1");
        expect(F.doc.count(A.id)).toBe(60);
        E.redo(); F.redo(); E.doc.at(B.id); F.doc.at(B.id); same(F, E);
        // From a snapshot after everything: nothing applied, the merge still on the op, undo splits it.
        const { F: G } = restore(snapshot(E, log), d.entries, E.lm.serialize());
        same(G, E);
        E.undo(); G.undo(); same(G, E);
        expect(G.doc.getById(G.doc.at(A.id)[0].id).level).toBe(A.id);
    });
});
