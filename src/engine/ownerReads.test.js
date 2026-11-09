// A frame on its parent's edge reads each parent square from the frame that owns it, a shape cut to that square as the
// descent cuts a kid (OPEN-FLAGS F181 part 2, F180). Each test also puts the old rule back and checks that the same
// measurement then fails, so a pass is not a blind spot.
import { useEngines, mkEngine } from "./__testkit__/harness";
import { Loop } from "./geometry/loop";
import { circleLoop } from "./geometry/antRuns";

useEngines();
const pcs = (l) => (l.toPieces ? l.toPieces() : l);

/** A circle across the line between root cells 12 and 13 of row 9 (x = 400), as a native of "0". */
function circle(E, tile = null) {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(circleLoop(400.0301234567, 290.3341592653, 0.0501234567))], color: "#123", opacity: 1, w: 6 };
    if (tile) o.tile = tile;
    E.doc.add(o, "0");
    return o;
}
/**
 * Where the circle crosses x = 400 going down the line: P = cell (13, 9), the straddler S (P's cell −2048) and the cells
 * on the line below it; each frame with the crossing in its units.
 */
function chain(E, levels) {
    const yc = 290.3341592653 + Math.sqrt(0.0501234567 ** 2 - 0.0301234567 ** 2);
    const P = E.lm.cellChild("0", 13, 9).id, yP = E.lm.mapPointF([400, yc], "0", P)[1];
    const out = [];
    let F = E.lm.cellChild(P, -2048, Math.round(yP / 32)).id, y = (yP - 32 * Math.round(yP / 32)) * 4096;
    for (let d = 0; d < levels; d++) {
        out.push({ F, y });
        const j = Math.round(y / 32);
        F = E.lm.cellChild(F, 0, j).id; y = (y - 32 * j) * 4096;
    }
    return out;
}
/** Every vertex of the shape pieces in F's tile (0, 0), sorted: the geometry alone, whichever object it belongs to. */
const verts = (E, F) => {
    const v = [];
    for (const p of E.store._ensureUp(F, 0, 0).objs) if (p.loops) for (const l of p.loops) for (const q of pcs(l)) v.push([q.A[0], q.A[1], q.B[0], q.B[1]].join(","));
    return v.sort();
};
const same = (a, b) => a.length > 0 && a.length === b.length && a.every((x, k) => x === b[k]);

describe("owner reads (F181 part 2, F180)", () => {
    test("OR-1: below a cede on a straddling frame, the twin with no erase is the cede, bit for bit, away from the hole", () => {
        const run = (erase, centreRule) => {
            const E = mkEngine(1369, 925);
            circle(E);
            if (centreRule) E.store._ownPart = () => false;   // the old rule: the square holding the centre, whole
            if (erase) {
                // A 12-px dab inside the circle at the straddler, 3,000 units right of the line between its owners.
                const [{ F: S, y }] = chain(E, 1), x = 3000;
                E.cam.set({ activeLevel: 2, frame: S, inScale: 1, inPanX: 684 - x, inPanY: 462 - y });
                E._render();
                E.setEraserSize(12); E.setTool("erasePartial");
                E.pointerDown(684, 462); E.pointerMove(684.5, 462); E.pointerUp(); E.flushBakes(); E.flushErases();
            }
            return { E, c: chain(E, 3) };   // after the erase, which sweeps the empty frames below the camera
        };
        const cut = run(true, false), twin = run(false, false), old = run(false, true);
        // The cede happened: a kid on each side of the line a level up, and the straddler's own, with the hole, on the
        // side the dab reached.
        const kids = (d) => cut.E.doc.levels().filter((k) => cut.E.lm.depthOf(k) === d).flatMap((k) => cut.E.doc.list(k)).length;
        expect([kids(0), kids(1), kids(2)]).toEqual([0, 2, 1]);
        for (const d of [1, 2]) {
            expect([d, same(verts(cut.E, cut.c[d].F), verts(twin.E, twin.c[d].F))]).toEqual([d, true]);
            expect([d, same(verts(cut.E, cut.c[d].F), verts(old.E, old.c[d].F))]).toEqual([d, false]);
        }
    });

    test("OR-2: a phase of whole cells (a promoted native's) reads from the owners as phase 0 does", () => {
        // `_promoteOversize` moves a native up a level by its cell's centre, a phase of whole cells: 0 a level below.
        const run = (tile, oldRule) => {
            const E = mkEngine(800, 600);
            circle(E, tile);
            if (oldRule) E.store._onGridAt = (rec) => !(rec.obj.tile && (rec.obj.tile[0] || rec.obj.tile[1]));
            return chain(E, 3).map(({ F }) => verts(E, F));
        };
        const flat = run(null, false), promoted = run([416, 288], false), old = run([416, 288], true);
        for (let d = 0; d < 3; d++) expect([d, same(flat[d], promoted[d])]).toEqual([d, true]);
        expect(same(flat[0], old[0])).toBe(false);
    });

    test("OR-3: a straddler's tile is the same bits with its left owner never minted (virtual) as with it minted", () => {
        const run = (mint) => {
            const E = mkEngine(800, 600);
            circle(E);
            if (mint) E.lm.cellChild("0", 12, 9);
            const c = chain(E, 2), t = E.store._ensureUp(c[0].F, 0, 0);
            return { v: c.map(({ F }) => verts(E, F)), virtual: (t.src || []).some((k) => k.includes("~|up|")) };
        };
        const v = run(false), m = run(true);
        expect([v.virtual, m.virtual]).toEqual([true, false]);
        for (let d = 0; d < 2; d++) expect([d, same(v.v[d], m.v[d])]).toEqual([d, true]);
    });

    test("OR-4: ink added and removed after a straddler's tiles are cached: each tile as a fresh derivation makes it", () => {
        const E = mkEngine(800, 600);
        circle(E);
        const c = chain(E, 3);
        for (const { F } of c) verts(E, F);   // cached, the left owner virtual
        const fresh = () => { const keep = E.store._epoch; E.store.bumpEpoch(); const v = c.map(({ F }) => verts(E, F)); return { v, keep }; };
        // A second circle across the same line, a little below.
        const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(circleLoop(399.9801234567, 290.3341992653, 0.0501234567))], color: "#456", opacity: 1, w: 6 };
        E.doc.add(o, "0");
        const added = c.map(({ F }) => verts(E, F)), a = fresh();
        for (let d = 0; d < 3; d++) expect([d, same(added[d], a.v[d])]).toEqual([d, true]);
        E.doc.removeById(o.id);
        const removed = c.map(({ F }) => verts(E, F)), r = fresh();
        for (let d = 0; d < 3; d++) expect([d, same(removed[d], r.v[d])]).toEqual([d, true]);
        expect(same(added[0], removed[0])).toBe(false);   // the second circle reached the straddler's tile
    });
});
