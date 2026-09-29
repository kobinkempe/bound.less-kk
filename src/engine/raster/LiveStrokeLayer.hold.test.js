/**
 * LiveStrokeLayer.hold.test.js — F120 (REVIEWER-4 D-5) on the composed layer (A3 §7.2): the live path is held at pen-up
 * (`LiveStrokeLayer.hold`) until the plates under it are fresh. Pending its shape it stays, with no limit (PLAN §5.4
 * Q2); once the shape has landed, one group commit publishes the drawn cells under its box and `release`s the path in
 * the same task (A3 §3.6). F131: a held path stays put when the next pen-down re-chooses the origin, and a crossing
 * carries it into the new frame (LH-5, LH-6: never neither). F135: a stroke drawn right after another is released when
 * its plates land, not at the hold's limit (LH-7). `raster.liveHold` until B-PYRAMID-3.
 */
import KobinEngine from "../KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { rasterStats } from "./RasterRenderer";
import { LIVE_HOLD_MS } from "./PicturePyramid";

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
function stroke(E, y = 300) {
    E.setTool("pen");
    E.pointerDown(200, y);
    for (let k = 1; k <= 30; k++) E.pointerMove(200 + k * 10, y + (k % 5) * 4);
    E.pointerUp();
}

/** Steps and arrivals until the held path is down, at most 3 s (the group's plates land a turn at a time). */
async function handedOff(E) {
    for (let t0 = Date.now(); Date.now() - t0 < 3000;) {
        await flush();
        E.renderer._pyrLive(E.renderer._view);
        await flush();
        if (!E.renderer.live.held.length) return;
    }
}

describe("F120 the live path at a pen-up", () => {
    test("LH-1 the path is held until its rectangle is fresh: pending its shape it stays, then its group takes it down", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        const seen = watchHandoffs(E), hand0 = rasterStats.liveHandoffs;
        // The shape lands when the test steps it: under load the bake's own timer landed it inside the flush below.
        E._scheduleBake = () => {};
        stroke(E);
        expect(E.renderer.live.held.length).toBe(1);        // red on the old path: dropped at `endLive`, the stroke nowhere
        await flush();
        expect(E.renderer.live.held.length).toBe(1);        // pending its shape: on no plate yet (PLAN §1.5)
        while (E._stepShapeBakes(1000));                    // the shape lands; its group asks for the cells under it
        await handedOff(E);
        expect(E.renderer.live.held.length).toBe(0);
        expect(rasterStats.liveHandoffs).toBe(hand0 + 1);
        expect(seen).toEqual([0]);                          // at the handoff every drawn cell under its box was exact
    });

    test("LH-4 a stroke pending its shape keeps its path past every limit, and hands it to its plates", async () => {
        const E = mkEngine();
        fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
        E._render(); await flush();
        const hand0 = rasterStats.liveHandoffs;
        stroke(E);
        const h = E.renderer.live.held[0];
        h.at -= 60000; h.until = 0;                         // a minute past pen-up, the shape still pending
        E.renderer._pyrLive(E.renderer._view);
        expect(E.renderer.live.held.length).toBe(1);        // red on the old path: timed out at 15 s, the stroke nowhere
        while (E._stepShapeBakes(1000));                    // the shape lands; its plates are asked for
        await handedOff(E);
        expect(E.renderer.live.held.length).toBe(0);
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
        const R = E.renderer, h = R.live.held[0];
        expect(h).toBeTruthy();
        const A = E.doc.list(E.cam.frame).find((o) => o.type === "stroke" || o.type === "shape");
        const at = () => {
            const tail = h.root.children[0], v = tail.vertices[0], w = R.svg.world;
            return [w.translation.x + w.scale * (h.root.translation.x + tail.translation.x + v.x), w.translation.y + w.scale * (h.root.translation.y + tail.translation.y + v.y)];
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

// PLAN §1.5's never-neither across a crossing (the B-PYRAMID review): a zoom that crossed a frame between pen-up and
// the shape's landing took the held path down, and the stroke was on no plate until its shape landed in the new frame.
describe("a crossing between pen-up and the landing", () => {
    /** Where the held path's first anchor is drawn, in CSS px, through the root's scale and the world's transform. */
    const at = (R, h) => {
        const tail = h.root.children[0], v = tail.vertices[0], w = R.svg.world, s = typeof h.root.scale === "number" ? h.root.scale : 1;
        const lx = h.root.translation.x + s * (tail.translation.x + v.x), ly = h.root.translation.y + s * (tail.translation.y + v.y);
        return [w.translation.x + w.scale * lx, w.translation.y + w.scale * ly];
    };
    // One zoom step each way, about the stroke's first point: past EXIT into the parent, past ENTER into a child.
    for (const [name, cross] of [["LH-5 out", (E) => E.zoomFactorAt(200, 300, 1 / 64)], ["LH-6 in", (E) => E.zoomFactorAt(200, 300, 512)]]) {
        test(`${name}: the held path is carried into the new frame where its stroke is drawn, and its group releases it`, async () => {
            const E = mkEngine(), R = E.renderer;
            fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
            E._render(); await flush();
            E._scheduleBake = () => {};                         // the shape lands when the test steps it
            const seen = watchHandoffs(E), hand0 = rasterStats.liveHandoffs;
            stroke(E);
            const h = R.live.held[0], F0 = E.cam.frame, p = E.doc.getById(h.id).obj.pts[0];
            cross(E);
            expect(E.cam.frame).not.toBe(F0);
            await flush();
            expect(R.live.held.includes(h)).toBe(true);         // red before: taken down at the crossing, the stroke nowhere
            expect(String(h.frameId)).toBe(String(E.cam.frame));
            const [x, y] = at(R, h), [tx, ty] = E.cam.levelPointToScreen(F0, p[0], p[1]);
            expect(Math.abs(x - tx)).toBeLessThan(0.5);          // where its stroke is drawn in the new frame (F131's rule)
            expect(Math.abs(y - ty)).toBeLessThan(0.5);
            while (E._stepShapeBakes(1000));                    // the shape lands; its group asks the new frame's cells
            await handedOff(E);
            expect(R.live.held.length).toBe(0);
            expect(rasterStats.liveHandoffs).toBe(hand0 + 1);   // released by its group commit, not taken down
            expect(seen).toEqual([0]);                          // at the handoff every drawn cell under its box was exact
        });
    }
});

// F135 (B-PYRAMID-3, jsdom): the second of two strokes drawn back to back kept its path 3,070–3,075 ms — its group's
// strips were dropped at dispatch as "exact" (their cells in flight for a job packed before its G) and nothing re-asked
// them, so the group waited LIVE_HOLD_MS and committed what it had.
test("LH-7 two strokes back to back: each path is released when its plates land, well under LIVE_HOLD_MS", async () => {
    const E = mkEngine(), R = E.renderer;
    R.pyramid.cfg.restInline = "never";                             // the flag's setting: the rest set from the workers
    fill(E, 100, 200, "rgb(200,30,30)"); fill(E, 300, 200, "rgb(30,30,200)");
    E._render(); await flush();
    const seen = watchHandoffs(E), hand0 = rasterStats.liveHandoffs, timed0 = R.pyramid.s.groupsTimedOut;
    rasterStats.liveHoldMsMax = 0;
    stroke(E, 300);
    stroke(E, 320);
    for (const t0 = Date.now(); R.live.held.length && Date.now() - t0 < LIVE_HOLD_MS + 2000;) {
        await flush();
        R._pyrLive(R._view);
        await new Promise((r) => setTimeout(r, 5));
    }
    expect(R.live.held.length).toBe(0);
    expect([R.pyramid.s.groupsTimedOut - timed0, rasterStats.liveHandoffs - hand0]).toEqual([0, 2]);
    expect(rasterStats.liveHoldMsMax).toBeLessThan(LIVE_HOLD_MS / 3);
    expect(seen).toEqual([0, 0]);                                  // at each handoff every drawn cell under its box was exact
}, 20000);

/** The drawn cells under a held path's box that are not exact, counted at each handoff. */
function watchHandoffs(E) {
    const R = E.renderer, seen = [], down = R._pyrTakeDown.bind(R);
    R._pyrTakeDown = (h, handoff) => {
        if (handoff) { const u = R.pyramid._under(h.box); seen.push(u.stale.length + u.missing.length); }
        return down(h, handoff);
    };
    return seen;
}
