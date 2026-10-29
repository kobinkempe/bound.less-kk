/**
 * review1006.picture.truth.probe.js — the picture a report's camera should show, rendered by the shipped rasteriser in
 * jsdom: the report's extract (or WHOLE=1 drawing) in a raster engine, every job answered through the worker entry until
 * idle, then the screen assembled from the plan's draws (σ = 1 at rest). Writes a half-size PNG and prints the colour
 * histogram. ZOOMS="-2,-4" also renders the same centre that many octaves out (a coarser level's picture of the spot,
 * magnified back to the screen) — what a coarse stand-in would show. A probe, not a suite. Run:
 *   REPORT=report-2026-10-07T03-39-00-036Z.json CI=true NODE_OPTIONS=--max-old-space-size=8192 \
 *   npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.truth.probe.js"
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./raster/rasterWorkerClient";
import { runJob } from "./worker/rasterWorker";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(60 * 60 * 1000);
const OUT = path.join(__dirname, "..", "..", ".claude", "REVIEW-2026-10-06", "picture");
const tick = () => new Promise((r) => setTimeout(r, 0));

function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return { parked, async answer() { while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); } for (let t = 0; t < 6; t++) await tick(); } };
}
async function settle(E, n = 2) { for (let k = 0; k < n; k++) { E.renderer.syncCameraOnly(); for (let m = 0; m < 4; m++) await tick(); } }
async function drain(E, g) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    for (let k = 0; k < 300 && busy(); k++) { await g.answer(); await settle(E, 1); }
    await new Promise((r) => setTimeout(r, 150)); await settle(E, 3);
    for (let k = 0; k < 300 && busy(); k++) { await g.answer(); await settle(E, 1); }
}

/** The screen (device px) assembled from the last plan: every draw nearest-sampled from its record's pixels. */
function assemble(pyr) {
    const P = pyr.lastPlan, v = P.v, W = pyr.wDev, H = pyr.hDev;
    const img = new Uint8ClampedArray(W * H * 4).fill(255);
    const paperOf = { n: 0 };
    for (const d of P.draws) {
        const x0 = Math.round((d.x0 - v.ox) * v.s + v.dx), y0 = Math.round((d.y0 - v.oy) * v.s + v.dy);
        const x1 = Math.round((d.x1 - v.ox) * v.s + v.dx), y1 = Math.round((d.y1 - v.oy) * v.s + v.dy);
        const px = d.rec && d.rec.pixels;
        for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
            for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
                const o = (y * W + x) * 4;
                if (!px) { img[o] = img[o + 1] = img[o + 2] = 255; img[o + 3] = 255; paperOf.n++; continue; }
                const sx = Math.min(511, Math.floor(d.sx + ((x + 0.5 - x0) / (x1 - x0)) * d.sw)), sy = Math.min(511, Math.floor(d.sy + ((y + 0.5 - y0) / (y1 - y0)) * d.sh));
                const s = (sy * 512 + sx) * 4;
                img[o] = px[s]; img[o + 1] = px[s + 1]; img[o + 2] = px[s + 2]; img[o + 3] = 255;
            }
        }
    }
    return { img, W, H, classes: P.cells.flatMap((c) => c.draws.map((d) => d.cls)) };
}
function histogram(img, W, H, top = 8) {
    const m = new Map();
    for (let k = 0; k < W * H * 4; k += 16) {          // every 4th pixel
        const key = "#" + [img[k], img[k + 1], img[k + 2]].map((c) => ((c >> 3) << 3).toString(16).padStart(2, "0")).join("");
        m.set(key, (m.get(key) || 0) + 1);
    }
    const n = (W * H) / 4;
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, c]) => k + " " + (100 * c / n).toFixed(1) + "%");
}
function png(img, W, H, file, step = 2) {
    const w = Math.floor(W / step), h = Math.floor(H / step), raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const s = ((y * step) * W + x * step) * 4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = img[s]; raw[o + 1] = img[s + 1]; raw[o + 2] = img[s + 2]; } }
    const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("the picture a report's camera should show", async () => {
    const name = process.env.REPORT || "report-2026-10-07T03-39-00-036Z.json";
    const f = path.join(REPORT_DIR, name);
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    Object.defineProperty(window, "screen", { value: { width: 1920, height: 1080 }, configurable: true });
    const g = gate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scr = rep.extract.screen;
    const E = new KobinEngine(host, { width: scr.w, height: scr.h, raster: true });
    loadReport(E, rep, { drawing: process.env.WHOLE ? drawingPartsOf(f) : null });
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    E.setTool("select");
    E._render();
    await drain(E, g);
    const pyr = E.renderer.pyramid, tag = name.replace(/^report-|\.json$/g, "").slice(11);
    pyr.compose();
    const a = assemble(pyr);
    const cls = {}; for (const c of a.classes) cls[c] = (cls[c] || 0) + 1;
    log(`${name} at its camera (${E.cam.frame.slice(-30)}, inScale ${E.cam.inScale}): view ${pyr.lastPlan.v.mode} ℓ${pyr.lastPlan.v.level} images ${pyr.lastPlan.images}, draws ${JSON.stringify(cls)}; colours ${JSON.stringify(histogram(a.img, a.W, a.H))}`);
    fs.mkdirSync(OUT, { recursive: true });
    png(a.img, a.W, a.H, path.join(OUT, "truth-" + tag + ".png"));
    const cx = scr.w / 2, cy = scr.h / 2;
    for (const z of (process.env.ZOOMS || "").split(",").filter(Boolean).map(Number)) {
        E.zoomFactorAt(cx, cy, 2 ** z);
        await settle(E, 2); await drain(E, g);
        pyr.compose();
        const b = assemble(pyr);
        log(`  zoomed ${z} octaves (inScale ${E.cam.inScale.toPrecision(4)}, frame …${E.cam.frame.slice(-20)}): colours ${JSON.stringify(histogram(b.img, b.W, b.H))}`);
        // the centre of that view, magnified back to the screen: what a coarse stand-in of level ℓ + z would show
        const k = 2 ** -z, W = b.W, H = b.H, mag = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const sx = Math.floor(W / 2 + (x - W / 2) / k), sy = Math.floor(H / 2 + (y - H / 2) / k), s = (sy * W + sx) * 4, o = (y * W + x) * 4;
            mag[o] = b.img[s]; mag[o + 1] = b.img[s + 1]; mag[o + 2] = b.img[s + 2]; mag[o + 3] = 255;
        }
        log(`    its centre magnified ${k}x to the screen: colours ${JSON.stringify(histogram(mag, W, H))}`);
        png(mag, W, H, path.join(OUT, "standin-" + tag + "-z" + z + ".png"));
        E.zoomFactorAt(cx, cy, 2 ** -z);
        await settle(E, 2);
    }
    E.destroy();
});
