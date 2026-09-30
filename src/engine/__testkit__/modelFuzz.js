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
/**
 * How far apart a native's drawn boxes may be, in its home's units, when the oracle normalised it: its
 * whole-frame translation re-derived the arcs' records (measured up to 1.5e-8 units; 1e-6 is 2.6e-4 px at
 * the level's deepest zoom).
 */
export const NORMALISED_TOL = 1e-6;
/**
 * A native the oracle normalised, seen from view V (O's VO): its drawn boxes through each model's own
 * placement (`placeNative`, not through a tile: one engine draws it live and the other derived), how far
 * apart in its home's units.
 */
function normalisedGap(O, N, ho, hn, VO, V) {
    const a = O.stage.placeNative(ho.obj, VO).box(), b = N.stage.placeNative(hn.obj, V).box();
    if (!a || !b) return a || b ? Infinity : 0;
    const k = Math.pow(R, N.lm.depthOf(V) - N.lm.depthOf(hn.level));
    let m = 0;
    for (const e of ["left", "top", "right", "bottom"]) m = Math.max(m, Math.abs(a[e] - b[e]) / k);
    return m;
}
const shiftedCell = (off) => ({ left: CELL.left - off[0], right: CELL.right - off[0], top: CELL.top - off[1], bottom: CELL.bottom - off[1] });
/** Whether two natives store the same numbers (their geometry, bit for bit). */
const sameNums = (a, b) => {
    const x = numsOf(a), y = numsOf(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
};
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
 * its frame — or the check fails. A native whose stored numbers differ between the engines is one the
 * oracle's pen-up walked into the neighbour cell by whole frames (`_normalizeHome`, deleted by A1 C2):
 * one engine draws it live and the other through a tile, so its drawn box through each model's
 * placement is compared instead, within NORMALISED_TOL (`normalised`, the largest gap `normMax`).
 * Adds to `st` and returns the first difference, or null.
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
        if (!same && ho && hn && !sameNums(ho.obj, hn.obj)) {
            const gap = normalisedGap(O, N, ho, hn, VO, V);
            if (!(gap <= NORMALISED_TOL)) return "native " + id + " at " + V + ": normalised by the oracle, drawn boxes " + gap + " units apart";
            st.normalised = (st.normalised || 0) + 1;
            st.normMax = Math.max(st.normMax || 0, gap);
            continue;
        }
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
    // The live engine repairs the selection at the end of an undo or a redo (A1 C2, DESIGN.md §10); the oracle did it per
    // event, and two outcomes differ. The oracle takes the live one, so the two op streams stay one: a selected frame the
    // action leaves without ink leaves (the oracle kept it; seed 126), and a selected id the action removed hands over to
    // its family's first member when one exists at the action's end, as the uncut original an undo of a cut restores
    // (the oracle's listener found no family mid-action and deselected; seed 43 of `select.stands`).
    const repairLikeLive = (was) => {
        const s = N.selection;
        if (O.selection) O._reselect([], []);
        else if (was && was.editId != null && s && s.ids.length && !s.frames.length
            && s.ids.every((id) => { const r = O.doc.getById(id); return r && O.doc.editKey(r.obj) === was.editId; })) O._setSelection(s.ids.slice(), []);
    };
    const history = (k, step) => {
        const was = O.selection ? { editId: O.selection.editId } : null;
        both((E) => { for (let i = 0; i < k; i++) step(E); E.flushBakes(); });
        repairLikeLive(was);
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
        ["undo", 3, () => history(ri(1, 4), (E) => E.undo())],
        ["redo", 2, () => history(ri(1, 3), (E) => E.redo())],
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

/**
 * A `runPairFuzz` extra (A1 C2, PLAN §1.4): a drag of a selection (a tap, a lasso, a camera kid frame, or a frame with an
 * id outside it) whose pointer moves are interleaved with reads and camera changes — a render, a hit test, a lasso's
 * find, a resize, a wheel zoom that can cross a frame — and ended by one exit: the drop, a pinch (young or old), an
 * undo, a redo, a deselect, a tool change or a delete. After every event before the exit the live engine is checked:
 * no document event; `rev`, `offRev`, `addrEpoch`, the undo stack and the natives byte-equal to the press; every frame
 * of the press at its address and shift, and any new one empty (`displaced` may mint one, PLAN §3 row 8); every held
 * native drawn (`placeNative`) and every held item placed (`placed`) at its rest plus the drag's delta while the camera
 * is in the delta's frame. After a cancel, a deselect or a tool change the same, and no shadow; after any exit no drag
 * and no hold. A violation throws. `st` counts drags, events, exits and placement checks.
 */
export function heldDragOp(ctx, st) {
    const { both, ri, pick, rnd, inkPoints, w, h, O, N } = ctx;
    const EXITS = ["drop", "drop", "drop", "pinch", "pinchOld", "undo", "redo", "deselect", "tool", "delete"];
    const natives = (E) => JSON.stringify(Object.entries(E.doc.serializeNatives()).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    const frames = (E) => new Map([...E.lm.frames.values()].map((f) => [f.id, JSON.stringify([f.parent, f.cell && f.cell.i, f.cell && f.cell.j, f.shift || null, f.shadowOf || null])]));
    const fail = (why) => { throw new Error("heldDrag: " + why); };
    return ["heldDrag", 8, () => {
        const kids = [...N().lm.frames.values()].filter((f) => f.parent === N().cam.frame && N().doc.count(f.id) && O().lm.frame(f.id)).map((f) => f.id).sort();
        const ink = inkPoints();
        const how = pick(["tap", "tap", "lasso", "frame", "mixed"]);
        if (!ink.length && how !== "frame") return;
        if (how === "frame" || how === "mixed") {
            if (!kids.length) return;
            const f = pick(kids), q = ink.length ? pick(ink) : null;
            both((E) => {
                E.setTool("select");
                const id = how === "mixed" && q ? E._hitTest(q[0], q[1]) : null;
                E._setSelection(id != null && !E._underFrames(E.doc.getById(id).level, [f]) ? [id] : [], [f]);
            });
        } else if (how === "tap") {
            const p = pick(ink);
            both((E) => { E.setTool("select"); E.pointerDown(p[0], p[1]); E.pointerUp(); });
        } else {
            const x0 = ri(0, w / 2), y0 = ri(0, h / 2), x1 = x0 + ri(80, w / 2), y1 = y0 + ri(80, h / 2);
            both((E) => {
                E.setTool("select");
                E.pointerDown(x0, y0);
                for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) E.pointerMove(x, y);
                E.pointerUp();
            });
        }
        const s = N().selection;
        if (!s || !O().selection) return;
        // The press: on a selected frame's mark, or on selected ink, found in the live engine and replayed on both.
        let p = s.frames.length ? N()._levelPointToScreen(s.frames[0], 0, 0) : null;
        if (!p || p[0] < 2 || p[1] < 2 || p[0] > w - 2 || p[1] > h - 2) p = inkPoints().find((q) => N()._hitTest(q[0], q[1], undefined, (id) => N()._isSelected(id)) != null) || null;
        if (!p) return;
        const plan = [], n = ri(3, 10);
        let x = p[0] + (rnd() < 0.5 ? -1 : 1) * ri(12, 40), y = p[1] + ri(-30, 30);
        plan.push(["move", x, y]);
        for (let k = 1; k < n; k++) {
            const kind = pick(["move", "move", "move", "render", "hit", "lasso", "resize", "zoom"]);
            if (kind === "move") { x += ri(-60, 60); y += ri(-45, 45); plan.push(["move", x, y]); }
            else if (kind === "hit" || kind === "zoom") plan.push([kind, ri(20, w - 20), ri(20, h - 20), ri(-300, 300)]);
            else if (kind === "lasso") { const a = ri(0, w / 2), b = ri(0, h / 2); plan.push(["lasso", a, b, a + ri(60, w / 2), b + ri(60, h / 2)]); }
            else if (kind === "resize") plan.push(["resize", w + ri(-120, 120), h + ri(-90, 90)]);
            else plan.push([kind]);
        }
        const exit = pick(EXITS);
        st.last = { how, sel: [N().selection.ids.length, N().selection.frames.length], plan: plan.map((e) => e[0]).join(","), exit };
        const apply = (E, ev) => {
            if (ev[0] === "move") E.pointerMove(ev[1], ev[2]);
            else if (ev[0] === "render") E._render();
            else if (ev[0] === "hit") E.hitTestAt(ev[1], ev[2]);
            else if (ev[0] === "lasso") E._lassoFind([[ev[1], ev[2]], [ev[3], ev[2]], [ev[3], ev[4]], [ev[1], ev[4]]].map(([a, b]) => E.cam.screenToFrame(a, b)));
            else if (ev[0] === "resize") E.resize(ev[1], ev[2]);
            else if (ev[0] === "zoom") E.zoomAt(ev[1], ev[2], ev[3]);
        };
        both((E) => { E.flushErases(); E.pointerDown(p[0], p[1]); });
        const Nn = N(), evs = [];
        const off = Nn.doc.subscribe((ev) => evs.push(ev.kind));
        const m0 = [Nn.doc.rev, Nn.doc.offRev, Nn.lm.addrEpoch, Nn.doc._undo.length].join("|"), s0 = natives(Nn), f0 = frames(Nn);
        const inked0 = new Set([...f0.keys()].filter((id) => Nn.doc.count(id)));
        // `ended`: the gesture's end may forget an empty frame (frame GC, DESIGN.md §8), nothing else.
        const same = (when, ended = false) => {
            const own = ended ? evs.filter((k) => k !== "removeFrame") : evs;
            if (own.length) fail(when + ": document events " + own.slice(0, 6).join(","));
            const m = [Nn.doc.rev, Nn.doc.offRev, Nn.lm.addrEpoch, Nn.doc._undo.length].join("|");
            if (m !== m0) fail(when + ": rev|offRev|addrEpoch|undo " + m0 + " -> " + m);
            if (natives(Nn) !== s0) fail(when + ": the natives changed");
            const f1 = frames(Nn);
            for (const [id, a] of f0) if (f1.get(id) !== a && !(ended && !f1.has(id) && !inked0.has(id))) fail(when + ": frame " + id + " " + a + " -> " + f1.get(id));
            for (const id of f1.keys()) if (!f0.has(id) && Nn.doc.count(id)) fail(when + ": a new frame " + id + " holds natives");
        };
        const placedAtDelta = (when) => {
            const d = Nn._dragSel, hm = Nn._holdMove;
            if (!d || !d.t || !hm || String(Nn.cam.frame) !== String(d.frame)) return;
            const F = String(Nn.cam.frame), held = [...hm.ids];
            for (const k of Nn.doc.levels()) if (hm.frames.some((r) => r === k || Nn.lm.isUnder(r, k))) for (const o of Nn.doc.list(k)) held.push(o.id);
            for (const id of held.slice(0, 24)) {
                const rec = Nn.doc.getById(id);
                if (!rec) continue;
                const a = Nn.stage.placeNative(rec.obj, F).box(), b = Nn.stage.atRest(() => Nn.stage.placeNative(rec.obj, F).box());
                if (!a || !b) continue;
                const tol = 1e-9 * Math.max(1, Math.abs(b.left), Math.abs(b.top));
                if (Math.abs(a.left - b.left - d.t[0]) > tol || Math.abs(a.top - b.top - d.t[1]) > tol) fail(when + ": native " + id + " drawn at " + [a.left - b.left, a.top - b.top] + ", the delta " + d.t);
                for (const it of Nn.stage.itemsOf(id)) {
                    const q = Nn.stage.placed(it).off;
                    if (q[0] !== it.off[0] + d.t[0] || q[1] !== it.off[1] + d.t[1]) fail(when + ": item of " + id + " placed at " + q + ", rest " + it.off);
                }
                st.placeChecks = (st.placeChecks || 0) + 1;
            }
        };
        try {
            plan.forEach((ev, k) => {
                both((E) => apply(E, ev));
                same("event " + k + " (" + ev[0] + ")");
                placedAtDelta("event " + k + " (" + ev[0] + ")");
                st.events = (st.events || 0) + 1;
            });
            both((E) => {
                // The oracle's deselect, tool change and delete mid-drag kept its per-event writes, with no op; since
                // A1 C2 they write nothing (DESIGN.md §8), so the oracle's drag is cancelled first to take that rule.
                if (E === O() && (exit === "deselect" || exit === "tool" || exit === "delete")) E.cancelSelectGesture(false);
                if (exit === "drop") E.pointerUp();
                else if (exit === "pinch" || exit === "pinchOld") E.cancelSelectGesture(exit === "pinchOld");
                else if (exit === "undo") E.undo();
                else if (exit === "redo") E.redo();
                else if (exit === "deselect") E.deselect();
                else if (exit === "tool") { E.setTool("pen"); E.setTool("select"); }
                else E.deleteSelection();
                if (exit !== "drop") E.pointerUp();                         // the finger lifts after a cancel: it ends nothing
                if (E.width !== w || E.height !== h) E.resize(w, h);
            });
            if (Nn._dragSel || Nn._holdMove || Nn.stage.holding) fail("after " + exit + ": a drag or a hold remains");
            if (exit === "pinch" || exit === "deselect" || exit === "tool") {
                same("after " + exit, true);
                for (const f of Nn.lm.frames.values()) if (f.shadowOf != null || (f._shadows && f._shadows.size)) fail("after " + exit + ": a shadow at " + f.id);
            }
        } finally { off(); }
        st.drags = (st.drags || 0) + 1;
        st.exits = st.exits || {};
        st.exits[exit] = (st.exits[exit] || 0) + 1;
    }];
}
