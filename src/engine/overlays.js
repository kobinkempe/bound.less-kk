/**
 * Everything the engine draws that is NOT ink: the selection indicator and the
 * erase debug view.
 *
 * THE SELECTION INDICATOR traces every object, however small - there is no
 * marker mode - which is only honest because of the two floors below it
 * (SEL_ONE_PIXEL_PX, SEL_MIN_TRACE_PX) and the ant budget that stops a
 * hairline outline from becoming a hundred thousand dashes.
 *
 * THE ERASE DEBUG VIEW (dev menu -> "Erase") draws the decision rather than the
 * result: a colour per real shape, orange for a stored boundary, GREEN where
 * two pieces are still in contact across a tile edge - which is severance
 * itself - and yellow for the eraser marks. Everything that has gone wrong with
 * erasing has been invisible in ink; this is where it becomes visible.
 * `docs/erase-tile-window-design-bible.md` has the full legend.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`. Split out of
 * `KobinEngine.js` on 2026-08-31.
 */
import { arcOverlaps, asRect, contactArcs, tOfPoint } from "./geometry/connect";
import { bboxOf, shapeRingsInRect } from "./geometry/derive";
import { clipRingsToRect } from "./geometry/polyline";
import { meanWidth } from "./geometry/arcShape";
import { rectSpan, rectTol } from "./rectMath";


// ---- selection indicator ----------------------------------------------------
// EVERY object is traced, however small — there is no marker mode. Two limits
// keep that honest once marks get down to the size of a pixel:
//
// At or below this span a mark occupies a single pixel, and its outline has no
// shape left to follow. It is still traced, but at the floor size below, and
// only ONE trace is emitted per pixel: a hundred specks sitting on top of each
// other are one thing to look at, not a hundred stacked outlines.
const SEL_ONE_PIXEL_PX = 1.5;
// What such a trace is floored to, so that something too small to see still
// shows where it is.
//
// THE ANTS OUTLIVE THE INK (Kobin, 2026-08-25). Below `cullPx` the renderer
// stops painting an object, but the selection indicator stays: zoomed far
// enough out you see no drawing and a speck of ants marking where the selected
// thing is. That is deliberate — it is the whole of "extends down to objects
// that are truly too small to see". Do not tie this to the render list.
//
// The speck is TINY, and it is a SOLID DOT rather than a dashed ring. That is
// not a simplification, it is what the design file actually renders, and it
// took reading its construction to see why.
//
// The file draws ants by stroking the mark's own path FAT and masking the ink
// out of it: `stroke-width = m.w + 2.5k` against a mask eroded to
// `m.w - 2.5k`, leaving a 5k px band centred on the silhouette. For a
// sub-pixel dot `m.w` is ZERO, so the erode clamps to nothing and no ink is
// cut away — and the dot's circumference (~1.6 px) is shorter than a single
// dash, so the dash pattern never gets to open a gap. What lands on screen is
// a solid dot about 2.25 px across.
//
// Three earlier attempts got this wrong by reasoning instead of reading: 3 px
// with the full band (merged into a blob), 10 px so the dashes could read (a
// fat square standing in for a half-pixel mark), then a dashed octagon (mush
// at 2 px).
const SEL_MIN_TRACE_PX = 0.5;
// A ceiling on the total screen length of ants, in pixels. The rings are already
// clipped to the view and culled to its margin, so this is a backstop rather
// than a working limit — but it is the invariant that keeps the 2026-08-22
// stall (350,958 dashes on one 877,395 px rectangle) from ever returning in a
// new shape. At a 9 px dash cycle this caps the rasterizer at ~2,700 dashes.
const SEL_ANT_BUDGET_PX = 24000;
// A border segment gets a chevron only once it covers this much of its side.
// Short segments — a few fingers of ink touching the top of the frame — read
// perfectly well as ants continuing the outline, and an arrow on each would be
// clutter saying nothing.
const SEL_CHEVRON_FRACTION = 1 / 5;
/** Merge overlapping or nearly touching [a,b] spans into the fewest runs. */
function mergeSpans(list, gap) {
    if (!list.length) return [];
    const sorted = list.slice().sort((x, y) => x[0] - y[0]);
    const out = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
        const cur = out[out.length - 1], nxt = sorted[i];
        if (nxt[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], nxt[1]);
        else out.push(nxt.slice());
    }
    return out;
}

class Overlays {

    /**
     * Keep a consumed eraser mark so the debug view can still show it. A mark
     * is deleted the moment it has nothing left to cut, which is exactly when
     * you want to look at where it was.
     */
    _keepDebugMark(E) {
        if (!this.eraseDebug || !E || E.type !== "shape" || !E.loops) return;
        this._debugMarks = this._debugMarks || [];
        this._debugMarks.push({ level: E._home || this.cam.frame, loops: E.loops, id: E.id });
        if (this._debugMarks.length > 24) this._debugMarks.shift();
    }
    /**
     * The erase-debug overlay, in SCREEN coordinates, rebuilt per render.
     *
     * ONE walk of each real boundary, and every stretch of it comes out in
     * exactly one colour:
     *   ORANGE  the piece's own free boundary — where its ink actually ends.
     *   GREEN   the stretch it shares with a parent or child across their tile
     *           edge. This is the whole of severance: green means "these two
     *           are one object", and a cut that reached the tile edge shows as
     *           green shrinking away to nothing.
     *   YELLOW  eraser marks, including ones already consumed, so a gesture
     *           that appeared to do nothing can be seen where it landed.
     *
     * Green is not drawn OVER orange, which it used to be — a green line laid
     * on top of an orange one is two paths where the picture has one edge, and
     * where they disagreed by a fraction of a pixel you got a two-colour fringe
     * that read as a gap. The classification happens on the outline itself:
     * every little stretch asks `tOfPoint` where it sits on the shared rect and
     * looks that up in the contact intervals, which is the very question
     * `_familyComponents` severs on, so the picture cannot drift from the
     * decision.
     */
    _eraseDebugOverlay() {
        const out = { outlines: [], contacts: [], marks: [] };
        const F = this.cam.frame;
        const W = this.width, H = this.height;
        // A boundary is only worth drawing where it can be seen. CLIP_PX is the
        // margin the geometry is clipped to and CULL_PX the margin a segment
        // must reach to be kept: clipping closes a ring along the window edge,
        // and keeping the two apart is what puts those fabricated edges outside
        // the kept region instead of drawing a box around the screen.
        const CLIP_PX = 160, CULL_PX = 64;
        const onScreen = (p) => p[0] > -CULL_PX && p[0] < W + CULL_PX && p[1] > -CULL_PX && p[1] < H + CULL_PX;
        const win = this.cam.frameWindow(CLIP_PX / Math.max(this.cam.inScale, 1e-30));

        // WHERE PIECES ARE JOINED, as intervals on the tile edge they share.
        //
        // Recorded against BOTH pieces, each in its own level's coordinates,
        // because both of them have to draw their share of that stretch green:
        // the parent stops at the rect and the child fills it, so the join is
        // one edge that two different objects, at two different levels, each
        // own a copy of.
        // Cached per family across renders, because a join is a fact about the
        // DOCUMENT and not about where the camera is: finding one means
        // flattening whole pieces at the rect's own lattice step, which is fine
        // fidelity on a big object, and paying that on every pan turned the
        // debug view into a slideshow. Keyed by the members and their edit
        // counters, so any change to the family recomputes it.
        if (!this._dbgCache) this._dbgCache = { joins: new Map(), rings: new Map() };
        const C = this._dbgCache;
        if (C.joins.size > 400) C.joins.clear();
        if (C.rings.size > 800) C.rings.clear();
        // The families in view are collected from EVERY piece on screen, a
        // temporary tile included — a tile carries the id of the native it was
        // derived from, so zoomed out (which is when tile edges, and hence
        // contacts, are visible at all) the family is still found.
        const keys = new Set();
        for (const o of this._objs()) {
            if (o.erase) continue;
            const rec = this.doc.getById(o.id);
            const src = rec ? rec.obj : o;
            if (src.editId != null) keys.add(this.doc.editKey(src));
        }
        // Every family's members in ONE pass, not one document scan per family:
        // a drawing with 254 families was walked 254 times, per render.
        const byKey = new Map();
        for (const L of this.doc.levels()) {
            for (const o of this.doc.at(L)) {
                if (o.erase || o.editId == null) continue;
                const k = this.doc.editKey(o);
                if (!keys.has(k)) continue;
                let a = byKey.get(k);
                if (!a) { a = []; byKey.set(k, a); }
                a.push({ obj: o, level: L });
            }
        }
        // WHERE THE SEAMS ARE, shared with the selection indicator so that both
        // views answer "is this stretch a real edge or a tile join?" from one
        // implementation. Ants must never run along a join.
        const joins = this._familyJoinNotes(keys, byKey, C);

        // OUTLINES come from the stored document, not from the render list.
        //
        // A shape shown at another level arrives as tile pieces, each clipped to
        // its tile, so outlining what is DRAWN traces the tile grid and stops
        // dead at every seam. The real boundary is the one the object actually
        // has: take it from the native, in the native's own frame, and map the
        // points to screen. It then runs continuously across every tile edge,
        // which is the whole point of drawing it.
        for (const L of this.doc.levels()) {
            const f = this.lm.frameFactor(L, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const tol = (this.cfg.arcTolerancePx * 0.5) / pxPerUnit;
            // The view in THIS level's units. A coarse object seen from three
            // levels down is 2.7e10 times the window, and flattening the whole
            // of it at a tolerance set by the magnified view means tens of
            // millions of points for the few hundred that are on screen — which
            // is what blew the call stack inside Two.js's path constructor. It
            // is clipped first, so the cost tracks what is visible.
            const vr = this.lm.mapRectF(win, F, L);
            if (!vr) continue;
            for (const o of this.doc.at(L)) {
                // Only ink that HAS a boundary: a stroke has not resolved yet,
                // and an eraser mark is drawn as a mark, not as a shape.
                if (o.erase || (o.type !== "shape" && o.type !== "fill")) continue;
                const b = bboxOf(o, this.store.live);
                if (b.x1 < vr.left || b.x0 > vr.right || b.y1 < vr.top || b.y0 > vr.bottom) continue;
                const entries = joins.get(o.id) || [];
                // An object WHOLLY inside the clip window is not clipped at all,
                // so its rings depend on nothing but the object and the
                // tolerance — cache those. Anything crossing the window edge is
                // rebuilt, because a pan changes what comes back.
                const whole = b.x0 >= vr.left && b.x1 <= vr.right && b.y0 >= vr.top && b.y1 <= vr.bottom;
                const rk = whole ? o.id + "|" + (o._ver || 0) + "|" + tol : null;
                let rings = rk ? C.rings.get(rk) : null;
                if (!rings) {
                    rings = this._outlineInView(o, vr, tol);
                    if (rk) C.rings.set(rk, rings);
                }
                for (const ring of rings) this._emitOutlineRing(out, o.id, L, ring, entries, onScreen);
            }
        }
        // Marks: still pending, plus the ones already consumed.
        const pending = [];
        for (const L of this.doc.levels()) for (const o of this.doc.at(L)) if (o.erase && o.type === "shape") pending.push({ level: L, loops: o.loops, id: o.id });
        for (const m of pending.concat(this._debugMarks || [])) {
            const f = this.lm.frameFactor(m.level, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const vr = this.lm.mapRectF(win, F, m.level);
            if (!vr) continue;
            const { rings } = shapeRingsInRect(m.loops, vr, (this.cfg.arcTolerancePx * 0.5) / pxPerUnit);
            for (const ring of rings) {
                const pts = [];
                for (const p of ring) {
                    const q = this.cam.levelPointToScreen(m.level, p[0], p[1]);
                    if (q) pts.push(q);
                }
                if (pts.length > 2) out.marks.push({ id: m.id, pts });
            }
        }
        return out;
    }
    /** An object's boundary as polygon rings, clipped to the view rect `vr`. */
    _outlineInView(o, vr, tol) {
        const rect = { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
        if (o.type === "shape") {
            // `covered` means the ink floods the window: there is no boundary in
            // view, and drawing the window's own edge would invent one.
            const { rings, covered } = shapeRingsInRect(o.loops, rect, tol);
            return covered ? [] : rings;
        }
        if (o.type === "fill") return clipRingsToRect(o.polys, rect);
        return [];
    }
    /**
     * One segment of a boundary, cut where a join starts and ends.
     *
     * Returns the pieces it falls into, in order, each flagged joined or not —
     * or null if the segment is nowhere near a shared edge, which is almost all
     * of them and costs one `tOfPoint` to find out.
     *
     * Cutting matters because a straight stretch flattens to ONE chord: a whole
     * side of a tile arrives as a single segment from corner to corner, and a
     * contact covering a third of it would otherwise have to colour the whole
     * side green or the whole side orange. Both are lies, and the second one
     * hides exactly the case worth seeing — a join that has nearly been cut
     * through.
     */
    _splitOnJoins(entries, a, b) {
        const hits = [];
        for (const e of entries) {
            const ta = tOfPoint(e.rect, a[0], a[1], e.tol);
            if (!ta.length) continue;
            const tb = tOfPoint(e.rect, b[0], b[1], e.tol);
            if (!tb.length) continue;
            // The pair on the SAME side: a corner reports two parameters, and
            // pairing across sides would run the segment the long way round.
            let best = null;
            for (const x of ta) for (const y of tb) {
                const d = Math.abs(x - y);
                if (d <= 1 + 1e-9 && (!best || d < best.d)) best = { x, y, d };
            }
            if (best) hits.push({ e, x: best.x, y: best.y });
        }
        if (!hits.length) return null;
        const inAny = (s) => {
            for (const h of hits) {
                const t = h.x + (h.y - h.x) * s;
                for (const r of h.e.ranges) if (t >= r[0] - h.e.slack && t <= r[1] + h.e.slack) return true;
            }
            return false;
        };
        const cuts = [];
        for (const h of hits) {
            if (Math.abs(h.y - h.x) < 1e-15) continue;
            for (const r of h.e.ranges) for (const t of r) {
                const s = (t - h.x) / (h.y - h.x);
                if (s > 1e-9 && s < 1 - 1e-9) cuts.push(s);
            }
        }
        cuts.sort((p, q) => p - q);
        const at = (s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
        const parts = [];
        let prev = 0;
        for (const s of cuts.concat([1])) {
            if (s - prev < 1e-12) continue;
            parts.push({ p0: prev === 0 ? a : at(prev), p1: s === 1 ? b : at(s), joined: inAny((prev + s) / 2) });
            prev = s;
        }
        return parts.length ? parts : null;
    }
    /**
     * One ring, split into runs of the SAME colour and pushed as screen-space
     * polylines — orange where the piece's boundary is its own, green where it
     * is shared with the piece across the tile edge. Each stretch lands in
     * exactly one list, so nothing is drawn twice and neither colour hides the
     * other.
     */
    /**
     * Where a family's members are JOINED, as intervals on the tile edge they
     * share, keyed by object id.
     *
     * Recorded against BOTH pieces, each in its own level's coordinates,
     * because both of them own a copy of that stretch: the parent stops at the
     * rect and the child fills it.
     *
     * Cached per family across renders, because a join is a fact about the
     * DOCUMENT and not about where the camera is: finding one means flattening
     * whole pieces at the rect's own lattice step, and paying that on every pan
     * turned the debug view into a slideshow. Keyed by the members and their
     * edit counters, so any change to the family recomputes it.
     *
     * Shared by the erase-debug overlay (which paints joins GREEN) and the
     * selection indicator (which refuses to run ants along them). One
     * implementation, so the two can never disagree about where an object
     * really ends.
     */
    _familyJoinNotes(keys, byKey, C) {
        const joins = new Map();
        let notes = null;
        const note = (id, rect, tol, slack, ranges) => {
            if (!ranges.length) return;
            notes.push({ id, rect: asRect(rect), tol, slack, ranges });
        };
        const publish = (list) => {
            for (const n of list) {
                let e = joins.get(n.id);
                if (!e) { e = []; joins.set(n.id, e); }
                e.push(n);
            }
        };
        // Normalized to [0, 4): `arcOverlaps` reports a stretch that straddles
        // t = 0 shifted by ±4, and a lookup would never match it there.
        const norm = (rs) => {
            const o = [];
            for (const [a, b] of rs) {
                const lo = ((a % 4) + 4) % 4, hi = lo + (b - a);
                if (hi <= 4) o.push([lo, hi]); else { o.push([lo, 4]); o.push([0, hi - 4]); }
            }
            return o;
        };
        // One flatten per (object, tolerance): every kid asks its parent for the
        // same outline, and a parent with several ceded tiles was re-flattened
        // once per pair — 510 flattens for eleven pieces, 100 ms of a 160 ms
        // overlay.
        const flat = new Map();
        const ink = (o, tol) => {
            const k = o.id + "|" + tol;
            let v = flat.get(k);
            if (!v) { v = this._inkOutline(o, tol) || []; flat.set(k, v); }
            return v;
        };
        for (const key of keys) {
            const members = byKey.get(key) || [];
            const sig = members.map((m) => m.obj.id + ":" + (m.obj._ver || 0)).join(",");
            const hit = C.joins.get(key);
            if (hit && hit.sig === sig) { publish(hit.notes); continue; }
            notes = [];
            for (const kid of members) {
                const R = kid.obj.attachRect;
                if (!R) continue;
                const P = this.lm.parentOf(kid.level);
                if (P == null) continue;
                const Rp = this.lm.mapRectF({ left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 }, kid.level, P);
                if (!Rp) continue;
                const kidArcs = contactArcs(ink(kid.obj, rectTol(R)), R, rectTol(R));
                if (!kidArcs.length) continue;
                const at = Math.max(rectTol(R) / rectSpan(R), rectTol(Rp) / rectSpan(Rp));
                for (const up of members) {
                    if (up === kid || up.level !== P) continue;
                    if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
                    const upArcs = contactArcs(ink(up.obj, rectTol(Rp)), Rp, rectTol(Rp));
                    const ov = norm(arcOverlaps(kidArcs, upArcs, at));
                    note(kid.obj.id, R, rectTol(R), at, ov);
                    note(up.obj.id, Rp, rectTol(Rp), at, ov);
                }
            }
            C.joins.set(key, { sig, notes });
            publish(notes);
        }
        return joins;
    }

    /**
     * THE SELECTION INDICATOR, in screen coordinates.
     *
     * Returns `{ rings, dots, covered }` where `rings` are polylines of the
     * selection's TRUE ink boundary for the ants to run along, `dots` are marks
     * too small to trace, and `covered` says the ink floods the view.
     *
     * WHY IT IS NOT A BOUNDING BOX. The box this replaces was computed in the
     * active frame's coordinates, so an object a few levels away projected to
     * 877,395 px and its dashed perimeter cost 315 ms per frame while reporting
     * 0.15 ms of JavaScript (dashing is rasterizer work, so no profiler could
     * name it). Everything here is bounded before it is drawn: clipped to the
     * view, culled to its margin, decimated below half a pixel, and finally
     * capped by SEL_ANT_BUDGET_PX.
     *
     * WHY IT COMES FROM THE DOCUMENT, NOT THE RENDER LIST. A shape shown at
     * another level arrives as tile pieces, each clipped to its tile, so
     * outlining what is DRAWN traces the tile grid and stops dead at every
     * seam. The real boundary is the one the object actually has: taken from
     * the native in its own frame and mapped to screen, it runs continuously
     * across every tile edge. Stretches that are a JOIN rather than a free edge
     * are dropped outright — that is "no ants on the tile edge".
     *
     * WHY `covered` MATTERS. When the paint floods the view there is no
     * boundary left to dash, and drawing the window's own edge would invent
     * one. The design answers that case with the value shimmer instead, which
     * lives in the ink rather than on its edge.
     */
    _selectionAnts() {
        const s = this.selection;
        // Selection is a property of the select tool. Switching tools drops it
        // (see setTool), and this second check keeps the overlay honest even if
        // some path sets `tool` without going through there.
        if (!s || this.tool !== "select") return null;
        const F = this.cam.frame, W = this.width, H = this.height;
        // Clip wide, cull narrow: clipping closes a ring along the window edge,
        // and keeping the two margins apart puts those fabricated edges outside
        // the kept region instead of drawing a box around the screen.
        const CLIP_PX = 160, CULL_PX = 64;
        const onScreen = (p) => p[0] > -CULL_PX && p[0] < W + CULL_PX && p[1] > -CULL_PX && p[1] < H + CULL_PX;
        const win = this.cam.frameWindow(CLIP_PX / Math.max(this.cam.inScale, 1e-30));
        // The EXACT viewport, for finding where the ink meets the frame edge.
        const win0 = this.cam.frameWindow(0);
        const sides = { left: [], right: [], top: [], bottom: [] };

        const seen = new Set();
        const members = [];
        const byKey = new Map();
        const keys = new Set();
        for (const id of s.ids) {
            for (const m of this.doc.editGroup(id)) {
                const tag = m.level + "#" + m.obj.id;
                if (seen.has(tag) || m.obj.erase) continue;
                seen.add(tag);
                members.push(m);
                const k = this.doc.editKey(m.obj);
                keys.add(k);
                let a = byKey.get(k);
                if (!a) { a = []; byKey.set(k, a); }
                a.push(m);
            }
        }
        if (!members.length) return null;

        if (!this._dbgCache) this._dbgCache = { joins: new Map(), rings: new Map() };
        const C = this._dbgCache;
        if (C.joins.size > 400) C.joins.clear();
        const joins = this._familyJoinNotes(keys, byKey, C);

        // `rings` are the edges the ants run along. `fine` are the specks —
        // marks at the size of a pixel, stroked differently. `edges` are the
        // sides of the SCREEN the selection runs past, each carrying a run for
        // the ants and a direction for an arrow.
        const out = { rings: [], fine: [], edges: [], covered: false, inkPx: Infinity };
        // The selection's extent in screen coordinates, accumulated as we go.
        // Only ever compared against the viewport — never drawn, which is the
        // whole lesson of the 877,395 px rectangle.
        let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
        let budget = SEL_ANT_BUDGET_PX;
        // Which pixels already carry a trace, so marks piled onto one pixel are
        // drawn once rather than once each.
        const tinyAt = new Set();
        for (const m of members) {
            const L = m.level, o = m.obj;
            const f = this.lm.frameFactor(L, F);
            if (f == null) continue;
            const pxPerUnit = this.cam.inScale * f;
            if (!(pxPerUnit > 0)) continue;
            const vr = this.lm.mapRectF(win, F, L);
            if (!vr) continue;
            const b = bboxOf(o, this.store.live);
            if (b.x1 < vr.left || b.x0 > vr.right || b.y1 < vr.top || b.y0 > vr.bottom) continue;

            // DOWN AT ONE PIXEL. The outline is still what gets drawn, but at
            // this size there is no shape left in it to follow and flattening it
            // at the view's tolerance can collapse it to nothing at all. So the
            // trace is floored to something visible, and — the part that matters
            // on a drawing full of specks — only the FIRST mark on any given
            // pixel is traced. Tracing each of them separately would stack a
            // hundred identical outlines on one pixel and cost a hundred times
            // as much to say the same thing.
            const wpx = (b.x1 - b.x0) * pxPerUnit, hpx = (b.y1 - b.y0) * pxPerUnit;
            if (Math.max(wpx, hpx) <= SEL_ONE_PIXEL_PX) {
                const c = this.cam.levelPointToScreen(L, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
                if (!c || !onScreen(c)) continue;
                const key = Math.round(c[0]) + "," + Math.round(c[1]);
                if (tinyAt.has(key)) continue;
                tinyAt.add(key);
                // Round, not square, and stroked SOLID by the renderer: at
                // this size a square reads as a box drawn around the mark, and
                // a dash pattern has no circumference to open a gap in. The
                // radius still tracks the mark, so a 1.4 px speck stays
                // visibly larger than a 0.5 px one.
                const r = Math.max(SEL_MIN_TRACE_PX / 2, Math.max(wpx, hpx) / 2);
                const loop = [];
                for (let k = 0; k <= 8; k++) {
                    const th = (k / 8) * Math.PI * 2;
                    loop.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
                }
                out.fine.push(loop);
                // Ants only. There is no shimmer anywhere any more.
                budget -= 2 * Math.PI * r;
                continue;
            }

            // HOW HEAVY IS THIS INK ON SCREEN? The design scales the ants to the
            // paint, and getting this number wrong is what made the indicator
            // look like a red splat: `lwFrame` is absent on a RESOLVED shape —
            // a pen stroke loses it once it becomes a perimeter — so the test
            // silently failed for every settled stroke and the band stayed at
            // its full 5 px. On an 18 px object that is a quarter of the mark,
            // and around a boundary that doubles back on itself the two sides
            // of the band merge into a solid blob.
            //
            // `meanWidth` (twice the area over the perimeter) recovers the
            // thickness the stroke width no longer records. The object's own
            // on-screen size caps it as well, because a convoluted outline
            // packed into a few pixels will overlap itself whatever its ink
            // weight says.
            let thick = o.lwFrame || 0;
            if (!thick && o.type === "shape" && o.loops) {
                try { thick = meanWidth(o.loops); } catch (err) { thick = 0; }
            }
            const thickPx = thick > 0 ? thick * pxPerUnit : Infinity;
            out.inkPx = Math.min(out.inkPx, thickPx, Math.min(wpx, hpx));

            const tol = (this.cfg.arcTolerancePx * 0.5) / pxPerUnit;
            // Resolve the ink ONCE and clip it twice: to the padded window for
            // the ants, and to the exact viewport to find where it meets the
            // sides of the screen.
            const loops = o.type === "shape" ? null : this._inkOutline(o, tol);
            const got = this._selInkRings(o, vr, tol, loops);
            const vp = this.lm.mapRectF(win0, F, L);
            if (vp) this._selEdgeSpans(o, vp, tol, loops, L, sides);
            const entries = joins.get(o.id) || [];
            // Where does this member sit on screen? Corners only — four points,
            // however astronomical the object.
            for (const [cx, cy] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
                const q = this.cam.levelPointToScreen(L, cx, cy);
                if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
                if (q[0] < sx0) sx0 = q[0];
                if (q[0] > sx1) sx1 = q[0];
                if (q[1] < sy0) sy0 = q[1];
                if (q[1] > sy1) sy1 = q[1];
            }

            const before = out.rings.length;
            for (const ring of got.rings) budget = this._emitAntRing(out, L, ring, entries, onScreen, budget);
            // The ink floods the view: either the clipper said so outright, or
            // nothing survived culling while the object still spans the whole
            // window. Both mean there is no edge on screen to dash.
            const floods = b.x0 <= vr.left && b.x1 >= vr.right && b.y0 <= vr.top && b.y1 >= vr.bottom;
            if (got.covered || (out.rings.length === before && floods)) out.covered = true;
        }

        // ---- where the selection meets the sides of the screen ---------------
        //
        // Only where the INK actually reaches the frame, not where its bounding
        // box does. A shape with several fingers touching the top edge marks
        // those fingers and nothing between them, so the border ants read as the
        // outline continuing rather than as a box drawn round the view.
        //
        // A selection entirely outside the view produces no spans at all, which
        // is why one gets no border and no chevron.
        const SIDE_LEN = { left: H, right: H, top: W, bottom: W };
        for (const side of ["left", "right", "top", "bottom"]) {
            const merged = mergeSpans(sides[side], 1.5);
            const full = SIDE_LEN[side];
            for (const [a, b] of merged) {
                if (b - a < 2) continue;
                out.edges.push({ side, from: a, to: b,
                    chevron: (b - a) >= full * SEL_CHEVRON_FRACTION });
            }
        }
        return out;
    }

    /**
     * Where this object's ink MEETS THE FRAME, as spans along each side.
     *
     * Clipping the ink to the exact viewport leaves segments lying along the
     * viewport's own edges wherever the ink ran past it — those segments are
     * the answer, and they are the only honest one: a bounding box would claim
     * the whole side when a single finger of ink touches it.
     *
     * `covered` means the ink floods the view, so every side is spanned end to
     * end. That is the case with no outline left at all, and the border becomes
     * the entire indicator.
     */
    _selEdgeSpans(o, vp, tol, loops, L, sides) {
        const got = this._selInkRings(o, vp, tol, loops);
        const W = this.width, H = this.height;
        if (got.covered) {
            sides.left.push([0, H]); sides.right.push([0, H]);
            sides.top.push([0, W]); sides.bottom.push([0, W]);
            return;
        }
        const ex = Math.max(Math.abs(vp.right - vp.left), Math.abs(vp.bottom - vp.top));
        const eps = ex * 1e-7 + tol;
        const on = (v, edge) => Math.abs(v - edge) <= eps;
        for (const ring of got.rings) {
            const n = ring.length;
            if (n < 2) continue;
            for (let i = 0; i < n; i++) {
                const a = ring[i], b = ring[(i + 1) % n];
                let side = null;
                if (on(a[0], vp.left) && on(b[0], vp.left)) side = "left";
                else if (on(a[0], vp.right) && on(b[0], vp.right)) side = "right";
                else if (on(a[1], vp.top) && on(b[1], vp.top)) side = "top";
                else if (on(a[1], vp.bottom) && on(b[1], vp.bottom)) side = "bottom";
                if (!side) continue;
                const sa = this.cam.levelPointToScreen(L, a[0], a[1]);
                const sb = this.cam.levelPointToScreen(L, b[0], b[1]);
                if (!sa || !sb) continue;
                const axis = (side === "left" || side === "right") ? 1 : 0;
                const lim = axis ? H : W;
                let p = Math.max(0, Math.min(lim, sa[axis]));
                let q = Math.max(0, Math.min(lim, sb[axis]));
                if (p > q) { const t = p; p = q; q = t; }
                sides[side].push([p, q]);
            }
        }
    }

    /** An object's ink boundary as rings, clipped to `vr`, whatever its type. */
    _selInkRings(o, vr, tol, loops) {
        const rect = { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
        if (o.type === "shape") {
            const r = shapeRingsInRect(o.loops, rect, tol);
            return { rings: r.covered ? [] : r.rings, covered: !!r.covered };
        }
        if (loops) return { rings: clipRingsToRect(loops, rect), covered: false };
        if (o.type === "fill") return { rings: clipRingsToRect(o.polys, rect), covered: false };
        // A STROKE has no stored boundary — it has not resolved yet. Resolving
        // the pen to its outline is what lets a plain pen mark be selected at
        // all; the erase-debug overlay skips strokes, and copying that here
        // would have left every freehand line with no indicator. The caller
        // usually passes `loops` in, so the resolve happens once and both clips
        // share it.
        const own = this._inkOutline(o, tol);
        if (!own || !own.length) return { rings: [], covered: false };
        return { rings: clipRingsToRect(own, rect), covered: false };
    }

    /**
     * One boundary ring to screen-space ant runs, dropping every stretch that
     * is a tile JOIN rather than a free edge, and stopping when the budget runs
     * out. Returns the budget left.
     */
    _emitAntRing(out, L, ring, entries, onScreen, budget0) {
        let budget = budget0;
        const n = ring.length;
        if (n < 2 || n > 200000 || budget <= 0) return budget;
        let run = null, joined = false;
        const flush = () => {
            // A run has to cover some ground: decimation can leave two points a
            // hundredth of a pixel apart, which draws as a stray dot.
            if (run && run.length > 1 && !joined) {
                let d = 0;
                for (let i = 1; i < run.length; i++) {
                    d += Math.abs(run[i][0] - run[i - 1][0]) + Math.abs(run[i][1] - run[i - 1][1]);
                }
                if (d > 0.5) out.rings.push(run);
            }
            run = null;
        };
        const add = (p0, p1, k, last) => {
            if (budget <= 0) return;
            const s0 = this.cam.levelPointToScreen(L, p0[0], p0[1]);
            const s1 = this.cam.levelPointToScreen(L, p1[0], p1[1]);
            if (!s0 || !s1 || (!onScreen(s0) && !onScreen(s1))) { flush(); return; }
            if (run && k !== joined) flush();
            if (!run) { run = [s0]; joined = k; }
            const p = run[run.length - 1];
            const step = Math.abs(s1[0] - p[0]) + Math.abs(s1[1] - p[1]);
            // Sub-pixel chords are what a fine tolerance leaves behind once the
            // camera has had its say; dropping them keeps a magnified boundary
            // from arriving as 40,000 anchors.
            if (step <= 0.4 && !last) return;
            run.push(s1);
            // SPEND THE BUDGET AS THE RUN GROWS, not when it ends. Charging it
            // at the end meant a boundary with no joins — which never flushes
            // until its very last segment, and that is the ordinary case —
            // emitted 659,368 px against a 24,000 px allowance and the cap did
            // nothing at all. Caught by its own test rather than in the field.
            if (!joined) budget -= step;
            if (budget <= 0) flush();
        };
        for (let i = 0; i < n && budget > 0; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const last = i === n - 1;
            const parts = entries.length ? this._splitOnJoins(entries, a, b) : null;
            if (!parts) { add(a, b, false, last); continue; }
            for (let k = 0; k < parts.length; k++) add(parts[k].p0, parts[k].p1, parts[k].joined, last && k === parts.length - 1);
        }
        flush();
        return budget;
    }

    _emitOutlineRing(out, id, L, ring, entries, onScreen) {
        const n = ring.length;
        if (n < 2 || n > 200000) return;
        let run = null, kind = false;
        const flush = () => {
            // A run has to cover some ground: decimation can leave two points a
            // hundredth of a pixel apart, which draws as a stray dot in a view
            // whose whole purpose is that every mark on it means something.
            if (run && run.length > 1) {
                let d = 0;
                for (let i = 1; i < run.length; i++) d += Math.abs(run[i][0] - run[i - 1][0]) + Math.abs(run[i][1] - run[i - 1][1]);
                if (d > 0.5) (kind ? out.contacts : out.outlines).push({ id, level: L, pts: run });
            }
            run = null;
        };
        const add = (p0, p1, k, last) => {
            const s0 = this.cam.levelPointToScreen(L, p0[0], p0[1]);
            const s1 = this.cam.levelPointToScreen(L, p1[0], p1[1]);
            if (!s0 || !s1 || (!onScreen(s0) && !onScreen(s1))) { flush(); return; }
            if (run && k !== kind) flush();
            if (!run) { run = [s0]; kind = k; }
            // Sub-pixel chords are what a fine tolerance leaves behind once the
            // camera has had its say; dropping them costs nothing visible and
            // keeps a magnified boundary from arriving as 40,000 anchors.
            const p = run[run.length - 1];
            if (Math.abs(s1[0] - p[0]) + Math.abs(s1[1] - p[1]) > 0.4 || last) run.push(s1);
        };
        for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const last = i === n - 1;
            const parts = entries.length ? this._splitOnJoins(entries, a, b) : null;
            if (!parts) { add(a, b, false, last); continue; }
            for (let k = 0; k < parts.length; k++) add(parts[k].p0, parts[k].p1, parts[k].joined, last && k === parts.length - 1);
        }
        flush();
    }
}

export const overlays = Overlays.prototype;
