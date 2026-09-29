/**
 * A reload after a multi-drop subtree drag (OPEN-FLAGS F98; Kobin's Earth, 2026-09-23). Each drop
 * walks its per-object members into a container the next drop empties; a reload then put them back
 * at an older drop's tables. REAL engines and savers (the hook) over fake IndexedDB: after the drops
 * the canvas is opened again, downloaded (foldStore) and pushed to and pulled from the cloud (fake
 * Firestore); every native (home, table, geometry) and every inked frame's address comes back.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import KobinEngine from "../engine/KobinEngine";
import { _resetDbForTests } from "../storage/db";
import { loadCanvasDoc, loadCanvasStore, cloudPushSource, replaceCanvasStore } from "../storage/localCanvases";
import { cloudPushCanvas2, cloudPullCanvas2 } from "../cloud/canvasSync";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { rectLoop } from "../engine/geometry/arcShape";

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

const rects = (e, frame, n, seed) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = ((i * 7919 + seed) % 20000) - 10000, y = ((i * 104729 + seed) % 20000) - 10000;
        const o = { type: "shape", origin: "native", id: e.doc.allocId(),
            loops: rectLoop({ left: x, top: y, right: x + 50 + (i % 900), bottom: y + 40 }), color: "#123", opacity: 1, w: 8 };
        e.doc.add(o, frame); ids.push(o.id);
    }
    return ids;
};
// The camera at depth 1; a frame R (with a kid K) selected whole, and the natives of a sibling cell S
// selected one by one: the members a subtree drag walks from cell to cell at depth 2.
function build(e) {
    e.lm.ensureSpine(4);
    e.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = e.lm.cellChild("1", 5, 5), K = e.lm.cellChild(R.id, 7, -7), S = e.lm.cellChild("1", -3, 2);
    rects(e, R.id, 12, 1); rects(e, K.id, 12, 2);
    const members = rects(e, S.id, 12, 3);
    e._render();
    return { R: R.id, members };
}
function drop(e, fx, dx, dy) {
    act(() => {
        e._setSelection(fx.members, [fx.R]);
        const p = e._levelPointToScreen(fx.R, 0, 0);
        e._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        e.store.setBatch(true);
        e._dragSelection(p[0] + dx, p[1] + dy);
        e.pointerUp();
    });
}
const homeOf = (e, id) => e.doc.getById(id).level;
// A frame's address from the root down.
const chain = (e, id) => { const out = []; for (let f = e.lm.frame(id); f; f = f.parent != null ? e.lm.frame(f.parent) : null) out.unshift([f.id, f.parent, f.cell.i, f.cell.j]); return out; };
/** Every native as stored, by home, and the address chain of every frame that holds one. */
function state(e) {
    const n = e.doc.serializeNatives();
    const homes = Object.keys(n).filter((k) => n[k].length).sort();
    return JSON.stringify({ natives: homes.map((k) => [k, n[k].slice().sort((a, b) => a.id - b.id)]), frames: homes.map((k) => chain(e, k)) });
}
/** Three drops saved one by one: the second empties the first's container, the third stays in the second's. */
async function dragThrice(fx) {
    const at = [];
    for (const [dx, dy] of [[40, 0], [40, 0], [3, 0]]) {
        drop(E(), fx, dx, dy);
        at.push(homeOf(E(), fx.members[0]));
        await save();
    }
    expect(at[0]).not.toBe(at[1]);                              // the second drop left the first container...
    expect(E().doc.count(at[0])).toBe(0);                       // ...empty
    expect(at[2]).toBe(at[1]);                                  // the third stayed in the second's
    await save();
    return at;
}

describe("a multi-drop subtree drag survives the store (F98)", () => {
    test("closed and opened again: every native and inked frame as it was", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        await dragThrice(fx);
        const before = state(E());
        act(() => view.unmount());
        view = await mount("c1");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });

    test("downloaded (foldStore): the same document", async () => {
        const view = await mount("c1");
        const fx = build(E());
        await save();
        await dragThrice(fx);
        const before = state(E());
        act(() => view.unmount());
        const doc = await loadCanvasDoc("c1");
        const F = new KobinEngine(document.createElement("div"), { width: 800, height: 600 });
        F.loadDrawing(doc, { render: false });
        expect(state(F)).toBe(before);
        F.destroy();
    });

    test("pushed to the cloud and pulled whole into another canvas: the same document", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        await dragThrice(fx);
        const before = state(E());
        act(() => view.unmount());
        const src = await cloudPushSource("c1");
        await cloudPushCanvas2("u1", { id: "c1", name: "A", strokes: 36, levels: 3 }, src, { deviceId: "d1" });
        const pulled = await cloudPullCanvas2("u1", "c1");
        expect(pulled && pulled.full).toBe(true);
        await replaceCanvasStore("c2", pulled);
        view = await mount("c2");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });

    test("a container emptied, then drawn in: listed again, it is snapshotted, and its old moves stay out", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        const at = await dragThrice(fx);                        // at[0] is empty now: no longer listed
        act(() => {
            const e = E();
            e.cam.set({ frame: at[0], inScale: 1, inPanX: 400, inPanY: 300 });
            e.setTool("pen"); e.setWidth(20);
            e.pointerDown(380, 300); e.pointerMove(400, 310); e.pointerMove(420, 300); e.pointerUp();
            e.flushBakes();
        });
        expect(E().doc.count(at[0])).toBe(1);                   // an add, which forces no snapshot
        await save();
        expect((await loadCanvasStore("c1")).header.frameSeq[at[0]]).toBeGreaterThan(0);
        act(() => { E().cam.set({ frame: "1", inScale: 1, inPanX: 400, inPanY: 300 }); });
        await save();
        const before = state(E());
        act(() => view.unmount());
        view = await mount("c1");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });

    test("an undone drop whose container was collected: the log still names it, and the reload is exact", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        drop(E(), fx, 40, 0); await save();
        drop(E(), fx, 40, 0); await save();
        const second = homeOf(E(), fx.members[0]);
        act(() => { expect(E().undo()).toBe(true); E().sweepFrames(); });
        expect(E().lm.frame(second)).toBeTruthy();              // empty, but the redo puts the members back there
        await save();
        drop(E(), fx, 3, 0);                                    // a fresh op: the undone drop's redo dies
        await save();
        expect(E().lm.frame(second)).toBeUndefined();           // held nothing and nothing named it
        const st = await loadCanvasStore("c1");
        expect(st.header.crossings.frames.some((f) => f.id === second)).toBe(false);
        expect(st.entries.some((en) => en.op.k !== "forget" && (en.touches || []).includes(second))).toBe(true);
        expect(st.entries.some((en) => en.op.k === "forget" && en.op.frames.includes(second))).toBe(true);   // the log's record
        await save();
        const before = state(E());
        act(() => view.unmount());
        view = await mount("c1");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });

    test("opened again, the empty frames the store held are swept once it is in, and the next write drops them", async () => {
        let view = await mount("c1");
        build(E());
        const empties = [];
        act(() => { for (let k = 0; k < 5; k++) empties.push(E().lm.cellChild("1", -40 + k, 30).id); });
        await save();
        expect((await loadCanvasStore("c1")).header.crossings.frames.filter((f) => empties.includes(f.id)).length).toBe(5);
        const before = state(E());
        act(() => view.unmount());
        view = await mount("c1");
        for (const id of empties) expect(E().lm.frame(id)).toBeUndefined();
        await save();
        const st = await loadCanvasStore("c1");
        expect(st.header.crossings.frames.filter((f) => empties.includes(f.id))).toEqual([]);
        expect(st.entries.some((en) => en.op.k === "forget" && empties.every((id) => en.op.frames.includes(id)))).toBe(true);
        expect(state(E())).toBe(before);
        act(() => view.unmount());
        view = await mount("c1");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });
});
