# R-ERASE — the review of B-ERASE (2026-09-29, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules). **Scratch:**
`<scratchpad>/r-erase/`. Fix minors inline in the files of §5; report majors with a proposed fix and its evidence.

**Read, only the parts named:** `CLAUDE.md` (the eraser line); `DESIGN.md` §7; `review/rebuild/PLAN.md` §0 (decision
3 and Kobin's drag-across sentence), §1.3, §3 row 3, §5.3, §5.7 item 1, §5.8; `review/rebuild/A2-scene.md` §4, §5, §6.2,
§6.4 (row 3's test), and its dated notes; B-ERASE's entries in `review/rebuild/STATUS-LOG.md` (grep `— B-ERASE`), its
report is summarised in PLAN §5.8; `src/engine/eraseRule.js` (69 lines, whole) and `cede.js` (50); then
`erasePipeline.js` (rewritten, ~1,300 lines: read by sections, `grep -n '^    [a-zA-Z_]*(' `), `eraseWorkerClient.js`,
the Stage's `_stepOf`, `rasterPack.js`'s mark block, `rasterCore.js`'s mask functions, the new suites
(`erase.rule`, `select.eraseBarrier`, `eraseWorkerClient`, `raster/raster.eraseRule`, `EraseChip`).

## 1. Items, in order

1. **Row 3 against the code, in a browser where it says so.** (a) the pack's bit equals an oracle from the op
   history (B-ERASE's `raster.eraseRule` seeds; extend the oracle to undo/redo mid-bake and a frame crossing);
   (b) plates kept through a bake against a fresh raster differ only within 1.5 px of a mark's edge or on a cut
   arc's outline by ≤ 16/255 — B-ERASE measured 3–6/255 inside cut boxes in node; measure the 1.5 px clause too,
   and once in headless Chromium through the harness's picture oracle; (c) the masked target looks like its cut
   pieces (a constructed stack, pixels compared before and after the bake); (d) **Kobin's case**: "if I click a
   low z-order object and drag it across a pending erase mark, will it show through the erase mark? It should."
   B-ERASE's `erase.rule` 5.1 and `raster.eraseRule`'s drag test cover it in jsdom; do it once in headless
   Chromium with the dev server (Node 14) and a Playwright script: a low object, a mark over another object, the
   low object dragged across the pending mark, screenshots showing its ink through the mark, then the bake
   landing with the dragged object uncut.
2. **The barriers' feel, measured.** On the synthetic drawing's stack (scenario 7 of `browser-check.js`, or a
   script of your own): a tap, a drag and a lasso during a pending bake — the chip shows, the gesture parks and
   completes or is cancelled by a new press; the wait in ms from the gesture to its completion, and the bake's
   own time; a parked drag "starts from the press and jumps to the finger" (A2 §5.5). Headless numbers are
   script time only (say so).
3. **Termination (PLAN §5.8 item 3).** Add the bound: a step budget per mark from its targets and their pieces,
   past which the mark's bake aborts, is reported (`report()` and the status entry) and the mark is spent; a test
   that a deliberately wrong rule (on a copy) fails loudly within the budget instead of hanging; the same for an
   inline barrier with no worker.
4. **Per-family slots and the fringe (B-ERASE's least-sure 2).** A family with one handled piece and one still
   masked under the same mark: the handled piece is masked along the cut edge's anti-aliased fringe by the
   mark's coverage — construct it, measure the differing bytes against a fresh raster in the core and once in
   the browser, and decide whether it is inside row 3 (b)'s envelope; if not, propose the fix.
5. **Parallel equals serial, harder.** B-ERASE has three seeds of shuffled arrivals from three workers. Extend
   to random op sequences with undo/redo mid-bake, a frame crossing, a cede across a frame edge (the descent
   cases), two marks over one family, and the pool's failure modes (RW-1: a worker dying mid-cut is respawned
   and the cut re-issued; the watchdog; the barrier still resolves). Fuzz on the fake pool; the counts in your
   entry.
6. **Old files and the log.** A rasteriser-branch store made by the pre-B-ERASE engine (marks without
   `targets`, done sets, neutral entries) loads, derives `targetOf`/`handledBy` once (kobin-2 derivation logged
   once), registers landed marks "at first sight" idempotently (a second sight changes nothing), and undoes;
   the version gate for the new header fields (`format2`, `persist`) against the deployed build's reader.
7. **Undo under a newer mark** (Kobin's open question): undo of an older, finished erase while a newer mark
   is pending — what the code does now (B-ERASE prunes dead marks at spend, on re-entry and at load), pinned by
   a test, and one sentence for Kobin on whether the result is what he would expect.
8. **Costs.** `erase.cost` (0 candidate scans in the bake) holds; scenario 7 on the current tree with the
   post-paint sampler and the load printed, one pair, for the record (the B-SCENE review's 36.0 s pair is the
   comparison; B-PYRAMID-2's partial re-render lands later). The ~70 s engine-level delete of 5,000 selected
   natives (PLAN §5.8 item 5): a node profile, the top frames, fixed only if one line.
9. **The deletion list.** Neutral tags, done sets, `_lowerMark`, the one-cut queue, the barrier loops, the
   float planes, `markDone`: grep for survivors and for any reader of the deleted state; `_renderPending` is
   B-PYRAMID-2's at P6 and stays.
10. **Break-checks** for every rule you add (rule 13), and a spot re-run of three of B-ERASE's on the current
    tree (the lock, the reorder buffer's serial order, inheritance at `eraseReplaceById`).
11. **Docs.** DESIGN §7 and §13 true to the code as landed; A2 §5.5's "all pieces" corrected to SM-5 (PLAN
    §5.8 item 1); OPEN-FLAGS F65's line says open until Kobin's browser; the probes (`erase.stack.probe`,
    `erase.stuck.probe`, `paper.cost.probe`) run once each with their numbers in your entry.

## 2. Files

**Yours:** `src/engine/eraseRule.js`, `cede.js`, `erasePipeline.js`, `eraseJob.js`, `eraseDescent.js`,
`eraseWorkerClient.js`, `Document.js`, `format2.js`, `persist.js`, `oplog.js`, `files.js`, `selection.js`, `frameGc.js`,
`sceneClient.js`, `report.js`, `raster/rasterPack.js` (the mark block), `raster/rasterCore.js` (the mask
functions), `raster/rasterJob.js` (`MASKS_MAX`), `Stage.js` (`_stepOf` and the Item getters only), `KobinEngine.js`
(`_initErase`, the barrier sites, the status), `Components/editor/EraseChip.js`, `hooks/useKobinEngine.js` (the
erase status only), the erase suites and probes, `__testkit__/{harness,rasterLists,clipSuite}.js`, the docs named.
`KobinEngine.js` and `Stage.js` are shared with B-PYRAMID-2 (running: P3 the MovePlane port, then P4–P6 in
`RasterRenderer.js`, `PictureLayer.js`, `PlateStore.js`, `MovePlane.js`, `rasterWorkerClient.js`, `jobQueue.js`,
`PicturePyramid.js`, `PyramidStore.js`, `level.js`, `plate.js`, the hook's raster gate and levers, the harness):
re-read before every edit, keep each edit small (rule 17); none of its files are yours; the worker bundles need
`npm run build:worker` after a change to `rasterCore`/`rasterPack`/`rasterJob`/`worker/`/`geometry/`.

**Environment:** Node 22 for jest, Node 14 for the dev server (`source /opt/nvm/nvm.sh && nvm use 14 &&
BROWSER=none CI=true PORT=<port> npm start`), ports 3020–3029 are yours; headless Chromium through
`tools/harnesses/browser-check.js` or a Playwright script of your own (`/opt/pw-browsers/chromium`). The load
average printed with every measurement. Every commit is the orchestrator's and carries `[skip ci]`.

## 3. Report (rule 11, under 60 lines)

`status`; `findings` (majors first, each with the scenario, the evidence and the proposed fix; minors fixed, each
with its test); `filesChanged`; `testsRun` with counts; `measurements` (items 1, 2, 4, 8 with numbers and where
each came from, headless or node); `leastSure` (≥ 3); `questions` with recommendations; `openItems`.
