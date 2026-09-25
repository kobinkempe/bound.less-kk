/**
 * A pack masks by the pending marks as they were when its list was built (REVIEWER-4 E-9, F121). A
 * cut is neutral and rebuilds no list, so a pack of the older list with the live handled set drew
 * the cut target whole and unmasked under the band, cached fresh until the mark was spent; and a
 * first pack of that list at another quantum read the mark's live z, stepped below the target.
 * Every fresh plate is compared with the same plate rastered from a list built wide around it now.
 */
import KobinEngine from "../KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import { packJob } from "./rasterPack";
import { renderPlate, TW, TH } from "./rasterCore";
import { COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./rasterJob";
import { PLATE_PX, plateKey } from "./plate";

jest.setTimeout(120000);

const engines = [];
function mkEngine(w, h) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true, scenes: false });
    E.renderer.layer.syncBudget = 0;
    E.renderer.layer._sync = false;
    engines.push({ E, host });
    return E;
}
/** One worker answering each job `ms` later: a strip queued behind it is packed when it frees. */
function slowPool(ms) {
    setRasterWorkerCount(1);
    setRasterTransport((msg) => new Promise((res, rej) => {
        setTimeout(() => { runJob(msg, { receivedAt: Date.now() }).then((o) => res(o.msg), rej); }, ms);
    }));
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });
afterEach(() => {
    setRasterTransport(null);
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});
async function flush(rounds = 400) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 5));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The plate rastered from a list built four plates wide around it, with the marks as they are now. */
function refPixels(E, frameId, q, Zq, i, j) {
    const u = PLATE_PX / Zq, pad = 4;
    const list = E.listFor(frameId, { left: (i - pad) * u, top: (j - pad) * u, right: (i + 1 + pad) * u, bottom: (j + 1 + pad) * u });
    const job = packJob(list, { plates: Int32Array.of(i, j), q, Zq, dpr: E.renderer.layer.dpr, cfg: E.cfg, paper: [255, 255, 255],
        live: E.renderer._liveModel, markDone: E.renderer.markDone });
    const rgba = new Uint8ClampedArray(TW * TH * 4);
    renderPlate(job, 0, rgba, new Uint32Array(COUNTS_PER_PLATE), new Float64Array(TIMINGS_PER_PLATE));
    return rgba;
}
const WHITE = (() => { const a = new Uint8ClampedArray(TW * TH * 4); a.fill(255); return a; })();
const white = (a, k) => a[k] > 247 && a[k + 1] > 247 && a[k + 2] > 247;
/** Every fresh plate of the published view that differs from its reference by 64 px or more, with how many of those are ink where the truth is paper. */
function badPlates(E) {
    const v = E.renderer.layer.view(), out = [];
    for (let j = v.j0; j <= v.j1; j++) {
        for (let i = v.i0; i <= v.i1; i++) {
            const key = plateKey(v.frameId, v.q, i, j), e = E.plates.get(key);
            if (!e || e.dead || e.epoch !== E.plates.epochOf(key)) continue;
            const px = e.pixels || (e.bitmap && e.bitmap.pixels) || WHITE;
            const ref = refPixels(E, v.frameId, v.q, v.Zq, i, j);
            let diff = 0, inkOverPaper = 0;
            for (let k = 0; k < ref.length; k += 4) {
                if (Math.abs(px[k] - ref[k]) <= 8 && Math.abs(px[k + 1] - ref[k + 1]) <= 8 && Math.abs(px[k + 2] - ref[k + 2]) <= 8) continue;
                diff++;
                if (white(ref, k) && !white(px, k)) inkOverPaper++;
            }
            if (diff >= 64) out.push({ key, diff, inkOverPaper });
        }
    }
    return out;
}
/** Six wide strokes stacked, each over the last; a camera render; the bake left to the test. */
async function stack(E, w, h) {
    E.setTool("pen");
    for (let k = 0; k < 6; k++) {
        E.setWidth(60); E.setColor("rgb(" + (40 * k) + ",80,160)");
        const y = 100 + k * ((h - 200) / 5);
        E.pointerDown(80, y); for (let x = 100; x <= w - 80; x += 20) E.pointerMove(x, y + (x % 80) - 40); E.pointerUp();
    }
    E.flushBakes(); E._render(); await flush(); await sleep(30); await flush();
    E._scheduleBake = () => {};                            // the bake is run by hand, one slice at a time
}
function erase(E, x, h) {
    E.setEraserSize(50); E.setTool("erasePartial");
    E.pointerDown(x, 50); for (let y = 60; y <= h - 50; y += 10) E.pointerMove(x + (y % 40) - 20, y); E.pointerUp();
    E.flushBakes();
}

describe("a pack masks by the marks its list was built with (REVIEWER-4 E-9, F121)", () => {
    test("MS-1 strips queued before a neutral bake slice and packed after it draw no cut target whole under the band", async () => {
        const E = mkEngine(1600, 1200);
        slowPool(80);
        await stack(E, 1600, 1200);
        erase(E, 800, 1200);
        E._render(); await flush(); await sleep(30); await flush();
        expect(E._eraseStrokes().length).toBe(1);
        expect(badPlates(E)).toEqual([]);
        // A stroke across the band, along the topmost target (the slice's first), while the bake runs:
        // its pen-up posts the plates under it, and with one worker busy most strips wait in the queue.
        E.setTool("pen"); E.setWidth(10); E.setColor("rgb(0,0,0)");
        E.pointerDown(200, 1100); for (let x = 220; x <= 1400; x += 20) E.pointerMove(x, 1100 + (x % 60) - 30); E.pointerUp();
        E.flushBakes();                                    // the new stroke's own shape first
        // One bake slice before those strips are packed: its cuts and steps are neutral, no list is built.
        const M = E._eraseStrokes()[0];
        for (let k = 0; k < 5 && !(E._bakeDone.get(M.obj.id) || new Set()).size; k++) { E._lastCamMove = -1e9; E._bakeTick(); }
        expect(E._eraseStrokes().map((r) => r.obj)).toEqual([M.obj]);   // still pending: the slice handled some targets, not all
        expect(E._bakeDone.get(M.obj.id).size).toBeGreaterThan(0);
        await flush(); await sleep(20); await flush();
        expect(badPlates(E)).toEqual([]);                  // red without the snapshot: 0|0|1,1 at 13,047 px, 12,850 of them ink under the band
        E._lastCamMove = -1e9; E._bakeTick();              // and on through the next slice
        await flush();
        expect(badPlates(E)).toEqual([]);
    });

    test("MS-2 a list's first pack at another quantum after the mark stepped below a cut target masks by the mark's z at the list's time", async () => {
        const E = mkEngine(800, 600);
        slowPool(10);
        await stack(E, 800, 600);
        erase(E, 400, 600);
        E._render(); await flush(); await sleep(200); await flush();
        const M = E._eraseStrokes()[0];
        expect(M).toBeTruthy();
        const z0 = E._zOf(M.obj);
        // A small zoom: the quantum holds, the picture is stretched, the settle is armed; no list is built.
        const list0 = E._lastList;
        E.zoomAt(400, 300, -60);
        expect(E._lastList).toBe(list0);
        expect(E.renderer.layer.settleComing()).toBe(true);
        // The bake runs before the settle fires: the mark steps below the targets it cut.
        E._lastCamMove = -1e9; E._bakeTick();
        expect(E._eraseStrokes().length).toBe(1);
        expect(E._zOf(M.obj)).toBeLessThan(z0);
        expect(E._lastList).toBe(list0);                   // neutral: still the list with the targets whole
        // The settle packs that list at "e" for the first time.
        await sleep(250); await flush(); await sleep(20); await flush();
        expect(E.renderer.layer.view().mode).toBe("settle");
        expect(badPlates(E)).toEqual([]);                  // red without the mark's z in the snapshot
    });
});
