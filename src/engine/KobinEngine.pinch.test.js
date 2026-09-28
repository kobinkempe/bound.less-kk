/**
 * KobinEngine.pinch.test.js — a pinch's pan can move the camera into the next cell (a lateral shift),
 * and that step renders in the new frame, in "sync" and in "raf" frames. On the raster path the camera
 * step is the table's (`_tableStep`), which renders only for a crossing: a pinch that dropped its pan's
 * cell change took the camera-only step into a frame nothing had rendered (the B-FOUNDATION review).
 */
import KobinEngine from "./KobinEngine";
import { HALF_W } from "./frameLattice";

const engines = [];
function mkEngine(frames) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster: true, frames });
    engines.push({ E, host });
    return E;
}
afterEach(() => { while (engines.length) { const { E, host } = engines.pop(); E.destroy(); host.remove(); } });

/** The camera's centre a few units short of its cell's right edge, then a pinch whose pan carries it over. */
function pinchAcross(E) {
    E._render();
    const s = E.cam.inScale;
    E.cam.inPanX = E.lm.width / 2 - (HALF_W - 4) * s;         // centre at x = HALF_W − 4: still in the cell
    E._render();
    const f0 = E.cam.frame;
    const renders = jest.spyOn(E, "_render");
    E.pinchUpdate(400, 300, 1.0001, -8 * s, 0);                // the pan alone moves the centre 8 units right
    return { f0, renders };
}

test("sync frames: a pinch whose pan crosses a cell edge renders, in the new frame", () => {
    const E = mkEngine("sync");
    const { f0, renders } = pinchAcross(E);
    expect(E.cam.frame).not.toBe(f0);                          // the pan's lateral shift
    expect(renders).toHaveBeenCalledTimes(1);                  // red when the pinch drops its pan's crossing
    expect(E.stage.frame).toBe(String(E.cam.frame));
    expect(E._gcCamAt).toBe(E.cam.frame);                      // the frame trail saw the move (F94)
});

test("raf frames: the pan's crossing rides the frame and the frame's step renders", () => {
    const E = mkEngine("raf");
    const { f0, renders } = pinchAcross(E);
    expect(renders).not.toHaveBeenCalled();                     // the consequences wait for the frame
    E.flush();
    expect(E.cam.frame).not.toBe(f0);
    expect(renders).toHaveBeenCalledTimes(1);
    expect(E.stage.frame).toBe(String(E.cam.frame));
});
