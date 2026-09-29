/**
 * SvgLayer — the one Two.js instance a renderer keeps (A3 §7.2): the camera's `world` group, the tile and
 * erase debug groups and the lasso's screen group, in paint order. It owns the `<svg>` element's lifetime.
 * The SVG renderer draws its ink into `world`; the raster renderer draws only the live stroke there, at z-index 1
 * over the plates.
 */
import Two from "two.js";

export default class SvgLayer {
    /**
     * @param {Element} container the host the `<svg>` is appended to
     * @param {{width:number, height:number}} size CSS px
     */
    constructor(container, { width, height }) {
        this.two = new Two({ width, height, autostart: true });
        this.two.appendTo(container);
        /** The camera's group: its transform is the view's, with the origin folded in (DESIGN.md §9). */
        this.world = this.two.makeGroup();
        this.tileDebugGroup = this.two.makeGroup();
        this.eraseDebugGroup = this.two.makeGroup();
        /** Screen space, over everything: the lasso. */
        this.selGroup = this.two.makeGroup();
    }
    /** The `<svg>`, or null. */
    get element() { const r = this.two.renderer; return (r && r.domElement) || null; }
    setSize(w, h) { this.two.renderer.setSize(w, h); }
    update() { this.two.update(); }
    /**
     * The element out of the host and the instance off `Two.Instances`: a paused instance still pins its scene
     * (measured 2026-09-08: each thumbnail engine's 2,103 paths stayed reachable for the life of the tab).
     */
    destroy() {
        try { this.two.pause(); } catch (e) { /* ignore */ }
        const el = this.element;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        try { this.two.clear(); } catch (e) { /* ignore */ }
        const i = Two.Instances.indexOf(this.two);
        if (i >= 0) Two.Instances.splice(i, 1);
    }
}
