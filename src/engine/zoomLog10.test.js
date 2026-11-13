/**
 * OPEN-FLAGS F167: the zoom is inScale·4096^depth, which a double holds to 85 levels. The camera carries its log10
 * as well, exact at any depth, and the zoom label, the scale bar and the scale definition read it past that range.
 */
import React from "react";
import { render } from "@testing-library/react";
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { useEngines, mkEngine } from "./__testkit__/harness";
import { zoomLabel } from "../hooks/useKobinEngine";
import {
    computeScale, formatScaleLabel, formatPow10, formatLog10Value, validateScaleDef, scaleAnchorZoom,
    clearDisplayPrefs, unitLog10Meters, BAR_PX_MIN, BAR_PX_MAX,
} from "./scaleBar";
import SciText from "../Components/ui/SciText";

useEngines();
const LOG10_R = Math.log10(4096);

describe("LevelMap.zoomLog10", () => {
    test("is log10 of effectiveZoom while a double holds it, and finite past it", () => {
        const M = new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);
        for (const d of [-3, 0, 1, 5, 40, 84]) {
            const id = M.ensureSpine(d);
            for (const s of [1 / 32, 1, 3.7, 256]) {
                expect(M.zoomLog10(id, s)).toBeCloseTo(Math.log10(M.effectiveZoom(id, s)), 9);
            }
        }
        const deep = M.ensureSpine(130);
        expect(M.effectiveZoom(deep, 1)).toBe(Infinity);
        expect(M.zoomLog10(deep, 2)).toBeCloseTo(Math.log10(2) + 130 * LOG10_R, 9);
    });
});

describe("the zoom label past a double's range", () => {
    test("exponents grouped from 1,000, scientific from a million; the normal range unchanged", () => {
        expect(formatPow10(2, 999)).toBe("2×10⁹⁹⁹");
        expect(formatPow10(1.2, 36123)).toBe("1.2×10³⁶,¹²³");
        expect(formatPow10(5, -36123)).toBe("5×10⁻³⁶,¹²³");
        expect(formatPow10(1, 1000)).toBe("10¹,⁰⁰⁰");
        expect(formatPow10(4, 3612360)).toBe("10^(3.6×10⁶)");
        expect(formatPow10(4, -3612360)).toBe("10^(-3.6×10⁶)");
        expect(formatLog10Value(36123.6)).toBe("4×10³⁶,¹²³");
        expect(formatLog10Value(Math.log10(2.7e303))).toBe("2.7×10³⁰³");
        expect(zoomLabel(2, Math.log10(2))).toBe("2.00×");
        expect(zoomLabel(2.7e303, Math.log10(2.7e303))).toBe(zoomLabel(2.7e303));
        expect(zoomLabel(Infinity, 100 * LOG10_R)).toBe("1.7×10³⁶¹×");
        expect(zoomLabel(Infinity, 10000 * LOG10_R)).toBe("4×10³⁶,¹²³×");
        expect(zoomLabel(Infinity, 2 ** 50 * LOG10_R)).toBe("10^(4.1×10¹⁵)×");
        expect(zoomLabel(0, -400)).toBe("1/10⁴⁰⁰×");
    });

    test("SciText sets a grouped exponent as one superscript and a bracketed one as a nested superscript", () => {
        const a = render(<SciText text="1.2×10³⁶,¹²³×" />).container;
        expect([...a.querySelectorAll("sup")].map((s) => s.textContent)).toEqual(["36,123"]);
        const b = render(<SciText text="10^(3.6×10⁶)×" />).container;
        const outer = b.querySelector("sup");
        expect(outer.textContent).toBe("3.6×106");
        expect(outer.querySelector("sup").textContent).toBe("6");
        expect(b.textContent).toBe("103.6×106×");
    });
});

describe("the engine reports the zoom past 85 levels", () => {
    test("onZoom goes on firing with a changing log once the zoom is Infinity", () => {
        const E = mkEngine(800, 600);
        const seen = [];
        E.onZoom((z, log) => seen.push([z, log]));
        E.cam.set({ activeLevel: 90, inScale: 1, inPanX: 400, inPanY: 300 });
        for (let i = 0; i < 3; i++) E.zoomAt(400, 300, -200);
        const deep = seen.filter(([z]) => z === Infinity);
        expect(deep.length).toBeGreaterThanOrEqual(3);
        expect(new Set(deep.map(([, log]) => log)).size).toBe(deep.length);
        for (const [, log] of deep) expect(log).toBeGreaterThan(90 * LOG10_R);
    });
});

describe("the scale bar past a double's range", () => {
    const DEF = { value: 1, unit: "m", barPx: 100, zoomAt: 1 };
    const fresh = (def) => clearDisplayPrefs(null, def);

    test("unchanged in the normal range, with or without the log", () => {
        const a = computeScale(100, DEF, fresh(DEF));
        const b = computeScale(100, DEF, fresh(DEF), { zoomLog10: 2 });
        expect(b.reading).toEqual(a.reading);
        expect(a.reading.decades).toBeUndefined();
    });

    test.each([100, 130, 10000, 2 ** 40])("at %d levels the reading's bar measures the zoom", (depth) => {
        const zoomLog10 = depth * LOG10_R;
        const { reading } = computeScale(Infinity, DEF, fresh(DEF), { zoomLog10 });
        expect(reading).toBeTruthy();
        expect(Number.isInteger(reading.decades)).toBe(true);
        expect(reading.barPx).toBeGreaterThanOrEqual(BAR_PX_MIN);
        expect(reading.barPx).toBeLessThanOrEqual(BAR_PX_MAX);
        // log10 of the bar's length in metres, over log10 mpp at that zoom, is log10 of its pixels (to 1e-5: the
        // ladder's rung for the Planck length and the catalog's differ in the sixth digit, at any zoom)
        const logMpp = Math.log10(1) + 0 - Math.log10(100) + 0 - zoomLog10;
        const logLen = Math.log10(reading.niceValue) + reading.decades + unitLog10Meters(reading.unit);
        expect(logLen - logMpp).toBeCloseTo(Math.log10(reading.barPx), depth > 1e6 ? 1 : 4);
        expect(formatScaleLabel(reading)).toMatch(depth > 1e5 ? /^10\^\(-/ : /×10⁻|^10⁻/);
    });

    test("a scale set past the range is saved by its log and reads the same", () => {
        const at = 100 * LOG10_R;
        const anchor = scaleAnchorZoom(Infinity, at);
        expect(anchor).toEqual({ zoomAtLog10: at });
        expect(scaleAnchorZoom(42, Math.log10(42))).toEqual({ zoomAt: 42 });
        const def = validateScaleDef(JSON.parse(JSON.stringify({ value: 1, unit: "m", barPx: 100, ...anchor })));
        expect(def).toEqual({ value: 1, unit: "m", barPx: 100, zoomAtLog10: at });
        // read at its own zoom: 1 m over 100 px, wherever it was set
        const { reading } = computeScale(Infinity, def, fresh(def), { zoomLog10: at });
        expect(reading.decades).toBeUndefined();
        expect(formatScaleLabel(reading)).toBe(formatScaleLabel(computeScale(1, DEF, fresh(DEF)).reading));
        expect(validateScaleDef({ value: 1, unit: "m", barPx: 100, zoomAt: Infinity })).toBeNull();
    });
});
