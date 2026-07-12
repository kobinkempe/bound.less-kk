/**
 * Fat strokes as curve-capsule outlines — the crossing-handoff fidelity
 * contract and the no-rebake invariant.
 *
 * The scenario under test (the design question that motivated the change): a
 * stroke rides its level-0 outline to the MAXIMUM in-level fatness (inScale
 * just below enter = 300, ×3000 past entry), then a crossing re-bakes it into
 * the next level's tiles. The ink the user sees at the same screen pixels must
 * not jump: both representations must track the TRUE spline band (ground
 * truth) and each other, with mismatches confined to a sub-pixel-budget band
 * around the true edge (outline fitTol 0.25 px at worst + tile entry-fidelity
 * chords ≈ well under 2 px at the handoff moment).
 *
 * Also pinned here:
 *  - in-level zooming rebuilds NOTHING (the old 25%-band fat re-bake is gone):
 *    the fat group's Path object survives zoom sweeps by identity;
 *  - the representation gate fires at object birth (lwFrame × enter), so a raw
 *    SVG stroke can never be zoomed into Skia's mis-stroke widths (ISSUE-21).
 */
import KobinEngine from "./KobinEngine";
import { flattenLoops } from "./geometry/curveOutline";
import { flattenCurve } from "./geometry/clipperOutline";
import { windingOfPoint, distToPolyline } from "./geometry/hittest";

jest.setTimeout(60000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });
const drawStroke = (E, pts) => { E.pointerDown(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]); E.pointerUp(); };

// ink according to the RENDER-LIST pieces at the active level
function pieceInk(list, p) {
    for (const o of list) {
        if (o.type === "fill") { if (windingOfPoint(o.polys, p) !== 0) return true; }
        else if (o.pts && distToPolyline(o.pts, p) <= o.lwFrame / 2) return true;
    }
    return false;
}

describe("fat handoff at the crossing (pixel-constant fidelity)", () => {
    test("outline at max in-level fatness == tile bake after the crossing == ground truth", () => {
        const E = mkEngine(800, 600);
        E.setWidth(40); // lwFrame 40 at inScale 1 -> paints 12,000 px at enter (deep-fat)
        drawStroke(E, [[100, 300], [250, 260], [400, 300], [550, 340], [700, 300]]);
        const o = E.nativesByLevel[0][0];

        // ground truth: the spline band in level-0 frame coords
        const spline = flattenCurve(o.pts, 1e-4);
        const half = o.lwFrame / 2;
        const truthDist = (p0) => distToPolyline(spline, p0); // vs half

        // zoom to the deepest in-level fatness, anchored near the band's edge
        // (tangent at (400,300) ≈ (300,80) -> edge ≈ 20 units along the normal)
        const ax = 394.8, ay = 319.4;
        while (E.inScale * 1.4 < 295) E.zoomFactorAt(ax, ay, 1.4);
        expect(E.activeLevel).toBe(0);
        expect(E.inScale).toBeGreaterThan(200);
        // the lazy flip fired on approach: by max in-level fatness the stroke
        // renders from its cached curve outline
        expect(o._outline).toBeTruthy();
        const sBefore = E.inScale;

        // BEFORE: ink from the outline representation exactly as rendered
        const outlinePolys = flattenLoops(o._outline, ((E.cfg.arcTolerancePx * 0.5) / E.cfg.enter) * 0.25);
        const N = 24, M = 18;
        const samples = []; // { sx, sy, p0 (frame-0 coords), edgePxBefore, before }
        let inked = 0;
        for (let a = 0; a < N; a++) for (let b = 0; b < M; b++) {
            const sx = (a + 0.5) / N * 800, sy = (b + 0.5) / M * 600;
            const p0 = E.screenToFrame(sx, sy);
            const before = windingOfPoint(outlinePolys, p0) !== 0;
            const edgePx = Math.abs(truthDist(p0) - half) * sBefore;
            samples.push({ sx, sy, p0, edgePx, before });
            if (before) inked++;
        }
        // the view straddles the edge (otherwise this test proves nothing)
        expect(inked).toBeGreaterThan(20);
        expect(inked).toBeLessThan(N * M - 20);
        // outline representation tracks ground truth outside a 1.5 px edge band
        for (const s of samples) {
            if (s.edgePx > 1.5) expect(s.before).toBe(truthDist(s.p0) <= half);
        }

        // CROSS UP: the stroke re-bakes into level-1 tiles at the handoff
        const f = 315 / E.inScale;
        E.zoomFactorAt(ax, ay, f);
        expect(E.activeLevel).toBe(1);
        const list = E._objs();
        expect(list.length).toBeGreaterThan(0);
        // AFTER: the SAME WORLD POINTS (level-0 sample points mapped one exact
        // record step up — comparing at fixed screen pixels would conflate the
        // representation handoff with the zoom step itself), tile pieces vs
        // the same truth. Pixel-constant outside the tolerance band.
        let mismatched = 0, visible = 0;
        for (const s of samples) {
            const p1 = E.lm.mapPoint(s.p0, 0, 1);
            expect(p1).toBeTruthy();
            const after = pieceInk(list, p1);
            visible++;
            if (s.edgePx > 2 && after !== s.before) mismatched++;
        }
        expect(visible).toBe(samples.length);
        expect(mismatched).toBe(0);

        // ROUND TRIP: cross back down (through the 2x hysteresis) and confirm the
        // outline representation still matches truth at the fresh framing
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 60) E.zoomFactorAt(ax, ay, 0.7);
        expect(E.activeLevel).toBe(0);
        const sBack = E.inScale;
        const polysBack = flattenLoops(o._outline, ((E.cfg.arcTolerancePx * 0.5) / E.cfg.enter) * 0.25);
        for (let a = 0; a < N; a++) for (let b = 0; b < M; b++) {
            const sx = (a + 0.5) / N * 800, sy = (b + 0.5) / M * 600;
            const p0 = E.screenToFrame(sx, sy);
            const edgePx = Math.abs(truthDist(p0) - half) * sBack;
            if (edgePx > 1.5) {
                expect(windingOfPoint(polysBack, p0) !== 0).toBe(truthDist(p0) <= half);
            }
        }
    });
});

describe("no re-bakes within a level", () => {
    test("the fat group's paths survive zoom sweeps by identity; needsRebake stays false", () => {
        const E = mkEngine(800, 600);
        E.setLazyOutlines(false); // eager: outline at birth, identity must hold across the sweep
        E.setWidth(40);
        drawStroke(E, [[150, 300], [300, 250], [450, 320], [650, 280]]);
        const id = E.nativesByLevel[0][0].id;
        const entry = E.renderer._groups.get(id);
        expect(entry).toBeTruthy();
        const path = entry.group.children[0];
        const sig = entry.sig;
        expect(path).toBeTruthy();
        // in-level zooms and pinches, including tile-range changes that force renders
        for (let i = 0; i < 30; i++) {
            E.pinchUpdate(300 + i * 8, 280 + i * 4, i % 3 ? 1.18 : 0.8, 5, 3);
            expect(E.renderer.needsRebake()).toBe(false);
        }
        expect(E.activeLevel).toBe(0);
        const entry2 = E.renderer._groups.get(id);
        expect(entry2.sig).toBe(sig);                 // signature never went stale
        expect(entry2.group.children[0]).toBe(path);  // the SVG path was never rebuilt
    });

    test("ISSUE-21 (lazy): a wide pen flips to its outline BEFORE raw paint could reach the gate", () => {
        const E = mkEngine(800, 600);
        E.setWidth(90);
        drawStroke(E, [[200, 300], [600, 300]]);
        const o = E.nativesByLevel[0][0];
        expect(o.lwFrame * E.cfg.enter).toBeGreaterThan(E.cfg.fatWidthPx); // gate condition
        // lazy: renders RAW at birth (its painted width is just the pen width)
        expect(E.renderer._groups.get(o.id).group.children[0].linewidth).toBe(o.lwFrame);
        // zoom deep in-level: at every step the stroke is either still under the
        // gate as a raw path, or already flipped to an outline fill
        for (let i = 0; i < 8; i++) { // ×2 each -> inScale 256 (< enter, no crossing)
            E.zoomAt(400, 300, -1000);
            const painted = o.lwFrame * E.inScale;
            const path = E.renderer._groups.get(o.id).group.children[0];
            if (painted > E.cfg.fatWidthPx) expect(path.fill).toBe(o.color); // outline by now
        }
        expect(E.activeLevel).toBe(0);
        expect(E.inScale * o.lwFrame).toBeGreaterThan(20000); // way past the old Skia regime
        expect(o._outline).toBeTruthy();
    });

    test("eager mode (LazyFat off): outline from birth", () => {
        const E = mkEngine(800, 600);
        E.setLazyOutlines(false);
        E.setWidth(90);
        drawStroke(E, [[200, 300], [600, 300]]);
        const o = E.nativesByLevel[0][0];
        expect(o._outline).toBeTruthy();
        expect(E.renderer._groups.get(o.id).group.children[0].fill).toBe(o.color);
    });

    test("idle prefit builds pending outlines off the gesture path", async () => {
        const E = mkEngine(800, 600);
        E.setWidth(90);
        drawStroke(E, [[200, 300], [600, 300]]);
        const o = E.nativesByLevel[0][0];
        expect(o._outline).toBeUndefined(); // lazy: not fitted at pen-up
        // jsdom has no requestIdleCallback -> the prefitter falls back to setTimeout(50)
        await new Promise((r) => setTimeout(r, 120));
        expect(o._outline).toBeTruthy();    // fitted in idle, flip is now free
    });

    test("PreBake defines the child record early and warms its tiles before a first crossing", async () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[380, 280], [420, 320], [400, 360]]);
        let guard = 0;
        while (E.inScale < 245 && guard++ < 60) E.zoomFactorAt(400, 300, 1.1); // near enter, no crossing
        expect(E.activeLevel).toBe(0);
        expect(E.crossings[1]).toBeTruthy(); // record defined EARLY (any frame captured on the way up is valid)
        expect(E.crossings[1].s).toBe(300);  // still pinned at enter
        await new Promise((r) => setTimeout(r, 150)); // idle prebake (setTimeout fallback in jsdom)
        expect(E.store._tileKeys().some((k) => k.startsWith("1|"))).toBe(true); // child tiles warm
        // toggle off: classic behavior, no record until the actual crossing
        const E2 = mkEngine(800, 600);
        E2.setPreBake(false);
        drawStroke(E2, [[380, 280], [420, 320], [400, 360]]);
        guard = 0;
        while (E2.inScale < 245 && guard++ < 60) E2.zoomFactorAt(400, 300, 1.1);
        expect(E2.crossings[1]).toBeUndefined();
    });

    test("thin strokes stay raw strokes (the gate only converts what needs it)", () => {
        const E = mkEngine(800, 600);
        // draw while deep-zoomed: lwFrame is tiny, can never exceed the gate in-level
        while (E.inScale * 1.4 < 200) E.zoomFactorAt(400, 300, 1.4);
        drawStroke(E, [[300, 300], [500, 310]]);
        const o = E.nativesByLevel[0][0];
        expect(o.lwFrame * E.cfg.enter).toBeLessThanOrEqual(E.cfg.fatWidthPx);
        expect(o._outline).toBeUndefined();
        const path = E.renderer._groups.get(o.id).group.children[0];
        expect(path.linewidth).toBe(o.lwFrame); // stroked, not filled
    });
});
