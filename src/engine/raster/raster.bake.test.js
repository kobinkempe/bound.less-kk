/**
 * raster.bake.test.js — OPEN-FLAGS F90: a cut under its white mark changes no pixel (DESIGN.md §7),
 * so the plate cache keeps its plates through the bake; the mark's removal, when it is spent, stales
 * what it covered once, and the plates then are the ones a fresh raster makes. Measured before the
 * fix (Kobin's Chrome, 1,000 strokes): every cut staled the ring's plates, 80 of 101 re-rasters
 * arrived stale, and the cells kept the pre-erase picture for the whole ~35 s bake.
 */
import KobinEngine from "../KobinEngine";
import { eraseGesture, descend } from "../__testkit__/harness";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./rasterWorkerClient";

const engines = [];
function mkEngine(w = 1600, h = 1200) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: true });
    E.renderer.layer.syncBudget = 0;                   // the plates path
    E.renderer.layer._sync = false;
    E._scheduleBake = () => {};                        // the bake is stepped by hand
    engines.push({ E, host });
    return E;
}
beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(1); });
afterEach(() => { while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); } });
async function flush(rounds = 60) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}

const C = [400, 300];
/** A wobbly blob over the ring and far past it (plates the ring never reaches hold it too), made a shape as a cut would. */
function blob(E, k) {
    const pts = [];
    for (let i = 0; i < 120; i++) {
        const a = (i / 120) * 2 * Math.PI, r = 700 + 25 * Math.sin(7 * a + k);
        pts.push([C[0] + r * Math.cos(a), C[1] + 0.8 * r * Math.sin(a)]);
    }
    const o = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "rgb(" + (40 + 25 * k) + ",90,160)", opacity: 1, polys: [pts] }, E.cam.frame);
    E.doc.fillToShapeById(o.id);
    return E.doc.getById(o.id);
}
const circle = (r, n) => { const out = []; for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); } return out; };

/** `n` blobs, the plates landed, a ring erased through them, the plates under the mark landed. */
async function ringThrough(n) {
    const E = mkEngine();
    for (let k = 0; k < n; k++) blob(E, k);
    E._render(); await flush();
    eraseGesture(E, circle(110, 72), 16);
    E._render(); await flush();
    return E;
}
/** The tick's own loop, a cut at a time, each followed by its render and the plates it posts. */
async function bakeAll(E) {
    const Erec = E._eraseStrokes()[0];
    let steps = 0, t;
    while ((t = E._nextEraseTarget(Erec))) {
        E._bakeOne(Erec, t, { sync: true });
        E._lowerMark(Erec, t);
        E._render(); await flush();
        steps++;
    }
    return steps;
}
function pixelsOf(E) {
    const out = new Map();
    for (const [k, e] of E.plates.cache) {
        const px = e.pixels || (e.bitmap && e.bitmap.pixels);
        if (px && typeof e.q === "number" && e.epoch === E.plates.epochOf(k)) out.set(k, px);
    }
    return out;
}

describe("the bake keeps the plates under its mark (F90)", () => {
    test("B1 the cuts stale no plate; the spent mark stales its own once", async () => {
        const E = await ringThrough(6);
        const s = E.plates.s, bumps0 = s.epochBumps, neutral0 = s.neutralEvents;
        expect(E._eraseStrokes().length).toBe(1);
        expect(await bakeAll(E)).toBe(6);
        expect(s.neutralEvents - neutral0).toBeGreaterThanOrEqual(6 * 2);   // each cut: the target out, its pieces in
        expect(s.epochBumps).toBe(bumps0);                   // red before F90: every cut staled the ring's plates
        E._bakeTickInner();                                  // no target left: the mark is spent
        expect(E._eraseStrokes().length).toBe(0);
        E._render();
        expect(s.epochBumps).toBeGreaterThan(bumps0);
        await flush();
        expect(E.plates.staleInFlight()).toBe(0);
    });

    test("B3 the mark stepping past a target the bake refused uncovers it: that step stales the plates (review 11)", async () => {
        const E = mkEngine();
        for (let k = 0; k < 3; k++) blob(E, k);
        const toShape = E.doc.fillToShapeById;
        E.doc.fillToShapeById = () => null;                  // the top one stays a fill: the bake refuses it
        blob(E, 3);
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0], s = E.plates.s;
        const t = E._nextEraseTarget(Erec);
        expect(E.doc.getById(t.obj.id).obj.type).toBe("fill");
        const bumps0 = s.epochBumps;
        expect(E._bakeOne(Erec, t, { sync: true })).toBe(false);
        E._lowerMark(Erec, t);                               // now under the refused fill: its ink shows over the ring
        E._render();
        expect(s.epochBumps).toBeGreaterThan(bumps0);        // red before: tagged neutral, the plates kept the white ring over it
        E.doc.fillToShapeById = toShape;
        const t2 = E._nextEraseTarget(Erec);
        const bumps1 = s.epochBumps;
        E._bakeOne(Erec, t2, { sync: true });
        E._lowerMark(Erec, t2);
        E._render();
        expect(s.epochBumps).toBe(bumps1);                   // a real cut stays neutral
    });

    test("B4 per target: a refused target the mark passes only after two more cuts still stales that step (docmaps finding 2)", async () => {
        const E = mkEngine();
        blob(E, 0);                                          // C, the bottom
        const toShape = E.doc.fillToShapeById;
        E.doc.fillToShapeById = () => null;
        const B = blob(E, 1);                                // stays a fill: refused
        E.doc.fillToShapeById = toShape;
        blob(E, 2);                                          // A, the top
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0], s = E.plates.s;
        E.doc.fillToShapeById = () => null;
        expect(E._bakeOne(Erec, E.doc.getById(B.obj.id), { sync: true })).toBe(false);   // a barrier's bake, out of order
        E.doc.fillToShapeById = toShape;
        const tA = E._nextEraseTarget(Erec);
        E._bakeOne(Erec, tA, { sync: true }); E._lowerMark(Erec, tA); E._render();
        expect(E._zOf(Erec.obj)).toBeGreaterThan(E._zOf(B.obj));   // B still under the mark
        const tC = E._nextEraseTarget(Erec);
        const bumps0 = s.epochBumps;
        E._bakeOne(Erec, tC, { sync: true });
        E._lowerMark(Erec, tC);                              // now past B
        E._render();
        expect(E._zOf(Erec.obj)).toBeLessThan(E._zOf(B.obj));
        expect(s.epochBumps).toBeGreaterThan(bumps0);        // red with one engine-wide flag: A's cut had cleared it
    });

    test("B5 a cut that lands with the mark already under its target is not neutral (docmaps finding 2)", async () => {
        const E = mkEngine();
        for (let k = 0; k < 2; k++) blob(E, k);
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0], s = E.plates.s;
        const t = E._nextEraseTarget(Erec);
        E.doc.setZById(Erec.obj.id, E._zOf(t.obj) - 0.5);    // the mark stepped past it first (a barrier)
        E._render(); await flush();
        const bumps0 = s.epochBumps;
        E._bakeOne(Erec, t, { sync: true });
        E._render();
        expect(s.epochBumps).toBeGreaterThan(bumps0);        // red before: tagged neutral, the target's whole plates kept
    });

    test("B6 a re-homing bake (a descent) under its mark stales no plate either, and ends on a fresh raster's plates (docmaps finding 2)", async () => {
        const E = mkEngine(800, 600);
        blob(E, 0);                                          // at the root
        E._render(); await flush();
        expect(descend(E, 1, C[0], C[1])).toBeGreaterThanOrEqual(1);
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);                // drawn a crossing below the blob's home: it cedes
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0], s = E.plates.s;
        const t = E._nextEraseTarget(Erec);
        expect(t).toBeTruthy();
        const bumps0 = s.epochBumps, adds0 = s.neutralEvents;
        expect(E._bakeOne(Erec, t, { sync: true })).toBe(true);
        E._render();
        expect(E.journal.find((j) => j.kind === "erase").cuts.some((c) => c.mode === "cede")).toBe(true);   // a descent, not a cut in place
        expect(s.neutralEvents).toBeGreaterThan(adds0);
        expect(s.epochBumps).toBe(bumps0);                   // red before: a descent never went through _neutral
        await flush();
        E._lowerMark(Erec, t);
        while (E._nextEraseTarget(Erec)) { const u = E._nextEraseTarget(Erec); E._bakeOne(Erec, u, { sync: true }); E._lowerMark(Erec, u); }
        E._bakeTickInner();
        E._render(); await flush();
        const kept = pixelsOf(E);
        E.plates.dropAll(false);
        E._render(); await flush();
        let compared = 0, differ = 0;
        for (const [k, px] of pixelsOf(E)) { const g = kept.get(k); if (!g) continue; compared++; if (g.some((b, i) => b !== px[i])) differ++; }
        expect(compared).toBeGreaterThan(0);
        expect(differ).toBe(0);
    });

    test("B2 after the bake and the mark's removal every plate is what a fresh raster of the document makes", async () => {
        const E = await ringThrough(6);
        await bakeAll(E);
        E._bakeTickInner();
        E._render(); await flush();
        const kept = pixelsOf(E);
        E.plates.dropAll(false);
        E._render(); await flush();
        const fresh = pixelsOf(E);
        let compared = 0, differ = 0;
        for (const [k, px] of fresh) {
            const g = kept.get(k);
            if (!g) continue;
            compared++;
            if (g.length !== px.length || g.some((b, i) => b !== px[i])) differ++;
        }
        expect(compared).toBeGreaterThanOrEqual(6);                  // two under the ring, four it never reached
        expect(differ).toBe(0);
    });
});
