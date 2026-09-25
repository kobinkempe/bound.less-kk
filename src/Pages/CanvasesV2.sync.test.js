/**
 * The gallery's catch-up (SYNC-PLAN R7 and F64): a development build uploads nothing in bulk (its
 * collection starts empty and would receive every local canvas), and a production build sends a
 * kobin-2 store as its chunks, one canvas at a time, never as JSON.
 */
import React from "react";
import { render, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { fake } from "../engine/__testkit__/fakeFirestore";
import * as db from "../storage/db";
import { _resetDbForTests } from "../storage/db";
import { saveCanvasDoc, upsertIndexEntry, readTrash, readIndex, sweepStorage } from "../storage/localCanvases";
import CanvasesV2 from "./CanvasesV2";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db, getFirebaseAuth: () => null }));
// One user object, as the real hook keeps: a new one per render re-runs the gallery's refresh in a loop.
const mockUser = { user: { uid: "u1" }, ready: true };
jest.mock("../cloud/useUser", () => ({ __esModule: true, default: () => mockUser, signInWithGoogle: () => null, signOutUser: () => null }));
const mockBuild = { dev: true, lists: 0 };
jest.mock("../cloud/canvasSync", () => {
    const actual = jest.requireActual("../cloud/canvasSync");
    return { ...actual, isDevBuild: () => mockBuild.dev, cloudListCanvases: (...a) => { mockBuild.lists += 1; return actual.cloudListCanvases(...a); } };
});

const shape = (id) => ({ type: "shape", origin: "native", id, loops: [[0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 1, 0, 0]], color: "#123456", opacity: 1, w: 3 });
beforeEach(async () => {
    mockBuild.lists = 0;
    fake.reset();
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    await saveCanvasDoc("c1", { format: "boundless-drawing", version: 1, meta: { name: "Local" }, camera: null, crossings: {}, natives: { 0: [shape(1)] } });
    upsertIndexEntry({ id: "c1", name: "Local", strokes: 1, levels: 1 });
});

async function visit() {
    let view;
    act(() => { view = render(<MemoryRouter><CanvasesV2 /></MemoryRouter>); });
    await waitFor(() => expect(view.getAllByText("Local").length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    act(() => view.unmount());
}

test("a development build lists the cloud and uploads nothing", async () => {
    mockBuild.dev = true;
    await visit();
    expect(fake.writes).toEqual([]);
    expect(mockBuild.lists).toBe(1);                   // one refresh per visit, not one per render
});

test("a production build sends a local-only kobin-2 canvas as its chunks", async () => {
    mockBuild.dev = false;
    await visit();
    const m = fake.data("users/u1/dev-canvases/c1");
    expect(m.format).toBe("kobin-2");
    expect(m.head.seq).toBe(0);
    expect(fake.writes.some((w) => /\/parts\/f_0_0_/.test(w.path))).toBe(true);
    expect(fake.writes.some((w) => /\/parts\/\d+$/.test(w.path))).toBe(false);   // no lz1 part
});

test("a production build lists the canvases before its catch-up push lands (review minor 8)", async () => {
    mockBuild.dev = false;
    const release = fake.gate((kind, path) => kind === "commit" && path.includes("/parts/"));
    let view;
    act(() => { view = render(<MemoryRouter><CanvasesV2 /></MemoryRouter>); });
    await waitFor(() => expect(view.getAllByText("Local").length).toBeGreaterThan(0));
    expect(fake.data("users/u1/dev-canvases/c1")).toBeNull();          // the push is still on the wire
    release();
    await waitFor(() => expect(fake.data("users/u1/dev-canvases/c1")).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    act(() => view.unmount());
});

test("tombstones for several canvases move every local copy to the bin; none is lost to another's bin write", async () => {
    mockBuild.dev = true;
    for (const id of ["c2", "c3"]) {
        await saveCanvasDoc(id, { format: "boundless-drawing", version: 1, meta: { name: id }, camera: null, crossings: {}, natives: { 0: [shape(1)] } });
        upsertIndexEntry({ id, name: id, strokes: 1, levels: 1 });
    }
    // The three trash calls' header reads answer together (or after 200 ms): their bin writes then interleave.
    const real = db.getCanvasHeader;
    let waiting = 0, open;
    const together = new Promise((r) => { open = r; });
    setTimeout(() => open(), 200);
    const spy = jest.spyOn(db, "getCanvasHeader").mockImplementation(async (id) => { const h = await real(id); if (++waiting >= 3) open(); await together; return h; });
    fake.apply(["c1", "c2", "c3"].map((id) => ({ kind: "set", path: `users/u1/dev-canvases/${id}`, data: { name: id, savedAt: "2026-09-01T00:00:00Z", deletedAt: "2026-09-23T00:00:00Z" } })));
    let view;
    act(() => { view = render(<MemoryRouter><CanvasesV2 /></MemoryRouter>); });
    await waitFor(() => expect(readIndex()).toEqual([]));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    act(() => view.unmount());
    expect((await readTrash()).map((t) => t.id).sort()).toEqual(["c1", "c2", "c3"]);
    expect(readIndex()).toEqual([]);
    spy.mockRestore();
    await sweepStorage();
    expect(readIndex()).toEqual([]);                                   // no store without a bin row comes back
});
