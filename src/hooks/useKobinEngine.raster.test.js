/**
 * The three product-visible halves of the raster flag that live OUTSIDE `src/engine`
 * (RASTERISER-PLAN §5.7, §10 stage 5b items 25–27; asked for by the stage's review):
 *
 *   - `rasterFromUrl` / `hrefWithRaster`, which decide which renderer a session gets;
 *   - `exportSvg`, which must refuse in raster mode rather than download a blank picture;
 *   - `thumbnails.js`, which must build its engine with `raster: false` whatever the tab is,
 *     because a thumbnail is made by SERIALISING that engine's `<svg>`.
 *
 * The suite lives here rather than beside the raster tree because `src/engine` may not import
 * `src/hooks` or `src/storage` (§2.6's zones); a test in either of those directories may import
 * the engine, and no zone forbids it.
 *
 * The engine built here is a REAL one, in jsdom, exactly as `raster.engine.test.js` builds
 * them: `getContext` is null in this tree, so nothing below reads a pixel.
 */

import React from "react";
import { render, act } from "@testing-library/react";
import useKobinEngine, { rasterFromUrl, hrefWithRaster } from "./useKobinEngine";

// ---------------------------------------------------------------------------
// The URL, which is the whole of the flag's interface (§5.1: construction-time; raster is the
// DEFAULT and `?svg` the gate to the SVG renderer — Kobin, 2026-09-22)
// ---------------------------------------------------------------------------

test("rasterFromUrl: raster by default; `?svg` (and an explicit `?raster=0`) is the SVG renderer", () => {
    const cases = [
        ["http://localhost/", true],
        ["http://localhost/#/canvas/abc", true],
        ["http://localhost/?raster", true],
        ["http://localhost/#/canvas/abc?raster", true],           // a bare `?raster` is a no-op
        ["http://localhost/#/canvas/abc?dev&raster", true],
        ["http://localhost/#/canvas/abc?raster=1", true],
        ["http://localhost/#/canvas/abc?raster=0", false],        // the old dev URLs still read
        ["http://localhost/#/canvas/abc?raster=false", false],
        ["http://localhost/#/canvas/abc?raster=off", false],
        ["http://localhost/?svg", false],
        ["http://localhost/#/canvas/abc?svg", false],             // the hash route owns the query
        ["http://localhost/#/canvas/abc?dev&svg", false],
        ["http://localhost/#/canvas/abc?svg=1", false],
        ["http://localhost/#/canvas/abc?svg=0", true],
        ["http://localhost/#/canvas/svg", true],                  // not a parameter at all
        // A LONGER parameter name is not this one: `?rasterWorkers=N` is a shipped parameter
        // (§6.6) and `?svgExport=1` is not the gate.
        ["http://localhost/?rasterize=0", true],
        ["http://localhost/#/canvas/abc?rasterWorkers=4", true],
        ["http://localhost/#/canvas/abc?svgExport=1", true],
        ["http://localhost/#/canvas/abc?svg&rasterWorkers=4", false],
        ["", true],
    ];
    for (const [href, want] of cases) expect([href, rasterFromUrl(href)]).toEqual([href, want]);
});

test("hrefWithRaster sets and clears the `?svg` gate where the query already lives, and round-trips", () => {
    const cases = [
        ["http://localhost/", false, "http://localhost/?svg"],
        ["http://localhost/#/canvas/abc", false, "http://localhost/#/canvas/abc?svg"],
        ["http://localhost/#/canvas/abc?dev", false, "http://localhost/#/canvas/abc?dev&svg"],
        ["http://localhost/#/canvas/abc?svg", true, "http://localhost/#/canvas/abc"],
        ["http://localhost/#/canvas/abc?dev&svg", true, "http://localhost/#/canvas/abc?dev"],
        ["http://localhost/?svg", true, "http://localhost/"],
        ["http://localhost/#/canvas/abc?dev&raster", true, "http://localhost/#/canvas/abc?dev"],   // the old flag is cleaned away
        ["http://localhost/#/canvas/abc?raster=0", true, "http://localhost/#/canvas/abc"],
    ];
    for (const [href, on, want] of cases) expect([href, hrefWithRaster(href, on)]).toEqual([href, want]);
    // ...and what it writes is what the reader reads back, which is the only property the dev
    // control needs (it rewrites the URL and reloads).
    for (const [href] of cases) {
        expect(rasterFromUrl(hrefWithRaster(href, true))).toBe(true);
        expect(rasterFromUrl(hrefWithRaster(href, false))).toBe(false);
    }
});

// ---------------------------------------------------------------------------
// §5.7's first guard: `exportSvg` never serialises the raster host's own `<svg>`
// ---------------------------------------------------------------------------

let api = null;
function Harness() {
    api = useKobinEngine({});
    return <div ref={api.hostRef} />;
}

function mount() {
    let view = null;
    act(() => { view = render(<Harness />); });
    return view;
}

const hash = window.location.hash;
afterEach(() => { window.location.hash = hash; api = null; });

test("exportSvg in raster mode (the default) renders once through an SVG engine and serialises THAT", async () => {
    const view = mount();
    try {
        expect(api.raster).toBe(true);
        expect(api.engineRef.current.raster).toBe(true);
        // The one-off engine's host is appended to the body and removed after; the export gets
        // as far as `URL.createObjectURL`, which jsdom does not implement. That it threw THERE,
        // after the one-off host came and went, is what says it serialised the one-off `<svg>`
        // and not this host's (which holds no ink in raster mode).
        const hostsBefore = document.querySelectorAll("div[style*='-10000px']").length;
        let threw = null;
        await act(async () => { try { await api.exportSvg(); } catch (err) { threw = err; } });
        expect(String(threw)).toMatch(/createObjectURL/);
        expect(document.querySelectorAll("div[style*='-10000px']").length).toBe(hostsBefore);   // destroyed after
        expect(api.saveError).toBe(null);
    } finally { act(() => view.unmount()); }
});

// PLAN §5.8 item 2: the export bakes every pending mark first, in its copy — so the SVG tab's export goes through
// the one-off engine too, and never serialises its own `<svg>` (whose masks and marks are the pending state).
test("with `?svg` the same call goes through the one-off SVG engine too, never this host's own `<svg>`", async () => {
    window.location.hash = "#/canvas/t?svg";
    const view = mount();
    try {
        expect(api.raster).toBe(false);
        expect(api.engineRef.current.raster).toBe(false);
        let threw = null;
        let hostsSeen = 0;
        const obs = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.style && String(n.style.cssText).includes("-10000px")) hostsSeen++; });
        obs.observe(document.body, { childList: true });
        await act(async () => { try { await api.exportSvg(); } catch (err) { threw = err; } });
        obs.disconnect();
        expect(api.saveError).toBe(null);
        expect(String(threw)).toMatch(/createObjectURL/);        // it reached the download, so it read the `<svg>`
        expect(hostsSeen).toBe(1);                                // red before: 0, the tab's own `<svg>` serialised
    } finally { act(() => view.unmount()); }
});

// ---------------------------------------------------------------------------
// §5.7's second guard: the thumbnail engine is the SVG one, whatever the tab is
// ---------------------------------------------------------------------------

test("thumbnails builds its engine with `raster: false`", async () => {
    window.location.hash = "#/canvas/t";                         // the tab IS in raster mode (the default)
    jest.resetModules();
    const built = [];
    // `doMock` rather than `jest.mock`, so the real engine above is untouched: this file also
    // mounts one, and a hoisted module mock would replace it for the whole suite.
    jest.doMock("../engine/KobinEngine", () => ({
        __esModule: true,
        default: class FakeEngine {
            constructor(host, opts) { built.push(opts); }
            setLazyOutlines() { }
            loadDrawing() { }
            flushErases() { }                                    // the barrier `withSvgEngine` runs after the load
            jumpTo() { return false; }                           // no scene is rendered: nothing to rasterise
            destroy() { }
        },
    }));
    try {
        // eslint-disable-next-line global-require
        const { renderThumbs } = require("../storage/thumbnails");
        const out = await renderThumbs({}, [{ id: "s1", hash: "h1", level: "0", rect: { x: 0, y: 0, w: 10, h: 10 } }], {});
        expect(out).toEqual({});
        expect(built.length).toBe(1);
        expect(built[0].raster).toBe(false);
    } finally {
        jest.dontMock("../engine/KobinEngine");
        jest.resetModules();
    }
});
