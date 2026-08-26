/**
 * F — Erase fidelity (docs/erase-tile-window-test-catalog.md).
 *
 * "The hole must be the shape the mark was." The eraser commits instantly as
 * background-coloured ink and baking replaces that mark with a boolean hole; if
 * the two disagree it reads to the user as the erase moving after the fact, and
 * no structural test can see it because mark and hole are each individually
 * well-formed.
 *
 * Why F-3 exists: the reverted 2026-07-28 attempt put the hole 25.2 px from a
 * 20 px mark at two crossings' depth. `flattenCurve` mirrors Two.js faithfully,
 * including its habit of collapsing an anchor's handles whenever a neighbour is
 * within a hardcoded ABSOLUTE 1e-4 — two levels of minification put every anchor
 * inside that, every handle collapsed, and the clip quietly became the chord
 * polygon instead of the painted curve. Build the footprint in the frame it was
 * drawn in and MAP it; rebuilding it from projected points does not give the
 * same answer.
 */
import KobinEngine from "./KobinEngine";
import { markOf, compareMark } from "./__testkit__/fidelity";

jest.setTimeout(120000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) { try { engines.pop().destroy(); } catch (e) { /* ignore */ } } });

const drawStroke = (E, pts, width = 13) => {
    E.setTool("pen"); E.setWidth(width);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    return E.doc.at(E.cam.frame)[E.doc.at(E.cam.frame).length - 1];
};
const eraseGesture = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    return E.doc.at(E.cam.frame).find((o) => o.erase);
};
// Zoom in `n` crossings about the canvas centre.
const descend = (E, n, w = 800, h = 600) => {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 400) E.zoomAt(w / 2, h / 2, -1000);
    expect(E.activeLevel).toBe(n);
};

/**
 * Run one scenario twice — without the erase, then with it — and measure how
 * far the hole strays from the mark. `build(E)` lays down the ink; `erase(E)`
 * performs the gesture and returns the eraser native.
 */
function fidelity(build, erase, opts = {}) {
    const w = opts.w || 800, h = opts.h || 600;
    const A = mkEngine(w, h);
    build(A);
    A._render();
    const before = A._objs().slice();

    const B = mkEngine(w, h);
    build(B);
    const eraser = erase(B);
    expect(eraser).toBeTruthy();
    const mark = markOf(B, eraser);
    const inScale = B.cam.inScale;
    B.flushErases();
    B._render();
    const after = B._objs().filter((o) => !o.erase);

    // Sub-pixel slack: a sample sitting on the eraser's own antialiased edge is
    // genuinely ambiguous, and so is one within the boolean's own lattice.
    return { ...compareMark(before, after, mark, inScale, { slackPx: 0.5, n: opts.n || 120 }), inScale };
}

const BAR_PX = 1;

describe("F-1 — a gesture at the object's own level", () => {
    test("mark and hole agree within a pixel", () => {
        const r = fidelity(
            (E) => { drawStroke(E, [[250, 300], [550, 300]], 24); },
            (E) => { E.setEraserSize(20); return eraseGesture(E, [[400, 260], [400, 340]]); },
        );
        expect(r.inkBefore).toBeGreaterThan(200); // the probe actually sampled ink
        expect(r.removed).toBeGreaterThan(20);    // ...and the erase actually did something
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-2/F-3 — the same gesture N crossings below the target", () => {
    // At depth the target is magnified 3000^N and the eraser stays screen-sized:
    // this is the regime the whole design exists for. N = 1,2,3 is the ordinary
    // deep erase; 4,5,6 is past the point where a hole could exist in the
    // object's own frame at all (float64 runs out at four).
    test.each([[1], [2], [3], [4], [5], [6]])("%i crossing(s) deep", (n) => {
        const r = fidelity(
            (E) => { drawStroke(E, [[250, 300], [550, 300]], 24); descend(E, n); },
            (E) => { E.setEraserSize(20); return eraseGesture(E, [[400, 260], [400, 340]]); },
        );
        expect(r.inkBefore).toBeGreaterThan(200);
        expect(r.removed).toBeGreaterThan(20);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-4 — gesture shape", () => {
    // The spline only leaves its chords where the gesture TURNS, so the turning
    // shapes are what a chord-vs-curve mistake shows up in; the dab and the
    // straight line pin cap and join geometry instead.
    const shapes = {
        dab: [[400, 300]],
        straight: [[340, 300], [460, 300]],
        zigzag: [[340, 260], [380, 340], [420, 260], [460, 340]],
        hairpin: [[340, 300], [440, 300], [340, 320]],
        loop: [[380, 280], [430, 280], [430, 330], [380, 330], [380, 285]],
        sweep: Array.from({ length: 40 }, (_, i) => [260 + i * 7, 300 + 40 * Math.sin(i / 4)]),
    };
    test.each(Object.keys(shapes))("%s", (name) => {
        const r = fidelity(
            (E) => { drawStroke(E, [[200, 300], [600, 300]], 110); },
            (E) => { E.setEraserSize(18); return eraseGesture(E, shapes[name]); },
        );
        expect(r.removed).toBeGreaterThan(5);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-5 — fidelity is independent of eraser radius", () => {
    test.each([[6], [20], [60]])("radius %i px", (px) => {
        const r = fidelity(
            (E) => { drawStroke(E, [[250, 300], [550, 300]], 40); descend(E, 1); },
            (E) => { E.setEraserSize(px); return eraseGesture(E, [[400, 250], [400, 350]]); },
        );
        expect(r.removed).toBeGreaterThan(5);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-6 — translucent ink erases to the same shape as opaque", () => {
    test("opacity 0.4", () => {
        const r = fidelity(
            (E) => { E.setOpacity(0.4); drawStroke(E, [[250, 300], [550, 300]], 30); },
            (E) => { E.setEraserSize(20); return eraseGesture(E, [[400, 260], [400, 340]]); },
        );
        expect(r.removed).toBeGreaterThan(20);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-8 — a second gesture is faithful to ITS OWN mark", () => {
    // Not to the union of both. A bake that re-derived from the union would
    // still look plausible here; measuring against the second mark alone is
    // what separates them.
    test("the second bite lands where it was drawn", () => {
        const build = (E) => {
            drawStroke(E, [[250, 300], [550, 300]], 30);
            E.setEraserSize(14);
            E.setTool("erasePartial");
            E.pointerDown(330, 300); E.pointerUp();
            E.flushErases();
        };
        const r = fidelity(build, (E) => { E.setEraserSize(14); return eraseGesture(E, [[470, 300]]); });
        expect(r.removed).toBeGreaterThan(5);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});

describe("F-9 — a gesture running off the object's edge cuts it cleanly in two", () => {
    test("both halves hit-test; the gap does not", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 20);
        E.setEraserSize(18);
        eraseGesture(E, [[400, 240], [400, 360]]);
        E.flushErases();
        E._render();
        expect(E._hitTest(300, 300)).not.toBeNull();
        expect(E._hitTest(500, 300)).not.toBeNull();
        expect(E._hitTest(400, 300)).toBeNull();
        // ...and they really are two objects now, not one with a hole.
        expect(E._hitTest(300, 300)).not.toBe(E._hitTest(500, 300));
    });
});

describe("F-7 — erasing what an earlier erase left behind", () => {
    test("a fill erases as faithfully as the stroke it came from", () => {
        const build = (E) => {
            drawStroke(E, [[250, 300], [550, 300]], 30);
            E.setEraserSize(16);
            E.setTool("erasePartial");
            E.pointerDown(400, 240); E.pointerMove(400, 360); E.pointerUp();
            E.flushErases(); // severed: both survivors are fills now
            expect(E.doc.at("0").every((o) => o.type === "shape")).toBe(true);
        };
        const r = fidelity(build, (E) => { E.setEraserSize(14); return eraseGesture(E, [[320, 300]]); });
        expect(r.removed).toBeGreaterThan(5);
        expect(r.overPx).toBeLessThanOrEqual(BAR_PX);
        expect(r.underPx).toBeLessThanOrEqual(BAR_PX);
    });
});
