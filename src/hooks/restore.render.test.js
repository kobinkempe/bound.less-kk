/**
 * The store-to-engine restore (useKobinEngine `restoreFrom`), STALL 2026-09-23: on the Magnum Opus it
 * was ONE 5-7 s task (Chrome names it `IDBTransaction.oncomplete`), and it rendered twice — once
 * inside `loadDrawing`, a cold list build, then again after the log replay. It renders once now,
 * after the replay, in a task of its own.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import { macroYield } from "../engine/report";
import { _resetDbForTests } from "../storage/db";
import { loadCanvasStore } from "../storage/localCanvases";

jest.setTimeout(30000);

let api = null;
function Harness() {
    api = useKobinEngine({ canvasId: "c1" });
    return <div ref={api.hostRef} />;
}
async function mount() {
    let view;
    act(() => { view = render(<Harness />); });
    for (let i = 0; i < 100 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return view;
}
const E = () => api.engineRef.current;
function draw(x) {
    act(() => {
        const e = E();
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        e.pointerUp();
    });
}
// Renders inside loadDrawing, renders in all, and the order against a task posted as the load ends.
function watch() {
    const c = { inLoad: 0, all: 0, loads: 0, order: [] };
    let loading = false;
    const render0 = KobinEngine.prototype._render, load0 = KobinEngine.prototype.loadDrawing;
    KobinEngine.prototype._render = function (...a) { c.all++; if (loading) c.inLoad++; c.order.push("render"); return render0.apply(this, a); };
    KobinEngine.prototype.loadDrawing = function (...a) {
        c.loads++; loading = true;
        try { return load0.apply(this, a); } finally {
            loading = false; c.order.push("load");
            macroYield().then(() => c.order.push("next task"));
        }
    };
    c.restore = () => { KobinEngine.prototype._render = render0; KobinEngine.prototype.loadDrawing = load0; };
    return c;
}

beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

test("a reload from the store renders once, after the replay, in a task of its own", async () => {
    const view = await mount();
    draw(100);
    await act(async () => { await api.flushSave(); });
    draw(220);
    await act(async () => { await api.flushSave(); });
    expect((await loadCanvasStore("c1")).entries.length).toBeGreaterThan(0);   // a log tail to replay
    const c = watch();
    try {
        await act(async () => { await api.reloadFromStore({ keepCamera: true }); });
    } finally { c.restore(); }
    expect(c.loads).toBe(1);
    expect(c.inLoad).toBe(0);
    expect(c.all).toBe(1);
    expect(c.order.slice(0, 3)).toEqual(["load", "next task", "render"]);
    expect(api.stats().strokes).toBe(2);
    act(() => view.unmount());
});

test("opening a stored canvas renders once, after the load, before the editor is ready", async () => {
    let view = await mount();
    draw(100);
    await act(async () => { await api.flushSave(); });
    act(() => view.unmount());
    const c = watch();
    try {
        view = await mount();
    } finally { c.restore(); }
    expect(api.engineReady).toBe(true);
    expect(c.loads).toBe(1);
    expect(c.inLoad).toBe(0);
    expect(c.order.indexOf("next task")).toBeGreaterThan(c.order.indexOf("load"));
    expect(c.order.lastIndexOf("render")).toBeGreaterThan(c.order.indexOf("next task"));
    expect(api.stats().strokes).toBe(1);
    act(() => view.unmount());
});
