/**
 * LevelMap — the ladder. Owns the per-level crossing records and grids, and the
 * pure transforms between neighbouring levels. No camera, no objects, no Two.js.
 *
 * A level's record {s, t} is established the FIRST time it's crossed into and
 * reused forever (records[N] maps level N-1 → N: child = (parent*s + t)/base).
 * Levels extend up and down indefinitely — there is no ground level. Per-level
 * coordinates stay bounded because every transform is a single ×(s/base) step;
 * only crossings rebase.
 *
 * Grids: each record CAPTURES its grid at creation (window resizes must not
 * re-map cached tiles). Two levels can legitimately lack a record — level 0
 * before the first cross-down, and the coarsest level ever visited — so grid()
 * derives a grid on demand from the SAME camera-independent formula. We never
 * fabricate a crossing record just to hold a grid: {s,t} semantics are
 * "defined at first crossing, forever", and a made-up record would corrupt the
 * future mapping (and the snapshot round-trip).
 */
export default class LevelMap {
    constructor(cfg, width, height) {
        this.cfg = cfg;
        this.width = width; this.height = height;
        this.records = {}; // level -> { s, t: {x, y}, grid }
    }

    // ---- records ----
    get(level) { return this.records[level]; }
    has(level) { return !!this.records[level]; }

    // First entry going UP into level N defines the frame FOREVER. Pinning
    // s = enter (instead of capturing a possibly-overshot inScale) keeps every
    // re-entry at ~base — otherwise the hysteresis band can invert and the
    // threshold churns (see KobinEngineV0._crossUp for the full rationale).
    ensureUp(N, inScale, inPanX, inPanY) {
        if (this.records[N]) return this.records[N];
        const k = this.cfg.enter / inScale;
        this.records[N] = {
            s: this.cfg.enter,
            t: { x: inPanX * k, y: inPanY * k },
            grid: this.makeGrid(),
        };
        return this.records[N];
    }
    // First exit DOWN below `level` — the coarser neighbour doesn't exist yet.
    // s = enter keeps the hysteresis band symmetric; t places the current view
    // at the coarser grid's centre (pan' = 0).
    ensureDown(level, inScale, inPanX, inPanY) {
        if (this.records[level]) return this.records[level];
        this.records[level] = {
            s: this.cfg.enter,
            t: { x: -inPanX * this.cfg.base / inScale, y: -inPanY * this.cfg.base / inScale },
            grid: this.makeGrid(),
        };
        return this.records[level];
    }

    // ---- grids (fixed per level; derived deterministically when no record) ----
    // A tile spans the buffered window: k = 1 + 2*bufferScreens screens, with the
    // first-crossing screen in the MIDDLE of tile (0,0). Camera-independent.
    makeGrid() {
        const k = 1 + 2 * this.cfg.bufferScreens, base = this.cfg.base;
        const w = k * this.width / base, h = k * this.height / base;
        return { w, h, ox: this.width / (2 * base) - w / 2, oy: this.height / (2 * base) - h / 2 };
    }
    grid(level) {
        const rec = this.records[level];
        if (rec && rec.grid) return rec.grid;
        if (!this._derivedGrids) this._derivedGrids = {};
        if (!this._derivedGrids[level]) this._derivedGrids[level] = this.makeGrid();
        return this._derivedGrids[level];
    }
    tileRect(level, i, j) {
        const g = this.grid(level);
        return { left: g.ox + i * g.w, top: g.oy + j * g.h, right: g.ox + (i + 1) * g.w, bottom: g.oy + (j + 1) * g.h };
    }
    tileRange(level, rect) {
        const g = this.grid(level);
        return { i0: Math.floor((rect.left - g.ox) / g.w), i1: Math.floor((rect.right - g.ox) / g.w),
            j0: Math.floor((rect.top - g.oy) / g.h), j1: Math.floor((rect.bottom - g.oy) / g.h) };
    }

    // ---- single-step point transforms (records[N] maps N-1 → N) ----
    toChild(p, N) { const r = this.records[N], b = this.cfg.base; return [(p[0] * r.s + r.t.x) / b, (p[1] * r.s + r.t.y) / b]; }
    toParent(p, N) { const r = this.records[N], b = this.cfg.base; return [(p[0] * b - r.t.x) / r.s, (p[1] * b - r.t.y) / r.s]; }
    // Pre-image of a child-level rect in the parent level (for tile fault-in).
    rectToParent(rect, N) {
        const r = this.records[N], b = this.cfg.base;
        return { left: (rect.left * b - r.t.x) / r.s, top: (rect.top * b - r.t.y) / r.s,
            right: (rect.right * b - r.t.x) / r.s, bottom: (rect.bottom * b - r.t.y) / r.s };
    }

    // Map a point across ANY number of levels (from -> to) through the record
    // chain. Magnify (to > from) grows coordinates; minify shrinks them. Returns
    // null if a needed record is missing.
    mapPoint(p, from, to) {
        let x = p[0], y = p[1], L = from; const base = this.cfg.base;
        while (L < to) { const r = this.records[L + 1]; if (!r) return null; x = (x * r.s + r.t.x) / base; y = (y * r.s + r.t.y) / base; L++; }
        while (L > to) { const r = this.records[L]; if (!r) return null; x = (x * base - r.t.x) / r.s; y = (y * base - r.t.y) / r.s; L--; }
        return [x, y];
    }
    // Axis-aligned rect across levels (transforms are scale+translate, no
    // rotation, so the two opposite corners suffice).
    mapRect(rect, from, to) {
        const a = this.mapPoint([rect.left, rect.top], from, to);
        const b = this.mapPoint([rect.right, rect.bottom], from, to);
        if (!a || !b) return null;
        return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }

    // ---- cross-level walks ----
    // Map a point in `level` coords to current screen px (walk the record chain
    // to the active level, then apply the camera).
    levelPointToScreen(level, x, y, activeLevel, inScale, inPanX, inPanY) {
        const base = this.cfg.base; let px = x, py = y, L = level;
        while (L > activeLevel) { const r = this.records[L]; if (!r) return null; px = (px * base - r.t.x) / r.s; py = (py * base - r.t.y) / r.s; L--; }
        while (L < activeLevel) { const r = this.records[L + 1]; if (!r) return null; px = (px * r.s + r.t.x) / base; py = (py * r.s + r.t.y) / base; L++; }
        return [px * inScale + inPanX, py * inScale + inPanY];
    }
    effectiveZoom(activeLevel, inScale) {
        let z = inScale;
        for (let l = activeLevel; l >= 1; l--) { const r = this.records[l]; if (r) z *= (r.s / this.cfg.base); }
        for (let l = activeLevel + 1; l <= 0; l++) { const r = this.records[l]; if (r) z *= (this.cfg.base / r.s); }
        return z;
    }

    // ---- (de)serialization — exactly the dev-0 `crossings` shape ----
    serialize() {
        const out = {};
        for (const l of Object.keys(this.records)) {
            const r = this.records[l];
            out[l] = { s: r.s, t: { x: r.t.x, y: r.t.y }, grid: { ...r.grid } };
        }
        return out;
    }
    load(crossings) {
        this.records = {};
        this._derivedGrids = null;
        for (const l of Object.keys(crossings || {})) {
            const r = crossings[l];
            this.records[+l] = { s: r.s, t: { x: r.t.x, y: r.t.y }, grid: r.grid ? { ...r.grid } : this.makeGrid() };
        }
    }
    resize(width, height) {
        // Captured grids stay valid (fixed per level); only the derivation
        // baseline for future records/grids changes.
        this.width = width; this.height = height;
        this._derivedGrids = null;
    }
}
