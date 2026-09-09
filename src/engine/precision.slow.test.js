/**
 * PR — PRECISION: pixellation, hairline cracks, and shapes that move.
 *
 * Three symptoms reported from real use, which turned out to have two distinct
 * causes. Both are measured here rather than described, because all three
 * symptoms are invisible to a structural test — the object count is right, the
 * families are right, the ink is all present, and it still looks wrong.
 *
 *   CAUSE 1 — the integer lattice was anchored at the FRAME ORIGIN, so booleans
 *   lost precision in proportion to how far the drawing had been panned. Fixed
 *   (geometry/clipperBoolean localFrame; pinned in geometry/lattice.test.js).
 *   It produced both pixellation AND "the shape changed where I didn't touch
 *   it", because a boolean re-quantizes its whole subject, not just the cut.
 *
 *   CAUSE 2 — a cut used to be STORED as a flat polygon, frozen at the fidelity
 *   of the level it was cut at. That is gone: a cut produces ARCS, which are
 *   re-flattened per level at that level's own tolerance. PR-4 measures it.
 *
 * The measurement style throughout: find the ink's edge to a fraction of a pixel
 * by bisection, and compare. "The raster looks the same" is far too coarse to
 * see any of this.
 */
import {
    useEngines, mkEngine, drawStroke, erase, drag, click, pan,
    descend, camShot, camRestore, painted, natives, families,
} from "./__testkit__/harness";
import { pieceInks, inks } from "./__testkit__/ink";
import { transformLoops, clipShapeToRect, arcSteps, ptAt } from "./geometry/arcShape";
import { shapeTol } from "./geometry/derive";

jest.setTimeout(600000);
useEngines();

const BLUE = "#1133cc";
const FAR = 6e5;          // ~20 screens of panning at 1:1 — an ordinary amount

/**
 * Every screen-y where ink starts or stops down column `sx`, to 1/256 px.
 * This is the instrument: a shape that "changed" moved one of these.
 */
function edgesAt(E, sx, y0 = 0, y1 = 600) {
    const list = painted(E);
    const ink = (sy) => list.some((o) => pieceInks(o, E.cam.screenToFrame(sx, sy)));
    const out = [];
    let prev = ink(y0);
    for (let sy = y0; sy <= y1; sy += 0.25) {
        const now = ink(sy);
        if (now !== prev) {
            let lo = sy - 0.25, hi = sy;
            for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ink(m) === prev) lo = m; else hi = m; }
            out.push((lo + hi) / 2);
            prev = now;
        }
    }
    return out;
}
/**
 * The same instrument, scanning a ROW. Needed at depth: one crossing down the
 * band is 3000x the screen, so a column scan finds no edge anywhere — the
 * canvas is entirely inside the ink. What IS on screen down there is the hole,
 * and a row through it has two walls.
 */
function edgesAtRow(E, sy, x0 = 0, x1 = 800) {
    const list = painted(E);
    const ink = (sx) => list.some((o) => pieceInks(o, E.cam.screenToFrame(sx, sy)));
    const out = [];
    let prev = ink(x0);
    for (let sx = x0; sx <= x1; sx += 0.25) {
        const now = ink(sx);
        if (now !== prev) {
            let lo = sx - 0.25, hi = sx;
            for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ink(m) === prev) lo = m; else hi = m; }
            out.push((lo + hi) / 2);
            prev = now;
        }
    }
    return out;
}
const shift = (a, b) => {
    expect(b.length).toBe(a.length);          // an edge appearing or vanishing IS a shape change
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
};
/** Widest un-inked sliver found sweeping a row that should be solid ink. */
function widestGap(E, sy, x0 = 0, x1 = 800, step = 0.25) {
    const list = painted(E);
    let worst = 0, start = null, sawInk = false;
    // `inks`, not `pieceInks`: where two natives of one family ABUT EXACTLY —
    // two kids ceded from neighbouring cache squares (F42), meeting on the
    // square's edge to the bit — a probe standing on that line is strictly
    // inside neither, while the renderer draws the family as one path and
    // paints the line. That rule lives in the oracle (ink.js) for exactly this
    // reason; measured here 2026-09-04 as a 0.25 px "crack" at a seam the
    // browser does not have.
    for (let sx = x0; sx <= x1; sx += step) {
        const inked = inks(list, E.cam.screenToFrame(sx, sy));
        if (inked) { sawInk = true; if (start != null) { worst = Math.max(worst, sx - start); start = null; } }
        else if (sawInk && start == null) start = sx;
    }
    return worst;
}

describe("PR-1 — an erase does not move the parts of the shape it did not touch", () => {
    // The reported "shapes changing after being erased". A boolean rewrites
    // every vertex of its subject, so a coarse lattice moves the far end of a
    // stroke as a side effect of cutting the near end.
    test.each([[0], [1e5], [FAR], [4e6]])("panned %p from the origin", (far) => {
        const E = mkEngine();
        pan(E, -far, 0);
        drawStroke(E, [[100.4, 300.4], [700.4, 300.4]], 90, BLUE);
        const before = edgesAt(E, 180);
        expect(before.length).toBe(2);
        erase(E, [[640, 240], [640, 360]], 20);        // cut the FAR end
        expect(shift(before, edgesAt(E, 180))).toBeLessThanOrEqual(0.02);
    });
    test("...and ten erases in a row do not walk it away", () => {
        const E = mkEngine();
        pan(E, -4e6, 0);
        drawStroke(E, [[100.4, 300.4], [700.4, 300.4]], 90, BLUE);
        const before = edgesAt(E, 140);
        for (let i = 0; i < 10; i++) erase(E, [[300 + i * 38, 250], [300 + i * 38, 290]], 9);
        expect(shift(before, edgesAt(E, 140))).toBeLessThanOrEqual(0.02);
    });
});

describe("PR-2 — a move does not change the shape", () => {
    // The reported "shapes changing after being moved", including the case that
    // prompted it: moving after a deep zoom.
    test.each([[0], [1], [2], [3]])("erased at depth %i, then dragged and put back", (d) => {
        const E = mkEngine();
        pan(E, -FAR, 0);
        drawStroke(E, [[100.4, 300.4], [700.4, 300.4]], 90, BLUE);
        descend(E, d, 400, 300);
        // A NICK, not a through-cut: at depth 0 a full-height cut severs the
        // band, and then dragging one half legitimately changes the edge count.
        // The subject here is whether geometry MOVES, so keep it one object.
        erase(E, [[400, 240], [400, 280]], 18);
        // Scan the row through the hole: it has two walls at every depth,
        // whereas the band's own edges leave the canvas once magnified.
        const before = edgesAtRow(E, 260);
        expect(before.length).toBeGreaterThanOrEqual(2);
        click(E, 200, 300);
        drag(E, [200, 300], [260, 300]);
        pan(E, -60, 0);                                 // exactly undo it on screen
        expect(families(E)).toBe(1);
        expect(shift(before, edgesAtRow(E, 260))).toBeLessThanOrEqual(0.02);
    });
    test("a move at depth does not disturb the shape seen from the top", () => {
        const E = mkEngine();
        pan(E, -FAR, 0);
        drawStroke(E, [[100.4, 300.4], [700.4, 300.4]], 90, BLUE);
        const home = camShot(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        const before = edgesAt(E, 200);
        descend(E, 3, 400, 300);
        click(E, 200, 300);
        drag(E, [200, 300], [260, 340]);                // a move so small it is
        camRestore(E, home);                            // sub-pixel from up here
        expect(shift(before, edgesAt(E, 200))).toBeLessThanOrEqual(0.02);
    });
});

describe("PR-3 — no hairline cracks in solid ink", () => {
    // A crack is a sliver of background where two pieces of one object should
    // meet. It is at most a pixel wide, so it survives every raster comparison
    // in the suite; it has to be swept for at sub-pixel resolution.
    test.each([[0], [1], [2], [3]])("depth %i, far from the origin", (d) => {
        const E = mkEngine();
        pan(E, -FAR, 0);
        drawStroke(E, [[-400.4, 300.4], [1200.4, 300.4]], 400, BLUE);
        descend(E, d, 400, 300);
        erase(E, [[400, 60], [400, 140]], 16);          // a nick near the top edge
        // Sweep a row well clear of the nick: it must be unbroken ink.
        expect(widestGap(E, 420)).toBe(0);
    });
    test("across the seam between two objects cut by the same gesture", () => {
        const E = mkEngine();
        pan(E, -FAR, 0);
        drawStroke(E, [[100.4, 260.4], [700.4, 260.4]], 90, BLUE);
        drawStroke(E, [[100.4, 340.4], [700.4, 340.4]], 90, BLUE);   // abutting bands
        erase(E, [[400, 100], [400, 180]], 16);
        expect(widestGap(E, 300)).toBe(0);              // the join between them
        expect(widestGap(E, 300, 0, 800, 0.1)).toBe(0);
    });
    test("after a move, and after a level crossing", () => {
        const E = mkEngine();
        pan(E, -FAR, 0);
        drawStroke(E, [[-400.4, 300.4], [1200.4, 300.4]], 400, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 60], [400, 140]], 16);
        expect(widestGap(E, 420)).toBe(0);
        click(E, 200, 420);
        drag(E, [200, 420], [230, 440]);
        expect(widestGap(E, 420)).toBe(0);
        camRestore(E, home);
        descend(E, 2, 400, 300);
        expect(widestGap(E, 420)).toBe(0);
    });
});

describe("PR-4 — a cut edge is CURVES, and is re-flattened at every level", () => {
    // This used to be a KNOWN GAP, deliberately red. It is closed, and not by
    // tuning a tolerance — by the representation. An erased shape used to become
    // a `fill`: a polygon FROZEN at the fidelity of the level it was cut at, so
    // its facets kept whatever size they had when the cut was made. What was
    // measurable then was the corner between two chords, 0.356 deg, which threw
    // the edge 5.0 px off a straight continuation across an 800 px screen — one
    // faint bend, at every depth, for ever.
    //
    // A cut now produces ARCS. Nothing is stored flat, so there are no frozen
    // facets to measure; flattening happens per level, at that level's own
    // display tolerance, and a deeper level simply gets more chords. What is
    // asserted here is therefore the thing that was wanted all along: the drawn
    // edge is within the display tolerance of the true edge, at every depth.
    const curvedStroke = (E) => {
        const pts = [];
        for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([120 + t * 560, 300 + 120 * Math.sin(t * 3.1)]); }
        return drawStroke(E, pts, 70, BLUE);
    };
    const bitten = (E) => {
        curvedStroke(E);
        erase(E, [[400, 250], [400, 300]], 18);
        const rec = natives(E)[0];
        expect(rec).toBeTruthy();
        return rec.obj;
    };

    test("the surviving geometry is arcs, not a frozen polygon", () => {
        const E = mkEngine();
        const o = bitten(E);
        expect(o.type).toBe("shape");
        expect(o.polys).toBeUndefined();
        const pieces = o.loops.reduce((n, l) => n + l.length, 0);
        const arcs = o.loops.reduce((n, l) => n + l.filter((p) => !p.line).length, 0);
        // Both rails of a curved stroke are arcs, and so is every cap; the only
        // straight pieces are where the pen genuinely went straight.
        expect(arcs).toBeGreaterThan(0);
        expect(arcs / pieces).toBeGreaterThan(0.5);
    });

    // How far a chord of `p` sits from `p` itself when flattening splits it into
    // `n` equal steps: the sagitta of one sub-arc, r(1 - cos(theta/2n)), which is
    // the farthest point and is exact. Measuring this instead of scanning a
    // finer flatten for the nearest segment matters for more than tidiness —
    // that scan is quadratic in the chord count, and at k=3 the chord count is
    // large enough that it does not finish. It also flattered the result:
    // `arcSteps` caps at 4096 steps, so past a certain magnification BOTH the
    // coarse and the fine flatten are capped, they converge on each other, and
    // the scan reports agreement where there is really shared error.
    const sagitta = (p, n) => (p.line || !isFinite(p.r) ? 0 : p.r * (1 - Math.cos(Math.abs(p.sweep) / (2 * n))));
    const flatError = (loops, tol) => {
        let worst = 0, chords = 0, deepest = 0;
        for (const loop of loops) {
            for (const p of loop) {
                const n = arcSteps(p, tol);
                chords += n;
                if (n > deepest) deepest = n;
                const d = sagitta(p, n);
                if (d > worst) worst = d;
            }
        }
        return { worst, chords, deepest };
    };

    test("the drawn edge is inside the display tolerance at EVERY depth", () => {
        const E = mkEngine();
        const o = bitten(E);
        const tol = shapeTol(E.cfg);
        const budget = E.cfg.arcTolerancePx * 0.5;    // device px at the level's deepest zoom
        // A point ON the boundary, so the window below always straddles an edge.
        const seed = ptAt(o.loops[0].at(0), 0.5);
        // The counterfactual, measured once: a cut STORED as a polygon keeps the
        // chords it was frozen with, and its worst error is this — in world
        // units, at the level it was cut. Magnifying by f does not re-flatten
        // it, so what a level k view shows is `frozen x f x enter` device px:
        // one faint bend, growing 3000-fold per crossing, for ever. That is the
        // number PR-4 used to bless; it is reported below beside the real one.
        const frozen = flatError(o.loops, tol).worst;
        const rows = [];
        for (let k = -1; k <= 3; k++) {
            // The same shape as it arrives at a level k crossings away.
            const f = Math.pow(E.cfg.enter / E.cfg.base, k);
            const at = transformLoops(o.loops, f, 0, 0);
            // CLIP FIRST, exactly as `shapeRingsInRect` does. The app never
            // flattens a magnified shape whole — an arc only ever contributes
            // the span that is actually on the tile — so flattening all of it
            // here would be measuring a code path that does not exist, and one
            // whose numbers are dominated by the step cap rather than by the
            // tolerance. The window is one screen, centred on the boundary.
            const c = [seed[0] * f, seed[1] * f];
            const local = transformLoops(at, 1, -c[0], -c[1]);
            const lwin = { left: -400, right: 400, top: -300, bottom: 300 };
            const clipped = clipShapeToRect(local, lwin).loops;
            expect(clipped.length).toBeGreaterThan(0);   // the window really does hold an edge
            const now = flatError(clipped, tol);
            rows.push({
                k, chords: now.chords,
                px: +(now.worst * E.cfg.enter).toFixed(4),
                was: +(frozen * f * E.cfg.enter).toFixed(1),
            });
            expect(now.worst * E.cfg.enter).toBeLessThanOrEqual(budget);
            // And it holds because the tolerance decides the step count, not the
            // cap. If a future change ever flattens a magnified shape WITHOUT
            // clipping it first, every arc pins to MAX_STEPS and the fidelity
            // above goes quietly wrong instead of failing here.
            expect(now.deepest).toBeLessThan(4096);
        }
        // eslint-disable-next-line no-console
        console.log("PR-4 edge fidelity by depth (arcs vs a frozen polygon): " +
            rows.map((r) => `k=${r.k} ${r.chords} chords ${r.px}px was ${r.was}px`).join(" · "));
    });
});
