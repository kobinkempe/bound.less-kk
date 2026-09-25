/**
 * raster.familyUlp.test.js — the rebuild's invariant "the pieces of one object join without a seam
 * and get their alpha once", in the form that makes it provable (review/rebuild/PLAN.md §3 row 4):
 * a family's union is insensitive to a last-bit disagreement at a shared edge. Two pieces whose
 * shared edge arrives as different float64 bits (a one-ulp gap, or a one-ulp overlap) paint the
 * same plate as the exact join, byte for byte, except at a rounding tie: the accumulator holds the
 * difference of the two deposits (−ulp, which float32 represents), so where the exact value sits
 * on a half (coverage 1 at alpha 0.5 is 127.5) the byte can move by one step along the shared
 * edge. Never more, and never anywhere else.
 *
 * The negative control shows what the family buys: the same two pieces as two families composite
 * source-over at a half-pixel edge and leave the hairline (DESIGN.md §9, "one path per logical
 * object"). White ink on black paper, as in rasterCore.test.js, so a byte is 255 × coverage.
 */

import { PLATE_PX } from "./plate";
import * as core from "./rasterCore";

const TW = core.TW, TH = core.TH;
const WHITE = [255, 255, 255];

/** One job in §3.3's layout, rings only. An item is { rings, fam, alpha, color }. */
function makeJob(items, opts = {}) {
    const { Zq = 1, paper = [0, 0, 0], plate = [0, 0] } = opts;
    const n = items.length;
    const meta = new Uint32Array(8 * n), attr = new Float64Array(9 * n), rgb = new Uint8Array(3 * n);
    const geom = [], subs = [], ids = [];
    items.forEach((item, k) => {
        const gs = geom.length, ss = subs.length;
        let sc = 0;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of item.rings) {
            subs.push((geom.length - gs) / 2);
            for (const p of ring) {
                geom.push(p[0], p[1]);
                if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
            }
            sc++;
        }
        meta[k * 8] = 1;
        meta[k * 8 + 1] = item.fam == null ? k : item.fam;
        meta[k * 8 + 2] = gs;
        meta[k * 8 + 3] = geom.length - gs;
        meta[k * 8 + 4] = ss;
        meta[k * 8 + 5] = sc;
        meta[k * 8 + 6] = 0;
        attr[k * 9] = x0; attr[k * 9 + 1] = y0; attr[k * 9 + 2] = x1; attr[k * 9 + 3] = y1;
        attr[k * 9 + 7] = item.alpha == null ? 1 : item.alpha;
        const c = item.color || WHITE;
        rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
        ids.push(k);
    });
    return {
        jobId: 1, frameSeq: 1, postedAt: 0, q: 0, Zq, plateW: PLATE_PX,
        plates: Int32Array.from(plate), epochs: Int32Array.from([0]),
        paper: Uint8Array.from(paper), nItems: n,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom), ids: Int32Array.from(ids),
    };
}

function render(items) {
    const out = new Uint8ClampedArray(TW * TH * 4);
    core.fillPaper(out, 0, 0, 0);
    core.renderPlate(makeJob(items), 0, out, new Uint32Array(8));
    return out;
}

/** Bytes that differ between two plates, and the largest difference. */
function diff(a, b) {
    let n = 0, worst = 0;
    const first = [];
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d) { n++; if (d > worst) worst = d; if (first.length < 6) first.push([(i >> 2) % TW, Math.floor((i >> 2) / TW), a[i], b[i]]); }
    }
    return { n, worst, first };
}
const NONE = { n: 0, worst: 0, first: [] };

const at = (out, x, y) => out[(y * TW + x) * 4];
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** The smallest step that changes `x`: one unit in the last place. */
const ulp = (x) => { let u = 1; while (x + u / 2 !== x) u /= 2; return u; };

beforeEach(() => { core.useAccumPrecision("f32"); core.setOcclusion(true); });

describe("PLAN §3 row 4 — a family's union does not see a one-ulp disagreement at a shared edge", () => {
    const cases = [
        {
            name: "an axis-aligned edge at a whole pixel",
            exact: () => [rect(100, 100, 300, 300), rect(300, 100, 500, 300)],
            move: (r, d) => [r[0], [[300 + d, 100], [500, 100], [500, 300], [300 + d, 300]]],
            inside: [[200, 200], [299, 200], [300, 200], [400, 200]],
        },
        {
            name: "an axis-aligned edge at a half pixel",
            exact: () => [rect(100, 100, 300.5, 300), rect(300.5, 100, 500, 300)],
            move: (r, d) => [r[0], [[300.5 + d, 100], [500, 100], [500, 300], [300.5 + d, 300]]],
            inside: [[200, 200], [300, 200], [301, 200], [400, 200]],
        },
        {
            name: "a diagonal edge through pixel interiors",
            exact: () => [[[100, 100], [400, 100], [100, 400]], [[400, 100], [400, 400], [100, 400]]],
            move: (r, d) => [r[0], [[400 + d, 100 - d], [400, 400], [100 - d, 400 + d]]],
            inside: [[250, 249], [250, 250], [250, 251], [150, 150], [350, 350]],
        },
        {
            name: "three pieces meeting at one vertex",
            exact: () => [[[100, 100], [300, 100], [300, 300]], [[100, 100], [300, 300], [100, 300]], rect(300, 100, 500, 300)],
            move: (r, d) => [r[0], [[100, 100], [300 + d, 300 + d], [100, 300]], [[300 - d, 100], [500, 100], [500, 300], [300 - d, 300]]],
            inside: [[299, 299], [300, 299], [200, 200], [400, 200]],
        },
    ];

    for (const c of cases) {
        test(c.name, () => {
            const exact = render(c.exact().map((rings) => ({ rings: [rings], fam: 0 })));
            for (const [x, y] of c.inside) expect(at(exact, x, y)).toBe(255);
            const u = ulp(300);
            for (const d of [u, -u, 2 * u, -2 * u]) {
                const moved = render(c.move(c.exact(), d).map((rings) => ({ rings: [rings], fam: 0 })));
                expect(diff(exact, moved)).toEqual(NONE);
            }
        });
    }

    test("a translucent family gets its alpha once across the shared edge; a one-ulp gap moves the tie pixels by one step at most", () => {
        const items = (d) => [
            { rings: [rect(100, 100, 300.5, 300)], fam: 0, alpha: 0.5 },
            { rings: [[[300.5 + d, 100], [500, 100], [500, 300], [300.5 + d, 300]]], fam: 0, alpha: 0.5 },
        ];
        const exact = render(items(0));
        expect(at(exact, 200, 200)).toBe(128);
        expect(at(exact, 300, 200)).toBe(128);   // the shared edge's pixel: 0.5 + 0.5 covered, alpha once
        expect(at(exact, 400, 200)).toBe(128);
        const u = ulp(300.5);
        // An overlap clamps to 1 and is byte-identical; a gap leaves −ulp in the accumulator and
        // 127.5 − ε rounds down: one step, only along the shared column x = 300.
        expect(diff(exact, render(items(-u)))).toEqual(NONE);
        const gap = diff(exact, render(items(u)));
        expect(gap.worst).toBeLessThanOrEqual(1);
        for (const [x] of gap.first) expect(x).toBe(300);
        expect(at(render(items(u)), 300, 200)).toBe(127);
    });

    test("negative control: two FAMILIES at a half-pixel edge leave the hairline the family removes", () => {
        const two = render([{ rings: [rect(100, 100, 300.5, 300)], fam: 0 }, { rings: [rect(300.5, 100, 500, 300)], fam: 1 }]);
        // Source-over of two half-covered pixels: 0.5 + 0.5 × 0.5 = 0.75, a pale line down the join
        // (192, not 191: the first family's 127.5 is stored as the byte 128 before the second composites).
        expect(at(two, 300, 200)).toBe(192);
        expect(at(two, 299, 200)).toBe(255);
        expect(at(two, 301, 200)).toBe(255);
        const one = render([{ rings: [rect(100, 100, 300.5, 300)], fam: 0 }, { rings: [rect(300.5, 100, 500, 300)], fam: 0 }]);
        expect(at(one, 300, 200)).toBe(255);
    });

    test("the union clamps an overlap to 1 and a gap loses only its width", () => {
        const overlap = render([{ rings: [rect(100, 100, 300, 300)], fam: 0 }, { rings: [rect(250, 100, 500, 300)], fam: 0 }]);
        for (const x of [260, 280, 299, 300]) expect(at(overlap, x, 200)).toBe(255);
        const gap = render([{ rings: [rect(100, 100, 300, 300)], fam: 0 }, { rings: [rect(300.25, 100, 500, 300)], fam: 0 }]);
        expect(at(gap, 300, 200)).toBe(191);   // a quarter-pixel gap: the pixel loses a quarter of its ink
        expect(at(gap, 299, 200)).toBe(255);
        expect(at(gap, 301, 200)).toBe(255);
    });
});
