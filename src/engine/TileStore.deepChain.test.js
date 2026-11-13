/**
 * OPEN-FLAGS F194: the first read of a view far below the nearest current up tile — a canvas opened at depth, a
 * scene jumped to, a fast zoom whose frames step hundreds of levels at once — bakes the whole chain of up tiles
 * above it. That was a recursion a level deep each (`_ensureUp` → `_bakeUp` → `_upPiecesOver`), and 900 levels
 * overflowed Chrome's stack; `_warmUp` bakes the chain parents first from an explicit stack.
 */
import { useEngines, mkEngine, drawStroke, topAt } from "./__testkit__/harness";

useEngines();
jest.setTimeout(120000);

const N = 2500;

test("F194 a cold read 2,500 levels below a level-0 bar bakes its chain without overflowing, and shows the bar's edge", () => {
    const E = mkEngine(800, 600, { raster: true });
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");   // its top edge is y = 270
    // The camera alone: frames are minted on the way down, and nothing reads a tile until the render below.
    let guard = 0;
    while (E.activeLevel < N && guard++ < 4 * N) E.cam.zoomFactorAt(437.3, 270, 16);
    expect(E.activeLevel).toBe(N);
    expect(() => E._render()).not.toThrow();
    const below = topAt(E, 437.3, 300), above = topAt(E, 437.3, 240);
    expect(below && below.color).toBe("#000000");
    expect(above).toBe(null);
});

test("F194 the chain's sums of address sequences are the walk's, cached down a cold chain", () => {
    const E = mkEngine(800, 600, { raster: true });
    drawStroke(E, [[300, 300], [500, 300]], 60, "#000000");
    let guard = 0;
    while (E.activeLevel < 300 && guard++ < 1200) E.cam.zoomFactorAt(437.3, 270, 16);
    const st = E.store, F = E.cam.frame;
    const walk = (id) => { let n = 0; for (let k = id; k != null; k = st._parentOf(k)) { const f = E.lm.frame(k); if (f && f.addrSeq) n += f.addrSeq; } return n; };
    // Give a few frames on the chain an address sequence, as a subtree move does, then read cold.
    const chain = [];
    for (let k = F; k != null; k = st._parentOf(k)) chain.push(k);
    for (const k of [chain[5], chain[100], chain[250]]) E.lm.frame(k).addrSeq = 3;
    E.lm.addrEpoch++;
    expect(st.chainSeq(F)).toBe(walk(F));
    for (const k of chain) expect([k, st.chainSeq(k)]).toEqual([k, walk(k)]);
});
