/**
 * `<ScaleHud>` rendered (A3 §5, R25 W1): the label without a definition follows `engine.onZoom`; with one, the
 * label opens the unit picker and a pick shows the picked unit and closes it; a new definition starts a fresh
 * session (L9); a zoom re-renders the HUD and not its parent; unmounting unsubscribes. The write-back rule
 * itself is `canvasEditorSticky.rtl.test.js`'s and `reactPath.test.js`'s.
 */
import React from "react";
import { render, act, fireEvent } from "@testing-library/react";
import ScaleHud from "../../Components/editor/ScaleHud";
import { zoomLabel } from "../../hooks/useKobinEngine";
import { validateScaleDef } from "./index";

/** The two things the HUD reads of the engine: the camera's zoom and the zoom subscription. */
function fakeEngine(zoom) {
    const subs = new Set();
    return {
        subs,
        cam: { effectiveZoom: () => zoom },
        onZoom(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
        zoomTo(z) { zoom = z; for (const cb of [...subs]) cb(z); },
    };
}

const DEF = { value: 1, unit: "m", barPx: 100, zoomAt: 1 };
const labelOf = (c) => c.querySelector(".bl-scale-label").textContent;
const chips = () => [...document.querySelectorAll(".bl-scale-unit-btn:not(.bl-scale-unit-btn--more)")];

function mount(E, scaleDef, extra = {}) {
    const ref = { current: E };
    let parentRenders = 0;
    const ladders = [];
    function Parent({ def }) {
        parentRenders++;
        return <ScaleHud engineRef={ref} engineReady scaleDef={def} readOnly={false}
            onClear={() => {}} onSetScale={() => {}} onLadderId={(id) => ladders.push(id)} {...extra} />;
    }
    const view = render(<Parent def={scaleDef} />);
    return { view, ladders, parentRenders: () => parentRenders, rerender: (def) => view.rerender(<Parent def={def} />) };
}

describe("<ScaleHud>", () => {
    test("without a definition the label is the zoom, and follows onZoom without re-rendering the parent", () => {
        const E = fakeEngine(2);
        const m = mount(E, null);
        const c = m.view.container;
        expect(labelOf(c)).toBe(zoomLabel(2));
        expect(c.querySelector("button.bl-scale-label")).toBeNull();          // no picker without a definition
        const p0 = m.parentRenders();
        act(() => E.zoomTo(1 / 3));
        expect(labelOf(c)).toBe(zoomLabel(1 / 3));
        expect(m.parentRenders()).toBe(p0);
        expect(E.subs.size).toBe(1);
        m.view.unmount();
        expect(E.subs.size).toBe(0);                                           // unsubscribed
    });

    test("the label opens the unit picker; a pick shows the picked unit and closes it", () => {
        const E = fakeEngine(1);
        const m = mount(E, validateScaleDef(DEF));
        const c = m.view.container;
        const before = labelOf(c);
        expect(chips().length).toBe(0);
        fireEvent.click(c.querySelector("button.bl-scale-label"));
        const options = chips();
        expect(options.length).toBeGreaterThan(0);
        const pick = options.find((b) => !before.includes(b.textContent));
        expect(pick).toBeTruthy();
        const sym = pick.textContent;
        fireEvent.click(pick);
        expect(chips().length).toBe(0);                                        // closed
        expect(labelOf(c)).toContain(sym);
        expect(labelOf(c)).not.toBe(before);
        expect(m.ladders.length).toBeGreaterThan(0);                           // the dialog's ladder is handed up
        // The pick survives a zoom that stays in its range: the session is kept, not rebuilt.
        act(() => E.zoomTo(1.1));
        expect(labelOf(c)).toContain(sym);
        m.view.unmount();
    });

    test("a new definition starts a fresh session (L9): the pick is gone, as on a HUD mounted with it", () => {
        const E = fakeEngine(1);
        const m = mount(E, validateScaleDef(DEF));
        const c = m.view.container;
        const fresh = labelOf(c);
        fireEvent.click(c.querySelector("button.bl-scale-label"));
        const pick = chips().find((b) => !fresh.includes(b.textContent));
        fireEvent.click(pick);
        expect(labelOf(c)).not.toBe(fresh);
        m.rerender(validateScaleDef(DEF));                                     // the same values, a new definition
        expect(labelOf(c)).toBe(fresh);
        m.rerender(null);                                                      // cleared: the zoom again
        expect(labelOf(c)).toBe(zoomLabel(1));
        m.view.unmount();
    });
});
