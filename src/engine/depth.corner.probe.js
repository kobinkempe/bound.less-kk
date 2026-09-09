/**
 * PROBE, not a test (the suite does not run *.probe.js; see tools/harnesses/README.md):
 *
 *   npx react-scripts test --watchAll=false --testMatch "**\/depth.corner.probe.js"
 *
 * Kobin's corner-invalidation scenario (2026-09-05). A corner of a coarse object
 * is zoomed to level 8 (detail would be drawn there). Zoom out to level 3 and
 * make an eraser mark near, but not on, the corner — it invalidates the level-4
 * tile the corner hangs off. Zoom back in: is the level-8 picture of the corner
 * bit-identical? MEASURED on 2026-09-05 morning: no — 3.7e-5 units at level 5,
 * 0.083 at 6, 342 at 7, the tile empty at 8 (OPEN-FLAGS F43). MEASURED the
 * same evening, with F43 built (a line piece remembers the line it was cut
 * from): the horizontal-arm case is bit-identical at levels 5–8 and its
 * level-8 edge is at the same screen y to the last digit; the slanted-arm case
 * was bit-identical at 5 and 0.0946 units off at 4, in the point where an
 * unfrozen arc of radius 2.6e16 meets the padded window; the join-arc case
 * differed at 4 and 5. MEASURED later that night, with the arc half built (a
 * cut arc keeps the arc the chain would have had): the slanted arm is
 * bit-identical at 4 and 5 too; the join arc still differed, because the
 * boolean's own flatness test chorded an arc the chain kept. MEASURED
 * 2026-09-06, with the freeze one radius (F44, Kobin's rule; the boolean
 * uses the same gate): all three cases descend to level 8 without losing the
 * edge — the two arc cases used to lose it at the fifth crossing — and all
 * three are bit-identical at level 8 after the nick, the edge's screen
 * position identical to the last digit. So every `expect(same)` PASSES, and
 * this stays a probe only because its value is the per-level printout: the
 * `perLevel` line (`worst` names the number that differs most; the piece
 * strings are printed whenever a level differs). The "nick
 * at moderate zoom" block was the F46 hunt and passes since the fix.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, painted } from "./__testkit__/harness";
import { inks } from "./__testkit__/ink";
import { subtractShape, loopsArea, loopsBBox } from "./geometry/arcShape";

jest.setTimeout(300000);
useEngines();

const loopStrs = (loops) => loops.map((loop) => JSON.stringify(loop.map((p) => (p.line
    ? [0, p.A[0], p.A[1], p.B[0], p.B[1]]
    : [1, p.A[0], p.A[1], p.B[0], p.B[1], p.C[0], p.C[1], p.r, p.a0, p.sweep]))));
const edgeAtY = (E, sx, y0, y1) => {
    const list = painted(E);
    const ink = (y) => inks(list, E.cam.screenToFrame(sx, y));
    const a = ink(y0), b = ink(y1);
    if (a === b) return null;
    let lo = y0, hi = y1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ink(m) === a) lo = m; else hi = m; }
    return (lo + hi) / 2;
};
// First paper->ink transition scanning the whole column from the top (fallback when the
// narrow search loses the edge, e.g. after an F44 jump).
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
// Descend one crossing at a time, re-aiming on the ink's upper edge under (col, y). Stops early
// (returns the level reached) when the edge is lost, which F44 does at the fifth crossing on an arc.
const descendOnEdge = (E, col, n, y0) => {
    let y = y0;
    for (let d = E.activeLevel; d < n; d++) {
        const narrow = edgeAtY(E, col, y - 20, y + 5);
        const e = narrow ?? scanEdge(E, col);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ descend: d, frame: E.cam.frame, yWanted: y, narrow, found: e }));
        if (e == null) return { level: d, y, lost: true };
        y = e;
        let guard = 0;
        while (E.activeLevel === d && guard++ < 40) E.zoomAt(col, y, -1000);
        expect(E.activeLevel).toBe(d + 1);
    }
    return { level: E.activeLevel, y, lost: false };
};
const ascendTo = (E, col, n, y) => {
    let guard = 0;
    while (E.activeLevel > n && guard++ < 600) E.zoomAt(col, y, 1000);
    expect(E.activeLevel).toBe(n);
};

// Cases: (a) the join arc itself (Kobin's literal corner) — F44 is expected to lose it at the
// fifth crossing; (b) the horizontal arm 10 units before the corner — cuts of an axis-aligned
// line are exact whatever its endpoints, so the nick should leave the deep picture bit-identical;
// (c) a slanted arm — the nick changes the far endpoint of the line piece the corner tile is
// derived from, and slanted cuts interpolate from the endpoints (F43): expected bit-different.
// The everyday case: a nick across the edge of an ordinary curved stroke at levels 1..4. At each
// level the store's piece for the edge is an arc of r0 * 4096^k; the boolean floor probe says a
// tile-spanning arc is cut in the wrong place for r between ~1e8 and the straighten threshold.
describe("nick at moderate zoom", () => {
    test.each([["slanted arm", [[150, 350], [400, 300], [400, 550]], 20, 390, 292, 1],
        ["slanted arm", [[150, 350], [400, 300], [400, 550]], 20, 390, 292, 2],
        ["slanted arm", [[150, 350], [400, 300], [400, 550]], 20, 390, 292, 3],
        ["slanted arm", [[150, 350], [400, 300], [400, 550]], 20, 390, 292, 4],
        ["gentle curve", [[250, 320], [400, 280], [550, 320]], 20, 401, 270, 1],
        ["gentle curve", [[250, 320], [400, 280], [550, 320]], 20, 401, 270, 2],
        ["gentle curve", [[250, 320], [400, 280], [550, 320]], 20, 401, 270, 3],
        ["gentle curve", [[250, 320], [400, 280], [550, 320]], 20, 401, 270, 4]])
    ("%s: nick at level %s", (name, pts, w, col, yGuess, lvl) => {
        const E = mkEngine();
        drawStroke(E, pts, w);
        const y0 = edgeAtY(E, col, yGuess - 40, yGuess + 10);
        expect(y0).not.toBeNull();
        const reached = descendOnEdge(E, col, lvl, y0);
        expect(reached.level).toBe(lvl);
        // A little further in, so the piece under the nick is the level's own tile piece at a
        // mid-level zoom (not the crossing zoom).
        for (let i = 0; i < 6; i++) E.zoomAt(col, reached.y, -300);
        const yHere = edgeAtY(E, col, reached.y - 40, reached.y + 40) ?? scanEdge(E, col);
        expect(yHere).not.toBeNull();
        const nickX = col + 300;
        const yN = edgeAtY(E, nickX, yHere - 200, yHere + 200) ?? scanEdge(E, nickX);
        expect(yN).not.toBeNull();
        const inkPieces = E.store.content(E.cam.frame, E.cam.frameWindow(0)).filter((o) => o.id === 1 && o.loops);
        let rmax = 0, arcs = 0, lines = 0;
        for (const o of inkPieces) for (const l of o.loops) for (const p of l) { if (p.line) lines++; else { arcs++; rmax = Math.max(rmax, Math.abs(p.r)); } }
        E.setEraserSize(12);
        eraseGesture(E, [[nickX, yN - 30], [nickX, yN + 30]]);
        if (typeof E.flushBakes === "function") E.flushBakes();
        const eraser = E.doc.at(E.cam.frame).find((o) => o.erase && o.loops && o.loops.length);
        let direct = null;
        if (eraser && inkPieces.length) {
            const ink = [].concat(...inkPieces.map((o) => o.loops));
            const res = subtractShape(ink, eraser.loops);
            direct = { removed: +(loopsArea(ink) - loopsArea(res.loops)).toFixed(4), crossings: res.stats && res.stats.crossings, straightened: res.stats && res.stats.straightened, open: res.stats && res.stats.openChains };
        }
        E.flushErases();
        const probe = (dx, dy) => inks(painted(E), E.cam.screenToFrame(nickX + dx, yN + dy));
        const out = { name, lvl, inScale: E.cam.inScale, frame: E.cam.frame, ink: { arcs, lines, rmax }, direct, why: E._rehomeWhy || null,
            after: { above: probe(0, -8), inNotch: probe(0, 6), inNotch2: probe(0, 20), left: probe(-40, 20), right: probe(40, 20), deep: probe(0, 100) },
            natives: E.doc.levels().reduce((s, k) => s + E.doc.at(k).filter((o) => !o.erase).length, 0) };
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(out));
        // Expected after a real nick: paper inside the notch, ink either side and below it.
        expect(out.after).toEqual({ above: false, inNotch: false, inNotch2: false, left: true, right: true, deep: true });
    });
});

describe("corner invalidation", () => {
    test.each([["join arc at the corner", [[150, 300], [400, 300], [400, 550]], 20, 401, 290],
        ["horizontal arm near the corner", [[150, 300], [400, 300], [400, 550]], 20, 390, 290],
        ["slanted arm near the corner", [[150, 350], [400, 300], [400, 550]], 20, 390, 292]])
    ("%s: deep pieces after a level-3 nick nearby", (name, pts, w, col, yGuess) => {
        const E = mkEngine();
        drawStroke(E, pts, w);
        // Aim at the upper edge of the ink at column col (yGuess+10 is inside the ink).
        const y0 = edgeAtY(E, col, yGuess - 40, yGuess + 10);
        expect(y0).not.toBeNull();
        const reached = descendOnEdge(E, col, 8, y0);
        const F8 = E.cam.frame;
        const shot = { ...E.cam.state() };
        const win8 = E.cam.frameWindow(0);
        // The pieces every level from 3 down to the deep frame holds over the deep window
        // (mapped up into that level), as sorted strings — the whole derivation chain, bit for bit.
        const ancestors = (Fdeep, fromDepth) => { const parts = Fdeep.split("/"); const out = []; for (let d = fromDepth; d < parts.length; d++) out.push(parts.slice(0, d + 1).join("/")); return out; };
        const strsOf = (c) => c.filter((o) => o.type === "shape" || o.type === "fill").map((o) => (o.loops ? loopStrs(o.loops).join("|") : JSON.stringify(o.polys))).sort();
        const chainPieces = () => ancestors(F8, 3).map((Fk) => { const r = E.lm.mapRectF(win8, F8, Fk); return { Fk, strs: r ? strsOf(E.store.content(Fk, r)) : [] }; });
        const numsOf = (strs) => (strs.join("|").match(/-?\d+(\.\d+)?(e[-+]?\d+)?/g) || []).map(Number);
        const cmp = (a, b) => {
            if (a.strs.length !== b.strs.length) return { same: false, why: `pieces ${a.strs.length} vs ${b.strs.length}`, aStrs: a.strs, bStrs: b.strs };
            const na = numsOf(a.strs), nb = numsOf(b.strs);
            if (na.length !== nb.length) return { same: false, why: `numbers ${na.length} vs ${nb.length}`, aStrs: a.strs, bStrs: b.strs };
            let mx = 0, at = -1; for (let i = 0; i < na.length; i++) { const d = Math.abs(na[i] - nb[i]); if (d > mx) { mx = d; at = i; } }
            // `worst` names the number that differs most (its index in the flattened
            // piece strings, both values) so a per-level difference can be read
            // back to a vertex: the piece strings are [0, Ax, Ay, Bx, By] per line
            // and [1, Ax, Ay, Bx, By, Cx, Cy, r, a0, sweep] per arc.
            return mx === 0 ? { same: true, maxDiff: 0 } : { same: false, maxDiff: mx, worst: { at, a: na[at], b: nb[at] }, aStrs: a.strs, bStrs: b.strs };
        };
        const arcSummary = (c) => { let lines = 0, arcs = 0, rmax = 0; for (const o of c) for (const l of (o.loops || [])) for (const p of l) { if (p.line) lines++; else { arcs++; rmax = Math.max(rmax, Math.abs(p.r)); } } return { pieces: c.length, lines, arcs, rmax }; };
        E.store.bumpEpoch();
        const before = chainPieces();
        const was = before[before.length - 1].strs;
        const yEdge8 = edgeAtY(E, col, 100, 500);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ name, reached, F8, piecesDeep: was.length, edgeYDeep: yEdge8, perLevelBefore: before.map((b, i) => ({ depth: i + 3, n: b.strs.length, chars: b.strs.join("").length })) }));
        // eslint-disable-next-line no-console
        console.log("DEEP PIECE " + (was[0] || "").slice(0, 600));

        // Out to level 3 (about the edge point, so it stays on screen) and a nick 300 px along
        // the edge, away from the column.
        ascendTo(E, col, 3, reached.y);
        const y3 = edgeAtY(E, col, 100, 500);
        expect(y3).not.toBeNull();
        const nickX = col + 300;
        const yN = edgeAtY(E, nickX, y3 - 200, y3 + 200) ?? scanEdge(E, nickX);
        const docSummary = () => E.doc.levels().flatMap((k) => E.doc.at(k).map((o) => ({
            id: o.id, level: k, type: o.type, n: (o.loops || []).reduce((s, l) => s + l.length, 0),
            below: o.below || null, rect: o.attachRect || null, tile: o.tile || null, editId: o.editId ?? null,
        })));
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ level3: { frame: E.cam.frame, inScale: E.cam.inScale, y3, yN, inkHere: arcSummary(E.store.content(E.cam.frame, E.cam.frameWindow(0))), doc: docSummary() } }));
        if (yN != null) {
            E.setEraserSize(12);
            eraseGesture(E, [[nickX, yN - 30], [nickX, yN + 30]]);
            // The very subtraction the last cede link will do, done here in the open: the store's
            // ink for this square (the piece the renderer draws) minus the eraser's own perimeter.
            if (typeof E.flushBakes === "function") E.flushBakes();
            const eraser = E.doc.at(E.cam.frame).find((o) => o.erase && o.loops && o.loops.length);
            const inkPieces = E.store.content(E.cam.frame, E.cam.frameWindow(0)).filter((o) => o.id === 1 && o.loops);
            if (eraser && inkPieces.length) {
                const ink = [].concat(...inkPieces.map((o) => o.loops));
                const res = subtractShape(ink, eraser.loops);
                const eb = loopsBBox(eraser.loops);
                // eslint-disable-next-line no-console
                console.log(JSON.stringify({ directBoolean: { inkLoops: ink.length, inkPieces: ink.reduce((s, l) => s + l.length, 0), eraserPieces: eraser.loops.reduce((s, l) => s + l.length, 0), eraserBox: eb && [eb.x0, eb.y0, eb.x1 - eb.x0, eb.y1 - eb.y0], areaBefore: loopsArea(ink), removed: loopsArea(ink) - loopsArea(res.loops), stats: res.stats } }));
                // eslint-disable-next-line no-console
                console.log("INK PIECES " + loopStrs(ink).join("|").slice(0, 1500));
            }
            E.flushErases();
            const probe = (dy) => inks(painted(E), E.cam.screenToFrame(nickX, yN + dy));
            // eslint-disable-next-line no-console
            const note = (E.journal || []).filter((j) => j.kind === "erase").slice(-1)[0] || null;
            console.log(JSON.stringify({ afterNick: { painted: painted(E).length, ink: { m30: probe(-30), m6: probe(-6), p6: probe(6), p30: probe(30), p100: probe(100) }, why: E._rehomeWhy || null, doc: docSummary(), note: note && { cuts: note.cuts, refused: note.refused, looked: note.looked } } }));
            expect(probe(6)).toBe(false);
        }
        // Back to the exact camera. First as the incremental tile updates left the store, then
        // after a full rebake — the two must agree, and both are compared with the picture before.
        E.cam.set(shot); E._render();
        const afterIncr = chainPieces();
        E.store.bumpEpoch();
        const afterFull = chainPieces();
        const now = afterFull[afterFull.length - 1].strs;
        const yEdge8b = edgeAtY(E, col, 100, 500);
        const same = now.length === was.length && now.every((s, i) => s === was[i]);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ name, level: reached.level, piecesNow: now.length, same, edgeYBefore: yEdge8, edgeYAfter: yEdge8b, movedPx: (yEdge8 != null && yEdge8b != null) ? yEdge8b - yEdge8 : null, nicked: yN != null,
            perLevel: before.map((b, i) => ({ depth: i + 3, n: b.strs.length, vsBefore: cmp(b, afterFull[i]), incrVsFull: cmp(afterIncr[i], afterFull[i]) })) }));
        if (!same) {
            // Where do they differ? First differing piece, first 400 chars of each.
            for (let i = 0; i < Math.max(was.length, now.length); i++) {
                if (was[i] !== now[i]) {
                    // eslint-disable-next-line no-console
                    console.log("DIFF at " + i + "\n  was: " + (was[i] || "").slice(0, 400) + "\n  now: " + (now[i] || "").slice(0, 400));
                    break;
                }
            }
        }
        expect(same).toBe(true);
    });
});
