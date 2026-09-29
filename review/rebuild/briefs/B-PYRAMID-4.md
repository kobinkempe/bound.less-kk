# B-PYRAMID-4 — the brief (2026-09-29, orchestrator): the pyramid's last four rules

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19).
**Scratch:** `<scratchpad>/bp4/`; the B-PYRAMID review's is `<scratchpad>/r-pyr/` (its harness batches, `bc` copy),
B-PYRAMID-3's `<scratchpad>/bp3/`.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §9 (as the review and B-PYRAMID-3 left it);
`review/rebuild/PLAN.md` §0 (decision 2), §1.2, §1.5, §5.11 item 3, §5.15, §5.17 (B-PYRAMID-3's answers, when written);
`review/rebuild/A3-pyramid.md` §1.4 (f′), §3.3–§3.6, §4.4 and their dated notes; `docs/OPEN-FLAGS.md` F134 and F135
(whole entries); in `review/rebuild/STATUS-LOG.md` the B-PYRAMID review's entries (its 19:59 end and the 16:45 table)
and B-PYRAMID-3's; then the code: `PicturePyramid.js` (`_charge`, `patchPlan`/`applyPatchPlan`, `_patchStep`, the group
commit, `_standIn`), `RasterRenderer.js` (`_pyrLive`, the commit hook, `_pyrUnask`, `_frameStep`), `jobQueue.js` (`_aim`,
`_admit`), `rasterPack.js` (`prepassFor`, the memo), the estimate (`measure`/`estimate`), the never-older fuzz in
`raster.pyramid.test.js`, the harness's older-by-cause columns.

## 1. The four rules (PLAN §5.15; F134, F135)

1. **The patch step runs in the commit's task.** A commit stales own plates at once, but `_patchStep` runs only at the
   next render, which the bake schedules up to 100 ms later: scenario 7's `olderOtherMs` 1.3–1.4 s is stale own plates
   with no patch asked (the review's cause split: 125–156 cell-draws a run). Run the patch step from the commit hook
   (beside `_pyrLive`), within the commit task's budget (`patchInlineMs`/`patchUserMs`); a red-before test (a commit,
   then a compose in the same task: the patch asked or applied; `olderOtherMs` 0 for that cell), a break-check, and
   scenario 7's `olderOtherMs` before and after (the review's 1,404 | 1,276 ms), the bake time unchanged within noise.
2. **The pack priced, its prepass kept across commits.** The inline render's pack costs 89 ms on the dense scene
   because the prepass (`prepassFor`'s family fills) is rebuilt for each commit's new list; no estimate term prices it.
   Keep the prepass across commits keyed by the items' identity and the geometry memo (an item unchanged since the last
   prepass reuses its entry; a changed item rebuilds only its own), and add the pack's cost to the inline estimate
   (a term calibrated online like the others). Measure: the inline render's pack ms on scenario 6 before and after,
   the undo's key-to-exact (the review: 203–348 ms), whether the undo's patch is now inline (T against 16 ms) and the
   plates byte-equal to a whole render (the existing test); a red-before test that a second commit's pack reuses the
   entries; a break-check.
3. **F134, the re-aim's floor.** `jobQueue._aim` re-aims a view strip at `levelFor(k·2^(v·eta))` with no floor; in
   jsdom a fast zoom-out sent strips to levels −14…−21 while the view was at −4/−5, and one such plate took 5–102 s
   and up to 8 GB inline (the "stuck" jest workers). Clamp the re-aimed level to the frame's `ownFloor` and to a bounded
   distance from the view's level (A3 §4.4's velocity rule was for one or two levels ahead, never past the frame's
   coarsest picture); a red-before test with the flag's timings; a break-check; the flag closed with the number.
4. **F135, a pen-up group's dropped strips.** `_admit` drops a group strip's cells that are in flight for another job
   and calls the strip "exact"; nothing re-asks or resolves the group's cells, so the group waits `LIVE_HOLD_MS` (3 s)
   and the second of two strokes drawn back to back keeps its live path 3,070 ms. Rule: a group's cell in flight for a
   job packed at a G below the group's is re-asked (or the group is re-targeted at that job's landing when its G is
   at or past the group's); a red-before test (two strokes back to back: the second path released when its plates
   land, well under the hold); a break-check; the flag closed with the number.
5. **The (f′) integral.** The last resort after a crossing (a stale coarser stand-in for a cell whose tiles the step
   left unread) is charged to `olderOtherMs`; split it into `olderUnreadMs` (the fuzz's `unread` cause) in the
   integrals, `report()`, `DevStats` and the harness, assert `olderOtherMs` 0 in the never-older fuzz and in every
   harness scenario, and say in your report what a budgeted read of those cells' tiles at the crossing's step would
   cost (a measurement on scenario 1: the unread cells' count and their bake times) — the decision is the
   orchestrator's from your number, not built here.

**Done means** (rule 14): the five rules in, each with its red-before test and break-check; F134 and F135 closed in
OPEN-FLAGS with the measured numbers; `olderOtherMs` 0 in every harness scenario on a quiet machine; the docs true
(DESIGN §9, A3's dated notes, `docs/ai/40-`); the quick suite green but for named failures; typecheck 0; lint 0 errors;
the worker bundles rebuilt if a bundle input changed (the pack's memo is `rasterPack.js`: yes), md5s in the entry.

## 2. Measurement

A frozen copy (`git archive`) before and after, the machine quiet (check `uptime`; B-DRAG and its reviewer may run
suites — print the load), `--dense --scenario all` twice each: the older columns by cause, scenario 6's key-to-exact and
longest task, scenario 7's bake and older split, scenario 5's release, the drag's older; plus the two flags' jsdom
timings before and after. Nothing in Kobin's Chrome: say so.

## 3. Files

Yours: `src/engine/raster/{PicturePyramid,RasterRenderer,jobQueue,rasterPack,PyramidStore,prefetch}.js`, the raster
suites, `tools/harnesses/browser-check.js`, `DevStats.js`'s pyramid fields, DESIGN §9, A3, `docs/ai/40-`, OPEN-FLAGS'
F134/F135. **B-DRAG (a builder) and then its reviewer are in** `KobinEngine.js`, `selection.js`, `Document.js`,
`LevelMap.js`, `Stage.js`, `placementModel.js`, `overlays.js`, the move/select suites: none of those are yours;
`KobinEngine.js` is shared only if a rule above needs a line there (the commit hook is the renderer's): re-read before
the edit, keep it to one line, rule 17. Ports 3010–3019 (Node 14 via nvm). Every commit is the orchestrator's with
`[skip ci]`.

## 4. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements` (§2), `decisions`, `leastSure` (≥ 3), `questions` with
recommendations (the budgeted read at the crossing, from your number), `openItems` (the reviewer's, wave 3's).
