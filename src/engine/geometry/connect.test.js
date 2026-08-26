/**
 * geometry/connect.js — the arithmetic bible §3's relay rests on.
 *
 * These are cheap and they matter out of all proportion to their size: every
 * severance decision in the engine is one `arcsTouch` call away from being
 * wrong, and both ways of being wrong are invisible in a screenshot. An object
 * wrongly left whole renders correctly and merely drags as one lump; an object
 * wrongly severed comes apart under the user's hands. The engine-level suites
 * can only see the verdict — these see the reasoning.
 */
import { contactArcs, arcsTouch, asRect, Groups } from "./connect";

const R = { x0: 0, y0: 0, x1: 10, y1: 10 };
// A ring hugging one side of R, `d` deep, spanning [a, b] along it.
const topStrip = (a, b, d = 2) => [[[a, 0], [b, 0], [b, d], [a, d]]];
const leftStrip = (a, b, d = 2) => [[[0, a], [d, a], [d, b], [0, b]]];
const rightStrip = (a, b, d = 2) => [[[10, a], [10 - d, a], [10 - d, b], [10, b]]];
const bottomStrip = (a, b, d = 2) => [[[a, 10], [b, 10], [b, 10 - d], [a, 10 - d]]];
const covers = (arcs, t) => arcs.some(([a, b]) => t >= a - 1e-9 && t <= b + 1e-9);

describe("perimeter parametrization", () => {
    test("each side lands in its own unit interval, clockwise from the top-left", () => {
        expect(covers(contactArcs(topStrip(2, 8), R), 0.5)).toBe(true);
        expect(covers(contactArcs(rightStrip(2, 8), R), 1.5)).toBe(true);
        expect(covers(contactArcs(bottomStrip(2, 8), R), 2.5)).toBe(true);
        expect(covers(contactArcs(leftStrip(2, 8), R), 3.5)).toBe(true);
    });

    test("the left side runs to t = 4 and does NOT wrap round to 0", () => {
        // The regression this exists for: wrapping the left side at t = 4 turned
        // a short arc up the left edge into [0, 3.47] — nearly the whole
        // perimeter — which then overlapped every other arc, and the relay
        // reported every cut, at every depth, as still joined. It failed
        // silently: severance simply never happened.
        const arcs = contactArcs(leftStrip(2, 8), R);
        for (const [a, b] of arcs) {
            expect(b - a).toBeLessThan(1.01);       // one side's worth, at most
            expect(a).toBeGreaterThanOrEqual(3 - 1e-9);
        }
        expect(covers(arcs, 0.5)).toBe(false);      // nothing on the top edge
        expect(covers(arcs, 1.5)).toBe(false);
        expect(covers(arcs, 2.5)).toBe(false);
    });

    test("a corner-hugging region reads as touching both of its sides", () => {
        const corner = [[[0, 0], [3, 0], [3, 3], [0, 3]]];
        const arcs = contactArcs(corner, R);
        expect(covers(arcs, 0.15)).toBe(true);      // along the top
        expect(covers(arcs, 3.85)).toBe(true);      // and up the left
    });

    test("a lone vertex on the boundary counts — regions meeting at a point touch", () => {
        const spike = [[[5, 0], [6, 3], [4, 3]]];
        const arcs = contactArcs(spike, R);
        expect(arcs.length).toBeGreaterThan(0);
        expect(covers(arcs, 0.5)).toBe(true);
    });

    test("ink nowhere near the rect contributes nothing", () => {
        expect(contactArcs([[[3, 3], [7, 3], [7, 7], [3, 7]]], R)).toEqual([]);
    });

    test("both rect spellings describe the same rectangle", () => {
        expect(asRect({ left: 1, top: 2, right: 3, bottom: 4 })).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
        expect(contactArcs(topStrip(2, 8), { left: 0, top: 0, right: 10, bottom: 10 }))
            .toEqual(contactArcs(topStrip(2, 8), R));
    });
});

describe("scale independence — the property the whole relay depends on", () => {
    // A parent measures the ceded rect in its own units; the child measures the
    // very same rect 3000x bigger, offset a long way from the origin. If the two
    // measurements did not produce the same numbers, comparing them would mean
    // composing a transform across the crossing — which is exactly what nothing
    // in this design is allowed to do.
    test.each([[1, 0], [3000, 0], [3000, 1e6], [1 / 3000, -12.8], [9e6, 4.2e7]])(
        "scale %p, offset %p gives identical arcs", (s, off) => {
            const base = contactArcs(leftStrip(2, 8), R);
            const rect = { x0: R.x0 * s + off, y0: R.y0 * s + off, x1: R.x1 * s + off, y1: R.y1 * s + off };
            const rings = leftStrip(2, 8).map((r) => r.map(([x, y]) => [x * s + off, y * s + off]));
            const got = contactArcs(rings, rect, Math.abs(s) * 1e-6);
            expect(got.length).toBe(base.length);
            for (let i = 0; i < base.length; i++) {
                expect(got[i][0]).toBeCloseTo(base[i][0], 6);
                expect(got[i][1]).toBeCloseTo(base[i][1], 6);
            }
        });
});

describe("tolerance", () => {
    test("a vertex a lattice step off the edge still counts when tol allows it", () => {
        const off = leftStrip(2, 8).map((r) => r.map(([x, y]) => [x + 0.004, y]));
        expect(contactArcs(off, R, 0.01).length).toBeGreaterThan(0);
        expect(contactArcs(off, R, 0.001)).toEqual([]);
    });
    test("tolerance does not reach across the rect", () => {
        // Generous is fine; generous enough to call the far side a contact is not.
        expect(contactArcs([[[4, 4], [6, 4], [6, 6], [4, 6]]], R, 1)).toEqual([]);
    });
});

describe("arcsTouch", () => {
    test("overlapping arcs on the same side touch; disjoint ones do not", () => {
        expect(arcsTouch(contactArcs(topStrip(0, 5), R), contactArcs(topStrip(4, 9), R))).toBe(true);
        expect(arcsTouch(contactArcs(topStrip(0, 3), R), contactArcs(topStrip(6, 9), R))).toBe(false);
    });
    test("arcs on opposite sides never touch", () => {
        expect(arcsTouch(contactArcs(leftStrip(2, 8), R), contactArcs(rightStrip(2, 8), R))).toBe(false);
    });
    test("the perimeter is a circle: a contact through t = 0 is still one contact", () => {
        // A stretch running through the corner where the parameter wraps is
        // stored as its two halves ([.., 4] and [0, ..]). Two pieces that both
        // reach through that corner share it, and each half has to be compared
        // with the other set's matching half.
        expect(arcsTouch([[0, 0.2], [3.8, 4]], [[0, 0.1], [3.9, 4]], 1e-6)).toBe(true);
        expect(arcsTouch([[0, 0.2], [3.8, 4]], [[1, 2]], 1e-6)).toBe(false);
    });
    test("meeting at a POINT is not touching", () => {
        // The rule the tile machinery turns on. When an erase reaches the edge of
        // a tile, the two pieces it leaves meet that edge at the same point — the
        // one the eraser crossed — so a point contact is the signature of a
        // completed cut. Treating it as a join (which is what overlap-or-abut
        // did) meant a tile cut cleanly in two still reported itself joined to
        // both halves of its parent, and the object never came apart. Measured
        // on Kobin's simplest case: [0.19, 0.19] against a real contact of 1.47.
        expect(arcsTouch([[0, 1]], [[1, 2]], 1e-6)).toBe(false);
        expect(arcsTouch([[3.5, 4]], [[0, 0.5]], 1e-6)).toBe(false);   // at the corner
        expect(arcsTouch([[0.19, 0.19]], [[0, 0.19]], 1e-9)).toBe(false);
        // ...and a real shared stretch still is.
        expect(arcsTouch([[0, 1]], [[0.5, 2]], 1e-6)).toBe(true);
    });
    test("abutting contacts do NOT bridge: the clip that made them is exact", () => {
        // This used to be closed by `tol`, from when the boundary came off
        // Clipper's integer lattice and one contact could be split in two by
        // quantization. The arc clip puts contacts exactly on the rect, so a gap
        // between two of them is a real gap — the place a cut went through.
        expect(arcsTouch([[0, 1]], [[1.0002, 2]], 1e-3)).toBe(false);
        expect(arcsTouch([[0, 1]], [[1.05, 2]], 1e-3)).toBe(false);
    });
    test("an empty arc set touches nothing — an enclosed island reaches no boundary", () => {
        expect(arcsTouch([], [[0, 4]], 1)).toBe(false);
        expect(arcsTouch([[0, 4]], [], 1)).toBe(false);
    });
});

describe("Groups", () => {
    test("union-find keeps transitive membership", () => {
        const g = new Groups();
        const a = g.add(), b = g.add(), c = g.add(), d = g.add();
        g.union(a, b); g.union(c, d);
        expect(g.classes([a, b, c, d])).toHaveLength(2);
        g.union(b, c);
        expect(g.classes([a, b, c, d])).toHaveLength(1);
    });
    test("classes are stable however the ids are ordered", () => {
        const g = new Groups();
        const ids = [g.add(), g.add(), g.add()];
        g.union(ids[2], ids[0]);
        expect(g.classes(ids).map((c) => c.length).sort()).toEqual([1, 2]);
        expect(g.classes([...ids].reverse()).map((c) => c.length).sort()).toEqual([1, 2]);
    });
});
