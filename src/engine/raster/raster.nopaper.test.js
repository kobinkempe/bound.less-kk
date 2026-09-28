/**
 * raster.nopaper.test.js — PAPER-PLAN §10.13, Kobin 2026-09-23: "I'd rather see blurry images than
 * paper." Paper is what nothing has EVER shown: the last composed picture is carried under every
 * compose that would otherwise leave a cell uncovered (`PictureLayer._drawCarry`), the ladder's first
 * rung is a base no eviction and no hidden-tab release takes (`PlateStore._base`), a return to the tab
 * re-renders and rebuilds the ladder, and a frame re-addressed no longer wipes the cache (`_refilePlates`).
 *
 * jsdom has no canvas: the layer counts paper from its own coverage (`uncoveredCells`), which is what
 * these tests read. What it looks like is measured in Kobin's Chrome (PAPER-PLAN §10.13).
 */
import KobinEngine from "../KobinEngine";
import { pictureStats } from "./PictureLayer";
import { plateKey, PLATE_PX } from "./plate";
import PlateStore, { PLATE_BYTES } from "./PlateStore";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./rasterWorkerClient";
import { softCtx } from "../__testkit__/softCanvas";

const engines = [];
function mkEngine(w = 800, h = 600) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    E.renderer.layer.syncBudget = 0;                   // the plates path
    E.renderer.layer._sync = false;
    // A context that takes the carry's calls (jsdom's `getContext` is null): coverage is the measure.
    const L = E.renderer.layer;
    L._ctx = {
        calls: [], fillStyle: null, imageSmoothingEnabled: null, globalCompositeOperation: "source-over",
        setTransform() {}, save() {}, restore() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {},
        fillRect(...a) { this.calls.push(["fill", ...a]); }, drawImage(src, ...a) { this.calls.push(["draw", src === L._canvas ? "self" : "plate", ...a]); },
    };
    // Plates carry a bitmap object, so the layer draws them (the inline worker hands raw pixels).
    const put = E.plates.put.bind(E.plates);
    E.plates.put = (rec) => { if (rec.pixels && !rec.bitmap) rec.bitmap = { pixels: rec.pixels }; return put(rec); };
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });
afterEach(() => {
    setRasterTransport(null);
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});
async function flush(rounds = 40) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return k + 1;
    }
    return rounds;
}
const idle = () => new Promise((r) => setTimeout(r, 40));
const fill = (E, x, y, w, h, color) => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]] }, "0");
/** A drawing that reaches past the screen on every side, so a pan or a zoom-out meets ink everywhere. */
function drawing(E) {
    for (let k = 0; k < 9; k++) fill(E, -3000 + (k % 3) * 2200, -3000 + Math.floor(k / 3) * 2200, 1800, 1800, "rgb(" + (40 + k * 20) + ",90,160)");
    fill(E, 300, 200, 200, 200, "rgb(200,30,30)");
}
/** Every job parks for ever from here: no plate lands, and the picture has only what it already has. */
function stallWorkers() { setRasterTransport(() => new Promise(() => {})); }
const paperNow = (E) => E.renderer.layer.uncoveredCells();

describe("no paper where anything was ever shown (PAPER-PLAN §10.13)", () => {
    test("N1 every plate removed under a still camera: the next compose carries the last picture, no paper", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        const L = E.renderer.layer;
        E.renderer.syncCameraOnly();
        expect(paperNow(E)).toBe(0);
        const carry0 = pictureStats.carryComposes;
        E.plates.dropAll(false);                           // what a frame event, a cap or a release can do
        L._ctx.calls.length = 0;
        E.renderer.syncCameraOnly();
        expect(pictureStats.carryComposes).toBe(carry0 + 1);
        expect(paperNow(E)).toBe(0);                       // red without the carry: every cell paper
        expect(L._ctx.calls.filter((c) => c[0] === "fill").length).toBe(0);   // no paper goes over it
    });

    test("N2 with the workers stalled: a fast zoom-in, a pan inside the base and a zoom-out inside it show no paper at any step", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
        await flush();
        expect(E.plates._base.size).toBeGreaterThan(0);    // the first rung is the base
        stallWorkers();
        const cam0 = E.cam.state();
        const paper = [];
        for (let k = 0; k < 24; k++) { E.zoomAt(400, 300, -250); paper.push(paperNow(E)); }       // six octaves in, one quantum a tick
        E.cam.set(cam0); E._render();
        for (let k = 0; k < 20; k++) { E.panBy(30, 12); paper.push(paperNow(E)); }                // 600 × 240 px of pan
        E.cam.set(cam0); E._render();
        for (let k = 0; k < 8; k++) { E.zoomAt(400, 300, 250); paper.push(paperNow(E)); }         // two octaves out
        expect(paper.filter((u) => u > 0)).toEqual([]);   // red without the carry (zoom-in) and without the base (pan, zoom-out)
    });

    test("N8 from four levels down, a 40-octave zoom-out with the workers stalled shows no paper: the far rungs (PAPER-PLAN §10.18)", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        let guard = 0;
        while (E.cam.activeLevel < 4 && guard++ < 400) E.zoomAt(400, 300, -1000);
        expect(E.cam.activeLevel).toBeGreaterThanOrEqual(4);
        E._render(); await flush();
        E.plates.phone = false;                            // the desktop's rungs (a phone builds three)
        E.ladderFar = true;                                // the far rungs are off in the app until they are sliced
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 60 && E._ladderBusy; k++) { await idle(); await flush(); }
        await flush();
        stallWorkers();
        const paper = [];
        for (let k = 0; k < 160; k++) { E.zoomAt(400, 300, 250); paper.push(paperNow(E)); }       // forty octaves out
        // 80 of 160 steps paper with the rungs ending at 2^22; three remain at the crossing into the root (§10.18, open).
        expect(paper.filter((u) => u > 0).length).toBeLessThanOrEqual(3);
    });

    test("N9 the ladder's rungs are idle callbacks with no forced timeout (a rung is one long list build)", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        const had = window.requestIdleCallback;
        const calls = [];
        window.requestIdleCallback = (fn, opts) => { calls.push(opts); return setTimeout(fn, 0); };
        try {
            E._lastCamMove = -1e9; E._ladderAt = null;
            E._buildLadder();
            for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
            expect(calls.length).toBeGreaterThan(0);
            expect(calls.every((o) => o === undefined || o.timeout === undefined)).toBe(true);
        } finally { window.requestIdleCallback = had; }
    });

    test("N10 no rung runs while a report is sending; the ladder resumes after it (report 2026-09-24T04-06-17)", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        const lists = jest.spyOn(E, "listFor");
        E._reportBusy = true;
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 5; k++) await idle();
        expect(lists).not.toHaveBeenCalled();
        E._reportBusy = false;
        for (let k = 0; k < 40 && (E._ladderBusy || !lists.mock.calls.length); k++) await idle();
        expect(lists).toHaveBeenCalled();
    });

    test("N3 a hidden tab's release keeps the base; the return re-renders, carries the last picture and rebuilds the ladder", async () => {
        const E = mkEngine();
        E.plates.phone = true;                             // a phone releases at once (a desktop after HIDDEN_RELEASE_MS: N11)
        drawing(E);
        E._render(); await flush();
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
        await flush();
        const base = [...E.plates._base];
        expect(base.length).toBeGreaterThan(0);
        let vis = "hidden";
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(base.every((k) => E.plates.get(k))).toBe(true);   // the base survives the release
        expect(E.plates.size()).toBe(base.length);
        stallWorkers();
        const renders = jest.spyOn(E, "_render");
        vis = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.visibilityState;
        expect(renders).toHaveBeenCalledTimes(1);
        expect(E._ladderAt).not.toBe(E._ladderKey());      // rebuilt at the next quiet
        expect(paperNow(E)).toBe(0);                       // the last picture, carried
    });

    test("N11 on a desktop a short hide keeps every plate and rebuilds nothing; a long one releases (report 2026-09-24T04-06-17)", async () => {
        const E = mkEngine();
        E.plates.phone = false;                            // the desktop budget (jsdom's small window picks the phone's)
        drawing(E);
        E._render(); await flush();
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
        await flush();
        const plates = E.plates.size(), at = E._ladderAt;
        expect(plates).toBeGreaterThan(0);
        let vis = "hidden";
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
        const renders = jest.spyOn(E, "_render");
        try {
            document.dispatchEvent(new Event("visibilitychange"));
            expect(E.plates.size()).toBe(plates);                 // red: released the whole cache on hide
            vis = "visible";
            document.dispatchEvent(new Event("visibilitychange"));
            expect(renders).not.toHaveBeenCalled();
            expect(E._ladderAt).toBe(at);                          // red: every rung rebuilt on show
            E.plates.hiddenReleaseMs = 10;
            vis = "hidden";
            document.dispatchEvent(new Event("visibilitychange"));
            await idle();
            expect(E.plates.size()).toBeLessThan(plates);         // a long hide still frees the plates
            vis = "visible";
            document.dispatchEvent(new Event("visibilitychange"));
            expect(renders).toHaveBeenCalled();                    // and the return rebuilds
        } finally { delete document.visibilityState; }
    });

    test("N12 a rung over its budget ends this view's ladder there; the per-view rebuild does not run it again", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        E.ladderRungBudgetMs = -1;                              // every rung is over budget
        const lists = jest.spyOn(E, "listFor");
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
        const first = lists.mock.calls.length;
        expect(first).toBe(1);                                  // red: every rung ran
        E._ladderEv = -1;                                       // as if a pinned plane evicted rungs: the once-a-view rebuild
        E._buildLadder();
        for (let k = 0; k < 20 && E._ladderBusy; k++) await idle();
        expect(lists.mock.calls.length - first).toBeLessThanOrEqual(1);
    });

    test("N13 a cold rung is built a budget at a time over idle hops, then posted; its tiles are kept between hops", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        E.store.bumpEpoch();                                    // every tile cold
        E.ladderSliceMs = 1e-6;                                 // each hop bakes one tile chain, then gives up
        const lists = jest.spyOn(E, "listFor");
        const posts = jest.spyOn(E.renderer, "ladderPlates");
        const over0 = E.store.overBudget || 0;
        E._lastCamMove = -1e9; E._ladderAt = null;
        E._buildLadder();
        for (let k = 0; k < 200 && E._ladderBusy; k++) await idle();
        const nulls = lists.mock.results.filter((r) => r.value === null).length;
        expect(nulls).toBeGreaterThan(0);                       // red before: one unsliced build
        expect((E.store.overBudget || 0) - over0).toBe(nulls);
        expect(posts).toHaveBeenCalled();                       // the rung finished and posted its plates
        expect(lists.mock.results[lists.mock.results.length - 1].value).not.toBeNull();
    });

    test("N4 a pinned plane and the cap cannot evict the base", () => {
        const store = new PlateStore({ maxBytes: 4 * PLATE_BYTES, doc: null });
        const put = (q, i) => store.put({ frameId: "0", q, Zq: 1, i, j: 0, G: 0, bitmap: { close() {} }, bytes: PLATE_BYTES });
        for (let i = 0; i < 4; i++) put(0, i);
        store.want({ frameId: "0", q: 0, Zq: 1, i0: 0, i1: 3, j0: 0, j1: 0 });   // the screen pins the whole cap
        store.markLadder([plateKey("0", -20, 0, 0), plateKey("0", -20, 1, 0)], true);
        put(-20, 0); put(-20, 1);                          // the base, over the cap
        put(1, 0);                                         // and one more: the only other thing to evict
        expect(store.get(plateKey("0", 1, 0, 0))).toBeUndefined();
        expect(store.get(plateKey("0", -20, 0, 0))).toBeTruthy();
        expect(store.get(plateKey("0", -20, 1, 0))).toBeTruthy();
        store.dropAll(false);                              // a reset: another document, nothing stays
        expect(store.size()).toBe(0);
        expect(store._base.size).toBe(0);
    });

    test("N5 a frame re-addressed stales its old and new cells and removes its own plates, not the whole cache", async () => {
        const E = mkEngine();
        drawing(E);
        const kid = E.lm.cellChild("0", 3, 2);
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, polys: [[[-4000, -4000], [4000, -4000], [4000, 4000], [-4000, 4000]]] }, kid.id);
        E._render(); await flush();
        const n0 = E.plates.size(), all0 = E.plates.s.dropsAll;
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        const far = org[0] > 400 ? [40, 40] : [760, 560];
        const v = E.renderer.layer.view();
        const X = Math.floor(far[0] * v.dpr - v.dx + v.ox), Y = Math.floor(far[1] * v.dpr - v.dy + v.oy);
        const farKey = plateKey(v.frameId, v.q, Math.floor(X / PLATE_PX), Math.floor(Y / PLATE_PX));
        const farPlate = E.plates.get(farKey);
        expect(farPlate).toBeTruthy();
        E.doc.noteRefile(kid.id, { parent: "0", i: 3, j: 2 }, { parent: "0", i: 4, j: 2 });   // the Stage's commit applies it
        expect(E.plates.s.dropsAll).toBe(all0);            // red with `refile` → dropAll
        expect(E.plates.get(farKey)).toBe(farPlate);
        expect(E.plates._isStale(farPlate)).toBe(false);
        expect(E.plates.size()).toBeGreaterThan(0);
        expect(E.plates.size()).toBeLessThanOrEqual(n0);
    });

    test("N6 a settled view short of its plates counts its paper honestly; a reset drops the carry", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        const L = E.renderer.layer;
        E.zoomAt(400, 300, -60);                           // off-quantum: the settle follows
        for (let k = 0; k < 6; k++) { await new Promise((r) => setTimeout(r, 200)); await flush(); }
        expect(L.view().mode).toBe("settle");
        L.dropCarry();
        E.plates.dropAll(false);
        E.renderer.syncCameraOnly();
        expect(paperNow(E)).toBeGreaterThan(0);            // red when settle mode reported 0 over a paper screen
        // and a reset (a load) never carries another document's picture
        E._render(); await flush();
        E.renderer.syncCameraOnly();
        expect(L._carry).toBeTruthy();
        E.doc.clear();
        expect(L._carry).toBeNull();
    });
});

test("N7 a sync frame is the exact screen: no paper counted, no carry drawn", async () => {
    const E = mkEngine();
    drawing(E);
    E._render(); await flush();
    const L = E.renderer.layer;
    E.renderer.syncCameraOnly();
    L.syncBudget = 1e9; L._sync = false;                   // light enough: the next step takes the sync path
    const carry0 = pictureStats.carryComposes, paper0 = pictureStats.paperComposes;
    E.zoomAt(400, 300, -40);
    expect(L.view().mode).toBe("sync");
    expect(pictureStats.paperComposes).toBe(paper0);       // red when the one sync surface reads as a cell
    expect(pictureStats.carryComposes).toBe(carry0);
});

// ---------------------------------------------------------------------------
// The review of rounds 2–3 (2026-09-23): stale ink through an empty plate, a merge that wiped the
// cache, and a base that lost its protection on its first re-raster.
// ---------------------------------------------------------------------------

describe("the review of rounds 2–3", () => {
    const quiet = () => new Promise((r) => setTimeout(r, 200));

    test("R2 a deleted square's cell shows paper once its empty plate lands, under a carried compose", async () => {
        const E = mkEngine();
        E._maybeLadder = () => {};
        const L = E.renderer.layer;
        L._ctx = softCtx(L._canvas.width, L._canvas.height, PLATE_PX);
        const sq = (sx, sy, s, color) => { const p = E.cam.screenToFrame(sx, sy); return E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
            polys: [[[p[0], p[1]], [p[0] + s / E.cam.inScale, p[1]], [p[0] + s / E.cam.inScale, p[1] + s / E.cam.inScale], [p[0], p[1] + s / E.cam.inScale]]] }, E.cam.frame); };
        const red = sq(60, 60, 40, "rgb(220,20,20)");
        sq(600, 400, 60, "rgb(20,20,220)");
        E._render(); await flush();
        E.renderer.syncCameraOnly();
        const v = L.view();
        const cell = (sx, sy) => [Math.floor((sx * v.dpr - v.dx + v.ox) / PLATE_PX), Math.floor((sy * v.dpr - v.dy + v.oy) / PLATE_PX)];
        const [ri, rj] = cell(80, 80), [bi, bj] = cell(630, 430);
        expect(ri !== bi || rj !== bj).toBe(true);
        expect(L._ctx.at(80 * v.dpr, 80 * v.dpr)).toEqual([220, 20, 20]);
        stallWorkers();                                    // nothing lands but what the test puts
        E.plates._remove(plateKey(v.frameId, v.q, bi, bj));   // another cell loses its plate: the carry comes in
        E.doc.removeById(red.id);
        E._render();
        const rk = plateKey(v.frameId, v.q, ri, rj);
        L.onPlate({ key: rk, frameId: v.frameId, q: v.q, Zq: v.Zq, i: ri, j: rj, G: E.stage.generation, bitmap: null, pixels: null, bytes: 0 });
        expect(pictureStats.carryComposes).toBeGreaterThan(0);
        expect(L._ctx.at(80 * v.dpr, 80 * v.dpr)).toEqual([255, 255, 255]);   // red before: the deleted square, carried
    });

    test("R3 a frame dropped on a visited empty cell merges into it: no dropAll, the cache kept", async () => {
        const E = mkEngine();
        const kid = E.lm.cellChild("0", 3, 2);
        E.lm.cellChild("0", 4, 2);                         // visited: nothing in it
        const Sz = 8000;
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, polys: [[[-Sz / 2, -Sz / 2], [Sz / 2, -Sz / 2], [Sz / 2, Sz / 2], [-Sz / 2, Sz / 2]]] }, kid.id);
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#33c", opacity: 1, polys: [[[-30, -30], [-20, -30], [-20, -20], [-30, -20]]] }, "0");
        E._render(); await flush();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        E.setTool("select");
        const loop = [];
        for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]); }
        E.pointerDown(loop[0][0], loop[0][1]);
        for (const q of loop.slice(1)) E.pointerMove(q[0], q[1]);
        E.pointerUp();
        expect(E.selection.frames.length).toBe(1);
        await quiet(); await flush();
        const kinds = [];
        E.doc.subscribe((ev) => kinds.push(ev.kind));
        const all0 = E.plates.s.dropsAll, n0 = E.plates.size();
        const cellPx = 32 * E.cam.inScale;
        E.pointerDown(org[0], org[1]);
        for (const f of [0.25, 0.5, 0.75, 1]) E.pointerMove(org[0] + f * cellPx, org[1]);
        E.pointerUp();
        expect(kinds).toContain("mergeFrame");
        expect(E.plates.s.dropsAll).toBe(all0);            // red before: the merge wiped every plate and stand-in
        expect(E.plates.size()).toBeGreaterThanOrEqual(n0 - 2);
    });

    test("R3b a frame's list deleted and put back stales its footprint only: no dropAll", async () => {
        const E = mkEngine();
        drawing(E);
        const kid = E.lm.cellChild("0", 3, 2);
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, polys: [[[-4000, -4000], [4000, -4000], [4000, 4000], [-4000, 4000]]] }, kid.id);
        E._render(); await flush();
        const v = E.renderer.layer.view();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        const far = org[0] > 400 ? [40, 40] : [760, 560];
        const X = Math.floor(far[0] * v.dpr - v.dx + v.ox), Y = Math.floor(far[1] * v.dpr - v.dy + v.oy);
        const farKey = plateKey(v.frameId, v.q, Math.floor(X / PLATE_PX), Math.floor(Y / PLATE_PX));
        const X2 = Math.floor(org[0] * v.dpr - v.dx + v.ox), Y2 = Math.floor(org[1] * v.dpr - v.dy + v.oy);
        const kidKey = plateKey(v.frameId, v.q, Math.floor(X2 / PLATE_PX), Math.floor(Y2 / PLATE_PX));
        expect(farKey).not.toBe(kidKey);
        const all0 = E.plates.s.dropsAll, farDirt = E.stage.dirtySince(farKey), kidDirt = E.stage.dirtySince(kidKey);
        const recs = E.doc.removeFrameSubtree(kid.id);
        expect(recs).toBeTruthy();
        E._render();
        expect(E.plates.s.dropsAll).toBe(all0);            // red before: removeFrame dropped every plate
        expect(E.stage.dirtySince(kidKey)).toBeGreaterThan(kidDirt);
        expect(E.stage.dirtySince(farKey)).toBe(farDirt);
        expect(E.plates.get(farKey)).toBeTruthy();
        await flush();
        E.doc.insertFrameSubtree(recs);
        E._render();
        expect(E.plates.s.dropsAll).toBe(all0);
        expect(E.stage.dirtySince(farKey)).toBe(farDirt);
    });

    test("R5 a carry magnified past the stand-ins' window is not drawn (review nit: a scene jump carried at ~1e18x)", async () => {
        const E = mkEngine();
        drawing(E);
        E._render(); await flush();
        const L = E.renderer.layer;
        E.renderer.syncCameraOnly();
        expect(L._carry).toBeTruthy();
        const v = L.view();
        expect(L._carryXf(v)).toBeTruthy();
        L._carry.k = v.k / 1e6;                            // the last picture a million times further out than this view
        expect(L._carryXf(v)).toBeNull();                  // red before: carried at 1e6x
        L._carry.k = v.k * 1e6;
        expect(L._carryXf(v)).toBeNull();
    });

    test("R6 a teardown closes every bitmap, the base's and the drag plane's too (docmaps finding 1)", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const closed = [];
        const bm = (k) => ({ close() { closed.push(k); } });
        const put = (q, i) => { const k = plateKey("0", q, i, 0); store.put({ frameId: "0", q, Zq: 1, i, j: 0, G: 0, bitmap: bm(k), bytes: PLATE_BYTES }); return k; };
        const base = plateKey("0", -20, 0, 0), plane = plateKey("0", "z0_0_x", 0, 0);
        store.markLadder([base], true);
        put(-20, 0); put(0, 1);
        store.put({ frameId: "0", q: "z0_0_x", Zq: 1, i: 0, j: 0, G: 0, bitmap: bm(plane), bytes: PLATE_BYTES });
        store.setPlanePins([plane]);
        store.destroy();
        expect(closed).toContain(base);                    // red before: kept, never closed
        expect(closed).toContain(plane);
        expect(closed.length).toBe(3);
        expect(store.size()).toBe(0);
    });

    test("R4 the base keeps its protection through its own re-raster", () => {
        const store = new PlateStore({ maxBytes: 8 * PLATE_BYTES, doc: null });
        const k = plateKey("0", -20, 0, 0);
        store.markLadder([k], true);
        store.put({ frameId: "0", q: -20, Zq: 1, i: 0, j: 0, G: 0, bitmap: { close() {} }, bytes: PLATE_BYTES });
        store.release("hidden");                           // keeps it
        expect(store._base.has(k) && !!store.get(k)).toBe(true);
        store.markLadder([k], true);                       // the return's ladder rebuild re-marks it
        store.put({ frameId: "0", q: -20, Zq: 1, i: 0, j: 0, G: 1, bitmap: { close() {} }, bytes: PLATE_BYTES });   // a newer G replaces it
        expect(store._base.has(k)).toBe(true);             // red before: the replace took it out of the base
        expect(store._ladder.has(k)).toBe(true);
    });
});
