// F183's square-side part: a kid one level below its parent, joined to it only through a neck narrower than the parent's
// lattice step (8 of the kid's units) where the neck crosses the kid's square's side, is one object. A neck that stops
// short of the side, or meets it where the parent has no ink, is not; a wide one is, as before.
import { useEngines, mkEngine } from "./__testkit__/harness";
import { rectLoop, subtractShape } from "./geometry/arcShape";

useEngines();
const C = 65536;
/** A closed polygon of line pieces, in rectLoop's turning order. */
const poly = (pts) => pts.map((A, k) => ({ line: true, A, B: pts[(k + 1) % pts.length] }));

/**
 * The parent at level 0: a block round cell (10, 10)'s square, with the hole the cede left there, less `notch` (level-0
 * units) on the hole's right side if given. The kid in that cell: a body, and a spur `w` of its units wide running to
 * `reach` (the square's right side is C).
 */
function family(w, reach, notch) {
    const E = mkEngine(800, 600);
    const key = E.doc.allocId(), K = E.lm.cellChild("0", 10, 10);
    let block = subtractShape(rectLoop({ left: 200, top: 200, right: 440, bottom: 440 }), rectLoop({ left: 304, top: 304, right: 336, bottom: 336 })).loops;
    if (notch) block = subtractShape(block, rectLoop({ left: 335, top: 320 - notch, right: 345, bottom: 320 + notch })).loops;
    const h = w / 2, B = 30000;
    const kid = poly([[-B, -B], [B, -B], [B, -h], [reach, -h], [reach, h], [B, h], [B, B], [-B, B]]);
    const add = (o, level) => E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), editId: key, color: "#123", opacity: 1, w: 8, ...o }, level);
    add({ loops: block }, "0");
    add({ loops: [kid], attachRect: { x0: -C, y0: -C, x1: C, y1: C } }, K.id);
    return E._familyComponents(key).classes.length;
}

describe("F183: the doorway across a ceded square's side", () => {
    test("a neck 3 of the kid's units wide (under the parent's step of 8) joins the kid to its parent", () => {
        expect(family(3, C)).toBe(1);
    });
    test("a neck 0.5 units wide still joins", () => {
        expect(family(0.5, C)).toBe(1);
    });
    test("a neck 12 units wide joins, as before", () => {
        expect(family(12, C)).toBe(1);
    });
    test("a neck that stops 3 units short of the side does not", () => {
        expect(family(3, C - 3)).toBe(2);
    });
    test("a neck that meets the side where the parent has no ink does not", () => {
        expect(family(3, C, 0.01)).toBe(2);   // the notch is 82 of the kid's units each way
    });
});
