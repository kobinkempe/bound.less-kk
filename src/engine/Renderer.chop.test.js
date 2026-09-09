/**
 * F40 — the window chop: nothing far from the view is ever handed to the
 * browser.
 *
 * Every coordinate reaches the browser in float32 relative to the scene
 * origin, and Chrome's GPU raster drops a path whose cubics run beyond roughly
 * 1e7 device px (Kobin's red piece: painted at inScale 64, gone at 78.8, `d`
 * unchanged). So each scene keeps a window of ±2^18 device px around the view,
 * any area piece that reaches past it is clipped to it with the tile
 * machinery's own exact boolean, and the window is chosen again — rebuilding
 * only the straddling groups — when the view leaves its inner half or the zoom
 * grows fourfold. These tests pin the size, the bound, the verdicts, and the
 * one thing Kobin asked for by name: "if you pan towards the end of the
 * segment, the next segment is loaded" — the view is never, on any camera
 * frame, outside the window its chopped pieces were cut to.
 */
import { useEngines, mkEngine, descend } from "./__testkit__/harness";
import Renderer from "./Renderer";

useEngines();

const CHOP_PX = 262144;            // 2^18: the default config's window half-extent in device px
const CHOP_ZOOM = 4;

const arcAt = (cx, cy, r, a0, sweep) => ({
    line: false, C: [cx, cy], r, a0, sweep,
    A: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
    B: [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)],
});
// A circle as n equal arcs, the first starting at angle a0. The big circles
// below start at 45° so that the point the window cuts them at — their
// leftmost — is inside a piece and not a boundary between two.
const ring = (cx, cy, r, n = 4, a0 = 0) => { const step = (2 * Math.PI) / n; return Array.from({ length: n }, (_, i) => arcAt(cx, cy, r, a0 + i * step, step)); };
const Q = Math.PI / 4;
let nextId = 700000;
const addShape = (E, loops, extra = {}) => {
    const id = nextId++;
    E.doc.add({ type: "shape", id, origin: "native", color: "#123456", opacity: 1, loops, ...extra }, E.cam.frame);
    return id;
};
const addFill = (E, polys, extra = {}) => {
    const id = nextId++;
    E.doc.add({ type: "fill", id, origin: "native", color: "#000000", opacity: 1, polys, ...extra }, E.cam.frame);
    return id;
};
// Put the view centre on frame point (cx, cy) at in-frame zoom s, and render.
const look = (E, cx, cy, s) => {
    E.cam.set({ frame: "0", activeLevel: 0, inScale: s, inPanX: 400 - cx * s, inPanY: 300 - cy * s });
    E._render();
};
const scene = (E) => E.renderer._scenes.get(E.renderer._level);
const entry = (E, id) => E.renderer._groups.get(id);
const dOf = (e) => [...e.group._renderer.elem.querySelectorAll("path")].map((p) => p.getAttribute("d") || "").join(" ");
const numsOf = (d) => (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []).map(Number);
const maxAbs = (d) => numsOf(d).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const count = (s, ch) => (s.match(new RegExp(ch, "g")) || []).length;
// Is the whole view inside the scene's window (not just its inner half)?
const viewInside = (E) => {
    const w = E.cam.frameWindow(0), r = scene(E).chop.rect;
    return w.left >= r.left && w.right <= r.right && w.top >= r.top && w.bottom <= r.bottom;
};
// The anchors of a group in FRAME units: origin-relative path units, undone
// for the thin rescale and the scene origin. Walks the `d` as absolute
// commands (Two.js writes M/L/C/A with absolute coordinates); a C or an A
// contributes its END only — control points and arc parameters are not
// anchors and lie off the curve by design.
const framePoints = (E, e) => {
    const S = e.thinScale || 1, og = E.renderer._origin();
    const toks = dOf(e).match(/[MLCAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    const pts = [];
    let cmd = null, buf = [];
    const flush = () => {
        if (!cmd || !buf.length) return;
        const pairs = [];
        if (cmd === "A" || cmd === "C") pairs.push(buf.slice(-2));
        else for (let i = 0; i + 1 < buf.length; i += 2) pairs.push([buf[i], buf[i + 1]]);
        for (const [x, y] of pairs) pts.push([x / S + og.x, y / S + og.y]);
        buf = [];
    };
    for (const t of toks) {
        if (/[MLCAZ]/.test(t)) { flush(); cmd = t; }
        else buf.push(Number(t));
    }
    flush();
    return pts;
};

describe("the window chop (F40)", () => {
    test("the window's size for the default config, and the bound it keeps", () => {
        const E = mkEngine();
        expect(E.renderer._chopPx).toBe(CHOP_PX);
        // The view stays within half the window of its centre and within the
        // re-origin budget of the origin, and the zoom grows at most CHOP_ZOOM
        // times before a re-chop, so no anchor is ever farther from the origin
        // than this — which has to be under tol·2^24, the coordinate at which
        // float32 has spent the quarter pixel.
        const farthest = 1.5e6 + 1.5 * CHOP_ZOOM * CHOP_PX;
        expect(farthest).toBeLessThanOrEqual(0.25 * Math.pow(2, 24));
        expect(farthest * Math.pow(2, -24)).toBeLessThan(0.19);
        // ...and a third of where Chrome's raster was measured to give up.
        expect(farthest).toBeLessThan(1e7 / 3);
    });

    test("a piece that reaches past the window is clipped to it; a small one, and one wholly outside, go whole", () => {
        const E = mkEngine();
        const big = addShape(E, [ring(50000, 0, 50000, 4, Q)]);   // its left edge passes through (0, 0)
        const small = addShape(E, [ring(0, 0, 3)]);
        const far = addShape(E, [ring(150000, 0, 40000)]);        // bbox 110,000..190,000: wholly outside
        look(E, 0, 0, 64);
        const half = CHOP_PX / 64;                                 // 4,096 units
        expect(scene(E).chop.half).toBe(half);
        const eb = entry(E, big), es = entry(E, small), ef = entry(E, far);
        expect(eb.sig).toMatch(/:w\d+$/);
        expect(es.sig).not.toMatch(/:w/);
        expect(ef.sig).not.toMatch(/:w/);
        // The far piece is handed over whole, far coordinates and all (the
        // anchors are relative to the scene origin, which is where the first
        // render's view centre was: (400, 300), so 110,000 reads as 109,600).
        expect(maxAbs(dOf(ef))).toBeGreaterThan(100000 * (ef.thinScale || 1));
        // The chop is exact: the circle's edge inside the window is one cubic
        // (sweep 0.16 rad at 1.28e7 px of radius at the frame's deepest zoom
        // asks for one), and both of its ends lie on the true circle.
        const d = dOf(eb);
        expect(count(d, "C")).toBe(1);
        const pts = framePoints(E, eb);
        const onCircle = pts.filter(([x, y]) => Math.abs(Math.hypot(x - 50000, y) - 50000) < 1e-2);
        expect(onCircle.length).toBeGreaterThanOrEqual(2);
        // and every anchor, on the circle or on the window's edge, is inside the window
        for (const [x, y] of pts) {
            expect(x).toBeGreaterThanOrEqual(-half - 1e-6); expect(x).toBeLessThanOrEqual(half + 1e-6);
            expect(y).toBeGreaterThanOrEqual(-half - 1e-6); expect(y).toBeLessThanOrEqual(half + 1e-6);
        }
    });

    test("panning: the view is never outside the window, and the next stretch is built at the inner half's edge", () => {
        const E = mkEngine();
        const big = addShape(E, [ring(50000, 0, 50000, 4, Q)]);
        look(E, 0, 0, 64);
        let last = scene(E).chop.key, rechops = 0, at = null;
        // 400 steps of 500 px = 3,125 units to the right, across the inner half (2,048 units).
        for (let i = 0; i < 400; i++) {
            E.panBy(-500, 0);
            expect(E.renderer.needsWindowChop()).toBe(false);   // a camera frame never ends outside the inner half
            expect(viewInside(E)).toBe(true);
            if (scene(E).chop.key !== last) { rechops++; last = scene(E).chop.key; at = E.cam.centre()[0]; }
        }
        expect(rechops).toBe(1);
        // The re-chop happened as the view's right edge crossed the inner half
        // (2,048 units), not before and not late: within one step of it.
        expect(at).toBeGreaterThan(2048 - 6.25 - 8);
        expect(at).toBeLessThan(2048 - 6.25 + 8);
        // The piece is still there, chopped to the NEW window, its edge (x = 0)
        // still inside it, one cubic as before.
        const eb = entry(E, big);
        expect(eb.sig).toMatch(/:w/);
        expect(count(dOf(eb), "C")).toBe(1);
        const r = scene(E).chop.rect;
        for (const [x, y] of framePoints(E, eb)) {
            expect(x).toBeGreaterThanOrEqual(r.left - 1e-6); expect(x).toBeLessThanOrEqual(r.right + 1e-6);
            expect(y).toBeGreaterThanOrEqual(r.top - 1e-6); expect(y).toBeLessThanOrEqual(r.bottom + 1e-6);
        }
    });

    test("zooming in past the budget, and zooming out past the inner half, each choose the window again", () => {
        const E = mkEngine();
        addShape(E, [ring(50000, 0, 50000, 4, Q)]);
        look(E, 0, 0, 32);
        let last = scene(E).chop.key;
        const at = [];
        const step = (f) => {
            E.zoomFactorAt(400, 300, f);
            expect(E.renderer.needsWindowChop()).toBe(false);
            expect(viewInside(E)).toBe(true);
            if (scene(E).chop.key !== last) { last = scene(E).chop.key; at.push(E.cam.inScale); }
        };
        while (E.cam.inScale < 200) step(1.1);
        // One re-chop on the way in, the step that took the zoom past 4 × 32.
        expect(at.length).toBe(1);
        expect(at[0]).toBeGreaterThan(128);
        expect(at[0]).toBeLessThanOrEqual(128 * 1.1 + 1e-9);
        const s1 = at[0];
        // On the way out the window from s1 holds until the view outgrows its
        // inner half: 400 px > (CHOP_PX / s1) / 2 → s < s1 · 400 / 131,072.
        while (E.cam.inScale > 0.05) step(1 / 1.1);
        expect(at.length).toBe(2);
        const sOut = s1 * 400 / (CHOP_PX / 2);
        expect(at[1]).toBeLessThan(sOut);
        expect(at[1]).toBeGreaterThan(sOut / 1.1 - 1e-9);
    });

    test("polygon pieces and covering quads are clipped the same way", () => {
        const E = mkEngine();
        const sq = [[-100000, -100000], [100000, -100000], [100000, 100000], [-100000, 100000]];
        const fid = addFill(E, [sq]);
        const cid = addFill(E, [sq], { covers: true });
        look(E, 0, 0, 64);
        const half = CHOP_PX / 64;
        for (const id of [fid, cid]) {
            const e = entry(E, id);
            expect(e.sig).toMatch(/:w/);
            const d = dOf(e);
            expect(count(d, "L")).toBe(3);      // the window quad: a move and three lines, the fill closes it
            const pts = framePoints(E, e);
            expect(pts.length).toBe(4);
            for (const [x, y] of pts) {
                expect(Math.abs(x)).toBeCloseTo(half, 6);
                expect(Math.abs(y)).toBeCloseTo(half, 6);
            }
        }
    });

    test("a re-chop rebuilds the straddling groups and nothing else", () => {
        const E = mkEngine();
        const big = addShape(E, [ring(50000, 0, 50000, 4, Q)]);
        const small = addShape(E, [ring(0, 0, 3)]);
        look(E, 0, 0, 64);
        const path0 = entry(E, small).group.children[0], d0 = dOf(entry(E, small));
        const key0 = scene(E).chop.key;
        look(E, 3000, 0, 64);                   // past the inner half: a re-chop, no re-origin (192,000 px of drift)
        expect(scene(E).chop.key).toBe(key0 + 1);
        expect(E.renderer._lastRebuilds).toBe(1);
        expect(entry(E, big).sig).toMatch(new RegExp(":w" + (key0 + 1) + "$"));
        expect(entry(E, small).group.children[0]).toBe(path0);
        expect(dOf(entry(E, small))).toBe(d0);
    });

    test("an inherited tile piece one frame down is chopped too, and stays exact", () => {
        const E = mkEngine();
        // A circle of r = 200 around the top view's centre (400, 300): one frame
        // down it is r = 819,200, and its rightmost point (600, 300) is the
        // frame point under screen (600, 300), which the descent keeps fixed.
        const big = addShape(E, [ring(400, 300, 200, 4, Q)]);
        E._render();
        descend(E, 1, 600, 300);
        while (E.cam.inScale < 64) E.zoomFactorAt(600, 300, 1.5);
        const e = entry(E, big);
        expect(e).toBeTruthy();
        expect(e.pieces.some((o) => o.clip)).toBe(true);     // a tile piece, not the native
        expect(e.sig).toMatch(/:w/);
        const d = dOf(e);
        expect(count(d, "C")).toBe(1);
        // Every anchor within the window; every anchor not on the window's
        // edge is on the true circle, read back in the parent's own units to
        // a millionth (the arc's ends were cut at 819,200 units of radius).
        const r = scene(E).chop.rect;
        let onCircle = 0, onEdge = 0;
        for (const [x, y] of framePoints(E, e)) {
            expect(x).toBeGreaterThanOrEqual(r.left - 1e-3); expect(x).toBeLessThanOrEqual(r.right + 1e-3);
            expect(y).toBeGreaterThanOrEqual(r.top - 1e-3); expect(y).toBeLessThanOrEqual(r.bottom + 1e-3);
            const edge = Math.min(Math.abs(x - r.left), Math.abs(x - r.right), Math.abs(y - r.top), Math.abs(y - r.bottom)) < 1e-3;
            const [px, py] = E.lm.toParent([x, y], E.cam.frame);
            const circle = Math.abs(Math.hypot(px - 400, py - 300) - 200) < 1e-6;
            if (edge) onEdge++;
            if (circle) onCircle++;
            expect(edge || circle).toBe(true);
        }
        expect(onEdge).toBeGreaterThanOrEqual(2);
        expect(onCircle).toBeGreaterThanOrEqual(2);
    });

    test("with the chop off nothing is clipped", () => {
        Renderer.windowChop = false;
        try {
            const E = mkEngine();
            expect(E.renderer._chopPx).toBe(0);
            const big = addShape(E, [ring(50000, 0, 50000)]);
            look(E, 0, 0, 64);
            expect(E.renderer.needsWindowChop()).toBe(false);
            const e = entry(E, big);
            expect(e.sig).not.toMatch(/:w/);
            expect(maxAbs(dOf(e))).toBeGreaterThan(50000 * (e.thinScale || 1));
        } finally { Renderer.windowChop = true; }
    });
});
