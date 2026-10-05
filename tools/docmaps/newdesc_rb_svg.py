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
