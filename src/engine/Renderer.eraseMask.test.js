/**
 * A pending mark on the SVG renderer (PLAN §5.8 item 2, DESIGN.md §7): drawn as nothing once its shape has landed,
 * its targets' groups masked by the rule the raster pack masks by (`eraseRule.underMask`) — so an object dragged
 * under it, a stroke drawn over it and a piece it has cut all show — instead of white ink at the mark's z.
 */
import Renderer from "./Renderer";
import { useEngines, mkEngine, drag, eraseGesture } from "./__testkit__/harness";

useEngines();
jest.setTimeout(60000);

const fill = (E, x0, y0, x1, y1, color = "rgb(40,40,200)") => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color, opacity: 1,
    polys: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]] }, "0");
const entryOf = (R, id) => R._groups.get(id);
const maskAttr = (R, id) => { const e = entryOf(R, id), el = e && e.group._renderer && e.group._renderer.elem; return el ? el.getAttribute("mask") : undefined; };
const defsOf = (R) => R.two.renderer.defs;
const paint = (E) => { E._render(); E.renderer.update(); };

test("M-1 a landed mark is not ink; its target is masked by its shape, and an object dragged under it is not", () => {
    const E = mkEngine(800, 600), R = E.renderer;
    E._scheduleBake = () => {};
    const T = fill(E, 300, 250, 500, 350), Y = fill(E, 80, 420, 180, 500, "rgb(30,160,30)");
    paint(E);
    E.setEraserSize(20); E.setTool("erasePartial");
    E.pointerDown(400, 200); E.pointerMove(400, 400); E.pointerUp();
    const id = E.doc._nextId - 1;
    paint(E);
    expect(E.doc.getById(id).obj.targets).toBeUndefined();
    expect(R._groups.has(id)).toBe(true);                                 // unlanded: ink until it lands
    E.flushBakes();
    paint(E);
    expect(E.doc.getById(id).obj.targets).toEqual([T.id]);
    expect(R._groups.has(id)).toBe(false);                                // landed: drawn as nothing (red: white ink at its z)
    const m = entryOf(R, T.id).mask;
    expect(m.marks).toEqual([id]);
    expect(maskAttr(R, T.id)).toBe("url(#" + m.id + ")");
    const el = defsOf(R).querySelector("#" + m.id);
    expect(el.tagName.toLowerCase()).toBe("mask");
    expect(el.querySelector("rect").getAttribute("fill")).toBe("#fff");
    const use = el.querySelector("use");
    expect(use.getAttribute("fill")).toBe("#000");
    const def = defsOf(R).querySelector(use.getAttribute("href"));
    expect(def.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(def.querySelector("path").getAttribute("d").length).toBeGreaterThan(20);
    // Y dragged under the mark after its registration: not a target, never masked, never cut.
    drag(E, [130, 460], [400, 300]);
    paint(E);
    expect(E.doc.getById(T.id)).not.toBeNull();                          // the drag's barrier left T's pair pending
    expect(entryOf(R, T.id).mask.marks).toEqual([id]);
    expect(entryOf(R, Y.id).mask || null).toBeNull();
    expect(maskAttr(R, Y.id)).toBeNull();
    // The bake: T's pieces are handled, the mark is spent — no mask, no mark in the defs.
    E.flushErases();
    E.renderer.update();
    expect(E.doc.getById(id)).toBeNull();
    for (const e of R._groups.values()) expect(e.mask || null).toBeNull();
    expect(defsOf(R).querySelectorAll("mask, #" + "bl-mark-" + R._uid + "-" + id).length).toBe(0);
    for (const e of R._groups.values()) expect(e.group._renderer.elem.getAttribute("mask")).toBeNull();
});

test("M-2 a piece a mark has cut shows; a target it still owes stays masked; a stroke drawn over the mark shows", () => {
    const E = mkEngine(800, 600), R = E.renderer;
    E._scheduleBake = () => {};
    const A = fill(E, 300, 150, 500, 230), B = fill(E, 300, 370, 500, 450, "rgb(200,40,40)");
    paint(E);
    eraseGesture(E, [[400, 120], [400, 480]], 20);
    const id = E.doc._nextId - 1;
    expect(E.doc.getById(id).obj.targets).toEqual([A.id, B.id]);
    paint(E);
    expect([entryOf(R, A.id).mask.marks, entryOf(R, B.id).mask.marks]).toEqual([[id], [id]]);
    E._bakeNext();                                                        // one step: the first pair cut
    paint(E);
    const cut = [...R._groups.values()].filter((e) => e.pieces.some((o) => o.handledBy && o.handledBy.includes(id)));
    expect(cut.length).toBeGreaterThan(0);
    for (const e of cut) expect(e.mask || null).toBeNull();               // handled: its ink shows (red without the rule's handledBy)
    const owed = [...R._groups.values()].filter((e) => e.pieces.some((o) => o.targetOf && o.targetOf.includes(id) && !(o.handledBy && o.handledBy.includes(id))));
    expect(owed.length).toBe(1);
    expect(owed[0].mask.marks).toEqual([id]);
    E.setTool("pen"); E.setWidth(13);
    E.pointerDown(360, 300); E.pointerMove(440, 310); E.pointerUp();
    const S = E.doc.getById(E.doc._nextId - 1).obj;
    paint(E);
    expect(entryOf(R, S.id).mask || null).toBeNull();                     // above the mark: never under it
});

test("M-3 the rule per group: a family is masked whole by any member's marks; a spent mark's reference goes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cam = { inScale: 1, inPanX: 0, inPanY: 0, frameWindow: () => ({ left: 0, top: 0, right: 800, bottom: 600 }), levelPointToScreen: (l, x, y) => [x, y] };
    const R = new Renderer(host, cam, { enter: 256, exit: 1 / 32, fatWidthPx: 4000 }, { width: 800, height: 600 });
    const sq = (id, x, extra) => ({ id, type: "fill", origin: "native", color: "#000", opacity: 1, polys: [[[x, 100], [x + 50, 100], [x + 50, 150], [x, 150]]], ...extra });
    const mark = (id, x) => ({ id, type: "fill", origin: "native", erase: true, targets: [], color: "#fff", opacity: 1, polys: [[[x, 90], [x + 10, 90], [x + 10, 160], [x, 160]]] });
    const fam = [sq(1, 100, { editId: 1, targetOf: [9] }), sq(2, 150, { editId: 1, targetOf: [9], handledBy: [9] })];
    const lone = sq(3, 300, { targetOf: [8] });
    R.render([...fam, lone, mark(8, 320), mark(9, 140)], "0");
    R.update();
    expect(R._groups.get(1).mask.marks).toEqual([9]);                     // the family's one group, masked by its member's mark
    expect(R._groups.get(3).mask.marks).toEqual([8]);
    expect([R._groups.has(8), R._groups.has(9)]).toEqual([false, false]);
    R.render([...fam, lone, mark(9, 140)], "0");                          // mark 8 spent
    R.update();
    expect(R._groups.get(3).mask || null).toBeNull();
    expect(R._groups.get(3).group._renderer.elem.getAttribute("mask")).toBeNull();
    expect(R.two.renderer.defs.querySelectorAll("mask").length).toBe(1);
    expect(R.two.renderer.defs.querySelector("#bl-mark-" + R._uid + "-8")).toBeNull();
    R.destroy();
});
