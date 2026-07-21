/**
 * Selection / edit (US-10, roadmap 7) + boolean erase (true erase) — engine
 * behaviour: tap-select, drag-move (same-level and cross-level), restyle with
 * coalesced undo, delete; the AREA eraser (painted ink minus the swept
 * capsule — strokes bake to outline fills), undo/redo round-trip, z-order
 * preservation, fat/magnified strokes getting real holes; and the
 * move/edit tile-invalidation (no ghost ink after editing what a tile baked).
 */
import KobinEngine from "./KobinEngine";
import Document from "./Document";

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
        E.pointerDown(120, 120);
        E.pointerMove(160, 140);
        E.pointerMove(180, 160);
        E.pointerUp();
        expect(E.nativesByLevel[0][0].pts).toEqual([[160, 140], [210, 190]]);
        E.undo(); // the whole drag is ONE op
        expect(E.nativesByLevel[0][0].pts).toEqual([[100, 100], [150, 150]]);
        E.redo();
        expect(E.nativesByLevel[0][0].pts).toEqual([[160, 140], [210, 190]]);
    });

    test("move keeps the spatial index in sync", () => {
        const d = new Document();
        const o = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0], [10, 10]], lwFrame: 2, color: "#000", opacity: 1, paths: [] };
        d.add(o, 0);
        d.moveById(o.id, 1000, 0);
        expect(d.queryRect(0, { left: -20, top: -20, right: 30, bottom: 30 })).toHaveLength(0);
        expect(d.queryRect(0, { left: 990, top: -20, right: 1030, bottom: 30 }).some((q) => q.id === o.id)).toBe(true);
    });

    test("restyle gestures coalesce into a single undo op", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150]]);
        const o = E.nativesByLevel[0][0];
        E.setTool("select");
        E.pointerDown(150, 125); E.pointerUp();
        expect(E.selection.id).toBe(o.id);
        E.restyleSelection({ color: "#112233" });
        E.restyleSelection({ opacity: 0.4 });
        E.restyleSelection({ widthPx: 26 }); // inScale 1, level 0 -> lwFrame 26
        expect(o.color).toBe("#112233");
        expect(o.opacity).toBe(0.4);
        expect(o.lwFrame).toBeCloseTo(26, 9);
        E.undo(); // one op undoes the whole edit session
        expect(o.color).toBe("rgb(0,0,0)");
        expect(o.opacity).toBe(1);
        expect(o.lwFrame).toBe(13);
        expect(E.nativesByLevel[0]).toHaveLength(1); // next undo would remove the stroke
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
        const before = E.nativesByLevel[0][0].pts.map((p) => [...p]);
        zoomToLevel1(E);
        E.setTool("select");
        E.pointerDown(400, 300);
        expect(E.selection).not.toBeNull();
        expect(E.selection.level).toBe("0"); // the native's home FRAME id, not the active level
        E.pointerMove(430, 300);
        E.pointerUp();
        const after = E.nativesByLevel[0][0].pts;
        expect(after[0][0]).not.toBe(before[0][0]);          // it moved...
        expect(Math.abs(after[0][0] - before[0][0])).toBeLessThan(1); // ...by a sub-frame-unit amount (30px / ~3000)
        expect(after[0][1]).toBeCloseTo(before[0][1], 6);    // x-only drag
        E.undo();
        expect(E.nativesByLevel[0][0].pts[0][0]).toBeCloseTo(before[0][0], 9);
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
        E.pointerDown(400, 300);
        expect(E.selection && E.selection.id).toBe(id);
        E.pointerMove(700, 300); // drag far right, out of the old neighbourhood
        E.pointerUp();
        zoomToLevel1(E); // same spot as before
        expect(E._objs().some((o) => o.id === id)).toBe(false); // no stale ink
    });

    test("restyle re-derives inherited pieces (color reaches the tiles)", () => {
        const E = mkEngine();
        drawStroke(E, [[350, 300], [450, 300]]);
        const id = E.nativesByLevel[0][0].id;
        E.setTool("select");
        E.pointerDown(400, 300); E.pointerUp();
        expect(E.selection && E.selection.id).toBe(id);
        E.restyleSelection({ color: "#ff0000" });
        E.setTool("pan");
        zoomToLevel1(E);
        const pieces = E._objs().filter((o) => o.id === id);
        expect(pieces.length).toBeGreaterThan(0);
        for (const p of pieces) expect(p.color).toBe("#ff0000");
    });
});

describe("deferred area erase", () => {
    // Total inked bbox of a fill piece.
    const bboxOfPolys = (polys) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of polys) for (const [x, y] of ring) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return { x0, y0, x1, y1 };
    };
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
        expect(E.nativesByLevel[0][0].type).toBe("stroke");
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
        const boxes = natives.map((p) => bboxOfPolys(p.polys)).sort((a, b) => a.x0 - b.x0);
        // Kept ink's inner edges: 400 ∓ sqrt(13² − 6.5²) ≈ 400 ∓ 11.26.
        expect(boxes[0].x0).toBeCloseTo(293.5, 0);
        expect(boxes[0].x1).toBeGreaterThan(387);   // ±~1.5px: the eraser dot is a
        expect(boxes[0].x1).toBeLessThan(390.5);    // polygonized offset circle
        expect(boxes[1].x0).toBeGreaterThan(409.5);
        expect(boxes[1].x0).toBeLessThan(413);
        expect(boxes[1].x1).toBeCloseTo(506.5, 0);
        for (const p of natives) {
            expect(p.type).toBe("fill");
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
        expect(E.nativesByLevel[0].map((o) => o.type)).toEqual(["fill", "fill"]);
        E.undo(); // one op: un-bakes AND removes the (consumed) eraser stroke
        expect(E.nativesByLevel[0]).toHaveLength(1);
        expect(E.nativesByLevel[0][0].id).toBe(id);
        expect(E.nativesByLevel[0][0].type).toBe("stroke");
        expect(E.nativesByLevel[0][0].pts).toEqual([[300, 300], [500, 300]]);
        E.redo(); // re-applies the bake (the white stroke stays consumed)
        expect(E.nativesByLevel[0].map((o) => o.type).sort()).toEqual(["fill", "fill"]);
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
        expect(E.selection.obj.type).toBe("fill");
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
        expect(E.nativesByLevel[0][0].pts).toEqual([[400, 300], [420, 300]]);
    });

    test("one gesture bakes into every stroke beneath it", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 295], [500, 295]]);
        drawStroke(E, [[300, 305], [500, 305]]);
        E.setEraserSize(16);
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        expect(E.nativesByLevel[0]).toHaveLength(4); // each split in two
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("fill");
    });

    test("the swept trail erases along its whole path", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 200], [400, 400]]); // vertical stroke
        E.setEraserSize(10);
        eraseGesture(E, [[300, 300], [500, 300]]);
        E.flushErases();
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2); // split above/below the sweep
        const boxes = natives.map((p) => bboxOfPolys(p.polys)).sort((a, b) => a.y0 - b.y0);
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

    test("a magnified fat stroke gets a real hole nicked through it", () => {
        const E = mkEngine();
        drawStroke(E, [[390, 290], [420, 310], [400, 330], [370, 320]]);
        zoomToLevel1(E); // the stroke is now thousands of px wide on screen
        eraseGesture(E, [[400, 300]]);
        E.flushErases();
        const natives = Object.values(E.nativesByLevel).flat();
        expect(natives.length).toBeGreaterThanOrEqual(1);
        for (const p of natives) expect(p.type).toBe("fill");
        // The erased spot is really empty: no object's ink covers it now.
        expect(E._hitTest(400, 300)).toBeNull();
        E.undo(); // and the original stroke comes back whole
        expect(E.nativesByLevel[0][0].type).toBe("stroke");
        expect(E.nativesByLevel[0][0].pts).toHaveLength(4);
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
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("fill");
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
            expect(p.type).toBe("fill");
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
        expect(E2.nativesByLevel[0].map((o) => o.type).sort()).toEqual(["fill", "fill"]);
        expect(E2.doc.canUndo()).toBe(true);    // ...so it is undoable
        E2.undo();
        const after = E2.nativesByLevel[0];
        expect(after).toHaveLength(1);
        expect(after[0].type).toBe("stroke");
        expect(after[0].pts).toEqual([[300, 300], [500, 300]]);
    });

    test("stale erase replays can never double-stack ink (doc-level guards)", () => {
        // Deferred baking means an op's recorded objects can be consumed by a
        // LATER erase while the op sits mid-stack. Replaying it blindly used
        // to resurrect stale copies on top of the newer bake's pieces.
        const d = new Document();
        const src = { type: "stroke", origin: "native", id: d.allocId(), pts: [[0, 0], [100, 0]], lwFrame: 10, color: "#000", opacity: 1, paths: [] };
        d.add(src, 0);
        const region = (x1) => [[[0, -5], [x1, -5], [x1, 5], [0, 5]]];
        const cut1 = d.eraseReplaceById(src.id, region(40));
        const op1 = {
            op: "eraseCommit", strokeId: 9999, strokeRec: null,
            baked: [{ removed: cut1.removed, pieces: cut1.pieces.map((obj) => ({ obj, level: "0" })) }],
        };
        d._invert(op1);                                  // undo: piece out, src back
        expect(d.at("0").map((o) => o.id)).toEqual([src.id]);
        const cut2 = d.eraseReplaceById(src.id, region(60)); // later erase consumes src
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
        const derived = E._objs().filter((o) => o.type === "fill");
        expect(derived.length).toBeGreaterThan(0);
        for (const p of derived) {
            let x0 = 1 / 0, y0 = 1 / 0, x1 = -1 / 0, y1 = -1 / 0;
            for (const r of p.polys) for (const [x, y] of r) {
                x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
            // Bounded by the TILE, never by the (much larger) source object.
            expect(x1 - x0).toBeLessThanOrEqual(g.w * 1.02);
            expect(y1 - y0).toBeLessThanOrEqual(g.h * 1.02);
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
