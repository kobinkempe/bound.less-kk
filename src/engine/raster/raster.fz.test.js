/**
 * raster.fz.test.js — F1 of RASTERISER-PLAN §9.2 and the two committed fixtures of §9.3
 * (stage 2b). Everything here is RECORDED geometry: no shape in this file was invented.
 *
 *  - `__fixtures__/fz-object-4.json` is the F-Z object — the thin stroke Chrome drops at
 *    0.165 device px and paints again at 0.082 (`docs/OPEN-FLAGS.md` F-Z). It is rastered at
 *    the ten zooms of that flag's own sweep, and at every one the painted coverage must equal
 *    the object's exact ink area and step DOWN, which is problem 3 of §1.1.
 *  - `__fixtures__/f40-pieces.json` carries the largest arc radius any report in the tree holds
 *    (3.31e7 units, D94). It is rastered and read against the coverage oracle, and then against
 *    itself with every arc's centre blanked — because the centre is what F40 is about.
 *
 * White ink on black paper, so a stored byte is 255 × coverage.
 *
 * The per-pixel bar is DERIVED and is not §4.4's 1/16 alone. Two pictures of one CURVED boundary
 * differ by three terms: the core's chords (`ARC_TOL` = 1/16 device px, §4.4 — a PERPENDICULAR
 * distance, which a pixel's coverage reads horizontally, so a leaning edge carries up to √2 of it,
 * the reading `raster.arcs.test.js:142` takes as well), the oracle's y quantisation (1/16, §9.1)
 * and the 8-bit comparison. No oracle setting brings F40 inside 1/16: its residual is the core's
 * chords alone (0.0694 with the oracle's sub-scanlines at K = 256, against 0.0695 at the shipped
 * K = 16). Each term's own measurement, and why §10's acceptance was amended rather than this
 * suite retuned, are §11's D142.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { Loop } from "../geometry/loop";
import { loopsBBox, loopArea } from "../geometry/arcShape";
import { PLATE_PX } from "./plate";
import { coverRings, ringsFromLoops } from "../__oracles__/coverageOracle";

const FZ = require("../__fixtures__/fz-object-4.json");
const F40 = require("../__fixtures__/f40-pieces.json");

const TW = core.TW, TH = core.TH;
/** The three terms of the header: √2 · the core's chords + the oracle's y quantisation + the
 *  8-bit comparison = 0.1528. `raster.arcs.test.js:142` reads `ARC_TOL` the same way. */
const BAR = core.ARC_TOL * Math.SQRT2 + 1 / 16 + 0.5 / 255;
/** The worst pixel this build reads, pinned with 13–15 % of margin so the derived bar above cannot
 *  hide a regression: 0.0797 on the F-Z object (0.0355–0.0632 at the nine rows below the first)
 *  and 0.0695 / 0.0644 on F40. F40's pin also clears the 0.0757 the 64× finer oracle below reads,
 *  so neither pin depends on that setting. Either failing means re-measure, not re-tune. */
const RECORDED_FZ = 0.09, RECORDED_F40 = 0.08;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };
/** The oracle's own flattening, in device px, and it is the build's: every other oracle call
 *  passes 1/64 (`raster.arcs.test.js` five times, `raster.oracle.test.js` O4). Refining it 64× to
 *  1/4096 moves the worst pixel by at most 0.006 — F-Z 0.0797 unchanged with its row-0 count over
 *  1/16 going 7 → 18, F40 0.0695 → 0.0757 and 0.0644 → 0.0715 — and every assertion here, the two
 *  pins included, holds at both. F2 ASSERTS that for its span-512 pixel rather than claiming it
 *  (the fine read at the end of the test, §15.3's stage 2b ruling). */
const ORACLE_TOL_PX = 1 / 64;

/** `inScale` in the flag's sweep is CSS px per unit of the CAMERA's level; the object is one
 *  level down, and the fixture's own camera row says by how much: 4096. */
const PER_INSCALE = FZ.camera.effectiveZoom / FZ.camera.inScale;
/** The ten rows of the F-Z flag's sweep (`docs/OPEN-FLAGS.md` "The reproduction"). */
const SWEEP = [200, 141, 100, 71, 50, 35, 25, 18, 12.5, 6];
/** Its "ink on screen" column, in device px, as the flag prints it. */
const FLAG_INK = [0.658, 0.464, 0.329, 0.234, 0.165, 0.115, 0.082, 0.059, 0.041, 0.020];
/** The brightest byte this build paints at each row, recorded. Row 4 is the one Chrome drops, and
 *  55 of 255 is the whole story: no pixel of the object is even a fifth of the ink's own colour. */
const PEAK = [184, 146, 105, 77, 55, 39, 29, 19, 14, 7];

/** A stored native as a render-list item: the loops wrapped, and white so a byte is coverage. */
const itemOf = (o) => ({ ...o, color: "#ffffff", z: 0, loops: o.loops.map((l) => Loop.wrap(Float64Array.from(l))) });

/** Every plate the object's own box touches at this zoom. Not `plate.plateRange`: that takes a
 *  half-open viewport and reads ceil − 1 on the far edges, and this is a closed object box. */
function platesFor(box, Zq) {
    const s = Zq / PLATE_PX;
    const i0 = Math.floor(box.x0 * s), i1 = Math.floor(box.x1 * s);
    const j0 = Math.floor(box.y0 * s), j1 = Math.floor(box.y1 * s);
    const plates = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) plates.push(i, j);
    return { plates, i0, i1, j0, j1 };
}

/**
 * The object through the shipped packer and the shipped core, every plate of its own box
 * assembled into one image. `mutate` edits the packed job before it is drawn (F3).
 */
function render(item, Zq, q, mutate) {
    const { plates, i0, i1, j0, j1 } = platesFor(loopsBBox(item.loops), Zq);
    const job = pack.packJob([item], { plates: Int32Array.from(plates), q, Zq, dpr: 1, cfg: CFG, paper: [0, 0, 0] });
    if (mutate) mutate(job);
    const W = (i1 - i0 + 1) * TW, H = (j1 - j0 + 1) * TH;
    const img = new Float64Array(W * H);
    const bytes = new Uint8Array(W * H);
    const out = new Uint8ClampedArray(TW * TH * 4);
    let ink = 0, lit = 0, peak = 0;
    for (let p = 0; p * 2 < plates.length; p++) {
        core.renderPlate(job, p, out);
        const cx = (plates[p * 2] - i0) * TW, cy = (plates[p * 2 + 1] - j0) * TH;
        for (let y = 0; y < TH; y++) {
            for (let x = 0; x < TW; x++) {
                const v = out[(y * TW + x) * 4];
                if (!v) continue;
                bytes[(cy + y) * W + cx + x] = v;
                img[(cy + y) * W + cx + x] = v / 255;
                ink += v / 255; lit++;
                if (v > peak) peak = v;
            }
        }
    }
    return { img, bytes, W, H, ink, lit, peak, nPlates: plates.length / 2, ox: i0 * TW, oy: j0 * TH, job };
}

/** The same window through the oracle: the loop grammar flattened, in the window's own pixels.
 *  `tolPx` is the oracle's flattening in device px and defaults to the build's 1/64; F2 passes
 *  1/4096 once, to assert the reading holds at both. */
function oracleOf(item, Zq, r, tolPx = ORACLE_TOL_PX) {
    const rings = ringsFromLoops(item.loops.map((l) => l.buf), tolPx / Zq)
        .map((ring) => ring.map((p) => [p[0] * Zq - r.ox, p[1] * Zq - r.oy]));
    const cov = coverRings(rings, r.W, r.H, 16);
    let worst = 0, at = -1, sum = 0, over = 0;
    for (let i = 0; i < cov.length; i++) {
        sum += cov[i];
        const d = Math.abs(cov[i] - r.img[i]);
        if (d > 1 / 16) over++;
        if (d > worst) { worst = d; at = i; }
    }
    return { worst, x: at % r.W, y: (at / r.W) | 0, sum, over, cov };
}

/** The exact ink area of the object, in device px², from `arcShape.loopArea` (arcs resolved). */
const exactInk = (item, Zq) => Math.abs(item.loops.reduce((a, l) => a + loopArea(l), 0)) * Zq * Zq;

beforeEach(() => {
    core.useAccumPrecision("f32");                          // what ships (`ACC_F32`), and what PEAK was read on
    pack.clearPackCaches();
    pack.resetPackStats();
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("the recorded geometry (§9.3): the F-Z sliver and the largest arc in the tree", () => {
    test("the two fixtures are the ones §9.3 names", () => {
        expect(FZ.pieces).toBe(610);
        expect(FZ.object.id).toBe(4);
        expect(FZ.report).toBe("report-2026-08-25T15-53-05-793Z.json");
        const fz = itemOf(FZ.object);
        expect(fz.loops.length).toBe(1);
        const b = loopsBBox(fz.loops);
        expect(b.x1 - b.x0).toBeCloseTo(15119.65, 2);
        expect(b.y1 - b.y0).toBeCloseTo(7272.81, 2);
        expect(FZ.object.w).toBeCloseTo(13.4698, 4);
        // 4096 is the level ratio: `inScale` is CSS px per unit one level up from the object
        expect(PER_INSCALE).toBeCloseTo(1 / 4096, 12);
        expect(FZ.camera.inScale).toBeCloseTo(50.156, 2);   // the recorded camera IS the blank row

        expect(F40.pieces).toBe(942);
        expect(F40.radius).toBeCloseTo(33055373.7, 1);
        const f = itemOf(F40.object);
        expect(f.loops.length).toBe(1);
        let arcs = 0, biggest = 0;
        for (const p of f.loops[0]) if (!p.line && isFinite(p.r)) { arcs++; biggest = Math.max(biggest, p.r); }
        expect(arcs).toBe(925);
        expect(biggest).toBe(F40.radius);
    });

    test("F1 the F-Z object at the ten zooms of the sweep: the ink is there, and it steps down", () => {
        const item = itemOf(FZ.object);
        // One loop, so `ringsNeedUnion` has no pair to test and the picture is plain signed-area
        // accumulation — exact for a simple loop, which is why the readings below land where they do.
        expect(pack.entryFor(item, CFG).union).toBe(false);
        const rows = [], ink = [], peak = [];
        for (let k = 0; k < SWEEP.length; k++) {
            const Zq = SWEEP[k] * PER_INSCALE;
            const r = render(item, Zq, k);
            const exact = exactInk(item, Zq);
            const o = oracleOf(item, Zq, r);
            ink.push(r.ink); peak.push(r.peak);
            rows.push({
                inScale: SWEEP[k], "ink px": +(FZ.object.w * Zq).toFixed(4), "flag": FLAG_INK[k],
                "exact px²": +exact.toFixed(3), painted: +r.ink.toFixed(3), "painted/exact": +(r.ink / exact).toFixed(4),
                oracle: +o.sum.toFixed(3), "worst px": +o.worst.toFixed(4), "over 1/16": o.over,
                lit: r.lit, peak: r.peak, plates: r.nPlates,
            });

            // the flag's own ink column, and P3: the coverage IS the ink area, within 10 %
            expect(FZ.object.w * Zq).toBeCloseTo(FLAG_INK[k], 2);
            expect(Math.abs(r.ink - exact) / exact).toBeLessThan(0.10);
            expect(Math.abs(o.sum - exact) / exact).toBeLessThan(0.10);
            // and it is in the right PLACE, not merely the right amount
            expect(o.worst).toBeLessThan(BAR);              // the derivation
            expect(o.worst).toBeLessThan(RECORDED_FZ);      // and what this build actually reads
            expect(o.over / r.lit).toBeLessThan(0.01);
            expect(r.peak).toBe(PEAK[k]);                   // the row Chrome paints BLANK is row 4
        }
        // eslint-disable-next-line no-console
        console.table(rows);
        for (let k = 1; k < ink.length; k++) {
            expect(ink[k]).toBeLessThan(ink[k - 1]);        // monotone in the zoom, which F-Z was not
            expect(peak[k]).toBeLessThan(peak[k - 1]);      // and the sliver fades rather than blinking
        }
        expect(pack.packStats.culled).toBe(0);
        // The bar's first term assumes the core met `ARC_TOL`, and a bisection clamped to MAXD
        // breaks it by an unbounded amount (`rasterCore.js:438`). Over the ten rows: none.
        expect(core.coreStats.arcClamped).toBe(0);
        // What the flag records, as a number this suite owns: from the blank row down the brightest
        // pixel of the whole object is 55 of 255 and falling, so a renderer that drops ink under a
        // fifth of its own colour loses the object outright — there is no partial picture first.
        expect(Math.max(...PEAK.slice(4))).toBeLessThan(64);

        // The control, so the per-pixel reading above can fail: the same object moved half a device
        // pixel, read against the oracle where it WAS. A comparison that cannot see this sees nothing.
        const Zq = SWEEP[0] * PER_INSCALE;
        const straight = render(item, Zq, 0);
        const shifted = render({ ...item, res: [0.5 / Zq, 0] }, Zq, 0);
        const ref = oracleOf(item, Zq, straight);
        let worstShift = 0;
        for (let i = 0; i < shifted.img.length; i++) {
            worstShift = Math.max(worstShift, Math.abs(shifted.img[i] - ref.cov[i]));
        }
        // eslint-disable-next-line no-console
        console.log("F1  the control: half a device pixel of shift reads " + worstShift.toFixed(3)
            + " where the picture itself reads " + rows[0]["worst px"]);
        expect(worstShift).toBeGreaterThan(0.3);
    });

    test("F2 the F40 object against the coverage oracle, every pixel inside the bar", () => {
        const item = itemOf(F40.object);
        const box = loopsBBox(item.loops);
        const rows = [];
        const worstRaw = [];                                // unrounded, for the fine read below
        for (const span of [512, 1024]) {
            const Zq = span / (box.x1 - box.x0);
            const r = render(item, Zq, rows.length);
            const exact = exactInk(item, Zq);
            const o = oracleOf(item, Zq, r);
            worstRaw.push(o.worst);
            rows.push({
                span, Zq: Zq.toExponential(3), "R px": (F40.radius * Zq).toExponential(3),
                "exact px²": +exact.toFixed(2), painted: +r.ink.toFixed(2), oracle: +o.sum.toFixed(2),
                "painted/exact": +(r.ink / exact).toFixed(5), "worst px": +o.worst.toFixed(4),
                "over 1/16": o.over, lit: r.lit, plates: r.nPlates,
            });
            expect(o.worst).toBeLessThan(BAR);              // the derivation
            expect(o.worst).toBeLessThan(RECORDED_F40);     // and what this build actually reads
            expect(o.over / r.lit).toBeLessThan(1e-4);
            expect(Math.abs(r.ink - exact) / exact).toBeLessThan(1e-3);
            expect(Math.abs(r.ink - o.sum) / o.sum).toBeLessThan(1e-3);
        }
        // `culled` is per ITEM: 0 says the packer did not reject the object for missing every
        // plate asked for (it reads 1 when one is). That the window holds ALL of it is the
        // painted/exact bar above, since `platesFor` walks the object's own box.
        expect(pack.packStats.culled).toBe(0);
        // eslint-disable-next-line no-console
        console.table(rows);
        expect(core.coreStats.nonFinite).toBe(0);
        expect(core.coreStats.arcOverTurn).toBe(0);
        // The bar's first term, guarded rather than assumed: a bisection clamped to MAXD breaks
        // `ARC_TOL` by an unbounded amount (`rasterCore.js:438`). Zooming this fixture cannot
        // trip it — 0 at 3.3e14 px of screen radius, because its sweeps are tiny — so read it as
        // a guard, and the counter's own break-check is `raster.arcs.test.js:740`.
        expect(core.coreStats.arcClamped).toBe(0);

        // The span-512 picture once more, for the fine-oracle assertion and the shift control.
        const Zq = 512 / (box.x1 - box.x0);
        const straight = render(item, Zq, 0);

        // "Holds at both oracle flattenings" ASSERTED and not claimed (§15.3's stage 2b ruling):
        // the same picture read against a 64× finer reference, 1/4096 against the build's 1/64.
        // It reads 0.0757 where the 1/64 reference reads 0.0695 — inside the same 0.08 pin, which
        // is why the pin is 0.08 and not 0.07. The greater-than is the guard that `tolPx` is used
        // at all — it reads the UNROUNDED 1/64 worst, because `rows[0]`'s is rounded down to
        // 0.0695 and an ignored argument would clear that by the rounding alone.
        const fine = oracleOf(item, Zq, straight, 1 / 4096);
        // eslint-disable-next-line no-console
        console.log("F2  span 512 against a 1/4096 oracle: worst " + fine.worst.toFixed(4)
            + ", " + fine.over + " pixels over 1/16 of " + straight.lit + " lit, where the build's"
            + " 1/64 reads " + rows[0]["worst px"] + " and " + rows[0]["over 1/16"]);
        expect(fine.worst).toBeLessThan(RECORDED_F40);
        expect(fine.worst).toBeGreaterThan(worstRaw[0]);

        // The control: the same object half a device pixel out, against the oracle where it was.
        const shifted = render({ ...item, res: [0.5 / Zq, 0] }, Zq, 0);
        const ref = oracleOf(item, Zq, straight);
        let worstShift = 0;
        for (let i = 0; i < shifted.img.length; i++) {
            worstShift = Math.max(worstShift, Math.abs(shifted.img[i] - ref.cov[i]));
        }
        // eslint-disable-next-line no-console
        console.log("F2  the control: half a device pixel of shift reads " + worstShift.toFixed(3)
            + " where the picture itself reads " + rows[0]["worst px"]);
        expect(worstShift).toBeGreaterThan(0.3);
    });

    test("F3 the centre never enters the picture, on the largest arc the tree holds", () => {
        const item = itemOf(F40.object);
        const box = loopsBBox(item.loops);
        const Zq = 512 / (box.x1 - box.x0);
        // What the stored centre is worth, and what the browser does with it: |A − C| against r,
        // in float64 as recorded and with C and r rounded to float32, which is the rebuild F40 is
        // about (`docs/OPEN-FLAGS.md` F40: the edge 159 px out at the child frame's deepest zoom).
        const f32 = Math.fround;
        let worstR = 0, worst32 = 0;
        for (const p of item.loops[0]) {
            if (p.line || !isFinite(p.r)) continue;
            for (const e of [p.A, p.B]) {
                worstR = Math.max(worstR, Math.abs(Math.hypot(e[0] - p.C[0], e[1] - p.C[1]) - p.r));
                worst32 = Math.max(worst32, Math.abs(Math.hypot(e[0] - f32(p.C[0]), e[1] - f32(p.C[1])) - f32(p.r)));
            }
        }
        const plain = render(item, Zq, 0);
        let blanked = 0;
        const blind = render(item, Zq, 0, (job) => {
            const g = job.geom;
            for (let k = 0; k < job.nItems; k++) {
                const at = job.meta[k * 8 + 2], end = at + job.meta[k * 8 + 3];
                for (let o = at + 2; o < end;) {
                    const code = g[o], w = code === 0 ? 3 : code === 2 ? 9 : code === 3 ? 16 : 8;
                    if (code === 1 || code === 3) {
                        g[o + 1] = NaN; g[o + 2] = NaN; g[o + 3] = NaN; g[o + 4] = NaN;   // C, r, a0
                        if (code === 3) for (let i = 6; i <= 13; i++) g[o + i] = NaN;      // the cut's own frame
                        blanked++;
                    }
                    o += w;
                }
            }
        });
        // eslint-disable-next-line no-console
        console.log("F3  " + blanked + " arc records blanked (C, r, a0), " + plain.bytes.length + " bytes compared;"
            + " the stored centre misses its own endpoint by " + worstR.toExponential(3) + " units in float64"
            + " and " + worst32.toExponential(3) + " units once C and r are rounded to float32"
            + " (= " + (worst32 * Zq).toExponential(2) + " device px here)");
        expect(blanked).toBe(925);
        expect(Buffer.compare(Buffer.from(plain.bytes), Buffer.from(blind.bytes))).toBe(0);
        expect(plain.ink).toBe(blind.ink);
        expect(plain.lit).toBeGreaterThan(1e5);
        expect(worstR).toBeLessThan(1e-6);                  // float64: the record IS its own circle
        expect(worst32).toBeGreaterThan(1e4 * worstR);      // float32: it is not — F40's own defect

        // The control, so the identity above cannot pass by walking past the records: the same
        // blanking applied to the ONE field of an arc the core does read, its sweep at o + 5.
        const sweepless = render(item, Zq, 0, (job) => {
            const g = job.geom;
            for (let k = 0; k < job.nItems; k++) {
                const at = job.meta[k * 8 + 2], end = at + job.meta[k * 8 + 3];
                for (let o = at + 2; o < end;) {
                    const code = g[o], w = code === 0 ? 3 : code === 2 ? 9 : code === 3 ? 16 : 8;
                    if (code === 1 || code === 3) g[o + 5] = NaN;
                    o += w;
                }
            }
        });
        let diff = 0;
        for (let i = 0; i < plain.bytes.length; i++) if (plain.bytes[i] !== sweepless.bytes[i]) diff++;
        // eslint-disable-next-line no-console
        console.log("F3  the control: the sweep blanked instead moves " + diff + " bytes and "
            + (plain.ink - sweepless.ink).toFixed(2) + " of ink");
        expect(diff).toBeGreaterThan(100);
    });

    test("neither recorded object trips §4.6's coordinate guard: it weighs the drawn box, not an arc's centre or radius", () => {
        // Both fixtures carry arcs whose centre or radius runs past 2.6e5 (3.58e5 and 3.31e7) while
        // their points stay far inside; the core reads A, B and the sweep (F3 above), so the guard
        // reads the box, which bounds every point and bulge (D287).
        const reach = [];
        for (const fx of [FZ, F40]) {
            const item = itemOf(fx.object);
            const box = loopsBBox(item.loops);
            render(item, 512 / (box.x1 - box.x0), 0);
            const e = pack.entryFor(item, CFG);
            let pt = 0, far = 0;
            for (const p of item.loops[0]) {
                pt = Math.max(pt, Math.abs(p.A[0]), Math.abs(p.A[1]), Math.abs(p.B[0]), Math.abs(p.B[1]));
                if (p.C) far = Math.max(far, Math.abs(p.C[0]), Math.abs(p.C[1]), p.r);
            }
            reach.push(e.maxAbs.toExponential(3) + " read against " + pt.toExponential(3) + " of point, " + far.toExponential(3) + " of centre or radius");
            expect(far).toBeGreaterThan(pack.COORD_BOUND);   // the numbers that used to trip it
            expect(e.maxAbs).toBeGreaterThanOrEqual(pt);
            expect(e.maxAbs).toBeLessThan(pack.COORD_BOUND);
        }
        // eslint-disable-next-line no-console
        console.log("the guard on the two fixtures: " + reach.join("; "));
        expect(pack.packStats.overBound).toBe(0);
    });
});
