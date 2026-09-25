/**
 * F120 (REVIEWER-4 D-5): the live path is held at pen-up whatever the view's mode. A light drawing
 * is on the sync path; when the pen-up's own render leaves it (a slow last sync frame), a path
 * dropped at `endLive` left the new stroke on screen nowhere until its plates landed. A pen-up that
 * stays sync releases the path in the same frame, the sync raster having drawn the stroke.
 */
import KobinEngine from "../KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { rasterStats } from "./RasterRenderer";

const engines = [];
function mkEngine() {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true, scenes: false });
    E.renderer.layer.syncBudget = 5000;                // the shipped budget: a light drawing is sync
    engines.push({ E, host });
    return E;
}
afterEach(() => { while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); } });
async function flush(rounds = 200) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}
const fill = (E, x, y, c) => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: c, opacity: 1,
    polys: [[[x, y], [x + 120, y], [x + 120, y + 120], [x, y + 120]]] }, "0");
function stroke(E) {
    E.setTool("pen");
    E.pointerDown(200, 300);
    for (let k = 1; k <= 30; k++) E.pointerMove(200 + k * 10, 300 + (k % 5) * 4);
    E.pointerUp();
}

describe("F120 the live path at a pen-up that leaves the sync path", () => {
    test("LH-1 a slow last sync frame: the pen-up frame is plates, and the path is held until its plates land", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        expect(E.renderer.layer.view().mode).toBe("sync");
        E.renderer.layer.noteSyncCost(20);
        const hand0 = rasterStats.liveHandoffs;
        stroke(E);
        expect(E.renderer.layer.view().mode).toBe("plates");
        expect(E.renderer._liveHeld.length).toBe(1);        // red before: dropped, the stroke nowhere
        await flush();
        E.renderer._releaseHeldLive(E.renderer._view, null);
        expect(E.renderer._liveHeld.length).toBe(0);
        expect(rasterStats.liveHandoffs).toBe(hand0 + 1);
    });

    test("LH-2 a pen-up that stays sync holds nothing past its own frame", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        stroke(E);
        expect(E.renderer.layer.view().mode).toBe("sync");
        expect(E.renderer._liveHeld.length).toBe(0);
    });
});

// F131 (FREEZE, report 2026-09-24T21-08-16): a held path is drawn relative to the overlay origin of its
// own stroke; the next pen-down after a pan or zoom re-chose the origin and the held stroke jumped by
// inScale × the origin's change, until its plates landed (slow ones kept it up to 15 s).
test("LH-3 the next pen-down after a pan and a zoom leaves the held stroke where it is drawn", async () => {
    const { setRasterTransport } = require("./rasterWorkerClient");
    const E = mkEngine();
    E.renderer.layer.syncBudget = 0; E.renderer.layer._sync = false;   // the plates path: the stroke is held
    fill(E, 100, 200, "rgb(200,30,30)");
    E._render(); await flush();
    setRasterTransport(() => new Promise(() => {}));                  // its plates never land
    try {
        E.setTool("pen"); E.setOpacity(0.5);
        E.pointerDown(200, 300);
        for (let k = 1; k <= 20; k++) E.pointerMove(200 + k * 10, 300 + (k % 5) * 4);
        E.pointerUp();
        const R = E.renderer, h = R._liveHeld[0];
        expect(h).toBeTruthy();
        const A = E.doc.list(E.cam.frame).find((o) => o.type === "stroke" || o.type === "shape");
        const at = () => {
            const tail = h.path.children[0], v = tail.vertices[0], w = R.world;
            return [w.translation.x + w.scale * (h.path.translation.x + tail.translation.x + v.x), w.translation.y + w.scale * (h.path.translation.y + tail.translation.y + v.y)];
        };
        const truth = () => E.cam.levelPointToScreen(E.cam.frame, A.pts ? A.pts[0][0] : 0, A.pts ? A.pts[0][1] : 0);
        E.cam.set({ ...E.cam.state(), inScale: E.cam.inScale * 0.5, inPanX: E.cam.inPanX + 300 });
        E._render();
        E.pointerDown(600, 450);                                        // the next stroke: a new overlay origin
        const [x, y] = at(), [tx, ty] = truth();
        expect(Math.abs(x - tx)).toBeLessThan(0.5);                      // red before: off by inScale × Δorigin
        expect(Math.abs(y - ty)).toBeLessThan(0.5);
        E.pointerUp();
    } finally { setRasterTransport(null); }
});
