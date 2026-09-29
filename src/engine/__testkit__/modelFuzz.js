/**
 * modelFuzz.js — the document model's equivalence fuzz (A1 §5 checks 1–3, PLAN §3 rows 7–9): one
 * seeded operation sequence applied to two engines, the frozen model-v1 oracle (`__oracles__/model-v1`,
 * which settles a frame's shift into its natives at the first read) and the live engine (which
 * composes it on read), and after every operation the two pictures compared native for native at
 * four frames. Every gesture's parameters are drawn once, from the oracle's picture, and replayed
 * on both engines, so the two run the same operations whatever their stored states say.
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */
import KobinEngine from "../KobinEngine";
import OracleEngine from "../__oracles__/model-v1/KobinEngine";
import { OpLog } from "../oplog";
import { OpLog as OracleOpLog } from "../__oracles__/model-v1/oplog";
import { encodeObjects, decodeObjects } from "../format2";
import { encodeObjects as oEncodeObjects, decodeObjects as oDecodeObjects } from "../__oracles__/model-v1/format2";
import { collectFrames } from "../frameGc";
import { collectFrames as oCollectFrames } from "../__oracles__/model-v1/frameGc";
import { drawStroke, eraseGesture, descend, ascend } from "./harness";
import { lcg } from "./stageFuzz";
import { W } from "../frameLattice";

const COLOURS = ["rgb(0,0,0)", "rgb(200,30,30)", "rgb(30,120,200)", "rgb(40,160,60)"];
/** A frame's own square, one unit in from its edges: one cache tile a direction. */
export const CELL = Object.freeze({ left: -W / 2 + 1, top: -W / 2 + 1, right: W / 2 - 1, bottom: W / 2 - 1 });
// Above its home a native's remainder reaches 48 units (a composed table of 1.5 W at k0 = −1): the settling
// model read the unshifted window there and so drew less at the square's edges (A1 C1 reroutes it).
const EDGE_M = 64;
const insideCell = (it) => {
    const p = it.painted;
    for (let i = 0; i + 1 < p.length; i += 2) {
        if (!(p[i] > CELL.left + EDGE_M && p[i] < CELL.right - EDGE_M && p[i + 1] > CELL.top + EDGE_M && p[i + 1] < CELL.bottom - EDGE_M)) return false;
    }
    return true;
};

const KIND = {
    oracle: { Engine: OracleEngine, OpLog: OracleOpLog, encode: oEncodeObjects, decode: oDecodeObjects, gc: oCollectFrames },
    live: { Engine: KobinEngine, OpLog, encode: encodeObjects, decode: decodeObjects, gc: collectFrames },
};

function mk(kind, w, h, all) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KIND[kind].Engine(host, { width: w, height: h, scenes: false });
    E._fuzzKind = kind;
    all.push(E);
    return E;
}

/** Every number a piece's geometry holds, in order: loops' records, a fill's rings, a stroke's points. */
export function numsOf(p) {
    const out = [];
    const pushPt = (q) => { if (q) { out.push(q[0], q[1]); } };
    if (p.loops) {
        for (const l of p.loops) {
            if (l && l.buf) { for (let i = 0; i < l.buf.length; i++) out.push(l.buf[i]); continue; }
            for (const pc of l || []) { pushPt(pc.A); pushPt(pc.B); if (!pc.line) { pushPt(pc.C); out.push(pc.r, pc.a0, pc.sweep); } }
        }
    }
    if (p.polys) for (const ring of p.polys) for (const q of ring) pushPt(q);
    if (p.pts) for (const q of p.pts) pushPt(q);
    return out;
}

/** A piece as painted: its geometry's points moved by `off` (radii and angles as they are). */
export function paintedOf(p, off) {
    const out = [], dx = off[0], dy = off[1];
    const pushPt = (q) => { if (q) { out.push(q[0] + dx, q[1] + dy); } };
    if (p.loops) {
        for (const l of p.loops) {
            for (const pc of l || []) { pushPt(pc.A); pushPt(pc.B); if (!pc.line) { pushPt(pc.C); out.push(pc.r, pc.a0, pc.sweep); } }
        }
    }
    if (p.polys) for (const ring of p.polys) for (const q of ring) pushPt(q);
    if (p.pts) for (const q of p.pts) pushPt(q);
    return out;
}

/** The picture of frame V over `rect` as the engine's Stage reads it: native id -> its items `{type, nums, off, painted}`. */
export function pictureAt(E, V, rect = CELL) {
    const snap = E.stage.snapshot(V, rect, Infinity);
    if (!snap) return null;
    const out = new Map();
    for (const it of snap.items()) {
        let a = out.get(it.id);
        if (!a) out.set(it.id, (a = []));
        const off = [it.off[0], it.off[1]];
        a.push({ type: it.piece.type, nums: numsOf(it.piece), off, painted: paintedOf(it.piece, off), own: it.key === "own" });
    }
    return out;
}

const ulp = (v) => { v = Math.abs(v); if (v === 0) return Number.MIN_VALUE; return Math.pow(2, Math.floor(Math.log2(v)) - 52); };
/** How many ulps apart two numbers are (0 when bit-equal; Infinity past 8). */
function ulps(a, b) {
    if (Object.is(a, b) || a === b) return 0;
    const d = Math.abs(a - b) / ulp(Math.max(Math.abs(a), Math.abs(b)));
    return d > 8 ? Infinity : Math.ceil(d);
}
/** Ulps between two items: their numbers and offsets (`painted` false), or their pictures as painted. */
function worst(a, b, painted = false) {
    const x = painted ? a.painted : a.nums, y = painted ? b.painted : b.nums;
    if (a.type !== b.type || x.length !== y.length) return Infinity;
    if (!painted && (a.off[0] !== b.off[0] || a.off[1] !== b.off[1])) return Infinity;
    let m = 0;
    for (let i = 0; i < x.length && m !== Infinity; i++) m = Math.max(m, ulps(x[i], y[i]));
    return m;
}

/** The frames compared after an operation: the camera's, its parent, a ring neighbour and a child, each in both lattices. */
export function framesToCompare(O, N) {
    const F = String(N.cam.frame);
    const both = (id) => id != null && O.lm.frame(String(id)) && N.lm.frame(String(id));
    const out = [];
    if (both(F)) out.push(F);
    const p = N.lm.parentOf(F);
    if (both(p)) out.push(String(p));
    // A neighbour and a child with the most under them, so the comparison reads ink when there is some.
    const weight = (f) => { let n = 0; N.lm.walk(f.id, (g) => { n += N.doc.count(g.id) + 1; }); return n; };
    const best = (fs) => fs.filter((f) => f && both(f.id)).map((f) => [weight(f), f.id]).sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : 1));
    const ring = best(N.lm.peekRing(F));
    if (ring.length) out.push(ring[0][1]);
    const kids = best(N.lm.childrenOf(F));
    if (kids.length) out.push(kids[0][1]);
    return out;
}

/**
 * Compare the two pictures at frame V. A native homed in the same frame in both engines must be drawn
 * from bit-identical pieces and offsets; one the oracle carried to another frame is compared through
 * its picture: its pieces and offsets bit-identical at and below its home's depth, its painted points
 * within `aboveUlps` above it (A1 E3). A native the oracle carried at an earlier check (`st.tainted`)
 * whose picture then differs has left the oracle's frame for good — a later frame operation moves it
 * in one engine and not the other, which is C1's point — and is counted (`st.diverged`), not failed.
 * Adds to `st` and returns the first difference, or null.
 */
export function comparePictures(O, N, V, st, aboveUlps = 1) {
    const a = pictureAt(O, V), b = pictureAt(N, V);
    if (!a || !b) return "no picture at " + V;
    const D = N.lm.depthOf(V);
    const tainted = st.tainted || (st.tainted = new Set());
    const carriedNow = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        let ra = a.get(id) || [], rb = b.get(id) || [];
        const ho = O.doc.getById(id), hn = N.doc.getById(id);
        // Above its home only what is painted clear of the square's edges is compared (EDGE_M).
        if ((hn && D < N.lm.depthOf(hn.level)) || (ho && D < O.lm.depthOf(ho.level))) {
            ra = ra.filter(insideCell); rb = rb.filter(insideCell);
            if (!ra.length && !rb.length) continue;
        }
        const same = !!ho && !!hn && String(ho.level) === String(hn.level);
        if (!same && ho && hn) carriedNow.push(id);
        const diverged = () => { st.diverged = (st.diverged || 0) + 1; return null; };
        if (ra.length !== rb.length) {
            if (!same && tainted.has(id)) { diverged(); continue; }
            return "native " + id + " at " + V + ": oracle " + ra.length + " items, live " + rb.length + (same ? "" : " (carried)");
        }
        const above = hn ? D < N.lm.depthOf(hn.level) : false;
        const painted = !same && above;
        const hf = hn ? N.lm.frame(String(hn.level)) : null;
        const shifted = !!(hf && hf.shift);
        const left = rb.slice();
        let gone = false;
        for (const x of ra) {
            let best = -1, bw = Infinity;
            for (let k = 0; k < left.length; k++) { const w = worst(x, left[k], painted); if (w < bw) { bw = w; best = k; if (w === 0) break; } }
            if ((best < 0 || bw === Infinity || (!same && !above && bw !== 0) || (painted && bw > aboveUlps)) && !same && tainted.has(id)) { gone = true; break; }
            if (best < 0 || bw === Infinity) return "native " + id + " at " + V + ": an item has no match" + (same ? "" : " (carried)");
            left.splice(best, 1);
            st.items++;
            if (x.off[0] || x.off[1]) st.off = (st.off || 0) + 1;
            if (shifted) st.shifted = (st.shifted || 0) + 1;
            if (!x.own) st.pieces = (st.pieces || 0) + 1;
            if (same) {
                if (bw !== 0) return "native " + id + " at " + V + ": " + bw + " ulp with the same home";
                st.exact++;
            } else {
                st.carried++;
                if (bw === 0) st.carriedExact++;
                else if (!above) return "carried native " + id + " at " + V + " (at or below its home): " + bw + " ulp";
                else if (bw > aboveUlps) return "carried native " + id + " at " + V + " (above its home): " + bw + " ulp";
                else st.carriedUlp++;
                st.maxUlp = Math.max(st.maxUlp, bw);
            }
        }
        if (gone) diverged();
    }
    for (const id of carriedNow) tainted.add(id);
    return null;
}

/**
 * One seeded run over the two engines: `steps` operations, `check(O, N, step, op)` after each
 * (after both rendered). Returns `{ ops }`. Engines replaced by a reload are destroyed. `extra(ctx)`
 * returns more `[name, weight, fn]` operations; `ctx` gives `both`, `ri`, `pick`, `rnd`, `inkPoints`,
 * `w`, `h` and the current engines as `O()` and `N()`.
 */
export function runPairFuzz(seed, steps, check, { w = 800, h = 600, extra = null } = {}) {
    const all = [];
    const rnd = lcg(seed * 7919 + 101);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    let O = mk("oracle", w, h, all), N = mk("live", w, h, all);
    const logs = new Map([[O, new OracleOpLog(O)], [N, new OpLog(N)]]);
    const stores = new Map();
    const both = (fn) => { fn(O); fn(N); };
    const inkPoints = () => {
        const out = [];
        const snap = O.stage.snapshot(O.cam.frame, O._listWin(), Infinity);
        if (!snap) return out;
        for (const it of snap.items()) {
            if (it.erase || !it.nat) continue;
            const p = it.piece;
            let q = null;
            if (p.loops && p.loops.length) { const l = p.loops[0]; const pc = l.at ? l.at(0) : l[0]; q = pc && (pc.A || pc); }
            else if (p.polys && p.polys.length && p.polys[0].length) q = p.polys[0][0];
            else if (p.pts && p.pts.length) q = p.pts[0];
            if (!q) continue;
            const x = (q[0] + it.off[0]) * O.cam.inScale + O.cam.inPanX, y = (q[1] + it.off[1]) * O.cam.inScale + O.cam.inPanY;
            if (x > 2 && y > 2 && x < w - 2 && y < h - 2) out.push([x, y]);
        }
        return out;
    };
    const strokePts = () => {
        const n = ri(2, 7), x0 = ri(60, w - 60), y0 = ri(60, h - 60), out = [[x0, y0]];
        for (let k = 1; k < n; k++) out.push([Math.min(w - 20, Math.max(20, out[k - 1][0] + ri(-160, 160))), Math.min(h - 20, Math.max(20, out[k - 1][1] + ri(-120, 120)))]);
        return out;
    };
    const drag = (E, p, dx, dy, n) => { E.pointerDown(p[0], p[1]); for (let k = 1; k <= n; k++) E.pointerMove(p[0] + (dx * k) / n, p[1] + (dy * k) / n); E.pointerUp(); };
    const reload = (E) => {
        const kind = E._fuzzKind;
        const d = E.serializeDrawing();
        const F = mk(kind, w, h, all);
        F.loadDrawing(d);
        F.flushBakes();
        logs.set(F, new KIND[kind].OpLog(F));
        E.destroy();
        return F;
    };
    const reloadStore = (E) => {
        const kind = E._fuzzKind, K = KIND[kind];
        const log = logs.get(E);
        let st = stores.get(E);
        if (!st) {
            const frames = {}, frameSeq = {};
            for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = K.encode(E.doc.list(level)); frameSeq[level] = log.seq; }
            stores.set(E, { frames, frameSeq, camera: E.cam.state(), entries: log.drain().entries });
            return E;
        }
        const entries = st.entries.concat(log.drain().entries);
        const F = mk(kind, w, h, all);
        const nat = {};
        for (const level of Object.keys(st.frames)) nat[level] = K.decode(st.frames[level].objects, st.frames[level].geo);
        F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: st.camera, crossings: E.lm.serialize(), natives: nat });
        const L = new K.OpLog(F);
        L.replay(entries, st.frameSeq);
        F.flushBakes();
        F._render();
        logs.set(F, L);
        stores.delete(E);
        E.destroy();
        return F;
    };
    const table = [
        ["stroke", 6, () => {
            const op = rnd() < 0.2 ? 0.5 : 1, pts = strokePts(), wd = ri(3, 40), col = pick(COLOURS);
            both((E) => { E.setOpacity(op); drawStroke(E, pts, wd, col); });
        }],
        ["descendDraw", 3, () => {
            // Ink a level or two under the camera, then back up: content in the camera's kids to drag and view.
            const L = O.activeLevel, to = Math.min(4, L + ri(1, 2)), ink = inkPoints();
            const p = ink.length && rnd() < 0.6 ? pick(ink) : [ri(100, w - 100), ri(100, h - 100)];
            const strokes = [];
            for (let k = ri(1, 3); k > 0; k--) strokes.push([strokePts(), ri(3, 40), pick(COLOURS)]);
            both((E) => {
                const cam = E.cam.state();
                descend(E, to, p[0], p[1]);
                for (const [pts, wd, col] of strokes) drawStroke(E, pts, wd, col);
                E.cam.set(cam);
                E._render();
            });
        }],
        ["erase", 3, () => {
            const pts = strokePts(), size = ri(6, 40), flush = rnd() < 0.6;
            both((E) => { eraseGesture(E, pts, size); if (flush) E.flushErases(); });
        }],
        ["tapDrag", 3, () => {
            const ink = inkPoints();
            if (!ink.length) return;
            const p = pick(ink), dx = ri(-300, 300), dy = ri(-200, 200), n = ri(2, 6);
            both((E) => { E.setTool("select"); E.pointerDown(p[0], p[1]); E.pointerUp(); drag(E, p, dx, dy, n); });
        }],
        ["lassoDrag", 1.5, () => {
            const x0 = ri(0, w / 2), y0 = ri(0, h / 2), x1 = x0 + ri(80, w / 2), y1 = y0 + ri(80, h / 2);
            const go = rnd() >= 0.3, dx = ri(-250, 250), dy = ri(-200, 200);
            both((E) => {
                E.setTool("select");
                E.pointerDown(x0, y0, true);
                for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) E.pointerMove(x, y);
                E.pointerUp();
            });
            if (!go || !O.selection) return;
            const ink = inkPoints();
            if (!ink.length) return;
            const p = pick(ink);
            both((E) => drag(E, p, dx, dy, 2));
        }],
        ["subtreeDrag", 2, () => {
            const kids = [...O.lm.frames.values()].filter((f) => f.parent === O.cam.frame && O.doc.count(f.id) && N.lm.frame(f.id)).map((f) => f.id).sort();
            if (!kids.length) return;
            const f = pick(kids), dx = ri(-200, 200), dy = ri(-150, 150);
            both((E) => {
                E._setSelection([], [f]);
                const p = E._levelPointToScreen(f, 0, 0);
                E.setTool("select");
                drag(E, p, dx, dy, 2);
            });
        }],
        ["deepDrag", 2, () => {
            // A native homed under the camera moved on its own: its rest enters its home-level table, up
            // to half a frame, which a later subtree drag's shift can carry past the cell edge.
            const cands = [];
            for (const k of O.doc.levels()) {
                if (!(O.lm.depthOf(k) > O.cam.activeLevel) || !N.lm.frame(k)) continue;
                for (const o of O.doc.list(k)) if (!o.erase && N.doc.getById(o.id)) cands.push(o.id);
            }
            if (!cands.length) return;
            cands.sort((a, b) => a - b);
            const id = pick(cands), dx = ri(-300, 300), dy = ri(-200, 200);
            both((E) => {
                E._setSelection([id]);
                E._dragSel = { start: [w / 2, h / 2], moves: new Map(), moved: false, frames: new Map(), frameStart: null };
                E.store.setBatch(true);
                E._dragSelection(w / 2 + dx, h / 2 + dy);
                E.pointerUp();
            });
        }],
        ["delete", 1, () => { both((E) => { if (E.selection) E.deleteSelection(); }); }],
        ["undo", 3, () => { const k = ri(1, 4); both((E) => { for (let i = 0; i < k; i++) E.undo(); E.flushBakes(); }); }],
        ["redo", 2, () => { const k = ri(1, 3); both((E) => { for (let i = 0; i < k; i++) E.redo(); E.flushBakes(); }); }],
        ["zoom", 3, () => {
            const L = O.activeLevel;
            let to = ri(-1, 4);
            if (to === L) to = L + (L < 4 ? 1 : -1);
            to = Math.max(L - 3, Math.min(L + 3, to));
            const ink = inkPoints(), p = ink.length && rnd() < 0.7 ? pick(ink) : [ri(100, w - 100), ri(100, h - 100)];
            both((E) => { if (to > L) descend(E, to, p[0], p[1]); else ascend(E, to, p[0], p[1]); });
        }],
        ["pan", 2, () => {
            const moves = [];
            for (let k = ri(1, 4); k > 0; k--) moves.push([ri(-400, 400), ri(-300, 300)]);
            both((E) => { E.setTool("pan"); for (const [dx, dy] of moves) E.panBy(dx, dy); });
        }],
        ["reload1", 0.5, () => { O = reload(O); N = reload(N); }],
        ["reload2", 0.5, () => { O = reloadStore(O); N = reloadStore(N); }],
        ["gc", 0.5, () => { both((E) => { E.sweepFrames(); KIND[E._fuzzKind].gc(E); E._render(); }); }],
    ];
    if (extra) table.push(...extra({ both, ri, pick, rnd, inkPoints, w, h, O: () => O, N: () => N }));
    const total = table.reduce((s, t) => s + t[1], 0);
    const ops = [];
    try {
        for (let step = 0; step < steps; step++) {
            let r = rnd() * total, op = table[0];
            for (const t of table) { if ((r -= t[1]) < 0) { op = t; break; } }
            op[2]();
            both((E) => E._render());
            ops.push(op[0]);
            if (check(O, N, step, op[0], rnd) === false) break;
        }
    } finally {
        for (const E of all) { try { E.destroy(); } catch (e) { /* already gone */ } }
    }
    return { ops };
}
