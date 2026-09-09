/**
 * TileStore.framesLeft — the tiles of frames the camera has left are dropped on a
 * change of frame, ancestors' kept, and what a return rebuilds is bit for bit what
 * was dropped (WORKLIST memory step 3a, 2026-09-08).
 */
import { mkEngine, useEngines, drawStroke, descend, topView, camShot, camRestore } from "./__testkit__/harness";
import { encodeLoops } from "./geometry/arcShape";

useEngines();

const framesCached = (E) => [...new Set([...E.store.cache.values()].map((t) => String(t.level)))].sort();
const depthOf = (E, f) => E.lm.depthOf(f);
const tilesOf = (E, frame) => {
    const out = {};
    for (const [key, t] of E.store.cache) if (String(t.level) === String(frame)) out[key] = t.objs.map((o) => [o.id, o.loops ? encodeLoops(o.loops) : o.polys || o.pts]);
    return JSON.stringify(out, Object.keys(out).sort());
};

describe("tiles of frames the camera has left", () => {
    test("a return to the root drops the deeper frames' tiles; a descent rebuilds them bit for bit", () => {
        const E = mkEngine(800, 600);
        for (let i = 0; i < 4; i++) drawStroke(E, [[120 + i * 150, 120], [180 + i * 150, 330], [130 + i * 150, 500]], 9 + i);
        descend(E, 2);
        E._render();
        const deep = E.cam.frame;
        expect(depthOf(E, deep)).toBe(2);
        const before = framesCached(E);
        expect(before.some((f) => depthOf(E, f) === 2)).toBe(true);
        const deepTiles = tilesOf(E, deep);
        expect(deepTiles.length).toBeGreaterThan(2);
        // Up to the root: only the root's tiles may remain.
        const shot = camShot(E);
        topView(E);
        expect(depthOf(E, E.cam.frame)).toBe(0);
        const after = framesCached(E);
        expect(after.every((f) => depthOf(E, f) === 0)).toBe(true);
        // Back to the same view: the same frame, the same tiles, the same bits.
        camRestore(E, shot);
        expect(E.cam.frame).toBe(deep);
        expect(tilesOf(E, deep)).toBe(deepTiles);
    });

    test("the current frame's ancestors keep their tiles across the crossing", () => {
        const E = mkEngine(800, 600);
        for (let i = 0; i < 3; i++) drawStroke(E, [[150 + i * 180, 150], [220 + i * 180, 350], [160 + i * 180, 520]], 10);
        descend(E, 1);
        E._render();
        const mid = E.cam.frame;
        descend(E, 2);
        E._render();
        const cached = framesCached(E);
        expect(cached).toContain(String(mid));
        expect(cached).toContain(String(E.lm.parentOf(mid)));
        expect(E.store.framesLeft(E.cam.frame)).toBe(0);   // nothing off the path to drop
    });
});
