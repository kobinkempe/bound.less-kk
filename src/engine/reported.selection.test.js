/**
 * Kobin's selection reports. F170 (2026-10-29 21:03, and 2026-11-09 05:48 "I couldn't select by lasso"): pieces homed in
 * a co-resident chain of the camera's cell, parting from its chain 20–23 levels up, were never reached by the lasso's
 * walk. F146 (2026-10-07 03:17, and 2026-11-09 05:53 "one of those circles circling nothing"): F103's dot circled a
 * selected frame whose pieces were traced as the selection's own ids. Fixtures in `.kobin-reports` (gitignored): absent,
 * nothing runs.
 */
import fs from "fs";
import path from "path";
import { useEngines, ascend } from "./__testkit__/harness";
import { engineFromReport, readReportFile, drawingPartsOf } from "./__testkit__/reportReplay";

jest.setTimeout(600000);
useEngines();
const at = (f) => path.join(process.cwd(), ".kobin-reports", f);
const RA = at("report-2026-11-09T05-48-32-432Z.json"), RB = at("report-2026-11-09T05-53-16-154Z.json");
const R170 = at("report-2026-10-29T21-03-36-057Z-lasso.json.gz"), R146 = at("report-2026-10-07T03-17-06-829Z.json");
const load = (f) => engineFromReport(readReportFile(f), { parts: f.endsWith(".gz") ? null : drawingPartsOf(f) });

/** Each native's drawn box on screen, from the render list. */
function drawnBoxes(E) {
    const { inScale: s, inPanX: px, inPanY: py } = E.cam, by = new Map();
    for (const it of E.stage.items()) {
        if (it.pending || !it.box) continue;
        const { off } = E.stage.placed(it), q = it.box;
        const b = [(q.left + off[0]) * s + px, (q.top + off[1]) * s + py, (q.right + off[0]) * s + px, (q.bottom + off[1]) * s + py];
        const a = by.get(it.id);
        by.set(it.id, a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b);
    }
    return by;
}
const radiusPx = (m) => Number(/A([\d.]+),/.exec(m.d)[1]);
/** A mark's centre on screen: its path's two arc ends, through the ants' transform. */
const markCentre = (a, m) => {
    const n = m.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const cx = (n[0] + n[7]) / 2, cy = (n[1] + n[8]) / 2;
    return [a.transform.k * cx + a.transform.tx, a.transform.k * cy + a.transform.ty];
};
const loop = (E, b, g = 12) => [[b[0] - g, b[1] - g], [b[2] + g, b[1] - g], [b[2] + g, b[3] + g], [b[0] - g, b[3] + g]].map(([x, y]) => E.cam.screenToFrame(x, y));

test.each([["2026-11-09 05:48", RA, [278, 283, 284, 285, 287]], ["2026-10-29 21:03", R170, [276, 340, 372]]])("F170: report %s, each piece whole on screen is lassoed", (_, f, ids) => {
    if (!fs.existsSync(f)) return;
    const E = load(f);
    E.setTool("select");
    E._render();
    const drawn = drawnBoxes(E);
    for (const id of ids) {
        const b = drawn.get(id);
        expect(b[0] > 0 && b[1] > 0 && b[2] < E.width && b[3] < E.height).toBe(true);
        const home = E.doc.getById(id).level;
        expect(E.lm.sameCell(home, E.cam.frame) && home !== E.cam.frame).toBe(true);   // a co-resident of the camera's frame
        expect(E._lassoFind(loop(E, b)).ids).toContain(id);
    }
    const all = E._lassoFind(loop(E, [4, 4, E.width - 4, E.height - 4], 0)).ids;
    for (const id of ids) expect(all).toContain(id);
});

test.each([["2026-11-09 05:53", "-1/2,-1", RB], ["2026-10-07 03:17", "-1/-6,-2/1424,1352", R146]])("F146: report %s, no dot beside the selected frame %s's ants", (_, frame, f) => {
    if (!fs.existsSync(f)) return;
    const rep = readReportFile(f), E = load(f);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    E._render();
    const decide = () => { E._selDec = null; E._selTableCache = null; const a = E._selectionAnts(); return { d: E._selDec, a }; };
    const { d, a } = decide();
    expect(d.runs.length).toBeGreaterThan(0);
    // The frame's pieces are the selection's own ids, drawn and traced: every mark left is a speck.
    const table = E._selTable(E.selection);
    expect([...table.ids].some((id) => E.doc.getById(id) && E.doc.getById(id).level === frame)).toBe(true);
    for (const m of d.marks) expect(radiusPx(m)).toBeLessThan(1);
    // What the frame adds is a speck on content under it the list does not draw, never one round its drawn pieces.
    const sc = E.cam.inScale, undrawn = [];
    const drawn = new Set(E.stage.items().map((it) => it.id));
    E.lm.walk(frame, (g) => { for (const o of E.doc.list(g.id)) if (!o.erase && !drawn.has(o.id)) undrawn.push(E.stage.placeNative(o, E.cam.frame).box()); });
    const before = d.marks.map((m) => markCentre(a, m));
    E._setSelection(sel.ids, sel.frames.filter((x) => x !== frame), true);
    const w = decide(), without = w.d.marks.map((m) => markCentre(w.a, m));
    for (const c of before.filter((p) => !without.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5))) {
        expect(undrawn.some((r) => Math.hypot(Math.max(r.left * sc + E.cam.inPanX - c[0], 0, c[0] - r.right * sc - E.cam.inPanX),
            Math.max(r.top * sc + E.cam.inPanY - c[1], 0, c[1] - r.bottom * sc - E.cam.inPanY)) < 1.5)).toBe(true);
    }
});

test("report 2026-11-09 14:15: the dot inside the rectangle's selected frame is a speck", () => {
    const f = at("report-2026-11-09T14-15-05-574Z.json");
    if (!fs.existsSync(f)) return;
    const rep = readReportFile(f), E = load(f);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    E._render();
    E._selDec = null; E._selTableCache = null;
    const a = E._selectionAnts(), d = E._selDec;
    // The dot: pieces 86-93, three levels under the camera, under the selected frame with the rectangle's drawn kid.
    const isl = E.doc.getById(87), r = E._rectInActive(isl.obj), sc = E.cam.inScale;
    expect(E.stage.items().some((it) => it.id === 87)).toBe(false);
    const p = [((r.left + r.right) / 2) * sc + E.cam.inPanX, ((r.top + r.bottom) / 2) * sc + E.cam.inPanY];
    expect(d.marks.some((m) => radiusPx(m) <= 1 && Math.hypot(markCentre(a, m)[0] - p[0], markCentre(a, m)[1] - p[1]) < 1.5)).toBe(true);
});

test("report 2026-11-09 17:41: the hole round the island, too small to trace, is a speck", () => {
    const f = at("report-2026-11-09T17-41-38-819Z.json");
    if (!fs.existsSync(f)) return;
    const { runLength, loopsBounds } = require("./geometry/antRuns");
    const rep = readReportFile(f), E = load(f);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    E._render();
    E._selDec = null; E._selTableCache = null;
    const a = E._selectionAnts(), d = E._selDec, sc = E.cam.inScale;
    const centres = d.marks.map((m) => markCentre(a, m));
    // Every whole ring of the selection's drawn pieces on screen, under the run minimum: each has its speck.
    const rings = [];
    const table = E._selTable(E.selection);
    for (const it of E.stage.items()) {
        if (!table.ids.has(it.id) && !E._selFrameOf(it.id, table, new Map())) continue;
        const { geom, off } = E.stage.placed(it), loops = E._selPieceLoops(geom);
        for (const L of loops || []) {
            const b = loopsBounds([L]);
            const p = [((b.x0 + b.x1) / 2 + off[0]) * sc + E.cam.inPanX, ((b.y0 + b.y1) / 2 + off[1]) * sc + E.cam.inPanY];
            if (runLength(L) * sc < 0.5 && p[0] > 0 && p[0] < E.width && p[1] > 0 && p[1] < E.height && !(it.clip)) rings.push(p);
        }
    }
    expect(rings.length).toBeGreaterThan(0);
    for (const p of rings) expect(centres.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 1.5)).toBe(true);
    for (const m of d.marks) expect(radiusPx(m)).toBeLessThanOrEqual(1);
});

test("report 2026-11-09 18:04: the square holding the island is not circled, selected as made or by its frame alone", () => {
    const f = at("report-2026-11-09T18-04-03-629Z.json");
    if (!fs.existsSync(f)) return;
    const rep = readReportFile(f), E = load(f);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection, sc = E.cam.inScale;
    const isl = E._rectInActive(E.doc.getById(87).obj);
    const p = [((isl.left + isl.right) / 2) * sc + E.cam.inPanX, ((isl.top + isl.bottom) / 2) * sc + E.cam.inPanY];
    for (const [ids, frames] of [[sel.ids, sel.frames], [[], sel.frames]]) {
        E._setSelection(ids, frames, true);
        E._render();
        E._selDec = null; E._selTableCache = null;
        const a = E._selectionAnts(), d = E._selDec;
        expect(d.marks.length).toBeGreaterThan(0);
        for (const m of d.marks) expect(radiusPx(m)).toBeLessThanOrEqual(1);   // red before: 3.9 px round the leaves' square
        expect(d.marks.some((m) => Math.hypot(markCentre(a, m)[0] - p[0], markCentre(a, m)[1] - p[1]) < 1.5)).toBe(true);
    }
});

/** Distance from point p to one piece: a line exactly, an arc or a cubic by 64 samples. */
function distToPiece(p, q) {
    const d = (x, y) => Math.hypot(x - p[0], y - p[1]);
    if (Array.isArray(q)) {
        let best = Infinity;
        for (let k = 0; k <= 64; k++) {
            const t = k / 64, u = 1 - t, c = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
            best = Math.min(best, d(c[0] * q[0][0] + c[1] * q[1][0] + c[2] * q[2][0] + c[3] * q[3][0], c[0] * q[0][1] + c[1] * q[1][1] + c[2] * q[2][1] + c[3] * q[3][1]));
        }
        return best;
    }
    if (q.line || !(q.r > 0) || !isFinite(q.r) || !q.C) {
        const dx = q.B[0] - q.A[0], dy = q.B[1] - q.A[1], L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((p[0] - q.A[0]) * dx + (p[1] - q.A[1]) * dy) / L2)) : 0;
        return d(q.A[0] + t * dx, q.A[1] + t * dy);
    }
    let best = Infinity;
    for (let k = 0; k <= 64; k++) { const th = q.a0 + (k / 64) * q.sweep; best = Math.min(best, d(q.C[0] + q.r * Math.cos(th), q.C[1] + q.r * Math.sin(th))); }
    return best;
}

// F188 (Kobin's report 2026-11-09 18:40, "I made a bunch of eraser marks, but I can't find most of them anymore"): shape
// 116's six erasures, each where its journal stroke cut, in the frame of the piece it cut. Selected, each is shown from
// every view: ants on its rim, or a speck. Before, 164 and 173 had nothing at the report's view (their square, two levels
// down, is 0.007 px), and 118, 141 and 145 nothing one level out.
test("F188: report 2026-11-09 18:40, each of the shape's six erasures is shown from the report's view outward", () => {
    const f = at("report-2026-11-09T18-40-01-206Z.json");
    if (!fs.existsSync(f)) return;
    const rep = readReportFile(f), E = load(f);
    E.setTool("select");
    E._render();
    const sel = rep.moves.selection;
    E._setSelection(sel.ids, sel.frames, true);
    Object.defineProperty(E.renderer, "antPainter", { value: true, configurable: true });   // the runs as pieces
    const cuts = [[118, 146, 61255.8, 14256.7], [141, 146, 61292.5, 18057.7], [145, 146, 63078, 30720],
        [155, 165, -9783.7, 64979.4], [164, 174, -2540, 6888], [173, 176, 32349.3, 9666.3]].map(([stroke, piece, x, y]) => {
        const rec = E.doc.getById(piece);
        let rim = Infinity;                                                // from the cut to the piece's ink: the erasure's reach
        for (const loop of rec.obj.loops) for (const q of loop) rim = Math.min(rim, distToPiece([x, y], q));
        return { stroke, L: rec.level, x, y, rim };
    });
    const zoomAt = E.cam.levelPointToScreen(cuts[4].L, cuts[4].x, cuts[4].y);
    const look = () => {
        E._render();
        E._selDec = null; E._selTableCache = null;
        const a = E._selectionAnts(), sc = E.cam.inScale, F = E.cam.frame, out = {};
        for (const c of cuts) {
            const p = E.cam.levelPointToScreen(c.L, c.x, c.y);
            if (!(p[0] > 0 && p[0] < E.width && p[1] > 0 && p[1] < E.height)) continue;
            const q = [(p[0] - E.cam.inPanX) / sc, (p[1] - E.cam.inPanY) / sc];
            const speck = !!a && a.marks.some((m) => Math.hypot(m.pieces[0].C[0] - q[0], m.pieces[0].C[1] - q[1]) * sc < 1.5);
            const reach = c.rim * E.lm.frameFactor(c.L, F) * sc + 3;
            const ants = !!a && a.runs.some((r) => r.pieces.some((piece) => distToPiece(q, piece) * sc < reach));
            out[c.stroke] = speck ? "speck" : ants ? "ants" : "nothing";
        }
        return out;
    };
    const seen = [["report", look()]];
    for (const L of [9, 8, 6, 4, 2, 0]) { ascend(E, L, zoomAt[0], zoomAt[1]); seen.push(["level " + L, look()]); }
    for (const [label, got] of seen) {
        expect(Object.keys(got).length).toBe(6);
        expect([label, Object.entries(got).filter(([, v]) => v === "nothing").map(([k]) => k)]).toEqual([label, []]);
    }
    expect([seen[0][1][164], seen[0][1][173]]).toEqual(["speck", "speck"]);             // red before: nothing
    expect([118, 141, 145].map((k) => seen[1][1][k])).toEqual(["speck", "speck", "speck"]);   // red before: nothing
});
