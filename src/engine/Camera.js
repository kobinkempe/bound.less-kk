/**
 * Camera — the view transform and the crossing state machine. Owns the active
 * FRAME (see LevelMap / docs/local-frames-design-bible.md), inScale, inPan{X,Y};
 * applies pan/zoom/pinch; and crosses frames when in-frame zoom leaves
 * [exit, enter]. `activeLevel` survives as a depth façade — the UI, scale bar,
 * scenes, and legacy snapshots speak depth ints; identity is the frame id.
 *
 * The crossing math is the verbatim {s,t} record arithmetic of the old engine
 * (drift-free round-trip by construction). What changed with frames: crossing
 * UP consults ensureChild, which reuses a child only when the entry point lands
 * within REUSE_RADIUS of it and spawns a locally-anchored sibling otherwise —
 * the fix for float64 exhaustion after zoom-out → pan far → zoom-in.
 */
export default class Camera {
    constructor(levelMap, cfg, hooks = {}) {
        this.lm = levelMap;
        this.cfg = cfg;
        this.frame = "0";
        this.inScale = 1; this.inPanX = 0; this.inPanY = 0;
        // hooks: onCross(from,to), finalizeLiveStroke()
        this.hooks = hooks;
    }

    get activeLevel() { const d = this.lm.depthOf(this.frame); return d == null ? 0 : d; }
    // Legacy setter (tests/tools): jump to the SPINE frame at that depth.
    set activeLevel(v) { this.frame = this.lm.ensureSpine(v); }

    set(camera) {
        if (camera.frame != null && this.lm.frame(camera.frame)) this.frame = camera.frame;
        else this.frame = this.lm.ensureSpine(camera.activeLevel || 0);
        this.inScale = camera.inScale; this.inPanX = camera.inPanX; this.inPanY = camera.inPanY;
    }
    state() { return { activeLevel: this.activeLevel, frame: this.frame, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY }; }

    screenToFrame(sx, sy) { return [(sx - this.inPanX) / this.inScale, (sy - this.inPanY) / this.inScale]; }

    // Visible window in frame coords, expanded by `margin` frame units.
    frameWindow(margin = 0) {
        const inv = 1 / this.inScale;
        return {
            left: (0 - this.inPanX) * inv - margin, top: (0 - this.inPanY) * inv - margin,
            right: (this.lm.width - this.inPanX) * inv + margin, bottom: (this.lm.height - this.inPanY) * inv + margin,
        };
    }

    panBy(dx, dy) { this.inPanX += dx; this.inPanY += dy; }

    zoomFactorAt(sx, sy, factor) {
        // A non-positive factor would drive inScale ≤ 0, below `exit` FOREVER —
        // _maybeCross would then cross down in an infinite loop (×3000 of a
        // negative number never climbs back above exit). Refuse bad input.
        if (!(factor > 0) || !Number.isFinite(factor)) return false;
        if (this.hooks.finalizeLiveStroke) this.hooks.finalizeLiveStroke();
        const ns = this.inScale * factor;
        this.inPanX = sx - ((sx - this.inPanX) / this.inScale) * ns;
        this.inPanY = sy - ((sy - this.inPanY) / this.inScale) * ns;
        this.inScale = ns;
        return this._maybeCross();
    }
    zoomAt(sx, sy, deltaY) { return this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    pinchUpdate(mx, my, factor, dx, dy) { this.inPanX += dx; this.inPanY += dy; return this.zoomFactorAt(mx, my, factor); }

    // Cross until in-frame zoom is back inside [exit, enter]. Returns true if any
    // crossing happened (the caller re-bakes/re-renders once, after the settle).
    _maybeCross() {
        const from = this.activeLevel;
        let crossed = false;
        while (this.inScale > this.cfg.enter) { this._crossUp(); crossed = true; }
        while (this.inScale < this.cfg.exit) { this._crossDown(); crossed = true; }
        if (crossed && this.hooks.onCross) this.hooks.onCross(from, this.activeLevel);
        return crossed;
    }
    _crossUp() {
        const base = this.cfg.base;
        const child = this.lm.ensureChild(this.frame, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = child.edge;
        const nis = this.inScale * base / s;            // -> ~base
        this.inPanX = this.inPanX - t.x * nis / base;   // place current view in the fixed grid
        this.inPanY = this.inPanY - t.y * nis / base;
        this.inScale = nis;
        this.frame = child.id;
    }
    _crossDown() {
        const base = this.cfg.base;
        const edge = this.lm.ensureParentEdge(this.frame, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = edge;
        const cur = this.inScale, px = this.inPanX, py = this.inPanY;
        this.frame = this.lm.parentOf(this.frame);
        this.inScale = (s / base) * cur;
        this.inPanX = (t.x / base) * cur + px;
        this.inPanY = (t.y / base) * cur + py;
    }

    effectiveZoom() { return this.lm.effectiveZoom(this.frame, this.inScale); }
    levelPointToScreen(key, x, y) {
        return this.lm.framePointToScreen(key, x, y, this.frame, this.inScale, this.inPanX, this.inPanY);
    }
}
