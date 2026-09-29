/**
 * TileStore.framesLeft — the tiles of frames the camera has left are dropped on a
 * change of frame, ancestors' kept, and what a return rebuilds is bit for bit what
 * was dropped (WORKLIST memory step 3a, 2026-09-08).
 */
import { mkEngine, useEngines, drawStroke, descend, topView, camShot, camRestore, drag } from "./__testkit__/harness";
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

    test("a moved object's tiles read from another frame survive the change of frame (F83)", () => {
        const E = mkEngine(800, 600);
        for (let i = 0; i < 3; i++) drawStroke(E, [[150 + i * 180, 150], [220 + i * 180, 350], [160 + i * 180, 520]], 10);
        drag(E, [220, 350], [470, 330]);           // a table: its pieces are read from a sibling frame below
        E.setTool("pen");
        descend(E, 2, 470, 330);
        E._render();
        const anc = new Set();
        for (let id = E.cam.frame; id != null; id = E.lm.parentOf(id)) anc.add(String(id));
        const off = [...E.store._pins].filter((k) => !anc.has(k.split("|")[0]));
        expect(off.length).toBeGreaterThan(0);     // the precondition: the table read off the path
        const tiles = off.map((k) => E.store.cache.get(k));
        E._tileFrame = null;                       // the next render is a change of frame
        E._render();
        // Kept, not re-baked: deleting before the read cost 106 cold tiles a crossing on the Magnum Opus.
        expect(off.map((k) => E.store.cache.get(k))).toEqual(tiles);
        for (let k = 0; k < off.length; k++) expect(E.store.cache.get(off[k])).toBe(tiles[k]);
    });
});
