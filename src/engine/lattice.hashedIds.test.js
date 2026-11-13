/**
 * OPEN-FLAGS F192: a frame off the spine is named `h<parent's code>:<i>,<j>`, the same length at every depth (a birth
 * path grew a segment a level: 4–10 MB of names in a 1,000-level lattice). Two lattice copies name a cell alike, so a
 * worker's minted frames still merge by id (F67), and a missing frame is re-minted under the frame its code names (F99).
 * A frame in its parent's own cell continues a stretch, `s<code>:i,j*k` (compact-lattice design, "Ids").
 */
import LevelMap, { childName, frameCode } from "./LevelMap";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";

useEngines();

const CFG = { base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 };
const mkMap = () => new LevelMap(CFG, 800, 600);
const NAME = /^h[0-9a-z]{14}:-?\d+,-?\d+$/;
/** A chain `n` frames down from "0", off the spine at every level. */
const chain = (M, n, i = 7, j = -3) => { const out = []; let p = "0"; for (let d = 0; d < n; d++) { p = M.cellChild(p, i, j).id; out.push(p); } return out; };

describe("F192 — hashed frame ids", () => {
    test("HI-1 a name is the same length 1 and 1,000 levels down, and the lattice's save grows by a frame's record a level", () => {
        const M = mkMap();
        const ids = chain(M, 1000, -2048, 2047);
        for (const id of ids) expect(id).toMatch(NAME);
        expect(ids[999].length).toBe(ids[0].length);
        expect(ids[0].length).toBe(1 + 14 + 1 + "-2048,2047".length);
        expect(M.depthOf(ids[999])).toBe(1000);
        const bytes = JSON.stringify(M.serialize()).length;
        expect(bytes).toBeLessThan(1001 * 120);                       // a path-id lattice this deep: ~4 MB of names
        expect(frameCode("0")).toMatch(/^[0-9a-z]{14}$/);
        expect(new Set(ids).size).toBe(1000);
    });

    test("HI-2 a copy names a cell as the lattice it was copied from does; a merge of its frames adds what is new", () => {
        const M = mkMap();
        const ids = chain(M, 5);
        const C = mkMap();
        C.load(M.serialize());
        const a = C.cellChild(ids[4], 100, -100), b = C.cellChild(a.id, -5, 6);
        const a2 = M.cellChild(ids[4], 100, -100);
        expect(a.id).toBe(a2.id);                                     // both lattices minted it: one name
        expect(M.merge({ frames: [a, b].map((f) => ({ id: f.id, parent: f.parent, depth: f.depth, i: f.cell.i, j: f.cell.j })) })).toBe(1);
        expect(M.frame(b.id).parent).toBe(a2.id);
        expect(M.frame(b.id).cell).toEqual({ i: -5, j: 6 });
    });

    test("HI-3 ensureId re-mints a missing frame in its birth cell under the frame its code names; a lost parent is null, minting nothing", () => {
        const M = mkMap();
        const p = M.cellChild("0", 4, 5).id, x = M.cellChild(p, 5, 4).id, y = M.cellChild(x, 4, 5).id;   // a cell change a level: h names
        const saved = M.serialize();
        const L = mkMap();
        L.load({ ...saved, frames: saved.frames.filter((f) => f.id !== x && f.id !== y) });
        const n0 = L.frames.size;
        expect(L.ensureId(y)).toBeNull();                              // its parent x is gone too
        expect(L.frames.size).toBe(n0);
        const fx = L.ensureId(x);
        expect(fx && [fx.id, fx.parent, fx.depth, fx.cell.i, fx.cell.j]).toEqual([x, p, 2, 5, 4]);
        const fy = L.ensureId(y);                                     // x back: y's parent is found by its code
        expect(fy && [fy.parent, fy.depth]).toEqual([x, 3]);
        expect(L.ensureId(childName(p, 9999, 0))).toBeNull();          // no cell has that digit
        expect(L.ensureId("h" + "z".repeat(14) + ":1,1")).toBeNull();  // no frame has that code
        // A stretch (a frame in its parent's own cell) is named down it from its start, so its lost levels come back.
        const s = chain(M, 4, 7, 7);
        expect(s[3]).toMatch(/^s[0-9a-z]{14}:7,7\*4$/);
        const S = M.serialize(), L2 = mkMap();
        L2.load({ ...S, frames: S.frames.filter((f) => f.id !== s[2] && f.id !== s[3]) });
        const f3 = L2.ensureId(s[3]);
        expect(f3 && [f3.id, f3.parent, f3.depth]).toEqual([s[3], s[2], 4]);
        expect(L2.frame(s[2]).parent).toBe(s[1]);
    });

    test("HI-4 a twin's name is its cell's name with #n, and re-mints as itself", () => {
        const M = mkMap();
        const p = M.cellChild("0", 3, 3).id, x = M.cellChild(p, 1, 1).id;
        expect(M.readdress(x, p, 2, 2)).toBeTruthy();
        const twin = M.cellChild(p, 1, 1).id;
        expect(twin).toBe(childName(p, 1, 1) + "#2");
        const L = mkMap();
        const saved = M.serialize();
        L.load({ ...saved, frames: saved.frames.filter((f) => f.id !== twin) });
        const t = L.ensureId(twin);
        expect(t && [t.id, t.parent, t.cell.i, t.cell.j]).toEqual([twin, p, 1, 1]);
    });

    test("HI-5 a load whose lattice lacks a chain the natives name re-mints it parents first; the gallery counts its levels", () => {
        const E = mkEngine();
        const ids = chain(E.lm, 4, 3, -3);
        const saved = E.lm.serialize();
        const natives = Object.fromEntries(ids.map((id) => [id, []]));
        E.lm.load({ ...saved, frames: saved.frames.filter((f) => f.id === "0" || f.id === ids[0]) });
        E._mintNamedFrames(Object.fromEntries([...ids].reverse().map((id) => [id, natives[id]])));   // deepest first
        for (let d = 1; d < 4; d++) expect([d, E.lm.parentOf(ids[d])]).toEqual([d, ids[d - 1]]);
        expect(E.lm.depthOf(ids[3])).toBe(4);
    });

    test("HI-6 ink drawn in a hashed frame saves, and the file opens with it there", () => {
        const E = mkEngine();
        let guard = 0;
        while (E.activeLevel < 3 && guard++ < 200) E.zoomFactorAt(437.3, 270, 16);
        const F = E.cam.frame;
        expect(F).toMatch(NAME);
        const s = drawStroke(E, [[300, 300], [500, 320]], 8);
        const file = JSON.parse(JSON.stringify(E.serializeDrawing()));
        const E2 = mkEngine();
        E2.loadDrawing(file);
        expect(E2.doc.getById(s.id).level).toBe(E.doc.getById(s.id).level);
        expect(E2.cam.frame).toBe(F);
        expect(E2.lm.depthOf(F)).toBe(3);
    });
});
