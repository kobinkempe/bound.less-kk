/**
 * F124 (Kobin's phone report 2026-09-24T06-40-12, "an eraser shattered a doc into too many pieces"):
 * an erase whose cede straddles two cells hands the ink down as two kids side by side in two
 * frames, and the family test compared the second kid's window and outline in its own cell's
 * coordinates, a whole frame off: the kids never met, and one blob became several objects split
 * along the seam. A dot drawn over the seam between cells (0,0) and (0,1), nicked at depth 1 by an
 * eraser that severs nothing, must stay one object.
 */
import { mkEngine, useEngines } from "./__testkit__/harness";

useEngines();

function scene(R0 = 4) {
    const E = mkEngine(800, 600);
    const c0 = E.cam;
    const sx = c0.inPanX, sy = 16 * c0.inScale + c0.inPanY;       // root (0, 16): the seam's centre line below
    E.setTool("pen"); E.setWidth(2 * R0 * c0.inScale); E.setColor("rgb(120,140,160)");
    E.pointerDown(sx, sy); E.pointerMove(sx + 0.5, sy); E.pointerUp(); E.flushBakes();
    for (let g = 0; E.activeLevel < 1 && g < 400; g++) E.zoomAt(sx, sy, -1000);
    const c = E.cam, f = E.lm.frame(c.frame);
    const seamY = (f.cell.j === 0 ? 65536 : -65536) * c.inScale + c.inPanY;
    return { E, sx, seamY };
}
function nick(E, x, y0, y1, size) {
    E.setEraserSize(size); E.setTool("erasePartial");
    E.pointerDown(x, y0);
    for (let k = 1; k <= 8; k++) E.pointerMove(x, y0 + ((y1 - y0) * k) / 8);
    E.pointerUp();
    E.flushBakes(); E.flushErases();
}
function families(E) {
    const keys = new Set();
    for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase) keys.add(E.doc.editKey(o));
    return keys.size;
}

describe("F124 a cede across a cell seam keeps one object one object", () => {
    test("CS-1 a nick across the seam that severs nothing leaves one family", () => {
        const { E, seamY } = scene();
        nick(E, 400, seamY - 20, seamY + 20, 10);
        const note = E.journal[E.journal.length - 1];
        expect(note.cuts.map((c) => c.mode)).toContain("cede");  // handed down across the seam
        expect(E.journal.some((j) => j.kind === "erase" && j.cuts && j.cuts.length)).toBe(true);
        expect(families(E)).toBe(1);                      // red before: 2, split along the seam
    });

    test("CS-2 the same nick inside one cell: one family", () => {
        const { E, seamY } = scene();
        nick(E, 400, seamY - 60, seamY - 30, 10);
        expect(families(E)).toBe(1);
    });

    test("CS-3 a band that parts the dot across both cells: two families", () => {
        const { E, sx, seamY } = scene();
        E.setEraserSize(40); E.setTool("erasePartial");
        const x0 = sx - 3000, x1 = sx + 3000;                // past the dot's 2,048 px radius either side
        E.pointerDown(x0, seamY);
        for (let k = 1; k <= 60; k++) E.pointerMove(x0 + ((x1 - x0) * k) / 60, seamY);
        E.pointerUp();
        E.flushBakes(); E.flushErases();
        expect(families(E)).toBe(2);
    });
});
