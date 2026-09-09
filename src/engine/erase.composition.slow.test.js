/**
 * CP — COMPOSITION: the interactions that only exist because these features
 * share one document.
 *
 * Everything else in the suite exercises the erase machinery against ink. This
 * one exercises it against the REST OF THE APP — a second gesture arriving
 * before the first has baked, a window resize that moves the tile lattice under
 * a ceded rect, the whole-object eraser meeting a family that lives in five
 * frames, a jump that lands inside a hole, drawing on top of a pending bake.
 *
 * These are the cases nobody writes down, because each one belongs to two
 * features and therefore to neither.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, descend, camShot, camRestore, topView,
    inkAt, colorAt, raster, rasterDiff, inkRunsX, families, natives, picture,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const DEPTHS = [[0], [1], [2], [3]];
const band = (E, w = 90, y = 300, c = BLUE) => drawStroke(E, [[-200, y], [1000, y]], w, c);

describe("CP-1 — two eraser gestures in flight at once", () => {
    // Layers: performance (1, deferred bake) + erasing over multiple objects
    // (10) + already-cut shapes (5) + undo (18).
    //
    // Baking is deferred, so a fast user can finish a second gesture before the
    // first has touched anything. The two are separate undo ops over the same
    // ink, and the second one's target list is computed against a document the
    // first is still rewriting.
    test.each(DEPTHS)("depth %i: both holes appear, and in the right places", (d) => {
        const E = mkEngine();
        band(E, 120);
        descend(E, d, 400, 300);
        eraseGesture(E, [[320, 250], [320, 350]], 14);
        eraseGesture(E, [[480, 250], [480, 350]], 14);   // before any bake
        expect(E.doc.at(E.cam.frame).filter((o) => o.erase).length).toBe(2);
        E.flushErases();
        expect(inkAt(E, 320, 300)).toBe(false);
        expect(inkAt(E, 480, 300)).toBe(false);
        expect(inkAt(E, 400, 300)).toBe(true);
        for (const k of E.doc.levels()) for (const o of E.doc.at(k)) expect(o.erase).toBeFalsy();
    });
    test("undo takes back the second gesture only", () => {
        const E = mkEngine();
        band(E, 120);
        eraseGesture(E, [[320, 250], [320, 350]], 14);
        eraseGesture(E, [[480, 250], [480, 350]], 14);
        E.flushErases();
        E.undo(); E.flushErases();
        expect(inkAt(E, 320, 300)).toBe(false);          // the first is still cut
        expect(inkAt(E, 480, 300)).toBe(true);           // the second is back
        E.undo(); E.flushErases();
        expect(inkAt(E, 320, 300)).toBe(true);
    });
    test("overlapping gestures leave exactly the ink neither of them covered", () => {
        // Two parallel gestures 40 apart, each radius 20, through a band 120
        // tall. Where their capsules overlap the band is gone; but at the band's
        // top and bottom EDGES the two round caps have narrowed to +/-17.3, so a
        // 5.4 x 10 unit crumb survives between them. That crumb is correct — no
        // eraser covered it — and it is its own object, because it is not
        // touching anything. Measured, not assumed: the first version of this
        // test asserted "2 families" on a guess and was wrong.
        const E = mkEngine();
        band(E, 120);
        eraseGesture(E, [[380, 250], [380, 350]], 20);
        eraseGesture(E, [[420, 250], [420, 350]], 20);
        E.flushErases();
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkRunsX(E, 300)).toHaveLength(2);        // one hole across the middle
        expect(inkAt(E, 400, 245)).toBe(true);           // ...and the crumb is there
        // Nothing survives INSIDE either capsule, anywhere.
        const caps = [[380, 20], [420, 20]];
        for (let sx = 340; sx <= 460; sx += 2) {
            for (let sy = 230; sy <= 370; sy += 2) {
                const inside = caps.some(([cx, r]) => {
                    const dy = sy < 250 ? sy - 250 : sy > 350 ? sy - 350 : 0;
                    return Math.hypot(sx - cx, dy) < r - 1;
                });
                if (inside) expect([sx, sy, inkAt(E, sx, sy)]).toEqual([sx, sy, false]);
            }
        }
    });
});

describe("CP-2 — drawing while a bake is pending", () => {
    // Layers: performance (1) + z-order (behaviour 5) + erasing over multiple
    // objects (10).
    //
    // The new stroke is above the eraser mark in z, so it must survive the bake
    // untouched — the mark only ever removes what was under it when it landed.
    test.each(DEPTHS)("depth %i: ink drawn after the mark is not eaten", (d) => {
        const E = mkEngine();
        band(E, 120);
        descend(E, d, 400, 300);
        eraseGesture(E, [[400, 240], [400, 360]], 24);
        const fresh = drawStroke(E, [[300, 300], [500, 300]], 20, RED);
        E.flushErases();
        // Still ONE object under its original id — a stroke that had been cut
        // would have been replaced by pieces with fresh ids. (It has resolved
        // into its perimeter by now, which is what every stroke does.)
        expect(E.doc.getById(fresh.id)).toBeTruthy();
        expect(E.doc.getById(fresh.id).obj.type).toBe("shape");
        expect(colorAt(E, 400, 300)).toBe(RED);          // it crosses the hole, intact
    });
    test("and an erase made afterwards DOES eat it", () => {
        const E = mkEngine();
        band(E, 120);
        eraseGesture(E, [[400, 240], [400, 360]], 24);
        const fresh = drawStroke(E, [[300, 300], [500, 300]], 20, RED);
        E.flushErases();
        erase(E, [[400, 240], [400, 360]], 24);
        expect(colorAt(E, 400, 300)).toBe(null);
        expect(E.doc.getById(fresh.id)).toBeFalsy();     // that stroke is now pieces
    });
});

describe("CP-3 — the whole-object eraser meets a family spread over five frames", () => {
    // Layers: multi-layer erase (3) + multi-layer selection (2) + free-floating
    // pieces (12) + undo (18).
    //
    // `eraseAt` removes "the object under the point". When that object is a
    // chain of re-homed patches, removing the one you hit and leaving the rest
    // is not an answer the user would recognise.
    test.each([[1], [2], [3]])("depth %i: it takes the whole family", (d) => {
        const E = mkEngine();
        band(E, 90);
        const home = camShot(E);
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        expect(natives(E).length).toBeGreaterThan(1);
        camRestore(E, home);
        E.setTool("erase");
        E.pointerDown(200, 300); E.pointerUp();
        expect(natives(E)).toEqual([]);
    });
    test("...and undo brings all of it back", () => {
        const E = mkEngine();
        band(E, 90);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const deep = camShot(E);
        const before = raster(E, 48);
        const n = natives(E).length;
        camRestore(E, home);
        E.setTool("erase");
        E.pointerDown(200, 300); E.pointerUp();
        E.undo(); E.flushErases();
        expect(natives(E).length).toBe(n);
        camRestore(E, deep);
        expect(rasterDiff(before, raster(E, 48)).total).toBeLessThanOrEqual(2);
    });
});

describe("CP-4 — resizing the canvas under an erased drawing", () => {
    // Layers: tile boundaries (7) + multiple tiles (13) + zoom consistency (17)
    // + already-cut shapes (5).
    //
    // The tile lattice is derived from the canvas size (`makeGrid`: k × width /
    // base), so a resize moves every tile boundary — including the ones a ceded
    // window was cut to. If a window were stored in tile indices rather than in
    // frame coordinates, this is where holes would jump.
    test.each([[0], [1], [2]])("depth %i: the ink and the hole stay put", (d) => {
        const E = mkEngine(800, 600);
        band(E, 120);
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const cam = camShot(E);
        const before = raster(E, 40, { x0: 0, y0: 0, x1: 600, y1: 400 });
        E.resize(1100, 820);
        E.cam.set(cam); E._render();
        // Compare the region that is on screen in BOTH sizes.
        expect(rasterDiff(before, raster(E, 40, { x0: 0, y0: 0, x1: 600, y1: 400 })).total)
            .toBeLessThanOrEqual(2);
    });
    test("and a fresh erase after the resize still lands where it is drawn", () => {
        const E = mkEngine(800, 600);
        band(E, 120);
        descend(E, 2, 400, 300);
        erase(E, [[300, 250], [300, 350]], 18);
        E.resize(1100, 820);
        E._render();
        erase(E, [[500, 250], [500, 350]], 18);
        expect(inkAt(E, 500, 300)).toBe(false);
        expect(inkAt(E, 300, 300)).toBe(false);
        expect(inkAt(E, 400, 300)).toBe(true);
    });
});

describe("CP-5 — very fat and very thin strokes", () => {
    // Layers: big strokes (4) + multi-layer erase (3) + small detail beside a
    // large one (9) + already-cut shapes (5).
    //
    // `fatWidthPx` (4000) gates whether a stroke is displayed as a curve
    // outline or stroked raw, and the erase uses the SAME builder (requirement
    // 6). A stroke either side of that gate takes a different path to the same
    // boolean, so both sides need pinning — as does a stroke thin enough that
    // the seam pad is wider than the ink.
    const WIDTHS = [[0.5], [3], [13], [120], [900]];
    test.each(WIDTHS)("width %p: the cut lands on the ink", (w) => {
        const E = mkEngine();
        drawStroke(E, [[-200, 300], [1000, 300]], w, BLUE);
        expect(inkAt(E, 200, 300)).toBe(true);
        // Scale the gesture to the stroke, but keep the eraser well inside the
        // canvas: at width 900 a radius of w/2 would clamp to 200 and reach
        // x = 200 and x = 600, which is where the "ink survives" probes are.
        const r = Math.min(60, Math.max(4, w / 2));
        const reach = Math.min(w, 200);
        erase(E, [[400, 300 - reach], [400, 300 + reach]], r);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 100, 300)).toBe(true);
        expect(inkAt(E, 700, 300)).toBe(true);
    });
    test.each(WIDTHS)("width %p: ...and one crossing down too", (w) => {
        const E = mkEngine();
        drawStroke(E, [[-200, 300], [1000, 300]], w, BLUE);
        descend(E, 1, 400, 300);
        expect(inkAt(E, 200, 300)).toBe(true);
        erase(E, [[400, 250], [400, 350]], 18);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 200, 300)).toBe(true);
    });
    test("a hair-thin stroke is not swallowed by the seam pad", () => {
        // The pad is 1.5 px / exit = 30 frame units at level 0. A 0.5-unit
        // stroke is sixty times thinner than that, so anything that pads the
        // stroke rather than the tile eats it entirely.
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 0.5, BLUE);
        erase(E, [[400, 290], [400, 310]], 6);
        expect(inkAt(E, 200, 300)).toBe(true);
        expect(inkAt(E, 600, 300)).toBe(true);
        expect(families(E)).toBe(2);
    });
});

describe("CP-6 — a dot", () => {
    // Layers: free-floating details (12) + multi-layer erase (3) + topology (14).
    //
    // A single-point stroke is a circle with no direction. Half the outline
    // machinery has a "pts.length > 2" branch and the other half a "pts.length
    // > 1"; a dot falls through both.
    test.each(DEPTHS)("depth %i: erasing part of a dot leaves a crescent", (d) => {
        const E = mkEngine();
        drawStroke(E, [[400, 300]], 160, BLUE);
        expect(inkAt(E, 400, 300)).toBe(true);
        descend(E, d, 400, 300);
        erase(E, [[400, 220], [400, 300]], 30);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(families(E)).toBe(1);
    });
    test("a dot erased away entirely leaves nothing behind", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 300]], 60, BLUE);
        drawStroke(E, [[200, 300]], 60, RED);
        erase(E, [[400, 300]], 120);
        expect(natives(E).length).toBe(1);
        expect(natives(E)[0].obj.color).toBe(RED);
    });
});

describe("CP-7 — erasing exactly on an endpoint cap", () => {
    // Layers: already-cut shapes (5) + multi-layer erase (3) + tile boundaries
    // (7).
    //
    // The cap is where the curve outline closes on itself; a boolean that meets
    // it exactly is the degenerate case for orientation and for the
    // "grazing, change nothing" guard.
    test.each(DEPTHS)("depth %i: the cap is trimmed, not the whole stroke", (d) => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, d, 600, 300);
        erase(E, [[400, 300]], d ? 40 : 30);
        camRestore(E, home);
        expect(inkAt(E, 300, 300)).toBe(true);            // the body survives
        expect(families(E)).toBe(1);
    });
});

describe("CP-8 — two objects that share an edge, erased by one gesture", () => {
    // Layers: erasing over multiple objects (10) + multi-layer erase (3) +
    // z-order (behaviour 5) + already-cut shapes (5).
    //
    // Kobin's question about edges matching: two objects of different sizes,
    // with different anchor points, cut by the SAME gesture. Their cut edges are
    // computed independently, in their own units, so exact agreement is not
    // promised — pixel-level agreement is (the explicit decision, 2026-08-05).
    // What is promised absolutely is that neither is left with ink INSIDE the
    // mark, which is what a user would actually see.
    test.each(DEPTHS)("depth %i: neither object keeps ink inside the mark", (d) => {
        const E = mkEngine();
        drawStroke(E, [[-200, 260], [1000, 260]], 80, BLUE);
        drawStroke(E, [[-500, 340], [2000, 340]], 80, RED);   // different size and anchor
        descend(E, d, 400, 300);
        erase(E, [[400, 180], [400, 420]], 20);
        for (const sy of [260, 300, 340]) expect(inkAt(E, 400, sy)).toBe(false);
        expect(inkAt(E, 340, 260)).toBe(true);
        expect(inkAt(E, 340, 340)).toBe(true);
    });
    test("their cut edges agree to within a pixel", () => {
        const E = mkEngine();
        drawStroke(E, [[-200, 260], [1000, 260]], 80, BLUE);
        drawStroke(E, [[-500, 340], [2000, 340]], 80, RED);
        descend(E, 2, 400, 300);
        erase(E, [[400, 180], [400, 420]], 20);
        // Walk left from the gesture on each band and find where ink resumes.
        const edge = (sy) => {
            for (let sx = 400; sx > 100; sx--) if (inkAt(E, sx, sy)) return sx;
            return null;
        };
        const a = edge(260), b = edge(340);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    });
});

describe("CP-9 — jumping into a hole", () => {
    // Layers: scenes (19) + zoom consistency (17) + multi-layer erase (3).
    //
    // A saved view can easily be aimed at ground a later erase removed. Landing
    // there must show empty paper, not a stale tile of the ink that used to be.
    test("a view captured over ink, then erased away, arrives empty", () => {
        const E = mkEngine();
        band(E, 200);
        descend(E, 2, 400, 300);
        E.captureView("spot");
        const sc = (E.docMeta.scenes || []).find((s) => s.name === "spot");
        expect(sc).toBeTruthy();
        // Erase it away at ITS OWN level — at depth 2 the band is 9e6 times the
        // screen and no gesture can swallow it (topology TP-2).
        topView(E);
        erase(E, [[-400, 300], [1200, 300]], 200);
        expect(natives(E)).toEqual([]);
        E.jumpTo(sc.level, sc.rect);
        expect(raster(E, 40).indexOf("#")).toBe(-1);
    });
});

describe("CP-10 — clear, and undoing it", () => {
    // Layers: undo (18) + multi-layer erase (3) + scenes (19).
    test("clear removes an erased family whole, and undo restores it whole", () => {
        const E = mkEngine();
        band(E, 90);
        descend(E, 3, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const deep = camShot(E);
        const before = picture(E);
        const n = natives(E).length;
        expect(n).toBeGreaterThan(1);
        E.clear();
        expect(natives(E)).toEqual([]);
        E.undo(); E.flushErases();
        camRestore(E, deep);
        expect(natives(E).length).toBe(n);
        expect(picture(E)).toBe(before);
    });
});

describe("CP-11 — an erase whose target is deleted before the bake reaches it", () => {
    // Layers: performance (1, deferred bake) + undo (18) + erasing over multiple
    // objects (10).
    //
    // The bake walks a target list computed lazily. Anything can happen to the
    // document between slices — including the target being deleted outright.
    test("the bake skips it and finishes the rest", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 260], [700, 260]], 60, BLUE);
        drawStroke(E, [[100, 340], [700, 340]], 60, RED);
        eraseGesture(E, [[400, 200], [400, 400]], 24);
        E.doc.removeById(a.id);                            // pull one out from under it
        E.flushErases();
        expect(inkAt(E, 400, 340)).toBe(false);            // the other one still got cut
        expect(inkAt(E, 200, 340)).toBe(true);
        for (const k of E.doc.levels()) for (const o of E.doc.at(k)) expect(o.erase).toBeFalsy();
    });
});

describe("CP-12 — an erase across a scene boundary", () => {
    // Layers: scenes (19) + erasing over multiple objects (10) + long eraser
    // paths (11) + moving between neighbourhoods (15).
    test("one gesture over two compositions cuts both and merges neither", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [340, 300]], 60, BLUE);
        drawStroke(E, [[460, 300], [700, 300]], 60, RED);
        E.refreshScenes();
        const before = (E.docMeta.scenes || []).length;
        erase(E, [[200, 260], [600, 260]], 24);            // a long gesture over both
        expect(families(E)).toBe(2);                       // neither was severed
        for (const c of [BLUE, RED]) {
            expect(natives(E).some((r) => r.obj.color === c)).toBe(true);
        }
        E.refreshScenes();
        expect((E.docMeta.scenes || []).length).toBe(before);
    });
});
