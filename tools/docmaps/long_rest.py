# -*- coding: utf-8 -*-
"""Comprehensive descriptions — everything the Code Map lists that the call
graph does not: the remaining engine functions, scenes, the scale bar, the
shell, and the files that no longer run."""

L = {
# ---- frameLattice ---------------------------------------------------------
"fl.BASE": [
 "The lattice constants: the shallowest and deepest in-level zooms, the crossing ratio between levels, the box width, the child-box width in parent units, and the per-digit shift.",
 "**Every one is a power of two.** Scaling by a power of two is exact — only the exponent moves — so crossing a level spends no precision at all, and a box origin costs mantissa bits only for its index.",
 "The previous values were neither exact nor evenly divisible: the box width divided by the ratio was not representable at all, so every box origin in that build was already slightly wrong before anything was drawn.",
],
"fl.inDigit": ["Is an index inside the balanced range one box can hold? Balanced around zero, so an object settles in the nearest box rather than the containing one, sitting near the middle and overlapping fewer neighbours."],
"fl.digitValue": ["How far one whole-box step at one level moves something measured in the units of another level — the conversion that lets a displacement be checked across levels."],
"fl.tilePhase": [
 "Normalises a cutting-grid offset into one tile's width.",
 "Guards two real defects. A remainder a hair below zero rounds to **exactly** one tile width when the width is added, because the width needs six significant digits and anything under about 10⁻¹¹ vanishes against it — that is the same grid as zero but sits outside the half-open range every other check assumes, and it made a real drawing unloadable.",
 "And negative zero is the same number as zero but not the same value: an offset is compared for equality across a save, across a move, and between a parent and the child that inherits its grid, so handing back a negative zero would make one of those compare false for no reason.",
],

# ---- Camera ---------------------------------------------------------------
"@Camera.constructor": [
 "Builds the camera: the active box, the in-level zoom, and the pan.",
 "Takes two hooks back into the engine — one to finalise a live stroke before a crossing, and one to ask whether the frame must be held still because the pen is down.",
],
"cam.Camera.activeLevel": [
 "A depth facade over the box id.",
 "The interface, the scale bar, scenes and snapshots all speak depths, while identity is the box. Setting a depth resolves to that depth's origin box; reading one asks the tree how deep the active box is.",
 "`set` and `state` restore and capture the whole camera, and are what a saved file round-trips.",
],
"cam.zoomAt": ["Wheel and pinch, converted into a zoom factor about a point. Both land in the same place, so there is one crossing path and not three."],
"cam.levelPointToScreen": ["A point in any box's coordinates, converted to pixels, by routing through the active box and then applying the zoom and pan."],

# ---- LevelMap -------------------------------------------------------------
"lm._addFrame": [
 "Mints one box: its id, parent, depth, index, derived edge and centre.",
 "Wires it into its parent's child map and drops the route cache, which is the only time the tree changes shape.",
 "The centre is stored rather than derived at use, because transforms subtract it before scaling and it must be the same number everywhere.",
],
"lm.frame": ["Plain tree reads: a box by id, its depth, its parent, its children, the origin box at a depth, and the box on a given path at a depth. No side effects."],
"lm._isSpine": [
 "Id minting. The origin chain keeps the historical id — the depth as a string — and everything else is its parent's id plus its index.",
 "Ids are document keys and cache keys, so a box's id must never change once minted. Crossing down mints the coarser box containing the current one, which is why the origin chain stays the origin chain and existing ids are untouched.",
],
"lm._recOf": [
 "The legacy per-depth record view of the tree.",
 "Snapshots, scenes and the development tools still speak depth integers and per-level records, so the origin chain is presented in that shape. The record's edge is derived and its grid is a constant, so this is a view rather than stored state.",
],
"lm._frameFor": ["Accepts either a box id or a bare depth, so numeric callers and tests keep working unchanged."],
"lm.phaseThrough": [
 "Carries an object's cutting-grid offset along a route between boxes.",
 "Up a level the grid coarsens and the box centre comes back; down a level it is the child transform. A sideways hop is a whole number of boxes and **leaves the offset alone** — which is exactly why two numbers are enough to pin the grid to the object through every kind of move.",
],
"lm.ensureSpine": [
 "Grows the origin chain to a requested depth, in either direction.",
 "Growing upward mints a new coarser root and adopts the old one as its child. Growing downward mints origin children. Both leave existing ids untouched.",
 "`reset` wipes the tree back to a single root; `resize` records a new canvas size and **changes no geometry at all**, because grids are constants now rather than derived from the canvas.",
],

# ---- Document -------------------------------------------------------------
"doc.LevelIndex": [
 "A uniform grid hash per level, with an overflow list for anything larger than a cell.",
 "Objects are indexed by their painted extent. A stroke gets a half-width margin, because round caps and joins never reach further than that from the centreline; a resolved outline gets **none**, because its bounding box already *is* the ink.",
],
"doc.query": [
 "The objects overlapping a rectangle.",
 "Falls back to a flat scan when the query would span more cells than there are objects, or absurdly many — a magnified region can cover billions of cells, and walking them is far worse than checking every object once.",
],
"doc._undoMove": [
 "Reverses a move: the **address first**, then the sub-box translation.",
 "In that order, because the translation is expressed in the box it belongs to, and two boxes' units are only the same because they are at the same depth.",
 "Restores the geometry the drag started from rather than translating by the negative, so a there-and-back trip is bit-exact instead of a float's width away.",
],
"doc.clear": [
 "Wipes the document, carrying whatever engine state must round-trip with it — the camera and the box tree — so undoing a clear restores the view as well as the ink.",
],
"doc.serializeNatives": [
 "Writes every object out, with a whitelist per type so runtime-only fields never reach a file.",
 "A resolved outline is written as its encoded loops, which is usually **smaller** than the samples it came from, because burial culling threw most of the chain away.",
 "Drawing order is written only when it differs from the id, so ordinary files stay byte-identical to what earlier builds produced.",
 "The cutting-grid offset is written because it is geometry: drop it and a reloaded drawing subdivides somewhere else, which moves every straightened chord in it.",
],
"doc.loadNatives": [
 "Reads objects back, repairing what it can and refusing nothing it can mend.",
 "**Strips retired fields** at the door rather than carrying inert state that still looks meaningful — a field recording where a hole *should* have been is worse than no field at all.",
 "**Repairs unclosed outlines** on the way in, so a drawing damaged by an older build opens, renders, and — the part that matters — saves.",
 "**Leaves legacy polygon fills alone.** Converting at load would be the one expensive thing a load does; one recorded drawing carries a 1.8-million-vertex fill. They are promoted only when something needs to cut them.",
 "**Never reuses an id**, counting family keys as well, because an object whose id happened to equal a live family key would silently join that family.",
 "Drops empty buckets, which is what repairs the drawings that already carry thousands of them.",
],

# ---- persist --------------------------------------------------------------
"per.encodeDrawing": [
 "Wraps the engine's own serialised state in a versioned envelope: a sniffable format marker, a version, metadata, the camera, the box tree, and the objects.",
 "The payload shapes are exactly what the collaborators produce, so the envelope adds validation without adding a translation layer that could drift.",
],
"per.decodeDrawing": [
 "Reads a file back, validated, or throws with a human-readable reason.",
 "Refuses a version newer than this build understands, and accepts the legacy development snapshot as well, which is how old autosaves keep opening.",
],
"per.decodeMeta": [
 "Reads the metadata: name, timestamps, the scale definition, and the scenes.",
 "Scenes validate **leniently** — they are regenerable, so a malformed entry is dropped silently rather than failing the whole drawing.",
],
"per.isFrameKey": [
 "Recognises a box key: a depth integer, or a lattice path built from one.",
 "The old free-floating sibling form is deliberately **not** accepted — a scene naming one would point at a box no document can contain.",
],
"per.decodeCamera": ["Reads the camera state, which the engine then settles into a legal one — a saved camera need not be inside the legal zoom band, and a converted one can land outside it too."],
"per.decodeNatives": [
 "Validates every object: known type, finite numbers, well-formed geometry.",
 "**Hard-fails on anything that would crash or corrupt** and stays lenient about everything else — unknown fields are preserved untouched, so an older build can open a file written by a newer one that only added fields.",
],

# ---- biarc ----------------------------------------------------------------
"bia.distinctSamples": ["Drops repeated pen samples, which a stationary pointer produces in quantity and which would otherwise give the spline zero-length gaps to fit."],
"bia.chainFor": [
 "The whole centreline as arcs, in one pass.",
 "Optionally skips the how-far-from-the-old-curve measurement, which is a second sweep over every gap and exists only to fill a readout — it was 40% of the wall clock of a resolve that does not need the number.",
],
"bia.arcSagitta": ["How far an arc bulges from its chord — the measure everything straightness-related is decided by, computed without the centre."],
"bia.arcToCubics": ["One arc as cubic curves, for the drawing library, which speaks nothing else. Split into quarter-circle spans where the conversion is accurate far below display tolerance."],

# ---- arcPerimeter / arcShape ---------------------------------------------
"arc.Grid": ["A uniform spatial hash: a cell size, a map from cell to item list, insertion by bounding box, and a query that visits the items whose cells a box overlaps. The broad phase behind every crossing test."],
"arc.VertexSet": ["Position-to-identity, so two coordinates that name the same place get the same number. Neighbouring cells are searched as well as the point's own, because a pair of coordinates either side of a cell boundary is not a pair of different places."],
"arc._charge": [
 "The slicing bookkeeping: bill the time actually spent in this slice, aim the next burst at about a millisecond from what the last one cost, and record per-phase totals at each boundary.",
 "Wall time **between** slices is the user drawing, not the resolve, so costs have to be accumulated at every boundary rather than read off a start timestamp.",
 "Each burst is capped as well as targeted, because per-item cost varies by orders within a single phase and a burst sized on cheap items would otherwise run far past its budget before looking at the clock again.",
],
"shp.VertexSet": ["Position-to-identity, so two coordinates that name the same place get the same number. Neighbouring cells are searched as well as the point's own, because a pair of coordinates either side of a cell boundary is not a pair of different places."],
"arc._charge": [
 "The slicing bookkeeping: bill the time actually spent in this slice, aim the next burst at about a millisecond from what the last one cost, and record per-phase totals at each boundary.",
 "Wall time **between** slices is the user drawing, not the resolve, so costs have to be accumulated at every boundary rather than read off a start timestamp.",
 "Each burst is capped as well as targeted, because per-item cost varies by orders within a single phase and a burst sized on cheap items would otherwise run far past its budget before looking at the clock again.",
],
"shp.validEncodedLoops": [
 "Two checks, kept separate because the two failures deserve different answers.",
 "**Numbers that are not numbers** mean the file is not ours, and there is nothing to do but refuse it.",
 "**A chain that does not close** is damage a build of ours once did, and refusing that means refusing to open a drawing over an object that can be mended.",
],

# ---- derive ---------------------------------------------------------------
"der.shapeTol": [
 "The quarter-pixel budget, expressed in a level's own units at its deepest in-level zoom — the worst case that level ever shows.",
 "The flattening tolerance and the curve-becomes-a-line threshold are **deliberately the same number**: a freeze is a swap of source of truth, and it must never be coarser than the flattening the renderer is already doing, or the swap would be visible at the moment it happened.",
 "Depends on the config and nothing else — not the canvas, not the tile, not the camera — which is what makes freezing happen at the same time every time a shape is baked.",
],
"der.tilePhaseOf": ["An object's cutting-grid offset, or the frame-aligned default for an object that has never been moved."],
"der.displayChords": [
 "Cached flattenings of a centreline at fixed fidelities.",
 "View-independent by design, so every tile of a level cuts the **same** chord vertices at the shared grid lines however and whenever it happens to be built — which is what keeps fill seams exact between neighbouring tiles.",
],
"der.rectSubtract": [
 "A rectangle minus axis-aligned holes, as up to four disjoint rectangles.",
 "Pure floating point, deliberately: an integer difference would quantise the hole back onto a grid, which is the whole thing re-homing exists to avoid.",
],
"der.projectNative": ["The depth-integer projection and scale factor, kept so the previous engine can still be compared against byte for byte — the discipline of generalising and then proving the original parameters give the original answer."],

# ---- TileStore ------------------------------------------------------------
"@TileStore.constructor": ["Builds the cache and subscribes to the document, so every change patches or invalidates the tiles that could hold it. Destroying unsubscribes and drops everything."],
"ts.setOpacityGroups": ["A policy change invalidates the whole cache at once, by moving an epoch counter rather than walking and clearing — a stale tile then simply fails its epoch check."],
"ts._depth": ["Depth helpers, and the shallowest and deepest levels that actually hold content — which is what lets a whole direction be skipped when nothing is there."],
"ts.size": ["Cache size and keys. Test-facing only."],

# ---- Renderer -------------------------------------------------------------
"rnd._gatePx": [
 "The wide-stroke gate: whether a stroke is painting wider than the limit now, whether it could ever within its level, and which representation it is currently using.",
 "The gate is fidelity-neutral — raw stroking and the outline agree to well under display tolerance — so its value only trades safety against browser mis-stroking of enormous widths against the work of fitting outlines.",
],
"rnd._isTemporary": ["Debug colouring: which role a piece arrived by — the level's own ink, magnified from coarser, or minified from finer — so the tile machinery can be seen rather than inferred."],
"rnd.setSelectionAnts": [
 "The marching-ants indicator: a band drawn on the object's own silhouette, plus marks and arrows at the screen edge where the object carries on past the view.",
 "Pooled elements rather than rebuilt ones, and the dash pattern is fitted to each ring's measured length so the ants stay evenly spaced instead of bunching at the join.",
],
"@Renderer.setOpacityGroups": ["Settings pass-throughs. Plumbing."],
"rnd._renderEraseDebug": [
 "The debug overlays: tile rectangles, and what an erase actually touched.",
 "The erase overlay classifies a boundary by asking exactly the question severance asks, sharing the same perimeter-parameter code — a second, parallel notion of 'where on the rectangle is this' would drift from the one the engine severs on, and then the picture would lie.",
],

# ---- connect / hittest / clipper / curveOutline ---------------------------
"con.asRect": ["Accepts either rectangle shape the codebase uses, so callers do not have to care which one they hold."],
"hit.capsuleTouchesRings": ["Does a pen-width capsule touch this ink? The eraser's proximity test, before any boolean runs."],
"hit.windingOfPoint": ["Inside or outside, for polygon rings — the fill rule the polygon-speaking consumers use."],
"ply.controlsFor": ["The spline control points for one sample and its neighbours — the same cardinal spline the app has always drawn, so the arc chain is measured against the curve users already saw."],
"ply.rectDistMin": [
 "Flattens only the part of a curve that can shape a window's band edge.",
 "Prunes by distance from the window: anything too far inside or outside cannot contribute. Without the prune, one magnified stroke ran to millions of nodes and exhausted memory.",
],
"ply.ringSignedArea": ["Ring area, net area over a set of rings, and a capsule as a polygon — the polygon-side measures, used where the arc-side ones do not apply."],
"clb.subtractPolys": [
 "The integer polygon boolean.",
 "**No live caller.** It is reached only from the dead recipe module and from tests, which is what makes 'no boolean in the running engine touches an integer grid' a fact about the import graph rather than an assertion.",
],
"ply.decimatePolyline": [
 "Simplifies a centreline to a tolerance.",
 "The analytic strip emits one ring per segment, so the point count *is* the ring count — a caller that only needs the result at a known on-screen resolution should say so, while a tile bake, which must stay view-independent, keeps every point.",
],
"cvo.cubicAt": ["Curve primitives: a point, a direction, a split, a straight segment as a curve, and how far a curve strays from its own chord."],
"cvo.arcSegments": ["Round joins and caps as curves — the pieces a capsule outline is assembled from."],
"cvo.tillerHanson": [
 "Fits an offset curve to a tolerance, by the classic construction plus a measured error and recursive subdivision.",
 "**This is the approximation the arc representation exists to avoid.** It is kept because a display outline can afford a fitted offset and an exact cut cannot: every question asked of a fitted offset is asked of an approximation, and at a shallow crossing the disagreement is amplified enormously.",
],
"cvo.reverseSegs": [
 "Assembles one capsule around a **run** of consecutive curve pieces rather than one per pen sample.",
 "A run is taken as far as the curvature stays bounded relative to the pen; anything wilder gets its own capsule, whose cap overlap restores the coverage locally. Worth roughly 15,000 outline segments down to 1,000 on a long freehand stroke.",
],
"cvo.strokeOutlineCurves": ["The whole stroke as curve loops, and the straight-line special case, which needs no fitting at all."],
"cvo.loopsBbox": ["Measures and flattens curve loops — what the connectivity walk reads when it needs a raw stroke's painted area as polygons."],

# ---- KobinEngine instruments and shell ------------------------------------
"ins.EventLatency": ["Input-to-pixels latency, straight from the browser, kept as the worst handful. The only instrument that measures what the user actually waits for between touching the screen and seeing ink."],
"ins.GrowthLog": [
 "What accumulates over a session: object counts, cached tiles, empty buckets, heap where the browser exposes it.",
 "Sampled on a schedule rather than per operation, because the question it answers is about drift over minutes, not cost per frame.",
],
"ins.FrameMeter": [
 "Frame timing: a histogram plus the worst frames with timestamps, so a stall can be lined up against the operation log and the journal.",
 "Always on, because it costs nothing until something is slow — but it cannot tell a backgrounded tab from a freeze, so very long entries need reading with that in mind.",
],
"eng.reportFamilies": ["Diagnostics for multi-level objects: which pieces belong to which family, where their doorways are, and what an erase actually touched — the report fields that made severance debuggable at all."],
"@engine-life.constructor": [
 "Wires the collaborators together: the box tree, the document, the camera, the tile cache and the renderer.",
 "Injects one pure function into the document so it can convert between boxes without owning a camera or a tree.",
 "Subscribes to the document so a vanishing object cannot leave a stale selection — and deliberately ignores a re-home, which is a change of address rather than the object going away.",
],
"@engine-life.activeLevel": ["The compatibility surface the interface and the tests read: camera fields, objects by box, the record view, the current display list, and the ported display invariants. Pass-throughs."],
"eng.setTool": ["Tool and diagnostic settings. Plumbing, except that turning trace mode on clears the operation log so the trace starts clean."],
"eng.cancelStroke": ["Abandons the in-progress stroke and removes it from the document — used where a gesture is interrupted rather than completed."],
"erp.eraseAt": ["The whole-object eraser: hit-test at the point and remove what is under it, as one undo entry."],
"sel._selectionRect": ["The selection's bounding rectangle in screen coordinates, and the anchor point a drag measures from."],
"ovl._outlineInView": [
 "Builds the marching-ants geometry: the selected object's own silhouette, clipped to the view.",
 "**Drops the joins that are storage artefacts** — tile boundaries and the seams between family members — so the indicator traces the object rather than how it happens to be stored.",
 "Adds edge marks and arrows where the object continues past the side of the screen, which is the normal case when something is selected from far below.",
],
"eng.undo": ["Undo, redo and clear. Each re-schedules the background worker afterwards, because reversing an action can leave strokes unresolved or erases unapplied."],
"fil.snapshot": ["The development snapshot, kept verbatim for tests and tools — and the shape a bug report carries, which is how a browser bug becomes a failing test offline."],
"sco.jumpTo": ["Goes to a scene at the zoom that fits it, and captures the current view as a new scene."],
"sco.renameScene": ["Rename, delete and split a scene — the manual overrides the design leans on instead of making automatic discovery cleverer."],

# ---- scenes ---------------------------------------------------------------
"scn.depthFn": ["Box-key helpers, defaulting to depth semantics so numeric callers and the specification tests are unchanged."],
"scn.chunksOf": [
 "Splits a stroke into window-sized chunks for clustering.",
 "A long diagonal stroke is one enormous bounding box, which would join everything it passes near. Chunking makes proximity mean what it should.",
],
"scn.outerBox": ["A chunk set's outer box, and the projection of chunks through a single crossing — never more than one, because no global frame exists."],
"scn.itemsAtLevel": [
 "Clusters the ink at one level, and across an adjacent pair.",
 "Every distance is relative to **stroke width**, which already encodes the zoom the ink was drawn at and is identical on every device — so the same drawing yields the same scenes on a phone and a desktop.",
],
"scn.median": ["A cluster's identity hash, so a scene survives an edit instead of being reinvented under a new name."],
"scn.frameOfItems": [
 "A scene's rectangle: the 90% core of the painted ink by mass, padded.",
 "By mass rather than by extent, so one stray mark at the edge of a composition does not define the view you are taken to.",
],
"scn.buildScene": [
 "Builds one scene, then recurses into the much-finer ink inside it as nested scenes.",
 "**No minimum size and no minimum stroke count** — the tiniest dot drawn thousands of times deeper is a scene, which is the entire point of the feature.",
 "One guard: a nested scene must be meaningfully smaller than its parent, or it is just the parent's view again under a second name.",
],
"scn.topoOrder": ["Orders the result: top-level scenes by size, each followed by its own subtree, so the list reads as a hierarchy rather than as a flat pile."],
"scn.rectIoU": [
 "Matches freshly discovered scenes against the existing ones by overlap, so names, pins and manual captures survive a redraw.",
 "Without this, drawing one more stroke would silently rename and reorder everything.",
],
"scn.resolveCapture": ["Decides what a manual capture attaches to — an existing scene it should retarget, or a new one of its own."],
"scn.splitMembers": ["Splits a scene by hand: the escape hatch the design prefers to a cleverer automatic rule."],

# ---- scaleBar -------------------------------------------------------------

# ---- shell ----------------------------------------------------------------

# ---- not running ----------------------------------------------------------

# ---- the ten highlighted rows that had no key -----------------------------
"lm.serialize": [
 "Writes the box tree, and reads it back.",
 "A box **is** its index, so the whole tree is four fields per box — id, parent, depth, index — and the edge is derived rather than stored. There is no coordinate anywhere in it.",
 "**A pre-lattice file is refused here**, with a clear error, and never converted. Converting would mean rewriting stored coordinates, which is the one operation this whole design exists to avoid. Recorded test fixtures are re-expressed by a test-only converter so their regression coverage survives; nothing in the product converts anything.",
 "Loading wires parents before children so the child map is built as it goes, and mints a root if the file somehow has none.",
],
"per.decodeCrossings": [
 "Validates and reads the box tree out of a file.",
 "Checks every box's edge record, or — for the lattice format — every index against the range a box may legally hold.",
 "**This is the gate that refuses a pre-lattice drawing.** A file carrying free-floating boxes with arbitrary anchors cannot be expressed in the lattice without moving its ink, so it is refused by name rather than half-converted.",
],
"clb.maxMagnitude": [
 "Picks the integer scale a polygon operation will run on, and the local origin it runs about.",
 "**Both halves matter.** The scale is taken from the geometry's own extent, so it follows the shape's size rather than its position; and the origin is **snapped onto that same grid**, so it is still the global grid rather than a per-call one.",
 "Re-centring without snapping would anchor the grid differently for every call, and two operations over abutting geometry would then round a shared edge two different ways — which is a hairline crack.",
 "Before this, rounding error tracked how far the drawing had been panned: 0.07 px at the origin, 0.26 px at 10⁵, 3.7 px at 4 × 10⁶, and **137 px at 2 × 10⁷**. It also caused the 'the shape changed where I did not touch it' symptom, because a boolean re-quantises its entire subject — cutting one end of a stroke moved the other end, and the far edge walked further with every later cut.",
],
"ins.LongFrames": [
 "The browser's own account of a slow frame, kept as the worst handful.",
 "Records, per slow frame: how long was spent before rendering began, when style and layout started, and a per-script breakdown with function names — including how much of each script was *forced* style and layout, which is the classic invisible cost.",
 "Whatever is left after script and style-and-layout is paint and compositing, and **that subtraction is the whole point**: it is the one thing no timer inside the engine can ever see directly.",
 "It exists because the frame meter said a frame took 1.5 seconds while every timer in the engine said the work took 11 ms. That gap cost four wrong diagnoses before this closed it.",
],
"fil.serializeDrawing": [
 "The real save and load path.",
 "Saving refreshes the scenes first, because they ride in the file's metadata, then wraps the engine's own serialised state in the versioned envelope.",
 "**Loading settles the camera** into a legal state. A file records whatever the camera was, and nothing guarantees that is inside the legal zoom band — until this ran, the *first* interaction after a load paid for the crossing. Measured on a real recording: the first pan cost 200 ms and every pan after it 0.2 ms, which read as 'panning is slow' because a benchmark averages the two.",
],
"scn.joinDist": [
 "The distances scene clustering is decided by — all of them relative to **stroke width**.",
 "There are no physical screens anywhere in this maths. A stroke's width already encodes the zoom it was drawn at and is identical on every device, so a stroke's notional 'screen' is a fixed multiple of its own width and ink joins across gaps measured the same way.",
 "That is what makes the same drawing produce the same scenes on a phone and a desktop.",
],
"scn.computeSceneProposals": [
 "The whole scene-discovery pass.",
 "Clusters ink per adjacent level pair, projecting the finer level's geometry through **one** crossing — never more, because no global frame exists and composing transforms is exactly what the engine refuses to do everywhere else.",
 "Union-find is keyed by object id, so membership chains across pairs and levels: clustering is bookkeeping rather than a boundary.",
 "**No minimum size and no minimum stroke count.** Every cluster is a scene, and much-finer ink inside a scene becomes a nested scene regardless of how few strokes it has — the tiniest dot drawn thousands of times deeper is a scene, which is the point of the feature.",
],
}
