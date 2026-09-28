# B-MODEL-C1 — the brief (2026-09-28, orchestrator)

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (all 19 rules).
**Scratch:** `<scratchpad>/bm1/`.

**Read, in this order, only the parts named:** `CLAUDE.md`; `DESIGN.md` §2, §3, §8 (Moving) and §13 (Persistence);
`review/rebuild/PLAN.md` §0 (decision 9 in Kobin's words), §1.7, §3, §4, §5.2, and any later §5.x that names
B-MODEL; `review/rebuild/A1-document-model.md` §0, §1, §2, §4.1, §4.4 (C1 in full; C2–C4 to know what is not
yours), §5 (step 0 and step 1), §6, §8, §9, §13 E3; `src/engine/placementModel.js` (whole: 119 lines — the contract
B-SCENE built, whose bodies you replace); in `review/rebuild/STATUS-LOG.md` the end entries of B-FOUNDATION,
B-SCENE-2 and B-ERASE and the B-SCENE review's entries (grep `^## `, read those only); `docs/OPEN-FLAGS.md` for the
flags named below (grep each id).

## 1. What B-MODEL-C1 is

A1 §4.4's **C1 — a frame's shift is placement, composed on read** — A1 §5 step 1, as PLAN §1.7 and §5.2 adopted it:

- **One composition:** a native's picture table = its own table with its home frame's shift added at k = 0, without
  a carry; `placementModel.placement`, `nativesIn` and `displaced` compose it and are pure (no settle, no merge, no
  mint on read). The Stage does not change (A1 §6; B-SCENE built the Stage to the contract).
- **Two readers honour the home-depth carry:** `objShift` at k0 = 0 names `F0 = neighbour(F, −carry)` (the native
  itself when F0 is its home); `residual` returns the carry in whole frames beside the remainder (today 0.75 W
  comes back as −0.25 W). Pieces of F0 are taken with their numbers as they are, never mapped by W.
- **The reroute covers every displaced picture:** natives of a shifted frame form one group per frame (membership
  by home, not an id set); natives with their own tables group by (home, composed table); views above the home
  are rerouted too (drop `TileStore`'s skip of them).
- **Newcomers cancel the shift:** a stroke drawn in a shifted frame, or a cede kid homed in one, takes −shift in its
  own k = 0 entry; a cut piece keeps its source's table; a promoted native composes its old frame's shift one level
  down.
- **Boxes follow the shift:** a frame's own natives lie within its cell ± REACH translated by its shift; the lasso's
  enclosure, the erase's frame pass, `_selTable`'s frame box and the Stage's `frameFootprint` use the union of the
  two boxes (closes H6).
- **Deleted:** `_settleIfPending` and its call sites; `unsettle` (kept only as a legacy inverse, §4 below);
  `_frameOwner`, `noteFrameOwner`; `settled` on `moveFrames` entries; `oplog._onSettle`, `_ownerSeq`, the settle
  drain (decode kept for replay); `TileStore._bakeSettled`, `_rebakes`; `_followCarries`, `_flushCarried`,
  `_carried`, `_carriedLater`, `_dropping`; the unsettles in `_dragFrames` and `_restoreFrames`; F116's
  foreign-shift settle; the settle subscription in `KobinEngine`; the Stage's `settle: true` handling and the
  re-entry loop in its `sync` that B-SCENE-2 kept for the settles a read raised (no read raises one now); the
  `carry: true` flag if nothing sets it. Grep each name before and after: a deleted mechanism has no caller left.
- **The first item, before C1's edits:** B-FOUNDATION found that `LevelMap.ensureId` returns null for a bare spine
  id (`"2"`) on a lattice without it, so natives under it load undrawn — F67's "a load mints any frame its natives
  name" is false there. Fix it in `LevelMap`/`files.js` so a load mints a missing spine frame, with a test
  (`files.js`'s `_mintNamedFrames` path, a `dev-0` snapshot whose natives name `"2"` on a fresh lattice, drawn after
  the load), and say in your entry whether the deployed file format can carry such a file (A1 §5's versions).

**Not this build:** C2 (membership at the drop, `_normalizeHome`, the op-driven selection repair — B-DRAG's), C3
(co-residents, no merges, a deleted subtree leaving the lattice), C4 (private frames for cede kids). Where C1
meets them, the seam is named in your entry, not built.

**Done means** (preamble rule 14): the settle, the carry and the follow machinery are gone, not bypassed; the
composition is the one place placement is computed; the equivalence checks of §3 pass at the counts stated; the
version-3 gate is in; the lint holds; the docs are true.

## 2. Order of work, with checkpoints

Each checkpoint: a STATUS-LOG entry under 25 lines ending `WHERE I AM: <the next concrete edit>`; the orchestrator
snapshot-commits the tree at M1, M3 and the end.

- **M0 — the frozen oracle.** Copy today's `Document.js`, `LevelMap.js`, `TileStore.js`, `selection.js`, `oplog.js`
  and what they import that changes under C1 into `src/engine/__oracles__/model-v1/` (as `KobinEngineV0` was; read
  `__oracles__/README.md` and add a paragraph), imports rewritten so the copy is self-contained; a `README` line
  with the commit it was frozen at. Production never imports it (preamble rule 8; a test asserts it, as for the
  others). Then the `ensureId` first item (§1).
- **M1 — the composition, beside the settle.** The three bodies in `placementModel.js` composed from the frame's
  shift and the native's own table; `objShift`/`residual` honouring the home-depth carry; the reroute grouping by
  home; the readers of §1's box rule switched. With the settle still running the composition sees a zero shift, so
  the app is identical at this point (A1 §5 step 1) — measure it: the tile fuzz of §3 green against the oracle,
  and the round trip of the harness pixel-identical. Checkpoint.
- **M2 — the settle removed.** The deletion list of §1; newcomers cancel the shift; the legacy module of §4; old
  stores replay (§4). The tile fuzz again, now with shifts live. Checkpoint.
- **M3 — the version-3 gate and the lint.** `persist.js` writes version 3 only when the lattice carries a shift (a
  co-resident or a private frame later, C3/C4); a version-2 reader (the deployed build, before 4c99a8a) refuses it
  with its "saved by a newer version" message rather than dropping the shift; files without a shift are written as
  today, byte-identical (a test). The lint that forbids `.below` reads outside the model (§5). Checkpoint.
- **M4 — tests ported or deleted per A1 §8; docs.** DESIGN §8 and §13, `docs/ai/20-`/`30-`/`40-`, PLAN §1.7, TEST-MAP
  (a new section for the model suites), A1's dated notes where building changed the design, OPEN-FLAGS (F78, F93,
  F94, F100, F107, F108, F110, F116, F126, H6, F67 — close only what you measured closed, with the number; the ones
  C2–C4 close stay open with a note). The quick suite, typecheck, lint. The end entry and the report.

## 3. Acceptance — measured (preamble rule 5)

- **The tile fuzz, bit for bit** (`model.equivalence.probe.js`, PLAN §3 row 9): both engines fed one seeded random
  op sequence (draw, erase at depth, per-object drag, subtree drag, undo, redo, delete, save and reload), and after
  every op the up and down tiles of the camera frame, its parent, a ring neighbour and a child baked in both;
  every derived piece equal bit for bit for every native whose home is the same; a native the oracle carried
  compared through its mapped picture — to the bit at and below the home, within one ulp above it (A1 E3: 716 of
  720 with full-mantissa coordinates, 480 of 480 at and below the home). State the seeds, the op counts and the
  piece counts. A `*.probe.js` so it survives (PLAN §3's last line).
- **The selection's ink** (`select.stands.probe.js`, row 7): the same sequences with lassos, ctrl-taps, drags, undo,
  redo, delete and cuts; after every op the selection's ink equals the oracle's and the ink it was made with,
  mapped through cuts to pieces; no inkless frame. Under C1 drags still write per event; the property must hold
  now and after C2.
- **No read mutates** (`model.pureRead.test.js`, row 8): `doc.rev`, `offRev`, `addrEpoch` and the lattice's frame
  set unchanged across `listFor` (if still present), `content`, `read`, a lasso, a hit test, the Stage's pack and
  a snapshot, over the fuzz's states.
- **The composition** (`model.compose.test.js`): the carry case (0.75 W → F0 one cell over, rem −0.25 W); the live
  native; newcomer cancellation; a promoted native; registration per object vs subtree (`move.subtree.test.js` t2
  kept); the box union (H6's case: a native with its own table under an enclosed frame judged where drawn).
- **Stores** (`hooks/store.model.test.js`): a rasteriser-branch store made by the oracle engine (pending shifts,
  settle and merge entries, `moveFrames` with `settled`) loads to the oracle's picture and undoes; version 3 written
  only when needed; a version-2 reader refuses it; a shift-free file byte-identical to today's.
- **Counters** (measure, do not gate): settles per drag event before and after (0 after); the harness's scenario 3
  (pan) and 4 (lasso + drag) with the final frame's pixels compared against the pre-C1 tree served from a worktree
  (`git worktree add <scratch>/bm1/before <launch commit>`; Node 14 dev servers on ports 3030–3039), pixel-identical
  expected, the load average printed.
- **Break-checks** (rule 13) for each rule: the composition's carry, newcomer cancellation, the box union, the
  version gate, the lint, the purity — each removed once on an unimported copy, the red count recorded.
- The quick suite green but for failures you name with their cause; typecheck 0; lint 0 errors; the worker bundles
  rebuilt if a bundle input changed (`geometry/`, `rasterCore`/`rasterPack`/`rasterJob`, `worker/`), md5s in the
  entry.

## 4. Decisions already made — do not reopen

- PLAN §5.2 in full: Q3 the −shift entry for new ink; Q5 version 3 when the lattice carries a shift; Q6 the legacy
  inverses (`unsettle`, the settle replay, later the merge inverses) in one quarantined module —
  `src/engine/legacy/modelV1.js` — with a deletion date in its header (the undo window is 200 ops; Kobin's stores
  compact past them) and a test that no production path outside replay imports it; Q7 the frozen copy under
  `__oracles__/model-v1/`; Q10 the order (C1 alone, now; C2 inside B-DRAG; then C3, C4); Q11 legacy ceded kids stay.
- Kobin's decision 9: "a frame is just a collection of objects and frames, which is written at a location — the
  frame is not defined as its location". His open questions (Q1 "moved into", Q2 the second parent pointer) are
  C2's; do not build for either reading.
- The Stage reads membership and placement through `placementModel` and nothing else (A1 §6); if you find a Stage
  read of `o.below`, `f.shift`, `o._home` or `doc.at`, route it through the model and say so — that is the one kind
  of Stage edit you make.
- A3's integer crossing map is untouched: the lattice's coordinates do not change.

## 5. The lint

An eslint rule (`no-restricted-syntax` on `MemberExpression[property.name="below"]`, or the existing layering
rule's mechanism if it fits) forbidding `.below` outside `placementModel.js`, `Document.js`, `LevelMap.js`,
`geometry/offsets.js`, the legacy module, `__oracles__/` and the tests; today's readers outside those (`report.js`
7, `Stage.js` 6, `sceneClient.js` 5, `selection.js` 4, `format2.js` 4, `erasePipeline.js` 4, `eraseDescent.js` 4,
`KobinEngine.js` 4, `overlays.js` 3, `cede.js` 3, `persist.js` 2, `oplog.js` 2, `TileStore.js` 1, and
`raster/PictureLayer.js` 3 until B-PYRAMID-2 deletes it), and the B-SCENE review's row-5 survivors (PLAN §5.7 item 3:
`sceneClient.js:312/349/351/359/514`, the erase contact and descent code at `overlays.js:454`, `erasePipeline.js:973`,
`eraseDescent.js:195–204`, the memo keys at `erasePipeline.js:432`, `overlays.js:609`, `report.js:558`, and `listFor`'s
stamping — line numbers as of 2026-09-28), are routed through the model or allowed by a one-line comment naming why (serialisation and the oplog's decode are legitimate: they store the table, not read
placement). Lint 0 errors at the end.

## 6. Files

**Yours:** `src/engine/Document.js`, `LevelMap.js`, `TileStore.js`, `placementModel.js`, `geometry/offsets.js`,
`oplog.js`, `persist.js`, `format2.js`, `files.js`, `frameGc.js`, `sceneClient.js`, `report.js`, `overlays.js`
(`_selTable`'s frame box only), `selection.js` (the enclosure box and the `.below` reads only), `erasePipeline.js`
(the frame pass's box only) and `eraseDescent.js`/`cede.js` (the `.below` reads only) — **after B-ERASE and its
review have ended**, which the orchestrator confirms at launch; `Stage.js` (§4's one kind of edit and the settle
handling only); `KobinEngine.js` (the settle subscription, the footprints' box only — a shared file with
B-PYRAMID-2: re-read before every edit, keep each edit small, rule 17); the new `legacy/modelV1.js`,
`__oracles__/model-v1/`, the new suites of §3, the move/select suites per A1 §8; `.eslintrc*`; the docs of §2 M4.

**Not yours:** `src/engine/raster/*` (B-PYRAMID-2), `Renderer.js` (B-PYRAMID-3), the erase rule and pipeline beyond
the lines named, `eraseWorkerClient.js`, `hooks/` (except the store test), `tools/harnesses/` (run it; do not edit
it — ask if a flag is missing).

## 7. Report (preamble rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun` with counts, `measurements` (the §3 numbers), `decisions` with why,
`leastSure` (at least three), `questions` each with your recommendation, `openItems` (every line C2, C3, C4 or
B-DRAG needs from your tree, and any Stage read you routed).
