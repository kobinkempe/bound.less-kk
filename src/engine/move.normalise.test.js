/**
 * SUBTREE-O1-PLAN §2.2: a frame's shift stays within ±W/2 — the whole cells of a subtree drag's
 * rest (and of a shift the frame already carried) go into its address, as `addOffset` carries a
 * native's table. Unbounded, a drag of 0.9 of a cell left a shift of 0.9 W, and a kid whose own
 * digit carried was torn off under a container while its parent stayed behind. The shift stays on
 * the frame, composed on read (A1 C1): no read writes a native.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { encodeBelow, addOffset } from "./geometry/offsets";
import { W } from "./frameLattice";

const rects = (E, frame, n, seed, tiny = false) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000;
        const w = tiny ? 1 : 50 + (i % 900), h = tiny ? 1 : 40;
        const o = { type: "shape", origin: "native", id: E.doc.allocId(),
            loops: rectLoop({ left: x, top: y, right: x + w, bottom: y + h }), color: "#123", opacity: 1, w: 8 };
        E.doc.add(o, frame); ids.push(o.id);
    }
    return ids;
};
// move.subtree.test.js's fixture: the camera at depth 1; R one level below it, K two, L three.
const fixture = (n = 300, tiny = false) => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = E.lm.cellChild("1", 5, 5), K = E.lm.cellChild(R.id, 7, -7), L = E.lm.cellChild(K.id, 1, 1);
    const ids = { R: rects(E, R.id, n, 1, tiny), K: rects(E, K.id, n, 2, tiny), L: rects(E, L.id, n, 3, tiny) };
    E._render();
    return { E, R, K, L, ids, all: [...ids.R, ...ids.K, ...ids.L] };
};
const addrOf = (E, id) => { const f = E.lm.frame(id); return f ? { parent: f.parent, i: f.cell.i, j: f.cell.j } : null; };
const chainOf = (E, id, depth) => {
    const out = [];
    let f = E.lm.frame(id);
    while (f && f.depth > depth) { out.unshift([f.cell.i, f.cell.j]); f = E.lm.frame(f.parent); }
    return out;
};
const bytes = (E) => {
    const n = E.doc.serializeNatives();
    return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].slice().sort((a, b) => a.id - b.id)]));
};
const press = (E, frameId) => E._levelPointToScreen(frameId, 0, 0);
const dragDirect = (E, p, dx, dy) => {
    E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
    E.store.setBatch(true);
    E._dragSelection(p[0] + dx, p[1] + dy);
};
const state = (E) => bytes(E) + JSON.stringify(E.lm.serialize());
// A native's picture carried to a canonical home, as the old settle would have left it: the chain and the table.
const canon = (E, id) => {
    const rec = E.doc.getById(id), r = addOffset(E.doc.tableOf(rec.obj, rec.level), 0, 0, 0);
    const home = r.cellX || r.cellY ? E.lm.neighbour(rec.level, r.cellX, r.cellY).id : rec.level;
    return [chainOf(E, home, 1), encodeBelow(r.below) || null];
};
const inHalf = (s) => !s || (Math.abs(s[0]) <= W / 2 && Math.abs(s[1]) <= W / 2);

describe("a frame's shift stays within half a frame (SUBTREE-O1-PLAN §2.2)", () => {
    useEngines();

    test("N1 0.9 of a cell: the frame moves a cell and keeps -0.1 W; a read writes nothing", () => {
        const { E, R, K } = fixture();
        E._setSelection([], [R.id]);
        dragDirect(E, press(E, R.id), 29, 0);                  // 29 units = 0.906 of R's cell (32)
        const st = E._dragSel.frames.get(R.id);
        E.pointerUp();
        expect(inHalf(st.shiftAfter)).toBe(true);               // red: 29 · 4096 = 118,784 > 65,536
        expect(st.shiftAfter).toEqual([(29 - 32) * 4096, 0]);
        expect(addrOf(E, R.id)).toEqual({ parent: "1", i: 6, j: 5 });
        const rev = E.doc.rev;
        E.doc.at(R.id); E._render();                            // reads: nothing settles or carries (A1 C1)
        expect(E.doc.rev).toBe(rev);
        expect(E.doc.count(R.id)).toBe(300);
        expect(E.lm.frame(K.id).parent).toBe(R.id);             // red: K torn off under the container at (6, 5)
    });

    test("N2 the per-object path gives the same picture, native for native, past half a cell", () => {
        for (const dx of [29, 17, -29, 45]) {
            const A = fixture(40), B = fixture(40);
            const p = press(A.E, A.R.id);
            A.E._setSelection([], [A.R.id]);
            dragDirect(A.E, p, dx, dx / 2); A.E.pointerUp();
            B.E._setSelection(B.all);
            dragDirect(B.E, p, dx, dx / 2); B.E.pointerUp();
            for (const id of A.all) expect(canon(A.E, id)).toEqual(canon(B.E, id));
            for (const f of A.E.lm.frames.values()) expect(inHalf(f.shift)).toBe(true);
        }
    });

    test("N4 a drag under half a cell moves the frame's picture, at the drop and at a cancel", () => {
        const E = mkEngine(800, 600);
        E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 400, inPanY: 300 });
        const kid = E.lm.cellChild("0", 3, 2);
        const o = { type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1, polys: [[[-4000, -4000], [4000, -4000], [4000, 4000], [-4000, 4000]]] };
        E.doc.add(o, kid.id);
        E._render();
        const x0 = () => { let x = Infinity; for (const p of E._lastList) if (p.id === o.id) for (const q of p.polys || []) for (const v of q) x = Math.min(x, v[0] + (p.res ? p.res[0] : 0)); return x; };
        const start = x0();
        E._setSelection([], [kid.id]);
        const p = press(E, kid.id);
        dragDirect(E, p, 12, 0);                                // 12 units at depth 0 = 0.375 of the kid's cell: a shift, no re-address
        expect(x0() - start).toBeCloseTo(12, 6);                // red: the cached tile, drawn where it was
        E.cancelSelectGesture(false); E._render();
        expect(x0() - start).toBeCloseTo(0, 6);
        dragDirect(E, p, 12, 0); E.pointerUp(); E._render();
        expect(x0() - start).toBeCloseTo(12, 6);                // red: the drop kept the old picture
    });

    test("N3 a second drag adds to a shift already carried and stays within half a frame; undo and redo are exact", () => {
        const { E, R, K, L } = fixture(300, true);                // natives under the cull: no render reads R
        const start = { bytes: bytes(E), R: addrOf(E, R.id), K: addrOf(E, K.id), L: addrOf(E, L.id) };
        E._setSelection([], [R.id]);
        dragDirect(E, press(E, R.id), 12, 0); E.pointerUp();   // 0.375 of a cell: no carry, a shift of 0.375 W
        expect(E.lm.frame(R.id).shift || [0, 0]).toEqual([12 * 4096, 0]);
        const mid = { R: addrOf(E, R.id) };
        dragDirect(E, press(E, R.id), 10, 0); E.pointerUp();   // 0.375 + 0.3125 = 0.6875: a carry
        const s = E.lm.frame(R.id).shift;
        expect(inHalf(s)).toBe(true);                           // red: 22 · 4096 = 90,112
        expect(addrOf(E, R.id).i).toBe(mid.R.i + 1);
        const after = { state: state(E), R: addrOf(E, R.id), K: addrOf(E, K.id) };
        E.undo(); E.undo();
        expect(bytes(E)).toBe(start.bytes);
        expect([addrOf(E, R.id), addrOf(E, K.id), addrOf(E, L.id)]).toEqual([start.R, start.K, start.L]);
        expect(E.lm.frame(R.id).shift).toBeNull();
        E.redo(); E.redo();
        expect(state(E)).toBe(after.state);
        expect([addrOf(E, R.id), addrOf(E, K.id)]).toEqual([after.R, after.K]);
    });
});
