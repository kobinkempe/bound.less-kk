/**
 * Camera — the view transform and the crossing state machine. Owns the active
 * FRAME (see LevelMap / docs/frame-lattice-design-bible.md), inScale,
 * inPan{X,Y}; applies pan/zoom/pinch; crosses frames when in-frame zoom leaves
 * [exit, enter]; and SHIFTS sideways when the view leaves its cell.
 * `activeLevel` survives as a depth facade — the UI, scale bar, scenes and
 * snapshots speak depth ints; identity is the frame id.
 *
 * WHAT CHANGED WITH THE LATTICE. Crossing up used to consult `ensureChild`,
 * which reused a child only when the entry point landed within REUSE_RADIUS of
 * it and spawned a locally-anchored sibling otherwise. That made "which frame
 * am I in" a function of HOW YOU GOT HERE, and a 1 px aim error at the top
 * minted new frames from depth 3 down (F-B). Now the child is the lattice cell
 * the view centre falls in — a division — so the same place is always the same
 * frame (P4).
 *
 * AND THE NEW ONE: a cell is a bounded region, about 3.2 screens across at the
 * shallowest in-level zoom, so panning can walk out of it. `_maybeShift` moves
 * the camera to the neighbouring cell, which is what keeps every stored
 * coordinate inside [-W/2, W/2) and stops a long pan from re-creating the
 * float64 exhaustion the frame tree exists to prevent. A shift is exact: the
 * offset is a whole number of cells.
 */
import { W, HALF_W } from "./frameLattice";

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
    set activeLevel(v) { this.frame = this.lm.ensureSpine(v); }

    set(camera) {
        if (camera.frame != null && this.lm.frame(camera.frame)) this.frame = camera.frame;
        else this.frame = this.lm.ensureSpine(camera.activeLevel || 0);
        this.inScale = camera.inScale; this.inPanX = camera.inPanX; this.inPanY = camera.inPanY;
    }
    state() { return { activeLevel: this.activeLevel, frame: this.frame, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY }; }

    screenToFrame(sx, sy) { return [(sx - this.inPanX) / this.inScale, (sy - this.inPanY) / this.inScale]; }

    frameWindow(margin = 0) {
        const inv = 1 / this.inScale;
        return {
            left: (0 - this.inPanX) * inv - margin, top: (0 - this.inPanY) * inv - margin,
            right: (this.lm.width - this.inPanX) * inv + margin, bottom: (this.lm.height - this.inPanY) * inv + margin,
        };
    }

    /** The view centre, in the active frame's own coordinates. */
    centre() { return [(this.lm.width / 2 - this.inPanX) / this.inScale, (this.lm.height / 2 - this.inPanY) / this.inScale]; }

    panBy(dx, dy) { this.inPanX += dx; this.inPanY += dy; return this._settle(); }

    zoomFactorAt(sx, sy, factor) {
        // A non-positive factor would drive inScale <= 0, below `exit` FOREVER —
        // _maybeCross would then cross down in an infinite loop (xR of a
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

    /**
     * Move to the cell the view centre is actually in, without changing depth.
     * Pure bookkeeping: the world does not move, only which cell's coordinates
     * describe it. The offset is a whole number of cells, so the pan adjustment
     * is exact.
     */
    _maybeShift() {
        // NEVER under the pen. A stroke's samples are appended in the frame it
        // was started in, so moving the frame mid-gesture would append points
        // measured against a different origin and tear the stroke in half. A
        // crossing already finalizes the live stroke before it fires; a lateral
        // shift does not have to, because the only cost of waiting is that the
        // stroke's own coordinates run past its cell — and D9 promotes it at
        // pen-up, which is what that rule is for.
        if (this.hooks.holdFrame && this.hooks.holdFrame()) return false;
        const [cx, cy] = this.centre();
        if (cx >= -HALF_W && cx < HALF_W && cy >= -HALF_W && cy < HALF_W) return false;
        const di = Math.floor((cx + HALF_W) / W), dj = Math.floor((cy + HALF_W) / W);
        const to = this.lm.neighbour(this.frame, di, dj);
        if (!to || to.id === this.frame) return false;
        this.frame = to.id;
        this.inPanX += di * W * this.inScale;
        this.inPanY += dj * W * this.inScale;
        return true;
    }

    /**
     * Put the camera into a LEGAL state: in-frame zoom inside [exit, enter], and
     * in the cell the view centre is actually in.
     *
     * A loaded file can land outside that band — a snapshot records whatever the
     * camera was, and a converted one is rescaled — and until something crossed,
     * the first interaction paid for it. Measured on one of Kobin's recordings:
     * the first pan after a load cost 200 ms and every pan after it cost 0.2 ms,
     * because the first one was really a crossing with a full re-bake behind it.
     */
    settle() { return this._settle(); }

    // Cross until in-frame zoom is back inside [exit, enter], shifting sideways
    // whenever the view has walked out of its cell. Returns true if the active
    // frame changed at all (the caller re-bakes/re-renders once, after settling).
    _maybeCross() { return this._settle(); }
    _settle() {
        const from = this.activeLevel;
        const was = this.frame;
        let guard = 0;
        for (;;) {
            let did = this._maybeShift();
            if (this.inScale > this.cfg.enter) { this._crossUp(); did = true; }
            else if (this.inScale < this.cfg.exit) { this._crossDown(); did = true; }
            if (!did) break;
            if (++guard > 64) break;   // cannot happen; never spin on bad input
        }
        const changed = this.frame !== was;
        if (changed && this.hooks.onCross) this.hooks.onCross(from, this.activeLevel);
        return changed;
    }
    _crossUp() {
        const base = this.cfg.base;
        const child = this.lm.ensureChild(this.frame, this.inScale, this.inPanX, this.inPanY);
        // THE CHILD MAY BELONG TO THE NEIGHBOUR (F45, 2026-09-05). The strip
        // [W/2 - G/2, W/2) of this frame is the neighbour's extreme cell — cells
        // are centred on their index (bible 10.2) — and `_maybeShift` above uses
        // the half-open [-W/2, W/2) while `_viewCell` rounds. A view centre that
        // sits on a cell boundary to within float noise (the default view of a
        // 1504-wide window is 23.5 cells; a test's 800-wide one is 12.5) lands
        // in that strip half the time, `cellChild` carries the digit into the
        // neighbour parent and mints the child THERE, and `child.edge` is then
        // relative to a frame this camera is not in: the pan came out one whole
        // level-1 frame off, the next `_maybeShift` "corrected" it by 4,096
        // cells, and the picture jumped one level-0 cell sideways — 8,192 px at
        // the crossing zoom, the ink gone off screen. Measured in jsdom on a
        // synthetic stroke zoomed about x = 400: the render list was empty after
        // the 1 -> 2 crossing. So: step into the child's own parent first. Its
        // origin in this frame's units is a whole number of frames, exact.
        if (child.parent != null && child.parent !== this.frame) {
            const o = this.lm.mapPointF([0, 0], child.parent, this.frame);
            if (o) {
                this.inPanX += o[0] * this.inScale;
                this.inPanY += o[1] * this.inScale;
                this.frame = child.parent;
            }
        }
        const { s, t } = child.edge;
        const nis = this.inScale * base / s;            // -> ~base
        this.inPanX = this.inPanX - t.x * nis / base;   // place the current view in the fixed lattice
        this.inPanY = this.inPanY - t.y * nis / base;
        this.inScale = nis;
        this.frame = child.id;
    }
    _crossDown() {
        const base = this.cfg.base;
        const edge = this.lm.ensureParentEdge(this.frame);
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
