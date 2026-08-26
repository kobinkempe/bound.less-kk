/**
 * FL — a frame that loses its last native is FORGOTTEN.
 *
 * Reported 2026-08-20. Zooming got slower and slower over a session: renders
 * went 18 ms → 33 → 64 → 208 across four reports while the drawing barely grew,
 * 276 objects to 391. What grew was the number of FRAME BUCKETS in the document:
 * 2, then 2,407, then 2,987, then 4,369 — of which 4,343 held nothing at all.
 *
 * They cost on every render because `levels()` is walked per tile bake
 * (`TileStore._minContentDepth`) and scanned per lookup. Measured on the
 * reported snapshot: dropping the empty ones, changing nothing else, took a warm
 * render from 195 ms to 23 ms.
 *
 * Two things strand them, and both are ordinary use:
 *   - a drag RE-HOMES on every pointer event, and each destination allocates a
 *     bucket the object then leaves behind;
 *   - an erase CEDES down a chain, allocating one per link, and re-ceding or
 *     undoing empties them again.
 */
import { useEngines, mkEngine, drawStroke, descend, erase } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const buckets = (E) => E.doc.levels().length;
const emptyBuckets = (E) => E.doc.levels().filter((k) => !E.doc.at(k).length).length;

describe("FL-1 — no frame keeps a bucket it has no ink in", () => {
    test("re-homing does not strand the frame it left", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[300, 300], [500, 300]], 20);
        const start = buckets(E);
        const home = E.doc.getById(o.id).level;
        // Walk it through a row of cells and back, the way a drag does.
        const seen = [];
        for (let i = 1; i <= 6; i++) {
            const to = E.lm.neighbour(home, i, 0);
            expect(to).toBeTruthy();
            seen.push(to.id);
            E.doc.rehomeById(o.id, to.id);
            expect(emptyBuckets(E)).toBe(0);
        }
        E.doc.rehomeById(o.id, home);
        expect(emptyBuckets(E)).toBe(0);
        expect(buckets(E)).toBe(start);
    });

    test("a deep erase leaves no empty bucket behind, and undo puts them back", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        descend(E, 4, 400, 300);
        erase(E, [[400, 280], [400, 320]], 20);
        expect(emptyBuckets(E)).toBe(0);
        const after = buckets(E);
        expect(after).toBeGreaterThan(1);          // it really did cede a chain
        E.undo();
        expect(emptyBuckets(E)).toBe(0);
        E.redo();
        expect(emptyBuckets(E)).toBe(0);
        expect(buckets(E)).toBe(after);
    });

    test("a drag at depth does not leak a bucket per pointer event", () => {
        // The reported shape of it: 40 events x several members, every session.
        const E = mkEngine();
        const ids = [];
        for (let d = 0; d <= 4; d++) {
            if (d) descend(E, d, 400, 300);
            ids.push(drawStroke(E, [[360, 290], [400, 300], [440, 310]], 12).id);
        }
        let g = 0;
        while (E.activeLevel > 0 && g++ < 600) E.zoomAt(400, 300, 1000);
        const before = buckets(E);
        E._setSelection(ids);
        E.setTool("select");
        E.pointerDown(400, 300);
        for (let i = 1; i <= 40; i++) E.pointerMove(400 + i * 3, 300 + i * 2);
        E.pointerUp();
        expect(emptyBuckets(E)).toBe(0);
        // A move may legitimately add frames — what it must not do is add one
        // per EVENT. Forty events, and the ceiling is the members themselves.
        expect(buckets(E) - before).toBeLessThanOrEqual(ids.length);
    });

    test("a saved drawing carries no empty frames either", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        descend(E, 3, 400, 300);
        erase(E, [[400, 280], [400, 320]], 20);
        const snap = E.snapshot();
        const keys = Object.keys(snap.natives);
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) expect([k, snap.natives[k].length > 0]).toEqual([k, true]);
    });
});

describe("FL-2 — a drawing that already carries the leak is repaired on load", () => {
    test("empty frames in a saved file are dropped at the door", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40);
        const snap = E.snapshot();
        // A file written by a build that stranded them.
        for (let i = 0; i < 500; i++) snap.natives[`0/${i},7`] = [];
        const F = mkEngine();
        expect(F.loadSnapshot(snap)).toBe(true);
        expect(F.doc.levels().filter((k) => !F.doc.at(k).length)).toEqual([]);
        expect(F.doc.levels().length).toBe(1);
    });
});
