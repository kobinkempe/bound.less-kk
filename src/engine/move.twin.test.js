/**
 * OPEN-FLAGS F80's neighbour, Kobin 2026-09-22 on the Magnum Opus: a lasso moves a subtree
 * away, the camera crosses into the cells it vacated (which mints `#2` twins along the chain,
 * `LevelMap._childId`), then undo brings the movers back into the twins' cells, where they stay
 * co-residents, level after level — an empty twin with no kids yielding its cell, the camera
 * handed on (A1 C3: no merge). The picture at the camera must equal a fresh bake at every step;
 * his city frame's down tile stayed stale and the houses vanished.
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
const mkFill = (E, ox, oy) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1,
    polys: [[[ox, oy], [ox + S, oy], [ox + S, oy + S], [ox, oy + S]]],
});
const drawnIds = (E) => [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
const docIds = (E) => { const out = []; for (const k of E.doc.levels()) for (const o of E.doc.list(k)) out.push(o.id); return out.sort((a, b) => a - b); };
const G = 32;   // a cell in its parent's units

/** The camera one level into `frameId` with cell (i, j) filling the view: the child's content at ~15 px. */
function lookAt(E, frameId, i, j) {
    const s = 8;
    E.cam.set({ frame: frameId, activeLevel: E.lm.depthOf(frameId), inScale: s, inPanX: 400 - i * G * s, inPanY: 300 - j * G * s });
    E.cam._maybeCross();
    E._render();
}
/** Cross INTO cell (i, j) of the camera's frame by zooming past `enter` at its centre: mints the cell if it is vacant. */
function crossInto(E, i, j) {
    const s = E.cfg.enter * 1.5;
    E.cam.set({ frame: E.cam.frame, activeLevel: E.cam.activeLevel, inScale: s, inPanX: 400 - i * G * s, inPanY: 300 - j * G * s });
    E.cam._maybeCross();
    E._render();
    return E.cam.frame;
}

/**
 * Kid `0/3,2` holds two natives; its grandchild `0/3,2/5,5` holds one (the houses). A lasso at
 * level 0 encloses the kid (REACH / R = 48 units; the loop clears 48·√2) and a 113 px drag
 * moves it whole (`0/3,2` → about `0/6,2` with a shift); the grandchild follows by parent.
 */
function setupAndMove(E) {
    const kid = E.lm.cellChild("0", 3, 2);
    const grand = E.lm.cellChild(kid.id, 5, 5);
    E.doc.add(mkFill(E, -S / 2, -S / 2), kid.id);
    E.doc.add(mkFill(E, S, S), kid.id);
    E.doc.add(mkFill(E, -S / 2, -S / 2), grand.id);
    E._render();
    const org = E.cam.levelPointToScreen(kid.id, 0, 0);
    E.setTool("select");
    const loop = [];
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]); }
    E.pointerDown(loop[0][0], loop[0][1]);
    for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
    expect(E.selection && E.selection.frames).toEqual([kid.id]);
    E.pointerDown(org[0], org[1]);
    for (const dx of [20, 60, 113]) E.pointerMove(org[0] + dx, org[1]);
    E.pointerUp();
    E._render();
    expect(E.lm.frame(kid.id).cell.i).not.toBe(3);   // the kid has moved cell
    return { kid, grand };
}

describe.each([["SVG", false], ["raster", true]])("a subtree move, a crossing into the vacated chain, then undo (%s)", (name, raster) => {
    test("the camera inside the twin chain sees the returned content, tile for tile equal to a fresh bake", () => {
        const E = mkE(raster);
        const { kid, grand } = setupAndMove(E);
        // The camera crosses into the vacated cell (3, 2), then into ITS cell (5, 5): two twins.
        const twin = crossInto(E, 3, 2);
        expect(twin).toBe("0/3,2#2");
        const twinKid = crossInto(E, 5, 5);
        expect(twinKid).toBe("0/3,2#2/5,5");
        const houses = E.doc.list(grand.id)[0].id;
        // Look at the twin with the vacated houses' cell in view: nothing there yet, and that
        // emptiness is now a cached down tile of the twin.
        lookAt(E, twin, 5, 5);
        expect(drawnIds(E)).toEqual([]);
        // Undo: the kid comes back to (3, 2), the twin's co-resident (the twin has a kid, so it keeps
        // the cell); the grandchild follows and takes its empty twin's cell. The picture at the
        // camera must be the fresh one.
        E.undo();
        E._render();
        const seen = drawnIds(E);
        E.store.bumpEpoch(); E._render();
        expect(seen).toEqual(drawnIds(E));                  // red when the stale tile survives the undo
        expect(drawnIds(E)).toEqual(docIds(E));             // the two kid natives and the houses, all drawn
        expect(E.lm.frame(kid.id).shadowOf).toBe(twin);        // no merge: every frame keeps its identity
        expect([E.lm.frame(grand.id).parent, E.lm.frame(grand.id).shadowOf]).toEqual([kid.id, null]);
        expect(E.lm.frame(twinKid).shadowOf).toBe(grand.id);    // the empty twin yielded its cell
        expect(E.doc.getById(houses).level).toBe(grand.id);
        expect(E.doc.count(kid.id)).toBe(2);
    });

    test("a four-deep chain with the camera at the deepest twin: the chain returns as co-residents, the camera handed on, the picture the fresh one", () => {
        const E = mkE(raster);
        // Natives at every level of a four-deep chain under the kid; Kobin's Earth, continent,
        // city and houses.
        const kid = E.lm.cellChild("0", 3, 2);
        const c2 = E.lm.cellChild(kid.id, 5, 5);
        const c3 = E.lm.cellChild(c2.id, 7, 7);
        const c4 = E.lm.cellChild(c3.id, 9, 9);
        E.doc.add(mkFill(E, -S / 2, -S / 2), kid.id);
        E.doc.add(mkFill(E, -S / 2, -S / 2), c2.id);
        E.doc.add(mkFill(E, -S / 2, -S / 2), c3.id);
        E.doc.add(mkFill(E, -S / 2, -S / 2), c4.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        E.setTool("select");
        const loop = [];
        for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]); }
        E.pointerDown(loop[0][0], loop[0][1]);
        for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        expect(E.selection && E.selection.frames).toEqual([kid.id]);
        E.pointerDown(org[0], org[1]);
        for (const dx of [20, 60, 113]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        E._render();
        // The camera crosses into the vacated chain three levels deep: three empty twins.
        expect(crossInto(E, 3, 2)).toBe("0/3,2#2");
        expect(crossInto(E, 5, 5)).toBe("0/3,2#2/5,5");
        expect(crossInto(E, 7, 7)).toBe("0/3,2#2/5,5/7,7");
        lookAt(E, "0/3,2#2/5,5/7,7", 9, 9);
        expect(drawnIds(E)).toEqual([]);
        E.undo();
        E._render();
        const seen = drawnIds(E);
        E.store.bumpEpoch(); E._render();
        expect(seen).toEqual(drawnIds(E));
        // The deepest twin, empty and childless, yields its cell to the city (c3): the camera is handed to it,
        // and from there the city's own natives and the houses one level down are drawn.
        expect(E.cam.frame).toBe(c3.id);
        expect(E.lm.frame("0/3,2#2/5,5/7,7").shadowOf).toBe(c3.id);
        expect(drawnIds(E)).toEqual(expect.arrayContaining([E.doc.list(c3.id)[0].id, E.doc.list(c4.id)[0].id]));
        expect(E.lm.frame(c4.id).parent).toBe(c3.id);
    });

    test("with the camera at level 0 above the chain, the undo restores the picture too", () => {
        const E = mkE(raster);
        setupAndMove(E);
        crossInto(E, 3, 2);
        crossInto(E, 5, 5);
        E.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: 400, inPanY: 300 });
        E.cam._maybeCross();
        E._render();
        E.undo();
        E._render();
        const seen = drawnIds(E);
        E.store.bumpEpoch(); E._render();
        expect(seen).toEqual(drawnIds(E));
    });
});
