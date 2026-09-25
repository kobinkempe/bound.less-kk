/**
 * raster.mask.test.js — Kobin, 2026-09-23: "if there's an eraser mark, we ALWAYS show something that
 * baked on top of it (nothing that's baked would ever be under an eraser mark, since the eraser mark
 * is just a short-term substitute for having nothing at all)". A pending mark paints nothing: it
 * masks the ink it has not baked yet (coverage × (1 − mark)), so an object cut early — by the select
 * barrier, out of the baker's order — shows over the ring wherever it is moved, an unbaked one stays
 * hidden under it, and outside the ring the z order is untouched. Real composed pixels (`softCanvas`).
 */
import KobinEngine from "../KobinEngine";
import { eraseGesture } from "../__testkit__/harness";
import { softCtx } from "../__testkit__/softCanvas";
import { PLATE_PX } from "./plate";
import { resetPlaneStats } from "./MovePlane";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { setEraseTransport } from "../eraseWorkerClient";

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    E.renderer.layer.syncBudget = 0;
    E.renderer.layer._sync = false;
    E._scheduleBake = () => {};                            // the bake waits: the mark stays pending
    const L = E.renderer.layer;
    L._ctx = softCtx(L._canvas.width, L._canvas.height, PLATE_PX);
    const put = E.plates.put.bind(E.plates);
    E.plates.put = (rec) => { if (rec.pixels && !rec.bitmap) rec.bitmap = { pixels: rec.pixels }; return put(rec); };
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });
afterEach(() => { while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); } });
async function flush(rounds = 40) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}
const quiet = () => new Promise((r) => setTimeout(r, 200));
const WHITE = [255, 255, 255], BLUE = [30, 30, 200], RED = [200, 30, 30], GREEN = [30, 160, 30];
const box = (E, x, y, w, h, c) => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(" + c.join(",") + ")", opacity: 1,
    polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, "0");
const ring = (cx, cy, r) => { const out = []; for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };
const at = (E, x, y) => { E.renderer.layer.compose(); return E.renderer.layer._ctx.at(x, y); };

/** Blue under everything, a red bar across the ring, a green bar over it; the ring erased and left pending. */
async function scene() {
    const E = mkEngine();
    box(E, 20, 20, 760, 560, BLUE);
    const R = box(E, 150, 250, 300, 100, RED);             // crosses the ring's band left and right
    box(E, 250, 150, 100, 300, GREEN);                     // over the red, crosses the band top and bottom
    E._render(); await flush();
    eraseGesture(E, ring(300, 300, 100), 16);
    E._render(); await flush();
    expect(E._eraseStrokes().length).toBe(1);
    return { E, R };
}

describe("a pending eraser mark masks only the ink it has not baked (Kobin, 2026-09-23)", () => {
    test("K1 before any bake: the ring shows paper over everything under it; outside it the z order is the drawing's", async () => {
        const { E } = await scene();
        expect(at(E, 200, 300)).toEqual(WHITE);            // the band over the red bar
        expect(at(E, 300, 200)).toEqual(WHITE);            // the band over the green bar
        expect(at(E, 300, 300)).toEqual(GREEN);            // inside the ring: green over red, untouched
        expect(at(E, 120, 300)).toEqual(BLUE);
    });

    test("K2 an object baked out of order and dragged across the ring shows over it at every step; the unbaked stay hidden and on top", async () => {
        const { E } = await scene();
        E._flushErasesFor(R_ID(E));                        // the select barrier: the red bar is cut, out of the baker's order
        expect(E._eraseStrokes().length).toBe(1);          // the mark still pending (the green bar above is not baked)
        E._render(); await quiet(); await flush();
        E.setTool("select");
        E.pointerDown(230, 300); E.pointerUp();            // the red cut-out inside the ring
        expect(E.selection).toBeTruthy();
        await quiet(); await flush();
        E.pointerDown(230, 300);
        const seen = [];
        for (let dx = 5; dx <= 30; dx += 5) {
            E.pointerMove(230 - dx, 300);
            await flush();
            if (dx >= 20) seen.push(at(E, 200, 300));      // the cut-out's edge is past the band's middle from here
        }
        expect(seen).toEqual([RED, RED, RED]);             // red before: the white mark over the baked cut-out
        expect(at(E, 300, 200)).toEqual(WHITE);            // the unbaked green under the band: still hidden
        expect(at(E, 300, 300)).toEqual(GREEN);            // outside the band the red passes UNDER the green, as z says
        E.pointerUp();
        await quiet(); await flush();
        expect(at(E, 200, 300)).toEqual(RED);              // dropped: the plates show it over the ring too
        expect(at(E, 300, 200)).toEqual(WHITE);
    });
});

describe("the drag plane with a pending mark", () => {
    test("K5 a pending mark adds no layer: objects under it and one drawn after it drag as one run", async () => {
        const { E } = await scene();
        E._flushErasesFor(R_ID(E));                        // the red bar cut out of order: the mark stays above the green
        const X = box(E, 380, 280, 60, 60, RED);           // drawn after the erase: above the mark
        E._render(); await flush();
        const ids = E.doc.list("0").filter((o) => !o.erase && !/30,30,200/.test(o.color)).map((o) => o.id);   // the red pieces, the green, X
        E.setTool("select");
        E._setSelection(ids, []);
        E._render();
        const pl = E.renderer._plane;
        for (let k = 0; k < 40 && !(pl.layers.length && pl.checkReady(E.plates)); k++) { await quiet(); await flush(); }
        expect(E._zOf(E._eraseStrokes()[0].obj)).toBeLessThan(E._zOf(X));   // the mark sits between them in z
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel"]);   // red when the mark counts as a run between them
    });
});

describe("what counts as baked", () => {
    afterEach(() => setEraseTransport(null));
    test("K3 a target whose cut is still in the worker stays masked: no transient whole object over the ring", async () => {
        const { E } = await scene();
        setEraseTransport((msg) => new Promise(() => {}));  // the cut never lands
        E._scheduleBake = () => {};
        E._bakeTick();                                     // the green bar, the top target, goes to the worker
        expect(E._cutInflight).toBeTruthy();
        expect(E._doneSet(E._eraseStrokes()[0].obj.id).has(E._cutInflight.id)).toBe(true);   // done means handled OR in the worker
        E.plates.dropAll(false);                            // every plate re-rastered now
        E._render(); await flush();
        expect(at(E, 300, 200)).toEqual(WHITE);            // red with `done` read as baked: the whole green over the ring
    });

    test("K4 with the whole bake done in order, the picture is the one a fresh raster of the result makes", async () => {
        const { E } = await scene();
        const Erec = E._eraseStrokes()[0];
        let t;
        while ((t = E._nextEraseTarget(Erec))) { E._bakeOne(Erec, t, { sync: true }); E._lowerMark(Erec, t); }
        E._render(); await flush();
        const mid = [at(E, 200, 300), at(E, 300, 200), at(E, 300, 300), at(E, 120, 300)];
        // mid-bake, the plates kept through the neutral cuts are the ones a fresh raster makes, byte for byte
        const pixels = () => { const m = new Map(); for (const [k, e] of E.plates.cache) { const p = e.pixels || (e.bitmap && e.bitmap.pixels); if (p && typeof e.q === "number") m.set(k, p); } return m; };
        const kept = pixels();
        E.plates.dropAll(false); E._render(); await flush();
        let compared = 0, differ = 0;
        for (const [k, a] of pixels()) { const b = kept.get(k); if (!b) continue; compared++; if (a.some((v, i) => v !== b[i])) differ++; }
        expect(compared).toBeGreaterThan(0);
        expect(differ).toBe(0);
        E._bakeTickInner();                                 // spent
        E._render(); await flush();
        expect([at(E, 200, 300), at(E, 300, 200), at(E, 300, 300), at(E, 120, 300)]).toEqual(mid);
        expect(mid).toEqual([WHITE, WHITE, GREEN, BLUE]);
    });
});

/** The red bar's id: the bottom object the ring crosses that is not the blue. */
function R_ID(E) {
    const list = E.doc.list("0").filter((o) => !o.erase && /200,30,30/.test(o.color));
    return list[0].id;
}
