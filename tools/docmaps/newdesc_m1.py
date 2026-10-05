# -*- coding: utf-8 -*-
"""Per-function entries for the oracles added by the rebuild: the brute-force render list
(__oracles__/renderList.js) and the frozen pre-C1 model (__oracles__/model-v1/, A1 §14).
One-liners; a model-v1 function whose body is the same file's same function at 56e36b3
carries that entry as it was. Written 2026-10-05."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


_FROZEN = ("Frozen with the rest of the pre-C1 model at 5e9b1dd (A1 §14), which the model fuzzes and "
           "probes compare the live model against; not on any route.")
_WHAT = {
    "KobinEngine": "The engine facade as it was before C1.",
    "erasePipeline": "The erase pipeline as it was before C1.",
    "overlays": "The selection indicator and the debug overlays as they were before C1.",
    "selection": "Selection and moving as they were before C1: a drag re-addressed its frames every event, against the lattice the previous event had left.",
    "sceneOps": "The scene operations as they were before C1.",
    "files": "Undo, redo, delete and the files as they were before C1.",
    "eraseDescent": "The erase descent as it was before C1.",
    "eraseWorkerClient": "The erase worker client as it was before C1.",
    "cede": "The cede as it was before C1.",
    "LevelMap": "The lattice as it was before C1: a frame's shift a debt settled into its natives at the first read.",
    "frameGc": "Frame GC as it was before C1.",
    "TileStore": "The tile cache as it was before C1.",
    "Renderer": "The SVG renderer as it was before C1.",
    "Stage": "The scene as it was before C1.",
    "placementModel": "The placement model as it was before C1.",
    "Document": "The document as it was before C1.",
    "persist": "The file format as it was before C1.",
    "format2": "The store's frame encoding as it was before C1.",
    "oplog": "The op log and its replay as they were before C1.",
    "offsets": "The displacement tables as they were before C1.",
    "sceneClient": "The scene index's client as it was before C1.",
    "rasterShim": "Stand-ins for the raster modules the frozen engine imported, which the rebuild deleted.",
}
ROLE = {"src/engine/__oracles__/model-v1/%s.js" % f: w + " " + _FROZEN for f, w in _WHAT.items()}
ROLE["src/engine/__oracles__/renderList.js"] = (
    "The render list by brute force over a rect — every tile read from the store, the moved natives read back where "
    "their picture is, the frame's live natives, stamped and sorted: the list the SVG path drew until B-PYRAMID-3. "
    "The Stage's table and the plates are checked against it.")
