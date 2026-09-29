# R-MODEL-C1 — the review of B-MODEL-C1 (2026-09-29, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules). **Scratch:**
`<scratchpad>/r-model/`; C1's is `<scratchpad>/bm1/` (`scenes34.js`, `diffimg.js`, `crop.js`, `c1counters.probe.js`,
`breakcheck.py`, `breaks_m3.py`). Fix minors inline in the files of §3; report majors with a proposed fix and its evidence.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §8 and §13 (as C1 rewrote them); `review/rebuild/PLAN.md` §0
(decision 9), §1.7, §3 rows 5, 7, 8, 9, §5.2, §5.10, §5.12; `review/rebuild/briefs/B-MODEL-C1.md` (the build's brief);
`review/rebuild/A1-document-model.md` §4.4 C1, §5 step 1, §6, §8, §14 ("As built: C1"); B-MODEL-C1's entries in
`review/rebuild/STATUS-LOG.md` (grep `— B-MODEL-C1`); then the code: `src/engine/placementModel.js` (whole), `Document.js`
(`tableOf`, `ownFor`, `add`, `mergePending`, the deletions), `geometry/offsets.js` (`objShift`/`residual`'s carry),
`TileStore.js` (the reroute grouping by home), `legacy/modelV1.js`, `persist.js` (the gate), `__testkit__/modelFuzz.js`
and the probes `model.equivalence.probe.js`, `select.stands.probe.js`, the suites `model.compose`, `model.pureRead`,
`legacy/modelV1.test`, `hooks/store.model.test`.

## 1. Items, in order

1. **Row 9, the fuzz's relaxations (PLAN §5.12 item 3).** The comparison skips the outer 64 units of a square above a
   native's home and counts (does not fail) a native that diverges after a carry. Establish what the picture at a
   square's edge above the home must be from the composition's arithmetic (A1 §4.4 C1: the picture's table = the own
   table + the home frame's shift at k = 0, no carry; `objShift`'s F0 at the home depth) and from the pre-C1 flags that
   describe the oracle's wrong reads there (F116's foreign-shift settle, the reroute's skip of views above the home,
   `TileStore.js:242` before C1); then tighten the fuzz to compare the full square with the new engine's picture as the
   reference where the oracle is known wrong, and turn the divergence count into an assertion or a named, measured
   exception. Seeds and counts in your entry.
2. **Row 7, the ants' dash phase (item 2).** After a lasso and drag, 29–50k px differ on the ants only between the
   pre-C1 tree (5e9b1dd) and C1, the same outline. Trace it: does the selection's piece set (ids, the pieces under
   the frames) differ, or only the outline's segment order? The first is a C1 defect to fix; the second is cosmetic
   and goes to B-DRAG with your trace. C1's `bm1/scenes34.js` and `diffimg.js` reproduce it (two dev servers, Node 14,
   worktrees at 5e9b1dd and the current tree, ports 3030–3039).
3. **Row 8, pure reads.** `model.pureRead` holds over 180 states; extend it with the reads C1's list may miss (a hit
   test through `sceneClient`, the erase pipeline's frame pass, a snapshot for the Scenes panel, `report()`), and
   pin the one exception (`displaced`'s mint of an empty source frame: it is GC'd, it carries nothing, no other read
   mints).
4. **Row 5, the composition.** `model.compose`'s cases against A1 §4.4 C1 bullet by bullet: the carry case (0.75 W → F0
   one cell over, rem −0.25 W); the live native; newcomer cancellation for a stroke, a cede kid and a promoted native;
   a cut piece keeping its source's table; the box union (H6). Add what is missing; break-check each rule you add.
5. **The version gate and the legacy module.** A shift-free file byte-identical to the oracle's (C1 measured it); a
   shifted file refused by the deployed reader (0732252, a scratchpad copy as the B-ERASE review made) with its
   "saved by a newer version" message rather than dropped fields; `legacy/modelV1.js` imported by no production path
   outside replay (the test exists: check it cannot be evaded by a re-export); the store test's fixture without the
   legacy module fails as expected.
6. **The SVG path** (item 4): scenario 4 (lasso + drag) on `?svg` on the current tree alone, headless; a crash or a
   pixel difference against the raster path's ink is a finding.
7. **Stage and the lint.** The Stage reads membership and placement through `placementModel` only (grep `.below`,
   `f.shift`, `_home`, `doc.at` in `Stage.js`); the lint's allowed lines each carry a reason that is true; a fresh leak
   in each allowed file's neighbour turns red.
8. **Counters, once more, on the final tree**: settles and table writes per drag event (C1: 0 and 0), `doc.rev` per
   20-event drag (12,640 → 940), and the harness round trip (the raster path) against the pre-C1 worktree: ink
   pixel-identical.
9. **Small items** (PLAN §5.12 item 5): rename `hooks/store.subtree.test.js`'s `settleAll` and `sceneIndex.test.js`'s
   "a settle is a no-op" to what they assert now.
10. **Docs**: DESIGN §8/§13 true to the code (the composition, the merge at the action's end, the version gate, the
    legacy module's date); A1 §14 consistent with what you found; OPEN-FLAGS' C1 notes (F78, F110, F116 gone with the
    numbers; F93 half; F67) correct.

## 2. Not yours

B-PYRAMID-2b is running P6 in the raster modules, `RasterRenderer.js`, `MovePlane.js`, `rasterWorkerClient.js`,
`eraseWorkerClient.js`, `erasePipeline.js`'s dispatch, `sceneOps.js`, `tools/harnesses/`, the hook's raster parts,
DESIGN §7/§9/§10/§15, `docs/ai/`, TEST-MAP's raster rows, OPEN-FLAGS' renderer flags. Its files are not yours; the
ants' trace reads `overlays.js` and `MovePlane.js` but changes only C1's files. `KobinEngine.js`, `Stage.js` and
`erasePipeline.js` are shared: re-read before every edit, keep each edit small (rule 17). Every commit is the
orchestrator's with `[skip ci]`.

## 3. Files you may edit

C1's: `Document.js`, `LevelMap.js`, `TileStore.js`, `placementModel.js`, `geometry/offsets.js`, `oplog.js`, `persist.js`,
`format2.js`, `files.js`, `frameGc.js`, `sceneClient.js`, `report.js`, `overlays.js` (the box only), `selection.js` (the
box and the `.below` reads only), `legacy/`, `__testkit__/modelFuzz.js`, the model suites and probes, the two test files
of item 9, `package.json`'s eslintConfig (the lint only), DESIGN §8/§13, A1 §14, OPEN-FLAGS' C1 notes. Node 14 dev
servers on 3030–3039; the worker bundles need `npm run build:worker` after an `offsets.js` change.

## 4. Report (rule 11, under 60 lines)

`status`; `findings` (majors first with scenario, evidence, proposed fix; minors fixed with their tests);
`filesChanged`; `testsRun`; `measurements` (items 1, 2, 6, 8 with numbers and where each came from); `leastSure` (≥ 3);
`questions` with recommendations; `openItems` (B-DRAG's, C3's, C4's).
