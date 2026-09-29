/**
 * The erase pool's path, driven through a stand-in transport (jsdom has no Worker): the tick
 * dispatches the serial head and its lookahead, the results land later and are applied in the
 * serial order exactly as the synchronous path would have; a result for a target that moved
 * meanwhile is dropped and the target baked again; a barrier waits for a cut in flight.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture, descend, ascend, drag, painted } from "./__testkit__/harness";
import { setEraseTransport } from "./eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "./eraseDescent";
import { inks } from "./__testkit__/ink";

const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
// The worker, in-process: the same job functions, a tick later, the lattice rebuilt from the message.
const transport = (msg, transfer, kind) => later().then(() => {
    if (kind === "descent") { const { world, input } = unwireDescent(msg); return wireDescentResult(descentJob(world, input)).msg; }
    return wireResult(cutJob(unwireJob(msg))).msg;
});
const inkOf = (E) => { const out = []; for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) out.push(o); return out; };
const natives = (E) => JSON.stringify(E.serializeDrawing().natives);

async function settle(E, max = 60) {
    for (let i = 0; i < max && (E._eraseStrokes().length || E._eraseBusy()); i++) { E._bakeTick(); await later(4); }
    return E._eraseStrokes().length === 0 && !E._eraseBusy();
}
/** The jobs in a worker, in dispatch order. */
const flying = (E) => [...E._cuts.values()].filter((c) => c.state === "flight");
const scene = (E) => {
    const A = drawStroke(E, [[100, 300], [700, 300]], 20);
    const B = drawStroke(E, [[100, 330], [700, 330]], 20);
    const C = drawStroke(E, [[100, 360], [700, 360]], 20);
    eraseGesture(E, [[400, 250], [400, 420]], 30);
    E._scheduleBake = () => {};   // ticked by the test
    return { A, B, C };
};

describe("the erase worker", () => {
    useEngines();
    afterEach(() => setEraseTransport(null));

    test("cuts through the worker land as the synchronous path's, bit for bit", async () => {
        const S = mkEngine(800, 600);
        scene(S);
        S.flushErases();
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        scene(E);
        E._bakeTick();
        expect(flying(E).length).toBe(3);           // the head and its lookahead, in the workers
        expect(E._eraseStrokes()).toHaveLength(1);  // nothing applied yet
        expect(await settle(E)).toBe(true);
        expect(natives(E)).toBe(natives(S));
        expect(E.perfLog.some((e) => e.op === "cutApply")).toBe(true);
    });

    test("a target that moved while its cut was in flight is baked again, where it is now", async () => {
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        const { A } = scene(E);
        E._bakeTick();
        const inflight = flying(E)[0];
        expect(inflight).toBeTruthy();
        const movedId = inflight.id;
        E.doc.moveById(movedId, 40, 0);   // in frame units, under the mark still
        expect(await settle(E)).toBe(true);
        expect(E._cutStale).toBe(1);
        // the moved stroke was cut at its new place: its pieces sit 40 units right of the others
        const pieces = inkOf(E);
        expect(E.doc.getById(movedId)).toBeNull();
        expect(pieces.length).toBe(6);
        expect(A).toBeDefined();
    });

    test("a descent through the worker lands as the synchronous path's, bit for bit", async () => {
        const deep = (E) => {
            drawStroke(E, [[100, 300], [700, 300]], 24);
            descend(E, 2);
            eraseGesture(E, [[400, 200], [400, 400]], 30);
            E._scheduleBake = () => {};
        };
        const S = mkEngine(800, 600);
        deep(S);
        S.flushErases();
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        deep(E);
        await later(150);                            // the tick stays out of a moving camera's way
        E._bakeTick();
        expect(flying(E).map((c) => c.kind)).toEqual(["descent"]);   // descents one at a time
        expect(await settle(E)).toBe(true);
        expect(natives(E)).toBe(natives(S));
        expect(E.doc.levels().length).toBeGreaterThan(1);
        expect(E.perfLog.some((e) => e.op === "descentApply")).toBe(true);
    });

    test("a descent whose target moved while in flight is dropped and done again", async () => {
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[100, 300], [700, 300]], 24);
        descend(E, 2);
        eraseGesture(E, [[400, 200], [400, 400]], 30);
        E._scheduleBake = () => {};
        await later(150);
        E._bakeTick();
        expect(flying(E).map((c) => c.kind)).toEqual(["descent"]);
        E.doc.moveById(A.id, 1, 0);
        expect(await settle(E)).toBe(true);
        expect(E._cutStale).toBe(1);
        expect(E.doc.getById(A.id)).toBeNull();            // ceded after all, from where it moved to
        expect(E._eraseStrokes()).toHaveLength(0);
    });

    test("a mark that lands while a descent is in flight keeps its claim: the pieces take the live target's lineage (A2 §4.3)", async () => {
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        drawStroke(E, [[100, 300], [700, 300]], 24);
        descend(E, 2);
        eraseGesture(E, [[400, 200], [400, 400]], 30);                     // M1: a descent
        E._scheduleBake = () => {};
        await later(150);
        E._bakeTick();
        expect(flying(E).map((c) => c.kind)).toEqual(["descent"]);
        const ink = (x, y) => inks(painted(E), E.cam.screenToFrame(x, y));
        expect(ink(500, 300)).toBe(true);
        eraseGesture(E, [[500, 200], [500, 400]], 30);                     // M2 names the target whose descent is out
        expect(await settle(E)).toBe(true);
        expect(E._cutStale || 0).toBe(0);                                  // the descent's result was still valid
        expect([ink(400, 300), ink(500, 300), ink(450, 300)]).toEqual([false, false, true]);
    });

    test("the lookahead holds a target back while an older mark is pending over it (the per-target lock): no job goes stale", async () => {
        const two = (E) => {
            drawStroke(E, [[100, 300], [700, 300]], 24);                  // T1
            drawStroke(E, [[400, 100], [400, 500]], 24);                  // T2, crossing it under (400, 300)
            descend(E, 2);
            eraseGesture(E, [[300, 250], [500, 350]], 30);                 // M1 over both: two descents, one at a time
            ascend(E, 0);
            eraseGesture(E, [[150, 250], [150, 350]], 30);                 // M2 over T1 alone: a plain cut
            E._scheduleBake = () => {};
        };
        const S = mkEngine(800, 600);
        two(S);
        S.flushErases();
        setEraseTransport(transport, { slots: 3 });
        const E = mkEngine(800, 600);
        two(E);
        await later(150);
        E._bakeTick();
        expect(flying(E).map((c) => c.kind)).toEqual(["descent"]);       // M1's second descent waits; M2's cut on it with it
        expect(await settle(E)).toBe(true);
        expect(E._cutStale || 0).toBe(0);
        expect(natives(E)).toBe(natives(S));
    });

    test("a barrier on a target whose cut is in a worker waits for that cut and applies it: nothing cut twice", async () => {
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        scene(E);
        E._bakeTick();
        const id = flying(E)[1].id;                  // a lookahead cut, not the head's
        let pieces = null;
        expect(E._tapBarrier(id, (ids) => { pieces = ids; })).toBe(false);   // parked: its cut is in the worker
        expect(E._eraseStatus()).toEqual({ marks: 1, finishing: true, aborted: 0 });
        expect(E.doc.getById(id)).not.toBeNull();
        await later(6);                              // the three land; the barrier applies its own
        expect(E.doc.getById(id)).toBeNull();
        expect(pieces.length).toBe(2);               // the selection it would make: exactly the pieces
        expect(E._cutStale || 0).toBe(0);
        expect(await settle(E)).toBe(true);
        expect(inkOf(E).length).toBe(6);
    });
    // F67 (Kobin's report 20-48-33, 2026-09-08): a moved object erased from below. The
    // kids are homed one cell over from the camera's frame (offsets.js: the carry), a
    // frame the descent mints — in the worker's own lattice copy, which the engine
    // never saw. The kids landed under a frame id the lattice lacked: no depth, no
    // frame factor, never drawn or found again. "The eraser took the whole object."
    const movedBelow = (E) => {
        const A = drawStroke(E, [[402, 288], [408, 288]], 3);   // inside one cell, at its left
        drag(E, [405, 288], [426, 288]);                        // 21 units at the home: two thirds of a cell, into below[0]
        descend(E, 1, 426, 288);
        eraseGesture(E, [[400, 200], [400, 400]], 30);
        E._scheduleBake = () => {};
        return A;
    };
    const kidsOf = (E, homeId) => { const out = []; for (const L of E.doc.levels()) if (L !== "0") for (const o of E.doc.at(L)) if (!o.erase && o.editId === homeId) out.push({ obj: o, level: L }); return out; };

    test("a descent through the worker mints the kids' frame here as well (F67)", async () => {
        const S = mkEngine(800, 600);
        const a = movedBelow(S);
        S.flushErases();
        const kidsS = kidsOf(S, a.id);
        expect(kidsS.length).toBeGreaterThan(0);
        const kidLevel = kidsS[0].level;
        expect(kidLevel).not.toBe(S.cam.frame);            // the carry: homed a cell over from the camera's frame
        setEraseTransport(transport);
        const E = mkEngine(800, 600);
        movedBelow(E);
        expect(E.lm.frame(kidLevel)).toBeUndefined();      // nothing here has minted it
        await later(150);
        E._bakeTick();
        expect(flying(E).map((c) => c.kind)).toEqual(["descent"]);
        expect(await settle(E)).toBe(true);
        expect(E.lm.frame(kidLevel)).toBeTruthy();
        for (const L of E.doc.levels()) expect(E.lm.frame(L)).toBeTruthy();
        expect(natives(E)).toBe(natives(S));
        const ids = new Set(kidsOf(E, a.id).map((k) => k.obj.id));
        expect(painted(E).filter((o) => ids.has(o.id)).length).toBe(ids.size);   // and drawn, from the camera's frame
    });

    test("a file whose natives name a frame the lattice lacks gets the frame back on load (F67)", () => {
        const S = mkEngine(800, 600);
        const a = movedBelow(S);
        S.flushErases();
        const kidLevel = kidsOf(S, a.id)[0].level;
        const d = S.serializeDrawing();
        d.crossings.frames = d.crossings.frames.filter((f) => f.id !== kidLevel);   // what the autosave wrote that night
        const E = mkEngine(800, 600);
        E.loadDrawing(d);
        expect(E.lm.frame(kidLevel)).toBeTruthy();
        expect(natives(E)).toBe(natives(S));
        const ids = new Set(kidsOf(E, a.id).map((k) => k.obj.id));
        expect(painted(E).filter((o) => ids.has(o.id)).length).toBe(ids.size);
    });
});
