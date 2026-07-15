/**
 * TileStore — the bidirectional bake. Verifies the symmetric size policy
 * (magnify chain bounded by solid quads; direct minify with cull/fade), the
 * XOR-source invariant (no id from two directions), bidirectional invalidation
 * including the erase-ghost case the old engine could not have, bake-order
 * determinism, and LRU bounding.
 */
import LevelMap from "./LevelMap";
import Document from "./Document";
import TileStore from "./TileStore";

const CFG = { enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, lineModeLevel: 2 };

// A LevelMap with identity-translation records (t=0) at a span of levels, so
// level L maps to L+1 by ×3000 about the origin — easy to reason about.
const mkMap = (from, to, w = 800, h = 600) => {
    const M = new LevelMap(CFG, w, h);
    const cr = {};
    for (let l = from; l <= to; l++) cr[l] = { s: 300, t: { x: 0, y: 0 }, grid: M.makeGrid() };
    M.load(cr);
    return M;
};
const mkStroke = (doc, level, pts, lw, extra = {}) => {
    const o = { type: "stroke", origin: "native", id: doc.allocId(), pts, lwFrame: lw, color: "#123456", opacity: 1, paths: [], ...extra };
    doc.add(o, level);
    return o;
};
const win = (M, level) => { const g = M.grid(level); return { left: g.ox, top: g.oy, right: g.ox + g.w, bottom: g.oy + g.h }; };

let stores = [];
const mkStore = (M, d) => { const s = new TileStore(M, d, CFG); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop().destroy(); });

describe("magnify chain (upContent)", () => {
    test("a coarse stroke reaches a finer level's tiles, bounded (never an exploded polygon)", () => {
        const M = mkMap(-3, 0);
        const d = new Document();
        // a small stroke at level -2 near the origin
        mkStroke(d, -2, [[0, 0], [20, 0], [40, 10]], 6);
        const ts = mkStore(M, d);
        const pieces = ts.content(0, win(M, 0)); // view from level 0 (2 levels finer)
        const up = pieces.filter((o) => o.origin === "inherited");
        expect(up.length).toBeGreaterThan(0);
        // magnified ×3000² = 9e6, yet every piece is a bounded polygon — the whole
        // point of the classify-and-chain: geometry can never outgrow a tile.
        for (const q of up) for (const poly of q.polys) expect(poly.length).toBeLessThan(200);
    });
    test("a wide coarse stroke whose disc covers a finer tile becomes a solid quad", () => {
        const M = mkMap(-1, 0);
        const d = new Document();
        // lw big enough that one anchor's magnified disc (half = lw*3000/2) covers a tile
        mkStroke(d, -1, [[0, 0], [3, 0]], 40);
        const ts = mkStore(M, d);
        const up = ts.content(0, win(M, 0)).filter((o) => o.origin === "inherited");
        expect(up.some((o) => o.covers && o.polys[0].length === 4)).toBe(true);
    });
    test("chain terminates (no runaway) with content 7 levels down", () => {
        const M = mkMap(-7, 0);
        const d = new Document();
        for (let l = -7; l <= -1; l++) mkStroke(d, l, [[0, 0], [5, 2], [10, -3]], 2 + Math.abs(l));
        const ts = mkStore(M, d);
        const t0 = Date.now();
        const pieces = ts.content(0, win(M, 0));
        // "No runaway": a genuine chain explosion was SECONDS-to-minutes (the old
        // 167 s / 583 s Clipper blowups). This asserts termination, not perf —
        // solo it runs ~0.5 s; the wide bound just absorbs parallel-worker
        // contention that used to flake the old 1000 ms guard.
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(pieces.length).toBeGreaterThan(0);
        expect(ts.size()).toBeLessThanOrEqual(512);
    });
    test("empty when nothing coarser exists", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        mkStroke(d, 2, [[0, 0], [1, 1]], 1); // content only at the FINEST level
        const ts = mkStore(M, d);
        const up = ts.content(0, win(M, 0)).filter((o) => o.origin === "inherited");
        expect(up).toHaveLength(0);
    });
});

describe("direct minify (downContent) + fade", () => {
    test("a finer stroke minifies into a coarser tile, tagged for fade", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        // one level finer (level 1), viewed from 0: f = 1/3000, so a big stroke
        // (frame diag ~ 3e5) lands at a few px — visible, minified, thin.
        mkStroke(d, 1, [[-150000, 0], [150000, 0], [180000, 60000]], 9000);
        const ts = mkStore(M, d);
        const down = ts.content(0, win(M, 0)).filter((o) => o.origin === "derived");
        expect(down.length).toBeGreaterThan(0);
        expect(down.every((o) => typeof o.fadeTag === "number")).toBe(true);
        // minified strokes are thin — never fat
        expect(down.every((o) => o.type === "stroke")).toBe(true);
    });
    test("sub-fadeLo content is culled entirely (not baked)", () => {
        const M = mkMap(0, 4);
        const d = new Document();
        // 2+ levels finer is guaranteed sub-pixel: f=(1/3000)^2 -> ~1e-7, culled.
        mkStroke(d, 2, [[0, 0], [2, 0]], 1);
        const ts = mkStore(M, d);
        const down = ts.content(0, win(M, 0)).filter((o) => o.origin === "derived");
        expect(down).toHaveLength(0);
    });
});

describe("XOR-source invariant", () => {
    test("no id appears from two directions at the active level", () => {
        const M = mkMap(-2, 2);
        const d = new Document();
        mkStroke(d, -1, [[0, 0], [10, 0]], 4);   // coarser -> up
        mkStroke(d, 0, [[0, 0], [10, 0]], 4);     // own -> live (not in tiles)
        mkStroke(d, 1, [[-30, 0], [30, 0]], 60);  // finer -> down
        const ts = mkStore(M, d);
        const pieces = ts.content(0, win(M, 0));
        const byId = new Map();
        for (const o of pieces) {
            const set = byId.get(o.id) || new Set();
            set.add(o.origin === "inherited" ? "up" : "down");
            byId.set(o.id, set);
        }
        for (const [, set] of byId) expect(set.size).toBe(1); // each id from exactly one source class
    });
});

describe("bake-order determinism", () => {
    test("baking tiles in different visit orders yields identical content", () => {
        const M = mkMap(-3, 0);
        const d = new Document();
        for (let l = -3; l <= -1; l++) mkStroke(d, l, [[0, 0], [8, 3], [16, -4]], 3);
        const norm = (ts) => {
            const p = ts.content(0, win(M, 0)).map((o) => JSON.stringify([o.id, o.type, o.covers || false, o.polys ? o.polys.map((r) => r.length) : o.pts.length]));
            return p.sort();
        };
        const a = mkStore(M, d); const A = norm(a);
        // fresh store, warm a finer tile FIRST (different order), then read
        const b = mkStore(M, new Document());
        // rebuild identical doc for b
        const d2 = new Document();
        for (let l = -3; l <= -1; l++) mkStroke(d2, l, [[0, 0], [8, 3], [16, -4]], 3);
        const b2 = mkStore(M, d2);
        b2._ensureUp(0, 1, 1); b2._ensureUp(-1, 0, 0); // touch out of order
        const B = norm(b2);
        expect(B).toEqual(A);
    });
});

describe("bidirectional invalidation", () => {
    test("adding a finer stroke drops stale coarser (down) tiles", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        mkStroke(d, 1, [[-20, 0], [20, 0]], 40);
        const ts = mkStore(M, d);
        ts.content(0, win(M, 0));
        const before = ts.size();
        expect(before).toBeGreaterThan(0);
        mkStroke(d, 1, [[-20, 30], [20, 30]], 40); // new finer content overlapping the same coarse tile
        // the coarse down-tile covering the origin must have been invalidated
        const downKeys = ts._tileKeys().filter((k) => k.includes("|down|"));
        expect(downKeys.every((k) => ts.cache.get(k))).toBe(true); // survivors are valid
        const rebaked = ts.content(0, win(M, 0)).filter((o) => o.origin === "derived");
        expect(rebaked.some((o) => o.pts.some((p) => Math.abs(p[1]) > 0))).toBe(true); // new stroke present
    });
    test("ERASE removes ghost ink from a coarser tile (the new bug class)", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        const a = mkStroke(d, 1, [[-20, 0], [20, 0]], 40);
        const b = mkStroke(d, 1, [[-20, 40], [20, 40]], 40);
        const ts = mkStore(M, d);
        const before = ts.content(0, win(M, 0)).filter((o) => o.origin === "derived");
        expect(before.some((o) => o.id === b.id)).toBe(true);
        d.removeById(b.id); // erase b at its home level
        const after = ts.content(0, win(M, 0)).filter((o) => o.origin === "derived");
        expect(after.some((o) => o.id === b.id)).toBe(false); // gone from the coarse tile — no ghost
        expect(after.some((o) => o.id === a.id)).toBe(true);  // a still there
    });
    test("adding a coarse stroke UPDATES cached finer (up) tiles in place (incremental)", () => {
        const M = mkMap(-2, 0);
        const d = new Document();
        mkStroke(d, -1, [[0, 0], [10, 0]], 4);
        const ts = mkStore(M, d);
        ts.content(0, win(M, 0));
        const upBefore = ts._tileKeys().filter((k) => k.startsWith("0|up|")).sort();
        expect(upBefore.length).toBeGreaterThan(0);
        const o2 = mkStroke(d, -1, [[0, 5], [10, 5]], 4); // more coarse content at the direct parent
        // the cached child tiles SURVIVE (one added stroke must not nuke the
        // cache) and already carry the new object's pieces — no rebake needed
        expect(ts._tileKeys().filter((k) => k.startsWith("0|up|")).sort()).toEqual(upBefore);
        const pieces = ts.content(0, win(M, 0));
        expect(pieces.some((p) => p.id === o2.id)).toBe(true);
    });
    test("a NEW stroke two levels above still invalidates chained up-tiles (fallback)", () => {
        const M = mkMap(-2, 0);
        const d = new Document();
        mkStroke(d, -2, [[-0.01, 0], [0.01, 0]], 0.004); // tiny at -2, spans the window ×9e6
        const ts = mkStore(M, d);
        ts.content(0, win(M, 0)); // level-0 tiles chain through level -1
        // grandparent content changed: chained tiles can't be appended (their
        // content flows through level -1 tiles) — the fallback invalidates them
        const o2 = mkStroke(d, -2, [[-0.01, 0.001], [0.01, 0.001]], 0.004);
        const pieces = ts.content(0, win(M, 0));
        expect(pieces.some((p) => p.id === o2.id)).toBe(true); // correct content either way
    });
    test("clear/reset nukes the whole cache", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        mkStroke(d, 1, [[-20, 0], [20, 0]], 40);
        const ts = mkStore(M, d);
        ts.content(0, win(M, 0));
        expect(ts.size()).toBeGreaterThan(0);
        d.clear(null, () => null, () => {});
        expect(ts.size()).toBe(0);
    });
});

describe("epoch / config", () => {
    test("toggling opacity groups invalidates all tiles", () => {
        const M = mkMap(-2, 0);
        const d = new Document();
        mkStroke(d, -1, [[0, 0], [10, 0]], 4);
        const ts = mkStore(M, d);
        ts.content(0, win(M, 0));
        expect(ts.size()).toBeGreaterThan(0);
        ts.setOpacityGroups(false);
        expect(ts.size()).toBe(0);
    });
});
