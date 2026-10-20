/**
 * MovePlane.js — the drag plane (PAPER-PLAN §10 S4, S4z and §10.14; B-drag-bitmap folded with Kobin's
 * 2026-09-22 rule: "recalculate the part of the tile under the object being moved, as soon as the
 * object is selected, so it is ready when you start moving it").
 *
 * The picture on screen is split BY Z into layers of plates, kept while a selection exists: BELOW
 * (everything under the selection, opaque, with the paper; a cell with none of its own ink is drawn as paper, with no
 * plate), then in paint order each run of selected
 * families (SEL, transparent, drawn translated by the pointer) and each run of unselected families
 * above one (OVER, transparent, drawn in place). The compose draws them in that order over the
 * ordinary plates, so a dragged object passes under what is above it at every frame.
 *
 * Nothing is refused. Past MOVE_PLANE_LAYERS a selected run is drawn on the other side of an unselected run beside it, the
 * pair whose swap changes the picture least (`merged`, F144). Each layer is cut at its own resolution, the first of CUTS that fits the
 * plate cap and, where the compose draws a layer plate by plate, its image cliff (F145); a coarser one is drawn magnified
 * (`coarse`), and the coarsest is taken whatever it costs (`overCap`). Layers are named by their members and resolution,
 * so a re-cut that changes either is a new layer. A QUICK level, PLANE_QUICK_OCTAVES under the plane's coarsest layer on
 * screen and inside the same cap, is asked for first: it is drawn until the plane's own level is whole. Until either is, the
 * selection's own layers are drawn alone where BELOW covers their start (H4), and a small selection's
 * are rendered on the spot (`RasterRenderer._pyrStopgap`). A drag held still is REFINED (`refineAt`): what of the selection
 * is then on screen is cut again, sharper, inside the same cap, and drawn in place of its coarser layers once whole.
 *
 * Where each layer is needed: SEL at the selection's own cells, OVER at its families' cells, BELOW
 * at the union of all of them. The layers are cut on `rasterPack.paintFamilies`, the pack's own
 * family order, from the list the selection was made in: the drag does not rebuild the list. The
 * plates live in the store, pinned (`setPlanePins`), keyed `planeKey(F, Zp, tag, i, j)` at each layer's own zoom Zp
 * (the view's grid Z, `/ 2^k` coarser; A3 §6); a level is whole only when every plate is exact, and a SEL run is cut
 * against the view grown by one view each way (D1). The pin caps are `level.js`'s `MOVE_PLANE_PLATES(_PHONE)`.
 */

import { PLATE_PX } from "./plate";
import { paintFamilies, parseColour } from "./rasterPack";
import { COMPOSE_IMAGES, planeKey } from "./level";

/** Layers a plane may split the picture into (below, sel, between, sel, above); past it runs are merged. */
export const MOVE_PLANE_LAYERS = 5;
/** Octaves a layer may be cut coarser than the view to fit the cap. */
const PLANE_COARSEN_MAX = 3;
/**
 * A level's resolutions in octaves under the view's, [BELOW and OVER, a SEL run on the view, its D1 margin], in the
 * order tried: what the selection moves over sharpest first (PERF-DEEP decision 2; Kobin's reports 2026-10-19, the
 * unrelated ink at ¼), then the selection on screen, then its margin (F145).
 */
const CUTS = [];
for (let kB = 0; kB <= PLANE_COARSEN_MAX; kB++) {
    for (let kN = 0; kN <= PLANE_COARSEN_MAX; kN++) for (let kM = kN; kM <= PLANE_COARSEN_MAX; kM++) CUTS.push([kB, kN, kM]);
}
/** The quick level: this many octaves under the plane's coarsest layer, asked for first. */
export const PLANE_QUICK_OCTAVES = 2;
/** A plane of at most this many plates has no quick level: it is as quick. */
const PLANE_QUICK_MIN = 4;
/**
 * The longest a landing plane waits for the fresh plates — a safety limit, counted in `landTimeouts`;
 * a view change ends it sooner. At B's 600 ms a busy main thread ended it on the stale picture and
 * the object jumped back until its plates landed (review minor 6).
 */
export const MOVE_HOLD_MS = 3000;

export const planeStats = {
    builds: 0, merged: 0, coarse: 0, overCap: 0, requests: 0, drags: 0, notReady: 0, lost: 0, refines: 0, refinesWhole: 0,
    quickSteps: 0, partialSteps: 0, stopgaps: 0, stopgapMsMax: 0,
    lands: 0, landTimeouts: 0, landMsMax: 0,
    composes: 0, underBlits: 0, inkBlits: 0, overBlits: 0, clipComposes: 0, maxLayers: 0,
    farListFallbacks: 0,   // a far level that never got its own list and packs from the camera's (F122's paper risk)
};

export function resetPlaneStats() { for (const k of Object.keys(planeStats)) planeStats[k] = 0; }

/** An order-free name for an id set: a sum and a xor of each id's mix, and the count (no strings, no sort). */
function idsHash(ids) {
    let a = 0, b = 0;
    for (const id of ids) {
        let h = Math.imul(Number(id) ^ 0x9e3779b9, 0x85ebca6b);
        h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
        a = (a + h) | 0; b ^= h;
    }
    return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36) + "." + ids.size;
}

/** Bounding plate range of a cell list, or null. */
function rangeOf(cells) {
    if (!cells.length) return null;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [i, j] of cells) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    return { i0, i1, j0, j1 };
}

/** Items' colours on the view's cells (grown by w, h each way): colour and opacity → { rgb, a, area in cells }. */
function colours(items, s, view, w, h) {
    const out = new Map();
    for (const d of items) {
        const b = d.box, x = Math.min(b[2] * s, view.i1 + 1 + w) - Math.max(b[0] * s, view.i0 - w), y = Math.min(b[3] * s, view.j1 + 1 + h) - Math.max(b[1] * s, view.j0 - h);
        if (!(x > 0 && y > 0)) continue;
        const a = d.o.opacity == null ? 1 : d.o.opacity, k = d.o.color + "/" + a, c = out.get(k);
        if (c) c.area += x * y; else out.set(k, { rgb: parseColour(d.o.color), a, area: x * y });
    }
    return out;
}

const unionRange = (a, b) => (!a ? b : { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) });

export default class MovePlane {
    constructor() {
        this.stats = planeStats;      // the layer counts into it without importing this module
        this.gen = 0;                 // bumped by every reset: the caller frees the old plates when it moves
        this._reset();
    }

    _reset() {
        this.sel = null;          // the engine's selection identity the plane was built for
        this.ids = null;          // the selection's ids in that list
        this.list = null;
        this.vr = "";             // the view's plate range the layers were cut over
        this.frameId = null; this.Zq = 1;   // the VIEW the plane was cut for: its frame and grid zoom
        this.main = null;         // the plane's own level: { k, pZq, layers, keys, tags, plates, frame, scaled, r, selR, farR }
        this.quick = null;        // the quick level, coarser, or null
        this.refine = null;       // a held drag's sharper cut of the selection on screen (`refineAt`), or null
        this.cur = null;          // the level drawn this compose
        this.partial = false;     // `cur` drawn by its selected layers alone (not whole yet)
        this.layers = [];         // the main level's layers: [{ kind: "below"|"sel"|"over", k, pZq, tag, cells, ids?, omit?, foot?, hole? }]
        this.selIds = null;       // every selected id the layers carry: what other packs omit during the drag
        this.max = 0;
        this.tags = [];           // every level's tags
        this.r = null;            // the main level's BELOW cells, bounded, in the view's cells
        this.selR = null;         // the main level's selected cells, bounded, in the view's cells
        this.keys = [];           // every level's keys, pinned in the store
        this.state = "idle";      // idle | drag | land
        this.ready = false;       // the main level cached
        this.off = [0, 0];        // device px, whole
        this.landUntil = 0;
        this.landAt = 0;
        this.refused = false;
        this.gen = (this.gen || 0) + 1;
    }

    /** Is a plane drawn this compose? */
    get showing() { return this.state === "drag" || this.state === "land"; }

    /** Plates the plane pins. */
    cellCount() { return this.keys.length + (this.refine ? this.refine.keys.length : 0); }

    /** Every key the plane pins: its levels' and a refine's. */
    pins() { return this.refine ? this.keys.concat(this.refine.keys) : this.keys; }

    /**
     * (Re)aim the plane at a selection, a list and a view. Returns true when the plane is (still)
     * valid for them; a change of selection, frame or zoom resets it (the caller frees the old tags,
     * `gen`). A new list, or a view over other plates, with the same selection re-cuts the layers,
     * so a pan keeps what is cached (the Stage's items keep their array while the table does). `cliff`: the most images
     * a frame may draw with one scaled — Infinity when the compose draws each layer from one surface.
     */
    aim(st, list, view, cfg, max, dpr = 1, cliff = COMPOSE_IMAGES) {
        if (this.state === "drag" || this.state === "land") return true;
        const same = st && this.sel === st.key && this.frameId === view.frameId && this.Zq === view.Zq;
        if (!same) {
            this._reset();
            if (!st || !st.ids || !st.ids.size) return false;
            this.sel = st.key; this.frameId = view.frameId; this.Zq = view.Zq;
            planeStats.builds++;
        }
        const vr = view.i0 + "," + view.i1 + "," + view.j0 + "," + view.j1;
        if (this.list !== list || this.ids !== st.ids || this.max !== max || this.vr !== vr || this.cliff !== cliff) {
            this.list = list; this.ids = st.ids; this.max = max; this.vr = vr; this.cliff = cliff;
            this._cut(list, st.ids, view, cfg, max, dpr, cliff);
        }
        return !this.refused;
    }

    /** The runs: the pack's families in paint order, cut into selected and unselected ones on screen. */
    _cut(list, ids, view, cfg, max, dpr, cliff = COMPOSE_IMAGES) {
        this.main = null; this.quick = null; this.refine = null; this.cur = null; this.ready = false; this.partial = false;
        this.layers = []; this.keys = []; this.tags = []; this.r = null; this.selR = null; this.selIds = null; this.refused = true;
        const s = view.Zq / PLATE_PX;
        // D1: a selected family counts when it touches the view grown by one view each way.
        const gw = view.i1 - view.i0 + 1, gh = view.j1 - view.j0 + 1;
        const runs = [], fams = [];
        for (const f of paintFamilies(list, 0, view.Zq, dpr, cfg)) {
            if (f.all.length && f.all.every((d) => d.o.erase)) continue;   // a pending mark paints nothing: every layer's pack masks with it
            if (f.all.length) fams.push(f);
            const sel = f.all.some((d) => ids.has(d.o.id)), w = sel ? gw : 0, h = sel ? gh : 0;
            let on = false;
            for (const d of f.all) {
                const b = d.box;
                if (Math.floor(b[2] * s) >= view.i0 - w && Math.floor(b[0] * s) <= view.i1 + w && Math.floor(b[3] * s) >= view.j0 - h && Math.floor(b[1] * s) <= view.j1 + h) on = true;
            }
            if (!on) continue;                             // nothing on screen: it can neither cover nor be covered here
            let run = runs[runs.length - 1];
            if (!run || run.sel !== sel) runs.push(run = { sel, ids: new Set(), boxes: [], items: [] });
            for (const d of f.all) { run.ids.add(d.o.id); run.boxes.push(d.box); run.items.push(d); }
        }
        if (!runs.some((r) => r.sel)) { this.refused = true; return; }   // nothing selected on screen
        if (!runs[0].sel) runs.shift();                    // BELOW is everything else, by `omit`
        const nLayers = runs.length + 1;
        if (nLayers > planeStats.maxLayers) planeStats.maxLayers = nLayers;
        // Past the layer cap, a selected run is drawn on the other side of an unselected one beside it: lifted over it into
        // the selected run above, or dropped under it into the one below, the unselected run joining its own neighbour at
        // its depth. Only that pair's order changes, and two layers' orders differ by αa·αb·(Cb − Ca) a channel, nothing
        // in one colour (a cut-out beside its own remnant), so the pair taken is the one whose swap shows least,
        // Σ area·area·α·α·|ΔC| over their colours on the view (Kobin 2026-10-19). Sinking the run under the whole selection
        // drew R1's black disc over the band it lies under (F144).
        if (runs.length + 1 > MOVE_PLANE_LAYERS) {
            for (const r of runs) r.col = colours(r.items, s, view, r.sel ? gw : 0, r.sel ? gh : 0);
            const cost = (u, r) => {
                let c = 0;
                for (const x of u.col.values()) {
                    for (const y of r.col.values()) c += x.area * y.area * x.a * y.a * (Math.abs(x.rgb[0] - y.rgb[0]) + Math.abs(x.rgb[1] - y.rgb[1]) + Math.abs(x.rgb[2] - y.rgb[2]));
                }
                return c;
            };
            const join = (into, r) => {
                for (const id of r.ids) into.ids.add(id);
                for (const x of r.boxes) into.boxes.push(x);
                for (const [k, y] of r.col) { const x = into.col.get(k); if (x) x.area += y.area; else into.col.set(k, { ...y }); }
            };
            while (runs.length + 1 > MOVE_PLANE_LAYERS) {
                let m = -1, up = false, best = Infinity;
                for (let k = 1; k < runs.length - 1; k++) {
                    if (runs[k].sel) continue;
                    const lift = cost(runs[k], runs[k - 1]), drop = cost(runs[k], runs[k + 1]);
                    if (lift < best) { best = lift; m = k; up = true; }
                    if (drop < best) { best = drop; m = k; up = false; }
                }
                if (m < 0) break;
                if (up) {
                    join(runs[m + 1], runs[m - 1]); runs.splice(m - 1, 1);
                    if (m >= 2) { join(runs[m - 2], runs[m - 1]); runs.splice(m - 1, 1); } else runs.shift();   // the first: BELOW's
                } else {
                    join(runs[m - 1], runs[m + 1]); runs.splice(m + 1, 1);
                    if (m + 1 < runs.length) { join(runs[m], runs[m + 1]); runs.splice(m + 1, 1); }
                }
                planeStats.merged++;
            }
        }
        this.selIds = new Set();
        for (const r of runs) if (r.sel) for (const id of r.ids) this.selIds.add(id);
        // BELOW's own ink: the boxes of the families no run takes (whole families: one member tells).
        const taken = new Set(), own = [];
        for (const r of runs) for (const id of r.ids) taken.add(id);
        for (const f of fams) if (!taken.has(f.all[0].o.id)) for (const d of f.all) own.push(d.box);
        // The first cut inside the cap and, when a plate is drawn magnified (or the view is between quanta), the compose
        // cliff: past ~33 distinct images a frame with one scaled, Chrome's 2D canvas flushes per image (4 scaled + 32
        // at 1:1: 37 ms, PAPER-PLAN §10.14); none when each layer is drawn from one surface.
        const C = this._cells(runs, view, own);
        const fits = (x) => { const c = this._count(runs, view, x, C); return c.plates <= max && (!c.scaled || c.frame <= cliff); };
        // Nothing on screen is cut coarser than one resolution for all would be (`ku`); the margin may be.
        let ku = 0;
        while (ku < PLANE_COARSEN_MAX && !fits([ku, ku, ku])) ku++;
        let ks = CUTS.find((x) => x[0] <= ku && x[1] <= ku && fits(x));
        if (!ks) { ks = [ku, ku, ku]; planeStats.overCap++; }   // the coarsest whatever it costs: a drag always moves
        const main = this._level(runs, view, ks, C);
        if (main.k) planeStats.coarse++;
        if (main.plates > PLANE_QUICK_MIN) {
            // Pinned with the main level: both inside the one cap. Its margin no finer than the main level's (the same plates).
            const q = main.kOn + PLANE_QUICK_OCTAVES, Q = this._level(runs, view, [q, q, Math.max(q, ks[2])], C);
            if (Q.plates < main.plates && main.plates + Q.plates <= max && Q.frame <= cliff) this.quick = Q;
        }
        this.main = main;
        this.layers = main.layers;
        this._runs = runs; this._C = C;
        this.r = main.r; this.selR = main.selR;
        for (const L of [main, this.quick]) if (L) { for (const t of L.tags) this.tags.push(t); for (const key of L.keys) this.keys.push(key); }
        this.refused = false;
    }

    /**
     * The runs' cells at each resolution, made once a cut: `on(n, k)` run n's on the view, `grown(n, k)` over D1's grown
     * view, `margin(n, kN, kM)` its grown ones at kM but those wholly inside `hole(kN)` (the near layer's view cells: the
     * margin is drawn only outside them), `under(k)` every run's on the view (where BELOW is drawn): `inked(k)` those that
     * hold BELOW's own ink (`own`, boxes), its plates, and `paper(k)` the rest; `screen(k)` the most plates a screen meets.
     */
    _cells(runs, view, own = []) {
        const gw = view.i1 - view.i0 + 1, gh = view.j1 - view.j0 + 1, memo = new Map();
        const rangeAt = (k, w, h) => {
            const f = 2 ** -k;
            return { i0: Math.floor((view.i0 - w) * f), i1: Math.floor((view.i1 + 1 + w) * f - 1e-9), j0: Math.floor((view.j0 - h) * f), j1: Math.floor((view.j1 + 1 + h) * f - 1e-9) };
        };
        const cellsOf = (boxes, k, v) => {
            const s = view.Zq / 2 ** k / PLATE_PX, out = new Set();
            for (const b of boxes) {
                const i0 = Math.max(Math.floor(b[0] * s), v.i0), i1 = Math.min(Math.floor(b[2] * s), v.i1);
                const j0 = Math.max(Math.floor(b[1] * s), v.j0), j1 = Math.min(Math.floor(b[3] * s), v.j1);
                for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.add(i + "," + j);
            }
            return out;
        };
        const get = (key, make) => { let v = memo.get(key); if (!v) memo.set(key, (v = make())); return v; };
        const C = {
            hole: (k) => get("h" + k, () => { const v = rangeAt(k, 0, 0), e = 2 ** k; return { i0: v.i0 * e, i1: (v.i1 + 1) * e - 1, j0: v.j0 * e, j1: (v.j1 + 1) * e - 1 }; }),
            on: (n, k) => get("o" + n + "," + k, () => cellsOf(runs[n].boxes, k, rangeAt(k, 0, 0))),
            grown: (n, k) => get("g" + n + "," + k, () => cellsOf(runs[n].boxes, k, rangeAt(k, gw, gh))),
            margin: (n, kN, kM) => get("m" + n + "," + kN + "," + kM, () => {
                const h = C.hole(kN), e = 2 ** kM, out = new Set();
                for (const c of C.grown(n, kM)) {
                    const [i, j] = c.split(",").map(Number);
                    if (!(i * e >= h.i0 && (i + 1) * e - 1 <= h.i1 && j * e >= h.j0 && (j + 1) * e - 1 <= h.j1)) out.add(c);
                }
                return out;
            }),
            under: (k) => get("u" + k, () => { const out = new Set(); runs.forEach((r, n) => { for (const c of C.on(n, k)) out.add(c); }); return out; }),
            inked: (k) => get("b" + k, () => {
                const u = C.under(k), out = new Set(), s = view.Zq / 2 ** k / PLATE_PX, v = rangeAt(k, 0, 0);
                for (const b of own) {
                    if (out.size === u.size) break;
                    const i0 = Math.max(Math.floor(b[0] * s), v.i0), i1 = Math.min(Math.floor(b[2] * s), v.i1);
                    const j0 = Math.max(Math.floor(b[1] * s), v.j0), j1 = Math.min(Math.floor(b[3] * s), v.j1);
                    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = i + "," + j; if (u.has(c)) out.add(c); }
                }
                return out;
            }),
            paper: (k) => get("p" + k, () => { const ink = C.inked(k), out = new Set(); for (const c of C.under(k)) if (!ink.has(c)) out.add(c); return out; }),
            screen: (k) => (Math.ceil(gw / 2 ** k) + 1) * (Math.ceil(gh / 2 ** k) + 1),
            view: rangeAt(0, 0, 0),
            cellsOf,
        };
        return C;
    }

    /**
     * A cut's plates; `frame`, the most distinct images a frame draws of them (a SEL layer at most a screen's: a plate off
     * the screen is not drawn); `scaled`, whether any is drawn magnified.
     */
    _count(runs, view, [kB, kN, kM], C) {
        let plates = 0, frame = 0, scaled = view.s !== 1;
        const add = (n, k, all) => { if (!n) return; plates += n; frame += all ? n : Math.min(n, C.screen(k)); if (k) scaled = true; };
        add(C.inked(kB).size, kB, true);
        runs.forEach((r, n) => {
            if (!r.sel) add(C.on(n, kB).size, kB, true);
            else if (kN === kM) add(C.grown(n, kN).size, kN, false);
            else { add(C.margin(n, kN, kM).size, kM, false); add(C.on(n, kN).size, kN, true); }
        });
        return { plates, frame, scaled };
    }

    /**
     * The layers cut `[kB, kN, kM]` octaves under the view (BELOW and OVER, a SEL run on the view, its D1 margin): cells,
     * tags, keys, and `_count`'s numbers. With kN < kM a SEL run is two layers: its margin, drawn only outside the near
     * layer's view cells (`hole`), then the near one (F145). `k` is the coarsest layer's, `kOn` the coarsest on screen's.
     */
    _level(runs, view, [kB, kN, kM], C) {
        const omit = new Set(), layers = [{ kind: "below", k: kB, cells: C.inked(kB), paper: C.paper(kB), omit }];
        runs.forEach((r, n) => {
            for (const id of r.ids) omit.add(id);
            if (!r.sel) layers.push({ kind: "over", k: kB, cells: C.on(n, kB), ids: r.ids, n });
            else if (kN === kM) layers.push({ kind: "sel", k: kN, cells: C.grown(n, kN), ids: r.ids, n });
            else {
                const m = C.margin(n, kN, kM);
                if (m.size) layers.push({ kind: "sel", k: kM, cells: m, ids: r.ids, n, hole: C.hole(kN) });
                layers.push({ kind: "sel", k: kN, cells: C.on(n, kN), ids: r.ids, n });
            }
        });
        const tags = [], keys = [];
        let k = 0, kOn = 0;
        for (const L of layers) {
            L.cells = [...L.cells].map((c) => c.split(",").map(Number));
            if (L.paper) L.paper = [...L.paper].map((c) => c.split(",").map(Number));
            L.pZq = view.Zq / 2 ** L.k;                                // A3 §6: Zp / 2^k, the layer's own grid
            // Named by what the layer holds and at what resolution: a re-cut that changes either is a new layer, not the old plates.
            L.tag = "z" + (L.kind === "below" ? 0 : L.n + 1) + (L.hole ? "m" : "") + "_" + L.k + "_" + idsHash(L.kind === "below" ? L.omit : L.ids);
            tags.push(L.tag);
            if (L.cells.length && L.k > k) k = L.k;
            if (L.cells.length && !L.hole && L.k > kOn) kOn = L.k;
            for (const [i, j] of L.cells) keys.push(this._key(L.tag, L.pZq, i, j));
        }
        // A BELOW or OVER plate's `foot`: it holds a view cell the selection starts on (a SEL layer's but a margin's).
        // A partial level and the stopgap draw those alone.
        const V = C.view, foot = new Set();
        for (const L of layers) {
            if (L.kind !== "sel" || L.hole) continue;
            const n = 2 ** L.k;
            for (const [i, j] of L.cells) {
                for (let y = Math.max(j * n, V.j0); y <= Math.min((j + 1) * n - 1, V.j1); y++) for (let x = Math.max(i * n, V.i0); x <= Math.min((i + 1) * n - 1, V.i1); x++) foot.add(x + "," + y);
            }
        }
        for (const L of layers) {
            if (L.kind === "sel") continue;
            const n = 2 ** L.k;
            L.foot = new Set();
            for (const [i, j] of L.paper ? L.cells.concat(L.paper) : L.cells) {
                let at = false;
                for (let y = j * n; y < (j + 1) * n && !at; y++) for (let x = i * n; x < (i + 1) * n && !at; x++) at = foot.has(x + "," + y);
                if (at) L.foot.add(i + "," + j);
            }
        }
        // Bounded, in the view's cells: BELOW's with its paper (`r`), the selection's (`selR`), the far layers' plates'
        // (`farR`, k > 2: their own table).
        let r = null, selR = null, farR = null;
        const inView = (q, n) => ({ i0: q.i0 * n, i1: (q.i1 + 1) * n - 1, j0: q.j0 * n, j1: (q.j1 + 1) * n - 1 });
        for (const L of layers) {
            const n = 2 ** L.k, q = rangeOf(L.cells), c = L.paper ? rangeOf(L.cells.concat(L.paper)) : q;
            if (L.kind === "below" && c) r = inView(c, n);
            if (!q) continue;
            if (L.kind === "sel") selR = unionRange(selR, inView(q, n));
            if (L.k > 2) farR = unionRange(farR, inView(q, n));
        }
        return { k, kOn, pZq: view.Zq / 2 ** k, layers, tags, keys, ...this._count(runs, view, [kB, kN, kM], C), r, selR, farR };
    }

    /**
     * The levels with layers whose plates overhang the camera's table: it reads four view cells past the screen (A3 §4.2),
     * and a plate `k` octaves coarser spans 2^k of them, so past k = 2 one packed from the table would hold paper where
     * ink is (REVIEWER-4 P-2). Such a level gets its own table over `coverOf`, read at idle (`listPending` until then;
     * `requests` leaves those layers out meanwhile).
     */
    farLevels() {
        return [this.quick, this.main].filter((lvl) => lvl && lvl.list === undefined && !lvl.listPending && lvl.farR);
    }
    /** The rect, in frame units, a level's far layers' plates cover. */
    coverOf(lvl) {
        const r = lvl.farR, u = PLATE_PX / this.Zq;
        return r ? { left: r.i0 * u, top: r.j0 * u, right: (r.i1 + 1) * u, bottom: (r.j1 + 1) * u } : null;
    }

    /** One request per layer, the quick level's first: its cells and what the pack needs (a far layer's own table); null when refused. */
    requests() {
        if (this.refused || !this.main || this.state === "land") return null;
        const out = [];
        for (const lvl of [this.quick, this.main, this.refine]) {
            if (!lvl) continue;
            for (const L of lvl.layers) {
                const far = L.k > 2;
                if (far && lvl.listPending) continue;
                const list = far ? lvl.list || null : null;
                const base = { frameId: this.frameId, Zq: L.pZq, tag: L.tag, list, G: list ? lvl.G : null, cells: L.cells };
                out.push(L.kind === "below" ? { ...base, omit: L.omit } : { ...base, only: L.ids, paper: [0, 0, 0, 0] });
            }
        }
        return out;
    }

    /**
     * A held drag (Kobin 2026-10-19: what slid in from past the screen stayed blurry "as I held it"): each SEL run's cells
     * on the screen at this offset, at the sharpest k under its coarsest layer that fits the cap beside the main level,
     * but those its near layer already draws (`hole`, as a margin). Once whole it is drawn over its run, every coarser SEL
     * layer clipped out of `R` (the screen it was cut for, in view cells): never both, so a translucent run composites
     * once. Null when nothing on screen is coarser, or nothing fits.
     */
    refineAt(v, W, H, max) {
        const main = this.main, runs = this._runs, C = this._C;
        if (!main || !runs) return null;
        const room = max - main.plates - (this.quick ? this.quick.plates : 0), [ox, oy] = this.off;
        const gx0 = (-v.dx - ox) / v.s + v.ox, gx1 = (W - v.dx - ox) / v.s + v.ox, gy0 = (-v.dy - oy) / v.s + v.oy, gy1 = (H - v.dy - oy) / v.s + v.oy;
        for (let k = 0; k < main.k; k++) {
            const f = PLATE_PX * 2 ** k, e = 2 ** k;
            const R = { i0: Math.floor(gx0 / f), i1: Math.floor((gx1 - 1e-6) / f), j0: Math.floor(gy0 / f), j1: Math.floor((gy1 - 1e-6) / f) };
            const layers = [], keys = [];
            for (const N of main.layers) {
                if (N.kind !== "sel" || N.hole) continue;                // a run's near (or only) layer
                const M = main.layers.find((L) => L.hole && L.n === N.n);
                if ((M ? M.k : N.k) <= k) continue;                      // nothing of the run coarser than k
                const hole = M && N.k <= k ? M.hole : null, cells = [];
                for (const c of C.cellsOf(runs[N.n].boxes, k, R)) {
                    const [i, j] = c.split(",").map(Number);
                    if (!(hole && i * e >= hole.i0 && (i + 1) * e - 1 <= hole.i1 && j * e >= hole.j0 && (j + 1) * e - 1 <= hole.j1)) cells.push([i, j]);
                }
                if (!cells.length) continue;
                const L = { kind: "sel", k, pZq: this.Zq / e, tag: N.tag + "r" + k, cells, ids: N.ids, n: N.n, hole, refine: true, after: N };
                for (const [i, j] of cells) keys.push(this._key(L.tag, L.pZq, i, j));
                layers.push(L);
            }
            if (!layers.length) return null;                            // nothing coarser here: none at a coarser k either
            if (keys.length <= room) {
                return { k, R: { i0: R.i0 * e, i1: (R.i1 + 1) * e - 1, j0: R.j0 * e, j1: (R.j1 + 1) * e - 1 }, layers, keys, tags: layers.map((L) => L.tag), at: ox + "," + oy, whole: false, draw: null };
            }
        }
        return null;
    }

    /** Take a refine (null keeps the one there); its tags join the plane's, dropped with them. */
    setRefine(r) {
        if (!r) return;
        planeStats.refines++;
        this.refine = r;
        for (const t of r.tags) if (!this.tags.includes(t)) this.tags.push(t);
    }

    /** Is the refine's every plate cached and exact? */
    refineWhole(store) {
        const r = this.refine;
        if (!r) return false;
        if (!r.whole && this._whole(r, store)) { r.whole = true; planeStats.refinesWhole++; }
        return r.whole;
    }

    /** The quick level let go once the main level is whole: its pins are a refine's room. Returns its tags. */
    dropQuick() {
        const q = this.quick;
        if (!q) return [];
        this.quick = null;
        this.tags = this.tags.filter((t) => !q.tags.includes(t));
        this.keys = this.main.keys.slice();
        return q.tags;
    }

    /** The layers to draw for a level: the main one's with a whole refine after its runs' near layers. */
    drawLayers(lvl) {
        const r = this.refine;
        if (!lvl || lvl !== this.main || !r || !r.whole) return lvl ? lvl.layers : [];
        if (!r.draw) {
            r.draw = [];
            for (const L of lvl.layers) { r.draw.push(L); for (const x of r.layers) if (x.after === L) r.draw.push(x); }
        }
        return r.draw;
    }

    /** A plane plate's store key: `planeKey` at the layer's Zp (A3 §6). */
    _key(tag, pZq, i, j) { return planeKey(this.frameId, pZq, tag, i, j); }

    /** Is every plate of a level (its selected layers only, with `selOnly`) cached and exact (A3 §6)? */
    _whole(lvl, store, selOnly = false) {
        if (!lvl) return false;
        for (const L of lvl.layers) {
            if (selOnly && L.kind !== "sel") continue;
            for (const [i, j] of L.cells) {
                const e = store.get(this._key(L.tag, L.pZq, i, j));
                if (!e || e.dead || !store.exact(e)) return false;
            }
        }
        return true;
    }

    /** Is the main level cached? */
    checkReady(store) {
        if (!this.ready && this._whole(this.main, store)) this.ready = true;
        return this.ready;
    }

    /**
     * The level to draw: the main one whole, else the quick one whole, else the selected layers of
     * whichever has them in (the ink also shows where it was: `partial`). Null when none has.
     */
    pick(store) {
        this.partial = false;
        if (this.checkReady(store)) return (this.cur = this.main);
        if (this._whole(this.quick, store)) return (this.cur = this.quick);
        for (const lvl of [this.main, this.quick]) if (this._whole(lvl, store, true)) { this.partial = true; return (this.cur = lvl); }
        this.cur = null;
        return null;
    }

    /** The drag moved: the pointer's displacement since the drag's start, in device px. */
    dragTo(dxCss, dyCss, dpr) {
        if (this.state !== "drag") planeStats.drags++;
        this.state = "drag";
        this.off[0] = Math.round(dxCss * dpr);
        this.off[1] = Math.round(dyCss * dpr);
    }

    /** The drop: stay up until the cells are fresh, or `MOVE_HOLD_MS`. */
    land(now) {
        if (this.state !== "drag") return false;
        this.state = "land";
        this.landAt = now;
        this.landUntil = now + MOVE_HOLD_MS;
        planeStats.lands++;
        return true;
    }

    /** The view cells a landing plane still covers: the drawn level's cells and the selection's destination, bounded, in `v`'s grid. */
    landCells(v) {
        const lvl = this.cur || this.main;
        const r = lvl && lvl.r, sr = lvl && lvl.selR;
        if (!r || !sr) return null;
        const f = v.Zq / this.Zq;                             // the plane's view cells → `v`'s
        const ex = this.off[0] / (PLATE_PX * v.s), ey = this.off[1] / (PLATE_PX * v.s);   // the offset, in view plates
        const i0 = Math.min(Math.floor(r.i0 * f), Math.floor(sr.i0 * f + ex));
        const i1 = Math.max(Math.ceil((r.i1 + 1) * f) - 1, Math.ceil((sr.i1 + 1) * f + ex) - 1);
        const j0 = Math.min(Math.floor(r.j0 * f), Math.floor(sr.j0 * f + ey));
        const j1 = Math.max(Math.ceil((r.j1 + 1) * f) - 1, Math.ceil((sr.j1 + 1) * f + ey) - 1);
        return { i0: Math.max(i0, v.i0), i1: Math.min(i1, v.i1), j0: Math.max(j0, v.j0), j1: Math.min(j1, v.j1) };
    }
}
