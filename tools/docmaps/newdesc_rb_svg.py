# -*- coding: utf-8 -*-
"""Per-function entries for the SVG pieces both renderers share: the live stroke
(raster/LiveStrokeLayer.js), the Two.js layer (raster/SvgLayer.js), the overlays
(raster/svgOverlay.js) and the anchors (raster/svgAnchors.js). Written 2026-10-05."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/LiveStrokeLayer.js":
        "The stroke under the pen, in the SVG layer's `world` (DESIGN.md §9): a short tail and frozen chunks behind "
        "it under one root carrying the opacity; a pen-up's path held until the group commit that shows its plates, "
        "and carried into the new frame at a crossing.",
    "src/engine/raster/SvgLayer.js":
        "The one Two.js instance a renderer keeps: the camera's `world` group, the debug groups and the lasso's group, "
        "in paint order. The SVG renderer draws its ink into `world`; the raster renderer only the live stroke.",
    "src/engine/raster/svgOverlay.js":
        "The SVG overlays both renderers draw, one implementation each: the lasso, the tile and erase debug outlines, "
        "and the selection indicator's SVG — its layers, its stylesheet, the chevrons and the SVG renderer's ants.",
    "src/engine/raster/svgAnchors.js":
        "How a piece becomes Two.js anchors, for the SVG ink and the live stroke: relative to an origin, each arc "
        "written by the plan made once per piece (DESIGN.md §9, F40).",
}


# ---- src/engine/raster/LiveStrokeLayer.js ----
add("lsl.viewCenter", "viewCenter(cam)",
    "The view's centre in frame units, rounded: the origin a stroke or a scene is drawn relative to (FC6).",
    ["Browsers rasterise SVG in float32, so every anchor is built relative to an origin near the view and the origin folded back into the transform in float64 (DESIGN.md §9, per-scene origin)."],
    "§9")
add("lsl.LiveStrokeLayer", "LiveStrokeLayer",
    "The stroke under the pen in the SVG layer's `world`: a short tail and frozen chunks of 128 anchors behind it, under one root carrying the opacity; strokes past pen-up held until their plates are in.",
    ["One path's whole `d` rebuilt every event was 27 ms at 3,000 samples (D-1). The ink under the pen is the biarc chain drawn as arcs, so pen-up changes nothing you see. A held root keeps the origin it was drawn at and is translated by that less the current one, so a held path stays put when the next stroke moves the origin (F131). The layer's group is in `world` only while it holds a path: an empty sibling group moved a translucent group's composite by one level in headless Chromium."],
    "§9")
add("lsl.LiveStrokeLayer.constructor", "LiveStrokeLayer.constructor(parent, plan)",
    "A layer over the parent Two.js group, with the arc plan its arcs are written by.", ["-"], "§9")
add("lsl.begin", "begin(o, origin)",
    "Pen-down: a new root at the stroke's opacity with an empty tail, relative to the origin — moving the origin re-anchors every held root; a stroke still open is cancelled.", ["-"], "§9")
add("lsl.arcs", "arcs(gaps)",
    "Re-lays the tail from the pen's gaps: only the last two gaps can change with a new sample, so the tail is spliced back to its final anchors and re-appended — a handful of anchors a sample however long the stroke; past 128 final anchors they freeze into a chunk.",
    ["A stroke with no gap yet is a dot: a zero-length subpath, which the round cap paints as the disc the pen leaves (without the second anchor the first tap would be invisible)."],
    "§9")
add("lsl._freeze", "_freeze()",
    "The tail's final anchors frozen into a path of their own; the tail restarts at the last one with a move carrying its handle.", ["-"], "§9")
add("lsl.hold", "hold()",
    "Pen-up while the stroke's plates are not in yet: its root stays drawn, with its id and origin, until `release(id)`.",
    ["The renderer releases it in the task whose group commit publishes the drawn cells under the stroke (DESIGN.md §9, A3 §3.6)."],
    "§9")
add("lsl.release", "release(id)", "Takes a held stroke's root down; false when none is held.", ["-"], "§9")
add("lsl.cross", "cross(map, origin)",
    "The view crossed into another frame: each held root carried into it — scaled and re-placed by `map`, or returned to be released — and the origin moved, re-anchoring every held root (F131 across a frame).", ["-"], "§9")
add("lsl.cancel", "cancel()",
    "The stroke under the pen taken down, never held: a cancelled stroke, or a pen-up whose ink is drawn at once.", ["-"], "§9")
add("lsl._detachIfEmpty", "_detachIfEmpty()", "The layer's group out of `world` once it holds nothing.", ["-"], "§9")
add("lsl.destroy", "destroy()", "Everything down, the group out of its parent.", ["-"], "§9")
add("lsl.livePath", "livePath(color, lw, verts)", "An open, round-capped, round-joined stroke path with no fill.", ["-"], "§9")


# ---- src/engine/raster/SvgLayer.js ----
add("svl.SvgLayer", "SvgLayer",
    "The one Two.js instance a renderer keeps: the camera's `world` group, the tile and erase debug groups, and the lasso's screen-space group, in paint order. It owns the `<svg>` element's lifetime.",
    ["The SVG renderer draws its ink into `world`; the raster renderer only the live stroke, at z-index 1 over the plates (DESIGN.md §9, A3 §7.2)."],
    "§9")
add("svl.SvgLayer.constructor", "SvgLayer.constructor(container, {width, height})",
    "A Two.js instance appended to the host, with its four groups.", ["-"], "§9")
add("svl.element", "element (getter) · setSize · update",
    "The `<svg>` element; resize it; draw the scene now.", ["-"], "§9")
add("svl.destroy", "destroy()",
    "The element out of the host and the instance off `Two.Instances`: a paused instance still pins its scene (measured 2026-09-08: each thumbnail engine's 2,103 paths stayed reachable for the life of the tab).", ["-"], "§9")

# ---- src/engine/raster/svgAnchors.js ----
add("sva.arcPlanOf", "arcPlanOf(cfg)",
    "The arc plan pieces are written by: the frame's deepest zoom and the tolerance in px (no length split).", ["-"], "§9")
add("sva.pushMove", "pushMove(verts, pt, og)", "Appends a move anchor at a point, relative to the origin.", ["-"], "§9")
add("sva.pushLine", "pushLine(verts, A, B, og, ctx)",
    "Appends a line as anchors, split into equal parts when the length split is on and the line is not a seam on the clip's edge.", ["-"], "§9")
add("sva.pushArcPiece", "pushArcPiece(verts, p, og, ctx)",
    "Appends one arc piece by the plan made once per piece: the SVG arc command, or kappa cubics built from its ends and sweep with no centre anywhere.",
    ["The choice is made at the engine's quarter-pixel tolerance and the frame's deepest zoom, so it never changes while zooming: the arc command while the browser's float32 centre is within tolerance, else as many cubics as the sixth-root law demands (DESIGN.md §9, F40). A cubic's first handle belongs to the anchor it leaves, so it reaches back and sets it there. `_mid` on an anchor is its part's midpoint, for the thin rescale's thickness estimate."],
    "§9")
add("sva.pushGapAnchors", "pushGapAnchors(verts, gap, og, ctx)",
    "Appends one biarc gap's arcs as anchors, continuing the path: each new arc touches nothing behind it, which lets the live pen extend its path in O(1).", ["-"], "§9")
add("sva.pushShapeAnchors", "pushShapeAnchors(verts, loops, og, ctx)",
    "Appends a resolved outline as anchors: each loop ends where it began and the path stays open.",
    ["A fill closes its subpaths itself, while Two's `closed` flag would rule a stray segment from the end of one loop back to the start of the whole path."],
    "§9")
add("sva.pushRingAnchors", "pushRingAnchors(verts, poly, og, ctx)",
    "Appends a polygon ring as a move and lines; the closing edge is written out (and split) only when it is long enough to be split, else the fill closes it.", ["-"], "§9")
add("sva.mkPath", "mkPath(verts, closed, curved, manual)",
    "Builds a Two.js path without ever handing it an unbounded array: the anchors are pushed in chunks of 4,096.",
    ["Two.js's collection takes its contents through `push.apply`, which V8 refuses past about 131,072 arguments — reachable by drawing (a fat stroke's capsule outline runs ~13 cubics per centreline anchor), and a crash with no ink rather than a slow render. Pushing through the collection keeps each anchor's `insert` event."],
    "§9")


# ---- src/engine/raster/svgOverlay.js ----
add("svo.selAntScale", "selAntScale(inkPx)",
    "The ants' scale for a mark's ink width: thin marks shrink the whole pattern together, down to the speck's own band (0.7), so the indicator never buries what it points at.", ["-"], "§10")
add("svo.clearGroup", "clearGroup(g)", "A Two.js group's children dropped.", ["-"], "§9")
add("svo.SvgOverlays", "SvgOverlays",
    "The lasso and the two debug overlays, drawn into `SvgLayer`'s groups from what the engine's functions give; both renderers own one and call it from their overlay tail.", ["-"], "§9")
add("svo.SvgOverlays.constructor", "SvgOverlays.constructor(layer, cam)", "The overlays over a renderer's `SvgLayer` and the engine's camera, all off.", ["-"], "§9")
add("svo.setLasso", "setLasso · setTileDebug · setEraseDebug",
    "Set what the lasso, the tile-debug and the erase-debug overlays read from; turning a debug overlay off clears its group.", ["-"], "§15")
add("svo.render", "render()", "All three overlays, in paint order: tiles, erase, lasso.", ["-"], "§9")
add("svo.lasso", "lasso()",
    "The lasso in progress, in screen coordinates — a gesture, not geometry — dashed terracotta like the ants; the lasso is all this group draws (F39).", ["-"], "§10")
add("svo.tiles", "tiles()", "The cached tiles' rectangles in red, in screen space (the tile-debug overlay).", ["-"], "§15")
add("svo.erase", "erase()",
    "The erase-debug overlay over the ink: orange a shape's own boundary, green where it touches a parent or child across their shared tile edge — the relation severance is decided on — and yellow an eraser mark.", ["-"], "§15")
add("svo.mkSelLayer", "mkSelLayer(svg, host, cls)",
    "One indicator layer — its own `<svg>`, laid exactly over the drawing's — built once and only updated afterwards, because a CSS animation restarts whenever its element is replaced.", ["-"], "§10")
add("svo.buildSelOverlay", "buildSelOverlay(svg)",
    "The SVG renderer's two indicator layers: the retained ants, moved by a CSS transform and repainted only when the decision changes or the crawl steps, and the screen-edge runs, which change every step.",
    ["In one layer the edge runs would have repainted every ant on every step. The raster renderer builds only the edge layer (`bl-sel-edges`); its ants are painted on `OverlayLayer`'s canvas."],
    "§10")
add("svo.dropSelOverlay", "dropSelOverlay(els, layers)", "The indicator's layers out of the host, and its crawl timer stopped.", ["-"], "§10")
add("svo.renderSelAnts", "renderSelAnts(els, data, W, H)",
    "The SVG path's selection indicator: marching ants on the objects' own edges in a retained space under one CSS transform, the dots, and ants along each screen side the selection carries on past, with its chevron.",
    ["Raw SVG in its own `<svg>`, not Two.js in the drawing's: measured 2026-09-03 in Kobin's Chrome, every frame of the crawl was 50 ms with the ants in the drawing's `<svg>` and 16.7 ms on their own layer. The step is a CSS transform on the layer, applied by the compositor with no repaint; the crawl freezes while the camera moves (a crawl repaint on a pinch frame added 17 ms) and resumes 150 ms after the last step.",
     "One path per run, its dash fitted to a whole number of cycles so no runt ant sits at the join; runs shorter than a cycle share paths in batches of 100 (one path holding every run was 183 ms a frame against 33 in 234 paths). The dots share one path and blink rather than crawl."],
    "§10")
add("svo.renderSelChevrons", "renderSelChevrons(els, edges, kt, W, H)",
    "The open terracotta chevrons that mark the sides a selection carries on past, in screen pixels in `bl-sel-edges` — both renderers draw them.", ["-"], "§10")
add("svo.antPath", "antPath · pathD · polyLen · poolTo",
    "One ant path (no fill, terracotta, butt caps, screen-pixel strokes under any transform); a polyline's path data; its length; a pool of elements grown or shrunk to n, keeping the survivors.", ["-"], "§10")
add("svo.fitDash", "fitDash(el, len, on, off)",
    "Fits a whole number of dash cycles onto a run, so a closed loop has no runt ant; a run shorter than one cycle carries the pattern at full size and lets it slide across, as a speck does.", ["-"], "§10")
add("svo.ensureSelStyle", "ensureSelStyle · selCss",
    "The indicator's keyframes, injected once per document and replaced when they change (a hot reload kept the old rules); the stylesheet itself.",
    ["The crawl is stepped, 16 steps a 0.8 s cycle: every step repaints every ant on screen, and measured on 2026-09-03 a continuous crawl held every frame at 33 ms while a stepped one put the median back at 16.7 ms. `prefers-reduced-motion` holds the ants still rather than hiding them."],
    "§10")
