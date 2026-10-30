import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { _resetDbForTests } from "../storage/db";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { loadCanvasStore } from "../storage/localCanvases";
import { decodeObjects, decodeEntry } from "../engine/format2";
import { decodeLoops, loopsBBox } from "../engine/geometry/arcShape";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
jest.setTimeout(120000);

let api;
function Harness() {
    api = useKobinEngine({ canvasId: "stroke-reload" });
    return <div ref={api.hostRef} />;
}
async function mount() {
    let view;
    act(() => { view = render(<Harness />); });
    for (let i = 0; i < 200 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(api.engineReady).toBe(true);
    return view;
}
const save = async () => { await act(async () => { expect(await api.flushSave()).toBe(true); }); };
beforeEach(() => {
    fake.reset(); localStorage.clear();
    window.indexedDB = new IDBFactory(); _resetDbForTests();
});

test.each([false, true])("F171 whole stroke survives reload with mid-gesture save %s", async (midSave) => {
    let view = await mount();
    let e = api.engineRef.current;
    await save();
    act(() => {
        e.setTool("pen"); e.pointerDown(200, 300);
        for (let i = 1; i <= 40; i++) e.pointerMove(200 + i * 3, 300 + Math.sin(i / 10) * 100);
    });
    if (midSave) {
        await save();
        const partial = await loadCanvasStore("stroke-reload");
        const frame = partial.frames[e.cam.frame];
        expect(decodeObjects(frame.objects, frame.geo)[0].pts).toHaveLength(41);
    }
    act(() => {
        for (let i = 41; i <= 160; i++) e.pointerMove(200 + i * 3, 300 + Math.sin(i / 10) * 100);
        e.pointerUp(); e.flushBakes();
    });
    const before = e.doc.serializeNatives();
    await save();
    const stored = await loadCanvasStore("stroke-reload");
    expect(stored.entries.map(decodeEntry).find((x) => x.k === "add").obj.type).toBe("shape");
    act(() => view.unmount());
    view = await mount(); e = api.engineRef.current;
    act(() => e.flushBakes());
    const after = e.doc.serializeNatives();
    const end = (natives) => loopsBBox(decodeLoops(Object.values(natives).flat()[0].loops)).x1;
    expect(end(after)).toBe(end(before));
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
    act(() => view.unmount());
});
