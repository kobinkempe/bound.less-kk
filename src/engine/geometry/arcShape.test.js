/**
 * arcShape — the resolved-perimeter boolean.
 *
 * The measurements that matter here are AREAS, because an area is the one
 * number a boolean cannot get right by accident: a fabricated edge, a dropped
 * fragment or a hole wound the wrong way all move it, and none of them move it
 * a little.
 */
import {
    loopArea, loopsArea, normalizeLoops, insideShape, windingAt,
    shapeFromRings, flattenShape, transformLoops, translateLoops,
    subtractShape, intersectShape, clipShapeToRect, shapeComponents,
    shapeToCubics, reverseLoop, spanOf, rectLoop,
    repairLoops, loopPerimeter,
} from "./arcShape";
import { bakeArcPerimeter } from "./arcPerimeter";

const PI = Math.PI;

/** A full circle as two half-turns — the case where every bit of the area is
 * in the circular-segment terms and the chord polygon contributes nothing. */
const circle = (cx, cy, r) => [[
    { line: false, C: [cx, cy], r, a0: 0, sweep: PI, A: [cx + r, cy], B: [cx - r, cy] },
    { line: false, C: [cx, cy], r, a0: PI, sweep: PI, A: [cx - r, cy], B: [cx + r, cy] },
]];
const box = (x0, y0, x1, y1) => shapeFromRings([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);

const closed = (loops) => {
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            const d = Math.hypot(a.B[0] - b.A[0], a.B[1] - b.A[1]);
            if (d > 1e-9) return false;
        }
    }
    return true;
};

describe("AS-1 — measure", () => {
    test("a circle's area is exactly pi r^2, from the segment terms alone", () => {
        expect(loopArea(circle(0, 0, 1)[0])).toBeCloseTo(PI, 12);
        expect(loopArea(circle(1e6, -3e5, 37)[0])).toBeCloseTo(PI * 37 * 37, 6);
    });
    test("a box's area is its area, and reversing negates it", () => {
        expect(loopArea(box(0, 0, 10, 4)[0])).toBeCloseTo(40, 12);
        expect(loopArea(reverseLoop(box(0, 0, 10, 4)[0]))).toBeCloseTo(-40, 12);
    });
    test("normalize flips a whole set but keeps outer/hole relative winding", () => {
        const annulus = [circle(0, 0, 10)[0], reverseLoop(circle(0, 0, 4)[0])];
        expect(loopsArea(annulus)).toBeCloseTo(PI * (100 - 16), 9);
        const flipped = annulus.map(reverseLoop);
        expect(loopsArea(flipped)).toBeCloseTo(-PI * (100 - 16), 9);
        expect(loopsArea(normalizeLoops(flipped))).toBeCloseTo(PI * (100 - 16), 9);
    });
    test("a similarity scales area by f^2, exactly — angles do not move", () => {
        const c = circle(3, 5, 7);
        const t = transformLoops(c, 3, 100, -200);
        expect(loopsArea(t)).toBeCloseTo(9 * PI * 49, 9);
        expect(t[0][0].a0).toBe(c[0][0].a0);
        expect(t[0][0].sweep).toBe(c[0][0].sweep);
    });
});

describe("AS-2 — inside / outside", () => {
    test("winding is 1 inside a circle, 0 outside, at every probe angle", () => {
        const c = circle(0, 0, 5);
        for (const p of [[0, 0], [4.9, 0], [0, -4.9], [3, 3]]) expect(windingAt(c, p, 10)).toBe(1);
        for (const p of [[5.1, 0], [0, 9], [-20, -20]]) expect(windingAt(c, p, 10)).toBe(0);
    });
    test("a hole reads as outside", () => {
        const annulus = [circle(0, 0, 10)[0], reverseLoop(circle(0, 0, 4)[0])];
        expect(insideShape(annulus, [0, 0], 20)).toBe(false);
        expect(insideShape(annulus, [7, 0], 20)).toBe(true);
        expect(insideShape(annulus, [12, 0], 20)).toBe(false);
    });
    test("probes on the axes of an axis-aligned box still answer", () => {
        // A +x ray from these points runs exactly through vertices and along
        // edges. The retry directions are what make them answerable at all.
        const b = box(-10, -10, 10, 10);
        expect(insideShape(b, [0, -10], 20)).toBe(false);   // ON the boundary -> outside
        expect(insideShape(b, [0, 0], 20)).toBe(true);
        expect(insideShape(b, [-30, -10], 20)).toBe(false);
    });
});

describe("AS-3 — difference", () => {
    test("a box minus a box that covers its right half", () => {
        const r = subtractShape(box(0, 0, 10, 10), box(5, -5, 15, 15));
        expect(r.stats.openChains || 0).toBe(0);
        expect(r.stats.unbalanced || 0).toBe(0);
        expect(closed(r.loops)).toBe(true);
        expect(loopsArea(r.loops)).toBeCloseTo(50, 9);
    });
    test("a circle minus a smaller circle inside it is an annulus", () => {
        const r = subtractShape(circle(0, 0, 10), circle(0, 0, 4));
        expect(r.loops.length).toBe(2);
        expect(closed(r.loops)).toBe(true);
        expect(loopsArea(r.loops)).toBeCloseTo(PI * (100 - 16), 6);
        // and it is ONE object with a hole, not two objects
        expect(shapeComponents(r.loops).length).toBe(1);
    });
    test("a circle cut clean through falls into two components", () => {
        const r = subtractShape(circle(0, 0, 10), box(-2, -20, 2, 20));
        expect(r.stats.openChains || 0).toBe(0);
        expect(closed(r.loops)).toBe(true);
        const comps = shapeComponents(r.loops);
        expect(comps.length).toBe(2);
        // two circular segments, each of area r^2(theta - sin theta)/2 with
        // theta = 2*acos(2/10)
        const th = 2 * Math.acos(0.2);
        expect(loopsArea(r.loops)).toBeCloseTo(100 * (th - Math.sin(th)), 6);
    });
    test("a clip that misses changes nothing; one that covers leaves nothing", () => {
        const A = circle(0, 0, 5);
        expect(loopsArea(subtractShape(A, circle(100, 100, 5)).loops)).toBeCloseTo(PI * 25, 9);
        expect(subtractShape(A, circle(0, 0, 50)).loops.length).toBe(0);
    });
    test("subtracting twice composes — the output is a legal input", () => {
        const one = subtractShape(box(0, 0, 20, 20), box(-5, 8, 5, 12)).loops;
        expect(loopsArea(one)).toBeCloseTo(400 - 20, 9);
        const two = subtractShape(one, box(15, 8, 25, 12)).loops;
        expect(loopsArea(two)).toBeCloseTo(400 - 40, 9);
        expect(closed(two)).toBe(true);
    });
});

describe("AS-4 — intersection and rect clipping", () => {
    test("two overlapping boxes", () => {
        const r = intersectShape(box(0, 0, 10, 10), box(6, 6, 20, 20));
        expect(loopsArea(r.loops)).toBeCloseTo(16, 9);
        expect(closed(r.loops)).toBe(true);
    });
    test("a circle clipped to a rect that cuts a cap off it", () => {
        const R = { left: -20, top: -20, right: 20, bottom: 3 };
        const r = clipShapeToRect(circle(0, 0, 5), R);
        // the disc minus the segment below y = 3
        const th = 2 * Math.acos(3 / 5);
        const capArea = (25 * (th - Math.sin(th))) / 2;
        expect(loopsArea(r.loops)).toBeCloseTo(PI * 25 - capArea, 6);
        expect(closed(r.loops)).toBe(true);
    });
    test("a rect wholly containing the shape returns it untouched", () => {
        const r = clipShapeToRect(circle(0, 0, 5), { left: -50, top: -50, right: 50, bottom: 50 });
        expect(loopsArea(r.loops)).toBeCloseTo(PI * 25, 9);
    });
});

describe("AS-5 — flatten", () => {
    test("a flattened circle's area approaches the true one from inside", () => {
        for (const tol of [1, 0.1, 0.001]) {
            const rings = flattenShape(circle(0, 0, 100), tol);
            expect(rings.length).toBe(1);
            let a = 0;
            const ring = rings[0];
            for (let i = 0; i < ring.length; i++) {
                const p = ring[i], q = ring[(i + 1) % ring.length];
                a += p[0] * q[1] - q[0] * p[1];
            }
            a /= 2;
            expect(a).toBeLessThanOrEqual(PI * 10000 + 1e-9);        // inscribed
            expect(PI * 10000 - a).toBeLessThan(2 * PI * 100 * tol); // within a rim of width tol
        }
    });
    test("the same arc flattens to the same vertices wherever it is asked from", () => {
        // Two tiles clipping one shape must agree on its vertices or their
        // pieces disagree along the seam. Steps depend on the piece and the
        // tolerance alone, so they do.
        const a = flattenShape(circle(0, 0, 100), 0.05);
        const b = flattenShape(circle(0, 0, 100), 0.05);
        expect(a[0]).toEqual(b[0]);
        expect(a[0].length).toBe(flattenShape(circle(0, 0, 100), 0.05)[0].length);
    });
    test("cubic conversion keeps every piece on its own circle", () => {
        const cubics = shapeToCubics(circle(0, 0, 50));
        let worst = 0;
        for (const loop of cubics) {
            for (const c of loop) {
                for (const t of [0, 0.5, 1]) {
                    const mt = 1 - t;
                    const x = mt * mt * mt * c[0][0] + 3 * mt * mt * t * c[1][0] + 3 * mt * t * t * c[2][0] + t * t * t * c[3][0];
                    const y = mt * mt * mt * c[0][1] + 3 * mt * mt * t * c[1][1] + 3 * mt * t * t * c[2][1] + t * t * t * c[3][1];
                    worst = Math.max(worst, Math.abs(Math.hypot(x, y) - 50));
                }
            }
        }
        expect(worst).toBeLessThan(50 * 2e-4);
    });
});

describe("AS-6 — a real stroke, erased", () => {
    const strokePts = () => {
        const pts = [];
        for (let i = 0; i <= 60; i++) {
            const t = i / 60;
            pts.push([100 + t * 600, 300 + 120 * Math.sin(t * 6)]);
        }
        return pts;
    };
    test("an eraser dragged across a stroke leaves two closed pieces", () => {
        const ink = bakeArcPerimeter(strokePts(), 40, { tol: 0.125 }).loops;
        const before = loopsArea(ink);
        expect(before).toBeGreaterThan(0);
        // a short fat eraser stroke straight down through the middle
        const er = bakeArcPerimeter([[400, 120], [400, 480]], 60, { tol: 0.125 }).loops;
        const r = subtractShape(ink, er);
        expect(r.stats.openChains || 0).toBe(0);
        expect(r.stats.unbalanced || 0).toBe(0);
        expect(r.stats.ambiguous || 0).toBe(0);
        expect(closed(r.loops)).toBe(true);
        expect(shapeComponents(r.loops).length).toBe(2);
        const after = loopsArea(r.loops);
        expect(after).toBeGreaterThan(0);
        expect(after).toBeLessThan(before);
    });
    test("erasing removes exactly the ink the eraser covers", () => {
        // Independent check: the area removed equals the area of ink ∩ eraser.
        const ink = bakeArcPerimeter(strokePts(), 40, { tol: 0.125 }).loops;
        const er = bakeArcPerimeter([[380, 200], [520, 380]], 70, { tol: 0.125 }).loops;
        const left = subtractShape(ink, er).loops;
        const cut = intersectShape(ink, er).loops;
        expect(loopsArea(left) + loopsArea(cut)).toBeCloseTo(loopsArea(ink), 4);
    });
    test("an eraser that only grazes the edge still closes", () => {
        const ink = bakeArcPerimeter(strokePts(), 40, { tol: 0.125 }).loops;
        const er = bakeArcPerimeter([[100, 230], [700, 230]], 8, { tol: 0.125 }).loops;
        const r = subtractShape(ink, er);
        expect(r.stats.openChains || 0).toBe(0);
        expect(closed(r.loops)).toBe(true);
        expect(loopsArea(r.loops)).toBeLessThan(loopsArea(ink));
    });
});

describe("AS-7 — precision at depth", () => {
    test("a hole 1e-9 of its object's size survives, where a lattice would lose it", () => {
        // This is the whole reason the boolean is curve-native. The object spans
        // 2000 units; the hole is 2e-6 across. Clipper's lattice step at this
        // magnitude is ~5e-5 units, so the hole would round away entirely.
        const A = box(-1000, -1000, 1000, 1000);
        const h = 1e-6;
        const r = subtractShape(A, box(-h, -h, h, h));
        expect(r.loops.length).toBe(2);
        expect(loopsArea(r.loops)).toBeCloseTo(4e6 - 4 * h * h, 9);
        expect(shapeComponents(r.loops).length).toBe(1);
    });
    test("geometry a long way from the origin behaves the same as at it", () => {
        const near = subtractShape(circle(0, 0, 10), circle(6, 0, 5));
        const far = subtractShape(circle(1e7, 1e7, 10), circle(1e7 + 6, 1e7, 5));
        // Measure the far one back at the origin. A shoelace over coordinates
        // of 1e7 cancels to ~0.02 of absolute error on an area of 241 — that is
        // the MEASUREMENT's precision, not the geometry's, and comparing them
        // out there would be testing the ruler.
        expect(loopsArea(translateLoops(far.loops, -1e7, -1e7))).toBeCloseTo(loopsArea(near.loops), 6);
        expect(far.stats.openChains || 0).toBe(0);
    });
    test("translate is exact and reversible", () => {
        const A = circle(3, 4, 5);
        const there = translateLoops(A, 1e6, -2e6);
        const back = translateLoops(there, -1e6, 2e6);
        expect(back[0][0].A).toEqual(A[0][0].A);
        expect(spanOf(back)).toBeCloseTo(spanOf(A), 12);
    });
});

describe("AS-8 — the rect loop", () => {
    test("winds positive and has the right area", () => {
        const L = rectLoop({ left: 2, top: 3, right: 12, bottom: 9 });
        expect(loopsArea(L)).toBeCloseTo(60, 12);
    });
});

describe("every loop that leaves the boolean CLOSES", () => {
    // The invariant the document, the renderer and the file format all rely on.
    // An unclosed chain is painted shut with a chord across the object, its
    // winding stops meaning anything, and persistence refuses the drawing.
    const closed = (loops) => loops.every((l) => {
        const last = l[l.length - 1];
        return last.B[0] === l[0].A[0] && last.B[1] === l[0].A[1];
    });
    const ring = (cx, cy, r, w, n = 24) => {
        // A pen-width annulus, built as two concentric circles.
        const outer = [], inner = [];
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            outer.push([cx + (r + w) * Math.cos(a), cy + (r + w) * Math.sin(a)]);
            inner.push([cx + (r - w) * Math.cos(-a), cy + (r - w) * Math.sin(-a)]);
        }
        return normalizeLoops(shapeFromRings([outer, inner]));
    };
    test("a bar cut by an annulus that lands on its edge", () => {
        const bar = rectLoop({ left: 0, top: 0, right: 200, bottom: 40 });
        for (const cy of [0, 10, 20, 20.0001, 40, 39.9999]) {
            const res = subtractShape(bar, ring(100, cy, 30, 10));
            expect(closed(res.loops)).toBe(true);
        }
    });
    test("a bar cut by a knife that stops exactly on its edge", () => {
        const bar = rectLoop({ left: 0, top: 0, right: 200, bottom: 40 });
        for (const y of [0, 1e-9, -1e-9, 40, 40 - 1e-9]) {
            const res = subtractShape(bar, rectLoop({ left: 90, top: y, right: 110, bottom: 100 }));
            expect(closed(res.loops)).toBe(true);
        }
    });
    test("...and the sealed area is reported when a chord had to be used", () => {
        const bar = rectLoop({ left: 0, top: 0, right: 200, bottom: 40 });
        const res = subtractShape(bar, rectLoop({ left: 90, top: -10, right: 110, bottom: 50 }));
        expect(closed(res.loops)).toBe(true);
        expect(res.stats.sealed).toBe(0);          // a clean cut needs no chord
    });
});

/**
 * REPAIR — what a bake that could not close is turned into.
 *
 * The fragments handed over are usually ONE boundary broken once, so the thing
 * being measured is whether the repair understands that. Sealing each fragment
 * where it lies fabricates an edge per fragment, and each is a chord across the
 * whole shape; stitching first fabricates ONE, across the real gap.
 */
describe("repairLoops", () => {
    // A real resolved perimeter, then broken the way a failed stitch breaks one:
    // a piece is missing, and what is left arrives as fragments in walk order.
    const stroke = () => {
        const pts = [];
        for (let i = 0; i < 30; i++) {
            const t = i / 29;
            pts.push([120 + 260 * t, 300 + 70 * Math.sin(t * 4.1)]);
        }
        return bakeArcPerimeter(pts, 16, { tol: 0.125 }).loops[0];
    };
    // Every consecutive pair shares its endpoint BIT FOR BIT, cyclically. The
    // encoding stores each piece's B and hands it to the next as its A, so a
    // join left implicit is not a small error — it moves an arc's endpoint off
    // its own arc, which is the corruption this repair exists to clean up.
    const continuous = (loop) => {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            if (a.B[0] !== b.A[0] || a.B[1] !== b.A[1]) return false;
        }
        return true;
    };
    const chords = (loops) => {
        const out = [];
        for (const l of loops) for (const p of l) {
            if (p.line) out.push(Math.hypot(p.B[0] - p.A[0], p.B[1] - p.A[1]));
        }
        return out;
    };

    test("a loop that already closes is returned untouched, same array", () => {
        const good = [stroke()];
        expect(repairLoops(good, 16)).toBe(good);
    });

    test("fragments of ONE boundary are stitched, then sealed ONCE", () => {
        const loop = stroke();
        const gap = loop[loop.length - 1];              // the piece that went missing
        const want = Math.hypot(gap.B[0] - gap.A[0], gap.B[1] - gap.A[1]);
        const rest = loop.slice(0, -1);
        // Three fragments, in order, exactly as an abandoned walk leaves them.
        const a = Math.floor(rest.length / 3), b = Math.floor((2 * rest.length) / 3);
        const frags = [rest.slice(0, a), rest.slice(a, b), rest.slice(b)];
        const st = {};
        const fixed = repairLoops(frags, 16, st);
        expect(fixed.length).toBe(1);
        const c = chords(fixed);
        expect(c.length).toBe(1);
        expect(c[0]).toBeCloseTo(want, 9);
        expect(st.fragments).toBe(3);
        expect(st.chords).toBe(1);
        // ...and the fabricated edge is the REAL gap, not a chord across the
        // shape: the whole point is that the damage stays the size of the fault.
        expect(c[0]).toBeLessThan(loopPerimeter(fixed[0]) * 0.02);
        expect(loopArea(fixed[0])).toBeGreaterThan(0);
        expect(continuous(fixed[0])).toBe(true);
    });

    test("order does not decide the damage — shuffled fragments seal the same", () => {
        const loop = stroke();
        const rest = loop.slice(0, -1);
        const a = Math.floor(rest.length / 3), b = Math.floor((2 * rest.length) / 3);
        const inOrder = [rest.slice(0, a), rest.slice(a, b), rest.slice(b)];
        const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
        const sa = {}, sb = {};
        const one = repairLoops(inOrder, 16, sa), two = repairLoops(shuffled, 16, sb);
        expect(two.length).toBe(one.length);
        expect(chords(two).length).toBe(1);
        expect(sb.fabricated).toBeCloseTo(sa.fabricated, 6);
        expect(loopArea(two[0])).toBeCloseTo(loopArea(one[0]), 6);
        // Whichever way round they arrive, the seal is CONTINUOUS. Concatenating
        // fragments without bridging closes first-to-last while leaving a hole in
        // the middle of the piece list, which reads as closed and is not.
        expect(continuous(one[0])).toBe(true);
        expect(continuous(two[0])).toBe(true);
    });

    test("a closed hole rides along untouched while a fragment is repaired", () => {
        const loop = stroke();
        const hole = reverseLoop(stroke());            // closed, negative area
        const fixed = repairLoops([loop.slice(0, -1), hole], 16);
        expect(fixed.length).toBe(2);
        // The hole is the SAME pieces it arrived as — nothing stitched onto it.
        const kept = fixed.find((l) => l.length === hole.length);
        expect(kept).toBeTruthy();
        expect(chords(fixed).length).toBe(1);
    });
});
