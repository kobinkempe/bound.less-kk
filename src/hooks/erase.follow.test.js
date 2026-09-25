/**
 * An erase baking while a second tab follows (SYNC-PLAN R2; Kobin, 2026-09-23: the bake runs only in
 * the tab holding the pen, never twice). Two tabs of one canvas, REAL engines and savers over one
 * fake IndexedDB, the in-memory Web Locks and BroadcastChannel of sync.tabs.test.js: the holder
 * bakes a ring through a stack and saves; the follower reloads on each save and must not bake; the
 * pen handed over mid-bake moves the bake with it, and the result is an uninterrupted bake's.
 */
import React, { useEffect, useRef } from "react";
import { render, act, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import { CanvasSession, editorFromHook } from "../cloud/canvasSession";
import { makeLocks, makeChannelBus } from "../engine/__testkit__/fakeTabs";
import { _resetDbForTests } from "../storage/db";
import { upsertIndexEntry } from "../storage/localCanvases";
import { encodeLoops } from "../engine/geometry/arcShape";

jest.setTimeout(120000);

const OPTS = { beatMs: 60, syncMs: 120, stealAfterMs: 250, askWaitMs: 400, followMinMs: 10, followCostFactor: 0, openTimeoutMs: 800, ttlMs: 2000 };
const tabs = {};
function Tab({ name, canvasId, locks, Channel }) {
    const apiRef = useRef(null);
    const sessRef = useRef(null);
    const api = useKobinEngine({ canvasId, onAutosave: (a) => { if (sessRef.current) sessRef.current.onLocalSaved(a.seq, { data: a.data }); } });
    apiRef.current = api;
    tabs[name] = tabs[name] || {};
    tabs[name].api = api;
    useEffect(() => {
        if (!api.engineReady) return undefined;
        const s = new CanvasSession({ canvasId, uid: null, deviceId: "laptop", deviceName: "laptop", tabId: name,
            editor: editorFromHook(() => apiRef.current), env: { locks, Channel, visible: () => true }, opts: OPTS });
        sessRef.current = s;
        tabs[name].session = s;
        s.start();
        return () => { s.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.engineReady]);
    return <div ref={api.hostRef} />;
}
const E = (name) => tabs[name].api.engineRef.current;
const mode = (name) => tabs[name].session && tabs[name].session.state.mode;
async function mount(name, env) {
    let view;
    act(() => { view = render(<Tab name={name} canvasId="c1" {...env} />); });
    await waitFor(() => expect(tabs[name].session).toBeTruthy());
    return view;
}
const later = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const C = [400, 320];
const marks = (e) => e._eraseStrokes().length;
const ink = (e) => { const out = []; for (const L of e.doc.levels()) for (const o of e.doc.list(L)) if (!o.erase) out.push(o); return out; };
function sig(e) {
    const m = {};
    for (const o of ink(e)) { const z = e._zOf(o); (m[z] || (m[z] = [])).push(JSON.stringify(encodeLoops(o.loops))); }
    for (const z of Object.keys(m)) m[z].sort();
    return m;
}
function reference(snap) {
    const R = new KobinEngine(document.createElement("div"), { width: 1024, height: 768 });
    R._scheduleBake = () => {};
    R.loadDrawing(JSON.parse(JSON.stringify(snap)));
    R.flushErases();
    const s = sig(R);
    R.destroy();
    return s;
}
/** In tab `e`: `n` wide strokes and a ring through them; the tab's bake is stepped by hand. */
function stackAndRing(e, n) {
    act(() => {
        for (let k = 0; k < n; k++) {
            e.setTool("pen"); e.setWidth(260); e.setColor("#" + ((0x204060 + k * 0x0a0604) & 0xffffff).toString(16).padStart(6, "0"));
            e.pointerDown(C[0] - 150, C[1]);
            for (let i = 1; i <= 30; i++) { const x = C[0] - 150 + 10 * i; e.pointerMove(x, C[1] + 25 * Math.sin(x / 14 + k)); }
            e.pointerUp();
        }
        e.flushBakes();
        e._scheduleBake = () => {};
        if (e._bakeTimer != null) { clearTimeout(e._bakeTimer); e._bakeTimer = null; }
        e.setTool("erasePartial"); e.setEraserSize(12);
        const ring = [];
        for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; ring.push([C[0] + 60 * Math.cos(a), C[1] + 60 * Math.sin(a)]); }
        e.pointerDown(ring[0][0], ring[0][1]);
        for (const p of ring.slice(1)) e.pointerMove(p[0], p[1]);
        e.pointerUp();
        e.flushBakes();
    });
}
function bakeSteps(e, k) {
    act(() => {
        const Erec = e._eraseStrokes()[0];
        for (let i = 0; i < k && Erec; i++) {
            const t = e._nextEraseTarget(Erec);
            if (!t) break;
            e._bakeOne(Erec, t, { sync: true });
            e._lowerMark(Erec, t);
        }
        e._render();
    });
}
/** Counts every object a tab's engine bakes (its `_bakeOne`), on the engine instance. */
function countBakes(e) {
    const c = { n: 0 };
    const orig = e._bakeOne.bind(e);
    e._bakeOne = (...a) => { c.n++; return orig(...a); };
    return c;
}

let env;
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    for (const k of Object.keys(tabs)) delete tabs[k];
    env = { locks: makeLocks(), Channel: makeChannelBus() };
    upsertIndexEntry({ id: "c1", name: "A" });
});

test("a follower tab reloads mid-bake and does not bake; it shows what the holder saved", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    const bBakes = countBakes(E("B"));
    stackAndRing(E("A"), 6);
    const ref = reference(E("A").serializeDrawing());
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(marks(E("B"))).toBe(1));          // the follower has the pending mark
    bakeSteps(E("A"), 3);
    await act(async () => { await tabs.A.api.flushSave(); });
    await act(async () => { await later(600); });                // the follower reloads; its own timers run
    expect(bBakes.n).toBe(0);                                     // red before: the follower baked the mark itself
    bakeSteps(E("A"), 10);
    act(() => { E("A")._bakeTick(); });                          // nothing left under the mark: the tick spends it
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(marks(E("B"))).toBe(0));
    expect(sig(E("A"))).toEqual(ref);
    expect(sig(E("B"))).toEqual(ref);
    expect(bBakes.n).toBe(0);
    act(() => { a.unmount(); b.unmount(); });
});

test("the pen handed over mid-bake: the new holder finishes the bake, the old one stops, nothing is cut twice", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    stackAndRing(E("A"), 6);
    const ref = reference(E("A").serializeDrawing());
    bakeSteps(E("A"), 2);
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(marks(E("B"))).toBe(1));
    const aBakes = countBakes(E("A"));
    await act(async () => { await tabs.B.session.takeOver(); });
    await waitFor(() => expect(mode("B")).toBe("editing"));
    await waitFor(() => expect(mode("A")).toBe("readonly"));
    const t0 = Date.now();
    while (marks(E("B")) && Date.now() - t0 < 60000) await act(async () => { await later(20); });
    expect(marks(E("B"))).toBe(0);
    expect(sig(E("B"))).toEqual(ref);
    await act(async () => { await tabs.B.api.flushSave(); });
    await waitFor(() => expect(marks(E("A"))).toBe(0));
    expect(sig(E("A"))).toEqual(ref);
    expect(aBakes.n).toBe(0);                                     // the old holder baked nothing after it let go
    act(() => { a.unmount(); b.unmount(); });
});
