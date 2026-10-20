/**
 * review1006.picture.ghost.probe.js — do PERF's "ghost" items (displaced natives whose picture-source frame the drop's
 * frame GC forgot, drawn at their stored places by `Stage._roleOf`; `review1006.perf.gcgap.probe.js`) reach plate
 * pixels? R3's whole drawing, camera and selection: a drag and its drop, then a quarter-octave zoom with no crossing (a
 * new rest set packed in the gap), every job answered; the screen assembled from the plan (A). Then a render (the
 * re-mint), every plate dropped, the same camera rendered again (B). A − B, and where. A probe, not a suite. Run:
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.picture.ghost.probe.js"
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
}
function assemble(pyr) {
    pyr.compose();
    const P = pyr.lastPlan, v = P.v, W = pyr.wDev, H = pyr.hDev, img = new Uint8ClampedArray(W * H * 4).fill(255);
    for (const d of P.draws) {
        const x0 = Math.round((d.x0 - v.ox) * v.s + v.dx), y0 = Math.round((d.y0 - v.oy) * v.s + v.dy), x1 = Math.round((d.x1 - v.ox) * v.s + v.dx), y1 = Math.round((d.y1 - v.oy) * v.s + v.dy);
        const px = d.rec && d.rec.pixels;
        for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
            const o = (y * W + x) * 4;
            if (!px) { img[o] = img[o + 1] = img[o + 2] = 255; continue; }
            const sx = Math.min(511, Math.floor(d.sx + ((x + 0.5 - x0) / (x1 - x0)) * d.sw)), sy = Math.min(511, Math.floor(d.sy + ((y + 0.5 - y0) / (y1 - y0)) * d.sh)), s = (sy * 512 + sx) * 4;
            img[o] = px[s]; img[o + 1] = px[s + 1]; img[o + 2] = px[s + 2];
        }
    }
    return { img, W, H, cls: P.cells.flatMap((c) => c.draws.map((d) => d.cls)).reduce((m, c) => { m[c] = (m[c] || 0) + 1; return m; }, {}) };
}
function png(img, W, H, file) {
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = img[s]; raw[o + 1] = img[s + 1]; raw[o + 2] = img[s + 2]; }
    const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(4); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

test("R3: ghost items in the gap between a drop's GC and the next render — in the pixels?", async () => {
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-19-33-862Z.json");
    const rep = readReportFile(f);
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    Object.defineProperty(window, "screen", { value: { width: 1920, height: 1080 }, configurable: true });
    const g = gate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1806, height: 1070, raster: true });
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.plates.phone = false; E.plates.setBudget(E.renderer.pyramid.budgetBytes()); E.renderer.pyramid._sized();
    const pyr = E.renderer.pyramid;
    E.setTool("select");
    E._render(); E.sweepFrames();
    E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    await drain(E, g);
    const sx = E.width / 2, sy = E.height / 2;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    for (let k = 1; k <= 10; k++) E._dragSelection(sx + 6 * k, sy + 4 * k);
    E._pointerUp();
    E.deselect();
    const m1 = E.store._rerouteGroups(String(E.cam.frame));
    log(`after the drop: missing sources ${m1.miss.size}; items ${E.stage.items().length}`);
    // the gap: a quarter-octave zoom about the centre (no crossing), the table's step alone, every job answered
    E.zoomFactorAt(sx, sy, 2 ** 0.25);
    await settle(E, 2); await drain(E, g);
    const ghosts = E.stage.items().filter((it) => m1.miss.has(it.id) && !it.off[0] && !it.off[1]);
    let A = assemble(pyr);
    log(`in the gap: camera ${E.cam.frame} inScale ${E.cam.inScale}; items ${E.stage.items().length}, ghost items (missing source, zero offset) ${ghosts.length}; plan ${JSON.stringify(A.cls)}; G ${E.stage.generation}`);
    {
        const sc = E.cam.inScale, px = E.cam.inPanX, py = E.cam.inPanY, all = E.stage.items();
        for (const it of ghosts) {
            const b = it.box, L = b.left * sc + px, T = b.top * sc + py, R = b.right * sc + px, Bt = b.bottom * sc + py;
            const on = R >= 0 && L <= E.width && Bt >= 0 && T <= E.height;
            if (!on) continue;
            const above = all.filter((o) => (o.z ?? o.id) > (it.z ?? it.id) && o.box && o.box.left <= b.left && o.box.right >= b.right && o.box.top <= b.top && o.box.bottom >= b.bottom).map((o) => o.id + " " + o.color);
            log(`  ghost on screen: ${it.id} ${it.type} ${it.color} op ${it.opacity} z ${it.z} key ${it.key} screen box ${JSON.stringify([L, T, R, Bt].map(Math.round))}; items above whose box covers it: ${above.length} ${JSON.stringify(above.slice(0, 4))}`);
        }
    }
    if (process.env.IDLE) {
        // Still for a while: the idle tile read (100 ms quiet, one slice an idle hop) covers the cells, the rest set
        // and the patches are asked and packed — with the table as it is in the gap (no render, so no re-mint).
        for (let k = 0; k < 12; k++) { await new Promise((r) => setTimeout(r, 80)); await settle(E, 1); await drain(E, g); }
        const m1b = E.store._rerouteGroups(String(E.cam.frame));
        A = assemble(pyr);
        log(`  after ${12 * 80} ms still: missing sources ${m1b.miss.size}; ghost items ${E.stage.items().filter((it) => m1b.miss.has(it.id) && !it.off[0] && !it.off[1]).length}; plan ${JSON.stringify(A.cls)}; G ${E.stage.generation}; tileReads ${E.stage.stats.reads}`);
    }
    // the re-mint, then the same camera from nothing
    E._render();
    const m2 = E.store._rerouteGroups(String(E.cam.frame));
    log(`after the render: missing sources ${m2.miss.size}; items ${E.stage.items().length}; G ${E.stage.generation}; plates exact after it: ${[...E.plates.records()].filter((r) => E.plates.exact(r)).length}/${E.plates.cache.size}`);
    await settle(E, 1); await drain(E, g);
    const Akept = assemble(pyr);
    E.plates.dropAll(); pyr._rest = null; pyr._standIn = null; pyr._asked.clear();
    await settle(E, 2); await drain(E, g);
    const B = assemble(pyr);
    let diff = 0, diffKept = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const D = new Uint8ClampedArray(A.img.length).fill(255);
    for (let k = 0; k < A.img.length; k += 4) {
        const d = Math.abs(A.img[k] - B.img[k]) + Math.abs(A.img[k + 1] - B.img[k + 1]) + Math.abs(A.img[k + 2] - B.img[k + 2]);
        const dk = Math.abs(Akept.img[k] - B.img[k]) + Math.abs(Akept.img[k + 1] - B.img[k + 1]) + Math.abs(Akept.img[k + 2] - B.img[k + 2]);
        if (dk > 24) diffKept++;
        if (d > 24) {
            diff++; const p = k / 4, x = p % A.W, y = Math.floor(p / A.W);
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            D[k] = A.img[k]; D[k + 1] = A.img[k + 1]; D[k + 2] = A.img[k + 2];
        }
    }
    log(`A (the gap's picture) vs B (re-minted, rendered from nothing): ${diff} device px differ by > 24 (${(100 * diff / (A.W * A.H)).toFixed(3)} % of the screen), box ${diff ? JSON.stringify([x0, y0, x1, y1]) : "-"}; the gap's plates still on screen after the re-mint render vs B: ${diffKept} px`);
    log(`B's plan ${JSON.stringify(B.cls)}`);
    fs.mkdirSync(OUT, { recursive: true });
    const sfx = process.env.IDLE ? "-idle" : "";
    if (diff) { png(D, A.W, A.H, path.join(OUT, "ghost-diff-r3" + sfx + ".png")); png(A.img, A.W, A.H, path.join(OUT, "ghost-gap-r3" + sfx + ".png")); png(B.img, B.W, B.H, path.join(OUT, "ghost-truth-r3.png")); }
    E.destroy();
});
