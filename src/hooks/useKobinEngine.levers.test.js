/**
 * The Dev panel's renderer levers (A3 §8; PLAN §5.1 Q8): stored per device in localStorage, a URL parameter
 * of the same name wins at load, and a lever change never touches the canvas record — not the document, not
 * its meta, not the saver's dirty state. Through the hook, as the panel calls them.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import { _resetDbForTests } from "../storage/db";
import { LEVERS, LEVERS_KEY, cleanLevers, leversFromUrl, readLevers, saveLevers, leverDefaults } from "../engine/devLevers";
import { isPhoneBudget } from "../engine/raster/PlateStore";

jest.setTimeout(30000);

let api = null;
function Harness() {
    api = useKobinEngine({ canvasId: "lv1" });
    return <div ref={api.hostRef} />;
}
async function mount() {
    let view;
    act(() => { view = render(<Harness />); });
    for (let i = 0; i < 100 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return view;
}
const hash = window.location.hash;
/** The saved form of the document, less the save's own clock. */
const record = (E) => { const d = E.serializeDrawing(); delete d.meta.modifiedAt; return JSON.stringify(d); };
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
});
afterEach(() => { window.location.hash = hash; api = null; });

describe("the levers' own rules", () => {
    test("each lever takes its values or its integer range; anything else is dropped", () => {
        expect(cleanLevers({ levelStep: 2, plateViews: "5", plateCeilingMiB: 128, restQuietMs: 0, restInline: "never", compose: "surface" }))
            .toEqual({ levelStep: 2, plateViews: 5, plateCeilingMiB: 128, restQuietMs: 0, restInline: "never", compose: "surface" });
        expect(cleanLevers({ levelStep: 4, plateViews: 9, plateCeilingMiB: 32, restQuietMs: 1.5, restInline: "always", compose: "gpu", other: 1 })).toEqual({});
        expect(cleanLevers(null)).toEqual({});
        expect(leverDefaults(false)).toEqual({ levelStep: 1, plateViews: 3, plateCeilingMiB: 256, restQuietMs: 100, restInline: "auto", compose: "auto" });
        expect(leverDefaults(true)).toMatchObject({ plateViews: 2, plateCeilingMiB: 96 });
        expect(Object.keys(LEVERS).sort()).toEqual(["compose", "levelStep", "plateCeilingMiB", "plateViews", "restInline", "restQuietMs"]);
    });

    test("a URL names them in the hash route's query or in the search; the URL wins over what is stored", () => {
        expect(leversFromUrl("http://x/#/canvas/a?dev&levelStep=3&plateViews=4")).toEqual({ levelStep: 3, plateViews: 4 });
        expect(leversFromUrl("http://x/?compose=direct&restInline=never#/canvas/a")).toEqual({ compose: "direct", restInline: "never" });
        expect(leversFromUrl("http://x/#/canvas/a?levelStep=5")).toEqual({});           // not a lever value
        const store = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
        expect(saveLevers({ levelStep: 3, plateViews: 7, compose: "nope" }, store)).toBe(true);
        expect(JSON.parse(store.data[LEVERS_KEY])).toEqual({ levelStep: 3, plateViews: 7 });
        expect(readLevers({ href: "http://x/#/c?levelStep=2", storage: store })).toEqual({ levelStep: 2, plateViews: 7 });
        const refusing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
        expect(readLevers({ href: "", storage: refusing })).toEqual({});
        expect(saveLevers({ levelStep: 2 }, refusing)).toBe(false);
    });
});

describe("through the hook, as the Dev panel calls them", () => {
    test("the URL override wins over localStorage at load; a change is stored and reaches the engine; the canvas record is untouched", async () => {
        localStorage.setItem(LEVERS_KEY, JSON.stringify({ levelStep: 3, plateViews: 4, plateCeilingMiB: 128 }));
        window.location.hash = "#/canvas/lv1?dev&levelStep=2&plateViews=5";
        const view = await mount();
        try {
            const E = api.engineRef.current;
            expect(E.cfg).toMatchObject({ levelStep: 2, plateViews: 5, plateCeilingMiB: 128 });   // URL, URL, stored
            expect(api.levers).toMatchObject({ levelStep: 2, plateViews: 5, plateCeilingMiB: 128, compose: "auto" });

            act(() => {
                E.pointerDown(100, 100); E.pointerMove(160, 130); E.pointerUp();                   // a document with ink
                E.flushBakes();
            });
            await act(async () => { await api.flushSave(); });
            const doc0 = record(E), meta0 = JSON.stringify(E.docMeta);
            expect(api.hasUnsaved()).toBe(false);

            act(() => {
                api.setLevelStep(3);
                api.setPlateBudget({ views: 6 });
                api.setPlateBudget({ ceilingMiB: 384 });
                api.setLevers({ restQuietMs: 250, restInline: "never", compose: "surface" });
            });
            expect(E.cfg).toMatchObject({ levelStep: 3, plateViews: 6, plateCeilingMiB: 384, restQuietMs: 250, restInline: "never", compose: "surface" });
            expect(api.levers).toMatchObject({ levelStep: 3, plateViews: 6, plateCeilingMiB: 384, restQuietMs: 250, restInline: "never", compose: "surface" });
            expect(JSON.parse(localStorage.getItem(LEVERS_KEY)))
                .toEqual({ levelStep: 3, plateViews: 6, plateCeilingMiB: 384, restQuietMs: 250, restInline: "never", compose: "surface" });

            // The canvas record: the document, its meta and the saver's state are as they were.
            expect(record(E)).toBe(doc0);
            expect(JSON.stringify(E.docMeta)).toBe(meta0);
            expect(api.hasUnsaved()).toBe(false);
            expect(doc0).not.toMatch(/levelStep|plateViews|plateCeiling|restQuiet|restInline/);

            act(() => { api.setLevelStep(7); });                                                     // not a step: nothing changes
            expect(E.cfg.levelStep).toBe(3);
        } finally { act(() => view.unmount()); }
    });

    test("with nothing stored and no URL the engine takes this device's defaults (jsdom's screen reads as a phone's)", async () => {
        window.location.hash = "#/canvas/lv1";
        const view = await mount();
        try {
            expect(isPhoneBudget()).toBe(true);
            expect(api.engineRef.current.cfg).toMatchObject(leverDefaults(true));
            expect(api.engineRef.current.cfg.frames).toBe("raf");
        } finally { act(() => view.unmount()); }
    });
});
