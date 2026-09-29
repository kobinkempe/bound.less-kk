# R-PYRAMID — the review of B-PYRAMID-2 and 2b, P0–P6 (2026-09-29, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19). **Scratch:**
`<scratchpad>/r-pyr/`; the builders' are `<scratchpad>/bp2/` (P5's harness outputs under `bp2/p5/`) and `<scratchpad>/bp2b/`
(P6's under `bp2b/`, its break-check copy `bp2b/bc`). Fix minors inline; majors: this brief gives you leave to build the
three fixes of §1 items 1, 2 and 4, each with a red-before test, because they are the invariant's fixes and bounded;
any other major is reported with a proposed fix and its evidence.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §9 (as P6 rewrote it) and §7's queue paragraph;
`review/rebuild/PLAN.md` §0 (decisions 1, 2, 4, 5), §1.2, §1.4–§1.6, §3 rows 1, 8, 10, §5.5–§5.6, §5.8 item 8,
§5.11, §5.13; `review/rebuild/briefs/B-PYRAMID-2.md` and `B-PYRAMID-2b.md` (the builds' briefs); `review/rebuild/A3-pyramid.md`
§1.4–§1.5, §2, §3.3–§3.6, §4.2–§4.5, §6 and every dated note; in `review/rebuild/STATUS-LOG.md` the entries of
B-PYRAMID-2 (P0–P5, the 05:27 table) and B-PYRAMID-2b (items 1–6, the 12:08 table) — grep `— B-PYRAMID-2`; then the
code: `src/engine/raster/PicturePyramid.js` (the plan `_planCell`/`_planCells`/`_planRest`, the integrals `_charge`,
the rest `_onStill`/`_postRest`, the patch `patchPlan`/`applyPatchPlan`, the group commit), `PyramidStore.js` (the ranks,
`_evict`, `dropWhere`), `jobQueue.js`, `prefetch.js`, `RasterRenderer.js`'s `_pyr*` section and `_frameStep`,
`rasterWorkerClient.js`, `MovePlane.js`, `KobinEngine.js`'s `_frame`/`_readIdle`/`_syncStep`, the suites
`raster.pyramid`, `PicturePyramid.*`, `PyramidStore.*`, `jobQueue`, `prefetch`, `raster.move`, `raster.worker`.

## 1. Items, in order

1. **Never older (decision 2), the rest set as a stand-in.** After a zoom from rest the fresh rest set is discarded
   and the stale level plates under it show (P6: 88–91 fuzz plans, 98–104 ms; scenario 7's `olderOtherMs` 853–869 ms).
   Build: rest records stay after a zoom as a stand-in source at their own Z in the plan's lookup order (fresh at
   Z_rest beats a stale level plate under the freshness-first rules; drawn scaled like a mapped or coarser source;
   counted against the stand-in cap; protected in the store while any cell still draws them; no longer drawn once the
   level's own plates are fresh; A3 §2.4's discard becomes that). Then assert `olderOtherMs` = 0 in the never-older
   fuzz and find the cause of the five plans that remain with no rest set (P6's report). Measure scenario 7's split
   after the change. Red-before tests; break-checks.
2. **The pack budget at rest.** Packs on the main thread while the camera is still reach 171–480 ms per strip (P6's
   undo trace). Build a per-task pack budget at rest as the 4 ms per frame while moving (`PACK_MS_PER_FRAME`): a strip
   whose pack exceeds it continues in the next task, the queue's `frame()` reset per task; measure the longest task on
   scenario 6 before and after, and that nothing else regresses (scenario 1's long frames).
3. **The zoom-out's paper regression.** P5's tree (22f4c8e) 0–4.6 ms, P6's (15b3738 and after) 37–150 ms, scenario
   1, same day. Bisect between the two on a quiet machine (`git archive` of each candidate, Node 14 server, three runs
   each, the load printed; the harness's `--dense --scenario 1 --query ''`) to the commit, then the change; fix it if
   it is a defect (a lost prefetch, the read window, the quiet's timing, the attention point), or name what it costs
   if it is a decision (say which item 3 rule bought it and what it buys).
4. **The undo inline.** A3 §3.3's inline threshold cannot see a small patch in a dense scene: the estimate's E is
   capped at 20,001 chords (the whole cell's, not the patch's) so T reads 34–41 ms against 6. Re-derive E, A and P
   clipped to the patch's rectangles (`measure(job)` with the clips), and raise the inline budget for a user-initiated
   patch (undo, redo, pen-up's group) to one frame, 16 ms — a single action, not a per-frame cost — keeping 6 ms for
   patches the bake issues. Measure scenario 6's key-to-exact (P6: 215–554 ms) and the plates byte-equal to a whole
   render (the existing test).
5. **PLAN §3 row 1 at the renderer level**: a stored plate's G monotone and exact iff `G ≥ dirtySince` holds through
   `RasterRenderer`'s results path (`_takeResult` → `onResult` → the store), including a refused job's late result,
   a plane's late plate, a snapshot's strip, and a re-aim; a fuzz over the fake pool with drops by G and by purpose
   generation (extend `raster.pyramid`'s). Row 8/10: a partial re-render through the clip box equals a whole render
   (P0–P2's tests exist: re-run, and add the cut-step case with B-ERASE's byte masks in the job).
6. **The pen-up rule** (PLAN §1.5): never both, never neither; the path released in the task that shows its plates; a
   group older than `LIVE_HOLD_MS` commits what it has; a change of the drawn set re-targets the group; the pending
   stroke hit-testable and packs skipping it. P2's tests exist: re-read them against the rule and add what is missing.
7. **The plane** (A3 §6, decision 4): identity at the view's grid Z, D1's grown SEL runs (with the read window grown
   under a plane), H4 never-both, the landing per cell by `exact`, pins ≤ the cap, the phone's cap; Q8's image count
   (scenario 4: 33 images through the surface — verify the surface path is taken and the direct path never exceeds
   30). P3's break-checks exist (13 of 14 red): re-run three on the current tree.
8. **The queue** (PLAN §1.6, A3 §4.4): priorities, the cut reservation `max(1, workers − 1)`, admission per frame,
   dealing, the velocity rule and the re-aim, generations, dedupe, the microtask pump for requests outside a camera
   step, rows of kind `settle`; the watchdog refusal and the single requeue (item 1 of P6). P6's small items: a
   released orphan worker slot pumps no queue; an aborted snapshot's strip stays queued until dispatch; the prefetch's
   tile reads inside a camera step unbucketed (a 319 ms camera row); `rasterPack`'s dead `q` memo key. Fix as minors.
9. **The budget** (A3 §4.5, PLAN §5.6 M2): pinned ≤ own-grid records + 30 stand-ins + the plane cap; the floor; the
   phone's ceiling; the hidden-tab release keeping ℓv − 2; the levers' live effect (a step change drops the level
   records and bumps the generations; a budget change is one eviction pass). Tests exist: check each against the rule
   and break one on a copy.
10. **The deletion.** Grep `src/` for every name in B-PYRAMID-2b's brief §1 (the ladder, the prebake, the preview, the
    carry, the hold, the pending quantum, the settle machine, `fallbackCover`, sync as a mode, the live hold, quantum
    identity, `_renderPending`, `cfg.pyramid`, the interim erase pool): no caller, no reader, no comment naming it as
    live — `TileStore.js:222` (`_maybePrebake`) is the C1 reviewer's, already sent to it; anything else is yours.
11. **Docs**: DESIGN §9 true to the code as you leave it (the rest-set stand-in, the pack budget at rest, the undo's
    budget); A3's dated notes; OPEN-FLAGS' pyramid notes (F79 waits for the harness's compose numbers — give them;
    F101, F106, F119–F122 closed with numbers; H1, H4, D1, D-3, D272: close what you measured); `docs/ai/40-` for the
    queue's cut kind. The harness (`tools/harnesses/browser-check.js`) is yours for the review's needs.

## 2. Measurement, once, at the end

On a frozen tree (`git archive`), the machine quiet (the C1 reviewer's servers stopped — its end entry in the
STATUS-LOG says so; until then do the jsdom and code items and the bisect's archives), `--dense --scenario all` twice
and scenarios 1–2 at `levelStep=2|3`, the load printed: the table beside P5's reference pair and P6's runs, with
`olderOtherMs` 0 everywhere, the zoom-out's paper back at P5's, scenario 6's key-to-exact, and the longest task on
scenarios 1 and 6. The quick suite, typecheck, lint, the bundles' md5s. Nothing in Kobin's Chrome: say so.

## 3. Files

Yours: everything in B-PYRAMID-2's brief §7 and B-PYRAMID-2b's §4 (the raster modules, `RasterRenderer.js`,
`MovePlane.js`, `rasterWorkerClient.js`, `eraseWorkerClient.js`, `erasePipeline.js`'s dispatch, `sceneOps.js`, the hook's
raster parts, `DevStats.js`, the harness, the raster suites, DESIGN §7/§9/§15, `docs/ai/`, A3, OPEN-FLAGS' renderer
flags). **The B-MODEL-C1 reviewer is running** in the model files (`Document.js`, `LevelMap.js`, `TileStore.js`,
`placementModel.js`, `geometry/offsets.js`, `oplog`/`persist`/`format2`/`files`, `selection.js`'s box, `legacy/`, the model
suites, DESIGN §8/§13, A1) — not yours; `KobinEngine.js`, `Stage.js` and `erasePipeline.js` are shared: re-read before
every edit, small edits. Ports 3010–3019 are yours (Node 14 via nvm); the C1 reviewer uses 3030–3039. The worker
bundles need `npm run build:worker` after a change to `rasterCore`/`rasterPack`/`rasterJob`/`worker/`/`geometry/`.
Every commit is the orchestrator's with `[skip ci]`; you commit nothing.

## 4. Report (rule 11, under 60 lines)

`status`; `findings` (majors first — built or proposed — with scenario, evidence and the fix; minors fixed with their
tests); `filesChanged`; `testsRun`; `measurements` (§2's table, the bisect's result, the undo's time, the longest
task); `leastSure` (≥ 3); `questions` with recommendations; `openItems` (B-PYRAMID-3's, wave 3's).
