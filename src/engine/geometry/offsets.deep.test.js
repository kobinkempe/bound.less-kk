// A move made far below a native's home lands deep in its table (compact-lattice stage 2): every loop reads the table's
// depths, not its length, and a depth past an array's last index (2^32 − 2) is a plain key the loops still read.
import { W } from "../frameLattice";
import {
    addOffset, cloneBelow, decodeBelow, eachDigit, encodeBelow, hasDigits, hasOffsets, internBelow, residual, sameBelow,
    shiftAt, shiftDown, shiftUp,
} from "./offsets";

const DEPTHS = [0, 3, 70, 1e9, 5e9, 1e13];
const table = (depths, base = 0) => {
    let t;
    depths.forEach((k, n) => { t = addOffset(t, k + base, 37.5 + n, -12.25 * (n + 1)).below; });
    return t;
};
const digitsOf = (sh, from) => {
    const out = [];
    eachDigit(sh, (m, d) => out.push([m - from, d[0], d[1]]));
    return out;
};

describe("tables deep below a home", () => {
    test("every depth is read: present, copied, encoded in order, decoded back", () => {
        const t = table(DEPTHS);
        expect(hasOffsets(t)).toBe(true);
        expect(encodeBelow(t).map((e) => e[0])).toEqual(DEPTHS);
        expect(encodeBelow(cloneBelow(t))).toEqual(encodeBelow(t));
        expect(encodeBelow(decodeBelow(encodeBelow(t)))).toEqual(encodeBelow(t));
        expect(hasOffsets(table([5e9]))).toBe(true);   // a lone plain key, its array otherwise empty
        expect(encodeBelow(decodeBelow([[1e13, 1, 2]]))).toEqual([[1e13, 1, 2]]);
    });

    test("equal tables are the same shared value, whatever order they were made in", () => {
        const a = table(DEPTHS), b = table([...DEPTHS].reverse());
        expect(sameBelow(a, b)).toBe(false);   // the offsets differ by depth: the values follow the order
        const c = decodeBelow([...encodeBelow(a)].reverse());
        expect(sameBelow(a, c)).toBe(true);
        expect(internBelow(a)).toBe(internBelow(c));
        const d = cloneBelow(a);
        d[1e13] = [d[1e13][0] + 1, d[1e13][1]];
        expect(sameBelow(a, d)).toBe(false);
        expect(sameBelow(d, a)).toBe(false);
        expect(sameBelow(table([5e9]), undefined)).toBe(false);
    });

    test("promotion and a kid's table move every depth by one level or k", () => {
        const t = table(DEPTHS);
        expect(encodeBelow(shiftUp(t)).map((e) => e[0])).toEqual(DEPTHS.map((k) => k + 1));
        expect(encodeBelow(shiftDown(t, 4)).map((e) => e[0]).slice(1)).toEqual(DEPTHS.filter((k) => k > 4).map((k) => k - 4));
    });

    test("a move far below the home: its remainder and digits are a shallow move's, shifted", () => {
        const D = 5e9 - 3;
        for (const v of [1000.5, -61234.75, W * 0.49]) {
            const shallow = addOffset(undefined, 3, v, -v / 3).below, deep = addOffset(undefined, 3 + D, v, -v / 3).below;
            expect(residual(deep, 3 + D)).toEqual(residual(shallow, 3));
            for (const down of [1, 2, 5]) {
                const s = shiftAt(shallow, 3 + down), q = shiftAt(deep, 3 + D + down);
                expect(q.rem).toEqual(s.rem);
                expect(q.carry).toEqual(s.carry);
                expect(digitsOf(q, D)).toEqual(digitsOf(s, 0));
                expect(hasDigits(q)).toBe(hasDigits(s));
            }
        }
    });
});
