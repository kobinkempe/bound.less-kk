/**
 * A plate is packed from a list that read every cache square the plate covers (REVIEWER-4 P-1:
 * the camera's list read the squares touching the window, the ladder's and the prebake's their
 * window, while the plates packed from them reach up to one plate — up to 4,096 px for a rung —
 * further; the part past the listed squares was rastered as paper and cached FRESH, a white band
 * no later render re-rastered). Every fresh plate is compared with the same plate rastered from a
 * list built wide around it.
 */
import KobinEngine from "../KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { packJob } from "./rasterPack";
import { renderPlate, TW, TH } from "./rasterCore";
import { COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./rasterJob";
import { PLATE_PX, plateKey } from "./plate";
import { W } from "../frameLattice";

jest.setTimeout(120000);

const engines = [];
function mkEngine(w = 800, h = 600) {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true, scenes: false });
    E.renderer.layer.syncBudget = 0;
    E.renderer.layer._sync = false;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fill = (E, x, y, w, h, color, frame = "0") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, frame);

/** The plate rastered from a list built four plates wide around it. */
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
const diffPx = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 8 || Math.abs(a[k + 1] - b[k + 1]) > 8 || Math.abs(a[k + 2] - b[k + 2]) > 8) n++; return n; };
/** Every fresh numeric-quantum plate in the store that differs from its reference by 64 px or more. */
function badPlates(E) {
    const out = [];
    for (const e of E.plates.cache.values()) {
        if (e.dead || typeof e.q !== "number" || !E.plates.isExact(e)) continue;
        const px = e.pixels || (e.bitmap && e.bitmap.pixels) || null;
        const d = diffPx(px || WHITE, refPixels(E, e.frameId, e.q, e.Zq, e.i, e.j));
        if (d >= 64) out.push(e.key + ":" + d);
    }
    return out;
}

describe("P-1 — a plate's list covers the plate", () => {
    test("LCV-1 at a cache square's edge, the view's fresh plates hold the ink past the window, before and after a pan", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");      // the child sees it as up content, clipped per square
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.04, edgeX = W / 2 - 100;                         // the window's right edge 4 px short of square 1
        const left = edgeX - 800 / s, top = -300 / s;
        E.cam.set({ frame: child, inScale: s, inPanX: -left * s, inPanY: -top * s });
        E._render(); await flush();
        expect(badPlates(E)).toEqual([]);                             // red: two plates, 62,976 px of paper
        E.panBy(-10, 0); await flush();
        expect(badPlates(E)).toEqual([]);
    });

    test("LCV-2 a zoom-out ladder's rungs hold the ink their plates reach", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.3, cx = 50000;
        E.cam.set({ frame: child, inScale: s, inPanX: 400 - cx * s, inPanY: 300 });
        E._render(); await flush();
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 60 && E._ladderBusy; k++) { await sleep(40); await flush(); }
        await flush();
        expect(badPlates(E)).toEqual([]);                             // red: the q-27 rung, 212,480 px
    });

    test("LCV-3 a drag plane's level coarser than the list's margin holds the ink its BELOW plates reach (P-2)", async () => {
        const E = mkEngine(2000, 1400);
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.05, left = W / 2 - 500 - 2000 / s, top = -700 / s;   // the window's right edge 500 units short of square 1
        E.cam.set({ frame: child, inScale: s, inPanX: -left * s, inPanY: -top * s });
        const sel = fill(E, left + 100 / s, top + 100 / s, 1800 / s, 1200 / s, "rgb(200,60,40)", child);
        E._render(); await flush();
        E.renderer._planeCap = 20;
        // The far list is built at idle, never inside an aim (the select's and the drop's frames: 0.2–0.6 s in Chrome).
        const R = E.renderer, aim = R._aimPlane.bind(R), hook = R.listForPlane;
        let aiming = false, inAim = 0, built = 0;
        R._aimPlane = (v) => { aiming = true; try { return aim(v); } finally { aiming = false; } };
        R.listForPlane = (...args) => { if (aiming) inAim++; built++; return hook(...args); };
        E.setTool("select"); E._setSelection([sel.id], []); E._render();
        const pl = E.renderer._plane;
        for (let t0 = Date.now(); !(pl.layers.length && pl.checkReady(E.plates)) && Date.now() - t0 < 5000;) { await sleep(20); await flush(); }
        E.pointerDown(1000, 700); E.pointerMove(1010, 705); await flush();
        expect(pl.quick && pl.quick.k).toBeGreaterThan(2);           // the case: a quick level past the camera list's margin
        for (let t0 = Date.now(); (pl.quick.listPending || !pl._whole(pl.quick, E.plates)) && Date.now() - t0 < 5000;) { await sleep(20); await flush(); }
        expect(pl.quick.list).toBeTruthy();                           // built at idle, not in the aim
        expect(built).toBeGreaterThan(0);
        expect(inAim).toBe(0);
        expect(pl._whole(pl.quick, E.plates)).toBe(true);
        const bad = [];
        for (const lvl of [pl.quick, pl.main]) {
            const L = lvl.layers[0], u = PLATE_PX / lvl.pZq;
            for (const [i, j] of L.cells) {
                const e = E.plates.get(plateKey(pl.frameId, L.tag, i, j));
                const px = e && (e.pixels || (e.bitmap && e.bitmap.pixels));
                if (!px) continue;
                const list = E.listFor(pl.frameId, { left: (i - 2) * u, top: (j - 2) * u, right: (i + 3) * u, bottom: (j + 3) * u });
                const job = packJob(list, { plates: Int32Array.of(i, j), q: L.tag, Zq: lvl.pZq, dpr: E.renderer.layer.dpr, cfg: E.cfg,
                    paper: [255, 255, 255], omit: L.omit, live: E.renderer._liveModel, markDone: E.renderer.markDone });
                const ref = new Uint8ClampedArray(TW * TH * 4);
                renderPlate(job, 0, ref, new Uint32Array(COUNTS_PER_PLATE), new Float64Array(TIMINGS_PER_PLATE));
                const d = diffPx(px, ref);
                if (d >= 64) bad.push("k" + lvl.k + " " + i + "," + j + ":" + d);
            }
        }
        E.pointerUp();
        expect(bad).toEqual([]);                                       // red: two quick-level plates, 76,800 px of paper each
    });
});
