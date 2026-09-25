/**
 * Undone ink stays undone after a reload (REVIEWER-2 U-1). The undo of an add named no frame — the
 * object was already gone when the op log asked where it lived — so it forced no snapshot; once the
 * add left history its entry was compacted and the frame's older snapshot brought the stroke back.
 * REAL engine and saver (the hook) over fake IndexedDB.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { _resetDbForTests } from "../storage/db";
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

const stroke = (e, y) => {
    act(() => {
        e.setTool("pen");
        e.pointerDown(200, y);
        for (let k = 1; k <= 8; k++) e.pointerMove(200 + k * 20, y + (k % 2) * 6);
        e.pointerUp();
        e.flushBakes();
    });
    const list = e.doc.list(e.cam.frame);
    return list[list.length - 1].id;
};
const ids = (e) => { const out = []; for (const k of e.doc.levels()) for (const o of e.doc.list(k)) out.push(o.id); return out.sort((a, b) => a - b); };

describe("SU — undone ink after a reload", () => {
    test("SU-1 strokes undone back to the start of history stay gone after a reload (U-1)", async () => {
        let view = await mount("c1");
        let e = E();
        const x = { type: "shape", origin: "native", id: e.doc.allocId(), loops: rectLoop({ left: -300, top: -200, right: -250, bottom: -150 }), color: "#111", opacity: 1, w: 4 };
        act(() => { e.doc.add(x, e.cam.frame); e._render(); });           // ink that is not in history (a loaded file)
        await save();
        const s1 = stroke(e, 250), s2 = stroke(e, 350);
        await save();
        act(() => {                                                       // move s2: forces its frame's snapshot
            e._setSelection([s2]);
            e._dragSel = { start: [300, 350], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            e.store.setBatch(true);
            e._dragSelection(330, 370);
            e.pointerUp();
            e.deselect();
        });
        await save();
        act(() => e.undo());                                             // undo the move: a snapshot again
        await save();
        act(() => { e.undo(); e.undo(); });                              // undo s2, undo s1: to the start of history
        await save();
        const t = stroke(e, 450);                                        // a new action: the redo branch dies
        await save();
        const live = ids(e);
        expect(live).toEqual(expect.not.arrayContaining([s1, s2]));
        act(() => view.unmount());
        view = await mount("c1");
        e = E();
        const back = ids(e);
        expect(back).toEqual(live);                                      // red: s1 and s2 came back
        expect(back).toEqual(expect.arrayContaining([x.id, t]));
        act(() => view.unmount());
    });
    test("SU-2 a stroke drawn and moved in one tick, both undone, reloaded and redone comes back unmoved (U-2)", async () => {
        let view = await mount("c2");
        let e = E();
        const s = stroke(e, 300);
        act(() => {                                                      // the same tick as the add: its entry encodes the moved object
            e._setSelection([s]);
            e._dragSel = { start: [300, 300], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            e.store.setBatch(true);
            e._dragSelection(400, 350);
            e.pointerUp();
            e.deselect();
        });
        await save();
        act(() => { e.undo(); e.undo(); });
        await save();
        act(() => view.unmount());
        view = await mount("c2");
        e = E();
        act(() => e.redo());                                             // the add
        const r = e.doc.getById(s);
        expect(r).toBeTruthy();
        expect(r.obj.below).toBeUndefined();                             // red: [[100, 50]], moved already
        act(() => e.redo());                                             // then the move
        expect(e.doc.getById(s).obj.below).toBeTruthy();
        act(() => view.unmount());
    });

    test("SU-4 a move redone over stale entries comes back moved after a reload (REVIEWER-3 SAVE-1)", async () => {
        let view = await mount("c4");
        let e = E();
        const s = stroke(e, 300);
        await save();
        act(() => {
            e._setSelection([s]);
            e._dragSel = { start: [300, 300], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            e.store.setBatch(true);
            e._dragSelection(400, 350);
            e.pointerUp();
        });
        const moved = JSON.parse(JSON.stringify(e.doc.getById(s).obj.below));
        expect(moved).toBeTruthy();
        act(() => e.deleteSelection());                                  // frame 0 empties: every entry before is stale
        act(() => { e.undo(); e.undo(); e.redo(); e.redo(); });
        await save();
        act(() => view.unmount());
        view = await mount("c4");
        e = E();
        act(() => e.undo());                                             // the delete
        expect(e.doc.getById(s).obj.below).toEqual(moved);               // red: undefined, back before the move
        act(() => view.unmount());
    });

    test("SU-3 after a reload, redoing an undone pending erase keeps the redo branch and one undo per gesture (U-4)", async () => {
        let view = await mount("c3");
        let e = E();
        stroke(e, 300);
        act(() => {                                                      // an erase over it, left pending
            e.setEraserSize(20); e.setTool("erasePartial");
            e.pointerDown(260, 280); for (let k = 1; k <= 6; k++) e.pointerMove(260 + k * 10, 280 + k * 5); e.pointerUp();
            e.flushBakes();
        });
        stroke(e, 450);
        act(() => { e.undo(); e.undo(); });                               // stroke 3, then the erase
        await save();
        act(() => view.unmount());
        view = await mount("c3");
        e = E();
        const redo0 = e.doc._redo.length;
        act(() => { e.redo(); e.flushErases(); });                       // the erase, then its bake
        expect(e.doc._redo.length).toBe(redo0 - 1);                     // red: the bake wiped stroke 3's redo
        expect(e.doc._undo.filter((op) => op.op === "eraseCommit").length).toBe(1);   // red: the gesture split in two
        act(() => view.unmount());
    });
});
