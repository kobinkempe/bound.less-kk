# -*- coding: utf-8 -*-
"""Comprehensive descriptions — Camera, LevelMap, frameLattice, Document."""

L = {
# ---- Camera ---------------------------------------------------------------
"cam.screenToFrame": [
 "Converts a pixel position into the active box's own coordinates: subtract the pan, divide by the in-level zoom.",
],
"cam.frameWindow": [
 "The visible rectangle, in the active box's coordinates, optionally grown by a margin.",
 "This is what decides which tiles are needed and which objects are worth looking at.",
],
"cam.centre": [
 "The view centre in the active box's coordinates.",
 "Small but load-bearing: this is the point that decides which child box a crossing lands in, and whether the view has walked out of its box.",
],
"cam.panBy": [
 "Adds a pixel delta to the pan, then settles the camera into a legal state.",
],
"cam.zoomFactorAt": [
 "Scales the zoom about a screen point, holding that point still.",
 "**Refuses a non-positive or non-finite factor.** That would drive the zoom below the exit threshold permanently, and the crossing loop would then try to cross down forever — multiplying a negative number by the ratio never brings it back above the threshold.",
 "Finalises any live stroke first, through a hook back into the engine, so a stroke is never left spanning a crossing.",
 "Then settles, which may cross a level, step sideways, or both.",
],
"cam._settle": [
 "Crosses and shifts until the camera is in a legal state, and reports whether the active box changed.",
 "A loop, because one adjustment can require another: crossing down can leave the view outside its new box, which requires a sideways step, which can itself expose another crossing. Guarded against spinning on bad input.",
 "Called on load as well as on every gesture. A saved file records whatever the camera was, which need not be legal — until this ran at load, the *first* interaction after opening a drawing paid for the crossing, measured at 200 ms once and 0.2 ms every time after, which read as 'panning is slow'.",
],
"cam._maybeShift": [
 "Moves the camera into the neighbouring box when the view centre has left the current one.",
 "Pure bookkeeping: the world does not move, only which box's coordinates describe it. The offset is a whole number of boxes, so the pan adjustment is exact.",
 "**Never fires while the pen is down.** A live stroke's samples are being written against its box's origin; moving the box mid-gesture would append later points against a different origin and tear the stroke in half. It waits, and the over-wide stroke is promoted at pen-up instead.",
],
"cam._crossUp": [
 "Crosses into the child box the view centre falls in.",
 "Asks the box tree for that child (minting it on first visit), then rewrites the zoom and pan so the picture on screen does not move — the same view, described in the child's coordinates.",
],
"cam._crossDown": [
 "Crosses out into the box that contains this one.",
 "Simpler than crossing up: the parent is determined by containment, so there is nothing to fit to the camera. The zoom and pan are rewritten through the same edge, in reverse.",
],
"cam.effectiveZoom": [
 "The absolute zoom — the crossing ratio raised to the depth, times the in-level zoom.",
 "This is the number the scale bar reads, and the only place the whole magnification is expressed as one value.",
],

# ---- LevelMap -------------------------------------------------------------
"lm.cellChild": [
 "Returns the child box at a given index, creating it if this is its first visit.",
 "**Carries out-of-range indices.** An index outside the balanced range names a box this parent does not own, so it carries up to a sibling of the parent and recurses — the same arithmetic a long addition uses.",
 "That carry was a hope rather than an invariant until it bit: a camera that crossed while its centre sat just half a percent outside the parent's square minted a box at an illegal index. The session carried on fine; the damage showed on **reload**, where the file was refused outright and the drawing could not be opened at all.",
],
"lm.findCellChild": [
 "The child box at an index, if it already exists. No side effects.",
 "Refuses out-of-range indices outright rather than carrying, because resolving a carry would have to create boxes and this is required not to.",
],
"lm.neighbour": [
 "The box a given number of steps away at the same depth.",
 "Adds the offset to this box's index; if that runs off the end of the range, the excess carries up to the parent, recursively — creating coarser boxes if the tree does not reach that far yet.",
 "Panning sideways and dragging an object sideways are the same operation seen from two ends, and both come through here.",
],
"lm._growRoot": [
 "Gives a parentless box a parent, so it can have siblings.",
 "The new coarser box is by definition the one containing it, so its index is zero and the origin chain stays the origin chain. Exact, and it leaves every existing box id untouched.",
],
"lm.peekRing": [
 "The existing boxes surrounding one box at its own depth — up to eight.",
 "Never mints. Reading tiles must not grow the tree, or looking at a drawing would change it.",
],
"lm.peekNeighbour": [
 "One neighbouring box, if it already exists.",
 "A parentless box has no siblings yet and this must not invent any: returning the box itself would make every direction resolve to the same place, and a caller ringing the eight neighbours would get one box eight times.",
],
"lm.ensureChild": [
 "The child box a crossing at this camera position lands in, minting on first visit.",
 "A pure function of **where the view centre is** — no history, no reuse test, no nearest-neighbour search. That is what makes returning to a place a lookup rather than a decision, and it is why aiming one pixel differently on the way down no longer creates a whole new branch.",
],
"lm._viewCell": [
 "Which child box the view centre falls in, as an index pair.",
],
"lm.ensureParentEdge": [
 "Makes sure a box has a parent (crossing down needs one) and returns the edge between them.",
],
"lm.tileRange": [
 "Which cache tiles a rectangle reaches, as an index range.",
 "The cache partition is frame-aligned and constant, and only decides how much work one bake covers — it never cuts geometry.",
],
"lm.rectToParent": [
 "A rectangle, expressed in the parent box's coordinates.",
],
"lm.framePath": [
 "The route between two boxes: up to their common ancestor, then down.",
 "Cached, because this is called for every object, every tile, every render — on a seventeen-level document the walk alone dominated a pan. The cache is dropped whenever a box is minted, which is the only time the tree changes.",
],
"lm._buildPath": [
 "Computes an uncached route: collect one box's ancestors, walk the other's until they meet, then list the downward steps.",
],
"lm.frameFactor": [
 "The scale between two boxes — the product of the per-step ratios along the route.",
],
"lm.mapPointF": [
 "A point from one box's coordinates into another's, **one edge at a time**.",
 "Going up divides and adds the box centre; going down subtracts the centre and multiplies. Never composed into a single jump, because a composed jump upward cancels catastrophically.",
],
"lm.mapRectF": [
 "A rectangle across boxes, by mapping two opposite corners and re-normalising.",
 "Every edge is a uniform scale plus a shift, so a rectangle maps to a rectangle exactly — which is why the erase prefilter projects boxes rather than geometry.",
],
"lm.projectF": [
 "An object, expressed in another box's coordinates.",
 "**A resolved outline survives untouched.** Every edge is a uniform scale plus a translation, so an arc stays an arc: the endpoints move and the bulge does not change at all. The perimeter crosses a level with no re-resolving and no fitting, which is the property the whole representation exists for.",
 "Hops are applied **one edge at a time**; a composed long jump cancels going up.",
 "The object's own tile-grid offset rides along, because a sideways hop is a whole number of boxes and leaves it alone, and a level crossing transforms it the same way the ink is transformed.",
 "Raw strokes and legacy polygon fills take simpler paths through the same route.",
],
"lm.displaceFrame": [
 "Where a box ends up when its contents are displaced — the whole of a move at depth, as integer arithmetic.",
 "Expands the displacement into whole-box digits, one per level between the level the drag was made at and the object's own.",
 "Adds those digits to the box's address, with carries.",
 "A carry off the **coarse** end means the move crossed a box boundary at or above the level it was made at, which is real, so the ancestor steps sideways to absorb it.",
 "What the digits could not express comes back as a remainder, in the box's own units and smaller than one box — **the only part that ever touches geometry**.",
],
"lm.chainFrom": [
 "An object's address relative to an ancestor: the list of box indices, coarsest first.",
],
"lm.frameAtChain": [
 "Walks (and mints) the box at a given address below a root.",
],
"lm.tileRect": [
 "One cache tile's rectangle. Tiles are centred on their index, like boxes.",
],

# ---- frameLattice ---------------------------------------------------------
"fl.cellOf": [
 "Which child box a point falls in — a **round**, not a floor, because boxes are centred on their index.",
 "That one choice makes the origin a fixed point of the whole descent. Cornering boxes on the origin instead puts the world origin on a box corner, so zooming into it walks to the corner of every box at every depth and everything drawn there straddles four boxes.",
],
"fl.cellEdge": [
 "The conversion from a parent's coordinates into a child box: scale by a fixed power of two, shift by the index times another.",
 "Both constants are powers of two, so the conversion spends no precision at all — only the index costs mantissa bits.",
],
"fl.cellCentre": [
 "A child box's centre in the parent's units — an exact whole number.",
 "Transforms subtract this *before* scaling. Doing it the other way forms a large product and then adds a large offset of the opposite sign, which throws away the small digits before the addition can recover them.",
],
"fl.carryDigit": [
 "Splits an out-of-range index into a carry and an in-range digit.",
 "Exact: both operands are whole numbers far inside the range a double represents exactly.",
],
"fl.displacementDigits": [
 "Expands a displacement into whole-box digits plus a remainder.",
 "Every step is exact — a division by a power of two, a truncation, and a multiplication by a power of two — so the digits and the remainder reconstruct the original to the last bit.",
 "That exactness is what makes a slow drag add up to precisely what a fast one does, by construction rather than by bookkeeping.",
 "A digit counts **boxes, not units**, which is what makes the base exactly the crossing ratio and the carry clean.",
],
"fl.applyDigits": [
 "Adds a displacement's digits to an address, with carries.",
 "Reports two leftovers: a carry that ran off the coarse end, which is a real move of the ancestor, and a residue that ran off the fine end, which becomes an ordinary sub-box translation.",
],
"fl.childTilePhase": [
 "The object's cutting grid, one level down.",
 "The grids nest, which is what makes the decomposition a fixed property of the object's geometry at every level rather than a per-level decision.",
],
"fl.objTileRange": [
 "Every tile of an object's grid that a rectangle reaches, as a **half-open** range.",
 "The half-open part matters more than it looks. A tile is the same size as a cache square, so a square that ends exactly on a boundary — which is what happens whenever the object has not been moved — belongs to the tile below, not the one above. Rounding both ends the same way turns 'this square is exactly one tile' into three per axis, which is nine times the area stored per square: measured at 49 ms to 258 ms on one render.",
],
"fl.objTileRect": [
 "One tile of an object's own grid, centred on its index.",
],
"fl.objTilesRect": [
 "The rectangle a window of whole tiles spans.",
 "This is what geometry gets clipped to, so every cut in the engine lands on a line of the object's own grid — which is what makes two cache squares holding the same stretch of curve hold bit-identical pieces of it.",
],

# ---- Document -------------------------------------------------------------
"doc.allocId": [
 "Hands out the next id. Ids are creation order, which is also drawing order, and they are never reused.",
],
"doc.add": [
 "Adds an object to a box's bucket, indexes it, and announces it.",
 "A **live** object — a stroke still being drawn — is kept out of the spatial index, because its extent is still growing and an index entry would be wrong the moment it was made.",
],
"doc.finalize": [
 "Marks a live stroke finished: indexes it against its final extent and re-announces it, so the tile cache invalidates against the right footprint.",
],
"doc._emit": [
 "Notifies every subscriber of a change.",
 "The tile cache is the main subscriber, and it needs both directions: deeper tiles inherit an object magnified, coarser tiles inherit it minified.",
],
"doc._forgetIfEmpty": [
 "Drops a box's bucket when its last object leaves.",
 "Not housekeeping. Buckets are walked per tile bake and scanned per lookup, so an empty one costs on every render for the rest of the session — and they accumulate fast, because a drag re-homes on every pointer event and every erase cedes down a chain.",
 "Measured on a real session: 4,343 of 4,369 buckets were empty, and dropping them took a render from 195 ms to 23.",
],
"doc.at": ["Every object homed in one box. A plain array read."],
"doc.getById": ["Finds an object by id, scanning the buckets."],
"doc.editGroup": [
 "Every object sharing one family key.",
 "A family is the pieces of one logical object spread across levels by ceding. They select, move and undo together.",
],
"doc.queryRect": [
 "Objects overlapping a rectangle at one level, from the spatial index, plus any still-growing live stroke — which cannot be indexed and so is reported unconditionally.",
],
"doc.removeById": [
 "Removes an object from whichever box holds it, de-indexes it, forgets the bucket if it is now empty, and announces the removal.",
 "Derived copies at other levels carry the source id, so this is 'erase everywhere'.",
],
"doc.insertAt": [
 "Puts an object back at a remembered position — the undo of an erase. Position only affects the array; drawing order comes from the id, which the object kept.",
],
"doc.moveById": [
 "Translates an object by a delta.",
 "A resolved outline is **replaced, never shifted in place**: consecutive pieces share their endpoint arrays, which is what makes the perimeter watertight, so mutating coordinates would move every shared point twice and tear the shape apart along its own seams.",
],
"doc.setGeometryById": [
 "Replaces an object's geometry outright.",
 "A drag needs this rather than a chain of translations. Applying each pointer event's increment to the result of the last makes the final position depend on how many events there were — forty one-unit steps and one forty-unit step accumulate different rounding.",
 "Recomputing from the geometry the drag *started* with makes a slow drag and a fast one literally the same arithmetic on the same numbers, and makes a there-and-back drag return bit-exactly.",
],
"doc.snapGeometry": [
 "A detached copy of an object's geometry, safe to translate from later.",
 "**Includes the tile-grid offset**, because that offset is geometry: it is where the object gets chopped, and a chop is where a curve may become a line. A drag that left it behind would slide the object out from under its own cutting grid — the exact failure the object-anchored grid exists to prevent.",
],
"doc.scaleGeometry": [
 "A geometry snapshot under a uniform scale about a point.",
 "Used to change an object's **units** — promoting an over-wide object to its parent level, where the same ink is described by numbers a crossing ratio smaller. Dividing by a power of two is a change of units and not a loss of relative precision: the mantissa is untouched and only the exponent moves.",
],
"doc.translateGeometry": [
 "A geometry snapshot, moved. Never mutates the snapshot, so a drag can translate from the same starting state on every event.",
],
"doc.rehomeById": [
 "Moves an object to a different box **without touching a single coordinate**.",
 "This is what makes a move at depth survive. A drag used to translate every member's geometry by the displacement times the ratio raised to the separation, which for a member five levels below the camera meant rewriting coordinates to 7.3 × 10¹⁸ and destroying 82.9% of its area.",
 "Under the box lattice the whole-box part of any displacement is a change of **address**: the object lands in the box that many steps along, and because neighbouring boxes' origins differ by exactly one box width, the same local coordinates describe the moved object exactly.",
 "Emits a removal and an addition so caches invalidate both where the object was and where it now is — but **tagged**, because anything tracking identity must not read it as the object going away. Without the tag a drag drops every member the moment it re-homes and the rest of the gesture moves only what happened to stay put.",
],
"doc.eraseReplaceById": [
 "Replaces an object with the regions an area erase left of it.",
 "Each region becomes its own object with a fresh id, inheriting the source's drawing order, colour and opacity, so disjoint leftovers select and re-erase independently with tight bounding boxes.",
 "**One region keeps the family key** — that is the same object with less ink, a bite that did not sever. **Several regions is a split**, and the pieces are rightly strangers. Getting this wrong cost two debugging rounds: outlining a stroke minted a new family key, so every reference taken beforehand silently named nothing.",
 "The pen width travels with every piece, so a stroke cut in two still clusters as the stroke it was rather than as two blobs the size of their bounding boxes.",
],
"doc.cedeTileById": [
 "Cuts a tile out of an object and hands its ink to a new object one level down.",
 "**The parent is genuinely cut**, not annotated. It used to keep its geometry whole and record a rectangle it had given away, which rendering subtracted per view — that meant a stale picture on the fast zoom path, renders costing hundreds of milliseconds rebuilding it, and a parent still whole underneath so severance needed a second, worse cut.",
 "The cut is the exact arc boolean, the same one everything else uses. It is precision-safe where baking the *erase* into the parent never was: a tile is a modest fraction of the parent's own box and perfectly ordinary to represent, while the erase inside it is thousands of times finer.",
 "Works local to the rectangle, because at depth the parent's coordinates run to 10¹³ while the ceded tile is a few units across.",
 "**Drops the dust.** Cutting a rectangle out can leave a sliver along one of its edges where the parent's boundary all but grazed it, and a dust object is a speck the user later finds and cannot get rid of.",
 "The remnant may fall into several connected pieces; they all stay in one family, and so do the children. Whether the family is still one *object* is asked separately.",
 "The child inherits the parent's cutting grid expressed in its own units, so a family clips on one partition at every level and a doorway still lands on the cut that made it.",
],
"doc.bakeShapeById": [
 "Turns a drawn stroke into its resolved outline, in place.",
 "**Keeps the id**, and so the drawing order, the selection pointing at it, and every undo record that names it.",
 "Drops the centreline: it has done its job, nothing downstream reads it again, and keeping both would mean keeping them in agreement forever. The pen width survives as a property of the shape, which scene clustering needs and a perimeter cannot otherwise report.",
 "**Pushes no undo entry.** Baking is a system action — the user drew a stroke, and undo must reverse *that*, not the machine's decision about how to store it.",
],
"doc.fillToShapeById": [
 "Converts a legacy polygon fill into a resolved outline, in place.",
 "Only ever called when something is about to cut the object. Everything else reads a fill perfectly well as it is, so this is not a migration — it is a promotion at the moment it pays for itself. One recorded drawing carries a 1.8-million-vertex fill, and converting that at load would cost more than everything else on the way in put together.",
],
"doc._afterEdit": [
 "After any edit: drop the derived caches attached to the object, bump its edit counter, reindex it, and announce the change **with the old footprint** so the tile cache can invalidate where the object was as well as where it is now.",
 "The edit counter matters more than it looks: the renderer's signature rounds coordinates, and at the deepest in-level zoom a whole pixel of drag is below that rounding. Without the counter a dragged object would keep its old path and sit still while the pointer moved.",
],
"doc.pushUndo": [
 "Records an action, caps the history, and clears the redo branch — a fresh action forks history.",
],
}
