/**
 * F23 item 1 — the Y-stroke cut by a ring eraser, which the flag calls
 * "the first thing to pick up" and which is still recorded as OPEN.
 *
 * Its description is word for word the signature F34 turned out to have:
 *
 *   > the boolean reports 17 crossings between two closed shapes, where a
 *   > transversal count must be even, and two unbalanced vertices. Neither the
 *   > welding radius (tried at 0.1x, 10x and 0.01x) nor the crossing-parameter
 *   > slack changes it, so it is a classification or pairing defect, not a
 *   > tolerance.
 *
 * F34's cause was none of those things — it was `circleCircle` losing
 * intersections to cancellation. So the question this answers is whether F23-1
 * was the same defect at ordinary scale, or a genuinely separate one.
 *
 * The dust cull (`dropDust`, F23 item 2) hides the CONSEQUENCE of this — the
 * wafers it leaves become specks and are dropped — so object counts cannot tell
 * you whether it is fixed. The boolean's own stats can.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const PEN = 39;

/** Three strokes meeting at a point — a three-way junction. */
function yStroke(E) {
    drawStroke(E, [[200, 180], [400, 400]], PEN, "#1133cc");
    drawStroke(E, [[600, 180], [400, 400]], PEN, "#1133cc");
    drawStroke(E, [[400, 400], [400, 720]], PEN, "#1133cc");
}

/** A ring: the pen driven round a circle, so its swept region has an island. */
function ringGesture(E, cx, cy, r, size) {
    E.setEraserSize(size);
    const pts = [];
    for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    eraseGesture(E, pts);
}

test("a ring eraser on a three-way junction", () => {
    const rows = [];
    for (const r of [40, 70, 110, 150]) {
        for (const size of [14, 26]) {
            const E = mkEngine();
            yStroke(E);
            ringGesture(E, 400, 400, r, size);   // centred ON the junction
            E.flushErases();
            rows.push({
                ringR: r, pen: size,
                seals: E._boolFailures || 0,
                open: E._lastBoolFailure ? E._lastBoolFailure.open : 0,
                dust: E._dustCulled || 0,
            });
        }
    }
    // eslint-disable-next-line no-console
    console.log("F23-1 Y-STROKE + RING\n" + rows.map((x) => JSON.stringify(x)).join("\n"));
    const bad = rows.filter((x) => x.seals > 0);
    // eslint-disable-next-line no-console
    console.log("  sealed in " + bad.length + " of " + rows.length
        + ";  total dust culled " + rows.reduce((n, x) => n + x.dust, 0));
    expect(rows.length).toBe(8);
});
