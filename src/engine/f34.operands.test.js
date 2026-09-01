/**
 * F34 — the operands that used to shatter, kept as a regression.
 *
 * These are the exact two loop-sets the failing cede handed to `subtractShape`,
 * lifted out of a live run against Kobin's own drawing on 2026-08-26 and saved
 * to `.kobin-reports/f34-operands.json`:
 *
 *   subject  1 loop, 7 pieces, bbox exactly +/-65536 — one whole tile, its edges
 *            arcs of radius 6.20e9 and 6.49e10 (ink carried two frame levels
 *            down is nearly straight, so its radii are enormous)
 *   eraser   2 loops, 192 pieces, a 292-unit ring STRADDLING the ink's edge
 *
 * On that input the boolean reported `crossings=3` — impossible between closed
 * curves, which cross an even number of times — and then sealed 156 of 199
 * pieces into their own loops: 1.64e10 of fabricated area, ~95% of the tile.
 *
 * The cause was `circleCircle` in arcPerimeter.js computing `h² = r1² - a²` with
 * r1 = 6.5e10: one ulp of r1² is 9.4e5 while the h² wanted is at most r2² = 441.
 * Nothing about these operands changed to fix it; only that arithmetic did.
 */
import fs from "fs";
import path from "path";
import { loopsBBox, subtractShape } from "./geometry/arcShape";

const OPS = path.join(__dirname, "..", "..", ".kobin-reports", "f34-operands.json");

test("the captured operands subtract cleanly", () => {
    const cap = JSON.parse(fs.readFileSync(OPS, "utf8"));
    const bbA = loopsBBox(cap.local), bbB = loopsBBox(cap.clip);

    // The capture is the shape the flag describes, not some other case.
    expect(cap.local.length).toBe(1);
    expect(cap.local[0].length).toBe(7);
    expect(cap.clip.length).toBe(2);
    expect(cap.clip.reduce((n, l) => n + l.length, 0)).toBe(192);
    expect(Math.max(bbA.x1 - bbA.x0, bbA.y1 - bbA.y0)).toBeCloseTo(131072, 0);
    expect(Math.max(bbB.x1 - bbB.x0, bbB.y1 - bbB.y0)).toBeLessThan(400);
    // ...and it really does carry the runaway radii.
    const radii = cap.local[0].filter((p) => !p.line).map((p) => Math.abs(p.r));
    expect(Math.max(...radii)).toBeGreaterThan(1e10);

    const res = subtractShape(cap.local, cap.clip);
    const st = res.stats || {};
    // eslint-disable-next-line no-console
    console.log("F34 REGRESSION open=" + (st.openChains || 0) + " sealed=" + (st.sealed || 0)
        + " crossings=" + st.crossings + " loops=" + res.loops.length
        + "  (was open=156 sealed=156 crossings=3 loops=156)");

    // Crossings between closed curves come in pairs. That invariant is what the
    // whole flag turned on, so it is asserted directly.
    expect(st.crossings % 2).toBe(0);
    expect(st.openChains || 0).toBe(0);
    expect(st.sealed || 0).toBe(0);
    // A handful of loops, not one per piece.
    expect(res.loops.length).toBeLessThan(10);
});
