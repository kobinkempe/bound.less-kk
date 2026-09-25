/**
 * A scene's new name is kept by an autosave of the header alone (REVIEWER-2 ST-2: the rename ran a
 * whole Save — 296 ms, 29 MB to IndexedDB, 355 ms serialising on the Magnum Opus — though the name
 * rides the header). REAL engine and saver (the hook) over fake IndexedDB.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { _resetDbForTests } from "../storage/db";
import { fake } from "../engine/__testkit__/fakeFirestore";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
jest.setTimeout(120000);

let api = null;
function Harness({ id }) {
    api = useKobinEngine({ canvasId: id });
    return <div ref={api.hostRef} />;
}
const later = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function mount(id) {
    let view;
    act(() => { view = render(<Harness id={id} />); });
    for (let i = 0; i < 200 && !api.engineReady; i++) await act(async () => { await later(); });
    expect(api.engineReady).toBe(true);
    return view;
}
const E = () => api.engineRef.current;
const save = async () => { await act(async () => { expect(await api.flushSave()).toBe(true); }); };

beforeEach(() => {
    fake.reset();
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});

test("SM-1 a scene renamed and marked on the header only keeps its name through a reload (ST-2)", async () => {
    let view = await mount("m1");
    let e = E();
    act(() => {
        e.setTool("pen");
        e.pointerDown(200, 300);
        for (let k = 1; k <= 8; k++) e.pointerMove(200 + k * 20, 300 + (k % 2) * 6);
        e.pointerUp();
        e.flushBakes();
    });
    const scenesOf = async (eng) => { let out = []; await act(async () => { out = eng.refreshScenes(); await later(20); }); return out; };
    let list = [];
    for (let i = 0; i < 100 && !list.length; i++) list = await scenesOf(e);
    expect(list.length).toBeGreaterThan(0);
    await save();
    const id = list[0].id;
    let ok = false;
    act(() => { ok = e.renameScene(id, "Saturn"); api.patchDocMeta({}); });
    expect(ok).toBe(true);
    await save();                                                      // the header alone: nothing else changed
    act(() => view.unmount());
    view = await mount("m1");
    e = E();
    const back = (e.docMeta.scenes || []).find((s) => s.id === id);
    expect(back && back.name).toBe("Saturn");
    act(() => view.unmount());
});
