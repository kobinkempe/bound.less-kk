/**
 * prefetch.test.js — the prefetch plan of A3 §4.3 on a small lattice (root "0", child A, grandchild B): the near
 * levels ℓv − 1 and ℓv − 2 over the screen and a cell of margin, from the live table; the far levels read through
 * snapshots in the view frame, then its parent and grandparent once coarser than the frame's own; the crossing
 * target within 1.25 × exit of a crossing; the ring at ℓv only at rest; nothing while a report sends; the budget gate.
 */
import LevelMap from "../LevelMap";
import { ENTER, BASE, EXIT } from "../frameLattice";
import PyramidStore, { PLATE_BYTES, levelCell } from "./PyramidStore";
import { prefetchPlan, farKeysOf, FAR_STEPS } from "./prefetch";
import { levelFor, ownFloor, zOf } from "./level";
import { fakeStage } from "../__testkit__/fakeStage";

const W = 1600, H = 1000;
function world({ inScale = 2, maxPlates = 400 } = {}) {
    const lm = new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, W, H);
    lm.ensureSpine(0);
    const A = lm.cellChild("0", 1, 2).id, B = lm.cellChild(A, 3, -1).id;
    const stage = fakeStage();
    stage.lm = lm;
    const reads = [];
    stage.snapshotFn = (frame, rect, ms) => { reads.push({ frame: String(frame), rect, ms }); return { frame: String(frame), rect, generation: stage.generation, items: () => [] }; };
    const store = new PyramidStore({ fresh: stage, maxBytes: maxPlates * PLATE_BYTES, phone: false, doc: null });
    const Z = inScale, S = 1, lv = levelFor(Z, S);
    const Zq = zOf(lv, S), s = Z / Zq;
    const view = { frameId: B, level: lv, S, Z, Zq, s, k: Z, tx: -300, ty: -200, dpr: 1, cssW: W, cssH: H };
    // A frozen clock: under a loaded jest run the real one spent the 8 ms read budget and the far test lost reads.
    return { lm, A, B, stage, store, view, reads, cfg: { enter: ENTER, exit: EXIT, levelStep: 1, gens: { prefetch: 3 }, now: () => 0 } };
}

describe("prefetch (A3 §4.3)", () => {
    test("near ℓv − 1 and ℓv − 2 over the screen and a cell of margin, from the live table, first", () => {
        const t = world();
        const jobs = prefetchPlan(t.view, t.stage, t.store, t.cfg);
        const near = jobs.filter((j) => j.purpose === "prefetch:near");
        expect(jobs.slice(0, 2)).toEqual(near);
        expect(near.map((j) => j.level)).toEqual([t.view.level - 1, t.view.level - 2]);
        for (const j of near) {
            expect([j.prio, j.table, j.gen, j.frame]).toEqual([4, null, 3, String(t.B)]);
            const Zl = zOf(j.level, 1), P = 512 / Zl;
            const win = { left: 300 / 2, top: 200 / 2, right: (W + 300) / 2, bottom: (H + 200) / 2 };
            const want = [];
            for (let jj = Math.floor((win.top - P) / P); jj <= Math.ceil((win.bottom + P) / P) - 1; jj++)
                for (let ii = Math.floor((win.left - P) / P); ii <= Math.ceil((win.right + P) / P) - 1; ii++) want.push(levelCell(t.B, j.level, 1, ii, jj).key);
            expect(j.cells.map((c) => c.key).sort()).toEqual(want.sort());
        }
    });

    test("far levels: three octaves under the view zoomed out 4^k, over 2.5 of its screens, climbing into the parent and grandparent", () => {
        const t = world();
        const jobs = prefetchPlan(t.view, t.stage, t.store, t.cfg);
        const far = jobs.filter((j) => j.purpose === "prefetch:far");
        expect(far.length).toBeGreaterThanOrEqual(8);
        expect(far.every((j) => j.table && j.table.frame === j.frame)).toBe(true);
        const frames = new Set(far.map((j) => j.frame));
        expect([...frames].sort()).toEqual([String(t.A), String(t.B), "0"].sort());
        for (const j of far) {
            expect(j.level * 1).toBeGreaterThanOrEqual(ownFloor(1));
            expect(j.cells.length).toBeGreaterThanOrEqual(1);
            expect(j.cells.length).toBeLessThanOrEqual(12);
        }
        // The first far step is in the view's own frame at levelFor(Z / 4 / 8), over 2.5 screens zoomed out 4×, about the
        // centre; its table is read over all of every cell it packs (F163: a read of less left a cell's far side out).
        expect([far[0].frame, far[0].level]).toEqual([String(t.B), levelFor(t.view.Z / 4 / 8, 1)]);
        const r0 = t.reads[0].rect, P0 = 512 / zOf(far[0].level, 1);
        const cx = (300 + W / 2) / 2, cy = (200 + H / 2) / 2, hw = ((W / 2) * 4 * 2.5) / 2, hh = ((H / 2) * 4 * 2.5) / 2;
        expect(r0).toEqual({ left: Math.floor((cx - hw) / P0) * P0, top: Math.floor((cy - hh) / P0) * P0, right: Math.ceil((cx + hw) / P0) * P0, bottom: Math.ceil((cy + hh) / P0) * P0 });
        for (const c of far[0].cells) expect(c.i * P0 >= r0.left && (c.i + 1) * P0 <= r0.right && c.j * P0 >= r0.top && (c.j + 1) * P0 <= r0.bottom).toBe(true);
        // In the parent the level is the child's + 12: the same picture.
        const inA = far.find((j) => j.frame === String(t.A));
        const k = 1 + far.indexOf(inA);
        expect(inA.level).toBe(levelFor(t.view.Z / 4 ** k / 8, 1) + 12);
        expect(farKeysOf(jobs).size).toBe(far.reduce((n, j) => n + j.cells.length, 0));
        expect(t.reads.length).toBeLessThanOrEqual(FAR_STEPS + 1);
    });

    test("a far read past its budget is skipped; the plan goes on without it", () => {
        const t = world();
        let n = 0;
        const inner = t.stage.snapshotFn;
        t.stage.snapshotFn = (...a) => (++n === 2 ? null : inner(...a));
        const far = prefetchPlan(t.view, t.stage, t.store, t.cfg).filter((j) => j.purpose === "prefetch:far");
        expect(far.length).toBe(t.reads.length);
        expect(n).toBe(t.reads.length + 1);
        const clock = { t: 0 };
        const slow = world();
        slow.stage.snapshotFn = (...a) => { clock.t += 5; return inner(...a); };
        const few = prefetchPlan(slow.view, slow.stage, slow.store, { ...slow.cfg, now: () => clock.t, prefetchReadMs: 8 });
        expect(few.filter((j) => j.purpose === "prefetch:far").length).toBe(2);   // 0 ms, then 5: a third read has no budget
    });

    test("the crossing target: the parent's ℓv + 12 − 1 near the exit, the child's ℓv − 12 + 1 at the focus near the entry", () => {
        const out = world({ inScale: EXIT * 1.1 });
        const jo = prefetchPlan(out.view, out.stage, out.store, out.cfg).find((j) => j.purpose === "prefetch:cross");
        expect([jo.frame, jo.level]).toEqual([String(out.A), out.view.level + 12 - 1]);
        const inn = world({ inScale: ENTER * 0.9 });
        const cc = inn.lm.cellChild(inn.B, 0, 0);                          // a child under the focus (the screen centre)
        inn.view.tx = W / 2; inn.view.ty = H / 2;
        const ji = prefetchPlan(inn.view, inn.stage, inn.store, inn.cfg).find((j) => j.purpose === "prefetch:cross");
        expect([ji.frame, ji.level]).toEqual([String(cc.id), inn.view.level - 12 + 1]);
        expect(ji.cells.length).toBeLessThanOrEqual(9);
        const mid = world({ inScale: 2 });
        expect(prefetchPlan(mid.view, mid.stage, mid.store, mid.cfg).filter((j) => j.purpose === "prefetch:cross")).toEqual([]);
    });

    test("the ring at ℓv only at rest; nothing while a report sends; cells already wanted-not are left out", () => {
        const t = world();
        expect(prefetchPlan(t.view, t.stage, t.store, t.cfg).some((j) => j.purpose === "prefetch:ring")).toBe(false);
        const ring = prefetchPlan(t.view, t.stage, t.store, { ...t.cfg, atRest: true }).find((j) => j.purpose === "prefetch:ring");
        expect(ring.level).toBe(t.view.level);
        const Zl = zOf(t.view.level, 1), P = 512 / Zl;
        const inside = (c) => c.i >= Math.floor(150 / P) && c.i <= Math.ceil(950 / P) - 1 && c.j >= Math.floor(100 / P) && c.j <= Math.ceil(600 / P) - 1;
        expect(ring.cells.some(inside)).toBe(false);
        expect(ring.cells.length).toBeGreaterThan(4);
        expect(prefetchPlan(t.view, t.stage, t.store, { ...t.cfg, reportBusy: true })).toEqual([]);
        const near1 = prefetchPlan(t.view, t.stage, t.store, t.cfg)[0];
        t.store.put({ ...near1.cells[0], G: 0, bitmap: null, bytes: 0, jobId: null });
        expect(prefetchPlan(t.view, t.stage, t.store, t.cfg)[0].cells.length).toBe(near1.cells.length - 1);
    });

    test("the budget gate: no more plates than the cache holds beside pins and protected records, near levels first", () => {
        const t = world({ maxPlates: 10 });
        const jobs = prefetchPlan(t.view, t.stage, t.store, { ...t.cfg, atRest: true });
        const n = jobs.reduce((a, j) => a + j.cells.length, 0);
        expect(n).toBe(10);
        expect(jobs.every((j) => j.purpose === "prefetch:near")).toBe(true);
        t.store.setView({ frame: String(t.B), level: t.view.level, S: 1, ring: null, rest: null, path: new Map([[String(t.B), 0]]), left: null, far: new Set() });
        for (let i = 0; i < 6; i++) t.store.put({ ...levelCell(t.B, t.view.level - 1, 1, 100 + i, 0), G: 0, bitmap: { close() {} }, jobId: null });
        expect(prefetchPlan(t.view, t.stage, t.store, t.cfg).reduce((a, j) => a + j.cells.length, 0)).toBe(4);
    });
});
