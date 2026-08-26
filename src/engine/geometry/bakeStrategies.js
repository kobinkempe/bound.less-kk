/**
 * bakeStrategies.js — the same perimeter, three different schedules.
 *
 * All three produce the resolved perimeter defined by `curvePerimeter.js`, out
 * of the same offset curves, with the same accuracy. They differ ONLY in when
 * the work happens, which is the whole question:
 *
 *   A  batch        nothing while drawing; everything at pen-up.
 *   B  incremental  the perimeter is maintained as you draw, so pen-up is a
 *                   representation swap and nothing else. There is no bake.
 *   C  crumb+bake   maintain only the cheap monotone structures while drawing
 *                   (occupancy grid + distance oracle), so pen-up skips
 *                   straight to the exact pass.
 *
 * Shared interface, so the harness and the benchmarks can drive them
 * identically:
 *
 *     const b = new BatchBaker(width, opts);
 *     for (const p of samples) b.addSample(p);
 *     const { loops, stats } = b.finish();
 *
 * `stats.drawMs` is the total spent inside `addSample`, `stats.finishMs` the
 * cost of `finish()`, and `stats.perPoint` the distribution of `addSample`
 * costs — the tail matters more than the mean, because a 100 ms hitch mid
 * stroke is felt and a 2 ms one is not.
 *
 * SETTLING. A Catmull-Rom control point depends on its neighbours, so the span
 * from sample i-1 to i is only final once sample i+1 exists. Every baker that
 * does work while drawing therefore runs one sample behind; `finish()` settles
 * the tail. That lag is inherent to the spline, not to any of these schedules.
 */
import { controlsFor } from "./clipperOutline";
import { cubicAt, circleLoop } from "./curveOutline";
import { Crumb } from "./strokeShape";
import { curvePerimeter, centerlineCubics, offsetSide, endCaps, bboxOf, DistOracle,
    cubicIntersections, subCubic, stitchCubics, VertexSet, oracleTolFor, repairTolFor,
    roundJoin, marginOf, buildTolFor, dropHairlines } from "./curvePerimeter";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function quantiles(xs) {
    if (!xs.length) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return {
        mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4),
        p50: +at(0.5).toFixed(4), p95: +at(0.95).toFixed(4),
        p99: +at(0.99).toFixed(4), max: +Math.max(...xs).toFixed(4),
    };
}

class BaseBaker {
    constructor(width, opts = {}) {
        this.width = width;
        this.r = width / 2;
        this.opts = opts;
        this.pts = [];
        this.drawMs = 0;
        this.perPoint = [];
    }
    addSample(p) {
        const t = now();
        this.pts.push([p[0], p[1]]);
        this._onSample();
        const dt = now() - t;
        this.drawMs += dt;
        this.perPoint.push(dt);
    }
    _onSample() {}
    /**
     * Bring the Catmull-Rom control points up to date and return the index of
     * the last centerline cubic that is now FINAL.
     *
     * The trap: control point i depends on samples i-1, i and i+1, so the last
     * TWO entries are provisional and must be recomputed when a sample arrives,
     * not merely extended. Appending only from `ctrl.length` leaves the previous
     * tail computed as if the stroke had ended there — a different curve from
     * the one `centerlineCubics` produces at the end, which made C disagree with
     * A even though C is supposed to be A with the cheap parts moved earlier.
     */
    _settleCtrl() {
        const n = this.pts.length;
        if (n < 3) return -1;
        const last = n - 1;
        for (let i = Math.max(0, Math.min(this.ctrl.length - 2, last)); i <= last; i++) {
            this.ctrl[i] = controlsFor(this.pts[Math.max(i - 1, 0)], this.pts[i], this.pts[Math.min(i + 1, last)]);
        }
        return last - 1;          // span last-1 -> last still needs a future sample
    }
    _cubicAt(i) {
        return [this.pts[i], this.ctrl[i].right, this.ctrl[i + 1].left, this.pts[i + 1]];
    }
    _wrap(loops, extra) {
        return { loops, stats: { ...extra, drawMs: +this.drawMs.toFixed(1),
            perPoint: quantiles(this.perPoint), samples: this.pts.length } };
    }
}

// ---------------------------------------------------------------------------
// A — batch
// ---------------------------------------------------------------------------
export class BatchBaker extends BaseBaker {
    finish() {
        const t = now();
        const { loops, stats } = curvePerimeter(this.pts, this.width, this.opts);
        const finishMs = +(now() - t).toFixed(1);
        return this._wrap(loops, { algorithm: "A-batch", finishMs, inner: stats });
    }
}

// ---------------------------------------------------------------------------
// C — crumb + bake
//
// While drawing, maintain only what is MONOTONE: the occupancy grid and the
// distance oracle. Neither can be invalidated by more ink, so both survive to
// pen-up intact and the expensive pass starts with its two prerequisites
// already built. No geometry is produced until the pen lifts.
// ---------------------------------------------------------------------------
export class CrumbBaker extends BaseBaker {
    constructor(width, opts = {}) {
        super(width, opts);
        const r = this.r;
        this.cellSize = opts.cellSize || r / 2;
        this.crumb = new Crumb(this.cellSize);
        this.oracle = new DistOracle(null, r, oracleTolFor(r, opts));
        this.settled = 0;          // centerline cubics folded in so far
        this.ctrl = [];
    }
    _onSample() {
        const finalTo = this._settleCtrl();
        for (let i = this.settled; i < finalTo; i++) { this._fold(this._cubicAt(i), i); this.settled = i + 1; }
    }
    _fold(c, ci) {
        const before = this.oracle.segs.length;
        this.oracle.addCubic(c, ci);
        for (let i = before; i < this.oracle.segs.length; i++) {
            const s = this.oracle.segs[i];
            this.crumb.add({ a: [s.ax, s.ay], b: [s.ax + s.ux * s.L, s.ay + s.uy * s.L],
                ux: s.ux, uy: s.uy, L: s.L }, this.r, i);
        }
    }
    finish() {
        const t = now();
        // Settle the tail the lag left behind, then hand both structures over.
        const centre = centerlineCubics(this.pts, this.opts.curved !== false);
        for (let i = this.settled; i < centre.length; i++) this._fold(centre[i], i);
        const { loops, stats } = curvePerimeter(this.pts, this.width,
            { ...this.opts, crumb: this.crumb, oracle: this.oracle });
        const finishMs = +(now() - t).toFixed(1);
        return this._wrap(loops, { algorithm: "C-crumb", finishMs, inner: stats });
    }
}

// ---------------------------------------------------------------------------
// B — incremental
//
// The only one that produces geometry while the pen is down, and so the only
// one for which pen-up is free. Per settled centerline cubic:
//
//   1. extend the oracle (the ink just grew);
//   2. offset the new cubic, cut the new pieces against the live ones they
//      reach, and keep the parts that are not buried;
//   3. re-cut the live pieces the new capsule reaches, and drop the parts it
//      just buried.
//
// Step 3 is what makes this incremental rather than merely deferred, and it is
// sound for the same reason the crumb is: burial is a one-way door, so a piece
// that dies never has to be reconsidered, and a piece that lives only ever has
// to be re-examined against ink that arrived after it.
//
// Caps are NOT maintained while drawing — the trailing cap moves with every
// sample, so maintaining it would be pure churn. They are added in finish(),
// which is why finish() is small but not zero.
// ---------------------------------------------------------------------------
export class IncrementalBaker extends BaseBaker {
    constructor(width, opts = {}) {
        super(width, opts);
        const r = this.r;
        // The SAME build tolerance the batch path uses — see buildTolFor.
        const bt = buildTolFor(r, opts);
        this.fitTol = bt.fitTol;
        this.lineTol = bt.lineTol;
        this.enterScale = opts.enterScale || 1;
        // Bracket to the fitted offset's own accuracy; Newton makes it exact.
        // Must match the batch path or the two cut in different places.
        this.isectTol = Math.max(this.fitTol, r * 1e-6);
        this.margin = marginOf(this.fitTol, r);   // must match the batch path exactly
        this.oracle = new DistOracle(null, r, oracleTolFor(r, opts));
        this.vset = new VertexSet(Math.max(this.isectTol, r * 1e-9));
        this.centre = [];
        this.live = [];            // {c, ci, bb, dead}
        this.ctrl = [];
        this.settled = 0;
        this.cell = Math.max(r, opts.cellSize || r / 2);
        this.buckets = new Map();  // cellKey -> live indices
        this.cuts = 0;
        this.pairTests = 0;
    }

    _bucketsFor(bb, fn) {
        const c = this.cell;
        for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) {
            for (let k = Math.floor(bb[0] / c); k <= Math.floor(bb[2] / c); k++) fn(k * 8388608 + j);
        }
    }
    _insert(piece) {
        const idx = this.live.length;
        this.live.push(piece);
        this._bucketsFor(piece.bb, (key) => {
            let arr = this.buckets.get(key);
            if (!arr) this.buckets.set(key, arr = []);
            arr.push(idx);
        });
        return idx;
    }
    _near(bb) {
        const seen = new Set(), out = [];
        this._bucketsFor(bb, (key) => {
            const arr = this.buckets.get(key);
            if (!arr) return;
            for (const i of arr) {
                if (seen.has(i) || this.live[i].dead) continue;
                seen.add(i); out.push(i);
            }
        });
        return out;
    }

    _onSample() {
        const finalTo = this._settleCtrl();
        for (let i = this.settled; i < finalTo; i++) {
            this._extend(this._cubicAt(i), i, { start: i === 0 });
            this.settled = i + 1;
        }
    }

    /**
     * Fold one more centerline cubic into the live perimeter.
     *
     * `caps.start` / `caps.end` add the round ends. The START cap is emitted with
     * the FIRST cubic, not saved for pen-up: it depends only on that cubic's
     * opening tangent, so it is final as soon as the cubic is, and — this is the
     * point — a cap can only be welded to the body while the body is still
     * uncut. Welding one on at pen-up drags its endpoint onto a coordinate that
     * belonged to a piece which has since been cut in two or buried, so the cap
     * arrives at a place where nothing lives. Measured on a six-sample
     * self-crossing stroke: four dangling ends, one cap piece looping onto
     * itself, five unclosed chains. The batch path welds its whole chain, caps
     * included, before it cuts anything; this is the same order.
     */
    _extend(c, ci, caps = {}) {
        this.centre[ci] = c;
        this.oracle.addCubic(c, ci);

        const o = { fitTol: this.fitTol, lineTol: this.lineTol, enterScale: this.enterScale };
        const leftFwd = offsetSide([c], this.r, 1, o);
        const rightFwd = offsetSide([c], this.r, -1, o);

        // ROUND JOINS, exactly as the batch path builds them. It offsets the
        // whole centerline in one call, so `offsetSide` can see the previous
        // cubic's chain and close each turn at the shared anchor with an arc.
        // One cubic at a time cannot see that, so the join is added here —
        // otherwise the gap gets closed by dragging an endpoint across it, which
        // both moves real geometry and loses the boundary that belonged there.
        if (leftFwd.length && this.lastLeftEnd) {
            leftFwd.unshift(...roundJoin(c[0], this.r, this.lastLeftEnd, leftFwd[0].c[0],
                this.enterScale, this.fitTol).map((ac) => ({ c: ac })));
        }
        if (rightFwd.length && this.lastRightEnd) {
            rightFwd.unshift(...roundJoin(c[0], this.r, this.lastRightEnd, rightFwd[0].c[0],
                this.enterScale, this.fitTol).map((ac) => ({ c: ac })));
        }
        // WELD. Consecutive offsets should land on the same point — both are the
        // shared anchor plus r times the unit normal — but the spline's end
        // anchors have degenerate handles, so `tillerHanson` borrows a
        // neighbouring leg's direction and the two disagree by more than the
        // stitcher welds. What is left after the round join is float noise.
        for (const side of [leftFwd, rightFwd]) {
            for (let i = 1; i < side.length; i++) side[i].c[0] = side[i - 1].c[3];
        }
        if (leftFwd.length && this.lastLeftEnd) leftFwd[0].c[0] = this.lastLeftEnd;
        if (rightFwd.length && this.lastRightEnd) rightFwd[0].c[0] = this.lastRightEnd;

        // The caps, welded into the chain while it is still uncut.
        const capSets = (caps.start || caps.end) ? endCaps([c], this.r, o) : null;
        let capStart = [], capEnd = [];
        if (capSets && caps.start) {
            capStart = capSets.start.map((p) => ({ c: p.c }));
            for (let i = 1; i < capStart.length; i++) capStart[i].c[0] = capStart[i - 1].c[3];
            if (capStart.length && rightFwd.length) capStart[0].c[0] = rightFwd[0].c[0];
            if (capStart.length && leftFwd.length) capStart[capStart.length - 1].c[3] = leftFwd[0].c[0];
        }
        if (capSets && caps.end) {
            capEnd = capSets.end.map((p) => ({ c: p.c }));
            for (let i = 1; i < capEnd.length; i++) capEnd[i].c[0] = capEnd[i - 1].c[3];
            if (capEnd.length && leftFwd.length) capEnd[0].c[0] = leftFwd[leftFwd.length - 1].c[3];
            if (capEnd.length && rightFwd.length) capEnd[capEnd.length - 1].c[3] = rightFwd[rightFwd.length - 1].c[3];
        }
        if (leftFwd.length) this.lastLeftEnd = leftFwd[leftFwd.length - 1].c[3];
        if (rightFwd.length) this.lastRightEnd = rightFwd[rightFwd.length - 1].c[3];

        // The right side is stored REVERSED, so the whole perimeter runs one way
        // round: left side forward, end cap, right side backward, start cap. A
        // right side left running forward leaves the end cap's finish with
        // nothing to join. (Measured as a 157 degree kink on a stroke with zero
        // cuts in it.)
        const right = rightFwd.map((p) => {
            const q = p.c;
            return { c: [[q[3][0], q[3][1]], [q[2][0], q[2][1]], [q[1][0], q[1][1]], [q[0][0], q[0][1]]] };
        }).reverse();
        const body = [...leftFwd, ...capEnd, ...right, ...capStart]
            .map((p) => ({ c: p.c, ci, bb: bboxOf(p.c), dead: false }));

        // 3 (first, so the new pieces are cut against a settled world):
        //    everything the new ink reaches may have just been buried.
        const reach = [c[0], c[1], c[2], c[3]].reduce((b, p) => [
            Math.min(b[0], p[0] - this.r), Math.min(b[1], p[1] - this.r),
            Math.max(b[2], p[0] + this.r), Math.max(b[3], p[1] + this.r)],
            [Infinity, Infinity, -Infinity, -Infinity]);
        // Query per BODY PIECE, not by the centerline's reach box. A live piece
        // is cut where a new OFFSET curve crosses it, so the thing to search
        // around is the offset piece's own box. Using the centerline hull grown
        // by r is nearly the same region but not exactly, and the difference is
        // real crossings quietly missed — measured as 38 cuts against the batch
        // path's 42, which broke B's chain into extra loops on any stroke that
        // crosses itself.
        const touched = new Map();          // live index -> cut parameters
        for (const nb of body) {
            for (const idx of this._near(nb.bb)) {
                const p = this.live[idx];
                if (p.ci === ci) continue;   // same cubic: joined, not clipped
                if (bboxMiss(p.bb, nb.bb)) continue;
                this.pairTests++;
                let ts = touched.get(idx);
                if (!ts) touched.set(idx, ts = []);
                for (const [ta, tb] of cubicIntersections(p.c, nb.c, this.isectTol)) {
                    const pa = cubicAt(p.c, ta), pb = cubicAt(nb.c, tb);
                    const v = this.vset.at((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
                    if (ta > 1e-9 && ta < 1 - 1e-9) { ts.push({ t: ta, v }); this.cuts++; }
                    if (tb > 1e-9 && tb < 1 - 1e-9) (nb.pre = nb.pre || []).push({ t: tb, v });
                }
            }
        }
        // Anything the new ink reaches must be re-classified even if nothing cut
        // it — a capsule can bury a piece whole without crossing it once.
        for (const idx of this._near(reach)) {
            const p = this.live[idx];
            if (p.ci === ci) continue;
            if (!touched.has(idx)) touched.set(idx, []);
        }
        for (const [idx, cuts] of touched) {
            const p = this.live[idx];
            if (p.dead) continue;
            const ts = [{ t: 0, v: null }, { t: 1, v: null }, ...cuts];
            const kept = this._survivors(p.c, p.ci, ts);
            if (cuts.length === 0 && kept.length === 1 && kept[0].whole) continue;
            p.dead = true;
            for (const k of kept) this._insert({ c: k.c, ci: p.ci, bb: bboxOf(k.c), dead: false });
        }

        // 2. now the new pieces, cut against everything that was already there.
        //    `pre` already holds the cuts the step above found on THIS piece, from
        //    the same computations — recomputing them here would subdivide in the
        //    other argument order and land somewhere slightly different, which is
        //    the asymmetry that leaves a junction with only one side cut.
        for (const nb of body) {
            const ts = [{ t: 0, v: null }, { t: 1, v: null }, ...(nb.pre || [])];
            for (const idx of this._near(nb.bb)) {
                const q = this.live[idx];
                if (q.ci === ci) continue;
                if (bboxMiss(nb.bb, q.bb)) continue;
                this.pairTests++;
                for (const [ta, tb] of cubicIntersections(nb.c, q.c, this.isectTol)) {
                    const pa = cubicAt(nb.c, ta), pb = cubicAt(q.c, tb);
                    const v = this.vset.at((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
                    if (ta > 1e-9 && ta < 1 - 1e-9) { ts.push({ t: ta, v }); this.cuts++; }
                    if (tb > 1e-9 && tb < 1 - 1e-9) (q.late = q.late || []).push({ t: tb, v });
                }
            }
            for (const k of this._survivors(nb.c, ci, ts)) {
                this._insert({ c: k.c, ci, bb: bboxOf(k.c), dead: false });
            }
        }
        // Anything the new pieces cut in step 2 has to be re-split too. Cutting
        // only the arriving side leaves the older piece running straight through
        // the junction, so the new piece's end has nothing to meet.
        for (const p of this.live) {
            if (p.dead || !p.late) continue;
            const cuts = p.late; p.late = null;
            p.dead = true;
            for (const k of this._survivors(p.c, p.ci, [{ t: 0, v: null }, { t: 1, v: null }, ...cuts])) {
                this._insert({ c: k.c, ci: p.ci, bb: bboxOf(k.c), dead: false });
            }
        }
    }

    /**
     * Sub-intervals of `c` (cut at `ts`) whose midpoints are not buried.
     *
     * `ts` entries are `{t, v}`: the parameter, and the SHARED crossing point the
     * two pieces cut there agreed on, or null at a piece's own ends. Snapping to
     * it is what makes the junction exact rather than merely close — see the
     * VertexSet note in curvePerimeter.
     *
     * No arc-length window: burial is a function of position only, exactly as in
     * the batch path. B reading a different predicate from A is B measuring a
     * different shape.
     */
    _survivors(c, ci, ts) {
        const s = ts.slice().sort((a, b) => a.t - b.t);
        const out = [];
        for (let i = 0; i < s.length - 1; i++) {
            const a = s[i], b = s[i + 1];
            if (b.t - a.t < 1e-12) continue;
            if (this._allBuried(c, a.t, b.t)) continue;
            const sub = subCubic(c, a.t, b.t);
            if (a.v) sub[0] = [a.v[0], a.v[1]];
            if (b.v) sub[3] = [b.v[0], b.v[1]];
            out.push({ c: sub, whole: a.t === 0 && b.t === 1 });
        }
        return out;
    }

    /**
     * Is this span buried along its WHOLE length?
     *
     * Dropping is permanent — that is what makes the incremental schedule cheap,
     * and it is only sound if "dead" really means "inside the ink everywhere",
     * because everything downstream leans on it: a dead piece is not needed as a
     * cutter precisely because crossing something strictly interior cannot change
     * what is inside.
     *
     * Judging that from the MIDPOINT is what broke it. A span is uniform only
     * once every place its status changes has been cut, and while the pen is down
     * the cuts that a later part of the stroke will make do not exist yet. So a
     * span that is buried in the middle and exposed at one end reads as buried,
     * gets dropped, and the exposed part never comes back. Measured on a
     * six-sample self-crossing stroke: exactly one germ of 149, 5.7 units long,
     * which left two dangling ends and an unclosed loop.
     *
     * Sampling across the span instead makes the answer conservative in the one
     * direction that is safe — keeping a piece that is buried costs a little work
     * at pen-up, where the final pass judges it exactly and drops it.
     */
    _allBuried(c, t0, t1) {
        const N = 5;
        for (let k = 1; k <= N; k++) {
            const p = cubicAt(c, t0 + (t1 - t0) * (k / (N + 1)));
            if (!this.oracle.buried(p[0], p[1], this.margin)) return false;
        }
        return true;
    }

    finish() {
        const t = now();
        // Settle the tail, then add the two caps and resolve them against the
        // live body. Everything else is already done.
        const centre = centerlineCubics(this.pts, this.opts.curved !== false);
        if (!centre.length) {
            const loops = this.pts.length ? [circleLoop(this.pts[0], this.r, this.enterScale, this.fitTol)] : [];
            return this._wrap(loops, { algorithm: "B-incremental", finishMs: +(now() - t).toFixed(1) });
        }
        // The caps ride along with the cubics they belong to — the start cap with
        // the first, the end cap with the last — so they are welded into the
        // chain before anything is cut, and then cut and classified as ordinary
        // pieces. There is no separate cap phase.
        const last = centre.length - 1;
        for (let i = this.settled; i < centre.length; i++) {
            this._extend(centre[i], i, { start: i === 0, end: i === last });
        }

        // THE FINAL, EXACT CLASSIFICATION. Every crossing has now been cut, so
        // each live piece is a span between consecutive cuts and its status IS
        // constant along it — which is the condition under which one sample at
        // the midpoint is the exact answer, and it is the same rule the batch
        // path applies. While the pen was down that condition did not hold, so
        // the passes above deliberately kept anything they were unsure of; this
        // is where those are settled.
        for (const p of this.live) {
            if (p.dead) continue;
            const mid = cubicAt(p.c, 0.5);
            if (this.oracle.buried(mid[0], mid[1], this.margin)) p.dead = true;
        }

        const alive = this.live.filter((p) => !p.dead).map((p) => ({ c: p.c }));
        // The SAME stitcher the batch path uses — it resolves four-way junctions by
        // angle and balances the degrees so every loop closes, and a private copy
        // here would just be a second place for the arbitrary-choice bug to live.
        let loops = stitchCubics(alive, Math.max(this.r * 1e-6, 1e-12),
            repairTolFor(this.r, this.opts));
        // The same hairline filter the batch path applies — see dropHairlines.
        loops = dropHairlines(loops, this.margin + oracleTolFor(this.r, this.opts));
        const finishMs = +(now() - t).toFixed(1);
        return this._wrap(loops, { algorithm: "B-incremental", finishMs,
            live: alive.length, cuts: this.cuts, pairTests: this.pairTests,
            out: loops.reduce((n, l) => n + l.length, 0) });
    }
}

const bboxMiss = (a, b) => a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3];

export const BAKERS = { A: BatchBaker, B: IncrementalBaker, C: CrumbBaker };
export const BAKER_NAMES = { A: "A — batch at pen-up", B: "B — incremental while drawing", C: "C — crumb + bake" };

/** Run one baker over a sample list, returning loops and timings. */
export function runBaker(kind, pts, width, opts = {}) {
    const B = BAKERS[kind];
    if (!B) throw new Error("unknown baker " + kind);
    const b = new B(width, opts);
    for (const p of pts) b.addSample(p);
    return b.finish();
}
