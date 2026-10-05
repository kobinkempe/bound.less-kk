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
add("stg.Stage", "Stage",
    "The scene: the camera frame's items in paint order, the generation G every commit moves, and the freshness of every plate cell.",
    ["Kept from the document's and the tile cache's own events, so it is never behind the document. It owns no camera and no plates: the engine hands it the camera's frame and window (`sync`), and the plate store registers its cells (`track`).",
     "What it must keep, from its header: a handler never bakes a tile — a tile the table needs and the cache does not hold current is listed missing and read at the next `sync`; no read raises a document event, and the tile events `sync`'s reads raise are queued and applied at its end; dirt is a changed native's drawn footprint before and after, taken from the event itself and mapped into every frame with tracked cells, so a plate is exact iff its G ≥ its cell's `dirtySince`; membership and placement come from the `PlacementModel` and nothing else.",
     "A drag writes nothing until its drop (A1 C2): `hold` and `setDragDelta` draw, hit and lasso the held natives at their placement plus the pointer's delta (DESIGN.md §8–§9, A2-scene.md §2–§3)."],
    "§9")
add("stg.Stage.constructor", "Stage.constructor({doc, lm, store, model, cfg})",
    "Wires the scene to the document, the lattice, the tile cache and the placement model, and subscribes to the document's and the tile cache's events.",
    ["It subscribes after the tile store, so a document event reaches it with the cached tiles already patched."],
    "§9")
add("stg.destroy", "destroy()", "Unsubscribes from both event sources and drops the commit listeners.", ["-"], "§9")
add("stg.items", "items()",
    "The items in paint order, bottom-up: one array per table version, never mutated by a reader.",
    ["Both renderers draw it: the raster renderer packs the items into plates, the SVG renderer builds its Two.js groups from them, at the Stage's generation (DESIGN.md §9)."],
    "§9")
add("stg.itemsTopDown", "itemsTopDown() (generator)", "The items top-down, over the same array.", ["-"], "§9")
add("stg.itemsOf", "itemsOf(id)", "A native's items, in no order.", ["-"], "§9")
add("stg.placed", "placed(item)",
    "The one read of where an item is drawn: its geometry and the offset it is drawn at, a held item's with the drag's delta; an input at p reaches it at p − off.",
    ["The pick, the ants and the lasso read items through it (DESIGN.md §10: a tap takes the topmost object under the point, read where it is drawn). Inside `atRest` the drag's delta is ignored."],
    "§10")
add("stg.placeNative", "placeNative(nat, frameId)",
    "Any native as seen from any frame: a `Placement` with its drawn box there and inputs carried into its stored coordinates and back; a held native where the drag draws it.",
    ["A2 §2.6. The selection indicator takes a selected frame's box through each member's placement (DESIGN.md §10, F68)."],
    "§10")
add("stg.atRest", "atRest(fn)",
    "Runs `fn` with every native where it rests — the drag's delta ignored — so the ants decide on the picture the drag began from.", ["-"], "§10")
add("stg.Stage.covers", "Stage.covers(frameId, rect)",
    "Whether every tile under a rectangle of the camera frame, and under it in each reroute group's source frame, is read into the table.",
    ["A pack refuses a cell whose tiles the table does not cover and is asked again once covered (F119); the patch step skips such a cell (DESIGN.md §9)."],
    "§9")
add("stg.onCommit", "onCommit(fn)",
    "Subscribes to every commit: `fn(G, info)` with the frames whose tracked cells it dirtied, predicates over frame ids whose plates must go (the id now names another place), or a reset (another document).",
    ["-"], "§9")
add("stg.changesSince", "changesSince(G0)",
    "The item deltas since a generation — added, removed, and changed with each one's previous offset — or null when the log no longer reaches back, so the reader rebuilds.",
    ["-"], "§9")
add("stg.landedAt", "landedAt(id)", "The G at which a native's shape landed: a plate packed at or past it paints the shape.", ["-"], "§9")
add("stg.snapshot", "snapshot(frameId, rect, budgetMs)",
    "A read-only table of another frame or rectangle, built as a rebuild builds the live one and stamped with the G it was read at; null when a tile was not read inside the budget or a displaced picture's source frame is not minted yet.",
    ["The Scenes panel's pictures, the far prefetch levels and a crossing's target are read through it, off camera (DESIGN.md §9). The tiles it reads stay cached, so a read that ran out of budget goes further next time; a missing source frame is asked for (`store.want`) and minted by the engine at idle (A1 C3).",
     "`fresh()` is true while no commit since has a footprint meeting its rectangle; `placed` is the live Stage's."],
    "§9")
add("stg.track", "track(key, frameId, box, sinceG)",
    "A plate stored or a job begun for this cell: from now every commit whose footprint meets the cell moves its `dirtySince`.",
    ["A picture read at an older G (a snapshot read before a change, A2 §3.3) looks the commits since then up in the dirt log, so its plate is stale at once rather than taken for exact."],
    "§9")
add("stg.untrack", "untrack(key)", "The cell is neither stored nor in flight any more: forgotten.", ["-"], "§9")
add("stg.dirtySince", "dirtySince(key)",
    "The largest G of a commit since `track` whose footprint met the cell, 0 if none: a plate is exact iff its G is at least this (rule 2).", ["-"], "§9")
add("stg.dirtyRects", "dirtyRects(frameId, sinceG)",
    "The footprints of the commits after a G, in a frame's units — what a partial re-render clips to; null when the log no longer reaches back (re-render the whole cell).", ["-"], "§9")
add("stg._dirtIn", "_dirtIn(F, sinceG, box)",
    "The newest commit after a G whose footprint meets a box in frame F: its G, 0 if none, the current G when the log does not reach back.", ["-"], "§9")
add("stg.touch", "touch(id)",
    "A native changed what it draws with no document event (the idle fitter's outline): its footprint is dirt, committed at once outside a batch.", ["-"], "§9")
add("stg.hold", "hold({ids, frames})",
    "A drag begins: the selection's natives and everything under its frames are held — drawn, hit and lassoed at their placement plus the drag's delta — and the events about them are queued until `release`.",
    ["A1 C2: a drag writes nothing until its drop. The hold records where each held native and frame started, so the release can dirty where the selection started and where it ended (DESIGN.md §8–§9)."],
    "§8")
add("stg.holding", "holding (getter)", "Whether a drag's hold stands.", ["-"], "§8")
add("stg.setDragDelta", "setDragDelta(d, {frame, viewDraws})",
    "The drag's pointer delta from its start, in the camera frame's units: the held natives are drawn at their placement plus it. With a drag plane nothing commits; when the view's plates draw the hold, a change commits, dirtying the held boxes where they were drawn and where they are.",
    ["Per pointer event: no document event, re-home, table, mint or settle (DESIGN.md §8, `move.drop.test.js` D1)."],
    "§8")
add("stg.release", "release()",
    "The hold's end — a drop, a cancel or a delete: the queued events applied quietly, then one commit dirtying where the selection started, where it ends, and where the view drew it.",
    ["The held tile pieces are the drag's start and the tiles hold its end, so a held native's tile items are removed and its tiles re-read; every plate of a frame under a held frame is dropped (`info.drop`)."],
    "§8")
add("stg._deltaIn", "_deltaIn(F)",
    "The drag's delta in frame F's units, mapped through the lattice and memoised for the hold; null with no delta.", ["-"], "§8")
add("stg._underHeld", "_underHeld(home)",
    "Whether a frame is a held frame or under one, memoised for the hold: the lattice stands still until the drop.", ["-"], "§8")
add("stg._heldNat", "_heldNat(nat)", "Whether a native is held: selected by id, or homed under a held frame.", ["-"], "§8")
add("stg._heldItem", "_heldItem(it)", "Whether a table item is held (a snapshot's items never are).", ["-"], "§8")
add("stg._drawnOff", "_drawnOff(it)", "An item's offset as drawn: a held item's plus the drag's delta.", ["-"], "§8")
add("stg._paintOff", "_paintOff(it)",
    "The offset paint applies (`Item.res`) while the view's plates draw the hold: the drawn one, cached per delta so one delta gives one array.", ["-"], "§8")
add("stg._heldStates", "_heldStates(d)",
    "The held items' boxes in the camera frame at their offset plus a delta (none: at rest), as footprint states for a commit's dirt.", ["-"], "§8")
add("stg._held", "_held(ev)",
    "Whether the hold answers for a document event — a held native's, or one about a frame under a held frame — so it is queued until `release`.", ["-"], "§8")
add("stg.sync", "sync(frameId, window, budgetMs)",
    "Makes the table the camera frame's over a window: a crossing rebuilds it, a window change adds and drops tiles, and what an event dropped is read again — tiles are read until the budget is spent, the rest left missing.",
    ["The raster path's camera step (DESIGN.md §9). The tiles it watches become the tile store's camera pins. Tile events its own reads raise are queued and applied at its end; a sync that changed nothing commits nothing, so G moves only with the table."],
    "§9")
add("stg._owed", "_owed()",
    "Whether anything was applied or changed since the last commit: an event, a footprint, a landing, a drop or a reset.", ["-"], "§9")
add("stg.batch", "batch(fn)",
    "Runs `fn` as one commit however many events it raises: a drop, an undo, a delete, a load.",
    ["DESIGN.md §9: one integer G moves once a commit — an event outside a batch, or a whole batch."],
    "§9")
add("stg.forgetFrame", "forgetFrame(id)",
    "Frame GC forgot a frame: its tracked cells go (its tiles went with their events) and the reroute groups are re-diffed at the next commit.", ["-"], "§8")
add("stg._onDoc", "_onDoc(ev)",
    "A document event: queued while the hold answers for it or a sync is running, else applied and, outside a batch, committed.", ["-"], "§9")
add("stg._stepOf", "_stepOf(ev)",
    "An erase step's class, taken as its event arrives: a cut or a descent on an object of the mark's lineage dirties the object's box inside the mark's box and its dust whole, a refusal over ink the same, a graze or an inkless refusal nothing; null for an ordinary event.",
    ["The event names the mark whose bake it is (`by`), and the erase rule says whether that mark hid the object (`inLineage`). So plates the mark never reaches keep (DESIGN.md §9, PLAN §5.3 A2-Q2)."],
    "§7")
add("stg._onTile", "_onTile(ev)", "A tile cache event: queued during a sync, else applied.", ["-"], "§9")
add("stg._drainQueue", "_drainQueue()", "Applies what a sync queued, in arrival order.", ["-"], "§9")
add("stg._applyDoc", "_applyDoc(ev, step)",
    "Applies one document event to the table: its footprint as dirt (not on the hold's quiet release), a stroke's pending start and its shape's landing, a frame event's re-diff, and the native marked touched for the commit.",
    ["A refile of a frame the camera's frame is under rebuilds the table at the next sync; a frame added or removed at the camera's cell or under it re-diffs the frame's own natives; any refile stales the tile keys under it (`_staleUnder`)."],
    "§9")
add("stg._applyTile", "_applyTile(ev)",
    "Applies one tile cache event to the table: a bake installs a watched tile, a drop or a clear marks it missing, a patch appends or removes pieces — a held native's skipped, since the hold answers for them.", ["-"], "§9")
add("stg._stateOf", "_stateOf(o, home, rect)",
    "A native's footprint state: its home, its picture table and its drawn box in its home's units.", ["-"], "§9")
add("stg._frameState", "_frameState(f, addr, under)",
    "A frame's reach at an address (its own by default), optionally with everything under a frame, as a footprint state.", ["-"], "§9")
add("stg._before", "_before · _after",
    "Record a native's footprint before an event (the first one in a batch) and after it (the last one).", ["-"], "§9")
add("stg._footOf", "_footOf(ev, step)",
    "One event's footprint states, before and after: a native's old and new drawn box with its table, a refile's address either side, an added or removed frame's reach, an erase step's as `_stepOf` classed it.",
    ["The old box, width and table ride the event itself (`oldBbox`, `oldLw`, `tableBefore`), so the dirt needs no second read (DESIGN.md §9). A refile also drops every plate of a frame under the moved one (`info.drop`); a deleted frame's address rides its event (`at`, F138 seed 51). A stroke still pending its shape adds nothing: the band is never packed."],
    "§9")
add("stg._grouped", "_grouped(states)",
    "Past 256 states, one union state per (home, table): natives moved together map as one box.", ["-"], "§9")
add("stg._rectsIn", "_rectsIn(states, G)",
    "A commit's footprint states in frame G's units; past 256 rectangles, their one union box.", ["-"], "§9")
add("stg._mapState", "_mapState(s, G)",
    "One footprint state in frame G's units: a frame's reach (everywhere when G is under the state's subtree), or a native's box clipped to its erase step's mark.", ["-"], "§9")
add("stg._commit", "_commit()",
    "The end of one commit: the touched natives placed again, the family rule applied, the footprints made dirt, G moved, the shapes that landed stamped with it, and the listeners called.",
    ["The renderer's listener marks its patch step due, so no compose draws a plate the commit staled with no patch asked (DESIGN.md §9, PLAN §5.15)."],
    "§9")
add("stg._settle", "_settle()",
    "Places the touched natives' items again and, after a frame event or a lattice change, re-diffs the reroute groups (no table is written: the Stage's word for re-placing items).", ["-"], "§9")
add("stg._dirt", "_dirt(G, states, frames)",
    "Moves `dirtySince` on every tracked cell a commit's footprints meet, and logs the footprints for `dirtyRects` and late snapshots.", ["-"], "§9")
add("stg._families", "_families()",
    "The family rule (PLAN §5.1 Q15): a family whose change flipped its union routing, sign, colour or alpha repaints every item, so its whole box is dirt; an erase step under its mark is exempt.",
    ["Its comment records the cost of not doing it: the untouched pieces of a flipped family differed by 462 px median, 771 max, up to 38/255. A stroke family counts as flipped whenever its items change."],
    "§9")
add("stg._traitsOf", "_traitsOf(items)",
    "A family's traits as the pack decides them, over its items in paint order; null for a stroke family.", ["-"], "§9")
add("stg._itemBox", "_itemBox(it)", "An item's drawn box at its offset, in the camera frame's units.", ["-"], "§9")
add("stg._famTouch", "_famTouch(fk)",
    "The first time a commit touches a family: its traits and box as they were, for the family rule (a family of one keeps its item instead).", ["-"], "§9")
add("stg._reset", "_reset()",
    "Another document: the table is rebuilt at the next sync, and the pending strokes, the landings, the hold and the change log are forgotten.", ["-"], "§9")
add("stg._clearTable", "_clearTable()",
    "Empties every index of the table — items, tile keys, reroute groups, families — and marks the items no longer live.", ["-"], "§9")
add("stg._rebuild", "_rebuild(F, window, budgetMs)",
    "The table for frame F from scratch: the reroute groups from the placement model, the window's tiles watched and read within the budget, the frame's live natives as its own items, sorted once.",
    ["A crossing or a reset rebuilds. The change log is cut, so a `changesSince` reader rebuilds too, and the families' traits are recorded as the plates packed from here will see them."],
    "§9")
add("stg._setWindow", "_setWindow(window)",
    "A window change: tiles that left are retired, tiles that entered are read (A2 §2.12).", ["-"], "§9")
add("stg._watchGroup", "_watchGroup(g)",
    "A reroute group's tiles: the window shifted back by its remainder, in its source frame; keys it no longer needs are let go.", ["-"], "§9")
add("stg._readMissing", "_readMissing(budgetMs)",
    "Reads every watched tile listed missing from the tile store, within the budget; what is not read stays missing.", ["-"], "§9")
add("stg._latKey", "_latKey()",
    "The lattice's address epoch and frame count as one key: a change means the reroute is re-diffed.", ["-"], "§9")
add("stg._rerouteDiff", "_rerouteDiff()",
    "The reroute re-diffed (A2 §2.10): every native whose group changed since the last diff placed again, groups made and let go.",
    ["A reroute group is the moved natives whose pictures are read from one source frame at one remainder (the placement model's `displaced`, `TileStore._rerouteGroups`' memo): their tiles are read in that frame over the window shifted back by the remainder, and their items painted at it."],
    "§9")
add("stg._reconcile", "_reconcile(id, d, refresh)",
    "One native placed again against the document as it is: its own item (drawn live in the camera's frame or not), its reroute group, and its offset, paint key and family on every item; the tiles whose items must follow are re-read. A held native is skipped.",
    ["-"], "§9")
add("stg._dropGroup", "_dropGroup(g)", "Lets a reroute group go: its items removed, its tiles retired.", ["-"], "§9")
add("stg._staleUnder", "_staleUnder(X)",
    "Frames under a re-addressed frame: their watched tiles are stale (by `chainSeq`) and read again.", ["-"], "§9")
add("stg._ownDiff", "_ownDiff()",
    "The camera cell's own natives checked again against the document's list for the whole cell (a frame set aside or put back).", ["-"], "§9")
add("stg._tileKeys", "_tileKeys(F, rect)", "The up and down tile keys of frame F under a rectangle.", ["-"], "§9")
add("stg._parseKey", "_parseKey(key)", "A tile key back into its frame, direction and cell.", ["-"], "§9")
add("stg._watch", "_watch(key)",
    "Starts watching a tile key (once): the tile store's camera pins follow the watched set.", ["-"], "§9")
add("stg._retire", "_retire(ks)",
    "A key no role needs any more — not in the window, in no reroute group: its items go and it is no longer watched.", ["-"], "§9")
add("stg._install", "_install(ks, tile)",
    "A tile read or re-baked: the key's items become the tile's pieces in its order; a held native's items stay as they were.", ["-"], "§9")
add("stg._refreshKey", "_refreshKey(key)",
    "A key's items checked against its tile's pieces and the roles they have now; only differences move.", ["-"], "§9")
add("stg._roleOf", "_roleOf(ks, p)",
    "The role a piece of this key is drawn in: a window piece (null), a reroute group's key, or not drawn (undefined).", ["-"], "§9")
add("stg._place", "_place(ks, p, seq)",
    "One piece of a watched tile into the table, if a role draws it: its native, its offset (the group's remainder or its placement's), its paint key.", ["-"], "§9")
add("stg._dropKeyItems", "_dropKeyItems(key)", "Removes every item a tile key put in the table.", ["-"], "§9")
add("stg._itemFor", "_itemFor(piece)",
    "The item for a piece: the one it last was when that is not live, so the pack's per-item memo hits; else a new one.", ["-"], "§9")
add("stg._setOwn", "_setOwn(nat)", "A native the camera's frame draws live, into the table as its own item.", ["-"], "§9")
add("stg._offOf", "_offOf(nat)",
    "A native's paint offset in the camera's frame — its placement's remainder — as one array while it does not change.", ["-"], "§9")
add("stg._setOff", "_setOff(it, off)",
    "Gives an item a new offset, logging the change and touching its family for the family rule.", ["-"], "§9")
add("stg._file", "_file · _unfile", "File an item under its family key, and take it out.", ["-"], "§9")
add("stg._addItem", "_addItem(it)",
    "Puts an item in every index — family, piece, native, tile key, home — and in the paint-order list (or the rebuild's batch), logged as added.", ["-"], "§9")
add("stg._removeItem", "_removeItem(it)", "Takes an item out of every index and the list, logged as removed.", ["-"], "§9")
add("stg._cur", "_cur · _logAdd · _logRemove · _logChange",
    "The change log of the commit in progress: items added, removed, and changed with their previous offset (a rebuild logs nothing).", ["-"], "§9")
add("stg._closeLog", "_closeLog()",
    "Closes the commit's change log at its G and cuts the oldest entries past 4,096 deltas, raising the floor `changesSince` can reach.", ["-"], "§9")
add("stg.Placement", "Placement",
    "`placeNative`'s answer: one native seen from one frame, with the drag's delta when the native is held.", ["-"], "§10")
add("stg.Placement.constructor", "Placement.constructor(stage, nat, F, d)", "Holds the native, the frame and the delta.", ["-"], "§10")
add("stg.Placement.box", "Placement.box()",
    "The native's drawn box (its bbox, and half its pen for a stroke) in the frame's units, where its picture is.", ["-"], "§10")
add("stg.toStored", "toStored · fromStored",
    "An input made in the frame — a point, a rect or loops — into the native's stored coordinates, and back: the placement inverted on every input (DESIGN.md §8).", ["-"], "§8")
add("stg.shiftBy", "shiftBy(x, d, k)", "A point, a rect or loops translated by k·d; unchanged without d.", ["-"], "§10")
add("stg.zkOf", "zkOf · sameRect", "An item's paint key (z, else its id); two rectangles equal.", ["-"], "§9")


# ---- src/engine/placementModel.js ----
add("plm.withShifted", "withShifted(b, sx, sy)",
    "A box united with its copy moved by a shift: where a shifted frame's own natives can be drawn (its kids are not shifted).",
    ["A1 C1: a frame's shift is its natives' placement, composed on read and written nowhere (DESIGN.md §8)."],
    "§8")
add("plm.reachBox", "reachBox(f, s, tx, ty, pad)",
    "A frame's reach box in the active frame's units: its cell grown by REACH (invariant 2), united with its shifted copy.", ["-"], "§8")
add("plm.drawnBox", "drawnBox(o, live)",
    "A native's drawn box in its home's units: its bbox, grown by half its pen for a stroke.", ["-"], "§9")
add("plm.createPlacementModel", "createPlacementModel({doc, lm, store})",
    "The placement model the Stage reads (A1 §6): which natives a frame draws live and where any native's picture is seen from any frame — one composition, and no read that writes.",
    ["`nativesIn(F)`: the natives drawn live in F — those of F's whole cell, co-residents included, less those whose picture its shift carries out, plus those carried in from other frames (DESIGN.md §9).",
     "`placement(o, F)`: where a native's picture is seen from F — the frame `F0` whose unmoved tiles hold the pieces drawn there and the remainder `rem` they are painted with and every input is shifted back by; `rerouted` when the pieces come from another frame's tiles.",
     "`displaced(F)`: the groups of natives drawn away from their stored bits, keyed by the (F0, rem) they share — `TileStore._rerouteGroups`' memo — with `missing`, how many pictures' source frames the lattice lacks: a read mints none, `TileStore.prepare` does at the end of the action (A1 C3).",
     "The rest: `homeOf`, `drawnLive`, `table`/`tableBefore` (a native's picture table, its own plus its home frame's shift at k = 0, `Document.tableOf`), `frameFootprint` (everything under a frame: its cell ± REACH united with that box moved by its shift), `toStored`/`fromStored` (inputs carried through the placement and back) and `footprint` (a drawn rectangle at a state, as seen from another frame — what a change dirties)."],
    "§8")


# ---- src/engine/frameGc.js ----
add("fgc.initFrameGc", "initFrameGc(E)",
    "The engine's frame-GC state, made once: the candidate set (the lattice's `minted` set too, so every frame minted becomes a candidate), the camera's trail, and the document's hook that makes the frames dropped ops named candidates.",
    ["-"], "§8")
add("fgc.namedBy", "namedBy(E, ops)", "Every frame a list of ops names (`Document.opFrames`).", ["-"], "§8")
add("fgc.noteFrameEvent", "noteFrameEvent(E, ev)",
    "A document event: the frame it may have emptied becomes a candidate — a removed native's home, a refiled frame and its old parent, a removed frame; a reset clears the camera's trail.",
    ["-"], "§8")
add("fgc.noteCameraFrame", "noteCameraFrame(E)",
    "The camera's frame, once a render: a change puts the frame it left on the trail of the last four, and what falls off becomes a candidate; true when it changed (a GC trigger).",
    ["The trail is kept because a crossing back composes through the frame left (DESIGN.md §8). The first frame after a load is not a change."],
    "§8")
add("fgc.collectFrames", "collectFrames(E, inRender)",
    "Forgets every candidate that holds nothing and that nothing keeps — the camera's frame and its ancestors, the trail, a frame an undo or redo op names — and then each parent it empties; its tiles, plates and tracked cells go too, and a selected frame that went leaves the selection.",
    ["Never mid-gesture (a drag, a stroke, a lasso, or a descent holding a lattice copy): the next trigger collects. A forgotten frame held nothing, so the store no longer lists it (F98); its tiles go because its id can be minted again and its old tiles would be served (F111). `inRender`: called ahead of a render, which repaints the selection itself."],
    "§8")
add("fgc.sweepFrames", "sweepFrames(E)",
    "Every frame made a candidate and collected: the host's sweep once a restored store is in (a load adds no candidates).", ["-"], "§8")
