/**
 * rasterCore.clip.test.js — PLAN §3's partial re-render row, A3 §3.1's experiment E1 as a test: a plate
 * rendered through a clip box is, inside the clip, the plate rendered whole, byte for byte, and outside
 * it untouched. And the merge: a plate rendered for one list, the list changed inside a rectangle, the
 * rectangle re-rendered through the wire (`job.clips`) and pasted into the old pixels with the
 * typed-array copy jsdom's store will use, equals the plate rendered whole for the new list.
 *
 * Seeded random lists (`__testkit__/rasterLists.js`): fills, arc circles, stroke bands, families of
 * pieces and pending marks; opaque and transparent paper; the occlusion cull on and off. With no clip
 * the core draws the plates it drew before the clip existed: GOLDEN holds hashes of those whole plates,
 * taken from that core (regenerate only for a deliberate change to the core's pixels).
 */
import { packJob, clearPackCaches, resetPackStats, packStats } from "./rasterPack";
import * as core from "./rasterCore";
import { wireJob, unwireJob, unwireResult, validateJob, copyPlate, pastePatch, resultBytes } from "./rasterJob";
import { runJob } from "../worker/rasterWorker";
import { lcg, randomList, sortList, LIST_CFG, plateHash, sameBytes } from "../__testkit__/rasterLists";

const TW = core.TW, TH = core.TH, N = TW * TH * 4;

const CONFIGS = [
    { name: "opaque paper", cover: false, cull: true, paper: [255, 255, 255] },
    { name: "a plate-covering backdrop, cull on", cover: true, cull: true, paper: [255, 255, 255] },
    { name: "a plate-covering backdrop, cull off", cover: true, cull: false, paper: [255, 255, 255] },
    { name: "transparent paper", cover: false, cull: true, paper: [0, 0, 0, 0] },
];
const PLATES = 6, ITEMS = 50, WALK = 12, CLIPS = 6, MERGE_ITEMS = 30;
/** Whole plates drawn by the core before the clip box (commit 4e09269), [config][plate], as `plateHash`. */
const GOLDEN = [
    ["bd70f6cc7bd4d6d7", "158e6f86d66b26e2", "b750f99dc95c90c9", "79423cec19338a93", "35cd5d0a336d69e4", "eaf2f19c91fc3a8c"],
    ["a5a5c9bfcef4e7da", "0474a9dc387b5038", "64c35c7e9dbfaa93", "8409b344ae7ca370", "e3a1999e525db52c", "c17b631a548ab73e"],
    ["c53861649f4e4cc7", "3b6a3e1fc9bf0848", "fd5f93cb7c67ce06", "2278090cadc92273", "0c97bdb4f67ee69c", "d382dcf2fb70ab3b"],
    ["863a101e04691a9d", "e55a2b53a44453d6", "e7e031c4211d509c", "3822ba5cf1d36fba", "7c2c6ac9ead5c61a", "8969207eb1a4db87"],
];

/** Odd trials draw plate (1, −1), the list moved onto it by the packer's `offset`, so the plate origin is not 0. */
function packFor(list, t, paper) {
    const far = t % 2 === 1;
    return packJob(list, {
        plates: far ? Int32Array.of(1, -1) : Int32Array.of(0, 0), q: 0, Zq: 1, dpr: 1, cfg: LIST_CFG, paper,
        offset: far ? [TW, -TH] : null,
    });
}
const listFor = (c, t) => randomList(lcg(4242 + 1000 * c + t), ITEMS, { cover: CONFIGS[c].cover, maxWalk: WALK });
const whole = (job, out = new Uint8ClampedArray(N)) => { core.renderPlate(job, 0, out); return out; };

/** A plate's worth of bytes no render writes by accident: what "the old plate" holds. */
const NOISE = (() => { const b = new Uint8ClampedArray(N); for (let i = 0; i < N; i++) b[i] = (i * 40503 + (i >> 9) * 977) & 255; return b; })();

function randomClip(rnd) {
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const w = ri(1, rnd() < 0.5 ? 64 : 300), h = ri(1, rnd() < 0.5 ? 64 : 300);
    const x0 = ri(0, TW - w), y0 = ri(0, TH - h);
    return [x0, y0, x0 + w, y0 + h];
}

/**
 * `part` against the plate it should be: `full` inside `clip`, `before` outside it. Counts the bytes that
 * differ on each side and names the first; a native compare first, the byte walk only on a difference.
 */
function compare(part, full, before, clip) {
    const want = pastePatch(before.slice(), copyPlate(full, clip), clip);
    if (sameBytes(part, want)) return { inside: 0, outside: 0, first: null };
    const [x0, y0, x1, y1] = clip;
    let inside = 0, outside = 0, first = null;
    for (let i = 0; i < N; i++) {
        if (part[i] === want[i]) continue;
        const x = (i >> 2) % TW, y = Math.floor((i >> 2) / TW), inClip = x >= x0 && x < x1 && y >= y0 && y < y1;
        if (inClip) inside++; else outside++;
        if (!first) first = { x, y, ch: i & 3, got: part[i], want: want[i], inClip };
    }
    return { inside, outside, first };
}

/** Families whose drawn box meets `clip` grown by 2 px: all a clipped render may resolve. */
function familiesMeeting(job, clip, plateIndex = 0) {
    const ox = job.plates[plateIndex * 2] * TW, oy = job.plates[plateIndex * 2 + 1] * TH;
    const boxes = new Map();
    for (let it = 0; it < job.nItems; it++) {
        const a = it * 9;
        const x0 = job.attr[a] * job.Zq - ox, x1 = job.attr[a + 2] * job.Zq - ox;
        const y0 = job.attr[a + 1] * job.Zq - oy, y1 = job.attr[a + 3] * job.Zq - oy;
        if (!(x1 >= 0 && x0 <= TW && y1 >= 0 && y0 <= TH)) continue;          // the plate's own prune
        const f = job.meta[it * 8 + 1];
        const b = boxes.get(f);
        if (!b) boxes.set(f, [x0, y0, x1, y1]);
        else { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
    }
    let n = 0;
    for (const b of boxes.values()) if (!(b[2] < clip[0] - 2 || b[0] > clip[2] + 2 || b[3] < clip[1] - 2 || b[1] > clip[3] + 2)) n++;
    return n;
}

beforeEach(() => { clearPackCaches(); resetPackStats(); core.setOcclusion(true); core.setDebugChecks(false); });
afterAll(() => { core.setOcclusion(true); core.setDebugChecks(false); });

describe("a clipped render: the whole plate's bytes inside the clip, nothing touched outside (PLAN §3)", () => {
    for (let c = 0; c < CONFIGS.length; c++) {
        test(`${CONFIGS[c].name}: ${PLATES} whole plates as before the clip existed, each with ${CLIPS} random clips`, () => {
            core.setOcclusion(CONFIGS[c].cull);
            core.setDebugChecks(true);                                  // an edge outside its family's rows throws
            const counts = new Uint32Array(8);
            const hashes = [];
            let clips = 0, inside = 0, outside = 0, pruneOver = 0, first = null;
            for (let t = 0; t <= PLATES; t++) {
                clearPackCaches();
                const tt = t % PLATES;                                  // the last pass draws plate 0 again
                const job = packFor(listFor(c, tt), tt, CONFIGS[c].paper);
                // With no clip, the old core's plate; after the previous plate's clips, still the same
                // (rows a clip left in the accumulator would show here).
                const full = whole(job);
                hashes.push(plateHash(full));
                if (t === PLATES) break;
                if (t === 0) {
                    const asClip = NOISE.slice();
                    core.renderPlate(job, 0, asClip, null, null, [0, 0, TW, TH]);
                    expect(sameBytes(asClip, full)).toBe(true);
                }
                const rnd = lcg(77 + 1000 * c + t);
                for (let k = 0; k < CLIPS; k++) {
                    const clip = randomClip(rnd);
                    const part = NOISE.slice();
                    core.renderPlate(job, 0, part, counts, null, clip);
                    const d = compare(part, full, NOISE, clip);
                    clips++; inside += d.inside; outside += d.outside;
                    if (!first && d.first) first = { t, clip, ...d.first };
                    if (counts[2] > familiesMeeting(job, clip)) pruneOver++;
                }
            }
            expect(hashes).toEqual(GOLDEN[c].concat([GOLDEN[c][0]]));
            expect({ clips, inside, outside, first, pruneOver }).toEqual({ clips: PLATES * CLIPS, inside: 0, outside: 0, first: null, pruneOver: 0 });
        });
    }

    test("edge clips: the whole plate, single pixels at two corners, full-width and full-height strips, halves", () => {
        const edges = [[0, 0, TW, TH], [0, 0, 1, 1], [TW - 1, TH - 1, TW, TH], [0, 200, TW, 201], [300, 0, 301, TH],
            [0, 0, TW, 1], [0, TH - 1, TW, TH], [0, 0, TW >> 1, TH], [TW >> 1, TH >> 1, TW, TH]];
        let inside = 0, outside = 0, first = null;
        for (let c = 0; c < CONFIGS.length; c++) {
            core.setOcclusion(CONFIGS[c].cull);
            clearPackCaches();
            const job = packFor(listFor(c, 1), 1, CONFIGS[c].paper);
            const full = whole(job);
            for (const clip of edges) {
                const part = NOISE.slice();
                core.renderPlate(job, 0, part, null, null, clip);
                const d = compare(part, full, NOISE, clip);
                inside += d.inside; outside += d.outside;
                if (!first && d.first) first = { c, clip, ...d.first };
            }
        }
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

/** One family's key in a list: its edit group, or itself. */
const famOf = (o) => (o.editId != null ? o.editId : o.id);

/**
 * The list changed inside a rectangle, four ways: a family removed, an item added under some of the
 * others, a family moved, a family recoloured. Changed items are new objects (the packer memoises by
 * object). Returns the new list and the ids whose boxes, before and after, bound the change. Targets
 * come from the upper half of the paint order, where fewer changes are hidden under opaque ink.
 */
function changed(list, kind, rnd) {
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = () => list[ri(list.length >> 1, list.length - 1)];
    if (kind === "add") {
        const maxId = list.reduce((m, o) => Math.max(m, o.id, o.editId || 0), 0);
        const o = randomList(rnd, 1, { firstId: maxId + 1 })[0];
        const under = pick();
        o.z = under.z != null ? under.z : under.id;                     // painted just above that item's family
        return { list: sortList(list.concat([o])), ids: [o.id] };
    }
    let target = pick();
    if (kind === "move") {
        const movable = (key) => list.every((o) => famOf(o) !== key || o.type !== "shape");
        for (let k = 0; k < 20 && !movable(famOf(target)); k++) target = pick();
        if (!movable(famOf(target))) kind = "remove";
    }
    if (kind === "recolour") for (let k = 0; k < 20 && target.erase; k++) target = pick();
    const key = famOf(target), ids = list.filter((o) => famOf(o) === key).map((o) => o.id);
    if (kind === "remove") return { list: list.filter((o) => famOf(o) !== key), ids };
    const dx = ri(-60, 60), dy = ri(-60, 60), color = "rgb(" + ri(0, 255) + "," + ri(0, 255) + "," + ri(0, 255) + ")";
    const out = list.map((o) => {
        if (famOf(o) !== key) return o;
        if (kind === "recolour") return { ...o, color };
        const m = (p) => [p[0] + dx, p[1] + dy];
        return o.type === "fill" ? { ...o, polys: o.polys.map((r) => r.map(m)) } : { ...o, pts: o.pts.map(m) };
    });
    return { list: out, ids };
}

/** The ids' boxes in the jobs, in the plate's pixels, grown by 2 and rounded out, clamped to the plate; null if none meets it. */
function dirtyRect(jobs, ids) {
    const want = new Set(ids);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const job of jobs) {
        const ox = job.plates[0] * TW, oy = job.plates[1] * TH;
        for (let it = 0; it < job.nItems; it++) {
            if (!want.has(job.ids[it])) continue;
            const a = it * 9;
            x0 = Math.min(x0, job.attr[a] * job.Zq - ox); y0 = Math.min(y0, job.attr[a + 1] * job.Zq - oy);
            x1 = Math.max(x1, job.attr[a + 2] * job.Zq - ox); y1 = Math.max(y1, job.attr[a + 3] * job.Zq - oy);
        }
    }
    const r = [Math.max(0, Math.floor(x0) - 2), Math.max(0, Math.floor(y0) - 2), Math.min(TW, Math.ceil(x1) + 2), Math.min(TH, Math.ceil(y1) + 2)];
    return r[0] < r[2] && r[1] < r[3] ? r : null;
}

describe("the merge: a change re-rendered through the clip and pasted into the old plate is the new plate", () => {
    const KINDS = ["remove", "add", "move", "recolour"];
    for (let c = 0; c < CONFIGS.length; c++) {
        test(`${CONFIGS[c].name}: ${KINDS.join(", ")}, each through runJob with job.clips`, async () => {
            core.setOcclusion(CONFIGS[c].cull);
            const { paper } = CONFIGS[c];
            let merges = 0, differing = 0, first = null;
            for (let t = 0; t < 2 * KINDS.length; t++) {
                clearPackCaches();
                const rnd = lcg(9000 + 100 * c + t);
                const list1 = randomList(rnd, MERGE_ITEMS, { cover: CONFIGS[c].cover, maxWalk: WALK });
                const job1 = packFor(list1, t, paper), old = whole(job1);
                // A change that misses the plate, or is hidden under opaque ink, proves nothing: draw another.
                let job2 = null, clip = null, fresh = null;
                for (let k = 0; k < 6 && !fresh; k++) {
                    const ch = changed(list1, KINDS[t % KINDS.length], rnd);
                    job2 = packFor(ch.list, t, paper);
                    clip = dirtyRect([job1, job2], ch.ids);
                    const f = clip ? whole(job2) : null;
                    if (f && !sameBytes(f, old)) fresh = f;
                }
                if (!fresh) continue;
                job2.clips = Int32Array.from(clip);
                const res = unwireResult((await runJob(wireJob(job2).msg, { bitmaps: false })).msg);
                expect(Array.from(res.clips)).toEqual(clip);
                const merged = old.slice();
                const patch = res.pixels[0];
                if (patch) {
                    expect(patch.length).toBe((clip[2] - clip[0]) * (clip[3] - clip[1]) * 4);
                    pastePatch(merged, patch, clip);
                } else core.fillPaper(merged, paper[0], paper[1], paper[2], paper.length > 3 ? paper[3] : 255, clip);   // a null is paper over the clip
                merges++;
                if (!sameBytes(merged, fresh)) {
                    for (let i = 0; i < N; i++) if (merged[i] !== fresh[i]) { differing++; if (!first) first = { t, i, got: merged[i], want: fresh[i] }; }
                }
            }
            expect({ differing, first }).toEqual({ differing: 0, first: null });
            expect(merges).toBeGreaterThanOrEqual(6);
        });
    }
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
        expect(transfer.length).toBe(9);
        expect(Array.from(unwireJob(msg).clips)).toEqual([0, 0, 512, 512, 10, 20, 30, 40]);
        const plain = wireJob(twoPlates(null));
        expect(plain.transfer.length).toBe(8);
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

describe("the packer's offset on a family it reuses from an earlier list (F132, found by the merge above)", () => {
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

/**
 * `n` stroke bands (union items, overlapping rings by construction) walking across row `yTop` (two in three) or
 * `yBot`, half of them translucent: the union pass's bands then start at the clip's top inside them.
 */
function bandsAcross(rnd, n, yTop, yBot) {
    const rr = (a, b) => a + rnd() * (b - a);
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const list = [];
    for (let k = 0; k < n; k++) {
        const m = ri(4, 6), pts = [[rr(-40, TW + 40), (k % 3 === 2 ? yBot : yTop) + rr(-8, 8)]];
        for (let v = 1; v < m; v++) pts.push([pts[v - 1][0] + rr(-35, 35), pts[v - 1][1] + rr(-8, 8)]);
        list.push({ type: "stroke", origin: "native", id: k + 1, pts, lwFrame: rr(1, 40),
            color: "rgb(" + ri(0, 255) + "," + ri(0, 255) + "," + ri(0, 255) + ")", opacity: rnd() < 0.5 ? rr(0.25, 0.85) : 1 });
    }
    return sortList(list);
}

describe("the union pass inside a clip (PLAN §3's partial re-render row; reviewer, 2026-09-28)", () => {
    test("60 seeds of stroke bands crossing the clip's top and bottom rows: the whole plate's bytes inside the clip", () => {
        const SEEDS = 60, counts = new Uint32Array(8);
        let clips = 0, inside = 0, outside = 0, unionItems = 0, first = null;
        for (let s = 0; s < SEEDS; s++) {
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
        expect(unionItems).toBeGreaterThan(SEEDS * 12);
        expect({ clips, inside, outside, first }).toEqual({ clips: 2 * SEEDS, inside: 0, outside: 0, first: null });
    });
});
