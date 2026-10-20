/**
 * raster.occlusion.test.js — the occlusion cull (Kobin, 2026-09-23: "once the screen is covered by
 * full-opacity objects at the very top of the Z stack, it should be done looking"). Per plate, the
 * topmost family whose coverage fills the whole plate opaquely hides every family under it, and the
 * core paints from it up. Measured at the Magnum Opus's nucleus: 41 whole-plate backdrops a plate,
 * 97 % of each job in the resolve (PAPER-PLAN §10.18). Every case here is checked pixel for pixel
 * against the same job painted with the cull off. The pack's cover test (F157) leaves out what such a
 * family hides before the job is copied: its cases are checked against the pack with the test off, the
 * core's cull off so it cannot hide a wrong proof; and a plate stops proving once its failed proofs spend
 * COVER_TRIES or COVER_NODES (B1-B6).
 */
import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { Loop } from "../geometry/loop";

const TW = core.TW, TH = core.TH;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25, fatWidthPx: 4000 };
const PLATES = Int32Array.from([0, 0]);

function shapeItem(id, rings, extra) {
    const loops = rings.map((ring) => {
        const nums = [ring[0][0], ring[0][1]];
        for (let i = 1; i < ring.length; i++) nums.push(0, ring[i][0], ring[i][1]);
        return new Loop(Float64Array.from(nums));
    });
    return Object.assign({ type: "shape", id, loops, color: "#ffffff", opacity: 1 }, extra);
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const FULL = rect(-40, -40, TW + 40, TH + 40);
const colour = (k) => "rgb(" + ((37 * k) % 256) + "," + ((91 * k) % 256) + "," + ((53 * k + 20) % 256) + ")";

/** The core's cull on or off, over a job that carries every family (the pack's own occlusion off; F157's are below). */
function paint(list, opts, occlusion) {
    core.setOcclusion(occlusion);
    pack.setPackOcclusion(false);
    let job;
    try { job = pack.packJob(list, Object.assign({ plates: PLATES, q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [255, 255, 255] }, opts)); }
    finally { pack.setPackOcclusion(true); }
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8);
    core.renderPlate(job, 0, out, counts);
    core.setOcclusion(true);
    return { out, counts };
}
/** Painted with the cull and without: the pixels, the families each painted and how many the cull skipped. */
function both(list, opts) {
    pack.clearPackCaches();
    core.occStats.occluded = 0; core.occStats.coverMisses = 0;
    const on = paint(list, opts, true);
    const occluded = core.occStats.occluded, misses = core.occStats.coverMisses;
    pack.clearPackCaches();
    const off = paint(list, opts, false);
    let differ = 0;
    for (let i = 0; i < on.out.length; i++) if (on.out[i] !== off.out[i]) differ++;
    return { differ, occluded, misses, famOn: on.counts[2], famOff: off.counts[2] };
}
/** `n` opaque backdrops over the whole plate, each its own colour and z. */
const backdrops = (n, id0 = 1) => Array.from({ length: n }, (_, k) => shapeItem(id0 + k, [FULL], { color: colour(k + 1), z: id0 + k }));

afterEach(() => core.setOcclusion(true));

describe("the occlusion cull (PAPER-PLAN §10.18)", () => {
    test("O1 thirty opaque backdrops under a small top shape: only the top backdrop and the shape are painted, the same pixels", () => {
        const list = backdrops(30).concat([shapeItem(99, [rect(100, 100, 200, 180)], { color: "#d02020", z: 99 })]);
        const r = both(list);
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(29);                      // red with the cull off: every backdrop painted
        expect(r.misses).toBe(0);                          // the small shape's box does not span the plate: never scanned
        expect(r.famOn).toBe(2);
        expect(r.famOff).toBe(31);
    });

    test("O2 a translucent backdrop on top hides nothing; the opaque one under it is the cover", () => {
        const list = backdrops(10).concat([shapeItem(50, [FULL], { color: "#2060d0", opacity: 0.5, z: 50 })]);
        const r = both(list);
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(9);                        // the translucent one is painted over the top opaque one
        expect(r.famOn).toBe(2);
    });

    test("O3 a backdrop with a hole covers nothing; the one under it does", () => {
        const holed = shapeItem(50, [FULL, rect(200, 200, 300, 300).reverse()], { color: "#20a060", z: 50 });
        const r = both(backdrops(10).concat([holed]));
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(9);
        expect(r.misses).toBe(1);                          // the holed one was tried and fell short
    });

    test("O4 a backdrop whose edge is inside the plate covers nothing", () => {
        const list = [shapeItem(1, [FULL], { color: "#101010", z: 1 }), shapeItem(2, [rect(-40, -40, TW - 0.5, TH + 40)], { color: "#f0f0f0", z: 2 })];
        const r = both(list);
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(0);                        // the half-pixel column at the right shows the one under it
    });

    test("O5 backdrops under a pending eraser mark are masked, so none of them hides the ones under it", () => {
        const mark = shapeItem(90, [rect(100, 100, 300, 300)], { color: "#ffffff", erase: true, z: 90, targets: [1, 2, 3, 4, 5] });
        const list = backdrops(5).concat([mark]);
        for (const o of list) if (!o.erase) o.targetOf = [90];            // its targets (eraseRule.underMask)
        const r = both(list);
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(0);                        // red when a masked backdrop counts as a cover: the ring shows its own colour, not the one under
    });

    test("O6 a family whose pieces together fill the plate is a cover", () => {
        const left = shapeItem(40, [rect(-40, -40, 260, TH + 40)], { color: "#806020", z: 40, editId: 40 });
        const right = shapeItem(41, [rect(250, -40, TW + 40, TH + 40)], { color: "#806020", z: 40, editId: 40 });
        const r = both(backdrops(6).concat([left, right]));
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(6);
    });

    test("O7 a transparent plate (the drag plane's) is culled the same way and keeps its alpha", () => {
        const list = backdrops(8).concat([shapeItem(99, [rect(10, 10, 60, 60)], { color: "#d02020", z: 99 })]);
        const r = both(list, { paper: [0, 0, 0, 0] });
        expect(r.differ).toBe(0);
        expect(r.occluded).toBe(7);
    });
});

/** F157's cases: a shape of straight rings at z = its id, a circle of one arc piece, a legacy fill, a backdrop under them. */
const shape = (id, rings, extra) => shapeItem(id, rings, Object.assign({ z: id, color: "#206040" }, extra));
const fill = (id, rings) => ({ type: "fill", id, z: id, polys: rings, color: "#206040", opacity: 1 });
const circle = (id, cx, cy, radius, sign = 1) => ({ type: "shape", id, z: id, color: "#206040", opacity: 1,
    loops: [new Loop(Float64Array.from([cx + radius, cy, 1, cx, cy, radius, 0, sign * 2 * Math.PI, cx + radius, cy]))] });
const under = () => shape(1, [FULL], { color: "#f03020" });

/** One pack with F157's test on or off, every plate rendered through its clip. */
function packPaint(list, opts, on) {
    pack.setPackOcclusion(on);
    pack.resetPackStats();
    const job = pack.packJob(list, Object.assign({ plates: PLATES, Zq: 1, dpr: 1, cfg: CFG, paper: [255, 255, 255] }, opts));
    const stats = Object.assign({}, pack.packStats), pixels = [];
    for (let p = 0; p < job.plates.length / 2; p++) {
        const out = new Uint8ClampedArray(TW * TH * 4);
        core.renderPlate(job, p, out, undefined, undefined, opts.clips && opts.clips[p]);
        pixels.push(out);
    }
    return { job, stats, pixels };
}
const differ = (a, b) => a.pixels.reduce((n, px, p) => { for (let i = 0; i < px.length; i++) if (px[i] !== b.pixels[p][i]) n++; return n; }, 0);
/** The test on against off, the core's cull off; `warm`: the proof's memo filled by a pack before. */
function packBoth(list, opts = {}, warm = false) {
    core.setOcclusion(false);
    pack.clearPackCaches();
    const off = packPaint(list, opts, false);
    if (warm) packPaint(list, opts, true);
    const on = packPaint(list, opts, true);
    expect(differ(off, on)).toBe(0);
    return { on, off };
}

describe("the pack's cover test (F157): an opaque family whose outline holds the plate hides what is under it", () => {
    afterEach(() => pack.setPackOcclusion(true));

    test.each([false, true])("P1 twelve opaque outlines over the plate: the top one is packed, the walk stops there (memo warm: %s)", (warm) => {
        const list = Array.from({ length: 12 }, (_, k) => shape(k + 1, [FULL], { color: "rgb(" + k * 10 + ",20,50)" }));
        const { on, off } = packBoth(list, {}, warm);
        expect(on.job.nItems).toBe(1);                     // red with the test off: 12
        expect(off.job.nItems).toBe(12);
        expect(on.stats.unwalked).toBe(11);
    });

    test("P2 a hole inside the plate: its edges cross the plate, no cover", () => {
        expect(packBoth([under(), shape(2, [FULL, rect(4, 4, 35, 35).reverse()])]).on.job.nItems).toBe(2);
    });

    test("P3 a hole around the whole plate: no edge crosses it, but the centre's winding is 0, no cover", () => {
        expect(packBoth([under(), shape(2, [FULL, rect(-4, -4, 516, 516).reverse()])]).on.job.nItems).toBe(2);
    });

    test("P4 nested loops wound the same way go through the union and cover", () => {
        const { on } = packBoth([under(), shape(2, [FULL, rect(-10, -10, 522, 522)])]);
        expect(on.job.nItems).toBe(1);
        expect(on.stats.unionItems).toBe(1);
    });

    test("P5 one family's two outlines wound opposite ways cancel, though each holds the plate: no cover", () => {
        const list = [under(), shape(2, [FULL], { editId: 20, z: 2 }), shape(3, [FULL.slice().reverse()], { editId: 20, z: 2 })];
        expect(packBoth(list).on.job.nItems).toBe(3);
    });

    test.each([1, -1])("P6 a whole circle clear of the plate covers, either way round (%s)", (sign) => {
        expect(packBoth([under(), circle(2, 256, 256, 410, sign)]).on.job.nItems).toBe(1);
    });

    test("P7 a circle through the plate's corners, its centre inside: no cover", () => {
        expect(packBoth([under(), circle(2, 256, 256, 350)]).on.job.nItems).toBe(2);
    });

    test("P8 a circle a quarter pixel inside the plate's corners: no cover", () => {
        expect(packBoth([under(), circle(2, 256, 256, Math.sqrt(2) * 256 - 0.25)]).on.job.nItems).toBe(2);
    });

    test("P9 a translucent outline hides nothing", () => {
        expect(packBoth([under(), shape(2, [FULL], { opacity: 0.5 })]).on.job.nItems).toBe(2);
    });

    test("P10 a faded single item hides nothing", () => {
        expect(packBoth([under(), shape(2, [FULL], { fadeTag: 57.6 })]).on.job.nItems).toBe(2);
    });

    test("P11 a family ignores a piece's fade, as the core does", () => {
        expect(packBoth([under(), shape(2, [FULL], { editId: 20, fadeTag: 80 })]).on.job.nItems).toBe(1);
    });

    test("P12 a pending eraser mark in the strip turns the test off", () => {
        const list = [under(), shape(2, [FULL]), shape(3, [rect(4, 4, 50, 50)], { erase: true, targets: [2] })];
        list[1].targetOf = [3];
        const { on, off } = packBoth(list);
        expect(on.job.nItems).toBe(off.job.nItems);
        expect(on.stats.coverTests).toBe(0);
    });

    /** A family drawn in plate (0, 0), hidden there by a cover, and in plate (1, 0), seen. */
    const split = (a, b) => [shape(1, [rect(10, 10, 100, 100)], Object.assign({ editId: 10, z: 1 }, a)),
        shape(2, [rect(550, 10, 700, 100)], Object.assign({ editId: 10, z: 1 }, b)), shape(3, [FULL])];
    const TWO = { plates: Int32Array.from([0, 0, 1, 0]) };

    test("P13 a family hidden in one plate and seen in another keeps its hidden item when their colours differ", () => {
        expect(packBoth(split({ color: "red" }, { color: "blue" }), TWO).on.job.nItems).toBe(3);   // the family's colour is its first item's
    });

    test("P14 the same family of one colour leaves the hidden item out", () => {
        expect(packBoth(split({}, {}), TWO).on.job.nItems).toBe(2);
    });

    test("P15 the same family with two opacities: the seen item's alpha is unchanged", () => {
        packBoth(split({ opacity: 0.15 }, { opacity: 0.65 }), TWO);
    });

    test("P16 a legacy fill's ring covers; one with a hole in the plate does not", () => {
        expect(packBoth([under(), fill(2, [FULL])]).on.job.nItems).toBe(1);
        expect(packBoth([under(), fill(2, [FULL, rect(7, 7, 50, 50).reverse()])]).on.job.nItems).toBe(2);
    });

    test("P17 a transparent plate keeps its exact RGBA", () => {
        packBoth([under(), shape(2, [FULL]), shape(3, [rect(100, 100, 300, 300)], { opacity: 0.3, color: "blue" })], { paper: [0, 0, 0, 0] });
    });

    test("P18 a residual, an offset and a negative plate origin: the proof is made where the core draws", () => {
        packBoth([under(), shape(2, [FULL], { res: [-512, 512] })], { plates: Int32Array.from([-1, 1]), offset: [0.25, 0.125] }, true);
    });

    test("P19 a changed residual is proved again, not remembered", () => {
        const list = [under(), shape(2, [FULL])];
        packBoth(list, {}, true);
        list[1].res = [256, 0];
        const off = packPaint(list, {}, false), on = packPaint(list, {}, true);
        expect(differ(off, on)).toBe(0);
        expect(on.job.nItems).toBe(2);
    });

    test("P20 a clipped pack: the clip's pixels are the same", () => {
        packBoth([under(), shape(2, [FULL]), shape(3, [rect(10, 10, 30, 30)], { color: "blue" })], { clips: [[5, 5, 40, 40]] });
    });

    test("P21 one family of two outlines tiling the plate declines the cover: its inner edges cross the plate", () => {
        const list = [under(), shape(2, [rect(-40, -40, 270, 552)], { editId: 20 }), shape(3, [rect(240, -40, 552, 552)], { editId: 20, z: 2 })];
        expect(packBoth(list).on.job.nItems).toBe(3);
    });

    test.each([256, 512.5, 514, 520])("P22 a clamped arc of radius 1e15 at the plate's edge stays exact (apex at x = %s)", (apex) => {
        const R = 1e15, sweep = Math.PI / 2, cx = apex - R, cy = 256, a0 = -sweep * (0.5 + 0.5 / 2 ** 24);
        const A = [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R], B = [cx + Math.cos(a0 + sweep) * R, cy + Math.sin(a0 + sweep) * R];
        const nums = [-1e6, A[1], 0, A[0], A[1], 1, cx, cy, R, a0, sweep, B[0], B[1], 0, -1e6, B[1]];
        core.coreStats.arcClamped = 0;
        packBoth([under(), Object.assign(shape(2, []), { loops: [new Loop(Float64Array.from(nums))] })]);
        expect(core.coreStats.arcClamped).toBeGreaterThan(0);
    });
});

describe("the cover proofs' budget (F157): a plate stops proving after COVER_TRIES failed proofs or COVER_NODES nodes", () => {
    afterEach(() => pack.setPackOcclusion(true));
    const N = pack.COVER_TRIES, K = Math.ceil(pack.COVER_NODES / 2);
    /** An opaque circle through plate (0, 0)'s corners: a proof that fails in a few nodes. */
    const circles = (n, id0 = 100) => Array.from({ length: n }, (_, k) => circle(id0 + k, 256, 256, 350));
    /** An opaque outline of `k` edges round plate (0, 0), clear of it, then one into it: a failed proof of k + 1 nodes. */
    const long = (id, k) => {
        const ring = [];
        for (let i = 0; i <= k; i++) { const a = (i / k) * 1.5 * Math.PI; ring.push([256 + 400 * Math.cos(a), 256 + 400 * Math.sin(a)]); }
        ring.push([256, 256]);
        return shape(id, [ring]);
    };
    /** Families whose proofs fail on plate (0, 0) above a backdrop over it, `under()` beneath: the backdrop is the cover. */
    const above = (fails) => [under(), shape(2, [FULL], { color: "#d0d0d0" })].concat(fails);

    test("B1 a cover under one failed proof fewer than COVER_TRIES is found", () => {
        const { on } = packBoth(above(circles(N - 1)));
        expect(on.stats.coverTests).toBe(N);              // N − 1 failures, then the backdrop's proof
        expect(on.stats.covered).toBe(1);
        expect(on.job.nItems).toBe(N);                    // the circles and the backdrop: `under` left out
    });

    test.each([false, true])("B2 a plate out of tries packs every family under it, memo warm or cold (warm: %s)", (warm) => {
        const { on, off } = packBoth(above(circles(N)), {}, warm);
        expect(on.stats.coverTests).toBe(N);              // red without the count: the backdrop's proof is the N + 1st
        expect(on.stats.covered).toBe(0);
        expect(on.stats.coverSpent).toBe(1);
        expect(on.job.nItems).toBe(off.job.nItems);       // red, warm, when a remembered failure is free
    });

    test("B3 only proofs tried count: translucent and small families above spend no try", () => {
        const lit = Array.from({ length: N }, (_, k) => Object.assign(circle(300 + k, 256, 256, 410), { opacity: 0.5 }));
        const small = Array.from({ length: N }, (_, k) => shape(400 + k, [rect(10 + k, 10, 20 + k, 20)]));
        const { on } = packBoth(above(circles(N - 1)).concat(lit, small));
        expect(on.stats.covered).toBe(1);
        expect(on.job.nItems).toBe(3 * N);                // `under` left out
    });

    test("B4 the budget is a plate's: one out of tries does not stop its neighbour's cover", () => {
        const list = [shape(1, [rect(20, 20, 60, 60)], { color: "#f03020" }), shape(3, [rect(600, 20, 700, 60)], { color: "#f03020", z: 1 }),
            shape(5, [rect(-40, -40, 1064, 552)], { color: "#d0d0d0" })].concat(circles(N));
        const { on, off } = packBoth(list, { plates: Int32Array.from([0, 0, 1, 0]) });
        expect(on.stats.covered).toBe(1);                 // plate (1, 0): the backdrop is its first proof
        expect(on.stats.coverSpent).toBe(1);              // plate (0, 0)
        expect(on.job.nItems).toBe(off.job.nItems - 1);   // the shape under the backdrop in plate (1, 0) left out
    });

    test("B5 a failed proof of fewer than COVER_NODES nodes leaves the plate its cover", () => {
        const { on } = packBoth(above([long(10, K)]));
        expect(on.stats.covered).toBe(1);
        expect(on.job.nItems).toBe(2);
    });

    test.each([false, true])("B6 two failed proofs walking more than COVER_NODES nodes spend the plate, memo warm or cold (warm: %s)", (warm) => {
        const { on, off } = packBoth(above([long(10, K), long(11, K)]), {}, warm);
        expect(on.stats.coverTests).toBe(2);              // red without the node budget: 3, the backdrop found
        expect(on.stats.coverSpent).toBe(1);
        expect(on.job.nItems).toBe(off.job.nItems);       // red, warm, when a remembered walk's nodes are free
    });
});
