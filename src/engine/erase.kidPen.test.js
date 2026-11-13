/**
 * OPEN-FLAGS F84: a ceded kid's pen `w` is in its own units. A kid homed k levels below the piece it was ceded from
 * carries that piece's pen times 4096^k, so every piece of a family, measured at the root, has the one pen that drew it.
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import { R } from "./frameLattice";

useEngines();

test.each([2, 4])("a notch cut %d levels below a bar: every piece's pen, at the root, is the bar's", (depth) => {
    const E = mkEngine(800, 600, { raster: true });
    const bar = drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");
    const key = E.doc.editKey(E.doc.getById(bar.id).obj);
    const pen0 = E.doc.getById(bar.id).obj.w;
    expect(pen0).toBeGreaterThan(0);
    let guard = 0;
    while (E.activeLevel < depth && guard++ < 200) E.zoomFactorAt(437.3, 270, 16);
    erase(E, [[380, 300], [420, 300]], 60);
    const pieces = [];
    for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase && E.doc.editKey(o) === key) pieces.push({ o, d: E.lm.depthOf(L) });
    expect(pieces.some((p) => p.d > 0)).toBe(true);           // the erase ceded below the bar's home
    for (const { o, d } of pieces) expect(o.w / Math.pow(R, d)).toBeCloseTo(pen0, 9);
});
