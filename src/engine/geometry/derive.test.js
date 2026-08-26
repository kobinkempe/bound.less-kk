/**
 * derive.js — golden-compare against the old engine (Phase 1 is pure extraction:
 * deriveStep/projectNative must reproduce _deriveInto/_projectNative EXACTLY),
 * plus unit tests for the NEW classify tiers (the symmetric magnify size policy).
 */
import KobinEngineV0 from "../KobinEngineV0";
import { deriveStep, projectNative, classifyUp, solidQuad, bboxOf, levelFactor, projectedSizePx, seamPad, LEGACY_SEAMS } from "./derive";
import purple from "../__fixtures__/bug02-purple.json";
import { windingOfPoint } from "./hittest";
import { cedeRect } from "./cede";

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

const clone = (o) => JSON.parse(JSON.stringify(o));
const mkStroke = (id, pts, lw, extra = {}) => ({ type: "stroke", origin: "native", id, pts, lwFrame: lw, color: "#123456", opacity: 1, paths: [], ...extra });

// A parent-object zoo covering every _deriveInto branch: small (stays stroke),
// gate-wide (Clipper outline), mega (analytic strip), curved multi-point
// (flatChords), fill, off-tile (culled), single-point dot, translucent.
const zoo = () => [
    mkStroke(1, [[0, 0], [30, 10], [60, 5]], 0.4),                          // small, curved
    mkStroke(2, [[-20, -20], [40, 40]], 0.4),                                // small, 2pt
    mkStroke(3, purple.pts, purple.lwFrame, { color: purple.color }),        // real fat stroke
    mkStroke(4, [[-5e4, 0], [5e4, 1e3], [9e4, -2e3]], 700, { opacity: 0.45 }), // mega span
    mkStroke(5, [[10, 10]], 2),                                              // dot
    { type: "fill", origin: "inherited", id: 6, color: "#0a0a0a", opacity: 0.8, paths: [],
        polys: [[[0, 0], [50, 0], [50, 40], [0, 40]], [[10, 10], [10, 30], [30, 30], [30, 10]]] },
    mkStroke(7, [[9e9, 9e9], [9e9 + 1, 9e9]], 1),                            // far off-tile
];

describe("deriveStep — golden vs KobinEngineV0._deriveInto", () => {
    // Run both sides on independently CLONED inputs (the object-attached caches
    // must not leak between sides) across the branch-relevant levels.
    test.each([[1], [2], [3]])("level %i bake matches the engine exactly", (level) => {
        const E = mkEngine(800, 600);
        const s = 300, t = { x: 1234.5, y: -987.25 };
        const rect = { left: -6000, top: -4500, right: 18000, bottom: 13500 };
        const oldOut = [];
        E._deriveInto(zoo().map(clone), s, t, rect, level, oldOut);
        const newOut = deriveStep(zoo().map(clone), s, t, rect, level, {
            cfg: E.cfg, width: E.width, opacityGroups: E.opacityGroups, live: null,
            parentCurved: (level - 1) < E.cfg.lineModeLevel,
            childCurved: level < E.cfg.lineModeLevel,
            seams: LEGACY_SEAMS, // replay V0's seam rule; production's is corrected (see seams.test.js)
        }, []);
        expect(newOut).toEqual(oldOut);
        expect(newOut.length).toBeGreaterThan(0); // the zoo must actually exercise the bake
    });

    test("opacity-group seam pad matches (groups off)", () => {
        const E = mkEngine(800, 600);
        E.opacityGroups = false;
        const s = 300, t = { x: 0, y: 0 };
        const rect = { left: 0, top: 0, right: 24000, bottom: 18000 };
        const oldOut = [];
        E._deriveInto(zoo().map(clone), s, t, rect, 1, oldOut);
        const newOut = deriveStep(zoo().map(clone), s, t, rect, 1, {
            cfg: E.cfg, width: E.width, opacityGroups: false, live: null,
            parentCurved: true, childCurved: true, seams: LEGACY_SEAMS,
        }, []);
        expect(newOut).toEqual(oldOut);
    });
});

describe("tile seam overlap", () => {
    const rect = { left: 0, top: 0, right: 24000, bottom: 18000 };
    const CFG_EXIT = { exit: 0.05 };
    test("opaque ink gets a buffer even when opacity grouping is disabled", () => {
        expect(seamPad({ opacity: 1 }, CFG_EXIT, false)).toBeGreaterThan(0);
    });
    test("transparent ink gets a buffer when per-object opacity grouping makes overlap safe", () => {
        expect(seamPad({ opacity: 0.35 }, CFG_EXIT, true)).toBeGreaterThan(0);
        expect(seamPad({ opacity: 0.35 }, CFG_EXIT, false)).toBe(0);
    });

    // These two used to be about "windows" — a rect the parent recorded and the
    // bake subtracted on the way down. That is gone (2026-08-06): the parent's
    // rings are CUT, so a hole is ordinary geometry by the time deriveStep sees
    // it. What has to be re-pinned is that nothing on the way down puts the ink
    // back, and there are exactly two things that could.
    const CUT_CFG = { base: 0.1, enter: 300, fadeLoPx: 0.15, fatWidthPx: 4000,
        arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, scale: 1000 };
    // A 20×20 parent fill with a tile-sized bite (8 × 6 parent units, the real
    // makeGrid tile for an 800×600 canvas) taken out of its middle.
    const cutParent = (id = 90) => {
        const hole = { x0: -4, y0: -3, x1: 4, y1: 3 };
        const groups = cedeRect([[[-10, -10], [10, -10], [10, 10], [-10, 10]]], hole);
        expect(groups).toHaveLength(1);   // a ring of ink, still one piece
        return { type: "fill", origin: "native", id, z: id, color: "#000",
            opacity: 1, paths: [], polys: groups[0] };
    };

    test("the seam pad overlaps the tile line without refilling a hole cut in the ink", () => {
        // The pad exists to make neighbouring pieces OVERLAP, so it grows the
        // clip rect — and the old windowPad, being the thing that sized the hole
        // rather than the clip, could and did eat 25 % of a small window and
        // draw a box round every erase. Growing a clip rect cannot reach an
        // interior hole at all; this is that difference, stated as a test.
        const parent = cutParent();
        const out = deriveStep([parent], CUT_CFG.enter, { x: 0, y: 0 }, rect, 1, {
            cfg: CUT_CFG, width: 800, opacityGroups: true, live: null,
            parentCurved: false, childCurved: false,
        }, []);
        const rings = out.flatMap((o) => o.polys || []);
        const f = CUT_CFG.enter / CUT_CFG.base;    // parent unit -> child unit
        // Magnified, the hole is x ∈ [-12000, 12000], y ∈ [-9000, 9000] and the
        // ink runs to ±30000. The tile is [0, 24000] × [0, 18000], so it holds
        // one quadrant of the hole and the ink on two sides of it — everything
        // below is stated inside that, since deriveStep clips to the tile.
        expect([4 * f, 3 * f, rect.right]).toEqual([12000, 9000, 24000]);
        expect(windingOfPoint(rings, [100, 100])).toBe(0);          // in the hole
        expect(windingOfPoint(rings, [4 * f - 1, 100])).toBe(0);    // 1 unit inside its
        expect(windingOfPoint(rings, [100, 3 * f - 1])).toBe(0);    // right and bottom edge
        // ...and the ink around it is all still there, one unit past each edge.
        // One child unit is 1/30000 of a parent unit — finer than the pad by a
        // factor of nine hundred thousand, so a pad that leaked at all leaks here.
        expect(windingOfPoint(rings, [4 * f + 1, 100])).not.toBe(0);
        expect(windingOfPoint(rings, [100, 3 * f + 1])).not.toBe(0);
    });

    test("the solid tier cannot stand in for a cut object, however wide it is", () => {
        // The other way the ink comes back, and the one the deleted machinery
        // actually existed for: a tile-covering object is replaced by a 4-vertex
        // quad, which is how the magnify chain stays bounded — and a quad has no
        // hole in it. The old model needed classifyUp to ask "is there a window
        // over this tile?" because a window-owning parent was still, physically,
        // a solid band. A CUT parent is not: it is a fill with a hole, `covers`
        // is set by solidQuad alone, and no native ever carries it.
        const s = CUT_CFG.enter, t = { x: 0, y: 0 };
        // Same object, uncut: wide enough that the fast path does fire.
        const whole = { type: "stroke", origin: "native", id: 91, pts: [[0, 0], [3, 0]],
            lwFrame: 40, color: "#000", opacity: 1, paths: [] };
        expect(classifyUp(whole, s, t, rect, CUT_CFG, null)).toBe("solid");
        // Cut — an erase outlines a stroke to a fill before it cedes anything —
        // and the same geometry over the same tile is now the edge tier.
        const cut = cutParent(92);
        expect(classifyUp(cut, s, t, rect, CUT_CFG, null)).toBe("edge");
        // And what deriveStep emits for it must not claim to cover either, or
        // the NEXT crossing would take the fast path and lose the hole.
        const out = deriveStep([cut], s, t, rect, 1, {
            cfg: CUT_CFG, width: 800, opacityGroups: true, live: null,
            parentCurved: false, childCurved: false,
        }, []);
        expect(out.length).toBeGreaterThan(0);
        expect(out.some((p) => p.covers)).toBe(false);
    });
});

describe("projectNative / levelFactor — golden vs engine", () => {
    test("chains match the engine in both directions", () => {
        const E = mkEngine(800, 600);
        E.crossings[1] = { s: 300, t: { x: 11.5, y: -3.25 }, grid: E._makeGrid() };
        E.crossings[0] = { s: 300, t: { x: -40, y: 17 }, grid: E._makeGrid() };
        E.crossings[-1] = { s: 300, t: { x: 5, y: 5 }, grid: E._makeGrid() };
        const o = mkStroke(9, [[1, 2], [3, 4], [10, -6]], 0.7);
        for (const [H, L] of [[1, -2], [-2, 1], [0, 1], [1, 0]]) {
            E._projCache.clear();
            const oldD = E._projectNative(clone(o), H, L);
            const newD = projectNative(clone(o), H, L, E.crossings, E.cfg.base);
            expect(newD).toEqual(oldD);
        }
        // missing record -> null on both sides
        E._projCache.clear();
        expect(E._projectNative(clone(o), 1, -3)).toBeNull();
        expect(projectNative(clone(o), 1, -3, E.crossings, E.cfg.base)).toBeNull();
    });

    test("levelFactor inverts and matches the chain magnitude", () => {
        const E = mkEngine();
        for (const l of [-1, 0, 1, 2]) E.crossings[l] = { s: 300, t: { x: 0, y: 0 }, grid: E._makeGrid() };
        const up = levelFactor(-1, 2, E.crossings, 0.1);   // 3 magnify steps
        const down = levelFactor(2, -1, E.crossings, 0.1); // 3 minify steps
        expect(up).toBeCloseTo(3000 ** 3, 0);
        expect(up * down).toBeCloseTo(1, 9);
        expect(levelFactor(0, 3, E.crossings, 0.1)).toBeNull(); // record 3 missing
    });
});

describe("classifyUp — the symmetric magnify size policy (new)", () => {
    const cfg = { base: 0.1, enter: 300 };
    const rect = { left: 0, top: 0, right: 24000, bottom: 18000 };
    const s = 300, t = { x: 0, y: 0 }; // f = 3000

    test("band that cannot reach the tile is EMPTY", () => {
        const o = mkStroke(1, [[100, 100], [110, 100]], 1); // maps to ~3e5, half-width 1500
        expect(classifyUp(o, s, { x: -1e6, y: -1e6 }, rect, cfg, null)).toBe("empty");
    });
    test("one anchor disc covering the whole tile is SOLID, and the quad covers it", () => {
        // anchor at tile centre (needs (4,3) in parent -> ×3000 = (12000,9000));
        // disc must cover the tile's diagonal reach: hypot(hw+ 0, hh + 0)... use lw 20 -> half 30000 > hypot(12000,9000)+diag
        const o = mkStroke(2, [[4, 3], [5, 3]], 25);
        expect(classifyUp(o, s, t, rect, cfg, null)).toBe("solid");
        const q = solidQuad(o, rect);
        expect(q.covers).toBe(true);
        expect(q.polys[0]).toHaveLength(4);
        expect(q.id).toBe(2);
        // a covering quad stays SOLID one more step up (self-propagation)
        expect(classifyUp(q, s, t, { left: 0, top: 0, right: 24000 * 3000 + 1, bottom: 18000 * 3000 }, cfg, null)).toBe("edge"); // tile pokes past the quad's image
        expect(classifyUp(q, s, t, { left: 100, top: 100, right: 200, bottom: 200 }, cfg, null)).toBe("solid"); // inside image of quad
    });
    test("band edge crossing the tile is EDGE, and deriveStep is its exact backstop", () => {
        const o = mkStroke(3, [[-20, 6], [20, 6]], 2); // half 3000: band [15000..21000] horizontal strip edge in tile
        expect(classifyUp(o, s, t, rect, cfg, null)).toBe("edge");
        const out = deriveStep([o], s, t, rect, 1, {
            cfg: { base: 0.1, enter: 300, arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, lineModeLevel: 2, scale: 1000 },
            width: 800, opacityGroups: true, live: null, parentCurved: false, childCurved: false,
        }, []);
        expect(out.length).toBeGreaterThan(0); // edge tier actually produces coverage
    });
    test("classification tiers partition the zoo consistently with deriveStep output", () => {
        const dcfg = { base: 0.1, enter: 300, arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, lineModeLevel: 2, scale: 1000 };
        for (const o of zoo()) {
            const tier = classifyUp(clone(o), s, t, rect, cfg, null);
            const out = deriveStep([clone(o)], s, t, rect, 1, {
                cfg: dcfg, width: 800, opacityGroups: true, live: null, parentCurved: true, childCurved: true,
            }, []);
            if (tier === "empty") expect(out).toHaveLength(0);
            if (tier === "solid") expect(out.length).toBeGreaterThan(0); // engine bake also floods it
        }
    });
});

describe("projectedSizePx / bboxOf", () => {
    test("size measure matches the engine's down-cull expression", () => {
        const E = mkEngine();
        const o = mkStroke(1, [[0, 0], [3, 4]], 2); // diag 5 + lw 2 = 7
        const f = 1 / 3000;
        expect(projectedSizePx(o, f, { enter: 300 }, null)).toBeCloseTo(7 * f * 300, 12);
        const b = bboxOf(o, null);
        expect(b).toEqual({ x0: 0, y0: 0, x1: 3, y1: 4 });
        expect(o._bbox).toBe(b); // cached
        const live = mkStroke(2, [[0, 0], [1, 1]], 1);
        bboxOf(live, live);
        expect(live._bbox).toBeUndefined(); // live stroke never caches
    });
});
