/**
 * KobinEngine (new facade) — the six behavioural invariants from the old
 * engine's suite, run against the NEW engine, plus the Two.js z-order spike and
 * the incremental-render / camera-only-pan checks. The old KobinEngineV0.test.js
 * still runs green against the old engine; this is the new engine's equivalent.
 */
import KobinEngine from "./KobinEngine";

jest.setTimeout(30000);

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
};
const countNatives = (E) => Object.values(E.nativesByLevel).reduce((a, arr) => a + arr.length, 0);

describe("camera + crossings", () => {
    test("deep asymmetric zoom round-trip returns with zero drift", () => {
        const E = mkEngine();
        drawStroke(E, [[380, 280], [420, 320], [400, 360]]);
        const probe = E.screenToFrame(400, 300);
        const start = { level: E.activeLevel, x: E.inPanX, y: E.inPanY, s: E.inScale };
        for (let i = 0; i < 20; i++) E.zoomAt(400, 300, -1000); // in
        for (let i = 0; i < 20; i++) E.zoomAt(400, 300, 1000);  // back out
        // same active level and a probe point mapping back to the same screen spot
        expect(E.activeLevel).toBe(start.level);
        const back = E.cam.levelPointToScreen(E.activeLevel, probe[0], probe[1]);
        expect(back[0]).toBeCloseTo(400, 3);
        expect(back[1]).toBeCloseTo(300, 3);
    });
    test("crossing records pin on first entry and re-entry reuses them", () => {
        const E = mkEngine();
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
        expect(E.activeLevel).toBeGreaterThanOrEqual(1);
        expect(E.crossings[1].s).toBe(300); // pinned at enter
        const t = { ...E.crossings[1].t };
        for (let i = 0; i < 6; i++) E.zoomAt(400, 300, 1000); // back below
        guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000); // re-enter
        expect(E.crossings[1].t).toEqual(t); // record unchanged
    });
});

describe("document ops", () => {
    test("undo/redo, true-erase and wipe round-trip the document", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [180, 120], [220, 160]]);
        drawStroke(E, [[300, 300], [340, 300], [380, 310]]);
        expect(E.nativesByLevel[0].length).toBe(2);
        E.undo(); expect(E.nativesByLevel[0].length).toBe(1);
        E.redo(); expect(E.nativesByLevel[0].length).toBe(2);
        const idB = E.nativesByLevel[0][1].id;
        E.setTool("erase");
        E.pointerDown(320, 300); E.pointerUp();
        expect(E.nativesByLevel[0].some((o) => o.id === idB)).toBe(false);
        E.undo();
        expect(E.nativesByLevel[0][1].id).toBe(idB);
        E.setTool("pen");
        E.clear();
        expect(countNatives(E)).toBe(0);
        E.undo();
        expect(E.nativesByLevel[0].length).toBe(2);
    });
    test("erasing via an inherited kobinized copy removes the object everywhere", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        const id = E.nativesByLevel[0][0].id;
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
        expect(E.activeLevel).toBeGreaterThanOrEqual(1);
        // the object now appears only as inherited pieces (up-content), not a native
        expect(E._objs().some((o) => o.id === id && o.origin !== "native")).toBe(true);
        E.setTool("erase");
        E.pointerDown(400, 300); E.pointerUp();
        expect(countNatives(E)).toBe(0);
        expect(E._objs().some((o) => o.id === id)).toBe(false);
    });
    test("snapshot -> loadSnapshot round-trips document, camera and ids", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150], [250, 260]]);
        for (let i = 0; i < 10; i++) E.zoomAt(200, 150, -1000);
        drawStroke(E, [[400, 300], [450, 340]]);
        const snap = JSON.parse(JSON.stringify(E.snapshot()));
        const E2 = mkEngine();
        expect(E2.loadSnapshot(snap)).toBe(true);
        expect(E2.activeLevel).toBe(E.activeLevel);
        expect(E2.inScale).toBe(E.inScale);
        expect(Object.keys(E2.crossings).sort()).toEqual(Object.keys(E.crossings).sort());
        expect(countNatives(E2)).toBe(countNatives(E));
        const maxId = Math.max(...Object.values(E2.nativesByLevel).flat().map((o) => o.id));
        E2.setTool("pen");
        drawStroke(E2, [[100, 100], [150, 150]]);
        const ids = Object.values(E2.nativesByLevel).flat().map((o) => o.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Math.max(...ids)).toBeGreaterThan(maxId);
    });
});

describe("robustness (ported OOM guard)", () => {
    test("zooming a deep-level drawing back in stays bounded (no OOM freeze)", () => {
        const E = mkEngine();
        drawStroke(E, [[380, 280], [420, 300], [400, 340], [360, 320], [390, 360]]);
        let guard = 0;
        while (E.activeLevel > -3 && guard++ < 300) E.zoomAt(400, 300, 1000); // out
        expect(E.activeLevel).toBeLessThanOrEqual(-3);
        drawStroke(E, [[300, 250], [360, 300], [420, 280], [380, 360], [320, 340]]);
        const t0 = Date.now();
        guard = 0;
        while (E.activeLevel < 1 && guard++ < 400) E.zoomAt(400, 300, -1000); // back in
        expect(E.activeLevel).toBeGreaterThanOrEqual(1);
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(E.tiles[1] && E.tiles[1].size).toBeGreaterThan(0);
    });
});

describe("z-order + incremental render", () => {
    test("Two.js keeps world children in id order after sorted insertion", () => {
        const E = mkEngine();
        // draw three strokes; ids ascend with creation
        drawStroke(E, [[100, 100], [120, 120]]);
        drawStroke(E, [[200, 100], [220, 120]]);
        drawStroke(E, [[300, 100], [320, 120]]);
        const ids = E.nativesByLevel[0].map((o) => o.id);
        // world children order (per-id groups) must be ascending by id
        const order = E.renderer._order;
        expect(order).toEqual([...ids].sort((a, b) => a - b));
        // and the actual Two children match that group order (per-level scene
        // retention nests the id-groups under the active level's root, a child
        // of world — so read the ordering there)
        const groupIndexById = new Map();
        E.renderer._activeRoot.children.forEach((g, idx) => {
            for (const [id, entry] of E.renderer._groups) if (entry.group === g) groupIndexById.set(id, idx);
        });
        for (let i = 1; i < ids.length; i++) expect(groupIndexById.get(ids[i])).toBeGreaterThan(groupIndexById.get(ids[i - 1]));
    });
    test("BUG-03: a newer object across levels draws on top of an older one", () => {
        const E = mkEngine();
        // A: older, drawn at level 1
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
        drawStroke(E, [[380, 280], [420, 320], [400, 360]]);
        const idA = E.nativesByLevel[1][E.nativesByLevel[1].length - 1].id;
        // B: newer, drawn at level 0 (coarser) over the same spot -> reaches level 1 as up-content
        guard = 0;
        while (E.activeLevel > 0 && guard++ < 40) E.zoomAt(400, 300, 1000);
        drawStroke(E, [[380, 280], [420, 320], [400, 360]]);
        const idB = E.nativesByLevel[0][E.nativesByLevel[0].length - 1].id;
        expect(idB).toBeGreaterThan(idA);
        // back to level 1: A native, B inherited; render list sorted by id => B after A
        guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
        const list = E._objs();
        const idxA = list.findIndex((o) => o.id === idA);
        const idxB = list.findIndex((o) => o.id === idB);
        expect(idxA).toBeGreaterThanOrEqual(0);
        expect(idxB).toBeGreaterThanOrEqual(0);
        expect(idxB).toBeGreaterThan(idxA); // newer draws later (on top)
    });
    test("ISSUE-11: a no-op re-render reuses the existing path objects", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150], [260, 260]]);
        const id = E.nativesByLevel[0][0].id;
        const before = E.renderer._groups.get(id).group.children[0];
        E._render(); // nothing changed
        const after = E.renderer._groups.get(id).group.children[0];
        expect(after).toBe(before); // same Two.Path instance, not rebuilt
    });
    test("a pure pan within the visible tile set does not rebuild groups", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 300], [420, 320]]);
        const id = E.nativesByLevel[0][0].id;
        const before = E.renderer._groups.get(id).group.children[0];
        E.setTool("pan");
        E.pointerDown(400, 300); E.pointerMove(402, 301); E.pointerUp(); // tiny pan
        const after = E.renderer._groups.get(id).group.children[0];
        expect(after).toBe(before); // camera-only sync: no path churn
    });
});
