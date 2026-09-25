# -*- coding: utf-8 -*-
"""Per-function entries for the kobin-2 store (format2.js, oplog.js) and the
oracles not yet described (KobinEngineV0, curvePerimeter, strokeShape,
bakeStrategies, coverageOracle)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# What each file NEW to the pages is for; the file's article heading on the Code Map.
ROLE = {
    "src/engine/format2.js":
        "The kobin-2 store's codec: a frame snapshot or an op-log entry as small JSON headers plus one "
        "Float64Array of geometry, and either as a byte chunk for the cloud. Pure; its spans decode to the "
        "same objects kobin-1's text does (DESIGN.md §13).",
    "src/engine/oplog.js":
        "The op log on the engine side: records what the document did as entries carrying results, for the "
        "saver to append, and replays them onto the loaded snapshots, undo and redo stacks and pending "
        "erasers included (DESIGN.md §13).",
    "src/engine/__oracles__/coverageOracle.js":
        "Test-only: the independent coverage reference the rasteriser is checked against: exact-winding "
        "coverage by sub-scanlines, the shoelace area, and stored loops flattened to rings. Production never "
        "imports it.",
}


# ---- src/engine/format2.js ----
add("f2.F64Builder", "F64Builder",
    "A growable Float64Array the kobin-2 encoders append a unit's geometry to.",
    ["`n` numbers used of `buf`, the capacity doubled when full. It has the variadic `push` that `loop.encodeLoopInto` writes through, so a loop's numbers go straight in with no intermediate array."],
    "§13")
add("f2.F64Builder.constructor", "F64Builder.constructor(cap)",
    "Allocates the buffer, at least 16 doubles, and starts it empty.", ["-"], "§13")
add("f2.length", "length (getter)", "The count of numbers written so far.", ["-"], "§13")
add("f2._grow", "_grow(need)",
    "Doubles the capacity until `need` fits and copies the written numbers across.", ["-"], "§13")
add("f2.push", "push(...vs)",
    "Appends any number of values, growing the buffer first when they do not fit.", ["-"], "§13")
add("f2.slice", "slice()",
    "The written numbers as a Float64Array of exactly that length, a copy.",
    ["What a snapshot or an entry stores as its `geo`; the builder's spare capacity never reaches the store."],
    "§13")
add("f2.objectHeader", "objectHeader(o, geo)",
    "A native's serialisable fields apart from its geometry: the one header kobin-1 and kobin-2 both write.",
    ["Writes `type`, `origin`, `id`, then `geo` when given (kobin-1's geometry fields, where the JSON has them), colour and opacity, and only the fields that differ from their defaults: `w` above 0, `z` when it is not the id, a non-zero `tile`, the displacement table through `encodeBelow`, the erase flag with its `bakePx`. Fields named in `_extra` are copied through.",
     "`Document.serializeNatives` (kobin-1) and `encodeObjects`/`encodeEntry` (kobin-2) all call it, so the two forms agree field for field (DESIGN.md §13)."],
    "§13")
add("f2.extraFields", "extraFields(h)",
    "The header fields this build does not know, so a native keeps them for its next write.",
    ["Checked against the `KNOWN` whitelist, which also names the retired `windows`, `srcId` and `paths` so they are dropped rather than carried. `nativeFromRecord` stores the result as `_extra` and `objectHeader` writes those fields back, so a field a newer build adds survives a save by an older one."],
    "§13")
add("f2.pushGeometry", "pushGeometry(b, o)",
    "Appends one object's geometry to the builder in the span grammar and returns its `[offset, length]`.",
    ["Shape: the loop count, then each loop's length and its numbers through `encodeLoopInto` (a stored `Loop` copies its buffer). Fill: the ring count, then per ring its number count and its points. Stroke: the point count and the points.",
     "The numbers are the ones kobin-1 writes as text, so a span and a kobin-1 record decode to identical objects."],
    "§13")
add("f2.readGeometry", "readGeometry(h, geo)",
    "Decodes a header's span back to `loops`, `polys` or `pts`, throwing on a span that does not fit.",
    ["A shape's loops are `subarray` views of the frame's array, no copy; `nativeFromRecord` wraps each as a `Loop` over the same memory. Fills and strokes come back as point arrays.",
     "Every count and length is checked against the span and the array, so a damaged record fails naming its object rather than reading a neighbour's numbers."],
    "§13")
add("f2.recordOf", "recordOf(h, geo)",
    "A header plus its span as a kobin-1 record: the header without `g`, with the decoded geometry.",
    ["-"], "§13")
add("f2.encodeObjects", "encodeObjects(objs)",
    "One frame's live natives as a snapshot: a header per object, each with its span, and one Float64Array.",
    ["The saver's frame snapshots (`useKobinEngine`) and the dev report's local extract are written with it."],
    "§13")
add("f2.encodeRecords", "encodeRecords(records)",
    "kobin-1 records into the same frame form, their flat loop numbers copied without decoding a piece.",
    ["For a whole kobin-1 document written to the store (`localCanvases.saveCanvasDoc`). Its loops are already the span grammar's numbers, so they are copied as they stand."],
    "§13")
add("f2.decodeObjects", "decodeObjects(objects, geo)",
    "A stored frame back to kobin-1 records, loops as views of its array.",
    ["Checks that `objects` is an array and `geo` a Float64Array, then decodes each header with `recordOf`. The editor's restore, `localCanvases` and the report's loader read frames through it; a caller handing records to JSON copies the views to plain arrays first."],
    "§13")
add("f2.geomSlot", "geomSlot(b, geom)",
    "A move member's before or after geometry as a typed header with its span in the entry's array.",
    ["The type is read off which geometry field is present. `attachRect`, `tile` and `below` ride along only when the source has the key, so a table-only move reads back with no geometry keys; `undefined` stays `undefined` and any other empty value becomes null."],
    "§13")
add("f2.readGeomSlot", "readGeomSlot(s, geo)",
    "Reads a `geomSlot` back: the decoded geometry plus the `attachRect`, `tile` and `below` it carried.",
    ["-"], "§13")
add("f2.encodeEntry", "encodeEntry(op)",
    "One op-log entry as JSON plus one Float64Array: every object it carries becomes a header with a span.",
    ["Per kind: `add`, `put`, `remove` and `mark` carry `obj`; `bake` its removed object and pieces; `removeMany` its records; `move` and `moveFrames` each member as the object it now is, with `base`/`after` geometry only where the member has them; `removeFrames`, `bakeFrames` and `deleteMany` every deleted frame's natives. Kinds with no geometry pass through unchanged.",
     "An entry carries RESULTS, never a gesture to recompute, so replay does not depend on the code version that wrote it (DESIGN.md §13)."],
    "§13")
add("f2.decodeEntry", "decodeEntry(entry)",
    "An entry back to its op, every object a kobin-1 record with its geometry as views of the entry's array.",
    ["Throws on an entry with no kind. `OpLog._replay` decodes each stored entry through it."],
    "§13")
add("f2.packChunk", "packChunk(kind, header, geo)",
    "A snapshot or a run of entries as one byte array for the cloud: magic, kind, header JSON, padding, doubles.",
    ["Layout: `KB2\\0`, the kind (`CHUNK_FRAME` or `CHUNK_LOG`), the geometry version, the header's byte length, its UTF-8, zero padding to a multiple of 8, then the doubles little-endian, so a reader can view them in place. The module refuses to load on a big-endian platform.",
     "`cloud/store2.js` gzips the result and splits it into 700 KiB parts; the report's whole-drawing parts use it too."],
    "§13")
add("f2.unpackChunk", "unpackChunk(u8)",
    "Parses a chunk back to kind, geometry version, header and geometry, refusing one malformed or written by a newer build.",
    ["Checks the magic, refuses a geometry version above `GEO_VERSION` with a message naming both, and checks the header and geometry lengths against the bytes. The geometry is a view of the buffer when its offset is 8-aligned, a copy otherwise."],
    "§13")
add("f2.utf8Encode", "utf8Encode(str)",
    "A string as UTF-8 bytes, surrogate pairs joined, for a chunk's header.",
    ["Dependency-free because `TextEncoder` is not on every test global."],
    "§13")
add("f2.utf8Decode", "utf8Decode(u8)",
    "UTF-8 bytes back to a string, four-byte sequences as surrogate pairs.",
    ["The inverse of `utf8Encode`, for `unpackChunk`'s header. It assumes well-formed input and does not validate continuation bytes."],
    "§13")

# ---- src/engine/oplog.js ----
add("opl.lvl", "lvl(v)",
    "A frame id as a string, or null: the one spelling every entry and `touches` list uses.",
    ["-"], "§13")
add("opl.OpLog", "OpLog",
    "The engine side of the kobin-2 op log: records what the document did as entries carrying results, and replays them at load.",
    ["It subscribes to `Document`'s change and op events and queues an entry per fresh op, bake step, consumed mark, undo, redo, settle, merge, and geometry change made under no op. `drain` hands the saver the tick's entries and the frames that must snapshot; the saver rewrites a frame's snapshot only then or when its entries have outgrown it (DESIGN.md §13).",
     "`replay` applies stored entries onto the loaded snapshots, rebuilds the undo and redo stacks from them and re-registers pending erasers with their done sets.",
     "The lattice is not logged: every write carries `LevelMap.serialize`, so a replayed `moveFrames` or `mergeFrame` rebuilds the op and re-addresses nothing (DESIGN.md §8)."],
    "§13")
add("opl.OpLog.constructor", "OpLog.constructor(engine)",
    "Binds to the engine's document and subscribes to its change and op events, with an empty tick.",
    ["`seq` is the last seq handed out; the saver sets it from the store's header on load. The tick is `queue` (items in event order), `queued` (the pending add, mark or put per id, for coalescing), `removed` (objects removed this tick), `forced` (frames that must snapshot) and `needFull`."],
    "§13")
add("opl.detach", "detach()", "Unsubscribes from the document.", ["-"], "§13")
add("opl._next", "_next()", "Hands out the next seq.",
    ["A seq is taken when the event happens, so entries are in event order even when they are encoded later, at the drain."],
    "§13")
add("opl._indexOf", "_indexOf(id)",
    "An object's current index in its frame's list, or null when the document does not hold it.",
    ["Reads the list through `Document.at`, which settles a pending shift first (DESIGN.md §8)."],
    "§13")
add("opl._onEvent", "_onEvent(ev)",
    "Turns document change events into the tick's items: a removed object remembered, a spent mark, a geometry change as a `put`.",
    ["Ignored while replaying. A reset that is not a load sets `needFull`. A removal is remembered so the drain can encode an object added and removed within the tick; an erase mark removed outside undo and not by a rehome is queued as `spent`, since its consumption has no op of its own.",
     "A change that is not offsets-only and not inside undo queues one `put` per id per tick, unless an add, mark or put for that id is already queued: those encode the current state at the drain anyway."],
    "§13")
add("opl._ownerSeq", "_ownerSeq(owner)",
    "The seq of the `moveFrames` op a frame entry belongs to, found on the undo and redo stacks or among the replay's rebuilt ops.",
    ["Null while the op is not on a stack yet (a settle mid-drag), which is why a settle entry's `of` can be absent."],
    "§13")
add("opl._onSettle", "_onSettle(ev)",
    "Queues a `settle` entry carrying the result tables, coalesced with a settle of the same frame queued just before it.",
    ["A drag unsettles and settles a visible frame every event, so consecutive settles of one frame keep only the latest record. `touches` is the frame plus every carry's destination; a carry forces all of them to snapshot, since it changed which frame holds a native (DESIGN.md §13)."],
    "§13")
add("opl._onMerge", "_onMerge(ev)",
    "Queues a `mergeFrame` entry for a shadow merged into its resident and forces the resident's snapshot.",
    ["The resident now holds the shadow's natives and the shadow's row goes with the write. The entry names its `moveFrames` op (`of`) so replay hangs the record on it for undo."],
    "§13")
add("opl._onOp", "_onOp(ev)",
    "Turns document op events into the tick's items: bake steps, undo and redo, and each fresh op kind with its seq.",
    ["While replaying it only collects settles, to queue once the replayed seqs are known. A bake step encodes at once, since its pieces may be cut again before the tick: a `rekey`, a `bakeFrames` for a frame the mark covered whole, or a `bake` with the removed object and its pieces. An undo or redo names its op's `_seq` and forces what `_forcedFor` returns; an op from before the log (a clear) sets `needFull`.",
     "A fresh op takes its seq here (`op._seq`): `add` and `eraseCommit` queue an `add` or `mark` with the index they have now, encoded at the drain; `move` and `moveMany` force their from and to frames; `moveFrames` forces only what `_forcedFor` allows; `eraseMany` encodes a `removeMany` at once; `removeFrames`, `eraseFrames` and `deleteMany` are encoded at the drain; `clear` sets `needFull`."],
    "§13")
add("opl._opLevels", "_opLevels(op)",
    "Every frame an op touches now, for an undo or redo entry's `touches` and the snapshots it forces.",
    ["Walks each op kind's own fields and recurses into `deleteMany`'s parts; for an object it reads the frame the document holds it in now, not the one the op recorded."],
    "§13")
add("opl._forcedFor", "_forcedFor(op, touches)",
    "Which of an op's frames must be re-snapshotted: all of them, except for a subtree move.",
    ["A `moveFrames` forces only its per-object members' frames, both frames of every merge, and a settled frame with carries plus the carries' destinations. A frame moved as a frame keeps its natives' bytes: the header carries its address and the tables are entries (DESIGN.md §13)."],
    "§13")
add("opl._moveFile", "_moveFile(m)",
    "One move member in file form: id, frames, delta, the object as it now is with its index, the tables, any geometry snapshots.",
    ["`belowBefore`/`belowAfter` go through `encodeBelow`; `base`/`after` are written only for a member the pen-up walked back into its cell. `obj` lets replay give the object to a frame whose snapshot never held it."],
    "§13")
add("opl.drain", "drain()",
    "Encodes the tick's items into entries in seq order, with the frames each touches, the forced frames and the full flag, and resets the tick.",
    ["An add, mark or put encodes the object as it is now, or as it was when removed this tick, so a stroke that resolved within the tick is written as its perimeter; an item whose object came and went is dropped. Moves, frame deletes, settles and merges are put into file form here.",
     "The saver drains again after taking its snapshots, until the queue is empty, because reading a frame for its snapshot can settle it and queue a new entry (DESIGN.md §13)."],
    "§13")
add("opl.replay", "replay(entries, frameSeq)",
    "Applies stored entries onto the loaded snapshots, the log marked as replaying for the duration.",
    ["`entries` ascend by seq; `frameSeq` maps a frame to its snapshot's seq. After `_replay`, the settles the replay itself triggered are queued as new entries while the replayed ops are still known, for their `of`.",
     "Returns the sizes of the rebuilt undo and redo stacks and the number of pending erasers."],
    "§13")
add("opl._replay", "_replay(entries, frameSeq)",
    "Replays entries idempotently, skipping those whose frames all hold a newer snapshot, and rebuilds the undo and redo stacks and pending erasers.",
    ["Each entry is decoded, its op rebuilt for the stacks, and applied only where a touched frame's snapshot predates it (`stale`). Every record of one id decodes to ONE object, a later record's state adopted into it, so the stacks share identity with the document as in a live session (F70). An `attr` entry is applied, though nothing writes one yet (DESIGN.md §13).",
     "An undo or redo inverts the rebuilt op: from the entry's own data where the snapshots already hold its effect, through `Document._invert` otherwise, and a `moveFrames` by splitting merges and subtracting settles without re-addressing. The inverse keeps the op's seq (F71). A `settle` or `mergeFrame` entry is hung on the `moveFrames` op it names.",
     "The undo stack is capped at 200. Each erase mark still in the document is re-registered in `_eraseCommits` with a done set of the ids its bake entries name, so the bake resumes where the log left it."],
    "§13")
add("opl.settleFile", "settleFile(rec)",
    "A settle record in file form: the shift, each native's result table through `encodeBelow`, the carries' frames as strings.",
    ["-"], "§13")
add("opl.settleLive", "settleLive(s)",
    "A stored settle record back to live form, its tables decoded.", ["-"], "§13")
add("opl.mergeFile", "mergeFile(rec)",
    "A merge record as a plain-data deep copy, so the op and the entry never share it.",
    ["The same function reads it back (`mergeLive`)."], "§13")
add("opl.frameFile", "frameFile(e)",
    "A `moveFrames` frame entry in file form: address before and after, shifts, and its settle inline; its merges are left out.",
    ["A settle is inline because one mid-drag has no op to be an entry of; a merge always happens after the op is on the stack, so its own `mergeFrame` entry names the op."],
    "§13")
add("opl.geomLive", "geomLive(g)",
    "A move's stored before or after geometry as `setGeometryById` takes it, loops wrapped as `Loop`s.",
    ["Decoded through `nativeFromRecord`, so a damaged loop is repaired as a loaded native's is; `attachRect`, `tile` and `below` are kept when the slot has them."],
    "§13")

# ---- src/engine/__oracles__/KobinEngineV0.js ----
V = "§17"
add("v0.KobinEngineV0.constructor", "KobinEngineV0.constructor(container, opts)",
    "Builds the retired engine: a Two.js scene of three groups, the camera, per-level natives, crossing records, tile caches and tool state.",
    ["Level 0 holds the originals; `levelObjects` is each level's render list; `crossings` pin each level's frame on first entry; `tiles` caches each level's derived content per grid cell. It also keeps a perf ring and a projection cache, and puts the Clipper and polyline helpers on `geom` for scripted tests."],
    V)
add("v0.setTool", "setTool(t)", "Sets the active tool: pen, erase or pan.", ["-"], V)
add("v0.setPenType", "setPenType(t)", "Sets the pen variant: freehand, highlight or straight.", ["-"], V)
add("v0._perf", "_perf(op, t0, always, extra)",
    "Logs an operation slower than 8 ms, or any when `always`, to a 300-entry ring with the level and in-level scale.",
    ["-"], V)
add("v0.setColor", "setColor(c)", "Sets the colour of the next stroke.", ["-"], V)
add("v0.setWidth", "setWidth(w)", "Sets the width of the next stroke, in screen pixels.", ["-"], V)
add("v0.setOpacity", "setOpacity(o)", "Sets the opacity of the next stroke.", ["-"], V)
add("v0.setOpacityGroups", "setOpacityGroups(b)",
    "Toggles one opacity group per object, drops every cached tile so fills rebake with or without the seam pad, and re-renders.",
    ["With groups on, an object's pieces render opaque inside a group that carries its opacity, so overlapping pieces and the deliberate overlap at tile seams do not double-darken."],
    V)
add("v0.setDebug", "setDebug(b)", "Toggles red outlines on filled paths and re-renders.", ["-"], V)
add("v0.setTileDebug", "setTileDebug(b)",
    "Toggles red squares at the edges of the cached tiles at and below the active level.", ["-"], V)
add("v0.resize", "resize(w, h)",
    "Resizes the renderer, faults in the tiles the new window needs and re-renders; a same-size call does nothing.",
    ["The tile grids stay as their crossing records captured them, so cached tiles remain valid across a resize."], V)
add("v0.destroy", "destroy()", "Stops the Two.js loop and removes its SVG from the DOM.",
    ["Without it a remount leaves the old SVG stacked behind the new one."], V)
add("v0.clear", "clear()",
    "Empties the document and resets the camera, pushing the whole prior state as one undoable op.", ["-"], V)
add("v0.snapshot", "snapshot()",
    "The document and camera as dev-0 JSON: each level's natives, the crossing records with their grids, the camera.",
    ["Not a durable save format; it existed so a reload could restore the session."], V)
add("v0.loadSnapshot", "loadSnapshot(snap)",
    "Restores a dev-0 snapshot's natives, crossings and camera, with both undo stacks cleared.",
    ["Advances the module's id counter past the largest id loaded, so a new stroke never reuses one."], V)
add("v0.screenToFrame", "screenToFrame(sx, sy)",
    "A screen point in the active level's frame, through the in-level scale and pan.", ["-"], V)
add("v0._objs", "_objs()", "The active level's render list.", ["-"], V)
add("v0.pointerDown", "pointerDown(sx, sy)",
    "Starts a pan, an erase or a stroke; a stroke becomes a native at once, drawn live as a Two.js path.",
    ["Its width is the pen width over the in-level scale, 2.5 times that for the highlighter, whose opacity is capped at 0.45; the straight pen draws an uncurved two-point path."],
    V)
add("v0.pointerMove", "pointerMove(sx, sy)",
    "Pans, erases under the pointer, or extends the live stroke; the straight pen moves its end point instead.",
    ["-"], V)
add("v0.pointerUp", "pointerUp()",
    "Finishes the stroke: renders it, drops the deeper levels' cached tiles and pushes an `add` op.",
    ["A new stroke is the only thing that changes derived tiles, and only deeper ones: this level, shallower levels and every native stay as they were."],
    V)
add("v0.cancelStroke", "cancelStroke()",
    "Removes the live stroke with no undo entry, for a second touch that makes the gesture a pinch.", ["-"], V)
add("v0.eraseAt", "eraseAt(sx, sy)",
    "Deletes the topmost object under the pointer from the level its native lives at and pushes an `erase` op.",
    ["Derived and projected copies carry their source's id, so hitting a copy at any level removes the one native everywhere. This eraser removes whole objects; it never cuts."],
    V)
add("v0._hitTest", "_hitTest(sx, sy)",
    "The id of the topmost object under a screen point: winding for fills, distance to the centerline for strokes.",
    ["A stroke hits within half its width plus 6 screen px; on a curved level the chords of its displayed spline are tested rather than the raw samples."],
    V)
add("v0.undo", "undo()",
    "Pops an op, applies its inverse, pushes that onto the redo stack and refreshes.", ["-"], V)
add("v0.redo", "redo()",
    "Pops a redo op, applies it, pushes its inverse back onto the undo stack and refreshes.", ["-"], V)
add("v0._invert", "_invert(op)",
    "Applies an op's inverse and returns the op that re-applies it: add and absent, erase and present, clear and clear.",
    ["-"], V)
add("v0.panBy", "panBy(dx, dy)",
    "Pans by screen pixels, faulting in tiles, and rebakes fat outlines only when the view leaves their padded window.",
    ["-"], V)
add("v0.zoomAt", "zoomAt(sx, sy, deltaY)",
    "A wheel zoom about the pointer, by 2 to the power of minus `deltaY` over 1000.", ["-"], V)
add("v0.pinchUpdate", "pinchUpdate(mx, my, factor, dx, dy)",
    "One pinch step: pans by the midpoint's movement, then zooms about the midpoint.", ["-"], V)
add("v0.zoomFactorAt", "zoomFactorAt(sx, sy, factor)",
    "Zooms about a screen point, crosses levels as needed, faults in tiles, and rebakes fat outlines once the scale has moved about 25 %.",
    ["A live stroke is finished first, since a crossing changes the frame under its coordinates."], V)
add("v0._maybeCross", "_maybeCross()",
    "Crosses up while the in-level scale is past `enter` and down while it is under `exit`, then bakes and renders once.",
    ["No floor: zooming out past level 0 makes negative levels as zooming in makes deeper ones. A step that crosses several levels bakes only the one it settles at."],
    V)
add("v0._crossUp", "_crossUp()",
    "Enters the next deeper level, pinning its crossing record and tile grid on first entry and reusing them from then on.",
    ["The record is defined as if the crossing happened at exactly `enter`, so every re-entry lands near `base` and an overshooting zoom step cannot invert the hysteresis band."],
    V)
add("v0._crossDown", "_crossDown()",
    "Returns to the coarser level, defining its record on the first exit below, and keeps the deeper level's tiles for a return.",
    ["Only the rendered paths are removed; the tiles, the frame and the natives stay, so coming back re-bakes nothing and does not drift."],
    V)
add("v0._frameWindow", "_frameWindow(margin)",
    "The visible screen rectangle in the active level's frame, grown by a margin.", ["-"], V)
add("v0._outlinePad", "_outlinePad()",
    "Half a screen width in frame units: the pad a fat outline is baked with.", ["-"], V)
add("v0._windowCovered", "_windowCovered()",
    "Whether the view still fits inside the window the last fat or outline bake was made for.",
    ["Panning inside it needs no rebake."], V)
add("v0._fatOnScreen", "_fatOnScreen(o)",
    "Whether a stroke is wider on screen than the polygonise gate, and so rendered as a filled outline instead of a browser stroke.",
    ["The gate is a third of the page width. Past it the browser's float32 stroker misplaces the band edge (measured 220 px at 284x in-level zoom), and painting the band the next crossing bakes keeps the swap seamless."],
    V)
add("v0._levelPointToScreen", "_levelPointToScreen(level, x, y)",
    "A point in any level's frame mapped to current screen pixels, through the crossing chain and the camera.",
    ["The tile-debug squares use it, and `KobinEngineV0.test.js` measures zoom round-trip drift with it."], V)
add("v0._renderTileDebug", "_renderTileDebug()",
    "Redraws the tile-edge debug squares for every cached tile at and below the active level.", ["-"], V)
add("v0._emit", "_emit()",
    "Reports level, in-level scale, effective zoom, object count and modes to the status callback.", ["-"], V)
add("v0._effectiveZoom", "_effectiveZoom()",
    "The total zoom relative to level 0: the in-level scale times every crossing's factor in between.", ["-"], V)
add("v0.distToPolyline", "distToPolyline(pts, p)",
    "The distance from a point to a polyline, or to its only point.", ["-"], V)
add("v0.windingOfPoint", "windingOfPoint(rings, p)",
    "The nonzero winding number of a point across a fill's rings, so holes cancel.", ["-"], V)

# ---- src/engine/__oracles__/curvePerimeter.js ----
add("cvp.DistOracle.constructor", "DistOracle.constructor(cubics, r, tol)",
    "Flattens every centerline cubic to chords within `tol` and files each in a grid of pen-radius cells.",
    ["Each chord is filed in every cell within r of it, so a burial query reads one cell. It takes no cubics for the bakers that grow it one cubic at a time with `addCubic`."],
    V)
add("cvp.VertexSet", "VertexSet",
    "Crossing points registered once and handed to both pieces cut there, so a junction's two ends are the same coordinates.",
    ["A point within `tol` of one already registered returns that one. The cut step of `curvePerimeter` and the incremental schedule use it; the arc pipeline has its own (`arcPerimeter.VertexSet`), and this one is kept independent of it."],
    V)
add("cvp.VertexSet.constructor", "VertexSet.constructor(tol)",
    "Starts an empty set with its weld tolerance and a grid of cells twice that size.", ["-"], V)
add("cvp.at", "at(x, y)",
    "The registered vertex within `tol` of a point, or the point itself, newly registered.",
    ["Searches the 3 by 3 cells round the point, since a rounded key alone splits pairs that straddle a cell edge."], V)
add("cvp.now", "now()",
    "The clock for the resolve's phase timings: `performance.now()` where it exists.", ["-"], V)
add("cvp.dropHairlines", "dropHairlines(loops, minWidth)",
    "Removes loops whose mean width, twice the area over the perimeter, is under the burial test's resolution.",
    ["A doubled-back strip paints nothing, so dropping it changes no pixel. Exported so the batch and incremental schedules filter the same way; the perimeter is measured on four chords a cubic."],
    V)
add("cvp.PieceGrid.constructor", "PieceGrid.constructor(pieces, cell)",
    "Files every piece in each grid cell its box touches, and gives each a slot for the query stamp.", ["-"], V)

# ---- src/engine/__oracles__/strokeShape.js ----
add("sks.Crumb.constructor", "Crumb.constructor(cellSize)",
    "An empty occupancy grid: per cell, how many capsules cover it whole and the first one that did.", ["-"], V)
add("sks.SegGrid.constructor", "SegGrid.constructor(segs, r, cell)",
    "Files each segment in every cell within r of it, with a stamp array for duplicate-free queries.",
    ["De-duplication is by stamp rather than a Set: building a Set per query dominated the whole computation on a dense stroke."],
    V)
add("sks._key", "_key(i, j)", "A grid cell's map key.", ["-"], V)
add("sks.add", "add(seg, r, id)",
    "Records one capsule: each cell whose four corners all lie within r of the segment counts it, and keeps it if it was first.",
    ["Whole-cell coverage only, so a cell covered by several capsules between them still reads as uncovered: the grid can over-include candidates but never loses boundary."],
    V)

# ---- src/engine/__oracles__/bakeStrategies.js ----
add("bks.now", "now()",
    "The clock for the schedules' timings: `performance.now()` where it exists.", ["-"], V)
add("bks.BaseBaker.constructor", "BaseBaker.constructor(width, opts)",
    "Records the width, radius and options and starts the sample list and the per-sample timings.", ["-"], V)
add("bks.CrumbBaker.constructor", "CrumbBaker.constructor(width, opts)",
    "Adds an empty crumb and an empty distance oracle at the tolerance the batch resolve would use.",
    ["The tolerance comes from `oracleTolFor`, so the oracle handed to `curvePerimeter` at pen-up is the one it would have built itself."],
    V)
add("bks.IncrementalBaker.constructor", "IncrementalBaker.constructor(width, opts)",
    "Sets up the live perimeter with the batch path's build, cut and burial tolerances, an empty oracle, a shared vertex set and a bucket grid.",
    ["Every tolerance matches the batch path's; a private value makes B cut or bury in different places from A."],
    V)
add("bks.addSample", "addSample(p)",
    "Appends one pen sample, runs the schedule's per-sample hook and records how long it took.",
    ["`drawMs` and the per-sample distribution are what the schedules are compared on; the tail matters more than the mean."],
    V)

# ---- src/engine/__oracles__/coverageOracle.js ----
add("cov.coverRings", "coverRings(rings, TW, TH, K)",
    "Each pixel's coverage by a set of rings under the nonzero rule, by K sub-scanlines a row walking integer winding.",
    ["Exact in x and quantised to 1/K in y: a pixel is within 1/K, a shape's total within about P/K² for a boundary of P pixels. Walking winding numbers makes it exact for any winding and any overlap, which signed-area accumulation is not.",
     "The raster suites compare `raster/rasterCore.js` against it. It shares the idea of the core's union pass and none of its code."],
    V)
add("cov.addRun", "addRun(cov, base, xa, xb, w, TW)",
    "Adds one sub-scanline's covered run to its row pixel by pixel, clipped to the plate.",
    ["Naive on purpose: the rasteriser deposits a run's two ends and lets a running sum fill the interior, and the oracle must not share that step."],
    V)
add("cov.ringsArea", "ringsArea(rings)",
    "The exact signed area of a set of rings, by the shoelace formula.",
    ["Positive is clockwise on a y-down screen; a ring `strokeStripNear` emits comes out negative."],
    V)
add("cov.ringsFromLoops", "ringsFromLoops(loops, tol)",
    "Rings from loops in the stored grammar, arcs sampled from their own centre and angles within `tol`, for the two functions above.",
    ["Reads the raw numbers (a `Loop`'s `buf` or an array), all four piece codes. Sampling from the centre is allowed here and forbidden to the rasteriser, which is why this is not the reference for a far-centre arc: the arc suite checks those against the exact contour."],
    V)


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    "cvp.buried": {
        "why": "names F13 for the burial-window defect; the code and OPEN-FLAGS put it under F15 (its first defect)",
        "what": None,
        "long": ["A pure function of POSITION - no part of the centerline is excluded. Excluding a window around the tested piece's own generator made the predicate differ between neighbouring pieces of one chain, which was F15's first defect.",
                 "The oracle's chords lie inside the true curve by up to its tolerance, so that tolerance is subtracted from the threshold and burial errs towards keeping boundary."],
    },
    "cvp.offsetSide": {
        "why": "describes offsetLoop (one closed loop, caps included); offsetSide returns one side of the offset only, without caps",
        "what": "One side of the stroke's offset as a tangent-continuous chain, each piece tagged with the centerline cubic it came from.",
        "long": ["Straight cubics are offset along their end tangents so they meet fitted neighbours without a step; a tangent break gets a round join on both sides, the inner one buried and culled later. A `live` mask skips cubics whose offsets cannot reach the boundary.",
                 "Exported because the incremental baker needs the body without caps; `offsetLoop` joins both sides and the caps into the one loop the resolve cuts."],
    },
    "v0._renderActive": {
        "why": "says every frame; it runs on every render call (a mutation, crossing, tile fault-in or fat rebake), not every animation frame",
        "what": None,
        "long": ["Every call removes every SVG path and rebuilds them all, with no diffing: ISSUE-11, and the primary driver of BUG-01."],
    },
    "v0.KobinEngineV0": {
        "why": "says it is the last thing keeping clipper-lib; DESIGN.md §15 names the legacyOffset branch of derive.bandRings, which the golden compare walks, as holding it too",
        "what": None,
        "long": ["Everything the current engine splits across LevelMap, Document, Camera, TileStore and Renderer, in one file, with live projection instead of bidirectional tiles.",
                 "Kept as the golden oracle: `derive.test.js` requires `deriveStep` to equal `_deriveInto` on the same inputs, which is what makes the extraction provable rather than asserted. With the `legacyOffset` branch of `derive.bandRings` that comparison walks, it is what keeps `clipper-lib` in the dependency list (DESIGN.md §15)."],
    },
    "sks.Crumb": {
        "why": "says the cull that consumed the crumb was removed; it is off by default behind `opts.cull` in curvePerimeter, and strokeShape's own bake still culls with it",
        "what": None,
        "long": ["The grid `strokeShape`'s bake culls capsules with, and the one schedule C maintains while drawing. In `curvePerimeter` the cull that reads it is off by default (`opts.cull`) as unsound (F11), so by default C maintains a structure nothing reads."],
    },
    "bks.CrumbBaker": {
        "why": "says the crumb cull was removed; it is off by default behind `opts.cull`, so the crumb is read only when that flag is set",
        "what": None,
        "long": ["About a quarter of B's per-sample cost and still most of A's pen-up bill, because the oracle is only about a tenth of the work.",
                 "Its crumb is read only when `opts.cull` turns the crumb cull on, which is off by default as unsound (F11), so by default it is really 'pre-build the distance oracle'."],
    },
    "bks.runBaker": {
        "why": "says the labs drive it; the bake labs and their routes no longer exist, and only the test suites call it",
        "what": None,
        "long": ["The comparison harness `bakeStrategies.test.js` drives: one sample list through `addSample` and `finish` for any schedule named by its letter."],
    },
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]
