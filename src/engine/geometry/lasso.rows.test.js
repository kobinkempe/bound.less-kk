/**
 * The lasso's inside test reads only the grid row a point is in (REVIEWER-5, 2026-09-24): with the
 * loop no longer decimated, a plain even-odd walk of every point cost 3–4× on a slow 1,600-point loop.
 * It must answer exactly as `pointInPolygon` does, on and next to vertices too.
 */
import { loopTester, pointInPolygon } from "./lasso";

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test("LR-1 the row test equals pointInPolygon over random loops, vertices included", () => {
    let n = 0;
    for (let L = 0; L < 120; L++) {
        const m = 3 + Math.floor(rnd() * 900), whole = L % 7 === 0;
        const poly = [];
        for (let k = 0; k < m; k++) {
            const a = (2 * Math.PI * k) / m, r = 100 + 60 * rnd();
            const p = [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
            poly.push(whole ? [Math.round(p[0]), Math.round(p[1])] : p);
        }
        const t = loopTester(poly);
        for (let q = 0; q < 200; q++) {
            let p;
            if (q % 5 === 0) { const v = poly[Math.floor(rnd() * m)]; p = [v[0] + (q % 10 === 0 ? 0 : 1e-9), v[1]]; }
            else p = [120 + 360 * rnd(), 120 + 360 * rnd()];
            expect(t.inside(p)).toBe(pointInPolygon(poly, p));
            n++;
        }
    }
    expect(n).toBe(24000);
});
