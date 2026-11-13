/**
 * RUN-D — the app's paths far down, with runs (compact lattice stage 3, OPEN-FLAGS F202): a jump down the origin chain,
 * a render, a crossing each way, a stroke, a lasso, a drag, a save and a load. The lattice stays a handful of frames,
 * and each step costs a frame's walk, not a level's.
 */
import { useEngines, mkEngine, drawStroke, drag, descend, ascend, inkAt, natives } from "./__testkit__/harness";
import { MAX_DEPTH, ENTER, EXIT } from "./frameLattice";

useEngines();
const VIEW = { x: -2000, y: -1500, w: 4000, h: 3000 };
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};

describe.each([[1e6], [1e9], [2 ** 53 - 2]])("RUN-D — %d levels down", (D) => {
    test("jump, render, cross in and out, draw, lasso, drag, save and load: a handful of frames throughout", () => {
        const t0 = Date.now(), ms = {};
        const step = (name, fn) => { const t = Date.now(); const r = fn(); ms[name] = Date.now() - t; return r; };
        const E = mkEngine(800, 600);
        expect(step("jump", () => E.jumpTo(E.lm.ensureSpine(D), VIEW))).toBe(true);
        expect(E.activeLevel).toBe(D);
        expect(E.lm.frames.size).toBeLessThan(10);
        step("cross in", () => descend(E, D + 1));
        expect(E.activeLevel).toBe(D + 1);
        step("cross out", () => ascend(E, D - 1));
        expect(E.activeLevel).toBe(D - 1);
        step("back", () => descend(E, D));
        expect(E.activeLevel).toBe(D);

        const had = new Set(natives(E).map((n) => n.obj.id));
        step("draw", () => drawStroke(E, [[300, 300], [400, 310], [500, 320]], 12));
        const mine = natives(E).filter((n) => !had.has(n.obj.id));
        expect(mine).toHaveLength(1);
        const id = mine[0].obj.id;
        expect(E.lm.depthOf(mine[0].level)).toBe(D);
        expect(inkAt(E, 400, 310)).toBe(true);

        step("lasso", () => lasso(E, [[250, 260], [550, 260], [550, 370], [250, 370], [250, 262]]));
        expect(E.selection && E.selection.ids).toContain(id);
        step("drag", () => drag(E, [400, 310], [500, 360]));
        expect(inkAt(E, 400, 310)).toBe(false);
        expect(inkAt(E, 500, 360)).toBe(true);

        const snap = step("save", () => E.snapshot());
        const C = mkEngine(800, 600);
        step("load", () => C.loadSnapshot(snap));
        expect(C.activeLevel).toBe(D);
        expect(C.doc.getById(id)).toBeTruthy();
        expect(inkAt(C, 500, 360)).toBe(true);
        expect(C.lm.frames.size).toBeLessThan(40);
        expect(E.lm.frames.size).toBeLessThan(40);
        // eslint-disable-next-line no-console
        console.log("RUN-D " + D + " levels: " + JSON.stringify(ms) + ", frames " + E.lm.frames.size + " / " + C.lm.frames.size);
        expect(Date.now() - t0).toBeLessThan(30000);
    });
});

describe("RUN-D — the depth limit, 2^53 − 1 levels either way (MAX_DEPTH)", () => {
    test("at the deepest level a zoom in stops where it would cross; ink drawn there renders, saves and loads", () => {
        const E = mkEngine(800, 600);
        expect(E.jumpTo(E.lm.ensureSpine(MAX_DEPTH), VIEW)).toBe(true);
        expect(E.activeLevel).toBe(MAX_DEPTH);
        for (let k = 0; k < 200; k++) E.zoomAt(400, 300, -1000);
        expect(E.activeLevel).toBe(MAX_DEPTH);
        expect(E.cam.inScale).toBe(ENTER);
        expect([...E.lm.frames.values()].every((f) => Number.isSafeInteger(f.depth))).toBe(true);
        drawStroke(E, [[350, 300], [450, 300]], 6);
        expect(inkAt(E, 400, 300)).toBe(true);
        expect(ascend(E, MAX_DEPTH - 1)).toBe(MAX_DEPTH - 1);
        expect(descend(E, MAX_DEPTH)).toBe(MAX_DEPTH);
        const C = mkEngine(800, 600);
        C.loadSnapshot(E.snapshot());
        expect(C.activeLevel).toBe(MAX_DEPTH);
        expect(natives(C)).toHaveLength(1);
    });

    test("the scene list there is the one at depth 1 (a stroke 32× thinner a scene of its own); its widths' base survives the file", () => {
        const at = (D) => {
            const E = mkEngine(800, 600);
            expect(E.jumpTo(E.lm.ensureSpine(D), VIEW)).toBe(true);
            drawStroke(E, [[100, 300], [700, 300]], 32);
            drawStroke(E, [[380, 330], [420, 330]], 1);
            return E;
        };
        const shape = (list) => list.map(({ level, hash, ...r }) => r);   // a hash carries the index's session tag
        const A = at(1), E = at(MAX_DEPTH);
        const list = E.refreshScenes();
        expect(shape(list)).toEqual(shape(A.refreshScenes()));
        expect(E._sceneClient.core.scenes.size).toBe(2);
        expect(E._sceneClient.core.base).toBe(MAX_DEPTH);
        expect(A._sceneClient.core.base).toBe(0);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
        expect(doc.meta.sceneIndex.base).toBe(MAX_DEPTH);
        const C = mkEngine(800, 600);
        C.loadDrawing(doc);
        expect(C.refreshScenes()).toEqual(list);
        expect(C._sceneClient.core.base).toBe(MAX_DEPTH);
    });

    test("at the shallowest level a zoom out stops where it would cross", () => {
        const E = mkEngine(800, 600);
        E.lm.depthOf = () => -MAX_DEPTH;   // as a root grown 2^53 − 1 levels up
        let crossed = 0;
        E.cam._crossDown = () => { crossed++; };
        for (let k = 0; k < 50; k++) E.zoomAt(400, 300, 1000);
        expect(crossed).toBe(0);
        expect(E.cam.inScale).toBe(EXIT);
    });
});
