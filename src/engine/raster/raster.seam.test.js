/**
 * raster.seam.test.js — S1–S5 of RASTERISER-PLAN §9.2: what happens where two plates meet.
 * (S6, a stroke crossing a boundary, needs the band builder of §4.8 and is stage 2's.)
 *
 * The rule the suite exists for: THE BISECTION DEPTH IS A FUNCTION OF THE PIECE AND THE
 * TOLERANCE ONLY, never of the plate (§4.4) — and, in the implementation, the descent runs
 * on scale-only coordinates and subtracts the plate's origin at each chord it emits, so two
 * plates flatten one arc to bit-identical chords and differ only in which subtrees they
 * prune. That is the same trap DESIGN.md §5 solved for the freeze, and F44 for the chord
 * frame: one arc frozen to two different chords at two different times.
 *
 * White ink on black paper, so a stored byte is 255 × coverage.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { coverRings, ringsFromLoops, ringsArea } from "../__oracles__/coverageOracle";

const TW = core.TW, TH = core.TH;
const BAR = 1 / 16 + 0.5 / 255;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };

/** A job of a render list over a strip of plates, through the packer (S6 and D90). */
const packStrip = (list, plates) => pack.packJob(list, {
    plates: Int32Array.from(plates), q: 0, Zq: 1, dpr: 1, cfg: CFG, paper: [0, 0, 0],
});
/** One plate of a packed job, as RGBA. */
function renderOf(job, plateIndex) {
    const out = new Uint8ClampedArray(TW * TH * 4);
    core.renderPlate(job, plateIndex, out);
    return out;
}
/** The same job with the packer's declared union sign removed, so the core falls back (D90). */
function zeroSigns(job) {
    const attr = job.attr.slice();
    for (let k = 0; k < job.nItems; k++) attr[k * 9 + 8] = 0;
    return { ...job, attr };
}

/** One item of loops on plate (i, j), at Zq = 1. */
function plate(loops, i, j) {
    const geom = [], subs = [];
    for (const loop of loops) { subs.push(geom.length); for (const v of loop) geom.push(v); }
    const meta = new Uint32Array(8), attr = new Float64Array(9), rgb = Uint8Array.from([255, 255, 255]);
    meta[0] = 0; meta[3] = geom.length; meta[5] = subs.length;
    attr[0] = -1e12; attr[1] = -1e12; attr[2] = 1e12; attr[3] = 1e12; attr[7] = 1;
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8);
    core.renderPlate({
        Zq: 1, plates: Int32Array.from([i, j]), paper: Uint8Array.from([0, 0, 0]), nItems: 1,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    }, 0, out, counts);
    return { out, counts };
}

/** `n` plates side by side as one wide image of coverage, row-major. */
function strip(loops, n, j = 0) {
    const wide = new Float64Array(n * TW * TH);
    const counts = [];
    for (let i = 0; i < n; i++) {
        const p = plate(loops, i, j);
        counts.push(p.counts[5]);
        for (let y = 0; y < TH; y++) {
            for (let x = 0; x < TW; x++) wide[y * n * TW + i * TW + x] = p.out[(y * TW + x) * 4] / 255;
        }
    }
    return { wide, counts };
}

const same = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length));
const at = (out, x, y) => out[(y * TW + x) * 4];

/** The rings a flat `(geom, subs)` pair holds, as point arrays — `subs` is in POINTS (D36). */
function ringsFrom(geom, subs, at0, nPts, s, n) {
    const rings = [];
    for (let i = 0; i < n; i++) {
        const from = subs[s + i], to = i + 1 < n ? subs[s + i + 1] : nPts;
        const ring = [];
        for (let p = from; p < to; p++) ring.push([geom[at0 + p * 2], geom[at0 + p * 2 + 1]]);
        rings.push(ring);
    }
    return rings;
}
/** Every ring one PACKED item ships. */
const ringsOfItem = (job, k) => ringsFrom(job.geom, job.subs, job.meta[k * 8 + 2], job.meta[k * 8 + 3] / 2,
    job.meta[k * 8 + 4], job.meta[k * 8 + 5]);
/** The same ring wound POSITIVE, so the oracle over a set of them is their UNION (D105). */
const wound = (r) => (ringsArea([r]) < 0 ? r.slice().reverse() : r);

/**
 * The worst pixel between a two-plate strip and the coverage oracle over the rings the job ships,
 * each wound positive — the family's ink as one union, which is what a family with no hole in it
 * must paint (§4.5).
 */
function worstAgainstUnion(job, left, right) {
    let rings = [];
    for (let k = 0; k < job.nItems; k++) rings = rings.concat(ringsOfItem(job, k));
    const cov = coverRings(rings.map(wound), 2 * TW, TH, 16);
    let worst = 0;
    for (let y = 0; y < TH; y++) {
        for (let x = 0; x < 2 * TW; x++) {
            const got = (x < TW ? left[(y * TW + x) * 4] : right[(y * TW + (x - TW)) * 4]) / 255;
            worst = Math.max(worst, Math.abs(got - cov[y * 2 * TW + x]));
        }
    }
    return worst;
}

/**
 * An arc from A to B bulging by `sag` along the chord's normal (u_y, −u_x) — the side a
 * POSITIVE sweep bulges to — closed by two lines to `closeY`. The record carries a positive
 * radius and a signed sweep, which is what the grammar means by an arc.
 */
function arcBand(ax, ay, bx, by, sag, closeY) {
    const c = Math.hypot(bx - ax, by - ay), half = c / 2;
    const s = sag < 0 ? -1 : 1, mag = Math.abs(sag);
    const R = (half * half + mag * mag) / (2 * mag);
    const sweep = s * 2 * Math.asin(Math.min(1, half / R));
    const ux = (bx - ax) / c, uy = (by - ay) / c;
    const d = Math.sqrt((R - half) * (R + half));
    const cx = (ax + bx) / 2 - s * uy * d, cy = (ay + by) / 2 + s * ux * d;
    const a0 = Math.atan2(ay - cy, ax - cx);
    return [ax, ay, 1, cx, cy, R, a0, sweep, bx, by, 0, bx, closeY, 0, ax, closeY];
}
/** Every x of an `arcBand` loop, the record's own centre (index 3) included, for S5. */
const XS_OF_BAND = [0, 3, 8, 11, 14];

beforeEach(() => {
    core.useAccumPrecision("f32");
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("seams between plates", () => {
    test("S1 four plates assembled twice are byte-identical", () => {
        // The core is one size (§6.5), so a 1024² picture is four renders; rendering them
        // again must give the same bytes, or nothing downstream — cache, settle, compare —
        // means anything.
        const loops = [
            arcBand(60, 300, 960, 300, 180, 900),
            arcBand(100, 700, 1000, 640, -120, 1000),
            [200, 100, 0, 800, 120, 0, 820, 500, 0, 220, 480],
        ];
        for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const a = plate(loops, i, j), b = plate(loops, i, j);
            expect(same(a.out, b.out)).toBe(0);
            expect(a.counts[5]).toBe(b.counts[5]);
        }
    });

    test("S2 an arc crossing three plates has no seam in it", () => {
        const loops = [arcBand(50, 400, 1500, 400, -200, 500)];
        const { wide, counts } = strip(loops, 3);
        expect(counts[0]).toBe(counts[1]);                    // S5's statement, seen through the counter
        expect(counts[1]).toBe(counts[2]);
        expect(counts[0]).toBe(64);

        const cov = coverRings(ringsFromLoops(loops, 1 / 64), 3 * TW, TH, 16);
        let worst = 0, wx = -1, wy = -1;
        for (let y = 0; y < TH; y++) {
            for (let x = 0; x < 3 * TW; x++) {
                const d = Math.abs(wide[y * 3 * TW + x] - cov[y * 3 * TW + x]);
                if (d > worst) { worst = d; wx = x; wy = y; }
            }
        }
        if (!(worst < BAR)) throw new Error("S2: off by " + worst.toFixed(4) + " at " + wx + "," + wy);

        // and the seam itself: the two columns either side of each boundary differ by no more
        // than two neighbouring interior columns do, so there is no hairline and no doubling
        for (const b of [TW, 2 * TW]) {
            for (let y = 60; y < 460; y++) {
                const jump = Math.abs(wide[y * 3 * TW + b] - wide[y * 3 * TW + b - 1]);
                const inner = Math.abs(wide[y * 3 * TW + b + 4] - wide[y * 3 * TW + b + 3]);
                expect(jump).toBeLessThanOrEqual(Math.max(inner, 0.02) + 1e-12);
            }
        }
    });

    test("S3 a piece whose end lies exactly on a plate line (F44)", () => {
        // The case that broke the freeze: the cut lands ON the line, so one plate holds the
        // end and the next holds the start, and they must be the same point.
        const loops = [
            arcBand(200, 300, TW, 200, -90, 500),             // ends exactly at x = 512
            arcBand(TW, 200, 800, 320, -70, 500),             // and the next piece starts there
        ];
        const { wide } = strip(loops, 2);
        const cov = coverRings(ringsFromLoops(loops, 1 / 64), 2 * TW, TH, 16);
        let worst = 0;
        for (let y = 0; y < TH; y++) {
            for (let x = 0; x < 2 * TW; x++) worst = Math.max(worst, Math.abs(wide[y * 2 * TW + x] - cov[y * 2 * TW + x]));
        }
        expect(worst).toBeLessThan(BAR);
        // the join is ink on both sides of the line, at the height the two pieces share
        expect(wide[260 * 2 * TW + TW - 1]).toBeGreaterThan(0.99);
        expect(wide[260 * 2 * TW + TW]).toBeGreaterThan(0.99);
    });

    test("S4 a piece wholly outside the plate, in each of the four directions", () => {
        const blank = new Uint8ClampedArray(TW * TH * 4);
        core.fillPaper(blank, 0, 0, 0);
        for (const [dx, dy] of [[-2000, 0], [2000, 0], [0, -2000], [0, 2000]]) {
            const loops = [arcBand(100 + dx, 200 + dy, 400 + dx, 200 + dy, 60, 400 + dy)];
            expect(same(plate(loops, 0, 0).out, blank)).toBe(0);
        }
        // and the case the left substitution is for: a disc whose left half is 2e5 px away,
        // whose subtrees are dropped at column 0 with their own height. Without it the plate
        // would read blank where it should be solid.
        const R = 1e5, cx = 300 - R;
        const half = [cx + R, 256, 1, cx, 256, R, 0, Math.PI, cx - R, 256, 1, cx, 256, R, Math.PI, Math.PI, cx + R, 256];
        const out = plate([half], 0, 0).out;
        expect(at(out, 0, 256)).toBe(255);
        expect(at(out, 290, 256)).toBe(255);
        expect(at(out, 310, 256)).toBe(0);
        expect(at(out, 0, 0)).toBe(255);                      // the whole left of the plate, every row
        expect(core.coreStats.nonFinite).toBe(0);
    });

    test("S5 the bisection depth is the same for one piece at every plate", () => {
        const loops = [arcBand(-900, 300, 1900, 300, -260, 700)];
        const depths = new Set();
        for (let i = -2; i <= 3; i++) depths.add(plate(loops, i, 0).counts[5]);
        expect(depths.size).toBe(1);
        expect([...depths][0]).toBe(128);
        // the function itself takes no plate and no origin: that is what makes it true
        expect(core.arcDepth.length).toBe(5);                 // (ax, ay, bx, by, sweep)

        // MEASURED, and it is the seam's real question: plate 1 of one arc against plate 0 of
        // the same arc moved exactly one plate width. What the design guarantees is the first
        // half — both plates flatten the SAME arc to the same chords, and subtract an exact
        // integer (§4.6) — and moving the geometry is a second rounding of the midpoints,
        // ~5e-14 px, which measured zero difference in the bytes here.
        const moved = loops[0].slice();
        for (const o of XS_OF_BAND) moved[o] -= TW;           // the centre is one of them
        expect(moved[3]).toBe(loops[0][3] - TW);
        expect(same(plate(loops, 1, 0).out, plate([moved], 0, 0).out)).toBe(0);
    });

    test("S6 a stroke crossing a plate boundary: one band per item, and the two plates agree", () => {
        // The stroke ENDS on the boundary, so its round cap straddles the seam — the one part of
        // `strokeStripNear`'s default output that is clipped to the rectangle it was handed
        // (`capPiece`, `polyline.js:323-336`), and the hairline §9.4 item 2 looks for.
        const stroke = {
            type: "stroke", id: 1, color: "#ffffff", opacity: 1,
            pts: [[300, 200], [512, 200], [512, 380]], lwFrame: 60,
        };
        pack.clearPackCaches();
        pack.resetPackStats();

        const both = packStrip([stroke], [0, 0, 1, 0]);
        expect(pack.packStats.bandsBuilt).toBe(1);             // built once per item per quantum (§4.8)
        const left = renderOf(both, 0), right = renderOf(both, 1);

        // the band the two plates read is the same geometry, and it does not depend on the plate:
        // packing plate 1 on its own gives byte-identical pixels
        const alone = packStrip([stroke], [1, 0]);
        expect(same(renderOf(alone, 0), right)).toBe(0);
        expect(pack.packStats.bandsBuilt).toBe(1);             // and it was not rebuilt for it

        // and the assembled strip is the band the oracle draws, across the seam included
        const band = pack.bandFor(stroke, 0, 1, CFG);
        const rings = ringsFrom(band.geom, band.subs, 0, band.geom.length / 2, 0, band.subs.length);
        const cov = coverRings(rings, 2 * TW, TH, 16);
        let worst = 0, wx = -1;
        for (let y = 0; y < TH; y++) {
            for (let x = 0; x < 2 * TW; x++) {
                const got = (x < TW ? left[(y * TW + x) * 4] : right[(y * TW + (x - TW)) * 4]) / 255;
                const d = Math.abs(got - cov[y * 2 * TW + x]);
                if (d > worst) { worst = d; wx = x; }
            }
        }
        expect(worst).toBeLessThan(BAR);
        // the seam columns step no more than an interior pair does
        const colInk = (x) => {
            let s = 0;
            for (let y = 0; y < TH; y++) s += (x < TW ? left[(y * TW + x) * 4] : right[(y * TW + (x - TW)) * 4]) / 255;
            return s;
        };
        expect(Math.abs(colInk(TW) - colInk(TW - 1))).toBeLessThan(1 + Math.abs(colInk(TW - 8) - colInk(TW - 9)));
        expect(wx).toBeGreaterThan(-1);
    });

    test("the union sign is the family's, not the plate's (D64, D90)", () => {
        // One family, three items: a fast-path sibling that crosses the seam, a NEGATIVE union
        // item nested inside it that crosses it too, and a bigger POSITIVE union item wholly on
        // plate 1. Summed over the items a plate SEES the sign flips (−31,200 on plate 0 alone
        // against +40,800 for the family), and the same ink would be white on one plate and a
        // hole on the other.
        // The family is wound against itself ON PURPOSE — that is the only arrangement in which
        // the declared sign is visible in the bytes at all, since a union deposit that overlaps
        // nothing paints |A| = 1 whichever way it is signed. The picture is still the family's
        // whole ink, because the declared sign is the POSITIVE one the fast-path sibling carries,
        // so the deposit adds to it; `packStats.mixedWinding` counts the item that disagrees, and
        // §4.2 records what such a family paints (D106; the bake builds one, OPEN-FLAGS F76).
        const ringPair = (x0, y0, x1, y1, neg) => {
            const a = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
            const b = [[x0 + 10, y0 + 10], [x1 + 10, y0 + 10], [x1 + 10, y1 + 10], [x0 + 10, y1 + 10]];
            return neg ? [a.reverse(), b.reverse()] : [a, b];   // overlapping rings → a union item
        };
        const sibling = { type: "fill", id: 1, editId: 9, color: "#ffffff", opacity: 1, polys: [[[330, 150], [700, 150], [700, 350], [330, 350]]] };
        const small = { type: "fill", id: 2, editId: 9, color: "#ffffff", opacity: 1, polys: ringPair(430, 180, 560, 300, true) };
        const big = { type: "fill", id: 3, editId: 9, color: "#ffffff", opacity: 1, polys: ringPair(600, 380, 1000, 470, false) };
        const list = [sibling, small, big];
        pack.clearPackCaches();
        pack.resetPackStats();

        const both = packStrip(list, [0, 0, 1, 0]);
        const onlyLeft = packStrip(list, [0, 0]);
        expect(both.nItems).toBe(3);
        expect(onlyLeft.nItems).toBe(2);                       // the big one is culled off plate 0
        expect(both.meta[6] & 4).toBe(0);                      // the sibling is fast path: the nested
        //                                                        cross-wound pair is D91's exemption
        for (const job of [both, onlyLeft]) {
            for (let k = 0; k < job.nItems; k++) {
                if (job.meta[k * 8 + 6] & 4) expect(job.attr[k * 9 + 8]).toBe(1);
            }
        }
        expect(same(renderOf(both, 0), renderOf(onlyLeft, 0))).toBe(0);

        // and the picture is the family's whole ink across the seam, not a plate-to-plate
        // agreement about the wrong bytes: measured, worst 0.000 and 114,800 units of ink against
        // the oracle's 114,800 over the same rings — and with `attr[8]` negated, worst 1.000 and
        // 96,800, the nested item's whole 18,000 gone
        expect(pack.packStats.mixedWinding).toBe(2);           // the one item, counted once a pack,
        //                                                        and this test packs the family twice
        expect(worstAgainstUnion(both, renderOf(both, 0), renderOf(both, 1))).toBeLessThan(BAR);

        // and what the plate-dependent rule gives, recorded: with the declared sign taken out,
        // the two jobs disagree, because one of them sums a union item the other never carried
        const strip0 = zeroSigns(both), strip1 = zeroSigns(onlyLeft);
        expect(same(renderOf(strip0, 0), renderOf(strip1, 0))).not.toBe(0);
    });

    test("a CULLED stroke in a drawn family is banded for its sign (D102)", () => {
        // The same rule as the test above, on the path that costs something: a stroke's sign is
        // its band's, so a strip that culls the stroke still has to build the band — 7.8–14.0 ms
        // for four 4,962-point strokes (D102) — or the two strips declare different signs and
        // one of them paints a hole where its neighbour paints ink.
        const ringPair = (x0, y0, x1, y1) => {
            const a = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].reverse();
            const b = [[x0 + 10, y0 + 10], [x1 + 10, y0 + 10], [x1 + 10, y1 + 10], [x0 + 10, y1 + 10]].reverse();
            return [a, b];                                      // overlapping, both NEGATIVE
        };
        const sibling = { type: "fill", id: 1, editId: 9, color: "#ffffff", opacity: 1, polys: [[[60, 120], [300, 120], [300, 360], [60, 360]]] };
        const small = { type: "fill", id: 2, editId: 9, color: "#ffffff", opacity: 1, polys: ringPair(150, 150, 210, 210) };
        const far = { type: "stroke", id: 3, editId: 9, color: "#ffffff", opacity: 1, pts: [[600, 200], [1000, 200]], lwFrame: 40 };
        const list = [sibling, small, far];

        pack.clearPackCaches();
        pack.resetPackStats();
        const onlyLeft = packStrip(list, [0, 0]);
        expect(onlyLeft.nItems).toBe(2);                        // the stroke is wholly on plate 1
        expect(pack.packStats.culled).toBe(1);
        expect(pack.packStats.bandsBuilt).toBe(1);              // and it was banded anyway, for the sign

        pack.clearPackCaches();
        pack.resetPackStats();
        const both = packStrip(list, [0, 0, 1, 0]);
        expect(both.nItems).toBe(3);

        // the small fill is the union item both strips carry; its declared sign is the same number
        // in both, and it is the sign of the family INCLUDING the band (−7,200 + ~17,000 > 0)
        expect(onlyLeft.attr[9 + 8]).toBe(1);
        expect(both.attr[9 + 8]).toBe(1);
        expect(same(renderOf(both, 0), renderOf(onlyLeft, 0))).toBe(0);

        // and the bytes are the family's whole ink, across the seam: measured, worst 0.002 and
        // 74,851.5 units against the oracle's 74,851.5 over the same rings, each wound positive.
        // This family's two windings do NOT cancel — the declared sign is the POSITIVE one the
        // fast-path fill and the band carry, so the deposit over the negative fill's region adds
        // to the fill under it instead of cutting it; with `attr[8]` negated it is worst 1.000 and
        // 70,151.5, that item's whole 4,700 gone. §4.2 and D106 record what the engine can build,
        // and `packStats.mixedWinding` counts the item that disagrees here.
        expect(pack.packStats.mixedWinding).toBe(1);
        expect(worstAgainstUnion(both, renderOf(both, 0), renderOf(both, 1))).toBeLessThan(BAR);
        // and what a sign taken over the DRAWN items alone would give: without the band the sum is
        // the fill's own −7,200 and the strip that culls the stroke declares the other sign
        const drawnOnly = { ...onlyLeft, attr: onlyLeft.attr.slice() };
        drawnOnly.attr[9 + 8] = -1;
        expect(same(renderOf(both, 0), renderOf(drawnOnly, 0))).not.toBe(0);
    });
});
