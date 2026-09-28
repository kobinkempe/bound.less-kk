/**
 * raster.bake.test.js — OPEN-FLAGS F90 under the Stage's rule (PLAN §5.3 A2-Q2): a cut under its
 * white mark dirties its footprint inside the mark's box only, so the plates the ring never reaches
 * keep through the bake; a step the mark takes past ink it left whole is not neutral; the mark's
 * removal, when it is spent, stales what it covered once, and the plates then are the ones a fresh
 * raster makes. Measured before F90 (Kobin's Chrome, 1,000 strokes): every cut staled the ring's
 * plates, 80 of 101 re-rasters arrived stale, and the cells kept the pre-erase picture for ~35 s.
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
        if (px && typeof e.q === "number" && E.plates.isExact(e)) out.set(k, px);
    }
    return out;
}
/** The camera's numeric-quantum plates, split by whether they meet the mark's drawn box (a device pixel of slack). */
function byMark(E, mark) {
    const b = E.stage.placeNative(mark, E.cam.frame).box(), under = [], far = [];
    for (const e of E.plates.cache.values()) {
        if (typeof e.q !== "number" || String(e.frameId) !== String(E.cam.frame)) continue;
        const u = 512 / e.Zq, pad = 2 / e.Zq;
        const meets = e.i * u <= b.right + pad && (e.i + 1) * u >= b.left - pad && e.j * u <= b.bottom + pad && (e.j + 1) * u >= b.top - pad;
        (meets ? under : far).push(e.key);
    }
    return { under, far };
}
const exact = (E, k) => { const e = E.plates.get(k); return !!e && E.plates.isExact(e); };
/** Jobs in flight that a change after their G has already met. */
const staleInFlight = (E) => [...E.plates.inflight.values()].filter((f) => f.G < E.stage.dirtySince(f.key)).length;

describe("the bake keeps the plates under its mark (F90)", () => {
    test("B1 the cuts stale no plate past the mark's box; the spent mark stales its own once", async () => {
        const E = await ringThrough(6);
        const st = E.stage.stats, neutral0 = st.neutral;
        expect(E._eraseStrokes().length).toBe(1);
        const mark = E._eraseStrokes()[0].obj;
        const { under, far } = byMark(E, mark);
        expect(under.length).toBeGreaterThan(0);
        expect(far.length).toBeGreaterThan(0);
        for (const k of far) expect(exact(E, k)).toBe(true);
        const dirt0 = new Map(far.map((k) => [k, E.stage.dirtySince(k)]));
        const under0 = new Map(under.map((k) => [k, E.stage.dirtySince(k)]));
        expect(await bakeAll(E)).toBe(6);
        expect(st.neutral - neutral0).toBeGreaterThanOrEqual(6 * 2);   // each cut: the target out, its pieces in
        for (const k of far) expect(E.stage.dirtySince(k)).toBe(dirt0.get(k));   // red before F90: every cut staled the ring's plates
        for (const k of under) expect(E.stage.dirtySince(k)).toBeGreaterThan(under0.get(k));   // the cut's band under the mark (A2-Q2)
        const d0 = st.dirtied;
        E._bakeTickInner();                                  // no target left: the mark is spent
        expect(E._eraseStrokes().length).toBe(0);
        E._render();
        expect(st.dirtied).toBeGreaterThan(d0);
        await flush();
        expect(staleInFlight(E)).toBe(0);
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
        const Erec = E._eraseStrokes()[0], st = E.stage.stats;
        const t = E._nextEraseTarget(Erec);
        expect(E.doc.getById(t.obj.id).obj.type).toBe("fill");
        expect(E._bakeOne(Erec, t, { sync: true })).toBe(false);
        const d0 = st.dirtied;
        E._lowerMark(Erec, t);                               // now under the refused fill: its ink shows over the ring
        E._render();
        expect(st.dirtied).toBeGreaterThan(d0);              // red before: tagged neutral, the plates kept the white ring over it
        E.doc.fillToShapeById = toShape;
        const t2 = E._nextEraseTarget(Erec);
        const n1 = st.neutral;
        E._bakeOne(Erec, t2, { sync: true });
        expect(st.neutral).toBeGreaterThan(n1);              // a real cut stays neutral: its dirt inside the mark's box
        const d1 = st.dirtied;
        E._lowerMark(Erec, t2);
        E._render();
        expect(st.dirtied).toBe(d1);                         // and the mark's step past it uncovers nothing
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
        const Erec = E._eraseStrokes()[0], st = E.stage.stats;
        E.doc.fillToShapeById = () => null;
        expect(E._bakeOne(Erec, E.doc.getById(B.obj.id), { sync: true })).toBe(false);   // a barrier's bake, out of order
        E.doc.fillToShapeById = toShape;
        const tA = E._nextEraseTarget(Erec);
        E._bakeOne(Erec, tA, { sync: true }); E._lowerMark(Erec, tA); E._render();
        expect(E._zOf(Erec.obj)).toBeGreaterThan(E._zOf(B.obj));   // B still under the mark
        const tC = E._nextEraseTarget(Erec);
        E._bakeOne(Erec, tC, { sync: true });
        const d0 = st.dirtied;
        E._lowerMark(Erec, tC);                              // now past B
        E._render();
        expect(E._zOf(Erec.obj)).toBeLessThan(E._zOf(B.obj));
        expect(st.dirtied).toBeGreaterThan(d0);              // red with one engine-wide flag: A's cut had cleared it
    });

    test("B5 a cut that lands with the mark already under its target is not neutral (docmaps finding 2)", async () => {
        const E = mkEngine();
        for (let k = 0; k < 2; k++) blob(E, k);
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0];
        const t = E._nextEraseTarget(Erec);
        E.doc.setZById(Erec.obj.id, E._zOf(t.obj) - 0.5);    // the mark stepped past it first (a barrier)
        E._render(); await flush();
        const { far } = byMark(E, Erec.obj);
        expect(far.length).toBeGreaterThan(0);
        for (const k of far) expect(exact(E, k)).toBe(true);
        E._bakeOne(Erec, t, { sync: true });
        // red before: tagged neutral, its dirt clipped to the mark's box and the target's other plates kept
        expect(far.some((k) => !exact(E, k))).toBe(true);
    });

    test("B6 a re-homing bake (a descent) under its mark stales no plate either, and ends on a fresh raster's plates (docmaps finding 2)", async () => {
        const E = mkEngine(800, 600);
        blob(E, 0);                                          // at the root
        E._render(); await flush();
        expect(descend(E, 1, C[0], C[1])).toBeGreaterThanOrEqual(1);
        E._render(); await flush();
        eraseGesture(E, circle(110, 72), 16);                // drawn a crossing below the blob's home: it cedes
        E._render(); await flush();
        const Erec = E._eraseStrokes()[0], st = E.stage.stats;
        const t = E._nextEraseTarget(Erec);
        expect(t).toBeTruthy();
        const { far } = byMark(E, Erec.obj);
        const dirt0 = new Map(far.map((k) => [k, E.stage.dirtySince(k)]));
        const adds0 = st.neutral;
        expect(E._bakeOne(Erec, t, { sync: true })).toBe(true);
        E._render();
        expect(E.journal.find((j) => j.kind === "erase").cuts.some((c) => c.mode === "cede")).toBe(true);   // a descent, not a cut in place
        expect(st.neutral).toBeGreaterThan(adds0);
        for (const k of far) expect(E.stage.dirtySince(k)).toBe(dirt0.get(k));   // red before: a descent never went through _neutral
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
