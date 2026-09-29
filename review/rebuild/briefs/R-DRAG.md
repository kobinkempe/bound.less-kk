# R-DRAG — the review of B-DRAG (2026-09-29, orchestrator; launched when B-DRAG reports)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules). **Scratch:**
`<scratchpad>/r-drag/`; B-DRAG's is `<scratchpad>/bdrag/`. Fix minors inline in the files of §3; report majors with a
proposed fix and its evidence; a major with a one-line fix and a red-before test may be applied when the orchestrator
says so (ask in your checkpoint entry, keep working meanwhile).

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §8 and §10 (as B-DRAG rewrote them); `review/rebuild/PLAN.md`
§0 (decisions 4 and 9), §1.4, §1.7 (C2), §3 rows 7 and 8, §5.2 (Q1, Q2), §5.15 item 2, §5.18 (B-DRAG's answers, when
written); `review/rebuild/briefs/B-DRAG.md` (the build's brief); `review/rebuild/A1-document-model.md` §1.4, §4.4 C2,
§4.6, §8's C2 rows, §14 (as built: C2); `review/rebuild/A2-scene.md` §2.7 (hold/release/setDragDelta); B-DRAG's
entries in `review/rebuild/STATUS-LOG.md` (grep `— B-DRAG`) and its report as PLAN §5.18 summarises it; then the code:
`KobinEngine.js`'s drag paths (`_beginSelectDrag`, `_dragSelection`, `_dropMove`, `_endMove`, `_planeLost`, the
pointer-up), `Stage.js` (`hold`, `release`, `setDragDelta`, `Item.res`, `homeOf`'s use), `selection.js` (`_opUnder`,
`_repairSelection`, `deleteSelection`, `_history`), `Document.js` (`_displaceMember`, `mergePending`), `placementModel.js`
(`homeOf`, `withShifted`), the suites `move.drop`, `move.subtree`, `move.normalise`, `select.inkless`, `select.stands.probe`,
`model.equivalence.probe`, `__testkit__/modelFuzz.js`.

## 1. Items, in order

1. **No writes during a drag, break-checked.** Every path from a drag event to the document: the pointer move, the
   plane's loss (`_planeLost` switches to the view drawing), a lasso or hit test mid-drag, an undo mid-drag, a
   resize or crossing mid-drag. A fuzz over drags with those interleaved (extend `modelFuzz`'s drag ops): the
   document byte-equal (`rev`, `offRev`, `addrEpoch`, the natives, the lattice, the undo stack) at every event until
   the drop; the picture through `placed`/`placeNative` at +δ. B-DRAG's counters (0 events, 0 re-homes, 0 settles
   per event) re-run on the final tree.
2. **The drop, once.** One op, one Stage batch, one undo entry; `_displaceMember` per (home, picture table) on the
   composed table (A1 C2's arithmetic: whole cells into the address, the rest within ±W/2 at the home); the subtree
   re-addressed once; the mint census at the drop against A1 §1.4 (B-DRAG: 0 during the drag; 14/5/4 left after GC
   against the oracle's 15/5/5 — explain the one-frame difference); `noteUserEdit` at the drop and the drop's patch
   budget (scenario 4's `olderPatchMs`, B-DRAG's runs 1,081 | 1,090 → 1,138 | 1,578 under load: attribute the drop's
   T of 437–555 ms and say whether coarse-first or the worker path is the right one there).
3. **The cancel.** A non-drop exit (escape, a lost plane, an undo mid-drag, a tool change, a second pointer) leaves
   the document byte-equal to before the press and no shadow, merge or op behind (the C1 review's least-sure 4);
   B-DRAG's cancel test extended to every exit.
4. **The selection from the op.** After a drop, an undo and a redo of a `moveFrames` op the selection's frames are its
   roots plus the op's frames no longer under a selected frame (`_opUnder`/`_repairSelection`); per-object members
   are ids; no event capture remains (grep `_keepingSelection`, the per-remove listener); the selection fuzz
   (`select.stands.probe`) with drags, undo, redo and delete: the selection's ink equals the oracle's and the ink it
   was made with; no inkless frame. Kobin's PLAN §5.2 Q1 ("moved into") and Q2 (the second parent pointer) get a
   written answer from the code as built: what "moved into" means for a per-object member and a subtree today, and
   what the second parent pointer would take (B-DRAG's three lines checked against the code).
5. **The delete.** `deleteSelection` clears the selection once and removes in one batch: the 5,000-native delete's
   time before and after (B-DRAG measures it; the review's number was 24.9–26.2 s with 18.7 s in the listener).
6. **F136 and the seed-777 defect** (a carried kid's natives left a cell off their picture after the old drop): pinned
   by a red-before test on the pre-B-DRAG tree and green now; the flag closed with the number.
7. **The drop's cost by part** (B-DRAG's trace: `_dropMove` 16–24 ms, the render 1.8–2.0 s on both trees, the repair
   358–484 ms before it was moved ahead of the render): re-time on the final tree; the render's 1.8–2.0 s is the
   pyramid's (a 45-object move dirties old ∪ new boxes on the dense scene) — attribute it (the pack, the inline
   patch, the plane's landing) and hand it to B-PYRAMID-4's reviewer with the numbers; it is not this review's to fix.
8. **Rows 8 and 9 still hold**: `model.pureRead` and `model.equivalence.probe` on the final tree (the drag ops changed
   `modelFuzz.comparePictures`: a native the oracle normalised is compared by its drawn box — check that rule cannot
   hide a wrong placement: the box is the placement's, so a wrong rem moves the box; say so with a break-check).
9. **Docs**: DESIGN §8/§10, A1 §14 (C2), OPEN-FLAGS (F94, F100, F107, F108, F126: B-DRAG closed what it measured;
   check each number), PLAN §1.4/§1.7 true to the code.

## 2. Measurement

Headless Chromium on frozen copies (the pre-B-DRAG commit d206cd3 and the final tree), scenario 4 twice each with the
ants' crawl frozen (B-DRAG's and the C1 review's scripts under `scratchpad/bdrag/` and `scratchpad/r-model/`): ink
pixel-identical after the drop; the drag's long frames and the pointer-up's task; the load printed. jsdom for the
rest. Nothing in Kobin's Chrome: say so.

## 3. Files

Yours: B-DRAG's (`KobinEngine.js`'s drag paths, `selection.js`, `Document.js`, `LevelMap.js`, `Stage.js`, `placementModel.js`,
`overlays.js`, `oplog.js`/`format2.js`'s move op, the move/select suites and probes, `__testkit__/modelFuzz.js`, DESIGN
§8/§10, A1 §14, OPEN-FLAGS' move flags). **B-PYRAMID-4 (a builder) and then its reviewer are in the raster modules,
`RasterRenderer.js`, the raster suites and the harness**: not yours; `KobinEngine.js` is shared (it may have one line
there): re-read before every edit, small edits. Ports 3040–3049 (Node 14 via nvm). Every commit is the orchestrator's
with `[skip ci]`.

## 4. Report (rule 11, under 60 lines)

`status`; `findings` (majors first with scenario, evidence, proposed fix; minors fixed with their tests);
`filesChanged`; `testsRun`; `measurements`; `leastSure` (≥ 3); `questions` with recommendations (the "moved into" and
second-parent answers for Kobin in plain words); `openItems` (B-MODEL-C34's, B-PYRAMID-4's reviewer's).
