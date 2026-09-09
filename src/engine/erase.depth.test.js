/**
 * F42 — the erase cuts the ink the SCREEN shows, however deep.
 *
 * Measured 2026-09-04 on Kobin's phone (reports 14-45-44 and 14-50-08): an
 * erase at level 9 over a level-0 object's edge did nothing, and the cede chain
 * had stopped at level 6 with "tile holds none of its ink" while the render
 * list showed the ink right there. The erase's descent recomputed each level's
 * ink with its own arithmetic (`projectF` then a clip in local coordinates),
 * the render chain derives each level from the parent TILE's stored pieces
 * (clipped to the padded window), and two chains that clip on different
 * rectangles part from each other by 4,096x per crossing: a last-bit difference
 * at level 2 was 1,788 units at level 6 and a whole tile at 7. Straight lines
 * only; no arc and no freeze involved.
 *
 * WHY A SLANTED EDGE. A clip vertex is an interpolation between the piece's two
 * ends, and those ends are far away and already rounded; the new vertex
 * inherits their error, and the next level magnifies it 4,096 times before it
 * interpolates again. An axis-aligned line is immune — its clip vertex copies
 * one coordinate outright — and a first draft of this file used one and passed
 * on the broken build. The stroke here slopes at about eight degrees, which is
 * enough.
 *
 * At depth the only "same" is the same bits. So the descent now takes each
 * level's ink from the tile store — the very pieces the renderer draws — and
 * mints the kid from exactly those loops. These tests pin that:
 *
 *   - the erase lands at 5..9 crossings on an object's EDGE (the interior is
 *     the solid tier and always worked; the edge is where the chains diverged),
 *   - every intermediate kid is minted from the render chain's piece, loop for
 *     loop, bit for bit,
 *   - a cede far above leaves the picture down here bit-identical (the kid IS
 *     the piece the deeper tiles were already derived from).
 *
 * A note on the aim. (400, 288) at level 0 is x = 400 = 12.5 cells, so the
 * descent lands on a cell EDGE at level 1 and the deeper cells sit on their
 * parents' boundaries — the extreme-digit case, where a child tile's pre-image
 * straddles two parent squares. That was an accident of the numbers, and a
 * useful one: it is the case in which the up-bake used to derive two copies of
 * the same ink from two squares, and it is covered here as a result.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, painted } from "./__testkit__/harness";
import { inks } from "./__testkit__/ink";

jest.setTimeout(300000);
useEngines();

// One string per loop, so a kid's loops can be checked against a piece's as a
// set — a cede hands over one native per connected component, which regroups
// the loops without touching a number in them.
const loopStrs = (loops) => loops.map((loop) => JSON.stringify(loop.map((p) => (p.line
    ? [0, p.A[0], p.A[1], p.B[0], p.B[1]]
    : [1, p.A[0], p.A[1], p.B[0], p.B[1], p.C[0], p.C[1], p.r, p.a0, p.sweep]))));
const soleKey = (E) => {
    const keys = new Set();
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) keys.add(E.doc.editKey(o));
    return [...keys];
};
const familyAt = (E, key, F) => (E.doc.at(F) || []).filter((o) => !o.erase && E.doc.editKey(o) === key);
const depthOf = (F) => F.split("/").length - 1;

/**
 * The ink's upper boundary on screen column `sx`, to a ten-thousandth of a
 * pixel: paper at `y0`, ink at `y1`. One render, many probes.
 */
const edgeAt = (E, sx, y0, y1) => {
    const list = painted(E);
    const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
    expect(ink(y0)).toBe(false);
    expect(ink(y1)).toBe(true);
    let lo = y0, hi = y1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ink(m)) hi = m; else lo = m; }
    return (lo + hi) / 2;
};
/**
 * Descend `n` crossings keeping the ink's upper edge under screen (400, ~288).
 * A crossing magnifies an aim error 4,096 times, so the zoom is re-aimed onto
 * the edge — found to 1e-4 px — before every one of them.
 */
const descendOnEdge = (E, n, col = 400, y0 = 250, y1 = 300) => {
    for (let d = E.activeLevel; d < n; d++) {
        const y = edgeAt(E, col, y0, y1);
        let guard = 0;
        while (E.activeLevel === d && guard++ < 40) E.zoomAt(col, y, -1000);
        expect(E.activeLevel).toBe(d + 1);
    }
};
const inkAt = (E, sx, sy) => inks(painted(E), E.cam.screenToFrame(sx, sy));
/** Every shape loop the store holds for frame F's nine central squares. */
const storeLoops = (E, F) => {
    const out = new Set();
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            for (const o of E.store._ensureUp(F, i, j).objs) if (o.type === "shape") for (const s of loopStrs(o.loops)) out.add(s);
        }
    }
    return out;
};

describe("F42 — the cut lands on the ink the screen shows, on an EDGE, at depth", () => {
    test.each([[5], [6], [7], [8], [9]])("%i crossings down: the hole appears and the kids are the render's pieces", (n) => {
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        descendOnEdge(E, n);
        const y = edgeAt(E, 400, 250, 300);
        expect(Math.abs(y - 288)).toBeLessThan(40);
        // Ink below the edge, paper above it: the gesture below crosses it.
        expect(inkAt(E, 400, y + 12)).toBe(true);
        expect(inkAt(E, 400, y - 12)).toBe(false);

        // What the render chain holds for every level the descent will pass
        // through, BEFORE the erase.
        const before = new Map();
        for (let d = 1; d < n; d++) {
            const F = E.lm.pathFrameAt(E.cam.frame, d);
            before.set(F, storeLoops(E, F));
        }
        // ...and what each cede is minted FROM, as it happens. (By the end of
        // the descent the level-1 kid has itself been cut by the level-2 cede,
        // so the document's final state cannot be compared to the pieces.)
        const minted = [];
        const orig = E._applyDescent.bind(E);
        E._applyDescent = (Erec, target, r, ctx) => {
            if (r.steps) for (const st of r.steps) for (const k of st.kids) minted.push({ level: k.level, loops: loopStrs(k.obj.loops) });
            return orig(Erec, target, r, ctx);
        };

        E.setEraserSize(20);
        eraseGesture(E, [[400, y - 40], [400, y + 40]]);
        E.flushErases();

        // THE HEADLINE: the erase happened where it was made.
        expect(inkAt(E, 400, y + 12)).toBe(false);
        expect(inkAt(E, 300, y + 12)).toBe(true);

        // One family, one link per crossing...
        const keys = soleKey(E);
        expect(keys).toHaveLength(1);
        const key = keys[0];
        for (let d = 1; d <= n; d++) {
            const F = E.lm.pathFrameAt(E.cam.frame, d);
            expect([d, familyAt(E, key, F).some((o) => o.attachRect != null)]).toEqual([d, true]);
        }
        // ...and every intermediate kid was minted from loops the render chain
        // already held for that level — the same bits, loop for loop.
        const inter = minted.filter((m) => depthOf(m.level) < n);
        expect(inter.length).toBeGreaterThanOrEqual(n - 1);
        for (const m of inter) {
            const had = before.get(m.level);
            expect([depthOf(m.level), had && m.loops.every((s) => had.has(s))]).toEqual([depthOf(m.level), true]);
        }
    });

    test("an erase far above that touches nothing of the object leaves the picture down here bit-identical", () => {
        // A small stroke is drawn beside the big object's edge at level 2 and
        // erased there; the erase reaches the big object too (its box overlaps),
        // descends, and finds nothing of it under the eraser at level 2.
        //
        // Until 2026-09-05 that descent ceded level 1 on the way and LEFT it
        // ceded — a kid at level 1 holding the render chain's own piece, so the
        // tiles below derived the same bits from the kid as from the piece, and
        // this test pinned that the level-6 picture had not moved. It still
        // must not have; but the descent no longer leaves a half-finished
        // restructuring behind it (F47): a last link that refuses unwinds the
        // links above it and records the refusal, so an erase that removed
        // nothing of an object leaves that object exactly as it was — one
        // native, no kid, and the same bits six crossings down. (That the
        // intermediate kids ARE the store's pieces, bit for bit, is the
        // previous test's claim.)
        //
        // What is NOT claimed, and was measured on the way to this test: a cut
        // that lands on the very line the deep view lies along DOES move it
        // down here — by 136 units at level 6 for a nick made at level 2, 300
        // px along the edge. The boolean splits the segment at the eraser, the
        // new endpoint carries a rounding, and the chain magnifies it 4,096x
        // per crossing exactly as it does a clip vertex. A line defined by its
        // two endpoints cannot be cut anywhere without redefining it
        // everywhere; keeping the defining points on the piece is a
        // representation change, recorded as F43.
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        descendOnEdge(E, 6);
        const F = E.cam.frame;
        const shot = { ...E.cam.state() };
        const pieces = () => {
            E.store.bumpEpoch();                 // rebuild from the document, no cache
            return E.store.content(F, E.cam.frameWindow(0)).filter((o) => o.type === "shape").map((o) => loopStrs(o.loops).join("|")).sort();
        };
        const was = pieces();
        expect(was.length).toBeGreaterThan(0);
        let guard = 0;
        while (E.activeLevel > 2 && guard++ < 600) E.zoomAt(400, 288, 1000);
        expect(E.activeLevel).toBe(2);
        const y = edgeAt(E, 400, 150, 400);
        // A stroke on paper, 300 px above the edge, and an erase over it.
        const small = drawStroke(E, [[380, y - 300], [420, y - 300]], 10, "#cc3311");
        expect(inkAt(E, 400, y - 300)).toBe(true);
        E.setEraserSize(30);
        eraseGesture(E, [[400, y - 330], [400, y - 270]]);
        E.flushErases();
        expect(inkAt(E, 400, y - 300)).toBe(false);
        expect(E.doc.getById(small.id)).toBeNull();
        expect(inkAt(E, 400, y + 12)).toBe(true);        // the big object is untouched here
        // The big object is one native still: the descent that found nothing
        // of it under the eraser at level 2 unwound its level-1 cede (F47) and
        // said so on the gesture's note.
        const keys = soleKey(E);
        expect(keys).toHaveLength(1);
        const F1 = E.lm.pathFrameAt(F, 1);
        expect(familyAt(E, keys[0], F1)).toHaveLength(0);
        expect(E.doc.at("0").filter((o) => !o.erase)).toHaveLength(1);
        const note = E.journal.filter((j) => j.kind === "erase").slice(-1)[0];
        expect((note.refused || []).some((r) => /last link refused/.test(r.why))).toBe(true);
        E.cam.set(shot);
        expect(pieces()).toEqual(was);
    });
});

describe("F43 — a cut anywhere on a line moves the line's picture nowhere else", () => {
    test("a nick made two crossings down, 300 px along the edge, leaves the picture six crossings down bit-identical", () => {
        // The measurement the previous test declined to claim, now claimed.
        // Until 2026-09-05 this nick moved the level-6 edge 136 units: the
        // boolean split the edge's line at the eraser, the new endpoint was a
        // rounded crossing, and every level below interpolated its clip
        // vertices from that endpoint, 4,096x per crossing. A line piece now
        // remembers the two points that DEFINE it (`P`, `Q`, canonical — the
        // ends it had when it was chopped from its parent) beside the stretch
        // of it that survives (`sa`, `sb`); a cut moves `sa`/`sb` and the deep
        // cuts are computed from `P`/`Q`, so the same numbers reach every
        // level below whether the line was nicked or not. Kobin's corner
        // scenario at level 8 is `depth.corner.probe.js`; this is the same
        // claim in the quick suite, four levels below the nick.
        const E = mkEngine();
        drawStroke(E, [[250, 280], [550, 320]], 24);
        descendOnEdge(E, 6);
        const F = E.cam.frame;
        const shot = { ...E.cam.state() };
        const pieces = () => {
            E.store.bumpEpoch();
            return E.store.content(F, E.cam.frameWindow(0)).filter((o) => o.type === "shape").map((o) => loopStrs(o.loops).join("|")).sort();
        };
        const was = pieces();
        expect(was.length).toBeGreaterThan(0);
        let guard = 0;
        while (E.activeLevel > 2 && guard++ < 600) E.zoomAt(400, 288, 1000);
        expect(E.activeLevel).toBe(2);
        // The edge 300 px along from the column the deep view sits under, and
        // a 20-px nick straight across it.
        const y = edgeAt(E, 700, 150, 400);
        E.setEraserSize(20);
        eraseGesture(E, [[700, y - 15], [700, y + 15]]);
        E.flushErases();
        expect(inkAt(E, 700, y + 6)).toBe(false);          // the nick took ink
        expect(inkAt(E, 700, y + 60)).toBe(true);          // and only a nick's worth (the size is a radius: ~35 px deep)
        expect(inkAt(E, 400, edgeAt(E, 400, 150, 400) + 12)).toBe(true);   // the edge under the deep view is untouched
        E.cam.set(shot);
        expect(pieces()).toEqual(was);
    });
    test("the same nick on a CURVED edge leaves the arc's picture three crossings down bit-identical", () => {
        // The arc half of F43 (Kobin, 2026-09-05: "fix arcs, too"). A cut arc
        // remembers the arc it was cut from — its angles and its end points as
        // the chain would have them at this level (`K`) — beside its own extent
        // as positions on it (`ua`, `ub`); the chop, the freeze and the window
        // clip below run on `K` exactly as they run on an uncut arc, so the same
        // numbers reach every level whether the arc was nicked or not. The edge
        // here is the slanted arm of a two-arm stroke: an arc of r ~ 1e3 at the
        // home and ~6e12 three crossings down, just under the freeze radius
        // (freeze.js rule 2, 2026-09-06: one crossing further it is a line),
        // which is the case the corner probe measured 0.095 units off one
        // level below its nick before this. The nick is made one crossing
        // down, where the arc's radius is ~1.5e9.
        const E = mkEngine();
        drawStroke(E, [[150, 350], [400, 300], [400, 550]], 20);
        descendOnEdge(E, 3, 390, 250, 302);
        const F = E.cam.frame;
        const shot = { ...E.cam.state() };
        const pieces = () => {
            E.store.bumpEpoch();
            return E.store.content(F, E.cam.frameWindow(0)).filter((o) => o.type === "shape").map((o) => loopStrs(o.loops).join("|")).sort();
        };
        const was = pieces();
        expect(was.length).toBeGreaterThan(0);
        expect(was.some((s) => s.includes("[1,"))).toBe(true);        // there IS an arc down here
        let guard = 0;
        while (E.activeLevel > 1 && guard++ < 600) E.zoomAt(390, 292, 1000);
        expect(E.activeLevel).toBe(1);
        const y = edgeAt(E, 700, 150, 450);
        E.setEraserSize(20);
        eraseGesture(E, [[700, y - 15], [700, y + 15]]);
        E.flushErases();
        expect(inkAt(E, 700, y + 6)).toBe(false);
        expect(inkAt(E, 700, y + 60)).toBe(true);
        E.cam.set(shot);
        expect(pieces()).toEqual(was);
    });
});
