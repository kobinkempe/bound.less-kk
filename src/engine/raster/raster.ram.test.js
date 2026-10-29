/**
 * raster.ram.test.js — the plate store's RAM tier through the engine (F161, Kobin's tiered plate cache): the plates a
 * zoom evicted come back on the return from the tier — no strip packed or posted for them, bit for bit the plates they
 * were — and a cell an edit touched meanwhile is made again, never restored. Restores count as the view's work in
 * flight, so an idle wait (the prefetch's, a test's) sees them.
 */
import { useEngines, mkEngine, drawStroke, camShot, camRestore } from "../__testkit__/harness";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import { rasterStats, resetRasterStats } from "./RasterRenderer";
import { levelKey } from "./level";

useEngines();
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(E, frames = 6) {
    for (let k = 0; k < frames; k++) { E.renderer.syncCameraOnly(); for (let n = 0; n < 4; n++) await tick(); }
}
/** The pool, gated: every dispatch parks until `run` answers it through the shipped worker entry. */
function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        parked,
        async run() {
            while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); }
            for (let n = 0; n < 6; n++) await tick();
        },
    };
}
async function drain(E, g) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    for (let k = 0; k < 200 && busy(); k++) { await g.run(); await settle(E, 1); }
    return busy();
}
const planCls = (R) => R.pyramid.lastPlan.cells.map((c) => c.draws.map((d) => d.cls).join("+"));
/**
 * Nothing on a wall clock: no rest render (its quiet is 100 ms, which a loaded run reaches), no inline patch, no
 * prefetch, no velocity re-aim (it reads frame times).
 */
function levelOnly(E) {
    const R = E.renderer, c = R.pyramid.cfg;
    c.restInline = "never"; c.restQuietMs = 1e9; c.patchInlineMs = 0;
    R._pyrPrefetch = () => {};
    R.queue._aim = () => {};
    return E;
}
/** The view's own level keys. */
function viewKeys(R) {
    const v = R._view, out = [];
    for (let j = v.j0; j <= v.j1; j++) for (let i = v.i0; i <= v.i1; i++) out.push(levelKey(v.frameId, v.level, v.S, i, j));
    return out;
}
const samePixels = (a, b) => (!a.pixels && !b.pixels) || (!!a.pixels && !!b.pixels && Buffer.from(a.pixels.buffer).equals(Buffer.from(b.pixels.buffer)));

const fillAt = (E, x, y, color, s) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s]]],
});

/**
 * A drawing over every view cell, added before the first render (no plate is patched), its plates in; then a zoom in
 * whose budget squeeze evicts the first view's plates into the tier.
 */
async function away(E, g) {
    const R = E.renderer;
    levelOnly(E);
    for (const [x, y, c] of [[60, 60, "rgb(200,40,40)"], [560, 70, "rgb(40,160,40)"], [70, 530, "rgb(40,40,200)"], [560, 530, "rgb(20,20,20)"]]) {
        E.doc.add(fillAt(E, x, y, c, 200), "0");
    }
    drawStroke(E, [[100, 100], [220, 160], [340, 120], [460, 320]]);
    await settle(E, 2);
    expect(await drain(E, g)).toBe(0);
    expect(planCls(R).every((c) => c === "sharp")).toBe(true);
    const home = camShot(E), level = R._view.level, keys = viewKeys(R);
    const before = new Map(keys.map((k) => [k, E.plates.get(k)]));
    expect(keys.every((k) => before.get(k))).toBe(true);
    E.zoomAt(400, 300, -1500);
    await settle(E, 2);
    expect(await drain(E, g)).toBe(0);
    expect(R._view.level).toBeGreaterThan(level);
    const b0 = E.plates.maxBytes;
    E.plates.setBudget(0);                                          // every record not drawn now is evicted
    E.plates.setBudget(b0);
    for (const k of keys) { expect(E.plates.get(k)).toBeUndefined(); expect(E.plates.ramHas(k)).toBe(true); }
    return { home, level, keys, before };
}

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(2); resetRasterStats(); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

describe("the RAM tier through the engine (F161)", () => {
    test("the return restores every evicted view plate from the tier: no strip for them, the same pixels, all sharp", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const { home, level, keys, before } = await away(E, g);
        const sent = R.queue.report().dispatched, r0 = rasterStats.ramRestores;
        camRestore(E, home);
        R.syncCameraOnly();
        expect(R.queue.report().inFlight[1]).toBeGreaterThan(0);        // restores in flight are the view's work
        expect(await drain(E, g)).toBe(0);
        expect(R._view.level).toBe(level);
        expect(rasterStats.ramRestores - r0).toBe(keys.length);
        expect(R.queue.report().dispatched).toBe(sent);                 // nothing packed or posted for the return
        for (const k of keys) {
            const r = E.plates.get(k);
            expect(E.plates.exact(r)).toBe(true);
            expect([k, samePixels(r, before.get(k))]).toEqual([k, true]);
        }
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
        expect(rasterStats.ramFailed).toBe(0);
    });

    test("a cell an edit touched while its plate was in the tier is made again, never restored", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const { home, keys } = await away(E, g);
        drawStroke(E, [[380, 280], [420, 320]], 9, "rgb(20,160,20)");   // zoomed in: inside one first-view cell
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(keys.every((k) => E.plates.ramHas(k))).toBe(true);       // nothing asked for them yet
        const left = keys.filter((k) => E.plates.restorable(k));        // a stale entry is dropped as it is found
        expect(left.length).toBeGreaterThan(0);
        expect(left.length).toBeLessThan(keys.length);                  // the touched cells' entries are gone
        expect(keys.filter((k) => E.plates.ramHas(k))).toEqual(left);
        const sent = R.queue.report().dispatched, r0 = rasterStats.ramRestores;
        camRestore(E, home);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(rasterStats.ramRestores - r0).toBe(left.length);
        expect(R.queue.report().dispatched).toBeGreaterThan(sent);      // the touched cells were packed again
        for (const k of keys) expect(E.plates.exact(E.plates.get(k))).toBe(true);
        expect(planCls(R).every((c) => c === "sharp")).toBe(true);
    });

    test("the lever at 0: nothing goes to the tier, the return packs again", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        E.setLevers({ plateRamMiB: 0 });
        levelOnly(E);
        drawStroke(E, [[100, 100], [220, 160], [340, 120], [460, 320]]);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        const home = camShot(E);
        E.zoomAt(400, 300, -1500);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        const b0 = E.plates.maxBytes;
        E.plates.setBudget(0); E.plates.setBudget(b0);
        expect(E.plates.report().ram.entries).toBe(0);
        const sent = R.queue.report().dispatched;
        camRestore(E, home);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        expect(rasterStats.ramRestores).toBe(0);
        expect(R.queue.report().dispatched).toBeGreaterThan(sent);
    });
});
