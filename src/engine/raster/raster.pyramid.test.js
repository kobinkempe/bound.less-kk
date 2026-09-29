/**
 * raster.pyramid.test.js — the picture pyramid wired into the engine, the raster path's one picture (A3 §10.1 step 6,
 * §8; B-PYRAMID-2 P1–P4): the engine builds the pyramid's store, the pyramid as the layer and the queue; a drawn stroke
 * lands in exact plates through the queue and the client's pool, every job id ended; the still frame after a camera
 * step renders the rest set; the prefetch waits for the view's jobs; the levers take effect live; a camera job keeps
 * only the cells the table covers; a teardown dispatches nothing more. Ported from `raster.picture` (B-PYRAMID-2b):
 * F101 (a destroyed engine puts nothing back) and F106 (a newer stale result replaces older stale pixels, the
 * monotone-G rule).
 */
import { useEngines, mkEngine, drawStroke, erase, descend, ascend } from "../__testkit__/harness";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import PyramidStore, { budgetBytes } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import { rasterStats, resetRasterStats } from "./RasterRenderer";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { lcg } from "../__testkit__/rasterLists";
import { planeStats } from "./MovePlane";
import { W } from "../frameLattice";

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

describe("the pyramid wired into the engine (B-PYRAMID-2 P1)", () => {
    test("the raster engine builds the pyramid's store, the pyramid as the layer and the queue", () => {
        const on = mkEngine(800, 600, { raster: true });
        expect(on.renderer.pyramid).toBeInstanceOf(PicturePyramid);
        expect(on.renderer.layer).toBe(on.renderer.pyramid);
        expect(on.plates).toBeInstanceOf(PyramidStore);
        expect(on.plates).toBe(on.renderer.store);
        expect(on.renderer.queue).not.toBeNull();
        expect(on.renderer.supportsDragPlane).toBe(true);
    });

    test("a stroke lands in exact plates through the queue and the pool; every job id ended; the pen-up path handed off", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
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
        const E = mkEngine(800, 600, { raster: true, frames: "raf" }), R = E.renderer;
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
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R.pyramid.cfg.restInline = "never";
        R.cfg.prefetchQuietMs = 0;                                      // the scene's quiet is the next test's
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

    test("the prefetch waits for the scene's quiet: commits every 20 ms plan nothing; the rest's quiet after the last, one plan", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        await new Promise((r) => setTimeout(r, 150));
        expect(await drain(E, g)).toBe(0);
        const pushed0 = R.queue.report().pushed;
        for (let k = 0; k < 10; k++) {                                   // a bake's pace: a commit every 20 ms, on screen
            E.doc.add(fillAt(E, 100 + 30 * k, 120, "rgb(30,30,200)", 20), "0");
            E._render();
            await settle(E, 1);
            await new Promise((r) => setTimeout(r, 20));
        }
        expect(R.queue.report().pushed).toBe(pushed0);                   // red before: a plan a commit
        for (let t = 0; t < 1000 && R.queue.report().pushed === pushed0; t += 10) await new Promise((r) => setTimeout(r, 10));
        expect(R.queue.report().pushed).toBeGreaterThan(pushed0);        // planned once the scene was quiet
    });

    test("a new prefetch plan supersedes the queued one: the old plan's strips drop at dispatch by generation", async () => {
        const g = gate();
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R.cfg.prefetchQuietMs = 0;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        E.zoomAt(400, 300, -600);
        for (let k = 0; k < 20 && !R.queue.report().queued[4]; k++) { await g.run(); await settle(E, 1); }
        expect(R.queue.report().queued[4]).toBeGreaterThan(0);          // a plan's strips wait behind the one worker
        const gen0 = R.queue.report().drops.gen, pushed0 = R.queue.report().pushed;
        E.doc.add(fillAt(E, 90000, 90000, "rgb(30,30,200)"), "0");      // a commit far off the view: a new generation, no patch
        E._render();
        await settle(E, 2);
        expect(R.queue.report().pushed).toBeGreaterThan(pushed0);       // planned again
        expect(await drain(E, g)).toBe(0);
        expect(R.queue.report().drops.gen).toBeGreaterThan(gen0);       // red before: both plans ran
    });

    test("the levers take effect live: a step change drops the old step's level records and moves the purposes; a budget change evicts once", async () => {
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
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

    test("a cell the camera's table does not cover is drawn from stand-ins and never asked for; once covered it is asked for and lands", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
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
        const asked = () => { const r = R.queue.report(); return r.inFlight[0] + r.queued[0] + r.inFlight[1] + r.queued[1]; };
        expect([asked(), rasterStats.refusedCover, rasterStats.refusedCoverPlates]).toEqual([0, 0, 0]);   // planned, never dispatched
        expect(planCls(R).some((c) => c !== "sharp")).toBe(true);
        refuse = false;
        await settle(E, 2);
        expect(asked()).toBeGreaterThan(0);                             // covered: asked for, and posted
        expect(await drain(E, g)).toBe(0);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
        expect([rasterStats.refusedCover, R.queue.report().done]).toEqual([0, R.queue.report().dispatched]);
        // A stale drawn cell over tiles not in the table is not patched from it: it waits for them.
        refuse = true;
        E.undo();
        await settle(E, 2);
        expect([rasterStats.refusedCover, rasterStats.refusedCoverPlates]).toEqual([0, 0]);
        refuse = false;
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
    });

    test("a cell whose tiles left the table after it was asked for is refused at the pack and asked for again once covered", async () => {
        const g = gate();
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R.pyramid.cfg.restInline = "never";
        R._pyrPrefetch = () => {};
        stroke(E);
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        E.zoomAt(400, 300, -1500);
        await settle(E, 1);
        const waiting = R.queue.queue.find((st) => st.kind === "view" && st.cells.length > 1);
        expect(waiting).toBeTruthy();                                   // a view strip behind the one worker's
        const c = waiting.cells[0], u = 512 / c.Z;
        const covers = E.stage.covers.bind(E.stage);
        let refuse = true;
        E.stage.covers = (f, r) => !(refuse && Math.abs(r.left - c.i * u) < 1e-9 && Math.abs(r.top - c.j * u) < 1e-9) && covers(f, r);
        await g.run();                                                  // the first lands; the waiting strip packs without cell c
        await settle(E, 1);
        expect([rasterStats.refusedCoverPlates, rasterStats.refusedCover]).toEqual([1, 0]);
        expect(await drain(E, g)).toBe(0);
        expect(E.plates.get(c.key)).toBeFalsy();                        // not drawn from a table lacking its tiles
        refuse = false;
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(E.plates.exact(E.plates.get(c.key))).toBe(true);         // asked for again (red before: asked once, for ever)
    });

    test("the camera's read (A3 §4.2): a step reads the cache alone, its missing tiles are read at idle after the quiet, and only then are their cells asked for", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        const budgets = [], sync = E.stage.sync.bind(E.stage);
        E.stage.sync = (f, w, b) => { budgets.push(b); return sync(f, w, b); };
        E._render();
        expect(budgets).toEqual([Infinity]);                            // a document render reads everything
        budgets.length = 0;
        for (let k = 0; k < 3; k++) E.zoomAt(400, 300, -3000);          // into a child frame none of whose tiles were read
        const F = E.cam.frame;
        expect(F).not.toBe("0");
        expect(budgets.length > 0 && budgets.every((b) => b === 0)).toBe(true);
        expect(E.stage.covers(F, E._listWin())).toBe(false);
        await settle(E, 1);
        const box = (x) => ({ left: x.i * 512 / x.Z, top: x.j * 512 / x.Z, right: (x.i + 1) * 512 / x.Z, bottom: (x.j + 1) * 512 / x.Z });
        const cellsAsked = () => [...R.queue.queue, ...R.queue.inFlight.values()].flatMap((st) => st.cells).filter((x) => x.frame === F);
        expect(cellsAsked().every((x) => E.stage.covers(F, box(x)))).toBe(true);
        for (let t = 0; t < 300; t += 20) { E.panBy(1, 0); await new Promise((r) => setTimeout(r, 20)); }
        expect(budgets.every((b) => b === 0)).toBe(true);                // nothing baked while the camera keeps moving
        let steps = 0;
        const step = R.syncCameraOnly.bind(R);
        R.syncCameraOnly = () => { steps++; return step(); };
        for (let t = 0; t < 3000 && !E.stage.covers(E.cam.frame, E._listWin()); t += 10) await new Promise((r) => setTimeout(r, 10));
        expect(E.stage.covers(E.cam.frame, E._listWin())).toBe(true);    // read at idle, a slice at a time
        expect(budgets.some((b) => b > 0 && b !== Infinity)).toBe(true);
        expect(steps).toBeGreaterThan(0);                                // a slice that changed the table stepped the renderer
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(planCls(R).every((x) => x === "sharp")).toBe(true);
        expect([rasterStats.refusedCover, rasterStats.refusedCoverPlates]).toEqual([0, 0]);
    });

    test("a teardown dispatches nothing more: the queued strips are forgotten, the ones in flight ended", async () => {
        const g = gate();
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
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
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
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
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        drawStroke(E, [[160, 120], [420, 380]], 16);                   // ink under the next stroke, so its cells are stale
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = 0;                               // every patch to the workers
        const older = () => R.pyramid.s.olderPatchMs + R.pyramid.s.olderOtherMs, older0 = older();
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
        expect(older()).toBe(older0);
        delete R.pyramid.cfg.patchInlineMs;
    });

    test("undo and redo reach the pyramid as Stage dirt: the frame's patch step re-renders the rectangle inline, equal to a whole render", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        drawStroke(E, [[140, 140], [520, 420]], 18);
        drawStroke(E, [[160, 420], [560, 160]], 18);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = R.pyramid.cfg.patchUserMs = 1e9;  // inline whatever the calibrated estimate says
        const box = { left: 100, top: 100, right: 600, bottom: 460 }, c0 = E.cam;
        const frameBox = { left: (box.left - c0.inPanX) / c0.inScale, top: (box.top - c0.inPanY) / c0.inScale, right: (box.right - c0.inPanX) / c0.inScale, bottom: (box.bottom - c0.inPanY) / c0.inScale };
        for (const op of ["undo", "redo"]) {
            const n0 = R.pyramid.s.patchInline;
            E[op]();                                                    // renders: the frame's patch step runs inline
            expect(R.pyramid.s.patchInline).toBeGreaterThan(n0);
            const q = R.queue.report();                                 // no patch or view job to the workers (the prefetch may refresh)
            expect([q.queued[0], q.queued[1], q.inFlight[0], q.inFlight[1]]).toEqual([0, 0, 0, 0]);
            const recs = cellsUnder(R.pyramid.lastPlan, frameBox).flatMap((c) => c.draws.map((d) => d.rec));
            expect(recs.length).toBeGreaterThan(0);
            for (const rec of recs) {
                expect([op, rec.key, E.plates.exact(rec)]).toEqual([op, rec.key, true]);
                expect([op, rec.key, diffBytes(rec.pixels, wholeRender(E, rec))]).toEqual([op, rec.key, 0]);
            }
            expect(await drain(E, g)).toBe(0);
        }
        delete R.pyramid.cfg.patchInlineMs; delete R.pyramid.cfg.patchUserMs;
    });

    test("the undo of a small stroke over dense cells is inline: the estimate clipped to the patch, one frame (16 ms) for a user's patch, 6 ms for a patch the bake issues (A3 §3.3)", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, c0 = E.cam;
        R.pyramid.calibrate = () => ({});                              // the Chrome-derived constants, not this node's timings
        const F = (sx, sy) => [(sx - c0.inPanX) / c0.inScale, (sy - c0.inPanY) / c0.inScale];
        // Ten translucent fills across the screen, each top edge a 1,500-point wave: the cells' chords far past the cap.
        for (let k = 0; k < 10; k++) {
            const ring = [];
            for (let n = 0; n <= 1500; n++) ring.push(F(20 + n * 0.5, 40 + k * 4 + 12 * Math.sin(n / 7)));
            ring.push(F(770, 580), F(20, 580));
            E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(" + 20 * k + ",90,160)", opacity: 0.4, polys: [ring] }, "0");
        }
        E._render();
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        drawStroke(E, [[70, 500], [95, 520], [110, 510]], 8, "#c00");
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        for (const op of ["undo", "redo"]) {
            const n0 = R.pyramid.s.patchInline;
            E[op]();
            const lp = R.pyramid.lastPatch;
            expect([op, lp.inline, lp.budget]).toEqual([op, true, 16]);
            expect(R.pyramid.s.patchInline).toBe(n0 + 1);
            // Whole cells, the same estimate reads past the cap: the clip is what makes it small.
            const [a, b] = [F(60, 490), F(120, 530)];
            const recs = cellsUnder(R.pyramid.lastPlan, { left: a[0], top: a[1], right: b[0], bottom: b[1] }).flatMap((c) => c.draws.map((d) => d.rec));
            expect(recs.length).toBeGreaterThan(0);
            const whole = R._pyrMeasure({ kind: "patch", Z: recs[0].Z, cells: recs.map((r) => ({ i: r.i, j: r.j })), clips: null });
            expect(whole.E).toBeGreaterThan(20000);
            expect(lp.est.E).toBeLessThan(whole.E / 4);
            expect(lp.T).toBeLessThan(6);
            for (const rec of recs) {
                expect([op, rec.key, E.plates.exact(rec), diffBytes(rec.pixels, wholeRender(E, rec))]).toEqual([op, rec.key, true, 0]);
            }
            expect(await drain(E, g)).toBe(0);
        }
        // A change that is not the user's own action (here a fill the document gains): the bake's 6 ms.
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#0a0", opacity: 1, polys: [[F(60, 490), F(120, 490), F(120, 530), F(60, 530)]] }, "0");
        E._render();
        expect(R.pyramid.lastPatch.budget).toBe(6);
        expect(await drain(E, g)).toBe(0);
    }, 60000);

    test("never older while a fresh source is cached: a seeded fuzz of draw, undo, redo, erase, zoom, pan and crossings with the gated pool", async () => {
        const g = gate(), t = { plans: 0, older: 0, other: 0, standIn: 0, otherMs: 0, wrong: [], why: { unread: 0, coming: 0, other: 0 } };
        const watch = (E, seed) => {
            const compose = E.renderer.pyramid.compose.bind(E.renderer.pyramid);
            E.renderer.pyramid.compose = () => {
                const P = compose();
                t.plans++;
                for (const c of P.cells) {
                    if (!c.draws.some((d) => d.cls === "older")) continue;
                    t.older++;
                    const od = c.draws.find((d) => d.cls === "older" && !d.wait);
                    if (od && od.own) t.other++;                     // a stale own plate with no worker patch pending
                    else if (od) {                                   // (f'): a stale coarser stand-in for a missing cell
                        t.standIn++;
                        const pyr = E.renderer.pyramid, v = P.v, own = { frame: v.frameId, Z: 2 ** (v.level * v.S), i: c.i, j: c.j };
                        own.key = v.frameId + "|L" + v.level + "s" + v.S + "|" + c.i + "," + c.j;
                        t.why[!pyr.covered(own) ? "unread" : pyr._asked.has(own.key) || E.plates.inflight.has(own.key) ? "coming" : "other"]++;
                    }
                    const src = freshSourceFor(E, P, c);
                    if (src && t.wrong.length < 5) t.wrong.push(`seed ${seed}: cell ${c.i},${c.j} drawn older while ${src} is exact`);
                }
                return P;
            };
        };
        for (const seed of [3, 11]) {
            const rnd = lcg(seed), E = mkEngine(800, 600, { raster: true });
            watch(E, seed);
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
            t.otherMs += E.renderer.pyramid.s.olderOtherMs;
            E.destroy();
        }
        expect(t.plans).toBeGreaterThan(40);
        expect(t.wrong).toEqual([]);
        // A stale own plate is drawn only while its worker patch is pending (A3 §3.4). A zoom from rest draws the kept rest
        // set (A3 §2.4), so a stale coarser stand-in (f') is left only where nothing fresh is cached at any level and the
        // cell's own plate is on its way: its view job asked or in flight, or its tiles not yet read (a crossing's step
        // reads the cache alone, the idle read waits for the quiet, A3 §4.2) — `olderOtherMs` charges those (the review's
        // design question); any other (f') is a defect.
        expect(t.other).toBe(0);
        expect(t.why.other).toBe(0);
        // eslint-disable-next-line no-console
        console.log("never-older fuzz: " + t.plans + " plans, " + t.older + " with an older cell, " + t.standIn + " of them a stale stand-in "
            + JSON.stringify(t.why) + "; olderOtherMs " + t.otherMs.toFixed(1));
        expect(t.older).toBeGreaterThan(0);                            // the fuzz reaches the last resort
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

/** Until the plane's idle aim has run — the render arms its timer, the timer fires — at most 3 s (a fixed wait raced it under load). */
async function planeQuiet(R) {
    for (let t = 0; t < 3000 && (R._planeTimer != null || !R._plane.tags.length); t += 10) await new Promise((r) => setTimeout(r, 10));
    await tick();
}
const fillAt = (E, x, y, color, s = 120) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s]]],
});
/** Two fills at rest, the first tap-selected and the plane aimed at the quiet view, its plates in. */
async function planeScene(E, g, ax = 100) {
    const a = E.doc.add(fillAt(E, ax, 200, "rgb(200,30,30)", ax < 0 ? 400 : 120), "0");
    E.doc.add(fillAt(E, 300, 200, "rgb(30,30,200)"), "0");
    E._render();
    await settle(E, 2);
    expect(await drain(E, g)).toBe(0);
    E.setTool("select");
    const p = E.cam.levelPointToScreen("0", ax < 0 ? 40 : 160, 260);
    E.pointerDown(p[0], p[1]); E.pointerUp();
    expect(E.selection && E.selection.ids).toEqual([a.id]);
    E._render();
    await planeQuiet(E.renderer);
    expect(await drain(E, g)).toBe(0);
    return { a, p };
}

describe("the drag plane on the pyramid (B-PYRAMID-2 P3, A3 §6)", () => {
    test("identity at rest (Zp the rest Z), pins under the phone's cap, the move drawn from its layers (H4, the image budget), the landing ended by exact", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const { p } = await planeScene(E, g);
        const pl = R._plane, v = R._view;
        expect(v.mode).toBe("rest");
        expect(pl.main.pZq).toBe(v.Z);
        expect(pl.main.keys.length).toBeGreaterThan(0);
        expect(pl.main.keys.every((k) => k.startsWith(v.frameId + "|P" + v.Z + "|"))).toBe(true);
        expect(E.plates.phone).toBe(true);                             // jsdom's screen reads as a phone's
        expect(R.planeCap).toBe(24);
        expect(E.plates.report().pinnedPlane).toBe(pl.keys.length);
        expect(pl.keys.length).toBeLessThanOrEqual(R.planeCap);
        const bad = [];
        const compose = R.pyramid.compose.bind(R.pyramid);
        R.pyramid.compose = () => {
            const s0 = R.pyramid.s.surface, P = compose(), pp = P.plane;
            if (P.images > 30 && R.pyramid.s.surface === s0) bad.push("images " + P.images + " drawn directly");
            const sel = pp.layers.filter((x) => x.L.kind === "sel" && x.recs.length);
            if (sel.length && R._plane.partial) {                      // H4: moved only over BELOW at the start footprint
                const below = pp.layers.find((x) => x.L.kind === "below"), have = new Set((below ? below.recs : []).map((r) => r.i + "," + r.j));
                for (const x of sel) for (const [i, j] of x.L.cells) if (!have.has(i + "," + j)) bad.push("SEL moved over its own start at " + i + "," + j);
            }
            return P;
        };
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 10; k++) E.pointerMove(p[0] + k * 8, p[1] + k * 5);
        expect(pl.state).toBe("drag");
        expect(R.pyramid.lastPlan.plane.layers.some((x) => x.L.kind === "sel" && x.recs.length)).toBe(true);
        const lands0 = planeStats.lands, lost0 = planeStats.lost;
        E.pointerUp();                                                 // the drop lands the plane; the drop's render patches inline
        expect([planeStats.lands - lands0, planeStats.lost - lost0]).toEqual([1, 0]);
        expect(await drain(E, g)).toBe(0);
        expect(pl.state).toBe("idle");                                 // ended: every cell it covered exact again
        expect(planeStats.landTimeouts).toBe(0);
        expect(bad).toEqual([]);
    });

    test("the landing per cell by exact: with the drop's patches at the workers the plane stays, drawn only where a cell is not exact, until they land", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const { p } = await planeScene(E, g);
        const pl = R._plane;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 10; k++) E.pointerMove(p[0] + k * 8, p[1] + k * 5);
        R.pyramid.cfg.patchInlineMs = 0;                               // the drop's re-render goes to the workers
        E.pointerUp();
        expect(pl.state).toBe("land");
        const v = R._view, c = pl.landCells(v);
        let stale = 0;
        for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (!R.pyramid.cellFresh(v, i, j)) stale++;
        expect(stale).toBeGreaterThan(0);                              // the plane waits on these cells (and is clipped to them)
        expect(await drain(E, g)).toBe(0);
        expect(pl.state).toBe("idle");
        delete R.pyramid.cfg.patchInlineMs;
    });

    test("the quick level at Zp / 4; a plane is whole only when exact; a dropped layer's queued strips and late plates go", async () => {
        const g = gate();
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        E.setPlateBudget({ views: 8, ceilingMiB: 512 });              // nothing evicted: a stored late plate would stay
        R._pyrPrefetch = () => {};                                     // the one worker holds only the plane's strips
        R.pyramid.cfg.restInlineMs = 1e9;                              // the still frame shows the rest set at once: a stable view
        E.zoomAt(400, 300, -380);                                      // rest at Z 2^0.38: no quantum ladder lands on Zp / 4
        const a = E.doc.add(fillAt(E, -300, -200, "rgb(200,30,30)", 1000), "0");   // most of the screen and past it: 18 plates, a quick level
        const b = E.doc.add(fillAt(E, 300, 200, "rgb(30,30,200)"), "0");
        E._render();
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        E.setTool("select");
        const pa = E.cam.levelPointToScreen("0", 100, 100);
        E.pointerDown(pa[0], pa[1]); E.pointerUp();
        expect(E.selection.ids).toEqual([a.id]);
        E._render();
        await planeQuiet(R);
        const pl = R._plane;
        expect([R._view.mode, pl.main.pZq]).toEqual(["rest", R._view.Z]);   // aimed at rest: Zp is the rest Z
        expect(pl.quick).not.toBeNull();
        expect(pl.quick.pZq).toBe(pl.main.pZq / 4);
        expect(pl.quick.keys.every((k) => k.includes("|P" + pl.main.pZq / 4 + "|"))).toBe(true);
        expect(await drain(E, g)).toBe(0);
        expect(pl.checkReady(E.plates)).toBe(true);
        // A change past the view (in no run) inside a D1 SEL plate stales it and changes no layer: re-cut, the plane is
        // not whole until that plate is exact again.
        const tags0 = pl.tags.join(",");
        E.doc.add(fillAt(E, -520, 100, "rgb(30,200,30)", 500), "0");   // left of the view's cells, over two SEL plates of each level
        E._render();
        await planeQuiet(R);
        expect(pl.tags.join(",")).toBe(tags0);
        expect(pl.checkReady(E.plates)).toBe(false);
        // Another selection while that plate's strip waits: the layers go, their queued strips by generation, a late one
        // discarded on arrival.
        const oldTags = pl.tags.slice();
        expect(g.parked.length).toBeGreaterThan(0);
        const pb = E.cam.levelPointToScreen("0", 360, 260);
        E.pointerDown(pb[0], pb[1]); E.pointerUp();
        expect(E.selection.ids).toEqual([b.id]);
        E._render();
        await planeQuiet(R);
        expect(await drain(E, g)).toBe(0);
        expect(R.queue.report().drops.gen).toBeGreaterThan(0);
        expect([...E.plates.records()].filter((r) => r.kind === "plane" && oldTags.includes(r.tag)).map((r) => r.key)).toEqual([]);
        expect(pl.checkReady(E.plates)).toBe(true);
    });

    test("a waiting plane asks for no cell the table does not cover; once covered its idle re-aim asks for them", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R._pyrPrefetch = () => {};
        await planeScene(E, g);
        const pl = R._plane;
        expect(pl.checkReady(E.plates)).toBe(true);
        const covers = E.stage.covers.bind(E.stage);
        let refuse = true;
        E.stage.covers = (f, r) => (refuse ? false : covers(f, r));
        const b = E.doc.add(fillAt(E, 500, 60, "rgb(30,160,30)"), "0");  // a new selection: new layers, none of them covered
        E.setTool("select");
        const pb = E.cam.levelPointToScreen("0", 540, 100);
        E.pointerDown(pb[0], pb[1]); E.pointerUp();
        expect(E.selection.ids).toEqual([b.id]);
        E._render();
        await planeQuiet(R);
        const planeStrips = () => [...R.queue.queue, ...R.queue.inFlight.values()].filter((st) => st.kind === "plane").length;
        expect([planeStrips(), rasterStats.refusedCoverPlates]).toEqual([0, 0]);
        expect(pl.checkReady(E.plates)).toBe(false);
        refuse = false;
        for (let t = 0; t < 3000 && !(planeStrips() + g.parked.length); t += 10) { await settle(E, 1); await new Promise((r) => setTimeout(r, 10)); }
        expect(planeStrips() + g.parked.length).toBeGreaterThan(0);
        expect(await drain(E, g)).toBe(0);
        expect(pl.checkReady(E.plates)).toBe(true);
    });

    test("the plane's pre-aim waits for the scene's quiet: a bake's commits do not re-aim it each step (PLAN §5.9 item 2)", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R._pyrPrefetch = () => {};
        const { a } = await planeScene(E, g);
        let aims = 0;
        const aim = R._aimPlane.bind(R);
        R._aimPlane = (v) => { aims++; return aim(v); };
        for (let k = 0; k < 12; k++) {                                   // a commit every 40 ms, as a bake's cut steps
            E.stage.touch(a.id);
            await settle(E, 1);
            await new Promise((r) => setTimeout(r, 40));
        }
        expect(aims).toBe(0);                                           // red before: a re-aim a quiet view
        for (let t = 0; t < 3000 && !aims; t += 10) { await settle(E, 1); await new Promise((r) => setTimeout(r, 10)); }
        expect(aims).toBeGreaterThan(0);                                // once the scene is quiet
        expect(await drain(E, g)).toBe(0);
    });

    test("D1: a selection past the screen's edge is in its SEL layer to one view beyond; BELOW stays on the view", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        await planeScene(E, g, -300);                                  // 400 wide from x −300: most of it left of the screen
        const pl = R._plane, v = R._view, f = pl.main.pZq / v.Zq;
        const sel = pl.main.layers.find((L) => L.kind === "sel"), below = pl.main.layers.find((L) => L.kind === "below");
        expect(sel.cells.some(([i]) => i < Math.floor(v.i0 * f))).toBe(true);
        expect(below.cells.every(([i, j]) => i >= Math.floor(v.i0 * f) && i <= Math.floor((v.i1 + 1) * f - 1e-9) && j >= Math.floor(v.j0 * f))).toBe(true);
    });
});

describe("the queue adopted (B-PYRAMID-2 P4)", () => {
    test("a worker's failure puts its strip back at the head of its priority; it lands on the new pool, every job id ended (H7)", async () => {
        const made = [];                                                         // the raster workers (the scene's and the cuts' apart)
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; if (String(url).includes("raster-worker")) made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        const answer = async (w, k) => { w.onmessage({ data: (await runJob(w.posted[k])).msg }); await settle(E, 1); };
        let E = null;
        try {
            setRasterWorkerCount(1);
            E = mkEngine(800, 600, { raster: true });
            const R = E.renderer;
            stroke(E);
            await settle(E, 2);
            expect(made.length).toBe(1);
            await answer(made[0], 0);                                            // it answers: the script loads
            expect(made[0].posted.length).toBe(2);
            const lost = made[0].posted[1];
            const st = [...R.queue.inFlight.values()][0];
            made[0].onerror({ preventDefault() {} });                          // a worker's error with a strip in flight
            expect([made[0].dead, made.length]).toEqual([true, 2]);             // the pool replaced (RW-1)
            expect([R.queue.inFlight.size, R.queue.queue[0] === st, st.seq < 0]).toEqual([0, true, true]);
            await tick();
            expect(made[1].posted.length).toBe(1);                              // re-packed onto the new pool first, its prio kept
            expect([Array.from(made[1].posted[0].plates), made[1].posted[0].jobId > lost.jobId]).toEqual([Array.from(lost.plates), true]);
            for (let k = 0; k < 100; k++) {
                const w = made[made.length - 1], n = w.answered || 0;
                const r = R.queue.report();
                if (n >= w.posted.length && !r.queued.some((x) => x) && !r.inFlight.some((x) => x)) break;
                if (n < w.posted.length) { w.answered = n + 1; await answer(w, n); } else await settle(E, 1);
            }
            expect(planCls(R).every((c) => c === "sharp")).toBe(true);
            const q = R.queue.report();
            expect(q.done).toBe(q.dispatched - 1);                              // the lost dispatch never lands
            expect(rasterStats.jobsEnded).toBe(q.dispatched);                   // but its job id was ended
            expect(E.plates.report().inFlight).toBe(0);
        } finally {
            delete global.Worker;
        }
    });

    test("pen-up over a cell whose tiles are not in the table: the other cells re-rendered and held, that one asked for inside the group once covered, the path up until then", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = 1e9;                              // the group's re-render inline
        const v = R._view, cellAt = (sx, sy) => [Math.floor(((sx - v.tx) / v.k) * v.Zq / 512), Math.floor(((sy - v.ty) / v.k) * v.Zq / 512)];
        const [ci, cj] = cellAt(150, 300), [di, dj] = cellAt(650, 300);
        expect(di).not.toBe(ci);                                        // the stroke crosses two cells
        const u = 512 / v.Zq, covers = E.stage.covers.bind(E.stage);
        let refuse = true;
        E.stage.covers = (f, r) => !(refuse && Math.abs(r.left - ci * u) < 1e-9 && Math.abs(r.top - cj * u) < 1e-9) && covers(f, r);
        const recAt = (i, j) => [...E.plates.records()].find((r) => r.frame === String(v.frameId) && r.Z === v.Zq && r.i === i && r.j === j);
        const T = drawStroke(E, [[100, 300], [700, 300]], 12);
        await settle(E, 2);
        const G1 = E.stage.landedAt(T.id), grp = [...R.pyramid._groups.values()][0];
        expect(G1).toBeGreaterThan(0);
        expect(rasterStats.refusedCoverPlates).toBeGreaterThan(0);
        expect([R._liveHeld.length, !!grp]).toEqual([1, true]);        // the path stays while its group waits
        expect(grp.held.some((r) => r.i === di && r.j === dj)).toBe(true);
        expect(grp.held.some((r) => r.i === ci && r.j === cj)).toBe(false);   // nothing from a table lacking its tiles
        expect(recAt(ci, cj).G).toBeLessThan(G1);
        refuse = false;
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(R._liveHeld.length).toBe(0);                             // committed in one task with the path's release
        for (const rec of [recAt(ci, cj), recAt(di, dj)]) {
            expect([rec.key, rec.G >= G1, E.plates.exact(rec)]).toEqual([rec.key, true, true]);
            expect([rec.key, diffBytes(rec.pixels, wholeRender(E, rec))]).toEqual([rec.key, 0]);
        }
        expect(R.pyramid.s.groupsTimedOut).toBe(0);
    });

    test("pen-up with none of its cells' tiles in the table: nothing is rendered from it, the path stays until they are covered", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = 1e9;
        const covers = E.stage.covers.bind(E.stage);
        let refuse = true;
        E.stage.covers = (f, r) => (refuse ? false : covers(f, r));
        const T = drawStroke(E, [[300, 200], [360, 240]], 12);
        await settle(E, 2);
        const G1 = E.stage.landedAt(T.id), v = R._view;
        expect(G1).toBeGreaterThan(0);
        const fresh = [...E.plates.records()].filter((r) => r.frame === String(v.frameId) && r.Z === v.Zq && r.G >= G1);
        expect(fresh.map((r) => r.key)).toEqual([]);                    // red before: an empty pack rendered as paper, exact
        expect(R._liveHeld.length).toBe(1);
        refuse = false;
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(R._liveHeld.length).toBe(0);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
    });

    test("a strip the worker fails is ended and asked again, and is no sample of the arrival estimate", async () => {
        setRasterTransport(() => Promise.reject(new Error("raster failed")));
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        R.queue.jobMs = 1000;
        stroke(E);
        await settle(E, 3);
        const q = R.queue.report();
        expect(rasterStats.dropsHandled).toBeGreaterThan(0);
        expect([q.done, q.inFlight.reduce((a, b) => a + b, 0), q.jobMs]).toEqual([q.dispatched, 0, 1000]);
        expect(E.plates.report().inFlight).toBe(0);
    });
});

describe("ported from raster.picture (B-PYRAMID-2b P6)", () => {
    test("F106, the monotone-G rule: a result newer than the stale plate cached replaces it and is drawn; an older one is closed", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const A = stroke(E);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        const rec = R.pyramid.lastPlan.cells.flatMap((c) => c.draws).map((d) => d.rec).find((r) => r && r.bytes && E.plates.exact(r));
        expect(rec).toBeTruthy();
        const G0 = rec.G;
        E.stage.touch(A.id);                                         // a bake step lands under it …
        const G1 = E.stage.generation;
        E.stage.touch(A.id);                                         // … and another before the re-render arrives
        expect(E.plates.exact(rec)).toBe(false);
        const cell = { key: rec.key, frame: rec.frame, kind: rec.kind, level: rec.level, S: rec.S, Z: rec.Z, tag: rec.tag, i: rec.i, j: rec.j };
        const px = () => new Uint8ClampedArray(512 * 512 * 4).fill(200);
        expect(R.pyramid.onResult({ ...cell, G: G1, pixels: px(), bytes: 512 * 512 * 4, jobId: null })).toBe("newer");
        const now = E.plates.get(rec.key);
        expect([now.G, rec.dead, E.plates.exact(now)]).toEqual([G1, true, false]);   // the older stale pixels are gone; still behind
        expect(R.pyramid.onResult({ ...cell, G: G0, pixels: px(), bytes: 512 * 512 * 4, jobId: null })).toBe("stale");
        expect(E.plates.get(rec.key)).toBe(now);                     // an older arrival never lowers a record's G
        R.pyramid.compose();
        const drawn = R.pyramid.lastPlan.cells.flatMap((c) => c.draws).map((d) => d.rec);
        expect(drawn).not.toContain(rec);
    });

    test("F101: a destroyed engine puts nothing back — late answers land nothing and later steps leave the host empty", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, host = R.host;
        stroke(E);
        await settle(E, 2);
        expect(g.parked.length).toBeGreaterThan(0);
        const puts = E.plates.s.puts;
        E.destroy();
        await g.run();                                               // the parked jobs answer after the teardown
        E.zoomAt(400, 300, -300); E.panBy(10, 10); E.resize(700, 500); E._render();
        R.syncCameraOnly();
        await settle(E, 1);
        expect(E.plates.s.puts).toBe(puts);
        expect(host.querySelectorAll("canvas").length).toBe(0);
    });
});

describe("found by the P6 ports (B-PYRAMID-2b)", () => {
    test("the rest after the quiet goes out with nothing else pumping, in a row of its own (A3 §4.6: kind settle)", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, P = R.pyramid, c = P.cfg;
        c.restInline = "never"; c.restQuietMs = 1e9; c.prefetchQuietMs = 1e9;
        stroke(E);
        E._render();
        for (let k = 0; k < 10; k++) await g.run();                 // the level's plates, landed
        const armed = [];
        P._onMove();                                                // no quiet running
        P._setTimer = (fn) => { armed.push(fn); return armed.length; };
        R.syncCameraOnly();                                         // the still frame: the rest set waits for the quiet
        expect(armed.length).toBe(1);
        expect(g.parked.length).toBe(0);
        const kinds = [], open = R._openRow.bind(R);
        R._openRow = (seq, kind, back) => { kinds.push(kind); return open(seq, kind, back); };
        armed[0]();                                                 // the quiet runs out: no step, no arrival
        await tick();
        expect(g.parked.length).toBeGreaterThan(0);                 // red before: queued, and nothing pumped it
        expect(kinds.length > 0 && kinds.every((k) => k === "settle")).toBe(true);   // each strip packed and posted in a row of its own
        for (let k = 0; k < 10; k++) await g.run();
        expect(R._view.mode).toBe("rest");                          // the group in: the rest set shown
    });
});

describe("the pyramid's open items (B-PYRAMID-2b P6 item 3)", () => {
    test("the attention point: the wheel focus and the pointer reach the plan and the queue; a view job's first strip starts nearest it", async () => {
        gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, d = R.pyramid.dpr;
        R.pyramid.cfg.restInline = "never";
        E._render();
        const pushed = [], push = R.queue.push.bind(R.queue);
        R.queue.push = (jobs) => { pushed.push(...jobs); return push(jobs); };
        E.zoomAt(700, 500, -1200);                                  // a zoom in about (700, 500): the next level, its cells asked
        expect(R.pyramid._attn).toEqual([700 * d, 500 * d]);       // red before: null, the screen centre
        expect(R.queue.motion.attention).toEqual([700 * d, 500 * d]);
        const job = pushed.find((j) => j.kind === "view");
        expect(job).toBeTruthy();
        const a = job.attention, v = R._view, dist = (c) => Math.hypot((c.i + 0.5) * 512 - a[0], (c.j + 0.5) * 512 - a[1]);
        expect(a[0]).toBeCloseTo(((700 * d - v.tx) / v.k) * job.Z, 6);   // (700, 500) in the job's grid, not the centre
        expect(a[1]).toBeCloseTo(((500 * d - v.ty) / v.k) * job.Z, 6);
        const first = R.queue.strips(job)[0].cells[0];               // the queue's own dealing of this job
        expect(dist(first)).toBe(Math.min(...job.cells.map(dist)));
        expect(dist(first)).toBeLessThan(Math.max(...job.cells.map(dist)));   // not every cell equidistant
        E.pointerMove(120, 80);
        expect(R.pyramid._attn).toEqual([120 * d, 80 * d]);         // the last pointer
    });

    test("a report sending: the prefetch plans nothing and keeps its key; once it is sent, the plan runs", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, c = R.pyramid.cfg;
        c.restInline = "never"; c.restQuietMs = 1e9; c.prefetchQuietMs = 1e9;
        stroke(E);
        E._render();
        expect(await drain(E, g)).toBe(0);                          // the view's work done: the prefetch may run
        c.prefetchQuietMs = 0;
        const pushed = [], push = R.queue.push.bind(R.queue);
        R.queue.push = (jobs) => { pushed.push(...jobs); return push(jobs); };
        E._reportBusy = true;
        R._pyrPrefetch(R._view);
        expect(pushed.length).toBe(0);                              // red before: the plan ran through the report
        expect(R._pyrPrefetchKey).toBe(null);
        E._reportBusy = false;
        R._pyrPrefetch(R._view);
        expect(pushed.length).toBeGreaterThan(0);
        expect(pushed.every((j) => j.prio === 4)).toBe(true);        // PRIO.prefetch
    });

    test("the motion's `at` is its step's clock: a pan's velocity and a strip's arrival are aimed from the view's own time", async () => {
        const g = gate();
        const E = mkEngine(1024, 512, { raster: true }), R = E.renderer, c = R.pyramid.cfg;
        c.restInline = "never"; c.restQuietMs = 1e9; c.prefetchQuietMs = 1e9;
        E._render();
        expect(await drain(E, g)).toBe(0);
        E.panBy(-40, 0);
        await new Promise((r) => setTimeout(r, 5));
        const t1 = performance.now();
        E.panBy(-40, 0);
        const m = R.queue.motion, t2 = performance.now();
        expect(m.moving).toBe(true);
        expect(m.at).toBeGreaterThanOrEqual(t1);                    // red with no `at`: the queue aims from the dispatch alone
        expect(m.at).toBeLessThanOrEqual(t2);
        expect(m.vel.px[0]).toBeLessThan(0);                          // 40 px over the steps' own interval, leftwards
        expect(m.view.tx).toBe(R._view.tx);
    });

    test("D1 on a 2560×1440@2 screen: a selection a view past the screen, into the next square, has its SEL cells covered, asked and exact", async () => {
        const dpr0 = window.devicePixelRatio;
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
        try {
            const E = mkEngine(2560, 1440, { raster: true }), R = E.renderer, pl = R._plane, edge = W / 2;
            expect(R.pyramid.dpr).toBe(2);
            R.pyramid.cfg.prefetchQuietMs = 1e9;                     // the prefetch's own snapshot reads would read square 1
            // The screen's right edge short of square 1 (x ≥ W/2) by more than the table's four view cells and less than a view.
            const m4 = R.listMargin(1), view = 2560;
            expect(m4).toBeLessThan(view);                             // the case: four view cells fall short of a view here
            const gap = (m4 + view) / 2, reach = edge + (view - gap) / 2;
            E.cam.set({ frame: "0", inScale: 1, inPanX: -(edge - gap - view), inPanY: 0 });
            const id = E.doc.allocId();
            E.doc.add({ type: "fill", origin: "native", id, color: "rgb(200,30,30)", opacity: 1,
                polys: [[[edge - gap - 2000, 300], [reach, 300], [reach, 700], [edge - gap - 2000, 700]]] }, "0");
            E._render();
            E.setTool("select");
            E._setSelection([id], []);
            E._render();
            const far = { left: edge + 10, top: 300, right: reach, bottom: 700 };           // in square 1, inside a view past the screen
            for (let t0 = Date.now(); Date.now() - t0 < 10000; ) {
                await new Promise((r) => setTimeout(r, 20));
                if (pl.layers.length && E.stage.covers("0", far) && pl._whole(pl.main, E.plates, true)) break;
            }
            expect(E.stage.covers("0", far)).toBe(true);                                       // red before: never read, never asked
            const sel = pl.main.layers.filter((L) => L.kind === "sel"), u = cellUnits(pl.main);
            expect(sel.some((L) => L.cells.some(([i]) => (i + 1) * u > edge + 10))).toBe(true);   // SEL cells reaching into square 1
            expect(pl._whole(pl.main, E.plates, true)).toBe(true);
        } finally {
            Object.defineProperty(window, "devicePixelRatio", { value: dpr0, configurable: true });
        }
    }, 20000);
});
/** A plane level's cell width in frame units. */
function cellUnits(lvl) { return 512 / lvl.pZq; }
