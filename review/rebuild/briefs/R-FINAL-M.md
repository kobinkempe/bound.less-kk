# R-FINAL-M — the final design check's measurements (2026-10-06, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19 above all: usage
windows are short, so keep your context small — read by grep and line ranges, filter every run's output). **Scratch:**
`<scratchpad>/fin-m/`. **Ports:** 3060–3069. **No source edits**: this is a measurement pass on a frozen tree; a defect
you find is reported with its evidence, not fixed.

**Read, only these:** `CLAUDE.md`; `tools/harnesses/browser-check.js`'s header (lines 1–60) and its `SCENARIOS`; A3 §9.3
(the dense drawing); PLAN §5.17 item 5, §5.19, §5.20, §5.22, §5.25 and §5.26 (what each build measured and left for this
check); OPEN-FLAGS F137 and F139.

## The trees

`final` = the tree the orchestrator names at launch (B-PYRAMID-5 landed), as a `git archive` copy. Against it:
`landed` = 59f0a76 (C3/C4 landed, before this round's fixes) and `pre` = 56e36b3 (the tree the rebuild started from).
If the harness's dense mode cannot run on `pre`, say what fails and use the earliest commit it runs on (name it).

## 1. The scenarios, all seven, and the round trips

Headless Chromium through the harness: `--dense --scenario <n>` for 1–7 (zoomout, slowzoom, pan, drag, penup, undo,
erase), two runs per tree, interleaved across trees, each run started under load 2 with no other browser running
(match browsers by process name: `pgrep -x "chrome|headless_shell"`; a `pgrep -f` pattern matches its own shell). Then
the plain round trip (the default mode) and the `?svg` round trip, once per tree. Record the load at each run's start
and end.

Per scenario and tree: the gesture's time, the worst frame and the long tasks, `paperMs` (and the sampled and
post-paint variants), `olderPatchMs` / `olderUnreadMs` / `olderOtherMs`, blur, the ink hashes and pixel counts after
each gesture (identical across trees where the scenario's result should be), and scenario 4's drop row (`ovl.tail`,
`eng.list`, the ant decisions). A table per scenario: `final` against `landed` and `pre`.

**Scenario 7 and F140** (a queue pumped after the camera's last moving step could stall: the erase never baked in 1 run
of 10 before B-PYRAMID-6's fix, PLAN §5.26 item 2): on `final`, scenario 7 ten times (each under load 2, no other
browser); every run's `eraseBakeMs` and the queue's state if one does not bake. A stall in any run is the finding. Also
every run's view strips dropped as `offscreen` after the wheel stops (the velocity rule aims from the time since the
last step, PLAN §5.27 item 1).

## 2. Three measurements the reviews left for this check

1. **F139**: an undo (and a redo) with a subtree-dragged frame's ink in view, on `final`: does the first render after it
   show paper? Frames forgotten and re-minted, tile bakes and plate drops per step. A scripted page evaluation is
   fine; say exactly what it did.
2. **The drop's `setBatch` wrap** (PLAN §5.25 item 2): with and without it, with a fuller tile cache than R-MODEL-C34b's
   (it measured 211–387 ms with, 209–385 without, 2 of 4 cached tiles dropped). In jsdom on copies is fine.
3. **What headless cannot see**: for each item on the reviews' "not verified in Kobin's Chrome" lists (PLAN §5.17 item
   5, §5.19, §5.20, §5.25), one line — what this pass measured of it, and what only Kobin's Chrome can show.

## 3. Output

`review/rebuild/FINAL-MEASUREMENTS.md` (new): the trees and their hashes, the method, the tables, the three
measurements, the list in 2.3, and the anomalies with evidence. STATUS-LOG entries at start, at each batch (announce a
browser batch before starting it), and at the end — heading `## <date> UTC — R-FINAL-M (reviewer) — <what>`, each ending
`WHERE I AM:`. Your report (rule 11, under 50 lines). Commit nothing; kill only your own pids.

Beside you: **R-FINAL-D** (the design audit: docs only) and **B-DOCMAPS-3** (`tools/docmaps/` only). Neither runs a
browser.
