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

/** The picture of frame V over `rect` as the engine's Stage reads it: native id -> its items `{type, nums, off}`. */
export function pictureAt(E, V, rect = CELL) {
    const snap = E.stage.snapshot(V, rect, Infinity);
    if (!snap) return null;
    const out = new Map();
    for (const it of snap.items()) {
        let a = out.get(it.id);
        if (!a) out.set(it.id, (a = []));
        a.push({ type: it.piece.type, nums: numsOf(it.piece), off: [it.off[0], it.off[1]], own: it.key === "own" });
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
function worst(a, b) {
    if (a.type !== b.type || a.nums.length !== b.nums.length) return Infinity;
    if (a.off[0] !== b.off[0] || a.off[1] !== b.off[1]) return Infinity;
    let m = 0;
    for (let i = 0; i < a.nums.length && m !== Infinity; i++) m = Math.max(m, ulps(a.nums[i], b.nums[i]));
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
    const ring = N.lm.peekRing(F).map((f) => f.id).filter(both).sort();
    if (ring.length) out.push(ring[0]);
    const kids = N.lm.childrenOf(F).filter((f) => f && both(f.id)).sort((a, b) => (N.doc.count(b.id) - N.doc.count(a.id)) || (a.id < b.id ? -1 : 1));
    if (kids.length) out.push(kids[0].id);
    return out;
}

/**
 * Compare the two pictures at frame V. A native homed in the same frame in both engines must be drawn
 * from bit-identical pieces and offsets; one the oracle carried to another frame is compared through
 * its picture: bit-identical at and below its home's depth, within `aboveUlps` above it (A1 E3).
 * Adds to `st` and returns the first difference, or null.
 */
export function comparePictures(O, N, V, st, aboveUlps = 1) {
    const a = pictureAt(O, V), b = pictureAt(N, V);
    if (!a || !b) return "no picture at " + V;
    const D = N.lm.depthOf(V);
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const ra = a.get(id) || [], rb = b.get(id) || [];
        const ho = O.doc.getById(id), hn = N.doc.getById(id);
        const same = !!ho && !!hn && String(ho.level) === String(hn.level);
        if (ra.length !== rb.length) return "native " + id + " at " + V + ": oracle " + ra.length + " items, live " + rb.length + (same ? "" : " (carried)");
        const above = hn ? D < N.lm.depthOf(hn.level) : false;
        const left = rb.slice();
        for (const x of ra) {
            let best = -1, bw = Infinity;
            for (let k = 0; k < left.length; k++) { const w = worst(x, left[k]); if (w < bw) { bw = w; best = k; if (w === 0) break; } }
            if (best < 0 || bw === Infinity) return "native " + id + " at " + V + ": an item has no match" + (same ? "" : " (carried)");
            left.splice(best, 1);
            st.items++;
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
    }
    return null;
}

/**
 * One seeded run over the two engines: `steps` operations, `check(O, N, step, op)` after each
 * (after both rendered). Returns `{ ops, O, N }`. Engines replaced by a reload are destroyed.
 */
export function runPairFuzz(seed, steps, check, { w = 800, h = 600 } = {}) {
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
