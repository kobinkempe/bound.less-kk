// One square of space is the same bits through every frame that reads it (OPEN-FLAGS F174, F179). Each test also puts
// the old route back and checks that the same measurement then fails, so a pass is not a blind spot.
import { useEngines, mkEngine } from "./__testkit__/harness";
import { Loop } from "./geometry/loop";
import { circleLoop } from "./geometry/antRuns";
import { transformLoops } from "./geometry/arcShape";

useEngines();
const W = 131072;

const circle = (E, F, cx, cy, r) => {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), loops: [Loop.from(circleLoop(cx, cy, r))], color: "#123", opacity: 1, w: 6 };
    E.doc.add(o, F);
    return o;
};
/** a − b is exactly k (TwoSum). */
const exactDiff = (a, b, k) => { const s = a - b, bb = s - a; return s === k && (a - (s - bb)) + (-b - bb) === 0; };
const pieceVerts = (E, F, dir, i, j, id) => {
    const t = dir === "up" ? E.store._ensureUp(F, i, j) : E.store._ensureDown(F, i, j), vs = [];
    for (const p of t.objs) {
        if (p.id !== id) continue;
        if (p.loops) for (const l of p.loops) for (const q of l.toPieces()) { vs.push(q.A, q.B); if (!q.line) vs.push(q.C); }
        if (p.polys) for (const r of p.polys) for (const v of r) vs.push(v);
    }
    return vs;
};
/** The largest distance from a vertex of `a` to the nearest of `b` moved by (kx, ky); null when either is empty. */
const gapShifted = (a, b, kx, ky) => {
    if (!a.length || !b.length) return null;
    let g = 0;
    for (const u of a) { let m = Infinity; for (const v of b) m = Math.min(m, Math.hypot((u[0] - kx) - v[0], (u[1] - ky) - v[1])); g = Math.max(g, m); }
    return g;
};
/** Every vertex of `a` has one in `b` exactly (kx, ky) away, and the counts agree. */
const sameShifted = (a, b, kx, ky) => a.length > 0 && a.length === b.length
    && a.every((u) => b.some((v) => exactDiff(u[0], v[0], kx) && exactDiff(u[1], v[1], ky)));

/** The old ring path: a neighbour's natives moved into the parent's coordinates through the common parent. */
function oldRing(E) {
    E.store._ringNatives = function (parentId, rect) {
        const out = [];
        for (const C of this.lm.peekRing(parentId)) for (const G of this.lm.cellFrames(C.id)) {
            const inG = this.lm.mapRectF(rect, parentId, G.id);
            for (const o of this.doc.queryRect(G.id, inG)) { const d = this.lm.projectF(o, G.id, parentId); d.origin = o.origin; out.push(d); }
        }
        return out;
    };
}
/** The old float maps: through the common cell (`framePath`), never sideways. */
const oldMaps = (E) => { E.lm.floatPath = E.lm.framePath; };

/**
 * The step on the line between two owners in a frame straddling its parent's edge (F181): the largest distance from a
 * vertex on that line (x = 0) of one owner's piece of `id` to the nearest such vertex of the other's, told apart by
 * their clips; null where the tile does not hold both.
 */
const ownerStep = (E, F, j, id) => {
    const t = E.store._ensureUp(F, 0, j), on = [[], []];
    for (const p of t.objs) {
        if (p.id !== id || !p.loops || !p.clip) continue;
        const side = p.clip.right <= 0 ? 0 : p.clip.left >= 0 ? 1 : -1;
        if (side < 0) continue;
        for (const l of p.loops) for (const q of l.toPieces()) for (const v of [q.A, q.B]) if (v[0] === 0) on[side].push(v);
    }
    return on[0].length && on[1].length ? gapShifted(on[0], on[1], 0, 0) : null;
};
/**
 * A circle across cell (1000, 37)'s right edge, followed down like H2: the A side's tile (1, j) against the B side's
 * (0, j), and the step between the two owners' pieces in the B side's (0, j), px at the level's deepest zoom.
 */
function ringChain(E, depths) {
    const A = E.lm.cellChild("0", 1000, 37);
    const cx = 65400.123456789123, cy = 12.345678912345, r = 300.98765432109;
    const o = circle(E, A.id, cx, cy, r);
    const out = [];
    let FA = A;
    for (let d = 1; d <= depths; d++) {
        const c = E.lm.mapPointF([cx, cy], A.id, FA.id), rr = r * Math.pow(4096, d - 1), x = 65520;
        const y = c[1] - Math.sqrt((rr - (x - c[0])) * (rr + (x - c[0])));
        const child = E.lm.cellChild(FA.id, 2047, Math.round(y / 32)), FB = E.lm.neighbour(child.id, 1, 0);
        const j = Math.floor((E.lm.mapPointF([x, y], FA.id, child.id)[1] + W / 2) / W);
        const g = gapShifted(pieceVerts(E, child.id, "up", 1, j, o.id), pieceVerts(E, FB.id, "up", 0, j, o.id), W, 0);
        const s = ownerStep(E, FB.id, j, o.id);
        out.push(g == null ? null : Math.max(g, s || 0) * 256);
        FA = child;
    }
    return out;
}

/** A circle in N, F's right neighbour, whose common cell with F is `up` levels above them: F's down tile (1, 0). */
function downTile(E, up) {
    let F = E.lm.cellChild("0", 100, 7);
    for (let k = 1; k < up; k++) F = E.lm.cellChild(F.id, 2047, 0);
    const N = E.lm.neighbour(F.id, 1, 0);
    const o = circle(E, N.id, -65536 + 200.98765432123, 1234.567891234, 300.123456789);
    const ref = [];
    E.store._downPieces(o, { ...o, loops: transformLoops(o.loops, 1, W, 0) }, E.lm.tileRect(F.id, 1, 0), 1, ref);
    const got = pieceVerts(E, F.id, "down", 1, 0, o.id);
    const want = ref.flatMap((p) => p.polys.flat());
    return { F, N, same: sameShifted(got, want, 0, 0), n: got.length };
}

describe("one square, every frame (F174, F179)", () => {
    // Where the chain reads both sides' squares from their owners (F181) the two views are one source, and the old hop
    // shows as a step between the owners' pieces on the line they share: 3 px two levels down here (F174's own probe
    // read 7 px two down and 12,374 px three down; deeper, this chain leaves that line).
    test("F174: a native across its home cell's edge is the same from either side, 1-5 levels down", () => {
        const px = ringChain(mkEngine(800, 600), 5);
        expect(px.every((g) => g != null && g < 1e-6)).toBe(true);
        const E = mkEngine(800, 600);
        oldRing(E); oldMaps(E);   // the hop through the common parent, as before F174 and F179
        const old = ringChain(E, 5);
        expect(old[1] == null || old[1] > 1).toBe(true);   // through the parent: a visible step two levels down
    });

    test("F179: a neighbour's ink on the down path, its common cell 2-6 levels up: present, and exact", () => {
        for (const up of [2, 3, 4, 5, 6]) {
            const r = downTile(mkEngine(800, 600), up);
            expect([up, r.n > 0, r.same]).toEqual([up, true, true]);
        }
        const E = mkEngine(800, 600);
        oldMaps(E);
        expect(downTile(E, 4).same).toBe(false);
    });

    test("F179: across a boundary twelve levels up, a neighbour's origin is exactly one frame away", () => {
        const E = mkEngine(800, 600);
        let F = E.lm.cellChild("0", 2047, 5);
        for (let k = 0; k < 11; k++) F = E.lm.cellChild(F.id, 2047, 5);
        const N = E.lm.neighbour(F.id, 1, 0);
        expect(E.lm.depthOf(F.id) - E.lm.depthOf(E.lm.commonAncestor(F.id, N.id))).toBeGreaterThan(11);
        expect(E.lm.cellOffset(N.id, F.id)).toEqual([W, 0]);
        expect(E.lm.mapPointF([0, 0], N.id, F.id)).toEqual([W, 0]);
        expect(E.lm.mapPointF([0.123456789, -7.5], F.id, N.id)).toEqual([0.123456789 - W, -7.5]);
        oldMaps(E);
        expect(E.lm.mapPointF([0, 0], N.id, F.id)).not.toEqual([W, 0]);
    });
});
