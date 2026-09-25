/**
 * Two pending eraser marks, the newer baked first on a piece the older then cuts: undo and redo
 * put back only what the history owns (REVIEWER-3 ERASE-2: the older op's step cut the newer op's
 * piece, and the resilient replay, asking only whether an object is present, re-inserted that
 * piece over the restored stroke — duplicated ink that survived undo-all).
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { encodeObjects, decodeObjects } from "./format2";

useEngines();

const dragSteps = (E, from, to, steps) => {
    E.setTool("select");
    E.pointerDown(from[0], from[1]); E.pointerUp();
    E.pointerDown(from[0], from[1]);
    for (let i = 1; i <= steps; i++) E.pointerMove(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    E.pointerUp();
};
const nat = (E) => { const n = E.doc.serializeNatives(); for (const k of Object.keys(n)) if (!n[k].length) delete n[k]; return JSON.stringify(n); };
const ids = (E) => { const out = []; for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (!o.erase) out.push(o.id); return out.sort((x, y) => x - y); };

test("EP-1 undo to the start leaves nothing; redo to the end gives back the state before, exactly", () => {
    const E = mkEngine();
    E.setColor("#aa3311"); drawStroke(E, [[567,496],[742.5,541.25],[731.75,455],[665,263.25],[761.25,420]], 60);
    E.setColor("#11aa55"); drawStroke(E, [[708,234],[633,145],[677,90],[651,161]], 16);
    eraseGesture(E, [[641,86],[670.5,125.5],[693.25,164.75],[728.5,197.5],[764.25,224.75],[763.25,237.5],[714.75,242.75],[672.75,237.5],[676.25,199.25],[670.5,154.5],[679.5,114.5],[685.5,65.25],[705.75,20.75],[728.25,48.75],[705.5,86.5],[671,83.75]], 6);        // the older mark, pending
    for (let i = 0; i < 7; i++) E.zoomFactorAt(668, 340, 1.3);
    dragSteps(E, [621, 505], [768, 599], 5);                   // the barrier bakes the older mark here
    eraseGesture(E, [[641,12],[665.25,84.75],[734.5,207.5]], 48);          // the newer mark, pending
    dragSteps(E, [650, 70], [467, -92], 3);                    // the newer baked first; the older then cuts its piece
    E.flushErases(); E.flushBakes();
    const fwd = nat(E);
    let n = 0;
    while (E.doc.canUndo()) {
        E.undo(); n++;
        const live = ids(E);
        expect(new Set(live).size).toBe(live.length);
    }
    expect(ids(E)).toEqual([]);                                 // red: a piece no op owns stays behind
    for (let k = 0; k < n; k++) E.redo();
    expect(nat(E) === fwd).toBe(true);                          // red: a consumed piece comes back as well
});

// ---- EP-2..EP-4: the same interleavings walked state by state, and across a reload (REVIEWER-3 fuzz, 2026-09-24) ----
// The document as a set: each frame's natives sorted by id, so a redo that re-inserts at another index still compares.
const state = (E) => {
    const n = E.doc.serializeNatives(), out = [];
    for (const k of Object.keys(n).sort()) if (n[k].length) out.push([k, n[k].map((o) => JSON.stringify(o)).sort()]);
    return JSON.stringify(out);
};
const settle = (E) => { E.flushErases(); E.flushBakes(); };
/** Undo to the start recording every state, then redo to the end: each redo must land on the state its undo left. */
function walk(E) {
    settle(E);
    const states = [state(E)];
    while (E.doc.canUndo()) { E.undo(); settle(E); states.push(state(E)); }
    expect(state(E)).toBe(JSON.stringify([]));
    for (let k = states.length - 2; k >= 0; k--) { E.redo(); settle(E); expect(state(E) === states[k]).toBe(true); }
    return states;
}
const zoom = (E, x, y, f, n) => { for (let i = 0; i < n; i++) E.zoomFactorAt(x, y, f); };
const BIG = [[567, 496], [742.5, 541.25], [731.75, 455], [665, 263.25], [761.25, 420]];
const SMALL = [[708, 234], [633, 145], [677, 90], [651, 161]];
const OLD_MARK = [[641, 86], [670.5, 125.5], [693.25, 164.75], [728.5, 197.5], [764.25, 224.75], [763.25, 237.5], [714.75, 242.75], [672.75, 237.5], [676.25, 199.25], [670.5, 154.5], [679.5, 114.5], [685.5, 65.25], [705.75, 20.75], [728.25, 48.75], [705.5, 86.5], [671, 83.75]];
const NEW_MARK = [[641, 12], [665.25, 84.75], [734.5, 207.5]];
/**
 * The older mark (size 6) and the newer one (size 48) pending together. The first drag's barrier bakes the
 * older mark (it cuts the big stroke into 4+5); the second bakes the newer one on piece 4 first, and the
 * older then cuts what the newer made. `lead` zooms first, which moves the ink to another frame: there the
 * newer mark cuts 4 into TWO pieces and the older consumes only one of them.
 */
function interleave(E, lead) {
    if (lead) {
        zoom(E, 340, 94, 1 / 1.3, 7); zoom(E, 176, 53, 8, 6); zoom(E, 299, 217, 1 / 8, 3);
        zoom(E, 643, 367, 16, 3); zoom(E, 46, 549, 2, 6); zoom(E, 668, 258, 1 / 2, 6);
    }
    E.setColor("#aa3311"); drawStroke(E, BIG, 60);
    E.setColor("#11aa55"); drawStroke(E, SMALL, 16);
    eraseGesture(E, OLD_MARK, 6);
    zoom(E, 668, 340, 1.3, 7);
    dragSteps(E, [621, 505], [768, 599], 5);
    eraseGesture(E, NEW_MARK, 48);
    dragSteps(E, [650, 70], [467, -92], 3);
}

test("EP-2 a redone step whose source an undone gesture made takes that gesture's source instead: every state of the walk", () => {
    const E = mkEngine();
    interleave(E, false);
    walk(E);                                                    // red: the redo of the older gesture left 4 and dropped 12
});

test("EP-3 undo of a gesture whose piece an applied gesture went on to cut takes that cut back first: no ink twice", () => {
    const E = mkEngine();
    interleave(E, true);
    settle(E);
    // The newer gesture cut X into pieces P; the older, still applied, cut one of P into Q.
    const erases = E.doc._undo.filter((op) => op.op === "eraseCommit");
    const newer = erases[erases.length - 1], older = erases[erases.length - 2];
    const cut = newer.baked.find((st) => st.removed && st.pieces && st.pieces.length);
    const X = cut.removed.obj.id, P = new Set(cut.pieces.map((p) => p.obj.id));
    const Q = [];
    for (const st of older.baked) if (st.removed && P.has(st.removed.obj.id)) for (const p of st.pieces) Q.push(p.obj.id);
    expect(P.size).toBeGreaterThan(1);                          // the case: the newer made two pieces, the older took one
    expect(Q.length).toBeGreaterThan(0);
    E.undo(); settle(E);                                        // the newer gesture
    const present = (id) => !!E.doc.getById(id);
    // red: X came back while Q, made from part of X, stayed: that ink twice
    expect(present(X) && Q.some(present)).toBe(false);
    E.redo(); settle(E);
    walk(E);
});

// A snapshot mid-history and the log since, restored into a fresh engine (oplog.test.js's form).
function snapshot(E, log) {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
    return { frames, frameSeq, camera: E.cam.state() };
}
function restore(snap, entries, crossings) {
    const F = mkEngine();
    const nat = {};
    for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings, natives: nat });
    new OpLog(F).replay(entries, snap.frameSeq, Object.keys(snap.frames));   // an unlisted frame held nothing at the write (F98)
    return F;
}

test("EP-4 across a reload, snapshot mid-history and the log since: the restored history walks as the live one does", () => {
    for (const lead of [false, true]) {
        for (const at of ["early", "undone"]) {
            const E = mkEngine();
            const log = new OpLog(E);
            let snap = null, d1 = { entries: [] };
            if (at === "early") {
                // after the older mark's first bake: every later step, the newer gesture's and the older's cut of its piece, is replayed
                if (lead) {
                    zoom(E, 340, 94, 1 / 1.3, 7); zoom(E, 176, 53, 8, 6); zoom(E, 299, 217, 1 / 8, 3);
                    zoom(E, 643, 367, 16, 3); zoom(E, 46, 549, 2, 6); zoom(E, 668, 258, 1 / 2, 6);
                }
                E.setColor("#aa3311"); drawStroke(E, BIG, 60);
                E.setColor("#11aa55"); drawStroke(E, SMALL, 16);
                eraseGesture(E, OLD_MARK, 6);
                zoom(E, 668, 340, 1.3, 7);
                dragSteps(E, [621, 505], [768, 599], 5);
                d1 = log.drain();
                snap = snapshot(E, log);
                eraseGesture(E, NEW_MARK, 48);
                dragSteps(E, [650, 70], [467, -92], 3);
                settle(E);
                E.undo(); settle(E);
            } else {
                // after the newer gesture's undo: every step is in the snapshot, and replay rebuilds the ops and their flags
                interleave(E, lead);
                settle(E);
                E.undo(); settle(E);
                d1 = log.drain();
                snap = snapshot(E, log);
            }
            const d2 = log.drain();
            const F = restore(snap, [...d1.entries, ...d2.entries], E.lm.serialize());
            expect(state(F) === state(E)).toBe(true);
            expect(F.doc._undo.length).toBe(E.doc._undo.length);
            expect(F.doc._redo.length).toBe(E.doc._redo.length);
            const a = walk(E), b = walk(F);
            expect(JSON.stringify(b) === JSON.stringify(a)).toBe(true);
        }
    }
});

// F128 (REVIEWER-5): replay pushed a rekey step and a frames step with no order; the step graph gave
// them one after every replayed cut, so an undo after a reload reverted the rekey first, while its kid
// was still consumed, and the kid came back on the split-off key: a drag then left it behind.
test("EP-5 after a reload, undoing a cut that rekeyed then consumed a ceded kid puts the kid back in its family", () => {
    const E = mkEngine();
    const log = new OpLog(E);
    E.setTool("pen"); E.setWidth(40);
    E.pointerDown(150, 300); E.pointerMove(400, 300); E.pointerMove(650, 300); E.pointerUp(); E.flushBakes();
    for (let g = 0; E.activeLevel < 1 && g < 400; g++) E.zoomAt(400, 300, -1000);
    eraseGesture(E, [[400, 260], [400, 300], [400, 340]], 20); E.flushErases();
    E.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 }); E._render();
    const kid = (() => { for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (o.attachRect) return o; return null; })();
    expect(kid).toBeTruthy();
    const d1 = log.drain();
    const snap = snapshot(E, log);
    eraseGesture(E, [[250, 250], [250, 350], [330, 350], [400, 330], [400, 270]], 20); E.flushErases();
    const d2 = log.drain();
    const F = restore(snap, [...d1.entries, ...d2.entries], E.lm.serialize());
    E.undo(); F.undo();
    const keyOf = (X) => X.doc.editKey(X.doc.getById(kid.id).obj);
    const band = (X) => { for (const L of X.doc.levels()) for (const o of X.doc.list(L)) if (!o.erase && !o.attachRect) return X.doc.editKey(o); return null; };
    expect(keyOf(E)).toBe(band(E));                       // live: the kid is back in the band's family
    expect(keyOf(F)).toBe(keyOf(E));                      // red before: the split-off key after a reload
});
