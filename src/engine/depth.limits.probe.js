/**
 * depth.limits.probe.js — how deep the test machine goes (docs/reference/depth-overflow-design-2026-11-13.md): the
 * depth module's own steps, then RUN-D's paths (a jump, a crossing each way, a stroke, a lasso, a drag, an erase with
 * undo and redo, a save and a load), at a depth of each digit count in DIGITS; each step timed, the heap after. A step
 * past MAX_MS ends the run there. Run:
 *   DIGITS=1000,100000,1000000 CI=true npx react-scripts test --watchAll=false --testMatch "**\/depth.limits.probe.js"
 */
import { useEngines, mkEngine, drawStroke, drag, erase, descend, ascend, inkAt } from "./__testkit__/harness";
import { add, sub, lt, parse } from "./depth";

useEngines();
jest.setTimeout(4 * 3600 * 1000);
const VIEW = { x: -2000, y: -1500, w: 4000, h: 3000 };
const DIGITS = (process.env.DIGITS || "1000,10000,100000,1000000").split(",").map(Number);
const MAX_MS = Number(process.env.MAX_MS || 120000);
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
let stopped = false;

describe.each(DIGITS.map((n) => [n]))("a depth of %i digits", (n) => {
    test("the depth module, then the app's paths", () => {
        if (stopped) return;
        const ms = {}, t0 = Date.now();
        const step = (name, fn) => {
            const t = Date.now(); const r = fn(); ms[name] = Date.now() - t;
            if (ms[name] > MAX_MS) stopped = true;
            return r;
        };
        const digits = `1${"0".repeat(n - 2)}7`;
        const D = step("parse", () => parse(digits));
        step("toString", () => String(add(D, 2)));
        step("add 1", () => add(D, 1));
        step("compare", () => lt(D, add(D, 1)));
        const E = mkEngine(800, 600);
        expect(step("jump", () => E.jumpTo(E.lm.ensureSpine(D), VIEW))).toBe(true);
        step("cross in", () => descend(E, add(D, 1)));
        expect(E.activeLevel).toBe(add(D, 1));
        step("cross out", () => ascend(E, sub(D, 1)));
        expect(E.activeLevel).toBe(sub(D, 1));
        step("back", () => descend(E, D));
        expect(E.activeLevel).toBe(D);
        step("draw", () => drawStroke(E, [[300, 300], [400, 310], [500, 320]], 12));
        expect(inkAt(E, 400, 310)).toBe(true);
        step("lasso", () => {
            E.setTool("select");
            E.pointerDown(250, 260);
            for (const p of [[550, 260], [550, 370], [250, 370], [250, 262]]) E.pointerMove(p[0], p[1]);
            E.pointerUp();
        });
        step("drag", () => drag(E, [400, 310], [500, 360]));
        expect(inkAt(E, 500, 360)).toBe(true);
        step("erase", () => erase(E, [[500, 330], [500, 390]], 24));
        expect(inkAt(E, 500, 360)).toBe(false);
        step("undo", () => E.undo());
        step("redo", () => E.redo());
        const text = step("save", () => JSON.stringify(E.serializeDrawing({ name: "t" })));
        const C = mkEngine(800, 600);
        step("load", () => C.loadDrawing(JSON.parse(text)));
        expect(C.activeLevel).toBe(D);
        const out = { digits: n, ms, total: Date.now() - t0, frames: E.lm.frames.size, fileMB: +(text.length / 1048576).toFixed(1), heapMB: mb() };
        // eslint-disable-next-line no-console
        console.log(`DEPTH-LIMIT ${JSON.stringify(out)}`);
    });
});
