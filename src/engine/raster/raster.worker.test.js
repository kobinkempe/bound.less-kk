/**
 * raster.worker.test.js — stage 3 of RASTERISER-PLAN §10: the worker entry, the pool and the one
 * strip queue. W1–W21, run through BOTH delivery paths — a transport stub standing in for the
 * pool, and the inline fallback jsdom always takes — because the acceptance is that they draw the
 * same pixels and report the same numbers. W18 and W19 came out of the stage's review: the
 * `self.onmessage` entry and its transfer list had no test at all, and an abandoned job's worker
 * was being handed a second job while it was still drawing the first (§3.5). W20 and W21 are the
 * per-`q` drop rules 5b builds on (D182): what a newer frame drops, and what only the caller can.
 *
 * Three of these are the stage's own acceptance and are here rather than at stage 6, because they
 * constrain the wire format: X6 (the worker returns DURATIONS and the main thread owns every
 * absolute time, §8.2), the seven `guards` words reset per job and carried back (§3.4), and the
 * RGBA scratch copied out before the next plate is drawn (§3.5).
 *
 * W14 is stage 4's handoff: every job id the client mints reaches the caller, so `endJob` can be
 * called for each, and W17 is 5a's: a raw-pixel plate becomes a bitmap before the store sees it.
 * jsdom takes neither real delivery path — no `createImageBitmap`, no transfer — so W4's and
 * W17's bitmap halves run against a stub and both real paths stay on stage 7's list (§9.2).
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { wireJob, unwireResult, GUARD_NAMES, COUNT_NAMES, GUARDS_PER_JOB, TIMINGS_PER_PLATE, COUNTS_PER_PLATE } from "./rasterJob";
import { runJob } from "../worker/rasterWorker";
import * as client from "./rasterWorkerClient";
import { Loop } from "../geometry/loop";

const TW = core.TW, TH = core.TH;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25, fatWidthPx: 4000 };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A shape item in the `geometry/loop.js` grammar; white ink on black paper, as every raster suite. */
function shapeItem(id, rings, extra) {
    const loops = rings.map((ring) => {
        const nums = [ring[0][0], ring[0][1]];
        for (let i = 1; i < ring.length; i++) nums.push(0, ring[i][0], ring[i][1]);
        return new Loop(Float64Array.from(nums));
    });
    return Object.assign({ type: "shape", id, loops, color: "#ffffff", opacity: 1 }, extra);
}
const fillItem = (id, polys, extra) => Object.assign({ type: "fill", id, polys, color: "#ffffff", opacity: 1 }, extra);

function packStrip(list, plates, opts) {
    return pack.packJob(list, Object.assign(
        { plates: Int32Array.from(plates), q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [0, 0, 0] }, opts));
}
/** One plate drawn by the core directly — the reference the worker's pixels must equal. */
function reference(job, p) {
    const out = new Uint8ClampedArray(TW * TH * 4);
    core.renderPlate(job, p, out, new Uint32Array(COUNTS_PER_PLATE));
    return out;
}
const same = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};
const ink = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) n += px[i]; return n; };
const flush = (ms) => new Promise((r) => setTimeout(r, ms || 0));
async function until(cond, tries) {
    for (let k = 0; k < (tries || 200); k++) { if (cond()) return true; await flush(1); }
    return cond();
}

/** Two plates side by side, each with ink of its own so they cannot be confused. */
function twoPlateJob() {
    return packStrip([
        shapeItem(1, [rect(40, 40, 400, 300)]),
        fillItem(2, [rect(PLATE_X(1) + 60, 120, PLATE_X(1) + 380, 460)]),
    ], [0, 0, 1, 0]);
}
const PLATE_X = (i) => i * TW;

beforeEach(() => {
    pack.clearPackCaches();
    pack.resetPackStats();
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
    client.resetRasterWorkerClient();
    client.setRasterTransport(null);
});
afterEach(() => {
    client.resetRasterWorkerClient();
    client.setRasterTransport(null);
});

describe("the worker entry (§3.3, §3.4, §3.5)", () => {
    test("W1 both delivery paths draw the core's own pixels, plate for plate", async () => {
        const job = twoPlateJob();
        expect(job.nItems).toBe(2);
        const ref = [reference(job, 0), reference(job, 1)];
        expect(ink(ref[0])).toBeGreaterThan(0);
        expect(ink(ref[1])).toBeGreaterThan(0);
        expect(same(ref[0], ref[1])).toBe(false);

        const out = unwireResult((await runJob(wireJob(job).msg)).msg);
        expect(out.pixels).not.toBe(null);                 // jsdom has no createImageBitmap: the copy path
        expect(out.bitmaps).toBe(null);
        for (let p = 0; p < 2; p++) expect(same(out.pixels[p], ref[p])).toBe(true);
        expect(Array.from(out.plates)).toEqual([0, 0, 1, 0]);
        expect(out.G).toBe(job.G);                         // the job's generation, back unchanged (A2 §3.1)
        expect(out.counts.length).toBe(COUNTS_PER_PLATE * 2);
        expect(out.timings.length).toBe(TIMINGS_PER_PLATE * 2);

        // and the same plates through the client's own dispatch, which is what stage 5b calls.
        // Inline is one worker, so two plates are two strips of one — and each carries its own
        // plate pair, which is how the caller knows what it was handed.
        const got = [];
        const strips = client.submitPlates({
            frameSeq: 1, q: 0, Zq: 1, plates: Int32Array.from([0, 0, 1, 0]),
            pack: (plates) => packStrip([
                shapeItem(1, [rect(40, 40, 400, 300)]),
                fillItem(2, [rect(PLATE_X(1) + 60, 120, PLATE_X(1) + 380, 460)]),
            ], plates),
            onResult: (res) => got.push(res),
        });
        expect(strips).toBe(2);
        expect(await until(() => got.length === 2)).toBe(true);
        for (const res of got) {
            for (let p = 0; p * 2 < res.plates.length; p++) {
                expect(same(res.pixels[p], ref[res.plates[p * 2]])).toBe(true);
            }
        }
    });

    test("W2 X6 — the worker returns durations only, and the queueing subtraction is the main thread's", async () => {
        const job = twoPlateJob();
        const runs = [];
        for (const origin of [0, 1e6]) {                   // a pool spawned twenty minutes ago (§8.2)
            const clock = { now: () => performance.now() + origin };
            const res = unwireResult((await runJob(wireJob(twoPlateJob()).msg, { clock, receivedAt: clock.now() })).msg);
            runs.push(res);
            for (let p = 0; p < 2; p++) {
                const t = p * TIMINGS_PER_PLATE;            // the stride is the constant, never a 7
                expect(res.timings[t]).toBeGreaterThanOrEqual(0);
                expect(res.timings[t + 1]).toBeGreaterThan(0);
                // an absolute stamp on this clock is ≥ 1e6; a duration here is milliseconds
                expect(res.timings[t]).toBeLessThan(1e5);
                expect(res.timings[t + 1]).toBeLessThan(1e5);
            }
            expect(res.serialiseMs).toBeLessThan(1e5);
        }
        // the phases partition the worker's own time, so nothing can hide in a gap. Slots 0 and 1
        // of each plate's stride are the two the worker's own clock owns (§8.2).
        const total = (r) => r.serialiseMs + r.timings[0] + r.timings[1]
            + r.timings[TIMINGS_PER_PLATE] + r.timings[TIMINGS_PER_PLATE + 1];
        expect(total(runs[0])).toBeGreaterThan(0);
        // A SANITY bound, not a measurement: what it catches is an absolute stamp reported as a
        // duration, which on this clock is 1e6 ms out — two orders over this floor. The floor is
        // 1e4 and not the work's own size because the run-to-run spread IS the machine: beside a
        // full quick suite the two totals differ by 1.9, 2.2, 14.2, 36.0 and 152.5 ms on five runs,
        // so the 4 ms floor this replaces failed 2 quick runs in 3 and a 60 ms one failed 1 in 3.
        // The origin itself is asserted EXACTLY, and load-free, on the counting clock below.
        expect(Math.abs(total(runs[0]) - total(runs[1]))).toBeLessThan(Math.max(1e4, total(runs[0])));

        // the partition itself, measured on the caller's own clock: Σ recvToStart + Σ
        // startToFinish + serialise IS receipt-to-post, the tail after the last plate included.
        // A phase left in no bucket would come back as queueing on the main thread (§8.2).
        const t0 = performance.now();
        const part = unwireResult((await runJob(wireJob(twoPlateJob()).msg, { receivedAt: t0 })).msg);
        const elapsed = performance.now() - t0;
        expect(total(part)).toBeLessThanOrEqual(elapsed + 0.5);
        expect(total(part)).toBeGreaterThan(elapsed - 5);     // 5 ms for the await's own turn

        // and the partition EXACTLY, on a clock that counts its calls instead of telling the time:
        // one tick at receipt, three a plate (start, drawn, serialised) and one for the tail, so the
        // three phases must sum to last − first with nothing left over. The wall-clock bound above
        // cannot do this — its 5 ms of slack is wider than the whole serialise phase of two plates,
        // measured: reporting `serialiseMs = 0` left this test green until this assertion was added.
        let tick = 0;
        const counting = { now: () => ++tick };
        const exact = unwireResult((await runJob(
            wireJob(twoPlateJob()).msg, { clock: counting, receivedAt: counting.now() })).msg);
        expect(tick).toBe(8);                                 // 1 + 3 × 2 plates + 1
        expect(total(exact)).toBe(tick - 1);                  // receipt-to-post, in three buckets

        // and the ORIGIN on that same clock, which is X6 itself with the machine taken out of it:
        // 1e6 + the same ticks, so every reported number is a difference and must come back
        // BIT-IDENTICAL to the run above. An absolute stamp in any slot reads 1e6 here.
        let tickOff = 0;
        const countingOffset = { now: () => 1e6 + (++tickOff) };
        const exactOff = unwireResult((await runJob(
            wireJob(twoPlateJob()).msg, { clock: countingOffset, receivedAt: countingOffset.now() })).msg);
        expect(tickOff).toBe(8);
        // slots 0 and 1 of each stride and `serialiseMs` are this clock's; the rest of the stride
        // is `renderPlate`'s own sub-timings on the real one, which is why this is not the array
        const owned = (r) => [r.timings[0], r.timings[1],
            r.timings[TIMINGS_PER_PLATE], r.timings[TIMINGS_PER_PLATE + 1], r.serialiseMs];
        expect(owned(exactOff)).toEqual(owned(exact));
        expect(owned(exactOff)).toEqual([1, 1, 1, 1, 3]);  // 4 + 3 = 7 = tick − 1
        expect(total(exactOff)).toBe(tickOff - 1);

        // through the client, with the worker's clock 1e6 ms ahead: `queueingMs` is the main
        // thread's own wall minus the worker's phases, so the offset cannot reach it
        const seen = [];
        const delayMs = 25;
        client.setRasterTransport(async (msg) => {
            await flush(delayMs);
            const clock = { now: () => performance.now() + 1e6 };
            return (await runJob(msg, { clock, receivedAt: clock.now() })).msg;
        });
        client.setRasterWorkerCount(1);
        client.submitPlates({
            frameSeq: 1, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (plates) => packStrip([shapeItem(1, [rect(40, 40, 400, 300)])], plates),
            onResult: (res, info) => seen.push(info),
        });
        expect(await until(() => seen.length === 1)).toBe(true);
        expect(seen[0].wallMs).toBeGreaterThanOrEqual(delayMs - 2);
        expect(seen[0].queueingMs).toBeGreaterThan(0);
        expect(seen[0].queueingMs).toBeLessThan(seen[0].wallMs);
        expect(seen[0].arrivedAt).toBeGreaterThan(seen[0].postedAt);
        expect(seen[0].arrivedAt).toBeLessThan(1e6);       // the main thread's clock, not the worker's
        expect(job.nItems).toBe(2);
    });

    test("W3 the seven guards are the JOB's, reset when it is taken, and both losses are visible", async () => {
        // the wire order is `rasterJob`'s names and the core's own keys, or a rename permutes the
        // report's columns with every suite green
        expect(GUARD_NAMES).toEqual(Object.keys(core.coreStats));
        expect(GUARD_NAMES.length).toBe(GUARDS_PER_JOB);

        // one union item of 8,200 ribbons inside one pixel row: 16,400 union edges, which is past
        // the 16,384 the buffer holds, so the row is walked again (§3.5, D49, F75)
        const rings = [];
        for (let i = 0; i < 8200; i++) { const x = 5 + (i % 500) * 0.8; rings.push(rect(x, 200, x + 0.2, 200.75)); }
        const job = packStrip([fillItem(3, rings)], [0, 0]);
        expect(job.meta[6] & 4).toBe(4);                   // routed to the union pass
        // and a non-finite coordinate written into the PACKED numbers, which is the case the guard
        // is for: the packer rejects such an item at its own gate (§3.5), so the only way one
        // reaches the core is a wire or a packer defect — and `nonFinite` is what says so
        job.geom[10] = NaN;

        const res = unwireResult((await runJob(wireJob(job).msg)).msg);
        const g = {};
        GUARD_NAMES.forEach((n, i) => { g[n] = res.guards[i]; });
        expect(res.guards.length).toBe(GUARDS_PER_JOB);
        expect(g.unionRefills).toBeGreaterThan(0);
        expect(g.nonFinite).toBeGreaterThan(0);
        expect(g.arcOverTurn).toBe(0);

        // the next job's guards are its own: the core's counters are module-level and the worker
        // zeroes them when it takes a job
        const clean = unwireResult((await runJob(wireJob(packStrip([shapeItem(4, [rect(20, 20, 200, 200)])], [0, 0])).msg)).msg);
        expect(Array.from(clean.guards)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    test("W4 the RGBA scratch is copied out before the next plate is drawn (§3.5)", async () => {
        const job = twoPlateJob();
        const ref = [reference(job, 0), reference(job, 1)];

        // the copy path: two plates of one strip must not be the same bytes
        const copied = unwireResult((await runJob(wireJob(twoPlateJob()).msg)).msg);
        expect(same(copied.pixels[0], copied.pixels[1])).toBe(false);
        expect(same(copied.pixels[0], ref[0])).toBe(true);

        // the bitmap path, with a `createImageBitmap` that resolves on a LATER turn and reads the
        // ImageData it was handed when it does — an ImageData aliases the scratch (§3.5), so a
        // worker that starts plate 1 before this resolves hands back plate 1's pixels twice
        const madeAt = [];
        global.ImageData = class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
        global.createImageBitmap = async (img) => {
            await flush(0);
            const snap = img.data.slice();
            madeAt.push(snap);
            return { width: img.width, height: img.height, close() { this.width = 0; } };
        };
        try {
            const res = unwireResult((await runJob(wireJob(twoPlateJob()).msg)).msg);
            expect(res.pixels).toBe(null);
            expect(res.bitmaps.length).toBe(2);
            expect(madeAt.length).toBe(2);
            expect(same(madeAt[0], ref[0])).toBe(true);
            expect(same(madeAt[1], ref[1])).toBe(true);
        } finally {
            delete global.createImageBitmap;
            delete global.ImageData;
        }
    });

    test("W5 an empty plate is never allocated (§3.4)", async () => {
        const job = packStrip([shapeItem(1, [rect(40, 40, 400, 300)])], [0, 0, 5, 5]);
        const res = unwireResult((await runJob(wireJob(job).msg)).msg);
        expect(Array.from(res.plates)).toEqual([0, 0, 5, 5]);
        expect(res.pixels[0]).not.toBe(null);
        expect(res.pixels[1]).toBe(null);
        expect(res.counts[COUNTS_PER_PLATE + 1]).toBe(0);              // nothing drawn on plate 1
        expect(res.counts[1]).toBe(1);
    });

    test("W18 the entry itself: the result is posted WITH its transfer list, and a throw posts raster-error", async () => {
        // This is the code that actually runs in the browser, and jsdom takes neither real path:
        // the entry installs itself only where there is no `window`, so every other test calls
        // `runJob` directly and these lines are never reached. Here the module is re-required with
        // `window` undefined and a recording `self` in its place. §3.4: the transfer list is part
        // of the format, not an optimisation — a post without it copies 1.05 MB a plate and every
        // other assertion in this file still passes.
        // The half that protects the app, first and before any global surgery: with a `window`
        // the entry must NOT install. `rasterWorkerClient.js` imports `runJob` from this module,
        // so it is evaluated on the main thread in the webpack bundle — an install there would
        // replace `window.onmessage` and answer every page-level post with a `raster-error`.
        // jsdom's `self` IS `window` — the same object under two names, so an install would show
        // here — and `window.onmessage` is null until something assigns one. (`window`, not the
        // bare `self` the entry reads: eslint's no-restricted-globals is right about it here.)
        expect(typeof window.onmessage).not.toBe("function");

        const posts = [];
        const fakeSelf = { postMessage: (msg, transfer) => posts.push({ msg, transfer }) };
        const hadWindow = Object.getOwnPropertyDescriptor(global, "window");
        const hadSelf = Object.getOwnPropertyDescriptor(global, "self");
        const put = (k, v) => Object.defineProperty(global, k, { value: v, configurable: true, writable: true });
        const restore = (k, d) => (d ? Object.defineProperty(global, k, d) : delete global[k]);
        try {
            put("window", undefined);
            put("self", fakeSelf);
            jest.resetModules();
            require("../worker/rasterWorker");          // installs `self.onmessage`
            restore("window", hadWindow);               // the handler reads `self`, never `window`
            expect(typeof fakeSelf.onmessage).toBe("function");

            const job = twoPlateJob();
            job.jobId = 77; job.frameSeq = 9;
            const before = performance.now();
            fakeSelf.onmessage({ data: wireJob(job).msg });
            expect(await until(() => posts.length === 1)).toBe(true);
            const elapsed = performance.now() - before;

            const { msg, transfer } = posts[0];
            expect(msg.kind).toBe("raster-result");
            expect(msg.jobId).toBe(77);
            expect(msg.frameSeq).toBe(9);
            expect(transfer.length).toBeGreaterThan(0);
            // every entry is a BUFFER and not a view: a typed array is not transferable, and a
            // post that lists one throws in a real worker where jsdom would never notice
            for (const b of transfer) {
                expect(typeof b.byteLength).toBe("number");
                expect(b.buffer).toBe(undefined);
            }
            // the two the wire cannot afford to lose: a plate's 1.05 MB of pixels, and the job's
            // own buffers going back to the main thread's pool (§3.6)
            for (const px of msg.pixels) if (px) expect(transfer).toContain(px.buffer);
            expect(msg.pixels.filter(Boolean).length).toBe(2);
            expect(msg.recycled.length).toBe(6);                   // geom, meta, attr, subs, rgb, ids
            for (const r of msg.recycled) expect(transfer).toContain(r.buffer);
            // and nothing else and nothing missing: the four small arrays of §3.4 (plates,
            // timings, counts, guards), a buffer a painted plate, and the job's own six going back
            expect(transfer.length).toBe(4 + 2 + 6);

            // the `receivedAt` stamp is the WORKER's own clock and a duration comes out of it: an
            // epoch stamp (`Date.now`) would make this hugely negative, and it cannot exceed the
            // call it was taken inside (§8.2).
            expect(msg.timings[0]).toBeGreaterThanOrEqual(0);
            expect(msg.timings[0]).toBeLessThanOrEqual(elapsed + 0.5);

            // a job the wire mangled: the entry turns the throw into one message for that job and
            // the worker stays alive. W13 consumes this message; nothing made one until now.
            const bad = wireJob(twoPlateJob()).msg;
            bad.jobId = 78; bad.frameSeq = 9;
            bad.plates = Int32Array.from([0]);          // not [i, j, …]: `validateJob` throws
            fakeSelf.onmessage({ data: bad });
            expect(await until(() => posts.length === 2)).toBe(true);
            expect(posts[1].msg.kind).toBe("raster-error");
            expect(posts[1].msg.jobId).toBe(78);
            expect(posts[1].msg.frameSeq).toBe(9);
            expect(posts[1].msg.err).toContain("plates");
            expect(posts[1].transfer).toBe(undefined);
        } finally {
            restore("window", hadWindow);
            restore("self", hadSelf);
            jest.resetModules();
        }
    });
});

describe("the pool, the queue and the drops (§3.6, §8.4)", () => {
    test("W7 the strip size is ceil(plates / (workers × 2)), and one queue feeds every free worker", async () => {
        expect(client.stripSizeFor(15, 4)).toBe(2);
        expect(client.stripSizeFor(24, 4)).toBe(3);
        expect(client.stripSizeFor(12, 2)).toBe(3);
        expect(client.stripSizeFor(1, 4)).toBe(1);

        // two "workers": one strip is slow, and the other slot takes the rest — which is the
        // whole reason for one queue rather than a strip per worker (§3.6). The slow strip's
        // 600 ms is an order of magnitude over the other three's serialised chain, which is what
        // "last" is measured against: beside a full quick suite that chain finishes at 43.6–60.0 ms
        // against the 60 ms this used to wait, and overtook it in 2 quick runs of 3.
        let live = 0, peak = 0;
        const order = [];
        client.setRasterWorkerCount(2);
        client.setRasterTransport(async (msg) => {
            live++; peak = Math.max(peak, live);
            await flush(msg.plates[0] === 0 ? 600 : 2);
            live--;
            order.push(msg.plates[0]);
            return (await runJob(msg)).msg;
        });
        const plates = [];
        for (let i = 0; i < 12; i++) plates.push(i, 0);
        const done = [];
        const strips = client.submitPlates({
            frameSeq: 3, q: 0, Zq: 1, plates: Int32Array.from(plates),
            pack: (p) => packStrip([shapeItem(1, [rect(10, 10, 100, 100)])], p),
            onResult: (res, info) => done.push(info),
        });
        expect(strips).toBe(4);                                         // 12 plates, 2 workers → 3 a strip
        expect(await until(() => done.length === 4, 2000)).toBe(true);  // polls, not ms: 600 ms needs ≈ 600
        expect(peak).toBe(2);                                           // in flight capped at one per worker
        expect(order[order.length - 1]).toBe(0);                        // the slow strip finished last
        expect(done.reduce((n, i) => n + i.plates.length / 2, 0)).toBe(12);
    });

    test("W8 a strip superseded while it waited is dropped BEFORE it is packed (§8.4 rule 4)", async () => {
        let packed = 0;
        const drops = [];
        client.setRasterWorkerCount(1);
        client.setRasterTransport(async (msg) => { await flush(30); return (await runJob(msg)).msg; });
        const mk = (frameSeq) => ({
            frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0, 1, 0, 2, 0, 3, 0]),
            pack: (p, jobId) => { packed++; return packStrip([shapeItem(1, [rect(10, 10, 100, 100)])], p, { jobId }); },
            onDrop: (d) => drops.push(d),
            onResult: () => {},
        });
        expect(client.submitPlates(mk(1))).toBe(2);                     // 4 plates, 1 worker → 2 a strip
        await flush(0);
        expect(packed).toBe(1);                                         // one dispatched, one waiting
        client.submitPlates(mk(2));
        expect(drops.length).toBe(1);
        expect(drops[0].why).toBe("frame");
        expect(drops[0].before).toBe(true);
        expect(drops[0].jobId).toBe(null);                              // never packed, so never begun
        expect(packed).toBe(1);

        // and the store's own answer at dispatch time: a strip it no longer wants costs no pack
        const kept = [];
        client.submitPlates({
            frameSeq: 3, q: 0, Zq: 1, plates: Int32Array.from([9, 9]),
            stillWanted: () => false,
            pack: () => { packed++; return null; },
            onDrop: (d) => kept.push(d),
            onResult: () => {},
        });
        expect(await until(() => kept.length === 1, 300)).toBe(true);
        expect(kept[0].why).toBe("stale");
        expect(kept[0].before).toBe(true);
    });

    test("W10 the job's buffers come back and the pool fills them next time (§3.6)", async () => {
        const done = [];
        const req = (frameSeq) => ({
            frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (p, jobId, pool) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId, pool }),
            onResult: (res, info) => done.push(info),
        });
        client.submitPlates(req(1));
        expect(await until(() => done.length === 1)).toBe(true);
        const after = client.rasterWorkerReport();
        expect(after.pool.takes).toBeGreaterThan(0);
        expect(after.pool.bytes).toBeGreaterThan(0);                    // the worker gave them back

        client.submitPlates(req(2));
        expect(await until(() => done.length === 2)).toBe(true);
        expect(client.rasterWorkerReport().pool.hits).toBeGreaterThan(0);
        expect(done[1].bytesOut).toBeGreaterThan(0);
        expect(done[1].bytesIn).toBeGreaterThan(done[1].bytesOut);      // a plate is 1.05 MB coming back
    });

    test("W11 onerror marks the pool broken for the session, and the strip is finished inline", async () => {
        const made = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(2);
            expect(client.ensureRasterPool()).toBe(2);
            expect(made[0].url).toContain("/raster-worker.js");
            expect(client.rasterWorkerReport().mode).toBe("workers");

            const drops = [], got = [];
            client.submitPlates({
                frameSeq: 1, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
                onDrop: (d) => drops.push(d),
                onResult: (res) => got.push(res),
            });
            expect(made[0].posted.length).toBe(1);
            const jobId = made[0].posted[0].jobId;

            made[0].onerror({ preventDefault() {} });                   // the script did not load
            expect(client.rasterWorkerReport().broken).toBe(true);
            expect(made[0].dead).toBe(true);
            expect(drops.length).toBe(1);
            expect(drops[0].jobId).toBe(jobId);                         // endJob's own case (stage 4)
            expect(drops[0].why).toBe("worker");

            expect(await until(() => got.length === 1, 300)).toBe(true);
            expect(ink(got[0].pixels[0])).toBeGreaterThan(0);           // re-packed and drawn inline
            expect(client.rasterWorkerReport().mode).toBe("inline");
            expect(made.length).toBe(2);                                // no worker spawned after it broke
        } finally {
            delete global.Worker;
        }
    });

    test("W11b after a worker has answered, an error replaces the pool MAX_RESPAWNS times, then the session goes inline (RW-1)", async () => {
        const made = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const got = [];
            const req = (frameSeq) => ({
                frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
                onResult: (res) => got.push(res),
            });
            client.submitPlates(req(1));
            made[0].onmessage({ data: (await runJob(made[0].posted[0])).msg });   // it answers: the script loads
            expect(await until(() => got.length === 1)).toBe(true);
            for (let k = 1; k <= client.MAX_RESPAWNS; k++) {
                const w = made[made.length - 1];
                client.submitPlates(req(k + 1));
                w.onerror({ preventDefault() {} });
                expect(w.dead).toBe(true);
                expect(client.rasterWorkerReport().broken).toBe(false);          // red before: broken at the first
                expect(client.rasterWorkerReport().respawns).toBe(k);
                const w2 = made[made.length - 1];
                expect(w2).not.toBe(w);
                expect(w2.posted.length).toBe(1);                               // the strip, re-packed onto the new pool
                w2.onmessage({ data: (await runJob(w2.posted[0])).msg });
                expect(await until(() => got.length === k + 1)).toBe(true);
            }
            const last = made[made.length - 1];
            client.submitPlates(req(99));
            last.onerror({ preventDefault() {} });
            expect(client.rasterWorkerReport().broken).toBe(true);              // out of respawns
            expect(await until(() => got.length === client.MAX_RESPAWNS + 2, 300)).toBe(true);   // finished inline
            expect(client.rasterWorkerReport().mode).toBe("inline");
        } finally {
            delete global.Worker;
        }
    });

    test("W11c a job silent past WATCHDOG_MS is looked at once more, then its pool is replaced and the strip re-posted (RW-1)", () => {
        const made = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        let t = 1000;
        const clock = jest.spyOn(performance, "now").mockImplementation(() => t);
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const drops = [];
            client.submitPlates({
                frameSeq: 1, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
                onDrop: (d) => drops.push(d),
            });
            expect(made[0].posted.length).toBe(1);
            t += client.WATCHDOG_MS - 1;
            client._checkWatchdogForTests();
            client._checkWatchdogForTests();
            expect(made.length).toBe(1);                                         // not yet overdue
            t += 2;
            client._checkWatchdogForTests();
            expect(made.length).toBe(1);                                         // overdue: marked, asked once more
            client._checkWatchdogForTests();
            expect(made.length).toBe(2);                                         // red before: silent for ever
            expect(made[0].dead).toBe(true);
            expect(made[1].posted.length).toBe(1);
            expect(drops.map((d) => d.why)).toEqual(["worker"]);
            const rep = client.rasterWorkerReport();
            expect(rep.silent).toBe(1);
            expect(rep.broken).toBe(false);
        } finally {
            clock.mockRestore();
            delete global.Worker;
        }
    });

    test("W12 the worker count is min(4, max(1, cores − 1)), with the URL override on top (§6.6)", () => {
        const hadCores = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");
        try {
            for (const [cores, want] of [[1, 1], [2, 1], [3, 2], [5, 4], [8, 4], [16, 4]]) {
                Object.defineProperty(navigator, "hardwareConcurrency", { value: cores, configurable: true });
                client.setRasterWorkerCount(null);
                expect(client.rasterWorkerCount()).toBe(want);
            }
        } finally {
            if (hadCores) Object.defineProperty(navigator, "hardwareConcurrency", hadCores);
        }
        expect(client.workerCountFromSearch("")).toBe(null);
        expect(client.workerCountFromSearch("?zoom=3")).toBe(null);
        expect(client.workerCountFromSearch("?rasterWorkers=1")).toBe(1);
        expect(client.workerCountFromSearch("?a=1&rasterWorkers=2")).toBe(2);
        expect(client.workerCountFromSearch("?rasterWorkers=9")).toBe(4);   // never more than the rule's ceiling
        expect(client.workerCountFromSearch("?rasterWorkers=0")).toBe(null);

        // the WIRING and not only the parser: `?rasterWorkers=N` is stage 7's own lever (§6.6),
        // and a broken read of `window.location.search` runs the 1/2/4 sweep at the default count
        // with numbers that look plausible.
        const hadSearch = window.location.search;
        try {
            window.history.replaceState({}, "", "?rasterWorkers=2");
            client.setRasterWorkerCount(null);
            expect(client.rasterWorkerCount()).toBe(2);
        } finally {
            window.history.replaceState({}, "", window.location.pathname + hadSearch);
        }
        expect(client.workerCountFromSearch(window.location.search)).toBe(null);

        client.setRasterWorkerCount(3);
        expect(client.rasterWorkerCount()).toBe(3);        // the explicit count wins over the URL
    });

    test("W13 a job that throws in the worker fails that job alone, and the next one still runs", async () => {
        const drops = [], got = [];
        client.setRasterWorkerCount(1);
        let first = true;
        client.setRasterTransport(async (msg) => {
            if (first) { first = false; return { kind: "raster-error", jobId: msg.jobId, err: "bad job" }; }
            return (await runJob(msg)).msg;
        });
        const mk = (frameSeq) => ({
            frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
            onDrop: (d) => drops.push(d),
            onResult: (res) => got.push(res),
        });
        client.submitPlates(mk(1));
        expect(await until(() => drops.length === 1)).toBe(true);
        expect(drops[0].why).toBe("bad job");
        expect(drops[0].before).toBe(false);
        expect(client.rasterWorkerReport().failed).toBe(1);
        expect(client.rasterWorkerReport().inFlight).toBe(0);           // the slot is free again

        client.submitPlates(mk(2));
        expect(await until(() => got.length === 1)).toBe(true);
        expect(ink(got[0].pixels[0])).toBeGreaterThan(0);
    });

    test("W14 every job id the client mints reaches the caller — the endJob contract (stage 4)", async () => {
        // Stage 4's handoff: the caller calls `PlateStore.endJob(jobId)` for every id it sees, or
        // those keys stay in the in-flight map for ever and the screen keeps a permanent hole with
        // every suite green. What this asserts is the half the client owes: every id it mints is
        // handed to `pack` and then reported, through whichever outcome the job takes.
        const minted = [], seen = [];
        const drawOne = (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId });
        const base = (over) => Object.assign({
            q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (p, jobId) => { minted.push(jobId); return drawOne(p, jobId); },
            onDrop: (d) => { if (d.jobId != null) seen.push({ id: d.jobId, how: "drop:" + d.why, d }); },
            onResult: (res, info) => seen.push({ id: info.jobId, how: "result", G: res.G }),
        }, over);
        client.setRasterWorkerCount(1);
        const ok = async (msg) => (await runJob(msg)).msg;

        // 1 — a clean job: the id rides `onResult`
        client.setRasterTransport(ok);
        client.submitPlates(base({ frameSeq: 1 }));
        expect(await until(() => seen.length === 1)).toBe(true);
        expect(seen[0].how).toBe("result");

        // 2 — `pack` throws after the id was minted: the store may already have begun it
        client.submitPlates(base({
            frameSeq: 2,
            pack: (p, jobId) => { minted.push(jobId); throw new Error("pack blew up"); },
        }));
        expect(await until(() => seen.length === 2)).toBe(true);
        expect(seen[1].how).toBe("drop:pack");

        // 3 — `pack` returns null: nothing on this strip to draw
        client.submitPlates(base({ frameSeq: 3, pack: (p, jobId) => { minted.push(jobId); return null; } }));
        expect(await until(() => seen.length === 3)).toBe(true);
        expect(seen[2].how).toBe("drop:empty");

        // 4 — the transport rejects
        client.setRasterTransport(async () => { throw new Error("transport gone"); });
        client.submitPlates(base({ frameSeq: 4 }));
        expect(await until(() => seen.length === 4)).toBe(true);
        expect(seen[3].how).toBe("drop:transport gone");

        // 5 — the worker answers with an error for that job
        client.setRasterTransport(async (msg) => ({ kind: "raster-error", jobId: msg.jobId, err: "boom" }));
        client.submitPlates(base({ frameSeq: 5 }));
        expect(await until(() => seen.length === 5)).toBe(true);
        expect(seen[4].how).toBe("drop:boom");

        // 6 — a late arrival is a result like any other, carrying the G it was packed at: the plate
        //     store judges it (A2 §3.1), the client does not
        client.setRasterTransport(async (msg) => { await flush(5); return ok(msg); });
        client.submitPlates(base({
            frameSeq: 6,
            pack: (p, jobId) => { minted.push(jobId); return packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId, G: 4 }); },
        }));
        expect(await until(() => seen.length === 6)).toBe(true);
        expect(seen[5].how).toBe("result");
        expect(seen[5].G).toBe(4);

        // 7 — a teardown with a job in flight: without `abandonInFlight` this id is never reported
        //     and its plates are in flight in the store for the rest of the session
        client.setRasterTransport(() => new Promise(() => {}));          // never answers
        client.submitPlates(base({ frameSeq: 7 }));
        await flush(0);
        expect(client.rasterWorkerReport().inFlight).toBe(1);
        client.destroyRasterPool();
        expect(seen.length).toBe(7);
        expect(seen[6].how).toBe("drop:destroyed");

        expect(minted.length).toBe(7);
        expect(new Set(minted).size).toBe(7);                            // one id each, monotonic
        const reported = [...new Set(seen.map((s) => s.id))].sort((a, b) => a - b);
        expect(reported).toEqual(minted.slice().sort((a, b) => a - b));  // every minted id, and no other
    });

    test("W15 the report carries the seven guard totals, the eight count totals and both transfer timers (§8.5)", async () => {
        const infos = [];
        client.setRasterWorkerCount(1);
        client.setRasterTransport(async (msg) => (await runJob(msg)).msg);
        const req = (frameSeq, bad) => ({
            frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (p, jobId) => {
                const job = packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId });
                if (bad) job.geom[4] = NaN;          // a record the core refuses: `nonFinite` (§3.4)
                return job;
            },
            onResult: (res, info) => infos.push(info),
        });
        client.submitPlates(req(1, false));
        expect(await until(() => infos.length === 1)).toBe(true);
        client.submitPlates(req(2, true));
        expect(await until(() => infos.length === 2)).toBe(true);

        const r = client.rasterWorkerReport();
        expect(Object.keys(r.guards)).toEqual(GUARD_NAMES);
        expect(Object.keys(r.counts)).toEqual(COUNT_NAMES);
        expect(r.guards.nonFinite).toBeGreaterThan(0);                   // the second job's refusal
        expect(r.guards.xsGrown).toBe(0);
        expect(r.guards.arcOverTurn).toBe(0);
        expect(r.counts.items).toBe(2);                                  // one item on each of two plates
        expect(r.counts.itemsDrawn).toBe(2);
        expect(r.counts.families).toBe(2);
        expect(r.counts.edges).toBeGreaterThan(0);
        // §8.1's two main-thread timers: the report's totals ARE the per-job numbers, so stage 6's
        // residual is not absorbing them (§8.4 rule 2). Undefined either side makes the sum NaN.
        expect(r.postMs).toBeCloseTo(infos.reduce((n, i) => n + i.postMs, 0), 9);
        expect(r.recvMs).toBeCloseTo(infos.reduce((n, i) => n + i.recvMs, 0), 9);
        expect(r.postMs).toBeGreaterThanOrEqual(0);
        expect(r.recvMs).toBeGreaterThanOrEqual(0);
        expect(r.spawnedLate).toBe(0);                                   // a transport spawns nothing
    });

    test("W17 a raw-pixel plate becomes a bitmap before the store sees it (5a's hand-off, §15.3)", async () => {
        const job = twoPlateJob();
        const ref = reference(job, 0);
        const res = unwireResult((await runJob(wireJob(twoPlateJob()).msg)).msg);
        expect(res.pixels[0]).not.toBe(null);                        // jsdom's path: raw pixels

        // with no `createImageBitmap` in scope the caller puts the pixels, which the store takes
        expect(await client.plateBitmap(res.pixels[0])).toBe(null);
        expect(await client.plateBitmap(null)).toBe(null);

        const handed = [];
        global.ImageData = class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
        global.createImageBitmap = async (img) => { handed.push(img); return { width: img.width, height: img.height, close() {} }; };
        try {
            const bm = await client.plateBitmap(res.pixels[0]);
            expect(bm.width).toBe(TW);
            expect(bm.height).toBe(TH);
            expect(handed.length).toBe(1);
            expect(same(handed[0].data, ref)).toBe(true);            // the plate's own pixels, not another's
        } finally {
            delete global.createImageBitmap;
            delete global.ImageData;
        }
    });

    test("W16 a pool spawned at the first render rather than at start-up is counted (§8.5, §15.3 Q10)", () => {
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);                   // the engine's constructor
            expect(client.rasterWorkerReport().spawnedLate).toBe(0);     // 5b's engine test asserts this

            client.resetRasterWorkerClient();
            client.setRasterWorkerCount(1);
            client.submitPlates({                                        // nobody spawned it first
                frameSeq: 1, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 100, 100)])], p, { jobId }),
                onResult: () => {},
            });
            const r = client.rasterWorkerReport();
            expect(r.workers).toBe(1);                                   // the lazy path still draws
            expect(r.spawnedLate).toBe(1);                               // and the cost is visible
        } finally {
            delete global.Worker;
        }
    });

    test("W19 a job abandoned mid-flight HOLDS its worker — and the inline path's one slot (§3.5)", async () => {
        // `abandonInFlight` reports the job and frees the store's keys, but the worker is still
        // drawing that job into its one RGBA scratch and awaiting `createImageBitmap` between
        // plates. A second job posted into it would overwrite pixels the first job's `ImageData`
        // still aliases — two jobs, one scratch — so the slot is not free until the orphan answers.
        const made = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const drops = [], got = [];
            const req = (frameSeq) => ({
                frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
                onDrop: (d) => drops.push(d),
                onResult: (res) => got.push(res),
            });
            client.submitPlates(req(1));
            expect(made[0].posted.length).toBe(1);
            const orphan = made[0].posted[0];

            expect(client.abandonInFlight("quantum")).toBe(1);
            expect(drops.length).toBe(1);
            expect(drops[0].jobId).toBe(orphan.jobId);                   // the caller owes endJob on it
            expect(client.rasterWorkerReport().inFlight).toBe(0);
            // the one new failure mode the sentinel introduces, named in the report: an orphan
            // that never answers draws this pool down to three workers for the session
            expect(client.rasterWorkerReport().heldSlots).toBe(1);

            client.submitPlates(req(2));                                 // the next render, same pool
            await flush(0);
            expect(made[0].posted.length).toBe(1);                       // NOT posted to twice
            expect(made.length).toBe(1);                                 // and no worker spawned around it
            expect(client.rasterWorkerReport().queued).toBe(1);          // the strip waits instead

            // the orphan's own answer is the proof that worker stopped: the slot frees, the waiting
            // strip takes it, and the abandoned job's result is not delivered to the caller
            made[0].onmessage({ data: (await runJob(orphan)).msg });
            expect(await until(() => made[0].posted.length === 2)).toBe(true);
            expect(got.length).toBe(0);
            expect(client.rasterWorkerReport().queued).toBe(0);
            expect(client.rasterWorkerReport().heldSlots).toBe(0);       // the hold is given back

            made[0].onmessage({ data: (await runJob(made[0].posted[1])).msg });
            expect(await until(() => got.length === 1)).toBe(true);
            expect(ink(got[0].pixels[0])).toBeGreaterThan(0);
        } finally {
            delete global.Worker;
        }

        // The INLINE half of the same rule, and it is a production path: a 404 or a CSP on
        // `/raster-worker.js` leaves no pool, and a browser main thread HAS `createImageBitmap`,
        // so the entry really does await between plates while it draws into the one module-level
        // RGBA scratch. There is no slot object to mark here — the cap is a count — so the
        // abandoned job has to be counted with it or the next `submitPlates` starts a second
        // `runJob` over the first's pixels, and over the same module-level `coreStats`.
        client.resetRasterWorkerClient();
        const got2 = [], drops2 = [], minted = [];
        const req2 = (frameSeq) => ({
            frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
            pack: (p, jobId) => {
                minted.push(jobId);
                return packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId });
            },
            onDrop: (d) => drops2.push(d),
            onResult: (res) => got2.push(res),
        });
        client.submitPlates(req2(1));                                    // job A, on its microtask
        expect(client.rasterWorkerReport().mode).toBe("inline");
        expect(client.rasterWorkerReport().inFlight).toBe(1);
        expect(client.abandonInFlight("quantum")).toBe(1);
        expect(client.rasterWorkerReport().heldSlots).toBe(1);
        expect(drops2[0].jobId).toBe(minted[0]);                         // the caller owes endJob on A

        client.submitPlates(req2(2));                                    // job B, the next render
        expect(client.rasterWorkerReport().inFlight).toBe(0);            // NOT dispatched into A
        expect(client.rasterWorkerReport().queued).toBe(1);              // it waits, as a strip does
        expect(minted.length).toBe(1);                                   // and is not even packed yet

        expect(await until(() => got2.length === 1)).toBe(true);
        expect(minted.length).toBe(2);
        expect(got2[0].jobId).toBe(minted[1]);                           // A's result is not delivered
        expect(client.rasterWorkerReport().heldSlots).toBe(0);
        expect(client.rasterWorkerReport().queued).toBe(0);
        expect(ink(got2[0].pixels[0])).toBeGreaterThan(0);

        // And the release through a FAILURE, which is what a real worker throw produces after a
        // quantum change: the orphan answers `kind: "raster-error"` and the hold comes back on
        // that path too, because `onFailed` takes the slot (D175, amended).
        client.resetRasterWorkerClient();
        const made3 = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made3.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const got3 = [];
            const req3 = (frameSeq) => ({
                frameSeq, q: 0, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId }),
                onDrop: () => {},
                onResult: (res) => got3.push(res),
            });
            client.submitPlates(req3(1));
            const orphan3 = made3[0].posted[0];
            expect(client.abandonInFlight("quantum")).toBe(1);
            expect(client.rasterWorkerReport().heldSlots).toBe(1);

            client.submitPlates(req3(2));
            await flush(0);
            expect(client.rasterWorkerReport().queued).toBe(1);          // still waiting on the orphan
            made3[0].onmessage({ data: { kind: "raster-error", jobId: orphan3.jobId, frameSeq: 1, err: "boom" } });
            expect(await until(() => made3[0].posted.length === 2)).toBe(true);
            expect(client.rasterWorkerReport().heldSlots).toBe(0);       // the hold is given back
            expect(client.rasterWorkerReport().queued).toBe(0);
            expect(got3.length).toBe(0);                                 // and the orphan delivers nothing
        } finally {
            delete global.Worker;
        }
    });

    test("W20 two quanta are live at once, and a newer frame drops its OWN q's strips only (D182)", async () => {
        // 5a holds the old quantum's plates while the new quantum fills (§6.3), so one frame's
        // misses belong to two `q` and 5b posts a call for each. One `current` pair dropped the
        // first call's queued strips at the second — and the settle's request is one-shot off a
        // timer, so a strip dropped that way is a re-raster that silently never happens.
        const drops = [], got = [];
        let packed = 0, release = null;
        const gate = new Promise((r) => { release = r; });
        client.setRasterWorkerCount(1);
        client.setRasterTransport(async (msg) => { await gate; return (await runJob(msg)).msg; });
        const mk = (frameSeq, q, plates) => ({
            frameSeq, q, Zq: 1, plates: Int32Array.from(plates),
            pack: (p, jobId) => { packed++; return packStrip([shapeItem(1, [rect(10, 10, 100, 100)])], p, { jobId, frameSeq }); },
            onDrop: (d) => drops.push({ q, why: d.why, jobId: d.jobId }),
            onResult: (res, info) => got.push({ q, frameSeq: info.frameSeq }),
        });

        expect(client.submitPlates(mk(7, -2, [0, 0, 1, 0, 2, 0, 3, 0]))).toBe(2);   // the view's misses
        await flush(0);
        expect(packed).toBe(1);                                          // one in flight, one waiting
        expect(client.submitPlates(mk(7, -3, [4, 0]))).toBe(1);          // the held quantum's, same frame
        expect(drops.length).toBe(0);                                    // neither call drops the other
        expect(client.rasterWorkerReport().queued).toBe(2);
        expect(client.rasterWorkerReport().liveRequests).toBe(2);

        client.submitPlates(mk(8, -2, [0, 0, 1, 0, 2, 0, 3, 0]));        // the next frame, new quantum only
        expect(drops.length).toBe(1);                                    // the stale -2 strip, and it alone
        expect(drops[0].q).toBe(-2);
        expect(drops[0].why).toBe("frame");
        expect(drops[0].jobId).toBe(null);                               // never packed, so never begun
        expect(client.rasterWorkerReport().queued).toBe(3);              // the held strip and frame 8's two

        release();
        expect(await until(() => got.length === 4, 600)).toBe(true);
        // the job DISPATCHED for frame 7 is not recalled by frame 8 — it arrives and is answered
        expect(got[0]).toEqual({ q: -2, frameSeq: 7 });
        expect(got.filter((g) => g.q === -3).length).toBe(1);            // the held quantum's strip drew
        expect(got.filter((g) => g.q === -2 && g.frameSeq === 8).length).toBe(2);
        expect(drops.length).toBe(1);

        // and a `q` nothing waits on and nothing is drawing is forgotten, so the map is the live
        // requests and not the session's zoom quanta
        client.submitPlates(mk(9, -1, [7, 0]));
        expect(client.rasterWorkerReport().liveRequests).toBe(1);

        // `pump`'s own re-check against the newest frame for that `q`, whose one reachable case is
        // `onWorkerError` re-queueing a strip that was DISPATCHED for an older frame: the frame has
        // moved on, so it is dropped rather than drawn inline (W11 is this path at the newest frame).
        client.resetRasterWorkerClient();
        client.setRasterTransport(null);
        const made = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const late = [];
            const req = (frameSeq) => ({
                frameSeq, q: -2, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId, frameSeq }),
                onDrop: (d) => late.push({ frameSeq, why: d.why }),
                onResult: () => late.push({ frameSeq, why: "result" }),
            });
            client.submitPlates(req(1));                                 // dispatched into the worker
            expect(made[0].posted.length).toBe(1);
            client.submitPlates(req(2));                                 // the next frame, queued behind it
            made[0].onerror({ preventDefault() {} });                    // the script did not load
            expect(await until(() => late.some((l) => l.why === "result"), 400)).toBe(true);
            expect(late.filter((l) => l.frameSeq === 2 && l.why === "result").length).toBe(1);
            expect(late.filter((l) => l.frameSeq === 1 && l.why === "stale").length).toBe(1);
            expect(late.filter((l) => l.frameSeq === 1 && l.why === "result").length).toBe(0);
        } finally {
            delete global.Worker;
        }

        // The prune's IN-FLIGHT branch: a `q` whose only strip is DISPATCHED is still a live
        // request. Without it a submit at another `q` forgets that `q`, and the strip
        // `onWorkerError` re-queues is then dropped `"stale"` although its frame is the newest
        // one there — a screenful silently not drawn on the day the bundle 404s.
        client.resetRasterWorkerClient();
        const made2 = [];
        global.Worker = class {
            constructor(url) { this.url = url; this.posted = []; made2.push(this); }
            postMessage(msg) { this.posted.push(msg); }
            terminate() { this.dead = true; }
        };
        try {
            client.setRasterWorkerCount(1);
            expect(client.ensureRasterPool()).toBe(1);
            const seen = [];
            const req2 = (frameSeq, q) => ({
                frameSeq, q, Zq: 1, plates: Int32Array.from([0, 0]),
                pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 300, 300)])], p, { jobId, frameSeq }),
                onDrop: (d) => seen.push({ q, why: d.why }),
                onResult: () => seen.push({ q, why: "result" }),
            });
            client.submitPlates(req2(3, -2));                            // dispatched; nothing queued at −2
            expect(made2[0].posted.length).toBe(1);
            expect(client.rasterWorkerReport().queued).toBe(0);
            client.submitPlates(req2(3, -1));                            // another `q`: the prune runs here
            expect(client.rasterWorkerReport().liveRequests).toBe(2);    // −2 is live IN FLIGHT
            made2[0].onerror({ preventDefault() {} });                   // the script did not load
            expect(await until(() => seen.filter((s) => s.why === "result").length === 2, 400)).toBe(true);
            expect(seen.filter((s) => s.q === -2 && s.why === "result").length).toBe(1);
            expect(seen.filter((s) => s.q === -2 && s.why === "stale").length).toBe(0);
        } finally {
            delete global.Worker;
        }
    });

    test("W21 dropQueued(why, q) empties ONE quantum's queue and leaves the others (§10 stage 5b)", async () => {
        // 5b's own lever at a quantum change: the view has left a `q` and its queued strips are
        // nobody's, while the newest quantum's and the settle's at "e" are still wanted. A bare
        // `dropQueued(why)` takes all three — the drop D182 exists to stop.
        const drops = [], got = [];
        let release = null;
        const gate = new Promise((r) => { release = r; });
        client.setRasterWorkerCount(1);
        client.setRasterTransport(async (msg) => { await gate; return (await runJob(msg)).msg; });
        const mk = (frameSeq, q, plates) => ({
            frameSeq, q, Zq: 1, plates: Int32Array.from(plates),
            pack: (p, jobId) => packStrip([shapeItem(1, [rect(10, 10, 100, 100)])], p, { jobId, frameSeq }),
            onDrop: (d) => drops.push({ q, why: d.why, jobId: d.jobId }),
            onResult: () => got.push({ q }),
        });

        expect(client.submitPlates(mk(4, -3, [0, 0, 1, 0]))).toBe(2);    // the dying quantum: 1 posted, 1 queued
        await flush(0);
        expect(client.submitPlates(mk(4, -2, [2, 0, 3, 0]))).toBe(2);    // the quantum being entered
        expect(client.submitPlates(mk(4, "e", [4, 0]))).toBe(1);         // the settle's own request
        expect(client.rasterWorkerReport().queued).toBe(4);
        expect(client.rasterWorkerReport().liveRequests).toBe(3);

        expect(client.dropQueued("quantum", -3)).toBe(1);                // the dying quantum's strip, alone
        expect(client.rasterWorkerReport().queued).toBe(3);
        expect(drops.length).toBe(1);
        expect(drops[0]).toEqual({ q: -3, why: "quantum", jobId: null });
        // a DISPATCHED strip is not recalled, so its `q` is still a live request
        expect(client.rasterWorkerReport().liveRequests).toBe(3);

        release();
        expect(await until(() => got.length === 4, 600)).toBe(true);
        expect(got.filter((g) => g.q === -3).length).toBe(1);            // the one already in flight
        expect(got.filter((g) => g.q === -2).length).toBe(2);
        expect(got.filter((g) => g.q === "e").length).toBe(1);
        expect(drops.length).toBe(1);

        // `current` is pruned at a submit and at a `dropQueued`, and NOT when a job arrives: the
        // three requests are still counted with everything answered, and the bare form clears them.
        expect(client.rasterWorkerReport().liveRequests).toBe(3);
        expect(client.dropQueued("teardown")).toBe(0);
        expect(client.rasterWorkerReport().liveRequests).toBe(0);

        // The BARE form — a teardown or a settle, never a quantum change — empties EVERY queue.
        // The call above runs on a drained queue and proves only the prune, so the same three
        // quanta are queued again behind a fresh gate: without `dropQueued`'s `q == null` branch
        // this call drops nothing and every other assertion in the file stays green (B58).
        let release2 = null;
        const gate2 = new Promise((r) => { release2 = r; });
        client.setRasterTransport(async (msg) => { await gate2; return (await runJob(msg)).msg; });
        expect(client.submitPlates(mk(5, -3, [0, 0, 1, 0]))).toBe(2);    // 1 posted, 1 queued
        await flush(0);
        expect(client.submitPlates(mk(5, -2, [2, 0, 3, 0]))).toBe(2);
        expect(client.submitPlates(mk(5, "e", [4, 0]))).toBe(1);
        expect(client.rasterWorkerReport().queued).toBe(4);

        expect(client.dropQueued("teardown")).toBe(4);                   // every q, not one
        expect(client.rasterWorkerReport().queued).toBe(0);
        expect(drops.filter((d) => d.why === "teardown").length).toBe(4);
        expect(client.rasterWorkerReport().liveRequests).toBe(1);        // −3, whose strip is in flight
        release2();
        expect(await until(() => got.length === 5, 600)).toBe(true);     // the dispatched strip alone
    });
});
