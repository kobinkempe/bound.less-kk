/**
 * eraseWorkerClient.test.js — the interim erase pool behind `submit` (A2 §4.7) with a fake Worker:
 * its size by the cores the raster pool leaves, a barrier's job first, RW-1's discipline (a script
 * that never loads goes inline for the session; a failure after an answer replaces the pool; a job
 * silent past the watchdog replaces it on the second check), and a lost job rejecting so the bake
 * runs it inline.
 */
import { submit, eraseWorkerCount, eraseFreeSlots, eraseWorkerStats, resetEraseWorkerClient, _checkEraseWatchdogForTests, MAX_ERASE_WORKERS } from "./eraseWorkerClient";
import { setRasterWorkerCount, WATCHDOG_MS, MAX_RESPAWNS } from "./raster/rasterWorkerClient";

let made = [];
class FakeWorker {
    constructor(url) { this.url = url; this.posted = []; this.dead = false; made.push(this); }
    postMessage(m) { this.posted.push(m); }
    terminate() { this.dead = true; }
    answer(k = 0, out = { kind: "grazed", stats: null, removed: 0, dust: 0 }) { const m = this.posted[k]; this.onmessage({ data: { id: m.id, ok: true, out } }); }
    fail() { this.onerror({ preventDefault() {} }); }
}
const job = () => ({ subject: [], clip: [], w: 1, freezeR: 1, graze: "cut" });
const cores = (n) => Object.defineProperty(navigator, "hardwareConcurrency", { value: n, configurable: true });

beforeEach(() => { made = []; global.Worker = FakeWorker; resetEraseWorkerClient(); setRasterWorkerCount(null); });
afterEach(() => { delete global.Worker; resetEraseWorkerClient(); setRasterWorkerCount(null); cores(4); });

test("the pool's size: max(1, min(3, cores − 1 − rasterWorkers))", () => {
    cores(8); expect(eraseWorkerCount()).toBe(3);                    // 8 − 1 − 4
    cores(4); expect(eraseWorkerCount()).toBe(1);
    cores(16); expect(eraseWorkerCount()).toBe(MAX_ERASE_WORKERS);
    setRasterWorkerCount(1); cores(4); expect(eraseWorkerCount()).toBe(2);
});

test("a barrier's job goes first, then by priority, then in order", async () => {
    cores(4);                                                           // one worker
    const order = [];
    const p1 = submit({ kind: "cut", prio: 3, job: job() }).then(() => order.push("tick-1"));
    const p2 = submit({ kind: "cut", prio: 3, job: job() }).then(() => order.push("tick-2"));
    const p3 = submit({ kind: "cut", prio: 3, barrier: true, job: job() }).then(() => order.push("barrier"));
    expect(made.length).toBe(1);
    const w = made[0];
    expect(eraseFreeSlots()).toBe(0);
    for (let k = 0; k < 3; k++) { w.answer(k); await Promise.resolve(); }
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["tick-1", "barrier", "tick-2"]);             // the head was already out; the barrier jumps the queue
});

test("a script that never loads: every job rejects and the session goes inline", async () => {
    cores(8);
    const p = submit({ kind: "cut", job: job() });
    made[0].fail();
    await expect(p).rejects.toThrow();
    expect(submit({ kind: "cut", job: job() })).toBeNull();            // inline from here
    expect(eraseWorkerStats().broken).toBe(true);
});

test("a failure after an answer replaces the pool, MAX_RESPAWNS times, then inline", async () => {
    cores(4);
    const first = submit({ kind: "cut", job: job() });
    made[0].answer(0);
    await first;
    for (let r = 0; r < MAX_RESPAWNS; r++) {
        const p = submit({ kind: "cut", job: job() });
        made[made.length - 1].fail();
        await expect(p).rejects.toThrow();                              // the caller runs it inline
        expect(eraseWorkerStats().broken).toBe(false);
    }
    const p = submit({ kind: "cut", job: job() });
    made[made.length - 1].fail();
    await expect(p).rejects.toThrow();
    expect(eraseWorkerStats().broken).toBe(true);
    expect(eraseWorkerStats().respawns).toBe(MAX_RESPAWNS);
});

test("a job silent past the watchdog replaces the pool at the second check", async () => {
    cores(4);
    const first = submit({ kind: "cut", job: job() });
    made[0].answer(0);
    await first;
    const now = performance.now.bind(performance);
    const p = submit({ kind: "cut", job: job() });
    let t = now();
    const spy = jest.spyOn(performance, "now").mockImplementation(() => t);
    try {
        t += WATCHDOG_MS + 1;
        _checkEraseWatchdogForTests();                                  // marked
        expect(eraseWorkerStats().silent).toBe(0);
        _checkEraseWatchdogForTests();                                  // still silent: replaced
        expect(eraseWorkerStats().silent).toBe(1);
        await expect(p).rejects.toThrow();
        expect(made[0].dead).toBe(true);
    } finally { spy.mockRestore(); }
});
