# -*- coding: utf-8 -*-
"""Per-function entries for the erase rule (eraseRule.js), the cede (cede.js), the Dev
levers (devLevers.js), the old model's inverses (legacy/modelV1.js) and the editor's new
components (DevStats.js, EraseChip.js, ScaleHud.js). Written 2026-10-05."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/eraseRule.js":
        "Which natives a pending eraser mark hides, as data on the objects (DESIGN.md §7): `targets` on a mark, "
        "`targetOf` and `handledBy` on every native, ascending id arrays the pack, the bake, the barriers, the pick and "
        "the Stage read. Pure: nothing here writes a document.",
    "src/engine/cede.js":
        "Cede a tile (DESIGN.md §7): the one body behind `Document.cedeTileById` and the descent's virtual document — "
        "the parent's hole cut exactly in its own coordinates, what was inside made kids at the level, the remnants "
        "and the kids one edit family.",
    "src/engine/devLevers.js":
        "The Dev panel's renderer levers: their ranges and per-device defaults, the one validator, and their "
        "persistence — per device in localStorage, a URL override winning, never the canvas record.",
    "src/engine/legacy/modelV1.js":
        "The inverses of the model before A1's C1 and C3, for the stores and undo stacks it wrote and nothing else "
        "(DESIGN.md §8, §13): replay puts an old store's settle tables and merges back, and the undo of an op that "
        "carries them takes them out.",
}
