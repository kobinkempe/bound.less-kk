/**
 * The sync status button, its details card and the banner (SYNC-PLAN R9, the 2026-09-23 design).
 */
import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { SyncStatus, SyncBanner, syncLabel, syncStatus, showsNotice, bannerClearance } from "./SyncChip";

const editing = (cloud, extra = {}) => ({ mode: "editing", why: null, holder: null, cloud, error: null, ...extra });
const STATES = [
    [editing("saved"), "Saved", "saved"],
    [editing("saving"), "Saving…", "saving"],
    [editing("offline"), "Offline — saved here", "offline"],
    [editing("error"), "Not synced — saved here", "error"],
    [{ mode: "readonly", why: "device", holder: { device: "d2", name: "Galaxy phone" }, cloud: "follow" }, "Viewing", "viewing"],
];

test.each(STATES)("a desktop shows the icon and a short label; its name holds that label and the full sentence (%#)", (sync, short, key) => {
    render(<SyncStatus sync={sync} signedIn deviceName="Laptop" onRenameDevice={() => {}} />);
    const b = screen.getByRole("button", { name: (n) => n.includes(short) });
    expect(b.getAttribute("aria-label")).toContain(syncLabel(sync, true));
    expect(b.getAttribute("data-sync")).toBe(key);
    expect(b.textContent).toBe(short);
    expect(b.querySelector("svg")).not.toBeNull();
    expect(syncStatus(sync, true).short).toBe(short);
});

test("a phone shows the icon alone in a 44 px target, named by the full sentence", () => {
    render(<SyncStatus sync={editing("offline")} signedIn deviceName="Laptop" onRenameDevice={() => {}} compact />);
    const b = screen.getByRole("button", { name: "Offline, saved on this device" });
    expect(b.className).toContain("bl-sync-status--icon");
    expect(b.textContent).toBe("");
});

test("the button opens the details card: the state, the one-device rule and this device's name, with no rename (Kobin 2026-09-23)", () => {
    render(<SyncStatus sync={editing("saved")} signedIn deviceName="Chrome on Android" compact />);
    const b = screen.getByRole("button", { name: "Saved" });
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const card = screen.getByRole("dialog", { name: "Sync details" });
    expect(within(card).getByText("Saved to your account")).toBeTruthy();
    expect(within(card).getByText("Only one device draws at a time. Others can watch and take over.")).toBeTruthy();
    expect(within(card).getByText("This device")).toBeTruthy();
    expect(within(card).getByText("Chrome on Android")).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
    expect(within(card).queryByText(/Rename/)).toBeNull();
});

test("the details card leads with the error when there is one", () => {
    render(<SyncStatus sync={editing("error", { error: "Cloud sync failed: quota. Saved in this browser only; next try in 1 min." })} signedIn deviceName="Laptop" onRenameDevice={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: (n) => n.startsWith("Not synced — saved here") && n.includes("quota") }));
    expect(screen.getByText("Cloud sync failed: quota. Saved in this browser only; next try in 1 min.")).toBeTruthy();
});

test("read-only: the banner says who has the pen and offers Edit here; another tab reads the same", () => {
    const take = jest.fn();
    const { rerender, container } = render(<SyncBanner sync={{ mode: "readonly", why: "device", holder: { device: "d1", name: "Chrome on Windows" } }} onTakeOver={take} compact />);
    expect(screen.getByText("Viewing only")).toBeTruthy();
    expect(screen.getByText("Chrome on Windows has the pen")).toBeTruthy();
    expect(container.querySelector(".bl-sync-banner--compact")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit here" }));
    expect(take).toHaveBeenCalledTimes(1);
    rerender(<SyncBanner sync={{ mode: "readonly", why: "tab", holder: null }} onTakeOver={take} />);
    expect(screen.getByText("This canvas is open in another tab")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit here" })).toBeTruthy();
});

test("while the pen moves the banner says so, with no button", () => {
    const { rerender } = render(<SyncBanner sync={{ mode: "taking", why: "device", holder: { name: "Chrome on Windows" } }} onTakeOver={() => {}} />);
    expect(screen.getByText("Taking over…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SyncBanner sync={{ mode: "handing" }} onTakeOver={() => {}} />);
    expect(screen.getByText("Handing over…")).toBeTruthy();
});

test("after Edit here the banner says you have the pen and who is watching, then hides; editing alone shows nothing", () => {
    jest.useFakeTimers();
    try {
        const { rerender, container } = render(<SyncBanner sync={editing("saved")} onTakeOver={() => {}} />);
        expect(container.firstChild).toBeNull();
        rerender(<SyncBanner sync={{ mode: "readonly", why: "device", holder: { name: "Chrome on Windows" } }} onTakeOver={() => {}} />);
        rerender(<SyncBanner sync={{ mode: "taking", why: "device", holder: { name: "Chrome on Windows" } }} onTakeOver={() => {}} />);
        rerender(<SyncBanner sync={{ mode: "starting", why: null, holder: null }} onTakeOver={() => {}} />);
        rerender(<SyncBanner sync={editing("saved")} onTakeOver={() => {}} />);
        expect(screen.getByText("You have the pen")).toBeTruthy();
        expect(screen.getByText("Chrome on Windows is watching")).toBeTruthy();
        act(() => { jest.advanceTimersByTime(4100); });
        expect(screen.queryByText("You have the pen")).toBeNull();
        rerender(<SyncBanner sync={{ mode: "readonly", why: "tab" }} onTakeOver={() => {}} />);
        rerender(<SyncBanner sync={{ mode: "taking", why: "tab" }} onTakeOver={() => {}} />);
        rerender(<SyncBanner sync={editing("off")} onTakeOver={() => {}} />);
        expect(screen.getByText("Your other tab is watching")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByText("You have the pen")).toBeNull();
    } finally { jest.useRealTimers(); }
});

test("the pen moving is the banner's: its notices do not get the notice banner", () => {
    expect(showsNotice({ kind: "handed", message: "Handed over to Chrome on Windows" })).toBe(false);
    expect(showsNotice({ kind: "lost", message: "Editing moved to Galaxy phone" })).toBe(false);
    expect(showsNotice({ kind: "stolen", message: "Editing moved to another tab" })).toBe(false);
    expect(showsNotice({ kind: "conflict", message: "This device's changes were kept as a new canvas", id: "x" })).toBe(true);
});

test("an error outside offline editing gets the error face, with the error in its name (review minor 3)", () => {
    const blocked = { mode: "starting", why: null, holder: null, cloud: "error", error: "Couldn't write the cloud copy into this browser. Retrying." };
    const { rerender } = render(<SyncStatus sync={blocked} signedIn deviceName="Laptop" onRenameDevice={() => {}} compact />);
    const b = screen.getByRole("button", { name: /Couldn't write the cloud copy into this browser/ });
    expect(b.getAttribute("data-sync")).toBe("error");
    rerender(<SyncStatus sync={editing("offline", { error: "fake firestore: this client is offline" })} signedIn deviceName="Laptop" onRenameDevice={() => {}} compact />);
    expect(screen.getByRole("button").getAttribute("data-sync")).toBe("offline");   // offline editing keeps its own face
});

test("a failed Edit here says so in the banner (review minor 3)", () => {
    render(<SyncBanner sync={{ mode: "readonly", why: "device", holder: { name: "Galaxy phone" }, error: "Couldn't reach the cloud to take over" }} onTakeOver={() => {}} />);
    expect(screen.getByText("Viewing only")).toBeTruthy();
    expect(screen.getByText("Couldn't reach the cloud to take over")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit here" })).toBeTruthy();
});

test("nit: the details card takes the focus, and Escape gives it back to the button", () => {
    render(<SyncStatus sync={editing("saved")} signedIn deviceName="Laptop" onRenameDevice={() => {}} />);
    const b = screen.getByRole("button", { name: /Saved/ });
    fireEvent.click(b);
    const card = screen.getByRole("dialog", { name: "Sync details" });
    expect(card.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(b);
});

// Rects as getBoundingClientRect gives them: left, top, right, bottom.
const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
test("the banner stack sits under the top bar, and the rail under the banner when they share columns (Kobin 2026-09-23)", () => {
    const bar = [box(16, 16, 227, 60), box(239, 16, 395, 60)];
    const rail = box(16, 87, 112, 662);
    // a phone: the banner spans the width, so the rail starts under it
    expect(bannerClearance({ bar, notices: { height: 58, spans: [box(16, 72, 395, 130)] }, rail })).toEqual({ noticesTop: 72, railTop: 142 });
    // an error line makes the banner taller: the rail moves with it
    expect(bannerClearance({ bar, notices: { height: 72, spans: [box(16, 72, 395, 144)] }, rail }).railTop).toBe(156);
    // a 44 px top bar (a coarse pointer): the stack moves down with it
    expect(bannerClearance({ bar: [box(16, 16, 227, 60), box(239, 16, 395, 64)], notices: { height: 58, spans: [box(16, 76, 395, 134)] }, rail }).noticesTop).toBe(76);
    // a desktop: the 500 px pill is clear of the rail's columns, which stays centred
    expect(bannerClearance({ bar: [box(16, 16, 330, 56), box(1100, 16, 1264, 56)], notices: { height: 50, spans: [box(390, 68, 890, 118)] }, rail: box(16, 166, 112, 619) }).railTop).toBe(null);
    // no banner: nothing moves
    expect(bannerClearance({ bar, notices: { height: 0, spans: [] }, rail }).railTop).toBe(null);
});
