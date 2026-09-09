/**
 * PL — PERFORMANCE under the layered scenarios.
 *
 * Budgets, not aspirations, and mostly RATIOS: a wall-clock bound flakes on a
 * loaded machine, while "this is not thousands of times more expensive than
 * that" is a property of the algorithm and holds everywhere. The absolute
 * numbers that are here are set well above what was measured, so that only a
 * change of ORDER trips them.
 *
 * Two of these exist because writing the layered suites found the bug:
 *
 *  - PL-1. Erasing a magnified object flattened the eraser's outline at the
 *    TARGET's display tolerance rather than the eraser's own. Three crossings
 *    down that turns a 120-unit eraser cap into one of radius 3e12 and asks for
 *    ~2e8 points. Measured: 155,000 ms for one gesture, against 585 ms after.
 *    Nothing crashed and nothing looked wrong — it just stopped.
 *
 *  - PL-2. Level crossings, which is where every cache is cold at once.
 */
import {
    useEngines, mkEngine, drawStroke, erase, eraseGesture, drag, click, pan, descend, ascend,
    camShot, camRestore, families, natives, vertexCount, timeIt,
} from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc";
const wiggle = (n, y = 300) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([100 + t * 600, y + 90 * Math.sin(t * 17) * Math.cos(t * 5)]);
    }
    return pts;
};

describe("PL-1 — erasing an object that is magnified far below its own level", () => {
    // Layers: performance (1) + multi-layer erase (3) + already-cut shapes (5) +
    // free-floating pieces (12).
    //
    // The regression that hid for a whole afternoon. The chain has natives at
    // L0..L3; a gesture at L0 has to cut all four, and for three of them the
    // eraser arrives magnified by 3000, 9e6 and 2.7e10.
    test("a gesture that has to reach four levels at once stays under a second", () => {
        const E = mkEngine();
        drawStroke(E, [[340, 300], [460, 300]], 30, BLUE);
        const home = camShot(E);
        descend(E, 3, 400, 300);
        erase(E, [[400, 240], [400, 360]], 16);
        expect(natives(E).length).toBeGreaterThanOrEqual(4);
        camRestore(E, home);
        const ms = timeIt(() => erase(E, [[200, 300], [600, 300]], 120));
        expect(natives(E)).toEqual([]);            // it really did all the work
        expect(ms).toBeLessThan(8000);             // measured ~585 ms; was 155,000
    });
    test("...and the cost does not explode with depth", () => {
        // Each extra crossing multiplies the projected eraser by 3000. If the
        // flatten tolerance is not carried with it, this ratio is ~3000x per
        // level; with it, the work is flat.
        const run = (n) => {
            const E = mkEngine();
            drawStroke(E, [[340, 300], [460, 300]], 30, BLUE);
            const home = camShot(E);
            descend(E, n, 400, 300);
            erase(E, [[400, 240], [400, 360]], 16);
            camRestore(E, home);
            return timeIt(() => erase(E, [[200, 300], [600, 300]], 120));
        };
        const shallow = Math.max(run(1), 1), deep = Math.max(run(3), 1);
        expect(deep / shallow).toBeLessThan(25);
    });
});

describe("PL-2 — level crossings over an erased drawing", () => {
    // Layers: performance (1) + zoom consistency (17) + multi-layer erase (3) +
    // multiple tiles (13). Behaviour 1.
    //
    // A crossing throws away the tile set and builds another. It is the one
    // moment where nothing is warm, and it happens under the user's finger
    // mid-zoom, so it is the frame budget that matters most.
    const scene = (E) => {
        for (let i = 0; i < 5; i++) drawStroke(E, [[80, 140 + i * 80], [720, 140 + i * 80]], 34, BLUE);
        descend(E, 2, 400, 300);
        erase(E, [[400, 100], [400, 500]], 20);
    };
    test("crossing down and back is not a stall", () => {
        const E = mkEngine();
        scene(E);
        E._render();
        const ms = timeIt(() => { descend(E, 3, 400, 300); ascend(E, 2, 400, 300); }, 3);
        expect(ms).toBeLessThan(4000);
    });
    test("in-level zoom after a crossing is warm", () => {
        const E = mkEngine();
        scene(E);
        descend(E, 3, 400, 300);
        E._render();
        const ms = timeIt(() => { E.zoomAt(400, 300, -60); E.zoomAt(400, 300, 60); }, 20);
        expect(ms).toBeLessThan(150);
    });
    test("the vertex count does not grow every time you cross", () => {
        const E = mkEngine();
        scene(E);
        const v0 = vertexCount(E);
        for (let i = 0; i < 4; i++) { descend(E, 3, 400, 300); ascend(E, 2, 400, 300); }
        expect(vertexCount(E)).toBeLessThanOrEqual(v0 * 2 + 200);
    });
});

describe("PL-3 — a big stroke and a long eraser path together", () => {
    // Layers: performance (1) + big strokes (4) + long eraser paths (11) +
    // multiple tiles (13) + multi-layer erase (3).
    test("2000 points, cut by a screen-crossing gesture at depth", () => {
        const E = mkEngine();
        drawStroke(E, wiggle(2000), 24, BLUE);
        descend(E, 2, 400, 300);
        const ms = timeIt(() => erase(E, [[40, 60], [760, 540]], 20));
        expect(ms).toBeLessThan(20000);
        expect(vertexCount(E)).toBeLessThan(200000);
    });
    test("and the result still pans at interactive speed", () => {
        const E = mkEngine();
        drawStroke(E, wiggle(2000), 24, BLUE);
        descend(E, 2, 400, 300);
        erase(E, [[40, 60], [760, 540]], 20);
        E._render();
        expect(timeIt(() => pan(E, 23, 7), 20)).toBeLessThan(150);
    });
});

describe("PL-4 — many erases into one object", () => {
    // Layers: performance (1) + already-cut shapes (5) + multi-layer erase (3) +
    // free-floating pieces (12).
    //
    // Each cut acts on what the last one left. If anything about the bake is
    // quadratic in the number of previous cuts — re-deriving them, re-applying
    // them, or simply keeping them all — this is where it shows.
    test("the twelfth cut costs about what the second did", () => {
        const E = mkEngine();
        drawStroke(E, [[60, 300], [740, 300]], 120, BLUE);
        descend(E, 1, 400, 300);
        const times = [];
        for (let i = 0; i < 12; i++) {
            const x = 80 + i * 55;
            times.push(timeIt(() => erase(E, [[x, 250], [x, 350]], 10)));
        }
        const early = Math.max(1, (times[1] + times[2]) / 2);
        const late = (times[10] + times[11]) / 2;
        expect(late / early).toBeLessThan(12);
    });
    test("...and the geometry does not pile up", () => {
        const E = mkEngine();
        drawStroke(E, [[60, 300], [740, 300]], 120, BLUE);
        descend(E, 1, 400, 300);
        const counts = [];
        for (let i = 0; i < 8; i++) {
            const x = 100 + i * 75;
            erase(E, [[x, 250], [x, 350]], 10);
            counts.push(vertexCount(E));
        }
        // Linear in the number of cuts is fine. Quadratic is not.
        expect(counts[7] / Math.max(1, counts[1])).toBeLessThan(12);
    });
});

describe("PL-5 — the deferred bake stays out of the way", () => {
    // Layers: performance (1) + long eraser paths (11) + big strokes (4) +
    // erasing over multiple objects (10).
    //
    // The whole reason the eraser is a stroke: the GESTURE must cost nothing
    // however complicated the drawing is, because it happens under the user's
    // hand. The boolean happens afterwards.
    test("the gesture itself is cheap over a drawing with hundreds of pieces", () => {
        const E = mkEngine();
        for (let i = 0; i < 8; i++) drawStroke(E, wiggle(200, 120 + i * 60), 20, BLUE);
        // Shatter them at level 0, where all eight are on screen at once —
        // descending first would put seven of them a million pixels off it.
        for (let i = 0; i < 6; i++) erase(E, [[120 + i * 110, 60], [120 + i * 110, 540]], 8);
        expect(natives(E).length).toBeGreaterThan(20);
        descend(E, 1, 400, 300);
        E._render();
        const ms = timeIt(() => {
            eraseGesture(E, [[60, 300], [200, 260], [340, 340], [480, 260], [620, 340], [740, 300]], 16);
        });
        expect(ms).toBeLessThan(2000);      // the gesture, WITHOUT the bake
        E.flushErases();
    });
});

describe("PL-6 — a severed family is not more expensive than an intact one", () => {
    // Layers: performance (1) + topology (14) + multi-layer selection (2) +
    // moving (6).
    //
    // Severance doubles the number of natives and re-parents a whole chain. If
    // dragging then costs per-native scans of the document, the drag that
    // follows a severance is the one that feels bad.
    test("dragging after a deep severance is not slower than before it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        descend(E, 2, 250, 300);
        erase(E, [[400, 240], [400, 360]], 18);
        camRestore(E, home);
        click(E, 200, 300);
        const before = timeIt(() => drag(E, [200, 300], [210, 300], 4), 5);
        // Those are five drags of 10 px, so the band — and the tile it ceded at
        // depth 2, which now travels WITH it rather than being left behind at
        // astronomical coordinates — has moved 50 px right. Sever well clear of
        // where the cede has got to, or the cut lands on it and parts the object
        // three ways, which is correct and not what this test is measuring.
        erase(E, [[620, 200], [620, 400]], 26);
        expect(families(E)).toBe(2);
        click(E, 200, 300);
        const after = timeIt(() => drag(E, [200, 300], [210, 300], 4), 5);
        expect(after).toBeLessThan(Math.max(60, before * 6));
    });
});
