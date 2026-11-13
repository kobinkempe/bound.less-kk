/**
 * RUN-D — the app's paths far down, with runs (compact lattice stage 3, OPEN-FLAGS F202): a jump down the origin chain,
 * a render, a crossing each way, a stroke, a lasso, a drag, an erase with undo and redo, a save and a load. The lattice
 * stays a handful of frames, and each step costs a frame's walk, not a level's. Past 2^53 a depth is a Deep (depth.js,
 * docs/reference/depth-overflow-design-2026-11-13.md): the same paths at 2^53 + 2, 2^64, a googol and 10^100,000 levels,
 * and there is no deepest level.
 */
import { useEngines, mkEngine, drawStroke, drag, erase, descend, ascend, inkAt, natives } from "./__testkit__/harness";
import { add, sub, isDepth, isBig, parse } from "./depth";
import { FILE_VERSION } from "./persist";

useEngines();
const VIEW = { x: -2000, y: -1500, w: 4000, h: 3000 };
const deep = (s) => parse(s);
const P53 = "9007199254740992", P64 = "18446744073709551616", GOOGOL = `1${"0".repeat(100)}`;
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};
/** Every frame's depth in its one form, and a run frame's exactly its parent's plus the run plus one. */
const depthsExact = (lm) => {
    for (const f of lm.frames.values()) {
        if (!isDepth(f.depth)) return `frame ${f.id}: depth ${String(f.depth)} not in its one form`;
        const p = f.parent != null ? lm.frames.get(f.parent) : null;
        if (p && f.depth !== add(add(p.depth, f.run ? f.run.n : 0), 1)) return `frame ${f.id}: depth ${f.depth} under ${p.id} at ${p.depth}`;
    }
    return null;
};

describe.each([[1e6], [1e9], [2 ** 53 - 2], [deep("9007199254740994")], [deep(P64)], [deep(GOOGOL)]])("RUN-D — %s levels down", (D) => {
    test("jump, render, cross in and out, draw, lasso, drag, erase, undo, save and load: a handful of frames throughout", () => {
        const t0 = Date.now(), ms = {};
        const step = (name, fn) => { const t = Date.now(); const r = fn(); ms[name] = Date.now() - t; return r; };
        const E = mkEngine(800, 600);
        expect(step("jump", () => E.jumpTo(E.lm.ensureSpine(D), VIEW))).toBe(true);
        expect(E.activeLevel).toBe(D);
        expect(E.lm.frames.size).toBeLessThan(10);
        step("cross in", () => descend(E, add(D, 1)));
        expect(E.activeLevel).toBe(add(D, 1));
        step("cross out", () => ascend(E, sub(D, 1)));
        expect(E.activeLevel).toBe(sub(D, 1));
        step("back", () => descend(E, D));
        expect(E.activeLevel).toBe(D);
        expect(depthsExact(E.lm)).toBeNull();

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
        step("erase", () => erase(E, [[500, 330], [500, 390]], 24));
        expect(inkAt(E, 500, 360)).toBe(false);
        step("undo", () => E.undo());
        expect(inkAt(E, 500, 360)).toBe(true);
        step("redo", () => E.redo());
        expect(inkAt(E, 500, 360)).toBe(false);
        E.undo();

        const snap = step("save", () => E.snapshot());
        const C = mkEngine(800, 600);
        step("load", () => C.loadSnapshot(JSON.parse(JSON.stringify(snap))));   // as a report carries it: JSON, a Deep as its digits
        expect(C.activeLevel).toBe(D);
        expect(C.doc.getById(id)).toBeTruthy();
        expect(inkAt(C, 500, 360)).toBe(true);
        expect(depthsExact(C.lm)).toBeNull();
        expect(C.lm.frames.size).toBeLessThan(40);
        expect(E.lm.frames.size).toBeLessThan(40);
        // eslint-disable-next-line no-console
        console.log(`RUN-D ${D} levels: ${JSON.stringify(ms)}, frames ${E.lm.frames.size} / ${C.lm.frames.size}`);
        expect(Date.now() - t0).toBeLessThan(30000);
    });
});

describe("RUN-D — past 2^53 by hand: every crossing exact", () => {
    test("a zoom in from 2^53 − 3 to 2^53 + 3 and back: each level once, in its one form; ink at 2^53 + 1 saves and loads", () => {
        const E = mkEngine(800, 600), top = 2 ** 53 - 3, p = deep(P53);
        expect(E.jumpTo(E.lm.ensureSpine(top), VIEW)).toBe(true);
        const seen = [E.activeLevel];
        for (let k = 0; k < 6; k++) { descend(E, add(E.activeLevel, 1)); seen.push(E.activeLevel); }
        expect(seen).toEqual([top, top + 1, top + 2, p, add(p, 1), add(p, 2), add(p, 3)]);
        expect(seen.map(isBig)).toEqual([false, false, false, true, true, true, true]);
        expect(depthsExact(E.lm)).toBeNull();
        ascend(E, add(p, 1));
        expect(E.activeLevel).toBe(add(p, 1));
        drawStroke(E, [[350, 300], [450, 300]], 6);
        expect(inkAt(E, 400, 300)).toBe(true);
        for (let k = 0; k < 4; k++) ascend(E, sub(E.activeLevel, 1));
        expect(E.activeLevel).toBe(top);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
        expect(doc.version).toBe(FILE_VERSION);
        expect(typeof doc.camera.activeLevel).toBe("number");
        const C = mkEngine(800, 600);
        C.loadDrawing(doc);
        expect(C.activeLevel).toBe(top);
        descend(C, add(p, 1));
        expect(C.activeLevel).toBe(add(p, 1));
        expect(natives(C).map((n) => C.lm.depthOf(n.level))).toEqual([add(p, 1)]);
        expect(depthsExact(C.lm)).toBeNull();
    });
});

describe("RUN-D — far up: a root 10^100 levels above", () => {
    test("a jump far up is one root and a run, and draws, crosses, saves and loads", () => {
        const E = mkEngine(800, 600), D = deep(`-${GOOGOL}`);
        expect(E.jumpTo(E.lm.ensureSpine(D), VIEW)).toBe(true);
        expect(E.activeLevel).toBe(D);
        expect(E.lm.frames.size).toBeLessThan(10);
        expect(depthsExact(E.lm)).toBeNull();
        drawStroke(E, [[300, 300], [500, 300]], 12);
        expect(inkAt(E, 400, 300)).toBe(true);
        descend(E, add(D, 1));
        expect(E.activeLevel).toBe(add(D, 1));
        ascend(E, sub(D, 1));
        expect(E.activeLevel).toBe(sub(D, 1));
        descend(E, D);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
        expect(doc.version).toBe(FILE_VERSION);
        expect(doc.camera.activeLevel).toBe(String(D));
        const C = mkEngine(800, 600);
        C.loadDrawing(doc);
        expect(C.activeLevel).toBe(D);
        expect(inkAt(C, 400, 300)).toBe(true);
        expect(depthsExact(C.lm)).toBeNull();
    });
});

describe("RUN-D — no deepest level: past 10^100,000 either way, where the BigInt build stopped", () => {
    test.each([[`1${"0".repeat(100000)}7`], [`-1${"0".repeat(100000)}`]])("at %#: a zoom in and a zoom out cross; ink drawn there renders, saves and loads", (digits) => {
        const E = mkEngine(800, 600), D = deep(digits);
        expect(E.jumpTo(E.lm.ensureSpine(D), VIEW)).toBe(true);
        expect(E.activeLevel).toBe(D);
        expect(descend(E, add(D, 1))).toBe(add(D, 1));   // no stop: the zoom crosses
        expect(ascend(E, sub(D, 1))).toBe(sub(D, 1));
        expect(descend(E, D)).toBe(D);
        expect(depthsExact(E.lm)).toBeNull();
        drawStroke(E, [[350, 300], [450, 300]], 6);
        expect(inkAt(E, 400, 300)).toBe(true);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
        expect(doc.camera.activeLevel).toBe(digits);
        const C = mkEngine(800, 600);
        C.loadDrawing(doc);
        expect(C.activeLevel).toBe(D);
        expect(natives(C)).toHaveLength(1);
        expect(inkAt(C, 400, 300)).toBe(true);
    }, 60000);

    test("the scene list far down is the one at depth 1 (a stroke 32× thinner a scene of its own); its widths' base survives the file", () => {
        const at = (D) => {
            const E = mkEngine(800, 600);
            expect(E.jumpTo(E.lm.ensureSpine(D), VIEW)).toBe(true);
            drawStroke(E, [[100, 300], [700, 300]], 32);
            drawStroke(E, [[380, 330], [420, 330]], 1);
            return E;
        };
        const shape = (list) => list.map(({ level, hash, ...r }) => r);   // a hash carries the index's session tag
        const A = at(1);
        for (const D of [2 ** 53 - 1, deep(GOOGOL)]) {
            const E = at(D);
            const list = E.refreshScenes();
            expect(shape(list)).toEqual(shape(A.refreshScenes()));
            expect(E._sceneClient.core.scenes.size).toBe(2);
            expect(E._sceneClient.core.base).toBe(D);
            const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
            expect(doc.meta.sceneIndex.base).toBe(isBig(D) ? String(D) : D);
            const C = mkEngine(800, 600);
            C.loadDrawing(doc);
            expect(C.refreshScenes()).toEqual(list);
            expect(C._sceneClient.core.base).toBe(D);
        }
        expect(A._sceneClient.core.base).toBe(0);
    });
});
