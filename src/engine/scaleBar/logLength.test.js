/**
 * Log-length spine smoke — L11: round-trips and extreme magnitudes never throw.
 */

import {
    targetLogLen,
    log10,
    safeExp10,
    mppFromDef,
    logLenFromNice,
} from "./logMath";
import { resolveReading } from "./resolve";
import { unitLog10Meters, unitMeters } from "./catalog";
import { BAR_PX_TARGET, BAR_PX_MIN, BAR_PX_MAX } from "./constants";
import { coldSession, expectBarInBounds, mppForReading } from "./testSupport";

describe("scaleBar/logLength (L11)", () => {
    test("targetLogLen ↔ mpp round-trip at everyday scale", () => {
        const mpp = mppForReading(1, "m");
        const tl = targetLogLen(mpp);
        expect(Number.isFinite(tl)).toBe(true);
        expect(tl).toBeCloseTo(Math.log10(BAR_PX_TARGET * mpp), 10);
        const recoveredMpp = safeExp10(tl) / BAR_PX_TARGET;
        expect(recoveredMpp).toBeCloseTo(mpp, 8);
    });

    test("logLenFromNice matches log10(nice) + unitLog10Meters", () => {
        for (const [nice, unit] of [
            [1, "m"],
            [200, "yd"],
            [0.25, "mi"],
            [1, "ℓP"],
            [5000, "Qpc"],
        ]) {
            const logLen = logLenFromNice(nice, unit);
            const expected = Math.log10(nice) + unitLog10Meters(unit);
            expect(Number.isFinite(logLen)).toBe(true);
            expect(logLen).toBeCloseTo(expected, 8);
        }
    });

    test("unitLog10Meters agrees with log10(unitMeters) for finite everyday units", () => {
        for (const unit of ["in", "ft", "yd", "mi", "mm", "m", "km"]) {
            const fromLog = unitLog10Meters(unit);
            const fromLin = Math.log10(unitMeters(unit));
            expect(fromLog).toBeCloseTo(fromLin, 10);
        }
    });

    test("extreme zoom-out past Qpc: finite reading, bar in bounds, no throw", () => {
        const session = coldSession("standard-metric");
        const base = mppForReading(5000, "Qpc");
        const extremeMpp = base * 1e12;
        expect(() => {
            const reading = resolveReading(extremeMpp, session, { ignoreIncumbent: true });
            expect(reading).not.toBeNull();
            expect(Number.isFinite(reading.value)).toBe(true);
            expect(Number.isFinite(reading.barPx)).toBe(true);
            expect(reading.barPx).toBeGreaterThan(0);
            expect(reading.barPx).toBeGreaterThanOrEqual(BAR_PX_MIN);
            expect(reading.barPx).toBeLessThanOrEqual(BAR_PX_MAX);
            expect(Number.isFinite(reading.value) && reading.value !== 0).toBe(true);
        }).not.toThrow();
    });

    test("extreme zoom-in past Planck floor: finite reading, bar in bounds, no throw", () => {
        const session = coldSession("standard-metric");
        const base = mppForReading(0.05, "qℓP");
        const extremeMpp = base / 1e12;
        expect(() => {
            const reading = resolveReading(extremeMpp, session, { ignoreIncumbent: true });
            expectBarInBounds(reading);
            expect(Number.isFinite(reading.value)).toBe(true);
            expect(reading.value).not.toBe(0);
        }).not.toThrow();
    });

    test("mppFromDef log-safe path round-trips with resolve at anchor zoom", () => {
        const scaleDef = { value: 1, unit: "in", barPx: BAR_PX_TARGET, zoomAt: 100 };
        const mpp = mppFromDef(scaleDef, 100);
        expect(Number.isFinite(mpp)).toBe(true);
        expect(mpp).toBeGreaterThan(0);
        const reading = resolveReading(mpp, coldSession("standard-imperial"), {
            ignoreIncumbent: true,
        });
        expectBarInBounds(reading);
        expect(reading.unit).toBe("in");
        expect(reading.value).toBe(1);
    });

    test("log10 / safeExp10 never yield NaN/Infinity for extreme magnitudes", () => {
        const samples = [1e-300, 1e-100, 1, 1e100, 1e300];
        for (const x of samples) {
            const l = log10(x);
            expect(Number.isFinite(l)).toBe(true);
            const back = safeExp10(l);
            expect(Number.isFinite(back)).toBe(true);
            expect(back).toBeGreaterThan(0);
        }
        expect(() => safeExp10(400)).not.toThrow();
        expect(() => safeExp10(-400)).not.toThrow();
        expect(Number.isFinite(safeExp10(400))).toBe(true);
        expect(Number.isFinite(safeExp10(-400))).toBe(true);
    });

    test("scene jump: coarse → fine mpp stays consistent (no throw, bounds held)", () => {
        const session = coldSession("ultra-standard-imperial");
        const coarse = mppForReading(1, "pc");
        const fine = mppForReading(1, "µm");
        expect(() => {
            const a = resolveReading(coarse, session, { ignoreIncumbent: true });
            const b = resolveReading(fine, session, { ignoreIncumbent: true });
            expectBarInBounds(a);
            expectBarInBounds(b);
            expect(a.ladderId).toBe("ultra-standard-imperial");
            expect(b.ladderId).toBe("ultra-standard-imperial");
        }).not.toThrow();
    });
});
