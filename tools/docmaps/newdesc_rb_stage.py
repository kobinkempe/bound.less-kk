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


# ---- src/engine/Stage.js ----
add("stg.Item", "Item",
    "One drawn piece of the scene: a tile piece or a native of the camera's frame, with its paint-order key and the offset paint applies.",
    ["z, the family key and the erase fields are read from the live native, the geometry from the piece, so a z change or a mark landing needs no re-read of a tile (R25 H8).",
     "Its getters give the fields a render-list item had, so the packs, the pick and the SVG renderer read an item as they read a piece; nothing is written onto a piece or a native."],
    "§9")
add("stg.Item.constructor", "Item.constructor(stage, piece)",
    "An item for one piece: no native yet, filed under `own`, no offset, not in the table.", ["-"], "§9")
add("stg.type", "type · z · editId · erase · targets · targetOf · handledBy (getters)",
    "The piece's type; z, the family key and the erase fields read from the live native when the item has one.",
    ["The native is the truth and a tile piece a copy, so an undo of a z change or a mark's `targets` landing is seen by every item at once."],
    "§9")
add("stg.fam", "fam (getter)",
    "The family the item paints with: its edit key, else its own id (a keyless native is a family of one).", ["-"], "§9")
add("stg.res", "res (getter)",
    "The translation paint applies: the item's placement remainder, or while a drag holds natives the held offset (`_paintOff`); undefined at zero.",
    ["A pack reads `res` as it read the old list's residual. While the Stage holds a drag, a held native's items are painted at the pointer's delta by the view's plates only when no plane draws them (DESIGN.md §8, `Item.res`)."],
    "§8")
add("stg.clip", "clip · loops · polys · pts · lwFrame · color · opacity · Item.covers · fadeTag · origin · w · tile · attachRect · _home · _ver · _outline · _pen (getters)",
    "The piece's geometry and style, read straight through.", ["-"], "§9")
add("stg.Item._bbox", "Item._bbox (getter, setter)",
    "`bboxOf`'s memo, kept on the piece — never written onto the stroke still being drawn.", ["-"], "§9")
add("stg.pending", "pending (getter)",
    "True from pen-down until the stroke's shape lands: every pack skips it and the pick still sees it.",
    ["PLAN §1.5: a stroke whose perimeter has not resolved is drawn by its live path alone; the resolve's commit stales the plates under it."],
    "§9")
add("stg.Item.box", "Item.box (getter)",
    "The item's drawn box in the camera frame's units, without the paint offset (`placementModel.drawnBox`).", ["-"], "§9")
add("stg.cmp", "cmp(a, b)",
    "The scene's paint order: `(z ?? id, id)` as the oracle's `renderList` sorts, then the order one native's pieces were concatenated in.",
    ["Ties fall through the piece's tile position and sequence to the item's own uid, so the order is total and a remove finds exactly its item."],
    "§9")
add("stg.ChunkList", "ChunkList",
    "The scene's sorted item list, in chunks of at most 512: a binary search over the chunks' last items, then within one.",
    ["Measured for A2 §2.2: replacing one item by three at 45,000 items costs 24–26 µs. Every change bumps `ver`, which `toArray` and the packs key on."],
    "§9")
add("stg.ChunkList.constructor", "ChunkList.constructor()", "An empty list at version 0.", ["-"], "§9")
add("stg.clear", "clear()", "Empties the list and bumps its version.", ["-"], "§9")
add("stg.fill", "fill(items)", "Replaces the contents with these items, sorted here, in half-full chunks.", ["-"], "§9")
add("stg._chunkFor", "_chunkFor(it)", "The chunk an item belongs in: binary search over the chunks' last items.", ["-"], "§9")
add("stg.insert", "insert(it)", "Inserts an item at its paint-order place, splitting a chunk that passes 512.", ["-"], "§9")
add("stg.remove", "remove(it)",
    "Removes this very item from its paint-order place; false when it is not there (a different item with the same key is never taken).", ["-"], "§9")
add("stg.toArray", "toArray()", "The items in paint order as one array, rebuilt once per version.", ["-"], "§9")
add("stg.sameOff", "sameOff · shifted · meets · unionOf",
    "Offset and rectangle helpers: two offsets equal; a rectangle moved back by an offset; do two rectangles meet (touching counts — invalidation is conservative); the union of two.",
    ["-"], "§9")
add("stg.sameTraits", "sameTraits(a, b)",
    "Do two families paint alike: the same union flag, sign, colour and alpha (`rasterPack.familyTraits`).",
    ["A family whose traits change between commits changes how its members composite, so the Stage dirties its whole box (`_famTouch`)."],
    "§9")
add("stg.tableKey", "tableKey(b)", "A displacement table as a string, to compare two tables by value.", ["-"], "§8")
