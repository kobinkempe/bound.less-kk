/**
 * F126 (REVIEWER-3 MOVE-2, lane seed 2208): a frame lassoed from far out and dragged away leaves its
 * cell; zooming back in there, the camera mints an empty twin in the vacated cell and sits in it.
 * The undo puts the frame back, the twin becomes its shadow and merges into it on the next read, and
 * the camera was left on the merged-away frame: the canvas drew nothing, and the next stroke went
 * into a frame the lattice no longer had. The camera follows the merge.
 */
import KobinEngine from "./KobinEngine";

const hosts = [];
function mk() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, scenes: false });
    hosts.push({ E, host });
    return E;
}
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

const zoomN = (E, x, y, f, n) => { for (let i = 0; i < n; i++) E.zoomFactorAt(x, y, f); };
const dot = (E, x, y, w) => { E.setTool("pen"); E.setWidth(w); E.pointerDown(x, y); E.pointerUp(); E.flushBakes(); };
const LOOP = [[614, 61], [513, 136], [269, 167], [25, 136], [-76, 61], [25, -14], [269, -45], [513, -14], [614, 61]];

/** The dot, the frame lassoed two levels out and dragged away, the camera back in its old cell. */
function scene() {
    const E = mk();
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
    expect(E.doc._undo[E.doc._undo.length - 1].op).toBe("moveFrames");
    zoomN(E, 582, 71, 16, 6);
    return E;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("F126 an undo that merges the camera's frame away", () => {
    test("CM-1 the camera follows the merge: the view draws, the dot is hit, a new stroke has a frame", async () => {
        const E = scene();
        const twin = E.cam.frame;
        expect(twin).not.toBe("0");                               // the case: the camera sits in the vacated cell's twin
        E.undo();
        await settle();
        expect(E.lm.frame(E.cam.frame)).toBeTruthy();             // red before: the camera's frame is gone
        E._render();
        expect(E._lastList.filter((o) => !o.erase).length).toBeGreaterThan(0);
        dot(E, 109, 217, 2);
        const arr = [];
        for (const L of E.doc.levels()) for (const o of E.doc.list(L)) arr.push(L);
        for (const L of arr) expect(E.lm.frame(L)).toBeTruthy();  // red before: the new dot homed in "0#2", which no frame holds
    });

    test("CM-2 control: the same undo with the camera a level out stays in its own frame", async () => {
        const E = scene();
        const twin = E.cam.frame;
        zoomN(E, 582, 71, 1 / 16, 3);
        const cam = E.cam.frame;
        expect(cam).not.toBe(twin);
        E.undo();
        await settle();
        expect(E.cam.frame).toBe(cam);
        expect(E.lm.frame(cam)).toBeTruthy();
    });
});
