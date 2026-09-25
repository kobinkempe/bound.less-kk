/**
 * raster.engine.test.js — stage 5b's own suite (RASTERISER-PLAN §9.2's E series and §10 stage
 * 5b's acceptance).
 *
 * **At the stage's CHECKPOINT this file holds the strip/beginJob/epochs seam alone** — §15.3's
 * MUST of 13:20, written before the checkpoint by its own ruling (Q13) — and E1–E8, the two
 * counters and §8.4 rule 2 are the continuation's.
 *
 * Nothing here measures a picture: jsdom's `getContext` is null in this tree
 * (`setupTests.js:27`), so the layer is given a RECORDING context and every claim is about a
 * call sequence or a computed number. The worker pool is a TRANSPORT the test resolves by hand,
 * running the shipped `runJob` on this thread, so an arrival can be held across a document
 * change — which is the whole of the seam under test.
 */

import Camera from "../Camera";
import KobinEngine from "../KobinEngine";
import Renderer from "../Renderer";
import RasterRenderer, { rasterStats, resetRasterStats } from "./RasterRenderer";
import PlateStore, { PLATE_BYTES } from "./PlateStore";
import { pictureStats, resetPictureStats } from "./PictureLayer";
import { packJob, packStats, resetPackStats } from "./rasterPack";
import * as rasterPerf from "./rasterPerf";
import { plateKey, PLATE_PX } from "./plate";
import {
    setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient, rasterWorkerReport,
} from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import {
    drawStroke, eraseGesture, raster, rasterZ, colorAt, camShot, camRestore, frameToScreen,
} from "../__testkit__/harness";

const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };

/** A recording 2D context on a real canvas element, as `raster.picture.test.js` uses. */
function mkRec(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = {
        calls: [], fillStyle: null, imageSmoothingEnabled: null,
        setTransform(...a) { ctx.calls.push({ op: "setTransform", a }); },
        save() { ctx.calls.push({ op: "save" }); }, restore() { ctx.calls.push({ op: "restore" }); },   // the carry (§10.13)
        globalCompositeOperation: "source-over",
        fillRect(...a) { ctx.calls.push({ op: "fillRect", a }); },
        drawImage(...a) { ctx.calls.push({ op: "drawImage", a }); },
        putImageData(...a) { ctx.calls.push({ op: "putImageData", a }); },
        ops() { return ctx.calls.map((x) => x.op); },
        of(op) { return ctx.calls.filter((x) => x.op === op); },
        clear() { ctx.calls.length = 0; },
    };
    c.getContext = () => ctx;
    c.rec = ctx;
    return c;
}

function mkCam(w, h) {
    const lm = { width: w, height: h, depthOf: () => 0, frame: () => true, ensureSpine: () => "0" };
    const cam = new Camera(lm, CFG);
    cam.inScale = 1; cam.inPanX = 0; cam.inPanY = 0;
    return cam;
}

/** A square fill, in frame units, that lands inside the one visible plate. */
const fillItem = (id, x, y, s) => ({
    id, type: "fill", color: "rgb(0,0,0)", opacity: 1,
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
         * Run the shipped worker entry on this thread and deliver the result. **No
         * `receivedAt`**, so `runJob` stamps its own receipt as the shipped `onmessage` does: a
         * `receivedAt: 0` makes `job.recvToStart` the whole process uptime (4,123 ms in one run
         * of this suite) and the client's `queueingMs`, which is `wallMs − phases`, the same
         * number negative — the two cancel inside §8.4 rule 2's sum and print as nonsense.
         */
        async release() {
            const p = parked.shift();
            if (!p) return false;
            const out = await runJob(p.msg);
            p.resolve(out.msg);
            await Promise.resolve();                 // the client's own `then`
            await Promise.resolve();                 // the conversion, where there is one
            await Promise.resolve();
            return true;
        },
    };
}

const hosts = [];
function mkRenderer(opts = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cam = opts.cam || mkCam(400, 300);
    const store = opts.store || new PlateStore({ maxBytes: 16 * PLATE_BYTES, doc: null });
    const R = new (opts.klass || RasterRenderer)(host, cam, CFG, {
        width: 400, height: 300, dpr: 1, store, makeCanvas: mkRec,
        // The PLATES path: a fixture small enough to test is also light enough for §6.5's
        // synchronous path, which posts nothing at all. A zero budget can never be met.
        layerOpts: { syncBudget: 0, ...(opts.layerOpts || null) },
        ...opts.ropts,
    });
    hosts.push({ host, R });
    return { R, cam, store, host, ctx: R.layer._canvas.rec };
}

beforeEach(() => {
    resetRasterWorkerClient();
    setRasterWorkerCount(1);
    resetRasterStats(); resetPictureStats(); resetPackStats();
});
afterEach(() => {
    while (hosts.length) { const h = hosts.pop(); try { h.R.destroy(); } catch (e) { /* torn down */ } h.host.remove(); }
    setRasterTransport(null);
    resetRasterWorkerClient();
    // Every renderer built here attaches the SHIPPED `rasterPerf` (the default since the swap),
    // so the ring carries the previous test's rows unless it is freed between them.
    rasterPerf.reset();
});

/** Everything the document event of §5.4 rule 2 reaches: the whole frame. */
const EVERYWHERE = () => ({ left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 });

// ---------------------------------------------------------------------------
// The strip / beginJob / epochs seam (§15.3's MUST of 2026-09-21 13:20; §10 item 12)
// ---------------------------------------------------------------------------

test("a key dropped while its strip is in flight is re-posted ONCE, and then caches", async () => {
    // The client hands `pack(plates, jobId, pool)` a flat Int32Array while `beginJob` takes
    // objects and RETURNS the epochs; a job packed without them carries zeros, and after the
    // first drop of any key every arrival for it reads stale and is re-posted for ever.
    const gate = mkGate();
    const { R, cam, store } = mkRenderer();
    const item = fillItem(7, 20, 20, 120);

    R.render([item], cam.frame);
    const v = R.layer.view();
    const key = plateKey(v.frameId, v.q, 0, 0);
    expect(store.inflight.has(key)).toBe(true);             // one plate, one strip, one job
    expect(gate.length).toBe(1);

    // The document changes while the job is in flight. Rule 1 cannot see the plate (it is in
    // no cache and in no id set), so rule 2 is the one that reaches it — and all it can do is
    // bump the epoch, which is what D25 is for.
    store.dropRectPerFrame(EVERYWHERE);
    expect(store.epochOf(key)).toBe(1);

    await gate.release();
    expect(pictureStats.staleDrops).toBe(1);                // the arrival carried epoch 0
    expect(pictureStats.reposts).toBe(1);                   // ...and was asked for again, once
    // The re-post is a post at the `q` the frame step already posted, in a LATER task: item
    // 15's rule is one post per `q` per task, and counting this one would report ordinary
    // re-posting to stage 7 as a rule violation.
    expect(rasterStats.dupPostQ).toBe(0);
    expect(store.size()).toBe(0);
    expect(gate.length).toBe(1);                            // the re-post is in flight

    await gate.release();
    expect(pictureStats.staleDrops).toBe(1);                // the second job carried epoch 1
    expect(pictureStats.reposts).toBe(1);
    expect(store.size()).toBe(1);
    expect(store.get(key).epoch).toBe(1);
    expect(gate.length).toBe(0);

    // Every minted id was ended, and nothing is left in flight (D164).
    expect(store.inflight.size).toBe(0);
    expect(store.jobs.size).toBe(0);
    expect(rasterStats.jobsEnded).toBe(2);
    expect(rasterWorkerReport().inFlight).toBe(0);
});

test("BREAK-CHECK: with the epochs left out of the pack, the same plate is re-posted without bound", async () => {
    // The break the MUST names: `packJob`'s `opts.epochs` defaults to ZEROS, so every arrival
    // for a key that has ever been dropped reads stale, for ever, and the screen keeps a hole
    // nothing explains. Four rounds here; it does not converge.
    class NoEpochs extends RasterRenderer {
        _pack(req, strip, jobId) {
            this.store.beginJob(jobId, req, [{ i: strip[0], j: strip[1] }]);
            return packJob(this._lastList, {
                plates: strip, q: req.q, Zq: req.Zq, dpr: 1, cfg: CFG, paper: [255, 255, 255],
                jobId, frameSeq: req.frameSeq,
            });
        }
    }
    const gate = mkGate();
    const { R, cam, store } = mkRenderer({ klass: NoEpochs });
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    store.dropRectPerFrame(EVERYWHERE);

    for (let k = 0; k < 4; k++) await gate.release();
    expect(pictureStats.staleDrops).toBe(4);
    expect(pictureStats.reposts).toBe(4);
    expect(store.size()).toBe(0);
    expect(gate.length).toBe(1);                            // still asking
});

test("a clean strip caches on its first arrival, and the epochs it carried are the store's", async () => {
    const gate = mkGate();
    const { R, cam, store } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    const v = R.layer.view();
    const key = plateKey(v.frameId, v.q, 0, 0);

    await gate.release();
    expect(pictureStats.staleDrops).toBe(0);
    expect(pictureStats.reposts).toBe(0);
    expect(store.size()).toBe(1);
    expect(store.get(key).epoch).toBe(0);
    expect(store.epochOf(key)).toBe(0);
    expect(rasterStats.jobsEnded).toBe(1);
    // One job of N plates is ONE batch, which is what `onPlateBatch` exists for (D173).
    expect(rasterStats.batches).toBe(1);
    expect(pictureStats.arrivals).toBe(1);
});

// ---------------------------------------------------------------------------
// §6.5's synchronous path: composed, never cached, and on the layer canvas (§15.3 Q1)
// ---------------------------------------------------------------------------

test("a light screen rasters on this thread into the layer canvas and posts nothing", () => {
    // jsdom has no `ImageData` in this tree — which is why `plateBitmap` guards it — so the
    // suite injects the one thing the sync path needs, as it injects the 2D context. What the
    // picture LOOKS like is still stage 7's (§9.4).
    const had = global.ImageData;
    global.ImageData = function ImageDataStub(data, w, h) { this.data = data; this.width = w; this.height = h; };
    try { syncPathBody(); } finally { if (had) global.ImageData = had; else delete global.ImageData; }
});

function syncPathBody() {
    const gate = mkGate();
    // The default budget: 4 chords is light, so the layer publishes `q = "s"` at the exact zoom.
    const { R, cam, store } = mkRenderer({ layerOpts: { syncBudget: 5000, syncMaxMs: Infinity } });
    R.render([fillItem(7, 20, 20, 120)], cam.frame);

    const v = R.layer.view();
    expect(v.mode).toBe("sync");
    expect(v.q).toBe("s");
    expect(v.s).toBe(1);
    expect(gate.length).toBe(0);                            // no job, no worker, no queue
    expect(rasterWorkerReport().jobs).toBe(0);
    expect(store.size()).toBe(0);                           // ...and nothing cached (D159)
    expect(pictureStats.syncRefused).toBe(0);               // the layer was never offered one

    // The plates go into the LAYER canvas at their grid positions, and the whole surface is
    // composed as ONE entry at (i0, j0) — zero extra memory, which is what Q1 chose.
    const surface = R.layer.syncSurface();
    const put = surface.rec.of("putImageData");
    expect(rasterStats.syncPlates).toBe(put.length);
    expect(rasterStats.syncPlates).toBe((v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1));
    expect(put[0].a[1]).toBe(0);                            // plate (i0, j0) at the surface origin
    expect(put[0].a[2]).toBe(0);
    const blits = R.layer._canvas.rec.of("drawImage");
    expect(blits.length).toBe(1);
    expect(blits[0].a[0]).toBe(surface);
    expect(blits[0].a[1]).toBe(v.dx);
    expect(blits[0].a[2]).toBe(v.dy);
    expect(pictureStats.canvasAllocs).toBe(2);              // the ink canvas and the layer, and no third
    expect(rasterStats.syncNoImageData).toBe(0);
}

// ---------------------------------------------------------------------------
// The acceptance counters (§10 stage 5b), and §8.4 rule 2's closure
// ---------------------------------------------------------------------------

test("one arriving job of N plates logs ONE compose (D173)", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    // A wide screen at four plates across: one job, four plates, one batch.
    const { R, cam } = mkRenderer({ cam: mkCam(1600, 400), ropts: { perf } });
    R.render([fillItem(7, 20, 20, 1400)], cam.frame);
    expect(rasterStats.postedPlates).toBe(4);
    // Four plates, one worker: the client's own strip size is ceil(plates / (workers × 2)), so
    // this is two jobs of two — and what the counter must read is ONE compose per JOB.
    expect(rasterStats.strips).toBe(2);
    // The count `_post` predicts BEFORE the dispatch, so the queued-at can be stamped there
    // (D254), against the count `submitPlates` returned. A multi-strip post is where the two
    // would part company.
    expect(perf.strips).toBe(rasterStats.strips);
    expect(gate.length).toBe(1);                            // one in flight per worker; the second waits
    const composes = pictureStats.composes;

    await gate.release();
    expect(rasterStats.batches).toBe(1);
    expect(rasterStats.batchPlates).toBe(2);                // the job's own plates, in one call
    expect(pictureStats.arrivalComposes).toBe(1);           // ONE, whatever the plate count
    expect(pictureStats.composes).toBe(composes + 1);

    await gate.release();
    expect(rasterStats.batches).toBe(2);
    expect(rasterStats.batchPlates).toBe(4);
    expect(pictureStats.arrivalComposes).toBe(2);           // one more, not one per plate
    expect(pictureStats.composes).toBe(composes + 2);
});

test("one frame posts at most ONE submitPlates per q, and two quanta are live together (D182)", () => {
    mkGate();
    const { R, cam } = mkRenderer();
    // The settle's request is the second `q`: it is keyed "e" and carries its own Zq, so it
    // cannot ride the view's call — one `submitPlates` carries one q and one Zq for every strip.
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    expect(rasterStats.posts).toBe(1);
    const v = R.layer.view();
    R.layer._req.frameId = v.frameId;
    R.layer._req.Zq = v.Zq * 1.5;
    R.layer._req.i0 = v.i0; R.layer._req.i1 = v.i1; R.layer._req.j0 = v.j0; R.layer._req.j1 = v.j1;
    R._post(R.layer.settleRequest(), [{ i: 0, j: 0, epoch: 0, key: plateKey(v.frameId, "e", 0, 0) }], "settle");

    expect(rasterStats.posts).toBe(2);
    expect(rasterStats.dupPostQ).toBe(0);                   // never twice at one q in one frame
    expect(rasterWorkerReport().liveRequests).toBe(2);      // both live; neither dropped the other
    expect(rasterWorkerReport().queued + rasterWorkerReport().inFlight).toBe(2);
});

test("the settle's post opens a row of its own when none is live, and none inside a frame (D266)", () => {
    // Measured in Chrome on the Magnum Opus canvas: 58 notes with no row open after one load,
    // six zoom steps and a pan — every one the settle's pack and post, reached through the
    // layer's own timer, where nothing had opened a row. The largest post after a zoom was in
    // no report.
    mkGate();
    const perf = mkPerf();
    const { R, cam } = mkRenderer({ ropts: { perf } });
    R.render([fillItem(7, 20, 20, 120)], cam.frame);       // the frame's own post rides its render row
    expect(perf.rows.map((r) => r.kind)).toEqual(["render"]);
    const v = R.layer.view();
    R.layer._req.frameId = v.frameId; R.layer._req.Zq = v.Zq;
    R._post(R.layer.settleRequest(), [{ i: 0, j: 0, epoch: 0, key: plateKey(v.frameId, "e", 0, 0) }], "settle");
    expect(perf.rows.map((r) => r.kind)).toEqual(["render", "settle"]);
    const row = perf.rows[1];
    expect(row.seq).toBe(R.frameSeq);                       // the posting frame's seq: not a camera step
    expect(row.mainMs).toBeGreaterThan(0);                  // closed, in the finally
    expect(row.slots["xfer.out"]).toBeGreaterThan(0);       // the post's own bracket, in a row now
    expect(R._rowLive).toBe(false);
});

test("a strip the pump dispatches after an arrival packs inside a row of its own (D268)", async () => {
    // The client pumps its queue when a worker frees — in the arrival's task, after the arrival
    // row has closed. Measured in Chrome, every orphan note left after D266 was this pack.
    const gate = mkGate();
    const perf = mkPerf();
    const { R, cam } = mkRenderer({ ropts: { perf } });
    R.render([fillItem(7, 20, 20, 120)], cam.frame);       // one strip parked at the gate: the worker is busy
    const v = R.layer.view();
    R._post(v, [{ i: 3, j: 3, epoch: 0, key: plateKey(v.frameId, v.q, 3, 3) }], "view");
    expect(rasterWorkerReport().queued).toBe(1);            // behind the parked one
    const n = perf.rows.length;
    await gate.release();                                   // the arrival, then the pump
    expect(rasterWorkerReport().queued).toBe(0);
    expect(perf.orphans).toEqual([]);                      // names the offender when it fails
    const packed = perf.rows.slice(n).filter((r) => r.kind === "arrival" && !r.info && (r.slots["eng.pack"] || 0) > 0);
    expect(packed.length).toBe(1);                          // the pump's pack, rowed, no job on it
    expect(packed[0].seq).toBe(R.frameSeq);
    expect(R._rowLive).toBe(false);
});

test("BREAK-CHECK: a second post at the SAME q inside one frame is counted, not silently doubled", () => {
    mkGate();
    const { R, cam } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    const v = R.layer.view();
    R._post(v, [{ i: 9, j: 9, epoch: 0, key: plateKey(v.frameId, v.q, 9, 9) }], "view");
    expect(rasterStats.dupPostQ).toBe(1);
    expect(rasterWorkerReport().liveRequests).toBe(1);      // one q, one live request
});

/**
 * §8.4 rule 2's recorder, with §8.1's own slot names and its own `part` column: the shim stage 6
 * replaces. ENGINE's five, `xfer.out`, `xfer.in` and `br.blit` are MAIN; `br.bitmap` is wall.
 */
const MAIN_SLOTS = ["eng.list", "eng.settle", "eng.cull", "eng.band", "eng.pack",
    "eng.view", "eng.lookup", "ovl.tail", "xfer.out", "xfer.in", "br.blit"];
/**
 * `rasterPerf`'s SYNC half (`part: "worker"`): the core's own phases, which join `mainMs` only
 * in sync mode, where the core runs on the main thread (§8.1, `rasterPerf.js` `SYNC_PART`).
 * `eng.local` and `ras.composite` are the two structural zeros (D207); `xfer.serialise` is the
 * worker's own and is never written on this path.
 */
const SYNC_SLOTS = ["eng.clip", "eng.local", "ras.edges", "ras.union", "ras.accum",
    "ras.composite", "xfer.serialise"];
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function mkPerf() {
    const rows = [], queued = new Map();
    let open = null;
    const P = {
        rows,
        strips: 0,
        attach() {}, detach() {},
        beginFrame(seq, kind) { open = { seq, kind, t0: clock(), slots: {}, mainMs: 0, wallMs: 0, info: null }; rows.push(open); },
        endFrame() {
            if (!open) return;
            // ONE clock read for both totals, as `rasterPerf.endFrame` takes one `end` for
            // `mainMs` and hands it to `closeRow` for `wallMs` (`rasterPerf.js:308-312`). Two
            // reads would put a stray microsecond between the two totals and the wall
            // partition's identity below is asserted exactly.
            const end = clock();
            open.mainMs = end - open.t0;
            if (open.queuedAt) open.wallMs = end - open.queuedAt;       // queued → this task's end
            open = null;
        },
        orphans: [],                                                // notes with no row open, by slot (D268)
        add(slot, ms) { if (!open) { P.orphans.push(slot); return; } open.slots[slot] = (open.slots[slot] || 0) + ms; },
        // `nStrips` is the count `_post` predicts from the client's own rule BEFORE the
        // dispatch; `rasterStats.strips` is what `submitPlates` returned. The suite compares
        // them, so a prediction that drifted from the rule could not hide (D254).
        noteSubmit(req, nPlates, nStrips) { queued.set(req.frameSeq, clock()); P.strips += nStrips | 0; },
        // `xfer.in` is production's own term (`rasterPerf.js:451` fills it from `info.recvMs`),
        // so the partition demonstrated here is the one the shipped report will print.
        noteJob(info) {
            if (!open) return;
            open.info = info; open.queuedAt = queued.get(info.frameSeq) || 0;
            P.add("xfer.in", +info.recvMs || 0);
        },
        noteBitmap(ms) { P.add("br.bitmap", ms); },
        noteCompose(ms) { P.add("br.blit", ms); },
        noteDrop() {}, noteView() {},
    };
    return P;
}
const sumMain = (row) => MAIN_SLOTS.reduce((t, s) => t + (row.slots[s] || 0), 0);
const sumSync = (row) => SYNC_SLOTS.reduce((t, s) => t + (row.slots[s] || 0), 0);
const bar = (ms) => Math.max(1, 0.1 * ms);
/**
 * D237's three phases — the view mapping (`PictureLayer.frameFor`), the cache lookup
 * (`PlateStore.want`) and the SVG overlay tail (`syncWorld` → `_renderOverlays`) — were timed
 * by a wrapper in this file until §15.3's 2026-09-22 Q1 gave them the slots `eng.view`,
 * `eng.lookup` and `ovl.tail`. They are now bracketed in `RasterRenderer` itself, so what
 * closes the sum below is SHIPPED code and the wrapper is gone.
 */
const THREE = ["eng.view", "eng.lookup", "ovl.tail"];
const sumThree = (row) => THREE.reduce((t, s) => t + (row.slots[s] || 0), 0);

test("§8.4 rule 2: the main buckets sum on a frame that PACKS AND POSTS, light and dense, inside max(1 ms, 10 %)", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    const { R, cam, store } = mkRenderer({ ropts: { perf } });
    // The FIRST frame of a process is measured and reported, never asserted: every path inside
    // the bracket runs cold once — the first `packJob`, the first `renderPlate`, the first
    // canvas — and that warm-up belongs to no bucket and is not a phase.
    R.render([fillItem(6, 30, 30, 100)], cam.frame);
    await gate.release();

    /**
     * Each ASSERTED frame is invalidated first. Against one unmoving camera the second and
     * third renders are cache hits — `want` returns no miss, nothing is packed and nothing is
     * posted — so `eng.pack` and `xfer.out`, the two buckets a raster frame is about, would be
     * in no asserted row (the review of 5b, 2026-09-21). The drop bumps the key's epoch, so the
     * frame misses, `_pack` runs and the submit's own bracket is written.
     */
    const packedIn = [];
    function step(list) {
        store.dropRectPerFrame(EVERYWHERE);
        const p0 = packStats.packed;
        R.render(list, cam.frame);
        packedIn.push(packStats.packed - p0);
    }
    step([fillItem(7, 20, 20, 120)]);
    await gate.release();

    const dense = [];
    for (let k = 0; k < 60; k++) dense.push(fillItem(100 + k, 4 + (k % 20) * 18, 4 + Math.floor(k / 20) * 90, 16));
    step(dense);
    await gate.release();

    const renders = perf.rows.filter((r) => r.kind === "render");
    expect(renders.length).toBe(3);
    const label = ["cold", "light", "dense"];
    for (let k = 0; k < renders.length; k++) {
        const row = renders[k];
        const res = row.mainMs - sumMain(row);              // §8.1's list, the three new slots in it
        const without = res + sumThree(row);                // ...and what it was before they existed
        // Printed, not only asserted: a residual that is not small IS the finding (§8.4 rule 2).
        // eslint-disable-next-line no-console
        console.log("rule 2 " + label[k] + ": mainMs " + row.mainMs.toFixed(3)
            + " = buckets " + sumMain(row).toFixed(3)
            + " (pack " + (row.slots["eng.pack"] || 0).toFixed(3)
            + ", xfer.out " + (row.slots["xfer.out"] || 0).toFixed(3)
            + ", view/lookup/tail " + sumThree(row).toFixed(3) + ")"
            + " + residual " + res.toFixed(3) + "  (without the three slots " + without.toFixed(3)
            + ", bar " + bar(row.mainMs).toFixed(3) + ")");
        expect(res).toBeGreaterThan(-1e-9);                 // no bucket may exceed the task
        if (k === 0) continue;                              // the cold frame is reported, not judged
        // The row PACKED and POSTED: without these two the sum above closes on a cache hit and
        // says nothing about a raster frame.
        expect(row.slots["eng.pack"]).toBeGreaterThan(0);
        expect(row.slots["xfer.out"]).toBeGreaterThan(0);
        expect(res).toBeLessThanOrEqual(bar(row.mainMs));
    }
    // Counted, not timed: the dense frame packed its sixty items and the light one its one, so
    // the two asserted rows differ in the work they did and not only in a cull (load-free).
    expect(packedIn).toEqual([1, 60]);
    expect(rasterStats.posts).toBe(3);                      // every frame here posted, the cold one too
    // The three shipped slots are WRITTEN, not declared. What they are worth is PRINTED above
    // as "without the three slots": 0.18–0.36 ms on this machine, inside the 1 ms floor either
    // way, against the 1.35–1.96 ms of a 5.2–6.6 ms cold frame D237 measured on Kobin's.
    expect(sumThree(renders[0])).toBeGreaterThan(0);

    /**
     * The WALL half, on the arrival row that carries the job. `wallMs` is queued → the end of
     * that task; in jsdom there is no `createImageBitmap`, so the compose runs a microtask
     * later in its own row and `br.blit` there is 0 (`rasterStats.bitmapWaits`).
     *
     * **Which assertion this is**: a sanity floor, not a bound on the machine — stage 3's W2
     * precedent (§15.3, 2026-09-21 12:30). Everything between the worker's answer and the main
     * thread taking the task up used to fall in this residual, so it grew with main-thread
     * contention and not with the code, and it failed one quick-suite run in three under load.
     * The delivery gap is now MEASURED (`arrivedAt` → the row's `t0`) and named in the
     * partition, and what is asserted is the property: every part present and non-negative, the
     * residual EXACTLY this task's own unbucketed main time, and a 1e3 ms floor against a
     * clock-origin or unit bug.
     */
    const arrival = perf.rows.filter((r) => r.kind === "arrival" && r.info).pop();
    const info = arrival.info;
    const phases = info.wallMs - info.queueingMs;           // the worker's own clock (§8.2)
    const deliver = arrival.t0 - info.arrivedAt;            // the worker's answer → this task
    const queueWait = info.postedAt - arrival.queuedAt;     // `rasterPerf`'s own `queueWait`
    const parts = queueWait + phases + info.queueingMs + deliver
        + (arrival.slots["xfer.in"] || 0) + (arrival.slots["br.blit"] || 0);
    const resW = arrival.wallMs - parts;
    // eslint-disable-next-line no-console
    console.log("rule 2 wall: queued-to-task-end " + arrival.wallMs.toFixed(3) + " = queueWait "
        + queueWait.toFixed(3) + " + phases " + phases.toFixed(3) + " + queueing "
        + info.queueingMs.toFixed(3) + " + delivery " + deliver.toFixed(3) + " + xfer.in "
        + (arrival.slots["xfer.in"] || 0).toFixed(3) + " + blit "
        + (arrival.slots["br.blit"] || 0).toFixed(3) + " + residual " + resW.toFixed(3)
        + "  (mainMs " + arrival.mainMs.toFixed(3) + ", composed in a later task: "
        + (rasterStats.bitmapWaits > 0) + ")");
    for (const [name, v] of [["phases", phases], ["queueing", info.queueingMs],
        ["delivery", deliver], ["xfer.in", arrival.slots["xfer.in"] || 0],
        ["br.blit", arrival.slots["br.blit"] || 0]]) {
        expect([name, isFinite(v) && v >= -1e-9]).toEqual([name, true]);
    }
    // `queueWait` is stamped before the dispatch since D254, so a strip a free worker takes
    // inside `submitPlates` is posted AFTER its queued-at and this is a real duration, not a
    // clamp (`rasterPerf.noteJob:443` clamps a negative one and used to have to). It is
    // queued → posted and so holds THIS strip's pack, which `submitPlates` runs before it
    // posts: `eng.pack` is in the main partition and never in this one, so nothing is counted
    // twice, but a reader of the wall row must not take it for idle queueing (1.18 ms here).
    expect(queueWait).toBeGreaterThanOrEqual(0);
    // The identity: nothing unnamed is left in the residual but this task's own main time,
    // minus the two slots of it that are already parts. It is the client's own definition of
    // `wallMs` restated, so it cannot fail — which is why the MAIN half below is asserted too
    // (the third review of 5b, D255).
    const own = arrival.mainMs - (arrival.slots["xfer.in"] || 0) - (arrival.slots["br.blit"] || 0);
    expect(Math.abs(resW - own)).toBeLessThan(1e-6);
    expect(resW).toBeLessThan(1e3);                         // the sanity floor, not a bound on the machine
    // THE ARRIVAL ROW'S MAIN HALF, judged by exactly the rule the render rows are judged by.
    // The delivery gap above is the scheduler's and grows with load; this task's own unbucketed
    // main time is the code's, and nothing asserted it — `_takeResult` could have grown 50 ms of
    // it with every part of the wall sum still balancing.
    const resA = arrival.mainMs - sumMain(arrival);
    // eslint-disable-next-line no-console
    console.log("rule 2 arrival main: mainMs " + arrival.mainMs.toFixed(3) + " = buckets "
        + sumMain(arrival).toFixed(3) + " (xfer.in " + (arrival.slots["xfer.in"] || 0).toFixed(3)
        + ", blit " + (arrival.slots["br.blit"] || 0).toFixed(3) + ") + residual " + resA.toFixed(3)
        + "  (bar " + bar(arrival.mainMs).toFixed(3) + ")");
    expect(resA).toBeGreaterThan(-1e-9);
    expect(resA).toBeLessThanOrEqual(bar(arrival.mainMs));

    // THE SPLIT ARRIVAL'S OTHER HALF. With no `createImageBitmap` the conversion resolves in a
    // LATER task, and `_deliverRow` gives that compose a row of its own — kind `arrival`, no
    // job on it. Nothing judged it: `onPlateBatch` could grow 50 ms of store puts and paper
    // fills there with every assertion above still passing. It gets the render rows' own rule.
    expect(rasterStats.bitmapWaits).toBeGreaterThan(0);
    const composed = perf.rows.filter((r) => r.kind === "arrival" && !r.info).pop();
    const resC = composed.mainMs - sumMain(composed);
    // eslint-disable-next-line no-console
    console.log("rule 2 split compose: mainMs " + composed.mainMs.toFixed(3) + " = buckets "
        + sumMain(composed).toFixed(3) + " (blit " + (composed.slots["br.blit"] || 0).toFixed(3)
        + ") + residual " + resC.toFixed(3) + "  (bar " + bar(composed.mainMs).toFixed(3) + ")");
    expect(composed.slots["br.blit"]).toBeGreaterThan(0);   // the compose IS this row's work
    expect(resC).toBeGreaterThan(-1e-9);
    expect(resC).toBeLessThanOrEqual(bar(composed.mainMs));
});

test("BREAK-CHECK: unbucketed work in the ARRIVAL task breaks the main half, and the wall half cannot see it", async () => {
    const gate = mkGate();
    const perf = mkPerf();
    class SlowArrival extends RasterRenderer {
        _takeResult(req, res, info, seq) {
            const t = Date.now();
            while (Date.now() - t < 5) { /* 5 ms of main-thread work in no bucket */ }
            return super._takeResult(req, res, info, seq);
        }
    }
    const { R, cam } = mkRenderer({ klass: SlowArrival, ropts: { perf } });
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    await gate.release();

    const arrival = perf.rows.filter((r) => r.kind === "arrival" && r.info).pop();
    const inMs = arrival.slots["xfer.in"] || 0, blitMs = arrival.slots["br.blit"] || 0;
    expect(arrival.mainMs - sumMain(arrival)).toBeGreaterThan(bar(arrival.mainMs));
    // ...and the wall identity still closes to 1e-6 ms, which is why it cannot stand alone: the
    // 5 ms is in `own` on both sides of it (D255).
    const info = arrival.info;
    const parts = (info.postedAt - arrival.queuedAt) + (info.wallMs - info.queueingMs) + info.queueingMs
        + (arrival.t0 - info.arrivedAt) + inMs + blitMs;
    expect(Math.abs((arrival.wallMs - parts) - (arrival.mainMs - inMs - blitMs))).toBeLessThan(1e-6);
});

/**
 * §8.4 rule 2 on a SYNC frame — §6.5's path, and the one Kobin is on most of the time. The core
 * runs on THIS thread there, so its four phases are main-thread time (`rasterPerf` flags the row
 * `rasOnMain` from the view's mode and adds its SYNC list into the main sum). Charged to
 * `br.blit` instead, as they were until D256, RASTERISER read 0 on every light-ink frame.
 */
test("§8.4 rule 2 on a SYNC frame: the core's own four phases are inside mainMs, not in br.blit", () => {
    const had = global.ImageData;
    global.ImageData = function ImageDataStub(data, w, h) { this.data = data; this.width = w; this.height = h; };
    try { syncRule2Body(); } finally { if (had) global.ImageData = had; else delete global.ImageData; }
});

function syncRule2Body() {
    mkGate();
    const perf = mkPerf();
    const { R, cam } = mkRenderer({ layerOpts: { syncBudget: 5000, syncMaxMs: Infinity }, ropts: { perf } });
    const list = [fillItem(7, 20, 20, 120), fillItem(8, 160, 40, 60)];
    R.render(list, cam.frame);                              // cold: measured, never judged
    R.render(list, cam.frame);

    const rows = perf.rows.filter((r) => r.kind === "render");
    expect(rows.length).toBe(2);
    const row = rows[1];
    const core = sumSync(row);
    const res = row.mainMs - sumMain(row) - core;
    // eslint-disable-next-line no-console
    console.log("rule 2 sync: mainMs " + row.mainMs.toFixed(3) + " = main " + sumMain(row).toFixed(3)
        + " (blit " + (row.slots["br.blit"] || 0).toFixed(3) + ", pack "
        + (row.slots["eng.pack"] || 0).toFixed(3) + ") + core " + core.toFixed(3)
        + " (clip " + (row.slots["eng.clip"] || 0).toFixed(3) + ", edges "
        + (row.slots["ras.edges"] || 0).toFixed(3) + ", union " + (row.slots["ras.union"] || 0).toFixed(3)
        + ", accum " + (row.slots["ras.accum"] || 0).toFixed(3) + ") + residual " + res.toFixed(3)
        + "  (bar " + bar(row.mainMs).toFixed(3) + ")");
    expect(core).toBeGreaterThan(0);                        // the core's phases are WRITTEN, not declared
    expect(row.slots["eng.pack"]).toBeGreaterThan(0);       // the frame packed: a sync frame always does
    expect(res).toBeGreaterThan(-1e-9);                     // no bucket may exceed the task
    expect(res).toBeLessThanOrEqual(bar(row.mainMs));
    // The residual left is the paper fill, which runs before the core's first clock read — not
    // the rasterising, which is what `br.blit` would be holding if the loop were bracketed whole.
    expect(row.slots["br.blit"]).toBeLessThan(core);
    expect(rasterStats.syncNoImageData).toBe(0);
}

test("BREAK-CHECK: with the four core phases unwritten, the sync frame's RASTERISER reads 0", () => {
    const had = global.ImageData;
    global.ImageData = function ImageDataStub(data, w, h) { this.data = data; this.width = w; this.height = h; };
    try {
        mkGate();
        const perf = mkPerf();
        // The old shape: the four slots never written. What the report then said was that a
        // light-ink frame spends its time in the browser's compose call.
        class NoCorePhases extends RasterRenderer { _addCorePhases() { return 0; } }
        const { R, cam } = mkRenderer({ klass: NoCorePhases, layerOpts: { syncBudget: 5000, syncMaxMs: Infinity }, ropts: { perf } });
        R.render([fillItem(7, 20, 20, 120)], cam.frame);
        const row = perf.rows.filter((r) => r.kind === "render").pop();
        expect(sumSync(row)).toBe(0);                       // RASTERISER, on a frame that rastered
        // ...and the rasterising is in no bucket at all: what is left over is larger than the
        // compose call it used to be charged to.
        expect(row.mainMs - sumMain(row)).toBeGreaterThan(row.slots["br.blit"]);
    } finally { if (had) global.ImageData = had; else delete global.ImageData; }
});

// ---------------------------------------------------------------------------
// Stage 3's five hand-offs, and FC1 / FC2 / FC6 (§10 stage 5b)
// ---------------------------------------------------------------------------

test("every job id the client reports is ended, teardown included, and the pool spawned early", async () => {
    const gate = mkGate();
    const { R, cam, store } = mkRenderer();
    expect(rasterWorkerReport().spawnedLate).toBe(0);       // `ensureRasterPool` ran in the constructor (D167)

    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    await gate.release();
    expect(rasterStats.jobsEnded).toBe(1);
    expect(store.jobs.size).toBe(0);

    // A job still in flight at teardown: `destroy` reports it, so `endJob` runs and the store's
    // keys do not stay in flight for ever (D164). The drop is what makes the next render post:
    // one screen at this size is one plate, and it is a hit.
    store.dropAll();
    R.render([fillItem(8, 200, 20, 120)], cam.frame);
    const ended = rasterStats.jobsEnded;
    expect(store.inflight.size).toBeGreaterThan(0);
    R.destroy();
    expect(rasterStats.jobsEnded).toBeGreaterThan(ended);
    expect(store.inflight.size).toBe(0);
    expect(store.jobs.size).toBe(0);
});

test("abandonInFlight frees the store's keys and NOTHING else: the slot stays held (D175)", async () => {
    const gate = mkGate();
    const { R, cam, store } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    expect(store.inflight.size).toBe(1);

    R._abandon("quantum");
    expect(store.inflight.size).toBe(0);                    // the keys are free: `want` re-misses them
    expect(rasterWorkerReport().heldSlots).toBe(1);         // ...and the capacity is NOT free
    await gate.release();
    expect(rasterWorkerReport().heldSlots).toBe(0);         // released by the abandoned job's own answer
});

test("a dead quantum's queued strips are dropped with the DEAD q, never the bare form (D185)", () => {
    mkGate();
    const { R, cam } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    const live = R.layer.view().q;

    // A strip queued at a quantum the view has left, and one at the settle's "e" beside it.
    R._post({ q: live - 3, Zq: 1, frameId: R.layer.view().frameId, mode: "quantum" },
        [{ i: 0, j: 0, epoch: 0 }], "quantum");
    R._post({ q: "e", Zq: 1, frameId: R.layer.view().frameId, mode: "settle" },
        [{ i: 1, j: 0, epoch: 0 }], "settle");
    const queuedBefore = rasterWorkerReport().queued + rasterWorkerReport().inFlight;
    expect(queuedBefore).toBe(3);

    R._qWas = live - 3;                                     // that quantum was live and is not now
    R._dropDead(R.layer.view());
    expect(rasterStats.quantumDrops).toBe(1);               // ONE strip, the dead quantum's
    expect(rasterWorkerReport().queued + rasterWorkerReport().inFlight).toBe(2);   // the settle's survives
});

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
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    R.syncCameraOnly();
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(R.layer.view());                   // the object, not a copy (FC2)
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
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
    const v = R.layer.view();
    const o = R._origin();
    expect(R.world.scale).toBeCloseTo(v.k / v.dpr, 12);
    expect(R.world.translation.x).toBeCloseTo((v.tx + o.x * v.k) / v.dpr, 12);
    // The camera's own pan is what FC2 replaces: they agree only when the snap is zero.
    cam.panBy(0.5, 0);
    R.syncCameraOnly();
    const v2 = R.layer.view();
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

const engines = [];
function mkEngine(w = 400, h = 300) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    // The PLATES path. §6.5's synchronous path composes and caches NOTHING, and every test below
    // reads the cache; `0` can never be entered, because the switch's own entry test is `n < 0`.
    E.renderer.layer.syncBudget = 0;
    engines.push({ E, host });
    return E;
}
afterEach(() => {
    while (engines.length) {
        const e = engines.pop();
        try { e.E.destroy(); } catch (err) { /* torn down */ }
        e.host.remove();
    }
});

/** Let the inline jobs arrive. The client dispatches one per worker, so this runs until quiet. */
async function flush(rounds = 12) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return k + 1;
    }
    return rounds;
}
const paint = async (E) => { E._render(); return flush(); };

/** The plate pixel a CSS screen point lands on. `null` where no plate holds it. */
function pixelAt(E, sx, sy) {
    const v = E.renderer.layer.view();
    const X = Math.floor(sx * v.dpr - v.dx + v.ox), Y = Math.floor(sy * v.dpr - v.dy + v.oy);
    const i = Math.floor(X / PLATE_PX), j = Math.floor(Y / PLATE_PX);
    const e = E.plates.get(plateKey(v.frameId, v.q, i, j));
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
    const d = 1 / E.renderer.layer.view().dpr;
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
    expect(E.plates.size()).toBeGreaterThan(0);
    const d = compareGrid(E);
    expect(d.missing).toBe(0);                              // every sample is on a cached plate
    expect(d.clear).toBe(0);                                // and every disagreement is at an edge
    expect(d.band).toBeLessThan(48);                        // the band is thin: one cell row, not a picture
});

test("E1 BREAK-CHECK: the same comparison against a picture the plates were never told about", async () => {
    const E = mkEngine();
    drawStroke(E, [[60, 60], [340, 240]], 24);
    await paint(E);
    // The document changes and the plates are NOT invalidated: what the grid then reads is the
    // old picture, and the comparison that passes above fails by a wide margin.
    const puts = E.plates.report().puts;
    const real = E._drainPlates;
    E._drainPlates = function noDrain() { this._plateEvents.length = 0; return 0; };
    drawStroke(E, [[60, 240], [340, 60]], 24);
    E._render();
    await flush();
    E._drainPlates = real;
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
 * A plate is INVALIDATED when the key's epoch has moved past the record's. Under PAPER-PLAN R1 a
 * drop KEEPS the pixels as a stale hit, so `cache.has` no longer separates the two states and
 * this is what P7's assertions read.
 */
const staleAt = (E, k) => { const e = E.plates.cache.get(k); return !!e && e.epoch !== E.plates.epochOf(k); };

async function crossIn(E) {
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 600) E.zoomAt(200, 150, -1000);
    expect(E.activeLevel).toBe(1);
    return paint(E);
}

test("E2 (P7) an object drawn one crossing in drops the RETAINED plates of the frame it is not at", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const shot = camShot(E);
    const home = [...E.plates.cache.keys()];                // frame "0"'s own plates
    expect(home.length).toBeGreaterThan(0);

    await crossIn(E);
    for (const k of home) expect(E.plates.cache.has(k)).toBe(true);   // rule 5: a crossing drops nothing
    expect(E.plates.cache.size).toBeGreaterThan(home.length);         // ...and this frame's are beside them

    // A stroke drawn HERE carries a NEW id, so rule 1 (`dropById`) can see no plate that ever
    // painted it: the retained frame-"0" plates can only be reached by rule 2's mapping of the
    // footprint into EVERY frame the cache holds, which is the whole of problem 7.
    const byRect = E.plates.report().dropsByRect;
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    expect(E.plates.report().dropsByRect).toBeGreaterThan(byRect);
    for (const k of home) expect(staleAt(E, k)).toBe(true);

    // ...and the camera returns to a cache that has to raster that frame again, to the picture
    // a cold cache rasters.
    const puts = E.plates.report().puts;
    camRestore(E, shot);
    await flush();
    expect(E.plates.report().puts).toBeGreaterThan(puts);
    const warm = plateGrid(E);
    expect(compareGrid(E).clear).toBe(0);
    E.plates.dropAll();
    await paint(E);
    expect(plateGrid(E)).toBe(warm);
});

test("E2 BREAK-CHECK: with the §5.4 drain removed, the retained plates survive the edit made at the other level", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const home = [...E.plates.cache.keys()];
    await crossIn(E);

    const real = E._drainPlates;
    E._drainPlates = function noDrain() { this._plateEvents.length = 0; return 0; };
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    E._drainPlates = real;
    // the plates are there either way under R1, so what the break-check reads is the EPOCH:
    // with no drain nothing invalidated them and the compose would draw them as current ink
    for (const k of home) expect(staleAt(E, k)).toBe(false);
});

test("E2 BREAK-CHECK: a footprint mapped into the ACTIVE frame only leaves the other frame's plates stale", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const home = [...E.plates.cache.keys()];
    await crossIn(E);

    // Rule 2 minus its per-frame half: the footprint is mapped into the camera's own frame and
    // into no other, which is the mapping §5.4's table says would leave a level-0 plate holding
    // stale paper after something was drawn at level 6.
    const real = E._drawnRectIn;
    E._drawnRectIn = function activeOnly(ev, prev, frameId) {
        return String(frameId) === String(this.cam.frame) ? real.call(this, ev, prev, frameId) : null;
    };
    drawStroke(E, [[120, 120], [280, 180]], 24);
    await paint(E);
    E._drawnRectIn = real;
    for (const k of home) expect(staleAt(E, k)).toBe(false);
});

test("E2b (P7) an object edited from one crossing IN leaves both frames' plates: the ink goes from each", async () => {
    const E = mkEngine();
    drawStroke(E, [[80, 80], [320, 220]], 24);
    await paint(E);
    const shot = camShot(E);
    const home = [...E.plates.cache.keys()];
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
    for (const k of home) expect(staleAt(E, k)).toBe(true);   // ...and the other frame's plates were invalidated too

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
    const E = mkEngine(1600, 400);
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    const id = E._objs()[0].id;
    // A load emits one `reset` and no per-object event, so the drain has nothing to record and
    // `_buildList`'s seed is the only thing that can know the table these plates are painted
    // with (§15.3's 2026-09-22 Q4). The break-check below is what proves it is load-bearing.
    expect(E._footBelow.has(id)).toBe(true);
    expect(E.plates.inflight.size).toBeGreaterThan(0);       // every plate of the screen is out
    const [wx, wy] = wasAt(E), [nx, ny] = nowAt(E);
    expect(inkedAt(E, wx, wy)).toBe(null);                   // nothing cached yet

    // `Document.undo` restores a move with exactly this call, and a one-shot move is the case
    // D231 stated as open: the plate painting the OLD address is in flight, in no cache and in
    // no id set, so rule 1 cannot see it and only the old rect can bump its epoch.
    E.doc.setOffsetsById(id, [[MOVE, 0]]);
    E._render();
    await drain(gate);

    expect(pictureStats.staleDrops).toBeGreaterThan(0);      // the old-address plate was refused
    expect(inkedAt(E, wx, wy)).toBe(false);                  // ...and where it was is paper
    expect(inkedAt(E, nx, ny)).toBe(true);                   // ...and the ink is where it went
    expect(compareGrid(E).clear).toBe(0);
});

test("BREAK-CHECK: with the memo unseeded, that same plate arrives and caches the object where it no longer is", async () => {
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    const E = mkEngine(1600, 400);
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    const id = E._objs()[0].id;

    E._footBelow.clear();                                    // the memo as it was before §15.3 Q4
    E.doc.setOffsetsById(id, [[MOVE, 0]]);
    E._render();
    await drain(gate);

    const [wx, wy] = wasAt(E);
    expect(inkedAt(E, wx, wy)).toBe(true);                   // stale ink, and nothing left to drop it
    expect(compareGrid(E).clear).toBeGreaterThan(0);
});

test("a geometry move with the old footprint's plate in flight: `oldBbox` reaches the epoch", async () => {
    // The drag writes OFFSETS (`below`), so this path — `moveById`/`setGeometryById`/
    // `bakeShapeById`, every one of which carries `oldBbox` and `oldLw` — has no other test.
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    const E = mkEngine(1600, 400);
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    const id = E._objs()[0].id;

    const [wx, wy] = wasAt(E), [nx, ny] = nowAt(E);
    E.doc.moveById(id, MOVE, 0);
    E._render();
    await drain(gate);

    expect(pictureStats.staleDrops).toBeGreaterThan(0);
    expect(inkedAt(E, wx, wy)).toBe(false);
    expect(inkedAt(E, nx, ny)).toBe(true);
    expect(compareGrid(E).clear).toBe(0);
});

test("BREAK-CHECK: with `oldBbox` dropped from the event, the geometry move leaves the old plate stale", async () => {
    const doc = await oneStrokeDoc();
    const gate = mkGate();
    const E = mkEngine(1600, 400);
    E.loadDrawing(JSON.parse(JSON.stringify(doc)));
    E._render();
    const id = E._objs()[0].id;

    const real = E._drawnRectIn;
    E._drawnRectIn = function noOld(ev, prev, frameId) {
        return real.call(this, { ...ev, oldBbox: null, oldLw: 0 }, prev, frameId);
    };
    const [wx, wy] = wasAt(E);
    E.doc.moveById(id, MOVE, 0);
    E._render();
    await drain(gate);
    E._drawnRectIn = real;

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

test("E7 a family with members at fade 1 and fade 0.02: the parent is not dimmed (§4.5)", async () => {
    // A fade this deep cannot be reached from a two-stroke document without a crossing, so the
    // list is built here: `Renderer.js:579`'s rule is that a member joins the family only at
    // FULL fade, and a member under it renders under its own id (`rasterPack.renderIdOf`).
    const gate = mkGate();
    const { R, cam, store } = mkRenderer();
    const parent = { ...fillItem(1, 40, 40, 120), editId: 42 };
    // fade = (px − fadeLoPx) / (cullPx − fadeLoPx) at px = fadeTag · (Zq/dpr) / enter, so
    // 0.153 × 256 = 39.168 is a 2 % member at Zq 1.
    const faded = { ...fillItem(2, 100, 40, 120), editId: 42, fadeTag: 0.153 * CFG.enter };
    R.render([parent, faded], cam.frame);
    await gate.release();

    const v = R.layer.view();
    const at = (x, y) => {
        const e = store.get(plateKey(v.frameId, v.q, 0, 0));
        const o = ((y - v.dy + v.oy) * PLATE_PX + (x - v.dx + v.ox)) * 4;
        return e && e.pixels ? e.pixels[o] : null;
    };
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
    expect(E.plates.size()).toBeGreaterThan(0);
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
    expect(pictureStats.noContext).toBeGreaterThan(0);      // counted, never thrown (D187)
});

test("the fifth seam: the chevrons are ONE implementation, called from the SVG path (§2.5)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cam = mkCam(400, 300);
    const R = new Renderer(host, cam, CFG, { width: 400, height: 300 });
    hosts.push({ host, R });
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

/** Each timer the report prints is rounded to 3 decimals, so a sum of ~15 of them carries this. */
const MS3_SUM = 0.02;

test("the shipped rasterPerf on a SYNC frame: rasOnMain, the core inside mainMs, and 0 cache hits", () => {
    const had = global.ImageData;
    global.ImageData = function ImageDataStub(data, w, h) { this.data = data; this.width = w; this.height = h; };
    try {
        mkGate();
        const { R, cam } = mkRenderer({ layerOpts: { syncBudget: 5000, syncMaxMs: Infinity } });   // no `perf`: the real module
        const list = [fillItem(7, 20, 20, 120), fillItem(8, 160, 40, 60)];
        R.render(list, cam.frame);                          // cold: measured, never judged
        R.render(list, cam.frame);

        const rep = rasterPerf.report();
        const rows = rep.frames.filter((r) => r.kind === "render");
        expect(rows.length).toBe(2);
        const row = rows[1];
        const sum = (names) => names.reduce((n, s) => n + (row.timers[s] || 0), 0);
        const core = sum(rep.slots.parts.worker);
        expect(row.mode).toBe("sync");
        expect(row.flags).toContain("rasOnMain");           // set from the view's mode, in the ring
        expect(core).toBeGreaterThan(0);                    // RASTERISER, on the frame §6.5 is about
        // The module's own residual is `mainMs` less BOTH lists — which is the whole of what the
        // `rasOnMain` flag buys, and it is asserted here against the two published lists.
        const res = row.mainMs - sum(rep.slots.parts.main) - core;
        // Printed as the recorder's rows are, so a failure under load carries its own numbers.
        // eslint-disable-next-line no-console
        console.log("rule 2 sync (shipped): mainMs " + row.mainMs.toFixed(3) + " = main "
            + sum(rep.slots.parts.main).toFixed(3) + " + core " + core.toFixed(3) + " + residual "
            + row.residualMainMs.toFixed(3) + "  (blit " + (row.timers["br.blit"] || 0).toFixed(3)
            + ", bar " + Math.max(1, 0.1 * row.mainMs).toFixed(3) + ", flags " + (row.flags || []).join("/") + ")");
        expect(Math.abs(res - row.residualMainMs)).toBeLessThan(MS3_SUM);
        expect(row.residualMainMs).toBeGreaterThan(-1e-9);
        expect(row.residualMainMs).toBeLessThanOrEqual(Math.max(1, 0.1 * row.mainMs));
        expect(row.timers["br.blit"]).toBeLessThan(core);   // the compose call, not the rastering
        // §15.3 Q8: a sync frame caches nothing, so it reports NO cache hits; what it rastered is
        // `rasterStats.syncPlates`. Zero counts are omitted from a row, so `hits` is absent.
        expect(row.counts.hits || 0).toBe(0);
        expect(rasterStats.syncPlates).toBeGreaterThan(0);
        expect(R.report().syncPlates).toBe(rasterStats.syncPlates);
        // D272: the layer was handed the core's measure (the report's timers are rounded to 3 places).
        expect(R.layer._syncMs).toBeGreaterThan(0);
        expect(Math.abs(R.layer._syncMs - core)).toBeLessThan(0.01);
    } finally { if (had) global.ImageData = had; else delete global.ImageData; }
});

test("attach hands rasterPerf SEVEN sources: pack, core, ants and worker are not null", () => {
    // With the three the shim was called with, `report().pack`, `.core`, `.ants` and `.worker`
    // all ship null and §10 stage 6's items 3 and 4 are unmet (stage 6's H1, D210). The suite
    // for stage 6 cannot catch this: it injects all six itself.
    mkGate();
    const { R, cam } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);
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

test("R2: a prio-0 request's strip dispatches ahead of queued prio-1 strips, and its quantum is alive at dispatch", async () => {
    const gate = mkGate();
    const { R, cam } = mkRenderer();
    R.render([fillItem(7, 20, 20, 120)], cam.frame);              // one strip parked at the gate
    const v = R.layer.view();
    const packed = [];
    const orig = R._pack.bind(R);
    R._pack = (req, strip, jobId, pool) => { packed.push(String(req.q)); return orig(req, strip, jobId, pool); };
    // Six more view plates: with one worker they queue as prio-1 strips behind the parked one.
    R._post(v, [3, 4, 5, 6, 7, 8].map((i) => ({ i, j: 3, epoch: 0, key: plateKey(v.frameId, v.q, i, 3) })), "view");
    // ...then the preview, aimed 8 quanta below the view's, posted at prio 0.
    R.layer._aimPreview(Number(v.q), v.frameId);
    const p = R.layer.previewRequest();
    R._post(p, [{ i: 0, j: 0, epoch: 0, key: plateKey(v.frameId, p.q, 0, 0) }], "preview");
    expect(rasterWorkerReport().queued).toBeGreaterThanOrEqual(2);
    const refused = rasterStats.refusedAtDispatch;
    await gate.release();                                           // the parked job answers; the pump picks next
    expect(packed[packed.length - 1]).toBe(String(p.q));            // the preview, not the view's next strip
    expect(rasterStats.refusedAtDispatch).toBe(refused);            // `prevQ` is alive to `_stillWanted`
});
