/**
 * review1006.picture.far.probe.js — the prefetch's far zoom-out levels in the store, on Kobin's R5 canvas (extract):
 * which far plates are protected (`store.view.far`, rank FAR) after one prefetch plan, after a second plan (a small pan
 * at rest), and what is left after the store is filled by pans; then a fast zoom-out from the deep frame across the
 * crossing with a bounded number of worker answers a step, counting paper cells per compose. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.far.probe.js"
 * Env: FAR_KEEP=1 accumulates the far set (a lever, patched here only); ANSWERS=<jobs answered per zoom step> (default 1);
 * ZOOM_STEP=<octaves per step> (default 0.1).
 */
import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";
import { RANK } from "./raster/PyramidStore";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "picture");
const RANKS = Object.keys(RANK).sort((a, b) => RANK[a] - RANK[b]);
const tick = () => new Promise((r) => setTimeout(r, 0));

function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        parked,
        async answer(n = Infinity) {
            let k = 0;
            while (parked.length && k < n) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); k++; }
            for (let t = 0; t < 6; t++) await tick();
            return k;
        },
    };
}
async function settle(E, frames = 2) { for (let k = 0; k < frames; k++) { E.renderer.syncCameraOnly(); for (let n = 0; n < 4; n++) await tick(); } }
async function drain(E, g, max = 400) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    let k = 0;
    for (; k < max && busy(); k++) { await g.answer(); await settle(E, 1); }
    // the prefetch waits for the scene's quiet (100 ms) after the last commit
    await new Promise((r) => setTimeout(r, 150)); await settle(E, 2);
    for (; k < max && busy(); k++) { await g.answer(); await settle(E, 1); }
    return busy();
}
/** The store by rank and by kind/frame/level. */
function census(E) {
    const st = E.plates, by = {}, lv = {};
    for (const r of st.records()) {
        const rk = st.isPinned(r.key) ? "PINNED" : RANKS[st.rankOf(r)];
        by[rk] = (by[rk] || 0) + 1;
        const k = r.kind + " " + String(r.frame).slice(-22) + " " + (r.kind === "level" ? "L" + r.level : r.kind === "rest" ? "Z" + (+r.Z).toFixed(2) : r.tag);
        lv[k] = (lv[k] || 0) + 1;
    }
    return { plates: st.cache.size, MiB: Math.round(st.bytes / 1048576), byRank: by, byLevel: lv, far: st.view && st.view.far ? st.view.far.size : 0 };
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("R5: the far levels' protection, and a fast zoom-out across the crossing", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-26-51-275Z.json");
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    Object.defineProperty(window, "screen", { value: { width: 1920, height: 1080 }, configurable: true });
    const g = gate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true });
    loadReport(E, rep);
    E.plates.phone = false;
    if (process.env.BUDGET_VIEWS) E.renderer.pyramid.cfg.plateViews = +process.env.BUDGET_VIEWS;
    E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    if (process.env.NO_LEFT || process.env.STALE_RANKED) {
        // Levers, patched here only: NO_LEFT — the frame just left is not a protected class (its plates rank as
        // LEVELS); STALE_RANKED — a stale plate ranks as it would fresh (no STALE-first eviction).
        const rk = E.plates.rankOf.bind(E.plates), st = E.plates;
        E.plates.rankOf = (r) => {
            let x = rk(r);
            if (x === RANK.STALE && process.env.STALE_RANKED) { const ex = st.exact; st.exact = () => true; try { x = rk(r); } finally { st.exact = ex; } }
            return x === RANK.LEFT && process.env.NO_LEFT ? RANK.LEVELS : x;
        };
    }
    const R = E.renderer, pyr = R.pyramid;
    if (process.env.FAR_KEEP) {
        const orig = pyr.setFar.bind(pyr);
        pyr.setFar = (keys) => { const v = E.plates.view; const prev = v && v.far ? [...v.far].filter((k) => E.plates.get(k)) : []; orig([...prev, ...keys]); };
    }
    log(`budget ${E.plates.maxBytes / 1048576} MiB, phone ${E.plates.phone}, pinBound ${pyr.pinBound}, sigmaMin ${pyr.sigmaMin}`);
    E.setTool("select");
    E._render();
    await drain(E, g);
    const P0 = E.cam.frame, s0 = E.cam.inScale;
    log(`R5 camera ${P0} inScale ${s0}: ${JSON.stringify(census(E))}`);
    // Into the deep frame C (…/1584,1097, centred at screen (801, 333)) at Kobin's 4.39.
    const target = 4.39 * 4096;
    for (let k = 0; k < 60 && E.cam.inScale * (E.cam.frame === P0 ? 1 : 4096) < target; k++) { E.zoomFactorAt(801, 333, 1.5); await settle(E, 1); }
    const C = E.cam.frame;
    log(`zoomed in: frame ${C} inScale ${E.cam.inScale}`);
    await drain(E, g);
    const c1 = census(E), far1 = new Set(E.plates.view.far);
    log(`C at rest, after the first drain: ${JSON.stringify(c1)}`);
    // A small pan at rest: a new view revision, a second prefetch plan.
    E.panBy(12, 0); await settle(E, 2); await drain(E, g);
    const far2 = new Set(E.plates.view.far);
    const kept = [...far1].filter((k) => far2.has(k)).length, cached = [...far1].filter((k) => E.plates.get(k)).length;
    const ranks = {};
    for (const k of far1) { const r = E.plates.get(k); if (r) { const rk = E.plates.isPinned(k) ? "PINNED" : RANKS[E.plates.rankOf(r)]; ranks[rk] = (ranks[rk] || 0) + 1; } }
    log(`after a 12-px pan and a second plan: far set ${far1.size} -> ${far2.size}; of the first plan's far keys ${kept} still FAR, ${cached} cached, ranked now ${JSON.stringify(ranks)}`);
    log(`census: ${JSON.stringify(census(E))}`);
    if (process.env.MOVES) {
        // Kobin's three drops in C (03:26:27–39): the family under the screen centre, tapped and dragged, each drained.
        let at = null;
        for (let y = 400; y < 700 && !at; y += 20) for (let x = 700; x < 1100 && !at; x += 20) { const id = E._hitTest(x, y); if (id != null) at = [x, y, id]; }
        log(`moves: ink under ${JSON.stringify(at)}`);
        for (let m = 0; m < +process.env.MOVES && at; m++) {
            const d = m % 2 ? -60 : 60;
            E.pointerDown(at[0], at[1]); E.pointerUp();
            E.pointerDown(at[0], at[1]);
            for (let s = 1; s <= 8; s++) E.pointerMove(at[0] + (d * s) / 8, at[1] + (d * s) / 16);
            E.pointerUp();
            at = [at[0] + d, at[1] + d / 2, at[2]];
            await settle(E, 2);
            if (process.env.MOVE_DRAIN !== "0") await drain(E, g);
            log(`  after drop ${m + 1}: selection ${JSON.stringify(E.selection && E.selection.ids)}; census ${JSON.stringify(census(E))}; stale plates ${[...E.plates.records()].filter((r) => !E.plates.exact(r)).length}`);
        }
        E.deselect && E.deselect();
        log(`after the drops: evictedByRank ${JSON.stringify(E.plates.report().evictedByRank)}`);
    } else {
        // Pressure: pans at rest across C (as a session of moves and looks would), draining each.
        for (let k = 0; k < 6; k++) { E.panBy(k % 2 ? -700 : 700, k % 3 ? 120 : -120); await settle(E, 2); await drain(E, g); }
    }
    const left1 = [...far1].filter((k) => E.plates.get(k)).length;
    log(`before the zoom-out: of the first plan's ${far1.size} far plates ${left1} remain; evictedByRank ${JSON.stringify(E.plates.report().evictedByRank)}; census ${JSON.stringify(census(E))}`);
    // The fast zoom-out back to P's 21.6, ANSWERS jobs answered per step, ZOOM_STEP octaves a step.
    const answers = process.env.ANSWERS != null ? +process.env.ANSWERS : 1, step = process.env.ZOOM_STEP ? +process.env.ZOOM_STEP : 0.1;
    const rows = [];
    let paperComposes = 0, maxPaper = 0;
    for (let k = 0; k < 400; k++) {
        const atP = E.cam.frame !== C && E.cam.activeLevel < 6;
        if (atP && E.cam.inScale <= s0) break;
        E.zoomFactorAt(801, 333, 2 ** -step);
        await g.answer(answers);
        E.renderer.syncCameraOnly();
        const Pn = pyr.lastPlan, v = Pn.v;
        let paper = 0, blur = 0, older = 0, cells = 0;
        for (const c of Pn.cells) for (const d of c.draws) { cells++; if (d.cls === "paper") paper++; else if (d.cls === "blur") blur++; else if (d.cls === "older") older++; }
        if (paper) paperComposes++;
        const share = pyr._share.paper;
        maxPaper = Math.max(maxPaper, share);
        // The audit: a paper cell for which an exact sharper source existed — all 2^S×2^S children at ℓ+1 exact in
        // the view frame's own grid or as twins in another frame (`_mapped`), or one exact plate at ℓ+2 per quarter.
        let kidsTwin = 0, kidsOwn = 0;
        if (paper && v.mode === "level") {
            const F = v.frameId, l = v.level, S = v.S, n = 1 << S;
            for (const c of Pn.cells) {
                if (!c.draws.some((d) => d.cls === "paper")) continue;
                let own = true, twin = true;
                for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
                    const ci = c.i * n + a, cj = c.j * n + b, r = E.plates.get(F + "|L" + (l + 1) + "s" + S + "|" + ci + "," + cj);
                    const ex = r && E.plates.exact(r);
                    if (!ex) own = false;
                    if (!ex && !pyr._mapped(F, l + 1, S, ci, cj)) twin = false;
                }
                if (own) kidsOwn++; else if (twin) kidsTwin++;
            }
        }
        rows.push({ k, frame: String(E.cam.frame).slice(-12), depth: E.cam.activeLevel, inScale: +E.cam.inScale.toPrecision(4), mode: v.mode, level: v.level, s: +v.s.toFixed(3), images: Pn.images, cells, paper, blur, older, paperShare: +share.toFixed(3), plates: E.plates.cache.size, kidsTwin, kidsOwn });
    }
    for (const r of rows) log(`  ${JSON.stringify(r)}`);
    log(`zoom-out: ${rows.length} steps, ${paperComposes} composes with paper, worst paper share ${maxPaper.toFixed(3)}; paperMs ${pyr.s.paperMs.toFixed(0)}`);
    fs.mkdirSync(OUT, { recursive: true });
    const variant = (process.env.FAR_KEEP ? "keep" : "shipped") + (process.env.NO_LEFT ? "-noleft" : "") + (process.env.STALE_RANKED ? "-staleranked" : "") + (process.env.BUDGET_VIEWS ? "-views" + process.env.BUDGET_VIEWS : "")
        + (process.env.MOVES ? "-moves" + process.env.MOVES + (process.env.MOVE_DRAIN === "0" ? "nodrain" : "") : "");
    fs.writeFileSync(path.join(OUT, "far-" + variant + "-a" + answers + "-s" + step + ".json"), JSON.stringify({ c1, far1: far1.size, far2: far2.size, kept, left1, rows }, null, 1));
    E.destroy();
});
