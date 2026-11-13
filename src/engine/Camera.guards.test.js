/**
 * OPEN-FLAGS F61: the camera refuses input that is not a finite number. A NaN zoom anchor or pan used to leave
 * inPanX/inPanY NaN for good (and before 2026-09, recursed until the stack overflowed).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";

useEngines();

test.each([
    ["a NaN zoom anchor", (C) => C.zoomFactorAt(NaN, 300, 2)],
    ["an infinite zoom anchor", (C) => C.zoomFactorAt(400, Infinity, 2)],
    ["a zero zoom factor", (C) => C.zoomFactorAt(400, 300, 0)],
    ["a NaN pinch pan", (C) => C.pinchUpdate(400, 300, 1.1, NaN, 0)],
    ["a NaN pan", (C) => C.panBy(0, NaN)],
])("%s is refused and leaves the camera as it was", (_, act) => {
    const E = mkEngine();
    drawStroke(E, [[380, 300], [420, 300]], 8);
    const before = E.cam.state();
    expect(act(E.cam)).toBe(false);
    expect(E.cam.state()).toEqual(before);
    E.cam.zoomFactorAt(400, 300, 2);   // and it still zooms
    expect(Number.isFinite(E.cam.inPanX) && E.cam.inScale === before.inScale * 2).toBe(true);
});
