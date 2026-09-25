/**
 * raster.phone.test.js — Kobin's phone reports of 2026-09-23 (Chrome on Android, 411×750 @2.625):
 * a translucent object under another dragged "really jumpy" (the drag plane refused by the phone's
 * plate cap), and a red line "chunky/corner-y right after I finish drawing it ... until I pan or
 * zoom" (a raw stroke banded through its samples, and the resolved perimeter never re-rastered).
 *
 * jsdom has no canvas: the plates' own bytes are read out of the store (the inline path's raw
 * `pixels`), as `raster.move.test.js` does. Paint on the phone is measured in Kobin's Chrome.
 */
import KobinEngine from "../KobinEngine";
import { PHONE_CACHE_BYTES } from "./PlateStore";
import { planeStats, resetPlaneStats, MOVE_PLANE_PLATES_PHONE } from "./MovePlane";
import { plateKey, PLATE_PX } from "./plate";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { flattenCurve } from "../geometry/polyline";
import { itemBox } from "./rasterPack";

const engines = [];
const DPR0 = window.devicePixelRatio;
function mkEngine(w, h, { dpr = 1, phone = false } = {}) {
    Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    if (phone) { E.plates.maxBytes = PHONE_CACHE_BYTES; E.plates.phone = true; }
    E.renderer.layer.syncBudget = 0;                   // the plates path
    E.renderer.layer._sync = false;
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
    Object.defineProperty(window, "devicePixelRatio", { value: DPR0, configurable: true });
});

async function flush(rounds = 40) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return k + 1;
    }
    return rounds;
}
const quiet = () => new Promise((r) => setTimeout(r, 200));

/** A fill covering the CSS-px screen rectangle [x0, x1] × [y0, y1] at the camera's frame. */
function screenFill(E, x0, y0, x1, y1, color, opacity = 1) {
    const a = E.cam.screenToFrame(x0, y0), b = E.cam.screenToFrame(x1, y1);
    return E.doc.add({
        type: "fill", origin: "native", id: E.doc.allocId(), color, opacity,
        polys: [[[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]],
    }, E.cam.frame);
}

/** The view plate of quantum `q` under a CSS screen point: its store entry, and the RGBA there (null: no plate, "empty": a paper plate). */
function plateAt(E, q, sx, sy) {
    const v = E.renderer.layer.view();
    const X = Math.floor(sx * v.dpr - v.dx + v.ox), Y = Math.floor(sy * v.dpr - v.dy + v.oy);
    const i = Math.floor(X / PLATE_PX), j = Math.floor(Y / PLATE_PX);
    const key = plateKey(v.frameId, q, i, j), e = E.plates.get(key);
    if (!e) return { key, e: null, rgba: null };
    if (!e.pixels) return { key, e, rgba: "empty" };
    const o = ((Y - j * PLATE_PX) * PLATE_PX + (X - i * PLATE_PX)) * 4;
    return { key, e, rgba: Array.from(e.pixels.subarray(o, o + 4)) };
}
/** How much red ink covers a CSS screen point of the view's plates: 0 on paper, 1 under the pen (the plates are opaque; green is 20 in the ink, 255 in the paper). */
const inkAt = (E, sx, sy) => { const r = plateAt(E, E.renderer.layer.view().q, sx, sy).rgba; return Array.isArray(r) ? (255 - r[1]) / 235 : 0; };

describe("the phone's drag plane (report 08-11-20: the beige object under the green one)", () => {
    test("P1 a selection under an overlying object takes the plane on a phone: the drag builds no list", async () => {
        const E = mkEngine(411, 750, { dpr: 2.625, phone: true });
        const beige = screenFill(E, 60, 120, 260, 420, "#a06b2c", 0.45);
        screenFill(E, 150, 250, 300, 450, "#3d5a45", 0.45);        // drawn after: over the beige one
        E._render();
        await flush();
        E.setTool("select");
        E.pointerDown(80, 150); E.pointerUp();
        expect(E.selection && E.selection.ids).toEqual([beige.id]);
        E._render();
        await quiet();
        await flush();
        const pl = E.renderer._plane;
        // The report's case: BELOW, the selection and what is over it — 16 plates, as the beige object's.
        expect(planeStats.coarse + planeStats.overCap).toBe(0);    // at its own zoom: red at the old cap of 12 (refused then)
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over"]);
        expect(pl.keys.length).toBeGreaterThan(12);
        expect(pl.keys.length).toBeLessThanOrEqual(MOVE_PLANE_PLATES_PHONE);
        const lists = jest.spyOn(E, "_buildList");
        E.pointerDown(80, 150);
        for (let k = 1; k <= 20; k++) E.pointerMove(80 + k * 4, 150 + k * 2);
        expect(E._holdMove).toBeTruthy();
        expect(pl.state).toBe("drag");
        expect(lists).not.toHaveBeenCalled();                      // red at 12: a list and a re-raster a step
        E.pointerUp();
    });
});

describe("a finished stroke on the plates (report 08-13-01: the red line)", () => {
    /** Eight samples on a circle of radius 150 CSS px: the curve through them bows ~7 px off each chord. */
    const circle = (E, cx, cy, r = 150, n = 8) => {
        const out = [];
        for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; out.push(E.cam.screenToFrame(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
        return out;
    };

    test("P2 a raw stroke's plates follow the curve through its samples, as the SVG renderer and the hit test draw it", async () => {
        const E = mkEngine(800, 600);
        const pts = circle(E, 400, 300);
        const o = E.doc.add({ type: "stroke", origin: "native", id: E.doc.allocId(), pts, lwFrame: 4 / E.cam.inScale, color: "rgb(220,20,20)", opacity: 1 }, E.cam.frame);
        E._render();
        await flush();
        expect(E.doc.getById(o.id).obj.type).toBe("stroke");      // still raw: nothing baked it
        // Between samples 0 and 1: the curve's farthest point from the chord, and the chord's midpoint.
        const curve = flattenCurve(pts.slice(0, 3), 1e-3);
        const [a, b] = [pts[0], pts[1]];
        let far = null, d = -1;
        for (const p of curve) {
            const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
            if (t <= 0 || t >= 1) continue;
            const dist = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (dist > d) { d = dist; far = p; }
        }
        expect(d * E.cam.inScale).toBeGreaterThan(5);              // the fixture discriminates: over twice the 2 px half-pen
        const onCurve = E.cam.levelPointToScreen(E.cam.frame, far[0], far[1]);
        const mid = E.cam.levelPointToScreen(E.cam.frame, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        expect(inkAt(E, onCurve[0], onCurve[1])).toBeGreaterThan(0.5);   // red with the polyline band: 0
        expect(inkAt(E, mid[0], mid[1])).toBe(0);                           // red with the polyline band: 1
    });

    test("P2b a raw stroke's cull box holds the curve's bulge, not only its samples", () => {
        const pts = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0], [100, 0]];   // a loop: the curve overshoots its corners
        const item = { type: "stroke", origin: "native", id: 1, pts, lwFrame: 2 };
        const b = itemBox(item, { arcTolerancePx: 0.25, enter: 256 });
        const curve = flattenCurve(pts, 1e-3);
        let out = 0;
        for (const p of curve) if (p[0] - 1 < b[0] || p[0] + 1 > b[2] || p[1] - 1 < b[1] || p[1] + 1 > b[3]) out++;
        expect(Math.min(...curve.map((p) => p[0]))).toBeLessThan(-1);   // the fixture: the curve leaves the samples' box by more than the pen
        expect(out).toBe(0);                                              // red with the samples' box alone: the band culled where it bulges
    });

    test("P4 a stroke homed deeper than the view: its resolve re-derives the projected copy, not re-rasters the raw one", async () => {
        const E = mkEngine(800, 600);
        E.cam.inPanX = 400; E.cam.inPanY = 300;
        E.zoomFactorAt(400, 300, 1 / 30);                          // just above EXIT: the next zoom-out crosses
        E._render(); await flush();
        E._scheduleBake = () => {};                                // the resolve, run by hand below
        E.setTool("pen"); E.setWidth(5); E.setColor("rgb(220,20,20)");
        const pts = [];
        for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI * 2; pts.push([400 + 250 * Math.cos(a), 300 + 250 * Math.sin(a)]); }
        E.pointerDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        const id = E.doc.list(E.cam.frame).slice(-1)[0].id, home = E.doc.getById(id).level;
        E.zoomFactorAt(400, 300, 0.9);                              // across the crossing: the stroke is one level down
        E._render(); await flush();
        expect(E.cam.frame).not.toBe(home);
        expect(E._lastList.filter((o) => o.id === id).map((o) => o.type)).toEqual(["stroke"]);   // the fixture: a projected raw copy
        const view = () => { const v = E.renderer.layer.view(); return v.frameId + "|" + v.q + "|" + v.Zq; };
        const ink = () => { const m = new Uint8Array(800 * 600); for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) { const r = plateAt(E, E.renderer.layer.view().q, x + 0.5, y + 0.5).rgba; m[y * 800 + x] = Array.isArray(r) && r[1] < 160 ? 1 : 0; } return m; };
        const settled = async () => { for (let k = 0; k < 10 && E.renderer.layer.view().mode !== "settle"; k++) { await quiet(); await flush(); } await flush(); };
        while (E._stepShapeBakes(1000));
        await flush(); await settled();
        const at = view(), after = ink();
        expect(E._lastList.filter((o) => o.id === id).map((o) => o.type)).not.toContain("stroke");   // red: the stale copy
        E.plates.dropAll(); E._render(); await flush(); await settled();   // the picture from scratch
        expect(view()).toBe(at);
        const truth = ink();
        let differ = 0;
        for (let k = 0; k < truth.length; k++) if (truth[k] !== after[k]) differ++;
        expect(differ).toBe(0);                                     // red: 11,846 pixels of the raw band kept on fresh plates
    });

    test("P3 the resolved perimeter reaches the plates without a pan or a zoom", async () => {
        const E = mkEngine(800, 600);
        E._render();
        await flush();
        const bake = E._scheduleBake;
        E._scheduleBake = () => {};                                // the app's bake, run by hand below
        E.setTool("pen"); E.setWidth(6); E.setColor("rgb(220,20,20)");
        const pts = [[250, 300], [330, 240], [420, 330], [520, 250]];
        E.pointerDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        await flush();
        const id = E.doc.list(E.cam.frame).slice(-1)[0].id;
        expect(E.doc.getById(id).obj.type).toBe("stroke");
        const before = plateAt(E, E.renderer.layer.view().q, 330, 240).e;
        expect(before && before.pixels).toBeTruthy();             // the raw stroke's plate
        E._scheduleBake = bake;
        while (E._stepShapeBakes(1000));                           // the resolve, as `_bakeTick` runs it: no render of its own
        expect(E.doc.getById(id).obj.type).toBe("shape");
        await flush();
        expect(E._plateEvents.length).toBe(0);                     // red: the resolve's event waits for a camera step
        const after = plateAt(E, E.renderer.layer.view().q, 330, 240);
        expect(after.e).not.toBe(before);                          // re-rastered from the shape
        expect(E.renderer.layer.cellFresh(E.renderer.layer.view(), after.e.i, after.e.j)).toBe(true);
    });
});
