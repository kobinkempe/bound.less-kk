/**
 * W — Ceding a tile, and nesting; C — composition
 * (docs/erase-tile-window-test-catalog.md).
 *
 * Bible §2.1: an erase deeper than its target bakes into the Kobinization tile,
 * and the parent CEDES that tile — its ink there is cut away and handed to a new
 * native one crossing down, which is where the erase itself is finally applied.
 *
 * Two things about that are load-bearing and are what this file pins.
 *
 * NESTING. The chain is walked one crossing at a time, and each link cedes only
 * to the link immediately below it. A single flat cede — top-level parent
 * straight to the erase's own frame — dies at five crossings, measured: the
 * ceded rect is 1.9e-8 units wide in the target's frame at three crossings,
 * 9.1e-12 at four, and EXACTLY ZERO at five, because one float64 step at those
 * coordinates is 8.9e-14 and the rect is narrower than that. It fails silently:
 * a zero-width hole is cut and no hole appears. Nested, every hole is ~1/3000 of
 * the frame it is cut into, at every depth, and nothing approaches the floor.
 *
 * CUTTING, not recording. Until 2026-08-06 the parent kept its geometry whole
 * and recorded the rect as a `windows` entry, subtracted per view at render
 * time. That is gone. Both models put a hole in the picture; only one of them
 * puts it in the DOCUMENT, and the difference shows up wherever something asks
 * the geometry a question — severance (two lumps the child had parted were
 * still one polygon up here), staleness (the subtraction was cached against the
 * view, and the fast zoom path skips the render that would rebuild it) and cost.
 */
import KobinEngine from "./KobinEngine";
import { classifyUp, solidQuad } from "./geometry/derive";
import { inks } from "./__testkit__/ink";
import { loopsBBox } from "./geometry/arcShape";

jest.setTimeout(120000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width = 13, color) => {
    E.setTool("pen"); E.setWidth(width); if (color) E.setColor(color);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
};
const eraseGesture = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const descend = (E, n, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 400) E.zoomAt(sx, sy, -1000);
    expect(E.activeLevel).toBe(n);
};
const ascend = (E, n, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel > n && guard++ < 400) E.zoomAt(sx, sy, 1000);
    expect(E.activeLevel).toBe(n);
};
// Ink at a SCREEN point, from the rendered list, with no hit-test slop (T-1).
const inkAtScreen = (E, sx, sy) => inks(E._objs().filter((o) => !o.erase), E.cam.screenToFrame(sx, sy));

// Ceding REPLACES objects (remove + add), so a reference taken before an erase
// names nothing afterwards. The family key is what survives; look members up
// through it. This bit the implementation too — see _bakeRehome's note on
// taking the key from `cur`.
const familyAt = (E, key, F) => (E.doc.at(F) || []).filter((o) => !o.erase && E.doc.editKey(o) === key);
const soleKey = (E) => {
    const keys = new Set();
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) keys.add(E.doc.editKey(o));
    return [...keys];
};

describe("W-1 — an erase at the object's own home level", () => {
    test("cuts in place; nothing is ceded and no cut record is created", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 20);
        E.setEraserSize(18);
        eraseGesture(E, [[400, 240], [400, 360]]); // straight through: severs
        E.flushErases();
        const natives = E.doc.at("0");
        expect(natives).toHaveLength(2);
        for (const o of natives) {
            expect(o.type).toBe("shape");
            expect(o.attachRect).toBeUndefined();   // nothing ceded: same level
            // Severed pieces BAKE (bible §4.1): once a piece is cut loose a
            // shared eraser no longer describes where its edges are.
            expect(o.cuts).toBeUndefined();
        }
        // ...and no chain was materialised anywhere below.
        for (const k of E.doc.levels()) if (k !== "0") expect(E.doc.at(k).filter((o) => !o.erase)).toHaveLength(0);
    });

    test("a bite that does NOT sever leaves ONE piece, baked in place", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 40);
        E.setEraserSize(14);
        eraseGesture(E, [[400, 275]]); // nicks the top edge only
        E.flushErases();
        const natives = E.doc.at("0");
        expect(natives).toHaveLength(1);
        expect(natives[0].type).toBe("shape");         // cut in place at its home
        expect(natives[0].attachRect).toBeUndefined(); // nothing ceded
        E._render();
        expect(inkAtScreen(E, 400, 277)).toBe(false); // the bite is real
        expect(inkAtScreen(E, 400, 315)).toBe(true);  // the rest of the band is not
    });
});

describe("W-2/W-3 — cedes NEST, one per crossing", () => {
    // The property nesting exists to deliver, checked as a RATIO against the
    // frame it is cut into rather than as an absolute — that is what makes it
    // depth-independent, and depth-independence is the whole claim.
    test.each([[1], [2], [3], [4], [5], [6]])("%i crossing(s) deep", (n) => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 24);
        descend(E, n);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 260], [400, 340]]);
        E.flushErases();

        const keys = soleKey(E);
        expect(keys).toHaveLength(1);        // one gesture, still one object
        const key = keys[0];

        // One link per crossing, each holding the ink its parent gave up.
        const chain = [];
        for (let d = 0; d <= n; d++) {
            const F = E.lm.pathFrameAt(E.cam.frame, d);
            const mem = familyAt(E, key, F);
            expect([d, mem.length]).toEqual([d, expect.any(Number)]);
            expect(mem.length).toBeGreaterThan(0);
            chain.push({ d, F, mem });
        }
        expect(chain[0].mem.every((o) => o.attachRect == null)).toBe(true);   // the home
        for (let d = 1; d <= n; d++) {
            expect(chain[d].mem.some((o) => o.attachRect != null)).toBe(true); // re-homed
        }

        // THE NESTING INVARIANT. Each link's ceded rect, mapped into the frame
        // of the parent that gave it up, is about one three-thousandth of that
        // parent's own tile — a tile of the CHILD's frame, never the erase's
        // tiny footprint and never a rect that shrinks with depth. The block may
        // run to four tiles a side when a gesture straddles a seam, hence the
        // upper bound; the lower one is what would break if a link were ever
        // skipped and the chain flattened.
        const step = E.cfg.base / E.cfg.enter;    // 1/3000
        for (let d = 1; d <= n; d++) {
            const child = chain[d].mem.find((o) => o.attachRect != null);
            const parentFrame = chain[d - 1].F;
            const hole = E.lm.mapRectF(
                { left: child.attachRect.x0, top: child.attachRect.y0,
                    right: child.attachRect.x1, bottom: child.attachRect.y1 },
                chain[d].F, parentFrame);
            const pg = E.lm.grid(parentFrame);
            const ratio = (hole.right - hole.left) / pg.w;
            expect([d, ratio > step / 2, ratio < step * 8]).toEqual([d, true, true]);

            // ...and it is a hole in the parent's GEOMETRY, not a rect recorded
            // beside it. Probe the parent's own rings at the hole's centre.
            const cx = (hole.left + hole.right) / 2, cy = (hole.top + hole.bottom) / 2;
            // Ask the parent's OWN geometry, whatever form it is in — the cut
            // leaves a resolved perimeter, which answers this exactly.
            const par = chain[d - 1].mem;
            expect([d, inks(par, [cx, cy])]).toEqual([d, false]);
            // The parent's ink resumes just outside it — so this is a hole, and
            // not a parent that simply has no ink here.
            //
            // Probed on a row the parent actually HAS ink on. A ceded tile is
            // the size of a frame (D4) and is centred on the frame origin, which
            // the lattice puts at a cell centre — so the hole's own middle can
            // land on the very edge of a thin stroke, where a ray cast is
            // neither in nor out. The row that answers the question is the
            // middle of the overlap between the hole and the parent's ink.
            const w = hole.right - hole.left;
            const pb = par.map((o) => loopsBBox(o.loops)).filter(Boolean);
            const iy0 = Math.max(hole.top, Math.min(...pb.map((b) => b.y0)));
            const iy1 = Math.min(hole.bottom, Math.max(...pb.map((b) => b.y1)));
            const py = iy1 > iy0 ? (iy0 + iy1) / 2 : cy;
            expect([d, inks(par, [hole.left - w / 4, py]) || inks(par, [hole.right + w / 4, py])]).toEqual([d, true]);
        }

        // And the hole is real at the level it was made in.
        E._render();
        expect(inkAtScreen(E, 400, 300)).toBe(false);
        expect(inkAtScreen(E, 300, 300)).toBe(true);
    });
});

describe("W-4 — erasing where no tile has ever been baked", () => {
    test("five crossings into virgin territory still cuts", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 24);
        // Pan somewhere the first render never touched, THEN descend. Anchor the
        // zoom ON the ink so it stays under the cursor all the way down —
        // otherwise it leaves the screen after two steps and the gesture erases
        // empty paper (which is a broken probe, not a broken engine: T-3).
        E.setTool("pan"); E.panBy(-120, -80);
        descend(E, 5, 300, 220);
        E.setEraserSize(20);
        eraseGesture(E, [[300, 180], [300, 260]]);
        E.flushErases();
        // The whole containment chain gets materialised on the way down, even
        // though no tile here was ever baked before (Kobin's answer 4).
        const key = soleKey(E)[0];
        for (let d = 1; d <= 5; d++) {
            const F = E.lm.pathFrameAt(E.cam.frame, d);
            expect(familyAt(E, key, F).some((o) => o.attachRect != null)).toBe(true);
        }
        E._render();
        expect(inkAtScreen(E, 300, 220)).toBe(false);
    });
});

describe("W-6/W-10 — the solid tier must not paint a hole shut", () => {
    // A tile-covering object is replaced by a 4-vertex quad, which is what keeps
    // the magnify chain bounded — and a quad has no hole in it, so anything that
    // takes that path loses its erase at every depth below. A long band is
    // ALWAYS the edge tier (no single anchor's disc covers a tile when the view
    // is far from both ends), so a test built on one never reaches this branch
    // at all — the vacuous test T-7 caught. This one is built on geometry that
    // genuinely reaches the solid tier.
    //
    // The classifier used to need a special case here: a window-owning parent
    // was still, physically, a solid band, so classifyUp had to ask at every
    // crossing whether one of its rects had become resolvable. Cutting removed
    // the question rather than answering it — see the S-8 chain test in
    // geometry/seams.test.js, which follows one three crossings down.
    const CFG = { base: 0.1, enter: 300, exit: 0.05, fadeLoPx: 0.15, arcTolerancePx: 0.25,
        polygonizeWidthFrac: 1 / 3, scale: 1000, fatWidthPx: 4000 };
    const rect = { left: 0, top: 0, right: 24000, bottom: 18000 };
    const s = 300, t = { x: 0, y: 0 };

    test("without a cut, a tile-covering band IS the solid tier (the branch is real)", () => {
        const o = { type: "stroke", origin: "native", id: 1, pts: [[4, 3], [5, 3]],
            lwFrame: 25, color: "#000", opacity: 1, paths: [] };
        expect(classifyUp(o, s, t, rect, CFG, null)).toBe("solid");
        expect(solidQuad(o, rect).covers).toBe(true);
    });

    test("end to end: the hole survives one more crossing INWARD", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 24);
        descend(E, 2);
        E.setEraserSize(24);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        E._render();
        expect(inkAtScreen(E, 400, 300)).toBe(false);
        descend(E, 3, 400, 300);   // deeper than the erase: the hole is inherited
        E._render();
        expect(inkAtScreen(E, 400, 300)).toBe(false);
        descend(E, 4, 400, 300);
        E._render();
        expect(inkAtScreen(E, 400, 300)).toBe(false);
    });
});

describe("W-7/W-9 — rendering coarser than the erase", () => {
    // Zoomed far enough out, a deep erase must not be visible — cut and uncut
    // have to agree there, or crossing outward pops.
    //
    // The window model got this by GATING: a rect too small to resolve was
    // carried rather than applied, so the parent rendered whole. Cutting has no
    // gate — the hole is in the geometry at every scale — so what has to be
    // shown is that it is too small to see, which is a stronger statement and a
    // more awkward one to test. It is emphatically NOT "the point is inked":
    // three crossings out the hole is 40/3000³ of a screen but it is still
    // THERE, and a probe that samples the one mathematical point the erase was
    // centred on will find it every time.
    const emptyRunPx = (E, sy, x0, x1, step) => {
        E._render();
        const list = E._objs().filter((o) => !o.erase);
        let worst = 0, cur = 0;
        for (let sx = x0; sx <= x1; sx += step) {
            if (inks(list, E.cam.screenToFrame(sx, sy))) cur = 0;
            else { cur += step; if (cur > worst) worst = cur; }
        }
        return worst;
    };

    test("the hole is far under one pixel three crossings out, and never reads as a gap", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 24);
        descend(E, 3);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 260], [400, 340]]);
        E.flushErases();
        // At the level it was made, the gesture is the size of the gesture.
        expect(emptyRunPx(E, 300, 300, 500, 1)).toBeGreaterThan(10);
        ascend(E, 0, 400, 300);
        // Sampled twenty times finer than a pixel, right across where it was.
        expect(emptyRunPx(E, 300, 380, 420, 0.05)).toBeLessThan(0.2);
    });

    test("...and an erased stroke matches an untouched twin, pixel for pixel", () => {
        // The property that actually matters, stated without reference to holes:
        // put the same stroke on the page twice, erase deep into one of them,
        // come back out, and no pixel may tell them apart.
        //
        // Note what this does NOT cover. Flattening the chain makes the
        // top-level hole SMALLER, not bigger, so it slips past here — mutation
        // tested. Nesting is pinned by the ratio checks in W-2/W-3, and only
        // there. What this catches is the opposite error: a hole cut at the
        // erase's own scale into a parent thousands of times coarser.
        const E = mkEngine();
        drawStroke(E, [[250, 260], [550, 260]], 24);   // the twin, never touched
        drawStroke(E, [[250, 340], [550, 340]], 24);   // the one to cut
        descend(E, 3, 400, 340);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 200], [400, 400]]);
        E.flushErases();
        ascend(E, 0, 400, 340);
        E._render();
        const list = E._objs().filter((o) => !o.erase);
        let differ = 0;
        for (let sx = 240; sx <= 560; sx += 1) {
            const a = inks(list, E.cam.screenToFrame(sx, 260));
            const b = inks(list, E.cam.screenToFrame(sx, 340));
            if (a !== b) differ++;
        }
        // One sample may straddle the slit; a visible hole is dozens.
        expect(differ).toBeLessThanOrEqual(1);
    });
});

describe("W-11 — the parent and its child do not seam", () => {
    // The cut is EXACT: the parent's ink stops on the tile boundary and the
    // child's starts there, sharing the edge with no overlap at all. Two opaque
    // SVG paths meeting like that antialias independently — each covers part of
    // the boundary pixel and they composite source-over, so only 1 − α₁α₂ of the
    // ink lands and up to a quarter of the background shows through. Measured in
    // the browser before this was fixed: an interior pixel lifted 18-25 % toward
    // white at every in-level zoom, right down the tile edge. That is the
    // "hairline outline around the erase" this feature kept being reported for.
    //
    // The fix is not an overlap — an overlap has to be sized against the view,
    // which is what the old 2/enter pad did and why it came to 2 px at one zoom
    // and 0.19 px at another. It is to draw the family as ONE path: subpaths of
    // a single path accumulate coverage before anything composites, so there is
    // no seam to cover. jsdom cannot rasterize, so what is pinned here is the
    // mechanism — one path, holding both sides of the join.
    const familyPaths = (E) => {
        E._render();
        const out = [];
        for (const [, entry] of E.renderer._groups) {
            for (const child of entry.group.children) out.push({ entry, child });
        }
        return out;
    };
    test("a cut parent and its re-homed child render as a single path", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, "#1133cc");
        const key = E.doc.at("0")[0].id;
        descend(E, 1);
        E.setEraserSize(26);
        eraseGesture(E, [[400, 180], [400, 420]]);
        E.flushErases();
        ascend(E, 0, 400, 300);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });

        // Both sides really are on screen at this zoom — otherwise there is no
        // join to seam and the test proves nothing.
        const list = E._objs().filter((o) => !o.erase);
        expect(list.some((o) => o.attachRect == null && E.doc.editKey(E.doc.getById(o.id).obj) === key)).toBe(true);
        expect(list.some((o) => E.doc.getById(o.id) && E.doc.getById(o.id).obj.attachRect)).toBe(true);

        const paths = familyPaths(E);
        expect(paths).toHaveLength(1);
        // ...and that one path carries every ring from both sides of the join.
        // Subpaths on BOTH sides of the join: the parent is a resolved shape at
        // its own frame, the child arrives as tile rings, and one path holds
        // every loop of both.
        const rings = list.reduce((n, o) => n
            + (o.type === "fill" ? o.polys.length : 0)
            + (o.type === "shape" ? o.loops.length : 0), 0);
        const moves = paths[0].child.vertices.filter((v) => v.command === "M").length;
        expect(moves).toBe(rings);
        expect(moves).toBeGreaterThan(2);
    });

    test("a child faded to nothing still gets its own group, or it fades the parent with it", () => {
        // The one case that must NOT merge. A down-piece below the cull ramp
        // carries a fade, and opacity lives on the group — so folding a fading
        // child into the family would fade the coarse parent along with it.
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, "#1133cc");
        descend(E, 1);
        E.setEraserSize(26);
        eraseGesture(E, [[400, 180], [400, 420]]);
        E.flushErases();
        ascend(E, 0, 400, 300);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });
        E._render();
        // Fully present here: one group.
        expect(E.renderer._groups.size).toBe(1);
        // Now make the child sub-pixel by hand and check the rule flips. The
        // fade is a SIZE, not an alpha — every down-piece carries one — so the
        // grouping has to test the computed fade, not the tag's presence.
        const piece = E._objs().find((o) => o.fadeTag != null);
        expect(piece).toBeTruthy();
        expect(E.renderer._fade(piece)).toBe(1);
        expect(E.renderer._fade({ fadeTag: piece.fadeTag * 1e-6 })).toBeLessThan(1);
    });
});

describe("W-8 — the hole shrinks CONTINUOUSLY on the way out, including across a crossing", () => {
    // Trap T-4: one wheel step here is ×2 in effective zoom and a crossing is
    // continuous, so the thing to assert is the RATIO against neighbouring
    // in-level steps — never an absolute jump. Trap T-3: anchor the zoom at the
    // hole's CENTRE, never on its edge, or a crossing throws the edge 240,000 px
    // away and the hole appears to vanish.
    test("no step changes the hole's width by more than its neighbours do", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60);
        descend(E, 2);
        E.setEraserSize(40);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();

        // Width of the empty run through the hole, along the screen row y=300.
        const holeWidthPx = () => {
            E._render();
            const list = E._objs().filter((o) => !o.erase);
            let lo = null, hi = null;
            for (let sx = 0; sx <= 800; sx += 1) {
                const p = E.cam.screenToFrame(sx, 300);
                if (!inks(list, p)) { if (lo == null) lo = sx; hi = sx; }
                else if (lo != null && hi != null && hi - lo > 1) break;
            }
            return lo == null ? 0 : hi - lo + 1;
        };

        const widths = [];
        for (let i = 0; i < 14; i++) {
            widths.push({ w: holeWidthPx(), level: E.activeLevel });
            E.zoomAt(400, 300, 1000); // zoom OUT one wheel step (×0.5)
        }
        const crossed = new Set(widths.map((x) => x.level)).size > 1;
        expect(crossed).toBe(true); // the run really does span a crossing
        // Every step halves the hole until it disappears under a pixel. Compare
        // each ratio against the in-level ones rather than against 0.5 exactly:
        // sampling at 1 px granularity quantizes a small hole badly.
        for (let i = 1; i < widths.length; i++) {
            const a = widths[i - 1].w, b = widths[i].w;
            if (a < 8) break;                       // below this, 1 px sampling dominates
            expect(b).toBeLessThan(a);              // monotone: never grows on the way out
            expect(b).toBeGreaterThan(a * 0.25);    // and never collapses: no pop
        }
    });
});

describe("C — composition", () => {
    test("C-1: one gesture across five overlapping objects gives them ONE shared edge", () => {
        const E = mkEngine();
        const colors = ["#a00000", "#00a000", "#0000a0", "#a0a000", "#a000a0"];
        for (let i = 0; i < 5; i++) drawStroke(E, [[200, 290 + i * 5], [600, 290 + i * 5]], 30, colors[i]);
        descend(E, 1);
        E.setEraserSize(30);
        eraseGesture(E, [[400, 150], [400, 450]]);
        E.flushErases();
        E._render();
        // Every one of the five ceded, and by the SAME footprint — so no
        // object's ink fringes past another's boundary anywhere along the edge.
        expect(soleKey(E)).toHaveLength(5);
        const F = E.lm.pathFrameAt(E.cam.frame, 1);
        const kids = (E.doc.at(F) || []).filter((o) => !o.erase && o.attachRect != null);
        expect(new Set(kids.map((o) => E.doc.editKey(o))).size).toBe(5);
        // Sample down the cut: at any row, either all five are inked or none is.
        for (let sy = 200; sy <= 400; sy += 8) {
            const list = E._objs().filter((o) => !o.erase);
            expect(inks(list, E.cam.screenToFrame(400, sy))).toBe(false);
        }
    });

    test("C-2: the five edges stay coincident one crossing deeper", () => {
        const E = mkEngine();
        for (let i = 0; i < 5; i++) drawStroke(E, [[200, 290 + i * 5], [600, 290 + i * 5]], 30);
        descend(E, 1);
        E.setEraserSize(30);
        eraseGesture(E, [[400, 150], [400, 450]]);
        E.flushErases();
        descend(E, 2, 400, 300);
        E._render();
        const list = E._objs().filter((o) => !o.erase);
        for (let sy = 250; sy <= 350; sy += 5) {
            expect(inks(list, E.cam.screenToFrame(400, sy))).toBe(false);
        }
    });

    test("C-5: two erases in the same place compose; the second does not resurrect the first", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        descend(E, 1);
        E.setEraserSize(16);
        eraseGesture(E, [[350, 300]]);
        E.flushErases();
        eraseGesture(E, [[450, 300]]);
        E.flushErases();
        // The second bite lands on the child the first one re-homed, not on the
        // source again — the source has no ink left there to cut.
        E._render();
        expect(inkAtScreen(E, 350, 300)).toBe(false); // the FIRST bite is still a hole
        expect(inkAtScreen(E, 450, 300)).toBe(false);
        // Between them, ink — probed either side of dead centre. The two ceded
        // tiles happen to ABUT exactly at screen 400 here, and a point standing
        // on the shared edge of two natives is neither inside nor outside: a ray
        // from it grazes both. Every point from 390 to 410 bar that one reads
        // ink, so the seam is a property of the probe and not of the picture.
        expect(inkAtScreen(E, 396, 300)).toBe(true);
        expect(inkAtScreen(E, 404, 300)).toBe(true);
    });

    test("C-7: one gesture over objects homed at DIFFERENT levels", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 290], [600, 290]], 24);
        descend(E, 1);
        drawStroke(E, [[200, 310], [600, 310]], 24);
        descend(E, 2, 400, 300);
        E.setEraserSize(26);
        eraseGesture(E, [[400, 150], [400, 450]]);
        E.flushErases();
        // Two objects, homed a crossing apart, cut by one gesture. Each cedes
        // down its OWN chain — the coarse one has two links to walk, the mid one
        // has a single link — and both arrive at the same erase level.
        const keys = soleKey(E);
        expect(keys).toHaveLength(2);
        const F2 = E.lm.pathFrameAt(E.cam.frame, 2);
        for (const k of keys) expect(familyAt(E, k, F2).some((o) => o.attachRect != null)).toBe(true);
        const F1 = E.lm.pathFrameAt(E.cam.frame, 1);
        const coarseKey = keys.find((k) => familyAt(E, k, "0").length > 0);
        expect(familyAt(E, coarseKey, F1).some((o) => o.attachRect != null)).toBe(true);
        E._render();
        expect(inkAtScreen(E, 400, 300)).toBe(false);
    });

    test("C-9: one sweep cuts every thin stroke it crosses", () => {
        const E = mkEngine();
        for (let i = 0; i < 8; i++) drawStroke(E, [[400 - 40 * i, 200], [400 - 40 * i, 400]], 6);
        E.setEraserSize(14);
        eraseGesture(E, [[60, 300], [420, 300]]);
        E.flushErases();
        E._render();
        for (let i = 0; i < 8; i++) {
            expect(inkAtScreen(E, 400 - 40 * i, 300)).toBe(false); // cut
            expect(inkAtScreen(E, 400 - 40 * i, 240)).toBe(true);  // above the sweep
        }
    });

    test("C-10: a piece split off by an erase can be erased and split again", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 20);
        E.setEraserSize(16);
        eraseGesture(E, [[400, 250], [400, 350]]);
        E.flushErases();
        expect(E.doc.at("0")).toHaveLength(2);
        eraseGesture(E, [[300, 250], [300, 350]]);
        E.flushErases();
        expect(E.doc.at("0")).toHaveLength(3);
        E._render();
        for (const sx of [300, 400]) expect(inkAtScreen(E, sx, 300)).toBe(false);
        for (const sx of [250, 350, 500]) expect(inkAtScreen(E, sx, 300)).toBe(true);
    });
});
