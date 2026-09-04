/**
 * Shared scaffolding for the layered erase/tile/window suites.
 *
 * NOT collected by jest (the directory is `__testkit__`). Everything here is
 * deliberately slop-free — see ink.js on trap T-1. In particular `raster` is the
 * closest thing to "what the user sees" that a jsdom test can get: it samples
 * the render list the way the renderer paints it, so it catches a piece that
 * vanished, moved, changed shape, or changed z-order, none of which a structural
 * assertion about object counts would notice.
 */
import KobinEngine from "../KobinEngine";
import { pieceInks, inks } from "./ink";
import { encodeLoops } from "../geometry/arcShape";

const live = [];
/** Register per-file cleanup. Call at the top level of a describe/test file. */
export function useEngines() {
    afterEach(() => { while (live.length) { try { live.pop().destroy(); } catch (e) { /* ignore */ } } });
}
export function mkEngine(w = 800, h = 600) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    live.push(e);
    return e;
}

// ---- authoring ----
/**
 * Draw a stroke and let its perimeter RESOLVE before returning.
 *
 * In the app the resolve happens in idle slices over the next few frames; a test
 * has no frames, so it is driven to completion here. Pass `raw: true` to see the
 * stroke as it is between pen-up and the bake — which is a real state, and worth
 * testing, but not the one almost every assertion means.
 */
export function drawStroke(E, pts, width = 13, color, { raw = false } = {}) {
    E.setTool("pen"); E.setWidth(width);
    if (color) E.setColor(color);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    if (!raw) E.flushBakes();
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
}
/** An eraser gesture, its own shape resolved, but NOT yet baked into the ink. */
export function eraseGesture(E, pts, size) {
    if (size != null) E.setEraserSize(size);
    E.setTool("erasePartial");
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.flushBakes();
}
export function erase(E, pts, size) { eraseGesture(E, pts, size); E.flushErases(); }
export function drag(E, from, to, steps = 6) {
    E.setTool("select");
    E.pointerDown(from[0], from[1]); E.pointerUp();   // tap-select first: since 2026-09-03 a drag with nothing selected is a lasso
    E.pointerDown(from[0], from[1]);
    for (let i = 1; i <= steps; i++) {
        E.pointerMove(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    }
    E.pointerUp();
}
export function click(E, sx, sy, ctrl = false) {
    E.setTool("select"); E.pointerDown(sx, sy, ctrl); E.pointerUp();
}
export function pan(E, dx, dy) { E.setTool("pan"); E.panBy(dx, dy); }

// ---- navigation ----
export function descend(E, n, sx = 400, sy = 300) {
    let guard = 0;
    while (E.activeLevel < n && guard++ < 600) E.zoomAt(sx, sy, -1000);
    return E.activeLevel;
}
/**
 * NB `descend`/`ascend` reach a LEVEL, not a view. Two things routinely make a
 * probe vacuous if you forget:
 *   - descending about (sx, sy) keeps only the frame point under (sx, sy) on
 *     screen. Ink 100 units away at level 0 is 300,000 px away one crossing
 *     down. Descend about the ink you mean to look at.
 *   - ascending stops the moment activeLevel hits the target, with the in-level
 *     zoom wherever the last step left it (commonly 128x, not 1x). It is NOT
 *     the inverse of descend. Use camShot/camRestore, or topView.
 */
export function ascend(E, n, sx = 400, sy = 300) {
    let guard = 0;
    while (E.activeLevel > n && guard++ < 600) E.zoomAt(sx, sy, 1000);
    return E.activeLevel;
}
/** The pristine camera a fresh engine starts with: level 0, 1:1, unpanned. */
export function topView(E) {
    E.cam.set({ activeLevel: 0, frame: "0", inScale: 1, inPanX: 0, inPanY: 0 });
    E._render();
}
/**
 * Remember / restore the exact camera. Zooming out and back in lands close but
 * not identical (the crossing thresholds are asymmetric by design: enter 300,
 * exit 0.05), so any probe that compares a picture taken before a trip with one
 * taken after has to put the camera back exactly, or it measures its own pan.
 */
export const camShot = (E) => E.cam.state();
export function camRestore(E, s) { E.cam.set(s); E._render(); }

/** Zoom out to level `n` and straight back in, the classic consistency round trip. */
export function roundTrip(E, out = 0, sx = 400, sy = 300) {
    const back = E.activeLevel;
    ascend(E, out, sx, sy);
    descend(E, back, sx, sy);
    return E.activeLevel;
}

// ---- reading the picture ----
export const painted = (E) => { E._render(); return E._objs().filter((o) => !o.erase); };
/** Everything the renderer draws, INCLUDING un-baked eraser marks. */
export const paintedAll = (E) => { E._render(); return E._objs(); };
/** The piece painting `p` last, counting eraser marks — literally what shows. */
export function topAtAll(E, sx, sy) {
    const list = paintedAll(E), p = E.cam.screenToFrame(sx, sy);
    for (let i = list.length - 1; i >= 0; i--) if (pieceInks(list[i], p)) return list[i];
    return null;
}
/**
 * What the user actually sees: a cell is set when the TOP-most thing painting it
 * is real ink rather than an eraser mark. This is the only fair way to compare a
 * drawing before and after a bake — `raster` counts the ink still sitting under
 * an un-baked mark, which is exactly the ink the user cannot see.
 */
export function rasterVisible(E, n = 48, box) {
    const b = box || { x0: 0, y0: 0, x1: E.width, y1: E.height };
    const list = paintedAll(E);
    const out = [];
    for (let j = 0; j < n; j++) {
        let row = "";
        for (let i = 0; i < n; i++) {
            const p = E.cam.screenToFrame(b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0),
                b.y0 + ((j + 0.5) / n) * (b.y1 - b.y0));
            let top = null;
            for (let k = list.length - 1; k >= 0; k--) if (pieceInks(list[k], p)) { top = list[k]; break; }
            row += (top && !top.erase) ? "#" : ".";
        }
        out.push(row);
    }
    return out.join("\n");
}
export const inkAt = (E, sx, sy) => inks(painted(E), E.cam.screenToFrame(sx, sy));
/** The piece painting `p` LAST — i.e. the one the user actually sees there. */
export function topAt(E, sx, sy) {
    const list = painted(E), p = E.cam.screenToFrame(sx, sy);
    for (let i = list.length - 1; i >= 0; i--) if (pieceInks(list[i], p)) return list[i];
    return null;
}
export const colorAt = (E, sx, sy) => { const o = topAt(E, sx, sy); return o ? o.color : null; };

/**
 * A coarse bitmap of the screen: 1 bit per cell, true where anything is painted.
 * `n` cells across the given box (default the whole canvas). This is the
 * workhorse for "nothing changed" assertions — it sees shape, position and
 * presence at once, and unlike an object-count check it cannot be satisfied by
 * geometry that merely rearranged itself.
 */
export function raster(E, n = 48, box) {
    const b = box || { x0: 0, y0: 0, x1: E.width, y1: E.height };
    const list = painted(E);
    const out = [];
    for (let j = 0; j < n; j++) {
        let row = "";
        for (let i = 0; i < n; i++) {
            const sx = b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0);
            const sy = b.y0 + ((j + 0.5) / n) * (b.y1 - b.y0);
            row += inks(list, E.cam.screenToFrame(sx, sy)) ? "#" : ".";
        }
        out.push(row);
    }
    return out.join("\n");
}
/** Same, but each cell records WHICH colour is on top — catches z-order flips. */
export function rasterZ(E, n = 32, box) {
    const b = box || { x0: 0, y0: 0, x1: E.width, y1: E.height };
    const list = painted(E);
    const key = new Map();
    const out = [];
    for (let j = 0; j < n; j++) {
        let row = "";
        for (let i = 0; i < n; i++) {
            const sx = b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0);
            const sy = b.y0 + ((j + 0.5) / n) * (b.y1 - b.y0);
            const p = E.cam.screenToFrame(sx, sy);
            let top = null;
            for (let k = list.length - 1; k >= 0; k--) if (pieceInks(list[k], p)) { top = list[k]; break; }
            if (!top) { row += "."; continue; }
            const c = top.color || "?";
            if (!key.has(c)) key.set(c, String.fromCharCode(97 + key.size));
            row += key.get(c);
        }
        out.push(row);
    }
    return out.join("\n");
}
/** Cells set in `a` but not `b`, and vice versa. */
export function rasterDiff(a, b) {
    const A = a.split("\n"), B = b.split("\n");
    let lost = 0, gained = 0;
    for (let j = 0; j < Math.max(A.length, B.length); j++) {
        const ra = A[j] || "", rb = B[j] || "";
        for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
            const x = ra[i] === "#", y = rb[i] === "#";
            if (x && !y) lost++;
            if (!x && y) gained++;
        }
    }
    return { lost, gained, total: lost + gained };
}

/** Longest inked run down screen column `sx`, in screen px, or null. */
export function inkRunY(E, sx, y0 = 0, y1) {
    const list = painted(E), hi = y1 == null ? E.height : y1;
    let best = null, cur = null;
    for (let sy = y0; sy <= hi; sy++) {
        if (inks(list, E.cam.screenToFrame(sx, sy))) {
            if (!cur) cur = [sy, sy]; else cur[1] = sy;
            if (!best || cur[1] - cur[0] > best[1] - best[0]) best = [cur[0], cur[1]];
        } else cur = null;
    }
    return best;
}
/** Every inked run across screen row `sy` — how many separate lumps, and where. */
export function inkRunsX(E, sy, x0 = 0, x1) {
    const list = painted(E), hi = x1 == null ? E.width : x1;
    const out = [];
    let cur = null;
    for (let sx = x0; sx <= hi; sx++) {
        if (inks(list, E.cam.screenToFrame(sx, sy))) {
            if (!cur) { cur = [sx, sx]; out.push(cur); } else cur[1] = sx;
        } else cur = null;
    }
    return out;
}

// ---- document shape ----
/** How many logically distinct objects the document holds (bible §3's families). */
export function families(E) {
    const keys = new Set();
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) keys.add(E.doc.editKey(o));
    return keys.size;
}
export function natives(E) {
    const out = [];
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) if (!o.erase) out.push({ obj: o, level: k });
    return out;
}
export function vertexCount(E) {
    let n = 0;
    for (const o of painted(E)) {
        if (o.type === "shape") { for (const l of o.loops) n += l.length; }
        else if (o.type === "fill") { for (const r of o.polys) n += r.length; }
        else n += o.pts.length;
    }
    return n;
}
/** A value fingerprint of the render list — geometry, colour, opacity, order. */
export function picture(E) {
    return JSON.stringify(painted(E).map((o) => [
        o.id, o.type, o.color, o.opacity,
        o.type === "shape" ? encodeLoops(o.loops)
            : o.type === "fill" ? o.polys.map((r) => r.map((p) => [p[0], p[1]]))
                : [o.pts, o.lwFrame],
    ]));
}

// ---- tiles ----
export const frameToScreen = (E, x, y) => [x * E.cam.inScale + E.cam.inPanX, y * E.cam.inScale + E.cam.inPanY];
/**
 * Screen x of a vertical tile boundary of the ACTIVE frame's grid, and screen y
 * of a horizontal one — as close to (sx, sy) as the lattice allows. Tests that
 * want to erase ACROSS a seam need the seam's real position, not a guess: the
 * grid is 30 screens wide at base zoom, so a boundary is only on screen at all
 * when you are zoomed well in.
 */
export function tileSeam(E, sx = 400, sy = 300) {
    const g = E.lm.grid(E.cam.frame);
    const p = E.cam.screenToFrame(sx, sy);
    const fx = g.ox + Math.round((p[0] - g.ox) / g.w) * g.w;
    const fy = g.oy + Math.round((p[1] - g.oy) / g.h) * g.h;
    const [x, y] = frameToScreen(E, fx, fy);
    return { x, y, fx, fy, w: g.w * E.cam.inScale, h: g.h * E.cam.inScale };
}
/** Put a frame point at a given screen position (pans; does not zoom). */
export function centerOn(E, fx, fy, sx = 400, sy = 300) {
    const [x, y] = frameToScreen(E, fx, fy);
    pan(E, sx - x, sy - y);
}

// ---- timing ----
export function timeIt(fn, runs = 1) {
    const t0 = Date.now();
    for (let i = 0; i < runs; i++) fn(i);
    return (Date.now() - t0) / runs;
}
