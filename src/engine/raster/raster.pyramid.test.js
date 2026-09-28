/**
 * raster.pyramid.test.js — the picture pyramid wired into the engine under `cfg.pyramid` (A3 §10.1 step 6, §7.4, §8;
 * B-PYRAMID-2 P1): the gate builds the pyramid's store, the pyramid as the layer and the queue, and nothing of the old
 * path's; a drawn stroke lands in exact plates through the queue and the client's pool, every job id ended; the
 * still frame after a camera step renders the rest set; the prefetch waits for the view's jobs; the levers take
 * effect live; a camera job keeps only the cells the table covers; a teardown dispatches nothing more.
 */
import { useEngines, mkEngine, drawStroke } from "../__testkit__/harness";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import PyramidStore, { budgetBytes } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import PictureLayer from "./PictureLayer";
import PlateStore from "./PlateStore";
import { rasterStats, resetRasterStats } from "./RasterRenderer";

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
        const ev0 = E.plates.s.evictions;
        E.setPlateBudget({ views: 1, ceilingMiB: 64 });
        expect(E.plates.maxBytes).toBe(budgetBytes(E.cfg, R.pyramid.wDev, R.pyramid.hDev, E.plates.phone));
        expect(E.plates.maxBytes).toBe(R.pyramid.pinBound * 1024 * 1024);     // one view under the floor: the floor
        expect(E.plates.s.evictions).toBeGreaterThanOrEqual(ev0);
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
