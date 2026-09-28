/**
 * stage.fresh.probe.js — PLAN §3 row 1's Stage half, the long run: 200 seeds × 400 steps of
 * `stage.fresh.test.js`'s fuzz, with what it counted. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/stage.fresh.probe.js"
 */
import { runFresh } from "./__testkit__/stageFresh";

jest.setTimeout(30 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("freshness by G: 200 seeds × 400 steps", () => {
    const fails = [], tot = {};
    for (let seed = 1; seed <= 200; seed++) {
        const c = runFresh(seed, 400, (m) => { if (fails.length < 10) fails.push("seed " + seed + ": " + m); });
        for (const k of Object.keys(c)) tot[k] = (tot[k] || 0) + c[k];
    }
    log("stage.fresh.probe: " + JSON.stringify({ fails: fails.length, ...tot }));
    expect(fails).toEqual([]);
});
