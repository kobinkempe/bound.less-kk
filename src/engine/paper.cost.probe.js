/**
 * paper.cost.probe.js — PAPER-PLAN §10's main-thread costs on the real Magnum Opus (Sep 15 export),
 * at the saved camera: (A) the list build and its parts, (C) a drag step with the drag plane, (D) the
 * pack of one view as one strip and as a strip a plate, (E) the ink under a plate-covering opaque fill.
 * (B, the zoom-out crossing after the ladder's warm-up, went with the ladder at P6.)
 *
 * A probe, not a suite (`*.probe.js` is excluded from test:quick / test:slow). Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false
 *     --testMatch "**\/paper.cost.probe.js"
 */
import KobinEngine from "./KobinEngine";
import { packJob } from "./raster/rasterPack";
import { renderPlate, TW, TH } from "./raster/rasterCore";
import { plateRange } from "./raster/plate";
import { LEVEL_STEP, levelFor, zOf } from "./raster/level";

/** The view level at a camera scale and its grid zoom (the pyramid's `levelFor`, A3 §1.2). */
const levelAt = (inScale, dpr) => { const l = levelFor(inScale * dpr, LEVEL_STEP); return { q: l, Zq: zOf(l, LEVEL_STEP) }; };

const fs = require("fs");
const FILE = "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";
const W = 1504, H = 868, DPR = 1.5;

jest.setTimeout(30 * 60 * 1000);

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
let RAW = null;
const readRaw = () => (RAW || (RAW = JSON.parse(fs.readFileSync(FILE, "utf8"))));

function mk(raster) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: W, height: H, raster });
    const t0 = now();
    E.loadDrawing(readRaw());
    log("loaded " + Math.round(now() - t0) + " ms; frame depth " + E.cam.activeLevel + " inScale " + E.cam.inScale);
    return E;
}

/** Wraps `obj[name]` so every call's ms is summed into `acc[name]`. */
function timeIt(obj, name, acc) {
    const f = obj[name].bind(obj);
    acc[name] = 0; acc[name + "N"] = 0;
    obj[name] = (...a) => { const t = now(); try { return f(...a); } finally { acc[name] += now() - t; acc[name + "N"]++; } };
}

/** `_reroute`'s own group scan, without the tile reads: the O(offset objects) half. */
function groupScan(E, F) {
    const st = E.store, D = st._depth(F);
    let n = 0;
    for (const id of E.doc.offsetIds()) {
        const rec = E.doc.getById(id);
        if (!rec || rec.level === F) continue;
        if (D < st._depth(rec.level)) continue;
        if (E.lm.objShift(rec.obj.below, rec.level, F)) n++;
    }
    return n;
}

describe("paper costs on the Magnum Opus", () => {
    const big = fs.existsSync(FILE) ? test : test.skip;

    big("A — the list build at the saved camera, and its parts", () => {
        const E = mk(false);
        const acc = {};
        timeIt(E.store, "content", acc); timeIt(E.store, "_reroute", acc); timeIt(E.stage.model, "nativesIn", acc);
        const rows = [];
        for (let k = 0; k < 4; k++) {
            for (const key of Object.keys(acc)) acc[key] = 0;
            const t = now();
            const list = E._buildList();
            rows.push({ k, ms: +(now() - t).toFixed(1), n: list.length, content: +acc.content.toFixed(1), reroute: +acc._reroute.toFixed(1), own: +acc.nativesIn.toFixed(1) });
        }
        const tg = now();
        const moved = groupScan(E, E.cam.frame);
        log("A list builds " + JSON.stringify(rows));
        log("A offsetIds " + E.doc.offsetIds().size + ", rerouted at this frame " + moved + ", the group scan alone " + (now() - tg).toFixed(1) + " ms");
        expect(rows.length).toBe(4);
    });

    big("C — a drag step's main-thread cost on the raster engine (the drag plane on)", () => {
        const E = mk(true);
        E._render();
        E.setTool("select");
        const cx = W / 2, cy = H / 2;
        E.pointerDown(cx, cy); E.pointerUp();
        const sel = E.selection;
        log("C tap selection ids=" + (sel ? sel.ids.length : 0) + " frames=" + (sel ? sel.frames.length : 0));
        if (!sel) return;
        const acc = {};
        timeIt(E, "_buildList", acc); timeIt(E.stage, "sync", acc); timeIt(E.renderer, "render", acc);
        timeIt(E.renderer, "syncCameraOnly", acc); timeIt(E.doc, "setOffsetsById", acc); timeIt(E, "_displaceMember", acc);
        timeIt(E.renderer, "_frameStep", acc); timeIt(E.renderer, "_renderSelOverlay", acc); timeIt(E, "_emit", acc);
        E.renderer.setSelectionAnts(() => { const t = now(); try { return E._selectionAnts(); } finally { acc.ants = (acc.ants || 0) + now() - t; } });
        timeIt(E, "_selEdges", acc); timeIt(E, "_selDecide", acc);
        timeIt(E, "_tapBarrier", acc); timeIt(E, "_dragBarrier", acc); timeIt(E, "_beginHold", acc); timeIt(E, "_selectionMembers", acc);
        timeIt(E.store, "setBatch", acc);
        const s0 = { ...E.plates.s }, d0 = E.stage.stats.dirtied;
        E.pointerDown(cx, cy);
        const rows = [];
        for (let k = 1; k <= 12; k++) {
            for (const key of Object.keys(acc)) acc[key] = 0;
            const t = now();
            E.pointerMove(cx + 10 + k * 6, cy + k * 3);
            rows.push([+(now() - t).toFixed(1), +acc._buildList.toFixed(1), +acc.sync.toFixed(1), +acc.render.toFixed(1),
                +acc.syncCameraOnly.toFixed(1), +acc._frameStep.toFixed(1), +acc._renderSelOverlay.toFixed(1), +acc.setOffsetsById.toFixed(1), +acc._displaceMember.toFixed(1), +acc._emit.toFixed(1),
                +(acc.ants || 0).toFixed(1), +acc._selEdges.toFixed(1), +acc._selDecide.toFixed(1),
                +acc._tapBarrier.toFixed(1), +acc._dragBarrier.toFixed(1), +acc._beginHold.toFixed(1), +acc._selectionMembers.toFixed(1)]);
        }
        E.pointerUp();
        const s1 = E.plates.s;
        log("C per step [total, list, stage.sync, render, syncCameraOnly, frameStep, selOverlay, setOffsets, displace, emit, ants, selEdges, selDecide, flushErases, settleErases, beginHold, members] " + JSON.stringify(rows));
        log("C over 12 steps: cells dirtied " + (E.stage.stats.dirtied - d0) + " dropsAll " + (s1.dropsAll - s0.dropsAll)
            + " misses " + (s1.misses - s0.misses));
    });

    big("D — packing one screen at the camera's quantum: one strip vs per-plate strips", () => {
        const E = mk(false);
        const list = E._buildList();
        const qf = levelAt(E.cam.inScale, DPR);
        const r = plateRange(E.cam.frameWindow(0), qf.Zq);
        const all = [];
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) all.push(i, j);
        const opts = (plates) => ({ plates: Int32Array.from(plates), Zq: qf.Zq, dpr: DPR, cfg: E.cfg, paper: [255, 255, 255] });
        packJob(list, opts(all));                          // the memo, cold
        let t = now(); packJob(list, opts(all)); const one = now() - t;
        t = now();
        for (let p = 0; p < all.length; p += 2) packJob(list, opts([all[p], all[p + 1]]));
        const per = now() - t;
        log("D list " + list.length + " pieces, " + all.length / 2 + " plates at level " + qf.q + ": one strip " + one.toFixed(1)
            + " ms, one strip per plate " + per.toFixed(1) + " ms in all");
    });

    big("E — z-order occlusion: ink under an opaque plate-covering family, per plate of the view", () => {
        const E = mk(false);
        const list = E._buildList();
        const qf = levelAt(E.cam.inScale, DPR);
        const Zq = qf.Zq;
        const r = plateRange(E.cam.frameWindow(0), Zq);
        const out = new Uint8ClampedArray(TW * TH * 4);
        const rows = [];
        let items = 0, hidden = 0, famsAll = 0, famsHidden = 0, msAll = 0, msVisible = 0;
        for (let j = r.j0; j <= r.j1; j++) {
            for (let i = r.i0; i <= r.i1; i++) {
                const job = packJob(list, { plates: Int32Array.from([i, j]), q: qf.q, Zq, dpr: DPR, cfg: E.cfg, paper: [255, 255, 255] });
                const n = job.nItems;
                // the plate's rect in frame units, and the TOPMOST item that is a covering fill at full alpha over all of it
                const x0 = (i * 512) / Zq, y0 = (j * 512) / Zq, x1 = ((i + 1) * 512) / Zq, y1 = ((j + 1) * 512) / Zq;
                let top = -1;
                for (let k = n - 1; k >= 0; k--) {
                    const a = k * 9;
                    const box = [job.attr[a], job.attr[a + 1], job.attr[a + 2], job.attr[a + 3]];
                    if ((job.meta[k * 8 + 6] & 1) && job.attr[a + 7] >= 1 && box[0] <= x0 && box[1] <= y0 && box[2] >= x1 && box[3] >= y1) { top = k; break; }
                }
                const fam = (k) => job.meta[k * 8 + 1];
                const famCount = n ? fam(n - 1) + 1 : 0;
                const famTop = top >= 0 ? fam(top) : 0;
                items += n; famsAll += famCount;
                if (top > 0) { hidden += top; famsHidden += famTop; }
                const t0 = now(); renderPlate(job, 0, out, new Uint32Array(8)); const ms = now() - t0;
                msAll += ms;
                let msV = ms;
                if (top > 0) {
                    // the same plate with the hidden families left out: the core time occlusion would save
                    const cut = { ...job };
                    const k0 = top;
                    let first = 0; while (first < n && fam(first) < famTop) first++;
                    cut.nItems = n - first;
                    cut.meta = job.meta.slice(first * 8); cut.attr = job.attr.slice(first * 9); cut.rgb = job.rgb.slice(first * 3);
                    for (let k = 0; k < cut.nItems; k++) cut.meta[k * 8 + 1] -= famTop;
                    const t1 = now(); renderPlate(cut, 0, out, new Uint32Array(8)); msV = now() - t1;
                    rows.push([i, j, n, k0, +ms.toFixed(1), +msV.toFixed(1)]);
                }
                msVisible += msV;
            }
        }
        log("E " + ((r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1)) + " plates at level " + qf.q + ": items " + items + ", under a covering fill " + hidden
            + "; families " + famsAll + ", hidden " + famsHidden + "; core " + msAll.toFixed(0) + " ms, without the hidden " + msVisible.toFixed(0)
            + " ms; plates with a cover [i, j, items, coverAt, ms, msVisible] " + JSON.stringify(rows.slice(0, 12)));
    });
});
