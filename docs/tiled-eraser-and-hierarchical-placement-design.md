# Tiled Erasure, Connectivity, and Hierarchical Placement

**Status:** Implemented and covered by focused integration tests (2026-07-29).

This document records the design decisions made for area erasure, object
connectivity, selection, movement, multiselect, and cache ownership. It extends
`local-frames-design-bible.md` and replaces the experimental arbitrary
erase-window/re-home model. Kobin tiles are implementation details: tile
boundaries must never change user-visible object identity or behavior.

## 1. Core invariants

1. A user edits **logical objects**, not tile fragments.
2. Tiles and polygonized render pieces are invisible implementation details.
3. Object identity is determined by global ink connectivity, not connectivity
   within one tile.
4. A cache is never authoritative for geometry, topology, identity, or
   placement. Deleting every render cache must not change the drawing.
5. Geometry and movement stay in bounded local coordinate systems. A deep
   movement must never be rounded into a shallow object's coordinates, and a
   coarse movement must never be expanded into an enormous deep coordinate.
6. Tile derivation is deterministic from persistent document state.

## 2. Erasure bake

An eraser gesture begins as a real stroke so pointer input remains responsive.
Its geometry is then baked incrementally into every logical object beneath it.

For each affected object:

- Find every current Kobinization tile touched by the eraser footprint.
- Derive the object's ink in each touched tile using the existing tile
  derivation, clipping, curve-flattening, outline, and polygonization logic
  wherever reasonable. Generalize those functions rather than creating a
  second geometry pipeline.
- Derive the eraser stroke with the same fidelity rules. It is a stroke before
  baking and an area outline during the boolean.
- Above the existing fat-stroke threshold, derive the source as a curved
  outline rather than treating sampled centerline points as polygon corners.
- Subtract the eraser area from the object's derived ink independently in every
  touched tile, using one deterministic quantization/fidelity policy.
- Store canonical surviving geometry for the tile core plus its connectivity
  metadata. The overlap outside the core is derivation/raster overscan, not
  duplicate authoritative ink.

An erasure spanning several tiles is therefore handled the same way as an
ordinary zoom derivation spanning several tiles.

### Implemented numeric policy

- Every boolean is translated to the current tile center first. Far-away frame
  coordinates therefore cannot consume Clipper's safe integer range.
- The integer scale targets a quarter display pixel (`4 * displayScale`), rather
  than the earlier over-fine `100 * displayScale` experiment.
- Boolean output is explicitly simplified at a quarter-pixel tolerance. The
  grid is no longer being asked to double as an accidental vertex simplifier.
- Source paths use the existing curve flattening, analytic strip, fat-outline,
  and tile clipping paths. Eraser geometry uses the same curve-aware machinery.
- The eraser footprint is cached once per gesture/tile and reused for every
  target object in that cell.

## 3. Tile overlap and opacity

Opaque and transparent objects use the same tile-boundary geometry policy.

- Geometry is calculated slightly beyond every tile edge.
- Adjacent tiles derive from matching curve data and a shared, deterministic
  clipping/quantization grid.
- The overlap closes antialiasing hairlines.
- Canonical ownership remains the non-overlapping tile core.
- A parent cedes its ownership window exactly. It never paints even a tiny
  distance back into that window, because doing so can repaint the erased area
  as a rectangular notch. The child supplies overlap using guard geometry that
  has already had the eraser subtracted from it.
- Overlapping render fragments belonging to one logical object are composed as
  one union/compound family and receive opacity once. Overlap must not darken
  partially transparent ink.

The overlap distance is defined in device-pixel/fidelity terms and mapped into
the tile frame. A fixed frame-unit overlap is invalid because in-level zoom
spans roughly 3000x.

## 4. Connectivity across tiles and levels

Each authoritative erased tile retains canonical surviving polygons. Exact
edge-interval and local-component summaries are derived from those polygons
while a potentially splitting erase is being resolved; they are not duplicated
as separately persisted mutable state.

The engine maintains a connectivity graph:

- Polygon regions are local graph nodes.
- Shared edge contacts connect nodes in neighboring tiles.
- A child tile reports a compact connectivity summary to its parent.
- If a cut reaches a child edge, the parent uses that summary to determine
  whether regions in the child remain connected through siblings or through
  ink outside the child.
- Connectivity summaries propagate upward until the answer is globally known.

Deep ownership is relayed one ordinary frame edge at a time. A level-15 edit
therefore creates a bounded level-0 -> level-1 -> ... -> level-15 ownership
chain rather than one numerically tiny level-0 window or a level-15 flood fill.
When a local cut may change identity, each parent combines:

- its own canonical remainder,
- the already-proved components reported by its immediate children, and
- quarter-pixel parent proxies used only for outward rendering.

Already-separated child components are never rejoined merely because two
coarse proxies overlap after simplification; only actual parent remainder ink
can reconnect them. A confirmed split is rebuilt bottom-up, giving every new
logical component its own proxy/window chain at every required level.

This supports repeated deep cuts: an object may be erased 98% through, zoomed
into, erased another 98% through, and so on. A local child split does not create
user-visible objects while another route still connects the regions globally.
The final deep cut creates separate objects only when the complete hierarchical
graph proves disconnection.

### Confirmed object behavior

- Regions disconnected inside one tile but connected elsewhere remain one
  logical object.
- Selection and movement include every globally connected fragment.
- A confirmed global split immediately removes the original logical object and
  creates a fresh logical object ID for every connected component.
- No component arbitrarily retains the old ID.
- Each component has a tight global selection bound.
- The complete split is one atomic undoable mutation.

This matches existing same-level area erasure, where the boolean's disjoint
surviving regions immediately become independent fill objects with fresh IDs.

## 5. Deferred baking and interaction barriers

The temporary eraser stroke provides immediate visual feedback while booleans
run incrementally.

- One eraser gesture is one undo operation.
- A second gesture may be drawn before the first finishes.
- Gestures touching the same logical object execute in gesture order.
- Work on unrelated objects or tiles may proceed concurrently.
- Switching to the Select tool does not force pending work to finish.
- Clicking an object touched by a pending gesture synchronously completes that
  **entire eraser gesture** across every affected object and tile.
- The synchronous flush includes polygon booleans, tile-edge connectivity,
  parent propagation, global split materialization, and finalizing the undo
  record.
- After the flush, hit-testing runs again against final geometry. A temporary
  UI freeze at this barrier is explicitly acceptable.

Selection can therefore never begin against a half-baked topology.

## 6. Two different meanings of "tile"

The implementation must distinguish:

### Persistent erasure cells

Canonical surviving geometry and connectivity produced by an erase. These are
document truth because the original centerline alone cannot reproduce the
edited result.

### Disposable render-tile caches

Clipped, flattened, outlined, polygonized, culled, and seam-padded geometry for
a particular frame and tile. These exist only to bound rendering cost.

Render caches may be evicted at any time. Rebuilding them from canonical
geometry, erasure cells, frame edges, and placement must reproduce the same
result independently of camera history.

## 7. Precision-safe object placement

The current movement implementation converts a drag from the active frame into
each object's home frame and mutates its coordinates. That is not safe across
many levels:

- A level-15 movement converted into level 0 can be smaller than a float64 ULP
  and disappear.
- A level-0 movement expanded into level 15 can become astronomically large and
  destroy local precision.
- Moving a level-0 object and a level-15 object separately can therefore change
  their relative positions.

The replacement is now the hierarchical placement model below.

### Placement records

- A drag is stored once in the frame where it occurred.
- Every selected logical object references the exact same immutable movement
  record.
- Objects remain independent after deselection; sharing a movement record is an
  invisible storage/precision detail, not a persistent group.
- Native geometry, persistent erasure cells, and connectivity stay beneath the
  logical object's placement.
- A later movement at another scale adds a placement component anchored in that
  frame.
- Same-frame components may be combined. A component may be absorbed into
  native coordinates only when doing so is provably precision-safe.

### Relative evaluation

Hierarchical placement is evaluated relative to the destination camera/tile.
Shared coarse ancestry is cancelled before coordinates are converted to
ordinary float64 values. The engine must not temporarily flatten a deep point
into a shallow global coordinate or expand a coarse translation into a giant
deep coordinate.

For example, moving a level-0 object and a level-15 detail together at level 0
changes their shared coarse placement while retaining the detail's level-15
offset. Zooming back into the moved corner reconstructs that offset exactly.
Moving the pair at level 15 stores one fine placement component and likewise
preserves their relationship.

### Drag and cache behavior

- During pointer movement, translate the existing rendered family as a
  temporary group for immediate feedback.
- On commit, persist the hierarchical placement and invalidate affected render
  caches.
- Rebuild visible tiles and swap them atomically so no stale/new mixture is
  shown.
- Rigid movement does not rerun erase booleans or connectivity; topology is
  unchanged.
- A cache key includes geometry revision, erasure-topology revision, placement
  revision, destination frame, tile, and derivation configuration.

Frame crossings persist matched parent/child anchors. Placement evaluation uses
floating-point expansions while walking those anchors, adds shared movement at
the common ancestor, and converts back to an ordinary number only in the
bounded destination frame. Save/load interns references to a shared placement
record so a multiselect remains one exact movement transaction after reload.

Placed ancestors are Kobinized through that same one-edge-at-a-time chain.
Directly projecting a level-0 polygon into level 15 would first create values on
the order of `3000^15`; clipping those values is both numerically unsafe and can
return no ink at all. Each intermediate tile instead stays tile-sized. A
placement component is injected at the first frame where it is representable.
If an erase re-homes geometry before a finer component becomes representable,
that component is explicitly carried to the child rather than silently rounded
out of the result.

The camera applies the same principle to zoom crossings. It retains a precise
focal anchor in the frame where a wheel/pinch sequence began and recenters from
that anchor after every crossing. Returning through the same screen focal point
therefore restores deep local residue exactly instead of magnifying a coarse
floating-point rounding error into a visible jump.

## 8. Multiselect

- A multiselect move is one atomic movement transaction anchored in the active
  frame.
- All selected objects receive the same placement record, preserving relative
  positions even when their native geometry is homed many levels apart.
- Deselecting leaves ordinary independent objects.
- A subsequent move of one object adds placement only to that object.
- A global split evaluates the source's current placement into bounded local
  component proxies, gives every component fresh IDs, and starts subsequent
  placement history independently from that exact current position.

### Implemented lasso interaction

- A click retains the existing single-object behavior.
- Dragging empty canvas draws a freeform lasso. Dragging an already selected
  object moves the complete selection.
- Only logical objects fully contained by the lasso qualify. Merely
  intersecting the lasso is not enough, so an enormous background object is not
  accidentally captured with details sitting on top of it.
- Tile fragments are deduplicated by logical-object ID. Every physical member
  of a connected family must be contained for that logical object to qualify.
- A plain lasso replaces the current selection.
- Ctrl-click toggles one object.
- A Ctrl-lasso containing any new object adds all enclosed objects. If every
  enclosed object is already selected, it removes all of them.
- Clicking another object replaces the lasso selection with that one object.
- Lasso release is an erase-completion barrier, just like a selection click,
  because a pending cut may create a newly bounded component.
- The selection panel intentionally contains only count, Delete, and Done; the
  former color/size controls were removed.

Containment currently walks persistent logical families directly and never
generates render tiles. A logical spatial prefilter can be added if profiling a
very large document shows that the all-family candidate walk is material.

## 9. Undo, scenes, and persistence

### Undo

- One eraser gesture is one undo operation, including every tile bake and every
  resulting global split.
- One multiselect drag is one undo operation, referencing its shared placement
  record.
- Undo/redo swaps complete topology and placement revisions; it never replays
  partially current tile fragments.

### Scenes

- Scenes consume logical objects, not tile fragments or connectivity nodes.
- A connected family appears once in scene calculations.
- A confirmed split creates new logical objects and scene membership follows
  the same policy as an ordinary same-level split.
- Placement is resolved through the same hierarchical evaluator used by
  rendering.

### Saving

Persist:

- Native geometry and home frames.
- Frame-tree edges and grids.
- Logical-object IDs and z-order.
- Persistent erased-cell geometry and connectivity summaries.
- Hierarchical placement records and object references.
- Revisions needed to validate derived work.

Do not persist:

- Visible render-tile caches.
- Temporary seam overlap geometry.
- In-progress renderer transforms after a committed move.

Loading begins with empty render caches and must reproduce identical geometry,
identity, connectivity, and placement.

## 10. Performance boundaries

- Boolean work is bounded by touched tiles rather than total object size.
- Connectivity propagation processes only canonical home-level cells and
  immediate-child summaries. It never enumerates the exponentially larger set
  of finest-level descendants.
- Render work is bounded by visible tiles.
- Movement normally changes placement and cache revisions; it does not
  re-polygonize the entire logical object.
- Expansion arithmetic is confined to placement/camera boundary evaluation;
  it is not run for every ordinary geometry vertex in the render hot path.
- Multiselect returns logical IDs from persistent geometry without rendering
  invisible content; a broad-phase logical index remains an optional
  optimization.
- Repeated erasures update existing tile ownership/connectivity rather than
  appending overlapping arbitrary windows indefinitely.

## 11. Paths remain canonical

Paths are not polygonized permanently as soon as they are drawn.

Keeping the centerline as canonical geometry preserves compact storage, curve
fidelity at future zoom levels, and efficient drawing. Polygonized outlines are
created lazily for touched erasure cells and render tiles with level-appropriate
curve fidelity. Permanently polygonizing on draw would not solve placement,
connectivity, tile ownership, or seam correctness and would increase drawing,
undo, save, and synchronization costs.

## 12. Required invariants for implementation tests

1. Clearing all render caches cannot change a screenshot, hit result, object
   identity, or selection bounds.
2. A globally connected object remains one object across arbitrary tile/level
   subdivisions.
3. A final deep cut produces the same components as an equivalent same-level
   boolean.
4. Opaque and transparent tile seams remain invisible.
5. Repeated erases do not grow fragment counts in proportion to gesture count
   when they touch the same cells.
6. A shared move at a deep frame preserves the relative position of shallow and
   deep objects.
7. A shared move at a shallow frame preserves all deep local offsets.
8. Zooming away, evicting caches, saving/loading, and returning through another
   valid frame branch preserve those positions.
9. Moving an erased object preserves every cut and does not rerun booleans.
10. Selection flushes complete pending erase gestures before returning a
    result.
11. Lasso multiselect requires full logical-object containment without treating
    tile fragments as separate objects or generating every render tile.
12. Undo/redo and scenes observe logical objects, never internal tile pieces.
13. A same-focal zoom round trip across one or many boundaries restores the
    same deep-frame camera position and visible object bounds.

### Regression-oracle rule

Tests assert the user-visible or canonical result, not merely that a cache,
window, placement record, or overscan field exists. In particular:

- Curve fidelity is sampled densely against the displayed spline, the
  polygonized eraser, the direct boolean, and the final hit result.
- Seam tests sample both sides of a real tile boundary for opaque and partial
  opacity, including through the erased region.
- Movement tests request actual render lists and hit tests after cache eviction,
  a new frame branch, and save/load.
- Report snapshots are useful for reproducing camera/cache continuity, but a
  report captured after geometry disappeared cannot describe the ink that
  should have existed. Synthetic constructions provide that intended-result
  oracle, and report families are checked independently so another black object
  cannot hide a missing one in the global union.

## 13. Erased-edge fidelity decision

An ordinary stroke keeps its canonical curve, so a deeper render tile can
polygonize it again at higher fidelity. A baked boolean result currently has
polygon rings; if no additional provenance is retained, its erased boundary is
frozen at the fidelity of the bake.

Two designs were considered:

### Retain canonical eraser provenance

Affected objects retain a reference to the eraser's canonical centerline and
width so deeper tiles can reconstruct its curved cut boundary. This preserves
unlimited zoom fidelity, but creates a constructive-geometry dependency graph.
After a cut produces many independent components, each moved component must
carry or clone the relevant eraser-boundary provenance. Later erases create
additional dependencies, complicating movement, splitting, undo, saving,
connectivity, and bounded evaluation.

### Selected: freeze a bounded-fidelity polygon result

After the tile boolean and global component resolution, each result owns
ordinary polygon geometry and no longer depends on the eraser. Chopped pieces
move and re-erase independently, and later booleans operate only on current
geometry. Cost follows current output complexity rather than complete erase
history. The accepted limitation is that sufficiently large later
magnification eventually reveals polygon facets.

For a dense self-crossing gesture that creates many real components, the
bounded-fidelity result is considerably simpler and more robust. The eraser
footprint should still be normalized once per touched tile as the union of its
swept area, then reused across every target object. Component materialization
happens only after the whole gesture's cross-tile connectivity is resolved.

The implemented policy freezes the result at quarter-pixel erase-time fidelity
inside each touched tile. This keeps chopped and multiply-chopped pieces
ordinary independent geometry: they can move, split again, save, load, undo,
and participate in scenes without carrying a growing constructive-geometry
history. Zooming far enough into an old erased edge can eventually reveal its
polygon facets; that is the deliberate complexity/performance tradeoff.
