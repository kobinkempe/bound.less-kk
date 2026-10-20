/**
 * rasterCore.runs.test.js — F154's row runs. A plate that skips the runs of an outline missing its rows must paint the
 * whole walk's bytes: random loops of every record kind across several plates, the fast path and the union pass, a
 * pending mark, a clip, transparent paper and a residual, at run lengths 1 to 16; arcs whose chord misses the plate
 * but whose bulge, major arc or whole turn reaches into it. Then the wire's check, the pack's runs and the worker.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { wireJob, unwireJob, validateJob } from "./rasterJob";
import { runJob } from "../worker/rasterWorker";
import { Loop } from "../geometry/loop";

const TW = core.TW, TH = core.TH, TAU = Math.PI * 2;

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** An arc record from A to B sweeping `th` (centre on the chord's left for th > 0); its centre and radius are consistent. */
function arcRec(ax, ay, bx, by, th) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    const R = L / (2 * Math.sin(Math.abs(th) / 2));
    const ux = dx / L, uy = dy / L, d = R * Math.cos(Math.abs(th) / 2) * Math.sign(th);
    const cx = (ax + bx) / 2 - uy * d, cy = (ay + by) / 2 + ux * d;
    return [1, cx, cy, R, Math.atan2(ay - cy, ax - cx), th, bx, by];
}
/** A whole turn from A back to A about C. */
const turnRec = (ax, ay, cx, cy, sign) => [1, cx, cy, Math.hypot(ax - cx, ay - cy), Math.atan2(ay - cy, ax - cx), sign * TAU, ax, ay];
/** The cut forms carry their end where the core reads it; the rest is finite filler. */
const cutLine = (bx, by) => [2, 0, 0, 1, 1, 0, 1, bx, by];
const cutArc = (rec) => [3, rec[1], rec[2], rec[3], rec[4], rec[5], 0, 1, 0, 0, 1, 1, 0, 1, rec[6], rec[7]];

/** A random closed loop of `n` pieces about (cx, cy): lines, arcs (some major), cut lines and cut arcs, a whole turn. */
function randomLoop(rand, cx, cy, R, n) {
    const pts = [];
    for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, r = R * (0.45 + 0.55 * rand());
        pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
    }
    const nums = [pts[0][0], pts[0][1]];
    for (let k = 1; k < n; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k], u = rand();
        if (ax === bx && ay === by) continue;
        if (u < 0.3) nums.push(0, bx, by);
        else if (u < 0.55) nums.push(...arcRec(ax, ay, bx, by, (rand() < 0.5 ? -1 : 1) * (0.2 + 2.6 * rand())));
        else if (u < 0.65) nums.push(...arcRec(ax, ay, bx, by, (rand() < 0.5 ? -1 : 1) * (3.3 + 2.5 * rand())));
        else if (u < 0.78) nums.push(...cutLine(bx, by));
        else if (u < 0.9) nums.push(...cutArc(arcRec(ax, ay, bx, by, (rand() < 0.5 ? -1 : 1) * (0.3 + 2 * rand()))));
        else { nums.push(...turnRec(ax, ay, ax + 40 * rand() - 20, ay + 40 * rand() - 20, rand() < 0.5 ? -1 : 1)); nums.push(0, bx, by); }
    }
    return nums;
}

/** Arcs whose chord misses plate row 0..512 while the arc reaches into it: a bulge, a major arc, a whole turn. */
function reachLoops(dx = 0) {
    const x = (v) => v + dx;
    return [
        [x(100), -20, ...arcRec(x(100), -20, x(400), -20, -1.75), 0, x(400), -200, 0, x(100), -200],
        [x(100), 560, ...arcRec(x(100), 560, x(260), 560, 4.9), 0, x(260), 700, 0, x(100), 700],
        [x(300), -60, ...turnRec(x(300), -60, x(300), 40, 1), 0, x(330), -200, 0, x(290), -200],
        // the closing edge, from (450, -300) back to the start, is this loop's only piece but one in the plate's rows
        [x(450), 600, 0, x(450), 900, 0, x(500), 900, 0, x(500), -300, 0, x(450), -300],
    ];
}

/** The box a loop's records can reach: their points, each arc's circle. */
function loopBox(nums, box) {
    const take = (x, y) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
    take(nums[0], nums[1]);
    const W = { 0: 3, 1: 8, 2: 9, 3: 16 };
    for (let o = 2; o < nums.length; o += W[nums[o]]) {
        const c = nums[o];
        if (c === 0) take(nums[o + 1], nums[o + 2]);
        else if (c === 2) take(nums[o + 7], nums[o + 8]);
        else {
            const R = nums[o + 3];
            take(nums[o + 1] - R, nums[o + 2] - R); take(nums[o + 1] + R, nums[o + 2] + R);
            take(c === 1 ? nums[o + 6] : nums[o + 14], c === 1 ? nums[o + 7] : nums[o + 15]);
        }
    }
}

/**
 * A hand-built job (§3.3) of `items` — { loops } or { rings } (kind 1), `fam`, `union`, `sign`, `mask` (a mark's slot),
 * `bits` (the marks over it), `alpha`, `rgb` — at Zq with residual `res`; `runs` (a run length) attaches row runs.
 */
function makeJob(items, { plates, Zq = 1, res = [0, 0], paper = [0, 0, 0], runs = 0 }) {
    const n = items.length, geom = [], subs = [];
    const meta = new Uint32Array(8 * n), attr = new Float64Array(9 * n), rgb = new Uint8Array(3 * n);
    const parts = [], subRun = [];
    let nRuns = 0;
    items.forEach((it, i) => {
        const gs = geom.length, ss = subs.length, box = [Infinity, Infinity, -Infinity, -Infinity];
        if (it.rings) {
            for (const ring of it.rings) {
                subs.push((geom.length - gs) / 2);
                for (const [x, y] of ring) { geom.push(x, y); box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
            }
        } else {
            for (const loop of it.loops) { subs.push(geom.length - gs); for (const v of loop) geom.push(v); loopBox(loop, box); }
        }
        const kind = it.rings ? 1 : 0, gl = geom.length - gs;
        meta[i * 8] = kind; meta[i * 8 + 1] = it.fam || 0; meta[i * 8 + 2] = gs; meta[i * 8 + 3] = gl;
        meta[i * 8 + 4] = ss; meta[i * 8 + 5] = subs.length - ss;
        meta[i * 8 + 6] = (it.union ? 4 : 0) | (it.mask != null ? 8 : 0);
        meta[i * 8 + 7] = it.mask != null ? it.mask : (it.bits || 0);
        const a = i * 9;
        attr[a] = box[0] - 2 + res[0]; attr[a + 1] = box[1] - 2 + res[1]; attr[a + 2] = box[2] + 2 + res[0]; attr[a + 3] = box[3] + 2 + res[1];
        attr[a + 4] = res[0]; attr[a + 5] = res[1]; attr[a + 7] = it.alpha != null ? it.alpha : 1; attr[a + 8] = it.union ? (it.sign || 0) : 0;
        const c = it.rgb || [255, 255, 255];
        rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
        if (runs) {
            const r = core.rowRuns(kind, Float64Array.from(geom.slice(gs)), Uint32Array.from(subs.slice(ss)), gl, runs);
            for (const v of r.subRun) subRun.push(nRuns + v);
            parts.push(...r.runs);
            nRuns += r.runs.length / 3;
        }
    });
    const job = {
        Zq, plates: Int32Array.from(plates), paper: Uint8Array.from(paper), nItems: n,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    };
    if (runs) { job.runs = Float64Array.from(parts); job.subRun = Uint32Array.from(subRun); }
    return job;
}

/** Every plate of the job drawn with and without its runs: the bytes and the counts but the chords must agree. */
function compareRuns(items, opts, clip = null) {
    const whole = makeJob(items, opts);
    const out = { chordsWhole: 0, chordsRuns: 0, ink: 0 };
    for (const per of [1, 2, 5, 16]) {
        const ran = makeJob(items, { ...opts, runs: per });
        validateJob(ran);
        for (let p = 0; p < opts.plates.length / 2; p++) {
            const A = new Uint8ClampedArray(TW * TH * 4), B = new Uint8ClampedArray(TW * TH * 4);
            const cA = new Uint32Array(8), cB = new Uint32Array(8);
            core.renderPlate(whole, p, A, cA, undefined, clip);
            core.renderPlate(ran, p, B, cB, undefined, clip);
            let diff = 0;
            for (let q = 0; q < A.length; q++) if (A[q] !== B[q]) diff++;
            expect({ per, p, diff }).toEqual({ per, p, diff: 0 });
            expect([cA[0], cA[1], cA[2], cA[3], cA[4], cA[6], cA[7]]).toEqual([cB[0], cB[1], cB[2], cB[3], cB[4], cB[6], cB[7]]);
            if (per === 1) { out.chordsWhole += cA[5]; out.chordsRuns += cB[5]; out.ink += cA[7]; }
        }
    }
    return out;
}

/** Items over plates (0..2, -1..2): fast-path and union families, a pending mark masking one, rings of many points. */
function scene(seed, { union = true, mark = true } = {}) {
    const rand = rng(seed), items = [];
    let fam = 0;
    for (let k = 0; k < 5; k++) {
        const cx = 100 + 1300 * rand(), cy = -400 + 1800 * rand(), R = 120 + 500 * rand();
        const loops = [randomLoop(rand, cx, cy, R, 20 + Math.floor(60 * rand()))];
        if (rand() < 0.5) loops.push(randomLoop(rand, cx + 30, cy + 30, R * 0.4, 12 + Math.floor(30 * rand())));
        items.push({ loops, fam: fam++, union: union && k % 2 === 1, sign: k === 3 ? 1 : 0, alpha: 0.4 + 0.6 * rand(),
            rgb: [Math.floor(255 * rand()), Math.floor(255 * rand()), Math.floor(255 * rand())], bits: mark && k === 4 ? 1 : 0 });
    }
    const ring = [];
    for (let k = 0; k < 90; k++) { const a = (k / 90) * TAU; ring.push([700 + 600 * Math.cos(a) * (0.8 + 0.2 * rand()), 500 + 900 * Math.sin(a)]); }
    items.push({ rings: [ring, ring.slice(0, 30).map(([x, y]) => [x * 0.5 + 300, y * 0.5 + 200])], fam: fam++, union: union, alpha: 0.7, rgb: [20, 200, 90] });
    items.push({ rings: [ring.map(([x, y]) => [x + 150, y - 90])], fam: fam++, alpha: 0.5, rgb: [200, 120, 20] });   // the fast path's rings
    items.push({ loops: reachLoops(), fam: fam++, alpha: 0.9, rgb: [250, 40, 40] });
    items.push({ loops: reachLoops(600), fam: fam++, union: union, alpha: 0.6, rgb: [40, 40, 250] });
    if (mark) {
        // A pending mark paints nothing and masks the family that names its slot; it is drawn first, in its own pass.
        items.splice(0, 0, { loops: [randomLoop(rand, 700, 300, 400, 40)], fam: 0, mask: 0 });
        items.forEach((it, i) => { if (i) it.fam += 1; });
    }
    return items;
}

const PLATES = [0, 0, 1, 0, 2, 0, 0, 1, 1, 1, 2, 1, 0, -1, 1, 2, 0, 2];

describe("row runs paint the whole walk's bytes (F154)", () => {
    beforeAll(() => core.setDebugChecks(true));
    afterAll(() => core.setDebugChecks(false));

    test("random loops of every record kind on nine plates, the fast path and the union pass, a mark masking a family", () => {
        let chordsWhole = 0, chordsRuns = 0, ink = 0;
        for (const seed of [1, 2, 3, 4]) {
            const r = compareRuns(scene(seed), { plates: PLATES });
            chordsWhole += r.chordsWhole; chordsRuns += r.chordsRuns; ink += r.ink;
        }
        expect(ink).toBeGreaterThan(100000);
        expect(chordsRuns).toBeLessThan(chordsWhole);       // the runs were taken: arcs off a plate's rows not flattened
    });

    test("at a residual and a fractional zoom, on transparent paper", () => {
        for (const seed of [5, 6]) compareRuns(scene(seed), { plates: PLATES, Zq: 0.73, res: [37.25, -91.5], paper: [0, 0, 0, 0] });
        for (const seed of [7]) compareRuns(scene(seed), { plates: [0, 0, 1, 1, 0, 2, 1, 3], Zq: 1.9, res: [-12.125, 3.5] });
    });

    test("inside a clip: rows restricted to it skip more, and still match", () => {
        for (const clip of [[0, 0, 512, 37], [100, 200, 300, 260], [0, 480, 512, 512], [7, 0, 9, 512]]) {
            compareRuns(scene(8), { plates: PLATES }, Int32Array.from(clip));
        }
    });

    test("arcs whose chord misses the plate reach into it: a bulge, a major arc, a whole turn — each its own run", () => {
        const items = [{ loops: reachLoops(), fam: 0 }];
        const r = compareRuns(items, { plates: [0, 0] });
        expect(r.ink).toBeGreaterThan(1000);                 // the fixture reaches the plate (red with the bulges left out)
        const u = compareRuns([{ loops: reachLoops(), fam: 0, union: true }], { plates: [0, 0] });
        expect(u.ink).toBeGreaterThan(1000);
    });

    test("a non-finite piece's run is walked on every plate, so its refusal is counted as the whole walk counts it", () => {
        const loop = [0, -900];
        for (let k = 1; k <= 30; k++) loop.push(0, 10 * k, -900 - (k % 3));
        loop[2 + 3 * 12 + 2] = NaN;                          // a y no row can be read from
        loop.push(0, 300, 200, 0, 0, 200);
        const items = [{ loops: [loop], fam: 0 }];
        core.setDebugChecks(false);
        const counted = (job) => {
            job.attr.set([-10, -1000, 400, 300], 0);         // the box a NaN cannot make
            core.coreStats.nonFinite = 0;
            core.renderPlate(job, 0, new Uint8ClampedArray(TW * TH * 4));
            return core.coreStats.nonFinite;
        };
        const whole = counted(makeJob(items, { plates: [0, 0] }));
        expect(whole).toBeGreaterThan(0);
        for (const per of [1, 4, 16]) expect(counted(makeJob(items, { plates: [0, 0], runs: per }))).toBe(whole);
        core.setDebugChecks(true);
    });

    test("a loop of RUN_PIECES pieces or fewer, or with a code the core does not know, has no runs and is walked whole", () => {
        const small = [0, 0, 0, 10, 0, 0, 10, 10];
        const r = core.rowRuns(0, Float64Array.from(small), Uint32Array.of(0));
        expect(r.runs.length).toBe(0);
        const big = [0, 0];
        for (let k = 1; k <= 40; k++) big.push(0, k, (k * 7) % 13);
        const odd = big.slice(); odd[2 + 3 * 20] = 7;       // an unknown code mid-loop
        const both = core.rowRuns(0, Float64Array.from([...big, ...odd]), Uint32Array.of(0, big.length));
        expect(both.subRun[0]).toBe(0);
        expect(both.subRun[1]).toBe(3);                      // 40 pieces in runs of 16; the odd loop none
        expect(both.runs.length / 3).toBe(3);
        expect(Array.from([0, 1, 2].map((k) => both.runs[3 * k + 2]))).toEqual([2, 2 + 16 * 3, 2 + 32 * 3]);
    });
});

describe("the wire and the pack carry the runs (F154)", () => {
    const rect = (x0, y0, x1, y1, n) => {
        const nums = [x0, y0];
        for (let k = 1; k <= n; k++) nums.push(0, x0 + ((x1 - x0) * k) / n, y0);
        nums.push(0, x1, y1, 0, x0, y1);
        return new Loop(Float64Array.from(nums));
    };
    const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25, fatWidthPx: 4000 };
    const packed = (list, plates) => pack.packJob(list, { plates: Int32Array.from(plates), q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [0, 0, 0] });
    const shape = (id, loops) => ({ type: "shape", id, loops, color: "#ffffff", opacity: 1, z: id });
    afterEach(() => { pack.setRowRuns(true); pack.clearPackCaches(); });

    test("validateJob refuses runs that do not tile their loops", () => {
        const items = [{ loops: [randomLoop(rng(9), 300, 300, 200, 60)], fam: 0 }];
        const good = makeJob(items, { plates: [0, 0], runs: 4 });
        expect(() => validateJob(good)).not.toThrow();
        const bad = (f) => { const j = makeJob(items, { plates: [0, 0], runs: 4 }); f(j); return () => validateJob(j); };
        expect(bad((j) => { j.runs[2] = 5; })).toThrow(/F154/);                      // not at the loop's first record
        expect(bad((j) => { j.runs[5] = j.runs[8]; })).toThrow(/F154/);              // not ascending
        expect(bad((j) => { j.runs[3 * (j.runs.length / 3 - 1) + 2] = 1e6; })).toThrow(/F154/);   // past the loop
        expect(bad((j) => { j.subRun = Uint32Array.of(0, 0); })).toThrow(/subRun/);
        expect(bad((j) => { delete j.subRun; })).toThrow(/together/);
    });

    test("a shape of more than RUN_PIECES pieces ships its runs; small ones and the lever off ship none", () => {
        const big = shape(1, [rect(10, 10, 900, 700, 40)]), small = shape(2, [rect(50, 50, 90, 90, 2)]);
        const j = packed([big, small], [0, 0, 1, 0, 0, 1]);
        expect(j.runs).toBeTruthy();
        expect(j.subRun.length).toBe(j.subs.length);
        const want = core.rowRuns(0, j.geom.subarray(j.meta[2], j.meta[2] + j.meta[3]), j.subs.subarray(j.meta[4], j.meta[4] + j.meta[5]));
        expect(Array.from(j.runs.subarray(0, want.runs.length))).toEqual(Array.from(want.runs));
        expect(packed([small], [0, 0]).runs).toBeFalsy();
        pack.setRowRuns(false); pack.clearPackCaches();
        expect(packed([big, small], [0, 0, 1, 0, 0, 1]).runs).toBeFalsy();
    });

    test("the worker draws a job with runs as the core draws it without, and hands the runs' buffers back", async () => {
        const big = shape(1, [rect(10, 10, 900, 1400, 60)]), other = shape(2, [rect(300, -200, 700, 1100, 30)]);
        const job = packed([big, other], [0, 0, 1, 0, 0, 1, 1, 2]);
        expect(job.runs).toBeTruthy();
        const plain = { ...job, runs: null, subRun: null };
        const refs = [0, 1, 2, 3].map((p) => { const o = new Uint8ClampedArray(TW * TH * 4); core.renderPlate(plain, p, o); return o; });
        const runsBuf = job.runs.buffer, subRunBuf = job.subRun.buffer;
        const res = (await runJob(wireJob(job).msg, { bitmaps: false })).msg;
        for (let p = 0; p < 4; p++) {
            const px = res.pixels[p];
            if (!px) { expect(refs[p].some((v, i) => i % 4 !== 3 && v)).toBe(false); continue; }
            expect(Buffer.compare(Buffer.from(px.buffer, px.byteOffset, px.length), Buffer.from(refs[p].buffer))).toBe(0);
        }
        const back = res.recycled.map((r) => r.buffer || r);
        expect(back).toContain(runsBuf);
        expect(back).toContain(subRunBuf);
        expect(unwireJob(wireJob(packed([big], [0, 0])).msg).runs).toBeTruthy();
    });
});
