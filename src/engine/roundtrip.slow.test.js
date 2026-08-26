/**
 * RT — UNDO, SAVE/RELOAD, AND SCENES over erased and severed drawings.
 *
 * Everything the erase machinery builds is state that has to survive leaving:
 * ceded windows, back-pointers from a child to the source it came out of, the
 * family key that decides what moves with what, and eraser strokes that had not
 * finished baking when the file was written. A reload that drops any of it does
 * not look broken — it looks like a drawing whose holes have healed, or whose
 * halves have quietly re-joined and now drag as one.
 *
 * Undo has the same shape of problem in miniature: one gesture is one op, but it
 * may have re-homed through five frames, severed a family in two and re-keyed a
 * dozen natives. Ctrl+Z has to unwind all of it and nothing else.
 */
import {
    useEngines, mkEngine, drawStroke, erase, eraseGesture, drag, click,
    descend, camShot, camRestore, topView, inkAt, raster, rasterDiff,
    families, natives, painted, picture,
} from "./__testkit__/harness";
import KobinEngine from "./KobinEngine";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
// Save from one engine and load into a brand-new one, camera and all.
function reload(E) {
    const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "rt" })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const F = new KobinEngine(host, { width: E.width, height: E.height });
    expect(F.loadDrawing(doc)).toBe(true);
    F.cam.set(E.cam.state());
    F._render();
    return F;
}

describe("RT-1 — a deep erase, saved and reloaded", () => {
    // Layers: undo/save (18) + multi-layer erase (3) + zoom consistency (17) +
    // already-cut shapes (5).
    test.each([[1], [2], [3], [4]])("depth %i: identical picture at three levels", (n) => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        drawStroke(E, [[100, 380], [700, 380]], 40, RED);
        const home = camShot(E);
        descend(E, n, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        const deep = camShot(E);
        const F = reload(E);
        expect(rasterDiff(raster(E, 56), raster(F, 56)).total).toBe(0);
        for (const cam of [home, deep]) {
            camRestore(E, cam); camRestore(F, cam);
            expect(rasterDiff(raster(E, 56), raster(F, 56)).total).toBe(0);
        }
    });
    test("the ceded windows and back-pointers come back too", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        const F = reload(E);
        const shape = (X) => natives(X).map((r) => [r.level, r.obj.type,
            (r.obj.windows || []).length, r.obj.srcId != null, r.obj.attachRect != null]).sort();
        expect(shape(F)).toEqual(shape(E));
        expect(families(F)).toBe(families(E));
    });
    test("and the reloaded drawing can still be erased and moved as one", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        const F = reload(E);
        camRestore(F, home);
        click(F, 200, 300);
        expect(F.selection).toBeTruthy();
        const n = natives(F).length;
        drag(F, [200, 300], [200, 420]);
        expect(natives(F).length).toBe(n);
        expect(inkAt(F, 200, 420)).toBe(true);
        expect(inkAt(F, 200, 300)).toBe(false);
    });
});

describe("RT-2 — a severance, saved and reloaded", () => {
    // Layers: undo/save (18) + topology (14) + multi-layer selection (2) +
    // moving (6).
    //
    // The family key is the whole of the severance: geometry alone cannot say
    // whether two lumps of ink are one object or two. If the key does not
    // survive the file, the halves silently re-join.
    test("it is still two objects, and they still move apart", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        const F = reload(E);
        expect(families(F)).toBe(2);
        click(F, 220, 300);
        const left = F.selection.editId;
        click(F, 580, 300);
        expect(F.selection.editId).not.toBe(left);
        drag(F, [580, 300], [580, 460]);
        expect(inkAt(F, 220, 300)).toBe(true);
        expect(inkAt(F, 220, 460)).toBe(false);
    });
    test("a DEEP severance survives with both chains intact", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        // A deep nick builds the chain, then the severing cut is made at the
        // object's own level — the cheap way to stage this. (Severing from BELOW
        // works too and is covered at four depths in erase.deepsever; here the
        // subject under test is the FILE, so the cut is made wherever it is
        // quickest to reach.)
        descend(E, 2, 250, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        erase(E, [[440, 200], [440, 400]], 26);
        expect(families(E)).toBe(2);
        const F = reload(E);
        expect(families(F)).toBe(2);
        // Every native still points at a parent that exists, or at nothing.
        for (const { obj } of natives(F)) {
            if (obj.srcId != null) expect(F.doc.getById(obj.srcId)).toBeTruthy();
        }
        // And the two chains are the same size they were.
        const sizes = (X) => {
            const m = new Map();
            for (const { obj } of natives(X)) {
                const k = X.doc.editKey(obj);
                m.set(k, (m.get(k) || 0) + 1);
            }
            return [...m.values()].sort();
        };
        expect(sizes(F)).toEqual(sizes(E));
    });
    test("a family key never collides with an object id after a reload", () => {
        // The keys are minted from the same counter as ids. If a reload restarts
        // the counter below a live key, the next object drawn gets an id equal to
        // it and joins that family — inheriting a drag it has nothing to do with.
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        const F = reload(E);
        const keys = new Set(natives(F).map((r) => F.doc.editKey(r.obj)));
        const fresh = drawStroke(F, [[150, 500], [650, 500]], 20, RED);
        expect(keys.has(fresh.id)).toBe(false);
        expect(families(F)).toBe(3);
    });
});

describe("RT-3 — undo of an erase", () => {
    // Layers: undo (18) + multi-layer erase (3) + already-cut shapes (5) +
    // topology (14).
    test.each([[0], [1], [2], [3]])("depth %i: undo restores the picture exactly", (n) => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        if (n) descend(E, n, 400, 300);
        const before = raster(E, 56);
        const doc0 = picture(E);
        erase(E, [[400, 240], [400, 360]], 18);
        expect(rasterDiff(before, raster(E, 56)).total).toBeGreaterThan(0);
        E.undo(); E.flushErases();
        expect(rasterDiff(before, raster(E, 56)).total).toBe(0);
        expect(picture(E)).toBe(doc0);
        camRestore(E, home);
        expect(families(E)).toBe(1);
    });
    test("undo of a severance puts one object back, not two", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        const doc0 = picture(E);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        E.undo(); E.flushErases();
        expect(families(E)).toBe(1);
        expect(picture(E)).toBe(doc0);
        click(E, 220, 300);
        const key = E.selection.editId;
        click(E, 580, 300);
        expect(E.selection.editId).toBe(key);      // one object again
    });
    test("undo of a DEEP severance unwinds the whole chain and the re-keying", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        const doc0 = picture(E);
        descend(E, 2, 250, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        const nicked = picture(E);
        const chain = natives(E).length;
        expect(chain).toBeGreaterThan(1);
        erase(E, [[440, 200], [440, 400]], 26);        // sever, at its own level
        expect(families(E)).toBe(2);
        // The severance re-keyed and re-parented the whole chain. Undo has to
        // put every one of those back, and only those — the nick stays.
        E.undo(); E.flushErases();
        expect(families(E)).toBe(1);
        expect(natives(E).length).toBe(chain);
        expect(picture(E)).toBe(nicked);
        E.undo(); E.flushErases();
        expect(natives(E).length).toBe(1);
        expect(picture(E)).toBe(doc0);
    });
    test("undo/redo three times round is stable", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        const clean = picture(E);
        erase(E, [[400, 220], [400, 380]], 26);
        const cut = picture(E);
        for (let i = 0; i < 3; i++) {
            E.undo(); E.flushErases();
            expect(picture(E)).toBe(clean);
            E.redo(); E.flushErases();
            expect(picture(E)).toBe(cut);
        }
        expect(families(E)).toBe(2);
    });
});

describe("RT-4 — undo made from a different level than the erase", () => {
    // Layers: undo (18) + zoom consistency (17) + multi-layer erase (3).
    //
    // Ctrl+Z is pressed wherever the user happens to be standing, which is
    // usually not where the erase was made — they zoomed out to see what they
    // had done.
    test("erase at depth 3, zoom to the top, undo there", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
        const home = camShot(E);
        const doc0 = picture(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        E.undo(); E.flushErases();
        expect(picture(E)).toBe(doc0);
        expect(natives(E).length).toBe(1);
    });
});

describe("RT-5 — saving in the middle of a bake", () => {
    // Layers: undo/save (18) + performance (1, deferred baking) + multi-layer
    // erase (3).
    //
    // The eraser mark is committed instantly and baked later, so a file can
    // easily be written with the gesture recorded and the boolean not yet done.
    // Reloading has to resume it and land on the same drawing as if it had
    // finished before the save.
    test("the reload finishes the erase and matches the fully-baked original", () => {
        const build = (E) => {
            drawStroke(E, [[100, 300], [700, 300]], 70, BLUE);
            descend(E, 2, 400, 300);
        };
        const A = mkEngine(); build(A);
        eraseGesture(A, [[400, 240], [400, 360]], 18); A.flushErases();

        const B = mkEngine(); build(B);
        eraseGesture(B, [[400, 240], [400, 360]], 18);   // NOT flushed
        B._render();
        expect(B.doc.at(B.cam.frame).some((o) => o.erase)).toBe(true);
        const F = reload(B);
        expect(natives(F).some((r) => r.obj.erase)).toBe(false);   // `natives` skips them
        F.flushErases();
        camRestore(F, A.cam.state());
        expect(rasterDiff(raster(A, 56), raster(F, 56)).total).toBeLessThanOrEqual(2);
    });
    test("and the resumed erase is undoable in the reloaded engine", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        eraseGesture(E, [[400, 220], [400, 380]], 26);
        const F = reload(E);
        F.flushErases();
        expect(families(F)).toBe(2);
        F.undo(); F.flushErases();
        expect(inkAt(F, 400, 300)).toBe(true);
    });
});

describe("RT-6 — scenes over an erased and severed drawing", () => {
    // Layers: scenes (19) + multi-layer erase (3) + topology (14) + save (18).
    //
    // Scenes cluster ink across frames. A deep erase moves ink INTO new frames,
    // which is exactly the input scene clustering is most sensitive to: the
    // re-homed children are new natives at levels that previously held nothing.
    // Erasing part of a drawing must not invent scenes, and severing must not
    // scatter one scene into several.
    test("erasing does not multiply the scenes", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 280], [500, 280]], 30, BLUE);
        drawStroke(E, [[300, 320], [500, 320]], 30, BLUE);
        E.refreshScenes();
        const before = E.docMeta.scenes.length;
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        E.refreshScenes();
        expect(E.docMeta.scenes.length).toBe(before);
    });
    test("severing does not scatter one scene into several", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        E.refreshScenes();
        const before = E.docMeta.scenes.length;
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        E.refreshScenes();
        // Two halves 40 px apart are one composition, not two.
        expect(E.docMeta.scenes.length).toBe(before);
    });
    test("scenes survive save/reload with the erase state", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 280], [500, 280]], 30, BLUE);
        descend(E, 2, 400, 280);
        erase(E, [[400, 240], [400, 320]], 18);
        E.refreshScenes();
        const names = E.docMeta.scenes.map((s) => s.name).sort();
        const F = reload(E);
        expect(F.docMeta.scenes.map((s) => s.name).sort()).toEqual(names);
    });
});
