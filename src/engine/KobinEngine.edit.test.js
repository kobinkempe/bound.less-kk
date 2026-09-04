/**
 * Selection / edit (US-10, roadmap 7) + boolean erase (true erase) — engine
 * behaviour: tap-select, drag-move (same-level and cross-level),
 * coalesced undo, delete; the AREA eraser (painted ink minus the swept
 * capsule — strokes bake to outline fills), undo/redo round-trip, z-order
 * preservation, fat/magnified strokes getting real holes; and the
 * move/edit tile-invalidation (no ghost ink after editing what a tile baked).
 */
import { HALF_W } from "./frameLattice";
import KobinEngine from "./KobinEngine";
import Document from "./Document";
import { contactArcs } from "./geometry/connect";
import { loopsBBox, insideShape, shapeFromRings, normalizeLoops } from "./geometry/arcShape";

jest.setTimeout(30000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const drawStroke = (E, pts) => {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();   // a stroke RESOLVES into its perimeter shortly after pen-up
};
// One accessor for either representation. A stroke keeps `pts` only until its
// perimeter resolves; after that the object IS the perimeter and the honest way
// to say "where is it" is its bounding box.
const boxOf = (o) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const eat = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    if (o.type === "shape") { const b = loopsBBox(o.loops); return b ? { ...b } : null; }
    if (o.type === "fill") { for (const r of o.polys) for (const q of r) eat(q[0], q[1]); }
    else for (const q of o.pts) eat(q[0], q[1]);
    return { x0, y0, x1, y1 };
};
const nearBox = (o, b, digits = 6) => {
    const g = boxOf(o);
    for (const k of ["x0", "y0", "x1", "y1"]) expect(g[k]).toBeCloseTo(b[k], digits);
};
const countNatives = (E) => Object.values(E.nativesByLevel).reduce((a, arr) => a + arr.length, 0);
const zoomToLevel1 = (E) => {
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
    expect(E.activeLevel).toBeGreaterThanOrEqual(1);
};

describe("selection", () => {
    test("tap selects the topmost object; empty tap deselects", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 200]]);
        drawStroke(E, [[100, 200], [200, 100]]); // crosses the first at (150,150)
        const [a, b] = E.nativesByLevel[0];
        E.setTool("select");
        E.pointerDown(150, 150); E.pointerUp();       // both hit -> topmost (later id)
        expect(E.selection && E.selection.id).toBe(b.id);
        E.pointerDown(110, 110); E.pointerUp();       // only the first stroke
        expect(E.selection.id).toBe(a.id);
        E.pointerDown(700, 500); E.pointerUp();       // empty canvas
        expect(E.selection).toBeNull();
    });

    test("drag moves the native, one undo op restores it exactly", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [150, 150]]);
        E.setTool("select");
        E.pointerDown(120, 120); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(120, 120);
        E.pointerMove(160, 140);
        E.pointerMove(180, 160);
        E.pointerUp();
        // The stroke is 13 wide, so its shape reaches 6.5 past each end.
        const moved = { x0: 153.5, y0: 133.5, x1: 216.5, y1: 196.5 };
        const home = { x0: 93.5, y0: 93.5, x1: 156.5, y1: 156.5 };
        nearBox(E.nativesByLevel[0][0], moved, 4);
        E.undo(); // the whole drag is ONE op
        nearBox(E.nativesByLevel[0][0], home, 4);
        E.redo();
        nearBox(E.nativesByLevel[0][0], moved, 4);
    });

    test("move keeps the spatial index in sync", () => {
        const d = new Document();
        const o = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0], [10, 10]], lwFrame: 2, color: "#000", opacity: 1, paths: [] };
        d.add(o, 0);
        d.moveById(o.id, 1000, 0);
        expect(d.queryRect(0, { left: -20, top: -20, right: 30, bottom: 30 })).toHaveLength(0);
        expect(d.queryRect(0, { left: 990, top: -20, right: 1030, bottom: 30 }).some((q) => q.id === o.id)).toBe(true);
    });

    test("deleteSelection removes the object, drops the selection, and undoes", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150]]);
        const id = E.nativesByLevel[0][0].id;
        E.setTool("select");
        E.pointerDown(150, 125); E.pointerUp();
        expect(E.deleteSelection()).toBe(true);
        expect(E.selection).toBeNull();
        expect(countNatives(E)).toBe(0);
        E.undo();
        expect(E.nativesByLevel[0][0].id).toBe(id);
    });

    test("selecting an inherited piece selects the NATIVE and drags it cross-level", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        const before = boxOf(E.nativesByLevel[0][0]);
        zoomToLevel1(E);
        E.setTool("select");
        E.pointerDown(400, 300); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        expect(E.selection).not.toBeNull();
        expect(E.selection.level).toBe("0"); // the native's home FRAME id, not the active level
        E.pointerDown(400, 300);
        E.pointerMove(430, 300);
        E.pointerUp();
        const after = boxOf(E.nativesByLevel[0][0]);
        expect(after.x0).not.toBe(before.x0);                // it moved...
        expect(Math.abs(after.x0 - before.x0)).toBeLessThan(1); // ...by a sub-frame-unit amount (30px / ~3000)
        expect(after.y0).toBeCloseTo(before.y0, 6);          // x-only drag
        E.undo();
        expect(boxOf(E.nativesByLevel[0][0]).x0).toBeCloseTo(before.x0, 9);
    });

    test("selection drops automatically when the object is erased out from under it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150]]);
        E.setTool("select");
        E.pointerDown(150, 125); E.pointerUp();
        expect(E.selection).not.toBeNull();
        E.setTool("erase");
        E.pointerDown(150, 125); E.pointerUp();
        expect(E.selection).toBeNull();
    });

    test("editing an object a coarser tile baked leaves no ghost (move invalidation)", () => {
        const E = mkEngine();
        drawStroke(E, [[350, 300], [450, 300]]); // straight through the zoom anchor: taps can't miss
        const id = E.nativesByLevel[0][0].id;
        zoomToLevel1(E);
        expect(E._objs().some((o) => o.id === id)).toBe(true); // baked into view
        for (let i = 0; i < 40 && E.activeLevel > 0; i++) E.zoomAt(400, 300, 1000); // back out
        expect(E.activeLevel).toBe(0);
        let g = 0; // settle in-level near the original framing (no crossing below 0)
        while (E.inScale > 1.2 && g++ < 20) E.zoomAt(400, 300, 1000);
        E.setTool("select");
        E.pointerDown(400, 300); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        expect(E.selection && E.selection.id).toBe(id);
        E.pointerDown(400, 300);
        E.pointerMove(700, 300); // drag far right, out of the old neighbourhood
        E.pointerUp();
        zoomToLevel1(E); // same spot as before
        expect(E._objs().some((o) => o.id === id)).toBe(false); // no stale ink
    });

});

describe("the eraser after the line tool (2026-09-03)", () => {
    test("the eraser trail stays freehand: every sample is kept", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]]);
        E.setPenType("straight");
        E.setTool("erasePartial");
        E.pointerDown(200, 250);
        for (const p of [[300, 350], [400, 250], [500, 350]]) E.pointerMove(p[0], p[1]);
        // The line tool replaces its second point on every move; the eraser
        // must not, or it erases along a straight line however the finger went.
        expect(E._drawing.pts.length).toBe(4);
        E.pointerUp();
    });
});

describe("deferred area erase", () => {
    // Total inked bbox of a fill piece.
    const eraseGesture = (E, pts) => {
        E.setTool("erasePartial");
        E.pointerDown(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
        E.pointerUp();
    };

    test("the gesture commits instantly as background ink — no geometry work", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        const src = E.nativesByLevel[0][0];
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]);
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2);              // untouched stroke + eraser ink
        expect(natives[0]).toBe(src);                 // literally untouched
        const trail = natives[1];
        expect(trail.erase).toBe(true);
        expect(trail.type).toBe("stroke");
        expect(trail.color).toBe("#ffffff");
        expect(trail.lwFrame).toBeCloseTo(26, 9);     // 2 × eraser radius
        // The white ink is invisible to picking — the covered stroke is hit.
        expect(E._hitTest(400, 300)).toBe(src.id);
    });

    test("one undo removes the whole eraser stroke; redo brings it back", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        eraseGesture(E, [[350, 300], [400, 300], [450, 300]]);
        expect(E.nativesByLevel[0]).toHaveLength(2);
        E.undo(); // ONE op for the whole gesture
        expect(E.nativesByLevel[0]).toHaveLength(1);
        // The ink is back as the RESOLVED shape it had become before the erase.
        // Undo restores what was there, not what was there two steps earlier.
        expect(E.nativesByLevel[0][0].type).toBe("shape");
        expect(E.nativesByLevel[0][0].erase).toBeUndefined();
        E.redo();
        expect(E.nativesByLevel[0].filter((o) => o.erase)).toHaveLength(1);
        E.undo(); E.undo(); // un-erase, then undo the draw itself
        expect(countNatives(E)).toBe(0);
    });

    test("baking splits the ink at the eraser edge and consumes the white stroke", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]); // lwFrame 13
        const src = E.nativesByLevel[0][0];
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2);              // two pieces, eraser consumed
        const boxes = natives.map((p) => boxOf(p)).sort((a, b) => a.x0 - b.x0);
        // Kept ink's inner edges: 400 ∓ sqrt(13² − 6.5²) ≈ 400 ∓ 11.26.
        expect(boxes[0].x0).toBeCloseTo(293.5, 0);
        expect(boxes[0].x1).toBeGreaterThan(387);   // ±~1.5px: the eraser dot is a
        expect(boxes[0].x1).toBeLessThan(390.5);    // polygonized offset circle
        expect(boxes[1].x0).toBeGreaterThan(409.5);
        expect(boxes[1].x0).toBeLessThan(413);
        expect(boxes[1].x1).toBeCloseTo(506.5, 0);
        for (const p of natives) {
            expect(p.type).toBe("shape");
            expect(p.erase).toBeUndefined();
            expect(p.z).toBe(src.id);                 // pieces at the original's depth
            expect(p.color).toBe(src.color);
        }
    });

    test("undo AFTER baking still reverts the whole gesture in one step", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        const id = E.nativesByLevel[0][0].id;
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        expect(E.nativesByLevel[0].map((o) => o.type)).toEqual(["shape", "shape"]);
        E.undo(); // one op: un-bakes AND removes the (consumed) eraser stroke
        expect(E.nativesByLevel[0]).toHaveLength(1);
        expect(E.nativesByLevel[0][0].id).toBe(id);
        expect(E.nativesByLevel[0][0].type).toBe("shape");
        nearBox(E.nativesByLevel[0][0], { x0: 293.5, y0: 293.5, x1: 506.5, y1: 306.5 }, 4);
        E.redo(); // re-applies the bake (the white stroke stays consumed)
        expect(E.nativesByLevel[0].map((o) => o.type).sort()).toEqual(["shape", "shape"]);
        E.undo(); E.undo();
        expect(countNatives(E)).toBe(0);
    });

    test("selection is barred until the touched object bakes", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]);
        E.setTool("select");
        // Selecting the surviving left half forces THIS object's bake first.
        E.pointerDown(320, 300); E.pointerUp();
        expect(E.selection).not.toBeNull();
        expect(E.selection.obj.type).toBe("shape");
        // The erased gap is genuinely empty to selection.
        E.pointerDown(400, 300); E.pointerUp();
        expect(E.selection).toBeNull();
    });

    test("an eraser that covers the whole stroke removes the object on bake", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 300], [420, 300]]);
        E.setEraserSize(90);
        eraseGesture(E, [[410, 300]]);
        E.flushErases();
        expect(countNatives(E)).toBe(0);
        E.undo();
        expect(countNatives(E)).toBe(1);
        nearBox(E.nativesByLevel[0][0], { x0: 393.5, y0: 293.5, x1: 426.5, y1: 306.5 }, 4);
    });

    test("one gesture bakes into every stroke beneath it", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 295], [500, 295]]);
        drawStroke(E, [[300, 305], [500, 305]]);
        E.setEraserSize(16);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        expect(E.nativesByLevel[0]).toHaveLength(4); // each split in two
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("shape");
    });

    test("the swept trail erases along its whole path", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 200], [400, 400]]); // vertical stroke
        E.setEraserSize(10);
        eraseGesture(E, [[300, 300], [500, 300]]);
        E.flushErases();
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2); // split above/below the sweep
        const boxes = natives.map((p) => boxOf(p)).sort((a, b) => a.y0 - b.y0);
        expect(boxes[0].y1).toBeLessThan(300);
        expect(boxes[1].y0).toBeGreaterThan(300);
    });

    test("baked pieces keep the original's z-order under later strokes", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);              // A (bottom)
        drawStroke(E, [[400, 200], [400, 400]]);              // B (top, crosses A)
        const idB = E.nativesByLevel[0][1].id;
        eraseGesture(E, [[320, 300]]);                        // erase A away from B
        E.flushErases();
        const order = E._objs().map((o) => (o.z != null ? o.z : o.id));
        expect(order).toEqual([...order].sort((a, b) => a - b)); // render list sorted by z
        const zs = E._objs().filter((o) => o.id !== idB).map((o) => o.z);
        expect(zs.length).toBeGreaterThan(0);
        for (const z of zs) expect(z).toBeLessThan(idB);      // pieces still BELOW B
    });

    test("a magnified fat stroke gets a real hole nicked through it — by CEDING A TILE", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        const key = E.nativesByLevel[0][0].id;   // a plain object keys on its id
        zoomToLevel1(E); // the stroke is now thousands of px wide on screen
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        // The level-0 source IS rewritten, and the distinction that makes that
        // safe is the whole basis of the design: what gets cut out of it is the
        // TILE, 1/3000 of its own frame and perfectly representable — never the
        // erase, which is thousands of times finer still and is what used to
        // quantize the object into facets. It is outlined to a fill to be cut,
        // and it keeps its identity across that.
        const parents = E.nativesByLevel[0];
        expect(parents.length).toBeGreaterThanOrEqual(1);
        for (const p of parents) {
            expect(p.type).toBe("shape");
            expect(E.doc.editKey(p)).toBe(key);
            expect(p.attachRect).toBeUndefined();   // still homed here
        }
        // The ink that was inside the tile re-homes as fills of the erase level,
        // each recording the tile it fills, in its own frame.
        const kids = E.nativesByLevel[E.cam.frame] || [];
        expect(kids.length).toBeGreaterThanOrEqual(1);
        for (const k of kids) {
            expect(k.type).toBe("shape");
            expect(E.doc.editKey(k)).toBe(key);
            expect(k.attachRect).toBeTruthy();
        }
        // The erased spot is really empty: no object's ink covers it now.
        expect(E._hitTest(400, 300)).toBeNull();
        // ...and just outside the cut the ink is still there.
        expect(E._hitTest(400, 330)).not.toBeNull();
        E.undo(); // the tile goes back into the parent and the children go away
        expect(E.nativesByLevel[0]).toHaveLength(1);
        expect(E.nativesByLevel[0][0].type).toBe("shape");
        expect(E.doc.editKey(E.nativesByLevel[0][0])).toBe(key);
        expect(E.nativesByLevel[E.cam.frame] || []).toHaveLength(0);
    });

    test("a far-frame cede outlines the eraser locally before its boolean", () => {
        const E = mkEngine();
        const src = {
            type: "stroke", origin: "native", id: E.doc.allocId(), z: 1,
            pts: [[-100, 0], [100, 0]], lwFrame: 1000,
            color: "#000", opacity: 1, paths: [],
        };
        E.doc.add(src, "0");
        // Put the eraser as far from the child frame's origin as the lattice
        // allows — hard against the cell edge at HALF_W — and make it 16 units
        // wide there. This used to be written at 1e9, because a frame could then
        // be anchored anywhere and its useful coordinates ran that large; at
        // that magnitude the old global-coordinate outline rounded a 16-unit
        // eraser below the integer backend's grid and returned empty. A cell is
        // bounded to [-W/2, W/2) now, so HALF_W IS the worst case, and the ratio
        // that mattered — pen width against distance from the origin — is still
        // the thing under test.
        const child = E.lm.cellChild("0", 0, 0);
        const far = HALF_W - 4096;
        const eraser = {
            type: "stroke", origin: "native", id: E.doc.allocId(), z: 2,
            pts: [[far - 100, 0], [far + 100, 0]], lwFrame: 16,
            color: "#fff", opacity: 1, paths: [], erase: true, bakePx: 1,
        };
        E.doc.add(eraser, child.id);

        expect(E._bakeOne({ obj: eraser, level: child.id }, { obj: src, level: "0" })).toBe(true);
        // The source is cut and its child exists in the far frame, in the same
        // family — `src.id` still names it, because a one-region replace keeps
        // the key even though the object itself was swapped for a fill.
        const parents = E.doc.at("0").filter((o) => !o.erase);
        expect(parents.length).toBeGreaterThanOrEqual(1);
        expect(parents.every((o) => o.type === "shape" && E.doc.editKey(o) === src.id)).toBe(true);
        expect(E.doc.at(child.id).some((o) => !o.erase && o.attachRect && E.doc.editKey(o) === src.id)).toBe(true);
    });

    test("a ceded hole survives zooming out and back in", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        zoomToLevel1(E);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        expect(E._hitTest(400, 300)).toBeNull();
        // Out to the source's own level. The ceded tile is still tens or
        // hundreds of screen pixels immediately after this crossing, so the
        // parent has to show its hole here while downContent supplies the child.
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 40) E.zoomAt(400, 300, 1000);
        expect(E.activeLevel).toBe(0);
        E._render();
        expect(E._hitTest(400, 300)).toBeNull();
        // At its OWN frame the parent renders as itself — the identical object,
        // not a per-view re-derivation of it. That is what makes the picture
        // impossible to get stale: there is no second copy to fall behind.
        const source = E.nativesByLevel[0][0];
        expect(E._objs()).toContain(source);
        // Back in — the hole is still exactly where it was, at full fidelity.
        zoomToLevel1(E);
        E._render();
        expect(E._hitTest(400, 300)).toBeNull();
        expect(E._hitTest(400, 330)).not.toBeNull();
    });

    test("a ceded FILL keeps its cutout when its own parent frame activates", () => {
        const E = mkEngine();
        const src = {
            type: "fill", origin: "native", id: E.doc.allocId(), z: 1,
            polys: [[[360, 260], [440, 260], [440, 340], [360, 340]]],
            color: "#000", opacity: 0.45, paths: [],
        };
        E.doc.add(src, "0");
        E._render();
        zoomToLevel1(E);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        // Translucent ink: parent and child overlap along the tile edge to hide
        // the antialiasing seam, so they must composite as ONE opacity group or
        // the overlap darkens. That is what the shared family key buys.
        const kids = (E.nativesByLevel[E.cam.frame] || []).filter((o) => !o.erase);
        expect(kids.length).toBeGreaterThan(0);
        expect(kids.every((o) => E.doc.editKey(o) === src.id)).toBe(true);
        expect(E._hitTest(400, 300)).toBeNull();

        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 40) E.zoomAt(400, 300, 1000);
        expect(E.activeLevel).toBe(0);
        E._render();
        expect(E._hitTest(400, 300)).toBeNull();
        // The cut parent and its minified child are both on screen and both
        // carry the family key, so Renderer groups them together.
        expect(E._objs().some((o) => E.doc.editKey(o) === src.id && o.attachRect == null)).toBe(true);
        expect(E._objs().some((o) => o.editId === src.id)).toBe(true);
    });

    test("a patch touching the ceded tile's edge stays in the family; an enclosed one comes loose", () => {
        // The rule the whole design turns on, at the document level: everything
        // a cede produces starts in ONE family, and whether the family is still
        // one OBJECT is a separate question asked over the whole of it. A patch
        // that reaches the ceded tile's boundary still meets its parent there; a
        // patch the erase enclosed entirely does not, and is a new object.
        const d = new Document();
        const src = { type: "fill", origin: "native", id: d.allocId(),
            polys: [[[0, 0], [100, 0], [100, 100], [0, 100]]], color: "#000", opacity: 1, paths: [] };
        d.add(src, "0");
        const key = src.id;
        const attached = [[[10, 20], [40, 20], [40, 80], [10, 80]]];   // reaches the hole's left edge
        const offshoot = [[[50, 40], [60, 40], [60, 50], [50, 50]]];   // floats in the middle
        const step = d.cedeTileById(src.id, "1",
            [normalizeLoops(shapeFromRings(attached)), normalizeLoops(shapeFromRings(offshoot))],
            { x0: 10, y0: 10, x1: 90, y1: 90 }, { x0: 10, y0: 10, x1: 90, y1: 90 });
        expect(step).toBeTruthy();
        // Parents and children alike: one family, keyed on the original.
        for (const p of step.pieces) expect(d.editKey(p.obj)).toBe(key);
        expect(d.editGroup(key).length).toBe(step.pieces.length);
        // The parent really is cut — a square with an 80×80 bite out of it is a
        // ring, one connected piece, and its ink is gone from the middle.
        expect(step.parents).toHaveLength(1);
        // The parent is promoted to a resolved shape to be cut — that promotion
        // is what makes the cut exact — so ask it directly.
        expect(insideShape(step.parents[0].obj.loops, [50, 50], 100)).toBe(false);
        expect(insideShape(step.parents[0].obj.loops, [5, 50], 100)).toBe(true);
        // The family is durable, not a runtime-only cache.
        const d2 = new Document();
        d2.loadNatives(JSON.parse(JSON.stringify(d.serializeNatives())));
        expect(d2.editGroup(key)).toHaveLength(step.pieces.length);
    });

    test("boolean-grid rounding cannot detach a patch that touches its ceded tile", () => {
        // Captured from the browser: each corner rounded just outside the rect
        // on BOTH axes, so a check at float epsilon missed every contact — and
        // missing a contact is the dangerous direction, because it severs an
        // object that is still whole and the user cannot put it back.
        //
        // The question moved (contactArcs answers it now, over normalized
        // perimeter arcs rather than a boolean) but the arithmetic that has to
        // survive is the same: judge contact at CLIPPER'S LATTICE STEP, which
        // here is 1e-3 units, and not at float epsilon, which is 4.3e-4 too
        // fine to see any of these four corners.
        const W = { x0: 1601.895752866762, y0: 1830.7380032763274,
            x1: 2032.6576359906499, y1: 3405.711138448042 };
        const rounded = [[
            [1601.8956944287058, 1830.7375708621848],
            [2032.657694428706, 1830.7375708621848],
            [2032.657694428706, 3405.711570862185],
            [1601.8956944287058, 3405.711570862185],
        ]];
        const off = Math.max(Math.abs(rounded[0][0][0] - W.x0), Math.abs(rounded[0][0][1] - W.y0));
        expect(off).toBeGreaterThan(Math.max(W.x1 - W.x0, W.y1 - W.y0) * 1e-9);  // invisible at float eps
        expect(off).toBeLessThan(2e-3);                                          // visible at the lattice step
        expect(contactArcs(rounded, W, 2e-3).length).toBeGreaterThan(0);
        const detached = rounded.map((ring) => ring.map(([x, y]) => [x + 10, y + 10]));
        expect(contactArcs(detached, W, 2e-3)).toHaveLength(0);
    });

    test("selecting a ceded boundary patch moves, deletes and undoes the whole attached family", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        const key = E.nativesByLevel[0][0].id;
        zoomToLevel1(E);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        const kids = (E.nativesByLevel[E.cam.frame] || []).filter((o) => !o.erase && o.editId === key);
        expect(kids.length).toBeGreaterThan(0);
        // The parent is a cut fill now, not the original stroke, but it is the
        // same object: it kept the key across the outline.
        const parent = E.nativesByLevel[0].find((o) => E.doc.editKey(o) === key);
        expect(parent).toBeTruthy();
        E._render();
        expect(E.renderer._groups.has(key)).toBe(true);
        for (const kid of kids) expect(E.renderer._groups.has(kid.id)).toBe(false); // one opacity group, no transparent seam
        const beforeParent = boxOf(parent);
        const beforeKid = boxOf(kids[0]);
        const beforeAttach = { ...kids[0].attachRect };

        E.setTool("select");
        E.pointerDown(400, 330); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        expect(E.selection && E.selection.editId).toBe(key);
        E.pointerDown(400, 330);
        E.pointerMove(430, 330); E.pointerUp();
        // Parent, child and the doorway between them all move together — the
        // attachRect is where the two meet, so a move that left it behind would
        // sever the object the next time anything asked.
        expect(boxOf(parent)).not.toEqual(beforeParent);
        expect(boxOf(kids[0])).not.toEqual(beforeKid);
        expect(kids[0].attachRect).not.toEqual(beforeAttach);
        E.undo();
        nearBox(parent, beforeParent, 9);
        nearBox(kids[0], beforeKid, 6);
        expect(kids[0].attachRect).toEqual(beforeAttach);

        const familyCount = E.doc.editGroup(key).length;
        E.deleteSelection();
        expect(E.doc.editGroup(key)).toHaveLength(0);
        E.undo();
        expect(E.doc.editGroup(key)).toHaveLength(familyCount);
    });

    test("moving a straight-band rehome carries its cutout instead of leaving boundary patches behind", () => {
        // Mirrors the narrow live editor viewport that first exposed this.
        const E = mkEngine(407, 765);
        drawStroke(E, [[150, 390], [350, 390]]);
        const src = E.nativesByLevel[0][0];
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 60) E.zoomAt(270, 390, -1000);
        expect(E.activeLevel).toBe(1);
        E.setEraserSize(16);
        const trail = Array.from({ length: 80 }, (_, i) => [
            270.17 + 0.31 * Math.sin(i / 5),
            300.13 + (170.29 * i) / 79,
        ]);
        eraseGesture(E, trail);
        E.flushErases();
        expect(E._hitTest(270, 390)).toBeNull();

        const kids = E.nativesByLevel[E.cam.frame] || [];
        expect(kids.length).toBeGreaterThan(0);
        expect(kids.every((o) => o.editId === src.id)).toBe(true);
        E._render();
        const sigBefore = E.renderer._groups.get(src.id).sig;

        E.setTool("select");
        E.pointerDown(330, 380); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        expect(E.selection && E.selection.editId).toBe(src.id);
        E.pointerDown(330, 380);
        E.pointerMove(360, 420); E.pointerUp();
        E._render();
        expect(E.renderer._groups.get(src.id).sig).not.toBe(sigBefore);

        // The old cutout is filled again and the whole family owns the new one.
        expect(E._hitTest(270, 390)).not.toBeNull();
        expect(E._hitTest(300, 430)).toBeNull();
        E.undo();
        expect(E._hitTest(270, 390)).toBeNull();
    });

    test("a coarse erase over a zoomed-out re-home family does not resurrect or double-stack its fine patch", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        zoomToLevel1(E);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        const fineState = JSON.parse(JSON.stringify(E.doc.serializeNatives()));

        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 40) E.zoomAt(400, 300, 1000);
        expect(E.activeLevel).toBe(0);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        const ids = Object.values(E.nativesByLevel).flat().map((o) => o.id);
        expect(new Set(ids).size).toBe(ids.length);
        E.undo();
        expect(E.doc.serializeNatives()).toEqual(fineState);
    });

    test("a moved re-home family survives coarse erase undo and returns with its fine cutout", () => {
        const E = mkEngine(1280, 720);
        E.setWidth(12);
        drawStroke(E, [[150, 390], [190, 390], [230, 390], [270, 390], [310, 390], [350, 390]]);
        E.zoomAt(270, 390, -8800);
        E.setEraserSize(16);
        eraseGesture(E, [[270, 300], [270, 340], [270, 380], [270, 420], [270, 470]]);
        E.flushErases();
        expect(E._hitTest(270, 390)).toBeNull();

        E.setTool("select");
        E.pointerDown(330, 380); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(330, 380); E.pointerMove(360, 420); E.pointerUp();
        expect(E._hitTest(300, 430)).toBeNull();
        const fineState = JSON.parse(JSON.stringify(E.doc.serializeNatives()));

        E.zoomAt(300, 430, 8800);
        expect(E.activeLevel).toBe(0);
        eraseGesture(E, [[300, 390], [300, 410], [300, 430], [300, 450], [300, 470]]);
        E.flushErases();
        E.undo();
        expect(E.doc.serializeNatives()).toEqual(fineState);

        E.zoomAt(300, 430, -8800);
        E._render();
        expect(E._hitTest(300, 430)).toBeNull();
    });

    test("overlapping fine erase windows compose, and one undo removes only the newer bite", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        zoomToLevel1(E);
        eraseGesture(E, [[395, 300]]);
        E.flushErases();
        const first = JSON.parse(JSON.stringify(E.doc.serializeNatives()));
        eraseGesture(E, [[410, 300]]); // overlaps the first window substantially
        E.flushErases();
        const ids = Object.values(E.nativesByLevel).flat().map((o) => o.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(E._hitTest(395, 300)).toBeNull();
        expect(E._hitTest(410, 300)).toBeNull();
        E.undo();
        expect(E.doc.serializeNatives()).toEqual(first);
        expect(E._hitTest(395, 300)).toBeNull();
    });

    test("erasing an already-baked piece subtracts again", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        E.setEraserSize(13);
        eraseGesture(E, [[340, 300]]);
        E.flushErases();
        expect(E.nativesByLevel[0]).toHaveLength(2);
        eraseGesture(E, [[440, 300]]); // second gesture bites the right-hand FILL
        E.flushErases();
        expect(E.nativesByLevel[0]).toHaveLength(3);
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("shape");
    });

    test("a PENDING eraser stroke survives save/load and resumes baking", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        const srcId = E.nativesByLevel[0][0].id;
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]); // no flush — still pending
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "pending" })));
        const E2 = mkEngine();
        E2.loadDrawing(doc);
        const loaded = E2.nativesByLevel[0];
        expect(loaded).toHaveLength(2);
        const trail = loaded.find((o) => o.erase);
        expect(trail).toBeTruthy();                   // the flag survived the file
        expect(trail.bakePx).toBeCloseTo(1, 9);
        E2.flushErases();                             // ...and still bakes after reload
        const pieces = E2.nativesByLevel[0];
        expect(pieces).toHaveLength(2);
        for (const p of pieces) {
            expect(p.type).toBe("shape");
            expect(p.z).toBe(srcId);
        }
    });

    test("a bake resumed after load is RECORDED — one undo reverts it", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]); // pending — not yet baked
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "p" })));
        const E2 = mkEngine();
        E2.loadDrawing(doc);
        expect(E2.doc.canUndo()).toBe(false);  // a load starts a clean history
        E2.flushErases();                       // resumed bake re-registers its op
        expect(E2.nativesByLevel[0].map((o) => o.type).sort()).toEqual(["shape", "shape"]);
        expect(E2.doc.canUndo()).toBe(true);    // ...so it is undoable
        E2.undo();
        const after = E2.nativesByLevel[0];
        expect(after).toHaveLength(1);
        expect(after[0].type).toBe("shape");
        nearBox(after[0], { x0: 293.5, y0: 293.5, x1: 506.5, y1: 306.5 }, 4);
    });

    test("stale erase replays can never double-stack ink (doc-level guards)", () => {
        // Deferred baking means an op's recorded objects can be consumed by a
        // LATER erase while the op sits mid-stack. Replaying it blindly used
        // to resurrect stale copies on top of the newer bake's pieces.
        const d = new Document();
        const src = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0], [100, 0]], lwFrame: 10, color: "#000", opacity: 1, paths: [] };
        d.add(src, 0);
        // Regions handed to eraseReplaceById are LOOPS now, one group per piece.
        const region = (x1) => normalizeLoops(shapeFromRings([[[0, -5], [x1, -5], [x1, 5], [0, 5]]]));
        const cut1 = d.eraseReplaceById(src.id, [region(40)]);
        const op1 = {
            op: "eraseCommit", strokeId: 9999, strokeRec: null,
            baked: [{ removed: cut1.removed, pieces: cut1.pieces.map((obj) => ({ obj, level: "0" })) }],
        };
        d._invert(op1);                                  // undo: piece out, src back
        expect(d.at("0").map((o) => o.id)).toEqual([src.id]);
        const cut2 = d.eraseReplaceById(src.id, [region(60)]); // later erase consumes src
        d._invert(op1);                                  // stale REDO replay of op1
        const ids = d.at("0").map((o) => o.id);
        expect(ids).toEqual([cut2.pieces[0].id]);        // only the later bake's piece
        expect(ids).not.toContain(src.id);               // no resurrected source...
        expect(ids).not.toContain(cut1.pieces[0].id);    // ...and no stale piece
        // And the mirrored guard: un-baking a step whose pieces are already
        // gone must not resurrect the source over their replacement.
        const op2 = {
            op: "eraseCommit", strokeId: 9998, strokeRec: null,
            baked: [{ removed: cut1.removed, pieces: cut1.pieces.map((obj) => ({ obj, level: "0" })) }],
        };
        d._invert(op2);                                  // pieces absent -> src must stay out
        expect(d.at("0").map((o) => o.id)).toEqual([cut2.pieces[0].id]);
    });

    test("eraser-made fills Kobinize at a crossing: chopped to tile size, ink/hole preserved", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        E.setEraserSize(13);
        eraseGesture(E, [[400, 300]]);
        E.flushErases(); // two level-0 fill pieces
        // Zoom INTO the left piece's ink (not the gap) across a crossing.
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 60) E.zoomAt(330, 300, -1000);
        expect(E.activeLevel).toBeGreaterThanOrEqual(1);
        const g = E.lm.grid(E.cam.frame);
        // An inherited piece is a SHAPE now — the magnify chain carries arcs and
        // flattens nothing, because whatever a tile holds is what the next level
        // down inherits (F-A). A solid flood is still a quad fill.
        const derived = E._objs().filter((o) => o.origin === "inherited");
        expect(derived.length).toBeGreaterThan(0);
        for (const p of derived) {
            const b = p.type === "shape" ? loopsBBox(p.loops) : (() => {
                let x0 = 1 / 0, y0 = 1 / 0, x1 = -1 / 0, y1 = -1 / 0;
                for (const r of p.polys) for (const [x, y] of r) {
                    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
                }
                return { x0, y0, x1, y1 };
            })();
            // BOUNDED BY THE TILE GRID, never by the (much larger) source
            // object — which is the property, and it is what stops a
            // screen-sized eraser mark being stored whole in every square it
            // touches.
            //
            // The bound is the grid and not one square of it. A frame cuts
            // nothing (bible 10.4): geometry is clipped to a whole number of the
            // OBJECT's tiles, and a cache square plus its seam pad can reach
            // three of them per axis when it happens to straddle two boundaries.
            // The source object here is thousands of times larger than any of
            // that, so the assertion still says what it was written to say.
            expect(b.x1 - b.x0).toBeLessThanOrEqual(g.w * 3.02);
            expect(b.y1 - b.y0).toBeLessThanOrEqual(g.h * 3.02);
        }
        // Deep inside the piece the covered tiles must still paint its ink.
        expect(E._hitTest(330, 300)).not.toBeNull();
    });

    test("REGRESSION: baked fills render when zooming back OUT (projectF/bake-down)", () => {
        const E = mkEngine();
        zoomToLevel1(E);
        drawStroke(E, [[350, 280], [450, 320]]); // homes in the level-1 frame
        eraseGesture(E, [[400, 300]]);
        E.flushErases(); // fills now live in a DEEPER frame than level 0
        expect(() => {
            let guard = 0;
            while (E.activeLevel > 0 && guard++ < 60) E.zoomAt(400, 300, 1000);
        }).not.toThrow(); // TileStore._bakeDown used to crash on fill natives
        expect(E.activeLevel).toBe(0);
    });
});
