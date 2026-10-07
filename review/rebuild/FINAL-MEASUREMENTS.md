# The final design check's measurements (R-FINAL-M, 2026-10-06)

Headless Chromium 141 (software GL) in the cloud container, and jsdom. **Nothing here was checked in Kobin's Chrome**:
the compositor, GPU uploads and real input timing are not in these numbers (A3 §9.4). Every number below names its log
under `<scratch>/fin-m/` (`<scratch>` = the session scratchpad); `node fin-m/sum.js A-` and `node fin-m/sum139.js
fin-m/logs/D139*.log` reprint the tables from the logs.

**In short.** On `final`: paper 0 in every scenario row (F137's back-in paper 0 in 2 of 2; `landed` 646.7 and 125.2 ms);
the settled ink identical to `landed` and `pre` in scenarios 1–6 and the plain round trip; scenario 4's drop decides no
ants and has no crawl row (render 513–582 ms against 992–1,115); **F140: the erase baked in 14 of 14 valid scenario-7 runs
(3,681–4,859 ms), no stall, and no view strip dropped `offscreen` after the wheel**. F139 shows no paper, but in its
shifted-camera shape each undo or redo after the first waits 384–636 ms for its first compose (both trees). The drop's
`setBatch` wrap shows no benefit with any cache this tree can hold. Scenario 6's exact came later than `landed`'s in
this pass (352 / 852 against 171 / 332) — two runs, not attributed.

## 1. The trees and the method

| tree | commit | git tree | dev server | worker bundles (raster / scene md5, first 8) |
|---|---|---|---|---|
| `final` | a0b0ed4 (B-PYRAMID-6 landed, F140's fix) | 533f1409 | :3060 | cec9b95b / dce304b8 |
| `landed` | 59f0a76 (C3/C4 landed) | e971efdb | :3061 | 83283d8b / dce304b8 |
| `pre` | 56e36b3 (the rebuild's start) | 72edc191 | :3062 | 13c28c87 / dce304b8 |
| `early` | d45fdb4 (scenario 6 only, see below) | 46ada0fa | :3063 | 378db4bf / dce304b8 |

Each a `git archive` copy with `node_modules` symlinked, served by `npm start` under Node 14 (`BROWSER=none`, `CI=true`;
`prestart` built each copy's own worker bundles). The harness ran under Node 22 with Playwright 1.56.

**Harness.** `pre` has no `browser-check.js`; every tree was driven by the final tree's harness (md5 82ed704d), through
copies that only add readings, never change a gesture: `fin-m/h` adds, after each measure's settle, the composed canvas's
ink (`inkAfter`, R-MODEL-C34b's form) and the ant-decision counter `_selDecSeq` (at the drag's press, at its release and
after the settle); `fin-m/h7` adds to scenario 7 an in-page log of every queue drop and `setMotion`, the queue's counters
at the wheel's end and at the bake, and the queue's state if the erase does not bake in 60 s (runs 11–13 also save the
settled canvas); `fin-m/h139` adds the F139 scenarios (§2.1). The `?svg` round trip is B-PYRAMID-3's `bp3/svgtrip.js`
(copied to `fin-m/tools/`), screenshots diffed by `fin-m/tools/diffimg.js`.

**Start rule.** Every browser run started only with the 1-minute load under 2 for 10 s and no `chrome`/`headless_shell`
process (`pgrep -x`), checked by the batch scripts (`fin-m/batch.sh`, `batch2.sh`–`batch5.sh`, one line a run in
`fin-m/batch.log` with the load at the start and the end). The harness's own load reads at its start and end are in
each table (`load`). Runs at a 4-CPU container, no other agent running. One run is excluded: B7-final-5 overlapped my
jsdom probe (21:57–21:59 UTC); B7-final-11 replaces it.

**Order.** Scenario 7 ×10 on `final` first (batch B), then the seven scenarios ×2 per tree interleaved (pass 1 final,
landed, pre per scenario; pass 2 pre, landed, final), then the round trips, then F139, the setBatch probe, three more
scenario-7 runs and the second `early` run.

**`pre` limits.** The dense mode runs on `pre` (flushBakes 29–30 s at setup against ~2 s on the pyramid trees). Scenario 6
does not: `R._pyrPack` is undefined (`TypeError: Cannot read properties of undefined (reading 'bind')`, both runs), and
`pre` has no Stage for the harness's commit signal. Scenario 6 ran instead on **d45fdb4**, the earliest landed commit with
the pyramid as the only raster path (the old `PictureLayer` deleted; 1636c26 before it is a mid-deletion snapshot). On
`pre` the layer integrals (`paperMs` from the layer, blur, older) do not exist: `paperMs` is the rAF sampler's there, and
scenario 5's `exact` is not comparable (the harness reads exactness from the pyramid's `_share`).

## 2. The scenarios

Columns: load at the run's start → end; gesture ms; the worst long frame (ms, its top script) and the long-frame count;
paper ms as layer | rAF | post-paint; blur ms; older ms as patch / unread / other; the settled ink (dark px, hash).

### Scenario 1 — zoomout (90 ticks out from depth 2, then 90 back)

| run | load | out: gesture | worst | long | paper | blur | back in: gesture | worst | long | paper | blur | unread cells |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| final 1 | 1.60→2.07 | 6,299 | 583 Worker.onmessage | 4 | 0\|0\|0 | 12.9 | 7,342 | 459 Worker.onmessage | 14 | 0\|0\|0 | 2,048.8 | 16 |
| final 2 | 1.59→2.42 | 6,325 | 713 Worker.onmessage | 5 | 0\|0\|0 | 15.9 | 7,503 | 454 rAF callback | 18 | 0\|0\|0 | 2,685.4 | 16 |
| landed 1 | 1.61→3.08 | 6,220 | 594 Worker.onmessage | 4 | 4.4\|4.3\|4.9 | 16.1 | 7,249 | 483 Worker.onmessage | 9 | **646.7\|646.7\|649.2** | 2,038.4 | 16 |
| landed 2 | 1.14→2.04 | 6,014 | 612 Worker.onmessage | 3 | 0\|0\|0 | 12.7 | 7,114 | 401 idle callback | 16 | **125.2\|125.1\|140.7** | 1,839.7 | 16 |
| pre 1 | 1.58→1.25 | 38,602 | 707 idle callback | 147 | 4.8\|4.8\|62.1 | – | 30,400 | 546 DIV.onwheel | 140 | 0\|0\|0 | – | – |
| pre 2 | 1.09→1.31 | 40,144 | 442 Worker.onmessage | 153 | 0\|0\|0 | – | 31,622 | 457 idle callback | 120 | 0\|0\|0 | – | – |

Older 0 / 0 / 0 in every pyramid row. Ink: out 1,024,000 px #445693871, back in #4130098484 — identical on the three
trees in all six runs (the backdrop fill makes every pixel "ink"; the hash is the comparison). **F137 holds fixed on
`final`** (back-in paper 0 in 2 of 2; `landed` 646.7 and 125.2 ms).

### Scenario 2 — slowzoom (40 ticks at 120 ms)

| run | load | gesture | worst | long | paper | blur | older |
|---|---|---|---|---|---|---|---|
| final 1 | 0.97→1.81 | 7,526 | 494 Worker.onmessage | 22 | 0\|0\|0 | 11.3 | 0/0/0 |
| final 2 | 1.57→3.14 | 7,645 | 430 Worker.onmessage | 25 | 0\|0\|0 | 15.0 | 0/0/0 |
| landed 1 | 1.41→1.41 | 7,053 | 393 Worker.onmessage | 14 | 0\|0\|0 | 14.2 | 0/0/0 |
| landed 2 | 1.38→2.02 | 7,583 | 866 idle callback | 14 | 0\|0\|0 | 12.6 | 0/0/0 |
| pre 1 | 1.09→1.60 | 31,814 | 715 idle callback | 130 | 0\|0\|0 | – | – |
| pre 2 | 1.59→1.77 | 29,600 | 616 idle callback | 124 | 0\|0\|0 | – | – |

Ink #4022498913 on all three trees, every run.

### Scenario 3 — pan (60 `panBy` steps)

| run | load | gesture | worst | long | paper | blur | older |
|---|---|---|---|---|---|---|---|
| final 1 | 1.24→1.96 | 1,503 | 124 Worker.onmessage | 7 | 0\|0\|0 | 0 | 0/0/0 |
| final 2 | 1.66→2.23 | 1,613 | 103 setTimeout | 7 | 0\|0\|0 | 0 | 0/0/0 |
| landed 1 | 1.52→2.04 | 1,480 | 77 rAF callback | 3 | 0\|0\|0 | 0 | 0/0/0 |
| landed 2 | 1.61→2.13 | 1,405 | 105 setTimeout | 4 | 0\|0\|0 | 0 | 0/0/0 |
| pre 1 | 1.59→2.17 | 2,045 | 662 idle callback | 10 | 0\|0\|0 | – | – |
| pre 2 | 1.66→2.24 | 2,094 | 432 (no script) | 11 | 48.1\|48.1\|2.5 | – | – |

Ink #2809245633 on all three trees, every run. (Scenario 3 was not re-run after B-TIDY's `_camAt` fix by anyone before
this pass, PLAN §5.25 item 4: it runs and matches.)

### Scenario 4 — lasso, then a 40-step drag of a selection holding frames ("1", "1/-1,1": a subtree drag)

| run | load | lasso: gesture | worst | sel | drag: gesture | worst (the drop) | long | olderPatch | ant decisions at the drop |
|---|---|---|---|---|---|---|---|---|---|
| final 1 | 1.56→2.16 | 1,649 | 363 | 45 | 2,029 | 635 onpointerup | 15 | 375.2 | 0 |
| final 2 | 1.65→2.48 | 1,728 | 361 | 45 | 1,950 | 562 onpointerup | 16 | 94.9 | 0 |
| landed 1 | 1.68→1.58 | 1,820 | 335 | 45 | 2,525 | 1,156 onpointerup | 18 | 762.1 | 1 |
| landed 2 | 1.45→2.55 | 1,735 | 369 | 45 | 2,468 | 1,035 onpointerup | 19 | 511.0 | 1 |
| pre 1 | 1.23→1.73 | 1,530 | 562 | 45 | 3,307 | 1,696 onpointerup | 4 | – | 1 (and 1 during the drag) |
| pre 2 | 1.60→1.86 | 1,592 | 548 | 45 | 3,662 | 1,991 onpointerup | 4 | – | 1 (and 1 during the drag) |

Paper 0 | 0 | 0 and blur 0 in every row. Ink: lasso #3619009051 (1,012,664 px), drag #2972295975 (1,012,661 px) —
identical on the three trees, every run.

**The drop's rows** (rasterPerf rows over 100 ms, the three largest timers each):

| run | render row | crawl rows |
|---|---|---|
| final 1 | 582 (eng.list 376, eng.view 108, eng.pack 65) | none |
| final 2 | 513 (eng.list 321, eng.view 110, eng.pack 51) | none |
| landed 1 | 1,115 (ovl.tail 494, eng.list 446, eng.view 111) | 501, 499, 494 (ovl.decide 477) |
| landed 2 | 992 (ovl.tail 472, eng.list 340, eng.view 120) | 494, 482, 480 (ovl.decide 457) |
| pre 1 | 1,673 (eng.list 713, eng.pack 496, ovl.tail 454) | 459, 454, 237 (ovl.decide 443, 225) |
| pre 2 | 1,966 (eng.list 850, eng.pack 557, ovl.tail 544) | 544, 543, 256 (ovl.decide 530, 245) |

On `final` `ovl.tail` is not among the render row's three largest timers (so under 51–65 ms), and the drop decides no
ants (B-PYRAMID-5's kept decision). `eng.list` 321–376 ms is the drop's largest remaining part (PLAN §5.26 item 4).

### Scenario 5 — a translucent stroke's pen-up

| run | load | gesture | worst | long | paper | live release | exact at release | exact |
|---|---|---|---|---|---|---|---|---|
| final 1 | 1.35→1.86 | 1,454 | 124 setTimeout | 10 | 0\|0\|0 | 59 | yes | 61 |
| final 2 | 1.60→1.83 | 1,451 | 131 setTimeout | 10 | 0\|0\|0 | 59 | yes | 61 |
| landed 1 | 1.45→1.66 | 1,452 | 109 setTimeout | 8 | 0\|0\|0 | 58 | yes | 60 |
| landed 2 | 1.65→2.44 | 1,454 | 154 setTimeout | 9 | 0\|0\|0 | 54 | yes | 55 |
| pre 1 | 1.86→1.60 | 2,250 | 395 onpointerup | 4 | 0\|0\|0 | 607 | n/a | (877, not comparable) |
| pre 2 | 1.63→2.12 | 2,248 | 333 onpointerup | 5 | 0\|0\|0 | 621 | n/a | (895, not comparable) |

Blur 0, older 0, both-composes 0. Ink #3750262654 on all three trees.

### Scenario 6 — Ctrl+Z of scenario 5's stroke

| run | load | gesture | worst | long | first change (commit) | exact | inline packs (purpose/level/ms) |
|---|---|---|---|---|---|---|---|
| final 1 | 1.25→2.37 | 361 | 101 Worker.onmessage | 7 | 87 | 352 | patch/full/34 |
| final 2 | 1.45→2.18 | 902 | 270 IDBRequest.onsuccess | 8 | 82 | **852** | patch/full/29 |
| landed 1 | 1.56→2.25 | 177 | 108 setTimeout | 7 | 102 | 171 | coarse/−1/29.2 |
| landed 2 | 1.48→1.86 | 388 | 103 setTimeout | 5 | 77 | 332 | coarse/−1/24.4 |
| pre 1, 2 | – | – | – | – | harness fails (no `_pyrPack`, no Stage) | – | – |
| early (d45fdb4) 1 | 1.18→1.59 | 1,141 | 300 setTimeout | 11 | 598 | 1,021 | none |
| early (d45fdb4) 2 | 1.28→1.50 | 557 | 155 onKey | 7 | 200 | 471 | coarse/−2/49.4 |

Paper, blur and older 0 in every row; ink #3619009051 on final, landed and early. `final` patches the full resolution
inline (T 27.6 / 29.5 ms within the user's 48 ms; `landed` took the coarse level, T 18.3 / 17.7) and then dispatched 12
rest strips to the workers; `landed` 2 view + 10 rest. See anomaly 2.

### Scenario 7 — an eraser across the stack, then a zoom while its bake runs

| run | load | gesture | worst | long | paper | blur | older | erase baked (ms) | both-composes | ink |
|---|---|---|---|---|---|---|---|---|---|---|
| final 1 | 1.06→2.10 | 5,337 | 126 Worker.onmessage | 22 | 0\|0\|0 | 691.7 | 930.2/0/40.0 | 3,935 | 0 | 508,144 #2045006333 |
| final 2 | 1.38→1.91 | 5,627 | 160 Worker.onmessage | 29 | 0\|0\|0 | 749.5 | 927.8/0/24.9 | 4,249 | 0 | 508,287 #406045820 |
| landed 1 | 1.57→1.65 | 5,540 | 165 Worker.onmessage | 19 | 0\|0\|0 | 734.7 | 1,094.6/0/71.3 | 4,182 | 4 | 508,144 #2045006333 |
| landed 2 | 1.52→1.77 | 5,386 | 125 setTimeout | 25 | 0\|0\|0 | 533.2 | 950.4/0/70.8 | 3,992 | 3 | 508,144 #982670724 |
| pre 1 | 1.29→1.40 | 15,729 | 663 idle callback | 52 | 0\|0\|0 | – | – | 14,028 | 0 | 508,144 #708402118 |
| pre 2 | 1.56→1.96 | 15,740 | 445 Worker.onmessage | 59 | 0\|0\|0 | – | – | 14,081 | 0 | 508,144 #708402118 |

`olderOther` 24.9–40.0 ms on `final` (B-PYRAMID-5: 14.9; `landed` 70.8–71.3). The settled ink is not stable run to run
on the pyramid trees (anomaly 1).

### Scenario 7 ×10 on `final` and F140

Harness `fin-m/h7`, 13 runs (`fin-m/logs/B7-final-<n>.log`; run 5 excluded above, 11–13 with the settled canvas saved),
load at the start 0.44–1.67, at the end 1.57–2.64.

| | runs 1–4, 6–13 (12 valid) |
|---|---|
| erase baked | **12 of 12** (and run 5 too): 3,681–4,859 ms (4,261, 3,941, 3,837, 3,778, 4,780, 3,802, 3,681, 4,859, 4,508, 4,389, 3,971, 3,844); batch A's two `final` runs 3,935 and 4,249 |
| a stall (not baked in 60 s) | **0** — the queue-state dump never fired |
| view strips dropped `offscreen` after the wheel stops | **0 in every run**; offscreen cells 0, re-aims 0 after the wheel |
| the motion the queue reads after the wheel | the last tick's moving step, then a still one 149–422 ms after the harness's last tick |
| drops in that window | patches only: `exact` 3–13 a run under the moving motion, 1–46 after; `prefetch` `gen` 0–22 |
| during the gesture | view strips `offscreen` 0–6 a run, prefetch `gen` 109–149 |
| paper (layer \| rAF \| post-paint) | 0 \| 0 \| 0 in every run |
| both-composes | 3 (run 2) and 4 (run 6); 0 in the other ten |
| settled ink | 508,144 px in 12 of 13 (508,287 in run 4); 8 distinct hashes over 13 runs — anomaly 1 |

**F140: no stall in 13 runs on `final`** (before B-PYRAMID-6's fix: 1 in 10). The velocity rule's stale aim (PLAN §5.27
item 1) dropped no view strip in 13 runs: the window in which the queue still reads the last moving step is 149–422 ms,
and nothing the queue dispatched in it was a view strip aimed off screen.

### The round trips (once per tree)

The plain round trip (harness default mode: three strokes, 40 ticks out, back): `roundTrip` 25,244 px before and after,
same hash, on each tree; the four screenshots 0 px different `final`→`landed` and `final`→`pre`.

The `?svg` round trip (`svgtrip.js`, nine states):

| state | final→landed | final→pre |
|---|---|---|
| 0-live (a live stroke mid-gesture) | 18 px, box (334,295)–(945,505) | 18 px, same box |
| 1-drawn, 3-zoomin, 4-lasso, 5-ants, 6-dragged | 0 | 0 |
| 2-zoomout, 7-erased, 8-baked | 1 px at (139,148) | 1 px at (139,148) |

`landed`→`pre` is 0 px in 0-live, 2-zoomout and 7-erased: `final` alone differs. The 1 px at (139,148) is one level of
grey (#fefefe against #ffffff) on an edge; the 18 px of 0-live lie along the live stroke caught mid-gesture (its state
depends on how many pointer events landed before the shot; B-PYRAMID-3 saw the same class). Neither was traced further.

## 3. The three measurements the reviews left

### 3.1 F139 — an undo and a redo with a subtree-dragged frame's ink in view

Headless Chromium on the dense drawing, harness `fin-m/h139` (scenarios `f139` and `f139b`; logs `fin-m/logs/D139-*` and
`D139b-*`, load at the start 0.52–1.66). What each did, in the page:

- **Counters** (instance methods wrapped after the setup): frame GC's forgets (`E._gcStats.forgotten`), `store.prepare`
  calls and the frames they minted (`lm.frames.size` across each call), tile bakes (`store._bakeUp` / `_bakeDown`
  calls), plate drops (`plates.dropFrames` calls), and every `layer.compose` with the layer's `_share` after it.
- **The steps**: a pen stroke (20 moves) in view, then Ctrl+Z, Ctrl+Y three times; each step waits for the Stage's
  generation to move, then 1.5 s, and is its own `measure` row (paper as layer | rAF | post-paint).
- **`f139`, a real subtree drag**: scenario 4's lasso and drag (44 ids and frames "1" and "1/-1,1" selected, 40 steps),
  its settle, then the steps. The camera stays in "0".
- **`f139b`, R-MODEL-C34b's shape**: the camera placed in "2" (inScale 1), `E.doc.setFrameShift("2", [round(1.3 W), 0])`
  — the composed shift a subtree drag leaves — and a render (5 → 6 frames: one picture source minted), then the steps.

| shape, tree (runs) | per undo or redo: forgets / mints / tile bakes / plate drops | paper in any compose after the key | the first compose after the key |
|---|---|---|---|
| `f139` final (2), landed (1) | 0 / 0 / 0 / 0 in 18 of 18 steps (GC ran at each undo, forgot nothing) | none (paper, blur, older 0) | 15–36 ms |
| `f139b` final (2) | 1 / 1 / 2 / 1 every step (the first undo 1 / 0 / 1 / 1: its re-mint lands at the redo) | **none** in 12 of 12 steps (share 0 in every compose; paperMs 0 \| 0 \| 0, blur 0, older 0) | first undo 8–9 ms; every later step **384–560 ms** |
| `f139b` landed (1) | the same | none in 6 of 6 | first undo 9 ms; later steps **448–636 ms** |

**The answer: the first render after the undo shows no paper.** What F139 costs instead is time: in `f139b` every step
after the first runs a 381–642 ms main-thread task in the key's handler (`DOMWindow.onkeydown`) before its first compose,
rasterPerf's render row 381–558 ms on `final` (448–632 `landed`) with `eng.list` 378–550 ms (442–629) — the re-minted
frame's two tile bakes read in the list. The first undo composes at 8–9 ms and then spends 729–765 ms in a timer task
(two settle rows: `eng.pack` 355–397, `eng.list` 354–371). In `f139`, where nothing is forgotten, the first compose comes
15–36 ms after the key. The attribution is by this contrast (forgets 1 ↔ 0.4–0.6 s; 0 ↔ under 40 ms), not by a
break-check. The same on `landed` (pre-existing, as the flag says). In the app this shape is a frame dragged as a subtree
and then entered (the camera in the shifted frame) before an undo; the dense subtree drag seen from "0" does not reach it.

### 3.2 The drop's `setBatch` wrap (PLAN §5.25 item 2)

jsdom, the copy `fin-m/jsd` (a0b0ed4) with one scratch test `src/engine/zz_finm_setbatch.test.js` (copy only; never in
the tree), `CI=true npx react-scripts test`, Node 22, load 1.17 → 1.13 (23:10 UTC, no browser). R-MODEL-C34b's fixture
(raster engine, a never-answering worker transport; `pointerUp` of a select-tool drag of 40 px timed) widened: members
in 9 cells of "1" (300 shapes each, 2,700 members, 900 re-homed by the drop) and 200 shapes in each of 12 more cells.
"none" stubs `store.setBatch` to a no-op; wrap and none alternate.

| fixture | tiles cached at the press | dropped by the drop | wrap ms | none ms |
|---|---|---|---|---|
| "full": views at "1" panned ×5, at each of the 21 cells, at "0", then the prefetch's warm reads at five views in "1" | 4 (warm 2–4) | wrap 2, none 0 | 482, 417, 394, 369 | 386, 423, 417, 388 |
| "small": R-MODEL-C34b's own (no extra views) | 4 | wrap 2, none 0 | 410, 380 | 407, 506 |
| "deep": the camera in the member cell (activeLevel 2) after views at "0" and "1", warm reads there | 54 (50 pinned) | 0 and 0 | 27, 13, 13, 28 | 11, 11, 15, 12 |

**No measured benefit.** A fuller cache does not reach the wrap: `TileStore.framesLeft` drops every tile but the camera
frame's chain, its pins and the prefetch's warm set at each camera change (measured: 4–6 tiles after each of 21 cell
views, 2 after the view at "0"), the warm reads add none here, and the wrap drops only unpinned tiles holding members —
2 of 4 in the C34b shape, 0 of 54 with the camera deep. In the browser, scenario 4's dense drop has **2 tiles cached at
the press, both pinned** (`fin-m/h139`, `tilesAtPress` in all three F139 runs): nothing for the wrap to drop. By PLAN
§5.25 item 2's rule ("deleted if still none") the wrap goes; not deleted here (no source edits).

### 3.3 What headless cannot see

One line per item on the reviews' "not verified in Kobin's Chrome" lists.

| item (where listed) | measured in this pass | only Kobin's Chrome shows |
|---|---|---|
| F133, the drag's retention (§5.17 item 5) | not re-measured (B-PYRAMID-5: 1,784–1,785 MB flat, headless) | the heap with GPU-backed canvases over a long session |
| the mask rule: a pending mark masked by the erase rule in the SVG renderer (§5.17 item 5) | the `?svg` round trip's 7-erased and 8-baked: 1 px from `landed` and `pre`, the same pixel as 2-zoomout (not the mark) | the pending mark at his DPR with real pen timing |
| the crossing carry of a held path (§5.17 item 5) | never-both: `both` 0 in scenarios 1–6 on `final`; scenario 7 (a zoom under the eraser) 0 in 12 of 14 valid `final` runs, 3 and 4 composes in the other 2 | whether a held path flickers across a crossing on his compositor |
| the warm reads (§5.17 item 5) | scenario 1's back in: paper 0 on `final`, 16 unread cells drawn from stand-ins, olderUnread 0 | the back-in zoom's texture uploads and how the blur reads |
| the possible double alpha at the "drawn" shot (§5.17 item 4, §5.20 item 7) | the plain round trip's 1-drawn 0 px from `landed` and `pre`; `both` 0 | translucent ink at that moment under the GPU compositor |
| the drag writes nothing until its drop; the drag's feel (§5.19) | scenario 4's drag gesture 1,950–2,029 ms on `final` against 2,468–2,525 `landed`, the drop's worst frame 562–635 ms against 1,035–1,156 | pointer latency during a drag and the drop's pause as felt |
| "moved into": a carried kid lands under the root's lattice neighbour (§5.19 item 1) | nothing (a question of intent) | whether that is where he expects the kid |
| the inkless rule after an undo or a redo (§5.19 item 3) | nothing | whether a frame leaving the selection after an undo is what he expects |
| the 5,000-native delete, 0.53 s raster (§5.19) | not re-measured | the delete's pause on his machine |
| the five rules: the commit's patch step, the priced pack, the clip cull (§5.20) | scenario 6 (commit 82–87, exact 352 / 852 ms) and 5 (release 59, exact 61) on `final` | how an undo's first change and its exact picture feel |
| F134, the −19 plate's 2.6–2.9 s and 1.5 GB (§5.20) | scenario 1's worst frame 454–713 ms on `final` (as `landed`, 401–612); memory not measured | GPU memory under a deep zoom |
| F135, the overlap merge, doubled composes (§5.20) | `both` as above | whether a doubled translucent stroke ever shows |
| `olderUnreadMs` split out (§5.20) | olderUnread 0 in every `final` row | – (a counter) |
| scenario 7's both-composes (§5.22 item 5) | 3 and 4 composes in 2 of 14 valid `final` runs; 4 and 3 in both `landed` runs | whether those composes are visible |
| F138's four live fixes (§5.25) | scenario 4's ink identical on the three trees; the round trips 0 px | his own documents' subtree drags and deletes |
| F139 (§5.25 item 1) | §3.1 | whether a flash shows after an undo |
| the drop's settle 2.6–3.0 s (§5.25) | scenario 4's drag: the render row 513–582 ms on `final` | the drop as felt |

## 4. Anomalies

1. **Scenario 7's settled ink is not run-to-run stable on the pyramid trees.** 8 distinct hashes over 13 `final` runs
   (508,144 px in 12; 508,287 in run 4), 2 over 2 `landed` runs; `pre` gave one hash twice (708402118) — and `final`'s
   run 11 gave that same hash. Runs 11 → 12 and 11 → 13 differ by 103 and 106 px, all in the box (311,636)–(656,798): the
   anti-aliased edge of the erased hole's lower arc (`fin-m/shots/diff-B7-11-12.png`). The camera is identical in all
   three (pan 2,608.86, −2,470.18; inScale 12.1257). So the erase cut's edge moves by a sub-pixel amount from run to
   run; the eraser path's samples depending on pointer-event timing is the likely cause, not traced. Consequence:
   scenario 7's ink cannot be compared across trees by hash; the other six scenarios' can (identical everywhere).
2. **Scenario 6's exact picture came later on `final` than on `landed` in this pass**: 352 and 852 ms against 171 and
   332, the first change the same (82–87 against 77–102). `final` patched the full resolution inline (29–34 ms, T
   27.6–29.5 within 48) as B-PYRAMID-5 built it; B-PYRAMID-5 measured exact 283 against 764. After the inline patch 12
   rest strips went to the workers on both trees; `final`'s run 2 had a 270 ms IndexedDB task (the saver) in the window.
   Two runs a tree; not attributed. Worth a third look with more runs before it is called a regression.
3. **F139's cost is a 0.4–0.6 s stall, not paper** (§3.1): 384–636 ms from Ctrl+Z or Ctrl+Y to the first compose, every
   step after the first, in the shifted-camera shape, on `final` and `landed`.
4. **The `?svg` round trip**: `final` differs from both `landed` and `pre` by 18 px in 0-live (a mid-gesture shot) and by
   one grey level at one pixel in three states; `landed` and `pre` are identical. Not traced.
5. **Scenario 1's long frames**: the worst frame 454–713 ms (`Worker.onmessage`, a landing's handler) on `final`, as on
   `landed` (401–612): pre-existing, outside this pass's items; the zoom-out's paper is 0.
6. **Scenario 7's both-composes** (PLAN §5.22 item 5): on `final` in 2 of 14 valid runs (3 and 4 composes), on `landed` in 2 of
   2 (4 and 3).
7. **The pre tree's dense mode**: scenario 6 cannot run (above); scenario 3's `pre` run 2 charged 48.1 ms of paper (rAF;
   the old layer).
