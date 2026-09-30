# R-PYRAMID-34 — the review of B-PYRAMID-3 and B-PYRAMID-4 (2026-09-29, orchestrator; launched when B-PYRAMID-4 reports)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19). **Scratch:**
`<scratchpad>/r-pyr34/`; the builders' are `<scratchpad>/bp3/` (its round-trip script `svgtrip.js`, `maskcheck.js`,
`svgdrag.js`, `svgalloc.js`) and `<scratchpad>/bp4/` (its red-before copy `rb`, its harness batches); the B-PYRAMID
review's is `<scratchpad>/r-pyr/`. Fix minors inline in the files of §3; report majors with a proposed fix and its
evidence; a major with a bounded fix and a red-before test may be applied when the orchestrator says so (ask in your
checkpoint entry, keep working meanwhile). Leave given at launch: (filled from B-PYRAMID-4's report — none yet).

**The B-PYRAMID review verified P0–P6 on c7fed1a** (its 19:59 entry in the STATUS-LOG; `briefs/R-PYRAMID.md` items
5–10). Do not repeat those items; re-check only what B-PYRAMID-3 and 4 touched (`git diff --stat c7fed1a -- src/engine/`
tells you which files) and what §1 below names.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §9 (as the two builds left it), §7's pending-mark paragraph,
§15; `review/rebuild/PLAN.md` §0 (decisions 2 and 6), §1.5, §1.6, §3 rows 1, 2, 8, 10, §5.8 item 2, §5.14 items 1 and 3,
§5.15, §5.17, §5.19 (B-PYRAMID-4's answers, when written); `review/rebuild/briefs/B-PYRAMID-3.md` and `B-PYRAMID-4.md`
(the builds' briefs); `review/rebuild/A3-pyramid.md` §1.4 (f′), §3.3–§3.6, §4.4, §7 whole and every dated note;
`docs/OPEN-FLAGS.md` F133, F134, F135 (whole entries); in `review/rebuild/STATUS-LOG.md` the entries of B-PYRAMID-3
(grep `— B-PYRAMID-3`; the 15:27, 15:54 ×2, 20:10, 20:59, 21:20 checkpoints carry the measurements) and B-PYRAMID-4
(grep `— B-PYRAMID-4`), and the B-PYRAMID review's 19:59 end entry (the reference table); then the code:
`src/engine/Renderer.js` (`render`, the hidden-group rule and `needsFadeFlip`, `_setMask`/`_dropMask`/`_applyMasks`/
`_markDef`/`_maskBox`), `raster/SvgLayer.js`, `raster/LiveStrokeLayer.js` (`begin`/`arcs`/`hold`/`release`/`cross`/
`cancel`), `raster/svgOverlay.js`, `raster/svgAnchors.js`, `raster/RasterRenderer.js` (the constructor's `_layers`,
`endLive`/`addLive`, `_pyrLive`, `_pyrCommitStep`, `_liveCross`, `_frameStep`, `_pyrUnask`, `setSize`/`destroy`),
`raster/PicturePyramid.js` (`noteCommit`/`patchIfDue`/`_patchStep`, `_lastResort`, `_charge`, the group commit and
`onResult`, `moveGroup`, `_standIn`), `raster/jobQueue.js` (`_aim`, `AIM_LEVELS`, `_admit`), `raster/rasterPack.js`
(`prepassFor`, its memo, the pack term of the estimate), `raster/prefetch.js` (the warm reads), `storage/thumbnails.js`
(`withSvgEngine`), the hook's gate and export (`src/hooks/useKobinEngine.js`); the suites `Renderer.eraseMask`,
`Renderer.retention`, `Renderer.*`, `raster/LiveStrokeLayer.test`, `raster/LiveStrokeLayer.hold.test` (LH-1..7),
`prefetch.warm`, `raster.commit`, `jobQueue.test`, `raster.pyramid` (the never-older and row-1 fuzzes), `PicturePyramid.*`,
`raster.translucent`, `raster.move`, `storage/thumbnails.test`; the harness `tools/harnesses/browser-check.js` (the
older-by-cause columns, `olderUnreadMs` included).

## 1. Items, in order

B-PYRAMID-3's (the SVG renderer's demotion, decision 6):

1. **One list source, two renderers** (PLAN §3 row 2). Both renderers draw `stage.items()` at the Stage's generation;
   `listFor`, `_buildList`, `TileStore.content`/`contentOffCamera`/`_reroute` are gone (grep `src/` for a reader or a
   comment naming one as live; `Stage.js:97` is R-DRAG's); the brute-force list lives only in `__oracles__/renderList.js`
   and nothing in production imports `__oracles__` (grep outside the suites). The hook's gate keeps its meaning (raster
   by default, `?svg`/`?raster=0` the SVG renderer, `setRaster` rewriting the URL; thumbnails and the export `raster:
   false`). The `?svg` round trip (`bp3/svgtrip.js`: 3 strokes, a translucent live stroke, out and back, a lasso, its
   ants, a drag, an erase, its bake) re-run on two frozen pairs: c7fed1a against b793360 (B-PYRAMID-3's claim, 0 px in
   9 of 9 states) and b793360 against the final tree (B-PYRAMID-4's and B-DRAG's effect on the SVG path: expected 0 px
   but for the drag's mid-drag state, which B-DRAG changed — say which states differ and why).
2. **`RasterRenderer` extends nothing; one implementation per overlay** (rule 3). One `_layers` list of four
   (`PicturePyramid`, `SvgLayer`, `OverlayLayer`, the bl-sel-edges slot) walked by `setSize`, `destroy` and the store's
   release; the lasso, the chevrons, the ants' style and the tile/erase debug each implemented once (`svgOverlay.js`) —
   grep for a second copy; `ensureOutline` in the engine; the fat gate SVG-only; the raster seams gone from `Renderer`
   (`_ovOrigin`, `setDragState`, `setPlaneState`, `endMove`). Break one on a copy: a layer left out of the list
   (`setSize` misses it; `destroy` leaks its `<svg>`) — FC1's tests exist: verify they go red.
3. **The pen-up rule under the new layer** (PLAN §1.5; A3 §3.6, §7.2): never both, never neither. `hold()` at pen-up,
   `release(id)` from the group commit's callback in the task that shows the plates; one writer; the layer's group in
   `world` only while it holds a path; the origin re-chosen at the view centre; a held path carried across a crossing
   (`_liveCross` → `cross(map, origin)`: the root scaled by R^Δdepth, its box mapped, `PicturePyramid.moveGroup` before
   the retarget reads the rectangle; `_pyrLive` asks the document, not the table, whether a stroke is gone). B-PYRAMID-3's
   break-checks (release a task later 3 red, carry removed 2, re-anchor removed 2, table-as-truth 2, a per-frame origin 1,
   the layer adopting every origin 1): re-run three on a copy of the final tree. With F135's merge (item 10) the rule
   must hold for each path of two merged groups: a state log at every compose (paths in `world`, the plates' G under
   each) — never a frame with a path and its fresh plates both shown, never neither; PLAN §5.17 item 4's doubling
   (53,919 px at the "drawn" shot, 3 of 4 runs) re-measured on the final tree and closed or explained.
4. **The SVG mask rule and the export barrier** (PLAN §5.8 item 2; `eraseRule.underMask`). A landed pending mark is
   drawn as nothing; a group with a member under it gets an SVG `<mask>` (white over the group's drawn box, the mark's
   shape black through a `<use>` of one `<defs>` copy per mark, scaled S/S_m), set after Two.js renders; an unlanded mark
   stays ink until it lands; the mask and its `<defs>` entry dropped when the mark bakes or is undone (count the defs in
   jsdom: N marks → N entries → 0 after the bake; a leak is a minor to fix); the same rule as the raster path's byte mask
   (B-PYRAMID-3: 215–362 of 72,000 px differ at the edge, the same count after the bake — re-check once on the final
   tree with `bp3/maskcheck.js`). Thumbnails and the export run `flushErases` first in both modes (`withSvgEngine`) and
   the tab's document is untouched by an export. M-1..3 and X-1 exist, four break-checks exist: re-run two. Add the
   drag case B-DRAG changed: a masked target dragged under the mark mid-drag (drawn at +δ through `Item.res`) stays
   masked and a non-target dragged under it stays visible; the mask's box follows the dragged group.
5. **F133's fix and the SVG path's memory.** A group at opacity 0 is not rebuilt (its signature stale) and
   `needsFadeFlip` promotes the zoom that would show it: a hidden group later shown is rebuilt before it is visible
   (`Renderer.retention` exists — check it covers the show-again case; break-check the promotion removed: the stale
   generation shows). Re-measure once on the final tree with the C1 reviewer's script (`scratchpad/r-model/svgdrag.js`,
   `bp3/svgdrag.js`; forced GC each step): a tenth of the natives flat within B-PYRAMID-3's 265 MB after 40 events; the
   whole drawing 12 events; the load printed.
6. **The warm reads** (PLAN §5.14 items 1 and 5). Every prefetch read warm, the camera's not; `_dropTile` forgets a warm
   key; the plan-time clearing gone; W-1..3 exist. The warm set's bound: its size after scenario 1 out and back (a
   number) and what bounds it (a key cannot outlive its tile: W-3 — say whether the set can grow with every tile ever
   read while the tiles stay). The back-in re-bake count (B-PYRAMID-3: 8 against 19–22 warm off) re-measured once.

B-PYRAMID-4's (the pyramid's last rules; PLAN §5.15; F134, F135):

7. **The patch step in the commit's task** (rule 1). `noteCommit` marks it due; the next compose or `frameFor` in the
   task runs it, else the renderer's microtask (`_pyrCommitStep`); an undo's `noteUserEdit` budget still applies (the
   order on the undo path: the budget set before the step runs — check, and that the bake's own commits get
   `patchInlineMs`); a commit inside a camera step or a drag's drop runs within that task's perf row (`_openRow`/
   `_closeRow`: no row opened twice, none left open — `own` in `_pyrCommitStep`); a commit while the tab is hidden or the
   renderer destroyed runs nothing (the microtask after `destroy`). `raster.commit` exists (red-before 2), a break-check
   exists. Scenario 7's `olderOtherMs` (the review's reference 1,404 | 1,276 ms; B-PYRAMID-4's before under load
   1,577 | 1,797) re-measured quiet on the final tree, and the bake time unchanged within noise.
8. **The pack priced, the prepass kept across commits** (rule 2). The prepass entries keyed by the item's identity and
   the geometry memo: an unchanged item reuses, a changed item rebuilds only its own — and a *moved* item: B-DRAG's drag
   changes `Item.res` with no document write, and the drop writes the placement; if the key does not see the
   placement a held or dropped item packs from a stale entry (a test: hold, set the delta, pack → the item at +δ;
   drop → at its new home). The pack term of the estimate calibrated online like the others; the undo's T against 16 ms
   and whether the undo's patch is inline now; the plates byte-equal to a whole render with the memo warm (the existing
   test, plus a break-check: the memo handing back an entry after a geometry change → red). The memo's bound: entries
   after scenarios 1, 4 and 6 (a number), evicted with the item or held weakly — say which; the worker's copy of the
   memo (the workers pack too — per thread, bounded?). `rasterPack.js` is a bundle input: the md5s changed and
   `npm run build:worker` was run (the entry says so; check the bundles' dates against the source).
9. **F134, the re-aim's floor** (rule 3). `_aim` clamped at the frame's `ownFloor` and within `AIM_LEVELS` (2) of the
   view's level; the flag's jsdom timings before and after (the −19 plate 2.6–2.9 s and 1.5 GB RSS → none; the cost is
   `Stage.covers` → `_tileKeys` enumerating every tile key under a cell). Then every other caller of `levelFor` that can
   ask a plate far under the view (the plane's aim, a prefetch at a coarse level, the rest render's coarsest-source
   reserve, a level-step lever change): bound each or show it is bounded. The quick suite's longest file time on the
   final tree (a number; the review's 32-min spinning worker is gone or not). The flag closed with the number.
10. **F135, as built: the overlap merge** (rule 4). B-PYRAMID-4 found the mechanism is two pen-up groups over the same
    cells (`_groupOf` overwritten by the second, whose commit took the first's results), not the brief's dispatch drop.
    Check the rule as built: overlapping groups merge (both paths release at one commit); a result counts for a group
    when packed at or after its G, or exact at its landing; a need key's landing that does not count is re-asked inside
    the group; nothing overwrites a group silently. LH-7 on the reproducing setup (two strokes back to back: the second
    path released when its plates land, well under `LIVE_HOLD_MS`; the first never doubled over its plates). Then the
    brief's original case, which the builder's trace did not show: a cell in flight for a view job packed before the
    stroke, then the pen-up over it — the group resolves under the hold or the strip is re-asked (construct it in
    jsdom; if it cannot happen, show why from `_admit`). Break-check; the flag closed with the number.
11. **The (f′) integral** (rule 5). `olderUnreadMs` in the integrals, `report()`, `DevStats` and the harness;
    `olderOtherMs` 0 asserted in the never-older fuzz and 0 in every harness scenario. B-PYRAMID-4 charges a (f′) cell
    whose job is pending to `olderPatchMs`: judge that (a wait on a job the pyramid asked is a patch wait, or a hiding
    place for stale draws?) with the fuzz's split as evidence, and recommend. Its number for a budgeted read of the
    unread cells' tiles at the crossing's step (scenario 1: the cells' count and bake times): check it once and
    recommend — the decision is the orchestrator's.
12. **PLAN §3 row 1 through the new paths.** A stored plate's G monotone and exact iff `G ≥ dirtySince` through a merged
    group's results (`onResult` counting for a group), the commit-task patch step, a re-aimed strip's late result;
    extend the review's row-1 fuzz in `raster.pyramid` with overlapping pen-up groups and commits inside the task:
    0 G falls, exact draws all exact.
13. **The deletion.** Grep `src/` for `listFor`, `_buildList`, `contentOffCamera`, `_reroute`, `_ovOrigin`,
    `setDragState`/`setPlaneState`/`endMove` in `Renderer`, `liveChunk`, `warmReads`/`_warm`/`clearWarm`, the dead `live`
    argument of `MovePlane.aim`/`paintFamilies` (B-PYRAMID-4 deletes it): no caller, no reader, no comment naming one as
    live; TEST-MAP's rows say PORT/KEEP truly (`Renderer.liveChunk` → `LiveStrokeLayer`, `raster.liveHold` → `.hold`).
14. **Docs.** DESIGN §9 (the layers list, the SVG renderer's paragraph, the pen-up rule with the merge, the commit-task
    patch step, the pack's memo, the aim's floor), §7's pending-mark paragraph, §15; A3 §3.6/§4.4/§7's dated notes;
    `docs/ai/20-`, `30-`, `40-` (the four new modules named, the deleted ones gone; `tools/docmaps` is the orchestrator's
    final pass, not yours); OPEN-FLAGS F133 (the final tree's number), F134 and F135 closed with numbers, the F79/F120/
    F131 notes; TEST-MAP rows for `raster.commit`, LH-7, `jobQueue`'s F134 test, `Renderer.eraseMask`, `Renderer.retention`,
    `prefetch.warm`; the oracles' README (`renderList`).

## 2. Measurement, once, at the end

Frozen trees (`git archive`): c7fed1a, b793360 (B-PYRAMID-3 landed, B-DRAG's D1 partly in) and the final tree. The
machine quiet: **R-DRAG runs beside you**; the STATUS-LOG is the coordination — announce a browser batch's start and end
in an entry, start one only when the 1-min load is under 2 and no other agent's batch is announced and unfinished, and
print the load with every number. `--dense --scenario all` twice on b793360 and on the final tree, scenarios 1–2 at
`levelStep=2|3` on the final tree: the table beside the B-PYRAMID review's 19:59 table — paper, blur, older by cause
(`olderPatchMs`, `olderUnreadMs`, `olderOtherMs` = 0 everywhere), scenario 6's key-to-exact and longest task, scenario
7's bake and older split, scenario 5's release, scenario 4's drag older and **the drop's render** (R-DRAG's item 7 hands
you B-DRAG's 1.8–2.0 s render after a 45-object drop on the dense scene: attribute it — the pack, the inline patch, the
plane's landing — on the final tree with the pack memo in, and propose a bounded fix if one exists; it is yours to
explain, not R-DRAG's). The `?svg` round trips of item 1; F133's memory of item 5; the jsdom timings of F134 and F135
before and after; the quick suite with its longest file time, typecheck, lint, the bundles' md5s. Nothing in Kobin's
Chrome: say so.

## 3. Files

Yours: B-PYRAMID-3's and 4's — `src/engine/Renderer.js`, `src/engine/raster/{SvgLayer,LiveStrokeLayer,svgOverlay,svgAnchors,
PicturePyramid,PyramidStore,RasterRenderer,jobQueue,rasterPack,prefetch,MovePlane,OverlayLayer,rasterWorkerClient}.js`,
`src/storage/thumbnails.js`, the hook's gate and export, the raster and `Renderer.*` suites, the harness, `DevStats.js`'s
pyramid fields, DESIGN §7's pending-mark paragraph/§9/§15, A3, `docs/ai/`, OPEN-FLAGS' renderer flags, TEST-MAP's raster
rows. **R-DRAG (a reviewer) is in** `KobinEngine.js`'s drag paths, `selection.js`, `Document.js`, `LevelMap.js`, `Stage.js`,
`placementModel.js`, `overlays.js`, the move/select suites; **then B-MODEL-C34 (a builder)** takes the model files (those
plus `TileStore.js`, `oplog`/`persist`/`format2`): none of them yours. `KobinEngine.js` and `erasePipeline.js` are shared
(the commit hook's line, `ensureOutline`, the export barrier's call): re-read before every edit, one-line edits, rule 17;
`Stage.js` read only. Ports 3020–3029 (Node 14 via nvm; 3010–3019 are free once B-PYRAMID-4's end entry is in); R-DRAG
uses 3040–3049, B-MODEL-C34 3030–3039. The worker bundles: `npm run build:worker` after a change to `rasterCore`/
`rasterPack`/`rasterJob`/`worker/`/`geometry/`. Every commit is the orchestrator's with `[skip ci]`; you commit nothing.

## 4. Report (rule 11, under 60 lines)

`status`; `findings` (majors first — proposed, or built with leave — with scenario, evidence and the fix; minors fixed
with their tests); `filesChanged`; `testsRun`; `measurements` (§2's table, the round trips, F133's memory, F134's and
F135's timings, the drop's render by part); `leastSure` (≥ 3); `questions` with recommendations (the (f′)-pending
charge, the budgeted read at the crossing, the drop's render); `openItems` (B-MODEL-C34's, the final docs pass's, wave 3's).
