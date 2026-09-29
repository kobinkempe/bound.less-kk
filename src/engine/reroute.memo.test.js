/**
 * TileStore._rerouteGroups — the moved-object grouping `_reroute` reads is memoised per frame and
 * document revision (PAPER-PLAN §10, S2). What the memo must never do: serve a grouping after a
 * table, a home or the lattice moved. Each case compares the camera's list with a fresh bake.
 */
import { mkEngine, useEngines, drawStroke, descend, drag } from "./__testkit__/harness";

useEngines();

const sig = (E) => E._lastList.map((o) => o.id + ":" + (o.res ? o.res.join(",") : "-") + ":" + o.type).join(" ");
function fresh(E) {
    const a = sig(E);
    E.store.bumpEpoch();
    E.store._rrMemo = null;
    E._render();
    return [a, sig(E)];
}

function scene() {
    const E = mkEngine(800, 600);
    for (let i = 0; i < 3; i++) drawStroke(E, [[150 + i * 180, 150], [220 + i * 180, 350], [160 + i * 180, 520]], 10);
    drag(E, [220, 350], [470, 330]);
    E.setTool("pen");
    descend(E, 2, 470, 330);
    E._render();
    return E;
}

describe("the reroute grouping memo", () => {
    test("a second render at the same revision reuses the grouping and draws the same list", () => {
        const E = scene();
        expect(E.doc.offsetIds().size).toBeGreaterThan(0);
        const a = sig(E), hits = E.store._rrHits || 0, m = E.store._rrMemo.get(E.cam.frame), patches = E.store._rrPatches || 0;
        E._render();
        expect(E.store._rrHits).toBeGreaterThan(hits);                   // read from the memo (the model asks it per native)
        expect(E.store._rrMemo.get(E.cam.frame)).toBe(m);                 // the same grouping, not walked again
        expect(E.store._rrPatches || 0).toBe(patches);
        expect(sig(E)).toBe(a);
    });

    test("an off-camera read of another frame keeps the camera's grouping (one entry a frame, review minor 7)", () => {
        const E = scene();
        const F = E.cam.frame, P = E.lm.parentOf(F);
        const m1 = E.store._rerouteGroups(F);
        E.store._rerouteGroups(P);                        // a ladder rung or the crossing prebake, between two renders
        expect(E.store._rerouteGroups(F)).toBe(m1);       // red with one entry: the camera pays the whole scan again
    });

    test("a table change with no frame minted recomputes the grouping", () => {
        const E = scene();
        const F = E.cam.frame;
        const m1 = E.store._rerouteGroups(F);
        expect(E.store._rerouteGroups(F)).toBe(m1);
        const id = [...E.doc.offsetIds()][0];
        const frames = E.lm.frames.size, addr = E.lm.addrEpoch;
        E.doc.setOffsetsById(id, null);                 // the table goes: the object is drawn from home
        expect(E.lm.frames.size).toBe(frames);
        expect(E.lm.addrEpoch).toBe(addr);
        const m2 = E.store._rerouteGroups(F);
        expect(m2).not.toBe(m1);
        expect(m2.moved.has(id)).toBe(false);
    });

    test("an undo of the move, then a redo: each list equals a fresh bake", () => {
        const E = scene();
        const moved = sig(E);
        E.undo(); E._render();
        const [u, uFresh] = fresh(E);
        expect(u).toBe(uFresh);
        expect(u).not.toBe(moved);
        E.redo(); E._render();
        const [r, rFresh] = fresh(E);
        expect(r).toBe(rFresh);
    });

    test("a move made at the deep camera itself: the next list equals a fresh bake", () => {
        const E = scene();
        const before = sig(E);
        let at = null;                                   // a screen point on the moved object
        for (let y = 20; y < 600 && !at; y += 20) {
            for (let x = 20; x < 800 && !at; x += 20) if (E.doc.offsetIds().has(E._hitTest(x, y))) at = [x, y];
        }
        expect(at).toBeTruthy();
        drag(E, at, [at[0] - 260, at[1] + 120]);
        E.setTool("pen");
        E._render();
        const [a, f] = fresh(E);
        expect(a).toBe(f);
        expect(a).not.toBe(before);
    });

    test("a second move of the same object refreshes the grouping", () => {
        const E = mkEngine(800, 600);
        for (let i = 0; i < 3; i++) drawStroke(E, [[150 + i * 180, 150], [220 + i * 180, 350], [160 + i * 180, 520]], 10);
        drag(E, [220, 350], [470, 330]);
        drag(E, [470, 330], [300, 420]);
        E.setTool("pen");
        descend(E, 2, 300, 420);
        E._render();
        const [a, b] = fresh(E);
        expect(a).toBe(b);
    });
});

describe("the grouping patched for the objects a change touched (TESTER-3: a drop re-walked 19.7k tables, 166 ms)", () => {
    const groupsOf = (m) => [...m.groups.values()].map((g) => g.F0 + "|" + g.rem.join(",") + ":" + [...g.ids].sort((a, b) => a - b).join(",")).sort();
    test("RI-1 one object's table changed among many: patched, and equal to a full walk and to a fresh bake", () => {
        const E = mkEngine(800, 600);
        for (let i = 0; i < 12; i++) drawStroke(E, [[120 + i * 50, 150], [140 + i * 50, 300], [125 + i * 50, 450]], 8);
        E.setTool("select");
        E.pointerDown(30, 60); for (const [x, y] of [[760, 60], [760, 560], [30, 560], [30, 60]]) E.pointerMove(x, y); E.pointerUp();
        E.pointerDown(140, 300); for (let k = 1; k <= 6; k++) E.pointerMove(140 + k * 5, 300 + k * 3); E.pointerUp();
        E.setTool("pen");
        descend(E, 2, 400, 330);
        E._render();
        const F = E.cam.frame, n = E.doc.offsetIds().size;
        expect(n).toBeGreaterThan(6);
        E.store._rerouteGroups(F);
        const patches = E.store._rrPatches || 0;
        const id = [...E.doc.offsetIds()][3];
        const rec = E.doc.getById(id);
        E.doc.setOffsetsById(id, rec.obj.below.map((e) => (e ? [e[0] + 7, e[1] - 5] : e)));
        const m = E.store._rerouteGroups(F);
        expect(E.store._rrPatches).toBe(patches + 1);          // red before: a full walk
        const patched = groupsOf(m), moved = [...m.moved].sort((a, b) => a - b);
        E.store._rrMemo = null;
        const full = E.store._rerouteGroups(F);
        expect(patched).toEqual(groupsOf(full));
        expect(moved).toEqual([...full.moved].sort((a, b) => a - b));
        E._render();
        const [a, b] = fresh(E);
        expect(a).toBe(b);
    });
});
