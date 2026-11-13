// F182: an eraser across a frame edge at its own level is cut into the squares in their own coordinates. Two squares'
// kids must meet on their shared side bit for bit at that level and below, read through the frames whose centre line
// is that side (the far square's cell −2048 across it, then cell 0). Before the fix they stepped by 7e-12 units at
// the erase's level, 4096× more a level: 38–256 px three levels below (__review__/f182-seam.probe.js).
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";

useEngines();
const W = 131072;
const pcs = (l) => (l.toPieces ? l.toPieces() : l);
const nearest = (vs, v) => vs.reduce((b, c) => (b == null || Math.abs(c - v) < Math.abs(b - v) ? c : b), null);

/** A 60-px bar at level 0, erased at depth L through frame FL's points `pts`, at camera scale `scale`. */
function eraseIn(L, scale, size, pts) {
    const E = mkEngine(1369, 925);
    const o = drawStroke(E, [[200, 420], [1100, 420]], 60);
    let F = E.lm.frame("0");
    for (let d = 1; d <= L; d++) { const q = E.lm.mapPointF([520, 420], "0", F.id); F = E.lm.cellChild(F.id, Math.round(q[0] / 32), Math.round(q[1] / 32)); }
    const FL = F.id, c = E.lm.mapPointF([520, 420], "0", FL), at = pts(c);
    E.cam.set({ activeLevel: L, frame: FL, inScale: scale, inPanX: 684 - at[0][0] * scale, inPanY: 462 - at[0][1] * scale });
    E._render();
    const s = (p) => [p[0] * scale + E.cam.inPanX, p[1] * scale + E.cam.inPanY];
    E.setEraserSize(size); E.setTool("erasePartial");
    E.pointerDown(...s(at[0]));
    for (const p of at.slice(1)) E.pointerMove(...s(p));
    E.pointerUp(); E.flushBakes(); E.flushErases();
    return { E, key: E.doc.editKey(o), L, FL };
}
/** The steps between FL's kid and its neighbour's across FL's far side on `axis`, at each crossing, levels L..L+4. */
function seamSteps({ E, key, L, FL }, axis) {
    const FN = axis ? E.lm.neighbour(FL, 0, 1).id : E.lm.neighbour(FL, 1, 0).id;
    // Every kid in the square: a swipe past a corner cuts a triangle off it.
    const kids = (G) => {
        const out = [];
        for (const k of E.doc.levels()) for (const x of E.doc.at(k)) if (x.type === "shape" && E.doc.editKey(x) === key && E.lm.depthOf(k) === L && E.lm.sameCell(k, G)) out.push(x);
        return out;
    };
    const ka = kids(FL), kb = kids(FN);
    expect(ka.length && kb.length).toBeTruthy();
    const a = { id: new Set(ka.map((x) => x.id)), loops: ka.flatMap((x) => x.loops) }, b = { id: new Set(kb.map((x) => x.id)), loops: kb.flatMap((x) => x.loops) };
    const on = (pieces, h) => pieces.filter((q) => !(q.line && q.A[axis] === q.B[axis])).flatMap((q) => [q.A, q.B]).filter((v) => v[axis] === h).map((v) => v[1 - axis]);
    const out = [];
    for (const t0 of on(a.loops.flatMap(pcs), W / 2)) {
        if (Math.abs(t0) === W / 2) continue;   // the square's corners
        const steps = [Math.abs(t0 - nearest(on(b.loops.flatMap(pcs), -W / 2), t0))];
        let F = FN, t = t0;
        for (let d = 1; d <= 4; d++) {
            const k = Math.round(t / 32), across = d === 1 ? -2048 : 0;
            F = (axis ? E.lm.cellChild(F, k, across) : E.lm.cellChild(F, across, k)).id;
            t = (t - 32 * k) * 4096;
            const objs = E.store._ensureUp(F, 0, 0).objs;
            const of = (ids) => objs.filter((x) => ids.has(x.id) && x.loops).flatMap((x) => x.loops.flatMap(pcs));
            const ta = nearest(on(of(a.id), 0), t), tb = nearest(on(of(b.id), 0), t);
            steps.push(ta == null || tb == null ? null : Math.abs(ta - tb));
            if (ta != null) t = ta;
        }
        out.push(steps);
    }
    return out;
}
const SWIPE = [[-20.123456789, -9.87654321], [20.987654321, 11.13579]];   // across the edge, along it

describe("F182: an eraser across a frame edge, the squares' cut edges where they meet", () => {
    test.each([["a vertical", 0], ["a horizontal", 1]])("a swipe's straight sides cross %s edge: the crossings meet at its level and 4 below", (_, axis) => {
        const run = eraseIn(1, 1.37, 8, (c) => SWIPE.map(([u, v]) => (axis ? [c[0] + v, W / 2 + u] : [W / 2 + u, c[1] + v])));
        const seams = seamSteps(run, axis);
        expect(seams.length).toBe(2);
        for (const steps of seams) expect(steps).toEqual([0, 0, 0, 0, 0]);
    });
    // The probe's dabs 1 and 2: cap arcs whose centres a whole-frame move rounds.
    test.each([[1, 1], [2, 2]])("a dab's cap arcs cross it (dab %i at level %i)", (k, L) => {
        const f = 0.1 + 0.137 * k + 1e-7 * Math.PI * (k + 1), g = 0.3 + 0.0711 * k + 1e-8 * Math.E * (k + 1);
        const run = eraseIn(L, 1 + 0.173 * (k + 1), 12, (c) => [[W / 2 - 2.5 - f, c[1] + g], [W / 2 - 2.5 - f + 0.21, c[1] + g]]);
        const seams = seamSteps(run, 0);
        expect(seams.length).toBe(2);
        for (const steps of seams) expect(steps).toEqual([0, 0, 0, 0, 0]);
    });
    // Both of its sides step without the shared crossings (a plain horizontal swipe happens not to).
    test("a swipe past a frame corner, four squares: both of the corner square's sides meet", () => {
        const run = eraseIn(1, 1.37, 8, () => [[W / 2 - 60.123456789, W / 2 + 20.98765432], [W / 2 + 20.13579246, W / 2 - 60.97531864]]);
        for (const axis of [0, 1]) {
            const seams = seamSteps(run, axis);
            expect(seams.length).toBe(2);
            for (const steps of seams) expect(steps).toEqual([0, 0, 0, 0, 0]);
        }
    });
});
