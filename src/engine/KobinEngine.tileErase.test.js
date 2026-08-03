import KobinEngine from "./KobinEngine";
import { windingOfPoint } from "./geometry/hittest";

jest.setTimeout(30000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const engine = new KobinEngine(host, { width: w, height: h });
    engines.push(engine);
    return engine;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const rectFill = (E, x0, y0, x1, y1, opacity = 1) => {
    const obj = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
        color: "#000000", opacity, paths: [],
    };
    E.doc.add(obj, E.cam.frame);
    E._render();
    return obj;
};
const drawStroke = (E, pts) => {
    E.setTool("pen");
    E.pointerDown(...pts[0]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(...pts[i]);
    E.pointerUp();
};
const erase = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(...pts[0]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(...pts[i]);
    E.pointerUp();
};
const zoomToLevel1 = (E) => {
    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 50) E.zoomAt(400, 300, -1000);
    expect(E.activeLevel).toBe(1);
};
const zoomToLevel = (E, level, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel < level && guard++ < 200) E.zoomAt(sx, sy, -1000);
    expect(E.activeLevel).toBe(level);
};
const zoomOutToLevel = (E, level, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel > level && guard++ < 200) E.zoomAt(sx, sy, 1000);
    expect(E.activeLevel).toBe(level);
};
const all = (E) => Object.values(E.nativesByLevel).flat();
const bbox = (polys) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of polys) for (const [x, y] of ring) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
};
const dumbbell = (outer, gate, corridorHalf = 1) => {
    const cy = (gate.top + gate.bottom) / 2;
    const lobeHalf = Math.max(20, (gate.bottom - gate.top) * 4);
    return [[
        [outer.left, cy - lobeHalf], [gate.left, cy - lobeHalf],
        [gate.left, cy - corridorHalf], [gate.right, cy - corridorHalf],
        [gate.right, cy - lobeHalf], [outer.right, cy - lobeHalf],
        [outer.right, cy + lobeHalf], [gate.right, cy + lobeHalf],
        [gate.right, cy + corridorHalf], [gate.left, cy + corridorHalf],
        [gate.left, cy + lobeHalf], [outer.left, cy + lobeHalf],
    ]];
};
const rectAsBoxForTest = (rect) => ({
    left: rect.left != null ? rect.left : rect.x0,
    top: rect.top != null ? rect.top : rect.y0,
    right: rect.right != null ? rect.right : rect.x1,
    bottom: rect.bottom != null ? rect.bottom : rect.y1,
});
const interiorPoint = (rings) => {
    const b = bbox(rings);
    for (let yi = 1; yi < 10; yi++) {
        for (let xi = 1; xi < 10; xi++) {
            const p = [
                b.x0 + ((b.x1 - b.x0) * xi) / 10,
                b.y0 + ((b.y1 - b.y0) * yi) / 10,
            ];
            if (windingOfPoint(rings, p) !== 0) return p;
        }
    }
    return null;
};

test("a cut through a tile boundary materializes real global components, not a phantom parent", () => {
    const E = mkEngine();
    // Level-0's vertical tile edge is x=16000. Bring it to screen x=400.
    E.cam.inPanX = 400 - 16000;
    const src = rectFill(E, 15000, 200, 17000, 400);
    E.setEraserSize(30);
    erase(E, [[400, 150], [400, 450]]);
    E.flushErases();

    const survivors = all(E);
    expect(survivors.some((o) => o.id === src.id)).toBe(false);
    expect(survivors).toHaveLength(2);
    expect(new Set(survivors.map((o) => E.doc.editKey(o))).size).toBe(2);
    for (const o of survivors) {
        expect(o.type).toBe("fill");
        expect(o.eraseCell).toEqual(expect.objectContaining({ frame: "0" }));
    }

    E.undo();
    expect(all(E)).toEqual([src]);
    E.redo();
    expect(all(E)).toHaveLength(2);
    expect(all(E).some((o) => o.id === src.id)).toBe(false);
});

test("the baked eraser footprint follows the same smooth spline as its live stroke", () => {
    const E = mkEngine();
    rectFill(E, -20, -20, 120, 120);
    E.setEraserSize(6);
    erase(E, [[0, 0], [50, 100], [100, 0]]);
    E.flushErases();

    // For this three-anchor Two.js spline, (11,50) lies on the bowed cubic
    // while it is more than the eraser radius from the raw pointer chord.
    // Conversely, (25,50) lies on the chord but away from the displayed curve.
    expect(E._hitTest(11, 50)).toBeNull();
    expect(E._hitTest(25, 50)).not.toBeNull();
});

test("an eraser exiting a shape edge makes a clean open notch without a tile box", () => {
    const E = mkEngine();
    rectFill(E, 100, 100, 700, 500);
    E.setEraserSize(8);
    erase(E, [[450, 300], [760, 300]]);
    E.flushErases();

    expect(E._hitTest(500, 300)).toBeNull();
    expect(E._hitTest(690, 300)).toBeNull();
    expect(E._hitTest(690, 280)).not.toBeNull();
    expect(E._hitTest(690, 320)).not.toBeNull();
    // A same-cell edge cut needs no ownership window at all; a rectangular
    // window here was the source of the reported box-shaped cutout.
    expect(all(E).some((o) => o.windows && o.windows.length)).toBe(false);
});

test("re-erasing an owned tile rewrites the cell instead of nesting same-cell windows", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350);
    zoomToLevel1(E);
    E.setEraserSize(12);
    erase(E, [[390, 300]]);
    E.flushErases();
    expect(src.windows).toHaveLength(1);
    const first = JSON.parse(JSON.stringify(E.doc.serializeNatives()));

    erase(E, [[410, 300]]);
    E.flushErases();
    const windowOwners = all(E).filter((o) => o.windows && o.windows.length);
    expect(windowOwners).toHaveLength(1);
    expect(windowOwners[0]).toBe(src);
    expect(src.windows).toHaveLength(1);
    expect(all(E).filter((o) => o.eraseCell && o.eraseCell.frame === E.cam.frame).length)
        .toBeGreaterThan(0);

    E.undo();
    expect(E.doc.serializeNatives()).toEqual(first);
});

test("a coarse eraser also bakes every covered child ownership cell", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350);
    zoomToLevel1(E);
    erase(E, [[400, 300]]);
    E.flushErases();

    const childFrame = E.cam.frame;
    const child = E.doc.editGroup(src.id)
        .find((rec) => rec.level === childFrame && rec.obj.type === "fill");
    expect(child).toBeTruthy();
    const probe = interiorPoint(child.obj.polys);
    expect(probe).not.toBeNull();
    const oldChildId = child.obj.id;

    let guard = 0;
    while (E.activeLevel > 0 && guard++ < 60) E.zoomAt(400, 300, 1000);
    expect(E.activeLevel).toBe(0);
    const atRoot = E.lm.mapPointF(probe, childFrame, E.cam.frame);
    const atScreen = [
        atRoot[0] * E.cam.inScale + E.cam.inPanX,
        atRoot[1] * E.cam.inScale + E.cam.inPanY,
    ];
    E.setEraserSize(16);
    erase(E, [atScreen]);
    E.flushErases();

    // The scheduler must visit the existing child before the parent summary.
    // Leaving this id untouched was the "parent cut, child still paints"
    // failure reported from the editor.
    expect(E.doc.getById(oldChildId)).toBeNull();
    for (const level of E.doc.levels()) {
        if (E.lm.depthOf(level) < E.lm.depthOf(childFrame)) continue;
        for (const o of E.doc.at(level)) {
            if (o.erase || o.type !== "fill") continue;
            const d = o.placements && o.placements.length
                ? E.lm.projectPlacedF(o, level, childFrame)
                : E.lm.projectF(o, level, childFrame);
            if (d) expect(windingOfPoint(d.polys, probe)).toBe(0);
        }
    }
});

test("one parent-level gesture rewrites two covered child cells, not just the first", () => {
    const E = mkEngine();
    const root = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        polys: [[[-10, -10], [20, -10], [20, 10], [-10, 10]]],
        color: "#000", opacity: 1, paths: [],
    };
    E.doc.add(root, "0");
    const child = E.lm.ensureChild("0", E.cfg.enter, 0, 0);
    const childIds = [];
    for (const [i, x0, x1] of [[0, 14000, 16020], [1, 15980, 18000]]) {
        const core = E.lm.tileRect(child.id, i, 0);
        const atRoot = E.lm.mapRectF(core, child.id, "0");
        const step = E.doc.eraseRehomeById(root.id, child.id, [{
            polys: [[[x0, 0], [x1, 0], [x1, 200], [x0, 200]]],
            attached: true,
            cell: { frame: child.id, i, j: 0 },
        }], {
            x0: atRoot.left, y0: atRoot.top,
            x1: atRoot.right, y1: atRoot.bottom,
        }, {
            x0: core.left, y0: core.top,
            x1: core.right, y1: core.bottom,
        });
        childIds.push(step.pieces[0].obj.id);
    }
    const a = E.lm.mapPointF([14500, 100], child.id, "0");
    const b = E.lm.mapPointF([17500, 100], child.id, "0");
    const trail = {
        type: "stroke", origin: "native", erase: true, bakePx: 1,
        id: E.doc.allocId(), pts: [a, b],
        lwFrame: 240 / E.lm.frameFactor("0", child.id),
        color: "#fff", opacity: 1, paths: [],
    };
    E.doc.add(trail, "0");
    for (const id of childIds) {
        const rec = E.doc.getById(id);
        expect(E._eraseBoundsMayTouch(trail, "0", rec.obj, rec.level)).toBe(true);
        expect(E._eraseMayTouch(trail, "0", rec.obj, rec.level)).toBe(true);
    }
    E.flushErases();
    for (const id of childIds) expect(E.doc.getById(id)).toBeNull();
    for (const probe of [[14500, 100], [17500, 100]]) {
        for (const level of E.doc.levels()) {
            if (E.lm.depthOf(level) < 1) continue;
            for (const o of E.doc.at(level)) {
                if (o.erase || o.type !== "fill") continue;
                const d = E.lm.projectF(o, level, child.id);
                if (d) expect(windingOfPoint(d.polys, probe)).toBe(0);
            }
        }
    }
});

test("selecting one affected object completes the entire multi-object erase gesture", () => {
    const E = mkEngine();
    drawStroke(E, [[280, 290], [520, 290]]);
    drawStroke(E, [[280, 310], [520, 310]]);
    E.setEraserSize(20);
    erase(E, [[400, 260], [400, 340]]);
    expect(all(E).some((o) => o.erase)).toBe(true);

    E.setTool("select");
    E.pointerDown(320, 290);
    E.pointerUp();
    expect(E.selection).not.toBeNull();
    expect(all(E).some((o) => o.erase)).toBe(false);
    expect(all(E)).toHaveLength(4);
    for (const o of all(E)) expect(o.type).toBe("fill");
});

test("one gesture through five objects finishes all five before selection and survives another crossing", () => {
    const E = mkEngine();
    const sources = [];
    for (let i = 0; i < 5; i++) {
        sources.push(rectFill(E, 350 - i, 250 - i, 450 + i, 350 + i, i === 2 ? 0.4 : 1));
    }
    zoomToLevel1(E);
    E.setEraserSize(12);
    erase(E, [[400, 275], [400, 325]]);
    expect(all(E).some((o) => o.erase)).toBe(true);

    E.setTool("select");
    E.pointerDown(440, 300);
    E.pointerUp();
    expect(all(E).some((o) => o.erase)).toBe(false);
    for (const src of sources) {
        const family = E.doc.editGroup(src.id);
        expect(family.length).toBeGreaterThan(1);
        expect(family.some((rec) => E.lm.depthOf(rec.level) === 1)).toBe(true);
    }
    expect(E._hitTest(400, 300)).toBeNull();
    zoomToLevel(E, 2, 400, 300);
    E._render();
    expect(E._hitTest(400, 300)).toBeNull();
    const renderedFamilies = new Set(E._lastList.map((o) => {
        if (o.editId != null) return o.editId;
        const rec = E.doc.getById(o.id);
        return rec ? E.doc.editKey(rec.obj) : o.id;
    }));
    for (const src of sources) expect(renderedFamilies.has(src.id)).toBe(true);
});

test("erase target scanning rejects far objects before any polygon work", () => {
    const E = mkEngine();
    for (let i = 0; i < 500; i++) {
        E.doc.add({
            type: "fill", origin: "native", id: E.doc.allocId(),
            polys: [[[1e6 + i * 20, 1e6], [1e6 + i * 20 + 10, 1e6],
                [1e6 + i * 20 + 10, 1e6 + 10], [1e6 + i * 20, 1e6 + 10]]],
            color: "#000", opacity: 1, paths: [],
        }, "0");
    }
    const near = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        polys: [[[380, 280], [420, 280], [420, 320], [380, 320]]],
        color: "#000", opacity: 1, paths: [],
    };
    E.doc.add(near, "0");
    const trail = {
        type: "stroke", origin: "native", erase: true, bakePx: 1,
        id: E.doc.allocId(), pts: [[400, 300]], lwFrame: 24,
        color: "#fff", opacity: 1, paths: [],
    };
    E.doc.add(trail, "0");

    const target = E._nextEraseTarget({ obj: trail, level: "0" });
    expect(target.obj).toBe(near);
    expect(E._lastEraseScan).toEqual({
        checked: 501, bboxPassed: 1, exactChecked: 1,
    });
});

test("transparent erased cells use exact parent ownership and one overlapped opacity group", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350, 0.35);
    zoomToLevel1(E);
    E.setEraserSize(12);
    erase(E, [[400, 300]]);
    E.flushErases();
    E._render();

    const cells = all(E).filter((o) => o.eraseCell);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
        const core = E.lm.tileRect(cell.eraseCell.frame, cell.eraseCell.i, cell.eraseCell.j);
        const b = bbox(cell.polys);
        // Canonical ownership is the core, but render geometry carries a real
        // overlap so antialiasing cannot expose the implementation boundary.
        expect(b.x0).toBeLessThan(core.left);
        expect(b.x1).toBeGreaterThan(core.right);
        expect(b.y0).toBeLessThan(core.top);
        expect(b.y1).toBeGreaterThan(core.bottom);
        expect(E.doc.editKey(cell)).toBe(src.id);
        const ar = cell.attachRect;
        const inParent = E.lm.mapRectF({
            left: ar.x0, top: ar.y0, right: ar.x1, bottom: ar.y1,
        }, cell.eraseCell.frame, "0");
        expect(src.windows.some((w) =>
            Math.abs(w.x0 - inParent.left) < 1e-9 &&
            Math.abs(w.y0 - inParent.top) < 1e-9 &&
            Math.abs(w.x1 - inParent.right) < 1e-9 &&
            Math.abs(w.y1 - inParent.bottom) < 1e-9)).toBe(true);
    }
    for (const window of src.windows) expect(window.seam).toBeUndefined();
    expect(E.renderer._groups.has(src.id)).toBe(true);
    for (const cell of cells) expect(E.renderer._groups.has(cell.id)).toBe(false);
});

test.each([1, 0.35])(
    "adjacent erased cells have invisible seams and preserve the hole at opacity %s",
    (opacity) => {
        const E = mkEngine();
        const edge = 16000;
        E.cam.inPanX = 400 - edge;
        const src = rectFill(E, 15000, 200, 17000, 400, opacity);
        E.setEraserSize(12);
        erase(E, [[400, 300]]); // footprint straddles the vertical tile edge
        E.flushErases();
        E._render();

        const cells = all(E).filter((o) =>
            o.eraseCell && o.eraseCell.frame === "0" && o.editId === src.id);
        const left = cells.find((o) => {
            const core = E.lm.tileRect("0", o.eraseCell.i, o.eraseCell.j);
            return Math.abs(core.right - edge) < 1e-9;
        });
        const right = cells.find((o) => {
            const core = E.lm.tileRect("0", o.eraseCell.i, o.eraseCell.j);
            return Math.abs(core.left - edge) < 1e-9;
        });
        expect(left).toBeTruthy();
        expect(right).toBeTruthy();
        expect(bbox(left.polys).x1).toBeGreaterThan(edge);
        expect(bbox(right.polys).x0).toBeLessThan(edge);
        // Sample away from the actual eraser hole: both render fragments
        // overlap the implementation seam, while one logical group applies
        // opacity only once.
        expect(windingOfPoint(left.polys, [edge - 5, 230])).not.toBe(0);
        expect(windingOfPoint(right.polys, [edge + 5, 230])).not.toBe(0);
        // Test the rendered result densely across the implementation edge.
        // Away from the eraser there can be no crack; through its center the
        // exact parent window must not repaint the erased band.
        for (let sx = 388; sx <= 412; sx += 0.5) {
            expect(E._hitTest(sx, 230)).not.toBeNull();
        }
        for (let sx = 395; sx <= 405; sx += 0.5) {
            expect(E._hitTest(sx, 300)).toBeNull();
        }
        expect(E.renderer._groups.has(src.id)).toBe(true);
        for (const cell of cells) expect(E.renderer._groups.has(cell.id)).toBe(false);
        expect(E.renderer._groups.get(src.id).group.children).toHaveLength(1);
    },
);

test("exact tile ownership, render guards, and shared placement survive save/load and eviction", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350, 0.5);
    zoomToLevel1(E);
    erase(E, [[400, 300]]);
    E.flushErases();
    const family = E.doc.editGroup(src.id);
    const placement = { id: "save-shared", frame: "0", dx: 12.5, dy: -7.25 };
    for (const rec of family) E.doc.addPlacement(rec.obj.id, placement);
    const saved = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "tile state" })));

    const E2 = mkEngine();
    E2.loadDrawing(saved);
    const loaded = E2.doc.editGroup(src.id);
    expect(loaded.length).toBe(family.length);
    expect(loaded.some((r) => r.obj.eraseCell)).toBe(true);
    const loadedParent = loaded.find((r) => r.obj.id === src.id).obj;
    for (const window of loadedParent.windows) expect(window.seam).toBeUndefined();
    for (const rec of loaded) {
        expect(rec.obj.placements).toEqual([placement]);
    }
    expect(new Set(loaded.map((r) => r.obj.placements[0])).size).toBe(1);
    const hitBeforeEviction = E2._hitTest(400, 300);
    E2.store.cache.clear();
    E2._render();
    expect(E2._hitTest(400, 300)).toBe(hitBeforeEviction);
});

test("an erased cell can move beyond its original tile and be erased again in placed coordinates", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350);
    zoomToLevel1(E);
    erase(E, [[400, 300]]);
    E.flushErases();
    const beforeMove = E.doc.editGroup(src.id);
    expect(beforeMove.some((r) => r.obj.eraseCell)).toBe(true);

    const g = E.lm.grid(E.cam.frame);
    const placement = {
        id: "move-beyond-cell", frame: String(E.cam.frame),
        dx: g.w * 1.25, dy: 0,
    };
    for (const rec of beforeMove) E.doc.addPlacement(rec.obj.id, placement);
    E.cam.inPanX -= placement.dx * E.cam.inScale;
    E._render();
    expect(E._hitTest(370, 300)).not.toBeNull();
    const beforeSecondErase = JSON.parse(JSON.stringify(E.doc.serializeNatives()));

    erase(E, [[370, 275], [370, 325]]);
    E.flushErases();
    expect(all(E).some((o) => o.erase)).toBe(false);
    expect(E._hitTest(430, 300)).not.toBeNull();
    expect(E.doc.editGroup(src.id).every((r) =>
        r.obj.placements && r.obj.placements[0] === placement)).toBe(true);

    E.undo();
    expect(E.doc.serializeNatives()).toEqual(beforeSecondErase);
});

test("scenes consume one placement-resolved item per logical erase family", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350);
    zoomToLevel1(E);
    erase(E, [[400, 300]]);
    E.flushErases();
    expect(E.doc.editGroup(src.id).length).toBeGreaterThan(1);

    const before = E._sceneLogicalState();
    expect(before.byId.size).toBe(1);
    expect(before.byId.has(src.id)).toBe(true);
    const beforeBox = bbox(before.byId.get(src.id).o.type === "fill"
        ? before.byId.get(src.id).o.polys
        : [before.byId.get(src.id).o.pts]);
    const placement = { id: "scene-shared", frame: "0", dx: 80, dy: 25 };
    for (const rec of E.doc.editGroup(src.id)) E.doc.addPlacement(rec.obj.id, placement);
    const after = E._sceneLogicalState();
    const afterBox = bbox(after.byId.get(src.id).o.type === "fill"
        ? after.byId.get(src.id).o.polys
        : [after.byId.get(src.id).o.pts]);
    expect(afterBox.x0 - beforeBox.x0).toBeCloseTo(80, 8);
    expect(afterBox.y0 - beforeBox.y0).toBeCloseTo(25, 8);

    const scenes = E.refreshScenes();
    expect(scenes.length).toBeGreaterThan(0);
    const scene = scenes.find((s) => (E._sceneMembers[s.id] || []).includes(src.id));
    expect(scene).toBeTruthy();
    expect(E._sceneMembers[scene.id].filter((id) => id === src.id)).toHaveLength(1);
});

test("a confirmed cross-tile split gives scenes two logical members and no obsolete source", () => {
    const E = mkEngine();
    E.cam.inPanX = 400 - 16000;
    const src = rectFill(E, 15000, 200, 17000, 400);
    E.setEraserSize(30);
    erase(E, [[400, 150], [400, 450]]);
    E.flushErases();

    const logical = E._sceneLogicalState();
    expect(logical.byId.size).toBe(2);
    expect(logical.byId.has(src.id)).toBe(false);
    const scenes = E.refreshScenes();
    const memberIds = new Set(scenes.flatMap((s) => E._sceneMembers[s.id] || []));
    expect(memberIds).toEqual(new Set(logical.byId.keys()));
});

test("a dense one-gesture multichop creates ordinary global objects with atomic undo/save/scenes", () => {
    const E = mkEngine();
    const src = rectFill(E, 100, 100, 700, 500, 0.6);
    const trail = [];
    for (let x = 130, down = true; x <= 670; x += 45, down = !down) {
        trail.push([x, down ? 80 : 520], [x, down ? 520 : 80]);
        if (x < 670) trail.push([x + 45, down ? 520 : 80]);
    }
    E.setEraserSize(5);
    const started = performance.now();
    erase(E, trail);
    E.flushErases();
    expect(performance.now() - started).toBeLessThan(2500);

    const keys = E._logicalKeys();
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).not.toContain(src.id);
    expect(all(E).every((o) => o.type === "fill" && !o.erase)).toBe(true);
    const scenes = E.refreshScenes();
    const sceneKeys = new Set(scenes.flatMap((s) => E._sceneMembers[s.id] || []));
    expect(sceneKeys).toEqual(new Set(keys));

    E.undo();
    expect(E._logicalKeys()).toEqual([src.id]);
    E.redo();
    expect(E._logicalKeys()).toHaveLength(keys.length);

    const saved = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "multichop" })));
    const E2 = mkEngine();
    E2.loadDrawing(saved);
    expect(new Set(E2._logicalKeys())).toEqual(new Set(E._logicalKeys()));
    expect(E2._logicalKeys().every((key) =>
        E2.doc.editGroup(key).every((rec) => rec.obj.type === "fill"))).toBe(true);
});

test("a near-cut bridge can be finished after crossing deeper and becomes two global objects", () => {
    const E = mkEngine();
    const src = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        // Two lobes joined by a 20-unit bridge.
        polys: [[
            [280, 240], [390, 240], [390, 300], [410, 300], [410, 240], [520, 240],
            [520, 380], [410, 380], [410, 320], [390, 320], [390, 380], [280, 380],
        ]],
        color: "#000", opacity: 1, paths: [],
    };
    E.doc.add(src, "0");
    E._render();

    // Remove all but a sub-unit strip along the bridge's upper edge. It is
    // still globally one object at this level.
    E.setEraserSize(10.5);
    erase(E, [[375, 309], [425, 309]]);
    E.flushErases();
    expect(E._logicalKeys()).toHaveLength(1);

    let guard = 0;
    while (E.activeLevel < 1 && guard++ < 60) E.zoomAt(400, 319.75, -1000);
    expect(E.activeLevel).toBe(1);
    E.setEraserSize(8);
    // At this zoom the surviving sub-unit bridge is hundreds of pixels tall;
    // extend the final cut beyond the viewport so it crosses the whole bridge.
    erase(E, [[400, -200], [400, 800]]);
    E.flushErases();

    expect(E._logicalKeys()).toHaveLength(2);
    expect(all(E).some((o) => o.id === src.id)).toBe(false);
    E.undo();
    expect(E._logicalKeys()).toHaveLength(1);
});

test("a far-deep erase persists one ordinary ownership relay per frame edge", () => {
    const E = mkEngine();
    const src = rectFill(E, 350, 250, 450, 350);
    zoomToLevel(E, 3);
    E.setEraserSize(12);
    erase(E, [[400, 300]]);
    E.flushErases();

    const family = E.doc.editGroup(src.id);
    expect(new Set(family.map((r) => E.lm.depthOf(r.level))))
        .toEqual(new Set([0, 1, 2, 3]));
    for (const rec of family) {
        if (rec.obj.id === src.id) continue;
        const parent = E.doc.getById(rec.obj.srcId);
        expect(parent).not.toBeNull();
        expect(E.lm.depthOf(rec.level) - E.lm.depthOf(parent.level)).toBe(1);
        expect(rec.obj.editId).toBe(src.id);
    }

    E.undo();
    expect(all(E)).toEqual([src]);
    expect(src.windows).toBeUndefined();
});

test("a final level-3 cut resolves through compact parent summaries, not descendant tile enumeration", () => {
    const E = mkEngine();
    zoomToLevel(E, 3);
    const frames = [0, 1, 2, 3].map((depth) => E.lm.spineAt(depth));
    const p3 = E.screenToFrame(400, 300);
    const points = frames.map((frame) => E.lm.mapPointF(p3, frames[3], frame));
    const cells = frames.map((frame, depth) => {
        const range = E.lm.tileRange(frame, {
            left: points[depth][0], top: points[depth][1],
            right: points[depth][0], bottom: points[depth][1],
        });
        return {
            frame, i: range.i0, j: range.j0,
            core: E.lm.tileRect(frame, range.i0, range.j0),
        };
    });
    const windows = [0, 1, 2].map((depth) => {
        const r = E.lm.mapRectF(cells[depth + 1].core, frames[depth + 1], frames[depth]);
        return {
            x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
            seam: Math.abs(E.lm.frameFactor(frames[depth + 1], frames[depth]) *
                E._eraseTileGuard()),
        };
    });

    const rootGate = rectAsBoxForTest(windows[0]);
    const root = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        polys: dumbbell({
            left: rootGate.left - 80, right: rootGate.right + 80,
        }, rootGate, 0.75),
        color: "#000", opacity: 1, paths: [],
    };
    E.doc.add(root, frames[0]);
    let parent = root;
    for (let depth = 0; depth < 3; depth++) {
        const childCore = cells[depth + 1].core;
        const childPolys = depth < 2
            ? dumbbell(childCore, rectAsBoxForTest(windows[depth + 1]), 0.75)
            : [[
                [childCore.left, points[3][1] - 2],
                [childCore.right, points[3][1] - 2],
                [childCore.right, points[3][1] + 2],
                [childCore.left, points[3][1] + 2],
            ]];
        const step = E.doc.eraseRehomeById(
            parent.id, frames[depth + 1],
            [{
                polys: childPolys, attached: true,
                cell: {
                    frame: String(frames[depth + 1]),
                    i: cells[depth + 1].i, j: cells[depth + 1].j,
                },
            }],
            windows[depth],
            {
                x0: childCore.left, y0: childCore.top,
                x1: childCore.right, y1: childCore.bottom,
            },
            { inheritPlacement: false },
        );
        parent = step.pieces[0].obj;
    }
    E._render();
    expect(E._logicalKeys()).toHaveLength(1);

    E.setEraserSize(12);
    erase(E, [[400, 100], [400, 500]]);
    const started = performance.now();
    E.flushErases();
    expect(performance.now() - started).toBeLessThan(1500);
    expect(E._logicalKeys()).toHaveLength(2);
    expect(all(E).some((o) => o.id === root.id)).toBe(false);
    for (const key of E._logicalKeys()) {
        const family = E.doc.editGroup(key);
        expect(new Set(family.map((r) => E.lm.depthOf(r.level))))
            .toEqual(new Set([0, 1, 2, 3]));
        for (const rec of family) {
            if (rec.obj.srcId == null) continue;
            const source = E.doc.getById(rec.obj.srcId);
            expect(source).not.toBeNull();
            expect(E.lm.depthOf(rec.level) - E.lm.depthOf(source.level)).toBe(1);
        }
    }
    const logical = E._sceneLogicalState();
    expect(new Set(logical.byId.keys())).toEqual(new Set(E._logicalKeys()));

    // A multiselect move shares one active-frame placement across both complete
    // hierarchies; it never flattens their mixed-level geometry.
    const leftHit = E._hitTest(300, 300);
    const rightHit = E._hitTest(500, 300);
    expect(leftHit).not.toBeNull();
    expect(rightHit).not.toBeNull();
    expect(E.doc.editKey(E.doc.getById(leftHit).obj))
        .not.toBe(E.doc.editKey(E.doc.getById(rightHit).obj));
    E.setTool("select");
    E.pointerDown(300, 300); E.pointerUp();
    E.pointerDown(500, 300, { ctrlKey: true }); E.pointerUp();
    expect(E.selection.count).toBe(2);
    E.pointerDown(300, 300);
    E.pointerMove(325, 315);
    E.pointerUp();
    const moved = E._selectedRecords();
    expect(moved.every((r) => r.obj.placements && r.obj.placements.length === 1)).toBe(true);
    expect(new Set(moved.map((r) => r.obj.placements[0])).size).toBe(1);
    expect(moved[0].obj.placements[0]).toMatchObject({
        frame: String(frames[3]), dx: 25 / E.cam.inScale, dy: 15 / E.cam.inScale,
    });
    expect(E.doc.editKey(E.doc.getById(E._hitTest(325, 315)).obj))
        .toBe(E.doc.editKey(E.doc.getById(leftHit).obj));
    expect(E.doc.editKey(E.doc.getById(E._hitTest(525, 315)).obj))
        .toBe(E.doc.editKey(E.doc.getById(rightHit).obj));
    zoomOutToLevel(E, 0, 400, 300);
    E.store.cache.clear();
    E.renderer.clear();
    E._render();
    const outwardKeys = new Set(E._lastList.map((o) => {
        const rec = E.doc.getById(o.id);
        return rec ? E.doc.editKey(rec.obj) : o.editId ?? o.id;
    }));
    for (const key of E._logicalKeys()) expect(outwardKeys.has(key)).toBe(true);
    zoomToLevel(E, 3, 400, 300);
    expect(E.doc.editKey(E.doc.getById(E._hitTest(325, 315)).obj))
        .toBe(E.doc.editKey(E.doc.getById(leftHit).obj));
    expect(E.doc.editKey(E.doc.getById(E._hitTest(525, 315)).obj))
        .toBe(E.doc.editKey(E.doc.getById(rightHit).obj));
    E.undo();
    expect(E._selectedRecords().every((r) => !r.obj.placements)).toBe(true);

    const saved = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "deep split" })));
    const E2 = mkEngine();
    E2.loadDrawing(saved);
    expect(E2._logicalKeys()).toHaveLength(2);
    for (const key of E2._logicalKeys()) {
        expect(new Set(E2.doc.editGroup(key).map((r) => E2.lm.depthOf(r.level))))
            .toEqual(new Set([0, 1, 2, 3]));
    }

    E.undo();
    expect(E._logicalKeys()).toEqual([root.id]);
    E.redo();
    expect(E._logicalKeys()).toHaveLength(2);
});
