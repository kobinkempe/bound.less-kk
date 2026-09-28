#!/usr/bin/env node
/**
 * browser-check.js — drive the app in a real Chromium through Playwright and print the engine's
 * own numbers: draw three strokes, zoom out 40 wheel ticks, zoom back, screenshot each state and
 * count the ink pixels of the composed canvas before and after the round trip. Rule 3 of
 * docs/ai/00-START-HERE.txt: paint is measured in a browser, never by rasterising the SVG.
 *
 *   node tools/harnesses/browser-check.js [url] [--out <dir>] [--headed]
 *   node tools/harnesses/browser-check.js [url] --dense [--scenario <1–7|name|all>] [--seed n] [--query "levelStep=2&…"]
 *
 * `--dense` loads the synthetic drawing of A3 §9.3 (`synth-drawing.js`, ~3,700 objects over four levels, a
 * stack under a pending mark) through `E.loadSnapshot` and `E.flushBakes()`, then runs A3 §9.3's scenarios —
 * 1 zoomout (90 ticks of +250 at 25 ms from depth 2 to 0, and back), 2 slowzoom (40 ticks at 120 ms),
 * 3 pan (60 steps of (25, 8) at 16 ms), 4 drag (a lasso and a 40-step drag), 5 penup (a translucent
 * stroke, pen-up to the live path's release), 6 undo (Ctrl+Z of it, to exact), 7 erase (an eraser across the
 * stack while zooming) — each in a fresh page, each printing its deltas as one JSON line: paper (PAPER-PLAN
 * §9: each rAF's uncovered share × how long it stayed, charged forward; the layer's own `paperMs`, `blurMs`,
 * `olderMs` when it carries them), the frame-time histogram and long frames over the gesture, the compose's
 * count, ms and most images, plates, and jobs. `--query` is appended to the canvas URL (`?dev&…`).
 *
 * Needs a dev server (`npm start`, on Node 14: CRA 4 does not start on Node 17+) and Playwright
 * with a Chromium. In the Claude cloud container both are preinstalled (Playwright at
 * /opt/node22/lib/node_modules/playwright, Chromium at /opt/pw-browsers/chromium) and this runs
 * under Node 22. Headless Chromium draws with software GL: the scripting numbers, the pixels and the
 * compose's ~33-distinct-image cliff (0.1 → 26 ms of script at 34 scaled bitmaps, A3 E6) are real;
 * GPU texture uploads and the compositor's scaling are not, and wait for Kobin's Chrome.
 * Output: one JSON object per state on stdout, screenshots under --out (default tools/.cache/browser-check).
 */
const fs = require("fs");
const path = require("path");
const { synth } = require("./synth-drawing");

function loadPlaywright() {
    for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright", "/usr/lib/node_modules/playwright"]) {
        try { return require(p); } catch (e) { /* next */ }
    }
    throw new Error("playwright not found: npm i -g playwright && npx playwright install chromium");
}

const argv = process.argv.slice(2);
const arg = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
const BASE = argv.find((a) => /^https?:/.test(a)) || "http://localhost:3000";
const OUT = arg("--out", path.join(__dirname, "..", ".cache", "browser-check"));
const HEADED = argv.includes("--headed");
const DENSE = argv.includes("--dense");
const SCENARIO = arg("--scenario", "all");
const SEED = +arg("--seed", "1");
const QUERY = arg("--query", "");
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const VIEW = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (label, obj) => console.log(JSON.stringify({ [label]: obj }));

/** Runs in the page: the compact form of the engine's counters for one state. */
function pageState(which) {
    const E = window.__kobinEngine;
    const pick = (o, keys) => { const r = {}; if (o) for (const k of keys) if (k in o) r[k] = o[k]; return r; };
    const lf = E.longFrames && E.longFrames.report();
    const rr = E.renderer && E.renderer.report ? E.renderer.report() : null;
    const pl = E.renderer && E.renderer.layer && E.renderer.layer.report ? E.renderer.layer.report() : null;
    const ps = E.plates && E.plates.report ? E.plates.report() : null;
    const c = document.querySelector("canvas.bl-ink");
    let ink = null;
    if (c) {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0, hash = 0;
        for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; if (v < 750) n++; hash = (hash * 31 + v) >>> 0; }
        ink = { w: c.width, h: c.height, inkPx: n, hash };
    }
    return {
        which, zoom: E.cam.inScale, frame: E.cam.frame, visibility: document.visibilityState,
        natives: E.doc && E.doc.nativesByLevel ? Object.values(E.doc.nativesByLevel).reduce((a, l) => a + (l ? l.length : 0), 0) : null,
        renderer: pick(rr, ["mode", "posts", "postedPlates", "syncFrames", "liveHolds", "liveHandoffs", "liveTimeouts", "packed", "culled", "ladderPosts", "prebakePosts"]),
        picture: pick(pl, ["mode", "quantumChanges", "holds", "holdBreaks", "heldComposes", "previews", "previewHits", "paperComposes", "paperCellsMax", "carryComposes", "fallbackComposes", "staleComposes", "uncovered", "screenCovered", "composes", "composeMs", "maxImagesPerCompose"]),
        plates: pick(ps, ["plates", "plateBytes", "maxBytes", "evictions", "overCapPinned", "stale", "epochBumps", "abandons"]),
        longFrames: lf ? { count: lf.count, totalMs: lf.totalMs, worst: (lf.worst || []).slice(0, 3).map((w) => ({ ms: Math.round(w.ms), script: Math.round(w.scriptMs || 0), fn: (w.scripts || []).map((s) => s.fn + "@" + s.src).join(" ") })) } : null,
        ink,
    };
}

async function newPage(browser) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    const q = QUERY ? "&" + QUERY.replace(/^[?&]/, "") : "";
    await page.goto(`${BASE}/#/canvas/new?dev${q}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__kobinEngine && !!document.querySelector("canvas.bl-ink"), null, { timeout: 60000 });
    return { ctx, page, errors, consoleErrors };
}

async function roundTrip(browser) {
    fs.mkdirSync(OUT, { recursive: true });
    const t0 = Date.now();
    const { ctx, page, errors, consoleErrors } = await newPage(browser);
    say("mounted", { ms: Date.now() - t0, url: await page.evaluate(() => location.hash), raster: await page.evaluate(() => !!window.__kobinEngine.raster) });
    await sleep(500);

    const box = await (await page.$("canvas.bl-ink")).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    async function stroke(pts, steps = 40) {
        await page.mouse.move(pts[0][0], pts[0][1]);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
            const t = i / steps, k = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1))), u = t * (pts.length - 1) - k;
            await page.mouse.move(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u);
        }
        await page.mouse.up();
    }
    await stroke([[cx - 300, cy - 100], [cx - 100, cy + 120], [cx + 100, cy - 120], [cx + 300, cy + 100]]);
    await stroke([[cx - 250, cy + 200], [cx + 250, cy + 200]]);
    await stroke([[cx, cy - 250], [cx - 60, cy - 60], [cx + 60, cy + 60], [cx, cy + 250]]);
    await sleep(2000);
    await page.screenshot({ path: path.join(OUT, "1-drawn.png") });
    const drawn = await page.evaluate(pageState, "drawn");
    say("drawn", drawn);

    await page.mouse.move(cx, cy);
    const tz = Date.now();
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 120); await sleep(16); }
    const ticksMs = Date.now() - tz;
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, "2-zoomout-300ms.png") });
    say("zoomout-300ms", Object.assign({ ticksMs }, await page.evaluate(pageState, "zoomout-300ms")));
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, "3-zoomout-settled.png") });
    say("zoomout-settled", await page.evaluate(pageState, "zoomout-settled"));

    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -120); await sleep(16); }
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, "4-zoomin-settled.png") });
    const back = await page.evaluate(pageState, "zoomin-settled");
    say("zoomin-settled", back);
    say("roundTrip", { inkPxBefore: drawn.ink && drawn.ink.inkPx, inkPxAfter: back.ink && back.ink.inkPx, sameHash: !!(drawn.ink && back.ink && drawn.ink.hash === back.ink.hash) });
    say("errors", { pageErrors: errors, consoleErrors: consoleErrors.slice(0, 5) });
    await ctx.close();
}

// ---------------------------------------------------------------------------
// --dense: the synthetic drawing and A3 §9.3's scenarios
// ---------------------------------------------------------------------------

/**
 * Runs in the page: the probes. A rAF sampler integrates paper forward (each sample's uncovered share of
 * the screen's cells, `layer.uncoveredCells()` over `_rFull`, charged for the time until the next sample),
 * and `layer.compose` is wrapped for the most images one compose drew in the window being measured.
 */
function installProbes() {
    const E = window.__kobinEngine;
    const L = E.renderer && E.renderer.layer;
    const P = window.__bfProbe = { paperMs: 0, maxShare: 0, samples: 0, share: 0, last: performance.now(), maxImages: 0, composes: 0 };
    const shareNow = () => {
        if (!L || !L._rFull || !L.uncoveredCells) return 0;
        const r = L._rFull, cells = (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1);
        return cells > 0 ? Math.min(1, L.uncoveredCells() / cells) : 0;
    };
    const tick = (now) => {
        P.paperMs += P.share * (now - P.last);
        P.share = shareNow();
        if (P.share > P.maxShare) P.maxShare = P.share;
        P.last = now; P.samples++;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (L && L.compose) {
        const compose = L.compose.bind(L);
        L.compose = (plates) => { const n = compose(plates); P.composes++; if (n > P.maxImages) P.maxImages = n; return n; };
    }
    return true;
}

/** Runs in the page: everything a scenario differences, read at once. */
function probeRead() {
    const E = window.__kobinEngine, P = window.__bfProbe;
    const L = E.renderer && E.renderer.layer ? E.renderer.layer.report() : null;
    const S = E.plates && E.plates.report ? E.plates.report() : null;
    const R = E.renderer && E.renderer.report ? E.renderer.report() : null;
    let W = null;
    try { W = E.renderer && E.renderer.perf ? E.renderer.perf.report().worker : null; } catch (err) { W = null; }
    const F = E.frameMeter.report(), LF = E.longFrames.report();
    return {
        t: Date.now(), paperMs: P.paperMs, maxShare: P.maxShare, samples: P.samples, maxImages: P.maxImages, wrapComposes: P.composes,
        layerPaper: L && L.paperMs != null ? { paperMs: L.paperMs, blurMs: L.blurMs, olderMs: L.olderMs } : null,
        composes: L ? L.composes : null, composeMs: L ? L.composeMs : null, arrivalComposes: L ? L.arrivalComposes : null,
        hist: F.hist, frames: F.frames, longCount: LF.count, longRecent: LF.recent,
        plates: S ? { plates: S.plates, mib: +(S.plateBytes / 1048576).toFixed(1), capMib: +(S.maxBytes / 1048576).toFixed(1), pinned: S.pinned, inFlight: S.inFlight, evictions: S.evictions, stale: S.stale } : null,
        jobs: W ? { queued: W.queued, inFlight: W.inFlight, jobs: W.jobs, plates: W.plates, mode: W.mode, workers: W.workers } : null,
        posts: R ? { posts: R.posts, postedPlates: R.postedPlates, liveHandoffs: R.liveHandoffs, liveTimeouts: R.liveTimeouts, syncFrames: R.syncFrames } : null,
        cam: { frame: E.cam.frame, inScale: E.cam.inScale, level: E.cam.activeLevel },
        mode: L ? L.mode : "svg",
    };
}

/** Runs in the page: the probe's per-window maximum starts again. */
function probeResetMax() { window.__bfProbe.maxImages = 0; window.__bfProbe.maxShare = 0; return true; }

/** Runs in the page: is the renderer idle — nothing queued or in flight, no frame pending? */
function quiet() {
    const E = window.__kobinEngine;
    let W = null;
    try { W = E.renderer && E.renderer.perf ? E.renderer.perf.report().worker : null; } catch (err) { W = null; }
    const S = E.plates && E.plates.report ? E.plates.report() : null;
    return !E._fr && (!W || (W.queued === 0 && W.inFlight === 0)) && (!S || S.inFlight === 0);
}

/** Runs in the page: put frame F's point (x, y) at the screen's centre at `inScale`, and draw it. */
function placeCamera({ frame, inScale, x = 0, y = 0 }) {
    const E = window.__kobinEngine;
    E.cam.set({ frame, inScale, inPanX: E.width / 2 - x * inScale, inPanY: E.height / 2 - y * inScale });
    E.cam.settle();
    E._render();
    if (E.flush) E.flush();
    return { frame: E.cam.frame, inScale: E.cam.inScale };
}

async function settle(page, { minMs = 600, maxMs = 20000 } = {}) {
    const t0 = Date.now();
    await sleep(minMs);
    while (Date.now() - t0 < maxMs) {
        if (await page.evaluate(quiet)) return Date.now() - t0;
        await sleep(100);
    }
    return -1;
}

function delta(a, b) {
    const hist = {};
    for (const k of new Set([...Object.keys(a.hist || {}), ...Object.keys(b.hist || {})])) {
        const d = (b.hist[k] || 0) - (a.hist[k] || 0);
        if (d) hist[k] = d;
    }
    const long = (b.longRecent || []).filter((r) => r.t >= a.t && r.t <= b.t).sort((x, y) => y.ms - x.ms);
    const lp = a.layerPaper && b.layerPaper ? {
        paperMs: +(b.layerPaper.paperMs - a.layerPaper.paperMs).toFixed(1), blurMs: +(b.layerPaper.blurMs - a.layerPaper.blurMs).toFixed(1),
        olderMs: +(b.layerPaper.olderMs - a.layerPaper.olderMs).toFixed(1),
    } : null;
    const composes = b.composes != null ? b.composes - a.composes : null;
    return {
        paperMs: lp ? lp.paperMs : +(b.paperMs - a.paperMs).toFixed(1), paperSampledMs: +(b.paperMs - a.paperMs).toFixed(1),
        blurMs: lp ? lp.blurMs : null, olderMs: lp ? lp.olderMs : null, maxPaperShare: +b.maxShare.toFixed(3),
        frames: { n: b.frames - a.frames, hist }, longFrames: { count: b.longCount - a.longCount, worst: long.slice(0, 3).map((r) => ({ ms: Math.round(r.ms), script: Math.round(r.scriptMs || 0) })) },
        compose: { n: composes, ms: b.composeMs != null ? +(b.composeMs - a.composeMs).toFixed(1) : null,
            msMean: composes ? +((b.composeMs - a.composeMs) / composes).toFixed(2) : null, maxImages: b.maxImages, arrivals: b.arrivalComposes - a.arrivalComposes },
        plates: b.plates, jobs: b.jobs && a.jobs ? { jobs: b.jobs.jobs - a.jobs.jobs, plates: b.jobs.plates - a.jobs.plates, queued: b.jobs.queued, inFlight: b.jobs.inFlight, mode: b.jobs.mode, workers: b.jobs.workers } : null,
        posts: b.posts && a.posts ? { posts: b.posts.posts - a.posts.posts, postedPlates: b.posts.postedPlates - a.posts.postedPlates,
            liveHandoffs: b.posts.liveHandoffs - a.posts.liveHandoffs, liveTimeouts: b.posts.liveTimeouts - a.posts.liveTimeouts, syncFrames: b.posts.syncFrames - a.posts.syncFrames } : null,
        cam: b.cam, mode: b.mode,
    };
}

/** A fresh page with the dense drawing loaded, its perimeters resolved, the stack's mark baked, the probes on. */
async function densePage(browser) {
    const t0 = Date.now();
    const pg = await newPage(browser);
    const { page } = pg;
    const snap = synth({ seed: SEED, w: VIEW.width, h: VIEW.height });
    const stats = snap.stats;
    delete snap.stats;
    const load = await page.evaluate((s) => {
        const E = window.__kobinEngine, a = performance.now();
        E.loadSnapshot(s);
        const b = performance.now();
        E.flushBakes();
        return { loadMs: Math.round(b - a), bakeMs: Math.round(performance.now() - b), frames: E.lm.frames.size };
    }, snap);
    // The stack's mark resumes its bake on load: waited for (deadline 60 s) so no scenario times it.
    const tm = Date.now();
    let marks = -1;
    while (Date.now() - tm < 60000) {
        marks = await page.evaluate(() => window.__kobinEngine._eraseStrokes().length);
        if (!marks) break;
        await sleep(250);
    }
    await page.evaluate(installProbes);
    const settled = await settle(page);
    return { ...pg, setup: { ms: Date.now() - t0, objects: stats.objects, perFrame: stats.frames, ...load, markBakeMs: marks ? -1 : Date.now() - tm, settledMs: settled } };
}

async function measure(page, name, gesture, extra = {}) {
    await page.evaluate(probeResetMax);
    const a = await page.evaluate(probeRead);
    const t0 = Date.now();
    const out = (await gesture()) || {};
    const gestureMs = Date.now() - t0;
    const settleMs = await settle(page);
    const b = await page.evaluate(probeRead);
    return { scenario: name, gestureMs, settleMs, ...out, ...delta(a, b), ...extra };
}

async function wheel(page, n, dy, gapMs) {
    const t0 = Date.now();
    for (let k = 0; k < n; k++) { await page.mouse.wheel(0, dy); await sleep(gapMs); }
    return Date.now() - t0;
}

const CX = VIEW.width / 2, CY = VIEW.height / 2;

const SCENARIOS = {
    zoomout: async (page) => {
        await page.evaluate(placeCamera, { frame: "2", inScale: 1 });
        await settle(page);
        await page.mouse.move(CX, CY);
        const out = await measure(page, "1 zoomout", async () => ({ ticksMs: await wheel(page, 90, 250, 25) }));
        const back = await measure(page, "1 zoomout, back in", async () => ({ ticksMs: await wheel(page, 90, -250, 25) }));
        return [out, back];
    },
    slowzoom: async (page) => {
        await page.evaluate(placeCamera, { frame: "1", inScale: 1 });
        await settle(page);
        await page.mouse.move(CX, CY);
        return [await measure(page, "2 slowzoom", async () => ({ ticksMs: await wheel(page, 40, 250, 120) }))];
    },
    pan: async (page) => {
        await page.evaluate(placeCamera, { frame: "0", inScale: 1 });
        await page.evaluate(() => { window.__kobinEngine.deselect(); window.__kobinEngine.setTool("pan"); });
        await settle(page);
        return [await measure(page, "3 pan", async () => {
            await page.mouse.move(CX - 700, CY - 200);
            await page.mouse.down();
            const t0 = Date.now();
            for (let k = 1; k <= 60; k++) { await page.mouse.move(CX - 700 + 25 * k, CY - 200 + 8 * k); await sleep(16); }
            await page.mouse.up();
            return { stepsMs: Date.now() - t0 };
        })];
    },
    drag: async (page) => {
        await page.evaluate(placeCamera, { frame: "0", inScale: 1 });
        await page.evaluate(() => { window.__kobinEngine.deselect(); window.__kobinEngine.setTool("select"); });
        await settle(page);
        const lasso = [];
        for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; lasso.push([CX + 170 * Math.cos(a), CY + 120 * Math.sin(a)]); }
        const sel = await measure(page, "4 lasso", async () => {
            await page.mouse.move(lasso[0][0], lasso[0][1]); await page.mouse.down();
            for (const p of lasso.slice(1)) { await page.mouse.move(p[0], p[1]); await sleep(8); }
            await page.mouse.up();
            return { selected: await page.evaluate(() => { const s = window.__kobinEngine.selection; return s ? s.ids.length + s.frames.length : 0; }) };
        });
        // A press on selected ink: the first point of a small grid inside the loop the hit test gives a member at.
        const at = await page.evaluate(({ cx, cy }) => {
            const E = window.__kobinEngine;
            for (let r = 0; r < 120; r += 6) for (let a = 0; a < 6.28; a += 0.4) {
                const x = cx + r * Math.cos(a), y = cy + r * 0.7 * Math.sin(a);
                const id = E._hitTest(x, y, undefined, (i) => E._isSelected(i));
                if (id != null) return [x, y];
            }
            return null;
        }, { cx: CX, cy: CY });
        const drag = await measure(page, "4 drag", async () => {
            if (!at) return { dragged: false };
            await page.mouse.move(at[0], at[1]); await page.mouse.down();
            let dragged = false;
            for (let k = 1; k <= 40; k++) {
                await page.mouse.move(at[0] + 6 * k, at[1] + 3 * k); await sleep(16);
                if (k === 5) dragged = await page.evaluate(() => !!window.__kobinEngine._dragSel);
            }
            await page.mouse.up();
            return { dragged };
        });
        return [sel, drag];
    },
    penup: async (page) => [await penUp(page)],
    undo: async (page) => {
        await penUp(page);
        return [await measure(page, "6 undo", async () => {
            await page.keyboard.press("Control+z");
            return { exactMs: await untilExact(page) };
        })];
    },
    erase: async (page) => {
        await page.evaluate(placeCamera, { frame: "0", inScale: 1, x: -300, y: 200 });
        await page.evaluate(() => { const E = window.__kobinEngine; E.deselect(); E.setTool("erasePartial"); });
        await settle(page);
        return [await measure(page, "7 erase while zooming", async () => {
            await page.mouse.move(CX - 150, CY - 40); await page.mouse.down();
            for (let k = 1; k <= 40; k++) {
                await page.mouse.move(CX - 150 + 7.5 * k, CY - 40 + 2 * k); await sleep(16);
                if (k % 4 === 0) await page.mouse.wheel(0, -60);
            }
            await page.mouse.up();
            const t0 = Date.now();
            let left = 1;
            while (Date.now() - t0 < 60000) { left = await page.evaluate(() => window.__kobinEngine._eraseStrokes().length); if (!left) break; await sleep(100); }
            return { eraseBakeMs: left ? -1 : Date.now() - t0 };
        })];
    },
};

/** Scenario 5: a highlighter stroke (translucent), and the time from its pen-up to the live path's release. */
async function penUp(page) {
    await page.evaluate(placeCamera, { frame: "0", inScale: 1 });
    await page.evaluate(() => { const E = window.__kobinEngine; E.deselect(); E.setTool("pen"); E.setPenType("highlight"); E.setColor("rgb(250,214,60)"); E.setOpacity(0.45); E.setWidth(12); });
    await settle(page);
    return measure(page, "5 penup (translucent)", async () => {
        await page.mouse.move(CX - 200, CY + 60); await page.mouse.down();
        for (let k = 1; k <= 40; k++) { await page.mouse.move(CX - 200 + 10 * k, CY + 60 + 40 * Math.sin(k / 6)); await sleep(16); }
        const tUp = Date.now();
        await page.mouse.up();
        let held = true;
        while (Date.now() - tUp < 10000) { held = await page.evaluate(() => (window.__kobinEngine.renderer._liveHeld || []).length > 0); if (!held) break; await sleep(16); }
        return { liveReleaseMs: held ? -1 : Date.now() - tUp, exactMs: await untilExact(page, tUp) };
    });
}

/** From `t0` until the view draws no stale plate (today's layer), or −1 after 20 s. */
async function untilExact(page, t0 = Date.now()) {
    while (Date.now() - t0 < 20000) {
        const stale = await page.evaluate(() => {
            const L = window.__kobinEngine.renderer.layer;
            if (!L || !L._hits) return 0;
            let n = 0;
            for (let k = 0; k < L._nHits; k++) if (L._isStale(L._hits[k])) n++;
            return n;
        });
        if (!stale) return Date.now() - t0;
        await sleep(16);
    }
    return -1;
}

async function dense(browser) {
    const names = Object.keys(SCENARIOS);
    const want = SCENARIO === "all" ? names : SCENARIO.split(",").map((s) => (/^\d$/.test(s) ? names[+s - 1] : s));
    for (const name of want) {
        if (!SCENARIOS[name]) { say("unknownScenario", { name, known: names }); continue; }
        const pg = await densePage(browser);
        say("setup", { scenario: name, query: QUERY, seed: SEED, ...pg.setup });
        try {
            for (const row of await SCENARIOS[name](pg.page)) console.log(JSON.stringify(row));
        } finally {
            if (pg.errors.length || pg.consoleErrors.length) say("errors", { scenario: name, pageErrors: pg.errors.slice(0, 5), consoleErrors: pg.consoleErrors.slice(0, 5) });
            await pg.ctx.close();
        }
    }
}

async function main() {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ executablePath: EXE, headless: !HEADED, args: ["--no-sandbox"] });
    try {
        if (DENSE) await dense(browser);
        else await roundTrip(browser);
    } finally {
        await browser.close();
    }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
