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
import {
    expansionOf, growExpansion, scaleExpansion, divideExpansion,
    sumExpansions, estimateExpansion,
} from "./geometry/expansion";

export default class Camera {
    constructor(levelMap, cfg, hooks = {}) {
        this.lm = levelMap;
        this.cfg = cfg;
        this.frame = "0";
        this.inScale = 1; this.inPanX = 0; this.inPanY = 0;
        // Numeric pan is enough to draw the active frame. It is not enough to
        // survive a deep -> root -> deep trip: a visible child offset can fall
        // below the root Number's ULP. Keep the view centre as an expansion so
        // that residue is restored when the child path is re-entered.
        this._centerX = null; this._centerY = null;
        this._precisionStamp = null;
        this._crossAnchors = new Map();
        this._zoomAnchor = null;
        this._resetPreciseCenter();
        // hooks: onCross(from,to), finalizeLiveStroke()
        this.hooks = hooks;
    }

    get activeLevel() { const d = this.lm.depthOf(this.frame); return d == null ? 0 : d; }
    // Legacy setter (tests/tools): jump to the SPINE frame at that depth.
    set activeLevel(v) {
        this.frame = this.lm.ensureSpine(v);
        this._precisionStamp = null;
        this._crossAnchors.clear();
        this._zoomAnchor = null;
    }

    set(camera) {
        if (camera.frame != null && this.lm.frame(camera.frame)) this.frame = camera.frame;
        else this.frame = this.lm.ensureSpine(camera.activeLevel || 0);
        this.inScale = camera.inScale; this.inPanX = camera.inPanX; this.inPanY = camera.inPanY;
        this._crossAnchors.clear();
        this._zoomAnchor = null;
        this._resetPreciseCenter();
    }
    state() { return { activeLevel: this.activeLevel, frame: this.frame, inScale: this.inScale, inPanX: this.inPanX, inPanY: this.inPanY }; }

    _stamp() {
        return {
            frame: this.frame, scale: this.inScale,
            panX: this.inPanX, panY: this.inPanY,
            width: this.lm.width, height: this.lm.height,
        };
    }
    _resetPreciseCenter() {
        this._centerX = expansionOf((this.lm.width / 2 - this.inPanX) / this.inScale);
        this._centerY = expansionOf((this.lm.height / 2 - this.inPanY) / this.inScale);
        this._precisionStamp = this._stamp();
    }
    _ensurePreciseCenter() {
        const s = this._precisionStamp;
        if (!s || s.frame !== this.frame || s.scale !== this.inScale ||
            s.panX !== this.inPanX || s.panY !== this.inPanY ||
            s.width !== this.lm.width || s.height !== this.lm.height) {
            // Tests, snapshots, and resize paths may write the legacy public
            // camera fields directly. Treat that as a deliberate new anchor.
            this._zoomAnchor = null;
            this._resetPreciseCenter();
        }
    }
    _applyPreciseCenter() {
        this.inPanX = this.lm.width / 2 - estimateExpansion(this._centerX) * this.inScale;
        this.inPanY = this.lm.height / 2 - estimateExpansion(this._centerY) * this.inScale;
        this._precisionStamp = this._stamp();
    }
    screenToFrame(sx, sy) {
        this._ensurePreciseCenter();
        return [
            estimateExpansion(growExpansion(
                this._centerX, (sx - this.lm.width / 2) / this.inScale,
            )),
            estimateExpansion(growExpansion(
                this._centerY, (sy - this.lm.height / 2) / this.inScale,
            )),
        ];
    }

    // Visible window in frame coords, expanded by `margin` frame units.
    frameWindow(margin = 0) {
        const inv = 1 / this.inScale;
        return {
            left: (0 - this.inPanX) * inv - margin, top: (0 - this.inPanY) * inv - margin,
            right: (this.lm.width - this.inPanX) * inv + margin, bottom: (this.lm.height - this.inPanY) * inv + margin,
        };
    }

    panBy(dx, dy) {
        this._ensurePreciseCenter();
        this._zoomAnchor = null;
        this._centerX = growExpansion(this._centerX, -dx / this.inScale);
        this._centerY = growExpansion(this._centerY, -dy / this.inScale);
        this._applyPreciseCenter();
    }

    zoomFactorAt(sx, sy, factor) {
        // A non-positive factor would drive inScale ≤ 0, below `exit` FOREVER —
        // _maybeCross would then cross down in an infinite loop (×3000 of a
        // negative number never climbs back above exit). Refuse bad input.
        if (!(factor > 0) || !Number.isFinite(factor)) return false;
        if (this.hooks.finalizeLiveStroke) this.hooks.finalizeLiveStroke();
        this._ensurePreciseCenter();
        if (!this._zoomAnchor || this._zoomAnchor.sx !== sx || this._zoomAnchor.sy !== sy) {
            const p = this.screenToFrame(sx, sy);
            this._zoomAnchor = { frame: this.frame, x: p[0], y: p[1], sx, sy };
        }
        const ns = this.inScale * factor;
        this.inScale = ns;
        if (!this._centerOnZoomAnchor()) {
            this._zoomAnchor = null;
            this._resetPreciseCenter();
        }
        this._applyPreciseCenter();
        return this._maybeCross();
    }
    _centerOnZoomAnchor() {
        if (!this._zoomAnchor) return false;
        const a = this._zoomAnchor;
        const p = this.lm.mapPointPlacedF([a.x, a.y], a.frame, this.frame, []);
        if (!p) return false;
        this._centerX = expansionOf(
            p[0] - (a.sx - this.lm.width / 2) / this.inScale,
        );
        this._centerY = expansionOf(
            p[1] - (a.sy - this.lm.height / 2) / this.inScale,
        );
        return true;
    }
    zoomAt(sx, sy, deltaY) { return this.zoomFactorAt(sx, sy, Math.pow(2, -deltaY / 1000)); }
    pinchUpdate(mx, my, factor, dx, dy) {
        this.panBy(dx, dy);
        return this.zoomFactorAt(mx, my, factor);
    }

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
        this._ensurePreciseCenter();
        const base = this.cfg.base;
        const child = this.lm.ensureChild(this.frame, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = child.edge;
        const nis = this.inScale * base / s;            // -> ~base
        const checkpoint = this._crossAnchors.get(child.id);
        if (checkpoint && checkpoint.parent === this.frame) {
            // Re-enter relative to the exact centre retained when this child
            // was left. If the coarse camera moved, only that bounded delta is
            // magnified; if it did not, the child residue is byte-identical.
            const dx = sumExpansions(
                this._centerX, scaleExpansion(checkpoint.parentX, -1),
            );
            const dy = sumExpansions(
                this._centerY, scaleExpansion(checkpoint.parentY, -1),
            );
            this._centerX = sumExpansions(
                checkpoint.childX, scaleExpansion(dx, s / base),
            );
            this._centerY = sumExpansions(
                checkpoint.childY, scaleExpansion(dy, s / base),
            );
        } else {
            const parentAnchor = child.anchor
                ? child.anchor.parent : [-t.x / s, -t.y / s];
            const childAnchor = child.anchor ? child.anchor.child : [0, 0];
            this._centerX = growExpansion(scaleExpansion(
                growExpansion(this._centerX, -parentAnchor[0]), s / base,
            ), childAnchor[0]);
            this._centerY = growExpansion(scaleExpansion(
                growExpansion(this._centerY, -parentAnchor[1]), s / base,
            ), childAnchor[1]);
        }
        this.inScale = nis;
        this.frame = child.id;
        this._centerOnZoomAnchor();
        this._applyPreciseCenter();
    }
    _crossDown() {
        this._ensurePreciseCenter();
        const base = this.cfg.base;
        const edge = this.lm.ensureParentEdge(this.frame, this.inScale, this.inPanX, this.inPanY);
        const { s, t } = edge;
        const childFrame = this.lm.frame(this.frame);
        const childAnchor = childFrame && childFrame.anchor
            ? childFrame.anchor.child : [0, 0];
        const parentAnchor = childFrame && childFrame.anchor
            ? childFrame.anchor.parent : [-t.x / s, -t.y / s];
        const cur = this.inScale;
        const childId = this.frame;
        const childX = this._centerX.slice(), childY = this._centerY.slice();
        this._centerX = growExpansion(divideExpansion(
            growExpansion(this._centerX, -childAnchor[0]), s / base,
        ), parentAnchor[0]);
        this._centerY = growExpansion(divideExpansion(
            growExpansion(this._centerY, -childAnchor[1]), s / base,
        ), parentAnchor[1]);
        this.frame = this.lm.parentOf(this.frame);
        this._crossAnchors.set(childId, {
            parent: this.frame,
            childX, childY,
            parentX: this._centerX.slice(), parentY: this._centerY.slice(),
        });
        this.inScale = (s / base) * cur;
        this._centerOnZoomAnchor();
        this._applyPreciseCenter();
    }

    effectiveZoom() { return this.lm.effectiveZoom(this.frame, this.inScale); }
    levelPointToScreen(key, x, y) {
        return this.lm.framePointToScreen(key, x, y, this.frame, this.inScale, this.inPanX, this.inPanY);
    }
}
