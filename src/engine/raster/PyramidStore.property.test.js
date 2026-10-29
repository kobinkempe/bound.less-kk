/**
 * PyramidStore.property.test.js — PLAN §3 row 1 for the pyramid's store (A3 §10.2): a seeded random interleaving
 * of commits (a footprint in a frame, mapped into the root, at G++ through a fake Stage with the Stage's own
 * freshness semantics), jobs begun at the current G, arrivals in random order (some overtaken by a later change),
 * direct puts read at an older G, evictions, drops and releases, over 3 frames × 4 levels × 16 cells. After every
 * step: (a) no stored key's G decreased; (b) `exact(r)` ⇔ no commit after r.G has a footprint meeting r's box
 * (brute force over the log); (c) the plan never draws as exact a record a later change touched; (d) an arrival
 * older than the stored record is closed; (e) the plan draws one own-grid record per cell and at most
 * COMPOSE_IMAGES stand-ins, and pinned ≤ `pinnedBound` (PLAN §5.6 M2).
 */
import LevelMap from "../LevelMap";
import { ENTER, BASE, EXIT } from "../frameLattice";
import PyramidStore, { levelCell, planeCell, planeCap, pinnedBound, PLATE_BYTES, RANK } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import { COMPOSE_IMAGES, zOf } from "./level";
import { fakeStage, meets } from "../__testkit__/fakeStage";
import { lcg } from "../__testkit__/rasterLists";

const S = 1, P = 512;
const bitmap = () => ({ closed: false, close() { this.closed = true; } });
const boxOf = (r) => { const Z = r.Z, p = 1 / Z; return { left: r.i * P / Z - p, top: r.j * P / Z - p, right: (r.i + 1) * P / Z + p, bottom: (r.j + 1) * P / Z + p }; };

function world() {
    const lm = new LevelMap({ enter: ENTER, base: BASE, exit: EXIT }, 1024, 768);
    lm.ensureSpine(0);
    const A = lm.cellChild("0", 1, 2).id, B = lm.cellChild("0", -3, 0).id;
    const cells = [];
    for (const F of [A, B]) {
        for (let l = 0; l < 4; l++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) cells.push(levelCell(F, l, S, i, j));
    }
    // The root's cells are A's, the same pictures at ℓ + 12 (`mapCell`), so step (b) of the plan has something to find.
    const fa = lm.frame(A);
    for (let l = 0; l < 4; l++) {
        const off = 2 ** (8 + l * S);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) cells.push(levelCell("0", l + 12, S, i + fa.cell.i * off, j + fa.cell.j * off));
    }
    return { lm, A, B, cells };
}

function run(seed, steps, fail) {
    const rnd = lcg(seed * 7919 + 17);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const { lm, A, B, cells } = world();
    const stage = fakeStage();
    const store = new PyramidStore({ fresh: stage, maxBytes: 24 * PLATE_BYTES, phone: false, doc: null });
    const pyr = new PicturePyramid(null, { store, stage, lm, cfg: { levelStep: S }, width: 1024, height: 768, dpr: 1, pixels: true });
    const cap = pinnedBound(1024, 768, false);
    const jobs = [];
    let jobId = 0;
    const lastG = new Map();
    const counts = { commits: 0, arrivals: 0, stale: 0, olderClosed: 0, exactChecks: 0, planDraws: 0, evictions: 0, maxPinned: 0 };
    const view = (F, l) => {
        const c = cells.find((x) => x.frame === String(F) && x.level === l);
        const Zq = zOf(l, S);
        return { mode: "level", frameId: String(F), level: l, S, Zq, Z: Zq, s: 1, ox: c.i * P, oy: c.j * P, dx: 0, dy: 0,
            i0: c.i, i1: c.i + 3, j0: c.j, j1: c.j + 3, k: Zq, tx: -c.i * P, ty: -c.j * P };
    };
    for (let step = 0; step < steps; step++) {
        const op = rnd();
        if (op < 0.25) {
            // A commit: a rectangle in A or B, and the same change seen from the root.
            const F = rnd() < 0.6 ? A : B;
            const x = rnd() * 2100 - 50, y = rnd() * 2100 - 50, w = 1 + rnd() * (rnd() < 0.2 ? 900 : 120), h = 1 + rnd() * 120;
            const r = { left: x, top: y, right: x + w, bottom: y + h };
            const foot = { [F]: [r] };
            const m = lm.mapRectF(r, F, "0");
            if (m) foot["0"] = [m];
            stage.commit(foot);
            counts.commits++;
        } else if (op < 0.5) {
            const c0 = pick(cells), n = ri(1, 4);
            const same = cells.filter((c) => c.frame === c0.frame && c.level === c0.level);
            const mine = [];
            for (let k = 0; k < n; k++) { const c = pick(same); if (!mine.includes(c)) mine.push(c); }
            const id = ++jobId;
            store.beginJob(id, mine, stage.generation);
            jobs.push({ id, cells: mine, G: stage.generation });
        } else if (op < 0.75 && jobs.length) {
            const job = jobs.splice(Math.floor(rnd() * jobs.length), 1)[0];
            for (const c of job.cells) arrive(c, job.G, job.id);
            store.endJob(job.id);
        } else if (op < 0.85) {
            // A direct put read at an older G (a snapshot's plate): tracked from its G through the log.
            const c = pick(cells);
            arrive(c, Math.max(0, stage.generation - ri(0, 5)), null);
        } else if (op < 0.93) {
            const F = pick([A, B, "0"]);
            const l = F === "0" ? ri(12, 15) : ri(0, 3);
            const v = view(F, l);
            const Pn = pyr.plan(v);
            store.setDrawn(Pn.keys);
            const planeKeys = new Set();
            for (let k = 0; k < ri(0, planeCap(false)); k++) planeKeys.add(planeCell(F, 1, "sel", k, 0).key);
            store.setPlanePins(planeKeys);
            for (const d of Pn.draws) {
                if (!d.exact || !d.rec) continue;
                counts.planDraws++;
                if (later(d.rec)) fail(`seed ${seed} step ${step}: the plan draws ${d.rec.key}@${d.rec.G} as exact after a change met it`);
            }
            if (Pn.own > 16 || Pn.scaled > COMPOSE_IMAGES) fail(`seed ${seed} step ${step}: the plan drew ${Pn.own} own records on 16 cells and ${Pn.scaled} stand-ins`);
        } else if (op < 0.96) {
            store.setBudget(ri(4, 40) * PLATE_BYTES);
        } else if (op < 0.98) {
            store.dropFrames((f) => f === B);
        } else {
            store.release("test");
        }
        check(step);
    }
    function arrive(c, G, id) {
        const cur = store.get(c.key);
        const b = bitmap();
        const res = store.put({ ...c, G, bitmap: b, bytes: PLATE_BYTES, jobId: id });
        counts.arrivals++;
        if (res === "stale" || res === "refused") {
            counts.stale++;
            if (!b.closed) fail(`seed ${seed}: a refused arrival at G ${G} for ${c.key} was not closed`);
            else if (cur && G <= cur.G) counts.olderClosed++;
        }
    }
    function later(r) {
        const box = boxOf(r);
        return stage.log.some((e) => e.G > r.G && (e.foot.get(r.frame) || []).some((x) => meets(x, box)));
    }
    function check(step) {
        const now = new Set();
        for (const r of store.records()) {
            now.add(r.key);
            const g0 = lastG.get(r.key);
            if (g0 != null && r.G < g0) fail(`seed ${seed} step ${step}: ${r.key} went from G ${g0} to ${r.G}`);
            lastG.set(r.key, r.G);
            counts.exactChecks++;
            if (store.exact(r) === later(r)) fail(`seed ${seed} step ${step}: exact(${r.key}@${r.G}) is ${store.exact(r)}, the log says ${!later(r)}`);
        }
        for (const k of [...lastG.keys()]) if (!now.has(k)) lastG.delete(k);
        const pinned = store.pinnedCount();
        if (pinned > counts.maxPinned) counts.maxPinned = pinned;
        if (pinned > cap) fail(`seed ${seed} step ${step}: ${pinned} pinned, over the pinned bound (${cap})`);
    }
    counts.evictions = store.s.evictions;
    return counts;
}

describe("PyramidStore — PLAN §3 row 1 (monotone G; exact iff no later change met the box)", () => {
    test("seeded interleavings of commits, jobs, arrivals, evictions and releases", () => {
        const errors = [];
        const fail = (m) => { if (errors.length < 10) errors.push(m); };
        const totals = { commits: 0, arrivals: 0, stale: 0, olderClosed: 0, exactChecks: 0, planDraws: 0, evictions: 0, maxPinned: 0 };
        for (let seed = 1; seed <= 6; seed++) {
            const c = run(seed, 700, fail);
            for (const k of Object.keys(totals)) totals[k] = k === "maxPinned" ? Math.max(totals[k], c[k]) : totals[k] + c[k];
        }
        expect(errors).toEqual([]);
        // The run exercised what it claims to: stale arrivals closed, evictions, plans with exact draws.
        expect(totals.olderClosed).toBeGreaterThan(20);
        expect(totals.evictions).toBeGreaterThan(50);
        expect(totals.planDraws).toBeGreaterThan(200);
        expect(totals.exactChecks).toBeGreaterThan(10000);
    });

    test("an arrival overtaken by a change is kept (newer than what it replaces) and counted stale — F106", () => {
        const stage = fakeStage();
        const store = new PyramidStore({ fresh: stage, maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        const c = levelCell("F", 0, 1, 0, 0);
        store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null });
        store.beginJob(1, [c], 0);
        stage.commit({ F: [{ left: 10, top: 10, right: 20, bottom: 20 }] });           // G 1 meets the cell
        store.beginJob(2, [c], 1);
        stage.commit({ F: [{ left: 30, top: 30, right: 40, bottom: 40 }] });           // G 2 meets it too
        expect(store.put({ ...c, G: 1, bitmap: bitmap(), jobId: 2 })).toBe("newer");
        expect(store.exact(store.get(c.key))).toBe(false);
        const late = bitmap();
        expect(store.put({ ...c, G: 0, bitmap: late, jobId: 1 })).toBe("stale");        // job 1 arrives last: older, closed
        expect(late.closed).toBe(true);
        expect(store.get(c.key).G).toBe(1);
    });

    test("a hard drop refuses the jobs in flight: their results land nothing, even behind a newer job for the key", () => {
        const stage = fakeStage();
        const store = new PyramidStore({ fresh: stage, maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        const c = levelCell("F", 0, 1, 0, 0);
        store.beginJob(1, [c], 0);
        store.dropFrames((f) => f === "F");
        store.beginJob(2, [c], 0);
        const b = bitmap();
        expect(store.put({ ...c, G: 0, bitmap: b, jobId: 1 })).toBe("refused");
        expect(b.closed).toBe(true);
        expect(store.get(c.key)).toBeUndefined();
        expect(store.put({ ...c, G: 0, bitmap: bitmap(), jobId: 2 })).toBe("cached");
    });

    test("a hard drop refuses a job that a newer one for the same key overtook in the in-flight map", () => {
        const stage = fakeStage();
        const store = new PyramidStore({ fresh: stage, maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        const c = levelCell("F", 0, 1, 0, 0);
        store.beginJob(1, [c], 0);
        stage.commit({ F: [{ left: 1, top: 1, right: 2, bottom: 2 }] });      // overtakes job 1: the cell is wanted again
        expect(store.wants(c.key)).toBe(true);
        store.beginJob(2, [c], stage.generation);
        store.dropFrames((f) => f === "F");                                    // the id now means another place
        const late = bitmap();
        expect(store.put({ ...c, G: 0, bitmap: late, jobId: 1 })).toBe("refused");
        expect(late.closed).toBe(true);
        expect(store.put({ ...c, G: 1, bitmap: bitmap(), jobId: 2 })).toBe("refused");
        expect(store.get(c.key)).toBeUndefined();
    });

    test("in-flight dedupe: a key in flight packed at or after its dirt is not wanted again; one a change overtook is", () => {
        const stage = fakeStage();
        const store = new PyramidStore({ fresh: stage, maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        const c = levelCell("F", 0, 1, 0, 0);
        expect(store.wants(c.key)).toBe(true);
        store.beginJob(1, [c], 0);
        expect(store.wants(c.key)).toBe(false);
        stage.commit({ F: [{ left: 1, top: 1, right: 2, bottom: 2 }] });
        expect(store.inFlightExact(c.key)).toBe(false);
        expect(store.wants(c.key)).toBe(true);
    });

    test("the eviction order: stale first, then off-path, finer and far levels; the protected classes last, ring last of all", () => {
        const stage = fakeStage();
        const store = new PyramidStore({ fresh: stage, maxBytes: 100 * PLATE_BYTES, phone: false, doc: null });
        const put = (c) => store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null });
        store.setView({ frame: "F", level: 5, S: 1, ring: { i0: 0, i1: 1, j0: 0, j1: 0 }, rest: { frame: "F", Z: 40 },
            path: new Map([["F", 0], ["P", 12]]), left: "C", far: new Set([levelCell("P", 12, 1, 7, 7).key]) });
        // Placed apart, so the one commit below meets the cell `stale` alone; the three other levels put nearest first,
        // so least-recently-used alone would evict them in the wrong order.
        const cls = {
            outRing: levelCell("F", 5, 1, 9, 9), mid: levelCell("F", 2, 1, 4, 4), deep: levelCell("F", 0, 1, 3, 3),
            ring: levelCell("F", 5, 1, 0, 0), near: levelCell("F", 4, 1, 5, 5), near2: levelCell("F", 3, 1, 5, 5),
            left: levelCell("C", 9, 1, 0, 0), far: levelCell("P", 12, 1, 7, 7), finer: levelCell("F", 6, 1, 0, 0),
            off: levelCell("X", 5, 1, 0, 0), stale: levelCell("F", 5, 1, 1, 0),
        };
        for (const c of Object.values(cls)) put(c);
        stage.commit({ F: [{ left: 1.5 * 512 / 32, top: 1, right: 1.6 * 512 / 32, bottom: 2 }] });   // meets the cell (1, 0) at ℓ 5 only
        const R = (c) => store.rankOf(store.get(c.key));
        expect(R(cls.stale)).toBe(RANK.STALE);
        expect(R(cls.off)).toBe(RANK.OFF_PATH);
        expect(R(cls.finer)).toBe(RANK.FINER);
        expect([R(cls.deep), R(cls.mid), R(cls.outRing)]).toEqual([RANK.LEVELS, RANK.LEVELS, RANK.LEVELS]);
        expect([R(cls.far), R(cls.left), R(cls.near), R(cls.near2), R(cls.ring)]).toEqual([RANK.FAR, RANK.LEFT, RANK.NEAR, RANK.NEAR, RANK.RING]);
        // Squeeze one record at a time: the order they go in is the rank order, the farthest level first among the others.
        const order = [];
        for (let n = store.cache.size - 1; n >= 0; n--) {
            const before = new Set(store.cache.keys());
            store.setBudget(n * PLATE_BYTES);
            for (const k of before) if (!store.cache.has(k)) order.push(Object.keys(cls).find((x) => cls[x].key === k));
        }
        expect(order).toEqual(["stale", "off", "finer", "deep", "mid", "outRing", "far", "left", "near", "near2", "ring"]);
    });

    test("F166: the far share — the general budget never evicts a far record; the share evicts only its own, oldest first", () => {
        const store = new PyramidStore({ fresh: fakeStage(), maxBytes: 4 * PLATE_BYTES, farBytes: 2 * PLATE_BYTES, phone: false, doc: null });
        const far = [0, 1, 2].map((i) => levelCell("F", 1, 1, i, 9));
        store.setView({ frame: "F", level: 5, S: 1, ring: null, rest: null, path: new Map([["F", 0]]), left: null, far: new Set(far.map((c) => c.key)) });
        const put = (c) => store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null });
        const gen = [0, 1, 2, 3, 4, 5].map((i) => levelCell("F", 2, 1, i, 0));
        for (const c of [...far, ...gen]) put(c);                          // three far against a share of two, six against four
        expect(far.map((c) => !!store.get(c.key))).toEqual([false, true, true]);
        expect(gen.filter((c) => store.get(c.key)).length).toBe(4);        // no general record took a far one's place
        expect([store.roomFor(true), store.roomFor(false)]).toEqual([0, 4]);
        expect(store.wasEvicted(far[0].key)).toBe(true);
        store.setFarBudget(0);                                             // one budget again: the far records compete, ranked
        expect(store.cache.size).toBe(4);
        expect(far.slice(1).every((c) => !!store.get(c.key))).toBe(true);
    });

    test("F166: the frame a crossing left stands in at the view's level and coarser; finer than the view it ranks as finer", () => {
        const store = new PyramidStore({ maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        store.setView({ frame: "P", level: 5, S: 1, ring: null, rest: null, path: new Map([["P", 0]]), left: "C", leftShift: -12, far: new Set() });
        const rank = (c) => { store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null }); return store.rankOf(store.get(c.key)); };
        expect(rank(levelCell("C", -7, 1, 0, 0))).toBe(RANK.LEFT);       // −7 + 12 = 5: the view's level
        expect(rank(levelCell("C", -9, 1, 0, 0))).toBe(RANK.LEFT);       // coarser
        expect(rank(levelCell("C", -5, 1, 0, 0))).toBe(RANK.FINER);      // 7: the zoom-out passed it
    });

    test("F166: zooming in, finer levels go after the other levels; zooming out or still, before them", () => {
        const kept = (dir) => {
            const store = new PyramidStore({ maxBytes: 2 * PLATE_BYTES, phone: false, doc: null });
            store.setView({ frame: "F", level: 5, S: 1, ring: null, rest: null, path: new Map([["F", 0]]), left: null, far: new Set() });
            store.zoomDir = dir;
            const finer = levelCell("F", 6, 1, 0, 0);
            for (const c of [finer, levelCell("F", 1, 1, 0, 0), levelCell("F", 1, 1, 1, 0)]) store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null });
            return !!store.get(finer.key);
        };
        expect([kept(1), kept(-1), kept(0)]).toEqual([true, false, false]);
    });

    test("pins are never evicted; a cap under the pins is counted, not enforced on them", () => {
        const store = new PyramidStore({ maxBytes: 4 * PLATE_BYTES, phone: false, doc: null });
        const cs = [0, 1, 2, 3, 4, 5].map((i) => levelCell("F", 0, 1, i, 0));
        store.setDrawn(cs.slice(0, 3).map((c) => c.key));
        store.setPlanePins([cs[3].key]);
        for (const c of cs) store.put({ ...c, G: 0, bitmap: bitmap(), jobId: null });
        for (const c of cs.slice(0, 4)) expect(store.get(c.key)).toBeDefined();
        store.setBudget(2 * PLATE_BYTES);
        expect(store.cache.size).toBe(4);
        expect(store.s.overCapPinned).toBeGreaterThan(0);
        expect(store.pinnedCount()).toBe(4);
    });

    test("the hidden-tab release keeps ℓv − 2 of the view frame and closes everything else", () => {
        const store = new PyramidStore({ maxBytes: 64 * PLATE_BYTES, phone: false, doc: null });
        store.setView({ frame: "F", level: 5, S: 1, ring: null, rest: null, path: new Map([["F", 0]]), left: null, far: new Set() });
        const bms = [];
        for (const l of [2, 3, 4, 5]) for (let i = 0; i < 3; i++) { const b = bitmap(); bms.push([l, b]); store.put({ ...levelCell("F", l, 1, i, 0), G: 0, bitmap: b, jobId: null }); }
        store.release("hidden");
        expect([...store.records()].map((r) => r.level)).toEqual([3, 3, 3]);
        for (const [l, b] of bms) expect(b.closed).toBe(l !== 3);
    });

    test("the budget: views × one view, never under the pinned bound (the floor) nor over the ceiling, itself never under the floor", async () => {
        const { budgetBytes, viewUnit, ownBound } = await import("./PyramidStore");
        const MiB = 1024 * 1024;
        expect([viewUnit(2256, 1218), ownBound(2256, 1218), pinnedBound(2256, 1218, false)]).toEqual([40, 40, 134]);   // Kobin's desktop: 40 + 30 + 64
        expect([viewUnit(1079, 1969), ownBound(1079, 1969), pinnedBound(1079, 1969, true)]).toEqual([35, 35, 89]);     // A3's phone: 35 + 30 + 24
        expect([viewUnit(1170, 2532), ownBound(1170, 2532), pinnedBound(1170, 2532, true)]).toEqual([45, 45, 99]);     // 390×844@3
        expect([viewUnit(5120, 2880), ownBound(5120, 2880), pinnedBound(5120, 2880, false)]).toEqual([54, 77, 171]);   // 2560×1440@2: the rest set's 77
        expect(budgetBytes({ plateViews: 3, plateCeilingMiB: 256 }, 2256, 1218, false)).toBe(134 * MiB);  // three views under the floor
        expect(budgetBytes({ plateViews: 8, plateCeilingMiB: 64 }, 2256, 1218, false)).toBe(134 * MiB);   // the ceiling raised to the floor
        expect(budgetBytes({ plateViews: 2, plateCeilingMiB: 96 }, 1079, 1969, true)).toBe(89 * MiB);     // two views under the floor
        expect(budgetBytes({ plateViews: 4, plateCeilingMiB: 96 }, 1079, 1969, true)).toBe(96 * MiB);     // the ceiling
        expect(budgetBytes({ plateViews: 2, plateCeilingMiB: 96 }, 1170, 2532, true)).toBe(99 * MiB);     // PLAN §5.6 Q3: max(96, 99)
        expect(budgetBytes({ plateViews: 3, plateCeilingMiB: 256 }, 5120, 2880, false)).toBe(171 * MiB);
    });
});
