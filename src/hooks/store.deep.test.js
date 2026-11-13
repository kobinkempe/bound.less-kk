/**
 * A subtree drag 2^64 levels down through the store and the cloud (docs/reference/depth-overflow-design-2026-11-13.md):
 * the frames' depths are Deeps there (depth.js), in the log's move records, the header's lattice and the camera. REAL engines
 * and savers (the hook) over fake IndexedDB and fake Firestore, as store.subtree.test.js: closed and opened again (the
 * log replayed), downloaded (foldStore), and pushed and pulled whole: every native and inked frame comes back.
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
import { add, parse } from "../engine/depth";
import { FILE_VERSION } from "../engine/persist";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db }));
jest.setTimeout(120000);

const D = parse("18446744073709551616");   // 2^64
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
// The camera D levels down; a frame R (with a kid K) selected whole, and the natives of a sibling cell S one by one.
function build(e) {
    e.lm.ensureSpine(add(D, 3));
    const F = e.lm.ensureSpine(D);
    e.cam.set({ activeLevel: D, frame: F, inScale: 1, inPanX: 400, inPanY: 300 });
    const R = e.lm.cellChild(F, 5, 5), K = e.lm.cellChild(R.id, 7, -7), S = e.lm.cellChild(F, -3, 2);
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
const chain = (e, id) => { const out = []; for (let f = e.lm.frame(id); f; f = f.parent != null ? e.lm.frame(f.parent) : null) out.unshift([f.id, f.parent, f.cell.i, f.cell.j, String(f.depth)]); return out; };
/** Every native as stored, by home, and the address and depth of every frame that holds one. */
function state(e) {
    const n = e.doc.serializeNatives();
    const homes = Object.keys(n).filter((k) => n[k].length).sort();
    return JSON.stringify({ natives: homes.map((k) => [k, n[k].slice().sort((a, b) => a.id - b.id)]), frames: homes.map((k) => chain(e, k)),
        camera: String(e.activeLevel) });
}
async function dragTwice(fx) {
    for (const [dx, dy] of [[40, 0], [40, 0]]) { drop(E(), fx, dx, dy); await save(); }
    expect(E().activeLevel).toBe(D);
    const st = await loadCanvasStore("c1");
    expect(st.entries.some((en) => en.op.k === "moveFrames")).toBe(true);   // the log holds the frames' moves, with their depths
}

describe("a subtree drag 2^64 levels down survives the store and the cloud", () => {
    test("closed and opened again: the log replayed, every native and inked frame at its depth", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        await dragTwice(fx);
        const before = state(E());
        expect(before).toContain(String(D));
        act(() => view.unmount());
        view = await mount("c1");
        expect(state(E())).toBe(before);
        act(() => view.unmount());
    });

    test("downloaded (foldStore): the same document", async () => {
        const view = await mount("c1");
        const fx = build(E());
        await save();
        await dragTwice(fx);
        const before = state(E());
        act(() => view.unmount());
        const doc = await loadCanvasDoc("c1");
        expect(doc.version).toBe(FILE_VERSION);
        const F = new KobinEngine(document.createElement("div"), { width: 800, height: 600 });
        F.loadDrawing(JSON.parse(JSON.stringify(doc)), { render: false });
        expect(state(F)).toBe(before);
        F.destroy();
    });

    test("pushed to the cloud and pulled whole into another canvas: the same document", async () => {
        let view = await mount("c1");
        const fx = build(E());
        await save();
        await dragTwice(fx);
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
});
