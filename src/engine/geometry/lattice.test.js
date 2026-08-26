/**
 * LT — THE INTEGER LATTICE: where booleans round, and what that costs.
 *
 * Clipper is an integer library, so every boolean picks a scale and rounds to
 * it. The scale used to be capped by the largest COORDINATE in play, which
 * means it was capped by how far the drawing had been panned from the frame
 * origin — a quantity that has nothing to do with the shape being cut. Measured
 * on a plain band with off-lattice edges:
 *
 *   | panned from origin | rounding error, in px at the level's deepest zoom |
 *   |---|---|
 *   | 0        | 0.07 |
 *   | 1e5      | 0.26 |
 *   | 6e5      | 0.67 |
 *   | 4e6      | 3.70 |
 *   | 2e7      | 137  |
 *
 * That is the pixellation. It also explains a second symptom that looks
 * unrelated: a boolean re-quantizes its WHOLE subject, not just the part near
 * the cut, so erasing one end of a stroke moved the other end — the shape
 * changed where nothing had been touched.
 *
 * The fix is to work in a local frame whose origin is snapped ONTO the lattice.
 * Both halves of that matter and the tests below pin them separately:
 *   - local, so the scale is set by the shape's own size and not its position;
 *   - snapped, so it is still the SAME global grid every caller has always used.
 *     Re-centring on the shape's midpoint without snapping would anchor the grid
 *     somewhere different for every call, and two booleans over abutting
 *     geometry would round a shared edge two different ways — a hairline crack.
 */
import { subtractPolys, clipPolysToRect } from "./clipperOutline";

// Deliberately OFF-lattice: .45678 is not a multiple of 1/scale for any scale
// the code might pick, so every bit of rounding shows up.
const TOP = 300.45678, BOT = 390.45678, X0 = 100.45678, X1 = 700.45678;
const band = (far, top = TOP, bot = BOT) =>
    [[[far + X0, top], [far + X1, top], [far + X1, bot], [far + X0, bot]]];
const notch = (far, at = TOP) =>
    [[[far + 380.5, at - 50], [far + 420.5, at - 50], [far + 420.5, at + 10], [far + 380.5, at + 10]]];

// The worst distance any surviving vertex FAR FROM THE CUT sits from where it
// was given. Nothing over there was touched, so this is pure rounding.
function driftAwayFromCut(regions, far) {
    let worst = 0;
    for (const rings of regions) for (const ring of rings) for (const [x, y] of ring) {
        if (x - far > 300) continue;
        const dy = Math.min(Math.abs(y - TOP), Math.abs(y - BOT));
        const dx = Math.min(Math.abs(x - far - X0), Math.abs(x - far - X1));
        worst = Math.max(worst, Math.min(dx, dy));
    }
    return worst;
}

const DISTANCES = [[0], [1e4], [1e5], [6e5], [4e6], [2e7]];

describe("LT-1 — rounding does not depend on where the drawing sits", () => {
    // A quarter of a device pixel at the level's deepest in-level zoom. Anything
    // above that is visible as facets on what should be a straight edge.
    const BUDGET_PX = 0.25;
    test.each(DISTANCES)("subtractPolys, %p units from the origin", (far) => {
        const d = driftAwayFromCut(subtractPolys(band(far), notch(far)), far);
        expect(d * 300).toBeLessThanOrEqual(BUDGET_PX);
    });
    test.each(DISTANCES)("clipPolysToRect, %p units from the origin", (far) => {
        const out = clipPolysToRect(band(far), { left: far + 150.5, top: 250.5, right: far + 650.5, bottom: 500.5 });
        let worst = 0;
        for (const poly of out) for (const [x, y] of poly) {
            const dy = Math.min(Math.abs(y - TOP), Math.abs(y - BOT));
            const dx = Math.min(Math.abs(x - far - 150.5), Math.abs(x - far - 650.5));
            worst = Math.max(worst, Math.min(dx, dy));
        }
        expect(worst * 300).toBeLessThanOrEqual(BUDGET_PX);
    });
    test("the error is FLAT across the range, not merely small at the near end", () => {
        // The property that actually distinguishes a fix from a tighter budget.
        const ds = DISTANCES.map(([far]) => driftAwayFromCut(subtractPolys(band(far), notch(far)), far));
        const lo = Math.min(...ds), hi = Math.max(...ds);
        expect(hi).toBeLessThanOrEqual(Math.max(lo, 1e-9) * 1.5);
    });
});

describe("LT-2 — a cut does not move the parts of the shape it did not touch", () => {
    // "Shapes changing after being erased." The boolean rewrites every vertex it
    // is given, so if the lattice is coarse the far end of a stroke shifts too.
    test.each(DISTANCES)("%p units from the origin: the far edge is where it was", (far) => {
        const regions = subtractPolys(band(far), notch(far));
        const ys = [];
        for (const rings of regions) for (const ring of rings) for (const [x, y] of ring) {
            if (x - far < 300) ys.push(y);
        }
        expect(ys.length).toBeGreaterThan(0);
        for (const y of ys) {
            expect(Math.min(Math.abs(y - TOP), Math.abs(y - BOT))).toBeLessThan(1e-3);
        }
    });
    test("...and erasing ten times over does not walk it away", () => {
        // Each cut re-quantizes what the last one produced. If the lattice ever
        // shifts between calls the shape creeps, a little each time, and there
        // is no single erase you can blame for it.
        let polys = band(4e6);
        const firstY = polys[0][0][1];
        for (let i = 0; i < 10; i++) {
            const regions = subtractPolys(polys, notch(4e6 + i * 12));
            expect(regions.length).toBeGreaterThan(0);
            polys = regions[0];
        }
        let worst = 0;
        for (const ring of polys) for (const [x, y] of ring) {
            if (x - 4e6 < 300) worst = Math.max(worst, Math.min(Math.abs(y - TOP), Math.abs(y - BOT)));
        }
        expect(firstY).toBe(TOP);
        expect(worst * 300).toBeLessThanOrEqual(0.25);
    });
});

describe("LT-3 — the grid is global, so shared edges cannot crack", () => {
    // The half of the fix that is easy to get wrong. Working in a local frame is
    // what buys the precision; SNAPPING that frame onto the lattice is what
    // keeps two independent calls agreeing about where a shared edge is.
    test.each(DISTANCES)("two calls put a shared edge in the same place, %p out", (far) => {
        const upper = subtractPolys(band(far), notch(far));
        const lower = subtractPolys(band(far, BOT, BOT + 90), notch(far, BOT + 70));
        const edge = (rs) => {
            const ys = new Set();
            for (const rings of rs) for (const ring of rings) for (const [, y] of ring) {
                if (Math.abs(y - BOT) < 5) ys.add(y);
            }
            return [...ys];
        };
        const a = edge(upper), b = edge(lower);
        expect(a.length).toBeGreaterThan(0);
        expect(b.length).toBeGreaterThan(0);
        for (const y of a) expect(b).toContain(y);      // bit-identical, not merely close
    });
    test("a coordinate already ON the lattice comes back untouched", () => {
        // The grid has not moved: an exactly-representable input is a fixed point.
        for (const far of [0, 4e6]) {
            const exact = [[[far + 100, 300], [far + 700, 300], [far + 700, 390], [far + 100, 390]]];
            const regions = subtractPolys(exact, [[[far + 380, 250], [far + 420, 250], [far + 420, 310], [far + 380, 310]]]);
            const xs = new Set(), ys = new Set();
            for (const rings of regions) for (const ring of rings) for (const [x, y] of ring) { xs.add(x - far); ys.add(y); }
            for (const x of xs) expect(Number.isInteger(x)).toBe(true);
            for (const y of ys) expect(Number.isInteger(y)).toBe(true);
        }
    });
});

describe("LT-4 — enormous geometry still gets a workable lattice", () => {
    // The cap has to keep clipper-lib inside its fast double range (|coord| under
    // ~4.7e7 scaled), so a genuinely huge shape must still be quantized coarsely
    // — that is correct, and it is the case the cap exists for. What must NOT
    // happen is falling into emulated Int128, or returning nothing.
    test("a shape millions of units across is cut, and stays inside the fast range", () => {
        const huge = [[[-3e6, -3e6], [3e6, -3e6], [3e6, 3e6], [-3e6, 3e6]]];
        const regions = subtractPolys(huge, [[[-1e6, -4e6], [1e6, -4e6], [1e6, 0], [-1e6, 0]]]);
        expect(regions.length).toBeGreaterThan(0);
        let mag = 0;
        for (const rings of regions) for (const ring of rings) for (const [x, y] of ring) {
            mag = Math.max(mag, Math.abs(x), Math.abs(y));
        }
        expect(mag).toBeLessThanOrEqual(3e6 + 1);
    });
});
