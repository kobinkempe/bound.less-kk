/**
 * V — Severance and connectivity (docs/erase-tile-window-test-catalog.md).
 *
 * Bible §3. An erase decides locally whether the ink it just cut is still one
 * object, and relays outward when it cannot tell. `subtractPolys` already
 * returns DISJOINT REGIONS, so asking it over a window IS a connected-components
 * query; the relay is growing that window until the pieces either rejoin through
 * un-erased territory or the window has swallowed the whole object.
 *
 * V-1 is the headline scenario and the reason the "not yet" assertions matter
 * more than the final one: a test that only checked the end state would pass on
 * an implementation that severed far too eagerly, which is the worse failure —
 * an object wrongly left whole still renders correctly and merely moves as one,
 * while one wrongly severed splits under the user's hands.
 */
import KobinEngine from "./KobinEngine";
import { inks } from "./__testkit__/ink";
import { bboxOf } from "./geometry/derive";

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
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
};
const eraseGesture = (E, pts) => {
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const descend = (E, n, sx = 400, sy = 300) => {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 400) E.zoomAt(sx, sy, -1000);
    expect(E.activeLevel).toBe(n);
};
// Under the window model a deep erase re-homes ink into CHILD natives, so a raw
// object count says nothing about severance — a bite that keeps the ink whole
// still creates children. What severance actually means is that the ink stops
// being ONE logical object, and that is the edit family: an attached patch
// shares its source's editKey, while a piece the erase cut loose does not.
const families = (E) => {
    const keys = new Set();
    for (const k of E.doc.levels()) {
        for (const o of E.doc.at(k)) if (!o.erase) keys.add(E.doc.editKey(o));
    }
    return keys.size;
};
const inkAtScreen = (E, sx, sy) => {
    E._render();
    return inks(E._objs().filter((o) => !o.erase), E.cam.screenToFrame(sx, sy));
};

// The vertical extent of the longest inked run down the screen column `sx`,
// in screen px, or null. This is how the neck is found each round: the scenario
// is defined by what is LEFT, not by fixed coordinates.
const inkRun = (E, sx) => {
    E._render();
    const list = E._objs().filter((o) => !o.erase);
    let best = null, cur = null;
    for (let sy = 0; sy <= 600; sy++) {
        if (inks(list, E.cam.screenToFrame(sx, sy))) {
            if (!cur) cur = [sy, sy]; else cur[1] = sy;
            if (!best || cur[1] - cur[0] > best[1] - best[0]) best = [cur[0], cur[1]];
        } else cur = null;
    }
    return best;
};

describe("V-1/V-2 — the 98 % scenario", () => {
    // Erase almost all the way through, zoom in on what is left, erase almost
    // all of THAT, and keep going. Note why this scenario has to exist at all:
    // one crossing down, a hand-drawn stroke is 3000x the screen, so no single
    // gesture can ever cross it. The only way to sever an object at depth is
    // progressively, and the only thing that makes it possible is that the neck
    // shrinks ~50x per round while the zoom grows 3000x.
    test("whole every single round, until the neck finally goes", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60);
        const sx = 400;
        expect(families(E)).toBe(1);

        let severedAt = -1;
        for (let round = 0; round < 9 && severedAt < 0; round++) {
            const run = inkRun(E, sx);
            expect(run).not.toBeNull();
            const h = run[1] - run[0];
            const r = 24;
            const keep = Math.max(4, h * 0.02);   // leave ~2 % of the neck
            E.setEraserSize(r);
            eraseGesture(E, [[sx, run[0] - 300], [sx, run[1] - keep - r]]);
            E.flushErases();

            const n = families(E);
            if (n > 1) { severedAt = round; break; }
            // NOT YET SEVERED — asserted every round. A test that only checked
            // the end state would pass on an implementation that severed far
            // too eagerly, and that is the worse failure of the two.
            expect([round, n]).toEqual([round, 1]);

            const left = inkRun(E, sx);
            expect(left).not.toBeNull();
            // Re-centre on the neck BEFORE zooming, then zoom about the middle
            // of the screen. Zooming about a neck that already sits near the
            // bottom edge magnifies it straight off the canvas, and the next
            // round then measures a run the screen truncated rather than the
            // neck (a broken probe, not a broken engine).
            E.setTool("pan"); E.panBy(0, 300 - (left[0] + left[1]) / 2);
            let g = 0;
            while (g++ < 80) {
                const cur = inkRun(E, sx);
                if (!cur || cur[1] - cur[0] > 150) break;
                E.zoomAt(sx, 300, -1000);
                const c2 = inkRun(E, sx);
                if (c2) E.panBy(0, 300 - (c2[0] + c2[1]) / 2);
            }
        }

        // Several crossings deep by now — a ~1e6× zoom in, not a few bites at
        // one level. That is the whole point of the scenario: one crossing down
        // the band is 3000× the screen, so a neck this deep is only reachable
        // progressively.
        expect(E.activeLevel).toBeGreaterThanOrEqual(2);
        expect(severedAt).toBe(-1);          // every round so far left it whole

        // Now take the neck out completely, and only now may it become two.
        //
        // KNOWN FAILING — this is the last unbuilt piece of bible §3, left red
        // deliberately rather than weakened to match the code. The relay itself
        // IS implemented (_relaySplit: the level above removes the rect it ceded
        // from its own ink and sees whether what is left is still one piece),
        // and it works at an object's own level. What does not yet happen is the
        // deepest step REPORTING a two-piece cut back up the chain when the
        // neck is many crossings down: the through-cut leaves one region at that
        // depth, so the relay is never asked. Severing at depth therefore does
        // not yet happen, and V-8/V-10 below cover only the same-level case.
        const run = inkRun(E, sx);
        expect(run).not.toBeNull();
        E.setEraserSize(30);
        eraseGesture(E, [[sx, run[0] - 250], [sx, run[1] + 250]]);
        E.flushErases();
        expect(families(E)).toBeGreaterThanOrEqual(2);

        // ...and what is left really is separate objects: more than one edit
        // family, so selecting one no longer selects the other.
        expect(families(E)).toBeGreaterThanOrEqual(2);
    });

    test("at the object's own level, through severs and a neck does not", () => {
        for (const [name, reach, expected] of [["through", 400, 2], ["neck", 55, 1]]) {
            const E = mkEngine();
            drawStroke(E, [[150, 300], [650, 300]], 60);
            E.setEraserSize(24);
            eraseGesture(E, [[400, 100], [400, 170 + reach]]);
            E.flushErases();
            expect([name, families(E)]).toEqual([name, expected]);
        }
    });
});

describe("V-3 — a fragment the erase fully encloses severs with no relay", () => {
    test("an enclosed leftover becomes its own native and the parent stops painting it", () => {
        const E = mkEngine();
        const src = drawStroke(E, [[150, 300], [650, 300]], 120);
        descend(E, 1);
        // A ring-shaped gesture: two concentric-ish passes leaving an island of
        // ink inside. Drawn as a closed loop well inside the band.
        E.setEraserSize(18);
        const loop = [];
        for (let i = 0; i <= 40; i++) {
            const t = (i / 40) * Math.PI * 2;
            loop.push([400 + 70 * Math.cos(t), 300 + 70 * Math.sin(t)]);
        }
        eraseGesture(E, loop);
        E.flushErases();
        // The island inside the loop is enclosed: it touches no boundary, so no
        // relay is needed and it is severed outright.
        expect(families(E)).toBeGreaterThanOrEqual(2);
        const kids = E.doc.at(E.cam.frame).filter((o) => !o.erase);
        expect(kids.length).toBeGreaterThanOrEqual(1);
        for (const k of kids) expect(k.type).toBe("shape");
        // The parent ceded that ground rather than painting it twice — its ink
        // there is CUT, so `src` itself is gone and the tile survives only as
        // the child's attachRect. Any reference taken before a cede names
        // nothing afterwards; that is what the cut costs and what it buys.
        expect(E.doc.getById(src.id)).toBeNull();
        expect(kids.some((k) => k.attachRect)).toBe(true);
        // And it is really there: ink in the middle, hole on the loop itself.
        expect(inkAtScreen(E, 400, 300)).toBe(true);
        expect(inkAtScreen(E, 400, 230)).toBe(false);
        expect(inkAtScreen(E, 400, 300 + 100)).toBe(true);
    });

    test("undo takes the fragment back and gives the parent its ink again", () => {
        const E = mkEngine();
        const src = drawStroke(E, [[150, 300], [650, 300]], 120);
        descend(E, 1);
        E.setEraserSize(18);
        const loop = [];
        for (let i = 0; i <= 40; i++) {
            const t = (i / 40) * Math.PI * 2;
            loop.push([400 + 70 * Math.cos(t), 300 + 70 * Math.sin(t)]);
        }
        eraseGesture(E, loop);
        E.flushErases();
        const after = families(E);
        expect(after).toBeGreaterThanOrEqual(2);
        E.undo();
        expect(families(E)).toBe(1);
        expect(src.windows).toBeUndefined();
        expect(inkAtScreen(E, 400, 230)).toBe(true); // the loop's ink is back
    });
});

describe("V-6 — un-baked territory counts as connected", () => {
    test("a bite at one end of a long band never severs it", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 40);
        descend(E, 1);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 275]]); // a nick on the top edge, mid-band
        E.flushErases();
        expect(families(E)).toBe(1);
    });
});

describe("V-8/V-9/V-10 — identity after severance", () => {
    test("while unsevered, clicking anywhere in the family selects the ONE object", () => {
        const E = mkEngine();
        const src = drawStroke(E, [[150, 300], [650, 300]], 60);
        descend(E, 1);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 275]]);
        E.flushErases();
        E._render();
        E.setTool("select");
        E.pointerDown(300, 300); E.pointerUp();
        const a = E.selection.editId;
        E.pointerDown(500, 300); E.pointerUp();
        // One logical object: both clicks land in the same edit family, so a
        // drag from either moves the whole thing.
        expect(E.selection.editId).toBe(a);
    });

    test("once severed, the halves are different objects and move independently", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        E.setEraserSize(20);
        eraseGesture(E, [[400, 220], [400, 380]]);
        E.flushErases();
        E._render();
        E.setTool("select");
        E.pointerDown(250, 300); E.pointerUp();
        const left = E.selection.id;
        E.pointerDown(550, 300); E.pointerUp();
        const right = E.selection.id;
        expect(left).not.toBe(right);
        // Drag the right half well clear; the left half must not follow.
        const leftRec = E.doc.getById(left);
        const before = JSON.stringify(leftRec.obj.loops || leftRec.obj.polys || leftRec.obj.pts);
        E.pointerDown(550, 300); E.pointerMove(550, 420); E.pointerUp();
        expect(JSON.stringify(leftRec.obj.loops || leftRec.obj.polys || leftRec.obj.pts)).toBe(before);
        expect(inkAtScreen(E, 550, 420)).toBe(true);
        expect(inkAtScreen(E, 250, 300)).toBe(true);
    });
});

describe("V-11 — an object is never entirely inside a tile below its home", () => {
    test("one crossing down, a hand-sized stroke already outgrows the tile", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 24);
        descend(E, 1);
        const g = E.lm.grid(E.cam.frame);
        const src = E.doc.at("0")[0];
        const sb = bboxOf(src, null);
        const b = E.lm.mapRectF(
            { left: sb.x0, top: sb.y0, right: sb.x1, bottom: sb.y1 }, "0", E.cam.frame,
        );
        // Magnified ~3000×, a 300-unit stroke is ~9e5 units against a 38,400-unit
        // tile: there is ALWAYS ink at the boundary, which is what the V-3/V-4
        // reasoning rests on.
        expect(b.right - b.left).toBeGreaterThan(g.w);
    });
});
