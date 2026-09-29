/**
 * jobQueue.test.js — the queue of A3 §4.1 and §4.4 over a fake pool and clock: priorities (and that a job must
 * carry one), one worker kept for cuts, the low-priority cap, the pack budget per frame while moving and per task at rest, centre-out
 * dealing into strips, the velocity rule (off-screen cells skipped, a level the camera leaves re-aimed, at most
 * AIM_LEVELS away and never past the frame's floor: F134), cancellation by purpose generation, dedupe against the
 * store, and a failed strip keeping its priority.
 */
import JobQueue, { PRIO, STRIPS_PER_WORKER, PACK_MS_PER_FRAME, AIM_LEVELS } from "./jobQueue";
import { levelCell } from "./PyramidStore";
import { ownFloor, zOf } from "./level";

function rig(W = 4, packMs = 0) {
    const clock = { t: 0 };
    const sent = [], tasks = [];
    let q = null;
    const pool = {
        size: () => W,
        free: () => W - q.inFlight.size,
        submit: (st) => { sent.push(st); clock.t += packMs; return true; },
    };
    q = new JobQueue({ pool, clock: () => clock.t, gens: {}, defer: (fn) => tasks.push(fn) });
    return { q, sent, clock, tasks, finish: (st) => q.done(st.id, 10) };
}
const job = (kind, prio, n = 1, o = {}) => ({
    kind, prio, frame: "F", level: 3, S: 1, Z: 8, purpose: kind, gen: 1, attention: null,
    cells: Array.from({ length: n }, (_, k) => levelCell("F", 3, 1, k, 0)), clips: null, ...o,
});

describe("jobQueue (A3 §4.1, §4.4)", () => {
    test("a job needs a priority; dispatch goes lowest priority first, oldest first within one", () => {
        const { q, sent, finish } = rig(1);
        expect(() => q.push([{ ...job("view", 1), prio: undefined }])).toThrow(/priority/);
        q.push([job("prefetch", PRIO.prefetch), job("view", PRIO.view), job("thumb", PRIO.thumb), job("rest", PRIO.rest), job("plane", PRIO.plane), job("patch", PRIO.patch)]);
        const order = [];
        for (let n = 0; n < 6; n++) { q.pump(); const st = sent[sent.length - 1]; order.push(st.kind); finish(st); }
        expect(order).toEqual(["rest", "patch", "view", "plane", "prefetch", "thumb"]);
        expect(q.report().byPrio).toEqual([2, 1, 1, 0, 1, 1]);             // the harness's jobs by priority
    });

    test("one worker is kept for cuts while any is pending; prefetch and thumbnails hold at most workers − 1", () => {
        const { q, sent } = rig(4);
        q.push([job("view", 1, 8), job("cut", PRIO.cut)]);
        q.pump();
        expect(sent.map((s) => s.kind)).toEqual(["view", "view", "view", "cut"]);
        const r = rig(4);
        r.q.push([job("prefetch", 4, 8), job("thumb", 5, 2)]);
        r.q.pump();
        expect(r.sent.length).toBe(3);
        r.q.push([job("view", 1, 1)]);
        r.q.pump();
        expect(r.sent.map((s) => s.kind)).toEqual(["prefetch", "prefetch", "prefetch", "view"]);
    });

    test("a frame packs at most PACK_MS_PER_FRAME while moving, a task at most that while still; the strip that crosses it is the last, the rest wait for the next frame or task", () => {
        const { q, sent, tasks } = rig(16, 1.5);
        q.setMotion({ moving: true });
        q.push([job("view", 1, 32)]);
        q.frame(); q.pump();
        expect(sent.length).toBe(Math.ceil(PACK_MS_PER_FRAME / 1.5));
        q.pump();
        expect(sent.length).toBe(3);
        expect(tasks.length).toBe(0);                                    // moving: the next frame's step pumps
        q.frame(); q.pump();
        expect(sent.length).toBe(6);
        q.setMotion({ moving: false });
        q.frame(); q.pump();                                            // still: one task's budget
        expect(sent.length).toBe(9);
        expect(tasks.length).toBe(1);
        tasks.shift()();                                                // the next task starts the budget again
        expect(sent.length).toBe(12);
        while (tasks.length) tasks.shift()();
        expect(sent.length).toBe(16);                                   // then only the pool limits
        expect(q.s.deferred).toBeGreaterThan(0);
    });

    test("still, a strip whose pack alone passes the budget ends its task: 171–480 ms strips are one a task, not one a free worker (P6's undo trace)", () => {
        const { q, sent, tasks } = rig(4, 200);
        q.push([job("prefetch", PRIO.prefetch, 2), job("view", PRIO.view, 2)]);
        q.pump();
        expect(sent.map((st) => st.kind)).toEqual(["view"]);
        expect(tasks.length).toBe(1);
        tasks.shift()();
        expect(sent.map((st) => st.kind)).toEqual(["view", "view"]);
        tasks.shift()();
        tasks.shift()();
        expect(sent.map((st) => st.kind)).toEqual(["view", "view", "prefetch", "prefetch"]);
        expect(tasks.length).toBe(1);                                   // a task's budget, even with nothing left to send
        tasks.shift()();
        expect(tasks.length).toBe(0);
    });

    test("cells sorted from the attention point and dealt round-robin into workers × STRIPS_PER_WORKER strips", () => {
        const { q } = rig(2);
        const cells = [];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) cells.push(levelCell("F", 3, 1, i, j));
        const strips = q.strips({ ...job("view", 1), cells, attention: [2 * 512, 2 * 512] });
        expect(strips.length).toBe(2 * STRIPS_PER_WORKER);
        const d = (c) => ((c.i + 0.5) * 512 - 1024) ** 2 + ((c.j + 0.5) * 512 - 1024) ** 2;
        const firsts = strips.map((s) => d(s.cells[0]));
        expect(Math.max(...firsts)).toBe(Math.min(...cells.map(d)));        // every strip starts at a nearest cell
        for (const s of strips) for (let k = 1; k < s.cells.length; k++) expect(d(s.cells[k])).toBeGreaterThanOrEqual(d(s.cells[k - 1]));
        expect(strips.flatMap((s) => s.cells).length).toBe(16);
        expect(new Set(strips.flatMap((s) => s.cells.map((c) => c.key))).size).toBe(16);
        // Clips travel with their cells.
        const clipped = q.strips({ ...job("patch", 0), cells, clips: cells.map((c) => [c.i, c.j, c.i + 1, c.j + 1]), attention: [0, 0] });
        for (const s of clipped) s.cells.forEach((c, k) => expect(s.clips[k]).toEqual([c.i, c.j, c.i + 1, c.j + 1]));
    });

    test("the velocity rule: cells the camera will have left are skipped; a zoom-out re-aims a strip at the coarser level", () => {
        const view = { frameId: "F", level: 3, S: 1, Z: 8, k: 8, tx: 0, ty: 0, wDev: 1024, hDev: 512, sigmaMin: 2 ** -0.5 };
        const a = rig(4);
        a.q.jobMs = 100;
        a.q.setMotion({ moving: true, view, vel: { px: [-6, 0], zoom: 0 } });    // panning left 6 px/ms: 600 px by arrival
        a.q.push([{ ...job("view", 1, 3), attention: null }]);
        a.q.pump();
        expect(a.sent.flatMap((s) => s.cells.map((c) => c.i)).sort()).toEqual([1, 2]);   // cell 0 (x 0–512) has left the screen
        expect(a.q.s.drops.offscreen).toBe(1);
        const b = rig(1);
        b.q.jobMs = 100;
        b.q.setMotion({ moving: true, view, vel: { px: [0, 0], zoom: -0.01 } }); // zooming out an octave by arrival
        b.q.push([{ ...job("view", 1, 4) }]);
        b.q.pump();
        expect([b.sent[0].level, b.sent[0].Z]).toEqual([2, 4]);
        expect(b.sent[0].cells.map((c) => c.key)).toEqual([levelCell("F", 2, 1, 0, 0).key, levelCell("F", 2, 1, 1, 0).key]);
        expect(b.q.s.reaimed).toBe(1);
        const c = rig(4);                                                    // at rest nothing is aimed
        c.q.jobMs = 100;
        c.q.setMotion({ moving: false, view, vel: { px: [-6, 0], zoom: -0.01 } });
        c.q.push([{ ...job("view", 1, 4) }]);
        c.q.pump();
        expect(c.sent.flatMap((s) => s.cells.map((x) => x.key)).sort()).toEqual([0, 1, 2, 3].map((i) => levelCell("F", 3, 1, i, 0).key).sort());
        const d = rig(1);                                                    // a descend: twenty octaves in by arrival
        d.q.jobMs = 100;
        d.q.setMotion({ moving: true, view, vel: { px: [0, 0], zoom: 0.2 } });
        d.q.push([{ ...job("view", 1, 2) }]);
        d.q.pump();
        expect(d.sent[0].level).toBe(3 + AIM_LEVELS);                       // aimed two levels in, not twenty (F134)
        expect(d.sent[0].cells.length).toBeGreaterThan(0);
        expect(d.sent[0].cells.length).toBeLessThanOrEqual(6);             // one screenful at the new level, not 2^40 children
    });

    test("F134: a fast zoom-out's strips are re-aimed at most AIM_LEVELS past the view's level and never under the frame's floor", () => {
        // The flag's timings: zoom steps 1–3 ms apart halve Z each (−1 octave a ms) and an eta of 15–20 ms predicts 15–20
        // octaves out; strips pushed at the view's level −4 went to −14…−21 and one such plate took 5–102 s inline.
        for (const [S, level] of [[1, -4], [1, -5], [2, -3], [3, -1], [3, -2]]) {
            for (const eta of [15, 20]) {
                const Z = zOf(level, S) * 1.2, view = { frameId: "F", level, S, Z, k: Z, tx: 0, ty: 0, wDev: 800, hDev: 600, sigmaMin: 2 ** -0.5 };
                const r = rig(1);
                r.q.jobMs = eta;
                r.q.setMotion({ moving: true, view, vel: { px: [0, 0], zoom: -1 } });
                r.q.push([job("view", 1, 2, { level, S, Z: zOf(level, S), cells: [levelCell("F", level, S, 0, 0), levelCell("F", level, S, 1, 0)] })]);
                r.q.pump();
                const st = r.sent[0];
                expect([S, level, eta, st.level]).toEqual([S, level, eta, Math.max(ownFloor(S), level - AIM_LEVELS)]);
                expect(st.Z).toBe(zOf(st.level, S));
                expect(st.cells.length).toBeGreaterThan(0);
            }
        }
    });

    test("the arrival estimate: the strip's own dispatch-to-landing time plus the time since the view, never the strips in flight", () => {
        const view = { frameId: "F", level: 3, S: 1, Z: 8, k: 8, tx: 0, ty: 0, wDev: 1024, hDev: 512, sigmaMin: 2 ** -0.5 };
        const moving = (at) => ({ moving: true, at, view, vel: { px: [-8, 0], zoom: 0 } });   // 8 px/ms left
        const viewCells = (sent) => sent.filter((s) => s.kind === "view").flatMap((s) => s.cells.map((c) => c.i));
        // Three strips in flight of four slots: the fourth dispatches now, so it lands in 100 ms (800 px), not 175.
        const a = rig(4);
        a.q.jobMs = 100;
        a.q.setMotion(moving(0));
        a.q.push([job("rest", 0, 3)]);
        a.q.pump();
        a.q.push([job("view", 1, 3)]);
        a.q.pump();
        expect(viewCells(a.sent)).toEqual([1]);                             // cell 1 (512–1024) still on screen at 800 px
        // The view is 50 ms old at dispatch: 150 ms of motion (1,200 px) by arrival.
        const b = rig(4), c = rig(4);
        b.q.jobMs = 100; c.q.jobMs = 100;
        b.q.setMotion(moving(0)); c.q.setMotion(moving(-50));
        b.q.push([job("view", 1, 3)]); c.q.push([job("view", 1, 3)]);
        b.q.pump(); c.q.pump();
        expect([viewCells(b.sent), viewCells(c.sent)]).toEqual([[1, 2], [2]]);
        // The sample runs from dispatch (the pack included) to the landing; a failure is no sample.
        const d = rig(1, 5);
        d.q.push([job("view", 1, 1)]);
        d.q.pump();
        d.clock.t = 100;
        d.q.done(d.sent[0].id);
        expect(d.q.jobMs).toBeCloseTo(30 + 0.2 * (100 - 30), 9);
        const nextTask = () => { while (d.tasks.length) d.tasks.shift()(); };   // at rest each pump is a task's
        nextTask();
        d.q.push([job("view", 1, 1)]);
        d.q.pump();
        d.clock.t = 5000;
        expect(d.q.done(d.sent[1].id, false)).toBe(true);
        expect([d.q.jobMs, d.q.inFlight.size]).toEqual([30 + 0.2 * 70, 0]);
        // A cut is one strip with no cells, never dropped at dispatch, and its time is no sample (the plates' estimate).
        nextTask();
        d.q.push([{ kind: "cut", prio: PRIO.cut, cells: [] }]);
        d.q.pump();
        expect(d.sent[2].kind).toBe("cut");
        d.clock.t = 9000;
        d.q.done(d.sent[2].id);
        expect(d.q.jobMs).toBe(30 + 0.2 * 70);
    });

    test("cancellation by purpose generation and dedupe against the store, at dispatch", () => {
        const { q, sent } = rig(4);
        const gens = { view: 5 };
        q.gens = gens;
        const exact = new Set([levelCell("F", 3, 1, 1, 0).key]);
        q.store = { wants: (key) => !exact.has(key) };
        const dropped = [];
        q.onDrop = (st, why) => dropped.push(why);
        q.push([{ ...job("view", 1, 1), gen: 4 }, { ...job("view", 1, 3), gen: 5 }, { ...job("prefetch:far", 4, 1), purpose: "prefetch:far", gen: 1 }]);
        gens.prefetch = 2;                                                  // moved on after the push
        q.pump();
        expect(dropped.sort()).toEqual(["exact", "gen", "gen"]);             // the view gen 4, the prefetch, the strip of cell 1
        expect(sent.flatMap((s) => s.cells.map((c) => c.i)).sort()).toEqual([0, 2]);
    });

    test("a failed strip goes back ahead of its priority with its priority kept (H7)", () => {
        const { q, sent } = rig(1);
        q.push([job("view", 1, 1), job("view", 1, 1)]);
        q.pump();
        const first = sent[0];
        q.requeue(first.id);
        q.push([job("rest", 0, 1)]);
        q.pump();
        expect(sent[1].kind).toBe("rest");
        q.done(sent[1].id);
        q.pump();
        expect([sent[2].seq < 0, sent[2].prio]).toEqual([true, 1]);
        expect(q.report().inFlight).toEqual([0, 1, 0, 0, 0, 0]);
    });
});
