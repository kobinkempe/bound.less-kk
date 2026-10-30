import { useEngines, mkEngine, drawStroke } from "../__testkit__/harness";
import { setRasterTransport, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";

useEngines();
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function idle() { for (let i = 0; i < 20; i++) await tick(); }

beforeEach(() => {
    resetRasterWorkerClient();
    setRasterTransport(async (msg) => (await runJob(msg)).msg);
});
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test.each([[1, 0, 0], [1, -250, -100], [10.556, 0, 0]])("F171 load at zoom %s, pan %s,%s completes without a camera step", async (zoom, dx, dy) => {
    const source = mkEngine();
    drawStroke(source, [[300, 300], [400, 200], [500, 300]], 20);
    source.cam.zoomFactorAt(400, 300, zoom);
    source.cam.panBy(dx, dy);
    const drawing = source.serializeDrawing();
    const E = mkEngine(800, 600, { raster: true, frames: "raf" });
    await idle();
    E.loadDrawing(drawing, { render: false });
    await tick();
    E._render();
    E.sweepFrames();
    await idle();
    // Extra camera steps would hide the load failure.
    const sharp = () => E.renderer.pyramid.lastPlan.cells.every((c) => c.draws.every((d) => d.cls === "sharp"));
    expect(E.renderer.queue.motion.moving).toBe(false);
    expect(E.renderer.queue.motion.vel).toEqual({ px: [0, 0], zoom: 0 });
    expect(E.renderer.queue.report().reaimed).toBe(0);
    expect(sharp()).toBe(true);
    E.resize(801, 600);
    await idle();
    expect(sharp()).toBe(true);
});
