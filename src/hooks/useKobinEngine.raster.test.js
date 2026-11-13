/**
 * The page's engine is always the raster one (the `?svg` mode was removed 2026-11-11), and the
 * .svg export from it renders once through a one-off SVG engine and serialises THAT, never the
 * raster host's own `<svg>`, which holds no ink (RASTERISER-PLAN §5.7). The suite lives here
 * rather than beside the raster tree because `src/engine` may not import `src/hooks` (§2.6's zones).
 *
 * The engine built here is a REAL one, in jsdom, exactly as `raster.engine.test.js` builds
 * them: `getContext` is null in this tree, so nothing below reads a pixel.
 */

import React from "react";
import { render, act } from "@testing-library/react";
import useKobinEngine from "./useKobinEngine";

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

test("the page's engine is the raster one, whatever the URL says", () => {
    for (const h of ["#/canvas/t", "#/canvas/t?svg", "#/canvas/t?raster=0"]) {
        window.location.hash = h;
        const view = mount();
        try {
            expect([h, api.engineRef.current.raster]).toEqual([h, true]);
            expect(api.raster).toBe(undefined);                   // no renderer switch on the hook
            expect(api.setRaster).toBe(undefined);
        } finally { act(() => view.unmount()); }
    }
});

test("exportSvg renders once through an SVG engine and serialises THAT", async () => {
    const view = mount();
    try {
        expect(api.engineRef.current.raster).toBe(true);
        // The one-off engine's host is appended to the body and removed after; the export gets
        // as far as `URL.createObjectURL`, which jsdom does not implement. That it threw THERE,
        // after the one-off host came and went, is what says it serialised the one-off `<svg>`
        // and not this host's (which holds no ink).
        let threw = null;
        let hostsSeen = 0;
        const obs = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.style && String(n.style.cssText).includes("-10000px")) hostsSeen++; });
        obs.observe(document.body, { childList: true });
        const hostsBefore = document.querySelectorAll("div[style*='-10000px']").length;
        await act(async () => { try { await api.exportSvg(); } catch (err) { threw = err; } });
        obs.disconnect();
        expect(String(threw)).toMatch(/createObjectURL/);
        expect(hostsSeen).toBe(1);
        expect(document.querySelectorAll("div[style*='-10000px']").length).toBe(hostsBefore);   // destroyed after
        expect(api.saveError).toBe(null);
    } finally { act(() => view.unmount()); }
});
