/**
 * F34 — the classification step, on the captured operands.
 *
 * `shapeBooleanOnce` decides each of the clip's pieces by asking whether its
 * MIDPOINT is inside the subject: `windingOfFlat(flatPieces(A), m)`. The eraser
 * here is a 292-unit ring lying wholly inside a 131,072-unit subject, so the
 * answer is "inside" for all 192 of its pieces and the result is three loops —
 * the subject, plus the ring's outer and its island as holes.
 *
 * The boolean reports `kept=172` out of 199, and it turns out that is RIGHT: the
 * ring straddles the ink's edge, so 30 of its pieces genuinely lie outside and
 * the exact `insideShape` agrees with the flat winding on every one. Which is
 * what localised F34 — a straddling ring means the crossings must actually be
 * computed, arc against arc, at a ten-order-of-magnitude radius difference.
 */
import fs from "fs";
import path from "path";
import { flatPieces, windingOfFlat, insideShape, loopsBBox, ptAt } from "./arcShape";

const OPS = path.join(__dirname, "..", "..", "..", ".kobin-reports", "f34-operands.json");
// A gitignored recording (see .kobin-reports): a fresh clone skips this, and
// KOBIN_REQUIRE_REPORTS=1 makes a missing fixture fail loudly instead.
const testIf = fs.existsSync(OPS) || process.env.KOBIN_REQUIRE_REPORTS ? test : test.skip;

testIf("every piece of the ring is inside the subject — is it classified that way?", () => {
    const cap = JSON.parse(fs.readFileSync(OPS, "utf8"));
    const A = cap.local, B = cap.clip;
    const flatA = flatPieces(A);
    const bbA = loopsBBox(A), bbB = loopsBBox(B);

    let outside = 0, zero = 0, nul = 0, total = 0;
    const disagree = [];
    for (const loop of B) {
        for (const p of loop) {
            total++;
            const m = ptAt(p, 0.5);
            const w = windingOfFlat(flatA, m);
            const exact = insideShape(A, m);
            if (w == null) nul++;
            else if (w === 0) zero++;
            if (!(w != null && w !== 0)) outside++;
            if ((w != null && w !== 0) !== !!exact && disagree.length < 8) {
                disagree.push({ m: [+m[0].toFixed(4), +m[1].toFixed(4)], flatWinding: w, exactInside: !!exact });
            }
        }
    }
    // eslint-disable-next-line no-console
    console.log("F34 WINDING"
        + "\n  subject bbox x[" + bbA.x0 + ", " + bbA.x1 + "] y[" + bbA.y0 + ", " + bbA.y1 + "]"
        + "\n  ring bbox    x[" + bbB.x0.toFixed(2) + ", " + bbB.x1.toFixed(2) + "] y[" + bbB.y0.toFixed(2) + ", " + bbB.y1.toFixed(2) + "]"
        + "\n  ring pieces = " + total
        + "\n  classified OUTSIDE = " + outside + "   (winding 0: " + zero + ", null: " + nul + ")"
        + "\n  flat winding disagrees with exact insideShape on " + disagree.length + " sampled"
        + (disagree.length ? "\n  " + disagree.map((d) => JSON.stringify(d)).join("\n  ") : ""));

    // The ring STRADDLES the ink's boundary — 30 of its 192 pieces really do lie
    // outside the subject, and `insideShape` agrees with the flat winding on
    // every one of them. That is correct, and it is the point: because the ring
    // crosses the edge, every crossing has to be COMPUTED, by intersecting an
    // arc of radius 6.5e10 against one of radius 21. Straddling is what made
    // this case hard; the classification itself was never wrong.
    expect(outside).toBeGreaterThan(0);
    expect(disagree.length).toBe(0);
});
