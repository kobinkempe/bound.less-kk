/**
 * PicturePyramid.rest.test.js — the rest render (A3 §2): the trigger is the first still frame; the estimate
 * T = 0.73 µs·E + 34 ns·A + 0.15 ms·P decides inline or workers on §2.2's worked cases; the inline executor makes
 * the view exact in the frame it runs; the worker rest set is posted after the quiet as one priority-0 group and
 * shown when all of it is in; rest plates survive a pure pan and are discarded by a zoom, a frame change and a
 * resize; an inline rest that ran over budget sends the next like it to the workers (D272's backstop).
 */
import PyramidStore, { PLATE_BYTES, restCell } from "./PyramidStore";
import PicturePyramid, { EST_DEFAULTS } from "./PicturePyramid";
import { packJob } from "./rasterPack";
import { fakeStage } from "../__testkit__/fakeStage";
import { lcg, randomList, LIST_CFG } from "../__testkit__/rasterLists";

const cam = (frame, inScale, panX, panY, w, h) => ({
    frame, inScale, inPanX: panX, inPanY: panY,
    frameWindow: () => ({ left: -panX / inScale, top: -panY / inScale, right: (w - panX) / inScale, bottom: (h - panY) / inScale }),
});

function setup({ W = 1200, H = 800, measure = null, cfg = {} } = {}) {
    const stage = fakeStage();
    const store = new PyramidStore({ fresh: stage, maxBytes: 400 * PLATE_BYTES, phone: false, doc: null });
    const list = randomList(lcg(77), 40);
    const clock = { t: 1000, timers: [] };
    const posted = [];
    const opts = {
        store, stage, lm: { frame: () => null, framePath: () => null }, cfg: { levelStep: 1, ...cfg },
        width: W, height: H, dpr: 1, pixels: true,
        now: () => clock.t,
        setTimer: (fn, ms) => { const tm = { fn, at: clock.t + ms, live: true }; clock.timers.push(tm); return tm; },
        clearTimer: (tm) => { if (tm) tm.live = false; },
        onRequest: (jobs) => posted.push(...jobs),
        pack: (job) => packJob(list, { plates: Int32Array.from(job.cells.flatMap((c) => [c.i, c.j])), q: 0, Zq: job.Z, dpr: 1,
            cfg: LIST_CFG, paper: [255, 255, 255], G: stage.generation }),
        measure: measure || ((job) => ({ E: 100, A: 1000, P: job.cells.length })),
    };
    const pyr = new PicturePyramid(null, opts);
    const tick = (ms) => {
        clock.t += ms;
        for (const tm of clock.timers.splice(0)) { if (tm.live && tm.at <= clock.t) tm.fn(); else if (tm.live) clock.timers.push(tm); }
    };
    return { stage, store, pyr, posted, clock, tick, list, W, H };
}

const restKeys = (store) => [...store.records()].filter((r) => r.kind === "rest").map((r) => r.key).sort();

describe("PicturePyramid — the rest render (A3 §2)", () => {
    test("the estimate on §2.2's worked cases: 4.1 ms inline, 15 ms and a 60-cell HiDPI screen to the workers", () => {
        const t = setup();
        const est = (m) => t.pyr.estimate({ kind: "rest", cells: [], measure: m, ...m });
        t.pyr._measure = (job) => job.measure;
        const light = est({ E: 2000, A: 50000, P: 6 });
        const dense = est({ E: 5000, A: 4 * 0.3 * 512 * 512, P: 4 });
        const hidpi = est({ E: 0, A: 0, P: 60 });
        expect(light).toBeCloseTo(0.73e-3 * 2000 + 34e-6 * 50000 + 0.15 * 6, 6);
        expect([light <= EST_DEFAULTS.restInlineMs, dense <= EST_DEFAULTS.restInlineMs, hidpi <= EST_DEFAULTS.restInlineMs]).toEqual([true, false, false]);
        expect(light).toBeGreaterThan(4); expect(light).toBeLessThan(4.2);
        expect(dense).toBeGreaterThan(14.5); expect(dense).toBeLessThan(15.5);
        expect(hidpi).toBeGreaterThanOrEqual(9);
    });

    test("the first still frame renders the rest set inline when it fits: exact, 1:1, in that frame", () => {
        const t = setup();
        const c = cam("F", 1.37, -40, -25, t.W, t.H);
        expect(t.pyr.frameFor(c).mode).toBe("level");                        // moving (the first frame): no rest render
        expect(restKeys(t.store)).toEqual([]);
        const v = t.pyr.frameFor(cam("F", 1.37, -40, -25, t.W, t.H));         // still
        expect(v.mode).toBe("rest");
        expect([v.Zq, v.s, v.Z]).toEqual([1.37, 1, 1.37]);
        const n = (v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1);
        expect(restKeys(t.store).length).toBe(n);
        for (const r of t.store.records()) expect(t.store.exact(r)).toBe(true);
        expect(t.pyr.s.restInline).toBe(1);
        const P0 = t.pyr.compose();
        expect(P0.draws.every((d) => d.rec && d.rec.kind === "rest" && d.cls === "sharp")).toBe(true);
        expect(t.pyr.lastPlan.cells.length).toBe(n);
        expect(t.posted.filter((j) => j.kind === "rest")).toEqual([]);
    });

    test("over budget, the rest set goes to the workers after the quiet as one priority-0 group, shown when all are in", () => {
        const t = setup({ measure: () => ({ E: 5000, A: 4 * 0.3 * 512 * 512, P: 4 }) });
        t.pyr.frameFor(cam("F", 2.5, -100, -60, t.W, t.H));
        t.pyr.frameFor(cam("F", 2.5, -100, -60, t.W, t.H));
        expect(t.posted.filter((j) => j.kind === "rest")).toEqual([]);
        t.tick(EST_DEFAULTS.restQuietMs - 1);
        expect(t.posted.filter((j) => j.kind === "rest")).toEqual([]);
        t.tick(1);
        const jobs = t.posted.filter((j) => j.kind === "rest");
        expect(jobs.length).toBe(1);
        const job = jobs[0];
        expect([job.prio, job.purpose, typeof job.group]).toEqual([0, "rest", "string"]);
        expect(job.cells.every((c) => c.kind === "rest" && c.Z === 2.5)).toBe(true);
        // The results come back one by one: held aside, the view still the level's, until the last.
        const packed = t.pyr._pack(job);
        const recs = job.cells.map((c, p) => ({ ...c, G: packed.G, pixels: new Uint8ClampedArray(512 * 512 * 4).fill(200), bytes: PLATE_BYTES, jobId: 7, p }));
        for (const r of recs.slice(0, -1)) expect(t.pyr.onResult(r)).toBe("held");
        expect(t.pyr._v.mode).toBe("level");
        expect(restKeys(t.store)).toEqual([]);
        expect(t.store.heldBytes).toBe((recs.length - 1) * PLATE_BYTES);
        t.pyr.onResult(recs[recs.length - 1]);
        expect(t.pyr._v.mode).toBe("rest");
        expect(restKeys(t.store).length).toBe(recs.length);
        expect(t.store.heldBytes).toBe(0);
        expect(t.pyr.s.groupsCommitted).toBe(1);
    });

    test("a move before the quiet ends posts nothing; restInline 'never' sends even a light screen to the workers", () => {
        const t = setup({ cfg: { restInline: "never" } });
        t.pyr.frameFor(cam("F", 1.1, 0, 0, t.W, t.H));
        t.pyr.frameFor(cam("F", 1.1, 0, 0, t.W, t.H));
        t.tick(50);
        t.pyr.frameFor(cam("F", 1.1, 3, 0, t.W, t.H));                        // a pan: the quiet starts over
        t.tick(80);
        expect(t.posted.filter((j) => j.kind === "rest")).toEqual([]);
        t.pyr.frameFor(cam("F", 1.1, 3, 0, t.W, t.H));
        t.tick(100);
        expect(t.posted.filter((j) => j.kind === "rest").length).toBe(1);
        expect(t.pyr.s.restInline).toBe(0);
    });

    test("rest plates survive a pure pan; the next still frame renders only the cells the pan exposed", () => {
        const t = setup();
        const Z = 1.25;
        t.pyr.frameFor(cam("F", Z, 0, 0, t.W, t.H));
        t.pyr.frameFor(cam("F", Z, 0, 0, t.W, t.H));
        const before = restKeys(t.store);
        expect(before.length).toBeGreaterThan(0);
        const v = t.pyr.frameFor(cam("F", Z, -700, -300, t.W, t.H));       // a pan: Z unchanged bit for bit
        expect(v.mode).toBe("rest");
        expect(restKeys(t.store)).toEqual(before);
        const P0 = t.pyr.compose();
        expect(P0.cells.some((c) => c.base)).toBe(true);                    // the exposed strip from the level plan
        expect(t.pyr.s.restDiscards).toBe(0);
        const inline0 = t.pyr.s.restInline;
        t.pyr.frameFor(cam("F", Z, -700, -300, t.W, t.H));
        expect(t.pyr.s.restInline).toBe(inline0 + 1);
        const after = restKeys(t.store);
        expect(after.filter((k) => !before.includes(k)).length).toBeGreaterThan(0);
        expect(before.every((k) => after.includes(k))).toBe(true);
        expect(t.pyr.compose().cells.some((c) => c.base)).toBe(false);
    });

    test("a zoom, a frame change and a resize discard the rest set at once: removed, closed, the view falls to its level", () => {
        for (const how of ["zoom", "frame", "resize"]) {
            const t = setup();
            t.pyr.frameFor(cam("F", 1.25, 0, 0, t.W, t.H));
            t.pyr.frameFor(cam("F", 1.25, 0, 0, t.W, t.H));
            const closed = [];
            for (const r of t.store.records()) if (r.kind === "rest") r.bitmap = { close() { closed.push(r.key); } };
            const n = restKeys(t.store).length;
            expect(n).toBeGreaterThan(0);
            let v;
            if (how === "zoom") v = t.pyr.frameFor(cam("F", 1.25 * 1.01, 0, 0, t.W, t.H));
            else if (how === "frame") v = t.pyr.frameFor(cam("G", 1.25, 0, 0, t.W, t.H));
            else { t.pyr.setSize(t.W - 10, t.H, 1); v = t.pyr.frameFor(cam("F", 1.25, 0, 0, t.W - 10, t.H)); }
            expect([how, v.mode]).toEqual([how, "level"]);
            expect([how, restKeys(t.store)]).toEqual([how, []]);
            expect(closed.length).toBe(n);
            expect(t.pyr.s.restDiscards).toBe(1);
            // A result of the discarded set arriving late is closed, not stored.
            let late = false;
            expect(t.pyr.onResult({ ...restCell("F", 1.25, 0, 0), G: 0, bitmap: { close() { late = true; } }, jobId: 3 })).toBe("discarded");
            expect(late).toBe(true);
        }
    });

    test("D272's backstop: an inline rest that ran over budget sends the next like it to the workers", () => {
        const t = setup({ measure: () => ({ E: 1000, A: 1000, P: 4 }) });
        const pack = t.pyr._pack;
        t.pyr._pack = (job) => { t.clock.t += 20; return pack(job); };      // this inline rest takes 20 ms
        t.pyr.frameFor(cam("F", 1.25, 0, 0, t.W, t.H));
        t.pyr.frameFor(cam("F", 1.25, 0, 0, t.W, t.H));
        expect([t.pyr.s.restInline, t.pyr.s.restHeavy]).toEqual([1, 1]);
        t.pyr.frameFor(cam("F", 1.5, 0, 0, t.W, t.H));
        t.pyr.frameFor(cam("F", 1.5, 0, 0, t.W, t.H));
        expect(t.pyr.s.restInline).toBe(1);                                  // the same estimate: workers
        t.tick(100);
        expect(t.posted.filter((j) => j.kind === "rest").length).toBe(1);
    });

    test("online calibration moves the constants towards the measured per-edge and per-pixel costs", () => {
        const t = setup();
        const k0 = { ...t.pyr._k };
        for (let n = 0; n < 60; n++) t.pyr.calibrate({ edges: 10000, edgesMs: 2, px: 1e6, accumMs: 10, unionRows: 100, unionMs: 3 });
        expect(t.pyr._k.edge).toBeCloseTo(2e-4, 6);
        expect(t.pyr._k.px).toBeCloseTo(1e-5, 7);
        expect(t.pyr._k.union).toBeCloseTo(0.03, 4);
        expect(t.pyr._k.edge).toBeLessThan(k0.edge);
        t.pyr.calibrate({ edges: 10, edgesMs: 50, px: 10, accumMs: 50 });   // too small a sample to mean anything
        expect(t.pyr._k.edge).toBeCloseTo(2e-4, 6);
    });
});
