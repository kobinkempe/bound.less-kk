import KobinEngine from "./KobinEngine";

const engines = [];
const mkEngine = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const engine = new KobinEngine(host, { width: 800, height: 600 });
    engines.push(engine);
    return engine;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const draw = (E, pts) => {
    E.pointerDown(...pts[0]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(...pts[i]);
    E.pointerUp();
};
const lasso = (E, points, ctrl = false) => {
    E.pointerDown(points[0][0], points[0][1], { ctrlKey: ctrl });
    for (let i = 1; i < points.length; i++) E.pointerMove(...points[i]);
    E.pointerUp();
};
const box = (x0, y0, x1, y1) => [
    [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
];
const addFill = (E, level, id, x0, y0, x1, y1, extra = {}) => {
    const o = {
        type: "fill", origin: "native", id,
        polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
        color: "#000", opacity: 1, paths: [], ...extra,
    };
    E.doc.add(o, level);
    return o;
};

test("lasso selects only logical objects fully bounded by it", () => {
    const E = mkEngine();
    draw(E, [[100, 100], [130, 100]]);
    draw(E, [[170, 100], [200, 100]]);
    draw(E, [[240, 100], [300, 100]]);
    draw(E, [[50, 150], [350, 150]]); // crosses the lasso; must not be selected
    E.setTool("select");

    lasso(E, box(80, 75, 220, 125));
    expect(E.selection.count).toBe(2);
    expect(new Set(E.selection.keys)).toEqual(new Set([1, 2]));
});

test("Ctrl lasso adds if it contains anything new, otherwise removes all it contains", () => {
    const E = mkEngine();
    draw(E, [[100, 100], [130, 100]]);
    draw(E, [[180, 100], [210, 100]]);
    draw(E, [[280, 100], [310, 100]]);
    E.setTool("select");

    lasso(E, box(80, 75, 230, 125));
    expect(E.selection.count).toBe(2);
    lasso(E, box(160, 75, 330, 125), true);
    expect(E.selection.count).toBe(3); // overlap includes selected #2 plus new #3 -> add all
    lasso(E, box(80, 75, 230, 125), true);
    expect(E.selection.count).toBe(1); // only selected objects inside -> remove both
    expect(E.selection.keys).toEqual([3]);
});

test("plain click replaces a lasso selection; Ctrl click toggles one object", () => {
    const E = mkEngine();
    draw(E, [[100, 100], [130, 100]]);
    draw(E, [[180, 100], [210, 100]]);
    draw(E, [[280, 100], [310, 100]]);
    E.setTool("select");
    lasso(E, box(80, 75, 230, 125));

    E.pointerDown(295, 100); E.pointerUp();
    expect(E.selection.keys).toEqual([3]);
    E.pointerDown(115, 100, { ctrlKey: true }); E.pointerUp();
    expect(new Set(E.selection.keys)).toEqual(new Set([1, 3]));
    E.pointerDown(295, 100, { ctrlKey: true }); E.pointerUp();
    expect(E.selection.keys).toEqual([1]);
});

test("moving a lasso selection shares one frame-anchored placement and undoes atomically", () => {
    const E = mkEngine();
    draw(E, [[100, 100], [130, 100]]);
    draw(E, [[180, 100], [210, 100]]);
    E.setTool("select");
    lasso(E, box(80, 75, 230, 125));
    const [a, b] = E.nativesByLevel[0];

    // A drag beginning on an already-selected object moves the whole selection.
    E.pointerDown(115, 100);
    E.pointerMove(145, 120);
    E.pointerUp();
    expect(a.placements).toHaveLength(1);
    expect(b.placements).toHaveLength(1);
    expect(a.placements[0]).toBe(b.placements[0]);
    expect(a.placements[0]).toMatchObject({ frame: "0", dx: 30, dy: 20 });

    E.undo();
    expect(a.placements).toBeUndefined();
    expect(b.placements).toBeUndefined();
    E.redo();
    expect(a.placements[0]).toBe(b.placements[0]);
});

test("lasso release completes pending erase topology before choosing bounded objects", () => {
    const E = mkEngine();
    draw(E, [[100, 100], [300, 100]]);
    E.setEraserSize(14);
    E.setTool("erasePartial");
    E.pointerDown(200, 70);
    E.pointerMove(200, 130);
    E.pointerUp();
    expect(E.nativesByLevel[0].some((o) => o.erase)).toBe(true);

    E.setTool("select");
    lasso(E, box(75, 75, 192, 125));
    expect(Object.values(E.nativesByLevel).flat().some((o) => o.erase)).toBe(false);
    expect(E.selection).not.toBeNull();
    expect(E.selection.count).toBe(1);
    expect(E.selection.obj.type).toBe("fill");
});

test("pointer-rate movement previews 200 fragments and commits one placement batch", () => {
    const E = mkEngine();
    const root = addFill(E, "0", E.doc.allocId(), 90, 90, 140, 115);
    for (let i = 0; i < 200; i++) {
        const x = 90 + (i % 20) * 2;
        const y = 90 + Math.floor(i / 20) * 2;
        addFill(E, "0", E.doc.allocId(), x, y, x + 1.5, y + 1.5, {
            editId: root.id, srcId: root.id,
        });
    }
    E._render();
    E._selected.clear();
    E._selectRecord(E.doc.getById(root.id));
    E._syncSelection();
    E.setTool("select");

    const renderSpy = jest.spyOn(E, "_render");
    const batchSpy = jest.spyOn(E.doc, "addPlacementMany");
    const touchSpy = jest.spyOn(E.doc, "touchPlacement");
    const previewSpy = jest.spyOn(E.renderer, "setDragPreview");
    E.pointerDown(110, 100);
    for (let i = 1; i <= 200; i++) E.pointerMove(110 + i / 10, 100 + i / 20);

    expect(previewSpy).toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(batchSpy).not.toHaveBeenCalled();
    expect(touchSpy).not.toHaveBeenCalled();

    E.pointerUp();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const family = E.doc.editGroup(root.id);
    expect(family).toHaveLength(201);
    expect(family.every((rec) => rec.obj.placements?.length === 1)).toBe(true);
    expect(new Set(family.map((rec) => rec.obj.placements[0])).size).toBe(1);
});

test("a root lasso and move preserve a fully bounded level-15 detail on a fresh branch and after save/load", () => {
    const E = mkEngine();
    const rootPoint = [123.25, -47.5];
    const large = addFill(
        E, "0", E.doc.allocId(),
        rootPoint[0] - 22, rootPoint[1] - 22,
        rootPoint[0] + 22, rootPoint[1] + 22,
    );
    const buildBranch = (start, focus) => {
        let parent = start, p = focus;
        for (let depth = 0; depth < 15; depth++) {
            const panX = 400 - p[0] * E.cfg.enter;
            const panY = 300 - p[1] * E.cfg.enter;
            const child = E.lm.ensureChild(parent, E.cfg.enter, panX, panY);
            p = E.lm.mapPointPlacedF(p, parent, child.id, []);
            parent = child.id;
        }
        return { frame: parent, point: p };
    };
    const old = buildBranch("0", rootPoint);
    const tinyOffset = [0.125, -0.375];
    const tinyCenter = [old.point[0] + tinyOffset[0], old.point[1] + tinyOffset[1]];
    const tiny = addFill(
        E, old.frame, E.doc.allocId(),
        tinyCenter[0] - 0.04, tinyCenter[1] - 0.04,
        tinyCenter[0] + 0.04, tinyCenter[1] + 0.04,
    );

    E.cam.frame = "0";
    E.cam.activeLevel = 0;
    E.cam.inScale = 1;
    E.cam.inPanX = 400 - rootPoint[0];
    E.cam.inPanY = 300 - rootPoint[1];
    E._render();
    // The detail is far below the root render cull, so this proves lasso
    // containment walks canonical logical objects rather than visible tiles.
    expect(E._lastList.some((o) => o.id === tiny.id)).toBe(false);
    E.setTool("select");
    lasso(E, box(365, 265, 435, 335));
    expect(new Set(E.selection.keys)).toEqual(new Set([large.id, tiny.id]));

    E.pointerDown(400, 300);
    E.pointerMove(437, 319);
    E.pointerUp();
    expect(large.placements).toHaveLength(1);
    expect(tiny.placements).toHaveLength(1);
    expect(large.placements[0]).toBe(tiny.placements[0]);
    expect(large.placements[0]).toMatchObject({ frame: "0", dx: 37, dy: 19 });

    // Movement is document placement, never cache state. Evict every derived
    // tile before constructing a different level-15 branch and verify the
    // moved root object is reconstructed at its committed position.
    E.store.cache.clear();
    E._render();
    expect(E._hitTest(437, 319)).toBe(large.id);

    const movedRoot = [rootPoint[0] + 37, rootPoint[1] + 19];
    const fresh = buildBranch("0", movedRoot);
    const largeAtFresh = E.lm.mapPointPlacedF(rootPoint, "0", fresh.frame, large.placements);
    const tinyAtFresh = E.lm.mapPointPlacedF(tinyCenter, old.frame, fresh.frame, tiny.placements);
    expect(tinyAtFresh[0] - largeAtFresh[0]).toBeCloseTo(tinyOffset[0], 8);
    expect(tinyAtFresh[1] - largeAtFresh[1]).toBeCloseTo(tinyOffset[1], 8);
    E.cam.frame = fresh.frame;
    E.cam.inScale = 100;
    E.cam.inPanX = 400 - largeAtFresh[0] * E.cam.inScale;
    E.cam.inPanY = 300 - largeAtFresh[1] * E.cam.inScale;
    E.store.cache.clear();
    E.renderer.clear();
    E._render();
    const tinyScreen = [
        400 + (tinyAtFresh[0] - largeAtFresh[0]) * E.cam.inScale,
        300 + (tinyAtFresh[1] - largeAtFresh[1]) * E.cam.inScale,
    ];
    expect(E._lastList.some((o) => o.id === large.id)).toBe(true);
    expect(E._lastList.some((o) => o.id === tiny.id)).toBe(true);
    expect(E._hitTest(...tinyScreen)).toBe(tiny.id);

    const saved = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "deep shared move" })));
    const E2 = mkEngine();
    E2.loadDrawing(saved);
    const large2 = E2.doc.getById(large.id).obj;
    const tiny2 = E2.doc.getById(tiny.id).obj;
    expect(large2.placements[0]).toBe(tiny2.placements[0]);
    const largeReloaded = E2.lm.mapPointPlacedF(rootPoint, "0", fresh.frame, large2.placements);
    const tinyReloaded = E2.lm.mapPointPlacedF(tinyCenter, old.frame, fresh.frame, tiny2.placements);
    expect(tinyReloaded[0] - largeReloaded[0]).toBeCloseTo(tinyOffset[0], 8);
    expect(tinyReloaded[1] - largeReloaded[1]).toBeCloseTo(tinyOffset[1], 8);
    E2.cam.frame = fresh.frame;
    E2.cam.inScale = 100;
    E2.cam.inPanX = 400 - largeReloaded[0] * E2.cam.inScale;
    E2.cam.inPanY = 300 - largeReloaded[1] * E2.cam.inScale;
    E2.store.cache.clear();
    E2.renderer.clear();
    E2._render();
    expect(E2._hitTest(...tinyScreen)).toBe(tiny.id);
});
