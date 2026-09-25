/**
 * raster.arcs.test.js — A1–A9 of RASTERISER-PLAN §9.2: the arc flattener of §4.4, which is
 * problem 1 (F40: a re-homed circle drew its edge 463 px from where it is, because float32
 * and a far centre together lose 8 px at a product of 1.3e8).
 *
 * P1 is A1–A3 and it is measured this way: the fixture fills everything LEFT of a boundary
 * that is an arc across the plate, so the painted coverage summed along a pixel row IS the
 * boundary's average x over that row — exact for the rasteriser, and compared against the
 * arc's own exact float64 position from the chord frame (`freeze.chordFrame`'s h(a),
 * ((L/2)²−a²)/(d+√(r²−a²)), which never subtracts two numbers of the radius's size). The
 * flattener never sees a centre; the test is allowed one, and uses it only to build records
 * and as the oracle's input.
 *
 * White ink on black paper, so a stored byte is 255 × coverage.
 */

import * as core from "./rasterCore";
import { bulgeK, chordMidXY } from "../geometry/chordMath";
import { strokeStripNear } from "../geometry/polyline";
import { coverRings, ringsFromLoops } from "../__oracles__/coverageOracle";

const TW = core.TW, TH = core.TH;
const BAR = 1 / 16 + 0.5 / 255;                   // the oracle's own y quantisation, plus a byte
const TAU = Math.PI * 2;

/**
 * Items of loops (the `geometry/loop.js` grammar) in ONE family on one plate, at Zq = 1.
 * Each item is `{ loops, union }`; `subs` holds each loop's start within its own item (D36).
 */
function paintItems(items, opts = {}) {
    const { plate = [0, 0], Zq = 1, box = [-1e9, -1e9, 1e9, 1e9] } = opts;
    const n = items.length;
    const geom = [], subs = [];
    const meta = new Uint32Array(8 * n), attr = new Float64Array(9 * n), rgb = new Uint8Array(3 * n);
    for (let i = 0; i < n; i++) {
        const gs = geom.length, ss = subs.length;
        for (const loop of items[i].loops) { subs.push(geom.length - gs); for (const v of loop) geom.push(v); }
        meta[i * 8] = 0; meta[i * 8 + 1] = 0; meta[i * 8 + 2] = gs; meta[i * 8 + 3] = geom.length - gs;
        meta[i * 8 + 4] = ss; meta[i * 8 + 5] = subs.length - ss; meta[i * 8 + 6] = items[i].union ? 4 : 0;
        attr[i * 9] = box[0]; attr[i * 9 + 1] = box[1]; attr[i * 9 + 2] = box[2]; attr[i * 9 + 3] = box[3];
        attr[i * 9 + 7] = 1;
        rgb[i * 3] = 255; rgb[i * 3 + 1] = 255; rgb[i * 3 + 2] = 255;
    }
    const out = new Uint8ClampedArray(TW * TH * 4);
    const counts = new Uint32Array(8);
    core.renderPlate({
        Zq, plates: Int32Array.from(plate), paper: Uint8Array.from([0, 0, 0]), nItems: n,
        meta, attr, rgb, subs: Uint32Array.from(subs), geom: Float64Array.from(geom),
    }, 0, out, counts);
    return { out, counts };
}

/** One item of loops. */
function paintLoops(loops, opts = {}) {
    return paintItems([{ loops, union: !!opts.union }], opts);
}

/** The ink of one row, in pixels of coverage: the boundary's average x over that row. */
function rowInk(out, y) {
    let s = 0;
    for (let x = 0; x < TW; x++) s += out[(y * TW + x) * 4] / 255;
    return s;
}

const at = (out, x, y) => out[(y * TW + x) * 4];
const totalInk = (out) => { let s = 0; for (let i = 0; i < out.length; i += 4) s += out[i] / 255; return s; };

/**
 * P1's fixture at screen radius R: everything left of a boundary that runs down the plate,
 * straight above and below a vertical chord and an arc between. `sg` +1 bulges right.
 *
 * Returns the loop, the exact boundary's ∫x over a row, and the rows the arc alone owns.
 */
function contourFixture(R, sg) {
    // The chord is capped at R/√2 — a quarter turn — so the boundary never leans more than
    // 45° from vertical. An arc read ALONG A ROW is a horizontal distance, and at a
    // horizontal tangent that distance is unbounded while the arc is still within the
    // tolerance; past 45° the reading would measure the tangent, not the flattener.
    const half = Math.min(276, R * Math.SQRT1_2);   // the chord, centred on the plate
    const yA = 256 - half, yB = 256 + half;
    const d = Math.sqrt((R - half) * (R + half));
    const h = (a) => ((half - a) * (half + a)) / (d + Math.sqrt((R - a) * (R + a)));
    const xc = 256 - sg * h(0);                   // so the arc's apex sits mid-plate
    const sweep = sg * 2 * Math.asin(Math.min(1, half / R));
    const cx = xc - sg * d, cy = 256;             // the record's own centre; the flattener never reads it
    const a0 = Math.atan2(yA - cy, xc - cx);
    const loop = [-100, -100, 0, xc, -100, 0, xc, yA,
        1, cx, cy, R, a0, sweep, xc, yB,
        0, xc, TH + 100, 0, -100, TH + 100];

    // ∫x over row y. Under 276 px of radius the chord ends ON the circle's widest point,
    // where dh/da is infinite and quadrature crawls, so the closed form is used there; above
    // it the closed form's own terms reach R² and cancel, so Simpson runs on h instead.
    const analytic = R <= 1e6;                    // above it the closed form's terms reach R² and cancel
    const F = (a) => (a * Math.sqrt((R - a) * (R + a)) + R * R * Math.asin(a / R)) / 2 - d * a;
    const rowIntegral = (y) => {
        const a1 = Math.max(y - 256, -half), a2 = Math.min(y + 1 - 256, half);
        if (!(a2 > a1)) return xc;
        let area;
        if (analytic) area = F(a2) - F(a1);
        else {
            const n = 64, step = (a2 - a1) / n;
            let s = h(a1) + h(a2);
            for (let i = 1; i < n; i++) s += h(a1 + i * step) * (i % 2 ? 4 : 2);
            area = (s * step) / 3;
        }
        return xc * (a2 - a1) + sg * area + xc * (1 - (a2 - a1));
    };
    // every row of the plate is read: the ones the arc owns are the measurement, and the
    // straight ones above and below are a free check that a line is still exact
    const arcRows = Math.max(0, Math.min(TH, Math.floor(yB)) - Math.max(0, Math.ceil(yA)));
    return { loop, rowIntegral, arcRows, xc, sweep, sag: h(0) };
}

/** The worst row error of one P1 fixture, in device pixels. */
function contourError(R, sg) {
    const f = contourFixture(R, sg);
    const { out } = paintLoops([f.loop]);
    let worst = 0;
    for (let y = 0; y < TH; y++) worst = Math.max(worst, Math.abs(rowInk(out, y) - f.rowIntegral(y)));
    return { worst, rows: f.arcRows, sag: f.sag };
}

const RADII = [1, 16, 512, 1e4, 1e6, 1e10, 2.4e10, 1e19];

beforeEach(() => {
    core.useAccumPrecision("f32");
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("the arc flattener (§4.4)", () => {
    test("A1 P1: the painted edge is where float64 says it is, at eight radii", () => {
        const table = [];
        for (const R of RADII) table.push(Object.assign({ R }, contourError(R, 1)));
        let samples = 0;
        for (const row of table) {
            samples += row.rows;
            if (!(row.worst < 0.25)) throw new Error("A1: R = " + row.R + " is off by " + row.worst.toFixed(4) + " px");
            // The bar is 0.25 px and the target is ARC_TOL = 0.0625, which is a PERPENDICULAR
            // distance; a row reads it horizontally, and the fixture leans up to 45°, so the
            // reading is up to √2 of it. Measured worst 0.0611 px, at R = 1e4.
            expect(row.worst).toBeLessThan(core.ARC_TOL * Math.SQRT2);
        }
        expect(samples).toBeGreaterThan(2000);
        // 3,094 rows over the eight radii: 0 at R = 1 (the arc spans less than one whole row,
        // floor(256.71) − ceil(255.29)), 22 at R = 16 and 512 at each of the other six. Asserted
        // exactly, because the plan quotes it (§0, §9.2, D59) and a quoted number must reproduce.
        expect(samples).toBe(3094);
        expect(core.coreStats.arcClamped).toBe(0);
        expect(core.coreStats.nonFinite).toBe(0);
    });

    test("A2 P1: the error does not grow with the radius", () => {
        // F40 is an error PROPORTIONAL to the radius (float32's ulp at x·Zq ≈ 1.3e8 is 16 px),
        // so the shape of this column is the whole point: at 1e19 the arc is straight to
        // 7.6e-15 px and one chord draws it, and the error is smaller there, not larger.
        const worst = RADII.map((R) => contourError(R, 1).worst);
        for (const w of worst) expect(w).toBeLessThan(core.ARC_TOL * Math.SQRT2);
        // measured, in device px, at R = 1, 16, 512, 1e4, 1e6, 1e10, 2.4e10, 1e19:
        // 0.0106, 0.0223, 0.0247, 0.0611, 0.0392, 3.3e-6, 1.4e-6, 0. The error is the chord's
        // own sagitta and nothing else, so it stops at the tolerance however far away the
        // centre is; past 1e6 the arc is straighter than the bar and one chord draws it.
        for (const w of worst.slice(5)) expect(w).toBeLessThan(1e-3);
        expect(Math.max(...worst.slice(5))).toBeLessThan(Math.min(...worst.slice(0, 5)));
    });

    test("A3 P1: the same with the bulge on the other side and a negative sweep", () => {
        for (const R of RADII) {
            const e = contourError(R, -1);
            if (!(e.worst < core.ARC_TOL * Math.SQRT2)) throw new Error("A3: R = " + R + " is off by " + e.worst.toFixed(4) + " px");
            expect(e.sag).toBeGreaterThan(0);                 // there is a bulge to get wrong
        }
        // and the two signs are mirror images: the same radius bulges the same distance
        const p = contourFixture(512, 1), m = contourFixture(512, -1);
        expect(m.sag).toBeCloseTo(p.sag, 9);
        expect(m.sweep).toBeCloseTo(-p.sweep, 12);
    });

    test("A4 the coverage is the same with C and r deleted from the record", () => {
        for (const R of [16, 512, 1e6, 2.4e10]) {
            const f = contourFixture(R, 1);
            const blind = f.loop.slice();
            const o = blind.indexOf(1, 6);                    // the arc record's code word
            blind[o + 1] = NaN; blind[o + 2] = NaN; blind[o + 3] = NaN; blind[o + 4] = NaN;
            const a = paintLoops([f.loop]).out, b = paintLoops([blind]).out;
            expect(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer))).toBe(0);
            expect(core.coreStats.nonFinite).toBe(0);
        }
        // The one arc its own two ends do NOT describe is the whole turn — every circle
        // through A is a solution — so that one case reads the record's centre, and without
        // one it is refused, counted and drawn as its chord rather than drawn wrong (§4.4,
        // D54, D71). This record's two ends are the same point, so that chord is degenerate
        // and the plate stays empty; the chord that is NOT is the D67 test's triangle.
        const turn = [100, 60, 1, 100, 100, 40, -Math.PI / 2, Math.PI * 2, 100, 60];
        expect(totalInk(paintLoops([turn]).out)).toBeGreaterThan(0.9 * Math.PI * 40 * 40);
        const blindTurn = [100, 60, 1, NaN, NaN, NaN, NaN, Math.PI * 2, 100, 60];
        expect(totalInk(paintLoops([blindTurn]).out)).toBe(0);
        expect(core.coreStats.nonFinite).toBeGreaterThan(0);
    });

    test("a NON-FINITE sweep is refused and drawn as its chord; a non-finite END has none (D65, D68, D71)", () => {
        // Half of Infinity is Infinity, so the whole-turn branch's antipode split re-entered
        // itself: `renderPlate` threw a RangeError out of the core, where every other malformed
        // input here is counted and not flattened (R7, and D54's non-finite centre). The records
        // below have their two ends in the same place, so their chord is degenerate and the
        // plate is empty; a refused record whose chord is NOT degenerate is the D67 test's
        // triangle, where the chord is what keeps the item's outline closed (D71).
        const blank = paintLoops([[100, 60]]).out;           // a loop too short to draw: the empty plate
        for (const sweep of [Infinity, -Infinity, NaN]) {
            for (const union of [false, true]) {
                core.coreStats.nonFinite = 0;
                const bad = [100, 60, 1, 100, 100, 40, -Math.PI / 2, sweep, 100, 60];
                let out = null;
                expect(() => { out = paintLoops([bad], { union }).out; }).not.toThrow();
                expect(Buffer.compare(Buffer.from(out.buffer), Buffer.from(blank.buffer))).toBe(0);
                expect(core.coreStats.nonFinite).toBeGreaterThan(0);
            }
        }
        // A non-finite END is the same rule for a different cost, and the cost is arithmetic: an
        // INFINITE end makes the chord infinite, so u = 1 − 2·tol·sin(θ/2)/L rounds to exactly 1,
        // acos(1) is 0, the count comes back Infinity and the depth is clamped to MAXD — the
        // descent then walks all 16,777,216 of its leaves, measured on the shipped core in node
        // at about 0.7 s for this one record — 620–817 ms over the runs recorded — with
        // `arcClamped` at 1. A NaN end takes the other
        // branch (`!(L > 0)` is true, the sub-arc is skipped) and costs ONE chord and 5 ms. Both
        // are refused at the gate, and an end that is not a number has no chord to draw either.
        for (const end of [Infinity, -Infinity, NaN]) {
            core.coreStats.nonFinite = 0; core.coreStats.arcClamped = 0;
            const bad = [100, 60, 1, 100, 100, 40, -Math.PI / 2, Math.PI / 2, end, 60, 0, 100, 60];
            const p = paintLoops([bad]);
            expect(Buffer.compare(Buffer.from(p.out.buffer), Buffer.from(blank.buffer))).toBe(0);
            expect(p.counts[5]).toBe(0);                     // no chords: the descent never ran
            expect(core.coreStats.nonFinite).toBeGreaterThan(0);
            expect(core.coreStats.arcClamped).toBe(0);
        }
        // And the item's union SIGN does not read the dropped record either: `itemShoelace`
        // takes a whole turn from the record's centre (D60), and Infinity passes that test, so
        // an infinite sweep would have added a whole circle of area about its centre — here
        // 2π·391², which swamps the ring's own 2π·40² and turns the hole into a filled disc.
        const square = [200, 200, 0, 312, 200, 0, 312, 312, 0, 200, 312];
        const ring = [256 + 40, 256,
            1, 256, 256, 40, 0, -Math.PI, 256 - 40, 256,
            1, 256, 256, 40, -Math.PI, -Math.PI, 256 + 40, 256,
            1, 0, 0, 40, 0, Infinity, 256 + 40, 256];
        const { out } = paintItems([{ loops: [square] }, { loops: [ring], union: true }]);
        expect(at(out, 256, 256)).toBe(0);                   // the hole, not a filled disc
        expect(at(out, 210, 210)).toBe(255);
    });

    test("A5 the chord count is 2^D, and it is the §4.4 table's count within its ×2", () => {
        // A circle as four quarter pieces, wholly inside the plate: every chord is emitted,
        // so counts[4] (edges deposited) is the count, and counts[5] is 2^D summed.
        const quarters = (cx, cy, r) => {
            const loop = [cx + r, cy];
            for (let q = 1; q <= 4; q++) {
                const t = (q * Math.PI) / 2;
                const B = q === 4 ? [cx + r, cy] : [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
                loop.push(1, cx, cy, r, ((q - 1) * Math.PI) / 2, Math.PI / 2, B[0], B[1]);
            }
            return loop;                                      // closed exactly: sin(2π) is not 0
        };
        const ideal = (r) => {                                // §4.4's own n, for a whole circle
            const th = Math.PI / 2, L = 2 * r * Math.sin(th / 2);
            const n = th / (2 * Math.acos(Math.max(-1, 1 - (2 * core.ARC_TOL * Math.sin(th / 2)) / L)));
            return 4 * n;
        };
        const table = { 1: 9, 16: 36, 64: 71, 250: 142 };     // §4.4's table (256 would touch the edge)
        for (const r of [1, 16, 64, 250]) {
            const { counts } = paintLoops([quarters(256, 256, r)]);
            const emitted = counts[4];
            expect(counts[5]).toBe(4 * Math.pow(2, Math.ceil(Math.log2(ideal(r) / 4))));
            // all of it is inside the plate, so every chord is deposited — bar one that lands
            // exactly horizontal, which is no edge at all
            expect(emitted).toBeLessThanOrEqual(counts[5]);
            expect(emitted).toBeGreaterThanOrEqual(counts[5] - 2);
            expect(emitted).toBeGreaterThanOrEqual(table[r] * 0.9);
            expect(emitted).toBeLessThanOrEqual(2 * table[r]);
        }
        // the plan's worked case: at R = 256 the ideal is 142 and the generator emits 256
        expect(Math.round(ideal(256))).toBe(142);
        expect(paintLoops([quarters(256, 256, 250)]).counts[5]).toBe(256);

        // and the table's last two rows, on a piece clipped to the plate: a chord across the
        // plate's diagonal bows by c²/8R, so 1e6 px of radius needs two chords and 1.05e6 one
        const diag = (R) => {
            const A = [10, 10], B = [10 + 512, 10 + 512];
            const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
            const sweep = 2 * Math.asin(L / (2 * R));
            return [A[0], A[1], 1, NaN, NaN, R, NaN, sweep, B[0], B[1], 0, A[0], A[1]];
        };
        expect(paintLoops([diag(1e6)]).counts[5]).toBe(2);
        expect(paintLoops([diag(1.05e6)]).counts[5]).toBe(1);
        expect(paintLoops([diag(2.4e10)]).counts[5]).toBe(1);
    });

    test("A5 the cap and join fans of §4.8 use the same chord-count rule, and their edge is inside the tolerance", () => {
        // The band's rings come out in one order: a rectangle per segment, then a join fan per
        // interior vertex, then the start cap and the end cap (`polyline.strokeStripRound`).
        const ringOf = (r, k) => {
            const a = r.ring[k], b = k + 1 < r.rings ? r.ring[k + 1] : r.pts;
            const out = [];
            for (let i = a; i < b; i++) out.push([r.xy[i * 2], r.xy[i * 2 + 1]]);
            return out;
        };
        const chordsFor = (delta, half, tol) => Math.max(1, Math.ceil(delta / (2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / half))))));

        const pts = [[100, 100], [300, 100], [300, 300]];        // one 90° turn, two true ends
        for (const w of [0.2, 2, 40, 4000, 400000]) {
            for (const tol of [core.ARC_TOL, core.ARC_TOL / 4]) {
                const r = strokeStripNear(pts, w, null, { joins: "round", tol });
                const half = w / 2;
                expect(r.rings).toBe(5);                         // 2 rectangles + 1 join + 2 caps
                expect(ringOf(r, 0).length).toBe(4);
                // a fan is the centre plus K + 1 points on the circle, and the writer may have
                // reversed it to normalise the winding, so the arc points are taken by radius
                const onArc = (ring, c) => ring.filter((p) => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - half) < half * 1e-9);
                const join = onArc(ringOf(r, 2), pts[1]);
                const capA = onArc(ringOf(r, 3), pts[0]);
                const capB = onArc(ringOf(r, 4), pts[2]);
                expect(ringOf(r, 2).length).toBe(join.length + 1);
                expect(join.length - 1).toBe(chordsFor(Math.PI / 2, half, tol));
                expect(capA.length - 1).toBe(chordsFor(Math.PI, half, tol));
                expect(capB.length).toBe(capA.length);
                // every chord midpoint of the cap is inside the tolerance of the true circle
                let worst = 0;
                for (let i = 0; i + 1 < capA.length; i++) {
                    const m = [(capA[i][0] + capA[i + 1][0]) / 2, (capA[i][1] + capA[i + 1][1]) / 2];
                    worst = Math.max(worst, half - Math.hypot(m[0] - pts[0][0], m[1] - pts[0][1]));
                }
                expect(worst).toBeLessThanOrEqual(tol * (1 + 1e-9));
            }
        }

        // The fan is on the OUTER side of the turn — the side the rectangles leave open. Checked
        // in the picture and not in the angles: points just inside the corner's radius are
        // covered by the band and are NOT covered by its rectangles alone.
        const inRings = (rings, p) => {
            let w = 0;
            for (const ring of rings) {
                for (let i = 0; i < ring.length; i++) {
                    const a = ring[i], b = ring[(i + 1) % ring.length];
                    if ((a[1] <= p[1]) !== (b[1] <= p[1])) {
                        const t = (p[1] - a[1]) / (b[1] - a[1]);
                        if (a[0] + t * (b[0] - a[0]) > p[0]) w += b[1] > a[1] ? 1 : -1;
                    }
                }
            }
            return w !== 0;
        };
        const band = strokeStripNear(pts, 80, null, { joins: "round", tol: core.ARC_TOL });
        const rings = [], rects = [];
        for (let k = 0; k < band.rings; k++) {
            const r = ringOf(band, k);
            rings.push(r);
            if (k < 2) rects.push(r);                        // the two segment rectangles
        }
        for (const deg of [-80, -60, -45, -30, -10]) {
            const a = (deg * Math.PI) / 180;
            const p = [pts[1][0] + Math.cos(a) * 36, pts[1][1] + Math.sin(a) * 36];
            expect(inRings(rings, p)).toBe(true);
            expect(inRings(rects, p)).toBe(false);           // the rectangles leave this corner open
        }
        // and a point a hair outside the pen's own radius is not covered by anything
        expect(inRings(rings, [pts[1][0] + Math.cos(-Math.PI / 4) * 41, pts[1][1] + Math.sin(-Math.PI / 4) * 41])).toBe(false);

        // §4.4's ×2: four times the on-screen radius at one tolerance is twice the chords
        const chordsAt = (w) => ringOf(strokeStripNear(pts, w, null, { joins: "round", tol: core.ARC_TOL }), 4).length - 2;
        // (the cap ring is centre + K + 1 points however it is wound, so K is length − 2)
        for (const w of [40, 160, 640, 2560]) {
            expect(chordsAt(w * 4) / chordsAt(w)).toBeGreaterThan(1.9);
            expect(chordsAt(w * 4) / chordsAt(w)).toBeLessThan(2.1);
        }

        // a dot is a closed disc, and its area is short of πr² by less than the oracle's own
        // flattening bound (2/3)·arcLength·tol — O4's rule, applied to the fan
        const r40 = strokeStripNear([[256, 256]], 80, null, { joins: "round", tol: core.ARC_TOL });
        const disc = ringOf(r40, 0);
        let area = 0;
        for (let i = 0; i < disc.length; i++) {
            const a = disc[i], b = disc[(i + 1) % disc.length];
            area += a[0] * b[1] - b[0] * a[1];
        }
        const short = Math.PI * 40 * 40 - Math.abs(area) / 2;
        expect(short).toBeGreaterThan(0);                        // an inscribed polygon is inside
        expect(short).toBeLessThan((2 / 3) * (2 * Math.PI * 40) * core.ARC_TOL);
    });

    test("A6 a circle's coverage is πR² to the flattening tolerance", () => {
        for (const r of [8, 40, 100, 200]) {
            const loop = [256 + r, 256];
            for (let q = 1; q <= 4; q++) {
                const t = (q * Math.PI) / 2;
                loop.push(1, 256, 256, r, ((q - 1) * Math.PI) / 2, Math.PI / 2, 256 + Math.cos(t) * r, 256 + Math.sin(t) * r);
            }
            const ink = totalInk(paintLoops([loop]).out);
            const exact = Math.PI * r * r;
            expect(ink).toBeLessThan(exact);                  // the chords are inscribed
            expect(exact - ink).toBeLessThan((2 / 3) * (2 * Math.PI * r) * core.ARC_TOL);
        }
    });

    test("A7 the bulge is to the right of the chord for a positive sweep, by (L/2)·tan(sweep/4)", () => {
        // the line this test exists for: n̂ = (u_y, −u_x), from freeze.chordFrame:162 and
        // arcShape.chordArcMid. Backwards, every arc in the picture bulges the wrong way.
        expect(bulgeK(Math.PI / 2)).toBeCloseTo(Math.tan(Math.PI / 8) / 2, 15);
        const A = [100, 200], B = [300, 200], L = 200;
        for (const sweep of [Math.PI / 2, -Math.PI / 2]) {
            const M = chordMidXY(A[0], A[1], B[0], B[1], sweep, [0, 0]);
            expect(M[0]).toBeCloseTo(200, 9);
            expect(M[1]).toBeCloseTo(200 - Math.sign(sweep) * (L / 2) * Math.tan(Math.abs(sweep) / 4), 9);
            // and the painted picture agrees: the lens between the chord and the arc is
            // above the chord (smaller y) for a positive sweep on a chord running to +x
            const lens = [A[0], A[1], 1, NaN, NaN, NaN, NaN, sweep, B[0], B[1], 0, A[0], A[1]];
            const { out } = paintLoops([lens]);
            const above = at(out, 200, 200 - 20), below = at(out, 200, 200 + 20);
            if (sweep > 0) { expect(above).toBe(255); expect(below).toBe(0); }
            else { expect(above).toBe(0); expect(below).toBe(255); }
        }
    });

    test("A8 FORCED: a half turn, just over it, 1.9 turns and a whole turn all terminate and match the oracle", () => {
        const cx = 256, cy = 256, r = 90;
        for (const sweep of [Math.PI, Math.PI * 1.0001, Math.PI * 1.9, Math.PI * 2]) {
            const a0 = 0.3;
            const B = [cx + Math.cos(a0 + sweep) * r, cy + Math.sin(a0 + sweep) * r];
            const A = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
            const loop = [A[0], A[1], 1, cx, cy, r, a0, sweep, B[0], B[1], 0, A[0], A[1]];
            const D = core.arcDepth(A[0], A[1], B[0], B[1], sweep);
            const forced = core.arcForced(sweep);
            expect(Number.isFinite(D)).toBe(true);
            expect(D).toBeGreaterThanOrEqual(forced);
            expect(forced).toBe(sweep <= Math.PI ? 1 : 2);
            const { out } = paintLoops([loop]);
            const cov = coverRings(ringsFromLoops([loop], 1 / 64), TW, TH, 16);
            let wrongest = 0;
            for (let y = 100; y < 420; y++) {
                for (let x = 100; x < 420; x++) {
                    wrongest = Math.max(wrongest, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
                }
            }
            if (!(wrongest < BAR)) throw new Error("A8: sweep " + sweep + " is off by " + wrongest.toFixed(4));
        }
        expect(core.coreStats.arcClamped).toBe(0);
        // a whole turn is drawn: the antipode split gives it back its circle
        const turn = [256 + 90, 256, 1, 256, 256, 90, 0, Math.PI * 2, 256 + 90, 256];
        const ink = totalInk(paintLoops([turn]).out);
        expect(Math.abs(ink - Math.PI * 90 * 90) / (Math.PI * 90 * 90)).toBeLessThan(0.002);
    });

    test("A9 a sub-pixel radius gives a finite depth and a terminating descent", () => {
        // Under tol/2 = 1/32 px of radius the arccos argument falls below −1 and returns NaN
        // unclamped; between tol/2 and tol the count is under 1 and the depth would come out
        // below FORCED. Either way `depth === D` never fires and the descent never ends.
        for (const r of [1e-3, 1 / 64, 1 / 32, 1 / 16, 1 / 4]) {
            for (const sweep of [Math.PI / 3, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
                const A = [256 + r, 256];
                const B = [256 + Math.cos(sweep) * r, 256 + Math.sin(sweep) * r];
                const D = core.arcDepth(A[0], A[1], B[0], B[1], sweep);
                expect(Number.isFinite(D)).toBe(true);
                // D is 0 or at least FORCED, and nothing between: 0 is `arcDepth`'s early
                // return when one chord is already inside the bar, which `emitArc` reads as
                // forced = min(FORCED, D). Measured: r = 1e-3 and r = 1/16 at sweep π give
                // FORCED 1 and D 0, which is why this is not "D ≥ FORCED" (§4.4, §9.2 A9).
                expect(D === 0 || D >= core.arcForced(sweep)).toBe(true);
                expect(D).toBeLessThanOrEqual(24);
                const loop = [A[0], A[1], 1, 256, 256, r, 0, sweep, B[0], B[1], 0, A[0], A[1]];
                const { out, counts } = paintLoops([loop]);      // this is the line that used to hang
                expect(counts[5]).toBeLessThanOrEqual(16);       // a quarter-pixel disc: 8, four of them a half turn
                expect(totalInk(out)).toBeLessThan(Math.PI * r * r + 1e-9);
            }
        }
        expect(core.coreStats.arcClamped).toBe(0);
        // and the ink of a sub-pixel disc is its area, not nothing and not a whole pixel (F-Z).
        // Eight chords inscribe 90.0 % of a disc and the bytes of a shape this faint quantise
        // a further 2 %: measured 0.1725 against πr² = 0.1963.
        const r = 1 / 4;
        const disc = [256 + r, 256, 1, 256, 256, r, 0, Math.PI, 256 - r, 256,
            1, 256, 256, r, Math.PI, Math.PI, 256 + r, 256];
        const ink = totalInk(paintLoops([disc]).out);
        expect(ink).toBeGreaterThan(0.85 * Math.PI * r * r);
        expect(ink).toBeLessThan(Math.PI * r * r);
    });

    test("a CUT arc (grammar code 3, F43) draws exactly as the same arc does", () => {
        // The deep render list is mostly cut arcs: the record carries the canonical arc it was
        // cut from in words 6–13 and its own B in 14–15, and the flattener reads only A, B and
        // the piece's own sweep — so the two forms must be one picture.
        const cx = 256, cy = 256, r = 140, a0 = 0.2, sweep = 1.1;
        const A = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
        const B = [cx + Math.cos(a0 + sweep) * r, cy + Math.sin(a0 + sweep) * r];
        const plain = [A[0], A[1], 1, cx, cy, r, a0, sweep, B[0], B[1], 0, A[0], A[1]];
        const cut = [A[0], A[1], 3, cx, cy, r, a0, sweep, a0 - 0.5, 2.4, cx + r, cy, cx, cy + r, 0.2, 0.7,
            B[0], B[1], 0, A[0], A[1]];
        expect(Buffer.compare(Buffer.from(paintLoops([plain]).out.buffer), Buffer.from(paintLoops([cut]).out.buffer))).toBe(0);
        expect(paintLoops([cut]).counts[5]).toBe(paintLoops([plain]).counts[5]);
    });

    test("an item's box must contain the arc's bulge, and the core says so when it does not", () => {
        // For stage 2's `itemBox`: a box taken from the loop's ENDPOINTS leaves the bulge
        // outside the family's declared rows, and rows outside the box are rows the bounded
        // clear never visits — the next family would inherit the ink. The debug check exists
        // to catch that at the packer, and this is what it looks like.
        const cx = 256, cy = 256, r = 120;
        const A = [cx - r, cy], B = [cx + r, cy];
        const loop = [A[0], A[1], 1, cx, cy, r, Math.PI, -Math.PI, B[0], B[1], 0, A[0], A[1]];
        core.setDebugChecks(true);
        try {
            expect(() => paintLoops([loop], { box: [cx - r, cy - r, cx + r, cy + r] })).not.toThrow();
            expect(() => paintLoops([loop], { box: [cx - r, cy, cx + r, cy] })).toThrow(/outside the family box/);
        } finally {
            core.setDebugChecks(false);
        }
    });

    test("an arc inside a union item takes the union pass and keeps its coverage", () => {
        // a fat stroke's band can carry arcs (its round caps and joins, §4.8), and a union
        // item's rings overlap on purpose, so the flattener feeds the union edge buffer too
        const ring = (cx, r) => {
            const loop = [cx + r, 256];
            for (let q = 1; q <= 4; q++) {
                const t = (q * Math.PI) / 2;
                loop.push(1, cx, 256, r, ((q - 1) * Math.PI) / 2, Math.PI / 2, cx + Math.cos(t) * r, 256 + Math.sin(t) * r);
            }
            return loop;
        };
        const loops = [ring(200, 60), ring(240, 60)];           // two discs that overlap
        const u = paintLoops(loops, { union: true }).out;
        const cov = coverRings(ringsFromLoops(loops, 1 / 64), TW, TH, 16);
        let wrongest = 0;
        for (let y = 180; y < 340; y++) {
            for (let x = 120; x < 320; x++) wrongest = Math.max(wrongest, Math.abs(u[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
        }
        expect(wrongest).toBeLessThan(BAR);
        expect(at(u, 220, 256)).toBe(255);                      // the overlap is covered once
        expect(core.coreStats.unionRefills).toBe(0);

        // The two pruned subtrees, which nothing above reaches. RIGHT of the plate the union
        // pass must leave the subtree's own net height at column TW (D55) — dropped, as the
        // fast path may drop it, the winding never returns to zero, `emitRuns` closes no run
        // and the whole run's ink disappears. LEFT of it the substitution is at column 0.
        for (const [cx, worstAt] of [[700, "right"], [-200, "left"]]) {
            const wide = [ring(cx, 400)];                       // 300…1100, or −600…200
            const p = paintLoops(wide, { union: true }).out;
            const ref = coverRings(ringsFromLoops(wide, 1 / 64), TW, TH, 16);
            let w2 = 0;
            for (let y = 0; y < TH; y++) {
                for (let x = 0; x < TW; x++) w2 = Math.max(w2, Math.abs(p[(y * TW + x) * 4] / 255 - ref[y * TW + x]));
            }
            // measured 0.0322 either side, against BAR = 0.0645: the two fixtures are mirror
            // images, and the worst pixel is row 30 on the right and row 481 on the left
            if (!(w2 < BAR)) throw new Error("the " + worstAt + " prune is off by " + w2.toFixed(4));
            expect(totalInk(p)).toBeGreaterThan(1000);          // there is a run to lose
        }
        expect(core.coreStats.nonFinite).toBe(0);
        expect(core.coreStats.unionRefills).toBe(0);
    });

    test("a union ring written as ONE whole-turn record keeps its winding's sign (D60)", () => {
        // A whole turn's two ends coincide, so the chord form gives the ring no area at all:
        // read from the chord it has no sign, the union deposit comes out +1 whichever way it
        // is wound, and a ring meant to cut a hole fills one instead. `itemShoelace` takes this
        // one case from the record's centre, as the descent does (D54). The oracle is the
        // nonzero winding of square and ring together: same-wound unions, counter-wound cuts.
        const square = [200, 200, 0, 312, 200, 0, 312, 312, 0, 200, 312];
        const turn = (sg) => [256 + 40, 256, 1, 256, 256, 40, 0, sg * 2 * Math.PI, 256 + 40, 256];
        const halves = (sg) => [256 + 40, 256,
            1, 256, 256, 40, 0, sg * Math.PI, 256 - 40, 256,
            1, 256, 256, 40, sg * Math.PI, sg * Math.PI, 256 + 40, 256];
        for (const sq of [square, reversedSquare(square)]) {
            for (const sg of [1, -1]) {
                for (const ringLoop of [turn(sg), halves(sg)]) {
                    const { out } = paintItems([
                        { loops: [sq] },
                        { loops: [ringLoop], union: true },
                    ]);
                    const cov = coverRings(ringsFromLoops([sq, ringLoop], 1 / 64), TW, TH, 16);
                    let worst = 0;
                    for (let y = 190; y < 322; y++) {
                        for (let x = 190; x < 322; x++) {
                            worst = Math.max(worst, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
                        }
                    }
                    // one whole turn measured 1.000 before the fix — the inverse picture, a whole
                    // disc of ink added or removed; the same circle as two half turns was right
                    if (!(worst < BAR)) throw new Error("sweep " + sg + "·2π is off by " + worst.toFixed(4));
                    expect(at(out, 256, 256)).toBe(Math.round(255 * cov[256 * TW + 256]));
                }
            }
        }
        expect(core.coreStats.nonFinite).toBe(0);
    });

    test("an arc record PAST a whole turn is refused, counted and drawn as its chord (D67, D71)", () => {
        // §4.4 bounds a record at |sweep| ≤ 2π and the engine holds to it: `biarc.arcThrough`
        // normalises a sweep into (0, 2π] or [−2π, 0) (`geometry/biarc.js:92-95`) and every
        // later operation only scales one down. Past the bound the antipode split is NOT the
        // arc's own midpoint, so it painted the wrong picture for unbounded work — measured on
        // this fixture before the guard: 46,262 units of ink at 3π where the disc is 25,441
        // (the oracle's own total, which quantises in y — §9.1; πr² is 25,447), 238,815 units
        // over 239,253 of the plate's 262,144 pixels at 12 rad, and 22.5 s at 1e7 rad.
        const cx = 256, cy = 256, r = 90, a0 = 0.3;
        const rec = (sweep) => {
            const A = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
            const B = [cx + Math.cos(a0 + sweep) * r, cy + Math.sin(a0 + sweep) * r];
            return [A[0], A[1], 1, cx, cy, r, a0, sweep, B[0], B[1], 0, A[0], A[1]];
        };
        const withSweep = (loop, s) => { const c = loop.slice(); c[7] = s; return c; };

        // A whole turn and everything under it is drawn, and the oracle says the picture is
        // right — the antipode split (D54) is exact at 2π, which is what the engine can emit.
        for (const sweep of [TAU, -TAU, TAU - 1e-6, TAU - 1e-3]) {
            core.coreStats.arcOverTurn = 0;
            const loop = rec(sweep);
            const { out, counts } = paintLoops([loop]);
            const cov = coverRings(ringsFromLoops([loop], 1 / 64), TW, TH, 16);
            let worst = 0;
            for (let y = 140; y < 380; y++) {
                for (let x = 140; x < 380; x++) worst = Math.max(worst, Math.abs(out[(y * TW + x) * 4] / 255 - cov[y * TW + x]));
            }
            if (!(worst < BAR)) throw new Error("sweep " + sweep + " is off by " + worst.toFixed(4));
            expect(counts[5]).toBeGreaterThan(0);
            expect(core.coreStats.arcOverTurn).toBe(0);
        }

        // Past it: nothing is flattened, the counter is the evidence, and the plate is the one
        // a record the core already refuses gives — one rule for both (D65's non-finite sweep).
        const started = Date.now();
        for (const sweep of [TAU + 1e-6, 3 * Math.PI, -3 * Math.PI, 12, 4 * Math.PI, 1e7]) {
            core.coreStats.arcOverTurn = 0; core.coreStats.nonFinite = 0;
            const loop = rec(sweep);
            const over = paintLoops([loop]);
            expect(core.coreStats.arcOverTurn).toBe(1);
            expect(core.coreStats.nonFinite).toBe(0);
            expect(over.counts[5]).toBe(0);                  // the descent never ran: 2^D is 0
            core.coreStats.nonFinite = 0;
            const refused = paintLoops([withSweep(loop, Infinity)]);
            expect(Buffer.compare(Buffer.from(over.out.buffer), Buffer.from(refused.out.buffer))).toBe(0);
        }
        // and the work is bounded, which is the other half of the defect: 22.5 s for the 1e7
        // record alone before the guard, and 0.3 ms after it (measured in node)
        expect(Date.now() - started).toBeLessThan(2000);

        // Nothing is painted where the refused record IS the whole outline and its two ends are
        // the same point, so the chord it leaves behind is degenerate.
        const blank = paintLoops([[100, 60]]).out;
        const solo = [100, 60, 1, 100, 100, 40, -Math.PI / 2, 3 * Math.PI, 100, 60];
        core.coreStats.arcOverTurn = 0;
        expect(Buffer.compare(Buffer.from(paintLoops([solo]).out.buffer), Buffer.from(blank.buffer))).toBe(0);
        expect(core.coreStats.arcOverTurn).toBe(1);

        // Where the chord is NOT degenerate, a refused record would leave the item's outline
        // open, and in a signed-area accumulator a missing edge is not a local omission.
        // Measured on this triangle with the chord deposit removed: the fast path painted
        // 34,944.0 units of ink out to the plate's right edge (x 200…511) where the item itself
        // is 7,109.5, and the union path painted 0.0 — the whole item gone, because `emitRuns`
        // never saw the crossing that closes the run. The chord is deposited instead, so the
        // plate is EXACTLY the one the same loop with a straight record gives, which is also the
        // term `itemShoelace` credits the record with (D71).
        const tri = (s, ccx = 256) => (s === null
            ? [200, 200, 0, 312, 200, 0, 200, 312]
            : [200, 200, 0, 312, 200, 1, ccx, 256, 90, 0, s, 200, 312]);
        // All THREE of `emitArc`'s refusals, because each was the same leak in its turn: a
        // sweep past a whole turn (D67), a non-finite sweep (D65), and a whole turn whose
        // CENTRE is not finite (D54) — that last one measured 34,944.0 and 0.0 on this
        // triangle with its chord line removed, exactly like the other two.
        const refusals = [[3 * Math.PI, 256, "arcOverTurn"], [Infinity, 256, "nonFinite"], [Math.PI * 2, NaN, "nonFinite"]];
        for (const union of [false, true]) {
            const chord = paintLoops([tri(null)], { union });
            const drawn = paintLoops([tri(0.4)], { union });
            const chordInk = totalInk(chord.out);
            expect(Math.abs(chordInk - 6272.2)).toBeLessThan(0.5);
            expect(Math.abs(totalInk(drawn.out) - 7109.5)).toBeLessThan(0.5);   // the bulge is 837 of it
            for (const [s, ccx, guard] of refusals) {
                core.coreStats.arcOverTurn = 0; core.coreStats.nonFinite = 0;
                const p = paintLoops([tri(s, ccx)], { union });
                const ink = totalInk(p.out);
                if (!(Math.abs(ink - chordInk) < 1e-9)) {
                    throw new Error((union ? "union" : "fast") + " path: the refused triangle carries "
                        + ink.toFixed(1) + " units of ink, not the chord's " + chordInk.toFixed(1));
                }
                expect(Buffer.compare(Buffer.from(p.out.buffer), Buffer.from(chord.out.buffer))).toBe(0);
                expect(core.coreStats[guard]).toBe(1);        // the record is refused once, and counted
            }
        }

        // and the item's union SIGN reads a refused record the way the deposit draws it — its
        // CHORD and no arc term (D71). Without that, the whole-turn branch would credit this one
        // with 2π·391² about the centre it names and fill the ring's hole (the D60/D65 trap).
        const square = [200, 200, 0, 312, 200, 0, 312, 312, 0, 200, 312];
        const ring = [256 + 40, 256,
            1, 256, 256, 40, 0, -Math.PI, 256 - 40, 256,
            1, 256, 256, 40, -Math.PI, -Math.PI, 256 + 40, 256,
            1, 0, 0, 40, 0, 3 * Math.PI, 256 + 40, 256];
        const { out } = paintItems([{ loops: [square] }, { loops: [ring], union: true }]);
        expect(at(out, 256, 256)).toBe(0);                   // the hole, not a filled disc
        expect(at(out, 210, 210)).toBe(255);

        // Under `setDebugChecks` it throws instead of counting, so the packer test that feeds
        // the core a malformed record sees it rather than reading a counter afterwards.
        core.setDebugChecks(true);
        try {
            expect(() => paintLoops([rec(3 * Math.PI)])).toThrow(/past a whole turn/);
            expect(() => paintLoops([rec(TAU)])).not.toThrow();
        } finally {
            core.setDebugChecks(false);
        }
    });

    test("the MAXD clamp fires, is counted, and this is what it costs the picture (D57)", () => {
        // `arcDepth` caps the bisection at MAXD = 24, and a piece that wanted more is drawn by
        // chords that sit further from it than ARC_TOL by an unbounded amount. Nothing else in
        // §9.2 would see that, which is why `arcClamped` exists — and nothing in the suite had
        // ever made it non-zero, so this is the case that runs the clamp's own line.
        //
        // The fixture is a boundary that is a vertical line across the plate to 3e-10 px (a
        // quarter turn of screen radius R, apex at the middle of the plate, filled to the
        // left), so a ROW'S OWN INK is the boundary's x — the A1 reading, with no integral to
        // do. `off` slides the apex along the sweep by a fraction of one depth-`d` chord: at
        // 0.5 the plate sits at a chord's MIDDLE, where a chord departs furthest from its arc.
        const fixture = (R, d, off) => {
            const sweep = Math.PI / 2, cx = 256 - R, cy = 256;
            const a0 = -sweep * (0.5 + off / Math.pow(2, d));
            const A = [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R];
            const B = [cx + Math.cos(a0 + sweep) * R, cy + Math.sin(a0 + sweep) * R];
            return [-1e6, A[1], 0, A[0], A[1], 1, cx, cy, R, a0, sweep, B[0], B[1], 0, -1e6, B[1]];
        };
        const worstRow = (loop) => {
            const { out } = paintLoops([loop]);
            let worst = 0;
            for (let y = 0; y < TH; y++) worst = Math.max(worst, Math.abs(rowInk(out, y) - 256));
            return worst;
        };
        // measured, in device px: 0.04314 unclamped at R = 1e13, then 0.11373 and 1.12549 with
        // the clamp in force — the bar broken by 1.8× and by 18×, which is the "unbounded"
        const table = [[1e13, 23, 0], [1e13, 23, 0.5], [1e14, 24, 0.5], [1e15, 24, 0.5]];
        const worst = [];
        for (const [R, d, off] of table) {
            core.coreStats.arcClamped = 0;
            worst.push(worstRow(fixture(R, d, off)));
            expect(core.coreStats.arcClamped).toBe(R > 5.8e13 ? 1 : 0);   // the first R that wants depth 25
        }
        expect(worst[0]).toBeLessThan(core.ARC_TOL);         // apex on a chord's END: exact
        expect(worst[1]).toBeLessThan(core.ARC_TOL);         // apex mid-chord, depth not clamped
        expect(worst[2]).toBeGreaterThan(core.ARC_TOL);      // clamped: 1.8× the bar
        expect(worst[3]).toBeGreaterThan(10 * core.ARC_TOL); // and it grows with the radius
        expect(worst[3]).toBeGreaterThan(worst[2]);

        // D57's claim, which is why the clamp is a counter and not a failure: under the plan's
        // own coordinate bound (1.75e8 device px, §4.6) it is unreachable — the depth there is
        // 15 and the worst row is 0.051 px, inside ARC_TOL.
        core.coreStats.arcClamped = 0;
        const bound = fixture(1.75e8, 15, 0.5);
        expect(core.arcDepth(bound[3], bound[4], bound[11], bound[12], bound[10])).toBe(15);
        expect(worstRow(bound)).toBeLessThan(core.ARC_TOL);
        expect(core.coreStats.arcClamped).toBe(0);
    });

    test("a row that needs a second buffer-full counts its arcs and its refusals once (D61, D72)", () => {
        // `walkRowChunked` (F75) re-reads the row's geometry UNION_K times per buffer-full, and
        // every pass re-enters `emitArc`. Counted as it accumulates, `chords` would read 16× the
        // refills too high and §8.3's chords-against-edges reading would say nothing here; the
        // three guards that count RECORDS would read 16 for one refused record (measured), and
        // 2 for the same record in a family split into two row bands.
        const ribbon = (i, y = 200) => { const x = 10 + i * 0.06; return [x, y + 0.1, 0, x + 0.03, y + 0.1, 0, x + 0.03, y + 0.9, 0, x, y + 0.9]; };
        const disc = [460.45, 200.5,
            1, 460, 200.5, 0.45, 0, Math.PI, 459.55, 200.5,
            1, 460, 200.5, 0.45, Math.PI, Math.PI, 460.45, 200.5];
        const over = [455.45, 200.5, 1, 455, 200.5, 0.45, 0, 3 * Math.PI, 454.55, 200.5];
        const row = (n) => {
            const loops = [];
            for (let i = 0; i < n; i++) loops.push(ribbon(i));   // ascending x: the sort stays cheap
            loops.push(disc, over);
            // the box is the disc's own extent, so both fixtures are ONE row band: a box of whole
            // rows rounds outward to three bands, and a family walked in bands counts its arcs
            // once per band by design (D58), which is not what this test is about
            return paintItems([{ loops, union: true }], { box: [0, 200.05, TW, 200.95] });
        };
        core.coreStats.arcOverTurn = 0;
        const fits = row(100);                                  // 202 union edges: one buffer-full
        expect(core.coreStats.unionRefills).toBe(0);
        expect(core.coreStats.unionSplits).toBe(0);
        expect(core.coreStats.arcOverTurn).toBe(1);
        core.coreStats.arcOverTurn = 0;
        const chunked = row(8300);                              // 16,602: two buffer-fulls
        expect(core.coreStats.unionRefills).toBeGreaterThan(0);
        expect(core.coreStats.unionSplits).toBe(0);             // one band in both, so the counts compare
        expect(chunked.counts[5]).toBe(fits.counts[5]);         // 8 in both: measured 128 before the fix
        expect(fits.counts[5]).toBeGreaterThan(0);
        expect(core.coreStats.arcOverTurn).toBe(1);             // 16 before the fix: one a sub-scanline
        expect(core.coreStats.nonFinite).toBe(0);

        // The other half of the roll-back, which the two fixtures above cannot reach because
        // each is one band: a family SPLIT into row bands re-reads all of its geometry per
        // band, so the same record is refused once a band. Two pixel rows of 6,000 ribbons
        // are 24,002 union edges — the whole box does not fit, each row does.
        core.coreStats.arcOverTurn = 0; core.coreStats.unionSplits = 0; core.coreStats.unionRefills = 0;
        // pushed in DESCENDING x: a band that FITS walks from a per-row list that reverses the
        // push order, and an insertion sort of 12,000 crossings already in reverse is minutes
        const loops = [];
        for (let i = 5999; i >= 0; i--) loops.push(ribbon(i), ribbon(i, 201));
        loops.push(disc, over);
        const banded = paintItems([{ loops, union: true }], { box: [0, 200.05, TW, 201.95] });
        expect(core.coreStats.unionSplits).toBeGreaterThan(0);  // the box was halved
        expect(core.coreStats.unionRefills).toBe(0);            // and each half then fits
        expect(core.coreStats.arcOverTurn).toBe(1);             // 2 before the fix: one a band
        expect(core.coreStats.nonFinite).toBe(0);
        expect(banded.counts[5]).toBe(2 * fits.counts[5]);      // chords ARE once a band (D58)
    });
});

/** The same square loop wound the other way: its points in reverse, still starting at the first. */
function reversedSquare(loop) {
    const pts = [[loop[0], loop[1]]];
    for (let o = 2; o < loop.length; o += 3) pts.push([loop[o + 1], loop[o + 2]]);
    pts.reverse();
    pts.unshift(pts.pop());
    const out = [pts[0][0], pts[0][1]];
    for (let i = 1; i < pts.length; i++) out.push(0, pts[i][0], pts[i][1]);
    return out;
}
