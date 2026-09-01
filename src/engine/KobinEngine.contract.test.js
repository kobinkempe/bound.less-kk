/**
 * Compat contract - the exact engine surface the PRODUCT reads.
 *
 * KobinEngine is a facade over Camera, Document, TileStore, LevelMap and
 * Renderer; the old engine exposed all of this as fields and methods on one god
 * class, and the facade has to keep every one of them working or the app breaks
 * silently at the swap. This file is the list, so that "nothing imports it any
 * more" is a test failure rather than a discovery in production.
 *
 * ENUMERATED FROM ITS TWO CONSUMERS, and nothing else:
 *   - `hooks/useKobinEngine.js` - mount, pointer input, tool sync, autosave,
 *     the file operations, and the diagnostic report payload. This is where
 *     almost the whole surface is used.
 *   - `Pages/CanvasEditor.js` - the product shell, which reaches past the hook
 *     through `engineRef.current` for exactly five things.
 *
 * It used to be enumerated from `Pages/CanvasV2.js`, a dev harness that carried
 * its own copy of the same lifecycle. That file was deleted in the 2026-08-31
 * cleanup, and keeping its name here would have left the suite pinning a
 * contract with no party on the other side of it.
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

// Every method name reached through `engine.`/`eng.`/`E().` in the hook, plus
// the five CanvasEditor takes off `engineRef.current`. Grouped by what the user
// is doing when it fires.
const METHODS = [
    // input
    "pointerDown", "pointerMove", "pointerUp", "cancelStroke", "zoomAt", "pinchUpdate", "resize",
    // tools
    "setTool", "setPenType", "setColor", "setWidth", "setOpacity", "setOpacityGroups",
    "setEraserSize", "setOutlineMode", "setLazyOutlines", "setPreBake", "setRetainScenes",
    // history + selection
    "undo", "redo", "clear", "deleteSelection", "deselect",
    // files
    "snapshot", "serializeDrawing", "loadDrawing",
    // navigation (CanvasEditor, via engineRef.current)
    "jumpTo", "sceneZoom",
    // dev switches and instrumentation
    "setDebug", "setKDebug", "setTileDebug", "setEraseDebug", "setTrace",
    "notePerf", "fastStats", "reportFamilies", "_effectiveZoom",
    // lifecycle
    "destroy",
];

test("every method the hook and the editor call exists", () => {
    const E = mkEngine();
    const missing = METHODS.filter((m) => typeof E[m] !== "function");
    expect(missing).toEqual([]);
});

test("the fields the pinch handler and the report payload read all exist", () => {
    const E = mkEngine();
    // the pinch handler cancels a stroke mid-gesture and needs to know one began
    expect("_drawing" in E).toBe(true);
    expect("_drawStartT" in E).toBe(true);
    // the report payload
    expect(E.nativesByLevel).toBeDefined();
    expect(E.tiles).toBeDefined();
    expect(E.levelObjects).toBeDefined();
    expect(E.doc).toBeDefined();
    expect(Array.isArray(E.journal)).toBe(true);
    expect(typeof E.opacityGroups).toBe("boolean");
    expect(typeof E.outlineMode).toBe("boolean");
    expect(typeof E._hasFat).toBe("boolean");
    expect(typeof E._effectiveZoom()).toBe("number");
    expect(Array.isArray(E.perfLog)).toBe(true);
    // the four instruments. Each is optional at the call site (`eng.growth ? ...`)
    // but all four are built by the constructor, and a missing one is a report
    // that quietly stops carrying a whole class of measurement.
    for (const inst of ["frameMeter", "longFrames", "growth", "eventLatency"]) {
        expect(typeof E[inst].report).toBe("function");
    }
    // The seal/cull counters are created LAZILY, on the first occurrence, so on a
    // fresh engine they are legitimately undefined - which is exactly why the
    // report reads every one of them through `|| 0`. Pin that they are never
    // some other type, since a string here would reach the report intact.
    for (const c of ["_dustCulled", "_boolFailures", "_bakeRepairs"]) {
        expect(["number", "undefined"]).toContain(typeof E[c]);
    }
});

test("onStatus fires with the fields the UI renders", () => {
    let status = null;
    const E = mkEngine(800, 600, (s) => { status = s; });
    E.zoomAt(400, 300, -50);
    expect(status).toBeTruthy();
    for (const k of ["level", "inScale", "effectiveZoom", "nearCross", "objects",
        "outline", "lines", "selection", "canUndo", "canRedo"]) {
        expect(k in status).toBe(true);
    }
});

test("status reports undo availability, so the toolbar can grey its buttons", () => {
    let status = null;
    const E = mkEngine(800, 600, (s) => { status = s; });
    E.zoomAt(400, 300, -50);
    expect(status.canUndo).toBe(false);
    expect(status.canRedo).toBe(false);

    E.pointerDown(100, 100); E.pointerMove(150, 150); E.pointerUp();
    expect(status.canUndo).toBe(true);   // a stroke is undoable
    expect(status.canRedo).toBe(false);  // ...and nothing has been undone yet

    E.undo();
    expect(status.canUndo).toBe(false);
    expect(status.canRedo).toBe(true);   // the stroke is now on the redo branch

    E.redo();
    expect(status.canUndo).toBe(true);
    expect(status.canRedo).toBe(false);
});

test("report payload can be built without throwing", () => {
    const E = mkEngine();
    E.pointerDown(100, 100); E.pointerMove(150, 150); E.pointerUp();
    // the shape `useKobinEngine.sendReport` POSTs to tools/report-server.js
    const payload = {
        camera: { level: E.activeLevel, inScale: E.inScale, effectiveZoom: E._effectiveZoom() },
        counts: {
            natives: Object.fromEntries(Object.entries(E.nativesByLevel).map(([k, v]) => [k, v.length])),
            tiles: Object.fromEntries(Object.entries(E.tiles).map(([k, v]) => [k, v.size])),
            rendered: (E.levelObjects[E.activeLevel] || []).length,
        },
        flags: { opacityGroups: E.opacityGroups, outlineMode: E.outlineMode, hasFat: E._hasFat },
        perf: E.perfLog,
        families: E.reportFamilies(),
        fast: E.fastStats(),
        counters: {
            dustCulled: E._dustCulled || 0,
            boolSeals: E._boolFailures || 0,
            bakeRepairs: E._bakeRepairs || 0,
        },
        snapshot: E.snapshot(),
    };
    expect(payload.snapshot.v).toBe("dev-0");
    expect(payload.counts.natives[0]).toBe(1);
    expect(payload.counts.rendered).toBeGreaterThanOrEqual(1);
    // the lazily-created counters survive the `|| 0` as numbers, not undefined
    for (const v of Object.values(payload.counters)) expect(typeof v).toBe("number");
});

test("tiles getter exposes per-level {size} for the report", () => {
    const E = mkEngine();
    E.pointerDown(400, 300); E.pointerMove(420, 320); E.pointerUp();
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
    const t = E.tiles;
    for (const k of Object.keys(t)) expect(typeof t[k].size).toBe("number");
});
