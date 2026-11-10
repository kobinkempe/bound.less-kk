/**
 * OPEN-FLAGS F170 (Kobin's reports 2026-10-29 21:03 and 2026-11-09 05:48): pieces the lasso could not select, whole on
 * screen. They were homed in a co-resident chain (a cede's private frames, A1 C4) sharing the camera's cell but parting
 * from its chain 20–23 levels up. The lasso's walk reached that chain only from where it parts, by floats summed in the
 * camera frame's units, and a place 20 levels up cancels ~2^256: the chain was never visited. The same sum lost a
 * neighbour's subtree from about five levels up (F179's class). `LevelMap.nearWalk` walks co-residents together and
 * places every frame at or above the camera's depth by whole cells; the lasso, the erase's frame pass and
 * `TileStore._downSources` share it.
 */
import { useEngines, mkEngine, eraseGesture } from "./__testkit__/harness";
import { rectLoop } from "./geometry/arcShape";
import { W } from "./frameLattice";

useEngines();
const DIGITS = [[705, -139], [1801, -1027], [1304, -1480], [-1908, 1473], [1559, -1011]];
const square = (cx, cy, h) => rectLoop({ left: cx - h, top: cy - h, right: cx + h, bottom: cy + h });
const put = (E, frame, cx, cy, h) => E.doc.add({ id: E.doc.allocId(), type: "shape", origin: "native", loops: square(cx, cy, h), color: "#224466", opacity: 1 }, frame);
const loopAround = (E, x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => E.cam.screenToFrame(x, y));

/** The camera's chain down to depth `d`, and a private co-resident chain beside it parting `up` levels above the camera. */
function coResident(d, up) {
    const E = mkEngine(800, 600), M = E.lm;
    M.ensureSpine(-1);
    let view = M.frame("0"), twin = null;
    const p = d - up + 1;                                           // depth of the chain's first private frame
    if (p === 0) twin = M.privateFrame(view.parent, view.cell.i, view.cell.j, "family");
    for (let k = 0; k < d; k++) {
        const [i, j] = DIGITS[k % DIGITS.length];
        view = M.cellChild(view.id, i, j);
        if (twin) twin = M.privateFrame(twin.id, i, j, "family");
        else if (k + 1 === p) twin = M.privateFrame(view.parent, i, j, "family");
    }
    expect(M.sameCell(twin.id, view.id)).toBe(true);
    E.cam.set({ activeLevel: d, frame: view.id, inScale: 1, inPanX: 400, inPanY: 300 });
    return { E, view, twin };
}

describe("F170: the lasso takes ink homed in a co-resident chain of the camera's cell", () => {
    test.each([[2, 1], [5, 4], [8, 8], [21, 21]])("camera at depth %s, the chain parting %s levels up", (d, up) => {
        const { E, view, twin } = coResident(d, up);
        const a = put(E, twin.id, -100, 0, 40), b = put(E, view.id, 100, 0, 40);   // screen (260..340), (460..540)
        E._render();
        expect(E._lassoFind(loopAround(E, 240, 240, 360, 360)).ids).toEqual([a.id]);
        expect(E._lassoFind(loopAround(E, 440, 240, 560, 360)).ids).toEqual([b.id]);
        expect(E._lassoFind(loopAround(E, 240, 240, 560, 360)).ids.sort((p, q) => p - q)).toEqual([a.id, b.id]);
        // And the gesture, through the erase barrier and the judge.
        E.setTool("select");
        E.pointerDown(240, 240);
        let at = [240, 240];
        for (const c of [[360, 240], [360, 360], [240, 360], [240, 240]]) {
            for (let t = 1; t <= 6; t++) E.pointerMove(at[0] + ((c[0] - at[0]) * t) / 6, at[1] + ((c[1] - at[1]) * t) / 6);
            at = c;
        }
        E.pointerUp();
        expect(E.selection && E.selection.ids).toEqual([a.id]);
    });
});

describe("the lasso takes a neighbour's ink across an ancestor's cell edge (F179's class)", () => {
    // A: (0,0) then (2047,0) to depth d; B: (1,0) then (-2048,0). At depth d B is A's right neighbour, their common
    // ancestor "0" d levels up.
    test.each([3, 6])("the cells parting %s levels up", (d) => {
        const E = mkEngine(800, 600), M = E.lm;
        let A = M.cellChild("0", 0, 0), B = M.cellChild("0", 1, 0);
        for (let k = 1; k < d; k++) { A = M.cellChild(A.id, 2047, 0); B = M.cellChild(B.id, -2048, 0); }
        const n = put(E, B.id, -W / 2 + 60, 0, 40);                     // just inside B's left edge
        E.cam.set({ activeLevel: d, frame: A.id, inScale: 1, inPanX: 400 - W / 2, inPanY: 300 });   // A's right edge mid-screen
        E._render();
        expect(E._lassoFind(loopAround(E, 400, 240, 560, 360)).ids).toEqual([n.id]);   // its picture: x 420..500
    });
});

test("the erase's frame pass takes a co-resident kid frame its mark covers whole", () => {
    const { E, twin } = coResident(8, 8);
    const kid = E.lm.privateFrame(twin.id, 3, 0, "family");            // one level down: a 32 px cell at x 96
    const n = put(E, kid.id, 0, 0, 2000);
    E._render();
    eraseGesture(E, [[400, 300], [496, 300], [592, 300]], 260);
    E.flushErases();
    for (let k = 0; k < 400 && E._bakeNext(); k++);
    expect(E.doc.getById(n.id)).toBeFalsy();
    const note = E.journal.find((j) => j.kind === "erase");
    expect(note.cuts.some((c) => c.mode === "frame" && c.frame === kid.id)).toBe(true);
});
