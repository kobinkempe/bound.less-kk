import {
    expansionOf, growExpansion, scaleExpansion, divideExpansion,
    sumExpansions, estimateExpansion,
} from "./expansion";

describe("floating expansions", () => {
    test("division retains the residue needed for a 15-edge inverse", () => {
        const start = expansionOf(3527.4283494158635);
        let down = start;
        for (let i = 0; i < 15; i++) down = divideExpansion(down, 3000);
        let back = down;
        for (let i = 0; i < 15; i++) back = scaleExpansion(back, 3000);
        expect(estimateExpansion(back)).toBeCloseTo(
            estimateExpansion(start), 10,
        );
    });
    test("retain a local residue through enormous cancellation", () => {
        let e = expansionOf(0.125);
        for (let i = 0; i < 15; i++) e = scaleExpansion(e, 3000);
        e = growExpansion(e, 7);
        let cancellingPath = expansionOf(0.125);
        for (let i = 0; i < 15; i++) cancellingPath = scaleExpansion(cancellingPath, -3000);
        // Restore the sign for an odd number of negative scales: this is the
        // same edge-by-edge arithmetic used by the counterpart frame path.
        e = sumExpansions(e, cancellingPath);
        expect(estimateExpansion(e)).toBeCloseTo(7, 8);
    });

    test("a tiny component survives beside an ordinary coordinate", () => {
        let e = expansionOf(300);
        e = growExpansion(e, 1 / Math.pow(3000, 15));
        e = growExpansion(e, -300);
        expect(estimateExpansion(e)).toBeCloseTo(1 / Math.pow(3000, 15), 60);
    });
});
