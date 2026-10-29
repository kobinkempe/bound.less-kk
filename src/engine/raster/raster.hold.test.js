/**
 * raster.hold.test.js — waiting instead of paper (Kobin 2026-10-29: "if there isn't a plate to show, it just lags until it
 * is ready instead of flashing the paper"): a moved view whose plan leaves paper on screen keeps the last picture up until
 * its plates land, at most `holdMs`, then paints; `holdMs` 0 paints the paper at once; a still camera never waits.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = () => { const r = E.renderer.queue.report(); return !r.queued.some((n) => n) && !r.inFlight.some((n) => n); };
async function settle() { for (let k = 0; k < 6; k++) { await land(); await sleep(30); E.renderer.syncCameraOnly(); } }
/** The view's plates landed, within the stroke's quiet: the prefetch has not made the coarser levels yet. */
async function land() { for (let n = 0; n < 80 && !(n > 0 && idle()); n++) await sleep(0); }

function engine(holdMs) {
    resetRasterWorkerClient();
    setRasterWorkerCount(1);
    host = document.createElement("div");
    document.body.appendChild(host);
    E = new KobinEngine(host, { width: 400, height: 300, raster: true, levers: { holdMs } });
    E.renderer.pyramid._ctx = stubContext();                    // jsdom has none: a picture is "painted" through this one
    drawStroke(E, [[60, 60], [200, 160], [340, 90]], 12);
    return E.renderer.pyramid;
}
function stubContext() {
    const ctx = { fillStyle: "", imageSmoothingEnabled: true };
    for (const k of ["setTransform", "fillRect", "drawImage", "clearRect", "save", "restore", "beginPath", "rect", "clip"]) ctx[k] = () => {};
    return ctx;
}
const affine = (v) => ({ frame: v.frameId, k: v.k, tx: v.tx, ty: v.ty });
const paperOf = (P) => P.cells.some((c) => c.draws.some((d) => d.cls === "paper"));

test("H-1 a zoom-out's uncovered edge keeps the last picture up until its plates land, then paints them", async () => {
    const pyr = engine(1000);
    E._render(); await land();
    const before = { ...pyr._painted };
    E.zoomAt(200, 150, 1500);                                   // out: the edge the old plates do not cover is paper
    const P = pyr.lastPlan;
    expect(paperOf(P)).toBe(true);
    expect(pyr._painted).toEqual(before);                       // the canvas still shows the last picture
    expect(pyr.s.holds).toBe(1);
    await settle();
    expect(pyr._painted).toEqual(affine(pyr._v));               // the plates landed: the new view painted
    expect(paperOf(pyr.lastPlan)).toBe(false);
    expect(pyr.s.holdMs).toBeGreaterThan(0);
    expect(pyr._holdT0).toBeNull();
});

test("H-2 a hold ends at holdMs whatever lands; holdMs 0 paints paper at once; a still camera never waits", async () => {
    let pyr = engine(200);
    E._render(); await land();
    setRasterTransport(() => new Promise(() => {}));            // from here nothing lands
    let now = 5000;
    pyr._now = () => now;
    E.zoomAt(200, 150, 1500);
    expect(pyr._holdT0).toBe(5000);
    now += 150; pyr.compose();
    expect(pyr._holdT0).toBe(5000);                             // still waiting
    now += 60; pyr.compose();                                   // past 200 ms: the paper is painted
    expect(pyr._holdT0).toBeNull();
    expect(pyr._painted).toEqual(affine(pyr._v));
    expect(pyr.s.holdMs).toBe(210);
    pyr.compose();                                              // the camera has not moved since: no new hold
    expect(pyr.s.holds).toBe(1);
    E.destroy(); host.remove(); setRasterTransport(null);

    pyr = engine(0);
    E._render(); await land();
    E.zoomAt(200, 150, 1500);
    expect(paperOf(pyr.lastPlan)).toBe(true);
    expect(pyr._painted).toEqual(affine(pyr._v));               // painted at once, paper and all
    expect(pyr.s.holds).toBe(0);
});
