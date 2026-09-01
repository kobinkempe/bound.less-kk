/**
 * Headless engine tests (jsdom + real two.js SVG renderer).
 *
 * These pin the invariants the infinite zoom rests on:
 *  - deep asymmetric zoom round-trips return with zero drift (v2.1's "one hard
 *    problem": fixed crossing records + immutable natives make re-derivation
 *    deterministic),
 *  - crossing records pin on first entry and are reused forever,
 *  - hysteresis: a crossing never immediately bounces back,
 *  - undo/redo/erase mutate the document reversibly, across levels,
 *  - snapshot/loadSnapshot round-trips the document without id collisions.
 */
import KobinEngineV0 from "./KobinEngineV0";

jest.setTimeout(30000);

const engines = [];
const mkEngine = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngineV0(host, { width: 800, height: 600 });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const drawStroke = (E, pts) => {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};

test("deep asymmetric zoom round-trip returns with zero drift", () => {
    const E = mkEngine();
    drawStroke(E, [[350, 250], [420, 300], [380, 360], [300, 320]]);
    const probe = [123.456, 87.654]; // a fixed level-0 point
    const s0 = E._levelPointToScreen(0, probe[0], probe[1]);

    // 30 doublings across shifting focal points (crosses >= 2 levels), then the
    // exact inverse sequence back out.
    const focals = [[400, 300], [120, 80], [700, 520], [250, 450], [600, 100]];
    const seq = [];
    for (let i = 0; i < 30; i++) seq.push([focals[i % focals.length][0], focals[i % focals.length][1], -1000]);
    for (const [x, y, d] of seq) E.zoomAt(x, y, d);
    expect(E.activeLevel).toBeGreaterThanOrEqual(2);
    for (const [x, y, d] of [...seq].reverse()) E.zoomAt(x, y, -d);

    expect(E.activeLevel).toBe(0);
    expect(Math.abs(E.inScale - 1)).toBeLessThan(1e-9);
    const s1 = E._levelPointToScreen(0, probe[0], probe[1]);
    expect(Math.abs(s1[0] - s0[0])).toBeLessThan(1e-6);
    expect(Math.abs(s1[1] - s0[1])).toBeLessThan(1e-6);
});

test("crossing records pin on first entry, hysteresis holds, re-entry reuses", () => {
    const E = mkEngine();
    drawStroke(E, [[380, 280], [420, 320]]);
    for (let i = 0; i < 9; i++) E.zoomAt(400, 300, -1000); // 2^9 = 512 > 300
    expect(E.activeLevel).toBe(1);
    expect(E.crossings[1].s).toBe(300); // pinned at `enter`, not the overshot 512
    const t0 = { x: E.crossings[1].t.x, y: E.crossings[1].t.y };

    // a small zoom-out right after the crossing must NOT bounce back down
    E.zoomAt(400, 300, 120);
    expect(E.activeLevel).toBe(1);

    // leave, then re-enter at a completely different focal: same record
    for (let i = 0; i < 12; i++) E.zoomAt(200, 150, 1000);
    expect(E.activeLevel).toBeLessThanOrEqual(0);
    for (let i = 0; i < 14; i++) E.zoomAt(600, 450, -1000);
    expect(E.activeLevel).toBeGreaterThanOrEqual(1);
    expect(E.crossings[1].s).toBe(300);
    expect(E.crossings[1].t.x).toBe(t0.x);
    expect(E.crossings[1].t.y).toBe(t0.y);
});

test("undo/redo, true-erase and wipe round-trip the document", () => {
    const E = mkEngine();
    drawStroke(E, [[100, 100], [180, 120], [220, 160]]);
    drawStroke(E, [[300, 300], [340, 300], [380, 310]]);
    expect(E.nativesByLevel[0].length).toBe(2);

    E.undo();
    expect(E.nativesByLevel[0].length).toBe(1);
    E.redo();
    expect(E.nativesByLevel[0].length).toBe(2);

    const idB = E.nativesByLevel[0][1].id;
    E.setTool("erase");
    E.pointerDown(320, 300); E.pointerUp(); // on stroke B's centerline
    expect(E.nativesByLevel[0].length).toBe(1);
    expect(E.nativesByLevel[0].some((o) => o.id === idB)).toBe(false);

    E.undo(); // restores the erased stroke at its original index
    expect(E.nativesByLevel[0].length).toBe(2);
    expect(E.nativesByLevel[0][1].id).toBe(idB);

    E.clear(); // wipe is one undoable op
    expect(E.nativesByLevel[0].length).toBe(0);
    E.undo();
    expect(E.nativesByLevel[0].length).toBe(2);
});

test("erasing via an inherited kobinized copy removes the object everywhere", () => {
    const E = mkEngine();
    drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
    const id = E.nativesByLevel[0][0].id;
    for (let i = 0; i < 12; i++) E.zoomAt(400, 300, -1000);
    expect(E.activeLevel).toBeGreaterThanOrEqual(1);
    const list = E.levelObjects[E.activeLevel] || [];
    expect(list.some((o) => o.id === id && o.origin !== "native")).toBe(true);

    E.setTool("erase");
    E.pointerDown(400, 300); E.pointerUp(); // hits the inherited copy
    expect(E.nativesByLevel[0].length).toBe(0);
    expect((E.levelObjects[E.activeLevel] || []).some((o) => o.id === id)).toBe(false);
});

test("baking a tile from a giant up-projected stroke stays bounded (no OOM freeze)", () => {
    // Regression: a stroke drawn at a deep-negative level, projected UP into level 1's
    // tile bake, is magnified ~3000^N. The windowed flatten there was handed `ew` (the
    // tile grown by half the giant's ~1e26 linewidth) instead of the tile itself, which
    // collapsed the annulus prune and ran the recursion away (6M+ nodes -> OOM crash).
    const E = mkEngine();
    drawStroke(E, [[380, 280], [420, 300], [400, 340], [360, 320], [390, 360]]); // level 0 content
    let guard = 0;
    while (E.activeLevel > -3 && guard++ < 300) E.zoomAt(400, 300, 1000); // zoom OUT
    expect(E.activeLevel).toBeLessThanOrEqual(-3);
    drawStroke(E, [[300, 250], [360, 300], [420, 280], [380, 360], [320, 340]]); // curved deep native
    const t0 = Date.now();
    guard = 0;
    while (E.activeLevel < 1 && guard++ < 400) E.zoomAt(400, 300, -1000); // zoom back IN through the levels
    const ms = Date.now() - t0;
    expect(E.activeLevel).toBeGreaterThanOrEqual(1);
    expect(E.tiles[1] && E.tiles[1].size).toBeGreaterThan(0); // a level-1 tile actually baked
    expect(ms).toBeLessThan(5000); // the pre-fix path runs for minutes / exhausts memory
});

test("snapshot -> loadSnapshot round-trips document, camera and ids", () => {
    const E = mkEngine();
    drawStroke(E, [[100, 100], [200, 150], [250, 260]]);
    for (let i = 0; i < 10; i++) E.zoomAt(200, 150, -1000);
    drawStroke(E, [[400, 300], [450, 340]]); // a native of the deep level
    const snap = JSON.parse(JSON.stringify(E.snapshot()));

    const E2 = mkEngine();
    expect(E2.loadSnapshot(snap)).toBe(true);
    expect(E2.activeLevel).toBe(E.activeLevel);
    expect(E2.inScale).toBe(E.inScale);
    expect(Object.keys(E2.crossings)).toEqual(Object.keys(E.crossings));
    expect(E2.crossings[1].t.x).toBe(E.crossings[1].t.x);
    const count = (X) => Object.values(X.nativesByLevel).reduce((a, arr) => a + arr.length, 0);
    expect(count(E2)).toBe(count(E));

    // new strokes on the restored engine must get FRESH ids (groups + lineage
    // key on the id; a collision silently merges two objects)
    const maxId = Math.max(...Object.values(E2.nativesByLevel).flat().map((o) => o.id));
    E2.setTool("pen");
    drawStroke(E2, [[100, 100], [150, 150]]);
    const ids = Object.values(E2.nativesByLevel).flat().map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeGreaterThan(maxId);
});
