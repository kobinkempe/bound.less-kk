/**
 * ZO — Z-ORDER, which nothing else in the suite can see.
 *
 * Erasing shatters one object into several, at several levels, and re-homing
 * moves ink into frames it was never drawn in. Every one of those pieces has to
 * keep painting at the ORIGINAL object's depth — not at the depth of the frame
 * it now lives in, not at the depth of the erase that made it, and not at the
 * order the tile bake happened to emit it in.
 *
 * The failure mode is quiet. Every piece is individually well-formed, the ink is
 * all present, nothing has moved — a stroke has simply come out on top of one it
 * used to be under, and only a colour comparison finds it. So these tests read
 * COLOUR at a point, not presence, and they read it again after a crossing,
 * after a tile eviction, and after a drag.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, drag, click, pan,
    descend, camShot, camRestore, painted, colorAt, topAt, topAtAll, inkAt,
    rasterZ, raster, rasterVisible, rasterDiff, families, natives,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311", GREEN = "#118844";

describe("ZO-1 — a cut piece keeps the depth of the stroke it came from", () => {
    // Layers: already-cut shapes (5) + erasing over multiple objects (10) +
    // z-order (behaviour 5) + zoom consistency (17).
    //
    // The pieces get FRESH ids, and id is the fallback z. If a piece ever falls
    // back to its own id, every cut piece jumps to the front of the drawing.
    test("cutting the bottom stroke does not lift it above the top one", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 120, BLUE);   // bottom
        drawStroke(E, [[120, 300], [680, 300]], 60, RED);     // top, narrower
        expect(colorAt(E, 400, 300)).toBe(RED);
        erase(E, [[200, 220], [200, 380]], 20);               // cut the pair, left of centre
        expect(colorAt(E, 400, 300)).toBe(RED);
        expect(colorAt(E, 400, 260)).toBe(BLUE);              // the blue's own margin
    });
    test.each([[1], [2], [3]])("...still true when the cut is made %i crossing(s) down", (n) => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 120, BLUE);
        drawStroke(E, [[120, 300], [680, 300]], 60, RED);
        const home = camShot(E);
        descend(E, n, 200, 300);
        erase(E, [[400, 200], [400, 400]], 20);
        camRestore(E, home);
        expect(colorAt(E, 400, 300)).toBe(RED);
        expect(colorAt(E, 400, 260)).toBe(BLUE);
    });
});

describe("ZO-2 — a re-homed child paints at its parent's depth, not its level's", () => {
    // Layers: multi-layer erase (3) + z-order (behaviour 5) + small detail
    // beside a large one (9) + zoom consistency (17).
    //
    // This is the one that the level model makes easy to get wrong. After a deep
    // erase the blue stroke's ink lives partly at level 0 and partly at level 3.
    // A later red stroke drawn at level 0 must cover BOTH — including the deep
    // child, which is "newer" by id and lives in a finer frame.
    test("a stroke drawn afterwards covers the deep child too", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 140, BLUE);
        const home = camShot(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);          // makes children down to L3
        expect(natives(E).length).toBeGreaterThan(1);
        camRestore(E, home);
        drawStroke(E, [[120, 300], [680, 300]], 60, RED); // later, and on top
        expect(colorAt(E, 400, 300)).toBe(RED);
        // Go back down to where the child lives: red still covers it there.
        descend(E, 3, 400, 300);
        expect(colorAt(E, 200, 300)).toBe(RED);
    });
    test("and a stroke drawn BEFORE stays underneath at every level", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 60, GREEN);   // first: underneath
        drawStroke(E, [[120, 300], [680, 300]], 140, BLUE);   // second: on top
        const home = camShot(E);
        expect(colorAt(E, 400, 300)).toBe(BLUE);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        expect(colorAt(E, 200, 300)).toBe(BLUE);
        camRestore(E, home);
        expect(colorAt(E, 700, 300)).toBe(BLUE);
        // Across the erased spot, blue still covers green — including inside the
        // tile blue ceded, which its own child fills.
        //
        // The assertion is that GREEN never shows, not that blue always does.
        // Green showing would be the z-order failure this file exists to catch:
        // an older stroke climbing out from under a newer one. A sample coming
        // back EMPTY is a different thing entirely — the ceded tile is 16 units
        // across at this level and its own child cedes again inside it, so a
        // point probe can land exactly on the hole, or exactly on the boundary
        // between a cut parent and the child filling it, where a winding query
        // has no answer to give. Neither says anything about z-order.
        let green = 0, blue = 0;
        for (let sx = 392; sx <= 408; sx += 0.5) {
            const c = colorAt(E, sx, 300);
            if (c === GREEN) green++;
            if (c === BLUE) blue++;
        }
        expect(green).toBe(0);
        expect(blue).toBeGreaterThan(25);
    });
});

describe("ZO-3 — the eraser mark itself, before it bakes", () => {
    // Layers: z-order (behaviour 5) + erasing over multiple objects (10) +
    // performance (1, deferred baking).
    //
    // The mark is real ink in the background colour, committed the instant the
    // gesture ends and replaced by a hole later. While it is there it must cover
    // everything below it and nothing drawn after it — otherwise the drawing
    // visibly changes at the moment the bake happens, hundreds of milliseconds
    // after the user let go.
    test("the mark covers what it erased and yields to what came next", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 120, BLUE);
        eraseGesture(E, [[400, 220], [400, 380]], 24);        // NOT flushed
        E._render();
        const mark = E.doc.at(E.cam.frame).find((o) => o.erase);
        expect(mark).toBeTruthy();
        expect(topAtAll(E, 400, 300).id).toBe(mark.id);       // above the blue
        drawStroke(E, [[380, 200], [380, 400]], 30, GREEN);   // drawn after the mark
        expect(topAtAll(E, 380, 300).color).toBe(GREEN);      // ...but under this
        expect(topAtAll(E, 420, 300).id).toBe(mark.id);       // still above the blue
    });
    test.each([[0], [1], [2]])("depth %i: the picture does not jump when it bakes", (n) => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 120, BLUE);
        if (n) descend(E, n, 400, 300);
        eraseGesture(E, [[400, 220], [400, 380]], 24);
        // What the user sees is the TOP-most painter at each point, and where
        // that is an eraser mark they see background — the blue underneath is
        // still in the list but invisible. Baking replaces the mark with a real
        // hole, and the visible picture must not change at that moment: the
        // gesture already looked finished, hundreds of milliseconds ago.
        const before = rasterVisible(E, 56);
        E.flushErases();
        expect(rasterDiff(before, rasterVisible(E, 56)).total).toBeLessThanOrEqual(2);
    });
});

describe("ZO-4 — severed halves keep the original depth, not fresh ones", () => {
    // Layers: topology (14) + z-order (behaviour 5) + selection (2) +
    // multi-layer erase (3).
    test.each([[0], [2]])("severed %i crossing(s) down, both halves stay under", (n) => {
        const E = mkEngine();
        drawStroke(E, [[120, 300], [680, 300]], 120, BLUE);
        drawStroke(E, [[120, 300], [680, 300]], 40, RED);       // narrow, on top
        const home = camShot(E);
        if (n) descend(E, n, 400, 300);
        erase(E, [[400, 180], [400, 420]], n ? 40 : 26);
        camRestore(E, home);
        // Blue is in (at least) two pieces now. Red must still be on top of
        // both, on either side of the cut.
        expect(colorAt(E, 220, 300)).toBe(RED);
        expect(colorAt(E, 600, 300)).toBe(RED);
        expect(colorAt(E, 220, 270)).toBe(BLUE);
        expect(colorAt(E, 600, 270)).toBe(BLUE);
    });
});

describe("ZO-5 — z-order survives the machinery", () => {
    // Layers: zoom consistency (17) + tile boundary (7) + performance (1) +
    // already-cut shapes (5).
    //
    // Three stacked, overlapping strokes with a hole through them. The stacking
    // order is sampled as a picture and must come back identical after a level
    // crossing, after every tile is evicted, and after a pan that changes which
    // tiles are visible. Any of those rebuilding the list in a different order
    // would show up here and nowhere else.
    const scene = (E) => {
        drawStroke(E, [[100, 260], [700, 340]], 90, BLUE);
        drawStroke(E, [[100, 340], [700, 260]], 90, RED);
        drawStroke(E, [[100, 300], [700, 300]], 40, GREEN);
        erase(E, [[400, 180], [400, 420]], 22);
    };
    test("a level crossing does not reorder anything", () => {
        const E = mkEngine();
        scene(E);
        const home = camShot(E);
        const z = rasterZ(E, 40);
        descend(E, 2, 400, 300);
        camRestore(E, home);
        expect(rasterZ(E, 40)).toBe(z);
    });
    test("evicting every tile does not reorder anything", () => {
        const E = mkEngine();
        scene(E);
        const z = rasterZ(E, 40);
        E.store.bumpEpoch();
        expect(E.store.size()).toBe(0);
        expect(rasterZ(E, 40)).toBe(z);
    });
    test("panning to a different tile set does not reorder anything", () => {
        const E = mkEngine();
        scene(E);
        const z = rasterZ(E, 40);
        pan(E, -3000, 0); pan(E, 3000, 0);
        expect(rasterZ(E, 40)).toBe(z);
    });
});

describe("ZO-6 — an erase on a tile seam looks the same after it bakes", () => {
    // Layers: tile boundary (7) + z-order (behaviour 5) + multiple tiles (13) +
    // zoom consistency (17).
    //
    // The user's question, put as a z-order test rather than a shape one: on a
    // seam, does the baked result stack the same way the mark did, and keep
    // stacking that way once you zoom?
    test("colours at the seam are unchanged by the bake and by a crossing", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 160, BLUE);
        drawStroke(E, [[100, 300], [700, 300]], 70, RED);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        const zBefore = rasterZ(E, 32);
        erase(E, [[400, 220], [400, 380]], 18);
        const zAfter = rasterZ(E, 32);
        // The hole is new; everything that is still ink must be the same colour.
        let flips = 0;
        const A = zBefore.split("\n"), B = zAfter.split("\n");
        for (let j = 0; j < A.length; j++) {
            for (let i = 0; i < A[j].length; i++) {
                if (A[j][i] !== "." && B[j][i] !== "." && A[j][i] !== B[j][i]) flips++;
            }
        }
        expect(flips).toBe(0);
        camRestore(E, home);
        descend(E, 2, 400, 300);
        expect(rasterZ(E, 32)).toBe(zAfter);
    });
});

describe("ZO-7 — dragging one object through a stack does not restack it", () => {
    // Layers: moving between neighbourhoods (15, 16) + z-order (behaviour 5) +
    // already-cut shapes (5) + moving a hole over something (8).
    test("a holed object dragged over two others stays exactly where it was in the stack", () => {
        const E = mkEngine();
        drawStroke(E, [[120, 200], [680, 200]], 80, GREEN);   // bottom
        drawStroke(E, [[120, 200], [680, 200]], 80, BLUE);    // middle
        drawStroke(E, [[120, 480], [680, 480]], 80, RED);     // top, elsewhere
        erase(E, [[400, 440], [400, 520]], 24);               // hole the red one
        click(E, 200, 480);
        drag(E, [200, 480], [200, 200]);                      // red over green+blue
        expect(colorAt(E, 200, 200)).toBe(RED);               // still the newest
        expect(colorAt(E, 400, 200)).toBe(BLUE);              // seen through red's hole
        drag(E, [200, 200], [200, 480]);                      // and back
        expect(colorAt(E, 400, 200)).toBe(BLUE);
        expect(colorAt(E, 200, 480)).toBe(RED);
    });
});

describe("ZO-8 — an object erased down to two pieces at DIFFERENT levels", () => {
    // Layers: multi-layer erase (3) + topology (14) + z-order (behaviour 5) +
    // free-floating pieces (12) + already-cut shapes (5).
    //
    // After a deep severance one object has become two families, each spread
    // across five frames. Ten natives, all sharing one original z. A later
    // stroke must cover all ten, and an earlier one must be covered by all ten.
    test("everything the severance produced sits at the same depth", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 100], [400, 500]], 60);
        camRestore(E, home);
        const zs = new Set(natives(E).map((r) => (r.obj.z != null ? r.obj.z : r.obj.id)));
        expect(zs.size).toBe(1);
        drawStroke(E, [[100, 300], [700, 300]], 24, RED);
        expect(colorAt(E, 200, 300)).toBe(RED);
        expect(colorAt(E, 600, 300)).toBe(RED);
        descend(E, 2, 200, 300);
        expect(colorAt(E, 400, 300)).toBe(RED);
    });
});
