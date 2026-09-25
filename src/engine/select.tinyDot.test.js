/**
 * A mark smaller than the pick's reach is picked anywhere within that reach (TESTER-2, 2026-09-24:
 * a press on a lassoed sub-pixel dot selected and moved the ink under it instead). The eight slack
 * probes sit on a ring of the reach's radius, and a dot smaller than the gaps between them was hit
 * only by a press exactly on it.
 */
import KobinEngine from "./KobinEngine";
import { rectLoop } from "./geometry/arcShape";

const hosts = [];
function mkE(w = 800, h = 600) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster: false });
    E.cam.inPanX = w / 2; E.cam.inPanY = h / 2;          // frame 0's origin at the screen's centre
    hosts.push({ E, host });
    return E;
}
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

function scene() {
    const E = mkE();
    const under = E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1,
        polys: [[[-200, -200], [200, -200], [200, 200], [-200, 200]]] }, "0");
    const dot = E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1,
        loops: rectLoop({ left: 10, top: 10, right: 10.4, bottom: 10.4 }) }, "0");
    E._render();
    return { E, under, dot };
}

describe("a mark smaller than the pick's reach", () => {
    test("TD-1 a press 3 px from a 0.4-px dot picks the dot, not the fill under it", () => {
        const { E, dot } = scene();
        const [sx, sy] = E.cam.levelPointToScreen("0", 10.2, 10.2);
        expect(E._hitTest(sx + 3, sy + 1)).toBe(dot.id);       // red before: the fill under it
        expect(E._hitTest(sx - 2, sy + 2)).toBe(dot.id);
    });

    test("TD-2 the dot selected, a drag from beside it moves the dot and leaves the fill", () => {
        const { E, dot, under } = scene();
        E.setTool("select");
        E._setSelection([dot.id], []);
        const [sx, sy] = E.cam.levelPointToScreen("0", 10.2, 10.2);
        E.pointerDown(sx + 3, sy + 1);
        for (let k = 1; k <= 10; k++) E.pointerMove(sx + 3 + k * 4, sy + 1);
        E.pointerUp();
        expect(E.selection && E.selection.ids).toEqual([dot.id]);
        expect(E.doc.getById(under.id).obj.below).toBeFalsy();  // the fill did not move
        expect(E.doc.getById(dot.id).obj.below).toBeTruthy();   // the dot did
    });

    test("TD-3 a press 12 px from the dot, past the reach, still picks the fill", () => {
        const { E, under } = scene();
        const [sx, sy] = E.cam.levelPointToScreen("0", 10.2, 10.2);
        expect(E._hitTest(sx + 12, sy)).toBe(under.id);
    });
});
