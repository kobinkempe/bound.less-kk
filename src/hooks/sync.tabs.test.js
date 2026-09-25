/**
 * SYNC-PLAN R2 on one device: two tabs of one canvas, REAL engines and savers (the hook) over one
 * IndexedDB, with an in-memory Web Locks and BroadcastChannel. The second tab opens read-only and
 * follows; "Edit here" hands the pen over with a stroke in progress kept; closing the holder
 * promotes the waiting tab; a holder that never answers has its lock stolen. Signed out here; the
 * cloud's part is sync.devices.test.js.
 */
import React, { useEffect, useRef } from "react";
import { render, act, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { CanvasSession, editorFromHook } from "../cloud/canvasSession";
import { makeLocks, makeChannelBus } from "../engine/__testkit__/fakeTabs";
import { _resetDbForTests } from "../storage/db";
import { loadCanvasStore, upsertIndexEntry } from "../storage/localCanvases";

jest.setTimeout(30000);

const OPTS = { beatMs: 60, syncMs: 120, stealAfterMs: 250, askWaitMs: 400, followMinMs: 10, followCostFactor: 0, openTimeoutMs: 800, ttlMs: 2000 };
const tabs = {};

const hidden = new Set();          // tab names whose page is hidden
function Tab({ name, canvasId, locks, Channel, uid = null, device = "laptop" }) {
    const apiRef = useRef(null);
    const sessRef = useRef(null);
    const api = useKobinEngine({ canvasId, onAutosave: (a) => { if (sessRef.current) sessRef.current.onLocalSaved(a.seq, { data: a.data }); } });
    apiRef.current = api;
    tabs[name] = tabs[name] || {};
    tabs[name].api = api;
    useEffect(() => {
        if (!api.engineReady) return undefined;
        const s = new CanvasSession({
            canvasId, uid, deviceId: device, deviceName: device, tabId: name,
            editor: editorFromHook(() => apiRef.current),
            env: { locks, Channel, visible: () => !hidden.has(name) }, opts: OPTS,
        });
        sessRef.current = s;
        tabs[name].session = s;
        s.start();
        return () => { s.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api.engineReady]);
    return <div ref={api.hostRef} />;
}

const E = (name) => tabs[name].api.engineRef.current;
const strokes = (name) => tabs[name].api.stats().strokes;
const mode = (name) => tabs[name].session && tabs[name].session.state.mode;
function draw(name, x = 100, done = true) {
    const e = E(name);
    act(() => {
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        if (done) e.pointerUp();
    });
}
async function mount(name, env) {
    let view;
    act(() => { view = render(<Tab name={name} canvasId="c1" {...env} />); });
    await waitFor(() => expect(tabs[name].session).toBeTruthy());
    return view;
}

let env;
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    for (const k of Object.keys(tabs)) delete tabs[k];
    hidden.clear();
    env = { locks: makeLocks(), Channel: makeChannelBus() };
    upsertIndexEntry({ id: "c1", name: "A" });
});

test("the second tab opens read-only, cannot draw or write, and follows the first", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    expect(tabs.B.session.state.why).toBe("tab");
    expect(E("B").readOnly).toBe(true);

    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(strokes("B")).toBe(1));

    const before = (await loadCanvasStore("c1")).header.seq;
    draw("B", 300);
    await act(async () => { await tabs.B.api.flushSave(); });
    expect(strokes("B")).toBe(1);
    expect(E("B").undo()).toBe(false);
    expect((await loadCanvasStore("c1")).header.seq).toBe(before);
    // A change that does not come through the pen (a pending eraser's bake does this) is not saved either.
    act(() => { E("B").doc.add({ type: "stroke", origin: "native", id: E("B").doc.allocId(), pts: [[0, 0], [5, 5]], lwFrame: 2, color: "#000", opacity: 1 }, E("B").cam.frame); });
    await act(async () => { await tabs.B.api.flushSave(); });
    expect((await loadCanvasStore("c1")).header.seq).toBe(before);
    expect((await loadCanvasStore("c1")).header.strokes).toBe(1);
    act(() => { a.unmount(); b.unmount(); });
});

test("Edit here: the holder ends its stroke, saves and lets go; the pen and the stroke move over", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    draw("A", 100);
    draw("A", 200, false);                   // mid-stroke when the other tab asks
    expect(E("A")._drawing).toBeTruthy();
    await act(async () => { await tabs.B.session.takeOver(); });
    await waitFor(() => expect(mode("B")).toBe("editing"));
    await waitFor(() => expect(mode("A")).toBe("readonly"));
    expect(E("A")._drawing).toBeFalsy();
    expect(E("A").readOnly).toBe(true);
    expect(strokes("B")).toBe(2);             // the stroke in progress was kept
    expect(E("B").readOnly).toBe(false);

    draw("B", 300);
    await act(async () => { await tabs.B.api.flushSave(); });
    await waitFor(() => expect(strokes("A")).toBe(3));
    expect(E("B").undo()).toBe(true);        // B's own undo stack works after the hand-over
    await act(async () => { await tabs.B.api.flushSave(); });
    await waitFor(() => expect(strokes("A")).toBe(2));
    act(() => { a.unmount(); b.unmount(); });
});

test("closing the holder promotes the waiting tab, with everything the holder drew", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    draw("A");
    draw("A", 180);
    act(() => { a.unmount(); });             // the unmount flush, then the lock
    await waitFor(() => expect(mode("B")).toBe("editing"));
    expect(strokes("B")).toBe(2);
    draw("B", 260);
    await act(async () => { await tabs.B.api.flushSave(); });
    const s = await loadCanvasStore("c1");
    expect(s.header.strokes).toBe(3);
    act(() => { b.unmount(); });
});

test("a holder that never answers has its lock stolen and turns read-only", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    tabs.A.session._channel.onmessage = null;      // deaf: frozen, or hung
    await act(async () => { await tabs.B.session.takeOver(); });
    await waitFor(() => expect(mode("B")).toBe("editing"), { timeout: 5000 });   // the steal waits stealAfterMs, then reopens
    await waitFor(() => expect(mode("A")).toBe("readonly"), { timeout: 5000 });
    expect(E("A").readOnly).toBe(true);
    expect(strokes("B")).toBe(1);
    act(() => { a.unmount(); b.unmount(); });
});

test("a lock granted to a tab that has just stopped is let go (Chrome after a Fast Refresh)", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    // The holder lets go; the grant to B is a later task, and B stops before it runs.
    const lock = "boundless:canvas:c1";
    expect(env.locks.queued(lock)).toBe(1);
    await act(async () => {
        await tabs.A.session.stop();
        for (let i = 0; i < 20 && env.locks.queued(lock); i++) await Promise.resolve();   // granted, its task not yet run
        expect(env.locks.queued(lock)).toBe(0);
        tabs.B.session.stop();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    act(() => { a.unmount(); b.unmount(); });
    expect(env.locks.isHeld(lock)).toBe(false);
    const c = await mount("C", env);
    await waitFor(() => expect(mode("C")).toBe("editing"));
    act(() => { c.unmount(); });
});

test("a hidden read-only tab does not reload; it catches up when shown", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    hidden.add("B");
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(strokes("B")).toBe(0);
    hidden.delete("B");
    act(() => { tabs.B.session.onVisibility(true); });
    await waitFor(() => expect(strokes("B")).toBe(1));
    act(() => { a.unmount(); b.unmount(); });
});

// STALL (2026-09-23): a follow reload is the whole store into the engine, 5-7 s of main thread on the
// Magnum Opus; a holder's write that moved no data (a camera, a name) is followed by its header alone.
function counters(name) {
    const e = E(name), c = { loads: 0, notes: [] };
    const load = e.loadDrawing.bind(e);
    e.loadDrawing = (...a) => { c.loads++; return load(...a); };
    const s = tabs[name].session, note = s.onNotice;
    s.onNotice = (n) => { c.notes.push(n.kind); note(n); };
    return c;
}

test("a camera-only save by the holder does not reload the follower; a stroke does (STALL)", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    expect(strokes("B")).toBe(1);
    const c = counters("B");
    const seq = (await loadCanvasStore("c1")).header.seq;
    act(() => { E("A").panBy(80, 30); });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await tabs.A.api.lastWrite(); });
    const h = (await loadCanvasStore("c1")).header;
    expect(h.seq).toBe(seq);
    expect(h.camera.inPanX).toBe(E("A").cam.state().inPanX);   // the camera was written
    await waitFor(() => expect(c.notes).toContain("reloaded"));
    expect(c.loads).toBe(0);
    draw("A", 200);
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(strokes("B")).toBe(2));
    expect(c.loads).toBe(1);
    act(() => { a.unmount(); b.unmount(); });
});

test("a rename in the holder reaches the follower without a reload (STALL)", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    const c = counters("B");
    act(() => { tabs.A.api.patchDocMeta({ name: "Renamed" }); });
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(E("B").docMeta.name).toBe("Renamed"));
    expect(c.loads).toBe(0);
    act(() => { a.unmount(); b.unmount(); });
});

test("a hidden follower owed a stroke still reloads when a camera-only save comes after it (STALL)", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    const c = counters("B");
    hidden.add("B");
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    act(() => { E("A").panBy(80, 30); });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await tabs.A.api.lastWrite(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(c.loads).toBe(0);
    hidden.delete("B");
    act(() => { tabs.B.session.onVisibility(true); });
    await waitFor(() => expect(strokes("B")).toBe(1));
    expect(c.loads).toBe(1);
    act(() => { a.unmount(); b.unmount(); });
});

test("a save that lands during a follow reload waits the follow gap, not the reload's end (STALL)", async () => {
    const a = await mount("A", env);
    await waitFor(() => expect(mode("A")).toBe("editing"));
    const b = await mount("B", env);
    await waitFor(() => expect(mode("B")).toBe("readonly"));
    const sB = tabs.B.session, runs = [];
    sB.o.followMinMs = 600;
    const reload = sB.editor.reload;
    sB.editor.reload = async (o) => {
        const r = { start: Date.now() };
        runs.push(r);
        const ms = await reload(o);
        await new Promise((res) => setTimeout(res, 150));   // a slow reload: A's next save lands during it
        r.end = Date.now();
        return ms;
    };
    draw("A");
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(runs.length).toBe(1));
    draw("A", 200);
    await act(async () => { await tabs.A.api.flushSave(); });
    await waitFor(() => expect(runs.length).toBe(2), { timeout: 5000 });
    await waitFor(() => expect(runs[1].end).toBeTruthy());
    expect(strokes("B")).toBe(2);
    expect(runs[1].start - runs[0].end).toBeGreaterThanOrEqual(550);
    act(() => { a.unmount(); b.unmount(); });
});
