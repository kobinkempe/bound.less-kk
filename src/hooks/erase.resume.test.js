/**
 * An erase saved mid-bake and opened again (Kobin, 2026-09-23: "saving and closing an erase mid-bake,
 * then re-opening or loading in the image from a file"). REAL engines and savers (the hook) over
 * fake IndexedDB: a ring erased through a stack of wide strokes, part of it baked, then the tab closed
 * (unmount: the last-chance write), the canvas opened again from the kobin-2 store, or the drawing
 * downloaded mid-bake and loaded into another canvas. The bake must resume and end as an
 * uninterrupted one — every object cut exactly once — which a reference engine that bakes the same
 * drawing straight through defines, piece for piece.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import { _resetDbForTests } from "../storage/db";
import { saveCanvasDoc } from "../storage/localCanvases";
import { encodeLoops, loopsArea } from "../engine/geometry/arcShape";
import { setEraseTransport } from "../engine/eraseWorkerClient";
import { cutJob, unwireJob, wireResult } from "../engine/eraseJob";

jest.setTimeout(120000);

let api = null;
function Harness({ id }) {
    api = useKobinEngine({ canvasId: id });
    return <div ref={api.hostRef} />;
}
const later = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function mount(id = "c1") {
    let view;
    act(() => { view = render(<Harness id={id} />); });
    for (let i = 0; i < 200 && !api.engineReady; i++) await act(async () => { await later(); });
    expect(api.engineReady).toBe(true);
    return view;
}
const E = () => api.engineRef.current;
/** Mount with the reopened engine's bake held, so its state straight after the restore can be read; `go()` lets it run. */
async function mountHeld(id) {
    const sched = KobinEngine.prototype._scheduleBake;
    KobinEngine.prototype._scheduleBake = function () {};
    let view;
    try { view = await mount(id); } finally { KobinEngine.prototype._scheduleBake = sched; }
    return { view, go: () => E()._scheduleBake(0) };
}
const C = [400, 320];
const marks = (e) => e._eraseStrokes().length;
const ink = (e) => { const out = []; for (const L of e.doc.levels()) for (const o of e.doc.list(L)) if (!o.erase) out.push(o); return out; };

/** `n` wide wavy strokes over one another, then a ring erased through all of them; nothing baked. */
function stackAndRing(n) {
    const e = E();
    act(() => {
        for (let k = 0; k < n; k++) {
            e.setTool("pen"); e.setWidth(260); e.setColor("#" + ((0x204060 + k * 0x0a0604) & 0xffffff).toString(16).padStart(6, "0"));
            e.pointerDown(C[0] - 150, C[1]);
            for (let i = 1; i <= 30; i++) { const x = C[0] - 150 + 10 * i; e.pointerMove(x, C[1] + 25 * Math.sin(x / 14 + k)); }
            e.pointerUp();
        }
        e.flushBakes();
        e._scheduleBake = () => {};                        // the bake is stepped by hand from here
        if (e._bakeTimer != null) { clearTimeout(e._bakeTimer); e._bakeTimer = null; }
        e.setTool("erasePartial"); e.setEraserSize(12);
        const ring = [];
        for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; ring.push([C[0] + 60 * Math.cos(a), C[1] + 60 * Math.sin(a)]); }
        e.pointerDown(ring[0][0], ring[0][1]);
        for (const p of ring.slice(1)) e.pointerMove(p[0], p[1]);
        e.pointerUp();
        e.flushBakes();
    });
    expect(marks(e)).toBe(1);
}
/** The tick's work, `k` pairs: the next target in the serial order cut. */
function bakeSteps(e, k) {
    act(() => {
        const Erec = e._eraseStrokes()[0];
        for (let i = 0; i < k && Erec && e._headOf(Erec); i++) e._bakeNext();
        e._render();
    });
}
/** The same drawing baked straight through, in an engine of its own. */
function reference(snap) {
    const host = document.createElement("div");
    const R = new KobinEngine(host, { width: 1024, height: 768 });
    R._scheduleBake = () => {};
    R.loadDrawing(JSON.parse(JSON.stringify(snap)));
    R.flushErases();
    const s = sig(R);
    R.destroy();
    return s;
}
/** Per z (a cut's pieces keep their object's z): each piece's loops, exactly, sorted. */
function sig(e) {
    const m = {};
    for (const o of ink(e)) {
        const z = e._zOf(o);
        (m[z] || (m[z] = [])).push(JSON.stringify(encodeLoops(o.loops)));
    }
    for (const z of Object.keys(m)) m[z].sort();
    return m;
}
const pieceCounts = (s) => { const c = {}; for (const v of Object.values(s)) c[v.length] = (c[v.length] || 0) + 1; return c; };
async function bakeOut(e, ms = 60000) {
    const t0 = Date.now();
    while ((marks(e) || e._eraseBusy()) && Date.now() - t0 < ms) await act(async () => { await later(20); });
    return marks(e) === 0;
}

afterEach(() => setEraseTransport(null));
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

describe("an erase saved mid-bake", () => {
    test("closed and opened again from the store: the bake resumes and ends as an uninterrupted one", async () => {
        let view = await mount("c1");
        stackAndRing(10);
        const ref = reference(E().serializeDrawing());
        expect(pieceCounts(ref)).toEqual({ 2: 10 });        // the reference: every stroke a disc and a remnant
        bakeSteps(E(), 4);
        const targets = E()._eraseStrokes()[0].obj.targets.slice();
        await act(async () => { await api.flushSave(); });
        act(() => view.unmount());                          // close: the hook's last-chance write, the engine destroyed
        const held = await mountHeld("c1");
        view = held.view;
        expect(marks(E())).toBe(1);                         // the mark came back, pending, with its targets
        expect(E()._eraseStrokes()[0].obj.targets).toEqual(targets);
        held.go();
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
    });

    test("downloaded mid-bake and loaded into another canvas: the mark comes with it and bakes to the same result", async () => {
        let view = await mount("c1");
        stackAndRing(8);
        const ref = reference(E().serializeDrawing());
        bakeSteps(E(), 3);
        const file = JSON.stringify(E().serializeDrawing({ name: "mid-bake" }));   // saveDrawing's document
        act(() => view.unmount());
        view = await mount("c2");
        const picked = { name: "mid-bake.boundless.json", text: async () => file };   // jsdom's File has no text()
        E()._scheduleBake = () => {};                      // held until the load has been looked at
        await act(async () => { await api.loadDrawingFile(picked); });
        expect(marks(E())).toBe(1);
        delete E()._scheduleBake; E()._scheduleBake(0);
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
    });

    test("closed with a drag in progress and undo/redo entries around the erase: resumes, and undo/redo of the erase still work", async () => {
        let view = await mount("c1");
        const e0 = E();
        const far = (x) => act(() => { e0.setTool("pen"); e0.setWidth(6); e0.pointerDown(x, 80); for (let i = 1; i <= 5; i++) e0.pointerMove(x + 10 * i, 80); e0.pointerUp(); e0.flushBakes(); });
        far(60);                                            // an add before the erase
        stackAndRing(8);
        const ref = reference(E().serializeDrawing());
        bakeSteps(E(), 3);
        far(700);                                           // an add after it...
        act(() => { E().undo(); });                         // ...undone: a redo entry
        const strokesBefore = ink(E()).length;
        act(() => {                                         // a cut-out selected and dragged, never dropped
            const e = E();
            e.setTool("select");
            e.pointerDown(C[0], C[1]); e.pointerUp();
            e.pointerDown(C[0], C[1]);
            for (let i = 1; i <= 6; i++) e.pointerMove(C[0] + 20 * i, C[1]);
        });
        expect(E().selection).toBeTruthy();
        act(() => view.unmount());
        const held = await mountHeld("c1");
        view = held.view;
        expect(marks(E())).toBe(1);
        held.go();
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);                      // the dragged disc's own loops, wherever its table put it
        expect(ink(E()).length).toBe(strokesBefore + 5);    // five more cut; the undone add stays out
        act(() => { E().redo(); });                         // the add after the erase comes back
        expect(ink(E()).length).toBe(strokesBefore + 6);
        act(() => { E().undo(); E().undo(); });             // it, then the whole erase
        const whole = ink(E()).filter((o) => o.loops && Math.abs(loopsArea(o.loops)) > 10000);
        expect(whole.length).toBe(8);                       // every stroke whole again
        expect(marks(E())).toBe(0);
        act(() => { E().redo(); });
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
    });

    test("closed with a cut in the worker: the destroyed engine bakes no further; the reopened one finishes the same", async () => {
        setEraseTransport((msg) => later(1500).then(() => wireResult(cutJob(unwireJob(msg))).msg));
        let view = await mount("c1");
        stackAndRing(8);
        const ref = reference(E().serializeDrawing());
        bakeSteps(E(), 2);
        const old = E();
        const ticks = { n: 0 };
        const tick0 = old._bakeTick.bind(old);
        old._bakeTick = () => { ticks.n++; return tick0(); };
        delete old._scheduleBake;                            // the engine's own timers from here
        act(() => { old._bakeTick(); });
        const out = [...old._cuts.values()].filter((c) => c.state === "flight");
        expect(out.length).toBeGreaterThan(0);               // cuts in the workers
        const flying = out[0].id;
        act(() => view.unmount());                           // closed with the cut in flight (the unmount's own write)
        const n0 = ticks.n;
        await act(async () => { await later(1800); });       // its answer lands after the close
        expect(ticks.n - n0).toBe(0);                        // red before: the destroyed engine went on baking
        expect(old.doc.getById(flying)).not.toBeNull();       // and its late answer was not applied
        view = await mount("c1");
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);                       // the cut in flight was never logged: done again
        act(() => view.unmount());
    });

    test("an object a select cut out of order before the close is not cut again after it", async () => {
        let view = await mount("c4");            // its own canvas: the last test's closing write lands late
        const e0 = E();
        act(() => {                                          // a bar drawn first, under the whole stack, sticking out of it
            e0.setTool("pen"); e0.setWidth(20); e0.setColor("#aa3300");
            e0.pointerDown(C[0], 30); for (let i = 1; i <= 20; i++) e0.pointerMove(C[0], 30 + 29 * i); e0.pointerUp(); e0.flushBakes();
        });
        const barZ = e0._zOf(ink(e0)[0]);
        stackAndRing(6);
        const ref = reference(E().serializeDrawing());
        bakeSteps(E(), 2);
        act(() => { const e = E(); e.setTool("select"); e.pointerDown(C[0], 45); e.pointerUp(); });   // the bar's top end: cut by the barrier
        const barPieces = ink(E()).filter((o) => E()._zOf(o) === barZ).map((o) => o.id);
        expect(barPieces.length).toBeGreaterThan(1);
        act(() => view.unmount());
        const targets = [];
        const bake0 = KobinEngine.prototype._dispatchPair;
        KobinEngine.prototype._dispatchPair = function (Erec, t, o) { targets.push(t.obj.id); return bake0.call(this, Erec, t, o); };
        try {
            const held = await mountHeld("c4");
            view = held.view;
            expect(marks(E())).toBe(1);
            held.go();
            expect(await bakeOut(E())).toBe(true);
        } finally { KobinEngine.prototype._dispatchPair = bake0; }
        expect(targets.length).toBeGreaterThan(0);
        for (const id of barPieces) expect(targets).not.toContain(id);          // their headers name the mark handled
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
    });

    test("downloaded after a select cut an object out of order: loaded into a canvas or imported by the gallery, nothing is cut twice", async () => {
        let view = await mount("c1");
        const e0 = E();
        act(() => {
            e0.setTool("pen"); e0.setWidth(20); e0.setColor("#aa3300");
            e0.pointerDown(C[0], 30); for (let i = 1; i <= 20; i++) e0.pointerMove(C[0], 30 + 29 * i); e0.pointerUp(); e0.flushBakes();
        });
        stackAndRing(6);
        const ref = reference(E().serializeDrawing());
        bakeSteps(E(), 2);
        act(() => { const e = E(); e.setTool("select"); e.pointerDown(C[0], 45); e.pointerUp(); });   // the bar, cut out of order
        const doc = E().serializeDrawing({ name: "mid-bake" });
        const file = JSON.stringify(doc);
        act(() => view.unmount());
        view = await mount("c2");                            // "Load" into an open canvas
        const picked = { name: "mid-bake.boundless.json", text: async () => file };
        await act(async () => { await api.loadDrawingFile(picked); });
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
        expect(await saveCanvasDoc("c3", JSON.parse(file))).toBe(true);   // the gallery's import
        const held = await mountHeld("c3");
        view = held.view;
        expect(marks(E())).toBe(1);
        held.go();
        expect(await bakeOut(E())).toBe(true);
        expect(sig(E())).toEqual(ref);
        act(() => view.unmount());
    });
});
