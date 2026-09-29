/**
 * prefetch.warm.test.js — the prefetch's tile reads are warm (PLAN §5.14 item 5, F83): every read of a prefetch plan
 * marks its tiles, and `framesLeft` keeps a marked tile across a change of the camera's frame; the camera's own reads
 * mark nothing; the LRU cap still evicts a marked tile, and a dropped tile leaves the set. Measured in headless
 * Chromium on the dense drawing's zoom-out and back: 19–22 tiles re-baked on the way back in without it, 9–10 with.
 */
import KobinEngine from "../KobinEngine";
import { TILE } from "../frameLattice";
import { drawStroke } from "../__testkit__/harness";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport, rasterWorkerReport } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    const c = E.renderer.cfg;                              // no prefetch but the test's own
    c.restInline = "never"; c.restQuietMs = 1e9; c.prefetchQuietMs = 1e9;
    engines.push({ E, host });
    return E;
}
async function flush(rounds = 16) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 0));
        const rep = rasterWorkerReport();
        if (!rep.inFlight && !rep.queued) return;
    }
}
beforeEach(() => {
    resetRasterWorkerClient(); setRasterWorkerCount(1);
    setRasterTransport((msg) => runJob(msg).then((out) => out.msg));
});
afterEach(() => {
    while (engines.length) { const e = engines.pop(); try { e.E.destroy(); } catch (err) { /* torn down */ } e.host.remove(); }
    setRasterTransport(null);
    resetRasterWorkerClient();
});
const ink = (E) => { drawStroke(E, [[120, 120], [400, 320], [640, 180]], 18); drawStroke(E, [[200, 420], [560, 460]], 9); };

test("W-1 a prefetch plan reads warm and the camera does not; the flag is down after the plan", async () => {
    const E = mkEngine(), R = E.renderer, T = E.store;
    ink(E);
    E._render(); await flush();
    expect(T._warm.size).toBe(0);                          // the camera's own reads mark nothing
    const seen = [];
    const snap = E.stage.snapshot.bind(E.stage), sync = E.stage.sync.bind(E.stage);
    E.stage.snapshot = (...a) => { seen.push(["snapshot", T.warmReads]); return snap(...a); };
    E.stage.sync = (...a) => { seen.push(["sync", T.warmReads]); return sync(...a); };
    R.cfg.prefetchQuietMs = 0; R._commitAt = -Infinity; R._pyrPrefetchKey = null;
    R._pyrPrefetch(R._view);
    const reads = seen.filter(([k]) => k === "snapshot");
    expect(reads.length).toBeGreaterThan(0);               // the far levels read off camera
    expect(reads.every(([, w]) => w === true)).toBe(true);
    expect(T.warmReads).toBe(false);
    expect(T._warm.size).toBeGreaterThan(0);
    E._render();                                           // a camera read after it: still unmarked
    expect(seen.filter(([k]) => k === "sync").every(([, w]) => w === false)).toBe(true);
});

test("W-2 framesLeft keeps a tile a warm read marked and drops one an ordinary read left (F83)", () => {
    const E = mkEngine(), T = E.store;
    ink(E);
    E._render();
    const A = E.lm.cellChild("0", 1, 0).id, B = E.lm.cellChild("0", -1, 0).id;   // frames off the camera's path
    const r = { left: -100, top: -100, right: 100, bottom: 100 };
    T.warmReads = true;
    const a = T.read(A, r);
    T.warmReads = false;
    const b = T.read(B, r);
    expect(a.tiles.length).toBeGreaterThan(0);
    expect(b.tiles.length).toBeGreaterThan(0);
    T.framesLeft("0");
    expect(a.tiles.filter(([k]) => !T.cache.has(k))).toEqual([]);          // warm: kept
    expect(b.tiles.filter(([k]) => T.cache.has(k))).toEqual([]);           // not: dropped
});

test("W-3 the LRU cap still evicts a warm tile, and no key outlives its tile", () => {
    const E = mkEngine(), T = E.store;
    ink(E);
    E._render();
    const F = E.cam.frame;
    T.warmReads = true;
    for (let n = 0; n < 24; n++) {
        const x = n * 4 * TILE;
        T.read(F, { left: x, top: x, right: x + 3 * TILE, bottom: x + 3 * TILE });
    }
    T.warmReads = false;
    const warm0 = T._warm.size;
    expect(warm0).toBeGreaterThan(64);                     // past PER_LEVEL_CAP: warm alone cannot keep them
    T._evict();                                            // the eviction a read holds, as the camera's next read runs it
    const inF = [...T.cache.values()].filter((t) => String(t.level) === String(F)).length;
    expect(inF).toBeLessThanOrEqual(64 + T._pins.size);   // the cap holds, the camera's pins apart
    expect(T._warm.size).toBeLessThan(warm0);
    expect([...T._warm].filter((k) => !T.cache.has(k))).toEqual([]);
});
