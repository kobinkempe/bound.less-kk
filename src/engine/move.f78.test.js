/**
 * OPEN-FLAGS F78: a lasso over the Earth encloses a frame one level deeper than the camera
 * (48 frame units, ~3 screen px), the drag re-addresses it and leaves a shift. Until A1 C1 the
 * next bake's `Document.at` settled that shift and carried natives to the neighbour cell WHILE the
 * tile was being baked, so the tile was cached empty and the houses vanished (Kobin, 2026-09-22,
 * `.claude/EARTH-MOVE-ANALYSIS.md`). The shift now stays on the frame and no read moves a native;
 * these are the picture's checks.
 */
import KobinEngine from "./KobinEngine";

const hosts = [];
function mkE(raster) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 800, height: 600, raster });
    hosts.push({ E, host });
    return E;
}
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

const S = 8000;
const mkFill = (E, ox, oy, below) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1,
    polys: [[[ox, oy], [ox + S, oy], [ox + S, oy + S], [ox, oy + S]]],
    ...(below ? { below: below.map((e) => [e[0], e[1]]) } : null),
});
const drawnIds = (E) => [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
const docIds = (E) => { const out = []; for (const k of E.doc.levels()) for (const o of E.doc.list(k)) out.push(o.id); return out.sort((a, b) => a - b); };

/**
 * Two natives in ONE child frame of the camera's frame, lassoed (the frame is enclosed, so the
 * drag takes the subtree path) and dragged far enough that the settle's carry re-homes them.
 * At inScale 1 a pixel is a level-0 unit and the frame's rest is (dx mod 32) · 4096, so 17 px
 * crosses HALF_W (65,536) on its own.
 */
function lassoAndDrag(E, { below = null, drags = [20, 60, 113] } = {}) {
    const kid = E.lm.cellChild("0", 3, 2);
    E.doc.add(mkFill(E, -S / 2, -S / 2, below), kid.id);
    E.doc.add(mkFill(E, S, S, below), kid.id);
    E._render();
    const org = E.cam.levelPointToScreen(kid.id, 0, 0);
    E.setTool("select");
    const loop = [];                                   // REACH / R = 48 units; the loop clears 48·√2
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]); }
    E.pointerDown(loop[0][0], loop[0][1]);
    for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
    expect(E.selection && E.selection.frames.length).toBe(1);   // the frame is taken whole
    E.pointerDown(org[0], org[1]);
    for (const dx of drags) E.pointerMove(org[0] + dx, org[1]);
    E.pointerUp();
    E._render();
}

describe("F78 — a lasso-dragged child frame keeps its natives drawn", () => {
    test("SVG: after the drag the render list holds every native the document holds, and equals a fresh bake", () => {
        const E = mkE(false);
        lassoAndDrag(E);
        expect(drawnIds(E)).toEqual(docIds(E));
        const drawn = drawnIds(E);
        E.store.bumpEpoch(); E._render();
        expect(drawnIds(E)).toEqual(drawn);                // the cached tile IS the fresh bake
    });

    test("SVG: a small rest with a table near the cell edge is drawn a cell over, and is kept", () => {
        const E = mkE(false);
        lassoAndDrag(E, { below: [[62000, 0]], drags: [12, 33] });
        expect(drawnIds(E)).toEqual(docIds(E));
    });

    test("raster: the same list, nothing lost", () => {
        const E = mkE(true);
        lassoAndDrag(E);
        expect(drawnIds(E)).toEqual(docIds(E));
    });

    test("undo brings the frame home and the natives stay drawn; redo takes them with it", () => {
        const E = mkE(false);
        lassoAndDrag(E);
        E.undo();
        expect(drawnIds(E)).toEqual(docIds(E));
        E.redo();
        expect(drawnIds(E)).toEqual(docIds(E));
    });
});
