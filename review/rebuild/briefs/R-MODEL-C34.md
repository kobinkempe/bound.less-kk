# R-MODEL-C34 — the review of C3 and C4, with F138's fixes (2026-10-04, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19). **Scratch:**
`<scratchpad>/r-c34/`. **Leave given:** build the fixes of item 1 (model defects and comparison gaps), each with a
red-before test; any other major is reported with a proposed fix and its evidence; minors fixed inline.

**Scope, per Kobin (short, the highest-value items first; hand back within about 3 hours of your start).** C3 and C4 were
landed by the orchestrator after the builder stopped at the weekly limit, without a review (PLAN §5.23). The tests and
the break-checks are green; the 200-seed fuzz is not (OPEN-FLAGS F138). Item 1 is the job; items 2–4 are short.

**Read, only the parts named:** `CLAUDE.md`; PLAN §1.7, §3 rows 7–9, §5.16, §5.19, §5.21, §5.23; `briefs/B-MODEL-C34.md`
§1 (what C3/C4 are, done-means); A1 §4.4 C3 and C4, §8, §16 (as built); OPEN-FLAGS F138 (whole), F80, F94, F107, F108;
DESIGN §7 (the descent), §8 (co-residents), §10 (the lasso), §13 (the version gate); STATUS-LOG entries from
`— B-MODEL-C34` and the orchestrator's 2026-10-04 entries; then the code as you need it: `LevelMap.js` (`_take`,
`_regroup`, `_joinGroups`, `_linkKids`/`_splitKids`, `cellFrames`/`residentOf`/`sameCell`, `privateFrame`,
`restoreFrame`, `removeSubtree`, `forget`, `ensureId`, `objShift`), `Document.js` (`cellList`, `removeFrameSubtree`,
`insertFrameSubtree`, `detachFrames`, `dropFrames`), `oplog.js` (replay, `aside`), `eraseDescent.js` (`kidHome`),
`TileStore.js` (`prepare`, `want`, `_rerouteGroups`), `KobinEngine.js` (`_prepareView`, `_camToLattice`, `_camToResident`),
`frameGc.js`, `persist.js`, `legacy/modelV1.js`, `__testkit__/modelFuzz.js` (`runPairFuzz`, `reloadStore`,
`comparePictures`, `pictureAt`).

## 1. F138: classify every difference, then fix

The tile fuzz `model.equivalence.probe.js` at `MODEL_SEEDS=200 MODEL_C34_SEEDS=200` (7 minutes) differs from the frozen
oracle in 11 walks; the selection fuzz `select.stands.probe.js` at `SELECT_SEEDS=50 SELECT_C34_SEEDS=50` in one. F138's
table lists them. In this order: the three new with C3c/C4 (plain 131; C3/C4 lane 47, 198), then the eight already on
the C3b tree (C3/C4 lane 29, 49, 51, 70, 87, 140, 193, 194), then selection seed 34 (C3/C4 lane).

- **Reproduce alone**: `MODEL_FIRST=<s> MODEL_SEEDS=1 MODEL_C34_SEEDS=0` (plain) or `MODEL_SEEDS=0 MODEL_C34_SEEDS=1`
  (C3/C4 lane). The orchestrator's trace probe for seed 131 is `<scratchpad>/fin/zz_dbg131.probe.js.keep` (a per-step
  timeline of one native's home and the co-resident frames; copy it under `src/engine/` to run, delete it after).
- **Classify each**: (a) a live-model defect (ink missing, misplaced, doubled, a native homed in a frame the lattice
  lacks, a selection that does not stand for its ink); (b) a comparison gap for a designed difference (a co-resident where
  the oracle merged, a private frame where it ceded into a shared one — DESIGN §8/§10; the comparison is by place and must
  absorb these, A1 §16); (c) a fault shared with the oracle that the fuzz only now exposes (seed 131's replay brings an
  undone cede back in BOTH engines: decide whether the app's real store path does it — the saver's per-frame rows and
  seqs for a frame emptied and GC'd, `hooks/` and `oplog.js` — and say so with a test either way).
- **Fix**: a model defect with a minimal deterministic red-before test in the suite that owns the rule (not only the
  fuzz); a comparison gap in `modelFuzz.js` with a one-line note naming the designed difference (the frozen oracle
  module stays untouched); a shared fault per (c). Seed 131's live half is known: the resurrected native is homed under a
  private frame id that GC freed and a later frame took. Retiring a private id at GC alone did not change the result
  (the orchestrator tried and reverted it) — the replay's add into a missing frame is the other half.
- **Bound**: a seed whose cause you have not found in about 20 minutes is recorded with what you learned, and you move on.
- **Done**: both fuzzes at those sizes green, or each remaining difference named with its class and evidence; F138
  updated (closed if green), PLAN §5.24 is the orchestrator's.

## 2. The review, short

The orchestrator's landing already ran the break-checks (nine rules, each red: PLAN §5.23 item 4; script
`<scratchpad>/fin/breaks.py`, copy `fin/bc`). Read, do not repeat. Check by reading, each a few lines in the report:
the co-resident invariant ("the frames at one cell are one group, and their parents one group") holds after a
re-address, a restore, a GC promotion and a subtree delete; no read mints (`model.pureRead`) with `_prepareView`'s key
complete (a change that needs a mint and does not move the key: name it or show none exists); `_camToLattice` and
`_camToResident` cannot leave the camera in a frame the lattice lacks; the legacy loader still replays a store with
`mergeFrame` entries. The jsdom list build's tile bakes 10–25 % slower on the raster path (A1 §16): one profile, the
cause named, a fix only if bounded.

## 3. Measurement, once, at the end

The two fuzzes at the sizes above; `model.pureRead`; the quick suite; `npm run test:erase`; typecheck 0; lint 0 errors;
`npm run build:worker` if `eraseDescent`/`geometry/` changed (md5s). Headless Chromium only if a fix changes what is
drawn: scenario 4 and the plain round trip against the landed tree 59f0a76 (frozen copies, ports 3030–3039, the load
printed). Nothing in Kobin's Chrome: say so.

## 4. Files

Yours: `LevelMap.js`, `Document.js`, `oplog.js`, `format2.js`, `persist.js`, `placementModel.js`, `TileStore.js` (the
model readers and `prepare`), `frameGc.js`, `selection.js`, `eraseDescent.js`, `erasePipeline.js` (`_cellOffset`, the
descent's dispatch), `cede.js`, `legacy/modelV1.js`, `hooks/` (the saver, only if item 1(c) needs it), the model, move,
select, erase and store suites and probes, `__testkit__/modelFuzz.js`, A1 §16, DESIGN §7/§8/§10/§13, OPEN-FLAGS F138
and the model flags, TEST-MAP's model rows. **B-PYRAMID-5 (a builder) runs beside you** in the raster modules,
`RasterRenderer.js`, the raster suites, `stage.cover.test.js` and the harness: none of those are yours. `KobinEngine.js`
is shared: re-read before every edit, small edits (rule 17). The STATUS-LOG is the coordination: announce a browser batch
before you start one; start it only under load 2. Every commit is the orchestrator's with `[skip ci]`; you commit nothing.

## 5. Report (rule 11, under 60 lines)

`status`; `findings` (each F138 seed: its class, cause and fix or why not; then the review's majors and minors);
`filesChanged`; `testsRun`; `measurements`; `leastSure` (≥ 3); `questions` with recommendations; `openItems`.
