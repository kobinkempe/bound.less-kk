/**
 * The selection indicator: ants on the object's true edge, shimmer in its ink.
 *
 * WHAT THIS REPLACES. Until 2026-08-22 selection was a dashed bounding box,
 * computed in the ACTIVE FRAME's coordinates — so an object a few levels away
 * projected to 877,395 px and its dashed perimeter placed 350,958 dashes per
 * frame, every one of them off screen. 315 ms a frame behind 0.15 ms of
 * JavaScript, which is why five rounds of profiling came back empty: dashing is
 * rasterizer work and no JS timer can see it.
 *
 * The replacement is bounded by construction rather than by a cap: the ants run
 * along the object's own boundary, clipped to the view and culled to a 64 px
 * margin, with every tile JOIN dropped. When the ink floods the view there is no
 * boundary on screen at all, and the shimmer carries the state instead.
 */
import Renderer from "./Renderer";
import KobinEngine from "./KobinEngine";

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
const arrows = (r) => [...svgOf(r).querySelectorAll("path.bl-sel-arrow")];
const antPaths = (r) => [...svgOf(r).querySelectorAll("path.bl-sel-ants")]
    .filter((p) => (p.getAttribute("d") || "").length > 0);
const ants = (r) => antPaths(r)[0] || null;
const antLength = (r) => {
    let total = 0;
    for (const p of antPaths(r)) {
        let prev = null;
        for (const cmd of p.getAttribute("d").split(/(?=[ML])/)) {
            const m = cmd.trim().match(/^([ML])\s*(-?[\d.]+),(-?[\d.]+)$/);
            if (!m) { prev = null; continue; }
            const pt = [parseFloat(m[2]), parseFloat(m[3])];
            if (m[1] === "L" && prev) total += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
            prev = pt;
        }
    }
    return total;
};
const data = (over) => Object.assign({ rings: [], fine: [], fills: [], covered: false }, over);

describe("selection overlay (renderer)", () => {
    test("no selection draws no overlay at all", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => null);
        r._renderSelOverlay();
        expect(antPaths(r).length).toBe(0);
        expect(svgOf(r).querySelector("mask")).toBeNull();
    });

    test("a traced selection draws ants at the full band", () => {
        const r = mkRenderer();
        const ring = [[10, 10], [200, 10], [200, 120], [10, 120]];
        r.setSelectionAnts(() => data({ rings: [ring], fills: [ring] }));
        r._renderSelOverlay();
        const p = ants(r);
        expect(p).not.toBeNull();
        expect(p.getAttribute("stroke-width")).toBe("2.50");
        expect(p.getAttribute("fill")).toBe("none");
    });

    test("the band is 2.5 px on anything but a thin mark", () => {
        const r = mkRenderer();
        const ring = [[10, 10], [200, 10], [200, 120]];
        // The file strokes at `w + 2.5` against a mask eroded to `w - 2.5`,
        // leaving TWO ribbons of 2.5 px, one per edge. The 5 is the total across
        // both; tracing the outline covers both edges in one pass, so one ribbon
        // is the right width. Above the thin threshold the mark's weight makes
        // no difference, exactly as the file has it.
        for (const inkPx of [10, 26, 500, Infinity]) {
            r.setSelectionAnts(() => data({ rings: [ring], inkPx }));
            r._renderSelOverlay();
            expect(ants(r).getAttribute("stroke-width")).toBe("2.50");
        }
    });

    test("a thin mark shrinks the whole pattern, band and dash together", () => {
        const r = mkRenderer();
        const ring = [[10, 10], [400, 10], [400, 300], [10, 300], [10, 10]];
        const at = (inkPx) => {
            r.setSelectionAnts(() => data({ rings: [ring], inkPx }));
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
        // so a mark of a few pixels still reads as selected. At the old 0.4
        // floor this was a 1 px hairline and marks of 1-5 px disappeared.
        expect(thin.w).toBeCloseTo(1.75, 2);
    });

    test("dashes meet up: a whole number of cycles per run, no runt ant", () => {
        const r = mkRenderer();
        // A perimeter deliberately not a multiple of the 9 px cycle.
        const ring = [[10, 10], [173, 10], [173, 97], [10, 97], [10, 10]];
        r.setSelectionAnts(() => data({ rings: [ring] }));
        r._renderSelOverlay();
        const p = ants(r);
        const [on, off] = p.getAttribute("stroke-dasharray").split(" ").map(Number);
        const len = 2 * (163 + 87);
        const cycles = len / (on + off);
        // What matters is the LEFTOVER at the join, in pixels — that is the
        // runt ant you would see. A whole-cycle fit leaves only the rounding of
        // the dash attribute, well under a tenth of a pixel.
        const leftoverPx = Math.abs(cycles - Math.round(cycles)) * (on + off);
        expect(leftoverPx).toBeLessThan(0.1);
        // ...and the pattern still looks like 5/4, not stretched out of shape.
        // 5:4 to the precision the two numbers are written at.
        expect(on / off).toBeCloseTo(5 / 4, 3);
        expect(on).toBeGreaterThan(6);
        expect(on).toBeLessThan(8);
    });

    test("a run too short for a cycle still MOVES", () => {
        const r = mkRenderer();
        // Drawn solid, this went completely static once zoomed out — the
        // animation ran with no dash to move. It carries the pattern at full
        // size instead and lets it slide across, which is what a speck does.
        r.setSelectionAnts(() => data({ rings: [[[10, 10], [14, 10]]] }));
        r._renderSelOverlay();
        const p = ants(r);
        const [on, off] = p.getAttribute("stroke-dasharray").split(" ").map(Number);
        expect(on).toBeCloseTo(7, 2);        // full size, not crushed to fit
        expect(off).toBeCloseTo(5.6, 2);
        expect(p.style.getPropertyValue("--ao")).toBe("-25.200px");
    });

    test("a speck BLINKS: the pattern slides across a mark shorter than a cycle", () => {
        const r = mkRenderer();
        const speck = [[120, 90], [121, 90], [121, 91], [120, 91], [120, 90]];
        r.setSelectionAnts(() => data({ fine: [speck] }));
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
        r.setSelectionAnts(() => data({ rings: [[[10, 10], [200, 10]]] }));
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

    test("there is no shimmer anywhere", () => {
        const r = mkRenderer();
        r.setSelectionAnts(() => data({ rings: [[[10, 10], [200, 10], [200, 120]]] }));
        r._renderSelOverlay();
        expect(svgOf(r).querySelector("mask")).toBeNull();
        expect(svgOf(r).querySelector("rect.bl-sel-valw")).toBeNull();
        expect(svgOf(r).querySelector("rect.bl-sel-valb")).toBeNull();
        const css = document.getElementById("bl-sel-style").textContent;
        expect(css).not.toContain("valw");
        expect(css).not.toContain("valb");
    });

    test("there is no ring marker: everything is traced", () => {
        const r = mkRenderer();
        const ring = [[10, 10], [200, 10], [200, 120]];
        r.setSelectionAnts(() => data({ rings: [ring], fills: [ring] }));
        r._renderSelOverlay();
        expect(svgOf(r).querySelector("circle")).toBeNull();
        expect(ants(r).getAttribute("d")).toContain("M10.00,10.00");
    });

    test("the overlay is removed when the selection goes away", () => {
        const r = mkRenderer();
        const ring = [[10, 10], [200, 10], [200, 120]];
        r.setSelectionAnts(() => data({ rings: [ring], fills: [ring] }));
        r._renderSelOverlay();
        expect(ants(r)).not.toBeNull();
        r.setSelectionAnts(() => null);
        r._renderSelOverlay();
        expect(svgOf(r).querySelector("path.bl-sel-ants")).toBeNull();
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

    test("nothing longer than the viewport is ever handed over to be dashed", () => {
        const r = mkRenderer();
        // The backstop, stated as a test: even if the geometry stage were to
        // hand over an absurd ring, the rasterizer must not see it.
        r.setSelectionAnts(() => data({ rings: [[[0, 0], [877395, 0], [877395, 877395]]], covered: true }));
        r._renderSelOverlay();
        expect(antLength(r)).toBe(0);
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

    test("a selected pen stroke is traced — strokes are resolved, not skipped", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 200], [300, 260], [400, 210]]);
        E.setTool("select");
        E._setSelection([o.id]);
        const got = E._selectionAnts();
        expect(got).not.toBeNull();
        expect(got.rings.length).toBeGreaterThan(0);
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
        // now comes from the geometry (2 x area / perimeter), so it survives.
        expect(isFinite(got.inkPx)).toBe(true);
        expect(got.inkPx).toBeGreaterThan(5);
        expect(got.inkPx).toBeLessThan(40);
    });

    test("the lasso appears while you drag it and clears on release", () => {
        const E = mkEngine();
        E.setTool("select");
        E.pointerDown(120, 120);
        for (const p of [[400, 140], [420, 420], [140, 400]]) E.pointerMove(p[0], p[1]);
        // Drawn DURING the drag. `renderer.update()` repaints Two.js but never
        // rebuilds the selection layer, so the loop was invisible until this
        // went through `refreshSelection` instead.
        expect(E.renderer.selGroup.children.length).toBe(1);
        expect(E.renderer.selGroup.children[0].dashes.length).toBeGreaterThan(0);
        E.pointerUp();
        // ...and gone afterwards, even though the loop caught nothing and
        // `deselect` had nothing to do.
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
        // Force the tool without going through setTool: the overlay still
        // refuses, so no path can leave ants running under another tool.
        E.tool = "erase";
        expect(E._selectionAnts()).toBeNull();
    });

    test("ants never run along a tile join", () => {
        const E = mkEngine();
        // `_splitOnJoins` is the one place that says whether a stretch is a
        // shared tile edge. Make it call the middle of every segment a join and
        // the ants must skip exactly that, which is the whole of "no ants on the
        // tile edge": the seam is dropped, the free ends are kept.
        E._splitOnJoins = (entries, a, b) => {
            const at = (s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
            return [
                { p0: a, p1: at(0.25), joined: false },
                { p0: at(0.25), p1: at(0.75), joined: true },
                { p0: at(0.75), p1: b, joined: false },
            ];
        };
        const out = { rings: [], fills: [], covered: false };
        const ring = [[100, 100], [400, 100], [400, 300], [100, 300]];
        E._emitAntRing(out, E.cam.frame, ring, [{ dummy: 1 }], () => true, 1e6);
        expect(out.rings.length).toBeGreaterThan(0);
        // Nothing emitted may sit in the joined middle half of the top edge.
        const onSeam = out.rings.some((run) => run.some(([x, y]) =>
            Math.abs(y - 100) < 1e-6 && x > 190 && x < 310));
        expect(onSeam).toBe(false);
    });

    test("a mark too small to see is still traced, not marked", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[400, 300], [404, 303]]);
        E.setTool("select");
        E._setSelection([o.id]);
        // Zoom out until the mark is down at a single pixel. It must still be
        // traced — there is no ring-marker fallback any more.
        let got = null;
        for (let i = 0; i < 400; i++) {
            E.zoomAt(400, 300, 120);
            got = E._selectionAnts();
            if (!got || !(got.rings.length || got.fine.length)) continue;
            const b = got.rings.concat(got.fine).reduce((acc, ring) => {
                for (const [x, y] of ring) {
                    acc[0] = Math.min(acc[0], x); acc[1] = Math.min(acc[1], y);
                    acc[2] = Math.max(acc[2], x); acc[3] = Math.max(acc[3], y);
                }
                return acc;
            }, [1e9, 1e9, -1e9, -1e9]);
            if (Math.max(b[2] - b[0], b[3] - b[1]) <= 11) {
                expect(got.rings.length + got.fine.length).toBeGreaterThan(0);
                expect(got.dots).toBeUndefined();                  // and not a marker
                return;
            }
        }
        throw new Error("never reached a one-pixel mark");
    });

    test("marks piled onto one pixel are traced once, not once each", () => {
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
            if (!got || !(got.rings.length || got.fine.length)) continue;
            const span = got.rings.concat(got.fine).reduce((m, ring) => {
                for (const [x, y] of ring) m = Math.max(m, Math.abs(x - 400), Math.abs(y - 300));
                return m;
            }, 0);
            if (span <= 14) {
                // All eight sit on the same pixel or two; one trace each would
                // be eight stacked outlines saying one thing.
                const n = got.rings.length + got.fine.length;
                expect(n).toBeLessThan(4);
                expect(n).toBeGreaterThan(0);
                return;
            }
        }
        throw new Error("never collapsed onto a pixel");
    });

    test("the ants outlive the ink: zoomed past the cull, the speck stays", () => {
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
                expect(got.rings.length + got.fine.length).toBeGreaterThan(0);
                return;
            }
        }
        throw new Error("the drawing never culled");
    });

    test("the budget caps the ants however complicated the boundary is", () => {
        const E = mkEngine();
        const out = { rings: [], fills: [], covered: false };
        const ring = [];
        for (let i = 0; i < 4000; i++) ring.push([(i * 37) % 700 + 20, (i * 53) % 500 + 20]);
        E._emitAntRing(out, E.cam.frame, ring, [], () => true, 500);
        let total = 0;
        for (const run of out.rings) {
            for (let i = 1; i < run.length; i++) {
                total += Math.abs(run[i][0] - run[i - 1][0]) + Math.abs(run[i][1] - run[i - 1][1]);
            }
        }
        // One run may overshoot as it finishes; the point is that it STOPS
        // rather than tracing all 4,000 segments.
        expect(total).toBeLessThan(500 * 3);
        expect(out.rings.length).toBeGreaterThan(0);
    });
});
