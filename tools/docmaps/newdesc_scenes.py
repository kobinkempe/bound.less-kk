# -*- coding: utf-8 -*-
"""Per-function entries for the scene index: sceneIndex.js, sceneClient.js, sceneWorkerClient.js,
the scene oracle, and the scene calls of sceneOps.js."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/sceneIndex.js ----
add("six.cellIx", "cellIx(v)",
    "A coordinate's grid cell index, floored and clamped to ±2^25 so a cell key fits one number.",
    ["A cell key is `(i + OFF)·KEYM + (j + OFF)` with OFF = 2^25 and KEYM = 2^26, under 2^52; a chunk further out lands in the edge cell instead of overflowing the key."],
    "§14")
add("six.fitsSpread", "fitsSpread(lo, hi)",
    "Does a range of absolute log widths fit one scene: within ZOOM_SPREAD (4 octaves), with a 1e-9 tolerance.",
    ["-"], "§14")
add("six.frameLog", "frameLog(f, depth)",
    "A frame's absolute log size: log2 of its longer side, less 12 per depth, so sizes compare across frames.",
    ["-"], "§14")
add("six.now", "now()",
    "A millisecond clock for a batch's timing: `performance.now()` where there is one, else `Date.now()`.",
    ["-"])
add("six.FrameTable", "FrameTable",
    "The scene index's own copy of the frame tree: frame records, and the similarity that maps any frame's coordinates into any other's.",
    ["Records are `{id, parent, depth, cx, cy, sx, sy}`: the cell centre in the parent and the frame's pending shift. `update` keeps the pre-batch record of every frame it changes, so a batch can measure a move in the tree as it was (`map(..., old)`) until `settle`.",
     "Mappings are cached; a batch with frame records clears the cache."],
    "§14")
add("six.FrameTable.constructor", "FrameTable.constructor()",
    "An empty table: no current records, no pre-batch records, two empty mapping caches.",
    ["-"], "§14")
add("six.get", "get(id)", "A frame's current record.", ["-"], "§14")
add("six.depth", "depth(id)", "A frame's depth, or null for a frame the table does not hold.", ["-"], "§14")
add("six.update", "update(recs)",
    "Take a batch's frame records; returns the frames whose parent, depth or cell changed (moved subtrees), those whose shift alone changed, and those that went.",
    ["A `gone` record deletes the frame and lists it in `gone`. A record equal to the current one is ignored; a shift-only change goes in `shifted`; anything else replaces the record and, for a frame that existed, goes in `moved`.",
     "Every replaced record is kept in `prev` for `map(..., old)` until `settle`, and the mapping caches are cleared."],
    "§14")
add("six.settle", "settle()",
    "Forget the pre-batch frame records once the batch has measured its moves.",
    ["-"], "§14")
add("six._rec", "_rec(id, old)",
    "A frame's record: the pre-batch one when `old` is asked and the frame changed this batch, else the current.",
    ["-"], "§14")
add("six.parentOf", "parentOf(id, old)",
    "A frame's parent id, now or (`old`) before this batch.",
    ["-"], "§14")
add("six.under", "under(id, roots)",
    "Is the frame one of `roots`, or beneath one in the current tree?",
    ["Walks parents, at most 4,096 steps. How a batch finds the items and scenes a moved subtree carries."],
    "§14")
add("six._up", "_up(id, depth, old)",
    "Walk a frame up to its ancestor at `depth`, accumulating the scale and offset that map its coordinates into the ancestor's.",
    ["Returns `{f, s, ox, oy}` with `p_ancestor = p·s + (ox, oy)`: each step divides by R and adds the cell centre. Null when the chain ends first."],
    "§14")
add("six._across", "_across(a, b, old)",
    "The offset between two frames at one depth, summed from their common ancestor down (Horner), so frames near each other keep every partial sum small however deep that ancestor.",
    ["Walks both chains up in step until they meet (null with no common root or past 4,096 steps), then accumulates `(off + a.cx − b.cx)·R` from the top down: `p_b = p_a + off`."],
    "§14")
add("six.map", "map(from, to, old)",
    "The similarity `p_to = p_from·s + o` between any two frames (null when they share no root), cached; `old` maps through the tree before this batch.",
    ["Both frames go up to the shallower depth (`_up`), then across at that depth (`_across`); the target's scale is divided out. The pre-batch mapping has its own cache, cleared by `settle`."],
    "§14")
add("six.encodeIds", "encodeIds(ids)",
    "Sorted ids as a saved member string: base-36 gaps, a run of consecutive ids written `gap.extra`.",
    ["The `m` (objects) and `e` (erase footprints) strings of `meta.sceneIndex`: `5.2` is 5, 6, 7."],
    "§14")
add("six.decodeIds", "decodeIds(str, max)",
    "Read a saved member string back into ids; a malformed token, or one that would take the total past `max` (MAX_IDS, 10^7), ends the decode, keeping what was read.",
    ["The bound is on the whole string, not on one run, so a damaged string loses only the tail of one scene's members."],
    "§14")
add("six.rectCover", "rectCover(t, r)",
    "The share of rect `t`'s area that rect `r` covers (0 for an empty `t`).",
    ["The one overlap measure behind MATCH_OVERLAP: names kept aside, legacy scenes and parts."],
    "§14")
add("six.grow", "grow(bb, loc, n)",
    "Widen a bounding box `[x0, y0, x1, y1]` by the first n chunk boxes of a filed position array.",
    ["-"])
add("six.EMPTY_BB", "EMPTY_BB()", "A fresh empty bounding box, `[∞, ∞, −∞, −∞]`.", ["-"])
add("six.fnv", "fnv(str)",
    "FNV-1a hash of a string, in base 36: the picture key of a region and of a row of several scenes.",
    ["-"], "§14")
add("six.newTag", "newTag()",
    "A random tag (up to six base-36 digits) for this session's picture keys, so a version number reached again after an unsaved session never repeats a key.",
    ["-"], "§14")
add("six.keyOf", "keyOf(S)",
    "A scene's picture key: its session tag and content version, `tag-version` in base 36 (the version alone for a scene saved without a tag).",
    ["-"], "§14")
add("six.rowKey", "rowKey(R)",
    "A panel row's picture key: its scene's `keyOf`, or for a row of several scenes, `e` + the FNV-1a hash of their keys and the id of the scene whose frame it shows.",
    ["-"], "§14")
add("six.newGrid", "newGrid()", "A fresh scene grid: empty `all` and `own` band maps.", ["-"], "§14")
add("six.chunkRuns", "chunkRuns(n, loops, f)",
    "The maximal runs of chunks for which `f(k)` holds: along the sequence, or around each closed loop, so a run crossing a loop's start is one run.",
    ["`loops` is the first chunk of each closed loop. The stray rule and the insert rule's groups read their runs through it, so an outline's first and last chunks are neighbours."],
    "§14")
add("six.fileIn", "fileIn(G, bands, b, i0, i1, j0, j1, e, add)",
    "Add a chunk entry to, or remove it from, every cell a box covers in band b of a grid's `all` or `own` table.",
    ["A band is a cell table (`CellTab`: open addressing from a cell key to a segment of the grid's pool `G.P`); a segment holds its capacity, its length and its entries `slot·MAX_CHUNKS + k`. A full segment is copied to one twice the size, the old one counted as waste; a removal closes the gap in place."],
    "§11")
add("six.SceneIndex", "SceneIndex",
    "The scene index: every indexed object as an item, every scene with its members, grids, anchor and origin; one `apply(batch)` touches only the scenes the batch reaches.",
    ["Pure: frames and items arrive as records and nothing reads a document, so the one class runs in the scene worker and inline (DESIGN.md §11; the rules and their order: docs/reference/scenes-v3-design-bible.md).",
     "A scene's geometry is in its anchor frame (its coarsest home) less an origin, so a whole scene moved is one origin change. Widths compare across frames as `L = log2(w) − 12·depth`; every distance is in stroke widths (`REACH` 900, `CHUNK` 600).",
     "The list it returns folds echoes (nested scenes framing the same subject) into one row each (`_echoes`); the scenes themselves are unchanged.",
     "`__oracles__/sceneOracle.js` implements the same rules by brute force; `sceneIndex.test.js` compares the two after every batch."],
    "§14")
add("six.SceneIndex.constructor", "SceneIndex.constructor()",
    "An empty index, its scene, content-version, part and region counters at 1, and a new session tag for its picture keys.",
    ["`seedsMax` (32) is the seed count above which a split check labels the whole scene; the tests lower it to exercise that path."],
    "§14")
add("six._reset", "_reset()",
    "Clear every structure: frames, items, scenes, width buckets, grid slots, kept-aside names, regions, rows and the query counters.",
    ["The id counters are left alone; `_restore` sets them from the file."],
    "§14")
add("six._depth", "_depth(id)", "A frame's depth, 0 for a frame the table does not hold.", ["-"], "§14")
add("six.loopStarts", "loopStarts(loops, n)",
    "A record's closed loops as an item keeps them: the first chunks that lie within its `n` chunks, a shared frozen `[0]` for one loop from the start, or null.",
    ["-"], "§14")
add("six._setGeom", "_setGeom(x, r)",
    "Give an item its chunks and width: the chunk count (at most MAX_CHUNKS), the first chunk of each closed loop, the absolute log width L and the mass.",
    ["The closed loops come from the record's `loops` through `loopStarts`, only those within the kept chunks; without them the chunk sequence is open.",
     "Mass is the chunks' total length in widths, at least 1: scale-free ink, which decides the side of a split or merge that keeps the identity."],
    "§14")
add("six._mkItem", "_mkItem(r)",
    "Make an item from a record: a grid slot (a freed one reused), its table residual and its geometry.",
    ["-"], "§14")
add("six._dropItem", "_dropItem(x)", "Forget an item and free its grid slot for reuse.", ["-"], "§14")
add("six._boxesIn", "_boxesIn(x, anchor, out, ox, oy)",
    "An item's chunk boxes where it is drawn now, in a scene's anchor coordinates less the origin, into `out`; returns the mapping used, or null.",
    ["Drawn position = stored chunk + the table's residual (`tx, ty`) + the home frame's pending shift, mapped home → anchor. A move changes the last two, never the chunks."],
    "§14")
add("six._homeBox", "_homeBox(x)",
    "An item's drawn bounding box in its own home frame: stored chunks plus residual plus the home's shift.",
    ["-"], "§14")
add("six._cells", "_cells(S, x, add)",
    "File an item's chunks into (or out of) a scene's grid, and its multi-chunk grid too when the item has three chunks or more.",
    ["The multi-chunk grid (`mgrid`) is what stray-run invalidation queries, so single-chunk dots never pay for it."],
    "§14")
add("six._cellsIn", "_cellsIn(G, x, add)",
    "File each chunk of an item into the cells of its own band in `all` and `own`, and of the five coarser bands in `all`.",
    ["Band b = floor(log2 T), cell side `2^(b+1)`: `all[b]` holds the chunks of bands b−5..b (what a query from band b must see), `own[b]` band b's alone (what a finer query must see). Kept apart, a query never walks a coarse cell only to skip what was filed up into it."],
    "§14")
add("six._near", "_near(S, x0, y0, x1, y1, T, b, fn, G, full)",
    "Visit every chunk of a scene within reach of a box: `all[b]`, then `own` of the five coarser bands; `fn(item, k)` returning true stops the search.",
    ["Reach is the larger of the query's `T` and the chunk's own, so two inks join at `max(T_a, T_b)`. `full` (from `_components`) skips cells whose entries were all visited. Counted in `stats.queries`."],
    "§14")
add("six._scan", "_scan(G, t, bb, x0, y0, x1, y1, T, fn, seen)",
    "One band's cells around a box, padded by one cell side, testing each entry's chunk against the reach; a cell `seen` already covers is skipped.",
    ["The cell side `2^(bb+1)` exceeds every reach filed in that band, so one cell of padding finds every chunk in reach. Counts cells and entries in `stats`."],
    "§11")
add("six._valid", "_valid(S, m, k)",
    "Is chunk k of member m outside a stray run? Always, for a member of under three chunks or in a one-member scene; computed per member when first read.",
    ["Stray chunks are not framed and never bridge (DESIGN.md §11)."],
    "§14")
add("six._computeValid", "_computeValid(S, m)",
    "Mark a member's lonely chunks (no other member's ink within reach) and flag every run of STRAY_CHUNKS (2) or more as stray, runs read around closed loops.",
    ["Runs come from `chunkRuns`, so a lonely stretch across a loop's start is one run. Writes `m.valid` (1 = valid) and sets `validOk`; `_file`, `_unfile`, merges and splits clear `validOk` when a neighbour changes."],
    "§14")
add("six._invalidateNear", "_invalidateNear(S, x)",
    "Make the multi-chunk members within reach of an item recompute their stray runs when next read.",
    ["Queries the multi-chunk grid only: over every chunk it was measured at 30.6 M of the Magnum Opus build's 30.8 M grid entries (dense stippling, hundreds of dots within reach of each)."],
    "§14")
add("six._mkScene", "_mkScene(anchor, idn)",
    "Make an empty scene in an anchor frame, with a new identity unless one is given, a new content version under this session's tag, and register it by id.",
    ["-"], "§14")
add("six._newIdn", "_newIdn()",
    "A new scene identity: the next `s<n>` id, the default name `Scene <n>`, unnamed, stamped with this batch.",
    ["The batch stamp (`born`) is what lets `_reclaim` give a scene born this batch a name kept aside."],
    "§14")
add("six._setIdn", "_setIdn(S, idn)",
    "Give a scene another identity (a merge's winner, a split's, a reclaimed name), re-keying the by-id map.",
    ["-"], "§14")
add("six._drop", "_drop(S)",
    "Remove a scene from the index and its width buckets, without keeping its name aside.",
    ["-"], "§14")
add("six._rebucket", "_rebucket(S, gone)",
    "Keep a scene in the width buckets its range covers (one per 4 octaves of L), or take it out of all of them.",
    ["The buckets are how `_candidates` finds the scenes whose range can meet an item's without scanning every scene."],
    "§14")
add("six._range", "_range(S)",
    "Recompute a scene's width range from its members when one at an end left, and re-bucket it.",
    ["-"], "§14")
add("six._touched", "_touched(S)",
    "Mark a scene changed: a new content version under this session's tag (its picture key), its frame due, its saved member string stale.",
    ["-"], "§14")
add("six._file", "_file(S, x, quiet)",
    "File an item into a scene at its current position, re-anchoring the scene first when the item is homed coarser; false when no mapping joins them.",
    ["Sets the item's filed boxes, reach `T = REACH·w·s` and band, and adds it to the grids, mass, range and box. Unless `quiet` (a restore, a merge or a split, which settle stray runs wholesale), its neighbours' stray runs are invalidated."],
    "§14")
add("six._unfile", "_unfile(S, x)",
    "Take an item out of a scene: its neighbours' stray runs invalidated, its grid entries, mass and multi-chunk count removed.",
    ["The range is marked for recomputation when the item sat at an end, and `lost` is set so `_finish` re-anchors the scene at its coarsest remaining home."],
    "§14")
add("six._reanchor", "_reanchor(S, anchor, fresh)",
    "Move a scene's geometry into another anchor frame: every member re-filed there, the origin carried across, or (`fresh`) reset at the first member's box.",
    ["`fresh` is for a scene whose anchor moved this batch: the filed positions are no longer comparable, so members are filed where they now are and their stray runs recomputed.",
     "The scene's last frame is mapped into the new anchor too (through the pre-batch tree when `fresh`), since a name kept aside is recorded in it."],
    "§14")
add("six._reanchorOld", "_reanchorOld(S, target)",
    "A scene whose anchor frame went this batch (a shadow merged into its resident) re-filed in `target` through the pre-batch tree, every member at its filed position.",
    ["Filed boxes, reach and origin are scaled and mapped, so the placement that follows sees who moved. Where no pre-batch map joins the two frames, `_reanchor(fresh)` files the members where they now are."],
    "§14")
add("six._staticRef", "_staticRef(id, moved)",
    "Where a displacement is measured: the frame, walked up the pre-batch tree while it went or moved this batch; null past the root.",
    ["-"], "§14")
add("six._framesGone", "_framesGone(gone, moved)",
    "Frames that went this batch: the scenes anchored in one are re-anchored in the nearest frame above that stayed, and names kept aside there are remapped into it.",
    ["Runs right after the frame records, before any item record is read; the frame above is `_staticRef`'s."],
    "§14")
add("six._newScene", "_newScene(x)",
    "A new scene of one item, anchored at its home with the origin at the item's box corner.",
    ["Dropped again (null) when the item cannot be filed."],
    "§14")
add("six._candidates", "_candidates(x)",
    "The scenes an item may join: a width range within the spread with it, and a bounding box within the larger reach of its box.",
    ["Found through the width buckets, each scene tested once per call. The box test is a prefilter; the chunk test is `_insert`'s."],
    "§14")
add("six._insert", "_insert(x)",
    "The insert rule: an item joins the scenes its chunks touch, merged while their widths fit, or starts a scene of its own.",
    ["Each chunk is tested against the valid chunks of every candidate at reach `max(T_a, T_b)`. The chunks are split into groups at runs of STRAY_CHUNKS untouched chunks, read around closed loops (`chunkRuns`); the group touching most (tie: the one holding the lowest chunk) decides. Its scenes, most-touched first then oldest, merge while the merged range fits ZOOM_SPREAD, and the item joins (DESIGN.md §11).",
     "So a long line from one drawing to another through empty paper does not merge them."],
    "§14")
add("six._idWinner", "_idWinner(A, B)",
    "Which identity survives a merge: the renamed scene if exactly one was renamed, else the one with more ink, else the older.",
    ["-"], "§14")
add("six._merge", "_merge(A, B)",
    "Merge two scenes: the one with the deeper anchor (tie: fewer members, then the younger) re-files its members into the other; the identity winner's id and name go to the result, the loser's are kept aside.",
    ["Members are filed quietly, and every multi-chunk member's stray runs are recomputed when next read."],
    "§14")
add("six._tomb", "_tomb(S)",
    "Keep a scene's id and name aside with its frame and width range, so a scene later covering that frame can take them back.",
    ["`_tombRecord` makes the record, `_pushTomb` keeps it."],
    "§14")
add("six._tombRecord", "_tombRecord(S)",
    "A scene's kept-aside record: id, name, anchor, frame and width range; null for a scene with no frame.",
    ["A live scene is framed as it stands; an emptied one uses its frame and range from the end of the last batch."],
    "§14")
add("six._pushTomb", "_pushTomb(rec)",
    "Keep a record aside, stamped with the kept-aside clock; at most TOMB_MAX (256), the oldest dropped.",
    ["-"], "§14")
add("six._kill", "_kill(S)", "Keep a scene's name aside and remove the scene.", ["-"], "§14")
add("six._splitCheck", "_splitCheck(S, seeds, full)",
    "After members left a scene, split it into its components: the heaviest keeps the id and name (tie: the one holding the smallest id), the others become new scenes numbered in order of their smallest id.",
    ["Components come from `_seedComponents`, a search from the neighbours of what left, or, with `full` or more than `seedsMax` seeds, from labelling every member (`_components`).",
     "The scene object keeps the component the search left open (the part never walked), else the heaviest; the others are re-filed into new scenes and identities follow."],
    "§14")
add("six._seedComponents", "_seedComponents(S, start)",
    "The components reachable from seed members, by an interleaved search per seed that stops once at most one search is still open.",
    ["A scene is connected by invariant, so every component holds a seed; searches that meet are merged. The open search's component is the rest of the scene, returned unwalked with `.rest` marking it. Null when fewer than two components are found."],
    "§14")
add("six._components", "_components(S)",
    "Label every member of a scene: its components, by flood fill over the grid.",
    ["A cell whose entries are all visited is skipped: a scan from one component never reaches another's ink. A dense scene (the Magnum Opus has ~4,900 dots within two join distances) costs its filings once rather than its size at every member."],
    "§14")
add("six._bbExact", "_bbExact(S)", "Recompute a scene's bounding box from its members' filed chunks.", ["-"], "§14")
add("six._frameOf", "_frameOf(S)",
    "A scene's frame in its anchor's coordinates: its valid ink (stray runs left out), padded by FRAME_PAD and at least one thickest width each way; no minimum size (Kobin 2026-09-23).",
    ["Also refreshes the scene's bounding box. A one-member scene is framed on all its ink; null for a scene with no chunks."],
    "§11")
add("six._itemsTouch", "_itemsTouch(items, B)",
    "Does a valid chunk of these items, filed in their own scene, come within reach of a valid chunk of scene B?",
    ["Stray runs bridge nothing here, as at an insert. Maps each chunk from its scene's anchor into B's. `_rejoin`'s chunk test."],
    "§14")
add("six._rejoin", "_rejoin(S, own)",
    "A scene moved whole lands: it merges with the compatible scenes its moved ink (`own`, all its members by default) now touches, oldest first, while the range fits.",
    ["Candidates are prefiltered by range and bounding box; the chunk test (`_itemsTouch`, valid chunks on both sides) uses `own` only, so ink that stood still, or a scene merged in on the way, pulls in nothing more."],
    "§14")
add("six.apply", "apply(batch)",
    "One batch of changes: frames (those that went first), placed items (moved whole or re-inserted), removals with pieces filed back and split checks, inserts in id order, re-joins, heirs, renames; returns the scene list and the saved state.",
    ["Item records are gone, new (a `hint` names the object an erase piece replaced), re-shaped, re-placed, or `attr` (a z change: the scene's content version, its picture key, moves on and nothing else). A re-shape that is a pure translation counts as placed, and so does every item whose home frame moved or shifted. A record's `loops` travel with its chunks: a translation takes the new ones, a re-shape without new chunks keeps the old.",
     "Per scene in id order: leaving members go; pieces and re-shaped objects are filed into the scene of what they replaced while the width range allows (storage, not new ink), else inserted; the rest is split-checked. An emptied scene keeps its name aside, or, when members that moved away emptied it, passes it to `_heirs`.",
     "Each scene then holding ink that moved whole re-joins through that ink alone. `_finish` frames, reclaims names, and sets parents, parts and regions (DESIGN.md §11). A `restore` batch goes to `_restore` instead. Returns `{scenes, changed, export, ms, stats}`."],
    "§14")
add("six._heirs", "_heirs(heirs)",
    "A scene emptied by members that moved away passes its id and name to the scene holding most of their ink, when that scene was born this batch (tie: the one holding the smallest of their ids); otherwise the name is kept aside.",
    ["Run after the inserts and re-joins, in the emptied scenes' id order; the id is not given when a live scene already holds it."],
    "§14")
add("six._translated", "_translated(x, b, wb)",
    "Are a record's chunks `b` item `x`'s chunks shifted by one displacement: same count, lengths and width, within 1e-6 of a reach?",
    ["-"], "§11")
add("six._placeScenes", "_placeScenes(placed, movedFrames, removeFrom, inserts, rejoin, fullSplit, leave)",
    "Items placed anew, per scene: every member that stays moved by one displacement is a rigid move (the origin follows, the moved ink re-joins where it lands); otherwise the moved members leave and are inserted again.",
    ["Displacements are measured in `_staticRef`'s frame, the nearest at or above the anchor that neither went nor moved: the old position through the pre-batch tree, the new through the current one.",
     "A rigid move touches no grid cell and keeps the content version (the picture key); its moved members go on the re-join list, and whichever scene holds them after the inserts re-joins through them. A scene whose anchor moved but which did not move whole is re-anchored in that static frame and split-checked whole."],
    "§14")
add("six._finish", "_finish(t0, legacy)",
    "The end of a batch: scenes that lost members re-anchored at their coarsest remaining home, changed scenes re-framed, then names reclaimed, parents, rows (`_echoes`), parts and regions.",
    ["Returns `{scenes, changed, export, ms, stats}`. `legacy` (an old file's scenes on a first build) is the pool `_reclaim` draws names from."],
    "§14")
add("six._parts", "_parts(S)",
    "Part records for a scene wider than MAX_SPAN_PX at its thickest width: its valid ink cut in two at the emptiest line across the long axis until every piece fits.",
    ["The emptiest line is the lightest of 32 bins of an ink histogram over the middle 60 % (a tie goes to the middle), at most 12 cuts deep. Output only.",
     "Parts are in the scene's local coordinates, so a rigid move keeps them; a part keeps its id and given name while it covers MATCH_OVERLAP of a previous part's frame."],
    "§14")
add("six._regions", "_regions()",
    "Group more than MAX_SIBLINGS rows under one parent row (or at the top) into region records, by median splits of their shown frames' centres across the wider spread.",
    ["Output only. Centres are mapped into the parent row's anchor (at the top, the heaviest row's); a group of one makes no region. A region is keyed by its parent row's founder and holds its rows' founders, which stay put through a rename or a fold.",
     "A region keeps its id and given name while its founder set overlaps an earlier region's (any key) by MATCH_OVERLAP (shared ÷ union), each earlier region taken once."],
    "§14")
add("six._reclaim", "_reclaim(legacy)",
    "Scenes born this batch take a kept-aside id and name whose frame they cover by MATCH_OVERLAP with a compatible width range, best cover first.",
    ["Covers are compared rounded to 1e-9, so two names kept aside with one frame tie; ties go to the name kept most recently, then the older scene. A name whose id is live on another scene is skipped. With `legacy` (an old file's scenes on a first build) the pool is those scenes, with no range test, and nothing is taken out of it."],
    "§14")
add("six._parents", "_parents(changed)",
    "Set each scene's parent: the scene whose frame holds its frame's centre with the smallest Lmax above its own (tie: the older).",
    ["When at most an eighth of the scenes changed, only the changed ones, those whose parent changed or vanished, and those a changed coarser scene now contains are recomputed; otherwise all."],
    "§14")
add("six._echoes", "_echoes()",
    "Fold echoes into the panel's rows: top-down, a scene joins the row of its nearest ancestor (up to ECHO_UP, 8, generations) whose tightest frame and its own hold each other's centres, sizes within ECHO_ZOOM (3×).",
    ["A row's frames span at most ZOOM_SPREAD, and two renamed scenes never share one. A row shows its tightest frame and its renamed member's id and name, else its founder's (the first, coarsest member); its parent row is its founder's parent's, its ink and count its members' sums.",
     "Output only: scenes, parents and the saved state are unchanged (scenes-v3 bible, Echo rows)."],
    "§14")
add("six._echoJoins", "_echoJoins(R, S)",
    "Does a scene echo a row: its frame and the row's tightest hold each other's centres, sizes (`frameLog`) within ECHO_ZOOM, the row's span still within ZOOM_SPREAD, and not a second renamed scene?",
    ["-"], "§14")
add("six._contains", "_contains(P, S)",
    "Does P's frame hold the centre of S's frame, mapped into P's anchor?",
    ["-"], "§14")
add("six.records", "records()",
    "The panel's list of echo-folded rows: roots by ink, heaviest first, each followed by its parts and its child rows; a crowd of sibling rows listed under its regions.",
    ["A row carries its shown scene's `id` and `name` (the renamed member's, else the founder's), its tightest member's frame as `level` and `rect`, `depth`, `hash` (`rowKey`), `auto`/`pinned` and `count` (every member's objects). Its parts are the tightest member's; parts and regions carry `kind`, a child row its `parent`, a region's row its `region`.",
     "A part's `hash` is the tightest member's key and its number, a region's `r` + the FNV-1a hash of its rows' keys. An unnamed part reads `<scene> · k`, an unnamed region `<first> and N more`."],
    "§14")
add("six.rename", "rename(id, name)",
    "A user's name on a scene, part or region (trimmed, at most 120 characters); a renamed scene keeps its identity through a merge with an unnamed one.",
    ["False for a blank name or an unknown id."],
    "§14")
add("six.exportState", "exportState()",
    "The saved state, `meta.sceneIndex` v 3: the counters, each scene's shell with its member strings and picture key (version and session tag), the kept-aside names and the regions.",
    ["A scene's `m` (objects) and `e` (erase footprints, by −id) strings are cached until its membership changes. `dirty` and `erase` are added by the client (`SceneClient.exportForSave`)."],
    "§14")
add("six._restore", "_restore(batch, t0)",
    "A load: the saved scenes rebuilt as shells, every object filed straight into its saved scene with no joins, and the objects the index never saw inserted by the ordinary rule.",
    ["A shell with no object left keeps its name aside; one whose members no longer fit ZOOM_SPREAD drops those below the top 16×; one that lost members is split-checked whole. The saved `dirty` ids are left out of their shells and inserted; `attr` records are ignored.",
     "A restore starts a new session tag; each shell keeps its saved version and tag, so an unchanged scene keeps its picture key and a new version is never keyed like an old one.",
     "With no saved state (an old file) it is a fresh build, the old scenes lending their ids and names by frame overlap (`_reclaim(legacy)`).",
     "Renames the batch carries are applied too: a scene's before framing, a part's or region's after `_finish`, when those exist; then the rows and regions are folded again (a name can part two scenes' row) and the list and state exported again."],
    "§14")

# ---- src/engine/sceneClient.js ----
add("scc.now", "now()",
    "A millisecond clock for the client's slices and waits: `performance.now()` where there is one, else `Date.now()`.",
    ["-"])
add("scc.chunker", "chunker(max)",
    "A running chunk builder: points go into one box until it would outgrow `max` on a side; the next box starts at the last point, so the chunks cover the ink with no gap.",
    ["Each chunk is `x0, y0, x1, y1, len`, `len` the path length it covers. `put(x, y, jump)` with `jump` starts a new run (a new loop) with no length from the last point; `starts` lists each run's first chunk."],
    "§14")
add("scc.walkLoops", "walkLoops(loops, max)",
    "Walk a shape's loops once: chunks along the outline, each loop's first chunk (`loops`), and its area and perimeter for its mean width.",
    ["Reads the stored Loop records (line, arc, cut line, cut arc), subdividing every piece at half a chunk so a long line or arc never becomes one box. The area is the shoelace sum plus each arc's segment term."],
    "§14")
add("scc.walkPoly", "walkPoly(rings, max, closed)",
    "Chunks along polylines, each segment subdivided at half a chunk: a stroke's centreline (open), or a fill's polygons (`closed`: each ring run back to its start, its first chunk returned in `loops`).",
    ["-"], "§14")
add("scc.boxSize", "boxSize(out)",
    "The longer side of the bounding box of a chunk list, 0 when it is empty.",
    ["-"])
add("scc.sceneGeom", "sceneGeom(o)",
    "An object as the index sees it: the width it counts with, its chunk records in stored coordinates and each closed loop's first chunk, cached on the object.",
    ["A shape counts its thickness now, mean width 2·area ÷ perimeter, capped at its pen (walked a second time only when under half its pen); a pen-less shape or fill counts its size as one chunk; a stroke counts its pen (`lwFrame`). Chunks are CHUNK widths long, doubled until there are at most MAX_CHUNKS (2,048).",
     "`loops` is null for a stroke's open centreline; a one-loop outline shares a frozen `[0]`. Cached in `o._sc`; the client drops it on a geometry change. A zero-length chunk (a dot) counts one width of ink."],
    "§14")
add("scc.isInk", "isInk(doc, o)",
    "Does the index hold this object: not an eraser mark, not a stroke still being drawn, and not a ceded patch (`attachRect`, storage) while its family keeps ink outside patches?",
    ["A patch whose family has nothing else left is the drawing, and counts as ink (`orphanPatch`)."],
    "§14")
add("scc.orphanPatch", "orphanPatch(doc, o)",
    "Is this ceded patch all that is left of its family: no other member that is neither an eraser mark nor a patch?",
    ["-"], "§14")
add("scc.SceneClient", "SceneClient",
    "The main-thread side of the scene index: a dirty set from the Document's events, item records prepared at idle, one batch at a time to the index in its worker or inline.",
    ["The scene list lands in `docMeta.scenes`; the saved state rides `serializeDrawing` as `meta.sceneIndex` (`exportForSave`). Never runs while a stroke, a drag or a lasso is live, and waits behind the raster and erase workers for at most 3 s (DESIGN.md §11).",
     "It also records the fine eraser's footprints and rebuilds the index from the file on a load or a reset."],
    "§14")
add("scc.SceneClient.constructor", "SceneClient.constructor(E, { ... })",
    "Subscribe to the engine's Document, its objects and its ops, with empty dirty, z-change, gone-frame, patch-family, sent and footprint state; `worker: false` forces the inline index.",
    ["The index itself opens on the first batch (`_mode`). `gen`, bumped by every restore, tells a worker result for the current document from one for the document before; `frameEv`, bumped by every frame event and settle, tells a prep that spanned one. The footprint caps are FOOT_MAX (512) and FOOT_CHUNKS (8,192)."],
    "§14")
add("scc.destroy", "destroy()",
    "Stop: cancel the schedule, unsubscribe from the Document and terminate the worker.",
    ["-"], "§14")
add("scc.onChange", "onChange(fn)",
    "Listen for each landed batch's result; returns the unsubscribe.",
    ["-"], "§14")
add("scc._onEvent", "_onEvent(ev)",
    "A Document event marks the objects it touched dirty and schedules a batch; a reset or a load starts a full restore.",
    ["A live stroke waits for its finalize; an attribute-only change is kept as a z change (`attr`); a geometry change drops the object's cached `_sc`; an add, finalize or remove re-checks the patches of the object's family (`_family`).",
     "Frame events count in `frameEv`. A frame merge or split dirties its ids, an added frame its objects; a removed frame is noted and the ids sent from it are dirtied at the flush (`_takeGone`); frame records themselves are diffed at the flush."],
    "§14")
add("scc._family", "_family(o)",
    "An object added to or gone from a family with a ceded patch: that family's patches are re-checked at the flush, since whether a patch counts as ink depends on the rest of its family.",
    ["-"], "§14")
add("scc._onOp", "_onOp(ev)",
    "An erase bake hints each piece with the object it replaced, so it keeps that scene, and records the fine eraser's footprint; an eraser gesture's undo or redo turns its footprints off or on.",
    ["A new action ends the redo branch, so footprints turned off by an undo are dropped for good. A settle counts as a frame event (`frameEv`); its natives' change events follow.",
     "The hint rides the piece's first item record; the index files the piece into the replaced object's scene when the width range allows (storage, not new ink)."],
    "§14")
add("scc._footprint", "_footprint(markId, step)",
    "A cut by an eraser finer than the ink it cut: the mark's chunks within its reach of the cut shape become a footprint item, hosted by a surviving piece in that frame.",
    ["Only when the eraser's pen, mapped into the cut object's frame, is thinner than the ink's counted width; a coarser one is removal. The boxes are mapped into the host's stored coordinates through its table and keyed by the host piece (item id −host); the frame's depth is kept so the footprint can follow a re-homed host.",
     "One per cut, so a swipe across two drawings bridges nothing (DESIGN.md §11). The footprints are then capped (`_capFoot`)."],
    "§14")
add("scc._capFoot", "_capFoot()",
    "Keep at most FOOT_MAX (512) footprints and FOOT_CHUNKS (8,192) chunk records: the oldest are marked to drop, and their scenes go with them.",
    ["-"], "§14")
add("scc._footItems", "_footItems(items)",
    "The footprints' item records for a batch: each followed to its host, re-hosted in the family when the host is gone, dropped when none is left.",
    ["A host re-homed to a frame of the same depth (a carry, a merged shadow) takes the footprint with it, stored coordinates unchanged. Otherwise a new host is a piece of the same edit group in the footprint's frame with the same table residual.",
     "A footprint turned off (its gesture undone) is sent as gone but kept for the redo; one marked to drop is sent as gone and forgotten. Only changed records are sent."],
    "§14")
add("scc._cancel", "_cancel()", "Cancel the scheduled tick, timer or idle callback.", ["-"], "§14")
add("scc._schedule", "_schedule(delay)",
    "Schedule one tick at idle (`requestIdleCallback`, 1 s timeout), or on a timer where there is none; a tick already scheduled stands.",
    ["-"], "§14")
add("scc._busy", "_busy()",
    "Must the index wait? Always while a stroke, a drag or a lasso is live; behind an erase job in flight or the raster worker's queue for at most MAX_WAIT_MS (3 s).",
    ["-"], "§14")
add("scc._tick", "_tick(deadline)",
    "One idle tick: retry in 150 ms while busy; else step a restore, or prepare the dirty objects' records in a time slice and send the batch when they are done.",
    ["A slice is SLICE_MS (8 ms) at most, 4 at least, within the idle deadline. Nothing is sent while a batch is in flight. A new batch starts from `_takeGone` and notes `frameEv`; `_sendPrepared` sends it."],
    "§14")
add("scc._sendPrepared", "_sendPrepared(p)",
    "Send a prepared batch: the ids a frame event dirtied during the prep folded in first, then the z changes, the footprints, the frame diff and the renames.",
    ["Frame records are read at the send and item tables per slice, so after a frame event mid-prep (a settle moves a frame's shift into its natives' tables) the ids it dirtied are prepared into the batch (`_fold`) or its halves disagree. A z change goes as an `attr` record only for an object the index holds and the batch does not already carry."],
    "§14")
add("scc._hasWork", "_hasWork()",
    "Is there anything for a batch: dirty ids, z changes, gone frames, families to re-check, renames, footprints or a changed frame?",
    ["-"], "§14")
add("scc._takeGone", "_takeGone()",
    "Dirty the ids sent from frames removed since the last batch (one pass over `sent` for them all) and the patches of families that gained or lost an object.",
    ["-"], "§14")
add("scc._fold", "_fold(st)",
    "Prepare the dirty ids into a batch already prepared, one record per id: a later record replaces an earlier one, keeping its chunks (with their loops) and erase hint when it has none.",
    ["-"], "§14")
add("scc._resyncWanted", "_resyncWanted()",
    "Should a restore run now? With a worker, always; inline, only for a document of at most 5,000 objects or when `flushNow` forces it.",
    ["-"], "§14")
add("scc._mode", "_mode()",
    "Where the index runs: in a worker if one opens (tried on the first call), else an inline SceneIndex.",
    ["-"], "§14")
add("scc._prepStep", "_prepStep(st, budget)",
    "Turn dirty ids into item records until the budget runs out: gone for what is no longer ink, else home, width, table residual and (when new or re-shaped) chunks with their closed loops' first chunks; true when done.",
    ["Only what differs from the record last sent goes out; a new object carries its erase hint. A ceded patch's family is noted (`patchFam`) so its patches are re-checked when the family changes. The clock is read every 64 ids."],
    "§14")
add("scc._frameRec", "_frameRec(f)",
    "A lattice frame as the index's frame record `{id, parent, depth, cx, cy, sx, sy}`.",
    ["-"], "§14")
add("scc._framesChanged", "_framesChanged()",
    "Has any frame been added, removed or changed since the last batch?",
    ["-"], "§14")
add("scc._frameDiff", "_frameDiff()",
    "The frame records that changed since the last batch, and `gone` for removed frames; remembers what it sent.",
    ["-"], "§14")
add("scc._startResync", "_startResync(kind, state)",
    "Start a full restore: forget everything sent and waiting and rebuild the index from the file (`load`), or (`reset`) from the state given, else the last export.",
    ["Bumps the generation and forgets the batch in flight, so a worker result for the document before is dropped when it arrives; notes `frameEv` for the prep. A load also drops the footprints; the file's are read in the restore's first step."],
    "§14")
add("scc._loadFoot", "_loadFoot(list)",
    "Read the file's saved footprints (`sceneIndex.erase`), an undone gesture's still off, skipping malformed entries, then cap them (`_capFoot`).",
    ["-"], "§14")
add("scc._resyncStep", "_resyncStep(budget)",
    "Step a restore: read the file's footprints, prepare a record for every object in slices, then send one restore batch with the saved state.",
    ["Ids a frame event dirtied during the prep are folded in (`_fold`). A load restores from the file's index; a reset from the state it was given, falling back to the file's. The state is used only when it is v 3 with a scene list.",
     "Otherwise the old `meta.scenes` lend their ids and names by frame overlap (only v2 rows, `s<n>` with no `kind`, since a v3 part's or region's id would collide with the index's own) and `sceneSeq` seeds the id counter."],
    "§14")
add("scc._send", "_send(batch, ids)",
    "Send a batch: inline, applied at once; to the worker, one in flight at a time, tagged with the client's generation.",
    ["The in-flight record keeps a restore's state, so a save meanwhile keeps what it carries as dirty. A result or failure from an earlier generation (a restore began since) is dropped. A worker failure terminates the worker and sends the index inline for good; either failure goes to `_failed` with the batch and its ids."],
    "§14")
add("scc._failed", "_failed(err, batch, ids)",
    "The index failed on a batch: warn, drop the inline index, and rebuild it from the last saved state with the failed batch's ids and everything dirty since listed as `dirty`.",
    ["The saved state is the last export, else the file's; a restore inserts the `dirty` ids by the ordinary rule. A failed restore is retried from the state it carried."],
    "§14")
add("scc._landed", "_landed(out)",
    "A batch's result: keep its saved state and timings, put the scene list in `docMeta.scenes`, tell the listeners, and schedule again if anything is owed (`_owed`).",
    ["-"], "§14")
add("scc._owed", "_owed()",
    "Is anything waiting for the next batch: a restore, a batch being prepared, or `_hasWork`?",
    ["-"], "§14")
add("scc.flushNow", "flushNow()",
    "Bring the index up to date now: inline, synchronously, a restore included; with a worker, the next batch is scheduled at once. Returns whether the scenes are current.",
    ["Never inside a stroke, a drag or a lasso: it schedules instead and returns false. Forces the restore a large inline document otherwise leaves waiting (`_resyncWanted`). At most 1,000 rounds."],
    "§14")
add("scc.rename", "rename(id, name)",
    "A user's name for a scene: shown in `docMeta.scenes` at once, sent to the index with the next batch.",
    ["-"], "§14")
add("scc.exportForSave", "exportForSave()",
    "The saved state for a file: the index's last export (or the file's own, before the first restore) with the names given since, every id not yet indexed as `dirty`, and the footprints as `erase`.",
    ["`dirty` includes the ids of the batch being prepared and of an ordinary batch in flight, and what a restore under way carries as dirty (a rebuild after a failure); a load inserts them by the ordinary rule.",
     "An undone gesture's footprints are saved too, marked `off`, since the op log brings the redo back after a load; dropped ones are not."],
    "§14")

# ---- src/engine/sceneWorkerClient.js ----
add("swc.setSceneTransport", "setSceneTransport(t)",
    "Tests only: stand in a transport for the worker; null restores the real one.",
    ["-"], "§14")
add("swc.workerUrl", "workerUrl()",
    "The scene worker's script: `PUBLIC_URL` + `/scene-worker.js`.",
    ["-"])
add("swc.openSceneWorker", "openSceneWorker()",
    "Open a fresh scene worker as `{post(batch) → Promise, terminate()}`, or null where there is no Worker or it failed before.",
    ["Each client owns one worker, since the index is state. Replies are matched by id; a worker error marks it broken for the session and rejects what is pending, and the client goes inline."],
    "§14")

# ---- src/engine/sceneOps.js ----
add("sco.fitView", "fitView(rect, w, h)",
    "The camera that frames a rect, centred, in a w × h viewport: `jumpTo`'s fit and `snapshotView`'s, one implementation.",
    ["Returns `{inScale, inPanX, inPanY}`, or null when the scale is not a positive finite number. CSS px for `jumpTo`, device px for `snapshotView`, so a thumbnail frames a scene exactly as jumping to it would."],
    "§14")
add("sco._initScenes", "_initScenes(on)",
    "Make the engine's scene client, or none for an engine that never lists scenes (`scenes: false`, the thumbnails' copy).",
    ["-"], "§14")
add("sco.snapshotView", "snapshotView(req)",
    "A picture of a rect in a frame, framed by `fitView` at a camera that is never set: one raster job on one plate, for the Scenes panel.",
    ["The world is shifted by the job's pack-time `offset` so the rect lands on plate (0, 0); the picture is the plate's top-left `w × h` device pixels, each capped at PLATE_PX (512). No crossing is made.",
     "Null off the raster path, for an unknown frame or an unfittable rect. The frame's table is read at idle, a budget at a time (`snapshotJob`), so a frame never visited no longer pays its bake inside the call (F59)."],
    "§11")
add("sco.sceneReport", "sceneReport()",
    "The scene client's account for a report: where the index runs, how many objects wait, whether a restore or a batch is under way, and its counters.",
    ["-"], "§15")

# ---- src/engine/__oracles__/sceneOracle.js ----
add("sor.fits", "fits(lo, hi)",
    "The spread test, restated: a width range fits one scene within SPREAD_OCT octaves.",
    ["-"], "§17")
add("sor.frameMap", "frameMap(frames, from, to)",
    "The similarity between two frames, walked up from one to the common ancestor and down to the other; no Horner offsets, no cache.",
    ["-"], "§17")
add("sor.SceneOracle", "SceneOracle",
    "The scene index's rules by brute force, which `sceneIndex.test.js` runs beside SceneIndex on the same batches and compares after every one.",
    ["Every distance is an all-pairs scan in a frame the pair shares, every stray run is recomputed when read, every split is a full labelling; no grids, anchors, origins or caches. It covers frames (those that went included), items, closed loops, erase hints, re-joins, heirs, renames, names kept aside and the list's echo rows; not restores, parts, regions or the saved state.",
     "Test-only: production never imports `__oracles__`."],
    "§17")
add("sor.SceneOracle.constructor", "SceneOracle.constructor()",
    "Empty frames, items, scenes and kept-aside names; the scene counter at 1.",
    ["-"], "§17")
add("sor._depth", "_depth(id)", "A frame's depth, 0 when unknown.", ["-"], "§17")
add("sor._geom", "_geom(x, r)",
    "An item's chunks, closed loops, width, absolute log width and mass, computed as SceneIndex computes them but with no chunk cap.",
    ["-"], "§17")
add("sor._loopOf", "_loopOf(x, k)",
    "The loop chunk k lies in: its `[start, end)` and closed, or, for an item with no loops, the whole sequence, open.",
    ["-"], "§17")
add("sor._runLen", "_runLen(x, k, f)",
    "The length of the run of chunks satisfying `f` through chunk k, read around a closed loop; 0 when k fails it.",
    ["Walked chunk by chunk both ways from k: the oracle's own count of what SceneIndex gets from `chunkRuns`."],
    "§17")
add("sor._in", "_in(x, F, frames)",
    "An item's chunk boxes and reach in frame F, recomputed from its record.",
    ["-"], "§17")
add("sor._touch", "_touch(a, ka, b, kb)",
    "Are chunk ka of a and chunk kb of b within `max(T_a, T_b)`, measured in the coarser of the two homes?",
    ["-"], "§17")
add("sor._linked", "_linked(a, b)", "Does any chunk pair of two items touch? Every pair tested.", ["-"], "§17")
add("sor._valid", "_valid(S, m, k)",
    "Is chunk k of a member outside a stray run? Every chunk's loneliness recomputed against every other member at each call, the lonely run through k measured by `_runLen`.",
    ["-"], "§17")
add("sor._range", "_range(S)", "A scene's width range, from its members.", ["-"], "§17")
add("sor._mass", "_mass(S)", "A scene's ink: its members' mass summed.", ["-"], "§17")
add("sor._newIdn", "_newIdn()",
    "A new identity, `s<n>` and `Scene <n>`, stamped with this batch, numbered as SceneIndex numbers them.",
    ["-"], "§17")
add("sor._add", "_add(idn, members)", "Register a scene with an identity and a member set.", ["-"], "§17")
add("sor.frameOf", "frameOf(S)",
    "A scene's frame in its coarsest home (tie: the lower frame id): valid ink, padded; no minimum size, as the live index (Kobin 2026-09-23).",
    ["-"], "§11")
add("sor._tomb", "_tomb(S)",
    "Keep a scene's id and name aside with its frame and range (through `_pushTomb`).",
    ["-"], "§17")
add("sor._pushTomb", "_pushTomb(rec)",
    "Keep a record aside, stamped with the clock; at most TOMB_MAX, the oldest dropped.",
    ["-"], "§17")
add("sor._winner", "_winner(A, B)",
    "A merge's surviving identity: the renamed one, else more ink, else the older.",
    ["-"], "§17")
add("sor._merge", "_merge(A, B)",
    "Two scenes become one under the winner's identity, the loser's kept aside; with no anchors, nothing is re-filed.",
    ["-"], "§17")
add("sor._sceneOf", "_sceneOf(x)", "The scene holding an item, by scanning every scene.", ["-"], "§17")
add("sor._insert", "_insert(x)",
    "The insert rule by brute force: every chunk against every chunk of each range-compatible scene; the group of touched chunks touching most decides, and its scenes merge while the range fits.",
    ["Touched chunks fewer than STRAY_CHUNKS apart are one group, around a closed loop's start too, built by union-find independently of SceneIndex's `chunkRuns`; a tie goes to the group holding the lowest chunk."],
    "§17")
add("sor._split", "_split(S)",
    "The split check by full labelling over all member pairs: the heaviest component keeps the identity (tie: the smallest id), the others get new ids in order of their smallest id.",
    ["-"], "§17")
add("sor._rejoin", "_rejoin(S, own)",
    "A scene moved whole merges with every range-compatible scene its moved ink (`own`, all its members by default) touches, valid chunk to valid chunk, oldest first.",
    ["-"], "§17")
add("sor._root", "_root()", "The root frame's id: the first frame with no parent.", ["-"], "§17")
add("sor.apply", "apply(batch)",
    "One batch by SceneIndex's rules and order: frames, placed items (rigid or re-inserted), removals with pieces filed back and split checks, inserts in id order, re-joins, heirs, renames, reclaimed names.",
    ["A frame that went carries the names kept aside in it, and scenes' last frames, up the old tree to a frame that stayed. `attr` records (z only) are skipped; a record's `loops` travel with its chunks, as in SceneIndex. A rigid move (every member that stays, moved by one displacement) is measured in the root frame against each item's position at the end of the last batch (`was`); each scene then holding that ink re-joins through it alone.",
     "An emptied scene keeps its name aside with the frame and range it had then, unless members that moved away emptied it and gather in a scene born this batch, which takes its id and name. Returns `result()`."],
    "§17")
add("sor._translated", "_translated(a, b, wa, wb)",
    "Is `b` the chunks of `a` shifted by one displacement? The same test as SceneIndex's.",
    ["-"], "§17")
add("sor._reclaim", "_reclaim()",
    "Scenes born this batch take a kept-aside name whose frame they cover by MATCH_OVERLAP with a compatible range, best cover first.",
    ["-"], "§17")
add("sor.result", "result()",
    "What the test compares: per scene id, its name, whether it was renamed, its sorted member ids, its parent, and `row`, the id of the panel row it is listed under.",
    ["The parent is the scene with the smallest Lmax above its own whose frame holds its centre. Rows are folded by the echo rule restated: top-down, the nearest ancestor's row (up to ECHO_UP) whose smallest frame and the scene's hold each other's centres within ECHO_ZOOM, the row spanning at most 16× and holding one renamed scene at most; a row's id is its renamed member's, else its first's.",
     "Also records each scene's frame and range, for the names kept aside in the next batch."],
    "§17")


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    "sco.SceneOps": {
        "why": "'Auto-scenes' names the whole-drawing clustering of the deleted scenes.js; SceneOps now holds the scene index's client and the camera calls (DESIGN.md §15). Its ref in newdesc_last is §10 (erasing); scenes are §14.",
        "what": "The engine's scene calls, as a mixin: the scene index's client, jumping to a scene, and a scene's picture.",
        "long": None,
    },
    "sco.jumpTo": {
        "why": "The long says it also captures the current view as a new scene; `captureView` is gone and scenes come only from the index. jumpTo only moves the camera.",
        "what": "Go to a scene: the camera `fitView` gives for its rect in its frame, then the ordinary crossing.",
        "long": ["Sets the camera to `fitView(rect)` in the frame, lets `_maybeCross` bring an out-of-range scale to a legal level, clears the renderer and renders. A camera move, never a document change; a stroke in progress is ended first."],
    },
    "sco.renameScene": {
        "why": "The long says rename, delete and split; `deleteScene` and `splitScene` are gone, and the rename goes through the scene client.",
        "what": "A user's name for a scene: shown in the list at once, taken by the index with the next batch; a renamed scene keeps its id and name through merges.",
        "long": ["Through `SceneClient.rename`; an engine without a client renames the row in `docMeta.scenes` directly. Trimmed, at most 120 characters."],
    },
    "sco.refreshScenes": {
        "why": "The Code Map row groups it with `_sceneKey`, `_sceneProj` and `_noteInkAdded` as scene discovery and a new stroke's provisional assignment; there is no discovery pass now, it flushes the scene index.",
        "what": "The scene list brought up to date: inline, now (a loaded drawing's first index included); with the worker, the next batch is started and the list as it stands comes back.",
        "long": ["Calls `SceneClient.flushNow` and returns `docMeta.scenes`."],
    },
    # gone: the scene index (sceneIndex.js) replaced scenes.js's clustering and the keys it used
    "sco._sceneKey": {"why": "gone", "what": None, "long": None},
    "sco._sceneProj": {"why": "gone", "what": None, "long": None},
    # gone: the scene client's Document subscription (`SceneClient._onEvent`, a `finalize` marks the
    # object dirty, the batch runs at idle) replaced it; long_eng.py's text and trees.py's pointerUp
    # line `_noteInkAdded | fac | provisional scene assignment` still name it
    "sco._noteInkAdded": {"why": "gone", "what": None, "long": None},
    # gone: no scene is made by hand; scenes come only from the index
    "sco.captureView": {"why": "gone", "what": None, "long": None},
    # gone: no replacement; the index owns scenes
    "sco.deleteScene": {"why": "gone", "what": None, "long": None},
    # gone: a split is the index's split check (`SceneIndex._splitCheck`)
    "sco.splitScene": {"why": "gone", "what": None, "long": None},
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# One or two sentences per FILE in the batch: what the file is for in the design.
ROLE = {
    "src/engine/sceneIndex.js": "The scene index (DESIGN.md §11): a pure core, saved in the file and updated one batch of changed objects at a time, never re-clustered. It keeps every scene's members, grids, anchor and origin, applies the rules in the scenes-v3 bible's order, and returns the panel's list and the saved state; it runs in the scene worker and inline.",
    "src/engine/sceneClient.js": "The main-thread side of the scene index: it turns the Document's events into item records at idle (chunks along the ink, the width it counts with, the table's residual) and sends one batch at a time to the index. It also records the fine eraser's footprints and writes the state a save carries.",
    "src/engine/sceneWorkerClient.js": "Opens the worker (`public/scene-worker.js`) that holds a scene client's index and posts it one batch at a time; where there is no Worker, or it failed, the client runs the index inline.",
    "src/engine/__oracles__/sceneOracle.js": "The scene index's rules by brute force (all-pairs scans, no grids, anchors or caches), which `sceneIndex.test.js` runs beside SceneIndex on the same batches and compares after every one. Test-only.",
}

# ---- 2026-10-05, the rebuilt tree ----
add("six.CellTab", "CellTab",
    "A grid's cell table: open addressing with linear probing, from a cell key — `(i + OFF)·KEYM + (j + OFF)`, below 2^52 — to the offset of the cell's segment in the grid's pool.",
    ["Part of the packing that keeps the index in typed arrays — grids as cell tables over one pool, chunks in shared pools — 26 MB on the Magnum Opus where it was 79 (DESIGN.md §11, SCENES-PLAN §7.8)."],
    "§11")
add("six.CellTab.constructor", "CellTab.constructor(cap)",
    "An empty table of `cap` slots (a power of two): keys −1, segments 0.", ["-"], "§11")
add("six._h", "CellTab._h(key)",
    "A cell key's slot: its high and low halves mixed by two multiplicative hashes, masked to the table.", ["-"], "§11")
add("six.find", "CellTab.find(key)",
    "The segment offset of cell `key`, or −1 when the table lacks it.", ["-"], "§11")
add("six.set", "CellTab.set(key, seg)",
    "Files cell `key` at segment offset `seg`, growing the table first when it would pass half full.", ["-"], "§11")
add("six._grow", "CellTab._grow()",
    "Doubles the table and re-files every key.", ["-"], "§11")
add("six.segAlloc", "segAlloc(G, cap)",
    "A new segment of `cap` entries at the end of grid G's pool (a capacity and a length word, then the entries), the pool doubled when it is full.",
    ["-"], "§11")
add("six.roomFor", "roomFor(len)",
    "A segment's capacity after a compaction: its length and a quarter more, so the next adds do not move it.", ["-"], "§11")
add("six.gridCompact", "gridCompact(G)",
    "Rebuilds grid G's pool without abandoned segments or empty cells, each cell's entries in the same order with a quarter's room, and its cell tables sized afresh.",
    ["-"], "§11")
add("six.padInk", "padInk(r, wmin)",
    "An ink box as a scene's frame: at least `wmin` (one stroke) each way, padded by FRAME_PAD of its longer side.",
    ["FRAME_PAD is 10 % (DESIGN.md §11: a frame is the ink and 10 %); the one-stroke floor gives a dot or a straight line a frame."], "§11")
add("six.cutParts", "cutParts(pts, limit)",
    "A wide scene's parts: its chunk boxes cut in two at the emptiest line across the long axis — a mass histogram over the middle 60 % — the widest piece first, until each fits `limit` or there are MAX_PARTS (12).",
    ["Returns the parts' boxes in the order of the cut tree. A piece is not cut past depth 12 or below two chunks."],
    "§11")
add("six.compact", "compact()",
    "Gives memory back between batches (`_compact`): the worker runs it after posting a result, the inline index after applying one.",
    ["-"], "§11")
add("six._reserve", "_reserve(items)",
    "Makes room in the raw-chunk pool and the per-item number column for a batch's new items, one allocation each, so filing the batch does not grow them item by item.",
    ["-"], "§11")
add("six._alloc", "_alloc(which, n)",
    "A region of `n` in one of the index's pools — raw chunks, filed boxes or valid flags — the pool grown by doubling; returns its offset.",
    ["-"], "§11")
add("six._locFor", "_locFor(x)",
    "Item `x`'s region of filed boxes in the box pool, sized to its chunks: the one it has when the count matches, else a new one (the old counted as waste).",
    ["-"], "§11")
add("six._rawOf", "_rawOf(x) · _locOf(x) · _validOf(x)",
    "Copies of an item's raw chunks, filed boxes and valid flags out of the pools, for the tests and probes.", ["-"], "§11")
add("six._compact", "_compact(force)",
    "Rebuilds each pool holding more waste than live data (or doubled well past it) with every item's regions in slot order, compacts each scene grid with more garbage than entries, and trims the number column.",
    ["Between batches only (`compact`); `force` rebuilds everything."], "§11")
add("six._cellsOut", "_cellsOut(G, xs)",
    "Takes items `xs` out of grid G, each touched cell's segment rewritten once with the others' entries in order.",
    ["When finding the leavers' cells would cost more than rewriting every cell, every segment is rewritten instead."], "§11")
add("six._unfileMany", "_unfileMany(S, xs)",
    "Many members out of scene S at once, each touched cell rewritten once; when all leave, the grids are dropped whole.",
    ["The leavers go from the stray-flag grid first, so the invalidating scans see only who stays — the same stays one-by-one removal would mark, none when no multi-chunk member stays."],
    "§11")
add("six._unfiled", "_unfiled(S, x)",
    "The bookkeeping of item `x` leaving scene S once its cells are out: membership, mass, the multi-chunk count, the width range marked dirty when `x` was at its edge, and S marked `lost`, so the end of the batch re-anchors it at its coarsest remaining home.",
    ["-"], "§11")
add("six._keyCheck", "_keyCheck(S)",
    "A restored scene whose frame or parts differ from the saved ones — a framing rule changed since the save — gets a new version, so its thumbnails are made again.",
    ["-"], "§11")

# ---- 2026-10-05, the rebuilt tree ----
add("scc._recSlot", "_recSlot()",
    "A record slot in the scene client's per-object columns — width, translation, home — reused from the free list or grown by doubling.",
    ["The main thread keeps three numbers an object in typed columns (DESIGN.md §11)."], "§11")
add("scc._homeIx", "_homeIx(home)",
    "The index of a home frame in the client's home table, added on first use.", ["-"], "§11")
add("scc._sameFrame", "_sameFrame(r, f)",
    "Whether the frame record last sent to the scene worker is still frame f, field by field — a string key per frame per tick was the cost (SC-2).", ["-"], "§11")
