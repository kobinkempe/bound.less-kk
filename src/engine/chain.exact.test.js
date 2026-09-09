/**
 * CX — the magnify chain carries EXACT ARCS, at every depth. This is F-A.
 *
 * WHAT F-A WAS. A tile is built from its PARENT TILE, so whatever a tile holds
 * is what the next level down inherits. The chain used to flatten a shape to a
 * polygon at the first magnification, which looks harmless — the polygon is
 * within a quarter pixel of the curve at the moment it is made — and is not,
 * because a chord is only a valid stand-in for the span it was fitted to and
 * the next level magnifies ONE of those chords to fill the screen. Measured on
 * the pre-change build, drawing one 42-arc stroke and descending:
 *
 *   | depth | what painted it   | rendered edge, against the shape's own geometry |
 *   |-------|-------------------|--------------------------------|
 *   | 0     | the real shape    | exact                          |
 *   | 1     | a 793-pt polygon  | 0.855 px                       |
 *   | 2     | a 5-POINT polygon | 263 px                         |
 *   | 3-4   | a 5-point polygon | the edge is not on screen      |
 *
 * The flatten was not one approximation. It was about eight hundred of them,
 * every one made for a span the camera was about to zoom past, and by depth 2
 * one of those sub-chords HAD BECOME the object.
 *
 * The fix is that clipping an exact arc to a tile gives an exact sub-arc, so
 * there is no reason to flatten in the chain at all. Nothing is frozen to a
 * line anywhere along it; that happens once, at paint, against nothing that is
 * stored, so it can never be inherited by anything.
 */
import {
    useEngines, mkEngine, drawStroke, descend, ascend, camShot, camRestore,
} from "./__testkit__/harness";
import { pieceInks } from "./__testkit__/ink";
import { insideShape, loopsBBox } from "./geometry/arcShape";

jest.setTimeout(300000);
useEngines();

// Every piece the view is painting that came from `id`.
const piecesFor = (E, id) => E._objs().filter((o) => o.id === id);
// Is the point painted, according to what is actually on screen?
const paintedAt = (E, id, p) => piecesFor(E, id).some((o) => pieceInks(o, p));

describe("CX-1 — a magnified shape stays a shape", () => {
    test("no depth turns the perimeter into a handful of chords", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 260], [330, 340], [470, 250], [600, 330]], 26);
        const arcsAtHome = o.loops.reduce((n, l) => n + l.length, 0);
        expect(arcsAtHome).toBeGreaterThan(10);

        for (let d = 1; d <= 4; d++) {
            descend(E, d, 400, 296);
            E._render();
            const mine = piecesFor(E, o.id);
            expect(mine.length).toBeGreaterThan(0);
            // Every piece is either a resolved perimeter or a tile-covering
            // quad — never a polygon standing in for a curve.
            for (const p of mine) {
                if (p.type === "fill") { expect(p.covers).toBe(true); continue; }
                expect(p.type).toBe("shape");
            }
        }
    });
});

describe("CX-2 — the F-A table, re-measured", () => {
    // The shape's OWN geometry, carried down the same edges, is the oracle: it
    // is exact by construction (a similarity maps a circle to a circle), and it
    // is what the pre-change build's tiles drifted 263 px away from.
    test("what is painted agrees with the shape itself, at every depth", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 260], [330, 340], [470, 250], [600, 330]], 26);
        const home = E.cam.frame;

        for (let d = 1; d <= 4; d++) {
            descend(E, d, 400, 296);
            E._render();
            const truth = E.lm.projectF(o, home, E.cam.frame);
            expect(truth).toBeTruthy();

            // Sample the visible window. Skip anything within a whisker of the
            // true edge: a point ON a boundary has no answer, and this is a
            // statement about where the edge IS, not about a tie-break.
            const b = loopsBBox(truth.loops);
            let checked = 0, wrong = 0;
            for (let a = 0; a < 28; a++) {
                for (let c = 0; c < 22; c++) {
                    const p = E.cam.screenToFrame((a + 0.5) * (800 / 28), (c + 0.5) * (600 / 22));
                    if (!b || p[0] < b.x0 - 1 || p[0] > b.x1 + 1 || p[1] < b.y0 - 1 || p[1] > b.y1 + 1) continue;
                    const want = insideShape(truth.loops, p);
                    // a half-pixel ring around the sample: on the edge, skip
                    const eps = 0.5 / E.cam.inScale;
                    const near = insideShape(truth.loops, [p[0] + eps, p[1]]) !== want
                        || insideShape(truth.loops, [p[0] - eps, p[1]]) !== want
                        || insideShape(truth.loops, [p[0], p[1] + eps]) !== want
                        || insideShape(truth.loops, [p[0], p[1] - eps]) !== want;
                    if (near) continue;
                    checked++;
                    if (paintedAt(E, o.id, p) !== want) wrong++;
                }
            }
            expect([d, checked > 40]).toEqual([d, true]);   // the sampling saw the edge
            expect([d, wrong]).toEqual([d, 0]);
        }
    });
});

// Where the shape's boundary crosses a vertical line, at home coordinates.
// Descending about this point is what keeps the EDGE on screen: magnified a few
// thousand times, ink drawn anywhere else floods the whole window and there is
// no edge left to measure.
const edgeY = (loops, x, from, to) => {
    // Scan for a bracket first. A spline's boundary is not where the samples
    // suggest, and a bisection handed a bracket that does not straddle it
    // silently returns the middle of nothing.
    const N = 256;
    let pa = from, va = insideShape(loops, [x, pa]);
    for (let k = 1; k <= N; k++) {
        const pb = from + ((to - from) * k) / N;
        const vb = insideShape(loops, [x, pb]);
        if (vb !== va) {
            let a = pa, b = pb;
            for (let n = 0; n < 60; n++) {
                const m = (a + b) / 2;
                if (insideShape(loops, [x, m]) === va) a = m; else b = m;
            }
            return (a + b) / 2;
        }
        pa = pb; va = vb;
    }
    return null;
};

describe("CX-3 — the rendered edge, in pixels", () => {
    test("the painted edge sits exactly where the shape says", () => {
        // The F-A table's own measurement. Bisect down a vertical ray for the
        // place where the PAINTED answer flips, do the same against the shape's
        // own geometry carried down the same edges, and report the gap in screen
        // pixels. The pre-change build gave 0.855 px at depth 1 and 263 px at
        // depth 2.
        //
        // HOW FAR THIS ORACLE IS GOOD FOR, which is the whole reason the chain
        // exists (bible section 4.1). Projecting the WHOLE object into a deep
        // frame in one hop puts its far side at 6e16 units, where a float64 ulp
        // is thirteen units — so past about three crossings the projection is
        // quantized and it is the ORACLE that is wrong, not the tiles. Measured:
        // the "true" edge comes back on a ~1056-unit grid at depth 4. So this
        // compares only while the oracle is sharp, and CX-5 takes over after.
        const E = mkEngine();
        const o = drawStroke(E, [[200, 260], [330, 340], [470, 250], [600, 330]], 26);
        const home = E.cam.frame;
        const ey = edgeY(o.loops, 400, 150, 400);
        expect(ey).toBeTruthy();
        const worst = [];

        for (let d = 1; d <= 3; d++) {
            descend(E, d, 400, ey);
            E._render();
            const truth = E.lm.projectF(o, home, E.cam.frame);
            // The oracle's own resolution at this depth, in screen px. Past a
            // fraction of a pixel it has stopped being an oracle.
            const tb = loopsBBox(truth.loops);
            const mag = Math.max(Math.abs(tb.x0), Math.abs(tb.x1), Math.abs(tb.y0), Math.abs(tb.y1));
            const oraclePx = mag * Number.EPSILON * E.cam.inScale;
            expect([d, oraclePx < 0.05]).toEqual([d, true]);

            let worstPx = 0, rays = 0;
            // Rays stay INSIDE the visible window: pieces are clipped to tiles,
            // so a ray starting outside would bisect for a tile edge rather than
            // for the ink edge and measure the wrong thing.
            const win = E.cam.frameWindow(-8 / E.cam.inScale);
            for (let k = 0; k < 24; k++) {
                const x = win.left + ((k + 0.5) / 24) * (win.right - win.left);
                const t = edgeY(truth.loops, x, win.top, win.bottom);
                if (t == null) continue;
                let a = win.top, b = win.bottom;
                if (paintedAt(E, o.id, [x, a]) === paintedAt(E, o.id, [x, b])) continue;
                for (let n = 0; n < 60; n++) {
                    const m = (a + b) / 2;
                    if (paintedAt(E, o.id, [x, m]) === paintedAt(E, o.id, [x, a])) a = m; else b = m;
                }
                rays++;
                worstPx = Math.max(worstPx, Math.abs((a + b) / 2 - t) * E.cam.inScale);
            }
            worst.push([d, rays, +worstPx.toFixed(9)]);
            expect([d, rays > 0]).toEqual([d, true]);
            // THE BUDGET IS THE FREEZE, AND NOTHING ELSE.
            //
            // Exact while every piece is still an arc — depth 1 always is, and
            // that is asserted on the nose, because it is the depth F-A first
            // showed at (0.855 px). Once D2's freeze fires the painted edge is
            // the CHORD, and it is allowed to sit a quarter of a pixel from the
            // curve it replaced: that is the swap of source of truth, and the
            // number is chosen so it cannot be seen at the moment it happens.
            //
            // Below the freeze this oracle is measuring against a PHANTOM — the
            // arc the chord replaced, which nothing in the system can consult
            // any more (bible 4.3). What it can still tell us, and what F-A
            // failed, is that the gap does not MULTIPLY: 0.855 px, then 263 px,
            // then off screen was an approximation being inherited and magnified
            // 4096 times a level. A quarter pixel at every depth is the claim.
            expect([d, worstPx <= E.cfg.arcTolerancePx]).toEqual([d, true]);
            // "On the nose" was EXACTLY zero until 2026-09-07, because the
            // painted piece and the oracle's piece are sub-arcs of one circle
            // and the winding query asked both through the same centre — the
            // same arithmetic on the same numbers. The query now asks an arc
            // in its own CHORD frame (`arcShape.rayCross`, roadmap item 5),
            // and a tile's fragment and the whole arc have different chords,
            // so the two answers round differently: measured 9.8e-11 px here,
            // 4e-7 at depth 2. That is rounding, not an inherited chord — the
            // thing this line exists to catch is 0.855 px.
            if (d === 1) expect([d, worstPx < 1e-6]).toEqual([d, true]);
        }
        // eslint-disable-next-line no-console
        console.log("CX-3 rendered edge error [depth, rays, px]:", JSON.stringify(worst));
    });
});

describe("CX-4 — a curve stays a curve for as long as it is one", () => {
    test("curvature survives every magnification at which it is visible", () => {
        // D2 keeps the freeze for cheapness, and section 3.1a proved it is an
        // optimisation rather than a necessity. What must never happen is a
        // freeze the chain INHERITS — a chord stored in a tile becomes the
        // object one level down, which is F-A.
        //
        // "Still curved at depth 4" is the wrong thing to ask for, and asking it
        // would be superstition rather than a test. Magnify a circle of radius
        // 175 four times and its radius is 4.9e16 units while the window is a
        // few thousand across: the visible sagitta is 6e-11 units, which is not
        // a curve by any definition a screen can hold. So the requirement is
        // exact: curvature is preserved at every depth where the visible arc
        // deviates from its chord by as much as a quarter of a pixel.
        const E = mkEngine();
        const pts = [];
        for (let i = 0; i <= 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            pts.push([400 + 160 * Math.cos(a), 300 + 160 * Math.sin(a)]);
        }
        const o = drawStroke(E, pts, 30);
        expect(o.loops.reduce((n, l) => n + l.filter((q) => !q.line).length, 0)).toBeGreaterThan(8);
        const ey = edgeY(o.loops, 400, 60, 300);
        expect(ey).toBeTruthy();

        const seen = [];
        for (let d = 1; d <= 4; d++) {
            descend(E, d, 400, ey);
            E._render();
            const mine = piecesFor(E, o.id).filter((q) => q.type === "shape");
            expect([d, mine.length > 0]).toEqual([d, true]);
            const curved = mine.reduce((n, q) => n + q.loops.reduce((m, l) => m + l.filter((z) => !z.line).length, 0), 0);
            // How much the widest visible arc actually bends, in screen px.
            let sagPx = 0;
            for (const q of mine) {
                for (const l of q.loops) {
                    for (const z of l) {
                        if (z.line || !isFinite(z.r) || !(z.r > 0)) continue;
                        const c = Math.hypot(z.B[0] - z.A[0], z.B[1] - z.A[1]);
                        sagPx = Math.max(sagPx, (c * c) / (8 * z.r) * E.cam.inScale);
                    }
                }
            }
            seen.push([d, curved, +sagPx.toFixed(6)]);
            if (sagPx >= 0.25) expect([d, curved > 0]).toEqual([d, true]);
        }
        // ...and it really did bend somewhere, or the test proved nothing.
        expect(seen.some(([, c, sag]) => c > 0 && sag >= 0.25)).toBe(true);
        // eslint-disable-next-line no-console
        console.log("CX-4 [depth, arc pieces, visible sagitta px]:", JSON.stringify(seen));
    });
});

describe("CX-5 — the chain agrees with itself across a crossing, at any depth", () => {
    test("the same world points read the same before and after every crossing", () => {
        // Past about three crossings there is no independent oracle left — a
        // one-hop projection of the whole object is quantized by then (CX-3),
        // which is precisely why tiles chain one edge at a time. What CAN be
        // asked at any depth is self-consistency: cross, and the picture at the
        // same world points must not change. F-A showed up here as a step of
        // hundreds of pixels at exactly this moment.
        const E = mkEngine();
        const o = drawStroke(E, [[200, 260], [330, 340], [470, 250], [600, 330]], 26);
        const ey = edgeY(o.loops, 400, 150, 400);
        const steps = [];

        for (let d = 1; d <= 6; d++) {
            // Probes have to be chosen in the DEEPER view and carried up: a
            // crossing shrinks the visible world by the crossing ratio, so a
            // grid spread over the shallower window has essentially none of its
            // points still on screen afterwards.
            descend(E, d + 1, 400, ey);
            E._render();
            const deep = E.cam.frame, deepShot = camShot(E);
            const win = E.cam.frameWindow(-16 / E.cam.inScale);
            const probes = [];
            for (let a = 0; a < 12; a++) {
                for (let c = 0; c < 10; c++) {
                    probes.push([win.left + ((a + 0.5) / 12) * (win.right - win.left),
                        win.top + ((c + 0.5) / 10) * (win.bottom - win.top)]);
                }
            }
            // A point ON the edge has no answer, and a crossing is exactly where
            // a half-pixel disagreement about which side it is on shows up. Ask
            // only about points that are unambiguous at this zoom.
            const px = 1 / E.cam.inScale;
            const deepAns = probes.map((q) => {
                const v = paintedAt(E, o.id, q);
                const firm = paintedAt(E, o.id, [q[0] + px, q[1]]) === v
                    && paintedAt(E, o.id, [q[0] - px, q[1]]) === v
                    && paintedAt(E, o.id, [q[0], q[1] + px]) === v
                    && paintedAt(E, o.id, [q[0], q[1] - px]) === v;
                return firm ? v : null;
            });

            // ...and the same points, one level up.
            ascend(E, d, 400, 300);
            E._render();
            const up = E.cam.frame;
            let checked = 0, wrong = 0;
            probes.forEach((q, i) => {
                const r = E.lm.mapPointF(q, deep, up);
                if (!r) return;
                const w2 = E.cam.frameWindow();
                if (r[0] < w2.left || r[0] > w2.right || r[1] < w2.top || r[1] > w2.bottom) return;
                if (deepAns[i] === null) return;      // sat on the edge down there
                // ...and it has to be unambiguous UP HERE too, which is the
                // harder condition: one pixel at this level is R pixels' worth
                // of world at the deeper one, so a point comfortably clear of
                // the edge below can be sitting right on it here.
                const upPx = 1 / E.cam.inScale;
                const v = paintedAt(E, o.id, r);
                if (paintedAt(E, o.id, [r[0] + upPx, r[1]]) !== v
                    || paintedAt(E, o.id, [r[0] - upPx, r[1]]) !== v
                    || paintedAt(E, o.id, [r[0], r[1] + upPx]) !== v
                    || paintedAt(E, o.id, [r[0], r[1] - upPx]) !== v) return;
                checked++;
                if (v !== deepAns[i]) wrong++;
            });
            steps.push([d, checked, wrong]);
            expect([d, checked > 8]).toEqual([d, true]);
            expect([d, wrong]).toEqual([d, 0]);
            camRestore(E, deepShot);
        }
        // eslint-disable-next-line no-console
        console.log("CX-5 [crossing, points compared, disagreements]:", JSON.stringify(steps));
    });
});
