/**
 * rasterCore.clip.test.js — PLAN §3's partial re-render row, the quick part (A3 §3.1): a plate rendered through a
 * clip box is, inside the clip, the plate rendered whole, byte for byte, and outside it untouched. Each
 * configuration's first plate against its golden and through clips, the crafted cases (the cull, the family prune,
 * a pending mark, a bad clip), four seeds of union bands across a clip's edges, the wire, and F132. The random
 * part (every golden, edge clips, the merge through `job.clips`, 60 union seeds) is `rasterCore.clip.slow.test.js`.
 */
import { packJob, clearPackCaches, resetPackStats, packStats } from "./rasterPack";
import * as core from "./rasterCore";
import { wireJob, unwireJob, unwireResult, validateJob, copyPlate, pastePatch, resultBytes } from "./rasterJob";
import { runJob } from "../worker/rasterWorker";
import { lcg, sortList, LIST_CFG, plateHash, sameBytes } from "../__testkit__/rasterLists";
import {
    TW, TH, N, CONFIGS, GOLDEN, packFor, listFor, whole, NOISE, randomClip, compare, familiesMeeting, bandsAcross,
} from "../__testkit__/clipSuite";

beforeEach(() => { clearPackCaches(); resetPackStats(); core.setOcclusion(true); core.setDebugChecks(false); });
afterAll(() => { core.setOcclusion(true); core.setDebugChecks(false); });

describe("a clipped render: the whole plate's bytes inside the clip, nothing touched outside (PLAN §3)", () => {
    test("each configuration's first plate: its golden, the whole-plate clip, and three random clips", () => {
        core.setDebugChecks(true);                                      // an edge outside its family's rows throws
        let inside = 0, outside = 0, first = null;
        const hashes = [];
        for (let c = 0; c < CONFIGS.length; c++) {
            core.setOcclusion(CONFIGS[c].cull);
            clearPackCaches();
            const job = packFor(listFor(c, 0), 0, CONFIGS[c].paper);
            const full = whole(job);
            hashes.push(plateHash(full));
            const asClip = NOISE.slice();
            core.renderPlate(job, 0, asClip, null, null, [0, 0, TW, TH]);
            expect(sameBytes(asClip, full)).toBe(true);
            const rnd = lcg(515 + c);
            for (let k = 0; k < 3; k++) {
                const clip = randomClip(rnd), part = NOISE.slice();
                core.renderPlate(job, 0, part, null, null, clip);
                const d = compare(part, full, NOISE, clip);
                inside += d.inside; outside += d.outside;
                if (!first && d.first) first = { c, clip, ...d.first };
            }
        }
        expect(hashes).toEqual(GOLDEN.map((g) => g[0]));
        expect({ inside, outside, first }).toEqual({ inside: 0, outside: 0, first: null });
    });

    test("the cull decides over the clip: a fill covering the clip but not the plate hides the families under it", () => {
        const fill = (id, x0, y0, x1, y1, color) => ({ type: "fill", origin: "native", id, color, opacity: 1,
            polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] });
        const list = [];
        for (let k = 0; k < 6; k++) list.push(fill(k + 1, 100 + 30 * k, 120 + 20 * k, 180 + 30 * k, 260 + 20 * k, "rgb(" + (40 * k) + ",90,160)"));
        list.push(fill(7, 64.25, 64.5, 447.75, 448.25, "rgb(20,120,60)"));  // over them all, not the plate
        list.push(fill(8, 200, 200, 230, 230, "rgb(200,40,40)"));           // above it
        const job = packFor(sortList(list), 0, [255, 255, 255]);
        const full = whole(job);
        const before = core.occStats.occluded;
        const clip = [128, 128, 256, 256];
        const part = NOISE.slice();
        const counts = new Uint32Array(8);
        core.renderPlate(job, 0, part, counts, null, clip);
        expect(core.occStats.occluded - before).toBe(6);
        expect(counts[6]).toBeLessThanOrEqual(128 * counts[2]);        // the cover resolved over the clip's rows alone
        const d = compare(part, full, NOISE, clip);
        expect({ inside: d.inside, outside: d.outside }).toEqual({ inside: 0, outside: 0 });
    });

    test("a family whose box misses the clip is not resolved; one within 2 px of it is", () => {
        const list = [];
        for (let k = 0; k < 10; k++) {
            const x = 20 + 48 * k;
            list.push({ type: "fill", origin: "native", id: k + 1, color: "rgb(" + (20 * k) + ",40,90)", opacity: 0.7,
                polys: [[[x, 40], [x + 30, 60], [x + 20, 470], [x - 5, 300]]] });
        }
        const job = packFor(list, 0, [255, 255, 255]);
        const full = whole(job);
        const counts = new Uint32Array(8);
        const clip = [0, 0, 62, TH];                                    // meets the first family's box; the second's (x ≥ 63) only grown by 2
        const part = NOISE.slice();
        core.renderPlate(job, 0, part, counts, null, clip);
        expect(counts[2]).toBe(familiesMeeting(job, clip));
        expect(counts[2]).toBe(2);
        expect(compare(part, full, NOISE, clip).inside).toBe(0);
    });

    test("a pending mark straddling the clip's edge masks the ink under it exactly as on the whole plate", () => {
        const list = [
            { type: "fill", origin: "native", id: 1, color: "rgb(30,60,200)", opacity: 1, polys: [[[40, 40], [470, 60], [440, 470], [60, 430]]] },
            { type: "stroke", origin: "native", id: 2, color: "rgb(200,30,30)", opacity: 0.6, lwFrame: 24, pts: [[80, 300], [250, 200], [430, 330]] },
            { type: "stroke", origin: "native", id: 3, color: "#ffffff", opacity: 1, lwFrame: 36, erase: true, pts: [[60, 100], [260, 260], [470, 180]] },
            { type: "fill", origin: "native", id: 4, color: "rgb(20,160,40)", opacity: 1, polys: [[[300, 300], [360, 300], [360, 360], [300, 360]]] },
        ];
        for (const paper of [[255, 255, 255], [0, 0, 0, 0]]) {
            clearPackCaches();
            const job = packFor(list, 0, paper);
            expect(job.meta[2 * 8 + 6] & 8).toBe(8);                    // the eraser is packed as a mark
            const full = whole(job);
            for (const clip of [[200, 150, 320, 290], [0, 0, 250, 250], [255, 0, 256, TH]]) {
                const part = NOISE.slice();
                core.renderPlate(job, 0, part, null, null, clip);
                const d = compare(part, full, NOISE, clip);
                expect({ clip, inside: d.inside, outside: d.outside }).toEqual({ clip, inside: 0, outside: 0 });
            }
        }
    });

    test("a clip that is not an integral box inside the plate throws, and leaves the core whole", () => {
        const job = packFor(listFor(0, 0), 0, [255, 255, 255]);
        const out = new Uint8ClampedArray(N);
        for (const bad of [[0, 0, TW + 1, 10], [-1, 0, 10, 10], [5, 5, 5, 9], [10, 10, 4, 20], [0.5, 0, 10, 10]]) {
            expect(() => core.renderPlate(job, 0, out, null, null, bad)).toThrow(/clip/);
        }
        expect(plateHash(whole(job))).toBe(GOLDEN[0][0]);
    });
});

describe("the union pass inside a clip (PLAN §3's partial re-render row; the review of 2026-09-28)", () => {
    // Four of the slow suite's 60 seeds, two on opaque and two on transparent paper, each of which differed inside
    // the clip before tied crossings were applied together and x was taken from each edge's own start.
    test("stroke bands crossing the clip's top and bottom rows: the whole plate's bytes inside the clip", () => {
        const counts = new Uint32Array(8);
        let clips = 0, inside = 0, outside = 0, unionItems = 0, first = null;
        for (const s of [4, 13, 20, 35]) {
            const rnd = lcg(31337 + 7919 * s);
            const paper = s % 2 ? [0, 0, 0, 0] : [255, 255, 255];
            const cy0 = 8 + Math.floor(rnd() * 300), cy1 = Math.min(TH, cy0 + 4 + Math.floor(rnd() * 60));
            clearPackCaches();
            const job = packFor(bandsAcross(rnd, 14, cy0 + 0.5 * rnd(), cy1 - 0.5 * rnd()), s >> 1, paper);
            const full = whole(job, new Uint8ClampedArray(N));
            const x0 = Math.floor(rnd() * 400), x1 = Math.min(TW, x0 + 1 + Math.floor(rnd() * 400));
            for (const clip of [[0, cy0, TW, cy1], [x0, cy0 + Math.floor(rnd() * 3), x1, Math.max(cy0 + 3, cy1 - Math.floor(rnd() * 3))]]) {
                const part = NOISE.slice();
                core.renderPlate(job, 0, part, counts, null, clip);
                unionItems += counts[3];
                const d = compare(part, full, NOISE, clip);
                clips++; inside += d.inside; outside += d.outside;
                if (!first && d.first) first = { s, clip, ...d.first };
            }
        }
        expect(unionItems).toBeGreaterThan(4 * 12);
        expect({ clips, inside, outside, first }).toEqual({ clips: 8, inside: 0, outside: 0, first: null });
    });
});

describe("job.clips on the wire", () => {
    const twoPlates = (clips) => {
        const job = packJob(listFor(0, 2), { plates: Int32Array.of(0, 0, 1, 0), q: 0, Zq: 1, dpr: 1, cfg: LIST_CFG, paper: [255, 255, 255] });
        if (clips) job.clips = Int32Array.from(clips);
        return job;
    };

    test("validateJob takes one integral box inside its plate per plate, and refuses anything else", () => {
        expect(() => validateJob(twoPlates(null))).not.toThrow();
        expect(() => validateJob(twoPlates([0, 0, 512, 512, 10, 20, 30, 40]))).not.toThrow();
        for (const bad of [[0, 0, 512, 512], [0, 0, 513, 10, 0, 0, 1, 1], [5, 5, 5, 9, 0, 0, 1, 1], [0, 0, 1, 1, -1, 0, 4, 4]]) {
            expect(() => validateJob(twoPlates(bad))).toThrow(/clip/);
        }
        const job = twoPlates(null);
        job.clips = Float64Array.of(0, 0, 10.5, 10, 0, 0, 1, 1);
        expect(() => validateJob(job)).toThrow(/clip/);
    });

    test("the clips cross bit for bit in the transfer list, and a job without them wires as before", () => {
        const job = twoPlates([0, 0, 512, 512, 10, 20, 30, 40]);
        const { msg, transfer } = wireJob(job);
        expect(transfer).toContain(job.clips.buffer);
        expect(transfer.length).toBe(8);
        expect(Array.from(unwireJob(msg).clips)).toEqual([0, 0, 512, 512, 10, 20, 30, 40]);
        const plain = wireJob(twoPlates(null));
        expect(plain.transfer.length).toBe(7);
        expect(unwireJob(plain.msg).clips).toBeUndefined();
    });

    test("a clipped result carries its clips and each plate's rectangle alone, counted at w·h·4", async () => {
        const clips = [100, 50, 164, 90, 0, 0, 512, 512];
        const res = unwireResult((await runJob(wireJob(twoPlates(clips)).msg, { bitmaps: false })).msg);
        expect(Array.from(res.clips)).toEqual(clips);
        expect(res.pixels[0].length).toBe(64 * 40 * 4);
        expect(res.pixels[1].length).toBe(TW * TH * 4);
        clearPackCaches();
        const ref = twoPlates(null);
        const full0 = new Uint8ClampedArray(N), full1 = new Uint8ClampedArray(N);
        core.renderPlate(ref, 0, full0); core.renderPlate(ref, 1, full1);
        expect(sameBytes(res.pixels[0], copyPlate(full0, clips.slice(0, 4)))).toBe(true);
        expect(sameBytes(res.pixels[1], full1)).toBe(true);
        // The worker rendered the clip, not the plate: no family covered more than the clip's pixels.
        expect(res.counts[7]).toBeLessThanOrEqual(64 * 40 * res.counts[2]);
        expect(res.counts[6]).toBeLessThanOrEqual(40 * res.counts[2]);
        const headBytes = res.timings.byteLength + res.counts.byteLength + res.guards.byteLength + res.plates.byteLength + res.clips.byteLength;
        expect(resultBytes(res)).toBe(headBytes + 64 * 40 * 4 + TW * TH * 4);
        expect(resultBytes({ ...res, pixels: null, bitmaps: [{}, {}] })).toBe(headBytes + 64 * 40 * 4 + TW * TH * 4);
    });

    test("copyPlate with a clip and pastePatch are inverse on the rectangle and leave the rest", () => {
        const src = NOISE.slice(), dst = new Uint8ClampedArray(N);
        const clip = [7, 300, 91, 311];
        const patch = copyPlate(src, clip);
        expect(patch.length).toBe(84 * 11 * 4);
        pastePatch(dst, patch, clip);
        const d = compare(dst, src, new Uint8ClampedArray(N), clip);
        expect({ inside: d.inside, outside: d.outside }).toEqual({ inside: 0, outside: 0 });
        expect(sameBytes(copyPlate(src), src)).toBe(true);
    });
});

describe("the packer's offset on a family it reuses from an earlier list (F132, found by the merge in rasterCore.clip.slow.test.js)", () => {
    test("a second list sharing families, packed with the same offset, keeps every item's offset", () => {
        const fill = (id, x) => ({ type: "fill", origin: "native", id, color: "rgb(10,20,30)", opacity: 1,
            polys: [[[x, 10], [x + 50, 10], [x + 50, 60], [x, 60]]] });
        const a = fill(1, 10), b = fill(2, 100);
        const opts = { plates: Int32Array.of(1, 0), q: 0, Zq: 1, dpr: 1, cfg: LIST_CFG, paper: [255, 255, 255], offset: [TW, 0] };
        const first = packJob([a, b], opts);
        const reused0 = packStats.famReused;
        const reused = packJob([a, b, fill(3, 200)], opts);
        expect(packStats.famReused - reused0).toBe(2);                 // families 1 and 2 taken from the first list
        const res = (job) => Array.from({ length: job.nItems }, (_, k) => [job.ids[k], job.attr[k * 9 + 4], job.attr[k * 9 + 5]]);
        expect(res(first)).toEqual([[1, TW, 0], [2, TW, 0]]);
        expect(res(reused)).toEqual([[1, TW, 0], [2, TW, 0], [3, TW, 0]]);
        const out = whole(reused);
        const at = (x, y) => out[(y * TW + x) * 4];
        expect([at(30, 30), at(120, 30), at(220, 30)]).toEqual([10, 10, 10]);
    });
});
