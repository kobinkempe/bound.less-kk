/**
 * An erase at depth removes no more ink than the eraser swept (REVIEWER-3 ERASE-1: the cede's
 * parent cut dropped a remnant thinner than 1 % of the PEN as dust — a round cap 0.3 units past
 * the ceded cell, 1,229 px tall at the erase's zoom, 62,000 times the eraser's own area).
 * Dust is judged at the mark's zoom (DESIGN.md §7, F66).
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import { loopsArea } from "./geometry/arcShape";

useEngines();

/** The family's ink area in level-0 units². */
const inkArea = (E) => {
    let a = 0;
    for (const k of E.doc.levels()) {
        const f = E.lm.frameFactor(k, "0");
        for (const o of E.doc.list(k)) if (!o.erase && o.loops) a += Math.abs(loopsArea(o.loops)) * f * f;
    }
    return a;
};

describe("ED — a cede's dust at the mark's zoom", () => {
    for (const [off, name] of [[0.3, "a cap 0.3 units past the cell (under 1 % of the pen)"], [2, "a cap 2 units past it (control)"]]) {
        test(`ED-1 ${name}: the family loses no more than the eraser's area`, () => {
            const E = mkEngine();
            drawStroke(E, [[384, 200], [384, 338 + off]], 60);
            const before = inkArea(E);
            for (let i = 0; i < 3; i++) E.zoomFactorAt(384, 352, 16);
            expect(E.cam.activeLevel).toBe(1);
            const f = E.lm.frameFactor(E.cam.frame, "0");
            erase(E, [[395, 295], [405, 305]], 8);
            const eraserArea = ((10 + 2 * 8) / E.cam.inScale) ** 2 * f * f;   // the gesture's box grown by the radius (size 8)
            const lost = before - inkArea(E);
            expect(lost).toBeGreaterThanOrEqual(-1e-9);
            expect(lost).toBeLessThan(eraserArea);                    // red at 0.3: 1.596 lost
        });
    }
});
