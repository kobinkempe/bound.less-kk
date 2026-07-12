/**
 * Nice grammar — constraint 3 / 3a (1/2/5, plain↔sci, inch 1/32).
 */

import { INCH_FRACTIONS, PLAIN_MIN, PLAIN_MAX, NICE_MANTISSAS } from "./constants";
import { niceValuesForUnit, formatScaleNumber, formatSciValue } from "./nice";
import { formatScaleLabel } from "./format";

describe("scaleBar/nice (constraint 3 / 3a)", () => {
    test("INCH_FRACTIONS includes 1/8, 1/16, 1/32", () => {
        const labels = INCH_FRACTIONS.map((f) => f.label);
        expect(labels).toEqual(expect.arrayContaining(["1/8", "1/16", "1/32"]));
        expect(INCH_FRACTIONS.find((f) => f.label === "1/32").value).toBeCloseTo(1 / 32, 10);
    });

    test("T-IN / 3a: inch nice window includes 1/32 then decimals at .01 band", () => {
        const vals = niceValuesForUnit("in", { magLo: 0.005, magHi: 2 });
        const labels = vals.filter((v) => v.form === "fraction").map((v) => v.label);
        expect(labels).toEqual(expect.arrayContaining(["1/8", "1/16", "1/32"]));

        const numbers = vals.map((v) => v.value);
        expect(numbers).toContain(0.01);
        // Fractions occupy (.02, 1); 0.1 / 0.2 style decimals in that band are absent.
        expect(numbers).not.toContain(0.1);
        expect(numbers).not.toContain(0.2);
    });

    test("non-inch units use only 1/2/5 mantissas inside a decade window", () => {
        const vals = niceValuesForUnit("m", { magLo: 0.5, magHi: 50 });
        for (const v of vals) {
            const exp = Math.floor(Math.log10(v.value));
            const mant = v.value / 10 ** exp;
            const nearest = NICE_MANTISSAS.reduce((best, m) =>
                Math.abs(m - mant) < Math.abs(best - mant) ? m : best,
            );
            expect(Math.abs(mant - nearest)).toBeLessThan(1e-9);
        }
    });

    test("plain↔sci handoff thresholds are PLAIN_MIN / PLAIN_MAX", () => {
        expect(PLAIN_MIN).toBe(0.001);
        expect(PLAIN_MAX).toBe(5000);
        const around = niceValuesForUnit("Qpc", { magLo: 1000, magHi: 20000 });
        const plain = around.filter((v) => v.form === "plain");
        const sci = around.filter((v) => v.form === "sci");
        expect(plain.every((v) => v.value <= PLAIN_MAX * (1 + 1e-9))).toBe(true);
        expect(sci.every((v) => v.value > PLAIN_MAX || v.value < PLAIN_MIN)).toBe(true);
        expect(sci.length).toBeGreaterThan(0);
    });

    test("formatScaleNumber uses PLAIN_MIN / PLAIN_MAX thresholds", () => {
        expect(formatScaleNumber(0.001)).not.toMatch(/10/);
        expect(formatScaleNumber(5000)).not.toMatch(/10/);
        // Outside plain band → sci
        expect(formatScaleNumber(0.0001)).toMatch(/10/);
        expect(formatScaleNumber(10000)).toMatch(/10/);
    });

    test("inch grammar lock: .01/.02 decimals, fractions, plain 0.25/0.5 (I-10)", () => {
        const vals = niceValuesForUnit("in", { magLo: 0.005, magHi: 2 });
        const numbers = vals.map((v) => v.value);
        expect(numbers).toContain(0.01);
        expect(numbers).toContain(0.25);
        expect(numbers).toContain(0.5);
        expect(vals.find((v) => v.value === 0.25)?.form).toBe("plain");
        expect(vals.find((v) => v.value === 0.5)?.form).toBe("plain");
    });

    test("FMT: formatSciValue(5) is plain; never emits lone ×10⁰", () => {
        expect(formatSciValue(5)).toBe("5");
        expect(formatSciValue(5)).not.toMatch(/×10/);
        expect(formatSciValue(1)).toBe("1");
        expect(formatScaleLabel({ value: 5, unit: "ly" })).toBe("5 ly");
        // Renormalize m≥10 after toPrecision (e.g. 9.99e9 → not 10×10⁹).
        const sci = formatSciValue(9.99e9);
        expect(sci).not.toMatch(/^10×10/);
        expect(sci).not.toMatch(/×10⁰$/);
    });
});
