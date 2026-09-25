/**
 * F129 (REVIEWER-3 ERASE-4, lane seed 4604): an eraser used two or more crossings deep, on ink homed
 * in the NEIGHBOURING cell (a stroke across its home frame's edge, zoomed into on the far side),
 * removed nothing: the chain to the mark goes up out of the home and down through the neighbour, so
 * it was cut in place, where the eraser projected into the stored coordinates is smaller than the
 * boolean's weld and grazed. The mark was spent and nothing was logged. It now cedes down the mark's
 * chain below that neighbour, as the render reads the ink there.
 */
import KobinEngine from "./KobinEngine";
import { W } from "./frameLattice";

jest.setTimeout(60000);

const hosts = [];
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

/** A stroke down across frame 0's lower edge (y = -W/2 at screen 300), then `levels` crossings in on the far side at (400, 250). */
function scene(levels, extra = 0) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, scenes: false });
    hosts.push({ E, host });
    E.setTool("pan"); E.panBy(0, 300 - (-(W / 2) * E.cam.inScale + E.cam.inPanY));
    E.setTool("pen"); E.setWidth(16);
    E.pointerDown(400, 200); E.pointerMove(400, 300); E.pointerMove(400, 400); E.pointerUp(); E.flushBakes();
    const id = E.doc.list("0")[0].id;
    for (let i = 0; i < 3 * levels; i++) E.zoomFactorAt(400, 250, 16);
    for (let i = 0; i < extra; i++) E.zoomFactorAt(400, 250, 2);
    E._render();
    return { E, id };
}
function erase(E, y) {
    E.setEraserSize(24); E.setTool("erasePartial");
    E.pointerDown(380, y); E.pointerMove(400, y); E.pointerMove(420, y); E.pointerUp();
    E.flushBakes(); E.flushErases(); E._render();
}

describe("F129 an erase two or more crossings under ink homed in the next cell", () => {
    test.each([[3, 0], [2, 7]])("SB-1 %i crossings (and %i zoom-ins of 2): the band is cut", (levels, extra) => {
        const { E, id } = scene(levels, extra);
        const home = E.doc.getById(id).level;
        expect(E.lm.framePath(home, E.cam.frame).up.length).toBeGreaterThan(0);   // the case: across the home's edge
        expect(E._hitTest(400, 250, 0)).not.toBeNull();
        erase(E, 250);
        expect(E._eraseStrokes().length).toBe(0);
        expect(E._hitTest(400, 250, 0)).toBeNull();                               // red before: the ink shows again
    });
});
