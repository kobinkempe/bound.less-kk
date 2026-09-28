/**
 * PROBE, not a test (the suite does not run *.probe.js):
 *
 *   STACK_N=100,1000 node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch "**\/erase.stack.probe.js"
 *
 * A ring erased through N huge wavy pen strokes (Kobin, 2026-09-23), baked inline as the tick
 * does, timing: the cuts, a click-select and drag start on a cut-out mid-bake (the drag barrier),
 * the select of the object the baker is on, and the lasso's barrier with the baker half way.
 * The semantics are `erase.stack.test.js`.
 */
import { mkEngine, useEngines, eraseGesture, drawStroke } from "./__testkit__/harness";

const C = [400, 300];
const circle = (r, n, turns = 1) => {
    const out = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * turns * 2 * Math.PI; out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
    return out;
};
const now = () => performance.now();
const ms = (t) => +t.toFixed(1);

function build(n) {
    const E = mkEngine(800, 600);
    E._scheduleBake = () => {};
    const t0 = now();
    for (let k = 0; k < n; k++) {
        const pts = [];
        for (let i = 0; i <= 60; i++) { const x = 150 + (500 * i) / 60; pts.push([x, C[1] + 40 * Math.sin(x / 16 + k) + 6 * Math.cos(x / 5 + 2 * k)]); }
        drawStroke(E, pts, 420, "#" + ((0x204060 + k * 0x0a0604) & 0xffffff).toString(16).padStart(6, "0"));
    }
    const tDraw = now() - t0;
    E._render();
    eraseGesture(E, circle(110, 72, 1.1), 16);
    const Erec = E._eraseStrokes()[0];
    let pieces = 0;
    for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase && o.loops) for (const l of o.loops) pieces += l.length;
    return { E, Erec, tDraw, pieces };
}
function step(E, Erec) {
    if (!E._headOf(Erec)) return null;
    const t0 = now();
    E._bakeNext();
    return now() - t0;
}

describe("a ring through a stack of huge strokes: timing", () => {
    useEngines();
    const sizes = (process.env.STACK_N || "100").split(",").map(Number);
    for (const n of sizes) {
        test("N = " + n, () => {
            // 1. the whole bake, inline
            const { E, Erec, tDraw, pieces } = build(n);
            const cuts = [];
            const tScan = now(); E._candidatesUnder(Erec); const scanMs = now() - tScan;
            for (let dt; (dt = step(E, Erec)) != null;) cuts.push(dt);
            cuts.sort((a, b) => a - b);
            const sum = cuts.reduce((a, b) => a + b, 0);
            // 2. mid-bake: the baker at 80 %, a tap-drag of the top cut-out, then of the baker's own target
            const B = build(n);
            const k80 = Math.floor(0.8 * n);
            for (let i = 0; i < k80; i++) step(B.E, B.Erec);
            B.E._render();
            const E2 = B.E;
            E2.setTool("select");
            let t0 = now(); E2.pointerDown(C[0], C[1]); E2.pointerUp(); const tapTop = now() - t0;
            t0 = now(); E2.pointerDown(C[0], C[1]); E2.pointerMove(C[0] + 20, C[1]); const dragStartTop = now() - t0;
            for (let i = 2; i <= 10; i++) E2.pointerMove(C[0] + 20 * i, C[1]);
            E2.pointerUp(); E2.deselect();
            // the discs the baker has passed, out of the way until its own target is on top
            let guard = 0;
            while (guard++ < k80) {
                const hit = E2._hitTest(C[0], C[1]);
                const rec = hit != null && E2.doc.getById(hit);
                if (!rec || E2._zOf(rec.obj) < E2._zOf(B.Erec.obj)) break;
                E2._setSelection([hit]);
                E2.pointerDown(C[0], C[1]); for (let i = 1; i <= 6; i++) E2.pointerMove(C[0] - 40 * i, C[1] - 60); E2.pointerUp(); E2.deselect();
            }
            t0 = now(); E2.pointerDown(C[0], C[1]); E2.pointerUp(); const tapBaker = now() - t0;
            const selZ = E2.selection ? E2._zOf(E2.doc.getById(E2.selection.ids[0]).obj) : null;
            const markZ = E2._zOf(B.Erec.obj);
            E2.deselect();
            // 3. the lasso with the baker half way
            const L = build(n);
            for (let i = 0; i < Math.floor(n / 2); i++) step(L.E, L.Erec);
            L.E._render();
            L.E.setTool("select");
            const loop = circle(140, 48);
            t0 = now();
            L.E.pointerDown(loop[0][0], loop[0][1]);
            for (let i = 1; i < loop.length; i++) L.E.pointerMove(loop[i][0], loop[i][1]);
            L.E.pointerUp();
            const lassoMs = now() - t0;
            const selected = L.E.selection ? L.E.selection.ids.length : 0;
            console.log("STACK N=" + n, JSON.stringify({
                drawMs: ms(tDraw), piecesUnder: pieces, candidateScanMs: ms(scanMs),
                cuts: cuts.length, cutMs: { sum: ms(sum), median: ms(cuts[cuts.length >> 1] || 0), p95: ms(cuts[Math.floor(cuts.length * 0.95)] || 0), max: ms(cuts[cuts.length - 1] || 0) },
                at80: { tapTopMs: ms(tapTop), dragStartTopMs: ms(dragStartTop), tapBakerTargetMs: ms(tapBaker), selZ, markZ },
                lassoAt50: { ms: ms(lassoMs), selected, marksLeft: L.E._eraseStrokes().length },
            }));
        }, 3600000);
    }
});
