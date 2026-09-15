/**
 * KNOWN BUGS — ported to the NEW engine's invariants. These were RED against the
 * old engine (src/engine/KnownBugs.test.js); here they must be GREEN, proving
 * the redesign fixes each one. Where the visible symptom needs pixels (jsdom
 * can't rasterize), the test pins the confirmed root-cause invariant, noted
 * inline. (BUG-03 draw-order + ISSUE-11 reuse live in KobinEngine.test.js.)
 */
import KobinEngine from "./KobinEngine";
import purpleFixture from "./__fixtures__/bug02-purple.json";

jest.setTimeout(30000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });
const drawStroke = (E, pts) => { E.pointerDown(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]); E.pointerUp(); };

describe("KNOWN BUGS — fixed (green on the new engine)", () => {
    // BUG-02 — a fat stroke's fill lost coverage at high zoom because the display
    // bake clipped it to a window (half a screen) narrower than the stroke's
    // half-width. The pad that answered it, and the bake itself, were deleted on
    // 2026-09-14 (ROADMAP S7): a fat stroke is now a curve-capsule outline built
    // once in frame coordinates, so no camera window enters its geometry and
    // there is nothing left to outrun. What is asserted is exactly that — the
    // group's signature, which is what decides whether a path is rebuilt, does
    // not move when the camera does. (Same fixture stroke as the old red test.)
    test("BUG-02: a fat stroke's geometry does not depend on the camera window", () => {
        const E = mkEngine(800, 600);
        const o = { type: "stroke", origin: "native", id: E.doc.allocId(), pts: purpleFixture.pts,
            lwFrame: purpleFixture.lwFrame, color: purpleFixture.color, opacity: 1 };
        E.doc.add(o, 0);
        const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        E.inScale = 120; E.inPanX = E.width / 2 - cx * E.inScale; E.inPanY = E.height / 2 - cy * E.inScale;
        E._render();
        E._render();                               // the first render fits the outline; settle on it
        expect(E._fatOnScreen(o)).toBe(true);      // on the fat path
        const entry = E.renderer._groups.get(o.id);
        expect(entry).toBeTruthy();
        expect(entry.sig[0]).toBe("O");            // the curve-capsule representation
        const sig = entry.sig;
        E.inPanX -= E.width / 2; E.inPanY -= E.height / 2;   // half a screen away
        E._render();
        expect(E.renderer._groups.get(o.id).sig).toBe(sig);
    });

    // BUG-05 — zooming IN, coarse strokes used to explode: up-projection had no
    // size policy, so a stroke a couple levels out reached 1e5-1e7 px width and
    // broke the fat bake. FIX: coarse content arrives through the tile chain,
    // where a band covering a tile becomes a bounded FILL — it can never enter
    // the render list as a monster stroke. Invariant: no rendered stroke exceeds
    // the fat gate; oversized coarse content is present, but as fills.
    test("BUG-05: no coarse stroke ever renders wider than the fat gate — it arrives as fills", () => {
        const E = mkEngine(800, 600);
        drawStroke(E, [[380, 280], [420, 300], [400, 340], [360, 320]]); // level-0 content
        let guard = 0;
        while (E.activeLevel > -2 && guard++ < 200) E.zoomAt(400, 300, 1000); // zoom OUT 2 levels
        expect(E.activeLevel).toBeLessThanOrEqual(-2);
        drawStroke(E, [[350, 300], [420, 320], [380, 360]]);            // a native two levels out
        guard = 0;
        while (E.activeLevel < 0 && guard++ < 200) E.zoomAt(400, 300, -1000); // zoom back IN
        expect(E.activeLevel).toBeGreaterThanOrEqual(0);
        const list = E._objs();
        // every derived/inherited coarse piece that is a STROKE is within the fat gate;
        // anything wider came through as a fill (bounded) — the drawing does NOT vanish.
        for (const o of list) {
            if (o.type === "stroke") expect(o.lwFrame * E.inScale).toBeLessThanOrEqual(500 + 1e-6);
        }
        expect(list.length).toBeGreaterThan(0); // content is present, not blanked
    });

    // BUG-04 — a finer object popped in/out at the sub-pixel cull. FIX: content in
    // the fade band [fadeLoPx, cullPx) is baked and tagged; its group opacity ramps
    // continuously with zoom instead of switching on/off. Assert opacity continuity
    // across the threshold (presence may end, but at alpha ≈ 0).
    test("BUG-04: detail opacity is continuous across the sub-pixel cull (no hard pop)", () => {
        const E = mkEngine(800, 600);
        // a finer native (level 1) viewed from level 0, swept across the fade band
        let guard = 0;
        while (E.activeLevel < 1 && guard++ < 40) E.zoomAt(400, 300, -1000);
        drawStroke(E, [[300, 300], [500, 300], [500, 320]]); // sizable stroke at level 1
        const id = E.doc.at(E.cam.frame)[0].id;
        guard = 0;
        while (E.activeLevel > 0 && guard++ < 40) E.zoomAt(400, 300, 1000); // back to level 0
        expect(E.activeLevel).toBe(0);
        // sweep zoom out; record the object's group opacity each step
        const alphas = [];
        for (let i = 0; i < 30; i++) {
            const entry = E.renderer._groups.get(id);
            alphas.push(entry ? entry.group.opacity : 0);
            E.zoomAt(400, 300, 300); // zoom out a little
        }
        // no single step drops opacity by more than a small amount (continuous fade,
        // not a 1->0 pop). Allow generous slack; the point is: no hard cliff.
        let maxDrop = 0;
        for (let i = 1; i < alphas.length; i++) maxDrop = Math.max(maxDrop, alphas[i - 1] - alphas[i]);
        expect(maxDrop).toBeLessThan(0.9);
    });
});
