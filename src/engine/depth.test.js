/* global BigInt */
import * as D from "./depth";

const TOP = Number.MAX_SAFE_INTEGER;   // 2^53 − 1
const P53 = "9007199254740992", P64 = "18446744073709551616", GOOGOL = "1" + "0".repeat(100);
const deep = (s) => D.parse(s);

describe("depth.js — a depth that grows past 2^53, with no limit", () => {
    test("one form per value: a Number inside ±(2^53 − 1), one Deep per value outside", () => {
        expect(D.parse(String(TOP))).toBe(TOP);
        expect(D.parse(`-${TOP}`)).toBe(-TOP);
        expect(D.isBig(deep(P53))).toBe(true);
        expect(D.isBig(TOP)).toBe(false);
        expect(deep(P53)).toBe(deep(P53));   // interned: an equal value is the same object
        expect(D.add(TOP, 1)).toBe(deep(P53));
        expect(D.sub(deep(P53), 1)).toBe(TOP);
        expect(typeof D.sub(deep(P53), 1)).toBe("number");
        expect(D.neg(D.neg(deep(P64)))).toBe(deep(P64));
        const keyed = new Map([[deep(P64), "x"]]);
        expect(keyed.get(D.add(deep("18446744073709551615"), 1))).toBe("x");   // Map keys and `===` agree
        expect(D.isDepth(deep(P64))).toBe(true);
        expect(D.isDepth(2 ** 53)).toBe(false);
        expect(D.isDepth("5")).toBe(false);
    });

    test("add and sub are exact across 2^53, two Numbers included, and carry across limbs", () => {
        expect(D.add(2 ** 52, 2 ** 52 + 1)).toBe(deep("9007199254740993"));   // as Numbers this rounds to 2^53
        expect(D.add(-TOP, -2)).toBe(deep("-9007199254740993"));
        expect(D.sub(-TOP, 2)).toBe(deep("-9007199254740993"));
        expect(D.add(deep(GOOGOL), D.neg(deep(GOOGOL)))).toBe(0);
        expect(D.sub(deep(GOOGOL), D.sub(deep(GOOGOL), 3))).toBe(3);
        expect(D.add(deep("9".repeat(30)), 1)).toBe(deep(`1${"0".repeat(30)}`));
        expect(D.sub(deep(`1${"0".repeat(30)}`), 1)).toBe(deep("9".repeat(30)));
        expect(D.add(deep(`-1${"0".repeat(30)}`), deep(`1${"0".repeat(29)}`))).toBe(deep(`-9${"0".repeat(29)}`));
        expect(D.add(3, 4)).toBe(7);
    });

    test("against BigInt as an oracle: 4,000 random sums, differences and orders, any sign, up to 70 digits", () => {
        let seed = 12345;
        const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
        const num = () => {
            const n = 1 + Math.floor(rnd() * 70), kind = rnd();
            let s;
            if (kind < 0.15) s = "9".repeat(n);                          // every limb full: a carry through all of them
            else if (kind < 0.3) s = `1${"0".repeat(n - 1)}`;            // a borrow through all of them
            else if (kind < 0.4) s = String(1 + Math.floor(rnd() * 3));  // a small step
            else {
                s = String(1 + Math.floor(rnd() * 9));
                for (let i = 1; i < n; i++) s += rnd() < 0.3 ? (rnd() < 0.5 ? "0" : "9") : String(Math.floor(rnd() * 10));
            }
            return rnd() < 0.5 ? `-${s}` : s;
        };
        for (let k = 0; k < 4000; k++) {
            const a = num(), b = rnd() < 0.2 ? a : num(), A = BigInt(a), B = BigInt(b);
            expect(String(D.add(deep(a), deep(b)))).toBe(String(A + B));
            expect(String(D.sub(deep(a), deep(b)))).toBe(String(A - B));
            expect(D.cmp(deep(a), deep(b))).toBe(A < B ? -1 : A > B ? 1 : 0);
        }
    });

    test("a Deep throws on native arithmetic and comparison, and gives its digits as text", () => {
        const d = deep(P64);
        expect(() => d + 1).toThrow(TypeError);
        expect(() => d - 1).toThrow(TypeError);
        expect(() => d < 5).toThrow(TypeError);
        expect(() => -d).toThrow(TypeError);
        expect(() => `x${""}` + d).toThrow(TypeError);   // concatenation is `+`: use String(d) or a template literal
        expect(() => Math.max(d, 1)).toThrow(TypeError);
        expect(String(d)).toBe(P64);
        expect(`${d}`).toBe(P64);
        expect(JSON.stringify({ d })).toBe(`{"d":"${P64}"}`);
        expect(Object.keys({ [d]: 1 })).toEqual([P64]);
        expect(() => D.add(0.5, d)).toThrow(TypeError);
        expect(() => D.add(Infinity, d)).toThrow(TypeError);
        // a structured clone (postMessage, IndexedDB) drops the class: refused, never mistaken for the value
        expect(D.parse({ ...d })).toBeNull();
        expect(() => D.add({ ...d }, 1)).toThrow(TypeError);
    });

    test("compare, min, max, abs, neg on mixed forms; ±Infinity as bounds; a double past 2^53 exactly", () => {
        expect(D.cmp(5, deep(P64))).toBe(-1);
        expect(D.cmp(deep(P64), 5)).toBe(1);
        expect(D.cmp(deep(`-${P64}`), -5)).toBe(-1);
        expect(D.cmp(deep(P64), deep(P64))).toBe(0);
        expect(D.cmp(Infinity, deep(GOOGOL))).toBe(1);
        expect(D.cmp(-Infinity, deep(`-${GOOGOL}`))).toBe(-1);
        expect(D.cmp(2 ** 64, deep(P64))).toBe(0);
        expect(D.cmp(2 ** 64, D.add(deep(P64), 1))).toBe(-1);
        expect(D.cmp(-(2 ** 64), D.sub(deep(`-${P64}`), 1))).toBe(1);
        expect(D.lt(deep(P53), deep(P64)) && D.le(deep(P64), deep(P64)) && D.gt(deep(P64), TOP) && D.ge(-TOP, deep(`-${P53}`))).toBe(true);
        const sorted = [3, deep(`1${"0".repeat(30)}`), deep(`-1${"0".repeat(30)}`), 0, TOP].sort(D.cmp);
        expect(sorted.map(String)).toEqual([`-1${"0".repeat(30)}`, "0", "3", String(TOP), `1${"0".repeat(30)}`]);
        expect(D.min(deep(P64), 7)).toBe(7);
        expect(D.max(deep(P64), 7)).toBe(deep(P64));
        expect(D.min(Infinity, deep(P64))).toBe(deep(P64));
        expect(D.abs(deep(`-${P64}`))).toBe(deep(P64));
        expect(D.abs(-4)).toBe(4);
        expect(Object.is(D.neg(0), -0)).toBe(false);
        expect(D.neg(-TOP)).toBe(TOP);
    });

    test("parse reads what toJSON writes, and refuses anything else", () => {
        for (const d of [0, 1, -1, TOP, -TOP, deep(P53), deep(`-${P53}`), deep(GOOGOL), D.neg(deep(`1${"0".repeat(4000)}`))]) {
            expect(D.parse(D.toJSON(d))).toBe(d);
            expect(D.parse(JSON.parse(JSON.stringify(D.toJSON(d))))).toBe(d);
        }
        expect(D.toJSON(deep(P64))).toBe(P64);
        expect(D.toJSON(12)).toBe(12);
        expect(D.parse("12")).toBe(12);
        for (const bad of ["", " 1", "1 ", "01", "-0", "+5", "1e5", "0x10", "1.5", "--1", "abc", "-", `0${P64}`, 1.5, NaN, Infinity, 2 ** 53, null, undefined, {}, []])
            expect(D.parse(bad)).toBeNull();
    });

    test("no limit: a depth of a million digits parses, carries, compares, prints and reads back", () => {
        const nines = deep("9".repeat(1e6)), next = D.add(nines, 1);
        expect(String(next)).toBe(`1${"0".repeat(1e6)}`);
        expect(D.sub(next, 1)).toBe(nines);
        expect(D.lt(nines, next)).toBe(true);
        expect(D.parse(JSON.parse(JSON.stringify({ d: next })).d)).toBe(next);
        expect(D.log10Abs(next)).toBeCloseTo(1e6, 6);
        expect(D.toNumber(next)).toBe(Infinity);
    });

    test("toNumber and log10Abs at any size", () => {
        expect(D.toNumber(deep(P64))).toBe(2 ** 64);
        expect(D.toNumber(deep(GOOGOL))).toBe(1e100);
        expect(D.toNumber(deep(`-1${"0".repeat(400)}`))).toBe(-Infinity);
        expect(D.toNumber(12)).toBe(12);
        expect(D.log10Abs(1000)).toBeCloseTo(3, 12);
        expect(D.log10Abs(deep(GOOGOL))).toBeCloseTo(100, 10);
        expect(D.log10Abs(deep(`-1${"0".repeat(400)}`))).toBeCloseTo(400, 9);
        expect(D.log10Abs(deep(`3${"0".repeat(5000)}`))).toBeCloseTo(5000 + Math.log10(3), 8);
    });
});
