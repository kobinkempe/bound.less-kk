/**
 * rasterCore.test.js — R1–R17 of RASTERISER-PLAN §9.2: the accumulation loop, the bounded
 * clear, the tail, the x-clamp and the union pass — including its three overflow paths, the
 * row-band split, the crossing buffer's growth and the row that cannot be banded any further
 * (F75) — plus the plate grid of §3.2.
 *
 * Every test paints WHITE ink on BLACK paper, so a stored byte IS the coverage times 255 and
 * an expected number can be written down rather than derived: 255 is fully covered, 128 is
 * half a pixel (127.5, rounded to even by Uint8ClampedArray), 42 is a sixth.
 */

import { PLATE_PX, plateRange } from "./plate";
import { levelKey, restKey } from "./level";
import * as core from "./rasterCore";
import { ringsArea, coverRings } from "../__oracles__/coverageOracle";

const TW = core.TW, TH = core.TH;
const WHITE = [255, 255, 255];

/** One job in §3.3's layout. An item is { rings } or { loops }, plus fam, union, color, alpha, res, box. */
function makeJob(items, opts = {}) {
    const { Zq = 1, paper = [0, 0, 0], plate = [0, 0] } = opts;
    const n = items.length;
    const meta = new Uint32Array(8 * n), attr = new Float64Array(9 * n), rgb = new Uint8Array(3 * n);
    const geom = [], subs = [], ids = [];
    items.forEach((item, k) => {
        const kind = item.loops ? 0 : 1;
        const gs = geom.length, ss = subs.length;
        let sc = 0;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const see = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
        if (kind === 0) {
            for (const loop of item.loops) {
                subs.push(geom.length - gs);
                for (let i = 0; i < loop.length; i++) geom.push(loop[i]);
                sc++;
                if (loop.length >= 2) see(loop[0], loop[1]);
                for (let o = 2; o < loop.length; o += ({ 0: 3, 1: 8, 2: 9, 3: 16 })[loop[o]] || 8) {
                    if (loop[o] === 0) see(loop[o + 1], loop[o + 2]);
                    else if (loop[o] === 2) see(loop[o + 7], loop[o + 8]);
                }
            }
        } else {
            for (const ring of item.rings) {
                subs.push((geom.length - gs) / 2);
                for (const p of ring) { geom.push(p[0], p[1]); see(p[0], p[1]); }
                sc++;
            }
        }
        const res = item.res || [0, 0];
        meta[k * 8] = kind;
        meta[k * 8 + 1] = item.fam == null ? k : item.fam;
        meta[k * 8 + 2] = gs;
        meta[k * 8 + 3] = geom.length - gs;
        meta[k * 8 + 4] = ss;
        meta[k * 8 + 5] = sc;
        meta[k * 8 + 6] = (item.covers ? 1 : 0) | (item.erase ? 2 : 0) | (item.union ? 4 : 0);
        const box = item.box || [x0 + res[0], y0 + res[1], x1 + res[0], y1 + res[1]];
        attr[k * 9] = box[0]; attr[k * 9 + 1] = box[1]; attr[k * 9 + 2] = box[2]; attr[k * 9 + 3] = box[3];
        attr[k * 9 + 4] = res[0]; attr[k * 9 + 5] = res[1];
        attr[k * 9 + 6] = item.lwFrame || 0;
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

/** A plate of black paper, which is what an empty render leaves: opaque, so alpha is 255. */
const blank = () => {
    const out = new Uint8ClampedArray(TW * TH * 4);
    core.fillPaper(out, 0, 0, 0);
    return out;
};

/** Two plates byte for byte. `expect(buf).toEqual(buf)` on a megabyte takes minutes; this is instant. */
const samePlate = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length));

function render(items, opts = {}) {
    const out = blank();
    const counts = new Uint32Array(8);
    core.renderPlate(makeJob(items, opts), 0, out, counts);
    return { out, counts };
}

/** The ink byte at (x, y): white on black, so this is 255 × coverage. */
const at = (out, x, y) => out[(y * TW + x) * 4];

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const poly = (cx, cy, r, n) => {
    const ring = [];
    for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / n; ring.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
    return ring;
};

/** The same numbers on every run: the two overflow fixtures need a stated ring count, not chance. */
let seed = 20260915;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/** The worst difference between the painted bytes and the oracle's coverage, over rows [y0, y1). */
function worstAgainstOracle(out, cov, y0, y1) {
    let worst = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = 0; x < TW; x++) {
            const d = Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]);
            if (d > worst) worst = d;
        }
    }
    return worst;
}

/** The coverage the accumulation holds, summed over a box, with the tail — R4's and R5's reading. */
function sumCoverage(y0, y1) {
    let total = 0;
    for (let y = y0; y < y1; y++) {
        const r = core.rowRange(y);
        if (r[0] > TW - 1) continue;
        const xb = Math.min(r[1] + 1, TW);
        let acc = 0;
        for (let x = r[0]; x < xb; x++) { acc += core.readAcc(x, y); total += Math.min(Math.abs(acc), 1); }
        if (Math.abs(acc) > core.TAIL_EPS) total += Math.min(Math.abs(acc), 1) * (TW - xb);
    }
    return total;
}

/** Emit one ring through the low-level path, with no cull and no resolve. */
function emitRing(ring) {
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        core.addEdge(a[0], a[1], b[0], b[1]);
    }
}

beforeEach(() => {
    core.useAccumPrecision("f32");
    core.setDebugChecks(true);
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});
afterEach(() => core.setDebugChecks(false));

describe("rasterCore — the core loop", () => {
    test("R1 a pixel-aligned rectangle is 255 inside, 0 outside, and nothing between", () => {
        const { out } = render([{ rings: [rect(4, 4, 12, 12)] }]);
        let between = 0;
        for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
            const v = at(out, x, y);
            const inside = x >= 4 && x < 12 && y >= 4 && y < 12;
            if (v !== 0 && v !== 255) between++;
            else expect(v).toBe(inside ? 255 : 0);
        }
        expect(between).toBe(0);
    });

    test("R2 a rectangle offset half a pixel leaves its boundary column at exactly 128", () => {
        const { out } = render([{ rings: [rect(4.5, 4, 12.5, 12)] }]);
        expect(at(out, 4, 6)).toBe(128);
        expect(at(out, 12, 6)).toBe(128);
        for (let x = 5; x <= 11; x++) expect(at(out, x, 6)).toBe(255);
        expect(at(out, 3, 6)).toBe(0);
        expect(at(out, 13, 6)).toBe(0);
    });

    test("R3 a sliver a sixth of a pixel wide paints 42, not nothing", () => {
        const { out } = render([{ rings: [rect(4, 0, 4 + 1 / 6, TH)] }]);
        expect(at(out, 4, 100)).toBeGreaterThanOrEqual(42);
        expect(at(out, 4, 100)).toBeLessThanOrEqual(43);
        expect(at(out, 5, 100)).toBe(0);
    });

    test("R4 total coverage equals the shoelace area of a simple loop", () => {
        const ring = [[10.25, 12.5], [300.75, 40.125], [420.5, 380.25], [120.125, 460.75], [30.5, 200.25]];
        const area = Math.abs(ringsArea([ring]));
        for (const kind of ["f32", "f64"]) {
            core.useAccumPrecision(kind);
            core.beginFamily(0, TH);
            emitRing(ring);
            const total = sumCoverage(0, TH);
            core.clearFamily(0, TH);
            expect(Math.abs(total - area) / area).toBeLessThan(kind === "f32" ? 1e-5 : 1e-12);
        }
    });

    test("R5 coverage equals ink width from 1e-4 to 2 px, and rises with it", () => {
        let prev = 0;
        for (const w of [1e-4, 1e-3, 0.02, 0.15, 0.3, 0.55, 1, 1.5, 2]) {
            core.beginFamily(0, 100);
            emitRing(rect(10.5, 0, 10.5 + w, 100));
            const total = sumCoverage(0, 100);
            core.clearFamily(0, 100);
            expect(Math.abs(total - w * 100)).toBeLessThan(1e-2 * w * 100 + 1e-5);   // P3's bar is 10 %
            expect(total).toBeGreaterThan(prev);
            prev = total;
        }
    });

    test("R6 eight degenerate loops are byte-identical to an empty plate", () => {
        const degenerate = [
            { rings: [[[10, 10]]] },                                    // one point
            { rings: [[[20, 20], [20, 20]]] },                          // two coincident points
            { rings: [[[30, 30], [40, 30], [50, 30]]] },                // collinear: zero area
            { rings: [[]] },                                            // an empty ring
            { loops: [[60, 60]] },                                      // a loop with no piece
            { loops: [[70, 70, 0, 70, 70]] },                           // a zero-length line piece
            { loops: [[80, 80, 0, 90, 80, 0, 80, 80]] },                // out and back: a sealed chord
            { rings: [[[100, 100], [100, 100], [100, 100], [100, 100]]] },
        ].map((d, i) => Object.assign(d, { fam: i }));
        const { out } = render(degenerate);
        expect(samePlate(out, blank())).toBe(0);
    });

    test("R7 a non-finite coordinate is dropped, forces one full clear, and poisons nothing", () => {
        const items = [
            { fam: 0, rings: [[[10, 10], [NaN, 10], [40, 40], [10, 40]]], box: [10, 10, 40, 40] },
            { fam: 1, rings: [rect(100, 100, 120, 120)] },
        ];
        const { out } = render(items);
        expect(core.coreStats.nonFinite).toBeGreaterThan(0);
        expect(core.coreStats.fullClears).toBeGreaterThan(0);
        const clean = render([{ fam: 0, rings: [rect(100, 100, 120, 120)] }]).out;
        for (let y = 95; y < 125; y++) for (let x = 95; x < 125; x++) expect(at(out, x, y)).toBe(at(clean, x, y));
        for (let y = 0; y < TH; y += 7) for (let x = 0; x < TW; x += 7) {
            if (x >= 95 && x < 125 && y >= 95 && y < 125) continue;
            expect(Number.isFinite(at(out, x, y))).toBe(true);
        }
    });

    test("R8 coincident edges: same-wound is exactly 1, opposite-wound exactly 0", () => {
        const same = render([
            { fam: 0, rings: [rect(10, 10, 30, 30)] },
            { fam: 0, rings: [rect(10, 10, 30, 30)] },
        ]).out;
        expect(at(same, 20, 20)).toBe(255);
        expect(at(same, 5, 20)).toBe(0);
        const opposite = render([
            { fam: 0, rings: [rect(10, 10, 30, 30)] },
            { fam: 0, rings: [rect(10, 10, 30, 30).slice().reverse()] },
        ]).out;
        for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) expect(at(opposite, x, y)).toBe(0);
    });

    test("R9 a plate-covering shape paints every pixel — the tail rule", () => {
        const { out } = render([{ rings: [rect(-10, -10, TW + 10, TH + 10)] }]);
        for (let y = 0; y < TH; y += 17) for (let x = 0; x < TW; x += 13) expect(at(out, x, y)).toBe(255);
        expect(at(out, TW - 1, TH - 1)).toBe(255);
        expect(at(out, 0, 0)).toBe(255);
    });

    test("R10 a shape wholly left of the plate leaves it empty, culled or not", () => {
        const culled = render([{ rings: [rect(-100, -100, -50, TH + 100)] }]);
        expect(samePlate(culled.out, blank())).toBe(0);
        expect(culled.counts[1]).toBe(0);
        const out = blank();
        core.beginFamily(0, TH);
        emitRing(rect(-100, -100, -50, TH + 100));
        core.resolveFamily(out, 255, 255, 255, 1, 0, TH);
        core.clearFamily(0, TH);
        expect(samePlate(out, blank())).toBe(0);
    });

    test("R11 the x-clamp is a clamp of x(y): 0.964 of pixel 0, not 0.750", () => {
        core.beginFamily(0, 1);
        core.addEdge(-3, 0, 0.5, 1);
        expect(core.readAcc(0, 0)).toBeCloseTo(0.9642857142857143, 6);
        expect(core.readAcc(1, 0)).toBeCloseTo(0.03571428571428571, 6);
        core.clearFamily(0, 1);
    });

    test("R12 float32 and float64 accumulation agree to one alpha step", () => {
        const items = [{ rings: [[[10.3, 10.7], [300.25, 30.5], [420.5, 380.125], [120.75, 460.5], [30.5, 200.25]]] }];
        core.useAccumPrecision("f32");
        const a = render(items).out;
        core.useAccumPrecision("f64");
        const b = render(items).out;
        let worst = 0;
        for (let i = 0; i < a.length; i += 4) worst = Math.max(worst, Math.abs(a[i] - b[i]));
        expect(worst).toBeLessThanOrEqual(1);
    });

    test("R13 the union pass: overlapping rings paint their true coverage, not twice it", () => {
        // (a) two coincident rings, each half a pixel wide
        const half = [
            { fam: 0, union: true, rings: [rect(10, 0, 10.5, TH)] },
            { fam: 0, union: true, rings: [rect(10, 0, 10.5, TH)] },
        ];
        expect(at(render(half).out, 10, 100)).toBe(128);
        expect(at(render(half.map((i) => ({ ...i, union: false }))).out, 10, 100)).toBe(255);

        // (b) a 0.55 px band, doubled: 140, not solid
        const band = [
            { fam: 0, union: true, rings: [rect(20.2, 0, 20.75, TH)] },
            { fam: 0, union: true, rings: [rect(20.2, 0, 20.75, TH)] },
        ];
        expect(at(render(band).out, 20, 100)).toBe(140);
        expect(at(render(band.map((i) => ({ ...i, union: false }))).out, 20, 100)).toBe(255);

        // (c) three overlapping rings of a join: the union is 0.40 of the pixel
        const join = [
            { fam: 0, union: true, rings: [rect(30.0, 0, 30.2, TH)] },
            { fam: 0, union: true, rings: [rect(30.1, 0, 30.3, TH)] },
            { fam: 0, union: true, rings: [rect(30.2, 0, 30.4, TH)] },
        ];
        expect(at(render(join).out, 30, 100)).toBe(102);          // 255 × 0.40
        expect(at(render(join.map((i) => ({ ...i, union: false }))).out, 30, 100)).toBe(153);  // 255 × 0.60

        // (d) a union item abuts a fast-path sibling of its own family and the two sum to solid
        const cut = render([
            { fam: 0, rings: [rect(4, 0, 10.3, TH)] },
            { fam: 0, union: true, rings: [rect(10.3, 0, 16, TH)] },
        ]).out;
        for (let x = 4; x < 16; x++) expect(at(cut, x, 100)).toBe(255);
        expect(at(cut, 3, 100)).toBe(0);
        expect(at(cut, 16, 100)).toBe(0);

        // (e) and at the opposite winding it CUTS a hole in that sibling: the union deposit
        // carries the rings' own orientation (D34), so a reversed ring cancels the parent's.
        const hole = render([
            { fam: 0, rings: [rect(4, 0, 20, TH)] },
            { fam: 0, union: true, rings: [rect(8, 0, 12, TH).slice().reverse()] },
        ]).out;
        for (let x = 8; x < 12; x++) expect(at(hole, x, 100)).toBe(0);
        for (let x = 4; x < 8; x++) expect(at(hole, x, 100)).toBe(255);
        for (let x = 12; x < 20; x++) expect(at(hole, x, 100)).toBe(255);
    });

    test("R14 a deposit at column TW leaves ROWMAX at TW − 1, and the clear still reaches the spill", () => {
        core.beginFamily(0, 1);
        core.addEdge(TW + 5, 0, TW + 5, 1);
        expect(core.rowRange(0)[1]).toBe(TW - 1);
        expect(core.readAcc(TW, 0)).not.toBe(0);
        core.clearFamily(0, 1);
        expect(core.readAcc(TW, 0)).toBe(0);
        expect(core.readAcc(TW + 1, 0)).toBe(0);

        core.beginFamily(0, 2);                              // the same rule on a plate-covering shape
        emitRing(rect(-10, -10, TW + 10, 2));
        expect(core.rowRange(0)).toEqual([0, TW - 1]);
        core.clearFamily(0, 2);
        for (let x = 0; x < TW + 2; x++) expect(core.readAcc(x, 0)).toBe(0);
    });

    test("R15 the union pass walks a family in row bands when its edges overflow, and paints the same rows", () => {
        // 430 rings of 40 edges = 17,200 union edges over rows 99–204, past the 16,384 the edge
        // buffer holds, so the family is split at row 152 and walked in two bands. The control is
        // THE SAME RINGS with the family box stopping at that split: its single band is the first
        // band of the banded render edge for edge, so rows 99–151 must come out byte-identical.
        seed = 20260915;
        const rings = [];
        for (let i = 0; i < 430; i++) rings.push(poly(12 + rnd() * 488, 105 + rnd() * 94, 4.5, 40));
        const banded = render([{ fam: 0, union: true, rings, box: [0, 100, TW, 204] }]);
        expect(core.coreStats.unionSplits).toBeGreaterThan(0);
        expect(core.coreStats.unionRefills).toBe(0);

        for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
        const oneBand = render([{ fam: 0, union: true, rings, box: [0, 100, TW, 151] }]);
        expect(core.coreStats.unionSplits).toBe(0);
        const row = TW * 4;
        expect(Buffer.compare(
            Buffer.from(banded.out.buffer, 99 * row, 53 * row),
            Buffer.from(oneBand.out.buffer, 99 * row, 53 * row),
        )).toBe(0);

        // and the whole banded picture against the oracle, which has no bands at all
        expect(worstAgainstOracle(banded.out, coverRings(rings, TW, TH, 16), 95, 210)).toBeLessThan(2 / 255);
    });

    test("R16 a sub-scanline with more crossings than the buffer holds grows it, and the coverage is unchanged", () => {
        // 1,025 ribbons two rows tall: 2,050 crossings on every sub-scanline, past the 2,048 XS
        // holds. Built from the right, so the crossings reach the insertion sort already in order.
        const rings = [];
        for (let i = 1024; i >= 0; i--) { const x = 10 + i * 0.478; rings.push(rect(x, 100, x + 0.3, 102)); }
        const { out } = render([{ fam: 0, union: true, rings }]);
        expect(core.coreStats.xsGrown).toBeGreaterThan(0);
        expect(core.coreStats.unionSplits).toBe(0);
        expect(core.coreStats.unionRefills).toBe(0);
        expect(worstAgainstOracle(out, coverRings(rings, TW, TH, 16), 99, 103)).toBeLessThan(2 / 255);
        expect(at(out, 100, 100)).toBeGreaterThan(0);
    });

    test("R17 a row whose union edges do not fit is walked over two buffer-fulls and keeps its ink", () => {
        // F75's own fixture: 8,500 ribbons 0.2 px wide and one 40 px block at x 460–500, all
        // inside pixel row 200 — 17,002 union edges. The item's box is rows 199–201, so the band
        // splits once and row 200 then holds more edges than the 16,384 the buffer takes: its
        // crossings are gathered over two buffer-fulls into one winding walk. Walked with the
        // first buffer-full alone the block read byte 0, and `counts[7]` — every pixel the
        // resolve blended inside the row's touched range, §8.3 — read 401 against 491 here; the
        // ink that came back is the block's own 40 pixels (440 inked pixels against 400).
        // It costs about two seconds, and that is the insertion sort over 17,002 crossings a
        // sub-scanline — the second walk itself is 41–43 ns an edge a pass (§8.6 measurement 15).
        const fixture = (n) => {
            const rings = [];
            for (let i = 0; i < n; i++) { const x = 10 + (i % 800) * 0.5; rings.push(rect(x, 200, x + 0.2, 200.75)); }
            rings.push(rect(460, 200, 500, 200.75));          // the block, loaded last
            return rings;
        };
        const control = render([{ fam: 0, union: true, rings: fixture(100) }]);
        expect(core.coreStats.unionRefills).toBe(0);
        expect(at(control.out, 470, 200)).toBe(191);          // 255 × 0.75 of the row's height
        expect(control.counts[7]).toBe(491);                  // the touched span x 10…500, not ink

        for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
        const over = render([{ fam: 0, union: true, rings: fixture(8500) }]);
        expect(core.coreStats.unionSplits).toBe(1);
        expect(core.coreStats.unionRefills).toBe(1);
        expect(at(over.out, 470, 200)).toBe(191);
        expect(at(over.out, 480, 200)).toBe(191);
        expect(over.counts[7]).toBe(491);                     // the same span, and 40 px of it now inked
        expect(at(over.out, 10, 200)).toBe(77);               // and the ribbons: two of 0.15 px
        // three sampled bytes are not the picture: the whole row against the oracle, which
        // walks integer windings and has no buffer at all — measured 0.00196, half a byte step
        expect(worstAgainstOracle(over.out, coverRings(fixture(8500), TW, TH, 16), 199, 202)).toBeLessThan(2 / 255);
    });

    test("families in one plate: each resolves at its own colour and alpha, in paint order", () => {
        const { out, counts } = render([
            { fam: 0, rings: [rect(0, 0, 20, 20)], color: [255, 255, 255] },
            { fam: 1, rings: [rect(10, 0, 30, 20)], color: [255, 255, 255], alpha: 0.5 },
        ]);
        expect(at(out, 5, 5)).toBe(255);
        expect(at(out, 15, 5)).toBe(255);                    // 0.5 white over white stays white
        expect(at(out, 25, 5)).toBe(128);                    // 0.5 white over black
        expect(counts[2]).toBe(2);
        expect(counts[0]).toBe(2);
        expect(counts[1]).toBe(2);
    });

    test("the residual moves an item at paint time and nothing else does", () => {
        const a = render([{ rings: [rect(4, 4, 12, 12)] }]).out;
        const b = render([{ rings: [rect(0, 0, 8, 8)], res: [4, 4] }]).out;
        expect(samePlate(a, b)).toBe(0);
    });

    test("the plate index and Zq place the ink: x·Zq − i·512 (§4.6)", () => {
        const items = [{ rings: [rect(510, 2, 514, 6)] }];
        const left = blank(), right = blank();
        core.renderPlate(makeJob(items, { plate: [0, 0] }), 0, left);
        core.renderPlate(makeJob(items, { plate: [1, 0] }), 0, right);
        expect(at(left, 510, 3)).toBe(255);
        expect(at(left, 511, 3)).toBe(255);
        expect(at(right, 0, 3)).toBe(255);
        expect(at(right, 1, 3)).toBe(255);
        expect(at(right, 2, 3)).toBe(0);
        // the residual is added BEFORE the scale, so two neighbouring plates round the product
        // once and their shared boundary column is the same coverage to the last bit
        const items2 = [{ rings: [rect(509.3, 2, 515.8, 6)], res: [0.37, 0.11] }];
        const l2 = blank(), r2 = blank();
        core.renderPlate(makeJob(items2, { plate: [0, 0] }), 0, l2);
        core.renderPlate(makeJob(items2, { plate: [1, 0] }), 0, r2);
        expect(at(l2, 511, 3)).toBe(255);                      // no hairline across the boundary
        expect(at(r2, 0, 3)).toBe(255);
        expect(Math.abs(at(l2, 509, 3) - 84)).toBeLessThanOrEqual(1);   // 255 × (510 − 509.67)
        expect(Math.abs(at(r2, 4, 3) - 43)).toBeLessThanOrEqual(1);     // 255 × (516.17 − 516)

        const scaled = blank();
        core.renderPlate(makeJob([{ rings: [rect(2, 2, 6, 6)] }], { Zq: 4 }), 0, scaled);
        expect(at(scaled, 12, 12)).toBe(255);
        expect(at(scaled, 23, 23)).toBe(255);
        expect(at(scaled, 24, 24)).toBe(0);
    });

    test("an arc piece paints its own area (the flattener of §4.4; raster.arcs.test.js is the suite)", () => {
        // A (110, 50) → B (10, 50), half a turn anticlockwise about (60, 50): the lower
        // half-disc of radius 50. Closed by the chord, so the shape IS the half-disc.
        const arc = [110, 50, 1, 60, 50, 50, 0, Math.PI, 10, 50];
        const { out, counts } = render([{ loops: [arc], box: [10, 50, 110, 100] }]);
        let ink = 0;
        for (let i = 0; i < out.length; i += 4) ink += out[i] / 255;
        // the chords are INSCRIBED, so the area is short of the half-disc by the segments
        // they cut off — at most (2/3)·arcLength·ARC_TOL = 6.54 px², and measured 6.3
        const exact = (Math.PI * 50 * 50) / 2;
        expect(ink).toBeLessThan(exact);
        expect(exact - ink).toBeLessThan((2 / 3) * (Math.PI * 50) * core.ARC_TOL);
        expect(at(out, 60, 70)).toBe(255);
        expect(at(out, 60, 30)).toBe(0);                      // the half above the chord is not filled
        expect(counts[5]).toBe(32);                           // 2^D chords, §4.4's estimate
    });

    /**
     * PAPER-PLAN §10 S4 (B §3.3): a TRANSPARENT plate — the drag plane's ink — is straight alpha, so
     * composited over any paper it must give what the same job rastered on that paper gives. Red
     * without the alpha write (every edge pixel keeps alpha 0) and without the un-premultiply (the
     * edges darken toward black).
     */
    test("resolveFamily over a transparent plate: the un-premultiplied edge equals the same ink composited over paper", () => {
        const tri = { rings: [[[10.3, 20.7], [300.6, 60.2], [80.1, 400.9]]], color: [200, 40, 30] };
        const half = { rings: [[[150.5, 150.25], [420.75, 150.25], [420.75, 330.5], [150.5, 330.5]]], color: [20, 120, 240], alpha: 0.5 };
        const job = (paper) => makeJob([tri, half], { paper });
        const draw = (j) => { const out = new Uint8ClampedArray(TW * TH * 4); core.renderPlate(j, 0, out, new Uint32Array(8)); return out; };
        const T = draw(job([0, 0, 0, 0]));
        let worst = 0, partial = 0, outsideAlpha = 0;
        for (const P of [[255, 255, 255], [30, 90, 200]]) {
            const ref = draw(job(P));
            for (let p = 0; p < T.length; p += 4) {
                const A = T[p + 3] / 255;
                if (A > 0 && A < 1) partial++;
                for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(T[p + c] * A + P[c] * (1 - A) - ref[p + c]));
            }
        }
        for (let p = (500 * TW + 500) * 4, k = 0; k < 10; k++, p += 4) outsideAlpha += T[p + 3];
        expect(partial).toBeGreaterThan(100);     // the fixture has antialiased edges to test
        expect(outsideAlpha).toBe(0);             // no ink is transparent, not paper-coloured
        expect(worst).toBeLessThanOrEqual(2);     // 8-bit rounding of the divide, and no more
    });

    test("the core imports two constant leaves and nothing else (§2.6)", () => {
        const fs = require("fs"), path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "rasterCore.js"), "utf8");
        const from = [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
        expect(from).toEqual(["./plate", "../geometry/chordMath"]);
        expect(src).not.toMatch(/require\(/);
    });
});

describe("plate.js — the grid", () => {
    test("a screen touches floor(W/512) + 1 or + 2 columns, at a random pan phase", () => {
        expect(PLATE_PX).toBe(512);
        const win = { left: 0, top: 0, right: 2256, bottom: 1302 };
        const r = plateRange(win, 1);
        expect(r.i1 - r.i0 + 1).toBe(5);
        const off = plateRange({ left: 500, top: 0, right: 2756, bottom: 1302 }, 1);
        expect(off.i1 - off.i0 + 1).toBe(6);                  // the same screen at a worse pan phase
        expect(plateRange({ left: 0, top: 0, right: 1024, bottom: 512 }, 1)).toEqual({ i0: 0, i1: 1, j0: 0, j1: 0 });
    });

    test("the pyramid's keys carry the frame, the level (or the exact zoom) and the indices, and not dpr (D27)", () => {
        expect(levelKey("f7", 3, 1, -2, 5)).toBe("f7|L3s1|-2,5");
        expect(levelKey("f7", 3, 2, -2, 5)).not.toBe(levelKey("f7", 3, 1, -2, 5));   // the step is part of a level's name
        expect(restKey("f7", 1.5, 0, 0)).toBe("f7|R1.5|0,0");
    });
});
