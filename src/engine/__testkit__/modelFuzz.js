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
import { W, R } from "../frameLattice";

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
        a.push({ type: it.piece.type, nums: numsOf(it.piece), off, painted: paintedOf(it.piece, off), own: it.key === "own", si: it.si, sj: it.sj });
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

/**
 * A frame's place: its top frame's id and the cells down to it. One id can name two places in the two
 * engines (the oracle zeroed a frame's shift at its settle, so a later drag carried another whole cell
 * into the address), so frames and homes are matched by place.
 */
export function placeOf(E, id) {
    const cells = [];
    let f = id != null ? E.lm.frame(String(id)) : null;
    while (f && f.parent != null) { cells.push(f.cell.i + "," + f.cell.j); f = E.lm.frame(String(f.parent)); }
    return f ? [f.id, ...cells.reverse()].join("/") : null;
}
/** Engine E's resident frame at `place`, or null. */
export function frameAtPlace(E, place) {
    if (place == null) return null;
    for (const f of E.lm.frames.values()) if (f.shadowOf == null && placeOf(E, f.id) === place) return f.id;
    return null;
}

/** The frames compared after an operation, as N's ids: the camera's, its parent, a ring neighbour and a child, each with a resident at its place in O. */
export function framesToCompare(O, N) {
    const F = String(N.cam.frame);
    const both = (id) => {
        const f = id != null ? N.lm.frame(String(id)) : null;
        return !!f && f.shadowOf == null && frameAtPlace(O, placeOf(N, f.id)) != null;
    };
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
 * The composition's remainder at depth D above native `rec`'s home (A1 C1): its own table with its
 * frame's shift added at k = 0, every entry scaled to D. Sub-cell there, so no carry; `shiftAt`'s sums
 * in its order, so bit for bit.
 */
function remAbove(E, rec, D) {
    const f = E.lm.frame(String(rec.level)), k0 = D - E.lm.depthOf(rec.level), below = rec.obj.below || [];
    let rx = 0, ry = 0;
    for (let k = 0; k < Math.max(1, below.length); k++) {
        const e = below[k], sh = k === 0 && f && f.shift ? f.shift : null;
        const ex = (e ? e[0] : 0) + (sh ? sh[0] : 0), ey = (e ? e[1] : 0) + (sh ? sh[1] : 0);
        if (ex === 0 && ey === 0) continue;
        const q = Math.pow(R, k0 - k);
        rx += ex * q; ry += ey * q;
    }
    return [rx, ry];
}
const shiftedCell = (off) => ({ left: CELL.left - off[0], right: CELL.right - off[0], top: CELL.top - off[1], bottom: CELL.bottom - off[1] });
const inRange = (r, it) => it.si >= r.i0 && it.si <= r.i1 && it.sj >= r.j0 && it.sj <= r.j1;

/**
 * Compare the pictures of frame V of N and of the frame at V's place in O over the whole square. A
 * native homed at the same place in both is drawn from bit-identical pieces and offsets; one the oracle
 * carried to another place through its painted points, to the bit at and below its home's depth and
 * within `aboveUlps` above it (A1 E3). Above a native's home the oracle read the unshifted window (its
 * reroute skipped those views), so each of its items is in N's picture, and an item of N's it lacks must
 * come from a tile that window does not reach, inside the window shifted back by the composition's
 * remainder and painted with it (`remAbove`), and every such piece is drawn (counted `edgeOnly`). Two named exceptions, counted: the
 * oracle's reroute memo naming a frame GC forgot is dropped and read again (`oracleMemo`, the memo defect
 * `TileStore.forgetFrame` fixed after C1); and a native the oracle carried at an earlier check whose
 * picture then differs (`diverged`) must have had a home moved in one engine since — C1 keeps a native in
 * its frame — or the check fails. Adds to `st` and returns the first difference, or null.
 */
export function comparePictures(O, N, V, st, aboveUlps = 1) {
    const VO = frameAtPlace(O, placeOf(N, V));
    if (VO == null) return "no frame at " + V + "'s place in the first engine";
    const memo = O.store._rrMemo && O.store._rrMemo.get(VO);
    if (memo && [...memo.groups.values()].some((g) => !O.lm.frame(g.F0))) { O.store._rrMemo.delete(VO); st.oracleMemo = (st.oracleMemo || 0) + 1; }
    const a = pictureAt(O, VO), b = pictureAt(N, V);
    if (!a || !b) return "no picture at " + V;
    const D = N.lm.depthOf(V);
    const unread = N.lm.tileRange(V, CELL);
    const tainted = st.tainted || (st.tainted = new Map());
    const carriedNow = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const ra = a.get(id) || [], rb = b.get(id) || [];
        const ho = O.doc.getById(id), hn = N.doc.getById(id);
        const po = ho ? placeOf(O, ho.level) : null, pn = hn ? placeOf(N, hn.level) : null;
        const same = po != null && po === pn;
        if (!same && po && pn) carriedNow.push([id, po, pn]);
        const above = !!((hn && D < N.lm.depthOf(hn.level)) || (ho && D < O.lm.depthOf(ho.level)));
        const painted = !same && above;
        const c = { items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0, off: 0, shifted: 0, pieces: 0, edgeOnly: 0 };
        const hf = hn ? N.lm.frame(String(hn.level)) : null;
        let diff = ra.length > rb.length || (ra.length < rb.length && !above)
            ? "native " + id + " at " + V + ": oracle " + ra.length + " items, live " + rb.length + (same ? "" : " (carried)") : null;
        const left = rb.slice();
        for (const x of ra) {
            if (diff) break;
            let best = -1, bw = Infinity;
            for (let k = 0; k < left.length; k++) { const w = worst(x, left[k], painted); if (w < bw) { bw = w; best = k; if (w === 0) break; } }
            if (best < 0 || bw === Infinity) { diff = "native " + id + " at " + V + ": an item has no match" + (same ? "" : " (carried)"); break; }
            if (same && bw !== 0) { diff = "native " + id + " at " + V + ": " + bw + " ulp with the same home"; break; }
            if (!same && !above && bw !== 0) { diff = "carried native " + id + " at " + V + " (at or below its home): " + bw + " ulp"; break; }
            if (!same && bw > aboveUlps) { diff = "carried native " + id + " at " + V + " (above its home): " + bw + " ulp"; break; }
            left.splice(best, 1);
            c.items++;
            if (x.off[0] || x.off[1]) c.off++;
            if (hf && hf.shift) c.shifted++;
            if (!x.own) c.pieces++;
            if (same) c.exact++;
            else { c.carried++; if (bw === 0) c.carriedExact++; else c.carriedUlp++; c.maxUlp = Math.max(c.maxUlp, bw); }
        }
        for (const y of diff ? [] : left) {
            const r = hn && above ? remAbove(N, hn, D) : null;
            const ok = r && y.off[0] === r[0] && y.off[1] === r[1] && !inRange(unread, y) && inRange(N.lm.tileRange(V, shiftedCell(y.off)), y);
            if (!ok) { diff = "native " + id + " at " + V + ": a live item the oracle's unshifted window does not explain"; break; }
            c.edgeOnly++;
        }
        if (!diff && above && hn) {
            // Every piece of the native in the tiles only the shifted window reaches is drawn: none missing.
            const r = remAbove(N, hn, D), rr = N.lm.tileRange(V, shiftedCell(r)), seen = new Set();
            let want = 0;
            for (let i = rr.i0; i <= rr.i1; i++) {
                for (let j = rr.j0; j <= rr.j1; j++) {
                    if (inRange(unread, { si: i, sj: j })) continue;
                    for (const dir of ["up", "down"]) {
                        const t = N.store.peek(V + "|" + dir + "|" + i + "," + j);
                        for (const q of t ? t.objs : []) if (q.id === id && !seen.has(q)) { seen.add(q); want++; }
                    }
                }
            }
            if (want !== c.edgeOnly) diff = "native " + id + " at " + V + ": " + want + " pieces only the shifted window reaches, " + c.edgeOnly + " drawn";
        }
        if (diff) {
            const t = tainted.get(id);
            if (!t) return diff;
            if (t.o === po && t.n === pn) return diff + " (carried at an earlier check; neither home has moved since)";
            st.diverged = (st.diverged || 0) + 1;
            continue;
        }
        for (const k of Object.keys(c)) st[k] = k === "maxUlp" ? Math.max(st[k] || 0, c[k]) : (st[k] || 0) + c[k];
    }
    for (const [id, po, pn] of carriedNow) if (!tainted.has(id)) tainted.set(id, { o: po, n: pn });
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
