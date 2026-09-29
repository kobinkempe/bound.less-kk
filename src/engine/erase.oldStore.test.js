/**
 * erase.oldStore.test.js — A2 §4.9 against a store the pre-B-ERASE engine made (1cac470,
 * `__testkit__/preErase.store.json`): a frame snapshot, then the log of four gestures — one erase baked
 * and spent, one mark mid-bake (its z stepped to 3.5, a done set, the z steps logged as `put`s), one
 * landed and untouched, one undone. Loaded by this build: each landed mark registers once by the old
 * rule (the scan under its stepped z, less what its log's bake entries name), the registration logged
 * once; a second sight changes nothing; the undone one registers when a redo brings it back; the bake
 * ends where the old engine's own did; and every gesture undoes.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { decodeObjects } from "./format2";
import { loopsArea } from "./geometry/arcShape";
import raw from "./__testkit__/preErase.store.json";

useEngines();
jest.setTimeout(60000);

const store = JSON.parse(JSON.stringify(raw), (k, v) => (v && v.f64 ? Float64Array.from(v.f64) : v));

function load() {
    const F = mkEngine();
    F._scheduleBake = () => {};
    const nat = {};
    for (const level of Object.keys(store.snap.frames)) nat[level] = decodeObjects(store.snap.frames[level].objects, store.snap.frames[level].geo);
    F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: store.snap.camera, crossings: store.crossings, natives: nat }, { render: false });
    const log = new OpLog(F);
    log.replay(store.entries, store.snap.frameSeq, Object.keys(store.snap.frames));
    F._eraseLoaded();
    return { F, log };
}
const state = (E) => JSON.stringify(E.doc.serializeNatives());
/** Ink area by colour over the live natives: the picture's content, ids aside (the store holds the old engine's). */
function areas(E) {
    const out = {};
    for (const L of E.doc.levels()) for (const o of E.doc.list(L)) {
        if (o.erase) continue;
        const a = o.type === "shape" ? Math.abs(loopsArea(o.loops)) : o.type === "fill" ? o.polys.reduce((s, p) => s + Math.abs(p.reduce((t, q, i) => t + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2, 0) : 0;
        out[o.color] = (out[o.color] || 0) + a;
    }
    return out;
}
const close = (a, b, rel = 2e-3) => Object.keys({ ...a, ...b }).every((c) => Math.abs((a[c] || 0) - (b[c] || 0)) <= rel * Math.max(1, b[c] || 0));

test("the old store loads: the pending marks register once by the old rule, the registration logged once, a second sight changes nothing", () => {
    const { F, log } = load();
    const [M, N] = store.marks;
    const m = F.doc.getById(M.id).obj, n = F.doc.getById(N.id).obj;
    expect(m.z).toBe(M.z);                                                      // the stepped z kept as data
    expect(m.targets).toBeDefined(); expect(n.targets).toBeDefined();
    for (const id of M.done) expect((m.targets || []).includes(id)).toBe(false);  // what its bake had done is not a target
    for (const id of M.done) { const r = F.doc.getById(id); if (r) expect(r.obj.handledBy).toContain(M.id); }
    const first = log.drain().entries.filter((e) => e.op.k === "attr" && e.op.set && e.op.set.targets).map((e) => e.op.id).sort((a, b) => a - b);
    expect(first).toEqual([M.id, N.id].sort((a, b) => a - b));                  // one attr entry per mark
    const s0 = state(F);
    F._eraseLoaded(); F._registerLanded(); F.flushBakes();
    expect(state(F)).toBe(s0);
    expect(log.drain().entries).toEqual([]);                                    // idempotent
    expect(areas(F)).toEqual(store.mid);                                        // the content the old engine left, to the bit
});

test("the old store's bake ends where the old engine's did; the undone mark registers when redone; every gesture undoes", () => {
    const { F } = load();
    F.flushErases();
    expect(F._eraseStrokes()).toHaveLength(0);
    if (process.env.OLDSTORE_LOG) console.log("AREAS " + JSON.stringify({ now: areas(F), old: store.after }));
    expect(close(areas(F), store.after)).toBe(true);
    const { F: G, log } = load();
    log.drain();
    expect(G.redo()).toBe(true);                                                // the undone mark, from before `targets`
    G.flushBakes();
    const U = G._eraseStrokes().map((r) => r.obj).find((o) => !store.marks.some((x) => x.id === o.id));
    expect(U && U.targets).toBeDefined();
    expect(log.drain().entries.filter((e) => e.op.k === "attr" && e.op.id === U.id)).toHaveLength(1);
    G.flushErases();
    let guard = 0;
    while (G.doc.canUndo() && guard++ < 50) { G.undo(); G.flushBakes(); }
    G.flushErases();
    expect(close(areas(G), store.before)).toBe(true);                         // the ink as it was before any erase
});
