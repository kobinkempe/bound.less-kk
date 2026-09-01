# -*- coding: utf-8 -*-
"""Per-function entries for the code that is NOT running: the oracles, the
superseded geometry, and the developer labs.

None of this ships. It is kept because three test suites compare the live engine
against it byte for byte, and because the labs are how the arc pipeline was
judged before it replaced the cubic one. Descriptions here say what each thing
did in the model it belonged to, and what replaced it.
"""

E = {}


def add(key, fn, what, long, ref="§17"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ============================================================ geometry/cede.js
add("ced.ringsBbox", "ringsBbox(rings)", "The box round a set of rings.", ["-"])
add("ced.asLTRB", "asLTRB(r)", "Either rectangle spelling, normalised.",
    ["The engine carries two four-number rectangle shapes - left/top/right/bottom and x0/y0/x1/y1 - and this module takes both."])
add("ced.signedArea", "signedArea(ring)", "Shoelace area; the sign is the winding.", ["-"])
add("ced.pointInRing", "pointInRing(ring, p)", "Even-odd containment.", ["-"])
add("ced.interiorPoint", "interiorPoint(ring)",
    "A point strictly INSIDE a ring, never a vertex.",
    ["Not a nicety. Every ring here has been clipped to the same cell, so rings routinely share edges with each other and with the cell boundary, and a vertex of one lands exactly ON another's edge - where containment has no answer."])
add("ced.key2", "key2(a, b)", "An unordered pair as a map key.", ["-"])
add("ced.splitCorridors", "splitCorridors(ring)",
    "Undoes Sutherland-Hodgman's ZERO-WIDTH CORRIDORS.",
    ["The clip emits one ring per input ring, always - so when it genuinely parts the ink in two it cannot say so. It runs the boundary along the clip line from one lump across to the other and back again, leaving a corridor of no width.",
     "Finding and cutting those is what lets the cede report the right number of connected pieces. It is one of the three connectivity traps this module exists to handle, all measured, all pinned by its tests."])
add("ced.onSegment", "onSegment(p, a, b)", "Is a point on a segment?", ["-"])
add("ced.ringComponents", "ringComponents(rings)",
    "Splits one cell's rings into connected components, holes kept with their ink.",
    ["**A cell is not a chunk.** The guillotine leaves up to four cells around the hole, and treating each as one lump is wrong exactly when it matters: anything being ceded is usually one object that happens to span them."])
add("ced.edgeSpans", "edgeSpans(rings, axis, v)",
    "Where rings have an edge lying ON a guillotine line.",
    ["Two chunks that abut on the line are joined exactly where these overlap - a one-dimensional interval test rather than another boolean."])
add("ced.spansOverlap", "spansOverlap(a, b)", "Do two spans share a stretch?", ["-"])
add("ced.cedeRect", "cedeRect(rings, hole, opts)",
    "Cuts a rect out of ink, float-exact, returning connected groups.",
    ["The primitive the tile/window design turned on before the arc boolean existed. No integer lattice anywhere: the surviving edge IS the rect's coordinates, which is what a child filling that rect at 4096 times the scale requires.",
     "**Superseded by `Document.cedeTileById`**, which does the same cut as one exact arc boolean. This survives because three test suites use it as a convenient way to MAKE guillotine-cut geometry to test against."])
add("ced.touchesRect", "touchesRect(rings, rect, tol)",
    "Do these rings reach the boundary of a rect?",
    ["Which pieces either side of a ceded tile are candidates for being joined through it - the question `connect.js` now answers exactly."])

# ==================================================== geometry/curvePerimeter.js
add("cvp.centerlineCubics", "centerlineCubics(pts)",
    "The exact Two.js spline through the samples, as absolute cubics.",
    ["The cubic pipeline's centerline. The arc pipeline's `biarc.splineCubics` computes the same curve and then fits arcs to it, which is the whole difference between the two."])
add("cvp.bboxOf", "bboxOf(c)", "A cubic's control-hull box.", ["-"])
add("cvp.DistOracle", "DistOracle",
    "Distance to the centerline, by flattening it and indexing the chords.",
    ["**The single tolerance that turned out to bind the whole cubic bake.** Every point of an offset piece sits at exactly the pen radius from its own generator, so an exposed piece reads exactly r and a buried one dips below; a fragment between two close crossings dips only a little, and a coarse oracle reads it as exposed.",
     "Measured: at r/512 the resolve left 122 open chains, at r/4096 twenty-five, at r/32768 none. That is not a tolerance wanting tuning, and it is why the arc pipeline's oracle is closed-form instead."])
add("cvp.DistOracle.addCubic", "addCubic(c)", "Extends the oracle with one more cubic.",
    ["For the bakers that build the oracle while the pen is down. Sound because ink is monotone: nothing already recorded stops being true when more of the stroke arrives."])
add("cvp.DistOracle._flatten", "_flatten(c)", "Flattens one cubic to chords.", ["-"])
add("cvp.DistOracle._index", "_index(seg)", "Files a chord in the grid.", ["-"])
add("cvp.DistOracle.buried", "buried(x, y, margin)",
    "Is this point inside the ink by more than the margin?",
    ["A pure function of POSITION - no part of the centerline is excluded. Excluding a window around the tested piece's own generator made the predicate differ between neighbouring pieces of one chain, which is F13."])
add("cvp.hullsMiss", "hullsMiss(a, b)", "Cheap rejection for two cubics.", ["-"])
add("cvp.isectInto", "isectInto(...)", "Subdivision search for crossings.",
    ["Recursive box subdivision. It is the step the arc pipeline replaced with one square root."])
add("cvp.cubicDeriv", "cubicDeriv(c, t)", "The unnormalised derivative - Newton needs the magnitude.", ["-"])
add("cvp.polishIsect", "polishIsect(...)",
    "Drives a bracketed crossing onto the true one, so both parameters name the SAME point.",
    ["Subdivision returns the centre of the last surviving box, and its two halves are centres of DIFFERENT boxes - one per curve. For a shallow crossing they land far apart; measured at 1.10 units on a ring, over the welding tolerance, so the two pieces cut there never joined.",
     "This is F15's second defect, and the class of problem that does not exist once both curves are arcs."])
add("cvp.cubicIntersections", "cubicIntersections(a, b, tol)",
    "Every crossing of two cubics, clusters merged.",
    ["Near-tangent pairs produce a cluster of boxes rather than one crossing; unmerged, they cut a piece into slivers whose midpoints all classify the same way."])
add("cvp.stitchCubics", "stitchCubics(pieces, tol)",
    "Chains surviving pieces into closed loops.",
    ["Junction coordinates are computed twice, once from each piece that meets there, and agree only to a few units in the last place - so hashing on a rounded key alone splits pairs that straddle a bucket boundary."])
add("cvp.cubicLoopArea", "cubicLoopArea(loop)", "Signed area of a cubic loop.", ["-"])
add("cvp.offsetSide", "offsetSide(...)",
    "ONE closed offset loop for the whole stroke, with provenance.",
    ["The part that cannot come from the renderer's capsule builder: that emits one capsule per RUN and lets the runs overlap, which is right for nonzero fill and wrong here, because each run's end cap would become interior boundary."])
add("cvp.endCaps", "endCaps(...)", "The two round end caps as chains of cubics.",
    ["Each meets its side chain tangentially - a semicircle leaves the offset perpendicular to the centerline, which is exactly the direction the offset arrives in - so cap junctions are smooth rather than corners."])
add("cvp.offsetLoop", "offsetLoop(...)", "Both sides plus both caps, as one loop.", ["-"])
add("cvp.roundJoin", "roundJoin(...)",
    "The arc between two consecutive offsets that do not meet.",
    ["Where the centerline turns, the outer offsets leave a gap at the shared anchor and the boundary genuinely runs round it at the pen radius.",
     "The arc pipeline has no equivalent: consecutive offsets there share an endpoint computed once per vertex, so there is no gap to fill."])
add("cvp.arcChain", "arcChain(...)", "A circular arc as kappa cubics, under 90 degrees each.", ["-"])
add("cvp.marginOf", "marginOf(...)",
    "How strict burial has to be, given where the boundary might really be.",
    ["Two error terms: the fitted offset can sit a fit-tolerance inside the true one, and the oracle's chords read short by their own tolerance. With no margin a legitimate boundary point lands exactly on the threshold - F15's third defect."])
add("cvp.oracleTolFor", "oracleTolFor(...)", "The oracle's flattening tolerance, in ONE place.",
    ["Every baker that builds its own oracle has to agree with the one the resolve would have built, or it is measuring a different shape."])
add("cvp.buildTolFor", "buildTolFor(...)",
    "The tolerance the perimeter is BUILT at, given the tolerance it must MEET.",
    ["Divides by eight and floors at a fraction of the radius. The floor is what matters: at a crossing of angle theta a fitting error is displaced along the curve by one over sin theta, so the amplification is geometric rather than absolute.",
     "Shared, because B computing its own was enough to make it disagree with A by 187 points out of 2,056 while A was exact."])
add("cvp.repairTolFor", "repairTolFor(...)", "How far a junction may be welded shut.",
    ["Empirical, and it has to be. The displacement to be closed is not predictable from the tolerances - which is itself the argument that the parity weld was load-bearing rather than tidying, and therefore that the representation was wrong."])
add("cvp.curvePerimeter", "curvePerimeter(pts, width, opts)",
    "Resolves a stroke into ONE perimeter of cubics.",
    ["The cubic pipeline's whole bake, and the direct ancestor of `bakeArcPerimeter`. Same three phases - build the boundary, cut it at its own crossings, keep what is not buried, restitch - with every step approximate rather than exact.",
     "Measured against its replacement on the same strokes: 3.3 to 3.8 times slower, and where it left open chains the arc version leaves none."])
add("cvp.subCubic", "subCubic(c, t0, t1)", "The exact sub-curve over a parameter range.", ["-"])
add("cvp.PieceGrid", "PieceGrid", "Broad-phase grid over boundary pieces.", ["-"])
add("cvp.PieceGrid.nearInto", "nearInto(box, out)", "The pieces near a box.", ["-"])

# ====================================================== geometry/strokeShape.js
add("sks.Crumb", "Crumb", "An occupancy grid recording which capsule covers a cell.",
    ["The 'crumb' the third bake schedule maintained while drawing. The cull that consumed it was removed as unsound (F11), which left the schedule maintaining a structure nothing read."])
add("sks.Crumb._cx", "_cx(x)", "Cell index.", ["-"])
add("sks.Crumb._cy", "_cy(y)", "Cell index.", ["-"])
add("sks.Crumb.coveredByOther", "coveredByOther(x, y, id)",
    "Is this cell already filled by somebody else?",
    ["The cull that made the crumb worth keeping - and the one that culled a genuine boundary piece, because a grid cell cannot express path adjacency."])
add("sks.distSqToRaw", "distSqToRaw(...)", "Point to a segment given as origin, direction and length.", ["-"])
add("sks.distSqToSeg", "distSqToSeg(p, a, b)", "Point to segment, squared.", ["-"])
add("sks.segSegDistSq", "segSegDistSq(...)", "Segment to segment, squared, zero if they cross.",
    ["Direction and length are passed in rather than derived: this runs over half a million times on a real-sized stroke, and recomputing them per call was measurable."])
add("sks.segmentsOf", "segmentsOf(pts)", "The polyline as segments with precomputed geometry.", ["-"])
add("sks.SegGrid", "SegGrid", "Broad-phase grid over those segments.", ["-"])
add("sks.SegGrid.nearInto", "nearInto(box, out)", "The distinct segments near a box.", ["-"])
add("sks.normAngle", "normAngle(a)", "An angle into a single turn.", ["-"])
add("sks.coverRuns", "coverRuns(...)", "Which parts of a piece are covered by other capsules.", ["-"])
add("sks.mergeCovers", "mergeCovers(covers, lo, hi)",
    "Merges cover intervals, reporting full coverage early.",
    ["Most offset lines are FULLY buried - a candidate is a candidate because one of its two sides is exposed, so the other usually contributes nothing - and detecting that early avoids testing it against a hundred more capsules."])
add("sks.lineCutsInto", "lineCutsInto(...)",
    "Where a capsule's boundary crosses a LINE piece.",
    ["A capsule is convex, so a line meets it in ONE interval whose ends lie on two cap circles and two band edges - nothing else. That is what makes the cubic-free version of this closed-form."])
add("sks.arcCutsInto", "arcCutsInto(...)", "Where a capsule crosses a cap CIRCLE.", ["-"])
add("sks.freeRuns", "freeRuns(lo, hi, covers)", "The uncovered parts of a piece.",
    ["Runs that merely touch leave no gap - an important distinction, because two capsules meeting exactly at a point do not expose boundary between them."])
add("sks.boundaryPieces", "boundaryPieces(...)", "Every exposed piece of every capsule.", ["-"])
add("sks.stitch", "stitch(pieces)", "Chains exposed pieces into loops.",
    ["Its orientation convention is worked through on one stadium in the source, so the reader can check the sign rather than trust it."])
add("sks.loopArea", "loopArea(loop)", "Signed area of a line/arc loop.", ["-"])
add("sks.snapPoints", "snapPoints(pieces, tol)",
    "Collapses near-identical vertices onto one shared instance.",
    ["Two distinct vertices at essentially the same place each emit a cap circle, and those circles cover each other's boundary - so the perimeter comes apart at exactly the junction that looked fine."])
add("sks.strokeShape", "strokeShape(pts, width, opts)",
    "The polyline Minkowski bake: flatten the centerline, sum with a disc.",
    ["The original bake, and the one F1 retired. It is exact FOR THE POLYLINE, and the polyline is not the stroke: the result creases on the inside of every bend where two offset lines meet.",
     "The crease angle goes as the square root of the flattening tolerance over the radius of curvature, and **an angle does not shrink with zoom** - measured at 5.1 degrees identically at 1x, 30x and 900x. That is what made it a representation problem rather than a tolerance one."])

# ==================================================== geometry/bakeStrategies.js
add("bks.quantiles", "quantiles(xs)", "Percentiles of a timing sample.", ["-"])
add("bks.BaseBaker", "BaseBaker", "What the three schedules share: samples in, loops out.",
    ["The question these exist to answer is WHEN the perimeter work happens - all at pen-up, spread across the stroke, or partly both - not how it is computed."])
add("bks.BaseBaker._onSample", "_onSample(...)", "Hook: one more pen sample.", ["-"])
add("bks.BaseBaker._settleCtrl", "_settleCtrl()",
    "Brings the spline's control points up to date and reports what is now FINAL.",
    ["The trap the incremental schedules turn on: a control point depends on the samples either side of it, so the last TWO cubics are provisional and must be recomputed when the next sample arrives."])
add("bks.BaseBaker._cubicAt", "_cubicAt(i)", "One centerline cubic.", ["-"])
add("bks.BaseBaker._wrap", "_wrap(loops)", "Packages the result with its timings.", ["-"])
add("bks.BatchBaker", "BatchBaker", "Schedule A: do everything at pen-up.",
    ["The one Kobin chose. Its draw cost is nothing and its pen-up cost is the whole bake - which is affordable once the bake itself is sliced, and unaffordable before."])
add("bks.BatchBaker.finish", "finish()", "Resolves the whole stroke.", ["-"])
add("bks.CrumbBaker", "CrumbBaker", "Schedule C: build the oracle while drawing, resolve at pen-up.",
    ["About a quarter of B's per-sample cost and still most of A's pen-up bill, because the oracle is only about a tenth of the work.",
     "Its crumb is not used - the cull that consumed it was removed - so it is really 'pre-build the distance oracle'."])
add("bks.CrumbBaker._onSample", "_onSample(...)", "Extends the oracle and the crumb.", ["-"])
add("bks.CrumbBaker._fold", "_fold(...)", "Folds one cubic into the occupancy grid.", ["-"])
add("bks.CrumbBaker.finish", "finish()", "Resolves, reusing the oracle it built.", ["-"])
add("bks.IncrementalBaker", "IncrementalBaker", "Schedule B: keep the perimeter live as you draw.",
    ["Free at pen-up and about 1.2 ms per sample to get there - inside a pen's frame budget, but not by much.",
     "**And measurably wrong on real strokes.** On a 278-sample captured stroke it got 91% of pixels wrong against A's 1.2%, because it judges burial from a span's midpoint while drawing, before the cuts that would split that span exist, and dropping is permanent."])
add("bks.IncrementalBaker._bucketsFor", "_bucketsFor(box)", "Grid buckets for a box.", ["-"])
add("bks.IncrementalBaker._insert", "_insert(piece)", "Files a live piece.", ["-"])
add("bks.IncrementalBaker._near", "_near(box)", "Live pieces near a box.", ["-"])
add("bks.IncrementalBaker._onSample", "_onSample(...)", "Extends the live perimeter.", ["-"])
add("bks.IncrementalBaker._extend", "_extend(...)",
    "Folds one more cubic into the live perimeter.",
    ["The START cap is emitted with the FIRST cubic rather than saved for pen-up: it depends only on that cubic's opening tangent, so it is final as soon as the cubic is."])
add("bks.IncrementalBaker._survivors", "_survivors(c, ts)",
    "The sub-intervals of a cubic whose midpoints are not buried.",
    ["Each cut carries the SHARED crossing point the two pieces agreed on, and snapping to it is what makes the junction exact rather than nearly exact."])
add("bks.IncrementalBaker._allBuried", "_allBuried(span)",
    "Is this span buried along its WHOLE length?",
    ["Dropping is permanent - that is what makes the incremental schedule cheap - so this has to mean 'inside the ink everywhere' and not 'inside the ink at the points I sampled'. It is not conservative enough once the cut set grows."])
add("bks.IncrementalBaker.finish", "finish()", "Closes the live perimeter.", ["-"])
add("bks.bboxMiss", "bboxMiss(a, b)", "Cheap rejection.", ["-"])
add("bks.runBaker", "runBaker(name, pts, width, opts)",
    "Runs one schedule over a sample list and times it.",
    ["The comparison harness. It is what the labs drive and what the cross-checking tests call, and it is why all three schedules produce the same shape to compare at all."])

# ======================================================= geometry/erase.js
add("ers.cutVisible", "cutVisible(extent, cfg)",
    "Is a cut big enough to be worth applying here?",
    ["The same gate the window machinery uses. Coarser than a fraction of a pixel and the ink around the cut is equally sub-pixel, so cut and uncut agree - which is what made zooming out across a crossing continuous with no re-baking."])
add("ers.eraserFootprint", "eraserFootprint(E, cfg)",
    "The eraser's painted footprint, as curve loops local to its own centre.",
    ["An eraser IS a stroke, so it is polygonised by the same rule ink strokes are: above the fat gate its outline is CURVES, which is what let the same cut be re-flattened at whatever fidelity the consuming level needed.",
     "Local coordinates were not a detail: Clipper caps its integer scale by the largest coordinate present, so building a 32-unit eraser at frame coordinate 1e5 quantised it to about 0.0025 units."])

# =========================================================== KobinEngineV0.js
for nm, what, long in [
    ("KobinEngineV0", "The retired god-class engine.",
     ["Everything the current engine splits across LevelMap, Document, Camera, TileStore and Renderer, in one file, with live projection instead of bidirectional tiles.",
      "Kept as the golden oracle: `derive.test.js` compares `deriveStep` against `_deriveInto` byte for byte, which is what makes the extraction provable rather than asserted. It is also the last thing keeping `clipper-lib` in the dependency list."]),
    ("_captureState", "Document and camera as one unit, for undo of a clear.", []),
    ("_applyState", "Restores such a capture.", []),
    ("_addNative", "Records a newly drawn object at the active level.", []),
    ("_removeById", "Removes a native and invalidates the tiles that inherited it.",
     ["Deeper levels hold baked copies and must be invalidated; shallower ones only saw it through live projection, which the rebuild recomputes. That asymmetry is exactly what the bidirectional tile cache removed."]),
    ("_insertObject", "Re-inserts an object at a remembered index.", []),
    ("_refresh", "Rebuilds and re-renders the active level after a mutation.",
     ["The whole level, every time. The incremental render diff is what replaced it, and the measurement was 111 ms to 0.2 ms on the same scene."]),
    ("_pushUndo", "Pushes one op.", []),
    ("_invalidateDeeper", "Drops cached tiles below a level.", []),
    ("_makeGrid", "The tile grid, DERIVED FROM CANVAS SIZE.",
     ["The defect the lattice exists to remove: the grid was computed from the canvas dimensions and then serialized, so the same document baked a different partition on a phone than on a desktop."]),
    ("_grid", "The grid for a level.", []),
    ("_tileRect", "One tile's rectangle.", []),
    ("_tileRange", "The tiles a rect touches.", []),
    ("_visibleTiles", "The tiles the view needs.", []),
    ("_ensureTilesForRegion", "Bakes whatever tiles a region is missing.", []),
    ("_bakeTile", "Builds one tile's contents from the parent level.", []),
    ("_bbox", "An object's box, cached on the object.", []),
    ("_displayChords", "The flattened spline at display fidelity.", []),
    ("_flatChords", "The flattened spline in a child level's frame.", []),
    ("_deriveInto", "THE ORACLE ITSELF: one level's geometry expressed in the next.",
     ["The function the current `deriveStep` was extracted from, and the reason this file is still here. `derive.test.js` runs both over the same inputs and requires identical output, through a legacy seam policy kept solely for that comparison."]),
    ("_ensureTiles", "Bakes the tiles for a level.", []),
    ("_projectNative", "Chains one native's geometry across levels.", []),
    ("_projectedNatives", "Every native from other levels, projected into this one.",
     ["Live projection, per render, with no tiles and no size policy going up - which is BUG-05: a normal stroke five levels away projected to a linewidth of eleven million pixels."]),
    ("_rebuildLevelObjects", "Assembles the render list for a level.",
     ["Its ordering is BUG-03: the list was built bucket by bucket, so an object's depth depended on which representation it arrived as rather than on when it was drawn."]),
    ("_clearLevel", "Empties a level's render list.", []),
    ("_tint", "Debug colouring by level.", []),
    ("_pieceGroup", "The Two.js group for one piece.", []),
    ("_renderActive", "Tears down and rebuilds the whole SVG scene.",
     ["Every frame, with no diffing. ISSUE-11, and the primary driver of BUG-01."]),
    ("_renderObject", "Draws one object.", []),
    ("_buildPaths", "Turns one object into Two.js paths, fat branch included.",
     ["The windowed fat-stroke bake lives here - the one whose pad could be outrun by the stroke's own half-width, which is BUG-02."]),
    ("_syncWorld", "Applies the camera to the scene transform.", []),
    ("_syncDebug", "Redraws the debug overlays.", []),
]:
    key = "v0." + nm if nm != "KobinEngineV0" else "v0.KobinEngineV0"
    add(key, nm + ("()" if nm != "KobinEngineV0" else ""), what,
        long if long else ["Part of the retired engine; kept only so the current one can be compared against it."])

# ================================================================== the labs
add("lab.clamp", "clamp(v, lo, hi)", "Clamps a number.", ["-"])
add("lab.Label", "Label({ ... })", "A lab control label.", ["-"])
add("lab.Row", "Row({ ... })", "A lab control row.", ["-"])
add("lab.strokeRaw", "strokeRaw(ctx, pts, width)", "Draws the browser's own stroke, for comparison.",
    ["The blue reference the baked shape is XORed against - the lab's whole method is that the two are drawn the same way and only the disagreement is shown."])
add("lab.measureAccuracy", "measureAccuracy(...)",
    "Rasterises both versions, XORs them, and reports the worst error in screen pixels.",
    ["A chamfer distance transform from the truth's edge, so the answer is a distance rather than a pixel count. That number is what 'within a quarter pixel' has to mean in practice."])
add("lab.BakeLab", "BakeLab()", "The lab for the three cubic bake schedules.",
    ["No levels, no tiles, no persistence - one stroke, one width, one camera. It answers the questions the unit tests cannot: does the pen feel laggy while B works, does the pen-up pause read as a hitch, does the swap from the browser's stroke to the baked shape show."])
add("apn.clamp", "clamp(v, lo, hi)", "Clamps a number.", ["-"])
add("apn.Label", "Label({ ... })", "A lab control label.", ["-"])
add("apn.Row", "Row({ ... })", "A lab control row.", ["-"])
add("apn.ArcPen", "ArcPen()", "The lab for the biarc centerline alone.",
    ["Nothing bakes here. The question is only whether a stroke made of two arcs per sample gap still FEELS like the same pen - and everything downstream only pays off if the answer is yes, so the answer was worth having before any of it was built.",
     "Three views, because the difference is too small to see in one: the ink, the two centerlines as hairlines, and the two rasterised and XORed so only disagreement is visible."])
add("abk.clamp", "clamp(v, lo, hi)", "Clamps a number.", ["-"])
add("abk.Label", "Label({ ... })", "A lab control label.", ["-"])
add("abk.Row", "Row({ ... })", "A lab control row.", ["-"])
add("abk.measureAccuracy", "measureAccuracy(...)", "The same raster XOR, for the arc bake.", ["-"])
add("abk.ArcBake", "ArcBake()", "The lab for the arc perimeter resolve.",
    ["Orange while raw, green fill once resolved, with the perimeter itself drawn over it as a RED HAIRLINE - because a solid fill hides a fabricated edge and a crease, and the hairline does not.",
     "Two readouts decide whether it worked: open chains, every one of which becomes a straight line painted across the shape, and unbalanced junctions, which are the upstream cause."])
add("cv2.CanvasV2", "CanvasV2()", "The engine's dev harness at /#/v2.",
    ["Its own copy of mount, pointer input, pinch, autosave and the report payload - the duplication that made the autosave switch have to be exported so the two could not drift.",
     "Nothing links to it, and the product's dev panel now shows the same information behind `?dev`."])
add("cv2.fmt", "fmt(z)", "The harness's own zoom formatter.", ["-"])

# ===================================================== scaleBar/testSupport.js
add("tsp.coldSession", "coldSession(ladderId)", "A session with no history, for a clean probe.",
    ["Assertions about the resolver have to start from nothing, or they are testing the incumbent as much as the rule."], "§14")
add("tsp.cleanProbeSession", "cleanProbeSession(...)", "A session with preferences discarded.", ["-"], "§14")
add("tsp.mppForReading", "mppForReading(value, unit)",
    "The zoom at which a given reading would be exactly on target.",
    ["Lets a test say 'at the zoom where 5 mm is the ideal bar' rather than computing a metres-per-pixel constant by hand, which is how the scale-bar suites stay readable."], "§14")
add("tsp.mppWhereBothFit", "mppWhereBothFit(a, b)",
    "A zoom where two candidate readings are both legal.",
    ["The only way to test a preference rule honestly: both options have to be available, or the test is asserting that the other one did not fit."], "§14")
add("tsp.worldMeters", "worldMeters(value, unit)", "A reading as metres.", ["-"], "§14")
add("tsp.expectBarInBounds", "expectBarInBounds(reading)",
    "Asserts the bar is inside its width bounds.",
    ["The invariant every reading must satisfy whatever else a test is checking."], "§14")
