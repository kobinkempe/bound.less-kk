/**
 * OPEN-FLAGS F197: a `nearWalk` callback places its rect in the units of F's resident k levels up, for every k the
 * walk reaches, and each map built a path of its own: O(depth²) a walk. In Chrome at level 10,000 one down-tile bake
 * (`TileStore._downSources`) built 10,002 paths in about 50 s and left 2 GB of them cached. `LevelMap.rectsUp` maps
 * the chain once, with `mapRectF`'s numbers.
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";

useEngines();
jest.setTimeout(180000);

const D = 400;
const descend = (E, n, x, y) => { let g = 0; while (E.activeLevel < n && g++ < 4 * n) E.cam.zoomFactorAt(x, y, 16); };
/** Path builds while `fn` runs, every path built afresh (as after a mint). */
const builds = (E, fn) => {
    const b = E.lm._buildPath;
    let n = 0;
    E.lm._buildPath = function (a, c) { n++; return b.call(this, a, c); };
    E.lm._paths.clear();
    try { fn(); } finally { E.lm._buildPath = b; }
    return n;
};

test("F197 rectsUp gives mapRectF's numbers for every resident on the chain", () => {
    const E = mkEngine(800, 600);
    descend(E, 60, 437.3, 270);
    const F = E.cam.frame, rect = { left: -1234.5, top: 77.25, right: 4096.125, bottom: 9001.75 };
    const up = E.lm.rectsUp(rect, F);
    let n = 0;
    for (let f = E.lm.residentOf(F); f; f = f.parent != null ? E.lm.residentOf(f.parent) : null) {
        expect([f.id, up(f)]).toEqual([f.id, E.lm.mapRectF(rect, F, f.id)]);
        n++;
    }
    expect(n).toBe(61);
});

test("F197 the down sources, the lasso and an erase's frame pass build a few paths at 400 levels, not one a level", () => {
    const E = mkEngine(800, 600, { raster: true });
    descend(E, D, 400, 300);
    E._render();
    const id = (drawStroke(E, [[380, 300], [420, 300]], 6, "#000000") || {}).id;
    const F = E.cam.frame;
    expect(builds(E, () => E.store._downSources(F, E.lm.tileRect(F, 0, 0)))).toBeLessThan(20);   // before: 400
    let found = null;
    const c = E.cam, loop = [[300, 250], [500, 250], [500, 350], [300, 350], [300, 250]].map(([x, y]) => [(x - c.inPanX) / c.inScale, (y - c.inPanY) / c.inScale]);
    expect(builds(E, () => { found = E._lassoFind(loop); })).toBeLessThan(40);
    expect(found.ids.length + found.frames.length).toBeGreaterThan(0);                            // the stroke, or its frame
    if (id != null) expect(found.ids.includes(id) || found.frames.length > 0).toBe(true);
    const pass = E._eraseFramesPass;
    let inPass = 0, calls = 0;
    E._eraseFramesPass = function (Erec) { let r; calls++; inPass += builds(E, () => { r = pass.call(this, Erec); }); return r; };
    try { erase(E, [[600, 300], [640, 300]], 20); } finally { E._eraseFramesPass = pass; }
    expect(calls).toBeGreaterThan(0);
    expect(inPass / calls).toBeLessThan(40);                                                      // before: 400 a pass
});
