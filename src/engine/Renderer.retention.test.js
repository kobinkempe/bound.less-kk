/**
 * Per-level scene retention — the crossing-perf prototype.
 *
 * A level flip used to tear down every group and rebuild every SVG path
 * (`two.update()` reconstructing ~50 <path> `d` strings each crossing, 1–3 s
 * that never got cheaper because one `world` group held one level at a time).
 * Retention keeps each level's subtree alive: a crossing detaches one root and
 * attaches another, so bouncing across a boundary reuses the cached paths.
 *
 * These tests pin the mechanism deterministically at the Renderer seam (sigs
 * are view-independent for thin strokes, so no framing noise), then confirm the
 * engine wires the active level through and the toggle collapses to the old
 * rebuild-on-crossing behavior.
 */
import Two from "two.js";
import Renderer from "./Renderer";
import KobinEngine from "./KobinEngine";

jest.setTimeout(60000);

const CFG = { enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, fatWidthPx: 4000, lineTolPx: 0.25, cullPx: 0.3, fadeLoPx: 0.15 };

// A minimal camera: retention is view-independent, so a fixed generous window
// keeps every synthetic piece "visible" and the sigs stable across renders.
const mkCam = () => ({
    inScale: 1, inPanX: 0, inPanY: 0, activeLevel: 0,
    frameWindow: () => ({ left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 }),
    levelPointToScreen: () => null,
});
const thin = (id, y) => ({ type: "stroke", origin: "native", id, pts: [[0, y], [10, y], [20, y + 2]], lwFrame: 2, color: "#123456", opacity: 1 });
const listOf = (ids, y0 = 0) => ids.map((id, k) => thin(id, y0 + k * 5));

const renderers = [];
const mkRenderer = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new Renderer(host, mkCam(), CFG, { width: 800, height: 600 });
    renderers.push(r);
    return r;
};
afterEach(() => { while (renderers.length) renderers.pop().destroy(); });

describe("Renderer scene retention (mechanism)", () => {
    test("returning to a level with unchanged content rebuilds nothing", () => {
        const r = mkRenderer();
        const A = listOf([1, 2, 3], 0);      // level 0 content
        const B = listOf([11, 12], 1000);    // level 1 content (different ids)

        r.render(A, 0);
        expect(r._lastRebuilds).toBe(3);     // cold: all three built
        const pathA1 = r._scenes.get(0).groups.get(1).group.children[0];

        r.render(B, 1);
        expect(r._lastRebuilds).toBe(2);     // level 1 cold
        // level 0's root is detached but its groups survive in the cache
        expect(r._scenes.get(0).groups.size).toBe(3);

        r.render(A, 0);                      // bounce back
        expect(r._lastRebuilds).toBe(0);     // fully cached — no path reconstruction
        // and it is the SAME Path object (its `d` never gets rebuilt)
        expect(r._scenes.get(0).groups.get(1).group.children[0]).toBe(pathA1);

        r.render(B, 1);                      // bounce up again
        expect(r._lastRebuilds).toBe(0);
    });

    test("only the active level's root is attached under world", () => {
        const r = mkRenderer();
        r.render(listOf([1, 2], 0), 0);
        const root0 = r._scenes.get(0).root;
        r.render(listOf([11], 1000), 1);
        const root1 = r._scenes.get(1).root;
        const attached = () => r.world.children.filter((c) => c === root0 || c === root1);
        expect(attached()).toEqual([root1]);   // level 0 detached, level 1 shown
        r.render(listOf([1, 2], 0), 0);
        expect(attached()).toEqual([root0]);   // swapped back
    });

    test("a genuine content change still rebuilds that group (diff is correctness)", () => {
        const r = mkRenderer();
        r.render(listOf([1, 2, 3], 0), 0);
        r.render(listOf([11], 1000), 1);
        // return to level 0 but with object 2 restyled (color changed -> new sig)
        const A2 = listOf([1, 2, 3], 0);
        A2[1] = { ...A2[1], color: "#ff0000" };
        r.render(A2, 0);
        expect(r._lastRebuilds).toBe(1);       // only the changed group
    });

    test("scene cache is bounded (LRU eviction, active never evicted)", () => {
        const r = mkRenderer();
        for (let lvl = 0; lvl < 14; lvl++) r.render(listOf([lvl * 10 + 1], lvl * 100), lvl);
        expect(r._scenes.size).toBeLessThanOrEqual(8);
        expect(r._scenes.has(13)).toBe(true); // the active (most recent) level survives
    });

    test("toggling retention off collapses to one shared scene (old behavior)", () => {
        const r = mkRenderer();
        r.setRetainScenes(false);
        const A = listOf([1, 2, 3], 0);
        r.render(A, 0);
        r.render(listOf([11, 12], 1000), 1);   // shared "_" scene: A pruned, B built
        r.render(A, 0);
        expect(r._lastRebuilds).toBe(3);       // no retention -> rebuilt from scratch
        expect(r._scenes.size).toBe(1);        // single shared scene
    });
});

describe("engine wires the active level into retention", () => {
    const engines = [];
    const mkEngine = () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const e = new KobinEngine(host, { width: 800, height: 600 });
        engines.push(e);
        return e;
    };
    afterEach(() => { while (engines.length) engines.pop().destroy(); });
    const drawStroke = (E, pts) => { E.pointerDown(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]); E.pointerUp(); };

    test("a round-trip crossing retains both levels' subtrees (default on)", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [250, 260], [400, 300], [550, 340], [700, 300]]);
        const ax = 400, ay = 300;
        while (E.inScale * 1.4 < 320) E.zoomFactorAt(ax, ay, 1.4); // cross up into level 1
        expect(E.activeLevel).toBe(1);
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 80) E.zoomFactorAt(ax, ay, 0.7); // back down
        expect(E.activeLevel).toBe(0);
        // both levels are retained (per-level subtrees exist)
        expect(E.renderer._scenes.size).toBeGreaterThanOrEqual(2);
        expect(E.renderer._scenes.has(0)).toBe(true);
        expect(E.renderer._scenes.has(1)).toBe(true);
    });

    test("with retention off the engine keeps a single shared scene", () => {
        const E = mkEngine();
        E.setRetainScenes(false);
        drawStroke(E, [[100, 300], [250, 260], [400, 300], [550, 340], [700, 300]]);
        const ax = 400, ay = 300;
        while (E.inScale * 1.4 < 320) E.zoomFactorAt(ax, ay, 1.4);
        expect(E.activeLevel).toBe(1);
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 80) E.zoomFactorAt(ax, ay, 0.7);
        expect(E.renderer._scenes.size).toBe(1);
    });
});
