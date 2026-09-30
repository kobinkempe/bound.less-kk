/**
 * move.hold.probe.js — A1 C2, PLAN §1.4: a drag writes nothing until its drop, whatever happens during it. The model
 * equivalence fuzz's sequences (`modelFuzz.runPairFuzz`) with `heldDragOp` added: drags of taps, lassos, frames and
 * frames with ids, their moves interleaved with renders, hit tests, lasso finds, resizes and wheel zooms that can cross
 * a frame, each ended by the drop, a pinch, an undo, a redo, a deselect, a tool change or a delete. After every event
 * before the exit the live engine's document is byte-equal to the press and its held natives are drawn at the delta
 * (the op throws otherwise); after every operation the two engines' pictures are compared as the equivalence probe
 * compares them. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/move.hold.probe.js"
 * HOLD_SEEDS (default 20) and HOLD_STEPS (default 30) set the size.
 */
import { runPairFuzz, framesToCompare, comparePictures, heldDragOp } from "./__testkit__/modelFuzz";

jest.setTimeout(60 * 60 * 1000);
const SEEDS = Number(process.env.HOLD_SEEDS || 20), STEPS = Number(process.env.HOLD_STEPS || 30);

test(`a drag writes nothing until its drop, over interleaved events and every exit: ${SEEDS} seeds × ${STEPS} steps`, () => {
    const st = { items: 0 }, held = {}, fails = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
        st.tainted = new Map();
        try {
            runPairFuzz(seed, STEPS, (O, N, step, op) => {
                for (const V of framesToCompare(O, N)) {
                    const d = comparePictures(O, N, V, st);
                    if (d) { fails.push("seed " + seed + " step " + step + " (" + op + "): " + d + (op === "heldDrag" ? " " + JSON.stringify(held.last) : "")); return false; }
                }
                return true;
            }, { extra: (ctx) => [heldDragOp(ctx, held)] });
        } catch (e) { fails.push("seed " + seed + ": " + e.message); }
    }
    delete st.tainted;
    // eslint-disable-next-line no-console
    console.log("HELD-DRAG " + JSON.stringify({ seeds: SEEDS, steps: STEPS, ...held, items: st.items, normalised: st.normalised || 0 }));
    expect(fails).toEqual([]);
    expect(held.drags).toBeGreaterThan(SEEDS);
    if (SEEDS >= 20) expect(Object.keys(held.exits).sort()).toEqual(["delete", "deselect", "drop", "pinch", "pinchOld", "redo", "tool", "undo"]);
    expect(held.placeChecks).toBeGreaterThan(0);
});
