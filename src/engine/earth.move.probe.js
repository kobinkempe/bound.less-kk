/**
 * earth.move.probe.js - Kobin's 2026-09-22 report, reproduced in jsdom.
 *
 * "I moved the Earth with the select tool and the houses that sit on it disappeared;
 * undo brings them back."  It loads the real 64 MB Magnum Opus at its saved camera,
 * lassoes the disc (which ENCLOSES the deep frames the houses live in, so the drag takes
 * the O(1) subtree path), drags it, and counts the render list PER HOME FRAME after every
 * step, so a whole frame that stops being drawn shows up as a number.
 *
 * A probe, not a suite: `*.probe.js` is excluded from test:quick / test:slow.
 * Run it (it needs the heap and the real file):
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false
 *     --testMatch "**\/earth.move.probe.js"
 */
import KobinEngine from "./KobinEngine";

const fs = require("fs");
const FILE = "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";

jest.setTimeout(30 * 60 * 1000);

const hosts = [];
function mkEngine(w, h, raster) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster });
    hosts.push({ E, host });
    return E;
}
afterAll(() => {
    while (hosts.length) { const x = hosts.pop(); try { x.E.destroy(); } catch (e) { /* torn down */ } x.host.remove(); }
});

let RAW = null;
const readRaw = () => (RAW || (RAW = JSON.parse(fs.readFileSync(FILE, "utf8"))));

/** The render list grouped by the HOME frame of each piece's native. */
function byHome(E) {
    const m = new Map();
    for (const o of E._lastList) {
        const rec = E.doc.getById(o.id);
        const k = rec ? rec.level : "(gone)";
        m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
}
const showMap = (m) => [...m.entries()].sort().map(([k, n]) => "   " + n + "  " + k).join("\n");
function diffMaps(a, b) {
    const keys = new Set([...a.keys(), ...b.keys()]);
    const out = [];
    for (const k of [...keys].sort()) {
        const x = a.get(k) || 0, y = b.get(k) || 0;
        if (x !== y) out.push("   " + k + ": " + x + " -> " + y);
    }
    return out.join("\n") || "   (no change)";
}

function load(E) {
    const t0 = Date.now();
    E.loadDrawing(readRaw());
    // eslint-disable-next-line no-console
    console.log("loaded in " + (Date.now() - t0) + " ms; frame=" + E.cam.frame + " level=" + E.cam.activeLevel
        + " inScale=" + E.cam.inScale + " pan=" + E.cam.inPanX + "," + E.cam.inPanY);
    E._render();
    return E;
}

/** The loop the tests draw round the pale-blue disc. */
function lassoDisc(E, cx = 600, cy = 330, r = 330) {
    E.setTool("select");
    const loop = [];
    for (let k = 0; k <= 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        loop.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    E.pointerDown(loop[0][0], loop[0][1]);
    for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
    return E.selection;
}

describe("Earth move - the houses vanish", () => {
    // The five tests that open the real 64 MB drawing cost ~35 s each to load; they run only
    // with EARTH_FULL=1 so the synthetic reproduction (G/H/I/J/L, under 4 s in all) is the default.
    const bigTest = process.env.EARTH_FULL ? test : test.skip;

    bigTest("A - load at the saved camera and describe what is drawn", () => {
        const W = 1512, H = 857;
        const E = mkEngine(W, H, false);
        load(E);
        // eslint-disable-next-line no-console
        console.log("list " + E._lastList.length + " pieces, by home frame:\n" + showMap(byHome(E)));
        for (const [sx, sy] of [[W / 2, H / 2], [W / 4, H / 2], [W / 2, H / 4], [(3 * W) / 4, (3 * H) / 4]]) {
            const id = E._hitTest(sx, sy);
            const rec = id != null ? E.doc.getById(id) : null;
            // eslint-disable-next-line no-console
            console.log("hit at " + sx + "," + sy + " -> id " + id + (rec ? " home " + rec.level + " color " + rec.obj.color : ""));
        }
        expect(E._lastList.length).toBeGreaterThan(0);
    });

    bigTest("B - TAP the disc and drag it (the per-object path): nothing is lost", () => {
        const W = 1512, H = 857;
        const E = mkEngine(W, H, false);
        load(E);
        const before = byHome(E);
        E.setTool("select");
        E.pointerDown(W / 2, H / 2);
        E.pointerUp();
        const sel = E.selection;
        // eslint-disable-next-line no-console
        console.log("tap selection: ids=" + (sel ? sel.ids.length : 0) + " frames=" + JSON.stringify(sel ? sel.frames : null));
        E.pointerDown(W / 2, H / 2);
        for (const [dx, dy] of [[60, 20], [140, 45], [220, 70], [300, 90]]) E.pointerMove(W / 2 + dx, H / 2 + dy);
        E.pointerUp();
        E._render();
        // eslint-disable-next-line no-console
        console.log("after a tap-drag:\n" + diffMaps(before, byHome(E)));
        expect(E._lastList.length).toBeGreaterThan(0);
    });

    bigTest("E - LASSO the disc and drag: the subtree's natives leave the render list", () => {
        const W = 1512, H = 857;
        const E = mkEngine(W, H, false);
        load(E);
        const before = byHome(E);
        const homes0 = new Map(E.doc.levels().map((k) => [k, E.doc.count(k)]));
        const sel = lassoDisc(E);
        // eslint-disable-next-line no-console
        console.log("lasso selection: ids=" + sel.ids.length + " frames=" + JSON.stringify(sel.frames));
        const FR = [...sel.frames];
        const probe = (tag) => {
            const lines = [];
            for (const f of FR) {
                const fr = E.lm.frame(f);
                lines.push("   ..." + f.split("/").pop() + " addr=" + (fr ? fr.cell.i + "," + fr.cell.j : "-")
                    + " shift=" + JSON.stringify(fr ? fr.shift : null) + " count=" + E.doc.count(f));
            }
            const now = new Map(E.doc.levels().map((k) => [k, E.doc.count(k)]));
            const moved = [];
            for (const [k, n] of now) if ((homes0.get(k) || 0) !== n) moved.push("      " + k + ": " + (homes0.get(k) || 0) + " -> " + n);
            for (const [k, n] of homes0) if (!now.has(k)) moved.push("      " + k + ": " + n + " -> (frame forgotten)");
            // eslint-disable-next-line no-console
            console.log(tag + " list=" + E._lastList.length
                + "\n" + lines.join("\n")
                + "\n   doc counts changed:\n" + (moved.join("\n") || "      (none)")
                + "\n   render list diff:\n" + diffMaps(before, byHome(E)));
        };
        probe("after the lasso");
        const grab = [600, 370];
        E.pointerDown(grab[0], grab[1]);
        for (const [dx, dy] of [[40, 15], [80, 28], [120, 40], [160, 55], [200, 66], [240, 80]]) {
            E.pointerMove(grab[0] + dx, grab[1] + dy);
            probe("MOVE +" + dx + "," + dy);
            E._render();
            probe("   (a second render, nothing else)");
        }
        E.pointerUp();
        probe("PEN-UP");
        E._render();
        probe("PEN-UP + a render");
        expect(E._lastList.length).toBeGreaterThan(0);
    });

    bigTest("F - the same gesture, then the tile cache dropped: the natives come back", () => {
        const W = 1512, H = 857;
        const E = mkEngine(W, H, false);
        load(E);
        const before = byHome(E);
        const sel = lassoDisc(E);
        // eslint-disable-next-line no-console
        console.log("lasso selection: ids=" + sel.ids.length + " frames=" + sel.frames.length);
        const grab = [600, 370];
        E.pointerDown(grab[0], grab[1]);
        for (const [dx, dy] of [[40, 15], [120, 40], [240, 80]]) E.pointerMove(grab[0] + dx, grab[1] + dy);
        E.pointerUp();
        E._render();
        // eslint-disable-next-line no-console
        console.log("after the drag, list=" + E._lastList.length + "\n" + diffMaps(before, byHome(E)));
        // Where the carried natives live now, and whether the camera frame's own down tiles hold them.
        const lost = [];
        for (const k of E.doc.levels()) {
            if (!k.startsWith(E.cam.frame + "/")) continue;
            const drawn = byHome(E).get(k) || 0;
            if (E.doc.count(k) && !drawn) lost.push(k + " count=" + E.doc.count(k) + " drawn=0");
        }
        // eslint-disable-next-line no-console
        console.log("frames holding natives that are drawn nowhere:\n   " + (lost.join("\n   ") || "(none)"));
        const afterDrag = E._lastList.length;
        // The ONE thing that changes: the cache.
        E.store.bumpEpoch();
        E._render();
        // eslint-disable-next-line no-console
        console.log("after store.bumpEpoch() + render, list=" + E._lastList.length + "\n" + diffMaps(before, byHome(E)));
        // THE INVARIANT: what the cache serves is what a fresh bake gives. Red today (13,469 vs 15,192).
        expect(afterDrag).toBe(E._lastList.length);
    });

    /**
     * The whole report in five lines of document: two natives in ONE child frame of the
     * camera's own frame, lassoed (the frame is enclosed, so the drag takes the O(1) subtree
     * path) and dragged far enough that the settle's carry re-homes them to the neighbour cell.
     * `drags` are screen dx; at inScale 1 a pixel is a level-0 unit and the frame's `rest` is
     * (dx mod 32) * 4096, so 17 or more crosses HALF_W (65,536) on its own.
     */
    function synthetic(E, { below = null, drags = [20, 60, 113], tag = "", bump = true } = {}) {
        const kid = E.lm.cellChild("0", 3, 2);
        const S = 8000;
        const mkFill = (id, ox, oy) => ({
            type: "fill", origin: "native", id, z: id, color: "#c33", opacity: 1,
            polys: [[[ox, oy], [ox + S, oy], [ox + S, oy + S], [ox, oy + S]]],
            ...(below ? { below: below.map((e) => [e[0], e[1]]) } : null),
        });
        E.doc.add(mkFill(E.doc.allocId(), -S / 2, -S / 2), kid.id);
        E.doc.add(mkFill(E.doc.allocId(), S, S), kid.id);
        E._render();
        const before = byHome(E);
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        E.setTool("select");
        // REACH / R = 196608 / 4096 = 48 frame units, so the loop must clear 48*sqrt(2) = 68.
        const loop = [];
        for (let k = 0; k <= 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            loop.push([org[0] + 110 * Math.cos(a), org[1] + 110 * Math.sin(a)]);
        }
        E.pointerDown(loop[0][0], loop[0][1]);
        for (const p of loop.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        const sel = E.selection;
        // eslint-disable-next-line no-console
        console.log(tag + " before=" + showMap(before).trim() + "; lasso ids=" + (sel ? sel.ids.length : 0)
            + " frames=" + JSON.stringify(sel ? sel.frames : null));
        if (!sel || !sel.frames.length) return { ok: false, why: "the lasso took no frame" };
        E.pointerDown(org[0], org[1]);
        for (const dx of drags) {
            E.pointerMove(org[0] + dx, org[1]);
            const fr = E.lm.frame(sel.frames[0]);
            // eslint-disable-next-line no-console
            console.log(tag + "   drag +" + dx + ": addr=" + fr.cell.i + "," + fr.cell.j
                + " shift=" + JSON.stringify(fr.shift) + " count=" + E.doc.count(sel.frames[0])
                + " list=" + E._lastList.length);
        }
        E.pointerUp();
        E._render();
        const after = byHome(E);
        const held = E.doc.levels().reduce((n, k) => n + E.doc.count(k), 0);
        // eslint-disable-next-line no-console
        console.log(tag + " after pen-up: list=" + E._lastList.length + " natives held=" + held
            + " frames=" + JSON.stringify(E.doc.levels().map((k) => k + ":" + E.doc.count(k)))
            + "\n" + diffMaps(before, after));
        const drawnIds = [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
        let freshIds = drawnIds;
        if (bump) {
            E.store.bumpEpoch(); E._render();
            freshIds = [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
            // eslint-disable-next-line no-console
            console.log(tag + " after store.bumpEpoch(): list=" + E._lastList.length);
        }
        const docIds = [];
        for (const k of E.doc.levels()) for (const o of E.doc.list(k)) docIds.push(o.id);
        docIds.sort((a, b) => a - b);
        return { ok: true, drawn: after, held, drawnIds, freshIds, docIds };
    }

    /**
     * The fix under test, applied from outside: a tile whose bake ran across a document
     * change is not cached as if it were current - it is dropped and baked again.
     * `Document.rev` bumps on every emit, so a settle inside `at()` is exactly what it sees.
     */
    function revGuard(store) {
        for (const name of ["_ensureUp", "_ensureDown"]) {
            const orig = store[name].bind(store);
            store[name] = (F, i, j) => {
                let tile = null;
                for (let k = 0; k < 3; k++) {
                    const rev = store.doc.rev;
                    tile = orig(F, i, j);
                    if (store.doc.rev === rev) return tile;
                    store.cache.delete(tile.level + "|" + tile.dir + "|" + i + "," + j);
                }
                return tile;
            };
        }
    }

    test("L - SYNTHETIC, instrumented: the settle fires INSIDE the down bake", () => {
        const E = mkEngine(800, 600, false);
        const store = E.store;
        const bake = store._bakeDown.bind(store);
        store._bakeDown = (F, i, j) => {
            const rev0 = store.doc.rev;
            const inCache = store.cache.has(F + "|down|" + i + "," + j);
            const objs = bake(F, i, j);
            if (store.doc.rev !== rev0) {
                // eslint-disable-next-line no-console
                console.log("[L] _bakeDown(" + F + "," + i + "," + j + "): doc.rev " + rev0 + " -> " + store.doc.rev
                    + " DURING the bake; the tile was in the cache: " + inCache
                    + "; pieces baked: " + objs.length);
            }
            return objs;
        };
        const addObj = store._addObject.bind(store);
        store._addObject = (o, H) => {
            // eslint-disable-next-line no-console
            console.log("[L] _addObject(id " + o.id + ", frame " + H + ") with " + store.cache.size + " tiles in the cache");
            return addObj(o, H);
        };
        const r = synthetic(E, { tag: "[L]" });
        expect(r.ok).toBe(true);
    });

    // Superseded by F78's fix (nothing is lost, so there is nothing for undo to bring back);
    // `move.settle.test.js` covers undo and redo on both renderers.
    test.skip("M - SYNTHETIC: undo brings them back, as Kobin reports", () => {
        const E = mkEngine(800, 600, false);
        // No bumpEpoch: the wrong cached picture is left standing, and undo has to repair it.
        const r = synthetic(E, { tag: "[M]", bump: false });
        expect(r.ok).toBe(true);
        expect(r.drawnIds).toEqual([]);            // the loss, still on screen
        E.undo(); E._render();
        const afterUndo = [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
        // eslint-disable-next-line no-console
        console.log("[M] after undo: list=" + E._lastList.length + " ids=" + JSON.stringify(afterUndo)
            + " frames=" + JSON.stringify(E.doc.levels().map((k) => k + ":" + E.doc.count(k))));
        E.redo(); E._render();
        const afterRedo = [...new Set(E._lastList.map((o) => o.id))].sort((a, b) => a - b);
        // eslint-disable-next-line no-console
        console.log("[M] after redo: list=" + E._lastList.length + " ids=" + JSON.stringify(afterRedo)
            + " frames=" + JSON.stringify(E.doc.levels().map((k) => k + ":" + E.doc.count(k))));
        expect(afterUndo).toEqual(r.docIds);
    });

    test("G - SYNTHETIC: one child-frame, a big rest, the natives vanish", () => {
        const E = mkEngine(800, 600, false);
        const r = synthetic(E, { tag: "[G]" });
        expect(r.ok).toBe(true);
        // THE INVARIANT: everything the document holds inside the view is drawn. Red today.
        expect(r.drawnIds).toEqual(r.docIds);
    });

    test("H - SYNTHETIC: a SMALL rest and a table near the cell edge still loses them", () => {
        const E = mkEngine(800, 600, false);
        // below[0] is inside [-HALF_W, HALF_W) as the design requires; one 33 px drag adds
        // rest = 4096 and tips it over, so normalising the frame's shift would not help.
        const r = synthetic(E, { below: [[62000, 0]], drags: [12, 33], tag: "[H]" });
        expect(r.ok).toBe(true);
        expect(r.drawnIds).toEqual(r.docIds);
    });

    test("I - SYNTHETIC on the RASTER engine: the same list, the same loss", () => {
        const E = mkEngine(800, 600, true);
        const r = synthetic(E, { tag: "[I raster]" });
        expect(r.ok).toBe(true);
        expect(r.drawnIds).toEqual(r.docIds);
    });

    test("J - SYNTHETIC with the rev guard on the tile store: nothing is lost", () => {
        const E = mkEngine(800, 600, false);
        revGuard(E.store);
        const r = synthetic(E, { tag: "[J guarded]" });
        expect(r.ok).toBe(true);
        expect(r.drawnIds).toEqual(r.docIds);
        expect(r.drawnIds).toEqual(r.freshIds);
    });

    bigTest("K - the REAL drawing with the rev guard: nothing is lost", () => {
        const W = 1512, H = 857;
        const E = mkEngine(W, H, false);
        load(E);
        revGuard(E.store);
        const before = byHome(E);
        const sel = lassoDisc(E);
        // eslint-disable-next-line no-console
        console.log("[K] lasso ids=" + sel.ids.length + " frames=" + sel.frames.length);
        const grab = [600, 370];
        E.pointerDown(grab[0], grab[1]);
        for (const [dx, dy] of [[40, 15], [120, 40], [240, 80]]) E.pointerMove(grab[0] + dx, grab[1] + dy);
        E.pointerUp();
        E._render();
        // eslint-disable-next-line no-console
        console.log("[K] after the drag, list=" + E._lastList.length + "\n" + diffMaps(before, byHome(E)));
        const afterDrag = E._lastList.length;
        E.store.bumpEpoch(); E._render();
        // eslint-disable-next-line no-console
        console.log("[K] after bumpEpoch, list=" + E._lastList.length + "\n" + diffMaps(before, byHome(E)));
        expect(afterDrag).toBe(E._lastList.length);
    });
});

/**
 * Kobin's SECOND recreation (2026-09-22 ~18:30Z, `__fixtures__/earth-move-2.json`): the exact
 * selection he dragged — 1,884 natives of the region frame plus two stray natives at coarser
 * levels, and NO frame — replayed at his camera with his snapped displacement. The city sits on
 * the region; a selection without the city frame moves the region and leaves the city stack.
 */
describe("Earth move 2 - the selection held no frame", () => {
    const FX = require("./__fixtures__/earth-move-2.json");
    const ids = [];
    for (const r of FX.selection.runs) { if (Array.isArray(r)) { for (let i = r[0]; i <= r[1]; i++) ids.push(i); } else ids.push(r); }
    const bigTest = process.env.EARTH_FULL ? test : test.skip;
    const union = (a, b) => (!a ? b : !b ? a : { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
    const boxOf = (o) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const L of o.loops || []) for (const seg of L) for (const q of [seg.A, seg.B]) {
            if (!q) continue;
            x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        }
        return { left: x0, top: y0, right: x1, bottom: y1 };
    };
    /** A frame's natives' drawn box in `P`'s units; `only` limits it to ids; tables with a k>0 entry skipped (one outlier inflates the union). */
    const drawnBox = (E, P, only) => {
        let out = null;
        for (const id of only) {
            const rec = E.doc.getById(id);
            if (!rec || (rec.obj.below || []).length > 1) continue;
            out = union(out, E.lm.mapRectObj(boxOf(rec.obj), rec.level, P, rec.obj.below || undefined, rec.level, false));
        }
        return out;
    };
    const inside = (a, b) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
    /** `_beginSelectDrag`'s state, then ONE step by the fixture's displacement, then pen-up. */
    const drag = (E) => {
        const s = E.cam.inScale, [dx, dy] = FX.displacement;
        E._dragSel = { start: [0, 0], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
        E.store.setBatch(true);
        E._beginHold();
        E._dragSelection(dx * s, dy * s);
        E._pointerUp();
    };

    bigTest("N+O - REAL: his selection alone leaves the city; with the city frame the city is carried, registered", () => {
        // One load (two ran jsdom out of a 10 GB heap) and a small viewport: the camera's zoom and
        // the displacement are what matter, not the screen size.
        const E = load(mkEngine(400, 240, false));
        E.cam.set(FX.camera); E._render();
        const P = FX.camera.frame;
        const region = ids.filter((id) => { const r = E.doc.getById(id); return r && r.level === FX.regionFrame; });
        expect(region.length).toBe(1884);
        const cityIds = E.doc.list(FX.cityFrame).map((o) => o.id);
        const cityBefore = drawnBox(E, P, cityIds), regionBefore = drawnBox(E, P, region);
        expect(inside(cityBefore, regionBefore)).toBe(true);           // the city sits on the region
        // N: his selection, no frame
        E._setSelection(ids, []);
        drag(E);
        let top = E.doc._undo[E.doc._undo.length - 1];
        // eslint-disable-next-line no-console
        console.log("[N] op=" + top.op + " moves=" + (top.moves || []).length + " frames=" + ((top.frames || []).length));
        expect(top.op).toBe("moveMany");
        let regionAfter = drawnBox(E, P, region), cityAfter = drawnBox(E, P, cityIds);
        expect(E.lm.frame(FX.cityFrame).parent).toBe(FX.regionFrame);  // the city frame did not move
        expect(cityAfter.left).toBeCloseTo(cityBefore.left, 6);
        expect(regionAfter.left - regionBefore.left).toBeCloseTo(FX.displacement[0], 3);
        expect(inside(cityAfter, regionAfter)).toBe(false);             // Kobin's "the houses disappeared"
        E.undo();
        expect(inside(drawnBox(E, P, cityIds), drawnBox(E, P, region))).toBe(true);   // and undo "brings them back"
        // O: the same selection WITH the city frame
        E._setSelection(ids, [FX.cityFrame]);
        drag(E);
        top = E.doc._undo[E.doc._undo.length - 1];
        // eslint-disable-next-line no-console
        console.log("[O] op=" + top.op + " moves=" + (top.moves || []).length + " frames=" + ((top.frames || []).length));
        expect(top.op).toBe("moveFrames");
        E.doc.at(FX.cityFrame);                                        // a moved frame's shift settles at its first read
        regionAfter = drawnBox(E, P, region); cityAfter = drawnBox(E, P, cityIds);
        // eslint-disable-next-line no-console
        console.log("[O] city moved by " + (cityAfter.left - cityBefore.left) + "," + (cityAfter.top - cityBefore.top)
            + "; region by " + (regionAfter.left - regionBefore.left) + "," + (regionAfter.top - regionBefore.top));
        expect(cityAfter.left - cityBefore.left).toBeCloseTo(regionAfter.left - regionBefore.left, 6);
        expect(cityAfter.top - cityBefore.top).toBeCloseTo(regionAfter.top - regionBefore.top, 6);
        expect(inside(cityAfter, regionAfter)).toBe(true);
    });
});
