/**
 * stage.equiv.probe.js — PLAN §3 row 2's long run (A2-scene.md §2.14): 60 seeds × 80 steps of
 * `stage.equiv.test.js`'s fuzz, with what it covered. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/stage.equiv.probe.js"
 */
import { useEngines } from "./__testkit__/harness";
import { runStageFuzz, compareStage, pureReads } from "./__testkit__/stageFuzz";

useEngines();
jest.setTimeout(30 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("the Stage's table equals listFor's: 60 seeds × 80 steps", () => {
    const fails = [], others = {};
    const cov = { checks: 0, synced: 0, rerouted: 0, pending: 0, marks: 0, tiles: 0, maxItems: 0 };
    for (let seed = 1; seed <= 60; seed++) {
        let first = null;
        runStageFuzz(seed, 80, (E, step, op, rnd) => {
            if (first) return;
            cov.checks++;
            const c = compareStage(E);
            if (c.synced) cov.synced++;
            if (c.diff) { first = "seed " + seed + " step " + step + " (" + op + "): " + c.diff; return; }
            const items = E.stage.items();
            if (items.some((i) => i.grp != null)) cov.rerouted++;
            if (items.some((i) => i.pending)) cov.pending++;
            if (items.some((i) => i.erase)) cov.marks++;
            if (items.some((i) => i.key !== "own")) cov.tiles++;
            cov.maxItems = Math.max(cov.maxItems, items.length);
            const p = pureReads(E, rnd, others);
            if (p) first = "seed " + seed + " step " + step + " (" + op + "): " + p + " changed the document";
        });
        if (first) fails.push(first);
    }
    log("stage.equiv.probe: " + JSON.stringify({ fails: fails.length, ...cov, mutatingReads: others }));
    expect(fails).toEqual([]);
});
