/**
 * eraseWorkerClient.test.js — cuts through the shared pool's queue (PLAN §1.6, §5.9 item 1) over fake raster workers:
 * the reservation (plates hold at most workers − 1 slots while a cut is pending), a barrier's cut first, a job lost to
 * a worker's error requeued once and refused the second time, the job the watchdog found silent refused (the others
 * requeued), a throw in the worker refused, and inline only when the pool is broken; then the engine's refusal over
 * ink (the target whole, the journal's reason, `report().erase.counters.cutRefused`).
 */
import { submit, cutQueue, cutSlots, eraseWorkerStats, resetEraseWorkerClient } from "./eraseWorkerClient";
import JobQueue from "./raster/jobQueue";
import { setRasterWorkerCount, resetRasterWorkerClient, rasterWorkerReport, _checkWatchdogForTests, WATCHDOG_MS } from "./raster/rasterWorkerClient";
import { mkEngine, useEngines, drawStroke, eraseGesture } from "./__testkit__/harness";
import { buildReport } from "./report";

let made = [];
class FakeWorker {
    constructor(url) {
        if (!String(url).includes("raster-worker")) throw new Error("no " + url + " in this test");
        this.posted = []; this.dead = false; made.push(this);
    }
    postMessage(m) { this.posted.push(m); }
    terminate() { this.dead = true; }
    answer(k = 0, out = { kind: "grazed", stats: null, removed: 0, dust: 0 }) { const m = this.posted[k]; this.onmessage({ data: { kind: "cut-result", jobId: m.jobId, ok: true, out } }); }
    throwIn(k = 0) { const m = this.posted[k]; this.onmessage({ data: { kind: "cut-result", jobId: m.jobId, ok: false, err: "boom" } }); }
    fail() { this.onerror({ preventDefault() {} }); }
}
const job = () => ({ subject: [], clip: [], w: 1, freezeR: 1, graze: "cut" });
const tick = () => new Promise((r) => setTimeout(r, 0));
const noteWhen = (p, order, name) => p.then(() => { order.push(name); });
const live = () => made.filter((w) => !w.dead);
const posted = () => made.reduce((n, w) => n + w.posted.length, 0);
/** The pool's first job answered, so a later failure replaces the pool (RW-1). */
async function warm(q) { const p = submit(q, { kind: "cut", job: job() }); live()[0].answer(0); await p; }
function watchdogTwice() {
    const t0 = performance.now(), spy = jest.spyOn(performance, "now").mockImplementation(() => t0 + WATCHDOG_MS + 1);
    try { _checkWatchdogForTests(); _checkWatchdogForTests(); } finally { spy.mockRestore(); }
}

beforeEach(() => { made = []; global.Worker = FakeWorker; resetRasterWorkerClient(); resetEraseWorkerClient(); });
afterEach(() => { delete global.Worker; resetRasterWorkerClient(); resetEraseWorkerClient(); });

test("the reservation: while a cut is pending, plates hold at most workers − 1 slots, so it takes the next free one", () => {
    setRasterWorkerCount(3);
    const sent = [];
    let q = null;
    q = new JobQueue({ pool: { size: () => 3, free: () => 3 - q.inFlight.size, submit: (st) => { sent.push(st); return true; } }, gens: {} });
    q.push([{ kind: "view", prio: 1, frame: "F", level: 0, Z: 1, cells: Array.from({ length: 6 }, (_, k) => ({ key: "k" + k, i: k, j: 0 })) }]);
    q.pump();
    expect(sent.map((s) => s.kind)).toEqual(["view", "view", "view"]);
    submit(q, { kind: "cut", job: job() });
    expect(sent.length).toBe(3);                                        // no free slot yet
    q.done(sent[0].id, 10);
    q.pump();
    expect(sent.map((s) => s.kind)).toEqual(["view", "view", "view", "cut"]);   // ahead of the view's queued strips
    expect(cutSlots(q)).toBe(2);                                        // the pool's size less the cut out
});

test("a barrier's cut goes first within the cut priority", async () => {
    setRasterWorkerCount(1);
    const q = cutQueue(), order = [];
    const p1 = noteWhen(submit(q, { kind: "cut", job: job() }), order, "tick-1");
    const p2 = noteWhen(submit(q, { kind: "cut", job: job() }), order, "tick-2");
    const p3 = noteWhen(submit(q, { kind: "cut", barrier: true, job: job() }), order, "barrier");
    expect(made.length).toBe(1);
    const w = made[0];
    for (let k = 0; k < 3; k++) { w.answer(k); await tick(); }
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["tick-1", "barrier", "tick-2"]);            // the head was already out; the barrier jumps the queue
    expect(w.posted.every((m) => m.kind === "cut-job" && m.cut === "cut")).toBe(true);
});

test("a job lost to a worker's error is requeued once to the fresh pool; lost again it is refused", async () => {
    setRasterWorkerCount(1);
    const q = cutQueue();
    await warm(q);
    const p = submit(q, { kind: "cut", job: job() });
    live()[0].fail();                                                   // the pool replaced; the job back at the head
    await tick();
    expect(eraseWorkerStats().requeued).toBe(1);
    expect(live()[0].posted.length).toBe(1);                            // re-posted to the fresh worker
    live()[0].fail();
    await expect(p).rejects.toMatchObject({ why: "worker" });
    expect(eraseWorkerStats()).toMatchObject({ requeued: 1, lost: 1 });
    expect(rasterWorkerReport().respawns).toBe(2);
});

test("the job the watchdog found silent is refused, never requeued; the others in flight are requeued", async () => {
    setRasterWorkerCount(2);
    const q = cutQueue();
    await warm(q);
    const silent = submit(q, { kind: "cut", job: job() }), other = submit(q, { kind: "cut", job: job() });
    expect(posted()).toBe(3);
    watchdogTwice();                                                    // marked, then replaced
    await expect(silent).rejects.toMatchObject({ why: "watchdog" });
    await tick();
    expect(eraseWorkerStats()).toMatchObject({ requeued: 1, lost: 1 });
    const w = live().find((x) => x.posted.length);
    w.answer(0);
    await expect(other).resolves.toMatchObject({ kind: "grazed" });
    expect(posted()).toBe(4);                                           // the silent job was never posted again
});

test("a job that threw in the worker is refused, not rerun", async () => {
    setRasterWorkerCount(1);
    const q = cutQueue();
    const p = submit(q, { kind: "cut", job: job() });
    made[0].throwIn(0);
    await expect(p).rejects.toMatchObject({ why: "boom" });
    expect(eraseWorkerStats()).toMatchObject({ requeued: 0, lost: 1 });
    expect(posted()).toBe(1);
});

test("inline only when the pool is broken: a script that never loads runs the requeued job here, then submit is null", async () => {
    setRasterWorkerCount(1);
    const q = cutQueue();
    const p = submit(q, { kind: "cut", job: job() });
    made[0].fail();                                                     // before any answer: broken for the session
    await expect(p).resolves.toMatchObject({ kind: "grazed" });        // `runCut` on this thread, the worker's own function
    expect(rasterWorkerReport().broken).toBe(true);
    expect(submit(q, { kind: "cut", job: job() })).toBeNull();          // the caller runs it inline from here
    expect(eraseWorkerStats().inline).toBe(1);
    expect(cutSlots(q)).toBe(0);
});

describe("the engine's refusal over ink (PLAN §5.9 item 1, A2 §5.7)", () => {
    useEngines();
    test("a cut the watchdog took leaves its target whole, with the reason on the journal and the count in the report", async () => {
        setRasterWorkerCount(1);
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[100, 300], [700, 300]], 20);
        const before = JSON.stringify(E.doc.getById(A.id).obj.loops);
        E._scheduleBake = () => {};
        eraseGesture(E, [[400, 250], [400, 350]], 30);
        const mark = E._eraseStrokes()[0].obj.id;
        E._bakeTick();
        expect([...E._cuts.values()].filter((c) => c.state === "flight")).toHaveLength(1);
        watchdogTwice();
        for (let k = 0; k < 20 && (E._eraseStrokes().length || E._eraseBusy()); k++) { await tick(); E._bakeTick(); }
        expect(E._eraseStrokes()).toHaveLength(0);                      // the mark spent
        const o = E.doc.getById(A.id);
        expect(o && JSON.stringify(o.obj.loops)).toBe(before);          // the target whole: its ink shows again
        expect(E.journal.find((j) => j.kind === "erase" && j.id === mark).refused).toEqual([expect.objectContaining({ target: A.id, why: "worker: watchdog" })]);
        const rep = await buildReport(E);
        expect(rep.erase.counters.cutRefused).toBe(1);
        expect(rep.erase.worker).toMatchObject({ jobs: 1, lost: 1, requeued: 0 });
    });
});
