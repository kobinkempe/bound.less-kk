/**
 * raster.overlay.test.js — the G series of RASTERISER-PLAN §9.2 for the overlay layer
 * (§10 stage 5d, §2.7 FC1/FC2/FC4/FC5/FC7/FC8, §15.3 "Stage 5d").
 *
 * G1–G10 drive the LAYER against doubles; G11–G13 and the renderer's own overrides drive two
 * whole engines, one SVG and one raster, over the same documents — the second half of the stage,
 * which needed 5b's `?raster` flag and a raster engine that constructs in jsdom.
 *
 * **Nothing here measures a picture.** jsdom has no canvas — `setupTests.js:27` makes
 * `getContext` return null for every canvas in this tree — and no `ImageData` global at all, so
 * the suite injects a RECORDING context and an `ImageData` double and asserts call sequences,
 * computed numbers and the painter's own bytes in the plane. What the compositor does with the
 * transform is stage 7's, in Kobin's Chrome (§9.4).
 */

import OverlayLayer, { SEL_CRAWL_RESUME_MS, OVERLAY_UNCOVERED_MS } from "./OverlayLayer";
import { antStats, resetAntStats, dashIntervals, ANT_PHASES, ANT_STEP_MS, ANT_LOOK, selAntScale } from "./antPaint";
import KobinEngine from "../KobinEngine";
import * as svgOverlay from "./svgOverlay";
import { runPathData, loopsBounds } from "../geometry/antRuns";
import { resetRasterWorkerClient } from "./rasterWorkerClient";
import * as rasterPerf from "./rasterPerf";

// ---------------------------------------------------------------------------
// The doubles: a recording 2D context on a real canvas element, an `ImageData`
// that records what it was built over, a clock the test moves, and timers that
// fire only when the test says so.
// ---------------------------------------------------------------------------

let imgMade = 0;
const mkImg = (data, w, h) => ({ data, width: w, height: h, seq: ++imgMade });

function recCtx() {
    const ctx = {
        calls: [],
        putImageData(...a) { ctx.calls.push({ op: "putImageData", a }); },
        of(op) { return ctx.calls.filter((c) => c.op === op); },
        clear() { ctx.calls.length = 0; },
    };
    return ctx;
}

function mkRec(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = recCtx();
    c.getContext = () => ctx;
    c.rec = ctx;
    return c;
}

function mkTimers() {
    const t = { armed: [], fired: 0 };
    t.set = (fn, ms) => { t.armed.push({ fn, ms, live: true }); return t.armed.length - 1; };
    t.clearT = (id) => { if (t.armed[id]) t.armed[id].live = false; };
    t.live = () => t.armed.filter((a) => a.live);
    t.liveAt = (ms) => t.live().filter((a) => a.ms === ms);
    t.fireAt = (ms) => {
        const a = t.liveAt(ms)[0];
        if (!a) return false;
        a.live = false; t.fired++; a.fn();
        return true;
    };
    t.tick = () => t.fireAt(ANT_STEP_MS);
    t.resume = () => t.fireAt(SEL_CRAWL_RESUME_MS);
    return t;
}

const CSS_W = 1504, CSS_H = 812;

function mkLayer(opts = {}) {
    const host = document.createElement("div");
    // FC1: the picture's own canvas is already in the host and must survive.
    const ink = mkRec(10, 10);
    ink.setAttribute("class", "bl-ink");
    host.appendChild(ink);
    const timers = mkTimers();
    const clock = { t: 1000 };
    const layer = new OverlayLayer(host, {
        width: opts.width || CSS_W, height: opts.height || CSS_H, dpr: opts.dpr || 1,
        makeCanvas: mkRec, makeImageData: mkImg,
        setTimer: timers.set, clearTimer: timers.clearT, now: () => clock.t,
        reducedMotion: !!opts.reducedMotion,
        perf: opts.perf || null,
    });
    return { layer, host, ink, timers, clock };
}

/** FC2's published view, the fields this layer reads. */
function mkView(over = {}) {
    const v = { rev: 1, mode: "level", frameId: "0", level: 0, S: 4, Zq: 1, Z: 1, s: 1,
        ox: 0, oy: 0, dx: 0, dy: 0, dpr: 1, cssW: CSS_W, cssH: CSS_H, k: 1, tx: 0, ty: 0 };
    return Object.assign(v, over);
}

/** A decision in the raster fork's own shape: the run's PIECES, in frame units. */
function line(ax, ay, bx, by) { return { line: true, A: [ax, ay], B: [bx, by] }; }

function mkDec(key = "k1", over = {}) {
    return Object.assign({
        key,
        inkPx: 100,
        runs: [{ pieces: [line(200, 300, 1300, 300)], closed: false, len: 1100 },
            { pieces: [line(200, 500, 1300, 500)], closed: false, len: 1100 }],
        marks: [],
        edges: [],
        off: null,
    }, over);
}

/** Every alpha byte of the plane, so two paints can be compared. */
const planeOf = (layer) => Uint8Array.from(layer.buf.data);
function litPixels(layer) {
    const d = layer.buf.data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
}

/** The element's CSS matrix, parsed back out of the style string as doubles. */
function matrixOf(layer) {
    const s = layer._canvas.style.transform;
    const m = /matrix\(([^)]*)\)/.exec(s);
    const n = m[1].split(",").map((x) => Number(x));
    return { s: n[0], dx: n[4], dy: n[5] };
}

/** Runs of alpha above half, along one row of a buffer: the lit intervals of that row. */
function rowIntervals(buf, y) {
    const out = [];
    let start = -1;
    for (let x = 0; x < buf.width; x++) {
        const a = buf.data[((y * buf.width + x) << 2) + 3];
        if (a > 127 && start < 0) start = x;
        else if (a <= 127 && start >= 0) { out.push([start, x]); start = -1; }
    }
    if (start >= 0) out.push([start, buf.width]);
    return out;
}

beforeEach(() => { resetAntStats(); imgMade = 0; });

// ---------------------------------------------------------------------------

describe("G1 — the ants are their own canvas", () => {
    test("a crawl step calls no method on a PicturePyramid stub and no method on the ink context", () => {
        const { layer, ink, timers } = mkLayer();
        // Every method `PicturePyramid` exposes, as a spy. The layer is handed the VIEW object and
        // never the pyramid, so none of them can be reached; this is what asserts it.
        const called = [];
        const stub = {};
        for (const m of ["setSize", "frameFor", "plan", "cellFresh", "compose", "covered", "unask", "estimate",
            "calibrate", "renderNow", "merge", "onResult", "patchPlan", "applyPatchPlan", "groupCommit",
            "onStoreRelease", "report", "destroy"]) {
            stub[m] = (...a) => { called.push(m); return null; };
        }
        const view = mkView();
        layer.show(mkDec(), view);
        timers.resume();
        for (let i = 0; i < 8; i++) timers.tick();
        expect(called).toEqual([]);
        // jsdom has no backing array, so "writes no byte of the ink" is asserted as "touches no
        // ink context call" — the honest form, and §9.4 item 1 is where the pixels are compared.
        expect(ink.rec.calls).toEqual([]);
        expect(layer.report().phases).toBeGreaterThan(0);
        // and the overlay canvas is a different element from the ink canvas
        expect(layer._canvas).not.toBe(ink);
        expect(layer._canvas.getAttribute("class")).toBe("bl-overlay");
        expect(layer._canvas.style.zIndex).toBe("2");
    });

    test("the picture's own canvas survives, and `destroy()` takes only ours (FC1)", () => {
        const { layer, host, ink } = mkLayer();
        layer.show(mkDec(), mkView());
        expect(host.childNodes.length).toBe(6);        // ink + plane + four strips
        layer.destroy();
        expect(host.childNodes.length).toBe(1);
        expect(host.firstChild).toBe(ink);
    });
});

describe("G2 — the ants and the ink share one transform", () => {
    /**
     * §15.3 Q1 (a): the plane is a SCREEN-space plane and the element carries the DELTA, so the
     * assertion is the COMPOSITION — paint-time view ∘ the element's CSS matrix reproduces the
     * published `k, tx, ty`. It is a stronger claim than the original wording (it catches a wrong
     * base as well as a wrong transform) and it is the one that is arithmetically true.
     */
    test("at s = 1.0905 and a snapped d, paint-time view ∘ CSS matrix is the published affine", () => {
        const { layer } = mkLayer();
        const Zq = 0.5946, ox = 512, oy = 256;
        const at = (s, dx, dy) => mkView({ level: -3, Zq, Z: Zq * s, s, ox, oy, dx, dy,
            k: Zq * s, tx: dx - ox * s, ty: dy - oy * s });
        const a = at(1, 37, -12);                       // the level's grid: the plane is painted here
        layer.show(mkDec(), a);
        const p0 = { k: layer._paintAt.k, tx: layer._paintAt.tx, ty: layer._paintAt.ty };
        expect(p0.k).toBe(a.k); expect(p0.tx).toBe(a.tx); expect(p0.ty).toBe(a.ty);
        expect(matrixOf(layer)).toEqual({ s: 1, dx: 0, dy: 0 });

        const b = at(1.0905, 219, -87);                 // σ inside the level's band, `d` still whole px
        const before = layer.report().repaints;
        layer.show(mkDec(), b);
        expect(layer.report().repaints).toBe(before);   // the same level: a transform, not a paint
        const m = matrixOf(layer);

        // The composition, in device pixels: the canvas is device px shown at CSS size ÷ dpr, so
        // a plane pixel X lands at m.s·X + m.dx·dpr.
        const dpr = 1;
        const kC = m.s * p0.k, txC = m.s * p0.tx + m.dx * dpr, tyC = m.s * p0.ty + m.dy * dpr;
        expect(kC).toBe(b.k);
        expect(txC).toBe(b.tx);
        expect(tyC).toBe(b.ty);
        // and it is the same claim read as a point map, over the width of the screen
        for (const p of [0, 1, 137.25, -4096, 1e5]) {
            expect(m.s * (p * p0.k + p0.tx) + m.dx * dpr).toBeCloseTo(p * b.k + b.tx, 9);
        }
        expect(m.s).toBeCloseTo(1.0905, 12);
    });

    test("the same composition at dpr 1.5, where the CSS translate is not the device one", () => {
        const { layer } = mkLayer({ dpr: 1.5 });
        const a = mkView({ dpr: 1.5, k: 2, tx: 100, ty: 50 });
        layer.show(mkDec(), a);
        const b = mkView({ dpr: 1.5, k: 2.181, tx: 341, ty: -19 });
        layer.show(mkDec(), b);
        const m = matrixOf(layer), p0 = layer._paintAt;
        expect(m.s * p0.k).toBeCloseTo(b.k, 12);
        expect(m.s * p0.tx + m.dx * 1.5).toBeCloseTo(b.tx, 9);
        expect(m.s * p0.ty + m.dy * 1.5).toBeCloseTo(b.ty, 9);
    });
});

describe("G3 — a level change repaints and does not re-decide", () => {
    test("one repaint at the new k, the transform back to identity, the decision untouched", () => {
        const { layer } = mkLayer();
        const dec = mkDec();
        // the decision is a function of the engine's own cache; the layer must never call it
        let decides = 0;
        const decide = () => { decides++; return dec; };
        layer.show(decide(), mkView({ level: 0, Zq: 1, k: 1, tx: 0, ty: 0 }));
        const r0 = layer.report().repaints;
        layer.show(dec, mkView({ level: 1, Zq: 1.1892, k: 1.1892, tx: 11, ty: 3 }));
        expect(layer.report().repaints).toBe(r0 + 1);
        expect(layer._paintAt.k).toBe(1.1892);
        expect(matrixOf(layer)).toEqual({ s: 1, dx: 0, dy: 0 });
        expect(decides).toBe(1);
    });

    test("a step at the same level does not repaint, however far `s` drifts; a switch to the rest grid repaints", () => {
        const { layer } = mkLayer();
        const dec = mkDec();
        layer.show(dec, mkView({ level: 0, Zq: 1, k: 1 }));
        const r0 = layer.report().repaints;
        for (let i = 1; i <= 12; i++) layer.show(dec, mkView({ level: 0, Zq: 1, k: 1 + i / 100, tx: i, ty: -i }));
        expect(layer.report().repaints).toBe(r0);
        expect(layer.report().transforms).toBeGreaterThanOrEqual(12);
        layer.show(dec, mkView({ mode: "rest", level: 0, Zq: 1.12, Z: 1.12, s: 1, k: 1.12, tx: 12, ty: -12 }));
        expect(layer.report().repaints).toBe(r0 + 1);                // the rest grid at σ = 1: painted once there
    });
});

describe("G4 — a decision change repaints in the same turn", () => {
    test("`repaints` is already +1 before `show` returns, with no timer fired", () => {
        const { layer, timers } = mkLayer();
        layer.show(mkDec("k1"), mkView());
        const r0 = layer.report().repaints, fired = timers.fired;
        layer.show(mkDec("k2"), mkView());
        expect(layer.report().repaints).toBe(r0 + 1);
        expect(timers.fired).toBe(fired);
    });

    test("the ants' own scale changing is a repaint too", () => {
        const { layer } = mkLayer();
        layer.show(mkDec("k1", { inkPx: 100 }), mkView());
        const r0 = layer.report().repaints;
        layer.show(mkDec("k1", { inkPx: 3 }), mkView());       // kt 1 → 0.7
        expect(selAntScale(3)).toBeCloseTo(0.7, 12);
        expect(layer.report().repaints).toBe(r0 + 1);
    });
});

describe("G5 — a drag translates and does not repaint", () => {
    test("20 drag moves → 20 transform writes, at most one repaint, whole device pixels", () => {
        const { layer } = mkLayer({ dpr: 1.5 });
        const dec = mkDec("drag", { off: [0, 0] });
        const view = mkView({ dpr: 1.5, k: 1.5, tx: 12, ty: 7 });
        layer.show(dec, view);
        const r0 = layer.report().repaints, t0 = layer.report().transforms;
        const translates = [];
        for (let i = 1; i <= 20; i++) {
            dec.off = [i * 3.37, -i * 1.11];             // fractional CSS px, as a pointer gives
            layer.show(dec, view);
            const m = matrixOf(layer);
            translates.push([m.dx * 1.5, m.dy * 1.5]);
        }
        expect(layer.report().transforms - t0).toBe(20);
        expect(layer.report().repaints - r0).toBeLessThanOrEqual(1);
        for (const [dx, dy] of translates) {
            expect(Math.abs(dx - Math.round(dx))).toBeLessThan(1e-9);
            expect(Math.abs(dy - Math.round(dy))).toBeLessThan(1e-9);
        }
        // and the last translate is the drag itself, rounded to device pixels
        const last = translates[19];
        expect(last[0]).toBe(Math.round(20 * 3.37 * 1.5));
        expect(last[1]).toBe(Math.round(-20 * 1.11 * 1.5));
    });
});

describe("G6 — the crawl freezes on a camera step and resumes 150 ms after the last", () => {
    test("no phase advance while ticks fire; the resume timer is re-armed on every step", () => {
        const { layer, timers } = mkLayer();
        const dec = mkDec();
        layer.show(dec, mkView());
        expect(layer._frozen).toBe(true);
        const p0 = layer.report().phases;
        for (let i = 0; i < 4; i++) timers.tick();
        expect(layer.report().phases).toBe(p0);          // frozen: the ticks advance nothing

        // every camera step re-arms the resume, camera step or not (`Renderer.js:1500-1515`)
        for (let i = 0; i < 3; i++) {
            layer.show(dec, mkView({ k: 1 + i / 1000 }));
            expect(timers.liveAt(SEL_CRAWL_RESUME_MS).length).toBe(1);
        }
        expect(layer._frozen).toBe(true);
        timers.resume();
        expect(layer._frozen).toBe(false);
        const p1 = layer.report().phases;
        timers.tick();
        expect(layer.report().phases).toBe(p1 + 1);
        expect(layer._phase).toBe(1);
    });

    test("the phase walks the eight and comes back byte-identical", () => {
        const { layer, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        timers.resume();
        const at0 = planeOf(layer);
        for (let i = 0; i < ANT_PHASES; i++) timers.tick();
        expect(layer._phase).toBe(0);
        expect(planeOf(layer)).toEqual(at0);
    });
});

describe("G7 — the edge runs crawl in phase with the body ants", () => {
    /**
     * The four strips are §15.3 Q3 (a). The second clause of G7 — `bl-sel-edges` holds only
     * `arrowPool` elements and no path with a `stroke-dasharray` — is the RENDERER's and is
     * asserted in passes 4-6.
     */
    test("a known span's lit intervals are `dashIntervals`' own, at the same phase index", () => {
        const { layer, timers } = mkLayer();
        const dec = mkDec("edges", { edges: [{ side: "top", from: 200, to: 800, chevron: false }] });
        layer.show(dec, mkView());
        timers.resume();
        const strip = layer._strips[SIDES_TOP];
        const on = ANT_LOOK.ON, off = ANT_LOOK.OFF, len = 600;
        const iv = new Float64Array(512);
        const row = Math.round((ANT_LOOK.W / 2));        // the band's own centre row, dpr 1
        for (let ph = 0; ph < ANT_PHASES; ph++) {
            const got = rowIntervals(strip.buf, row).map(([a, b]) => [a - 200, b - 200]);
            const n = dashIntervals(len, on, off, layer._phase, iv, true);
            expect(got.length).toBe(n);
            // A lit interval read back from PIXELS quantises: the column holding a dash's edge is
            // half covered, so the > 127 threshold places the edge up to 0.5 px early or late.
            // The window is 0.75 px, and one phase step of this run's fitted cycle is
            // 600/48/8 = 1.5625 px — so a wrong phase is still red.
            for (let i = 0; i < n; i++) {
                expect(Math.abs(got[i][0] - iv[2 * i])).toBeLessThanOrEqual(0.75);
                expect(Math.abs(got[i][1] - iv[2 * i + 1])).toBeLessThanOrEqual(0.75);
            }
            // the phase the strip was painted at is the body's own, and it advances with it
            expect(layer._phase).toBe(ph);
            timers.tick();
            layer.show(dec, mkView());                    // a camera step repaints the strips
            timers.resume();
        }
    });

    test("all four sides are painted, each in its own strip, and nowhere else", () => {
        const { layer } = mkLayer();
        const edges = [
            { side: "left", from: 100, to: 400 }, { side: "right", from: 100, to: 400 },
            { side: "top", from: 100, to: 400 }, { side: "bottom", from: 100, to: 400 },
        ];
        layer.show(mkDec("e4", { runs: [], marks: [], edges }), mkView());
        for (let i = 0; i < 4; i++) {
            const s = layer._strips[i];
            let lit = 0;
            for (let j = 3; j < s.buf.data.length; j += 4) if (s.buf.data[j] > 0) lit++;
            expect(lit).toBeGreaterThan(100);
        }
        expect(litPixels(layer)).toBe(0);                 // the body plane holds no edge run
    });
});

describe("G8 — hide, detach, stop, and re-show the SAME buffer", () => {
    test("`hide()` detaches and stops the clock and keeps the plane; a second `show` reuses it", () => {
        const { layer, host, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        const data = layer.buf.data;
        const allocs = antStats.allocs;
        layer.hide();
        expect(host.childNodes.length).toBe(1);           // the ink canvas alone
        expect(timers.live().length).toBe(0);
        expect(layer.buf.data).toBe(data);
        layer.show(mkDec(), mkView());
        expect(layer.buf.data).toBe(data);
        expect(antStats.allocs).toBe(allocs);
        expect(host.childNodes.length).toBe(6);
    });

    test("a decision with nothing in it is a hide", () => {
        const { layer, host } = mkLayer();
        layer.show(mkDec(), mkView());
        layer.show({ key: "empty", runs: [], marks: [], edges: [], inkPx: 1 }, mkView());
        expect(host.childNodes.length).toBe(1);
        expect(layer.buf).not.toBe(null);
    });
});

describe("G9 — reduced motion", () => {
    test("one paint, no timer armed, and the indicator is in the plane", () => {
        const { layer, timers } = mkLayer({ reducedMotion: true });
        layer.show(mkDec(), mkView());
        expect(timers.liveAt(ANT_STEP_MS).length).toBe(0);
        expect(layer.report().phases).toBe(1);
        expect(litPixels(layer)).toBeGreaterThan(1000);
        expect(layer._phase).toBe(0);
        // The tick itself refuses, not only the timer that would have called it (D265).
        layer.step();
        expect(layer._phase).toBe(0);
        expect(layer.report().phases).toBe(1);
    });

    test("`setReducedMotion` is the one switch, and the renderer owns the listener", () => {
        const { layer, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        expect(timers.liveAt(ANT_STEP_MS).length).toBe(1);
        layer.setReducedMotion(true);
        expect(timers.liveAt(ANT_STEP_MS).length).toBe(0);
        expect(layer._phase).toBe(0);
        layer.setReducedMotion(false);
        expect(timers.liveAt(ANT_STEP_MS).length).toBe(1);
    });
});

describe("G10 — a resize and a dpr change", () => {
    test("each reallocates once and repaints once, and `report().bytes` is w·h·4", () => {
        const { layer } = mkLayer();
        layer.show(mkDec(), mkView());
        expect(layer.report().bytes).toBe(CSS_W * CSS_H * 4);
        const data = layer.buf.data, r0 = layer.report().repaints, a0 = antStats.allocs;
        layer.setSize(900, 500, 1);
        expect(layer.buf.data).not.toBe(data);
        expect(layer.report().bytes).toBe(900 * 500 * 4);
        expect(layer.report().repaints).toBe(r0 + 1);
        // one plane and four strips: five buffers, each reallocated once
        expect(antStats.allocs - a0).toBe(5);
        expect(layer._canvas.width).toBe(900);
        expect(layer._canvas.style.width).toBe("900px");

        const a1 = antStats.allocs, r1 = layer.report().repaints;
        layer.setSize(900, 500, 2);
        expect(layer.report().bytes).toBe(1800 * 1000 * 4);
        expect(layer.report().repaints).toBe(r1 + 1);
        expect(antStats.allocs - a1).toBe(5);
        expect(layer._canvas.width).toBe(1800);
        expect(layer._canvas.style.width).toBe("900px");     // CSS size unchanged, backing store doubled
    });

    test("the same size and dpr again is not a reallocation", () => {
        const { layer } = mkLayer();
        layer.show(mkDec(), mkView());
        const a0 = antStats.allocs, data = layer.buf.data;
        expect(layer.setSize(CSS_W, CSS_H, 1)).toBe(false);
        expect(antStats.allocs).toBe(a0);
        expect(layer.buf.data).toBe(data);
    });
});

describe("FC4 — the blit is the one path from the buffer to the canvas", () => {
    test("one `putImageData` per paint, over the dirty rect, from ONE ImageData", () => {
        const { layer, timers } = mkLayer();
        // The canvas is mounted on the FIRST show, not at construction (FC1: a tool change must
        // not allocate), so the recording context can only be read after it.
        layer.show(mkDec(), mkView());
        const ctx = layer._canvas.rec;
        const calls = ctx.of("putImageData");
        expect(calls.length).toBe(1);
        const [img, dx, dy, x0, y0, w, h] = calls[0].a;
        expect(img).toBe(layer._img);
        expect(img.data).toBe(layer.buf.data);
        expect([dx, dy]).toEqual([0, 0]);
        const d = layer.buf.dirty;
        expect([x0, y0, w, h]).toEqual([d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0]);
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
        // the ImageData is built per RESIZE and never per blit (FC5)
        const made = imgMade;
        timers.resume();
        for (let i = 0; i < 8; i++) timers.tick();
        expect(imgMade).toBe(made);
        expect(ctx.of("putImageData").length).toBe(9);
    });

    test("`blit(rect)` takes FC4's screenRect and clamps it to the plane", () => {
        const { layer } = mkLayer();
        layer.show(mkDec(), mkView());
        const ctx = layer._canvas.rec;
        ctx.clear();
        const n = layer.blit({ x0: -50, y0: 10, x1: 100, y1: 20 });
        expect(n).toBe(100 * 10);
        expect(ctx.of("putImageData")[0].a.slice(3)).toEqual([0, 10, 100, 10]);
        expect(layer.report().blitPx).toBe(1000);
        ctx.clear();
        expect(layer.blit({ x0: 5, y0: 5, x1: 5, y1: 9 })).toBe(0);      // empty: nothing to push
        expect(ctx.calls.length).toBe(0);
    });

    test("with no ImageData (a browser-less tree) the paint still runs and the blit is counted", () => {
        const host = document.createElement("div");
        const layer = new OverlayLayer(host, { width: 400, height: 300, dpr: 1, makeCanvas: mkRec,
            makeImageData: () => null, setTimer: () => 1, clearTimer: () => {}, now: () => 0 });
        layer.show(mkDec(), mkView());
        expect(layer.report().noImageData).toBeGreaterThan(0);
        expect(layer.report().blitPx).toBe(0);
        expect(litPixels(layer)).toBeGreaterThan(0);
    });
});

describe("FC5 — nothing is allocated per tick or per camera step", () => {
    test("16 ticks and 16 camera steps allocate nothing, with the counter moving when it grows", () => {
        const { layer, timers } = mkLayer();
        const dec = mkDec("fc5", { edges: [{ side: "top", from: 100, to: 700 }] });
        layer.show(dec, mkView());
        timers.resume();
        timers.tick();
        const a0 = antStats.allocs, o0 = layer.report().allocs;
        for (let i = 0; i < 16; i++) {
            timers.tick();
            layer.show(dec, mkView({ k: 1 + i / 1000 }));
            timers.resume();
        }
        expect(antStats.allocs).toBe(a0);
        expect(layer.report().allocs).toBe(o0);
        // the zero means something: a new edge span grows the pseudo-run pool once
        dec.edges = [{ side: "top", from: 100, to: 300 }, { side: "top", from: 400, to: 700 }];
        layer.show(dec, mkView());
        expect(layer.report().allocs).toBe(o0 + 1);
    });

    test("`report()` is one object, mutated in place", () => {
        const { layer, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        const a = layer.report();
        timers.resume(); timers.tick();
        expect(layer.report()).toBe(a);
    });
});

describe("§15.3 Q2 — a pan uncovers ants, and the bounded repaint", () => {
    test("the uncovered pixels are counted, worst fraction included", () => {
        const { layer } = mkLayer();
        const dec = mkDec();
        layer.show(dec, mkView({ k: 1, tx: 0 }));
        expect(layer.report().uncoveredPx).toBe(0);
        layer.show(dec, mkView({ k: 1, tx: 200 }));           // a 200 device px pan
        const rep = layer.report();
        expect(rep.uncoveredPx).toBe(200 * CSS_H);
        expect(rep.uncoveredFrames).toBe(1);
        expect(rep.uncoveredWorst).toBeCloseTo(200 / CSS_W, 9);
    });

    test("the repaint is bounded at one per OVERLAY_UNCOVERED_MS and takes the FROZEN phase", () => {
        const { layer, clock } = mkLayer();
        const dec = mkDec();
        layer.show(dec, mkView({ tx: 0 }));
        timersAdvance(clock, OVERLAY_UNCOVERED_MS);
        const r0 = layer.report().repaints, ph = layer._phase;
        for (let i = 1; i <= 10; i++) layer.show(dec, mkView({ tx: i * 20 }));   // one gesture
        expect(layer.report().repaints).toBe(r0 + 1);        // the first step, then bounded
        expect(layer._phase).toBe(ph);                       // the frozen phase, not a new one
        expect(layer.report().repaintsDuringGesture).toBe(1);
        timersAdvance(clock, OVERLAY_UNCOVERED_MS - 1);
        layer.show(dec, mkView({ tx: 300 }));
        expect(layer.report().repaints).toBe(r0 + 1);        // still inside the interval
        timersAdvance(clock, 1);
        layer.show(dec, mkView({ tx: 320 }));
        expect(layer.report().repaints).toBe(r0 + 2);
    });

    test("a covered screen never repaints, however long the gesture", () => {
        const { layer, clock } = mkLayer();
        const dec = mkDec();
        layer.show(dec, mkView({ tx: 0 }));
        const r0 = layer.report().repaints;
        for (let i = 0; i < 30; i++) {
            timersAdvance(clock, 20);
            layer.show(dec, mkView({ tx: 0, ty: 0, k: 1 }));
        }
        expect(layer.report().repaints).toBe(r0);
        expect(layer.report().uncoveredFrames).toBe(0);
    });
});

describe("§15.3 Q6 — hide keeps the plane, onStoreRelease frees it, destroy frees everything", () => {
    test("the release gives the bytes back and the next show reallocates and repaints once", () => {
        const { layer } = mkLayer();
        layer.show(mkDec(), mkView());
        expect(layer.report().stripBytes).toBeGreaterThan(0);
        const r0 = layer.report().repaints;
        expect(layer.onStoreRelease("hidden")).toBe("hidden");
        expect(layer.buf).toBe(null);
        expect(layer.report().bytes).toBe(0);
        expect(layer.report().stripBytes).toBe(0);
        layer.show(mkDec(), mkView());
        expect(layer.buf).not.toBe(null);
        expect(layer.report().bytes).toBe(CSS_W * CSS_H * 4);
        expect(layer.report().repaints).toBe(r0 + 1);
    });

    test("`destroy()` stops the clock and detaches", () => {
        const { layer, host, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        layer.destroy();
        expect(timers.live().length).toBe(0);
        expect(host.childNodes.length).toBe(1);
        expect(layer.buf).toBe(null);
        expect(layer._canvas).toBe(null);
    });
});

describe("FC7 — the report is the shape `rasterPerf.noteCrawl` reads", () => {
    test("every field that reader names is present and a number", () => {
        const { layer, timers } = mkLayer();
        layer.show(mkDec(), mkView());
        timers.resume(); timers.tick();
        const r = layer.report();
        // `rasterPerf.js` `noteCrawl` reads these by name (not `decideMs`: a tick decides nothing), plus the stage-L three it
        // defaults to 0; the five of §10 item 7 are the first five.
        for (const k of ["phases", "lastPhaseMs", "pixels", "bytes", "repaints",
            "decideMs", "paintMs", "blitMs", "blitPx", "dashes", "stamps"]) {
            expect(typeof r[k]).toBe("number");
            expect(isFinite(r[k])).toBe(true);
        }
        expect(r.dashes).toBeGreaterThan(0);
        expect(r.stamps).toBeGreaterThan(0);
        expect(r.pixels).toBeGreaterThan(0);
        expect(r.bytes).toBe(CSS_W * CSS_H * 4);
    });

    test("a crawl row charges what its tick did: no decision (the render row's `ovl.tail` holds it), no paint while frozen", () => {
        rasterPerf.reset();
        const { layer, timers } = mkLayer({ perf: rasterPerf });
        let t = 0;
        layer._now = () => (t += 5);                                           // every paint 5 ms on this clock
        layer.noteDecide(778);
        layer.show(mkDec(), mkView());                                         // the render's frame: decided, painted
        for (let i = 0; i < 3; i++) timers.tick();                             // frozen ticks: nothing painted
        timers.resume(); timers.tick();                                        // a crawl tick: one phase painted
        const rows = rasterPerf.report().frames.filter((r) => r.kind === "crawl");
        expect(rows.map((r) => r.timers["ovl.decide"] || 0)).toEqual([0, 0, 0, 0]);   // red: 778 in every row (the dense drop's 903–924 ms "crawl" rows)
        expect(rows.map((r) => r.timers["ovl.paint"] || 0)).toEqual([0, 0, 0, 5]);    // red: the show's paint carried into each frozen tick
        expect(rows.map((r) => r.mainMs)).toEqual([0, 0, 0, 10]);                     // the tick's paint and blit, 5 ms each here
        expect(layer.report().decideMs).toBe(778);                             // the panel's last decision stays
        rasterPerf.reset();
    });

    test("a tick hands the report to the injected perf object, once", () => {
        const seen = [];
        const { layer, timers } = mkLayer({ perf: { noteCrawl: (rep) => seen.push(rep.phases) } });
        layer.show(mkDec(), mkView());
        expect(seen.length).toBe(0);                 // a show is the renderer's own frame
        timers.resume();
        timers.tick(); timers.tick();
        expect(seen.length).toBe(2);
        expect(seen[1]).toBe(seen[0] + 1);
    });
});

/** `SIDES` order inside the layer: left, right, top, bottom. */
const SIDES_TOP = 2;

/** The injected clock is a plain number the test moves. */
function timersAdvance(clock, ms) { clock.t += ms; }

// ---------------------------------------------------------------------------
// Passes 4-6: two whole engines, one SVG and one raster, over the same
// documents. jsdom has no `Worker`, so the raster engine's pool reports itself
// broken and no plate ever arrives — which is exactly what this half needs:
// the decision, the overrides and the DOM, with the picture left to stage 7.
// ---------------------------------------------------------------------------

const ENG_W = 800, ENG_H = 600;
const engines = [];

function mkEngine(raster) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: ENG_W, height: ENG_H, raster });
    engines.push({ E, host });
    return E;
}
/** The same document, drawn twice: the SVG renderer's engine and the raster one. */
function mkPair() { return { svg: mkEngine(false), ras: mkEngine(true) }; }

function penStroke(E, pts, width) {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
}

beforeEach(() => { resetRasterWorkerClient(); });
afterEach(() => {
    while (engines.length) {
        const e = engines.pop();
        try { e.E.destroy(); } catch (err) { /* torn down */ }
        e.host.remove();
    }
});

/** The raster engine's own overlay layer, built lazily on the first decision. */
const overlayOf = (E) => E.renderer._overlay;
const edgeLayerOf = (E) => E.renderer.host.querySelector(".bl-sel-edges");

/**
 * G11's comparison, per fixture. The raster decision's PIECES, run through `runPathData` at the
 * SVG engine's own origin and scale, must be the SVG decision's own `d` strings — with `len`,
 * the marks, the edges, `inkPx` and `off` equal. **The SVG engine's `O` is used for both sides**:
 * a renderer's origin is its own bookkeeping (the SVG path takes the active scene's, the raster
 * path the live layer's, and a crossing re-chooses one and not the other), while what is under test is
 * the geometry. That the raster geometry needs no origin at all is G12. A drag is decided on the
 * picture it began from under both renderers (the Stage's reads at rest), its `off` the whole travel
 * (A1 C2).
 */
function sameDecision(svgE, rasE) {
    expect(rasE.cam.inScale).toBe(svgE.cam.inScale);
    expect(rasE.cam.frame).toBe(svgE.cam.frame);
    // A decision stands while G does (A2 §2.11), and the two paths commit at different steps (the SVG
    // render's tile reads, the raster table's), so each decides afresh here — a drag keeps its first.
    if (!svgE._dragSel) svgE._selDec = null;
    if (!rasE._dragSel) rasE._selDec = null;
    const a = svgE._selectionAnts(), b = rasE._selectionAnts();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const O = svgE.renderer._origin(), sc = svgE.cam.inScale;
    const d = (r) => runPathData({ pieces: r.pieces, closed: r.closed }, O.x, O.y, sc);
    expect(b.runs.length).toBe(a.runs.length);
    expect(a.runs.length + a.marks.length).toBeGreaterThan(0);
    for (let i = 0; i < a.runs.length; i++) {
        expect(typeof a.runs[i].d).toBe("string");
        expect(b.runs[i].d).toBeUndefined();
        expect(d(b.runs[i])).toBe(a.runs[i].d);
        expect(b.runs[i].len).toBe(a.runs[i].len);
        expect(b.runs[i].closed).toBe(a.runs[i].closed === undefined ? b.runs[i].closed : a.runs[i].closed);
    }
    expect(b.marks.length).toBe(a.marks.length);
    for (let i = 0; i < a.marks.length; i++) expect(d(b.marks[i])).toBe(a.marks[i].d);
    expect(b.edges).toEqual(a.edges);
    expect(b.inkPx).toBe(a.inkPx);
    expect(b.off).toEqual(a.off);
    return { a, b };
}

/**
 * The six shapes §15.3 Q5 (a) names — a pen stroke, a sub-2 px frame (F38), an F73 dot, a
 * tile-cut seam (F37), a drag and a zoomed-out no-budget case. Each `run` is the SAME script on
 * either engine, and every stop condition is the CAMERA's own number, so the two engines stop at
 * the same step. `check` asserts the fixture reached the regime it is named for: a comparison of
 * two empty decisions would pass and say nothing.
 */
const FIXTURES = [
    {
        name: "a pen stroke",
        run: (E) => {
            const o = penStroke(E, [[200, 200], [300, 260], [400, 210]], 13);
            E.setTool("select"); E._setSelection([o.id]);
            E._render();
        },
        check: (a) => {
            expect(a.runs.length).toBeGreaterThan(0);
            expect(a.runs.some((r) => /[AC]/.test(r.d))).toBe(true);   // curves as curves
        },
    },
    {
        name: "a sub-2 px frame (F38)",
        run: (E) => {
            const ids = [];
            for (let i = 0; i < 40; i++) {
                const x = 380 + (i % 8) * 4, y = 280 + Math.floor(i / 8) * 6;
                ids.push(penStroke(E, [[x, y], [x + 3, y + 2]], 13).id);
            }
            E.setTool("select"); E._setSelection(ids);
            while (E.cam.inScale > 0.05) E.zoomAt(400, 300, 120);
            E._render();
        },
        check: (a) => {
            expect(a.marks.length).toBe(1);        // one dot for the frame, its members unvisited
            expect(a.runs.length).toBe(0);
        },
    },
    {
        name: "an F73 dot beside a traced stroke",
        run: (E) => {
            const big = penStroke(E, [[100, 300], [400, 300]], 20);
            const tiny = penStroke(E, [[600, 300], [600.5, 300]], 1);
            E.setTool("select"); E._setSelection([big.id, tiny.id]);
            while (E.cam.inScale > 0.1) E.zoomAt(400, 300, 120);
            E._render();
        },
        check: (a) => {
            expect(a.runs.length).toBeGreaterThan(0);
            expect(a.marks.length).toBe(1);
        },
    },
    {
        name: "a tile-cut seam one level down (F37)",
        run: (E) => {
            const o = penStroke(E, [[380, 300], [420, 300]], 13);
            E.setTool("select"); E._setSelection([o.id]);
            E.flushBakes();
            // Anchored on the ink's own top EDGE: descending about its middle leaves every
            // boundary tens of thousands of px off screen and the decision empty, which is the
            // trap `__testkit__/harness.descend` documents.
            const [ax, ay] = E._levelPointToScreen(E.cam.frame,
                (o._bbox.x0 + o._bbox.x1) / 2, o._bbox.y0 - (o.lwFrame || 0) / 2);
            descendTo(E, 1, ax, ay);
            E._render();
        },
        check: (a, E) => {
            expect(E._lastList.some((p) => p.clip)).toBe(true);        // the cut is really there
            expect(a.runs.length + a.marks.length).toBeGreaterThan(0);
        },
    },
    {
        name: "a drag, held and translated",
        run: (E) => {
            const o = penStroke(E, [[300, 300], [400, 330], [500, 300]], 13);
            E.setTool("select");
            E.pointerDown(400, 329); E.pointerUp();
            expect(E.selection && E.selection.ids).toEqual([o.id]);
            E.pointerDown(400, 329);
            E.pointerMove(420, 329);          // past the 8 px threshold: the drag begins
            E.pointerMove(440, 329);
        },
        check: (a) => {
            expect(a.off).toEqual([40, 0]);   // the travel since the drag's start (both renderers decide at rest)
            expect(a.runs.length).toBeGreaterThan(0);
        },
    },
    {
        name: "sixty strokes, no budget, zoomed out",
        run: (E) => {
            const ids = [];
            for (let i = 0; i < 60; i++) ids.push(penStroke(E, [[40, 20 + i * 9], [400, 23 + i * 9], [760, 20 + i * 9]], 13).id);
            E.setTool("select"); E._setSelection(ids);
            E.zoomAt(400, 300, 120); E.zoomAt(400, 300, 120);
            E._render();
        },
        check: (a) => {
            expect(a.runs.length).toBeGreaterThanOrEqual(60);
            expect(a.runs.reduce((s, r) => s + r.len, 0)).toBeGreaterThan(24000);
        },
    },
];

/** `harness.descend` without the import: a level, reached by the camera alone. */
function descendTo(E, n, sx, sy) {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 600) E.zoomAt(sx, sy, -1000);
    return E.activeLevel;
}

describe("the `overlays.js` fork — one branch and one field (§10 stage 5d, §15.3 Q8)", () => {
    test("the SVG decision carries `d` and the raster decision carries the pieces, and both carry `off`", () => {
        const { svg, ras } = mkPair();
        for (const E of [svg, ras]) FIXTURES[0].run(E);
        const a = svg._selectionAnts(), b = ras._selectionAnts();
        expect(svg.renderer.antPainter).toBeUndefined();     // the base renderer takes the string
        expect(ras.renderer.antPainter).toBe(true);
        expect(typeof a.runs[0].d).toBe("string");
        expect(a.runs[0].pieces).toBeUndefined();
        expect(b.runs[0].d).toBeUndefined();
        expect(Array.isArray(b.runs[0].pieces)).toBe(true);
        expect(b.runs[0].pieces.length).toBeGreaterThan(0);
        expect(a.off).toEqual([0, 0]);
        expect(b.off).toEqual([0, 0]);
        // and the fields the decision is keyed and scaled by are untouched by the fork
        expect(b.key).toBe(a.key);
        expect(b.inkPx).toBe(a.inkPx);
        expect(ras._selDec.scale).toBe(svg._selDec.scale);
    });

    test("the raster fork builds no path data at all: the pieces are the render list's own", () => {
        const ras = mkEngine(true);
        FIXTURES[0].run(ras);
        const got = ras._selectionAnts();
        const piece = got.runs[0].pieces[0];
        // A piece is a cubic (an array of points) or a line/arc object; either way it is the
        // render list's own FRAME coordinates. `runPathData` is what applied `(p − O)·sc`, and
        // the fork drops it — so the first point is where the stroke was drawn (~200), and it is
        // nowhere near the retained coordinate the SVG path would have written (200 − O.x).
        const xy = Array.isArray(piece) ? piece[0] : (piece.A || piece.C);
        const O = ras.renderer._origin();
        expect(O.x).toBe(400);                              // the view centre, chosen at pen-down
        expect(Math.abs(xy[0] - 200)).toBeLessThan(40);
        expect(Math.abs(xy[0] - (200 - O.x))).toBeGreaterThan(100);
        expect(JSON.stringify(got.runs[0]).includes('"d"')).toBe(false);
    });
});

describe("G11 — the decision is identical under both renderers", () => {
    test.each(FIXTURES.map((f) => [f.name, f]))("%s", (name, f) => {
        const { svg, ras } = mkPair();
        f.run(svg); f.run(ras);
        const { a } = sameDecision(svg, ras);
        f.check(a, svg);
    });

    test("the break-check: a fork that translated by the origin is red", () => {
        const { svg, ras } = mkPair();
        FIXTURES[0].run(svg); FIXTURES[0].run(ras);
        const b = ras._selectionAnts();
        const O = svg.renderer._origin(), sc = svg.cam.inScale;
        const moved = runPathData({ pieces: b.runs[0].pieces, closed: b.runs[0].closed }, O.x + 1, O.y, sc);
        expect(moved).not.toBe(svg._selectionAnts().runs[0].d);
    });
});

describe("G14 — a drop keeps the drag's decision, moved by the selection's displacement (the overlay's tail after a drop)", () => {
    /** Two strokes and a fill selected, the ants decided at rest; returns the engine and a press on the fill. */
    function selected() {
        const E = mkEngine(true);
        const a = penStroke(E, [[200, 200], [300, 260], [400, 210]], 13);
        const b = penStroke(E, [[220, 330], [330, 300], [420, 360]], 9);
        const f = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#284", opacity: 1,
            polys: [[E.cam.screenToFrame(460, 200), E.cam.screenToFrame(560, 200), E.cam.screenToFrame(560, 300), E.cam.screenToFrame(460, 300)]] }, E.cam.frame);
        E.setTool("select"); E._setSelection([a.id, b.id, f.id], []);
        E._render();
        return { E, press: [510, 250] };
    }
    const len = (dec) => dec.runs.reduce((s, r) => s + r.len, 0);
    const box = (dec, sh = [0, 0]) => {
        const b = loopsBounds(dec.runs.map((r) => r.pieces));
        return [b.x0 + sh[0], b.y0 + sh[1], b.x1 + sh[0], b.y1 + sh[1]];
    };

    test("the drop and a cancel decide nothing; the kept ants are a fresh decision's, where the ink is", () => {
        for (const end of ["drop", "cancel"]) {
            const { E, press } = selected();
            expect(E._selectionAnts()).not.toBeNull();
            E.pointerDown(press[0], press[1]);
            for (let k = 1; k <= 12; k++) E.pointerMove(press[0] + 9 * k, press[1] + 4 * k);
            expect(E._selectionAnts().off).toEqual([108, 48]);                    // the drag's decision, riding the pointer
            const seq0 = E._selDecSeq;
            if (end === "drop") E.pointerUp(); else E.cancelSelectGesture(false);
            const kept = E._selectionAnts();
            expect([end, E._selDecSeq - seq0]).toEqual([end, 0]);                  // red: the drop re-decided (548–803 ms on the dense scene)
            const sh = E._selDec.shift || [0, 0];
            expect(end === "drop" ? Math.hypot(sh[0] * E.cam.inScale - 108, sh[1] * E.cam.inScale - 48) < 0.5 : sh[0] === 0 && sh[1] === 0).toBe(true);
            const k0 = box(E._selDec, sh), L0 = len(E._selDec), off = kept.off;
            E._selDec = null;                                                     // a fresh decision of the same state
            const fresh = E._selectionAnts(), k1 = box(E._selDec);
            expect(Math.abs(len(E._selDec) - L0)).toBeLessThan(1);
            for (let n = 0; n < 4; n++) expect([end, n, Math.abs(k0[n] - k1[n]) * E.cam.inScale < 0.05]).toEqual([end, n, true]);
            expect(fresh.off).toEqual([0, 0]);
            expect(off.map((x) => Math.round(x))).toEqual(end === "drop" ? [108, 48] : [0, 0]);
        }
    });

    test("a member not drawn the rest's displacement away from where it was at the drag's start: decided again", () => {
        const { E, press } = selected();
        E._selectionAnts();
        E.pointerDown(press[0], press[1]);
        for (let k = 1; k <= 6; k++) E.pointerMove(press[0] + 9 * k, press[1]);
        E._selectionAnts();                                                   // the drag's decision, its members' boxes at rest
        const dec = E._selDec, [k0, r0] = [...dec.at][0], px = 2 / E.cam.inScale;
        expect(dec.at.size).toBe(3);
        dec.at.set(k0, { ...r0, left: r0.left - px, right: r0.right - px });   // that member 2 px off the others' displacement
        const seq0 = E._selDecSeq;
        E.pointerUp();
        expect(E._selDecSeq).toBe(seq0 + 1);                                  // red without the member-by-member check
        expect(E._selDec.shift).toBeUndefined();
    });

    test("a drop farther than the kept window's margin: decided again (the view would hold ink the decision never traced)", () => {
        const { E, press } = selected();
        E._selectionAnts();
        E.pointerDown(press[0], press[1]);
        for (let k = 1; k <= 25; k++) E.pointerMove(press[0] - 20 * k, press[1]);    // 500 px left: the window kept 400 past the view
        E._selectionAnts();
        const seq0 = E._selDecSeq;
        E.pointerUp();
        expect(E._selDecSeq).toBe(seq0 + 1);
    });
});

describe("G12 — the overlay origin is not read", () => {
    test("the live layer's origin 1e9 away leaves the painted plane byte-identical", () => {
        const ras = mkEngine(true);
        FIXTURES[0].run(ras);
        ras.renderer.syncCameraOnly();
        const ov = overlayOf(ras);
        expect(ov).toBeTruthy();
        const before = Uint8Array.from(ov.buf.data);
        expect(before.some((x) => x > 0)).toBe(true);
        const r0 = ov.report().repaints;
        // A NEW object, so `_selDecide`'s `c.origin === O` misses and the decision is made again
        // — at an origin a thousand kilometres away.
        ras.renderer.live.origin = { x: 1e9, y: 1e9 };
        ras.renderer.syncCameraOnly();
        expect(ov.report().repaints).toBe(r0 + 1);          // it really did decide and paint again
        expect(Uint8Array.from(ov.buf.data)).toEqual(before);
    });
});

describe("G13 — `bl-sel-layer` is never built in raster mode", () => {
    test("50 renders and 20 ticks leave no `bl-sel-layer`, and the edge layer holds only chevrons", () => {
        const ras = mkEngine(true);
        // A stroke that runs off the left of the screen: a screen-edge span, and — at 200 units
        // wide, a third of the side — a chevron on it (`SEL_CHEVRON_FRACTION`).
        const o = penStroke(ras, [[-600, 300], [200, 300]], 200);
        ras.setTool("select"); ras._setSelection([o.id]);
        ras._render();
        for (let i = 0; i < 50; i++) ras.renderer.syncCameraOnly();
        const ov = overlayOf(ras);
        ov.resume();
        for (let i = 0; i < 20; i++) ov.step();
        expect(ras.renderer.host.querySelector(".bl-sel-layer")).toBeNull();
        expect(document.querySelector(".bl-sel-layer")).toBeNull();
        expect(ras.renderer._selEls.layer).toBeNull();
        const edges = edgeLayerOf(ras);
        expect(edges).not.toBeNull();
        // G7's second clause: nothing in `bl-sel-edges` is dashed — the edge runs are the four
        // strip canvases, and a CSS crawl beside a canvas crawl could not be kept in phase.
        expect(edges.querySelectorAll("[stroke-dasharray]").length).toBe(0);
        expect(edges.querySelectorAll("path.bl-sel-ants").length).toBe(0);
        const arrows = edges.querySelectorAll("path.bl-sel-arrow");
        expect(arrows.length).toBeGreaterThan(0);
        expect(edges.querySelectorAll("path").length).toBe(arrows.length);
        // the ants are on the canvas instead
        expect(ov._canvas.getAttribute("class")).toBe("bl-overlay");
        expect(ov.report().phases).toBeGreaterThan(20);
    });

    test("the SVG engine still builds both layers, from the same fixture", () => {
        const svg = mkEngine(false);
        const o = penStroke(svg, [[-600, 300], [200, 300]], 13);
        svg.setTool("select"); svg._setSelection([o.id]);
        svg._render();
        expect(svg.renderer.host ? true : true).toBe(true);
        expect(document.querySelector(".bl-sel-layer")).not.toBeNull();
        expect(svg.renderer._selEls.layer).not.toBeNull();
        expect(svg.renderer._overlay).toBeUndefined();
    });
});

// OPEN-FLAGS F101: a remount builds the next engine in the same host, so a late camera step or
// render reaching the destroyed one must not put its overlay canvases back.
describe("F101 — a destroyed engine puts nothing back in its host", () => {
    const late = {
        zoom: (E) => E.zoomAt(400, 300, -100),
        render: (E) => E._render(),
        pan: (E) => E.panBy(5, 5),
        resize: (E) => E.resize(ENG_W - 10, ENG_H),
        cameraStep: (E) => E.renderer.syncCameraOnly(),
    };
    test.each(Object.keys(late))("a late %s after destroy leaves no overlay canvas", (k) => {
        const ras = mkEngine(true);
        const o = penStroke(ras, [[200, 300], [600, 320]], 40);
        ras.setTool("select"); ras._setSelection([o.id]);
        ras._render();
        const host = ras.renderer.host;
        expect(host.querySelector("canvas.bl-overlay")).not.toBeNull();
        ras.destroy();
        expect(host.querySelector("canvas.bl-overlay")).toBeNull();
        const list = ras._lastList, cam = JSON.stringify(ras.cam.state()), w = ras.width;
        late[k](ras);
        expect(host.querySelectorAll("canvas.bl-overlay, canvas.bl-overlay-edge").length).toBe(0);
        expect(ras.renderer._overlay).toBeNull();
        // and the engine itself did nothing: no list built, the camera and the size unmoved
        expect(ras._lastList).toBe(list);
        expect(JSON.stringify(ras.cam.state())).toBe(cam);
        expect(ras.width).toBe(w);
    });
});

describe("the renderer's override (§10 stage 5d, passes 4-6)", () => {
    function selected() {
        const ras = mkEngine(true);
        const o = penStroke(ras, [[-600, 300], [200, 300]], 200);
        ras.setTool("select"); ras._setSelection([o.id]);
        ras._render();
        return { ras, ov: overlayOf(ras), o };
    }

    /** What `show` was handed on the next camera step, with the arrays copied. */
    function showCalls(ras, ov) {
        const calls = [];
        const real = ov.show.bind(ov);
        ov.show = (dec, view, shift) => {
            calls.push({ dec, view, shift: shift && shift.slice() });
            return real(dec, view, shift);
        };
        ras.renderer.syncCameraOnly();
        return calls;
    }

    test("the layer is handed the PUBLISHED view, never the camera (FC2)", () => {
        const { ras, ov } = selected();
        const v = ras.renderer._view;
        expect(ov._paintAt.k).toBe(v.k);
        expect(ov._paintAt.tx).toBe(v.tx);
        expect(ov._paintAt.ty).toBe(v.ty);
        expect(ov.dpr).toBe(ras.renderer.layer.dpr);
        const calls = showCalls(ras, ov);
        expect(calls.length).toBe(1);
        expect(calls[0].view).toBe(v);              // the published object itself, not a copy
    });

    test("the edge spans take the camera-to-view shift and the inset does not (§15.3 Q5)", () => {
        const { ras, ov } = selected();
        // A FRACTIONAL pan, so the shift is not trivially zero: the ink is composed at the
        // snapped device translation the view carries and the camera's own pan is not snapped,
        // which is the up-to-half-a-device-pixel separation FC2 exists to remove.
        ras.cam.inPanX += 0.37; ras.cam.inPanY -= 0.21;
        ras.renderer.syncCameraOnly();
        const v = ras.renderer._view;
        const shift = ras.renderer._edgeShift(v);
        expect(Math.abs(shift[0])).toBeGreaterThan(0);
        expect(Math.abs(shift[0])).toBeLessThanOrEqual(0.5 / v.dpr);
        expect(shift).toEqual([v.tx / v.dpr - ras.cam.inPanX, v.ty / v.dpr - ras.cam.inPanY]);
        expect(ras.renderer._edgeShift(v)).toBe(shift);            // one array, mutated (FC5)
        const calls = showCalls(ras, ov);
        expect(calls[0].shift).toEqual(shift);                     // and it reaches the layer
        // the left strip is painted, and its ink sits at the band's own inset from the side
        const left = ov._strips[0];
        let lit = 0;
        for (let i = 3; i < left.buf.data.length; i += 4) if (left.buf.data[i] > 0) lit++;
        expect(lit).toBeGreaterThan(0);
    });

    test("the overlay joins the ONE layer list: resize, release and teardown reach it", () => {
        const { ras, ov } = selected();
        const R = ras.renderer;
        expect(R._layers).toEqual([R.layer, R.svg, ov, R._edgeSlot]);   // z order: 0, 1, 2, 3 (A3 §7.2)
        ras.renderer.setSize(640, 480);
        expect(ov.cssW).toBe(640);
        expect(edgeLayerOf(ras).getAttribute("width")).toBe("640");       // z 3 by the same walk
        expect(ov.report().bytes).toBe(640 * 480 * 4);
        ras.renderer._onStoreRelease("hidden");
        expect(ov.buf).toBe(null);
        ras.renderer.destroy();
        expect(ov._canvas).toBe(null);
        expect(ras.renderer._overlay).toBe(null);
    });

    test("the selection going away hides the plane and drops the edge layer, keeping the buffer", () => {
        const { ras, ov } = selected();
        const data = ov.buf.data;
        expect(edgeLayerOf(ras)).not.toBeNull();
        ras.setTool("pen");                      // a tool change drops the selection
        ras.renderer.syncCameraOnly();
        expect(edgeLayerOf(ras)).toBeNull();
        expect(ras.renderer._selEls).toBeNull();
        expect(ov._shown).toBe(false);
        expect(ov.buf.data).toBe(data);          // FC1: a tool change must not cost 10.48 MiB
    });

    test("the chevrons are `svgOverlay`'s, called and not copied (A3 §7.2)", () => {
        const { ras } = selected();
        const spy = jest.spyOn(svgOverlay, "renderSelChevrons");
        try {
            ras.renderer.syncCameraOnly();
            expect(spy).toHaveBeenCalled();
            const [els, edges, kt, W, H] = spy.mock.calls[spy.mock.calls.length - 1];
            expect(els).toBe(ras.renderer._selEls);
            expect(edges.length).toBeGreaterThan(0);
            expect(kt).toBe(selAntScale(ras._selectionAnts().inkPx));
            expect([W, H]).toEqual([ENG_W, ENG_H]);
            const own = Object.getOwnPropertyNames(Object.getPrototypeOf(ras.renderer)).filter((k) => /Chevron/.test(k));
            expect(own).toEqual([]);                                // no copy on the raster renderer
        } finally { spy.mockRestore(); }
    });

    test("reduced motion: the renderer owns the listener and the layer stops the clock (§15.3 Q9)", () => {
        const mqs = [];
        const fake = (q) => {
            const mq = { media: q, matches: false, listeners: [],
                addEventListener: (k, fn) => mq.listeners.push(fn),
                removeEventListener: (k, fn) => { const i = mq.listeners.indexOf(fn); if (i >= 0) mq.listeners.splice(i, 1); },
                fire: (v) => { mq.matches = v; for (const fn of mq.listeners.slice()) fn({ matches: v }); } };
            mqs.push(mq);
            return mq;
        };
        window.matchMedia = fake;
        try {
            const { ras, ov } = selected();
            // Two queries are asked: the layer reads the setting once at construction and the
            // RENDERER is the one that listens (§15.3 Q9 (a)) — so exactly one carries a listener.
            const rm = mqs.filter((m) => m.media.indexOf("reduced-motion") >= 0);
            expect(rm.length).toBe(2);
            const live = rm.filter((m) => m.listeners.length > 0);
            expect(live.length).toBe(1);
            expect(live[0].listeners.length).toBe(1);
            expect(ov._reduced).toBe(false);
            expect(ov._timer).not.toBe(null);               // the crawl is running
            live[0].fire(true);
            expect(ov._reduced).toBe(true);
            expect(ov._timer).toBe(null);                   // stopped, not merely slowed (G9)
            expect(ov._phase).toBe(0);                      // and painted once, at phase 0
            expect(ov.report().phases).toBeGreaterThan(0);
            live[0].fire(false);
            expect(ov._reduced).toBe(false);
            expect(ov._timer).not.toBe(null);               // and armed again
            ras.renderer.destroy();
            expect(live[0].listeners.length).toBe(0);       // and the listener goes with it
        } finally {
            delete window.matchMedia;
        }
    });
});
