/**
 * F45 (2026-09-05): a crossing must keep the frame point under the screen centre
 * where it is, whichever cell that point rounds into.
 *
 * The strip [W/2 - G/2, W/2) of a frame belongs to the NEIGHBOUR's extreme cell
 * (cells are centred on their index). `_maybeShift` treats [-W/2, W/2) as
 * "inside this frame" while `_viewCell` rounds, so a view centre in that strip
 * minted its child under the neighbour and `_crossUp` applied an edge measured
 * from a frame the camera was not in: the picture jumped one whole level-0 cell
 * (8,192 px at the crossing zoom). Any zoom whose centre sits on a cell boundary
 * to within float noise reaches it — the default view of a 1504-wide window is
 * 23.5 cells wide — so it is a coin toss on ordinary use, not a corner case.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import { W, HALF_W } from "./frameLattice";

useEngines();

const centreAfterCross = (E, cx, cy) => {
    // Put the view centre at (cx, cy) of the root frame with the in-frame zoom
    // just past `enter`, so settling must cross up exactly once.
    const s = E.cfg.enter * 1.1;
    E.cam.set({ frame: "0", inScale: s, inPanX: E.width / 2 - cx * s, inPanY: E.height / 2 - cy * s });
    const before = E.cam.centre();
    expect(Math.abs(before[0] - cx)).toBeLessThan(1e-9);
    expect(Math.abs(before[1] - cy)).toBeLessThan(1e-9);
    E.cam.settle();
    expect(E.activeLevel).toBe(1);
    const after = E.lm.mapPointF(E.cam.centre(), E.cam.frame, "0");
    expect(after).not.toBeNull();
    return { dx: after[0] - cx, dy: after[1] - cy, frame: E.cam.frame };
};

describe("F45: a crossing about a cell boundary", () => {
    const eps = 1e-6; // level-0 units; one level-0 cell is 32, one frame W
    const tiny = W * 4e-16;   // a few ulps of W, the float noise the bug rode on

    test("centre in the middle of a cell (control)", () => {
        const E = mkEngine();
        const r = centreAfterCross(E, 12 * 32 + 3, 4);
        expect(Math.abs(r.dx)).toBeLessThan(eps);
        expect(Math.abs(r.dy)).toBeLessThan(eps);
    });

    test.each([
        ["x just inside the frame's right edge (the neighbour's strip)", HALF_W - tiny, 5],
        ["x exactly on a cell boundary mid-frame", 16 + 12 * 32, 5],
        ["x a hair past a mid-frame cell boundary", 16 + 12 * 32 + tiny, 5],
        ["y just inside the frame's bottom edge", 7, HALF_W - tiny],
        ["both on the frame edge", HALF_W - tiny, HALF_W - tiny],
        ["x just inside the frame's LEFT edge", -HALF_W + tiny, 5],
    ])("%s", (name, cx, cy) => {
        const E = mkEngine();
        const r = centreAfterCross(E, cx, cy);
        expect(Math.abs(r.dx)).toBeLessThan(eps);
        expect(Math.abs(r.dy)).toBeLessThan(eps);
    });

    test("a full settle from far outside the band lands on the same point (many crossings)", () => {
        const E = mkEngine();
        const cx = HALF_W - tiny, cy = 3;
        const s = E.cfg.enter * 4096 * 4096 * 1.1; // three crossings' worth
        E.cam.set({ frame: "0", inScale: s, inPanX: E.width / 2 - cx * s, inPanY: E.height / 2 - cy * s });
        E.cam.settle();
        expect(E.activeLevel).toBe(3);
        const after = E.lm.mapPointF(E.cam.centre(), E.cam.frame, "0");
        expect(Math.abs(after[0] - cx)).toBeLessThan(eps);
        expect(Math.abs(after[1] - cy)).toBeLessThan(eps);
    });
});
