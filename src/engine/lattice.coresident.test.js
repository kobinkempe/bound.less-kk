/**
 * A frame keeps its identity (A1 C3, A1 §8): a frame landing on an occupied cell stays there as a co-resident, never
 * merged; its kids join the groups of the cells the resident's frames hold too, all the way down; lookups return
 * residents and look through the group; geometry reads the group as one cell; each co-resident is its own subtree;
 * the camera is handed to the resident at the re-address (F126's scenario); frame GC promotes a co-resident.
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT, G } from "./frameLattice";
import { mkEngine, useEngines } from "./__testkit__/harness";
import { collectFrames } from "./frameGc";
import { rectLoop } from "./geometry/arcShape";

useEngines();
const CFG = { base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 };
const lattice = (M) => JSON.stringify(M.serialize());

/** E holds (1,1) → (0,0); A, two cells over, holds (1,1) → (5,5) and (2,2). */
function build() {
    const M = new LevelMap(CFG, 800, 600);
    M.ensureSpine(3);
    const E = M.cellChild("1", 4, 4), Ex = M.cellChild(E.id, 1, 1), Exy = M.cellChild(Ex.id, 0, 0);
    const A = M.cellChild("1", 6, 4), Ax = M.cellChild(A.id, 1, 1), Ay = M.cellChild(A.id, 2, 2), Axz = M.cellChild(Ax.id, 5, 5);
    return { M, E, Ex, Exy, A, Ax, Ay, Axz };
}
const moveA = (M, A, dx, empty = () => false) => M.readdressMany(M.moveSubtreeTargets(A.id, 1, dx, 0, M.subtreeStart(A.id, 1)), { empty });

describe("co-residents in the lattice", () => {
    test("a frame on a taken cell is its co-resident, its kids join the cells' groups, and it leaves them as they were", () => {
        const { M, E, Ex, Exy, A, Ax, Ay, Axz } = build();
        const before = lattice(M), n = M.frames.size;
        expect(moveA(M, A, -2 * G).shadowed).toEqual([{ id: A.id, of: E.id }, { id: Ax.id, of: Ex.id }]);   // Ax moves as a frame too
        expect(M.frames.size).toBe(n);                                        // nothing merged, nothing minted
        expect([M.frame(A.id).shadowOf, M.frame(Ax.id).shadowOf, M.frame(Ay.id).shadowOf]).toEqual([E.id, Ex.id, null]);
        expect([M.frame(Ax.id).parent, M.frame(Ay.id).parent, M.frame(Axz.id).parent]).toEqual([A.id, A.id, Ax.id]);   // A keeps its kids
        expect(M.findCellChild(E.id, 1, 1)).toBe(Ex);                        // the resident
        expect(M.findCellChild(E.id, 2, 2)).toBe(Ay);                        // through the co-resident's kids
        expect(M.findCellChild(A.id, 1, 1)).toBe(Ex);
        expect(M.findCellChild(A.id, 1, 1, true)).toBe(Ax);                  // a container's own kid
        expect(M.cellChild(E.id, 2, 2)).toBe(Ay);
        expect(M.frames.size).toBe(n);
        expect(M.peekNeighbour(Ex.id, 1, 1)).toBe(Ay);                          // a neighbour under the co-resident
        expect([M.isUnder(E.id, Ax.id), M.isUnder(A.id, Axz.id), M.isUnder(E.id, A.id)]).toEqual([false, true, false]);
        expect(M.childrenOf(E.id).map((f) => f.id)).toEqual([Ex.id]);
        expect(M.childrenOf(A.id).map((f) => f.id).sort()).toEqual([Ax.id, Ay.id].sort());
        const walked = (id) => { const out = []; M.walk(id, (f) => out.push(f.id)); return out.sort(); };
        expect(walked(E.id)).toEqual([E.id, Ex.id, Exy.id].sort());
        expect(walked(A.id)).toEqual([A.id, Ax.id, Ay.id, Axz.id].sort());
        expect([...M.subtreeStart(E.id, 1).keys()].sort()).toEqual([E.id, Ex.id, Exy.id].sort());
        // One cell to the bit: no path between co-residents, one chain above them.
        expect(M.framePath(Ax.id, Ex.id)).toEqual({ up: [], down: [] });
        expect(M.mapPointF([123.456, -7.25], Axz.id, Ex.id)).toEqual(M.mapPointF([123.456, -7.25], Axz.id, Ax.id));
        expect(M.chainFrom("1", Axz.id)).toEqual([{ i: 4, j: 4 }, { i: 1, j: 1 }, { i: 5, j: 5 }]);
        // Moved back, every group it shared splits: the lattice as it was.
        moveA(M, A, 2 * G);
        expect(lattice(M)).toBe(before);
        expect(M.findCellChild(E.id, 2, 2)).toBeNull();
    });

    test("serialize/load keeps co-residents under different containers, the saved resident keeping the cell", () => {
        const { M, E, Ex, A, Ax, Ay } = build();
        moveA(M, A, -2 * G);
        const data = M.serialize();
        expect(data.frames.find((f) => f.id === Ax.id).shadowOf).toBe(Ex.id);
        const M2 = new LevelMap(CFG, 800, 600);
        M2.load(data);
        expect([M2.frame(A.id).shadowOf, M2.frame(Ax.id).shadowOf, M2.frame(Ax.id).parent]).toEqual([E.id, Ex.id, A.id]);
        expect(M2.findCellChild(E.id, 2, 2).id).toBe(Ay.id);
        expect(lattice(M2)).toBe(lattice(M));
    });

    test("an empty resident with no frames yields the cell; frame GC's forget promotes a co-resident", () => {
        const { M, E, A } = build();
        const V = M.cellChild("1", 8, 4);                                     // a visited cell: empty, childless
        const r = M.readdressMany(M.moveSubtreeTargets(E.id, 1, 4 * G, 0, M.subtreeStart(E.id, 1)), { empty: (id) => id === V.id });
        expect(r.shadowed).toEqual([{ id: V.id, of: E.id }]);                 // E took the cell; V its co-resident
        expect(M.findCellChild("1", 8, 4)).toBe(E);
        moveA(M, A, 2 * G);                                                   // A on E's cell, E keeps it
        expect(M.residentOf(A.id)).toBe(E);
        expect(M.forget(E.id)).toBe(false);                                   // E contains frames
        expect(M.forget(V.id)).toBe(true);
        const B = M.cellChild("1", 12, 4);
        const r2 = M.readdressMany(M.moveSubtreeTargets(B.id, 1, -4 * G, 0, M.subtreeStart(B.id, 1)), { empty: () => false });
        expect(r2.shadowed).toEqual([{ id: B.id, of: E.id }]);
        expect(M.forget(B.id)).toBe(true);                                    // a co-resident holding nothing
        const C = M.cellChild("1", 12, 4);
        M.readdressMany(M.moveSubtreeTargets(C.id, 1, -4 * G, 0, M.subtreeStart(C.id, 1)), { empty: () => false });
        // E empties its kids; forgotten, it hands the cell to a co-resident.
        const kids = [];
        M.walk(E.id, (f) => { if (f.id !== E.id) kids.push(f); });
        for (const k of kids.sort((p, q) => q.depth - p.depth)) expect(M.forget(k.id)).toBe(true);
        expect(M.forget(E.id)).toBe(true);
        const res = M.residentOf(A.id);
        expect([A.id, C.id]).toContain(res.id);
        expect(M.findCellChild("1", 8, 4)).toBe(res);
        expect(M.cellFrames(A.id).map((f) => f.id).sort()).toEqual([A.id, C.id].sort());
    });
});

describe("co-residents in the engine", () => {
    const rects = (E, frame, n) => {
        for (let i = 0; i < n; i++) {
            const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -400 + i * 90, top: -300, right: -340 + i * 90, bottom: -250 }), color: "#123", opacity: 1, w: 8 };
            E.doc.add(o, frame);
        }
    };
    const moveFrame = (E, id, dx) => {
        E._setSelection([], [id]);
        const p = E._levelPointToScreen(id, 0, 0);
        E._dragSel = { start: [p[0], p[1]], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        E._dragSelection(p[0] + dx, p[1]);
        E.pointerUp();
    };
    const fixture = () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(3);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const A = E.lm.cellChild("1", 10, 0).id, B = E.lm.cellChild("1", 12, 0).id;
        rects(E, A, 5); rects(E, B, 3);
        E._render();
        return { E, A, B };
    };

    test("a frame dropped on an inked frame's cell stays a co-resident: both lists live in the cell's picture", () => {
        const { E, A, B } = fixture();
        moveFrame(E, A, 64);
        expect(E.lm.frame(A).shadowOf).toBe(B);
        expect([E.doc.count(A), E.doc.count(B)]).toEqual([5, 3]);
        const m = E.stage.model;
        expect(m.nativesIn(B).length).toBe(8);                                // the cell's natives, A's included
        expect(m.nativesIn(A).length).toBe(8);
        E.undo();
        expect([E.lm.frame(A).shadowOf, E.lm.frame(B)._shadows]).toEqual([null, null]);
        E.redo();
        expect(E.lm.frame(A).shadowOf).toBe(B);
    });

    test("frame GC promotes: an emptied resident is forgotten and its co-resident takes the cell, its ink drawn", () => {
        const { E, A, B } = fixture();
        moveFrame(E, A, 64);
        E._setSelection([]);
        for (const o of E.doc.list(B).slice()) E.doc.removeById(o.id);
        E._gcCand.add(B);
        collectFrames(E);
        expect(E.lm.frame(B)).toBeUndefined();
        expect(E.lm.residentOf(A).id).toBe(A);
        expect(E.lm.findCellChild("1", 12, 0).id).toBe(A);
        E._render();
        expect(E._lastList.filter((it) => it.nat && it.nat._home === A).length).toBe(5);
    });

    // F126's scenario (REVIEWER-3 MOVE-2): frame "0" lassoed from far out and dragged away; zoomed back in, the camera
    // mints an empty twin in the vacated cell. The undo puts "0" back there: the empty twin yields the cell and the camera
    // is handed to "0" at the re-address — before C3 the twin was merged away with the camera on it.
    const zoomN = (E, x, y, f, n) => { for (let i = 0; i < n; i++) E.zoomFactorAt(x, y, f); };
    const dot = (E, x, y, w) => { E.setTool("pen"); E.setWidth(w); E.pointerDown(x, y); E.pointerUp(); E.flushBakes(); };
    const LOOP = [[614, 61], [513, 136], [269, 167], [25, 136], [-76, 61], [25, -14], [269, -45], [513, -14], [614, 61]];
    function farMove() {
        const E = mkEngine(800, 600, { scenes: false });
        dot(E, 57, 136, 14);
        zoomN(E, 582, 71, 1 / 16, 6);
        E.setTool("select");
        E.pointerDown(LOOP[0][0], LOOP[0][1], true);
        for (let i = 1; i < LOOP.length; i++) E.pointerMove(LOOP[i][0], LOOP[i][1]);
        E.pointerUp();
        expect(E.selection && E.selection.frames).toEqual(["0"]);
        const p = E.cam.levelPointToScreen("0", 0, 0), from = [Math.round(p[0]), Math.round(p[1])];
        E.pointerDown(from[0], from[1]);
        E.pointerMove(from[0] + 158, from[1] - 77);
        E.pointerUp();
        zoomN(E, 582, 71, 16, 6);
        return E;
    }

    test("the camera is handed to the resident at the re-address: the view draws, a new stroke has a frame", () => {
        const E = farMove();
        const twin = E.cam.frame;
        expect(twin).not.toBe("0");                                          // the camera sits in the vacated cell's twin
        E.undo();
        expect(E.cam.frame).toBe("0");                                       // at once, no merge event
        expect(E.lm.frame(twin).shadowOf).toBe("0");                          // the twin a co-resident, frame GC's
        E._render();
        expect(E._lastList.filter((o) => !o.erase).length).toBeGreaterThan(0);
        dot(E, 109, 217, 2);
        for (const L of E.doc.levels()) if (E.doc.count(L)) expect(E.lm.frame(L)).toBeTruthy();
    });

    test("control: the same undo with the camera a level out leaves it in its own frame", () => {
        const E = farMove();
        zoomN(E, 582, 71, 1 / 16, 3);
        const cam = E.cam.frame;
        E.undo();
        expect(E.cam.frame).toBe(cam);
        expect(E.lm.frame(cam)).toBeTruthy();
    });
});
