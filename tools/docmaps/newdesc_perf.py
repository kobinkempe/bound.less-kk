# -*- coding: utf-8 -*-
"""Per-function entries for the `performance` branch (2026-10-13 to 10-19): the plate store's RAM tier
(raster/plateCodec.js, raster/plateRam.js; OPEN-FLAGS F161) and the functions the branch added to the paper,
the Stage and the tile store; FIX for those whose bodies it changed since 6efaaf4 (the last pass). Written
2026-10-19."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/plateCodec.js":
        "One plate's pixels packed losslessly for the plate store's RAM tier (OPEN-FLAGS F161): 32-bit words, a run "
        "of three or more equal pixels as two words and every other pixel as itself, so a packed plate is never longer "
        "than the plate plus one word.",
    "src/engine/raster/plateRam.js":
        "The plate store's second tier (F161): level plates evicted from the bitmap tier, kept packed in RAM, oldest "
        "evicted first under a byte budget and an entry cap, so a return to a place restores them off the main thread "
        "instead of packing and rastering them again. Whether an entry is still exact is the store's question: its key "
        "stays tracked by the Stage while it is here.",
}


# ---- src/engine/raster/plateCodec.js ----
add("pcd.encodePlate", "encodePlate(rgba)",
    "Packs one plate's RGBA into 32-bit words: a run of n ≥ 3 equal pixels as `[2n + 1, pixel]`, any other stretch as `[2n, its n pixels]`.",
    ["The words are written into one scratch array of the worst case, kept per thread, and returned as a copy exactly as long as they are, so it can be transferred. The file's header records Kobin's plates 82–117× smaller (median), 0.3–0.7 ms a scan (F161)."],
    "§9")
add("pcd.decodePlate", "decodePlate(buf, rgba)",
    "Unpacks the words into a whole plate's RGBA, and throws unless they make exactly one plate: a short or long plate would draw a wrong picture, not a slow one.",
    ["-"], "§9")

# ---- src/engine/raster/plateRam.js ----
add("prm.PlateRam", "PlateRam",
    "The RAM tier: entries by key, oldest first, their bytes counted, under a byte budget and an entry cap.",
    ["An entry is the plate's cell descriptor, the G its pixels were packed at and its packed words (null for an empty plate); it costs its words plus `RAM_ENTRY_BYTES` (192). `RAM_ENTRIES_MAX` (4,096) caps the count because every entry is a cell the Stage keeps tracking and each commit's dirt is tested against. `delete` takes one out (a restore, a newer plate, a stale one). A budget of 0 turns the tier off."],
    "§9")
add("prm.PlateRam.constructor", "PlateRam.constructor(maxBytes, maxEntries)",
    "The tier with its byte budget (0: off) and entry cap, an empty map and its counters.", ["-"], "§9")
add("prm.size", "size (getter) · has(key) · get(key)",
    "How many entries the tier holds; whether a key has one; the entry.", ["-"], "§9")
add("prm.put", "put(e)",
    "Keeps an entry as the newest, replacing one under its key, and returns what was evicted to make room — the entry itself among them when the tier is off or it alone is over the budget.",
    ["Its bytes are its words' length plus `RAM_ENTRY_BYTES`; the caller untracks the keys it gets back. Counts the puts, the empty plates and the largest entry."],
    "§9")
add("prm.dropWhere", "dropWhere(pred, spare)",
    "A hard drop: every entry a predicate names and `spare` does not, removed and returned (their frame now means another place).",
    ["-"], "§9")
add("prm.setBudget", "setBudget(bytes)", "A new byte budget (0: off), and the entries evicted to meet it.", ["-"], "§9")
add("prm.clear", "clear()", "Every entry out, returned.", ["-"], "§9")
add("prm.report", "report()", "For the report: entries, bytes, the budget, the cap and the counters.", ["-"], "§14")
add("prm._fit", "_fit()",
    "Evicts the oldest entries until both the byte budget and the entry cap hold, and returns them.", ["-"], "§9")

# ---- src/engine/worker/rasterWorker.js ----
add("rwk.runRestore", "runRestore(msg, opts)",
    "One RAM-tier plate unpacked (F161): its words in, `{ kind: \"ram-result\", id, ok, bitmap | pixels, ms }` out, one restore at a time.",
    ["Serialised on a promise chain, because the bitmap path decodes into the one restore scratch and awaits its bitmap before the next. The worker's message handler runs it for a `ram-restore` message; with no worker, `rasterWorkerClient.restorePlate` runs it on the main thread."],
    "§9")
add("rwk.restoreOne", "restoreOne(msg, o)",
    "Decodes the words (`plateCodec.decodePlate`) and returns a bitmap where the scope can make one, else the plate's own pixels, with the time taken.",
    ["-"], "§9")

# ---- src/engine/raster/rasterWorkerClient.js ----
add("rwc.clearOnSlotFreed", "clearOnSlotFreed(fn)",
    "A renderer's teardown lets go of the slot-freed pump it set, only while it is still the one set: module state that had held a closed canvas's renderer and engine (F160).",
    ["-"], "§9")
add("rwc._slotFreedForTests", "_slotFreedForTests()", "TEST: the slot-freed pump now set.", ["-"], "§9")
add("rwc.restorePlate", "restorePlate(bytes)",
    "One RAM-tier plate unpacked off the main thread (F161): its words posted to a worker `ramWorker` picks, taking no slot, or with no worker run on this thread a turn later; resolves `{ bitmap }` or `{ pixels }`, rejects on a failure or after `RAM_RESTORE_MS` (5 s).",
    ["A restore has its own scratch in the worker and runs one at a time there. The words are copied, not transferred: the plate it stores keeps them for its next eviction. With no pool yet, and none broken, it spawns one."],
    "§9")
add("rwc.ramWorker", "ramWorker()",
    "The worker a restore goes to, round robin: one holding no job, else one drawing a strip (the restore runs between its plates), a cut's only when every worker holds one — a cut runs to its end before its worker reads another message.",
    ["-"], "§9")
add("rwc.ramFail", "ramFail(id, w, err)",
    "A restore failed or timed out: its wait removed and its timer cleared, counted, and its promise rejected — once, for the wait still registered.",
    ["-"], "§9")
add("rwc.onRamMessage", "onRamMessage(data)",
    "A restore's answer resolves its wait, the time counted; a failed one rejects it; one nobody waits for any more (it timed out) closes its bitmap.",
    ["-"], "§9")

# ---- src/engine/raster/rasterJob.js ----
add("rjb.checkRuns", "checkRuns(job, n)",
    "Throws unless the row runs and their per-loop index travel together, come three numbers a run, and each loop's runs start at its first record and ascend inside it — runs that do not tile their loops would skip ink with no error (F154).",
    ["-"], "§9")

# ---- src/engine/raster/rasterCore.js ----
add("rco.rowRuns", "rowRuns(kind, geom, subs, gl, per)",
    "An item's row runs (F154): each loop of more than `RUN_PIECES` (16) pieces cut into runs of 16, each with the lowest and highest y its pieces can deposit at and its first record's offset; `subRun` is each loop's first run.",
    ["Read from the item's own geometry, in frame units without the residual; an arc's bulge is in, and the loop's closing edge is in its last run. A loop of 16 pieces or fewer, or one holding a record code the core does not know, gets no runs and is walked whole. A run's first piece starts at the record before it, as the whole walk's does, so a plate that skips the runs missing its rows deposits the whole walk's sums to the bit."],
    "§9")
add("rco.pieceRows", "pieceRows(ax, ay, bx, by, sweep, cx, cy)",
    "The y range one piece can deposit at: a line's ends; an arc's chord grown by its sagitta's y up to a half turn, by twice its radius about its start past one, a whole turn's centre ± radius plus chord; a record drawn as its chord, its chord's; anything non-finite, every row.",
    ["-"], "§9")
add("rco.runMeets", "runMeets(runs, r, ry, Zq, oy, y0, y1)",
    "Can a run deposit in the plate rows [y0, y1)? Its y range mapped as the core maps a point, widened by `RUN_SLACK` (1 device px); NaN reads as yes.",
    ["-"], "§9")
add("rco.runEnd", "runEnd(job, s)", "The run after loop s's last: the next loop's first, or the job's end.", ["-"], "§9")

# ---- src/engine/raster/jobQueue.js ----
add("jbq.restoring", "restoring(n)",
    "A RAM-tier restore begun (+1) or ended (−1): it takes no slot but is the view's work in flight, so the report counts it at the view's priority (F161).",
    ["-"], "§9")

# ---- src/engine/raster/prefetch.js ----
add("pft.cellsOf", "cellsOf(rect, Z)",
    "The level-Z cells a rect meets, as one rect: an off-camera table read over it holds every piece those cells draw (F163).",
    ["-"], "§9")

# ---- src/engine/raster/PyramidStore.js ----
add("pys.ramBudgetBytes", "ramBudgetBytes(cfg, phone)",
    "The RAM tier's budget in bytes (F161): `cfg.plateRamMiB` (0 turns it off), else 64 MiB on a desktop and 24 on a phone.",
    ["-"], "§9")
add("pys.heldStale", "heldStale(rec)",
    "Was a record packed without a drag's held ink (`omitHeld`, that drag's era), and has that drag ended? Such a result is never stored (F153).",
    ["-"], "§9")
add("pys.ramHas", "ramHas(key)", "Does the RAM tier hold a plate for the key, exact or not (`restorable` decides)?", ["-"], "§9")
add("pys.restorable", "restorable(key)",
    "The RAM tier's entry for a key when it can stand for the cell now — still exact (no commit since its G met the cell; its key stayed tracked) and nothing stored or in flight for the key — else null; a stale entry is dropped and its key untracked.",
    ["-"], "§9")
add("pys.beginRestore", "beginRestore(e)",
    "An entry leaves the RAM tier and is in flight as a job of its own, under its own G, until its `put` or `endJob`.",
    ["-"], "§9")
add("pys.setRamBudget", "setRamBudget(bytes)",
    "A new budget for the RAM tier (0: off); the keys of what it evicts are untracked when nothing else holds them.",
    ["-"], "§9")
add("pys.endHeld", "endHeld()",
    "A drag ended: every plate packed without its held ink goes, and such results still in flight are refused when they land; returns the records gone, whose cells must be asked again.",
    ["A drop dirties only its moved boundaries' sweep, so a plate packed without the held ink would keep a hole there (F153). `heldEra` steps, so `heldStale` knows the results of the drag that ended."],
    "§9")
add("pys._toRam", "_toRam(r)",
    "An evicted or released record into the RAM tier (F161): a level plate, exact, not packed without held ink, with its packed words or empty; a patched plate never goes, its words being no longer its pixels.",
    ["-"], "§9")

# ---- src/engine/raster/MovePlane.js ----
add("mvp.colours", "colours(items, s, view, w, h)",
    "Items' colours on the view's cells, grown by w, h each way: colour and opacity → its rgb, its alpha and the area it covers in cells — what a merge's cost is weighed on (F144).",
    ["-"], "§9")
add("mvp.unionRange", "unionRange(a, b)", "The bounding range of two plate ranges, either possibly null.", ["-"], "§9")
add("mvp.pins", "pins()", "Every key the plane pins: its levels' and a refine's.", ["-"], "§9")
add("mvp._cells", "_cells(runs, view, own)",
    "The runs' cells at each resolution, made once a cut and memoised: a run's on the view, over D1's grown view, its margin outside the near layer's cells, every run's (where BELOW is drawn), those holding BELOW's own ink, and the rest (paper).",
    ["`hole(k)` is the near layer's view cells at k; `margin(n, kN, kM)` is a run's grown cells at kM less those wholly inside `hole(kN)`, so the margin is drawn only outside the near layer. `inked(k)` are BELOW's plates and `paper(k)` the cells drawn as paper with no plate (F145); `screen(k)` is the most plates a screen meets at k."],
    "§9")
add("mvp._count", "_count(runs, view, [kB, kN, kM], C)",
    "A cut's plates, the most distinct images a frame draws of them (a SEL layer at most a screen's), and whether any is drawn magnified — what `_cut` tests against the cap and the compose cliff.",
    ["-"], "§9")
add("mvp.refineAt", "refineAt(v, W, H, max)",
    "A held drag refined (F145): each selected run's cells on the screen at this offset, at the sharpest k under its coarsest layer that fits the cap beside the main level, less those its near layer already draws; null when nothing on screen is coarser or nothing fits.",
    ["Kobin, 2026-10-19: what slid in from past the screen stayed blurry while he held it. Once whole a refine is drawn over its run with every coarser SEL layer clipped out of the screen it was cut for, never both, so a translucent run composites once. Its layers are tagged after their run's with `r<k>`."],
    "§9")
add("mvp.setRefine", "setRefine(r)", "Takes a refine (null keeps the one there); its tags join the plane's, dropped with them.", ["-"], "§9")
add("mvp.refineWhole", "refineWhole(store)", "Is the refine's every plate cached and exact? Noted once it is.", ["-"], "§9")
add("mvp.dropQuick", "dropQuick()",
    "Lets the quick level go once the main level is whole: its pins become a refine's room. Returns its tags.", ["-"], "§9")
add("mvp.drawLayers", "drawLayers(lvl)",
    "The layers to draw for a level: the main one's with a whole refine's layers after their runs' near layers.", ["-"], "§9")

# ---- src/engine/raster/PicturePyramid.js ----
add("pyr.planeSurfaces", "planeSurfaces (getter)",
    "Can the plane's layers be drawn from surfaces here — can a 2D canvas be made (in jsdom, a soft one only)? `cfg.planeSurfaces` false turns them off.",
    ["-"], "§9")
add("pyr._planeSurface", "_planeSurface(p, L, recs, b)",
    "A plane layer's surface over its bounding cells, brought up to its records: a cell whose record changed or went is cleared, then each new one drawn at the layer's own grid 1:1 (a BELOW paper cell or empty plate as paper) — so the layer is one image a frame (F145).",
    ["A re-cut that keeps a layer's tag over other cells (a pan) gets new bounds and a new surface; null when no canvas can be made. Drawn magnified, a texel beside one the layer leaves transparent would blend with it — a seam where another layer or the view's plates draw that cell: BELOW's, and a margin's inside its hole (Kobin, 2026-10-19). So BELOW's and a margin layer's edges are copied into those cells (`_planeEdges`); a moved hole redoes every edge."],
    "§9")
add("pyr._planeEdges", "_planeEdges(sf, L, moved)",
    "Around the cells that changed, each cell the layer leaves to another layer or the view's plates is given its drawn neighbours' facing edge texels, `PLANE_EDGE_TEXELS` (2) deep, so a magnified texel next to it blends with its own edge, as a plate drawn alone is clamped at its own.",
    ["For a margin layer only the cells inside its hole count; beside a BELOW paper cell the copy is paper. A diagonal neighbour gives its one corner texel."],
    "§9")
add("pyr._idlePlaneSurfaces", "_idlePlaneSurfaces()",
    "Frees the plane surfaces no layer has drawn for a second (a quick level's once the plane's own is whole).", ["-"], "§9")
add("pyr.prepPlane", "prepPlane(p)",
    "Between drags: a whole plane's layers have their surfaces built now and kept, so a drag's first frame draws them instead of building them there (25–38 ms in Chrome, F145); every other plane surface goes.",
    ["-"], "§9")
add("pyr._freePlaneSurfaces", "_freePlaneSurfaces()", "Frees every plane surface: a resize, the teardown.", ["-"], "§9")
add("pyr._heldStale", "_heldStale(rec)",
    "A result packed without a drag's held ink, landing after that drag (F153): discarded, never held, put or merged; its ask is answered, and a group waiting for its cell asks again, so the group's live path stays up until a valid plate lands.",
    ["-"], "§9")
add("pyr._reaskHeldStale", "_reaskHeldStale(g)",
    "The results a group holds that a drag's end made stale (F153), back to its need and asked for again; returns how many.",
    ["-"], "§9")
add("pyr.heldEnded", "heldEnded()",
    "A drag ended (`PyramidStore.endHeld`): what every open group holds of packs without the held ink is asked for again.",
    ["-"], "§9")
add("pyr.restore", "restore(entries)",
    "RAM-tier entries (`store.restorable`) handed to the renderer's restore; each lands through `onResult` as a job's plate would (F161).",
    ["-"], "§9")
add("pyr.cellBounds", "cellBounds(L)", "A plane layer's bounding cells: its plates' and its paper cells'.", ["-"], "§9")
add("pyr.rectsMinus", "rectsMinus(rs, c)",
    "Rectangles less one rectangle: each one it meets split into the parts above, below, left and right of it — the clip that keeps a layer out of the cells another draws.",
    ["-"], "§9")
add("pyr.rowsOf", "rowsOf(sf)",
    "A plane surface's drawn cells as row runs [i0, i1, j]: the clip that draws BELOW on its own cells only.", ["-"], "§9")
add("pyr.surfaceable", "surfaceable(L, n, b)",
    "Is a plane layer drawn from one surface: more than `PLANE_SURFACE_MIN` (2) drawn plates over at most `PLANE_SURFACE_MAX` (64) cells, under 32 a side (Chrome's canvas: 32,767 px)?",
    ["-"], "§9")

# ---- src/engine/raster/RasterRenderer.js ----
add("rr._armRefine", "_armRefine()",
    "A drag step moved the plane: its refine waits until the drag has held still for `PLANE_REFINE_MS` (250 ms); a later step re-arms it.",
    ["-"], "§9")
add("rr._refine", "_refine()",
    "The drag held (F145): over a whole main level, the quick level let go first (its pins become the refine's room), the selection on screen cut sharper (`MovePlane.refineAt`), pinned, posted, and drawn once whole.",
    ["Nothing unless the plane is dragging at the view's frame and zoom with its main level ready, nor when the refine there was cut at this very offset."],
    "§9")
add("rr._ramRestore", "_ramRestore(entries)",
    "RAM-tier entries restored (F161): each leaves the tier in flight under its own G (`beginRestore`), counted as the view's work, and lands through `onResult` as a job's plate — an empty plate a microtask later, a packed one once a worker has unpacked it (`restorePlate`).",
    ["A failure only ends the job: the cell is asked for at the next step."],
    "§9")
add("rr._ramLand", "_ramLand(recs)",
    "Restored plates landed as an arrival's: each through the pyramid's `onResult` with its job ended, then a landing plane ended when done (or the idle plane kept ready), one compose, and the prefetch while the camera is still.",
    ["-"], "§9")
add("rr._ramCells", "_ramCells(cells)",
    "The level cells the RAM tier holds exact, restored now and taken out of a list, the rest returned (F161): the queue's `restore` at dispatch.",
    ["-"], "§9")
add("rr._ramSplit", "_ramSplit(jobs)",
    "The RAM tier's cells taken out of the prefetch's jobs before they are queued (F161); a job left with none goes.", ["-"], "§9")

# ---- src/engine/raster/rasterPack.js ----
add("rpk.weakOf", "weakOf(x) · sameRef(w, x)",
    "A weak reference to an object (null for none), and whether one still names a given object: how a memo entry knows the geometry it was built from without keeping it alive (F160).",
    ["-"], "§9")
add("rpk.touches", "touches(box)", "Would `add` file a box into any plate of the strip? It files nothing.", ["-"], "§9")
add("rpk.recLive", "recLive(r, o)",
    "Is a prepass record still the item's: its entry not evicted, and its version, geometry and outline still the item's?",
    ["The memo entry's own test, read off the record's strong references: the entry's weak ones cost 60 % of a strip's walk on the Magnum Opus (F162). The record's key, the piece, already holds both."],
    "§9")
add("rpk.sameObj", "sameObj(a, b)", "Two references to one object, or both absent.", ["-"], "§9")
add("rpk.setPackOcclusion", "setPackOcclusion(on) · setRowRuns(on)",
    "TEST levers: the pack's cover cull (F157) and the jobs' row runs (F154), both on unless a test or a measurement turns them off.",
    ["-"], "§9")
add("rpk.marksMeet", "marksMeet(pre, binner, cfg)",
    "Does a pending mark touch the strip? Then the cover cull leaves nothing out: the masks and their slots depend on what is packed.",
    ["-"], "§9")
add("rpk.Covers", "Covers",
    "One strip's plates as the walk goes down from the top family (F157): which a family above hides, how many are still open, and what each one's failed proofs have spent.",
    ["-"], "§9")
add("rpk.Covers.constructor", "Covers.constructor(plates, Zq)",
    "Every plate of the strip open, with its origin in device pixels and nothing spent.", ["-"], "§9")
add("rpk.drawn", "drawn(b, p)",
    "Does a box (frame units, `res` in) meet plate p, edges included — the core's own test? A stroke's box holds its band's.",
    ["-"], "§9")
add("rpk.visible", "visible(drawn)",
    "The family's drawn items some open plate draws, the rest counted out — all of them when only some are and their colours differ, since the copy paints a family with its first packed item's colour.",
    ["-"], "§9")
add("rpk.cover", "cover(f, keep, q, cfg)",
    "Hides the open plates a family covers (`familyCovers`), trying none whose proof budget is spent — `COVER_TRIES` (64) failed proofs or `COVER_NODES` (16,384) proof nodes; returns how many plates are left open.",
    ["Under a cover a plate takes nothing more of the families below it; once every plate of the strip has one, the walk stops (F157)."],
    "§9")
add("rpk.familyCovers", "familyCovers(f, keep, C, p, q, cfg)",
    "Does a family hide plate p where the core's cull would find it? Every item drawn there opaque, one boxing the padded plate, and none with a piece within `COVER_PAD` (1 px) of it: the coverage is then one number, the winding at the plate's centre.",
    ["The deposit over the plate is the fast items' windings plus the union pass's sign where the union items' joint winding is not 0 (a positive-area loop deposits −1, `rasterCore.depositFamily`); the plate is covered iff that is not 0. Returns 1 for a cover, −1 for a proof that failed, 0 for none tried (an item drawn there translucent, or none boxing the plate)."],
    "§9")
add("rpk.plateWinding", "plateWinding(d, Z, ox, oy, q, cfg)",
    "An item's winding about a plate's centre, in the numbers the job ships (its loops, rings or band); NaN when a piece comes within `COVER_PAD` of the plate or a record is one the core refuses.",
    ["Memoised on its record by zoom and plate (at most `COVER_MEMO`, 64), a stroke's by its band too, which `bandFor` may swap for a finer one. The nodes a walk took count against the plate's budget, a remembered walk's too, so a job never depends on the memo."],
    "§9")
add("rpk.proofAt", "proofAt(ox, oy)",
    "Starts a proof at a plate: the plate padded by `COVER_PAD`, its centre, the angle summed so far 0.", ["-"], "§9")
add("rpk.proofWinding", "proofWinding()",
    "The winding the edges' angles add up to, or NaN when they do not close to whole turns.", ["-"], "§9")
add("rpk.chordAngle", "chordAngle(ax, ay, bx, by)", "The signed angle a chord subtends at the plate's centre.", ["-"], "§9")
add("rpk.proofLine", "proofLine(ax, ay, bx, by)",
    "One straight edge into the proof: false when it meets the padded plate (its box does and the plate's corners are not all on one side), else its angle added.",
    ["-"], "§9")
add("rpk.proofArc", "proofArc(ax, ay, bx, by, sweep, cx, cy)",
    "One arc piece into the proof, split as `rasterCore.emitArc` splits it — a whole turn at its antipode, then halves; a node whose chord box grown by its sagitta misses the padded plate adds its chord's angle.",
    ["A node that does not miss is split only while its sagitta is over 2·`ARC_TOL` and its depth under `MAXD`, so it is never deeper than the core's own chords, which then lie inside the nodes found clear. False otherwise, and for a record the core refuses and draws as its chord."],
    "§9")
add("rpk.loopEdges", "loopEdges(geom, subs, rx, ry, Z) · ringEdges(geom, subs, rx, ry, Z)",
    "An item's loops in the job's grammar, record by record as `rasterCore.emitItem` reads them, or its flat rings, each closed as the core closes it, into the proof; false at the first edge that meets the plate or a record the core does not know.",
    ["-"], "§9")
add("rpk.rowBytes", "rowBytes(rows)", "The bytes an item's row runs take, charged to its memo entry.", ["-"], "§9")

# ---- src/engine/Stage.js ----
add("stg.sameRange", "sameRange(a, b) · inside(a, b)",
    "Two plate ranges the same; a rectangle inside another.", ["-"], "§9")
add("stg.geomOf", "geomOf(o) · lookOf(o)",
    "The array a shape's or fill's boundary is read from (replaced, never changed in place, when it changes; null for a stroke), and what a native is drawn with besides its geometry and placement: a drop's sweep needs both unchanged (F153).",
    ["-"], "§9")
add("stg.sweepBoxes", "sweepBoxes(o)",
    "A shape's or fill's boundary pieces boxed in loop order, in home units (F153): level 0 one box a piece, each next level the pairs of the one before merged, the last one box — the tree `_sweepIn` descends; null when it has no piece.",
    ["-"], "§9")
add("stg.sweepBytesOf", "sweepBytesOf(states)", "The bytes of a commit's sweeps' piece trees.", ["-"], "§9")
add("stg.touchedSince", "touchedSince(G0)",
    "The natives touched (`touch`) at a G after G0, or null when the record — the last `TOUCHED_MAX` (256) — does not reach back that far: the ants keep their decision through a commit that touches no selected item (F149).",
    ["-"], "§10")
add("stg._groupBox", "_groupBox(g)",
    "Where a reroute group's natives are drawn in the camera frame, their boxes' union (null when none is), kept until a member changes (`_reconcile`): `covers` skips a group drawing nothing in its rectangle (F152).",
    ["-"], "§9")
add("stg.sourceFrames", "sourceFrames()",
    "The frames the table's reroute groups read moved natives' pictures from: frame GC keeps them (F139).", ["-"], "§8")
add("stg._entryRects", "_entryRects(e, F)",
    "A logged commit's footprints but its sweeps, in frame F (`_rectsIn`), kept for the lattice they were mapped in — the last `RECTS_KEPT` (256) commit-and-frame pairs.",
    ["-"], "§9")
add("stg._meetsIn", "_meetsIn(e, F, box)",
    "Does a logged commit's footprint, its sweeps included, meet a box in frame F?", ["-"], "§9")
add("stg._sweepMap", "_sweepMap(s, G)",
    "A sweep's placement mappers into frame G, before and after, its whole boxes there and room for its tree's hulls there; kept for the lattice they were made in, for `SWEEP_MAPS` (8) frames.",
    ["-"], "§9")
add("stg._unmap", "_unmap(s, m)", "A sweep's mapping into one frame let go: its hulls' bytes given back.", ["-"], "§9")
add("stg._hull", "_hull(s, m, k, i, out)",
    "One node of a sweep's tree in the mapping's frame, where it was and where it is, the two united — remembered in the mapping while the sweep bytes allow.",
    ["-"], "§9")
add("stg._sweepIn", "_sweepIn(s, G, box, any)",
    "A dropped native's dirt in frame G that meets a box (F153): each boundary piece boxed where it was and where it is, the two united, cut to the native's whole box before or after — the union of what meets the box, cut to it, or null; with `any`, exactly whether anything does.",
    ["Between two scale-and-translate placements every changed pixel lies in the boundary's sweep. The piece tree is descended from its root, so only the pieces near the box are mapped; a node inside the box is taken whole, its pieces' cuts lying in its own (more, never less). A side that does not map into G is its whole box."],
    "§9")
add("stg._sweepCells", "_sweepCells(s, G, cells, hit)",
    "`_sweepIn(…, any)` for each cell not hit yet, in one descent of the tree: a commit's dirt over the tracked cells, marking those the sweep reaches.",
    ["-"], "§9")
add("stg._trimSweeps", "_trimSweeps()",
    "Past `SWEEP_BYTES_MAX` (32 MiB) the oldest commits' sweeps become their boxes before and after: more dirt for questions about them, never less.",
    ["-"], "§9")
add("lm.mapperObj", "mapperObj(fromId, toId, below, homeId, toHome)",
    "`mapPointObj` for many points (F153): the displacement shift and the frame path resolved once, then each point taken through the same steps, bit for bit; null where `mapPointObj` is null.",
    ["`fn(x, y, out)` writes `out` and returns it. The placement model's `footprintMapper` maps a drop's sweep with it."],
    "§8")
add("ovl._selUntouched", "_selUntouched(G0, table)",
    "Has no item added, removed or moved, and no native touched, since generation G0 been selected? False when either record does not reach back — what lets the ants' decision stand through a commit about other ink (F149).",
    ["-"], "§10")
add("ts._cellNatives", "_cellNatives(parentId, pr, rec)",
    "The natives of the parent's cell — every frame sharing it (A1 C3) — whose boxes meet the pre-image padded past the seam pad, from the spatial index: a superset of what `classifyUp` keeps, which still decides (F156).",
    ["The index's boxes carry a stroke's half width, as `classifyUp`'s band does. Scanning the whole cell here was 91 % of R4's cull calls, 79 of its 106 up tiles empty (F156)."],
    "§9")
add("stg._rangeKeys", "_rangeKeys(F, r)",
    "The tile keys of a range of frame F, both directions: one array per frame and range, memoised (512), never to be changed by a caller — a camera step no longer builds key strings (F150).",
    ["-"], "§9")


FIX = {
    "rwk.runJob": {
        "why": "a job marked `ram` also packs each drawn plate for the RAM tier (F161)",
        "what": "Rasters every plate of one strip — each inside its clip when the job has clips — into the one RGBA scratch and returns the wired result: bitmaps or pixel copies, the RAM tier's packed copies when the job asks for them, timings, counts, guards and the job's buffers.",
        "long": ["Each plate is serialised (a bitmap awaited, or the bytes copied) before the next is drawn, because the scratch is reused. A plate no item reached after the prune stays null: nothing is drawn there. Times are durations only; receipt-to-start, start-to-finish and serialisation partition the worker's time, so the main thread's queueing subtraction cannot hide a phase.",
                 "A job marked `ram` with no clips also packs each drawn plate (`plateCodec.encodePlate`) from the pixels the worker already holds, for the store's RAM tier (F161); the result carries the time as `encodeMs`.",
                 "Exported because `rasterWorkerClient`'s inline path runs it on the main thread; jsdom always takes that path."]},
    "rjb.wireJob": {
        "why": "the job carries `ram` and, optionally, row runs (F154, F161); the array count named was wrong",
        "what": None,
        "long": ["The message carries `kind: \"raster-job\"`, the ids and zoom scalars, `ram` (the plates' packed copies are wanted, F161) and the typed arrays — the clips and the row runs (`runs`, `subRun`, F154) when the job has them. Each buffer is listed once, so nothing is copied and the main thread keeps no live view of a buffer the worker now owns."]},
    "rjb.validateJob": {
        "why": "row runs are checked too (`checkRuns`, F154)",
        "what": "Throws on a job whose layout would paint a wrong picture silently: short arrays, a bad kind, spans past the data, families out of paint order, sub-chains not ascending, a clip outside its plate, row runs that do not tile their loops.",
        "long": ["Checks the item count, each array's length against it, one integral clip box inside its plate per plate (when the job has clips), and per item its kind, its geometry and `subs` spans, at least one sub-chain, family indices ascending, and every sub-chain offset ascending and inside the item's span; with row runs, `checkRuns`. The core reads a sub-chain's end from the next entry, so a short or unordered table reads a length as an offset and the ink disappears with no error. No geometry is read."]},
    "rjb.wireResult": {
        "why": "the result carries the RAM tier's packed plates and the encode time (F161)",
        "what": "Packs a worker's result as the message to post with its transfer list: plate bitmaps or pixels, the RAM tier's packed plates, the clips, the Stage generation `G`, timings, counts, guards and the job's buffers handed back.",
        "long": ["Nulls, an empty plate's bitmap, are skipped, and each buffer is listed once, the packed words' too. An ImageBitmap is serialisable as well as transferable, so one left out of the list is copied, 1.05 MB a plate, instead of moved."]},
    "rjb.unwireResult": {
        "why": "the packed plates and the encode time have defaults too",
        "what": "The result the main thread reads from a worker's message, with defaults for the packed plates, the recycled list and the serialisation and encode times.",
        "long": ["-"]},
    "rco.emitItem": {
        "why": "with row runs a run that misses the plate's rows is skipped (F154)",
        "what": None,
        "long": ["Walks each sub-chain between its `subs` offsets and closes it back to its start. With row runs (`job.runs`, F154) a loop is walked run by run and a run whose rows miss the clip is skipped; each run starts from the record before it, so the edges deposited are the whole walk's, and the closing edge is the last run's.",
                 "A point maps as (x + res)·Zq − the plate origin: the residual is added before the scale and the exact integer origin subtracted after, so two neighbouring plates describe a shared point to the last bit. Loop records are read by code, lines and cut lines as edges, arcs and cut arcs through `emitArc` with the scale-only coordinates. Returns the edges deposited."]},
    "rco.loadUnionItem": {
        "why": "it skips the row runs that miss the band, like `emitItem` (F154)",
        "what": None,
        "long": ["The same record walk and coordinate mapping as `emitItem`, its row runs that miss the band skipped, with arcs flattened in union mode, so every plate loads the same edges."]},
    "rwc.terminateWorkers": {
        "why": "every RAM restore still waiting fails",
        "what": "Terminates every worker and forgets the pool, reporting nothing; every RAM restore still waiting fails (\"terminated\").",
        "long": None},
    "rwc.onMessage": {
        "why": "a RAM restore's answer goes to `onRamMessage`",
        "what": "A worker's answer: a cut's result goes to `onCutMessage` and a RAM restore's to `onRamMessage` (it holds no slot); otherwise frees the slot, returns the job's buffers to the pool, derives the timings, totals the guards and counts, and calls `onResult`.",
        "long": None},
    "rwc.rasterWorkerReport": {
        "why": "the report carries the RAM restores",
        "what": "The worker client's report: mode, worker counts, in-flight size, held slots, job and cut totals, bytes, timings, the guard and count totals, the buffer pool and the RAM restores (counts, time, waiting).",
        "long": None},
    "jbq.JobQueue.constructor": {
        "why": "the queue takes the RAM tier's `restore`",
        "what": "A queue over a pool (`size`, `free`, `submit`), with the store's `wants`, the purpose generations, the drop callback and the RAM tier's `restore` (F161).",
        "long": ["-"]},
    "jbq.pump": {
        "why": "past the budget a later task is asked for while the camera moves too (F140)",
        "what": "Dispatches while there are free slots and strips that may run now, within the pack budget; past it the rest wait for a later task (`_nextTask`), unless a camera step starts the budget first (F140).",
        "long": ["-"]},
    "jbq._nextTask": {
        "why": "while the camera moves the task comes MOTION_STALE_MS after its last step (F140)",
        "what": "A later task starts the pack budget again and pumps what waits: the next task at rest; while the camera moves, the one `MOTION_STALE_MS` (50 ms) after its last step, put off again by a newer moving step, since a step starts the budget itself (F140).",
        "long": ["-"]},
    "jbq._admit": {
        "why": "cells the RAM tier holds are restored instead of packed (F161)",
        "what": "At dispatch: a strip whose purpose moved on is dropped, a view strip is aimed at the camera's arrival, cells already exact or exact in flight are skipped, and cells the RAM tier holds are restored instead (F161); a strip left with nothing is dropped.",
        "long": ["-"]},
    "jbq.report": {
        "why": "RAM restores in flight count as the view's",
        "what": "For the report: strips queued and in flight by priority (RAM restores counted as the view's), the mean job time, the frame's pack time and the counters.",
        "long": ["-"]},
    "pft.prefetchPlan": {
        "why": "the off-camera reads cover every cell they pack (F163); RAM-tier cells need no table (F161)",
        "what": None,
        "long": ["The near levels pack from the live table, the cells it covers only. The far levels are the view zoomed out 4^k about its centre (k = 1…11, 22 octaves: Kobin's bacteria-to-ladybird gesture is 22.5), three octaves under that view's level over 2.5 of its screens, in the parent and grandparent frames once the level is coarser than the frame's own; they and the crossing target are read off camera through `stage.snapshot` within 8 ms, and a job carries its table. A read past its budget is skipped this time; its tiles stay cached for the next (DESIGN.md §9, A3 §4.3).",
                 "Each off-camera read is over every cell it packs (`cellsOf`): over the screens alone it missed what lay past them in cells up to 4× wider (F163). A cell the RAM tier holds needs no table and is taken without one; a far level whose wanted cells are all in the tier is taken with no read at all (F161)."]},
    "pys.PyramidStore.constructor": {
        "why": "the store has a RAM tier (F161) and a held-ink era (F153)",
        "what": "The cache with its freshness source (the Stage; none: every record exact), its byte budget, its RAM tier (F161: off until `setRamBudget`, unless `ramBytes` is given), the held-ink era (F153) and the `visibilitychange` listener: a phone releases at once when hidden, a desktop after five minutes.",
        "long": ["-"]},
    "pys.put": {
        "why": "a result packed without an ended drag's held ink is refused (F153); a kept plate supersedes the RAM tier's",
        "what": "Rule 1: an arriving plate is kept iff nothing is stored or its G is newer; an older, equal or refused one is closed — refused includes one packed without a drag's held ink after that drag ended (F153). A newer one still behind the dirt is kept and counts as stale (F106).",
        "long": ["The record is tracked by the Stage from its own G, so a commit that landed while it was in flight leaves it stale at once. A plate kept supersedes the RAM tier's entry for its key and carries its packed words for the tier (F161)."]},
    "pys.patch": {
        "why": "a patched record leaves the RAM tier's path; a patch can be packed without held ink",
        "what": None,
        "long": ["A patch landed in a record: its new pixels, and its G raised when the patch's clip holds every dirty rectangle since the record's G; the old bitmap closed.",
                 "A patched record's packed words are its old pixels, so they are dropped and it never goes to the RAM tier (F161); a patch packed without a drag's held ink marks the record so (F153)."]},
    "pys.dropWhere": {
        "why": "`toRam`: what it removes goes to the RAM tier; otherwise the tier's entries go too",
        "what": None,
        "long": ["Refused by job, not through the in-flight map: a job a newer one for the same key overtook is no longer in it, and its result must still land nothing.",
                 "With `toRam` (the hidden-tab release) what it removes goes to the RAM tier; otherwise the tier's entries the predicate names go too (F161)."]},
    "pys.release": {
        "why": "what it releases goes to the RAM tier (F161)",
        "what": "The hidden-tab release: every record but the view frame's ℓv − 2 plates, into the RAM tier where it takes them (F161), so the return is never paper; the picture is told, so it drops its surface too.",
        "long": None},
    "pys.report": {
        "why": "the report carries the RAM tier's",
        "what": "For the report: plates and bytes, the cap, the pinned and stale counts, in flight, the tracked keys, every counter and the RAM tier's report.",
        "long": ["-"]},
    "pys._evict": {
        "why": "an evicted level plate goes to the RAM tier (F161)",
        "what": "Evicts until the cap holds — by rank, then among other levels the farthest from the view's, then least recently used; never a pinned record (a cap the pins exceed is counted). What it evicts goes to the RAM tier where it takes it (F161).",
        "long": ["-"]},
    "pys._remove": {
        "why": "`toRam` puts the record in the RAM tier first",
        "what": "Takes a record out — into the RAM tier first when `toRam` — and closes its bitmap: the only path that closes a stored one; it is marked dead first, so a compose holding it draws nothing.",
        "long": ["-"]},
    "pys._untrackIfIdle": {
        "why": "a key the RAM tier holds stays tracked",
        "what": "A key neither stored, nor in flight, nor in the RAM tier leaves the Stage's tracked set.",
        "long": ["-"]},
    "mvp.idsHash": {
        "why": "the body is not FNV-1a (an entry carried from before 56e36b3)",
        "what": "An order-free name for an id set: the sum and the xor of each id's 32-bit mix, and the count — the part of a layer's tag that names its members.",
        "long": ["-"]},
    "mvp._reset": {
        "why": "the plane has a refine; its ranges are in the view's cells",
        "what": "Empties the plane — selection, list, the levels and a refine, the drawn level, layers, tags, keys, ranges, offset, landing times — sets it idle and bumps `gen`.",
        "long": ["The caller compares `gen` to know it must free the old layers' plates. `layers`, `r` and `selR` mirror the main level, the ranges in the view's cells; `tags` cover every level and a refine, `keys` both levels (a refine's are its own: `pins`). A small selection's stopgap is the renderer's (`_pyrStopgap`), not the plane's."]},
    "mvp.cellCount": {
        "why": "a refine's plates count",
        "what": "The number of plates the plane pins, a refine's included.",
        "long": ["-"]},
    "mvp.aim": {
        "why": "a new compose cliff re-cuts too",
        "what": None,
        "long": ["Does nothing while dragging or landing. A new selection key, frame or zoom resets it, and with no selected ids it is refused; a new list, id set, cap, plate range or compose cliff (`cliff`: the most images a frame may draw with one scaled, Infinity when each layer is drawn from one surface) under the same selection re-cuts it, so a pan keeps the plates of every layer whose members are unchanged."]},
    "mvp._cut": {
        "why": "the merge weighs colours (F144); each layer has its own resolution, tried sharpest-under-first (F145)",
        "what": "Cuts the plane: groups the pack's families in paint order into selected and unselected runs, merges past the layer cap by the swap that shows least, and picks the main level's resolutions — under it, the selection, its margin — and a quick level under it.",
        "long": ["Families come from `rasterPack.paintFamilies`, so the layers split exactly where the pack paints; a family with no item box on the view's plates is skipped — a selected one counts on the view grown by its own size each way (D1) — and unselected families below the first selected run stay in BELOW.",
                 "Past `MOVE_PLANE_LAYERS` (5) a selected run is drawn on the other side of an unselected run beside it, lifted over it or dropped under it, the pair whose swap shows least: Σ area · area · α · α · |ΔC| over their colours on the view (F144; counted in `merged`). The resolutions are the first of `CUTS` — what the selection moves over sharpest first, then the selection on screen, then its margin, each 0 to 3 octaves under the view — that fits the plate cap and, when a plate is drawn magnified, the compose cliff, nothing on screen coarser than one resolution for all would be (F145); else that one, counted in `overCap`.",
                 "A plane of more than 4 plates also gets a quick level 2 octaves under the main's coarsest layer on screen, kept when it has fewer plates, fits the cap with the main and the cliff. Refused only when no selected ink is on screen."]},
    "mvp._level": {
        "why": "a layer has its own resolution; a SEL run may be a margin and a near layer; BELOW's paper cells (F145)",
        "what": "Builds a level's layers cut `[kB, kN, kM]` octaves under the view (BELOW and OVER, a selected run on the view, its D1 margin): each layer's cells, grid, tag and keys, the plates, the feet, and the bounding ranges.",
        "long": ["With kN < kM a selected run is two layers: its margin, drawn only outside the near layer's view cells (`hole`), then the near one (F145). BELOW holds the cells with its own ink, and the cells under the runs with none of it are paper, drawn with no plate. A BELOW or OVER plate's `foot` holds a view cell the selection starts on: a partial level and the stopgap draw those alone.",
                 "A layer's tag is `z<n>[m]_<k>_<members hash>`, so a re-cut that changes a run's members or a layer's resolution is a new layer and never reuses the old plates. The ranges are in the view's cells: BELOW's with its paper (`r`), the selection's (`selR`), the far layers', more than two octaves under (`farR`). `k` is the coarsest layer's, `kOn` the coarsest on screen's."]},
    "mvp.farLevels": {
        "why": "a level is far when any of its layers is (`farR`), not by its coarsest k",
        "what": "The drag plane's levels with layers whose plates overhang the camera's table — more than two octaves under the view, so one packed from the table would hold paper where ink is (REVIEWER-4 P-2); each gets its own table over its far layers, read at idle.",
        "long": ["The camera's table reads four view cells past the screen (A3 §4.2) and a plate k octaves coarser spans 2^k of them. Until its table is in (`listPending`) those layers are left out of the plane's requests."]},
    "mvp.coverOf": {
        "why": "it covers the level's far layers only",
        "what": "The rectangle, in frame units, a level's far layers' plates cover.",
        "long": ["-"]},
    "mvp.requests": {
        "why": "a refine's layers are asked for too; only a far layer waits for, and carries, its own table",
        "what": "One request per layer, the quick level's first and a refine's last — BELOW with its omitted ids, the others with only their own ids on transparent paper — or null when refused or landing.",
        "long": ["Each carries its layer's own zoom, its tag and its cell list instead of a range; a far layer (more than two octaves under) carries its level's own table (`list`, at the Stage generation `G` it was read at) and is skipped while that table is still being read."]},
    "mvp._whole": {
        "why": "each layer's plates are keyed at its own zoom",
        "what": "Whether every plate of a level, or of its selected layers only, is cached, live and exact (`store.exact`), each layer's keyed at its own zoom.",
        "long": ["-"]},
    "mvp.landCells": {
        "why": "the level's ranges are in the view's cells now",
        "what": None,
        "long": ["Uses the drawn level (`cur`, else the main one), whose ranges are in the plane's view cells, mapped into `v`'s grid by the zoom ratio, and adds the drag offset in view plates."]},
    # ---- PicturePyramid ----
    "pyr.PicturePyramid.constructor": {
        "why": "the RAM tier's restore hook and the plane's surfaces",
        "what": "Sets up the view object, the purpose generations, the hooks it is given (requests, the pack, the RAM tier's restore), the estimate's constants (cfg or `EST_DEFAULTS`, calibrated online), the integrals and counters and the plane's surfaces, and mounts the ink canvas.",
        "long": ["-"]},
    "pyr.setSize": {
        "why": "the plane's surfaces are freed too",
        "what": "A resize or a dpr change: the canvas follows, the rest set goes (A3 §2.4), the surfaces are freed (the plane's too) and the screen's bounds are recomputed.",
        "long": ["-"]},
    "pyr._dirtyIn": {
        "why": "the dirt is asked of the Stage for the plate's box (F153)",
        "what": "The dirty rectangles since a plate's G that meet its tracked box, asked of the Stage for that box (F153): their bounding box grown by a pixel and clipped to the cell, with its area; null when the Stage's log does not reach back.",
        "long": ["-"]},
    "pyr._planePlan": {
        "why": "a layer has its own grid and may be one surface; BELOW's paper cells; the footprint is each layer's `foot`",
        "what": None,
        "long": ["A partial plane (the selection's layers whole, the rest not) is drawn only when BELOW covers the selection's start footprint (each layer's `foot`), which hides it where it was; else nothing is drawn and the selection stays in place — never the selection twice (H4, DESIGN.md §9).",
                 "Each layer is read at its own grid; one of enough plates is drawn from a surface and counts as one image (`surfaceable`, F145). BELOW's paper cells go with its records, and the base cells it replaces include them."]},
    "pyr._paintPlane": {
        "why": "layers drawn from surfaces, clipped out of their hole and a whole refine's screen; BELOW on its own cells (F145)",
        "what": None,
        "long": ["The plane after the base, in paint order — BELOW, the selection translated by the drag, OVER; while landing, clipped to the cells whose base is not exact yet.",
                 "A layer is drawn from its surface (`_planeSurface`) when it has one, else plate by plate at its own grid. A margin layer is clipped out of its near layer's cells and a coarser selected layer out of a whole refine's screen, so a translucent run composites once; BELOW, whose surface carries copied edge texels past its cells, is drawn on its own cells only. The surfaces no layer drew for a second are freed after."]},
    "pyr.onResult": {
        "why": "a result packed without an ended drag's held ink is discarded (F153)",
        "what": "A result from the workers or the inline executor: one packed without a drag's held ink after that drag ended is discarded (F153); a rest cell of a discarded set is closed; one a group waits for is held aside when it counts — packed at or after the group's G, or exact at landing; a patch is merged into its record; anything else is put (rule 1).",
        "long": None},
    "pyr._take": {
        "why": "a held-stale result is discarded; a patch carries its held-ink mark (F153)",
        "what": None,
        "long": ["A patch older than its record, or with no record to land in, is a miss. A patch whose clip is the whole plate is put as a plate. A result a drag's end made stale is discarded (F153), and a patch carries its held-ink mark to its record."]},
    "pyr._commitGroup": {
        "why": "held-stale results are asked again first; `committed` counts what was taken (F153)",
        "what": "Every held result put or merged at once, one compose, then `onCommit` — one task, so no frame shows both or neither; a group holding results a drag's end made stale asks for them again first and commits later (F153).",
        "long": ["`onCommit` counts only the results taken, not those refused or stale. A timed-out group commits what it has."]},
    "pyr._requestView": {
        "why": "cells the RAM tier holds exact are restored, not asked (F161)",
        "what": "The view's missing cells at its level — under the rest cells the rest set lacks, in rest mode — restored from the RAM tier where it holds them exact (F161), the rest asked for at priority 1.",
        "long": ["-"]},
    "pyr.destroy": {
        "why": "the plane's surfaces are freed too",
        "what": "Stops the patch step and the rest timer, frees the surfaces (the plane's too), drops every group and removes the ink canvas.",
        "long": ["-"]},
    # ---- RasterRenderer ----
    "rr._aimPlane": {
        "why": "the cliff is none when layers are drawn from surfaces (F145); a refine's keys are pinned",
        "what": None,
        "long": ["Under the `forcePerStepDrag` test hook it ends any plane and returns false. Otherwise it pulls the selection through `_planeFn` and calls `MovePlane.aim` with the compose cliff — none when the pyramid draws each layer from one surface (F145); every old tag the plane no longer carries — all of them after a reset or a refusal, a renamed layer after a re-cut — is dropped from the queue and the store. Pins the plane's keys and a refine's (`pins`) with `setPlanePins`, or clears them on a refusal; lists its far levels and posts what the plane lacks (`_postPlane`)."]},
    "rr._planeStep": {
        "why": "a step that moves the plane arms its refine; a refine's wholeness is checked (F145)",
        "what": None,
        "long": ["Under a drag, a plane with no layers, at another frame, or in a view that cannot carry it is lost (`_losePlane`); otherwise it moves by the pointer's displacement from the drag's start, a step that moves it arms the refine (`_armRefine`), and any plane plate a change staled mid-drag is posted again.",
                 "The drawn level is `MovePlane.pick`'s: the main level whole, else the quick one whole, else the selected layers of either alone (partial). Under a drag with no whole level, `_pyrStopgap` rasters a small selection here and the level is picked again; a refine is checked for wholeness. Only a whole level sets `_dragOmit`, which makes every other pack leave the selection out; while partial the plates still show the ink where it was. The pyramid draws the plane through `setPlane` (`_pyrPlaneOf`). Counts the steps drawn not ready, partial and from the quick level."]},
    "rr._planeIdle": {
        "why": "a whole plane's surfaces are built here, at rest (F145)",
        "what": None,
        "long": ["Unchanged means the same frame, zoom quantum and view revision, a pan included; the code records 938 plates posted over a 60-step pan in Kobin's Chrome when each pan step re-cut the layers. A commit in the last `PLANE_QUIET_MS` (`_commitAt`) means a change is still settling. A plane aimed at another frame or zoom quantum is ended at once; otherwise one timer re-checks after `PLANE_QUIET_MS`.",
                 "A plane whose main level is whole has its layers' surfaces built here (`PicturePyramid.prepPlane`), not in the next drag's first frame (F145). Does nothing under `forcePerStepDrag`, after a refused drag, or during a drag. Also called from `_pyrLand`, since landed plates arrive without a camera step."]},
    "rr._endPlane": {
        "why": "the refine's timer is cleared too",
        "what": "Takes the plane down: records the landing's length, clears its timers (the landing's and the refine's), drops its plates and pins, resets it and tells the pyramid.",
        "long": None},
    "rr.endMove": {
        "why": "a drag's end drops the plates packed without its held ink (F153); its callers",
        "what": None,
        "long": ["Clears `_noPlaneDrag` and `_dragOmit` first, so the drop's render packs the moved ink, and drops every plate packed without the held ink: their cells are asked again, and what an open pen-up group holds of them too (`PyramidStore.endHeld`, `PicturePyramid.heldEnded`, F153). A drop lands the plane only when it was drawing the drag from a whole level (`cur` set and not partial, the quick level included); a timer ends the landing at `MOVE_HOLD_MS` + 20 ms and recomposes. A drop drawn partial or from the stopgap, a cancel, a delete or a deselect ends it at once.",
                 "Called from the engine's `_endMove` and `_dropHold`."]},
    "rr.destroy": {
        "why": "the slot-freed pump and the pack memo are let go (F160)",
        "what": "Tears down the raster path: empties the job queue, unhooks the pyramid and the Stage, clears the timers, abandons in-flight jobs, stops the pool, lets go of the slot-freed pump and the pack memo (module state that held a closed canvas, F160) and the perf recorder, then destroys the live stroke and every screen layer.",
        "long": None},
    "rr._pyrBuild": {
        "why": "the RAM tier's budget and restores (F161); the slot-freed pump kept for the teardown (F160)",
        "what": None,
        "long": ["It also subscribes to the Stage's commits: a shape that landed in a commit opens its group first, before any patch step could publish its plates while the live path is still up (A3 §3.6), and the commit's patch step is made due in its task. A slot an orphaned answer frees pumps the queue; that pump is kept so `destroy` can let it go (F160).",
                 "The store's RAM tier gets its budget (`ramBudgetBytes`), and the pyramid and the queue the RAM restores (`_ramRestore`, `_ramCells`; F161)."]},
    "rr.onLevers": {
        "why": "the RAM tier's budget follows the levers too",
        "what": "A Dev lever changed (A3 §8): the plate budget and the RAM tier's are applied, one eviction pass each; a step change is the next view's.",
        "long": ["-"]},
    "rr._pyrMotion": {
        "why": "the pan velocity leaves out the zoom's own translation (F152)",
        "what": None,
        "long": ["The velocity drives the queue's velocity rule — skipping cells the camera will have left by a strip's arrival — and the re-aim of a view strip at the level the camera is heading to (DESIGN.md §9). The pan velocity is what is left of the translation once the zoom about the attention point is taken out: counted as pan, a zoom's own translation dropped every view strip as off screen (F152)."]},
    "rr._pyrPrefetch": {
        "why": "what the RAM tier holds of the plan is restored, not queued (F161)",
        "what": None,
        "long": ["The scene must be idle too: the plan waits for the rest's quiet after the last commit, because a bake commits every few frames and a plan per commit re-rendered the coarser levels each step (P5). A new plan supersedes the queued one by generation. Its off-camera tile reads are warm, so they survive crossings (F83: the zoom back in baked 19–22 tiles without it, 9–10 with it). A report being sent plans nothing.",
                 "What the RAM tier holds of the plan is restored instead of queued (`_ramSplit`, F161)."]},
    "rr._pyrPack": {
        "why": "a pack that leaves the held ink out is marked (F153); whole level plates are packed for the RAM tier (F161)",
        "what": None,
        "long": ["A plane layer packs its own members (`only`) or everything but them (`omit`); any other pack leaves the dragged selection out while the plane draws the move, and is marked so (`omitHeld`, the store's held era: such a plate goes at the drag's end, F153). A clipped job packs only what meets its clips (PLAN §5.18). A job of whole level plates with no held ink left out asks for the plates' packed copies, for the RAM tier (`ram`, F161). The pack's prepass and item costs calibrate the pyramid's estimate (A3 §2.2). `jobId` null: the inline executor's."]},
    "rr._pyrResult": {
        "why": "a record carries its packed copy and its held-ink mark",
        "what": "A strip's result: one plate record per cell — a whole plate's pixels made an image bitmap first where the scope can, a clip kept as the patch, its packed copy and held-ink mark with it — then landed in an `arrival` perf row.",
        "long": None},
    "rr._pyrLand": {
        "why": "a dragging plane checks its refine too",
        "what": None,
        "long": ["The plane composes on its own plates' arrival; a landing plane ends on the last fresh plate under it; a dragging plane picks its best level again and checks its refine (DESIGN.md §9)."]},
    "rr._pyrPlaneOf": {
        "why": "the layers are `drawLayers`'s; a whole refine; the view's zoom instead of one Zp",
        "what": "The drag plane as the pyramid draws it (A3 §6): the drawn level's layers — the main one's with a whole refine's after their runs — and that refine, with the plane's state, partial flag, frame, view zoom and offset read live.",
        "long": ["-"]},
    "rr._pyrStopgap": {
        "why": "each layer at its own grid and footprint; a far layer packs from its level's table",
        "what": None,
        "long": ["Bounded by STOPGAP_OBJECTS selected objects and STOPGAP_PLATES plates; each layer at its own grid and footprint (`foot`), a far layer packed from its level's own table; its time is counted in the plane's stats."]},
    # ---- rasterPack ----
    "rpk.entryLive": {"why": "gone: replaced by `recLive` (F162)", "what": None, "long": None},
    "rpk.clearPackCaches": {
        "why": "a renderer's teardown calls it too (F160)",
        "what": None,
        "long": ["Each entry is marked dropped, so a family still holding one refills. A renderer's teardown calls it — the memo is module state, and it held a closed canvas's pieces (F160) — and the tests and the bench probes between runs."]},
    "rpk.touch": {
        "why": "it takes the entry alone: the LRU is keyed by entries",
        "fn": "touch(e)",
        "what": None,
        "long": None},
    "rpk.evict": {
        "why": "the memo is a WeakMap now; the cap walks `LRU` (F160)",
        "what": None,
        "long": ["An evicted entry is marked `dropped`, so the families holding it refill and `charge` stops counting it. The memo is a WeakMap from piece to entry, so no entry keeps its piece alive — as a Map keyed by the pieces it held ~560 MB for its 64 MiB count (F160) — and a WeakMap cannot be walked, so the cap walks `LRU`, the entries oldest first."]},
    "rpk.build": {
        "why": "the entry holds its geometry and outline by weak reference (F160); row runs",
        "what": None,
        "long": ["Hands the item to `buildShape`, `buildFill` or `buildStroke`; a shape or fill not refused then gets `e.union` from `ringsNeedUnion` and `e.area`, the sum of its rings' signed areas, which `unionSignOf` weighs the family's sign with. No coordinate is copied here; that is `flattenGeom`, on the first plate that keeps the item, and its row runs `geomOf`'s. The entry records `_ver` and, by weak reference, the geometry array and `_outline` as its identity (F160)."]},
    "rpk.entryFor": {
        "why": "an entry evicted while its piece lived on is rebuilt; the identity is read through weak references",
        "what": None,
        "long": ["The Stage's items carry the Document's own natives, which an edit mutates in place with a `_ver` bump, while the idle fitter sets `_outline` with none, so all three make the identity, the geometry and the outline compared through the entry's weak references. A move must not rebuild: the placement's offset changes without a bump (OPEN-FLAGS F55), which is why the box is memoised without `res`. An entry evicted while its piece lived on is built again; a replaced entry is marked dropped and its bytes subtracted; a hit moves to the young end of the LRU order."]},
    "rpk.itemChords": {
        "why": "the memo's step is a quarter octave of Z",
        "what": "One item's estimated chords at zoom Z, memoised on its entry per quarter octave of Z.",
        "long": None},
    "rpk.bandFor": {
        "why": "a dropped band takes its row runs' bytes with it; two bands, not quanta",
        "what": "A stroke's fillable rings at one zoom, flat and wound positive, memoised on its entry per quarter octave of `Zq`.",
        "long": ["Flattened at 1/16 device px: from `_outline` through `flattenLoops` when the stroke has been fitted, else as `strokeStripNear`'s round-joined band along the line the SVG renderer strokes, which is the curve through the samples flattened by `flattenCurve` for a stroke `strokeCurved` accepts and the points themselves for a derived piece. Every ring is wound positive, so two bands of one family never cancel. Returns the geometry, offsets, box and the rings' own area, which the family sign sums; null for a refused entry, a non-stroke or an empty band.",
                 "The key comes from `Zq`, never from `q` (the parameter is unused): sync and settle requests carry the camera's exact zoom under one `q`, and a band keyed on `q` was measured 1.0 device px off at a 4× sync zoom (OPEN-FLAGS F77). A cached finer band serves a coarser request, never the reverse; at most two bands are kept per stroke, the older dropped first with its row runs' bytes."]},
    "rpk.add": {
        "why": "index −1 only answers (`touches`)",
        "what": "Files an item index into every plate of the strip its box touches — within the plate's clip when it has one — and returns whether it touched any; with index −1 it files nothing and only answers (`touches`).",
        "long": ["-"]},
    "rpk.prepassFor": {
        "why": "a zoom met first borrows another's records (F162); the families holding a pending mark are listed",
        "what": None,
        "long": ["Applies `only`/`omit`, drops fully faded items (counted), groups the rest by `renderIdOf`, sorts the families by (z, render id) as the SVG renderer stacks them, and fills each (`famAdd`). Each item's record (`recFor`) is kept per render key (zoom, dpr, cfg, offset) and reused by the next list, a subset (`only`/`omit`) reading the whole list's; a family whose records are the same takes its union rule and sign from the last list (`sameRecs`). Memoised per list as well, so the strips of one request walk the families once; before it a strip cost 25 ms before its first plate on the Magnum Opus's 15,192 pieces (jsdom).",
                 "A zoom met first borrows the records of another with the same dpr, cfg and offset: of a record only the fade moves with the zoom, and `recFor` checks it (F162); not its families, since a stroke's band weighs the union sign at each zoom. The families holding a pending mark are listed for the cover cull (`marksMeet`)."]},
    "rpk.recFor": {
        "why": "liveness is the record's own (`recLive`, F162); the record carries the cover proofs' memo",
        "what": None,
        "long": ["A kept record does not touch the memo's LRU: a delete and a set per list item was most of a 26 ms prepass on the dense drawing. Its liveness is read off its own strong references (`recLive`, F162), and it carries the cover proofs' memo (`cov`)."]},
    "rpk.packJob": {
        "why": "the walk goes from the top family down with the cover cull (F157); row runs ship (F154)",
        "what": None,
        "long": ["From the pre-pass, each family is refilled if stale, its items culled by the binner (no coordinate copied for one that misses; a plate's clip honoured), and, for a family with anything on the strip, its union rule (`familyUnion`) and sign (`unionSignOf`) taken once over all its items. A landed pending mark is not painted as ink: it becomes a mask slot, and every item under it carries the slot's bit (`maskSlots`), so the core erases what the rule says (DESIGN.md §7). Then each kept item's geometry is found (`geomOf`), the arrays are allocated once from the pool, and each item is written: family index, spans, flags, box with `res`, `res`, pen width, alpha, and the family's union sign on a union item.",
                 "The walk goes from the top family down: unless a pending mark meets the strip, what a cover hides in every plate it is drawn in is left out (`Covers`, F157), and the walk ends once every plate has one — the core paints from its cover up. The items' row runs go into the job's `runs` and `subRun` (F154). The cull, the geometry and the copy are timed (`cullMs`, `geomMs`, `copyMs`).",
                 "A family paints with its first drawn item's colour and alpha; an item that disagrees is counted and logged. Every array is the job's own copy, because `wireJob` transfers and so detaches them. The job carries the Stage generation `G` it was packed at. `opts.offset` shifts every item's `res` to put an arbitrary rectangle on one plate (the Scenes pictures) without touching a memo. A strip nothing reaches gets an empty job."]},
    "rpk.geomOf": {
        "why": "the geometry's row runs are made and charged here (F154)",
        "what": None,
        "long": ["For a shape or a fill it copies the coordinates into the entry on first use (`flattenGeom`). With row runs on, the geometry's runs (`rasterCore.rowRuns`, F154) are made once — a band's with the band — and charged to the entry."]},
    # ---- Stage ----
    "stg.Stage.covers": {
        "why": "a reroute group drawing nothing in the rectangle is skipped (F152)",
        "what": None,
        "long": ["A pack refuses a cell whose tiles the table does not cover and is asked again once covered (F119); the patch step skips such a cell (DESIGN.md §9). A reroute group whose natives are drawn nowhere in the rectangle is skipped (`_groupBox`, F152), except under a drag's hold, which draws held natives at its delta."]},
    "stg.track": {
        "why": "a cell's dirt is complete after its `from`: only an older `sinceG` reads the log",
        "what": None,
        "long": ["A picture read at an older G (a snapshot read before a change, A2 §3.3) looks the commits since then up in the dirt log, so its plate is stale at once rather than taken for exact. A cell's `dirty` holds every commit after its `from`, so only a `sinceG` older than that reads the log: a RAM-tier key (F161) is tracked again often."]},
    "stg.dirtyRects": {
        "why": "it answers for a box, a drop's sweep as its dirt there (F153)",
        "what": "The footprints of the commits after a G that meet a box, in a frame's units — a drop's sweep as its dirt in that box (F153): what a partial re-render clips to; null when the log no longer reaches back (re-render the whole cell).",
        "long": ["-"]},
    "stg._dirtIn": {
        "why": "a footprint includes its sweeps (F153)",
        "what": "The newest commit after a G whose footprint, its sweeps included, meets a box in frame F: its G, 0 if none, the current G when the log does not reach back.",
        "long": ["-"]},
    "stg.touch": {
        "why": "a touch is remembered for `touchedSince` (F149)",
        "what": "A native changed what it draws with no document event (the idle fitter's outline): its footprint is dirt, committed at once outside a batch, and the touch is remembered for `touchedSince`.",
        "long": ["-"]},
    "stg.hold": {
        "why": "a held native's start keeps its geometry and look, for the drop's sweep (F153)",
        "what": None,
        "long": ["A1 C2: a drag writes nothing until its drop. The hold records where each held native and frame started — a native's with the geometry array and look it was held with, so the release can tell a drop that only moved it (F153) — and the release dirties where the selection started and where it ended (DESIGN.md §8–§9)."]},
    "stg.release": {
        "why": "a native the drop only moved dirties its boundary's sweep (F153)",
        "what": None,
        "long": ["The held tile pieces are the drag's start and the tiles hold its end, so a held native's tile items are removed and its tiles re-read; every plate of a frame under a held frame is dropped (`info.drop`).",
                 "A native the drop only moved — its offsets or its home, with the geometry and look it was held with — dirties its boundary's sweep (`sweepBoxes`, `_sweepIn`, F153); any other its boxes before and after, and so does every one when the view drew the drag at a delta or more than `RECTS_MAX` (256) natives are held. `sweepOff` turns the sweeps off for a measurement."]},
    "stg._grouped": {
        "why": "a sweep enters as its two boxes",
        "what": "Past 256 states, one union state per (home, table): natives moved together map as one box, a sweep as its two states before and after.",
        "long": ["-"]},
    "stg._rectsIn": {
        "why": "sweeps are not rectangles",
        "what": "A commit's footprint states but its sweeps, in frame G's units; past 256 rectangles, their one union box.",
        "long": ["-"]},
    "stg._dirt": {
        "why": "a drop's sweep dirties only the cells it reaches (F153); the log's sweeps are capped by bytes",
        "what": "Moves `dirtySince` on every tracked cell a commit's footprints meet — a drop's sweep only on the cells it reaches (`_sweepCells`, F153) — and logs the footprints for `dirtyRects` and late snapshots.",
        "long": ["The log's sweeps are capped by bytes (`_trimSweeps`)."]},
    "stg._setWindow": {
        "why": "nothing is redone while the integer tile range is unchanged (F150)",
        "what": "A window change: when its tile range moved, tiles that left are retired and tiles that entered are read (A2 §2.12); the reroute groups follow.",
        "long": ["-"]},
    "stg._watchGroup": {
        "why": "nothing is redone while the group's tile range is unchanged (F150)",
        "what": "A reroute group's tiles: the window shifted back by its remainder, in its source frame — nothing to do when that range is unchanged (F150); keys it no longer needs are let go.",
        "long": ["-"]},
    "ovl._selDecide": {
        "why": "a newer G whose deltas touch no selected item keeps the decision (F149)",
        "what": None,
        "long": ["A frame whose selected content is under 2 px on screen is one dot and none of its members is visited. Every other selected piece among the Stage's items (its own id, or homed under a selected frame) is traced: its loops, shifted by its placement's offset, cut into runs at its seam rects, clipped to the retained window, runs under half a pixel dropped. A member too small to trace, under 8 px, is a dot where its picture is; dots on one pixel merge (F73).",
                 "Reused while the selection, the revision, the frame and the origin stand, the view is inside the retained window and the zoom is within 1.25x of the decision's, and the Stage's generation stands or has moved only by commits that touch no selected item (`_selUntouched`, F149). A decision taken for a drag records where the selection's ink was (`_selMembersAt`); at the drop or a cancel it is kept, shifted, when that ink moved by one delta (`_selMovedBy`), else decided again. The SVG renderer gets path strings (`runPathData`), the canvas painter the pieces themselves (DESIGN.md §10)."]},
    # ---- the rest ----
    "ts._bakeUp": {
        "why": "the parent cell's natives come from its spatial index (F156)",
        "what": None,
        "long": ["Builds one tile of coarser ink magnified into this box. **The chain.**",
                 "Collects what the parent looks like over this tile's pre-image: the parent's own magnify tiles (recursively — this is the chain, one level at a time), the objects of the parent's cell whose boxes meet the pre-image (`_cellNatives`, F156), and the objects of the eight boxes around the parent.",
                 "Classifies each into empty, solid, or edge. Solid means one object floods the whole tile with no edge in it, and is replaced by a four-cornered rectangle — which is what stops geometry outgrowing a tile and bounds the whole chain.",
                 "Edge content goes through the one-step derivation, which is where the chop, the freeze and the clip happen.",
                 "Returns nothing at all when nothing coarser than the parent has any content, which is the common case near the top of a drawing."]},
    "ts.forgetFrame": {
        "why": "the pins stay: they are the Stage's (F151)",
        "what": "The store's side of frame GC: a forgotten frame's tiles and chain sequence go — its pins stay, being the Stage's (F151) — with every reroute memo that names it, its own and each whose group reads its tiles.",
        "long": None},
    "eng._camToLattice": {
        "why": "a chain noted for another frame is refused (F141); the fallback is the depth-0 spine",
        "what": "The camera's frame deleted with a subtree (A1 C3: it left the lattice): the camera goes to a fresh frame at the same cell — the chain a render noted for that frame — with the same coordinates; else the chain is noted. True when it moved.",
        "long": ["What the deleted frame's id cached goes — the store's tiles, the Stage's items, the plates — as frame GC's forget does, because an undo brings the id back (F111). A chain noted for another frame is not followed (a crossing and the delete inside one animation frame, F141); with none to follow, the camera goes to the depth-0 spine, never the frame it left."]},
    "eng._syncStep": {
        "why": "an uncovered window reads a slice of its missing tiles (F152)",
        "what": "A camera step without a render: on the raster path the Stage's table is synced to the window — from the cache alone while it is covered, else with a slice of the missing tiles (`STEP_READ_MS`, F152), the rest left to `_readIdle` — then the renderer follows the camera.",
        "long": ["-"]},
    "fgc.collectFrames": {
        "why": "a frame the Stage's reroute groups read pictures from is kept (F139)",
        "what": "Forgets every candidate that holds nothing and that nothing keeps — the camera's frame and its ancestors, the trail, a frame an undo or redo op names, a frame the Stage's reroute groups read pictures from (F139) — and then each parent it empties; its tiles, plates and tracked cells go too, and a selected frame that went leaves the selection.",
        "long": None},
    "plm.createPlacementModel": {
        "why": "it gives `footprintMapper`, the drop's sweep mappers (F153)",
        "what": None,
        "long": ["`nativesIn(F)`: the natives drawn live in F — those of F's whole cell, co-residents included, less those whose picture its shift carries out, plus those carried in from other frames (DESIGN.md §9).",
                 "`placement(o, F)`: where a native's picture is seen from F — the frame `F0` whose unmoved tiles hold the pieces drawn there and the remainder `rem` they are painted with and every input is shifted back by; `rerouted` when the pieces come from another frame's tiles.",
                 "`displaced(F)`: the groups of natives drawn away from their stored bits, keyed by the (F0, rem) they share — `TileStore._rerouteGroups`' memo — with `missing`, how many pictures' source frames the lattice lacks: a read mints none, `TileStore.prepare` does at the end of the action (A1 C3).",
                 "The rest: `homeOf`, `drawnLive`, `table`/`tableBefore` (a native's picture table, its own plus its home frame's shift at k = 0, `Document.tableOf`), `frameFootprint` (everything under a frame: its cell ± REACH united with that box moved by its shift), `toStored`/`fromStored` (inputs carried through the placement and back), `footprint` (a drawn rectangle at a state, as seen from another frame — what a change dirties) and `footprintMapper` (`footprint` for many rectangles of one state, bit for bit: a drop's sweep, F153)."]},
}


# The memory layout (2026-10-20, OPEN-FLAGS F164): equal offset tables shared; a drop's journal entry bounded.
add("off.internBelow", "internBelow(below)",
    "The one shared, frozen table equal to `below`, zero entries dropped; undefined when it has no offset (F164).",
    ["Equal tables share one array, so a load, a drop's members and its undo record keep one table a value instead of a "
     "copy each (the Magnum Opus: 24,901 tables of about 95 values, two copies a member in a drag's record). Nothing "
     "writes a table in place — `addOffset` and the rest copy first — and the freeze makes a write throw. The pool "
     "holds WeakRefs, so a value nothing keeps is collected; without WeakRef it returns a frozen copy."],
    "§8")

import newdesc_engine as _eng

FIX.update({
    "off.ownTableOf": {
        "why": "returns the shared table (`internBelow`), not a copy (F164)",
        "what": "Native `o`'s own table as a piece cut from it or an undo entry keeps it: the shared, frozen value; undefined when it has none.",
        "long": ["-"]},
    "doc.ownTable": {
        "why": "the shared table, not a copy (F164)",
        "what": "Native `o`'s own table as an undo entry records it: the shared, frozen value (`internBelow`); undefined when it has none.",
        "long": ["-"]},
    "doc._noteBelow": {
        "why": "it also makes the object's table the shared value (F164)",
        "what": "Keeps the set of moved objects (`_offsetIds`) in step with one object's displacement table, which it makes the shared, frozen value (`internBelow`).",
        "long": ["An object with a non-empty table is added and keeps the shared array equal to it; one without is removed "
                 "and its empty `below` key deleted. Called wherever a table can change or an object enters, so every "
                 "native's table is a shared one (F164)."]},
    "sel._dropMove": {
        "why": "one shared table a (frame, table) key; the journal keeps 120 members (F164)",
        "what": None,
        "long": [_eng.E["sel._dropMove"]["long"][0] + " Each key's new own table is computed once and shared, frozen, by "
                 "its members' natives and undo records (`internBelow`, F164); the journal entry keeps the first 120 "
                 "members and their count."] + _eng.E["sel._dropMove"]["long"][1:]},
})


# Lever 2 of the memory layout (2026-10-20, F164): a loop's record index built at its first random access.
add("lop.countLoop", "countLoop(buf)",
    "The number of pieces in a loop's numbers, walking the records by their codes; 0 under five numbers.",
    ["The count `Loop.length` keeps without building the index (F164)."], "§5")
add("lop.idx", "idx (getter)",
    "The record offsets of the pieces, built at the first use and kept (F164).",
    ["`at(i)` past the first piece is the use that needs it; walking, `length` and `at(0)` read the numbers by record "
     "width, so most loops never build one (R6 loaded: none of 44,550)."], "§5")
add("lop.toJSON", "toJSON()",
    "The JSON a Loop always had — its numbers and their offsets — whether or not the index is built yet.",
    ["Tests compare loops by their JSON; without it a loop's JSON would change when its index or count was first read "
     "(F164)."], "§5")

FIX.update({
    "lop.Loop": {
        "why": "the index is built at the first random access (F164)",
        "what": "One closed loop of arc and line pieces, stored as a single Float64Array; its Uint32Array of record offsets is built at the first random access (F164)."},
    "lop.Loop.constructor": {
        "why": "takes the piece count; the index may be absent (F164)",
        "fn": "Loop.constructor(buf, idx, n)",
        "what": "Wraps the numbers, with the record offsets and the piece count when the caller has them; without them both are found at first use (F164).",
        "long": ["-"]},
    "lop.from": {
        "why": "no index is filled; the count is kept (F164)",
        "what": "A Loop from a builder's piece array, in one counting pass and one filling the buffer; a Loop passes through. The count is kept and the index built at first use (F164)."},
    "lop.length": {
        "why": "kept or counted without the index (F164)",
        "what": "The number of pieces: kept from the constructor or counted once (`countLoop`), without building the index (F164).",
        "long": ["-"]},
    "lop.at": {
        "why": "past the first piece it builds the index at first use (F164)",
        "long": ["Its `A` is read from the previous record's last two numbers, or the loop's start for the first piece. Past "
                 "the first piece it reads the index, which the first such call builds (F164)."]},
    "lop.translate": {
        "why": "shares the index only once built (F164)",
        "what": "The same loop moved by (dx, dy): a new Loop over a shifted copy of the numbers, with the count and, if built, the index (F164).",
        "long": ["-"]},
    "lop.byteLength": {
        "why": "an unbuilt index holds nothing (F164)",
        "what": "Bytes held by the numbers and, once built, the index, for the memory census."},
})


# Lever 3 of the memory layout (2026-10-20, F164): the family map keeps families only.
add("doc._buildGroups", "_buildGroups()",
    "`editGroup`'s map, in level then list order, of the groups that can hold more than one native: every family key's, and a keyless native's whose id is a family key or another native's id too.",
    ["Two passes: the keys first, then the members. Every other native is alone in its group and is read from `_byId` "
     "instead of stored (the Magnum Opus: 448 groups instead of 43,031; in jsdom 0.11 MB instead of 10.95, F164)."], "§10")
FIX.update({
    "doc.editGroup": {
        "why": "a native alone in its group is read from the id index, not stored (F164)",
        "long": ["Every object sharing one family key.",
                 "A family is the pieces of one logical object spread across levels by ceding. They select, move and undo together.",
                 "The map behind it (`_buildGroups`) holds only the groups that can hold more than one object; an object "
                 "alone is answered from the id index (F164)."]},
})


# Lever 4 of the memory layout (2026-10-20, F164): the spatial index shares a shape's and a fill's cached box.
FIX.update({
    "der.bboxOf": {
        "why": "a cached box is frozen and shared with the spatial index (F164)",
        "long": ["An object's extent in its own coordinates, cached on the object.",
                 "Exact for a resolved outline, bulges included — a chord-only box would understate a half-turn end cap by the whole pen radius.",
                 "A cached box is frozen: the spatial index keeps the same object for a shape or a fill (F164). A shape with no "
                 "finite piece reads one constant, `EMPTY_SHAPE_BOX`, which the index keeps in no cell."]},
})


# Lever 5 of the memory layout (2026-10-20, F164): a load shares its natives' header strings.
add("doc.sharedString", "sharedString(s)",
    "The one string of a value a load gives every native that has it (`type`, `origin`, `color`): the first seen.",
    ["JSON.parse already shares short strings; a structured clone (IndexedDB, a worker's message) makes each anew, "
     "which is how Kobin's Chrome held one \"shape\" and one \"native\" a native (0.82 MB each on the Magnum Opus). "
     "Plain Node, 43,135 cloned records: 15.14 → 12.18 MB, the JSON path's own figure. Bounded at 4,096 values; a "
     "cleared pool only stops the sharing (F164)."], "§13")


# 2026-10-20 evening: a refused job is never left neither posted nor dropped; `setDeviceName` deleted (Kobin).
add("rwc.wireChecked", "wireChecked(job)",
    "`wireJob`, or null when the job's check refuses it. A job whose row runs do not tile a loop (F154) is wired without them: the core walks every piece, the same pixels.",
    ["Before it, a refusal thrown out of `dispatch` left the strip neither posted nor dropped, so its cells stayed paper "
     "(Kobin's Magnum Opus report, 2026-10-20 15:54). Counts `badRuns` and keeps the first one described (`describeBadRuns`)."], "§9")
add("rwc.describeBadRuns", "describeBadRuns(job, err)",
    "The refused item for the worker report: its id and kind, its loops' offsets, the run offsets it carried and the ones `rowRuns` gives its own geometry.",
    ["-"], "§9")
FIX.update({
    "rwc.dispatch": {
        "why": "a refused job is dropped (`invalid`) or sent without its row runs, never thrown out (2026-10-20)",
        "long": ["A pack that throws or returns null is reported dropped with the new id (`pack`, `empty`); so is a job the check "
                 "refuses (`invalid`), except one whose row runs alone are wrong, which goes without them (`wireChecked`). The "
                 "posted-at time is the main thread's; the wire and post time goes to `postMs`.",
                 "The inline path runs the worker's own `runJob` on a later microtask, so both paths draw the same pixels and jsdom checks the shipped code."]},
    "loc.setDeviceName": {"why": "gone: deleted 2026-10-20 at Kobin's word (nothing called it)"},
})


# 2026-10-20 night (F166): the zoom-out paper — the coarse net, the far reads retried.
add("pyr._net", "_net(v, P)",
    "A plan with paper: the view's cells 3 octaves coarser over the paper's box (at most 6, each in the camera's table) rendered on this thread when the estimate fits `netMs`; true when one landed, and `compose` plans again.",
    ["Kobin 2026-10-20: \"I'd prefer blurry images or slow framerate to this much paper\". The plates are exact, so rule (d) "
     "draws them blurred until the view reaches their level. Counted in `nets`, `netPlates`, `netMs` (F166)."], "§9")
FIX.update({
    "pyr.compose": {"why": "paper first gets the coarse net (F166)",
                    "long": ["A commit's patch step if due; the plan, and when it shows paper the net (`_net`) and the plan again; then pin, "
                             "draw (directly under COMPOSE_IMAGES, else through the surface) and charge the integrals."]},
    "pyr.setFar": {"why": "a retry adds to the far set (F166)",
                   "long": ["The far set the store protects at rank FAR; `keep` (a retry's reads) adds to it instead of replacing it."]},
    "rr._pyrPrefetch": {"why": "an incomplete far read is tried again 100 ms later while still (F166)",
                        "long": ["At idle, once a view revision and a generation: `prefetchPlan`, its far keys to the store, its jobs queued. "
                                 "A plan that left an off-camera read incomplete (`unread`) is tried again PREFETCH_RETRY_MS later, reads only "
                                 "and in the same generation, while the key holds: on the Magnum Opus no far read fit its 8 ms in one try."]},
    "pft.prefetchPlan": {"why": "reports its incomplete reads and every far cell it covers (F166)",
                         "long": ["The near levels from the live table, the far levels and the crossing target through budgeted snapshots, the ring "
                                  "at rest. The jobs carry `far` (every far cell covered, cached or asked) and `unread` (reads left incomplete); "
                                  "`cfg.retry` plans the reads only."]},
    "pft.farKeysOf": {"why": "the plan's covered far cells too (F166)",
                      "long": ["The FAR protection class: every far cell the plan covers (`jobs.far`) and every far job's cell."]},
})
