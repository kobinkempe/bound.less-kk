/**
 * LX — LAYERED erase scenarios.
 *
 * Every other erase suite isolates one thing. This one deliberately does not:
 * each case stacks three to six of the hard axes at once, because that is where
 * the design's tradeoffs actually collide. A cut that is exact on a clean stroke
 * may quantize on a stroke that was already cut; a hole that is faithful in the
 * middle of a tile may not be one straddling a tile seam; ink that survives a
 * level crossing may not survive one after it has been re-homed four times.
 *
 * The recurring question behind all of it is the one the whole tile/window
 * design has to answer: LOOKING AT ONE WINDOW, COULD THE USER TELL WE DID NOT
 * SAVE THIS GLOBALLY? Anywhere the answer would be yes, there is a test here.
 *
 * Slow on purpose — several of these zoom through five crossings, which is a
 * ~2.4e17x magnification, and there is no shortcut to that.
 */
import { markOf, compareMark } from "./__testkit__/fidelity";
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, drag, click, pan,
    descend, ascend, roundTrip, camShot, camRestore, topView, painted, inkAt, topAt,
    raster, rasterZ, rasterDiff, inkRunsX, families, natives, vertexCount,
    picture, tileSeam, centerOn, timeIt, objPointIn,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

// Run one scenario twice — without the erase and with it — and measure how far
// the baked hole strays from the mark the user actually saw. Screen pixels.
function fidelity(build, doErase, opts = {}) {
    const w = opts.w || 800, h = opts.h || 600;
    const A = mkEngine(w, h); build(A); A._render();
    const before = A._objs().slice();
    const B = mkEngine(w, h); build(B);
    const eraser = doErase(B);
    expect(eraser).toBeTruthy();
    const mark = markOf(B, eraser);
    const inScale = B.cam.inScale;
    B.flushErases(); B._render();
    const after = B._objs().filter((o) => !o.erase);
    return compareMark(before, after, mark, inScale, { slackPx: 0.5, n: opts.n || 110 });
}
const gestureReturning = (E, pts, size) => {
    eraseGesture(E, pts, size);
    return E.doc.at(E.cam.frame).find((o) => o.erase);
};

describe("LX-1 — an already-cut shape, cut again at depth, across a tile seam", () => {
    // Layers: multi-layer erase (3) + already-cut shape (5) + tile boundary (7)
    // + multiple tiles cutting one object (13).
    //
    // The first cut turns a stroke into fills. The second is made three
    // crossings down, so it re-homes, and it is aimed at a real tile seam of the
    // frame it is made in — the one place where "we store this in tiles" could
    // leak into the picture.
    test.each([[1], [2], [3]])("second cut %i crossing(s) down lands where it was drawn", (n) => {
        const r = fidelity(
            (E) => {
                drawStroke(E, [[120, 300], [680, 300]], 70);
                erase(E, [[300, 200], [300, 400]], 18);      // cut #1, at its own level
                descend(E, n);
                const s = tileSeam(E);
                if (s.x > 60 && s.x < 740) centerOn(E, s.fx, s.fy, 400, 300);
            },
            (E) => gestureReturning(E, [[380, 260], [420, 340]], 16),
        );
        expect(r.inkBefore).toBeGreaterThan(150);
        expect(r.removed).toBeGreaterThan(15);
        expect(r.overPx).toBeLessThanOrEqual(1);
        expect(r.underPx).toBeLessThanOrEqual(1);
    });

    test("cut #1's hole is untouched by cut #2 three crossings below it", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 70);
        erase(E, [[300, 200], [300, 400]], 18);
        const box = { x0: 240, y0: 240, x1: 360, y1: 360 };   // around cut #1
        const home = camShot(E);
        const holeBefore = raster(E, 40, box);
        descend(E, 3);
        erase(E, [[380, 260], [420, 340]], 16);
        camRestore(E, home);
        expect(rasterDiff(holeBefore, raster(E, 40, box)).total).toBeLessThanOrEqual(2);
    });
});

describe("LX-2 — one gesture over objects that live at three different depths", () => {
    // Layers: multi-layer erase (3) + small detail beside a large one (9) +
    // erasing over multiple objects (10) + long eraser path (11).
    //
    // Three strokes homed at L0, L2 and L4, all visible together at L4 because
    // the deep ones are drawn where the shallow one is magnified. One gesture
    // crosses all three. Each must lose ink under the mark and nowhere else —
    // and the L0 stroke's cut has to re-home four crossings while the L4
    // stroke's is an ordinary in-place boolean, in the SAME gesture.
    const build = (E) => {
        drawStroke(E, [[100, 240], [700, 240]], 40);         // L0, coarse
        descend(E, 2); drawStroke(E, [[100, 300], [700, 300]], 30);
        descend(E, 4); drawStroke(E, [[100, 360], [700, 360]], 20);
        ascend(E, 4);
    };
    test("all three lose ink, and only where the mark went", () => {
        const r = fidelity(build, (E) => gestureReturning(E, [[400, 180], [400, 420]], 14));
        expect(r.inkBefore).toBeGreaterThan(200);
        expect(r.removed).toBeGreaterThan(40);
        expect(r.overPx).toBeLessThanOrEqual(1);
        expect(r.underPx).toBeLessThanOrEqual(1);
    });
    test("each of the three is actually reached, not just the nearest one", () => {
        const E = mkEngine();
        build(E);
        const rowsBefore = [240, 300, 360].map((y) => inkRunsX(E, y).length);
        expect(rowsBefore).toEqual([1, 1, 1]);
        erase(E, [[400, 180], [400, 420]], 14);
        const rowsAfter = [240, 300, 360].map((y) => inkRunsX(E, y).length);
        expect(rowsAfter).toEqual([2, 2, 2]);   // every row is now two lumps
    });
    test("the white eraser stroke is gone once the gesture has been paid for", () => {
        const E = mkEngine();
        build(E);
        erase(E, [[400, 180], [400, 420]], 14);
        for (const k of E.doc.levels()) for (const o of E.doc.at(k)) expect(o.erase).toBeFalsy();
    });
});

describe("LX-3 — the hole is really empty, and stays empty when it is moved", () => {
    // Layers: already-cut shape (5) + moving a hole over something else (8) +
    // erasing over multiple objects (10). Behaviour 5 (z-order).
    //
    // An eraser mark is background-coloured INK until it bakes. If a bake ever
    // left the mark behind instead of a hole, everything above still looks
    // right — until the holed object is dragged over something, and the thing
    // underneath is painted out by a white rectangle that follows it around.
    test("what is under the hole shows through, before and after a drag", () => {
        const E = mkEngine();
        const under = drawStroke(E, [[150, 300], [650, 300]], 90, "#2244ff");
        drawStroke(E, [[150, 140], [650, 140]], 90, "#111111");   // on top, drawn later
        erase(E, [[400, 100], [400, 180]], 26);
        expect(inkAt(E, 400, 140)).toBe(false);                   // the hole is real
        drag(E, [250, 140], [250, 300]);                          // slide it down over `under`
        const t = topAt(E, 400, 300);
        expect(t).toBeTruthy();
        expect(t.color).toBe("#2244ff");                          // the blue one, seen through
        expect(E.doc.getById(under.id)).toBeTruthy();             // and undamaged
    });
    test("the moved hole did not take a bite out of what it passed over", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 90, "#2244ff");
        const before = raster(E, 40, { x0: 150, y0: 250, x1: 650, y1: 350 });
        drawStroke(E, [[150, 140], [650, 140]], 90, "#111111");
        erase(E, [[400, 100], [400, 180]], 26);
        drag(E, [250, 140], [250, 300]);
        drag(E, [250, 300], [250, 480]);                          // and away again
        expect(raster(E, 40, { x0: 150, y0: 250, x1: 650, y1: 350 })).toBe(before);
    });
});

describe("LX-4 — a big stroke with many vertices, erased at depth", () => {
    // Layers: big stroke, many vertices (4) + multi-layer erase (3) +
    // performance (1) + multiple tiles (13).
    //
    // Vertex count is the thing to watch. A cut that re-tessellates the whole
    // stroke at tile resolution rather than clipping it produces geometry that
    // is correct and unusable: the reverted attempt reached 79,954 rings and
    // 340,129 vertices in ONE piece, which is past V8's argument limit for
    // Two.js's Collection push and crashes the renderer outright.
    const wiggle = (n) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            pts.push([120 + t * 560, 300 + 110 * Math.sin(t * 14) * Math.cos(t * 3)]);
        }
        return pts;
    };
    test.each([[1], [3]])("%i crossing(s) down: the cut stays bounded", (n) => {
        const E = mkEngine();
        drawStroke(E, wiggle(400), 26);
        const vBefore = vertexCount(E);
        descend(E, n);
        const before = vertexCount(E);
        erase(E, [[400, 180], [400, 420]], 16);
        const after = vertexCount(E);
        expect(vBefore).toBeGreaterThan(300);          // the probe drew a real stroke
        // A cut adds an outline where a stroke used to be a centerline, so some
        // growth is expected. An order of magnitude is not.
        //
        // The bound was max(4000, before × 12) until the freeze became one
        // radius (2026-09-06, freeze.js rule 2). The chop cuts arcs at every
        // grid line and never cuts lines, and the old per-piece test froze a
        // stroke's flat fragments into lines at the first crossing while the
        // radius rule keeps them arcs until their radius reaches ~8.8e12, a
        // level or two later — so a big stroke cut one crossing down paints
        // 6,687 pieces here where it painted under 4,000. That is the cost of
        // the rule Kobin asked for, recorded in OPEN-FLAGS F44; the runaway
        // this test exists to catch is the 340,129-vertex piece above, and
        // the cap below still stands at a fifth of it.
        expect(after).toBeLessThan(Math.max(9000, before * 30));
        expect(after).toBeLessThan(60000);
    });
    test("and rendering it stays interactive", () => {
        const E = mkEngine();
        drawStroke(E, wiggle(400), 26);
        descend(E, 2);
        erase(E, [[400, 180], [400, 420]], 16);
        E._render();
        const warm = timeIt(() => { E.panBy(3, 0); E._render(); }, 12);
        expect(warm).toBeLessThan(200);
    });
});

describe("LX-5 — a long eraser path across many tiles", () => {
    // Layers: long eraser path (11) + multiple tiles cutting one object (13) +
    // multi-layer erase (3) + erasing over multiple objects (10).
    //
    // A gesture right across the screen at depth crosses tile seams. If the cut
    // were assembled tile by tile, the seams are where it would come apart —
    // either a sliver of ink left standing in the hole, or a hairline of
    // missing ink beside it.
    test("the hole is continuous — no ink survives inside the swept path", () => {
        const E = mkEngine();
        for (let i = 0; i < 5; i++) drawStroke(E, [[60, 120 + i * 90], [740, 120 + i * 90]], 50);
        descend(E, 2);
        erase(E, [[40, 60], [760, 540]], 22);
        E._render();
        const list = painted(E);
        let inside = 0;
        for (let i = 0; i <= 200; i++) {
            const t = i / 200;
            const sx = 40 + t * 720, sy = 60 + t * 480;
            if (inkAt(E, sx, sy)) inside++;
        }
        expect(list.length).toBeGreaterThan(0);
        expect(inside).toBe(0);
    });
    test("...and the ink beside the path is untouched", () => {
        const E = mkEngine();
        for (let i = 0; i < 5; i++) drawStroke(E, [[60, 120 + i * 90], [740, 120 + i * 90]], 50);
        descend(E, 2);
        const before = raster(E, 56, { x0: 560, y0: 60, x1: 780, y1: 260 }); // clear of the diagonal
        erase(E, [[40, 60], [760, 540]], 22);
        expect(rasterDiff(before, raster(E, 56, { x0: 560, y0: 60, x1: 780, y1: 260 })).total).toBe(0);
    });
});

describe("LX-6 — zoom away, come back, and nothing has moved", () => {
    // Layers: zoom out/in consistency (17) + multi-layer erase (3) + already-cut
    // shapes (5) + tile boundaries (7). Behaviour 4.
    //
    // Every crossing rebuilds the picture from a different set of tiles. A piece
    // that vanishes, grows, shrinks or changes stacking order at a crossing is
    // the single most visible failure this design can have.
    test.each([[1], [2], [3], [4]])("erased at depth %i, out to 0 and back", (n) => {
        const E = mkEngine();
        drawStroke(E, [[100, 260], [700, 260]], 44);
        drawStroke(E, [[100, 340], [700, 340]], 44, "#cc3311");
        descend(E, n);
        erase(E, [[400, 200], [400, 400]], 18);
        const before = raster(E, 56);
        const zBefore = rasterZ(E, 36);
        roundTrip(E, 0);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
        expect(rasterZ(E, 36)).toBe(zBefore);
    });
    test("and every tile evicted and rebuilt gives the same picture again", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 260], [700, 260]], 44);
        descend(E, 3);
        erase(E, [[400, 200], [400, 400]], 18);
        const before = picture(E);
        E.store.bumpEpoch();
        expect(E.store.size()).toBe(0);
        expect(picture(E)).toBe(before);
    });
});

describe("LX-7 — two erases in the same tile, made at different depths", () => {
    // Layers: multi-layer erase (3) + already-cut shape (5) + multiple tiles
    // (13) + zoom consistency (17).
    //
    // This is the shape of the C-5 bug: the descent re-homed ground the object
    // had ALREADY ceded, and the fresh copy of its ink refilled the first hole.
    // Making the two erases at DIFFERENT depths is the harder version — the
    // second one's descent passes straight through the level the first one
    // stopped at.
    test("the first hole survives the second erase", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60);
        descend(E, 2);
        erase(E, [[330, 240], [330, 360]], 14);
        expect(inkAt(E, 330, 300)).toBe(false);
        const home = camShot(E);
        descend(E, 4);
        erase(E, [[430, 240], [430, 360]], 14);
        camRestore(E, home);
        expect(inkAt(E, 330, 300)).toBe(false);   // hole one, still a hole
    });
    test("both holes are still two holes after a trip out and back", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60);
        descend(E, 2);
        erase(E, [[330, 240], [330, 360]], 14);
        erase(E, [[470, 240], [470, 360]], 14);
        const home = camShot(E);
        expect(inkRunsX(E, 300).length).toBe(3);   // ink, hole, ink, hole, ink
        topView(E);                                // all the way out: sub-pixel, gone
        descend(E, 1); ascend(E, 0); descend(E, 3);
        camRestore(E, home);
        expect(inkRunsX(E, 300).length).toBe(3);   // ...and back, unchanged
    });
});

describe("LX-8 — erasing right on a tile seam", () => {
    // Layers: tile boundary (7) + multiple tiles (13) + z-order (behaviour 5) +
    // zoom consistency (17).
    //
    // The user's own question: if you erase on the edge of a tile window, when
    // the eraser bakes does it look exactly as it did when it was drawn — and
    // does it still, once you zoom?
    const seamScene = (E, n) => {
        drawStroke(E, [[60, 300], [740, 300]], 80);
        descend(E, n);
        const s = tileSeam(E);
        centerOn(E, s.fx, s.fy, 400, 300);
        return s;
    };
    test.each([[2], [3]])("depth %i: the mark and the hole are the same shape on the seam", (n) => {
        const r = fidelity(
            (E) => { seamScene(E, n); },
            (E) => gestureReturning(E, [[400, 250], [400, 350]], 20),
        );
        expect(r.removed).toBeGreaterThan(10);
        expect(r.overPx).toBeLessThanOrEqual(1);
        expect(r.underPx).toBeLessThanOrEqual(1);
    });
    test("no hairline of missing ink is left along the seam beside the hole", () => {
        const E = mkEngine();
        seamScene(E, 2);
        erase(E, [[400, 250], [400, 350]], 20);
        // Walk the seam column well clear of the hole. Ink there must be
        // unbroken: a gap of even one sample is a visible seam.
        let gaps = 0;
        for (let sy = 264; sy <= 336; sy += 2) {
            if (Math.abs(sy - 300) < 40) continue;
            if (!inkAt(E, 400 + 60, sy)) gaps++;
        }
        expect(gaps).toBe(0);
    });
    test("and it still looks like that after a round trip through the crossing", () => {
        const E = mkEngine();
        seamScene(E, 2);
        erase(E, [[400, 250], [400, 350]], 20);
        const before = raster(E, 56);
        roundTrip(E, 1);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
    });
});

describe("LX-9 — a free-floating detail inside a much bigger object", () => {
    // Layers: free-floating details (12) + small detail next to a big one (9) +
    // multi-layer erase (3) + erasing over multiple objects (10).
    //
    // A dot drawn four crossings down, sitting inside a stroke drawn at the top
    // level, is the canonical thing that cannot be computed globally: at L0 it
    // is 1e-14 of a pixel. Erasing around it must not touch it, and it must not
    // be absorbed into the big object's family just because it lives inside its
    // ceded ground.
    test("the dot survives an erase that goes right round it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60);
        descend(E, 4);
        const dot = drawStroke(E, [[400, 300]], 10, "#cc0044");
        const fam = families(E);
        expect(fam).toBe(2);
        const ring = [];
        for (let i = 0; i <= 36; i++) {
            const t = (i / 36) * Math.PI * 2;
            ring.push([400 + 70 * Math.cos(t), 300 + 70 * Math.sin(t)]);
        }
        erase(E, ring, 14);
        expect(E.doc.getById(dot.id)).toBeTruthy();
        expect(inkAt(E, 400, 300)).toBe(true);            // the dot is still there
        expect(inkAt(E, 400, 230)).toBe(false);           // and the ring is a hole
        expect(E.doc.editKey(dot)).toBe(dot.id);          // never absorbed
    });
    test("the dot does not move when its host is dragged... it is not part of it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60);
        descend(E, 4);
        const dot = drawStroke(E, [[300, 300]], 10, "#cc0044");
        erase(E, [[500, 240], [500, 360]], 14);
        const at = JSON.stringify(dot.loops || dot.pts);
        click(E, 600, 300);                               // the big stroke's ink
        expect(E.selection).toBeTruthy();
        expect(E.selection.ids.indexOf(dot.id)).toBe(-1);
        drag(E, [600, 300], [600, 420]);
        expect(JSON.stringify(dot.loops || dot.pts)).toBe(at);
    });
});

describe("LX-10 — erasing an object away completely, after it has ceded ground", () => {
    // Layers: multi-layer erase (3) + already-cut shape (5) + undo (18) +
    // free-floating pieces (12).
    //
    // Note first what CANNOT be done, because it constrains the test: one
    // crossing down an object is 3000x the screen, so no gesture at depth can
    // ever swallow it (V-11). The only place an object can be removed outright
    // is its own level — and by then it may own a chain of re-homed children
    // that the gesture, at that level, cannot even see. They are sub-pixel
    // there, hiding inside a window a few thousandths of a unit across. If they
    // are not taken with it, ink the user erased carries on existing, invisible
    // until they zoom back in and find a fragment floating in empty space.
    test("its re-homed children go with it — no orphans left three levels down", () => {
        const E = mkEngine();
        drawStroke(E, [[340, 300], [460, 300]], 30);
        const home = camShot(E);
        descend(E, 3);
        erase(E, [[400, 240], [400, 360]], 16);     // makes an L1/L2/L3 chain
        expect(natives(E).length).toBeGreaterThan(1);
        camRestore(E, home);
        erase(E, [[200, 300], [600, 300]], 120);    // now take the whole thing out
        expect(natives(E)).toEqual([]);
        expect(raster(E, 48).indexOf("#")).toBe(-1);
    });
    test("and undo puts the whole chain back", () => {
        const E = mkEngine();
        drawStroke(E, [[340, 300], [460, 300]], 30);
        const home = camShot(E);
        descend(E, 3);
        erase(E, [[400, 240], [400, 360]], 16);
        const deep = raster(E, 48);
        const deepCam = camShot(E);
        camRestore(E, home);
        erase(E, [[200, 300], [600, 300]], 120);
        E.undo(); E.flushErases();
        camRestore(E, deepCam);
        expect(rasterDiff(deep, raster(E, 48)).total).toBeLessThanOrEqual(2);
    });
});

describe("LX-11 — an erase whose gesture runs off the canvas", () => {
    // Layers: long eraser path (11) + multi-layer erase (3) + tile boundary (7)
    // + multiple tiles (13).
    //
    // Off-screen is not "not there". The ink extends far past the viewport, and
    // the tile the erase lands in is three screens wide. A cut that considered
    // only what is visible would stop at the viewport edge and leave a hard
    // horizontal line across the hole where the canvas used to end.
    test.each([[0], [1], [2]])("depth %i: the hole runs past the top and bottom edges", (n) => {
        const E = mkEngine();
        drawStroke(E, [[-400, 300], [1200, 300]], 900);   // taller than the canvas
        descend(E, n);
        erase(E, [[400, -400], [400, 1000]], 24);
        expect(inkAt(E, 400, 300)).toBe(false);
        // Pan the off-screen parts of the band into view and check the hole is
        // still there — above where the canvas ended, and below. The band is
        // 900 units tall against a 600 px canvas, so ±400 lands inside it and
        // outside where the viewport used to be.
        pan(E, 0, 400);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 300, 300)).toBe(true);
        pan(E, 0, -800);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 500, 300)).toBe(true);
    });
});

describe("LX-12 — re-homed ink is indistinguishable from ink that lives here", () => {
    // Layers: multi-layer erase (3) + zoom consistency (17) + tile boundary (7)
    // + performance (1).
    //
    // The design's central claim, stated so it is actually falsifiable. Erasing
    // the SAME object from different depths cannot give the same picture — a
    // 20 px eraser three crossings down removes 3000^3 times less of it, and it
    // should. What must hold is the other thing: standing at level d and cutting
    // ink that was re-homed here from d crossings up has to look exactly like
    // cutting ink that was drawn here in the first place. If it does not, the
    // user can see the storage.
    const cut = (build) => {
        const E = mkEngine();
        build(E);
        erase(E, [[400, 240], [400, 360]], 18);
        return raster(E, 60, { x0: 280, y0: 200, x1: 520, y1: 400 });
    };
    test.each([[1], [2], [3], [4]])("depth %i: re-homed vs native, same picture", (n) => {
        // Both fields are solid ink over the sample box: the L0 band is
        // magnified 3000^n so it covers everything, and the native one is drawn
        // wide enough to do the same.
        const rehomed = cut((E) => { drawStroke(E, [[100, 300], [700, 300]], 80); descend(E, n); });
        const nativeHere = cut((E) => { descend(E, n); drawStroke(E, [[-200, 300], [1000, 300]], 900); });
        expect(rehomed.indexOf("#")).toBeGreaterThanOrEqual(0);
        expect(rasterDiff(rehomed, nativeHere).total).toBeLessThanOrEqual(4);
    });
});

describe("LX-13 — erase, move, erase again somewhere new", () => {
    // Layers: already-cut shape (5) + moving between neighbourhoods (15, 16) +
    // multi-layer erase (3) + erasing over multiple objects (10).
    //
    // Moving an object changes which tiles hold it and which frame region its
    // windows point at. A second erase after the move has to land relative to
    // the ink, not relative to wherever the ink used to be.
    test("the second hole lands on the ink, not on where it used to be", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 200], [650, 200]], 50);
        const home = camShot(E);
        descend(E, 2, 300, 200);                  // about the ink, not the centre
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        click(E, 500, 200);
        drag(E, [500, 200], [500, 430]);
        const moved = camShot(E);
        descend(E, 2, 500, 430);
        expect(inkAt(E, 400, 300)).toBe(true);    // we are inside the moved band
        erase(E, [[400, 240], [400, 360]], 16);
        expect(inkAt(E, 400, 300)).toBe(false);
        camRestore(E, moved);
        expect(inkAt(E, 500, 430)).toBe(true);    // and at the top level it is intact
    });
    test("the first hole moved WITH the object and did not stay behind", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 200], [650, 200]], 50);
        const home = camShot(E);
        descend(E, 1, 300, 200);
        erase(E, [[400, 240], [400, 360]], 40);
        camRestore(E, home);
        // One crossing down the hole is 3000x finer than the band, so it is
        // sub-pixel from up here and correctly invisible. Its EXISTENCE is what
        // travels: check the document, then check the picture back down there.
        //
        // What records the hole is `attachRect` on the re-homed child — the tile
        // it fills, in its OWN frame. That is the doorway the two levels meet
        // through, so a move that carried the ink but left the doorway behind
        // would part the object the next time anything asked whether it was
        // still whole.
        const kids = natives(E).filter((r) => r.obj.attachRect);
        expect(kids.length).toBe(1);
        const kid = kids[0];
        click(E, 500, 200);
        // The doorway is a rect in the CHILD's own frame, so "did it come along"
        // has to be asked in the world: a deep move is mostly a change of
        // address, and the child's own coordinates do not move at all (F55) —
        // the displacement is in the table, and the part of it that is too
        // small for a cell hop lives in the table's home entry, so the world
        // position has to be asked of the PICTURE (`objPointIn`), not of the
        // coordinates through the frame alone. Asking the frame alone reads
        // 224 px for a 230 px drag: the remaining 6 units are in the table.
        const doorAt = () => {
            const r = E.doc.getById(kid.obj.id);
            return objPointIn(E, r, [r.obj.attachRect.x0, r.obj.attachRect.y0], "0");
        };
        const wBefore = doorAt();
        drag(E, [500, 200], [500, 430]);
        const wAfter = doorAt();
        expect(wAfter[1] - wBefore[1]).toBeCloseTo(230, 3);   // the doorway came too
        expect(wAfter[0] - wBefore[0]).toBeCloseTo(0, 3);
        expect(inkAt(E, 500, 200)).toBe(false);               // nothing left behind
        expect(inkAt(E, 500, 430)).toBe(true);
        // Put the band back where it was on screen and take the identical trip
        // down. The hole has to be in the identical place — anchoring the
        // descent anywhere else just measures the anchor.
        pan(E, 0, -230);
        descend(E, 1, 300, 200);
        expect(inkAt(E, 400, 300)).toBe(false);               // the hole, still there
    });
});

describe("LX-14 — erases that only graze", () => {
    // Layers: multi-layer erase (3) + tile boundary (7) + performance (1).
    //
    // A gesture that touches an object's ink by a hair must either take that
    // hair or leave the object entirely alone — what it must never do is
    // convert a clean stroke into a fill for nothing. Every needless conversion
    // costs the curve fidelity of the original and a permanent pile of vertices.
    // NOTE the near miss can only be staged at the object's own level. One
    // crossing down, a hand-drawn stroke is 3000x the screen (V-11) — there is
    // nowhere on the canvas that is NOT inside it, so "the eraser went past it"
    // is not a situation that exists at depth. That is worth stating rather
    // than quietly not testing.
    test("a near miss at its own level leaves the stroke a stroke", () => {
        const E = mkEngine();
        const s = drawStroke(E, [[200, 300], [600, 300]], 20);
        erase(E, [[400, 100], [400, 180]], 12);      // well above the band
        // Untouched means UNCUT: the same object under the same id, one family,
        // one native. (Its type is "shape" — every stroke resolves — and saying
        // "still a stroke" would only be testing whether the bake had run.)
        const rec = E.doc.getById(s.id);
        expect(rec).toBeTruthy();
        expect(families(E)).toBe(1);
        expect(natives(E).length).toBe(1);
    });
    test("a graze one crossing down still cannot leave a stray white mark", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 20);
        descend(E, 1);
        erase(E, [[400, 280], [400, 300]], 6);
        for (const k of E.doc.levels()) for (const o of E.doc.at(k)) expect(o.erase).toBeFalsy();
    });
    test("a real bite does convert it, and only it", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 20);
        drawStroke(E, [[200, 480], [600, 480]], 20);
        descend(E, 2);
        erase(E, [[400, 240], [400, 300]], 12);
        const kinds = natives(E).map((r) => r.obj.type).sort();
        // Both are resolved shapes; what distinguishes them is that only one
        // has been cut, so only one has a family reaching into the erase level.
        expect(kinds.every((k) => k === "shape")).toBe(true);
        expect(natives(E).some((r) => r.obj.attachRect != null)).toBe(true);
        expect(natives(E).some((r) => r.obj.editId == null)).toBe(true);
    });
});
