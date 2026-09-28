/**
 * raster.pyramid.test.js — the picture pyramid wired into the engine under `cfg.pyramid` (A3 §10.1 step 6, §7.4, §8;
 * B-PYRAMID-2 P1): the gate builds the pyramid's store, the pyramid as the layer and the queue, and nothing of the old
 * path's; a drawn stroke lands in exact plates through the queue and the client's pool, every job id ended; the
 * still frame after a camera step renders the rest set; the prefetch waits for the view's jobs; the levers take
 * effect live; a camera job keeps only the cells the table covers; a teardown dispatches nothing more.
 */
import { useEngines, mkEngine, drawStroke, erase, descend, ascend } from "../__testkit__/harness";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import PyramidStore, { budgetBytes } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import PictureLayer from "./PictureLayer";
import PlateStore from "./PlateStore";
import { rasterStats, resetRasterStats } from "./RasterRenderer";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { lcg } from "../__testkit__/rasterLists";

useEngines();
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(E, frames = 6) {
    for (let k = 0; k < frames; k++) { E.renderer.syncCameraOnly(); for (let n = 0; n < 4; n++) await tick(); }
}
/** The pool, gated: every dispatch parks until released; `run` answers all at once through the shipped worker entry. */
function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        parked,
        async run() {
            while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); }
            for (let n = 0; n < 6; n++) await tick();
        },
    };
}
/** Answer and step until nothing is parked, queued or in flight (at most 200 rounds). */
async function drain(E, g) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    for (let k = 0; k < 200 && busy(); k++) { await g.run(); await settle(E, 1); }
    return busy();
}
const stroke = (E) => drawStroke(E, [[100, 100], [220, 160], [340, 120], [460, 320]]);
const planCls = (R) => R.pyramid.lastPlan.cells.map((c) => c.draws.map((d) => d.cls).join("+"));

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(2); resetRasterStats(); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

describe("the pyramid's path under cfg.pyramid (B-PYRAMID-2 P1)", () => {
    test("the gate: pyramid on builds its store, the pyramid as the layer and the queue; off, the old layer and store", () => {
        const on = mkEngine(800, 600, { raster: true, pyramid: true });
        expect(on.renderer.pyramid).toBeInstanceOf(PicturePyramid);
        expect(on.renderer.layer).toBe(on.renderer.pyramid);
        expect(on.plates).toBeInstanceOf(PyramidStore);
        expect(on.plates).toBe(on.renderer.store);
        expect(on.renderer.queue).not.toBeNull();
        expect(on.renderer.supportsDragPlane).toBe(false);
        const off = mkEngine(800, 600, { raster: true });
        expect(off.renderer.pyramid).toBeNull();
        expect(off.renderer.layer).toBeInstanceOf(PictureLayer);
        expect(off.plates).toBeInstanceOf(PlateStore);
        expect(off.renderer.supportsDragPlane).toBe(true);
    });

    test("a stroke lands in exact plates through the queue and the pool; every job id ended; the pen-up path handed off", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
        const q = R.queue.report();
        expect(q.dispatched).toBeGreaterThan(0);
        expect(q.done).toBe(q.dispatched);
        expect(E.plates.report().inFlight).toBe(0);
        expect(rasterStats.jobsEnded).toBe(q.dispatched);
        expect(R._liveHeld.length).toBe(0);
        expect(rasterStats.liveHandoffs).toBe(1);
    });

    test("the still frame: after a camera step the engine asks one more frame, and that frame renders the rest set", async () => {
        const E = mkEngine(800, 600, { raster: true, pyramid: true, frames: "raf" }), R = E.renderer;
        stroke(E);
        E.flush();
        E.zoomAt(400, 300, -250);
        E.flush();                                                      // the zoom's step
        expect(E._fr && E._fr.still).toBe(true);
        expect(R._view.mode).toBe("level");
        E.flush();                                                      // the still frame
        expect(R._view.mode).toBe("rest");
        expect(R.pyramid.s.restInline).toBeGreaterThan(0);
        expect(E._fr).toBeNull();                                       // and no frame after it
    });

    test("the prefetch waits until nothing of the view's or a patch's is queued or in flight, then runs once a view revision", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        R.pyramid.cfg.restInline = "never";
        stroke(E);
        E.zoomAt(400, 300, -600);
        await settle(E, 2);
        expect(R.queue.report().inFlight[1] + R.queue.report().queued[1]).toBeGreaterThan(0);
        expect(R.queue.report().queued[4] + R.queue.report().inFlight[4]).toBe(0);
        await g.run();
        await settle(E, 2);
        await g.run();
        const q = R.queue.report();
        expect(q.pushed).toBeGreaterThan(1);
        expect(E.plates.view.far.size).toBeGreaterThan(0);
        const pushed = q.pushed;
        await settle(E, 3);                                             // the same view: no second plan
        expect(R.queue.report().pushed).toBe(pushed);
        // A change stales the near coarser levels: the next idle plans again and refreshes them (a zoom's stand-in).
        expect(await drain(E, g)).toBe(0);
        const lv = R._view.level;
        const near = () => [...E.plates.records()].filter((r) => r.kind === "level" && r.level === lv - 1);
        expect(near().length).toBeGreaterThan(0);
        drawStroke(E, [[120, 420], [640, 180]], 20);
        await settle(E, 1);
        expect(near().some((r) => !E.plates.exact(r))).toBe(true);
        expect(await drain(E, g)).toBe(0);
        expect(near().filter((r) => !E.plates.exact(r)).map((r) => r.key)).toEqual([]);
    });

    test("the levers take effect live: a step change drops the old step's level records and moves the purposes; a budget change evicts once", async () => {
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        stroke(E);
        E.zoomAt(400, 300, -600);
        await settle(E, 3);
        const levels = () => [...E.plates.records()].filter((r) => r.kind === "level");
        expect(levels().length).toBeGreaterThan(0);
        expect(levels().every((r) => r.S === 1)).toBe(true);
        const gens = { ...R.pyramid.gens };
        E.setLevelStep(2);
        expect(levels().every((r) => r.S === 2)).toBe(true);
        expect(R.pyramid.gens.view).toBeGreaterThan(gens.view);
        expect(R.pyramid.gens.prefetch).toBeGreaterThan(gens.prefetch);
        const MiB = 1024 * 1024;
        E.setPlateBudget({ views: 8, ceilingMiB: 512 });
        expect(E.plates.maxBytes).toBe(budgetBytes(E.cfg, R.pyramid.wDev, R.pyramid.hDev, E.plates.phone));
        expect(E.plates.maxBytes).toBeGreaterThan(R.pyramid.pinBound * MiB);
        const ev0 = E.plates.s.evictions;
        E.setPlateBudget({ views: 1, ceilingMiB: 64 });
        expect(E.plates.maxBytes).toBe(R.pyramid.pinBound * MiB);           // one view under the floor: the floor
        expect(E.plates.s.evictions).toBeGreaterThanOrEqual(ev0);
        E.setPlateBudget({ views: 3, ceilingMiB: 256 });
        const b0 = E.plates.maxBytes;
        E.resize(1600, 1200);                                           // the budget follows the screen (A3 §4.5)
        expect(E.plates.maxBytes).toBe(budgetBytes(E.cfg, R.pyramid.wDev, R.pyramid.hDev, E.plates.phone));
        expect(E.plates.maxBytes).toBeGreaterThan(b0);
    });

    test("a camera job keeps only the cells the table covers: the rest are refused at dispatch and asked for again", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        R.pyramid.cfg.restInline = "never";
        stroke(E);
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        const covers = E.stage.covers.bind(E.stage);
        let refuse = true;
        E.stage.covers = (f, r) => (refuse ? false : covers(f, r));
        const l0 = R._view.level;
        E.zoomAt(400, 300, -1500);                                      // a new view level: its cells are missing
        await settle(E, 2);
        expect(R._view.level).toBeGreaterThan(l0);
        expect(rasterStats.refusedCover).toBeGreaterThan(0);
        const view = () => { const r = R.queue.report(); return r.inFlight[1] + r.queued[1]; };
        expect(view()).toBe(0);
        refuse = false;
        await settle(E, 2);
        expect(view()).toBeGreaterThan(0);                              // asked for again, and posted
        expect(await drain(E, g)).toBe(0);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
        const q = R.queue.report();
        expect([q.done, q.drops.empty > 0]).toEqual([q.dispatched, true]);   // a refused strip is the queue's drop, never a `done`
    });

    test("a teardown dispatches nothing more: the queued strips are forgotten, the ones in flight ended", async () => {
        const g = gate();
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        R.pyramid.cfg.restInline = "never";
        stroke(E);
        E.zoomAt(400, 300, -600);
        await settle(E, 2);
        expect(R.queue.report().queued.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        const posted = g.parked.length;
        E.destroy();
        expect(g.parked.length).toBe(posted);
        expect(R.queue.report().queued.reduce((a, b) => a + b, 0)).toBe(0);
    });
});

/** The view cells a frame box lies under, in the plan's own grid (rest or level). */
function cellsUnder(P, b) {
    const v = P.v, x0 = b.left * v.Zq, y0 = b.top * v.Zq, x1 = b.right * v.Zq, y1 = b.bottom * v.Zq;
    return P.cells.filter((c) => c.draws.some((d) => d.x0 < x1 && d.x1 > x0 && d.y0 < y1 && d.y1 > y0));
}
/** A record's cell rendered whole from the Stage's items at its own G (the pixels a fresh job would bring). */
function wholeRender(E, rec) {
    const list = [...E.stage.items()].filter((it) => !it.pending);
    const job = packJob(list, { plates: Int32Array.of(rec.i, rec.j), Zq: rec.Z, dpr: E.renderer.pyramid.dpr, cfg: E.cfg, paper: E.renderer._paperRgb, G: rec.G });
    const out = new Uint8ClampedArray(512 * 512 * 4);
    if (job.nItems > 0) renderPlate(job, 0, out, null, null);
    else for (let k = 0; k < out.length; k += 4) { out[k] = 255; out[k + 1] = 255; out[k + 2] = 255; out[k + 3] = 255; }
    return out;
}
const diffBytes = (a, b) => { let n = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) n++; return n; };

describe("the pen-up rule and the partial path on the pyramid (B-PYRAMID-2 P2)", () => {
    test("pen-up: no compose shows both the held path and the stroke's plates, or neither; the path goes in the task that publishes them", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        const log = [];
        let held = null;
        const compose = R.pyramid.compose.bind(R.pyramid);
        R.pyramid.compose = () => {
            const P = compose();
            if (held) {
                const Gs = E.stage.landedAt(held.id), under = cellsUnder(P, held.box);
                const plates = Gs != null && under.length > 0 && under.every((c) => c.draws.every((d) => d.rec && d.rec.G >= Gs && E.plates.exact(d.rec)));
                log.push({ path: R._liveHeld.includes(held), plates });
            }
            return P;
        };
        E.setOpacity(0.5);
        drawStroke(E, [[150, 150], [300, 260], [450, 200], [520, 330]], 13, null, { raw: true });
        held = R._liveHeld[0];
        expect(held && E.stage.itemsOf(held.id).some((it) => it.pending)).toBe(true);
        await settle(E, 2);                                            // pending: the path is the picture
        E.flushBakes();                                                // the shape lands in one commit
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(log.length).toBeGreaterThan(3);
        expect(log.filter((e) => e.path === e.plates)).toEqual([]);  // never both, never neither
        expect(log[log.length - 1]).toEqual({ path: false, plates: true });
        expect(rasterStats.liveHandoffs).toBe(1);
        // The re-rendered rectangle equals a whole render of each cell under it, at the same G.
        const under = cellsUnder(R.pyramid.lastPlan, held.box).flatMap((c) => c.draws.map((d) => d.rec));
        expect(under.length).toBeGreaterThan(0);
        for (const rec of under) expect([rec.key, diffBytes(rec.pixels, wholeRender(E, rec))]).toEqual([rec.key, 0]);
    });

    test("pen-up through the workers: while its group waits, the stale cells under the stroke are drawn held — the path shows the change — never older", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        drawStroke(E, [[160, 120], [420, 380]], 16);                   // ink under the next stroke, so its cells are stale
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = 0;                               // every patch to the workers
        const older0 = R.pyramid.s.olderMs;
        drawStroke(E, [[150, 150], [300, 260], [450, 200]], 13, null, { raw: true });
        const held = R._liveHeld[0];
        E.flushBakes();                                                // the shape lands: the group asks the workers
        await settle(E, 2);                                            // and waits: the gate holds its jobs
        expect(R._liveHeld.includes(held)).toBe(true);
        const cls = cellsUnder(R.pyramid.lastPlan, held.box).flatMap((c) => c.draws.map((d) => d.cls));
        expect(cls.filter((k) => k === "held").length).toBeGreaterThan(0);
        expect(cls.filter((k) => k === "older")).toEqual([]);
        expect(await drain(E, g)).toBe(0);
        expect(R._liveHeld.length).toBe(0);
        expect(R.pyramid.s.olderMs).toBe(older0);
        delete R.pyramid.cfg.patchInlineMs;
    });

    test("never older while a fresh source is cached: a seeded fuzz of draw, undo, redo, erase, zoom, pan and crossings with the gated pool", async () => {
        const g = gate();
        let olderCells = 0, wrong = [], plans = 0;
        for (const seed of [3, 11]) {
            const rnd = lcg(seed), E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
            const compose = R.pyramid.compose.bind(R.pyramid);
            R.pyramid.compose = () => {
                const P = compose();
                plans++;
                for (const c of P.cells) {
                    if (!c.draws.some((d) => d.cls === "older")) continue;
                    olderCells++;
                    const src = freshSourceFor(E, P, c);
                    if (src && wrong.length < 5) wrong.push(`seed ${seed}: cell ${c.i},${c.j} drawn older while ${src} is exact`);
                }
                return P;
            };
            const pt = () => [60 + rnd() * 680, 60 + rnd() * 480];
            for (let step = 0; step < 14; step++) {
                const op = rnd();
                if (op < 0.3) drawStroke(E, [pt(), pt(), pt()], 6 + rnd() * 30);
                else if (op < 0.4) E.undo();
                else if (op < 0.5) E.redo();
                else if (op < 0.6) erase(E, [pt(), pt()], 20 + rnd() * 40);
                else if (op < 0.75) E.zoomAt(400, 300, (rnd() - 0.5) * 1600);
                else if (op < 0.85) E.panBy((rnd() - 0.5) * 300, (rnd() - 0.5) * 300);
                else if (E.activeLevel === 0) descend(E, 1);
                else ascend(E, 0);
                await settle(E, 1);
                await drain(E, g);
            }
            E.destroy();
        }
        expect(plans).toBeGreaterThan(40);
        expect(wrong).toEqual([]);
        expect(olderCells).toBeLessThan(plans);                       // the fuzz reaches the last resort, rarely
    }, 60000);
});

/**
 * An exact record within N = ⌈8/S⌉ levels at or above a plan cell's own zoom whose box covers the cell, in any frame
 * the lattice maps into the view's (brute force over the store, independent of the plan's lookup), or null.
 */
function freshSourceFor(E, P, c) {
    const v = P.v, F = String(v.frameId), S = v.S, Zc = c.rest ? v.Z : 2 ** (v.level * S), N = Math.ceil(8 / S);
    const cb = { left: c.i * 512 / Zc, top: c.j * 512 / Zc, right: (c.i + 1) * 512 / Zc, bottom: (c.j + 1) * 512 / Zc };
    for (const r of E.plates.records()) {
        if (r.kind === "plane" || !E.plates.exact(r)) continue;
        let box = { left: r.i * 512 / r.Z, top: r.j * 512 / r.Z, right: (r.i + 1) * 512 / r.Z, bottom: (r.j + 1) * 512 / r.Z };
        let Zf = r.Z;
        if (r.frame !== F) {
            const m = E.lm.mapRectF(box, r.frame, F);
            if (!m) continue;
            Zf = r.Z * (box.right - box.left) / (m.right - m.left);
            box = m;
        }
        if (Zf > Zc * 1.0001 || Zf < Zc / 2 ** (N * S) / 1.0001) continue;
        const e = 1e-9 * Math.max(1, Math.abs(cb.left), Math.abs(cb.top));
        if (box.left <= cb.left + e && box.top <= cb.top + e && box.right >= cb.right - e && box.bottom >= cb.bottom - e) return r.key;
    }
    return null;
}
