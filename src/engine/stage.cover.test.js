/**
 * stage.cover.test.js — every plate job holds every item overlapping the plate (A2 §2.12, the
 * TEST-MAP's replacement for `raster.listCover.test.js`). The camera's plates are packed from the
 * Stage's table only where `covers` says every tile under them is read; the prefetch's coarser levels and a drag
 * plane's far levels from a snapshot of their plates' rectangle (the picture pyramid, A3 §4.2). Two checks: at
 * the pack, the list it packs from against the items the render list finds over the plate (`__oracles__/renderList`, the brute-force read);
 * after it, every exact plate against the same plate rastered from a list read wide around it
 * (REVIEWER-4 P-1: past the read squares a plate was rastered as paper and cached fresh).
 */
import KobinEngine from "./KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import { packJob } from "./raster/rasterPack";
import { renderPlate, TW, TH } from "./raster/rasterCore";
import { COUNTS_PER_PLATE, TIMINGS_PER_PLATE } from "./raster/rasterJob";
import { PLATE_PX } from "./raster/plate";
import { levelKey, restKey } from "./raster/level";
import { drawnBox } from "./placementModel";
import { renderList } from "./__oracles__/renderList";
import { W } from "./frameLattice";

jest.setTimeout(120000);

const engines = [];
function mkEngine(w = 800, h = 600) {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true, scenes: false });
    // A step reads the table's cache alone; the rest of the window is read at idle once still for `restQuietMs` (0
    // here), and the next step asks for the cells it covers. No prefetch unless a test asks.
    const c = E.renderer.pyramid.cfg;
    c.restInline = "never"; c.restQuietMs = 0; c.prefetchQuietMs = 1e9;
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
/**
 * The still frame the page's "raf" frames take after a camera step (A3 §2.1: stillness is seen only on a frame), then
 * past the idle table read the step left (`_readIdle`), its step and their arrivals: at most a second.
 */
async function settled(E) {
    E.renderer.syncCameraOnly();
    for (let k = 0; k < 100; k++) {
        await flush();
        if (E._readTimer == null && !holes(E).length) return;
        await sleep(10);
    }
}
const fill = (E, x, y, w, h, color, frame = "0") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, frame);

/** A plate's rectangle in its frame's units. */
const plateRect = (Zq, i, j) => { const u = PLATE_PX / Zq; return { left: i * u, top: j * u, right: (i + 1) * u, bottom: (j + 1) * u }; };
/**
 * The pack's own check, wrapped: every item the render list (the brute-force read) has over a plate whose drawn box meets the plate's
 * inside (a device pixel in) is in the list the job was packed from, at the same offset. Returns the
 * misses, "plate:id". The pack's cull is the pixel check's (`badPlates`).
 */
function watchJobs(E) {
    const R = E.renderer, pack = R._pyrPack.bind(R), out = { jobs: 0, plates: 0, misses: [] };
    R._pyrPack = (job, jobId, pool) => {
        const src = job.table ? R._tableList(job.table) : R._sceneList();
        const packed = pack(job, jobId, pool);
        if (!packed || job.kind === "plane") return packed;           // a plane layer packs its members alone, or all but them
        const ids = new Map();
        for (const it of src) ids.set(it.piece || it, it.res || null);
        out.jobs++;
        for (const c of job.packedCells || job.cells) {
            const r = plateRect(c.Z, c.i, c.j), e = 1 / c.Z;
            const inner = { left: r.left + e, top: r.top + e, right: r.right - e, bottom: r.bottom - e };
            out.plates++;
            for (const o of renderList(E, c.frame, r)) {
                if (E.stage._pending.has(o.id)) continue;                        // pending its shape: on no plate (PLAN §1.5)
                const b = drawnBox(o), dx = o.res ? o.res[0] : 0, dy = o.res ? o.res[1] : 0;
                if (b.right + dx < inner.left || b.left + dx > inner.right || b.bottom + dy < inner.top || b.top + dy > inner.bottom) continue;
                const r2 = ids.get(o);
                const same = r2 !== undefined && (r2 ? r2[0] : 0) === dx && (r2 ? r2[1] : 0) === dy;
                if (!same) out.misses.push(c.key + ":" + o.id);
            }
        }
        return packed;
    };
    return out;
}

/** The plate rastered from a list built four plates wide around it. */
function refPixels(E, frameId, Zq, i, j) {
    const u = PLATE_PX / Zq, pad = 4;
    const list = renderList(E, frameId, { left: (i - pad) * u, top: (j - pad) * u, right: (i + 1 + pad) * u, bottom: (j + 1 + pad) * u });
    const job = packJob(list, { plates: Int32Array.of(i, j), Zq, dpr: E.renderer.layer.dpr, cfg: E.cfg, paper: [255, 255, 255],
        live: E.renderer.live.model });
    const rgba = new Uint8ClampedArray(TW * TH * 4);
    renderPlate(job, 0, rgba, new Uint32Array(COUNTS_PER_PLATE), new Float64Array(TIMINGS_PER_PLATE));
    return rgba;
}
const WHITE = (() => { const a = new Uint8ClampedArray(TW * TH * 4); a.fill(255); return a; })();
const diffPx = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) > 8 || Math.abs(a[k + 1] - b[k + 1]) > 8 || Math.abs(a[k + 2] - b[k + 2]) > 8) n++; return n; };
/** A view cell's own key: the rest set's at rest, else the view level's. */
const viewKey = (v, i, j) => (v.mode === "rest" ? restKey(v.frameId, v.Z, i, j) : levelKey(v.frameId, v.level, v.S, i, j));
/** The view's cells with no exact plate: after a camera step and its arrivals, none (the table followed the window). */
function holes(E) {
    const v = E.renderer._view, out = [];
    for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) {
        const e = E.plates.get(viewKey(v, i, j));
        if (!e || !E.plates.exact(e)) out.push(i + "," + j);
    }
    return out;
}
/** Every exact level or rest plate in the store (any level: the prefetch's too) that differs from its reference by 64 px or more. */
function badPlates(E) {
    const out = [];
    for (const e of E.plates.cache.values()) {
        if (e.kind === "plane" || !E.plates.exact(e)) continue;
        const px = e.pixels || (e.bitmap && e.bitmap.pixels) || null;
        const d = diffPx(px || WHITE, refPixels(E, e.frame, e.Z, e.i, e.j));
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
        for (let k = 0; k < 12; k++) { E.panBy(k < 6 ? -260 : 260, k % 3 === 0 ? 180 : -60); await settled(E); expect(holes(E)).toEqual([]); }
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
        E.panBy(-10, 0); await settled(E);
        expect(holes(E)).toEqual([]);
        expect(badPlates(E)).toEqual([]);
        // Camera steps, no render and no cell change, until the view reaches square -1: its tiles are read by the step.
        const frame0 = E.cam.frame, rebuilds0 = E.stage.stats.rebuilds;
        for (let k = 0; k < 6; k++) { E.panBy(750, 0); await settled(E); expect(holes(E)).toEqual([]); }   // red at the sixth when the step does not sync
        expect(E.cam.frame).toBe(frame0);
        expect(E.stage.stats.rebuilds).toBe(rebuilds0);               // a window change is not a rebuild (A2 §2.12)
        expect(badPlates(E)).toEqual([]);
        expect(seen.misses).toEqual([]);
    });

    test("C5 a camera plate the table does not cover waits: never packed from a table short of its tiles, packed once the table reads it (F119)", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.04, edgeX = W / 2 - 100;                         // two cache squares across the view
        E.cam.set({ frame: child, inScale: s, inPanX: -(edgeX - 800 / s) * s, inPanY: 300 });
        E._render(); await flush();
        const v = E.renderer._view;
        const far = plateRect(v.Zq, v.i1, v.j0);                      // the right edge's plate, in the second square
        E.plates.dropAll();
        const win = E._listWin();
        E.stage.sync(E.cam.frame, { ...win, right: win.left + 1 }, Infinity);   // the table reads the left square alone
        expect(E.stage.covers(v.frameId, far)).toBe(false);
        const seen = watchJobs(E);
        E.renderer.syncCameraOnly(); await flush();                  // the view's step with the table short
        expect(seen.plates).toBeGreaterThan(0);                       // the covered cells were packed
        expect(E.plates.get(viewKey(E.renderer._view, v.i1, v.j0))).toBeUndefined();   // red without the check: paper cached exact
        expect(seen.misses).toEqual([]);
        E._render(); await settled(E);                                // the table reads the window: packed
        expect(holes(E)).toEqual([]);
        expect(badPlates(E)).toEqual([]);
    });

    test("C3 the prefetch's coarser levels, read as snapshots, hold the ink their plates reach", async () => {
        const E = mkEngine();
        fill(E, -400, -400, 800, 800, "rgb(40,90,160)", "0");
        E._render(); await flush();
        const child = E.lm.ensureSpine(1);
        const s = 0.3, cx = 50000;
        E.cam.set({ frame: child, inScale: s, inPanX: 400 - cx * s, inPanY: 300 });
        E._render(); await flush();
        const snaps = jest.spyOn(E.stage, "snapshot");
        const seen = watchJobs(E);
        const R = E.renderer;
        R.pyramid.cfg.prefetchQuietMs = 0;
        R._pyrPrefetchKey = null;
        R._pyrPrefetch(R._view);                                      // the camera still: the plan, at idle
        for (let k = 0; k < 60 && (R.queue.report().queued.some((n) => n) || R.queue.report().inFlight.some((n) => n)); k++) { await sleep(20); await flush(); }
        await flush();
        expect(snaps).toHaveBeenCalled();
        expect(seen.jobs).toBeGreaterThan(0);
        expect(seen.misses).toEqual([]);
        expect(badPlates(E)).toEqual([]);                             // red on the old ladder's rung window: the q-27 rung, 212,480 px
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
        // The far level is read at idle, never inside an aim (the select's and the drop's frames: 0.2–0.6 s in Chrome). The
        // read is unbudgeted here and the waits count turns: its IDLE_READ_MS budget and the waits' 5 s were wall-clock.
        const R = E.renderer, aim = R._aimPlane.bind(R), snap = E.stage.snapshot.bind(E.stage);
        let aiming = false, inAim = 0, built = 0;
        R._aimPlane = (v) => { aiming = true; try { return aim(v); } finally { aiming = false; } };
        E.stage.snapshot = (frameId, rect) => { if (aiming) inAim++; built++; return snap(frameId, rect); };
        E.setTool("select"); E._setSelection([sel.id], []); E._render();
        const pl = E.renderer._plane;
        for (let k = 0; !(pl.layers.length && pl.checkReady(E.plates)) && k < 250; k++) { await sleep(20); await flush(); }
        E.pointerDown(1000, 700); E.pointerMove(1010, 705); await flush();
        expect(pl.quick && pl.quick.k).toBeGreaterThan(2);           // the case: a quick level past the table's margin
        for (let k = 0; (pl.quick.listPending || !pl._whole(pl.quick, E.plates)) && k < 250; k++) { await sleep(20); await flush(); }
        expect(pl.quick.list).toBeTruthy();                           // read at idle, not in the aim
        expect(pl.quick.G).toBeGreaterThan(0);                        // and packed at the snapshot's G
        expect(built).toBeGreaterThan(0);
        expect(inAim).toBe(0);
        expect(pl._whole(pl.quick, E.plates)).toBe(true);
        const bad = [];
        for (const lvl of [pl.quick, pl.main]) {
            const L = lvl.layers[0], u = PLATE_PX / lvl.pZq;
            for (const [i, j] of L.cells) {
                const e = E.plates.get(pl._key(L.tag, lvl.pZq, i, j));
                const px = e && (e.pixels || (e.bitmap && e.bitmap.pixels));
                if (!px) continue;
                const list = renderList(E, pl.frameId, { left: (i - 2) * u, top: (j - 2) * u, right: (i + 3) * u, bottom: (j + 3) * u });
                const job = packJob(list, { plates: Int32Array.of(i, j), Zq: lvl.pZq, dpr: E.renderer.layer.dpr, cfg: E.cfg,
                    paper: [255, 255, 255], omit: L.omit, live: E.renderer.live.model });
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
