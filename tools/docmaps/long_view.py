# -*- coding: utf-8 -*-
"""Comprehensive descriptions — TileStore, Renderer, derive."""

L = {
# ---- TileStore ------------------------------------------------------------
"ts.content": [
 "Everything to draw at one box inside one window.",
 "Works out which cache tiles the window covers, then for each one takes both content classes — coarser ink magnified in, and finer ink minified in — building either on demand.",
 "Pins the tiles currently on screen so eviction cannot take them, then evicts down to the caps.",
],
"ts.ownContent": [
 "The active box's own objects. A plain array read.",
 "It used to re-derive. A parent that had ceded a window still held whole geometry, so its hole existed only as a rectangle and had to be subtracted **per view, every render**, by polygonizing the band and clipping it. Two defects came straight out of that: the result was cached against the view and the fast zoom path skips the render, so an in-level zoom left the cache describing a 16-pixel hole while the object on screen was 3,000 pixels wide; and when it did rebuild it cost 232–386 ms with a handful of objects on screen.",
 "Cutting the ceded tile out of the parent is what made this a plain read.",
],
"ts.setBatch": [
 "Turns on drag mode: a tile the camera cannot see is **dropped** rather than patched.",
 "A change normally patches every cached tile that could hold the object, because one edit is cheaper to patch in than to re-derive. A drag is not one edit — it is one per pointer event per member, and patching a tile nobody is looking at is work thrown away sixty times a second.",
 "Measured on a nine-member family with 5,810 arc pieces and 45 cached tiles: 105 ms of the 130 ms each pointer event cost. Visible tiles are still patched, so what the user is watching stays exact.",
],
"ts._onDoc": [
 "Routes a document change to the incremental cache update: additions patch tiles in, removals filter pieces out, and an edit does both.",
 "Ignores an object that is still live — it will be announced again when it finalises, against its real extent.",
],
"ts._addObject": [
 "Patches one new object into every cached tile that should show it.",
 "For a magnify tile: if the object's box is a direct parent, append it; if it is further up the chain, the tile's correctness depends on intermediate tiles too, so the tile is invalidated instead. A coarser off-branch object also invalidates, because the neighbour pickup is harder to patch precisely than to redo.",
 "For a minify tile: append if the object is non-ancestor and at or below this depth.",
],
"ts._removeObject": [
 "Filters an object's pieces out of every cached tile, or in drag mode drops off-screen tiles outright.",
],
"ts._appendUp": [
 "Adds one object to one already-built magnify tile, using the same classify-and-derive path a full bake uses.",
],
"ts._appendDown": [
 "Adds one object to one already-built minify tile, re-running the size gate and the bounding-box cull first.",
],
"ts._ensureUp": [
 "Returns a magnify tile, building it if the cache misses or the epoch moved on.",
 "Pins the tile before recursing, so building it cannot evict its own ancestors mid-build.",
],
"ts._bakeUp": [
 "Builds one tile of coarser ink magnified into this box. **The chain.**",
 "Collects what the parent looks like over this tile's pre-image: the parent's own magnify tiles (recursively — this is the chain, one level at a time), the parent's own objects, and the objects of the eight boxes around the parent.",
 "Classifies each into empty, solid, or edge. Solid means one object floods the whole tile with no edge in it, and is replaced by a four-cornered rectangle — which is what stops geometry outgrowing a tile and bounds the whole chain.",
 "Edge content goes through the one-step derivation, which is where the chop, the freeze and the clip happen.",
 "Returns nothing at all when nothing coarser than the parent has any content, which is the common case near the top of a drawing.",
],
"ts._ringNatives": [
 "Picks up the objects of the eight boxes surrounding the parent, translated into the parent's coordinates.",
 "**The uncle.** A box is about three screens across, so zooming in slightly off-centre shifts the camera to the next box along, and ink that is right there on screen becomes a *sibling of your ancestor* — coarser than you, but not above you. The magnify chain skipped it and the minify path skipped it too, and it simply vanished. Found by an erase test that cut a hole and then could not find the object.",
 "Cheap and complete because an object never reaches past its box's immediate neighbours, so the ring of eight is the whole of it. Asks each neighbour's own spatial index rather than scanning its objects, because this runs on every bake for eight boxes and a linear scan there is what a drag over a crowded document feels like.",
 "Neighbouring origins differ by whole boxes, so the translation is exact, and nothing is minted just because a tile was looked at.",
],
"ts._solid": [
 "Emits the tile-covering rectangle that stands in for a flooding object, overlapped into its neighbours by the seam pad.",
],
"ts._ensureDown": [
 "Returns a minify tile, building it on a miss.",
],
"ts._bakeDown": [
 "Builds one tile of finer ink minified into this box.",
 "Gathers every content-bearing box that is not an ancestor and is at or below this depth, sorted by depth so the 'this whole box is too small to see' test can stop early.",
 "For each object: measure its size at this level's deepest zoom — a view-independent number, so the verdict does not flicker as the camera moves — and drop anything below the cull threshold. Content just above it is tagged with its size so the renderer can fade it continuously rather than popping it in.",
 "Then a bounding-box rejection against the tile, and a single direct projection. One jump is safe here at any distance because minifying only shrinks coordinates.",
],
"ts._downPieces": [
 "Clips one minified object to one tile.",
 "A resolved outline minifies exactly, so all that happens is a clip to the padded tile and a flatten at this level's display fidelity. Fills are clipped as rings with their winding preserved so holes stay holes; strokes are clipped as polylines with the line width added to the window so end caps land beyond the padded tile.",
 "**Stores polygons, not arcs** — the one place the chain's exactness is not carried through. Safe for exactly one structural reason: a minify tile is a leaf. The chain reads the parent's magnify tiles and its objects, never its minify tiles, so a polygon made here can never be inherited or used as a boolean operand.",
],
"ts._evict": [
 "Evicts least-recently-used tiles down to the global cap, never touching anything currently on screen, then applies the per-box cap.",
],
"ts._evictPerLevel": [
 "The per-box half of eviction, so one busy box cannot consume the whole cache.",
],

# ---- Renderer -------------------------------------------------------------
"rnd.render": [
 "The per-frame difference. Rebuilds only what actually changed.",
 "Groups the display list by object — or by **family**, when every member of a family is fully present rather than fading, so a multi-level object draws as one path and its pieces do not seam.",
 "Builds a signature per group and compares it with the last one. Same signature means identical geometry, so the existing paths are reused and only the opacity is reapplied.",
 "Rebuilt groups are inserted at their drawing-order position; vanished ids are removed.",
 "Reports whether anything was reordered, and records how many groups were rebuilt — zero means a fully cached crossing.",
],
"rnd.syncCameraOnly": [
 "A camera move with no geometry rebuild: write the world transform, and refresh opacity for the groups that fade, because fade depends on the live zoom.",
],
"rnd.syncWorld": [
 "Writes the world transform, folding the scene's local origin into it **in full precision**.",
 "Anchors are stored relative to a local origin so they stay small, and the bracketed translation is screen-sized whenever the view is near the content. The cancellation between the pan and the scaled origin happens here, in the engine's own arithmetic, where it is exact — nothing large ever reaches the drawing library's lower-precision matrices or the browser's rasterizer.",
 "Also refreshes the debug overlays and the selection indicator, which all follow the same transform.",
],
"rnd._activateLevel": [
 "Makes one level's retained scene subtree the active one, swapping it in under the world transform.",
 "That is the whole point of retention: a crossing becomes one detach and one attach instead of rebuilding every path. With retention off, every level shares one scene and the difference rebuilds exactly as it did before.",
],
"rnd._evictScenes": [
 "Caps how many level subtrees are retained, dropping the least recently activated.",
],
"rnd._maybeReorigin": [
 "Re-anchors a scene on a fresh local origin when the view has drifted too far from the old one.",
 "Wipes the scene's groups, keeping the map identity, so the next difference pass rebuilds every path relative to the new origin. Costs one level-flip-sized rebuild at a very rare cadence.",
 "Never mid-stroke: the live path's anchors are origin-relative and a swap under the pen would desynchronise them.",
],
"rnd.needsReorigin": [
 "Has a camera-only move drifted past the budget, so the engine must promote it to a full render?",
],
"rnd._driftPx": [
 "How far the view centre is from the scene's local origin, in screen pixels — the quantity that bounds the browser's own rounding error on painted vertices.",
],
"rnd._sig": [
 "A group's signature. Same signature means identical geometry, so the paths are reused.",
 "**Must include coordinates, not just counts.** A straight stroke crossing several tiles yields several pieces of identical shape, and a flooding object yields a four-cornered rectangle per tile — so scrolling the tile set by one swaps pieces without changing any count, and a count-only signature would leave stale paths on screen.",
 "**Must include the edit counter.** Coordinates are rounded here, and at the deepest in-level zoom a whole pixel of drag is below the rounding — without the counter a dragged object would keep its old path and sit still while the pointer moved.",
 "A resolved outline's signature carries no window and no zoom, because the outline is view-independent: its group survives every camera move.",
],
"rnd._buildPieces": [
 "Builds a group's paths, merging every plain fill of one colour into a **single** path rather than one path each.",
 "Abutting fills seam. Two opaque paths sharing an edge each cover part of the boundary pixel and composite in sequence, so up to a quarter of the background still shows: a pale hairline down every join. Measured on a ceded tile — an interior pixel lifted 18–25% toward white at every in-level zoom, which is exactly the 'hairline outline around the erase' this kept being reported for.",
 "Subpaths of one path do not seam: the rasterizer accumulates coverage across all of them before compositing anything.",
 "That is what lets the cede model keep its cut exact — parent and child abutting with no overlap at all — instead of paying for an overlap that would have to be sized against the view.",
],
"rnd._buildInto": [
 "Builds one piece into a group.",
 "A resolved outline becomes anchors via its cubic conversion. A fill becomes a polygon path. A wide stroke becomes a filled capsule outline.",
 "**A stroke that has been drawn but not yet resolved is drawn from the pen's own arc chain** rather than letting the drawing library run its own spline through the samples. That is what makes pen-up invisible: the ink under the pen, the ink between pen-up and the bake, and the resolved shape are all the same curve. Without it the stroke twitches twice — once at pen-up and again when the bake lands.",
],
"rnd.pushShapeAnchors": [
 "Appends a resolved outline to a path as anchors.",
 "Each loop ends exactly where it began and the path stays **open**: a fill auto-closes its subpaths, whereas marking the path closed would rule a stray segment from the end of one loop back to the start of the whole path.",
],
"rnd.pushGapAnchors": [
 "Appends one gap's worth of the live pen's arcs as anchors.",
],
"rnd._addFillPath": ["Adds an accumulated polygon path to a group, with its colour and opacity."],
"rnd._addShapePath": ["Adds an accumulated outline path to a group, with its colour and opacity."],
"rnd.mkPath": [
 "Builds a path without ever handing the drawing library an unbounded array.",
 "The library's collection constructor spreads its input as function arguments, which gives out past roughly 131,000 anchors — and that is reachable by **drawing**, not only by pathological input: a wide stroke's capsule outline runs about thirteen curves per sample, so a few thousand points of one scribbled drag crosses it, and an erased fill is worse.",
 "It surfaces as a crash with no ink at all rather than a slow render, because the throw happens before the path reaches the scene.",
],
"rnd._applyThinScale": [
 "Rescales an object whose features are too small **in the numbers handed over**, however much the transform then enlarges them.",
 "Chrome drops such a path entirely. Measured on the real geometry, holding the on-screen result pixel-identical and varying only the numbers: a feature 0.0657 units across renders and 0.0641 does not, while the app was handing over 0.0033.",
 "The fix is a change of units for that object alone: multiply its anchors by a power of two and divide its own group's transform by the same number. Pixel-identical by construction, and applied at the end of the build so nothing upstream knows it happened.",
 "It costs nothing in caching, because the numbers come from the level projection rather than the zoom and do not change as the camera moves.",
],
"rnd._applyOpacity": [
 "Applies an object's opacity to its group, multiplied by the continuous fade.",
 "Opacity lives on the group rather than the paths so that overlapping pieces of one object union before opacity applies, instead of double-darkening where they overlap.",
],
"rnd._fade": [
 "The continuous fade factor across the sub-pixel cull.",
 "Converts a piece's tagged size into its actual on-screen size at the current zoom, and ramps linearly from fully transparent at the lower threshold to fully present at the upper one, so content shrinks out of existence smoothly rather than popping.",
],
"rnd.needsFatFlip": [
 "Is a wide stroke approaching the point where raw stroking becomes unsafe, so it must flip to its outline form before the next frame?",
],
"rnd.needsFadeFlip": [
 "Has any piece crossed the fully-present line since its group was built?",
 "Grouping is decided during a full render, but fade is a function of the live camera — so a zoom can invalidate the grouping without anything else changing, and a camera-only frame reapplies opacity **without regrouping**.",
 "Without this the stale grouping simply persists: the member that should have left the family stays in it, and the whole family wears its fade. That is the defect where a cut-off piece faded out of existence while zooming.",
],
"rnd.hasPendingNearFat": [
 "Are wide strokes close enough to the gate that the engine should start fitting their outlines during idle time?",
],
"rnd.needsRebake": [
 "Does this camera move need a re-tessellation? Only the debug outline view is baked per window and zoom now — ordinary strokes render as outlines that are exact at every in-level zoom, so ordinary zooming never re-tessellates anything.",
],
"rnd.outlinePad": [
 "How far past the view the debug bake window must reach: half a screen, or 1.2 times the widest visible wide stroke's half-width, whichever is larger, so the window cannot be outrun by a stroke.",
],
"rnd._insertSorted": [
 "Inserts a group at its drawing-order position by binary search.",
 "The pen's hot path only ever appends, because a live stroke has the highest id.",
],
"rnd._fatPolys": [
 "A wide stroke's filled capsule outline, fitted lazily and cached.",
],
"rnd.addLive": ["Attaches the in-progress stroke to the scene, outside the difference pass, so it is immediate."],
"rnd.setLiveArcs": ["Redraws the in-progress stroke from the pen's current arc chain."],
"rnd.endLive": ["Detaches the in-progress stroke; the resolved object takes over."],
"rnd.update": ["Tells the drawing library to flush to the screen."],
"rnd._renderSelection": [
 "Draws the selection box, and only while it could actually be seen: it must overlap the viewport and be no more than a few viewports across.",
 "That second clause is a performance rule, not a cosmetic one — a selected object seen from far below is astronomically large on screen.",
],

# ---- derive ---------------------------------------------------------------
"der.bboxOf": [
 "An object's extent in its own coordinates, cached on the object.",
 "Exact for a resolved outline, bulges included — a chord-only box would understate a half-turn end cap by the whole pen radius.",
],
"der.classifyUp": [
 "Sorts one object against one tile into empty, solid, or edge.",
 "Every question is asked over the **padded** tile, because that is the rectangle about to be painted: a solid rectangle is emitted padded, so ink just outside the tile but inside the pad would otherwise be invisible to the classifier.",
 "Padding is used at its maximum regardless of opacity, because classifying something as edge that could have been solid only costs a little work, while the reverse paints over detail.",
 "A resolved outline is always edge: the clip decides covered-versus-cut exactly, with one inside-outside query, so there is nothing for a heuristic to add.",
],
"der.solidQuad": [
 "The four-cornered rectangle a flooding object is replaced by, overlapped into its neighbours.",
 "Four vertices forever — **this is what bounds the magnify chain**, and stops geometry outgrowing the tile that holds it.",
],
"der.shapeRingsInRect": [
 "One outline's contribution to one tile, as polygons.",
 "**Clips first, flattens after.** The other order would tessellate the entire perimeter at this level's fidelity before throwing nearly all of it away, and magnification makes that ruinous — a magnified radius needs many times the steps for the same accuracy, so a 2,000-piece perimeter becomes ~120,000 vertices per tile.",
 "Two fast paths. If no piece of the perimeter reaches the tile, one inside-outside query settles whether the tile is flooded or empty, with no boolean at all. If the whole shape lies inside the tile there is nothing to clip — the common case for anything shown from a finer level, and worth 5.5 ms per tile per member down to 0.2 on a real drag.",
 "Works local to the tile and translates back, so precision follows the tile's own size rather than how far it sits from the origin.",
],
"der.shapeLoopsInRect": [
 "The same clip, **handing back arcs instead of polygons**.",
 "This is the fix for the defect where every level inherited a polygon. A tile is built from its parent's tile, so whatever a tile holds is what the next level down inherits — and flattening here looked harmless, because the polygon is within a quarter pixel of the curve when it is made.",
 "But a chord is only a valid stand-in for the span it was fitted to, and the next level magnifies **one** of those chords to fill the screen. Measured before the fix: a 42-arc stroke became a 793-point polygon one level down and a five-point one two levels down, with the painted edge 263 pixels from where the shape said it was.",
 "Clipping an exact arc against a rectangle gives an exact sub-arc, so carrying arcs costs nothing and the chain stays exact however deep it goes.",
 "Marks the ends the seam overhang made, so the level below will not measure a duplicate-cut-short for straightness.",
],
"der.deriveStep": [
 "One step of the chain: everything that happens when ink crosses one level downward.",
 "**Culls** on the transformed bounding box before any geometry work.",
 "**Transforms** the outline, cancelling against the box centre before scaling so magnification is exact.",
 "**Chops and freezes** on the object's own tile grid — the only place in the codebase this happens. The grid rides with the object, so the cuts land in the same place on it however far it has been moved; anchored to space instead, a move slides every cut, which moves a frozen crossing a quarter pixel here and thousands of times that one level down.",
 "**Clips to the object's own tiles**, grown by the seam pad — never to the cache square. Two squares holding the same stretch of curve therefore hold the same pieces of it, bit for bit. The window comes from the **bare** square, not the padded one, or one tile becomes three per axis.",
 "**Size-gates strokes**: genuinely wide ones become filled outlines, the rest stay strokes with their centreline clipped past the padded tile so their end caps overlap properly.",
],
"der.bandRings": [
 "The one place a stroke's painted band becomes filled rings.",
 "One place, deliberately: the erase needs a target's footprint in exactly the geometry the bake would paint there, or the hole and the ink disagree along their shared edge. It used to exist twice and the copies drifted.",
 "**Two regimes.** Ordinary strokes take an offset over the whole centreline, with round joins and caps, matching what the browser paints.",
 "A centreline that is astronomically long, or whose offset radius dwarfs the window, takes the analytic strip instead: the ordinary offset tessellates the full arc of every cap at uniform tolerance and unions the band with itself, which goes quadratic in self-intersections — one stroke measured at 583 seconds.",
 "For the analytic branch the centreline is clipped to a window first, and the flatten window must be the clip rectangle rather than the width-grown one: for a giant stroke the half-width is astronomical and a grown window collapses the pruning, so the recursion runs away — one measured case reached millions of nodes and ran out of memory.",
],
"der.seamPad": [
 "How far a piece may reach past its own tile, so anti-aliasing leaves no hairline between neighbours.",
 "Absolute and derived from the config, measured where a tile is smallest on screen. It used to be a **fraction of the tile**, which made the overlap depend on the canvas size the grid happened to be captured at: 0.96 px on a desktop and 0.48 px on a small screen — a visible hairline on exactly the screens least able to hide it, and under the one pixel it exists to cover even on desktop.",
 "Returns zero for translucent ink when opacity grouping is off, because overlap would double-darken and the hairline is then the lesser evil.",
],
"der.projectedSizePx": [
 "An object's on-screen size at a level's deepest in-level zoom.",
 "View-independent by design: this is the cull and fade measure, and a measure that moved with the camera would make content flicker in and out as you zoomed.",
],
}
