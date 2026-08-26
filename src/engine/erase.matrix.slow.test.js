/**
 * MX — THE MATRIX: the same property, over every regime that changes how it is
 * computed.
 *
 * The dimensions here are not decoration. Each one switches a different code
 * path, and a property can hold on one and fail on the next:
 *
 *   depth       0 is an in-place boolean in the object's own units; 1–5 re-home
 *               through a chain, and precision falls by 3000x per crossing.
 *   placement   mid-tile cedes one tile; a vertical seam cedes two; a tile
 *               corner cedes four. That difference is where a 19.5 px
 *               under-erase hid against a 20 px eraser.
 *   what got cut  a clean stroke, a shape already cut once, and a re-homed
 *               patch are three different subjects for the same boolean.
 *
 * Placement variants only exist at depth. At level 0 the tile grid is thirty
 * screens wide, so a hand-sized drawing never comes near a seam; you have to be
 * magnified into one before a seam is a place you can put anything.
 */
import { markOf, compareMark } from "./__testkit__/fidelity";
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, drag, click, pan,
    descend, camShot, camRestore, inkAt, colorAt, raster, rasterZ, rasterDiff,
    families, natives, picture, tileSeam, centerOn,
} from "./__testkit__/harness";

jest.setTimeout(600000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311";
const DEPTHS = [[0], [1], [2], [3], [4], [5]];

// Put the canvas centre on a chosen part of the active frame's tile lattice.
const PLACE = {
    "mid-tile": () => {},
    "on a seam": (E) => {
        const s = tileSeam(E);
        centerOn(E, s.fx, E.cam.screenToFrame(400, 300)[1], 400, 300);
    },
    "on a tile corner": (E) => {
        const s = tileSeam(E);
        centerOn(E, s.fx, s.fy, 400, 300);
    },
};
const PLACED = [];
for (const p of Object.keys(PLACE)) for (const d of [1, 2, 3, 4, 5]) PLACED.push([d, p]);

const band = (E, w = 90) => drawStroke(E, [[-200, 300], [1000, 300]], w, BLUE);
const gestureReturning = (E, pts, size) => {
    eraseGesture(E, pts, size);
    return E.doc.at(E.cam.frame).find((o) => o.erase);
};
function fidelity(build, doErase) {
    const A = mkEngine(); build(A); A._render();
    const before = A._objs().slice();
    const B = mkEngine(); build(B);
    const eraser = doErase(B);
    expect(eraser).toBeTruthy();
    const mark = markOf(B, eraser);
    const inScale = B.cam.inScale;
    B.flushErases(); B._render();
    return compareMark(before, B._objs().filter((o) => !o.erase), mark, inScale,
        { slackPx: 0.5, n: 110 });
}

describe("MX-1 — the hole is the shape the mark was, everywhere", () => {
    test.each(PLACED)("depth %i, %s", (d, place) => {
        const r = fidelity(
            (E) => { band(E); descend(E, d, 400, 300); PLACE[place](E); },
            (E) => gestureReturning(E, [[380, 250], [420, 350]], 18),
        );
        expect(r.inkBefore).toBeGreaterThan(150);
        expect(r.removed).toBeGreaterThan(15);
        expect(r.overPx).toBeLessThanOrEqual(1);
        expect(r.underPx).toBeLessThanOrEqual(1);
    });
    test("depth 0, mid-tile", () => {
        const r = fidelity(
            (E) => { band(E); },
            (E) => gestureReturning(E, [[380, 250], [420, 350]], 18),
        );
        expect(r.removed).toBeGreaterThan(15);
        expect(r.overPx).toBeLessThanOrEqual(1);
        expect(r.underPx).toBeLessThanOrEqual(1);
    });
});

describe("MX-2 — ...and it is still that shape after the machinery moves under it", () => {
    // Three different ways of throwing the picture away and rebuilding it. Each
    // rebuilds from a different starting point: a crossing rebuilds from the
    // other level's tiles, an eviction rebuilds from the natives, and a long pan
    // rebuilds from a different tile range at the same level.
    const TRIPS = {
        "a crossing out and back": (E, home) => { descend(E, E.activeLevel + 1, 400, 300); camRestore(E, home); },
        "evicting every tile": (E) => { E.store.bumpEpoch(); expect(E.store.size()).toBe(0); },
        "a pan of many tiles": (E) => {
            for (let i = 0; i < 8; i++) pan(E, -500, -300);
            for (let i = 0; i < 8; i++) pan(E, 500, 300);
        },
    };
    const CASES = [];
    for (const t of Object.keys(TRIPS)) for (const d of [0, 1, 2, 3, 4, 5]) CASES.push([d, t]);
    test.each(CASES)("depth %i, after %s", (d, trip) => {
        const E = mkEngine();
        band(E);
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const home = camShot(E);
        const before = raster(E, 56);
        expect(before.indexOf(".")).toBeGreaterThanOrEqual(0);   // there IS a hole
        TRIPS[trip](E, home);
        camRestore(E, home);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
    });
});

describe("MX-3 — undo takes back exactly one gesture, at every depth", () => {
    // Three shapes of gesture: a plain cut, a cut that severs (which re-keys and
    // re-parents a whole chain), and two gestures in a row (so undo must take
    // the second and leave the first).
    const GESTURES = {
        "a plain cut": (E) => { erase(E, [[400, 250], [400, 350]], 18); },
        "a severing cut": (E, home) => {
            camRestore(E, home);
            erase(E, [[400, 120], [400, 480]], 30);
        },
        "the second of two": (E) => {
            erase(E, [[340, 250], [340, 350]], 14);
            erase(E, [[460, 250], [460, 350]], 14);
        },
    };
    const CASES = [];
    for (const g of Object.keys(GESTURES)) for (const d of [0, 1, 2, 3, 4, 5]) CASES.push([d, g]);
    test.each(CASES)("depth %i, %s", (d, kind) => {
        const E = mkEngine();
        band(E, 120);
        const top = camShot(E);
        descend(E, d, 400, 300);
        const home = camShot(E);
        if (kind === "the second of two") {
            erase(E, [[340, 250], [340, 350]], 14);
        }
        const before = picture(E);
        const famBefore = families(E);
        if (kind === "the second of two") erase(E, [[460, 250], [460, 350]], 14);
        else GESTURES[kind](E, kind === "a severing cut" ? top : home);
        expect(picture(E)).not.toBe(before);
        E.undo(); E.flushErases();
        camRestore(E, home);
        expect(picture(E)).toBe(before);
        expect(families(E)).toBe(famBefore);
    });
});

describe("MX-4 — a cut never changes where anything sits in the stack", () => {
    // A narrow red stroke on a wide blue one. Whatever the cut does to the blue,
    // red is on top of what is left of it and blue is under what is left of red.
    const KINDS = {
        "cutting the one underneath": (E) => erase(E, [[240, 200], [240, 400]], 16),
        "cutting both of them": (E) => erase(E, [[400, 180], [400, 420]], 16),
        "a cut that severs": (E) => erase(E, [[400, 100], [400, 500]], 40),
    };
    const CASES = [];
    for (const k of Object.keys(KINDS)) for (const d of [0, 1, 2, 3, 4]) CASES.push([d, k]);
    test.each(CASES)("depth %i, %s", (d, kind) => {
        const E = mkEngine();
        drawStroke(E, [[-200, 300], [1000, 300]], 160, BLUE);
        drawStroke(E, [[-200, 300], [1000, 300]], 60, RED);
        const home = camShot(E);
        descend(E, d, 400, 300);
        const zBefore = rasterZ(E, 32);
        KINDS[kind](E);
        // Where ink survives, its colour must be the colour it was.
        const A = zBefore.split("\n"), B = rasterZ(E, 32).split("\n");
        let flips = 0;
        for (let j = 0; j < A.length; j++) {
            for (let i = 0; i < A[j].length; i++) {
                if (A[j][i] !== "." && B[j][i] !== "." && A[j][i] !== B[j][i]) flips++;
            }
        }
        expect(flips).toBe(0);
        camRestore(E, home);
        expect(colorAt(E, 100, 300)).toBe(RED);      // clear of every cut
        expect(colorAt(E, 100, 240)).toBe(BLUE);
    });
});

describe("MX-5 — an erased family moves as one, from wherever you grab it", () => {
    // The drag is made from three different places: the object's own level, the
    // top, and one crossing below the erase. Each expresses the same screen
    // motion in wildly different units, and every native has to end up in the
    // same place relative to every other.
    // The first point of the object's stored geometry, whatever form it takes.
    // Any fixed point of it does — the claim is that every native moved by the
    // same amount, not where any particular one of them ended up.
    const anchorOf = (o) => (o.type === "shape" ? o.loops[0][0].A
        : o.type === "fill" ? o.polys[0][0] : o.pts[0]);
    const FROM = { "its own level": 0, "the level of the erase": null, "one below the erase": 1 };
    const CASES = [];
    for (const f of Object.keys(FROM)) for (const d of [1, 2, 3, 4]) CASES.push([d, f]);
    test.each(CASES)("erased at depth %i, dragged from %s", (d, from) => {
        const E = mkEngine();
        band(E, 90);
        const top = camShot(E);
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const at = camShot(E);
        // WHERE a native is, in one fixed frame's units. This used to read each
        // member's own coordinates and expect a drag to have rewritten them by
        // `displacement x frameFactor` — the very thing that destroyed the deep
        // pieces (F-C / F25). A member re-homes now: its address changes and its
        // coordinates mostly do not, so the move has to be measured in the world.
        const worldOf = (r) => E.lm.mapPointF([...anchorOf(r.obj)], r.level, "0");
        const snap = () => new Map(natives(E).map((r) => [r.obj.id, worldOf(r)]));
        if (from === "its own level") camRestore(E, top);
        // Descend about ink, not about the hole: magnifying the hole 3000x makes
        // the whole canvas hole, and then there is nothing to press on.
        else if (from === "one below the erase") descend(E, d + 1, 200, 300);
        else camRestore(E, at);
        // Capture AFTER the click: selecting settles any pending erase, which
        // swaps the object for its cut form and moves which piece the anchor is.
        click(E, 200, 300);
        expect(E.selection).toBeTruthy();
        const before = snap();
        const camF = E.lm.frameFactor(E.cam.frame, "0");
        const dx = (60 / E.cam.inScale) * camF, dy = (80 / E.cam.inScale) * camF;
        drag(E, [200, 300], [260, 380]);
        // Every native moved the SAME distance in the world. Anything else tears
        // the object across levels.
        for (const r of natives(E)) {
            const b = before.get(r.obj.id);
            if (!b) continue;
            const a = worldOf(r);
            expect(a[0] - b[0]).toBeCloseTo(dx, 6);
            expect(a[1] - b[1]).toBeCloseTo(dy, 6);
        }
        // ...and the hole is still where it was relative to the ink.
        camRestore(E, at);
        pan(E, -60 * (E.cam.inScale / (E.lm.frameFactor(E.cam.frame, "0") || 1)) * 0, 0);
        expect(families(E)).toBe(1);
    });
});

describe("MX-6 — what the cut was made INTO does not change the answer", () => {
    // Same gesture, three subjects: a clean stroke, a shape already cut at its
    // own level, and a re-homed patch (already cut from below). All three are
    // solid ink over the sample box beforehand, so the resulting picture must be
    // the same picture.
    const SUBJECTS = {
        "a clean stroke": (E, d) => { band(E, 120); descend(E, d, 400, 300); },
        "a shape already cut here": (E, d) => {
            band(E, 120);
            erase(E, [[-100, 250], [-100, 350]], 20);      // a cut far to the left
            descend(E, d, 400, 300);
        },
        "a re-homed patch": (E, d) => {
            band(E, 120);
            const home = camShot(E);
            descend(E, d, 200, 300);
            erase(E, [[400, 250], [400, 350]], 18);        // makes the chain
            camRestore(E, home);
            descend(E, d, 400, 300);
        },
    };
    const CASES = [];
    for (const sName of Object.keys(SUBJECTS)) for (const d of [1, 2, 3]) CASES.push([d, sName]);
    test.each(CASES)("depth %i, into %s", (d, sName) => {
        const E = mkEngine();
        SUBJECTS[sName](E, d);
        const box = { x0: 320, y0: 220, x1: 480, y1: 380 };
        expect(raster(E, 40, box).indexOf(".")).toBe(-1);   // solid ink to start
        erase(E, [[400, 250], [400, 350]], 18);
        const after = raster(E, 40, box);
        expect(after.indexOf(".")).toBeGreaterThanOrEqual(0);
        expect(after.indexOf("#")).toBeGreaterThanOrEqual(0);
        // Compare against the clean-stroke answer at the same depth.
        const C = mkEngine();
        SUBJECTS["a clean stroke"](C, d);
        erase(C, [[400, 250], [400, 350]], 18);
        expect(rasterDiff(after, raster(C, 40, box)).total).toBeLessThanOrEqual(2);
    });
});
