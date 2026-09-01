/**
 * CD — cedeRect: cutting a tile out of a parent, exactly.
 *
 * The two things that have to hold, and the two ways the previous attempt broke:
 *
 *  - EXACT. The child fills the rect that was cut, and the pair is viewed
 *    together at 3000x the parent's scale. A parent edge rounded by one Clipper
 *    lattice step (1e-3 parent units) is three units out down there — hundreds
 *    of pixels of crack. So the surviving edge must be the rect's own
 *    coordinates, bit for bit, at any distance from the origin.
 *
 *  - CONNECTIVITY BY GEOMETRY, NOT BY BOUNDING BOX. The predecessor decided
 *    whether a cut separated a shape by asking whether the halves' bounding
 *    boxes were disjoint on some axis. Any cut that is not dead straight leaves
 *    overlapping bboxes, so it declined and left the object whole — which is
 *    what a real scribbled erase always looks like. CD-3 is that case.
 */
import { cedeRect, touchesRect, ringsBbox } from "./cede";

const band = (far = 0, top = 300, bot = 390) =>
    [[[far + 100, top], [far + 700, top], [far + 700, bot], [far + 100, bot]]];
const area = (rings) => {
    let a = 0;
    for (const r of rings) { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } a += s / 2; }
    return Math.abs(a);
};
const allCoords = (groups) => { const out = []; for (const g of groups) for (const r of g) for (const p of r) out.push(p); return out; };

describe("CD-1 — what the cut leaves", () => {
    test("a hole spanning the band's full height parts it in two", () => {
        const g = cedeRect(band(), { x0: 380, y0: 250, x1: 420, y1: 450 });
        expect(g).toHaveLength(2);
    });
    test("a hole that does not span it leaves one piece, joined round the outside", () => {
        const g = cedeRect(band(), { x0: 380, y0: 250, x1: 420, y1: 340 });
        expect(g).toHaveLength(1);
    });
    test("a hole clear of the ink changes nothing", () => {
        const g = cedeRect(band(), { x0: 380, y0: 900, x1: 420, y1: 950 });
        expect(g).toHaveLength(1);
        expect(area(g[0])).toBeCloseTo(600 * 90, 6);
    });
    test("a hole swallowing the ink leaves nothing", () => {
        expect(cedeRect(band(), { x0: 0, y0: 0, x1: 2000, y1: 2000 })).toHaveLength(0);
    });
    test("the ink removed is exactly the intersection", () => {
        const g = cedeRect(band(), { x0: 380, y0: 250, x1: 420, y1: 450 });
        const kept = g.reduce((s, rings) => s + area(rings), 0);
        expect(600 * 90 - kept).toBeCloseTo(40 * 90, 6);   // the 40-wide slot
    });
});

describe("CD-2 — the cut edge is exact, anywhere in the plane", () => {
    // The whole reason this is float-only. At 2e7 units out, Clipper's capped
    // lattice was 137 px at the level's deepest zoom.
    test.each([[0], [1e5], [6e5], [4e6], [2e7]])("%p units from the origin", (far) => {
        const hole = { x0: far + 380.4567, y0: 250, x1: far + 420.4567, y1: 450 };
        const g = cedeRect(band(far), hole);
        expect(g).toHaveLength(2);
        // Every surviving vertex is either an original band corner or ON the
        // hole's own edge — to the bit, not to a tolerance.
        const xs = new Set(allCoords(g).map((p) => p[0]));
        for (const x of xs) {
            const ok = x === far + 100 || x === far + 700 || x === hole.x0 || x === hole.x1;
            expect([far, x, ok]).toEqual([far, x, true]);
        }
    });
});

describe("CD-3 — connectivity does not care about bounding boxes", () => {
    // The case that defeated the predecessor. Two halves whose bboxes overlap on
    // BOTH axes, but which are genuinely disconnected. A wiggly cut through a
    // blob does this every time; a straight one never does, which is why a suite
    // full of straight cuts passed while real use did not.
    // A "C" opening rightwards, with a bar reaching into its mouth from the
    // left arm. Cut the bar off at the arm and the two pieces INTERLOCK: the
    // bar's bounding box sits wholly inside the C's, so no axis separates them,
    // yet they share no ink at all.
    const interlocked = () => [
        [[0, 0], [80, 0], [80, 400], [0, 400]],        // left arm
        [[0, 0], [400, 0], [400, 80], [0, 80]],        // top
        [[0, 320], [400, 320], [400, 400], [0, 400]],  // bottom
        [[80, 180], [300, 180], [300, 220], [80, 220]], // the bar in the mouth
    ];
    test("a hole through the waist parts it, though the bboxes overlap on both axes", () => {
        const g = cedeRect(interlocked(), { x0: 70, y0: 170, x1: 90, y1: 230 });
        expect(g).toHaveLength(2);
        const boxes = g.map((rings) => ringsBbox(rings)).sort((a, b) => (a.x1 - a.x0) - (b.x1 - b.x0));
        // The bar's box is strictly inside the C's — the bbox test cannot see
        // this separation, which is exactly why the predecessor declined.
        expect(boxes[0].x0).toBeGreaterThan(boxes[1].x0);
        expect(boxes[0].x1).toBeLessThan(boxes[1].x1);
        expect(boxes[0].y0).toBeGreaterThan(boxes[1].y0);
        expect(boxes[0].y1).toBeLessThan(boxes[1].y1);
        const sepX = boxes[0].x1 < boxes[1].x0 || boxes[1].x1 < boxes[0].x0;
        const sepY = boxes[0].y1 < boxes[1].y0 || boxes[1].y1 < boxes[0].y0;
        expect(sepX || sepY).toBe(false);
    });
    test("...and a hole in the empty middle does not part it", () => {
        expect(cedeRect(interlocked(), { x0: 150, y0: 250, x1: 200, y1: 300 })).toHaveLength(1);
    });
});

describe("CD-4 — a hole that leaves an island", () => {
    test("a ring-shaped remainder is one piece; a bar across it is two", () => {
        const square = [[[0, 0], [400, 0], [400, 400], [0, 400]]];
        expect(cedeRect(square, { x0: 100, y0: 100, x1: 300, y1: 300 })).toHaveLength(1);
        expect(cedeRect(square, { x0: 100, y0: -50, x1: 300, y1: 450 })).toHaveLength(2);
    });
});

describe("CD-6 — a cell is not a chunk", () => {
    // The second way to get connectivity wrong, and the one that survived the
    // first. rectSubtract leaves at most four cells around the hole, and it is
    // tempting to treat each as a lump — but the ink inside ONE cell is often
    // several separate lumps, because the object being ceded has usually been
    // erased before. Merge them and everything either lump touches becomes one
    // piece, which is the bounding-box mistake in a different hat.
    //
    // This is not hypothetical: it is what §3's progressive thinning produces
    // every time. Each round leaves a shelf with a notch through it, and the
    // NEXT round's tile cuts below the shelf — so the cell above the tile holds
    // the shelf's two halves and nothing else. DS-2 reported one parent piece
    // after a gesture that had cut clean through the neck.
    const shelfWithNotch = () => [
        [[0, 0], [190, 0], [190, 40], [0, 40]],        // left half of the shelf
        [[210, 0], [400, 0], [400, 40], [210, 40]],    // right half, notch between
        [[0, 40], [400, 40], [400, 100], [0, 100]],    // the band below, joining them
    ];
    test("a tile cut below the notch parts the shelf", () => {
        // The hole takes the joining band entirely, leaving only the two halves.
        const g = cedeRect(shelfWithNotch(), { x0: -10, y0: 40, x1: 410, y1: 110 });
        expect(g).toHaveLength(2);
        const boxes = g.map(ringsBbox).sort((a, b) => a.x0 - b.x0);
        expect(boxes[0].x1).toBeLessThanOrEqual(190);
        expect(boxes[1].x0).toBeGreaterThanOrEqual(210);
    });
    test("...and while the band still joins them, it is one piece", () => {
        // Same geometry, hole moved off the band: nothing is parted.
        expect(cedeRect(shelfWithNotch(), { x0: -10, y0: 110, x1: 410, y1: 160 })).toHaveLength(1);
        // ...and a hole taking only the BOTTOM of the band leaves them joined
        // round the strip of it that survives.
        expect(cedeRect(shelfWithNotch(), { x0: -10, y0: 60, x1: 410, y1: 110 })).toHaveLength(1);
        // ...while one that takes the band's left half really does part them:
        // the right shelf keeps the band, the left shelf has nothing to reach.
        expect(cedeRect(shelfWithNotch(), { x0: -10, y0: 40, x1: 200, y1: 110 })).toHaveLength(2);
    });
    test("a hole INSIDE the ink stays a hole, and an island inside it is its own piece", () => {
        // WINDING decides what is ink and what is a hole — the same rule the
        // renderer fills by — so the hole runs the other way round. Counting
        // nesting depth instead is cheaper and wrong: a fill's rings routinely
        // overlap rather than nest (an outline emits one per segment), and an
        // overlapping ring sits at depth 1 and reads as a hole that is not one.
        const donutWithIsland = [
            [[0, 0], [300, 0], [300, 300], [0, 300]],          // outer
            [[50, 50], [50, 250], [250, 250], [250, 50]],      // hole (reversed)
            [[120, 120], [180, 120], [180, 180], [120, 180]],  // island in the hole
        ];
        const g = cedeRect(donutWithIsland, { x0: 400, y0: 400, x1: 500, y1: 500 }); // clear of it all
        expect(g).toHaveLength(2);
        const byArea = g.map((rings) => ringsBbox(rings)).sort((a, b) => (a.x1 - a.x0) - (b.x1 - b.x0));
        expect(byArea[0].x1 - byArea[0].x0).toBeCloseTo(60, 6);    // the island alone
        expect(byArea[1].x1 - byArea[1].x0).toBeCloseTo(300, 6);   // outer + its hole
        expect(g.find((rings) => rings.length === 2)).toBeTruthy(); // the hole stayed with its ink
    });
});

describe("CD-7 — a RING is not a chunk either", () => {
    // The hardest of the three, and the one that actually broke DS-2.
    //
    // Sutherland-Hodgman emits ONE ring per input ring, always. So when the clip
    // genuinely parts the ink it cannot say so: it walks the boundary along the
    // clip line from one lump to the other and back, leaving a corridor of no
    // width. Every ring-level test then agrees the two lumps are one thing —
    // same ring, same winding, one bounding box — and they are not.
    //
    // A band with a notch cut down into it from above, written as ONE ring, and
    // a hole taking everything below the notch's floor. That is precisely what
    // §3's thinning leaves behind at every round.
    const notchedBand = () => [[
        [0, 0], [190, 0], [190, 60], [210, 60], [210, 0], [400, 0], [400, 100], [0, 100],
    ]];
    test("a hole up to the notch's floor parts the band, though the clip returns one ring", () => {
        const g = cedeRect(notchedBand(), { x0: -10, y0: 60, x1: 410, y1: 110 });
        expect(g).toHaveLength(2);
        const boxes = g.map(ringsBbox).sort((a, b) => a.x0 - b.x0);
        expect(boxes[0].x1).toBeCloseTo(190, 6);
        expect(boxes[1].x0).toBeCloseTo(210, 6);
        // No ink was lost or gained: the corridor had no area to lose.
        expect(g.reduce((s, rings) => s + area(rings), 0)).toBeCloseTo(190 * 60 + 190 * 60, 6);
    });
    test("...and a hole stopping short of it does not, because the band still runs across", () => {
        const g = cedeRect(notchedBand(), { x0: -10, y0: 70, x1: 410, y1: 110 });
        expect(g).toHaveLength(1);
        expect(area(g[0])).toBeCloseTo(400 * 70 - 20 * 60, 6);
    });
});

describe("CD-5 — touchesRect", () => {
    test("reaches the boundary, or does not", () => {
        expect(touchesRect(band(), { x0: 380, y0: 250, x1: 420, y1: 450 })).toBe(false);
        const g = cedeRect(band(), { x0: 380, y0: 250, x1: 420, y1: 450 });
        for (const rings of g) expect(touchesRect(rings, { x0: 380, y0: 250, x1: 420, y1: 450 })).toBe(true);
    });
});
