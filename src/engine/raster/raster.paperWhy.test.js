/**
 * raster.paperWhy.test.js — the paper log (OPEN-FLAGS F166): every screen-ms of paper the integral charges is charged once
 * to a cause, once to a place on the screen and once to still or moving, so a phone's report says why its paper was paper.
 */
import KobinEngine from "../KobinEngine";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { drawStroke } from "../__testkit__/harness";

let E = null, host = null;
afterEach(() => {
    if (E) E.destroy();
    if (host) host.remove();
    E = null; host = null;
    setRasterTransport(null);
    resetRasterWorkerClient();
});

test("the log charges the integral's paper by cause, by place and by motion; cells waiting for a job read as asked or in flight", () => {
    resetRasterWorkerClient();
    setRasterWorkerCount(1);
    setRasterTransport(() => new Promise(() => {}));                 // nothing lands: what is asked stays paper
    host = document.createElement("div");
    document.body.appendChild(host);
    E = new KobinEngine(host, { width: 400, height: 300, raster: true, levers: { holdMs: 0 } });   // 2 × 2 view cells: every paper draw classified; paper painted at once
    const pyr = E.renderer.pyramid;
    let now = 1000;
    pyr._now = () => now;
    pyr._lastCompose = null; pyr._lastMoveAt = null; pyr._moveT0 = null;   // the construction's compose ran on the real clock
    drawStroke(E, [[60, 60], [200, 160], [340, 90]], 12);
    E._render(); now += 40;
    E._render(); now += 40;
    E.zoomAt(200, 150, 400); now += 40;                               // a move: a gesture starts
    E._render(); now += 40;
    E._render(); now += 300;
    E._render();
    const s = pyr.s, w = s.paperWhy, sum = (p) => Object.keys(w).filter((k) => k.startsWith(p)).reduce((a, k) => a + w[k], 0);
    expect(s.paperMs).toBeGreaterThan(0);
    expect(w["c:many"] || 0).toBe(0);
    expect(sum("c:")).toBeCloseTo(s.paperMs, 6);
    expect(sum("at:")).toBeCloseTo(s.paperMs, 6);
    expect((w["m:moving"] || 0) + (w["m:still"] || 0)).toBeCloseTo(s.paperMs, 6);
    expect(w["m:moving"]).toBeGreaterThan(0);
    expect(w["m:first100"]).toBeGreaterThan(0);
    expect((w["c:asked"] || 0) + (w["c:inflight"] || 0)).toBeCloseTo(s.paperMs, 6);   // waiting for the jobs that never land
});
