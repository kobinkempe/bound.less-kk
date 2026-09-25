/**
 * sceneIndex.js — the scene index (SCENES-PLAN §6/§7, v3): saved in the file, updated per batch of
 * changed objects, never re-clustered. Pure: frames and items arrive as records; `apply(batch)`
 * touches only the scenes the batch reaches and returns the scene list and the saved state. Runs
 * in the scene worker (public/scene-worker.js) and inline where there is no Worker.
 *
 * Distances are in stroke widths (`REACH`, `CHUNK`); widths compare across frames as absolute log
 * widths `L = log2(w) − 12·depth`. A scene holds widths within `ZOOM_SPREAD`. Its geometry lives in
 * its anchor frame (its coarsest home) relative to an origin, so moving a whole scene is one origin
 * change. The rules and their order: docs/reference/scenes-v3-design-bible.md; the oracle
 * `__oracles__/sceneOracle.js` implements the same rules by brute force.
 */
import { R } from "./frameLattice";

// ---- the tunable constants (SCENES-PLAN §6), one place ----
export const REF_STROKE_PX = 2.5;    // distances are px at the zoom where the stroke is this wide
export const JOIN_PX = 2250;         // ink closer than this joins
export const ZOOM_SPREAD = 16;       // a scene holds widths within 16× of each other (stroke widths, Kobin 2026-09-22)
export const CHUNK_PX = 1500;        // long objects are measured in pieces this long
export const STRAY_RUN_PX = 3000;    // a lonely stretch of one object this long is stray
export const MAX_SPAN_PX = 4500;     // a wider scene gets part records
export const MAX_PARTS = 12;         // at most this many a scene (Kobin 2026-09-23)
export const MAX_SIBLINGS = 20;      // more side-by-side scenes than this are grouped into regions
export const FRAME_PAD = 0.1;        // framing margin, of the frame's longer side
export const MATCH_OVERLAP = 0.5;    // a kept-aside name returns to a scene covering this much of its frame
export const ECHO_ZOOM = 3;          // nested scenes whose frames hold each other's centres within 3× are one row (Kobin 2026-09-23)
export const ECHO_UP = 8;            // generations up a scene looks for a row to join

export const REACH = JOIN_PX / REF_STROKE_PX;                     // 900 widths
export const CHUNK = CHUNK_PX / REF_STROKE_PX;                    // 600 widths
export const STRAY_CHUNKS = Math.round(STRAY_RUN_PX / CHUNK_PX);  // 2
export const SPREAD_OCT = Math.log2(ZOOM_SPREAD);                 // 4
export const MAX_CHUNKS = 2048;      // an item's chunk index fits 11 bits of a grid entry
export const TOMB_MAX = 256;

const LOG_R = Math.log2(R);          // 12
// A chunk is filed in its own band and the BANDS coarser ones: members of one scene are within
// SPREAD_OCT octaves, so their bands differ by at most 4.
const BANDS = Math.ceil(SPREAD_OCT) + 1;
const EPS_L = 1e-9;
// an item's numbers in SceneIndex.XD (8 a slot): its table's residual, width, absolute log width, ink
// mass, the mass and log width it was filed with, and its reach in its scene's anchor units
const XTX = 0, XTY = 1, XW = 2, XL = 3, XMASS = 4, XFMASS = 5, XFL = 6, XT = 7;
const ECHO_LOG = Math.log2(ECHO_ZOOM);
/** A frame's absolute log size (its longer side, less 12 per depth): comparable across frames. */
const frameLog = (f, depth) => Math.log2(Math.max(f.w, f.h)) - LOG_R * depth;
// Above this many seeds a split check labels the whole scene: the interleaved search's rounds cost
// the seed count each.
const SEEDS_MAX = 32;
const OFF = 2 ** 25, KEYM = 2 ** 26;
const cellIx = (v) => { const i = Math.floor(v); return i < -OFF ? -OFF : i >= OFF ? OFF - 1 : i; };
export const fitsSpread = (lo, hi) => hi - lo <= SPREAD_OCT + EPS_L;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Frame records `{id, parent, depth, cx, cy, sx, sy}` and the similarity between any two frames. */
export class FrameTable {
    constructor() { this.cur = new Map(); this.prev = null; this._maps = new Map(); this._old = new Map(); }
    get(id) { return this.cur.get(id); }
    depth(id) { const f = this.cur.get(id); return f ? f.depth : null; }
    /** Records in (a `gone` record deletes). Returns the ids whose parent or cell changed, whose shift did, and that went. */
    update(recs) {
        const moved = new Set(), shifted = new Set(), gone = new Set();
        this.prev = null;
        if (!recs || !recs.length) return { moved, shifted, gone };
        this.prev = new Map();
        for (const r of recs) {
            const was = this.cur.get(r.id) || null;
            if (r.gone) { if (was) { this.prev.set(r.id, was); this.cur.delete(r.id); gone.add(r.id); } continue; }
            const f = { id: r.id, parent: r.parent == null ? null : r.parent, depth: r.depth,
                cx: r.cx || 0, cy: r.cy || 0, sx: r.sx || 0, sy: r.sy || 0 };
            if (was && was.parent === f.parent && was.depth === f.depth && was.cx === f.cx && was.cy === f.cy) {
                if (was.sx !== f.sx || was.sy !== f.sy) { shifted.add(f.id); this.prev.set(f.id, was); this.cur.set(f.id, f); }
                continue;
            }
            this.prev.set(r.id, was);
            this.cur.set(r.id, f);
            if (was) moved.add(r.id);
        }
        this._maps.clear(); this._old.clear();
        return { moved, shifted, gone };
    }
    /** Forget the pre-batch records. */
    settle() { this.prev = null; this._old.clear(); }
    _rec(id, old) {
        if (old && this.prev && this.prev.has(id)) return this.prev.get(id);
        return this.cur.get(id);
    }
    parentOf(id, old = false) { const f = this._rec(id, old); return f ? f.parent : null; }
    /** Is `id` one of `roots` or under one (current tree)? */
    under(id, roots) {
        if (!roots || !roots.size) return false;
        let f = this.cur.get(id);
        for (let g = 0; f && g < 4096; g++) { if (roots.has(f.id)) return true; f = f.parent != null ? this.cur.get(f.parent) : null; }
        return false;
    }
    _up(id, depth, old) {
        let f = this._rec(id, old), s = 1, ox = 0, oy = 0;
        while (f && f.depth > depth) {
            if (f.parent == null) return null;
            s /= R; ox = ox / R + f.cx; oy = oy / R + f.cy;
            f = this._rec(f.parent, old);
        }
        return f && f.depth === depth ? { f, s, ox, oy } : null;
    }
    /**
     * The offset between two frames at one depth, p_b = p_a + off: Horner from the common ancestor
     * down, so two frames near each other keep every partial sum small however deep that ancestor.
     */
    _across(a, b, old) {
        const ca = [], cb = [];
        let fa = a, fb = b;
        for (let g = 0; fa !== fb; g++) {
            if (!fa || !fb || fa.parent == null || fb.parent == null || g > 4096) return null;
            ca.push(fa); cb.push(fb);
            fa = this._rec(fa.parent, old); fb = this._rec(fb.parent, old);
        }
        let ox = 0, oy = 0;
        for (let i = ca.length - 1; i >= 0; i--) { ox = (ox + ca[i].cx - cb[i].cx) * R; oy = (oy + ca[i].cy - cb[i].cy) * R; }
        return [ox, oy];
    }
    /** `p_to = p_from · s + o` (null when the frames share no root). `old`: the tree before this batch. */
    map(from, to, old = false) {
        const useOld = !!(old && this.prev && this.prev.size);
        const cache = useOld ? this._old : this._maps;
        const key = from + "\u0001" + to;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        let out = null;
        const a = this._rec(from, useOld), b = this._rec(to, useOld);
        if (a && b) {
            const d = Math.min(a.depth, b.depth);
            const A = this._up(from, d, useOld), B = this._up(to, d, useOld);
            const off = A && B ? this._across(A.f, B.f, useOld) : null;
            if (off) out = { s: A.s / B.s, ox: (A.ox + off[0] - B.ox) / B.s, oy: (A.oy + off[1] - B.oy) / B.s };
        }
        cache.set(key, out);
        return out;
    }
}

/** Sorted ids as the saved member string: base-36 gaps, a run of consecutive ids as `gap.extra`. */
export function encodeIds(ids) {
    const s = [...ids].sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        const gap = (s[i] - prev).toString(36);
        out.push(j > i ? gap + "." + (j - i).toString(36) : gap);
        prev = s[j];
        i = j + 1;
    }
    return out.join(",");
}
export function decodeIds(str, max = MAX_IDS) {
    const out = [];
    if (!str) return out;
    let prev = 0;
    for (const tok of String(str).split(",")) {
        const [g, e] = tok.split(".");
        const a = prev + parseInt(g, 36);
        const n = e ? parseInt(e, 36) : 0;
        if (!Number.isFinite(a) || !Number.isFinite(n) || n < 0 || out.length + n + 1 > max) return out;   // a bound on the whole, not a run
        for (let k = 0; k <= n; k++) out.push(a + k);
        prev = a + n;
    }
    return out;
}

/** The share of rect `t` that rect `r` covers. */
export const rectCover = (t, r) => {
    const ix = Math.max(0, Math.min(t.x + t.w, r.x + r.w) - Math.max(t.x, r.x));
    const iy = Math.max(0, Math.min(t.y + t.h, r.y + r.h) - Math.max(t.y, r.y));
    const a = t.w * t.h;
    return a > 0 ? (ix * iy) / a : 0;
};
/** Grow `bb` by n chunk boxes of pool P from offset o0 (4 per chunk). */
const grow = (bb, P, o0, n) => {
    for (let k = 0; k < n; k++) {
        const o = o0 + 4 * k;
        if (P[o] < bb[0]) bb[0] = P[o]; if (P[o + 1] < bb[1]) bb[1] = P[o + 1];
        if (P[o + 2] > bb[2]) bb[2] = P[o + 2]; if (P[o + 3] > bb[3]) bb[3] = P[o + 3];
    }
};
const EMPTY_BB = () => [Infinity, Infinity, -Infinity, -Infinity];
/** Ids one member string may name, in all (a corrupt file's runs stop here). */
export const MAX_IDS = 1e7;
/** A tag for this session's picture keys: a version reached again after an unsaved session never repeats a key. */
const newTag = () => Math.floor(Math.random() * 2176782336).toString(36);
/** A scene's picture key: its session tag and version. */
const keyOf = (S) => (S.vtag ? S.vtag + "-" : "") + S.version.toString(36);
/** A row's picture key: its scene's, or for a row of several, a hash of theirs and the frame shown. */
const rowKey = (R) => (R.members.length === 1 ? keyOf(R.S) : "e" + fnv(R.members.map(keyOf).join(".") + "|" + R.shown.idn.id));
/** FNV-1a of a string, base 36: a region's picture key from its scenes' keys. */
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/**
 * A scene's grid, packed: per band a `CellTab` (cell key → segment) for `all` and for `own`, and one
 * Uint32 pool of segments `[cap, len, entries…]`. A cell's entries keep insertion order under
 * removal (a removal shifts the rest down), as the Sets they replace did; an emptied cell stays
 * until the grid is compacted.
 */
const newGrid = () => ({ all: new Map(), own: new Map(), P: new Uint32Array(64), top: 0, waste: 0, live: 0 });
/** Open addressing, linear probing: cell keys (`(i + OFF) · KEYM + (j + OFF)`, below 2^52) → segment offsets. */
class CellTab {
    constructor(cap = 8) { this.keys = new Float64Array(cap).fill(-1); this.segs = new Int32Array(cap); this.mask = cap - 1; this.n = 0; }
    _h(key) { const hi = Math.floor(key / KEYM), lo = key - hi * KEYM; return (Math.imul(hi, 0x9E3779B1) ^ Math.imul(lo, 0x85EBCA77)) & this.mask; }
    find(key) {
        const K = this.keys;
        for (let i = this._h(key); ; i = (i + 1) & this.mask) { const k = K[i]; if (k === key) return this.segs[i]; if (k < 0) return -1; }
    }
    set(key, seg) {
        if ((this.n + 1) * 2 > this.mask + 1) this._grow();
        const K = this.keys;
        let i = this._h(key);
        while (K[i] >= 0 && K[i] !== key) i = (i + 1) & this.mask;
        if (K[i] < 0) { this.n++; K[i] = key; }
        this.segs[i] = seg;
    }
    _grow() {
        const K = this.keys, V = this.segs;
        const t = new CellTab((this.mask + 1) * 2);
        for (let i = 0; i < K.length; i++) if (K[i] >= 0) t.set(K[i], V[i]);
        this.keys = t.keys; this.segs = t.segs; this.mask = t.mask; this.n = t.n;
    }
}
/** A segment of `cap` entries at the end of G's pool. */
function segAlloc(G, cap) {
    const need = G.top + 2 + cap;
    if (need > G.P.length) { const P = new Uint32Array(Math.max(need, G.P.length * 2)); P.set(G.P.subarray(0, G.top)); G.P = P; }
    const s = G.top;
    G.P[s] = cap; G.P[s + 1] = 0; G.top = need;
    return s;
}
/** A segment's room for `len` entries after a compaction: a quarter more, so the next adds do not move it. */
const roomFor = (len) => len + (len >> 2) + 1;
/** G rebuilt without abandoned segments or empty cells, each cell with a quarter's room (entries in the same order). */
function gridCompact(G) {
    let need = 0;
    const tabs = [...G.all.values(), ...G.own.values()];
    for (const t of tabs) for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0) { const len = G.P[t.segs[i] + 1]; if (len) need += 2 + roomFor(len); }
    const P = new Uint32Array(Math.max(64, need));
    let top = 0;
    const redo = (bands) => {
        for (const [b, t] of bands) {
            let n = 0;
            for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0 && G.P[t.segs[i] + 1]) n++;
            let cap = 8; while (cap < 2 * n) cap *= 2;
            const u = new CellTab(cap);
            for (let i = 0; i < t.keys.length; i++) {
                if (t.keys[i] < 0) continue;
                const s = t.segs[i], len = G.P[s + 1];
                if (!len) continue;
                const cap = roomFor(len);
                P[top] = cap; P[top + 1] = len;
                P.set(G.P.subarray(s + 2, s + 2 + len), top + 2);
                u.set(t.keys[i], top);
                top += 2 + cap;
            }
            if (u.n) bands.set(b, u); else bands.delete(b);
        }
    };
    const old = G.P;
    redo(G.all); redo(G.own);
    void old;
    let live = 0;
    for (const t of [...G.all.values(), ...G.own.values()]) for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0) live += 2 + P[t.segs[i] + 1];
    G.P = P; G.top = top; G.waste = 0; G.live = live;
}
/** An ink box `[x0, y0, x1, y1]` as a frame: at least `wmin` (one stroke) each way, padded FRAME_PAD of its longer side. */
const padInk = (r, wmin) => {
    let x = r[0], y = r[1], w = r[2] - r[0], h = r[3] - r[1];
    if (w < wmin) { x -= (wmin - w) / 2; w = wmin; }
    if (h < wmin) { y -= (wmin - h) / 2; h = wmin; }
    const pad = FRAME_PAD * Math.max(w, h);
    return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad };
};
/**
 * A wide scene's parts: its valid chunk boxes `{x0, y0, x1, y1, mass}` cut in two at the emptiest
 * line across the long axis (a mass histogram over the middle 60 %), the widest piece first, until
 * every piece fits `limit` or there are MAX_PARTS. Leaves in the order of the cut tree.
 */
export function cutParts(pts, limit) {
    const box = (ps) => { const b = EMPTY_BB(); for (const q of ps) { if (q.x0 < b[0]) b[0] = q.x0; if (q.y0 < b[1]) b[1] = q.y0; if (q.x1 > b[2]) b[2] = q.x1; if (q.y1 > b[3]) b[3] = q.y1; } return b; };
    const side = (b) => Math.max(b[2] - b[0], b[3] - b[1]);
    const done = [], open = [{ ps: pts, b: box(pts), depth: 0, path: "" }];
    let n = 1;
    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (side(open[i].b) > side(open[bi].b)) bi = i;
        const P = open.splice(bi, 1)[0], b = P.b, w = b[2] - b[0], h = b[3] - b[1];
        if (Math.max(w, h) <= limit || P.depth >= 12 || P.ps.length < 2 || n >= MAX_PARTS) { done.push(P); continue; }
        const ax = w >= h ? 0 : 1, lo = b[ax] + 0.2 * (ax ? h : w), span = 0.6 * (ax ? h : w);
        const BINS = 32, bins = new Float64Array(BINS);
        for (const q of P.ps) {
            const c = ax ? (q.y0 + q.y1) / 2 : (q.x0 + q.x1) / 2;
            const i = Math.floor(((c - lo) / span) * BINS);
            if (i >= 0 && i < BINS) bins[i] += q.mass;
        }
        let at = 0;
        for (let i = 1; i < BINS; i++) if (bins[i] < bins[at] || (bins[i] === bins[at] && Math.abs(i - BINS / 2) < Math.abs(at - BINS / 2))) at = i;
        const cutAt = lo + ((at + 0.5) / BINS) * span;
        const A = [], B = [];
        for (const q of P.ps) ((ax ? (q.y0 + q.y1) / 2 : (q.x0 + q.x1) / 2) < cutAt ? A : B).push(q);
        if (!A.length || !B.length) { done.push(P); continue; }
        open.push({ ps: A, b: box(A), depth: P.depth + 1, path: P.path + "0" }, { ps: B, b: box(B), depth: P.depth + 1, path: P.path + "1" });
        n++;
    }
    return done.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((P) => P.b);
}
const ONE_LOOP = Object.freeze([0]);
/** A record's closed loops (first chunk of each) that lie in its `n` chunks, or null; one loop is a shared [0]. */
const loopStarts = (loops, n) => {
    if (!Array.isArray(loops) || !loops.length) return null;
    if (loops.length === 1 && loops[0] === 0) return ONE_LOOP;
    const v = loops.filter((a) => a >= 0 && a < n);
    return v.length ? v : null;
};
/**
 * The maximal runs of chunks for which `f(k)` holds: along the sequence, or — `loops` given (the
 * start of each closed loop) — around each loop, so a run crossing a loop's start is one run.
 */
export function chunkRuns(n, loops, f) {
    const out = [];
    const segs = loops && loops.length ? loops.map((a, i) => [a, i + 1 < loops.length ? loops[i + 1] : n]) : null;
    if (!segs) {
        let cur = null;
        for (let k = 0; k < n; k++) { if (f(k)) { if (!cur) { cur = []; out.push(cur); } cur.push(k); } else cur = null; }
        return out;
    }
    for (const [a, b] of segs) {
        const len = b - a;
        if (len <= 0) continue;
        let p = -1;
        for (let k = a; k < b; k++) if (!f(k)) { p = k; break; }
        if (p < 0) { const all = []; for (let k = a; k < b; k++) all.push(k); out.push(all); continue; }
        let cur = null;
        for (let t = 1; t <= len; t++) {
            const k = a + ((p - a + t) % len);
            if (f(k)) { if (!cur) { cur = []; out.push(cur); } cur.push(k); } else cur = null;
        }
    }
    return out;
}
/** One chunk entry into (or out of) the cells a box covers in band b of a grid's `all` or `own`. */
function fileIn(G, bands, b, i0, i1, j0, j1, e, add) {
    let t = bands.get(b);
    if (!t) { if (!add) return; t = new CellTab(); bands.set(b, t); }
    for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
            const key = (i + OFF) * KEYM + (j + OFF);
            let s = t.find(key);
            if (add) {
                if (s < 0) { s = segAlloc(G, 2); t.set(key, s); G.live += 2; }
                else if (G.P[s + 1] === G.P[s]) {
                    const len = G.P[s + 1], s2 = segAlloc(G, 2 * len);
                    G.P.copyWithin(s2 + 2, s + 2, s + 2 + len); G.P[s2 + 1] = len;
                    G.waste += 2 + G.P[s];
                    t.set(key, s2); s = s2;
                }
                const P = G.P;
                P[s + 2 + P[s + 1]] = e; P[s + 1]++; G.live++;
            } else if (s >= 0) {
                const P = G.P, end = s + 2 + P[s + 1];
                for (let q = s + 2; q < end; q++) if (P[q] === e) { P.copyWithin(q, q + 1, end); P[s + 1]--; G.live--; break; }
            }
        }
    }
}

export class SceneIndex {
    constructor() { this._reset(); this.seq = 1; this.ver = 1; this.pseq = 1; this.rseq = 1; this.batchNo = 0; this.seedsMax = SEEDS_MAX; this.vtag = newTag(); this.autoCompact = true; }
    /** Memory given back between batches (the worker runs it after posting a result; inline, `apply` does). */
    compact() { this._compact(); }
    _reset() {
        this.frames = new FrameTable();
        this.items = new Map();          // id -> item
        this.scenes = new Set();
        this.byId = new Map();           // scene id -> scene
        this.buckets = new Map();        // floor(L / 4) -> Set(scene)
        this.slots = [];                 // slot -> item (grid entries name slots)
        this._free = [];
        // chunk pools, per item a region: raw records (5 a chunk, home coords), filed boxes (4 a chunk,
        // anchor coords less the origin), stray flags (1 a chunk); `*W` counts what regions left behind
        this.RP = new Float64Array(1024); this.rTop = 0; this.rW = 0;
        this.LP = new Float64Array(1024); this.lTop = 0; this.lW = 0;
        this.VP = new Uint8Array(1024); this.vTop = 0; this.vW = 0;
        // per slot, an item's numbers (8 a slot: XTX, XTY, XW, XL, XMASS, XFMASS, XFL, XT): no boxed double per field
        this.XD = new Float64Array(8 * 1024);
        this.tombs = [];
        this._tombClock = 0;
        this._stamp = 0;
        this.regions = new Map();        // parent row's founder id ("" for the top) -> [{ idn, kids: Set(founder id) }]
        this.regionOf = new Map();       // row identity scene -> its region, as of the last batch
        this.rows = [];                  // the panel's rows (echo pairs folded), as of the last batch
        this.rowOf = new Map();          // scene -> its row
        this.stats = { queries: 0, cells: 0, entries: 0 };
    }

    // ------------------------------------------------------------------ items
    _depth(id) { const d = this.frames.depth(id); return d == null ? 0 : d; }
    /** Room in the raw pool and the number column for a batch's new items, in one allocation each. */
    _reserve(items) {
        let floats = 0, fresh = 0;
        for (const r of items || []) if (r.raw && !r.gone && !this.items.has(r.id)) { floats += 5 * Math.min((r.raw.length / 5) | 0, MAX_CHUNKS); fresh++; }
        if (!fresh) return;
        if (this.rTop + floats > this.RP.length) { const Q = new Float64Array(this.rTop + floats + (this.rTop >> 3)); Q.set(this.RP.subarray(0, this.rTop)); this.RP = Q; }
        const slots = 8 * (this.slots.length + fresh);
        if (slots > this.XD.length) { const D = new Float64Array(slots + (slots >> 3)); D.set(this.XD); this.XD = D; }
    }
    /** A region of `n` in a pool (`R`, `L` or `V`), the pool grown by doubling. */
    _alloc(which, n) {
        const P = which === "R" ? this.RP : which === "L" ? this.LP : this.VP;
        const top = which === "R" ? this.rTop : which === "L" ? this.lTop : this.vTop;
        if (top + n > P.length) {
            const Q = new P.constructor(Math.max(top + n, P.length * 2));
            Q.set(P.subarray(0, top));
            if (which === "R") this.RP = Q; else if (which === "L") this.LP = Q; else this.VP = Q;
        }
        if (which === "R") this.rTop = top + n; else if (which === "L") this.lTop = top + n; else this.vTop = top + n;
        return top;
    }
    /** New geometry `r` ({raw, w, loops}); `raw` null keeps the chunks (a width change). */
    _setGeom(x, r) {
        if (r.raw) {
            const n = Math.min((r.raw.length / 5) | 0, MAX_CHUNKS);
            if (x.ro < 0 || n !== x.n) { if (x.ro >= 0) this.rW += 5 * x.n; x.ro = this._alloc("R", 5 * n); }
            x.n = n;
            this.RP.set(r.raw.subarray ? r.raw.subarray(0, 5 * n) : r.raw.slice(0, 5 * n), x.ro);
        }
        this.XD[x.slot * 8 + XW] = r.w;
        x.loops = loopStarts(r.loops, x.n);   // closed loops' first chunks
        this.XD[x.slot * 8 + XL] = Math.log2(r.w) - LOG_R * this._depth(x.home);
        const RP = this.RP;
        let len = 0;
        for (let k = 0; k < x.n; k++) len += RP[x.ro + 5 * k + 4];
        this.XD[x.slot * 8 + XMASS] = Math.max(len, r.w) / r.w;   // the outline's length in pen widths: scale-free
    }
    _mkItem(r) {
        const x = { id: r.id, slot: 0, home: r.home, ro: -1, n: 0, scene: null, lo: -1, fn: 0, band: 0, vo: -1, vn: 0,
            validOk: false, next: null, loops: null, gone: false };
        x.slot = this._free.length ? this._free.pop() : this.slots.length;
        this.slots[x.slot] = x;
        if (8 * (x.slot + 1) > this.XD.length) { const D = new Float64Array(Math.max(8 * (x.slot + 1), 2 * this.XD.length)); D.set(this.XD); this.XD = D; }
        this.XD.fill(0, 8 * x.slot, 8 * x.slot + 8);
        this.XD[8 * x.slot + XW] = 1; this.XD[8 * x.slot + XT] = 1;
        if (r.t) { this.XD[x.slot * 8 + XTX] = r.t[0]; this.XD[x.slot * 8 + XTY] = r.t[1]; }
        this._setGeom(x, r);
        this.items.set(x.id, x);
        return x;
    }
    _dropItem(x) {
        if (this.items.get(x.id) === x) this.items.delete(x.id);
        this.slots[x.slot] = null; this._free.push(x.slot);
        this.rW += 5 * x.n; if (x.lo >= 0) this.lW += 4 * x.fn; if (x.vo >= 0) this.vW += x.vn;
    }
    /** x's filed boxes: a region of the loc pool sized to its chunks (reused when they match). */
    _locFor(x) {
        if (x.lo < 0 || x.fn !== x.n) { if (x.lo >= 0) this.lW += 4 * x.fn; x.lo = this._alloc("L", 4 * x.n); }
        return x.lo;
    }
    /** `x`'s drawn chunk boxes in `anchor` coords less the origin, into `out` from `oo`; the similarity used, or null. */
    _boxesIn(x, anchor, out, oo, ox, oy) {
        const M = this.frames.map(x.home, anchor);
        const f = this.frames.get(x.home);
        if (!M || !f) return null;
        const dx = this.XD[x.slot * 8 + XTX] + f.sx, dy = this.XD[x.slot * 8 + XTY] + f.sy, raw = this.RP, r0 = x.ro;
        for (let k = 0; k < x.n; k++) {
            const i = r0 + 5 * k, o = oo + 4 * k;
            out[o] = (raw[i] + dx) * M.s + M.ox - ox; out[o + 1] = (raw[i + 1] + dy) * M.s + M.oy - oy;
            out[o + 2] = (raw[i + 2] + dx) * M.s + M.ox - ox; out[o + 3] = (raw[i + 3] + dy) * M.s + M.oy - oy;
        }
        return M;
    }
    /** The item's drawn box in its own home. */
    _homeBox(x) {
        const f = this.frames.get(x.home);
        const dx = this.XD[x.slot * 8 + XTX] + (f ? f.sx : 0), dy = this.XD[x.slot * 8 + XTY] + (f ? f.sy : 0), raw = this.RP;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = 0; k < x.n; k++) {
            const i = x.ro + 5 * k;
            if (raw[i] < x0) x0 = raw[i]; if (raw[i + 1] < y0) y0 = raw[i + 1];
            if (raw[i + 2] > x1) x1 = raw[i + 2]; if (raw[i + 3] > y1) y1 = raw[i + 3];
        }
        return [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    }
    /** Copies of an item's regions (tests and probes). */
    _rawOf(x) { return this.RP.slice(x.ro, x.ro + 5 * x.n); }
    _locOf(x) { return x.lo < 0 ? null : this.LP.slice(x.lo, x.lo + 4 * x.fn); }
    _validOf(x) { return x.vo < 0 ? null : this.VP.slice(x.vo, x.vo + x.vn); }
    /**
     * The pools rebuilt without what regions left behind (and a doubled pool trimmed), each item's
     * regions in slot order; every grid holding more garbage than entries compacted. Between batches.
     */
    _compact(force = false) {
        const live = (top, w) => top - w;
        const pools = [["R", this.rTop, this.rW], ["L", this.lTop, this.lW], ["V", this.vTop, this.vW]];
        for (const [which, top, w] of pools) {
            const P = which === "R" ? this.RP : which === "L" ? this.LP : this.VP;
            const used = live(top, w);
            if (!force && !(w > used || (P.length > 4096 && P.length > 1.5 * used))) continue;
            const Q = new P.constructor(Math.max(1024, Math.ceil(used * 1.125)));
            let at = 0;
            for (const x of this.slots) {
                if (!x) continue;
                if (which === "R") { Q.set(P.subarray(x.ro, x.ro + 5 * x.n), at); x.ro = at; at += 5 * x.n; }
                else if (which === "L") { if (x.lo >= 0) { Q.set(P.subarray(x.lo, x.lo + 4 * x.fn), at); x.lo = at; at += 4 * x.fn; } }
                else if (x.vo >= 0) { Q.set(P.subarray(x.vo, x.vo + x.vn), at); x.vo = at; at += x.vn; }
            }
            if (which === "R") { this.RP = Q; this.rTop = at; this.rW = 0; }
            else if (which === "L") { this.LP = Q; this.lTop = at; this.lW = 0; }
            else { this.VP = Q; this.vTop = at; this.vW = 0; }
        }
        for (const S of this.scenes) for (const G of [S.grid, S.mgrid]) if (force || (G.P.length > 256 && G.P.length > 2 * G.live)) gridCompact(G);
        const want = 8 * this.slots.length;
        if (force || (this.XD.length > 8192 && this.XD.length > 1.5 * want)) { const D = new Float64Array(Math.ceil(want * 1.125)); D.set(this.XD.subarray(0, want)); this.XD = D; }
    }

    // ------------------------------------------------------------------ grids
    /**
     * A scene's grid, per band b (cell side 2^(b+1), at least any reach in the band): `all` holds the
     * chunks of bands b−5..b, what a query from band b must see; `own` the chunks of band b alone,
     * what a query from a finer band must see. Kept apart, a query never walks a coarse cell only to
     * skip what was filed up into it — in a dense drawing that cell holds the whole scene.
     */
    _cells(S, x, add) {
        this._cellsIn(S.grid, x, add);
        if (x.fn >= 3) this._cellsIn(S.mgrid, x, add);
    }
    /** The entries of `xs` out of grid G, each touched cell rewritten once, the rest in order. */
    _cellsOut(G, xs) {
        if (!xs.length) return;
        if (!this._out || this._out.length < this.slots.length) this._out = new Uint8Array(this.slots.length * 2);
        const out = this._out, leavers = xs;
        for (const x of xs) out[x.slot] = 1;
        const L = this.LP, hit = new Set();   // the segments to rewrite
        let work = 0;
        for (const x of xs) work += x.fn * (BANDS + 2);
        if (work * 4 > G.live) {
            // leavers' cells would cost more to find than every cell of the grid costs to rewrite
            for (const t of [...G.all.values(), ...G.own.values()]) for (let i = 0; i < t.keys.length; i++) if (t.keys[i] >= 0) hit.add(t.segs[i]);
            xs = [];
        }
        const note = (t, i0, i1, j0, j1) => {
            if (!t) return;
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const s = t.find((i + OFF) * KEYM + (j + OFF)); if (s >= 0) hit.add(s); }
        };
        for (const x of xs) {
            for (let k = 0; k < x.fn; k++) {
                const o = x.lo + 4 * k;
                for (let b = x.band; b <= x.band + BANDS; b++) {
                    const inv = 1 / 2 ** (b + 1);
                    const i0 = cellIx(L[o] * inv), i1 = cellIx(L[o + 2] * inv), j0 = cellIx(L[o + 1] * inv), j1 = cellIx(L[o + 3] * inv);
                    note(G.all.get(b), i0, i1, j0, j1);
                    if (b === x.band) note(G.own.get(b), i0, i1, j0, j1);
                }
            }
        }
        const P = G.P;
        for (const s of hit) {
            const end = s + 2 + P[s + 1];
            let w = s + 2;
            for (let q = s + 2; q < end; q++) { const e = P[q]; if (!out[(e / MAX_CHUNKS) | 0]) P[w++] = e; }
            G.live -= end - w; P[s + 1] = w - s - 2;
        }
        for (const x of leavers) out[x.slot] = 0;
    }
    _cellsIn(G, x, add) {
        const loc = this.LP, l0 = x.lo;
        for (let k = 0; k < x.fn; k++) {
            const o = l0 + 4 * k, e = x.slot * MAX_CHUNKS + k;
            for (let b = x.band; b <= x.band + BANDS; b++) {
                const inv = 1 / 2 ** (b + 1);
                const i0 = cellIx(loc[o] * inv), i1 = cellIx(loc[o + 2] * inv), j0 = cellIx(loc[o + 1] * inv), j1 = cellIx(loc[o + 3] * inv);
                fileIn(G, G.all, b, i0, i1, j0, j1, e, add);
                if (b === x.band) fileIn(G, G.own, b, i0, i1, j0, j1, e, add);
            }
        }
    }
    /**
     * Every chunk of `S` within reach of the box (local coords): reach is max(T, the chunk's own),
     * `b` the querying band. `fn(item, k)` returns true to stop; returns whether it stopped.
     */
    _near(S, x0, y0, x1, y1, T, b, fn, G = S.grid, full = null) {
        this.stats.queries++;
        if (this._scan(G, G.all.get(b), b, x0, y0, x1, y1, T, fn, full && full.all.get(b))) return true;
        for (let bb = b + 1; bb <= b + BANDS; bb++) if (this._scan(G, G.own.get(bb), bb, x0, y0, x1, y1, T, fn, full && full.own.get(bb))) return true;
        return false;
    }
    /** One band's cells in the window; `seen` (key -> entries already visited) skips a cell with nothing new. */
    _scan(G, t, bb, x0, y0, x1, y1, T, fn, seen) {
        if (!t || !t.n) return false;
        const slots = this.slots, L = this.LP, P = G.P, XD = this.XD;
        const side = 2 ** (bb + 1), inv = 1 / side;
        const i0 = cellIx((x0 - side) * inv), i1 = cellIx((x1 + side) * inv);
        const j0 = cellIx((y0 - side) * inv), j1 = cellIx((y1 + side) * inv);
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                this.stats.cells++;
                const key = (i + OFF) * KEYM + (j + OFF);
                const s = t.find(key);
                if (s < 0) continue;
                const len = P[s + 1];
                if (!len || (seen && seen.get(key) >= len)) continue;
                for (let q = s + 2, end = s + 2 + len; q < end; q++) {
                    const e = P[q], sl = Math.floor(e / MAX_CHUNKS);
                    const m = slots[sl];
                    this.stats.entries++;
                    const o = m.lo + 4 * (e % MAX_CHUNKS), mT = XD[sl * 8 + XT];
                    const TT = mT > T ? mT : T;
                    if (L[o] - x1 > TT || x0 - L[o + 2] > TT || L[o + 1] - y1 > TT || y0 - L[o + 3] > TT) continue;
                    if (fn(m, e % MAX_CHUNKS)) return true;
                }
            }
        }
        return false;
    }
    /** Is chunk k of member m outside a stray run (a run of STRAY_CHUNKS lonely chunks)? A one-member scene has none. */
    _valid(S, m, k) {
        if (m.fn < 3 || S.members.size < 2) return true;
        if (!m.validOk) this._computeValid(S, m);
        return this.VP[m.vo + k] === 1;
    }
    _computeValid(S, m) {
        const n = m.fn, lonely = new Uint8Array(n), loc = this.LP;
        const other = (q) => q !== m;
        for (let k = 0; k < n; k++) {
            const o = m.lo + 4 * k;
            lonely[k] = this._near(S, loc[o], loc[o + 1], loc[o + 2], loc[o + 3], this.XD[m.slot * 8 + XT], m.band, other) ? 0 : 1;
        }
        if (m.vo < 0 || m.vn !== n) { if (m.vo >= 0) this.vW += m.vn; m.vo = this._alloc("V", n); m.vn = n; }
        const V = this.VP, v0 = m.vo;
        V.fill(1, v0, v0 + n);
        for (const run of chunkRuns(n, m.loops, (k) => lonely[k] === 1)) if (run.length >= STRAY_CHUNKS) for (const q of run) V[v0 + q] = 0;
        m.validOk = true;
    }
    /**
     * Multi-chunk members within reach of x's chunks have their stray runs recomputed when next read.
     * Asked of the multi-chunk grid only: over every chunk it was 30.6 M of the Magnum Opus build's
     * 30.8 M grid entries (dense stippling, hundreds of dots within reach of each).
     */
    _invalidateNear(S, x) {
        if (!S.multi) return;
        const loc = this.LP;
        const drop = (m) => { m.validOk = false; return false; };
        for (let k = 0; k < x.fn; k++) {
            const o = x.lo + 4 * k;
            this._near(S, loc[o], loc[o + 1], loc[o + 2], loc[o + 3], this.XD[x.slot * 8 + XT], x.band, drop, S.mgrid);
        }
    }

    // ------------------------------------------------------------------ scenes
    _mkScene(anchor, idn) {
        const S = {
            idn: idn || this._newIdn(), anchor, ox: 0, oy: 0,
            members: new Set(), Lmin: Infinity, Lmax: -Infinity, rangeDirty: false, mass: 0,
            bb: EMPTY_BB(), grid: newGrid(), mgrid: newGrid(), version: this.ver++, vtag: this.vtag, multi: 0,
            frame: null, frameDirty: true, lost: false, mStr: null, bk: null, parent: null, _stamp: 0,
        };
        this.scenes.add(S);
        this.byId.set(S.idn.id, S);
        return S;
    }
    _newIdn() {
        const n = this.seq++;
        return { id: "s" + n, seq: n, name: "Scene " + n, named: false, born: this.batchNo };
    }
    _setIdn(S, idn) {
        if (this.byId.get(S.idn.id) === S) this.byId.delete(S.idn.id);
        S.idn = idn;
        this.byId.set(idn.id, S);
    }
    _drop(S) {
        this.scenes.delete(S);
        if (this.byId.get(S.idn.id) === S) this.byId.delete(S.idn.id);
        this._rebucket(S, true);
    }
    _rebucket(S, gone = false) {
        const k0 = gone ? NaN : Math.floor(S.Lmin / 4), k1 = gone ? NaN : Math.floor(S.Lmax / 4);
        const had = S.bk;
        if (had && had[0] === k0 && had[1] === k1) return;
        if (had) for (let k = had[0]; k <= had[1]; k++) { const set = this.buckets.get(k); if (set) { set.delete(S); if (!set.size) this.buckets.delete(k); } }
        S.bk = null;
        if (!Number.isFinite(k0) || !Number.isFinite(k1)) return;
        for (let k = k0; k <= k1; k++) { let set = this.buckets.get(k); if (!set) { set = new Set(); this.buckets.set(k, set); } set.add(S); }
        S.bk = [k0, k1];
    }
    _range(S) {
        if (!S.rangeDirty) return;
        let lo = Infinity, hi = -Infinity;
        for (const m of S.members) { if (this.XD[m.slot * 8 + XL] < lo) lo = this.XD[m.slot * 8 + XL]; if (this.XD[m.slot * 8 + XL] > hi) hi = this.XD[m.slot * 8 + XL]; }
        S.Lmin = lo; S.Lmax = hi; S.rangeDirty = false;
        this._rebucket(S);
    }
    _touched(S) { S.version = this.ver++; S.vtag = this.vtag; S.frameDirty = true; S.mStr = null; }
    /**
     * File x into S at its current position (re-anchoring S when x is homed coarser); false when no
     * map joins them. `quiet`: the neighbours' stray runs are not invalidated (a restore, where none
     * is computed yet; a merge or a split, which settle them wholesale).
     */
    _file(S, x, quiet = false) {
        if (this._depth(x.home) < this._depth(S.anchor)) {
            if (S.members.size) this._reanchor(S, x.home);
            else {
                const M = this.frames.map(S.anchor, x.home);
                if (M) { S.ox = S.ox * M.s + M.ox; S.oy = S.oy * M.s + M.oy; }
                S.anchor = x.home; S.bb = EMPTY_BB();
            }
        }
        const lo = this._locFor(x);
        const M = this._boxesIn(x, S.anchor, this.LP, lo, S.ox, S.oy);
        if (!M) return false;
        x.fn = x.n; this.XD[x.slot * 8 + XFMASS] = this.XD[x.slot * 8 + XMASS]; this.XD[x.slot * 8 + XFL] = this.XD[x.slot * 8 + XL];
        this.XD[x.slot * 8 + XT] = REACH * this.XD[x.slot * 8 + XW] * M.s; x.band = Math.floor(Math.log2(this.XD[x.slot * 8 + XT]));
        this._cells(S, x, true);
        S.members.add(x); x.scene = S;
        S.mass += this.XD[x.slot * 8 + XMASS];
        if (x.fn >= 3) { S.multi++; x.validOk = false; }
        if (!S.rangeDirty && (this.XD[x.slot * 8 + XL] < S.Lmin || this.XD[x.slot * 8 + XL] > S.Lmax)) {
            S.Lmin = Math.min(S.Lmin, this.XD[x.slot * 8 + XL]); S.Lmax = Math.max(S.Lmax, this.XD[x.slot * 8 + XL]);
            this._rebucket(S);
        }
        grow(S.bb, this.LP, x.lo, x.fn);
        if (!quiet) this._invalidateNear(S, x);
        this._touched(S);
        return true;
    }
    _unfile(S, x) {
        this._invalidateNear(S, x);
        this._cells(S, x, false);
        this._unfiled(S, x);
    }
    /**
     * Many members out of S at once, each touched cell rewritten once. The leavers go from the
     * stray-flag grid first, so the invalidating scans see only who stays (the stays they mark are
     * those of one-by-one removal; none when no multi-chunk member stays).
     */
    _unfileMany(S, xs) {
        if (xs.length === S.members.size) {
            S.grid = newGrid(); S.mgrid = newGrid();   // all leave: nobody's flags to reset, the grids go whole
        } else {
            const multi = xs.filter((x) => x.fn >= 3);
            this._cellsOut(S.mgrid, multi);
            if (S.multi - multi.length > 0) for (const x of xs) this._invalidateNear(S, x);
            this._cellsOut(S.grid, xs);
        }
        for (const x of xs) this._unfiled(S, x);
    }
    /** The bookkeeping of x leaving S (its cells already out). */
    _unfiled(S, x) {
        S.members.delete(x); x.scene = null;
        S.mass -= this.XD[x.slot * 8 + XFMASS];
        if (x.fn >= 3) S.multi--;
        if (this.XD[x.slot * 8 + XFL] <= S.Lmin || this.XD[x.slot * 8 + XFL] >= S.Lmax) S.rangeDirty = true;
        S.lost = true;
        this._touched(S);
    }
    /** Re-file every member of S in `anchor`: at its filed position, or (`fresh`) where it now is. */
    _reanchor(S, anchor, fresh = false) {
        const M = this.frames.map(S.anchor, anchor);
        // the last frame follows into the new anchor (a kept-aside name is recorded in it)
        const Mf = fresh ? this.frames.map(S.anchor, anchor, true) : M;
        if (S.frame) S.frame = Mf ? { x: S.frame.x * Mf.s + Mf.ox, y: S.frame.y * Mf.s + Mf.oy, w: S.frame.w * Mf.s, h: S.frame.h * Mf.s } : null;
        S.anchor = anchor; S.grid = newGrid(); S.mgrid = newGrid(); S.bb = EMPTY_BB();   // the old grids go whole
        if (fresh || !M) {
            const first = S.members.values().next().value;
            const Mh = first ? this.frames.map(first.home, anchor) : null;
            const b = first ? this._homeBox(first) : [0, 0];
            S.ox = Mh ? b[0] * Mh.s + Mh.ox : 0; S.oy = Mh ? b[1] * Mh.s + Mh.oy : 0;
        } else { S.ox = S.ox * M.s + M.ox; S.oy = S.oy * M.s + M.oy; }
        for (const m of S.members) {
            const lo = this._locFor(m);
            const MM = this._boxesIn(m, anchor, this.LP, lo, S.ox, S.oy);
            if (!MM) continue;
            m.fn = m.n; this.XD[m.slot * 8 + XT] = REACH * this.XD[m.slot * 8 + XW] * MM.s; m.band = Math.floor(Math.log2(this.XD[m.slot * 8 + XT]));
            this._cells(S, m, true);
            grow(S.bb, this.LP, m.lo, m.fn);
            if (fresh) m.validOk = false;
        }
        S.frameDirty = true;
    }
    /**
     * S's anchor went (a shadow merged into its resident, SUBTREE-O1-PLAN §2.5): re-filed in `target`
     * through the pre-batch tree, every member at its filed position, so the placement that follows
     * sees who moved. Where no map joins them, where the members are now.
     */
    _reanchorOld(S, target) {
        const M = this.frames.map(S.anchor, target, true);
        if (!M) { this._reanchor(S, target, true); return; }
        S.anchor = target; S.grid = newGrid(); S.mgrid = newGrid();   // the old grids go whole
        S.ox = S.ox * M.s + M.ox; S.oy = S.oy * M.s + M.oy;
        if (S.frame) S.frame = { x: S.frame.x * M.s + M.ox, y: S.frame.y * M.s + M.oy, w: S.frame.w * M.s, h: S.frame.h * M.s };
        S.bb = EMPTY_BB();
        for (const m of S.members) {
            const loc = this.LP;
            for (let i = m.lo; i < m.lo + 4 * m.fn; i++) loc[i] *= M.s;
            this.XD[m.slot * 8 + XT] *= M.s; m.band = Math.floor(Math.log2(this.XD[m.slot * 8 + XT]));
            this._cells(S, m, true);
            grow(S.bb, loc, m.lo, m.fn);
        }
        S.frameDirty = true;
    }
    /** A frame of the pre-batch tree, walked up while it went or moved: where a displacement is measured. */
    _staticRef(id, moved) {
        let ref = id;
        for (let g = 0; g < 4096 && ref != null && (!this.frames.get(ref) || this.frames.under(ref, moved)); g++) ref = this.frames.parentOf(ref, true);
        return ref;
    }
    /** Frames that went this batch: scenes anchored there re-anchored, names kept aside there remapped. */
    _framesGone(gone, moved) {
        if (!gone.size) return;
        for (const S of this.scenes) {
            if (!gone.has(S.anchor)) continue;
            const ref = this._staticRef(S.anchor, moved);
            if (ref != null) this._reanchorOld(S, ref);
        }
        for (const t of this.tombs) {
            if (!gone.has(t.anchor)) continue;
            const ref = this._staticRef(t.anchor, moved);
            const M = ref != null ? this.frames.map(t.anchor, ref, true) : null;
            if (!M) continue;
            t.anchor = ref;
            t.rect = { x: t.rect.x * M.s + M.ox, y: t.rect.y * M.s + M.oy, w: t.rect.w * M.s, h: t.rect.h * M.s };
        }
    }
    _newScene(x) {
        const S = this._mkScene(x.home);
        const b = this._homeBox(x);
        S.ox = b[0]; S.oy = b[1];
        if (!this._file(S, x)) { this._drop(S); return null; }
        return S;
    }
    /** Scenes x may join: the range with x within the spread, the box within the larger reach. */
    _candidates(x) {
        const out = [];
        const stamp = ++this._stamp;
        const k0 = Math.floor((this.XD[x.slot * 8 + XL] - SPREAD_OCT) / 4), k1 = Math.floor((this.XD[x.slot * 8 + XL] + SPREAD_OCT) / 4);
        const xb = this._homeBox(x), dH = this._depth(x.home);
        for (let k = k0; k <= k1; k++) {
            const set = this.buckets.get(k);
            if (!set) continue;
            for (const S of set) {
                if (S._stamp === stamp) continue;
                S._stamp = stamp;
                if (!S.members.size || !fitsSpread(Math.min(S.Lmin, this.XD[x.slot * 8 + XL]), Math.max(S.Lmax, this.XD[x.slot * 8 + XL]))) continue;
                const M = this.frames.map(S.anchor, x.home);
                if (!M) continue;
                const g = REACH * 2 ** (Math.max(S.Lmax, this.XD[x.slot * 8 + XL]) + LOG_R * dH);
                const bx0 = (S.bb[0] + S.ox) * M.s + M.ox, by0 = (S.bb[1] + S.oy) * M.s + M.oy;
                const bx1 = (S.bb[2] + S.ox) * M.s + M.ox, by1 = (S.bb[3] + S.oy) * M.s + M.oy;
                if (bx0 - g > xb[2] || xb[0] - g > bx1 || by0 - g > xb[3] || xb[1] - g > by1) continue;
                out.push(S);
            }
        }
        return out;
    }
    /**
     * The insert rule (bible §2): x's chunks against the valid chunks of every compatible scene;
     * x's chunk sequence split at runs of STRAY_CHUNKS untouched chunks; the group touching most
     * (the first, on a tie) decides; its scenes merge greedily by contact while the range fits,
     * and x joins. Touching nothing: a new scene.
     */
    _insert(x) {
        const cands = this._candidates(x);
        let touch = null;
        if (cands.length) {
            const buf = new Float64Array(4 * x.n);
            for (const S of cands) {
                const M = this._boxesIn(x, S.anchor, buf, 0, S.ox, S.oy);
                if (!M) continue;
                const T = REACH * this.XD[x.slot * 8 + XW] * M.s, b = Math.floor(Math.log2(T));
                const ok = (m, k) => m !== x && this._valid(S, m, k);
                for (let k = 0; k < x.n; k++) {
                    const o = 4 * k;
                    if (this._near(S, buf[o], buf[o + 1], buf[o + 2], buf[o + 3], T, b, ok)) {
                        if (!touch) touch = new Array(x.n);
                        (touch[k] || (touch[k] = [])).push(S);
                    }
                }
            }
        }
        if (!touch) return this._newScene(x);
        // the chunks between runs of STRAY_CHUNKS untouched ones (around each loop) are a group
        const brk = new Uint8Array(x.n);
        for (const run of chunkRuns(x.n, x.loops, (k) => !touch[k])) if (run.length >= STRAY_CHUNKS) for (const q of run) brk[q] = 1;
        let best = null, bestMin = Infinity;
        for (const run of chunkRuns(x.n, x.loops, (k) => !brk[k])) {
            const g = run.filter((k) => touch[k]);
            if (!g.length) continue;
            const mi = Math.min(...g);
            if (!best || g.length > best.length || (g.length === best.length && mi < bestMin)) { best = g; bestMin = mi; }
        }
        const cnt = new Map();
        for (const k of best) for (const S of touch[k]) cnt.set(S, (cnt.get(S) || 0) + 1);
        const order = [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a) || a.idn.seq - b.idn.seq);
        let acc = order[0], lo = Math.min(acc.Lmin, this.XD[x.slot * 8 + XL]), hi = Math.max(acc.Lmax, this.XD[x.slot * 8 + XL]);
        for (let i = 1; i < order.length; i++) {
            const S = order[i];
            if (!this.scenes.has(S)) continue;
            const l2 = Math.min(lo, S.Lmin), h2 = Math.max(hi, S.Lmax);
            if (!fitsSpread(l2, h2)) continue;
            acc = this._merge(acc, S);
            lo = l2; hi = h2;
        }
        if (!this._file(acc, x)) return this._newScene(x);
        return acc;
    }
    /** Which identity survives a merge: the renamed one if only one was, else the one with more ink, else the older. */
    _idWinner(A, B) {
        if (A.idn.named !== B.idn.named) return A.idn.named ? A : B;
        const tol = 1e-9 * Math.max(A.mass, B.mass);
        if (Math.abs(A.mass - B.mass) > tol) return A.mass > B.mass ? A : B;
        return A.idn.seq < B.idn.seq ? A : B;
    }
    /** A and B become one: the deeper anchor's members move (tie: fewer; tie: the younger's); the loser's name is kept aside. */
    _merge(A, B) {
        const dA = this._depth(A.anchor), dB = this._depth(B.anchor);
        let dst = A, src = B;
        if (dB < dA || (dB === dA && (B.members.size > A.members.size
            || (B.members.size === A.members.size && B.idn.seq < A.idn.seq)))) { dst = B; src = A; }
        const win = this._idWinner(A, B), lose = win === A ? B : A;
        this._tomb(lose);
        const winIdn = win.idn;
        this._drop(src);
        if (dst.idn !== winIdn) this._setIdn(dst, winIdn);
        for (const m of [...src.members]) { src.members.delete(m); m.scene = null; this._file(dst, m, true); }   // src's grids go whole
        for (const m of dst.members) if (m.fn >= 3) m.validOk = false;
        this._range(dst);
        this._touched(dst);
        return dst;
    }
    /** A name kept aside: a live scene's current frame and range, an emptied one's from the end of the last batch. */
    _tomb(S) { this._pushTomb(this._tombRecord(S)); }
    _tombRecord(S) {
        const live = S.members.size > 0;
        const fr = live && (S.frameDirty || !S.frame) ? this._frameOf(S) : S.frame;
        if (!fr) return null;
        const L = live ? [S.Lmin, S.Lmax] : S.frameL || [S.Lmin, S.Lmax];
        return { id: S.idn.id, seq: S.idn.seq, name: S.idn.name, named: S.idn.named, anchor: S.anchor, rect: { ...fr }, Lmin: L[0], Lmax: L[1] };
    }
    _pushTomb(rec) {
        if (!rec) return;
        this.tombs.push({ ...rec, t: ++this._tombClock });
        if (this.tombs.length > TOMB_MAX) this.tombs.splice(0, this.tombs.length - TOMB_MAX);
    }
    _kill(S) { this._tomb(S); this._drop(S); }

    /**
     * After members left S (and pieces joined it): its components. From seeds, an interleaved
     * search per seed that stops once at most one is still open (a scene is connected by invariant,
     * so every component holds a seed); `full` labels every member. The heaviest keeps the identity
     * (tie: the one holding the smallest id); the others are new scenes.
     */
    _splitCheck(S, seeds, full = false) {
        if (!this.scenes.has(S) || S.members.size < 2) return;
        const start = full ? null : [...seeds].filter((m) => m.scene === S);
        const comps = full || start.length > this.seedsMax ? this._components(S) : this._seedComponents(S, start);
        if (!comps || comps.length < 2) return;
        const massOf = (c) => { let s = 0; for (const m of c) s += this.XD[m.slot * 8 + XFMASS]; return s; };
        const minId = (c) => { let r = Infinity; for (const m of c) if (m.id < r) r = m.id; return r; };
        let bi = 0, bm = massOf(comps[0]);
        for (let i = 1; i < comps.length; i++) {
            const mm = massOf(comps[i]), tol = 1e-9 * Math.max(mm, bm);
            if (mm > bm + tol || (Math.abs(mm - bm) <= tol && minId(comps[i]) < minId(comps[bi]))) { bi = i; bm = mm; }
        }
        // new ids go to the other components in order of their smallest member id; S keeps one
        // component physically (the rest when the search left one open, else the winner)
        const ids = comps.map(minId);
        const others = comps.map((_, i) => i).filter((i) => i !== bi).sort((a, b) => ids[a] - ids[b]);
        const idnOf = new Map([[bi, S.idn]]);
        for (const i of others) idnOf.set(i, this._newIdn());
        const stay = comps.rest != null ? comps.rest : bi;
        const leaving = [];
        for (let i = 0; i < comps.length; i++) if (i !== stay) for (const m of comps[i]) leaving.push(m);
        this._cellsOut(S.grid, leaving); this._cellsOut(S.mgrid, leaving.filter((m) => m.fn >= 3));
        for (let i = 0; i < comps.length; i++) {
            if (i === stay) continue;
            const N = this._mkScene(S.anchor, idnOf.get(i));
            N.ox = S.ox; N.oy = S.oy;
            for (const m of comps[i]) {
                S.members.delete(m);
                S.mass -= this.XD[m.slot * 8 + XFMASS]; if (m.fn >= 3) S.multi--;
                m.scene = null;
                this._file(N, m, true);
            }
        }
        if (stay !== bi) this._setIdn(S, idnOf.get(stay));
        S.rangeDirty = true; S.lost = true;
        this._range(S); this._touched(S); this._bbExact(S);
    }
    /** Seeded interleaved search; returns the components with `.rest` = the index of the open one, if any. */
    _seedComponents(S, start) {
        if (start.length < 2) return null;
        const par = start.map((_, i) => i);
        const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
        const seen = new Map();
        const front = start.map((m) => [m]), mem = start.map((m) => [m]);
        start.forEach((m, i) => { if (seen.has(m)) { par[i] = find(seen.get(m)); front[i] = []; mem[i] = []; } else seen.set(m, i); });
        const union = (a, b) => {
            a = find(a); b = find(b);
            if (a === b) return a;
            if (mem[a].length < mem[b].length) { const t = a; a = b; b = t; }
            par[b] = a;
            for (const q of front[b]) front[a].push(q);
            for (const q of mem[b]) mem[a].push(q);
            front[b] = []; mem[b] = [];
            return a;
        };
        const open = () => { let n = 0; for (let i = 0; i < par.length; i++) if (par[i] === i && front[i].length) n++; return n; };
        while (open() > 1) {
            for (let i = 0; i < par.length; i++) {
                if (par[i] !== i || !front[i].length) continue;
                const m = front[i].pop();
                const loc = this.LP;
                for (let k = 0; k < m.fn; k++) {
                    const o = m.lo + 4 * k;
                    this._near(S, loc[o], loc[o + 1], loc[o + 2], loc[o + 3], this.XD[m.slot * 8 + XT], m.band, (q) => {
                        if (q === m) return false;
                        const r = find(i), g = seen.get(q);
                        if (g == null) { seen.set(q, r); front[r].push(q); mem[r].push(q); } else if (find(g) !== r) union(r, g);
                        return false;
                    });
                }
            }
        }
        const roots = [];
        for (let i = 0; i < par.length; i++) if (par[i] === i && mem[i].length) roots.push(i);
        if (roots.length < 2) return null;
        const openRoot = roots.find((r) => front[r].length);
        const comps = [];
        let rest = null;
        for (const r of roots) {
            if (r === openRoot) continue;
            comps.push(mem[r]);
        }
        if (openRoot != null) {
            const closed = new Set(); for (const c of comps) for (const m of c) closed.add(m);
            const restArr = [];
            for (const m of S.members) if (!closed.has(m)) restArr.push(m);
            rest = comps.length;
            comps.push(restArr);
        }
        comps.rest = rest;
        return comps;
    }
    /**
     * Every member labelled: the components of S. A cell whose entries are all visited is skipped —
     * a scan from one component never reaches another's ink, so a full cell holds nothing new. A
     * dense scene (the Magnum Opus has ~4,900 dots within two join distances) costs its filings once
     * rather than its size at every member.
     */
    _components(S) {
        const seen = new Set(), comps = [];
        const full = { all: new Map(), own: new Map() };
        const mark = (m) => {
            const loc = this.LP;
            for (let k = 0; k < m.fn; k++) {
                const o = m.lo + 4 * k;
                for (let b = m.band; b <= m.band + BANDS; b++) {
                    const inv = 1 / 2 ** (b + 1);
                    const i0 = cellIx(loc[o] * inv), i1 = cellIx(loc[o + 2] * inv), j0 = cellIx(loc[o + 1] * inv), j1 = cellIx(loc[o + 3] * inv);
                    const count = (bands) => {
                        let g = bands.get(b);
                        if (!g) { g = new Map(); bands.set(b, g); }
                        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = (i + OFF) * KEYM + (j + OFF); g.set(key, (g.get(key) || 0) + 1); }
                    };
                    count(full.all);
                    if (b === m.band) count(full.own);
                }
            }
        };
        for (const s of S.members) {
            if (seen.has(s)) continue;
            const c = [s], q = [s];
            seen.add(s); mark(s);
            const visit = (p) => { if (!seen.has(p)) { seen.add(p); mark(p); c.push(p); q.push(p); } return false; };
            while (q.length) {
                const m = q.pop(), loc = this.LP;
                for (let k = 0; k < m.fn; k++) {
                    const o = m.lo + 4 * k;
                    this._near(S, loc[o], loc[o + 1], loc[o + 2], loc[o + 3], this.XD[m.slot * 8 + XT], m.band, visit, S.grid, full);
                }
            }
            comps.push(c);
        }
        comps.rest = null;
        return comps;
    }
    _bbExact(S) {
        const bb = EMPTY_BB();
        for (const m of S.members) grow(bb, this.LP, m.lo, m.fn);
        S.bb = bb;
    }
    /** The frame in anchor coords: the ink less its stray runs (at least one thickest width each way), padded FRAME_PAD. No minimum (Kobin 2026-09-23). */
    _frameOf(S) {
        const bb = EMPTY_BB(), in_ = EMPTY_BB();
        const several = S.members.size > 1;
        let Tmax = 0;
        for (const m of S.members) {
            const loc = this.LP;
            if (this.XD[m.slot * 8 + XT] > Tmax) Tmax = this.XD[m.slot * 8 + XT];
            grow(bb, loc, m.lo, m.fn);
            for (let k = 0; k < m.fn; k++) {
                if (several && m.fn >= 3 && !this._valid(S, m, k)) continue;
                const o = m.lo + 4 * k;
                if (loc[o] < in_[0]) in_[0] = loc[o]; if (loc[o + 1] < in_[1]) in_[1] = loc[o + 1];
                if (loc[o + 2] > in_[2]) in_[2] = loc[o + 2]; if (loc[o + 3] > in_[3]) in_[3] = loc[o + 3];
            }
        }
        S.bb = bb;
        const r = Number.isFinite(in_[0]) ? in_ : bb;
        if (!Number.isFinite(r[0])) return null;
        const f = padInk(r, Tmax / REACH);
        return { x: f.x + S.ox, y: f.y + S.oy, w: f.w, h: f.h };
    }
    /**
     * Does a valid chunk of these items (filed in their scenes) come within reach of a valid chunk of
     * B? Stray runs bridge nothing, here as at an insert (SCENES-PLAN §6 rows 3–4).
     */
    _itemsTouch(items, B) {
        const hit = (q, kk) => this._valid(B, q, kk);
        for (const m of items) {
            const A = m.scene;
            const M = A && this.frames.map(A.anchor, B.anchor);
            if (!M) continue;
            const T = this.XD[m.slot * 8 + XT] * M.s, b = Math.floor(Math.log2(T)), loc = this.LP;
            for (let k = 0; k < m.fn; k++) {
                if (!this._valid(A, m, k)) continue;
                const o = m.lo + 4 * k;
                const x0 = (loc[o] + A.ox) * M.s + M.ox - B.ox, y0 = (loc[o + 1] + A.oy) * M.s + M.oy - B.oy;
                const x1 = (loc[o + 2] + A.ox) * M.s + M.ox - B.ox, y1 = (loc[o + 3] + A.oy) * M.s + M.oy - B.oy;
                if (this._near(B, x0, y0, x1, y1, T, b, hit)) return true;
            }
        }
        return false;
    }
    /**
     * A scene moved whole lands: it merges with the compatible scenes its moved ink (`own`, members
     * of S) now touches, oldest first, while the range fits.
     */
    _rejoin(S, own = [...S.members]) {
        if (!this.scenes.has(S) || !S.members.size) return;
        const cands = [];
        const dS = this._depth(S.anchor);
        for (const T of this.scenes) {
            if (T === S || !T.members.size) continue;
            if (!fitsSpread(Math.min(T.Lmin, S.Lmin), Math.max(T.Lmax, S.Lmax))) continue;
            const M = this.frames.map(T.anchor, S.anchor);
            if (!M) continue;
            const g = REACH * 2 ** (Math.max(S.Lmax, T.Lmax) + LOG_R * dS);
            const bx0 = (T.bb[0] + T.ox) * M.s + M.ox, by0 = (T.bb[1] + T.oy) * M.s + M.oy;
            const bx1 = (T.bb[2] + T.ox) * M.s + M.ox, by1 = (T.bb[3] + T.oy) * M.s + M.oy;
            const s0 = S.bb[0] + S.ox, s1 = S.bb[1] + S.oy, s2 = S.bb[2] + S.ox, s3 = S.bb[3] + S.oy;
            if (bx0 - g > s2 || s0 - g > bx1 || by0 - g > s3 || s1 - g > by1) continue;
            cands.push(T);
        }
        cands.sort((a, b) => a.idn.seq - b.idn.seq);
        let acc = S;
        for (const T of cands) {
            if (!this.scenes.has(T) || T === acc) continue;
            if (!fitsSpread(Math.min(T.Lmin, acc.Lmin), Math.max(T.Lmax, acc.Lmax))) continue;
            if (!this._itemsTouch(own, T)) continue;
            acc = this._merge(acc, T);
        }
    }

    // ------------------------------------------------------------------ the batch
    /**
     * One batch `{frames, items, renames, restore}`. Frames first (scenes in a frame that went move up
     * the old tree); each item record is gone, new, re-shaped, re-placed or `attr` (a z change). Then:
     * scenes moved whole (origin), removals with pieces filed back and split checks, inserts in id
     * order, moved ink re-joining, heirs, names reclaimed, frames, parents, rows, parts, regions.
     * Returns `{scenes, changed, export, ms, stats}`.
     */
    apply(batch = {}) {
        this.batchNo++;
        const t0 = now();
        this.stats = { queries: 0, cells: 0, entries: 0 };
        if (batch.restore) return this._restore(batch, t0);
        const { moved: movedFrames, shifted, gone: goneFrames } = this.frames.update(batch.frames);
        this._reserve(batch.items);
        this._framesGone(goneFrames, movedFrames);
        const removeFrom = new Map();          // scene -> Set(item) leaving it
        const refile = [];                     // [item, source id]: file into the source's scene if the range allows
        const inserts = new Set();
        const placed = new Set();              // items whose drawn position may have changed
        const hintScene = new Map();           // item id -> its scene before this batch
        const leave = (x) => { const S = x.scene; if (!S) return; let s = removeFrom.get(S); if (!s) { s = new Set(); removeFrom.set(S, s); } s.add(x); };
        for (const r of batch.items || []) {
            const x = this.items.get(r.id);
            if (r.attr) { if (x && x.scene && !x.gone) { x.scene.version = this.ver++; x.scene.vtag = this.vtag; } continue; }   // z only: the picture changed
            if (r.gone) {
                if (!x) continue;
                if (x.scene) { hintScene.set(x.id, x.scene); leave(x); x.gone = true; } else { inserts.delete(x); this._dropItem(x); }
                continue;
            }
            if (!x) { const nx = this._mkItem(r); if (r.hint != null) refile.push([nx, r.hint]); else inserts.add(nx); continue; }
            if (x.gone) continue;
            if (x.scene) hintScene.set(x.id, x.scene);
            const moved = x.home !== r.home || this.XD[x.slot * 8 + XTX] !== (r.t ? r.t[0] : 0) || this.XD[x.slot * 8 + XTY] !== (r.t ? r.t[1] : 0);
            if (x.home !== r.home && x.scene) x.scene.lost = true;
            x.home = r.home; this.XD[x.slot * 8 + XTX] = r.t ? r.t[0] : 0; this.XD[x.slot * 8 + XTY] = r.t ? r.t[1] : 0;
            if (r.raw && this._translated(x, r.raw, r.w)) { this.RP.set(r.raw.subarray ? r.raw.subarray(0, 5 * x.n) : r.raw.slice(0, 5 * x.n), x.ro); x.loops = loopStarts(r.loops, x.n); placed.add(x); continue; }
            if (r.raw || r.w !== this.XD[x.slot * 8 + XW]) {
                // re-shaped: it leaves its scene and is filed back into it (storage, not new ink) when the range allows
                const g = { raw: r.raw || null, w: r.w, loops: r.raw ? r.loops : x.loops };
                if (x.scene) { x.next = g; leave(x); refile.push([x, x.id]); } else this._setGeom(x, g);
                continue;
            }
            if (moved) placed.add(x);
        }
        if (movedFrames.size || shifted.size) {
            for (const x of this.items.values()) {
                if (x.scene && !x.gone && (shifted.has(x.home) || this.frames.under(x.home, movedFrames))) placed.add(x);
            }
        }
        const rejoin = [], fullSplit = new Set();
        this._placeScenes(placed, movedFrames, removeFrom, inserts, rejoin, fullSplit, leave);
        this.frames.settle();

        // removals, pieces filed back, split checks
        const refileBy = new Map(), late = [];
        for (const [x, src] of refile) {
            const sx = this.items.get(src);
            const S = hintScene.get(src) || (sx && sx.scene) || null;
            if (!S) { late.push(x); continue; }
            let a = refileBy.get(S); if (!a) { a = []; refileBy.set(S, a); } a.push(x);
        }
        const bySeq = (a, b) => a.idn.seq - b.idn.seq;
        const heirs = [];
        for (const S of [...new Set([...removeFrom.keys(), ...refileBy.keys()])].sort(bySeq)) {
            const going = removeFrom.get(S) || new Set();
            const seeds = new Set();
            // many leaving: the split check labels the whole scene (below), so no seeds are gathered
            const many = going.size > this.seedsMax;
            const add = (m) => { if (!going.has(m)) seeds.add(m); return false; };
            if (!many) {
                for (const x of going) {
                    const loc = this.LP;
                    for (let k = 0; k < x.fn; k++) { const o = x.lo + 4 * k; this._near(S, loc[o], loc[o + 1], loc[o + 2], loc[o + 3], this.XD[x.slot * 8 + XT], x.band, add); }
                }
            }
            if (going.size) this._unfileMany(S, [...going]);
            for (const x of going) {
                if (x.gone) this._dropItem(x);
                if (x.next) { this._setGeom(x, x.next); x.next = null; }
            }
            const pieces = (refileBy.get(S) || []).filter((p) => !p.gone).sort((a, b) => a.id - b.id);
            if (this.scenes.has(S)) {
                this._range(S);
                for (const p of pieces) {
                    const empty = !S.members.size;
                    if ((empty || fitsSpread(Math.min(S.Lmin, this.XD[p.slot * 8 + XL]), Math.max(S.Lmax, this.XD[p.slot * 8 + XL]))) && this._file(S, p)) {
                        if (empty) { S.Lmin = this.XD[p.slot * 8 + XL]; S.Lmax = this.XD[p.slot * 8 + XL]; S.rangeDirty = false; this._rebucket(S); }
                        seeds.add(p);
                    } else late.push(p);
                }
            } else for (const p of pieces) late.push(p);
            if (!S.members.size) {
                if (!this.scenes.has(S)) continue;
                // emptied by members that moved away: the scene they gather in may take its identity
                const movers = [...going].filter((x) => !x.gone);
                if (movers.length) { heirs.push({ idn: S.idn, members: movers, tomb: this._tombRecord(S) }); this._drop(S); } else this._kill(S);
                continue;
            }
            this._range(S);
            if (fullSplit.has(S) || many) this._splitCheck(S, null, true);
            else if (seeds.size >= 2) this._splitCheck(S, seeds);
        }
        for (const S of [...fullSplit].sort(bySeq)) if (!removeFrom.has(S) && !refileBy.has(S)) this._splitCheck(S, null, true);
        for (const S of this.scenes) this._range(S);
        const queue = [...inserts, ...late].filter((x) => this.items.get(x.id) === x && !x.scene && !x.gone);
        queue.sort((a, b) => a.id - b.id);
        for (const x of queue) if (!x.scene) this._insert(x);
        // every scene holding ink that moved whole re-joins through that ink, not through ink that stood still
        const again = new Map();
        for (const ms of rejoin) for (const m of ms) {
            if (!m.scene || this.items.get(m.id) !== m) continue;
            let a = again.get(m.scene);
            if (!a) again.set(m.scene, (a = []));
            a.push(m);
        }
        for (const S of [...again.keys()].sort(bySeq)) { const own = again.get(S); if (own[0].scene) this._rejoin(own[0].scene, own); }
        this._heirs(heirs);
        if (batch.renames) for (const [id, name] of batch.renames) this.rename(id, name);
        const out = this._finish(t0, null);
        if (this.autoCompact) this._compact();
        return out;
    }
    /**
     * A scene emptied by members that moved away keeps its id and name in the scene holding most of
     * their ink, when that scene is new this batch (tie: the one holding the smallest of their ids);
     * otherwise its name is kept aside.
     */
    _heirs(heirs) {
        for (const h of heirs.sort((a, b) => a.idn.seq - b.idn.seq)) {
            const mass = new Map(), low = new Map();
            for (const m of h.members) {
                if (!m.scene || this.items.get(m.id) !== m) continue;
                mass.set(m.scene, (mass.get(m.scene) || 0) + this.XD[m.slot * 8 + XFMASS]);
                low.set(m.scene, Math.min(low.has(m.scene) ? low.get(m.scene) : Infinity, m.id));
            }
            let best = null;
            for (const [T, ms] of mass) {
                if (!best) { best = T; continue; }
                const bm = mass.get(best), tol = 1e-9 * Math.max(ms, bm);
                if (ms > bm + tol || (Math.abs(ms - bm) <= tol && low.get(T) < low.get(best))) best = T;
            }
            if (best && best.idn.born === this.batchNo && !this.byId.has(h.idn.id)) this._setIdn(best, { ...h.idn, born: -1 });
            else this._pushTomb(h.tomb);
        }
    }
    /** Is `b` the chunks of `a` translated (same count and lengths, one shift)? */
    /** Is `b` (a record's raw) x's chunks translated (same count and lengths, one shift, the same width)? */
    _translated(x, b, wb) {
        const a = this.RP, a0 = x.ro, len = 5 * x.n, wa = this.XD[x.slot * 8 + XW];
        if (!b || b.length !== len || wa !== wb || !len) return false;
        const dx = b[0] - a[a0], dy = b[1] - a[a0 + 1];
        const tol = 1e-6 * REACH * wa;
        for (let i = 0; i < len; i += 5) {
            const j = a0 + i;
            if (Math.abs(b[i] - a[j] - dx) > tol || Math.abs(b[i + 2] - a[j + 2] - dx) > tol) return false;
            if (Math.abs(b[i + 1] - a[j + 1] - dy) > tol || Math.abs(b[i + 3] - a[j + 3] - dy) > tol) return false;
            if (Math.abs(b[i + 4] - a[j + 4]) > tol) return false;
        }
        return true;
    }
    /**
     * Items placed anew (a table, a home, a frame moved or shifted), per scene, measured in a frame
     * that did not move: every member moved by one displacement is a rigid move (the origin
     * follows, the scene re-joins where it lands); otherwise the members that moved leave and are
     * inserted again. A scene anchored in a moved frame that did not move whole is re-anchored in
     * the static frame above it and split-checked whole.
     */
    _placeScenes(placed, movedFrames, removeFrom, inserts, rejoin, fullSplit, leave) {
        const byScene = new Map();
        for (const x of placed) {
            if (!x.scene || x.gone) continue;
            let a = byScene.get(x.scene); if (!a) { a = []; byScene.set(x.scene, a); } a.push(x);
        }
        for (const [S, xs] of byScene) {
            const ref = this._staticRef(S.anchor, movedFrames);
            const Mold = ref != null ? this.frames.map(S.anchor, ref, true) : null;
            const moved = [];
            let d0 = null, same = true;
            for (const x of xs) {
                const Mn = ref != null ? this.frames.map(x.home, ref) : null;
                const f = this.frames.get(x.home);
                if (!Mold || !Mn || !f) { moved.push(x); same = false; continue; }
                const nx = (this.RP[x.ro] + this.XD[x.slot * 8 + XTX] + f.sx) * Mn.s + Mn.ox, ny = (this.RP[x.ro + 1] + this.XD[x.slot * 8 + XTY] + f.sy) * Mn.s + Mn.oy;
                const ox = (this.LP[x.lo] + S.ox) * Mold.s + Mold.ox, oy = (this.LP[x.lo + 1] + S.oy) * Mold.s + Mold.oy;
                const dx = nx - ox, dy = ny - oy, tol = 1e-7 * REACH * this.XD[x.slot * 8 + XW] * Mn.s;
                if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) continue;
                moved.push(x);
                if (!d0) d0 = [dx, dy, tol];
                else if (Math.abs(dx - d0[0]) > Math.max(tol, d0[2]) || Math.abs(dy - d0[1]) > Math.max(tol, d0[2])) same = false;
            }
            const anchorMoved = movedFrames.size > 0 && this.frames.under(S.anchor, movedFrames);
            // moved whole: every member that stays (not gone, not re-shaped) moved by one displacement
            const leaving = removeFrom.has(S) ? removeFrom.get(S).size : 0;
            if (moved.length && moved.length === S.members.size - leaving && same) {
                // moved whole: the local coordinates stand and the origin follows (not at all when the anchor moved with it)
                const x = moved[0], buf = new Float64Array(4 * x.n);
                if (this._boxesIn(x, S.anchor, buf, 0, S.ox, S.oy)) { S.ox += buf[0] - this.LP[x.lo]; S.oy += buf[1] - this.LP[x.lo + 1]; }
                S.frameDirty = true;
                rejoin.push(moved);   // the moved ink: whichever scene holds it after the inserts re-joins through it
                continue;
            }
            if (anchorMoved && ref != null) {
                this._reanchor(S, ref, true);
                fullSplit.add(S);
            }
            for (const x of moved) { leave(x); inserts.add(x); }
        }
    }

    // ------------------------------------------------------------------ the end of a batch
    _finish(t0, legacy) {
        for (const S of this.scenes) {
            if (!S.lost || !S.members.size) continue;
            // the coarsest members left: re-anchor at the coarsest home now
            let atAnchor = false, best = null, bd = Infinity;
            for (const m of S.members) {
                if (m.home === S.anchor) { atAnchor = true; break; }
                const d = this._depth(m.home);
                if (d < bd) { bd = d; best = m.home; }
            }
            S.lost = false;
            if (!atAnchor && best != null && bd > this._depth(S.anchor)) this._reanchor(S, best);
        }
        const changed = [];
        for (const S of this.scenes) {
            if (!S.frameDirty) continue;
            S.frame = this._frameOf(S);
            S.frameL = [S.Lmin, S.Lmax];
            S.frameDirty = false;
            changed.push(S);
        }
        this._reclaim(legacy);
        this._parents(changed);
        this._echoes();
        for (const S of changed) this._parts(S);
        for (const S of changed) this._keyCheck(S);
        this._regions();
        return { scenes: this.records(), changed: changed.map((S) => S.idn.id), export: this.exportState(),
            ms: now() - t0, stats: this.stats };
    }
    /**
     * A restored scene whose frame or parts differ from the saved ones (a framing rule changed since
     * the save) gets a new version, so its thumbnails are made again; the saved ones are dropped.
     */
    _keyCheck(S) {
        const sv = S.saved;
        if (!sv) return;
        S.saved = null;
        const near = (a, b) => !!a && !!b && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= 1e-9 * Math.max(Math.abs(a.w), Math.abs(a.h), 1e-300));
        const P = S.parts || [];
        const same = sv.anchor === S.anchor && near(S.frame, sv.rect) && P.length === sv.parts.length && P.every((p, i) => near(p.rect, sv.parts[i]));
        if (!same) { S.version = this.ver++; S.vtag = this.vtag; }
    }
    /**
     * Part records for a scene wider than MAX_SPAN_PX at the zoom where its thickest stroke is
     * REF_STROKE_PX: at most MAX_PARTS pieces (`cutParts`). Output only; a part keeps its id and a
     * name it was given while it covers MATCH_OVERLAP of its previous frame.
     */
    _parts(S) {
        const prev = S.parts || [];
        S.parts = [];
        if (!S.frame || S.members.size < 2) return;
        let Tmax = 0;
        for (const m of S.members) if (this.XD[m.slot * 8 + XT] > Tmax) Tmax = this.XD[m.slot * 8 + XT];
        const limit = (MAX_SPAN_PX / JOIN_PX) * Tmax;
        if (Math.max(S.frame.w, S.frame.h) <= limit) return;
        const pts = [];
        const several = S.members.size > 1;
        for (const m of S.members) {
            const loc = this.LP, wm = this.XD[m.slot * 8 + XT] / REACH;
            for (let k = 0; k < m.fn; k++) {
                if (several && m.fn >= 3 && !this._valid(S, m, k)) continue;
                const o = m.lo + 4 * k;
                pts.push({ x0: loc[o], y0: loc[o + 1], x1: loc[o + 2], y1: loc[o + 3], mass: Math.max(loc[o + 2] - loc[o], loc[o + 3] - loc[o + 1], wm) / wm });
            }
        }
        const leaves = cutParts(pts, limit);
        if (leaves.length < 2) return;
        const rects = leaves.map((r) => padInk(r, Tmax / REACH));   // local: a scene moved whole keeps its parts
        const pairs = [];
        rects.forEach((r, i) => prev.forEach((q, j) => { const c = rectCover(q.rect, r); if (c >= MATCH_OVERLAP) pairs.push([c, i, j]); }));
        pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        const idn = new Array(rects.length), usedP = new Set();
        for (const [, i, j] of pairs) { if (idn[i] || usedP.has(j)) continue; idn[i] = prev[j].idn; usedP.add(j); }
        S.parts = rects.map((rect, i) => ({ idn: idn[i] || { id: "p" + this.pseq, seq: this.pseq++, name: null, named: false }, rect }));
    }
    /**
     * Regions: more than MAX_SIBLINGS rows under one parent row (or at the top) are grouped by their
     * frames' centres, split at the median across the wider spread until every group fits. Output
     * only. Rows are named by their founders (a rename or a fold does not change one), and a region
     * keeps the id and name of any earlier region holding MATCH_OVERLAP of its rows.
     */
    _regions() {
        const groups = new Map();
        for (const R of this.rows) {
            const P = R.up;
            let a = groups.get(P); if (!a) { a = []; groups.set(P, a); } a.push(R);
        }
        const next = new Map();
        this.regionOf = new Map();
        const pool = [];
        for (const regs of this.regions.values()) for (const q of regs) pool.push(q);
        const taken = new Set();
        for (const [P, list] of groups) {
            if (list.length <= MAX_SIBLINGS) continue;
            const key = P ? P.founder.idn.id : "";
            const ref = P ? P.shown.anchor : list.reduce((a, R) => (R.mass > a.mass ? R : a)).shown.anchor;
            const pts = [];
            for (const R of list) {
                const T = R.shown, M = this.frames.map(T.anchor, ref);
                if (!M) continue;
                const f = T.frame;
                pts.push({ S: R.founder, R, x: (f.x + f.w / 2) * M.s + M.ox, y: (f.y + f.h / 2) * M.s + M.oy,
                    r: { x: f.x * M.s + M.ox, y: f.y * M.s + M.oy, w: f.w * M.s, h: f.h * M.s } });
            }
            const out = [];
            const split = (ps) => {
                if (ps.length <= MAX_SIBLINGS) { out.push(ps); return; }
                let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
                for (const q of ps) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
                const byX = x1 - x0 >= y1 - y0;
                const sorted = ps.slice().sort((a, b) => (byX ? a.x - b.x : a.y - b.y) || a.S.idn.seq - b.S.idn.seq);
                const h = sorted.length >> 1;
                split(sorted.slice(0, h)); split(sorted.slice(h));
            };
            split(pts);
            const prev = pool;
            const pairs = [];
            out.forEach((g, i) => {
                const ids = new Set(g.map((q) => q.S.idn.id));
                prev.forEach((q, j) => {
                    if (taken.has(q)) return;
                    let both = 0; for (const id of ids) if (q.kids.has(id)) both++;
                    const jac = both / (ids.size + q.kids.size - both);
                    if (jac >= MATCH_OVERLAP) pairs.push([jac, i, j]);
                });
            });
            pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
            const idn = new Array(out.length), used = new Set();
            for (const [, i, j] of pairs) { if (idn[i] || used.has(j)) continue; idn[i] = prev[j].idn; used.add(j); taken.add(prev[j]); }
            const regs = [];
            out.forEach((g, i) => {
                if (g.length < 2) return;
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (const q of g) { x0 = Math.min(x0, q.r.x); y0 = Math.min(y0, q.r.y); x1 = Math.max(x1, q.r.x + q.r.w); y1 = Math.max(y1, q.r.y + q.r.h); }
                const reg = { idn: idn[i] || { id: "r" + this.rseq, seq: this.rseq++, name: null, named: false },
                    kids: new Set(g.map((q) => q.S.idn.id)), level: ref, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rows: g.map((q) => q.R) };
                regs.push(reg);
                for (const q of g) this.regionOf.set(q.R.S, reg);
            });
            next.set(key, regs);
        }
        this.regions = next;
    }
    /** Scenes born this batch take a kept-aside id and name whose frame they cover by MATCH_OVERLAP. */
    _reclaim(legacy) {
        const born = [...this.scenes].filter((S) => S.idn.born === this.batchNo && S.frame);
        const pool = legacy || this.tombs;
        if (!born.length || !pool.length) return;
        const pairs = [];
        for (const S of born) {
            for (const t of pool) {
                if (!legacy && !fitsSpread(Math.min(t.Lmin, S.Lmin), Math.max(t.Lmax, S.Lmax))) continue;
                const M = this.frames.map(S.anchor, t.anchor);
                if (!M) continue;
                const r = { x: S.frame.x * M.s + M.ox, y: S.frame.y * M.s + M.oy, w: S.frame.w * M.s, h: S.frame.h * M.s };
                // rounded: two names kept aside with one frame an ulp apart must tie, and recency decide
                const c = Math.round(rectCover(t.rect, r) * 1e9) / 1e9;
                if (c >= MATCH_OVERLAP) pairs.push({ S, t, c });
            }
        }
        pairs.sort((a, b) => b.c - a.c || (b.t.t || 0) - (a.t.t || 0) || a.S.idn.seq - b.S.idn.seq);
        const usedS = new Set(), usedT = new Set();
        for (const { S, t } of pairs) {
            if (usedS.has(S) || usedT.has(t)) continue;
            if (this.byId.has(t.id) && this.byId.get(t.id) !== S) continue;
            usedS.add(S); usedT.add(t);
            this._setIdn(S, { id: t.id, seq: t.seq, name: t.name, named: !!t.named, born: S.idn.born });
        }
        if (!legacy) this.tombs = this.tombs.filter((t) => !usedT.has(t));
    }
    /** Parent: the scene whose frame holds this one's centre, with the smallest Lmax above its own (tie: the older). */
    _parents(changed) {
        const all = [...this.scenes];
        let targets = all;
        if (changed.length * 8 <= all.length) {
            const set = new Set(changed);
            for (const S of all) {
                if (set.has(S)) continue;
                if (S.parent && (!this.scenes.has(S.parent) || set.has(S.parent))) { set.add(S); continue; }
                for (const C of changed) if (C.Lmax > S.Lmax && this._contains(C, S)) { set.add(S); break; }
            }
            targets = [...set];
        }
        for (const S of targets) {
            let best = null;
            for (const P of all) {
                if (P === S || !(P.Lmax > S.Lmax) || !P.frame) continue;
                if (best && (P.Lmax > best.Lmax || (P.Lmax === best.Lmax && P.idn.seq > best.idn.seq))) continue;
                if (this._contains(P, S)) best = P;
            }
            S.parent = best;
        }
    }
    /**
     * The panel's rows (§6 principle 1; Kobin 2026-09-23, "two scenes for Saturn"). Top-down, a
     * scene joins the row of its nearest ancestor (ECHO_UP generations) whose tightest frame and its
     * own hold each other's centres at sizes within ECHO_ZOOM, while the row's frames span at most
     * ZOOM_SPREAD; two renamed scenes never share one. A row with a renamed member is that member
     * (its id, name, frame and parts); else it keeps its first member's id and name and shows its
     * tightest frame (Kobin 2026-09-23). Output only.
     */
    _echoes() {
        const dep = new Map();
        const depth = (S) => {
            let d = dep.get(S);
            if (d != null) return d;
            d = 0;
            for (let q = S.parent; q && this.scenes.has(q) && d < 1e6; q = q.parent) d++;
            dep.set(S, d);
            return d;
        };
        const list = [...this.scenes].filter((S) => S.frame).sort((a, b) => depth(a) - depth(b) || a.idn.seq - b.idn.seq);
        this.rows = []; this.rowOf = new Map();
        for (const S of list) {
            let R = null;
            for (let P = S.parent, g = 0; P && g < ECHO_UP && this.scenes.has(P); P = P.parent, g++) {
                const Q = this.rowOf.get(P);
                if (Q && this._echoJoins(Q, S)) { R = Q; break; }
            }
            const ls = frameLog(S.frame, this._depth(S.anchor));
            if (R) {
                R.members.push(S);
                if (ls < R.tightLog) { R.tight = S; R.tightLog = ls; }
                if (ls > R.looseLog) R.looseLog = ls;
                if (S.idn.named) R.named = S;
            } else {
                R = { S, founder: S, tight: S, tightLog: ls, looseLog: ls, named: S.idn.named ? S : null, members: [S], up: null };
                this.rows.push(R);
            }
            this.rowOf.set(S, R);
        }
        for (const R of this.rows) {
            if (R.named) R.S = R.named;
            R.shown = R.named || R.tight;
            const P = R.founder.parent;
            R.up = P && this.scenes.has(P) ? this.rowOf.get(P) || null : null;
            R.mass = 0; R.count = 0;
            for (const S of R.members) { R.mass += S.mass; R.count += S.members.size; }
        }
    }
    /** Does `S` echo row `R`: its frame and R's tightest hold each other's centres, within ECHO_ZOOM, the row's span within ZOOM_SPREAD? */
    _echoJoins(R, S) {
        if (S.idn.named && R.named) return false;
        const ls = frameLog(S.frame, this._depth(S.anchor));
        if (Math.abs(ls - R.tightLog) > ECHO_LOG + EPS_L) return false;
        if (Math.max(R.looseLog, ls) - Math.min(R.tightLog, ls) > SPREAD_OCT + EPS_L) return false;
        return this._contains(R.tight, S) && this._contains(S, R.tight);
    }
    _contains(P, S) {
        if (!P.frame || !S.frame) return false;
        const M = this.frames.map(S.anchor, P.anchor);
        if (!M) return false;
        const cx = (S.frame.x + S.frame.w / 2) * M.s + M.ox, cy = (S.frame.y + S.frame.h / 2) * M.s + M.oy;
        return cx >= P.frame.x && cx <= P.frame.x + P.frame.w && cy >= P.frame.y && cy <= P.frame.y + P.frame.h;
    }
    /**
     * The panel's list, one record per row (`_echoes`): roots by ink, heaviest first, each followed by
     * its parts and its child rows, a crowd of siblings under its regions. A record carries its row's
     * id and name and the frame of the scene it shows; `parent` is the parent row's id, `region` the
     * region it is listed under; parts and regions carry `kind`.
     */
    records() {
        const kids = new Map(), roots = [];
        for (const R of this.rows) {
            if (R.up) { let a = kids.get(R.up); if (!a) { a = []; kids.set(R.up, a); } a.push(R); } else roots.push(R);
        }
        const byInk = (a, b) => b.mass - a.mass || a.S.idn.seq - b.S.idn.seq;
        const live = new Set(this.rows), out = [];
        const visit = (R, depth, parentId, reg) => {
            const S = R.S, T = R.shown;
            out.push({ id: S.idn.id, name: S.idn.name, level: T.anchor, rect: { ...T.frame },
                ...(parentId ? { parent: parentId } : {}), ...(reg ? { region: reg.idn.id } : {}), depth, hash: rowKey(R),
                auto: !S.idn.named, pinned: !!S.idn.named, count: R.count });
            (T.parts || []).forEach((pt, k) => out.push({ id: pt.idn.id, kind: "part", name: pt.idn.named ? pt.idn.name : S.idn.name + " · " + (k + 1),
                level: T.anchor, rect: { x: pt.rect.x + T.ox, y: pt.rect.y + T.oy, w: pt.rect.w, h: pt.rect.h }, parent: S.idn.id, depth: depth + 1, hash: keyOf(T) + "." + (k + 1),
                auto: !pt.idn.named, pinned: !!pt.idn.named }));
            const k = kids.get(R);
            if (k) emit(k, depth + 1, S.idn.id);
        };
        const emit = (list, depth, parentId) => {
            list.sort(byInk);
            const done = new Set();
            for (const R of list) {
                if (done.has(R)) continue;
                const reg = this.regionOf.get(R.S);
                if (!reg) { visit(R, depth, parentId, null); continue; }
                const inReg = reg.rows.filter((q) => live.has(q)).sort(byInk);
                out.push({ id: reg.idn.id, kind: "region", name: reg.idn.named ? reg.idn.name : inReg[0].S.idn.name + " and " + (inReg.length - 1) + " more",
                    level: reg.level, rect: { ...reg.rect }, ...(parentId ? { parent: parentId } : {}), depth,
                    hash: "r" + fnv(inReg.map(rowKey).join(".")), auto: !reg.idn.named, pinned: !!reg.idn.named,
                    count: inReg.reduce((a, q) => a + q.count, 0) });
                for (const q of inReg) { done.add(q); visit(q, depth + 1, parentId, reg); }
            }
        };
        emit(roots, 0, null);
        return out;
    }
    /** A user's name for a scene, part or region. A renamed scene keeps its id and name through a merge with an unnamed one and gives its row its id. */
    rename(id, name) {
        if (typeof name !== "string" || !name.trim()) return false;
        const S = this.byId.get(id);
        let idn = S ? S.idn : null;
        if (!idn) for (const T of this.scenes) for (const pt of T.parts || []) if (pt.idn.id === id) idn = pt.idn;
        if (!idn) for (const regs of this.regions.values()) for (const r of regs) if (r.idn.id === id) idn = r.idn;
        if (!idn) return false;
        idn.name = name.trim().slice(0, 120);
        idn.named = true;
        return true;
    }

    // ------------------------------------------------------------------ saving
    /** The saved state (meta.sceneIndex): scene shells (member strings cached per scene, parts), the kept-aside names, the regions. */
    exportState() {
        const scenes = [...this.scenes].sort((a, b) => a.idn.seq - b.idn.seq).map((S) => {
            // `m` the objects, `e` the erase footprints (item id −mark), each as sorted ids
            if (S.mStr == null) {
                const ids = [...S.members].map((m) => m.id);
                S.mStr = encodeIds(ids.filter((id) => id >= 0));
                S.eStr = encodeIds(ids.filter((id) => id < 0).map((id) => -id));
            }
            const fr = S.frame || { x: 0, y: 0, w: 0, h: 0 };
            return { id: S.idn.id, seq: S.idn.seq, name: S.idn.name, named: S.idn.named, anchor: S.anchor,
                ox: S.ox, oy: S.oy, version: S.version, ...(S.vtag ? { vtag: S.vtag } : {}), Lmin: S.Lmin, Lmax: S.Lmax, rect: { ...fr }, m: S.mStr,
                ...(S.eStr ? { e: S.eStr } : {}),
                ...(S.parts && S.parts.length ? { parts: S.parts.map((pt) => ({ id: pt.idn.id, seq: pt.idn.seq, name: pt.idn.name, named: pt.idn.named, rect: { ...pt.rect } })) } : {}) };
        });
        const tomb = this.tombs.map((t) => ({ ...t, rect: { ...t.rect } }));
        const regions = [];
        for (const [parent, regs] of this.regions) for (const r of regs) regions.push({ id: r.idn.id, seq: r.idn.seq, name: r.idn.name, named: r.idn.named, parent, kids: [...r.kids] });
        return { v: 3, seq: this.seq, ver: this.ver, pseq: this.pseq, rseq: this.rseq, scenes, tomb, ...(regions.length ? { regions } : {}) };
    }
    /**
     * A load: the saved scenes as shells, each object filed straight into its saved scene (no
     * joins); a saved scene with no object left keeps its name aside; a scene that lost members is
     * split-checked whole; the rest (objects the index never saw, the saved `dirty` ids) is inserted
     * by the ordinary rule. No state: a fresh build, `legacy` scenes lending ids and names by overlap.
     */
    _restore(batch, t0) {
        const st = batch.restore.state || null;
        this._reset();
        this.vtag = newTag();   // a new session: versions from the saved `ver` on are keyed apart from any before
        this.frames.update(batch.frames || []);
        this._reserve(batch.items);
        this.frames.settle();
        if (st) {
            this.seq = Math.max(1, st.seq | 0); this.ver = Math.max(1, st.ver | 0);
            this.pseq = Math.max(1, st.pseq | 0); this.rseq = Math.max(1, st.rseq | 0);
            for (const r of st.regions || []) {
                const key = r.parent || "";
                let a = this.regions.get(key); if (!a) { a = []; this.regions.set(key, a); }
                a.push({ idn: { id: r.id, seq: r.seq, name: r.name, named: !!r.named }, kids: new Set(r.kids || []) });
            }
            this.tombs = (st.tomb || []).map((t) => ({ ...t, rect: { ...t.rect } }));
            for (const t of this.tombs) this._tombClock = Math.max(this._tombClock, t.t || 0);
        } else this.seq = Math.max(this.seq, batch.restore.seq | 0, 1);
        const dirty = new Set(st && st.dirty ? st.dirty : []);
        const shells = st ? st.scenes || [] : [];
        const members = shells.map((sh) => decodeIds(sh.m).filter((id) => !dirty.has(id)).concat(decodeIds(sh.e).map((e) => -e)));
        const where = new Map();
        members.forEach((ids, i) => { for (const id of ids) where.set(id, i); });
        const byShell = shells.map(() => []);
        const loose = [];
        for (const r of batch.items || []) {
            if (r.gone || r.attr || this.items.has(r.id)) continue;
            const x = this._mkItem(r);
            const i = where.get(r.id);
            if (i != null) byShell[i].push(x); else loose.push(x);
        }
        const lost = [];
        shells.forEach((sh, i) => {
            const xs = byShell[i];
            const idn = { id: sh.id, seq: sh.seq || 0, name: sh.name, named: !!sh.named, born: -1 };
            if (!xs.length) {
                if (members[i].length && sh.rect && sh.rect.w > 0) {
                    this.tombs.push({ id: idn.id, seq: idn.seq, name: idn.name, named: idn.named, anchor: sh.anchor,
                        rect: { ...sh.rect }, Lmin: sh.Lmin, Lmax: sh.Lmax, t: ++this._tombClock });
                }
                return;
            }
            let anchor = null, bd = Infinity;
            for (const x of xs) { const d = this._depth(x.home); if (d < bd || (d === bd && x.home === sh.anchor)) { bd = d; anchor = x.home; } }
            const S = this._mkScene(anchor, idn);
            if (anchor === sh.anchor && Number.isFinite(sh.ox) && Number.isFinite(sh.oy)) { S.ox = sh.ox; S.oy = sh.oy; }
            else { const b = this._homeBox(xs[0]), M = this.frames.map(xs[0].home, anchor); if (M) { S.ox = b[0] * M.s + M.ox; S.oy = b[1] * M.s + M.oy; } }
            xs.sort((a, b) => a.id - b.id);
            for (const x of xs) if (!this._file(S, x, true)) loose.push(x);
            if (Number.isInteger(sh.version)) { S.version = sh.version; S.vtag = typeof sh.vtag === "string" ? sh.vtag : ""; }
            if (Array.isArray(sh.parts)) S.parts = sh.parts.map((pt) => ({ idn: { id: pt.id, seq: pt.seq, name: pt.name, named: !!pt.named }, rect: { ...pt.rect } }));
            S.saved = { anchor: sh.anchor, rect: sh.rect || null, parts: (sh.parts || []).map((pt) => pt.rect) };
            if (S.members.size && !fitsSpread(S.Lmin, S.Lmax)) {
                // the saved membership no longer fits the widths: the members below the top 16× leave
                for (const x of [...S.members]) if (this.XD[x.slot * 8 + XL] < S.Lmax - SPREAD_OCT - EPS_L) { this._unfile(S, x); loose.push(x); }
                this._range(S);
            }
            if (!S.members.size) { this._drop(S); return; }
            if (S.members.size < members[i].length) lost.push(S);
        });
        for (const S of this.scenes) if (S.version >= this.ver) this.ver = S.version + 1;
        for (const S of lost) this._splitCheck(S, null, true);
        const legacy = !st && batch.restore.legacy && batch.restore.legacy.length ? batch.restore.legacy : null;
        loose.sort((a, b) => a.id - b.id);
        for (const x of loose) if (!x.scene) this._insert(x);
        if (legacy) for (const S of this.scenes) S.idn.born = this.batchNo;
        for (const S of this.scenes) S.frameDirty = true;
        // names given before the restore went out; a part's or a region's once they exist (after _finish)
        const late = [];
        for (const [id, name] of batch.renames || []) if (!this.rename(id, name)) late.push([id, name]);
        let out = this._finish(t0, legacy);
        if (late.length && late.some(([id, name]) => this.rename(id, name))) {
            this._echoes(); this._regions();   // a name can part two scenes' row
            out = { ...out, scenes: this.records(), export: this.exportState() };
        }
        for (const S of this.scenes) S.idn.born = -1;
        if (this.autoCompact) this._compact();
        return out;
    }
}
