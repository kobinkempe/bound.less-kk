/**
 * F120 (REVIEWER-4 D-5): the live path is held at pen-up until the plates under it are fresh. On the picture
 * pyramid (A3 §3.6, B-PYRAMID-2b's port): pending its shape it stays, with no limit (PLAN §5.4 Q2); once the shape
 * has landed, one group commit publishes the drawn cells under its box and takes the path down in the same task.
 * The sync path's own case (LH-2, a pen-up that stayed sync) went with the sync path (A3 §2.5).
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

/** Steps and arrivals until the held path is down, at most 3 s (the group's plates land a turn at a time). */
async function handedOff(E) {
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
        await flush();
        E.renderer._pyrLive(E.renderer._view);
        await flush();
        if (!E.renderer._liveHeld.length) return;
    }
}

describe("F120 the live path at a pen-up", () => {
    /** The drawn cells under a held path's box that are not exact, counted at each handoff. */
    function watchHandoffs(E) {
        const R = E.renderer, seen = [], down = R._pyrTakeDown.bind(R);
        R._pyrTakeDown = (h, handoff) => {
            if (handoff) { const u = R.pyramid._under(h.box); seen.push(u.stale.length + u.missing.length); }
            return down(h, handoff);
        };
        return seen;
    }

    test("LH-1 the path is held until its rectangle is fresh: pending its shape it stays, then its group takes it down", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        const seen = watchHandoffs(E), hand0 = rasterStats.liveHandoffs;
        stroke(E);
        expect(E.renderer._liveHeld.length).toBe(1);        // red on the old path: dropped at `endLive`, the stroke nowhere
        await flush();
        expect(E.renderer._liveHeld.length).toBe(1);        // pending its shape: on no plate yet (PLAN §1.5)
        while (E._stepShapeBakes(1000));                    // the shape lands; its group asks for the cells under it
        await handedOff(E);
        expect(E.renderer._liveHeld.length).toBe(0);
        expect(rasterStats.liveHandoffs).toBe(hand0 + 1);
        expect(seen).toEqual([0]);                          // at the handoff every drawn cell under its box was exact
    });

    test("LH-4 a stroke pending its shape keeps its path past every limit, and hands it to its plates", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        const hand0 = rasterStats.liveHandoffs;
        stroke(E);
        const h = E.renderer._liveHeld[0];
        h.at -= 60000; h.until = 0;                         // a minute past pen-up, the shape still pending
        E.renderer._pyrLive(E.renderer._view);
        expect(E.renderer._liveHeld.length).toBe(1);        // red on the old path: timed out at 15 s, the stroke nowhere
        while (E._stepShapeBakes(1000));                    // the shape lands; its plates are asked for
        await handedOff(E);
        expect(E.renderer._liveHeld.length).toBe(0);
        expect(rasterStats.liveHandoffs).toBe(hand0 + 1);
    });
});

// F131 (FREEZE, report 2026-09-24T21-08-16): a held path is drawn relative to the overlay origin of its
// own stroke; the next pen-down after a pan or zoom re-chose the origin and the held stroke jumped by
// inScale × the origin's change, until its plates landed (slow ones kept it up to 15 s).
test("LH-3 the next pen-down after a pan and a zoom leaves the held stroke where it is drawn", async () => {
    const { setRasterTransport } = require("./rasterWorkerClient");
    const E = mkEngine();
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
