/**
 * The selection indicator: ants on the ink's own edge, from the pieces the
 * renderer draws, in a layer of their own.
 *
 * WHAT THIS REPLACES. Until 2026-08-22 selection was a dashed bounding box,
 * computed in the ACTIVE FRAME's coordinates — so an object a few levels away
 * projected to 877,395 px and its dashed perimeter placed 350,958 dashes per
 * frame, every one of them off screen. 315 ms a frame behind 0.15 ms of
 * JavaScript, which is why five rounds of profiling came back empty: dashing is
 * rasterizer work and no JS timer can see it.
 *
 * From 2026-08-22 to 2026-09-03 the ants were traced from the DOCUMENT: every
 * selected object flattened, clipped to the window, split on joins and mapped
 * to screen on every zoom step. On a dense selection that was 187 ms a step.
 * They now come from the RENDER LIST — the tile pieces already on screen, as
 * arcs, with the tile cuts skipped — built once per render and moved between
 * steps by one transform (`_selectionAnts` has the full account). And they
 * live in their own <svg>, because sharing the drawing's layer made every
 * frame of the crawl re-rasterise the drawing: 50 ms a frame measured, 16.7
 * with the layer split.
 */
import Renderer from "./Renderer";
import KobinEngine from "./KobinEngine";
import { loopRuns, runLength, circleLoop } from "./geometry/antRuns";

jest.setTimeout(60000);

const CFG = { enter: 300, base: 0.1, exit: 0.05, bufferScreens: 1, scale: 1000,
    arcTolerancePx: 0.25, fatWidthPx: 4000, lineTolPx: 0.25, cullPx: 0.3, fadeLoPx: 0.15 };
const W = 800, H = 600;

const mkCam = () => ({
    inScale: 1, inPanX: 0, inPanY: 0, activeLevel: 0, frame: "0",
    frameWindow: () => ({ left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 }),
    levelPointToScreen: (lvl, x, y) => [x, y],
});

const renderers = [];
const mkRenderer = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = new Renderer(host, mkCam(), CFG, { width: W, height: H });
    renderers.push(r);
    return r;
};
const engines = [];
const mkEngine = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: W, height: H });
    engines.push(e);
    return e;
};
afterEach(() => {
    while (renderers.length) renderers.pop().destroy();
    while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } }
});

const svgOf = (r) => r.two.renderer.domElement;
const layerOf = (r) => (r._selEls ? r._selEls.layer : null);
const layersOf = (r) => (r._selEls ? [r._selEls.layer, r._selEls.edgeLayer] : []);
const arrows = (r) => layersOf(r).flatMap((l) => [...l.querySelectorAll("path.bl-sel-arrow")]);
const antPaths = (r) => layersOf(r).flatMap((l) => [...l.querySelectorAll("path.bl-sel-ants")])
    .filter((p) => (p.getAttribute("d") || "").length > 0);
const ants = (r) => antPaths(r)[0] || null;
const rectD = (x0, y0, x1, y1) => "M" + x0 + "," + y0 + "L" + x1 + "," + y0 + "L" + x1 + "," + y1 + "L" + x0 + "," + y1 + "Z";
const data = (over) => Object.assign({ key: 1, runs: [], marks: [], edges: [], inkPx: Infinity }, over);
const totalLen = (got) => got.runs.reduce((a, r) => a + r.len, 0);

describe("selection overlay (renderer)", () => {
    test("no selection draws no overlay at all", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => null);
        r._renderSelOverlay();
        expect(antPaths(r).length).toBe(0);
        expect(document.querySelector(".bl-sel-layer")).toBeNull();
        expect(svgOf(r).querySelector("mask")).toBeNull();
    });

    test("the ants live in their own layer, not in the drawing's <svg>", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [{ d: rectD(10, 10, 200, 120), len: 600 }] }));
        r._renderSelOverlay();
        const layer = layerOf(r);
        expect(layer).not.toBeNull();
        expect(layer.tagName.toLowerCase()).toBe("svg");
        expect(svgOf(r).contains(layer)).toBe(false);
        expect(layer.parentNode).toBe(svgOf(r).parentNode);
        // Its own compositing layer: a crawl re-rasterises the ants, not the
        // 5,343 objects under them (50 ms a frame measured before this).
        expect(layer.style.willChange).toBe("transform");
        expect(layer.style.pointerEvents).toBe("none");
        expect(layer.getAttribute("width")).toBe(String(W));
        expect(layer.getAttribute("height")).toBe(String(H));
    });

    test("a traced run draws ants at the full band, in screen pixels under any transform", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [{ d: rectD(10, 10, 200, 120), len: 600 }], transform: { k: 2, tx: 5, ty: 6 } }));
        r._renderSelOverlay();
        const p = ants(r);
        expect(p).not.toBeNull();
        expect(p.getAttribute("stroke-width")).toBe("2.50");
        expect(p.getAttribute("fill")).toBe("none");
        expect(p.getAttribute("vector-effect")).toBe("non-scaling-stroke");
        // The step is a CSS transform on the layer — compositor work, no repaint.
        expect(r._selEls.layer.style.transform).toBe("matrix(2, 0, 0, 2, 5, 6)");
        expect(r._selEls.world.getAttribute("transform")).toBeNull();
    });

    test("a step with the same key writes only the transform", () => {
        const r = mkRenderer();
        let t = { k: 1, tx: 0, ty: 0 };
        const d = rectD(10, 10, 200, 120);
        r.setSelectionAnts(() => data({ key: 7, runs: [{ d, len: 600 }], transform: t }));
        r._renderSelOverlay();
        const p = ants(r);
        // Scribble on the element: a same-key step must not rewrite it.
        p.setAttribute("d", "M0,0L1,1");
        t = { k: 1.5, tx: 10, ty: 20 };
        r._renderSelOverlay();
        expect(ants(r)).toBe(p);
        expect(p.getAttribute("d")).toBe("M0,0L1,1");
        expect(r._selEls.layer.style.transform).toBe("matrix(1.5, 0, 0, 1.5, 10, 20)");
        // ...and a new key rebuilds.
        r.setSelectionAnts(() => data({ key: 8, runs: [{ d, len: 600 }], transform: t }));
        r._renderSelOverlay();
        expect(ants(r).getAttribute("d")).toBe(d);
    });

    test("the band is 2.5 px on anything but a thin mark", () => {
        const r = mkRenderer();
        // The file strokes at `w + 2.5` against a mask eroded to `w - 2.5`,
        // leaving TWO ribbons of 2.5 px, one per edge. The 5 is the total across
        // both; tracing the outline covers both edges in one pass, so one ribbon
        // is the right width. Above the thin threshold the mark's weight makes
        // no difference, exactly as the file has it.
        for (const inkPx of [10, 26, 500, Infinity]) {
            r.setSelectionAnts(() => data({ key: inkPx, runs: [{ d: "M10,10L200,10L200,120", len: 300 }], inkPx }));
            r._renderSelOverlay();
            expect(ants(r).getAttribute("stroke-width")).toBe("2.50");
        }
    });

    test("a thin mark shrinks the whole pattern, band and dash together", () => {
        const r = mkRenderer();
        const at = (inkPx) => {
            r.setSelectionAnts(() => data({ key: inkPx, runs: [{ d: rectD(10, 10, 400, 300), len: 1360 }], inkPx }));
            r._renderSelOverlay();
            const p = ants(r);
            const [on] = p.getAttribute("stroke-dasharray").split(" ").map(Number);
            return { w: parseFloat(p.getAttribute("stroke-width")), on };
        };
        const full = at(26), thin = at(3);
        // A deliberate departure from the file, which keeps 2.5 px even on a
        // 3 px stroke and buries the mark under its own indicator.
        expect(thin.w).toBeLessThan(full.w);
        expect(thin.on).toBeLessThan(full.on);
        // Band and dash shrink by the SAME factor, so the pattern keeps its
        // shape rather than becoming a different one.
        expect(thin.on / full.on).toBeCloseTo(thin.w / full.w, 2);
        // ...and it never gets thinner than the speck band it collapses into,
        // so a mark of a few pixels still reads as selected.
        expect(thin.w).toBeCloseTo(1.75, 2);
    });

    test("dashes meet up: a whole number of cycles per run, no runt ant", () => {
        const r = mkRenderer();
        // A perimeter deliberately not a multiple of the cycle.
        const len = 2 * (163 + 87);
        r.setSelectionAnts(() => data({ runs: [{ d: rectD(10, 10, 173, 97), len }] }));
        r._renderSelOverlay();
        const p = ants(r);
        const [on, off] = p.getAttribute("stroke-dasharray").split(" ").map(Number);
        const cycles = len / (on + off);
        // What matters is the LEFTOVER at the join, in pixels — that is the
        // runt ant you would see. A whole-cycle fit leaves only the rounding of
        // the dash attribute, well under a tenth of a pixel.
        const leftoverPx = Math.abs(cycles - Math.round(cycles)) * (on + off);
        expect(leftoverPx).toBeLessThan(0.1);
        // ...and the pattern still looks like 5/4, not stretched out of shape.
        expect(on / off).toBeCloseTo(5 / 4, 3);
        expect(on).toBeGreaterThan(6);
        expect(on).toBeLessThan(8);
    });

    test("a run too short for a cycle still MOVES", () => {
        const r = mkRenderer();
        // Drawn solid, this went completely static once zoomed out — the
        // animation ran with no dash to move. It carries the pattern at full
        // size instead and lets it slide across, which is what a speck does.
        r.setSelectionAnts(() => data({ runs: [{ d: "M10,10L14,10", len: 4 }] }));
        r._renderSelOverlay();
        const p = ants(r);
        const [on, off] = p.getAttribute("stroke-dasharray").split(" ").map(Number);
        expect(on).toBeCloseTo(7, 2);        // full size, not crushed to fit
        expect(off).toBeCloseTo(5.6, 2);
        expect(p.style.getPropertyValue("--ao")).toBe("-25.200px");
    });

    test("runs shorter than a cycle share one path; longer ones are fitted on their own", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [
            { d: "M10,10L14,10", len: 4 },                     // under a cycle
            { d: "M30,10L34,10", len: 4 },                     // under a cycle
            { d: "M10,100L200,100L200,200", len: 290 },        // fitted
        ] }));
        r._renderSelOverlay();
        const drawn = antPaths(r);
        expect(drawn.length).toBe(2);
        const shared = drawn.find((p) => (p.getAttribute("d").match(/M/g) || []).length === 2);
        const fitted = drawn.find((p) => p !== shared);
        expect(shared).toBeDefined();
        const [on] = shared.getAttribute("stroke-dasharray").split(" ").map(Number);
        expect(on).toBeCloseTo(7, 2);
        const [onF, offF] = fitted.getAttribute("stroke-dasharray").split(" ").map(Number);
        expect(Math.abs(onF - 7)).toBeGreaterThan(0.001);
        expect(onF / offF).toBeCloseTo(5 / 4, 3);
    });

    test("a speck BLINKS: the pattern slides across a mark shorter than a cycle", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ marks: [{ d: rectD(120, 90, 121, 91) }] }));
        r._renderSelOverlay();
        const drawn = antPaths(r);
        expect(drawn.length).toBe(1);
        // Its outline is shorter than one cycle, so as the offset slides the
        // whole mark passes in and out of a gap — it winks rather than crawls.
        // Fitting a cycle to it, as ordinary runs get, would stop the blink.
        expect(drawn[0].getAttribute("stroke-dasharray")).toBe("3.5 2.8");
        expect(parseFloat(drawn[0].getAttribute("stroke-width"))).toBeCloseTo(1.75, 2);
        expect(drawn[0].style.getPropertyValue("--ao")).toBe("-12.60px");
    });

    test("specks share one path: a thousand of them cost one element", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ marks: [{ d: rectD(100, 100, 101, 101) }, { d: rectD(200, 100, 201, 101) }, { d: rectD(300, 100, 301, 101) }] }));
        r._renderSelOverlay();
        const drawn = antPaths(r);
        expect(drawn.length).toBe(1);
        expect((drawn[0].getAttribute("d").match(/M/g) || []).length).toBe(3);
    });

    test("an object running off the screen gets edge ants and an arrow", () => {
        const r = mkRenderer();
        // Two runs along the sides it leaves through, and one arrow each.
        r.setSelectionAnts(() => data({
            // A long span down the left, a short one across the top.
            edges: [
                { side: "left", from: 60, to: 540, chevron: true },
                { side: "top", from: 200, to: 260, chevron: false },
            ],
        }));
        r._renderSelOverlay();
        // Ants on BOTH spans...
        expect(antPaths(r).length).toBe(2);
        // ...but a chevron only on the long one.
        const a = arrows(r);
        expect(a.length).toBe(1);
        expect(a[0].getAttribute("transform")).toContain("rotate(180)");
        // OPEN, measured at the VERTEX — which is the angle you actually see.
        // Measuring an arm against the horizontal instead reports the
        // supplement, and reading 157 when the vertex was 22.6 is exactly how
        // this ended up a spike twice over.
        const n = a[0].getAttribute("d").match(/-?[\d.]+/g).map(Number);
        const tipX = n[0], tipY = n[1], vertX = n[2];
        const vertex = 2 * Math.atan2(Math.abs(tipY), Math.abs(vertX - tipX)) * 180 / Math.PI;
        expect(vertex).toBeGreaterThan(95);
        expect(vertex).toBeLessThan(125);
        // ...and it stands clear of the edge, not tucked in among the ants.
        expect(parseFloat(a[0].getAttribute("transform").match(/translate\((-?[\d.]+)/)[1]))
            .toBeGreaterThan(20);
        // The band's OUTER side touches the window edge, so its centre sits
        // half a band in — not on the edge, which would hang half of it off.
        const d = antPaths(r)[0].getAttribute("d");
        expect(parseFloat(d.match(/M(-?[\d.]+),/)[1])).toBeCloseTo(2.5 / 2, 2);
        const css = document.getElementById("bl-sel-style").textContent;
        expect(css).toContain("bl-sel-faint{0%,100%{opacity:.5}50%{opacity:.8}}");
    });

    test("the stylesheet is replaced when it changes, not left stale", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [{ d: "M10,10L200,10", len: 190 }] }));
        r._renderSelOverlay();
        const st = document.getElementById("bl-sel-style");
        st.textContent = "/* stale, from an earlier build */";
        Renderer._ensureSelStyle();
        // Same element — no churn — but current content. Bailing out on "it
        // exists" left every animation on whatever rules the session started
        // with, so timing and opacity edits appeared to do nothing.
        expect(document.getElementById("bl-sel-style")).toBe(st);
        expect(st.textContent).toContain("bl-sel-faint");
        expect(st.textContent).not.toContain("stale");
    });

    test("there is no shimmer anywhere, and no solid fallback", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [{ d: "M10,10L200,10L200,120", len: 300 }] }));
        r._renderSelOverlay();
        expect(layerOf(r).querySelector("mask")).toBeNull();
        expect(layerOf(r).querySelector("rect")).toBeNull();
        expect(layerOf(r).querySelector("circle")).toBeNull();
        for (const p of layerOf(r).querySelectorAll("path")) {
            expect(p.getAttribute("stroke-dasharray") || p.getAttribute("class")).toBeTruthy();
        }
        const css = document.getElementById("bl-sel-style").textContent;
        expect(css).not.toContain("valw");
        expect(css).not.toContain("valb");
    });

    test("the overlay is removed when the selection goes away", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ runs: [{ d: "M10,10L200,10L200,120", len: 300 }] }));
        r._renderSelOverlay();
        expect(ants(r)).not.toBeNull();
        r.setSelectionAnts(() => null);
        r._renderSelOverlay();
        expect(document.querySelector(".bl-sel-layer")).toBeNull();
    });

    test("the bounding box is gone: a huge selection rect draws nothing", () => {
        const r = mkRenderer();
        r.setSelection(() => ({ level: "0", rect: { left: 0, top: 0, right: 877395, bottom: 877395 } }));
        expect(r.selGroup.children.length).toBe(0);
    });

    test("the lasso is still drawn, dashed, while it is being made", () => {
        const r = mkRenderer();
        r.setLasso(() => [[10, 10], [200, 40], [180, 300], [20, 260]]);
        r._renderSelection();
        expect(r.selGroup.children.length).toBe(1);
        expect(r.selGroup.children[0].dashes.length).toBeGreaterThan(0);
    });
});

describe("selection indicator (engine)", () => {
    const drawStroke = (E, pts) => {
        E.setTool("pen"); E.setWidth(13);
        E.pointerDown(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
        E.pointerUp();
        const arr = E.doc.at(E.cam.frame);
        return arr[arr.length - 1];
    };

    test("a selected pen stroke is traced — from the piece the renderer draws", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260], [400, 210]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const got = E._selectionAnts();
        expect(got).not.toBeNull();
        expect(got.runs.length).toBeGreaterThan(0);
        expect(got.plain).toBeUndefined();
        // Arcs go as cubics, never as chords: the path data has curves in it.
        expect(got.runs.some((r) => r.d.includes("C"))).toBe(true);
    });

    test("a RESOLVED stroke still reports its ink weight", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260], [400, 210]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const got = E._selectionAnts();
        // `lwFrame` is gone once a stroke resolves to a perimeter, and the band
        // silently defaulted to its full 5 px for every settled stroke — which
        // is what made the indicator a red splat on a small object. The weight
        // comes from the geometry (2 x area / perimeter, exact on arcs).
        expect(isFinite(got.inkPx)).toBe(true);
        expect(got.inkPx).toBeGreaterThan(5);
        expect(got.inkPx).toBeLessThan(40);
    });

    test("the decision is made once per render and a zoom step reuses it", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260], [400, 210]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const a = E._selectionAnts();
        // A small in-level zoom: the camera moved, nothing was re-rendered.
        E.cam.zoomFactorAt(400, 300, 1.02);
        const b = E._selectionAnts();
        expect(b.key).toBe(a.key);
        expect(b.runs).toBe(a.runs);
        expect(b.transform.k).toBeCloseTo(a.transform.k * 1.02, 9);
        // A render — the tile set changed, say — decides again.
        E._render();
        const c = E._selectionAnts();
        expect(c.key).not.toBe(a.key);
    });

    test("the lasso appears while you drag it and clears on release", () => {
        const E = mkEngine();
        E.setTool("select");
        E.pointerDown(120, 120);
        for (const p of [[400, 140], [420, 420], [140, 400]]) E.pointerMove(p[0], p[1]);
        expect(E.renderer.selGroup.children.length).toBe(1);
        expect(E.renderer.selGroup.children[0].dashes.length).toBeGreaterThan(0);
        E.pointerUp();
        expect(E.renderer.selGroup.children.length).toBe(0);
    });

    test("switching away from the select tool drops the selection", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260]]);
        E.setTool("select");
        E._setSelection([o.id]);
        expect(E.selection).not.toBeNull();
        E.setTool("pen");
        expect(E.selection).toBeNull();
        expect(E._selectionAnts()).toBeNull();
    });

    test("the indicator belongs to the select tool and nothing else", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260]]);
        E.setTool("select");
        E._setSelection([o.id]);
        expect(E._selectionAnts()).not.toBeNull();
        E.tool = "erase";
        expect(E._selectionAnts()).toBeNull();
    });

    test("ants never run along a tile cut: a piece's clip rectangle is a seam", () => {
        const E = mkEngine();
        // A piece as the tile store makes one: a shape clipped to a tile, with
        // the rectangle that cut it. Its boundary has two free edges and three
        // that lie along the cut.
        const clip = { left: 0, top: 0, right: 100, bottom: 100 };
        const L = (A, B) => ({ line: true, A, B });
        const loop = [L([20, 100], [0, 60]), L([0, 60], [30, 0]), L([30, 0], [100, 0]), L([100, 0], [100, 100]), L([100, 100], [20, 100])];
        const piece = { id: 987654, type: "shape", loops: [loop], clip };
        const rects = E._selSeamRects(piece, E._selTable({ ids: [] }), E.cam.frame, new Map());
        expect(rects.length).toBe(1);
        const runs = loopRuns(loop, rects);
        expect(runs.length).toBe(1);
        expect(runs[0].closed).toBe(false);
        expect(runLength(runs[0].pieces)).toBeCloseTo(Math.hypot(20, 40) + Math.hypot(30, 60), 9);
        // Nothing emitted lies along the cut.
        for (const p of runs[0].pieces) {
            const onTop = p.A[1] === 0 && p.B[1] === 0, onRight = p.A[0] === 100 && p.B[0] === 100, onBottom = p.A[1] === 100 && p.B[1] === 100;
            expect(onTop || onRight || onBottom).toBe(false);
        }
    });

    test("a mark too small to see is still shown — as its frame's mark, never a box around a speck", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[400, 300], [404, 303]]);
        E.setTool("select");
        E._setSelection([o.id]);
        for (let i = 0; i < 400; i++) {
            E.zoomAt(400, 300, 120);
            const got = E._selectionAnts();
            if (!got) continue;
            const spanPx = (o._bbox ? Math.max(o._bbox.x1 - o._bbox.x0, o._bbox.y1 - o._bbox.y0) : 0) * E.cam.inScale;
            if (spanPx <= 1.5) {
                expect(got.marks.length + got.runs.length).toBeGreaterThan(0);
                expect(got.marks.length).toBe(1);       // a dot, not a ring
                expect(got.dots).toBeUndefined();
                return;
            }
        }
        throw new Error("never reached a one-pixel mark");
    });

    test("marks piled onto one pixel are one mark, not one each", () => {
        const E = mkEngine();
        const ids = [];
        // Eight separate marks within a couple of pixels of each other.
        for (let i = 0; i < 8; i++) ids.push(drawStroke(E, [[400 + i * 0.3, 300], [401 + i * 0.3, 301]]).id);
        E.setTool("select");
        E._setSelection(ids);
        expect(E.selection.ids.length).toBe(8);
        for (let i = 0; i < 400; i++) {
            E.zoomAt(400, 300, 120);
            const got = E._selectionAnts();
            if (!got) continue;
            const b = E._selTable(E.selection).byLevel.get(E.cam.frame).box;
            const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * E.cam.inScale;
            if (span < 2) {
                // All eight sit on the same pixel or two; one trace each would
                // be eight stacked outlines saying one thing. Their frame's
                // content is under the mark size: one dot.
                expect(got.runs.length).toBe(0);
                expect(got.marks.length).toBe(1);
                return;
            }
        }
        throw new Error("never collapsed onto a pixel");
    });

    test("the ants outlive the ink: zoomed past the cull, the frame's mark stays", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[400, 300], [430, 320], [460, 300]]);
        E.setTool("select");
        E._setSelection([o.id]);
        // Zoom out until the renderer has stopped painting the drawing entirely.
        for (let i = 0; i < 600; i++) {
            E.zoomAt(400, 300, 120);
            E._render();
            if (E._objs().length === 0) {
                const got = E._selectionAnts();
                // Nothing is being drawn, and the indicator is still there —
                // marking where the selected thing is. This is the point of it.
                expect(got).not.toBeNull();
                expect(got.runs.length + got.marks.length).toBeGreaterThan(0);
                return;
            }
        }
        throw new Error("the drawing never culled");
    });

    test("a frame's content under 2 px is one dot, its members unvisited; above it every piece is traced", () => {
        const E = mkEngine();
        const ids = [];
        // Forty marks in a 60 px square. Zoomed out twenty steps the square is
        // about 11 px: over the mark size, so each mark is traced on its own
        // (Kobin, 2026-09-03: first "only objects <5px", then, from the
        // phone, 2 px). Zoomed out until it is under 2 px: one dot, and no
        // piece looked at.
        for (let i = 0; i < 40; i++) {
            const x = 380 + (i % 8) * 8, y = 280 + Math.floor(i / 8) * 12;
            ids.push(drawStroke(E, [[x, y], [x + 6, y + 4]]).id);
        }
        E.setTool("select");
        E._setSelection(ids);
        for (let i = 0; i < 20; i++) E.zoomAt(400, 300, 120);
        const traced = E._selectionAnts();
        expect(traced).not.toBeNull();
        expect(traced.marks.length).toBe(0);
        expect(traced.runs.length).toBeGreaterThanOrEqual(20);
        expect(traced.runs.some((r) => r.d.endsWith("Z") && (r.d.match(/L/g) || []).length === 3 && !r.d.includes("C"))).toBe(false);   // no box
        for (let i = 0; i < 100; i++) {
            E.zoomAt(400, 300, 120);
            const b = E._selTable(E.selection).byLevel.get(E.cam.frame).box;
            if (Math.max(b.x1 - b.x0, b.y1 - b.y0) * E.cam.inScale >= 2) continue;
            // A decision holds for a quarter octave of zoom, so the switch to
            // a dot can lag the threshold by a step or two; a render decides.
            E._render();
            const dot = E._selectionAnts();
            expect(dot.runs.length).toBe(0);
            expect(dot.marks.length).toBe(1);
            expect(E._selDec.pieces.length).toBe(0);
            return;
        }
        throw new Error("never got under 2 px");
    });

    test("a lone stroke a few pixels wide is traced on its own edge, never boxed", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[400, 300], [430, 305]]);
        E.setTool("select");
        E._setSelection([o.id]);
        // Zoom out until it is about 15 px: over the mark size, a traceable
        // outline. Kobin's second screenshot had exactly this as a box.
        for (let i = 0; i < 400; i++) {
            E.zoomAt(400, 300, 120);
            const b = o._bbox;
            const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * E.cam.inScale;
            if (span <= 15) {
                const got = E._selectionAnts();
                expect(got.marks.length).toBe(0);
                expect(got.runs.length).toBeGreaterThan(0);
                expect(got.runs.every((r) => r.d.includes("C"))).toBe(true);   // the piece's own arcs
                return;
            }
        }
        throw new Error("never reached 15 px");
    });

    test("a piece of a re-homed family never makes its frame a dot", () => {
        const E = mkEngine();
        const parent = drawStroke(E, [[200, 300], [600, 300]]);
        // A child frame, and a tiny piece of the parent's family living in it.
        const kid = E.lm._addFrame("0/0,0", "0", { i: 0, j: 0 }, 1);
        const piece = { type: "shape", id: 777777, origin: "native", color: "#000", opacity: 1,
            loops: [circleLoop(0, 0, 1)], editId: parent.id };
        E.doc.add(piece, kid.id);
        E.setTool("select");
        E._setSelection([parent.id]);
        const table = E._selTable(E.selection);
        expect(table.ids.has(777777)).toBe(true);
        expect(table.cross.has(777777)).toBe(true);
        expect(table.cross.has(parent.id)).toBe(true);
        expect(table.byLevel.get(kid.id).box).toBeNull();
        const got = E._selectionAnts();
        expect(got.marks.length).toBe(0);
        expect(got.runs.length).toBeGreaterThan(0);
    });

    test("there is no budget: sixty strokes the width of the view all get their ants", () => {
        const E = mkEngine();
        const ids = [];
        // Some 80,000 px of outline. The August cap of 24,000 px was removed
        // on 2026-09-03 (Kobin: "take off the budget"); every piece on screen
        // is outlined and nothing is drawn solid.
        for (let i = 0; i < 60; i++) {
            const y = 20 + i * 9;
            ids.push(drawStroke(E, [[40, y], [400, y + 3], [760, y]]).id);
        }
        E.setTool("select");
        E._setSelection(ids);
        const got = E._selectionAnts();
        expect(got.plain).toBeUndefined();
        expect(got.runs.length).toBeGreaterThanOrEqual(60);
        expect(totalLen(got)).toBeGreaterThan(24000 * 2);
    });

    test("the ants ride along with a drag, and are decided afresh from the moved ink when it ends", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[300, 300], [400, 330], [500, 300]]);
        E.setTool("select");
        // Tap to select (on the ink: the centreline passes (400, 330)), then
        // press on it and drag it 60 px right in three moves.
        E.pointerDown(400, 329); E.pointerUp();
        expect(E.selection && E.selection.ids).toEqual([o.id]);
        const before = E._selectionAnts();
        E.pointerDown(400, 329);
        E.pointerMove(420, 329);                       // past the 8 px threshold: the drag begins
        const a = E._selectionAnts();
        E.pointerMove(440, 329);
        const b = E._selectionAnts();
        E.pointerMove(460, 329);
        const c = E._selectionAnts();
        // One decision for the whole drag, moved by the pointer's travel.
        expect(b.key).toBe(a.key);
        expect(c.key).toBe(a.key);
        expect(b.runs).toBe(a.runs);
        expect(b.transform.tx - a.transform.tx).toBeCloseTo(20, 6);
        expect(c.transform.tx - a.transform.tx).toBeCloseTo(40, 6);
        expect(c.transform.ty - a.transform.ty).toBeCloseTo(0, 6);
        E.pointerUp();
        // Pen-up: a fresh decision from where the ink now is — different path
        // data, no leftover offset — and the ink really did move 60 px.
        const after = E._selectionAnts();
        expect(after.key).not.toBe(a.key);
        expect(after.runs[0].d).not.toBe(before.runs[0].d);
        const bx = (r) => { const m = r.runs[0].d.match(/M(-?[\d.]+),(-?[\d.]+)/); return parseFloat(m[1]) * r.transform.k + r.transform.tx; };
        expect(bx(after) - bx(before)).toBeCloseTo(60, 0);
    });

    test("a native's loops are replaced in place by a move, and the ants follow the new loops", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[300, 300], [400, 330], [500, 300]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const first = E._selectionAnts();
        // Move it through the document, as undo or a programmatic edit would.
        const rec = E.doc.getById(o.id);
        E.doc.setGeometryById(o.id, E.doc.constructor.translateGeometry(E.doc.constructor.snapGeometry(rec.obj), 100, 0));
        E._render();
        const second = E._selectionAnts();
        expect(second.key).not.toBe(first.key);
        const bx = (r) => { const m = r.runs[0].d.match(/M(-?[\d.]+),(-?[\d.]+)/); return parseFloat(m[1]) * r.transform.k + r.transform.tx; };
        expect(bx(second) - bx(first)).toBeCloseTo(100 * E.cam.inScale, 0);
    });

    test("a stroke running off the screen reports the side it leaves through, and only where its ink is", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[-200, 300], [200, 300]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const got = E._selectionAnts();
        const left = got.edges.filter((e) => e.side === "left");
        expect(left.length).toBe(1);
        // A 13 px stroke centred on y = 300 meets the left side over roughly
        // its own width, not the whole side (the F39 first-cut defect, where a
        // tile piece's boundary read as ink from top to bottom).
        expect(left[0].to - left[0].from).toBeGreaterThan(8);
        expect(left[0].to - left[0].from).toBeLessThan(30);
        expect(left[0].from).toBeGreaterThan(280);
        expect(left[0].to).toBeLessThan(320);
        expect(got.edges.some((e) => e.side !== "left")).toBe(false);
    });
});
