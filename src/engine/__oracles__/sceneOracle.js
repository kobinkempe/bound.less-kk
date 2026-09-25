/**
 * sceneOracle.js — the scene index's rules by brute force (SCENES-PLAN §7.6). Every distance is
 * an all-pairs scan in a frame the pair shares, every stray run is recomputed when read, every
 * split is a full component labelling; no grids, no anchors, no origins, no caches. Positions are
 * recomputed from the records each time. `sceneIndex.test.js` drives this and `SceneIndex` with
 * the same batches and compares the scenes (members, ids, names, parents, rows) after every one.
 *
 * Test-only: production never imports `__oracles__`.
 */
import { R } from "../frameLattice";
import {
    REACH, STRAY_CHUNKS, SPREAD_OCT, FRAME_PAD, JOIN_PX, MATCH_OVERLAP, TOMB_MAX, ECHO_ZOOM, ECHO_UP, MAX_SPAN_PX, MAX_PARTS,
} from "../sceneIndex";

const LOG_R = Math.log2(R);
const fits = (lo, hi) => hi - lo <= SPREAD_OCT + 1e-9;

/** p_to = p·s + o along the tree path (up to the common ancestor, then down). */
function frameMap(frames, from, to) {
    const chain = (id) => { const out = []; let f = frames.get(id); while (f) { out.push(f); f = f.parent != null ? frames.get(f.parent) : null; } return out; };
    const a = chain(from), b = chain(to);
    if (!a.length || !b.length) return null;
    const inB = new Set(b.map((f) => f.id));
    const common = a.find((f) => inB.has(f.id));
    if (!common) return null;
    let s = 1, ox = 0, oy = 0;
    for (const f of a) { if (f.id === common.id) break; s /= R; ox = ox / R + f.cx; oy = oy / R + f.cy; }
    const down = [];
    for (const f of b) { if (f.id === common.id) break; down.push(f); }
    for (let i = down.length - 1; i >= 0; i--) { const f = down[i]; s *= R; ox = (ox - f.cx) * R; oy = (oy - f.cy) * R; }
    return { s, ox, oy };
}

export class SceneOracle {
    constructor() {
        this.frames = new Map();
        this.items = new Map();
        this.scenes = new Map();    // id -> { idn, members: Set(item) }
        this.tombs = [];
        this.clock = 0;
        this.seq = 1;
        this.batchNo = 0;
    }
    _depth(id) { const f = this.frames.get(id); return f ? f.depth : 0; }
    _geom(x, r) {
        x.raw = r.raw; x.n = (r.raw.length / 5) | 0; x.w = r.w;
        x.loops = Array.isArray(r.loops) && r.loops.length ? r.loops.filter((a) => a >= 0 && a < x.n) : null;
        x.L = Math.log2(r.w) - LOG_R * this._depth(x.home);
        let len = 0; for (let k = 0; k < x.n; k++) len += r.raw[5 * k + 4];
        x.mass = Math.max(len, r.w) / r.w;
    }
    /** x's chunk boxes and reach in frame F. */
    _in(x, F, frames = this.frames) {
        const M = frameMap(frames, x.home, F), f = frames.get(x.home);
        if (!M || !f) return null;
        const dx = x.tx + (f.sx || 0), dy = x.ty + (f.sy || 0), b = [];
        for (let k = 0; k < x.n; k++) {
            const i = 5 * k;
            b.push([(x.raw[i] + dx) * M.s + M.ox, (x.raw[i + 1] + dy) * M.s + M.oy, (x.raw[i + 2] + dx) * M.s + M.ox, (x.raw[i + 3] + dy) * M.s + M.oy]);
        }
        return { b, T: REACH * x.w * M.s };
    }
    _touch(a, ka, b, kb) {
        const F = this._depth(b.home) < this._depth(a.home) ? b.home : a.home;
        const A = this._in(a, F), B = this._in(b, F);
        if (!A || !B) return false;
        const p = A.b[ka], q = B.b[kb], T = Math.max(A.T, B.T);
        return !(q[0] - p[2] > T || p[0] - q[2] > T || q[1] - p[3] > T || p[1] - q[3] > T);
    }
    _linked(a, b) {
        for (let i = 0; i < a.n; i++) for (let j = 0; j < b.n; j++) if (this._touch(a, i, b, j)) return true;
        return false;
    }
    /** The loop chunk k of x lies in: [start, end) and closed, or the whole open sequence. */
    _loopOf(x, k) {
        if (!x.loops) return { a: 0, b: x.n, closed: false };
        let a = 0, b = x.n;
        for (let i = 0; i < x.loops.length; i++) if (x.loops[i] <= k) { a = x.loops[i]; b = i + 1 < x.loops.length ? x.loops[i + 1] : x.n; }
        return { a, b, closed: true };
    }
    /** The length of the run of `f` chunks through k (around a closed loop), 0 when f(k) is false. */
    _runLen(x, k, f) {
        if (!f(k)) return 0;
        const { a, b, closed } = this._loopOf(x, k), len = b - a;
        let n = 1;
        for (let t = 1; t < len; t++) { const q = closed ? a + ((k - a + t) % len) : k + t; if (q >= b || !f(q)) break; n++; }
        for (let t = 1; t < len && n < len; t++) { const q = closed ? a + ((k - a - t + len) % len) : k - t; if (q < a || !f(q)) break; n++; }
        return Math.min(n, len);
    }
    _valid(S, m, k) {
        if (m.n < 3 || S.members.size < 2) return true;
        const lonely = [];
        for (let i = 0; i < m.n; i++) {
            let near = false;
            for (const o of S.members) {
                if (o === m) continue;
                for (let j = 0; j < o.n && !near; j++) if (this._touch(m, i, o, j)) near = true;
                if (near) break;
            }
            lonely.push(!near);
        }
        return this._runLen(m, k, (q) => lonely[q]) < STRAY_CHUNKS;
    }
    _range(S) { let lo = Infinity, hi = -Infinity; for (const m of S.members) { lo = Math.min(lo, m.L); hi = Math.max(hi, m.L); } return [lo, hi]; }
    _mass(S) { let s = 0; for (const m of S.members) s += m.mass; return s; }
    _newIdn() { const n = this.seq++; return { id: "s" + n, seq: n, name: "Scene " + n, named: false, born: this.batchNo }; }
    _add(idn, members) { const S = { idn, members: new Set(members) }; this.scenes.set(idn.id, S); return S; }
    /** The frame, in the coarsest home: the ink less its stray runs (at least one thickest width each way), padded; no minimum. */
    frameOf(S) {
        let F = null;
        for (const m of S.members) if (F == null || this._depth(m.home) < this._depth(F) || (this._depth(m.home) === this._depth(F) && m.home < F)) F = m.home;
        if (F == null) return null;
        let all = [Infinity, Infinity, -Infinity, -Infinity], ink = [Infinity, Infinity, -Infinity, -Infinity], Tmax = 0;
        const valid = [];
        for (const m of S.members) {
            const P = this._in(m, F);
            Tmax = Math.max(Tmax, P.T);
            for (let k = 0; k < P.b.length; k++) {
                const q = P.b[k];
                all = [Math.min(all[0], q[0]), Math.min(all[1], q[1]), Math.max(all[2], q[2]), Math.max(all[3], q[3])];
                if (S.members.size > 1 && m.n >= 3 && !this._valid(S, m, k)) continue;
                ink = [Math.min(ink[0], q[0]), Math.min(ink[1], q[1]), Math.max(ink[2], q[2]), Math.max(ink[3], q[3])];
                valid.push({ q, wm: P.T / REACH });
            }
        }
        const r = Number.isFinite(ink[0]) ? ink : all;
        return { F, rect: this._pad(r, Tmax / REACH), valid, Tmax };
    }
    _pad(r, wmin) {
        let x = r[0], y = r[1], w = r[2] - r[0], h = r[3] - r[1];
        if (w < wmin) { x -= (wmin - w) / 2; w = wmin; }
        if (h < wmin) { y -= (wmin - h) / 2; h = wmin; }
        const pad = FRAME_PAD * Math.max(w, h);
        return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
    }
    /**
     * How many parts a scene gets: the full tree of cuts (each piece wider than MAX_SPAN_PX at the
     * thickest width cut at the emptiest of 32 bins over its middle 60 %), then expanded from the
     * root, the widest open piece first, while fewer than MAX_PARTS.
     */
    _partCount(S, fr) {
        if (S.members.size < 2) return 0;
        const limit = (MAX_SPAN_PX / JOIN_PX) * fr.Tmax;
        if (Math.max(fr.rect.w, fr.rect.h) <= limit) return 0;
        const pts = fr.valid.map(({ q, wm }) => ({ x0: q[0], y0: q[1], x1: q[2], y1: q[3], mass: Math.max(q[2] - q[0], q[3] - q[1], wm) / wm }));
        const node = (ps, depth) => {
            let b = [Infinity, Infinity, -Infinity, -Infinity];
            for (const q of ps) b = [Math.min(b[0], q.x0), Math.min(b[1], q.y0), Math.max(b[2], q.x1), Math.max(b[3], q.y1)];
            const w = b[2] - b[0], h = b[3] - b[1], nd = { side: Math.max(w, h), kids: null };
            if (nd.side <= limit || depth >= 12 || ps.length < 2) return nd;
            const ax = w >= h ? 0 : 1, lo = b[ax] + 0.2 * (ax ? h : w), span = 0.6 * (ax ? h : w);
            const bins = new Array(32).fill(0);
            for (const q of ps) { const i = Math.floor(((((ax ? q.y0 + q.y1 : q.x0 + q.x1) / 2) - lo) / span) * 32); if (i >= 0 && i < 32) bins[i] += q.mass; }
            let at = 0;
            for (let i = 1; i < 32; i++) if (bins[i] < bins[at] || (bins[i] === bins[at] && Math.abs(i - 16) < Math.abs(at - 16))) at = i;
            const c = lo + ((at + 0.5) / 32) * span;
            const A = ps.filter((q) => ((ax ? q.y0 + q.y1 : q.x0 + q.x1) / 2) < c), B = ps.filter((q) => ((ax ? q.y0 + q.y1 : q.x0 + q.x1) / 2) >= c);
            if (A.length && B.length) nd.kids = [node(A, depth + 1), node(B, depth + 1)];
            return nd;
        };
        let open = [node(pts, 0)], n = 1;
        const leaves = [];
        while (open.length) {
            const P = open.reduce((a, q) => (q.side > a.side ? q : a));
            open = open.filter((q) => q !== P);
            if (!P.kids || n >= MAX_PARTS) { leaves.push(P); continue; }
            open.push(...P.kids); n++;
        }
        return leaves.length < 2 ? 0 : leaves.length;
    }
    _tomb(S) {
        const fr = this.frameOf(S);
        if (!fr) return;
        const [lo, hi] = this._range(S);
        this._pushTomb({ id: S.idn.id, seq: S.idn.seq, name: S.idn.name, named: S.idn.named, anchor: fr.F, rect: fr.rect, Lmin: lo, Lmax: hi });
    }
    _pushTomb(rec) {
        if (!rec) return;
        this.tombs.push({ ...rec, t: ++this.clock });
        if (this.tombs.length > TOMB_MAX) this.tombs.splice(0, this.tombs.length - TOMB_MAX);
    }
    _winner(A, B) {
        if (A.idn.named !== B.idn.named) return A.idn.named ? A : B;
        const ma = this._mass(A), mb = this._mass(B), tol = 1e-9 * Math.max(ma, mb);
        if (Math.abs(ma - mb) > tol) return ma > mb ? A : B;
        return A.idn.seq < B.idn.seq ? A : B;
    }
    _merge(A, B) {
        const win = this._winner(A, B), lose = win === A ? B : A;
        this._tomb(lose);
        this.scenes.delete(A.idn.id); this.scenes.delete(B.idn.id);
        return this._add(win.idn, [...A.members, ...B.members]);
    }
    _sceneOf(x) { for (const S of this.scenes.values()) if (S.members.has(x)) return S; return null; }
    _insert(x) {
        const cands = [...this.scenes.values()].filter((S) => { const [lo, hi] = this._range(S); return fits(Math.min(lo, x.L), Math.max(hi, x.L)); })
            .sort((a, b) => a.idn.seq - b.idn.seq);
        const touch = [];
        let any = false;
        for (let k = 0; k < x.n; k++) {
            touch[k] = [];
            for (const S of cands) {
                let hit = false;
                for (const m of S.members) {
                    if (m === x) continue;
                    for (let j = 0; j < m.n && !hit; j++) if (this._touch(x, k, m, j) && this._valid(S, m, j)) hit = true;
                    if (hit) break;
                }
                if (hit) { touch[k].push(S); any = true; }
            }
        }
        if (!any) { this._add(this._newIdn(), [x]); return; }
        const par = []; const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
        const hits = [];
        for (let k = 0; k < x.n; k++) if (touch[k].length) { par[k] = k; hits.push(k); }
        const segs = x.loops ? x.loops.map((a0, i) => [a0, i + 1 < x.loops.length ? x.loops[i + 1] : x.n]) : [[0, x.n]];
        for (const [a0, b0] of segs) {
            const H = hits.filter((k) => k >= a0 && k < b0);
            for (let i = 0; i + 1 < H.length; i++) if (H[i + 1] - H[i] - 1 < STRAY_CHUNKS) par[find(H[i])] = find(H[i + 1]);
            if (x.loops && H.length > 1 && (b0 - H[H.length - 1] - 1) + (H[0] - a0) < STRAY_CHUNKS) par[find(H[H.length - 1])] = find(H[0]);
        }
        const byRoot = new Map();
        for (const k of hits) { const r = find(k); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(k); }
        let best = null;
        for (const g of byRoot.values()) if (!best || g.length > best.length || (g.length === best.length && Math.min(...g) < Math.min(...best))) best = g;
        const cnt = new Map();
        for (const k of best) for (const S of touch[k]) cnt.set(S, (cnt.get(S) || 0) + 1);
        const order = [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a) || a.idn.seq - b.idn.seq);
        let acc = order[0];
        let [lo, hi] = this._range(acc); lo = Math.min(lo, x.L); hi = Math.max(hi, x.L);
        for (let i = 1; i < order.length; i++) {
            const [l, h] = this._range(order[i]);
            if (!fits(Math.min(lo, l), Math.max(hi, h))) continue;
            acc = this._merge(acc, order[i]);
            lo = Math.min(lo, l); hi = Math.max(hi, h);
        }
        acc.members.add(x);
    }
    _split(S) {
        const left = new Set(S.members), comps = [];
        while (left.size) {
            const s = left.values().next().value;
            left.delete(s);
            const c = [s], q = [s];
            while (q.length) {
                const m = q.pop();
                for (const o of [...left]) if (this._linked(m, o)) { left.delete(o); c.push(o); q.push(o); }
            }
            comps.push(c);
        }
        if (comps.length < 2) return;
        const mass = (c) => c.reduce((a, m) => a + m.mass, 0), minId = (c) => Math.min(...c.map((m) => m.id));
        let bi = 0;
        for (let i = 1; i < comps.length; i++) {
            const a = mass(comps[i]), b = mass(comps[bi]), tol = 1e-9 * Math.max(a, b);
            if (a > b + tol || (Math.abs(a - b) <= tol && minId(comps[i]) < minId(comps[bi]))) bi = i;
        }
        const others = comps.map((_, i) => i).filter((i) => i !== bi).sort((a, b) => minId(comps[a]) - minId(comps[b]));
        this.scenes.delete(S.idn.id);
        this._add(S.idn, comps[bi]);
        for (const i of others) this._add(this._newIdn(), comps[i]);
    }
    _rejoin(S, own = [...S.members]) {
        const [slo, shi] = this._range(S);
        const cands = [...this.scenes.values()].filter((T) => T !== S && (() => { const [l, h] = this._range(T); return fits(Math.min(l, slo), Math.max(h, shi)); })())
            .sort((a, b) => a.idn.seq - b.idn.seq);
        let acc = S;
        for (const T of cands) {
            if (this.scenes.get(T.idn.id) !== T) continue;
            const [al, ah] = this._range(acc), [tl, th] = this._range(T);
            if (!fits(Math.min(al, tl), Math.max(ah, th))) continue;
            let hit = false;
            const A = acc;
            for (const a of own) {
                for (let i = 0; i < a.n && !hit; i++) {
                    if (!this._valid(A, a, i)) continue;
                    for (const b of T.members) { for (let j = 0; j < b.n && !hit; j++) if (this._touch(a, i, b, j) && this._valid(T, b, j)) hit = true; if (hit) break; }
                }
                if (hit) break;
            }
            if (hit) acc = this._merge(acc, T);
        }
    }
    _root() { for (const f of this.frames.values()) if (f.parent == null) return f.id; return null; }

    apply(batch = {}) {
        this.batchNo++;
        const oldFrames = new Map(this.frames);
        const movedF = new Set(), shiftedF = new Set(), goneF = new Set();
        for (const r of batch.frames || []) {
            const was = this.frames.get(r.id);
            if (r.gone) { if (was) goneF.add(r.id); this.frames.delete(r.id); continue; }
            const f = { id: r.id, parent: r.parent == null ? null : r.parent, depth: r.depth, cx: r.cx || 0, cy: r.cy || 0, sx: r.sx || 0, sy: r.sy || 0 };
            this.frames.set(r.id, f);
            if (was && (was.parent !== f.parent || was.depth !== f.depth || was.cx !== f.cx || was.cy !== f.cy)) movedF.add(r.id);
            else if (was && (was.sx !== f.sx || was.sy !== f.sy)) shiftedF.add(r.id);
        }
        const under = (id) => { let f = this.frames.get(id); while (f) { if (movedF.has(f.id)) return true; f = f.parent != null ? this.frames.get(f.parent) : null; } return false; };
        // a frame that went: what was recorded in it is carried up the old tree to a frame that stayed put
        const carry = (F, rect) => {
            let ref = F;
            while (ref != null && (!this.frames.has(ref) || under(ref))) { const f = oldFrames.get(ref); ref = f ? f.parent : null; }
            const M = ref != null ? frameMap(oldFrames, F, ref) : null;
            return M ? { F: ref, rect: { x: rect.x * M.s + M.ox, y: rect.y * M.s + M.oy, w: rect.w * M.s, h: rect.h * M.s } } : null;
        };
        if (goneF.size) {
            for (const t of this.tombs) if (goneF.has(t.anchor)) { const c = carry(t.anchor, t.rect); if (c) { t.anchor = c.F; t.rect = c.rect; } }
            for (const S of this.scenes.values()) if (S.last && goneF.has(S.last.F)) { const c = carry(S.last.F, S.last.rect); if (c) S.last = { ...S.last, F: c.F, rect: c.rect }; }
        }
        const leaving = new Map(), refile = [], inserts = new Set(), placed = new Set(), hintScene = new Map();
        const leave = (x) => { const S = this._sceneOf(x); if (!S) return; let s = leaving.get(S); if (!s) { s = new Set(); leaving.set(S, s); } s.add(x); };
        for (const r of batch.items || []) {
            if (r.attr) continue;   // z only: no geometry
            const x = this.items.get(r.id);
            if (r.gone) {
                if (!x) continue;
                const S = this._sceneOf(x);
                if (S) { hintScene.set(x.id, S); leave(x); x.gone = true; } else { inserts.delete(x); this.items.delete(x.id); }
                continue;
            }
            if (!x) {
                const nx = { id: r.id, home: r.home, tx: r.t ? r.t[0] : 0, ty: r.t ? r.t[1] : 0 };
                this._geom(nx, r);
                this.items.set(nx.id, nx);
                if (r.hint != null) refile.push([nx, r.hint]); else inserts.add(nx);
                continue;
            }
            if (x.gone) continue;
            const S0 = this._sceneOf(x);
            if (S0) hintScene.set(x.id, S0);
            const moved = x.home !== r.home || x.tx !== (r.t ? r.t[0] : 0) || x.ty !== (r.t ? r.t[1] : 0);
            x.home = r.home; x.tx = r.t ? r.t[0] : 0; x.ty = r.t ? r.t[1] : 0;
            if (r.raw && this._translated(x.raw, r.raw, x.w, r.w)) { x.raw = r.raw; x.loops = Array.isArray(r.loops) && r.loops.length ? r.loops.filter((a) => a >= 0 && a < x.n) : null; placed.add(x); continue; }
            if (r.raw || r.w !== x.w) {
                const g = { raw: r.raw || x.raw, w: r.w, loops: r.raw ? r.loops : x.loops };
                if (S0) { x.next = g; leave(x); refile.push([x, x.id]); } else this._geom(x, g);
                continue;
            }
            if (moved) placed.add(x);
        }
        if (movedF.size || shiftedF.size) for (const x of this.items.values()) if (!x.gone && this._sceneOf(x) && (shiftedF.has(x.home) || under(x.home))) placed.add(x);

        // placed items: moved whole, or the members that moved leave and come back
        const root = this._root(), rigid = [];
        const byScene = new Map();
        for (const x of placed) { const S = this._sceneOf(x); if (!S || x.gone) continue; let a = byScene.get(S); if (!a) { a = []; byScene.set(S, a); } a.push(x); }
        for (const [S, xs] of byScene) {
            const moved = [];
            let d0 = null, same = true;
            for (const x of xs) {
                const Mn = frameMap(this.frames, x.home, root), f = this.frames.get(x.home);
                const w = x.was, Mo = frameMap(oldFrames, w.home, root), fo = oldFrames.get(w.home);
                const nx = (x.raw[0] + x.tx + f.sx) * Mn.s + Mn.ox, ny = (x.raw[1] + x.ty + f.sy) * Mn.s + Mn.oy;
                const ox = (w.x + w.tx + fo.sx) * Mo.s + Mo.ox, oy = (w.y + w.ty + fo.sy) * Mo.s + Mo.oy;
                const dx = nx - ox, dy = ny - oy, tol = 1e-7 * REACH * x.w * Mn.s;
                if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) continue;
                moved.push(x);
                if (!d0) d0 = [dx, dy, tol];
                else if (Math.abs(dx - d0[0]) > Math.max(tol, d0[2]) || Math.abs(dy - d0[1]) > Math.max(tol, d0[2])) same = false;
            }
            const going = leaving.has(S) ? leaving.get(S).size : 0;
            if (moved.length && moved.length === S.members.size - going && same) { rigid.push(moved); continue; }
            for (const x of moved) { leave(x); inserts.add(x); }
        }

        // removals, pieces, splits
        const refileBy = new Map(), late = [];
        for (const [x, src] of refile) {
            const sx = this.items.get(src);
            const S = hintScene.get(src) || (sx ? this._sceneOf(sx) : null);
            if (!S) { late.push(x); continue; }
            let a = refileBy.get(S); if (!a) { a = []; refileBy.set(S, a); } a.push(x);
        }
        const touched = [...new Set([...leaving.keys(), ...refileBy.keys()])].sort((a, b) => a.idn.seq - b.idn.seq);
        const heirs = [];
        for (const S of touched) {
            for (const x of leaving.get(S) || []) {
                S.members.delete(x);
                if (x.gone) this.items.delete(x.id);
                if (x.next) { this._geom(x, x.next); x.next = null; }
            }
            const alive = this.scenes.get(S.idn.id) === S;
            const pieces = (refileBy.get(S) || []).filter((p) => !p.gone).sort((a, b) => a.id - b.id);
            for (const p of pieces) {
                if (!alive) { late.push(p); continue; }
                const [lo, hi] = this._range(S);
                if (!S.members.size || fits(Math.min(lo, p.L), Math.max(hi, p.L))) S.members.add(p); else late.push(p);
            }
            if (!alive) continue;
            if (!S.members.size) {
                // emptied: its name kept aside with its frame and range from the end of the last batch, unless
                // members that moved away gather in a scene new this batch, which takes it
                const rec = S.last ? { id: S.idn.id, seq: S.idn.seq, name: S.idn.name, named: S.idn.named, anchor: S.last.F,
                    rect: S.last.rect, Lmin: S.last.L[0], Lmax: S.last.L[1] } : null;
                const movers = [...(leaving.get(S) || [])].filter((x) => !x.gone);
                if (movers.length) heirs.push({ idn: S.idn, members: movers, rec }); else this._pushTomb(rec);
                this.scenes.delete(S.idn.id);
                continue;
            }
            this._split(S);
        }
        // a killed scene keeps its name aside: tombs for scenes that emptied, in the order they emptied
        const queue = [...inserts, ...late].filter((x) => this.items.get(x.id) === x && !x.gone && !this._sceneOf(x)).sort((a, b) => a.id - b.id);
        for (const x of queue) if (!this._sceneOf(x)) this._insert(x);
        // each scene holding ink that moved whole re-joins through that ink alone
        const groups = new Map();
        for (const ms of rigid) for (const m of ms) {
            const S = this.items.get(m.id) === m && !m.gone ? this._sceneOf(m) : null;
            if (!S) continue;
            if (!groups.has(S)) groups.set(S, []);
            groups.get(S).push(m);
        }
        for (const S of [...groups.keys()].sort((a, b) => a.idn.seq - b.idn.seq)) {
            const own = groups.get(S), T = this._sceneOf(own[0]);
            if (T) this._rejoin(T, own);
        }
        for (const h of heirs.sort((a, b) => a.idn.seq - b.idn.seq)) {
            let best = null, bm = 0, bl = Infinity;
            for (const S of this.scenes.values()) {
                const mine = h.members.filter((m) => S.members.has(m));
                if (!mine.length) continue;
                const ms = mine.reduce((a, m) => a + m.mass, 0), lo = Math.min(...mine.map((m) => m.id)), tol = 1e-9 * Math.max(ms, bm);
                if (!best || ms > bm + tol || (Math.abs(ms - bm) <= tol && lo < bl)) { best = S; bm = ms; bl = lo; }
            }
            if (best && best.idn.born === this.batchNo && !this.scenes.has(h.idn.id)) {
                this.scenes.delete(best.idn.id);
                best.idn = { ...h.idn, born: -1 };
                this.scenes.set(best.idn.id, best);
            } else this._pushTomb(h.rec);
        }
        for (const [id, name] of batch.renames || []) {
            const S = this.scenes.get(id);
            if (S && name && name.trim()) { S.idn.name = name.trim().slice(0, 120); S.idn.named = true; }
        }
        this._reclaim();
        for (const x of this.items.values()) x.was = { home: x.home, x: x.raw[0], y: x.raw[1], tx: x.tx, ty: x.ty };
        return this.result();
    }
    _translated(a, b, wa, wb) {
        if (!a || !b || a.length !== b.length || wa !== wb || !a.length) return false;
        const dx = b[0] - a[0], dy = b[1] - a[1], tol = 1e-6 * REACH * wa;
        for (let i = 0; i < a.length; i += 5) {
            if (Math.abs(b[i] - a[i] - dx) > tol || Math.abs(b[i + 2] - a[i + 2] - dx) > tol) return false;
            if (Math.abs(b[i + 1] - a[i + 1] - dy) > tol || Math.abs(b[i + 3] - a[i + 3] - dy) > tol) return false;
            if (Math.abs(b[i + 4] - a[i + 4]) > tol) return false;
        }
        return true;
    }
    _reclaim() {
        const born = [...this.scenes.values()].filter((S) => S.idn.born === this.batchNo);
        if (!born.length || !this.tombs.length) return;
        const pairs = [];
        for (const S of born) {
            const fr = this.frameOf(S);
            const [lo, hi] = this._range(S);
            for (const t of this.tombs) {
                if (!fits(Math.min(t.Lmin, lo), Math.max(t.Lmax, hi))) continue;
                const M = frameMap(this.frames, fr.F, t.anchor);
                if (!M) continue;
                const r = { x: fr.rect.x * M.s + M.ox, y: fr.rect.y * M.s + M.oy, w: fr.rect.w * M.s, h: fr.rect.h * M.s };
                const ix = Math.max(0, Math.min(t.rect.x + t.rect.w, r.x + r.w) - Math.max(t.rect.x, r.x));
                const iy = Math.max(0, Math.min(t.rect.y + t.rect.h, r.y + r.h) - Math.max(t.rect.y, r.y));
                const c = t.rect.w * t.rect.h > 0 ? Math.round(((ix * iy) / (t.rect.w * t.rect.h)) * 1e9) / 1e9 : 0;
                if (c >= MATCH_OVERLAP) pairs.push({ S, t, c });
            }
        }
        pairs.sort((a, b) => b.c - a.c || b.t.t - a.t.t || a.S.idn.seq - b.S.idn.seq);
        const usedS = new Set(), usedT = new Set();
        for (const { S, t } of pairs) {
            if (usedS.has(S) || usedT.has(t)) continue;
            if (this.scenes.has(t.id)) continue;
            usedS.add(S); usedT.add(t);
            this.scenes.delete(S.idn.id);
            S.idn = { id: t.id, seq: t.seq, name: t.name, named: t.named, born: S.idn.born };
            this.scenes.set(t.id, S);
        }
        this.tombs = this.tombs.filter((t) => !usedT.has(t));
    }
    /** `{id: {name, named, members: [ids], parent, row}}` — what the test compares; `row` the id of the panel row it is listed under. */
    result() {
        const frames = new Map();
        for (const S of this.scenes.values()) {
            const fr = this.frameOf(S);
            frames.set(S, fr);
            S.last = { F: fr.F, rect: fr.rect, L: this._range(S) };
        }
        const out = {}, parentOf = new Map();
        for (const S of this.scenes.values()) {
            const [lo, hi] = this._range(S);
            void lo;
            let best = null, bestHi = Infinity, bestSeq = Infinity;
            const fr = frames.get(S);
            for (const P of this.scenes.values()) {
                if (P === S) continue;
                const [, phi] = this._range(P);
                if (!(phi > hi)) continue;
                const pf = frames.get(P);
                const M = frameMap(this.frames, fr.F, pf.F);
                if (!M) continue;
                const cx = (fr.rect.x + fr.rect.w / 2) * M.s + M.ox, cy = (fr.rect.y + fr.rect.h / 2) * M.s + M.oy;
                if (!(cx >= pf.rect.x && cx <= pf.rect.x + pf.rect.w && cy >= pf.rect.y && cy <= pf.rect.y + pf.rect.h)) continue;
                if (phi < bestHi || (phi === bestHi && P.idn.seq < bestSeq)) { best = P; bestHi = phi; bestSeq = P.idn.seq; }
            }
            out[S.idn.id] = { name: S.idn.name, named: S.idn.named, members: [...S.members].map((m) => m.id).sort((a, b) => a - b), parent: best ? best.idn.id : null, parts: this._partCount(S, fr) };
            parentOf.set(S, best);
        }
        // rows: top-down, a scene joins the row of its nearest ancestor (ECHO_UP up) whose tightest frame
        // and its own hold each other's centres within ECHO_ZOOM, the row spanning at most 16×
        const holds = (P, S) => {
            const a = frames.get(S), b = frames.get(P);
            const M = frameMap(this.frames, a.F, b.F);
            if (!M) return false;
            const cx = (a.rect.x + a.rect.w / 2) * M.s + M.ox, cy = (a.rect.y + a.rect.h / 2) * M.s + M.oy;
            return cx >= b.rect.x && cx <= b.rect.x + b.rect.w && cy >= b.rect.y && cy <= b.rect.y + b.rect.h;
        };
        const size = (S) => { const f = frames.get(S); return Math.log2(Math.max(f.rect.w, f.rect.h)) - LOG_R * this._depth(f.F); };
        const depthOf = (S) => { let d = 0; for (let q = parentOf.get(S); q; q = parentOf.get(q)) d++; return d; };
        const order = [...this.scenes.values()].sort((a, b) => depthOf(a) - depthOf(b) || a.idn.seq - b.idn.seq);
        const rowOf = new Map(), rows = [];
        for (const S of order) {
            let R = null;
            for (let P = parentOf.get(S), g = 0; P && g < ECHO_UP; P = parentOf.get(P), g++) {
                const Q = rowOf.get(P);
                if (S.idn.named && Q.members.some((m) => m.idn.named)) continue;
                const t = Q.members.reduce((a, m) => (size(m) < size(a) ? m : a));
                const lo = Math.min(...Q.members.map(size), size(S)), hi = Math.max(...Q.members.map(size), size(S));
                if (Math.abs(size(S) - size(t)) > Math.log2(ECHO_ZOOM) + 1e-9 || hi - lo > SPREAD_OCT + 1e-9) continue;
                if (holds(t, S) && holds(S, t)) { R = Q; break; }
            }
            if (!R) { R = { members: [] }; rows.push(R); }
            R.members.push(S);
            rowOf.set(S, R);
        }
        for (const R of rows) {
            const named = R.members.find((m) => m.idn.named);
            const id = (named || R.members[0]).idn.id;
            for (const S of R.members) out[S.idn.id].row = id;
        }
        return out;
    }
}
