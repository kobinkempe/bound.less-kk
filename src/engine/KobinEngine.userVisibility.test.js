import KobinEngine from "./KobinEngine";
import { flattenCurve } from "./geometry/clipperOutline";
import { distToPolyline, windingOfPoint } from "./geometry/hittest";

jest.setTimeout(60000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const engine = new KobinEngine(host, { width: w, height: h });
    engines.push(engine);
    return engine;
};
afterEach(() => {
    while (engines.length) engines.pop().destroy();
    document.body.textContent = "";
});

function addRect(E, x0, y0, x1, y1, opacity = 1) {
    const o = {
        type: "fill", origin: "native", id: E.doc.allocId(),
        polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
        color: "#000", opacity, paths: [],
    };
    E.doc.add(o, E.cam.frame);
    E._render();
    return o;
}

function erase(E, pts, radiusPx = 8) {
    E.setEraserSize(radiusPx);
    E.setTool("erasePartial");
    E.pointerDown(...pts[0]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(...pts[i]);
    const stroke = E._drawing;
    E.pointerUp();
    return stroke;
}

function zoomToDepth(E, depth, sx = 400, sy = 300) {
    let guard = 0;
    while (E.activeLevel < depth && guard++ < 200) E.zoomAt(sx, sy, -1000);
    expect(E.activeLevel).toBe(depth);
}

function zoomOutToDepth(E, depth, sx = 400, sy = 300) {
    let guard = 0;
    while (E.activeLevel > depth && guard++ < 200) E.zoomAt(sx, sy, 1000);
    expect(E.activeLevel).toBe(depth);
}

function logicalHit(E, sx, sy) {
    const id = E._hitTest(sx, sy);
    const rec = id == null ? null : E.doc.getById(id);
    return rec ? E.doc.editKey(rec.obj) : null;
}

function screenInkForKey(E, key, sx, sy) {
    const p = E.screenToFrame(sx, sy);
    return E._lastList.some((o) => {
        const rec = E.doc.getById(o.id);
        if (!rec || E.doc.editKey(rec.obj) !== key) return false;
        return o.type === "fill"
            ? windingOfPoint(o.polys, p) !== 0
            : distToPolyline(o.pts, p) <= o.lwFrame / 2;
    });
}

test("a dense curved eraser keeps its live spline footprint through a tiled bake", () => {
    const E = mkEngine();
    // Root tile edge x=16000 is at screen x=400.
    E.cam.inPanX = 400 - 16000;
    const src = addRect(E, 15750, 120, 16250, 480);
    const pts = [];
    for (let y = 150; y <= 450; y += 6) {
        pts.push([400 + 75 * Math.sin((y - 150) / 38), y]);
    }
    const stroke = erase(E, pts, 7);
    const centerline = flattenCurve(
        stroke.pts,
        0.025 / stroke.bakePx,
    );
    const radius = stroke.lwFrame / 2;
    const tiles = E._eraseTiles(stroke, E.cam.frame);
    const masks = tiles.flatMap((tile) =>
        E._eraseTileMask(stroke, E.cam.frame, tile));
    const directSurvivors = tiles.flatMap((tile) => {
        const subject = E._tileSubjectRings(
            src, "0", E.cam.frame, tile, stroke,
        );
        return E._subtractTile(
            subject, E._eraseTileMask(stroke, E.cam.frame, tile), tile, stroke,
        ) || [];
    });
    E.flushErases();

    // Compare the complete silhouette, not two hand-picked probes. Points
    // safely inside the live eraser band must be absent and points safely
    // outside it must remain ink, including both sides of the tile edge.
    const mismatches = [];
    const maskMismatches = [];
    const directMismatches = [];
    for (let sy = 160; sy <= 440; sy += 4) {
        for (let sx = 320; sx <= 480; sx += 4) {
            const p = E.screenToFrame(sx, sy);
            const d = distToPolyline(centerline, p);
            const maskInked = windingOfPoint(masks, p) !== 0;
            const directInked = directSurvivors.some((rings) =>
                windingOfPoint(rings, p) !== 0);
            if ((d < radius - 1 && !maskInked) ||
                (d > radius + 1 && maskInked)) {
                maskMismatches.push({ sx, sy, d, maskInked });
            }
            if (d < radius - 1 && E._hitTest(sx, sy) != null) {
                mismatches.push({ kind: "inside", sx, sy, d });
            }
            if (d > radius + 1 && sx > 325 && sx < 475) {
                if (E._hitTest(sx, sy) == null) {
                    mismatches.push({ kind: "outside", sx, sy, d });
                }
            }
            if ((d < radius - 1 && directInked) ||
                (d > radius + 1 && sx > 325 && sx < 475 && !directInked)) {
                directMismatches.push({ sx, sy, d, directInked });
            }
        }
    }
    expect(maskMismatches).toEqual([]);
    expect(directMismatches).toEqual([]);
    expect(mismatches).toEqual([]);
});

test("moving a deeply re-homed object moves every visible member before and after crossings", () => {
    const E = mkEngine();
    const src = addRect(E, 320, 220, 480, 380);
    zoomToDepth(E, 3);
    erase(E, [[400, 270], [400, 330]], 10);
    E.flushErases();
    expect(new Set(E.doc.editGroup(src.id).map((r) => E.lm.depthOf(r.level))))
        .toEqual(new Set([0, 1, 2, 3]));

    const probes = [[360, 250], [440, 250], [360, 350], [440, 350]];
    for (const p of probes) expect(logicalHit(E, ...p)).toBe(src.id);

    E.setTool("select");
    E.pointerDown(360, 250);
    E.pointerMove(410, 280);
    E.pointerUp();
    for (const [x, y] of probes) {
        expect(screenInkForKey(E, src.id, x + 50, y + 30)).toBe(true);
    }

    zoomOutToDepth(E, 0, 410, 280);
    expect(logicalHit(E, 410, 280)).toBe(src.id);
    zoomToDepth(E, 3, 410, 280);
    for (const [x, y] of probes) {
        expect(screenInkForKey(E, src.id, x + 50, y + 30)).toBe(true);
    }
});

test("a deep erase of a moved ancestor uses bounded placed tiles and keeps its hole", () => {
    const E = mkEngine();
    const src = addRect(E, 300, 200, 500, 400);
    zoomToDepth(E, 5);

    E.setTool("select");
    E.pointerDown(400, 300);
    E.pointerMove(438, 321);
    E.pointerUp();
    expect(src.placements).toHaveLength(1);
    expect(src.placements[0].frame).toBe(E.cam.frame);

    // A moved level-0 object is astronomical in this frame. Rendering and the
    // eraser must both consume the bounded placement-aware chain, never one
    // direct 3000^5 projection.
    const directProjection = jest.spyOn(E.lm, "projectPlacedF");
    E.store.placedCache.clear();
    E._render();
    expect(directProjection).not.toHaveBeenCalledWith(src, "0", E.cam.frame);
    directProjection.mockRestore();

    erase(E, [[400, 300]], 10);
    E.flushErases();
    const erasedFrame = E.cam.frame;
    const erasedCenter = E.screenToFrame(400, 300);
    expect(Object.values(E.nativesByLevel).flat().some((o) => o.erase)).toBe(false);
    expect(logicalHit(E, 400, 300)).toBeNull();
    expect(logicalHit(E, 440, 300)).toBe(src.id);

    zoomOutToDepth(E, 0, 400, 300);
    zoomToDepth(E, 5, 400, 300);
    E.store.cache.clear();
    E.store.placedCache.clear();
    E.renderer.clear();
    E._render();
    expect(E.cam.frame).toBe(erasedFrame);
    const returnedCenter = E.screenToFrame(400, 300);
    expect(returnedCenter[0]).toBeCloseTo(erasedCenter[0], 8);
    expect(returnedCenter[1]).toBeCloseTo(erasedCenter[1], 8);
    expect(logicalHit(E, 400, 300)).toBeNull();
    expect(logicalHit(E, 440, 300)).toBe(src.id);
});

test("a split inside an owned child cell never materializes tile-sized boxes or vanishes outward", () => {
    const E = mkEngine();
    const src = addRect(E, 399.9, 299.9, 400.1, 300.1);
    zoomToDepth(E, 1);
    E.zoomFactorAt(400, 300, 10);
    expect(E.cam.frame).toBe("1");

    // Establish parent -> child ownership without splitting the object.
    erase(E, [[320, 300], [360, 300]], 7);
    E.flushErases();
    expect(E._logicalKeys()).toEqual([src.id]);
    expect(E.doc.editGroup(src.id).some((r) => E.lm.depthOf(r.level) === 1))
        .toBe(true);

    // Now cut all the way through that owned child. This is the path that used
    // to reinterpret seam/correction rectangles as real components.
    erase(E, [[400, -40], [400, 640]], 9);
    E.flushErases();
    const keys = E._logicalKeys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
        const family = E.doc.editGroup(key);
        expect(family.length).toBeGreaterThan(0);
        for (const rec of family) {
            if (rec.level !== E.cam.frame || rec.obj.type !== "fill") continue;
            const xs = rec.obj.polys.flat().map((p) => p[0]);
            const ys = rec.obj.polys.flat().map((p) => p[1]);
            // The source is ~600x600 in this frame. A 24,000x18,000 bbox is a
            // leaked ownership tile, not user ink.
            expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(800);
            expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(800);
        }
    }
    expect(logicalHit(E, 250, 300)).not.toBeNull();
    expect(logicalHit(E, 550, 300)).not.toBeNull();
    expect(logicalHit(E, 400, 300)).toBeNull();

    const leftKey = logicalHit(E, 250, 300);
    const rightKey = logicalHit(E, 550, 300);
    zoomOutToDepth(E, 0, 400, 300);
    // Both globally split pieces must have an outward representation. Test the
    // rendered families, not merely that their document records still exist.
    expect(E._lastList.some((o) => {
        const rec = E.doc.getById(o.id);
        return rec && E.doc.editKey(rec.obj) === leftKey;
    })).toBe(true);
    expect(E._lastList.some((o) => {
        const rec = E.doc.getById(o.id);
        return rec && E.doc.editKey(rec.obj) === rightKey;
    })).toBe(true);
});

test("a coarse move preserves the deep child position after cache eviction and return", () => {
    const E = mkEngine();
    const src = addRect(E, 320, 220, 480, 380);
    zoomToDepth(E, 3);
    erase(E, [[400, 280], [400, 320]], 9);
    E.flushErases();
    const deepFrame = E.cam.frame;
    const deepProbe = E.screenToFrame(440, 250);
    expect(logicalHit(E, 440, 250)).toBe(src.id);

    zoomOutToDepth(E, 0, 440, 250);
    const rootBefore = E.lm.mapPointF(deepProbe, deepFrame, E.cam.frame);
    const rootScreen = [
        rootBefore[0] * E.cam.inScale + E.cam.inPanX,
        rootBefore[1] * E.cam.inScale + E.cam.inPanY,
    ];
    expect(logicalHit(E, ...rootScreen)).toBe(src.id);
    E.setTool("select");
    E.pointerDown(...rootScreen);
    E.pointerMove(rootScreen[0] + 45, rootScreen[1] - 25);
    E.pointerUp();
    const movedFocus = [rootScreen[0] + 45, rootScreen[1] - 25];
    expect(logicalHit(E, ...movedFocus)).toBe(src.id);

    E.store.cache.clear();
    E.renderer.clear();
    E._render();
    expect(logicalHit(E, ...movedFocus)).toBe(src.id);
    zoomToDepth(E, 3, ...movedFocus);
    expect(logicalHit(E, ...movedFocus)).toBe(src.id);
});
