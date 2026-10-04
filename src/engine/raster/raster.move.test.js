/**
 * raster.move.test.js — the drag plane (PAPER-PLAN §10 S4, `MovePlane.js`) on the pyramid (A3 §6): the plates under
 * a selection WITHOUT it and its ink ALONE are rendered as soon as it is selected; a drag then builds no list and
 * re-renders no view plate, the compose draws the plane translated by the pointer in true z-order, and at the drop the
 * plane stays over each cell until that cell's own source is exact. Ported by B-PYRAMID-2b; the settled view, the
 * old layer's compose unit, the carry, the hold and the live hold's clip went with their mechanisms (the plane's
 * identity, H4 and the landing by exact are also `raster.pyramid`'s P3).
 *
 * jsdom has no canvas: the engine cases read the plates' own bytes out of the store (the inline path's raw
 * `pixels`), and the z-order cases composite into `__testkit__/softCanvas`. What it looks like, and whether a drag
 * shows any paper, is measured in Kobin's Chrome (PAPER-PLAN §10).
 */
import KobinEngine from "../KobinEngine";
import { planeStats, resetPlaneStats, MOVE_PLANE_LAYERS, MOVE_HOLD_MS } from "./MovePlane";
import { MOVE_PLANE_PLATES, levelKey, restKey } from "./level";
import { PLATE_PX } from "./plate";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./rasterWorkerClient";
import { softCtx } from "../__testkit__/softCanvas";

const engines = [];
function mkEngine(w = 800, h = 600) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); resetPlaneStats(); });
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
});

async function flush(rounds = 24) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const busy = engines.some(({ E }) => { const r = E.renderer.queue.report(); return r.queued.some((n) => n) || r.inFlight.some((n) => n); });
        if (!busy) return k + 1;
    }
    return rounds;
}

const quiet = () => new Promise((r) => setTimeout(r, 200));
const S = 120;
const fill = (E, x, y, color) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + S, y], [x + S, y + S], [x, y + S]]],
});
/** Two fills; the first is tap-selected. */
async function scene(E) {
    const a = E.doc.add(fill(E, 100, 200, "rgb(200,30,30)"), "0");
    const b = E.doc.add(fill(E, 300, 200, "rgb(30,30,200)"), "0");
    E._render();
    await flush();
    E.setTool("select");
    const p = E.cam.levelPointToScreen("0", 160, 260);          // on screen: the plane covers the screen's cells only
    E.pointerDown(p[0], p[1]); E.pointerUp();
    expect(E.selection && E.selection.ids).toEqual([a.id]);
    E._render();
    // The plane is aimed once the view and the scene (no commit) have held PLANE_QUIET_MS: waited for, not raced.
    const R = E.renderer;
    await quiet();
    for (let t = 0; t < 3000 && (R._planeTimer != null || !R._plane.tags.length); t += 10) await new Promise((r) => setTimeout(r, 10));
    await flush();
    return { a, b, p };
}

/** A plane layer's tag by kind: the first of that kind. */
const tagOf = (pl, kind) => { const L = pl.layers.find((x) => x.kind === kind); return L ? L.tag : null; };

/** A view cell's own key: the rest set's at rest, else the view level's. */
const viewKey = (v, i, j) => (v.mode === "rest" ? restKey(v.frameId, v.Z, i, j) : levelKey(v.frameId, v.level, v.S, i, j));
/** The RGBA under a CSS screen point of the plane layer `tag`'s plate (its level's grid), or of the view's own (`tag` null); null for no plate. */
function rgbaAt(E, tag, sx, sy) {
    const v = E.renderer._view, pl = E.renderer._plane, lvl = tag ? [pl.main, pl.quick].find((l) => l && l.tags.includes(tag)) : null;
    const f = lvl ? lvl.pZq / v.Zq : 1;
    const X = Math.floor(((sx * v.dpr - v.dx) / v.s + v.ox) * f), Y = Math.floor(((sy * v.dpr - v.dy) / v.s + v.oy) * f);
    const i = Math.floor(X / PLATE_PX), j = Math.floor(Y / PLATE_PX);
    const e = E.plates.get(lvl ? pl._key(tag, lvl.pZq, i, j) : viewKey(v, i, j));
    if (!e) return null;
    if (!e.pixels) return "empty";
    const o = ((Y - j * PLATE_PX) * PLATE_PX + (X - i * PLATE_PX)) * 4;
    return Array.from(e.pixels.subarray(o, o + 4));
}

describe("the drag plane (PAPER-PLAN §10 S4)", () => {
    test("M1 a selection's plane is rastered at select, split by z: BELOW, the ink alone, and what is drawn over it", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        expect(pl.r).toBeTruthy();
        // the blue square was drawn after the red one, so it is OVER the selection (S4z)
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over"]);
        const other = E.cam.levelPointToScreen("0", 360, 260);
        // the ink plate: the selection opaque at its own colour, nothing else, alpha 0 elsewhere
        expect(rgbaAt(E, tagOf(pl, "sel"), p[0], p[1])).toEqual([200, 30, 30, 255]);
        const oi = rgbaAt(E, tagOf(pl, "sel"), other[0], other[1]);
        expect(oi === null || oi === "empty" || oi[3] === 0).toBe(true);
        // BELOW: paper under both, the selection and what is over it (an empty plate IS paper)
        const paper = (x) => x === "empty" || (Array.isArray(x) && x.join() === "255,255,255,255");
        expect(paper(rgbaAt(E, tagOf(pl, "below"), p[0], p[1]))).toBe(true);
        expect(paper(rgbaAt(E, tagOf(pl, "below"), other[0], other[1]))).toBe(true);
        // OVER: the blue square, opaque, on a transparent plate
        expect(rgbaAt(E, tagOf(pl, "over"), other[0], other[1])).toEqual([30, 30, 200, 255]);
        const oo = rgbaAt(E, tagOf(pl, "over"), p[0], p[1]);
        expect(oo === "empty" || oo[3] === 0).toBe(true);
        // pinned: a flood of other plates cannot evict it
        for (const k of pl.keys) expect(E.plates._plane.has(k)).toBe(true);
    });

    test("M2 a drag builds no list and re-rasters no plate; the drop lands the plane until the fresh plates arrive", async () => {
        const E = mkEngine();
        const { a, p } = await scene(E);
        const pl = E.renderer._plane;
        const lists = jest.spyOn(E, "_render");
        const views0 = E.renderer.queue.report().byPrio.slice(0, 2).join();
        E.renderer.pyramid.cfg.patchInlineMs = E.renderer.pyramid.cfg.patchUserMs = 0;   // the drop's patches go to the pool: the landing is seen
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 40; k++) E.pointerMove(p[0] + k * 3, p[1] + k);
        expect(E._holdMove).toBeTruthy();
        expect(lists).not.toHaveBeenCalled();                     // red with the per-step `_render`: 33 renders
        expect(pl.state).toBe("drag");
        expect(pl.off).toEqual([120, 40]);                        // the pointer's displacement, device px (dpr 1)
        expect(E.renderer.queue.report().byPrio.slice(0, 2).join()).toBe(views0);   // no view or patch plate re-rendered
        E.pointerUp();
        expect(lists).toHaveBeenCalledTimes(1);                   // the drop's one render
        expect(pl.state).toBe("land");
        expect(E.doc.getById(a.id).obj.below).toBeTruthy();       // the move itself happened
        await flush();
        expect(pl.state).not.toBe("land");                        // the fresh plates ended the landing
        expect(planeStats.landTimeouts).toBe(0);
        // and the plane is ready again, at the selection's new place, once the drop's commit is quiet (a bake's commits
        // do not re-aim it each step, PLAN §5.9 item 2)
        E._render();
        await flush();
        for (let t = 0; t < 3000 && !pl.r; t += 10) { await new Promise((r) => setTimeout(r, 10)); await flush(); }
        expect(pl.r).toBeTruthy();
        expect(rgbaAt(E, tagOf(pl, "sel"), p[0] + 120, p[1] + 40)).toEqual([200, 30, 30, 255]);
    });

    test("M2b the ants ride the same displacement as the plane for the whole drag", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 25; k++) {
            E.pointerMove(p[0] + k * 3, p[1] + k);
            if (pl.state !== "drag") continue;
            const ants = E._selectionAnts();
            expect(ants.off).toEqual([pl.off[0], pl.off[1]]);     // dpr 1; red by SELECT_DRAG_PX when the ants anchor at the first step
        }
        E.pointerUp();
    });

    test("M3 a cancel drops the plane at once; a selection past every coarsening is still drawn, over the cap", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 12; k++) E.pointerMove(p[0] + k * 2, p[1]);
        expect(pl.state).toBe("drag");
        E.cancelSelectGesture(false);
        expect(pl.state).toBe("idle");
        // a cap nothing fits: the coarsest level is taken and counted, the drag held (the review's nit: "never refuses" was untrue)
        E.renderer._planeCap = 1;
        const over0 = planeStats.overCap;
        const lists = jest.spyOn(E, "_render");
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 12; k++) E.pointerMove(p[0] + k * 2, p[1]);
        expect(E._holdMove).not.toBeNull();
        expect(planeStats.overCap).toBe(over0 + 1);
        expect(lists.mock.calls.length).toBe(0);
        E.pointerUp();
    });
});

describe("the plane while the camera moves (PAPER-PLAN §10 S4)", () => {
    test("M6 a zoom with a selection re-rasters no plane per quantum; once the view holds, the plane is aimed at it, a settled view included", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        expect(pl.r).toBeTruthy();
        const posts0 = planeStats.requests, builds0 = planeStats.builds;
        for (let k = 0; k < 8; k++) E.zoomAt(p[0], p[1], -250);     // two octaves in, eight quanta
        expect(planeStats.requests).toBe(posts0);                   // red when every quantum re-aims it
        expect(planeStats.builds).toBe(builds0);
        expect(pl.tags).toEqual([]);                                // the plane of the view it left is freed
        // the view holds: aimed once PLANE_QUIET_MS passed and no settle is coming (a settle publishes a new view)
        await new Promise((r) => setTimeout(r, 400));
        for (let t0 = Date.now(); !pl.r && Date.now() - t0 < 5000;) { await quiet(); await flush(); }
        const v = E.renderer._view;
        expect(pl.r).toBeTruthy();
        expect(pl.q).toBe(v.q);
        expect(pl.Zq).toBe(v.Zq);
    });
});

describe("the pen-up handoff (PAPER-PLAN §10 S5; the group commit is raster.pyramid's P2)", () => {
    test("L2 a cancelled stroke's path goes with its stroke, not at the timeout", async () => {
        const E = mkEngine();
        E._render();
        await flush();
        E.setTool("pen");
        const a = E.cam.levelPointToScreen("0", -100, 0);
        E.pointerDown(a[0], a[1]);
        for (let k = 1; k <= 5; k++) E.pointerMove(a[0] + k * 20, a[1]);
        const path = E.renderer.live.root;                            // the live stroke: its tail and frozen chunks (D-1)
        E.cancelStroke();
        expect(path.parent).toBeFalsy();
        expect(E.renderer.live.held.length).toBe(0);
    });
});

describe("a drag step's own costs (PAPER-PLAN §10 S7)", () => {
    test("K1 a table change keeps the family index; a re-home rebuilds it at the new frame", () => {
        const E = mkEngine();
        const a = E.doc.add(fill(E, -200, -60, "rgb(200,30,30)"), "0");
        E.doc.editGroup(a.id);
        const idx = E.doc._groups;
        expect(idx).toBeTruthy();
        E.doc.setOffsetsById(a.id, [[0, 3, 2]]);
        expect(E.doc._groups).toBe(idx);                 // red when every event drops it: a rebuild over every native
        const kid = E.lm.cellChild("0", 1, 1);
        E.doc.rehomeById(a.id, kid.id);
        expect(E.doc.editGroup(a.id)[0].level).toBe(kid.id);
    });

    test("K2 the ants keep their drag's decision without re-deriving the selection table each step", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 10; k++) E.pointerMove(p[0] + k, p[1]);
        const table = jest.spyOn(E, "_selTable");
        for (let k = 11; k <= 30; k++) E.pointerMove(p[0] + k, p[1]);
        expect(table).not.toHaveBeenCalled();
        E.pointerUp();
    });
});

describe("the live trail under the pointer (Kobin 2026-09-22: erasers invisible until pen-up)", () => {
    /** Where the live path's last anchor lands in CSS px, through every group's transform up to Two's scene. */
    function liveAt(E) {
        const p = E.renderer.live.tail;
        const v = p.vertices[p.vertices.length - 1];
        let x = v.x, y = v.y;
        for (let g = p; g; g = g.parent) {
            const s = g.scale == null ? 1 : (typeof g.scale === "number" ? g.scale : g.scale.x);
            x = x * s + (g.translation ? g.translation.x : 0); y = y * s + (g.translation ? g.translation.y : 0);
        }
        return [x, y];
    }
    for (const raster of [true, false]) {
        for (const tool of ["erasePartial", "pen"]) {
            test("T1 " + tool + (raster ? " (raster)" : " (svg)") + ": after a pan, every pointer move's trail is where the pointer is", () => {
                const host = document.createElement("div");
                document.body.appendChild(host);
                const E = new KobinEngine(host, { width: 800, height: 600, raster });
                engines.push({ E, host });
                E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#123456", opacity: 1, polys: [[[-300, -300], [300, -300], [300, 300], [-300, 300]]] }, "0");
                E._render();
                E.panBy(137, -61);                        // the view centre moves: the next stroke re-chooses the overlay origin
                E._render();
                E.setTool(tool);
                E.pointerDown(300, 300);
                for (let k = 1; k <= 5; k++) {
                    E.pointerMove(300 + k * 20, 300 + k * 5);
                    const [x, y] = liveAt(E);
                    // red on the raster path without the re-sync: (37, -56) off for the first move, off-screen
                    expect(Math.abs(x - (300 + k * 20))).toBeLessThan(0.5);
                    expect(Math.abs(y - (300 + k * 5))).toBeLessThan(0.5);
                }
                E.pointerUp();
            });
        }
    }
});

// ---------------------------------------------------------------------------
// The review of S1–S7 (2026-09-22): its reproductions RV1, RV2, RV4 as tests.
// ---------------------------------------------------------------------------

/** The screen x (CSS px, dpr 1) where the plane draws its SEL ink's left edge. */
function selLeftDrawn(E) {
    const R = E.renderer, pl = R._plane, v = R._view;
    const sel = pl.layers.find((L) => L.kind === "sel");
    let minX = Infinity;
    for (const [i, j] of sel.cells) {
        const e = E.plates.get(pl._key(sel.tag, (pl.cur || pl.main).pZq, i, j));
        if (!e || !e.pixels) continue;
        for (let y = 0; y < PLATE_PX; y += 4) {
            for (let x = 0; x < PLATE_PX; x++) if (e.pixels[(y * PLATE_PX + x) * 4 + 3] > 128) { if (i * PLATE_PX + x < minX) minX = i * PLATE_PX + x; break; }
        }
    }
    return (minX - v.ox) * v.s + v.dx + pl.off[0];
}

describe("the review's reproductions (PAPER-PLAN §10, review of S1–S7)", () => {
    test("RV1 a second drag begun while the first drop still lands is drawn once, where the document has it", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        E.renderer.pyramid.cfg.patchInlineMs = E.renderer.pyramid.cfg.patchUserMs = 0;   // the drop's patches go to the pool: the landing is seen
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 40; k++) E.pointerMove(p[0] + k * 3, p[1] + k);
        E.pointerUp();
        expect(pl.state).toBe("land");
        const p1 = [p[0] + 120, p[1] + 40];
        E.pointerDown(p1[0], p1[1]);                     // a nudge again, at once
        for (let k = 1; k <= 5; k++) E.pointerMove(p1[0] + k * 6, p1[1]);
        await flush();
        const lists = jest.spyOn(E, "_render");
        for (let k = 6; k <= 40; k++) E.pointerMove(p1[0] + k * 6, p1[1]);
        await flush();
        expect(lists).not.toHaveBeenCalled();             // the plane draws it: no per-step render
        expect(pl.state).toBe("drag");
        const doc = E.cam.levelPointToScreen("0", 100, 200)[0] + 120 + 240;
        expect(Math.abs(selLeftDrawn(E) - doc)).toBeLessThan(1.5);   // red: 490 against 460, the move drawn twice
        E.pointerUp();
    });

    test("RV2 a wheel zoom into another frame during a drag hands the drag to the view's plates, and the drag renders a step", async () => {
        const E = mkEngine();
        const { p } = await scene(E);
        const R = E.renderer;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 20; k++) E.pointerMove(p[0] + k * 6, p[1]);
        await flush();
        expect(R.dragLight()).toBe(true);
        const f0 = E.cam.frame, cur = [p[0] + 120, p[1]];
        for (let n = 0; E.cam.frame === f0 && n < 80; n++) E.zoomAt(cur[0], cur[1], -250);
        expect(E.cam.frame).not.toBe(f0);
        await flush();
        expect(E._holdMove.plane).toBe(false);            // red: the plane still drew a drag it had lost
        expect(E.stage.holding).toBe(true);               // the hold stands: nothing is written until the drop (A1 C2)
        expect(E.stage._hold.view).toBe(true);            // red: the view drew the lost drag at rest until the next step
        expect(R.dragLight()).toBe(false);
        const lists = jest.spyOn(E, "_render");
        for (let k = 21; k <= 40; k++) E.pointerMove(p[0] + k * 6, p[1]);
        await flush();
        expect(lists.mock.calls.length).toBe(20);         // red: 0 — nothing drew the move until the drop
        E.pointerUp();
    });

    test("RV5 the plane's drag is held in the Stage: its steps commit nothing, its drop is one commit (A2 §2.7)", async () => {
        const E = mkEngine();
        const { a, p } = await scene(E);
        E.pointerDown(p[0], p[1]);
        E.pointerMove(p[0] + 6, p[1] + 6);
        await flush();
        expect(E._holdMove && E._holdMove.ids.has(a.id)).toBe(true);
        expect(E.stage.holding).toBe(true);
        const G0 = E.stage.generation, dirt0 = E.stage.stats.dirtied, held0 = E.stage.stats.held;
        for (let k = 2; k <= 20; k++) E.pointerMove(p[0] + k * 6, p[1] + k * 6);
        await flush();
        expect(E.stage.generation).toBe(G0);              // red without the hold: a commit a step
        expect(E.stage.stats.dirtied).toBe(dirt0);
        const release = jest.spyOn(E.stage, "release");
        E.pointerUp();
        expect(release).toHaveBeenCalledTimes(1);
        expect(E.stage.holding).toBe(false);
        expect(E.stage.stats.held).toBeGreaterThan(held0);   // the steps' events, applied at the drop
        expect(E.stage.stats.dirtied).toBeGreaterThan(dirt0); // where it was and where it is
    });

    test("RV4 a full render mid-drag bakes no copy of the dragged object into the ordinary plates", async () => {
        const E = mkEngine();
        const R = E.renderer;
        // The rest sets and the drop's patch inline, whatever this node's timings say: loaded, a rest render past
        // `restInlineMs` marked the next heavy and it went to the pool after `flush`, so the drop's cell had no plate
        // (2 runs in 7 beside eight busy loops). Set before the scene's first rest render.
        R.pyramid.cfg.restInlineMs = R.pyramid.cfg.patchUserMs = 1e9;
        const { p } = await scene(E);
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 20; k++) E.pointerMove(p[0] + k * 6, p[1] + k * 6);   // +120, +120: over paper
        await flush();
        const at = [p[0] + 120, p[1] + 120];
        const v0 = R._view;
        const X = (at[0] * v0.dpr - v0.dx + v0.ox) / v0.Zq, Y = (at[1] * v0.dpr - v0.dy + v0.oy) / v0.Zq;
        const i = Math.floor((X * v0.Zq) / PLATE_PX), j = Math.floor((Y * v0.Zq) / PLATE_PX);
        E.plates.dropFrames((f) => String(f) === String(v0.frameId));   // every plate, that one too, must re-raster
        expect(E.plates.get(viewKey(v0, i, j))).toBeUndefined();
        E._render();                                      // a cut landing, a crossing: the list now holds the move
        await flush();
        const c = rgbaAt(E, null, at[0], at[1]);
        expect(Array.isArray(c) && c[0] === 200 && c[1] === 30).toBe(false);   // red without `omit` on the view's packs
        E.pointerUp();
        await flush();
        expect(rgbaAt(E, null, at[0], at[1])).toEqual([200, 30, 30, 255]);   // and the drop puts it there
    });
});

// ---------------------------------------------------------------------------
// The z-order of a drag (Kobin 2026-09-22: "a dragged object floats above everything until you drop
// it — this is a problem"): the real compose, into a software canvas, pixel by pixel.
// ---------------------------------------------------------------------------

/**
 * An engine whose pyramid composites into `softCtx` (the pyramid draws with the nine-argument `drawImage`, so the soft
 * context runs its scaled form; `magnified` counts the draws whose size changes), every raw-pixel plate given a bitmap.
 */
function mkSoftEngine() {
    const E = mkEngine();
    const L = E.renderer.layer;
    const soft = (w, h) => {
        const c = softCtx(w, h, PLATE_PX, { scaled: true }), di = c.drawImage;
        c.magnified = 0;
        c.drawImage = (bm, ...a) => { if (a.length === 8 && (a[6] !== a[2] || a[7] !== a[3])) c.magnified++; return di.call(c, bm, ...a); };
        return c;
    };
    L._ctx = soft(L._canvas.width, L._canvas.height);
    L._mk = (w, h) => ({ width: w, height: h, getContext: () => soft(w, h) });
    const put = E.plates.put.bind(E.plates);
    E.plates.put = (rec) => { if (rec.pixels && !rec.bitmap) rec.bitmap = { pixels: rec.pixels }; return put(rec); };
    return E;
}

const RED = [200, 30, 30], GREEN = [30, 160, 30], BLUE = [30, 30, 200], YELLOW = [220, 200, 20];
const box = (E, x, y, w, h, color) => E.doc.add({
    type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(" + color.join(",") + ")", opacity: 1,
    polys: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]],
}, "0");
/** Wait, a macrotask at a time, until `pred` holds or `ms` pass: the plane's quiet timer is late under load. */
async function until(pred, ms = 5000) {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
    return pred();
}
async function selectIds(E, ids) {
    E.setTool("select");
    E._setSelection(ids, []);
    E._render();
    const pl = E.renderer._plane;
    await until(() => (pl.refused && pl.sel) || (pl.layers.length > 0 && pl.checkReady(E.plates)));   // aimed: refused, or whole
    await flush();
}
const inside = (x, y, b) => x > b[0] + 2 && x < b[0] + b[2] - 2 && y > b[1] + 2 && y < b[1] + b[3] - 2;

describe("the drag keeps the true z-order at every frame (PAPER-PLAN §10 S4z)", () => {
    test("Z1 an object drawn after the selection covers it all along its path; what was under it shows where it was", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);                               // under everything
        const S = [100, 250, 100, 100], A = [400, 200, 150, 200];
        const s = box(E, ...S, RED);
        box(E, ...A, GREEN);                                          // drawn after the selection: over it
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const R = E.renderer, pl = R._plane, ctx = R.layer._ctx;
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over"]);
        E.pointerDown(150, 300);
        let checked = 0;
        for (let dx = 10; dx <= 400; dx += 10) {
            E.pointerMove(150 + dx, 300);
            if (!R.layer._plane) continue;                            // not whole yet: the ink stays where the plates have it
            const x = 150 + dx - 20, y = 300;                         // inside the moved square
            if (Math.abs(x - A[0]) < 3 || Math.abs(x - A[0] - A[2]) < 3) continue;   // an antialiased edge: no colour to assert
            const want = inside(x, y, A) ? GREEN : RED;
            expect([dx, ...ctx.at(x, y)]).toEqual([dx, ...want]);     // red under GREEN on S4: the plane drew last
            if (dx > 120) expect([dx, ...ctx.at(150, 300)]).toEqual([dx, ...BLUE]);   // vacated: what was under it
            checked++;
        }
        expect(checked).toBeGreaterThan(30);
        expect(ctx.magnified).toBe(0);
        E.pointerUp();
    });

    test("Z2 the selection drawn last on screen: no OVER layer, no plate and no blit for one", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        box(E, 400, 200, 150, 200, GREEN);
        const s = box(E, 100, 250, 100, 100, RED);                    // the latest ink
        E._render(); await flush();
        const posted = [];
        const push = E.renderer.queue.push.bind(E.renderer.queue);
        E.renderer.queue.push = (jobs) => { for (const j of jobs) if (j.kind === "plane") posted.push(j.cells[0].tag); return push(jobs); };
        await selectIds(E, [s.id]);
        const pl = E.renderer._plane;
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel"]);
        expect(posted.length).toBeGreaterThan(0);
        expect(posted.every((q) => q === pl.layers[0].tag || q === pl.layers[1].tag)).toBe(true);
        expect(pl.keys.length).toBe(pl.layers[0].cells.length + pl.layers[1].cells.length);
        const over0 = planeStats.overBlits;
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 300; dx += 10) E.pointerMove(150 + dx, 300);
        expect(planeStats.overBlits).toBe(over0);
        expect(E.renderer.layer._ctx.at(430, 300)).toEqual(RED);     // over the green: it IS the latest
        E.pointerUp();
    });

    test("Z3 a selection interleaved in z with ink on screen takes more layers, each in its place", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s1 = box(E, 100, 100, 100, 100, RED);
        box(E, 350, 80, 140, 440, YELLOW);                            // between the two selected squares
        const s2 = box(E, 100, 400, 100, 100, GREEN);
        E._render(); await flush();
        await selectIds(E, [s1.id, s2.id]);
        const R = E.renderer, pl = R._plane, ctx = R.layer._ctx;
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over", "sel"]);
        E.pointerDown(150, 150);
        for (let dx = 10; dx <= 280; dx += 10) E.pointerMove(150 + dx, 150);
        expect(R.layer._plane).toBeTruthy();
        expect(ctx.at(410, 150)).toEqual(YELLOW);                     // the first square passes UNDER the yellow bar
        expect(ctx.at(410, 450)).toEqual(GREEN);                      // the second passes OVER it
        E.pointerUp();
    });

    test("Z4 past MOVE_PLANE_LAYERS the smallest run between two selected ones goes under them: no refusal, the drag holds", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const ids = [];
        for (let k = 0; k < 3; k++) {
            ids.push(box(E, 60, 60 + k * 160, 80, 80, RED).id);
            if (k < 2) box(E, 300 + k * 100, 40, 60, 500, YELLOW);    // an unselected bar between each pair
        }
        E._render(); await flush();
        await selectIds(E, ids);
        const pl = E.renderer._plane, ctx = E.renderer.layer._ctx;
        expect(planeStats.maxLayers).toBeGreaterThan(MOVE_PLANE_LAYERS);
        expect(planeStats.merged).toBe(1);                            // red before §10.14: refused, a render a step
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over", "sel"]);
        const lists = jest.spyOn(E, "_render");
        E.pointerDown(100, 100);
        for (let dx = 10; dx <= 290; dx += 10) E.pointerMove(100 + dx, 100);
        expect(E._holdMove).not.toBeNull();
        expect(lists.mock.calls.length).toBe(0);
        expect(ctx.at(415, 260)).toEqual(YELLOW);                     // the middle square under the second bar, as drawn
        expect(ctx.at(415, 420)).toEqual(RED);                        // the last one over it
        expect(ctx.at(355, 100)).toEqual(RED);                        // the first bar merged under the selection: the approximation
        E.pointerUp();
    });

    test("Z6 a drag started before the plane's plates land moves at once: the stopgap, then the plane whole", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        box(E, 400, 200, 150, 200, GREEN);
        E._render(); await flush();
        E.setTool("select");
        E._setSelection([s.id], []);                                  // selected, and dragged at once
        const R = E.renderer;
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 60; dx += 10) E.pointerMove(150 + dx, 300);
        const pl = R._plane;
        expect(pl.main.keys.some((k) => !E.plates.get(k))).toBe(true);   // the plane's own level still in flight
        expect(planeStats.stopgaps).toBe(1);                          // red before §10.14: the ink stood still, the ants moved
        expect(planeStats.notReady).toBe(0);
        expect(R.layer._plane).toBeTruthy();                          // the stopgap's plates are drawn as the quick level
        expect(R.layer._ctx.magnified).toBeGreaterThan(0);            // at the quick level's quarter zoom
        expect(R.layer._ctx.at(130, 300)).toEqual(BLUE);              // H4: BELOW over the start, never the ink twice
        expect(R.layer._ctx.at(200, 300)).toEqual(RED);               // and the selection moved
        await flush();
        E.pointerMove(220, 300);
        expect(pl.cur).toBe(pl.main);
        expect(pl.partial).toBe(false);
        expect(R.layer._ctx.at(130, 300)).toEqual(BLUE);              // whole: the old place is what was under it
        expect(R.layer._ctx.at(200, 300)).toEqual(RED);               // now moved
        E.pointerUp();
    });

    test("Z5 the plane stays inside its plate budget: its pins never pass MOVE_PLANE_PLATES, and a bigger cut is coarser", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        box(E, 400, 200, 150, 200, GREEN);
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const pl = E.renderer._plane;
        expect(pl.keys.length).toBeGreaterThan(0);
        expect(pl.keys.length).toBeLessThanOrEqual(MOVE_PLANE_PLATES);
        expect(E.plates._plane.size).toBe(pl.keys.length);
        E.renderer._planeCap = pl.main.plates - 1;                   // one plate short: an octave coarser at the next aim
        expect(E.renderer.planeAccepts()).toBe(true);                 // red before §10.14: refused
        expect(pl.main.k).toBeGreaterThan(0);
        expect(pl.main.plates).toBeLessThanOrEqual(E.renderer._planeCap);
        expect(planeStats.coarse).toBeGreaterThan(0);
        expect(E.plates._plane.size).toBe(pl.keys.length);
    });
});

// ---------------------------------------------------------------------------
// The review's majors 3 and 5, and minor 6.
// ---------------------------------------------------------------------------

describe("a drag always moves (PAPER-PLAN §10.14)", () => {
    test("Z7 cut-outs each next in z to an unselected remnant (Kobin's 65-object lasso needed 131 layers): merged, accepted, held", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const ids = [];
        for (let k = 0; k < 20; k++) {
            ids.push(box(E, 40 + k * 30, 100, 20, 20, RED).id);
            box(E, 40 + k * 30, 140, 20, 20, GREEN);
        }
        E._render(); await flush();
        await selectIds(E, ids);
        const pl = E.renderer._plane;
        expect(planeStats.maxLayers).toBeGreaterThan(MOVE_PLANE_LAYERS);
        expect(pl.refused).toBe(false);                               // red before §10.14: refused, a render a step
        expect(pl.layers.length).toBeLessThanOrEqual(MOVE_PLANE_LAYERS);
        const lists = jest.spyOn(E, "_render");
        E.pointerDown(50, 110);
        for (let dy = 10; dy <= 200; dy += 10) E.pointerMove(50, 110 + dy);
        expect(E._holdMove).not.toBeNull();
        expect(lists.mock.calls.length).toBe(0);
        expect(E.renderer.layer._ctx.at(50, 315)).toEqual(RED);       // the first cut-out, moved
        E.pointerUp();
    });

    test("Q1 the quick level is drawn while the plane's own is not in, and the plane's own once it is", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        box(E, 400, 200, 150, 200, GREEN);
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const R = E.renderer, pl = R._plane;
        expect(pl.quick).toBeTruthy();
        expect(pl.quick.plates).toBeLessThan(pl.main.plates);
        for (const k of pl.main.keys) { E.plates._remove(k); R._pyrPlaneAsked.delete(k); }   // the plane's own level still rastering
        pl.ready = false;
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 60; dx += 10) E.pointerMove(150 + dx, 300);
        expect(pl.cur).toBe(pl.quick);                                // red before §10.14: nothing drawn, the ink stood still
        expect(pl.partial).toBe(false);
        expect(planeStats.quickSteps).toBeGreaterThan(0);
        expect(R.layer._ctx.magnified).toBeGreaterThan(0);               // drawn magnified, a quarter of the zoom
        await flush();
        E.pointerMove(220, 300);
        expect(pl.cur).toBe(pl.main);
        E.pointerUp();
    });

    test("R1 a re-cut (a pan: a new list, the same selection) is not whole until its new cells are in", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 600, 250, 1400, 100, RED);                   // past the screen's right edge
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const R = E.renderer, pl = R._plane;
        expect(pl.checkReady(E.plates)).toBe(true);
        E.panBy(-600, 0);                                             // more of it on screen: cells the last cut clipped off
        E._render();
        R._aimPlane(R._view);
        expect(pl.keys.some((k) => !E.plates.get(k))).toBe(true);
        expect(pl.checkReady(E.plates)).toBe(false);                  // red with the flag kept from the last cut: holes drawn as whole
    });

    test("V5a the quick level is pinned inside the plane's cap, not on top of it (review 5)", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        box(E, 400, 200, 150, 200, GREEN);
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const R = E.renderer, pl = R._plane;
        expect(pl.quick).toBeTruthy();
        R._planeCap = pl.main.plates;                                 // the main level fits exactly: no room for the quick one
        expect(R.planeAccepts()).toBe(true);
        expect(pl.keys.length).toBeLessThanOrEqual(R._planeCap);      // red before: main + quick pinned past the cap
        expect(E.plates._plane.size).toBeLessThanOrEqual(R._planeCap);
    });

    test("V7 a re-cut that changes a layer's members renames it: its old plates are not drawn as the new layer (review 7)", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const A = box(E, 500, 250, 60, 60, RED);
        box(E, 1100, 250, 60, 60, GREEN);                             // past the screen's cells, between the two in z
        const B = box(E, 700, 250, 60, 60, YELLOW);
        E._render(); await flush();
        await selectIds(E, [A.id, B.id]);
        const R = E.renderer, pl = R._plane;
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel"]);
        const selTag = pl.layers[1].tag;
        E.panBy(-300, 0);                                             // the green one comes on screen: the run splits
        E._render();
        R._aimPlane(R._view);
        expect(pl.layers.map((L) => L.kind)).toEqual(["below", "sel", "over", "sel"]);
        expect(pl.layers[1].tag).not.toBe(selTag);                    // red before: "z1_<q>" both times, the old {A, B} plates drawn as {A}
        expect([...E.plates.cache.keys()].some((k) => k.split("|")[1] === selTag)).toBe(false);
    });

    test("V9b dragging with the plane whole, the view's own plates under BELOW are not drawn (review 9)", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        E._render(); await flush();
        await selectIds(E, [s.id]);
        const R = E.renderer, L = R.layer, pl = R._plane, v = R._view;
        const hitsOf = new Map();
        for (const [k, e] of E.plates.cache) if (e.kind !== "plane" && e.bitmap) hitsOf.set(e.bitmap, k);
        const drawn = [];
        const di = L._ctx.drawImage;
        L._ctx.drawImage = (bm, ...a) => { if (hitsOf.has(bm)) drawn.push(hitsOf.get(bm)); return di(bm, ...a); };
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 60; dx += 10) E.pointerMove(150 + dx, 300);
        expect(pl.cur).toBe(pl.main);
        const below = pl.main.layers[0].cells.map(([i, j]) => viewKey(v, i, j));
        expect(below.length).toBeGreaterThan(0);
        expect(drawn.filter((k) => below.includes(k))).toEqual([]);   // red before: drawn, then covered by BELOW
        E.pointerUp();
    });

    test("S1 the plane's counters name only what happens: no refusal counters (docmaps finding 4)", () => {
        for (const k of ["refused", "layerRefused", "plateRefused"]) expect(Object.keys(planeStats)).not.toContain(k);
        expect(Object.keys(planeStats)).toEqual(expect.arrayContaining(["merged", "coarse", "overCap", "notReady", "stopgaps"]));
    });

    test("H1 the test hook forcePerStepDrag: no plane, the view's plates draw the held drag, a render each step", async () => {
        const E = mkSoftEngine();
        box(E, 20, 20, 760, 560, BLUE);
        const s = box(E, 100, 250, 100, 100, RED);
        E._render(); await flush();
        E.renderer.forcePerStepDrag = true;
        E.setTool("select");
        E._setSelection([s.id], []);
        E._render(); await flush();
        await new Promise((r) => setTimeout(r, 200));
        expect(E.plates._plane.size).toBe(0);                          // no idle plane either
        const lists = jest.spyOn(E, "_render");
        E.pointerDown(150, 300);
        for (let dx = 10; dx <= 60; dx += 10) E.pointerMove(150 + dx, 300);
        expect(E._holdMove.plane).toBe(false);
        expect(E.renderer._plane.state).toBe("idle");
        expect(lists.mock.calls.length).toBeGreaterThanOrEqual(5);
        E.pointerUp();
    });

    test("L7 a pan that carries the camera into another cell renders: the list is rebuilt in the new frame (REVIEWER-3 CAM-1)", () => {
        const E = mkEngine();
        E.doc.add(fill(E, -200, -60, "rgb(30,30,200)"), "0");
        while (E.cam.inScale > 1 / 32) E.zoomFactorAt(400, 300, 1 / 2);
        E._render();
        const was = E.cam.frame;
        E.panBy(-4096, 0);
        expect(E.cam.frame).not.toBe(was);
        expect(E._tileFrame).toBe(E.cam.frame);                          // red before: the old frame's list
        expect(E._camTrail).toContain(was);
    });

});

describe("the drop of a selected frame, the landing's limit", () => {
    test("F1 dropping a selected frame removes the moved subtree's plates only; the rest are kept", async () => {
        const E = mkEngine();
        const kid = E.lm.cellChild("0", 3, 2);
        const Sz = 8000;
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, polys: [[[-Sz / 2, -Sz / 2], [Sz / 2, -Sz / 2], [Sz / 2, Sz / 2], [-Sz / 2, Sz / 2]]] }, kid.id);
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        const farS = org[0] > 400 ? [60, 60] : [740, 540], farF = E.cam.screenToFrame(farS[0], farS[1]);
        box(E, farF[0] - 20, farF[1] - 20, 40, 40, BLUE);             // on screen, far from the kid frame, at the root
        E._render(); await flush();
        E.setTool("select");
        const loop = [];
        for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]); }
        E.pointerDown(loop[0][0], loop[0][1]);
        for (const q of loop.slice(1)) E.pointerMove(q[0], q[1]);
        E.pointerUp();
        expect(E.selection.frames.length).toBe(1);
        await quiet(); await flush();
        const v = E.renderer._view;
        const X = Math.floor((farS[0] * v.dpr - v.dx) / v.s + v.ox), Y = Math.floor((farS[1] * v.dpr - v.dy) / v.s + v.oy);
        const farKey = viewKey(v, Math.floor(X / PLATE_PX), Math.floor(Y / PLATE_PX));
        const farPlate = E.plates.get(farKey);
        expect(farPlate).toBeTruthy();
        const all0 = E.plates.s.dropsAll;
        E.pointerDown(org[0], org[1]);
        for (const dx of [10, 20, 30]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        expect(E.plates.s.dropsAll).toBe(all0);                      // red: `dropAll` at every frame drop
        expect(E.plates.get(farKey)).toBe(farPlate);                  // the far plate kept, and fresh
        expect(E.plates.exact(farPlate)).toBe(true);
    });

    test("F3 a landing waits past B's 600 ms for plates still in flight; MOVE_HOLD_MS is only its safety limit", async () => {
        expect(MOVE_HOLD_MS).toBeGreaterThanOrEqual(3000);
        const E = mkEngine();
        const { p } = await scene(E);
        const pl = E.renderer._plane;
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 30; k++) E.pointerMove(p[0] + k * 3, p[1]);
        setRasterTransport(() => new Promise(() => {}));             // the drop's plates never arrive
        E.renderer.pyramid.cfg.patchInlineMs = E.renderer.pyramid.cfg.patchUserMs = 0;   // nor are they patched on this thread
        E.pointerUp();
        expect(pl.state).toBe("land");
        await new Promise((r) => setTimeout(r, 700));
        E.renderer.syncCameraOnly();
        expect(pl.state).toBe("land");                                // red at 600: back to the stale picture
        setRasterTransport(null);
    });
});
