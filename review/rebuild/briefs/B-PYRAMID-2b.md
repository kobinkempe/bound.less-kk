# B-PYRAMID-2b — the brief (2026-09-29, orchestrator): B-PYRAMID-2's P6

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19 on
context hygiene). **Scratch:** `<scratchpad>/bp2b/`; B-PYRAMID-2's is `<scratchpad>/bp2/` (its harness outputs under
`bp2/p5/`, its break-check copy under `bp2/bc`).

**Read, only the parts named:** `CLAUDE.md`; `review/rebuild/briefs/B-PYRAMID-2.md` (whole: the parent brief; its §5 P6
and §6 are yours, its §2–§4 the context); `review/rebuild/PLAN.md` §1.2, §1.5, §1.6, §3, §5.6–§5.9, §5.11; in
`review/rebuild/STATUS-LOG.md` B-PYRAMID-2's entries (grep `— B-PYRAMID-2 (builder)`: P0–P5, the 05:27 table) and its
report as PLAN §5.11 summarises it; `review/rebuild/A3-pyramid.md` §4.6 (the deletion list, line numbers as of
2026-09-25: grep the names), §3.4, §4.2, §6 and its dated notes; `review/rebuild/TEST-MAP.md`; the JSDoc headers of
`src/engine/raster/PicturePyramid.js`, `PyramidStore.js`, `jobQueue.js`, `prefetch.js`, and `RasterRenderer.js`'s
`_pyr*` section (grep `_pyr`).

## 1. What B-PYRAMID-2b is

P6 of B-PYRAMID-2: the old picture path deleted, the pyramid the only one; the cuts in the shared queue; the tests
ported per TEST-MAP; the pyramid's open items closed; the docs true; the harness once more.

**Done means** (preamble rule 14): `PictureLayer.js`, the old rules of `PlateStore.js`, `plate.js`'s quantum
arithmetic, the ladder, the prebake, the preview, the carry, the hold, the pending quantum, the settle machine,
`fallbackCover`, sync as a mode, the live hold and their counters, `rasterWorkerClient`'s `current`/`dropStale`/
`pruneCurrent`/the q form of `dropQueued`/`bestIndex`/`LOW_PRIO`/its `STRIPS_PER_WORKER`, `_camReadMs`'s `Infinity`
branch, the `cfg.pyramid` gate and the Dev toggle, `_renderPending`, the interim erase pool's dispatch and the dead
`markDone` option are gone — grep each name afterwards: no caller, no reader, no comment naming it as live; one
implementation each of `isPhoneBudget`, `HIDDEN_RELEASE_MS`, `PLATE_BYTES`, `COMPOSE_IMAGES`, `STRIPS_PER_WORKER`,
`LIVE_HOLD_MS`; the suites of §3 ported or deleted; the docs of §4 true; the harness table of §5 in your entry.

## 2. Items, in order, each with its checkpoint entry

1. **The cuts through the `JobQueue`** (PLAN §5.9 item 1; `eraseWorkerClient.js` and `erasePipeline.js`'s dispatch
   are yours now): `kind: "cut"` (and the descent) at `PRIO.cut` with one worker reserved (`max(1, workers − 1)`) while
   any is pending; a job the watchdog took is refused over ink (`setHandledById`, a journal reason, a count in
   `report().erase.counters`) — never run inline; a job lost to a worker error is `requeue`d once; a cut runs inline
   only when the pool is broken. The interim pool behind `submit` goes. `erase.parallel.test.js` (the B-ERASE review's
   60-seed fuzz with worker deaths, watchdog losses and respawns) must stay green with the new semantics: a
   watchdog-lost job now ends as a refusal, so port its expectations (the document equal after every op still holds:
   a refusal shows the target's ink under the mark again, A2 §5.7). Break-checks for the reservation, the refusal, the
   single requeue, the inline-only-when-broken rule.
2. **The deletions** — A3 §4.6's table and the list in §1 above, with `?pyramid=0` gone (`pyramidFromUrl`,
   `hrefWithPyramid`, `setPyramid`, the Dev panel's toggle, `cfg.pyramid` — the renderer constructs the pyramid
   unconditionally); `_renderPending` out of `erasePipeline.js` (`flushBakes` and the harness read the queue's
   report); `snapshotView` (`sceneOps.js`) through the pyramid, budgeted; the duplicates to one each. Every deleted
   counter leaves `report()` and `DevStats`; `rasterPerf`'s `MODES`/`KINDS` rows stay append-only (D19).
3. **The pyramid's open items** (PLAN §5.11 items 2–3; B-PYRAMID-2's `openItems`): the camera's read window grown
   to one view past the screen while a plane is aimed (D1's SEL cells covered and asked; a test on a 2560×1440@2
   screen); `olderMs` split into `olderPatchMs` and `olderOtherMs` in the integrals, `report()`, `DevStats` and the
   harness, with `olderOtherMs` asserted 0 by the never-older fuzz; the undo's 299 ms: find why the inline patch did
   not run in the reference pair (the estimate against `patchInlineMs`, the calibration's samples, or the group's
   re-target) and fix or explain with the numbers; the attention point set from the pointer (the last pointer or
   pinch centre, `setAttention`) so the plan's nearest-first is real; `reportBusy` passed to the prefetch; a stale rest
   cell's cover searching the mapped frame after a crossing (PLAN §5.6 item 7; scenario 1 crosses frames); the
   motion's `at` (the queue's aim) given a renderer-level break-check.
4. **The suites** per TEST-MAP and the parent brief's P6 list: `raster.nopaper` deleted; `raster.picture` deleted but
   F101 (a destroyed engine puts nothing back) and F106 (a newer stale result replaces older stale pixels — now the
   monotone-G rule) ported to `raster.pyramid`; `raster.plates` → the store's suite (L2 LRU/pins, L3 byte cap/`close()`,
   L7 dpr, L8 visibility ported; the epoch, cover and quantum rules deleted); `raster.worker` (drops by G and by
   purpose generation; the priorities; the cuts' reservation); `raster.move` (the plane's identity, pins and compose
   as ported); `raster.translucent`; `raster.phone` (the cap; P3/P4 replaced by the pen-up rectangle test);
   `raster.perf` (the sync/settle bucket rows → level/rest); `raster.snapshot` (budgeted through the pyramid);
   `raster.engine` (the list is the scene; the timing budgets stay); `raster.overlay`/`raster.ants` (G3: a level
   change repaints); `raster.liveHold` (held until its rectangle is fresh; the `LiveStrokeLayer` name waits for
   B-PYRAMID-3); `useKobinEngine.raster.test.js` (the gate without `pyramid`); `stage.cover.test.js`'s dead `markDone`
   option. TEST-MAP's fates to "done" with the date.
5. **The docs**: DESIGN §7, §9, §10, §15 (the pyramid as the one picture path; the deleted mechanisms gone from the
   text, not marked "old"); `docs/ai/10-`, `20-`, `30-`, `40-` (the memo keyed by geometry, `PACK_BUDGET`, the cut kind
   in the queue, the budgeted read); PLAN §1.2's text; A3's dated notes; `docs/OPEN-FLAGS.md`: close only what you
   measured closed, with the number (candidates F79, F106, F119, F120, F121, H1, H4, D1, D-3, D272; F65 stays open);
   `tools/docmaps/newdesc_engine.py` (done sets, `_uncutOf`, `_neutralUnder` and the deleted renderer names).
6. **The harness once more**, on a frozen copy of the tree (`git archive`, as B-PYRAMID-2 did — the shared tree's
   hot reloads swap the page's engine mid-run), `--dense --scenario all`, twice, load printed, and scenarios 1–2 at
   `levelStep=2` and `3`: the table beside P5's reference pair (the 05:27 entry) — no number worse than P5's pyramid
   column beyond the load's noise, `olderOtherMs` 0 everywhere, `olderPatchMs` reported per scenario. Then the quick
   suite, typecheck, lint, the bundles (`npm run build:worker`; md5s in the entry).

## 3. Acceptance — measured (rule 5)

The §2 item 6 table; `olderOtherMs` 0 in every scenario; the 60-seed erase fuzz green under the queue with the counts;
the break-checks of items 1 and 3 on an unimported copy (rule 13); the quick suite green but for failures you name
with their cause; typecheck 0; lint 0 errors; every name in §1's deletion list absent from `src/` (a grep in your end
entry). Nothing measured in Kobin's Chrome: say so.

## 4. Files

**Yours:** everything B-PYRAMID-2's brief §7 lists, plus `eraseWorkerClient.js` and `erasePipeline.js`'s dispatch and
`_renderPending` lines, `sceneOps.js`, `tools/docmaps/newdesc_engine.py`, the suites of §2 item 4, the docs of item 5.
**Shared with B-MODEL-C1 (running: M2–M4 in `Document.js`, `LevelMap.js`, `TileStore.js`, `placementModel.js`,
`geometry/offsets.js`, `oplog`/`persist`/`format2`/`files`, `selection.js`, `erasePipeline.js`'s frame pass box and
`.below` reads, `eraseDescent.js`/`cede.js`'s `.below` reads, the settle handling in `Stage.js` and `KobinEngine.js`,
the new `legacy/` module and `__oracles__/model-v1/`):** `KobinEngine.js`, `Stage.js`, `erasePipeline.js`,
`sceneOps.js` — re-read before every edit, keep each edit small (rule 17). **Not yours:** the rest of B-MODEL-C1's list,
`Renderer.js` (B-PYRAMID-3), `eraseRule.js`, `cede.js`, `rasterPack.js`'s mark block and `rasterCore.js`'s mask functions
(the B-ERASE review's, landed: touch them only where a deletion requires it).

**Environment:** Node 22 for jest, Node 14 for the dev server, your ports 3010–3019 (B-PYRAMID-2's server on :3011
may still be running: stop it by pid, never by name pattern); headless Chromium through the harness; the worker
bundles rebuilt after any change to `rasterCore`/`rasterPack`/`rasterJob`/`worker/`/`geometry/`. B-MODEL-C1 runs
suites for minutes at a time: check `uptime` before a harness run and print the load with every measurement. Every
commit is the orchestrator's with `[skip ci]`.

## 5. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements` (the §2 item 6 table beside P5's), `decisions`,
`leastSure` (≥ 3), `questions` with recommendations, `openItems` (B-PYRAMID-3's, the reviewer's, wave 3's).
