/**
 * The reroute walk over every object with a displacement table is kept until a table or such an
 * object's home can have changed (REVIEWER E-3: keyed on `doc.rev`, it re-walked 19.7k tables on
 * every render of the Magnum Opus, whatever the edit).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";

useEngines();

test("E3-1 an edit of an object with no table keeps the walk; a table change and a removal redo it", () => {
    const E = mkEngine();
    const a = drawStroke(E, [[200, 200], [300, 220]], 10);
    const b = drawStroke(E, [[200, 300], [300, 320]], 10);
    E.doc.setOffsetsById(a.id, [[0, 30, -20]]);
    E._render();
    const F = E.cam.frame;
    const m1 = E.store._rerouteGroups(F);
    const c = drawStroke(E, [[400, 400], [500, 420]], 10);             // no table: its add, its bake
    E.doc.setZById(c.id, 0.5);
    expect(E.store._rerouteGroups(F)).toBe(m1);                         // red: walked again
    E.doc.setOffsetsById(b.id, [[0, 10, 10]]);
    const m2 = E.store._rerouteGroups(F);
    expect(m2).not.toBe(m1);
    E.doc.removeById(a.id);
    expect(E.store._rerouteGroups(F)).not.toBe(m2);
    E.doc.setOffsetsById(b.id, undefined);                              // a table cleared: it leaves the set
    const m4 = E.store._rerouteGroups(F);
    expect(E.store._rerouteGroups(F)).toBe(m4);
    expect(E.doc.offsetIds().size).toBe(0);
});

test("E3-2 seen from a deeper frame, an object whose table is cleared leaves the walk's groups", () => {
    const E = mkEngine();
    const b = drawStroke(E, [[300, 280], [500, 320]], 40);
    E.doc.setOffsetsById(b.id, [[0, 1, 1]]);
    for (let i = 0; i < 3; i++) E.zoomFactorAt(400, 300, 16);
    const F = E.cam.frame;
    expect(F).not.toBe(b._home);
    const has = (m) => m.moved.has(b.id);
    expect(has(E.store._rerouteGroups(F))).toBe(true);                  // the fixture: a moved object read from F
    E.doc.setOffsetsById(b.id, undefined);
    expect(has(E.store._rerouteGroups(F))).toBe(false);                 // red without the offsetsOnly bump: the stale walk
});
