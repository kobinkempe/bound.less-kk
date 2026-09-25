/**
 * raster.oracle.test.js — O1–O4 of RASTERISER-PLAN §9.2: the core against the independent
 * exact-winding oracle (`__oracles__/coverageOracle.js`), on line-only fixtures (arcs are
 * stage 1), and O4 the oracle's own `ringsFromLoops`, which nothing in `src/` calls. White
 * ink on black paper, so a stored byte is 255 × coverage.
 *
 * The bar is 1/16 of coverage per pixel — the oracle's own y quantisation at K = 16, which
 * is the bound that matters — plus half a byte for the 8-bit rounding of the comparison.
 */

import * as core from "./rasterCore";
import { ringsNeedUnion } from "./rasterPack";
import { coverRings, ringsArea, ringsFromLoops } from "../__oracles__/coverageOracle";
import { strokeStripNear } from "../geometry/polyline";

const TW = core.TW, TH = core.TH;
const BAR = 1 / 16 + 0.5 / 255;

/**
 * The routing the SHIPPED packer uses — `rasterPack.ringsNeedUnion`, not a copy of the rule here:
 * a copy is how these fixtures went on being painted through the union pass after D91 moved them
 * to the fast path. The boxes and the signed areas are the oracle's own, so what is shared with
 * production is the predicate and nothing else.
 */
function wantsUnion(shape) {
    if (shape.fromStroke) return true;                   // a band is overlapping same-wound rings (§4.2)
    const rings = shape.rings;
    const boxes = new Float64Array(rings.length * 4), signs = new Float64Array(rings.length);
    for (let i = 0; i < rings.length; i++) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of rings[i]) {
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        }
        boxes[i * 4] = x0; boxes[i * 4 + 1] = y0; boxes[i * 4 + 2] = x1; boxes[i * 4 + 3] = y1;
        signs[i] = ringsArea([rings[i]]);
    }
    return ringsNeedUnion(boxes, signs, rings.length);
}

/** One item of rings on one plate, through renderPlate, with the union flag as given. */
function paint(rings, union) {
    const out = new Uint8ClampedArray(TW * TH * 4);
    const geom = [], subs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings) {
        subs.push(geom.length / 2);
        for (const p of ring) {
            geom.push(p[0], p[1]);
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        }
    }
    const meta = new Uint32Array(8), attr = new Float64Array(9), rgb = Uint8Array.from([255, 255, 255]);
    meta[0] = 1; meta[1] = 0; meta[2] = 0; meta[3] = geom.length; meta[4] = 0; meta[5] = subs.length;
    meta[6] = union ? 4 : 0;
    attr[0] = x0; attr[1] = y0; attr[2] = x1; attr[3] = y1; attr[7] = 1;
    core.renderPlate({
        Zq: 1, plates: Int32Array.from([0, 0]), paper: Uint8Array.from([0, 0, 0]), nItems: 1,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    }, 0, out);
    return out;
}

/** The worst difference between the painted bytes and the oracle's coverage. */
function worstDiff(out, cov) {
    let worst = 0, atx = -1, aty = -1;
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const d = Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]);
        if (d > worst) { worst = d; atx = x; aty = y; }
    }
    return { worst, x: atx, y: aty };
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const poly = (cx, cy, r, n, phase = 0) => {
    const ring = [];
    for (let i = 0; i < n; i++) {
        const t = phase + (2 * Math.PI * i) / n;
        ring.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    return ring;
};
/** A band around a polyline, as the engine builds one: overlapping same-wound rings. */
const band = (pts, width) => strokeStripNear(pts, width, { left: 0, top: 0, right: TW, bottom: TH }, { startCap: true, endCap: true });

/** The 40 shapes of O1: simple polygons, nested holes, self-overlapping bands, slivers, clipped shapes. */
function fixture() {
    const shapes = [];
    // 10 simple polygons, no overlap: the fast path
    shapes.push({ name: "square", rings: [rect(10.5, 10.25, 90.75, 90.5)] });
    shapes.push({ name: "triangle", rings: [[[20, 20], [140.5, 60.25], [60, 150.75]]] });
    shapes.push({ name: "pentagon", rings: [poly(120, 120, 80, 5)] });
    for (const r of [3, 9, 40, 120]) shapes.push({ name: "circle r=" + r, rings: [poly(200.25, 150.5, r, Math.max(8, Math.round(r * 2)))] });
    shapes.push({ name: "L", rings: [[[10, 10], [100, 10], [100, 40], [40, 40], [40, 120], [10, 120]]] });
    shapes.push({ name: "spike", rings: [[[10, 200], [200, 202], [10, 204]]] });
    shapes.push({ name: "wedge", rings: [[[5.125, 5.875], [180.5, 6.125], [90.25, 60.75]]] });
    // 6 nested holes: two rings, boxes overlap, opposite orientation
    for (const [r, h] of [[100, 60], [60, 55], [40, 5], [30, 29.5], [20, 2], [150, 149]]) {
        shapes.push({ name: "hole " + r + "/" + h, rings: [poly(220, 220, r, 40), poly(220, 220, h, 40).reverse()] });
    }
    // 10 self-overlapping bands built the way the engine builds one
    const lines = [
        [[20, 30], [200, 30]],
        [[20, 60], [120, 60], [200, 120]],
        [[30, 90], [90, 150], [150, 90], [210, 150]],
        [[40, 200], [120, 210], [40, 220]],
        [[20, 250], [220, 252]],
    ];
    for (const pts of lines) for (const w of [0.55, 6]) shapes.push({ name: "band " + w, fromStroke: true, rings: band(pts, w) });
    // 8 slivers under a pixel: the F-Z regime, single ring, fast path
    for (const w of [0.02, 0.05, 0.1, 0.15, 0.3, 0.45, 0.7, 0.95]) {
        shapes.push({ name: "sliver " + w, rings: [rect(300.5, 10, 300.5 + w, 200)] });
    }
    // 6 shapes the plate cuts
    shapes.push({ name: "over left", rings: [rect(-200, 10, 60.5, 100)] });
    shapes.push({ name: "over right", rings: [rect(400.25, 10, 900, 100)] });
    shapes.push({ name: "over top", rings: [rect(10, -300, 100, 80.5)] });
    shapes.push({ name: "over bottom", rings: [rect(10, 400.75, 100, 800)] });
    shapes.push({ name: "covering", rings: [rect(-50, -50, TW + 50, TH + 50)] });
    shapes.push({ name: "diagonal", rings: [[[-100, -100], [TW + 100, TH - 100], [TW + 100, TH + 100], [-100, 100]]] });
    return shapes;
}

beforeEach(() => {
    core.useAccumPrecision("f32");
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("the rasteriser against the coverage oracle", () => {
    test("O1 forty shapes, each on the path §4.2 sends it to, every pixel within 1/16", () => {
        const shapes = fixture();
        expect(shapes.length).toBe(40);
        let union = 0, worstFast = 0, worstUnion = 0, nested = 0, worstNested = 0;
        for (const shape of shapes) {
            const u = wantsUnion(shape);
            if (u) union++;
            const out = paint(shape.rings, u);
            const cov = coverRings(shape.rings, TW, TH, 16);
            const d = worstDiff(out, cov);
            if (d.worst > BAR) {
                throw new Error("O1: " + shape.name + " is off by " + d.worst.toFixed(4) + " at " + d.x + "," + d.y);
            }
            if (u) worstUnion = Math.max(worstUnion, d.worst); else worstFast = Math.max(worstFast, d.worst);
            // the six nested holes are the class D91 moved to the fast path, and the two thinnest
            // are annuli half a pixel wide: they must be routed there AND come out the oracle's
            if (shape.name.startsWith("hole ")) {
                expect(u).toBe(false);
                nested++;
                worstNested = Math.max(worstNested, d.worst);
            }
        }
        expect(union).toBe(10);                       // the 10 bands; a nested hole is not one (D91)
        expect(nested).toBe(6);
        expect(worstNested).toBeLessThan(BAR);
        expect(worstFast).toBeLessThan(BAR);
        // the union pass quantises y exactly as the oracle does, so it agrees far inside the bar
        expect(worstUnion).toBeLessThan(0.01);
        expect(core.coreStats.unionRefills).toBe(0);
    });

    test("O2 a family of overlapping loops of opposite orientation takes the union pass and matches", () => {
        const rings = [rect(10, 0, 10.5, 200), rect(10.5, 0, 11, 200).reverse()];
        expect(wantsUnion({ rings })).toBe(true);
        const cov = coverRings(rings, TW, TH, 16);
        expect(cov[100 * TW + 10]).toBeCloseTo(1, 12);          // the two halves fill the pixel

        const union = paint(rings, true);
        expect(worstDiff(union, cov).worst).toBeLessThan(BAR);
        expect(union[(100 * TW + 10) * 4]).toBe(255);

        // and the answer plain accumulation gives, recorded: the integral cancels to blank
        const plain = paint(rings, false);
        expect(plain[(100 * TW + 10) * 4]).toBe(0);
    });

    test("O3 the fat-stroke case: the band at four widths, against the oracle and against plain accumulation", () => {
        // A straight run and a 90° corner, on fractional coordinates: where a band's shared
        // boundary happens to land on whole pixels there is no partial pixel to double, and
        // plain accumulation is right by accident — the aligned case hides the defect.
        const pts = [[40.25, 100.4], [240.25, 100.4], [240.25, 300.4]];
        const record = [];
        for (const w of [0.3, 0.55, 2, 40]) {
            const rings = band(pts, w);
            const cov = coverRings(rings, TW, TH, 16);
            const u = paint(rings, true);
            const p = paint(rings, false);
            const du = worstDiff(u, cov), dp = worstDiff(p, cov);
            record.push({ w, rings: rings.length, union: +du.worst.toFixed(4), plain: +dp.worst.toFixed(4) });
            expect(du.worst).toBeLessThan(BAR);

            // the width the union pass paints, against the exact ink area of the rings
            let sum = 0;
            for (let i = 0; i < u.length; i += 4) sum += u[i] / 255;
            let ora = 0;
            for (let i = 0; i < cov.length; i++) ora += cov[i];
            expect(Math.abs(sum - ora) / ora).toBeLessThan(0.02);
        }
        // plain accumulation is wrong by far more than the bar at every width, which is the
        // regression this records: if the routing ever stops sending a band to the union pass,
        // these numbers are what comes back.
        for (const r of record) expect(r.plain).toBeGreaterThan(4 * BAR);
        expect(record.map((r) => r.w)).toEqual([0.3, 0.55, 2, 40]);
        // a 0.55 px straight run: the true ink, and the double it would be painted at
        const straight = band([[40.25, 100.4], [240.25, 100.4]], 0.55);
        const covS = coverRings(straight, TW, TH, 16);
        const y = 100, col = 120;
        const oracle = covS[y * TW + col] + covS[(y - 1) * TW + col];
        // A HORIZONTAL band is where the 1/16 y quantisation shows: the oracle reads this one
        // at 9/16, the true 0.55 rounded up by one sub-scanline. That is the bar, not an error.
        expect(Math.abs(oracle - 0.55)).toBeLessThanOrEqual(1 / 16);
        const uS = paint(straight, true), pS = paint(straight, false);
        const inkU = uS[(y * TW + col) * 4] + uS[((y - 1) * TW + col) * 4];
        const inkP = pS[(y * TW + col) * 4] + pS[((y - 1) * TW + col) * 4];
        expect(Math.abs(inkU / 255 - oracle)).toBeLessThan(2 / 255);
        expect(Math.abs(inkU / 255 - 0.55)).toBeLessThanOrEqual(1 / 16);
        expect(inkP).toBeGreaterThan(inkU * 1.6);               // plain accumulation paints it near-solid
    });

    test("O4 ringsFromLoops reads the loop grammar, and samples an arc inside its tolerance", () => {
        // codes 0 (line) and 2 (cut line, F43): geometry/loop.js:6-11. A cut line's B is its last
        // two numbers, and the four numbers before it are the cut's own P, Q, sa, sb, not points.
        const open = [10, 10, 0, 100, 10, 2, 0, 0, 1, 1, 0.25, 0.75, 100, 80, 0, 10, 80];
        expect(ringsFromLoops([open], 1 / 64)).toEqual([[[10, 10], [100, 10], [100, 80], [10, 80]]]);
        // the same loop sealed back to its start: the repeated point is dropped, not doubled
        const closed = open.concat([0, 10, 10]);
        expect(ringsFromLoops([closed], 1 / 64)).toEqual(ringsFromLoops([open], 1 / 64));
        expect(ringsFromLoops([[10, 10]], 1 / 64)).toEqual([]);            // fewer than 5 numbers: no ring

        // a quarter disc: an arc of radius 50 from (150, 100) to (100, 150), then a line to the
        // centre. The sampled ring is INSCRIBED, so its area is short of the exact sector by at
        // most (2/3)·arcLength·tol = 0.82 of a square pixel, and never over it.
        const tol = 1 / 64, r = 50;
        const sector = [150, 100, 1, 100, 100, r, 0, Math.PI / 2, 100, 150, 0, 100, 100];
        const ring = ringsFromLoops([sector], tol)[0];
        const exact = (Math.PI * r * r) / 4;
        const area = Math.abs(ringsArea([ring]));
        expect(ring.length).toBeGreaterThan(20);                           // 32 chords at this tolerance
        expect(area).toBeLessThan(exact);
        expect(exact - area).toBeLessThan((2 / 3) * ((Math.PI / 2) * r) * tol);
        // every sampled point is on the circle, and the ends are the record's own A and B
        for (const p of ring.slice(0, ring.length - 1)) {
            expect(Math.hypot(p[0] - 100, p[1] - 100)).toBeCloseTo(r, 9);
        }
        expect(ring[0]).toEqual([150, 100]);
        expect(ring[ring.length - 2]).toEqual([100, 150]);
        expect(ring[ring.length - 1]).toEqual([100, 100]);
        // a coarser tolerance is fewer chords, and still inscribed
        const coarse = ringsFromLoops([sector], 1)[0];
        expect(coarse.length).toBeLessThan(ring.length);
        expect(Math.abs(ringsArea([coarse]))).toBeLessThan(exact);
    });

    test("the shoelace area of a ring is the oracle's own reading of it", () => {
        expect(Math.abs(ringsArea([rect(0, 0, 10, 20)]))).toBeCloseTo(200, 12);
        expect(ringsArea([rect(0, 0, 10, 20)])).toBeGreaterThan(0);
        expect(ringsArea([rect(0, 0, 10, 20).reverse()])).toBeLessThan(0);
        expect(ringsArea(band([[10, 10], [100, 10]], 4))).toBeLessThan(0);   // strokeStripNear normalises
    });
});
