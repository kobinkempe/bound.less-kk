# B-PYRAMID-2 — the brief (2026-09-28, orchestrator)

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (all 19 rules;
rule 19 on context hygiene is the one builders have broken). **Scratch:** `<scratchpad>/bp2/`.

**Read, in this order, only the parts named:** `CLAUDE.md`; `DESIGN.md` §7, §9, §10, §15; `review/rebuild/PLAN.md`
§0, §1.2, §1.4, §1.5, §1.6, §3, §4, §5.1, §5.4, §5.5 and any later §5.x; `review/rebuild/A3-pyramid.md` §1–§6,
§8–§10 (§7 is B-PYRAMID-3's, below); `review/rebuild/A2-scene.md` §2.11–§2.13 (the Stage interface the renderer
reads); `review/rebuild/TEST-MAP.md`; in `review/rebuild/STATUS-LOG.md` the entries of B-FOUNDATION (its end),
B-SCENE-2 (its end), B-PYRAMID-1 (its end), the B-SCENE review and the B-PYRAMID-1 review (grep `^## ` for the
headings, read those entries only); the JSDoc headers of `src/engine/raster/PyramidStore.js`, `PicturePyramid.js`,
`jobQueue.js`, `prefetch.js` (the interface is documented there; the integration lines are §2 below).

## 1. What B-PYRAMID-2 is

A3 §10.1 steps 6, 8 (the levers taking effect), 9 and 10: the pyramid wired into `RasterRenderer` under
`cfg.pyramid` (`?pyramid=0|1`, A3 §7.4), the pen-up group commit on the live path, the MovePlane port, the
levers taking effect, the harness comparison both ways, then the deletion of `PictureLayer`, the old rules of
`PlateStore`, the quantum half of `plate.js` and the suites TEST-MAP deletes, with the docs corrected.

**Not this build:** step 11, the SVG demotion (`SvgLayer`, `LiveStrokeLayer`, the shared overlay module,
`RasterRenderer` no longer extending `Renderer`; A3 §7) is **B-PYRAMID-3**, a separate build after this one.
Steps 1, 2, 7 and the levers' UI landed with B-FOUNDATION (4e8ce80, reviewed in 3c721aa); steps 3, 4, 5 landed
as modules with B-PYRAMID-1 (877ba07; the queue exists as `jobQueue.js` and is not yet adopted by
`rasterWorkerClient`).

**Done means** (preamble rule 14): the pyramid is the only picture path; `PictureLayer.js`, the old `PlateStore`
rules, `plate.js`'s quantum maths, `cfg.pyramid` and the deleted suites are gone; the harness numbers of §6 are
in the status log; DESIGN, `docs/ai/`, PLAN §1.2 and TEST-MAP are true. A component is not done while the old
mechanism runs beside the new one — except between P1 and P5 below, where the flag keeps both for the comparison.

## 2. The integration surface (B-PYRAMID-1's open-items list, its words)

- **`RasterRenderer.js`, constructor, under `cfg.pyramid`:**
  `PyramidStore({fresh: stage, maxBytes: pyramid.budgetBytes(), phone, onRelease: () => pyramid.onStoreRelease()})`;
  `PicturePyramid(host, {store, stage, lm, cfg, onRequest: (jobs) => queue.push(jobs), pack, measure, onSample: (s) => pyramid.calibrate(s)})`;
  `JobQueue({pool, clock, store, gens: pyramid.gens, onDrop: () => pyramid.refresh()})`.
- **`RasterRenderer`, `pack(job)`:** `packJob` over `stage.items()` at `stage.generation`, or over `job.table.items()`
  at `job.table.generation` (the prefetch's far and crossing jobs), with `Zq = job.Z`, plates from `job.cells`,
  `job.clips` as an `Int32Array`; `store.beginJob(id, strip.cells, G)` at dispatch.
- **`RasterRenderer`, `measure(job)`:** E `visibleChords` over the cells at `job.Z`; A total item box pixels clipped
  to the cells or clips; U union family-rows inside the clips; P cells with at least one item.
- **`RasterRenderer._takeResult`:** per plate `{...cell, G, bitmap|pixels, bytes, jobId, clip}` → `pyramid.onResult`;
  then `store.endJob`, `queue.done(id, ms)`, `pyramid.calibrate(sampleOf(res, job.est && job.est.U))`.
- **`RasterRenderer`, frame step:** `frameFor` → `queue.setMotion` → `queue.frame()` → `queue.pump()` → `compose()`.
  At idle `queue.push(prefetchPlan(view, stage, store, {...cfg, atRest, focus, reportBusy, gens}))` and
  `pyramid.setFar(farKeysOf(jobs))`. On `setSize` also `store.setBudget(pyramid.budgetBytes())`.
- **Pen-up:** when a stroke's shape lands, `pyramid.groupCommit(id, box, () => live.release(id))` before the next frame.
- **`KobinEngine.js`:** one more frame after the camera stops (stillness is seen only on a frame); `onCommit` →
  the store's `dropFrames` / `dropAll` as for `PlateStore` now; `setLevers` → `store.setBudget(pyramid.budgetBytes())`;
  `isPhoneBudget` imported from `PyramidStore` once `PlateStore` goes (`useKobinEngine.levers.test.js` too).
- **`rasterWorkerClient.js`:** adopt `JobQueue` (pool = `{size, free, submit}`, `done` on result or failure, `requeue`
  in `failPool`), then delete `current`, `dropStale`, `pruneCurrent`, the q form of `dropQueued`, `bestIndex`/`LOW_PRIO`
  and its `STRIPS_PER_WORKER`.
- **`MovePlane.js` port:** publish `{showing, state, partial, frameId, Zp, off, layers: [{kind, tag, cells}]}` to
  `pyramid.setPlane` and its keys to `store.setPlanePins`. `PyramidStore` imports `MOVE_PLANE_PLATES` from
  `MovePlane`: if the port imports `PyramidStore`, move those constants out of `MovePlane` first (no cycle).
- **Duplicates until the old files go:** `isPhoneBudget`, `HIDDEN_RELEASE_MS`, `PLATE_BYTES`, `COMPOSE_IMAGES`,
  `STRIPS_PER_WORKER`. One implementation each at the end (preamble rule 3).

## 3. Asks carried from the earlier builds (PLAN §5.4; the 05:05 entry)

1. **The camera's read budget** (B-SCENE-2): the camera step's `stage.sync` reads with `Infinity` today. A3 §4.2:
   budget 0 (cache hits only) while the camera moves, missing tiles baked at idle one per slice; a cell whose
   rectangle `stage.covers` says is not all in the table is planned from stand-ins and never dispatched; the far
   levels and the crossing target read `stage.snapshot(frame, rect, budgetMs)`.
2. **`_renderPending` removed** (B-SCENE-2 kept it because `flushBakes` reads it): the pyramid's request map and
   the queue carry what is pending; `flushBakes` and the harness read the queue's report.
3. **`job.ids` off the wire** once `stage.cover.test.js` reads the Stage (it does since 1cac470: check, then remove).
4. **The harness prints the load average** (`uptime`'s three numbers) at the start and end of every run.
5. **The zoom-out paper "regression" was the sampler** (PLAN §5.6 item 8): the harness's rAF-only sampler charges the
   share read before the engine's frame across a whole long frame and spreads 2–9 s between runs of one tree; a
   post-paint sampler gives 36.6 ms (the Stage landing) against 49.8 ms (the list path) on scenario 1, with no
   `covers` or dirt refusals in seven runs. Fold the B-SCENE reviewer's post-paint sampler (`scratchpad/rv2/bcp.js`,
   its `harness-paint.py` patch) into `browser-check.js` for the old path; the new path reports the pyramid's own
   integrals; every number says which sampler produced it.
6. **B-FOUNDATION's Q8**: today's drag compose reaches 33 images (the cliff). The compose's image count includes
   the plane's layers; when base + plane exceed `COMPOSE_IMAGES` the plan goes through the surface (A3 §6:
   `_planeBelow` keeps the base under the plane out of the count). Measured in scenario 4: max images ≤ 30, or
   the surface used, never the cliff.

## 4. Decisions already made — do not reopen

- **Kobin's decisions** (PLAN §0): 1 the level step S ∈ {1, 2, 3} with the Dev lever, the cache cap; 2 blurrier
  now, never older, blur limited to what changed — `olderMs` is 0 in every scenario, a non-zero value is a bug;
  4 five drag layers and the pre-render stay; 5 partial re-render first; 6 the SVG renderer only for
  comparison and export (B-PYRAMID-3 finishes that).
- **The surface rule and the pin bound are decided** (PLAN §5.6 items 1–3, from the B-PYRAMID-1 review): stand-ins
  counted apart from own plates, `cap = COMPOSE_IMAGES − plane.images`, `_ownCount` gone, rest mode's scaled ℓv
  plates counted as stand-ins (M1); the one-view record cap gone, pinned ≤ own-grid records
  (≤ `max(viewPlates(σmin·2^−h), viewPlates(1))`) + 30 stand-ins + the plane cap, the budget floor that sum, the
  phone's ceiling `max(96 MiB, the floor)` (M2, Q3). Stand-ins stay inside the surface (Q2). This is your P0.
- **The plane's constants** `MOVE_PLANE_PLATES` / `MOVE_PLANE_PLATES_PHONE` move to `raster/level.js` beside
  `VIEW_PLATES_MAX`, `MovePlane` re-exporting them until ported (PLAN §5.6 item 6) — P3's first edit.
- **Two notes from that review** (PLAN §5.6 item 7): a stale rest cell's cover must also search the mapped frame
  (after a crossing the frame just left holds the fresh picture; scenario 1's `olderMs` would show it); `_aim`'s
  arrival estimate counts in-flight jobs although `pump` dispatches only to a free slot — settle it from the real
  dispatch when you adopt the queue.
- **The plane's identity** is A3 §6's: `F │ P<Zp> │ <tag> │ i,j` with G, Zp the rest Z when aimed at rest, the view
  level's Z otherwise; coarser plane levels `Zp / 2^k`, the quick level `Zp / 4`. D1: only the SEL runs are cut
  against the view grown by one view each way. H4: never both — SEL is drawn translated only where the start
  footprint is covered by a BELOW source; elsewhere the selection stays in place that frame and the ants move.
- **Pen-up** (PLAN §1.5, A3 §3.6): pending from pen-up until the shape bakes (packs skip it, it is hit-testable,
  it dirties nothing, the SVG path shows it); when the shape lands, one partial re-render of the drawn cells under
  its rectangle and a group commit that publishes those plates and releases the SVG path in the same task; a group
  older than `LIVE_HOLD_MS` commits what it has. No cap on the pending path (PLAN §5.4 Q2).
- **The rest render** inline iff the estimate ≤ 8 ms else the workers after 100 ms of stillness; **partial
  re-render** inline within 6 ms else coarse-first with the full patches following at top priority (A3 §3.3–§3.4).
- **Cuts in the shared pool** (PLAN §1.6, `PRIO.cut` with one worker reserved): B-ERASE is building an interim
  N-worker pool behind `submit` in `eraseWorkerClient.js`, which is **B-ERASE's file, not yours**. Route the cuts
  through the `JobQueue` only when the orchestrator tells you B-ERASE has landed; otherwise leave it and name it
  in `openItems`.
- **`cfg.frames`, `flush()`, the levers' persistence, `DevStats` and the scale HUD** are B-FOUNDATION's and stay;
  `DevStats` reads `report()` — make its fields real (A3 §8's counter list) rather than adding a second report.
- **Deletion list:** A3 §4.6's table is the list (the ladder, the prebake, the preview, the carry, the hold, the
  pending quantum, the settle machine, `fallbackCover`, sync as a mode, quantum identity in the queue, the live
  hold, the counters). What A3 §4.6 says stays, stays (the plate grid, LRU/pins/byte cap/`close()`, `dropFrames`,
  the visibility release, RW-1, the buffer pool, `snapshotJob`, `rasterPerf`; `TileStore.warmReads`).

## 5. Order of work, with checkpoints

Each checkpoint: a STATUS-LOG entry under 25 lines ending `WHERE I AM: <the next concrete edit>`; the orchestrator
snapshot-commits the tree at P0, P1, P3 and P5. If your context is past two thirds at P5, stop there with the entry
and the report; a successor does P6 from the tree and the log.

- **P0 — the plan's caps (PLAN §5.6 M1, M2).** In `PicturePyramid.js`/`PyramidStore.js`: the stand-in cap
  `COMPOSE_IMAGES − plane.images` with own plates counted apart, `_ownCount` deleted, rest mode's scaled ℓv plates as
  stand-ins; the one-view record cap deleted and `viewUnit` replaced by the pinned bound above; the floor and the
  phone ceiling. The reviewer's four constructed screens (`scratchpad/rv/bc/src/engine/raster/PicturePyramid.review.test.js`,
  read it first) move into `PicturePyramid.plan.test.js`; the three tests that pin the old caps are rewritten to the
  new rules; each rule a break-check. The six pyramid suites green before P1.
- **P1 — wired under the flag.** §2's constructor, `pack`, `measure`, `_takeResult`, the frame step, the prefetch
  at idle, `setSize`, the engine's extra frame, `onCommit`, `setLevers` → the store's budget. `?pyramid=1` draws
  the app through the pyramid; `?pyramid=0` is unchanged. The levers take effect live (A3 §8: a step change drops
  the level records and bumps the view's and the prefetch's generations; a budget change is one eviction pass).
- **P2 — the pen-up rule and the partial path.** The held live path → `groupCommit`; a bake, an undo, a redo, a
  cut step reach the pyramid as Stage dirt at the new G and run `patchPlan`/`applyPatchPlan` in the frame step
  (inline within budget, else coarse-first); `_renderPending` gone (§3.2).
- **P3 — the MovePlane port** (§2, §4): identity, pins, the plane in the plan's paint order, the landing per cell
  by `exact`, D1, H4, Q8.
- **P4 — the queue adopted** in `rasterWorkerClient` (drops by G and purpose generation; the deletions of §2), the
  camera's budgeted read (§3.1), `job.ids` off the wire (§3.3).
- **P5 — the harness both ways.** `browser-check.js --dense --scenario all` with `--query pyramid=0` and
  `pyramid=1`, back to back, twice each, the load average printed (§3.4), on the synthetic drawing; scenarios 1
  and 2 also at `levelStep=2` and `3` under `pyramid=1`. The table in your entry: paperMs / blurMs / olderMs, the
  frame histogram, long frames, compose ms and max images, plates/bytes/pinned, jobs by priority, per scenario and
  path. Dev servers: Node 14 (`source /opt/nvm/nvm.sh && nvm use 14 && BROWSER=none CI=true PORT=<port> npm start`),
  ports 3010–3019 are yours (the reviewers use 3021–3022); `npm run build:worker` first when a bundle input changed.
- **P6 — delete and port.** A3 §4.6's table; TEST-MAP's rows for `raster.nopaper`, `raster.picture` (port F101,
  F106), `raster.plates` (port L2, L3, L7, L8), `raster.worker` (drops by G, the priorities), `raster.move`,
  `raster.translucent`, `raster.phone` (the cap; P3/P4 replaced by the pen-up rectangle test), `raster.perf` (the
  sync/settle bucket rows), `raster.snapshot` (budgeted through the pyramid), `raster.engine` (the list is the
  scene; the budgets stay), `raster.overlay`/`raster.ants` (G3: a level change repaints), `raster.liveHold` (held
  until its rectangle is fresh — the pen-up rule; the `LiveStrokeLayer` name waits for B-PYRAMID-3),
  `useKobinEngine.raster.test.js`; the `cfg.pyramid` gate and the Dev panel's toggle; the counters; then the docs:
  DESIGN §7/§9/§10/§15, `docs/ai/10-`/`20-`/`30-`/`40-`, PLAN §1.2, TEST-MAP's fates to "done", A3's dated notes,
  `docs/OPEN-FLAGS.md` (grep each flag a deletion closes — F79, F106, F119, F120, F121, H1, H4, D1, D-3, D272 are
  candidates; close only what you measured closed, with the number). The quick suite, typecheck, lint, the bundles.

## 6. Acceptance — measured, never "works" (preamble rule 5)

- **Tests you add** (each a break-check on an unimported copy, rule 13): the compose never shows an older picture
  (`olderMs` stays 0 through a jsdom fuzz of draw / undo / redo / erase step / zoom / crossing with the fake pool);
  the pen-up rule (no frame shows both the path and the plates, or neither — a jsdom test on the call order; the
  pen-up rectangle re-render equals a whole render); the plane's identity, its pins ≤ the cap, the landing by
  `exact`; drops by G and by purpose generation; the phone's plane cap; the levers' live effect; the budget floor.
- **The harness, headless, load printed, both paths on one tree** — say every number, with the load: scenario 1's
  paper under `pyramid=1` against `pyramid=0` on the same tree (B-FOUNDATION's baseline of the old renderer was
  3,247 ms at 4e8ce80; the Stage path measured 9,784 ms in B-SCENE-2's pair — the reviewer's cause, §3.5);
  `olderMs` 0 in every scenario; scenario 4's max images ≤ 30 or the surface used (was 33); scenario 5's time to
  exact (was 425 ms) and that the path is released in the same task as the plates; scenario 6's time to exact
  (was 97 ms) and the plates byte-equal to a whole render; scenario 7's bake time (was 31.0 s on the Stage path,
  19.4 s on the list path — the partial re-render is the fix, PLAN §5.4 Q1); the round trip pixel-identical
  (23,444 ink px drawn, 25,244 after); the long-frame histogram no worse than the old path's on the same tree.
- **Suites:** the quick suite green but for failures you name with their cause; typecheck 0; lint 0 errors; the
  worker bundles rebuilt with their md5s in the entry.
- Nothing measured in Kobin's Chrome: say so. Headless draws with software GL (A3 §9.4).

## 7. Files

**Yours:** `src/engine/raster/RasterRenderer.js`, `PictureLayer.js` (deleted at P6), `PlateStore.js` (reduced or
deleted at P6), `MovePlane.js`, `rasterWorkerClient.js`, `plate.js`, `rasterPerf.js`, the raster suites per §5 P6,
`src/engine/raster/PicturePyramid.js`, `PyramidStore.js`, `jobQueue.js`, `prefetch.js` and their suites **once the
B-PYRAMID-1 review has ended** (the orchestrator says; until then read-only — name what you need changed in your
entry), `src/hooks/useKobinEngine.js` (the raster gate and the levers only), `src/Components/editor/DevStats.js`,
`src/Pages/CanvasEditor.js` (the Dev panel's toggle only), `tools/harnesses/browser-check.js` and
`synth-drawing.js`, `src/engine/sceneOps.js` (`snapshotView` through the pyramid), `src/engine/KobinEngine.js`
(the renderer-facing parts only: the frame step, `onCommit`, `setLevers`, the extra frame, the pen-up call) — a
shared file with B-ERASE: re-read before every edit and keep each edit small (rule 17).

**Not yours:** `Stage.js`, `TileStore.js`, `placementModel.js`, `Document.js`, `LevelMap.js`, everything `erase*`
and `eraseWorkerClient.js` (B-ERASE), `rasterPack.js`'s mark block, `rasterCore.js`'s mask functions, `rasterJob.js`'s
`MASKS_MAX` (B-ERASE), `Renderer.js` (B-PYRAMID-3), `format2`, `persist`, `oplog`, `selection.js`.

## 8. Report (preamble rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun` with counts, `measurements` (the §6 table), `decisions` with why,
`leastSure` (at least three), `questions` each with your recommendation, `openItems` (every line another build
needs: B-PYRAMID-3's, B-ERASE's cuts in the pool, anything left for the successor).
