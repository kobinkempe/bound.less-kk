/**
 * Everything the engine draws that is NOT ink: the selection indicator and the
 * erase debug view.
 *
 * THE SELECTION INDICATOR runs ants along the pieces the renderer is drawing —
 * arcs, never flattened, with the tile cuts skipped — retained between camera
 * steps and moved by one transform, in a layer of its own. A frame whose
 * selected content is smaller than a mark on screen is one mark and its
 * members are never visited. `_selectionAnts` carries the full argument.
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
import { meanWidth, shapeFromRings } from "./geometry/arcShape";
import { strokeLoops } from "./geometry/curveOutline";
import {
    runLength, loopRuns, runPathData, loopsBounds, edgeSpans, circleLoop, insideLoops,
    clipRunToRect,
} from "./geometry/antRuns";
import { rectSpan, rectTol } from "./rectMath";
import { translateLoops } from "./geometry/arcShape";


// ---- selection indicator ----------------------------------------------------
// The indicator is built from the pieces the renderer is drawing, on arcs,
// retained between camera steps and moved by one transform. `_selectionAnts`
// carries the design; these are its numbers.
//
// A frame whose selected content spans LESS than this on screen is ONE DOT,
// and none of its members is looked at. Kobin, 2026-09-03, after a 15 px
// stroke on its own and a tile piece each came out as a box under the earlier
// 24 px ring rule: "change the frame-mark rule to only be objects <5px" — and
// then, having tried 5 on the phone, "I didn't like 5. Can we do 2 px". At
// two pixels the content is a speck by any measure; above it every piece is
// traced on its own edge, however small and however many.
const SEL_FRAME_MARK_PX = 2;
// What a dot is floored to, so something too small to see still shows where
// it is. THE ANTS OUTLIVE THE INK (Kobin, 2026-08-25): below `cullPx` the
// renderer stops painting an object, but its frame's mark stays.
//
// The speck is TINY, and it is a SOLID DOT rather than a dashed ring. That is
// not a simplification, it is what the design file actually renders, and it
// took reading its construction to see why: the file strokes the mark's own
// path FAT and masks the ink out of it, and for a sub-pixel dot the erode
// clamps to nothing while the circumference is shorter than a single dash, so
// what lands on screen is a solid dot about 2.25 px across. Three earlier
// attempts got this wrong by reasoning instead of reading.
const SEL_MIN_TRACE_PX = 0.5;
// The window the indicator RETAINS, as a fraction of the longer side of the
// screen beyond each edge. Runs are cut to it, marks beyond it are not built,
// and a pan that carries the view past it decides again. Wider means fewer
// decisions while panning and more off-screen ink for the rasteriser to walk
// on every frame of the crawl; a quarter screen is the same order as the
// tile changes that re-render the drawing anyway.
const SEL_KEEP_FRACTION = 0.5;
// Rects within `gap` of each other, unioned: what several specks on one pixel become.
function mergeClose(rects, gap) {
    const out = [];
    for (const r of rects) {
        let hit = null;
        for (const c of out) {
            if (r.left - gap <= c.right && r.right + gap >= c.left && r.top - gap <= c.bottom && r.bottom + gap >= c.top) { hit = c; break; }
        }
        if (!hit) { out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }); continue; }
        hit.left = Math.min(hit.left, r.left); hit.top = Math.min(hit.top, r.top);
        hit.right = Math.max(hit.right, r.right); hit.bottom = Math.max(hit.bottom, r.bottom);
    }
    return out;
}
// How far the zoom may drift from the scale the ants were decided at before
// they are decided again. Between decisions the layer is scaled by the
// compositor, so the band and the dashes drift with it: at 1.25 a 2.5 px band
// is at worst 3.1 or 2 px for the length of a pinch, and a decision (25 to
// 50 ms here) lands every quarter octave instead of a repaint every frame.
const SEL_REDECIDE_DRIFT = 1.25;
// A run shorter than this — two pieces a hundredth of a pixel apart — draws as
// a stray dot and is dropped.
const SEL_MIN_RUN_PX = 0.5;
// A selected object too small to trace — every run under SEL_MIN_RUN_PX — in a frame
// that is not itself a dot, is a dot of its own (F73); above this span it is large
// enough that something else is wrong, and no dot is drawn for it.
const SEL_OBJECT_DOT_PX = 8;
// The edge scan runs this far INSIDE each side of the view (see
// `edgeSpans`): on the side itself a boundary lying along it is degenerate.
const SEL_EDGE_INSET_PX = 0.05;
// THERE IS NO ANT BUDGET. The August cap on the total length of ants
// (24,000 px, spent largest piece first) was removed on 2026-09-03 at Kobin's
// instruction — "take off the budget" — after seeing what it left without
// ants on a dense drawing. The runs are cut to the retained window, so the
// 2026-08-22 stall (350,958 dashes on one 877,395 px rectangle, nearly all of
// it off screen) cannot recur by construction; what a full selection costs is
// the repaint of its on-screen length, about 0.8 µs a pixel on the desktop,
// measured, and that is now the phone's to report.
// A border segment gets a chevron only once it covers this much of its side.
// Short segments — a few fingers of ink touching the top of the frame — read
// perfectly well as ants continuing the outline, and an arrow on each would be
// clutter saying nothing.
const SEL_CHEVRON_FRACTION = 1 / 5;
/** A clip or attach rectangle as `{ rect, eps }` for the seam test. */
function clipRect(r) { return { rect: asRect(r), eps: rectTol(r) }; }
// A rect in either spelling, as {left,top,right,bottom}.
const asLTRB = (r) => ("x0" in r ? { left: r.x0, top: r.y0, right: r.x1, bottom: r.y1 } : r);
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
                    // An object with offsets below its home (F41) is drawn
                    // where its picture is; the view, in its units, is the
                    // view brought back through those offsets.
                    let vrO = vr;
                    if (o.below) vrO = this.lm.mapRectObj(win, F, L, o.below, L, true) || vr;
                    rings = this._outlineInView(o, vrO, tol);
                    if (rk) C.rings.set(rk, rings);
                }
                for (const ring of rings) this._emitOutlineRing(out, o, L, ring, entries, onScreen);
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
                const kidDepth = this.lm.depthOf(kid.level);
                if (kidDepth == null) continue;
                const kidArcs = contactArcs(ink(kid.obj, rectTol(R)), R, rectTol(R));
                if (!kidArcs.length) continue;
                // The piece this one was cut from is ONE LEVEL UP — but not
                // necessarily in the parent CELL. An object reaches into the
                // cell next door (invariant 2), a tile ceded out there is
                // addressed under the cell it sits in, and so its source lives
                // in a sibling of that cell's parent. Until 2026-09-03 this
                // matched on the parent frame id alone, found no source for
                // such a piece, recorded no join, and the piece wore ants on
                // all four sides of its tile: "the tile is showing as
                // selected" (Kobin, report 14-14-25, family 213, piece 227 at
                // 0/-81,-156/... cut from 225 at 0/-82,-156). So every member
                // one level up is a candidate, the rect is mapped into that
                // member's own frame, and the arc overlap decides — a wrong
                // candidate simply shares no arc and records nothing.
                for (const up of members) {
                    if (up === kid || this.lm.depthOf(up.level) !== kidDepth - 1) continue;
                    if (up.obj.type !== "shape" && up.obj.type !== "fill") continue;
                    const Rk = { left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 };
                    // The kid's window is unmoved numbers; it reaches the
                    // parent's stored coordinates through the parent's unmoved
                    // frame at the kid's level (F55), the same way the family
                    // check in `_familyComponents` does.
                    const upF0 = up.obj.below ? this.lm.objShift(up.obj.below, up.level, kid.level) : null;
                    const Rp = upF0 ? this.lm.mapRectF(Rk, upF0.F0, up.level) : this.lm.mapRectF(Rk, kid.level, up.level);
                    if (!Rp) continue;
                    const at = Math.max(rectTol(R) / rectSpan(R), rectTol(Rp) / rectSpan(Rp));
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
     * THE SELECTION INDICATOR: what the overlay hands the renderer.
     *
     * Returns null, or
     *   {
     *     key,            changes only when the geometry below was re-decided
     *     transform,      { k, tx, ty }: screen = k * retained + (tx, ty)
     *     runs,           [{ d, len }] ant runs in RETAINED space (see below)
     *     marks,          [{ d }] the dots, same space, stroked as specks
     *     edges,          [{ side, from, to, chevron }] in SCREEN space, per step
     *     inkPx, covered
     *   }
     *
     * WHERE THE GEOMETRY COMES FROM. The pieces the renderer is drawing —
     * `_lastList`, the tile store's content for the active frame plus the
     * frame's own natives — never the document's objects. That is a design
     * rule (Kobin, 2026-09-03: "a core design principle is we never reference
     * the original object"), and it is also what makes the indicator sound at
     * depth: a level-0 shape seen seven levels down has radii the browser
     * cannot hold, and the tile pipeline has already chopped it, frozen what
     * went straight, and put it in coordinates a float32 can carry. The one
     * thing the render list shows that the ink does not have is the CUTS — the
     * sides of the tiles and of the windows re-homed pieces were ceded
     * through — and every piece now carries the rectangle that cut it
     * (`piece.clip`), so a straight piece lying along one is skipped.
     *
     * NOTHING IS FLATTENED. Arcs go to the browser as the same cubics the ink
     * goes as; lengths are analytic; where the ink meets the side of the
     * screen is a winding scan of the boundary against that side's line
     * (`geometry/antRuns.js`). The August design flattened, clipped to the
     * window, split on joins and mapped every vertex on every zoom step, and
     * on a dense selection that was 187 ms a step.
     *
     * DECIDED RARELY, MOVED CHEAPLY. The runs are built in retained space —
     * screen pixels at the moment of deciding, relative to the scene origin
     * the ink itself uses — and cached against the render list, the selection,
     * the document revision, the frame, the origin and the zoom octave. Between
     * those changing, a zoom or pan step costs the three numbers of a
     * transform, which the renderer writes onto one group. That is how the ink
     * is rendered too, and it was the whole of Kobin's "how often are decisions
     * about where the strokes should be outlined made during zooming?".
     *
     * FRAMES SMALLER THAN A MARK ARE ONE DOT. A frame whose selected content
     * spans less than SEL_FRAME_MARK_PX on screen is a dot at that content,
     * and none of its members is looked at — invariant 2 bounds every member
     * to the frame's reach, so the frame's box on screen bounds them all
     * without a visit. That is the frame-tree rule Kobin asked for, and it is
     * where the thousands of specks in a deep frame go: one lookup, one dot.
     * A piece of a re-homed family never counts toward a frame's content: its
     * ants are the family's edge, drawn from the pieces, and a frame holding
     * nothing else is not marked at all.
     *
     * THERE IS NO BUDGET. Every selected piece on screen gets its ants; see
     * the note at SEL_KEEP_FRACTION for what bounds the work instead.
     *
     * A DRAG IS A TRANSLATION. While the selection is being dragged the
     * objects are rewritten on every pointer event and the render list with
     * them, which would decide again every event. Instead the decision made
     * on the drag's first event is kept for the whole drag, stamped with the
     * drag and the pointer position it was made at, and each event moves it
     * by the pointer's travel since — a screen translation, added to the
     * transform. Pen-up ends the drag and the next step decides afresh from
     * the moved geometry. (Until 2026-09-03 the loops were cached on the
     * piece object itself, and a native's loops are replaced in place by a
     * move, so the ants stayed where the object had been — Kobin: "the ants
     * have to move when the object is moved".)
     */
    _selectionAnts() {
        const s = this.selection;
        // Selection is a property of the select tool. Switching tools drops it
        // (see setTool), and this second check keeps the overlay honest even if
        // some path sets `tool` without going through there.
        if (!s || this.tool !== "select") return null;
        const table = this._selTable(s);
        if (!table.count) return null;
        const dec = this._selDecide(s, table);
        const sc = this.cam.inScale;
        const d = this._dragSel;
        const off = (d && dec.drag === d && d.last) ? [d.last[0] - dec.dragAt[0], d.last[1] - dec.dragAt[1]] : [0, 0];
        const edges = this._selEdges(dec, off);
        if (!dec.runs.length && !dec.marks.length && !edges.list.length) return null;
        return {
            key: dec.key,
            transform: { k: sc / dec.scale, tx: this.cam.inPanX + sc * dec.origin.x + off[0], ty: this.cam.inPanY + sc * dec.origin.y + off[1] },
            runs: dec.runs, marks: dec.marks, inkPx: dec.inkPx,
            edges: edges.list, covered: edges.covered,
        };
    }

    /**
     * The selection's members grouped by frame, each object once, erased marks
     * dropped, with each frame's union boxes of its selected members (in that
     * frame's units, one box per displacement table — F68: a translation keeps a
     * box a box, so `_selFrameRect` maps each once) and the set of every member
     * id. Cached against the selection object and the document's revision.
     */
    _selTable(s) {
        const c = this._selTableCache;
        if (c && c.sel === s && c.rev === this.doc.rev) return c.table;
        const seen = new Set();
        const byLevel = new Map();
        const ids = new Set();
        const levelOf = new Map();
        // Members of a family that spans more than one frame: they are drawn
        // through their pieces whatever their frame's mark, and do not count
        // toward it.
        const cross = new Set();
        for (const id of s.ids) {
            const group = this.doc.editGroup(id);
            let spans = false;
            for (const m of group) if (m.level !== group[0].level) { spans = true; break; }
            for (const m of group) {
                if (m.obj.erase || seen.has(m.obj)) continue;
                seen.add(m.obj);
                ids.add(m.obj.id);
                levelOf.set(m.obj.id, m.level);
                let e = byLevel.get(m.level);
                if (!e) { e = { objs: [], boxes: new Map() }; byLevel.set(m.level, e); }
                e.objs.push(m.obj);
                if (spans) { cross.add(m.obj.id); continue; }
                const b = bboxOf(m.obj, this.store.live);
                if (!b) continue;
                const key = m.obj.below ? JSON.stringify(m.obj.below) : "";
                const bx = e.boxes.get(key);
                if (!bx) { e.boxes.set(key, { below: m.obj.below, box: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } }); continue; }
                if (b.x0 < bx.box.x0) bx.box.x0 = b.x0;
                if (b.y0 < bx.box.y0) bx.box.y0 = b.y0;
                if (b.x1 > bx.box.x1) bx.box.x1 = b.x1;
                if (b.y1 > bx.box.y1) bx.box.y1 = b.y1;
            }
        }
        const table = { byLevel, ids, levelOf, cross, count: seen.size };
        this._selTableCache = { sel: s, rev: this.doc.rev, table };
        return table;
    }
    /**
     * Where a frame's selected members are DRAWN, in F's units: each box through its
     * members' displacement table (F68 — the frame's mark sat on the stored bits, a
     * cell away from moved ink, and jumped there once the ink was too small for ants).
     */
    _selFrameRect(info, L, F) {
        let out = null;
        for (const { below, box } of info.boxes.values()) {
            const R = { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 };
            const r = below ? this.lm.mapRectObj(R, L, F, below, L) : this.lm.mapRectF(R, L, F);
            if (!r) continue;
            out = out ? { left: Math.min(out.left, r.left), top: Math.min(out.top, r.top), right: Math.max(out.right, r.right), bottom: Math.max(out.bottom, r.bottom) } : r;
        }
        return out;
    }

    /**
     * The decision: which frames are one mark, which pieces get ants and along
     * which of their pieces, in retained coordinates. Cached; see
     * `_selectionAnts` for the key.
     */
    _selDecide(s, table) {
        const list = this._lastList || [];
        const F = this.cam.frame, sc = this.cam.inScale;
        const O = this.renderer._origin();
        const vp = this.cam.frameWindow(0);
        const c = this._selDec;
        // During a drag the decision made on its first event stands for the
        // whole drag (see `_selectionAnts`); otherwise it is still good while
        // the same list, selection, document, frame and origin stand, the view
        // is inside the retained window, and the zoom has not drifted past
        // SEL_REDECIDE_DRIFT from the scale it was decided at — between
        // decisions the ants ride a compositor transform, so the band and the
        // dashes are a little off their screen size until the next.
        const drag = this._dragSel || null;
        if (c && drag && c.drag === drag && c.sel === s && c.frame === F) return c;
        if (c && !drag && !c.drag && c.list === list && c.sel === s && c.rev === this.doc.rev && c.frame === F && c.origin === O
            && sc / c.scale <= SEL_REDECIDE_DRIFT && c.scale / sc <= SEL_REDECIDE_DRIFT
            && vp.left >= c.win.left && vp.right <= c.win.right && vp.top >= c.win.top && vp.bottom <= c.win.bottom) return c;

        const runs = [], marks = [], pieces = [];
        let inkPx = Infinity;
        const retained = (loop, closed) => runPathData({ pieces: loop, closed }, O.x, O.y, sc);
        const win = this.cam.frameWindow(SEL_KEEP_FRACTION * Math.max(this.width, this.height) / sc);
        const keep = { x0: win.left, y0: win.top, x1: win.right, y1: win.bottom };

        // ---- frames that are one mark -------------------------------------------
        const marked = new Set();
        for (const [L, info] of table.byLevel) {
            if (!info.boxes.size) continue;
            const r = this._selFrameRect(info, L, F);
            if (!r) { marked.add(L); continue; }         // unreachable from here: nothing to show
            const span = Math.max(r.right - r.left, r.bottom - r.top) * sc;
            if (span >= SEL_FRAME_MARK_PX) continue;
            marked.add(L);
            if (r.right < win.left || r.left > win.right || r.bottom < win.top || r.top > win.bottom) continue;
            // A DOT, round and stroked as a speck by the renderer. The radius
            // tracks the content, floored at SEL_MIN_TRACE_PX, so a 1.4 px
            // frame stays visibly larger than a half-pixel one.
            const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
            const rad = Math.max(SEL_MIN_TRACE_PX, span) / 2 / sc;
            marks.push({ d: retained(circleLoop(cx, cy, rad), true) });
        }

        // ---- the pieces on screen that belong to the selection -------------------
        const seamCache = new Map();
        const traced = new Set();
        for (const piece of list) {
            if (!table.ids.has(piece.id)) continue;
            if (marked.has(table.levelOf.get(piece.id)) && !table.cross.has(piece.id)) continue;
            let loops = this._selPieceLoops(piece);
            if (!loops || !loops.length) continue;
            // The ants show what is DRAWN, and a piece with a residual (F41) is
            // drawn shifted by it.
            if (piece.res) loops = translateLoops(loops, piece.res[0], piece.res[1]);
            const bounds = loopsBounds(loops);
            // Every selected piece takes part in the edge scan: where the ink
            // leaves the screen is a fact about the ink.
            pieces.push({ loops, bounds });

            // HOW HEAVY IS THIS INK ON SCREEN? The design scales the ants to the
            // paint. `lwFrame` is absent on a resolved shape, so the thickness
            // comes from the geometry — twice the area over the perimeter,
            // exact on arcs — capped by the piece's own size on screen, since
            // a convoluted outline packed into a few pixels overlaps itself
            // whatever its ink weight says.
            let thick = piece.lwFrame || 0;
            if (!thick && piece.type !== "stroke") { try { thick = meanWidth(loops); } catch (err) { thick = 0; } }
            const thickPx = thick > 0 ? thick * sc : Infinity;
            const sizePx = bounds ? Math.min(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * sc : Infinity;
            inkPx = Math.min(inkPx, thickPx, sizePx);

            const rects = this._selSeamRects(piece, table, F, seamCache);
            for (const loop of loops) {
                for (const seamRun of loopRuns(loop, rects)) {
                    for (const run of clipRunToRect(seamRun, keep)) {
                        const len = runLength(run.pieces) * sc;
                        if (len < SEL_MIN_RUN_PX) continue;
                        runs.push({ d: retained(run.pieces, run.closed), len });
                        traced.add(piece.id);
                    }
                }
            }
        }

        // ---- selected objects too small to trace: a dot each (F73) ----------------
        // A frame whose content spans the screen can hold a member a fraction of a
        // pixel across (Kobin's report 22-43-41: one moved sliver beside 352 others):
        // its runs fall under SEL_MIN_RUN_PX and it drew nothing. Every member without
        // a run — culled from the list, or traced to nothing — that is under
        // SEL_OBJECT_DOT_PX is a dot where its picture is; dots on one pixel are one.
        const small = [];
        for (const id of table.ids) {
            if (traced.has(id) || table.cross.has(id) || marked.has(table.levelOf.get(id))) continue;   // a family's kid shows through its family
            const rec = this.doc.getById(id);
            if (!rec) continue;
            const r = this._rectInActive(rec.obj, rec.level);
            if (!r || r.right < win.left || r.left > win.right || r.bottom < win.top || r.top > win.bottom) continue;
            if (Math.max(r.right - r.left, r.bottom - r.top) * sc >= SEL_OBJECT_DOT_PX) continue;
            small.push(r);
        }
        for (const r of mergeClose(small, SEL_FRAME_MARK_PX / sc)) {
            const span = Math.max(r.right - r.left, r.bottom - r.top) * sc;
            const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
            marks.push({ d: retained(circleLoop(cx, cy, Math.max(SEL_MIN_TRACE_PX, span) / 2 / sc), true) });
        }

        this._selDecSeq = (this._selDecSeq || 0) + 1;
        this._selDec = { key: this._selDecSeq, list, sel: s, rev: this.doc.rev, frame: F, origin: O, win,
            scale: sc, runs, marks, inkPx, pieces,
            drag, dragAt: drag ? (drag.last ? [drag.last[0], drag.last[1]] : [drag.start[0], drag.start[1]]) : null };
        return this._selDec;
    }

    /**
     * A render-list piece as loops of arcs and lines — the same geometry the
     * ink is drawn from. A polygon fill becomes line loops; an unresolved
     * stroke gets the capsule outline the renderer itself uses, which is arcs.
     * Cached on the piece against the geometry it was made from: a tile piece
     * never changes, but a NATIVE in the render list is the document's own
     * object, and a move replaces its loops in place.
     */
    _selPieceLoops(piece) {
        const src = piece.type === "shape" ? piece.loops : piece.type === "fill" ? piece.polys : piece.pts;
        if (piece._antLoops !== undefined && piece._antFor === src) return piece._antLoops;
        let loops = null;
        if (piece.type === "shape") loops = piece.loops;
        else if (piece.type === "fill") loops = shapeFromRings(piece.polys);
        else if (piece.type === "stroke" && piece.pts && piece.pts.length > 1) {
            try { loops = strokeLoops(piece, this.cfg, { curved: piece.origin === "native", live: this.store.live }); } catch (err) { loops = null; }
        }
        piece._antLoops = loops || null;
        piece._antFor = src;
        return piece._antLoops;
    }

    /**
     * The rectangles a piece may have been cut on, in the active frame's units:
     * the tile that clipped it (`piece.clip`), and the attach windows of every
     * member of its family — the piece that fills a window has that window as
     * its edge, and the piece it was cut from has it as its hole. A straight
     * piece lying along any of them is a seam and gets no ants, which is
     * "no ants on the tile edge" and the F37 join rule in one test.
     */
    _selSeamRects(piece, table, F, cache) {
        const key = piece.id;
        // Everything here is where the ink is DRAWN: a piece with a residual
        // (F41) has its clip and its family's windows shifted by it too.
        const shift = (r) => (piece.res ? { left: r.left + piece.res[0], right: r.right + piece.res[0], top: r.top + piece.res[1], bottom: r.bottom + piece.res[1] } : r);
        const own = () => clipRect(shift(asLTRB(piece.clip)));
        let rects = cache.get(key);
        if (rects) {
            if (!piece.clip) return rects;
            return rects.concat([own()]);
        }
        rects = [];
        const rec = this.doc.getById(piece.id);
        if (rec) {
            for (const m of this.doc.editGroup(rec.obj)) {
                const R = m.obj.attachRect;
                if (!R) continue;
                const Rl = { left: R.x0, top: R.y0, right: R.x1, bottom: R.y1 };
                // `mapRectObj` answers where the picture IS (remainder
                // included, F55), so it is not shifted again; a window in the
                // member's own frame, and one reached exactly, still are.
                const mapped = m.level === F ? shift(Rl)
                    : (m.obj.below ? this.lm.mapRectObj(Rl, m.level, F, m.obj.below, m.level) : shift(this.lm.mapRectF(Rl, m.level, F)));
                if (mapped) rects.push(clipRect(mapped));
            }
        }
        cache.set(key, rects);
        return piece.clip ? rects.concat([own()]) : rects;
    }

    /**
     * Where the selection meets the SIDES of the screen, in screen space, per
     * step — the viewport moves between decisions and this is about the
     * viewport. Only where the INK reaches the side, not where a bounding box
     * does: a shape with several fingers touching the top edge marks those
     * fingers and nothing between them, so the border ants read as the
     * outline continuing rather than as a box drawn round the view. A
     * selection wholly inside the view produces no span and no chevron.
     */
    _selEdges(dec, off = [0, 0]) {
        const W = this.width, H = this.height, sc = this.cam.inScale;
        const vp = this.cam.frameWindow(0);
        // During a drag the pieces are where they were decided and the ink is
        // `off` screen pixels further on: ask about the view shifted back.
        const rect = { x0: vp.left - off[0] / sc, y0: vp.top - off[1] / sc, x1: vp.right - off[0] / sc, y1: vp.bottom - off[1] / sc };
        const sides = { left: [], right: [], top: [], bottom: [] };
        let covered = false;
        const toY = (v) => v * sc + this.cam.inPanY + off[1], toX = (v) => v * sc + this.cam.inPanX + off[0];
        for (const p of dec.pieces) {
            const b = p.bounds;
            if (!b) continue;
            if (b.x1 < rect.x0 || b.x0 > rect.x1 || b.y1 < rect.y0 || b.y0 > rect.y1) continue;
            if (b.x0 >= rect.x0 && b.x1 <= rect.x1 && b.y0 >= rect.y0 && b.y1 <= rect.y1) continue;
            const sp = edgeSpans(p.loops, rect, (q) => insideLoops(p.loops, q), SEL_EDGE_INSET_PX / sc);
            if (sp.covered) covered = true;
            for (const [a, b2] of sp.left) sides.left.push([toY(a), toY(b2)]);
            for (const [a, b2] of sp.right) sides.right.push([toY(a), toY(b2)]);
            for (const [a, b2] of sp.top) sides.top.push([toX(a), toX(b2)]);
            for (const [a, b2] of sp.bottom) sides.bottom.push([toX(a), toX(b2)]);
        }
        const SIDE_LEN = { left: H, right: H, top: W, bottom: W };
        const list = [];
        for (const side of ["left", "right", "top", "bottom"]) {
            const merged = mergeSpans(sides[side], 1.5);
            const full = SIDE_LEN[side];
            for (const [a, b] of merged) {
                const lo = Math.max(0, a), hi = Math.min(full, b);
                if (hi - lo < 2) continue;
                list.push({ side, from: lo, to: hi, chevron: (hi - lo) >= full * SEL_CHEVRON_FRACTION });
            }
        }
        return { list, covered };
    }

    _emitOutlineRing(out, obj, L, ring, entries, onScreen) {
        const id = obj.id;
        const n = ring.length;
        if (n < 2 || n > 200000) return;
        // Through the object's own picture (F41): with no offsets this is the
        // camera's `levelPointToScreen`.
        const toScreen = (p) => {
            const q = this._objPointInActive(obj, L, p);
            return q ? [q[0] * this.cam.inScale + this.cam.inPanX, q[1] * this.cam.inScale + this.cam.inPanY] : null;
        };
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
            const s0 = toScreen(p0);
            const s1 = toScreen(p1);
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
