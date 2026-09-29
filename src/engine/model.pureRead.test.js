/**
 * No read mutates (PLAN §3 row 8, A1 C1): over the model fuzz's states (`modelFuzz.runPairFuzz`), the
 * reads the app makes — the tile store's `read` (and the brute-force render list, `__oracles__/renderList`), the Stage's sync and a
 * snapshot at four frames (unbounded, and budgeted as the Scenes panel's picture reads), hit tests (the
 * drag's pick among the selection too), a lasso, the erase pipeline's frame pass and the scene index's
 * pass — leave the document's `rev` and `offRev`, its natives, the lattice's `addrEpoch`, its addresses
 * and shifts, and its frame set as they were; so does `report()` (its own case). The one exception
 * PLAN §3 row 8 names: `displaced` mints a frame the pieces of a picture are read from when the lattice
 * lacks it (`LevelMap.objShift`, A1 §1.2 row 19) — each new frame must hold nothing, be a displaced
 * group's source frame or on its chain, and go at the next frame GC. The fuzz renders after every
 * operation, so before the reads one inked frame the camera sees is given a shift nobody has read yet
 * (what a drop leaves), and a render is one of them.
 */
import { runPairFuzz, framesToCompare, CELL } from "./__testkit__/modelFuzz";
import { mkEngine, useEngines, drawStroke } from "./__testkit__/harness";
import { W } from "./frameLattice";
import { SceneClient } from "./sceneClient";
import { rectLoop } from "./geometry/arcShape";
import { collectFrames } from "./frameGc";
import { buildReport } from "./report";
import { renderList } from "./__oracles__/renderList";

useEngines();

jest.setTimeout(10 * 60 * 1000);

const SEEDS = 6, STEPS = 30;

function state(E) {
    const lattice = new Map();
    for (const f of E.lm.frames.values()) lattice.set(f.id, JSON.stringify([f.parent, f.cell, f.shift, f.shadowOf]));
    return { rev: E.doc.rev, offRev: E.doc.offRev, epoch: E.lm.addrEpoch, natives: JSON.stringify(E.doc.serializeNatives()), lattice };
}
const empty = (E, id) => !E.doc.count(id) && E.lm.childrenOf(id).every((c) => empty(E, c.id));   // no native under it
/** Every frame a displaced group of these views reads its pieces from, and the frames on its chain up. */
function displacedSources(E, views) {
    const out = new Set();
    for (const V of views) {
        for (const g of E.stage.model.displaced(V).groups.values()) {
            for (let f = E.lm.frame(g.F0); f; f = f.parent != null ? E.lm.frame(f.parent) : null) out.add(f.id);
        }
    }
    return out;
}
const snap = (v) => Math.round(v * 1024) / 1024;

test("the reads leave the document and the lattice as they were, over seeded sequences", () => {
    const st = { seeds: SEEDS, steps: STEPS, checks: 0, reads: 0, minted: 0, hits: 0, lassos: 0, unread: 0 };
    const fails = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
        runPairFuzz(seed, STEPS, (O, N, step, op, rnd) => {
            // Quiet first: a pending erase lands at the next press (A2 §4.12), which is an input, not a read.
            for (const E of [O, N]) { E.flushErases(); E.flushBakes(); }
            const F = N.cam.frame, win = N._listWin();
            const views = framesToCompare(O, N).filter((V) => N.lm.frame(V));
            // An unread shift on an inked frame in view (put back after the reads, so the engines stay in step).
            const inked = [F, ...N.lm.childrenOf(F).map((c) => c.id)].filter((k) => N.doc.count(k)).sort();
            const S = inked.length ? inked[Math.floor(rnd() * inked.length)] : null;
            const kept = S ? N.lm.frame(S).shift : null;
            if (S) { N.doc.setFrameShift(S, [snap((rnd() - 0.5) * W * 0.9), snap((rnd() - 0.5) * W * 0.9)]); st.unread++; }
            const before = state(N), why0 = [];
            N._render();
            renderList(N, F, win);
            N.store.read(F, win);
            for (const V of views) { N.stage.sync(V, CELL); N.stage.snapshot(V, CELL, Infinity); N.stage.snapshot(V, CELL, 0); N.stage.snapshot(V, CELL, 2); st.reads += 4; }
            for (let k = 0; k < 4; k++) { if (N.hitTestAt(Math.floor(rnd() * N.width), Math.floor(rnd() * N.height))) st.hits++; }
            N._hitTest(N.width / 2, N.height / 2, 6, (i) => N._isSelected(i));
            // The erase frame pass, for a mark over the whole view drawn below everything: it takes no frame.
            if (N._eraseFramesPass({ obj: { type: "shape", loops: rectLoop(win), z: -Infinity }, level: F }) !== 0) why0.push("the frame pass took a frame");
            // The scene index's pass over the document, inline.
            const sc = new SceneClient(N, { worker: false });
            sc._onEvent({ kind: "reset" }); sc.flushNow(); sc.destroy();
            st.reads += 3;
            // A lasso, and the selection put back so the two engines stay in step.
            const had = N.selection ? { ids: N.selection.ids.slice(), frames: N.selection.frames.slice() } : null, tool = N.tool;
            // From empty paper and with nothing selected, or the press would take ink or the selection and drag it.
            N._setSelection([]);
            let x0 = -1, y0 = -1;
            for (let k = 0; k < 8 && x0 < 0; k++) {
                const x = 40 + Math.floor(rnd() * 300), y = 40 + Math.floor(rnd() * 200);
                if (!N.hitTestAt(x, y)) { x0 = x; y0 = y; }
            }
            if (x0 >= 0) {
                N.setTool("select");
                N.pointerDown(x0, y0);
                for (const [x, y] of [[x0 + 380, y0], [x0 + 380, y0 + 300], [x0, y0 + 300], [x0, y0 + 2]]) N.pointerMove(x, y);
                N.pointerUp();
                if (N.selection) st.lassos++;
            }
            if (had) N._setSelection(had.ids, had.frames); else N._setSelection([]);
            N.setTool(tool);
            const after = state(N), sources = displacedSources(N, [F, ...views]);
            if (S) N.doc.setFrameShift(S, kept);
            st.checks++;
            const why = why0;
            for (const k of ["rev", "offRev", "epoch", "natives"]) if (after[k] !== before[k]) why.push(k);
            for (const [id, v] of before.lattice) if (after.lattice.get(id) !== v) why.push("frame " + id);
            const minted = [...after.lattice.keys()].filter((id) => !before.lattice.has(id));
            for (const id of minted) {
                if (!empty(N, id)) why.push("new frame " + id + " holds ink");
                else if (!sources.has(id)) why.push("new frame " + id + " is no displaced group's source");
                else st.minted++;
            }
            // Frame GC takes them: none is the camera's, an ancestor of it, or one it left.
            collectFrames(N);
            const named = N.doc.namedFrames();
            for (const id of minted) if (N.lm.frame(id) && !N._camTrail.includes(id) && !named.has(id)) why.push("minted frame " + id + " outlived frame GC");
            if (why.length) { fails.push(`seed ${seed} step ${step} ${op}: ${why.join(", ")}`); return false; }
            return true;
        });
    }
    // eslint-disable-next-line no-console
    console.log("MODEL-PURE " + JSON.stringify(st));
    expect(fails).toEqual([]);
    expect(st.checks).toBe(SEEDS * STEPS);
});

test("report() leaves the document and the lattice as they were, a subtree's shift unread", async () => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    for (let i = 0; i < 3; i++) drawStroke(E, [[150 + i * 180, 150], [220 + i * 180, 350], [160 + i * 180, 520]], 10);
    const kid = E.lm.cellChild("1", 2, 1).id;
    E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -9000, top: -7000, right: 9000, bottom: 7000 }), color: "#246", opacity: 1, w: 8 }, kid);
    E._render();
    E.doc.setFrameShift(kid, [0.375 * W, -0.25 * W]);             // a drop's rest, not read yet
    const before = state(E);
    const rep = await buildReport(E, { yieldFn: () => Promise.resolve() });
    expect(rep.moves).toBeTruthy();
    const after = state(E);
    for (const k of ["rev", "offRev", "epoch", "natives"]) expect([k, after[k]]).toEqual([k, before[k]]);
    for (const [id, v] of before.lattice) expect([id, after.lattice.get(id)]).toEqual([id, v]);
    const sources = displacedSources(E, [E.cam.frame, kid]);
    for (const id of after.lattice.keys()) if (!before.lattice.has(id)) expect([id, empty(E, id), sources.has(id)]).toEqual([id, true, true]);
});
