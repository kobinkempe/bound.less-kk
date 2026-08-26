/**
 * FL — the lattice arithmetic, which everything else stands on.
 *
 * The design bible's whole claim is that a move becomes integer arithmetic on
 * an address, so registration is exact BY CONSTRUCTION rather than by luck.
 * That claim is only worth what these tests are worth: if the digit expansion
 * loses a bit here, it loses it everywhere downstream, silently, and the
 * failure shows up as a star that is no longer on the intersection it was drawn
 * on — five levels away from anything a person would think to look at.
 */
import {
    BASE, ENTER, EXIT, R, W, G, HALF_R, T_UNIT, MAX_CANVAS_PX,
    cellEdge, cellCentre, cellOf, carryDigit, displacementDigits, applyDigits, digitValue,
} from "./frameLattice";

const isPow2 = (x) => x > 0 && Number.isInteger(Math.log2(x));

describe("FL-1 — the constants are what the bible locked", () => {
    test("every one is a power of two, and the ratios come out exact", () => {
        for (const v of [BASE, ENTER, EXIT, R, W, G, T_UNIT]) expect(isPow2(v)).toBe(true);
        expect(R).toBe(4096);
        expect(W).toBe(131072);
        expect(G).toBe(32);
        expect(W / R).toBe(G);
        expect(ENTER / BASE).toBe(R);
        expect(EXIT * 2).toBe(BASE);          // the 2x hysteresis, kept
        expect(T_UNIT).toBe(8192);
        expect(MAX_CANVAS_PX).toBe(4096);     // invariant 1 holds to 4K unaided
    });

    test("scaling across a level moves only the exponent", () => {
        // The reason for powers of two at all: a cross-level transform must not
        // spend an ulp per crossing. 3000 did; 4096 cannot.
        for (const x of [1, 3, 7.5, 1234.5678, 1 / 3, Math.PI]) {
            expect(x * R / R).toBe(x);
            expect(x * R * R / (R * R)).toBe(x);
        }
    });
});

describe("FL-2 — a cell's edge is exact for every digit it can hold", () => {
    test("t is an integer across the whole balanced range", () => {
        for (const i of [-HALF_R, -2047, -1, 0, 1, 1000, HALF_R - 1]) {
            const e = cellEdge(i, -i);
            expect(Number.isInteger(e.t.x)).toBe(true);
            expect(Number.isInteger(e.t.y)).toBe(true);
            expect(e.s).toBe(ENTER);
        }
    });

    test("the child's own extent is exactly [-W/2, W/2), centred on its index", () => {
        for (const i of [-2048, -37, 0, 5, 2047]) {
            const e = cellEdge(i, 0);
            const toChild = (p) => (p * e.s + e.t.x) / BASE;
            expect(toChild(i * G - G / 2)).toBe(-W / 2);
            expect(toChild(i * G + G / 2)).toBe(W / 2);
            expect(toChild(i * G)).toBe(0);                 // the origin IS the centre
            expect(cellCentre(i, 0).x).toBe(i * G);
        }
    });

    test("the world origin is a fixed point of the whole descent", () => {
        // With cells running [i*G, (i+1)*G) the origin lands on a CORNER and
        // the descent walks to the corner of every frame for ever. Centred, it
        // stays put, and the spine is a chain of concentric cells.
        let p = 0;
        for (let d = 0; d < 8; d++) {
            const c = cellOf(p, p);
            expect(c).toEqual({ i: 0, j: 0 });
            const e = cellEdge(c.i, c.j);
            p = (p * e.s + e.t.x) / BASE;
        }
        expect(p).toBe(0);
    });

    test("child cells tile the parent with no gap and no overlap", () => {
        // The whole reason alignment is load-bearing: two frames can never cover
        // the same ground with different origins.
        for (const i of [-5, 0, 17]) {
            const a = cellEdge(i, 0), b = cellEdge(i + 1, 0);
            const seam = i * G + G / 2;                       // where the two meet
            expect((seam * a.s + a.t.x) / BASE).toBe(W / 2);   // a's right edge
            expect((seam * b.s + b.t.x) / BASE).toBe(-W / 2);  // b's left edge
        }
        // and the whole balanced digit range spans exactly one parent frame
        expect((HALF_R - 1) * G + G / 2 - (-HALF_R * G - G / 2)).toBe(W);
    });
});

describe("FL-3 — cellOf is a division, not a search (P4, and the F-B fix)", () => {
    test("the same point always lands in the same cell — the NEAREST one", () => {
        for (const x of [0, 31.999, 32, -0.001, -32, 1e4, -1e4]) {
            expect(cellOf(x, 0)).toEqual(cellOf(x, 0));
        }
        expect(cellOf(0, 0)).toEqual({ i: 0, j: 0 });
        expect(cellOf(15.9, 0).i).toBe(0);
        expect(cellOf(16.1, 0).i).toBe(1);
        expect(cellOf(32, 0).i).toBe(1);
        expect(cellOf(-0.0001, 0).i).toBe(-0);
        expect(cellOf(-32, 0).i).toBe(-1);
        expect(cellOf(-47.9, 0).i).toBe(-1);
        expect(cellOf(-48.1, 0).i).toBe(-2);
    });

    test("a 1 px aim error cannot change the answer unless it crosses a cell edge", () => {
        // F-B measured: 1 px of aim error at the top minted new frames from
        // depth 3 onward. Here the answer is a floor of a division, so an error
        // only matters when it straddles a boundary — and then it is correct
        // for it to matter.
        const x = 8;                     // mid-cell
        const px = 1 / ENTER;            // one screen pixel at the deepest zoom
        expect(cellOf(x, 0).i).toBe(cellOf(x + px, 0).i);
        expect(cellOf(x, 0).i).toBe(cellOf(x - px, 0).i);
    });
});

describe("FL-4 — carries", () => {
    test("a digit normalizes into the balanced range", () => {
        expect(carryDigit(0)).toEqual({ carry: 0, digit: 0 });
        expect(carryDigit(2047)).toEqual({ carry: 0, digit: 2047 });
        expect(carryDigit(-2048)).toEqual({ carry: 0, digit: -2048 });
        expect(carryDigit(2048)).toEqual({ carry: 1, digit: -2048 });
        expect(carryDigit(-2049)).toEqual({ carry: -1, digit: 2047 });
        expect(carryDigit(R + 5)).toEqual({ carry: 1, digit: 5 });
        expect(carryDigit(-R - 5)).toEqual({ carry: -1, digit: -5 });
    });

    test("carry + digit always reconstructs the input", () => {
        for (let i = -9000; i <= 9000; i += 7) {
            const c = carryDigit(i);
            expect(c.carry * R + c.digit).toBe(i);
            expect(c.digit).toBeGreaterThanOrEqual(-HALF_R);
            expect(c.digit).toBeLessThan(HALF_R);
        }
    });
});

describe("FL-5 — the digit expansion is EXACT", () => {
    // This is the property the whole design rests on. If it holds, a family's
    // members take identical coarse digits and their relative positions cannot
    // move; if it fails by one ulp at depth 1, that ulp is R^k units deep.
    const reconstruct = (digits, rest, n) => {
        // Sum the digits back up into the units of depth D+n.
        let total = 0;
        for (let k = 0; k < digits.length; k++) total += digits[k] * G * Math.pow(R, n - k);
        return total + rest;
    };

    test("digits + rest reconstruct the displacement to the last bit", () => {
        const cases = [30, 100, 1, 0.5, -30, -1e-4, 1e-9, 12345.678, 1 / 3, Math.PI * 1000];
        for (const d of cases) {
            for (const n of [1, 2, 3, 5, 8]) {
                const { digits, rest } = displacementDigits(d, n);
                // in depth-(D+n) units the displacement is d * R^n
                expect(reconstruct(digits, rest, n)).toBe(d * Math.pow(R, n));
            }
        }
    });

    test("the rest is always under one cell at the level it stopped on", () => {
        for (const d of [30, -30, 1e4, -1e4, 0.001, 4095.9]) {
            for (const n of [1, 3, 6]) {
                const { rest } = displacementDigits(d, n);
                expect(Math.abs(rest)).toBeLessThan(W);
            }
        }
    });

    test("the bible's own worked example (section 9.1) comes out", () => {
        // "A 100-unit nudge ... digit 0 at rung 0, remainder ... " — the numbers
        // there were for W=38,400 and base 3000. Re-derived on the locked
        // constants: 100 units is 100/32 = 3.125 cells one level down.
        const { digits, rest } = displacementDigits(100, 3);
        expect(digits[0]).toBe(3);                       // 3 whole child cells
        expect(digits[1]).toBe(512);                     // 0.125 * 4096
        expect(digits[2]).toBe(0);
        expect(rest).toBe(0);                            // terminates, exactly
        // and it really is 100 units: 3*32 + 512*32/4096 = 96 + 4
        expect(digits[0] * G + digits[1] * G / R).toBe(100);
    });

    test("a displacement finer than one cell still produces digits (section 6.8)", () => {
        // Kobin: "if you move something 9,000,000 points at level 5, there
        // should be a noticeable move at level 3." The address carries rungs
        // below the level the move was made at; nothing vanishes.
        const tiny = 1e-6;
        const { digits, rest } = displacementDigits(tiny, 4);
        expect(digits.some((a) => a !== 0) || rest !== 0).toBe(true);
        let total = 0;
        for (let k = 0; k < digits.length; k++) total += digits[k] * G * Math.pow(R, 4 - k);
        expect(total + rest).toBe(tiny * Math.pow(R, 4));
    });

    test("a slow drag adds up to exactly what a fast one does", () => {
        // M-4, and the reason the residue bookkeeping of the old
        // erase-tile-window bible section 5.4 can be deleted. Forty 1-unit steps
        // and one 40-unit step must produce the SAME digits.
        const fast = displacementDigits(40, 4);
        let acc = [0, 0, 0, 0], accRest = 0;
        for (let n = 0; n < 40; n++) {
            const step = displacementDigits(1, 4);
            for (let k = 0; k < 4; k++) acc[k] += step.digits[k];
            accRest += step.rest;
        }
        // normalize the accumulated digits the way applyDigits would
        let carry = 0;
        for (let k = 3; k >= 0; k--) { const c = carryDigit(acc[k] + carry); acc[k] = c.digit; carry = c.carry; }
        expect(carry * R + acc[0]).toBe(fast.digits[0]);
        for (let k = 1; k < 4; k++) expect(acc[k]).toBe(fast.digits[k]);
        expect(accRest).toBe(fast.rest * 40 === 0 ? 0 : accRest);   // both are 0 here
        expect(fast.rest).toBe(0);
    });
});

describe("FL-6 — digitValue", () => {
    test("a digit at the object's own depth is one whole frame", () => {
        expect(digitValue(5, 5)).toBe(W);
        expect(digitValue(5, 4)).toBe(G);          // one level coarser: G parent units
        expect(digitValue(6, 5)).toBe(G);          // one level below the object: G of its units
        expect(digitValue(7, 5)).toBe(G / R);      // two below: a sub-unit refinement
    });
});

describe("FL-7 — applyDigits", () => {
    test("a move inside the range just adds", () => {
        const r = applyDigits([0, 0, 0], 0, [3, 512, 0]);
        expect(r.chain).toEqual([3, 512, 0]);
        expect(r.carry).toBe(0);
        expect(r.residue).toBe(0);
    });

    test("an overflowing digit carries into its parent", () => {
        const r = applyDigits([0, 2000, 0], 0, [0, 100, 0]);
        expect(r.chain).toEqual([1, 2100 - R, 0]);
        expect(r.carry).toBe(0);
    });

    test("a carry off the coarse end is reported, never dropped", () => {
        const r = applyDigits([2047], 0, [5]);
        expect(r.carry).toBe(1);
        expect(r.chain).toEqual([2052 - R]);
    });

    test("digits below the chain become a sub-cell residue, in the last level's units", () => {
        // chain covers depths root+1..root+2; a third digit is one level finer
        // than the object's home and is worth exactly G of the object's units.
        const r = applyDigits([0, 0], 0, [0, 0, 7]);
        expect(r.chain).toEqual([0, 0]);
        expect(r.residue).toBe(7 * G);
        const r2 = applyDigits([0, 0], 0, [0, 0, 0, 3]);
        expect(r2.residue).toBe(3 * G / R);
    });

    test("everything a family shares moves it identically", () => {
        // Registration, in one assertion: two members whose chains agree above
        // the moved level take the SAME digits there, so their relative address
        // is untouched whatever the move was.
        const a = applyDigits([5, 10, 20, 30], 1, [7, 3]);
        const b = applyDigits([5, 10, 99, 44], 1, [7, 3]);
        expect(a.chain[0]).toBe(b.chain[0]);
        expect(a.chain[1]).toBe(b.chain[1]);
        expect(a.chain[2] - 20).toBe(b.chain[2] - 99);   // same delta, deeper down
    });
});
