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
import { tileContent } from "./__oracles__/renderList";

import { BASE, ENTER, EXIT, HALF_W, REACH, G } from "./frameLattice";
import { projectedSizePx, bboxOf } from "./geometry/derive";
import { rectLoop } from "./geometry/arcShape";

const CFG = { enter: ENTER, base: BASE, exit: EXIT, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, lineModeLevel: 2 };

// A LevelMap holding the SPINE — the chain of origin cells — over a span of
// depths, so level L maps to L+1 by exactly R. Frames used to be free-floating
// records that a test could pin to t=0; a frame is now a lattice cell, so the
// spine is what "the obvious chain" means.
const mkMap = (from, to, w = 800, h = 600) => {
    const M = new LevelMap(CFG, w, h);
    M.ensureSpine(from); M.ensureSpine(to);
    return M;
};
const mkStroke = (doc, level, pts, lw, extra = {}) => {
    const o = { type: "stroke", origin: "native", id: doc.allocId(), pts, lwFrame: lw, color: "#123456", opacity: 1, ...extra };
    doc.add(o, level);
    return o;
};
// The whole frame — a cell is the natural unit of "everything visible here".
const win = () => ({ left: -HALF_W, top: -HALF_W, right: HALF_W, bottom: HALF_W });
// Where a deep frame's origin sits in a coarser one. A cell's origin is at its
// parent's coordinate (i + 1/2)*G, so the spine is NOT the coarse frame's
// origin — content has to be drawn where the deeper frame is actually looking,
// which used to be (0, 0) only because a test could pin a free-floating record
// to t = 0.
const under = (M, coarse, deep) => M.mapPointF([0, 0], String(deep), String(coarse));

let stores = [];
const mkStore = (M, d) => { const s = new TileStore(M, d, CFG); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop().destroy(); });

describe("magnify chain (upContent)", () => {
    test("a coarse stroke reaches a finer level's tiles, bounded (never an exploded polygon)", () => {
        const M = mkMap(-3, 0);
        const d = new Document();
        // a small stroke at level -2, drawn across what level 0 is looking at
        const [ux, uy] = under(M, -2, 0);
        mkStroke(d, -2, [[ux - 20, uy], [ux, uy], [ux + 20, uy + 10]], 6);
        const ts = mkStore(M, d);
        const pieces = tileContent(ts, 0, win()); // view from level 0 (2 levels finer)
        const up = pieces.filter((o) => o.origin === "inherited");
        expect(up.length).toBeGreaterThan(0);
        // magnified ×3000² = 9e6, yet every piece is a bounded polygon — the whole
        // point of the classify-and-chain: geometry can never outgrow a tile.
        for (const q of up) for (const poly of q.polys) expect(poly.length).toBeLessThan(200);
    });
    test("a wide coarse stroke whose disc covers a finer tile becomes a solid quad", () => {
        const M = mkMap(-1, 0);
        const d = new Document();
        // lw big enough that one anchor's magnified disc (half = lw*R/2) covers a
        // whole tile, corners included: a tile's far corner is sqrt(2)*TILE away.
        const [ux, uy] = under(M, -1, 0);
        mkStroke(d, -1, [[ux, uy], [ux + 3, uy]], 120);
        const ts = mkStore(M, d);
        const up = tileContent(ts, 0, win()).filter((o) => o.origin === "inherited");
        expect(up.some((o) => o.covers && o.polys[0].length === 4)).toBe(true);
    });
    test("chain terminates (no runaway) with content 7 levels down", () => {
        const M = mkMap(-7, 0);
        const d = new Document();
        for (let l = -7; l <= -1; l++) mkStroke(d, l, [[0, 0], [5, 2], [10, -3]], 2 + Math.abs(l));
        const ts = mkStore(M, d);
        const t0 = Date.now();
        const pieces = tileContent(ts, 0, win());
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
        const up = tileContent(ts, 0, win()).filter((o) => o.origin === "inherited");
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
        const down = tileContent(ts, 0, win()).filter((o) => o.origin === "derived");
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
        const down = tileContent(ts, 0, win()).filter((o) => o.origin === "derived");
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
        const pieces = tileContent(ts, 0, win());
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
            const p = tileContent(ts, 0, win()).map((o) => JSON.stringify([o.id, o.type, o.covers || false, o.polys ? o.polys.map((r) => r.length) : o.pts.length]));
            return p.sort();
        };
        const a = mkStore(M, d); const A = norm(a);
        // fresh store, warm a finer tile FIRST (different order), then read
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
        tileContent(ts, 0, win());
        const before = ts.size();
        expect(before).toBeGreaterThan(0);
        mkStroke(d, 1, [[-20, 30], [20, 30]], 40); // new finer content overlapping the same coarse tile
        // the coarse down-tile covering the origin must have been invalidated
        const downKeys = ts._tileKeys().filter((k) => k.includes("|down|"));
        expect(downKeys.every((k) => ts.cache.get(k))).toBe(true); // survivors are valid
        const rebaked = tileContent(ts, 0, win()).filter((o) => o.origin === "derived");
        expect(rebaked.some((o) => o.pts.some((p) => Math.abs(p[1]) > 0))).toBe(true); // new stroke present
    });
    test("ERASE removes ghost ink from a coarser tile (the new bug class)", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        const a = mkStroke(d, 1, [[-20, 0], [20, 0]], 40);
        const b = mkStroke(d, 1, [[-20, 40], [20, 40]], 40);
        const ts = mkStore(M, d);
        const before = tileContent(ts, 0, win()).filter((o) => o.origin === "derived");
        expect(before.some((o) => o.id === b.id)).toBe(true);
        d.removeById(b.id); // erase b at its home level
        const after = tileContent(ts, 0, win()).filter((o) => o.origin === "derived");
        expect(after.some((o) => o.id === b.id)).toBe(false); // gone from the coarse tile — no ghost
        expect(after.some((o) => o.id === a.id)).toBe(true);  // a still there
    });
    test("adding a coarse stroke UPDATES cached finer (up) tiles in place (incremental)", () => {
        const M = mkMap(-2, 0);
        const d = new Document();
        mkStroke(d, -1, [[0, 0], [10, 0]], 4);
        const ts = mkStore(M, d);
        tileContent(ts, 0, win());
        const upBefore = ts._tileKeys().filter((k) => k.startsWith("0|up|")).sort();
        expect(upBefore.length).toBeGreaterThan(0);
        const o2 = mkStroke(d, -1, [[0, 5], [10, 5]], 4); // more coarse content at the direct parent
        // the cached child tiles SURVIVE (one added stroke must not nuke the
        // cache) and already carry the new object's pieces — no rebake needed
        expect(ts._tileKeys().filter((k) => k.startsWith("0|up|")).sort()).toEqual(upBefore);
        const pieces = tileContent(ts, 0, win());
        expect(pieces.some((p) => p.id === o2.id)).toBe(true);
    });
    test("a NEW stroke two levels above still invalidates chained up-tiles (fallback)", () => {
        const M = mkMap(-2, 0);
        const d = new Document();
        const [ux, uy] = under(M, -2, 0);
        mkStroke(d, -2, [[ux - 0.01, uy], [ux + 0.01, uy]], 0.004); // tiny at -2, spans the window x R^2
        const ts = mkStore(M, d);
        tileContent(ts, 0, win()); // level-0 tiles chain through level -1
        // grandparent content changed: chained tiles can't be appended (their
        // content flows through level -1 tiles) — the fallback invalidates them
        const o2 = mkStroke(d, -2, [[ux - 0.01, uy + 0.001], [ux + 0.01, uy + 0.001]], 0.004);
        const pieces = tileContent(ts, 0, win());
        expect(pieces.some((p) => p.id === o2.id)).toBe(true); // correct content either way
    });
    test("clear/reset nukes the whole cache", () => {
        const M = mkMap(0, 2);
        const d = new Document();
        mkStroke(d, 1, [[-20, 0], [20, 0]], 40);
        const ts = mkStore(M, d);
        tileContent(ts, 0, win());
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
        tileContent(ts, 0, win());
        expect(ts.size()).toBeGreaterThan(0);
        ts.setOpacityGroups(false);
        expect(ts.size()).toBe(0);
    });
});

describe("the downward scan's whole-frame skip equals the old per-object scan (row 11, 2026-09-14)", () => {
    // The scan as it was before 2026-09-14, kept here as the oracle.
    const oldBakeDown = (ts, F, i, j) => {
        const rect = ts.lm.tileRect(F, i, j), objs = [], enter = ts.cfg.enter, Fdepth = ts._depth(F);
        const cands = [];
        for (const k of ts.doc.levels()) {
            if (!ts.doc.at(k).length || k === F || ts.lm.isAncestor(k, F) || ts._depth(k) < Fdepth) continue;
            cands.push(k);
        }
        cands.sort((a, b) => ts._depth(a) - ts._depth(b));
        for (const G of cands) {
            const f = ts.lm.frameFactor(G, F);
            if (f == null || 5e5 * f * enter < ts.fadeLoPx) continue;
            for (const o of ts.doc.at(G)) {
                const tag = projectedSizePx(o, f, ts.cfg, ts.live);
                if (tag < ts.fadeLoPx) continue;
                const b = bboxOf(o, ts.live);
                const bAtF = ts.lm.mapRectF({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, G, F);
                const lwF = (o.lwFrame || 0) * f;
                if (!bAtF || bAtF.right + lwF < rect.left || bAtF.left - lwF > rect.right || bAtF.bottom + lwF < rect.top || bAtF.top - lwF > rect.bottom) continue;
                const d = ts.lm.projectF(o, G, F);
                if (d) ts._downPieces(o, d, rect, tag, objs);
            }
        }
        return objs;
    };
    const norm = (objs) => objs.map((o) => JSON.stringify([o.id, o.type, o.fadeTag, o.covers || false, o.clip || null, o.lwFrame || 0, o.polys || o.pts])).sort();
    const build = () => {
        const M = mkMap(0, 3);
        for (const [p, i, j] of [["1", 1, 0], ["2", 1, 0], ["0", 1, 0], ["0", 3, 0], ["1/1,0", 0, 0]]) M.cellChild(p, i, j);
        const d = new Document();
        const at = { "1": [[0, 0], [HALF_W - 10, 20]], "2": [[-HALF_W + 5, 0], [0, 0]], "3": [[100, 100], [900, 400]], "1/1,0": [[0, 0], [300, 300]], "2/1,0": [[-2000, 0], [2000, 0]], "0/1,0": [[-400, -400], [400, 400]], "0/3,0": [[0, 0], [500, 500]], "1/1,0/0,0": [[0, 0], [50, 50]] };
        for (const [L, pts] of Object.entries(at)) for (const lw of [1, 12, 40]) mkStroke(d, L, pts.map(([x, y]) => [x + lw, y - lw]), lw);
        mkStroke(d, "2", [[-30000, -30000], [30000, 30000]], 3000);                          // a big one: over the cull two levels up
        d.add({ type: "fill", origin: "native", id: d.allocId(), polys: [[[0, 0], [800, 0], [800, 600], [0, 600]]], color: "#0f0", opacity: 1 }, "1");
        d.add({ type: "shape", origin: "native", id: d.allocId(), loops: rectLoop({ left: -HALF_W, top: -50, right: -HALF_W + 400, bottom: 50 }), color: "#00f", opacity: 1, w: 8 }, "1");
        return { M, d, ts: mkStore(M, d) };
    };
    test("identical pieces for every tile of several frames, and whole frames skipped", () => {
        const { M, d, ts } = build();
        let calls = 0; const at0 = d.at.bind(d); d.at = (L) => { calls++; return at0(L); };
        let skippedSomething = false;
        for (const F of ["0", "1", "2", "1/1,0"]) for (const [i, j] of [[0, 0], [1, 0], [0, -1], [-1, 1]]) {
            calls = 0; const oldOut = norm(oldBakeDown(ts, F, i, j)); const oldCalls = calls;
            calls = 0; const newOut = norm(ts._bakeDown(F, i, j)); const newCalls = calls;
            expect([F, i, j, newOut]).toEqual([F, i, j, oldOut]);
            if (newCalls < oldCalls) skippedSomething = true;
        }
        expect(skippedSomething).toBe(true);
        expect(M.frames.size).toBeGreaterThan(8);
    });
    test("the fixture keeps invariant 2, and a branch three cells away is never visited", () => {
        const { M, d, ts } = build();
        for (const L of d.levels()) for (const o of d.at(L)) {
            const b = bboxOf(o, null), lw = o.lwFrame || 0;
            expect(Math.max(Math.abs(b.x0) + lw, Math.abs(b.x1) + lw, Math.abs(b.y0) + lw, Math.abs(b.y1) + lw)).toBeLessThanOrEqual(REACH);
        }
        const src = ts._downSources("1", M.tileRect("1", 0, 0));
        expect(src).not.toContain("0/3,0");
        expect(src).toEqual(expect.arrayContaining(["2", "3", "1/1,0", "2/1,0", "1/1,0/0,0", "0/1,0"]));
        for (let i = 1; i < src.length; i++) expect(M.depthOf(src[i])).toBeGreaterThanOrEqual(M.depthOf(src[i - 1]));
    });
});

describe("a re-addressed frame's content moves in the tiles (subtree O(1), 2026-09-15)", () => {
    // K is one level below "0" at cell (3, 0): a stroke of 2e4 units in it is 2e4 / R = 4.9 units
    // at "0", above the cull, so it is a speck in "0"'s down tile (0, 0).
    const build = () => {
        const M = mkMap(0, 1);
        const K = M.cellChild("0", 3, 0);
        const d = new Document(); d.lm = M;
        const o = mkStroke(d, K.id, [[-3e4, 0], [3e4, 0]], 2e4);
        const ts = mkStore(M, d);
        return { M, K, d, o, ts };
    };
    const xs = (tile, id) => tile.objs.filter((p) => p.id === id)
        .flatMap((p) => (p.polys ? p.polys.flat() : p.pts || []).map((q) => q[0]));
    const centre = (arr) => (Math.min(...arr) + Math.max(...arr)) / 2;
    test("a refile drops the tiles that held the frame's content; the rebuild places it at the new cell", () => {
        const { M, K, d, o, ts } = build();
        const before = xs(ts._ensureDown("0", 0, 0), o.id);
        expect(before.length).toBeGreaterThan(0);
        expect(Math.abs(centre(before) - 3 * G)).toBeLessThan(1);
        expect(M.readdress(K.id, "0", 5, 0)).toBe(K);
        d.noteRefile(K.id, { parent: "0", i: 3, j: 0 }, { parent: "0", i: 5, j: 0 });
        expect(ts.cache.has("0|down|0,0")).toBe(false);
        const after = xs(ts._ensureDown("0", 0, 0), o.id);
        expect(after.length).toBeGreaterThan(0);
        expect(centre(after) - centre(before)).toBeCloseTo(2 * G, 6);
    });
    test("a tile of the moved frame is rebuilt on its next lookup, with no event at all", () => {
        const { M, K, d, ts } = build();
        mkStroke(d, "0", [[3 * G - 8, 0], [3 * G + 8, 0]], 2);   // an ancestor's ink through K's cell
        const up0 = ts._ensureUp(K.id, 0, 0);
        expect(up0.objs.length).toBeGreaterThan(0);
        expect(ts._ensureUp(K.id, 0, 0)).toBe(up0);                 // a hit
        M.readdress(K.id, "0", 5, 0);                                // the address changed; no event
        const up1 = ts._ensureUp(K.id, 0, 0);
        expect(up1).not.toBe(up0);
        expect(up1.seq).toBe(up0.seq + 1);
        expect(JSON.stringify(up1.objs)).not.toBe(JSON.stringify(up0.objs));
    });
    test("setting a subtree aside and restoring it drops the tiles that held its content", () => {
        const { K, d, o, ts } = build();
        expect(xs(ts._ensureDown("0", 0, 0), o.id).length).toBeGreaterThan(0);
        const recs = d.removeFrameSubtree(K.id);
        expect(ts.cache.has("0|down|0,0")).toBe(false);
        expect(xs(ts._ensureDown("0", 0, 0), o.id).length).toBe(0);
        d.insertFrameSubtree(recs);
        expect(ts.cache.has("0|down|0,0")).toBe(false);
        expect(xs(ts._ensureDown("0", 0, 0), o.id).length).toBeGreaterThan(0);
    });
});
