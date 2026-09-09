/**
 * FG — the freeze is ONE RADIUS (Kobin, 2026-09-06; freeze.js rule 2).
 *
 * "When zoomed in to the edge of the level, the line is frozen if the
 * difference between the curve and a straight line is less than a quarter
 * pixel. Can't that just become a constant arc radius, for the tile diagonal
 * length, where that is true? Then you can just gate it on if the arc radius
 * is greater than that amount, in tile units." — and: "Erasers shouldn't need
 * to re-calculate a freeze; if it's frozen it's frozen. Every arc over that
 * radius in a tile should be frozen — there will never be an arc that needs to
 * be frozen that isn't, unless something else is wrong."
 *
 * What it replaced: a per-piece sagitta test guarded by "does the piece's
 * bow-grown box lie inside the lines this chop applied", which every piece cut
 * ON one of those lines failed by its own bow. So deep arcs were never frozen,
 * survived to where their centres are 1e16 units away, and were cut through
 * those centres: Kobin's crossing jump (F44 — a curved stroke's edge moved a
 * screen at its fifth crossing), and the join-arc case of the corner probe
 * (an erase chorded an arc the chain kept). Measured after: all three corner
 * cases descend to level 8 without losing the edge, bit-identical after the
 * nick, and no arc survives past level 3.
 */
import { useEngines, mkEngine, drawStroke, painted } from "./__testkit__/harness";
import { inks } from "./__testkit__/ink";
import { freezeRadius, chopFreezeLoops, DEFAULT_FREEZE_R } from "./geometry/freeze";
import { TILE } from "./frameLattice";

jest.setTimeout(300000);
useEngines();

const TOL = (0.25 * 0.5) / 256;   // the engine's freeze tolerance: a quarter pixel at a level's deepest zoom

describe("FG-1 — the radius", () => {
    test("at the freeze radius an arc bows by exactly the tolerance over the tile's diagonal, and by less over any shorter chord", () => {
        const R = freezeRadius(TOL);
        const half = (TILE * Math.SQRT2) / 2;
        // Sagitta over a chord of half-length c2, in the form that does not
        // cancel: r − √(r² − c2²) is c2² / (r + √(r² − c2²)), and at r = 9e12
        // the first form's r² swallows c2² whole.
        const bow = (r, c2) => (c2 * c2) / (r + Math.sqrt(r * r - c2 * c2));
        expect(bow(R, half)).toBeCloseTo(TOL, 12);
        expect(bow(R, TILE / 2)).toBeLessThan(TOL);                    // a tile's side
        expect(bow(R * 1.5, half)).toBeLessThan(TOL);
        expect(bow(R / 1.5, half)).toBeGreaterThan(TOL);
        expect(DEFAULT_FREEZE_R).toBe(R);
        expect(R).toBeGreaterThan(8e12);                              // ~8.8e12 units, the same number at every level
        expect(R).toBeLessThan(9e12);
    });
});

describe("FG-2 — the chop freezes by the radius alone", () => {
    // One huge arc across the tile from the left grid line to the right one,
    // closed underneath by lines: the piece a chop leaves for a nearly straight
    // edge, ending ON the lines that cut it.
    const shape = (r, x0 = -TILE / 2, x1 = TILE / 2) => {
        const d = Math.sqrt(r * r - Math.max(x0 * x0, x1 * x1));        // the centre, below the chord
        const C = [0, -d];
        const at = (x) => [x, Math.sqrt(r * r - x * x) - d];           // a point of the circle at abscissa x
        const A = at(x0), B = at(x1);
        const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
        return [[
            { line: false, C, r, a0, sweep: a1 - a0, A, B },
            { line: true, A: B, B: [x1, 50000] },
            { line: true, A: [x1, 50000], B: [x0, 50000] },
            { line: true, A: [x0, 50000], B: A },
        ]];
    };
    const cells = { i0: 0, i1: 0, j0: 0, j1: 0 };
    const arcs = (loops) => loops.flat().filter((p) => !p.line).length;
    test("an arc at or above the radius freezes, one below it does not — however short its own chord", () => {
        const R = freezeRadius(TOL);
        expect(arcs(chopFreezeLoops(shape(R * 1.001), [0, 0], TOL, cells))).toBe(0);
        // (An end a rounding off the line can leave the chop a sliver, so the
        // sub-radius arc may come back as two arcs; what matters is that it
        // comes back as arcs.)
        expect(arcs(chopFreezeLoops(shape(R * 0.999), [0, 0], TOL, cells))).toBeGreaterThanOrEqual(1);
        // A short piece of the sub-radius arc bows by far less than the
        // tolerance, and is still kept: the rule is the radius, not the piece.
        expect(arcs(chopFreezeLoops(shape(R * 0.999, -100, 100), [0, 0], TOL, cells))).toBeGreaterThanOrEqual(1);
        // ...and a piece of the super-radius arc that ends exactly on the
        // chop's lines freezes — the case the old guard refused.
        const out = chopFreezeLoops(shape(R * 1.001), [0, 0], TOL, cells);
        expect(out[0].every((p) => p.line)).toBe(true);
        expect(out[0][0].A).toEqual(shape(R * 1.001)[0][0].A);         // the chord is between the piece's own ends
        expect(out[0][0].B).toEqual(shape(R * 1.001)[0][0].B);
    });
    test("a piece reaching past the outermost line is not measured at all", () => {
        const R = freezeRadius(TOL);
        // The arc runs on past the right line: an unbounded stub, whose chord
        // could be wrong inside the window. The chop cuts it at the line and
        // freezes the inside part; the outside part stays an arc.
        const out = chopFreezeLoops(shape(R * 1.001, -TILE / 2, TILE), [0, 0], TOL, cells);
        const pieces = out[0];
        const inside = pieces.filter((p) => Math.max(p.A[0], p.B[0]) <= TILE / 2 + 1e-6);
        const outside = pieces.filter((p) => Math.max(p.A[0], p.B[0]) > TILE / 2 + 1e-6 && !p.line);
        expect(inside.length).toBeGreaterThan(0);
        expect(inside.every((p) => p.line)).toBe(true);
        expect(outside.length).toBe(1);
    });
});

describe("FG-3 — a curved stroke's edge holds through eight crossings (F44)", () => {
    // Kobin's corner: the join arc of a two-arm stroke, descended on its upper
    // edge one crossing at a time, the edge re-found after every one. Until
    // the gate the edge moved about a thousand pixels at the 4 -> 5 crossing
    // (the level-4 piece was one unfrozen arc of radius ~3e15 that the level-5
    // chop cut through a centre at 1e19) and was lost from then on.
    // The ink's upper boundary on a screen column, as the PICTURE defines it.
    //
    // The winding search (`inks`) finds the transition, and then the boundary
    // is taken from the piece that makes it: a line by interpolation, an arc
    // as the circle through its own two ends with its radius, in the chord
    // frame — which is what the browser draws (an SVG arc command or cubics
    // from the ends, never the centre). The winding query itself locates an
    // arc through its centre, and at r = 5e12 (level 3 of these strokes)
    // that is 0.0036 units off the circle through the ends: 0.9 px at that
    // level's deepest zoom, 1.8 px at the next level's entry zoom, measured
    // 2026-09-06 while the frozen line one level down agreed with the circle
    // through the ends to 0.000 px. The instrument's limit, not the picture's.
    const circleYAt = (p, x) => {
        const A = p.A, B = p.B, dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), half = L / 2, r = Math.abs(p.r);
        const ux = dx / L, uy = dy / L, sg = p.sweep > 0 ? 1 : -1, nx = sg * uy, ny = -sg * ux;
        const Mx = (A[0] + B[0]) / 2, My = (A[1] + B[1]) / 2, d = Math.sqrt((r - half) * (r + half));
        let a = (x - Mx) / ux;
        for (let i = 0; i < 6; i++) { const h = ((half - a) * (half + a)) / (d + Math.sqrt((r - a) * (r + a))); a = (x - Mx - h * nx) / ux; }
        const h = ((half - a) * (half + a)) / (d + Math.sqrt((r - a) * (r + a)));
        return My + a * uy + h * ny;
    };
    const edgeAt = (E, sx, y0, y1) => {
        const list = painted(E);
        const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
        if (ink(y0) || !ink(y1)) return null;
        let lo = y0, hi = y1;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ink(m)) hi = m; else lo = m; }
        const approx = (lo + hi) / 2;
        const f = E.cam.screenToFrame(sx, approx);
        let best = null;
        for (const o of list) {
            if (o.type !== "shape") continue;
            for (const p of o.loops.flatMap((l) => [...l])) {
                if (Math.min(p.A[0], p.B[0]) > f[0] || Math.max(p.A[0], p.B[0]) < f[0] || p.A[0] === p.B[0]) continue;
                const yAt = p.line ? p.A[1] + ((f[0] - p.A[0]) / (p.B[0] - p.A[0])) * (p.B[1] - p.A[1]) : circleYAt(p, f[0]);
                if (best == null || Math.abs(yAt - f[1]) < Math.abs(best - f[1])) best = yAt;
            }
        }
        return best == null ? approx : best * E.cam.inScale + E.cam.inPanY;
    };
    test.each([
        ["the join arc at the corner", [[150, 300], [400, 300], [400, 550]], 401, 290],
        ["a slanted arm", [[150, 350], [400, 300], [400, 550]], 390, 292],
        ["a gentle curve", [[250, 320], [400, 280], [550, 320]], 401, 270],
    ])("%s: at every crossing the edge is where it was, to a twentieth of a pixel", (name, pts, col, yGuess) => {
        const E = mkEngine();
        drawStroke(E, pts, 20);
        let y = edgeAt(E, col, yGuess - 40, yGuess + 10);
        expect(y).not.toBeNull();
        const moved = [];
        for (let d = 0; d < 8; d++) {
            let guard = 0;
            while (E.activeLevel === d && guard++ < 40) E.zoomAt(col, y, -1000);
            expect(E.activeLevel).toBe(d + 1);
            const found = edgeAt(E, col, y - 20, y + 5);
            moved.push(found == null ? null : +(found - y).toFixed(4));
            expect([d + 1, found != null && Math.abs(found - y) < 0.05, moved]).toEqual([d + 1, true, moved]);
            y = found;
            // From the level where the radius is reached down, the stroke's
            // pieces on screen are all lines: no arc is ever positioned through
            // a centre that cannot be computed with.
            if (d + 1 >= 4) {
                const arcsOnScreen = painted(E).filter((o) => o.type === "shape").flatMap((o) => o.loops.flatMap((l) => [...l])).filter((p) => !p.line).length;
                expect([d + 1, arcsOnScreen]).toEqual([d + 1, 0]);
            }
        }
    });
});
