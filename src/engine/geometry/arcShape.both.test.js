/**
 * `shapeBoolean(A, B, "both")` is the two calls it replaces, to the bit (REVIEWER-3 EFF-1: one
 * cut-and-classify pass for an erase cut's A − B and its `removed` A ∩ B, −44 % over 250 pairs).
 * Each result retries at the weld its own call would; the pairs here include near-coincident
 * translates, where the retries happen.
 */
import { useEngines, mkEngine, drawStroke } from "../__testkit__/harness";
import { shapeBoolean, encodeLoops, translateLoops, insideShape, insideTester, loopsBBox } from "./arcShape";

useEngines();

const sig = (r) => JSON.stringify({ loops: r.loops.map((l) => Array.from(encodeLoops([l]).buf || encodeLoops([l]))), open: (r.stats && r.stats.openChains) || 0, retried: (r.stats && r.stats.retriedAt) || 0 });

test("B1 A − B and A ∩ B from one pass equal the separate calls, near-coincident pairs included", () => {
    const E = mkEngine();
    const shapes = [];
    for (let i = 0; i < 6; i++) {
        const pts = [];
        for (let k = 0; k <= 60; k++) { const t = k / 60; pts.push([150 + t * 500, 120 + i * 70 + 25 * Math.sin(t * 17 + i) + 9 * Math.sin(t * 53)]); }
        const o = drawStroke(E, pts, 6 + 5 * i);
        shapes.push(o.loops);
    }
    const pairs = [];
    for (let a = 0; a < shapes.length; a++) {
        for (let b = 0; b < shapes.length; b++) if (a !== b) pairs.push([shapes[a], shapes[b]]);
        for (const d of [1e-9, 1e-6, 0.0045, 0.5, 3]) pairs.push([shapes[a], translateLoops(shapes[a], d, -d / 20)]);
    }
    let retried = 0;
    for (const [A, B] of pairs) {
        const both = shapeBoolean(A, B, "both");
        const d = shapeBoolean(A, B, "difference"), x = shapeBoolean(A, B, "intersection");
        expect(sig(both.difference)).toBe(sig(d));
        expect(sig(both.intersection)).toBe(sig(x));
        if (d.stats && d.stats.retriedAt) retried++;
    }
    expect(pairs.length).toBeGreaterThan(50);
    void retried;
});

test("B2 insideTester answers insideShape for every point, on the boundary's neighbourhood too (EFF-2)", () => {
    const E = mkEngine();
    const pts = [];
    for (let k = 0; k <= 80; k++) { const t = k / 80; pts.push([150 + t * 500, 300 + 40 * Math.sin(t * 19) + 11 * Math.sin(t * 61)]); }
    const o = drawStroke(E, pts, 14);
    const b = loopsBBox(o.loops), test = insideTester(o.loops);
    let n = 0, inside = 0;
    for (let i = 0; i <= 120; i++) for (let j = 0; j <= 60; j++) {
        const p = [b.x0 - 3 + ((b.x1 - b.x0 + 6) * i) / 120, b.y0 - 3 + ((b.y1 - b.y0 + 6) * j) / 60];
        const want = insideShape(o.loops, p);
        expect(test(p)).toBe(want);
        n++; if (want) inside++;
    }
    expect(inside).toBeGreaterThan(50);
    expect(n - inside).toBeGreaterThan(50);
});

