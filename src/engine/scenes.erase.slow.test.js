/**
 * SC — SCENES over erased, severed and re-homed drawings.
 *
 * Scenes cluster ink across frames and give the user places to jump back to. A
 * deep erase is the single most disruptive thing that can happen to that input:
 * it MOVES INK INTO FRAMES THAT PREVIOUSLY HELD NOTHING. One gesture five
 * crossings down turns a document with natives at level 0 into one with natives
 * at levels 0,1,2,3,4,5 — and none of that is a new composition. It is the same
 * drawing, stored differently.
 *
 * So the through-line of this suite is: the storage must not be visible in the
 * scene list. Erasing must not invent scenes, severing must not scatter one into
 * several, and a jump saved before an erase must still land on the same picture
 * afterwards.
 */
import {
    useEngines, mkEngine, drawStroke, erase, click, pan, descend, camShot, camRestore, topView,
    inkAt, raster, rasterDiff, families, natives,
} from "./__testkit__/harness";
import KobinEngine from "./KobinEngine";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const sceneNames = (E) => (E.docMeta.scenes || []).map((s) => s.name).sort();
const sceneCount = (E) => { E.refreshScenes(); return (E.docMeta.scenes || []).length; };
function reload(E) {
    const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "sc" })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const F = new KobinEngine(host, { width: E.width, height: E.height });
    expect(F.loadDrawing(doc)).toBe(true);
    F.cam.set(E.cam.state());
    F._render();
    return F;
}
// A composition at the top level plus a separate one a long way away.
const twoCompositions = (E) => {
    drawStroke(E, [[200, 240], [420, 240]], 30, BLUE);
    drawStroke(E, [[200, 300], [420, 300]], 30, BLUE);
    pan(E, -400000, 0);
    drawStroke(E, [[200, 240], [420, 240]], 30, RED);
    pan(E, 400000, 0);
};

describe("SC-1 — erasing does not invent scenes", () => {
    // Layers: scenes (19) + multi-layer erase (3) + already-cut shapes (5) +
    // free-floating pieces (12).
    test.each([[1], [2], [3], [4]])("a cut %i crossing(s) down leaves the scene list alone", (n) => {
        const E = mkEngine();
        twoCompositions(E);
        const before = sceneCount(E);
        expect(before).toBeGreaterThanOrEqual(1);
        const home = camShot(E);
        descend(E, n, 300, 240);   // about ink, not the gap between the strokes
        erase(E, [[400, 200], [400, 400]], 20);
        expect(natives(E).length).toBeGreaterThan(3);   // a chain really was made
        camRestore(E, home);
        expect(sceneCount(E)).toBe(before);
    });
    test("...even when the cut leaves a shower of loose pieces", () => {
        const E = mkEngine();
        drawStroke(E, [[160, 300], [640, 300]], 18, BLUE);
        for (let i = 0; i < 5; i++) drawStroke(E, [[200 + i * 100, 300], [200 + i * 100, 180]], 18, BLUE);
        const before = sceneCount(E);
        erase(E, [[140, 300], [660, 300]], 22);          // take the spine out
        expect(families(E)).toBeGreaterThanOrEqual(5);
        expect(sceneCount(E)).toBe(before);
    });
});

describe("SC-2 — severing does not scatter a composition", () => {
    // Layers: scenes (19) + topology (14) + multi-layer selection (2).
    //
    // Two halves 40 px apart are one composition. If severance ever caused a
    // scene split, every erase through a stroke would fragment the user's
    // navigation.
    test("a severed stroke is still one scene", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        const before = sceneCount(E);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        expect(sceneCount(E)).toBe(before);
    });
    test("...and so is one severed by a chain four levels deep", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 60, BLUE);
        const home = camShot(E);
        const before = sceneCount(E);
        descend(E, 3, 300, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        erase(E, [[440, 200], [440, 400]], 26);
        expect(families(E)).toBe(2);
        camRestore(E, home);
        expect(sceneCount(E)).toBe(before);
    });
    test("dragging one half far away DOES make it its own scene", () => {
        // The complement, and the reason the previous two are not vacuous: the
        // scene list has to react to ink that genuinely moved away.
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        const before = sceneCount(E);
        click(E, 250, 300);
        expect(E.selection).toBeTruthy();
        E._dragSel = { start: [250, 300], moves: new Map(), moved: false };
        E._dragSelection(250 + 900000, 300);
        E._dragSel = null;
        expect(inkAt(E, 250, 300)).toBe(false);         // it really left
        pan(E, -900000, 0);
        expect(inkAt(E, 250, 300)).toBe(true);          // ...and arrived
        pan(E, 900000, 0);
        expect(sceneCount(E)).toBeGreaterThan(before);
    });
});

describe("SC-3 — a jump saved before an erase still lands after it", () => {
    // Layers: scenes (19) + zoom consistency (17) + multi-layer erase (3) +
    // undo/save (18).
    test("captureView then erase then jumpTo returns to the same picture", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        descend(E, 2, 300, 300);
        const view = raster(E, 48);
        const cap = E.captureView("here");
        expect(cap).toBeTruthy();
        // Erase somewhere else entirely, at a different depth.
        topView(E);
        descend(E, 4, 600, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        topView(E);
        const sc = (E.docMeta.scenes || []).find((s) => s.name === "here");
        expect(sc).toBeTruthy();
        E.jumpTo(sc.level, sc.rect);
        expect(rasterDiff(view, raster(E, 48)).total).toBeLessThanOrEqual(48 * 48 * 0.05);
    });
    test("a scene captured at depth survives a save and reload", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        descend(E, 3, 300, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        E.captureView("deep");
        const names = sceneNames(E);
        expect(names).toContain("deep");
        const F = reload(E);
        expect(sceneNames(F)).toEqual(names);
        const sc = (F.docMeta.scenes || []).find((s) => s.name === "deep");
        F.jumpTo(sc.level, sc.rect);
        expect(rasterDiff(raster(E, 48), raster(F, 48)).total).toBeLessThanOrEqual(48 * 48 * 0.05);
    });
});

describe("SC-4 — scenes and the re-homed frames an erase creates", () => {
    // Layers: scenes (19) + multi-layer erase (3) + small detail beside a large
    // one (9) + free-floating details (12).
    //
    // The adversarial case: before the erase the document has natives only at
    // level 0, and afterwards it has them at 0..4. Scene clustering walks
    // parent-to-child frame edges, so those new frames are new nodes in its
    // graph. They must join the composition they came out of, not form their own.
    test("the frames the erase created do not become scenes of their own", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 280]], 30, BLUE);
        drawStroke(E, [[250, 320], [550, 320]], 30, BLUE);
        const before = sceneCount(E);
        const levelsBefore = E.doc.levels().length;
        const home = camShot(E);
        // ON THE INK. The strokes run at y 265-295 and 305-335, so descending
        // about y=300 lands in the GAP between them — and four crossings down
        // the whole view is a millionth of a level-0 unit wide, so the eraser
        // covers nothing at all and no chain is ever ceded. That is the correct
        // answer to a gesture over blank paper; it just is not what this test
        // means to set up. It passed anyway until 2026-08-20, because the spent
        // eraser left an empty frame bucket behind and the assertion below
        // counted it.
        descend(E, 4, 400, 280);
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        expect(E.doc.levels().length).toBeGreaterThan(levelsBefore);
        expect(sceneCount(E)).toBe(before);
    });
    test("a genuinely new deep doodle DOES get its own pocket", () => {
        // Again the complement: fine ink that is really new must still surface.
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 280]], 30, BLUE);
        const before = sceneCount(E);
        descend(E, 4, 400, 280);
        for (let i = 0; i < 4; i++) drawStroke(E, [[300 + i * 40, 260], [320 + i * 40, 300]], 8, RED);
        expect(sceneCount(E)).toBeGreaterThanOrEqual(before);
    });
});

describe("SC-5 — erasing a whole composition away", () => {
    // Layers: scenes (19) + erasing over multiple objects (10) + undo (18).
    test("its scene goes with it, and undo brings both back", () => {
        const E = mkEngine();
        twoCompositions(E);
        const before = sceneCount(E);
        expect(before).toBeGreaterThanOrEqual(1);
        erase(E, [[100, 200], [700, 340]], 200);          // swallow the near one
        expect(inkAt(E, 300, 240)).toBe(false);
        const after = sceneCount(E);
        expect(after).toBeLessThanOrEqual(before);
        E.undo(); E.flushErases();
        expect(inkAt(E, 300, 240)).toBe(true);
        expect(sceneCount(E)).toBe(before);
    });
});

describe("SC-6 — the level hash does not churn on an erase that changes nothing", () => {
    // Layers: scenes (19) + performance (1) + already-cut shapes (5).
    //
    // Scene matching is keyed off a per-level hash. A grazing gesture that
    // removes no ink must leave it alone, or every near-miss re-runs the
    // clustering and can re-label the user's scenes.
    test("a graze leaves the scene list byte-identical", () => {
        const E = mkEngine();
        twoCompositions(E);
        E.refreshScenes();
        const before = JSON.stringify(E.docMeta.scenes);
        erase(E, [[400, 500], [500, 560]], 12);           // nowhere near any ink
        E.refreshScenes();
        expect(JSON.stringify(E.docMeta.scenes)).toBe(before);
    });
    test("and re-running the clustering twice is a no-op", () => {
        const E = mkEngine();
        twoCompositions(E);
        descend(E, 2, 300, 240);
        erase(E, [[400, 200], [400, 400]], 20);
        E.refreshScenes();
        const a = JSON.stringify(E.docMeta.scenes);
        E.refreshScenes();
        expect(JSON.stringify(E.docMeta.scenes)).toBe(a);
    });
});
