/**
 * LevelMap — golden-compare against the old engine's crossing/grid/walk math,
 * plus the on-demand grid derivation (levels that legitimately lack a record:
 * fresh level 0, the coarsest level visited) and serialization round-trip.
 */
import KobinEngineV0 from "./KobinEngineV0";
import LevelMap from "./LevelMap";

jest.setTimeout(30000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngineV0(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const mkMap = (w = 800, h = 600) => {
    const E = mkEngine(w, h);
    return { E, M: new LevelMap(E.cfg, w, h) };
};

describe("record creation (first-crossing-forever semantics)", () => {
    test("ensureUp pins s = enter even when the zoom overshot", () => {
        const { M } = mkMap();
        // camera overshot to 412x before the cross was applied
        const rec = M.ensureUp(1, 412, 1000, -500);
        expect(rec.s).toBe(300); // pinned, NOT 412 (hysteresis-inversion guard)
        const k = 300 / 412;
        expect(rec.t.x).toBeCloseTo(1000 * k, 12);
        expect(rec.t.y).toBeCloseTo(-500 * k, 12);
        // re-entry reuses the record untouched
        expect(M.ensureUp(1, 999, 7, 7)).toBe(rec);
    });
    test("ensureUp/ensureDown reproduce the engine's record formulas", () => {
        const { E } = mkMap();
        const M2 = new LevelMap(E.cfg, 800, 600);
        // _crossUp's first-entry record: t = pan * (enter / inScale)
        const rec2 = M2.ensureUp(1, 350, 123, 456);
        const k = 300 / 350;
        expect(rec2.t).toEqual({ x: 123 * k, y: 456 * k });
        // _crossDown's first-exit record: t = -pan * base / inScale
        const rec3 = M2.ensureDown(0, 0.04, 200, -300);
        expect(rec3.s).toBe(300);
        expect(rec3.t.x).toBeCloseTo(-200 * 0.1 / 0.04, 12);
        expect(rec3.t.y).toBeCloseTo(300 * 0.1 / 0.04, 12);
    });
});

describe("grids", () => {
    test("makeGrid matches the engine's _makeGrid", () => {
        const { E, M } = mkMap(1504, 868);
        expect(M.makeGrid()).toEqual(E._makeGrid());
    });
    test("grid() prefers the captured record grid; derives (stably) when absent", () => {
        const { M } = mkMap();
        const rec = M.ensureUp(1, 300, 0, 0);
        expect(M.grid(1)).toBe(rec.grid);
        const d1 = M.grid(-7); // no record at the coarsest level — derived
        const d2 = M.grid(-7);
        expect(d2).toBe(d1);   // stable within a session
        expect(d1).toEqual(M.makeGrid());
    });
    test("resize keeps captured grids, rebases derivations", () => {
        const { M } = mkMap();
        const rec = M.ensureUp(1, 300, 0, 0);
        const before = { ...rec.grid };
        M.resize(1200, 900);
        expect(M.grid(1)).toEqual(before);          // captured: unchanged
        expect(M.grid(0)).toEqual(M.makeGrid());    // derived: new dimensions
        expect(M.grid(0).w).toBeCloseTo(3 * 1200 / 0.1, 9);
    });
    test("tileRect / tileRange match the engine on a captured grid", () => {
        const { E, M } = mkMap();
        E.crossings[2] = { s: 300, t: { x: 77, y: -13 }, grid: E._makeGrid() };
        M.load(E.crossings);
        expect(M.tileRect(2, -3, 5)).toEqual(E._tileRect(2, -3, 5));
        const r = { left: -50000, top: -1000, right: 130000, bottom: 90000 };
        expect(M.tileRange(2, r)).toEqual(E._tileRange(2, r));
    });
});

describe("transforms and walks", () => {
    const wire = () => {
        const { E, M } = mkMap();
        E.crossings[2] = { s: 300, t: { x: 11, y: 12 }, grid: E._makeGrid() };
        E.crossings[1] = { s: 300, t: { x: -7, y: 3.5 }, grid: E._makeGrid() };
        E.crossings[0] = { s: 300, t: { x: 100, y: -40 }, grid: E._makeGrid() };
        E.crossings[-1] = { s: 300, t: { x: 0.5, y: 0.25 }, grid: E._makeGrid() };
        M.load(E.crossings);
        return { E, M };
    };
    test("toChild/toParent round-trip and match rectToParent corners", () => {
        const { M } = wire();
        const p = [123.456, -78.9];
        const c = M.toChild(p, 1);
        const back = M.toParent(c, 1);
        expect(back[0]).toBeCloseTo(p[0], 8);
        expect(back[1]).toBeCloseTo(p[1], 8);
        const rect = { left: -10, top: -20, right: 30, bottom: 40 };
        const pr = M.rectToParent(rect, 1);
        expect([pr.left, pr.top]).toEqual(M.toParent([rect.left, rect.top], 1));
        expect([pr.right, pr.bottom]).toEqual(M.toParent([rect.right, rect.bottom], 1));
    });
    test("levelPointToScreen matches the engine across ±2 levels", () => {
        const { E, M } = wire();
        E.activeLevel = 0; E.inScale = 1.7; E.inPanX = 55; E.inPanY = -20;
        for (const L of [-1, 0, 1, 2]) {
            const a = E._levelPointToScreen(L, 42, -17);
            const b = M.levelPointToScreen(L, 42, -17, 0, 1.7, 55, -20);
            expect(b).toEqual(a);
        }
        // missing record on the path -> null on both sides
        expect(E._levelPointToScreen(3, 1, 1)).toBeNull();
        expect(M.levelPointToScreen(3, 1, 1, 0, 1.7, 55, -20)).toBeNull();
    });
    test("effectiveZoom matches the engine above and below zero", () => {
        const { E, M } = wire();
        for (const [level, scale] of [[2, 0.5], [0, 3], [-1, 120]]) {
            E.activeLevel = level; E.inScale = scale;
            expect(M.effectiveZoom(level, scale)).toBe(E._effectiveZoom());
        }
    });
    test("up-then-down walk is drift-free (record math only)", () => {
        const { M } = wire();
        const p = [3.14159, -2.71828];
        let q = p;
        for (const N of [0, 1, 2]) q = M.toChild(q, N);
        for (const N of [2, 1, 0]) q = M.toParent(q, N);
        expect(q[0]).toBeCloseTo(p[0], 9);
        expect(q[1]).toBeCloseTo(p[1], 9);
    });
});

describe("serialization (dev-0 crossings shape)", () => {
    test("serialize/load round-trips and matches the engine snapshot shape", () => {
        const { E, M } = mkMap();
        E.crossings[1] = { s: 300, t: { x: 5, y: 6 }, grid: E._makeGrid() };
        E.crossings[-2] = { s: 300, t: { x: -1, y: 2 }, grid: E._makeGrid() };
        M.load(E.crossings);
        const snap = M.serialize();
        expect(snap).toEqual(E.snapshot().crossings); // same wire format
        const M2 = new LevelMap(E.cfg, 800, 600);
        M2.load(snap);
        expect(M2.serialize()).toEqual(snap);
        expect(M2.records[-2].t).toEqual({ x: -1, y: 2 }); // negative string keys land as numbers
    });
});
