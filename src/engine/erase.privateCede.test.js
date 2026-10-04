/**
 * A cede's kids live in private frames of their family (A1 C4, A1 §8): no shared frame holds a family's kid, so the
 * lasso takes every other frame whole with no family pass (F108-COST option (c)); a private frame is never taken whole,
 * its natives judged with their families (F108). Severance compares cells (F124: `erase.cedeSeam`).
 */
import { useEngines, mkEngine, drawStroke, erase } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { rectLoop } from "./geometry/arcShape";
import { G } from "./frameLattice";
import { decodeDrawing } from "./persist";
import { decodeDrawing as decodeV2 } from "./__oracles__/model-v1/persist";

useEngines();
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const at = [400, 301];
const lasso = (E, pts) => {
    E.setTool("select");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) E.pointerMove(p[0], p[1]);
    E.pointerUp();
};
const circle = (c, r) => { const out = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return out; };

/** F108's repro: a wide stroke at depth 0 nicked at depth 2, a small stroke beside the nick there, the camera back at depth 0. */
function scene() {
    const E = mkEngine();
    const S = drawStroke(E, [[50, 300], [300, 305], [550, 298], [750, 302]], 30);
    for (let i = 0; i < 6; i++) E.zoomFactorAt(at[0], at[1], 16);
    const deep = E.cam.frame;
    erase(E, [[380, 250], [400, 300], [420, 350]], 12);
    const dot = drawStroke(E, [[450, 330], [460, 335]], 4);
    while (E.cam.activeLevel > 0) E.zoomFactorAt(at[0], at[1], 1 / 16);
    E.zoomFactorAt(at[0], at[1], 1);
    const fam = [];
    for (const k of E.doc.levels()) for (const o of E.doc.list(k)) if (!o.erase && o.editId != null) fam.push({ o, frame: k });
    return { E, S, deep, dot, fam };
}

describe("a cede's kids in private frames (A1 C4)", () => {
    test("every kid a cede makes is homed in a private frame of its family; no shared frame holds a keyed kid", () => {
        const { E, S, deep, fam } = scene();
        const kids = fam.filter((m) => m.o.attachRect);
        expect(kids.length).toBeGreaterThan(0);
        for (const m of kids) expect(E.lm.frame(m.frame).private).toBe(String(S._home));   // the frame the family's chain hangs from
        for (const k of E.doc.keyedFrames()) {
            if (E.lm.frame(k).private != null) continue;
            for (const o of E.doc.keyedIn(k)) expect(o.attachRect).toBeFalsy();          // only the target's remnants
        }
        expect(E.doc.keyedIn(deep)).toBeNull();
        expect(kids.some((m) => E.lm.sameCell(m.frame, deep))).toBe(true);               // the kid's cell is the enclosed frame's
        expect(E.lm.residentOf(deep).id).toBe(deep);                                     // which keeps it
        const d = JSON.parse(JSON.stringify(E.serializeDrawing()));                       // version 3: a private frame
        expect(d.version).toBe(3);
        expect(decodeDrawing(d).crossings.frames.find((r) => r.id === kids[0].frame).private).toBe(String(S._home));
        expect(() => decodeV2(d)).toThrow("file v3, app reads up to v2");
    });

    test("F108's loop takes the enclosed frame whole, the stroke beside the nick with it, none of the family, and no frame torn", () => {
        const { E, deep, dot, fam } = scene();
        E.deselect();
        let torn = null;
        const tu = E._tornUnder.bind(E);
        E._tornUnder = (...a) => { const r = tu(...a); torn = torn || r; return r; };
        lasso(E, circle(at, 20));
        expect(E.selection.frames).toEqual([deep]);
        expect(E.selection.ids).toEqual([]);
        expect(E._isSelected(dot.id)).toBe(true);
        for (const m of fam) expect(E._isSelected(m.o.id)).toBe(false);
        expect(torn ? torn.size : 0).toBe(0);                                            // red before C4: the kid tore `deep`
    });

    test("a torn-family lasso is frames, not ids: a city of inked cells, each nicked through a backdrop", () => {
        const N = Number(process.env.CEDE_CITY || 4);                                     // N × N cells
        const run = (mk) => {
            const E = mk();
            drawStroke(E, [[100, 300], [700, 300]], 200);                                  // the backdrop at depth 0
            for (let i = 0; i < 6; i++) E.zoomFactorAt(400, 300, 16);                     // depth 2 at inScale 1: its cells 32 px
            const cam = E.cam.state(), F2 = E.cam.frame;
            const c = E.cam.screenToFrame(400, 300), ci = Math.round(c[0] / G) - N / 2, cj = Math.round(c[1] / G) - N / 2;
            const cells = [];
            for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
                // The city's own ink in the depth-3 cell, then a nick through the backdrop there (a cede into the cell).
                const [x, y] = E.cam.levelPointToScreen(F2, (ci + a) * G, (cj + b) * G);
                for (let i = 0; i < 3; i++) E.zoomFactorAt(x, y, 16);
                cells.push(E.cam.frame);
                for (let k = 0; k < 3; k++) E.doc.add({ type: "shape", origin: "native", id: E.doc.allocId(), loops: rectLoop({ left: -900 + k * 700, top: -400, right: -500 + k * 700, bottom: 300 }), color: "#246", opacity: 1, w: 6 }, E.cam.frame);
                erase(E, [[x - 30, y - 30], [x + 30, y + 30]], 10);
                E.cam.set(cam); E._render();
            }
            E.deselect();
            const m = G / 2 + 6;
            const lo = E.cam.levelPointToScreen(F2, ci * G - m, cj * G - m), hi = E.cam.levelPointToScreen(F2, (ci + N - 1) * G + m, (cj + N - 1) * G + m);
            const t0 = now();
            lasso(E, [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]], [lo[0], lo[1] + 2]]);
            const ms = now() - t0;
            const s = E.selection || { ids: [], frames: [] };
            return { ids: s.ids.length, frames: s.frames.length, cells: new Set(cells).size, ms: Math.round(ms * 10) / 10 };
        };
        const live = run(() => mkEngine());
        const oracle = run(() => new OracleEngine(document.body.appendChild(document.createElement("div")), { width: 800, height: 600 }));
        log("PRIVATE-CEDE " + JSON.stringify({ N, live, oracle }));
        expect(live.cells).toBe(N * N);
        expect(live.ids).toBe(0);                                                         // the city's frames whole, the backdrop's kids left
        expect(live.frames).toBeGreaterThanOrEqual(live.cells);
        expect(oracle.ids).toBeGreaterThan(live.cells);                                   // before C4: every torn city frame read one by one
    });
});
