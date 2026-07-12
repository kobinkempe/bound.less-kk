/**
 * Compat contract — the exact surface CanvasV2.js and the report payload read off
 * the engine. The old engine exposed all of this as fields/methods on the god
 * class; the facade must keep every one working, or the app silently breaks at
 * the swap. (Enumerated from CanvasV2.js: engine instantiation, pinch handler,
 * report payload, status handler, toolbar wiring.)
 */
import KobinEngine from "./KobinEngine";

const engines = [];
const mkEngine = (w = 800, h = 600, onStatus) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h, onStatus });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

test("public methods CanvasV2 + toolbar call all exist", () => {
    const E = mkEngine();
    for (const m of ["pointerDown", "pointerMove", "pointerUp", "cancelStroke", "zoomAt", "pinchUpdate",
        "panBy", "setTool", "setPenType", "setColor", "setWidth", "setOpacity", "setOpacityGroups",
        "setOutlineMode", "setDebug", "setKDebug", "setTileDebug", "undo", "redo", "clear",
        "resize", "destroy", "snapshot", "loadSnapshot"]) {
        expect(typeof E[m]).toBe("function");
    }
});

test("quasi-privates the pinch handler + report payload read all exist", () => {
    const E = mkEngine();
    // pinch handler (CanvasV2 lines ~95): reads _drawing, _drawStartT, calls cancelStroke
    expect("_drawing" in E).toBe(true);
    expect("_drawStartT" in E).toBe(true);
    // report payload (CanvasV2 lines ~206-216)
    expect(E.nativesByLevel).toBeDefined();
    expect(E.tiles).toBeDefined();
    expect(E.levelObjects).toBeDefined();
    expect(typeof E.opacityGroups).toBe("boolean");
    expect(typeof E.outlineMode).toBe("boolean");
    expect(typeof E._hasFat).toBe("boolean");
    expect(typeof E._effectiveZoom()).toBe("number");
    expect(Array.isArray(E.perfLog)).toBe(true);
});

test("onStatus fires with the fields the UI renders", () => {
    let status = null;
    const E = mkEngine(800, 600, (s) => { status = s; });
    E.zoomAt(400, 300, -50);
    expect(status).toBeTruthy();
    for (const k of ["level", "inScale", "effectiveZoom", "nearCross", "objects", "outline", "lines"]) {
        expect(k in status).toBe(true);
    }
});

test("report-payload shape can be built without throwing", () => {
    const E = mkEngine();
    E.pointerDown(100, 100); E.pointerMove(150, 150); E.pointerUp();
    // mirror CanvasV2's report builder
    const payload = {
        camera: { level: E.activeLevel, inScale: E.inScale, effectiveZoom: E._effectiveZoom() },
        counts: {
            natives: Object.fromEntries(Object.entries(E.nativesByLevel).map(([k, v]) => [k, v.length])),
            tiles: Object.fromEntries(Object.entries(E.tiles).map(([k, v]) => [k, v.size])),
            rendered: (E.levelObjects[E.activeLevel] || []).length,
        },
        flags: { opacityGroups: E.opacityGroups, outlineMode: E.outlineMode, hasFat: E._hasFat },
        perf: E.perfLog,
        snapshot: E.snapshot(),
    };
    expect(payload.snapshot.v).toBe("dev-0");
    expect(payload.counts.natives[0]).toBe(1);
    expect(payload.counts.rendered).toBeGreaterThanOrEqual(1);
});

test("tiles getter exposes per-level {size} for the report", () => {
    const E = mkEngine();
    E.pointerDown(400, 300); E.pointerMove(420, 320); E.pointerUp();
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
    const t = E.tiles;
    for (const k of Object.keys(t)) expect(typeof t[k].size).toBe("number");
});
