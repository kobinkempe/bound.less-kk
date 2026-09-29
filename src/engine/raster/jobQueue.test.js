/**
 * jobQueue.test.js — the queue of A3 §4.1 and §4.4 over a fake pool and clock: priorities (and that a job must
 * carry one), one worker kept for cuts, the low-priority cap, the pack budget per frame while moving, centre-out
 * dealing into strips, the velocity rule (off-screen cells skipped, a level the camera leaves re-aimed),
 * cancellation by purpose generation, dedupe against the store, and a failed strip keeping its priority.
 */
import JobQueue, { PRIO, STRIPS_PER_WORKER, PACK_MS_PER_FRAME } from "./jobQueue";
import { levelCell } from "./PyramidStore";

function rig(W = 4, packMs = 0) {
    const clock = { t: 0 };
    const sent = [];
    let q = null;
    const pool = {
        size: () => W,
        free: () => W - q.inFlight.size,
        submit: (st) => { sent.push(st); clock.t += packMs; return true; },
    };
    q = new JobQueue({ pool, clock: () => clock.t, gens: {} });
    return { q, sent, clock, finish: (st) => q.done(st.id, 10) };
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

    test("while moving a frame packs at most PACK_MS_PER_FRAME; the rest waits for the next frame; at rest only the pool limits", () => {
        const { q, sent } = rig(16, 1.5);
        q.setMotion({ moving: true });
        q.push([job("view", 1, 32)]);
        q.frame(); q.pump();
        expect(sent.length).toBe(Math.ceil(PACK_MS_PER_FRAME / 1.5));
        q.pump();
        expect(sent.length).toBe(3);
        q.frame(); q.pump();
        expect(sent.length).toBe(6);
        q.setMotion({ moving: false });
        q.pump();
        expect(sent.length).toBe(16);
        expect(q.s.deferred).toBeGreaterThan(0);
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
        expect(d.sent[0].level).toBe(23);
        expect(d.sent[0].cells.length).toBeGreaterThan(0);
        expect(d.sent[0].cells.length).toBeLessThanOrEqual(6);             // one screenful at the new level, not 2^40 children
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
