# The renderer-related test suites, and what happens to each

For the builders: which suites assert a mechanism the plan removes (they are deleted with it,
never ported), which assert something that stays under a new identity (ported), and which stay
untouched. Line counts from 2026-09-25. "Replaced by" names the PLAN §3 invariant test or the
new suite that carries the property forward. A suite marked DECIDE waits for the analysis named.

## src/engine/raster/

| suite | lines | asserts | fate | replaced by |
|---|---|---|---|---|
| `rasterCore.test.js`, `rasterCore.sort.test.js` | 605 | the core loop, the union pass, the plate grid | KEEP | — (`plate.js`'s grid tests move to the pyramid's key maths) |
| `raster.oracle.test.js` | 264 | the core against the coverage oracle | KEEP | — |
| `raster.arcs.test.js` | 820 | the arc flattener | KEEP | — |
| `raster.fz.test.js`, `raster.deep.test.js`, `raster.seam.test.js` | 925 | recorded geometry, piece reach, seams between plates | KEEP | — |
| `raster.occlusion.test.js` | 110 | the occlusion cull | KEEP | extended by the `FLAG_COVERS` and sampled-row tests when §3.7's items land |
| `raster.familyUlp.test.js` | 165 | PLAN §3 row 4 | KEEP | — |
| `rasterCore.clip.test.js` | 400 | PLAN §3's partial re-render row: a clipped plate `===` the whole inside, untouched outside; the merge through `job.clips`; today's whole plates by golden (B-FOUNDATION, 2026-09-26) | KEEP | — |
| `level.crossmap.test.js` | 273 | PLAN §3's crossing-map row (A3 §1.6's seven steps) and the rest of `level.js` (B-FOUNDATION) | KEEP | — |
| `raster.mask.test.js` | 153 | the mark masks only the ink it has not baked; the plane with a mark; what counts as baked | REPLACE | PLAN §3 row 3: the pure rule (targets at pen-up, `handledBy`), incl. the drag-across case |
| `raster.markSnap.test.js` | 148 | F121 per-list done snapshots | DELETE with `noteListMarks` | row 3 — deleted 2026-09-28 (B-SCENE-2, S2) |
| `raster.bake.test.js` | 212 | F90 a bake step under its mark stales no plate (neutral events) | DELETE with the neutral tags | row 3's equivalence (a cut under its mark re-renders its rectangle to the same pixels) — 2026-09-28: ported to the Stage (B-SCENE-2): a cut dirties only inside the mark's box (A2-Q2), the classifier by `stats.neutral` |
| `raster.listCover.test.js` | 140 | F119 `_listWin` covers the plates the list reads | DELETE with `listFor`'s window | a scene test: every plate job holds every item overlapping the plate — 2026-09-28: replaced by `src/engine/stage.cover.test.js` (jobs' ids against `listFor` over each plate, and the pixel oracle) |
| `raster.liveHold.test.js` | 96 | F120 the live path held whatever the view's mode | PORT | `LiveStrokeLayer`: held until its rectangle is fresh |
| `raster.nopaper.test.js` | 456 | stale before paper; the carry, the ladder, the hold (PAPER-PLAN §10.13) | DELETE with the carry, the ladder and the hold | the pyramid lookup test (row 1) and the harness's paper metric |
| `raster.picture.test.js` | 2,520 | C1–C7, FC1–FC7: the composite's call sequence, the modes, the settle, the hold, the fallback compose; F101; F106; F120 | DELETE with `PictureLayer`, except F101 (a destroyed engine puts nothing back) and F106 (a newer stale result replaces older stale pixels), which are ported | row 1 (F106 is the monotone-G rule), a `PicturePyramid` suite for the lookup and the rest render |
| `raster.plates.test.js` | 1,135 | L1–L10: keys, LRU, the byte cap, invalidation by id/rect/frame/quantum, epochs, dpr, visibility release, fallback cover | DELETE the epoch and cover rules; PORT L2 (LRU, pins), L3 (byte cap, `close()`), L7 (dpr), L8 (visibility) | the new store's suite; row 1 — 2026-09-28 (B-SCENE-2): the id/rect/drain rules deleted; L9 is rule 1/rule 2 by G; kept while their code lives: L1, the settle, the cover set, R5a, the crossing probe, F106 by G |
| `raster.job.test.js` | 1,080 | the job wire, the packer, the band builder, the chord estimate | PORT the mark bits (pure rule) and epochs → `G`; KEEP the rest | row 3 — 2026-09-28: J1/J5 by G (B-SCENE-2) |
| `raster.worker.test.js` | 1,171 | the worker entry, the pool, the queue and the drops | PORT: drops by quantum string → by `G`; priorities per PLAN §1.6; cuts in the pool | — |
| `raster.move.test.js` | 1,082 | the drag plane, its compose, the settled view, the landing | PORT (the plane stays; identity, pins and the compose change) | — |
| `raster.translucent.test.js` | 190 | translucent moves through the plane, raster and `?svg` | PORT | — |
| `raster.phone.test.js` | 199 | the phone's plane cap; the finished stroke on the plates (D-3 band vs shape) | PORT the cap; REPLACE P3/P4 | the pen-up rectangle re-render test (row 8) — 2026-09-28: P3 is the Stage's (the band on no plate; the shape at or past its landing G) |
| `raster.overlay.test.js`, `raster.ants.test.js` | 1,865 | the ants overlay and its painting | KEEP (G3 "a quantum change repaints" becomes "a level change repaints") | — |
| `raster.perf.test.js` | 1,061 | `rasterPerf`'s buckets and report | KEEP; PORT the sync/settle bucket rows | — |
| `raster.snapshot.test.js` | 554 | `snapshotView` for the Scenes panel | PORT (budgeted, through the pyramid) | — |
| `raster.engine.test.js` | 1,467 | rule 2's timing budgets; the engine's list build and its buckets | PORT: the list becomes the scene; the budgets stay | row 2 |

## src/engine/ (renderer-adjacent)

| suite | lines | asserts | fate | replaced by |
|---|---|---|---|---|
| `Renderer.*.test.js` (arcs, chop, reorigin, retention, thinscale) | 877 | the SVG renderer | KEEP (the SVG renderer stays for export and comparison) | — |
| `Renderer.liveChunk.test.js` | 61 | the live stroke's frozen chunks | PORT | `LiveStrokeLayer` |
| `erase.neutral.test.js` | 125 | F109 neutral steps | DELETE with the neutral tags | row 3 |
| `erase.zorder.test.js` | 86 | the mark's z follows the bake down | DELETE with `_lowerMark` | row 3 |
| `erase.markFrame.test.js` | 28 | E-5 a mark's derived pieces carry `erase` and its z | REPLACE | the scene reads z and the erase data from the object |
| `erase.cost.test.js` | 68 | EC the candidate scan's cost | PORT (targets recorded at pen-up; the scan runs once) | — |
| `erase.worker.test.js` | 178 | the erase worker | PORT (the shared pool, parallel cuts) | — |
| `erase.stack.test.js` | 259 | a ring through a stack while it bakes: every object ends in two pieces | KEEP the property; PORT the barrier mechanics | — |
| `erase.provenance.test.js` | 194 | F118 the step graph | KEEP | — |
| every other `erase.*` (cede, depth, retrace, severance, fidelity, matrix, layered, contract, composition, styles, fuzz, deepsever, moved, unresolved, dust, seams, farHang, seamBranch, curve.depth) | ~4,700 | the geometry of cuts and descents | KEEP | — |
| `move.hold.test.js` | 164 | R3 the drag's hold of plate events | DELETE with `_holdMove` (no writes during a drag) | the held-items test in the scene suite — deleted 2026-09-28 (B-SCENE-2, S2); `stage.hold.test.js` and raster.move RV5 |
| `move.startCost.test.js` | 66 | a drag's start costs a bounded number of scans | PORT | — |
| `move.below/deep/drag/registration/settle/subtree/twin/normalise/camMerge` | ~1,900 | the document model of moves | KEEP; DECIDE with A1 (the untangling changes settles and carries) | — |
| `select.*` | ~1,460 | selection, lasso, families, detached frames | KEEP; DECIDE with A1 | — |
| `tile.patch.test.js`, `tile.reroute.test.js`, `reroute.memo.test.js` | 323 | TileStore patches and the reroute memo | KEEP; the memo's suite PORTs if the scene absorbs it | — |
| `frame.gc.test.js` | 311 | frame GC | KEEP; DECIDE with A1 | — |
| `src/hooks/useKobinEngine.raster.test.js` | 161 | the raster gate and mount | PORT | — |
| `src/hooks/useKobinEngine.frames.test.js` | 212 | input coalescing: one compose, emit and page `setStatus` for ten wheel events a frame, the camera to the bit; the drag, the pen, arrivals (B-FOUNDATION) | KEEP | — |
| `src/hooks/useKobinEngine.levers.test.js` | 111 | the Dev levers: the URL over localStorage, never the canvas record (B-FOUNDATION) | KEEP | — |

Totals: about 5,600 lines deleted with their mechanisms, about 7,000 ported, the rest kept.
