/**
 * OPEN-FLAGS F104 — a member whose frame the lattice has lost is not severed.
 *
 * `_familyComponents` finds a kid's doorway through its home frame's depth. A kid homed in a
 * frame the lattice did not have (F99: 42 ceded kids of the Magnum Opus) found none, came out a
 * component of its own, and `_resplitFamily` rekeyed it away for good; once the frame was back,
 * a move of the parent left the kid behind and carried a rectangular hole with it.
 */
import KobinEngine from "./KobinEngine";
import { rectLoop } from "./geometry/arcShape";

jest.setTimeout(60000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width) => {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const eraseGesture = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushErases();
};
const zoomTo = (E, n, dir) => { let g = 0; while (E.activeLevel !== n && g++ < 400) E.zoomAt(400, 300, dir * 1000); expect(E.activeLevel).toBe(n); };
const natives = (E) => { const out = []; for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase) out.push({ o, L }); return out; };

/** A band at depth 0 with a nick made one crossing down: the parent cedes a tile to a kid at depth 1. */
function cededBand() {
    const E = mkEngine();
    drawStroke(E, [[150, 300], [650, 300]], 40);
    zoomTo(E, 1, -1);
    E.setEraserSize(20);
    eraseGesture(E, [[400, 260], [400, 340]]);
    E.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 }); E._render();
    const all = natives(E);
    const kid = all.find((n) => n.o.attachRect);
    expect(kid).toBeTruthy();
    expect(E.lm.depthOf(kid.L)).toBe(1);
    const key = E.doc.editKey(kid.o);
    expect(all.every((n) => E.doc.editKey(n.o) === key)).toBe(true);   // one object
    return { E, kid, key };
}

describe("F104 — a member whose frame is missing keeps its family", () => {
    test("control: with every frame there, a cut through the band far from the tile splits it and the kid goes with its own half", () => {
        const { E, kid, key } = cededBand();
        eraseGesture(E, [[250, 250], [250, 350]]);                      // severs the band at x = 250
        const keys = new Set(natives(E).map((n) => E.doc.editKey(n.o)));
        expect(keys.size).toBe(2);
        expect(E.doc.editKey(E.doc.getById(kid.o.id).obj)).toBe(E.doc.editKey(natives(E).find((n) => n.L === "0" && n.o.id !== kid.o.id && E.doc.editKey(n.o) === E.doc.editKey(kid.o)).o));
        expect(keys.has(key)).toBe(true);
    });

    test("with the kid's frame dropped from the lattice, the same cut leaves the kid on the family's key", () => {
        const { E, kid, key } = cededBand();
        expect(E.lm.forget(kid.L)).toBe(true);                           // the F99 state: natives homed in a frame the lattice lacks
        expect(E.lm.depthOf(kid.L)).toBeNull();
        eraseGesture(E, [[250, 250], [250, 350]]);
        const now = E.doc.getById(kid.o.id);
        expect(now).toBeTruthy();
        expect(E.doc.editKey(now.obj)).toBe(key);                        // never rekeyed away
    });
});

describe("F104 — a ceded kid of a MOVED object stays in its family", () => {
    // The drag moves the band by whole cells one level down (845 units at depth 0 is 26 cells and a
    // remainder at depth 1), so the kid the nick cedes is homed where the picture is.
    test.each([[845, 395], [40, 20], [70000 / 4096, 0]])("moved by (%d, %d) at depth 0, then nicked one crossing down", (dx, dy) => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.setTool("select");
        E.pointerDown(400, 300); E.pointerUp();
        E.pointerDown(400, 300); E.pointerMove(400 + dx / 2, 300 + dy / 2); E.pointerMove(400 + dx, 300 + dy); E.pointerUp();
        const band = natives(E)[0];
        expect(band.o.below).toBeTruthy();
        E.setTool("pen");
        E.cam.set({ frame: "0", activeLevel: 0, inScale: 1, inPanX: -dx, inPanY: -dy }); E._render();
        zoomTo(E, 1, -1);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 260], [400, 340]]);
        const all = natives(E);
        const kid = all.find((n) => n.o.attachRect);
        expect(kid).toBeTruthy();
        const keys = new Set(all.map((n) => E.doc.editKey(n.o)));
        expect(keys.size).toBe(1);                                          // the nick severs nothing
    });
});

describe("F104 — a kid whose PARENT's frame is missing keeps its family", () => {
    test("the parent band's frame dropped: a re-split leaves the kid (resolved, alone) on the key", () => {
        const E = mkEngine();
        zoomTo(E, 1, -1);
        drawStroke(E, [[150, 300], [650, 300]], 40);                     // homed at depth 1
        zoomTo(E, 2, -1);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 260], [400, 340]]);                       // cedes a tile to depth 2
        const all = natives(E);
        const kid = all.find((n) => n.o.attachRect && E.lm.depthOf(n.L) === 2);
        const parent = all.find((n) => E.lm.depthOf(n.L) === 1);
        expect(kid && parent).toBeTruthy();
        const key = E.doc.editKey(kid.o);
        expect(E.doc.editKey(parent.o)).toBe(key);
        // The parent's frame leaves the lattice (F99's state one level up); the kid's frame stays.
        const P = E.lm.frame(parent.L), G = E.lm.frame(P.parent);
        for (const [c, id] of G._kids) if (id === P.id) G._kids.delete(c);
        E.lm.frames.delete(P.id); E.lm._paths.clear();
        expect(E.lm.depthOf(parent.L)).toBeNull();
        expect(E.lm.depthOf(kid.L)).toBe(2);
        // A resolved member of the family ahead of both in member order, so neither is the first component.
        const X = { type: "shape", origin: "native", id: E.doc.allocId(), editId: key, loops: rectLoop({ left: 0, top: 0, right: 10, bottom: 10 }), color: "#000", opacity: 1, w: 1 };
        E.doc.add(X, "0");
        E._resplitFamily({ baked: [] }, key);
        expect(E.doc.editKey(E.doc.getById(X.id).obj)).toBe(key);
        expect(E.doc.editKey(E.doc.getById(kid.o.id).obj)).toBe(key);
        expect(E.doc.editKey(E.doc.getById(parent.o.id).obj)).toBe(key);
    });
});
