/**
 * raster.snapshot.test.js — PAPER-PLAN §8's P3 row: the off-camera render list (`listFor`) and
 * `snapshotView` (SCENES-PLAN S1), budgeted through the pyramid (B-PYRAMID-2b): the table is read
 * at idle a budget at a time (D5), and the one plate goes through the `JobQueue` at `PRIO.thumb`.
 * The crossing prebake (R4) and the zoom-out ladder (R5b) went with the old picture path (A3 §4.6).
 *
 * Nothing here measures a picture: jsdom's `getContext` is null in this tree, so every claim is
 * about a list, a call, a cached key or a computed number. What a thumbnail LOOKS like is
 * stage 7's, in Kobin's Chrome.
 */

import KobinEngine from "../KobinEngine";
import { fitView } from "../sceneOps";
import { residual } from "../geometry/offsets";
import { TILE } from "../frameLattice";
import { rasterStats, resetRasterStats } from "./RasterRenderer";
import { PLATE_PX } from "./plate";
import {
    setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient, rasterWorkerReport,
} from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import { drawStroke, descend } from "../__testkit__/harness";

const engines = [];
function mkEngine(w = 800, h = 600) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    const c = E.renderer.pyramid.cfg;                        // the camera's level plates only: no rest, no prefetch
    c.restInline = "never"; c.restQuietMs = 1e9; c.prefetchQuietMs = 1e9;
    engines.push({ E, host });
    return E;
}

/** Let the inline jobs arrive, as `raster.engine.test.js`'s own `flush` does. */
async function flush(rounds = 16) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return k + 1;
    }
    return rounds;
}
const paint = async (E) => { E._render(); return flush(); };
/** Past the snapshot's idle read (`requestIdleCallback`, a 30 ms timeout in jsdom) and its dispatch. */
async function until(done, n = 40) { for (let k = 0; k < n && !done(); k++) await new Promise((r) => setTimeout(r, 10)); return done(); }

/** Every job message the client sends, copied before the worker reads it. */
function mkTap() {
    const jobs = [];
    setRasterTransport((msg) => {
        jobs.push({
            q: msg.q, Zq: msg.Zq, nItems: msg.nItems,
            plates: Array.from(msg.plates || []),
            attr: msg.attr ? Float64Array.from(msg.attr) : null,
        });
        return runJob(msg).then((out) => out.msg);
    });
    return jobs;
}

/** The pool replaced by a gate: a dispatch parks until the test releases it. */
function mkGate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        get length() { return parked.length; },
        async release() {
            const p = parked.shift();
            if (!p) return false;
            const out = await runJob(p.msg);
            p.resolve(out.msg);
            for (let k = 0; k < 4; k++) await Promise.resolve();
            return true;
        },
    };
}

beforeEach(() => {
    resetRasterWorkerClient();
    setRasterWorkerCount(1);
    resetRasterStats();
});
afterEach(() => {
    while (engines.length) {
        const e = engines.pop();
        try { e.E.destroy(); } catch (err) { /* torn down */ }
        e.host.remove();
    }
    setRasterTransport(null);
    resetRasterWorkerClient();
});

const ATTR_DOUBLES = 9;                                     // `rasterJob.js`'s stride, read for attr[4]/attr[5]

// ---------------------------------------------------------------------------
// `listFor` — the same list as `_buildList`, and none of the camera's side effects
// ---------------------------------------------------------------------------

test("S2 listFor equals _buildList for the camera's own frame and window", () => {
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    drawStroke(E, [[200, 420], [560, 460]], 9);
    E._render();

    const a = E._buildList();
    const b = E.listFor(E.cam.frame, E.cam.frameWindow(0));
    expect(b.length).toBe(a.length);
    expect(b.length).toBeGreaterThan(0);
    expect(b.map((o) => o.id)).toEqual(a.map((o) => o.id));
    expect(b.map((o) => (o.z != null ? o.z : null))).toEqual(a.map((o) => (o.z != null ? o.z : null)));
    expect(b.map((o) => (o.editId != null ? o.editId : null))).toEqual(a.map((o) => (o.editId != null ? o.editId : null)));
    expect(b.map((o) => JSON.stringify(o.res || null))).toEqual(a.map((o) => JSON.stringify(o.res || null)));
});

test("S1 a snapshot leaves the camera, the tile frame and the tile pins exactly as they were", async () => {
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);

    const cam0 = JSON.stringify(E.cam.state());
    const pins0 = [...E.store._pins].sort();
    const frame0 = E._tileFrame;
    const tiles0 = E.store.size();
    const lastList0 = E.renderer._lastList;

    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 40, y: 40, w: 400, h: 300 } });
    // Synchronously after the call — the list build and the post are both done by now.
    expect(JSON.stringify(E.cam.state())).toBe(cam0);
    expect([...E.store._pins].sort()).toEqual(pins0);
    expect(E._tileFrame).toBe(frame0);
    expect(E.store.size()).toBeGreaterThanOrEqual(tiles0);  // nothing was evicted out from under the view
    expect(E.renderer._lastList).toBe(lastList0);           // the camera's own list is untouched

    const reads = jest.spyOn(E.stage, "snapshot");
    await until(() => reads.mock.calls.length > 0);
    await flush();
    await p;
    expect(JSON.stringify(E.cam.state())).toBe(cam0);
    expect([...E.store._pins].sort()).toEqual(pins0);
    // Read at idle, a budget at a time (D5: never unbudgeted).
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    for (const c of reads.mock.calls) expect(c[2] > 0 && Number.isFinite(c[2])).toBe(true);
});

test("S1 BREAK-CHECK: with `content` in the snapshot's read, the visible pin set is replaced", async () => {
    // `content` adds each key it reads to `_pins` and then REPLACES the field with its own
    // range. Off camera that unpins the whole visible screen, and an off-camera read's `_evict` can
    // then take the tiles the user is looking at.
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);
    const pins0 = [...E.store._pins].sort();
    const read = E.store.read.bind(E.store);
    E.store.read = (F, rect, budget) => { E.store.content(F, rect); return read(F, rect, budget); };
    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 1e5, y: 1e5, w: 400, h: 300 } });
    expect(await until(() => [...E.store._pins].sort().join() !== pins0.join())).toBe(true);   // at the idle read
    await flush();
    await p.catch(() => null);
});

test("S3 the residual depth is the TARGET frame's, never the camera's", () => {
    const E = mkEngine();
    drawStroke(E, [[200, 200], [260, 220], [320, 200]], 10);
    const id = E.doc.at("0").slice(-1)[0].id;
    // A drag gives the object a displacement table, which is what `res` is computed from (F41).
    E.setTool("select");
    E.pointerDown(260, 214); E.pointerUp();
    E.pointerDown(260, 214);
    for (let i = 1; i <= 8; i++) E.pointerMove(260 + 8 * i, 214 + 4 * i);
    E.pointerUp();
    const rec = E.doc.getById(id);
    expect(rec.obj.below).toBeTruthy();

    const win = E.cam.frameWindow(0);
    descend(E, 1, 260, 214);                                // the camera is now a level below "0"
    expect(E.cam.activeLevel).toBe(1);

    const home = E.lm.depthOf(rec.level);
    const wantTarget = (residual(rec.obj.below, 0 - home) || {}).rem;   // frame "0"'s own depth
    const wantCamera = (residual(rec.obj.below, E.cam.activeLevel - home) || {}).rem;
    // The test is not vacuous only if the two differ.
    expect(JSON.stringify(wantTarget)).not.toEqual(JSON.stringify(wantCamera));

    const o = E.listFor("0", win).find((x) => x.id === id);
    expect(o).toBeTruthy();
    expect(JSON.stringify(o.res || null)).toBe(JSON.stringify(wantTarget || null));
});

test("S9 an off-camera read leaves the camera's own tiles cached, at the tile cap and below it", () => {
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    E._render();
    const camKeys = [...E.store._pins];
    expect(camKeys.length).toBeGreaterThan(0);
    for (const k of camKeys) expect(E.store.cache.has(k)).toBe(true);

    // The Scenes panel's own pass, and a long approach to a crossing: one off-camera read after
    // another, each baking tiles the camera is not looking at. `content` REPLACES `_pins` with
    // its own range and evicts while those are the only pins, so without a guard the LRU takes
    // the screen the user is on — GLOBAL_CAP globally, PER_LEVEL_CAP (64) within one frame,
    // which is the sharp edge because a drawing's scenes are usually in the frame it is at.
    const F = E.cam.frame;
    for (let n = 0; n < 24; n++) {
        const x = n * 4 * TILE;
        E.store.contentOffCamera(F, { left: x, top: x, right: x + 3 * TILE, bottom: x + 3 * TILE });
    }
    expect(E.store.cache.size).toBeGreaterThanOrEqual(64);   // the per-frame cap has had to run
    expect(camKeys.filter((k) => !E.store.cache.has(k))).toEqual([]);
});

// ---------------------------------------------------------------------------
// `snapshotView` — one job, one plate, the rect on it, and `PlateStore` untouched
// ---------------------------------------------------------------------------

test("S5 one job of ONE plate, with the rect moved onto it by the pack-time offset", async () => {
    const jobs = mkTap();
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);
    jobs.length = 0;

    const rect = { x: 60, y: 60, w: 400, h: 300 };
    const w = 320, h = 240;
    const p = E.snapshotView({ frame: E.cam.frame, rect, w, h });
    await flush();
    const bm = await p;

    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.plates).toEqual([0, 0]);                     // ONE plate, at the grid origin
    expect(job.nItems).toBeGreaterThan(0);

    // The offset is `fitView`'s own pan divided by its scale, so the rect lands where `jumpTo`
    // would put it on a `w × h` screen — the letterbox margin inside plate (0, 0).
    const fit = fitView(rect, w, h);
    expect(job.Zq).toBeCloseTo(fit.inScale, 12);
    const off = [fit.inPanX / fit.inScale, fit.inPanY / fit.inScale];
    for (let k = 0; k < job.nItems; k++) {
        expect(job.attr[k * ATTR_DOUBLES + 4]).toBeCloseTo(off[0], 9);
        expect(job.attr[k * ATTR_DOUBLES + 5]).toBeCloseTo(off[1], 9);
    }
    // ...and that puts the whole rect inside the one plate, which is the point of moving the
    // world instead of the grid: a grid crop would be 1–4 plates (C §3.3).
    const px = (fx) => (fx + off[0]) * fit.inScale;
    const py = (fy) => (fy + off[1]) * fit.inScale;
    expect(px(rect.x)).toBeGreaterThanOrEqual(0);
    expect(py(rect.y)).toBeGreaterThanOrEqual(0);
    expect(px(rect.x + rect.w)).toBeLessThanOrEqual(PLATE_PX);
    expect(py(rect.y + rect.h)).toBeLessThanOrEqual(PLATE_PX);
    expect(px(rect.x + rect.w)).toBeCloseTo(w, 9);          // the fitting axis fills `w` exactly

    // jsdom has no `createImageBitmap`, so the raw plate comes back (the brief's own shape).
    expect(bm).toBeTruthy();
    expect(bm.width).toBe(PLATE_PX);
    expect(bm.pixels.length).toBe(PLATE_PX * PLATE_PX * 4);
});

test("S8 a snapshot never enters PlateStore: no put, no cache entry, no job id", async () => {
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);
    const size0 = E.plates.cache.size;
    const puts0 = E.plates.s.puts;

    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 60, y: 60, w: 400, h: 300 } });
    await flush();
    await p;

    // Its `q` is a per-call string that carries no zoom; cached, it would come back as a hit at
    // a zoom it was never rastered at (§6.5's rule for `"s"`).
    expect(E.plates.cache.size).toBe(size0);
    expect(E.plates.s.puts).toBe(puts0);
    expect(E.plates.jobs.size).toBe(0);
    expect(E.plates.inflight.size).toBe(0);
    expect(rasterStats.snapshotPlates).toBe(1);
});

test("S7 an aborted snapshot rejects, begins no store job and caches nothing", async () => {
    const gate = mkGate();
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    E._render();
    while (await gate.release()) { /* the camera's own plates first */ }

    const size0 = E.plates.cache.size;
    const ac = new AbortController();
    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 60, y: 60, w: 400, h: 300 }, signal: ac.signal });
    expect(await until(() => gate.length === 1)).toBe(true);   // read at idle, dispatched, parked in the transport
    ac.abort();
    await gate.release();                                   // it still completes; the result is dropped

    await expect(p).rejects.toThrow("aborted");
    expect(rasterStats.snapshotAborts).toBe(1);
    expect(E.plates.jobs.size).toBe(0);                     // `beginJob` was never called
    expect(E.plates.inflight.size).toBe(0);
    expect(E.plates.cache.size).toBe(size0);
});

test("S7b a snapshot aborted while its strip waits in the queue leaves the queue at once, not at its dispatch", async () => {
    const gate = mkGate();
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    E._render();
    expect(gate.length).toBe(1);                            // the one worker holds a camera plate
    const thumbs = () => E.renderer.queue.report().queued[5];
    const ac = new AbortController();
    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 60, y: 60, w: 400, h: 300 }, signal: ac.signal });
    expect(await until(() => thumbs() === 1)).toBe(true);   // read at idle, queued behind the busy worker
    const rejected = expect(p).rejects.toThrow("aborted");
    ac.abort();
    expect(thumbs()).toBe(0);
    await rejected;
    while (await gate.release()) { /* the camera's plates */ }
    expect(rasterStats.snapshotPlates).toBe(0);
    expect(E.plates.jobs.size).toBe(0);
});

test("S11 a snapshot that lands frees its queue slot: the next one dispatches (the low-priority cap is one on one worker)", async () => {
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);
    for (let n = 0; n < 2; n++) {
        const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 40 + 20 * n, y: 40, w: 400, h: 300 } });
        let done = false;
        p.then(() => { done = true; }, () => { done = true; });
        expect([n, await until(() => done, 100)]).toEqual([n, true]);
        expect(E.renderer.queue.report().inFlight).toEqual([0, 0, 0, 0, 0, 0]);
    }
    expect(rasterStats.snapshotPlates).toBe(2);
});

test("S10 off the raster path snapshotView answers null, so the caller falls back", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600 });        // no `raster`: the SVG path
    engines.push({ E, host });
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await expect(E.snapshotView({ frame: E.cam.frame, rect: { x: 40, y: 40, w: 400, h: 300 } }))
        .resolves.toBe(null);
});

test("S6 fitView is jumpTo's own arithmetic, for every rect that does not cross", () => {
    const E = mkEngine(800, 600);
    const cases = [
        { x: 0, y: 0, w: 800, h: 600 }, { x: -300, y: 120, w: 40, h: 40 },
        { x: 17.5, y: -9.25, w: 1234.5, h: 77 }, { x: 5000, y: 5000, w: 9999, h: 3 },
        { x: -1, y: -1, w: 12, h: 4000 },
    ];
    for (const rect of cases) {
        expect(E.jumpTo("0", rect)).toBe(true);
        const f = fitView(rect, E.width, E.height);
        expect(E.cam.frame).toBe("0");                      // no crossing: the fit is what is on screen
        expect(E.cam.inScale).toBeCloseTo(f.inScale, 12);
        expect(E.cam.inPanX).toBeCloseTo(f.inPanX, 6);
        expect(E.cam.inPanY).toBeCloseTo(f.inPanY, 6);
    }
    expect(fitView({ x: 0, y: 0, w: 0, h: 0 }, 320, 240)).toBe(null);
    expect(fitView({ x: 0, y: 0, w: NaN, h: 10 }, 320, 240)).toBe(null);
});

// ---------------------------------------------------------------------------
// The measurement the P3 row asks for (printed, never asserted as a bar)
// ---------------------------------------------------------------------------

test("MEASURE listFor against _buildList for the camera's own frame", () => {
    const E = mkEngine();
    for (let k = 0; k < 8; k++) drawStroke(E, [[60 + k * 20, 80], [700 - k * 30, 520], [120, 400 + k * 10]], 8 + k);
    E._render();
    const win = E.cam.frameWindow(0);
    const F = E.cam.frame;
    const runs = 20;
    let a = 0, b = 0, n = 0;
    for (let k = 0; k < runs; k++) {
        let t = performance.now(); n = E._buildList().length; a += performance.now() - t;
        t = performance.now(); E.listFor(F, win); b += performance.now() - t;
    }
    // eslint-disable-next-line no-console
    console.log("listFor vs _buildList: " + n + " objects, " + runs + " runs — _buildList "
        + (a / runs).toFixed(3) + " ms, listFor " + (b / runs).toFixed(3) + " ms");
    expect(n).toBeGreaterThan(0);
});
