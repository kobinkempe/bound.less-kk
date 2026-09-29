/**
 * PicturePyramid.patch.test.js — partial re-render (A3 §3.2–§3.5), the undo of one stroke end to end in jsdom: the
 * view rests with its rest set exact; the stroke is removed (a commit of its footprint); the next frame re-renders
 * the stale cells through their clips. Inline, the plates and the screen equal the post-undo whole render byte for
 * byte. Coarse-first, wherever the post-undo whole render differs from the pre-undo picture the screen differs too
 * (the stroke shows nowhere), outside the change it is the sharp old plate, the full patches are asked for at
 * priority 0, and `olderPatchMs` and `olderOtherMs` stay 0. The GPU merge (a software OffscreenCanvas) equals `pastePatch`.
 */
import PyramidStore, { PLATE_BYTES, restCell } from "./PyramidStore";
import PicturePyramid from "./PicturePyramid";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { copyPlate, pastePatch } from "./rasterJob";
import { fakeStage } from "../__testkit__/fakeStage";
import { softCtx } from "../__testkit__/softCanvas";
import { lcg, randomList, LIST_CFG, sameBytes } from "../__testkit__/rasterLists";

const P = 512, W = 1024, H = 1024;
const cam = (Z) => ({ frame: "F", inScale: Z, inPanX: 0, inPanY: 0, frameWindow: () => ({ left: 0, top: 0, right: W / Z, bottom: H / Z }) });

/** The undone stroke: magenta, 13 px, 300 px long across plates (0, 0) and (1, 0). */
const STROKE = { type: "stroke", origin: "native", id: 900, color: "rgb(255,0,255)", opacity: 1, lwFrame: 13,
    pts: [[330, 120], [420, 150], [500, 170], [560, 175], [630, 160]] };
const FOOT = { left: 330 - 6.5, top: 120 - 6.5, right: 630 + 6.5, bottom: 175 + 6.5 };

function setup(seed, measure) {
    const stage = fakeStage();
    const store = new PyramidStore({ fresh: stage, maxBytes: 400 * PLATE_BYTES, phone: false, doc: null });
    const doc = { list: randomList(lcg(seed), 60).concat([STROKE]) };
    const ctx = softCtx(W, H, P, { scaled: true });
    const clock = { t: 0 };
    const posted = [];
    const pack = (job) => packJob(doc.list, { plates: Int32Array.from(job.cells.flatMap((c) => [c.i, c.j])), q: 0, Zq: job.Z, dpr: 1,
        cfg: LIST_CFG, paper: [255, 255, 255], G: stage.generation });
    const pyr = new PicturePyramid(null, { store, stage, lm: { frame: () => null, framePath: () => null }, cfg: { levelStep: 1 },
        width: W, height: H, dpr: 1, pixels: true, context: ctx, now: () => clock.t, setTimer: () => null, clearTimer: () => {},
        onRequest: (jobs) => posted.push(...jobs), pack, measure });
    return { stage, store, doc, ctx, clock, posted, pyr, pack };
}

/** A whole plate of `list` at zoom Z. */
function whole(list, Z, i, j) {
    const job = packJob(list, { plates: Int32Array.of(i, j), q: 0, Zq: Z, dpr: 1, cfg: LIST_CFG, paper: [255, 255, 255], G: 0 });
    const out = new Uint8ClampedArray(P * P * 4);
    renderPlate(job, 0, out, null, null);
    return out;
}
/** The four plates on screen, as a pixel reader over device px. */
const reader = (plates) => (x, y) => { const px = plates[(y >> 9) * 2 + (x >> 9)], k = (((y & 511) * P) + (x & 511)) * 4; return [px[k], px[k + 1], px[k + 2]]; };
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** Every pixel around the stroke, and the rest of the screen on a stride. */
function* pixels(stride = 3, m = 4) {
    for (let y = 0; y < H; y++) {
        const near = y >= FOOT.top - m && y <= FOOT.bottom + m;
        if (!near && y % stride) continue;
        for (let x = 0; x < W; x++) if ((near && x >= FOOT.left - m && x <= FOOT.right + m) || x % stride === 0) yield [x, y];
    }
}

/** Rest at Z = 1 on plates (0..1, 0..1), then the undo of STROKE. Returns the pre-undo plates. */
function restThenUndo(t) {
    t.pyr.frameFor(cam(1));
    t.pyr.frameFor(cam(1));
    expect(t.pyr._v.mode).toBe("rest");
    const pre = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => t.store.get(restCell("F", 1, i, j).key).pixels.slice());
    t.pyr.compose();
    expect(eq(t.ctx.at(420, 150), [255, 0, 255])).toBe(true);                // the stroke shows
    t.doc.list = t.doc.list.filter((o) => o !== STROKE);
    t.stage.commit({ F: [FOOT] });
    t.clock.t += 16;
    return pre;
}

describe("PicturePyramid — partial re-render: the undo of one stroke (A3 §3.5)", () => {
    test("inline: the stale rest cells re-rendered through their clips; plates and screen equal the post-undo whole render", () => {
        for (const seed of [11, 12, 13]) {
            const t = setup(seed, () => ({ E: 3000, A: 90000, U: 0, P: 2 }));
            restThenUndo(t);
            const stale = [...t.store.records()].filter((r) => !t.store.exact(r)).map((r) => r.key).sort();
            expect(stale).toEqual([restCell("F", 1, 0, 0).key, restCell("F", 1, 1, 0).key]);
            t.pyr.frameFor(cam(1));                                          // the undo's frame: the patch step, inline
            expect(t.pyr.s.patchInline).toBe(1);
            const post = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => whole(t.doc.list, 1, i, j));
            [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j], n) => {
                const r = t.store.get(restCell("F", 1, i, j).key);
                expect([seed, i, j, t.store.exact(r), sameBytes(r.pixels, post[n])]).toEqual([seed, i, j, true, true]);
            });
            t.pyr.compose();
            const want = reader(post);
            let n = 0;
            for (const [x, y] of pixels()) { n++; if (!eq(t.ctx.at(x, y), want(x, y))) throw new Error(`seed ${seed}: pixel ${x},${y}`); }
            expect(n).toBeGreaterThan(100000);
            t.clock.t += 100;
            t.pyr.compose();
            expect([t.pyr.s.olderPatchMs, t.pyr.s.olderOtherMs, t.pyr.s.blurMs]).toEqual([0, 0, 0]);
            expect(t.posted.filter((j) => j.kind === "patch")).toEqual([]);
        }
    });

    test("coarse-first: the coarser level over the dirty rectangles only; never older; full patches asked at priority 0", () => {
        for (const seed of [21, 22]) {
            // Full resolution does not fit the budget; a coarser level does (its area term is a quarter).
            const t = setup(seed, (job) => ({ E: 3000, A: job.kind === "rest" || job.purpose === "coarse" ? 20000 : 400000, U: 0, P: job.cells.length }));
            const pre = reader(restThenUndo(t));
            t.pyr.frameFor(cam(1));
            expect([t.pyr.s.patchInline, t.pyr.s.patchCoarse]).toEqual([0, 1]);
            const asked = t.posted.filter((j) => j.kind === "patch");
            expect(asked.length).toBe(1);
            expect([asked[0].prio, asked[0].cells.length]).toEqual([0, 2]);
            t.pyr.compose();
            const post = reader([[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => whole(t.doc.list, 1, i, j)));
            let changed = 0, shown = 0, outside = 0;
            for (const [x, y] of pixels()) {
                const got = t.ctx.at(x, y), was = pre(x, y);
                if (!eq(post(x, y), was)) { changed++; if (eq(got, was)) shown++; }
                if ((x < FOOT.left - 2 || x > FOOT.right + 2 || y < FOOT.top - 2 || y > FOOT.bottom + 2) && !eq(got, was)) outside++;
            }
            expect(changed).toBeGreaterThan(2000);
            expect([seed, shown]).toEqual([seed, 0]);                     // wherever the undo changed a pixel, the screen changed it
            expect([seed, outside]).toEqual([seed, 0]);                   // nothing outside the change blurred
            t.clock.t += 100;
            t.pyr.compose();
            expect([t.pyr.s.olderPatchMs, t.pyr.s.olderOtherMs]).toEqual([0, 0]);
            expect(t.pyr.s.blurMs).toBeGreaterThan(0);
            // The full patches land: the plates are the post-undo whole render.
            const job = asked[0], packed = t.pack(job);
            for (let p = 0; p < job.cells.length; p++) {
                const out = new Uint8ClampedArray(P * P * 4);
                renderPlate(packed, p, out, null, null, job.clips[p]);
                t.pyr.onResult({ ...job.cells[p], G: packed.G, clip: job.clips[p], pixels: copyPlate(out, job.clips[p]), jobId: 5 });
            }
            [[0, 0], [1, 0]].forEach(([i, j]) => {
                const r = t.store.get(restCell("F", 1, i, j).key);
                expect([seed, i, t.store.exact(r), sameBytes(r.pixels, whole(t.doc.list, 1, i, j))]).toEqual([seed, i, true, true]);
            });
            t.pyr.compose();
            expect(t.pyr.lastPlan.draws.every((d) => d.cls === "sharp" && !d.under)).toBe(true);
        }
    });

    test("pen-up's group commit, inline: the stroke's cells patched, composed and the live path released in one task", () => {
        const t = setup(41, () => ({ E: 100, A: 1000, U: 0, P: 1 }));
        t.doc.list = t.doc.list.filter((o) => o !== STROKE);
        t.pyr.frameFor(cam(1));
        t.pyr.frameFor(cam(1));
        t.doc.list = t.doc.list.concat([STROKE]);                            // the shape lands: packable, its footprint dirt
        t.stage.commit({ F: [FOOT] });
        const seen = [];
        const composes0 = t.pyr.s.composes;
        t.pyr.groupCommit("s900", FOOT, (info) => seen.push({ ...info, composes: t.pyr.s.composes, exact: [...t.store.records()].every((r) => t.store.exact(r)) }));
        expect(seen.length).toBe(1);
        expect(seen[0]).toMatchObject({ id: "s900", committed: 2, missing: 0, timedOut: false, exact: true });
        expect(t.pyr.s.composes).toBe(composes0 + 1);                         // one compose publishes them, after the release call
        expect(eq(t.ctx.at(420, 150), [255, 0, 255])).toBe(true);
    });

    test("pen-up's group commit, workers: results held aside (the old plates stay) until the last lands; 3 s commits what it has", () => {
        // Full resolution over budget, a coarser level within it: the live path still waits for full resolution.
        const t = setup(42, (job) => ({ E: 100, A: job.kind === "rest" || job.purpose === "coarse" ? 1000 : 9e6, U: 0, P: 1 }));
        t.doc.list = t.doc.list.filter((o) => o !== STROKE);
        t.pyr.frameFor(cam(1));
        t.pyr.frameFor(cam(1));
        const before = t.store.get(restCell("F", 1, 0, 0).key).pixels;
        t.doc.list = t.doc.list.concat([STROKE]);
        t.stage.commit({ F: [FOOT] });
        const seen = [];
        t.pyr.groupCommit("s900", FOOT, (info) => seen.push(info));
        const job = t.posted.find((j) => j.group === "s900");
        expect([job.prio, job.cells.length, seen.length, t.pyr.s.patchCoarse]).toEqual([0, 2, 0, 0]);
        t.pyr.refresh();                                                      // as a view change does: the asks forgotten
        t.pyr.frameFor(cam(1));                                               // a frame meanwhile: the group's cells are not patched again
        expect(t.posted.filter((j) => j.kind === "patch").length).toBe(1);
        const packed = t.pack(job);
        const res = job.cells.map((c, p) => {
            const out = new Uint8ClampedArray(P * P * 4);
            renderPlate(packed, p, out, null, null, job.clips[p]);
            return { ...c, G: packed.G, clip: job.clips[p], pixels: copyPlate(out, job.clips[p]), jobId: 9 };
        });
        expect(t.pyr.onResult(res[0])).toBe("held");
        expect(t.store.get(restCell("F", 1, 0, 0).key).pixels).toBe(before);
        expect(t.store.exact(t.store.get(restCell("F", 1, 0, 0).key))).toBe(false);
        t.pyr.onResult(res[1]);
        expect(seen).toMatchObject([{ id: "s900", committed: 2, missing: 0, timedOut: false }]);
        for (const r of t.store.records()) expect(t.store.exact(r)).toBe(true);
        // A second stroke whose results never come: after LIVE_HOLD_MS the group commits what it has.
        t.stage.commit({ F: [{ left: 100, top: 100, right: 120, bottom: 110 }] });
        t.pyr.groupCommit("s901", { left: 100, top: 100, right: 120, bottom: 110 }, (info) => seen.push(info));
        t.clock.t += 2999;
        t.pyr.frameFor(cam(1));
        expect(seen.length).toBe(1);
        t.clock.t += 2;
        t.pyr.frameFor(cam(1));
        expect(seen[1]).toMatchObject({ id: "s901", committed: 0, missing: 1, timedOut: true });
        expect(t.pyr.s.groupsTimedOut).toBe(1);
    });

    test("pen-up's group: a result packed before the stroke landed is not the group's; a zoom re-targets it to the new drawn cells", () => {
        const t = setup(43, (job) => ({ E: 100, A: job.kind === "rest" ? 1000 : 9e6, U: 0, P: 1 }));
        t.doc.list = t.doc.list.filter((o) => o !== STROKE);
        t.pyr.frameFor(cam(1));
        t.pyr.frameFor(cam(1));
        const G0 = t.stage.generation;
        t.doc.list = t.doc.list.concat([STROKE]);
        t.stage.commit({ F: [FOOT] });
        const seen = [];
        t.pyr.groupCommit("s900", FOOT, (info) => seen.push(info));
        const job = t.posted.find((j) => j.group === "s900");
        // A job packed before the landing (G0) comes back for one of the group's cells: put as a stand-in, not held.
        expect(t.pyr.onResult({ ...job.cells[0], G: G0, clip: job.clips[0], pixels: new Uint8ClampedArray(4 * (job.clips[0][2] - job.clips[0][0]) * (job.clips[0][3] - job.clips[0][1])), jobId: 2 })).not.toBe("held");
        expect(seen).toEqual([]);
        // A zoom: the rest set goes, the drawn cells are the level's; the group now waits for those under the stroke.
        t.pyr.frameFor(cam(1.1));
        expect(t.pyr._v.mode).toBe("level");
        const re = t.posted.filter((j) => j.group === "s900" && j !== job);
        expect(re.length).toBe(1);
        expect(re[0].cells.every((c) => c.kind === "level" && c.level === t.pyr._v.level)).toBe(true);
        expect(seen).toEqual([]);
        const late = { ...job.cells[1], G: t.stage.generation, pixels: new Uint8ClampedArray(512 * 512 * 4), bytes: PLATE_BYTES, jobId: 3 };
        expect(t.pyr.onResult(late)).toBe("discarded");                     // a rest result of the discarded set
        const packed = t.pack(re[0]);
        re[0].cells.forEach((c, p) => {
            const out = new Uint8ClampedArray(P * P * 4);
            renderPlate(packed, p, out, null, null);
            t.pyr.onResult({ ...c, G: packed.G, pixels: out, bytes: PLATE_BYTES, jobId: 4 });
        });
        expect(seen).toMatchObject([{ id: "s900", committed: re[0].cells.length, missing: 0, timedOut: false }]);
    });

    test("a patch whose clip misses dirt since the record's G lands its pixels but leaves the record stale", () => {
        const t = setup(31, () => ({ E: 10, A: 10, U: 0, P: 1 }));
        t.pyr.frameFor(cam(1));
        t.pyr.frameFor(cam(1));
        const key = restCell("F", 1, 0, 0).key, G0 = t.store.get(key).G;
        t.stage.commit({ F: [{ left: 10, top: 10, right: 20, bottom: 20 }] });
        t.stage.commit({ F: [{ left: 300, top: 300, right: 310, bottom: 310 }] });
        const clip = [8, 8, 22, 22];                                         // the first change only
        expect(t.pyr.onResult({ ...restCell("F", 1, 0, 0), G: t.stage.generation, clip, pixels: new Uint8ClampedArray(14 * 14 * 4).fill(9), jobId: 1 })).toBe("patched-stale");
        expect(t.store.get(key).G).toBe(G0);
        expect(t.store.exact(t.store.get(key))).toBe(false);
    });

    test("the GPU merge through one scratch OffscreenCanvas equals pastePatch (a software canvas)", () => {
        const RealImageData = global.ImageData;
        global.ImageData = class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
        const bmp = (px) => ({ px, close() { this.closed = true; } });
        const offscreen = () => {
            let px = new Uint8ClampedArray(P * P * 4);
            const c2d = {
                fillStyle: "#ffffff",
                fillRect() { px.fill(255); },
                drawImage(b, x, y) { if (x === 0 && y === 0 && b.px.length === px.length) px.set(b.px); else throw new Error("unexpected draw"); },
                putImageData(img, x, y) { for (let r = 0; r < img.height; r++) px.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * P + x) * 4); },
            };
            return { getContext: () => c2d, transferToImageBitmap: () => { const b = bmp(px); px = new Uint8ClampedArray(P * P * 4); return b; } };
        };
        try {
            const store = new PyramidStore({ maxBytes: 40 * PLATE_BYTES, phone: false, doc: null });
            const pyr = new PicturePyramid(null, { store, stage: fakeStage(), lm: null, width: 800, height: 600, dpr: 1, pixels: false, makeOffscreen: offscreen });
            const rnd = lcg(5);
            for (let n = 0; n < 12; n++) {
                const old = new Uint8ClampedArray(P * P * 4);
                for (let k = 0; k < old.length; k += 97) old[k] = Math.floor(rnd() * 256);
                const x0 = Math.floor(rnd() * 500), y0 = Math.floor(rnd() * 500);
                const clip = [x0, y0, Math.min(P, x0 + 1 + Math.floor(rnd() * 200)), Math.min(P, y0 + 1 + Math.floor(rnd() * 200))];
                const patch = new Uint8ClampedArray((clip[2] - clip[0]) * (clip[3] - clip[1]) * 4).map(() => Math.floor(rnd() * 256));
                const m = pyr.merge({ bitmap: bmp(old.slice()) }, patch, clip);
                expect(sameBytes(m.bitmap.px, pastePatch(old.slice(), patch, clip))).toBe(true);
            }
            // A paper plate (no bitmap) is filled first, then patched.
            const clip = [10, 10, 20, 20], patch = new Uint8ClampedArray(400).fill(7);
            expect(sameBytes(pyr.merge({ bitmap: null }, patch, clip).bitmap.px, pastePatch(new Uint8ClampedArray(P * P * 4).fill(255), patch, clip))).toBe(true);
            expect(pyr.s.merges).toBe(13);
        } finally { global.ImageData = RealImageData; }
    });
});
