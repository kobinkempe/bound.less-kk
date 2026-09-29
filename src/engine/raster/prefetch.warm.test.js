/**
 * prefetch.warm.test.js — the prefetch's tile reads are warm (PLAN §5.14 item 5, F83): every read of a prefetch plan
 * marks its tiles, and `framesLeft` keeps a marked tile across a change of the camera's frame; the camera's own reads
 * mark nothing; the LRU cap still evicts a marked tile, and a dropped tile leaves the set. Measured in headless
 * Chromium on the dense drawing's zoom-out and back: 19–22 tiles re-baked on the way back in without it, 9–10 with.
 */
import KobinEngine from "../KobinEngine";
import { TILE } from "../frameLattice";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport, rasterWorkerReport } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";

const engines = [];
function mkEngine() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true });
    const c = E.renderer.cfg;                              // no prefetch but the test's own; the idle table read as shipped
    c.restInline = "never"; c.prefetchQuietMs = 1e9;
    engines.push({ E, host });
    return E;
}
/** Until the pool is idle and nothing of the view's or a pen-up group's is queued, in flight or held (the prefetch waits). */
async function flush(E, rounds = 400) {
    for (let k = 0; k < rounds; k++) {
        await new Promise((r) => setTimeout(r, 5));        // past the idle table read's quiet, which covers a group's cells
        const rep = rasterWorkerReport(), q = E.renderer.queue.report();
        if (!rep.inFlight && !rep.queued && [0, 1, 2, 3].every((p) => !q.queued[p] && !q.inFlight[p]) && !E.renderer.live.held.length) return true;
    }
    return false;
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
/** Ink added to the document directly: no pen-up group ahead of the prefetch (it waits for every higher priority). */
const ink = (E) => {
    for (const [x, y, c] of [[120, 120, "rgb(200,30,30)"], [420, 300, "rgb(30,30,200)"]]) {
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: c, opacity: 1,
            polys: [[[x, y], [x + 160, y], [x + 160, y + 120], [x, y + 120]]] }, "0");
    }
};

test("W-1 a prefetch plan reads warm and the camera does not; the flag is down after the plan", async () => {
    const E = mkEngine(), R = E.renderer, T = E.store;
    ink(E);
    E._render();
    expect(await flush(E)).toBe(true);                     // the pen-ups' groups committed: the prefetch has nothing ahead of it
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
