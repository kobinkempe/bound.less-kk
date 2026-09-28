/**
 * stage.cover.test.js — every plate job holds every item overlapping the plate (A2 §2.12, the
 * TEST-MAP's replacement for `raster.listCover.test.js`). The camera's plates are packed from the
 * Stage's table only where `covers` says every tile under them is read; the ladder's, the crossing
 * prebake's and a drag plane's far levels from a snapshot of their plates' rectangle. Two checks: at
 * the pack, the list it packs from against the items `listFor` finds over the plate (the brute-force read);
 * after it, every exact plate against the same plate rastered from a list read wide around it
 * (REVIEWER-4 P-1: past the read squares a plate was rastered as paper and cached fresh).
 */
import KobinEngine from "./KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { rasterStats } from "./raster/RasterRenderer";
import { packJob } from "./raster/rasterPack";
import { renderPlate, TW, TH } from "./raster/rasterCore";
import { COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./raster/rasterJob";
import { PLATE_PX, plateKey } from "./raster/plate";
import { drawnBox } from "./placementModel";
import { W } from "./frameLattice";

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

/** A plate's rectangle in its frame's units. */
const plateRect = (Zq, i, j) => { const u = PLATE_PX / Zq; return { left: i * u, top: j * u, right: (i + 1) * u, bottom: (j + 1) * u }; };
/**
 * The pack's own check, wrapped: every item `listFor` reads over a plate whose drawn box meets the plate's
 * inside (a device pixel in) is in the list the job was packed from, at the same offset. Returns the
 * misses, "plate:id". The pack's cull is the pixel check's (`badPlates`).
 */
function watchJobs(E) {
    const R = E.renderer, pack = R._packNow.bind(R), out = { jobs: 0, plates: 0, misses: [] };
    R._packNow = (req, strip, jobId, pool) => {
        const src = R._packList(req);
        const job = pack(req, strip, jobId, pool);
        if (!job || req.only || req.omit || typeof req.q !== "number") return job;
        const ids = new Map();
        for (const it of src) ids.set(it.piece || it, it.res || null);
        out.jobs++;
        for (let p = 0; p * 2 < strip.length; p++) {
            const r = plateRect(req.Zq, strip[p * 2], strip[p * 2 + 1]), e = 1 / req.Zq;
            const inner = { left: r.left + e, top: r.top + e, right: r.right - e, bottom: r.bottom - e };
            out.plates++;
            for (const o of E.listFor(req.frameId, r)) {
                if (E.stage._pending.has(o.id)) continue;                        // pending its shape: on no plate (PLAN §1.5)
                const b = drawnBox(o), dx = o.res ? o.res[0] : 0, dy = o.res ? o.res[1] : 0;
                if (b.right + dx < inner.left || b.left + dx > inner.right || b.bottom + dy < inner.top || b.top + dy > inner.bottom) continue;
                const r2 = ids.get(o);
                const same = r2 !== undefined && (r2 ? r2[0] : 0) === dx && (r2 ? r2[1] : 0) === dy;
                if (!same) out.misses.push(req.q + "|" + strip[p * 2] + "," + strip[p * 2 + 1] + ":" + o.id);
            }
        }
        return job;
    };
    return out;
}

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
/** The view's cells with no exact plate: after a camera step and its arrivals, none (the table followed the window). */
function holes(E) {
    const v = E.renderer.layer.view(), out = [];
    for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) {
        const e = E.plates.get(plateKey(v.frameId, v.q, i, j));
        if (!e || e.dead || !E.plates.isExact(e)) out.push(i + "," + j);
    }
    return out;
}
/** Every exact numeric-quantum plate in the store that differs from its reference by 64 px or more. */
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

describe("every plate job holds every item overlapping the plate", () => {
    test("C1 the camera's jobs, over many objects, through pans across cache squares and a zoom", async () => {
        const E = mkEngine();
        for (let k = 0; k < 40; k++) fill(E, -3000 + (k % 8) * 760, -1600 + Math.floor(k / 8) * 640, 420, 300, "rgb(" + (30 + 5 * k) + ",90,160)", "0");
        const seen = watchJobs(E);
        E._render(); await flush();
        for (let k = 0; k < 12; k++) { E.panBy(k < 6 ? -260 : 260, k % 3 === 0 ? 180 : -60); await flush(); expect(holes(E)).toEqual([]); }
        for (let k = 0; k < 6; k++) { E.zoomAt(400, 300, 300); await flush(); }
        expect(seen.jobs).toBeGreaterThan(5);
        expect(seen.plates).toBeGreaterThan(20);
        expect(seen.misses).toEqual([]);
        expect(badPlates(E)).toEqual([]);
    });

    test("C2 at a cache square's edge, the view's exact plates hold the ink past the window, before and after a pan", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");      // the child sees it as up content, clipped per square
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.04, edgeX = W / 2 - 100;                         // the window's right edge 4 px short of square 1
        const left = edgeX - 800 / s, top = -300 / s;
        const seen = watchJobs(E);
        E.cam.set({ frame: child, inScale: s, inPanX: -left * s, inPanY: -top * s });
        E._render(); await flush();
        expect(badPlates(E)).toEqual([]);                             // red with the list's window: 62,976 px of paper
        E.panBy(-10, 0); await flush();
        expect(holes(E)).toEqual([]);
        expect(badPlates(E)).toEqual([]);
        // Camera steps, no render and no cell change, until the view reaches square -1: its tiles are read by the step.
        const frame0 = E.cam.frame, rebuilds0 = E.stage.stats.rebuilds;
        for (let k = 0; k < 6; k++) { E.panBy(750, 0); await flush(); expect(holes(E)).toEqual([]); }   // red at the sixth when the step does not sync
        expect(E.cam.frame).toBe(frame0);
        expect(E.stage.stats.rebuilds).toBe(rebuilds0);               // a window change is not a rebuild (A2 §2.12)
        expect(badPlates(E)).toEqual([]);
        expect(seen.misses).toEqual([]);
    });

    test("C5 a camera plate the table does not cover waits: refused at dispatch, packed once the table reads it (F119)", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.04, edgeX = W / 2 - 100;                         // two cache squares across the view
        E.cam.set({ frame: child, inScale: s, inPanX: -(edgeX - 800 / s) * s, inPanY: 300 });
        E._render(); await flush();
        const v = E.renderer.layer.view();
        const far = plateRect(v.Zq, v.i1, v.j0);                      // the right edge's plate, in the second square
        E.plates.dropAll(false);
        const win = E._listWin();
        E.stage.sync(E.cam.frame, { ...win, right: win.left + 1 }, Infinity);   // the table reads the left square alone
        expect(E.stage.covers(v.frameId, far)).toBe(false);
        const refused0 = rasterStats.refusedAtDispatch, cover0 = rasterStats.refusedCover, plates0 = rasterStats.refusedCoverPlates;
        E.renderer.syncCameraOnly(); await flush();                  // posts the view with the table short
        expect(rasterStats.refusedAtDispatch).toBeGreaterThan(refused0);
        expect(rasterStats.refusedCover).toBeGreaterThan(cover0);     // counted by reason (PLAN §5.4 Q3)
        expect(rasterStats.refusedCoverPlates).toBeGreaterThan(plates0);
        expect(E.plates.get(plateKey(v.frameId, v.q, v.i1, v.j0))).toBeUndefined();   // red without the check: paper cached exact
        E._render(); await flush();                                   // the table reads the window: packed
        expect(holes(E)).toEqual([]);
        expect(badPlates(E)).toEqual([]);
    });

    test("C3 a zoom-out ladder's rungs, read as snapshots, hold the ink their plates reach", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.3, cx = 50000;
        E.cam.set({ frame: child, inScale: s, inPanX: 400 - cx * s, inPanY: 300 });
        E._render(); await flush();
        const snaps = jest.spyOn(E.stage, "snapshot");
        const seen = watchJobs(E);
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 60 && E._ladderBusy; k++) { await sleep(40); await flush(); }
        await flush();
        expect(snaps).toHaveBeenCalled();
        expect(seen.misses).toEqual([]);
        expect(badPlates(E)).toEqual([]);                             // red with the rung's window: the q-27 rung, 212,480 px
    });

    test("C4 a drag plane's level coarser than the table's margin reads a snapshot at idle and holds the ink its BELOW plates reach (P-2)", async () => {
        const E = mkEngine(2000, 1400);
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.05, left = W / 2 - 500 - 2000 / s, top = -700 / s;   // the window's right edge 500 units short of square 1
        E.cam.set({ frame: child, inScale: s, inPanX: -left * s, inPanY: -top * s });
        const sel = fill(E, left + 100 / s, top + 100 / s, 1800 / s, 1200 / s, "rgb(200,60,40)", child);
        E._render(); await flush();
        E.renderer._planeCap = 20;
        // The far level is read at idle, never inside an aim (the select's and the drop's frames: 0.2–0.6 s in Chrome).
        const R = E.renderer, aim = R._aimPlane.bind(R), snap = E.stage.snapshot.bind(E.stage);
        let aiming = false, inAim = 0, built = 0;
        R._aimPlane = (v) => { aiming = true; try { return aim(v); } finally { aiming = false; } };
        E.stage.snapshot = (...args) => { if (aiming) inAim++; built++; return snap(...args); };
        E.setTool("select"); E._setSelection([sel.id], []); E._render();
        const pl = E.renderer._plane;
        for (let t0 = Date.now(); !(pl.layers.length && pl.checkReady(E.plates)) && Date.now() - t0 < 5000;) { await sleep(20); await flush(); }
        E.pointerDown(1000, 700); E.pointerMove(1010, 705); await flush();
        expect(pl.quick && pl.quick.k).toBeGreaterThan(2);           // the case: a quick level past the table's margin
        for (let t0 = Date.now(); (pl.quick.listPending || !pl._whole(pl.quick, E.plates)) && Date.now() - t0 < 5000;) { await sleep(20); await flush(); }
        expect(pl.quick.list).toBeTruthy();                           // read at idle, not in the aim
        expect(pl.quick.G).toBeGreaterThan(0);                        // and packed at the snapshot's G
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
