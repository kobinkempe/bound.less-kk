/**
 * The mark's z follows the bake down (Kobin, 2026-09-08): the objects under a mark
 * are taken top-down by z from the spatial index, the mark's z steps just below each
 * one it has handled, what a bake mints inherits its parent's z and so lands above
 * the mark, and a reload resumes with the mark where it was.
 */
import { mkEngine, useEngines, drawStroke, eraseGesture } from "./__testkit__/harness";

const ids = (E) => { const out = []; for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) out.push(o); return out; };

describe("the mark's z follows the bake down", () => {
    useEngines();

    test("candidates come top-down by z from the index; the mark steps below each; pieces land above it", () => {
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[100, 300], [700, 300]], 20);
        const B = drawStroke(E, [[100, 320], [700, 320]], 20);
        const C = drawStroke(E, [[100, 340], [700, 340]], 20);
        const far = drawStroke(E, [[100, 550], [300, 550]], 20);   // nowhere near the mark
        eraseGesture(E, [[400, 250], [400, 400]], 30);
        const marks = E._eraseStrokes();
        expect(marks).toHaveLength(1);
        const Erec = marks[0], M = Erec.obj;
        const z0 = E._zOf(M);
        expect(z0).toBeGreaterThan(E._zOf(far));
        expect(E._candidatesUnder(Erec).list.map((c) => c.id)).toEqual([C.id, B.id, A.id]);
        E._scheduleBake = () => {};
        const order = [];
        for (let i = 0; i < 3; i++) {
            const t = E._nextEraseTarget(Erec);
            order.push(t.obj.id);
            expect(E._bakeOne(Erec, t)).toBe(true);
            E._lowerMark(Erec, t);
            expect(E._zOf(M)).toBe(E._zOf(t.obj) - 0.5);
        }
        expect(order).toEqual([C.id, B.id, A.id]);
        expect(E._nextEraseTarget(Erec)).toBeNull();
        // every piece the cuts minted inherits its parent's z: all of them, and `far`, sit above the mark
        for (const o of ids(E)) expect(E._zOf(o)).toBeGreaterThan(E._zOf(M));
        expect(ids(E).length).toBeGreaterThan(4);   // the three strokes were cut in two
        // the tick consumes a mark with nothing left under it
        E._bakeTick();
        expect(E._eraseStrokes()).toHaveLength(0);
    });

    test("an object drawn after the mark is above it and never a candidate", () => {
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[100, 300], [700, 300]], 20);
        eraseGesture(E, [[400, 250], [400, 350]], 30);
        const D = drawStroke(E, [[100, 305], [700, 305]], 20);
        const Erec = E._eraseStrokes()[0];
        expect(E._candidatesUnder(Erec).list.map((c) => c.id)).toEqual([A.id]);
        expect(E._flushErasesFor(D.id)).toBe(false);
        expect(E.doc.getById(D.id).obj.loops.length).toBe(1);   // untouched
        E.flushErases();
        expect(E.doc.getById(D.id).obj.loops.length).toBe(1);
        expect(E.doc.getById(A.id)).toBeNull();                 // cut in two
    });

    test("a reload resumes with the mark's z where the bake left it", () => {
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[100, 300], [700, 300]], 20);
        const B = drawStroke(E, [[100, 320], [700, 320]], 20);
        eraseGesture(E, [[400, 250], [400, 400]], 30);
        E._scheduleBake = () => {};
        const Erec = E._eraseStrokes()[0];
        const t = E._nextEraseTarget(Erec);
        expect(t.obj.id).toBe(B.id);
        expect(E._bakeOne(Erec, t)).toBe(true);
        E._lowerMark(Erec, t);
        const zMark = E._zOf(Erec.obj);
        expect(zMark).toBe(E._zOf(B) - 0.5);
        const doc = E.serializeDrawing();
        const E2 = mkEngine(800, 600);
        E2._scheduleBake = () => {};
        E2.loadDrawing(doc);
        const marks2 = E2._eraseStrokes();
        expect(marks2).toHaveLength(1);
        expect(E2._zOf(marks2[0].obj)).toBe(zMark);
        // B's pieces sit above the mark; only A is still under it
        expect(E2._candidatesUnder(marks2[0]).list.map((c) => c.id)).toEqual([A.id]);
        E2.flushErases();
        expect(E2.doc.getById(A.id)).toBeNull();
        expect(E2._eraseStrokes()).toHaveLength(0);
    });
});
