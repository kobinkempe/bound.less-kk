/**
 * oplog.js — what a session records replays onto a snapshot to the same document,
 * with the same undo/redo stacks, and a half-baked eraser picks up where it left
 * off. No storage here: snapshots are format2 frames in memory.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture, descend, drag, click } from "./__testkit__/harness";
import { encodeObjects, decodeObjects } from "./format2";
import { OpLog } from "./oplog";

useEngines();

const natives = (E) => JSON.stringify(E.doc.serializeNatives());
// Every frame as a kobin-2 snapshot, stamped with the log's seq.
function snapshot(E, log) {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
    return { frames, frameSeq, crossings: E.lm.serialize(), camera: E.cam.state(), meta: E.docMeta };
}
// A fresh engine from a snapshot plus the entries since.
function restore(snap, entries) {
    const F = mkEngine(800, 600);
    const nat = {};
    for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings: snap.crossings, natives: nat });
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
        for (let i = 0; i < 3; i++) { const t = B._nextEraseTarget(mark); if (t) B._bakeOne(mark, t); }
        const doneB = new Set(B._bakeDone.get(mark.obj.id));
        expect(doneB.size).toBeGreaterThan(0);
        const d = log.drain();
        expect(d.entries.filter((e) => e.op.k === "bake").length).toBe(3);
        // C: reopened from the snapshot plus the log.
        const { F: C, stats } = restore(snap, d.entries);
        expect(stats.marks).toBe(1);
        expect(C._eraseCommits.has(mark.obj.id)).toBe(true);
        expect(new Set(C._bakeDone.get(mark.obj.id))).toEqual(doneB);
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
            for (const k of Object.keys(v)) if (k !== "loops" && k !== "paths") walk(v[k], depth + 1);
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
