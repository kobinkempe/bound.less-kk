/**
 * The composition (A1 C1, DESIGN.md §8): a native's picture table is its own table with its home
 * frame's shift at k = 0, composed on every read and written nowhere. Each case is checked against
 * the frozen settling model (`__oracles__/model-v1`, which wrote the same shift into the tables at the
 * first read) through the two pictures (`modelFuzz.comparePictures`: bit for bit at and below a
 * native's home). The cases of B-MODEL-C1's brief §3: the carry (0.75 W past the home: drawn one cell
 * over, remainder −0.25 W), the native drawn live where it is not homed, a newcomer cancelling the
 * shift, a promoted native, one registration for per-object and subtree drags, and the box union
 * (H6: a native with its own table under an enclosed frame is judged where it is drawn).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { pictureAt, comparePictures } from "./__testkit__/modelFuzz";
import { rectLoop } from "./geometry/arcShape";
import { hasOffsets } from "./geometry/offsets";
import { W, G } from "./frameLattice";

useEngines();
const oracles = [];
afterEach(() => { while (oracles.length) oracles.pop().destroy(); });
function pair() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const O = new OracleEngine(host, { width: 800, height: 600, scenes: false });
    oracles.push(O);
    const E = mkEngine(800, 600);
    for (const X of [O, E]) {
        X.lm.ensureSpine(4);
        X.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    }
    return [O, E];
}
const shape = (E, frame, left, top, w, h, below = undefined) => {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left, top, right: left + w, bottom: top + h }), color: "#246", opacity: 1, w: 8 };
    if (below) o.below = below;
    E.doc.add(o, frame);
    return o.id;
};
const stats = () => ({ items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0 });
function samePictures(O, E, frames) {
    const st = stats();
    for (const V of frames) expect(comparePictures(O, E, V, st)).toBeNull();
    return st;
}
const numsOfObj = (o) => JSON.stringify(o.loops || o.polys || o.pts);
// A picture's distinct painted points, sorted: the same outline whatever pieces carry it.
const outline = (items) => {
    const pts = new Set();
    for (const it of items) for (let i = 0; i + 1 < it.painted.length; i += 2) pts.add(it.painted[i] + "," + it.painted[i + 1]);
    return [...pts].sort();
};

describe("the composition", () => {
    test("the carry: 0.75 W past the home is drawn one cell over with −0.25 W, live there, as the oracle carried it", () => {
        const [O, E] = pair();
        let id, A, A1;
        for (const X of [O, E]) {
            A = X.lm.cellChild("1", 3, 2).id;
            A1 = X.lm.cellChild("1", 4, 2).id;
            id = shape(X, A, -2000, -3000, 4000, 6000, [[0.375 * W, 0]]);      // its own table: 0.375 W at k = 0
            X.doc.setFrameShift(A, [0.375 * W, 0]);                              // and its frame's shift
        }
        const o = E.doc.getById(id).obj;
        const T = E.doc.tableOf(o);
        expect(T).toEqual([[0.75 * W, 0]]);
        expect(E.doc.ownTable(o)).toEqual([[0.375 * W, 0]]);                // nothing written into it
        expect(E.lm.objShift(T, A, A1)).toMatchObject({ F0: A, rem: [-0.25 * W, 0] });
        const m = E.stage.model;
        expect(m.placement(o, A1)).toEqual({ F0: A, rem: [-0.25 * W, 0], rerouted: false });
        expect(m.drawnLive(o, A1)).toBe(true);                                 // the live native: drawn in A1, homed in A
        expect(m.nativesIn(A1).map((x) => x.id)).toContain(id);
        expect(m.drawnLive(o, A)).toBe(false);
        expect(m.nativesIn(A).map((x) => x.id)).not.toContain(id);
        expect(E.doc.getById(id).level).toBe(A);
        const st = samePictures(O, E, [A1, A, "1"]);
        expect(O.doc.getById(id).level).toBe(A1);                              // the oracle carried it; its picture is the same
        expect(st.carried).toBeGreaterThan(0);
        expect(st.carriedExact).toBe(st.carried);
    });

    test("a newcomer cancels its frame's shift: it is drawn where it was put, its own table −shift", () => {
        const [O, E] = pair();
        const C = mkEngine(800, 600);                                          // the control: the same frame unshifted
        C.lm.ensureSpine(4);
        const s = [0.25 * W, -0.125 * W];
        let A;
        for (const X of [O, E, C]) {
            A = X.lm.cellChild("1", 3, 2).id;
            shape(X, A, 1000, 1000, 3000, 3000);
            if (X !== C) X.doc.setFrameShift(A, s);
            X.cam.set({ activeLevel: 2, frame: A, inScale: 1, inPanX: 400, inPanY: 300 });
            X._render();
            drawStroke(X, [[300, 280], [360, 300], [430, 290], [480, 330]], 11, "rgb(200,30,30)");
        }
        const [o, c, q] = [E, C, O].map((X) => X.doc.list(A).filter((x) => x.type !== "shape" || x.color === "rgb(200,30,30)").pop());
        expect(numsOfObj(o)).toBe(numsOfObj(c));                               // stored where the pen put it
        expect(numsOfObj(o)).toBe(numsOfObj(q));
        expect(E.doc.ownTable(o)).toEqual([[-s[0], -s[1]]]);
        expect(hasOffsets(E.doc.tableOf(o))).toBe(false);                      // drawn with no displacement
        expect(E.stage.model.placement(o, A)).toEqual({ F0: A, rem: [0, 0], rerouted: false });
        samePictures(O, E, [A, "1"]);
    });

    test("a promoted native composes its old frame's shift one level down: the picture stays", () => {
        // Any native: the live model only. (The oracle promoted only a landing stroke, which its add had
        // settled; promoting an older native of a frame with a pending shift, it dropped the shift.)
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const A = E.lm.cellChild("1", 3, 2).id;
        const id = shape(E, A, -0.625 * W, -2000, 1.25 * W, 4000, [[0.0625 * W, 0]]);   // oversize, its own table
        E.doc.setFrameShift(A, [0.25 * W, 0.125 * W]);
        const before = pictureAt(E, "1").get(id);
        expect(E._promoteOversize(id)).toBe(true);
        expect(E.doc.getById(id).level).toBe("1");
        const t = E.doc.ownTable(E.doc.getById(id).obj);
        expect([t.length, t[0], t[1]]).toEqual([2, undefined, [0.3125 * W, 0.125 * W]]);   // one level down
        expect(outline(pictureAt(E, "1").get(id))).toEqual(outline(before));
    });

    test("a landing stroke promoted from a shifted frame: the oracle's picture", () => {
        const [O, E] = pair();
        let A, id;
        for (const X of [O, E]) {
            A = X.lm.cellChild("1", 3, 2).id;
            shape(X, A, 1000, 1000, 3000, 3000);
            X.doc.setFrameShift(A, [0.25 * W, 0.125 * W]);
            const o = { type: "shape", origin: "native", id: X.doc.allocId(), loops: rectLoop({ left: -0.625 * W, top: -2000, right: 0.625 * W, bottom: 2000 }), color: "#642", opacity: 1, w: 8 };
            X.doc.add(o, A, X === E ? { fresh: true } : undefined);          // the pen's add: a newcomer
            id = o.id;
            expect(X._promoteOversize(id)).toBe(true);
            expect(X.doc.getById(id).level).toBe("1");
        }
        const st = samePictures(O, E, ["1", "0", A]);
        expect(st.items).toBeGreaterThan(1);
    });

    test("per-object and subtree drags register the same: the same pictures, native for native (t2's case)", () => {
        const S = mkEngine(800, 600), P = mkEngine(800, 600);
        const ids = [];
        let R;
        for (const X of [S, P]) {
            X.lm.ensureSpine(4);
            X.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
            R = X.lm.cellChild("1", 2, 1).id;
            const K = X.lm.cellChild(R, 7, -7).id;
            ids.length = 0;
            for (let i = 0; i < 12; i++) ids.push(shape(X, i % 3 ? R : K, ((i * 7919) % 40000) - 20000, ((i * 104729) % 40000) - 20000, 900 + i * 50, 700));
            X._render();
        }
        const go = (X, sel, frames) => {
            X.setTool("select");
            X._setSelection(sel, frames);
            X._dragSel = { start: [400, 300], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
            X.store.setBatch(true);
            X._dragSelection(400 + 0.4 * G, 300 - 0.3 * G);
            X.pointerUp();
        };
        go(S, [], [R]);
        go(P, ids.slice(), []);
        expect(S.lm.frame(R).shift).toBeTruthy();                              // one entry, on the frame
        expect(ids.every((id) => P.doc.hasOwnTable(P.doc.getById(id).obj))).toBe(true);   // one per native
        const st = stats();
        // Frames at one address in both (a subtree drag re-addresses R's kids; one id, two places).
        const at = (X, k) => { const f = X.lm.frame(k); return f ? f.parent + "|" + (f.cell ? f.cell.i + "," + f.cell.j : "") : null; };
        const frames = new Set(["1"]);
        for (const X of [S, P]) for (const k of Object.keys(X.doc.nativesByLevel)) if (X.doc.count(k) && at(S, k) != null && at(S, k) === at(P, k)) frames.add(k);
        for (const V of frames) expect(comparePictures(S, P, V, st)).toBeNull();
        expect(st.items).toBeGreaterThan(0);
    });
});

describe("the box union (A1 C1; H6)", () => {
    // The camera at depth 1, four times closer: a cell is 128 px, its reach box ±192 px about its centre.
    const setUp = () => {
        const E = mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 4, inPanX: 400, inPanY: 300 });
        const K = E.lm.cellChild("1", 0, 0).id;
        return { E, K, c: E._levelPointToScreen(K, 0, 0), px: E._levelPointToScreen("1", G, 0)[0] - E._levelPointToScreen("1", 0, 0)[0] };
    };
    const lasso = (E, cx, cy, left, right, half) => {
        E.setTool("select");
        const pts = [[cx - left, cy - half], [cx + right, cy - half], [cx + right, cy + half], [cx - left, cy + half], [cx - left, cy - half + 1]];
        E.pointerDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
        E.pointerUp();
        return E.selection || { ids: [], frames: [] };
    };
    test("a frame's box is its reach united with the reach moved by its shift", () => {
        const { E, K, c, px } = setUp();
        const a = shape(E, K, 50000, -4000, 60000, 8000);                      // reaches 0.84 W right of the centre
        E.doc.setFrameShift(K, [0.4375 * W, 0]);                               // drawn to 1.28 W
        E._render();
        const reach = 1.5 * px, shift = 0.4375 * px;
        const tight = lasso(E, c[0], c[1], reach + 4, reach + 4, reach + 4);   // the reach only: K is not whole
        expect(tight.frames).not.toContain(K);
        const union = lasso(E, c[0], c[1], reach + 4, reach + shift + 4, reach + 4);
        expect(union.frames).toEqual([K]);
        expect(E._isSelected(a)).toBe(true);
    });
    test("H6: a native with its own table drawn outside the loop leaves its enclosed frame not whole", () => {
        const { E, K, c, px } = setUp();
        const a = shape(E, K, -4000, -4000, 8000, 8000);
        const n = shape(E, K, 1.25 * W, -2000, 0.125 * W, 4000, [[0.5 * W, 0]]);   // stored within reach, drawn at 1.75-1.875 W
        E._render();
        const reach = 1.5 * px;
        const sel = lasso(E, c[0], c[1], reach + 4, reach + 4, reach + 4);
        expect(sel.frames).not.toContain(K);                                   // judged where n is drawn
        expect(sel.ids).toContain(a);
        expect(sel.ids).not.toContain(n);
        E.doc.setOffsetsById(n, undefined);                                    // drawn where it is stored: inside
        E._render();
        const whole = lasso(E, c[0], c[1], reach + 4, reach + 4, reach + 4);
        expect(whole.frames).toEqual([K]);
    });
});
