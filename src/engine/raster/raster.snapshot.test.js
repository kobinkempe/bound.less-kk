/**
 * raster.snapshot.test.js — PAPER-PLAN §8's P3 row: the off-camera render list (`listFor`),
 * `snapshotView` (SCENES-PLAN S1) and the crossing prebake (PAPER-PLAN R4). The design is
 * §7.4; the file:line reasoning is `.claude/paper/C-preview-prebake-live.md` §2 and §3.
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
import { plateKey, plateRange, quantumFor, zqOf, PLATE_PX } from "./plate";
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
    // The PLATES path: §6.5's synchronous path composes and caches nothing, and every claim
    // below reads the cache or the queue.
    E.renderer.layer.syncBudget = 0;
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

/** Run whatever `_maybePrebake` queued: jsdom has no `requestIdleCallback`, so it is a timeout. */
const idle = () => new Promise((r) => setTimeout(r, 40));

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

    await flush();
    await p;
    expect(JSON.stringify(E.cam.state())).toBe(cam0);
    expect([...E.store._pins].sort()).toEqual(pins0);
});

test("S1 BREAK-CHECK: with `content` in the snapshot's read, the visible pin set is replaced", async () => {
    // `content` adds each key it reads to `_pins` and then REPLACES the field with its own
    // range. Off camera that unpins the whole visible screen, and the prebake's `_evict` can
    // then take the tiles the user is looking at.
    const E = mkEngine();
    drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18);
    await paint(E);
    const pins0 = [...E.store._pins].sort();
    const read = E.store.read.bind(E.store);
    E.store.read = (F, rect, budget) => { E.store.content(F, rect); return read(F, rect, budget); };
    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 1e5, y: 1e5, w: 400, h: 300 } });
    expect([...E.store._pins].sort()).not.toEqual(pins0);
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
    expect(String(job.q)).toMatch(/^t\d+$/);                // a per-call key, never a quantum
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
    const size0 = E.plates.size();
    const puts0 = E.plates.report().puts;

    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 60, y: 60, w: 400, h: 300 } });
    await flush();
    await p;

    // Its `q` is a per-call string that carries no zoom; cached, it would come back as a hit at
    // a zoom it was never rastered at (§6.5's rule for `"s"`).
    expect(E.plates.size()).toBe(size0);
    expect(E.plates.report().puts).toBe(puts0);
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

    const size0 = E.plates.size();
    const ac = new AbortController();
    const p = E.snapshotView({ frame: E.cam.frame, rect: { x: 60, y: 60, w: 400, h: 300 }, signal: ac.signal });
    expect(gate.length).toBe(1);                            // dispatched, parked in the transport
    ac.abort();
    await gate.release();                                   // it still completes; the result is dropped

    await expect(p).rejects.toThrow("aborted");
    expect(rasterStats.snapshotAborts).toBe(1);
    expect(E.plates.jobs.size).toBe(0);                     // `beginJob` was never called
    expect(E.plates.inflight.size).toBe(0);
    expect(E.plates.size()).toBe(size0);
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
// The crossing prebake (R4): the two predicates, the post-crossing quantum, and no minting
// ---------------------------------------------------------------------------

test("R4 the DOWNWARD aim fires at 1.25·exit, at the parent, and nowhere above it", () => {
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    descend(E, 1, 400, 300);                                // a real crossing, so a parent exists

    E.cam.inScale = 1;
    expect(E._crossTarget()).toBe(null);                    // no crossing is coming: nothing to aim at

    // 1.25 is the exact mirror of the upward 0.8 (one quantum is 2^(1/4) = 1.189).
    E.cam.inScale = E.cfg.exit * 1.26;
    expect(E._crossTarget()).toBe(null);
    E.cam.inScale = E.cfg.exit * 1.24;
    const down = E._crossTarget();
    expect(down).toBeTruthy();
    expect(down.dir).toBe("down");
    expect(down.id).toBe(E.lm.parentOf(E.cam.frame));
    // `Camera._crossDown`'s own arithmetic: `(s / base) · inScale`, ×4096 for a lattice edge.
    expect(down.inScale).toBeCloseTo((E.lm.frame(E.cam.frame).edge.s / E.cfg.base) * E.cam.inScale, 9);
});

test("R4 the UPWARD aim fires at 0.8·enter, and with preBake off it mints nothing", () => {
    const E = mkEngine();
    E.setPreBake(false);
    drawStroke(E, [[360, 260], [440, 340]], 12);
    const n0 = E.lm.frames.size;

    E.cam.inScale = E.cfg.enter * 0.79;
    expect(E._crossTarget()).toBe(null);
    E.cam.inScale = E.cfg.enter * 0.81;
    expect(E._crossTarget()).toBe(null);                    // the child does not exist, and this cannot make one
    E._maybePrebake();
    expect(E.lm.frames.size).toBe(n0);

    // The dev toggle defines it early on purpose ("first defined, forever"); with the toggle
    // back off the aim FINDS that child and the lattice does not grow again.
    E.setPreBake(true);
    const up = E._crossTarget();
    expect(up.dir).toBe("up");
    expect(E.lm.frames.size).toBe(n0 + 1);
    E.setPreBake(false);
    expect(E._crossTarget().id).toBe(up.id);
    expect(E.lm.frames.size).toBe(n0 + 1);
    // `Camera._crossUp`'s own arithmetic: `inScale · base / s`.
    expect(up.inScale).toBeCloseTo(E.cam.inScale * E.cfg.base / E.lm.frame(up.id).edge.s, 9);
});

test("R4 at the ROOT the downward aim is null: the prebake never grows a root", () => {
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    expect(E.cam.frame).toBe("0");
    expect(E.lm.parentOf("0")).toBe(null);
    const n0 = E.lm.frames.size;
    E.cam.inScale = E.cfg.exit * 1.1;
    expect(E._crossTarget()).toBe(null);
    E._maybePrebake();
    expect(E.lm.frames.size).toBe(n0);
    expect(E._prebakeQueued).toBeFalsy();                   // nothing was even queued
});

test("R4 a downward approach prebakes the PARENT's preview at q − 8 of the post-crossing quantum", async () => {
    const jobs = mkTap();
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    await paint(E);
    descend(E, 1, 400, 300);
    await paint(E);
    await idle();                                           // drain the prebake `descend`'s own zooms queued
    await flush();
    resetRasterStats();

    E.cam.inScale = E.cfg.exit * 1.2;
    const t = E._crossTarget();
    expect(t && t.dir).toBe("down");
    const q = quantumFor(t.inScale, E.renderer.layer.dpr).q - 8;
    const win = E.lm.mapRectF(E.cam.frameWindow(0), E.cam.frame, t.id);
    const range = plateRange(win, zqOf(q));
    const n = (range.i1 - range.i0 + 1) * (range.j1 - range.j0 + 1);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(6);                       // the preview, not the 20–24 of a full set

    const cam0 = JSON.stringify(E.cam.state());
    const pins0 = [...E.store._pins].sort();
    jobs.length = 0;
    E._maybePrebake();
    await idle();
    await flush();

    expect(rasterStats.prebakePosts).toBe(1);
    expect(rasterStats.prebakePlates).toBe(n);
    // The job carries the TARGET frame's list, not the camera's: `_lastList` is in frame-1
    // units, which at the parent's Zq lands wholly outside the plate and packs nothing.
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => String(j.q) === String(q))).toBe(true);
    expect(jobs.reduce((s, j) => s + j.nItems, 0)).toBeGreaterThan(0);
    // The plates are cached under the TARGET frame at the target's own quantum, so the first
    // frame after the crossing composes from cache instead of from paper.
    let cached = 0;
    for (let i = range.i0; i <= range.i1; i++) {
        for (let j = range.j0; j <= range.j1; j++) if (E.plates.get(plateKey(t.id, q, i, j))) cached++;
    }
    expect(cached).toBe(n);
    // ...unpinned (D75's `{ pin: "none" }`), so a crossing that never comes costs one LRU
    // generation and nothing else — and the camera is where it was.
    for (let i = range.i0; i <= range.i1; i++) {
        for (let j = range.j0; j <= range.j1; j++) expect(E.plates._pins.has(plateKey(t.id, q, i, j))).toBe(false);
    }
    expect(JSON.stringify(E.cam.state())).toBe(cam0);
    expect([...E.store._pins].sort()).toEqual(pins0);
});

test("R4 no crossing in sight: the prebake posts nothing at all", async () => {
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    await paint(E);
    const posts0 = rasterStats.posts;
    E.cam.inScale = 1;
    E._maybePrebake();
    await idle();
    await flush();
    expect(rasterStats.prebakePosts).toBe(0);
    expect(rasterStats.posts).toBe(posts0);
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

// ---------------------------------------------------------------------------
// R5b — the zoom-out ladder (PAPER-PLAN §7.5): built while the camera is still
// ---------------------------------------------------------------------------

test("R5b a still camera posts the ladder: the parent level's plates and tiles, nothing minted, the camera untouched", async () => {
    const jobs = mkTap();
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    await paint(E);
    descend(E, 1, 400, 300);
    await paint(E);
    await idle();
    await flush();
    resetRasterStats();
    const parent = E.lm.parentOf(E.cam.frame);
    expect(parent).not.toBe(null);
    E.store.cache.clear();                                  // so a parent tile can only come from the ladder
    const n0 = E.lm.frames.size, cam0 = JSON.stringify(E.cam.state());
    E._lastCamMove = -1e9;
    E._ladderAt = null;
    jobs.length = 0;
    const strips = E._buildLadder();
    for (let k = 0; k < 12 && E._ladderBusy; k++) { await idle(); }   // one rung an idle callback
    await flush();
    expect(strips).toBeGreaterThan(0);
    expect(E._ladderBusy).toBe(false);
    expect(rasterStats.ladderPosts).toBeGreaterThan(0);
    expect(rasterStats.ladderRefused).toBe(0);
    expect(E.lm.frames.size).toBe(n0);                      // a speculative build mints nothing
    expect(JSON.stringify(E.cam.state())).toBe(cam0);       // and moves no camera
    expect([...E.plates.cache.keys()].some((k) => k.startsWith(parent + "|"))).toBe(true);
    expect([...E.store.cache.keys()].some((k) => k.startsWith(parent + "|"))).toBe(true);
    expect(E._ladderSteps.some((st) => st.cross)).toBe(true);        // the crossing's own view is warmed, last
    expect(E._ladderSteps[E._ladderSteps.length - 1].cross).toBe(true);
    for (const k of E.plates.cache.keys()) if (k.startsWith(parent + "|")) expect(E.plates._pins.has(k)).toBe(false);
    // the same camera again: nothing to post
    resetRasterStats();
    expect(E._buildLadder()).toBe(0);
    expect(rasterStats.ladderPosts).toBe(0);
});

test("R5b at the root the ladder stops: zooming out past it would grow a root", () => {
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    expect(E.lm.parentOf(E.cam.frame)).toBe(null);
    E.cam.inScale = E.cfg.exit * 2;                         // 4× out crosses below the root
    E._render();
    const n0 = E.lm.frames.size;
    expect(E._zoomedOut(4)).toBe(null);
    E._lastCamMove = -1e9;
    E._ladderAt = null;
    E._buildLadder();
    expect(E.lm.frames.size).toBe(n0);
    expect(rasterStats.ladderPosts).toBe(0);
});

test("R5b the ladder waits for the camera to be still, and re-arms", () => {
    const E = mkEngine();
    drawStroke(E, [[360, 260], [440, 340]], 12);
    E._lastCamMove = performance.now();
    E._ladderAt = null;
    expect(E._buildLadder()).toBe(0);
    expect(E._ladderTimer).not.toBe(null);
    expect(rasterStats.ladderPosts).toBe(0);
});
