/**
 * OT — TILES BELONG TO THE OBJECT (bible D2, D3, D4 and sections 4.5, 6.6, 6.9).
 *
 * Written against the design rather than against the code, because the design
 * is the thing that was agreed and the code is what has to answer to it. The
 * sentences these tests are trying to make true are Kobin's:
 *
 *   "The tile is where you chop the arc, so you don't have to calculate the
 *    whole thing... The important thing is that it's done the same, every time.
 *    You can't chop the arc in one place one time then somewhere slightly
 *    different the next time... So, tiles have to follow their objects, but
 *    that's ok - that's only two numbers which say where chops and culls are
 *    made."
 *
 *   "The object subdivides on the same tiles, even if it is moved."
 *
 *   "The object is a logical object - if it's been erased and that created
 *    child-ceded zones, the child objects go with it and have the same
 *    'tile'/clip-boundary structure."
 *
 *   "Keep freezing for cheapness. The arc will get comically straight anyways."
 *
 *   "...if one side converts, but the other is a tighter arc, we would need to
 *    confirm that the endpoint of that arc continues to match perfectly the
 *    endpoint of the already-converted line."
 *
 * WHY THIS MATTERS AND NOT JUST TIDINESS. A tile boundary is where an arc is
 * cut, and a cut is where the freeze decides whether a curve becomes the chord
 * between its own endpoints. Cut the same arc a quarter-pixel further along and
 * the chord is a different line: invisible where it happens, 4096 times that one
 * level down, 4096 times that again below. Anchor the cuts to the frame lattice
 * and a MOVE slides every one of them along the object — two arcs that crossed
 * at a point cross somewhere else, and a mark drawn at their intersection is no
 * longer at it. That is the failure this file exists to keep out.
 */
import { useEngines, mkEngine, drawStroke, descend, erase, inkAt, camShot as camShotOf, camRestore as camRestoreOf } from "./__testkit__/harness";
import { translateLoops, loopsBBox } from "./geometry/arcShape";
import { pieceBBox } from "./geometry/arcPerimeter";
import { chopFreezeLoops, pieceSagitta, tileWindow, tileClipRect } from "./geometry/freeze";
import { TILE, W, R, G, tilePhase, childTilePhase, objTileRange, objTileRect } from "./frameLattice";
import { shapeTol } from "./geometry/derive";

jest.setTimeout(300000);
useEngines();

// ---- fixtures --------------------------------------------------------------

/** A circle as `n` arc pieces, with consecutive pieces sharing endpoints. */
const arcLoop = (cx, cy, r, n = 4) => {
    const loop = [];
    for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, sweep = (Math.PI * 2) / n;
        loop.push({
            line: false, C: [cx, cy], r, a0, sweep,
            A: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
            B: [cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep)],
        });
    }
    for (let k = 0; k < n; k++) loop[k].B = loop[(k + 1) % n].A;
    return loop;
};

/**
 * A two-piece loop: one arc gentle enough to freeze at `tol`, one far too tight.
 * This is Kobin's tile-seam case built on purpose — the one place where a frozen
 * line and a live arc have to meet.
 */
const arcPiece = (A, B, bulge) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    const sweep = 4 * Math.atan(bulge);
    const r = L / (2 * Math.sin(sweep / 2));
    const h = r * Math.cos(sweep / 2);          // centre offset, on the left normal
    const C = [(A[0] + B[0]) / 2 - (dy / L) * h, (A[1] + B[1]) / 2 + (dx / L) * h];
    return { line: false, C, r, a0: Math.atan2(A[1] - C[1], A[0] - C[0]), sweep, A, B };
};
const mixedLoop = (chord, gentleBulge, tightBulge) => {
    const A = [0, 0], B = [chord, 0];
    return [[arcPiece(A, B, gentleBulge), arcPiece(B, A, tightBulge)]];
};

const vertsOf = (loops) => loops.map((loop) => loop.map((p) => [p.A[0], p.A[1], p.B[0], p.B[1]]));
const windowOver = (phase, loops) => {
    const b = loopsBBox(loops);
    return tileWindow(phase, { left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 });
};
const TOL = shapeTol({ arcTolerancePx: 0.25, enter: 256 });

/**
 * Drag one object by a sub-cell amount, so its grid and the frame's diverge.
 * The press has to land ON the ink — pressing empty paper starts a lasso, and
 * the object then never moves, which makes every assertion below vacuous.
 */
const nudge = (E, id, sx, sy, dx, dy) => {
    E._setSelection([id]);
    E.setTool("select");
    E.pointerDown(sx, sy);
    for (let i = 1; i <= 6; i++) E.pointerMove(sx + (dx * i) / 6, sy + (dy * i) / 6);
    E.pointerUp();
    const t = E.doc.getById(id).obj.tile;
    expect(t && (t[0] !== 0 || t[1] !== 0)).toBe(true);
    return t;
};
/** A cache square of `F` that actually holds some of the object's perimeter. */
const anyTile = (E, F) => {
    for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
            const objs = E.store._ensureUp(F, i, j).objs.filter((q) => q.type === "shape" && q.loops);
            if (objs.length) return { i, j, objs };
        }
    }
    return null;
};
/** Two side-by-side squares that both hold some of it. */
const adjacentTiles = (E, F) => {
    const has = (i, j) => E.store._ensureUp(F, i, j).objs.some((q) => q.type === "shape" && q.loops);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (has(i, j) && has(i + 1, j)) return { i, j };
    return null;
};

// ===========================================================================
describe("OT-1 — the grid is two numbers, and the lattice cannot move it", () => {
    test("a whole-cell move leaves the phase exactly where it was", () => {
        // Re-homing is how the lattice moves anything by a cell or more, and it
        // does it WITHOUT touching a coordinate: neighbouring cells' origins
        // differ by exactly one frame. A tile is one frame wide (D4), so the
        // phase is invariant under every re-homing there is — which is the whole
        // reason two numbers are enough to weld a grid to an object.
        // Dyadic values, because that is what the lattice actually produces:
        // every constant in it is a power of two and every coordinate reaches a
        // phase through exact arithmetic. The engine is stronger than this
        // anyway — re-homing does not RECOMPUTE the phase, it leaves it alone
        // (OT-4 pins that end-to-end).
        for (const phi of [0, 1, 12345.75, W - 1, W / 4 + 0.5]) {
            for (const k of [1, -1, 7, -2048, 2047]) {
                expect(tilePhase(tilePhase(phi) + k * W)).toBe(tilePhase(phi));
            }
        }
    });

    test("a sub-cell move takes the grid with it, exactly", () => {
        for (const phi of [0, 40000, W - 8]) {
            for (const d of [1, -1, 0.5, -1024.25]) {
                expect(tilePhase(tilePhase(phi) + d)).toBe(tilePhase(phi + d));
            }
        }
    });

    test("the grids NEST: one level down is the same grid, R times finer", () => {
        // Section 6.6: "Tile grids at successive levels are nested, sharing that
        // origin, each step dividing the one above by exactly the crossing
        // ratio." For a lattice edge the whole thing collapses to R*(phi mod G),
        // which is an integer subtraction and an exponent shift — no rounding
        // anywhere, at any depth.
        for (const phi of [0, 17, 12345.5, W - 3]) {
            for (const i of [0, 1, -1, 2047, -2048]) {
                const c = i * G;                       // a cell centre, in parent units
                expect(childTilePhase(phi, c, R)).toBe(tilePhase(R * (phi % G)));
                expect(childTilePhase(phi, c, R)).toBeGreaterThanOrEqual(0);
                expect(childTilePhase(phi, c, R)).toBeLessThan(W);
            }
        }
    });

    test("the clip rect is a whole number of tiles", () => {
        // What makes "a frame never cuts anything" true: geometry is clipped to
        // this, and its every edge is a grid line.
        const ph = [4321.5, 777];
        for (const cells of [{ i0: 0, i1: 0, j0: 0, j1: 0 }, { i0: -1, i1: 1, j0: 0, j1: 2 }]) {
            const r = tileClipRect(ph, cells);
            expect((r.left - ph[0] + TILE / 2) / TILE).toBe(cells.i0);
            expect((r.right - ph[0] - TILE / 2) / TILE).toBe(cells.i1);
            expect((r.top - ph[1] + TILE / 2) / TILE).toBe(cells.j0);
            expect((r.bottom - ph[1] - TILE / 2) / TILE).toBe(cells.j1);
        }
    });

    test("a tile is the same size as a frame (D4)", () => {
        expect(TILE).toBe(W);
        // ...and the cache partition agrees, so "chop it to the size of a frame
        // (since they're the same size)" is literally true of both grids.
        // eslint-disable-next-line global-require
        expect(require("./LevelMap").TILE).toBe(W);
    });

    test("tiles tile the plane: every point is in exactly one, boundaries included", () => {
        const ph = 4321.5;
        for (const x of [ph - W / 2, ph, ph + W / 2 - 1e-6, ph + W, ph - W]) {
            const rg = objTileRange(ph, 0, { left: x, right: x, top: 0, bottom: 0 });
            const r = objTileRect(ph, 0, rg.i0, 0);
            expect(x).toBeGreaterThanOrEqual(r.left);
            expect(x).toBeLessThanOrEqual(r.right);
        }
    });
});

// ===========================================================================
describe("OT-2 — the object subdivides on the same tiles, even if it is moved", () => {
    // THE HEADLINE of section 6.6, and the reason the grid is anchored to the
    // object at all. Everything is on integers here so the comparison can be
    // BIT-EXACT rather than "close": a quarter pixel of slop is precisely the
    // amount that is invisible now and 1,000 px one level down.
    const loops = [arcLoop(0, 0, 300000, 4)];
    const phase = [40000, 24000];
    const d = [8192, -4096];

    test("the cuts land in the same place on the object, wherever the object is", () => {
        const a = chopFreezeLoops(loops, phase, TOL, windowOver(phase, loops));
        const movedLoops = translateLoops(loops, d[0], d[1]);
        const movedPhase = [tilePhase(phase[0] + d[0]), tilePhase(phase[1] + d[1])];
        const b = chopFreezeLoops(movedLoops, movedPhase, TOL, windowOver(movedPhase, movedLoops));

        const va = vertsOf(a), vb = vertsOf(b);
        expect(vb.map((l) => l.length)).toEqual(va.map((l) => l.length));
        for (let i = 0; i < va.length; i++) {
            for (let k = 0; k < va[i].length; k++) {
                expect(vb[i][k]).toEqual([va[i][k][0] + d[0], va[i][k][1] + d[1],
                    va[i][k][2] + d[0], va[i][k][3] + d[1]]);
            }
        }
    });

    test("...and that is NOT what a frame-anchored grid does", () => {
        // The teeth. Move the ink and leave the grid where space put it — the
        // old behaviour — and the cuts land somewhere else on the object. If
        // this ever starts passing, the grid has stopped following the object.
        const a = chopFreezeLoops(loops, phase, TOL, windowOver(phase, loops));
        const movedLoops = translateLoops(loops, d[0], d[1]);
        const b = chopFreezeLoops(movedLoops, phase, TOL, windowOver(phase, movedLoops));
        const va = vertsOf(a).flat(), vb = vertsOf(b).flat();
        const same = va.length === vb.length && va.every((q, i) => q[0] + d[0] === vb[i][0] && q[1] + d[1] === vb[i][1]);
        expect(same).toBe(false);
    });

    test("chopping is idempotent and deterministic", () => {
        // D3: "the important thing about freezing is that it happens at the same
        // time every time you bake it."
        const win = windowOver(phase, loops);
        const a = chopFreezeLoops(loops, phase, TOL, win);
        const b = chopFreezeLoops(loops, phase, TOL, win);
        expect(vertsOf(b)).toEqual(vertsOf(a));
        // Chopping what is already chopped adds nothing: the cuts are already on
        // every grid line that crosses it.
        const c = chopFreezeLoops(a, phase, TOL, windowOver(phase, a));
        expect(vertsOf(c)).toEqual(vertsOf(a));
    });

    test("no piece is left straddling a tile boundary", () => {
        const a = chopFreezeLoops(loops, phase, TOL, windowOver(phase, loops));
        for (const loop of a) {
            for (const p of loop) {
                // Whatever else is true, no piece is wider than the tile it is
                // supposed to live in — which is what bounds both the work and,
                // through the sagitta, the freeze.
                const b = pieceBBox(p);
                expect(b[2] - b[0]).toBeLessThanOrEqual(TILE + 1e-6);
                expect(b[3] - b[1]).toBeLessThanOrEqual(TILE + 1e-6);
            }
        }
    });

    test("the chop does not disturb the loop: it still closes, exactly", () => {
        const a = chopFreezeLoops(loops, phase, TOL, windowOver(phase, loops));
        for (const loop of a) {
            for (let k = 0; k < loop.length; k++) {
                const next = loop[(k + 1) % loop.length];
                expect(loop[k].B).toEqual(next.A);   // bit-identical, not near
            }
        }
    });
});

// ===========================================================================
describe("OT-3 — the freeze (D2), and the endpoint invariant (6.9)", () => {
    test("a curve becomes a line exactly when its CHOPPED piece is within the budget", () => {
        // Stated as the rule itself rather than as a number, because the rule is
        // what has to hold: the decision is taken on the piece the tile grid
        // left, not on the arc it was cut from. A long gentle arc chopped in two
        // can freeze one half and not the other, and that is correct — the half
        // is straighter than the whole.
        const ph = [0, 0];
        let froze = 0, stayed = 0;
        for (const bulge of [1e-9, 4.88e-9, 2e-8, 1e-7, 1e-4, 0.3, 0.9]) {
            const loops = mixedLoop(100000, bulge, 0.9);
            const win = windowOver(ph, loops);
            const raw = chopFreezeLoops(loops, ph, 0, win).flat();       // chop only
            const out = chopFreezeLoops(loops, ph, TOL, win).flat();
            expect(out.length).toBe(raw.length);
            for (let k = 0; k < out.length; k++) {
                const should = pieceSagitta(raw[k]) <= TOL;
                expect([bulge, k, !!out[k].line]).toEqual([bulge, k, should]);
                if (should) froze++; else stayed++;
            }
        }
        expect(froze).toBeGreaterThan(0);
        expect(stayed).toBeGreaterThan(0);
    });

    test("a frozen piece is the CHORD BETWEEN ITS OWN ENDPOINTS, never a fit", () => {
        // Section 6.9 rule 1, and it is what makes rule 2 possible. The
        // endpoints have to come out bit-identical or a neighbour that has not
        // frozen no longer meets them.
        const chord = 100000;
        const loops = mixedLoop(chord, (2 * TOL) / chord * 0.5, 0.9);
        const ph = [0, 0];
        const before = vertsOf(chopFreezeLoops(loops, ph, Infinity, windowOver(ph, loops)));
        const after = vertsOf(chopFreezeLoops(loops, ph, TOL, windowOver(ph, loops)));
        expect(after).toEqual(before);
    });

    test("a frozen piece and a live arc meet at ONE point, bit for bit", () => {
        // Kobin's tile-seam worry, pinned rather than argued.
        const chord = 100000;
        const loops = mixedLoop(chord, (2 * TOL) / chord * 0.5, 0.9);
        const ph = [0, 0];
        const out = chopFreezeLoops(loops, ph, TOL, windowOver(ph, loops));
        for (const loop of out) {
            let seams = 0;
            for (let k = 0; k < loop.length; k++) {
                const a = loop[k], b = loop[(k + 1) % loop.length];
                expect(a.B).toEqual(b.A);
                if (!!a.line !== !!b.line) seams++;
            }
            expect(seams).toBeGreaterThan(0);   // the mixed seam really is there
        }
    });

    test("the freeze is MONOTONE: once a line, always a line", () => {
        // Section 4.4. One level down you see a smaller portion of the arc, so a
        // smaller sweep, so a smaller bulge — the decision, re-taken from exact
        // geometry at every level, can never un-freeze.
        //
        // Descending is done the way the chain does it — one cache tile's worth
        // at a time, magnified about the tile, everything outside dropped. That
        // is not a convenience: the window is what keeps the work bounded, and a
        // test that chopped the whole object at every level would be asking for
        // 1.5e11 grid lines by the fourth crossing.
        const win = { left: -TILE, top: -TILE, right: TILE, bottom: TILE };
        const near = (loops) => loops.map((loop) => loop.filter((p) => {
            const b = [Math.min(p.A[0], p.B[0]), Math.min(p.A[1], p.B[1]),
                Math.max(p.A[0], p.B[0]), Math.max(p.A[1], p.B[1])];
            return b[2] >= win.left && b[0] <= win.right && b[3] >= win.top && b[1] <= win.bottom;
        })).filter((loop) => loop.length);
        let cur = [arcLoop(0, 400000, 400000, 4)], ph = [17, 23];
        const lines = [];
        for (let d = 0; d < 5; d++) {
            cur = chopFreezeLoops(cur, ph, TOL, tileWindow(ph, win));
            const seen = near(cur).flat();
            if (!seen.length) break;
            lines.push(seen.filter((p) => p.line).length / seen.length);
            // ...and down a level: the same grid R times finer, the same arcs R
            // times bigger, about the tile the view is standing on.
            cur = near(cur).map((loop) => loop.map((p) => (p.line
                ? { line: true, A: [p.A[0] * R, p.A[1] * R], B: [p.B[0] * R, p.B[1] * R] }
                : { line: false, C: [p.C[0] * R, p.C[1] * R], r: p.r * R, a0: p.a0, sweep: p.sweep,
                    A: [p.A[0] * R, p.A[1] * R], B: [p.B[0] * R, p.B[1] * R] })));
            ph = [childTilePhase(ph[0], 0, R), childTilePhase(ph[1], 0, R)];
        }
        expect(lines.length).toBeGreaterThan(2);
        for (let i = 1; i < lines.length; i++) expect(lines[i]).toBeGreaterThanOrEqual(lines[i - 1]);
        expect(lines[0]).toBe(0);                  // it starts as a curve...
        expect(lines[lines.length - 1]).toBe(1);   // "comically straight anyways"
    });

    test("a frame never cuts geometry: the clip lands on the object's own lines", () => {
        // Kobin, 2026-08-19: there are two kinds of trimming and only two. The
        // TILE trims geometry. The FRAME decides which objects are looked at and
        // cuts nothing. So after a move — when the two grids no longer line up —
        // nothing stored may end on the cache square's edge.
        const E = mkEngine();
        const o = drawStroke(E, [[200, 300], [400, 420], [600, 240]], 24);
        nudge(E, o.id, 400, 420, 9, 5);
        descend(E, 1, 400, 330);
        const F = E.cam.frame;
        const found = anyTile(E, F);
        expect(found).toBeTruthy();
        const rect = E.lm.tileRect(F, found.i, found.j);
        const objs = found.objs;
        let onGrid = 0, onSquare = 0;
        for (const o of objs) {
            const ph = o.tile || [0, 0];
            const onLine = (v, phase) => {
                const k = (v - phase) / TILE + 0.5;
                return Math.abs(k - Math.round(k)) < 1e-9;
            };
            for (const loop of o.loops) {
                for (const p of loop) {
                    for (const q of [p.A, p.B]) {
                        const gx = onLine(q[0], ph[0]), gy = onLine(q[1], ph[1]);
                        if (gx || gy) onGrid++;
                        const sq = (Math.abs(q[0] - rect.left) < 1e-6 || Math.abs(q[0] - rect.right) < 1e-6
                            || Math.abs(q[1] - rect.top) < 1e-6 || Math.abs(q[1] - rect.bottom) < 1e-6);
                        if (sq && !gx && !gy) onSquare++;
                    }
                }
            }
        }
        expect(onGrid).toBeGreaterThan(0);   // the tile really did cut something
        expect(onSquare).toBe(0);            // ...and the frame cut nothing
    });

    test("two cache squares treat the same stretch of curve identically", () => {
        // The failure this replaces: two squares held one arc cut in two
        // different places, froze each to its own chord, and disagreed by a
        // quarter pixel — and by 1,000 px one level below. Clipping on the
        // object's grid means both squares hold the SAME pieces, so a piece
        // found in both must be identical down to the last bit, freeze verdict
        // and all.
        const E = mkEngine();
        const o = drawStroke(E, [[100, 300], [400, 460], [700, 220]], 26);
        nudge(E, o.id, 400, 460, 13, 7);
        descend(E, 1, 400, 360);
        const F = E.cam.frame;
        const sig = (p) => (p.line ? `L ${p.C ? "" : ""}` : `A ${p.C[0]} ${p.C[1]} ${p.r} ${p.a0} ${p.sweep}`);
        const key = (p) => `${p.A[0]},${p.A[1]}|${p.B[0]},${p.B[1]}`;
        const gather = (i, j) => {
            const m = new Map();
            for (const o of E.store._ensureUp(F, i, j).objs) {
                if (o.type !== "shape" || !o.loops) continue;
                for (const loop of o.loops) for (const p of loop) m.set(o.id + "#" + key(p), sig(p));
            }
            return m;
        };
        const pair = adjacentTiles(E, F);
        expect(pair).toBeTruthy();
        const A = gather(pair.i, pair.j), B = gather(pair.i + 1, pair.j);
        let shared = 0;
        for (const [k, v] of A) {
            if (!B.has(k)) continue;
            shared++;
            expect([k, B.get(k)]).toEqual([k, v]);
        }
        expect(shared).toBeGreaterThan(0);   // the two squares really do overlap
    });

    test("sagitta is computed from LOCAL data, so no radius can spoil it", () => {
        // Section 3.1a: the centre is never computed. (chord/2)*|tan(sweep/4)|
        // holds at radii where centre-and-radius arithmetic has stopped meaning
        // anything at all.
        for (const r of [1, 1e6, 1e12, 1e18]) {
            const sweep = 1e-7;
            const chord = 2 * r * Math.sin(sweep / 2);
            const p = { line: false, C: [1e18, 1e18], r, a0: 0, sweep,
                A: [0, 0], B: [chord, 0] };
            // The versine, written the stable way — the oracle must not be the
            // thing that cancels.
            const exact = 2 * r * Math.sin(sweep / 4) ** 2;
            expect(Math.abs(pieceSagitta(p) - exact)).toBeLessThan(1e-9 * exact);
        }
        // A piece past a half turn is never straight, whatever the tangent says.
        expect(pieceSagitta({ line: false, C: [0, 0], r: 1, a0: 0, sweep: 4, A: [1, 0], B: [1, 0] })).toBe(Infinity);
    });
});

// ===========================================================================
describe("OT-4 — a drawn object carries its grid through the engine", () => {
    test("a sub-cell drag moves the grid with the ink", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 300], [550, 300]], 30);
        expect(o.tile == null || (o.tile[0] === 0 && o.tile[1] === 0)).toBe(true);
        E.setTool("select"); E.pointerDown(400, 300); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(400, 300);
        for (let i = 1; i <= 6; i++) E.pointerMove(400 + (9 * i) / 6, 300);
        E.pointerUp();
        const rec = E.doc.getById(o.id);
        expect(rec).toBeTruthy();
        // Nine units across, none of them a whole cell: the grid has to have
        // moved with it, or the object has slid out from under its own cuts.
        expect(rec.obj.tile).toBeTruthy();
        expect(tilePhase(rec.obj.tile[0])).toBeCloseTo(tilePhase(9), 9);
        expect(rec.obj.tile[1]).toBe(0);
    });

    test("a ceded family shares ONE grid, at every level (D4)", () => {
        const E = mkEngine();
        drawStroke(E, [[250, 300], [550, 300]], 30);
        descend(E, 3, 400, 300);
        erase(E, [[400, 280], [400, 320]], 20);
        const members = [];
        for (const L of E.doc.levels()) for (const q of E.doc.at(L)) if (!q.erase) members.push({ obj: q, level: L });
        expect(members.length).toBeGreaterThan(1);
        // Each member's grid is its parent frame's member's grid, carried down
        // by the one formula. Nothing in the family is on a grid of its own.
        for (const m of members) {
            const f = E.lm.frame(m.level);
            if (!f || !f.parent) continue;
            const up = members.find((q) => q.level === f.parent);
            if (!up) continue;
            const want = [childTilePhase((up.obj.tile || [0, 0])[0], f.centre.x, R),
                childTilePhase((up.obj.tile || [0, 0])[1], f.centre.y, R)];
            const got = m.obj.tile || [0, 0];
            expect([m.level, tilePhase(got[0]), tilePhase(got[1])])
                .toEqual([m.level, tilePhase(want[0]), tilePhase(want[1])]);
        }
    });

    test("a ceded rect is minted on the OBJECT's grid, not the frame's", () => {
        // Draft 2's open question 6, which section 6.6 claims to close: "two
        // cedes made either side of a move land on the same grid and cannot
        // partially overlap." They can only fail to overlap cleanly if the rect
        // is cut on something the move slid out from under.
        const E = mkEngine();
        const o = drawStroke(E, [[250, 300], [550, 300]], 30);
        E.setTool("select"); E.pointerDown(400, 300); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(400, 300);
        for (let i = 1; i <= 6; i++) E.pointerMove(400 + (9 * i) / 6, 300);
        E.pointerUp();
        expect(E.doc.getById(o.id).obj.tile[0]).not.toBe(0);

        descend(E, 2, 409, 300);
        erase(E, [[409, 280], [409, 320]], 20);
        const kids = [];
        for (const L of E.doc.levels()) for (const q of E.doc.at(L)) if (!q.erase && q.attachRect) kids.push({ obj: q, level: L });
        expect(kids.length).toBeGreaterThan(0);
        let offFrameGrid = 0;
        for (const k of kids) {
            const ph = k.obj.tile || [0, 0];
            // On the object's grid: a whole number of tiles from its phase.
            const ix = (k.obj.attachRect.x0 - ph[0] + TILE / 2) / TILE;
            const iy = (k.obj.attachRect.y0 - ph[1] + TILE / 2) / TILE;
            expect(Math.abs(ix - Math.round(ix))).toBeLessThan(1e-6);
            expect(Math.abs(iy - Math.round(iy))).toBeLessThan(1e-6);
            // ...and, for at least one of them, NOT on the frame's grid — which
            // is the whole difference the move makes.
            const fx = (k.obj.attachRect.x0 + TILE / 2) / TILE;
            if (Math.abs(fx - Math.round(fx)) > 1e-6) offFrameGrid++;
        }
        expect(offFrameGrid).toBeGreaterThan(0);
    });

    test("a saved drawing keeps its grid", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[250, 300], [550, 300]], 30);
        E.setTool("select"); E.pointerDown(400, 300); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
        E.pointerDown(400, 300);
        for (let i = 1; i <= 6; i++) E.pointerMove(400 + (9 * i) / 6, 300);
        E.pointerUp();
        const want = E.doc.getById(o.id).obj.tile.slice();
        const snap = E.snapshot();
        const F = mkEngine();
        F.loadSnapshot(JSON.parse(JSON.stringify(snap)));
        const back = F.doc.getById(o.id);
        expect(back).toBeTruthy();
        expect(back.obj.tile).toEqual(want);
    });
});

// ===========================================================================
describe("OT-5 — the user's scenario: a mark at an intersection, then a move", () => {
    test("the mark is still on the crossing after the whole lot is moved", () => {
        // Kobin's star. Two strokes crossing; go down to the crossing and put a
        // mark on it; come back up, move everything together, go back down. The
        // mark has to still be at the crossing — which it can only be if the
        // cuts, and therefore the frozen chords, landed in the same place on the
        // objects after the move as before it.
        const E = mkEngine();
        drawStroke(E, [[200, 220], [600, 380]], 16);
        drawStroke(E, [[200, 380], [600, 220]], 16);
        expect(inkAt(E, 400, 300)).toBe(true);          // they cross mid-screen

        descend(E, 2, 400, 300);
        const mark = drawStroke(E, [[396, 300], [404, 300]], 6);
        expect(mark).toBeTruthy();
        const onBoth = (eng) => {
            const list = eng.doc.levels().flatMap((L) => eng.doc.at(L).filter((q) => !q.erase));
            return list.length;
        };
        const nBefore = onBoth(E);

        // Back to the top and move everything by a sub-cell amount.
        let guard = 0;
        while (E.activeLevel > 0 && guard++ < 600) E.zoomAt(400, 300, 1000);
        const ids = [];
        for (const L of E.doc.levels()) for (const q of E.doc.at(L)) if (!q.erase) ids.push(q.id);
        E._setSelection(ids);
        E.setTool("select"); E.pointerDown(400, 300);
        for (let i = 1; i <= 6; i++) E.pointerMove(400 + (37 * i) / 6, 300 + (11 * i) / 6);
        E.pointerUp();
        expect(onBoth(E)).toBe(nBefore);                 // nothing shattered

        // The crossing moved with them, and the mark is still on it.
        expect(inkAt(E, 437, 311)).toBe(true);
        descend(E, 2, 437, 311);
        E._render();
        const list = E._objs().filter((q) => !q.erase);
        const here = list.filter((q) => pieceCovers(q, E, 400, 300));
        expect(here.length).toBeGreaterThanOrEqual(2);   // mark AND the crossing ink
    });
});

// A piece painting the given screen point.
function pieceCovers(q, E, sx, sy) {
    // eslint-disable-next-line global-require
    const { pieceInks } = require("./__testkit__/ink");
    return pieceInks(q, E.cam.screenToFrame(sx, sy));
}

/**
 * OT-6 — TWO CEDES EITHER SIDE OF A MOVE CANNOT PARTIALLY OVERLAP.
 *
 * Draft 2's open question 6, which section 6.6 closes by minting cede rects on
 * the object's own grid rather than on the frame's. Reported for real on
 * 2026-08-20: a line that should have been solid had a break in it, and pulling
 * one side away took half the object with it, split at a tile boundary rather
 * than where the eraser had cut.
 *
 * The drawing showed why. Every ceded rect in it was minted on the FRAME grid,
 * and 55 pairs of them overlapped on DIFFERENT alignments — offsets of 0.00985
 * and 0.02523 of a tile, a few hundred units. Two rects that overlap by part of
 * a tile cut the parent twice on two different lines; the sliver between them is
 * claimed by neither child, so there is a real hole in the ink, and the pieces
 * either side end up in different families.
 */
describe("OT-6 — cedes made either side of a move land on the same grid", () => {
    const cedeRects = (E) => {
        const byFrame = new Map();
        for (const k of E.doc.levels()) {
            for (const o of E.doc.at(k)) {
                if (o.erase || !o.attachRect) continue;
                if (!byFrame.has(k)) byFrame.set(k, []);
                byFrame.get(k).push(o);
            }
        }
        return byFrame;
    };
    /** Every overlapping pair in one frame, and whether they share a grid. */
    const misaligned = (E) => {
        const bad = [];
        for (const [k, objs] of cedeRects(E)) {
            for (let a = 0; a < objs.length; a++) {
                for (let b = a + 1; b < objs.length; b++) {
                    const A = objs[a].attachRect, B = objs[b].attachRect;
                    if (!(Math.min(A.x1, B.x1) > Math.max(A.x0, B.x0)
                        && Math.min(A.y1, B.y1) > Math.max(A.y0, B.y0))) continue;
                    const step = Math.min(A.x1 - A.x0, B.x1 - B.x0);
                    const nx = (A.x0 - B.x0) / step, ny = (A.y0 - B.y0) / step;
                    if (Math.abs(nx - Math.round(nx)) > 1e-6 || Math.abs(ny - Math.round(ny)) > 1e-6) {
                        bad.push({ k, a: objs[a].id, b: objs[b].id, nx, ny });
                    }
                }
            }
        }
        return bad;
    };

    test("erase, move, erase again — and the two rects are whole tiles apart", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[150, 300], [650, 300]], 40);
        const top = camShotOf(E);

        descend(E, 2, 380, 300);
        erase(E, [[380, 285], [380, 315]], 18);
        camRestoreOf(E, top);

        // ...move the whole thing by an amount that is NOT a whole cell...
        const fam = [];
        for (const L of E.doc.levels()) for (const q of E.doc.at(L)) if (!q.erase) fam.push(q.id);
        E._setSelection(fam);
        E.setTool("select");
        E.pointerDown(500, 300);
        for (let i = 1; i <= 6; i++) E.pointerMove(500 + (23 * i) / 6, 300 + (11 * i) / 6);
        E.pointerUp();

        // ...and erase again, in the same place on the object.
        descend(E, 2, 403, 311);
        erase(E, [[403, 296], [403, 326]], 18);

        expect(misaligned(E)).toEqual([]);
    });

    test("the same thing without a move, for contrast", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        const top = camShotOf(E);
        descend(E, 2, 380, 300);
        erase(E, [[380, 285], [380, 315]], 18);
        camRestoreOf(E, top);
        descend(E, 2, 420, 300);
        erase(E, [[420, 285], [420, 315]], 18);
        expect(misaligned(E)).toEqual([]);
    });
});
