# B-DRAG — the brief (2026-09-29, orchestrator): no writes during a drag, with C2

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19).
**Scratch:** `<scratchpad>/bdrag/`.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §8 (Moving, as C1 rewrote it) and §10 (Selecting);
`review/rebuild/PLAN.md` §0 (decisions 4 and 9, Kobin's words), §1.4, §1.7 (C2's bullet), §3 rows 7 and 8, §5.2 (Q1,
Q2), §5.7 item 1, §5.9 item 3, §5.12 item 2, §5.14 item 2; `review/rebuild/A1-document-model.md` §1.4 (what one drag
re-buckets, counted), §2, §4.4 C2, §4.6 (the second parent pointer, considered), §5 step 2, §6 (the contract), §8 (the
rows for C2), §14 (as built: C1); `review/rebuild/A2-scene.md` §2.7 (hold/release/setDragDelta) and §3's interface;
`review/rebuild/A3-pyramid.md` §6 (the plane under held items: the pack rule); B-MODEL-C1's and its review's entries
in `review/rebuild/STATUS-LOG.md` (grep `— B-MODEL-C1` and `(B-MODEL-C1 review)`); then the code: `KobinEngine.js`'s
drag paths (`_beginSelectDrag`, `_dragSelection`, `_endMove`, `_holdMove`'s remains if any, the drop), `selection.js`
(`_dragSelection` ~line 700, `_keepingSelection`, `_outsideSelection`, `deleteSelection`, the per-remove listener at
`KobinEngine.js:284–317`), `Document.js` (`_displaceMember`, `mergePending`, `moveSubtree*`, `_normalizeHome`,
`_homeShift`), `Stage.js` (`hold`, `release`, `setDragDelta`, `_home` at ~1261), `placementModel.js`, `MovePlane.js` and
`RasterRenderer.js`'s plane section (read; the pack rule is the one edit there).

## 1. What B-DRAG is

PLAN §1.4 and A1 §4.4 C2, Kobin's decisions 4 and 9:

- **No document writes during a drag.** The Stage holds the selected items (`hold`) and applies the pointer delta at
  pack time (`setDragDelta`; the plane's and the pack's `off` include it, A3 §6's rule: "a held item is skipped while
  the plane draws, and packed at `placed(item) + δ` when it does not"). Per drag event: 0 document writes, 0 re-homes,
  0 mints, 0 settles (the counters). Hit tests and the lasso during the drag read the held delta through the model.
- **At the drop, once.** Every member's table written once: a per-object member re-homed once by
  `_displaceMember`'s arithmetic on the composed table (whole cells into the address, the rest into its own table
  less the target frame's shift, within ±W/2 at its home); a subtree re-addressed once (the final scaffolding only —
  A1 §1.4's census: 183–290 frames minted per drag today, 8–13 after); one undo entry; old ∪ new boxes dirtied through
  the Stage's `release`; the plane holds per cell until the fresh plates land (as now). "An object belongs to the
  frame it was drawn or moved into" — literally (PLAN §5.2 Q1: "moved into" is the reading; it is put to Kobin once,
  the build does not wait).
- **`_normalizeHome` and `_homeShift` go**; `move` ops lose their `base`/`after` snapshots (decode kept for replay).
- **The selection is repaired from the op, never from events.** After a drop, an undo or a redo of a `moveFrames`
  op, the selection's frames are its roots plus the op's frames no longer under a selected frame
  (`_outsideSelection` on the op's frame ids); per-object members are ids and need nothing. `_keepingSelection`'s
  event capture goes, and with it the per-remove listener (`KobinEngine.js:284–317` → `_setSelection` once per removed
  member, O(n²): PLAN §5.9 item 3 — `deleteSelection` clears the selection once, then removes in one batch; the
  5,000-native delete measured 24.9–26.2 s in jsdom with 18.7 s in that listener: measure it after).
- **A cancel** (a non-drop exit: escape, a lost plane, an undo mid-drag) leaves the document as before the press:
  `release` without writes, no merge without an op record (the C1 review's least-sure 4: `_endMove` merges without a
  record on a non-drop exit — pin it with a test that a shadow cannot survive a cancel).
- **C1's leftovers in these paths** (PLAN §5.14 item 2): the Stage's `_home` read (`Stage.js:1261`) becomes
  `placementModel.homeOf`; the box united with its shifted copy, written three times (`reachBox`, `frameFootprint`,
  `overlays._selTable`), becomes one helper.
- **What stays a lattice fact** (A1 §4.4 C2 last bullet): a moved frame's descendant whose own digit carries is
  re-parented under the root's lattice neighbour. Kobin's open question (PLAN §5.2 Q2: must a re-parented subtree
  stay literally the same group?) is not built for either way: say in your report what a second parent pointer would
  take, in three lines, from what you built.

**Done means** (rule 14): no write path from a drag event to the document remains (a break-check: any write during a
drag turns a test red); `_normalizeHome`, `_homeShift`, `_keepingSelection`'s capture and the per-remove listener are
gone; the counters hold; the fuzzes hold; the docs true.

## 2. Order, with checkpoints (an entry each; the orchestrator snapshot-commits)

1. **D1 — the hold carries the drag.** The drag's steps stop writing (`_dragSelection`'s `setOffsetsById` loop and its
   `stage.batch` wrapper go); `setDragDelta` per event; the pack rule in `RasterRenderer`/`rasterPack` (one edit:
   held items at `placed + δ` when the plane does not draw them); hit tests and the lasso through the model with the
   held delta. The selection fuzz (`select.stands.probe.js`) and the tile fuzz (`model.equivalence.probe.js`, whose op
   set has tap and subtree drags) green; the harness's scenario 4 (lasso + drag) pixel-identical on ink against the
   pre-B-DRAG tree (a frozen copy; the ants' crawl clock frozen or excluded, as the C1 review did:
   `scratchpad/r-model/ants.js`). Counters per drag event: writes, re-homes, mints, settles = 0.
2. **D2 — the drop, once.** `_displaceMember` on the composed table; the subtree re-addressed once; one undo entry;
   `_normalizeHome`/`_homeShift` deleted; the mint census at the drop (A1 §1.4's method) before and after.
3. **D3 — the selection from the op.** `_outsideSelection` on the op's frames after drop/undo/redo;
   `_keepingSelection`'s capture and the per-remove listener deleted; `deleteSelection` clears once and removes in one
   batch (the 5,000-native delete's time before and after); the cancel test; `homeOf`; the one box helper.
4. **D4 — tests and docs.** A1 §8's rows for C2: `select.inkless` I3/I5/I6/I8 rewritten as op-driven repair cases,
   I4 and I9 deleted with their mechanisms; `move.startCost` kept; `move.*` settle-specific assertions already ported
   by C1 — re-read; new `move.drop.test.js` (the drop's single write, the census, the cancel) and the write-during-drag
   break-check; DESIGN §8/§10, `docs/ai/20-`/`30-`/`40-`, PLAN §1.4/§1.7, A1 §14 (as built: C2), TEST-MAP, OPEN-FLAGS
   (F94, F100, F107, F108, F126 — close only what you measured closed, with the number; the others' notes updated).
   The quick suite, typecheck, lint, the bundles if a bundle input changed; the end entry; the report.

## 3. Acceptance — measured (rule 5)

Per drag event 0 writes / re-homes / mints / settles (a counter test and a break-check); mints at the drop = the final
scaffolding (the census before and after, A1 §1.4's numbers); the selection fuzz and the tile fuzz green with the
drag ops (state the seeds and counts); scenario 4's ink pixel-identical against the pre-B-DRAG frozen tree, and the
drag's long frames in the harness no worse (load printed); the 5,000-native delete before and after (jsdom); the
cancel leaves the document byte-equal to before the press (a test); the quick suite green but for named failures;
typecheck 0; lint 0 errors. Nothing in Kobin's Chrome: say so.

## 4. Files

Yours: `KobinEngine.js` (the drag paths, the listener), `selection.js`, `Document.js`, `LevelMap.js` (the drop's
mints), `Stage.js` (`hold`/`release`/`setDragDelta`, `homeOf`'s use), `placementModel.js` (`homeOf`, the box helper),
`overlays.js` (`_selTable`'s box), `oplog.js`/`format2.js` (the `move` op's snapshots, decode kept), the move/select
suites and probes, `__testkit__/modelFuzz.js` (drag ops), the docs named; **one edit in `RasterRenderer.js`/`rasterPack.js`**
(the pack rule for held items) — B-PYRAMID-3 is in `RasterRenderer.js` for its composition switch: re-read before the
edit, keep it to the pack rule, rule 17. Not yours: the raster modules, `Renderer.js`, the erase files, `TileStore.js`'s
reroute (read). Ports 3040–3049 (Node 14 via nvm; a `git archive` of the pre-B-DRAG commit for comparisons). Every
commit is the orchestrator's with `[skip ci]`.

## 5. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements` (§3's numbers), `decisions`, `leastSure` (≥ 3),
`questions` with recommendations (the second parent pointer in three lines; "moved into"), `openItems` (C3's, C4's).
