/**
 * clipSuite.js — what the partial re-render suites share (`raster/rasterCore.clip.test.js`, the quick part, and
 * `rasterCore.clip.slow.test.js`, the random part; PLAN §3's row, A3 §3.1): the four configurations, the
 * golden whole plates, the list and clip generators, and the byte compare of a clipped render against the whole.
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */
import { packJob } from "../raster/rasterPack";
import * as core from "../raster/rasterCore";
import { copyPlate, pastePatch } from "../raster/rasterJob";
import { lcg, randomList, sortList, LIST_CFG, sameBytes } from "./rasterLists";

export const TW = core.TW, TH = core.TH, N = TW * TH * 4;

export const CONFIGS = [
    { name: "opaque paper", cover: false, cull: true, paper: [255, 255, 255] },
    { name: "a plate-covering backdrop, cull on", cover: true, cull: true, paper: [255, 255, 255] },
    { name: "a plate-covering backdrop, cull off", cover: true, cull: false, paper: [255, 255, 255] },
    { name: "transparent paper", cover: false, cull: true, paper: [0, 0, 0, 0] },
];
export const PLATES = 6, ITEMS = 50, WALK = 12, CLIPS = 6, MERGE_ITEMS = 30;
/**
 * Whole plates, [config][plate], as `plateHash`, drawn by the core since its union pass applies tied crossings
 * together (2026-09-28). Against the core before (4e09269's, which the clip box left byte-identical) 10 of the 24
 * moved, 21 bytes by one level each: where two collinear edges of abutting rings cross a sub-scanline at one x,
 * a run used to end and restart there, and the −w, +w pair left a float32 residue in the running sum.
 * Regenerated again for the byte masks (B-ERASE, 2026-09-28), the lists' marks landed with `targets`: 8 of 24
 * moved, 1,412 bytes, ≤ 2 levels on opaque paper and ≤ 4 premultiplied on transparent paper (where a pixel of
 * alpha under 5/255 stores its colour coarsely), all under a mark's ink.
 * Regenerate only for a deliberate change to the core's pixels.
 */
export const GOLDEN = [
    ["bd70f6cc7bd4d6d7", "158e6f86d66b26e2", "b6b196abc3df85c1", "79423cec19338a93", "35cd5d0a336d69e4", "da128475c005f54d"],
    ["c76d3a947ed224de", "c663d67e7511637c", "64c35c7e9dbfaa93", "d76d6b112c81db44", "10ca06e87d17fb5a", "c17b631a548ab73e"],
    ["c53861649f4e4cc7", "3b6a3e1fc9bf0848", "e31314f9616e4b34", "4ce05213ff4e0d69", "808451234b0711f4", "85a234bbf82d73b6"],
    ["05a667da1b424fbd", "e55a2b53a44453d6", "ef2670f596b33113", "b0d346e086563773", "7c2c6ac9ead5c61a", "8969207eb1a4db87"],
];

/** Odd trials draw plate (1, −1), the list moved onto it by the packer's `offset`, so the plate origin is not 0. */
export function packFor(list, t, paper) {
    const far = t % 2 === 1;
    return packJob(list, {
        plates: far ? Int32Array.of(1, -1) : Int32Array.of(0, 0), q: 0, Zq: 1, dpr: 1, cfg: LIST_CFG, paper,
        offset: far ? [TW, -TH] : null,
    });
}
export const listFor = (c, t) => randomList(lcg(4242 + 1000 * c + t), ITEMS, { cover: CONFIGS[c].cover, maxWalk: WALK });
export const whole = (job, out = new Uint8ClampedArray(N)) => { core.renderPlate(job, 0, out); return out; };

/** A plate's worth of bytes no render writes by accident: what "the old plate" holds. */
export const NOISE = (() => { const b = new Uint8ClampedArray(N); for (let i = 0; i < N; i++) b[i] = (i * 40503 + (i >> 9) * 977) & 255; return b; })();

export function randomClip(rnd) {
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const w = ri(1, rnd() < 0.5 ? 64 : 300), h = ri(1, rnd() < 0.5 ? 64 : 300);
    const x0 = ri(0, TW - w), y0 = ri(0, TH - h);
    return [x0, y0, x0 + w, y0 + h];
}

/**
 * `part` against the plate it should be: `full` inside `clip`, `before` outside it. Counts the bytes that
 * differ on each side and names the first; a native compare first, the byte walk only on a difference.
 */
export function compare(part, full, before, clip) {
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
export function familiesMeeting(job, clip, plateIndex = 0) {
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

/**
 * `n` stroke bands (union items, overlapping rings by construction) walking across row `yTop` (two in three) or
 * `yBot`, half of them translucent: the union pass's bands then start at the clip's top inside them.
 */
export function bandsAcross(rnd, n, yTop, yBot) {
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
