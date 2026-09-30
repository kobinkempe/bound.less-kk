# B-MODEL-C34 — the brief (2026-09-29, orchestrator): C3 and C4 as one build (PLAN §5.16)

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19).
**Scratch:** `<scratchpad>/bm34/`. Launched after B-DRAG and its review (their files overlap).

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §2, §3, §7 (the descent and the cede), §8 (as B-DRAG left it),
§10, §13; `review/rebuild/PLAN.md` §0 (decision 9 in Kobin's words), §1.7 (C3, C4), §3 rows 7, 8, 9, §5.2 (Q4, Q5, Q8,
Q9, Q11), §5.10 item 1 (the `displaced` mint), §5.12 item 6, §5.14 item 4, §5.16, §5.19 and the R-DRAG review's section, when written (B-DRAG's and its
review's answers); `review/rebuild/A1-document-model.md` §1.2, §1.3, §4.4 C3 and C4 (whole), §4.6, §5 steps 3–4, §6,
§8 (the `lattice.coresident` and `erase.privateCede` rows), §9, §14 (as built: C1, C2); `docs/OPEN-FLAGS.md` F94, F100,
F107, F108, F124, F126 (whole entries, with B-DRAG's notes); B-MODEL-C1's, B-DRAG's and their reviews' entries in
`review/rebuild/STATUS-LOG.md`; then the code: `LevelMap.js` (`_take`, `_leave`, `findCellChild`, `cellChild`,
`peekNeighbour`/`peekRing`, `childrenOf`, `isUnder`, `subtreeStart`, `merge`), `Document.js` (`mergePending`,
`_mergeShadows`, `adoptShadow`/`unadoptShadow`, `unmerge`, `holdMerges`, the `mergeFrame` event; `_reuseDetached`,
`_detached*`, `_gone`, `kept`, `getById`'s set-aside test), `placementModel.js` (`nativesIn`, `displaced`), `TileStore.js`
(the readers of a cell's ink: `_bakeUp`'s parent, `_ringNatives`), `frameGc.js`, `selection.js` (the lasso's walk,
`_familyBounded`, `_tornUnder`/`keyedIn`), `eraseDescent.js` (`descentJob`, `ownIn`, `minted`), `erasePipeline.js`
(`_cellOffset`, `lm.merge`), `cede.js`, `legacy/modelV1.js`, `persist.js` (the version-3 gate), the frozen oracle
`__oracles__/model-v1/` and the fuzz `__testkit__/modelFuzz.js`.

## 1. What B-MODEL-C34 is

**C3 — a frame keeps its identity** (A1 §4.4 C3, PLAN §1.7): no merges — a frame landing on an occupied cell is a
permanent co-resident, its kids at cells the resident also has linked as co-residents of those kids; every lookup
and every by-cell reader sees co-residents (`findCellChild`, `cellChild`, `peekNeighbour`/`peekRing`, `nativesIn`, the
tile bakes' parent and ring reads, the idle fits, the erase debug overlay); each co-resident its own selection unit
(the lasso judges it on its own box; `isUnder` loses its shadow clause; `subtreeStart` stops dragging shadows along);
the camera handed to the resident at the re-address; GC promotes an empty childless resident's co-resident to the
cell; a deleted frame subtree leaves the lattice (its records hold the frames and their lists; an undo puts the root
back, as a co-resident if new ink took the cell; a camera in a deleted frame moves to a fresh frame at the cell) —
F107's revival sets go; `displaced`'s read-time mint (PLAN §5.10 item 1, the one exception to row 8) is revisited:
with co-residents, a moved picture's source frame is found or created at the action's end, never on a read, so the
exception closes and `model.pureRead` asserts the frame set unchanged with no exception. Deleted: `_mergeShadows`,
`adoptShadow`/`unadoptShadow`, `unmerge`, `holdMerges`, the `mergeFrame` event (decode kept in `legacy/modelV1.js`),
the selection's merge handler, F126's follow, `_reuseDetached` and the detached sets, `getById`'s set-aside test.

**C4 — a cede's kids live in private frames of their object** (A1 §4.4 C4): `descentJob` stores each step's kids in a
private co-resident of the chain's frame at that cell (created on first use, its lattice parent the previous step's
private frame, flagged `private` with the target frame's id, persisted — version 3 covers it, PLAN §5.2 Q5); remnants
stay in the target's frame; the lasso never takes a private frame whole (read as straddling, its natives judged with
their families) and every other frame keeps the O(1) enclosed rule with no family pass (F108-COST option (c): the
Earth lasso is frames again, not 17,007 ids); severance compares lattice cells (F124); legacy families keep the
backstop rule (`_tornUnder` over `keyedIn`), non-empty only for legacy content (PLAN §5.2 Q11); `eraseDescent.ownIn`
and `Document.ownFor` become one helper (PLAN §5.14 item 4).

**Done means** (rule 14): no merge path remains (grep every deleted name: no caller, no reader); the lattice's frame
set is unchanged across every read (row 8 without exception); the tile fuzz and the selection fuzz against the frozen
oracle hold with C3's and C4's ops (a drop on an occupied cell, a delete and undo of a subtree, a cede across an edge,
a lasso over a torn family), with the differences C3/C4 make by design named and measured (a co-resident where the
oracle merged: compared by place, the picture equal); the version-3 gate covers co-residents and private frames; the
docs true; F94, F100, F107, F108, F124, F126 closed with numbers or their notes updated.

## 2. Order, with checkpoints (an entry each; the orchestrator snapshot-commits)

1. **C3a — co-resident lookups and readers** while merges still run (A1 §5 step 3: between a drop and the merge they
   only show a shadow's ink where the merge would put it); the tile fuzz green.
2. **C3b — no merges**: `_take` leaves a co-resident; the camera hand-over; GC's promotion; the selection units; the
   deletions; the tile and selection fuzzes (the comparison by place absorbs a co-resident where the oracle merged);
   `displaced`'s mint moved to the action's end and the row-8 exception closed.
3. **C3c — a deleted subtree leaves the lattice**; undo returns it (as a co-resident if needed); the camera in a
   deleted frame; F107's sets deleted; `lattice.coresident.test.js` (A1 §8).
4. **C4** — private frames for new cedes; the lasso's rules; severance by cell; `ownIn`/`ownFor` one helper; the
   legacy backstop kept; `erase.privateCede.test.js` (A1 §8: no keyed piece in a non-private frame; the F108 repro
   takes the enclosed frame whole and none of the family; a torn-family lasso is O(frames)); the erase suites and
   `test:erase` green; the worker bundle rebuilt (`eraseDescent` is in `raster-worker.js`).
5. **Tests and docs**: A1 §8's rows (`select.detachedFrame`'s revival cases replaced; `move.twin`'s merge cascade,
   `move.camMerge`, the settle/merge cases of `oplog`/`format2`/`Document`/`LevelMap` tests deleted with their
   mechanisms; `hooks/store.model.test` with a store carrying `mergeFrame` entries loading through the legacy module);
   DESIGN §7/§8/§10/§13, `docs/ai/20-`/`30-`/`40-`, PLAN §1.7, A1 §14 (as built: C3, C4), TEST-MAP, OPEN-FLAGS; the
   quick suite, typecheck, lint, the bundles; the end entry; the report.

## 3. Acceptance — measured (rule 5)

The tile fuzz (`model.equivalence.probe.js`, 200 seeds with the new ops) and the selection fuzz against the oracle,
with every designed difference named and counted; `model.pureRead` with no exception; the Earth-shaped torn-family
lasso's id count (F108: 17,007 before) and its time; the census of frames after a drop on an occupied cell (no merge,
one co-resident); the harness's scenarios 3 and 4 pixel-identical on ink against the pre-C34 tree (frozen copies,
ports 3040–3049); break-checks for each rule (rule 13); the quick suite and `test:erase` green but for named failures;
typecheck 0; lint 0 errors. Nothing in Kobin's Chrome: say so.

## 4. Files

Yours: `LevelMap.js`, `Document.js`, `placementModel.js`, `TileStore.js` (the readers), `frameGc.js`, `selection.js`,
`overlays.js` (the erase debug overlay's reader), `eraseDescent.js`, `erasePipeline.js` (`_cellOffset`, `lm.merge`),
`cede.js`, `legacy/modelV1.js`, `persist.js`/`format2.js` (the `private` flag, version 3), `KobinEngine.js` (the camera
hand-over, the idle fits' reader, `_reuseDetached`'s callers), the model/move/select/erase suites and probes,
`__testkit__/modelFuzz.js`, `__oracles__/README.md`, the docs named. Not yours: the raster modules, `RasterRenderer.js`,
`Renderer.js`, the harness. If B-PYRAMID-4's reviewer is still running, `KobinEngine.js` is shared: re-read before
every edit, small edits (rule 17). Every commit is the orchestrator's with `[skip ci]`.

## 5. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements` (§3), `decisions`, `leastSure` (≥ 3), `questions` with
recommendations, `openItems` (the reviewer's; wave 3's helpers; the legacy module's deletion date).
