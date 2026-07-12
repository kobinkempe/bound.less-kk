/**
 * Camera — the view transform and the crossing state machine. Owns activeLevel,
 * inScale, inPan{X,Y}; applies pan/zoom/pinch; and crosses levels when in-level
 * zoom leaves [exit, enter], defining a level's frame on first entry (delegated
 * to LevelMap). No Two.js, no tiles, no objects.
 *
 * The crossing math is a verbatim port of KobinEngineV0._crossUp/_crossDown/
 * _maybeCross (drift-free round-trip by construction: it is pure {s,t} record
 * arithmetic). Side effects that used to be inlined — finalize the live stroke
 * before a zoom, rebuild/render after a settle — are hoisted to callbacks so the
 * facade wires them without the Camera knowing about the renderer.
 */
export default class Camera {
    constructor(levelMap, cfg, hooks = {}) {
        this.lm = levelMap;
        this.cfg = cfg;
        this.activeLevel = 0;
        this.inScale = 1; this.inPanX = 0; this.inPanY = 0;
        // hooks: onCross(from,to), finalizeLiveStroke()
        this.hooks = hooks;
    }

    set(camera) {
        this.activeLevel = camera.activeLevel;
        this.inScale = camera.inScale; this.inPanX = camera.inPanX; this.inPanY = camera.inPanY;
    }
    state() { return { activeLevel: this.activeLevel, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY }; }

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

    // Cross until in-level zoom is back inside [exit, enter]. Returns true if any
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
        const N = this.activeLevel + 1, base = this.cfg.base;
        const rec = this.lm.ensureUp(N, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = rec;
        const nis = this.inScale * base / s;            // -> ~base
        this.inPanX = this.inPanX - t.x * nis / base;   // place current view in the fixed grid
        this.inPanY = this.inPanY - t.y * nis / base;
        this.inScale = nis;
        this.activeLevel = N;
    }
    _crossDown() {
        const base = this.cfg.base;
        const rec = this.lm.ensureDown(this.activeLevel, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = rec;
        const cur = this.inScale, px = this.inPanX, py = this.inPanY;
        this.activeLevel -= 1;
        this.inScale = (s / base) * cur;
        this.inPanX = (t.x / base) * cur + px;
        this.inPanY = (t.y / base) * cur + py;
    }

    effectiveZoom() { return this.lm.effectiveZoom(this.activeLevel, this.inScale); }
    levelPointToScreen(level, x, y) {
        return this.lm.levelPointToScreen(level, x, y, this.activeLevel, this.inScale, this.inPanX, this.inPanY);
    }
}
