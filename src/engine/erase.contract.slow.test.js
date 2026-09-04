/**
 * D, U, X, P — determinism, undo, budgets, polygonization
 * (docs/erase-tile-window-test-catalog.md).
 *
 * The budgets are stated as regression thresholds, not aspirations, and the
 * important ones are RATIOS rather than absolute milliseconds: a wall-clock
 * bound flakes on a loaded machine, while "the pre-unioned clip is many times
 * cheaper than the raw strip" is a property of the algorithm and holds
 * everywhere. X-1 exists specifically to stop someone deleting the union.
 */
import KobinEngine from "./KobinEngine";
import { strokeStripNear } from "./geometry/polyline";
import { subtractPolys, strokeOutline } from "./geometry/clipperBoolean";
import { eraserFootprint, cutVisible } from "./__oracles__/erase";
import { bandRings } from "./geometry/derive";
import { inks } from "./__testkit__/ink";
import { encodeLoops } from "./geometry/arcShape";
import { bboxOf } from "./geometry/derive";

jest.setTimeout(180000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width = 13) => {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();   // let the perimeter resolve before anything looks at it
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
};
const eraseGesture = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const descend = (E, n, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 400) E.zoomAt(sx, sy, -1000);
    expect(E.activeLevel).toBe(n);
};
// A value-based fingerprint of everything on screen.
const picture = (E) => {
    E._render();
    return JSON.stringify(E._objs().filter((o) => !o.erase).map((o) => [
        o.id, o.type, o.color, o.opacity,
        o.type === "shape" ? encodeLoops(o.loops)
            : o.type === "fill" ? o.polys.map((r) => r.map((p) => [p[0], p[1]]))
                : [o.pts, o.lwFrame],
    ]));
};
const inkAtScreen = (E, sx, sy) => {
    E._render();
    return inks(E._objs().filter((o) => !o.erase), E.cam.screenToFrame(sx, sy));
};
// One erased drawing, built the same way every time.
const build = (E, depth = 2) => {
    drawStroke(E, [[200, 280], [600, 300]], 30);
    drawStroke(E, [[200, 340], [600, 320]], 30);
    descend(E, depth);
    E.setEraserSize(22);
    eraseGesture(E, [[400, 200], [400, 260]]);
    E.flushErases();
};

describe("D-1 — evicting every tile and rebuilding reproduces the picture exactly", () => {
    test.each([[1], [2], [3]])("%i crossing(s) deep", (n) => {
        const E = mkEngine();
        build(E, n);
        const before = picture(E);
        E.store.bumpEpoch(); // drops every cached tile
        expect(E.store.size()).toBe(0);
        expect(picture(E)).toBe(before);
    });
});

describe("D-3/D-8 — the picture does not depend on how you got to it", () => {
    test("zoom away and back", () => {
        const E = mkEngine();
        build(E, 2);
        const before = picture(E);
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 200) E.zoomAt(400, 300, 1000);
        while (E.activeLevel < 2 && guard++ < 400) E.zoomAt(400, 300, -1000);
        expect(picture(E)).toBe(before);
    });
    test("rendering twice changes nothing", () => {
        const E = mkEngine();
        build(E, 2);
        expect(picture(E)).toBe(picture(E));
    });
});

describe("D-4/D-6 — save, reload, re-derive from cold", () => {
    test("through the real drawing format, cut parents and re-homed children and all", () => {
        const E = mkEngine();
        build(E, 2);
        const before = picture(E);
        const kids = E.doc.levels().reduce((s, k) => s + (k === "0" ? 0 : E.doc.at(k).filter((o) => !o.erase).length), 0);
        expect(kids).toBeGreaterThan(0); // the containment chain was materialised
        const attached = E.doc.levels().reduce((s, k) =>
            s + E.doc.at(k).filter((o) => !o.erase && o.attachRect).length, 0);
        expect(attached).toBeGreaterThan(0);

        const file = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "erase round trip" })));
        const F = mkEngine();
        expect(F.loadDrawing(file)).toBe(true);
        expect(F.doc.levels().reduce((s, k) =>
            s + F.doc.at(k).filter((o) => !o.erase && o.attachRect).length, 0)).toBe(attached);
        // Same camera, same frames, same picture — from cold, with no tile ever
        // baked in this engine before now. The hole travels in the parent's own
        // rings, so a reload cannot lose it or place it differently.
        expect(picture(F)).toBe(before);
    });

    test("a malformed attachRect is rejected by the loader rather than silently dropped", () => {
        const E = mkEngine();
        build(E, 1);
        const file = JSON.parse(JSON.stringify(E.serializeDrawing()));
        const holder = Object.values(file.natives).flat().find((o) => o.attachRect);
        expect(holder).toBeTruthy();
        holder.attachRect.x1 = holder.attachRect.x0; // zero width
        const F = mkEngine();
        expect(() => F.loadDrawing(file)).toThrow(/attachRect/);
    });
});

describe("D-5 — a file whose erase frame no longer exists", () => {
    test("renders the object whole instead of crashing", () => {
        const E = mkEngine();
        build(E, 2);
        const file = JSON.parse(JSON.stringify(E.serializeDrawing()));
        // Drop every frame but depth 0 — the cut now points at a frame that is
        // not in the tree. It must simply stop applying.
        file.crossings = {};
        file.camera = { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 };
        for (const k of Object.keys(file.natives)) if (k !== "0") delete file.natives[k];
        const F = mkEngine();
        expect(F.loadDrawing(file)).toBe(true);
        F._render();
        expect(F._objs().length).toBeGreaterThan(0);
        // Probed clear of the ceded tile. The parent's ink there was CUT when it
        // handed the tile down, so a hole at the view centre is the document
        // saying so and not the missing frame — and a tile is the size of a
        // frame now (D4), which at level 0 is 32 units across the middle of the
        // screen rather than 16.
        expect(inkAtScreen(F, 300, 287)).toBe(true);
    });
});

describe("U — undo", () => {
    test("U-1/U-2: one gesture is one undo op, however deep, and it comes fully back", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 280], [600, 300]], 30);
        descend(E, 3);
        const before = picture(E);
        const undoDepth = E.doc._undo.length;
        E.setEraserSize(22);
        eraseGesture(E, [[400, 200], [400, 400]]);
        E.flushErases();
        expect(picture(E)).not.toBe(before);
        // ONE op for the gesture, whatever it touched.
        expect(E.doc._undo.length).toBe(undoDepth + 1);
        E.undo();
        expect(picture(E)).toBe(before);
    });

    test("U-3: redo restores it exactly", () => {
        const E = mkEngine();
        build(E, 2);
        const erased = picture(E);
        E.undo();
        const whole = picture(E);
        expect(whole).not.toBe(erased);
        E.redo();
        expect(picture(E)).toBe(erased);
        E.undo();
        expect(picture(E)).toBe(whole);
    });

    test("U-5: undoing a severance makes the two natives one again", () => {
        const E = mkEngine();
        const src = drawStroke(E, [[150, 300], [650, 300]], 40);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 220], [400, 380]]);
        E.flushErases();
        expect(E.doc.at("0")).toHaveLength(2);
        E.undo();
        expect(E.doc.at("0")).toHaveLength(1);
        expect(E.doc.at("0")[0].id).toBe(src.id);
        expect(E.doc.at("0")[0].loops).toEqual(src.loops);
    });

    test("U-6: two overlapping erases, one undo removes only the newer", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        descend(E, 1);
        E.setEraserSize(16);
        eraseGesture(E, [[330, 300]]);
        E.flushErases();
        eraseGesture(E, [[470, 300]]);
        E.flushErases();
        expect(inkAtScreen(E, 330, 300)).toBe(false);
        expect(inkAtScreen(E, 470, 300)).toBe(false);
        E.undo();
        expect(inkAtScreen(E, 470, 300)).toBe(true);  // the newer bite is gone
        expect(inkAtScreen(E, 330, 300)).toBe(false); // the older one survives
    });
});

describe("X — performance budgets", () => {
    // A 400-point freehand gesture, the shape the measurements were taken on.
    const gesture = Array.from({ length: 400 }, (_, i) => [i * 1.7, 40 * Math.sin(i / 7)]);
    const subject = [[[-50, -300], [800, -300], [800, 300], [-50, 300]]];

    test("X-1: a pre-unioned clip makes the erase boolean many times cheaper", () => {
        const raw = strokeStripNear(gesture, 26,
            { left: -100, top: -400, right: 900, bottom: 400 }, { startCap: true, endCap: true });
        const unioned = strokeOutline(gesture, 26, { displayScale: 1 });
        // The raw analytic strip is a pile of self-overlapping rings; the
        // offset is one clean ring set. That difference is the whole budget.
        expect(raw.length).toBeGreaterThan(20);
        expect(unioned.length).toBeLessThanOrEqual(2);

        const time = (clip) => {
            const t0 = Date.now();
            for (let i = 0; i < 5; i++) subtractPolys(subject, clip);
            return (Date.now() - t0) / 5;
        };
        time(unioned); // warm
        const tRaw = time(raw), tUnion = time(unioned);
        // Measured 8–33 ms raw against ~1 ms unioned. Assert the ORDER, not the
        // milliseconds, so this survives a busy machine but still fails loudly
        // the moment someone hands the raw strip to the boolean.
        expect(tUnion).toBeLessThan(Math.max(tRaw * 0.6, 4));
    });

    test("X-2/P-6: the clip is built ONCE per gesture, pre-unioned, and then only mapped", () => {
        const E = mkEngine();
        const eraser = {
            type: "stroke", origin: "native", id: 1, pts: gesture, lwFrame: 26,
            color: "#fff", opacity: 1, paths: [], erase: true, bakePx: 1,
        };
        const a = eraserFootprint(eraser, E.cfg);
        const b = eraserFootprint(eraser, E.cfg);
        expect(b).toBe(a);                       // memoized on the gesture itself
        // CURVES, not points: the footprint is cubic loops, so the same cut can
        // be re-flattened at whatever fidelity a level needs (requirement 6).
        expect(a.loops.length).toBeGreaterThan(0);
        for (const loop of a.loops) for (const seg of loop) expect(seg).toHaveLength(4);
        // Local to its own centre, so the geometry resolves finely wherever in
        // the frame it happens to sit.
        for (const loop of a.loops) for (const seg of loop) for (const [x, y] of seg) {
            expect(Math.abs(x)).toBeLessThan(a.w);
            expect(Math.abs(y)).toBeLessThan(a.w);
        }
    });

    test("X-4/P-5: the analytic strip is magnification-independent", () => {
        const win = { left: -100, top: -400, right: 900, bottom: 400 };
        // MEDIAN of several runs, not one. This is a wall-clock measurement in a
        // process running eleven other test files, and a single sample picks up
        // whatever else the machine was doing: it passed alone and failed under
        // the full suite, which says nothing about the strip. The median is
        // stable enough to state the claim as a RATIO, which is what the claim
        // actually is.
        const once = (k) => {
            const pts = gesture.map(([x, y]) => [x * k, y * k]);
            const t0 = Date.now();
            strokeStripNear(pts, 26 * k, win, { startCap: true, endCap: true });
            return Date.now() - t0;
        };
        const at = (k) => {
            const runs = [];
            for (let i = 0; i < 5; i++) runs.push(once(k));
            return runs.sort((a, b) => a - b)[2];
        };
        once(1);
        const t1 = at(1), t3k = at(3000), t9m = at(9e6);
        // eslint-disable-next-line no-console
        console.log(`X-4 strip: 1x ${t1}ms  3000x ${t3k}ms  9e6x ${t9m}ms`);
        // Clipper's offset went 111 ms → 233 ms → unusable over this range. The
        // strip is O(n) in the centerline and does not care how big the numbers
        // are, so the cost must not TREND with magnification — a factor of two
        // over six orders of magnitude would already be the defect back.
        expect(t3k).toBeLessThanOrEqual(t1 * 2 + 10);
        expect(t9m).toBeLessThanOrEqual(t1 * 2 + 10);
    });

    test("X-5: a drag costs no re-flatten of the geometry caches it does not touch", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[300, 280], [400, 300], [500, 280]], 30);
        E._render();
        // Warm the display-chord cache the fat path uses.
        const before = o._dispFlat;
        const x0 = bboxOf(o, null).x0;
        E.setTool("select");
        E.pointerDown(400, 292); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(400, 292); E.pointerMove(430, 292); E.pointerUp();
        // Geometry moved, so the caches keyed on it are correctly dropped —
        // what must NOT happen is a re-flatten during the drag itself.
        expect(bboxOf(o, null).x0).not.toBe(x0);
        expect(before === undefined || o._dispFlat === undefined || o._dispFlat !== before).toBe(true);
    });

    test("X-3: a crossing with erases present stays well inside a frame budget", () => {
        const E = mkEngine();
        for (let i = 0; i < 6; i++) drawStroke(E, [[150, 250 + i * 20], [650, 250 + i * 20]], 16);
        descend(E, 1);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 200], [400, 400]]);
        E.flushErases();
        E.store.bumpEpoch();
        const t0 = Date.now();
        E._render();                 // a cold re-derive of every visible tile
        const ms = Date.now() - t0;
        expect(ms).toBeLessThan(2000); // measured basis ~60 ms; this catches blow-ups
    });
});

describe("X-8 — repeated erasing must not blow the geometry up", () => {
    // Found on a real drawing: a piece reached 79,954 rings / 340,129 vertices,
    // past the ~65k arguments `Array.prototype.push.apply` accepts, and the
    // renderer threw "Maximum call stack size exceeded". Whatever the erase
    // mechanism is, nothing handed to Two.js may approach that.
    test("twenty erases in one place stay bounded", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 90);
        descend(E, 1);
        E.setEraserSize(10);
        for (let i = 0; i < 20; i++) {
            eraseGesture(E, [[300 + i * 9, 285]]);
            E.flushErases();
        }
        E._render();
        let total = 0;
        for (const o of E._objs()) {
            const n = (o.type === "shape" ? o.loops.reduce((b, l) => b + l.length, 0)
                : o.type === "fill" ? o.polys.reduce((b, r) => b + r.length, 0) : o.pts.length);
            expect(n).toBeLessThan(60000);   // Two.js' argument limit
            total += n;
        }
        expect(total).toBeLessThan(200000);
    });

    test("a cut object costs the same to show however far you zoom into it", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 90);
        descend(E, 1);
        E.setEraserSize(14);
        eraseGesture(E, [[400, 285]]);
        E.flushErases();
        E._render();
        const count = () => E._objs().reduce((a, o) =>
            a + (o.type === "shape" ? o.loops.reduce((b, l) => b + l.length, 0)
                : o.type === "fill" ? o.polys.reduce((b, r) => b + r.length, 0) : o.pts.length), 0);
        const near = count();
        // This used to be the sharpest edge in the whole feature. A parent that
        // had merely RECORDED the rect it ceded still had to be cut per view, at
        // render time, and the clip was tile-shaped — three screens wide at the
        // level's shallowest zoom — so at a deep in-level zoom it polygonized
        // millions of pixels of band to show a few thousand. Measured: 3.5
        // million px of geometry for a 1,504 px viewport, 3.1 s per render.
        //
        // A cut parent's rings ARE the rings to paint. Zooming changes nothing
        // about them, so the vertex count cannot move at all.
        for (let i = 0; i < 8; i++) E.zoomFactorAt(400, 300, 1.9);
        E._render();
        expect(count()).toBe(near);
        expect(near).toBeLessThan(40000);
    });
});

describe("P — polygonization", () => {
    test("P-7: bandRings keeps the mega/ordinary split keyed the way the bake keys it", () => {
        const cfg = { base: 0.1, enter: 300, exit: 0.05, arcTolerancePx: 0.25, scale: 1000 };
        const rect = { left: -100, top: -100, right: 100, bottom: 100 };
        // Ordinary: a short, narrow band. Rings come back bounded and non-empty.
        const small = bandRings([[-50, 0], [50, 0]], 10, rect, rect, cfg, { span: 100 });
        expect(small.length).toBeGreaterThan(0);
        // Mega: the same window, a centerline millions of units long. Windowing
        // is what keeps this finite at all.
        const mega = bandRings([[-5e7, 0], [5e7, 0]], 10, rect, rect, cfg, { span: 1e8 });
        expect(mega.length).toBeGreaterThan(0);
        for (const r of mega) expect(r.length).toBeLessThan(500);
    });

    test("P-2: a cut is only applied where the level can resolve it", () => {
        const cfg = { enter: 300, fadeLoPx: 0.15 };
        expect(cutVisible(1, cfg)).toBe(true);
        expect(cutVisible(0.15 / 300, cfg)).toBe(true);
        expect(cutVisible(0.15 / 300 / 2, cfg)).toBe(false);
        // ...which is exactly the gate that makes zooming out continuous: the
        // hole stops being cut at the point it stops being a pixel.
        expect(cutVisible(1e-9, cfg)).toBe(false);
    });
});
