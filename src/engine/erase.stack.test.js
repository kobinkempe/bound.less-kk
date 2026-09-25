/**
 * A ring erased through a stack of big overlapping objects, and what the select tool does while
 * that bake is still running (Kobin, 2026-09-23): a lasso waits for the bake and then selects every
 * cut-out; a cut-out the baker has passed drags above the mark still baking below it; a select
 * bakes what it touches first (F65); undo/redo and drags with a cut in the worker lose no cut.
 * The bake is ticked by hand here; the timing on 100 and 1,000 objects is `erase.stack.probe.js`.
 */
import { mkEngine, useEngines, eraseGesture, topAtAll } from "./__testkit__/harness";
import { setEraseTransport } from "./eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { intersectShape, loopsArea, loopsBBox } from "./geometry/arcShape";

const C = [400, 300], RING_R = 110, ERASER = 16;
const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
/** The erase worker in-process: the same job, `ms` later. */
const worker = (ms = 2) => (msg) => later(ms).then(() => wireResult(cutJob(unwireJob(msg))).msg);

/** A fill added at the camera's frame and made a shape, as a cut would. */
function shapeOf(E, pts, color, opacity = 1) {
    const o = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity, polys: [pts] }, E.cam.frame);
    E.doc.fillToShapeById(o.id);
    return E.doc.getById(o.id).obj;
}
/** A big wobbly blob (180 vertices) over the whole ring. */
function blob(E, k, color) {
    const pts = [];
    for (let i = 0; i < 180; i++) {
        const a = (i / 180) * 2 * Math.PI;
        const r = 230 + 25 * Math.sin(7 * a + k) + 10 * Math.cos(13 * a + 2 * k);
        pts.push([C[0] + r * Math.cos(a), C[1] + 0.8 * r * Math.sin(a)]);
    }
    return shapeOf(E, pts, color);
}
const circle = (r, n, turns = 1, c = C) => {
    const out = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * turns * 2 * Math.PI; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
};
/**
 * `n` blobs (z ascending: the last is on top) and a ring erased through all of them, the bake ticked
 * by hand. `under(E)` adds objects first, below the blobs. `want` is each object's area with the ring
 * out of it, by z (a cut's pieces inherit it).
 */
function stack(n, { under } = {}) {
    const E = mkEngine(800, 600);
    E._scheduleBake = () => {};
    const objs = under ? under(E) : [];
    for (let k = 0; k < n; k++) objs.push(blob(E, k, "#" + (0x204060 + k * 0x0a0604).toString(16).slice(-6)));
    E._render();
    eraseGesture(E, circle(RING_R, 72, 1.1), ERASER);
    const Erec = E._eraseStrokes()[0];
    const want = new Map();
    for (const o of objs) {
        const a = loopsArea(o.loops), cut = Math.abs(loopsArea(intersectShape(o.loops, Erec.obj.loops, E._boolOpts()).loops));
        want.set(E._zOf(o), { id: o.id, area: a - cut, full: a });
    }
    return { E, objs, Erec, want };
}
/** What the tick does, `k` times, inline: the next target cut, the mark stepped below it; then its render. */
function bakeSteps(E, Erec, k) {
    for (let i = 0; i < k; i++) {
        const t = E._nextEraseTarget(Erec);
        if (!t) break;
        E._bakeOne(Erec, t, { sync: true });
        E._lowerMark(Erec, t);
    }
    E._render();
}
async function settle(E, max = 200) {
    for (let i = 0; i < max && (E._eraseStrokes().length || E._cutInflight); i++) { E._bakeTick(); await later(4); }
    return E._eraseStrokes().length === 0 && !E._cutInflight;
}
const ink = (E) => { const out = []; for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase) out.push(o); return out; };
/** Every object whose pieces' area is not its area with the ring out: uncut, cut twice, or lost. */
function audit(E, want) {
    const byZ = new Map();
    for (const o of ink(E)) {
        const z = E._zOf(o);
        if (!want.has(z)) continue;
        const e = byZ.get(z) || { area: 0, n: 0 };
        e.area += Math.abs(loopsArea(o.loops)); e.n++;
        byZ.set(z, e);
    }
    const bad = [];
    for (const [z, w] of want) {
        const got = byZ.get(z);
        if (!got || Math.abs(got.area - w.area) > 1e-6 * w.full) bad.push({ id: w.id, want: +w.area.toFixed(1), got: got ? +got.area.toFixed(1) : 0, full: +w.full.toFixed(1) });
    }
    return bad;
}
function gesture(E, pts) {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
}
const tap = (E, x, y) => { E.setTool("select"); E.pointerDown(x, y); E.pointerUp(); };
/** What shows at a point of the ring (C + (RING_R, 0)): the mark, the selected piece, or another z. */
function onRing(E) {
    const top = topAtAll(E, C[0] + RING_R, C[1]);
    if (!top) return "paper";
    if (top.erase) return "MARK";
    return E.selection && E.selection.ids.includes(top.id) ? "SEL" : "z" + E._zOf(top);
}
/** Tap the piece at `at`, drag it right by `k × step`, recording what shows on the ring each step. */
function dragFrom(E, at, k, step = 10) {
    tap(E, at[0], at[1]);
    const id = E.selection ? E.selection.ids[0] : null;
    E.pointerDown(at[0], at[1]);
    const seen = [];
    for (let i = 1; i <= k; i++) { E.pointerMove(at[0] + i * step, at[1]); seen.push(onRing(E)); }
    E.pointerUp();
    return { id, seen };
}

describe("a ring erased through a stack, while it bakes", () => {
    useEngines();
    afterEach(() => setEraseTransport(null));

    test("a lasso drawn while the ring bakes waits for the bake, then selects every cut-out", () => {
        const { E, Erec, want } = stack(10);
        bakeSteps(E, Erec, 5);
        E.setTool("select");
        gesture(E, circle(140, 48));                       // round the cut-outs, inside the blobs
        expect(E._eraseStrokes()).toHaveLength(0);         // red before the barrier: the mark still pending
        const sel = E.selection ? E.selection.ids : [];
        expect(sel.length).toBe(10);                       // red before: 5, the discs baked so far
        const zs = new Set(sel.map((id) => E._zOf(E.doc.getById(id).obj)));
        expect(zs.size).toBe(10);                          // one disc of each object
        for (const id of sel) {
            const b = loopsBBox(E.doc.getById(id).obj.loops);
            expect(Math.max(b.x1 - C[0], C[0] - b.x0, b.y1 - C[1], C[1] - b.y0)).toBeLessThan(RING_R);
        }
        expect(audit(E, want)).toEqual([]);
    });

    test("a cut-out the baker has passed drags above the mark still baking the objects under it", () => {
        const { E, Erec, want } = stack(10);
        bakeSteps(E, Erec, 6);
        const zMark = E._zOf(Erec.obj);
        const { id, seen } = dragFrom(E, C, 20);
        expect(E._zOf(E.doc.getById(id).obj)).toBeGreaterThan(zMark);
        expect(E._zOf(Erec.obj)).toBe(zMark);               // a drag does not touch the mark
        expect(seen.slice(2)).toEqual(Array(18).fill("SEL"));   // the disc over the ring, not the white mark
        E.flushErases();
        expect(audit(E, want)).toEqual([]);                 // the moved disc was not cut again
    });

    test("the cut-out of the object the baker is on, cut by the select, drags above the mark", () => {
        const { E, Erec, want } = stack(10);
        bakeSteps(E, Erec, 3);
        for (let i = 0; i < 3; i++) { dragFrom(E, C, 12, -25); E.deselect(); }   // the three baked discs out of the way
        const zMark = E._zOf(Erec.obj);
        const { id, seen } = dragFrom(E, C, 12);            // the next object down: the select bakes it
        const z = E._zOf(E.doc.getById(id).obj);
        expect(z).toBeLessThan(zMark);                     // it was the baker's next target
        expect(E._zOf(Erec.obj)).toBeLessThan(z);          // red before: the barrier left the mark above it
        expect(seen.slice(2)).toEqual(Array(10).fill("SEL"));   // red before: MARK at every step
        E.flushErases();
        expect(audit(E, want)).toEqual([]);
    });

    test("F65: an object far below the baker is cut before it moves; the mark stays over the rest and cuts nothing twice", () => {
        // a bar drawn first, under every blob, sticking out above and below them; it crosses the ring
        // away from where the ring's gesture overlaps its own start (see the note at the end)
        const bar = (E) => [shapeOf(E, [[390, 5], [410, 5], [410, 595], [390, 595]], "#aa3300")];
        const { E, Erec, want, objs } = stack(6, { under: bar });
        bakeSteps(E, Erec, 2);
        const zMark = E._zOf(Erec.obj);
        const { id } = dragFrom(E, [400, 40], 10, 20);      // its top end, far from the ring
        const moved = E.doc.getById(id).obj;
        expect(E._zOf(moved)).toBe(E._zOf(objs[0]));       // a piece of the bar
        expect(E.doc.getById(objs[0].id)).toBeNull();       // the bar was cut before it moved
        expect(E._zOf(Erec.obj)).toBe(zMark);               // out of order: the mark stays above the four blobs still under it
        expect(E._eraseStrokes()).toHaveLength(1);
        const area = loopsArea(moved.loops);
        E.flushErases();
        expect(loopsArea(E.doc.getById(id).obj.loops)).toBe(area);   // never cut again
        expect(audit(E, want)).toEqual([]);
    });

    test("undo and redo while a cut is in the worker: the redo resumes that cut", async () => {
        setEraseTransport(worker());
        const { E, want } = stack(8);
        E._bakeTick();
        expect(E._cutInflight).not.toBeNull();
        E.undo();
        await later(10);                                    // the worker's answer lands on no mark
        E.redo();
        expect(await settle(E)).toBe(true);
        expect(audit(E, want)).toEqual([]);                 // red before: the object in flight kept its whole area
    });

    test("a drag begun while a mark's last cut is in the worker does not spend the mark before the cut lands", async () => {
        setEraseTransport(worker(20));
        const { E, want } = stack(1);
        E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#c03030", opacity: 1,
            polys: [[[20, 20], [60, 20], [60, 60], [20, 60]]] }, E.cam.frame);   // drawn after the mark, away from it
        E._render();
        E._bakeTick();
        expect(E._cutInflight).not.toBeNull();
        dragFrom(E, [40, 40], 5);
        expect(await settle(E)).toBe(true);
        expect(audit(E, want)).toEqual([]);                 // red before: the mark spent at the drag, the blob never cut
    });

    test("a select of the mark's next object while the current one's cut is in the worker, then undo and redo: nothing lost", async () => {
        setEraseTransport(worker(20));
        const { E, objs, want } = stack(6);
        E._bakeTick();
        const A = objs[5], B = objs[4];
        expect(E._cutInflight && E._cutInflight.id).toBe(A.id);
        E._flushErasesFor(B.id);                            // the select barrier on B, the next object down
        E._render();
        E.undo();
        await later(40);                                    // A's answer lands on no mark
        E.redo();
        expect(await settle(E)).toBe(true);
        expect(audit(E, want)).toEqual([]);                 // red before: A kept its whole area
    });

    test("a select of the mark's next object while the current one's cut is in the worker, then a drag of that one: it is cut before it moves", async () => {
        setEraseTransport(worker(20));
        const { E, objs, want } = stack(6);
        E._bakeTick();
        const A = objs[5], B = objs[4];
        expect(E._cutInflight && E._cutInflight.id).toBe(A.id);
        E._flushErasesFor(B.id);
        E._render();
        dragFrom(E, C, 5, 20);                              // A is on top at the centre: tap it, drag it
        expect(E.doc.getById(A.id)).toBeNull();             // red before: A dragged away uncut
        expect(await settle(E)).toBe(true);
        expect(audit(E, want)).toEqual([]);
    });

    test("flushErases with a cut in the worker bakes that cut too", async () => {
        setEraseTransport(worker(20));
        const { E, want } = stack(3);
        E._bakeTick();
        expect(E._cutInflight).not.toBeNull();
        E.flushErases();
        expect(E._eraseStrokes()).toHaveLength(0);
        await later(40);
        expect(audit(E, want)).toEqual([]);                 // red before: the object in flight was left whole
    });

    test("a session through the worker: drags, a move undone and redone, a select of the baker's target — nothing lost or cut twice", async () => {
        setEraseTransport(worker());
        const { E, want } = stack(12);
        for (let i = 0; i < 4; i++) { E._bakeTick(); await later(6); }
        dragFrom(E, C, 15, -20); E.deselect();
        for (let i = 0; i < 3; i++) { E._bakeTick(); await later(6); }
        dragFrom(E, C, 15, 20); E.deselect();
        E.undo(); E.redo();
        dragFrom(E, C, 15, 0.5); E.deselect();              // whatever is on top at the centre now
        E.undo();
        expect(await settle(E)).toBe(true);
        expect(audit(E, want)).toEqual([]);
    }, 30000);
});
