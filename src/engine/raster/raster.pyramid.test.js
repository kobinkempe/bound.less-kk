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
import { planeStats } from "./MovePlane";

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
        expect([on.renderer.supportsDragPlane, on.renderer._plane.pyramid]).toEqual([true, true]);   // the plane on A3 §6's keys (P3)
        const off = mkEngine(800, 600, { raster: true });
        expect(off.renderer.pyramid).toBeNull();
        expect(off.renderer.layer).toBeInstanceOf(PictureLayer);
        expect(off.plates).toBeInstanceOf(PlateStore);
        expect([off.renderer.supportsDragPlane, off.renderer._plane.pyramid]).toEqual([true, false]);
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

    test("undo and redo reach the pyramid as Stage dirt: the frame's patch step re-renders the rectangle inline, equal to a whole render", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        drawStroke(E, [[140, 140], [520, 420]], 18);
        drawStroke(E, [[160, 420], [560, 160]], 18);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        R.pyramid.cfg.patchInlineMs = 1e9;                              // inline whatever the calibrated estimate says
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
        delete R.pyramid.cfg.patchInlineMs;
    });

    test("never older while a fresh source is cached: a seeded fuzz of draw, undo, redo, erase, zoom, pan and crossings with the gated pool", async () => {
        const g = gate(), t = { plans: 0, older: 0, wrong: [] };
        const watch = (E, seed) => {
            const compose = E.renderer.pyramid.compose.bind(E.renderer.pyramid);
            E.renderer.pyramid.compose = () => {
                const P = compose();
                t.plans++;
                for (const c of P.cells) {
                    if (!c.draws.some((d) => d.cls === "older")) continue;
                    t.older++;
                    const src = freshSourceFor(E, P, c);
                    if (src && t.wrong.length < 5) t.wrong.push(`seed ${seed}: cell ${c.i},${c.j} drawn older while ${src} is exact`);
                }
                return P;
            };
        };
        for (const seed of [3, 11]) {
            const rnd = lcg(seed), E = mkEngine(800, 600, { raster: true, pyramid: true });
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
            E.destroy();
        }
        expect(t.plans).toBeGreaterThan(40);
        expect(t.wrong).toEqual([]);
        expect(t.older).toBeLessThan(t.plans);                         // the fuzz reaches the last resort, rarely
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

const quiet = () => new Promise((r) => setTimeout(r, 200));
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
    await quiet();
    expect(await drain(E, g)).toBe(0);
    return { a, p };
}

describe("the drag plane on the pyramid (B-PYRAMID-2 P3, A3 §6)", () => {
    test("identity at rest (Zp the rest Z), pins under the phone's cap, the move drawn from its layers (H4, the image budget), the landing ended by exact", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        const { p } = await planeScene(E, g);
        const pl = R._plane, v = R._view;
        expect(v.mode).toBe("rest");
        expect([pl.pyramid, pl.main.pZq]).toEqual([true, v.Z]);
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
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
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
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        E.setPlateBudget({ views: 8, ceilingMiB: 512 });              // nothing evicted: a stored late plate would stay
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
        await quiet();
        const pl = R._plane;
        expect(pl.quick).not.toBeNull();
        expect(pl.quick.pZq).toBe(pl.main.pZq / 4);
        expect(pl.quick.keys.every((k) => k.includes("|P" + pl.main.pZq / 4 + "|"))).toBe(true);
        // Another selection while the first plane's strips wait: its layers go, their strips dropped by generation.
        const oldTags = pl.tags.slice();
        expect(R.queue.report().queued[2] + g.parked.length).toBeGreaterThan(1);
        const pb = E.cam.levelPointToScreen("0", 360, 260);
        E.pointerDown(pb[0], pb[1]); E.pointerUp();
        expect(E.selection.ids).toEqual([b.id]);
        E._render();
        await quiet();
        expect(await drain(E, g)).toBe(0);
        expect(R.queue.report().drops.gen).toBeGreaterThan(0);
        expect([...E.plates.records()].filter((r) => r.kind === "plane" && oldTags.includes(r.tag)).map((r) => r.key)).toEqual([]);
        expect(pl.checkReady(E.plates)).toBe(true);
        // A change off screen inside a BELOW plate stales it without changing a run: re-cut, the plane is not whole
        // until that plate is exact again.
        E.doc.add(fillAt(E, 720, 100, "rgb(30,200,30)", 40), "0");
        E._render();
        await quiet();
        expect(pl.checkReady(E.plates)).toBe(false);
        expect(await drain(E, g)).toBe(0);
        expect(pl.checkReady(E.plates)).toBe(true);
    });

    test("D1: a selection past the screen's edge is in its SEL layer to one view beyond; BELOW stays on the view", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true, pyramid: true }), R = E.renderer;
        await planeScene(E, g, -300);                                  // 400 wide from x −300: most of it left of the screen
        const pl = R._plane, v = R._view, f = pl.main.pZq / v.Zq;
        const sel = pl.main.layers.find((L) => L.kind === "sel"), below = pl.main.layers.find((L) => L.kind === "below");
        expect(sel.cells.some(([i]) => i < Math.floor(v.i0 * f))).toBe(true);
        expect(below.cells.every(([i, j]) => i >= Math.floor(v.i0 * f) && i <= Math.floor((v.i1 + 1) * f - 1e-9) && j >= Math.floor(v.j0 * f))).toBe(true);
    });
});
