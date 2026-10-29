/**
 * SC — SCENES over erased, severed and re-homed drawings (SCENES-PLAN §6 rule 2, rows 14–14b).
 *
 * A deep erase moves ink into frames that held nothing: one gesture five crossings down turns a
 * drawing with natives at level 0 into one with natives at 0..5. That is STORAGE — re-homed
 * patches, pieces, severed halves — and storage must never make a scene. What a fine eraser
 * carved is DETAIL at the eraser's width (Kobin, 2026-09-22: "a tiny dot eraser on a large object
 * should become its own scene, because otherwise that detail would be lost"): exactly one child
 * scene, framed on the carving, made of the erase's footprint and nothing else.
 */
import {
    useEngines, mkEngine, drawStroke, erase, click, pan, descend, camShot, camRestore, topView,
    inkAt, raster, rasterDiff, families, natives,
} from "./__testkit__/harness";
import KobinEngine from "./KobinEngine";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const list = (E) => E.refreshScenes().filter((s) => !s.kind);
const sceneNames = (E) => list(E).map((s) => s.name).sort();
const sceneCount = (E) => list(E).length;
/** The scenes made of erase footprints alone (item ids < 0): what a fine erase adds. */
const carvings = (E) => {
    E.refreshScenes();
    const c = E._sceneClient.core;
    return [...c.scenes].filter((S) => [...S.members].every((m) => m.id < 0)).map((S) => S.idn.id);
};
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

describe("SC-1 — a deep cut adds its carving and nothing else", () => {
    test.each([[1], [2], [3], [4]])("a cut %i crossing(s) down adds one child scene, made of the footprint alone", (n) => {
        const E = mkEngine();
        twoCompositions(E);
        const before = list(E);
        expect(before.length).toBe(2);
        const home = camShot(E);
        descend(E, n, 300, 240);   // about ink, not the gap between the strokes
        erase(E, [[400, 200], [400, 400]], 20);
        expect(natives(E).length).toBeGreaterThan(3);   // a chain really was made
        camRestore(E, home);
        const after = list(E);
        expect(after.length).toBe(before.length + 1);
        const carved = carvings(E);
        expect(carved.length).toBe(1);
        const kid = after.find((s) => s.id === carved[0]);
        expect(kid.parent).toBeTruthy();                 // nested under what it carved
        for (const s of before) expect(after.some((a) => a.id === s.id)).toBe(true);
    });
    test("a cut at the ink's own level that leaves a shower of loose pieces adds nothing", () => {
        const E = mkEngine();
        drawStroke(E, [[160, 300], [640, 300]], 18, BLUE);
        for (let i = 0; i < 5; i++) drawStroke(E, [[200 + i * 100, 300], [200 + i * 100, 180]], 18, BLUE);
        const before = sceneCount(E);
        erase(E, [[140, 300], [660, 300]], 22);          // take the spine out
        expect(families(E)).toBeGreaterThanOrEqual(5);
        expect(sceneCount(E)).toBe(before);
        expect(carvings(E)).toEqual([]);
    });
});

describe("SC-2 — severing does not scatter a composition", () => {
    // Two halves 40 px apart are one composition: an erase through a stroke must not fragment
    // the user's navigation.
    test("a severed stroke is still one scene", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        const before = list(E);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        const after = list(E);
        expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    });
    test("...and so is one severed by a chain four levels deep; only the deep carving adds a scene", () => {
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
        expect(sceneCount(E)).toBe(before + 1);
        expect(carvings(E).length).toBe(1);
    });
    test("dragging one half far away DOES make it its own scene", () => {
        // The complement, and the reason the previous two are not vacuous.
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        const before = sceneCount(E);
        click(E, 250, 300);
        expect(E.selection).toBeTruthy();
        E._dragSel = { start: [250, 300], moves: new Map(), moved: false };
        E._dragSelection(250 + 900000, 300);
        E._endMove("drop");                             // a drag writes only at its drop (A1 C2)
        expect(inkAt(E, 250, 300)).toBe(false);         // it really left
        pan(E, -900000, 0);
        expect(inkAt(E, 250, 300)).toBe(true);          // ...and arrived
        pan(E, 900000, 0);
        expect(sceneCount(E)).toBeGreaterThan(before);
    });
});

describe("SC-3 — a scene's jump still lands after an erase elsewhere, and after a reload", () => {
    test("jumpTo a scene after a deep erase elsewhere shows the same picture", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const [sc] = list(E);
        E.jumpTo(sc.level, sc.rect);
        const view = raster(E, 48);
        topView(E);
        descend(E, 4, 600, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        topView(E);
        const again = list(E).find((s) => s.id === sc.id);
        expect(again).toBeTruthy();
        E.jumpTo(again.level, again.rect);
        expect(rasterDiff(view, raster(E, 48)).total).toBeLessThanOrEqual(48 * 48 * 0.05);
    });
    test("a named carving survives a save and reload and lands on the same picture", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, 3, 300, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        const [id] = carvings(E);
        expect(E.renameScene(id, "deep")).toBe(true);
        const names = sceneNames(E);
        expect(names).toContain("deep");
        const F = reload(E);
        expect(sceneNames(F)).toEqual(names);
        const a = list(E).find((s) => s.name === "deep"), b = list(F).find((s) => s.name === "deep");
        E.jumpTo(a.level, a.rect); F.jumpTo(b.level, b.rect);
        expect(rasterDiff(raster(E, 48), raster(F, 48)).total).toBeLessThanOrEqual(48 * 48 * 0.05);
        F.destroy();
    });
});

describe("SC-4 — the frames an erase creates are storage", () => {
    // Before the erase the document has natives only at level 0, and afterwards at 0..4: new
    // frames, new natives, and none of it a composition.
    test("the re-homed patches make no scene; the carving is the one new scene", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 280]], 30, BLUE);
        drawStroke(E, [[250, 320], [550, 320]], 30, BLUE);
        const before = sceneCount(E);
        const levelsBefore = E.doc.levels().length;
        const home = camShot(E);
        descend(E, 4, 400, 280);   // on the ink (y 265–295), not in the gap
        erase(E, [[400, 240], [400, 360]], 16);
        camRestore(E, home);
        expect(E.doc.levels().length).toBeGreaterThan(levelsBefore);
        expect(sceneCount(E)).toBe(before + 1);
        expect(carvings(E).length).toBe(1);
    });
    test("a genuinely new deep doodle DOES get its own scene", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 280]], 30, BLUE);
        const before = sceneCount(E);
        descend(E, 4, 400, 280);
        for (let i = 0; i < 4; i++) drawStroke(E, [[300 + i * 40, 260], [320 + i * 40, 300]], 8, RED);
        expect(sceneCount(E)).toBe(before + 1);
        expect(carvings(E)).toEqual([]);
    });
});

describe("SC-5 — erasing a whole composition away", () => {
    test("its scene goes with it, and undo brings it back with its id", () => {
        const E = mkEngine();
        twoCompositions(E);
        const before = list(E);
        erase(E, [[100, 200], [700, 340]], 200);          // swallow the near one
        expect(inkAt(E, 300, 240)).toBe(false);
        expect(sceneCount(E)).toBe(before.length - 1);
        E.undo(); E.flushErases();
        expect(inkAt(E, 300, 240)).toBe(true);
        expect(list(E).map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
    });
});

describe("SC-6 — an erase that changes nothing leaves the scenes alone", () => {
    test("a graze leaves the scene list byte-identical", () => {
        const E = mkEngine();
        twoCompositions(E);
        const before = JSON.stringify(E.refreshScenes());
        erase(E, [[400, 500], [500, 560]], 12);           // nowhere near any ink
        expect(JSON.stringify(E.refreshScenes())).toBe(before);
    });
    test("and asking twice is a no-op", () => {
        const E = mkEngine();
        twoCompositions(E);
        descend(E, 2, 300, 240);
        erase(E, [[400, 200], [400, 400]], 20);
        const a = JSON.stringify(E.refreshScenes());
        expect(JSON.stringify(E.refreshScenes())).toBe(a);
    });
});
