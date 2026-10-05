# -*- coding: utf-8 -*-
"""Per-function entries for the pyramid's plate cache (raster/PyramidStore.js), its level
arithmetic (raster/level.js), the job queue (raster/jobQueue.js) and the prefetch
(raster/prefetch.js). Written 2026-10-05 for the rebuilt tree."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/PyramidStore.js":
        "The pyramid's plate cache (DESIGN.md §9): level, rest and plane records under `level.js`'s keys, each with "
        "the G its job was packed at. A result lands iff its G is newer (rule 1); a plate is exact iff its G is at "
        "least its cell's `dirtySince` (rule 2). LRU by bytes with the drawn set, the plane and the protected classes "
        "evicted last; the in-flight map; the hidden-tab release.",
    "src/engine/raster/level.js":
        "The pyramid's level arithmetic: a level ℓ is the integer zoom Z(ℓ) = 2^(ℓS), the view draws from the level "
        "whose stretch lies in its band, and a plate of one frame's level is a plate of another frame's by integer "
        "arithmetic on the cell digits, never a float affine. The keys of level, rest and plane plates.",
    "src/engine/raster/jobQueue.js":
        "The one queue in front of the worker pool (DESIGN.md §9): typed jobs by priority — rest and patches, the "
        "view, the plane, cuts, the prefetch, thumbnails — cut into strips dealt round-robin from the attention point; "
        "a strip whose purpose moved on or whose cells are exact is dropped; one worker kept for cuts; a pack budget "
        "per frame or per task.",
    "src/engine/raster/prefetch.js":
        "What the pyramid fetches before the view needs it, as priority-4 jobs: the near coarser levels from the live "
        "table, the far levels and a crossing's target through budgeted snapshots, the ring at rest — no more than the "
        "cache can hold beside what is pinned. Nothing while a report sends.",
}
