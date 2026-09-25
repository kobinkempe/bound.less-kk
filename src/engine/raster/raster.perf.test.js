/**
 * raster.perf.test.js — X1–X6 of RASTERISER-PLAN §9.2, plus the acceptance §10 stage 6 names:
 * the five buckets, the fixed ring of main-thread tasks, the per-row verdict, the stale log,
 * FC7's reserved slots and crawl tick, the packer's counters carried into the report, and the
 * report section's own byte bound (F58).
 *
 * Every clock is INJECTED, as stage 5a injected its context factory and its timer: jsdom has no
 * rAF timestamps, no Long Animation Frames and no `createImageBitmap`, so the rAF source and the
 * LoAF list are fixtures here and the join to a REAL LoAF entry is stage 7's (§9.4).
 *
 * The two numbers this stage measures — the per-row write cost and `report()`'s bytes and
 * stringify ms — are PRINTED as spreads (D189) and only the byte bound is asserted (F58).
 */

import * as rp from "./rasterPerf";
import { TIMINGS_PER_PLATE, COUNTS_PER_PLATE } from "./rasterJob";
import { GrowthLog, FrameMeter } from "../instruments";
import { mkEngine, useEngines } from "../__testkit__/harness";

useEngines();

/** An epoch millisecond, so the ring's Float64 `t` lane is proved and not assumed. */
const WALL0 = 1.7e12;
let t = 0;
const now = () => t;
const wall = () => WALL0 + t;

let perfCalls = [];
const LAYER = { mode: "plates", q: -3, s: 1.0905, dpr: 2.625, plates: 15, composes: 4,
    canvasBytes: 25.2e6, layerBytes: 25.2e6, layerOverflow: 0 };
const STORE = { plates: 15, plateBytes: 15 * 1048576, hits: 41, misses: 7, evictions: 2,
    pinned: 15, bitmapsOpen: 15, bitmapsClosed: 3 };
const WORKER = { mode: "inline", workers: 0, jobs: 12, plates: 40, bytesOut: 4.7e6,
    bytesIn: 1.2e6, postMs: 3.4, recvMs: 2.2, guards: { nonFinite: 0 }, counts: { edges: 900 } };
let PACK = {};
let CORE = {};
let ANTS = {};

function attachFake(extra) {
    PACK = { items: 40, packed: 38, mixedWinding: 0, nonFinite: 0, overBound: 0, memoBytes: 4.1e6 };
    CORE = { xsGrown: 0, unionSplits: 1, unionRefills: 0, fullClears: 0, nonFinite: 0,
        arcClamped: 0, arcOverTurn: 0 };
    ANTS = { dashes: 0, stamps: 0, pixels: 0, nonFinite: 0, offPlane: 0, refused: 0, allocs: 0 };
    rp.attach({
        now, wall,
        layer: { report: () => ({ ...LAYER }) },
        store: { report: () => ({ ...STORE }) },
        workerReport: () => ({ ...WORKER }),
        pack: PACK, core: CORE, ants: ANTS,
        notePerf: (op, t0, x) => perfCalls.push({ op, t0, ...(x || {}) }),
        ...(extra || {}),
    });
}

beforeEach(() => { rp.reset(); t = 1000; perfCalls = []; attachFake(); });
afterEach(() => { rp.reset(); });

// ---- fixtures ---------------------------------------------------------------

/** One bracketed task: the slots are added, and the clock is advanced to make `mainMs`. */
function row(seq, kind, slots, mainMs, opts) {
    const o = opts || {};
    rp.beginFrame(seq, kind);
    if (o.view) rp.noteView(o.view);
    for (const k of Object.keys(slots || {})) rp.add(rp.T[k], slots[k]);
    for (const k of Object.keys(o.counts || {})) rp.bump(rp.C[k], o.counts[k]);
    if (o.body) o.body();
    t += mainMs;
    return rp.endFrame();
}

/** A result in §3.4's shape: durations on the worker's own clock, and nothing absolute. */
function mkRes(per, serialiseMs, extra) {
    const n = per.length;
    const timings = new Float64Array(n * TIMINGS_PER_PLATE);
    const counts = new Int32Array(n * COUNTS_PER_PLATE);
    const plates = new Int32Array(n * 2);
    per.forEach((p, i) => {
        const o = i * TIMINGS_PER_PLATE;
        timings[o] = p.recv; timings[o + 1] = p.s2f; timings[o + 2] = p.clip;
        timings[o + 3] = p.local || 0; timings[o + 4] = p.edges; timings[o + 5] = p.union;
        timings[o + 6] = p.accum;
        const c = i * COUNTS_PER_PLATE;
        counts[c] = p.items || 0; counts[c + 1] = p.itemsDrawn || 0; counts[c + 2] = p.families || 0;
        counts[c + 3] = p.unionItems || 0; counts[c + 4] = p.nEdges || 0; counts[c + 5] = p.chords || 0;
        counts[c + 6] = p.rowsTouched || 0; counts[c + 7] = p.coveredPx || 0;
        plates[i * 2] = i; plates[i * 2 + 1] = 0;
    });
    return { jobId: 7, frameSeq: 1, plates, timings, counts,
        serialiseMs: serialiseMs || 0, ...(extra || {}) };
}

const PLATE_A = { recv: 0.5, s2f: 17.5, clip: 0.5, edges: 9.0, union: 4.0, accum: 3.0,
    items: 120, itemsDrawn: 118, families: 30, unionItems: 2, nEdges: 4000, chords: 4200,
    rowsTouched: 510, coveredPx: 180000 };

/**
 * The arrival path, on one timeline, so the two partitions are two readings of the same
 * seconds and not two fixtures:
 *
 *   queued ─1.6─ posted ─1.2─ ... ─41.0 in flight─ arrived ─3.0 bitmap─ ┤compose task 3.2├
 *
 * queueWait is queued→posted (2.8); the client's own wall is posted→arrived (41.0, which is
 * its `queueingMs` 3.0 plus the phases 38.0); the ROW's wall is queued→blitted (50.0).
 */
function arrivalPair(opts) {
    const o = opts || {};
    const seq = o.seq || 1;
    const per = o.per || [PLATE_A, PLATE_A];
    // the submit, in its own task: `xfer.out` is the poster's bracket and belongs to that row
    rp.beginFrame(seq, "render");
    rp.noteSubmit({ frameSeq: seq, q: -3 }, per.length, 1);
    rp.add(rp.T["xfer.out"], o.postMs != null ? o.postMs : 1.4);
    t += o.postMainMs != null ? o.postMainMs : 1.6;
    rp.endFrame();
    const postedAt = t + (o.waitMs != null ? o.waitMs : 1.2);
    const serialiseMs = o.serialiseMs != null ? o.serialiseMs : 2.0;
    const phases = per.reduce((n, p) => n + p.recv + p.s2f, 0) + serialiseMs;
    const queueingMs = o.queueingMs != null ? o.queueingMs : 3.0;
    t = postedAt + phases + queueingMs;                     // the client's own wall, by its rule
    const arrivedAt = t;
    t += o.brBitmap != null ? o.brBitmap : 3.0;             // the decode, off-thread (Q6)

    const res = mkRes(per, serialiseMs, o.resExtra);
    const info = {
        jobId: 7, frameSeq: seq, plates: res.plates, postedAt, arrivedAt,
        wallMs: arrivedAt - postedAt, queueingMs,
        postMs: o.postMs != null ? o.postMs : 1.4,
        recvMs: o.recvMs != null ? o.recvMs : 0.6,
        bytesOut: 320000, bytesIn: 96000, stale: o.stale || null, inline: true,
    };
    rp.beginFrame(seq, "arrival");
    if (o.view) rp.noteView(o.view);
    rp.noteBitmap(o.brBitmap != null ? o.brBitmap : 3.0);
    rp.noteJob(info, res);
    rp.noteCompose(o.brBlit != null ? o.brBlit : 2.4, per.length, per.length);
    t += o.mainMs != null ? o.mainMs : 3.2;
    return { row: rp.endFrame(), info, res };
}

function lastRow(rep) { return rep.frames[rep.frames.length - 1]; }
function rowSeq(rep, seq, kind) {
    return rep.frames.filter((r) => r.frameSeq === seq && (!kind || r.kind === kind))[0];
}

// ---- X1 — the buckets sum, both totals, the residual bar --------------------

describe("X1 — the buckets sum, and BOTH totals are recorded", () => {
    test("a render row: mainMs is the main-part slots plus a residual inside max(1 ms, 10 %)", () => {
        row(1, "render", { "eng.list": 2.0, "eng.cull": 1.0, "eng.band": 0.6, "eng.pack": 2.4,
            "xfer.out": 1.4, "br.blit": 2.1 }, 9.7, { view: { mode: "plates", q: -3, s: 1.09 } });
        const r = lastRow(rp.report());
        expect(r.mainMs).toBeCloseTo(9.7, 3);
        // 9.7 − (2.0 + 1.0 + 0.6 + 2.4 + 1.4 + 2.1) = 0.2, the test's own arithmetic: with
        // `xfer.out` dropped from the module's main list this reads 1.6 and the bar fails.
        expect(r.residualMainMs).toBeCloseTo(0.2, 2);
        expect(r.verdict.residualOk).toBe(true);
        expect(r.verdict.barMs).toBeCloseTo(1.0, 3);
        expect(Math.abs(r.residualMainMs)).toBeLessThanOrEqual(Math.max(1, 0.1 * r.mainMs));
    });

    test("an arrival row: wallMs is queueWait + the client's own arithmetic + the browser's", () => {
        const { info } = arrivalPair({});
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(info.wallMs).toBeCloseTo(41.0, 3);          // the client's own: posted → arrived
        expect(r.wallMs).toBeCloseTo(50.0, 2);             // the row's: queued → blitted
        expect(r.timers.queueWait).toBeCloseTo(2.8, 2);
        expect(r.timers.queueing).toBeCloseTo(3.0, 3);
        expect(r.timers["job.recvToStart"]).toBeCloseTo(1.0, 3);
        expect(r.timers["job.startToFinish"]).toBeCloseTo(35.0, 3);
        expect(r.timers["xfer.serialise"]).toBeCloseTo(2.0, 3);
        expect(r.timers["br.bitmap"]).toBeCloseTo(3.0, 3);
        expect(r.timers["br.blit"]).toBeCloseTo(2.4, 3);
        // 50.0 − (2.8 + 3.0 + 1.0 + 35.0 + 2.0 + 3.0 + 2.4) = 0.8, which is the compose task's
        // own time outside the blit — a real number, because the span is measured and not summed
        expect(r.residualWallMs).toBeCloseTo(0.8, 2);
        expect(Math.abs(r.residualWallMs)).toBeLessThanOrEqual(Math.max(1, 0.1 * r.wallMs));
        // the main side of the SAME row: the unwire and the compose, and nothing the worker did
        expect(r.mainMs).toBeCloseTo(3.2, 3);
        expect(r.residualMainMs).toBeCloseTo(3.2 - 0.6 - 2.4, 2);
        // postMs and recvMs ride BESIDE the partition and are never added to it (Q7)
        expect(info.postMs).toBe(1.4);
        expect(rp.report().worstJobs[0].postMs).toBeCloseTo(1.4, 3);
        expect(rp.report().worstJobs[0].postedToArrivedMs).toBeCloseTo(41.0, 2);
    });

    test("one frame posting at two quanta: each job's queueWait is its OWN request's (Q7)", () => {
        // D182's acceptance: one camera step posts the settle's misses and the incoming
        // quantum's under ONE frameSeq. Keyed by frameSeq alone, the second stamp overwrote the
        // first, and the job that waited longest recorded the shorter wait or none at all (5b's
        // third review). A stamp is claimed by one job: the newest at or before that job's post
        // with strips still unclaimed.
        const seq = 4;
        const qA = t;
        rp.beginFrame(seq, "render");
        rp.noteSubmit({ frameSeq: seq, q: -3 }, 2, 1);       // the settle's misses
        t += 5;
        const qB = t;
        rp.noteSubmit({ frameSeq: seq, q: -4 }, 1, 1);       // the incoming quantum's, 5 ms later
        t += 1;
        rp.endFrame();

        // B goes out at once and comes back first; A waited for a worker and was posted AFTER
        // B's own stamp, which is the case the strip count is what resolves.
        const mkInfo = (jobId, postedAt) => ({ jobId, frameSeq: seq, postedAt, arrivedAt: t,
            wallMs: 10, queueingMs: 1, postMs: 0.2, recvMs: 0.3, bytesOut: 1, bytesIn: 1,
            stale: null });
        t = qB + 20;
        rp.beginFrame(seq, "arrival");
        rp.noteJob(mkInfo(2, qB + 1), mkRes([PLATE_A], 0));
        t += 1;
        rp.endFrame();
        t += 1;
        rp.beginFrame(seq, "arrival");
        rp.noteJob(mkInfo(3, qB + 5), mkRes([PLATE_A], 0));  // posted at 1010, queued at 1000
        t += 1;
        rp.endFrame();

        const rep = rp.report();
        const arr = rep.frames.filter((r) => r.kind === "arrival");
        expect(arr.length).toBe(2);
        expect(arr[0].timers.queueWait).toBeCloseTo((qB + 1) - qB, 3);   // B: its own stamp
        expect(arr[1].timers.queueWait).toBeCloseTo((qB + 5) - qA, 3);   // A: 10, not 5
        expect(rep.meta.noQueuedAt).toBe(0);                 // neither request was lost
    });

    test("the two sums read two named lists, and the per-plate partition keeps its residual", () => {
        arrivalPair({});
        const rep = rp.report();
        expect(rep.slots.parts.main).toContain("xfer.out");
        expect(rep.slots.parts.main).toContain("br.blit");
        expect(rep.slots.parts.main).not.toContain("br.bitmap");   // wall, not main (Q6)
        expect(rep.slots.parts.main).not.toContain("br.inferred"); // inferred, in neither sum
        expect(rep.slots.parts.wall).toEqual(["queueWait", "queueing", "job.recvToStart",
            "job.startToFinish", "xfer.serialise", "br.bitmap", "br.blit"]);
        // start-to-finish 35.0 against clip 1.0 + edges 18.0 + union 8.0 + accum 6.0 = 33.0:
        // the paper fill runs before the first clock read, and that is the 2.0 (P3)
        expect(rep.totals["ras.plateResidual"]).toBeCloseTo(2.0, 2);
    });

    test("ras.plateResidual reads the WORKER's rows alone: a sync frame cannot drive it negative", () => {
        // `_renderSync` writes the four core phases on the MAIN thread (D256) and a sync row has
        // no `job.startToFinish` for them to come out of. Summed over every row, a light-ink
        // session — §6.5's, the one most of Kobin's time is in — reported a NEGATIVE residual
        // (5b's third review). Both sides of the subtraction now come from the same rows.
        arrivalPair({});                                     // the worker's job: 35.0 − 33.0 = 2.0
        row(2, "render", { "eng.clip": 1.0, "ras.edges": 6.0, "ras.union": 0.5, "ras.accum": 2.0 },
            9.7, { view: { mode: "sync", q: "s", s: 1 } });
        const rep = rp.report();
        expect(rep.totals["ras.plateResidual"]).toBeCloseTo(2.0, 2);
        // ...and nothing is hidden: the sync row's phases are still in the session's totals, and
        // in its own row, where `rasOnMain` says they were main-thread time.
        expect(rep.totals["ras.edges"]).toBeCloseTo(18.0 + 6.0, 2);
        expect(rowSeq(rep, 2).flags).toContain("rasOnMain");
    });

    test("a sync-mode row puts the core's own phases in mainMs, and nothing else does", () => {
        row(2, "render", { "eng.clip": 1.0, "ras.edges": 6.0, "ras.accum": 2.0, "br.blit": 0.5 },
            9.7, { view: { mode: "sync", q: "s", s: 1 } });
        const r = rowSeq(rp.report(), 2);
        expect(r.mode).toBe("sync");
        expect(r.q).toBe("s");
        expect(r.flags).toContain("rasOnMain");
        expect(r.residualMainMs).toBeCloseTo(0.2, 2);
        expect(r.verdict.bucket).toBe("RASTERISER");
    });
});

// ---- the verdict: exactly one bucket, or `ambiguous` and why ----------------

describe("a synthetic slow frame is attributed to exactly ONE bucket", () => {
    test("three 120 ms rows name ENGINE, RASTERISER and OVERLAY; a split one is ambiguous", () => {
        row(1, "render", { "eng.list": 114 }, 120);
        row(2, "render", { "ras.edges": 114 }, 120, { view: { mode: "sync", q: "s", s: 1 } });
        rp.noteCrawl({ phases: 8, lastPhaseMs: 114, pixels: 467265, bytes: 10.48e6, repaints: 1,
            mainMs: 120 });
        row(4, "render", { "eng.list": 40, "br.blit": 35, "ovl.paint": 45 }, 120);
        const rep = rp.report();
        expect(rowSeq(rep, 1).verdict.bucket).toBe("ENGINE");
        expect(rowSeq(rep, 2).verdict.bucket).toBe("RASTERISER");
        expect(rowSeq(rep, -1).verdict.bucket).toBe("OVERLAY");
        const split = rowSeq(rep, 4);
        expect(split.verdict.bucket).toBe("ambiguous");
        expect(split.verdict.top).toBe("OVERLAY");
        expect(split.verdict.why).toMatch(/no bucket over 50 %/);
        // the addition of 2026-09-21: the residual prints beside every verdict, passed or not
        for (const r of rep.frames) expect(typeof r.verdict.residualMs).toBe("number");
    });

    test("a residual over the bar is ambiguous and says by how much", () => {
        row(5, "render", { "eng.list": 10 }, 120);       // 110 ms unbracketed
        const v = rowSeq(rp.report(), 5).verdict;
        expect(v.bucket).toBe("ambiguous");
        expect(v.residualOk).toBe(false);
        expect(v.why).toMatch(/residual 110 ms over the 12 ms bar/);
    });

    test("a rAF delta under mainMs leaves the bucket standing, uncorroborated; one over it corroborates the row", () => {
        // Two callbacks back to back around a task (a 60.6 ms camera row read a 0.9 ms delta in
        // Chrome) make the interval unusable, not the brackets (D273).
        row(6, "render", { "eng.list": 114 }, 120);
        rp.onFrame(100, WALL0 + t);                       // the task spanned two intervals
        let v = rowSeq(rp.report(), 6).verdict;
        expect(v.bucket).toBe("ENGINE");
        expect(v.orderOk).toBe(false);
        expect(v.corroborated).toBe(false);
        expect(v.why).toMatch(/rafDelta 100 ms under mainMs 120 ms/);
        expect(rowSeq(rp.report(), 6).flags).toContain("spansFrames");

        row(7, "render", { "eng.list": 114 }, 120);
        rp.onFrame(133, WALL0 + t);
        v = rowSeq(rp.report(), 7).verdict;
        expect(v.bucket).toBe("ENGINE");
        expect(v.corroborated).toBe(true);
        expect(v.rafDeltaMs).toBeCloseTo(133, 3);
    });

    test("a browser-bound frame names BROWSER, however the task's own 5 ms divides", () => {
        // F39's class: a 5 ms task with 4.5 ms of cull inside a 100 ms rAF interval. The share
        // is still taken of mainMs (D209), so `top` reads ENGINE and `bucket` reads BROWSER —
        // without the clause the one sentence Kobin reads would blame the engine for 95 ms it
        // never spent.
        row(9, "render", { "eng.cull": 4.5 }, 5.0);
        rp.onFrame(100, WALL0 + t);
        const r = rowSeq(rp.report(), 9);
        expect(r.timers["br.inferred"]).toBeCloseTo(95, 2);
        const v = r.verdict;
        expect(v.bucket).toBe("BROWSER");
        expect(v.top).toBe("ENGINE");
        expect(v.shareOfMain).toBeCloseTo(0.9, 3);
        expect(v.corroborated).toBe(true);
        expect(v.why).toMatch(/br\.inferred 95 ms against mainMs 5 ms/);
        // and the clause does NOT fire when the task holds most of the interval
        row(10, "render", { "eng.cull": 4.5 }, 5.0);
        rp.onFrame(9, WALL0 + t);
        expect(rowSeq(rp.report(), 10).verdict.bucket).toBe("ENGINE");
    });

    test("a healthy 60 Hz frame is not BROWSER: the clause needs an interval over 50 ms (D267)", () => {
        // 1 ms of cull inside a 16.7 ms interval leaves 15.7 ms of vsync idle, nobody's work. On
        // the Magnum Opus canvas in Chrome the clause without the floor headlined 39 of 45 rows
        // BROWSER, every one a camera step or a crawl tick drawing at 60 Hz.
        row(11, "render", { "eng.cull": 1.0 }, 1.1);
        rp.onFrame(16.7, WALL0 + t);
        const r = rowSeq(rp.report(), 11);
        expect(r.timers["br.inferred"]).toBeCloseTo(15.6, 1);   // still written, still printed
        expect(r.verdict.bucket).toBe("ENGINE");
        // a 30 ms interval — one dropped frame — still names the task's own bucket
        row(12, "render", { "eng.cull": 1.0 }, 1.1);
        rp.onFrame(30, WALL0 + t);
        expect(rowSeq(rp.report(), 12).verdict.bucket).toBe("ENGINE");
        // and past the floor the clause fires as D239 wrote it
        row(13, "render", { "eng.cull": 1.0 }, 1.1);
        rp.onFrame(51, WALL0 + t);
        expect(rowSeq(rp.report(), 13).verdict.bucket).toBe("BROWSER");
    });

    test("a task inside the 1 ms floor is `trivial`, not `ambiguous` (D270)", () => {
        // On the Magnum Opus canvas ten rows of a 45-row report were stale or empty arrivals of
        // 0.1 ms with nothing bracketed, every one counted `ambiguous` with "none 0 %".
        row(14, "arrival", {}, 0.1);
        row(15, "arrival", { "xfer.in": 0.05 }, 0.4);
        row(16, "arrival", { "xfer.in": 0.2, "br.blit": 0.7 }, 1.1);   // over the floor: judged
        const rep = rp.report();
        expect(rowSeq(rep, 14).verdict.bucket).toBe("trivial");
        expect(rowSeq(rep, 14).verdict.why).toMatch(/inside the 1 ms floor/);
        expect(rowSeq(rep, 15).verdict.bucket).toBe("trivial");
        expect(rowSeq(rep, 16).verdict.bucket).toBe("BROWSER");
    });

    test("the BROWSER clause sits BELOW the residual gate: an unclosed sum stays the finding", () => {
        // The shape D237 measured on a cold frame: 2.03-2.78 ms of a 5.18-6.63 ms task in no
        // bucket at all. Here 1.0 of 5.0 ms is bracketed, so 4.0 ms is over the 1 ms bar, and the
        // task sits inside a 100 ms rAF interval, which is what the BROWSER clause reads. Move
        // that clause above the residual gate and this row reads BROWSER, hiding the 4 ms nobody
        // measured - and §8.4 rule 2 says an unclosed sum is itself the finding.
        row(11, "render", { "eng.cull": 1.0 }, 5.0);
        rp.onFrame(100, WALL0 + t);
        const r = rowSeq(rp.report(), 11);
        expect(r.timers["br.inferred"]).toBeCloseTo(95, 2);   // the clause's own input is there
        expect(r.verdict.bucket).toBe("ambiguous");
        expect(r.verdict.residualOk).toBe(false);
        expect(r.verdict.why).toMatch(/residual 4 ms over the 1 ms bar/);
    });

    test("a transfer-bound frame names TRANSFER, the fifth bucket", () => {
        // xfer.out (the post call) and xfer.in (the unwire) are the two TRANSFER timers inside
        // mainMs; one row each, because a row carrying both would still read TRANSFER if one of
        // them were labelled with another bucket.
        row(12, "render", { "xfer.out": 9 }, 10);
        row(13, "render", { "xfer.in": 9 }, 10);
        const rep = rp.report();
        expect(rowSeq(rep, 12).verdict.bucket).toBe("TRANSFER");
        expect(rowSeq(rep, 12).verdict.buckets.TRANSFER).toBeCloseTo(9, 3);
        expect(rowSeq(rep, 13).verdict.bucket).toBe("TRANSFER");
    });

    test("a row with no rAF tick reports br.inferred null and says it is not corroborated", () => {
        row(8, "render", { "eng.list": 5 }, 5.2);
        const r = rowSeq(rp.report(), 8);
        expect(r.timers["br.inferred"]).toBeNull();       // never 0 (Q8)
        expect(r.verdict.corroborated).toBe(false);
        expect(r.verdict.rafDeltaMs).toBeNull();
        expect(r.flags).toContain("inferredPending");
    });
});

// ---- BROWSER, attributed and never measured ---------------------------------

describe("br.inferred is rafDelta − mainMs, patched on the NEXT tick", () => {
    test("one task in an interval takes the whole remainder", () => {
        row(1, "render", { "eng.list": 4 }, 5.0);
        rp.onFrame(16.7, WALL0 + t);
        const r = rowSeq(rp.report(), 1);
        expect(r.timers["br.inferred"]).toBeCloseTo(11.7, 2);
        expect(r.flags).toContain("rafKnown");
        expect(r.flags).not.toContain("inferredPending");
    });

    test("two tasks in one interval: the remainder is the LAST row's and both say shared", () => {
        row(1, "render", { "eng.list": 4 }, 5.0);
        row(2, "camera", { "br.blit": 0.4 }, 0.5);
        rp.onFrame(16.7, WALL0 + t);
        const rep = rp.report();
        expect(rowSeq(rep, 1).timers["br.inferred"]).toBe(0);
        expect(rowSeq(rep, 2).timers["br.inferred"]).toBeCloseTo(16.7 - 5.5, 2);
        expect(rowSeq(rep, 1).flags).toContain("shared");
        expect(rowSeq(rep, 2).flags).toContain("shared");
        // and the BROWSER clause reads the ROW's own br.inferred (D209), so only the last row of
        // a shared interval can be headlined BROWSER; the others name their own top bucket.
        expect(rowSeq(rep, 1).verdict.bucket).not.toBe("BROWSER");
        expect(rowSeq(rep, 1).verdict.bucket).toBe("ENGINE");
        // and the 0 has a sentence of its own beside br.inferred's: a reader who meets 0 on a
        // row inside a 100 ms interval would otherwise read it as a free browser (D207's rule).
        expect(rep.notes.shared).toMatch(/does not own the remainder/);
        expect(rep.notes.shared).toMatch(/D209, D248/);
    });

    test("a delta shorter than the work clamps at 0 and flags it", () => {
        row(1, "render", { "eng.list": 20 }, 21);
        rp.onFrame(16.7, WALL0 + t);
        const r = rowSeq(rp.report(), 1);
        expect(r.timers["br.inferred"]).toBe(0);
        expect(r.flags).toContain("clamped");
    });

    test("the frame meter's own loop is the source, through one additive callback", () => {
        const fm = new FrameMeter();
        const seen = [];
        fm.onFrame = (ms, ts) => seen.push([ms, ts]);
        fm.record(16.7);
        expect(seen.length).toBe(1);
        expect(seen[0][0]).toBeCloseTo(16.7, 3);
        expect(typeof seen[0][1]).toBe("number");
        expect(fm.frames).toBe(1);                        // the meter's own reading is unchanged
        // and the hidden-tab pause never reaches it: rAF stops, and the next callback would
        // report the whole absence as one enormous frame (the file's own comment)
        const wasHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        fm.record(1800);
        Object.defineProperty(document, "hidden", wasHidden || { configurable: true, get: () => false });
        expect(seen.length).toBe(1);
        expect(fm.hidden).toBe(1);
    });

    test("the shipped wiring is one assignment: FrameMeter.onFrame IS rasterPerf.onFrame", () => {
        // `useKobinEngine` assigns exactly this beside the engine it constructs (D214), so the
        // module's export is used as a BARE callback and may not read `this`. Without the
        // assignment br.inferred, rafDelta and the rafKnown/shared/clamped flags have no
        // producer at all, and every shipped row would read `corroborated: false`.
        const fm = new FrameMeter();
        fm.onFrame = rp.onFrame;
        row(1, "render", { "eng.list": 4 }, 5.0);
        fm.record(16.7);
        const r = rowSeq(rp.report(), 1);
        expect(r.timers["br.inferred"]).toBeCloseTo(11.7, 2);
        expect(r.verdict.corroborated).toBe(true);
        expect(r.verdict.rafDeltaMs).toBeCloseTo(16.7, 2);
        expect(r.flags).toContain("rafKnown");
    });
});

// ---- X2 — every entry carries frameSeq, INCLUDING under the 8 ms floor ------

describe("X2 — every entry carries a frameSeq, asserted under the 8 ms floor", () => {
    test("40 sub-8 ms rows all reach report() and none reaches the engine's perf log", () => {
        const E = mkEngine(400, 300);
        rp.attach({ now, wall, notePerf: (op, t0, x) => E.notePerf(op, t0, x),
            store: { report: () => ({ ...STORE }) }, pack: PACK });
        const before = E.perfLog.length;
        // 0.4–7.9 ms, every one under `_perf`'s floor, and distinct so the worst 25 and the
        // last 25 between them cover all 40
        for (let i = 0; i < 40; i++) {
            row(100 + i, "render", { "eng.list": 0.3 }, i < 15 ? 7.9 - i * 0.1 : 0.4 + (i % 5) * 0.3);
        }
        const rep = rp.report();
        expect(rep.frames.length).toBe(40);
        for (const r of rep.frames) {
            expect(r.frameSeq).not.toBe(0);
            expect(r.mainMs).toBeLessThan(8);
        }
        expect(E.perfLog.filter((e) => e.op === "rasterRender").length).toBe(0);
        expect(E.perfLog.length).toBe(before);
        expect(rep.ring.rowsWritten).toBe(40);
    });

    test("a render OVER the floor does reach the perf log, so the floor is the reason", () => {
        row(1, "render", { "eng.list": 8 }, 9.0);
        expect(perfCalls.filter((c) => c.op === "rasterRender").length).toBe(1);
        expect(perfCalls[0].frameSeq).toBe(1);
        expect(perfCalls[0].mainMs).toBeCloseTo(9.0, 3);
    });

    test("a crawl tick carries a frameSeq of its own, and it cannot collide with a render's", () => {
        row(1, "render", { "eng.list": 1 }, 2);
        rp.noteCrawl({ phases: 8, lastPhaseMs: 33, pixels: 467265, bytes: 10.48e6, repaints: 1 });
        rp.noteCrawl({ phases: 8, lastPhaseMs: 0, pixels: 0, bytes: 10.48e6, repaints: 0 });
        const seqs = rp.report().frames.map((r) => r.frameSeq);
        expect(seqs).toEqual([1, -1, -2]);
        expect(new Set(seqs).size).toBe(3);
    });
});

// ---- X3 — a stale job, with why and with before/after dispatch --------------

describe("X3 — a dropped job is logged with why and with when", () => {
    test("before dispatch and after arrival, each with epoch, q, frameId, frameSeq and plates", () => {
        rp.noteDrop({ frameSeq: 11, q: -3, frameId: "0", epoch: 4 },
            { jobId: null, plates: Int32Array.from([0, 0, 1, 0]), why: "frame", before: true });
        rp.noteDrop({ frameSeq: 12, q: -2, frameId: "0", epoch: 5 },
            { jobId: 9, plates: Int32Array.from([2, 0]), why: "epoch", before: false,
                stale: [0] });
        const st = rp.report().stale;
        expect(st.length).toBe(2);
        const byWhy = Object.fromEntries(st.map((s) => [s.why, s]));
        expect(byWhy.frame.before).toBe(true);
        expect(byWhy.frame.plates).toBe(2);
        expect(byWhy.frame.frameSeq).toBe(11);
        expect(byWhy.frame.q).toBe("-3");
        expect(byWhy.frame.epoch).toBe(4);
        expect(byWhy.frame.frameId).toBe("0");
        expect(byWhy.frame.t).toBe(WALL0 + t);
        expect(byWhy.epoch.before).toBe(false);
        expect(byWhy.epoch.jobId).toBe(9);
        expect(byWhy.epoch.stale).toBe(1);
        expect(perfCalls.filter((c) => c.op === "rasterStale").length).toBe(2);
    });

    test("the log is bounded and keeps the LAST drops", () => {
        for (let i = 0; i < 60; i++) {
            rp.noteDrop({ frameSeq: i, q: -3 }, { why: "q" + i, before: i % 2 === 0, plates: null });
        }
        const st = rp.report().stale;
        expect(st.length).toBe(8);
        expect(st[0].why).toBe("q59");
        expect(st[7].why).toBe("q52");
        expect(rp.report().meta.staleDrops).toBe(60);
    });

    test("every drop is counted by reason, and the tally is bounded too", () => {
        // The 8-deep log answers "which drops", the tally answers "how many of each": a phone
        // that dropped 300 strips shows eight whys and one total without it (§8.5).
        for (let i = 0; i < 60; i++) {
            rp.noteDrop({ frameSeq: i }, { why: ["epoch", "quantum", "frame"][i % 3] });
        }
        let rep = rp.report();
        expect(rep.staleByWhy).toEqual({ epoch: 20, quantum: 20, frame: 20 });
        expect(rep.stale.length).toBe(8);
        expect(rep.meta.staleDrops).toBe(60);
        // twelve distinct reasons are kept and the rest fall into `other`, so a `why` a caller
        // builds out of a frame id cannot grow the section without bound
        for (let i = 0; i < 20; i++) rp.noteDrop({ frameSeq: i }, { why: "w" + i });
        rep = rp.report();
        const why = rep.staleByWhy;
        expect(Object.keys(why).length).toBe(13);         // twelve named, plus `other`
        expect(why.other).toBe(11);
        expect(Object.values(why).reduce((a, b) => a + b, 0)).toBe(80);
        expect(rep.meta.staleDrops).toBe(80);
    });
});

// ---- X4 — cache hits as loudly as misses, and the mode on every row ---------

describe("X4 — hits are logged as loudly as misses", () => {
    test("the row carries wanted, hits and misses, and the store's own three ride beside", () => {
        rp.beginFrame(3, "render");
        rp.noteView({ mode: "plates", q: -3, s: 1.0905, dpr: 2.625 });
        rp.noteSubmit({ frameSeq: 3, q: -3 }, 4, 2);       // 4 misses in 2 strips
        rp.noteCompose(1.2, 11, 11);                       // 11 hits composed
        t += 3.0;
        rp.endFrame();
        const rep = rp.report();
        const r = rowSeq(rep, 3);
        expect(r.counts.hits).toBe(11);
        expect(r.counts.misses).toBe(4);
        expect(r.counts.platesWanted).toBe(15);
        expect(r.counts.jobsPosted).toBe(2);
        expect(r.mode).toBe("plates");
        expect(r.q).toBe(-3);
        expect(r.s).toBeCloseTo(1.09, 2);
        expect(rep.plates.hits).toBe(41);
        expect(rep.plates.misses).toBe(7);
        expect(rep.plates.evictions).toBe(2);
    });

    test("an arrival's plates are counted as arrivals and not as cache hits", () => {
        arrivalPair({ view: { mode: "plates", q: -3, s: 1.09 } });
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(r.counts.platesArrived).toBe(2);
        expect(r.counts.hits).toBeUndefined();
        expect(r.counts.plateBlits).toBe(2);
    });

    test("the worker's per-plate counts reach the row and the session totals", () => {
        arrivalPair({});
        const rep = rp.report();
        const r = rowSeq(rep, 1, "arrival");
        expect(r.counts.edges).toBe(8000);
        expect(r.counts.coveredPx).toBe(360000);
        expect(r.counts.families).toBe(60);
        expect(rep.counts.edges).toBe(8000);
        expect(rep.hist.plateMs["<=33"]).toBe(2);
    });
});

// ---- X5 — the section is bounded (F58) --------------------------------------

describe("X5 — the report's raster section is bounded", () => {
    test("400 rows, 200 jobs and 60 drops stay under 64 KB and do not grow with more", () => {
        for (let i = 0; i < 200; i++) arrivalPair({ seq: i + 1 });
        for (let i = 0; i < 400; i++) row(1000 + i, "render", { "eng.list": 0.4 }, 0.9);
        for (let i = 0; i < 60; i++) rp.noteDrop({ frameSeq: i, q: -3 }, { why: "frame", before: true });
        // BYTES, not characters: F58's bound is on what is sent, and the section's own `notes`
        // block carries six `§`, two bytes each in UTF-8 (the D218/D240 defect, one file over).
        const a = rp.byteLen(JSON.stringify(rp.report()));
        for (let i = 0; i < 1600; i++) row(5000 + i, "render", { "eng.list": 0.4 }, 0.9);
        const b = rp.byteLen(JSON.stringify(rp.report()));
        // eslint-disable-next-line no-console
        console.log(`[stage 6] raster section: ${a} bytes at 400 rows, ${b} at 2,000 notes`);
        expect(a).toBeLessThan(64 * 1024);
        expect(b).toBeLessThan(64 * 1024);
        expect(b).toBeLessThanOrEqual(a + 4096);
        expect(rp.report().frames.length).toBeLessThanOrEqual(50);
        expect(rp.report().worstJobs.length).toBe(25);
        expect(rp.report().stale.length).toBe(8);
    });

    test("the ring is fixed and its rows wrap: 2,000 notes, 400 rows, one allocation", () => {
        row(1, "render", { "eng.list": 1 }, 2);
        const allocs = rp.report().meta.allocs;
        expect(allocs).toBe(5);                            // three typed arrays and two pools
        for (let i = 0; i < 2000; i++) row(i + 2, "render", { "eng.list": 0.4 }, 0.9);
        const rep = rp.report();
        expect(rep.meta.allocs).toBe(allocs);              // nothing allocated per row (FC5, N8)
        expect(rep.ring.used).toBe(400);
        expect(rep.ring.rowsWritten).toBe(2001);
        expect(rep.ring.wraps).toBe(5);
        expect(rep.ring.bytes).toBe(400 * 40 * 4 * 2 + 400 * 8);
        expect(rep.ring.bytes).toBe(131200);
    });

    test("the ring is allocated on the first note, so an SVG-only session pays nothing", () => {
        rp.reset();
        attachFake();
        const empty = rp.report();
        expect(empty.ring.allocated).toBe(false);
        expect(empty.ring.used).toBe(0);
        expect(empty.frames).toEqual([]);
        expect(rp.byteLen(JSON.stringify(empty))).toBeLessThan(8 * 1024);
        row(1, "render", { "eng.list": 1 }, 2);
        expect(rp.report().ring.allocated).toBe(true);
    });

    test("the section states its own size, and carries the report's total when it is given", () => {
        row(1, "render", { "eng.list": 1 }, 2);
        const rep = rp.report();
        const json = JSON.stringify(rep);
        const measured = rp.byteLen(json);
        // measured before its own digits were written in, so it is short by exactly those
        expect(rep.size.sectionBytes).toBeGreaterThan(measured - 20);
        expect(rep.size.sectionBytes).toBeLessThanOrEqual(measured);
        // and it is BYTES: the section's own notes carry § and an em dash, so a character
        // count reads short of the true size even on a report with no drawing name in it
        expect(measured).toBeGreaterThan(json.length);
        expect(rep.size.reportBytes).toBeNull();
        expect(rp.report({ payloadBytes: 92e6 }).size.reportBytes).toBe(92e6);
    });

    test("the section leaves the one hole the report hook patches its total into", () => {
        row(1, "render", { "eng.list": 1 }, 2);
        const json = JSON.stringify(rp.report());
        // `useKobinEngine.sendReport` stringifies the body ONCE and replaces this literal with
        // the body's own length. Omit the field, or write it as 0, and the patch would silently
        // do nothing and every phone report would state no total (§15.3 stage 6, addition 2).
        expect(json.split("\"reportBytes\":null").length - 1).toBe(1);
        const patched = json.replace("\"reportBytes\":null", "\"reportBytes\":92000000");
        expect(JSON.parse(patched).size.reportBytes).toBe(92e6);
    });

    test("the hook patches BYTES, not characters: byteLen is what it counts with", () => {
        // The hook's line is `body.replace(…, rasterPerf.byteLen(body))`. `body.length` is
        // characters, so one drawing name outside ASCII undercounts against F58's 20 MB bar —
        // the defect D218 fixed for sectionBytes two lines away. jsdom has no TextEncoder, so
        // this exercises the scan — which is why the scan may not return characters either.
        const body = JSON.stringify({ name: "Kobin’s canvas — 2026", reportBytes: null });
        expect(rp.byteLen(body)).toBeGreaterThan(body.length);
        expect(rp.byteLen(body)).toBe(body.length + 4);      // ’ and — are 3 bytes each in UTF-8
        expect(rp.byteLen("plain ascii")).toBe(11);
        expect(rp.byteLen("🖌")).toBe(4);                    // one surrogate pair, four bytes
        // a LONE high surrogate is 3 bytes and does not swallow what follows: the scan agrees
        // with TextEncoder on every input, not only on the well-formed ones JSON.stringify
        // produces (`format2.js`'s utf8Encode makes the same check).
        expect(rp.byteLen("\ud800é")).toBe(5);               // 3 + 2, not 4
        expect(rp.byteLen("a\ud800")).toBe(4);               // 1 + 3, at the end of the string
    });
});

// ---- X6 — durations only: the worker's clock origin reaches no number -------

describe("X6 — the report's reading of the worker's durations", () => {
    test("a job whose worker clock is 1e6 ms ahead reports bit-identical numbers", () => {
        const drive = (offset) => {
            rp.reset(); t = 1000; perfCalls = []; attachFake();
            arrivalPair({ resExtra: { startedAt: offset, receivedAt: offset + 3,
                finishedAt: offset + 41 } });
            return JSON.stringify(rp.report());
        };
        const plain = drive(0);
        const ahead = drive(1e6);
        expect(ahead).toBe(plain);                         // every field, not only the timers
        expect(plain).toContain("\"queueWait\"");
    });

    test("queueing is the main thread's own subtraction and is never re-derived", () => {
        arrivalPair({ queueingMs: 3.0 });
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(r.timers.queueing).toBeCloseTo(3.0, 3);
        // postMs and recvMs are sub-measures of it: adding them would double-count and drive
        // the wall residual negative (Q7)
        expect(r.residualWallMs).toBeGreaterThan(0);
        const job = rp.report().worstJobs[0];
        expect(job.postMs + job.recvMs).toBeLessThan(job.queueingMs + 1e-6);
    });

    test("the per-plate stride the module reads is rasterJob's own", () => {
        arrivalPair({ per: [PLATE_A] });
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(TIMINGS_PER_PLATE).toBe(7);
        expect(COUNTS_PER_PLATE).toBe(8);
        // one plate, so a mis-read stride would put another phase's number in each slot
        expect(r.timers["ras.edges"]).toBeCloseTo(9.0, 3);
        expect(r.timers["ras.union"]).toBeCloseTo(4.0, 3);
        expect(r.timers["ras.accum"]).toBeCloseTo(3.0, 3);
        expect(r.timers["eng.clip"]).toBeCloseTo(0.5, 3);
        expect(r.counts.items).toBe(120);
        expect(r.counts.coveredPx).toBe(180000);
    });
});

// ---- the packer's counters, carried and named -------------------------------

describe("the counters this stage must not read as alarms", () => {
    test("a non-zero mixedWinding and nonFinite are CARRIED into report(), with F76 named", () => {
        PACK.mixedWinding = 3;
        PACK.nonFinite = 2;
        PACK.overBound = 1;
        row(1, "render", { "eng.list": 1 }, 2);
        const rep = rp.report();
        expect(rep.pack.mixedWinding).toBe(3);
        expect(rep.pack.nonFinite).toBe(2);
        expect(rep.pack.overBound).toBe(1);
        expect(rep.notes.mixedWinding).toMatch(/F76/);
        expect(rep.notes.overBound).toMatch(/D287/);
        expect(rep.notes.brInferred).toMatch(/never measured/);
    });

    test("the core's seven guards and the worker's report ride in the same section", () => {
        CORE.arcOverTurn = 4;
        row(1, "render", { "eng.list": 1 }, 2);
        const rep = rp.report();
        expect(rep.core.arcOverTurn).toBe(4);
        expect(rep.core.unionSplits).toBe(1);
        expect(rep.worker.jobs).toBe(12);
        expect(rep.picture.plates).toBe(15);
        expect(rep.ants.dashes).toBe(0);
    });

    test("§8.5's order: the refusal counters first, and the two guard sets told apart", () => {
        PACK.mixedFamily = 0;
        PACK.rejected = 0;
        row(1, "render", { "eng.list": 1 }, 2);
        const rep = rp.report();
        expect(Object.keys(rep.pack).slice(0, 5))
            .toEqual(["nonFinite", "overBound", "mixedWinding", "mixedFamily", "rejected"]);
        expect(Object.keys(rep.core).slice(0, 4))
            .toEqual(["nonFinite", "fullClears", "arcClamped", "arcOverTurn"]);
        expect(Object.keys(rep.worker.guards)[0]).toBe("nonFinite");
        expect(rep.pack.items).toBe(40);                  // and the costs still ride behind them
        expect(rep.core.unionSplits).toBe(1);
        expect(rep.worker.jobs).toBe(12);
        // core is the MAIN thread's guards (sync mode only) and worker.guards the pool's totals
        expect(rep.notes.core).toMatch(/sync mode/);
    });

    test("with nothing attached the five scalar sources are null and the ring still reports", () => {
        rp.detach();
        rp.attach({ now, wall });
        row(1, "render", { "eng.list": 1 }, 2);
        const rep = rp.report();
        expect(rep.pack).toBeNull();
        expect(rep.core).toBeNull();
        expect(rep.worker).toBeNull();
        expect(rep.picture).toBeNull();
        expect(rep.plates).toBeNull();
        expect(rep.frames.length).toBe(1);
    });
});

// ---- FC7 — the fifth bucket, its slots reserved, a crawl tick is a frame ----

describe("FC7 — the OVERLAY bucket and its reserved slots, before 5d exists", () => {
    test("the four timers and the seven counters are named in the shipped format", () => {
        const rep = rp.report();
        for (const n of ["ovl.decide", "ovl.paint", "ovl.blit", "ovl.live"]) {
            expect(rep.slots.timers).toContain(n);
        }
        for (const n of ["antDashes", "antStamps", "antPixels", "overlayBlitPx",
            "overlayRepaints", "liveMoves", "liveDirtyPx"]) {
            expect(rep.slots.counts).toContain(n);
        }
        expect(rp.ROWS).toBe(400);
        expect(rp.STRIDE).toBe(40);
        expect(rep.slots.timers.length).toBe(33);
        expect(rep.slots.counts.length).toBe(31);
        expect(rep.slots.spare).toEqual({ timers: 7, counts: 9 });
    });

    test("Q1's three slots are in the shipped format, in their buckets, and no longer unwritten", () => {
        // §15.3, "Stage 5b, built whole" Q1: 5b measured the view mapping, the cache lookup and
        // the overlay tail at 1.35–1.96 ms of a 5.2–6.6 ms cold frame and they were in no bucket.
        // `RasterRenderer` brackets all three (D244); the swap made them arrive here.
        const rep = rp.report();
        for (const n of ["eng.view", "eng.lookup", "ovl.tail"]) {
            expect(rep.slots.timers).toContain(n);
            expect(rep.slots.parts.main).toContain(n);       // all three are main-thread time
            expect(rep.notes.unwritten).not.toContain(n);    // a caller writes them: raster.engine's E series
        }
        // 33 names against a stride of 32 is what made the module refuse to load: the widening
        // is the whole reason this stage was reopened.
        expect(rep.slots.timers.length).toBeLessThanOrEqual(rp.STRIDE);
        // The two names that still have none, and nothing else: a slot that IS written and is
        // called unwritten reads as a measurement of 0, which is D207's failure the other way up.
        expect(rep.notes.unwritten).toMatch(/^eng\.settle and eng\.band have NO CALLER/);
    });

    test("eng.list is inside mainMs, and the report says what else the row holds", () => {
        // §15.3's Q2 end state: `KobinEngine._render` opens the row BEFORE `_buildList`, so the
        // ENGINE bucket is not read as cull + pack with its largest phase missing (D233, D241).
        // What the row also holds and no slot names — the §5.4 drain — is said rather than hidden.
        const rep = rp.report();
        expect(rep.notes.engRow).toMatch(/BEFORE _buildList/);
        expect(rep.notes.engRow).toMatch(/residualMain/);
        expect(rep.notes.engList).toBeUndefined();           // the interim note is gone, not amended
        expect(rep.slots.parts.main).toContain("eng.list");
    });

    test("a crawl tick is a row: its own frameSeq, the residual bar met, and it reaches report()", () => {
        rp.noteCrawl({ phases: 8, lastPhaseMs: 0, pixels: 0, bytes: 10.48e6, repaints: 0 });
        rp.noteCrawl({ phases: 9, lastPhaseMs: 33, pixels: 467265, bytes: 10.48e6, repaints: 1,
            decideMs: 0, blitMs: 0, dashes: 7134, stamps: 40852, blitPx: 467265 });
        const rep = rp.report();
        const zero = rowSeq(rep, -1), busy = rowSeq(rep, -2);
        expect(zero.kind).toBe("crawl");
        expect(zero.mainMs).toBe(0);
        expect(busy.mainMs).toBeCloseTo(33, 3);
        expect(busy.timers["ovl.paint"]).toBeCloseTo(33, 3);
        expect(busy.counts.antDashes).toBe(7134);
        expect(busy.counts.antStamps).toBe(40852);
        expect(busy.counts.antPixels).toBe(467265);
        expect(busy.counts.overlayRepaints).toBe(1);
        expect(busy.residualMainMs).toBeCloseTo(0, 3);
        expect(busy.verdict.bucket).toBe("OVERLAY");
        expect(rep.memory.overlayBytes).toBe(10.48e6);
        expect(rep.ring.byKind.crawl).toBe(2);
    });

    test("the two structural zeros are named as structural", () => {
        expect(rp.report().slots.zeros).toEqual(["eng.local", "ras.composite"]);
        arrivalPair({});
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(r.timers["eng.local"]).toBeUndefined();     // zero slots are omitted, not printed
        expect(r.timers["ras.composite"]).toBeUndefined();
        expect(rp.report().notes.engLocal).toMatch(/structural zero/);
        expect(rp.report().notes.rasComposite).toMatch(/structural zero/);
    });
});

// ---- GrowthLog swaps the node count -----------------------------------------

describe("GrowthLog takes the three raster numbers and keeps the node count", () => {
    /**
     * `maybeSample` is throttled to one sample per 2 s of the PROCESS clock, and a jest worker
     * can be younger than that — which is why the sample is forced rather than hoped for.
     */
    const sampled = () => { const g = new GrowthLog({}); g._last = -1e9; g.maybeSample(); return g; };

    test("attached: plates, plateBytes and packedBytes are the store's and the packer's", () => {
        const g = sampled();
        const s = g.samples[0];
        expect(s.plates).toBe(15);
        expect(s.plateBytes).toBe(15 * 1048576);
        expect(s.packedBytes).toBe(4.1e6);
        expect(s.svgNodes).not.toBeNull();                 // the overlay is still SVG
        expect(g.report().last.plates).toBe(15);
    });

    test("detached: the three are null and the node count is untouched", () => {
        rp.detach();
        const s = sampled().samples[0];
        expect(s.plates).toBeNull();
        expect(s.plateBytes).toBeNull();
        expect(s.packedBytes).toBeNull();
        expect(s.svgNodes).not.toBeNull();
    });
});

// ---- the LoAF join ----------------------------------------------------------

describe("Long Animation Frames are joined at report time, by wall-clock overlap", () => {
    const loaf = (worst) => ({ report: () => ({ supported: true, count: worst.length,
        totalMs: 100, worst }) });

    test("a row whose interval intersects an entry carries it, with the overlap", () => {
        row(1, "render", { "eng.list": 100 }, 120);
        const at = WALL0 + 1000;                            // the row's own t
        const rep = rp.report({ longFrames: loaf([{ t: at + 50, ms: 200, paintMs: 30,
            scriptMs: 150 }]) });
        const r = rowSeq(rep, 1);
        expect(r.loaf.ms).toBe(200);
        expect(r.loaf.paintMs).toBe(30);
        expect(r.loaf.overlapMs).toBeCloseTo(70, 1);        // 1050…1120 against 1050…1250
        expect(rep.loaf.supported).toBe(true);
    });

    test("no observer at all: the section says absent and every row still has its buckets", () => {
        row(1, "render", { "eng.list": 114 }, 120);
        const rep = rp.report();
        expect(rep.loaf).toBe("absent");
        expect(rowSeq(rep, 1).loaf).toBeUndefined();
        expect(rowSeq(rep, 1).verdict.bucket).toBe("ENGINE");
        expect(rep.notes.loaf).toMatch(/50 ms LoAF threshold/);
    });

    test("a row that misses every entry joins nothing", () => {
        row(1, "render", { "eng.list": 4 }, 5);
        const rep = rp.report({ longFrames: loaf([{ t: WALL0 + 5e5, ms: 60, paintMs: 1,
            scriptMs: 50 }]) });
        expect(rowSeq(rep, 1).loaf).toBeUndefined();
    });
});

// ---- the report's own shape -------------------------------------------------

describe("the report keeps the worst rows AND the last ones", () => {
    test("50 rows at most: the worst 25 by mainMs and the last 25, deduped and in time order", () => {
        for (let i = 0; i < 300; i++) {
            const heavy = i < 25 ? 120 + i : 1 + (i % 3);
            row(i + 1, "render", { "eng.list": heavy - 0.4 }, heavy);
        }
        const rep = rp.report();
        expect(rep.frames.length).toBe(50);
        const seqs = rep.frames.map((r) => r.frameSeq);
        expect(seqs.slice()).toEqual(seqs.slice().sort((a, b) => a - b));
        expect(seqs).toContain(1);                          // a 120 ms row from the start
        expect(seqs).toContain(300);                        // and the last row before the report
        expect(new Set(seqs).size).toBe(50);
    });

    test("zero slots are omitted and the slot names are printed once", () => {
        row(1, "render", { "eng.list": 2 }, 3);
        const rep = rp.report();
        expect(Object.keys(rowSeq(rep, 1).timers)).toEqual(["eng.list", "br.inferred"]);
        expect(rep.slots.timers[0]).toBe("eng.list");
        expect(rep.totals["eng.list"]).toBeCloseTo(2, 3);
        expect(rep.hist.mainMs["<=4"]).toBe(1);
    });

    test("a bracket left open is closed by the next one and says so", () => {
        rp.beginFrame(1, "render");
        rp.add(rp.T["eng.list"], 1);
        t += 2;
        rp.beginFrame(2, "render");
        t += 1;
        rp.endFrame();
        const rep = rp.report();
        expect(rep.meta.unclosed).toBe(1);
        expect(rowSeq(rep, 1).flags).toContain("truncated");
        expect(rep.frames.length).toBe(2);
    });

    test("a truncated row keeps its WALL partition, not only mainMs", () => {
        rp.beginFrame(1, "render");
        rp.noteSubmit({ frameSeq: 1, q: -3 }, 1, 1);      // the queued-at the row's wall starts at
        t += 2;
        rp.endFrame();
        const postedAt = t;
        t += 40;
        rp.beginFrame(1, "arrival");
        rp.noteJob({ jobId: 7, frameSeq: 1, postedAt, arrivedAt: t, wallMs: 40, queueingMs: 3,
            recvMs: 0.6, bytesOut: 0, bytesIn: 0 }, mkRes([PLATE_A], 2.0));
        t += 3;
        rp.beginFrame(2, "render");                       // truncates the arrival row
        t += 1;
        rp.endFrame();
        const r = rowSeq(rp.report(), 1, "arrival");
        expect(r.flags).toContain("truncated");
        expect(r.mainMs).toBeCloseTo(3, 3);
        expect(r.wallMs).toBeCloseTo(45, 3);              // queued-at → the truncating call
        // queueWait 2 + queueing 3 + recvToStart 0.5 + startToFinish 17.5 + serialise 2
        expect(r.residualWallMs).toBeCloseTo(45 - 25, 3);
    });

    test("a note with no row open is counted, never dropped in silence", () => {
        rp.add(rp.T["eng.list"], 5);
        rp.bump(rp.C.hits, 2);
        expect(rp.report().meta.orphanAdds).toBe(2);
        rp.endFrame();
        expect(rp.report().meta.orphanEnds).toBe(1);
    });
});

// ---- §8.6 row 18: what this instrument itself costs --------------------------

describe("the perf record's own cost (§8.6 row 18)", () => {
    test("the per-row write and report()'s bytes and ms, printed; only the bytes are asserted", () => {
        const N = 2000;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) {
            rp.beginFrame(i + 1, "render");
            rp.add(rp.T["eng.list"], 2);
            rp.add(rp.T["br.blit"], 1);
            rp.bump(rp.C.hits, 15);
            t += 3;
            rp.endFrame();
        }
        const perRowUs = ((performance.now() - t0) / N) * 1000;
        for (let i = 0; i < 40; i++) arrivalPair({ seq: 9000 + i });
        let best = Infinity, worst = 0, bytes = 0;
        for (let k = 0; k < 20; k++) {
            const s0 = performance.now();
            bytes = rp.byteLen(JSON.stringify(rp.report()));   // bytes, as F58's bound is
            const ms = performance.now() - s0;
            if (ms < best) best = ms;
            if (ms > worst) worst = ms;
        }
        // eslint-disable-next-line no-console
        console.log(`[stage 6] row write ${perRowUs.toFixed(2)} us/row over ${N} rows; `
            + `report ${bytes} bytes, ${best.toFixed(3)}-${worst.toFixed(3)} ms over 20 calls`);
        expect(bytes).toBeLessThan(64 * 1024);              // F58: the only bar in this test
    });
});
