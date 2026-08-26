/**
 * The mark-vs-hole harness (catalogue section F).
 *
 * An eraser gesture commits instantly as background-coloured ink; baking then
 * replaces that mark with a real hole. Any disagreement between the two reads to
 * the user as the erase MOVING after the fact — and it is invisible to every
 * structural test, because the mark and the hole are each individually
 * well-formed. So it has to be measured directly.
 *
 * Method: run the identical scenario twice, once without the erase and once
 * with, and compare the two rendered lists sample by sample. That sidesteps
 * every projection problem — no ground truth has to be reconstructed by hand
 * from a stroke magnified 3000^N, which is where a hand-rolled oracle goes
 * wrong (and it is how the reverted attempt's 25 px error hid: the comparison
 * was rebuilt from projected points instead of the geometry actually painted).
 *
 * Two numbers come back, both in SCREEN PIXELS, both measured as a distance
 * from the eraser mark's own boundary:
 *   overPx   ink removed that the mark never covered
 *   underPx  ink kept that the mark did cover
 *
 * The mark used to be reconstructed from the eraser's centerline and half its
 * linewidth. An eraser is a stroke like any other now, so it RESOLVES into its
 * own perimeter — and that perimeter is a better mark than the reconstruction
 * ever was: it is the exact boundary the boolean actually subtracted, not a
 * flattening of an approximation of it.
 */
import { inks, distToPolyline } from "./ink";
import { flattenCurve } from "../geometry/clipperOutline";
import { arcDist } from "../geometry/biarc";
import { insideShape, loopsBBox } from "../geometry/arcShape";

/** The eraser's painted band, in the frame it was drawn in. */
export function markOf(E, eraser) {
    if (eraser.type === "shape") {
        const b = loopsBBox(eraser.loops);
        return {
            loops: eraser.loops,
            // `r` is only used to size the sampling window and the reach.
            r: eraser.w > 0 ? eraser.w / 2 : Math.max(b.x1 - b.x0, b.y1 - b.y0) / 4,
            box: b,
        };
    }
    const pts = eraser.pts.length > 2
        ? flattenCurve(eraser.pts, (E.cfg.arcTolerancePx * 0.25) / E.cfg.enter)
        : eraser.pts.map((p) => [p[0], p[1]]);
    return { pts, r: eraser.lwFrame / 2 };
}

/** Signed distance to the mark's boundary: negative inside the band. */
export function markDist(mark, p) {
    if (!mark.loops) return distToPolyline(mark.pts, p) - mark.r;
    let d = Infinity;
    for (const loop of mark.loops) {
        for (const q of loop) { const t = arcDist(q, p); if (t < d) d = t; }
    }
    return insideShape(mark.loops, p) ? -d : d;
}

/** The rect the samples cover: the mark, grown by `reach`. */
function markBox(mark, reach) {
    if (mark.box) {
        return { x0: mark.box.x0 - reach, y0: mark.box.y0 - reach,
            x1: mark.box.x1 + reach, y1: mark.box.y1 + reach };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of mark.pts) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0: x0 - reach, y0: y0 - reach, x1: x1 + reach, y1: y1 + reach };
}

/**
 * Compare two rendered lists over a grid covering the mark.
 *
 * `before` / `after` are render lists in the SAME frame as the mark.
 * `inScale` converts frame units to screen px.
 * `slackPx` of tolerance around the boundary that we refuse to judge — the
 *   eraser's own edge is antialiased and a sample exactly on it is genuinely
 *   ambiguous.
 */
export function compareMark(before, after, mark, inScale, opts = {}) {
    const n = opts.n || 140;
    const box = markBox(mark, (opts.reach || 3) * mark.r);
    let overPx = 0, underPx = 0, inkBefore = 0, removed = 0;
    for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
            const p = [box.x0 + ((a + 0.5) / n) * (box.x1 - box.x0),
                box.y0 + ((b + 0.5) / n) * (box.y1 - box.y0)];
            const wasInk = inks(before, p);
            if (!wasInk) continue;              // only ink can be over- or under-erased
            inkBefore++;
            const isInk = inks(after, p);
            if (!isInk) removed++;
            const d = markDist(mark, p);        // < 0 inside the mark
            const px = Math.abs(d) * inScale;
            if (px <= (opts.slackPx || 0)) continue; // on the boundary: not judgeable
            if (!isInk && d > 0 && px > overPx) overPx = px;   // removed outside the mark
            if (isInk && d < 0 && px > underPx) underPx = px;  // kept inside the mark
        }
    }
    return { overPx, underPx, inkBefore, removed };
}
