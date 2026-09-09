/**
 * F40 — what a piece becomes in the SVG the browser is handed.
 *
 * Two things a browser can draw a circular arc as: the SVG arc command, exact
 * in form but with a centre the browser rebuilds in float32 (off by 2^-24 of
 * the radius on screen), or kappa cubics, off by 1.8e-5·R·(sweep/n)⁶ for n of
 * them. `arcShape.planArc` chooses at the engine's quarter-pixel tolerance
 * and the frame's deepest zoom: the arc command while it fits (a screen
 * radius up to 4.2 million px), else as many cubics as the sixth root
 * demands. And, with the length split ON (it is off in the app — Chrome's
 * raster drops any path whose curves run past ~1e7 device px, split or not,
 * and the window chop of Renderer.chop.test.js is what ships), any non-seam
 * piece longer than `segMax` units is split into equal parts. This file pins
 * all of that to the `d` strings the renderer actually writes.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { circleLoop } from "./geometry/antRuns";
import { arcCubicCount } from "./geometry/arcShape";
import Renderer from "./Renderer";

useEngines();
// The length split is built and tested but OFF in the app until the
// render-only window chop lands (F40: Chrome's rasteriser dropped a path of
// 32 far-away cubics that the split had made). These tests exercise it on.
beforeAll(() => { Renderer.lengthChop = true; });
afterAll(() => { Renderer.lengthChop = false; });

const svgOf = (E) => E.renderer.two.renderer.domElement;
const ds = (E) => [...svgOf(E).querySelectorAll("path")].map((p) => p.getAttribute("d") || "").filter((d) => d.length);
const count = (s, ch) => (s.match(new RegExp(ch, "g")) || []).length;
const arcAt = (cx, cy, r, a0, sweep) => ({
    line: false, C: [cx, cy], r, a0, sweep,
    A: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
    B: [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)],
});
// A circle as n equal arcs.
const ring = (cx, cy, r, n) => { const step = (2 * Math.PI) / n; return Array.from({ length: n }, (_, i) => arcAt(cx, cy, r, i * step, step)); };
const L = (A, B) => ({ line: true, A, B });
let nextId = 500000;
const addShape = (E, loops, extra = {}) => {
    const id = nextId++;
    E.doc.add({ type: "shape", id, origin: "native", color: "#123456", opacity: 1, loops, ...extra }, E.cam.frame);
    E._render();
    return id;
};
// The radius, in frame units, above which the arc command no longer fits a
// quarter pixel at the frame's deepest zoom: 2^-24 · r · 256 > 0.25.
const BIG = 20000;

describe("what an arc becomes in the SVG (F40)", () => {
    test("the plan's constants for the default config, with and without the length split", () => {
        const E = mkEngine();
        expect(E.renderer._arcPlan).toEqual({ enter: 256, tol: 0.25, segMax: 8192 });
        Renderer.lengthChop = false;
        try {
            const E2 = mkEngine();
            expect(E2.renderer._arcPlan).toEqual({ enter: 256, tol: 0.25, segMax: 0 });
        } finally { Renderer.lengthChop = true; }
    });

    test("a circle of two half turns is two arc commands and no cubic", () => {
        const E = mkEngine();
        addShape(E, [circleLoop(400, 300, 50)]);
        const d = ds(E).join(" ");
        expect(count(d, "A")).toBe(2);
        expect(count(d, "C")).toBe(0);
        expect(d).toMatch(/A 50 50 0 0 1 /);   // radius as given, both halves the same way round
    });

    test("a single full-circle piece is split into two arc commands (identical endpoints would draw nothing)", () => {
        const E = mkEngine();
        addShape(E, [[arcAt(400, 300, 50, 0, 2 * Math.PI)]]);
        const d = ds(E).join(" ");
        expect(count(d, "A")).toBe(2);
        expect(count(d, "C")).toBe(0);
    });

    test("an ordinary circle is arc commands whatever its pieces' sweeps", () => {
        for (const n of [4, 16, 18]) {
            const E = mkEngine();
            addShape(E, [ring(400, 300, 50, n)]);
            const d = ds(E).join(" ");
            expect(count(d, "A")).toBe(n);
            expect(count(d, "C")).toBe(0);
        }
    });

    test("a circle too big for the arc command is cubics, as many per piece as the sixth root demands", () => {
        const E = mkEngine();
        addShape(E, [ring(400, 300, BIG, 4)]);
        const d = ds(E).join(" ");
        const { segMax } = E.renderer._arcPlan;
        const perQuarter = Math.max(Math.ceil((BIG * Math.PI / 2) / segMax), arcCubicCount(Math.PI / 2, BIG * 256, 0.25));
        expect(perQuarter).toBe(5);   // 4.2 by the law, rounded up; the length split would allow 4
        expect(count(d, "C")).toBe(4 * perQuarter);
        expect(count(d, "A")).toBe(0);
    });

    test("a cubic's first handle lands on the anchor before it, whatever that anchor's command", () => {
        // 20° after the move, a quarter turn, 20° more, then a long line back:
        // every C must carry three real control points, none collapsed onto
        // an anchor (which is what a missing outgoing handle would look like).
        const E = mkEngine();
        const step = Math.PI / 9;
        const a1 = arcAt(400, 300, BIG, 0, step), a2 = arcAt(400, 300, BIG, step, Math.PI / 2), a3 = arcAt(400, 300, BIG, step + Math.PI / 2, step);
        const back = L(a3.B, a1.A);
        addShape(E, [[a1, a2, a3, back]]);
        const d = ds(E).join(" ");
        expect(count(d, "A")).toBe(0);
        expect(count(d, "C")).toBe(1 + 5 + 1);
        const cs = d.match(/C [^ACLMZ]+/g);
        for (const c of cs) {
            const nums = c.slice(1).trim().split(/\s+/).map(Number);
            expect(nums.length).toBe(6);
            expect(nums.every(Number.isFinite)).toBe(true);
        }
        const first = cs[0].slice(1).trim().split(/\s+/).map(Number);
        const startY = Number(d.match(/M [^ ]+ ([^ ]+)/)[1]);
        // a1 starts at (400 + BIG, 300); its first handle points up the tangent,
        // so it differs from the start in y (the world origin shifts x and y alike).
        expect(Math.abs(first[1] - startY)).toBeGreaterThan(1);
        // The line back is 36,000 units: five parts of at most segMax.
        expect(count(d, "L")).toBe(Math.ceil(Math.hypot(back.B[0] - back.A[0], back.B[1] - back.A[1]) / E.renderer._arcPlan.segMax));
    });

    test("a long straight edge is split into parts no longer than segMax; a seam never is", () => {
        // A 100,000 × 10 sliver: two long edges, two short ones.
        const box = [[0, 0], [100000, 0], [100000, 10], [0, 10]];
        const loop = [L(box[0], box[1]), L(box[1], box[2]), L(box[2], box[3]), L(box[3], box[0])];
        const E = mkEngine();
        addShape(E, [loop]);
        let d = ds(E).join(" ");
        const n = Math.ceil(100000 / E.renderer._arcPlan.segMax);
        expect(n).toBe(13);
        expect(count(d, "L")).toBe(2 * n + 2);

        // The same sliver as a tile piece whose clip IS that rectangle: every
        // edge lies on the rectangle that cut it, so every edge is a seam and
        // none is split — the neighbour overlaps it by the seam pad.
        const E2 = mkEngine();
        addShape(E2, [loop], { clip: { left: 0, top: 0, right: 100000, bottom: 10 } });
        d = ds(E2).join(" ");
        expect(count(d, "L")).toBe(4);
    });

    test("a covering quad is never split: its edges are the tile's own boundary", () => {
        const E = mkEngine();
        const poly = [[-60000, -60000], [60000, -60000], [60000, 60000], [-60000, 60000]];
        E.doc.add({ type: "fill", id: nextId++, origin: "native", color: "#000000", opacity: 1, polys: [poly], covers: true }, E.cam.frame);
        E._render();
        let d = ds(E).join(" ");
        expect(count(d, "L")).toBe(3);   // a move and three lines; the fill closes it
        // The same square as plain ink: every 120,000-unit edge is split, the closing one too.
        const E2 = mkEngine();
        E2.doc.add({ type: "fill", id: nextId++, origin: "native", color: "#000000", opacity: 1, polys: [poly] }, E2.cam.frame);
        E2._render();
        d = ds(E2).join(" ");
        expect(count(d, "L")).toBe(4 * Math.ceil(120000 / E2.renderer._arcPlan.segMax));
    });

    test("a big arc is split by length as well as by the law, whichever asks for more", () => {
        const E = mkEngine();
        const r = 100000;
        addShape(E, [circleLoop(400, 300, r)]);
        const d = ds(E).join(" ");
        const { segMax } = E.renderer._arcPlan;
        const perHalf = Math.max(Math.ceil((r * Math.PI) / segMax), arcCubicCount(Math.PI, r * 256, 0.25));
        expect(perHalf).toBe(39);   // 39 by length, 12 by the law
        expect(count(d, "C")).toBe(2 * perHalf);
    });

    test("the thin rescale scales an arc's radius with its anchors", () => {
        // A circle far too small for the browser's float32 raster: the group
        // is rescaled by a power of two, and the `A` radius must follow, or the
        // arc would be drawn at the wrong size under the group's transform.
        const E = mkEngine();
        addShape(E, [circleLoop(400, 300, 0.01)]);
        const svg = svgOf(E);
        const path = [...svg.querySelectorAll("path")].find((p) => /A /.test(p.getAttribute("d") || ""));
        expect(path).toBeTruthy();
        const r = Number(path.getAttribute("d").match(/A ([^ ]+) /)[1]);
        const m = (path.parentElement.getAttribute("transform") || "").match(/matrix\(([^ ,]+)/);
        const groupScale = m ? Number(m[1]) : 1;
        expect(groupScale).toBeLessThan(1);           // the rescale did apply
        expect(r * groupScale).toBeCloseTo(0.01, 9);   // and the radius rode along
    });
});
