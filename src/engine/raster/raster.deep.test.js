/**
 * raster.deep.test.js — D1–D3 of RASTERISER-PLAN §9.2: problem 2, the one the window chop
 * (`_chopPx = 2^18`) existed for. A piece whose ends reach far outside the plate must paint the
 * same pixels as the same picture built from near ones, at every depth.
 *
 * The bound is §7.2's: byte-identical at 1e3 and 1e7 plate-local px, which spans the whole real
 * range; at 1e19 the far-outside cases are exact and a CROSSING piece is not asserted identical,
 * because the crossing `x0 + (y − y0)·dx/dy` is a cancellation of two numbers whose ulp is 2048
 * there. White ink on black paper, so a stored byte is 255 × coverage.
 */

import * as core from "./rasterCore";
import * as pack from "./rasterPack";
import { PLATE_PX } from "./plate";
import { Loop } from "../geometry/loop";

const TW = core.TW, TH = core.TH;
const CFG = { enter: 256, cullPx: 0.3, fadeLoPx: 0.15, arcTolerancePx: 0.25 };

/** A closed loop of straight pieces, in the `geometry/loop.js` grammar. */
function lineLoop(ring) {
    const nums = [ring[0][0], ring[0][1]];
    for (let i = 1; i < ring.length; i++) nums.push(0, ring[i][0], ring[i][1]);
    return new Loop(Float64Array.from(nums));
}
/** The same ring with its LAST piece written as a cut line (code 2), which carries P–Q and sa/sb. */
function cutLoop(ring) {
    const nums = [ring[0][0], ring[0][1]];
    for (let i = 1; i < ring.length - 1; i++) nums.push(0, ring[i][0], ring[i][1]);
    const a = ring[ring.length - 2], b = ring[ring.length - 1];
    nums.push(2, a[0], a[1], b[0], b[1], 0, 1, b[0], b[1]);
    return new Loop(Float64Array.from(nums));
}
const shape = (id, loops) => ({ type: "shape", id, loops, color: "#ffffff", opacity: 1 });

function paint(loops, Zq, plate) {
    const job = pack.packJob([shape(1, loops)], {
        plates: Int32Array.from(plate || [0, 0]), q: 0, Zq, dpr: 1, cfg: CFG, paper: [0, 0, 0],
    });
    const out = new Uint8ClampedArray(TW * TH * 4);
    if (job.nItems) core.renderPlate(job, 0, out);
    else core.fillPaper(out, 0, 0, 0);
    return out;
}
function firstDiff(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { at: i, px: (i >> 2) % TW + "," + ((i >> 2) / TW | 0), a: a[i], b: b[i] };
    return null;
}
const alphaAt = (out, x, y) => out[(y * TW + x) * 4];

beforeEach(() => {
    pack.clearPackCaches();
    pack.resetPackStats();
    for (const k of Object.keys(core.coreStats)) core.coreStats[k] = 0;
});

describe("problem 2 — how far a piece's ends reach does not change the picture", () => {
    /** A band of vertical thickness `t` whose sides run out to ±R, crossing the plate. */
    const horizontalBand = (R, y, t) => [[-R, y], [R, y], [R, y + t], [-R, y + t]];
    /** The same band at 45°, so the crossing arithmetic is exercised rather than a horizontal. */
    const diagonalBand = (R, c, t) => [[-R, -R + c], [R, R + c], [R, R + c + t], [-R, -R + c + t]];

    test("D1 a piece with ends at 1e3 and at 1e7 plate-local px paints byte-identical plates", () => {
        const near = paint([lineLoop(horizontalBand(1e3, 137.37, 240.53))], 1);
        const far = paint([lineLoop(horizontalBand(1e7, 137.37, 240.53))], 1);
        expect(firstDiff(near, far)).toBe(null);
        expect(alphaAt(near, 256, 300)).toBe(255);
        expect(alphaAt(near, 256, 100)).toBe(0);
        expect(alphaAt(near, 256, 137)).toBe(161);              // the band's own antialiased edge, 0.63 of a pixel

        const nearD = paint([lineLoop(diagonalBand(1e3, 137.37, 240.53))], 1);
        const farD = paint([lineLoop(diagonalBand(1e7, 137.37, 240.53))], 1);
        expect(firstDiff(nearD, farD)).toBe(null);
        expect(alphaAt(nearD, 100, 300)).toBe(255);

        // and with the last side written as a CUT LINE (code 2, F43), which carries its canonical
        // P–Q: the core reads the record's end and the picture is the same
        const nearC = paint([cutLoop(diagonalBand(1e3, 137.37, 240.53))], 1);
        const farC = paint([cutLoop(diagonalBand(1e7, 137.37, 240.53))], 1);
        expect(firstDiff(nearC, farC)).toBe(null);
        expect(firstDiff(nearC, nearD)).toBe(null);
        expect(core.coreStats.nonFinite).toBe(0);
    });

    test("D1 at 1e19 the far-outside cases are exact; a crossing piece is not asserted identical", () => {
        const empty = new Uint8ClampedArray(TW * TH * 4);
        core.fillPaper(empty, 0, 0, 0);

        // dropped: wholly right of the plate
        const dropped = paint([lineLoop([[1e19, 10], [2e19, 10], [2e19, 400], [1e19, 400]])], 1);
        expect(firstDiff(dropped, empty)).toBe(null);

        // left-substituted: a band from −1e19 to +1e19 covers its rows exactly
        const over = paint([lineLoop(horizontalBand(1e19, 100, 100))], 1);
        for (const x of [0, 1, 255, 510, 511]) {
            expect(alphaAt(over, x, 150)).toBe(255);
            expect(alphaAt(over, x, 50)).toBe(0);
            expect(alphaAt(over, x, 300)).toBe(0);
        }

        // crossing from 1e19: nothing is refused and nothing throws, and this is what the picture
        // actually does — measured, not assumed. The y-clip computes x0 − y0·dx/dy, and at
        // y0 = −1e19 the ulp is 2048, so the band's two sides round to the SAME crossing and the
        // band cancels to nothing. That is why §7.2 does not ask for byte-identity here, and why
        // the packer's guard at 2.6e5 frame units exists.
        const crossing = paint([lineLoop(diagonalBand(1e19, 137.37, 240.53))], 1);
        expect(core.coreStats.nonFinite).toBe(0);
        let inked = 0;
        for (let i = 0; i < TW * TH; i++) if (crossing[i * 4] > 0) inked++;
        expect(inked).toBe(0);
        const R = 1e19, c = 137.37;
        const y0 = -R + c;
        expect(y0).toBe(-R);                                    // 137.37 is under half an ulp and is gone
        expect(-R - y0 * 1).toBe(0);                            // the crossing reads 0 where the truth is 137.37
        // and inside the plan's own bound the same arithmetic keeps its digits
        expect(-1e5 - (-1e5 + c) * 1).toBeCloseTo(-c, 9);
    });

    test("D1b the packer logs a render-list coordinate past §4.6's bound, and still paints it", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const inside = paint([lineLoop(horizontalBand(2.5e5, 137.37, 240.53))], 1);
            expect(pack.packStats.overBound).toBe(0);
            expect(alphaAt(inside, 256, 300)).toBe(255);

            pack.clearPackCaches();
            pack.resetPackStats();
            const outside = paint([lineLoop(horizontalBand(2.7e5, 137.37, 240.53))], 1);
            expect(pack.packStats.overBound).toBe(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/past the bound/);
            expect(firstDiff(outside, inside)).toBe(null);      // logged, never dropped
        } finally {
            warn.mockRestore();
        }
    });

    test("D2 the same shape at 2^56 engine units and at unit scale paints the same plate", () => {
        // A power of two, so the scaling of every coordinate is exact and the only thing under
        // test is the magnitude — 2^56 is 7.2e16, the "1e17 engine units" of §9.2.
        const S = Math.pow(2, 56);
        const ring = [[10.5, 20.25], [400.75, 20.25], [400.75, 380.5], [10.5, 380.5]];
        const unit = paint([lineLoop(ring)], 1);
        const huge = paint([lineLoop(ring.map(([x, y]) => [x * S, y * S]))], 1 / S);
        expect(firstDiff(unit, huge)).toBe(null);
        expect(alphaAt(unit, 200, 200)).toBe(255);
    });

    test("D3 edge case 4.7: scale-first and subtract-first agree to under 1e-6 px at the deepest zoom", () => {
        const Zq = 256 * 2.625;                                 // `enter` × Kobin's phone dpr, the largest Zq (§4.6)
        let worst = 0;
        for (const x of [0, 1, 1e-3, 137.37, 1e3, 65536.5, 2.6e5, -2.6e5, -1e3]) {
            for (const i of [0, 1, 7, 331, 340000, -340000]) {
                const a = x * Zq - i * PLATE_PX;                 // §4.6, what the core does
                const ox = (i * PLATE_PX) / Zq;                  // the subtract-first order
                const b = (x - ox) * Zq;
                worst = Math.max(worst, Math.abs(a - b));
            }
        }
        expect(worst).toBeLessThan(1e-6);
        // and the reason the first order is the one that ships: `i · PLATE_PX` is an exact
        // integer, so two neighbouring plates differ by exactly PLATE_PX and describe a shared
        // point to the last bit, which `ox` — a rounded non-integer — cannot.
        const x = 137.3759;
        expect((x * Zq - 0 * PLATE_PX) - (x * Zq - 1 * PLATE_PX)).toBe(PLATE_PX);
    });
});
