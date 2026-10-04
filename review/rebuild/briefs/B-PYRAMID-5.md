# B-PYRAMID-5 — the renderer's recorded next steps (2026-10-04, orchestrator)

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19).
**Scratch:** `<scratchpad>/bp5/`. Small and bounded, per Kobin: hand back within about 2 hours of your start.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §9; PLAN §5.20 and §5.22 (whole: these items come from it);
OPEN-FLAGS F137 (whole, with R-PYRAMID-34's bisect table); A3 §3.3–§3.4 and §4.4 with their dated notes; the R-PYRAMID-34
reviewer's end entry in the STATUS-LOG (grep `— R-PYRAMID-34 (reviewer) — end`) and the orchestrator's 2026-10-04 entries;
then the code: `PicturePyramid.js` (`patchPlan`, `_coarseJob`, `USER_COARSE_FRAMES`, `unask`, `_older`), `RasterRenderer.js`
(`_pyrCommitStep`, `_pyrUnask`, `_pyrPack`, `_pyrMeasure`), `jobQueue.js` (`_aim`), and the tests named below.

## 1. Items, in order (each with a red-before test and a break-check, rule 13)

1. **Exact over coarse when both fit.** For a user's action (undo, redo, a drop) the full-resolution patch is taken
   inline when its priced T is within the user's budget, 3 × `patchUserMs` = 48 ms, and coarse-first only when it is not
   (R-PYRAMID-34's question; the orchestrator's answer in PLAN §5.22 item 2: yes). Measure scenario 6: T, the first change
   on screen, key-to-exact, against R-PYRAMID-34's 74.1 | 41.0 | 194 | 432 ms.
2. **The `unask` G check.** `PicturePyramid.unask` deletes an ask without looking at its G, so an older dropped strip can
   erase a newer patch's ask; delete only when the entry's G is no newer than the dropped job's ask. Measure scenario 7's
   residual `olderOther` (R-PYRAMID-34: 62.5 ms, 28 composes of covered stale own plates never asked) before and after.
3. **The hidden tab's commit step.** `_pyrCommitStep` runs the patch step while the tab is hidden (on desktop before the
   hidden release): return while `document.visibilityState` is hidden and let the next compose run it.
4. **Two load-sensitive tests made deterministic**: `raster.move` RV4 (the drop's patch inline or to the pool by the
   calibrated estimate: set `patchUserMs` as its siblings do, then three runs under three busy loops green) and
   `stage.cover` C4 (two 5-s wall-clock waits over the idle table read: stub the read's clock as LH-1 stubbed its timer).
5. **F137, real or not.** Before any more bisecting: on a quiet machine (load under 2, printed), `--dense --scenario 1`
   three times on the landed tree (59f0a76 or later, `git archive`) and three times on B-PYRAMID-4's before copy `bA`
   (`<scratchpad>/bp4/batch3.sh` says how it was made). The orchestrator's single run on the landed tree showed the
   back-in paper at 0 ms where a copy with the same raster code before C3/C4 showed 264. If the landed tree shows paper in
   no run, close F137 as not reproduced, with the six numbers. If it does, bisect `RasterRenderer.js`'s half (R-PYRAMID-34's
   next step: `bC` with `bA`'s `RasterRenderer.js` less the commit hook), fix the rule it names if bounded, else report.
6. **The overlay's tail after a drop**, measure and propose only: on the dense scene a 45-object drop's render is 2.2 s,
   1.16 s of it `ovl.tail` (R-PYRAMID-34). Profile it once (headless Chromium), name the cost and propose a bounded fix
   (for example re-deciding only the moved pieces). `overlays.js` is not yours to change in this build.

## 2. Measurement, once, at the end

The raster suites, the quick suite, typecheck 0, lint 0 errors, `npm run build:worker` if a bundle input changed (md5s).
Headless Chromium, the landed tree against yours (`git archive` copies, ports 3010–3019, the load printed): scenarios 1,
6 and 7 once each. Nothing in Kobin's Chrome: say so.

## 3. Files

Yours: `src/engine/raster/{PicturePyramid,RasterRenderer,jobQueue,rasterPack,PyramidStore,prefetch,MovePlane,rasterWorkerClient}.js`,
the raster suites, `src/engine/stage.cover.test.js` (the test only), `tools/harnesses/browser-check.js`, `DevStats.js`'s
pyramid fields, DESIGN §9, A3, OPEN-FLAGS F137 and the renderer flags, TEST-MAP's raster rows. **R-MODEL-C34 (a reviewer)
runs beside you** in the model files (`LevelMap`, `Document`, `oplog`, `TileStore`, `selection`, `eraseDescent`, the model
suites, `modelFuzz`): none of those are yours. `KobinEngine.js` is shared: re-read before every edit, small edits
(rule 17); `Stage.js` read only. The STATUS-LOG is the coordination: announce a browser batch before you start one;
start it only under load 2. Every commit is the orchestrator's with `[skip ci]`; you commit nothing.

## 4. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements`, `decisions`, `leastSure` (≥ 3), `questions` with
recommendations (item 6's proposal), `openItems`.
