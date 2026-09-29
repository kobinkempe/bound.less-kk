/**
 * F130: the crossing sort past 32 crossings is a merge sort, as stable as the insertion sort it
 * replaces there, so every plate is the same to the byte; a wide pen's band (hundreds of crossings a
 * sub-scanline) made the insertion sort 4–16 s a plate.
 */
import { sortCrossingsForTest, sortStats } from "./rasterCore";

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const reference = (pairs) => {
    const a = [];
    for (let i = 0; i < pairs.length; i += 2) a.push([pairs[i], pairs[i + 1], i]);
    a.sort((p, q) => (p[0] - q[0]) || (p[2] - q[2]));   // stable by x
    return a.flatMap((p) => [p[0], p[1]]);
};

test("RS-1 the shipped sort equals a stable sort, at 5 to 3,000 crossings, ties included", () => {
    const m0 = sortStats.mergeSorts;
    for (const n of [5, 31, 33, 64, 600, 1132, 3000]) {
        for (let r = 0; r < 4; r++) {
            const pairs = [];
            for (let k = 0; k < n; k++) pairs.push(r % 2 ? Math.floor(rnd() * 40) : rnd() * 1000, rnd() < 0.5 ? 1 : -1);
            expect(sortCrossingsForTest(pairs)).toEqual(reference(pairs));
        }
    }
    expect(sortStats.mergeSorts).toBeGreaterThan(m0);
});

test("RS-2 a descending run of 1,200 crossings (the band's worst case) takes the merge sort, not the quadratic one", () => {
    const pairs = [];
    for (let k = 1200; k > 0; k--) pairs.push(k * 0.5, 1);
    const m0 = sortStats.mergeSorts;
    const out = sortCrossingsForTest(pairs);
    expect(sortStats.mergeSorts).toBe(m0 + 1);              // red before: 719,400 insertion moves (F130: 4–16 s a plate)
    for (let i = 2; i < out.length; i += 2) expect(out[i]).toBeGreaterThanOrEqual(out[i - 2]);
});

// F130's other half: the estimate prices a band by its pen's width too. A 337 px scribble priced by length
// alone (5,520 chords) was rastered 20 s on the main thread; the rest render's inline test reads these chords.
test("RS-3 a 337 px pen's scribble is priced past the inline rest render's budget, ten times a thin pen's on the same path", () => {
    const { visibleChords } = require("./rasterPack");
    const { EST_DEFAULTS } = require("./PicturePyramid");
    const cfg = { enter: 256, base: 1 / 16, exit: 1 / 32, arcTolerancePx: 0.25, cullPx: 0.3, fadeLoPx: 0.15, scale: 1000 };
    const pts = [];
    for (let k = 0; k < 69; k++) pts.push([(k % 2 ? 1 : -1) * 0.17, k * 0.02]);   // ~24 units: 4,600 px at Z 192, as stroke 14
    const mk = (lw) => ({ type: "stroke", origin: "native", id: lw * 1000 + 1, pts, lwFrame: lw, color: "#000", opacity: 0.1 });
    const win = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 }, Z = 192;
    const wide = visibleChords([mk(1.7578)], win, Z, cfg, 1e9), thin = visibleChords([mk(0.05)], win, Z, cfg, 1e9);
    expect(wide * EST_DEFAULTS.restEdgeUs / 1000).toBeGreaterThan(EST_DEFAULTS.restInlineMs);
    expect(wide / thin).toBeGreaterThan(10);                                                          // red before: 1
});
