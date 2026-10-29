/**
 * The editor's side of the review (SYNC-PLAN): the tab starts read-only and not saving until its
 * session holds the pen (even while sign-in has not resolved), and a read-only tab of an unsaved
 * draft neither offers to keep nor discards the draft another tab is drawing.
 * jsdom has no Web Locks: the session falls back to the localStorage lock.
 */
import React from "react";
import { render, act, waitFor, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { _resetDbForTests } from "../storage/db";
import { loadCanvasStore } from "../storage/localCanvases";
import CanvasEditor from "./CanvasEditor";

jest.mock("firebase/firestore", () => require("../engine/__testkit__/fakeFirestore").sdk);
jest.mock("../cloud/firebaseApp", () => ({ getDb: () => require("../engine/__testkit__/fakeFirestore").fake.db, getFirebaseAuth: () => null }));
jest.mock("../cloud/useUser", () => ({ __esModule: true, default: () => ({ user: null, ready: false }), signInWithGoogle: () => null, signOutUser: () => null }));
jest.setTimeout(60000);

beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
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
function draw(e, x = 100) {
    act(() => {
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        e.pointerUp();
    });
}

test("a closed canvas leaves no dev handle on its engine (the heap snapshots of 2026-10-13)", async () => {
    window.__kobinSaver = null;
    const view = editor();
    await waitFor(() => expect(window.__kobinSaver).toBeTruthy());
    expect(window.__kobinEngine).toBeTruthy();
    act(() => view.unmount());
    expect(window.__kobinEngine).toBeNull();
    expect(window.__kobinSaver).toBeNull();      // red before: the saver's closures kept the closed canvas's engine, its drawing and caches
});

test("the tab is read-only until its session holds the pen, sign-in pending or not (review minor 6)", async () => {
    const view = editor();
    await waitFor(() => expect(window.__kobinEngine).toBeTruthy());
    const E = window.__kobinEngine;
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(E.readOnly).toBe(true);                          // sign-in has not resolved: no session yet
    draw(E);
    expect(Object.values(E.nativesByLevel).reduce((n, a) => n + a.length, 0)).toBe(0);
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 8000 });
    expect(E.readOnly).toBe(false);
    act(() => view.unmount());
});

test("a read-only tab of another tab's unsaved draft neither prompts nor discards it (review nit)", async () => {
    const one = editor();
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 8000 });
    const E1 = window.__kobinEngine, saver1 = window.__kobinSaver;
    draw(E1);
    await act(async () => { await saver1.flush(); });
    const two = editor();
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("readonly"), { timeout: 8000 });
    const homes = screen.getAllByTitle("Back to canvases");
    act(() => { fireEvent.click(homes[homes.length - 1]); });
    expect(screen.queryByText("Keep this drawing?")).toBe(null);
    expect((await loadCanvasStore("c1")).header.strokes).toBe(1);
    act(() => { two.unmount(); one.unmount(); });
});

test("the editor tells its session whether a write moved data, so a follower skips the reload (STALL)", async () => {
    const view = editor();
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 8000 });
    const E = window.__kobinEngine, ss = window.__kobinSync, said = [];
    const on = ss.onLocalSaved.bind(ss);
    ss.onLocalSaved = (seq, o) => { said.push(o && o.data); on(seq, o); };
    draw(E);
    await act(async () => { await window.__kobinSaver.flush(); });
    act(() => { E.panBy(60, 20); });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); await window.__kobinSaver.flush(); });
    await waitFor(() => expect(said).toContain(false));
    expect(said[0]).toBe(true);                             // the stroke (its bake may write again)
    expect(said[said.length - 1]).toBe(false);              // the camera alone
    act(() => view.unmount());
});

test("viewing only selects the pan tool and collapses the rail; taking the pen back restores both (Kobin 2026-09-23)", async () => {
    const one = editor();
    await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 8000 });
    expect(within(one.container).getByTitle("Minimize tools")).toBeTruthy();
    const two = editor();
    const E2 = window.__kobinEngine;
    await waitFor(() => expect(within(two.container).getByText("Viewing only")).toBeTruthy(), { timeout: 8000 });
    expect(E2.tool).toBe("pan");
    expect(within(two.container).getByTitle("Show tools")).toBeTruthy();
    expect(within(two.container).queryByTitle("Minimize tools")).toBeNull();
    act(() => { fireEvent.click(within(two.container).getByRole("button", { name: "Edit here" })); });
    await waitFor(() => expect(within(two.container).getByTitle("Minimize tools")).toBeTruthy(), { timeout: 8000 });
    expect(E2.tool).toBe("pen");
    expect(within(two.container).getByTitle("Pen").className).toContain("active");
    await waitFor(() => expect(within(one.container).getByTitle("Show tools")).toBeTruthy(), { timeout: 8000 });
    act(() => { two.unmount(); one.unmount(); });
});

// Two tabs of one canvas at a phone's width (jsdom has no matchMedia: the width decides).
test("sync redesign: the status sits in a bounded title chip; the read-only tab has the banner; Edit here replaces the old notices", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 411, configurable: true, writable: true });
    try {
        const one = editor();
        await waitFor(() => expect(window.__kobinSync && window.__kobinSync.state.mode).toBe("editing"), { timeout: 8000 });
        const chip1 = one.container.querySelector(".bl-editor-title-chip");
        expect(chip1.className).toContain("bl-editor-title-chip--compact");
        const status1 = within(chip1).getByRole("button", { name: "Saved on this device" });
        expect(status1.className).toContain("bl-sync-status--icon");
        expect(within(one.container).queryByText("Viewing only")).toBeNull();
        const two = editor();
        await waitFor(() => expect(within(two.container).getByText("Viewing only")).toBeTruthy(), { timeout: 8000 });
        expect(within(two.container).getByText("This canvas is open in another tab")).toBeTruthy();
        expect(within(two.container).getAllByRole("button", { name: "Edit here" }).length).toBe(1);
        expect(within(two.container.querySelector(".bl-editor-title-chip")).getByRole("button", { name: "Read-only — open in another tab" })).toBeTruthy();
        act(() => { fireEvent.click(within(two.container).getByRole("button", { name: "Edit here" })); });
        await waitFor(() => expect(within(two.container).getByText("You have the pen")).toBeTruthy(), { timeout: 8000 });
        expect(within(two.container).getByText("Your other tab is watching")).toBeTruthy();
        await waitFor(() => expect(within(one.container).getByText("Viewing only")).toBeTruthy(), { timeout: 8000 });
        expect(screen.queryByText(/Editing moved to|Handed over to/)).toBeNull();
        act(() => { two.unmount(); one.unmount(); });
    } finally {
        Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    }
});
