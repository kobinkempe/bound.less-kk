/**
 * The first-view pictures end to end (OPEN-FLAGS F166), signed in against the fake Firestore: a Save pushes the canvas
 * and then this device's set, stamped with the push's head; the canvas opened again seeds the set into the RAM tier
 * (its perf log says how many and why), and its first render restores the view's cells instead of packing them. A set
 * whose head is not the opened document's is never seeded.
 */
import React from "react";
import { render, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { _resetDbForTests } from "../storage/db";
import { upsertIndexEntry } from "../storage/localCanvases";
import { fake } from "../engine/__testkit__/fakeFirestore";
import { rasterStats } from "../engine/raster/RasterRenderer";
import { setBuildId } from "../engine/raster/firstView";
import CanvasEditor from "./CanvasEditor";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db, getFirebaseAuth: () => null }));
const mockSignedIn = { user: { uid: "u1" }, ready: true };   // one object: a new user each render restarts the session
jest.mock("../cloud/useUser", () => ({ __esModule: true, default: () => mockSignedIn, signInWithGoogle: () => null, signOutUser: () => null }));
jest.setTimeout(120000);

const VIEWS = "users/u1/dev-canvases/c1/views/";
beforeAll(() => setBuildId("test-build"));
afterAll(() => setBuildId(null));
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    fake.reset();
    upsertIndexEntry({ id: "c1", name: "T", savedAt: new Date().toISOString(), strokes: 0, levels: 0 });
});
function editor() {
    let view;
    act(() => {
        view = render(
            <MemoryRouter initialEntries={["/canvas/c1?dev"]}>
                <Route path="/canvas/:canvasId"><CanvasEditor /></Route>
                <Route path="/canvases"><div>gallery</div></Route>
            </MemoryRouter>,
        );
    });
    return view;
}
const sleep = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const firstViewNotes = (E) => (E.perfLog || []).filter((e) => e.op === "firstView");

async function drawAndSave() {
    const view = editor();
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 10000 });
    const E = window.__kobinEngine;
    act(() => {
        E.pointerDown(300, 300);
        for (let i = 1; i <= 8; i++) E.pointerMove(300 + i * 20, 300 + i * 9);
        E.pointerUp();
    });
    await sleep(600);                                       // the plates land
    await act(async () => { await window.__kobinSaver.flush(); });
    let r;
    await act(async () => { r = await window.__kobinSync.pushNow(); });
    expect(r.ok).toBe(true);
    await waitFor(() => expect(fake.paths(VIEWS).length).toBeGreaterThan(1), { timeout: 10000 });
    act(() => view.unmount());
    return r.r.head;
}

test("FE-1 a Save uploads this device's set stamped with its head; the canvas opened again seeds it and restores the view", async () => {
    const head = await drawAndSave();
    const heads = fake.paths(VIEWS).filter((p) => !p.includes("~"));
    expect(heads.length).toBe(1);
    expect(fake.data(heads[0]).stamp.head).toEqual({ epoch: head.epoch, seq: head.seq });
    const restores = rasterStats.ramRestores;
    const view = editor();
    await waitFor(() => expect(window.__kobinEngine && firstViewNotes(window.__kobinEngine).length).toBeGreaterThan(0), { timeout: 10000 });
    const note = firstViewNotes(window.__kobinEngine).pop();
    expect(note.why).toBe("ok");
    expect(note.seeded).toBeGreaterThan(0);
    await sleep(400);
    expect(rasterStats.ramRestores).toBeGreaterThan(restores);
    act(() => view.unmount());
});

test("FE-2 a set made at another head is never seeded", async () => {
    await drawAndSave();
    const headPath = fake.paths(VIEWS).find((p) => !p.includes("~"));
    fake.docs.get(headPath).data.stamp.head.seq += 1;      // a set from a later document than this one
    const view = editor();
    await waitFor(() => expect(window.__kobinEngine && firstViewNotes(window.__kobinEngine).length).toBeGreaterThan(0), { timeout: 10000 });
    const note = firstViewNotes(window.__kobinEngine).pop();
    expect(note.why).toBe("head");
    expect(note.seeded).toBe(0);
    act(() => view.unmount());
});
