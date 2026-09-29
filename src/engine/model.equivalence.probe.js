/**
 * model.equivalence.probe.js — PLAN §3 row 9, A1 §5 check 1: the composed model (A1 C1) against the
 * frozen settling model (`__oracles__/model-v1`), over seeded random operation sequences (draw, erase at
 * depth, per-object and subtree drags, lassos, delete, undo, redo, zoom and pan, both reloads, frame GC).
 * After every operation the pictures of the camera's frame, its parent, a ring neighbour and a child are
 * compared native for native over the whole square, frames and homes matched by place
 * (`modelFuzz.comparePictures`): bit for bit for a native homed at the same place in both; through its
 * picture for one the oracle carried — to the bit at and below its home, one ulp above it; above a home,
 * the oracle's picture inside the live one and the rest accounted for by the composition's window. Seeds
 * 1–200 × 40 (R-MODEL-C1): 55,896 items, 36 edge-only, 46 divergences after a home moved, 499 oracle
 * memo re-reads. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/model.equivalence.probe.js"
 * MODEL_SEEDS (default 20, then the pinned seeds) and MODEL_STEPS (default 40) set the size.
 */
import { runPairFuzz, framesToCompare, comparePictures } from "./__testkit__/modelFuzz";

jest.setTimeout(60 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEEDS = Number(process.env.MODEL_SEEDS || 20), STEPS = Number(process.env.MODEL_STEPS || 40);
const FIRST = Number(process.env.MODEL_FIRST || 1);
// Past the range, each reaching a rule: 22 a memo naming a frame GC forgot (red before `TileStore.forgetFrame`
// dropped it), 42 the oracle's own, 50 and 145 one frame id at two places, 81 divergences after a home moved.
const PINNED = process.env.MODEL_SEEDS ? [] : [22, 42, 50, 81, 145];

test(`the composed model draws what the settling model drew: ${SEEDS + PINNED.length} seeds × ${STEPS} steps`, () => {
    const st = { items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0 };
    const fails = [], opCount = {}, cov = { checks: 0, frames: 0 };
    const seeds = [...Array(SEEDS).keys()].map((k) => FIRST + k).concat(PINNED);
    for (const seed of seeds) {
        st.tainted = new Map();                                  // native ids start again with each seed
        runPairFuzz(seed, STEPS, (O, N, step, op) => {
            opCount[op] = (opCount[op] || 0) + 1;
            cov.checks++;
            for (const V of framesToCompare(O, N)) {
                cov.frames++;
                const d = comparePictures(O, N, V, st);
                if (d) { fails.push("seed " + seed + " step " + step + " (" + op + "): " + d); return false; }
            }
            return true;
        });
    }
    delete st.tainted;
    log("MODEL-EQUIV " + JSON.stringify({ seeds: [FIRST, FIRST + SEEDS - 1], pinned: PINNED, steps: STEPS, ...cov, ...st, ops: opCount }));
    expect(fails).toEqual([]);
});
