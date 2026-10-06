# The final design check's audit: the built tree against the design (R-FINAL-D, 2026-10-06)

Tree: `claude/hopeful-dirac-iotb9n` at d16c7d4 plus B-PYRAMID-5b's and B-DOCMAPS-3's uncommitted edits. Method: PLAN
§0–§3 and §5.19–§5.25 read; the code read by grep and line ranges; no suite, harness or browser run by this audit (the
runs cited are the builders' and reviewers', with where they came from). Nothing here was checked in Kobin's Chrome.

## 1.3 The old mechanisms (PLAN §2: "each build ends with the old mechanism deleted")

Grep of `src/` outside `__oracles__/` (the frozen `model-v1` oracle keeps its own copies and a `rasterShim.js`, by design).

| mechanism | in the tree | verdict |
|---|---|---|
| quantum plates, `PictureLayer`, `PlateStore` | 0 outside the oracle's shim | gone. "zoom quantum" survives as wording in `rasterPack.js:15,162,260,716,946,1285,1306` and `OverlayLayer.js:22,491` for the pack's per-`Zq` band memo (now a level's Z) — stale words, minor m1 |
| the sync path, sync-as-a-mode | 0 as code; `KobinEngine.js:585` comment "the sync path" | gone; one stale comment (m1). `rasterPerf.js` keeps the `sync`/`settle` row kinds and modes as report-format slots (`:133,139,142`), kept as is (PLAN §1.8) |
| the settle (raster) | rows of kind `settle` only (`RasterRenderer.js:809,899,1045`), the rest's/pump's row name | gone as a machine (A3 §4.6 names the row kind) |
| the ladder, the crossing prebake, the preview | 0 in raster code; `prefetch.js:23` cites "the ladder's 12 quanta" for the far level's depth; `raster.snapshot.test.js:5` records the deletion | gone (`scaleBar/ladder.js` is the scale bar's own, unrelated) |
| the carry, the hold (plate-event hold), the plate-event queue and drain, epochs | 0 (`_carrySeq` in `Document.js:1149` is the undo's seq carry; `stage.hold` is the new hold) | gone |
| `fallbackCover`, `_renderPending`, `_eraseListStale`, `_buildList`, `_footBelow`, `_drawnRectIn` | 0 | gone |
| `syncCameraOnly` | `RasterRenderer.js:707`, `Renderer.js:489`; called from `KobinEngine.js:724,746,802,823,857`, `selection.js:669` | kept as the renderer's camera step (no overlay rebuild); on the raster path the five predicates are gone (`_panStep` → `_tableStep`, `KobinEngine.js:820`, A2 §2.11). The name PLAN §1.1 lists as going stays as the step's name — built differently, not recorded (m2) |
| the `?pyramid` gate (`cfg.pyramid`) | 0 outside the oracle | gone (B-PYRAMID-2b P6) |
| the interim erase pool | 0; `eraseWorkerClient.js:2–36` submits cuts to a `JobQueue` over `rasterPool` | gone (PLAN §1.6) |
| `listFor`, `TileStore.content`/`contentOffCamera` | `listFor` only as `__testkit__/clipSuite.js:47`'s random-list helper (unrelated); `TileStore` has `read`/`prepare` | gone (B-PYRAMID-3 item 4) |
| `_normalizeHome`, `_homeShift`, `_restoreFrames`, `_keepingSelection`, the per-remove selection listener | 0 as code; comments `Document.js:1079`, `__testkit__/modelFuzz.js:340` record the deletion | gone (B-DRAG) |
| `_settleIfPending`, `_bakeSettled`, `_followCarries`, `_flushCarried`, `unsettle` | `unsettle` only in `Document.js:1197` and `oplog.js:384` (an op from a store before C1) and `legacy/modelV1.js` | gone; the legacy inverse stays to 2026-12-31 (PLAN §1.7 C1) |
| merges: `_mergeShadows`, `adoptShadow`, `holdMerges`, `mergeFrame`, `unmerge`, `_reuseDetached` | `unmerge` only in `Document.js:1196` (an op from before C3), `LevelMap.js:654` (its helper); `mergeFrame` only in `oplog.js:515` and `format2.js:186` (replay/read of old stores); `LevelMap.merge` (`:669`) is the worker lattice's frame import (F67), unrelated | gone; legacy replay kept |
| read mints | `placementModel.displaced` (`:107`) mints none; `TileStore.prepare` mints at the action's end | gone (C3) |
| `_lowerMark`, `_bakeDone`, `_uncut`, `supportsDragPlane` | 0 | gone |
| `_eraseStrokes()` scans | `erasePipeline.js:266` reads the maintained `_marks` set (A2 §4.6), no document scan | built as designed |

## 1.1 The design targets (PLAN §1.1–§1.8)

| target | verdict | the code that shows it; where a difference is recorded |
|---|---|---|
| 1.1 the scene | built as designed | `Stage.js`: `ChunkList` (`:106`), `generation` (`:186`), `onTile` (`:244`, `TileStore.js:98`), `items`/`placed`/`placeNative`/`covers`/`onCommit`/`changesSince`/`snapshot`/`track`/`untrack`/`dirtySince`/`dirtyRects`/`hold`/`setDragDelta`/`release`/`sync`/`batch` (`:257–671`), `touch` for the fitter (`:465`, `KobinEngine.js:891`). One frame path: the raster pan/zoom step is `_tableStep` (`KobinEngine.js:711`); the renderer's camera step keeps the name `syncCameraOnly` (m2). `stage.equiv` went with `listFor` as planned. `marks`/`masks` live in `erasePipeline` (`_marks`, A2 §4.6), not on the Stage — A2 §3.4's interface, as built |
| 1.2 plates: the pyramid | built; differences recorded | `level.js` (`LEVEL_STEP` 1 of {1,2,3}, `SIGMA_MIN` 2^−½, `VIEW_PLATES_MAX` 48, `COMPOSE_IMAGES` 30), `PyramidStore.js:71–79` (3/2 views, 256/96 MiB ceilings, floor = pinned bound), `PicturePyramid.js:39` (`restInlineMs` 8, `patchInlineMs` 6, `patchUserMs` 16, `restQuietMs` 100), `:1256–1286` (48 ms for a user's action, exact preferred when it fits — PLAN §5.22 item 2, B-PYRAMID-5), `jobQueue.js:25` (`PRIO` rest/patch 0 … thumb 5), input coalescing (`cfg.frames`, `flush`, `onZoom`, `KobinEngine.js:103–131,777,1203`). Differences: "older" counted by cause, the rest records kept after a zoom as stand-ins, the patch budgets per action (PLAN §1.2 "As built", §5.13, §5.15, §5.20, §5.22) |
| 1.3 erasing | built; one difference recorded | `eraseRule.js:45` `underMask`; byte masks (`rasterCore.js:427`), 16 slots (`rasterJob.js:46`), `maskSlots` per family (`rasterPack.js:1116`); cuts through the shared queue (`eraseWorkerClient.js`); barriers parked with the chip (`erasePipeline.js:124`, `KobinEngine.js:1195`). Past 16 slots the older mark's cuts are not raised: A2 §4.4's as-built note (`A2-scene.md:1145–1146`: the serial order already bakes the oldest first) |
| 1.4 moving | built as designed (B-DRAG) | `stage.setDragDelta` (`Stage.js:503`), `_dropMove`, `MovePlane.js:26,149,224` (cells grown by one view, D1); PLAN §1.4 "Built 2026-09-30", §5.19, §5.21 |
| 1.5 live stroke and SVG | built as designed | `RasterRenderer` extends nothing (`RasterRenderer.js:6,73`); `Renderer.js:39,267` composes the shared `svgOverlay`; `LIVE_HOLD_MS` 3000 (`PicturePyramid.js:31`); PLAN §1.5 "Built", §5.17 |
| 1.6 the worker pool | built as designed | one `JobQueue` over `rasterPool` for plates, plane, cuts (`eraseWorkerClient.js:15–36`, reserved cut worker `JobQueue._best`), thumbnails at `PRIO.thumb` (`RasterRenderer.js:1291`); the scene index's own worker (`sceneWorkerClient.js`) |
| 1.7 the model, C1–C4 | built; differences recorded | C1 composition (`placementModel.js`), `legacy/modelV1.js` (delete on or after 2026-12-31, `:13`); C2 (B-DRAG, §5.19, §5.21); C3 `cellFrames`/`sameCell` (`LevelMap.js:152,161`), `cellList` (`Document.js:423`), no read mints (`placementModel.js:101–111`); C4 `privateFrame` (`LevelMap.js:605`). Recorded: the shadow merge at the action's end until C3 (§1.7 C1), `displaced`'s mint moved to `TileStore.prepare` (§1.7 C3), F138's four live defects (§5.25). The second parent pointer not built (§5.19 item 2, Kobin's call) |
| 1.8 kept as is | kept | `rasterCore.js` (the clip box added), TileStore's tiles, the op log, `OverlayLayer`, `rasterPerf` (its `sync`/`settle` row kinds kept as format slots) |

## 1.2 The acceptance list (PLAN §3)

The quick suite is the record for the `*.test.js` rows: 2,210 passed, 0 failed, 12 skipped (R-MODEL-C34b, STATUS-LOG
09:27; B-PYRAMID-5b's 03:51 run the same). B-PYRAMID-5b's contended runs had 1 red in 2 of 6 — `raster.pyramid` P1 "a new
prefetch plan supersedes the queued one…", green in 5 runs alone (STATUS-LOG 09:26, being traced); the orchestrator's
final run decides. Probes are not in the quick suite: their record is the run named.

| invariant | the test | present / passing | break-checked |
|---|---|---|---|
| 1 plate G monotone; exact iff `plate.G ≥ dirtySince` | `raster/PyramidStore.property.test.js`; `raster.pyramid` `row1Fuzz` (TEST-MAP:154); `stage.fresh.test.js` (400-step seeds) | present; quick suite | B-PYRAMID-1's 95-rule run (STATUS-LOG 15:24, 2026-09-28) |
| 2 the scene's items equal the list | `stage.equiv.test.js` (+ `stage.equiv.probe.js`, 60 × 80) against `__oracles__/renderList` (`__testkit__/stageFuzz.js:15,57`) — `listFor` deleted, its brute-force read kept as an oracle, so the row outlived its "until `listFor` is deleted" | present; quick suite (the probe: B-SCENE's run) | B-SCENE (PLAN §5.4, §5.7) |
| 3 a mark hides exactly its targets; masked ≈ cut | `raster/raster.eraseRule.test.js` (`:185,204` the pack's bit vs the op history; `:279,327` the 1.5 px / 16/255 envelope; `:383` dragged after the landing), `erase.rule.test.js`, `erase.parallel.test.js` | present; quick suite | B-ERASE: 27 breaks, the clause tests red (STATUS-LOG 20:13, 2026-09-28) |
| 4 a family's union ulp-insensitive | `raster/raster.familyUlp.test.js` | present; quick suite | not recorded by grep (B-FOUNDATION built it) |
| 5 the placed read equals the table | `stage.placed.test.js` (`:138`, seeds × crossings either side of the home) | present; quick suite | B-SCENE's review; R-DRAG's (`placed` without δ, STATUS-LOG:2662) |
| 6 the crossing map exact | `raster/level.crossmap.test.js` | present; quick suite | B-FOUNDATION |
| 7 a selection stands for the same ink | `select.stands.probe.js` (+ `select.inkless.test.js`, `move.drop`) | probe 200+200 green, 16,000 checks (R-MODEL-C34b, 09:27) | each allowance red by an injected defect (PLAN §5.25) |
| 8 no read changes the document | `model.pureRead.test.js` — now without exception (C3: no read mints; `_prepareView`'s key counts GC's forgets) | present; quick suite | red before for the key (PLAN §5.25) |
| 9 every tile piece bit-identical to the frozen model | `model.equivalence.probe.js` + `__testkit__/modelFuzz.js` — "to the bit" with named, counted allowances (carried ≤ 2 ulp, rerouted ≤ 9.3e-10, walkedCut ≤ 2.3e-6, normalised ≤ 1.5e-8) | probe 500+500 green, 40,000 checks (R-MODEL-C34b, 09:27) | each allowance red (PLAN §5.25) |
| 10 a partial re-render equals a full one | `raster/rasterCore.clip.test.js` (+ `.slow`) | present; quick suite | the B-FOUNDATION review (30 of 799 clips red without the two union rules, PLAN §1.2) |

Row 8's wording in PLAN §3 still carries the exception C3 removed ("the one exception: `displaced` may mint…"); row 9's
"to the bit" is now "to the bit with counted allowances". Both corrected in PLAN §3 (see the corrections below).

## 1.4–1.5 Corrections made (documents only)

How checked: every name PLAN §2 and §1.1–§1.7 list as deleted was grepped in DESIGN.md §7–§10 and §13 and in
`docs/ai/20-`, `30-`, `40-`; every `src/engine` file was checked to have a row in `30-CODE-MAP.txt` (all have); the
flags' index rows were read against their sections and the code. DESIGN.md §7–§10 and §13 needed no correction: the
builders kept them true through R-MODEL-C34 (§8's co-residents and private frames, §9's 48 ms user budget and `askG`,
§13's version 3 and the parentless "0").

- `review/rebuild/PLAN.md` §3: row 2 (the oracle is `__oracles__/renderList` since `listFor` went), row 8 (no exception
  since C3), row 9 (named, counted allowances since F138) — each annotated "as built", the design wording kept.
- `review/rebuild/A2-scene.md` §2.11: an as-built note — no `engine.frame()`; `_tableStep` and `syncCameraOnly` (m2).
- `docs/OPEN-FLAGS.md`: F139's section sat under F138's anchor (`#f138` opened F139; `#f139` had no target) — anchors
  fixed; F80 a dated note (C3: the twin merge gone, co-residents); F111 a dated note (R-MODEL-C34b's `_prepareView` key,
  the same shape at the mint); F107's and F108's index "where" columns (`_reuseDetached`, `detachFrame` deleted;
  `removeFrameSubtree`/`restoreFrame` and `privateFrame`/`kidHome` added). F94, F133–F136, F138 rows and sections already
  right; F137 and F139 OPEN, right as of d16c7d4 (F137 is B-PYRAMID-5's to settle).
- `docs/ai/10-STATUS.txt`: header "updated 2026-10-06"; "Where the tree is" rewritten (verified: `origin/rasteriser` is
  56e36b3, the branch has 0 unpushed commits at eee8db1, 4c99a8a is an ancestor of 56e36b3); entries for R-DRAG,
  B-PYRAMID-4 with R-PYRAMID-34, and C3/C4 with R-MODEL-C34 (F138, F139). B-PYRAMID-5's entry follows its landing.
- `docs/ai/00-START-HERE.txt`: the "working branch" line said `rasteriser`, uncommitted — now the session branch on 56e36b3.
- `docs/ai/20-`, `30-`, `40-`: headers dated through the rebuild (their bodies were already true: every code-shaped name
  in them and every backticked identifier in DESIGN §7–§10/§13 was checked by script against production code — the only
  absent ones are named there as deleted); `30-CODE-MAP.txt`'s test list names the rebuild's suites and points to TEST-MAP.

## Findings

No major. Minors (source, reported, not fixed — documents only):

- **m1 — comments naming deleted mechanisms** (CLAUDE.md's comment rule; PLAN §2's "deleted"): "the sync path" at
  `KobinEngine.js:585` (the plane lost when "the camera left its frame, the sync path" — there is no sync path); "zoom
  quantum" at `rasterPack.js:15,162,260,716,946,1285,1306` and `OverlayLayer.js:22,491`, where the memo is per `Zq`, a
  level's (or the rest's) Z. A reader looking for the quantum finds nothing. Fix: the words, when those lines next change.
- **m2 — `syncCameraOnly` survives** as the renderer's camera step (`RasterRenderer.js:707`; called from
  `KobinEngine.js:724,746,802`, `selection.js:669`) though PLAN §1.1 lists it as going; the predicates it stood for are
  gone from the raster path. Recorded now in A2 §2.11; a rename is not worth a change.
- **m3 — `_camToLattice` reuses `_camAt` without checking its frame** (`KobinEngine.js:294`; R-MODEL-C34b's minor, PLAN
  §5.25 item 4, still open): when the camera's frame is missing and `_camAt.F !== F` (the camera crossed into F and F's
  subtree was deleted before a render noted F's chain), the camera is put at the chain of the frame it left. No path is
  known to reach it. Fix: `const at = this._camAt && this._camAt.F === F ? this._camAt : null;` with a test.
- **m4 — PLAN §3 row 4's break-check** (`raster.familyUlp.test.js`) is not recorded in TEST-MAP or the STATUS-LOG by
  grep; every other row's is.
- Closed by grep: PLAN §5.21 item 5's `ownIn` (`eraseDescent.js`) is gone from `src/`.

Carried to R-FINAL-M (measurements, not this audit): F139's paper at the first render after an undo (PLAN §5.25 item 1);
the drop's `setBatch` wrap with a fuller cache (item 2); scenario 3 (item 4); F137 after B-PYRAMID-5.

## B-PYRAMID-5 (landed f58d820, PLAN §5.26): its raster changes against the design

Read by grep and line ranges of `raster/PicturePyramid.js` and `raster/RasterRenderer.js`; no run.

- **§5.22 item 2 (exact over coarse within 48 ms)**: as designed — `PicturePyramid.js:1284–1288`: an action's budget is
  `USER_COARSE_FRAMES × patchUserMs`, the exact patch is inline whenever `T ≤ budget`, and the coarse search runs only past it.
- **§5.22 item 3 (the `unask` G check; the hidden tab)**: as designed — `unask(cells, G)` keeps a newer ask (`:966–969`),
  `_take` answers an ask only at or below the result's `askG`/G (`:1177–1178`); the commit's patch step returns while the
  store is hidden and stays due (`RasterRenderer.js:804–807`).
- **§1.2 (freshness before resolution; the integer map across a crossing)**: as designed, extended — F137's fix
  (`_coarserExact`, `:546–551`, used by step (d) and the coarsest reserve, `:389,443`) takes a coarser cell's exact record,
  else its mapped twin in another frame, which §1.2 gave only at the view's own level. DESIGN §9 says so (B-PYRAMID-5).
- OPEN-FLAGS F137 marked FIXED (heading, a dated note, the index row); `10-STATUS.txt` has B-PYRAMID-5's entry. F140 is
  B-PYRAMID-6's.
