#!/usr/bin/env node
/**
 * browser-check.js — drive the app in a real Chromium through Playwright and print the engine's
 * own numbers: draw three strokes, zoom out 40 wheel ticks, zoom back, screenshot each state and
 * count the ink pixels of the composed canvas before and after the round trip. Rule 3 of
 * docs/ai/00-START-HERE.txt: paint is measured in a browser, never by rasterising the SVG.
 *
 *   node tools/harnesses/browser-check.js [url] [--out <dir>] [--headed]
 *
 * Needs a dev server (`npm start`, on Node 14: CRA 4 does not start on Node 17+) and Playwright
 * with a Chromium. In the Claude cloud container both are preinstalled (Playwright at
 * /opt/node22/lib/node_modules/playwright, Chromium at /opt/pw-browsers/chromium) and this runs
 * under Node 22. Headless Chromium draws with software GL, so it cannot see the compositor's own
 * costs (the 33-image cliff, GPU texture uploads); the scripting numbers and the pixels are real.
 * Output: one JSON object per state on stdout, screenshots under --out (default tools/.cache/browser-check).
 */
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
    for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright", "/usr/lib/node_modules/playwright"]) {
        try { return require(p); } catch (e) { /* next */ }
    }
    throw new Error("playwright not found: npm i -g playwright && npx playwright install chromium");
}

const argv = process.argv.slice(2);
const BASE = argv.find((a) => /^https?:/.test(a)) || "http://localhost:3000";
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : path.join(__dirname, "..", ".cache", "browser-check");
const HEADED = argv.includes("--headed");
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
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
        picture: pick(pl, ["mode", "quantumChanges", "holds", "holdBreaks", "heldComposes", "previews", "previewHits", "paperComposes", "paperCellsMax", "carryComposes", "fallbackComposes", "staleComposes", "uncovered", "screenCovered", "composes"]),
        plates: pick(ps, ["plates", "plateBytes", "maxBytes", "evictions", "overCapPinned", "stale", "epochBumps", "abandons"]),
        longFrames: lf ? { count: lf.count, totalMs: lf.totalMs, worst: (lf.worst || []).slice(0, 3).map((w) => ({ ms: Math.round(w.ms), script: Math.round(w.scriptMs || 0), fn: (w.scripts || []).map((s) => s.fn + "@" + s.src).join(" ") })) } : null,
        ink,
    };
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: EXE, headless: !HEADED, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], consoleErrors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    const t0 = Date.now();
    await page.goto(`${BASE}/#/canvas/new?dev`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__kobinEngine && !!document.querySelector("canvas.bl-ink"), null, { timeout: 60000 });
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
    await browser.close();
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
