/**
 * OPEN-FLAGS F195: an erase d levels below its object cedes a piece a level, a family of d members, and the family
 * check mapped each piece's window to every coarser member through a path of its own and read each member's box a
 * pair: O(d) a pair (152 s at 1,150 members in Chrome). Each window is now mapped up its chain once
 * (`LevelMap.rectUpChain`, the same numbers as `mapRectF`); the harness still checks every answer against the
 * whole-outline rule (`__oracles__/familyComponents.js`).
 */
import { useEngines, mkEngine, drawStroke, erase, familyCheck } from "./__testkit__/harness";

useEngines();
jest.setTimeout(180000);

const D = 120;

test("F195 a 120-level cede is one family, its check builds a path per member, not a pair, and agrees with the rule", () => {
    const E = mkEngine(800, 600);
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");   // its top edge is y = 270
    let guard = 0;
    while (E.activeLevel < D && guard++ < 4 * D) E.cam.zoomFactorAt(437.3, 270, 16);
    E._render();
    const calls0 = familyCheck.calls;
    erase(E, [[600, 270], [700, 270]], 30);                    // a notch in the bar's edge, D levels below it
    expect(familyCheck.calls).toBeGreaterThan(calls0);         // the rule was asked, and agreed (the harness fails a miss)
    const sizes = new Map();
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) { const key = E.doc.editKey(o); sizes.set(key, (sizes.get(key) || 0) + 1); }
    const [key, n] = [...sizes].sort((a, b) => b[1] - a[1])[0];
    expect(n).toBeGreaterThan(D * 0.9);
    // Counted on the engine alone (the harness's rule maps a path a pair), every pair evaluated afresh.
    let paths = 0;
    const framePath = E.lm.framePath.bind(E.lm);
    E.lm.framePath = (a, b) => { paths++; return framePath(a, b); };
    E.lm._paths.clear();                                       // as after a mint: every path built afresh
    E._doors = null;                                           // no pair's answer kept
    const on = familyCheck.on;
    familyCheck.on = false;
    let comp;
    try { comp = E._familyComponents(key); } finally { familyCheck.on = on; }
    expect(comp.classes.length).toBe(1);
    expect(paths).toBeLessThan(4 * n);                         // before: about n²
});

test("F195 rectUpChain gives mapRectF's numbers for every ancestor", () => {
    const E = mkEngine(800, 600);
    let guard = 0;
    while (E.activeLevel < 40 && guard++ < 200) E.cam.zoomFactorAt(437.3, 270, 16);
    const F = E.cam.frame, rect = { left: -1234.5, top: 77.25, right: 4096.125, bottom: 9001.75 };
    const chain = E.lm.rectUpChain(rect, F);
    expect(chain.size).toBe(41);
    for (const [id, r] of chain) expect([id, r]).toEqual([id, E.lm.mapRectF(rect, F, id)]);
    const pts = [[3.5, -7.25], [65535.9, 0.001]];
    for (const [id, q] of E.lm.pointsUpChain(pts, F)) expect([id, q]).toEqual([id, pts.map((p) => E.lm.mapPointF(p, F, id))]);
});
