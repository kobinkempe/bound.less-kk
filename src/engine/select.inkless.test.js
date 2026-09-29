/**
 * A selection stands for ink (Kobin's phone report 2026-09-23 08-16-23: "I zoomed out ... tried
 * selecting everything with a lasso, and got some weird results"). His drawing held 26 natives in
 * 8 frames of a 495-frame lattice — 471 empty containers the camera and earlier subtree drags had
 * minted — and the selection held 4 ids and 50 of those empty frames, each drawn as a dot on blank
 * paper. Replayed on his drawing, a lasso and a drag also lost the ink: the drop's settle carried
 * the selected frames' natives into the neighbour cells, and the selection kept the emptied frames.
 * Since A1 C1 no settle or read moves a native: a frame's shift stays its placement.
 *
 * The rules: the lasso never takes a frame with no native in its subtree; a native whose picture a
 * frame's shift carries past the cell stays the frame's (selected once, never an id as well); a kid
 * a drag's rest tears off stays selected; a merge hands the selection only the kids that hold ink.
 */
import KobinEngine from "./KobinEngine";
import { rasterWorkerReport, resetRasterWorkerClient, setRasterWorkerCount } from "./raster/rasterWorkerClient";
import * as rasterPerf from "./raster/rasterPerf";

const hosts = [];
function mkE(w = 800, h = 600, raster = false) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: w, height: h, raster });
    E.cam.inPanX = w / 2; E.cam.inPanY = h / 2;          // frame 0's origin at the screen's centre
    hosts.push({ E, host });
    return E;
}
afterEach(() => { while (hosts.length) { const h = hosts.pop(); try { h.E.destroy(); } catch (e) { /* torn down */ } h.host.remove(); } });

const S = 8000;
const fill = (E, ox, oy, s = S, below = null) => ({
    type: "fill", origin: "native", id: E.doc.allocId(), color: "#c33", opacity: 1,
    polys: [[[ox, oy], [ox + s, oy], [ox + s, oy + s], [ox, oy + s]]],
    ...(below ? { below } : null),
});
// A frame's shift stays within half a frame (SUBTREE-O1-PLAN §2.2), so what crosses the cell edge is a
// native whose OWN table adds past it: 62,000 units (0.47 of a frame) plus a 12 px drag's 0.375.
const EDGE = [[62000, 0]];
/** Natives in a frame's whole subtree, shadows included. */
const inkUnder = (E, id) => { let n = 0; E.lm.walk(id, (f) => { n += E.doc.count(f.id); }); return n; };
const inkless = (E) => (E.selection ? E.selection.frames.filter((f) => !inkUnder(E, f)) : []);
function loop(E, pts) {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerMove(pts[0][0], pts[0][1]);
    E.pointerUp();
}
const circleLoop = (cx, cy, r) => { const out = []; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };
const screenLoop = (E, m = 10) => [[m, m], [E.width - m, m], [E.width - m, E.height - m], [m, E.height - m]]
    .flatMap((p, k, a) => { const q = a[(k + 1) % 4]; return [0, 1, 2, 3, 4, 5, 6, 7].map((t) => [p[0] + ((q[0] - p[0]) * t) / 8, p[1] + ((q[1] - p[1]) * t) / 8]); });

describe("a selection stands for ink", () => {
    test("I1 the lasso takes no frame without a native in its subtree", () => {
        const E = mkE();
        // Visited cells with nothing in them: what the camera's crossings and a subtree drag mint.
        for (const [i, j] of [[2, 1], [-3, -2], [5, -4], [-6, 3]]) E.lm.cellChild("0", i, j);
        const inked = E.lm.cellChild("0", 3, 2);
        E.doc.add(fill(E, -S / 2, -S / 2), inked.id);
        const holder = E.lm.cellChild("0", -4, 4);                  // empty itself, ink one level down
        const deep = E.lm.cellChild(holder.id, 7, -9);
        E.doc.add(fill(E, 0, 0), deep.id);
        E._render();
        loop(E, screenLoop(E));
        const s = E.selection;
        expect(s).toBeTruthy();
        expect(s.frames.sort()).toEqual([inked.id, holder.id].sort());   // red: the four empty cells too
        expect(inkless(E)).toEqual([]);
        expect(E._selectionStatus().count).toBe(2);
    });

    test("I2 a lasso around empty cells alone selects nothing", () => {
        const E = mkE();
        for (const [i, j] of [[2, 1], [3, 1], [2, 2]]) E.lm.cellChild("0", i, j);
        E._render();
        loop(E, screenLoop(E));
        expect(E.selection).toBeNull();                              // red: three frames, three marks
    });

    test("I3 natives whose pictures a frame's shift carries past its cell stay the frame's, and the next drag takes them", () => {
        const E = mkE();
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const b = E.doc.add(fill(E, S, S, S, EDGE), kid.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 110));
        expect(E.selection.frames).toEqual([kid.id]);             // the frame is taken whole
        // 12 px at inScale 1 = 0.375 of a cell: the frame keeps its cell and a shift of 0.375 W, which with
        // each native's own 0.47 puts both pictures in the next cell; they stay home (A1 C1).
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        E._render();
        expect([a, b].map((o) => E.doc.getById(o.id).level)).toEqual([kid.id, kid.id]);
        expect(E.selection.ids).toEqual([]);
        expect(E._isSelected(a.id) && E._isSelected(b.id)).toBe(true);
        expect(E._selectionStatus().count).toBe(2);
        expect(inkless(E)).toEqual([]);
        // The next drag moves them with the pointer.
        const before = [a, b].map((o) => E._rectInActive(E.doc.getById(o.id).obj, E.doc.getById(o.id).level));
        const at = E.cam.levelPointToScreen(E.cam.frame, (before[0].left + before[0].right) / 2, (before[0].top + before[0].bottom) / 2);
        E.pointerDown(at[0], at[1]);
        for (const dy of [10, 25, 40]) E.pointerMove(at[0], at[1] + dy);
        E.pointerUp();
        E._render();
        const after = [a, b].map((o) => E._rectInActive(E.doc.getById(o.id).obj, E.doc.getById(o.id).level));
        for (let k = 0; k < 2; k++) {
            expect((after[k].top - before[k].top) * E.cam.inScale).toBeCloseTo(40, 0);
            expect((after[k].left - before[k].left) * E.cam.inScale).toBeCloseTo(0, 0);
        }
        // Undo walks both drags back; nothing is selected twice.
        E.undo(); E.undo(); E._render();
        expect(E._isSelected(a.id) && E._isSelected(b.id)).toBe(true);
        expect(E.selection.ids.filter((id) => E._underFrames(E.doc.getById(id).level, E.selection.frames))).toEqual([]);
    });

    test("I5 a native whose picture crossed the cell edge is the frame's through undo and redo, never an id as well", () => {
        const E = mkE();
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const deep = E.lm.cellChild(kid.id, -1500, 5);
        E.doc.add(fill(E, 0, 0), deep.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 110));
        expect(E.selection.frames).toEqual([kid.id]);
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        E._render();
        expect(E.doc.getById(a.id).level).toBe(kid.id);           // home: its picture a cell over (A1 C1)
        expect(E.selection.ids).toEqual([]);
        expect(E.selection.frames).toEqual([kid.id]);
        E.undo(); E._render();
        expect(E._isSelected(a.id)).toBe(true);
        expect(E.selection.ids).toEqual([]);
        E.redo(); E._render();
        expect(E.doc.getById(a.id).level).toBe(kid.id);
        expect(E._isSelected(a.id)).toBe(true);
        expect(E.selection.ids).toEqual([]);
        expect(E._selectionStatus().count).toBe(2);
    });

    test("I6 a kid a drag's rest re-homes under the next cell stays selected, and the next drag takes it", () => {
        const E = mkE();
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const deep = E.lm.cellChild(kid.id, 1000, 5);            // near its parent's edge: at 12 px, 1000 + 1536 carries
        const d = E.doc.add(fill(E, 0, 0), deep.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 110));
        expect(E.selection.frames).toEqual([kid.id]);
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        E._render();
        expect(E.lm.isUnder(kid.id, E.lm.frame(deep.id).id) && E.lm.frame(deep.id).parent === kid.id).toBe(false);   // the fixture: torn off
        expect(E._isSelected(d.id)).toBe(true);                   // red: its ink left the selection
        expect(E._isSelected(a.id)).toBe(true);
        expect(E._selectionStatus().count).toBe(2);
        expect(inkless(E)).toEqual([]);
        const rectOf = (o) => { const r = E.doc.getById(o.id); return E._rectInActive(r.obj, r.level); };
        const before = [a, d].map(rectOf);
        const at = E.cam.levelPointToScreen(E.cam.frame, (before[0].left + before[0].right) / 2, (before[0].top + before[0].bottom) / 2);
        E.pointerDown(at[0], at[1]);
        for (const dy of [10, 25, 40]) E.pointerMove(at[0], at[1] + dy);
        E.pointerUp();
        E._render();
        const after = [a, d].map(rectOf);
        for (let k = 0; k < 2; k++) expect((after[k].top - before[k].top) * E.cam.inScale).toBeCloseTo(40, 0);
        E.undo(); E.undo(); E._render();
        expect(E._isSelected(a.id) && E._isSelected(d.id)).toBe(true);
        expect(E._selectionStatus().count).toBe(2);               // a re-nested frame is not counted twice
    });

    test("I7 raster, the drag drawn by its plane: a torn-off kid keeps its native selected at the drop", async () => {
        resetRasterWorkerClient(); setRasterWorkerCount(1);
        const flush = async () => { for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 0)); const rep = rasterWorkerReport(); if (!rep.inFlight && !rep.queued) return; } };
        const E = mkE(800, 600, true);
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const deep = E.lm.cellChild(kid.id, 1000, 5);
        const d = E.doc.add(fill(E, 0, 0, 60000, [[40000, 0]]), deep.id);   // over the cull at its frame's deepest zoom: the drop's bake reads it
        E._render(); await flush();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 110));
        expect(E.selection.frames).toEqual([kid.id]);
        E._render(); await new Promise((r) => setTimeout(r, 200)); await flush();   // the plane is aimed once the view holds
        // 12 + 3/1024 px: the kid's digit carries it next door with a shift of 3/8 of a frame, which with
        // its native's own 0.31 puts the native's picture past half a frame; it stays in the kid (A1 C1).
        const lists = jest.spyOn(E, "_render");
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12 + 3 / 1024]) E.pointerMove(org[0] + dx, org[1]);
        expect(lists).not.toHaveBeenCalled();                     // the fixture: no step rendered
        E.pointerUp();
        E._render();
        expect(E.lm.frame(deep.id).parent).not.toBe(kid.id);      // the fixture: the kid torn off
        expect(E.doc.getById(d.id).level).toBe(deep.id);
        expect(E._isSelected(d.id)).toBe(true);
        expect(E._isSelected(a.id)).toBe(true);
        expect(E._selectionStatus().count).toBe(2);
        expect(inkless(E)).toEqual([]);
    });

    test("I8 undo re-nests a torn-off kid under its selected parent (counted once); redo tears it off again and keeps it", () => {
        const E = mkE();
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const stays = E.lm.cellChild(kid.id, -1500, 5);           // keeps the parent inked (I5)
        const e = E.doc.add(fill(E, 0, 0), stays.id);
        const deep = E.lm.cellChild(kid.id, 1000, 5);            // torn off at 12 px (I6)
        const d = E.doc.add(fill(E, 0, 0), deep.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        const lassoKid = () => loop(E, circleLoop(org[0], org[1], 110));
        lassoKid();
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12]) E.pointerMove(org[0] + dx, org[1]);
        E.pointerUp();
        E._render();
        expect(E.selection.frames.sort()).toEqual([deep.id, kid.id].sort());
        expect(E._selectionStatus().count).toBe(3);
        E.undo(); E._render();
        expect(E.lm.frame(deep.id).parent).toBe(kid.id);          // the fixture: nested again
        expect(E._selectionStatus().count).toBe(3);               // red when a nested frame is counted by itself too
        E.deselect();
        lassoKid();
        expect(E.selection.frames).toEqual([kid.id]);
        E.redo(); E._render();
        expect(E.lm.frame(deep.id).parent).not.toBe(kid.id);      // the fixture: torn off again, by the redo
        expect([a, e, d].every((o) => E._isSelected(o.id))).toBe(true);   // red when the redo's re-address is not followed
        expect(E._selectionStatus().count).toBe(3);
    });

    for (const raster of [false, true]) {
        test("I9 " + (raster ? "raster" : "svg") + ": a render of a frame whose shift carries its native's picture changes neither the native nor the selection", () => {
            const E = mkE(800, 600, raster);
            const kid = E.lm.cellChild("0", 3, 2);
            const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
            E._render();
            const org = E.cam.levelPointToScreen(kid.id, 0, 0);
            loop(E, circleLoop(org[0], org[1], 110));
            expect(E.selection.frames).toEqual([kid.id]);
            E.doc.setFrameShift(kid.id, [0.7 * 131072, 0]);       // what a drag leaves on a frame
            E.store.bumpEpoch();
            let calls = 0;
            const ss = E._setSelection.bind(E);
            E._setSelection = (...x) => { calls++; return ss(...x); };
            const rev = E.doc.rev;
            const unclosed0 = raster ? rasterPerf.report().meta.unclosed : 0;
            E._render();
            expect(E.doc.rev).toBe(rev);
            expect(E.doc.getById(a.id).level).toBe(kid.id);
            expect(calls).toBe(0);
            expect(E._isSelected(a.id)).toBe(true);
            if (raster) expect(rasterPerf.report().meta.unclosed).toBe(unclosed0);   // no camera row left open by the render
        });
    }

    test("I10 a delete in the middle of a drag takes what the selection stood for at the press, the kid the drop would tear off included", () => {
        const E = mkE();
        const kid = E.lm.cellChild("0", 3, 2);
        const a = E.doc.add(fill(E, -S / 2, -S / 2, S, EDGE), kid.id);
        const deep = E.lm.cellChild(kid.id, 1000, 5);
        const d = E.doc.add(fill(E, 0, 0), deep.id);
        E._render();
        const org = E.cam.levelPointToScreen(kid.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 110));
        E.pointerDown(org[0], org[1]);
        for (const dx of [4, 8, 12]) E.pointerMove(org[0] + dx, org[1]);
        expect(E.doc.getById(a.id).level).toBe(kid.id);           // the fixture: home (A1 C1)...
        expect(E.lm.frame(deep.id).parent).toBe(kid.id);          // ...and nothing torn off before the drop (A1 C2)
        expect(E.deleteSelection()).toBe(true);
        expect(E.doc.getById(a.id)).toBeFalsy();                  // red: left behind
        expect(E.doc.getById(d.id)).toBeFalsy();                  // red: left behind
        expect(E._dragSel).toBeNull();
        E.undo(); E._render();
        expect(E.doc.getById(a.id) && E.doc.getById(d.id)).toBeTruthy();   // one undo brings both back
    });

    test("I4 a selected frame merged into its cell's resident hands over only the kids that hold ink", () => {
        const E = mkE();
        const mover = E.lm.cellChild("0", 3, 2);
        E.doc.add(fill(E, -S / 2, -S / 2), mover.id);
        const empty = E.lm.cellChild(mover.id, 5, 5);               // an empty container under it
        const inked = E.lm.cellChild(mover.id, -5, 5);
        E.doc.add(fill(E, 0, 0), inked.id);
        const resident = E.lm.cellChild("0", 4, 2);
        E.doc.add(fill(E, 45 * 4096, 0, S / 4), resident.id);     // 45 px right of its centre: outside the loop below
        E._render();
        const org = E.cam.levelPointToScreen(mover.id, 0, 0);
        loop(E, circleLoop(org[0], org[1], 75));                  // clears the mover's reach (48·√2), not the resident's
        expect(E.selection.frames).toEqual([mover.id]);
        expect(E.selection.ids).toEqual([]);
        E.pointerDown(org[0], org[1]);
        for (const dx of [10, 20, 32]) E.pointerMove(org[0] + dx, org[1]);   // one cell: onto the resident
        E.pointerUp();                                              // the drop shadows it and merges there (A1 C1, C2)
        expect(E.lm.frame(mover.id)).toBeFalsy();
        expect(E.selection.frames).toContain(inked.id);
        expect(E.selection.frames).not.toContain(empty.id);        // red: the empty kid handed over
        expect(inkless(E)).toEqual([]);
    });
});
