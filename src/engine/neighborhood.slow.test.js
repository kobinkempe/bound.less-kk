/**
 * NB — NEIGHBOURHOODS: moving ink between them, and between levels.
 *
 * Tiles are a cache keyed by where things are. Moving an object changes which
 * tiles hold it, which frame region its ceded windows point at, and — if it
 * moves far enough — which tiles exist at all. None of that is the user's
 * concern: they picked something up and put it down.
 *
 * The two directions are not symmetric and both are here. Moving a coarse
 * object while standing deep inside it is a drag of 1e-10 of its own width, and
 * every part of it, at every level, has to follow by exactly that. Moving a
 * fine object while standing at the top is a drag it cannot even represent —
 * the pointer moves 100 px, which is 3e-8 of a unit up here, and the object's
 * own coordinates have to absorb it (bible §5.4: applying each event's delta
 * separately made a slow drag move LESS than a fast one, because each 1 px step
 * fell under one ulp and was discarded).
 */
import {
    useEngines, mkEngine, drawStroke, erase, drag, click, pan,
    descend, camShot, camRestore, topView, inkAt, colorAt, raster, rasterDiff,
    families, natives, painted, picture, vertexCount, timeIt,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const anchorOf = (o) => (o.type === "shape" ? o.loops[0][0].A
    : o.type === "fill" ? o.polys[0][0] : o.pts[0]);
const anchors = (E) => natives(E).map((r) => ({ id: r.obj.id, level: r.level, a: [...anchorOf(r.obj)] }));

// WHERE A NATIVE IS, expressed in one fixed frame's units.
//
// These tests used to read a member's own coordinates and expect a drag to have
// rewritten them by `displacement x frameFactor`. Four crossings down that means
// multiplying a 100 px drag into 2.8e16 units, which is what destroyed the deep
// pieces (F-C / F25). A member RE-HOMES now — its address changes and its
// coordinates do not — so "did it move, and by how much" is a question about the
// world, and has to be measured there.
const worldOf = (E, rec, ref = "0") => E.lm.mapPointF([...anchorOf(rec.obj)], rec.level, ref);
const worldById = (E, ref = "0") => new Map(natives(E).map((r) => [r.obj.id, worldOf(E, r, ref)]));
const worldOfId = (E, id, ref = "0") => { const r = E.doc.getById(id); return r ? worldOf(E, r, ref) : null; };


describe("NB-1 — moving a level-0 object while standing at level 4", () => {
    // Layers: moving across levels (6) + multi-layer erase (3) + multi-layer
    // selection (2) + zoom consistency (17).
    //
    // A 100 px drag down here is 100/3000^4 = 1.2e-12 units at level 0 — near
    // the bottom of what float64 can express at those coordinates. The object
    // must move by exactly that, and its four re-homed children must each move
    // by the same distance measured in THEIR units, or the object tears.
    test("every level of the family moves by the same screen distance", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 4, 400, 300);
        erase(E, [[400, 250], [400, 350]], 14);
        expect(natives(E).length).toBeGreaterThanOrEqual(5);
        // Capture AFTER the click: selecting settles any pending erase, which
        // replaces the object with its cut form and moves which piece the
        // anchor names.
        click(E, 200, 300);
        const before = worldById(E);
        const sx = 100 / E.cam.inScale, sy = 100 / E.cam.inScale;
        const camF = E.lm.frameFactor(E.cam.frame, "0");
        drag(E, [200, 300], [300, 400]);
        natives(E).forEach((r) => {
            const b = before.get(r.obj.id);
            expect(b).toBeTruthy();
            const a = worldOf(E, r);
            expect(a[0] - b[0]).toBeCloseTo(sx * camF, 6);
            expect(a[1] - b[1]).toBeCloseTo(sy * camF, 6);
        });
    });
    test("a slow drag moves it exactly as far as a fast one", () => {
        // Bible §5.4. Forty 5 px steps and one 200 px flick must land in the
        // same place; the residue accounting is what makes that true.
        const run = (steps) => {
            const E = mkEngine();
            drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
            descend(E, 4, 400, 300);
            click(E, 200, 300);
            E.setTool("select");
            E.pointerDown(200, 300);
            for (let i = 1; i <= steps; i++) E.pointerMove(200, 300 + (200 * i) / steps);
            E.pointerUp();
            return raster(E, 48);
        };
        expect(rasterDiff(run(40), run(1)).total).toBeLessThanOrEqual(2);
    });
});

describe("NB-2 — moving a level-4 detail while standing at level 0", () => {
    // Layers: moving across levels (6) + free-floating details (12) + small
    // detail beside a large one (9) + zoom consistency (17).
    //
    // The other direction. Up here the detail is 1e-14 px across; a drag is a
    // colossal move in its own units, and nothing at this level should change
    // visibly at all. Then go and look: it moved, and by the right amount.
    test("a CLICK from up here lands on the coarse ink, not the detail", () => {
        // Not a gap: this is ordinary hit-testing. A click resolves to the
        // topmost thing under the cursor, and four crossings up the detail is
        // 1e-14 px across while the coarse stroke is right there. The way to
        // pick a sub-pixel object up from far above is the LASSO, which is a
        // design requirement and works at every depth — see
        // select.multilevel SM-4, "a loop at the top catches an object homed at
        // L%i". This case just pins which of the two gestures does what.
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 4, 400, 300);
        const fine = drawStroke(E, [[380, 300], [420, 300]], 12, RED);
        camRestore(E, home);
        click(E, 400, 300);
        expect(E.selection).toBeTruthy();
        expect(E.selection.ids).not.toContain(fine.id);
    });
    test("moved from up here, level 0 does not change and the detail moves exactly", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 4, 400, 300);
        const fine = drawStroke(E, [[380, 300], [420, 300]], 12, RED);
        const deep = camShot(E);
        const deepFrame = E.cam.frame;
        const w0 = worldOfId(E, fine.id);                 // in level-0 units
        const d0 = worldOfId(E, fine.id, deepFrame);      // ...and in its own view's
        camRestore(E, home);
        const before = raster(E, 48);
        // Drive the selection directly — see above, the pointer cannot reach it.
        E._setSelection([fine.id]);
        E._dragSel = { start: [400, 300], moves: new Map(), moved: false };
        E._dragSelection(500, 360);
        E._dragSel = null;
        expect(rasterDiff(before, raster(E, 48)).total).toBe(0);   // level 0: unchanged
        // 100 px right and 60 down AT LEVEL 0 — measured in the world, because
        // that is where the move happened. The detail's own coordinates barely
        // change: almost all of this is a change of address.
        const w1 = worldOfId(E, fine.id);
        expect(w1[0] - w0[0]).toBeCloseTo(100 / E.cam.inScale, 6);
        expect(w1[1] - w0[1]).toBeCloseTo(60 / E.cam.inScale, 6);
        // And down there it really has gone 100 screen px right, 60 down. Look
        // for the DETAIL's colour, not for ink: the blue band is magnified 8e13
        // here and covers every pixel of the canvas whatever happens.
        camRestore(E, deep);
        expect(colorAt(E, 400, 300)).toBe(BLUE);
        // The pan back has to be measured in THIS camera's pixels. 100 px at
        // level 0 is 100 x frameFactor units in the detail's own frame, and
        // that many units is a completely different number of pixels down here.
        const d1 = worldOfId(E, fine.id, deepFrame);
        const moved = [d1[0] - d0[0], d1[1] - d0[1]];
        pan(E, -moved[0] * E.cam.inScale, -moved[1] * E.cam.inScale);
        expect(colorAt(E, 400, 300)).toBe(RED);
    });
    test("a hundred one-pixel steps land where one hundred-pixel step does", () => {
        // Bible §5.4 again, in the direction that made it visible: four
        // crossings ABOVE the object, one screen pixel is far below one ulp of
        // its coordinates, so an un-accumulated drag discards every step.
        const run = (steps) => {
            const E = mkEngine();
            drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
            const home = camShot(E);
            descend(E, 4, 400, 300);
            const fine = drawStroke(E, [[380, 300], [420, 300]], 12, RED);
            const a0 = worldOfId(E, fine.id);
            camRestore(E, home);
            E._setSelection([fine.id]);
            E._dragSel = { start: [400, 300], moves: new Map(), moved: false };
            for (let i = 1; i <= steps; i++) E._dragSelection(400 + (100 * i) / steps, 300);
            E._dragSel = null;
            return worldOfId(E, fine.id)[0] - a0[0];
        };
        const fast = run(1), slow = run(100);
        expect(fast).not.toBe(0);
        expect(slow / fast).toBeCloseTo(1, 6);
    });
});

describe("NB-3 — moving out of the neighbourhood entirely", () => {
    // Layers: moving out of a neighbourhood (15) + into a new one (16) +
    // already-cut shapes (5) + tile boundaries (7) + performance (1).
    //
    // A move of many tile-widths. Everything about where the object was — its
    // tiles, its window's frame region — is now stale, and everything about
    // where it is now has never existed. Nothing may be left behind.
    test("nothing of it is left at the old place", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 60, BLUE);
        erase(E, [[400, 240], [400, 360]], 22);
        const box = { x0: 240, y0: 220, x1: 560, y1: 380 };
        click(E, 320, 300);
        E._setSelection(natives(E).map((r) => r.obj.id));
        drag(E, [320, 300], [720, 560]);
        pan(E, -400, -260);                       // follow it
        expect(inkAt(E, 320, 300)).toBe(true);    // it is here now
        pan(E, 400, 260);
        expect(raster(E, 40, box).indexOf("#")).toBe(-1);   // and nothing back there
    });
    test("and it looks the same when it arrives", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 60, BLUE);
        erase(E, [[400, 240], [400, 360]], 22);
        const box = { x0: 240, y0: 220, x1: 560, y1: 380 };
        const before = raster(E, 44, box);
        E._setSelection(natives(E).map((r) => r.obj.id));
        drag(E, [320, 300], [1520, 300]);         // several screens to the right
        pan(E, -1200, 0);
        expect(rasterDiff(before, raster(E, 44, box)).total).toBeLessThanOrEqual(1);
    });
    test("a far move does not multiply the geometry", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 60, BLUE);
        erase(E, [[400, 240], [400, 360]], 22);
        const v0 = vertexCount(E);
        E._setSelection(natives(E).map((r) => r.obj.id));
        drag(E, [320, 300], [1520, 300]);
        pan(E, -1200, 0);
        expect(vertexCount(E)).toBeLessThanOrEqual(v0 * 2 + 40);
    });
});

describe("NB-4 — moving INTO an occupied neighbourhood", () => {
    // Layers: moving into a new neighbourhood (16) + erasing over multiple
    // objects (10) + z-order (behaviour 5) + already-cut shapes (5).
    test("the resident is untouched and the newcomer keeps its own hole", () => {
        const E = mkEngine();
        const resident = drawStroke(E, [[500, 480], [780, 480]], 60, RED);
        const pts0 = JSON.stringify(anchorOf(resident));
        drawStroke(E, [[100, 200], [380, 200]], 60, BLUE);   // later, so on top
        erase(E, [[240, 130], [240, 190]], 22);              // a nick, not a cut
        expect(families(E)).toBe(2);
        expect(inkAt(E, 240, 200)).toBe(false);              // the nick is there
        click(E, 140, 200);
        drag(E, [140, 200], [540, 480]);                     // blue lands on red
        expect(colorAt(E, 560, 480)).toBe(BLUE);             // it arrived, on top
        expect(inkAt(E, 640, 480)).toBe(true);
        // The nick came with it — a hole in the blue, showing the red through.
        expect(colorAt(E, 640, 480)).toBe(RED);
        // ...and the red itself was never touched.
        expect(E.doc.getById(resident.id).obj.type).toBe("shape");
        expect(JSON.stringify(anchorOf(E.doc.getById(resident.id).obj))).toBe(pts0);
        expect(families(E)).toBe(2);
    });
});

describe("NB-5 — moving one severed half", () => {
    // Layers: topology (14) + moving between neighbourhoods (15) + multi-layer
    // erase (3) + multi-layer selection (2).
    //
    // After a deep severance each half owns a chain of natives across five
    // frames. Moving one must move all five of ITS natives and none of the
    // other's — which means the re-parenting the severance did has to be right,
    // not just the geometry.
    test("the whole of one chain moves and the whole of the other stays", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        // A deep nick first, so one half will own a re-homed chain; then the
        // severing cut at the object's own level, which is the only place a
        // gesture can cross a band at all (TP-2).
        descend(E, 2, 250, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        expect(families(E)).toBe(1);
        erase(E, [[440, 200], [440, 400]], 26);
        expect(families(E)).toBe(2);
        click(E, 200, 300);
        const key = E.selection.editId;
        const mine = new Set(natives(E).filter((r) => E.doc.editKey(r.obj) === key).map((r) => r.obj.id));
        expect(mine.size).toBeGreaterThanOrEqual(2);
        const before = worldById(E);
        const camF = E.lm.frameFactor(E.cam.frame, "0");
        drag(E, [200, 300], [200, 450]);
        for (const r of natives(E)) {
            const b = before.get(r.obj.id);
            expect(b).toBeTruthy();
            // In the WORLD: the selected chain goes 150 screen px down, and the
            // other chain does not move at all. A member's own coordinates say
            // nothing about either, now that most of a deep move is an address.
            const expected = mine.has(r.obj.id) ? (150 / E.cam.inScale) * camF : 0;
            expect(worldOf(E, r)[1] - b[1]).toBeCloseTo(expected, 6);
        }
    });
});

describe("NB-6 — a move across a level crossing", () => {
    // Layers: moving across levels (6) + zoom consistency (17) + already-cut
    // shapes (5) + tile boundaries (7).
    //
    // Pick it up at one level, put it down, then go and check from another. The
    // crossing rebuilds everything from a different set of tiles; if the move
    // was only applied to the representation and not to the natives, this is
    // where it comes undone.
    test.each([[1], [2], [3]])("moved at depth %i, checked from the top and back", (n) => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 50, BLUE);
        erase(E, [[400, 240], [400, 360]], 20);
        const home = camShot(E);
        descend(E, n, 300, 300);
        const deep = camShot(E);
        click(E, 400, 300);
        drag(E, [400, 300], [400, 380]);
        const moved = raster(E, 48);
        camRestore(E, home);
        camRestore(E, deep);
        expect(rasterDiff(moved, raster(E, 48)).total).toBeLessThanOrEqual(2);
    });
});

describe("NB-7 — an object that has ceded ground, moved and then erased again", () => {
    // Layers: moving (6, 15) + already-cut shapes (5) + multi-layer erase (3) +
    // multiple tiles (13).
    //
    // The window is stored in the parent's coordinates, so it moves with the
    // parent — but the CHILD is a native of another frame and moves by its own
    // amount. If the two drift apart, the parent stops painting a hole where the
    // child is and starts painting one where it is not: a stripe of missing ink
    // beside a stripe of doubled ink.
    test("window and child stay locked together through a move", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        const holeShot = raster(E, 48);
        camRestore(E, home);
        click(E, 200, 300);
        drag(E, [200, 300], [260, 380]);
        // Put the ink back where it was on screen and take the identical trip
        // down. Restoring the deep camera instead would look for the hole where
        // it used to be — 60 units at level 0 is 5.4e8 units down there.
        pan(E, -60, -80);
        descend(E, 2, 400, 300);
        expect(rasterDiff(holeShot, raster(E, 48)).total).toBeLessThanOrEqual(48 * 48 * 0.02);
    });
    test("...and a second erase after the move still finds the ink", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        click(E, 200, 300);
        drag(E, [200, 300], [200, 420]);
        descend(E, 2, 300, 420);
        expect(inkAt(E, 400, 300)).toBe(true);
        erase(E, [[400, 240], [400, 360]], 18);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 200, 300)).toBe(true);
    });
});

describe("NB-8 — panning does not change anything", () => {
    // Layers: moving out of / into neighbourhoods (15, 16) + tile boundaries (7)
    // + performance (1) + zoom consistency (17).
    //
    // The cheap sibling of a move, and the one that runs on every frame. A pan
    // across several tile widths and back must be a no-op in every sense: same
    // picture, same geometry, and fast.
    test("a long pan and back leaves the document byte-identical", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        const before = picture(E);
        for (let i = 0; i < 12; i++) pan(E, -400, -120);
        for (let i = 0; i < 12; i++) pan(E, 400, 120);
        expect(picture(E)).toBe(before);
    });
    test("and stays interactive while it does it", () => {
        const E = mkEngine();
        for (let i = 0; i < 6; i++) drawStroke(E, [[80, 100 + i * 80], [720, 100 + i * 80]], 40, BLUE);
        descend(E, 2, 400, 300);
        erase(E, [[100, 100], [700, 500]], 20);
        E._render();
        const ms = timeIt(() => pan(E, 37, 11), 30);
        expect(ms).toBeLessThan(120);
    });
});
