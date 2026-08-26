/**
 * How a resolved perimeter becomes tile geometry.
 *
 * Three properties, all of which the engine leans on and none of which is
 * visible in a picture until it is wrong:
 *
 *  LOCAL      the same shape in the same place relative to its tile must give
 *             the same geometry however far from the frame origin that tile
 *             sits. At depth the origin is astronomically far away, and a
 *             computation that is not local loses the shape's own detail to the
 *             distance it is being measured from.
 *
 *  SEAM       two tiles clipping one shape must flatten the shared arcs to the
 *             SAME vertices, or their pieces disagree along the boundary between
 *             them and antialiasing leaves a hairline down every tile edge.
 *
 *  SOLID      a tile no piece of the perimeter reaches is either wholly inside
 *             the ink or wholly outside it, and must be answered as a covering
 *             quad rather than by clipping. That is what bounds the magnify
 *             chain: geometry can never outgrow a tile.
 */
import { shapeRingsInRect, shapeTol } from "./derive";
import { bakeArcPerimeter } from "./arcPerimeter";
import { transformLoops, loopsBBox } from "./arcShape";

const CFG = { base: 0.1, enter: 300, exit: 0.05, arcTolerancePx: 0.25 };
const TOL = shapeTol(CFG);

const strokePts = (ox = 0, oy = 0) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push([ox + 100 + t * 400, oy + 300 + 90 * Math.sin(t * 4)]);
    }
    return pts;
};
const shape = (ox = 0, oy = 0) => bakeArcPerimeter(strokePts(ox, oy), 60, { tol: 0.125 }).loops;

describe("AT-1 — tile geometry is computed LOCAL to the tile", () => {
    test("a tile 1e9 units from the origin gives the same rings as one at it", () => {
        const near = shape();
        const rect = { left: 200, top: 240, right: 340, bottom: 380 };
        const a = shapeRingsInRect(near, rect, TOL);
        const D = 1e9;
        const far = transformLoops(near, 1, D, D);
        const b = shapeRingsInRect(far, { left: rect.left + D, top: rect.top + D,
            right: rect.right + D, bottom: rect.bottom + D }, TOL);
        expect(b.covered).toBe(a.covered);
        expect(b.rings.length).toBe(a.rings.length);
        let worst = 0;
        for (let i = 0; i < a.rings.length; i++) {
            expect(b.rings[i].length).toBe(a.rings[i].length);
            for (let k = 0; k < a.rings[i].length; k++) {
                worst = Math.max(worst,
                    Math.abs((b.rings[i][k][0] - D) - a.rings[i][k][0]),
                    Math.abs((b.rings[i][k][1] - D) - a.rings[i][k][1]));
            }
        }
        // One ulp at 1e9 is 2e-7; anything at that scale is the translation
        // itself, not the computation. A non-local computation would be out by
        // orders more, because the tile is 140 units across and the origin is
        // seven decimal orders away.
        expect(worst).toBeLessThan(1e-6);
    });
});

describe("AT-2 — neighbouring tiles agree along their shared edge", () => {
    test("the shared arcs flatten to the same vertices on both sides", () => {
        const s = shape();
        const X = 300;                       // the seam
        const left = shapeRingsInRect(s, { left: 160, top: 200, right: X, bottom: 420 }, TOL);
        const right = shapeRingsInRect(s, { left: X, top: 200, right: 440, bottom: 420 }, TOL);
        expect(left.rings.length).toBeGreaterThan(0);
        expect(right.rings.length).toBeGreaterThan(0);
        // Every vertex either side of the seam that is NOT on the seam itself
        // must appear in exactly one of the two, and every vertex the shape has
        // near the seam must appear in both if it is shared. The check that
        // catches a drifting flattening is simpler and stronger: gather the
        // vertices each side puts ON the seam line and require them to match.
        const onSeam = (r) => {
            const out = [];
            for (const ring of r.rings) for (const [x, y] of ring) if (Math.abs(x - X) < 1e-9) out.push(+y.toFixed(9));
            return [...new Set(out)].sort((a, b) => a - b);
        };
        const l = onSeam(left), rr = onSeam(right);
        expect(l.length).toBeGreaterThan(0);
        expect(rr).toEqual(l);
    });
    test("flattening depends on the piece and the tolerance ALONE", () => {
        // Two rects of different sizes and positions, over the same stretch of
        // the shape: the vertices in the overlap are identical, because nothing
        // about the tile enters the step count.
        const s = shape();
        const wide = shapeRingsInRect(s, { left: 100, top: 200, right: 520, bottom: 420 }, TOL);
        const narrow = shapeRingsInRect(s, { left: 240, top: 200, right: 380, bottom: 420 }, TOL);
        const inBox = (rings) => {
            const out = [];
            for (const ring of rings) for (const [x, y] of ring) {
                if (x > 250 && x < 370 && y > 210 && y < 410) out.push(`${x.toFixed(9)},${y.toFixed(9)}`);
            }
            return new Set(out);
        };
        const a = inBox(wide.rings), b = inBox(narrow.rings);
        expect(a.size).toBeGreaterThan(4);
        for (const v of a) expect(b.has(v)).toBe(true);
    });
});

describe("AT-3 — a tile the ink floods is a quad", () => {
    test("wholly inside gives a covering quad; wholly outside gives nothing", () => {
        const s = shape();
        const b = loopsBBox(s);
        // Deep inside the ink: a tile far smaller than the pen, ON THE
        // CENTRELINE — taken from the samples, not guessed, because the stroke
        // waves 90 units either side of y = 300 and a guess lands on paper.
        const c = strokePts()[10];
        const inside = shapeRingsInRect(s, { left: c[0] - 1, top: c[1] - 1, right: c[0] + 1, bottom: c[1] + 1 }, TOL);
        expect(inside.covered).toBe(true);
        expect(inside.rings).toHaveLength(1);
        expect(inside.rings[0]).toHaveLength(4);
        // Well outside it.
        const outside = shapeRingsInRect(s, { left: b.x1 + 500, top: b.y1 + 500,
            right: b.x1 + 600, bottom: b.y1 + 600 }, TOL);
        expect(outside.covered).toBe(false);
        expect(outside.rings).toHaveLength(0);
    });
    test("a magnified shape floods its tiles as quads, not as geometry", () => {
        // The property that bounds the magnify chain. Blown up x3000, one tile
        // of the child frame is a speck inside the ink, and answering it must
        // not cost anything proportional to the perimeter.
        const s = transformLoops(shape(), 3000, 0, 0);
        let quads = 0, cut = 0;
        // Tiles marching along the magnified centreline. The pen is 60 units
        // wide at its own level and 180,000 here, so a 400-unit tile is a speck
        // inside it wherever the centreline goes.
        for (let i = 0; i < 6; i++) {
            const c = strokePts()[8 + i * 3];
            const x = c[0] * 3000, y = c[1] * 3000;
            const r = shapeRingsInRect(s, { left: x - 200, top: y - 200, right: x + 200, bottom: y + 200 }, TOL);
            if (r.covered) quads++;
            else if (r.rings.length) cut++;
        }
        expect(quads).toBe(6);
        expect(cut).toBe(0);
    });
});
