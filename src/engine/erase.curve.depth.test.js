/**
 * F46 / F47 (2026-09-05): an ordinary erase on an ordinary curve, three
 * crossings down and zoomed in within the level.
 *
 * F46. The pen smooths a corner into a curve of radius ~92 units; at level 3
 * the tile store's piece for its edge is one arc of radius 6.3e12 spanning the
 * tile. The erase's grazing test compared the square's area before and after
 * the cut, and on such a piece each of those areas carries tens of units^2 of
 * noise (loopArea's segment term; the endpoints ~ulp(r) off the rounded
 * centre) against a real removal of 0.23 units^2 for a 12-px nick — so the
 * nick was refused as "grazing", at random, and the ink stayed. The removal is
 * measured locally now (`_removedArea`), and `loopArea` no longer cancels.
 *
 * F47. That refusal happened on the LAST link after the two above it had ceded,
 * and the descent reported success: the object was cut into remnants and kids
 * with nothing removed. A last-link refusal now unwinds the steps and records
 * itself.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, painted } from "./__testkit__/harness";
import { squareInkOf } from "./eraseDescent";
import { inks } from "./__testkit__/ink";
import { loopArea, segmentTerm } from "./geometry/arcShape";

jest.setTimeout(120000);
useEngines();

const edgeAtY = (E, sx, y0, y1) => {
    const list = painted(E);
    const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
    const a = ink(y0), b = ink(y1);
    if (a === b) return null;
    let lo = y0, hi = y1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ink(m) === a) lo = m; else hi = m; }
    return (lo + hi) / 2;
};
const scanEdge = (E, sx) => {
    const list = painted(E);
    const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
    let prev = ink(0);
    for (let y = 4; y <= E.height; y += 4) {
        const cur = ink(y);
        if (cur !== prev) return edgeAtY(E, sx, y - 4, y);
        prev = cur;
    }
    return null;
};
// Descend one crossing at a time on the ink's upper edge under (col, y), then
// zoom in within the level until the in-frame zoom reaches `minScale`.
const descendTo = (E, col, level, y0, minScale) => {
    let y = y0;
    for (let d = E.activeLevel; d < level; d++) {
        const e = edgeAtY(E, col, y - 20, y + 5) ?? scanEdge(E, col);
        expect(e).not.toBeNull();
        y = e;
        let guard = 0;
        while (E.activeLevel === d && guard++ < 40) E.zoomAt(col, y, -1000);
        expect(E.activeLevel).toBe(d + 1);
    }
    let guard = 0;
    while (E.cam.inScale < minScale && guard++ < 200) E.zoomAt(col, y, -300);
    expect(E.activeLevel).toBe(level);
    return edgeAtY(E, col, y - 40, y + 40) ?? scanEdge(E, col);
};
const natives = (E) => E.doc.levels().reduce((s, k) => s + E.doc.at(k).filter((o) => !o.erase).length, 0);
const lastNote = (E) => (E.journal || []).filter((j) => j.kind === "erase").slice(-1)[0] || null;

describe("F46: a 12-px nick on a curve, level 3, zoomed in within the level", () => {
    // The smoothed corner of a two-arm stroke; col 390 sits on the curve 10 units
    // before the corner. (The join-arc column, 401, passed before the fix because
    // the ink under its nick had been straightened; it stays as the control.)
    test.each([["slanted arm, on the curve", [[150, 350], [400, 300], [400, 550]], 390, 292],
        ["join arc (control)", [[150, 300], [400, 300], [400, 550]], 401, 290]])
    ("%s", (name, pts, col, yGuess) => {
        const E = mkEngine();
        drawStroke(E, pts, 20);
        const y0 = edgeAtY(E, col, yGuess - 40, yGuess + 10);
        expect(y0).not.toBeNull();
        const yHere = descendTo(E, col, 3, y0, 48);
        expect(yHere).not.toBeNull();
        expect(E.cam.inScale).toBeGreaterThanOrEqual(48);
        const nickX = col + 300;
        const yN = edgeAtY(E, nickX, yHere - 200, yHere + 200) ?? scanEdge(E, nickX);
        expect(yN).not.toBeNull();
        E.setEraserSize(12);
        eraseGesture(E, [[nickX, yN - 30], [nickX, yN + 30]]);
        E.flushErases();
        const probe = (dx, dy) => inks(painted(E), E.cam.screenToFrame(nickX + dx, yN + dy));
        // Paper inside the notch, ink either side of it and below it. The edge
        // slopes (this is the pen's smoothing of the corner, slope up to ~0.8 at
        // the join-arc column), so either side is probed below ITS OWN edge.
        const yL = edgeAtY(E, nickX - 40, yN - 120, yN + 120) ?? yN;
        const yR = edgeAtY(E, nickX + 40, yN - 120, yN + 120) ?? yN;
        const side = (dx, yE) => inks(painted(E), E.cam.screenToFrame(nickX + dx, yE + 20));
        expect({ above: probe(0, -8), notch: probe(0, 6), notch2: probe(0, 20), left: side(-40, yL), right: side(40, yR), below: probe(0, 100) })
            .toEqual({ above: false, notch: false, notch2: false, left: true, right: true, below: true });
        const note = lastNote(E);
        expect(note && note.cuts && note.cuts.length).toBeTruthy();
        // The cede reached the erase level: the last link's kid lives at level 3.
        const through = note.cuts[note.cuts.length - 1].through;
        const deepest = through[through.length - 1].map((s) => s.split("#")[0].split("/").length - 1);
        expect(Math.max(...deepest)).toBe(3);
        expect(note.refused || []).toEqual([]);
    });
});

describe("F47: a descent whose last link refuses leaves the document as it was", () => {
    test("intermediate cedes are unwound and the refusal is recorded", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 350], [400, 300], [400, 550]], 20);
        const col = 390;
        const y0 = edgeAtY(E, col, 252, 302);
        const yHere = descendTo(E, col, 3, y0, 48);
        const nickX = col + 300;
        const yN = edgeAtY(E, nickX, yHere - 200, yHere + 200) ?? scanEdge(E, nickX);
        expect(yN).not.toBeNull();
        const before = { n: natives(E), ids: E.doc.levels().flatMap((k) => E.doc.at(k).map((o) => o.id)).sort(), loops: JSON.stringify(E.doc.at("0")[0].loops) };
        expect(before.n).toBe(1);
        // Fault injection: the store holds none of the ink at the erase level.
        const realWorld = E._descentWorld.bind(E);
        const depthOf = (F) => F.split("/").length - 1;
        E._descentWorld = () => ({ ...realWorld(), squareInk: (world, vdoc, id, F, i, j) => (depthOf(F) === 3 ? null : squareInkOf(world, vdoc, id, F, i, j)) });
        try {
            E.setEraserSize(12);
            eraseGesture(E, [[nickX, yN - 30], [nickX, yN + 30]]);
            E.flushErases();
        } finally { E._descentWorld = realWorld; }
        const after = { n: natives(E), ids: E.doc.levels().flatMap((k) => E.doc.at(k).map((o) => o.id)).sort(), loops: JSON.stringify(E.doc.at("0")[0].loops) };
        expect(after).toEqual(before);
        // Nothing was erased, and the gesture says why.
        expect(inks(painted(E), E.cam.screenToFrame(nickX, yN + 6))).toBe(true);
        const note = lastNote(E);
        expect(note.cuts || []).toEqual([]);
        expect((note.refused || []).some((r) => /last link refused/.test(r.why))).toBe(true);
    });
});

describe("loopArea at depth", () => {
    test("the segment term is the series where the literal difference is noise", () => {
        expect(segmentTerm(0.5)).toBe(0.5 - Math.sin(0.5));
        const t = 2.08e-8;
        expect(Math.abs(segmentTerm(t) / (t * t * t / 6) - 1)).toBeLessThan(1e-12);
        expect(segmentTerm(-t)).toBe(-segmentTerm(t));
    });
    test("a tile-spanning arc of radius 6.3e12 has the segment area its chord and sagitta say", () => {
        // A slab whose top edge is the arc; the arc's own segment area is
        // (2/3) chord sag to first order, ~30 units^2 here — and `sweep - sin(sweep)`
        // written literally gave either 0 or +-60 for it.
        const r = 6.3e12, L = 131072, th = Math.asin((L / 2) / r);
        const a0 = -Math.PI / 2 - th, a1 = -Math.PI / 2 + th;
        const A = [r * Math.cos(a0), r + r * Math.sin(a0)], B = [r * Math.cos(a1), r + r * Math.sin(a1)];
        const loop = [{ line: false, C: [0, r], r, a0, sweep: a1 - a0, A, B },
            { line: true, A: B, B: [B[0], 4096] }, { line: true, A: [B[0], 4096], B: [A[0], 4096] }, { line: true, A: [A[0], 4096], B: A }];
        const chordOnly = loop.map((p) => (p.line ? p : { line: true, A: p.A, B: p.B }));
        const seg = loopArea(loop) - loopArea(chordOnly);
        const sag = L * L / (8 * r);
        expect(Math.abs(seg / ((2 / 3) * L * sag) - 1)).toBeLessThan(1e-6);
    });
});
