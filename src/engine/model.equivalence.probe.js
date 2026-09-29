/**
 * model.equivalence.probe.js — PLAN §3 row 9, A1 §5 check 1: the composed model (A1 C1) against the
 * frozen settling model (`__oracles__/model-v1`), over seeded random operation sequences (draw, erase at
 * depth, per-object and subtree drags, lassos, delete, undo, redo, zoom and pan, both reloads, frame GC).
 * After every operation the pictures of the camera's frame, its parent, a ring neighbour and a child are
 * compared native for native (`modelFuzz.comparePictures`): bit for bit for a native homed in the same
 * frame in both; through its picture for one the oracle carried — to the bit at and below its home, one
 * ulp above it. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/model.equivalence.probe.js"
 * MODEL_SEEDS (default 20) and MODEL_STEPS (default 40) set the size.
 */
import { runPairFuzz, framesToCompare, comparePictures } from "./__testkit__/modelFuzz";

jest.setTimeout(60 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEEDS = Number(process.env.MODEL_SEEDS || 20), STEPS = Number(process.env.MODEL_STEPS || 40);
const FIRST = Number(process.env.MODEL_FIRST || 1);

test(`the composed model draws what the settling model drew: ${SEEDS} seeds × ${STEPS} steps`, () => {
    const st = { items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0 };
    const fails = [], opCount = {};
    let checks = 0, frames = 0;
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
        runPairFuzz(seed, STEPS, (O, N, step, op) => {
            opCount[op] = (opCount[op] || 0) + 1;
            checks++;
            for (const V of framesToCompare(O, N)) {
                frames++;
                const d = comparePictures(O, N, V, st);
                if (d) { fails.push("seed " + seed + " step " + step + " (" + op + "): " + d); return false; }
            }
            return true;
        });
    }
    log("MODEL-EQUIV " + JSON.stringify({ seeds: [FIRST, FIRST + SEEDS - 1], steps: STEPS, checks, frames, ...st, ops: opCount }));
    expect(fails).toEqual([]);
});
