/**
 * firstView.test.js — the first-view pictures (OPEN-FLAGS F166): a level key read back, a set packed and unpacked whole
 * (and refused when it does not read whole), the capture's order and cap, and a second engine with the same document
 * seeded from the first's set: the view's cells are restored, not packed, and each draws its cell's truth; a cell a
 * commit after the load touched is never taken from the set.
 */
import KobinEngine from "../KobinEngine";
import { resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";
import { captureFirstView, encodeFirstView, decodeFirstView, parseLevelKey, captureSig } from "./firstView";
import { RANK } from "./PyramidStore";
import { rasterStats, resetRasterStats } from "./RasterRenderer";
import { levelKey } from "./level";
import { packJob } from "./rasterPack";
import { renderPlate } from "./rasterCore";
import { PLATE_PX } from "./plate";
import { rectLoop } from "../geometry/arcShape";

jest.setTimeout(120000);

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = (E) => { const r = E.renderer.queue.report(); return !r.queued.some((n) => n) && !r.inFlight.some((n) => n); };
async function flush(E, rounds = 80) { for (let k = 0; k < rounds && !(k > 0 && idle(E)); k++) await sleep(0); }
async function settle(E) { for (let k = 0; k < 6; k++) { await flush(E); await sleep(40); E.renderer.syncCameraOnly(); } await flush(E); }

/** The same document in any engine: the camera at depth 1, squares in its frame, a huge one a frame up. */
function scene(E) {
    E.lm.ensureSpine(3);
    const F = E.lm.spineAt(1), P = E.lm.frame(F).parent;
    E.cam.set({ activeLevel: 1, frame: F, inScale: 1, inPanX: 400, inPanY: 300 });
    const add = (frame, r, color) => E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), color, opacity: 1, loops: rectLoop(r) }, frame);
    add(P, E.lm.mapRectF({ left: -300, top: -60000, right: 60000, bottom: 60000 }, F, P), "rgb(40,90,160)");
    add(F, { left: -200, top: -150, right: -40, bottom: 20 }, "rgb(200,40,40)");
    add(F, { left: 120, top: -200, right: 260, bottom: -80 }, "rgb(220,200,30)");
    add(F, { left: -20, top: 60, right: 300, bottom: 140 }, "rgb(30,150,60)");
    return { F: String(F) };
}

/** An empty plate: the paper. */
function paper(E) {
    const c = E.renderer._paperRgb, out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    for (let p = 0; p < out.length; p += 4) { out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255; }
    return out;
}
/** Cell `r` rendered from a fresh snapshot of its frame (the prefetch's off-camera path): RGBA, or null. */
function truth(E, r) {
    const u = PLATE_PX / r.Z, rect = { left: r.i * u, top: r.j * u, right: (r.i + 1) * u, bottom: (r.j + 1) * u };
    const snap = E.stage.snapshot(r.frame, rect);
    if (!snap) return null;
    const R0 = E.renderer, list = snap.items().filter((it) => !it.pending);
    const packed = packJob(list, { plates: Int32Array.of(r.i, r.j), Zq: r.Z, dpr: R0.pyramid.dpr, cfg: R0.cfg, paper: R0._paperRgb, G: snap.generation });
    if (!(packed.nItems > 0)) return paper(E);
    const out = new Uint8ClampedArray(PLATE_PX * PLATE_PX * 4);
    renderPlate(packed, 0, out, new Uint32Array(8));
    return out;
}
const differs = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) n++; return n; };

describe("the first-view pictures (F166)", () => {
    test("FV-1 a level key reads back; anything else is null", () => {
        for (const [F, l, S, i, j] of [["0", 3, 1, 0, 0], ["-3/12,-4#2", -7, 2, -5, 9], ["1/0,0/3,-2", 0, 3, 2047, -2048]]) {
            expect(parseLevelKey(levelKey(F, l, S, i, j))).toEqual({ F, l, S, i, j });
        }
        for (const k of ["", "0|R1|0,0", "0|L1s1|0", "0|L1s1|0,0,", "|L1s1|0,0", "0|L1.5s1|0,0", null]) expect(parseLevelKey(k)).toBeNull();
    });

    test("FV-2 a set packs into parts and unpacks whole; a part that does not read whole refuses the set", () => {
        const rnd = (n, seed) => { const w = new Uint32Array(n); let a = seed; for (let k = 0; k < n; k++) { a = (a * 1103515245 + 12345) >>> 0; w[k] = a; } return w.buffer; };
        const cells = [];
        for (let k = 0; k < 40; k++) cells.push({ key: levelKey("2/1,-1", -k % 9, 1, k, -k), words: k % 7 === 3 ? null : rnd(50 + k * 37, k + 1) });
        const parts = encodeFirstView(cells, 16 * 1024);
        expect(parts.length).toBeGreaterThan(2);
        for (const p of parts) expect(p.byteLength).toBeLessThanOrEqual(16 * 1024);
        const back = decodeFirstView(parts);
        expect(back.map((c) => c.key)).toEqual(cells.map((c) => c.key));
        back.forEach((c, k) => {
            expect(c.kind).toBe("level");
            if (!cells[k].words) expect(c.packed).toBeNull();
            else expect(Array.from(new Uint32Array(c.packed))).toEqual(Array.from(new Uint32Array(cells[k].words)));
        });
        expect(captureSig(back)).toBe(captureSig(cells.slice().reverse()));     // the signature ignores order
        const cut = parts.map((p) => p.slice());
        expect(decodeFirstView([...cut.slice(0, 1), cut[1].slice(0, cut[1].length - 4)])).toBeNull();   // a short part
        cut[0][0] ^= 1;
        expect(decodeFirstView(cut)).toBeNull();                                  // not a set
    });

    test("FV-3 the capture: the view's cells first, then the far levels nearest first; exact plates only, under the cap", async () => {
        const E = mkEngine();
        scene(E);
        E._render(); await settle(E);
        const st = E.plates, v = st.view;
        const cap = captureFirstView(st, 64 << 20);
        expect(cap.cells.length).toBeGreaterThan(4);
        const rank = (key) => { const r = st.get(key) || st.ram.get(key); return st.rankOf({ ...r }); };
        const ranks = cap.cells.map((c) => rank(c.key));
        const order = [RANK.RING, RANK.FAR, RANK.NEAR, RANK.LEVELS];
        for (let k = 1; k < ranks.length; k++) expect(order.indexOf(ranks[k])).toBeGreaterThanOrEqual(order.indexOf(ranks[k - 1]));
        expect(ranks[0]).toBe(RANK.RING);
        expect(ranks).toContain(RANK.FAR);
        const far = cap.cells.filter((c, k) => ranks[k] === RANK.FAR).map((c) => parseLevelKey(c.key).l - (v.path.get(parseLevelKey(c.key).F) || 0));
        for (let k = 1; k < far.length; k++) expect(far[k]).toBeLessThanOrEqual(far[k - 1]);
        for (const c of cap.cells) { const r = st.get(c.key) || st.ram.get(c.key); expect(r.G >= st.fresh.dirtySince(c.key)).toBe(true); }
        const small = captureFirstView(st, Math.floor(cap.bytes / 3));
        expect(small.bytes).toBeLessThanOrEqual(Math.floor(cap.bytes / 3));
        expect(small.cells.map((c) => c.key)).toEqual(cap.cells.slice(0, small.cells.length).map((c) => c.key));
    });

    test("FV-4 a second engine seeded with the set restores the view's cells, each its cell's truth; a cell changed after the load is not taken", async () => {
        const A = mkEngine();
        scene(A);
        A._render(); await settle(A);
        const set = decodeFirstView(encodeFirstView(captureFirstView(A.plates, 64 << 20).cells));
        const viewKeys = new Set([...A.plates.records()].filter((r) => A.plates.rankOf(r) === RANK.RING).map((r) => r.key));
        expect(viewKeys.size).toBeGreaterThan(0);

        const B = mkEngine();
        const { F } = scene(B);
        const G = B.stage.generation;
        // A commit after the load, over one of the view's cells: that cell's picture is out of date.
        const hit = [...viewKeys].map(parseLevelKey).find((k) => k.F === F);
        const u = PLATE_PX / 2 ** (hit.l * hit.S);
        B.doc.add({ type: "shape", origin: "native", id: B.doc.allocId(), color: "rgb(0,0,0)", opacity: 1,
            loops: rectLoop({ left: hit.i * u + u / 3, top: hit.j * u + u / 3, right: hit.i * u + u / 2, bottom: hit.j * u + u / 2 }) }, B.cam.frame);
        const hitKey = levelKey(hit.F, hit.l, hit.S, hit.i, hit.j);
        resetRasterStats();
        expect(B.renderer.firstViewSeed(set, G, false)).toBe(set.length);
        expect(B.plates.restorable(hitKey)).toBeNull();
        B._render(); await settle(B);
        expect(rasterStats.ramRestores).toBeGreaterThanOrEqual(viewKeys.size - 1);
        let checked = 0;
        for (const key of viewKeys) {
            const r = B.plates.get(key);
            expect(r && B.plates.exact(r)).toBe(true);
            if (key === hitKey) { expect(r.G).toBeGreaterThan(G); continue; }   // packed again, after the commit
            expect(r.G).toBe(G);                                                  // the picture, restored
            expect(differs(r.pixels || paper(B), truth(B, r))).toBe(0);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });
});
