# -*- coding: utf-8 -*-
"""Comprehensive descriptions — biarc, arcPerimeter, arcShape, freeze,
connect, lasso, hittest, clipperOutline, curveOutline."""

L = {
# ---- biarc ----------------------------------------------------------------
"bia.BiarcPen.addSample": [
 "Adds one pen sample to the live arc chain, in constant time.",
 "A new sample only disturbs the spline's control points at its two nearest neighbours, so **exactly the last two gaps are rebuilt** — everything before them is already final.",
 "That is what makes the chain affordable to maintain while drawing: microseconds per point, and by pen-up the most expensive phase of the resolve has already been paid for a sliver at a time.",
],
"bia.splineCubics": [
 "The cardinal spline through the pen samples — the reference the arc chain is measured against.",
 "This is the same curve the app already drew, which is why switching to arcs changed nothing a user can see: the chain passes through every sample in the same direction as before, and only the shape strictly between two samples can differ at all.",
 "Drops repeated samples first, and handles the two-point case directly.",
],
"bia.arcsForGap": [
 "One gap's worth of arcs: a pair, subdivided where a pair is not close enough.",
 "Fits two arcs to the gap, measures how far they stray from the cubic, and if that exceeds the tolerance, halves the gap and recurses on each half.",
 "**Splitting never introduces a kink**, because the left half's start direction *is* the parent's start direction — the subdivision is exact, not a re-fit.",
 "In practice this only fires where the pen turned hard. Depth is capped so a pathological input cannot recurse forever.",
],
"bia.biarc": [
 "The two arcs joining one point and direction to another, meeting smoothly at their own junction.",
 "One arc cannot do it: an arc through two points with the direction fixed at both ends is over-determined. Two arcs meeting tangentially have exactly the freedom needed.",
 "The joint is placed by the equal-tangent-length rule — the choice that stays symmetric under reversing the stroke, so drawing a shape and drawing it backwards give the same curve.",
 "The second arc is built **backwards from its far end**, where its direction is known, and then reversed, so both ends are exact by construction rather than one end being exact and the other landing wherever the arithmetic puts it.",
 "The joint's direction is then snapped to the number the first arc reports. The two are the same direction analytically, and making them the same *number* is what lets a junction be trusted without a tolerance.",
],
"bia.arcThrough": [
 "The unique arc leaving a point in a given direction and passing through another point.",
 "Both end directions are stored, the far one computed as the **reflection** of the near one across the chord — a circle's chord makes equal angles with the tangents at its two ends — which is exact arithmetic. Recovering it from the angles instead costs about a millionth of a radian on the huge-radius arcs a nearly straight gap produces, and a junction that agrees only to that is one the stitcher has to be told to trust.",
 "**Decides straightness by the bulge, not by a length ratio.** The earlier test compared a length against a squared length, which is both scale-dependent and far too strict: a gap collinear to one part in 100 million — which is what the spline's end handles produce — came back as a real arc of radius 800 million with its centre 1.7 billion units away. It bows by a fifty-millionth of a unit, so it is a line by any measure that matters, but the browser rasterises in lower precision where the quantum at that distance is nearly 200 units, and it drew a huge visible spur at each end of an otherwise straight stroke.",
],
"bia.arcPoint": ["A point at a parameter along an arc, from its centre, radius and angles."],
"bia.arcTangent": ["The direction along an arc at a parameter."],
"bia.arcDist": [
 "The exact distance from a point to an arc piece — not to its full circle.",
 "If the point's angle falls within the arc's sweep, the answer is the difference between its distance from the centre and the radius. Otherwise it is the nearer endpoint.",
 "Normalises the **angle difference** rather than trusting either angle's branch: an arc that has been reversed can have a start angle outside the usual range, and trusting it reports a point in the middle of the arc as being off its end — which then returns a distance-to-endpoint the size of the whole arc.",
],
"bia.gapError": [
 "How far the arc pair strays from the cubic it stands in for, sampled at a fixed number of probes and taking the worst.",
],
"bia.offsetArc": [
 "**The exact offset**: the same centre, radius plus or minus the pen.",
 "This one closed-form fact is the entire reason the representation is arcs. There is nothing to fit, and one line of arithmetic replaces a subdivision-until-close-enough fit that used to produce ten or more pieces per gap per side.",
 "A negative resulting radius means the arc is tighter than the pen and this side has inverted — a real self-overlap, which is reported rather than hidden.",
 "A straight piece offsets by shifting along its normal.",
],

# ---- arcPerimeter ---------------------------------------------------------
"arc.ArcBakeJob": [
 "The whole stroke-to-outline resolve, packaged as a job with a cursor in it.",
 "Constructed with the pen samples and width, and optionally the arc chain the live pen already built — which skips the first phase entirely.",
],
"arc.ArcBakeJob.step": [
 "Runs the resolve for at most a given number of milliseconds and reports whether it finished.",
 "Dispatches to whichever of the eight phases is current, looping until the budget is spent or the work is done.",
 "**Every phase can stop mid-item and resume.** Deferring between whole objects was not enough: one heavy stroke was an indivisible multi-second job with no point inside it where control came back.",
 "**Nothing is published until the whole thing is done**, so a half-resolved outline can never be drawn, stored, or cut against.",
 "Each burst re-tunes its own size towards about a millisecond, from what the last one actually cost, and is capped so a burst sized on cheap items cannot overrun on expensive ones.",
],
"arc._centerline": [
 "Phase 1. Builds the arc chain from the pen samples, in chunks.",
 "Uses the same incremental pen the live drawing uses, so this produces an identical chain — and is skipped entirely when the live pen handed one over.",
],
"arc._chain": [
 "Phase 2. Builds both edges and both end caps as one closed ring.",
 "A lone tap short-circuits here to the pen's own circle, which needs none of what follows.",
 "Afterwards each piece is given its position within its own rail, because adjacency has to be judged on the original chain rather than on the surviving array — and per rail, because a closed stroke has two closed rails and the last piece of one is not a neighbour of the first piece of the other.",
],
"arc.ChainBuilder.step": [
 "Emits a bounded number of chain pieces per call, so building the ring is itself interruptible.",
 "Walks the left edge, the end cap, the right edge backwards, and the start cap — in that order, which matters because chain position is what the adjacency skip is judged on later.",
 "**The offset point at each shared corner is computed once and given to both neighbours.** That is the difference between a ring that closes because the arithmetic worked out and one that closes because it was built that way.",
],
"arc.cap": [
 "A half-turn end cap at a pivot.",
 "Sweeps through the outward direction — along the travel direction at the end, against it at the start — which is a half turn. Taking the sign from the direction rather than from the endpoints is what stops a cap ever being drawn the long way round.",
],
"arc.Oracle.fill": [
 "Indexes the centreline arcs into a spatial grid, a bounded number per call.",
],
"arc.Oracle.buried": [
 "Is this point inside the pen, by more than a margin?",
 "Queries the grid for nearby centreline arcs and tests the **exact** distance to each. No flattening anywhere.",
 "That exactness removed the binding constraint on the whole resolve. Every point of an offset piece is exactly the pen's radius from its own generator, so an exposed piece reads exactly that and a buried one dips below — and a fragment caught between two nearby crossings dips only a little. With a flattening tolerance in the way, every such shallow sliver read as exposed, was kept, and left a junction with one more way in than out. Measured: flattening at one tolerance left 122 unclosed chains, a finer one left 25, and the exact test leaves none.",
 "A cheap point-to-rectangle rejection runs first, because a grid cell the size of the pen holds hundreds of arcs on a dense stroke and the exact test costs a trigonometric call apiece.",
],
"arc.Grid.insert": ["Adds one item's bounding box to a uniform spatial hash, in every cell it touches."],
"arc.Grid.near": ["Visits the items whose cells a bounding box overlaps — the broad phase for every crossing test."],
"arc.VertexSet.id": [
 "Gives a position a stable identity, so two coordinates that are the same place get the same number.",
 "Searches the neighbouring grid cells as well as the point's own, because a pair of coordinates either side of a cell boundary is not a pair of different places.",
 "Endpoints are registered **before** any crossing, so a crossing that lands on an endpoint adopts that endpoint's identity rather than inventing a vertex a millionth of a unit away — which is how a junction ends up with one more way in than out.",
],
"arc._oracle": ["Phase 3. Builds the burial index, in chunks, then sets the margin — which now only keeps a point sitting exactly on the boundary off a coin flip, rather than absorbing a flattening error."],
"arc._precull": [
 "Phase 4. Drops the chain pieces that are wholly inside the pen.",
 "**Conservative**: only drops a piece when its entire bounding box is buried. Sampling the piece instead is what once dropped real boundary.",
 "Then two more sliced sub-phases that were themselves dropping frames — inserting every survivor into the broad-phase grid, and registering its two endpoints — because a dense stroke leaves ten thousand survivors and that is tens of thousands of operations with nowhere to yield.",
],
"arc._cut": [
 "Phase 5. Splits the chain wherever it crosses itself.",
 "For each piece, asks the grid for nearby pieces and intersects them in closed form.",
 "**Skips immediate neighbours.** Consecutive pieces share a point and a direction, which makes their circles tangent — and two tangent circles meet at exactly the one point they already share. A neighbour has nothing to contribute and everything to confuse. Judged cyclically and within a rail.",
 "Each crossing gets **one** vertex identity, so both pieces are cut at the very same point rather than at two roundings of it.",
],
"arc.pieceIntersections": [
 "The crossing points of two pieces, dispatched by kind: line against line, line against arc, or arc against arc.",
],
"arc.circleCircle": [
 "Where two circles cross.",
 "**Not the textbook form.** The usual formula squares both radii, and this engine routinely intersects circles whose radii differ by ten orders of magnitude: ink carried two levels down arrives as arcs of radius 6.5 × 10¹⁰ — nearly straight, so the radius is enormous — and is cut by an eraser of radius 21.",
 "Squared, the big radius is 4.2 × 10²¹, whose smallest representable step is 940,000, while the quantity actually being sought is at most 441. The answer comes back as zero or negative, so the two crossing points collapse into one or vanish altogether.",
 "That is an entry without its exit: the fragments cannot pair, the walk hands back chains that never close, and every piece gets sealed into its own loop with a chord straight across the object.",
 "Rewritten so no expression ever holds the big radius squared while wanting an answer the size of the small one. Measured on a straddling sweep: sound to a radius of 10⁹, an impossible odd crossing count at 10¹⁰, and by 10¹¹ no crossings found at all where there are plainly four — which is exactly where the arithmetic predicts it turns.",
],
"arc.circleSegment": ["Where a circle crosses a line segment — one quadratic, with the roots kept only if they land within the segment."],
"arc.segSeg": ["Where two line segments cross — one determinant, with both parameters range-checked."],
"arc.paramOf": [
 "Where along a piece a point sits, or nothing if it is off the ends.",
 "The slack is expressed as a length and converted to a parameter using the piece's own size, so the same physical tolerance applies to a long piece and a short one.",
],
"arc.ptAt": ["The point at a parameter along a piece, returning the stored endpoints exactly at the ends rather than recomputing them."],
"arc.pieceBBox": [
 "A piece's extent, including the arc's bulge.",
 "Checks the circle's four axis extremes but only counts the ones the sweep actually reaches, so a small arc gets a small box rather than its whole circle's.",
],
"arc.subPiece": [
 "The part of a piece between two parameters, with its endpoints supplied exactly rather than recomputed.",
 "Carries the chain position along with the fragment. Without it an uncut piece keeps its position and a cut one silently loses it, so any later adjacency test compares a number against nothing and quietly answers false.",
],
"arc._classify": [
 "Phase 6. Splits each piece at its crossings and keeps the fragments the pen does not cover.",
 "A crossing that resolved to one of the piece's own endpoints is not a cut — and dropping it **by vertex identity** drops it on the other piece too, because both saw the same vertex.",
 "Each surviving fragment is tested at its midpoint, which is decisive because the cuts are exactly where the coverage can change.",
],
"arc._stitch": [
 "Phase 7. Walks the surviving fragments into closed loops.",
 "Indexes fragments by their start vertex, then follows each chain: take a fragment, look up what leaves its end vertex, and continue until the loop closes or nothing unused leaves.",
 "**Resumable mid-loop.** One loop of a dense scribble runs to thousands of pieces, and chunking on start indices meant a slice could pick one up and follow it to the end with nowhere to stop.",
 "Area and perimeter accrue **as** the loop is walked, because measuring them afterwards is two more passes over every piece and those passes were the last thing in the resolve with nowhere to yield.",
],
"arc._closeWalk": ["Closes off the loop being walked, carrying its measured area and perimeter with it."],
"arc._finishPhase": [
 "Phase 8. Three finishing passes, all sliced.",
 "**Hairlines first**, before anything counts loops or junctions: strips so thin their two sides are the same line paint nothing, and an unclosed one is a fragment rather than an unclosed boundary.",
 "**One canonical handedness.** Which way the chain wound is an accident of walking one edge before the other, and every consumer downstream is easier to reason about if solid area is positive. A global flip is the only correction that never disturbs an outer loop's relationship to its holes.",
 "**Junction balance** as a health check: a boundary that closes by construction enters every vertex exactly as often as it leaves.",
],
"arc.reversePiece": ["A piece traversed the other way — endpoints swapped and the sweep negated."],
"arc.bakeArcPerimeter": [
 "The whole resolve at once. It *is* the sliced job, driven with no budget, so the two can never produce different answers.",
],

# ---- arcShape -------------------------------------------------------------
"shp.shapeBoolean": [
 "The boolean, with one retry.",
 "Pairing ends at a vertex is a discrete decision made from continuous coordinates: which ends are the same point, and in what angular order. A configuration landing exactly on that boundary — an eraser running tangent to the edge it cuts, three arcs meeting at one point — can pair ends into chains that do not close, and then a real stretch of boundary is simply lost.",
 "Perturbing the welding radius moves the decision off the boundary. A tenth and ten times are both still tiny against every feature in play, and the retry only runs when the first attempt lost something, so nothing normal pays for it.",
],
"shp.shapeBooleanOnce": [
 "One pass of the exact boolean. Six steps.",
 "**Normalise and straighten.** One handedness for both shapes, and any arc bulging less than its own coordinates can express becomes a line — only one of the two can be computed with.",
 "**Pass through what cannot be involved.** A loop whose box misses the other shape entirely cannot cross it and cannot be inside it, so its fate is settled with no geometry at all. On a real drawing that is nearly every loop, and it is what keeps the cost proportional to the gesture rather than to the drawing.",
 "**Cut.** Every crossing between the two shapes, plus the ends of every stretch where they lie exactly on top of each other. The welding radius is taken from the **smaller** shape and from the coordinates where the two actually meet — taken from the larger it swallows the smaller whole, and an eraser a millionth of its target's size is the normal case here.",
 "**Classify.** Each fragment is kept or dropped by asking whether its midpoint is inside the other shape. Fragments lying on the shared boundary are decided by direction instead, because a winding query has no answer to give there.",
 "**Stitch** the survivors into loops, then drop hairlines and seal anything the walk could not close, counting it.",
],
"shp.stitch": [
 "Pairs the loose ends at each vertex, then walks the pairs into loops.",
 "Ends are paired **before** any walking: sweep them by angle and match every departure to the most recent arrival, going round twice so a departure that precedes every arrival still finds the one behind it.",
 "That makes the 'what comes next' relation a bijection on fragments, so its cycles *are* the loops — the walk cannot wander into an ambiguous junction and take the wrong exit.",
],
"shp.subtractShape": ["Shape minus shape, as resolved loops. Both inputs must be simple, and the output is, so booleans compose."],
"shp.intersectShape": ["The part of one shape inside another."],
"shp.clipShapeToRect": ["A shape clipped to a rectangle — the intersection with a rectangle loop, and the exact operation the chain uses at every level."],
"shp.shapeComponents": [
 "Splits a loop set into connected components.",
 "A hole belongs to the smallest outer loop that contains it, so a shape with several holes and several islands comes apart correctly rather than by nesting order.",
],
"shp.normalizeLoops": [
 "Flips a whole loop set if it winds the wrong way, so solid area is positive.",
 "A **global** flip, which is the only correction that preserves the relative orientation of an outer loop and its holes.",
],
"shp.straighten": [
 "Replaces any arc whose bulge is finer than its own coordinates can express with a straight line.",
 "A pen fitting a nearly straight stretch emits radii like 5 × 10¹⁷. At that size the arc and its chord are the same curve, and only one of the two can be computed with — so the choice is made explicitly rather than left to whichever formula runs first.",
],
"shp.pieceOverlap": [
 "Where two pieces lie exactly on top of each other, as a parameter interval.",
 "**The case the intersectors cannot see.** Two coincident curves have no crossing to find, but the overlap still has to start and end somewhere, and a fragment half on the other boundary and half off it cannot be classified either way.",
 "Not a corner case in a drawing app: it is what finishing a cut you started earlier looks like.",
],
"shp.onCurveOf": ["Is a point on the curve a piece runs along — its whole line, or its whole circle? Range is a separate question."],
"shp.windingOfFlat": [
 "How many times a boundary wraps around a point, from a flattened copy.",
 "Returns nothing rather than guessing when the ray grazes a vertex or a tangency, which is what lets the caller retry on a fresh direction instead of silently taking a coin flip.",
],
"shp.rayCross": [
 "Counts signed crossings of one ray against a flattened boundary, detecting its own ambiguity.",
 "A ray that passes within rounding of a vertex is reported as ambiguous rather than counted, because counting it is a fifty-fifty guess that would flip a whole region's fate.",
],
"shp.windingAt": ["The winding number at a point, flattening the shape first."],
"shp.insideShape": ["Is a point inside a shape? A winding query with the ambiguous answer treated as outside."],
"shp.flatPieces": ["A flattened copy of a shape's boundary, for the ray casts to run against."],
"shp.transformLoops": [
 "Scales and shifts a loop set.",
 "Consecutive pieces share their endpoint arrays, so the transform builds new arrays rather than mutating in place — otherwise every shared point would move twice.",
 "Carries the seam-overhang marks across, because they say 'this end is not the object's edge' and that has to survive every hop.",
],
"shp.translateLoops": ["A pure translation — the same transform with a unit scale."],
"shp.transformLoopsAbout": [
 "The same similarity, written so magnification is **exact**: subtract the box centre first, then scale.",
 "The two forms are the same number and not the same computation. Scaling first forms a large product and then adds a large offset of the opposite sign, which loses the low bits before the addition can recover them — and at depth those low bits are the entire detail of the object.",
],
"shp.loopBBox": ["One loop's extent, arcs included."],
"shp.loopsBBox": ["A whole loop set's extent."],
"shp.loopArea": [
 "One loop's signed area, exactly: the chord polygon by the shoelace rule, plus each arc's circular segment.",
 "Exact rather than sampled, because area is what decides whether a cut removed anything and whether a fragment is dust.",
],
"shp.loopsArea": ["The signed area of a whole loop set — outer loops positive, holes negative, so the result is the ink."],
"shp.dropHairlines": [
 "Drops loops whose two sides are effectively the same line.",
 "Measured by **mean width** — twice the area over the perimeter — because the question is how thick a strip is, not how long. A doubled-back strip's winding cancels, so it paints nothing and would otherwise count as its own connected component forever.",
],
"shp.dropDust": [
 "Drops whole components far thinner than the pen that drew them.",
 "Where a cut runs nearly tangent to an edge it leaves a sliver: real geometry, but a speck the user later finds and cannot get rid of. The threshold is a fixed small fraction of the pen, so it scales with the ink rather than with the coordinates.",
],
"shp.meanWidth": ["Twice the area over the perimeter — how thick a piece is, without caring how long it is."],
"shp.repairLoops": [
 "Repairs a loop set that does not close.",
 "Nothing should ever produce one, but a build did, and a document carrying the damage cannot be saved at all: the file format validates closure and refuses the whole drawing over a single bad object.",
 "**Stitches before sealing.** What arrives is rarely several broken boundaries; it is usually one boundary broken once, handed over as the fragments the walk gave up on. Chaining them on the cheapest joins available and sealing once turns several fabricated chords into one small one — measured on two real strokes, the worst fabricated edge went from 46 units to 0.75, and an area 38.6% too large came back to 0.2% under.",
 "Reports how much edge was fabricated, because the severity of a failed resolve should not be an artefact of where the walk happened to give up.",
],
"shp.encodeLoops": [
 "Writes a loop set as a flat list of numbers for the save file.",
 "Consecutive pieces share an endpoint exactly — the invariant the whole representation rests on — so only the loop's start point and each piece's far end are written. Writing both ends would double the file and invite a reload where the two no longer match.",
],
"shp.decodeLoops": ["Reads that flat list back, rebuilding the shared endpoints so consecutive pieces are joined by identity rather than by comparison."],
"shp.shapeFromRings": ["Builds a resolved outline from polygon rings — a drawing made before the arc pipeline."],
"shp.pieceToCubics": [
 "One arc as cubic curves, for the drawing library, which speaks nothing else.",
 "Split into quarter-circle spans, where the conversion is accurate to about two parts in ten thousand of the radius — orders below display tolerance, and **view-independent**, so a path is right at every in-level zoom and never has to be rebuilt for a camera move.",
],
"shp.shapeToCubics": ["A whole outline as cubics, loop by loop."],
"shp.rectLoop": ["A rectangle as a loop of four straight pieces — what a cede subtracts."],
"shp.flattenShape": [
 "A loop set as polygon rings, at a tolerance.",
 "Steps are a function of the piece and the tolerance **alone** — never of the tile — so two tiles clipping the same shape cut identical vertices at their shared boundary and the seam between them stays exact.",
],
"shp.arcSteps": ["How many straight steps one arc needs to stay within a tolerance, capped so a pathological radius cannot ask for millions."],
"shp.spanOf": ["A loop set's largest dimension — the scale everything tolerance-like is measured against."],

# ---- freeze ---------------------------------------------------------------
"frz.chopFreezeLoops": [
 "Cuts every piece on the object's own grid lines, then straightens the ones that have gone straight.",
 "**The only call site in the codebase is the render chain**, which is the divergence: the erase path never runs this, so a cut is made against curves the renderer has already replaced with lines.",
 "**Lines are skipped entirely.** Cutting a line on a grid line yields two pieces of the same line, so nothing downstream can read a difference — and below the freeze depth a shape is *all* lines, which is exactly where this runs most often. That is why the chop costs what a bounding box costs rather than what the clip it precedes costs.",
 "A piece is only frozen if it is **fully chopped** — inside the lines this pass applied — because a piece cut at only some of the lines crossing it has an extent that is the window's rather than the object's.",
 "A piece carrying a seam-overhang mark is never frozen: that end is a duplicate of what the next tile holds properly, cut short, and freezing it would give a chord the neighbour disagrees with.",
],
"frz.pieceSagitta": [
 "How far a piece bulges from its own chord, from local values only.",
 "Half the chord times the tangent of a quarter of the sweep — the bulge form. **The centre never appears**, which is what removes the precision ceiling: by the time a curve is straight enough for this to fire, its centre is billions of units away and computing it is already the unsafe operation.",
 "A piece sweeping more than half a turn cannot be straight by any measure and is reported as infinitely bulged, rather than run through a tangent that is about to change sign.",
],
"frz.freezePiece": [
 "Replaces an arc with the chord between its **own** endpoints.",
 "Never a best fit, which would not pass through them. The endpoints are then unchanged to the last bit, so a neighbouring piece that has not frozen still meets this one exactly — which is the whole of the tile-seam question.",
],
"frz.arcCuts": [
 "The parameters at which an arc meets one grid line.",
 "**Reads the stored centre and radius** — the one place the unbuilt endpoints-and-bulge representation is load-bearing.",
 "What keeps it safe is structural rather than careful: a line is never chopped, and by the third crossing the freeze has turned everything into lines, so an arc is only ever chopped at shallow depths where its centre is an ordinary number.",
],
"frz.markSeamEnds": [
 "Marks the ends the seam-overhang clip made.",
 "Whatever that clip cut, it cut on the rectangle's boundary, so standing on the boundary is exactly the test. The marks travel through every later transform, and a piece carrying one stays a curve.",
],
"frz.tileWindow": ["Which of an object's own tiles a cache rectangle reaches."],
"frz.tileClipRect": ["The rectangle those whole tiles span — the boundary every cut lands on, made of grid lines and nothing else."],

# ---- connect --------------------------------------------------------------
"con.contactArcs": [
 "Where a piece's ink meets a doorway, as intervals in the perimeter parameter.",
 "Walks each ring's edges. An edge with both ends on the same side of the rectangle contributes that whole stretch; a lone vertex on the boundary contributes a zero-length interval, which is recorded but does not by itself mean two regions are joined.",
 "Coalesces the result, so a ring with a thousand boundary vertices costs the same downstream as one with two.",
],
"con.sidesOf": [
 "Which sides of the rectangle a point lies on, within a tolerance.",
 "A corner lies on **two**, which is why this returns a list: a ring that turns the corner has to be able to stay on the boundary through it, or one contact reads as two separate ones.",
],
"con.tOn": [
 "A point's position in the perimeter parameter — one unit per side, running 0 to 4 clockwise from the top-left corner.",
 "**Normalised**, which is the whole trick: the parent measures the rectangle in its own units and the child measures the same rectangle thousands of times larger, and in this parameter those are the same numbers. That is what lets a contact found at one level be compared with one found at the next without ever composing a transform across the crossing.",
 "**The left side runs to 4, never round to 0.** Wrapping it turned a short arc up the left edge into one spanning almost the whole perimeter, which then overlapped everything, and severance never fired at any depth. The circularity belongs in the comparison and nowhere else.",
],
"con.merge": ["Sorts and coalesces overlapping intervals."],
"con.arcsTouch": [
 "Do two sets of contacts share a **stretch** of the boundary?",
 "A stretch, not a point — and that distinction is the whole question a cut asks. When an erase reaches the edge of a tile, the two pieces it leaves necessarily meet that edge at the *same* point, the one the eraser crossed. So a point contact is the signature of a completed cut, not of a join.",
 "Accepting point contact meant a tile cut cleanly in two still reported itself as connected to both halves of its parent, and the object never came apart however carefully it was cut. Measured on the simplest case: a real contact spanning 1.47 of the perimeter against a false one of exactly zero length.",
 "Compares against the interval shifted either way as well, because the perimeter is a circle and an arc straddling the origin is split across both ends.",
],
"con.tOfPoint": ["The same question asked about one point instead of a ring — used by the erase debug overlay so it classifies a boundary by asking exactly what severance asks."],
"con.pointAtT": ["The point at a perimeter parameter — the inverse, for drawing."],
"con.arcOverlaps": ["Whether two interval sets overlap at all, including at a point."],
"con.Groups.union": ["Union-find: joins two members' components. The family graph's connectivity is its cycles."],
"con.Groups.find": ["Union-find with path compression: which component a member belongs to."],
"con.Groups.classes": ["The components, as lists of members."],
"con.Groups.add": ["Adds one member to the union-find structure."],

# ---- lasso / hittest ------------------------------------------------------
"las.rectInsidePolygon": [
 "Is an upright rectangle entirely inside a closed loop?",
 "Exact, and deliberately **not** just a corner test: for a concave loop all four corners can be inside while the loop's own boundary dips through the middle.",
 "One corner inside *plus* no loop edge crossing the rectangle is enough — if the boundary never enters the rectangle, the rectangle lies wholly on one side of it. An edge lying entirely inside the rectangle counts too, since it crosses no side but still means the boundary passes through.",
 "**This is the selection test, and the known gap**: it tests the object's upright rectangle, not its ink, so a diagonal stroke lying comfortably inside the loop is skipped whenever its bounding corners poke out.",
],
"las.pointInPolygon": ["Is a point inside a closed loop, by ray casting."],
"las.segsCross": ["Do two segments properly cross? Four orientation signs."],
"hit.distToPolyline": ["The shortest distance from a point to a polyline — how a click finds a stroke, with the pen width as the slack."],

# ---- clipperOutline / curveOutline ----------------------------------------
"ply.flattenCurve": ["A curve to straight chords at a tolerance, by recursive subdivision on flatness."],
"ply.clipRingsToRect": [
 "Clips polygon rings to a rectangle in plain floating point, preserving winding so holes stay holes.",
 "Deliberately not the integer library: this runs once per crossing forever, and an integer grid whose scale is capped by the largest coordinate quantises deep geometry by whole box units.",
],
"ply.clipPolylineToRect": ["Clips an open polyline to a rectangle, returning the runs that survive."],
"clb.strokeOutline": [
 "A stroke to filled rings, matching what the browser actually paints: the flattened centreline offset by half the width, with round joins and round caps.",
],
"ply.strokeStripNear": [
 "The analytic band: exact inside a window, linear in the centreline, and independent of magnification.",
 "The escape from an offset that goes quadratic in self-intersections. Emits one ring per segment, which is why a caller rendering at a known resolution should simplify the centreline first — the point count *is* the ring count.",
],
"cvo.strokeLoops": [
 "A wide stroke's outline as curve loops — built once and exact at every in-level zoom, so ordinary zooming never re-tessellates it.",
 "Also what the connectivity walk flattens when it needs a raw stroke's painted area.",
],
}
