/**
 * LiveStrokeLayer — the stroke under the pen, in the SVG layer's `world` (A3 §7.2, DESIGN.md §9): a short tail
 * under the pen and frozen chunks of `chunk` anchors behind it, all under one root carrying the stroke's opacity,
 * so a translucent stroke composites once over its seams (D-1: one path's whole `d` rebuilt every event was 27 ms
 * at 3,000 samples). The ink under the pen is the biarc chain, drawn as arcs, so pen-up changes nothing you see.
 *
 * Anchors are relative to `origin`: ONE object with ONE writer, `begin`, replaced only when the value moves (FC6:
 * `overlays._selDecide` caches on the origin's identity). A root keeps the origin it was drawn at and is translated
 * by that less the current one, so a held path stays put when the next stroke moves the origin (F131). The owner
 * folds its world origin into `world`'s transform in float64; a stroke begun at that origin draws untranslated.
 * The layer's group is in `world` only while it holds a path: an empty sibling group in the drawing's `<svg>` moved
 * a translucent group's composite by one level in headless Chromium (127 → 126 over a 0.5-opacity stroke).
 */
import Two from "two.js";
import { pushGapAnchors } from "./svgAnchors";

/** Anchors behind the pen before they freeze into a chunk: the tail's `d`, re-serialised every event, stays this short. */
export const LIVE_CHUNK = 128;

/** The view's centre in frame units, rounded: the origin a stroke or a scene is drawn relative to (FC6). */
export function viewCenter(cam) {
    const w = cam.frameWindow(0);
    return { x: Math.round((w.left + w.right) / 2), y: Math.round((w.top + w.bottom) / 2) };
}

export default class LiveStrokeLayer {
    /**
     * @param {object} parent the Two.js group the strokes go in (`SvgLayer.world`)
     * @param {object} plan the arc plan an arc is written by (`{enter, tol, segMax}`, `svgAnchors.pushArcPiece`)
     */
    constructor(parent, plan) {
        this.parent = parent;
        this.group = new Two.Group();
        this.plan = plan;
        this.chunk = LIVE_CHUNK;
        this.origin = { x: 0, y: 0 };
        /** The stroke under the pen, its root (the opacity) and the path under the pen. */
        this.model = null; this.root = null; this.tail = null;
        /** Strokes past pen-up still drawn here, oldest first: `{ id, root, og }` and what the owner adds. */
        this.held = [];
        this._stable = 0;   // the tail's anchors no later sample can change
        this._gap = 0;      // the first gap that can still change
    }

    /** Pen-down: stroke `o`, relative to `origin`; returns the tail. A stroke still open is cancelled. */
    begin(o, origin) {
        if (this.root) this.cancel();
        if (origin.x !== this.origin.x || origin.y !== this.origin.y) {
            this.origin = origin;
            for (const h of this.held) h.root.translation.set(h.og.x - origin.x, h.og.y - origin.y);
        }
        const root = new Two.Group();
        root.opacity = o.opacity == null ? 1 : o.opacity;
        const tail = livePath(o.color, o.lwFrame, []);
        root.add(tail);
        if (!this.group.parent) this.parent.add(this.group);
        this.group.add(root);
        this.root = root; this.tail = tail; this.model = o;
        this._stable = 0; this._gap = 0;
        return tail;
    }

    /**
     * Re-lay the tail from the pen's gaps. A new sample only disturbs the last two gaps — the cardinal spline's
     * handles reach one neighbour either side — so everything before them is final and stays put: the tail is
     * spliced back to its final anchors and re-appended, a handful of anchors per sample however long the stroke.
     * Past `chunk` final anchors the final part freezes into a path of its own.
     */
    arcs(gaps) {
        const path = this.tail;
        if (!path) return;
        const og = this.origin, v = path.vertices;
        if (v.length > this._stable) v.splice(this._stable, v.length - this._stable);
        const n = gaps.length;
        if (!n) {
            // A dot: a zero-length subpath, which a round cap paints as the disc the pen would leave. Without the
            // second anchor SVG draws nothing at all and the first tap of a stroke is invisible.
            const m = this.model;
            if (m && m.pts.length) {
                const p = m.pts[0];
                v.push(new Two.Anchor(p[0] - og.x, p[1] - og.y, 0, 0, 0, 0, Two.Commands.move));
                v.push(new Two.Anchor(p[0] - og.x, p[1] - og.y, 0, 0, 0, 0, Two.Commands.line));
            }
            return;
        }
        const finalTo = Math.max(0, n - 2);   // gaps below this can never change again
        let stable = this._stable;
        for (let g = this._gap; g < n; g++) {
            pushGapAnchors(v, gaps[g], og, this.plan);
            if (g + 1 <= finalTo) stable = v.length;
        }
        this._stable = stable;
        this._gap = finalTo;
        if (this._stable > this.chunk) this._freeze();
    }

    /** The tail's first `_stable - 1` anchors frozen into a path of their own; the tail restarts at the last. */
    _freeze() {
        const path = this.tail, v = path.vertices, k = this._stable;
        const j = v[k - 1];
        const chunk = livePath(path.stroke, path.linewidth, v.slice(0, k));
        // The tail's next cubic sets its first handle on the anchor before it: here, the move.
        const r = j.controls ? j.controls.right : null;
        const mv = new Two.Anchor(j.x, j.y, 0, 0, r ? r.x : 0, r ? r.y : 0, Two.Commands.move);
        v.splice(0, k, mv);
        this.root.add(chunk);
        this._stable = 1;
    }

    /** Pen-up where the stroke's plates are not in yet: its root stays, with its id and origin, until `release(id)`. */
    hold() {
        if (!this.root) return null;
        const h = { id: this.model.id, root: this.root, og: this.origin };
        this.held.push(h);
        this.root = null; this.tail = null; this.model = null;
        return h;
    }

    /** Stroke `id`'s held root taken down; false when none is held. */
    release(id) {
        const k = this.held.findIndex((h) => h.id === id);
        if (k < 0) return false;
        const h = this.held[k];
        if (h.root.parent) h.root.parent.remove(h.root);
        this.held.splice(k, 1);
        this._detachIfEmpty();
        return true;
    }

    /** The stroke under the pen taken down, never held: a cancelled stroke, and a pen-up whose ink is drawn at once. */
    cancel() {
        if (this.root && this.root.parent) this.root.parent.remove(this.root);
        this.root = null; this.tail = null; this.model = null;
        this._detachIfEmpty();
    }

    _detachIfEmpty() { if (!this.root && !this.held.length && this.group.parent) this.group.parent.remove(this.group); }

    /** Everything down, the group out of its parent. */
    destroy() {
        this.cancel();
        for (const h of this.held) if (h.root.parent) h.root.parent.remove(h.root);
        this.held.length = 0;
        this._detachIfEmpty();
    }
}

function livePath(color, lw, verts) {
    const p = new Two.Path(verts, false, false, true);
    p.noFill(); p.stroke = color; p.linewidth = lw; p.cap = "round"; p.join = "round"; p.opacity = 1;
    return p;
}
