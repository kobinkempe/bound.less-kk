/**
 * DS — SEVERING AN OBJECT FROM BELOW ITS OWN LEVEL.
 *
 * This is a design requirement (bible §3), not a nice-to-have, and it is the
 * hardest thing the erase machinery does. The object is homed at level 0; the
 * gesture that cuts it in two is made one, two, three or four crossings down,
 * where the object's own coordinates are not representable and the cut can never
 * be expressed in them. The verdict has to be relayed up the chain a crossing at
 * a time and arrive as ONE answer.
 *
 * Two separate things have to be true and they are easy to confuse:
 *
 *   1. A gesture SEVERS when it crosses the ink at the level it is made. Down
 *      there the object is magnified 3000^N, so what it takes to cross is a
 *      neck that is already thin at that level — which is why §3's scenario
 *      erases 98 % of the way through, zooms, and repeats. THAT IS THE DESIGN,
 *      and DS-2 walks it to four crossings.
 *
 *   2. A gesture that does NOT cross the ink must never sever, at any depth.
 *      DS-5 is the negative control, and it is the more dangerous direction to
 *      get wrong: an object wrongly left whole renders correctly and merely
 *      drags as one lump, while one wrongly severed comes apart in the user's
 *      hands and cannot be put back.
 *
 * Measured, for calibration (a 600 px canvas, eraser at its 200 px maximum, at
 * the widest in-level zoom the level allows):
 *
 *   | stroke at L0 | its height 1 crossing down | a gesture's reach | crosses? |
 *   |---|---|---|---|
 *   | 60 units | 1.8e5 u | 7.3e3 u | no |
 *   | 2 units  | 6.0e3 u | 7.3e3 u | YES |
 *
 * — so a HAIRLINE is severable one crossing down in a single stroke of the
 * eraser (DS-1), and anything thicker, or anything deeper, has to be thinned
 * first. Nothing about that is a limitation of the relay; it is what "the object
 * is three thousand times the screen" means.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, drag, click, pan, descend, camShot,
    camRestore, inkAt, inkRunY, families, natives, picture,
} from "./__testkit__/harness";

jest.setTimeout(600000);
useEngines();

const BLUE = "#1133cc";
const homeLevelOf = (E, key) => {
    for (const r of natives(E)) if (E.doc.editKey(r.obj) === key && r.obj.srcId == null) return r.level;
    return null;
};
// The set of levels a family's natives live at.
const levelsOf = (E, key) => [...new Set(natives(E).filter((r) => E.doc.editKey(r.obj) === key).map((r) => r.level))].sort();

/**
 * The ink run at column `sx`, or null if the SCREEN truncated it.
 *
 * This is the single most dangerous measurement in the file and it cost a whole
 * debugging round. `inkRunY` scans rows 0..height and reports the longest
 * inked stretch it finds, which for ink taller than the canvas is the CANVAS,
 * not the ink. Size a gesture from that and it covers the visible sliver while
 * the test believes it crossed the whole neck — DS-2 measured a 178 px run
 * against a neck 4.27 units tall and erased 0.36 of them, then reported the
 * engine had failed to sever an object that was still, correctly, joined.
 *
 * A run touching either edge is therefore no measurement at all.
 */
function neckRun(E, sx) {
    const r = inkRunY(E, sx);
    if (!r) return null;
    return (r[0] <= 0 || r[1] >= E.height - 1) ? null : r;
}

/**
 * One round of §3's scenario: take ~98 % of what is left of the neck at column
 * `sx`, then zoom in on the remainder and re-centre it. Returns false when there
 * is nothing left to work with.
 */
function thinAndDive(E, sx) {
    const run = neckRun(E, sx);
    if (!run) return false;
    const h = run[1] - run[0];
    const r = 24;
    const keep = Math.max(4, h * 0.02);
    eraseGesture(E, [[sx, run[0] - 300], [sx, run[1] - keep - r]], r);
    E.flushErases();
    const left = inkRunY(E, sx);
    if (!left) return false;
    // Re-centre on the neck BEFORE zooming. Zooming about a neck already near
    // the bottom edge magnifies it straight off the canvas.
    pan(E, 0, 300 - (left[0] + left[1]) / 2);
    let g = 0;
    while (g++ < 80) {
        const cur = neckRun(E, sx);
        if (!cur || cur[1] - cur[0] > 150) break;   // big enough to erase across
        const shot = camShot(E);
        E.zoomAt(sx, 300, -1000);
        const c2 = inkRunY(E, sx);
        if (c2) pan(E, 0, 300 - (c2[0] + c2[1]) / 2);
        // Stop the moment the neck stops FITTING, not when it passes some pixel
        // count — those are different conditions and only the first one keeps
        // the next round's measurement honest. Roll the step back: a view where
        // the neck runs off both edges cannot be worked with at all.
        if (!neckRun(E, sx)) { camRestore(E, shot); break; }
    }
    return true;
}

describe("DS-1 — a hairline is severed one crossing down in a single gesture", () => {
    // Layers: multi-layer erase (3) + topology (14) + multi-layer selection (2)
    // + moving across levels (6).
    //
    // No thinning, no progression: draw a 2-unit stroke, go down one crossing,
    // and one stroke of the eraser parts it. The object is still homed at level
    // 0 throughout — this is severance decided somewhere its own coordinates
    // cannot describe.
    test("one gesture at level 1 parts a stroke homed at level 0", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 2, BLUE);
        expect(families(E)).toBe(1);
        const home = camShot(E);
        descend(E, 1, 400, 300);
        erase(E, [[400, -200], [400, 800]], 60);
        expect(families(E)).toBe(2);
        camRestore(E, home);
        // Both halves are still ROOTED at level 0 — the severance rewrote the
        // chain, it did not re-home the object to where the erase happened.
        const keys = [...new Set(natives(E).map((r) => E.doc.editKey(r.obj)))];
        expect(keys.length).toBe(2);
        for (const k of keys) expect(homeLevelOf(E, k)).toBe("0");
    });
    test("...and the halves then move independently", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 2, BLUE);
        const home = camShot(E);
        descend(E, 1, 400, 300);
        erase(E, [[400, -200], [400, 800]], 60);
        camRestore(E, home);
        expect(inkAt(E, 200, 300)).toBe(true);
        expect(inkAt(E, 600, 300)).toBe(true);
        click(E, 200, 300);
        const left = E.selection.editId;
        click(E, 600, 300);
        expect(E.selection.editId).not.toBe(left);
        drag(E, [600, 300], [600, 450]);
        expect(inkAt(E, 600, 450)).toBe(true);
        expect(inkAt(E, 200, 450)).toBe(false);      // the other half stayed
        expect(inkAt(E, 200, 300)).toBe(true);
    });
    test("undo puts it back as one object", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 2, BLUE);
        const home = camShot(E);
        const doc0 = picture(E);
        descend(E, 1, 400, 300);
        erase(E, [[400, -200], [400, 800]], 60);
        expect(families(E)).toBe(2);
        E.undo(); E.flushErases();
        camRestore(E, home);
        expect(families(E)).toBe(1);
        expect(natives(E).length).toBe(1);
        expect(picture(E)).toBe(doc0);
    });
});

describe("DS-2 — §3's scenario: severed N crossings below its home", () => {
    // Layers: multi-layer erase (3) + already-cut shapes (5) + topology (14) +
    // zoom consistency (17) + multi-layer selection (2).
    //
    // A thick stroke cannot be crossed at depth in one go, so it is thinned
    // progressively — and the reason that ever converges is that the neck
    // shrinks ~50x per round while the zoom grows 3000x. At every round short of
    // the last the object must still be ONE object: an implementation that
    // severed eagerly would pass an end-state-only test and be much worse.
    test.each([[1], [2], [3], [4]])("%i crossing(s) down", (n) => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        const sx = 400;
        expect(families(E)).toBe(1);

        let guard = 0;
        while (E.activeLevel < n && guard++ < 12) {
            if (!thinAndDive(E, sx)) break;
            expect([E.activeLevel, families(E)]).toEqual([E.activeLevel, 1]);
        }
        expect(E.activeLevel).toBe(n);
        expect(families(E)).toBe(1);                 // still whole, every round

        // The object is homed at level 0 and has never moved: everything below
        // is re-homed representation of it.
        const key = E.doc.editKey(natives(E)[0].obj);
        expect(homeLevelOf(E, key)).toBe("0");

        // Now take the neck out completely. Measured with the fitting check —
        // a truncated run here sizes the final gesture short and the whole case
        // silently degrades into "did not sever", which is a passing-looking
        // failure of the test rather than of the engine.
        const run = neckRun(E, sx);
        expect(run).not.toBeNull();
        eraseGesture(E, [[sx, run[0] - 250], [sx, run[1] + 250]], 30);
        E.flushErases();
        expect(families(E)).toBeGreaterThanOrEqual(2);

        // Both halves are rooted at level 0, and each owns its own CHAIN — ink
        // at level 0 and ink at the level the cut was made. Without that last
        // check the whole case would pass on an implementation that gave up on
        // the chain and simply made two fresh objects down here, which is the
        // obvious wrong way to do this and produces a drawing whose top level
        // has quietly lost the stroke.
        const keys = [...new Set(natives(E).map((r) => E.doc.editKey(r.obj)))];
        expect(keys.length).toBeGreaterThanOrEqual(2);
        for (const k of keys) {
            const root = homeLevelOf(E, k);
            if (root == null) continue;              // an island cut fully loose
            expect(root).toBe("0");
            expect(levelsOf(E, k)).toContain("0");
            expect(levelsOf(E, k).length).toBeGreaterThanOrEqual(2);
        }
        // Every back-pointer still resolves.
        for (const { obj } of natives(E)) {
            if (obj.srcId != null) expect(E.doc.getById(obj.srcId)).toBeTruthy();
        }
    });
});

describe("DS-3 — a deep severance holds up afterwards", () => {
    // Layers: topology (14) + multi-layer selection (2) + moving (6) +
    // undo (18) + zoom consistency (17).
    const severedAtDepth = (n) => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        let guard = 0;
        while (E.activeLevel < n && guard++ < 12) if (!thinAndDive(E, 400)) break;
        const run = inkRunY(E, 400);
        eraseGesture(E, [[400, run[0] - 250], [400, run[1] + 250]], 30);
        E.flushErases();
        return E;
    };
    test.each([[2], [3]])("depth %i: the two halves select and drag apart", (n) => {
        const E = severedAtDepth(n);
        expect(families(E)).toBeGreaterThanOrEqual(2);
        // Pick each half up where its ink still is at this level.
        const runs = [];
        for (let sx = 20; sx < 780; sx += 20) if (inkRunY(E, sx)) runs.push(sx);
        expect(runs.length).toBeGreaterThan(1);
        click(E, runs[0], (inkRunY(E, runs[0])[0] + inkRunY(E, runs[0])[1]) / 2);
        expect(E.selection).toBeTruthy();
        const a = E.selection.editId;
        const far = runs[runs.length - 1];
        click(E, far, (inkRunY(E, far)[0] + inkRunY(E, far)[1]) / 2);
        expect(E.selection).toBeTruthy();
        expect(E.selection.editId).not.toBe(a);
    });
    test.each([[2], [3]])("depth %i: undo un-severs it", (n) => {
        const E = severedAtDepth(n);
        expect(families(E)).toBeGreaterThanOrEqual(2);
        E.undo(); E.flushErases();
        expect(families(E)).toBe(1);
    });
});

describe("DS-5 — a gesture that does not cross the ink never severs", () => {
    // Layers: topology (14) + multi-layer erase (3) + already-cut shapes (5).
    //
    // The negative control for everything above, and the direction that must not
    // be got wrong. A 60-unit band one crossing down is 1.8e5 units tall against
    // a gesture that reaches 7.3e3 — the erase is a scratch across something the
    // size of a continent. It removes ink, and the object is still one object.
    test.each([[1], [2], [3], [4]])("a full-screen gesture %i crossing(s) down", (n) => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 60, BLUE);
        const home = camShot(E);
        descend(E, n, 400, 300);
        erase(E, [[400, -200], [400, 800]], 200);    // the biggest eraser there is
        expect(inkAt(E, 400, 300)).toBe(false);      // it really did remove ink
        expect(families(E)).toBe(1);
        camRestore(E, home);
        expect(families(E)).toBe(1);
    });
    test("nor does a nick on a neck that is still connected", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, BLUE);
        thinAndDive(E, 400);                          // leaves a ~2 % neck
        expect(families(E)).toBe(1);
        const run = inkRunY(E, 400);
        expect(run).not.toBeNull();
        // Take some of the neck, but stop short of the far edge.
        eraseGesture(E, [[400, run[0] - 200], [400, run[0] + (run[1] - run[0]) * 0.3]], 10);
        E.flushErases();
        expect(families(E)).toBe(1);
    });
    test("and a ring is never severed by one cut, at any depth", () => {
        const E = mkEngine();
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const t = (i / 64) * Math.PI * 2;
            pts.push([400 + 180 * Math.cos(t), 300 + 180 * Math.sin(t)]);
        }
        drawStroke(E, pts, 26, BLUE);
        const home = camShot(E);
        for (const d of [0, 1, 2]) {
            camRestore(E, home);
            descend(E, d, 400, 120);
            erase(E, [[340, 300], [460, 300]], 26);
            expect([d, families(E)]).toEqual([d, 1]);   // joined the long way round
        }
    });
});
