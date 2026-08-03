# Eraser and Selection Invariant Test Matrix

This matrix records the concrete regression that enforces each design decision
from the tiled-erasure and lasso discussions. A passing test must inspect the
user-visible result or the relevant structural invariant; merely observing that
an internal method was called is not sufficient.

## Eraser geometry and fidelity

| Invariant | Regression |
| --- | --- |
| A baked ordinary eraser follows the displayed fitted curve rather than its raw pointer chords. | `geometry/derive.test.js` — `ordinary tile bakes follow the displayed spline, not pointer-sample chords`; `KobinEngine.tileErase.test.js` — `the baked eraser footprint follows the same smooth spline as its live stroke` |
| Ordinary source strokes and erasers share the normal Kobin tile polygonizer. | The two curve tests above compare a discriminating curve/chord probe through both `polygonizeStrokeInTile` and a completed engine erase. |
| A truly astronomical stroke uses the analytic local-strip path and cannot generate world-sized geometry or an unbounded vertex list. | `geometry/derive.test.js` — `the true mega-stroke fallback stays clipped and vertex-bounded` |
| An eraser leaving a shape edge creates an open curved notch, not a rectangular ownership-window cutout. | `KobinEngine.tileErase.test.js` — `an eraser exiting a shape edge makes a clean open notch without a tile box` |
| Re-erasing a newly split/owned piece operates on its current placed geometry and does not depend on its original tile. | `KobinEngine.tileErase.test.js` — `an erased cell can move beyond its original tile and be erased again in placed coordinates` |
| Repeated erases in one owned cell rewrite bounded cell state instead of nesting windows indefinitely. | `KobinEngine.tileErase.test.js` — `re-erasing an owned tile rewrites the cell instead of nesting same-cell windows` |

## Tile and level propagation

| Invariant | Regression |
| --- | --- |
| A parent-level erase rewrites existing child ownership, so stale child ink cannot paint over the cut. | `KobinEngine.tileErase.test.js` — `a coarse eraser also bakes every covered child ownership cell` |
| One parent gesture crossing multiple child cells rewrites every covered child, not just the first scheduler result. | `KobinEngine.tileErase.test.js` — `one parent-level gesture rewrites two covered child cells, not just the first` |
| A cut crossing a tile line is resolved as global connected components; tiles never become user objects. | `KobinEngine.tileErase.test.js` — `a cut through a tile boundary materializes real global components, not a phantom parent` |
| A nearly severed object can remain globally one object through deeper levels, then split only when the final connectivity route is cut. | `KobinEngine.tileErase.test.js` — `a near-cut bridge can be finished after crossing deeper and becomes two global objects` |
| Deep ownership relays one bounded edge per frame rather than creating a numerically tiny shallow window. | `KobinEngine.tileErase.test.js` — `a far-deep erase persists one ordinary ownership relay per frame edge` |
| Parent summaries resolve a final deep split without enumerating exponentially many descendant tiles. | `KobinEngine.tileErase.test.js` — `a final level-3 cut resolves through compact parent summaries, not descendant tile enumeration` |
| Five overlapping objects are all baked by one gesture and the shared erased edge remains empty after another level crossing. | `KobinEngine.tileErase.test.js` — `one gesture through five objects finishes all five before selection and survives another crossing` |
| A dense multi-chop creates many ordinary movable objects with atomic undo/redo, persistence, and scene behavior. | `KobinEngine.tileErase.test.js` — `a dense one-gesture multichop creates ordinary global objects with atomic undo/save/scenes` |

## Seams, opacity, and cache ownership

| Invariant | Regression |
| --- | --- |
| Both opaque and translucent adjacent cells contain real geometric overscan across their shared edge. | `KobinEngine.tileErase.test.js` — parameterized `adjacent erased cells have real seam overscan at opacity 1 / 0.35` |
| One logical family is rasterized as one compound fill, so overlap cannot double partial opacity or expose sibling-path antialiasing seams. | The adjacent-cell test asserts one renderer child; `transparent erased cells overlap their cores but composite as one logical opacity group` verifies family grouping. |
| Parent ownership windows are exact; the untouched parent never intrudes into a child-owned cell, and seam overlap comes only from the child's already-erased render guard. | `geometry/derive.test.js` — `a tiny ownership window is ceded exactly; overlap belongs to the child guard` |
| Opaque and translucent seams are judged by rendered ink, not by the presence of overscan metadata. Points sampled every 0.5 px remain inked outside the erase and empty through the erase across the boundary. | `KobinEngine.tileErase.test.js` — `adjacent erased cells have invisible seams and preserve the hole at opacity 1 / 0.35` |
| Clearing disposable render caches does not alter hit results or persisted seam/placement state. | `KobinEngine.tileErase.test.js` — `tile ownership, seam metadata, and shared placement survive save/load with empty caches` |

## Deferred work, selection, and lasso

| Invariant | Regression |
| --- | --- |
| Switching to Select does not flush; the first selection click synchronously finishes the affected gesture before hit-testing. | `KobinEngine.edit.test.js` — `selection is barred until the touched object bakes` |
| Clicking one of several affected objects completes the entire gesture across every affected object. | `KobinEngine.tileErase.test.js` — `selecting one affected object completes the entire multi-object erase gesture` |
| Lasso release is the same topology-completion barrier. | `KobinEngine.lasso.test.js` — `lasso release completes pending erase topology before choosing bounded objects` |
| Lasso requires full logical-object containment and does not expose tile fragments. | `KobinEngine.lasso.test.js` — `lasso selects only logical objects fully bounded by it` |
| Plain click replacement and Ctrl click/lasso add-remove semantics match the agreed interaction. | `KobinEngine.lasso.test.js` — the click and Ctrl-lasso regressions |

## Movement and numerical stability

| Invariant | Regression |
| --- | --- |
| Pointer-rate dragging previews existing render groups and performs no document mutation or full rerender until release. | `KobinEngine.lasso.test.js` — `pointer-rate movement previews 200 fragments and commits one placement batch` |
| One multiselect drag stores one shared frame-anchored placement and is one undo operation. | `KobinEngine.lasso.test.js` — `moving a lasso selection shares one frame-anchored placement and undoes atomically` |
| Moving a shallow object and an independent level-15 detail together from level 0 preserves the exact deep offset on the actual newly constructed sibling frame; both remain in the render list and hit-test after cache eviction and save/load. | `KobinEngine.lasso.test.js` — `a root lasso and move preserve a fully bounded level-15 detail on a fresh branch and after save/load` |
| A placed ancestor is Kobinized one bounded frame edge at a time; a direct level-0-to-level-15 projection can never create an astronomical polygon that clips to nothing. | `KobinEngine.userVisibility.test.js` — `a coarse move preserves a deep child after cache eviction and return`; the level-15 lasso regression above |
| Erasing a moved ancestor uses the same bounded placement-aware tiles, and any movement too fine for a relay frame is carried to the next child instead of rounded away. | `KobinEngine.userVisibility.test.js` — `a deep erase of a moved ancestor uses bounded placed tiles and keeps its hole` |
| Zooming out of and back into a deep frame at the same focal screen point restores the deep local camera residue rather than introducing a level-boundary jump. | `KobinEngine.test.js` — `zooming out and back to a deep frame preserves its local focal residue` |
| Frame mappings themselves preserve the same level-15 relationship without relying on camera/cache history. | `LevelMap.test.js` — `a shared coarse placement preserves a level-15 detail on a new moved branch` |

## Broad performance, undo, scenes, and saving

| Invariant | Regression |
| --- | --- |
| Erase target discovery rejects far objects by bbox before polygon work. | `KobinEngine.tileErase.test.js` — `erase target scanning rejects far objects before any polygon work` |
| One eraser gesture remains one undo step before and after deferred baking. | `KobinEngine.edit.test.js` — the whole-gesture undo tests |
| Stale/reloaded baking is recorded and stale undo replay cannot duplicate geometry. | `KobinEngine.edit.test.js` — resumed-bake and stale-replay regressions |
| Scenes consume one logical family, while a confirmed split produces the correct new logical members. | `KobinEngine.tileErase.test.js` — both scene regressions |
| Save/load preserves frame trees, ownership metadata, shared placement references, undo-independent geometry, and starts from disposable caches. | `persist.test.js`, the tile-state save/load regression, and the level-15 lasso save/load regression |
| Submitted reports are replayed through cache eviction and inward/outward crossings, while each logical family is checked independently for rendered coverage. A global union may not hide a missing family. | `KobinEngine.reportRegression.test.js` — the three 2026-07-30 report reconstructions |

## Deliberate fidelity boundary

The canonical result of a completed boolean is frozen at quarter-pixel
erase-time (or normal tile-entry, whichever is finer) fidelity. Future extreme
magnification can eventually reveal facets in that already-baked boundary.
Retaining unlimited eraser provenance was deliberately rejected because it
would make chopped pieces depend on an ever-growing constructive-geometry
history. Ordinary un-erased paths remain canonical curves and are
re-polygonized at the appropriate future tile fidelity.
