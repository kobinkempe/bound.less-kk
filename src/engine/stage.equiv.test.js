/**
 * PLAN §3 row 2: the scene's items equal `listFor`'s sorted output (A2-scene.md §2.14), after every
 * operation of a seeded fuzz — strokes, erases baked whole and in slices, taps and drags, lassos,
 * subtree drags, deletes, undo and redo in runs, crossings, pans, reloads through kobin-1 and the op
 * log, frame GC — and PLAN §3's "no read changes the document" over the same states. The long run
 * is `stage.equiv.probe.js`.
 */
import { useEngines } from "./__testkit__/harness";
import { runStageFuzz, compareStage, pureReads } from "./__testkit__/stageFuzz";

useEngines();

const SEEDS = [1, 2, 3, 4, 5];
const STEPS = 40;

describe("the Stage's table equals listFor's (PLAN §3 row 2)", () => {
    for (const seed of SEEDS) {
        test("seed " + seed + ", " + STEPS + " steps", () => {
            const fails = [];
            const others = {};
            runStageFuzz(seed, STEPS, (E, step, op, rnd) => {
                if (fails.length) return;
                const c = compareStage(E);
                if (c.diff) { fails.push("step " + step + " (" + op + "): " + c.diff); return; }
                const p = pureReads(E, rnd, others);
                if (p) fails.push("step " + step + " (" + op + "): " + p + " changed the document");
            });
            expect(fails).toEqual([]);
        });
    }
});
