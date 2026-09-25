/**
 * raster.occlusion.test.js — the occlusion cull (Kobin, 2026-09-23: "once the screen is covered by
 * full-opacity objects at the very top of the Z stack, it should be done looking"). Per plate, the
 * topmost family whose coverage fills the whole plate opaquely hides every family under it, and the
 * core paints from it up. Measured at the Magnum Opus's nucleus: 41 whole-plate backdrops a plate,
 * 97 % of each job in the resolve (PAPER-PLAN §10.18). Every case here is checked pixel for pixel
 * against the same job painted with the cull off.
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

function paint(list, opts, occlusion) {
    core.setOcclusion(occlusion);
    const job = pack.packJob(list, Object.assign({ plates: PLATES, q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [255, 255, 255] }, opts));
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
        const mark = shapeItem(90, [rect(100, 100, 300, 300)], { color: "#ffffff", erase: true, z: 90 });
        const r = both(backdrops(5).concat([mark]));
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
