/**
 * DR — nothing the engine mints can make a drawing unopenable.
 *
 * Found 2026-08-21, and not by looking for it: the suite loads every file in
 * `.kobin-reports` as a drawing, and Kobin's desktop report from that morning
 * would not load. Two independent defects, in the same session, each on its own
 * enough to lose the drawing:
 *
 *   1. A FRAME CELL OUTSIDE THE DIGIT RANGE. `cellOf` is a bare Math.round with
 *      no range check and `_viewCell` feeds it the view centre, so a camera that
 *      crossed while its centre sat just outside the parent's own square minted
 *      a frame at cell 2059 where the range is [-2048, 2048). The overshoot was
 *      352 units out of 65,536 — half a percent. `neighbour` had handled exactly
 *      this since the lattice landed, by carrying into the parent; the crossing
 *      path simply never used it.
 *
 *   2. A TILE PHASE OF EXACTLY W. `tilePhase` normalises into [0, TILE) by
 *      adding TILE to a negative remainder — but a remainder a hair below zero
 *      rounds to exactly TILE when TILE is added, because 131072 needs six
 *      significant digits and anything under ~1e-11 vanishes against it. Four
 *      objects were saved with a phase of [~1e-25, 131072].
 *
 * Neither hurt the live session. Both only bit on RELOAD, which is the worst
 * possible shape for a bug in a drawing program: the work looks fine right up
 * until you try to open it again.
 */
import { tilePhase, inDigit, TILE, W, HALF_R } from "./frameLattice";
import LevelMap from "./LevelMap";
import { useEngines, mkEngine, drawStroke, descend } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

describe("DR-1 — a phase is always inside [0, TILE)", () => {
    test("a remainder a hair below zero does not round up to TILE", () => {
        // the shape of the values actually saved
        for (const v of [-1e-25, -1e-21, -1e-18, -1e-14, -1e-12]) {
            const p = tilePhase(v);
            expect([v, p >= 0 && p < TILE]).toEqual([v, true]);
        }
    });

    test("ordinary phases are untouched", () => {
        expect(tilePhase(0)).toBe(0);
        expect(tilePhase(5)).toBe(5);
        expect(tilePhase(TILE)).toBe(0);
        expect(tilePhase(TILE + 7)).toBe(7);
        expect(tilePhase(-1)).toBe(TILE - 1);
        expect(Object.is(tilePhase(-0), 0)).toBe(true);   // never -0
    });

    test("no input produces a phase outside the range", () => {
        const xs = [0, -0, 1e-30, -1e-30, 1, -1, TILE, -TILE, TILE - 1e-9, 1e17, -1e17, 12345.678];
        for (const v of xs) {
            const p = tilePhase(v);
            expect([v, p >= 0, p < TILE]).toEqual([v, true, true]);
        }
    });
});

describe("DR-2 — a frame cell is always a legal digit", () => {
    test("an overflowing cell carries into the parent instead of being minted", () => {
        const lm = new LevelMap({ base: 1 / 16, enter: 256, exit: 1 / 32 }, 800, 600);
        lm.ensureSpine(0);
        const root = lm.spineAt(0);
        // 2059 is what the reported session actually produced
        const kid = lm.cellChild(root, 1198, 2059);
        expect(kid).toBeTruthy();
        expect([inDigit(kid.cell.i), inDigit(kid.cell.j)]).toEqual([true, true]);
        // and it is a real frame in the tree, reachable by its own id
        expect(lm.frame(kid.id)).toBe(kid);
    });

    test("the carried cell is the SAME place, not merely a legal one", () => {
        const lm = new LevelMap({ base: 1 / 16, enter: 256, exit: 1 / 32 }, 800, 600);
        lm.ensureSpine(0);
        const root = lm.spineAt(0);
        // one step past the top of the range must equal one step from the bottom
        // of the neighbouring parent — the two describe one location.
        const over = lm.cellChild(root, 0, HALF_R);
        const viaNeighbour = lm.cellChild(lm.neighbour(root, 0, 1).id, 0, -HALF_R);
        expect(over.id).toBe(viaNeighbour.id);
    });

    test("every frame in a deep session is addressable", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40);
        // descend off-centre, which is what put the view centre outside the
        // parent square in the reported session
        for (let d = 0; d < 8; d++) descend(E, 1, 690, 120);
        const bad = [];
        for (const f of E.lm.frames.values()) {
            if (!inDigit(f.cell.i) || !inDigit(f.cell.j)) bad.push([f.id, f.cell.i, f.cell.j]);
        }
        expect(bad).toEqual([]);
    });
});

describe("DR-3 — a deep off-centre session still round-trips", () => {
    test("draw, descend off-centre, save, load", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
        for (let d = 0; d < 8; d++) {
            descend(E, 1, 700, 110);
            drawStroke(E, [[380, 290], [420, 310]], 12, "#cc3311");
        }
        const doc = E.serializeDrawing();
        for (const f of doc.crossings.frames || []) {
            expect([f.id, inDigit(f.i), inDigit(f.j)]).toEqual([f.id, true, true]);
        }
        for (const k of Object.keys(doc.natives)) {
            for (const o of doc.natives[k]) {
                if (!o.tile) continue;
                expect([o.id, o.tile[0] >= 0 && o.tile[0] < W, o.tile[1] >= 0 && o.tile[1] < W])
                    .toEqual([o.id, true, true]);
            }
        }
        const F = mkEngine();
        expect(F.loadDrawing(doc)).toBe(true);
    });
});
