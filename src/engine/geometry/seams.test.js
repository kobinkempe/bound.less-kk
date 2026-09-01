/**
 * S — Seams and tile overlap (docs/erase-tile-window-test-catalog.md).
 *
 * Bible §2.5, flagged "this is not working exactly correctly today" and made
 * open question 1 because the whole erase-by-tile-window design is built on top
 * of it: a cutout that does not overlap its neighbour is a visible box, and a
 * tile piece that overlaps further than its neighbour expects refills a hole
 * the neighbour cut.
 *
 * Adjacent tiles' pieces of the SAME object are clipped slightly PAST the tile
 * so they OVERLAP instead of abutting — abutting edges each half-cover the seam
 * pixel and antialiasing leaves a hairline (composite two 50%-covered opaque
 * fills and 25% of the background still shows).
 *
 * The measured defect at 04c9756, which these tests pin:
 *   - fills, fat strokes, solid quads and down-projected fills all overlap by
 *     2 × seamPad = 38.4 frame units;
 *   - THIN strokes overlap by 2 × lwFrame + a round cap instead — a different
 *     rule that is far larger for a wide stroke and far SMALLER for a thin one;
 *   - the forceOutline path (a window-owning native rendered through
 *     ownContent) clips its centerline to `rect ± half` while clipping the
 *     resulting rings to `rect ± pad`, so with half < pad the band stops short
 *     of the padded rect and the two sides ABUT: measured overlap 0.05 units
 *     against the 38.4 every other path produces, i.e. 768× too small;
 *   - classifyUp decides "solid" against the UNPADDED rect, so a window sitting
 *     just outside a tile but inside its pad is invisible to the test and the
 *     tile-covering quad paints straight over the neighbour's hole.
 */
import LevelMap from "../LevelMap";
import Document from "../Document";
import TileStore from "../TileStore";
import { seamPad, classifyUp, deriveStep } from "./derive";
import { cedeRect } from "../__oracles__/cede";
import { inks, inkers, samples, seamOverlapX } from "../__testkit__/ink";

import { BASE, ENTER, EXIT, R } from "../frameLattice";

const CFG = { enter: ENTER, base: BASE, exit: EXIT, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3, cullPx: 0.3, fadeLoPx: 0.15,
    fatWidthPx: 4000, lineTolPx: 0.25 };

// The SPINE — the chain of origin cells, whose centres are all (0, 0), so a
// parent point maps to its child by exactly xR about the origin and every
// "/ R" and "* R" below reads the way it always did.
const mkMap = (from, to, w = 1280, h = 800) => {
    const M = new LevelMap(CFG, w, h);
    M.ensureSpine(from); M.ensureSpine(to);
    return M;
};
const stores = [];
const mkStore = (M, d) => { const s = new TileStore(M, d, CFG); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop().destroy(); });

const stroke = (d, level, pts, lw, extra = {}) => {
    const o = { type: "stroke", origin: "native", id: d.allocId(), pts, lwFrame: lw,
        color: "#123456", opacity: 1, paths: [], ...extra };
    d.add(o, level); return o;
};
// A resolved perimeter — an axis-aligned box as four line pieces. This is what
// almost everything in the document IS once a stroke has baked, and until
// 2026-08-19 S-1 had no case for it.
const shape = (d, level, x0, y0, x1, y1, extra = {}) => {
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const loop = c.map((A, i) => ({ line: true, A, B: c[(i + 1) % 4] }));
    const o = { type: "shape", origin: "native", id: d.allocId(), loops: [loop],
        color: "#123456", opacity: 1, paths: [], ...extra };
    d.add(o, level); return o;
};
const fill = (d, level, polys, extra = {}) => {
    const o = { type: "fill", origin: "native", id: d.allocId(), polys,
        color: "#123456", opacity: 1, paths: [], ...extra };
    d.add(o, level); return o;
};

// The x of the vertical grid line between child tiles i=0 and i=1, and the same
// point expressed in the PARENT frame (÷R — the spine's cells are concentric,
// so child = parent × R about the origin).
const seamX = (M, key) => { const g = M.grid(key); return g.ox + g.w; };

describe("S-1 — every tile-piece path overlaps its neighbour by at least the seam pad", () => {
    // One rule for the whole engine: whatever the piece is (fill, thin stroke,
    // fat polygonized stroke, tile-covering quad, minified down-piece, or a
    // window owner's own clipped outline), adjacent tiles must overlap by the
    // same amount, because they are all composited together in one list.
    const cases = [
        ["parent fill (magnify)", (d, X) => fill(d, -1, [[[X - 5, -5], [X + 5, -5], [X + 5, 5], [X - 5, 5]]]), "up"],
        ["parent thin stroke", (d, X) => stroke(d, -1, [[X - 5, 0], [X + 5, 0]], 0.02), "up"],
        // lwFrame 0.002 magnifies to lw = 6 frame units — NARROWER than the pad.
        // This is the case that discriminates: the old rule clipped the
        // centerline to rect ± lw, so a stroke thinner than the pad overlapped
        // by less than a fill of the same object did, and the seam showed
        // through wherever the two representations met (T-7 — the wider
        // 0.02 case passes with the defect in place and proves nothing).
        ["parent hairline stroke (lw < pad)", (d, X) => stroke(d, -1, [[X - 5, 0], [X + 5, 0]], 0.002), "up"],
        ["parent fat stroke", (d, X) => stroke(d, -1, [[X - 5, 0], [X + 5, 0]], 3), "up"],
        ["parent wide-but-short stroke", (d, X) => stroke(d, -1, [[X - 0.2, 0], [X + 0.2, 0]], 8), "up"],
        // The one that was missing: a RESOLVED PERIMETER, which is what a baked
        // stroke is and therefore what most of a real document is made of.
        ["parent shape", (d, X) => shape(d, -1, X - 5, -5, X + 5, 5), "up"],
    ];
    test.each(cases)("%s", (_name, mk) => {
        const M = mkMap(-1, 0);
        const X = seamX(M, "0") / R; // the seam, in parent coords
        const d = new Document();
        const o = mk(d, X);
        const ts = mkStore(M, d);
        const list = ts._ensureUp("0", 0, 0).objs.concat(ts._ensureUp("0", 1, 0).objs);
        const pad = seamPad(o, CFG, true);
        expect(pad).toBeGreaterThan(0);
        const { overlap } = seamOverlapX(list, o.id, seamX(M, "0"));
        expect(overlap).toBeGreaterThanOrEqual(2 * pad);
    });

    test("down-projected fill", () => {
        const M = mkMap(0, 1);
        const X = seamX(M, "0") * R; // the level-0 seam, in child coords
        const d = new Document();
        const o = fill(d, 1, [[[X - 3e5, -3e5], [X + 3e5, -3e5], [X + 3e5, 3e5], [X - 3e5, 3e5]]]);
        const ts = mkStore(M, d);
        const list = ts._ensureDown("0", 0, 0).objs.concat(ts._ensureDown("0", 1, 0).objs);
        const pad = seamPad(o, CFG, true);
        expect(seamOverlapX(list, o.id, seamX(M, "0")).overlap).toBeGreaterThanOrEqual(2 * pad);
    });

    test("down-projected stroke", () => {
        const M = mkMap(0, 1);
        const X = seamX(M, "0") * R;
        const d = new Document();
        // 6e3 child units minifies to lw = 2 at level 0 — again narrower than
        // the pad, so this fails on the old `ew = rect ± lw` rule.
        const o = stroke(d, 1, [[X - 3e5, 0], [X + 3e5, 0]], 6e3);
        const ts = mkStore(M, d);
        const list = ts._ensureDown("0", 0, 0).objs.concat(ts._ensureDown("0", 1, 0).objs);
        const pad = seamPad(o, CFG, true);
        expect(seamOverlapX(list, o.id, seamX(M, "0")).overlap).toBeGreaterThanOrEqual(2 * pad);
    });

    // The forceOutline path. Any window or cut a tile can resolve forces the
    // area outline, however thin the stroke is, and that path used to clip its
    // CENTERLINE to the bare tile while clipping the resulting RINGS to the
    // padded one — measured at 04c9756: 0.05 units of overlap where every other
    // path gave 38.4. It is exercised by the tile bake, so test it there.
    test("forced outline across a real tile boundary", () => {
        const M = mkMap(-1, 0);
        const SX = seamX(M, "0");
        const X = SX / R;
        const d = new Document();
        const o = stroke(d, -1, [[X - 5, 0], [X + 5, 0]], 0.002);
        const objs = [];
        for (const i of [0, 1]) {
            deriveStep([o], 300, { x: 0, y: 0 }, M.tileRect("0", i, 0), "0", {
                cfg: CFG, width: M.width, opacityGroups: true, live: null,
                parentCurved: false, childCurved: false, forceOutline: true,
            }, objs);
        }
        expect(objs.length).toBeGreaterThan(1);
        expect(objs.every((p) => p.type === "fill")).toBe(true);
        const pad = seamPad(o, CFG, true);
        expect(seamOverlapX(objs, o.id, SX).overlap).toBeGreaterThanOrEqual(2 * pad);
    });

    // An object at its OWN frame has no seams at all, and since 2026-08-06 that
    // is true without qualification: `ownContent` hands back the natives
    // themselves. It used to have one exception — a parent that had ceded a
    // window kept whole geometry, so its hole existed only as a rect and had to
    // be re-cut per view, per render. Both of that path's defects were view
    // dependence: a cache that went stale on the fast zoom path (measured: an
    // object 3018×1608 px on screen still described by a 15.8×13.1 px window),
    // and 232–386 ms renders rebuilding it. A cut parent needs neither.
    test("a cut native at its own frame renders as ITSELF, at every view", () => {
        const M = mkMap(0, 1);
        const X = seamX(M, "0");
        const d = new Document();
        // A band across the tile line with a tile-sized bite out of it, i.e.
        // exactly what a deep erase leaves behind at the parent's own level.
        const groups = cedeRect([[[X - 500, -20], [X + 500, -20], [X + 500, 20], [X - 500, 20]]],
            { x0: X - 480, y0: -1, x1: X - 479, y1: 1 });
        expect(groups).toHaveLength(1);
        const o = fill(d, 0, groups[0]);
        const ts = mkStore(M, d);
        // Two wildly different views: the whole band, and a sliver at the hole.
        // Same answer, by identity — nothing is derived, so nothing can be stale
        // and nothing can be seamed.
        expect(ts.ownContent("0", { left: X - 600, top: -50, right: X + 600, bottom: 50 })).toEqual([o]);
        expect(ts.ownContent("0", { left: X - 481, top: -2, right: X - 478, bottom: 2 })[0]).toBe(o);
        // ...and the hole is really in the geometry, not in a rect beside it.
        expect(inks([o], [X - 479.5, 0], o.id)).toBe(false);
        expect(inks([o], [X - 470, 0], o.id)).toBe(true);
    });
});

describe("S-3 — the two pieces agree point for point through the overlap band", () => {
    // Trap T-6: the effect lives at the grid-cell scale. A probe sampling at
    // ±0.02 units cannot see a disagreement of one lattice cell, so sample
    // across the whole band at a resolution finer than the band is wide.
    test("no gap and no disagreement anywhere across the seam", () => {
        const M = mkMap(-1, 0);
        const SX = seamX(M, "0");
        const X = SX / R;
        const d = new Document();
        const o = fill(d, -1, [[[X - 5, -5], [X + 5, -5], [X + 5, 5], [X - 5, 5]]]);
        const ts = mkStore(M, d);
        const A = ts._ensureUp("0", 0, 0).objs, B = ts._ensureUp("0", 1, 0).objs;
        const list = A.concat(B);
        const pad = seamPad(o, CFG, true);
        // Sample right across the band, at 400 points over 4 × the pad.
        for (const p of samples([SX - 2 * pad, 0], [SX + 2 * pad, 0], 400)) {
            expect(inks(list, p, o.id)).toBe(true);               // no gap
        }
        // and inside the band both pieces must be present, i.e. they OVERLAP
        // rather than partitioning the band between them.
        let both = 0;
        for (const p of samples([SX - pad / 2, 0], [SX + pad / 2, 0], 100)) {
            if (inkers(list, p, o.id).length >= 2) both++;
        }
        expect(both).toBeGreaterThan(50);
    });
});

describe("S-4 — the pad does not depend on the tile's width", () => {
    // This used to prove the pad survived grids of DIFFERENT widths, because
    // makeGrid was a pure function of canvas size and a pad expressed as a
    // fraction of the tile silently changed meaning between devices. Under P6
    // the grid is a lattice constant, so the stronger statement is now simply
    // true: there is only one tile width, on every device, for ever.
    test("the grid is the same on every canvas, so the pad cannot drift between devices", () => {
        const wide = mkMap(-1, 0, 1280, 800);
        const narrow = mkMap(-1, 0, 411, 750);
        const padOf = () => seamPad({ opacity: 1 }, CFG, true);
        expect(narrow.grid("0").w).toBe(wide.grid("0").w);
        expect(padOf()).toBe(padOf());
    });

    test("the pad is at least one device pixel at the SHALLOWEST in-level zoom", () => {
        // Below cfg.exit the camera crosses down, so exit is where a tile is
        // smallest on screen and the pad has to earn its keep.
        const M = mkMap(-1, 0);
        const pad = seamPad({ opacity: 1 }, CFG, true);
        expect(pad * CFG.exit).toBeGreaterThanOrEqual(1);
    });
});

describe("S-5 — translucent ink across a seam does not double-darken", () => {
    test("the whole family renders in ONE opacity group, so overlap composites once", () => {
        // Overlap is only safe because per-object opacity groups union the
        // pieces before opacity applies. The Renderer keys groups by
        // editId ?? id, so every tile piece of one logical object lands in one
        // group — assert that grouping key directly.
        const M = mkMap(-1, 0);
        const X = seamX(M, "0") / R;
        const d = new Document();
        const o = fill(d, -1, [[[X - 5, -5], [X + 5, -5], [X + 5, 5], [X - 5, 5]]], { opacity: 0.4 });
        const ts = mkStore(M, d);
        const list = ts._ensureUp("0", 0, 0).objs.concat(ts._ensureUp("0", 1, 0).objs)
            .filter((p) => p.id === o.id);
        expect(list.length).toBeGreaterThan(1);
        expect(new Set(list.map((p) => (p.editId != null ? p.editId : p.id))).size).toBe(1);
        for (const p of list) expect(p.opacity).toBe(0.4);
    });

    test("translucent ink still overlaps when opacity groups are on", () => {
        const M = mkMap(-1, 0);
        const rect = M.tileRect("0", 0, 0);
        expect(seamPad({ opacity: 0.4 }, CFG, true)).toBeGreaterThan(0);
        // With grouping OFF, overlap would double-darken, so it is deliberately
        // surrendered — the hairline is the lesser evil. Pin that trade-off.
        expect(seamPad({ opacity: 0.4 }, CFG, false)).toBe(0);
        expect(seamPad({ opacity: 1 }, CFG, false)).toBeGreaterThan(0);
    });
});

describe("S-6 — a stroke piece and a fill piece of one object use the same extent", () => {
    test("thin-stroke overlap matches fill overlap for the same object and seam", () => {
        const M = mkMap(-1, 0);
        const SX = seamX(M, "0");
        const X = SX / R;
        const d = new Document();
        // Same centerline, same width, but one is forced through the outline
        // (fill) branch and the other stays a stroke. The width is chosen so
        // the magnified lw (6) is NARROWER than the pad (30): that is the only
        // regime in which the two rules disagree.
        const o = stroke(d, -1, [[X - 5, 0], [X + 5, 0]], 0.002);
        const ts = mkStore(M, d);
        const asStroke = ts._ensureUp("0", 0, 0).objs.concat(ts._ensureUp("0", 1, 0).objs);
        expect(asStroke.every((p) => p.type === "stroke")).toBe(true);
        const strokeOverlap = seamOverlapX(asStroke, o.id, SX).overlap;

        const d2 = new Document();
        const o2 = stroke(d2, -1, [[X - 5, 0], [X + 5, 0]], 0.02);
        const ts2 = mkStore(M, d2);
        const objs = [];
        for (const i of [0, 1]) {
            // eslint-disable-next-line no-underscore-dangle
            require("./derive").deriveStep([o2], 300, { x: 0, y: 0 }, M.tileRect("0", i, 0), "0",
                { cfg: CFG, width: M.width, opacityGroups: true, live: null,
                    parentCurved: false, childCurved: false, forceOutline: true }, objs);
        }
        expect(objs.every((p) => p.type === "fill")).toBe(true);
        const fillOverlap = seamOverlapX(objs, o2.id, SX).overlap;
        // Both must clear the pad, and neither may be starved relative to the
        // other — a hole cut by one representation must not be refilled by the
        // other's wider overhang.
        const pad = seamPad(o, CFG, true);
        expect(fillOverlap).toBeGreaterThanOrEqual(2 * pad);
        expect(strokeOverlap).toBeGreaterThanOrEqual(2 * pad);
    });
});

describe("S-8 — a hole survives the magnify chain, crossing after crossing", () => {
    // The solid tier is what bounds the magnify chain: an object covering the
    // whole tile is replaced by a 4-vertex quad, and that quad is what gets
    // magnified next. A quad has no hole in it, so an object that ever takes
    // that path loses its erase forever, at every depth below.
    //
    // The window model handled this by making the quad CARRY the rects it could
    // not yet resolve, and by making classifyUp ask, at every crossing, whether
    // one had become resolvable. That machinery is gone. What replaces it is
    // structural rather than conditional — a cut object is a fill with a hole,
    // and `covers` is set only by solidQuad — so the thing to test is not the
    // classifier's answer but the picture, several crossings down.
    test("cut at level -3, still cut at level 0 — three crossings of magnification", () => {
        const M = mkMap(-3, 0);
        const d = new Document();
        // 20×20 units at level -3 is 20 × 3000³ = 5.4e11 units at level 0: far
        // past covering the tile, so every step is a candidate for the fast path.
        const groups = cedeRect([[[-10, -10], [10, -10], [10, 10], [-10, 10]]],
            { x0: -4, y0: -3, x1: 4, y1: 3 });
        expect(groups).toHaveLength(1);
        const o = fill(d, -3, groups[0]);
        const ts = mkStore(M, d);
        const f = Math.pow(CFG.enter / CFG.base, 3);   // -3 -> 0: 2.7e10
        // Look at the hole's RIGHT EDGE, not its middle. A tile deep inside the
        // hole is empty — but so is a tile whose chain silently produced nothing
        // at all, and those must not be confused. A tile straddling the edge has
        // to show ink on one side and none on the other, which only a chain that
        // carried the geometry the whole way can do.
        const X = 4 * f, band = 4000;
        const range = M.tileRange("0", { left: X - band, top: -band, right: X + band, bottom: band });
        const list = [];
        for (let i = range.i0; i <= range.i1; i++) {
            for (let j = range.j0; j <= range.j1; j++) list.push(...ts._ensureUp("0", i, j).objs);
        }
        expect(list.length).toBeGreaterThan(0);
        // 2000 units at level 0 is 7.4e-8 units at the object's own level, and
        // the seam pad down here is 30. Both are far inside the tile.
        for (const p of samples([X - band / 2, -band / 2], [X - band / 2, band / 2], 40)) {
            expect(inks(list, p, o.id)).toBe(false);      // ceded: still a hole
        }
        for (const p of samples([X + band / 2, -band / 2], [X + band / 2, band / 2], 40)) {
            expect(inks(list, p, o.id)).toBe(true);       // the ink beside it
        }
    });
});
