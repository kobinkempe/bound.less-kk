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

describe("area (partial) erase", () => {
    // Total inked bbox of a fill piece.
    const bboxOfPolys = (polys) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const ring of polys) for (const [x, y] of ring) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return { x0, y0, x1, y1 };
    };

    test("erasing the middle of a stroke bakes two ink pieces split at the eraser edge", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]); // lwFrame 13
        const src = E.nativesByLevel[0][0];
        E.setTool("erasePartial");
        E.setEraserSize(13);
        E.pointerDown(400, 300); E.pointerUp();
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2);
        const boxes = natives.map((p) => bboxOfPolys(p.polys)).sort((a, b) => a.x0 - b.x0);
        // Left piece: the round cap reaches lw/2 past x=300. The kept ink's
        // inner edge is where the disc crosses the band edge:
        // 400 ∓ sqrt(13² − 6.5²) ≈ 400 ∓ 11.26 (± capsule polygonization).
        expect(boxes[0].x0).toBeCloseTo(293.5, 0);
        expect(boxes[0].x1).toBeGreaterThan(387.5);
        expect(boxes[0].x1).toBeLessThan(389.5);
        expect(boxes[1].x0).toBeGreaterThan(410.5);
        expect(boxes[1].x0).toBeLessThan(412.5);
        expect(boxes[1].x1).toBeCloseTo(506.5, 0);
        for (const p of natives) {
            expect(p.type).toBe("fill");         // baked to painted ink...
            expect(p.id).not.toBe(src.id);       // ...as new objects...
            expect(p.z).toBe(src.id);            // ...at the original's depth
            expect(p.color).toBe(src.color);
            expect(p.origin).toBe("native");
        }
    });

    test("erase undo restores the original stroke; redo re-erases", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        const id = E.nativesByLevel[0][0].id;
        E.setTool("erasePartial");
        E.pointerDown(400, 300); E.pointerUp();
        expect(E.nativesByLevel[0]).toHaveLength(2);
        E.undo();
        expect(E.nativesByLevel[0]).toHaveLength(1);
        expect(E.nativesByLevel[0][0].id).toBe(id);
        expect(E.nativesByLevel[0][0].type).toBe("stroke"); // the REAL stroke is back
        expect(E.nativesByLevel[0][0].pts).toEqual([[300, 300], [500, 300]]);
        E.redo();
        expect(E.nativesByLevel[0]).toHaveLength(2);
        E.undo(); E.undo(); // un-erase, then undo the draw itself
        expect(countNatives(E)).toBe(0);
    });

    test("an eraser that covers the whole stroke erases the object", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 300], [420, 300]]);
        E.setTool("erasePartial");
        E.setEraserSize(90); // radius 90 dwarfs the ~33px ink
        E.pointerDown(410, 300); E.pointerUp();
        expect(countNatives(E)).toBe(0);
        E.undo();
        expect(countNatives(E)).toBe(1);
        expect(E.nativesByLevel[0][0].pts).toEqual([[400, 300], [420, 300]]);
    });

    test("rubbing across two overlapping strokes erases both", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 295], [500, 295]]);
        drawStroke(E, [[300, 305], [500, 305]]);
        E.setTool("erasePartial");
        E.setEraserSize(16);
        E.pointerDown(400, 300); E.pointerUp(); // disc spans both ink bands
        expect(E.nativesByLevel[0]).toHaveLength(4); // each split in two
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("fill");
    });

    test("a moving eraser erases along the whole swept path, not just the samples", () => {
        const E = mkEngine();
        drawStroke(E, [[400, 200], [400, 400]]); // vertical stroke
        E.setTool("erasePartial");
        E.setEraserSize(10);
        // One fast drag whose SAMPLES land either side of the stroke — only
        // the swept capsule between them crosses it.
        E.pointerDown(300, 300);
        E.pointerMove(500, 300);
        E.pointerUp();
        const natives = E.nativesByLevel[0];
        expect(natives).toHaveLength(2); // split above/below the sweep
        const boxes = natives.map((p) => bboxOfPolys(p.polys)).sort((a, b) => a.y0 - b.y0);
        expect(boxes[0].y1).toBeLessThan(300);   // upper piece ends above the sweep
        expect(boxes[1].y0).toBeGreaterThan(300); // lower piece starts below it
    });

    test("erased pieces keep the original's z-order under later strokes", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);              // A (bottom)
        drawStroke(E, [[400, 200], [400, 400]]);              // B (top, crosses A)
        const idB = E.nativesByLevel[0][1].id;
        E.setTool("erasePartial");
        E.pointerDown(320, 300); E.pointerUp();               // erase A away from B
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
        E.setTool("erasePartial");
        const before = countNatives(E);
        expect(E.erasePartialAt(400, 300)).toBe(true); // the old engine refused this
        const natives = Object.values(E.nativesByLevel).flat();
        expect(natives.length).toBeGreaterThanOrEqual(before);
        for (const p of natives) expect(p.type).toBe("fill");
        // The erased spot is really empty: no object's ink covers it now.
        expect(E._hitTest(400, 300)).toBeNull();
        E.undo(); // and the original stroke comes back whole
        expect(E.nativesByLevel[0][0].type).toBe("stroke");
        expect(E.nativesByLevel[0][0].pts).toHaveLength(4);
    });

    test("erasing an already-baked piece subtracts again (fills erase too)", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        E.setTool("erasePartial");
        E.setEraserSize(13);
        E.pointerDown(340, 300); E.pointerUp();
        expect(E.nativesByLevel[0]).toHaveLength(2);
        E.pointerDown(440, 300); E.pointerUp(); // second bite hits the right-hand FILL
        expect(E.nativesByLevel[0]).toHaveLength(3);
        for (const p of E.nativesByLevel[0]) expect(p.type).toBe("fill");
    });

    test("erased pieces survive a save/load round-trip with their z", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]]);
        const srcId = E.nativesByLevel[0][0].id;
        E.setTool("erasePartial");
        E.pointerDown(400, 300); E.pointerUp();
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "erases" })));
        const E2 = mkEngine();
        E2.loadDrawing(doc);
        const pieces = E2.nativesByLevel[0];
        expect(pieces).toHaveLength(2);
        for (const p of pieces) {
            expect(p.type).toBe("fill");
            expect(p.z).toBe(srcId);
        }
    });
});
