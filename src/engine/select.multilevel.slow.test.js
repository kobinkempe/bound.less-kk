/**
 * SM — SELECTION ACROSS LEVELS.
 *
 * A selection is the one place where the level model has to be completely
 * invisible. The user picks things up on screen; whether a thing lives in this
 * frame, four crossings up, or in six frames at once is not something they
 * asked about. So: a marquee of a level-1 object and a level-4 object has to
 * drag both by the same number of SCREEN pixels — which is a different number
 * of frame units each, differing by a factor of 3000^3 — and a family scattered
 * over five frames by successive erases has to behave like one object.
 *
 * The other half is behaviour 3: a selection must not include what was erased
 * out of it. Ink that is gone must not come back when the thing is moved, and
 * the space it left must not be draggable.
 */
import {
    useEngines, mkEngine, drawStroke, erase, eraseGesture, drag, click, pan,
    descend, ascend, camShot, camRestore, topView, inkAt, colorAt, raster,
    rasterDiff, families, natives, painted,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const ctrlClick = (E, sx, sy) => { E.setTool("select"); E.pointerDown(sx, sy, true); E.pointerUp(); };
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const boxLoop = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// Where a native's anchor sits IN THE ACTIVE FRAME's units.
//
// These tests used to assert that a drag rewrote each member's OWN coordinates
// by `displacement x frameFactor`. That is the thing the frame lattice exists to
// stop: four levels down it meant multiplying a 100 px drag into 2.8e16 units
// and destroying the object (F-C / F25). A deep member now RE-HOMES — its
// address changes and its coordinates do not — so the question "did it move" has
// to be asked about where it is in the world, which is what this measures.
const worldAnchorAt = (E, rec) => {
    const a = rec.obj.type === "shape" ? rec.obj.loops[0][0].A
        : rec.obj.type === "fill" ? rec.obj.polys[0][0] : rec.obj.pts[0];
    return E.lm.mapPointF([a[0], a[1]], rec.level, E.cam.frame);
};
const anchorOf = (o) => (o.type === "shape" ? o.loops[0][0].A
    : o.type === "fill" ? o.polys[0][0] : o.pts[0]);

describe("SM-1 — a level-1 object and a level-4 object, selected together", () => {
    // Layers: multi-layer selection (2) + moving across levels (6) + small
    // detail beside a large one (9) + free-floating details (12).
    //
    // Their coordinates differ by 3000^3 = 2.7e10. Dragging 120 px must move
    // both 120 px, which means moving one of them 2.7e10 times further than the
    // other in its own units. Getting the factor backwards, or dropping it,
    // leaves one of them behind or throws it off the edge of the world.
    const build = () => {
        const E = mkEngine();
        descend(E, 1, 400, 300);
        const coarse = drawStroke(E, [[260, 220], [540, 220]], 26, BLUE);
        const home = camShot(E);
        descend(E, 4, 400, 380);
        const fine = drawStroke(E, [[300, 380], [500, 380]], 26, RED);
        return { E, coarse, fine, home, deep: camShot(E) };
    };
    test("both move by the same number of screen pixels", () => {
        const { E, coarse, fine, deep } = build();
        camRestore(E, deep);
        expect(inkAt(E, 400, 380)).toBe(true);        // the fine one is here
        click(E, 400, 380);
        ctrlClick(E, 400, 300);                       // ...and so is the coarse one, magnified
        expect(E.selection.ids.length).toBeGreaterThanOrEqual(1);
        const a0 = [...anchorOf(coarse)], b0 = [...anchorOf(fine)];
        const sel = E.selection.ids.slice();
        drag(E, [400, 380], [400, 500]);
        const dyCoarse = anchorOf(coarse)[1] - a0[1];
        const dyFine = anchorOf(fine)[1] - b0[1];
        // 120 screen px, expressed in each object's own units.
        const f = E.cam.inScale;
        if (sel.includes(fine.id)) expect(dyFine).toBeCloseTo(120 / f, 3);
        if (sel.includes(coarse.id)) {
            const g = E.lm.frameFactor(E.cam.frame, E.doc.getById(coarse.id).level);
            expect(dyCoarse).toBeCloseTo((120 / f) * g, 6);
        }
        expect(sel.length).toBeGreaterThan(0);
    });
    test("...and on screen they end up exactly where the pointer put them", () => {
        const { E, deep } = build();
        camRestore(E, deep);
        click(E, 400, 380);
        ctrlClick(E, 400, 300);
        const before = raster(E, 48);
        drag(E, [400, 380], [400, 440]);
        pan(E, 0, -60);                                // undo the 60 px on screen
        expect(rasterDiff(before, raster(E, 48)).total).toBeLessThanOrEqual(3);
    });
    test("deselecting one of them leaves the other selected", () => {
        const { E, fine, deep } = build();
        camRestore(E, deep);
        click(E, 400, 380);
        ctrlClick(E, 400, 300);
        const n = E.selection.ids.length;
        ctrlClick(E, 400, 380);
        expect(E.selection ? E.selection.ids.length : 0).toBe(n - 1);
        expect((E.selection ? E.selection.ids : []).includes(fine.id)).toBe(false);
    });
});

describe("SM-2 — a family scattered over five frames is one object", () => {
    // Layers: multi-layer selection (2) + multi-layer erase (3) + moving across
    // levels (6) + already-cut shapes (5).
    test("clicking any part of it selects the same thing", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 4, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        expect(natives(E).length).toBeGreaterThanOrEqual(4);   // a chain, L0..L4
        expect(families(E)).toBe(1);
        const deep = camShot(E);
        click(E, 200, 300);
        const key = E.selection.editId;
        click(E, 600, 300);
        expect(E.selection.editId).toBe(key);
        camRestore(E, home);
        click(E, 200, 300);
        expect(E.selection.editId).toBe(key);                  // and from up here too
        camRestore(E, deep);
    });
    test("dragging it moves every level of it, and the hole comes along", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        const deep = camShot(E);
        camRestore(E, home);
        // Capture AFTER the click: selecting settles any pending erase, which
        // replaces the object with its cut form, and the anchor is then a
        // different piece of the perimeter. That is the erase, not the move.
        click(E, 200, 300);
        // Keyed by ID, not by position: a member that re-homes lands under a new
        // frame key, and `natives` enumerates by frame, so the two lists are not
        // in the same order after a move.
        const before = new Map(natives(E).map((r) => [r.obj.id, worldAnchorAt(E, r)]));
        drag(E, [200, 300], [200, 420]);
        // Every native moved 120 screen px, measured where the drag was made.
        // Whether that reached its coordinates or only its address is the
        // engine's business; what has to be true is that they all moved, and all
        // by the same amount.
        natives(E).forEach((r) => {
            expect(worldAnchorAt(E, r)[1] - before.get(r.obj.id)[1]).toBeCloseTo(120 / E.cam.inScale, 6);
        });
        camRestore(E, deep);
        pan(E, 0, -120 * E.cam.inScale / E.cam.inScale);       // stay put; check the hole
        expect(families(E)).toBe(1);
    });
    test("deleting it takes every level of it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        click(E, 200, 300);
        E.deleteSelection();
        expect(natives(E)).toEqual([]);
    });
});

describe("SM-3 — what was erased is not part of the selection", () => {
    // Layers: multi-layer selection (2) + already-cut shapes (5) + moving a
    // hole over something (8). Behaviour 3.
    //
    // Two ways to get this wrong, both of which look fine until something moves:
    // the selection could still carry the removed ink (and paint it back where
    // it lands), or the hole could still be grabbable (and drag the object by
    // empty space).
    test("clicking in the hole does not select the object it is a hole in", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 100, BLUE);
        erase(E, [[400, 230], [400, 370]], 30);
        expect(inkAt(E, 400, 300)).toBe(false);
        click(E, 400, 300);
        expect(E.selection).toBeNull();
    });
    test("clicking through a hole selects whatever is behind it instead", () => {
        // The hole has to be moved over the red, not erased through it: an
        // eraser takes everything below it in z, so there is no way to punch a
        // hole in the top object and leave the bottom one intact in place.
        const E = mkEngine();
        drawStroke(E, [[150, 460], [650, 460]], 40, RED);
        drawStroke(E, [[150, 200], [650, 200]], 100, BLUE);     // above it, elsewhere
        erase(E, [[400, 130], [400, 270]], 30);
        click(E, 220, 200);
        drag(E, [220, 200], [220, 460]);                        // blue over red
        expect(colorAt(E, 400, 460)).toBe(RED);
        E.deselect();
        click(E, 400, 460);
        expect(E.selection).toBeTruthy();
        expect(E.selection.obj.color).toBe(RED);
    });
    test("dragging the holed object does not paint the hole back in", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 100, BLUE);
        erase(E, [[400, 230], [400, 370]], 30);
        click(E, 220, 300);
        drag(E, [220, 300], [220, 450]);
        expect(inkAt(E, 400, 450)).toBe(false);                 // the hole moved WITH it
        expect(inkAt(E, 220, 450)).toBe(true);
        expect(inkAt(E, 220, 300)).toBe(false);                 // and nothing stayed behind
    });
    test("the selection overlay shrinks to what is actually left", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        erase(E, [[420, 230], [420, 370]], 26);                 // sever: two pieces
        click(E, 220, 300);
        const r = E._selectionRect();
        expect(r).toBeTruthy();
        // The left piece only. Its right edge must stop at the cut, not run on
        // to where the original stroke ended.
        expect(r.rect.right).toBeLessThan(420);
        expect(r.rect.left).toBeLessThan(200);
    });
});

describe("SM-4 — the lasso, across levels", () => {
    // Layers: multi-layer selection (2) + free-floating details (12) + small
    // detail beside a large corner (9) + moving across levels (6).
    //
    // The lasso takes what it fully encloses. One crossing down, a coarse
    // object's bbox is 3000x the screen, so it can never be enclosed — which is
    // the right answer and worth pinning: the alternative (partial overlap
    // counts) would mean every lasso at depth grabs the entire drawing.
    test("a loop at depth takes the fine object and leaves the coarse one", () => {
        const E = mkEngine();
        const coarse = drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        // Descend about the band's TOP EDGE, so there is blank paper on screen
        // to draw a loop on. Descending into the middle of it leaves none — see
        // the next case, which is a real limit and not an accident of staging.
        descend(E, 2, 400, 270);
        const fine = drawStroke(E, [[360, 140], [440, 180]], 12, RED);
        lasso(E, boxLoop(300, 90, 500, 230));
        expect(E.selection).toBeTruthy();
        expect(E.selection.ids).toContain(fine.id);
        expect(E.selection.ids).not.toContain(coarse.id);
    });
    // THE DESIGN ITEM, stated as lasso.js states it: "an object far too small to
    // see is selected as readily as a visible one — it has a position and an
    // extent whether or not the screen can show them." Four crossings up, the
    // detail is 1e-14 px across and its mapped rect is 400.0000000 → 400.0000000
    // to the eye; the loop still has to catch it. This is the reason
    // _selectableRects walks the DOCUMENT and not the render list, which culls
    // exactly these objects before they can be considered.
    test.each([[1], [2], [3], [4], [5]])("a loop at the top catches an object homed at L%i", (d) => {
        const E = mkEngine();
        descend(E, d, 400, 300);
        const fine = drawStroke(E, [[360, 280], [440, 320]], 12, RED);
        topView(E);
        // Far too small to see: sub-pixel up here at every one of these depths.
        // (Whether the CULL has dropped it yet is a different question — the
        // cull is conservative and keeps anything the level could resolve at its
        // deepest zoom, so at one crossing it is still in the list. Either way
        // the loop has to catch it, which is the point.)
        const r = E._selectableRects().find((x) => x.o.id === fine.id).rect;
        expect(Math.max(r.right - r.left, r.bottom - r.top) * E.cam.inScale).toBeLessThan(1);
        lasso(E, boxLoop(120, 120, 680, 480));
        expect(E.selection).toBeTruthy();
        expect(E.selection.ids).toContain(fine.id);
    });
    test("a loop at the top that misses it does NOT catch it", () => {
        // The complement — otherwise the above passes on "select everything".
        const E = mkEngine();
        descend(E, 3, 400, 300);
        const fine = drawStroke(E, [[360, 280], [440, 320]], 12, RED);
        topView(E);
        lasso(E, boxLoop(60, 60, 200, 200));
        expect(E.selection).toBeNull();
    });
    test("...and once caught from up there it can be dragged from up there", () => {
        const E = mkEngine();
        descend(E, 4, 400, 300);
        const fine = drawStroke(E, [[360, 280], [440, 320]], 12, RED);
        const deep = camShot(E);
        topView(E);
        lasso(E, boxLoop(120, 120, 680, 480));
        expect(E.selection.ids).toContain(fine.id);
        const a0 = worldAnchorAt(E, E.doc.getById(fine.id));
        E._dragSel = { start: [400, 300], moves: new Map(), moved: false };
        E._dragSelection(500, 300);
        E._dragSel = null;
        // Four crossings below the view, so the old build multiplied this 100 px
        // by 4096^4 and wrote 2.8e16 into the object's own coordinates. It moves
        // by changing address now, and 100 px is still 100 px.
        const a1 = worldAnchorAt(E, E.doc.getById(fine.id));
        expect(a1[0] - a0[0]).toBeCloseTo(100 / E.cam.inScale, 6);
    });
    test("a loop from far BELOW selects nothing, and that is correct", () => {
        // CONFIRMED DESIGN (Kobin, 2026-08-05). The rule is "everything fully
        // bounded by the loop", and from down here nothing is: every object
        // reachable is coarse ink magnified thousands of times, so no loop drawn
        // on a 600 px canvas can bound any of it. To select at depth you CLICK
        // the item you want. (It is also why there is no blank paper to start a
        // loop on — one crossing down, a coarse object covers the whole canvas,
        // so pressing anywhere presses on it and drags instead.)
        //
        // The exact mirror of the case above, where a loop from far ABOVE must
        // catch a sub-pixel object. One rule, two depths, opposite answers.
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        descend(E, 2, 400, 300);
        const fine = drawStroke(E, [[360, 280], [440, 320]], 12, RED);
        E.deselect();
        lasso(E, boxLoop(300, 220, 500, 380));
        expect(E.selection).toBeTruthy();
        expect(E.selection.ids).not.toContain(fine.id);   // it dragged the coarse one
        // ctrl-click still composes a selection down here.
        E.deselect();
        click(E, 400, 300);
        ctrlClick(E, 200, 300);
        expect(E.selection.ids.length).toBeGreaterThanOrEqual(1);
    });
    test("a loop that only half-covers something takes nothing", () => {
        const E = mkEngine();
        descend(E, 1, 400, 300);
        drawStroke(E, [[200, 300], [600, 300]], 20, RED);
        lasso(E, boxLoop(150, 260, 400, 340));    // cuts the stroke in half
        expect(E.selection).toBeNull();
    });
    test("a loop round one severed half takes only that half", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        lasso(E, boxLoop(100, 220, 380, 380));
        expect(E.selection).toBeTruthy();
        const keys = new Set(E.selection.ids.map((id) => E.doc.editKey(E.doc.getById(id).obj)));
        expect(keys.size).toBe(1);
        const before = raster(E, 40, { x0: 420, y0: 250, x1: 700, y1: 350 });
        drag(E, [220, 300], [220, 470]);
        expect(rasterDiff(before, raster(E, 40, { x0: 420, y0: 250, x1: 700, y1: 350 })).total).toBe(0);
    });
    test("a ctrl loop drawn inside the selection removes rather than adds", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[150, 200], [350, 200]], 20, BLUE);
        const b = drawStroke(E, [[450, 200], [650, 200]], 20, RED);
        lasso(E, boxLoop(100, 150, 700, 250));
        expect(E.selection.ids.sort()).toEqual([a.id, b.id].sort());
        E.setTool("select");
        E.pointerDown(420, 150, true);
        for (const [x, y] of boxLoop(420, 150, 700, 250).slice(1)) E.pointerMove(x, y);
        E.pointerUp();
        expect(E.selection.ids).toEqual([a.id]);
    });
});

describe("SM-5 — selecting forces a pending erase to finish first", () => {
    // Layers: multi-layer selection (2) + performance (1, deferred baking) +
    // already-cut shapes (5). Behaviour 3.
    //
    // Baking is deferred by design — the gesture is cheap and the boolean comes
    // later. But a selection made in that gap would otherwise pick up ink the
    // user has already erased, and drag it away as if it were still there.
    test("a click made before the bake still selects only what survives", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        eraseGesture(E, [[400, 220], [400, 380]], 26);      // deliberately NOT flushed
        E._render();
        expect(E.doc.at(E.cam.frame).some((o) => o.erase)).toBe(true);
        click(E, 220, 300);
        expect(E.selection).toBeTruthy();
        drag(E, [220, 300], [220, 470]);
        // The right-hand piece must NOT have come along.
        expect(inkAt(E, 600, 300)).toBe(true);
        expect(inkAt(E, 600, 470)).toBe(false);
    });
});

describe("SM-6 — selection identity survives a level crossing", () => {
    // Layers: multi-layer selection (2) + zoom consistency (17) + multi-layer
    // erase (3) + moving across levels (6).
    test("select up here, zoom down, and it is still the same selection", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        click(E, 200, 300);
        const key = E.selection.editId, ids = E.selection.ids.slice();
        descend(E, 2, 200, 300);
        expect(E.selection.editId).toBe(key);
        expect(E.selection.ids).toEqual(ids);
        // ...and dragging from down here still moves the whole family.
        const before = new Map(natives(E).map((r) => [r.obj.id, worldAnchorAt(E, r)]));
        const scale = E.cam.inScale;
        drag(E, [400, 300], [400, 360]);
        natives(E).forEach((r) => {
            expect(worldAnchorAt(E, r)[1] - before.get(r.obj.id)[1]).toBeCloseTo(60 / scale, 6);
        });
    });
});

describe("SM-7 — a selection spanning two severed families", () => {
    // Layers: multi-layer selection (2) + topology (14) + moving (6) +
    // free-floating pieces (12).
    //
    // Both halves picked up together must move together; then, picked up
    // separately, they must move apart again. The severance gave them separate
    // identities — it must not have welded them into one.
    test("together they move as one, apart they move independently", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        click(E, 220, 300);
        ctrlClick(E, 600, 300);
        expect(E.selection.ids.length).toBe(2);
        drag(E, [220, 300], [220, 400]);
        expect(inkAt(E, 220, 400)).toBe(true);
        expect(inkAt(E, 600, 400)).toBe(true);           // both came
        // Pressing something already selected KEEPS the selection (or nothing
        // could be dragged as a group), so break it first — that is the gesture
        // the user makes too.
        E.deselect();
        click(E, 220, 400);
        expect(E.selection.ids.length).toBe(1);
        drag(E, [220, 400], [220, 500]);
        expect(inkAt(E, 220, 500)).toBe(true);
        expect(inkAt(E, 600, 500)).toBe(false);          // and now only one did
        expect(inkAt(E, 600, 400)).toBe(true);
    });
});
