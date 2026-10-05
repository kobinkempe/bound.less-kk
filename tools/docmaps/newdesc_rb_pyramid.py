# -*- coding: utf-8 -*-
"""Per-function entries for the picture pyramid's compose (raster/PicturePyramid.js).
Written 2026-10-05 for the rebuilt tree."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/PicturePyramid.js":
        "The ink canvas composed from the picture pyramid (DESIGN.md §9, A3): each camera step publishes one view, "
        "plans every screen cell from one freshness-first rule list, and draws the plan directly or through one "
        "surface; it runs the rest render and the partial re-renders, holds a pen-up's results for one group commit, "
        "and keeps the paper, blur and older integrals. It posts nothing: requests leave through `onRequest`.",
}
