/**
 * rasterCore.clip.slow.test.js — PLAN §3's partial re-render row, the random part (A3 §3.1's experiment E1 as a
 * test): seeded random lists (fills, arc circles, stroke bands, families of pieces, pending marks) in four
 * configurations, every whole plate against its golden and each through random clips and edge clips; the merge —
 * a plate rendered for one list, the list changed inside a rectangle, the rectangle re-rendered through the wire
 * (`job.clips`) and pasted into the old pixels with the typed-array copy jsdom's store uses, equals the plate
 * rendered whole for the new list; and 60 seeds of union bands across a clip's edges. The quick part is
 * `rasterCore.clip.test.js`; what both share is `__testkit__/clipSuite.js`. Its goldens were regenerated on
 * 2026-09-28, when the union pass began applying tied crossings together (10 of the 24 moved by one level), and
 * again for the byte masks (8 moved, under marks' ink); why: there.
 */
import { clearPackCaches, resetPackStats } from "./rasterPack";
import * as core from "./rasterCore";
import { wireJob, unwireResult, pastePatch } from "./rasterJob";
import { runJob } from "../worker/rasterWorker";
import { lcg, randomList, sortList, plateHash, sameBytes } from "../__testkit__/rasterLists";
import {
    TW, TH, N, CONFIGS, GOLDEN, PLATES, CLIPS, MERGE_ITEMS, WALK, packFor, listFor, whole, NOISE, randomClip, compare,
    familiesMeeting, bandsAcross,
} from "../__testkit__/clipSuite";

beforeEach(() => { clearPackCaches(); resetPackStats(); core.setOcclusion(true); core.setDebugChecks(false); });
afterAll(() => { core.setOcclusion(true); core.setDebugChecks(false); });

describe("a clipped render: the whole plate's bytes inside the clip, nothing touched outside (PLAN §3)", () => {
    for (let c = 0; c < CONFIGS.length; c++) {
        test(`${CONFIGS[c].name}: ${PLATES} whole plates against their goldens, each with ${CLIPS} random clips`, () => {
            core.setOcclusion(CONFIGS[c].cull);
            core.setDebugChecks(true);                                  // an edge outside its family's rows throws
            const counts = new Uint32Array(8);
            const hashes = [];
            let clips = 0, inside = 0, outside = 0, pruneOver = 0, first = null;
            for (let t = 0; t <= PLATES; t++) {
                clearPackCaches();
                const tt = t % PLATES;                                  // the last pass draws plate 0 again
                const job = packFor(listFor(c, tt), tt, CONFIGS[c].paper);
                // With no clip, the golden; after the previous plate's clips, still the same
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

describe("the union pass inside a clip (PLAN §3's partial re-render row; the review of 2026-09-28)", () => {
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
