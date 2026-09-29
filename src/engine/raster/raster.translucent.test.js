/**
 * Translucent objects moved under, over and between others (Kobin, 2026-09-23: "ideally it would
 * show under the translucent object while you're moving it, but at least it should once you set
 * it down"). The picture z order and opacity define — flat colours source-over in z order on the
 * paper — against the real compose (`PicturePyramid.compose` into `softCanvas`), pixel by pixel: at
 * every step of a drag the plane draws, while it lands, once the plates are fresh, and on a drag
 * whose plane is refused (a render a step). What a real browser shows is measured in Chrome.
 */
import KobinEngine from "../KobinEngine";
import { resetPlaneStats } from "./MovePlane";
import { PLATE_PX } from "./plate";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { softCtx, over } from "../__testkit__/softCanvas";

const engines = [];
function mkSoftEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    E.renderer.pyramid.cfg.patchInlineMs = 0;          // a change's patch goes to the pool: the landing and the stale steps are seen
    const L = E.renderer.layer;
    // The pyramid draws a level's plates at σ (nine-argument `drawImage`): sampled, and `magnified` counts a draw
    // whose destination is not its source's size.
    const soft = (w, h) => {
        const c = softCtx(w, h, PLATE_PX, { scaled: true }), di = c.drawImage;
        c.magnified = 0;
        c.drawImage = (bm, ...a) => { if (a.length === 8 && (a[6] !== a[2] || a[7] !== a[3])) c.magnified++; return di.call(c, bm, ...a); };
        return c;
    };
    L._ctx = soft(L._canvas.width, L._canvas.height);
    L._mk = (w, h) => ({ width: w, height: h, getContext: () => soft(w, h) });
    const put = E.plates.put.bind(E.plates);
    E.plates.put = (rec) => { if (rec.pixels && !rec.bitmap) rec.bitmap = { pixels: rec.pixels }; return put(rec); };
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});
async function flush(rounds = 40) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}
async function until(pred, ms = 5000) {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
    return pred();
}

const PAPER = [255, 255, 255];
const BLUE = [30, 30, 200], YELLOW = [220, 200, 20], RED = [200, 30, 30], GREEN = [30, 160, 30], BLACK = [13, 12, 11];
const box = (E, r, rgb, a) => {
    const [x, y, w, h] = r;
    E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(" + rgb.join(",") + ")", opacity: a,
        polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, "0");
    return { r, rgb, a };
};
const inside = (x, y, [bx, by, bw, bh]) => x > bx + 2 && x < bx + bw - 2 && y > by + 2 && y < by + bh - 2;
const nearEdge = (x, y, [bx, by, bw, bh]) => Math.abs(x - bx) <= 2 || Math.abs(x - bx - bw) <= 2 || Math.abs(y - by) <= 2 || Math.abs(y - by - bh) <= 2;
const close = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/**
 * The cases: [name, the fills in z order with the selected one flagged]. A blue ground under all;
 * a yellow bar (x 300–420) and a black-at-0.35 bar (x 500–620) the selected square crosses.
 */
const S0 = [100, 250, 100, 100];
const BAR1 = [300, 80, 120, 440], BAR2 = [500, 80, 120, 440];
const CASES = [
    ["an opaque square under a translucent bar", [[BAR1, YELLOW, 1], [S0, RED, 1, true], [BAR2, BLACK, 0.35]]],
    ["a translucent square under a translucent bar", [[BAR1, YELLOW, 1], [S0, GREEN, 0.5, true], [BAR2, BLACK, 0.35]]],
    ["a translucent square over a translucent bar", [[BAR1, YELLOW, 0.6], [BAR2, BLACK, 0.35], [S0, RED, 0.5, true]]],
    ["a translucent square between two translucent bars", [[BAR1, YELLOW, 0.6], [S0, GREEN, 0.5, true], [BAR2, BLACK, 0.35]]],
];

async function scene(fills) {
    const E = mkSoftEngine();
    const bg = box(E, [20, 20, 760, 560], BLUE, 1);
    const items = [bg];
    let selId = null;
    for (const [r, rgb, a, sel] of fills) {
        const it = box(E, r, rgb, a);
        items.push(it);
        if (sel) { it.sel = true; selId = E.doc.list("0")[E.doc.list("0").length - 1].id; }
    }
    E._render(); await flush();
    return { E, items, selId };
}
/** The picture with the selected item displaced by `dx`, at a CSS point. */
function want(items, dx, x, y) {
    const layers = [];
    for (const it of items) {
        const r = it.sel ? [it.r[0] + dx, it.r[1], it.r[2], it.r[3]] : it.r;
        if (inside(x, y, r)) layers.push([it.rgb, it.a]);
    }
    return over(PAPER, layers);
}
const edgy = (items, dx, x, y) => items.some((it) => nearEdge(x, y, it.sel ? [it.r[0] + dx, it.r[1], it.r[2], it.r[3]] : it.r));
/** Every sample point along the path at displacement dx whose expected colour is well defined. */
function check(E, items, dx, bad, tag) {
    const ctx = E.renderer.layer._ctx, dpr = E.renderer._view.dpr;
    for (let x = 60; x <= 760; x += 17) {
        for (const y of [270, 300, 330]) {
            if (edgy(items, dx, x, y)) continue;
            const w = want(items, dx, x, y), got = ctx.at(x * dpr, y * dpr);
            if (!close(got, w)) bad.push([tag, dx, x, y, got.join(","), w.join(",")].join(" "));
        }
    }
}

describe("translucent moves (Kobin 2026-09-23): the composed picture against z order and opacity", () => {
    for (const [name, fills] of CASES) {
        test(name + ": every drag step on the plane, the landing, and the fresh plates", async () => {
            const { E, items, selId } = await scene(fills);
            E.setTool("select");
            E._setSelection([selId], []);
            E._render();
            const R = E.renderer, pl = R._plane;
            R.pyramid.cfg.patchUserMs = 0;                          // the drop's patch goes to the pool: the landing is seen
            expect(await until(() => pl.layers.length > 0 && pl.checkReady(E.plates))).toBe(true);
            const bad = [];
            let drawn = 0;
            E.pointerDown(150, 300);
            for (let dx = 10; dx <= 560; dx += 10) {
                E.pointerMove(150 + dx, 300);
                if (!R.layer._plane) continue;                         // not whole yet: the ink stays put
                check(E, items, dx, bad, "drag");
                drawn++;
            }
            expect(drawn).toBeGreaterThan(50);
            E.pointerUp();
            expect(pl.state).toBe("land");
            check(E, items, 560, bad, "land");
            await flush();
            E.renderer.layer.compose();
            check(E, items, 560, bad, "fresh");
            expect(E.renderer.layer._ctx.magnified).toBe(0);             // at the plane's own zoom: every draw 1:1
            expect(bad.slice(0, 12)).toEqual([]);
        });
    }

    test("a drag without the plane (a render a step): once each step's plates land, the picture is the same", async () => {
        const [, fills] = CASES[3];
        const { E, items, selId } = await scene(fills);
        E.setTool("select");
        E.renderer.forcePerStepDrag = true;                           // no plane: every drag renders each step
        E._setSelection([selId], []);
        E._render(); await flush();
        const bad = [];
        let staleSteps = 0;
        E.pointerDown(150, 300);
        for (let dx = 20; dx <= 560; dx += 20) {
            E.pointerMove(150 + dx, 300);
            const before = [];
            check(E, items, dx, before, "stale");
            if (before.length) staleSteps++;
            await flush();
            E.renderer.layer.compose();
            check(E, items, dx, bad, "step");
        }
        expect(E._holdMove.plane).toBe(false);                        // held, drawn by the view's plates (A1 C2)
        E.pointerUp();
        await flush();
        E.renderer.layer.compose();
        check(E, items, 560, bad, "drop");
        expect(bad.slice(0, 12)).toEqual([]);
        // until they land, each step shows the plates it had (reported, not a defect: the stale rule)
        expect(staleSteps).toBeGreaterThan(0);
    });
});

describe("translucent moves on ?svg: the group order and opacity through a drag", () => {
    test("the dragged group keeps its place between the two bars and its opacity, every step", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, { width: 800, height: 600 });
        engines.push({ E, host });
        const ids = [];
        const add = (r, rgb, a) => { box(E, r, rgb, a); ids.push(E.doc.list("0")[E.doc.list("0").length - 1].id); };
        add([20, 20, 760, 560], BLUE, 1); add(BAR1, YELLOW, 0.6); add(S0, GREEN, 0.5); add(BAR2, BLACK, 0.35);
        E._render();
        E.setTool("select");
        E.pointerDown(150, 300); E.pointerUp();
        expect(E.selection.ids).toEqual([ids[2]]);
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 560; dx += 10) {
            E.pointerMove(150 + dx, 300);
            const order = E.renderer._order.filter((id) => ids.includes(id));
            expect(order).toEqual(ids);
            expect(E.renderer._groups.get(ids[2]).group.opacity).toBeCloseTo(0.5, 6);
            expect(E.renderer._groups.get(ids[3]).group.opacity).toBeCloseTo(0.35, 6);
        }
        E.pointerUp();
        expect(E.renderer._order.filter((id) => ids.includes(id))).toEqual(ids);
    });
});
