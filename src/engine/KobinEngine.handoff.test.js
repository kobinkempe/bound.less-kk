/**
 * The crossing handoff, and the no-rebake invariant.
 *
 * The scenario is the design question that motivated resolving strokes at all: a
 * stroke rides its own shape to the MAXIMUM in-level zoom (inScale just below
 * enter = 300, x3000 past entry), then a crossing re-bakes it into the next
 * level's tiles. The ink the user sees at the same world points must not jump.
 *
 * This replaces `KobinEngine.fatOutline.test.js`, which pinned the same
 * invariant on the representation that came before: a fat-gated stroke that
 * rendered raw until it approached a width threshold, then flipped to a fitted
 * curve-capsule outline. None of that exists now — a stroke becomes its resolved
 * perimeter at pen-up, so there is no gate to cross, no fit to schedule, and no
 * raw SVG stroke left that could ever be zoomed into Skia's mis-stroke widths.
 * The INVARIANT is what mattered, so the invariant is what is kept.
 */
import KobinEngine from "./KobinEngine";
import { flattenCurve } from "./geometry/polyline";
import { windingOfPoint, distToPolyline } from "./geometry/hittest";
import { insideShape } from "./geometry/arcShape";

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
const drawStroke = (E, pts) => {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();
};

/** Ink according to the RENDER-LIST pieces at the active level. */
function pieceInk(list, p) {
    for (const o of list) {
        if (o.type === "shape") { if (insideShape(o.loops, p)) return true; }
        else if (o.type === "fill") { if (windingOfPoint(o.polys, p) !== 0) return true; }
        else if (o.pts && distToPolyline(o.pts, p) <= o.lwFrame / 2) return true;
    }
    return false;
}

describe("the resolved shape is what a stroke IS", () => {
    test("pen-up leaves a shape, and no raw stroke survives in the render list", () => {
        const E = mkEngine();
        E.setWidth(40);
        drawStroke(E, [[100, 300], [250, 260], [400, 300], [550, 340], [700, 300]]);
        const o = E.nativesByLevel[0][0];
        expect(o.type).toBe("shape");
        expect(o.pts).toBeUndefined();      // the centerline is not kept
        expect(o.lwFrame).toBeUndefined();
        expect(o.loops.length).toBeGreaterThan(0);
        expect(o.w).toBeCloseTo(40, 9);     // the pen that drew it does survive
        // Nothing in the picture is a browser-stroked path, at any zoom — which
        // is what makes the old fat gate unnecessary rather than merely unused.
        for (const s of [1, 30, 290]) {
            E.cam.set({ activeLevel: 0, frame: "0", inScale: s, inPanX: 0, inPanY: 0 });
            E._render();
            expect(E._objs().every((p) => p.type !== "stroke")).toBe(true);
        }
    });
});

describe("handoff at the crossing (world-point constancy)", () => {
    test("the shape at max in-level zoom paints what the tiles paint after it", () => {
        const E = mkEngine(800, 600);
        E.setWidth(40); // 12,000 px wide at `enter` — as deep-fat as a level gets
        const PTS = [[100, 300], [250, 260], [400, 300], [550, 340], [700, 300]];
        drawStroke(E, PTS);
        const o = E.nativesByLevel[0][0];
        expect(o.type).toBe("shape");

        // Independent ground truth: the band the pen swept, from the SAMPLES —
        // owing nothing to the arc pipeline that produced the shape.
        const spline = flattenCurve(PTS, 1e-4);
        const half = 20;
        const truthDist = (p) => distToPolyline(spline, p);

        const ax = 394.8, ay = 319.4;
        while (E.inScale * 1.4 < 295) E.zoomFactorAt(ax, ay, 1.4);
        expect(E.activeLevel).toBe(0);
        expect(E.inScale).toBeGreaterThan(200);

        const N = 24, M = 18;
        const samples = [];
        let inked = 0;
        for (let a = 0; a < N; a++) {
            for (let b = 0; b < M; b++) {
                const p0 = E.screenToFrame((a + 0.5) / N * 800, (b + 0.5) / M * 600);
                const before = insideShape(o.loops, p0);
                samples.push({ p0, before, edge: Math.abs(truthDist(p0) - half) });
                if (before) inked++;
            }
        }
        // the view straddles the edge (otherwise this proves nothing)
        expect(inked).toBeGreaterThan(20);
        expect(inked).toBeLessThan(N * M - 20);

        // The shape tracks the true band. The band is in WORLD units, not
        // pixels: the centerline may differ from the cardinal spline by up to the
        // arc tolerance it was built at (0.125 units here), and that is a fixed
        // distance on the paper however far you zoom in.
        for (const s of samples) {
            if (s.edge > 0.3) expect(s.before).toBe(truthDist(s.p0) <= half);
        }

        // CROSS UP: the stroke re-bakes into level-1 tiles at the handoff.
        E.zoomFactorAt(ax, ay, 315 / E.inScale);
        expect(E.activeLevel).toBe(1);
        const list = E._objs();
        expect(list.length).toBeGreaterThan(0);

        // The SAME WORLD POINTS, mapped one exact edge step up — into the frame
        // the camera actually crossed into. That is a lattice CELL chosen by
        // where the zoom was aimed, and only an origin chain is named "1", so
        // asking for the spine here would compare against a different place.
        let mismatched = 0;
        for (const s of samples) {
            const p1 = E.lm.mapPointF(s.p0, "0", E.cam.frame);
            expect(p1).toBeTruthy();
            if (s.edge > 0.3 && pieceInk(list, p1) !== s.before) mismatched++;
        }
        expect(mismatched).toBe(0);

        // ROUND TRIP: back down through the hysteresis, still the same picture.
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 60) E.zoomFactorAt(ax, ay, 0.7);
        expect(E.activeLevel).toBe(0);
        for (const s of samples) {
            if (s.edge > 0.3) expect(insideShape(o.loops, s.p0)).toBe(s.before);
        }
    });
});

describe("no re-bakes within a level", () => {
    test("an in-level zoom sweep rebuilds no group and no path", () => {
        const E = mkEngine();
        E.setWidth(40);
        drawStroke(E, [[120, 320], [300, 280], [480, 330], [660, 300]]);
        E._render();
        const id = E.nativesByLevel[0][0].id;
        const entry = E.renderer._groups.get(id);
        expect(entry).toBeTruthy();
        const path0 = entry.group.children[0];
        expect(path0).toBeTruthy();
        for (const f of [1.3, 1.3, 1.3, 1.3, 1.3, 0.77, 0.77, 0.77]) {
            E.zoomFactorAt(400, 300, f);
            expect(E.activeLevel).toBe(0);
        }
        E._render();
        const after = E.renderer._groups.get(id);
        expect(after).toBe(entry);                      // same group object
        expect(after.group.children[0]).toBe(path0);    // and the same path
    });
});
