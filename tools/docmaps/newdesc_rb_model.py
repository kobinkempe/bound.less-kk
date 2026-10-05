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


# ---- src/engine/eraseRule.js ----
add("eru.zOf", "zOf(o)", "Paint order's key: creation order, inherited by every piece a cut mints.", ["-"], "§7")
add("eru.has", "has · withId · withoutId",
    "Ascending id arrays: does one hold an id (binary search); with an id added (a new array, or the same one when it is there); without it.", ["-"], "§7")
add("eru.underMask", "underMask(o, M)",
    "Is a native under a mark's mask: the mark's shape has landed, the native is below it in paint order, names it in `targetOf`, and the mark has not handled it yet.",
    ["The rule the pack, the pick, the bake and the barriers read: a pending mark hides exactly its targets and the pieces cut from them, until its bake deals with each (DESIGN.md §7)."],
    "§7")
add("eru.inLineage", "inLineage(o, M)",
    "Is a native in a mark's lineage below it — a target or a piece of one, masked or already handled? An erase step by the mark on such an object changes pixels only where its mask was (A2 §4.5).", ["-"], "§7")
add("eru.inheritErase", "inheritErase(obj, src, by)",
    "A piece minted from a source by a mark's bake takes the source's lineage, with the mark added to what has handled it (A2 §4.3); outside a bake both are copied as they are.", ["-"], "§7")

# ---- src/engine/cede.js ----
add("cde.cede", "cede(doc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts, dustBar, by)",
    "Cedes a tile: the parent's hole cut exactly in its own coordinates, what was inside made kids at the level, and the remnants and kids one edit family sharing one tile grid — the one body behind `Document.cedeTileById` and the descent's virtual document.",
    ["A round trip through a local origin moved every vertex an ulp (F42), so the cut is in the parent's own coordinates. The remnants keep the parent's own table; a kid's table is the caller's — the parent's picture table from the level down less the kid frame's shift (F41, F55, A1 C1). Every piece inherits the source's `targetOf` and `handledBy` plus the mark whose bake this is; a remnant's dust goes whole, and its boxes ride the parent's removal (A2 §4.5)."],
    "§7")

# ---- src/engine/devLevers.js ----
add("dvl.leverDefaults", "leverDefaults(phone)",
    "The levers' defaults on a desktop or a phone: the level step 1, `plateViews` 3 or 2, the plate ceiling 256 or 96 MiB, the rest quiet 100 ms, the inline rest and the compose path automatic.", ["-"], "§9")
add("dvl.cleanLevers", "cleanLevers(o)",
    "The valid levers in an object, parsed — a URL's strings become numbers where the lever is numeric; anything out of range or unknown is dropped.", ["-"], "§9")
add("dvl.leversFromUrl", "leversFromUrl(href)",
    "The levers a URL names, wherever its query lives (a hash route keeps it in the hash); a value that does not decode is dropped, since a throw here is a blank page.", ["-"], "§9")
add("dvl.storedLevers", "storedLevers · readLevers · saveLevers",
    "This device's stored levers (none when storage refuses, as in a private window); the session's overrides — stored, then the URL's, which win; a patch stored over this device's. The canvas record is never touched.", ["-"], "§9")

# ---- src/engine/legacy/modelV1.js ----
add("lv1.applySettle", "applySettle(doc, frameId, rec)",
    "A replayed `settle` entry from a store written before C1: the tables and homes it recorded, set as they are (idempotent).",
    ["The module is to be deleted on or after 2026-12-31: by then no live store or undo stack holds a settle (its header: the undo window is 200 ops and compaction drops older entries)."],
    "§13")
add("lv1.unsettle", "unsettle(doc, frameId, settled)",
    "The undo of a move op that carries a `settled` record: the recorded settle taken back out of its natives' tables, a carried native brought home by id.", ["-"], "§8")
add("lv1.mergeLive", "mergeLive(rec)",
    "A `merged` record read from a store, copied so the op and the entry never share it, its tables decoded.", ["-"], "§13")
add("lv1.setTables", "setTables(doc, tables, which)", "Sets each recorded native's table to the before or the after side.", ["-"], "§13")
add("lv1.mergeReplay", "mergeReplay · unmergeReplay",
    "Replay a `mergeFrame` entry from before C3 — the frame's natives into its resident's list, their tables as recorded — and its undo (idempotent).", ["-"], "§13")
add("lv1.unmerge", "unmerge(doc, rec)",
    "The live undo of a recorded merge: the frame back at its cell as a co-resident of its resident (A1 C3), its kids and natives back in it.", ["-"], "§8")


# ---- src/Components/editor/DevStats.js, EraseChip.js, ScaleHud.js ----
add("dvs.readStats", "readStats(E)",
    "One reading of the renderer's own counters, the fields its report carries: the pyramid's level and σ, paper/blur/older, the rest executor, the plates and their bytes, the queue's jobs, the long frames; null without an engine.", ["-"], "§14")
add("dvs.f1", "f1(v)", "A number to one decimal, or a dash.", ["-"], "§14")
add("dvs.DevStats", "DevStats({engineRef, intervalMs})",
    "The Dev panel's renderer counters on a timer of their own (500 ms), so a zoom or an arrival never re-renders the editor for them.",
    ["Older is shown split by cause — waiting for a worker job, waiting for the table's read of a cell's tiles, and any other, which must stay 0 (DESIGN.md §9)."],
    "§14")
add("erc.EraseChip", "EraseChip({erase, compact})",
    "\"Finishing the erase…\" beside the title's save state while a tap, a drag or a lasso waits on its erase barrier — shown once the wait has lasted 150 ms, gone when it ends (A2 §4.11).", ["-"], "§7")
add("shd.ScaleHud", "ScaleHud({engineRef, engineReady, scaleDef, readOnly, onClear, onSetScale, onLadderId})",
    "The scale controls bottom right — Clear, Set scale, the bar and its label — and the unit picker the label opens; it follows the zoom through `engine.onZoom`, so a zoom re-renders this leaf alone, not the editor.",
    ["It owns the scale bar's display session (the sticky ladder, the user's preferred range, the incumbent unit) and `computeScale`'s write-back; a new scale definition starts a fresh session from its anchor unit (DESIGN.md §12; A3 §5, R25 W1)."],
    "§12")
