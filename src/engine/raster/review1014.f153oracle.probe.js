/**
 * review1014.f153oracle.probe.js — why a far-out plate (Z 2^-7) differs from its cell rendered from a snapshot: seed 41 of
 * raster.dropdirt D5, after the scene settles. Per mismatched record: which items each route packs into the cell.
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/review1014.f153oracle.probe.js"
 */
import KobinEngine from "../KobinEngine";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { PLATE_PX } from "./plate";
import { rectLoop, normalizeLoops } from "../geometry/arcShape";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(300000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = (E) => { const r = E.renderer.queue.report(); return !r.queued.some((n) => n) && !r.inFlight.some((n) => n); };
async function flush(E, rounds = 80) { for (let k = 0; k < rounds && !(k > 0 && idle(E)); k++) await sleep(0); }
async function settle(E) { for (let k = 0; k < 4; k++) { await flush(E); await sleep(40); E.renderer.syncCameraOnly(); } await flush(E); }
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function addShape(E, frame, loops, color) { const o = { type: "shape", origin: "native", id: E.doc.allocId(), color, opacity: 1, loops }; E.doc.add(o, frame); return o; }
function addFill(E, frame, ring, color) { const o = { type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1, polys: [ring] }; E.doc.add(o, frame); return o; }
function disc(cx, cy, r) {
    return normalizeLoops([[
        { line: false, C: [cx, cy], r, a0: 0, sweep: Math.PI, A: [cx + r, cy], B: [cx - r, cy] },
        { line: false, C: [cx, cy], r, a0: Math.PI, sweep: Math.PI, A: [cx - r, cy], B: [cx + r, cy] },
    ]]);
}
const cellRect = (r) => { const u = PLATE_PX / r.Z; return { left: r.i * u, top: r.j * u, right: (r.i + 1) * u, bottom: (r.j + 1) * u }; };

test("oracle vs plate at Z 2^-7", async () => {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    const host = document.createElement("div"); document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    const seed = +(process.env.SEED || 41), kinds = ["plane", "plane+mid", "view"];
    const kind = kinds[Math.floor(rng(seed * 7919)() * 3)];
    if (kind === "view") E.renderer.forcePerStepDrag = true;
    E.lm.ensureSpine(3);
    const F = E.lm.spineAt(1), P = E.lm.frame(F).parent;
    E.cam.set({ activeLevel: 1, frame: F, inScale: 1, inPanX: 400, inPanY: 300 });
    const rnd = rng(seed), natives = [];
    const col = () => `rgb(${(rnd() * 220) | 0},${(rnd() * 220) | 0},${(rnd() * 220) | 0})`;
    const at = (w) => { const x = (rnd() - 0.5) * 900, y = (rnd() - 0.5) * 700; return { left: x, top: y, right: x + w * (0.5 + rnd()), bottom: y + w * (0.5 + rnd()) }; };
    for (let k = 0; k < 2; k++) {
        const x = (rnd() - 0.5) * 700, y = (rnd() - 0.5) * 500, s = rnd() < 0.5 ? 1 : -1;
        const r = s > 0 ? { left: x, top: y, right: x + 80000, bottom: y + 80000 } : { left: x - 80000, top: y - 80000, right: x, bottom: y };
        natives.push(addShape(E, P, rectLoop(E.lm.mapRectF(r, F, P)), col()));
    }
    for (let k = 0; k < 7; k++) {
        const r = at(40 + rnd() * 300);
        if (rnd() < 0.4) natives.push(addShape(E, F, disc((r.left + r.right) / 2, (r.top + r.bottom) / 2, (r.right - r.left) / 2), col()));
        else if (rnd() < 0.5) natives.push(addFill(E, F, [[r.left, r.top], [r.right, r.top + 10], [r.right - 15, r.bottom], [r.left + 5, r.bottom - 20]], col()));
        else natives.push(addShape(E, F, rectLoop(r), col()));
    }
    for (let k = 0; k < 2; k++) {
        const K = E.lm.cellChild(F, Math.round((rnd() - 0.5) * 20), Math.round((rnd() - 0.5) * 16));
        const c = E.lm.mapPointF([0, 0], K.id, F);
        natives.push(addShape(E, K.id, rectLoop(E.lm.mapRectF({ left: c[0] - 12, top: c[1] - 12, right: c[0] + 12, bottom: c[1] + 12 }, F, K.id)), col()));
    }
    const R0 = E.renderer, made = new Map();
    const pack0 = R0._pyrPack.bind(R0);
    R0._pyrPack = (job, jobId, pool) => {
        const out = pack0(job, jobId, pool);
        const t = job.table, rr = t && t.rect ? t.rect : null;
        for (const c of job.packedCells || job.cells) made.set(c.key, `${job.purpose || job.kind} ${t ? "table " + (rr ? [rr.left, rr.top, rr.right, rr.bottom].map((v) => Math.round(v)).join(",") : "?") : "scene"} G${t ? t.generation : E.stage.generation}`);
        return out;
    };
    E._render(); await settle(E);
    if (process.env.DROP) {
        const ids = natives.filter(() => rnd() < 0.35).map((o) => o.id);
        if (!ids.length) ids.push(natives[0].id);
        E.setTool("select"); E._setSelection(ids, []); E._render();
        await sleep(200);
        for (let t = 0; t < 3000 && !R0.forcePerStepDrag && (R0._planeTimer != null || !R0._plane.tags.length); t += 10) await sleep(10);
        await settle(E);
        const big = rnd() < 0.3, dx = (rnd() - 0.5) * (big ? 900 : 160), dy = (rnd() - 0.5) * (big ? 700 : 120);
        E._dragSel = { start: [400, 300], moved: false }; E._beginHold(); await flush(E);
        for (let k = 1; k <= 8; k++) {
            E._dragSelection(400 + (dx * k) / 8, 300 + (dy * k) / 8);
            if (kind === "plane+mid" && k === 4) { E.plates.dropFrames((f) => String(f) === String(F)); E._render(); await settle(E); }
        }
        E._pointerUp();
        await settle(E);
        log(`seed ${seed} ${kind}: moved ${ids.join(",")} by ${dx.toFixed(1)},${dy.toFixed(1)}; G ${E.stage.generation}`);
        for (const id of ids) { const rec = E.doc.getById(id); log(`   ${id} home ${rec.level} below ${JSON.stringify(rec.obj.below || null)}`); }
    }
    const render = (list, r) => {
        const packed = packJob(list, { plates: Int32Array.of(r.i, r.j), Zq: r.Z, dpr: R0.pyramid.dpr, cfg: R0.cfg, paper: R0._paperRgb, G: E.stage.generation });
        const out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
        if (packed.nItems > 0) renderPlate(packed, 0, out, new Uint32Array(8));
        else for (let p = 0; p < out.length; p += 4) { out[p] = R0._paperRgb[0]; out[p + 1] = R0._paperRgb[1]; out[p + 2] = R0._paperRgb[2]; out[p + 3] = 255; }
        return { out, n: packed.nItems };
    };
    const diffs = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) n++; return n; };
    const inCell = (list, r) => {
        const c = cellRect(r), out = [];
        for (const it of list) {
            const b = it.box, o = it.off;
            if (b.right + o[0] < c.left || b.left + o[0] > c.right || b.bottom + o[1] < c.top || b.top + o[1] > c.bottom) continue;
            out.push(`${it.id}:${it.key}`);
        }
        return out.sort();
    };
    for (const r of E.plates.records()) {
        if (r.kind !== "level" || r.level !== -7 || !E.plates.exact(r)) continue;
        const px = r.pixels;
        const snapCell = E.stage.snapshot(r.frame, cellRect(r));
        const a = render(snapCell.items(), r);
        const scene = R0._sceneList();
        const b = render(scene, r);
        const big = E.stage.snapshot(r.frame, { left: -200000, top: -200000, right: 200000, bottom: 200000 });
        const c = big ? render(big.items(), r) : null;
        log(`rec ${r.key} G${r.G} made by ${made.get(r.key)}: px ${px ? "yes" : "empty"}; vs cell-snapshot ${diffs(px || a.out, a.out)} (items ${a.n}), vs scene list ${diffs(px || a.out, b.out)} (items ${b.n}), vs big snapshot ${c ? diffs(px || a.out, c.out) : "-"} (items ${c ? c.n : "-"})`);
        log(`   cell-snapshot items: ${inCell(snapCell.items(), r).join(" ")}`);
        log(`   scene items:         ${inCell(scene, r).join(" ")}`);
        if (big) log(`   big items:           ${inCell(big.items(), r).join(" ")}`);
    }
    E.destroy(); host.remove();
});
