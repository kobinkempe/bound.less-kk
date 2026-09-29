/**
 * No read mutates (PLAN §3 row 8, A1 C1): over the model fuzz's states (`modelFuzz.runPairFuzz`), the
 * reads the app makes — `listFor`, the tile store's `content` and `read`, the Stage's sync and a
 * snapshot at four frames, a hit test and a lasso — leave the document's `rev` and `offRev`, its
 * natives, the lattice's `addrEpoch`, its addresses and shifts, and its frame set as they were. The one
 * exception PLAN §3 row 8 names: `displaced` mints a frame the pieces of a picture are read from when
 * the lattice lacks it (`LevelMap.objShift`, A1 §1.2 row 19) — an empty frame, frame GC's; any other
 * new frame fails.
 */
import { runPairFuzz, framesToCompare, CELL } from "./__testkit__/modelFuzz";

jest.setTimeout(10 * 60 * 1000);

const SEEDS = 6, STEPS = 30;

function state(E) {
    const lattice = new Map();
    for (const f of E.lm.frames.values()) lattice.set(f.id, JSON.stringify([f.parent, f.cell, f.shift, f.shadowOf]));
    return { rev: E.doc.rev, offRev: E.doc.offRev, epoch: E.lm.addrEpoch, natives: JSON.stringify(E.doc.serializeNatives()), lattice };
}
const empty = (E, id) => !E.doc.count(id) && !E.lm.childrenOf(id).length;

test("the reads leave the document and the lattice as they were, over seeded sequences", () => {
    const st = { seeds: SEEDS, steps: STEPS, checks: 0, reads: 0, minted: 0, hits: 0, lassos: 0 };
    const fails = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
        runPairFuzz(seed, STEPS, (O, N, step, op, rnd) => {
            // Quiet first: a pending erase lands at the next press (A2 §4.12), which is an input, not a read.
            for (const E of [O, N]) { E.flushErases(); E.flushBakes(); }
            const before = state(N);
            const F = N.cam.frame, win = N._listWin();
            const views = framesToCompare(O, N).filter((V) => N.lm.frame(V));
            N.listFor(F, win, true);
            N.store.content(F, win);
            N.store.read(F, win);
            for (const V of views) { N.stage.sync(V, CELL); N.stage.snapshot(V, CELL, Infinity); st.reads += 2; }
            for (let k = 0; k < 4; k++) { if (N.hitTestAt(Math.floor(rnd() * N.width), Math.floor(rnd() * N.height))) st.hits++; }
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
            const after = state(N);
            st.checks++;
            const why = [];
            for (const k of ["rev", "offRev", "epoch", "natives"]) if (after[k] !== before[k]) why.push(k);
            for (const [id, v] of before.lattice) if (after.lattice.get(id) !== v) why.push("frame " + id);
            for (const id of after.lattice.keys()) {
                if (before.lattice.has(id)) continue;
                if (empty(N, id)) st.minted++; else why.push("new frame " + id + " holds ink or kids");
            }
            if (why.length) { fails.push(`seed ${seed} step ${step} ${op}: ${why.join(", ")}`); return false; }
            return true;
        });
    }
    // eslint-disable-next-line no-console
    console.log("MODEL-PURE " + JSON.stringify(st));
    expect(fails).toEqual([]);
    expect(st.checks).toBe(SEEDS * STEPS);
});
