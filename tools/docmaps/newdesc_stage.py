# -*- coding: utf-8 -*-
"""Per-function entries for the scene (Stage.js), the placement model the Stage reads
(placementModel.js) and frame GC (frameGc.js). Written 2026-10-05 for the rebuilt tree."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/Stage.js":
        "The scene both renderers draw (DESIGN.md §9): the camera frame's items in paint order, kept from the "
        "document's and the tile cache's own events so it is never behind the document; the generation G every "
        "commit moves; and the freshness of every plate cell the store holds or has in flight (`dirtySince`). A drag "
        "writes nothing: its held natives are drawn, hit and lassoed at their placement plus the pointer's delta.",
    "src/engine/placementModel.js":
        "The document model as the Stage reads it (A1 §6): which natives a frame draws live, where a native's picture "
        "is seen from a frame, which natives are drawn away from their stored bits, and a frame's footprint. One "
        "composition — a native's own table plus its home frame's shift — and no read settles, mints or changes a table.",
    "src/engine/frameGc.js":
        "A frame holds something (F94, DESIGN.md §8): a frame with no natives and no kids is forgotten at a gesture's "
        "end or a change of the camera's frame, unless the camera is in it, above it or left it lately, or an undo or "
        "redo op names it; a co-resident of a forgotten resident takes its cell.",
}
