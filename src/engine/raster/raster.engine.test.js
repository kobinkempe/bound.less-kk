/**
 * raster.engine.test.js — stage 5b's own suite (RASTERISER-PLAN §9.2's E series and §10 stage 5b's acceptance) on the
 * picture pyramid (ported by B-PYRAMID-2b: the list is the scene, the timing budgets stay). §8.4 rule 2 on the
 * pyramid's frame: a frame that packs and posts sums its main buckets within max(1 ms, 10 %), and an arrival's wall
 * partitions from the strip's queued-at; FC1/FC2/FC6; the E series on a whole engine.
 *
 * Nothing here measures a picture on a screen: jsdom's `getContext` is null in this tree (`setupTests.js:27`), so the
 * E series reads the plates' own bytes out of the store (the inline path's raw `pixels`). The worker pool is a
 * TRANSPORT the test resolves by hand, running the shipped `runJob` on this thread, so an arrival can be held.
 */

import KobinEngine from "../KobinEngine";
import Renderer from "../Renderer";
import { resetRasterStats } from "./RasterRenderer";
import { packStats, resetPackStats, packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import * as rasterPerf from "./rasterPerf";
import { PLATE_PX } from "./plate";
import { levelKey, restKey } from "./level";
import {
    setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient,
} from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import {
    drawStroke, eraseGesture, raster, rasterZ, colorAt, camShot, camRestore, frameToScreen,
} from "../__testkit__/harness";

/** A square fill, in frame units. */
const fillItem = (id, x, y, s) => ({
    id, type: "fill", origin: "native", color: "rgb(0,0,0)", opacity: 1,
    polys: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s]]],
});

/**
 * The pool, replaced by a gate: every dispatch parks here until the test releases it, which is
 * how a document change lands while a job is in flight.
 */
function mkGate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        get length() { return parked.length; },
        /**
         * Run the shipped worker entry on this thread and deliver the result. **No `receivedAt`**, so `runJob`
         * stamps its own receipt as the shipped `onmessage` does (a `receivedAt: 0` makes the queueing negative).
         */
        async release() {
            const p = parked.shift();
            if (!p) return false;
            const out = await runJob(p.msg);
            p.resolve(out.msg);
            for (let k = 0; k < 6; k++) await Promise.resolve();   // the client's `then`, the landing, the conversion
            return true;
        },
    };
}

const engines = [];
/** A raster engine; `perf` replaces its renderer's recorder from the next row on. */
function mkEngine(w = 400, h = 300, perf = null) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    if (perf) E.renderer.perf = perf;
    engines.push({ E, host });
    return E;
}

beforeEach(() => {
    resetRasterWorkerClient();
    setRasterWorkerCount(1);
    resetRasterStats(); resetPackStats();
});
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
    setRasterTransport(null);
    resetRasterWorkerClient();
    rasterPerf.reset();
});

// ---------------------------------------------------------------------------
// §8.4 rule 2 on the pyramid's frame
// ---------------------------------------------------------------------------

/**
 * §8.4 rule 2's recorder, with §8.1's own slot names: ENGINE's buckets, `xfer.out`, `xfer.in` and `br.blit` are MAIN;
 * `br.bitmap` is wall. `noteSubmit` takes the strip's queued-at (`JobQueue`'s push), as `rasterPerf.noteSubmit` does.
 */
const MAIN_SLOTS = ["eng.list", "eng.settle", "eng.cull", "eng.band", "eng.pack",
    "eng.view", "eng.lookup", "ovl.tail", "xfer.out", "xfer.in", "br.blit"];
/** The core's phases: MAIN on a row the inline executor ran in (`noteCore`, rasOnMain), the worker's elsewhere. */
const CORE_SLOTS = ["eng.clip", "ras.edges", "ras.union", "ras.accum"];
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function mkPerf() {
    const rows = [], queued = new Map();
    let open = null;
    const P = {
        rows,
        attach() {}, detach() {},
        beginFrame(seq, kind, backMs = 0) { open = { seq, kind, t0: clock() - (backMs > 0 ? backMs : 0), slots: {}, mainMs: 0, wallMs: 0, info: null }; rows.push(open); },
        endFrame() {
            if (!open) return;
            const end = clock();                                 // one read for both totals, as `rasterPerf.endFrame`
            open.mainMs = end - open.t0;
            if (open.queuedAt) open.wallMs = end - open.queuedAt;
            open = null;
        },
        orphans: [],
        add(slot, ms) { if (!open) { P.orphans.push(slot); return; } open.slots[slot] = (open.slots[slot] || 0) + ms; },
        noteSubmit(req, nPlates, nStrips, at) { if (!queued.has(req.frameSeq)) queued.set(req.frameSeq, at != null ? at : clock()); },
        noteJob(info) {
            if (!open) return;
            open.info = info; open.queuedAt = queued.get(info.frameSeq) || 0;
            P.add("xfer.in", +info.recvMs || 0);
        },
        noteBitmap(ms) { P.add("br.bitmap", ms); },
        noteCompose(ms) { P.add("br.blit", ms); },
        noteCore(c) {
            if (!open) return;
            open.rasOnMain = true;
            P.add("eng.clip", +c.clipMs || 0); P.add("ras.edges", +c.edgesMs || 0);
            P.add("ras.union", +c.unionMs || 0); P.add("ras.accum", +c.accumMs || 0);
        },
        noteDrop() {}, noteView() {},
    };
    return P;
}
const sumMain = (row) => MAIN_SLOTS.concat(row.rasOnMain ? CORE_SLOTS : []).reduce((t, s) => t + (row.slots[s] || 0), 0);
const bar = (ms) => Math.max(1, 0.1 * ms);

/** A render whose view jobs go to the pool (no inline rest render), after a change under every cell. */
function packingRender(E, items) {
    for (const o of items) E.doc.add(o, "0");
    const p0 = packStats.packed;
    E._render();
    return packStats.packed - p0;
}

test("§8.4 rule 2 on the pyramid: a frame that PACKS AND POSTS sums its main buckets, light and dense, inside max(1 ms, 10 %); an arrival's wall partitions", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    const E = mkEngine(400, 300, perf), R = E.renderer;
    R.pyramid.cfg.restInline = "never";                        // the rest render and the patches go to the pool:
    R.pyramid.cfg.patchInlineMs = 0;                            // these frames pack AND post
    E.cfg.prefetchQuietMs = 1e9;                                // the prefetch is its own task, not these frames
    // The FIRST frame is measured and reported, never asserted: every path in the bracket runs cold once.
    packingRender(E, [fillItem(6, 30, 30, 100)]);
    while (await gate.release());
    const packedIn = [packingRender(E, [fillItem(7, 20, 20, 120)])];
    while (await gate.release());
    const dense = [];
    for (let k = 0; k < 60; k++) dense.push(fillItem(100 + k, 4 + (k % 20) * 18, 4 + Math.floor(k / 20) * 90, 16));
    packedIn.push(packingRender(E, dense));
    const renders = perf.rows.filter((r) => r.kind === "render");
    const label = ["cold", "light", "dense"];
    renders.forEach((row, k) => {
        const res = row.mainMs - sumMain(row);
        // eslint-disable-next-line no-console
        console.log("rule 2 " + label[k] + ": mainMs " + row.mainMs.toFixed(3) + " = buckets " + sumMain(row).toFixed(3)
            + " (pack " + (row.slots["eng.pack"] || 0).toFixed(3) + ", xfer.out " + (row.slots["xfer.out"] || 0).toFixed(3)
            + ", view " + (row.slots["eng.view"] || 0).toFixed(3) + ") + residual " + res.toFixed(3) + "  (bar " + bar(row.mainMs).toFixed(3) + ")");
        expect(res).toBeGreaterThan(-1e-9);                     // no bucket may exceed the task
        if (k === 0) return;
        expect(row.slots["eng.pack"]).toBeGreaterThan(0);       // the row PACKED and POSTED
        expect(row.slots["xfer.out"]).toBeGreaterThan(0);
        expect(res).toBeLessThanOrEqual(bar(row.mainMs));
    });
    expect(renders.length).toBe(3);
    expect(packedIn[1]).toBeGreaterThan(packedIn[0]);            // the dense frame packed more items

    // The WALL half, on the arrival row that carries the job: every part present and non-negative, and the residual
    // exactly this task's own unbucketed main time.
    await gate.release();
    const arrival = perf.rows.filter((r) => r.kind === "arrival" && r.info).pop();
    const info = arrival.info;
    const phases = info.wallMs - info.queueingMs, deliver = arrival.t0 - info.arrivedAt, queueWait = info.postedAt - arrival.queuedAt;
    const inMs = arrival.slots["xfer.in"] || 0, blitMs = arrival.slots["br.blit"] || 0;
    const resW = arrival.wallMs - (queueWait + phases + info.queueingMs + deliver + inMs + blitMs);
    for (const v of [phases, info.queueingMs, deliver, inMs, blitMs, queueWait]) expect(isFinite(v) && v >= -1e-9).toBe(true);
    expect(arrival.queuedAt).toBeGreaterThan(0);                 // the strip's queued-at reached the recorder
    expect(Math.abs(resW - (arrival.mainMs - inMs - blitMs))).toBeLessThan(1e-6);
    expect(resW).toBeLessThan(1e3);
});

test("§8.4 rule 2: the prefetch's off-camera reads inside a still camera step are its row's eng.list, not a residual (P6's 319 ms camera row)", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    const E = mkEngine(400, 300, perf), R = E.renderer;
    R.pyramid.cfg.restInline = "never";
    R.pyramid.cfg.patchInlineMs = 0;
    packingRender(E, [fillItem(6, 30, 30, 100)]);
    while (await gate.release());
    E.cfg.prefetchQuietMs = 0;                                  // the plan in the step itself
    const snap = E.stage.snapshot.bind(E.stage);
    E.stage.snapshot = (...a) => { const t = performance.now(); while (performance.now() - t < 25); return snap(...a); };   // a slow tile read
    R._pyrPrefetchKey = null;
    const n0 = perf.rows.length;
    R.syncCameraOnly();
    const row = perf.rows.slice(n0).find((r) => r.kind === "camera");
    expect(row.mainMs).toBeGreaterThan(25);
    expect(row.slots["eng.list"]).toBeGreaterThanOrEqual(25);
    expect(row.mainMs - sumMain(row)).toBeLessThanOrEqual(bar(row.mainMs));
    while (await gate.release());
});

test("BREAK-CHECK: unbucketed work in the ARRIVAL task breaks the main half, and the wall half cannot see it", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    const E = mkEngine(400, 300, perf), R = E.renderer;
    R.pyramid.cfg.restInline = "never";
    R.pyramid.cfg.patchInlineMs = 0;
    E.cfg.prefetchQuietMs = 1e9;
    const land = R._pyrLand.bind(R);
    R._pyrLand = (...a) => { const t = Date.now(); while (Date.now() - t < 5) { /* 5 ms in no bucket */ } return land(...a); };
    while (await gate.release());                                // the constructor's jobs, queued before this recorder
    packingRender(E, [fillItem(7, 20, 20, 120)]);
    await gate.release();
    const arrival = perf.rows.filter((r) => r.kind === "arrival" && r.info).pop();
    const inMs = arrival.slots["xfer.in"] || 0, blitMs = arrival.slots["br.blit"] || 0;
    expect(arrival.mainMs - sumMain(arrival)).toBeGreaterThan(bar(arrival.mainMs));
    const info = arrival.info;
    const parts = (info.postedAt - arrival.queuedAt) + (info.wallMs - info.queueingMs) + info.queueingMs
        + (arrival.t0 - info.arrivedAt) + inMs + blitMs;
    expect(Math.abs((arrival.wallMs - parts) - (arrival.mainMs - inMs - blitMs))).toBeLessThan(1e-6);
});

test("§8.4 rule 2 on an inline rest frame: the core's phases are the row's (rasOnMain), out of eng.view, inside the bar", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    const E = mkEngine(400, 300, perf), R = E.renderer;
    R.pyramid.cfg.prefetchQuietMs = 1e9;
    R.pyramid.cfg.restInline = "never";                             // the first frames: the level's plates, through the pool
    for (let k = 0; k < 30; k++) E.doc.add(fillItem(200 + k, 6 + (k % 10) * 38, 6 + Math.floor(k / 10) * 90, 30), "0");
    E._render();
    while (await gate.release());
    R.pyramid.cfg.restInline = "auto"; R.pyramid.cfg.restInlineMs = 1e3;   // any estimate fits: the still frame renders inline
    const n0 = perf.rows.length, inline0 = R.pyramid.s.restInline;
    R.syncCameraOnly();                                             // the still frame: the rest set, inline
    expect(R.pyramid.s.restInline).toBe(inline0 + 1);
    const row = perf.rows.slice(n0).find((r) => r.kind === "camera");
    const res = row.mainMs - sumMain(row), core = CORE_SLOTS.reduce((t, s) => t + (row.slots[s] || 0), 0);
    // eslint-disable-next-line no-console
    console.log("rule 2 inline rest: mainMs " + row.mainMs.toFixed(3) + " = buckets " + sumMain(row).toFixed(3) + " (core "
        + core.toFixed(3) + ", view " + (row.slots["eng.view"] || 0).toFixed(3) + ") + residual " + res.toFixed(3) + "  (bar " + bar(row.mainMs).toFixed(3) + ")");
    expect(row.rasOnMain).toBe(true);
    expect(row.slots["ras.edges"]).toBeGreaterThan(0);
    expect(res).toBeGreaterThan(-1e-9);                             // counted twice (core inside eng.view too) is negative
    expect(res).toBeLessThanOrEqual(bar(row.mainMs));
});

// ---------------------------------------------------------------------------
// Stage 3's five hand-offs, and FC1 / FC2 / FC6 (§10 stage 5b)
// ---------------------------------------------------------------------------

/** The engine's renderer, for the FC tests. */
function mkRenderer() {
    const E = mkEngine();
    return { E, R: E.renderer, cam: E.cam, store: E.plates, host: E.renderer.host };
}

test("FC1: the stack is z-index and not the append order, one layer list, `_overlay` null", () => {
    const { R, host } = mkRenderer();
    const svg = R.two.renderer.domElement;
    const ink = host.querySelector("canvas.bl-ink") || R.layer._canvas;
    expect(String(ink.style.zIndex || "0")).toBe("0");
    expect(svg.style.zIndex).toBe("1");
    expect(R._overlay).toBe(null);                          // 5d's slot, present and empty
    expect(R._layers.length).toBe(1);
    expect(R._layers[0]).toBe(R.layer);

    // `setSize` walks the ONE list and carries the dpr the base class has no room for.
    const sized = [];
    R._layers.push({ setSize: (w, h, d) => sized.push([w, h, d]), destroy: () => {} });
    R.setSize(640, 480);
    expect(sized).toEqual([[640, 480, R.layer.dpr]]);
    expect(R.layer.cssW).toBe(640);
});

test("FC1: the store's release drives the ONE list, and the layer canvas goes with the cache", () => {
    const { R, store } = mkRenderer();
    const seen = [];
    R._layers.push({ onStoreRelease: (why) => seen.push(why), destroy: () => {}, setSize: () => {} });
    store.release("hidden");
    expect(seen).toEqual(["hidden"]);
});

test("FC2 and FC6: one view object reaches the overlays, the origin is stable, no reorigin", () => {
    const { R, cam } = mkRenderer();
    const seen = [];
    R._renderOverlays = (view) => seen.push(view);
    R.render([], cam.frame);
    R.syncCameraOnly();
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(R._view);                          // the object, not a copy (FC2)
    expect(seen[1]).toBe(seen[0]);

    const o1 = R._origin();
    expect(R._origin()).toBe(o1);                           // stable identity: `_selDecide` caches on it
    expect(R.needsReorigin()).toBe(false);
    expect(R.needsWindowChop()).toBe(false);
    expect(R.needsFadeFlip()).toBe(false);                  // D201
    void cam;
});

test("FC2: the SVG world transform takes `d` from the view and never from the camera", () => {
    const { R, cam } = mkRenderer();
    R.render([], cam.frame);
    const v = R._view;
    const o = R._origin();
    expect(R.world.scale).toBeCloseTo(v.k / v.dpr, 12);
    expect(R.world.translation.x).toBeCloseTo((v.tx + o.x * v.k) / v.dpr, 12);
    // The camera's own pan is what FC2 replaces: they agree only when the snap is zero.
    cam.panBy(0.5, 0);
    R.syncCameraOnly();
    const v2 = R._view;
    expect(R.world.translation.x).toBeCloseTo((v2.tx + o.x * v2.k) / v2.dpr, 12);
});

// ---------------------------------------------------------------------------
// The E series (§9.2): a whole `KobinEngine` on the raster path
//
// jsdom's `getContext` is null for every canvas (`setupTests.js:27`), so nothing here reads the
// SCREEN. Every E test reads the PLATE's own bytes out of the store — the inline path's raw
// `pixels`, because jsdom has no `createImageBitmap` — and what the picture looks like stays
// stage 7's, in Kobin's Chrome (§9.4).
// ---------------------------------------------------------------------------

/** Let the inline jobs arrive: until no engine's queue has a strip queued or in flight. */
async function flush(rounds = 12) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const busy = engines.some(({ E }) => { const r = E.renderer.queue.report(); return r.queued.some((n) => n) || r.inFlight.some((n) => n); });
        if (!busy) return k + 1;
    }
    return rounds;
}
/** No rest render and no inline patch: the view stays on its level's plates and every change's work goes to the pool. */
function levelOnly(E) { const c = E.renderer.pyramid.cfg; c.restInline = "never"; c.restQuietMs = 1e9; c.patchInlineMs = 0; return E; }
/** A view cell's own key: the rest set's at rest, else the view level's. */
const viewKey = (v, i, j) => (v.mode === "rest" ? restKey(v.frameId, v.Z, i, j) : levelKey(v.frameId, v.level, v.S, i, j));
const paint = async (E) => { E._render(); return flush(); };

/** The plate pixel a CSS screen point lands on. `null` where no plate holds it. */
function pixelAt(E, sx, sy) {
    const v = E.renderer._view;
    const X = Math.floor((sx * v.dpr - v.dx) / v.s + v.ox), Y = Math.floor((sy * v.dpr - v.dy) / v.s + v.oy);
    const i = Math.floor(X / PLATE_PX), j = Math.floor(Y / PLATE_PX);
    const e = E.plates.get(viewKey(v, i, j));
    if (!e) return null;
    if (!e.pixels) return e.bytes === 0 ? [255, 255, 255, 255] : null;   // an empty plate IS the paper
    const o = ((Y - j * PLATE_PX) * PLATE_PX + (X - i * PLATE_PX)) * 4;
    return [e.pixels[o], e.pixels[o + 1], e.pixels[o + 2], e.pixels[o + 3]];
}
/**
 * E1 as restated (§15.3 Q9): the plate is OPAQUE — painted on the paper (D7, §4.7) — so there is
 * no alpha to read and "inked" is "differs from the paper by more than half a step".
 */
const INK_STEP = 127;
function inkedAt(E, sx, sy) {
    const p = pixelAt(E, sx, sy);
    if (!p) return null;
    return (255 - p[0]) > INK_STEP || (255 - p[1]) > INK_STEP || (255 - p[2]) > INK_STEP;
}
/** The 48 × 48 grid `harness.raster` samples, read from the PLATES instead of from the list. */
function plateGrid(E, n = 48) {
    const out = [];
    for (let j = 0; j < n; j++) {
        let row = "";
        for (let i = 0; i < n; i++) {
            const v = inkedAt(E, ((i + 0.5) / n) * E.width, ((j + 0.5) / n) * E.height);
            row += v == null ? "?" : v ? "#" : ".";
        }
        out.push(row);
    }
    return out.join("\n");
}
/** Within one DEVICE pixel of an edge, where the list's yes/no and a coverage value differ. */
function nearEdge(E, sx, sy) {
    const d = 1 / E.renderer._view.dpr;
    const c = inkedAt(E, sx, sy);
    for (const [dx, dy] of [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, d]]) {
        if (inkedAt(E, sx + dx, sy + dy) !== c) return true;
    }
    return false;
}
/** Cells where the plates and the render list disagree, split by whether an edge explains it. */
function compareGrid(E, n = 48) {
    const want = raster(E, n).split("\n"), got = plateGrid(E, n).split("\n");
    let clear = 0, band = 0, missing = 0;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const sx = ((i + 0.5) / n) * E.width, sy = ((j + 0.5) / n) * E.height;
            if (got[j][i] === "?") { missing++; continue; }
            if (want[j][i] === got[j][i]) continue;
            if (nearEdge(E, sx, sy)) band++; else clear++;
        }
    }
    return { clear, band, missing };
}

test("E1 the plate's own pixels agree with the render list at the 48 × 48 grid", async () => {
    const E = mkEngine();
    drawStroke(E, [[60, 60], [340, 240]], 24);
    await paint(E);
    expect(E.plates.cache.size).toBeGreaterThan(0);
    const d = compareGrid(E);
    expect(d.missing).toBe(0);                              // every sample is on a cached plate
    expect(d.clear).toBe(0);                                // and every disagreement is at an edge
    expect(d.band).toBeLessThan(48);                        // the band is thin: one cell row, not a picture
});

test("E1 BREAK-CHECK: the same comparison against a picture the plates were never told about", async () => {
    const E = mkEngine();
    drawStroke(E, [[60, 60], [340, 240]], 24);
    await paint(E);
    // The document changes and the plates are NOT told (the Stage's dirt is cut): what the grid
    // then reads is the old picture, and the comparison that passes above fails by a wide margin.
    const puts = E.plates.report().puts;
    const real = E.stage._dirt;
    E.stage._dirt = function noDirt() {};
    drawStroke(E, [[60, 240], [340, 60]], 24);
    E._render();
    await flush();
    E.stage._dirt = real;
    expect(E.plates.report().puts).toBe(puts);              // nothing was re-rastered
    expect(compareGrid(E).clear).toBeGreaterThan(20);
});

/**
 * E2's fixture, re-taken at the review (2026-09-21) because the first one could not fail.
 *
 * §9.2 says "draw at level 6"; the first build drew one crossing down and asserted the picture
 * at the RESTORED camera. One crossing is 4096×, so a 24 px stroke drawn there paints about
 * 0.006 px back here and `cullPx` (0.3) drops it from the render list — both sides of every
 * comparison were then a picture the edit had not changed, and the drain happened anyway
 * through rule 2. What is asserted now is the thing P7 is about and the thing a stale plate
 * would break: **the plates of the frame the camera is NOT at**, retained across the crossing
 * by rule 5, are dropped by the edit and re-rastered when the camera comes back.
 */
/**
 * A cached plate a change has met since its G (rule 2, A2 §3.1). Under PAPER-PLAN R1 a stale
 * plate KEEPS its pixels, so `cache.has` does not separate the two states.
 */
const staleAt = (E, k) => { const e = E.plates.cache.get(k); return !!e && !E.plates.exact(e); };

async function crossIn(E) {
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 600) E.zoomAt(200, 150, -1000);
    expect(E.activeLevel).toBe(1);
    return paint(E);
}

test("E2 (P7) an object drawn one crossing in drops the RETAINED plates of the frame it is not at", async () => {
    const E = levelOnly(mkEngine());
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const shot = camShot(E);
    const home = [...E.plates.cache.values()].filter((r) => r.kind === "level" && E.plates.exact(r)).map((r) => r.key);   // frame "0"'s level plates (a frame change discards the rest set, A3 §2.4)
    expect(home.length).toBeGreaterThan(0);

    await crossIn(E);
    for (const k of home) expect(E.plates.cache.has(k)).toBe(true);   // rule 5: a crossing drops no level plate
    expect(E.plates.cache.size).toBeGreaterThan(home.length);         // ...and this frame's are beside them

    // The retained frame-"0" plates are reached only by the footprint mapped into EVERY frame
    // with tracked cells, which is the whole of problem 7.
    const dirtied = E.stage.stats.dirtied;
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    expect(E.stage.stats.dirtied).toBeGreaterThan(dirtied);
    expect(home.some((k) => staleAt(E, k))).toBe(true);           // the frame-"0" records under its mapped footprint

    // ...and the camera returns to a cache that has to raster that frame again, to the picture
    // a cold cache rasters.
    const redone = () => E.plates.s.puts + E.plates.s.patches;     // a stale record is patched or replaced
    const puts = redone();
    camRestore(E, shot);
    await flush();
    expect(redone()).toBeGreaterThan(puts);
    const warm = plateGrid(E);
    expect(compareGrid(E).clear).toBe(0);
    E.plates.dropAll();
    await paint(E);
    expect(plateGrid(E)).toBe(warm);
});

test("E2 BREAK-CHECK: with the Stage's dirt cut, the retained plates survive the edit made at the other level", async () => {
    const E = levelOnly(mkEngine());
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const home = [...E.plates.cache.values()].filter((r) => r.kind === "level" && E.plates.exact(r)).map((r) => r.key);
    await crossIn(E);

    const real = E.stage._dirt;
    E.stage._dirt = function noDirt() {};
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    E.stage._dirt = real;
    // the plates are there either way under R1, so what the break-check reads is exactness:
    // with no dirt nothing staled them and the compose would draw them as current ink
    for (const k of home) expect(staleAt(E, k)).toBe(false);
});

test("E2 BREAK-CHECK: a footprint mapped into the ACTIVE frame only leaves the other frame's plates stale", async () => {
    const E = levelOnly(mkEngine());
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const home = [...E.plates.cache.values()].filter((r) => r.kind === "level" && E.plates.exact(r)).map((r) => r.key);
    await crossIn(E);

    // The footprint mapped into the camera's own frame and into no other would leave a level-0
    // plate holding stale paper after something was drawn at level 6.
    const real = E.stage._rectsIn;
    E.stage._rectsIn = function activeOnly(states, F) { return String(F) === String(E.cam.frame) ? real.call(this, states, F) : []; };
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    E.stage._rectsIn = real;
    for (const k of home) expect(staleAt(E, k)).toBe(false);
});

test("E2b (P7) an object edited from one crossing IN leaves both frames' plates: the ink goes from each", async () => {
    const E = levelOnly(mkEngine());
    E.renderer.pyramid.cfg.patchInlineMs = undefined;         // the delete's patch in its own frame
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const shot = camShot(E);
    const home = [...E.plates.cache.values()].filter((r) => r.kind === "level" && E.plates.exact(r)).map((r) => r.key);
    expect(inkedAt(E, 200, 150)).toBe(true);

    await crossIn(E);
    expect(inkedAt(E, 200, 150)).toBe(true);                // the same object, magnified: the backdrop

    // The edit is made HERE, to an object whose home is the level above. Deleting is the one
    // edit that is not 4096× smaller at the other level: a move made at this camera is
    // sub-pixel up there, which is why §9.2's original "draw at level 6" could not be seen.
    E.setTool("select");
    E.pointerDown(200, 150); E.pointerUp();                 // tap-select reaches the native, not the piece
    expect(E.selection).toBeTruthy();
    E.deleteSelection();
    await paint(E);
    expect(inkedAt(E, 200, 150)).toBe(false);               // gone at this level...
    expect(home.some((k) => staleAt(E, k))).toBe(true);     // ...and the other frame's records under it were invalidated too

    camRestore(E, shot);
    await flush();
    expect(inkedAt(E, 200, 150)).toBe(false);
    const warm = plateGrid(E);
    expect(compareGrid(E).clear).toBe(0);
    E.plates.dropAll();
    await paint(E);
    expect(plateGrid(E)).toBe(warm);
});

test("E3 a dragged object is re-rastered at BOTH positions, and matches a cold raster", async () => {
    const E = mkEngine();
    drawStroke(E, [[100, 100], [300, 100]], 8);
    await paint(E);
    const before = plateGrid(E);
    const puts = E.plates.report().puts;
    expect(inkedAt(E, 200, 100)).toBe(true);

    // §9.2 says "one pixel"; the select tool's own threshold is 8 CSS px (`SELECT_DRAG_PX`), so
    // one pixel is not a drag at all. This moves 20 px, which is what lets the OLD position be
    // read as paper: a drag that only invalidated the new footprint would leave ink there.
    E.setTool("select");
    E.pointerDown(200, 100); E.pointerUp();                 // tap-select: a drag with nothing selected is a lasso
    E.pointerDown(200, 100);
    for (let k = 1; k <= 5; k++) E.pointerMove(200, 100 + k * 4);
    E.pointerUp();
    await paint(E);

    expect(E.plates.report().puts).toBeGreaterThan(puts);   // the plates were re-rastered
    expect(inkedAt(E, 200, 100)).toBe(false);               // the old position is paper again
    expect(inkedAt(E, 200, 120)).toBe(true);                // ...and the new one has the ink
    const after = plateGrid(E);
    expect(after).not.toBe(before);
    expect(compareGrid(E).clear).toBe(0);
    E.plates.dropAll();
    await paint(E);
    expect(plateGrid(E)).toBe(after);                       // cold and warm agree
});

// ---------------------------------------------------------------------------
// The OLD address, with the plate that painted it still IN FLIGHT (D25's case, D231's gap)
//
// A wide screen, because one plate is 512 device px: a move inside one plate is covered by the
// NEW address alone and proves nothing. Here the object starts on plate 0 and lands on plate 2,
// so only a footprint that includes where it WAS can reach the plate in flight.
// ---------------------------------------------------------------------------

/** Run every parked job, and everything the arrivals re-post, to quiet. */
async function drain(gate, rounds = 12) {
    for (let k = 0; k < rounds && gate.length; k++) await gate.release();
    await flush(3);
}
/** A document with one horizontal stroke on plate 0 of a 1600 × 400 screen, saved as a file would be. */
async function oneStrokeDoc() {
    const src = mkEngine(1600, 400);
    drawStroke(src, [[60, 200], [200, 200]], 24);
    await paint(src);
    return src.serializeDrawing();
}
const MOVE = 1200;                                  // frame units: plate 0 → plate 2
/** The screen point the stroke's middle sits at, before the move and after it. */
const wasAt = (E) => frameToScreen(E, 130, 200);
const nowAt = (E) => frameToScreen(E, 130 + MOVE, 200);

test("§15.3 Q4: a LOADED object's first move drops the old address, and the plate in flight for it is refused", async () => {
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    setRasterWorkerCount(4);                                 // every strip of the screen in flight at once
    const E = levelOnly(mkEngine(1600, 400));
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    await drain(gate); E.renderer.syncCameraOnly();          // the load's reset refused the jobs out before it: asked again
    const id = E._objs()[0].id;
    // A load emits one `reset` and no per-object event: the old address of the first move comes
    // from that change's own `oldBelow` (A2 §2.8). The break-check below proves it load-bearing.
    expect(E.plates.inflight.size).toBeGreaterThan(0);       // every plate of the screen is out
    const [wx, wy] = wasAt(E), [nx, ny] = nowAt(E);
    expect(inkedAt(E, wx, wy)).toBe(null);                   // nothing cached yet

    // `Document.undo` restores a move with exactly this call, and a one-shot move is the case
    // D231 stated as open: the plate painting the OLD address is in flight, and only the old
    // footprint can stale it.
    E.doc.setOffsetsById(id, [[MOVE, 0]]);
    E._render();
    await drain(gate);

    expect(E.plates.s.newer).toBeGreaterThan(0); // the old-address plate arrived behind and was re-posted
    expect(inkedAt(E, wx, wy)).toBe(false);                  // ...and where it was is paper
    expect(inkedAt(E, nx, ny)).toBe(true);                   // ...and the ink is where it went
    expect(compareGrid(E).clear).toBe(0);
});

test("BREAK-CHECK: with `oldBelow` left out of the footprint, that same plate caches the object where it no longer is", async () => {
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    setRasterWorkerCount(4);                                 // every strip of the screen in flight at once
    const E = levelOnly(mkEngine(1600, 400));
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    await drain(gate); E.renderer.syncCameraOnly();          // the load's reset refused the jobs out before it: asked again
    const id = E._objs()[0].id;

    const real = E.stage._footOf;
    E.stage._footOf = function noOld(ev, n) { return real.call(this, ev.offsetsOnly ? { ...ev, oldBelow: ev.obj.below } : ev, n); };
    E.doc.setOffsetsById(id, [[MOVE, 0]]);
    E._render();
    await drain(gate);
    E.stage._footOf = real;

    const [wx, wy] = wasAt(E);
    expect(inkedAt(E, wx, wy)).toBe(true);                   // stale ink, and nothing left to drop it
    expect(compareGrid(E).clear).toBeGreaterThan(0);
});

test("a geometry move with the old footprint's plate in flight: `oldBbox` reaches the dirt", async () => {
    // The drag writes OFFSETS (`below`), so this path — `moveById`/`setGeometryById`/
    // `bakeShapeById`, every one of which carries `oldBbox` and `oldLw` — has no other test.
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    setRasterWorkerCount(4);                                 // every strip of the screen in flight at once
    const E = levelOnly(mkEngine(1600, 400));
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    await drain(gate); E.renderer.syncCameraOnly();          // the load's reset refused the jobs out before it: asked again
    const id = E._objs()[0].id;

    const [wx, wy] = wasAt(E), [nx, ny] = nowAt(E);
    E.doc.moveById(id, MOVE, 0);
    E._render();
    await drain(gate);

    expect(E.plates.s.newer).toBeGreaterThan(0);
    expect(inkedAt(E, wx, wy)).toBe(false);
    expect(inkedAt(E, nx, ny)).toBe(true);
    expect(compareGrid(E).clear).toBe(0);
});

test("BREAK-CHECK: with `oldBbox` dropped from the event, the geometry move leaves the old plate stale", async () => {
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    setRasterWorkerCount(4);                                 // every strip of the screen in flight at once
    const E = levelOnly(mkEngine(1600, 400));
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    await drain(gate); E.renderer.syncCameraOnly();          // the load's reset refused the jobs out before it: asked again
    const id = E._objs()[0].id;

    const real = E.stage._footOf;
    E.stage._footOf = function noOld(ev, n) { return real.call(this, { ...ev, oldBbox: null, oldLw: 0 }, n); };
    const [wx, wy] = wasAt(E);
    E.doc.moveById(id, MOVE, 0);
    E._render();
    await drain(gate);
    E.stage._footOf = real;

    expect(inkedAt(E, wx, wy)).toBe(true);                   // the plate arrived with the old picture
    expect(compareGrid(E).clear).toBeGreaterThan(0);
});

test("E4 a crossing at a fixed point does not move the picture", async () => {
    const E = mkEngine();
    drawStroke(E, [[150, 120], [250, 180]], 20);
    await paint(E);
    expect(compareGrid(E).clear).toBe(0);

    const level = E.activeLevel;
    let guard = 0;
    while (E.activeLevel === level && guard++ < 600) E.zoomAt(200, 150, -1000);
    expect(E.activeLevel).toBe(level + 1);
    await flush();
    await paint(E);
    // The picture is the list's picture on both sides of the crossing — which is the only fixed
    // point a jsdom test can check, since the zoom itself moves every sample.
    expect(compareGrid(E).clear).toBe(0);
    expect(compareGrid(E).missing).toBe(0);
});

test("E5 an unbaked eraser mark paints white at its own z: below is covered, above is not", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 150], [320, 150]], 40, "rgb(0,0,0)");
    eraseGesture(E, [[200, 120], [200, 180]], 40);          // the mark, not yet baked
    drawStroke(E, [[80, 200], [320, 200]], 40, "rgb(0,0,0)");
    await paint(E);

    expect(inkedAt(E, 120, 150)).toBe(true);                // the first stroke, away from the mark
    expect(inkedAt(E, 200, 150)).toBe(false);               // under the mark: white ink over black
    expect(inkedAt(E, 200, 200)).toBe(true);                // drawn AFTER the mark: above it, untouched
});

test("E5b the painted mark and the shape its bake cuts agree at the grid", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 100], [320, 100]], 40);
    drawStroke(E, [[200, 100], [200, 240]], 40);
    eraseGesture(E, [[140, 100], [200, 100], [200, 160]], 36);   // a 90° corner
    await paint(E);
    const painted = plateGrid(E);

    E.flushErases();                                        // the bake cuts the ink the mark covered
    await paint(E);
    const baked = plateGrid(E);
    let differ = 0;
    for (let k = 0; k < painted.length; k++) if (painted[k] !== baked[k]) differ++;
    // §4.8's bar is a quarter device pixel; at this grid one cell is 8.3 × 6.25 device px, so
    // what is asserted is that the bake moved no CELL: a difference here is a visible one.
    expect(differ).toBe(0);
});

test("E6 stacking order: the plate's colour at each sample is the render list's top colour", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 140], [320, 140]], 40, "rgb(0,0,255)");
    drawStroke(E, [[200, 60], [200, 240]], 40, "rgb(255,0,0)");   // later: on top where they cross
    await paint(E);
    const n = 32;
    const z = rasterZ(E, n).split("\n");
    let wrong = 0, tested = 0;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            if (z[j][i] === ".") continue;
            const sx = ((i + 0.5) / n) * E.width, sy = ((j + 0.5) / n) * E.height;
            if (nearEdge(E, sx, sy)) continue;              // an edge sample blends two colours
            const p = pixelAt(E, sx, sy), want = colorAt(E, sx, sy);
            if (!p || !want) continue;
            tested++;
            const rgb = "rgb(" + p[0] + "," + p[1] + "," + p[2] + ")";
            if (rgb !== want) wrong++;
        }
    }
    expect(tested).toBeGreaterThan(20);
    expect(wrong).toBe(0);                                  // including the crossing, where red is on top
});

test("E7 a family with members at fade 1 and fade 0.02: the parent is not dimmed (§4.5)", () => {
    // A fade this deep cannot be reached from a two-stroke document without a crossing, so the list is built here and
    // packed as a plate job is: `Renderer.js:579`'s rule is that a member joins the family only at FULL fade, and a
    // member under it renders under its own id (`rasterPack.renderIdOf`).
    const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };
    const parent = { ...fillItem(1, 40, 40, 120), editId: 42 };
    // fade = (px − fadeLoPx) / (cullPx − fadeLoPx) at px = fadeTag · (Zq/dpr) / enter: 0.153 × 256 is a 2 % member at Zq 1.
    const faded = { ...fillItem(2, 100, 40, 120), editId: 42, fadeTag: 0.153 * CFG.enter };
    const job = packJob([parent, faded], { plates: Int32Array.of(0, 0), Zq: 1, dpr: 1, cfg: CFG, paper: [255, 255, 255] });
    const px = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    renderPlate(job, 0, px, null, null);
    const at = (x, y) => px[(y * PLATE_PX + x) * 4];
    expect(at(60, 60)).toBe(0);                             // the parent alone: full ink
    expect(at(200, 60)).toBeGreaterThan(240);               // the faded member alone: about 2 %
    expect(at(140, 60)).toBe(0);                            // BOTH: the parent is not dimmed
});

test("E8 the ink is on the canvas in raster mode and in the `<svg>` without it (§5.7)", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const svg = E.renderer.two.renderer.domElement;
    // What a serialiser would get: the raster path's `<svg>` holds no ink at all, which is why
    // `thumbnails.js` builds its engine with `raster: false` and `exportSvg` refuses.
    expect(svg.querySelectorAll("path").length).toBe(0);
    expect(E.plates.cache.size).toBeGreaterThan(0);
    expect(E.raster).toBe(true);

    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const S = new KobinEngine(host2, { width: 400, height: 300 });   // thumbnails' own construction
    engines.push({ E: S, host: host2 });
    drawStroke(S, [[80, 80], [320, 220]], 24);
    S._render();
    expect(S.raster).toBe(false);
    expect(S.plates).toBe(null);
    expect(host2.querySelector("svg").querySelectorAll("path").length).toBeGreaterThan(0);
});

test("a raster engine CONSTRUCTS in jsdom with a null 2D context and no matchMedia (G11, G13)", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    const E = mkEngine();
    expect(E.renderer.layer._ctx).toBe(null);
    expect(E.renderer._dprMq == null).toBe(true);           // §6.1's listener, absent and harmless
    expect(() => { E._render(); E.renderer.syncCameraOnly(); }).not.toThrow();
});

test("the fifth seam: the chevrons are ONE implementation, called from the SVG path (§2.5)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const S = new KobinEngine(host, { width: 400, height: 300 });           // the SVG renderer
    engines.push({ E: S, host });
    const R = S.renderer;
    expect(R).toBeInstanceOf(Renderer);
    const edges = [{ side: "left", from: 10, to: 90, chevron: true }, { side: "top", from: 10, to: 90 }];
    R.setSelectionAnts(() => ({ key: "k", inkPx: 10, runs: [], marks: [], edges, transform: { k: 1, tx: 0, ty: 0 } }));
    R.syncWorld();
    expect(typeof R._renderSelChevrons).toBe("function");
    expect(R._selEls.arrowPool.length).toBe(1);             // one chevron, for the one edge that carries it
    const t = R._selEls.arrowPool[0].getAttribute("transform");
    expect(t).toMatch(/rotate\(180\)$/);
    // ...and called directly it is the same pool, which is what makes 5d's call the same picture.
    expect(R._renderSelChevrons(edges, 1, 400, 300)).toBe(1);
    expect(R._selEls.arrowPool[0].getAttribute("transform")).toBe(t);
});

// ---------------------------------------------------------------------------
// THE SWAP (§15.3, "Stage 5b — accepted pending the swap task"): the same three claims the
// recorder above makes, re-made against the SHIPPED `rasterPerf`. The recorder proves the call
// sequence; these prove that what a report Kobin sends will actually say.
// ---------------------------------------------------------------------------

test("attach hands rasterPerf SEVEN sources: pack, core, ants and worker are not null", () => {
    // With the three the shim was called with, `report().pack`, `.core`, `.ants` and `.worker`
    // all ship null and §10 stage 6's items 3 and 4 are unmet (stage 6's H1, D210). The suite
    // for stage 6 cannot catch this: it injects all six itself.
    mkGate();
    const { R, cam } = mkRenderer();
    R.render([], cam.frame);
    const rep = rasterPerf.report();
    for (const k of ["pack", "core", "ants", "worker", "picture", "plates"]) {
        expect([k, rep[k] == null]).toEqual([k, false]);
    }
    expect(rep.pack.rejected).toBeDefined();                // the packer's own counters (§8.5's order)
    expect(rep.core.nonFinite).toBeDefined();               // the MAIN thread's guards
    expect(rep.ants.dashes).toBeDefined();
    expect(rep.memory.packedBytes).not.toBeNull();

    // D244's three, which reached nothing while the shim was in the way.
    const row = rep.frames.filter((r) => r.kind === "render").pop();
    const three = ["eng.view", "eng.lookup", "ovl.tail"].reduce((n, s) => n + (row.timers[s] || 0), 0);
    expect(three).toBeGreaterThan(0);
    // `eng.view` has the posts nested inside `frameFor` subtracted (D244), so it cannot exceed
    // the task it is measured in — the way §8.4 rule 2's first assertion would fail.
    expect(row.timers["eng.view"] || 0).toBeLessThanOrEqual(row.mainMs);
});

test("the live stroke is drawn after renderer.clear(): the overlay scene is re-attached (D271)", async () => {
    // Every `loadDrawing` and scene jump calls `clear()`. Measured in Chrome by the testing
    // round: after one, 30 pen moves put 0 pixels on screen and the overlay `<svg>` held no path
    // until pen-up, on every saved drawing.
    const E = mkEngine();
    const R = E.renderer;
    const svg = R.two.renderer.domElement;
    const livePaths = () => { R.update(); return svg.querySelectorAll("path").length; };
    E.setTool("pen");
    E.pointerDown(60, 60); E.pointerMove(120, 90); E.pointerMove(200, 140);
    expect(R._ovScene.root.parent).toBe(R.world);
    expect(livePaths()).toBeGreaterThan(0);                 // a fresh engine draws the live stroke
    E.pointerUp();
    await paint(E);

    R.clear();                                              // what loadDrawing and jumpTo do
    E._render();
    E.pointerDown(60, 160); E.pointerMove(120, 190); E.pointerMove(200, 240);
    expect(R._scenes.get("_ov")).toBe(R._ovScene);          // one persistent scene, re-registered
    expect(R._ovScene.root.parent).toBe(R.world);           // ...and back in the world
    expect(livePaths()).toBeGreaterThan(0);                 // so the second stroke is drawn too
    E.pointerUp();
    await paint(E);
    expect(livePaths()).toBe(0);                            // and gone at pen-up: the ink is in the plates
});

test("the ENGINE opens the row: eng.list is inside mainMs, and render does not open a second", async () => {
    const E = mkEngine();
    drawStroke(E, [[60, 60], [340, 240]], 24);
    await paint(E);
    const rep = rasterPerf.report();
    const rows = rep.frames.filter((r) => r.kind === "render");
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[rows.length - 1];
    expect(row.timers["eng.list"]).toBeGreaterThan(0);      // written, by `KobinEngine._render`
    expect(row.timers["eng.list"]).toBeLessThanOrEqual(row.mainMs);
    // The row `render` writes into is the one the engine opened. A second `beginFrame` inside
    // `render` would close the engine's row as TRUNCATED and leave the list build in a row of
    // its own — with every other assertion in this file still green.
    expect(rep.meta.unclosed).toBe(0);
    expect(rep.frames.every((r) => !r.flags || !r.flags.includes("truncated"))).toBe(true);
});
