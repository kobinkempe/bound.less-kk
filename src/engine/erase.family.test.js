/**
 * OPEN-FLAGS F190: is a family still one object? The engine reads each neighbour's outline by piece, near the kid's
 * window, and keeps a pair's answer while its two members are unchanged. Here its parts are held to the whole-ring
 * originals, and its answers to the whole-outline rule (`__oracles__/familyComponents.js`) through erases, moves,
 * undo and redo. Every other suite makes the same comparison on each check it triggers (`__testkit__/harness.js`).
 */
import { flattenShape, outlineIndex, outlineEdges, clipShapeToRect } from "./geometry/arcShape";
import { Loop } from "./geometry/loop";
import { cos, sin } from "./geometry/detMath";
import { innerRuns, axisRuns, runsAbut, axisAbut, contactArcs, outlineContact, outlineRuns, outlineDoor } from "./geometry/connect";
import { contactArcsRef, axisAbutRef, familyComponentsRef } from "./__oracles__/familyComponents";
import { useEngines, mkEngine, drawStroke, erase, drag, descend, camShot, camRestore, familyCheck } from "./__testkit__/harness";

useEngines();

/** A small seeded generator (mulberry32). */
function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const arcPt = (C, r, th) => [C[0] + r * cos(th), C[1] + r * sin(th)];
/** A circle as `n` arcs from random split angles: every axis extreme is inside some piece. */
function circle(C, r, n, rnd, ccw = true) {
    const cuts = [];
    for (let i = 0; i < n; i++) cuts.push(rnd() * 2 * Math.PI);
    cuts.sort((a, b) => a - b);
    const loop = [];
    for (let i = 0; i < n; i++) {
        const a0 = cuts[i], a1 = i + 1 < n ? cuts[i + 1] : cuts[0] + 2 * Math.PI;
        loop.push({ line: false, C, r, a0, sweep: a1 - a0, A: arcPt(C, r, a0), B: arcPt(C, r, i + 1 < n ? a1 : cuts[0]) });
    }
    if (!ccw) return loop.reverse().map((p) => ({ line: false, C, r, a0: p.a0 + p.sweep, sweep: -p.sweep, A: p.B, B: p.A }));
    return loop;
}
/** A rectangle with rounded corners: lines on axis lines, quarter arcs between. */
function roundRect(x0, y0, x1, y1, r) {
    const q = (cx, cy, a0) => ({ line: false, C: [cx, cy], r, a0, sweep: Math.PI / 2, A: arcPt([cx, cy], r, a0), B: arcPt([cx, cy], r, a0 + Math.PI / 2) });
    const c = [q(x1 - r, y1 - r, 0), q(x0 + r, y1 - r, Math.PI / 2), q(x0 + r, y0 + r, Math.PI), q(x1 - r, y0 + r, 1.5 * Math.PI)];
    const loop = [];
    for (let i = 0; i < 4; i++) { loop.push(c[i]); loop.push({ line: true, A: c[i].B, B: c[(i + 1) % 4].A }); }
    return loop;
}
const edgesOfRings = (rings) => { const out = []; for (const ring of rings) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; out.push([a[0], a[1], b[0], b[1]]); } return out; };
const edgesOfIndex = (ix, tol, out = null, inn = null) => { const e = []; outlineEdges(ix, tol, out, inn, (ax, ay, bx, by) => e.push([ax, ay, bx, by])); return e; };

/** Shapes of every kind the reading has to get right, as plain piece arrays and as packed Loops. */
function shapes(rnd) {
    const out = [];
    for (let k = 0; k < 6; k++) {
        const C = [(rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000], r = 0.01 * Math.pow(10, rnd() * 5);
        out.push([circle(C, r, 1 + Math.floor(rnd() * 7), rnd, rnd() < 0.5)]);
    }
    out.push([roundRect(-300, -200, 500, 400, 37.5), circle([100, 100], 60, 3, rnd, false)]);
    out.push([roundRect(10.25, 10.5, 90.75, 70.125, 0.004)]);
    // Two pieces only, and an open chain: `flattenShape` drops one and closes the other.
    out.push([[{ line: true, A: [0, 0], B: [5, 0] }, { line: true, A: [5, 0], B: [0, 0] }], circle([40, 40], 12, 2, rnd)]);
    out.push([[{ line: true, A: [0, 0], B: [50, 0] }, { line: true, A: [50, 0], B: [50, 30] }, { line: true, A: [50, 30], B: [0.5, 30] }]]);
    // The same shapes cut to a window, which is what a re-homed piece is.
    const win = { left: -120, top: -80, right: 260, bottom: 190 };
    out.push(clipShapeToRect([roundRect(-300, -200, 500, 400, 37.5)], win).loops);
    out.push(clipShapeToRect([circle([240, 180], 95, 5, rnd)], win).loops);
    const packed = out.map((loops) => loops.map((l) => Loop.from(Array.isArray(l) ? l : l.toPieces())));
    return out.concat(packed);
}

describe("the outline read by piece is flattenShape's outline", () => {
    test("every edge, in order, at any tolerance", () => {
        const rnd = rng(11);
        for (const loops of shapes(rnd)) {
            const ix = outlineIndex(loops);
            for (const tol of [5, 0.5, 0.02, 0.002, 1e-5]) expect(edgesOfIndex(ix, tol)).toEqual(edgesOfRings(flattenShape(loops, tol)));
        }
    });
    test("a window reads no fewer edges near it than the whole outline has there", () => {
        const rnd = rng(12);
        for (const loops of shapes(rnd)) {
            const ix = outlineIndex(loops), tol = 0.01;
            for (let k = 0; k < 20; k++) {
                const x = (rnd() - 0.5) * 900, y = (rnd() - 0.5) * 900, w = rnd() * 300, h = rnd() * 300, box = [x, y, x + w, y + h];
                const got = new Set(edgesOfIndex(ix, tol, box).map(String));
                for (const e of edgesOfRings(flattenShape(loops, tol))) {
                    const inside = (px, py) => px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3];
                    if (inside(e[0], e[1]) || inside(e[2], e[3])) expect(got.has(String(e))).toBe(true);
                }
            }
        }
    });
});

describe("contact, inner runs and abutting runs from the pieces near a window", () => {
    const rects = (rnd, loops) => {
        const out = [{ x0: -120, y0: -80, x1: 260, y1: 190 }, { x0: -300, y0: -200, x1: 500, y1: 400 }, { x0: 10.25, y0: 10.5, x1: 90.75, y1: 70.125 }];
        for (let k = 0; k < 12; k++) { const x = (rnd() - 0.5) * 800, y = (rnd() - 0.5) * 800; out.push({ x0: x, y0: y, x1: x + 1 + rnd() * 400, y1: y + 1 + rnd() * 400 }); }
        // Windows with a side through one of the shape's own vertices.
        for (const ring of flattenShape(loops, 0.01).slice(0, 2)) { const p = ring[Math.floor(rnd() * ring.length)]; out.push({ x0: p[0], y0: p[1] - 40, x1: p[0] + 70, y1: p[1] + 25 }); }
        return out;
    };
    test("outlineContact is contactArcs of the whole rings, shifted or not", () => {
        const rnd = rng(21);
        for (const loops of shapes(rnd)) {
            const ix = outlineIndex(loops);
            for (const R of rects(rnd, loops)) for (const [ftol, tol] of [[0.002, 0.002], [0.0031, 0.0031], [0.05, 0.002]]) {
                for (const d of [[0, 0], [131072, 0], [-131072, 131072]]) {
                    const rings = flattenShape(loops, ftol).map((ring) => ring.map((p) => [p[0] + d[0], p[1] + d[1]]));
                    const Rd = { x0: R.x0 + d[0], y0: R.y0 + d[1], x1: R.x1 + d[0], y1: R.y1 + d[1] };
                    expect(outlineContact(ix, Rd, ftol, tol, d[0], d[1])).toEqual(contactArcsRef(rings, Rd, tol));
                    expect(contactArcs(rings, Rd, tol)).toEqual(contactArcsRef(rings, Rd, tol));
                }
            }
        }
    });
    test("outlineDoor is contactArcs, innerRuns and axisRuns of the whole rings", () => {
        const rnd = rng(22);
        for (const loops of shapes(rnd)) {
            const ix = outlineIndex(loops);
            for (const R of rects(rnd, loops)) for (const tol of [0.002, 0.0037, 0.3]) {
                const rings = flattenShape(loops, tol), door = outlineDoor(ix, R, tol);
                expect(door.arcs).toEqual(contactArcsRef(rings, R, tol));
                expect(door.inner).toEqual(innerRuns(rings, R, tol));
                expect(door.runs).toEqual(axisRuns(rings, tol));
            }
        }
    });
    test("runs near a box abut what the whole outline abuts", () => {
        const rnd = rng(23);
        let yes = 0, no = 0;
        for (const loops of shapes(rnd)) {
            const ix = outlineIndex(loops), ftol = 0.002, rings = flattenShape(loops, ftol);
            const own = axisRuns(rings, ftol), probes = [];
            // Stretches of the shape's own axis-parallel edges, nudged within and past the tolerance; and stray ones.
            for (let ax = 0; ax < 2; ax++) for (const [c, lo, hi] of own[ax].slice(0, 30)) {
                const off = (rnd() - 0.5) * 0.008, a = lo + (hi - lo) * rnd() * 0.5, b = hi - (hi - lo) * rnd() * 0.4;
                probes.push(ax === 0 ? [[c + off, a], [c + off, b]] : [[a, c + off], [b, c + off]]);
            }
            for (let k = 0; k < 10; k++) { const x = (rnd() - 0.5) * 600, y = (rnd() - 0.5) * 600; probes.push([[x, y], [x, y + rnd() * 80]]); }
            for (const run of probes) for (const t of [0.002, 1e-6]) {
                const box = [Math.min(run[0][0], run[1][0]), Math.min(run[0][1], run[1][1]), Math.max(run[0][0], run[1][0]), Math.max(run[0][1], run[1][1])];
                const want = axisAbutRef([run], rings, t);
                expect(runsAbut(axisRuns([run], t), outlineRuns(ix, ftol, t, box), t)).toBe(want);
                expect(axisAbut([run], rings, t)).toBe(want);
                if (want) yes++; else no++;
            }
        }
        expect(yes).toBeGreaterThan(20);
        expect(no).toBeGreaterThan(20);
    });
});

describe("the engine's answers are the whole-outline rule's", () => {
    const BLUE = "#1133cc";
    const sig = (c) => JSON.stringify([c.members.map((m) => m.level + "#" + m.obj.id), c.classes, c.unresolved]);
    /** Every family of two or more, checked with what the engine has kept and again with nothing kept. */
    function agree(E) {
        const n = new Map();
        for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (!o.erase) n.set(E.doc.editKey(o), (n.get(E.doc.editKey(o)) || 0) + 1);
        let fams = 0;
        for (const [key, count] of n) {
            if (count < 2) continue;
            fams++;
            const rule = sig(familyComponentsRef(E, key));
            expect(sig(E._familyComponents(key))).toBe(rule);
            E._doors = null;
            expect(sig(E._familyComponents(key))).toBe(rule);
        }
        return fams;
    }
    test("carving a fat stroke one and two levels down, moving it, undoing", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        drawStroke(E, [[100, 340], [700, 420]], 60, BLUE);
        const home = camShot(E);
        const rnd = rng(31);
        let fams = 0;
        for (const depth of [1, 2]) {
            camRestore(E, home);
            descend(E, depth, 380 + depth * 20, 310);
            for (let k = 0; k < 6; k++) {
                const x = 100 + rnd() * 600, y = 100 + rnd() * 400;
                erase(E, [[x, y], [x + (rnd() - 0.5) * 500, y + (rnd() - 0.5) * 400], [x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 300]], 6 + rnd() * 30);
                fams += agree(E);
            }
        }
        camRestore(E, home);
        drag(E, [150, 300], [210, 260]);
        E.deselect();
        fams += agree(E);
        descend(E, 1, 460, 270);
        erase(E, [[50, 50], [750, 550]], 12);
        fams += agree(E);
        for (let k = 0; k < 4; k++) { E.undo(); fams += agree(E); }
        for (let k = 0; k < 3; k++) { E.redo(); fams += agree(E); }
        expect(fams).toBeGreaterThan(10);
        expect(familyCheck.calls).toBeGreaterThan(10);
    });
    test("an erase across the whole stroke at the top, then carving each half", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, 1, 300, 300);
        erase(E, [[200, 100], [400, 500]], 20);
        erase(E, [[500, 150], [300, 450]], 10);
        agree(E);
        camRestore(E, home);
        erase(E, [[400, 200], [400, 400]], 16);     // severs the stroke
        agree(E);
        descend(E, 1, 300, 300);
        erase(E, [[100, 300], [700, 320]], 8);
        expect(agree(E)).toBeGreaterThan(0);
    });
});
