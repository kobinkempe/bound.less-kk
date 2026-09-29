/**
 * raster.ants.test.js — RASTERISER-PLAN §10 stage 5c, tests N1–N14.
 *
 * The painter is a pure function over typed arrays, so every test here reads PIXELS or the
 * numbers the painter returns; none of it needs a DOM, a canvas or an engine.
 *
 * THE LOOK CONSTANTS AND `fitDash`'S ARITHMETIC ARE TRANSCRIBED BELOW, NOT IMPORTED (D66's
 * rule): the module carries its own copy of `svgOverlay.js`'s, so importing that copy here
 * would compare it with itself and hold whatever it holds. The numbers below were read from
 * `Renderer.js` on 2026-09-16 and the line numbers say where.
 */

import {
    OverlayBuffer, paintPhase, dashIntervals, stampSegment, chordStep, selAntScale,
    ANT_PHASES, ANT_STEP_MS, antStats, resetAntStats, SEL_INK_RGB, ANT_LOOK,
} from "./antPaint";
import { circleLoop, rectLoopOf } from "../geometry/antRuns";

// ---- transcribed from Renderer.js, not imported ----------------------------
const T_ANT_W = 2.5, T_ANT_ON = 7, T_ANT_OFF = 5.6;          // Renderer.js:364
const T_FINE_W = 1.75, T_FINE_ON = 3.5, T_FINE_OFF = 2.8;    // Renderer.js:354
const T_THIN_REF = 10, T_THIN_MIN = T_FINE_W / T_ANT_W;      // Renderer.js:374-378
const T_MIN_TRACE_PX = 0.5;                                   // overlays.js:59
const tScale = (inkPx) => (inkPx == null || !isFinite(inkPx) ? 1
    : Math.max(T_THIN_MIN, Math.min(1, inkPx / T_THIN_REF)));
/** `svgOverlay`'s `fitDash` (`Renderer._fitDash` when read): whole cycles onto a run, and a run under one is not fitted. */
function tFit(len, on, off) {
    const cyc = on + off;
    if (len < cyc) return { on, cyc, n: 0 };
    const n = Math.max(1, Math.round(len / cyc));
    const k = len / (n * cyc);
    return { on: on * k, cyc: cyc * k, n };
}

// ---- reading the plane -----------------------------------------------------
const alphaAt = (buf, x, y) => (x < 0 || y < 0 || x >= buf.width || y >= buf.height ? 0
    : buf.data[(y * buf.width + x) * 4 + 3]);
function totalAlpha(buf) { let s = 0; const d = buf.data; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; }
function colAlpha(buf, x) { let s = 0; for (let y = 0; y < buf.height; y++) s += alphaAt(buf, x, y); return s; }
function rowAlpha(buf, y) { let s = 0; for (let x = 0; x < buf.width; x++) s += alphaAt(buf, x, y); return s; }
/** The plane sampled between pixel centres, so a ray is not quantised to whole pixels. */
function bilinear(buf, x, y) {
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
    return alphaAt(buf, x0, y0) * (1 - fx) * (1 - fy) + alphaAt(buf, x0 + 1, y0) * fx * (1 - fy)
        + alphaAt(buf, x0, y0 + 1) * (1 - fx) * fy + alphaAt(buf, x0 + 1, y0 + 1) * fx * fy;
}
/**
 * The band's centre along one pixel ROW: the alpha-weighted mean x, which for a band crossing
 * the row is its centre exactly (N1's column reading, turned on its side). This is stage 1's
 * own method for the ink (A1–A3 read the contour along a row), and it needs no interpolation:
 * a ray sampled between pixel centres reads its own reconstruction error, measured at 0.02–0.08
 * px, which is the bar itself. The floor of THIS measurement on a straight band is 0.010 px.
 */
function rowCentre(buf, y) {
    let w = 0, wx = 0;
    for (let x = 0; x < buf.width; x++) {
        const a = alphaAt(buf, x, y);
        if (a) { w += a; wx += a * (x + 0.5); }
    }
    return { x: w > 0 ? wx / w : NaN, ink: w / 255 };
}
const line = (ax, ay, bx, by) => ({ line: true, A: [ax, ay], B: [bx, by] });
const runOf = (pieces) => ({ pieces, closed: false, len: 0 });
const decOf = (runs, marks, inkPx) => ({ runs, marks: marks || [], inkPx: inkPx == null ? 100 : inkPx });
const VIEW = { k: 1, tx: 0, ty: 0 };   // geometry IS device px, so a test states one unit only

beforeEach(() => resetAntStats());

describe("N1 — a straight dash is exactly its rectangle", () => {
    test("10.5 × 3.75 device px at an integer offset: interior 255, exterior 0, the boundary the fraction", () => {
        const buf = new OverlayBuffer(64, 32);
        // The band of a run at kt = 1, dpr = 1.5: 2.5 × 1.5 = 3.75 device px across, and the
        // lit part of a dash is 7 × 1.5 = 10.5.
        stampSegment(buf, 20, 16, 30.5, 16, 3.75 / 2, SEL_INK_RGB);
        expect(totalAlpha(buf) / 255).toBeCloseTo(10.5 * 3.75, 1);
        expect(Math.abs(totalAlpha(buf) / 255 - 10.5 * 3.75)).toBeLessThan(0.01 * 10.5 * 3.75);
        expect(alphaAt(buf, 25, 15)).toBe(255);          // interior
        expect(alphaAt(buf, 25, 16)).toBe(255);
        expect(alphaAt(buf, 25, 14)).toBe(223);          // the boundary row: 0.875 of a pixel
        expect(alphaAt(buf, 25, 17)).toBe(223);
        expect(alphaAt(buf, 25, 13)).toBe(0);            // exterior
        expect(alphaAt(buf, 25, 18)).toBe(0);
        expect(alphaAt(buf, 19, 16)).toBe(0);            // before the cap
        expect(alphaAt(buf, 31, 16)).toBe(0);            // past it
        expect(alphaAt(buf, 30, 16)).toBe(128);          // the cap's own half pixel
        // the band read as one column, which is how N2 measures it
        expect(colAlpha(buf, 25) / 255).toBeCloseTo(3.75, 2);
        // and the ink is the indicator's own colour, not premultiplied
        const i = (16 * 64 + 25) * 4;
        expect([buf.data[i], buf.data[i + 1], buf.data[i + 2]]).toEqual(SEL_INK_RGB);
    });

    test("a 45° dash, the worst case for the coverage form, is its rectangle to 3 %", () => {
        // The separable form is exact for an axis-aligned edge and an approximation of area for
        // a rotated one, worst at the corners: measured 2.8 % of the rectangle's own area at
        // 45°, under 1 % at 0° and 90°, on a 14 × 3.75 px dash. That is the bound N1 puts on
        // the approximation, and the corners are 1.5 % of an ant's length.
        const L = 14, h = 3.75 / 2;
        const worstOf = [];
        for (const deg of [0, 15, 30, 45, 60, 90]) {
            const buf = new OverlayBuffer(64, 64);
            const th = (deg * Math.PI) / 180;
            stampSegment(buf, 20, 20, 20 + L * Math.cos(th), 20 + L * Math.sin(th), h, SEL_INK_RGB);
            worstOf.push(Math.abs(totalAlpha(buf) / 255 - L * 2 * h) / (L * 2 * h));
        }
        expect(Math.max(...worstOf)).toBeLessThan(0.03);
        expect(worstOf[0]).toBeLessThan(0.01);
        expect(worstOf[5]).toBeLessThan(0.01);
    });
});

describe("N2 — the band and the dash shrink together, and the marks do not", () => {
    const dpr = 1.5;
    test("a run's band is 3.75 / 2.81 / 2.63 / 2.63 device px at inkPx 10 / 7.5 / 5 / 0.5", () => {
        const want = [10, 7.5, 5, 0.5].map((ink) => T_ANT_W * tScale(ink) * dpr);
        expect(want.map((v) => +v.toFixed(2))).toEqual([3.75, 2.81, 2.63, 2.63]);
        const got = [], kts = [];
        for (const inkPx of [10, 7.5, 5, 0.5]) {
            const buf = new OverlayBuffer(200, 40);
            paintPhase(buf, decOf([runOf([line(10, 20, 190, 20)])], [], inkPx), VIEW, 0, { dpr });
            let best = 0;
            for (let x = 0; x < 200; x++) best = Math.max(best, colAlpha(buf, x) / 255);
            got.push(best);
            kts.push(selAntScale(inkPx));
        }
        expect(kts).toEqual([1, 0.75, 0.7, 0.7]);
        for (let i = 0; i < 4; i++) expect(got[i]).toBeCloseTo(want[i], 1);
    });

    test("the dash period scales by the same kt: the run carries its own fitted cycle count", () => {
        for (const inkPx of [10, 7.5, 5, 0.5]) {
            const buf = new OverlayBuffer(400, 40);
            const len = 380;
            const st = paintPhase(buf, decOf([runOf([line(10, 20, 390, 20)])], [], inkPx), VIEW, 0, { dpr });
            const kt = tScale(inkPx);
            const fit = tFit(len, T_ANT_ON * kt * dpr, T_ANT_OFF * kt * dpr);
            expect(st.dashes).toBe(fit.n);
        }
    });

    test("a mark's band stays 1.75 CSS px and its pattern 3.5/2.8 — kt never reaches it", () => {
        const R = 20;                                    // a big dot, so the band is measurable
        const bands = [], counts = [];
        for (const inkPx of [10, 7.5, 5, 0.5]) {
            const buf = new OverlayBuffer(120, 120);
            const st = paintPhase(buf, decOf([], [{ pieces: circleLoop(60, 60, R), closed: true }], inkPx), VIEW, 0, { dpr });
            let sum = 0, rays = 0;
            for (let i = 0; i < 32; i++) {
                const th = (2 * Math.PI * i) / 32;
                let w = 0, peak = 0;
                for (let d = -4; d <= 4; d += 0.02) {
                    const a = bilinear(buf, 60 + (R + d) * Math.cos(th), 60 + (R + d) * Math.sin(th));
                    if (a > peak) peak = a;
                    w += a * 0.02;
                }
                if (peak > 250) { sum += w / 255; rays++; }
            }
            bands.push(sum / rays);
            counts.push(st.dashes);
        }
        // 1.75 CSS px at dpr 1.5 = 2.625 device px, the same at every inkPx
        for (const b of bands) expect(b).toBeCloseTo(T_FINE_W * dpr, 1);
        expect(counts[0]).toBe(counts[1]);
        expect(counts[1]).toBe(counts[2]);
        expect(counts[2]).toBe(counts[3]);
        // and the pattern is the mark's own, unfitted and unscaled: the full-size cycle laid
        // along the circumference, not a whole number of cycles fitted to it
        const len = 2 * Math.PI * R, cyc = (T_FINE_ON + T_FINE_OFF) * dpr;
        expect(counts[0]).toBe(Math.ceil(len / cyc));
        expect(counts[0]).not.toBe(tFit(len, T_FINE_ON * dpr, T_FINE_OFF * dpr).n);
    });
});

describe("N3 — no runt ant", () => {
    test("200 random run lengths: the fitted cycles close on the run's end and every dash is full", () => {
        const on = T_ANT_ON * 1.5, off = T_ANT_OFF * 1.5, cyc = on + off;
        const out = new Float64Array(4096);
        let seed = 7;
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let i = 0; i < 200; i++) {
            const len = cyc + rnd() * (1000 - cyc);
            const fit = tFit(len, on, off);
            expect(fit.n).toBe(Math.round(len / cyc));
            // the run's end IS a cycle boundary — the whole point of fitting
            expect(Math.abs(fit.n * fit.cyc - len)).toBeLessThan(1e-9);
            const m = dashIntervals(len, on, off, 0, out);
            expect(m).toBe(fit.n);
            for (let q = 0; q < m; q++) expect(out[2 * q + 1] - out[2 * q]).toBeCloseTo(fit.on, 9);
            // the last dash ends one gap short of the end, and that gap is the fitted one
            expect(len - out[2 * m - 1]).toBeCloseTo(fit.cyc - fit.on, 9);
        }
    });
});

describe("N4 — a run shorter than a cycle slides, and does not shrink", () => {
    test("a 4 px run carries the full-size pattern, and over the 8 phases its ink is non-monotonic and 0 in one", () => {
        const on = T_ANT_ON * 1.5, off = T_ANT_OFF * 1.5;
        const out = new Float64Array(64);
        const lit = [];
        for (let ph = 0; ph < ANT_PHASES; ph++) {
            const m = dashIntervals(4, on, off, ph, out);
            let s = 0;
            for (let q = 0; q < m; q++) {
                s += out[2 * q + 1] - out[2 * q];
                // full size: a lit stretch is only ever cut by the run's own ends
                expect(out[2 * q + 1] - out[2 * q]).toBeLessThanOrEqual(on + 1e-9);
            }
            lit.push(s);
        }
        expect(Math.min(...lit)).toBe(0);
        expect(Math.max(...lit)).toBeCloseTo(4, 9);
        let ups = 0, downs = 0;
        for (let i = 1; i < lit.length; i++) { if (lit[i] > lit[i - 1]) ups++; if (lit[i] < lit[i - 1]) downs++; }
        expect(ups).toBeGreaterThan(0);
        expect(downs).toBeGreaterThan(0);
        // painted, not only arithmetic: the same 4 px run on the plane
        const painted = [];
        for (let ph = 0; ph < ANT_PHASES; ph++) {
            const buf = new OverlayBuffer(40, 20);
            paintPhase(buf, decOf([runOf([line(10, 10, 14, 10)])]), VIEW, ph, { dpr: 1.5 });
            painted.push(totalAlpha(buf));
        }
        expect(Math.min(...painted)).toBe(0);
        expect(Math.max(...painted)).toBeGreaterThan(0);
    });
});

describe("N5 — a sub-pixel mark is a solid dot 2.25 CSS px across, and it blinks", () => {
    for (const dpr of [1, 1.5]) {
        test("at dpr " + dpr + ": " + (2 * (T_MIN_TRACE_PX / 2) + T_FINE_W) + " CSS px = " + ((2 * (T_MIN_TRACE_PX / 2) + T_FINE_W) * dpr).toFixed(3) + " device px", () => {
            // `_selDecide` floors a frame's mark at SEL_MIN_TRACE_PX = 0.5 RETAINED px, so the
            // dot's radius on screen is 0.25 CSS px; the mark's band is SEL_FINE_W = 1.75 CSS.
            const rCss = T_MIN_TRACE_PX / 2, acrossCss = 2 * rCss + T_FINE_W;
            expect(acrossCss).toBe(2.25);
            const across = acrossCss * dpr;
            const cx = 20.5, cy = 20.5;                   // a pixel centre, so the row is clean
            const shown = [];
            for (let ph = 0; ph < ANT_PHASES; ph++) {
                const buf = new OverlayBuffer(41, 41);
                const st = paintPhase(buf, decOf([], [{ pieces: circleLoop(cx, cy, rCss * dpr), closed: true }], 0.4), VIEW, ph, { dpr });
                shown.push({ ph, total: totalAlpha(buf), w: rowAlpha(buf, 20) / 255, solid: alphaAt(buf, 20, 20), stamps: st.stamps });
            }
            expect(shown.some((e) => e.total === 0)).toBe(true);          // it blinks
            // The phases where the WHOLE speck is inside one dash — its outline is shorter than
            // the pattern, which is what makes it blink rather than crawl. There it is ONE
            // stamp, a disc of the circle's radius plus the band's half-width.
            const peak = Math.max(...shown.map((e) => e.total));
            const full = shown.filter((e) => e.total === peak);
            expect(full.length).toBeGreaterThan(0);
            for (const e of full) {
                expect(e.solid).toBe(255);                                // solid, not a ring
                expect(e.stamps).toBe(1);
                expect(Math.abs(e.w - across) / across).toBeLessThan(0.02);
            }
            // and the phases in between are smaller, never fatter than a FULL one: a blink,
            // not a pulse. Measured at dpr 1.5: 3.376 / 2.012 / 0 / 0 / 1.929 / 2.514 / 3.376
            // / 3.376 device px across the centre row.
            const fullW = full[0].w;
            for (const e of shown) expect(e.w).toBeLessThanOrEqual(fullW + 1e-9);
        });
    }

    test("a mark with NO `closed` flag is the same disc: the geometry says the loop closes", () => {
        // `_selDecide` may ship a mark as its pieces alone; without the flag the speck is a ring
        // of twelve chords, measured 2.616 device px across against 3.376 — 22 % short (D134).
        const dpr = 1.5, rCss = T_MIN_TRACE_PX / 2, across = (2 * rCss + T_FINE_W) * dpr;
        const shown = [];
        for (let ph = 0; ph < ANT_PHASES; ph++) {
            const buf = new OverlayBuffer(41, 41);
            const st = paintPhase(buf, decOf([], [{ pieces: circleLoop(20.5, 20.5, rCss * dpr) }], 0.4), VIEW, ph, { dpr });
            shown.push({ total: totalAlpha(buf), w: rowAlpha(buf, 20) / 255, solid: alphaAt(buf, 20, 20), stamps: st.stamps });
        }
        const peak = Math.max(...shown.map((e) => e.total));
        const full = shown.filter((e) => e.total === peak);
        expect(full.length).toBeGreaterThan(0);
        for (const e of full) {
            expect(e.stamps).toBe(1);
            expect(e.solid).toBe(255);
            expect(Math.abs(e.w - across) / across).toBeLessThan(0.02);
        }
        // and a caller that says `closed: false` is still obeyed: the loop is left open
        const opened = new OverlayBuffer(41, 41);
        const st = paintPhase(opened, decOf([], [{ pieces: circleLoop(20.5, 20.5, rCss * dpr), closed: false }], 0.4),
            VIEW, shown.indexOf(full[0]), { dpr });
        expect(st.stamps).toBeGreaterThan(1);
    });
});

describe("N6 — an arc is painted within 1/16 device px of the true circle", () => {
    // Measured, worst row at each radius: −0.0457, −0.0424, −0.0483, −0.0271 and +0.0077 device
    // px, against the 0.0625 bar and this measurement's own 0.010 floor. The error does not
    // grow with R, which is the property the ink's P1 asserts and the ants inherit.
    for (const R of [8, 40, 200, 2000, 2e5]) {
        test("screen radius " + R + " px", () => {
            // The arc sits about angle 0, where its tangent is vertical and a pixel row crosses
            // the band; the centre is off the plane for the big radii, as the ink's own arc
            // tests have it. The lean is capped at 30°, so the row reading is within 1.15× of
            // the perpendicular one and is corrected by cos(φ) anyway.
            const half = Math.min(Math.PI / 6, 120 / R);
            const W = 200, H = Math.min(600, Math.ceil(2 * R * Math.sin(half)) + 20);
            const cx = W - 20 - R, cy = H / 2;
            const buf = new OverlayBuffer(W, H);
            const pt = (th) => [cx + R * Math.cos(th), cy + R * Math.sin(th)];
            const arc = { A: pt(-half), B: pt(half), C: [cx, cy], r: R, a0: -half, sweep: 2 * half };
            const st = paintPhase(buf, decOf([runOf([arc])], [], 100), VIEW, 0, { dpr: 1.5 });
            expect(st.stamps).toBeGreaterThan(0);
            // The chord rule: a dash is subdivided only as far as sqrt(R/2) asks. A dash is
            // stamped whole, so at 2e5 px of radius — where one chord is 316 px and a dash is
            // 10.5 — the count is the DASHES; the bound is the sum of the two.
            expect(st.stamps).toBeLessThanOrEqual(st.dashes + Math.ceil(2 * R * half / chordStep(R)));
            const band = T_ANT_W * 1.5;
            let worst = 0, rows = 0;
            for (let y = 0; y < H; y++) {
                const { x, ink } = rowCentre(buf, y);
                if (!(ink > 0)) continue;
                const dy = y + 0.5 - cy;
                if (Math.abs(dy) > R) continue;
                const phi = Math.asin(dy / R);
                const want = band / Math.cos(phi);
                if (Math.abs(ink - want) > 0.02 * want) continue;   // a dash cap, or the arc's end
                const err = (x - (cx + Math.sqrt(R * R - dy * dy))) * Math.cos(phi);
                rows++;
                if (Math.abs(err) > Math.abs(worst)) worst = err;
            }
            expect(rows).toBeGreaterThan(4);
            expect(Math.abs(worst)).toBeLessThan(1 / 16);
        });
    }

    test("the chord count is the rule at the BAND's outer edge, which is where the notch is", () => {
        // A chord subtending dth leaves the band's outer edge short by (R + h)(1 − cos(dth/2)),
        // not the centreline's own R(1 − cos(dth/2)): at R = 3 with a 1.875 half-band the
        // centreline rule leaves 0.101 px of notch against the 0.0625 bar, and the outer rule
        // 0.0623. One unfitted dash, so the count is the rule and nothing else.
        const h = T_ANT_W * 1.5 / 2, len = 8;
        for (const [R, outer, centre] of [[3, 9, 7], [8, 5, 4]]) {
            expect(Math.ceil(len / chordStep((R * R) / (R + h)))).toBe(outer);
            expect(Math.ceil(len / chordStep(R))).toBe(centre);
            const buf = new OverlayBuffer(200, 200);
            const sweep = len / R, a0 = -Math.PI / 2 - sweep / 2, cx = 100, cy = 100 + R;
            const pt = (th) => [cx + R * Math.cos(th), cy + R * Math.sin(th)];
            const arc = { A: pt(a0), B: pt(a0 + sweep), C: [cx, cy], r: R, a0, sweep };
            const st = paintPhase(buf, decOf([runOf([arc])], [], 100), VIEW, 0, { dpr: 1.5 });
            expect(st.dashes).toBe(1);
            expect(st.stamps).toBe(outer);
        }
    });

    test("a radius at or under 1/16 device px terminates: one disc while it is lit, nothing when it is not", () => {
        const buf = new OverlayBuffer(20, 20);
        for (const r of [1 / 16, 1 / 64, 1e-6]) {
            resetAntStats();
            const st = paintPhase(buf, decOf([], [{ pieces: circleLoop(10.5, 10.5, r), closed: true }], 0.4), VIEW, 0, { dpr: 1 });
            expect(st.stamps).toBe(1);                   // the band has closed over the centre
            expect(st.nonFinite).toBe(0);
            expect(alphaAt(buf, 10, 10)).toBe(255);
            expect(rowAlpha(buf, 10) / 255).toBeCloseTo(2 * (r + T_FINE_W / 2), 1);
        }
        // Below that, the whole outline is shorter than a rounding error of the cycle and the
        // dash is not placed at all — a dash of no length paints nothing under `butt` caps
        // (`Renderer.js:1586`). The descent still terminates, which is what this pins.
        resetAntStats();
        const st = paintPhase(buf, decOf([], [{ pieces: circleLoop(10.5, 10.5, 1e-300), closed: true }], 0.4), VIEW, 0, { dpr: 1 });
        expect(st.stamps).toBe(0);
        expect(st.dashes).toBe(0);
        expect(st.nonFinite).toBe(0);
        expect(totalAlpha(buf)).toBe(0);

        // The CHORD path, which the discs above never reach: a run whose first piece is an arc of
        // device radius 1e-170 and whose second is a 180 px line. `R·R` underflows to 0, so
        // `chordStep(R²/(R + h))` is 0 and the chord count would be `ceil(len/0)` = Infinity —
        // `MIN_ARC_R` is what makes it one chord. Break-checked on an esbuild bundle in plain
        // node: with the guard removed the phase DID NOT RETURN in 8 s (stage 1's D67/D68 class).
        resetAntStats();
        const tiny = 1e-170;
        const wide = new OverlayBuffer(200, 100);
        const arc = { A: [10, 50], B: [10 + tiny, 50], C: [10, 50 - tiny], r: tiny, a0: Math.PI / 2, sweep: 1 };
        const st2 = paintPhase(wide, decOf([runOf([arc, line(10, 50, 190, 50)])], [], 100), VIEW, 0, { dpr: 1.5 });
        expect(st2.stamps).toBe(10);      // ten fitted cycles, one stamp each; the arc joins the first
        expect(st2.dashes).toBe(10);
        expect(st2.nonFinite).toBe(0);
    });
});

describe("N7 — crossing runs paint solid, never dark", () => {
    test("two runs crossing at 90°: the crossing is 255 and a pixel two partial covers reach is the max, not the sum", () => {
        const buf = new OverlayBuffer(64, 64);
        // Both dashes reach the crossing: each run is 20 px, fitted to one cycle of 20 with a
        // lit 11.1, so the horizontal covers x 20…31.1 and the vertical y 22…33.1.
        const dec = decOf([runOf([line(20, 32, 40, 32)]), runOf([line(26, 22, 26, 42)])], [], 100);
        paintPhase(buf, dec, VIEW, 0, { dpr: 1.5 });
        const d = buf.data;
        for (let i = 3; i < d.length; i += 4) expect(d[i]).toBeLessThanOrEqual(255);
        expect(alphaAt(buf, 25, 31)).toBe(255);          // inside both bands
        expect(alphaAt(buf, 26, 32)).toBe(255);
        // A pixel on the boundary ROW of one band and the boundary COLUMN of the other: each
        // covers 0.875 of it, so `max` reads 223 and a sum would read 255.
        expect(alphaAt(buf, 24, 30)).toBe(223);
        expect(alphaAt(buf, 27, 33)).toBe(223);
        const partials = [];
        for (let y = 29; y <= 34; y++) for (let x = 23; x <= 28; x++) {
            const a = alphaAt(buf, x, y);
            if (a > 0 && a < 255) partials.push(a);
        }
        expect(partials.length).toBeGreaterThan(0);
        expect(partials).toContain(223);
        // The property itself, over the whole plane: the crossing is the pixelwise MAX of the
        // two runs painted alone. With `+` the 223 pixels above read 255 and this counts them.
        const one = new OverlayBuffer(64, 64), two = new OverlayBuffer(64, 64);
        paintPhase(one, decOf([runOf([line(20, 32, 40, 32)])], [], 100), VIEW, 0, { dpr: 1.5 });
        paintPhase(two, decOf([runOf([line(26, 22, 26, 42)])], [], 100), VIEW, 0, { dpr: 1.5 });
        let over = 0, lit = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
            const a = alphaAt(buf, x, y), m = Math.max(alphaAt(one, x, y), alphaAt(two, x, y));
            if (a !== m) over++;
            if (a > 0) lit++;
        }
        expect(over).toBe(0);
        expect(lit).toBeGreaterThan(0);
    });
});

describe("N7's other half — a join is filled, not beaded", () => {
    test("a dash spanning a 90° corner of two pieces is one polyline with a miter, not two capped rectangles", () => {
        const buf = new OverlayBuffer(100, 100);
        // 45 px then 35 px, so a fitted dash straddles the corner at (65, 60) rather than
        // starting on it. `_antPath` sets no `stroke-linejoin`, so today's ants miter (SVG's
        // own default) — this is that join.
        const dec = decOf([runOf([line(20, 60, 65, 60), line(65, 60, 65, 25)])], [], 100);
        paintPhase(buf, dec, VIEW, 0, { dpr: 1.5 });
        // The band's own two edges cross at (66.875, 61.875), the miter's point: the pixel
        // inside it is covered. Stamped piece by piece, or with the ramp overlap alone, it is 0.
        expect(alphaAt(buf, 66, 61)).toBeGreaterThan(200);
        expect(alphaAt(buf, 65, 61)).toBe(255);
        // and it is bounded: nothing is painted past the miter's own reach
        expect(alphaAt(buf, 68, 61)).toBe(0);
        expect(alphaAt(buf, 66, 63)).toBe(0);
        // the join along the band itself is solid, not half-covered
        for (let y = 59; y <= 60; y++) expect(alphaAt(buf, 64, y)).toBe(255);
    });

    test("a closed run's SEAM is the same join: the corner it paints equals the corner an open run paints", () => {
        // `loopRuns` returns one CLOSED run for every loop with no seam cut (antRuns.js:83) and
        // `runPathData` ends it with "Z", which Chrome miters today — so the wrapped dash's two
        // halves must meet at the seam vertex (20, 20) exactly as they meet in mid-run.
        const S = 20, E = 260, total = 4 * (E - S);
        const on = T_ANT_ON * 1.5, off = T_ANT_OFF * 1.5;        // kt = 1 at inkPx 100, dpr 1.5
        const fit = tFit(total, on, off);
        const ph = 6;                                            // one of the four phases that wrap
        const p = (ph / ANT_PHASES) * fit.cyc;
        const head = p - fit.cyc + fit.on;    // lit from the seam along the FIRST side
        const tail = fit.cyc - p;             // lit into the seam along the LAST side
        expect(head).toBeGreaterThan(1);
        expect(tail).toBeGreaterThan(1);

        const loop = new OverlayBuffer(280, 280);
        paintPhase(loop, decOf([{ pieces: rectLoopOf({ x0: S, y0: S, x1: E, y1: E }), closed: true, len: 0 }], [], 100),
            VIEW, ph, { dpr: 1.5 });
        // the same corner, the same two lengths, in the MIDDLE of an open run: one lit stretch,
        // 10.45 px, shorter than a cycle, so it is unfitted and covers the run whole at phase 0
        const open = new OverlayBuffer(280, 280);
        paintPhase(open, decOf([runOf([line(S, S + tail, S, S), line(S, S, S + head, S)])], [], 100),
            VIEW, 0, { dpr: 1.5 });

        let worst = 0, ink = 0, inkOpen = 0;
        for (let y = S - 5; y <= S + 5; y++) for (let x = S - 5; x <= S + 5; x++) {
            const a = alphaAt(loop, x, y), b = alphaAt(open, x, y);
            if (Math.abs(a - b) > worst) worst = Math.abs(a - b);
            // Exact within 3 px of the corner. Further out the two differ by at most one 8-bit
            // step at the dash's own far cap: the loop's last interval starts at `i·C + p` and
            // the control's at `total − (C − p)`, the same number to 1e-13 px.
            if (Math.abs(x - S) <= 3 && Math.abs(y - S) <= 3) expect(a).toBe(b);
            ink += a; inkOpen += b;
        }
        expect(worst).toBeLessThanOrEqual(1);
        expect(Math.abs(ink - inkOpen) / 255).toBeLessThan(0.02);
        // The miter's own point is at (20 − h, 20 − h) = (18.125, 18.125). With the seam capped
        // instead of joined these four read 0 / 112 / 112 / 128 and the 11 × 11 block carries
        // 36.97 px of ink against 42.54; the numbers below are what the interior join paints.
        expect(alphaAt(loop, 18, 18)).toBe(223);
        expect(alphaAt(loop, 19, 18)).toBe(255);
        expect(alphaAt(loop, 18, 19)).toBe(255);
        expect(alphaAt(loop, 19, 19)).toBe(255);
        expect(ink / 255).toBeGreaterThan(40);
        // and bounded: the miter reaches h·tan(45°) = 1.875 px past the corner and no further
        expect(alphaAt(loop, 17, 17)).toBe(0);
    });
});

describe("N8 — nothing is allocated per phase", () => {
    test("16 consecutive phases: one buffer, one data array, the allocation counter 0", () => {
        const buf = new OverlayBuffer(400, 400);
        const runs = [];
        for (let i = 0; i < 20; i++) runs.push(runOf([line(10, 10 + i * 15, 380, 20 + i * 15)]));
        const dec = decOf(runs, [{ pieces: circleLoop(200, 200, 0.4), closed: true }], 100);
        paintPhase(buf, dec, VIEW, 0, { dpr: 1.5 });     // the first phase may size the scratch
        const data = buf.data, allocs = antStats.allocs;
        for (let ph = 0; ph < 16; ph++) paintPhase(buf, dec, VIEW, ph, { dpr: 1.5 });
        expect(antStats.allocs).toBe(allocs);
        expect(buf.data).toBe(data);
        // and a resize that changes nothing reallocates nothing
        expect(buf.resize(400, 400)).toBe(false);
        expect(buf.data).toBe(data);
        expect(antStats.allocs).toBe(allocs);
    });

    test("dashIntervals takes the caller's `out` and returns the count it needs (§2.7 FC5)", () => {
        const small = new Float64Array(4);               // room for two pairs
        const need = dashIntervals(1000, 10.5, 8.4, 0, small);
        expect(need).toBe(Math.round(1000 / 18.9));
        expect(need).toBeGreaterThan(2);
        expect(small[0]).toBe(0);                        // what fits is written
        expect(small[3]).toBeGreaterThan(0);
        const big = new Float64Array(need * 2);
        expect(dashIntervals(1000, 10.5, 8.4, 0, big)).toBe(need);
        expect(big[2 * need - 1]).toBeGreaterThan(900);
        // a growth inside the module IS counted, so N8's 0 means something
        const buf = new OverlayBuffer(64, 64);
        resetAntStats();
        const many = [];
        for (let i = 0; i < 4000; i++) many.push(line(i * 20, 0, (i + 1) * 20, 0));
        paintPhase(buf, decOf([runOf(many)]), VIEW, 0, { dpr: 1.5 });
        expect(antStats.allocs).toBeGreaterThan(0);
    });
});

describe("N9 — the clear is bounded", () => {
    test("after a phase covering rows 100–140, clearTouched writes only those rows", () => {
        const buf = new OverlayBuffer(200, 300);
        paintPhase(buf, decOf([runOf([line(10, 120, 190, 120)])]), VIEW, 0, { dpr: 1.5 });
        const d = buf.dirty;
        expect(d.y0).toBeGreaterThan(110);
        expect(d.y1).toBeLessThan(130);
        expect(Number.isInteger(d.x0) && Number.isInteger(d.y0) && Number.isInteger(d.x1) && Number.isInteger(d.y1)).toBe(true);
        const y0 = d.y0, y1 = d.y1;
        buf.data.fill(77);                               // a sentinel everywhere
        buf.clearTouched();
        for (let y = 0; y < 300; y++) {
            const inside = y >= y0 && y < y1;
            expect(alphaAt(buf, 100, y)).toBe(inside ? 0 : 77);
        }
        // and the rect the canvas must take: the cleared band, then what the next phase paints
        expect(buf.dirty.y0).toBe(y0);
        expect(buf.dirty.y1).toBe(y1);
    });

    test("a phase clears the last one, so a moved run leaves nothing behind", () => {
        const buf = new OverlayBuffer(200, 200);
        paintPhase(buf, decOf([runOf([line(10, 50, 190, 50)])]), VIEW, 0, { dpr: 1.5 });
        expect(rowAlpha(buf, 50)).toBeGreaterThan(0);
        paintPhase(buf, decOf([runOf([line(10, 150, 190, 150)])]), VIEW, 0, { dpr: 1.5 });
        expect(rowAlpha(buf, 50)).toBe(0);
        expect(rowAlpha(buf, 150)).toBeGreaterThan(0);
    });
});

describe("N10 — the window bounds the work, not the picture", () => {
    test("a run whose analytic length is 1e8 px stamps only what its retained pieces carry", () => {
        const buf = new OverlayBuffer(400, 200);
        // F39's own fixture in miniature: the decision cut this run to 1,600 px of retained
        // edge, and `len` still says what the whole picture would be. The painter measures the
        // pieces. (The 350,958-dash stall was 111 M px of picture reaching the dasher.)
        // eight connected pieces, 200 px each, as a run's pieces always are: consecutive
        // pieces share an endpoint (`geometry/antRuns.js` cuts a loop, it never breaks it)
        const pieces = [];
        for (let i = 0; i < 8; i++) {
            const y = 10 + i * 20;
            pieces.push(i % 2 === 0 ? line(10, y, 190, y) : line(190, y, 10, y));
            if (i < 7) pieces.push(i % 2 === 0 ? line(190, y, 190, y + 20) : line(10, y, 10, y + 20));
        }
        const run = { pieces, closed: false, len: 1e8 };
        const st = paintPhase(buf, decOf([run], [], 100), VIEW, 0, { dpr: 1.5 });
        const cyc = (T_ANT_ON + T_ANT_OFF) * 1.5;
        const total = 8 * 180 + 7 * 20;          // what the PIECES carry, not what `len` says
        expect(st.dashes).toBe(Math.round(total / cyc));
        // one stamp a dash, plus one for each piece boundary a dash spans
        expect(st.stamps).toBeGreaterThanOrEqual(st.dashes);
        expect(st.stamps).toBeLessThanOrEqual(st.dashes + pieces.length - 1);
        expect(st.stamps).toBeLessThan(200);
    });

    test("a piece whose device box misses the plane is not stamped, and the rest keep their phase", () => {
        const buf = new OverlayBuffer(200, 100);
        const near = [line(10, 50, 190, 50)];
        const far = [line(10, 50, 190, 50), line(1e6, 1e6, 1e6 + 180, 1e6)];
        const a = paintPhase(buf, decOf([runOf(near)]), VIEW, 0, { dpr: 1.5 });
        expect(a.offPlane).toBe(0);
        const bufB = new OverlayBuffer(200, 100);
        const b = paintPhase(bufB, decOf([runOf(far)]), VIEW, 0, { dpr: 1.5 });
        expect(b.offPlane).toBe(1);                           // counted, not silently walked
        expect(b.stamps).toBeLessThanOrEqual(a.stamps + 1);   // the far piece paints nothing
        expect(b.dashes).toBeGreaterThan(a.dashes);           // but it still takes its length
    });
});

describe("N11 — nothing is refused silently", () => {
    test("a non-finite coordinate counts, paints nothing, and the run's other pieces still paint", () => {
        const buf = new OverlayBuffer(200, 100);
        const good = paintPhase(buf, decOf([runOf([line(10, 30, 190, 30)])]), VIEW, 0, { dpr: 1.5 });
        expect(good.nonFinite).toBe(0);
        const bufB = new OverlayBuffer(200, 100);
        const mixed = [line(10, 30, 190, 30), { line: true, A: [10, NaN], B: [190, 60] }];
        const st = paintPhase(bufB, decOf([runOf(mixed)]), VIEW, 0, { dpr: 1.5 });
        expect(st.nonFinite).toBe(1);
        expect(rowAlpha(bufB, 30)).toBeGreaterThan(0);        // the good piece is painted
        for (let y = 50; y < 70; y++) expect(rowAlpha(bufB, y)).toBe(0);
        // an arc refused for its centre, its start angle or its sweep
        for (const bad of [{ A: [10, 10], B: [20, 20], C: [Infinity, 0], r: 10, a0: 0, sweep: 1 },
            { A: [10, 10], B: [20, 20], C: [50, 50], r: 10, a0: NaN, sweep: 1 },
            { A: [10, 10], B: [20, 20], C: [50, 50], r: 10, a0: 0, sweep: NaN }]) {
            const b2 = new OverlayBuffer(100, 100);
            const s2 = paintPhase(b2, decOf([runOf([bad])]), VIEW, 0, { dpr: 1.5 });
            expect(s2.nonFinite).toBe(1);
            expect(totalAlpha(b2)).toBe(0);
        }
    });

    test("a run with no pieces, and a view that is not finite, are refused and counted", () => {
        const buf = new OverlayBuffer(100, 100);
        // an SVG-mode decision, whose runs carry a path string instead of their pieces
        expect(paintPhase(buf, decOf([{ d: "M0,0 L10,10", len: 14 }]), VIEW, 0, { dpr: 1 }).refused).toBe(1);
        expect(paintPhase(buf, decOf([runOf([line(1, 1, 9, 9)])]), { k: NaN, tx: 0, ty: 0 }, 0, { dpr: 1 }).refused).toBe(1);
        expect(totalAlpha(buf)).toBe(0);
    });
});

describe("N12 — a phase is a pure function", () => {
    test("twice at the same phase into two fresh buffers gives byte-identical planes", () => {
        const dec = decOf([runOf([line(10, 30, 190, 45)]),
            runOf([{ A: [30, 60], B: [80, 60], C: [55, 60], r: 25, a0: Math.PI, sweep: Math.PI }])],
        [{ pieces: circleLoop(120, 70, 0.4), closed: true }], 6);
        for (const ph of [0, 3, 7]) {
            const a = new OverlayBuffer(200, 100), b = new OverlayBuffer(200, 100);
            paintPhase(a, dec, { k: 1.25, tx: 3.5, ty: -2.25 }, ph, { dpr: 1.5 });
            paintPhase(b, dec, { k: 1.25, tx: 3.5, ty: -2.25 }, ph, { dpr: 1.5 });
            expect(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer))).toBe(true);
        }
        // and the same buffer reused paints the same bytes as a fresh one
        const reused = new OverlayBuffer(200, 100);
        paintPhase(reused, dec, { k: 1.25, tx: 3.5, ty: -2.25 }, 2, { dpr: 1.5 });
        paintPhase(reused, dec, { k: 1.25, tx: 3.5, ty: -2.25 }, 5, { dpr: 1.5 });
        const fresh = new OverlayBuffer(200, 100);
        paintPhase(fresh, dec, { k: 1.25, tx: 3.5, ty: -2.25 }, 5, { dpr: 1.5 });
        expect(Buffer.from(reused.data.buffer).equals(Buffer.from(fresh.data.buffer))).toBe(true);
    });
});

describe("N13 — the import list", () => {
    test("antPaint.js imports geometry/antRuns.js and nothing else", () => {
        const fs = require("fs"), path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "antPaint.js"), "utf8");
        const from = [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
        expect(from).toEqual(["../geometry/antRuns"]);
        expect(src).not.toMatch(/require\(/);
    });
});

describe("N14 — the crawl is today's crawl", () => {
    test("eight distinct phases: phase 0 and phase 8 are byte-identical", () => {
        expect(ANT_PHASES).toBe(8);
        expect(ANT_STEP_MS).toBe(50);
        // `.8s steps(16,end)` with `--ao = -(cyc·k)·2` travels TWO cycles in 16 steps.
        expect(0.8 / (ANT_STEP_MS / 1000)).toBe(16);
        expect(16 / 2).toBe(ANT_PHASES);
        const dec = decOf([runOf([line(10, 30, 390, 30)])], [], 100);
        const a = new OverlayBuffer(400, 60), b = new OverlayBuffer(400, 60);
        paintPhase(a, dec, VIEW, 0, { dpr: 1.5 });
        paintPhase(b, dec, VIEW, 8, { dpr: 1.5 });
        expect(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer))).toBe(true);
    });

    test("a step advances each run by ITS OWN fitted cycle ÷ 8, and two runs 1.9× apart close together", () => {
        const on = T_ANT_ON * 1.5, off = T_ANT_OFF * 1.5, cyc = on + off;
        const out = new Float64Array(512);
        // A fitted cycle is `len / round(len/cyc)`, so 1.49 cycles (n = 1) and 1.58 (n = 2) are
        // 1.886× apart — the widest two fitted runs can be.
        const lenA = 1.49 * cyc, lenB = 1.58 * cyc;
        const fitA = tFit(lenA, on, off), fitB = tFit(lenB, on, off);
        expect(fitA.n).toBe(1); expect(fitB.n).toBe(2);
        expect(fitA.cyc / fitB.cyc).toBeCloseTo(1.886, 2);
        /** `fitDash`'s pattern at one phase, transcribed: starts at i·C + phase·C/8. */
        const expected = (len, fit, ph) => {
            const p = (ph % ANT_PHASES) * fit.cyc / ANT_PHASES, list = [];
            for (let i = Math.floor(-p / fit.cyc); i * fit.cyc + p < len; i++) {
                const s = i * fit.cyc + p, e = s + fit.on;
                if (e <= 0) continue;
                const a = Math.max(0, s), b = Math.min(len, e);
                if (b > a + 1e-9 * fit.cyc) list.push(a, b);
            }
            return list;
        };
        for (const [len, fit] of [[lenA, fitA], [lenB, fitB]]) {
            for (let ph = 0; ph <= ANT_PHASES; ph++) {
                const want = expected(len, fit, ph);
                const m = dashIntervals(len, on, off, ph, out);
                expect(m * 2).toBe(want.length);
                for (let i = 0; i < want.length; i++) expect(out[i]).toBeCloseTo(want[i], 9);
            }
            // eight steps and the run is exactly where it started: it closed its cycle
            const m0 = dashIntervals(len, on, off, 0, out);
            const first = Array.from(out.slice(0, m0 * 2));
            const m8 = dashIntervals(len, on, off, 8, out);
            expect(m8).toBe(m0);
            for (let i = 0; i < m0 * 2; i++) expect(out[i]).toBeCloseTo(first[i], 9);
        }
        // With a GLOBAL cycle the two runs would step by the same amount, and the longer of
        // them would not close on phase 8. That expectation is written out and must FAIL.
        const globalStep = expected(lenA, { on: fitA.on, cyc, n: fitA.n }, 1);
        const shipped = dashIntervals(lenA, on, off, 1, out);
        let same = shipped * 2 === globalStep.length;
        if (same) for (let i = 0; i < globalStep.length; i++) if (Math.abs(out[i] - globalStep[i]) > 1e-9) same = false;
        expect(same).toBe(false);
    });
});

describe("the plane itself", () => {
    test("OverlayBuffer: bytes = w·h·4, resize reallocates only on a real change, dirty is a screenRect", () => {
        const buf = new OverlayBuffer(10, 10);
        expect(buf.bytes).toBe(400);
        expect(buf.data.length).toBe(400);
        const d0 = buf.data;
        expect(buf.resize(10, 10)).toBe(false);
        expect(buf.data).toBe(d0);
        expect(buf.resize(20, 10)).toBe(true);
        expect(buf.data).not.toBe(d0);
        expect(buf.bytes).toBe(800);
        expect(buf.dirty).toBe(buf.dirty);                // one object, mutated in place
        expect(Object.keys(buf.dirty).sort()).toEqual(["x0", "x1", "y0", "y1"]);
    });

    test("ANT_LOOK is the look the layer draws its screen-edge runs with", () => {
        expect(ANT_LOOK).toEqual({ W: T_ANT_W, ON: T_ANT_ON, OFF: T_ANT_OFF, FINE_W: T_FINE_W, FINE_ON: T_FINE_ON, FINE_OFF: T_FINE_OFF });
        expect(SEL_INK_RGB).toEqual([210, 80, 48]);
        expect(chordStep(200)).toBeCloseTo(10, 9);
    });
});
