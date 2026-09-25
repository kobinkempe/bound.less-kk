/**
 * chordMath.test.js — M1–M3 of RASTERISER-PLAN §9.2: the one permitted edit to the frozen
 * geometry chain. `arcShape.chordArcMid` and `freeze.pieceSagitta` now call this leaf, and
 * the bake's footprint is derived from both, so the expressions must be BIT-identical, not
 * close.
 *
 * The pieces are generated here rather than read from a report: `tools/extract-fixture.js`
 * is stage 2's, and these sweep the ranges the recorded pieces live in — radii 1e-3 to
 * 1e16 units, sweeps to a whole turn, both signs, and centres up to 1e16 from the origin.
 *
 * M1 and M2 measure against the expressions as they stood BEFORE the delegation, written out
 * below: the two callers now return the leaf's own result, so a leaf-against-caller assertion
 * would be true of any expression at all.
 */

import { bulgeK, chordMidK, chordMidXY, sagittaOf, arcAreaTerm } from "./chordMath";
import { chordArcMid, segmentTerm, loopArea } from "./arcShape";
import { pieceSagitta } from "./freeze";

/** The same numbers on every run. */
let seed = 20260915;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/**
 * 10,000 arc pieces over the magnitudes the app holds: the centre and radius are used to
 * BUILD each piece (so a true midpoint exists to check against) and are never read by the
 * functions under test.
 */
function pieces(n, reach = 1e16) {
    seed = 20260915;
    const out = [];
    for (let i = 0; i < n; i++) {
        const r = Math.pow(10, -3 + rnd() * 19);
        const far = reach === 1e16 ? Math.pow(10, rnd() * 16) : r * Math.pow(10, rnd() * 3);
        const cx = (rnd() - 0.5) * 2 * far;
        const cy = (rnd() - 0.5) * 2 * far;
        const a0 = rnd() * Math.PI * 2;
        const sweep = (rnd() < 0.5 ? -1 : 1) * (1e-9 + rnd() * Math.PI * 2);
        const A = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
        const B = [cx + Math.cos(a0 + sweep) * r, cy + Math.sin(a0 + sweep) * r];
        out.push({ line: false, C: [cx, cy], r, a0, sweep, A, B });
    }
    return out;
}

/**
 * The same, with the centre within 1e3 radii. A piece whose centre is 1e16 away and whose
 * radius is 1e-3 has no chord left to read — its two ends are one rounding of the centre —
 * so the accuracy checks below use these, and the bit-identity checks use the wild ones.
 */
const localPieces = (n) => pieces(n, 0);

/**
 * The two expressions as they stood in `arcShape.js` and `freeze.js` BEFORE they delegated.
 * They are the reference M1 and M2 measure against: the two callers now return
 * `chordMidXY(...)` and `sagittaOf(...)`, so comparing them with the leaf alone compares each
 * function with itself and is true of whatever the leaf happens to hold.
 */
const chordArcMidV0 = (p) => {
    const A = p.A, B = p.B;
    const k = Math.tan(p.sweep / 4) / 2;
    return [(A[0] + B[0]) / 2 + (B[1] - A[1]) * k, (A[1] + B[1]) / 2 - (B[0] - A[0]) * k];
};

const pieceSagittaV0 = (p) => {
    if (p.line) return 0;
    const a = Math.abs(p.sweep);
    if (!(a > 0)) return 0;
    if (a > Math.PI) return Infinity;
    const dx = p.B[0] - p.A[0], dy = p.B[1] - p.A[1];
    return (Math.hypot(dx, dy) / 2) * Math.abs(Math.tan(a / 4));
};

describe("chordMath — the two identities the rasteriser works from", () => {
    test("M1 chordMidXY is chordArcMid bit for bit, on 10,000 pieces", () => {
        const ps = pieces(10000);
        let checked = 0;
        for (const p of ps) {
            const want = chordArcMidV0(p);                    // the expression before the delegation
            const got = chordMidXY(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep, [0, 0]);
            const thru = chordArcMid(p);                      // and the caller, which proves the delegation
            if (!Object.is(want[0], got[0]) || !Object.is(want[1], got[1])) {
                throw new Error("M1: sweep " + p.sweep + " gave " + got + " against " + want);
            }
            if (!Object.is(want[0], thru[0]) || !Object.is(want[1], thru[1])) {
                throw new Error("M1: chordArcMid at sweep " + p.sweep + " gave " + thru + " against " + want);
            }
            checked++;
        }
        expect(checked).toBe(10000);
        // and the k form, which the flattener uses so that one depth shares one tan
        const p = ps[0];
        const byK = chordMidK(p.A[0], p.A[1], p.B[0], p.B[1], bulgeK(p.sweep), [0, 0]);
        expect(Object.is(byK[0], chordArcMidV0(p)[0])).toBe(true);
        expect(Object.is(byK[1], chordArcMidV0(p)[1])).toBe(true);
    });

    test("M1 the gate: k is tan(sweep/4)/2, so the midpoint lands ON the arc", () => {
        // The failure this exists to catch is k = tan(sweep/2)/2, which bulges about twice
        // as far at every depth and every arc in the picture with it. Checked against the
        // point the centre form gives, on pieces whose centre is close enough to be exact.
        let worst = 0, checked = 0;
        for (const p of localPieces(4000)) {
            if (Math.abs(p.sweep) > Math.PI * 1.9) continue;   // k runs to 1e15 at a whole turn
            const t = p.a0 + p.sweep / 2;
            const exact = [p.C[0] + Math.cos(t) * p.r, p.C[1] + Math.sin(t) * p.r];
            const got = chordMidXY(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep, [0, 0]);
            worst = Math.max(worst, Math.hypot(got[0] - exact[0], got[1] - exact[1]) / p.r);
            checked++;
        }
        expect(checked).toBeGreaterThan(3000);
        expect(worst).toBeLessThan(1e-9);                    // measured 5.3e-13 of the radius, over 3,447 pieces
        // stated as a number so the halved-k error is visible: a quarter turn bulges by
        // (L/2)·tan(45°/2) = 0.2071·L, and tan(sweep/2)/2 would give 0.5·L
        const q = chordMidXY(0, 0, 100, 0, Math.PI / 2, [0, 0]);
        expect(q[0]).toBeCloseTo(50, 12);
        expect(q[1]).toBeCloseTo(-20.710678118654755, 12);
        expect(bulgeK(Math.PI / 2)).toBeCloseTo(0.20710678118654752, 15);
    });

    test("M2 sagittaOf is pieceSagitta bit for bit, including the half-turn rule", () => {
        let checked = 0;
        for (const p of pieces(10000)) {
            const want = pieceSagittaV0(p);                   // the expression before the delegation
            const got = sagittaOf(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep);
            const thru = pieceSagitta(p);                     // and the caller, which proves the delegation
            if (!Object.is(want, got)) throw new Error("M2: sweep " + p.sweep + " gave " + got + " against " + want);
            if (!Object.is(want, thru)) throw new Error("M2: pieceSagitta at sweep " + p.sweep + " gave " + thru + " against " + want);
            checked++;
        }
        expect(checked).toBe(10000);
        // the edges of the rule, each stated
        expect(sagittaOf(0, 0, 100, 0, 0)).toBe(0);
        expect(sagittaOf(0, 0, 100, 0, -0)).toBe(0);
        expect(sagittaOf(0, 0, 100, 0, Math.PI)).toBeCloseTo(50, 12);        // a half turn: the radius
        expect(sagittaOf(0, 0, 100, 0, Math.PI * 1.01)).toBe(Infinity);      // over one, it is not asked
        expect(sagittaOf(0, 0, 0, 0, 1)).toBe(0);                            // no chord, no bulge
        expect(pieceSagitta({ line: true, A: [0, 0], B: [100, 0] })).toBe(0);
    });

    test("M3 arcAreaTerm is the radius form of the segment, without the radius", () => {
        // loopArea's own term is r²·segmentTerm(sweep)/2 for the AREA; the shoelace sum is
        // twice that. Relative agreement, because the two forms round differently.
        let worst = 0, checked = 0;
        for (const p of localPieces(4000)) {
            // Past 1.9π these pieces' own ends stop resolving their chord — B − A is a
            // difference of two coordinates up to 1e3 radii out — so the near-whole-turn band
            // is checked below on ends built about the origin instead, not skipped.
            if (Math.abs(p.sweep) > Math.PI * 1.9) continue;
            const want = p.r * p.r * segmentTerm(p.sweep);
            const got = arcAreaTerm(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep);
            if (!(Math.abs(want) > 0)) continue;
            worst = Math.max(worst, Math.abs(got - want) / Math.abs(want));
            checked++;
        }
        expect(checked).toBeGreaterThan(3000);
        expect(worst).toBeLessThan(1e-9);                    // measured 3.7e-12 relative
        // the check worth remembering (arcShape's own): a unit circle as two half turns
        const halves = [
            { line: false, C: [0, 0], r: 1, a0: 0, sweep: Math.PI, A: [1, 0], B: [-1, 0] },
            { line: false, C: [0, 0], r: 1, a0: Math.PI, sweep: Math.PI, A: [-1, 0], B: [1, 0] },
        ];
        let sum = 0;
        for (const p of halves) {
            sum += p.A[0] * p.B[1] - p.B[0] * p.A[1];
            sum += arcAreaTerm(p.A[0], p.A[1], p.B[0], p.B[1], p.sweep);
        }
        expect(sum / 2).toBeCloseTo(Math.PI, 12);
        expect(loopArea(halves)).toBeCloseTo(Math.PI, 12);
        // and the ends of the rule: a sweep of 0 and a whole turn both add nothing, the
        // second because its two ends carry no radius at all (§4.4's antipode split)
        expect(arcAreaTerm(0, 0, 100, 0, 0)).toBe(0);
        expect(arcAreaTerm(50, 0, 50, 0, Math.PI * 2)).toBe(0);
        // the series takes over below 1e-2 rad, where the literal difference is noise
        for (const th of [1e-2, 1e-3, 1e-6, 1e-9]) {
            const r = 1e6, c = 2 * r * Math.sin(th / 2);
            const got = arcAreaTerm(0, 0, c, 0, th);
            expect(Math.abs(got - r * r * segmentTerm(th)) / Math.abs(r * r * segmentTerm(th))).toBeLessThan(1e-9);
        }
        // M3 the other end of the range, which nothing above reaches: `rasterCore` reads the
        // centre only within 1e-9 of a whole turn (WHOLE_TURN), so every sweep outside that
        // band arrives here, and the literal `1 − cos θ` is 0.08 % out at 2π − 1e-7 and
        // Infinity below 2π − 1.5e-8. The ends are built from a centre so the chord is exact.
        let bandWorst = 0;
        for (const eps of [1e-2, 1e-4, 1e-6, 1e-8, 2e-9]) {
            for (const sg of [1, -1]) {
                for (const r of [40, 1e-3, 1e6]) {
                    const th = sg * (Math.PI * 2 - eps);
                    const got = arcAreaTerm(r, 0, r * Math.cos(th), r * Math.sin(th), th);
                    const want = r * r * segmentTerm(th);
                    if (!Number.isFinite(got)) throw new Error("M3: 2π − " + eps + " at r " + r + " gave " + got);
                    bandWorst = Math.max(bandWorst, Math.abs(got - want) / Math.abs(want));
                }
            }
        }
        expect(bandWorst).toBeLessThan(1e-9);                // measured 5.4e-16 relative
        // and the shape of the failure it guards: two counter-wound near-turn rings in one
        // item summed to NaN, which `renderPlate` reads as a positive winding (D63)
        const nearTurn = (sg) => {
            const th = sg * (Math.PI * 2 - 2e-9);
            return arcAreaTerm(40, 0, 40 * Math.cos(th), 40 * Math.sin(th), th);
        };
        expect(Number.isFinite(nearTurn(1) + nearTurn(-1))).toBe(true);
        expect(nearTurn(1) + nearTurn(-1)).toBe(0);
        expect(nearTurn(1)).toBeCloseTo(2 * Math.PI * 1600, 6);   // 2πr², the shoelace's ×2 area
    });
});
