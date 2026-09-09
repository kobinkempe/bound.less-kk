/**
 * PROBE, not a test (the suite does not run *.probe.js; see tools/harnesses/README.md):
 *
 *   npx react-scripts test --watchAll=false --testMatch "**\/perf.scale.probe.js"
 *
 * How the engine's costs SCALE with the number of strokes (2026-09-05). jsdom
 * timings are not browser timings; what matters here is the exponent — an
 * operation that takes 4x for 2x the strokes is quadratic, and a quadratic path
 * is what a dense drawing feels. Measured on this date: draw cost per stroke
 * 95 ms at 250 strokes and 334 at 1,000, 95% of it the two full renders every
 * pen-up makes (Renderer.render re-signatures every group); warm render 16 ->
 * 63 ms; a crossing 0.5 -> 1.6 s; an erase gesture 0.6 -> 1.8 s. The numbers
 * are in docs/ROADMAP.md under Performance.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, timeIt, vertexCount, natives as nativeRecs,
} from "./__testkit__/harness";

const natives = (E) => { const n = nativeRecs(E); return Array.isArray(n) ? n.length : n; };

jest.setTimeout(900000);
useEngines();

const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// A scribble: a random walk of 6..16 points inside the view, pen 3..18 px.
const scribble = (rnd, w, h) => {
    const n = 6 + Math.floor(rnd() * 11);
    let x = 40 + rnd() * (w - 80), y = 40 + rnd() * (h - 80);
    const pts = [[x, y]];
    for (let i = 1; i < n; i++) {
        x = Math.min(w - 20, Math.max(20, x + (rnd() - 0.5) * 120));
        y = Math.min(h - 20, Math.max(20, y + (rnd() - 0.5) * 120));
        pts.push([x, y]);
    }
    return { pts, w: 3 + rnd() * 15 };
};

const ms = (t) => +t.toFixed(1);

describe("perf scaling with stroke count", () => {
    test.each([[250], [1000]])("N=%s strokes", (N) => {
        const E = mkEngine(800, 600);
        const rnd = mulberry(1234);
        const strokes = Array.from({ length: N }, () => scribble(rnd, 800, 600));
        const out = { N };
        // Where a stroke's cost goes: renders forced during drawing, the bake, the rest.
        const acc = { renders: 0, renderMs: 0, bakeMs: 0 };
        const render0 = E._render.bind(E), bake0 = E.flushBakes.bind(E);
        E._render = (...a) => { const t = performance.now(); const r = render0(...a); acc.renderMs += performance.now() - t; acc.renders++; return r; };
        E.flushBakes = (...a) => { const t = performance.now(); const r = bake0(...a); acc.bakeMs += performance.now() - t; return r; };
        // 1. Drawing: pointer input + pen-up resolve (the bake), per stroke.
        out.drawTotal = ms(timeIt(() => { for (const s of strokes) drawStroke(E, s.pts, s.w); E.flushBakes(); }));
        out.drawPerStroke = ms(out.drawTotal / N);
        out.drawRenders = acc.renders; out.drawRenderMs = ms(acc.renderMs); out.drawBakeMs = ms(acc.bakeMs);
        out.drawOtherMs = ms(out.drawTotal - acc.renderMs - acc.bakeMs);
        // the last stroke alone, phase by phase
        {
            const s = scribble(rnd, 800, 600);
            const a0 = { ...acc };
            const tIn = performance.now();
            E.setTool("pen"); E.setWidth(s.w);
            E.pointerDown(s.pts[0][0], s.pts[0][1]);
            for (let i = 1; i < s.pts.length; i++) E.pointerMove(s.pts[i][0], s.pts[i][1]);
            const tUp = performance.now();
            E.pointerUp();
            const tBake = performance.now();
            E.flushBakes();
            const tEnd = performance.now();
            out.lastStroke = { input: ms(tUp - tIn), pointerUp: ms(tBake - tUp), flushBakes: ms(tEnd - tBake), renders: acc.renders - a0.renders, renderMs: ms(acc.renderMs - a0.renderMs) };
        }
        E._render = render0; E.flushBakes = bake0;
        // 1b. HUMAN-PACED: the bake tick runs between strokes as it does in the
        // app, and the resolved shape does not render on its own (2026-09-07,
        // `_stepShapeBakes`), so a stroke costs ONE render — the pen-up's, which
        // also paints the previous stroke's perimeter. The loop above draws through the harness's
        // `drawStroke`, which flushes bakes, and `flushBakes` is the
        // tests' settle point and renders, so the loop above still sees two.
        {
            const a0 = { ...acc };
            E._render = (...a) => { const t = performance.now(); const r = render0(...a); acc.renderMs += performance.now() - t; acc.renders++; return r; };
            const more = Array.from({ length: 50 }, () => scribble(rnd, 800, 600));
            const t0 = performance.now();
            for (const s of more) { drawStroke(E, s.pts, s.w, undefined, { raw: true }); let g = 0; while (E._bakeJobs.length && g++ < 1000) E._bakeTick(); }
            out.pacedPerStroke = ms((performance.now() - t0) / more.length);
            out.pacedRendersPerStroke = (acc.renders - a0.renders) / more.length;
            out.pacedRenderMsPerStroke = ms((acc.renderMs - a0.renderMs) / more.length);
            E._render = render0;
        }
        out.natives = natives(E);
        out.pieces = vertexCount(E);
        // 2. Render at the drawing level: cold (tiles rebuilt) and warm (signature diff only).
        out.renderCold = ms(timeIt(() => { E.store.bumpEpoch(); E._render(); }));
        out.renderWarm = ms(timeIt(() => E._render(), 5) / 5);
        // 3. An in-level zoom step and a pan step, as the wheel/pointer would issue them.
        out.zoomStep = ms(timeIt(() => E.zoomAt(400, 300, -100), 10) / 10);
        out.panStep = ms(timeIt(() => { E.setTool("pan"); E.panBy(7, 3); }, 10) / 10);
        // 4. A crossing: zoom about the centre until the level changes (tiles baked up).
        let steps = 0;
        out.crossing = ms(timeIt(() => { while (E.activeLevel === 0 && steps++ < 200) E.zoomAt(400, 300, -600); }));
        out.crossingLevel = E.activeLevel;
        out.renderAtL1 = ms(timeIt(() => E._render(), 3) / 3);
        // back up to level 0
        steps = 0;
        while (E.activeLevel > 0 && steps++ < 400) E.zoomAt(400, 300, 600);
        // 5. An erase across the dense middle: the per-tick target search is a scan.
        const nBefore = natives(E);
        E.setEraserSize(20);
        out.erase = ms(timeIt(() => { eraseGesture(E, [[300, 300], [500, 320]]); E.flushErases(); }));
        out.eraseTouched = natives(E) - nBefore;
        // 5b. What the erase actually did, from the journal.
        const enote = (E.journal || []).filter((j) => j.kind === "erase").slice(-1)[0];
        out.eraseCuts = enote && enote.cuts ? enote.cuts.length : null;
        out.eraseRefused = enote && enote.refused ? enote.refused.length : 0;
        // 6. A lasso round everything through the pointer path (a drag with nothing
        // selected is a lasso), then a render and a zoom step with the ants up.
        E.setTool("select");
        const tL = performance.now();
        E.pointerDown(5, 5); E.pointerMove(795, 5); E.pointerMove(795, 595); E.pointerMove(5, 595); E.pointerMove(5, 5);
        const tUp = performance.now();
        E.pointerUp();
        out.lassoMove = ms(tUp - tL); out.lassoUp = ms(performance.now() - tUp);
        const sel = E._sel || E.selection || E._selection;
        out.selected = sel ? (sel.size != null ? sel.size : (sel.length != null ? sel.length : Object.keys(sel).length)) : "?";
        out.renderSelected = ms(timeIt(() => E._render(), 3) / 3);
        out.zoomStepSelected = ms(timeIt(() => E.zoomAt(400, 300, -50), 5) / 5);
        // one drag step of the whole selection
        E.pointerDown(400, 300);
        out.dragStep = ms(timeIt(() => E.pointerMove(403, 301)));
        E.pointerUp();
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(out));
    });
});
