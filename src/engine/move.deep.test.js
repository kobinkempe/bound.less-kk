/**
 * MD — moving things that live BELOW the view, which is what F-C / F25 / F28
 * were about and what the frame lattice exists to fix.
 *
 * THE OLD FAILURE, measured 2026-08-18 on the pre-lattice build: a drag
 * translated every selected member's geometry by `displacement x R^k`, where k
 * is how many levels below the camera that member lives. The members stayed
 * beautifully registered with each other — drift under 6e-14 px at every depth —
 * and each one's OWN SHAPE was destroyed: 0.12% of its area gone at four levels
 * of separation, 82.9% at five, coordinates reaching 7.3e18. The object did not
 * move wrong. It came apart.
 *
 * THE FIX is that a whole-cell displacement is a change of ADDRESS. The member
 * is re-homed into the cell that many steps along and its geometry is not
 * touched at all, because neighbouring cells' origins differ by exactly one
 * frame, so the same local coordinates describe the moved object exactly. Only
 * the sub-cell remainder — under one frame, at any depth — is ever added to a
 * coordinate.
 *
 * So the assertions here are mostly about what must NOT change, and they are
 * exact rather than approximate on purpose: "within a percent" is what the old
 * build passed for four levels before falling off a cliff at five.
 */
import { useEngines, mkEngine, drawStroke, descend, erase, objPointIn } from "./__testkit__/harness";
import { loopsBBox, loopsArea } from "./geometry/arcShape";
import { HALF_W, W } from "./frameLattice";

jest.setTimeout(300000);
useEngines();

// ---- helpers ---------------------------------------------------------------

const areaOf = (o) => Math.abs(loopsArea(o.loops));
const bboxOf = (o) => loopsBBox(o.loops);
// A shape's GEOMETRY as a string, so "did any coordinate move" is one compare.
// Only the numbers that place the ink — pieces carry bookkeeping (`src`, `ci`)
// that a boolean re-stamps without moving anything, and comparing that instead
// would report a difference where there is none.
const geomOf = (o) => JSON.stringify((o.loops || []).map((loop) => loop.map((p) => (p.line
    ? [0, p.A[0], p.A[1], p.B[0], p.B[1]]
    : [1, p.A[0], p.A[1], p.B[0], p.B[1], p.C[0], p.C[1], p.r, p.a0, p.sweep]))));
// Where an object's PICTURE sits, in ONE reference frame's units, so two
// objects at different depths can be compared at all. Through the object's
// displacement table (F55): a move never touches a coordinate, so where the
// bits are is not where the ink is.
const worldAt = (E, rec, ref = "0") => {
    const b = bboxOf(rec.obj);
    return objPointIn(E, rec, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], ref);
};
const recOf = (E, id) => E.doc.getById(id);

/**
 * Draw one object at each depth 0..n, all under the same screen point, then
 * return to depth 0. Each is an independent native — which is the realistic
 * lasso case, and a harder one than a ceded family because nothing but the
 * lattice keeps them in step.
 */
const buildTower = (E, n, sx = 400, sy = 300) => {
    const ids = [];
    for (let d = 0; d <= n; d++) {
        if (d) descend(E, d, sx, sy);
        const o = drawStroke(E, [[sx - 60, sy], [sx, sy], [sx + 60, sy]], 14);
        ids.push(o.id);
    }
    // back to the top
    let guard = 0;
    while (E.activeLevel > 0 && guard++ < 600) E.zoomAt(sx, sy, 1000);
    return ids;
};

const dragBy = (E, sx, sy, dx, dy, steps = 6) => {
    E.setTool("select");
    E.pointerDown(sx, sy);
    for (let i = 1; i <= steps; i++) E.pointerMove(sx + (dx * i) / steps, sy + (dy * i) / steps);
    E.pointerUp();
};
// Select every native in the document, the way a lasso around everything would.
// `pointerDown` on an already-selected object keeps the whole selection, which
// is what makes a multi-level drag a multi-level drag.
const selectAll = (E) => {
    const ids = [];
    for (const L of E.doc.levels()) for (const o of E.doc.at(L)) if (!o.erase) ids.push(o.id);
    E._setSelection(ids);
    return ids;
};

// ---------------------------------------------------------------------------

describe("MD-1 — a deep member's own shape survives the drag", () => {
    for (const n of [3, 4, 5, 6]) {
        test(`${n} level(s) below the view: area and coordinates are untouched`, () => {
            const E = mkEngine();
            const ids = buildTower(E, n);
            const deep = recOf(E, ids[n]);
            const areaBefore = areaOf(deep.obj);
            const bBefore = bboxOf(deep.obj);
            const reachBefore = Math.max(Math.abs(bBefore.x0), Math.abs(bBefore.y0),
                Math.abs(bBefore.x1), Math.abs(bBefore.y1));

            selectAll(E);
            dragBy(E, 400, 300, 30, 0);

            const after = recOf(E, ids[n]);
            expect(after).toBeTruthy();
            // THE HEADLINE. The old build lost 82.9% of this at n = 5.
            expect(areaOf(after.obj)).toBe(areaBefore);
            const bAfter = bboxOf(after.obj);
            expect(bAfter.x1 - bAfter.x0).toBe(bBefore.x1 - bBefore.x0);
            expect(bAfter.y1 - bAfter.y0).toBe(bBefore.y1 - bBefore.y0);
            // Coordinates stay inside the frame that holds them, at every depth.
            // The old build reached 7.3e18 here.
            const reachAfter = Math.max(Math.abs(bAfter.x0), Math.abs(bAfter.y0),
                Math.abs(bAfter.x1), Math.abs(bAfter.y1));
            expect(reachAfter).toBeLessThan(2 * W);
            expect(reachAfter).toBeLessThan(reachBefore + W);
        });
    }

    test("a whole-cell displacement does not touch geometry AT ALL", () => {
        // The strongest statement the design can make: when the move happens to
        // land on a cell boundary for a member, that member is re-homed and its
        // coordinates come out bit-identical.
        const E = mkEngine();
        const ids = buildTower(E, 3);
        const deep = recOf(E, ids[3]);
        const before = geomOf(deep.obj);
        const homeBefore = deep.level;

        // 32 units at the camera's level is exactly one cell one level down, so
        // every digit below the first is zero and the remainder is nothing.
        selectAll(E);
        dragBy(E, 400, 300, 32 * E.cam.inScale, 0, 4);

        const after = recOf(E, ids[3]);
        expect(after.level).not.toBe(homeBefore);   // it re-homed
        expect(geomOf(after.obj)).toBe(before);     // ...and nothing else happened
    });
});

describe("MD-2 — things move TOGETHER", () => {
    test("a tower selected at the top keeps every relative position exactly", () => {
        const E = mkEngine();
        const n = 5;
        const ids = buildTower(E, n);
        const before = ids.map((id) => worldAt(E, recOf(E, id)));

        selectAll(E);
        dragBy(E, 400, 300, 37, -23);

        const after = ids.map((id) => worldAt(E, recOf(E, id)));
        // Every member moved by the SAME world displacement. They all expanded
        // one displacement into digits, and the digits they share are integers,
        // so this is exact by construction rather than by luck.
        const d0 = [after[0][0] - before[0][0], after[0][1] - before[0][1]];
        expect(Math.hypot(d0[0], d0[1])).toBeGreaterThan(0);
        for (let k = 1; k <= n; k++) {
            const dk = [after[k][0] - before[k][0], after[k][1] - before[k][1]];
            // in level-0 units, and a level-0 unit is a pixel at the top
            expect(Math.abs(dk[0] - d0[0])).toBeLessThan(1e-9);
            expect(Math.abs(dk[1] - d0[1])).toBeLessThan(1e-9);
        }
    });

    test("registration measured in the DEEPEST member's own units, where it matters", () => {
        // A level-0 unit is 4096^5 units down there, so agreeing to 1e-9 at the
        // top says nothing at all about what the deep member sees. Measure the
        // gap between the two deepest members in the deeper one's own frame.
        const E = mkEngine();
        const n = 5;
        const ids = buildTower(E, n);
        const gap = () => {
            const a = recOf(E, ids[n - 1]), b = recOf(E, ids[n]);
            const pa = E.lm.mapPointF(bboxOf(a.obj) && [bboxOf(a.obj).x0, bboxOf(a.obj).y0], a.level, b.level);
            const bb = bboxOf(b.obj);
            return pa ? [pa[0] - bb.x0, pa[1] - bb.y0] : null;
        };
        const before = gap();
        selectAll(E);
        dragBy(E, 400, 300, 30, 11);
        const after = gap();
        expect(before).toBeTruthy();
        expect(after).toBeTruthy();
        // Same units as the deepest object's own geometry.
        expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-6);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-6);
    });
});

describe("MD-3 — the walk-in (test catalog M-1)", () => {
    test("nudging at every level from 0 down to 5 accumulates, and nothing shatters", () => {
        // Kobin's scenario: mark a spot at depth, zoom out, select the object at
        // level 0 and walk it in — nudge, zoom one level, nudge again, all the
        // way down. Every nudge is a displacement at a different level, so this
        // exercises the digit expansion at every possible separation.
        const E = mkEngine();
        const n = 5;
        const ids = buildTower(E, n);
        const deep = recOf(E, ids[n]);
        const areaBefore = areaOf(deep.obj);

        for (let d = 0; d <= n; d++) {
            if (d) descend(E, d, 400, 300);
            selectAll(E);
            dragBy(E, 400, 300, 12, 7, 3);
            E.deselect();
        }

        const after = recOf(E, ids[n]);
        expect(after).toBeTruthy();
        expect(areaOf(after.obj)).toBe(areaBefore);   // still the same object
        const b = bboxOf(after.obj);
        expect(Math.max(Math.abs(b.x0), Math.abs(b.y1))).toBeLessThan(2 * W);
    });
});

describe("MD-4 — a slow drag equals a fast one, at depth", () => {
    for (const n of [2, 4, 6]) {
        test(`${n} level(s) below the view`, () => {
            const run = (steps) => {
                const E = mkEngine();
                const ids = buildTower(E, n);
                selectAll(E);
                dragBy(E, 400, 300, 40, 25, steps);
                const rec = recOf(E, ids[n]);
                return { world: worldAt(E, rec), geom: geomOf(rec.obj) };
            };
            const fast = run(1), slow = run(40);
            // The same arithmetic on the same numbers: identical, not close.
            expect(slow.geom).toBe(fast.geom);
            expect(slow.world).toEqual(fast.world);
        });
    }
});

describe("MD-5 — there and back", () => {
    test("dragging away and back returns every member bit-exactly", () => {
        const E = mkEngine();
        const n = 4;
        const ids = buildTower(E, n);
        const before = ids.map((id) => { const r = recOf(E, id); return { level: r.level, geom: geomOf(r.obj) }; });

        selectAll(E);
        dragBy(E, 400, 300, 96, 64, 8);
        dragBy(E, 400, 300, -96, -64, 8);

        for (let k = 0; k <= n; k++) {
            const r = recOf(E, ids[k]);
            expect(r.level).toBe(before[k].level);
            expect(geomOf(r.obj)).toBe(before[k].geom);
        }
    });

    test("undo puts a deep move back exactly", () => {
        const E = mkEngine();
        const n = 4;
        const ids = buildTower(E, n);
        const before = ids.map((id) => { const r = recOf(E, id); return { level: r.level, geom: geomOf(r.obj) }; });

        selectAll(E);
        dragBy(E, 400, 300, 71, -19, 5);
        const moved = ids.map((id) => recOf(E, id).level);
        expect(moved.some((lv, k) => lv !== before[k].level)).toBe(true);   // something re-homed

        E.undo();
        for (let k = 0; k <= n; k++) {
            const r = recOf(E, ids[k]);
            expect(r.level).toBe(before[k].level);
            expect(geomOf(r.obj)).toBe(before[k].geom);
        }
    });
});

describe("MD-6 — an erased object moves with its hole", () => {
    test("a ceded family keeps its hole, its area, and its registration", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        descend(E, 2, 400, 300);
        E.setEraserSize(20);
        erase(E, [[400, 260], [400, 340]]);
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 600) E.zoomAt(400, 300, 1000);

        const family = () => {
            const out = [];
            for (const L of E.doc.levels()) for (const o of E.doc.at(L)) if (!o.erase && o.loops) out.push({ level: L, obj: o });
            return out.sort((a, b) => a.obj.id - b.obj.id);
        };
        const before = family().map((r) => ({ id: r.obj.id, area: areaOf(r.obj), depth: E.lm.depthOf(r.level) }));
        expect(before.length).toBeGreaterThan(1);   // it really did cede

        selectAll(E);
        dragBy(E, 400, 300, 45, 0, 6);

        const after = family().map((r) => ({ id: r.obj.id, area: areaOf(r.obj), depth: E.lm.depthOf(r.level) }));
        expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
        for (let k = 0; k < before.length; k++) {
            expect(after[k].depth).toBe(before[k].depth);       // nothing changed level
            // Areas are measured in each member's OWN units, and re-homing does
            // not change units — so the hole is exactly as big as it was.
            expect(after[k].area).toBe(before[k].area);
        }
    });
});

describe("MD-7 — a move never leaves an object outside its neighbourhood", () => {
    test("after any drag, every native still sits within a cell of its frame", () => {
        // Invariant 2: an object never extends past its frame's immediate
        // neighbours. A move re-homes to the NEAREST cell, so the local
        // coordinate it is left holding is under one frame by construction.
        const E = mkEngine();
        const ids = buildTower(E, 5);
        for (const [dx, dy] of [[300, 0], [0, -250], [-700, 400], [1200, 1200]]) {
            selectAll(E);
            dragBy(E, 400, 300, dx, dy, 5);
            E.deselect();
        }
        for (const id of ids) {
            const r = recOf(E, id);
            const b = bboxOf(r.obj);
            const reach = Math.max(Math.abs(b.x0), Math.abs(b.y0), Math.abs(b.x1), Math.abs(b.y1));
            expect(reach).toBeLessThan(HALF_W + W);
        }
    });
});

describe("MD-8 — an over-wide stroke is promoted, not left to break invariant 2", () => {
    test("a stroke drawn across a panning canvas ends up one level up, same picture", () => {
        // D9. A cell is about three screens across, so no single gesture can
        // normally break the invariant — but a pointer dragged while the canvas
        // pans can, and one over-wide native would then reach across cells the
        // neighbour pickup does not look at.
        const E = mkEngine();
        E.setTool("pen"); E.setWidth(20);
        E.pointerDown(400, 300);
        // Pan hard between samples: the stroke's own coordinates run away even
        // though the pointer never leaves the screen.
        for (let i = 1; i <= 14; i++) {
            E.panBy(-14000, 0);
            E.pointerMove(400, 300 + i);
        }
        E.pointerUp();
        E.flushBakes();

        const all = [];
        for (const L of E.doc.levels()) for (const o of E.doc.at(L)) if (!o.erase) all.push({ level: L, obj: o });
        expect(all.length).toBe(1);
        const r = all[0];
        const b = bboxOf(r.obj);
        // It fits in a cell now, and it got there by changing level.
        expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThanOrEqual(W);
        expect(E.lm.depthOf(r.level)).toBeLessThan(0);
        // And it is still ink: promotion is a change of units, so the area
        // scales by exactly the crossing ratio squared per level and nothing
        // about the shape changes.
        expect(areaOf(r.obj)).toBeGreaterThan(0);
    });

    test("an ordinary stroke is left exactly where it was drawn", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[200, 300], [400, 320], [600, 300]], 20);
        const rec = recOf(E, o.id);
        expect(E.lm.depthOf(rec.level)).toBe(0);
        expect(rec.level).toBe("0");
    });
});

describe("MD-9 — a deep drag is cheap", () => {
    test("dragging a six-level tower costs no more per event than dragging one object", () => {
        // The old drag rewrote every member's geometry on every pointer event —
        // a deep member's coordinates were being multiplied by R^k and its whole
        // perimeter rebuilt, sixty times a second. Re-homing is an id and a map
        // entry, so the deep members should now cost LESS than the shallow one,
        // not more.
        const time = (fn, reps) => {
            fn();                                   // warm
            const t0 = Date.now();
            for (let i = 0; i < reps; i++) fn();
            return (Date.now() - t0) / reps;
        };

        const E = mkEngine();
        buildTower(E, 6);
        selectAll(E);
        const deep = time(() => { dragBy(E, 400, 300, 24, 16, 8); dragBy(E, 400, 300, -24, -16, 8); }, 6);

        // The control is SEVEN MEMBERS ON ONE LEVEL, not one member, and it is
        // measured in the same process under the same load. A wall-clock ceiling
        // was the wrong instrument: it passed alone and failed under a full
        // parallel suite, which says nothing about the engine. What the claim
        // actually is — depth costs no more than breadth — is a ratio, and a
        // ratio survives a loaded machine.
        const F = mkEngine();
        const flat = [];
        for (let i = 0; i < 7; i++) flat.push(drawStroke(F, [[340, 240 + i * 16], [400, 240 + i * 16], [460, 240 + i * 16]], 14).id);
        F._setSelection(flat);
        const wide = time(() => { dragBy(F, 400, 300, 24, 16, 8); dragBy(F, 400, 300, -24, -16, 8); }, 6);

        // eslint-disable-next-line no-console
        console.log(`MD-9 drag: 7 members over 7 levels ${deep.toFixed(1)}ms  |  7 members on one level ${wide.toFixed(1)}ms`);
        // The old drag rewrote a deep member's whole perimeter at R^k every
        // pointer event; this is what that would show up as.
        expect(deep).toBeLessThan(Math.max(4 * wide, 25));
    });
});
