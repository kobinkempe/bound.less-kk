/**
 * raster.picture.test.js — C1–C6 of RASTERISER-PLAN §9.2 plus the contract items §10 stage 5a
 * owes (§2.7 FC1's half, FC2, FC3, FC4, FC5) and the other half of J5 (edge case 4.14).
 *
 * **Nothing here measures a picture.** jsdom has no canvas — `setupTests.js:27` makes
 * `getContext` return null for every canvas in this tree — so the suite injects a RECORDING
 * 2D context and asserts an ordered call log and computed numbers. Every claim below is about
 * the sequence and the arithmetic; what the composite looks like is stage 7's, in Kobin's
 * Chrome (§9.4 items 1, 2 and 9), which is rule 3 of `docs/ai/00-START-HERE.txt`.
 *
 * The camera is the shipped `Camera`, so `frameWindow` is the engine's own and cannot drift
 * from it; only `inScale` and `inPan` are set directly, which skips the lattice's settle.
 */

import PictureLayer, { pictureStats, resetPictureStats, SETTLE_MS, SYNC_CHORD_BUDGET, SYNC_MAX_MS, S_MAX_HOLD, COMPOSE_IMAGES } from "./PictureLayer";
import { PREVIEW_QUANTA } from "./plate";
import PlateStore, { PLATE_BYTES } from "./PlateStore";
import { freshStub } from "../__testkit__/freshStub";
import { PLATE_PX, QUANTA_PER_OCTAVE, QUANTUM_HYSTERESIS, plateKey, plateRange, zqOf } from "./plate";
import { OverlayBuffer } from "./antPaint";
import Camera from "../Camera";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// The doubles: a recording 2D context on a REAL canvas element (so the host, the
// styles and `parentNode` are jsdom's own), a camera, and plates with a bitmap
// that records its own close().
// ---------------------------------------------------------------------------

function recCtx() {
    const ctx = {
        calls: [],
        fillStyle: null,
        imageSmoothingEnabled: null,
        setTransform(...a) { ctx.calls.push({ op: "setTransform", a }); },
        save() { ctx.calls.push({ op: "save" }); }, restore() { ctx.calls.push({ op: "restore" }); },   // the carry (§10.13)
        globalCompositeOperation: "source-over",
        fillRect(...a) { ctx.calls.push({ op: "fillRect", a, fill: ctx.fillStyle }); },
        clearRect(...a) { ctx.calls.push({ op: "clearRect", a }); },
        drawImage(...a) { ctx.calls.push({ op: "drawImage", a, smooth: ctx.imageSmoothingEnabled }); },
        ops() { return ctx.calls.map((c) => c.op); },
        of(op) { return ctx.calls.filter((c) => c.op === op); },
        clear() { ctx.calls.length = 0; },
    };
    return ctx;
}

/** The canvas factory the layer is given: a real element whose `getContext` records. */
function mkRec(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = recCtx();
    c.getContext = () => ctx;
    c.rec = ctx;
    return c;
}

let made = 0, closed = 0;
function mkBitmap(tag) {
    made++;
    return { tag, width: PLATE_PX, height: PLATE_PX, closed: false, close() { this.closed = true; closed++; } };
}

function mkCam(w = 1504, h = 812) {
    const lm = { width: w, height: h, depthOf: () => 0, frame: () => true, ensureSpine: () => "0" };
    const cam = new Camera(lm, {});
    cam.inScale = 1; cam.inPanX = 0; cam.inPanY = 0;
    return cam;
}

/** A timer that fires only when the test says so. */
function mkTimers() {
    const t = { armed: [], fired: 0 };
    t.set = (fn, ms) => { t.armed.push({ fn, ms, live: true }); return t.armed.length - 1; };
    t.clearT = (id) => { if (t.armed[id]) t.armed[id].live = false; };
    t.live = () => t.armed.filter((a) => a.live);
    t.fire = () => { const a = t.live().pop(); if (!a) return false; a.live = false; t.fired++; a.fn(); return true; };
    return t;
}

function mkLayer(opts = {}) {
    const cam = opts.cam || mkCam();
    const store = opts.store !== undefined ? opts.store : new PlateStore({ fresh: freshStub(), maxBytes: 64 * PLATE_BYTES, doc: null });
    const host = opts.host || document.createElement("div");
    const timers = opts.timers || mkTimers();
    const posted = [];
    const reposted = [];
    const layer = new PictureLayer(host, cam, {
        store, makeCanvas: mkRec, width: opts.width || 1504, height: opts.height || 812,
        dpr: opts.dpr || 1, paper: opts.paper,
        // the first argument is the REQUEST the misses belong to, not always the view (D160):
        // it is what a renderer packs the job from, so the suite records it field by field
        onPlates: (r, misses) => posted.push({ req: r, mode: r.mode, q: r.q, Zq: r.Zq, misses }),
        onRepost: (r, misses) => reposted.push({ req: r, mode: r.mode, q: r.q, Zq: r.Zq, misses }),
        setTimer: timers.set, clearTimer: timers.clearT,
        now: () => 1000,
    });
    return { layer, cam, store, host, timers, posted, reposted, ctx: layer._canvas.rec };
}

/** Cache every plate of a view's range, as the worker would deliver it. */
function fillRange(store, v, q, Zq) {
    const out = [];
    for (let j = v.j0; j <= v.j1; j++) {
        for (let i = v.i0; i <= v.i1; i++) {
            const key = plateKey(v.frameId, q, i, j);
            const bitmap = mkBitmap(key);
            store.put({ frameId: v.frameId, q, Zq, i, j, G: store.fresh.generation, bitmap });
            out.push({ key, bitmap });
        }
    }
    return out;
}

/** `want`'s own request shape for the view in force. */
const reqOf = (v) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq, i0: v.i0, i1: v.i1, j0: v.j0, j1: v.j1 });

/** A camera exactly AT a quantum: Z = 2^(q/4) to the bit. */
function atQuantum(cam, q, dpr) { cam.inScale = zqOf(q) / dpr; return cam; }
/** A camera at the worst stretch BETWEEN two quanta: an eighth of an octave off. */
function offQuantum(cam, q, dpr) { cam.inScale = (zqOf(q) * Math.pow(2, 1 / 8)) / dpr; return cam; }

beforeEach(() => { made = 0; closed = 0; resetPictureStats(); });

// ---------------------------------------------------------------------------
// C1 — the compose: the paper fill first, integer destinations, the smoothing
// flag, the blit count, a dropped plate, and the layer's dirty rule.
// ---------------------------------------------------------------------------

describe("C1 — the composite's call sequence", () => {
    test("the paper fill is the first thing in every compose, and no drawImage precedes it", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        expect(v.mode).toBe("plates");
        expect(v.s).toBe(1);
        fillRange(store, v, v.q, v.Zq);
        const got = store.want(reqOf(v));
        expect(got.hits.length).toBeGreaterThan(1);
        ctx.clear();
        const n = layer.compose(got.hits);
        const ops = ctx.ops();
        expect(ops[0]).toBe("setTransform");
        expect(ops[1]).toBe("fillRect");
        expect(ops.indexOf("drawImage")).toBeGreaterThan(ops.indexOf("fillRect"));
        expect(ctx.of("fillRect")[0].fill).toBe("#ffffff");
        expect(ctx.of("fillRect")[0].a).toEqual([0, 0, layer._canvas.width, layer._canvas.height]);
        expect(n).toBe(got.hits.length);
        expect(ctx.of("drawImage").length).toBe(got.hits.length);
        expect(pictureStats.paperFills).toBe(1);
    });

    test("every destination is a whole device pixel, and it is i·512 − ox + dx", () => {
        // dpr 2 so that inScale = Zq/dpr and Z = inScale·dpr round-trip exactly and s IS 1.
        const { layer, cam, store, ctx } = mkLayer({ dpr: 2 });
        atQuantum(cam, 3, 2);
        cam.inPanX = 37.4; cam.inPanY = -12.9;                 // a fractional pan: d is what snaps
        const v = layer.frameFor(cam, null);
        expect(v.s).toBe(1);
        fillRange(store, v, v.q, v.Zq);
        ctx.clear();
        const hits = store.want(reqOf(v)).hits;
        layer.compose(hits);
        expect(Number.isInteger(v.dx)).toBe(true);
        expect(Number.isInteger(v.dy)).toBe(true);
        const blits = ctx.of("drawImage");
        expect(blits.length).toBe(hits.length);
        for (const c of blits) {
            expect(Number.isInteger(c.a[1])).toBe(true);
            expect(Number.isInteger(c.a[2])).toBe(true);
        }
        for (let n = 0; n < hits.length; n++) {
            expect(blits[n].a[1]).toBe(hits[n].i * PLATE_PX - v.ox + v.dx);
            expect(blits[n].a[2]).toBe(hits[n].j * PLATE_PX - v.oy + v.dy);
        }
        expect(hits.some((h) => h.i !== v.i0)).toBe(true);      // more than the origin plate is checked
    });

    test("smoothing is off at the quantum and on between quanta", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        let v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(ctx.of("drawImage").every((c) => c.smooth === false)).toBe(true);

        offQuantum(cam, 0, 1);
        v = layer.frameFor(cam, null);
        expect(v.s).not.toBe(1);
        fillRange(store, v, v.q, v.Zq);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        const blits = ctx.of("drawImage");
        expect(blits.length).toBe(1);                          // one scaled blit of the layer canvas
        expect(blits[0].smooth).toBe(true);
        expect(layer._lctx.of("drawImage").every((c) => c.smooth === false)).toBe(true);
    });

    test("a plate dropped from the store leaves the last picture (§10.13), not paper and not the old bitmap", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const made0 = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        const gone = made0[0];
        store.dropQuantum(v.q);                                // the document changed under the whole screen
        const after = store.want(reqOf(v));
        expect(after.hits.length).toBe(0);
        ctx.clear();
        const carries = pictureStats.carryComposes;
        const n = layer.compose(after.hits);
        expect(n).toBe(0);
        expect(pictureStats.carryComposes).toBe(carries + 1);  // the canvas still holds the last picture
        expect(ctx.of("fillRect").length).toBe(0);             // so no paper goes over it (the camera did not move)
        expect(ctx.of("drawImage").length).toBe(0);            // and the closed bitmap is never drawn
        expect(layer.report().uncovered).toBe(0);
        expect(gone.bitmap.closed).toBe(true);
    });

    /**
     * PAPER-PLAN R1, and the inversion of what this test asserted before it: an invalidated plate
     * keeps its pixels and keeps being drawn — stale ink beats paper — and the paper comes back
     * only when the plates are really gone. The layer is CLEARED and not filled, so a cell it has
     * no plate for shows the ink canvas through it rather than the layer's own paper.
     */
    test("between quanta too: a dropped plate leaves the STALE bitmap, and paper only when it is really gone", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        cam.inPanX = 200.5; cam.inPanY = 140.25;
        const v = layer.frameFor(cam, null);
        const plates = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        const lay = layer._lctx;
        expect(lay.of("drawImage").length).toBe(plates.length);
        expect(lay.of("clearRect").length).toBe(1);            // transparent, not papered (§7.1)
        expect(lay.of("fillRect").length).toBe(0);
        const gone = plates[0];

        store.fresh.dirty();                                   // a change under every cell
        expect(store.size()).toBe(plates.length);              // R1: every record kept, every one stale
        const after = store.want(reqOf(v));
        expect(after.hits.length).toBe(plates.length);
        expect(after.misses.length).toBe(plates.length);       // and every one re-posted
        lay.clear();
        layer.compose(after.hits);
        // The SET did not change — the same records, the same bitmaps — so the layer is not even
        // recomposed and the stale picture simply stays on the screen. That is R1 at its cheapest.
        expect(pictureStats.layerRecomposes).toBe(1);
        expect(lay.of("drawImage").length).toBe(0);
        expect(gone.bitmap.closed).toBe(false);

        layer._layerDirty = true;                              // whatever dirties it next
        lay.clear();
        layer.compose(after.hits);
        expect(lay.of("drawImage").length).toBe(plates.length);
        expect(lay.of("clearRect").length).toBe(1);
        expect(lay.of("fillRect").length).toBe(0);
        expect(pictureStats.stalePlateBlits).toBe(plates.length);
        expect(pictureStats.staleComposes).toBe(1);

        // the replacement lands for one of them: that one is fresh, the rest are still stale ink
        store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: v.i0, j: v.j0,
            G: store.fresh.generation, bitmap: mkBitmap(gone.key) });
        expect(gone.bitmap.closed).toBe(true);                 // and only now is the old one closed

        store.dropAll();                                       // a frame event: paper is the honest answer
        expect(store.size()).toBe(0);
        lay.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(lay.of("clearRect").length).toBe(1);
        expect(lay.of("drawImage").length).toBe(0);
    });

    test("the layer canvas is recomposed only when it is dirty — a pan does not dirty it", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        cam.inPanX = 200.5; cam.inPanY = 140.25;               // away from a plate boundary
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        const hits = store.want(reqOf(v)).hits;
        layer.compose(hits);
        expect(pictureStats.layerRecomposes).toBe(1);
        layer.compose(hits);                                   // same set, same o
        expect(pictureStats.layerRecomposes).toBe(1);
        const i0 = v.i0, j0 = v.j0;
        cam.inPanX += 3;                                       // 3 device px at dpr 1
        layer.frameFor(cam, null);
        expect(v.i0).toBe(i0); expect(v.j0).toBe(j0);          // no tile change
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.layerRecomposes).toBe(1);          // d moved; the layer's content did not
        expect(pictureStats.blits).toBe(3);
    });

    /**
     * `covered` is what the hold is decided from (`holdsPartial`), and `_hits` is refreshed by
     * `compose(plates)` alone: an arrival-driven `compose()` reads the previous frame's set. So
     * the count must be taken INSIDE the published range — a set of six plates the range has
     * moved off covers none of it, however many of them are drawn.
     */
    test("covered counts only the published range, not the hit list that outlived it", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(true);
        expect(layer._nHits).toBe(6);

        // the screen shrinks and pans clear of the composed set — and no `compose(plates)` runs
        cam.lm.width = 600;
        layer.setSize(600, 812, 1);
        cam.inPanX -= 1536;                                    // three plate columns to the right
        layer.frameFor(cam, null);
        expect([v.i0, v.i1, v.j0, v.j1]).toEqual([3, 4, 0, 1]);
        expect(store.want(reqOf(v), { pin: "none" }).misses.length).toBe(4);   // none of it cached

        // one plate of the NEW range arrives and composes: six old plates are still drawn (they
        // are correct ink), and one of the range's four cells is covered
        const key = plateKey(v.frameId, v.q, 3, 0);
        expect(layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: 3, j: 0,
            bitmap: mkBitmap(key), G: store.fresh.generation })).toBe("cached");
        expect(layer._nHits).toBe(7);
        expect(layer.report().covered).toBe(false);            // 7 drawn, 1 in range, 4 wanted

        for (const [i, j] of [[4, 0], [3, 1], [4, 1]]) {
            const k = plateKey(v.frameId, v.q, i, j);
            layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, bitmap: mkBitmap(k), G: store.fresh.generation });
        }
        expect(layer.report().covered).toBe(true);             // all four cells of the range
    });

    /**
     * The same rule in the LAYER branch, which is the branch every held view takes: the count is
     * `_layerDrawn`, the plates drawn from INSIDE the published range, so a set the range has
     * outgrown cannot cover it however many of its plates the layer holds. The break-check is
     * counting every drawn plate instead — seven drawn against a six-cell range then reads
     * covered, and the branch at `s = 1` is the only one the suite could see it in.
     */
    test("between quanta too: covered counts the range, not the seven plates the layer drew", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);                                 // s = 0.9174: the layer branch
        const v = layer.frameFor(cam, null);
        expect([v.i0, v.i1, v.j0, v.j1]).toEqual([0, 3, 0, 1]);
        const hole = plateKey(v.frameId, v.q, 1, 1);           // seven of the eight: the hole is the point
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                const key = plateKey(v.frameId, v.q, i, j);
                if (key === hole) continue;
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
            }
        }
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer._nHits).toBe(7);
        expect(layer.report().covered).toBe(false);

        // the screen narrows and the range is six cells; the set still holds the two plates at
        // i = 3, which are OUTSIDE it and inside the layer canvas, so the recompose draws them
        cam.lm.width = 1000;
        layer.setSize(1000, 812, 1);
        layer.frameFor(cam, null);
        expect([v.i0, v.i1, v.j0, v.j1]).toEqual([0, 2, 0, 1]);
        layer.compose();                                       // an arrival's compose: the previous set
        expect(layer._lctx.of("drawImage").length).toBe(7);    // all seven drawn…
        expect(pictureStats.layerOverflow).toBe(0);            // …and none of them clipped by the canvas
        expect(layer.report().covered).toBe(false);            // five of the range's six cells
    });
});

// ---------------------------------------------------------------------------
// C2 — the snap in all three modes, and the mapping asserted as a POINT
// (§15.3 Q14): the failure FC2 exists to prevent is the ants 46 device px off
// the ink, which no assertion about `d` being an integer can see.
// ---------------------------------------------------------------------------

/**
 * One frame point mapped three ways: through the published affine (`p·k + t`, which is what
 * `antPaint.paintPhase` computes), through the plate destination plus the plate-local offset
 * (which is what the compose draws), and through the camera (the truth the snap moves by under
 * half a pixel).
 */
function mapThree(layer, ctx, v, cam, p) {
    const viaAffine = p * v.k + v.tx;
    const i = Math.floor((p * v.Zq) / PLATE_PX);
    const local = p * v.Zq - i * PLATE_PX;             // the plate-local coordinate of p
    const at = layer._hits.findIndex((h) => h && h.i === i && h.j === v.j0);
    expect(at).toBeGreaterThanOrEqual(0);              // p is on a plate this compose drew
    let viaPlate;
    if (v.s === 1) {
        viaPlate = ctx.of("drawImage")[at].a[1] + local;                 // the recorded destination
    } else {
        const lx = layer._lctx.of("drawImage")[at].a[1];                 // the plate's x IN the layer
        const blit = ctx.of("drawImage")[0];                             // the one scaled blit
        viaPlate = blit.a[5] + (lx + local) * v.s;
    }
    const viaCam = p * cam.inScale * v.dpr + cam.inPanX * v.dpr;
    return { viaAffine, viaPlate, viaCam };
}

describe("C2 — one snapped mapping, in all three modes", () => {
    test("the three camera states give an integral d, and the affine and the plate agree on a point", () => {
        // dpr 2: inScale = Zq/dpr and Z = inScale·dpr round-trip exactly, so "at a quantum"
        // really is s === 1 and the exactness below is the code's and not the fixture's.
        const { layer, cam, store, timers, ctx } = mkLayer({ dpr: 2 });
        const p = 137.25;                                      // a frame point with no special value
        const seen = [];
        /** Compose the whole screenful, then read the mapping off the recorded calls. */
        const take = (mode, v) => {
            fillRange(store, v, v.q, v.Zq);
            ctx.clear();
            if (layer._lctx) layer._lctx.clear();
            layer.compose(store.want(reqOf(v)).hits);
            seen.push({ mode, m: mapThree(layer, ctx, v, cam, p), s: v.s, dx: v.dx, dy: v.dy });
        };

        atQuantum(cam, 2, 2);
        cam.inPanX = 11.3; cam.inPanY = 4.7;
        let v = layer.frameFor(cam, null);
        expect(v.mode).toBe("plates"); expect(v.s).toBe(1);
        take("quantum", v);

        offQuantum(cam, 2, 2);
        v = layer.frameFor(cam, null);
        expect(v.mode).toBe("plates"); expect(v.s).not.toBe(1);
        take("between", v);

        // the settle: still for 150 ms off-quantum, and every exact plate delivered
        expect(timers.live().length).toBe(1);
        timers.fire();
        const req = layer.settleRequest();
        ctx.clear();
        for (let j = req.j0; j <= req.j1; j++) {
            for (let i = req.i0; i <= req.i1; i++) {
                layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i, j, bitmap: mkBitmap("e"), G: store.fresh.generation });
            }
        }
        v = layer.view();
        expect(v.mode).toBe("settle"); expect(v.q).toBe("e"); expect(v.s).toBe(1);
        seen.push({ mode: "settle", m: mapThree(layer, ctx, v, cam, p), s: v.s, dx: v.dx, dy: v.dy });

        expect(seen.length).toBe(3);
        let worstPlate = 0, worstCam = 0;
        for (const e of seen) {
            expect(Number.isInteger(e.dx)).toBe(true);
            expect(Number.isInteger(e.dy)).toBe(true);
            worstPlate = Math.max(worstPlate, Math.abs(e.m.viaAffine - e.m.viaPlate));
            worstCam = Math.max(worstCam, Math.abs(e.m.viaAffine - e.m.viaCam));
            if (e.s === 1) expect(e.m.viaAffine).toBe(e.m.viaPlate);   // exact where the compose is 1:1
        }
        // Measured, not chosen: the two orders of one product differ by float rounding only.
        expect(worstPlate).toBeLessThan(1e-9);
        expect(worstCam).toBeLessThanOrEqual(0.5 + 1e-9);        // the snap, and nothing else
    });

    test("d is integral in all three modes at four device-pixel ratios", () => {
        for (const dpr of [1, 1.5, 2, 2.625]) {
            const { layer, cam, store, timers } = mkLayer({ dpr });
            offQuantum(cam, 1, dpr);
            cam.inPanX = 3.33; cam.inPanY = -7.77;
            let v = layer.frameFor(cam, null);
            expect(Number.isInteger(v.dx) && Number.isInteger(v.dy)).toBe(true);
            timers.fire();
            const req = layer.settleRequest();
            for (let j = req.j0; j <= req.j1; j++) {
                for (let i = req.i0; i <= req.i1; i++) {
                    layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i, j, bitmap: mkBitmap("e"), G: store.fresh.generation });
                }
            }
            v = layer.view();
            expect(v.mode).toBe("settle");
            expect(Number.isInteger(v.dx) && Number.isInteger(v.dy)).toBe(true);
            atQuantum(cam, 1, dpr);
            v = layer.frameFor(cam, 0);                       // chords 0: the sync path, also s = 1
            expect(v.mode).toBe("sync");
            expect(Number.isInteger(v.dx) && Number.isInteger(v.dy)).toBe(true);
        }
    });

    test("view() is ONE object, and rev moves only when a published number moved", () => {
        const { layer, cam } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const a = layer.frameFor(cam, null);
        const rev0 = a.rev;
        expect(layer.view()).toBe(a);
        expect(layer.frameFor(cam, null)).toBe(a);
        expect(a.rev).toBe(rev0);                              // the camera did not move
        cam.inPanX += 1;
        layer.frameFor(cam, null);
        expect(a.rev).toBe(rev0 + 1);
        expect(layer.view()).toBe(a);
        // a pan too small to move a snapped number publishes nothing
        cam.inPanX += 0.01;
        layer.frameFor(cam, null);
        expect(a.rev).toBe(rev0 + 1);
    });

    test("FC2: this module holds exactly one Math.round, and it is the snap", () => {
        const src = fs.readFileSync(path.join(__dirname, "PictureLayer.js"), "utf8");
        const lines = src.split(/\r?\n/).filter((l) => l.includes("Math.round("));
        expect(lines.length).toBe(1);
        expect(lines[0]).toContain("FC2 snap");
        // and nothing else in the module computes s = Z / Zq
        expect(src.split("Z / Zq").length - 1).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// C3 — the synchronous path's switch and its hysteresis (§6.5).
// ---------------------------------------------------------------------------

describe("C3 — the sync/plates switch", () => {
    test("under the budget is sync, over twice it is plates, and it cannot flap", () => {
        const { layer, cam } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const step = (chords) => { cam.inPanX += 1; return layer.frameFor(cam, chords).mode; };

        expect(step(20000)).toBe("plates");
        expect(step(SYNC_CHORD_BUDGET + 1000)).toBe("plates");      // above the budget: still plates
        expect(step(SYNC_CHORD_BUDGET - 1)).toBe("sync");           // under it: synchronous
        expect(step(2 * SYNC_CHORD_BUDGET)).toBe("sync");           // 2× up is the way out
        expect(step(2 * SYNC_CHORD_BUDGET + 1)).toBe("plates");

        const flips0 = pictureStats.syncFlips;
        for (let i = 0; i < 20; i++) step(i % 2 ? SYNC_CHORD_BUDGET - 1 : 2 * SYNC_CHORD_BUDGET - 1);
        expect(pictureStats.syncFlips - flips0).toBe(1);            // one flip, then stable
    });

    test("a sync frame over SYNC_MAX_MS leaves the path; it comes back at half the chords it was slow at (D272)", () => {
        // Measured in Chrome by the testing round: 17 plates a giant stroke covered cost 130–187
        // ms a camera frame in sync mode at a chord estimate far under the budget.
        const { layer, cam } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const step = (chords) => { cam.inPanX += 1; return layer.frameFor(cam, chords).mode; };
        expect(step(100)).toBe("sync");
        layer.noteSyncCost(SYNC_MAX_MS + 1);                       // the renderer measured it slow
        const exits0 = pictureStats.syncCostExits;
        expect(step(100)).toBe("plates");
        expect(pictureStats.syncCostExits - exits0).toBe(1);
        expect(step(60)).toBe("plates");                            // not yet half the chords it was slow at
        expect(step(100)).toBe("plates");                           // ...and the same screen never flaps back
        expect(step(49)).toBe("sync");                              // half: a lighter screen by the estimate
        layer.noteSyncCost(1);
        expect(step(2 * SYNC_CHORD_BUDGET)).toBe("sync");           // the chord hysteresis is back
        expect(step(2 * SYNC_CHORD_BUDGET + 1)).toBe("plates");
        expect(pictureStats.syncCostExits - exits0).toBe(1);        // a chord exit is not a cost exit
    });

    test("no estimate is the plate path, and the mode is on the view and in the report", () => {
        const { layer, cam } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        expect(layer.frameFor(cam, null).mode).toBe("plates");
        expect(layer.frameFor(cam, undefined).mode).toBe("plates");
        cam.inPanX += 1;
        expect(layer.frameFor(cam, NaN).mode).toBe("plates");
        cam.inPanX += 1;
        const v = layer.frameFor(cam, 10);
        expect(v.mode).toBe("sync");
        expect(v.s).toBe(1);                                        // sync rasters at the exact zoom
        expect(v.Zq).toBe(v.Z);
        expect(layer.report().mode).toBe("sync");
    });
});

// ---------------------------------------------------------------------------
// C4 — the backing store, at four device-pixel ratios (edge case 4.8).
// ---------------------------------------------------------------------------

describe("C4 — the backing store is round(css × dpr)", () => {
    test("at dpr 1, 1.5, 2 and 2.625 the backing store is the PINNED integer, not a floor or a ceil", () => {
        // 4.8's own test is "the ink area in CSS-pixel terms is equal within 1 %", and in jsdom
        // there is no ink: computed from the backing store it is within 0.05 % of W·H whatever
        // the rounding does, so it cannot fail. The numbers below are the fixture instead — a
        // FLOOR moves 1219.5 → 1219 and a CEIL moves 2134.125 → 2135, and both are red here.
        const W = 1504, H = 813;                                    // an odd height, so ×1.5 is fractional
        const pinned = [[1, 1504, 813], [1.5, 2256, 1220], [2, 3008, 1626], [2.625, 3948, 2134]];
        for (const [dpr, pw, ph] of pinned) {
            const { layer } = mkLayer({ dpr, width: W, height: H });
            const c = layer._canvas;
            expect([c.width, c.height]).toEqual([pw, ph]);
            expect(c.style.width).toBe(W + "px");
            expect(c.style.height).toBe(H + "px");
            expect(layer.report().canvasBytes).toBe(pw * ph * 4);
        }
    });

    test("a dpr change resizes and keeps every plate (D27; §6.1's clause is struck)", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        const n = store.size();
        expect(n).toBeGreaterThan(0);
        layer.setSize(1504, 812, 2);
        expect(store.size()).toBe(n);                               // not one plate dropped
        expect(store.report().dpr).toBe(2);
        expect(layer._canvas.width).toBe(Math.round(1504 * 2));
    });
});

// ---------------------------------------------------------------------------
// C5 — the settle (§6.3, D24, D75, D83).
// ---------------------------------------------------------------------------

describe("C5 — the settle", () => {
    test("150 ms still off-quantum re-rasters the screenful once, keyed 'e', pinned with add", () => {
        const { layer, cam, store, timers, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const quantumPlates = fillRange(store, v, v.q, v.Zq);
        store.want(reqOf(v));                                       // the visible set, pinned "replace"
        const pinned0 = store.report().pinned;
        expect(timers.live().length).toBe(1);
        expect(timers.live()[0].ms).toBe(SETTLE_MS);

        timers.fire();
        expect(pictureStats.settles).toBe(1);
        expect(posted.length).toBe(1);
        const req = layer.settleRequest();
        const want = (req.i1 - req.i0 + 1) * (req.j1 - req.j0 + 1);
        expect(posted[0].misses.length).toBe(want);
        expect(posted[0].misses.every((m) => m.key.indexOf("|e|") > 0)).toBe(true);
        // What goes out with the misses is the SETTLE's request and not the published view: the
        // view is still the quantum's (D154), so a renderer packing from it would raster these
        // plates at the quantum's zoom and key them "e" (D160).
        expect(posted[0].req).toBe(req);
        expect(posted[0].req).not.toBe(layer.view());
        expect(posted[0].q).toBe("e");
        expect(posted[0].mode).toBe("settle");
        expect(posted[0].Zq).toBe(cam.inScale * 1);                 // Z, the exact zoom — not Zq
        expect(posted[0].Zq).not.toBe(layer.view().Zq);             // the view is the quantum's
        expect(layer.view().q).not.toBe("e");
        // "add" pins into the store's SECOND set and not into the visible one (D75, D178): a
        // "replace" want rebuilds the visible set from its own range, so a merged pin would be
        // gone by the renderer's next frame and the settle's plates evictable while they raster
        expect(store.report().pinned).toBe(pinned0);
        expect(store.report().pinnedAdded).toBe(want);
        store.want(reqOf(layer.view()));                            // the renderer's own next want
        expect(store.report().pinnedAdded).toBe(want);              // and the settle is still pinned
        expect(layer.view().mode).toBe("plates");                   // nothing is published until they arrive

        // The view is HELD until the whole settled screenful is in hand: one compose has one `s`
        // and one `o`, so a half-settled screen would be paper where the exact plates have not
        // arrived — a white flash at the end of every zoom.
        const blits0 = pictureStats.blits;
        for (let n = 0; n < posted[0].misses.length; n++) {
            const m = posted[0].misses[n];
            layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation });
            if (n < posted[0].misses.length - 1) {
                expect(layer.view().mode).toBe("plates");
                expect(pictureStats.blits).toBe(blits0);
            }
        }
        const vv = layer.view();
        expect(vv.mode).toBe("settle");
        expect(vv.q).toBe("e");
        expect(vv.s).toBe(1);
        expect(vv.Zq).toBe(cam.inScale * 1);
        expect(pictureStats.settlePublishes).toBe(1);
        expect(posted.length).toBe(1);                              // one re-raster, not one per arrival
        expect(quantumPlates.every((p) => !p.bitmap.closed)).toBe(true);
    });

    test("the first camera move after a settle drops q 'e' and leaves the quantum's plates alone", () => {
        const { layer, cam, store, timers, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        const quantumReq = reqOf(v);
        store.want(quantumReq);
        const cached0 = store.size();
        timers.fire();
        const req = { ...layer.settleRequest() };
        for (const m of posted[0].misses) {
            layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        expect(store.size()).toBe(cached0 + posted[0].misses.length);
        const drops0 = store.report().dropsByQ;

        cam.inPanX += 9;                                            // the first camera move
        layer.frameFor(cam, null);
        expect(pictureStats.settleDrops).toBe(1);
        expect(store.report().dropsByQ).toBe(drops0 + posted[0].misses.length);
        expect(store.size()).toBe(cached0);                         // the settled plates and only those
        // the quantum's own plates are untouched, and every settled bitmap — and only those — closed
        expect(store.want(quantumReq).hits.length).toBe(cached0);
        expect(made).toBe(cached0 + posted[0].misses.length);
        expect(closed).toBe(posted[0].misses.length);
        // a settled plate cannot come back as a hit at another zoom (D83)
        expect(store.want({ ...req, Zq: req.Zq * 2 }).hits.length).toBe(0);
    });

    /**
     * `dropQuantum("e")` unpins every settled plate it drops, so the `unpinAdded()` beside it in
     * `_onMove` clears exactly the rest: the keys of settled plates that were never cached. With
     * every plate delivered the two calls cannot be told apart, which is why one miss is left in
     * flight here (the third review of stage 5a; D178).
     */
    test("a settled plate that never arrived is unpinned by the camera move, not only dropped", () => {
        const { layer, cam, store, timers, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        store.want(reqOf(v));                                       // the renderer's own visible set
        timers.fire();
        const req = { ...layer.settleRequest() }, misses = posted[0].misses;
        expect(store.report().pinnedAdded).toBe(misses.length);

        for (const m of misses.slice(0, -1)) {                      // all but one arrive
            layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        const late = misses[misses.length - 1];
        expect(store.get(late.key)).toBeUndefined();                // still in flight: pinned, not cached
        expect(store.report().pinnedAdded).toBe(misses.length);
        expect(layer.report().settlePending).toBe(true);

        cam.inPanX += 9;                                            // the first camera move
        layer.frameFor(cam, null);
        expect(pictureStats.settleDrops).toBe(1);
        expect(store.report().pinnedAdded).toBe(0);                 // the drop took the cached keys; this took the last
    });

    test("the timer is cleared by every camera step, so a moving camera never settles", () => {
        const { layer, cam, timers } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        for (let i = 0; i < 10; i++) { cam.inPanX += 4; layer.frameFor(cam, null); }
        expect(timers.live().length).toBe(1);                       // one armed, nine cleared
        expect(timers.armed.length).toBe(10);
        atQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        expect(layer.view().s).toBe(1);
        expect(timers.live().length).toBe(0);                       // at a quantum there is nothing to settle
    });

    test("the settle stands while the camera is still, and the view does not fall back to the quantum", () => {
        const { layer, cam, store, timers, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        timers.fire();
        const req = layer.settleRequest();
        for (const m of posted[0].misses) {
            layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        const rev = layer.view().rev;
        for (let i = 0; i < 5; i++) layer.frameFor(cam, null);
        expect(layer.view().mode).toBe("settle");
        expect(layer.view().rev).toBe(rev);
        expect(store.report().dropsByQ).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// C6 — `syncCameraOnly`'s shape: a 3 px pan with no tile change.
// ---------------------------------------------------------------------------

describe("C6 — a 3 px pan with no tile change", () => {
    test("one compose, an integral translation, the same plate range, and no job", () => {
        const { layer, cam, store, ctx, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        cam.inPanX = 200.5; cam.inPanY = 140.25;                    // away from a plate boundary
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        const range0 = [v.i0, v.i1, v.j0, v.j1], dx0 = v.dx, recomposes0 = pictureStats.layerRecomposes;

        ctx.clear();
        cam.inPanX += 3;
        layer.frameFor(cam, null);
        const n = layer.compose(store.want(reqOf(v)).hits);
        expect([v.i0, v.i1, v.j0, v.j1]).toEqual(range0);
        expect(v.dx - dx0).toBe(3);
        expect(Number.isInteger(v.dx)).toBe(true);
        expect(n).toBe(1);
        expect(ctx.of("drawImage").length).toBe(1);
        expect(pictureStats.layerRecomposes).toBe(recomposes0);     // the layer's content did not move
        expect(posted.length).toBe(0);                              // the layer posts nothing
    });
});

// ---------------------------------------------------------------------------
// §2.7 FC1's half, FC3, FC4, FC5.
// ---------------------------------------------------------------------------

describe("FC1's half — the canvas is appended at z-index 0 and nothing else is touched", () => {
    test("two pre-existing children survive, ours carries the stack's own z-index, destroy takes only ours", () => {
        const host = document.createElement("div");
        const keep = document.createElement("div");
        const foreign = document.createElement("canvas");
        foreign.setAttribute("class", "not-ours");
        foreign.width = 11;
        host.appendChild(keep); host.appendChild(foreign);
        const { layer } = mkLayer({ host });
        expect(host.children.length).toBe(3);
        expect(host.children[0]).toBe(keep);
        expect(host.children[1]).toBe(foreign);
        expect(foreign.width).toBe(11);
        expect(foreign.getAttribute("class")).toBe("not-ours");
        const ink = host.children[2];
        expect(ink.getAttribute("class")).toBe("bl-ink");
        expect(ink.style.zIndex).toBe("0");
        expect(ink.style.position).toBe("absolute");
        expect(parseFloat(ink.style.left)).toBe(0);            // jsdom writes it back as "0px"
        expect(parseFloat(ink.style.top)).toBe(0);
        expect(ink.style.transformOrigin).toBe("0 0");
        layer.destroy();
        expect(host.children.length).toBe(2);
        expect(host.children[1]).toBe(foreign);
    });
});

describe("FC3 — compose() takes no camera", () => {
    test("two composes with the camera moved between them draw the same pixels and keep rev", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        const hits = store.want(reqOf(v)).hits;
        ctx.clear();
        layer.compose(hits);
        const first = ctx.of("drawImage").map((c) => [c.a[1], c.a[2]]);
        const rev = v.rev;
        cam.inPanX += 411.7; cam.inScale *= 1.37;                   // the camera moves under it
        ctx.clear();
        layer.compose(hits);
        expect(ctx.of("drawImage").map((c) => [c.a[1], c.a[2]])).toEqual(first);
        expect(layer.view().rev).toBe(rev);
    });
});

describe("FC4 — one rect type, one origin", () => {
    test("plateDestRect writes the caller's out, returns a count, and is OverlayBuffer.dirty's own shape", () => {
        const { layer, cam } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        cam.inPanX = 17.6;
        const v = layer.frameFor(cam, null);
        const out = { x0: -1, y0: -1, x1: -1, y1: -1 };
        expect(layer.plateDestRect(v, v.i0, v.j0, out)).toBe(1);
        expect(Object.keys(out)).toEqual(Object.keys(new OverlayBuffer(4, 4).dirty));
        for (const k of ["x0", "y0", "x1", "y1"]) expect(Number.isInteger(out[k])).toBe(true);
        // the origin is the ink canvas's top-left: plate (i0, j0) lands where the compose draws it
        expect(out.x0).toBe(v.i0 * PLATE_PX - v.ox + v.dx);
        expect(out.x1 - out.x0).toBe(PLATE_PX);                     // half-open
        // between quanta the destination is fractional and the rect contains it
        offQuantum(cam, 0, 1);
        const v2 = layer.frameFor(cam, null);
        layer.plateDestRect(v2, v2.i0 + 1, v2.j0, out);
        const x = ((v2.i0 + 1) * PLATE_PX - v2.ox) * v2.s + v2.dx;
        expect(out.x0).toBeLessThanOrEqual(x);
        expect(out.x1).toBeGreaterThanOrEqual(x + PLATE_PX * v2.s);
        expect(out.x1 - out.x0).toBeLessThanOrEqual(PLATE_PX * v2.s + 2);
    });
});

describe("FC5 — the stable view, caller-owned rects, nothing allocated per frame", () => {
    test("64 consecutive frames allocate nothing, and the counter moves when the set grows", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        const hits = store.want(reqOf(v)).hits;
        const out = { x0: 0, y0: 0, x1: 0, y1: 0 };
        layer.compose(hits);                                        // warm: the hit array is sized here
        const allocs0 = pictureStats.allocs;
        expect(allocs0).toBeGreaterThan(0);                         // the zero below means something
        const view0 = layer.view();
        for (let n = 0; n < 64; n++) {
            cam.inPanX += 1;
            const vv = layer.frameFor(cam, null);
            expect(vv).toBe(view0);
            layer.compose(store.want(reqOf(vv)).hits);
            layer.plateDestRect(vv, vv.i0, vv.j0, out);
        }
        expect(pictureStats.allocs).toBe(allocs0);
    });
});

// ---------------------------------------------------------------------------
// The other half of J5 — edge case 4.14, under A2 §3.1: a result held past a document change is
// stored behind (stale before paper) and re-posted; one a hard drop refused is discarded, re-posted
// and never composited, and the discard is logged with why.
// ---------------------------------------------------------------------------

describe("J5's other half — a result held past a document change", () => {
    test("a refused result: put says stale, nothing is composited for it, it is logged with why, and it is re-posted once", () => {
        const { layer, cam, store, ctx, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const miss = store.want(reqOf(v)).misses[0];
        store.beginJob("job-1", v, [miss], store.fresh.generation);
        store.dropFrames((f) => f === v.frameId);                   // the frame's id now means another place
        const bitmap = mkBitmap(miss.key);
        ctx.clear();
        const st = layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: miss.i, j: miss.j, bitmap, G: 0, jobId: "job-1" });
        expect(st).toBe("stale");
        expect(bitmap.closed).toBe(true);                           // the STORE closes it, not the layer
        expect(ctx.of("drawImage").length).toBe(0);
        expect(pictureStats.staleDrops).toBe(1);
        const log = layer.staleLog();
        expect(log.length).toBe(1);
        expect(log[0].key).toBe(miss.key);
        expect(log[0].why).toBe("behind");
        expect(log[0].when).toBe("arrival");
        expect(reposted.length).toBe(1);
        expect(reposted[0].misses[0].key).toBe(miss.key);
        expect(pictureStats.reposts).toBe(1);
    });

    test("a result held past a change with nothing stored is kept behind (stale before paper) and re-posted", () => {
        const { layer, cam, store, ctx, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const miss = store.want(reqOf(v)).misses[0];
        store.beginJob("job-1", v, [miss], store.fresh.generation);
        store.fresh.dirty();                                        // the document changed under it
        const bitmap = mkBitmap(miss.key);
        ctx.clear();
        const st = layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: miss.i, j: miss.j, bitmap, G: 0, jobId: "job-1" });
        expect(st).toBe("newer");
        expect(bitmap.closed).toBe(false);
        expect(ctx.of("drawImage").map((c) => c.a[0])).toContain(bitmap);   // old ink, not paper
        expect(pictureStats.staleDrops).toBe(0);
        expect(reposted.length).toBe(1);
        expect(reposted[0].misses[0].key).toBe(miss.key);
    });

    // OPEN-FLAGS F106: under a stream of invalidations no arrival is current, and refusing them all
    // kept the pixels from before the first one on screen.
    test("an arrival newer than the stale pixels on screen replaces them: composed, and still re-posted", () => {
        const { layer, cam, store, ctx, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const plates = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        const target = plates[0];
        store.fresh.dirty();                                        // the mark is added: every plate stale
        const got = store.want(reqOf(v));
        const miss = got.misses.find((m) => m.key === target.key);
        const G1 = store.fresh.generation;
        store.beginJob("job-1", v, [miss], G1);
        store.fresh.dirty();                                        // a bake step lands before the raster
        const bitmap = mkBitmap("newer");
        ctx.clear();
        const st = layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: miss.i, j: miss.j, bitmap, G: G1, jobId: "job-1" });
        expect(st).toBe("newer");
        expect(bitmap.closed).toBe(false);
        expect(target.bitmap.closed).toBe(true);                    // the older stale pixels are gone
        const drawn = ctx.of("drawImage").map((c) => c.a[0]);
        expect(drawn).toContain(bitmap);                            // and the newer ones are composed
        expect(drawn).not.toContain(target.bitmap);
        expect(reposted.length).toBe(1);                            // still behind: asked for again
        expect(reposted[0].misses[0].key).toBe(target.key);
        expect(pictureStats.staleNewer).toBe(1);
        expect(pictureStats.staleDrops).toBe(0);
    });

    test("a stale arrival for a plate no longer on screen is logged and NOT re-posted", () => {
        const { layer, cam, store, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const key = plateKey("77", v.q, 0, 0);
        store.put({ frameId: "77", q: v.q, Zq: v.Zq, i: 0, j: 0, G: 0, bitmap: mkBitmap(key) });
        store.fresh.dirty((c) => c.key === key);                    // behind the document
        const st = layer.onPlate({ frameId: "77", q: v.q, Zq: v.Zq, i: 0, j: 0, bitmap: mkBitmap(key), G: 0 });   // no newer than what is stored
        expect(st).toBe("stale");
        expect(pictureStats.staleUnwanted).toBe(1);
        expect(reposted.length).toBe(0);
        expect(layer.staleLog()[0].why).toBe("unwanted");
    });

    test("a plate that arrives for the view on screen is composed once", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const got = store.want(reqOf(v));
        layer.compose(got.hits);
        const miss = got.misses[0];
        ctx.clear();
        const st = layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: miss.i, j: miss.j, bitmap: mkBitmap(miss.key), G: store.fresh.generation });
        expect(st).toBe("cached");
        expect(pictureStats.arrivalComposes).toBe(1);
        expect(ctx.of("drawImage").length).toBe(1);
        expect(ctx.of("fillRect").length).toBe(1);
    });

    /**
     * §5.1: "one extra compose per arriving job, not one per plate". A compose is a full-canvas
     * paper fill plus a blit per plate, so the difference on measurement 4's own phone screen is
     * 15 composes a screenful against 5 — during the fill behind a zoom, which is what the
     * sentence exists to protect (D173).
     */
    test("one job's plates are ONE compose, where the same plates one at a time are six", () => {
        const a = mkLayer({ dpr: 1 });
        atQuantum(a.cam, 0, 1);
        const v = a.layer.frameFor(a.cam, null);
        const misses = a.store.want(reqOf(v)).misses;
        expect(misses.length).toBe(6);
        a.ctx.clear();
        const st = a.layer.onPlateBatch(misses.map((m) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq,
            i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: a.store.fresh.generation })));
        expect(st).toEqual(misses.map(() => "cached"));
        expect(pictureStats.arrivalComposes).toBe(1);
        expect(a.ctx.of("fillRect").length).toBe(1);                // one paper fill for the job
        expect(a.ctx.of("drawImage").length).toBe(6);               // every plate of it, once
        expect(a.layer.report().covered).toBe(true);

        // the control, and the cost the batch entry removes: six composes, six full-canvas paper
        // fills, and 21 blits for the same six plates
        resetPictureStats();
        const b = mkLayer({ dpr: 1 });
        atQuantum(b.cam, 0, 1);
        const v2 = b.layer.frameFor(b.cam, null);
        const m2 = b.store.want(reqOf(v2)).misses;
        b.ctx.clear();
        for (const m of m2) {
            b.layer.onPlate({ frameId: v2.frameId, q: v2.q, Zq: v2.Zq, i: m.i, j: m.j,
                bitmap: mkBitmap(m.key), G: b.store.fresh.generation });
        }
        expect(pictureStats.arrivalComposes).toBe(6);
        // six composes: the first paints paper, the five after carry the last picture instead (§10.13)
        expect(b.ctx.of("fillRect").length + pictureStats.carryComposes).toBe(6);
        expect(b.ctx.of("drawImage").length).toBe(1 + 2 + 3 + 4 + 5 + 6);
    });

    test("one job's stale plates are one re-post call, and `reposts` counts plates", () => {
        const { layer, cam, store, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const misses = store.want(reqOf(v)).misses.slice(0, 3);
        store.beginJob("job-1", v, misses, store.fresh.generation);
        expect(store.fresh.dirty()).toBeGreaterThan(0);
        const st = layer.onPlateBatch(misses.map((m) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq,
            i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: 0 })));
        expect(st).toEqual(["newer", "newer", "newer"]);           // stored behind: stale before paper
        expect(reposted.length).toBe(1);                            // one call for the job
        expect(reposted[0].misses.length).toBe(3);
        expect(reposted[0].req).toBe(layer.view());
        expect(pictureStats.reposts).toBe(3);                       // per PLATE, as one at a time reads
    });

    test("a hit rastered at another zoom is refused and counted, not blitted (D83's own failure)", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const hits = fillRange(store, v, v.q, v.Zq).map((p) => store.get(p.key));
        hits[0].Zq = v.Zq * 3.1;                                // what a settled plate looks like at another zoom
        ctx.clear();
        const n = layer.compose(hits);
        expect(n).toBe(hits.length - 1);
        expect(pictureStats.zqMismatch).toBe(1);
        expect(ctx.of("drawImage").length).toBe(hits.length - 1);
    });

    test("a stale SETTLED arrival is re-posted with the settle's own request, not the view", () => {
        const { layer, cam, store, timers, posted, reposted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        timers.fire();
        const req = layer.settleRequest();
        const miss = posted[0].misses[0];
        // the renderer's half: it posts the job and owns beginJob (§15.3 Q3)
        store.beginJob("job-e", req, [miss], store.fresh.generation);
        expect(store.fresh.dirty()).toBeGreaterThan(0);
        const st = layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: miss.i, j: miss.j,
            bitmap: mkBitmap(miss.key), G: 0 });
        expect(st).toBe("newer");
        expect(reposted.length).toBe(1);
        expect(reposted[0].req).toBe(req);                          // the settle's, at Z
        expect(reposted[0].q).toBe("e");
        expect(reposted[0].Zq).toBe(req.Zq);
        expect(reposted[0].req).not.toBe(layer.view());
    });

    test("a plate keyed 's' never reaches the store: the sync path is composed, not cached", () => {
        const { layer, cam, store, ctx, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, 10);                          // 10 chords: the sync path
        expect(v.q).toBe("s");
        const bitmap = mkBitmap("sync");
        ctx.clear();
        const st = layer.onPlate({ frameId: v.frameId, q: "s", Zq: v.Zq, i: v.i0, j: v.j0, bitmap, G: 0 });
        expect(st).toBe("stale");
        expect(store.size()).toBe(0);                               // nothing cached at "s" (D159)
        expect(pictureStats.syncRefused).toBe(1);
        expect(bitmap.closed).toBe(true);                           // the store never saw it, so we close it
        expect(layer.staleLog()[0].why).toBe("sync");
        expect(reposted.length).toBe(0);
        expect(ctx.of("drawImage").length).toBe(0);
        // and it cannot come back as a hit at another zoom, which is what caching it would cost
        expect(store.want(reqOf(v)).hits.length).toBe(0);
    });

    test("a raw-pixel plate is counted and skipped — the conversion is the client's (Q13)", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const miss = store.want(reqOf(v)).misses[0];
        layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: miss.i, j: miss.j, pixels: new Uint8ClampedArray(4), G: store.fresh.generation });
        expect(pictureStats.noBitmap).toBeGreaterThan(0);
        expect(ctx.of("drawImage").length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// The report (§8.5) and the release (§6.6).
// ---------------------------------------------------------------------------

describe("the report and the release", () => {
    test("report() is flat scalars with the mode, the quantum and the byte accounting", () => {
        const { layer, cam } = mkLayer({ dpr: 1.5 });
        offQuantum(cam, 0, 1.5);
        layer.frameFor(cam, null);
        layer.compose([]);
        const r = layer.report();
        expect(r.mode).toBe("plates");
        expect(r.dpr).toBe(1.5);
        expect(r.canvasBytes).toBe(layer._canvas.width * layer._canvas.height * 4);
        expect(r.layerBytes).toBe(layer._layer.width * layer._layer.height * 4);
        // flat scalars only — a nested object or an array here is F58's unbounded report
        for (const val of Object.values(r)) {
            expect(["number", "string", "boolean"].indexOf(typeof val)).toBeGreaterThanOrEqual(0);
        }
    });

    test("the layer canvas is allocated lazily, a whole number of plates, and freed on the release", () => {
        const { layer, cam } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        layer.compose([]);
        expect(layer._layer).toBe(null);                            // s = 1: no layer canvas at all
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        layer.compose([]);
        const W = layer._canvas.width, H = layer._canvas.height;
        // The SIZE is asserted as the property it has to hold, by the sweep below; here only
        // that it is plate-aligned and covers the screen, which a formula restated would not be.
        expect(layer._layer.width % PLATE_PX).toBe(0);
        expect(layer._layer.height % PLATE_PX).toBe(0);
        expect(layer._layer.width).toBeGreaterThanOrEqual(W + PLATE_PX);
        expect(layer._layer.height).toBeGreaterThanOrEqual(H + PLATE_PX);
        layer.onStoreRelease("hidden");
        expect(layer._layer).toBe(null);
        expect(pictureStats.layerBytes).toBe(0);
        expect(layer._canvas).not.toBe(null);                       // the ink canvas is the screen
    });

    /**
     * The property the size exists for (D158): **every plate of `plateRange` is drawn into the
     * layer canvas, at every camera state a held quantum can reach.** `s` falls to
     * `2^(−QUANTUM_HYSTERESIS/4)` = 0.8781, where the screen spans `W/(512·s)` plate pixels —
     * one column or row more than at the quantum — so a layer sized `floor(W/512)+2` skips the
     * surplus plate and composes paper over it. Both screens here are real: Kobin's phone is
     * measurement 4's own, and 1504 × 812 at dpr 1 is the rest of this suite's.
     */
    test("every plate of the range is drawn into the layer, at every camera state between quanta", () => {
        for (const scr of [{ w: 411, h: 750, dpr: 2.625 }, { w: 1504, h: 812, dpr: 1 }]) {
            const store = new PlateStore({ fresh: freshStub(), maxBytes: 256 * PLATE_BYTES, doc: null });
            const { layer, cam } = mkLayer({ ...scr, width: scr.w, height: scr.h, dpr: scr.dpr, store,
                cam: mkCam(scr.w, scr.h) });
            let states = 0, stretched = 0, worstCols = 0, worstRows = 0;
            for (let d = -0.749; d <= 0.749; d += 0.0749) {         // the drift the hysteresis holds
                cam.inScale = zqOf(0) / scr.dpr;
                layer.frameFor(cam, null);                          // the quantum in force is 0
                cam.inScale = Math.pow(2, d / 4) / scr.dpr;
                const s = Math.pow(2, d / 4);
                const pitch = (PLATE_PX * s) / scr.dpr;             // CSS px of pan per plate column
                for (let a = 0; a < 5; a++) {
                    for (let b = 0; b < 5; b++) {
                        cam.inPanX = (a / 5) * pitch + a * 1e-3;
                        cam.inPanY = (b / 5) * pitch + b * 1e-3;
                        const v = layer.frameFor(cam, null);
                        expect(v.q).toBe(0);                        // the hysteresis held it
                        const cols = v.i1 - v.i0 + 1, rows = v.j1 - v.j0 + 1;
                        worstCols = Math.max(worstCols, cols); worstRows = Math.max(worstRows, rows);
                        fillRange(store, v, v.q, v.Zq);
                        const hits = store.want(reqOf(v)).hits;
                        expect(hits.length).toBe(cols * rows);
                        // an empty set first, so the layer is dirty and every state recomposes:
                        // at one `o` with one plate set it is composed once and only once (C1)
                        layer.compose([]);
                        if (layer._layer) layer._layer.rec.clear();
                        layer.compose(hits);
                        states++;
                        if (v.s === 1) continue;                    // exactly at the quantum: no layer
                        // the layer holds the grid: every hit blitted into it, nothing skipped
                        expect(pictureStats.layerOverflow).toBe(0);
                        expect(layer._layer.rec.of("drawImage").length).toBe(hits.length);
                        expect(layer._layer.width).toBeGreaterThanOrEqual(cols * PLATE_PX);
                        expect(layer._layer.height).toBeGreaterThanOrEqual(rows * PLATE_PX);
                        stretched++;
                    }
                }
            }
            expect(states).toBe(525);
            expect(stretched).toBe(500);                            // 25 of them land exactly on s = 1
            // The sweep REACHES the wide state, which is what makes the assertions above able to
            // fail: the phone's screen spans 4 × 6 plates here where `floor(W/512)+2` allocates
            // 4 × 5, and this suite's own 1504 × 812 spans 5 × 3 where that formula gives 4 × 3.
            expect([worstCols, worstRows]).toEqual(scr.dpr === 1 ? [5, 3] : [4, 6]);
        }
    });

    /**
     * The counters exist so that a failure which leaves no wrong pixel in jsdom is still
     * countable in a field report (§8.5). Each one here is driven to a non-zero reading, so a
     * counter that stopped counting is a test failure and not a silent zero.
     */
    test("sizeMismatch, badZoom, quantumChanges and arrivalsOutside all read", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        expect(pictureStats.sizeMismatch).toBe(0);
        cam.lm.width = 2000;                                        // the engine resized, the layer did not
        cam.inPanX += 1;
        layer.frameFor(cam, null);
        expect(pictureStats.sizeMismatch).toBe(1);                  // counted, not silently dropped (Q11)
        cam.lm.width = 1504;

        cam.inScale = zqOf(1) / 1;                                  // a whole quantum step: past the hysteresis
        layer.frameFor(cam, null);
        expect(pictureStats.quantumChanges).toBe(1);
        expect(layer.view().q).toBe(1);

        const v = layer.frameFor(cam, null);
        const key = plateKey(v.frameId, v.q, v.i1 + 3, v.j0);       // a plate off the right of the screen
        expect(layer.onPlate({ frameId: v.frameId, q: v.q, Zq: v.Zq, i: v.i1 + 3, j: v.j0,
            bitmap: mkBitmap(key), G: store.fresh.generation })).toBe("cached");
        expect(pictureStats.arrivalsOutside).toBe(1);               // cached, composed nowhere
        expect(pictureStats.arrivalComposes).toBe(0);

        cam.inScale = -1;                                           // a zoom the camera should never hold
        expect(() => layer.frameFor(cam, null)).not.toThrow();
        expect(pictureStats.badZoom).toBe(1);
        expect(layer.view().Z).toBe(1);                             // read as 1 rather than thrown on
    });

    test("a null 2D context is counted and never thrown — jsdom's own case", () => {
        const host = document.createElement("div");
        const cam = mkCam();
        const layer = new PictureLayer(host, cam, { width: 800, height: 600, dpr: 1 });  // the real factory
        expect(layer._ctx).toBe(null);
        expect(pictureStats.noContext).toBeGreaterThan(0);
        atQuantum(cam, 0, 1);
        expect(() => { layer.frameFor(cam, null); layer.compose([]); }).not.toThrow();
        expect(pictureStats.blits).toBe(0);
        layer.destroy();
    });
});

// ---------------------------------------------------------------------------
// §6.3's retention — the held quantum (§15.3, "Stage 5a, checkpoint").
//
// A quantum change makes `want()` at the new `q` all misses, so a layer that published it
// would paint paper over the whole screen for as long as the re-raster takes (§8.6 row 14
// prices that at 0.3–0.5 s on the dense phone screen). The view is therefore HELD at the
// quantum that has plates and composes them stretched, while the NEWEST quantum's misses go
// out as their own request. What is asserted here is the published view, the store's pins and
// the counters — **not** what the stretch looks like, which is stage 7's (§9.4).
// ---------------------------------------------------------------------------

describe("§6.3's retention — the held quantum", () => {
    /** A camera `t` quarter-octaves up from `Z = 1`, at dpr 1: the quantum moves at |t − q| > 0.75. */
    const atT = (cam, t) => { cam.inScale = Math.pow(2, t / QUANTA_PER_OCTAVE); return cam; };
    /** The smallest stretch a view may publish, derived as `PictureLayer` derives it (§3.2, D188). */
    const S_MIN = Math.pow(2, -QUANTUM_HYSTERESIS / QUANTA_PER_OCTAVE);
    /** Deliver one of the incoming quantum's plates, as the renderer's result callback would. */
    const deliver = (layer, post, m) => layer.onPlate({ frameId: post.req.frameId, q: post.q,
        Zq: post.Zq, i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: layer.store.fresh.generation });
    /** Plates nothing wants, to push the cache over its cap. */
    function flood(store, n) {
        for (let i = 0; i < n; i++) {
            const key = plateKey("0", 99, i, 0);
            store.put({ frameId: "0", q: 99, Zq: 1, i, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        }
    }
    /** A screenful at the quantum in force, composed: the state a hold starts from. */
    function primed(opts) {
        const h = mkLayer(opts);
        atT(h.cam, 0);
        h.v = h.layer.frameFor(h.cam, null);
        h.plates = fillRange(h.store, h.v, h.v.q, h.v.Zq);
        h.layer.compose(h.store.want(reqOf(h.v)).hits);
        return h;
    }

    test("a zoom through three quanta with no arrivals keeps the last complete picture on screen", () => {
        const { layer, cam, store, ctx, posted, v } = primed({ dpr: 1 });
        expect(layer.report().covered).toBe(true);
        const q0 = v.q, Zq0 = v.Zq, sSeen = [];

        for (const t of [0.76, 1.76, 2.76]) {                       // three crossings, no arrival
            atT(cam, t);
            layer.frameFor(cam, null);
            ctx.clear();
            layer.compose(store.want(reqOf(v)).hits);
            sSeen.push(v.s);
            expect(v.q).toBe(q0);                                   // HELD: the dying quantum is what has plates
            expect(v.Zq).toBe(Zq0);
            expect(layer.report().held).toBe(true);
            // every plate of the published range drawn: no paper where the picture belongs
            expect(layer.report().covered).toBe(true);
            expect(ctx.of("drawImage").length).toBe(1);             // the stretched layer, not a blank fill
            expect(pictureStats.layerOverflow).toBe(0);
        }
        expect(pictureStats.quantumChanges).toBe(3);
        expect(pictureStats.holds).toBe(1);                         // one hold across three crossings
        expect(pictureStats.holdsPartial).toBe(0);
        // only the NEWEST quantum is ever requested: each crossing abandons the one before it
        expect(posted.map((p) => p.q)).toEqual([1, 2, 3]);
        expect(pictureStats.quantumAbandons).toBe(2);
        expect(posted.every((p) => p.req === layer.quantumRequest())).toBe(true);
        expect(layer.report().pendQ).toBe(3);
        // the two numbers stage 7 reads before deciding whether a stretch beats paper
        expect(pictureStats.heldComposes).toBe(3);
        expect(sSeen.map((s) => +s.toFixed(4))).toEqual([1.1408, 1.3566, 1.6133]);
        expect(pictureStats.holdMaxS).toBeCloseTo(sSeen[2], 12);
        expect(pictureStats.holdMinS).toBeCloseTo(sSeen[0], 12);
    });

    test("R5c: a zoom OUT holds down to half size, then publishes the live quantum with the held plates as stand-ins", () => {
        const { layer, cam, store, ctx, v } = primed({ dpr: 1 });
        const q0 = v.q;
        for (const t of [-0.76, -1.76, -2.76, -3.76]) {              // s 0.88 … 0.52: still held
            atT(cam, t);
            layer.frameFor(cam, null);
            layer.compose(store.want(reqOf(v)).hits);
            expect(layer.report().held).toBe(true);
            expect(v.q).toBe(q0);
        }
        expect(pictureStats.holdShrinks).toBe(0);
        atT(cam, -4.76);                                             // s 0.44: under S_MIN_HOLD
        layer.frameFor(cam, null);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.holdShrinks).toBe(1);
        expect(layer.report().held).toBe(false);
        expect(v.q).not.toBe(q0);                                    // the live quantum is published…
        expect(v.s).toBeGreaterThanOrEqual(S_MIN);
        const fb = ctx.of("drawImage").filter((c) => c.a.length === 5);
        expect(fb.length).toBeGreaterThan(0);                        // …and the held plates stand in, not paper
        expect(pictureStats.holdMinS).toBeGreaterThanOrEqual(0.5);
    });

    test("an arrival for the abandoned quantum is refused, counted and composed nowhere", () => {
        const { layer, cam, store, posted, v } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);                                  // hold at q 0, ask for q 1
        const first = posted[0];
        store.beginJob("j1", first.req, first.misses, 0);           // the renderer's own in-flight map
        const m = first.misses[0];

        atT(cam, 1.76);
        layer.frameFor(cam, null);                                  // q 2: the q-1 request is abandoned
        expect(pictureStats.quantumAbandons).toBe(1);
        expect(store.inflight.get(m.key).refused).toBe(true);       // the drop refuses its stragglers

        const blits0 = pictureStats.blits, bm = mkBitmap(m.key);
        const st = layer.onPlate({ jobId: "j1", frameId: first.req.frameId, q: first.q, Zq: first.Zq, i: m.i, j: m.j, bitmap: bm, G: 0 });
        expect(st).toBe("stale");
        expect(store.get(m.key)).toBeUndefined();
        expect(pictureStats.staleDrops).toBe(1);
        expect(pictureStats.staleUnwanted).toBe(1);                 // nothing wants that quantum: no re-post
        expect(pictureStats.reposts).toBe(0);
        expect(bm.closed).toBe(true);                               // the store closes what it refuses
        expect(pictureStats.blits).toBe(blits0);
        expect(layer.view().q).toBe(v.q);                           // still held
    });

    test("the complete newest set switches the view, keeps the old plates and unpins them", () => {
        const store = new PlateStore({ fresh: freshStub(), maxBytes: 16 * PLATE_BYTES, doc: null });
        const { layer, cam, posted, plates } = primed({ dpr: 1, store });
        expect(plates.length).toBe(6);

        atT(cam, 0.76);
        layer.frameFor(cam, null);
        const req = posted[0].req, misses = posted[0].misses;
        store.beginJob("j1", req, misses);
        expect(misses.length).toBe(8);

        for (let n = 0; n < misses.length; n++) {
            const m = misses[n];
            layer.onPlate({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq, i: m.i, j: m.j,
                bitmap: mkBitmap(m.key), G: store.fresh.generation });
            if (n < misses.length - 1) expect(layer.view().q).toBe(0);   // held until the set is complete
        }
        const vv = layer.view();
        expect(vv.q).toBe(1);
        expect(vv.Zq).toBe(zqOf(1));
        expect(vv.s).toBeCloseTo(Math.pow(2, 0.76 / QUANTA_PER_OCTAVE) / zqOf(1), 12);   // back inside the band
        expect(pictureStats.holdSwitches).toBe(1);
        expect(layer.report().held).toBe(false);
        expect(layer.report().pendQ).toBe("");
        expect(layer.report().covered).toBe(true);
        // a quantum change drops nothing (rule 5's neighbour): the old plates are still cached,
        // and what the switch takes away is their PIN
        expect(plates.every((p) => store.get(p.key))).toBe(true);
        expect(store.report().pinned).toBe(misses.length);

        // the proof: 12 fresh plates into a 16-plate cap evict the 6 unpinned old ones and 4 of
        // the newcomers, and not one of the 8 the switch pinned
        flood(store, 12);
        expect(plates.some((p) => store.get(p.key))).toBe(false);
        expect(misses.every((m) => store.get(m.key))).toBe(true);
        expect(store.size()).toBe(16);
    });

    /**
     * §6.3's third rule, and the one the first review could not see: the incoming plates must be
     * CACHED and the renderer's own `want(view)` — a "replace" — must have run after the layer's
     * `{pin:"add"}`, or nothing here can fail. A "replace" rebuilds the visible pin set from its
     * own range, so an added pin merged into it is discarded once a frame, and the incoming set
     * is evictable while it rasters (D178).
     */
    test("a pan while the new quantum is in flight evicts nothing held — and nothing incoming", () => {
        const store = new PlateStore({ fresh: freshStub(), maxBytes: 16 * PLATE_BYTES, doc: null });
        const { layer, cam, posted, plates, v } = primed({ dpr: 1, store });
        atT(cam, 0.76);
        layer.frameFor(cam, null);
        const req = posted[0].req, misses = posted[0].misses;
        store.beginJob("j1", req, misses);
        expect(misses.length).toBe(8);

        // seven of the eight arrive: the incoming set is cached and pinned, the eighth is still
        // in flight so the view is still held
        const inc = misses.slice(0, 7);
        for (const m of inc) {
            layer.onPlate({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq, i: m.i, j: m.j,
                bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        expect(layer.report().held).toBe(true);
        expect(inc.every((m) => !!store.get(m.key))).toBe(true);

        cam.inPanX -= 40;                                           // a pan during the flight
        layer.frameFor(cam, null);
        layer.compose(store.want(reqOf(v)).hits);                   // the renderer's own want pins the held set
        expect(layer.report().held).toBe(true);
        expect(layer.report().heldQ).toBe(0);
        expect(layer.report().covered).toBe(true);
        expect(posted.length).toBe(1);                              // in flight is not a miss: asked once
        // the two sets, pinned separately: the published range in the visible set, the incoming
        // range in the added one, which the "replace" above did not touch
        expect(store.report().pinned).toBe((v.i1 - v.i0 + 1) * (v.j1 - v.j0 + 1));
        expect(store.report().pinnedAdded).toBe(8);

        flood(store, 12);
        expect(plates.filter((p) => store.get(p.key)).length).toBe(6);
        expect(inc.every((m) => !!store.get(m.key))).toBe(true);    // neither set can evict the other
        expect(store.report().evictions).toBe(9);                   // nine of the flood, and nothing else
        expect(store.report().overCapPinned).toBe(0);
        expect(store.size()).toBe(16);

        // a pan that carries the screen off the held set entirely ends the hold rather than
        // publishing a range with no plates in it
        cam.inPanX -= 20000;
        layer.frameFor(cam, null);
        expect(layer.report().held).toBe(false);
        expect(layer.report().holdWhy).toBe("offscreen");
        expect(layer.view().q).toBe(1);                             // the live quantum, at last
    });

    /**
     * The clip is what makes "only the NEWEST quantum is ever requested" literally true, and a
     * zoom OUT is the only direction that can see it: the screen then covers MORE of the held
     * quantum's grid than the held set holds, so an unclipped range would publish plates that
     * were never rastered — paper inside the picture, and a `want` at the dying quantum.
     */
    test("a zoom out publishes the held set and not the screen: the clip, and no ask at the dying quantum", () => {
        const { layer, cam, store, v } = primed({ dpr: 1 });
        const held = [v.i0, v.i1, v.j0, v.j1];
        atT(cam, -0.8);                                             // out past the hysteresis: q −1
        layer.frameFor(cam, null);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().heldQ).toBe(0);
        expect(v.s).toBeCloseTo(Math.pow(2, -0.8 / QUANTA_PER_OCTAVE), 12);
        expect(v.s).toBeLessThan(1);
        expect([v.i0, v.i1, v.j0, v.j1]).toEqual(held);             // clipped to the held set…
        expect(store.want(reqOf(v)).misses.length).toBe(0);         // …so the renderer asks for nothing here
        expect(layer.report().covered).toBe(true);
        expect(pictureStats.layerOverflow).toBe(0);
    });

    /**
     * The hold is the mode in which `o` and `s` are furthest from the camera's own numbers, so
     * it is the mode most likely to put the ants a finger's width off the ink (§2.7 FC2's 46
     * device px). `k = Zq·s` is `Z` whatever the hold does to `Zq` and `s`, and this is the
     * assertion that says so on a held view rather than the arithmetic saying it.
     */
    test("the affine holds on a held view: k is Z at any stretch, so nothing can drift from the ink", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        cam.inPanX = 11.3; cam.inPanY = 4.7;                        // a pan with no special value
        atT(cam, 0);
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);

        atT(cam, 0.76);
        layer.frameFor(cam, null);
        expect(layer.report().held).toBe(true);
        ctx.clear();
        if (layer._lctx) layer._lctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        const m = mapThree(layer, ctx, v, cam, 137.25);
        expect(v.k).toBeCloseTo(cam.inScale * v.dpr, 12);           // k is Z, not the held Zq
        expect(Math.abs(m.viaAffine - m.viaPlate)).toBeLessThan(1e-9);
        expect(Math.abs(m.viaAffine - m.viaCam)).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Number.isInteger(v.dx)).toBe(true);
        expect(Number.isInteger(v.dy)).toBe(true);
    });

    test("with nothing composed there is nothing to hold: the new quantum is published at once", () => {
        const { layer, cam, posted } = mkLayer({ dpr: 1 });
        atT(cam, 0);
        layer.frameFor(cam, null);                                  // no plates, nothing composed
        atT(cam, 0.76);
        const v = layer.frameFor(cam, null);
        expect(pictureStats.quantumChanges).toBe(1);
        expect(pictureStats.holdSkips).toBe(1);
        expect(pictureStats.holds).toBe(0);
        expect(v.q).toBe(1);                                        // the behaviour before the hold, which is right here
        expect(layer.report().held).toBe(false);
        expect(posted.length).toBe(0);                              // the layer asks for nothing it is not holding for
    });

    /**
     * The one deviation from the checkpoint ruling's wording ("HELD at the last COMPLETE
     * quantum"): a PART-filled quantum is held too, because a part-filled picture still beats
     * paper (§6.3, `holdsPartial`). What that costs is asserted here rather than stated — the
     * renderer's own `want(view)` does have misses at the dying quantum, and this is how many.
     */
    test("a PART-filled quantum is held too, and the dying quantum's misses are a number", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atT(cam, 0);
        const v = layer.frameFor(cam, null);
        const skipped = plateKey(v.frameId, v.q, v.i0, v.j0);       // the top-left plate: inside any clip
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                const key = plateKey(v.frameId, v.q, i, j);
                if (key === skipped) continue;
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
            }
        }
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(false);                 // five of six: the hole is the point

        atT(cam, 0.76);
        layer.frameFor(cam, null);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().held).toBe(true);
        expect(pictureStats.holds).toBe(1);
        expect(pictureStats.holdsPartial).toBe(1);                  // the deviation, counted
        expect(v.q).toBe(0);
        expect(layer.report().covered).toBe(false);                 // still the hole it was held with
        // the stretched layer, not a paper screen — and under the hole, the last picture carried (§10.13)
        const draws = ctx.of("drawImage");
        expect(draws.filter((c) => c.a[0] === layer._layer).length).toBe(1);
        expect(draws.filter((c) => c.a[0] === layer._canvas).length).toBe(1);
        expect(draws.length).toBe(2);
        expect(pictureStats.layerOverflow).toBe(0);
        // the bound §6.3 states in words: what the renderer's own want asks for at the dying quantum
        expect(store.want(reqOf(v)).misses.map((m) => m.key)).toEqual([skipped]);
    });

    /**
     * Nothing else ends a hold on the stretch GROWING — a switch, a sync compose, a frame
     * change, a return, an offscreen pan, a release and a destroy are the seven exits (a settle
     * cannot be one: it does not run while a hold is in flight, D179) — and `s = Z/Zq` is
     * otherwise unbounded (the sweep above reaches 1.6133 in three crossings). `S_MAX_HOLD` is
     * where a smear stops beating paper; the pair below pins the constant and not the behaviour
     * either side of it, and the number is Kobin's at stage 7 (D174).
     */
    test("the hold ends past S_MAX_HOLD and publishes the live quantum — the older plates stand in, not paper", () => {
        const { layer, cam, store, ctx, posted, v } = primed({ dpr: 1 });
        atT(cam, 3.9);                                              // s = 2^0.975 = 1.9656: inside the bound
        layer.frameFor(cam, null);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().held).toBe(true);
        expect(v.q).toBe(0);
        expect(v.s).toBeCloseTo(Math.pow(2, 3.9 / QUANTA_PER_OCTAVE), 12);
        expect(v.s).toBeLessThan(S_MAX_HOLD);
        expect(pictureStats.holdBreaks).toBe(0);
        expect(layer.report().covered).toBe(true);
        store.beginJob("j4", posted[0].req, posted[0].misses);      // the renderer posted it: in flight

        atT(cam, 4.1);                                              // s = 2^1.025 = 2.0350: past it
        layer.frameFor(cam, null);
        expect(pictureStats.holdBreaks).toBe(1);
        expect(layer.report().held).toBe(false);
        expect(layer.report().holdWhy).toBe("stretch");
        expect(pictureStats.holds).toBe(1);                         // one hold, ended — not a second one
        expect(v.q).toBe(4);                                        // the LIVE quantum is published
        expect(v.Zq).toBe(zqOf(4));
        expect(v.s).toBeCloseTo(Math.pow(2, 4.1 / QUANTA_PER_OCTAVE) / zqOf(4), 12);
        expect(posted.length).toBe(1);                              // q 4 asked for once, at the crossing
        expect(posted[0].q).toBe(4);

        ctx.clear();
        if (layer._lctx) layer._lctx.clear();
        layer.compose(store.want(reqOf(v)).hits);                   // no plate at q 4 yet
        expect(layer.report().covered).toBe(false);                 // nothing at the published quantum
        expect(layer._lctx.of("drawImage").length).toBe(0);
        expect(layer._lctx.of("fillRect").length).toBe(0);          // the layer is cleared, not papered
        // …and the q-0 plates the break abandoned are still cached, so the fallback pass draws
        // them stretched by r = 2 and the screen is NOT paper. This is what D174's "paper, which
        // is the trade" no longer says (PAPER-PLAN R1).
        expect(pictureStats.fallbackBlits).toBeGreaterThan(0);
        expect(layer.report().screenCovered).toBe(true);
        const fb = ctx.of("drawImage").filter((c) => c.a.length === 5);
        expect(fb.length).toBe(pictureStats.fallbackBlits);
        expect(fb.every((c) => c.smooth === true)).toBe(true);      // a stand-in is a resample

        // The pending request is KEPT past the break (§6.3): those plates are the live
        // quantum's and the published view wants them, so they compose as ordinary arrivals —
        // asserted here rather than stated, because nothing else delivers one after a break.
        const m = posted[0].misses[0];
        ctx.clear();
        layer._lctx.clear();
        expect(layer.onPlate({ frameId: posted[0].req.frameId, q: 4, Zq: posted[0].Zq,
            i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation })).toBe("cached");
        expect(pictureStats.arrivalComposes).toBe(1);               // one arrival, one compose
        expect(layer._lctx.of("drawImage").length).toBe(1);         // the plate is in the layer
        // one nine-argument blit of the layer on the screen, over the fallbacks still under it:
        // the screen is not covered at q 4 yet, so the cover pass is still running
        expect(ctx.of("drawImage").filter((c) => c.a.length === 9).length).toBe(1);
        expect(pictureStats.reposts).toBe(0);
    });

    test("a zoom back to the held quantum ends the hold and drops the abandoned request", () => {
        const { layer, cam, store, posted } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);
        store.beginJob("j1", posted[0].req, posted[0].misses, 0);
        const m = posted[0].misses[0];

        atT(cam, 0.1);                                              // back past the hysteresis, to the held quantum
        layer.frameFor(cam, null);
        expect(layer.report().held).toBe(false);
        expect(layer.report().holdWhy).toBe("return");
        expect(pictureStats.quantumAbandons).toBe(1);               // dropped once, not twice
        expect(store.inflight.get(m.key).refused).toBe(true);       // its stragglers are refused on arrival
        expect(layer.view().q).toBe(0);
        expect(layer.report().pendQ).toBe("");
        layer.compose(store.want(reqOf(layer.view())).hits);
        expect(layer.report().covered).toBe(true);
    });

    /**
     * The settle is suppressed while a hold is in flight (D179). A held view is stretched by
     * definition, so the timer would arm at every crossing and ask for a THIRD screenful at
     * `q = "e"` beside the held and the incoming sets — 24 + 24 + 24 plates wanted against the
     * phone's 48-plate cap, which D170 raised for two. What is asserted is what is pinned and
     * what is posted, either side of the switch that re-arms it.
     */
    test("no settle is armed or fired while a hold is in flight: two pinned sets, never three", () => {
        const store = new PlateStore({ fresh: freshStub(), maxBytes: 16 * PLATE_BYTES, doc: null });
        const { layer, cam, timers, posted, v } = primed({ dpr: 1, store });
        expect(timers.live().length).toBe(0);                       // s === 1 at the quantum

        atT(cam, 0.76);
        layer.frameFor(cam, null);
        layer.compose(store.want(reqOf(v)).hits);                   // the renderer's own frame
        expect(layer.report().held).toBe(true);
        expect(v.s).toBeGreaterThan(1);                             // stretched: what would arm it
        expect(timers.live().length).toBe(0);
        expect(timers.fire()).toBe(false);
        expect(layer._settleNow()).toBe(false);                     // and it refuses if it is called
        expect(pictureStats.settles).toBe(0);
        expect(posted.length).toBe(1);                              // the incoming quantum, nothing at "e"
        expect(posted[0].q).toBe(1);
        expect(store.report().pinned).toBe(6);                      // the published (held) range
        expect(store.report().pinnedAdded).toBe(8);                 // the incoming range, and no third set

        const req = posted[0].req, misses = posted[0].misses;
        for (const m of misses) {
            layer.onPlate({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq, i: m.i, j: m.j,
                bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        expect(pictureStats.holdSwitches).toBe(1);
        expect(layer.report().held).toBe(false);
        expect(store.report().pinnedAdded).toBe(0);                 // unpinned at the switch (D178)
        expect(store.report().pinned).toBe(misses.length);
        // the hold ends into the switch, and the switch re-arms: the picture still settles
        expect(timers.live().length).toBe(1);
        expect(timers.live()[0].ms).toBe(SETTLE_MS);
        timers.fire();
        expect(pictureStats.settles).toBe(1);
        expect(posted[posted.length - 1].q).toBe("e");
    });

    /**
     * §10's 5b acceptance reads `arrivalComposes` as the per-job compose counter, so the compose
     * a job's last plate causes is counted whether it is the batch's own or the SWITCH's (D180).
     * A switch cannot wait for the batch: it publishes a new view.
     */
    test("a job whose last plate completes the switch logs ONE compose, and it is the arrival's", () => {
        const store = new PlateStore({ fresh: freshStub(), maxBytes: 32 * PLATE_BYTES, doc: null });
        const { layer, cam, posted } = primed({ dpr: 1, store });
        atT(cam, 0.76);
        layer.frameFor(cam, null);
        const req = posted[0].req, misses = posted[0].misses;
        store.beginJob("j1", req, misses);
        const composes0 = pictureStats.composes;
        const recs = misses.map((m) => ({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq,
            i: m.i, j: m.j, bitmap: mkBitmap(m.key), G: store.fresh.generation }));

        const out = layer.onPlateBatch(recs);
        expect(out).toEqual(misses.map(() => "cached"));
        expect(pictureStats.holdSwitches).toBe(1);
        expect(pictureStats.composes - composes0).toBe(1);          // one compose for a job of eight
        expect(pictureStats.arrivalComposes).toBe(1);               // counted as the arrival's (D180)
        expect(layer.view().q).toBe(1);
    });

    /**
     * The switch publishes the quantum it switched TO (D183). An arrival runs off the rAF cycle,
     * so the camera can have crossed a quantum since the last `frameFor`: a publish that re-derived
     * the quantum from the camera would cross it HERE — a second hold at the DYING quantum, whose
     * `Zq` every incoming hit is then refused against, which is a paper screen in the one case the
     * hold exists to remove. 1.04 quanta between the last `frameFor` and the last arrival is a
     * wheel step, or a render loop stalled behind the workers.
     */
    test("a switch whose publish would cross a quantum still publishes the quantum it switched to", () => {
        const { layer, cam, store, ctx, posted } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);                                  // hold at q 0, ask for q 1
        const req = posted[0].req, misses = posted[0].misses;
        store.beginJob("j1", req, misses);
        expect(misses.length).toBe(8);
        for (const m of misses.slice(0, 7)) {
            layer.onPlate({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq, i: m.i, j: m.j,
                bitmap: mkBitmap(m.key), G: store.fresh.generation });
        }
        expect(layer.report().held).toBe(true);                     // seven of eight: still held

        atT(cam, 1.8);                                              // the camera crosses into q 2…
        const last = misses[7];
        ctx.clear();
        layer.onPlate({ frameId: req.frameId, q: posted[0].q, Zq: posted[0].Zq, i: last.i, j: last.j,
            bitmap: mkBitmap(last.key), G: store.fresh.generation });       // …with no frameFor between

        const v = layer.view();
        expect(pictureStats.holdSwitches).toBe(1);
        expect(v.q).toBe(1);                                        // the quantum switched to, not the dying one
        expect(v.Zq).toBe(zqOf(1));
        expect(v.s).toBeCloseTo(Math.pow(2, 1.8 / QUANTA_PER_OCTAVE) / zqOf(1), 12);
        expect(pictureStats.zqMismatch).toBe(0);                    // every incoming hit composable
        expect(layer.report().covered).toBe(true);
        expect(layer.report().held).toBe(false);
        expect(pictureStats.holds).toBe(1);                         // one hold, ended — not a second one
        expect(pictureStats.quantumChanges).toBe(1);
        expect(ctx.of("drawImage").length).toBe(1);                 // the layer, not a paper screen

        // and the next camera step is the ordinary path: it holds THESE plates and asks for q 2
        layer.frameFor(cam, null);
        expect(pictureStats.quantumChanges).toBe(2);
        expect(pictureStats.holds).toBe(2);
        expect(layer.report().heldQ).toBe(1);
        expect(posted[posted.length - 1].q).toBe(2);
    });

    /**
     * D183 took the drift out of the quantum the switch publishes and left it in the STRETCH:
     * stage 4 publishes `_pend.Zq` against the camera as it is now. Below `S_MIN` the published
     * range has more plate columns than the layer canvas was sized for, and `_recomposeLayer`
     * skips the surplus — D158's own failure, one direction over (D188). The state is reachable
     * because a quantum change drops nothing (§5.4 rule 5): the enlarged range is cached from an
     * earlier visit to that quantum, so the last arrival finds the set complete.
     */
    test("a switch that would publish a stretch UNDER S_MIN is refused, and the next step re-quantises", () => {
        const { layer, cam, store, posted } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);                                  // hold at q 0, ask for q 1
        layer.compose(store.want(reqOf(layer.view())).hits);        // the renderer's own frame: 5 columns
        const post = posted[0], misses = post.misses;
        store.beginJob("j1", post.req, misses);
        for (const m of misses.slice(0, 7)) deliver(layer, post, m);
        expect(layer.report().held).toBe(true);

        atT(cam, -3);                                               // 3.76 quanta OUT, with no frameFor
        const r = plateRange(cam.frameWindow(0), zqOf(1));           // what the drifted camera needs
        const last = misses[7];
        for (let j = r.j0; j <= r.j1; j++) {
            for (let i = r.i0; i <= r.i1; i++) {
                const key = plateKey(post.req.frameId, 1, i, j);
                if (key === last.key || store.get(key)) continue;
                store.put({ frameId: post.req.frameId, q: 1, Zq: zqOf(1), i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
            }
        }
        expect((r.i1 - r.i0 + 1) * PLATE_PX).toBeGreaterThan(layer._layer.width);   // 6 columns into 5
        expect(Math.pow(2, -3 / QUANTA_PER_OCTAVE) / zqOf(1)).toBeLessThan(S_MIN);  // s would be 0.5

        expect(deliver(layer, post, last)).toBe("cached");           // the set is complete, and refused
        expect(pictureStats.switchRefusedLow).toBe(1);
        expect(pictureStats.holdSwitches).toBe(0);
        expect(layer.view().q).toBe(0);                              // nothing published: still held
        expect(layer.report().held).toBe(true);
        expect(layer.report().pendQ).toBe(1);                        // and the request stands
        expect(pictureStats.arrivalComposes).toBe(0);

        layer.frameFor(cam, null);                                   // the next camera step re-quantises
        expect(pictureStats.quantumAbandons).toBe(1);
        expect(layer.report().pendQ).toBe(-3);
        layer.compose(store.want(reqOf(layer.view())).hits);
        expect(pictureStats.layerOverflow).toBe(0);                  // which is what the refusal buys
    });

    /**
     * The mirror, and the direction that is easy to reach: a zoom IN while the job is in flight
     * shrinks the incoming range, so a set delivered for the wide range reads complete at the
     * narrow one and the switch publishes whatever stretch the camera has drifted to. Past
     * `S_MAX_HOLD` that is the smear the hold's own bound forbids (D174, D188), so the switch is
     * refused and the next camera step ends the hold on the same bound.
     */
    test("a switch that would publish a stretch OVER S_MAX_HOLD is refused, and the hold then breaks", () => {
        const { layer, cam, store, posted } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);
        const post = posted[0], misses = post.misses;
        store.beginJob("j1", post.req, misses);
        for (const m of misses.slice(0, 7)) deliver(layer, post, m);
        expect(layer.report().held).toBe(true);

        atT(cam, 5.4);                                               // 4.64 quanta IN, with no frameFor
        expect(Math.pow(2, 5.4 / QUANTA_PER_OCTAVE) / zqOf(1)).toBeGreaterThan(S_MAX_HOLD);  // 2.1435
        expect(deliver(layer, post, misses[7])).toBe("cached");
        expect(pictureStats.switchRefusedHigh).toBe(1);
        expect(pictureStats.holdSwitches).toBe(0);
        expect(layer.view().q).toBe(0);
        expect(layer.report().held).toBe(true);
        expect(layer.report().pendQ).toBe(1);
        expect(pictureStats.arrivalComposes).toBe(0);

        layer.frameFor(cam, null);                                   // the next camera step
        expect(pictureStats.holdBreaks).toBe(1);                     // the same bound, on the ordinary path
        expect(layer.report().held).toBe(false);
        expect(layer.report().holdWhy).toBe("stretch");
        expect(layer.view().q).toBe(5);                              // the LIVE quantum — paper, the trade
        expect(pictureStats.quantumAbandons).toBe(1);
        expect(layer.report().pendQ).toBe("");
    });

    /**
     * The incoming set is ONE screenful, not the union of the gesture's (D184): `_askQuantum`
     * re-asks once a camera step, so a set that accumulated pinned every incoming range a pan
     * passed through — measured at 20 plates of the phone's 48-plate cap over 20 panned frames of
     * one hold, where §6.6 prices that cap at one held screenful plus one incoming one.
     */
    test("a pan during a hold pins one incoming screenful, not the union of the steps", () => {
        const { layer, cam, store } = primed({ dpr: 1 });
        atT(cam, 0.76);
        layer.frameFor(cam, null);
        const cells = (r) => (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1);
        const columns = new Set();
        expect(store.report().pinnedAdded).toBe(8);

        for (let n = 0; n < 4; n++) {
            cam.inPanX -= 300;
            layer.frameFor(cam, null);
            const r = layer.quantumRequest();
            for (let i = r.i0; i <= r.i1; i++) columns.add(i);
            expect(layer.report().held).toBe(true);                 // the hold runs through the pan
            expect(store.report().pinnedAdded).toBe(cells(r));
        }
        expect(cells(layer.quantumRequest())).toBe(8);              // four columns, two rows, every step
        expect(columns.size).toBe(6);                               // the union is six columns: 12 plates
        expect(store.report().pinnedAdded).toBe(8);                 // and it is not what is pinned
    });
});

// ---------------------------------------------------------------------------
// Stage 5b's two additive amendments to this file (§15.3 "Stage 5b", Q1 and Q2)
// ---------------------------------------------------------------------------

describe("what 5b reads: the published status, and the sync path's surface", () => {
    /** A camera `t` quarter-octaves up from `Z = 1`, at dpr 1. */
    const atT = (cam, t) => { cam.inScale = Math.pow(2, t / QUANTA_PER_OCTAVE); return cam; };

    /**
     * The renderer has to know when a quantum or a settle has DIED, so it can drop that `q`'s
     * queued strips with `dropQueued(why, deadQ)` (§10 stage 5b items 16 and 17). The callbacks
     * cannot say so — `_askQuantum` calls `onPlates` only when there ARE misses — and a
     * ~50-field `report()` on the render path is the per-frame allocation FC5 forbids.
     */
    test("status() is ONE object, mutated in place, naming the live, pending and held quanta", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atT(cam, 0);
        const v = layer.frameFor(cam, null);
        const st = layer.status();
        expect(st).toBe(layer.status());                        // one object, never re-created
        expect(st.q).toBe(v.q);
        expect(st.pendQ).toBe("");                              // "" for none, never null (F58)
        expect(st.heldQ).toBe("");
        expect(st.settlePending).toBe(false);

        fillRange(store, v, v.q, v.Zq);                         // a complete screen: there is something to hold
        layer.compose(store.want(reqOf(v)).hits);
        const q0 = v.q;
        atT(cam, 1.76);                                         // across a quantum
        layer.frameFor(cam, null);
        expect(layer.status()).toBe(st);                        // the same object still
        expect(st.heldQ).toBe(q0);                              // the quantum with plates is held
        expect(st.q).toBe(q0);                                  // ...and it is what is published
        expect(st.pendQ).toBe(layer.quantumRequest().q);        // the incoming one is asked for
        expect(st.pendQ).not.toBe(q0);
    });

    test("status() reports a settle that is waiting, and stops when it publishes", () => {
        const { layer, cam, store, timers } = mkLayer({ dpr: 1 });
        cam.inScale = Math.pow(2, 0.5 / QUANTA_PER_OCTAVE);     // off-quantum: s ≠ 1, so a settle arms
        const v = layer.frameFor(cam, null);
        fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.status().settlePending).toBe(false);
        expect(timers.fire()).toBe(true);                       // 150 ms still, off-quantum
        expect(layer.status().settlePending).toBe(true);

        const req = layer.settleRequest();
        fillRange(store, req, "e", req.Zq);                     // the settled screenful arrives
        layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i: req.i0, j: req.j0,
            bitmap: mkBitmap("late"), G: 0 });
        expect(layer.status().settlePending).toBe(false);
    });

    /**
     * §6.5's plates are rastered on the main thread and composed, never cached, and they go into
     * the LAYER canvas — in sync mode `s` is 1, so `compose` takes the 1:1 branch and that canvas
     * is idle. The alternative was a pool of up to 28 canvases, +25–29 MB while the sync path is
     * in force (§15.3 Q1).
     */
    test("syncSurface() hands back the layer canvas, allocated once and marked dirty", () => {
        const { layer } = mkLayer({ dpr: 1 });
        const before = pictureStats.canvasAllocs;               // the ink canvas
        const L = layer.syncSurface();
        expect(L).toBeTruthy();
        expect(pictureStats.canvasAllocs).toBe(before + 1);
        expect(layer.syncSurface()).toBe(L);                    // no second surface, ever
        expect(pictureStats.canvasAllocs).toBe(before + 1);
        expect(layer._layerDirty).toBe(true);                   // what is in it is not the plate grid
        expect(L.width).toBeGreaterThanOrEqual(1504);           // the worst-case grid, §6.6's row
    });

    /**
     * D202's (a), ASSERTED rather than read: the renderer puts the sync path's plates into the
     * layer canvas because a hold can never be in force there. `_frame` ends any hold on the
     * sync branch, so a frame that goes light while a quantum is held publishes `s = 1` and the
     * compose takes the 1:1 branch — the held picture is not in that canvas any more and cannot
     * be painted over. §15.3's Q1 of 15:20 made option (b) conditional on exactly this.
     */
    test("a hold ENDS when the frame goes light: sync mode and a hold are never both in force", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);                    // no estimate: the plate path
        const q0 = v.q;                                         // the view is ONE object, mutated in place (FC5)
        fillRange(store, v, v.q, v.Zq);                         // a complete screen, so there is a hold to take
        layer.compose(store.want(reqOf(v)).hits);
        offQuantum(cam, 2, 1);                                  // across a quantum, and off it: s ≠ 1
        const held = layer.frameFor(cam, null);
        expect(layer.status().heldQ).toBe(q0);
        expect(held.s).not.toBe(1);
        const recomposes = pictureStats.layerRecomposes;
        ctx.clear();

        // The ink goes light — the renderer's chord estimate drops under the budget — and the
        // same camera step takes §6.5's path.
        const sync = layer.frameFor(cam, SYNC_CHORD_BUDGET - 1);
        expect(sync.mode).toBe("sync");
        expect(sync.s).toBe(1);
        expect(layer.status().heldQ).toBe("");                  // the hold is gone, not overdrawn
        expect(layer.report().holdWhy).toBe("sync");

        // ...and the compose takes the 1:1 branch, which is what leaves the layer canvas free
        // for the synchronously rastered plates: no recompose of it, and no scaled blit of it.
        layer.compose([]);
        expect(pictureStats.layerRecomposes).toBe(recomposes);
        expect(ctx.imageSmoothingEnabled).toBe(false);          // the 1:1 branch's own flag
        expect(ctx.of("drawImage").filter((c) => c.a[0] === layer._layer).length).toBe(0);   // the scaled branch would blit the layer
    });

    test("BREAK-CHECK: with the sync branch's `_endHold` refused, the layer publishes sync WITH a hold", () => {
        // What D202 (a) is a claim about: if the exclusivity ever broke, the renderer would put
        // synchronously rastered plates into a canvas the held picture is composed from.
        class KeepsHold extends PictureLayer {
            _endHold(why) { return why === "sync" ? false : super._endHold(why); }
        }
        const cam = mkCam();
        const store = new PlateStore({ fresh: freshStub(), maxBytes: 64 * PLATE_BYTES, doc: null });
        const layer = new KeepsHold(document.createElement("div"), cam, {
            store, makeCanvas: mkRec, width: 1504, height: 812, dpr: 1,
            onPlates: () => {}, onRepost: () => {},
            setTimer: () => 0, clearTimer: () => {}, now: () => 1000,
        });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const q0 = v.q;
        fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        offQuantum(cam, 2, 1);
        layer.frameFor(cam, null);
        expect(layer.status().heldQ).toBe(q0);

        const sync = layer.frameFor(cam, SYNC_CHORD_BUDGET - 1);
        expect(sync.mode).toBe("sync");
        expect(layer.status().heldQ).toBe(q0);                  // both in force: the assertion above, red
        layer.destroy();
    });

    /**
     * THE EMPTY PLATE (§15.3, stage 5b's checkpoint Q1). A plate with no ink comes back with
     * neither a bitmap nor pixels — `rasterWorker.runJob` serialises nothing when `drawn` is 0 —
     * and the renderer prices it at 0 bytes. It is the paper, so it COVERS its cell: counted in
     * `noBitmap` instead, a blank screen would report a delivery failure on every compose and a
     * partial hold at every quantum change, which is the report this build exists for.
     */
    test("a blank screen's plates are usable and paint nothing: covered, no partial hold, no noBitmap", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                // The record the renderer builds for an empty plate: no bitmap, no pixels, 0 bytes.
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: 0, bytes: 0 });
            }
        }
        const got = store.want(reqOf(v));
        expect(got.misses.length).toBe(0);
        expect(layer.compose(got.hits)).toBe(0);                // nothing blitted...
        expect(layer.report().covered).toBe(true);              // ...and the screen is covered
        expect(pictureStats.noBitmap).toBe(0);
        expect(pictureStats.plateBlits).toBe(0);

        // The quantum change then has a complete screen to hold, and holds it without a partial.
        atQuantum(cam, 2, 1);
        layer.frameFor(cam, null);
        expect(pictureStats.holdsPartial).toBe(0);
        expect(pictureStats.holds).toBe(1);
        expect(pictureStats.noBitmap).toBe(0);
    });

    test("BREAK-CHECK: priced at a full plate, the same blank screen reads as a delivery failure", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: 0 });   // bytes defaulted
            }
        }
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.noBitmap).toBeGreaterThan(0);
        expect(layer.report().covered).toBe(false);
        atQuantum(cam, 2, 1);
        layer.frameFor(cam, null);
        expect(pictureStats.holdsPartial).toBe(1);              // the hold D188 would report on a blank screen
    });
});

// ---------------------------------------------------------------------------
// C7 — PAPER-PLAN R1's compose: the cross-quantum cover set on the ink canvas.
//
// The measured defect is 65 % of the canvas white for ~550 ms on a zoom out, at a frame
// reporting `covered: true` (`10-MOCK-USER-TESTING-REPORT.md:121`): the ring outside a held
// view's CLIPPED published range was never composed at all. Under R1 the compose draws, under
// everything else, any cached plate of the same frame at another quantum, stretched by
// `r = Zq_view / Zq_plate`. Nothing here is a picture — the assertions are the recorded call
// sequence, the destinations and the counters.
// ---------------------------------------------------------------------------

describe("C7 — the fallback compose", () => {
    const atT = (cam, t) => { cam.inScale = Math.pow(2, t / QUANTA_PER_OCTAVE); return cam; };
    /** A screenful at q 0, composed: the state a hold starts from. */
    function primed(opts) {
        const h = mkLayer(opts);
        atT(h.cam, 0);
        h.v = h.layer.frameFor(h.cam, null);
        h.plates = fillRange(h.store, h.v, h.v.q, h.v.Zq);
        h.layer.compose(h.store.want(reqOf(h.v)).hits);
        return h;
    }
    /** The fallback blits a compose recorded: five arguments, against a hit's three and a layer's nine. */
    const fbOf = (ctx) => ctx.of("drawImage").filter((c) => c.a.length === 5);

    test("a dropped plate leaves the stale bitmap, not paper (the 1:1 branch)", () => {
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const plates = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        expect(ctx.of("drawImage").length).toBe(plates.length);

        store.fresh.dirty();                                    // a change under every cell
        ctx.clear();
        const after = store.want(reqOf(v));
        const n = layer.compose(after.hits);
        expect(n).toBe(plates.length);                          // every one of them still drawn
        expect(ctx.of("drawImage").length).toBe(plates.length);
        expect(ctx.of("fillRect").length).toBe(1);              // the paper is still painted first, under it
        expect(plates.some((p) => p.bitmap.closed)).toBe(false);
        expect(pictureStats.stalePlateBlits).toBe(plates.length);
        expect(pictureStats.staleComposes).toBe(1);
        expect(layer.report().covered).toBe(true);              // stale ink covers: it is ink
        expect(pictureStats.fallbackBlits).toBe(0);             // and nothing needed standing in for
    });

    test("a stale plate is re-posted once while it stands, and the compose keeps drawing it", () => {
        const { layer, cam, store, ctx, reposted } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const plates = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        store.fresh.dirty();
        const misses = store.want(reqOf(v)).misses;
        expect(misses.length).toBe(plates.length);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);               // the stale picture is what is on screen
        expect(ctx.of("drawImage").length).toBe(plates.length);
        expect(pictureStats.stalePlateBlits).toBe(plates.length);
        const G = store.fresh.generation;
        store.beginJob("job-r", v, misses, G);
        expect(store.want(reqOf(v)).misses.length).toBe(0);     // in flight: not asked for twice

        // the re-post arrives at the current G, and nothing is re-posted a second time
        const st = layer.onPlateBatch(misses.map((m) => ({ frameId: v.frameId, q: v.q, Zq: v.Zq,
            i: m.i, j: m.j, bitmap: mkBitmap(m.key), G })));
        expect(st.every((x) => x === "cached")).toBe(true);
        expect(reposted.length).toBe(0);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.stalePlateBlits).toBe(plates.length);   // the one stale compose above, and no more
    });

    test("the fallback is drawn under the current plates, coarsest first", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        // two older quanta cached under the whole screen, and the current one dropped
        for (const q of [-8, -4]) {
            const Zq = zqOf(q);
            for (let j = 0; j <= 1; j++) {
                for (let i = 0; i <= 1; i++) {
                    const key = plateKey(v.frameId, q, i, j);
                    store.put({ frameId: v.frameId, q, Zq, i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
                }
            }
        }
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);

        const blits = ctx.of("drawImage");
        const fb = fbOf(ctx);
        expect(fb.length).toBeGreaterThan(1);
        expect(fb.length).toBe(pictureStats.fallbackBlits);
        expect(blits.slice(0, fb.length)).toEqual(fb);          // every one of them before any hit
        expect(pictureStats.fallbackComposes).toBe(1);
        expect(pictureStats.fallbackMaxR).toBe(zqOf(0) / zqOf(-8));
        // coarsest first: the q −8 plates are drawn wider than the q −4 ones, and come first
        const widths = fb.map((c) => c.a[3]);
        for (let k = 1; k < widths.length; k++) expect(widths[k]).toBeLessThanOrEqual(widths[k - 1]);
    });

    test("a fallback lands where the ink is: the published affine, to 1e-9", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        const q = -4, Zq = zqOf(q);
        const key = plateKey(v.frameId, q, 0, 0);
        store.put({ frameId: v.frameId, q, Zq, i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        const fb = fbOf(ctx);
        expect(fb.length).toBe(1);
        const r = v.Zq / Zq;
        expect(fb[0].a[1]).toBeCloseTo((PLATE_PX * 0 * r - v.ox) * v.s + v.dx, 9);
        expect(fb[0].a[2]).toBeCloseTo((PLATE_PX * 0 * r - v.oy) * v.s + v.dy, 9);
        expect(fb[0].a[3]).toBeCloseTo(PLATE_PX * r * v.s, 9);
        expect(fb[0].a[3]).toBe(fb[0].a[4]);                    // square
        // and it is the SAME affine the ants take: X = p·k + tx at the plate grid's own origin
        expect(fb[0].a[1]).toBeCloseTo(0 * v.k + v.tx, 9);
    });

    test("a settled plate is never a fallback (D83)", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        for (let j = 0; j <= 1; j++) {
            for (let i = 0; i <= 3; i++) {
                const key = plateKey(v.frameId, "e", i, j);
                store.put({ frameId: v.frameId, q: "e", Zq: 1.7, i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
            }
        }
        store.dropQuantum(v.q);
        ctx.clear();
        layer.dropCarry();                                       // the last picture is not a stand-in here either
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.fallbackBlits).toBe(0);
        expect(fbOf(ctx).length).toBe(0);
        expect(layer.report().screenCovered).toBe(false);
    });

    test("another frame's plate is drawn through the lattice's affine, at its mapped place (R5a)", () => {
        const cam = mkCam();
        cam.lm.frameFactor = (G, F) => (G === "6" ? 1 : null);
        cam.lm.mapPointF = (p, G, F) => (G === "6" ? [p[0] - 256, p[1]] : null);
        const { layer, store, ctx, v } = primed({ dpr: 1, cam });
        const key = plateKey("6", -4, 0, 0);
        store.put({ frameId: "6", q: -4, Zq: zqOf(-4), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.crossFrameBlits).toBe(1);
        const fb = fbOf(ctx);
        expect(fb.length).toBe(1);
        // corner (0, 0) in frame 6 is (-256, 0) in the view's frame; its plate is 1024 units wide at Zq 1/2
        expect(fb[0].a[1]).toBeCloseTo((-256 * v.Zq - v.ox) * v.s + v.dx, 9);
        expect(fb[0].a[3]).toBeCloseTo(PLATE_PX * (v.Zq / zqOf(-4)) * v.s, 9);
    });

    test("another frame's plate is never a fallback", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        const key = plateKey("6", -4, 0, 0);
        store.put({ frameId: "6", q: -4, Zq: zqOf(-4), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.fallbackBlits).toBe(0);
        expect(fbOf(ctx).length).toBe(0);
    });

    test("at the quantum the fallback goes straight to the ink canvas, and no layer is allocated", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        expect(v.s).toBe(1);
        const key = plateKey(v.frameId, -4, 0, 0);
        store.put({ frameId: v.frameId, q: -4, Zq: zqOf(-4), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(fbOf(ctx).length).toBe(1);
        expect(layer.report().hasLayer).toBe(false);
        expect(pictureStats.layerOverflow).toBe(0);
    });

    test("a coarse fallback that overhangs the canvas is clipped by it, not refused", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        const key = plateKey(v.frameId, -12, 0, 0);             // r = 8: one plate over the whole screen
        store.put({ frameId: v.frameId, q: -12, Zq: zqOf(-12), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        store.dropQuantum(v.q);
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        const fb = fbOf(ctx);
        expect(fb.length).toBe(1);
        expect(fb[0].a[3]).toBe(PLATE_PX * 8 * v.s);            // 4096 device px into a 1504 px canvas
        expect(pictureStats.layerOverflow).toBe(0);             // the guard at :698 is the LAYER's
        expect(pictureStats.fallbackRefused).toBe(0);
        expect(pictureStats.fallbackMaxR).toBe(8);
        expect(layer.report().screenCovered).toBe(true);
    });

    test("covered is the published range, screenCovered is the screen", () => {
        // The held, clipped view the testing round measured at `covered: true` with 65 % white:
        // the layer holds the whole held set, the published range is clipped to it, and the ring
        // outside it was never composed at all.
        const { layer, cam, store, v } = primed({ dpr: 1 });
        const q0 = v.q;
        atT(cam, 0.76);                                          // a crossing: the view is held at q 0
        layer.frameFor(cam, null);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().held).toBe(true);
        expect(v.q).toBe(q0);
        expect(layer.report().covered).toBe(true);               // every cell of the PUBLISHED range
        expect(layer.report().screenCovered).toBe(true);         // and the held set is the whole screen

        // with nothing cached at all, the range is not covered — the screen is, by the last picture (§10.13)
        store.dropQuantum(q0);
        expect(store.size()).toBe(0);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(false);
        expect(layer.report().screenCovered).toBe(true);
        // ...and with no last picture either, neither number can be true
        layer.dropCarry();
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(false);
        expect(layer.report().screenCovered).toBe(false);
    });

    test("the cover pass does not run on a covered screen, and never in settle mode", () => {
        const { layer, cam, store, timers, v } = primed({ dpr: 1 });
        expect(pictureStats.fallbackScans).toBe(0);              // the steady state pays nothing
        const key = plateKey(v.frameId, -4, 0, 0);
        store.put({ frameId: v.frameId, q: -4, Zq: zqOf(-4), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        layer.compose(store.want(reqOf(v)).hits);
        expect(pictureStats.fallbackScans).toBe(0);
        expect(pictureStats.fallbackBlits).toBe(0);

        // the settle publishes at q "e" with an exact screenful: a fallback there would be ink at
        // a zoom nothing can name (D83), so the pass is refused by the mode alone
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, null);
        timers.fire();
        const req = layer.settleRequest();
        for (let j = req.j0; j <= req.j1; j++) {
            for (let i = req.i0; i <= req.i1; i++) {
                layer.onPlate({ frameId: req.frameId, q: "e", Zq: req.Zq, i, j, bitmap: mkBitmap("e"),
                    G: store.fresh.generation });
            }
        }
        expect(layer.view().mode).toBe("settle");
        const scans = pictureStats.fallbackScans;
        layer.compose();
        expect(pictureStats.fallbackScans).toBe(scans);
    });

    /**
     * The abandon path is `abandonQuantum`, not `dropQuantum` (PAPER-PLAN §7.1): the plates of a
     * quantum the camera moved past are the best stand-ins on the screen, and only their
     * in-flight stragglers have to be refused. With `dropQuantum` there they are closed and the
     * ring is paper again.
     */
    test("the quantum a second crossing abandoned is still a fallback", () => {
        const { layer, cam, store, ctx, v } = primed({ dpr: 1 });
        const q0 = v.q;
        atT(cam, 0.76);                                          // hold at q 0, ask for q 1
        layer.frameFor(cam, null);
        const pend = layer.quantumRequest();
        const q1 = pend.q;                                       // the request object is re-aimed below
        const key = plateKey(pend.frameId, q1, pend.i0, pend.j0);
        expect(layer.onPlate({ frameId: pend.frameId, q: pend.q, Zq: pend.Zq, i: pend.i0, j: pend.j0,
            bitmap: mkBitmap(key), G: store.fresh.generation })).toBe("cached");
        expect(layer.report().holdSwitches).toBe(0);             // one of several: no switch

        atT(cam, 1.76);                                          // q 2: the q-1 request is abandoned
        layer.frameFor(cam, null);
        expect(pictureStats.quantumAbandons).toBe(1);
        expect(!!store.get(key)).toBe(true);                     // its PIXELS are kept…
        expect(store.isExact(store.get(key))).toBe(true);        // …and they are not stale: nothing changed

        store.dropQuantum(q0);                                   // the held picture goes: only the abandoned one is left
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(false);
        expect(fbOf(ctx).length).toBe(1);
        expect(pictureStats.fallbackBlits).toBe(1);
        expect(pictureStats.fallbackMaxR).toBeCloseTo(zqOf(q0) / zqOf(q1), 12);
    });

    /**
     * The measured defect itself, in the one state it happens in: a zoom OUT holds the old
     * quantum and CLIPS the published range to the held set, so the screen's own range is larger
     * than the range the layer holds — `covered` reads true while the ring outside is white
     * (`10-MOCK-USER-TESTING-REPORT.md:121`, 65 % of the canvas for ~550 ms). Two things fix it:
     * the fallback pass draws an older quantum's plate across the whole screen, and the layer is
     * blitted by its PUBLISHED SUB-RECTANGLE so its own margin cannot bury the ring.
     */
    test("between quanta the layer blit is the published range's sub-rectangle, so it cannot bury the ring", () => {
        const { layer, cam, store, ctx, v } = primed({ dpr: 1 });
        const q0 = v.q;
        atT(cam, -0.76);                                         // a zoom OUT: the view is held at q 0
        layer.frameFor(cam, null);
        expect(layer.report().held).toBe(true);
        expect(v.q).toBe(q0);
        expect(v.s).toBeLessThan(1);
        // the published range is CLIPPED to the held set, and the screen wants more than that
        expect(layer._rFull.i1).toBeGreaterThan(v.i1);

        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().covered).toBe(true);               // every cell of the PUBLISHED range…
        expect(layer.report().screenCovered).toBe(false);        // …and the ring is white: the measured lie
        expect(pictureStats.fallbackScans).toBe(1);              // the gate fires on the clip alone

        // one coarse plate, cached from before the gesture, covers the whole screen
        const key = plateKey(v.frameId, -8, 0, 0);
        store.put({ frameId: v.frameId, q: -8, Zq: zqOf(-8), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(key) });
        ctx.clear();
        layer._layerDirty = true;
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer.report().screenCovered).toBe(true);
        const fb = fbOf(ctx);
        expect(fb.length).toBe(1);

        const blit = ctx.of("drawImage").find((c) => c.a.length === 9);
        expect(blit.a[3]).toBe((v.i1 - v.i0 + 1) * PLATE_PX);    // the source is the range, not the canvas
        expect(blit.a[4]).toBe((v.j1 - v.j0 + 1) * PLATE_PX);
        expect(blit.a[3]).toBeLessThan(layer._layer.width);      // which is smaller than the layer
        expect(blit.a[7]).toBeCloseTo(blit.a[3] * v.s, 9);
        // and the ring's own pixels are the fallback's, not the layer's margin
        expect(blit.a[5] + blit.a[7]).toBeLessThan(fb[0].a[1] + fb[0].a[3]);
    });

    /** Plates of quantum `q` over the whole screen of a view at the origin: what a zoom leaves cached. */
    function screenAt(store, v, q, w = 1504, h = 812) {
        const Zq = zqOf(q), t = PLATE_PX / Zq;
        for (let j = 0; j * t < h; j++) {
            for (let i = 0; i * t < w; i++) {
                const key = plateKey(v.frameId, q, i, j);
                store.put({ frameId: v.frameId, q, Zq, i, j, G: store.fresh.generation, bitmap: mkBitmap(key) });
            }
        }
    }

    test("FB1 a zoom-out's many finer stand-ins: the compose draws at most its image budget, the cover first, and no paper", () => {
        // Kobin's Chrome, 2026-09-23: 48 stand-ins a compose cost ~100 ms each (34+ distinct images), 33 cost ~2 ms.
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1, store: new PlateStore({ fresh: freshStub(), maxBytes: 400 * PLATE_BYTES, doc: null }) });
        atT(cam, 0);
        const v = layer.frameFor(cam, null);
        const coarse = plateKey(v.frameId, -8, 0, 0);
        store.put({ frameId: v.frameId, q: -8, Zq: zqOf(-8), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(coarse) });
        for (let q = 1; q <= 4; q++) screenAt(store, v, q);          // the quanta the zoom-out came through: 62 plates
        ctx.clear();
        layer.compose(store.want(reqOf(v)).hits);
        const fb = fbOf(ctx);
        expect(fb.length).toBeLessThanOrEqual(COMPOSE_IMAGES - 1);   // the carry's image is the other one
        expect(fb.length).toBeGreaterThan(20);                        // the budget is spent, not refused
        expect(fb[0].a[0].tag).toBe(coarse);                          // the cover, under everything
        expect(pictureStats.fallbackOverBudget).toBeGreaterThan(0);
        expect(layer.uncoveredCells()).toBe(0);
        // the nearest zoom is kept whole before any finer one: every q 1 plate is drawn
        const drawn = new Set(fb.map((c) => c.a[0].tag));
        for (const k of store.cache.keys()) if (k.split("|")[1] === "1") expect(drawn.has(k)).toBe(true);
    });

    test("FB2 a stand-in wholly under the view's own plates is not drawn; the one over the missing cell is", () => {
        const { layer, store, ctx, v } = primed({ dpr: 1 });
        const coarse = plateKey(v.frameId, -8, 0, 0);
        store.put({ frameId: v.frameId, q: -8, Zq: zqOf(-8), i: 0, j: 0, G: store.fresh.generation, bitmap: mkBitmap(coarse) });
        screenAt(store, v, 1);
        store._remove(plateKey(v.frameId, v.q, 1, 0));                // one cell of the view's own is gone
        ctx.clear();
        resetPictureStats();
        layer.compose(store.want(reqOf(v)).hits);
        const fb = fbOf(ctx);
        expect(fb.length).toBeGreaterThan(0);
        expect(pictureStats.fallbackCulled).toBeGreaterThan(0);
        const hole = [(1 * PLATE_PX - v.ox) * v.s + v.dx, (0 - v.oy) * v.s + v.dy, PLATE_PX * v.s];
        for (const c of fb) {
            const [x, y, w] = [c.a[1], c.a[2], c.a[3]];
            expect(x < hole[0] + hole[2] && x + w > hole[0] && y < hole[1] + hole[2] && y + w > hole[1]).toBe(true);
        }
        expect(layer.uncoveredCells()).toBe(0);
    });

    test("E1 between quanta an empty plate is painted paper in the layer, over the stand-in under its cell (review 2)", () => {
        const { layer, cam, store } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        expect(v.s).not.toBe(1);
        for (let j = v.j0; j <= v.j1; j++) {
            for (let i = v.i0; i <= v.i1; i++) {
                const key = plateKey(v.frameId, v.q, i, j), empty = i === v.i0 && j === v.j0;
                store.put({ frameId: v.frameId, q: v.q, Zq: v.Zq, i, j, G: store.fresh.generation, bitmap: empty ? null : mkBitmap(key), bytes: empty ? 0 : PLATE_BYTES });
            }
        }
        layer.compose(store.want(reqOf(v)).hits);
        const fills = layer._layer.rec.of("fillRect");
        const x = v.i0 * PLATE_PX - v.ox, y = v.j0 * PLATE_PX - v.oy;
        expect(fills.some((c) => c.a[0] === x && c.a[1] === y && c.a[2] === PLATE_PX)).toBe(true);   // red before: left clear, the ink canvas showed through
    });

    test("a plate the store removed between composes is refused, not drawn on a closed bitmap", () => {
        // `_hits` holds store entries across composes and an entry outside the published range is
        // unpinned and evictable; `drawImage` on a closed ImageBitmap throws in Chrome. `_remove`
        // marks the entry dead first and the drawable test refuses it (PAPER-PLAN §7.1).
        const { layer, cam, store, ctx } = mkLayer({ dpr: 1 });
        atQuantum(cam, 0, 1);
        const v = layer.frameFor(cam, null);
        const plates = fillRange(store, v, v.q, v.Zq);
        layer.compose(store.want(reqOf(v)).hits);
        expect(layer._nHits).toBe(plates.length);

        store.dropAll();                                         // every entry removed and closed
        expect(plates.every((p) => p.bitmap.closed)).toBe(true);
        expect(layer._hits[0].dead).toBe(true);
        ctx.clear();
        expect(() => layer.compose()).not.toThrow();              // the same set, now dead
        expect(ctx.of("drawImage").length).toBe(0);
        expect(pictureStats.deadRefused).toBe(plates.length);
        expect(layer.report().covered).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// R2 — the preview (PAPER-PLAN §7.2/§7.4): a zoom OUT asks the screen at q − 8 first.
// ---------------------------------------------------------------------------

describe("R2 — the preview", () => {
    test("a zoom-OUT quantum change aims the preview at q − 8, unpinned, asked before the incoming quantum", () => {
        const { layer, cam, store, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, 20000);                                 // plates at q 0; the view's own misses
        expect(posted.some((p) => p.mode === "preview")).toBe(false);   // no quantum change yet
        const before = posted.length;
        offQuantum(cam, -1, 1);                                     // out by one quantum: the ring is paper
        layer.frameFor(cam, 20000);
        const after = posted.slice(before);
        const iPrev = after.findIndex((p) => p.mode === "preview");
        const iQuant = after.findIndex((p) => p.mode === "quantum");
        expect(iPrev).toBeGreaterThanOrEqual(0);
        // `offQuantum` lands half a quantum ABOVE its argument, so the live quantum is what
        // `quantumFor` rounded to — read it back rather than assume it.
        const qLive = layer._qPrev;
        expect(after[iPrev].q).toBe(qLive - PREVIEW_QUANTA);
        expect(after[iPrev].Zq).toBe(zqOf(qLive - PREVIEW_QUANTA));
        if (iQuant >= 0) expect(iPrev).toBeLessThan(iQuant);       // the preview goes out first
        expect(layer.status().prevQ).toBe(qLive - PREVIEW_QUANTA);
        expect(layer.previewRequest().prio).toBe(0);
        // unpinned: neither pin set holds a preview key
        for (const m of after[iPrev].misses) {
            expect(store._pins.has(m.key)).toBe(false);
            expect(store._held.has(m.key)).toBe(false);
        }
        expect(pictureStats.previews).toBeGreaterThan(0);
    });

    test("a zoom IN aims no preview: the held plates magnify to cover the screen", () => {
        const { layer, cam, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, 20000);
        offQuantum(cam, 1, 1);
        layer.frameFor(cam, 20000);
        expect(posted.some((p) => p.mode === "preview")).toBe(false);
        expect(layer.status().prevQ).toBe("");
    });

    test("a preview plate's arrival composes and never enters the hits; the preview ends when its set is cached", () => {
        const { layer, cam, store, posted } = mkLayer({ dpr: 1 });
        offQuantum(cam, 0, 1);
        layer.frameFor(cam, 20000);
        offQuantum(cam, -1, 1);
        layer.frameFor(cam, 20000);
        const prev = posted.find((p) => p.mode === "preview");
        expect(prev).toBeTruthy();
        const nHits = layer._nHits, composes = pictureStats.composes;
        const recs = prev.misses.map((m) => ({
            key: m.key, frameId: prev.req.frameId, q: prev.q, Zq: prev.Zq, i: m.i, j: m.j,
            G: store.fresh.generation, bitmap: { width: PLATE_PX, height: PLATE_PX, close() {} }, bytes: 4,
        }));
        layer.onPlateBatch(recs);
        expect(pictureStats.composes).toBe(composes + 1);          // it showed at once
        expect(layer._nHits).toBe(nHits);                           // and is not the view's own quantum
        for (const r of recs) expect(store.get(r.key)).toBeTruthy();
        layer.frameFor(cam, 20000);                                 // the next ask finds the set cached
        expect(layer.status().prevQ).toBe("");
        expect(pictureStats.previewHits).toBeGreaterThan(0);
    });
});
