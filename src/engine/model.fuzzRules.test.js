/**
 * The model fuzz's named exceptions are no wider than their reasons (OPEN-FLAGS F138). `carriedAlike` absorbs a native the
 * oracle carried — its frame's shift settled into its address — that the live engine composes on its frame (A1 C1,
 * DESIGN.md §8); a live native homed a cell off whose own table makes up for it draws alike too, and must not pass.
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { carriedAlike } from "./__testkit__/modelFuzz";
import { rectLoop } from "./geometry/arcShape";

useEngines();
const oracles = [];
afterEach(() => { while (oracles.length) { const o = oracles.pop(); try { o.E.destroy(); } catch (e) { /* gone */ } o.host.remove(); } });
function mkOracle() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new OracleEngine(host, { width: 800, height: 600, scenes: false });
    oracles.push({ E, host });
    return E;
}
const square = (E, frame, id) => {
    E.doc.add({ type: "shape", origin: "native", id, color: "#123", opacity: 1, w: 8, loops: rectLoop({ left: -2000, top: -2000, right: 2000, bottom: 2000 }) }, frame);
    return id;
};

describe("carriedAlike (the fuzz's unit and selection exceptions)", () => {
    // The oracle: native 1 at cell (5, 0) of "0", its own table [-2, 0] (a shift of 131070 settled, a cell into the address).
    const oracle = () => {
        const O = mkOracle();
        const A = O.lm.cellChild("0", 5, 0);
        square(O, A.id, 1);
        O.doc.setOffsetsById(1, [[-2, 0]]);
        return O;
    };
    test("a carry the live engine composes on its frame: carried alike", () => {
        const O = oracle(), N = mkEngine(800, 600);
        const B = N.lm.cellChild("0", 4, 0);
        square(N, B.id, 1);
        N.doc.setFrameShift(B.id, [65535, 0]);
        N.doc.setOffsetsById(1, [[65535, 0]]);
        expect(carriedAlike(O, N, 1)).toBe(true);
    });
    test("a home a cell off that its own table makes up for: not carried alike, though it draws alike", () => {
        const O = oracle(), N = mkEngine(800, 600);
        const B = N.lm.cellChild("0", 4, 0);
        square(N, B.id, 1);
        N.doc.setOffsetsById(1, [[131070, 0]]);
        const box = (E) => { const b = E.stage.placeNative(E.doc.getById(1).obj, "0").box(); return [b.left, b.top, b.right, b.bottom]; };
        expect(box(N)).toEqual(box(O));                                   // the picture cannot tell
        expect(carriedAlike(O, N, 1)).toBe(false);
    });
});
