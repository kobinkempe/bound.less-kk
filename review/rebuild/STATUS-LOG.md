# Rebuild status log

Append-only. One entry per start, checkpoint, half hour of work, and end. Heading
`## <date> — <agent> — <task>`; then **Working on**, **Measured**, **Decisions made**,
**Questions asked**. Keep it short: the next agent reads this first.

## 2026-09-25 — orchestrator (Fable) — wave 1 launched
**Working on:** Kobin's decisions recorded in `PLAN.md` §0; the cloud preamble; the agent
definitions (`.claude/agents/opus-analyst.md`, `opus-builder.md`, `opus-reviewer.md`, copies under
`review/rebuild/agents/`); analyses A1 (document model), A2 (scene + generation + erase rule) and
A3 (pyramid + rest render + queue + Dev levers + MovePlane port + SVG demotion) launched read-only.
**Measured:** the baseline from `review/RENDERER-REBUILD-2026-09-25.md` §6 (typecheck 0, lint 0,
quick suite 2,061/2,062 on Node 14, the headless harness round trip pixel-identical).
**Decisions made:** the erase rule takes targets-at-pen-up plus `handledBy` (Kobin's drag-across
semantics); MovePlane stays with five layers and the pre-render; selection stays frame-based and the
container/lattice untangling is its own step.
**Questions asked:** none open.

## 2026-09-25 — A1 (analyst) — the document model: container and lattice untangled — start
**Working on:** reading the brief's documents (PLAN §0.9/§1.7, DESIGN §1–3/8/10/13, the frame-lattice
bible §10 first, SUBTREE-O1-PLAN, EARTH-MOVE-ANALYSIS, the three reviews' named sections), then the
code inventory. Read-only; the only files I write are `review/rebuild/A1-document-model.md` and my
entries here.
**Measured:** nothing yet.
**Decisions made:** none yet.
**Questions asked:** none yet.

## 2026-09-25 — A3 (analyst) — the pyramid, rest render, partial re-render, queue, Dev levers, MovePlane port, SVG demotion — start
**Working on:** reading the brief's documents (PLAN §1.2/§1.4–§1.6, DESIGN §9, PAPER-PLAN §3/§7/§9/§10,
RASTERISER-PLAN §2.7/§6, the three reviews' named sections, RENDERER-REBUILD §3.3/§3.7/§4.4/§6), then the
raster code inventory. Read-only; the only files I write are `review/rebuild/A3-pyramid.md` and my entries
here. I will read `review/rebuild/A2-scene.md` when it exists for the scene/tile-budget interface.
**Measured:** nothing yet.
**Decisions made:** none yet.
**Questions asked:** none yet.

## 2026-09-25 23:25 UTC — A2 (analyst) — the scene, the generation model, the erase rule — start
**Working on:** reading the preamble, PLAN (all), DESIGN §7–§10, the three reviews' named sections and
the rebuild analysis §2/§3.2/§3.5/§4, then the code (KobinEngine list/render/plates, TileStore,
Document events and step graph, the erase pipeline and worker, the raster pack/core/renderer,
selection, overlays, offsets, the oplog/files/persist format). Read-only; the only files I write are
`review/rebuild/A2-scene.md` and my entries here.
**Measured:** nothing yet.
**Decisions made:** none yet.
**Questions asked:** none yet.

## 2026-09-25 23:45 UTC — A2 (analyst) — scene / generation / erase rule — checkpoint 1
**Working on:** read the preamble, PLAN, DESIGN §7–§10, the named review sections, and the code
(`KobinEngine` list/render/drain/hold, `TileStore` whole, `Document` events/step graph/replace/cede,
`erasePipeline` whole, `eraseJob`/`eraseDescent`/worker clients, `PlateStore`, `rasterPack` prepass
and marks, `rasterCore` masks, `RasterRenderer` pack/results/plane/live hold, `MovePlane`,
`selection`, `overlays` ants, `offsets`, `oplog`/`format2`/`files`). Next: a jsdom node experiment
(listFor rebuild vs an incremental sorted table), then the document.
**Measured:** nothing yet.
**Decisions made (provisional):** per-native `targetOf`/`handledBy` fields (restored by reference on
undo, inherited at mint) with `targets` on the mark for load-time derivation; targets recorded when
the mark resolves, with the z rule standing in until then (equal pixels); erase steps under their
mark classified by the scene as pixel-neutral from the pure rule (no global neutral flag).
**Questions asked:** none yet.

## 2026-09-25 — A1 (analyst) — document model — checkpoint (~30 min)
**Working on:** the code inventory is read (LevelMap, Document, TileStore, selection, erasePipeline,
eraseDescent, frameGc, files/persist/format2/oplog, sceneClient, overlays, KobinEngine's drop/drain);
now weighing the options and running node experiments. Files: only `review/rebuild/A1-document-model.md`
(not yet written) and this log; scratch under the session scratchpad `a1/`.
**Measured:** node + jsdom census on a synthetic 25-frame subtree (R at D+1, 6 kids, 18 grandkids,
50 natives each), 40-step drags rendered each step: the subtree path minted 183–290 frames during the
drag (GC left 8–13), re-parented 4–16 of 24 descendants away from R by digit carries, and the selection
ended as 4–12 frames; with prior k=0 tables on the natives (as on the Earth, `[-49152,-49152]`) the
settles carried 443–1,511 natives per drag and `_followCarries` fired 19–77 times. The per-object path:
~1,205–1,250 re-home events per pointer event for 1,250 natives and 1,313–1,573 frames minted per drag.
**Decisions made:** none final. Leaning: no engine re-bucketing of natives (shift composed on read,
per-object re-home once at the drop), frames keep identity (no merges), cede kids in private frames.
**Questions asked:** none yet.

## 2026-09-25 23:55 UTC — A3 (analyst) — pyramid et al. — progress
**Working on:** the reading is done (PLAN, DESIGN §9, PAPER-PLAN §3/§7/§9/§10, RASTERISER-PLAN §2.7/§6, the
reviews' named sections, and the code: PictureLayer, PlateStore, RasterRenderer, MovePlane, the client,
rasterCore/Pack/Job, the worker, Renderer, KobinEngine's render/ladder/prebake/pan/zoom, the hook's input and
status wiring, CanvasEditor's Dev panel, TileStore's budgeted read, thumbnails, the harness). Now node experiments
in the scratchpad; the document `review/rebuild/A3-pyramid.md` next.
**Measured:** (E2) the cross-frame plate map by integer digits equals `LevelMap.frameFactor`/`mapPointF`'s affine to
the bit on 3,036 plate corners over paths of ≤ 3 frame steps and S ∈ {1,2,3}; at 4 steps the float affine itself
rounds (plate indices ~2^43), so the property test must use short paths or BigInt. With levels numbered finer =
larger, the parent frame's same picture is level **l + 12/S**, not l − 12/S (PLAN §1.2's sign). (E3) plates a view
needs: desktop 2256×1218 max 40 at S=1; symmetric stretch at S=3 needs 135 (layer 142 MB); a bounded-minification
rule keeps 40 at every S. (E1, running) a clip box that restricts rows and blends only inside the clip, x unfolded,
reproduced the shipped core's plate byte for byte in 288 of 288 clips; folding x at the clip's edge differs by one
alpha step in 2–6 bytes per 72 clips.
**Decisions made:** none binding; the document will recommend the unfolded clip and the bounded stretch.
**Questions asked:** none yet (they go in the document).

## 2026-09-26 00:02 UTC — A3 (analyst) — pyramid et al. — checkpoint (experiments done, writing)
**Working on:** writing `review/rebuild/A3-pyramid.md` (only that file and this log; scratch under `scratchpad/a3/`).
**Measured:** (E1, final) the clip box with rows restricted and x unfolded: 0 differing bytes in 960 clips of
150-item plates (opaque and transparent, occlusion cull on and off, masks, arcs, union bands), 0 bytes touched
outside the clip; folding x at the clip edge: 129 bytes differ by 1–2 in 960 clips. (E1c, node) a 64² clip costs
0.13–1.4 ms on fill content against 5–27 ms for the whole plate, but 33 ms on 60 stroke bands (the union pass
scales with the clip's rows). (E6, headless Chromium 141, SwiftShader) the image cliff IS visible headless: the JS
time of one compose steps from 0.1 ms at 33 distinct 512² bitmaps to 26 ms at 34 scaled (6 ms unscaled), 52 ms at
80; the partial merge (OffscreenCanvas drawImage + putImageData(dirty rect) + transferToImageBitmap) is correct and
costs 0.5 ms median, 6.3 max.
**Decisions made:** recommending the unfolded clip (bit-identical), the GPU merge for landing a patch, a bounded
stretch for S > 1, freshness before resolution in the lookup.
**Questions asked:** in the document (§13).

## 2026-09-26 00:02 UTC — A2 (analyst) — scene / generation / erase rule — checkpoint 2
**Working on:** the design is settled in outline; writing `review/rebuild/A2-scene.md` now. Read
TEST-MAP.md and A1's/A3's log entries for the seams (A1 leans to no re-bucketing and a shift composed
on read: the scene's placement is the adapter that absorbs it).
**Measured** (node 22 + jsdom, synthetic rect shapes; scripts `scratchpad/a2/exp1`, `exp2`): `listFor`
warm 0.4 ms at 2k items, 2.7 ms at 25k, 7.8 ms at 25k with 10k moved, 16.8 ms at 45k with 20k moved;
the pack's family prepass on each new list 24–39 ms (cold 110–198); a chunked z-sorted table (256
per chunk) replaces one item by three in 24–26 us at 25k–45k items (a whole-array merge 0.6–1.1 ms,
splice 1.5–3.4 ms); the mark's candidate scan over a quarter-view mark 20 ms (10.5k candidates) to
131 ms (45k natives, 20k moved).
**Decisions made:** incremental table (the per-generation list is cheap; the per-list prepass is not);
dirt from native footprints with the old state carried by the event (no `_footBelow`); tracked plate
keys hold `dirtySince`; erase steps under their mark are neutral by the pure rule (`by` + dust boxes),
not by a mode flag; mask overflow merges slots, never white ink; joint cuts deferred.
**Questions asked:** none yet (they go in the document).

## 2026-09-26 — A1 (analyst) — document model — checkpoint (~1 h 15 min)
**Working on:** writing `review/rebuild/A1-document-model.md` (the only file I edit besides this log).
**Measured:** (1) `LevelMap.objShift` and `offsets.residual` drop a whole-frame carry at the home depth
(0.75 W comes back as −0.25 W with F0 unchanged; one level down the carry is honoured) — the one place
"compose the frame shift on read" needs a fix. (2) Settled-and-carried (today) vs composed-on-read
placement after a 30-step subtree drag, 240 natives with prior k=0 tables (76 of them carried today):
integer coordinates 720/720 bit-identical; full-mantissa coordinates 716/720, the 4 all at the parent
view for carried natives, worst 5.7e-14 units (one ulp); at and below the home level 480/480. (3) A
per-level cell index over 42,857 synthetic natives: 44,128 home-level entries (1.6 MB) or 308,537 with
every coarser level (9.1 MB) — the real analogue, the scene index grid, is 318,431 entries.
**Decisions made:** recommend (c): the frame shift is placement composed on read (no settle, no carry);
membership changes only at a user action's end (per-object re-home once at the drop, no signed-depth
tables — old builds refuse or silently drop k<0 entries); frames keep identity (co-residents, no merges;
a deleted frame leaves the lattice); cede kids in private co-resident frames. Why: 9 of the 11 move
flags trace to a role conflict, and C1 is measured picture-neutral.
**Questions asked:** none yet (they go in the document).

## 2026-09-26 00:15 UTC — A3 (analyst) — pyramid et al. — done
**Working on:** finished `review/rebuild/A3-pyramid.md` (~1,190 lines): the pyramid data model and the
compose plan, the cross-frame map, the rest render, partial re-render and pen-up, the queue and the budget
with the deletion list, input coalescing and W1, the MovePlane port, the SVG demotion, the Dev levers,
measurement, migration, tests, risks, effort (≈ 23 agent-days), leastSure and 16 questions. Reconciled with
A2's §0–§2 (read at 00:12; its §3 not yet written). No source edited; no jest suite run.
**Measured:** E1 (clip box, rows restricted, x unfolded): 0 differing bytes in 960/960 clips + 288/288, 0 bytes
outside the clip in 1,248; x folded: 129 bytes differ. E1c: clip cost follows rows on stroke bands (64² = 33 of
404 ms). E2: integer cross-frame map = LevelMap's affine on 3,036 corners (paths ≤ 3). E3: bounded stretch keeps
40 plates at S = 1–3 on the desktop (symmetric: 77/135). E6 (headless Chromium): the 33→34 image step is visible
(0.1 → 26 ms scaled); the GPU merge of a patch is correct, 0.5 ms median.
**Decisions made:** recommend the unfolded clip, the GPU merge, a bounded stretch, freshness-before-resolution
with patches over dirty rects, a quiet period for worker rest renders, keep the rest set through a pan, the
pen-up group commit, engine-side coalescing, localStorage+URL levers; adopted A2's picture-preserving cut in
place of my `visual` flag.
**Questions asked:** 16 (A3-pyramid.md §13); PLAN-text changes: Q1 (ℓ + 12/S, not − ), Q2, Q3, Q4, Q5; asks of
A2: Q7 (pending until the shape bake), Q15 (family routing footprint).

## 2026-09-26 — A1 (analyst) — document model — done
**Working on:** finished `review/rebuild/A1-document-model.md` (723 lines). Files touched: that
document and this log only; no source, docs or tools file. Scratch scripts under the session
scratchpad `a1/` (census, objShift, compose, cell-index experiments; how to rerun in the doc's §13).
**Measured:** see the checkpoint above (census; the home-depth carry dropped by `objShift`/`residual`;
composed-on-read placement 716/720 bit-identical, 4 one ulp apart at the parent view; per-level cell
index 44,128 / 308,537 entries on 42,857 synthetic natives). Also counted: 22 picture-side reads of
`o.below` in 8 files, 13 engine modules calling the lattice by frame id.
**Decisions made:** recommend option (c) in four steps — C1 the frame shift is placement composed on
read (no settle, no carry); C2 membership changes only at a user action's end (one write at the drop,
`_normalizeHome` gone, the selection repaired from the op); C3 frames keep identity (co-residents, no
merges, a deleted subtree leaves the lattice); C4 cede kids in private frames. Confidence 0.75 / 0.75 /
0.65 / 0.55. Rejected: (a) a container field per native (keeps settles and merges, adds two indexes);
(b)'s never-re-home for per-object moves (negative-depth tables the deployed build refuses or drops;
the O(1) lasso degrades). §6 aligns the contract with A2's `placed`/`placeNative`/reroute names; A3's
`mapCell` needs nothing (no frame offsets).
**Questions asked:** eleven, each with a recommendation, in the doc's §12 (Q1 re-home at the drop vs
never; Q2 op repair vs a second parent pointer; Q3 newcomer cancellation; Q4 C4 now; Q5 version 3;
Q6 legacy inverses; Q7 frozen oracle; Q8 co-residents as selection units; Q9 delete leaves the
lattice; Q10 order; Q11 legacy kids stay).

## 2026-09-26 00:26 UTC — A2 (analyst) — scene / generation / erase rule — checkpoint 3
**Working on:** `review/rebuild/A2-scene.md` is written end to end (§0–§9, appendix A, ~1,550 lines);
now proofreading every `file:line` against the tree and aligning with what landed meanwhile: A3's
design adopted (PLAN §1.2/§1.5 rewritten, §5.1's answers — Q7 pending items to the shape bake, Q12
TileStore's partial read, Q15 family-level dirt are B-SCENE's) and A1 §6's `PlacementModel` contract.
**Measured:** exp3 — a plain walk of the chunked table 0.3–1.6 ms at 45k–100k items; the rule plus a box
test for 3 marks over every item 1.5–4.7 ms (a pack evaluates only its strip's items).
**Decisions made:** adopted PLAN §5.1 Q7 (a new mark is unlanded until its shape bake; registration and
the frames pass ride that commit; no "unresolved" rule — readers that need the mask flush perimeters
first), Q12, Q15 (the family rule computed with the pack's own functions, measured before kept), A1's
`PlacementModel` as the only placement read, A3's one pool with the `submit` contract (an interim erase
pool only if B-ERASE lands first).
**Questions asked:** 15, in the document's §9 (Q1 name `Stage`; Q2 neutral steps; Q3 no white ink; Q4
defer joint cuts; Q5 pool order; Q6 async barriers; Q10 registration at the shape landing …).

## 2026-09-26 00:35 UTC — B-FOUNDATION (builder) — clip box, level.js, input coalescing + ScaleHud, Dev levers, harness — start
**Proposal.** *Approach:* five deliverables in the brief's order, each green (typecheck 0, lint 0, every
touched suite alone) before the next. (1) A3's `make-clip-core.py` "rows" variant transcribed into
`rasterCore.js`: the clip is module state set by `renderPlate(…, clip)` and reset in a `finally`;
`job.clips` on the wire (validated; the result echoes it; a clipped plate serialises only its rectangle,
`createImageBitmap(img, x0, y0, w, h)` or `copyPlate(rgba, clip)`); `rasterCore.clip.test.js` is E1 as a
test, the merge through the wire, and golden hashes of whole plates taken from the unmodified core for
"byte-identical to today"; a break-check per rule on an unimported copy. (2) `level.js`, pure; BigInt only
where a sum leaves 2^53; the seven-step test. (3) `cfg.frames`, "sync" by default; in "raf" the four entry
points mutate and request a frame, `_frame()` runs the deferred half once, `flush()` runs it now, a press or
release flushes first; `PictureLayer._flush` calls an injected `onArrive`; `onZoom`; `<ScaleHud>` owns the
session, the picker and the write-back. (4) Lever fields in `DEFAULTS`, setters that only store, a small
storage module (localStorage + URL override), panel controls, `<DevStats>` on its own timer. (5) `--dense`,
`--scenario`, `synth-drawing.js`, the rAF paper sampler, frameMeter deltas, two compose counters, baseline.
*Decisions (confidence):* clip as module state, A3's form (0.9); union bands start at the clip's rows as in
A3's measured reference (0.7, Q1); byte-identity by goldens from the pre-change core (0.8); `mapCell(lm, S, A,
ℓ, i, j, B)` and `coarser(lm, S, F, ℓ, i, j, k)` take the lattice and the step explicitly (0.75); in "raf" a
pointer down/up, undo and redo flush the pending frame first so a drop sees the last pointer (0.8); the scale
session reset is derived from `scaleDef`'s identity inside `<ScaleHud>` (0.7); levers in localStorage key
`bl.devLevers`, URL wins, setters store only (0.85); synthetic frame ids literally as A3 §9.3 names them (0.6).
*Questions (recommendation):* Q1 the union pass inside a clip restarts its band at the clip's top, so an
edge crossing it gets x from that start (equal to an ulp; a byte moves only on a float32 rounding
coincidence; E1: 0 in 1,248) — keep A3's rule and state the exception, or reference the whole render's band
start? **Keep, measure; switch if a seed shows a byte.** Q2 `pinchUpdate` ignores its pan's crossing today
(only the zoom's triggers a render) — **keep that parity in "raf", flag it.** Q3 A3 §9.3 lists `"1/1,0"`,
`"1/-1,1"` under depth 1, but those ids are depth-2 children of `"1"` — **use the ids as written.** Q4
`maxImagesPerCompose` as a high-water mark cannot be differenced per gesture — **high-water in
`pictureStats`, plus a per-gesture max from an in-page wrap in the harness.** Q5 add `level.js` to
`npm run typecheck`? **Yes if it types clean with a structural lattice type.**
**Working on:** reading done (preamble, CLAUDE.md, PLAN §0–§5, A3 in full, TEST-MAP, A3's `a3/core` scripts,
the code). Files I edit: `raster/rasterCore.js`, `rasterJob.js`, `worker/rasterWorker.js`, new
`raster/rasterCore.clip.test.js`, `raster/level.js`, `raster/level.crossmap.test.js`; `KobinEngine.js` (frame
loop + `panBy`, `zoomFactorAt`, `pinchUpdate`, the drag's pointer move); `PictureLayer.js` (`_flush` and the
compose counters only); `hooks/useKobinEngine.js`; `Pages/CanvasEditor.js`; new `Components/editor/ScaleHud.js`,
`DevStats.js`; `tools/harnesses/`; DESIGN §9, `docs/ai/40-CALL-FLOW.txt`, the harness README.
**Measured:** baseline typecheck 0 errors; lint 0 errors, 6 warnings; worker bundles before any edit: erase
`a1fafca3d543d5a447fff295498d274a`, raster `13c28c877cbbef91c275cbc7edc7dd6a`, scene `dce304b81ac598a67b8aa15c2daa2d93`.
**Decisions made:** as the proposal.
**Questions asked:** Q1–Q5 above; continuing past them.

## 2026-09-26 00:34 UTC — A2 (analyst) — scene / generation / erase rule — done
**Working on:** finished. `review/rebuild/A2-scene.md` (1,627 lines): the `Stage` API and its event table,
freshness by G with the interface A3 builds on (§3.4), the erase rule end to end, Kobin's cases traced,
deletions with `file:line`, the migration (S1–S3, E1–E5), rows 1/2/3/5/7 as tests, seams with A1 and A3,
7 least-sure items, 15 questions (numbered A2-Q1…Q15). No file outside `review/rebuild/A2-scene.md` and
this log was written; experiments in the scratchpad `a2/`.
**Measured:** exp4 (node + jsdom, the raster engine, K4's flow on real resolved strokes, 8 seeds): plates kept
through an in-order bake's neutral steps differ from a fresh raster in 86–500 pixels a case — up to 11–57/255
within 1.5 px of the eraser's edge, at most 3–13/255 elsewhere on outlines up to 64 px away (0–28 pixels outside
the mark's box); no target or piece used the union pass, so the far part is the 1/16 px arc re-flattening, not a
routing flip. `raster.mask.test.js` run alone: 5/5 (K4's 0 bytes holds for axis-aligned fills).
**Decisions made:** the neutral classification stays (it is today's behaviour, measured), with row 3 (b)'s
envelope as its gate; everything else as checkpoint 3.
**Questions asked:** A2-Q1…A2-Q15 in the document's §9.

## 2026-09-26 — orchestrator (Fable) — wave 1 read; wave 2 launched
**Working on:** A1, A2 and A3 read in full; their 42 questions answered in PLAN §5.1–§5.3; PLAN §1.1,
§1.2, §1.3, §1.5, §1.7 rewritten to the three designs. B-FOUNDATION (clip box, `level.js`, input
coalescing + ScaleHud, Dev levers, harness) running since 00:35 UTC; B-SCENE (A2 §6.2 S1–S3, with A1's
contract as an adapter) launched now. B-PYRAMID starts from B-SCENE's S2 checkpoint once B-FOUNDATION has
landed; B-ERASE after S3; B-MODEL-C1 after B-SCENE.
**Measured:** nothing new; the baseline is RENDERER-REBUILD §6.
**Decisions made:** A2-Q2 changed — an applied cut step dirties `box(mark) ∩ box(target)` ∪ dust (a clip
re-render), not nothing; A2-Q3 merge never white ink; A2-Q6 asynchronous barriers; A2-Q10 targets at the
shape landing; A1 Q1 re-home at the drop; A1 Q2 the op repair; A3 Q2 the bounded stretch band; A3 Q5
freshness-first lookup with the patch rule.
**Questions asked:** to Kobin (non-blocking): "moved into" membership; the same group after a re-parenting
(A1 Q2); an undone older erase under a newer mark (A2-Q9).

## 2026-09-26 00:55 UTC — B-SCENE (builder) — the Stage, freshness by G, the default flip (A2 §6.2 S1–S3) — start
**Proposal.** *Approach:* S1 first, no behaviour change. `placementModel.js` is A1 §6's four functions over
today's calls (`nativesIn` = `doc.at`, `placement` = `_rerouteGroups`' own `place` rule on `objShift`/`residual`,
`displaced` = `TileStore._rerouteGroups`, `frameFootprint` = the cell ± REACH rule of `_cellFootIn`), plus
`toStored`/`fromStored` over the `*Obj` functions, so nothing else reads `below`. `Stage.js` keeps a chunked
list sorted by `(zKey, id, tile i, tile j, dir, seq)` — within one native the order `listFor` gives — with
`byId`/`bySrc`/`byPiece`/`byHome`, fed by `TileStore.onTile` (every write to `cache` and `tile.objs` reports)
and by its own document subscription after TileStore's. Handlers never bake: a tile they cannot read is
listed missing and read at the next `sync`; events raised inside `sync` are queued and applied at its end.
Reroute groups are re-placed per named native at the end of each commit, and re-diffed against `displaced`
on a frame event or a lattice change. The engine calls `stage.sync(frame, _listWin(), Infinity)` in
`_render` after `_buildList` (S1's only engine lines). Tests: `stage.equiv` (5×40, probe 60×80) on the
SVG engine, `stage.placed` (BigInt reference), and the no-read-mutates property. S2: `PlateStore` keyed with
G per plate, `track`/`untrack`/`dirtySince`/`dirtyRects` in the Stage, footprints from the events, the
family rule measured, `hold`/`release`, the pack's source behind `cfg.scene`; the wire and the engine's
drain/hold deletions wait for B-FOUNDATION's end entry. S3 as the brief lists.
*Decisions (confidence):* item getters read z/editId/erase from the live native (0.8); tile hook + id index
in TileStore (0.85); reroute re-placed per native, diffed on frame events (0.7); `read(F, rect, budgetMs,
{pin})` with `Infinity` unbounded and `0` cache-only (0.75); the Stage lives in both renderer modes (0.8);
hard drops refuse their in-flight jobs by a flag on the in-flight record, not an epoch (0.8); the job's G
is a header scalar on the wire (0.85).
*Questions (recommendation):* Q1 "no read changes the document": `listFor`/`content` of a cold or shifted
frame settles and mints today (`Document.at`, `objShift`) — **assert it strictly for the Stage's reads,
a hit test and a lasso after a sync; count and report the cold-read mutations until C1 makes them 0.**
Q2 A2's rule 1 caches a stale result where nothing is cached (today it is discarded: paper) — **follow A2
(stale before paper), except a job a hard drop refused.** Q3 with the Stage as the pack source the pen-up
band is no longer packed (pending until the shape), so the held live path must go on `plate.G ≥ Gs`, not
on `cellFresh` — **do that in S2 (A2 §3.3's last row), replacing `_plateShows`.** Q4 `frameFootprint`
of a frame or an old address → `{frame: parent, rect}` in the parent's units (a root: everywhere) —
**recommend.** Q5 `keysChanged` emits `rekey` outside `_emit`'s `offRev` bump (one bump there rebuilds
the whole reroute memo: 166 ms on the Magnum Opus) — **recommend.**
**Working on:** S1. Files: new `src/engine/Stage.js`, `src/engine/placementModel.js`, tests
`src/engine/stage.*.test.js`/`.probe.js`; `TileStore.js` (hook, id index, `read`), `Document.js` (event
fields, `rekey`), `frameGc.js` (the Stage told), and in `KobinEngine.js` only the constructor and `_render`
lines (re-read before each edit).
**Measured:** nothing yet.
**Decisions made:** as the proposal.
**Questions asked:** Q1–Q5 above; continuing past them.

## 2026-09-26 01:18 UTC — B-FOUNDATION (builder) — checkpoint 1: the clip box and `level.js` green
**Working on:** deliverables 1 and 2 done; starting 3 (input coalescing + `<ScaleHud>`). Files so far:
`raster/rasterCore.js` (clip box), `rasterJob.js` (`job.clips`, `copyPlate(rgba, clip)`, `pastePatch`, result `clips`,
`resultBytes`), `worker/rasterWorker.js` (renders and serialises each plate's clip), `rasterPack.js` (F132, below),
new `__testkit__/rasterLists.js`, `raster/rasterCore.clip.test.js`, `raster/level.js`, `raster/level.crossmap.test.js`.
B-SCENE is in `KobinEngine.js` (constructor/`destroy`/`_render`); my edits there stay in the frame loop and the
entry points, re-read before each edit.
**Measured:** (1) with no clip the core is byte-identical to 4e09269's: 24 whole plates (4 configurations × 6
seeded 50-item lists) hash to goldens taken from that core (SHA-1, computed from a copy of it, `goldens-sha.json`).
Inside the clip `===` the whole plate and outside untouched in 144 random clips + 36 edge clips + the crafted
cull/prune/mark cases: 0 bytes differ (Q1's band-start ulp never showed). The merge through `runJob` + `job.clips`
+ `pastePatch` (typed-array copy) equals the new whole plate in every trial (≥ 6 non-vacuous per configuration,
remove/add/move/recolour, opaque, backdrop cull on/off, transparent). `rasterCore.clip.test.js` 18/18 in 23 s
(jest is ~4× slower than node on the core: 40–220 ms a plate). All 28 raster suites 608/608; `chordMath`,
`useKobinEngine.raster` 9/9; typecheck 0; eslint clean on the touched files. Bundles after `build:worker`: erase
`a1fafca3d543d5a447fff295498d274a` (unchanged), raster `e865ee425ff99f220b34dbc2d571f008`, scene
`dce304b81ac598a67b8aa15c2daa2d93` (unchanged). **Break-checks** (unimported copy of the app under
`scratchpad/bf/bc`, `breakcheck.py`; red of 18): paper over the clip 7; un-premultiply over the clip 3; rows above
not deposited 8; rows below not walked 9; the resolve's sum from ROWMIN 12; the mask's 4; the family prune 5; its
2 px growth 1; the cull's candidate over the clip 1; its fill test over the clip 1; the candidate deposited over
the clip's rows 6; family rows ∩ clip 6; the covered family's rows 1; a bad clip throws 1; the clip reset 13;
runJob renders the clip 1; serialises its rectangle 5; the result carries the clips 5; validateJob 1;
resultBytes 1; F132 6. **Zero red, by nature:** the early return of an edge outside the clip's rows, the arc prune
by the clip's rows and the mask written inside the clip only are cost rules, and timed against copies without
them (`costrules.py`, node, medians of 7, three plates × three clips) none moves the time beyond noise; the walk
of x from the edge's own start (A3's bit-exactness by construction) against an analytic jump to the clip's top:
0 bytes differ on those plates too, so no test here can see it — kept because it is exact by construction.
(2) `level.crossmap.test.js` 8/8: 2,802 pairs of ≤ 3 crossings on a 400-frame random lattice (a subtree
re-addressed half way), `mapCell` = the exact BigInt affine in all; `LevelMap.mapRectF`'s floats equal it to the
bit in 2,739 and round in 63 — every one an index past 2^53 (BigInt), none elsewhere; 198 coarse refusals; the
round trip; step 6's refusals where the affine is half a plate off; step 7 after `readdress`.
**Found and fixed: F132** — `rasterPack.famTake` (a family reused from an earlier list with the same prepass key)
dropped the pack's `offset` from the items' residuals while keeping it in their boxes, so a Scenes picture
re-rendered after an edit (`snapshotView`, which packs with an offset) drew its unchanged families one offset
away, off the plate. One helper (`withOffset`) now serves `famFill` and `famTake`; a test in the clip suite.
**Decisions made:** the clip as module state reset in a `finally` (A3's form); union bands start at the clip's
rows as A3 measured (Q1 stands: 0 bytes in every clip here); `pastePatch` beside `copyPlate` as the one jsdom
merge; `level.js` takes the lattice and S explicitly, `{ level, i, j }` with BigInt only past 2^53, no BigInt
literals (CRA 4's webpack and the es2019 worker bundles reject `1n`); not added to `npm run typecheck` (Q5 open).
**Questions asked:** Q1–Q5 of the start entry stand; new: Q6 the clip suite runs 23 s in the quick suite — keep,
or move the random part to a `.slow` twin? Recommend keep (four suites already run 20–70 s).

## 2026-09-28 04:10 UTC — orchestrator (Fable) — resumed after the weekly usage limit
**Working on:** the session stopped on 2026-09-26 when Kobin's weekly limit hit, with B-FOUNDATION
starting its harness deliverable and B-SCENE about to run S1's suites. The container kept the tree and
both transcripts; the uncommitted work was committed as a snapshot (717cd85) and both builders were
resumed by message with the same briefs and coordination rules. The custom agent definitions
(`opus-builder`, `opus-reviewer`, `opus-analyst`, effort max / xhigh) loaded at this session start and
are used for every launch from here (B-PYRAMID, B-ERASE, B-MODEL, the reviewers).
**Measured:** nothing new.
**Decisions made:** B-SCENE's proposal questions Q1–Q5 answered yes as recommended (strict no-mutation
for the Stage's reads with cold-read mutations counted; stale before paper except a refused job;
`plate.G ≥ Gs` for the live hold in S2; `frameFootprint` as `{frame: parent, rect}`; `rekey` outside the
`offRev` bump).
**Questions asked:** none.

## 2026-09-28 04:10 UTC — B-SCENE (builder) — resumed after the usage-limit stop (S1 near done)
**Working on:** S1's remainder: `stage.placed.test.js` (row 5), the covering suites, typecheck and lint; then S2.
S1 as it stands (snapshot 717cd85): `placementModel.js` (A1 §6's `nativesIn`/`placement`/`displaced` +
`frameFootprint`, and `toStored`/`fromStored`/`footprint` over the `*Obj` functions); `TileStore.js` — `onTile`
(bake/append/remove/drop/clear from every write to the cache or a tile's `objs`), the id → tile-keys index in place
of `_removeObject`'s whole-cache scan, `peek`, `read(F, rect, budgetMs)`/`readTiles` (Infinity unbounded, 0 cache
only, misses listed), `setCameraPins`, `tilesOf`; `Document.js` — `oldBelow` on every offsets-only change,
`settle: true` on `_settleIfPending`/`unsettle`/`applySettle`, `carry: true` on their re-homes, `keysChanged(ids)`
emitting `rekey` outside `_emit` (callers in `Document`, `erasePipeline._resplitFamily`, `oplog` replay);
`Stage.js` (the chunked table, `byId`/`byKey`/`byPiece`/`byHome`, `Item` getters, G, commits and `batch`,
`changesSince`, `pending`, `covers`, `snapshot`, `placed`/`placeNative`, reroute groups re-placed per native and
re-diffed on frame events or a lattice change, events queued inside `sync`); `KobinEngine.js` — only the
constructor, `destroy` and one line in `_render`; `frameGc.js` — the Stage told. Tests: `stage.equiv.test.js`
(5 × 40), `stage.equiv.probe.js` (60 × 80), `__testkit__/stageFuzz.js`.
**Measured (09-26, before the stop):** the fuzz, 200 seeds × 80 steps: 0 differences in 16,000 checks (266 needed a
sync first: steps with no render); the lasso changed the document in 5 states (counted, Q1). 60 × 80 with the zoom
kept near the ink: rerouted items in 470, tile pieces in 2,020, pending natives in 396, marks in 890 of 4,800
checks. Faults put in on a scratch run: no `append` caught in 4 of 20 seeds, no `remove` 11/20, no per-native
re-placement 20/20, no re-diff on frame events 4/20, a stale paint key 3/20. Suites: tile/Document/LevelMap/oplog/
frame.gc/reroute.memo 126 pass; move/select/erase non-slow 261 pass (`move.twin` 387 s; 406 s on a HEAD copy).
**Decisions made:** the orchestrator's answers to Q1–Q5 (all as recommended) are what S1/S2 build.
**Questions asked:** none new. B-FOUNDATION's end entry is not in yet: `KobinEngine.js` (beyond my three spots),
`rasterJob.js` and `rasterWorker.js` wait.

## 2026-09-28 04:10 UTC — B-FOUNDATION (builder) — resumed after the usage-limit stop
**Working on:** the tree is the orchestrator's snapshot 717cd85. Done before the stop: (1) the clip box and
`job.clips` (checkpoint 1); (2) `level.js`; (3) input coalescing — `cfg.frames` "sync" by default, "raf" from the
hook; in `KobinEngine.js` the functions changed are `panBy`, `zoomFactorAt` (their consequences split out verbatim
as `_panStep` / `_zoomStep`), the drag's and the pen's branches of `_pointerMove`, a flush at the top of
`_pointerDown` / `_pointerUp`, the new `_pend` / `_frame` / `flush` / `onZoom`, `_emit`'s zoom notification, the
DEFAULTS fields, the constructor's option line and its last line, `destroy`'s timer line, the lever setters;
`pinchUpdate` is unchanged (it reaches `zoomFactorAt`); `PictureLayer._flush` defers to the frame, `compose` counts
`composeMs` / `maxImagesPerCompose`; `<ScaleHud>` owns the session, the picker and the write-back; the page's
`onStatus` is a plain 100 ms throttle; the scale dialog reads the camera; `useKobinEngine.frames.test.js` 7/7;
(4) the Dev levers — `engine/devLevers.js` (ranges, per-device defaults, one validator, localStorage + URL
override), `setLevers` / `setLevelStep` / `setPlateBudget`, the panel's `DevLevers` and `<DevStats>`;
`useKobinEngine.levers.test.js` 4/4; `src/hooks/`, `src/Pages/`, `scaleBar/` 24 suites 177/177 and the engine
suites the brief names green (one `raster.engine` rule-2 timing test failed once beside six other suites and passed
alone: 44/44). Left: (5) the harness — `synth-drawing.js` and `browser-check.js --dense/--scenario/--query` are
written, not yet run; the baseline; the docs (DESIGN §9, `docs/ai/40-CALL-FLOW.txt`, the harness README); the
re-check of the tree; the end entry and the report.
**Measured:** nothing new yet.
**Decisions made:** none new.
**Questions asked:** none new; Q1–Q6 stand.

## 2026-09-28 04:45 UTC — B-SCENE (builder) — S1 done; S2's Stage, store and renderer halves in (the engine switch waits)
**Working on:** S1 is done: `stage.placed.test.js` (row 5) added and green; the covering suites, typecheck and
lint run (below). S2 so far, all outside `KobinEngine.js`/`rasterJob.js`/`rasterWorker.js`: `Stage.js` gains
footprints from the events (A2 §2.8's table; an erase step under its mark dirties its footprint inside the mark's
box only, PLAN §5.3 A2-Q2), `track`/`untrack`/`dirtySince`/`dirtyRects` with a global dirt log (a list older than
a change is judged by it), batch unions per native (earliest before, latest after; past 256 per (home, table),
then one box), frame footprints through `model.frameFootprint`, `onCommit(G, {frames, drop, reset})` for the
plates a re-address or a reset removes, the family rule (Q15, below), `hold`/`release`, `touch`, `landedAt`.
`PlateStore` takes a freshness source (`fresh`, the Stage): plates keyed with `G`, rule 1 in `put`, rule 2
`isExact`, cells tracked from `beginJob`/`put` and untracked when neither stored nor in flight, hard drops refuse
their in-flight jobs by a flag. `RasterRenderer` packs at a G (`_genOf`: the list's G, the scene's at pack time),
refuses at dispatch a plate a newer change touched than its list saw and (scene on) one the table does not cover,
and releases a pen-up path on `plate.G ≥ Gs` (Q3). `PictureLayer` reads exactness through the store; `packJob`
carries `G`. Both rules live in the store and the renderer until the switch — the engine still builds a
`PlateStore` without `fresh`, so the app and the suites run the epochs; the switch (the engine's constructor,
the drain, `_footBelow`, the hold, `listFor`'s mark snapshot, and the wire's `G`) deletes the epoch half with
their suites, after B-FOUNDATION's end entry. New tests: `stage.fresh.test.js` (6 seeds × 400 steps) with
`__testkit__/stageFresh.js` and `stage.fresh.probe.js` (200 × 400). Files this entry: `Stage.js`,
`raster/PlateStore.js`, `raster/RasterRenderer.js` (`render`, `syncCameraOnly`, `_packNow`, `_stillWanted`,
`_takeResult`, `_endJob`, `_postNow`, `_postPlane`, `_farList`, `prebakePlates`, `_releaseHeldLive`,
`_liveCellsComing`, new `_sceneList`/`_packList`/`_genOf`/`_packable`/`_noteShown`/`_shownFrom`/`_plateShowsG`),
`raster/PictureLayer.js` (`cellFresh`, `_isStale`, `_take`'s misses, `_noteStale`, new `_missOf`),
`raster/rasterPack.js` (new `familyTraits`, `G` on the job).
**Measured:** row 5: 120 natives (4 seeds × 30), all in the table, 812 vertices, 61 rerouted items: worst
placed vertex 9.4e-12 of the frame's units (1e-9 bound), `toStored` back 3.5e-12. Q15 (node, the pack and core as
shipped, 40 constructed families, one plate): the routing flipped in 15; in all 15 the family's untouched pieces
changed — median 462 px, max 771 px, up to 38/255 — so the family rule stays (a flip dirties the family's box).
Row 1 (Stage half), 200 seeds × 400 steps: 0 violations in 715,314 plate checks (498,167 exact; 13,857, 1.9%,
stale where the oracle saw no change: the conservative reach and family rules); 4,402 results refused by hard
drops. Equivalence fuzz after the S2 rewrite: 60 × 80, 0 differences. Suites: raster 29 + stage 3 = 631/631;
the S1 set (Document, LevelMap, oplog, tile.*, reroute.memo, frame.gc, erase.* non-slow, move.*, select.*,
hooks) 57 suites, 473 pass, 4 skipped; typecheck 0; lint 0 errors (6 warnings, the baseline's).
**Decisions made:** the oracle of row 1 takes each native's state at the commit's first sight and its end, and
counts it only if they differ (a state that lived inside one commit is on no plate); window-change family flips
dirty too (a pan that brings a family's pieces in can flip its routing, and plates on both sides must agree);
the renderer's `_jobG` map carries a job's G to its arrival until the wire does (`rasterJob.js`, after
B-FOUNDATION).
**Questions asked:** none new.

## 2026-09-28 04:45 UTC — B-FOUNDATION (builder) — done
**Working on:** all five deliverables built, the docs corrected; nothing committed. Files since the resumed entry:
`hooks/useKobinEngine.js` (the three lever setters through one `leverSetter`), `hooks/useKobinEngine.frames.test.js`
(three zooming frames inside the throttle: the HUD hears each, the page renders once), `tools/harnesses/
browser-check.js` and `synth-drawing.js` (run; fixed below), DESIGN §9 (two sentences), `docs/ai/10-STATUS.txt`,
`30-CODE-MAP.txt`, `40-CALL-FLOW.txt`, the harness README, A3 §9.3 (a dated correction), TEST-MAP (four rows).
In `KobinEngine.js` my functions only: `panBy`, `zoomFactorAt` (their consequences moved verbatim into `_panStep` /
`_zoomStep`), `_pointerMove`'s drag and pen branches, a flush at the top of `_pointerDown` / `_pointerUp`, the new
`_pend` / `_frame` / `flush` / `onZoom`, `_emit`, the lever setters, DEFAULTS, the constructor's option line and last
line, `destroy`'s timer line. B-SCENE is in RasterRenderer/PlateStore/PictureLayer/rasterPack now; its mid-edit state
turned six hook suites red for one run (`_noteShown` called before it existed); re-run alone they pass 42/42.
**Measured:** typecheck 0; lint 0 errors, 6 warnings (the baseline's). Suites: `src/engine/raster/` + `chordMath`
30/30 suites, 620 tests; hooks, Pages, scaleBar, `KobinEngine.*`, `select.*`, `move.*` 49 suites, 423 passed + 2
skipped (with the six re-run); new: `rasterCore.clip` 18, `level.crossmap` 8, `useKobinEngine.frames` 7,
`useKobinEngine.levers` 4. Bundles: erase `a1fafca3d543d5a447fff295498d274a`, raster `e865ee425ff99f220b34dbc2d571f008`,
scene `dce304b81ac598a67b8aa15c2daa2d93`. Break-checks of deliverables 2–4 (`breakcheck2.py`, unimported copy; red of
the suite): mapCell's S∤12 1/8, its coarse floor 2/8, the BigInt path 2/8, the down step's level 2/8, `coarser`'s step
into the parent 1/8, `levelFor`'s hysteresis 1/8; a raf pan waits 1/7, a raf zoom 3/7, the frame carries a crossing
1/7, the release flushes 1/7, the drag waits 1/7, the pen's SVG update waits 1/7, the arrival defers 1/7, `onZoom`
1/7, the page takes raf 1/7, no zoom bypass in the throttle 1/7; the URL wins 2/4, a lever is validated 1/4, a change
is stored 1/4. The round-trip harness under "raf": 25,244 ink px before and after, same hash; the HUD's label
followed the zoom (1/27.86× on the screenshot).
**The harness baseline — today's code** (`browser-check.js --dense`, seed 1, headless Chromium 141 SwiftShader,
1280×800 @1, 3 workers, `?dev`; 3,414 objects: "0" 1,814, "1" 1,000, "2" 400, "1/1,0" 100, "1/-1,1" 100; setup a page
49–72 s: `flushBakes` 39–45 s, the loaded mark's bake 5–19 s; one run each):
| scenario | gesture | paper ms (max share) | frames > 50 ms | long (worst ms) | composes: n, ms, max images | plates posted |
|---|---|---|---|---|---|---|
| 1 zoom-out, 90 × +250 meant at 25 ms, "2" → "0" | 43.8 s | 3,247 (75 %) | 129 of 275 | 120 (563) | 158, 223, 29 | 861 |
| 1 back in | 29.0 s | 0 | 126 of 223 | 99 (938) | 105, 165, 29 | 720 |
| 2 slow zoom, 40 × +250 at 120 ms, "1" → "0" | 13.5 s | 1,449 (63 %) | 23 of 332 | 27 (2,459) | 56, 31, 13 | 59 |
| 3 pan, 60 × (25, 8) at 16 ms (`panBy`) | 2.3 s | 28 (8 %) | 7 of 99 | 12 (614) | 68, 9.5, 12 | 19 |
| 4 lasso (840 × 560 px ellipse, 45 selected) | 2.5 s | 0 | 5 of 103 | 5 (762) | 1 | 55 |
| 4 drag, 40 steps at 16 ms | 4.4 s | 0 | 9 of 114 | 10 (2,385) | 46, 12.1, **33** | 66 |
| 5 translucent pen-up | 10.6 s | 0 | 7 of 231 | 21 (2,072) | 52, 5.8 | 18 |
| 6 Ctrl+Z of it | 0.4 s | 0 | 1 of 43 | 1 (309) | 3, 0.3, 8 | 2 |
| 7 eraser across the stack, then 30 zoom ticks while it bakes | 18.6 s | 0 | 50 of 259 | 54 (848) | 61, 56, 22 | 260 |
Pen-up: the live path released 5 ms after pen-up (a sync view), no stale plate after 9.26 s; undo exact after 44 ms;
the eraser's mark spent 16.9 s after pen-up, its 30 ticks (meant 0.75 s) took 8.1 s, 54 of 96 plates stale after.
Today's layer carries no `paperMs`/`blurMs`/`olderMs` (paper from the sampler; blur and older n/a) and the pool no
per-priority job counts. The drag's compose drew 33 images, at the cliff (A3 E6).
**Decisions made:** harness: a fresh page a scenario; gestures wait for the pen (`readOnly`); scenario 3 through
`panBy` (1,500 px do not fit a 1,280 px drag); scenario 7 zooms after pen-up (a zoom under the pen ends the stroke)
and waits for `_eraseCommits` to empty; the synthetic snapshot lists the spine in its `crossings`; the most images per
gesture from an in-page wrap of `layer.compose` beside the shipped high-water counters. Found: `LevelMap.ensureId`
returns null for a bare spine id ("2") on a lattice without it, so natives under it load undrawn (F67's "a load mints
any frame its natives name" is not true there) — suggested as its own task, not fixed (the lattice is B-MODEL's).
**Questions asked:** Q1 union band start (keep A3's; 0 bytes everywhere measured); Q2 `pinchUpdate` ignores its
pan's crossing, as today (keep; flag); Q5 `level.js` into typecheck (later, with a structural lattice type); Q6 the
clip suite's 23 s (keep); Q7 the `ensureId` spine gap (a small task before B-MODEL); Q8 today's drag compose
reaches 33 images — B-PYRAMID's image budget should count the plane with the base.

## 2026-09-28 05:05 UTC — orchestrator (Fable) — B-FOUNDATION read and committed; its review launched
**Working on:** read the diff of B-FOUNDATION's files since 0e90872 (the frame loop, the wire, the pack's
F132 fix, `level.js`, the hook, the levers, the HUD, DevStats, the core's clip rules); committed as 4e8ce80
with B-SCENE's interleaved S1/S2 edits noted as unreviewed; the review pass (`opus-reviewer`, xhigh)
launched with seven items, pressing on the union pass's band start inside a clip and on a frame that both
pans and zooms. B-SCENE continues; B-PYRAMID waits for its S2 checkpoint entry.
**Measured:** B-FOUNDATION's baseline of today's renderer on the synthetic drawing (its end entry): a
43.8 s zoom-out shows 3,247 ms of paper (max share 75 %), 129 of 275 frames over 50 ms; the drag's
compose reaches 33 images, the cliff; the pen-up releases the live path in 5 ms; an undo is exact in 44 ms.
Headless, SwiftShader, 3 workers, one run each: the before-picture for B-PYRAMID.
**Decisions made:** the `LevelMap.ensureId("2")` spine gap B-FOUNDATION found (a load mints no missing
spine frame, so natives under it load undrawn) goes to B-MODEL-C1's brief as a first item, not to a side
task; B-FOUNDATION's Q1 (keep A3's band start) is the reviewer's to decide; Q8 (the drag plane counted in
the image budget) goes to B-PYRAMID's brief.
**Questions asked:** none.

## 2026-09-28 04:50 UTC — reviewer (B-FOUNDATION review) — start
**Working on:** the review pass over B-FOUNDATION (0e90872..4e8ce80, its files only) against PLAN §3 rows 6 and 8, the frame
loop's parity, the HUD, the levers, the harness and F132. Reading the committed diff (`git diff 0e90872 HEAD`), not the
working tree: B-SCENE is mid-edit in `rasterCore.js`/`rasterJob.js`/`rasterWorker.js` (epochs → G). Files I may edit: the
four new tests, `rasterCore.clip.test.js` (a union-band case), minors in B-FOUNDATION's own lines, each re-read first.
**Measured:** nothing yet.
**Decisions made:** none yet.
**Questions asked:** none.

## 2026-09-28 05:40 UTC — orchestrator (Fable) — B-SCENE stopped by its context window; B-SCENE-2 continues
**Working on:** B-SCENE's transcript overflowed the model's context mid-way through S2's switch (the epoch
half of `PlateStore.js` half-deleted, four dangling references, lint 4 errors). Its work is committed as
53b7e10; a fresh builder, B-SCENE-2, was launched from the tree and the log with the remaining S2 items,
the S2 checkpoint entry and S3, and with the context-hygiene rule now in the preamble (rule 19). The
B-FOUNDATION review runs beside it.
**Measured:** nothing new.
**Decisions made:** rule 19 of the cloud preamble; a builder's checkpoint entries end with a WHERE I AM line
from now on.
**Questions asked:** none.

## 2026-09-28 04:50 UTC — B-SCENE-2 (builder, B-SCENE's successor) — finish S2, the S2 checkpoint entry, then S3 — start
**Working on:** read B-SCENE's three entries, the preamble, PLAN §1.1/§1.3/§3/§5.3, A2 §3/§6.1/§6.2/§6.4, TEST-MAP.
The tree is snapshot 53b7e10: S1 green; S2's Stage/store/renderer halves in; `PlateStore.js`'s epoch half
half-deleted (lint: 4 errors, `anyId`/`holdsId`/`meets`/`EPOCH_MAX` in `dropById`, `dropRectPerFrame`,
`_pruneEpochs`). Files I am in: `raster/PlateStore.js`, `raster/rasterJob.js`, `worker/rasterWorker.js`,
`raster/rasterWorkerClient.js`, `raster/RasterRenderer.js`, `raster/PictureLayer.js`, `raster/rasterPack.js`,
`KobinEngine.js` (the drain, the hold, `_footBelow`, `listFor`'s mark snapshot, the pack's source), `Stage.js`,
`hooks/useKobinEngine.js` (the `?scene` gate), the raster/move suites TEST-MAP names; re-reading `rasterJob.js`/
`rasterWorker.js` before each edit (the B-FOUNDATION reviewer may touch them for a clip defect).
**Measured:** nothing yet.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: removing `PlateStore.js`'s epoch half (`dropById`, `dropRectPerFrame`, `_pruneEpochs` and their callers).

## 2026-09-28 05:50 UTC — reviewer (B-FOUNDATION review) — checkpoint: a red test on purpose
**Working on:** PLAN §3 row 8 decided: a clipped render is NOT byte-identical for union families. `rasterCore.clip.test.js`'s new last
describe ("the union pass inside a clip", 60 seeds) is RED BY DESIGN on the shipped core (67 bytes inside, first seed 4: 153 vs 154)
until the orchestrator rules on the fix; nobody else's change caused it. Also added: `scaleBar/scaleHud.rtl.test.js` (3/3).
**Measured:** two mechanisms, isolated on scratch copies of the core. (1) exact ties: collinear edges of abutting rings, opposite
directions, starting in different rows above the clip; the clip buckets them all at its top row in reverse load order, the tie
sorts the other way, `emitRuns` ends and restarts a run at that x (−w then +w into one float32 cell) and the residue rides the
running sum. (2) the band start: x from the clip's top (25.6 % of crossings differ by an ulp). Shipped 30/799 clips (79 bytes);
x from each edge's own start 31/799; ties grouped 10/799 (17); both 0/799, 0/120 through band splits, 0/960 mixed lists.
**Decisions made:** not fixed (a major: it moves 21 bytes of 10 of the 24 golden whole plates by one level).
**Questions asked:** the fix (grouped ties + own-start x, 8 lines of the core) goes to the orchestrator in the report.
WHERE I AM: harness scenarios 3 and 6, then levers/F132/lint/typecheck and the end entry.

## 2026-09-28 05:35 UTC — B-SCENE-2 (builder) — S2 checkpoint: freshness by G; epochs, the drain, the old hold gone (A2 §6.2 S2)
**Interface as built** (B-PYRAMID starts here). `src/engine/Stage.js` — `engine.stage = new Stage({doc, lm, store, model, cfg,
isNeutral})`; `generation`; `onCommit(fn(G, {frames, drop: [pred(frameId)], reset}))` → unsubscribe; `sync(frameId, window,
budgetMs = Infinity)`; `covers(frameId, rect)`; `items()` (paint order, one array a table version); `itemsTopDown()`; `itemsOf(id)`;
`placed(item)` → `{geom, off}`; `placeNative(nat, frameId)` → `{box(), toStored(x), fromStored(x)}`; `changesSince(G0)` →
`{added, removed, changed: [{item, off}]}` | null; `snapshot(frameId, rect, budgetMs)` → `{frame, rect, generation, items(),
placed(), covers(), fresh()}` | null; `landedAt(id)`; `track(key, frameId, box, sinceG?)`; `untrack(key)`; `dirtySince(key)`;
`dirtyRects(frameId, sinceG)` → Rect[] | null; `touch(id)`; `hold({ids, frames})`; `holding`; `release()` (one commit); `batch(fn)`;
`forgetFrame(id)`; `packsPending`; `stats`. Not built: `marks()`/`masks()` (B-ERASE), `setDragDelta` (B-DRAG). `placementModel.js`:
`nativesIn`, `placement`, `displaced`, `frameFootprint`, `toStored`/`fromStored`/`footprint`. **Wire:** `packJob(list, {G})` →
`job.G`, one header scalar; the worker echoes `res.G`; no `epochs`, no id runs; `resultStale`, `plateIds`, `idsForPlate` gone.
**Store:** `new PlateStore({maxBytes, env, doc, onRelease, fresh})`, `fresh` the Stage (none: always exact). Rule 1, `put`: stored
iff none or `rec.G > stored.G` (a newer stale one too, F106); a refused job's result or one without G is discarded. Rule 2,
`isExact(e)`: `e.G >= fresh.dirtySince(e.key)`. `beginJob(jobId, view, plates, G)` tracks; a cell neither stored nor in flight is
untracked. Hard drops (`dropQuantum`, `abandonQuantum`, `dropFrames(pred)`, `dropAll`, `release`) refuse their in-flight jobs.
**Renderer:** `{store, stage, scene}`; `render(list, frame, G)`; a job's G is the list's stamp (read before `_buildList`) or the
Stage's G at pack; dispatch refuses a list older than the cell's dirt, and (scene) a cell the table does not cover.
**Engine:** `cfg.scene` (false until S3; `scene` option, `?scene=0|1` in the hook); `onCommit` → `dropFrames`/`dropAll(false)`;
`_neutralOf` is the Stage's classifier until B-ERASE; the plane's drag holds in the Stage; the idle fit `touch`es.
**Measured:** typecheck 0; lint 0 errors (6 warnings, baseline). Quick suite 175 passed + 5 skipped suites, 2,106 tests + 12 skipped,
0 failed (05:29, before the hook gate). Bundles: erase `a1fafca3…`, raster `3e101c17ada4e30132ee8d7ba8629e93`, scene `dce304b8…`.
**Decisions made:** `resultStale` deleted, not ported (the store judges by G; the client has nothing to compare); P3 on the list path
waits for the next render's list (H3's fix); suites deleted with their mechanisms: `raster.markSnap`, `move.hold`; ported: plates
(epoch/id/rect rules out, rule 1/2 in), job, worker, engine, picture, nopaper, move, bake (A2-Q2's band), phone, snapshot, perf.
**Questions asked:** none new. WHERE I AM: break-checks running on the copy; next, S3's harness comparison, then the flip.

## 2026-09-28 06:40 UTC — reviewer (B-FOUNDATION review) — end
**Working on:** done; nothing committed. Files: `raster/rasterCore.clip.test.js` (a union case appended, red by design), new
`scaleBar/scaleHud.rtl.test.js`, `engine/devLevers.js` + one line of `hooks/useKobinEngine.levers.test.js` (a malformed `%` in a
lever URL threw URIError inside the engine's construction: now dropped).
**Measured:** major, PLAN §3 row 8: a clip is not byte-exact for union families (checkpoint above; fix = tied crossings applied
together in `emitRuns` + x from each edge's own start; 0 bytes in 1,879 clips; moves 21 bytes of 10 of 24 goldens by one level).
Suites before (4e8ce80, private worktree): raster + hooks + scaleBar 52 suites 788/788. After (shared tree, B-SCENE-2 mid-edit):
52 suites 776/777, the 1 the union case. Typecheck 0; lint 0 errors, 6 warnings. ScaleHud break-checks: each of five lines 1–2 red
of 3. Harness at 4e8ce80, headless, one run each: scenario 3 pan 2.28 s, paper 0 (baseline 28 ms), 7 of 100 frames > 50 ms,
68 composes 10 ms, max 13 images, 19 plates; scenario 6 undo exact 86 ms (baseline 44), 0 paper, 3 composes, 8 images, 2 plates.
**Decisions made:** frame loop, level.js, crossmap test, HUD, levers, F132: no defect found. Latent: `pinchUpdate` drops its pan's
crossing, masked by `_visibleChanged` (TILE === W), live once that predicate goes. Harness sampler lags the engine's frame by one.
**Questions asked:** in the report: the union fix; the clip suite's 44 s; the pinch crossing; the sampler's lag.

## 2026-09-28 06:50 UTC — reviewer (B-FOUNDATION review) — the union fix, adopted: start
**Working on:** the orchestrator's six asks: the union fix in `rasterCore.js` (tie grouping + own-start x), the 24 goldens
regenerated, `build:worker`, the clip suite split into a quick part and `rasterCore.clip.slow.test.js`, the harness sampler at
compose, the `--dense --scenario all` baseline on :3011, a dated correction in A3 §3.1. Files: `raster/rasterCore.js`, the clip
test and its new slow twin, `tools/harnesses/browser-check.js`, `A3-pyramid.md`, `public/*-worker.js` (bundles).
**Measured:** nothing new yet. **Decisions made:** none yet. **Questions asked:** none.
WHERE I AM: re-reading `rasterCore.js` (the union pass) before the edit.

## 2026-09-28 06:30 UTC — orchestrator (Fable) — the B-FOUNDATION review: one major, adopted
**Working on:** the review found PLAN §3 row 8 false for union families (stroke bands crossing the clip's
top: 30 of 799 clips off by one level, up to four on transparent plates) with two mechanisms — collinear
edges of abutting rings sorted in a different order at the clip's top row, and the band start one ulp off —
and an 8-line fix in the core measured to 0 of 1,879 clips. Adopted; the reviewer applies it, regenerates
the 24 goldens (10 move by one level: a −w/+w pair at one x now cancels exactly), rebuilds the workers,
splits the clip suite into a quick and a slow twin, moves the harness's paper sampler to compose time and
retakes the baseline. The pinch's dropped pan crossing goes to B-SCENE-2's S3 (the build that removes
`_visibleChanged`). One minor fixed inline: a lever value that does not URL-decode no longer throws while
the hook builds the engine. Everything else held: the crossing map, the frame loop, the HUD, the levers, F132.
**Measured:** the reviewer's scenarios 3 and 6 against the builder's baseline agree within run-to-run
variance (pan 0 vs 28 ms paper, undo exact in 86 vs 44 ms).
**Decisions made:** the union fix lands with the review, not as a tolerance in row 8 (transparent plane
plates would carry a four-level error).
**Questions asked:** none.

## 2026-09-28 13:58 UTC — B-SCENE-2 (builder) — resumed after the session-limit stop (S3 mid-way)
**Working on:** the tree is snapshot f2a1488. S3 so far, not yet run through the suites: the list path is gone from the raster
path (`cfg.scene`, `?scene`, `packsPending`, `_listG`, `_noteShown`, `listForPlane` deleted; `_render` reads `stage.items()`;
`_tableStep` is the raster camera step; ladder, prebake, far plane levels and thumbnails read `stage.snapshot` and pack at its G);
`sync` commits only when owed and pins the camera's tiles; the ants' decision keys on G; `_renderSoon`'s skip and
`_eraseListStale` gone; the pinch's pan crossing carried (new `KobinEngine.pinch.test.js`). The harness's list-path run (the S2
tree, copy under scratchpad, :3012, the 4e8ce80 harness) is in; the scene run is next on the same copy and harness.
**Measured:** S2 break-checks (unimported copy): rule 1 older/equal G 2 red of 45; F106 newer-though-behind 3/45; rule 2 29/96;
tracking from `beginJob` 4/96; refusal 5/45; the Stage's dirt 11/51; the hold's one commit 4/49; the hold holds 4/49; the
engine's plane hold 3/49. The rest timed out across the stop; re-run on the S3 tree.
**Questions asked:** none. WHERE I AM: the `?scene=1` harness run on the S2 copy, then the suites on the S3 tree.

## 2026-09-28 14:05 UTC — orchestrator (Fable) — resumed after the session limit; B-PYRAMID-1 launched
**Working on:** Kobin's session limit stopped B-SCENE-2 (in S3, at the picture suite's port) and the
reviewer (running the raster suites for the union fix); both resumed by message with the tree as they left
it (snapshot f2a1488). B-SCENE-2's S2 checkpoint (05:35 UTC) fixed the interface and ran the quick suite
green (2,106 tests, 0 failed), so B-PYRAMID-1 was launched on new files only (`PyramidStore`,
`PicturePyramid`, `jobQueue`, the prefetch policy, their property tests); B-PYRAMID-2 integrates them after
B-SCENE-2's end entry. PLAN §2 records the split. Three agents run: B-SCENE-2, the reviewer, B-PYRAMID-1.
**Measured:** nothing new.
**Decisions made:** B-PYRAMID split in two halves (context window and file ownership); its second half
owns every shared-file line the first half asks for.
**Questions asked:** none.

## 2026-09-28 14:15 UTC — B-PYRAMID-1 (builder) — PyramidStore, PicturePyramid, jobQueue, prefetch: start
**Working on (the proposal).** Four new modules under `src/engine/raster/`, nothing shared edited. `PyramidStore` (A3 §1.1, §4.5):
records keyed by `level.js`, rule 1 in `put`, `exact(r)` = `r.G ≥ fresh.dirtySince(key)` re-read at each call and kept as `r.dirtyG`,
jobs tracked from `beginJob`, hard drops refusing in-flight keys, eviction by class rank (stale-undrawn, off-path, finer, far-by-distance,
LRU; then the protected classes far → frame left → ℓv−1/−2 → rest → ℓv ring), budget `views × viewPlates(σmin·2^−h)` MiB. `PicturePyramid`
(A3 §1.3–§3.5, §9.1): FC2 view; §1.4's plan per cell verbatim; **rest mode** = the level plan under the rest cells that have no rest plate,
then every rest cell with a plate on top (exact 1:1; stale: own + a fresh level cover over its dirty bbox, or the cover whole, or own
stale); every draw placed by the one published affine, destination edges rounded to device px (adjacent cells share an edge, no seam);
direct ≤ 30 images else the surface; one budget object counting distinct images and distinct records (the pin cap, one view). Rest
estimate, inline/worker executors, `patchPlan`, merge, group commit, integrals; `pack(job)` and `measure(job)` are the renderer's
callbacks, requests leave by `onRequest`. `jobQueue` pure over `{free, submit}` + clock; `prefetch.js` `prefetchPlan`.
**Decisions made:** rest-mode layering as above (medium-high: the rest grid at Z never aligns with level grids); the plan's record cap =
one view, so pinned ≤ view + plane holds on small screens where 30 images > one view (high); surface rule literal, scaled ≤ 30 − own
(medium); constants calibrated against the estimate's own E/A/U per job (medium).
**Questions asked:** (1) the plan test needs scaled and sub-rect `drawImage` in `__testkit__/softCanvas.js`, which skips them: I add an
opt-in 4th argument (default unchanged, its 4 suites re-run) — recommend yes, one implementation. (2) K_u has no union-row count in a
result: calibrate each constant against the E/A/U the estimate priced that job with — recommend yes. (3) at 84 cells (own ≥ 30) the
literal surface rule leaves no stand-ins: missing cells stale or paper — recommend literal until the harness says otherwise.
(4) `isPhoneBudget`, `COMPOSE_IMAGES`, `STRIPS_PER_WORKER` are copied into the new modules; the second half deletes the old ones.
WHERE I AM: writing `__testkit__/fakeStage.js`, then `PyramidStore.js` and its property test.

## 2026-09-28 14:25 UTC — reviewer (B-FOUNDATION review) — the union fix, adopted: end
**Working on:** done; nothing committed. `raster/rasterCore.js` (tied crossings applied together in `emitRuns`; each union
edge keeps its own start); the clip suite split: `rasterCore.clip.test.js` (quick, 11 tests, 9.9 s), `rasterCore.clip.slow.test.js`
(10 tests, 42 s), shared helpers and the 24 regenerated goldens in `__testkit__/clipSuite.js`; `tools/harnesses/browser-check.js`
(paper sampled after every compose too); A3 §3.1's dated correction; `public/raster-worker.js`.
**Measured:** goldens: 10 of 24 moved, 21 bytes, one level each (the old core reproduces all 24 old ones with today's packer).
Break-checks (unimported copy; red of quick 11 / slow 10): tie grouping out 2 / 5; own start out 1 / 1; both 2 / 5. Bundles:
erase `a1fafca3d543d5a447fff295498d274a`, raster `033935ef63ebe8c3d12ab8bb650fff8d`, scene `dce304b81ac598a67b8aa15c2daa2d93` (rebuilt twice, same).
Raster suites alone: every failure is B-SCENE-2's porting. The 8 failing suites on two copies of one snapshot fail 4 tests with
the fix and 4 without; the one fix-only test (§8.4 rule 2 timing, `raster.engine`) fails alone under the old core too.
Typecheck 0; lint 0 errors, 6 warnings. Retake (`--dense --scenario all`, 4e8ce80 + the fix, :3011, one run) beside the builder's:
| scenario | builder 04:45: gesture, paper (max), >50 ms, composes n/ms/img | retake 14:00: the same |
|---|---|---|
| 1 zoom-out / back | 43.8 s, 3,247 (75 %), 129/275, 158/223/29 · 29.0 s, 0, 126/223 | 60.5 s, 5,741 (88 %), 132/261, 172/376/29 · 50.2 s, 0, 178/276 |
| 2 slow zoom | 13.5 s, 1,449 (63 %), 23/332, 56/31/13 | 50.6 s, 456 (25 %), 96/190, 101/164/29 |
| 3 pan · 4 lasso · 4 drag | 2.3 s, 28 · 2.5 s, 0 · 4.4 s, 0, 33 img | 3.9 s, 0 · 4.7 s, 0 · 7.5 s, 0, 33 img |
| 5 pen-up · 6 undo | 10.6 s, released 5 ms · exact 44 ms | 4.9 s, released 2,416 ms · exact 133 ms |
| 7 erase + 30 ticks | 18.6 s, 50/259, mark spent 16.9 s | 32.5 s, 59/336, bake not done at the 30 s deadline |
**The retake is contended, not a baseline:** load 12–13 on 4 cores throughout. Another agent's jest workers
(`scratchpad/b2/app`, pids 18144/18179/18181, `raster.engine`+`nopaper`) have spun at 2 × 98 % since 05:34, and a second
harness ran on :3012. Gestures took 1.4–3.7× the builder's, so paper and frame counts are not comparable and the sampler's
effect is not isolated. Server on :3011 stopped; worktree removed.
**Questions asked:** kill those three pids and retake on a quiet machine (recommend yes; 2 of 4 cores are lost to them).

## 2026-09-28 14:25 UTC — orchestrator (Fable) — the B-FOUNDATION review closed; the orphaned jest run stopped
**Working on:** the reviewer's fixes committed (3c721aa): the union pass exact inside a clip, the goldens
and the raster bundle (`033935ef63ebe8c3d12ab8bb650fff8d`) regenerated, the clip suite split, the sampler
at compose time, the lever-decoding minor. Its baseline retake was contended (load 12–13 on 4 cores) by a
jest run the first B-SCENE builder left behind when its context overflowed at 05:3x — two workers at 98 %
CPU for 8.7 hours under `scratchpad/b2/app` — now killed; load is back to ~3 with three agents.
**Measured:** nothing quotable from the retake; the reviewer's own scenarios 3 and 6 earlier agreed with the
builder's baseline within variance.
**Decisions made:** no separate quiet retake now — B-PYRAMID-2 measures old and new back to back behind
`cfg.pyramid` on the same machine, which is the comparison that matters; the harness gains a load-average
line in its output so a contended run is visible (an ask for B-PYRAMID-2). B-FOUNDATION is closed.
**Questions asked:** none.

## 2026-09-28 14:27 UTC — B-SCENE-2 (builder) — S3: the flip is in; the ported suites green alone; the quick suite running
**Working on:** the raster path packs the Stage alone (no `cfg.scene`, no `?scene`: the list path is deleted with it). Since the
last entry: `_syncStep` (a camera-only step syncs the table first; a plane drag step does not: the Stage holds it, and a sync
mid-drag read tiles while merges were held, so a drop onto a visited cell stopped merging); `sync` reads the frame's natives as
`listFor` did (a pending shift settles, shadows merge: `move.twin`); snapshots read at least one tile a call (a cold rung
progresses; `readTiles` counts `overBudget`); `MovePlane.aim` re-cuts on a new plate range (the items keep their array while
the table does); a pen-up path is held while its shape is pending; the arrival row starts at the client's unwire
(`beginFrame(seq, kind, backMs)`; a leaner `_takeResult` showed `xfer.in` outside its row). Suites: `stage.cover.test.js`
replaces `raster.listCover` (jobs' ids against `listFor` over the plate, and the pixel oracle); new `KobinEngine.pinch.test.js`;
ported: move (render counts, L1, L4b; L6 deleted with the skip), phone P3, liveHold LH-1, snapshot S1 break-check, nopaper
(ladder spies), overlay G11 (each decides afresh), selection.indicator (the decision keyed on G), engine (the recorder).
Docs: DESIGN §7/§9/§10/§15, `docs/ai/20-`, `30-` (Stage.js, placementModel.js), `40-`.
**Measured:** the harness (S2 tree, :3012, the 4e8ce80 harness, load 7–10 from other agents): list path vs Stage, penup exact
never vs 588 ms, release 795 vs 586 ms, undo exact 76 vs 298 ms, zoom-out paper 7.7 s vs 2.6 s; timings not comparable (rerun).
**Questions asked:** none. WHERE I AM: the quick suite, then S3 break-checks and the harness pair rerun.

## 2026-09-28 14:40 UTC — B-PYRAMID-1 (builder) — checkpoint 1: PyramidStore and the plan green
**Working on:** files mine: `raster/PyramidStore.js`, `raster/PicturePyramid.js`, their two tests, `__testkit__/fakeStage.js` (new),
`__testkit__/softCanvas.js` (opt-in `{scaled}` 4th argument, default unchanged). Next: the rest and patch tests, `jobQueue.js`, `prefetch.js`.
**Measured:** `PyramidStore.property.test.js` 8/8 (6 seeds × 700 steps: >10,000 exact checks against the log, >200 exact plan draws
checked, every older arrival closed); `PicturePyramid.plan.test.js` 7/7 (24 random level trials + 12 rest trials, >100,000 sampled pixels
equal the plan's source, every cell's source equal to a rule oracle's, all eight source kinds seen). Break-checks on the unimported copy
(`scratchpad/bp1/breakcheck.py`): 31 rules, 31 red (store 18: 1–3 red of 8 each; plan 13: 1–2 of 7 each). Lint 0 errors (6 warnings,
baseline), typecheck 0.
**Decisions made:** refusal is by job id as well as by key (a refused job's late result behind a newer job for the same key was stored
otherwise); the store never sets its own budget, the renderer applies `pyramid.budgetBytes()` (a side effect in a constructor hid a test's cap).
**Questions asked:** none new. WHERE I AM: writing `PicturePyramid.rest.test.js` (trigger, estimate cases of A3 §2.2, pan keeps / zoom drops).

## 2026-09-28 14:58 UTC — B-PYRAMID-1 (builder) — checkpoint 2: the rest render, partial re-render and the group commit green
**Working on:** `PicturePyramid.rest.test.js` (8) and `PicturePyramid.patch.test.js` (6) added; next `jobQueue.js`, then `prefetch.js`.
**Measured:** rest 8/8 (§2.2's cases: 4.06 ms inline, 14.95 ms and 60 HiDPI cells to the workers; inline exact in the still frame;
quiet → one prio-0 group shown when complete; pan keeps, zoom/frame/resize discard and close). Patch 6/6: the undo inline, 3 seeds, all
four plates byte-equal to the post-undo whole render and >100,000 screen pixels equal; coarse-first 2 seeds: 0 changed pixels still
showing the old value, 0 pixels outside the change altered, `olderMs` 0; the GPU merge (software OffscreenCanvas) equals `pastePatch`
in 13 of 13. Break-checks: 25 more rules, 25 red (rest 11, patch 9, group 5); 56 of 56 so far. Lint 0 errors, typecheck 0.
**Decisions made:** two found by the tests: the rest trigger wants only cells with no plate (it re-rendered stale rest cells whole and
starved the patch path); a patch's dirty box is grown by a pixel before it is drawn (12 changed pixels showed the old value at a .5 edge).
Outward rounding was added and removed again: redundant with the growth (neither break went red alone). Calibration is fed by the
renderer (`onSample`, `sampleOf`), not self-applied: a cold JIT's inline timings flipped the next rest to the workers (a flaky test).
**Questions asked:** none new. WHERE I AM: writing `raster/jobQueue.js` (typed jobs, priorities, the cut reservation, dealing, admission, velocity).

## 2026-09-28 15:35 UTC — B-SCENE-2 (builder) — S3 done: the raster path packs the Stage alone — end
**Working on:** done; nothing committed. S3 files: `KobinEngine.js` (raster `_render` builds no list; `_tableStep`/`_syncStep`
are the camera step; `pinchUpdate` carries its pan's crossing; ladder and prebake read `stage.snapshot`; `cfg.scene`,
`listForPlane`, `_eraseListStale` gone), `Stage.js` (`sync` commits only when owed, pins the camera's tiles, reads `nativesIn`;
`packsPending` gone; snapshots read a tile a call), `TileStore.js` (`overBudget` in `readTiles`), `erasePipeline.js`
(`_renderSoon`'s skip gone), `selection.js`, `overlays.js` (ants keyed on G), `sceneOps.js` (thumbnails via snapshot),
`raster/RasterRenderer.js` (list path, `_listG`, `_noteShown` gone; a pending stroke's path held; the arrival row starts at the
unwire), `raster/MovePlane.js`, `raster/rasterPerf.js`, `hooks/useKobinEngine.js` (the S2 `?scene` gate, removed again). Tests:
new `stage.cover.test.js` (for `raster.listCover`, deleted), `KobinEngine.pinch.test.js`; ported raster move/phone/liveHold/
snapshot/nopaper/overlay/engine, `selection.indicator`. Docs: DESIGN §7/§9/§10/§15, `docs/ai/10-`/`20-`/`30-`/`40-`, TEST-MAP.
**Measured:** quick suite 2,101 pass, 12 skipped, 1 fail (raster.move L1's bake timing: stubbed, 45/45 alone); typecheck 0; lint
0 errors, 6 warnings; bundles unchanged (raster `033935ef…`, the review's). Break-checks, S3 tree (red of guarding suites): rule 1
2/45, F106 3/45, rule 2 29/96, tracking 4/96, refusal 5/45, dirt 11/51, one-commit release 2/48, hold 5/48, engine hold 6/48,
covers 1/5, no idle commit 1/44, step syncs 1/24, `nativesIn` 2/6, pinch 2/2, drag step 1/19, pending hold 1/53, snapshot
progress 1/19, re-cut 2/45, ants on G 1/41, arrival row 1 of 2 runs. Harness back to back (4e8ce80 harness, load 2–3, B-PYRAMID's
jest beside), Stage vs list path: zoom-out 47.3 vs 57.9 s, paper 9,784 vs 821 ms (plates rastered 230 vs 300 of ~890 posted);
slow zoom 45.1 vs 42.7 s; pan 2.5 vs 2.7 s; drag 6.2 vs 5.2 s; pen-up exact 425 ms vs never; undo exact 97 vs 37 ms; erase +
zoom: bake 31.0 vs 19.4 s, 143 vs 66 composes. Round trip (both modes): 23,444 ink px drawn, 25,244 after (baseline 25,244).
**Decisions made:** the list path deleted with the flip (the flag had nothing left to choose); `_candidatesUnder` keeps `below` as
its memo key only (B-ERASE rewrites it); `_renderPending` kept (PLAN §1.1 lists it; `flushBakes` reads it).
**Questions asked:** in the report (the erase cost before partial re-render; the zoom-out refusals; the 15 s pending cap).
WHERE I AM: done — B-PYRAMID-2 may take `RasterRenderer`, `PictureLayer`, `PlateStore`, `MovePlane`, `KobinEngine`.

## 2026-09-28 15:50 UTC — orchestrator (Fable) — B-SCENE landed (1cac470); its review and B-ERASE launched
**Working on:** B-SCENE-2's S2+S3 committed as 1cac470; the review pass launched (`opus-reviewer`) with
the zoom-out paper regression first (9,784 vs 821 ms in its back-to-back pair; the pre-flip snapshot
18d5e2f still carries both paths for a quiet comparison), then rows 1, 2, 5, the coverage and
no-read-mutates properties, the hold, the camera step, the deletion list, the pending path's cap, the
erase bake's cost. B-ERASE launched (`opus-builder`, E1–E5 of A2 §6.2, the interim erase pool behind
`submit`). Three agents run: B-PYRAMID-1, the B-SCENE reviewer, B-ERASE. B-MODEL-C1 waits for the
reviewer and B-ERASE (its files overlap both).
**Measured:** B-SCENE-2's pair (load 2–3): pen-up exact at 425 ms (never before); zoom-out paper
9,784 vs 821 ms; erase bake 31.0 vs 19.4 s; undo exact 97 vs 37 ms; round trip pixel-identical both ways.
**Decisions made:** PLAN §5.4 (B-SCENE-2's Q1–Q4; the asks carried to B-PYRAMID-2; the orphan correction).
**Questions asked:** none.

## 2026-09-28 15:08 UTC (container clock) — reviewer (B-SCENE review) — S1–S3 against PLAN §3 and A2 — start
**Working on:** read the preamble, PLAN §1.1/§3/§4/§5.3/§5.4, A2 §2/§3/§6.1/§6.2/§6.4, B-SCENE's and B-SCENE-2's entries.
First the zoom-out paper regression: 18d5e2f in a private worktree (:3021, `?scene=0|1`) against the current tree (:3022),
`browser-check.js --dense --scenario 1` twice each with `uptime`; then refusal counters in `RasterRenderer.report()`. Then
rows 1, 2, 5, coverage/no-read-mutates, the hold, the camera step, the deletions, the pending path's cap (§5.4 Q2), the
erase bake's cost. Files I may edit: `Stage.js` (outside `marks`/`masks`/the classifier), `TileStore.js`, `PlateStore.js`,
`RasterRenderer.js`, `PictureLayer.js`, `MovePlane.js`, `KobinEngine.js`, `overlays.js`, `placementModel.js`, tests.
**Measured:** nothing yet (load 0.18 / 0.96 / 2.14 at start).
**Decisions made:** none yet.
**Questions asked:** none.

## 2026-09-28 15:13 UTC — B-PYRAMID-1 (builder) — checkpoint 3: all four modules and six suites green
**Working on:** `raster/jobQueue.js` + `jobQueue.test.js` (7), `raster/prefetch.js` + `prefetch.test.js` (6) added; the plan suite grew
the view, requests, step lever, plane, integrals and surface-lifetime tests (14). Next: dated corrections in A3, the TEST-MAP rows,
the whole break-check set re-run on the final tree, the end entry.
**Measured:** 10 suites together (mine and the four other `softCanvas` users) 124/124. Break-checks since checkpoint 2: queue 13/13
red, prefetch 15/15, view/plane/integrals 12/12 — 96 of 96 rules red so far, each on the unimported copy.
**Decisions made:** children (c) are planned as an upgrade after every cell's own-to-coarser plan, nearest the attention point first:
greedy in cell order they took the whole budget and left later cells paper while a shared coarser plate was cached (a red test).
The plan's image counts come from what it draws (1:1 when a destination is as wide as its source), not from the budget's reservations.
The queue keeps `max(1, workers − 1)` for the cut reservation and the low-priority cap, so a one-worker pool is never starved.
**Questions asked:** none new. WHERE I AM: the dated corrections in `A3-pyramid.md` §1.4, §2.1, §2.2, §3.4.

## 2026-09-28 15:20 UTC — B-ERASE (builder) — E1–E5 of A2 §6.2: targets as data, the rule, the parallel bake, async barriers — start
**Proposal.** `src/engine/eraseRule.js` holds the rule (`underMask`), the Stage's step test (`inLineage`: `targetOf ∋ M`,
below M) and the mint-site inheritance; fields are sorted id arrays (high). Bake events carry `by` (and `dust`, `inkless`); the
Stage classifies per event: an add/remove by M of an object in M's lineage dirties box(M) ∩ its box ∪ its dust boxes, a
handled change box(T) ∩ box(M) or nothing if inkless, a frame set aside at registration nothing past the landing's box(M);
undo and redo stay untagged (medium-high). Registration runs in one `stage.batch` with the landing; a landed mark found
without `targets` (an old file, a test's direct add, an undone old mark returning) is registered by the old rule at first
sight, one path (medium). One `cede(receiver, …)` in a new `src/engine/cede.js` (high). Marks set and lineage index are
kept by add/remove/reset events, liveness read through `getById`, so a frame set aside needs no event (high). The bake: a
reorder buffer applying in serial order, lookahead dispatch through `submit` to an interim N-worker pool in
`eraseWorkerClient.js` (RW-1's respawn/watchdog), one descent in flight, inline where `submit` returns null (high). Slots:
two marks share when no item under both boxes has different bits (medium). Barriers: one `_eraseBarrier(pairs, then)`,
synchronous inline, parked otherwise (medium).
**Questions asked:** Q1 overflow's "raise the older mark's cuts": the serial order already bakes the oldest mark first;
I propose counting (`packStats.maskOverflow`) and no extra queue (rec.: accept). Q2 a landed mark without `targets` is
registered at first sight by the old rule, not only at load (rec.: accept). Q3 redo re-applies steps with whole footprints
(a step does not record its dust) (rec.: accept). Q4 a shared slot where an item has both bits paints `1 − max(a, b)` for
`(1 − a)(1 − b)`, different only where the two marks' edges overlap (rec.: accept, row 3 (b)'s envelope).
**Files I am in:** eraseRule.js, cede.js (new); erasePipeline, eraseJob, eraseDescent, eraseWorkerClient, Document,
format2, persist, oplog, files, selection, frameGc/sceneClient/report (`_cutInflight`), rasterPack's mark block,
rasterCore's mask functions, rasterJob `MASKS_MAX`, Stage's classifier and Item getters, KobinEngine (`_emit`,
barrier sites, `_uncut`/`_bakeDone`/`markDone`/`_neutralOf` removal), RasterRenderer (`markDone` only), the hook's status
and the editor's chip. WHERE I AM: E1 — eraseRule.js and cede.js.

## 2026-09-28 15:24 UTC — B-PYRAMID-1 (builder) — progress: the group commit made safe; the final break-check run
**Working on:** the whole break-check set (95 rules) running on the final tree; then the end entry. Docs done: seven dated notes in
`A3-pyramid.md` (§1.4, §1.5, §2.1, §2.2, §3.4, §3.6, §4.4), five rows in `TEST-MAP.md`.
**Measured:** my six suites 50/50 on the final code (typecheck 0, lint 0 errors).
**Decisions made:** two holes found reading my own group commit, each now a test: a group holds only results packed at or after
its G (an earlier job's plate lacks the stroke and would have released the path over it), and a change of the drawn set re-targets
a pen-up's group (A3 §3.6 item 5; it was unbuilt). Two duplicate break rules dropped (S8, S17 against the store suite, which cannot
see them; the plan suite's S8p and S17p do).
**Questions asked:** none new. WHERE I AM: waiting for `scratchpad/bp1/final-breakcheck.log`; then the end entry and the report.

## 2026-09-28 15:35 UTC — B-PYRAMID-1 (builder) — end: four modules and six suites, nothing wired
**Working on:** done. New: `raster/PyramidStore.js`, `raster/PicturePyramid.js`, `raster/jobQueue.js`, `raster/prefetch.js`,
`__testkit__/fakeStage.js`, six suites (`PyramidStore.property`, `PicturePyramid.plan|rest|patch`, `jobQueue`, `prefetch`);
`__testkit__/softCanvas.js` takes an opt-in `{scaled}` 4th argument (default unchanged). Docs: seven dated notes in `A3-pyramid.md`,
five TEST-MAP rows. No shared source file edited; the asks below are B-PYRAMID-2's.
**Measured:** my six suites 50/50 (with the four other `softCanvas` suites 124/124 before the last test edits); the plan's random
trial at S = 1, 2, 3. Break-checks on the unimported copy, final tree: 95 rules, 95 red (store 16, plan 24, rest 13, patch and group
14, queue 13, prefetch 15; `scratchpad/bp1/final-breakcheck.log`, rules in `bp1/rules.py`). Typecheck 0; lint 0 errors (the 9
warnings are in other files). Nothing measured in a browser: the modules are not wired.
**Asks for B-PYRAMID-2** (in full in my report): RasterRenderer builds store, pyramid and queue and supplies `pack` (live table or
`job.table`), `measure` (E, A, U, P) and the calibration samples (`onSample`, `sampleOf`); `_takeResult` feeds `onResult`, `endJob`,
`queue.done`; the frame step runs frameFor → setMotion → frame → pump → compose, prefetch at idle with `setFar`; the pen-up calls
`groupCommit` before the next frame; the engine asks one more frame after the camera stops; rasterWorkerClient adopts JobQueue;
MovePlane's port publishes the plane shape and pins (move MOVE_PLANE_PLATES out of MovePlane first if it imports PyramidStore);
`isPhoneBudget`, `COMPOSE_IMAGES`, `STRIPS_PER_WORKER` are duplicated until the old files go.
**Questions asked:** as in the start entry (softCanvas opt-in; K_u against the estimate's own U; the literal surface rule at ≥ 30 own
plates), plus: keep `max(1, workers − 1)` for the cut reservation? Recommend yes. WHERE I AM: done.

## 2026-09-28 17:30 UTC — orchestrator (Fable) — B-PYRAMID-1 landed (877ba07); its review launched
**Working on:** B-PYRAMID-1's four modules and six suites committed; its review pass launched on the new
files only (`opus-reviewer`), with the surface rule and the one-view plan cap as the two items to decide
with constructed screens. Three agents run: the B-SCENE reviewer, B-ERASE, the B-PYRAMID-1 reviewer.
B-PYRAMID-2 starts when the B-SCENE reviewer ends (they share the renderer's files) and takes the
B-PYRAMID-1 report's open-items list as its brief, plus the B-SCENE reviewer's zoom-out finding.
**Measured:** B-PYRAMID-1's own (jsdom): 10,000+ exactness checks, 100,000 sampled pixels equal to their
planned source, the undo byte-equal inline and never older coarse-first, the GPU merge equal to
`pastePatch` in 13 of 13; 95 break-checks, 95 red.
**Decisions made:** PLAN §5.5.
**Questions asked:** none.

## 2026-09-28 15:37 UTC (container clock) — reviewer (B-PYRAMID-1 review) — the four modules against PLAN §3 row 1 and A3 §1–§4 — start
**Working on:** reading `raster/PyramidStore.js`, `PicturePyramid.js`, `jobQueue.js`, `prefetch.js`, their six suites,
`__testkit__/fakeStage.js` and `softCanvas.js`'s opt-in; the two constructed cases (the 84-cell surface rule, the 390×844@3
phone under the one-view cap). Files I may edit: those only. Not in the B-SCENE reviewer's or B-ERASE's files.
**Measured:** nothing yet. **Decisions made:** none yet. **Questions asked:** none.
WHERE I AM: baseline run of the six suites and the four other softCanvas suites.

## 2026-09-28 18:58 UTC — reviewer (B-PYRAMID-1 review) — resumed after the session-limit stop
**Working on:** the review from the tree (9b97bae); my files unchanged since 877ba07 (checked by diff). Read so far: the four modules
in full, fakeStage, the plan and store suites' fixtures.
**Measured:** baseline six suites 50/50 (15:40). The four other softCanvas suites before the stop: 74/75, the one red
`raster.mask` K3 — `runCutAsync is not a function` from `erasePipeline.js:722` (B-ERASE's files mid-edit, not this review's);
re-run now. E6b/E6c (headless Chromium, `scratchpad/rv/e6b-mixed.cjs`, `e6c-bitmap.cjs`), median JS ms of one frame's draws:
1:1 alone 30 → 0.2, 60 → 6.6, 77 → 13.9; mixed 26 own + 4 scaled 0.1, 32 + 4 6.4, 60 + 10 20.9, 77 + 7 14.2; 0 + 34 scaled 21.9;
the surface blit + K scaled with no recompose 15–23 ms for K = 4–25 (the blit is itself a scaled image of 5–8 k px); a recompose
of the surface 26–38 ms (canvas) / 67–93 ms (OffscreenCanvas + transfer). So the cost follows distinct images per canvas flush,
scaled or not, past ~33 — and a scaled blit of a big surface costs like the cliff by itself in software GL.
**Decisions made:** none yet. **Questions asked:** none.
WHERE I AM: the constructed 84-cell case and the 390×844@3 phone case in `PicturePyramid.plan.test.js`, then the store's refusal
order (endJob before put) and the rest-mode cap.

## 2026-09-28 18:58 UTC — reviewer (B-SCENE review) — resumed after the session-limit stop
**Working on:** the zoom-out paper comparison, then rows 1, 2, 5 and the rest of the brief. Correction to the brief: 18d5e2f
does NOT carry both paths (its renderer ignores `opts.scene`; `?scene` only flips `packsPending`); the S2 checkpoint 9b1edbb
does. Old = worktree `scratchpad/rv2/old` at 9b1edbb (`?scene=0` list path, `?scene=1` Stage), new = `rv2/new` at 1cac470.
**Measured (scenario 1 "zoomout", paper ms, load 1-min at start):** current harness (1cac470's sampler): list path 2,135
(2.40), 921 (2.43), 5,660 (1.83, instrumented); 9b1edbb Stage 4,780 (2.54), 5,377 (2.87), 4,717 (2.47, instr.); 1cac470
302 (2.67), 873 (2.79), 2,580 (2.10, instr.). B-SCENE-2's harness (4e8ce80's rAF-only sampler, instrumented trees): 1cac470
9,139 (1.17), 6,152 (2.99); list path 6,192 (2.23), 2,198 (2.13). Refusal counters (instrumented, scenario 1): `covers`
refusals 0 on every tree and mode; dirt refusals 0; visibility-half refusals 4–15 strips; every paper cell counted was
`covers()`-true (190–314 cell-composes). ~890 plates posted, 330–350 packed: the rest superseded in the client's queue.
Finding so far (not a verdict yet): no covers mechanism; the 9,784 vs 821 pair is inside the metric's run-to-run spread.
Also found (reading): `PlateStore`'s hard-drop refusal lives on the in-flight record, which a newer `beginJob` for the
same key overwrites (a refused job's late result is then stored); `stage.batch` has no caller outside `release`.
**Decisions made:** measure against worktrees, not the main tree (B-ERASE's edits are in it).
**Questions asked:** none yet.
WHERE I AM: restart :3021/:3022, run `batch2.sh` (post-paint sampler `bcp.js`, 2 × new vs list path), then the
PlateStore refusal fix with a test in `raster.plates.test.js`.

## 2026-09-28 19:00 UTC — orchestrator (Fable) — resumed after the second session-limit stop of the day
**Working on:** the tree as the three agents left it at ~15:55 (container clock) snapshot-committed as 9b97bae and
pushed; the container had been rebooted in between (every process gone: the reviewer's two dev servers and its
`batch2.sh`, B-ERASE's smoke run, the B-PYRAMID-1 reviewer's background suites; the scratchpad, its two worktrees
`rv2/old` 9b1edbb and `rv2/new` 1cac470, and the agents' transcripts survived). All three resumed from their transcripts
with the environment changes spelled out: B-ERASE (from its first smoke run; `zz_berase_debug.test.js` is in the
snapshot, to be deleted before its checkpoint), the B-SCENE reviewer (told to serve `rv2/new` for the zoom-out pair,
since the main tree now carries B-ERASE's half-built erase path), the B-PYRAMID-1 reviewer (re-running the four other
softCanvas suites). Next for the orchestrator: the B-PYRAMID-2 brief drafted while they work.
**Measured:** load 0.20 / 0.06 / 0.02 at the resume — no orphaned workers this time.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-28 19:02 UTC — B-ERASE (builder) — resumed after the session-limit stop
**Working on:** E1–E3 are in the tree (snapshot 9b97bae), unverified: `eraseRule.js`, `cede.js` (one body for
`cedeTileById` and the descent), dust boxes (`eraseJob.dustBoxes`), events carrying `by`/`dust`/`inkless`, the Stage's
`_stepOf` classifier (the `isNeutral` dep gone), Item getters for the fields, byte masks and 16 slots, the pack's
`maskSlots`, format2/persist/oplog (`attr` entries)/files/hook derivation calls, the interim pool (`submit`), and
`erasePipeline.js` rewritten (marks set, lineage, registration at the landing, `_bakeRun` with the reorder buffer,
`_eraseBarrier` + tap/drag/lasso barriers, `_spendMark` with pruning); KobinEngine (`_initErase`, status `erase`,
cancel on press/tool/undo, the parked lasso drawn), selection (barrier call sites, `_marksAt` pick).
**Measured:** before the stop, typecheck 0 and lint 0 on the changed files; a smoke run of 7 suites: 73 pass, 9 fail
(provenance EP-1..4, KobinEngine.edit 4 deferred-erase cases, erase.moved F66, eraseDescent.frames A13-2).
**Decisions made:** EP-1's failure is array order only (the natives' set and geometry equal; a barrier's time order vs
the redo's stack order) — pending a look at EP-3/EP-4, whose "the older cuts the newer's piece" setup the rule no longer
produces (a piece of a handled target is handled).
**Questions asked:** none new.
WHERE I AM: re-running the smoke run; then EP-4's diff, the four KobinEngine.edit cases, A13-2, F66.

## 2026-09-28 19:14 UTC — reviewer (B-PYRAMID-1 review) — checkpoint: two majors (the plan's two caps), three minors fixed
**Working on:** in `PyramidStore.js`, `PicturePyramid.js`, `PyramidStore.property.test.js`, `PicturePyramid.plan.test.js`,
`prefetch.test.js` only. Constructed screens on an unimported copy (`scratchpad/rv/bc`, `PicturePyramid.review.test.js`).
**Measured:** shipped code, four constructed cases, 4 red: 2560×1440@2 level mode after a pan, 5 cells paper with ℓv−1 cached;
the same at rest (77 rest cells > one view of 54), 5 paper; 390×844@3, 35 cells, 29 own, stand-ins from ℓv−1/ℓv−2: 3 paper;
desktop 2256×1218 at σ 0.72 (40 cells, all cached) an undo over two cells: 0 patched, older shown. Attribution on the copy:
`cap = 30 − own` alone reds 1 and 3; the one-view record cap alone reds 2 and 4; `cap = 30 − plane` makes all 4 green and reds
3 existing plan tests (each pins a cap). Minors: a hard drop missed a job overtaken in the in-flight map (its late result
stored under a re-addressed id) — fixed, test red on the shipped store; children upgrade now paper → older → blur — fixed, test
red on the shipped plan; prefetch's far test flaked once under load (real 8 ms clock) — frozen clock. Six suites 52/52.
**Decisions made:** majors reported, not applied (brief: majors with a proposed fix).
**Questions asked:** none yet. WHERE I AM: typecheck, lint, the four softCanvas suites, then the end entry and the report.

## 2026-09-28 19:17 UTC — reviewer (B-SCENE review) — checkpoint: the zoom-out paper "regression" diagnosed
**Working on:** the diagnosis is done; rows 1–9 under way. Edits so far (main tree, not yet run): `PlateStore.js` (`put`,
`endJob`, `_refuse`, constructor: refusal per job), `RasterRenderer.js` (`_packable`/`_stillWanted`: refusals by reason;
`_releaseHeldLive`: no limit while pending), `Stage.js` (`_reconcile`: re-keys logged for `changesSince`), `overlays.js`
(the ants' outline window through `placeNative`); tests in `raster.plates`, `raster.liveHold`, `stage.cover`, `stage.hold`.
**Measured (scenario 1, worktrees 9b1edbb = both paths, 1cac470 = the landing; post-paint sampler `rv2/bcp.js`, load
2.1–2.7):** paper as painted — 1cac470 36.6 / 382.5 ms, list path 49.8 / 0 ms; the compose sampler in the same runs 242 /
510 vs 493 / 198. Refusals at dispatch in every scenario-1 run (7 runs, all trees and modes): `covers` 0, dirt 0, dead
quantum 0–15 strips; every paper cell counted was `covers()`-true. ~900 plates posted, 306–409 packed: the rest are
superseded in the client's queue (one frameSeq per q), not refused. Earlier samplers on the same trees spread 302–9,139
(1cac470) and 921–6,192 (list path).
**Decisions made:** verdict — not a defect and not a `covers` consequence: B-SCENE-2's 9,784 vs 821 is the rAF-only
sampler (4e8ce80's), which charges the share read before the engine's frame across the whole (long) frame; its spread on
one tree is 2–9 s. Nothing for B-PYRAMID-2's budgeted read to fix here; the counters stay in `report()` for it.
**Questions asked:** none.
WHERE I AM: harness scenarios 7 (erase) and 6 (undo) with stage stats (`batch3.sh`), then the suites for my edits, the
batch-cost experiment (`rv2/exp-batch.cjs`), typecheck, lint, the quick suite, the end entry.

## 2026-09-28 19:20 UTC — reviewer (B-PYRAMID-1 review) — end: two majors proposed, three minors fixed
**Working on:** done. Edited: `raster/PyramidStore.js` (a hard drop refuses by job, so an overtaken job is refused too),
`raster/PicturePyramid.js` (children upgrade paper → older → blur), their tests (+1 each), `prefetch.test.js` (frozen clock),
A3 §1.4's dated note (the order). Constructed cases on the copy: `scratchpad/rv/bc/src/engine/raster/PicturePyramid.review.test.js`.
**Measured:** six suites 52/52 (typecheck 0, lint 0 errors / 6 warnings). The four constructed screens: 4 red shipped, 4 green
with `cap = 30 − plane` (3 old plan tests red: they pin the caps). Four softCanvas suites: 70/75 — raster.mask 4 red
(`_flushErasesFor`/`_nextEraseTarget` not functions: B-ERASE mid-edit), raster.move L3 red since the 19:15 snapshot (green on my
19:00 copy; the diff is in Stage.js, erasePipeline.js, selection.js, RasterRenderer.js — none of mine). prefetchPlan 0.09 ms a plan.
**Decisions made:** majors M1 (own plates counted against the stand-in cap) and M2 (the one-view record cap) proposed, not applied.
**Questions asked:** adopt M1+M2's fix; stand-ins on the ink canvas after the blit (measure first); the phone floor over its
ceiling; MOVE_PLANE_PLATES to level.js. WHERE I AM: done.

## 2026-09-28 19:35 UTC — orchestrator (Fable) — the B-PYRAMID-1 review landed (8194de4); B-PYRAMID-2 launched on P0
**Working on:** the B-PYRAMID-1 review's edits committed (a hard drop refuses by job; children upgrade paper → older →
blur; the far prefetch test on a frozen clock); its two majors adopted in PLAN §5.6 (M1 stand-ins counted apart from own
plates, `cap = COMPOSE_IMAGES − plane.images`; M2 the one-view record cap replaced by the pinned bound and the floor) and
made B-PYRAMID-2's P0; the B-SCENE reviewer's zoom-out verdict recorded as closed (§5.6 item 8: the rAF-only sampler, not
a defect). B-PYRAMID-2 (`opus-builder`, brief `review/rebuild/briefs/B-PYRAMID-2.md`) launched now on P0 only, since P0
touches only the four pyramid modules; P1 onward after the B-SCENE reviewer's end entry. `raster.move` L3's red attributed
to the reviewer's `_releaseHeldLive` change (§5.4 Q2) and sent to it. Three agents run: B-ERASE, the B-SCENE reviewer,
B-PYRAMID-2. The B-MODEL-C1 brief is written (`briefs/B-MODEL-C1.md`); it launches after B-ERASE, its review and the
B-SCENE reviewer.
**Measured:** raster.move 44/45 (L3, as above), 12 s. The review's E6b: 1:1 draws 60 → 6.6 ms, 34 scaled → 21.9 ms.
**Decisions made:** PLAN §5.6 items 1–8.
**Questions asked:** none.

## 2026-09-28 19:25 UTC — B-PYRAMID-2 (builder) — P0, the plan's two caps (PLAN §5.6 M1, M2) — start
**Working on:** P0 only (brief §5): the stand-in cap `COMPOSE_IMAGES − plane.images` with own plates counted apart,
`_ownCount` gone, rest mode's scaled ℓv plates as stand-ins; the one-view record cap and `viewUnit` replaced by the pinned
bound, the budget floor and the phone ceiling; the reviewer's four constructed screens moved into
`PicturePyramid.plan.test.js`. Files I am in: `src/engine/raster/PicturePyramid.js`, `PyramidStore.js`, `level.js`
(constants only) and the six pyramid suites. Not touching `MovePlane.js`, `Stage.js`, `TileStore.js`, `PlateStore.js`,
`RasterRenderer.js`, `PictureLayer.js`, `KobinEngine.js`, `overlays.js`, `placementModel.js` (the B-SCENE reviewer) or
any B-ERASE file until P1, which waits for the B-SCENE reviewer's end entry.
**Measured:** nothing yet. **Decisions made:** none yet. **Questions asked:** none.
WHERE I AM: reading PLAN §5.6 and the reviewer's four screens, then `PicturePyramid.js`'s surface rule.

## 2026-09-28 19:32 UTC — B-ERASE (builder) — progress: the ported erase suites green; new tests next
**Working on:** fixes found by the ported suites: a live native names no dead mark (spent, or whose redo branch went) —
pruned at spend, as it re-enters (undo, a frame back) and at a load, so undo of a finished erase restores the document
exactly and a replay agrees with the live history (EP-4); every tap/drag barrier resolves pending perimeters first (a
raw stroke dragged broke the ants); the barrier's per-target lock is global (an older mark never cuts a newer one's
piece); a barrier ends by spending the marks it emptied; `deselect`/tool/press/undo cancel a parked gesture; the
lookahead never writes the document. Ported: erase.stack (async barriers, the parked drag of A2 §5.5), erase.worker,
erase.cost (0 scans in the bake), move.startCost, provenance (EP-1 as a set: a barrier's out-of-stack order; EP-3's
older-cuts-newer history built by `flushErases(only)`), the three hook erase suites, oplog, A13-2, F66, move.subtree t12
(split by the landing's timing), occlusion O5 (targets), the harness's picture oracle (masks, not white ink).
Deleted: erase.neutral, erase.zorder, raster.bake, raster.mask, erase.markFrame (replacements follow).
**Measured:** 8 ported suites + 8 more: all green alone; typecheck 0; lint 0 errors, 6 warnings (baseline).
**Decisions made:** a tap re-hits after its barrier (A2 §4.11 step 1; SM-5 and RR-3/4: the half not pressed stays),
not "all the target's pieces" (§5.5, row 7 (a)) — see Q5.
**Questions asked:** Q5 row 7 (a) vs SM-5: I kept SM-5's re-hit (rec.: keep; a drag's barrier still carries a
selection to all the pieces of its members). Q6 the SVG renderer paints a pending mark as white ink at its own z,
now over baked pieces and objects dragged under it (`?svg`, export) — rec.: B-PYRAMID-2's SVG demotion masks targets.
WHERE I AM: writing raster.eraseRule.test.js (row 3 a–d), then select.eraseBarrier, erase.rule (A2 §5), parallel.

## 2026-09-28 19:41 UTC — reviewer (B-SCENE review) — end
**Working on:** done; nothing committed by me. Changed: `PlateStore` (`put`, `endJob`, `_refuse`, constructor), `RasterRenderer`
(`_packable`, `_stillWanted`, `_releaseHeldLive`, `rasterStats`), `Stage._reconcile`, `KobinEngine.undo`/`redo`, `overlays.js`'s
ants outline window, testkit `harness.mkEngine` (opts) and `stageFuzz.runStageFuzz` ({raster}); tests `raster.plates`,
`raster.liveHold` LH-4, `raster.move` L3 (rewritten to §5.4 Q2), `stage.cover` (the watch reads the pack's list; C5 counts),
`stage.hold` (changesSince, one-commit undo/redo), `stage.equiv` (3 raster seeds); DESIGN §10's and 40-CALL-FLOW's live-hold limit.
**Measured:** scenario 7 (erase + zoom, worktrees, load 2.9 / 2.6): bake 36.0 s (1cac470) vs 34.8 s (list path, 9b1edbb);
172 vs 127 plates rastered, 149 vs 73 composes; 162 erase steps, ~14 tracked cells dirtied a commit, ~1 plate re-rastered a
step. Scenario 6: undo exact 70 vs 69 ms. Node: a 5,000-native delete 487–558 ms per-event vs 42–43 ms in one `stage.batch`
(its undo 796–867 vs 58–61 ms); 3 drag steps × 2,000 offset writes 365–570 vs 60–110 ms. Probes (1cac470): equiv 60×80, 0
diffs in 4,800 checks (lasso mutated 5 states); fresh 200×400, 0 in 715,314. Raster-engine fuzz 30×80: 0 diffs, 150 holds.
Break-checks (unimported 1cac470 copy): each new test red without its fix (1 each); release re-read removed → 1/3 raster
seeds red, 0/5 SVG seeds; a dropped tile piece → cover watch C2, C3 red. Quick suite 2,158 pass, 12 skipped, 5 fail (all in
B-PYRAMID-2's `PicturePyramid.plan`/`PyramidStore.property`, in progress), load 1.35 → 5.06; typecheck 0; lint 0 errors.
**Decisions made:** undo/redo batched here; `deleteSelection`, the no-plane drag step and replay are proposed (not my files).
**Questions asked:** in the report.
WHERE I AM: done.

## 2026-09-28 19:42 UTC — orchestrator (Fable) — the B-SCENE review landed (159f228); two agents run
**Working on:** the B-SCENE review's fixes committed with PLAN §5.7 (its report answered: the batching major's three
remaining wrappers to B-ERASE now; the post-paint sampler to B-PYRAMID-2; row 5's survivors to B-MODEL-C1's lint list;
`job.ids`/`_renderPending` to B-PYRAMID-2). Its measurements replace B-SCENE-2's: zoom-out paper 36.6 vs 49.8 ms
post-paint (not 9,784 vs 821); erase bake 36.0 vs 34.8 s; undo exact 70 vs 69 ms. B-PYRAMID-2 told its P1 files are
free. Running: B-ERASE (its new tests), B-PYRAMID-2 (P0). One slot free until B-ERASE reports (B-MODEL-C1's oracle
copy must be of the tree after B-ERASE).
**Measured:** the reviewer's quick suite 2,158 pass, 12 skipped, 5 fail (B-PYRAMID-2's in-progress suites), load 1.35 → 5.06.
**Decisions made:** PLAN §5.7 items 1–5.
**Questions asked:** none.

## 2026-09-28 19:55 UTC — B-ERASE (builder) — checkpoint: E1–E4 built, the new rows' suites green; break-checks next
**Working on:** new suites: `raster/raster.eraseRule.test.js` (row 3 a–d, 20 tests), `select.eraseBarrier.test.js` (row 7,
8), `erase.rule.test.js` (A2 §5.1–5.3, the pick, the landing's op on top, cut/dust dirt, lenient load, kobin-1 and kobin-2
derivation, the three §4.10 cases live vs replayed, parallel = serial for 3 seeds; 15). Found by them and fixed: the serial
order keyed by each id's z at arrival (a removed id's live lookup reordered the parallel bake — seeds 5, 8 red before).
The EraseChip (`src/Components/editor/EraseChip.js`) beside the title's save state; `status.erase` in the hook's default.
PLAN §5.7 item 1: `deleteSelection`, the drag step's writes and the store's `log.replay` each in one `stage.batch`.
**Measured:** row 3 (b), plates kept through the bake vs fresh: fills 0 bytes at every step (seeds 5/17/29, K4); strokes
with arcs, worst 3–6/255, all inside cut objects' boxes (seeds 11/23/37/59); nothing outside. §5.7 batch (node, 200 tracked
cells, Stage alone): delete 5,000 natives 530 → 57 ms, its undo 1,043 → 68 ms, 3 drag steps × 2,000 writes 735 → 76 ms.
Engine-level delete of 5,000 selected natives in jsdom: 73.7 s at 1cac470, 69.7–77.6 s now — not the Stage's; unattributed.
Bundles (`build:worker`): erase `3dc3c6f9…` (380,879 B), raster `03cb4428…`, scene `dce304b8…` unchanged. typecheck 0; lint 0
errors, 6 warnings (baseline).
**Decisions made:** as in the 19:32 entry; the dust test needed a shape target (a fill's promotion is a change of its own).
**Questions asked:** none new (Q5, Q6 stand).
WHERE I AM: break-checks on a copy under `scratchpad/b-erase/bc` (the rule's clauses, the landing batch, inheritance, the
classifier, dust, pruning, the lock, the reorder buffer, the z key, the barrier's flush, the pick), then docs, then test:erase.

## 2026-09-28 19:56 UTC — B-PYRAMID-2 (builder) — P0 checkpoint: the plan's two caps (PLAN §5.6 M1, M2)
**Working on:** P0 done. `PicturePyramid.js`: stand-ins capped at `COMPOSE_IMAGES − plane.images`, own-grid records
counted apart; at rest the level plan's plates are stand-ins (1:1 and own when Z is the level's own zoom); `_ownCount`,
`viewUnit` and the one-view record cap gone (`pinBound` in `report()`); a binding budget reserves each non-sharp cell's
coarsest exact source, then plans nearest the attention point first (`_coarsest`). `PyramidStore.js`: `ownBound`,
`pinnedBound` (the floor), the ceiling raised to the floor. `level.js`: `COMPOSE_IMAGES` moved here (the floor needs it;
no cycle). Suites: the review's four screens moved into `PicturePyramid.plan.test.js`, three old-cap tests rewritten, two
new (rest stand-ins, the binding reserve); the budget test at the four screens. Docs: PLAN §1.2, A3 §0.9, §1.4 (3)(4),
§1.5, §4.5, TEST-MAP rows. `MovePlane.js` untouched (its constants move at P3).
**Measured:** six suites 58/58 (52 before), 25 s, load 3.9; typecheck 0; eslint 0 on the five files. Break-checks on the
copy (`scratchpad/bp2/bc`), each red: cap ignores the plane 2; own counted against the cap 7; rest plates counted 1;
level plates own at rest 1; no 1:1 exemption 1; one-view record cap re-imposed 3; no cap 5; floor = view + plane 1;
ceiling not raised 1; own bound without σ = 1 1; reserve removed 1; no re-plan 1; sharp cells reserving 1. Pinned
bound: 110 desktop, 89 / 99 phones, 147 on 2560×1440@2. Phone high-water (390×844@3, 400 seeded jsdom screens, full
plane): 70 pinned vs 99. Paper beside a cached coarser plate (300 seeded screens each, desktop / 2560@2 / phone@3): level
mode under a drag plane 8 / 13 / 17 runs → 1 / 1 / 1 (one cell, the coarsest set over the cap); rest after long pans
1 / 13 / 6 (up to 10 cells, 21 %) → 0.
**Decisions made:** the reserve (A3 §1.5 says excess cells move to coarser sources; the cell-order plan did not; local to
`_planCells`, unchanged when nothing is refused); the ceiling rule for every device (a desktop lever of 64 is raised too).
**Questions asked:** none blocking — adopt the reserve (recommend yes). The B-SCENE reviewer has ended: on to P1.
WHERE I AM: P1 — read `RasterRenderer`'s constructor/frame step as the reviewer left them, then construct `PyramidStore`,
`PicturePyramid`, `JobQueue` under `cfg.pyramid` in the constructor.

## 2026-09-28 20:11 UTC — orchestrator (Fable) — GitHub Actions minutes exhausted: every commit now carries [skip ci]
**Working on:** Kobin's GitHub Actions minutes are used up. `.github/workflows/ci.yml` runs the quick suite (typecheck +
`test:quick`, 30 min cap) on every push, and today's snapshot pushes each started one (54 runs on this branch). From
this commit on every commit message, snapshots and landings alike, carries `[skip ci]`, which GitHub honours for
push-triggered runs; five runs still in progress on the branch were cancelled through the API. The nightly (03:17 UTC,
90 min cap) runs from the default branch's copy and is Kobin's to disable in the Actions tab if he wants it stopped;
`ci.yml` is not edited. Nothing in the rebuild reads CI: every suite and measurement runs in this container.
**Measured:** nothing new.
**Decisions made:** `[skip ci]` on every commit until Kobin says otherwise (task list #8).
**Questions asked:** none.

## 2026-09-28 20:13 UTC — B-ERASE — progress (break-checks)

**Done:** the break-check run on the unimported copy (27 breaks, one line each, 300 s cap) is at 24 of 27.
Red so far: handledBy clause (hang: the bake never empties), eraseReplaceById inheritance 9/51, classifier
without `by` 3/44, dust on the event 1/15, prune on re-entry 4/40, prune at spend 7/55, barrier lock 1/71,
serial order by z at arrival 2/15, barrier resolves perimeters 2/44, a press lands the mark 1/36, the pick
1/23, lookahead writes nothing 3/22, old-file named ids 1/21, attr entries 1/32, refusal handles 2/23,
barrier spends 3/21, `_ver` validity 2/17, byte masks 1/28.
**Zero red, now covered:** the rule's landed and z clauses (unreachable through the engine: registration
names only natives below the mark and a native's z never changes; a pure test pins each clause), the
landing's one commit (5.1 now watches every Stage commit for a landed mark without `targets`), cede's and
`_applyDescent`'s inheritance (a cede lineage test; two marks over an edge five crossings down), the
lookahead's per-target lock (M1's second descent waiting, M2's cut on it held: no stale job). Re-run of
those five on the copy after the run ends.
**Docs:** DESIGN §7 says the descent's pieces take their lineage from the live target at apply.
**Questions asked:** none new.
WHERE I AM: waiting for the last three breaks, then the five re-runs, build:worker, the erase suites, test:erase.

## 2026-09-28 20:25 UTC — B-PYRAMID-2 (builder) — P1 progress: the pyramid wired under `cfg.pyramid`, jsdom green
**Working on:** P1. In `RasterRenderer.js` (a `_pyr*` section: build, step, motion, prefetch at idle, margin, pack with
the covers filter, measure E/A/U/P, the pool face, result → `onResult`/`endJob`/`done`/`calibrate`, drop, the pen-up
group commit; one-line branches in `_frameStep`, `_releaseHeldLive`, `listMargin`, `setSize`, `dropCarry`,
`supportsDragPlane` false until P3, `destroy` clears the queue), `rasterWorkerClient.js` (`rasterPool`, `dispatch` returns
whether it posted), `jobQueue.js` (`clear`), `rasterPerf.js` (MODES + level, rest), `KobinEngine.js` (`pyramid` opt →
`cfg.pyramid`, `plates` = the renderer's store, `setLevers` live, the still frame in `_frame`, ladder and prebake off
under the flag), `useKobinEngine.js` (`pyramidFromUrl`, `hrefWithPyramid`, `setPyramid`), `CanvasEditor.js` (the toggle).
New suite `raster.pyramid.test.js` (7); the gate in `useKobinEngine.levers.test.js`; TEST-MAP rows.
**Measured:** raster.pyramid 7/7 three runs (load 5.5); levers 5/5; typecheck 0; eslint 0 errors (1 old warning). Break-checks
on the copy: 16 rules, each red (1–4 tests). raster + hooks dirs: 755/761 — red not mine: `raster.move` RV5 (commits
come from `selection.js:713` `_dragSelection` → `Stage.batch` while the Stage holds the drag: B-ERASE's edit; traced on the
copy), `rasterCore.clip.slow` 4 (whole-plate goldens differ: rasterCore/rasterPack changed, not by me), `raster.engine`
red once in the combined run, green alone.
**Decisions made:** the pen-up group commit done in P1 (`_pyrLive`), since `?pyramid=1` needs strokes to hand off.
**Questions asked:** none. WHERE I AM: a headless check of `?pyramid=1` on a dev server (port 3010), then the P1 entry.

## 2026-09-28 20:28 UTC — B-PYRAMID-2 (builder) — P1 checkpoint: `?pyramid=1` draws the app through the pyramid
**Working on:** P1 done (files as in the 20:25 entry, plus `DevStats.js`: the pyramid's own level/σ, rest executor,
images over 10 s, jobs by priority). `?pyramid=0` builds exactly the old path (the gate test; the old suites).
**Measured:** headless Chromium 141, 1280×800@1, dev server on :3010, load 4.9 → 4.5, `browser-check.js` round trip
(3 strokes, 40 wheel ticks out and back), same tree both ways — `pyramid=1`: 3 live holds, 3 handoffs, 0 timeouts; ink
25,244 px before and after, same hash; 196 composes, 53.3 ms compose in all, max 18 images; 114 plates, 0 evictions, 0
over-cap pins; no page errors. `pyramid=0`: ink 25,244 / 25,244, same hash; 1 handoff of 3 holds; 159 composes, 421.1 ms;
max 12 images. Rest mode reached after drawing on the pyramid (inline rest). jsdom: raster.pyramid 7/7 (×3), levers 5/5,
the six pyramid suites 58/58; typecheck 0; eslint 0 errors. Break-checks: 16 P1 rules, each red (1–4).
**Decisions made:** the pen-up group commit (A3 §3.6) wired now (`_pyrLive`); the drag plane off on the pyramid's path
until P3 (`supportsDragPlane` false: every drag step renders); the covers refusal only for worker jobs (an inline job packs
the camera's table, whose margin is four view cells); the client's own queue stays for the old path until P6.
**Questions asked:** `_renderPending` lives in `erasePipeline.js` (B-ERASE's): its removal (brief §3.2) needs that file —
recommend B-ERASE drops it, or the orchestrator hands me the three lines. RV5 red (`selection.js:713`'s `Stage.batch`
commits under a held drag) and `rasterCore.clip.slow` goldens (4) are not mine: for B-ERASE.
WHERE I AM: P2 — a jsdom test of the pen-up call order (the path goes in the task whose compose shows its plates), then
the olderMs fuzz (draw/undo/redo/erase/zoom/crossing with the fake pool).

## 2026-09-28 23:53 UTC — orchestrator (Fable) — resumed after the third session-limit stop of the day
**Working on:** the tree as B-ERASE and B-PYRAMID-2 left it at ~20:35 snapshot-committed as 2ab1a19; the container
rebooted again (every process gone, the scratchpad and transcripts kept). Both resumed from their transcripts:
B-ERASE at its docs step (TEST-MAP), with the two reds attributed to it restated (RV5's batch under a held drag; the
clip.slow goldens after the mask changes); B-PYRAMID-2 in P2 (the never-older fuzz with its own timeout), with
`_renderPending` deferred to P6. One slot free until B-ERASE reports.
**Measured:** load 0.12 at the resume.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-28 23:53 UTC — B-ERASE — resumed (after the reboot)

**Working on:** the end of E5. The tree is as I left it (2ab1a19): break-checks done (every break red; the
five that were 0 got tests: the rule's clauses, the landing's one commit watched per Stage commit, a cede's
lineage, a descent's pieces taking the live target's lineage, the lookahead's lock, slots per family).
RV5 is green (the drag step's batch is skipped while the Stage holds the move: a batch ends in a commit).
**Measured (the clip goldens, attribution):** the random lists' marks are unlanded raw strokes (no
`targets`), which the rule masks with nothing (A2 §4.1: packs skip an unlanded mark), so 8 of 24 plates
moved by up to 255. Given `targets` (every native below, the old semantics as data), 3 plates still moved
by 255: a **defect** — slots were shared by an item-level test while the core masks a family whole by all
its items' bits; fixed (conflicts per family), with a two-piece-family pixel test that was red before.
What remains: 1–2 levels (byte masks) in the opaque configs, larger RGB steps at low alpha on transparent
paper (to check premultiplied), 9 bytes (≤ 2) just outside my estimate of the marks' boxes.
**Decisions made:** none new. **Questions asked:** none new.
WHERE I AM: finish the attribution, give the generator's marks `targets`, regenerate the goldens, then
the clip suites, test:erase, the erase-adjacent quick suites, typecheck, lint, bundles, end entry, report.

## 2026-09-28 23:54 UTC — B-PYRAMID-2 (builder) — resumed after the session-limit stop (P2 mid-way)
**Working on:** P2, from the tree as snapshot 2ab1a19. Done before the stop, not yet logged: the pen-up group opens at the
Stage commit where the shape lands (`RasterRenderer._pyrBuild`'s `stage.onCommit` hook), so no frame's patch step can
publish the stroke's plates while the path is up; `PicturePyramid._markHeld` classes a stale draw under an open pen-up
group's rectangle "held" (the path shows the change), uncharged by the integrals; the prefetch key carries the Stage's
generation, so an idle after a change refreshes the stale coarser levels a zoom's stand-in needs. Tests in
`raster.pyramid.test.js`: the call order (never both, never neither), the rectangle equal to a whole render, the held
class through the workers, the prefetch refresh after a change, and the older fuzz (seeded draw/undo/redo/erase/zoom/pan/
crossings), whose rule is PLAN §1.2's: an older draw only where no exact source within N levels is cached (brute force).
**Measured:** before the stop: 9/10 of the suite green; the fuzz red on jest's 5 s default (5,549 ms), green at 3.6 s once.
Traces on the copy: older draws came from a zoom out of rest over a stale ℓv (fixed by the prefetch key), from a pen-up
group's wait (now "held"), and from a crossing onto a stale parent plate with nothing fresh cached (step (f), allowed).
**Decisions made:** the fuzz asserts step (f)'s rule, not "no older draw ever": with the gated pool a gesture can outrun
the idle refresh, and the plan's last resort is then the stale plate (PLAN §1.2). olderMs = 0 stays the harness's target.
**Questions asked:** none. The orchestrator's answers of 20:30 received (`_renderPending` at P6; RV5 and the goldens B-ERASE's).
WHERE I AM: rerun `raster.pyramid` with the fuzz's 60 s timeout; then P2's break-checks (the commit hook, `_markHeld`, the
prefetch key) and the P2 checkpoint entry.

## 2026-09-29 00:01 UTC — B-PYRAMID-2 (builder) — P2 checkpoint: the pen-up rule and the partial path
**Working on:** P2 done but `_renderPending` (P6, as answered). `RasterRenderer`: the pen-up group opens at the Stage
commit where the shape lands; the prefetch key carries the generation. `PicturePyramid`: `_markHeld` ("held" draws under a
waiting pen-up group). `jobQueue._aim`: a re-aim takes the new level's cells under the strip and on the predicted screen
(`childIdx` deleted). Tests: 4 in `raster.pyramid` (call order, the held class, undo/redo inline equal to a whole
render, the older fuzz) and the prefetch refresh; the descend re-aim in `jobQueue.test.js`. A3 §3.6, §4.3, §4.4 notes;
TEST-MAP rows.
**Measured:** the fuzz (2 seeds × 14 ops, gated pool): 508 plans, 10 older cells, each with no exact source within N
levels (brute force), 0 wrong. The call order: never both, never neither, the last compose `{path: false, plates: true}`;
the plates under the rectangle byte-equal to a whole render (undo and redo too). Suites: the six pyramid suites +
raster.pyramid + levers 74/74, load 1.9; raster.pyramid 11/11 twice. Break-checks on the copy: the commit hook 3 red,
`_markHeld` 1, the prefetch key 1, no re-aim 1, no patch step 1; the re-aim's clip widened ×3 is 0 (masked by the
queue's screen filter) — its evidence is the fuzz itself, red (RangeError) before the fix. Typecheck 0; eslint 0.
**Decisions made:** the fuzz asserts PLAN §1.2's step (f) (older only with nothing fresh cached), since a gesture can
outrun the idle refresh; `olderMs` = 0 stays the harness's target. The undo test pins `patchInlineMs` (the calibrated
estimate made inline-or-coarse vary run to run: one run went coarse-first, `sharp:7+blur:8` under the stroke).
**Questions asked:** none.
WHERE I AM: P3 — move `MOVE_PLANE_PLATES`/`_PHONE` into `level.js` (MovePlane re-exporting), then read `MovePlane.js`
and the renderer's plane section for the port.

## 2026-09-29 00:17 UTC — B-ERASE — end (E1–E5 of A2 §6.2)

**Working on:** done. RV5 green: the drag step's writes batch only while the Stage does not hold the move.
The clip goldens regenerated after attribution, which found a defect (below), fixed. ZO-3 (a) ported.
**Measured:** break-checks on the unimported copy, red/total: handledBy clause hang (the bake never empties);
landed 1/17, z 1/17, a mark never masked 1/17; the landing's one commit 1/17; inheritance: eraseReplaceById
9/51, cede 1/17, a descent's live lineage 1/18; classifier without `by` 3/44; dust 1/15; prune on re-entry
4/40, at spend 7/55; barrier lock 1/71; lookahead lock 1/8; serial order 2/15; barriers resolve perimeters
2/44; a press lands the mark 1/36; the pick 1/23; lookahead writes nothing 3/22; old-file named ids 1/21;
attr entries 1/32; refusal handles 2/23; barrier spends 3/21; `_ver` 2/17; byte masks 1/28; slots exact
2/23, per family 2/23; load derives targetOf 4/38; tap re-pick 3/37. Baselines 0/56, 0/57.
Clip goldens: the lists' marks had no `targets` (unlanded: mask nothing; 8 plates, up to 255). Landed
(`rasterLists.landMarks`), 3 plates still hid a family's ink above a mark: slots were judged per item while
the core masks a family whole — now per family, with a two-piece-family test red before. Result: 8 of 24
moved, 1,412 bytes, ≤ 2 levels opaque, ≤ 4 premultiplied on transparent paper, all under marks' ink.
PLAN §5.7 (Stage, 200 tracked cells): delete 5,000 530 → 57 ms; its undo 1,043 → 68 ms; 3 drag steps ×
2,000 writes 735 → 76 ms; store replay of 2,000 adds 157–166 → 44–89 ms (2,000 commits → 1).
Suites: test:quick 2,216 passed, 3 red not mine (raster.pyramid ×2, in flight; LH-1, green alone twice);
test:erase 303 passed, 1 skipped, 400.7 s (load 2.38 → 1.26); test:slow 502 passed, 6 skipped, 405.5 s
(load 0.86 → 1.42). typecheck 0; lint 0 errors, 6 warnings (none mine). Bundles unchanged: erase
3dc3c6f9…, raster 03cb4428…, scene dce304b8….
**Decisions made:** RV5 by wrapping only the unheld path (`Stage.batch` untouched); the testkit's marks
landed rather than the rule special-cased. **Questions asked:** none new; Q5, Q6 stand.
WHERE I AM: done; report handed back.

## 2026-09-29 00:21 UTC — orchestrator (Fable) — B-ERASE landed (5e84d43); its review launched; B-PYRAMID-2 at P3
**Working on:** B-ERASE's report read and answered in PLAN §5.8 (SM-5 kept for the tap's re-pick; the SVG renderer's
white-ink mark to B-PYRAMID-3 with the export barrier; a termination bound for the bake, added by the reviewer; the interim
erase pool until B-PYRAMID-2 P6; the ~70 s engine-level delete profiled by the reviewer, else wave 3's helper). The
review launched (`opus-reviewer`, brief `briefs/R-ERASE.md`): row 3 (a–d) with Kobin's drag-across case in headless
Chromium, the barriers' feel, the bound, per-family slots and the fringe, the parallel = serial fuzz, old files, undo under
a newer mark, costs, the deletion list, docs. My own check of the landing: `eraseRule.js` is the pure rule as A2 §4
states it (landed, not erase, z below, targeted and not handled), `_stepOf` clips a step's dirt to the mark's box plus
its dust, the drag-across case has a jsdom test in two suites. Running: B-PYRAMID-2 (P3), the B-ERASE reviewer.
B-MODEL-C1 launches when the review ends (its files overlap).
**Measured:** B-ERASE's: test:quick 2,216 pass (3 reds in flight elsewhere), test:erase 303, test:slow 502; row 3 (b)
fills 0 bytes, strokes 3–6/255 on cut outlines; batching 530 → 57 ms (delete 5,000), 1,043 → 68 (undo), 735 → 76 (drag).
**Decisions made:** PLAN §5.8 items 1–8.
**Questions asked:** none.

## 2026-09-29 00:22 UTC — reviewer (B-ERASE review) — R-ERASE items 1–11 — start
**Working on:** the review of B-ERASE (5e84d43) on the tree at 31bdf3f, brief `briefs/R-ERASE.md`. Read: CLAUDE.md,
the preamble, PLAN §0/§1.3/§3 row 3/§5.3/§5.7/§5.8, DESIGN §7, A2 §4–§6.4, B-ERASE's entries. Order: baseline erase
suites, then item 3 (the bound) and item 9 (deletion grep) in code, items 1a/5 (oracle and fuzz, jsdom), item 4 and 1b
(core bytes), items 6–7, then the browser items (1b/1d/2/4 in headless Chromium, dev server on :3020), item 8, docs.
**Files I may edit:** `src/engine/{eraseRule,cede,erasePipeline,eraseJob,eraseDescent,eraseWorkerClient,Document,
format2,persist,oplog,files,selection,frameGc,sceneClient,report}.js`, `raster/rasterPack.js` (mark block),
`raster/rasterCore.js` (mask functions), `raster/rasterJob.js` (`MASKS_MAX`), `Stage.js` (`_stepOf`, Item getters),
`KobinEngine.js` (`_initErase`, barrier sites, status), `EraseChip.js`, `useKobinEngine.js` (erase status), the erase
suites and probes, `__testkit__/{harness,rasterLists,clipSuite}.js`, DESIGN §7/§13, A2 §5.5, OPEN-FLAGS F65.
Not mine: B-PYRAMID-2's raster/renderer files; `KobinEngine.js`/`Stage.js` re-read before each small edit.
**Measured:** nothing yet (load 0.54, 4 cores).
**Decisions made:** none. **Questions asked:** none.
WHERE I AM: baseline run of the erase suites, then reading `eraseRule.js`, `cede.js`, `erasePipeline.js` by sections.

## 2026-09-29 00:27 UTC — B-PYRAMID-2 (builder) — P3 checkpoint: the MovePlane port
**Working on:** P3 done. `level.js` holds `MOVE_PLANE_PLATES`/`_PHONE` (MovePlane re-exports; PyramidStore imports from
level.js, no cycle). `MovePlane({pyramid})`: `planeKey` at Zp = the view's grid Z, `/ 2^k` coarser, quick `Zp / 4`;
whole only when exact; D1 (SEL runs to one view past the screen). `RasterRenderer`: the plane on (`supportsDragPlane`
true), `_planeStep` in the pyramid's step, plane jobs at priority 2 under a `plane` purpose generation, a dropped
layer's late plate discarded, the stale-plate re-ask by generation, `_pyrPlaneOf`, `_pyrStopgap` (SEL + BELOW/OVER over
the footprint via `PicturePyramid.renderNow`), the landing on arrivals; `_planeIdle` skips the old hold/settle.
`PicturePyramid`: H4 in the partial plan, `cellFresh` (the landing's test, shared with `_landClip`), `renderNow`.
Tests: 5 in `raster.pyramid` (15 in all), the plan suite's partial case rewritten to H4. A3 §6 note; TEST-MAP row.
**Measured:** raster + hooks directories 779/779 (1 min 6 s, load 3.7); typecheck 0; eslint 0. Break-checks on the copy,
14 plane rules, each red (1–2): the keys, Zp, D1, exact wholeness, H4, `cellFresh`, the asked map, the generation bump,
the late-plate discard, the plane handed to the pyramid, the re-ask by generation. Found by those tests: the plane's
asked set remembered a key for ever, so a plate staled under an unchanged layer was never asked again (fixed: a map of
the G asked at). A drop whose re-render fits inline lands in its own task (the drop's frame patches the cells).
**Decisions made:** the plane stays on the old path unchanged (every pyramid rule is under `MovePlane({pyramid})` or
`this.pyramid`); the stopgap lands its plates in the store rather than a side table, so the plan draws them as any plate.
**Questions asked:** none. Q8's measurement is P5's (scenario 4).
WHERE I AM: P4 — `rasterWorkerClient`: `failPool` requeues the queue's strips (`requeue`), and `_aim`'s arrival estimate
from the real dispatch; then the camera's budgeted read (§3.1) and `job.ids` off the wire (§3.3).

## 2026-09-29 00:50 UTC — reviewer (B-ERASE review) — checkpoint: the bound, the oracle through undo, the fuzz
**Working on:** items 3, 1a, 1b (node), 5 done in code and suites; in `erasePipeline.js`, `report.js`, `useKobinEngine.js`
(erase status only), `erase.rule.test.js`, `raster/raster.eraseRule.test.js`, new `erase.parallel.test.js`.
**Measured:** baseline before edits: the erase-adjacent quick suites 46 files, 416 pass, 1 red (sceneClient, load 6.2,
green alone 33/33); the rest of test:quick 1,914 pass, raster.pyramid red (B-PYRAMID-2's). The bound: a wrong rule
(`handledBy` ignored) now aborts within 2 × supply + 8 steps in flushErases, the tick through a pool and an inline tap
barrier; the correct rule's steps ≤ its supply (ratio ≤ 1) through undo/redo mid-bake. Row 3 (a) through undo/redo and a
crossing: 6 seeds green. Row 3 (b) two clauses, 7 seeds (node): off both clauses 0 px; on cut outlines ≤ 9/255; within 1.5
px of a mark edge up to 36/255 (seed 71: a graze splits two marks' shared slot, 1 − max(a,b) → (1 − a)(1 − b) where their
edges overlap, with no dirt — inside the envelope, cleared at the next dirt or the spend). Fuzz, 60 seeds: 858 ops, 1,447
pairs/spends, ≤ 3 in flight, 42 worker deaths, 20 silent jobs (watchdog), 52 respawns, 4 seeds inline past the respawns,
47 crossings, 75 undos: document equal after every op; found and fixed: a barrier round promoted fills at dispatch, so the
log's put/bake order differed from the inline bake (seeds 1016, 1037 red before).
**Decisions made:** the budget counts `_applyPair` and a non-shape refusal; supply = pending lineage at the first step plus
every later arrival pending under the mark (another mark's piece, an undo's source, a frame back).
**Questions asked:** none yet (a watchdog-lost job runs inline on the main thread: to report).
WHERE I AM: item 4 (the fringe of a half-handled family, core bytes), then items 6, 7, 9, then the browser items.

## 2026-09-29 01:01 UTC — B-PYRAMID-2 (builder) — P4 progress: the queue's failure path, the arrival estimate, the budgeted read
**Working on:** P4. Done: `failPool` hands a queue strip back (`onRequeue` → `_pyrRequeue`: its id ended, `requeue`, a pump);
`_aim`'s arrival = the view's age + the mean dispatch-to-landing time (in-flight strips no longer counted; a failure is no
sample, `done(id, false)`); `job.ids` off the wire (the packer keeps them for the suites; the worker never had a use).
The camera's read (A3 §4.2): under `cfg.pyramid` a camera step syncs with budget 0 (a document render still reads all);
`_readIdle` reads the missed tiles after the rest's quiet, a `LADDER_SLICE_MS` slice an idle callback, and steps the
renderer when the table changed; the plan asks for no cell the table does not cover (`covered`: view, rest, patch, plane,
near prefetch), the pack refuses one that left since and `unask`s it; the inline executor lands only what was packed.
**Found:** P3's quick-level test raced a fixed 200 ms wait against the plane's 150 ms quiet under load (red on the pristine
tree, so four of P3's break-checks were red for that reason): it now waits for the aim; re-run, 13 of 14 P3 breaks red on
their own tests, and the 14th (a dropped layer's late plate stored) 0 red because the store already refuses it (`dropWhere`
marks its job) — the renderer's second discard is deleted. `raster.eraseRule`'s "family half handled" test is red on the
tree (the B-ERASE reviewer's, in progress; not touched).
**Measured:** raster.pyramid 19/19, PicturePyramid ×3, jobQueue 8/8, prefetch, raster.job/worker/clip 69/69; typecheck 0;
eslint 0 errors. Break-checks for P4a (9 rules) each red on its test.
WHERE I AM: P4 break-checks for the read/cover rules, the raster + hooks suites, then the P4 checkpoint entry.

## 2026-09-29 01:16 UTC — reviewer (B-ERASE review) — progress: items 4, 6, 7 and 1d measured; the browser's feel running
**Working on:** `erasePipeline.js` (`_markAlive` reads the redo stack only; a new op prunes the marks its dropped redo
branch held), `erase.rule.test.js` (undo under a newer mark ×3, a frame back under a pending mark), `raster.eraseRule.test.js`
(the fringe ×2), new `erase.oldStore.test.js` + `__testkit__/preErase.store.json` (22 KB, made by 1cac470's engine),
`erase.worker`/`select.eraseBarrier` (status gains `aborted`). Dev server on :3020 (Node 14).
**Measured:** item 1d, headless Chromium through the app (Y dragged across a held-pending mark): Y's pixel over the mark
[30,60,200] at the drag's last steps and after the drop, T under the mark [255,255,255]; released, the bake ends in 697 ms,
Y live with its 82 pieces (never cut), T replaced. 1b in the browser: kept plates vs a fresh page of the same document,
after each step: 0 bytes, 0 bytes. Item 4: a family half handled — node core 424 px, max 59/255; browser 430 px, max
59/255; all within 1.5 px of the mark's edge (c − c², a quarter of the contrast at most): inside row 3 (b)'s envelope.
Item 6: the pre-B-ERASE store loads, registers both landed marks by the old rule (one attr entry each; a second sight
changes nothing), the redone old mark registers once, the bake ends at the old engine's areas to the bit, every gesture
undoes; the deployed reader (0732252) keeps `targets`/`targetOf`/`handledBy` through `_extra` in kobin-2 frames and in a
kobin-1 file (version unchanged). Load 1.0–2.2 during these; 7.2 now (other agents).
**Decisions made:** fixed as minors — a redone-and-spent mark was "alive" through its op's stale `strokeRec`; a dropped redo
branch left its marks' ids on live natives (DESIGN §7 says never). Both red-before tests are in `erase.rule`.
**Questions asked:** none yet.
WHERE I AM: the feel run (item 2), then break-checks on `scratchpad/r-erase/bc` (bc.py), item 8, item 9 docs, item 11.

## 2026-09-29 01:18 UTC — B-PYRAMID-2 (builder) — P4 checkpoint: the queue adopted, the camera's budgeted read, `job.ids` off the wire
**Working on:** P4 done. `rasterWorkerClient.failPool` hands a queue strip back (`onRequeue` → `_pyrRequeue`: its id ended,
`requeue` at the head of its priority, a pump; H7). `JobQueue._aim`: arrival = the view's age + the mean dispatch-to-landing
time the queue measures from its own dispatch (no in-flight count: `pump` dispatches only to a free slot); a failure is no
sample (`done(id, false)`). `job.ids` off the wire (the packer keeps them for the suites). The budgeted read (A3 §4.2):
under the pyramid a camera step syncs with budget 0; `KobinEngine._readIdle` reads the rest after the rest's quiet, a
`LADDER_SLICE_MS` slice an idle callback, stepping the renderer; `PicturePyramid.covered` keeps uncovered cells out of the
view's, the rest's, the patch step's, the plane's and the near prefetch's asks; the pack (inline too) refuses a cell whose
tiles left and `unask`s it; a pen-up group asks its refused cells again once covered (the path stays up). Deleted: the
renderer's late-plane-plate discard (the store's `dropWhere` refusal already does it). Deferred to P6 with the old path
(`?pyramid=0` is P5's comparison): `current`, `dropStale`, `pruneCurrent`, the q form of `dropQueued`, `bestIndex`/`LOW_PRIO`
and the client's `STRIPS_PER_WORKER`. A3 §4.2/§4.4 notes; TEST-MAP rows.
**Found:** P3's quick-level test raced a fixed 200 ms wait (red on the pristine tree under load, so four P3 break-checks were
red for that): it waits for the aim now; re-run, 13 of 14 P3 rules red on their own tests, the 14th was a second mechanism.
**Measured:** the quick suite 2,257 of 2,270 (12 skipped; one `raster.engine` test red once at load 6.8, 43/43 in five reruns
incl. three concurrent — the old path's timing rules; the filtered log did not name it); raster.pyramid 22/22;
typecheck 0; eslint 0 errors. Break-checks on the copy: 26 P4 rules, each red on its own test (1–2).
**Decisions made:** the budgeted read under `cfg.pyramid` only (the old path keeps `Infinity` until P6); the idle read waits
the rest's quiet (100 ms) and steps the renderer every slice (an empty tile covers without a commit); one cover test
(`covered`) for the plan, the plane and the near prefetch; the queue counts dispatches by priority (the harness's column).
**Questions asked:** see the report (D1's SEL cells past the table's window).
WHERE I AM: P5 — `npm run build:worker`, a dev server on :3010, the harness both ways.

## 2026-09-29 01:47 UTC — reviewer (B-ERASE review) — checkpoint: items 1–11 measured; final suites running
**Working on:** test:erase and the erase-adjacent quick suites on the final tree; then the end entry and report.
**Measured:** item 2 (headless, script time, load 2.5–4.3): a tap during a bake parks and selects in 84–126 ms (under the
chip's 150 ms), the piece under the finger (SM-5); a drag's start parks 418 ms, then the selection moves exactly the
finger's (240, 120); a lasso parks, chip at 240 ms, judged at 378 ms; a second press cancels a parked tap. The bake alone
3.2 s; with a tap-selected 413-piece object left selected, 42–48 s and the page's main thread saturated (profile: 5.9 of
8.3 s in `packJob` → `prepassFor`/`famFill`, `_aimPlane` 1.0 s); deselected, 5.1 s — reported, not mine to fix. Item 1c:
a constructed stack under two marks, before vs after the bake: node 358–436 px, ≤ 37/255 within 1.5 px of a mark's edge,
≤ 9/255 on cut outlines, 0 elsewhere; browser 325 px, max 36, 87 px off the band at ≤ 6/255, kept vs fresh 0 bytes.
Item 8: scenario 7 pair eraseBakeMs 19,772 / 18,405 (B-SCENE review: 36.0 s), paper 0 on all three samplers, 59 long
frames each (worst 798 / 667 ms), load 1.9 / 4.0; the 5,000-native delete 24.9–26.2 s in jsdom: 18.7 s of it two.js
rendering the selection overlay from the per-remove listener (`KobinEngine.js:284–317` → `_setSelection`), O(n²) —
not one line (wave 3's helper). Probes: erase.stack N=100 (cuts 22 ms median, lasso at 50 1,283 ms); erase.stuck and
paper.cost need Kobin's exports (not in the container). Break-checks (copy `scratchpad/r-erase/bc`): budget 4/26 (suite
5 → 43 s without: flushErases spins to its 100,000 guard), round promotion 2/8, alive-redo-only 1/25, prune-on-op 1/25,
supply on add 1/34, on a frame back 1/25; two 0-red lines deleted; B-ERASE's lock 0/98 on this tree (was 1/71) → a
frame-drag lock test added, now 1/99; serial order 4/34; inheritance 15/67.
**Decisions made:** a pool job lost to the watchdog runs inline on the main thread (a hang there hangs the tab): a design
question (a reason on the rejection), not fixed.
**Questions asked:** in the report.
WHERE I AM: read test:erase and the quick set's results, stop the dev server, end entry, report.

## 2026-09-29 01:56 UTC — reviewer (B-ERASE review) — end (R-ERASE items 1–11)
**Working on:** done; report handed back. Dev server on :3020 stopped. Files: `erasePipeline.js` (the step budget; pruning
when a new op drops the redo branch; `_markAlive` from the redo stack; a round's fills promoted first), `report.js`,
`useKobinEngine.js` (erase status `aborted`), `oplog.js` (comment), the suites `erase.rule`, `raster/raster.eraseRule`,
`select.eraseBarrier`, `erase.worker`, new `erase.parallel`, `erase.oldStore` + `__testkit__/preErase.store.json`;
DESIGN §7/§13, A2 §4.15/§5.5/§6.4, TEST-MAP (2 rows), OPEN-FLAGS F65, `docs/ai/30-CODE-MAP.txt` (2 stale lines).
**Measured:** final: test:erase 303 pass, 1 skipped, 399 s (load 2.0 → 1.8); the erase-adjacent quick set 49 files, 447
pass, 2 skipped, 68 s; the engine/hooks/cloud/storage set 48 files, 425 pass; typecheck 0; eslint 0 on the changed files.
Before: the erase set 419 (1 load flake, green alone); the rest of quick 1,914 (raster.pyramid red, B-PYRAMID-2's).
Everything else in the 00:50, 01:16 and 01:47 entries.
**Decisions made:** two break-checked lines at 0 red deleted rather than kept (a spent mark's round pair guard, the
budget's delete on removal); the fringe of a half-handled family judged inside row 3 (b)'s envelope (location).
**Questions asked:** the watchdog-lost job run inline (design question); the selection-during-bake slowness to
B-PYRAMID-2; the sentence for Kobin on undo under a newer mark.
WHERE I AM: done.

## 2026-09-29 01:57 UTC — orchestrator (Fable) — the B-ERASE review landed (5e9b1dd); B-MODEL-C1 launched; PLAN §5.9
**Working on:** the B-ERASE review's report answered in PLAN §5.9: its three majors assigned (the watchdog-lost job
refused instead of run inline and the cuts into the shared queue → B-PYRAMID-2 P6; the selection-during-bake 8–9×
slowdown → B-PYRAMID-2 P5/P6 with the profile; the delete's O(n²) selection overlay → B-DRAG/C2). B-MODEL-C1 launched
(`opus-builder`, brief `briefs/B-MODEL-C1.md`; the frozen oracle copies the tree at its start). Running: B-PYRAMID-2 (P5,
the harness pairs), B-MODEL-C1 (M0). One slot free; B-PYRAMID-3 waits for B-PYRAMID-2.
**Measured:** the review's: Kobin's drag-across case in headless Chromium (the dragged object's colour over the pending
mark, uncut at the landing); barriers: a tap parks and selects in 84–126 ms, a drag's start 418 ms, a lasso judged at
378 ms; scenario 7's bake 19.8 / 18.4 s (the B-SCENE review's pair: 36.0 s); the fuzz 60 seeds, 42 worker deaths,
documents equal after every op.
**Decisions made:** PLAN §5.9 items 1–5.
**Questions asked:** for Kobin, non-blocking: the reviewer's sentence on undo under a newer mark (§5.9 item 4).

## 2026-09-29 01:58 UTC — B-MODEL-C1 (builder) — A1 C1: a frame's shift is placement, composed on read — start
**Working on:** read the brief, both preambles, CLAUDE.md, DESIGN §2/§3/§8/§13, PLAN §0/§1.7/§3/§4/§5.2/§5.7–§5.9, A1
§0/§1/§2/§4.1/§4.4/§5/§6/§8/§9/§13, `placementModel.js`, the end entries of B-FOUNDATION, B-SCENE-2, B-ERASE and the
B-SCENE review. Launch commit 5e9b1ddb (the oracle's freeze point). M0 first: `__oracles__/model-v1/` (Document,
LevelMap, TileStore, selection, oplog and the changed imports, self-contained), then the `ensureId` spine gap.
Files I am in (brief §6): `Document.js`, `LevelMap.js`, `TileStore.js`, `placementModel.js`, `geometry/offsets.js`,
`oplog.js`, `persist.js`, `format2.js`, `files.js`, `frameGc.js`, `sceneClient.js`, `report.js`, the named lines of
`overlays.js`/`selection.js`/`erasePipeline.js`/`eraseDescent.js`/`cede.js`, `Stage.js` (settle handling only),
`KobinEngine.js` (settle subscription, footprints only; shared with B-PYRAMID-2: re-read before each edit), new
`legacy/modelV1.js`, `__oracles__/model-v1/`, new suites, `package.json`'s eslintConfig, the M4 docs.
**Measured:** nothing yet (load 2.86 / 2.93 / 2.76 at start; B-PYRAMID-2 at P5 beside).
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: M0 — copying the five model files and their changing imports into `__oracles__/model-v1/`.

## 2026-09-29 02:14 UTC — B-MODEL-C1 (builder) — M0 checkpoint: the frozen oracle, the spine gap
**Working on:** M0 done. `src/engine/__oracles__/model-v1/` = the engine closure at 5e9b1ddb (21 files, 15.9k lines, only
import lines rewritten; `README.md` there and a paragraph + row in `__oracles__/README.md`): the five model files plus
every module that reads the settle or that C1 edits (KobinEngine and its mixins, Stage, placementModel, offsets,
eraseDescent, cede, eraseWorkerClient, frameGc, persist, format2, sceneClient/sceneOps) and the SVG `Renderer`
(B-PYRAMID-3's to reshape); raster symbols through `rasterShim.js` (SVG path only), geometry/frameLattice/Camera/eraseRule
live. `modelV1.test.js`: no production file imports `__oracles__`; the oracle settles a subtree move at the first read.
Spine gap: `LevelMap.ensureId` + `_ensureSpineId` mint a bare spine id ("2") and a twin spine id ("2#3", as the
resident's shadow); `lattice.ensureId.test.js` EI-7, EI-8 (a dev-0 snapshot naming "2" on a fresh lattice, camera at "1":
drawn through "1"'s down tiles after the load).
**Measured:** suites 9/9 (modelV1 2, ensureId 7); lint 0 on the oracle dir. Break-checks (bm1/bc copy): spine mint 2/7,
twin parse 1/7, taken cell → shadow 1/7, a production import of the oracle 1/2; baseline 0/9.
File format (A1 §5 versions): persist validates a natives key by `FRAME_ID` only, never against `crossings`, so a
kobin-1 v1/v2 file can carry natives under a spine id its lattice lacks; the app never writes one (serialize lists every
frame; GC never forgets a frame with natives). The deployed build loads such a file with those natives undrawn and
writes them back unchanged (`serializeNatives` walks `nativesByLevel`); this build draws them. No version change.
**Decisions made:** the oracle is the whole engine closure, not the five files alone: the settle's glue lives in
KobinEngine (subscription, `_flushCarried`), selection and Stage, and a live driver over a frozen model would not be
today's engine. The tile fuzz compares pictures through each engine's own model.
**Questions asked:** none.
WHERE I AM: M1 — `placementModel` composition + `objShift`/`residual` carry + reroute by home, beside the settle.

## 2026-09-29 02:22 UTC — B-PYRAMID-2 (builder) — P5 progress: the pack memo, before the harness pairs
**Working on:** P5. The first pyramid run of the harness showed `olderMs` 5.6 s and 700–1,700 ms frames while the stack's
mark baked (> 70 s under the pyramid, 15 s on the list path). Profiled: 11 of 15 s in `packJob` → `prepassFor`/`famFill` →
`entryFor` rebuilds. The pack memo thrashed (10 MiB against ~20 MiB of the table's entries: every prepass rebuilt every
entry) and was keyed by the wrapper, so a snapshot's items never hit. Fixed in `rasterPack`: the memo keyed by the
geometry (`item.piece`), `PACK_BUDGET` 64 MiB (a phone 32), `outsideWin` (the cached drawn box) before any entry in
`visibleChords` and `_pyrMeasure`; one list a snapshot table; the prefetch plans after the scene's quiet (100 ms after a
commit), a new plan's generation dropping the old plan's queued strips; the plane's pre-aim waits for the scene's quiet
as for the view's (PLAN §5.9 item 2). Two suites' fixed waits (`raster.move`'s scene, M2) now wait for the aim.
**Measured:** the B-ERASE review's selection-up bake (the 413-piece target, its `browser-feel.js` cancel case on :3010):
list path 47.4 s → 1.8 / 2.0 s, pyramid 90.8 s → 1.7 / 8.0 s (load 2.0–2.8); the stack's mark bake after load, pyramid
at 64 MiB, 6 s (the list path 15 s at 10). raster + hooks 791/791; typecheck 0; eslint 0 errors.
**Decisions made:** the memo budget raised (a memory policy: my question in the report, with the phone's half).
**Questions asked:** the memo budget (64/32 MiB) — kept or another number.
WHERE I AM: the harness pairs when the load is under 2 (pyramid=0 then 1, twice), then scenarios 1–2 at levelStep 2/3.

## 2026-09-29 04:52 UTC — orchestrator (Fable) — resumed after the fourth session-limit stop
**Working on:** no reboot this time: the tree was already clean at aa90202, B-PYRAMID-2's dev server on :3011 survived
and its first harness pair had completed (`bp2/p5/pair1-p0.out`, `pair1-p1.out`, 02:48). Both agents resumed from
their transcripts: B-PYRAMID-2 (the second pair and the level-step runs on the quiet machine, then the P5 entry and
its report — a successor does P6 if its context is past two thirds), B-MODEL-C1 (M1 from the TileStore reroute
section).
**Measured:** load 0.17 at the resume.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-29 04:52 UTC — B-PYRAMID-2 (builder) — resumed after the session-limit stop (P5)
**Working on:** P5, from the tree as left (aa90202, clean). Pair 1 of the harness finished before the stop (02:48,
`scratchpad/bp2/p5/pair1-p{0,1}.out`, on a frozen copy of f55f7d8 served on :3011 — the shared tree's hot reloads from
B-MODEL-C1's edits replaced the harness page's engine mid-run on :3010, which emptied the document for scenarios 3–7;
the harness now reloads the drawing until it holds and prints `natives` on every row). Load now 0.15.
**Next:** pair 2 (pyramid=0 then 1) and scenarios 1–2 at `levelStep=2` and `3`, on the same frozen server; then the P5
checkpoint entry with the table and the report (`status: checkpoint`, P6 to a successor: my context is past two thirds).
WHERE I AM: starting pair 2 on :3011.

## 2026-09-29 04:54 UTC — B-MODEL-C1 (builder) — resumed after the session-limit stop (M1 mid-way)
**Working on:** the tree is as I left it (aa90202 / 2f92fb1); my context survived, so M1 is further than "the TileStore
reroute section": in the tree are the composition (`Document.tableOf`, `displacedNatives`, `hasOffsets` counting shifted
frames; `offsets.composeShift`, `homeTranslation`; `residual` → `{carry, rem}`), `objShift`/`frameShifted` honouring the
home-depth carry, `TileStore._rerouteGroups` grouping every displaced native (own tables + shifted frames by home, views
above the home, carried-into groups whose F0 is the home), `ownContent` deleted, `placementModel` (`nativesIn`,
`placement`, `drawnLive`, `table`, `frameFootprint` union with the shift, `reachBox`), the readers switched (lasso box +
H6 in `_lassoMoved`, erase frame pass box, `_selTable` frame box and key, `listFor` stamping, Stage `_stateOf`/dust/
offsetsOnly states and `_reconcile`'s live check, sceneClient), refile events carrying `shift`. At M1 `nativesIn` still
reads `doc.at` (settle and merge beside, as briefed). Model-adjacent suites: 556/566 before two fixes, then green
(move.twin, reroute.memo ported); sceneClient red once under load, 33/33 alone.
**Measured:** nothing new since the stop (load 0.09 now; B-PYRAMID-2 P5 at :3011).
**Decisions made:** none new.
**Questions asked:** none yet (one coming at the checkpoint: `displaced` still mints a reroute source frame, A1 row 19,
against the brief's "no mint on read").
WHERE I AM: M1 — writing `model.equivalence.probe.js` (oracle vs live, pictures per native at four frames per op).

## 2026-09-29 05:04 UTC — B-MODEL-C1 (builder) — M1 checkpoint: the composition, beside the settle
**Working on:** M1 done (the edits of the 04:54 entry) plus the tile fuzz: `__testkit__/modelFuzz.js` (one seeded op
sequence — stroke, a descent to ink a kid, erase at depth, tap and lasso drags, subtree drag, delete, undo, redo, zoom,
pan, kobin-1 and op-log reloads, GC — drawn from the oracle's picture and replayed on both engines; `lcg` now exported
from `stageFuzz.js`) and `model.equivalence.probe.js` (after every op, `Stage.snapshot` over the whole cell of the camera
frame, its parent, the heaviest ring neighbour and kid; native for native: bit for bit when homed alike, through the
picture when the oracle carried it, ≤ 1 ulp above its home).
**Measured:** fuzz 20 seeds × 40 steps (seeds 1–20): 800 checks, 1,793 frames, 6,705 items (3,752 tile pieces, 1,366 with
an offset) all bit-identical, 0 carried (both engines settle at M1), 44 subtree drags, 83 tap drags, 81 descents; 18 s.
Harness round trip, pre-C1 worktree (5e9b1dd, :3030) vs M1 worktree (761d428, :3031), headless Chromium, load 4.9–5.9:
25,244 ink px before and after on both, same hash, all four screenshots byte-identical between the trees. Suites
(model-adjacent 48 files): 566 tests green after porting `reroute.memo` (hits → the same memo object) and restoring
`doc.at` in `nativesIn` for M1; `sceneClient.test` red once at load 3, 33/33 alone. typecheck 0; lint 0 errors.
**Decisions made:** `residual` returns `{carry, rem}` (its callers take `.rem` or `homeTranslation`); the reroute's memo
stays in TileStore (its memo tests stand) and the model reads it; `ownContent` deleted (`nativesIn` is the one "own"
read); `_bakeTick` (timed) kept out of the fuzz, `flushErases` or a pending mark instead.
**Questions asked:** (1) `displaced` still mints a picture's source frame F0 when the lattice lacks it (A1 §1.2 row 19
"kept"); the brief says no mint on read. A peeking form needs tiles for a frame the lattice lacks. Recommend: keep it
for C1, name it in PLAN §3 row 8 as the one exception (an empty frame, GC'd), the pure-read test asserting the rest.
(2) The dense scenarios save no final-frame screenshot (brief §3 Counters wants one); a `--shot` flag would do it.
WHERE I AM: M2 — `Document`: settle out of `at`/`add`/`remove*`/`insertAt`/`rehome*`, merges to the action's end.

## 2026-09-29 05:27 UTC — B-PYRAMID-2 (builder) — P5 checkpoint: the harness both ways
**Working on:** P5 done. `browser-check.js --dense --scenario all` (post-paint sampler, the load at each run's ends, the
pyramid's own integrals, jobs by priority, `natives` a row) on ONE frozen tree (f55f7d8 from `git archive`, served on
:3011: the shared tree's hot reloads swapped the page's engine mid-run on :3010 and emptied scenarios 3–7). Seed 1,
1280×800@1, 3 workers. Three pairs back to back; **reference = pair 1** (the quietest: old 1.37→2.81, pyramid 2.81→2.42;
pairs 2|3 began their pyramid half at 7.7|5.5, other agents' dev servers and suites). Old path: rAF sampler (post-paint
in brackets); pyramid: its own `paperMs/blurMs/olderMs` (post-paint in brackets). Old → pyramid, reference (pairs 2|3):
1 out: paper 304 (301) → 4.1 (3.6) [0|52 → 4.6|0], blur 49, older 0; >33 ms frames 61 → 9; long 24 (worst 7.7 s) → 4
(0.7 s); compose 285 ms, 29 img → 35 ms, 16; jobs by prio [6,55,0,0,216,0]. 1 back: paper 0 → 0 [0|0 → 415|702], blur
3,892; >33 72 → 19; long 15 (1.6 s) → 11 (1.2 s); 228 ms/29 → 36 ms/8. 2 slow: paper 0 → 0, blur 13, older 0; >33 64 → 24;
long 27 (4.7 s) → 9 (1.2 s); 161 ms/29 → 57 ms/16. 3 pan: all 0; >33 10 → 6; long 4 → 4; 14 → 12 img. 4 lasso: 45 both.
4 drag: 33 images both, the pyramid's through the surface (42 surface composes), older 595 [515|358] ms, long 5 → 22.
5 pen-up: release 200 → 155 ms (exact at release), exact 203 → 161 [139|117 → 299|296]. 6 undo: exact 46 → 299 [57|59 →
83|4]. 7 erase + 30 ticks: bake 5.3 → 6.6 s [8.6|5.8 → 6.6|7.1]; pyramid blur 872, older 1,701 [2,065|2,190].
Plates: old 96/96 MiB, 8 pinned; pyramid 90/90, 8 pinned (33 with the plane). levelStep 2|3 (pyramid, one run each, load
2.4|2.5): 1 out paper 0|0, blur 15|14, long 41|41; back blur 3,504|3,191; 2 slow blur 17|24, long 48|28, older 0.
Round trip (plain mode): 25,244 ink px before and after, same hash, both paths.
**Measured:** `olderMs` 0 in scenarios 1, 2, 3, 5, 6 on every run; non-zero in 4 (the drop) and 7 (the bake): stale
cells whose patch fits no level inline wait for the workers (A3 §3.4's one case) — not verified per cell. Break-checks
P5: 7 rules, each red on its own test. raster.pyramid/job/move 110/110 at load 2.3; typecheck 0; eslint 0 errors.
**Decisions made:** pair 1 the reference; no more pairs. **Questions asked:** in the report (the memo budget, D1, 4/7's older).
WHERE I AM: P5 done; P6 goes to a successor from the report's openItems (my context is past two thirds).

## 2026-09-29 05:29 UTC — orchestrator (Fable) — B-PYRAMID-2 ended at P5 (22f4c8e); B-PYRAMID-2b launched for P6; PLAN §5.11
**Working on:** B-PYRAMID-2's checkpoint report answered in PLAN §5.11 (the memo budget kept at 64/32 MiB; the camera's
read window grown while a plane is aimed; `olderMs` split by cause with `olderOtherMs` = 0 the rule; the undo's 299 ms
to be explained). Its P6 handed to a fresh builder, B-PYRAMID-2b (`briefs/B-PYRAMID-2b.md`): the deletion of the old
path, the cuts through the queue with the watchdog refusal (§5.9), `_renderPending`, the TEST-MAP ports, the pyramid's
open items, the docs and OPEN-FLAGS, the harness once more against P5's reference table. Running: B-MODEL-C1 (M2),
B-PYRAMID-2b (P6). One slot free; B-PYRAMID-3 waits for P6 and its review.
**Measured:** P5's reference pair (old → pyramid): zoom-out paper 304 → 4.1 ms, long frames 24 (7.7 s worst) → 4
(0.7 s), compose 285 → 35 ms; pen-up release 200 → 155 ms exact; bake 5.3 → 6.6 s; the drag at 33 images on both, the
pyramid's through the surface; round trip identical.
**Decisions made:** PLAN §5.11 items 1–4.
**Questions asked:** none.

## 2026-09-29 05:31 UTC — B-PYRAMID-2b (builder) — P6: the old picture path deleted, the cuts through the queue — start
**Working on:** B-PYRAMID-2's P6 (brief `briefs/B-PYRAMID-2b.md`), from the tree at 21defff (B-MODEL-C1's M2 edits in
`Document.js`, `selection.js` uncommitted beside it). Read: the brief, the preamble, B-PYRAMID-2's brief, PLAN §1.2,
§1.5, §1.6, §3, §5.6–§5.9, §5.11, B-PYRAMID-2's P0–P5 entries, A3 §2.5, §3.4, §3.6, §4.2, §4.6, §6, TEST-MAP.
Order (brief §2): 1 the cuts through the `JobQueue` (`eraseWorkerClient.js`, `erasePipeline.js`'s dispatch; the
watchdog refusal, the single requeue, inline only when the pool is broken; `erase.parallel` ported); 2 the deletions
(`PictureLayer.js`, `PlateStore.js`'s old rules, `plate.js`'s quantum maths, the gate, `_renderPending`, the queue's
quantum identity, the duplicates to one each); 3 the pyramid's open items; 4 the suites; 5 the docs; 6 the harness on a
frozen copy.
**Files I am in:** `src/engine/raster/*` (RasterRenderer, PictureLayer, PlateStore, plate, MovePlane, rasterWorkerClient,
rasterPerf, PicturePyramid, PyramidStore, jobQueue, prefetch and the raster suites), `eraseWorkerClient.js`,
`erasePipeline.js` (the dispatch and `_renderPending` lines only), `sceneOps.js`, `KobinEngine.js` (renderer-facing
parts), `useKobinEngine.js` (gate, levers), `DevStats.js`, `CanvasEditor.js` (the toggle), `browser-check.js`,
`newdesc_engine.py`, the docs of brief §2 item 5. Shared with B-MODEL-C1: `KobinEngine.js`, `Stage.js` (read only),
`erasePipeline.js`, `sceneOps.js` — re-read before each edit, small edits.
**Measured:** nothing yet. Load 0.75 at start; B-MODEL-C1's servers on :3030/:3031; nothing on :3011.
**Questions asked:** none.
WHERE I AM: item 1 — read `eraseWorkerClient.js`, `erasePipeline.js`'s dispatch and `jobQueue.js`'s cut kind.

## 2026-09-29 05:47 UTC — B-PYRAMID-2b (builder) — item 1 checkpoint: the cuts through the `JobQueue`
**Working on:** item 1 done. A cut or descent is one `kind: "cut"` strip at `PRIO.cut` (no cells, a barrier's first
within the priority, no arrival sample) in the renderer's queue (`erasePipeline._cutQ`; the SVG path gets
`cutQueue()`'s), posted to a raster worker (`rasterWorker.runCut`, `cut-job`/`cut-result`); the interim pool, its
workers and `worker/eraseWorker.js` are gone (`build:worker` builds two bundles; CLAUDE.md's line fixed). Lost jobs
(PLAN §5.9 item 1): a worker's error → `requeue` once; the job the watchdog found silent (`failPool(…, silent)`), a
second loss or a throw in the worker → rejected with `why` → `_refuseLost` (`_refuse`, journal "worker: <why>",
`report().erase.counters.cutRefused`); `submit` is null only when `poolBroken()` (then inline, as before).
Suites ported: `erase.worker/stack/rule` to `setRasterTransport` (3 slots), `erase.parallel` (fake raster workers;
the serial engine refuses the parallel one's lost pairs in its turn), `eraseWorkerClient.test.js` rewritten (7).
**Measured:** 60-seed fuzz green (19 s, load 1.1): 43 worker deaths, 21 silent jobs, 55 respawns, 100 requeues, 16
refusals, 23 inline after a break (3 seeds ended broken), 83 descent jobs, 1,122 answers; erase.worker/stack/rule 45/45;
eraseWorkerClient 7/7; jobQueue 8/8; typecheck 0; eslint 0 on the files. `raster-worker.js` 48 → 431 KB (the erase
geometry). Break-checks on the copy (`bp2b/bc`), 14 rules, each red: the reservation 2, cut strips dealt 8, cut
dropped at admit 8, cut sampled 1, barrier order 1, watchdog job requeued 2, no requeue 3, requeue for ever 1, silent
not named 2 / not passed 2, a lost job rerun inline 1, inline with the pool up 15, never inline 1, a throw requeued 1.
**Decisions made:** a throw inside the worker is a refusal (rerun inline it would throw again or stall); the other
jobs in flight when the watchdog replaces the pool are requeued (lost to the replacement, not silent).
**Questions asked:** none.
WHERE I AM: item 2 — the gate: `KobinEngine`'s `pyramid` option and `cfg.pyramid` branches, then RasterRenderer's old path.

## 2026-09-29 05:51 UTC — B-MODEL-C1 (builder) — M2 checkpoint: the settle removed
**Working on:** M2 done (tree at 01fde6d + the fuzz's last edits). No read or write settles: `_settleIfPending`, `unsettle`,
the settle replay, the engine's settle subscription and `_flushCarried`, `TileStore.ownContent`/`_bakeSettled`/`_rebakes`,
Stage's carry handling and `Item.below` deleted. Newcomers cancel the shift (`add(…, {fresh: true})`, `ownFor`, PLAN §5.2
Q3); a ceded kid's and a promoted native's tables come from the composition. Merges moved from the first read to the
action's end (`mergePending(op)`: drop, undo, redo, load, replay's end), the frames' shift difference folded into the
merged natives' tables and recorded for `unmerge` and the log; an empty childless shadow is frame GC's (F94, t9). Old
stores: a logged settle replays through `legacy/modelV1.js` (deletion date 2026-12-31).
**Measured:** tile fuzz vs the oracle with shifts live (`model.equivalence.probe.js`, seeds 1–20 × 40 = 800 ops of 15
kinds): 1,717 pictures, 6,336 native items — 6,303 same-home bit-identical, 33 carried by the oracle all bit-identical
through the mapped picture (0 ulp); 3,471 pieces, 1,332 items with own tables, 305 shifted-frame pictures; PASS, load
~1.3. Comparison rules (in `modelFuzz.js`): above a native's home only the square's interior (64 units in) — the oracle
read the unshifted window there; a carried native a later frame op moved in one engine only counts as diverged (0 here).
Bug it found: a stale reroute memo (refile emitted before `setFrameShift`); shift now set first, `setFrameShift` bumps
`offRev`. Quick suite at load 2.7: 2,203 passed, 68 failed in 8 suites — 7 are B-PYRAMID-2b's in-progress
`eraseWorkerClient.js` (`setEraseTransport`/`eraseFreeSlots` not exported: erase.rule, select.eraseBarrier, bake.schedule,
raster.snapshot/engine/liveHold/pyramid); 1 is mine: raster.nopaper R3 expects `mergeFrame` for a frame dropped on a
visited EMPTY cell, which under C1 is frame GC's (t9's rule). Typecheck 0; eslint 0 errors (my 2 warnings fixed); worker
bundles rebuilt, md5s unchanged (raster 2cd48b67…, scene dce304b8…). My dev servers :3030/:3031 stopped until the counters.
**Decisions made:** merges at the action's end (pure reads forbid A1's first-read merge) — A1 dated note at M4.
**Questions asked:** R3 lives in `raster/` (B-PYRAMID-2b's): port it to a visited cell holding ink, so the drop merges and
the guard (a merge keeps the plates) still bites — recommend B-PYRAMID-2b in P6, or I do it with leave.
WHERE I AM: M3 — `persist.js` writes version 3 when the lattice has a shift (written); next the `.below` lint, the store test.

## 2026-09-29 06:19 UTC — B-MODEL-C1 (builder) — M3 progress: the gate, the lint, the §3 suites
**Working on:** R3 noted as deleted by P6 (orchestrator's answer). `persist.js` VERSION 3, written only when the lattice
has a non-zero shift (`latticeHasShift`); `persist.slow` pins ported. The `.below` lint (`no-restricted-syntax` in
package.json's eslintConfig: `.below`, `["below"]` and `{ below }` destructuring; overrides for placementModel, Document,
LevelMap, offsets, legacy/, PictureLayer until P6 deletes it, tests/testkit/oracles): 30 hits routed or allowed — Stage's
footprint state field renamed `table` (`model.table(o, home)`, `model.tableBefore(ev)`), TileStore/report via
`hasOwnTable`/`tableOf`, sceneClient via `offsets.ownTranslation`; codec/replay/validation lines (format2 3, oplog 2,
persist 1, report 2, selection's `addOffset` result 1) allowed with a reason. New suites: `model.compose.test.js` 7/7,
`model.pureRead.test.js` 1/1, `legacy/modelV1.test.js` 2/2, `hooks/store.model.test.js` 3/3 on a copy only (the tree's hook
calls `engine.setPreBake`, which P6 has deleted from the engine: every hook test red until P6 lands its hook edit).
**Measured:** store: oracle-written store (entries move, moveFrames, settle, moveFrames, mergeFrame, move, moveFrames,
settle, moveFrames; header pending shifts on 2 frames) loads, undoes 6 and redoes 6 to the oracle's pictures: 101
frame pictures, 323 items, 313 same-home bit-identical, 10 carried bit-identical, 0 diverged; re-saved as version 3.
Shift-free file byte-identical to the oracle's (modifiedAt set equal). Pure reads: 6 seeds × 30 = 180 states, 806 Stage
reads, 134 hits, 44 lassos, rev/offRev/epoch/natives/lattice unchanged, 5 empty frames minted by `displaced` (the named
exception). `select.stands.probe.js` 12 × 40: 480 checks, 135 selections (210 natives, 36 frames) equal to the oracle's,
13 drags kept their ink, 2 inkless frames both models keep after an undo (pre-C1 behaviour, counted). Bug found and fixed
(`model.compose`'s landing promotion): `setGeometryById` taking a table away emitted a table-less event, so `offRev`
stayed and the reroute memo kept the old placement (off −8,−4 at "0"); the event now carries `oldBelow`. Load 3.1.
**Decisions made:** the lint also catches `o["below"]` and `{ below }` destructuring (one evasion found: selection's).
**Questions asked:** none.
WHERE I AM: M3 — break-checks on the copy, then the checkpoint entry.

## 2026-09-29 06:22 UTC — B-PYRAMID-2b (builder) — item 2 progress: the old path's code deleted; its suites next
**Working on:** item 2. Deleted: `PictureLayer.js`, `PlateStore.js`, `worker/eraseWorker.js`; `plate.js` down to
`PLATE_PX` + `plateRange` (rasterPack's memo step is its own constant); RasterRenderer's old path (the sync path, the
old post/pack/result/deliver chain, the live hold's clip and extension, the old stopgap, the prebake and ladder posts,
`_dropDead`; `_frameStep` is the pyramid's step, `snapshotJob` a `PRIO.thumb` job read at idle a budget at a time);
MovePlane's quantum keys; the client's own queue (`current`, `dropStale`, `pruneCurrent`, `dropQueued`, `pump`,
`bestIndex`/`LOW_PRIO`, its `STRIPS_PER_WORKER`, `submitPlates`); the engine's ladder, prebake, `_crossTarget`,
`preBake`/`setPreBake`, `cfg.pyramid`, `_camReadMs`, `_renderPending` (flushBakes compares the last render's G); the
hook's `pyramidFromUrl`/`hrefWithPyramid`/`setPyramid`, the Dev panel's Pyramid and PreBake buttons; report/DevStats/
report-read on the pyramid's fields. Ported so far: stage.fresh/hold (+ the testkit) to `PyramidStore`, rasterCore
(the key test to `levelKey`), RS-3 (the inline estimate's budget), raster.job, erase.resume and select.eraseBarrier to
`setRasterTransport`.
**Measured:** typecheck 0; eslint 0 errors on every edited file; the ported suites 84/84 and 13/13 (load 2.2).
**Questions asked:** none.
WHERE I AM: item 4's ports — raster.picture/nopaper deleted (F101, F106 to raster.pyramid), then raster.plates → the store's suite.

## 2026-09-29 06:51 UTC — B-MODEL-C1 (builder) — M3 checkpoint: the version-3 gate, the lint, the break-checks, the counters
**Working on:** M3 done. Since 06:19: `model.pureRead` now gives an inked frame in view an unread shift before the
reads and counts a render as one (its first form missed a settling read: the fuzz renders after every op); `select.stands`
checks every selection drag against the ink before it. `hooks/store.model.test.js` green in the tree (P6 took `setPreBake`
out of the hook).
**Measured:** break-checks on the unimported copy (bm1/bc, red of run): baseline 0/13; the home-depth carry not honoured
1/10; the picture table without the frame's shift 6/10; newcomer not cancelling 2/7; reach box not moved by the shift 1/7;
H6 own table ignored 1/7; version gate removed 2/3; a read that settles (in `list`) 1/1; a logged settle not replayed 2/5;
`oldBelow` bump removed 1/7. Lint: a leak file (`.below`, `{ below }`, `["below"]`) 3 errors, 0 with the rule removed;
format2's allow comment removed 2 errors. Pure reads now: 180 states, 114 unread shifts, 826 reads, 77 empty frames
minted by `displaced`. Counters, 300 natives in a frame one level under the camera, a 20-event subtree drag with a render
each: before (oracle) 1 settle and 300 then 600 table writes per event; after 0 and 0 (`doc.rev` 12,640 → 940). Harness
scenarios 3 and 4 (own Playwright script `bm1/scenes34.js`, gestures and drawing copied, seed 1, 1280×800, CSS animations
off; 5e9b1dd on :3030 against the tree at 06:25 on :3031, load 1.5–3.6): pan 0 px differ; lasso + drag 45 selected, ink
alone 0 px differ, with the selection shown 29–50k px on the ants only — the same outline, the dashes' phase shifted (the
pieces under the ants are cut differently; not traced further). Same tree twice: 0 px. SVG path: pan 0 px; drag crashed
the pre-C1 page twice (Chromium "Target crashed"), not compared. Typecheck 0; eslint 0 errors (8 warnings, none mine).
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: M4 — the docs (DESIGN §8/§13, docs/ai, PLAN §1.7 and §3 row 8, TEST-MAP, A1 notes, OPEN-FLAGS), then the quick suite.

## 2026-09-29 06:56 UTC — B-PYRAMID-2b (builder) — item 4 progress: the suites ported so far
**Working on:** item 4. Deleted `raster.nopaper`, `raster.picture` (F106 → `raster.pyramid`, the monotone-G rule at
the compose; F101 → `raster.pyramid`: a destroyed renderer is inert — `render`/`syncCameraOnly` guard added, a late
answer lands nothing), `raster.plates` (L2/L3/L7/L8 → new `PyramidStore.test.js`). Ported: `raster.worker` (a
`JobQueue` over `rasterPool`: dealing, drops by purpose generation and by G through the real store, the priorities
and the cuts' reservation through the pool; the per-`q` rules W20/W21 gone), `raster.move` (the soft context in its
nine-argument form; the settle, compose-unit, carry, hold, clip tests gone), `raster.engine` (rule 2 on the pyramid's
frame; FC; the E series on level plates).
**Found by the ports, fixed:** rest mode drew the view's own plates under a dragged plane's BELOW (V9b: `_planRest`
ignored `plane.skip`); the pyramid's dispatch had no `xfer.out` and no queued-at (`noteSubmit` had no caller since P1,
so every arrival's wall partition was `noQueuedAt`), and `eng.view` counted an inline render's packs twice — now
`JobQueue` stamps `pushedAt`, `_pyrSubmit` notes it and buckets the post, `_frameStep` subtracts nested packs.
**Measured:** rule 2 on the pyramid (jsdom, load ~2): light 2.44 ms = buckets 2.19 + residual 0.25 (bar 1.0), dense
8.32 = 8.01 + 0.31; raster.worker 22/22, raster.move 33/33, raster.engine 28/28, raster.pyramid 27/27, store 7/7.
**Questions asked:** none.
WHERE I AM: the rest of item 4 — raster.phone/snapshot/translucent/overlay/liveHold, the hook suites, stage.cover's `markDone`, raster.perf's rows.

## 2026-09-29 09:52 UTC — orchestrator (Fable) — resumed after the fifth session-limit stop
**Working on:** the container rebooted again; the tree as the two agents left it snapshot-committed as e1050ef. Both
resumed from their transcripts: B-PYRAMID-2b in item 4 (the F101/F106 ports into `raster.pyramid`, then the remaining
raster suites, items 3, 5, 6), B-MODEL-C1 in M4 (the docs, OPEN-FLAGS, the quick suite, its report). Both told that
their docs edits meet in DESIGN, `docs/ai/`, TEST-MAP and OPEN-FLAGS: own sections only, re-read first.
**Measured:** load 0.23 at the resume.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-29 09:55 UTC — B-PYRAMID-2b (builder) — resumed after the fifth session-limit stop (item 4)
**Working on:** item 4's remainder. Checked the tree at 9118b48: the F101/F106 ports are already in
`raster.pyramid.test.js` (lines 775, 800; 27/27 at 06:56), as are `raster.worker`/`move`/`engine` and the store suite
(the 06:56 entry). The triage run of the remaining suites died with the reboot; re-running it first.
**Measured:** load 0.14 at the resume (up 1 min).
**Questions asked:** none.
WHERE I AM: re-triaging raster.phone/snapshot/translucent/overlay/liveHold, the hook suites, `stage.cover`, then raster.perf's rows.

## 2026-09-29 09:55 UTC — B-MODEL-C1 (builder) — resumed after the reboot (M4)
**Working on:** M4, from the tree at e1050ef, which holds all my edits up to the stop: DESIGN §7 (one clause), §8, §9 (the
footprint clause, the `nativesIn` row), §10 (F93's paragraph), §13 (version 3, the log's settle), §15 (the model rows);
`docs/ai/20-`, `30-`, `40-`; PLAN §1.7 (C1 built, where building changed it) and §3 rows 7–9 (built; row 8 names
`displaced`'s mint as the one exception); `offsets.js`'s header (the picture table is never carried; a ceded kid's
table); `sceneClient.js`'s dead `settle` op handler and `Document.setOffsetsById`'s unused `settle` flag deleted; test
comments and titles ported (`oplog`, `move.subtree` t1, `frame.gc`, `format2`, `sceneClient`). Left: TEST-MAP's model
section, A1's dated notes, OPEN-FLAGS, `docs/ai/10-STATUS.txt`'s subtree-move lines, the quick suite, the end entry.
**Files I am in:** TEST-MAP, A1, OPEN-FLAGS (the model's flags only), `docs/ai/10-STATUS.txt` (the model's lines only).
**Measured:** nothing new; load 0.12 at the resume.
**Questions asked:** none.
WHERE I AM: M4 — TEST-MAP's model section.

## 2026-09-29 10:13 UTC — B-MODEL-C1 (builder) — M4 checkpoint and end: C1 built, the docs true
**Working on:** done. Since the resume: TEST-MAP's section "The document model" (the new suites, the ports, what waits for
C3/C4); A1 §14 "As built: C1" (merges at the action's end, `displaced`'s mint, the carry as built, the two staleness
bugs, the oracle's promotion flaw, the fuzz's two comparison rules, counters, stores); OPEN-FLAGS notes on F78, F93,
F94, F100, F107, F108, F110, F116, F126, F67 (F78/F110/F116: the mechanism gone, with the numbers; F93: half gone; F94,
F100, F107, F108, F126: unchanged, for C2–C4; F67: the M0 `ensureId` fix); `docs/ai/10-STATUS.txt` a 2026-09-29 entry;
the lint override for the deleted `PictureLayer.js` removed. Worktrees bm1/before and bm1/after removed.
**Measured (final tree):** `model.equivalence.probe.js` seeds 1–20 × 40 ops: 800 checks, 1,717 frame views, 6,336 items
(6,303 same-home + 33 carried) bit-identical, 0 ulp, 3,471 pieces. `select.stands.probe.js` 12 × 40: 480 checks, 135
selections equal to the oracle's, 13 drags kept their ink. Quick suite at load 2.4–4.7, 715 s: 2,076 passed, 23 failed in
9 suites, all B-PYRAMID-2b's item 4 in progress — raster.liveHold/phone/snapshot/translucent/overlay (`layer.view`,
`_packNow` gone; G11's raster ants 20 px off the SVG's during a drag: `RasterRenderer`/`MovePlane` changed since my M2
run, `overlays.js` not), stage.cover (`_packNow`), report RB-7 (`raster.layer`), KobinEngine.contract (deleted
methods), useKobinEngine.frames (a duplicate `const S`, mid-edit). Every model suite green. Typecheck 0; eslint 0 errors.
Worker bundles rebuilt, md5s unchanged (raster 2cd48b67…, scene dce304b8…).
**Decisions made:** none new.
**Questions asked:** in the report (the hook's false saver comment and `rasterPack.js`'s `ownContent` line are
B-PYRAMID-2b's files; the ants' dash phase after a drag).
WHERE I AM: ended — report handed back.

## 2026-09-29 10:15 UTC — orchestrator (Fable) — B-MODEL-C1 landed (2fa7a26); its review launched; PLAN §5.12
**Working on:** C1's report answered in PLAN §5.12 (the hook's false saver comment and `rasterPack`'s stale line to
B-PYRAMID-2b's item 5; the ants' dash phase after a drag to the reviewer's trace, then B-DRAG if cosmetic; the fuzz's
two relaxations tightened by the reviewer; the SVG path's drag re-run on the current tree; the settle-named tests
renamed). The review launched (`opus-reviewer`, `briefs/R-MODEL-C1.md`). Running: B-PYRAMID-2b (P6 item 4), the C1
reviewer. One slot free; B-DRAG waits for both P6's review and this one (MovePlane, selection, KobinEngine overlap);
B-PYRAMID-3 waits for P6's review.
**Measured:** C1's: the tile fuzz 6,336 items bit-identical (33 carried at 0 ulp); the selection fuzz 135 selections
equal; a 20-event drag of 300 natives from 1 settle and 300–600 table writes per event to 0 and 0; scenarios 3 and 4
pixel-identical on ink; the quick suite 2,076 pass with 23 reds all in B-PYRAMID-2b's in-flight ports.
**Decisions made:** PLAN §5.12 items 1–6.
**Questions asked:** none.

## 2026-09-29 10:16 UTC — reviewer (B-MODEL-C1 review) — R-MODEL-C1 items 1–10 — start
**Working on:** the review of C1 (2fa7a26, tree 320ad1e) per `briefs/R-MODEL-C1.md`: the fuzz's two relaxations
(item 1), the ants' dash phase after a lasso and drag (item 2), pure reads (3), the composition's cases (4), the
version gate and the legacy module (5), the SVG drag (6), the Stage and the lint (7), counters on the final tree (8),
the settle-named tests (9), the docs (10). Files I may edit (brief §3): `Document.js`, `LevelMap.js`, `TileStore.js`,
`placementModel.js`, `geometry/offsets.js`, `oplog.js`, `persist.js`, `format2.js`, `files.js`, `frameGc.js`,
`sceneClient.js`, `report.js`, `overlays.js` (the box only), `selection.js` (box and `.below` reads only), `legacy/`,
`__testkit__/modelFuzz.js`, the model suites and probes, `hooks/store.subtree.test.js`, `sceneIndex.test.js`,
`package.json`'s eslintConfig, DESIGN §8/§13, A1 §14, OPEN-FLAGS' C1 notes. Not B-PYRAMID-2b's files; `KobinEngine.js`,
`Stage.js`, `erasePipeline.js` re-read before any edit. Dev servers on 3030–3039 only; scratch `scratchpad/r-model/`.
**Measured:** nothing yet (load 0.26 at start).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: reading the brief's list (DESIGN §8/§13, A1 §4.4/§14, the code).

## 2026-09-29 10:31 UTC — B-PYRAMID-2b (builder) — item 4 checkpoint: every suite in the brief ported
**Working on:** item 4 done bar its break-checks (running on `bp2b/bc`). Ported: `raster.phone` (P1 on the store's
phone budget; P3/P4 → one pen-up rectangle test), `raster.snapshot` (S1/S5/S7/S8 through the idle read and the queue;
R4 ×5 and R5b ×3 deleted), `raster.translucent`, `raster.overlay` (G3 a level change repaints; G11's held drag compared
where painted — C1's "20 px off": the raster path holds the drag on its plane, decides on the pre-drag list, `off` 40
against the SVG's 20, same place on screen), `raster.liveHold`, `raster.perf`, `stage.cover` C1–C5 (C3 → the
prefetch), the hook suites, `report` RB-7, `KobinEngine.contract`; three probes ported, `picture.bench.probe` deleted.
**Found by the ports, fixed:** (1) the rest after the quiet never went out when nothing else pumped: `onRequest`
pushed without a pump, and a still camera has no step and no arrival — now a microtask pump; (2) a dispatch outside a
row (the rest's quiet) was orphan adds — now a row of kind `settle` (A3 §4.6); (3) the inline executor's core time
sat in `eng.view` (ENGINE): A3 §2.5 keeps it in the core's slots with `rasOnMain` — `rasterPerf.noteCore`.
`OverlayLayer`'s repaint key dropped the dead `q`.
**Measured:** rule 2 on an inline rest frame (jsdom, load 1.6): 4.385 ms = buckets 4.265 (core 1.479, view 2.214) +
0.120 (bar 1.0). raster/hooks/stage/erase set: 821/822 at load 1.6 (LH-1's wait, made robust), then green.
**Questions asked:** none. C1's two items (the hook's saver comment, `rasterPack`'s `ownContent`) queued for item 5.
WHERE I AM: item-4 break-checks running; then item 3 (read window, olderMs split, undo 299 ms, attention, busy, cover, `at`).

## 2026-09-29 10:48 UTC — reviewer (B-MODEL-C1 review) — item 1 progress: the fuzz past seed 20
**Working on:** item 1 on an unimported copy of HEAD (`scratchpad/r-model/bc`); no tree file edited yet.
**Measured (jsdom, load ~1):** the shipped probe passes seeds 1–20 (6,336 items, as C1 said) but fails 9 of seeds
1–200 (7,818 checks). Two classes. (A) 7 seeds: a view's reroute memo names a frame F0 that frame GC forgot — the
memo key `F|offRev|addrEpoch|frames.size` collides when a GC's forget and a later mint leave `frames.size` equal, and
`TileStore.forgetFrame` drops only the forgotten frame's own memo; the native's ink is missing from that view. In both
engines (the oracle at seeds 42, 74; C1 at 22, 79, 85, 152, 187), so it predates C1. The LIVE Stage too: 6 missing
natives in 8,000 camera-frame checks (seeds 23, 42, 66, 124, 187), the memo stale at 76. Fix tried on the copy: drop
every memo entry with a group reading the forgotten frame — live Stage 0 of 8,000, stale memo 0; with the same line
in the copy's oracle the shipped comparison fails only 2 seeds of 200. (B) seeds 50, 145: a frame with the same id
sits at a different cell in the two lattices (the oracle zeroed the shift at its settle, so a later drag carried a
different whole cell into the address); comparing "the same frame" there compares two places.
Above the home over the FULL square (200 seeds): 21,392 oracle items all in C1's picture to the bit; C1's 36 extra
items all from tiles the oracle's unshifted window does not reach, with the composition's rem (checked by arithmetic).
Divergences (the tainted rule): 174 in 9 seeds of 200 (0 in 1–20).
**Decisions made:** the memo fix is a major (ink missing in a view): reported with the patch, not applied (brief §4).
**Questions asked:** none yet.
WHERE I AM: characterising the 174 divergences, then writing the full-square rule into `modelFuzz.js`.

## 2026-09-29 11:06 UTC — B-PYRAMID-2b (builder) — item 3 progress: six of the seven open items built
**Working on:** item 3. Built, each with a test red on its own break: `olderMs` split into `olderPatchMs` (a stale own
plate whose worker patch is asked or in flight, A3 §3.4) and `olderOtherMs` in the integrals, `report()`, `DevStats`,
the harness; a stale rest cell's cover takes the mapped frame's exact cells (PLAN §5.6 item 7); the table window grown
to a view while a selection is on the plane's path (D1; test on 2560×1440@2 with square 1 between four cells and a
view — the first geometry did not discriminate, the prefetch read the square); the attention point from the wheel,
pinch and pointer into the plan and the queue; `reportBusy` and the focus into the prefetch; the motion's `at`.
Item-4 break-checks: 13 of 14 red on their own tests; the phone P3 one needs both re-render paths broken (red then).
**Found:** the never-older fuzz draws older cells that no patch waits for: 88–91 plans, olderOtherMs 98–104 ms, all
A3 §1.4's (f′), a stale coarser stand-in for a missing cell — a zoom from rest before the prefetch's quiet (the
patches keep the rest set fresh, not the level plates under it, §3.4 item 1). Without a rest set: 5 plans, 3.7 ms.
`olderOtherMs` is therefore not asserted 0 there; own-stale-without-a-patch is (0). Question for the report.
**Measured:** raster.pyramid 32/32, PicturePyramid.* and raster.engine 99/99 (load 0.8–1.7).
**Questions asked:** none yet (in the report). One break-check run spun at 98 % CPU for 10 min (killed); not reproduced.
WHERE I AM: item 3(c) the undo's 299 ms — a frozen tree (b3846a6) on :3012 for the harness; then items 5 and 6.

## 2026-09-29 11:13 UTC — reviewer (B-MODEL-C1 review) — item 1 checkpoint: the memo fix, the fuzz tightened
**Working on:** item 1 done in the tree: `TileStore.forgetFrame` drops every reroute memo whose group reads the
forgotten frame (the orchestrator's call: fix, not propose); `reroute.memo.test.js` a case for it (red on the shipped
tree: the moved stroke not drawn after a forget and a mint that restores `frames.size`); `modelFuzz.js`'s comparison
rewritten; `model.equivalence.probe.js` seeds 1–20 plus pinned 22, 42, 50, 81, 145.
**Measured (jsdom, load 1–2.5):** the new comparison — frames and homes matched by PLACE (class B: one id at two cells),
the whole square above a home (every oracle item in C1's picture to the bit; each C1 item it lacks from a tile only the
composition's shifted window reaches, painted with the composition's rem by arithmetic, and every such piece drawn), the
oracle's stale memo dropped and read again (counted), a divergence failing unless a home moved since the carry. Seeds
1–200 × 40 on the copy: PASS, 55,896 items (55,789 same-place bit-identical, 107 carried ≤ 1 ulp), 36 edge-only, 499
oracle memo re-reads, 46 divergences (all seed 81, each after a home moved). Tree default (20 + 5 pinned): PASS, 8,071
items, 46 diverged; the same probe on the shipped TileStore: red at seeds 2, 11, 22 (with both memos stale at once the old
comparison saw two equal empty pictures). Break-checks on the copy: the pre-C1 skip of views above the home back → red at
seeds 1, 2, 3…; `objShift` without the home-depth carry → red at seed 9 via the new divergence assertion.
Model suites: 40 files 446 passed before; model.compose/pureRead/store.model/reroute.memo/legacy 21 of 21 after.
**Decisions made:** class B by place, not a named exception (the pictures are of places; ids differ by design).
**Questions asked:** none.
WHERE I AM: item 2 — the two dev servers (5e9b1dd worktree :3030, tree :3031) and `bm1/scenes34.js`.

## 2026-09-29 11:26 UTC — B-PYRAMID-2b (builder) — item 3 checkpoint and item 5 (docs) done; item 6 running
**Working on:** item 6's harness batch on a frozen tree (15b3738 from `git archive`, :3012). Item 3(c), the undo's 299
ms, measured in headless Chromium (the harness now reads exact only after the undo's commit and a compose after it;
its first poll had read the pre-undo picture, 11 ms): committed 315–399 ms after the key, exact 439–580 ms. The patch
never runs inline in the dense scene: T 34.1–40.6 ms against `patchInlineMs` 6 (2 cells, E at the 20,001-chord
cap, A 666,316 box px), no coarser level fits; the rest is the main thread — arrivals packing prefetch strips at
171–212 ms `eng.pack` each, the undo's own keydown 291 ms of script, 387–806 ms timer/IDB tasks ahead of it.
Item 5: DESIGN §7/§9/§15, docs/ai 10-/20-/30-/40-, PLAN §1.2's as-built note, A3's dated notes (§2.5, §4.2, §4.6,
§9.1), TEST-MAP, OPEN-FLAGS' pyramid notes on F101/F106/F119/F120/F121/F122 (F79 waits for the harness's compose
numbers; F65 open), `newdesc_engine.py`'s erase client, C1's two items (the saver's drain gone, `rasterPack`'s line).
**Measured so far (run 1, load 1.89 → 5.1 from 11:23: another agent's two dev servers and a Chromium harness):**
1 zoom-out paper 150 ms (P5's pyramid 4.1), blur 112, older 0/0; 1 back paper 188, blur 3,268; 2 slow paper 5.2,
blur 34; 3 pan 0/0/0, 16 long frames (contended).
**Questions asked:** none (the orchestrator's rest-set answer goes to openItems; not built).
WHERE I AM: item 6 — both runs and levelStep 2/3, then scenario 1 on P5's tree for an A/B of the paper number.

## 2026-09-29 11:48 UTC — reviewer (B-MODEL-C1 review) — items 2, 6, 8 (browser) checkpoint
**Working on:** worktrees `r-model/before` (5e9b1dd, :3030) and `r-model/after` (1e608e3, :3031), Node 14, headless
Chromium 141; both servers stopped now. Scripts `r-model/ants.js`, `svgdrag.js`; `bm1/scenes34.js` for the round trip.
**Measured (load 2.3–6):** item 2 — after the lasso and the drag of scenario 4 both trees select 44 ids + frame "1"
(1,000 natives), every one of the 1,044 natives' items identical (pieces and offsets), the ants' 45 runs the same set in
the same order; the only model difference is where the drag's rest lives (pre-C1: 1,000 tables, frame shift null; C1:
frame "1" shift [−65536, −32768], no tables). With reduced motion (the crawl frozen at phase 0) the two trees' screenshots
with the ants differ by 0 px; with motion the phase read at the shot was 4 and 7, and one tree's page shot 150 ms apart
differs by 54,503 px against 50,321 between the trees. The ants' difference is the crawl clock: not C1's, nothing for
B-DRAG. Item 8 — scenarios 3 and 4 round trip, raster path: pan 0 px of 1,023,405 ink; drag ink-only 0 px of 1,012,067
(41,727 with the ants, the clock). Item 6 — `?svg` scenario 4 crashes the tab at drag event 3–4 on BOTH trees (heap
2.8 GB at load with 77.5 MB of path data; ~700 MB more an event). At a tenth of the natives it runs: forced GC, the SVG
path retains ~57 MB a drag event on both trees (272→2,531 MB pre-C1, 298→2,573 MB C1; raster 102→161 MB), and the
post-drag ink of the two trees' SVG paths differs by 0 px. Pre-existing, the SVG renderer's.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: item 3 — `model.pureRead.test.js`: the reads C1's list may miss.

## 2026-09-29 12:08 UTC — B-PYRAMID-2b (builder) — P6 end: item 6's harness, the suite, the report
**Working on:** done. Item 6 on a frozen tree (15b3738, `git archive`, :3012), `--dense --scenario all` twice and
scenarios 1–2 at levelStep 2 and 3; load 1.9 → 5.1 in run 1 (another agent's two dev servers and a Chromium harness
from 11:23), 2.9 → 1.9 in run 2, 1.3–2.1 after. P6 runs 1|2 beside P5's pyramid (pair 1): 1 out paper 150|76 (P5
4.1; an A/B pair today: P5's tree 0, P6 36.6), blur 112|135 (49), long 5|7 worst 0.71|0.91 s (4, 0.7); 1 back paper
188|138 (0; A/B: P5 147, P6 0), blur 3,268|4,292 (3,892); 2 slow paper 5.2|0, blur 34|17 (13), long 9|12 (9); 3 pan
0 paper, long 16|1 (4); 4 lasso 45 selected; 4 drag olderPatch 856|951, olderOther 0|0 (older 595), 33 images;
5 pen-up release 145|169 ms, exact 147|171 (155, 161); 6 undo, measured from the key to exact after the commit:
committed 428|114, exact 554|215 (P5's 299 read differently); 7 erase bake 5.96|6.57 s (6.6), blur 804|657,
olderPatch 679|1,074, **olderOther 869|853** (P5's older 1,701 unsplit). levelStep 2|3: 1 out paper 0|0, blur
14|14, long 38|32 (41|41); back blur 3,308|4,090; 2 slow blur 23|29, long 46|49, older 0.
**Measured:** quick suite 188/193 suites, 2,118 passed, 12 skipped, 0 failed, 5 m 15 s at load 1.5 → 4.2;
typecheck 0; eslint 0 errors (7 warnings, none in my files); `build:worker` md5 unchanged (raster 2cd48b67…, 430,570
B; scene dce304b8…). Nothing measured in Kobin's Chrome.
**Questions asked:** in the report (olderOther in scenario 7 and the fuzz; the zoom-out paper; packs at rest).
WHERE I AM: ended — report handed back.

## 2026-09-29 12:12 UTC — orchestrator (Fable) — B-PYRAMID-2b landed (ac9a7e1); the B-PYRAMID review launched; PLAN §5.13
**Working on:** P6's report answered in PLAN §5.13; the review of the whole B-PYRAMID build launched (`opus-reviewer`,
`briefs/R-PYRAMID.md`) with leave to build three bounded fixes — the rest set kept as a stand-in after a zoom (the
never-older invariant: `olderOtherMs` must reach 0), a per-task pack budget at rest (packs of 171–480 ms on the main
thread while still), the undo's inline estimate clipped to the patch and a 16 ms budget for a user-initiated patch —
plus the zoom-out paper bisect (P5's tree 0–4.6 ms, P6's 37–150), rows 1/8/10 at the renderer level, the pen-up rule,
the plane, the queue's small items, the budget, the deletion grep, the docs, the final harness table on a quiet
machine. Running: the C1 reviewer (item 3 of 10; four stale ladder comments in its files sent to it), the B-PYRAMID
reviewer. One slot free; B-PYRAMID-3 waits for the B-PYRAMID review, B-DRAG for both reviews.
**Measured:** P6's: the quick suite 2,118 pass, 0 fail on the pyramid-only tree; the harness runs in the 12:08 entry.
**Decisions made:** PLAN §5.13 items 1–6.
**Questions asked:** none.

## 2026-09-29 12:14 UTC — reviewer (B-PYRAMID review) — R-PYRAMID items 1–11 — start
**Working on:** the review of B-PYRAMID-2 (P0–P5) and 2b (P6, ac9a7e1; tree fb395da) per `briefs/R-PYRAMID.md`. Leave to
build §1 items 1 (the rest set as a stand-in), 2 (the pack budget at rest) and 4 (the undo inline), each red-before; the
rest reported. Order: reading, then the jsdom and code items (1, 2, 4, 5, 6, 8, 9, 10), the bisect's archives (item 3),
harness measurements only on a quiet machine (the C1 reviewer's end entry, or load under 2), the docs (11).
Files I may edit (brief §3): `src/engine/raster/*` (PicturePyramid, PyramidStore, jobQueue, prefetch, MovePlane,
rasterWorkerClient, rasterPack…), `RasterRenderer.js`, `eraseWorkerClient.js`, `sceneOps.js`, the hook's raster parts,
`DevStats.js`, `tools/harnesses/browser-check.js`, the raster suites, DESIGN §7/§9/§15, `docs/ai/`, A3, OPEN-FLAGS'
renderer flags. Shared, re-read before each small edit: `KobinEngine.js`, `Stage.js`, `erasePipeline.js`. Not the C1
reviewer's model files. Ports 3010–3019; scratch `scratchpad/r-pyr/`.
**Measured:** nothing yet (load 1.02 at start).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: reading the brief's list (DESIGN §9, PLAN §0/§1/§3/§5, A3, the builders' entries, the code).

## 2026-09-29 12:16 UTC — reviewer (B-MODEL-C1 review) — R-MODEL-C1 items 1–10 — end
**Working on:** done; dev servers :3030/:3031 stopped at 11:47, worktrees `r-model/before`/`after` removed.
**Measured (jsdom unless said; load 1–3):** item 3 — `model.pureRead` extended (budgeted snapshots as the Scenes panel
reads, the drag's pick, the erase frame pass, the scene index's pass; `report()` its own case): 180 states, 2,192 reads,
82 mints, each a displaced group's source and gone at the next frame GC; read by read over 600 states only the Stage's
first read of a view minted; break-checks on the copy: a read minting elsewhere, GC off, `report()` writing — 1 red each.
Item 4 — `model.compose` +3 (a ceded kid, a native promoted into a shifted frame, a cut piece keeping its own table):
break-checks 1 red each (the kid's through `eraseDescent.ownIn`: production's cede never calls `Document.cedeTileById`).
Item 5 — against 0732252's `persist.js`: a shifted file and a store header refused "file v3, app reads up to v2"; a
shift-free file 705 bytes identical to the oracle's, read by the deployed reader. The legacy import test evaded by a
`legacy/index.js` re-export (2 of 2 green): rewritten to resolve imports to the file and refuse re-exports (red then);
the store test without `applySettle` or `unsettle`: 1 red each. Item 7 — four `.below` leak forms in 14 files incl.
the allowed files and the model's neighbours: 56 of 56 red; the 7 allowed lines' reasons true. Item 8 — a 20-event
drag of 300 natives: oracle 1 settle and 300→600 writes an event, rev +11,740; C1 0, 0, rev +40. Item 9 — `settleAll`
deleted (a read that did nothing), sceneIndex's case renamed. Item 10 — DESIGN §8/§13, A1 §14, OPEN-FLAGS F111/F94/F116.
Suites: 40 files 446 passed before; 44 files 541 passed, 4 skipped after; typecheck 0; eslint 0 errors (7 warnings, 1
mine fixed). Worker bundles rebuilt; my `offsets.js` comment edit leaves the raster bundle's md5 as it was (378db4bf… on
the copy either way).
**Decisions made:** class B compared by place; `settleAll` deleted rather than renamed (rule 14: it does nothing now).
**Questions asked:** in the report (the Stage's `_home` read, `warmReads` dead since P6, the SVG path's retention).
WHERE I AM: ended — report handed back.

## 2026-09-29 12:18 UTC — orchestrator (Fable) — the C1 review landed (930365c); B-PYRAMID-3 launched; PLAN §5.14
**Working on:** the C1 review's report answered in PLAN §5.14 (the dead warm reads and `listFor` measured then deleted
by B-PYRAMID-3; the Stage's `_home` read, the box helper and `_endMove`'s unrecorded merge to B-DRAG; the SVG path's
retention filed and fixed by B-PYRAMID-3; `ownIn`/`ownFor` to C4). B-PYRAMID-3 launched (`opus-builder`,
`briefs/B-PYRAMID-3.md`) on the SVG-side items now, its `RasterRenderer` switch after the B-PYRAMID review ends.
Running: the B-PYRAMID reviewer, B-PYRAMID-3. One slot free; B-DRAG (with C2) waits for the B-PYRAMID review.
**Measured:** the C1 review's: the memo major (6 of 8,000 live renders missing a native; 0 after); the fuzz by place on
200 seeds, 55,896 items; the deployed reader refusing a version-3 file; pure reads 2,192 over 180 states.
**Decisions made:** PLAN §5.14 items 1–4.
**Questions asked:** none.

## 2026-09-29 12:19 UTC — B-PYRAMID-3 (builder) — the SVG renderer's demotion — start
**Working on:** the brief `briefs/B-PYRAMID-3.md`, items 1–3 now (SvgLayer, LiveStrokeLayer, the shared overlay
module, `Renderer` reading the Stage; the SVG mask rule and the export barrier; the retention). Item 4 waits for the
B-PYRAMID reviewer's end entry. Files I am in: `src/engine/Renderer.js`, new `SvgLayer.js`/`LiveStrokeLayer.js`/the
overlay module, `src/hooks/useKobinEngine.js` (gate, export), `src/storage/thumbnails.js`, `sceneOps.js`'s export
path, the `Renderer.*` suites, TEST-MAP's rows. Shared, re-read before each small edit: `KobinEngine.js`,
`erasePipeline.js`; `Stage.js` read only. Not `RasterRenderer.js` or the raster modules until item 4.
Ports 3020–3029; scratch `scratchpad/bp3/`.
**Measured:** nothing yet.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: reading the brief's list (DESIGN §9/§7, PLAN §0/§1.5/§3/§5.7/§5.8/§5.14, A3 §3.6/§7, TEST-MAP, the code).

## 2026-09-29 14:53 UTC — orchestrator (Fable) — resumed after the sixth session-limit stop
**Working on:** the container rebooted; the tree as the two agents left it snapshot-committed as cbca128 (the push
refused once by GitHub's credential service, 503 — retried). Both resumed from their transcripts: the B-PYRAMID
reviewer (early in its reading), B-PYRAMID-3 (item 1). The C1 reviewer had ended at 12:16, so the machine is theirs.
**Measured:** load 0.05 at the resume.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-29 14:54 UTC — reviewer (B-PYRAMID review) — resumed after the reboot (items 1, 3, 4)
**Working on:** the reading was done before the stop (my transcript survived); in the tree: the red-before tests of item 1
(`PicturePyramid.rest.test.js`: the rest set kept as a stand-in after a zoom, three cases) and item 4
(`raster.pyramid.test.js`: the undo over dense cells inline), not yet run; the code for both is written in
`r-pyr/e1_standin.py`, `e4_undo.py`, `e4b_undo.py`, not applied. The harness: `settleWhy` beside a -1 settle, and
its quiet predicate fixed — `rasterWorkerReport()` has had no `queued` since P6, so on P6's trees every settle ran its
full 20 s (`settledMs` -1, the setup's `markBakeMs` 23 s = a 3.4 s bake + the 20 s timeout).
**Measured (item 3, before the stop; archives of 22f4c8e :3011 `pyramid=1` and 15b3738 :3012, headless Chromium, the
harness at HEAD before the quiet fix, scenario 1, interleaved, load 0.8–2.6):** zoom-out paper P5 61.7 | 36.5 | 92.1 ms,
P6 20.9 | 6.2 | 23.1; zoom back P5 1,070 | 814 | 138, P6 223 | 141 | 0. No regression reproduced: P6 lower on all six.
**Decisions made:** item 3 re-run once with the quiet fix before calling it noise; no bisect of a regression not seen.
**Questions asked:** none.
WHERE I AM: run items 1 and 4's new tests red on the tree, apply `e1_standin.py`, then `e4_undo.py` + `e4b_undo.py`.

## 2026-09-29 14:55 UTC — B-PYRAMID-3 (builder) — resumed after the session-limit stop
**Working on:** item 1 from the reading: no source file of mine was edited before the stop (cbca128's diff against my
start holds only my start entry), `scratchpad/bp3/` is empty. Files I am in, as at the start: `Renderer.js`, new
`raster/SvgLayer.js`, `raster/LiveStrokeLayer.js`, `raster/svgAnchors.js`, `raster/svgOverlay.js` (the shared overlays),
the hook's gate/export, `thumbnails.js`, `sceneOps.js`'s export path, the `Renderer.*` suites; shared, re-read before
each small edit: `KobinEngine.js`, `erasePipeline.js`. Not `RasterRenderer.js` or the raster modules until item 4.
**Measured:** load 0.16 at the resume.
**Decisions made:** item 1 keeps the names `RasterRenderer` inherits working (thin forwards in `Renderer`) until item 4
deletes them with the inheritance; the anchor helpers move to one module both the ink path and the live layer import.
**Questions asked:** none.
WHERE I AM: writing `raster/svgAnchors.js`, `SvgLayer.js`, `LiveStrokeLayer.js`, `svgOverlay.js`; then `Renderer` on them.

## 2026-09-29 15:27 UTC — B-PYRAMID-3 (builder) — item 1 checkpoint: SvgLayer, LiveStrokeLayer, the shared overlays, Renderer on the Stage
**Working on:** built: `raster/svgAnchors.js` (the anchor helpers, moved), `raster/SvgLayer.js` (the Two.js instance),
`raster/LiveStrokeLayer.js` (begin/arcs/hold/release/cancel; its group is in `world` only while it holds a path),
`raster/svgOverlay.js` (lasso, tile/erase debug as `SvgOverlays`; the indicator's layers, style, chevrons, SVG ants);
`Renderer` composes them; the engine's `_render` draws `stage.items()` on both paths (`framesLeft` and `_lastRange`
moved out of `_buildList`, which has no production caller now: deleted with `listFor` at item 4). `RasterRenderer`
untouched: `Renderer` keeps `_live*` accessors, `_mkSelLayer`/`_renderSelChevrons`/`_ensureSelStyle` forwards and the
drag seams for it until item 4. Tests: `Renderer.liveChunk` → `raster/LiveStrokeLayer.test.js` (LS-1..5); four suites
moved to the new names; `KobinEngine.edit` reads the item's geometry (`stage.placed(o).geom`).
**Measured (headless Chromium, load 2.7–4.4; frozen copies: cbca128 :3020, cbca128 + my files :3021):** `?svg` round
trip (`scratchpad/bp3/svgtrip.js`: 3 strokes, a translucent live stroke mid-gesture, 40 ticks out and back, a lasso,
its ants, a drag, an erase, its bake): after vs before 0 differing px in all 9 states; two runs of one tree differ by up
to 59,959 px (127→126 on translucent ink) or 16 UI-edge px, so each pair was compared against a second run. Raster
round trip (the harness): canvas ink hash identical at all 4 states, screenshots 23 UI-edge px apart (run noise).
jsdom: 13 suites 344 pass; `raster.pyramid` 2 fail on a copy without my change too (the reviewer's in-flight tests).
Typecheck 0; lint 0 errors (6 warnings); worker bundles' md5 unchanged.
**Decisions made:** the live group leaves `world` when empty (an eager empty `<g>` measured 34 px on the first pair).
**Questions asked:** none.
WHERE I AM: the quick suite running on the frozen after copy; next, item 2's mask rule in `Renderer.render`.

## 2026-09-29 15:36 UTC — reviewer (B-PYRAMID review) — checkpoint: items 1, 2, 4 built
**Working on:** the three fixes, each red first (4 of 4 new tests red on the tree, 2 of 2 for item 2), then green.
Item 1: a zoom keeps the rest set's records as the stand-in at their own Z (`_standIn`; `_standInCell` tried at its
resolution's rank among the coarser levels, over a stale own plate's dirt by rule (e) or the cell's on-screen part,
counted as scaled; pinned while drawn, OFF_PATH after; the next zoom's set replaces it, a frame change/resize/dpr
removes it; back at its Z bit for bit it is the rest set again). Item 4: the patch estimate's E is each item's
chords × its rows' share inside the clips (`itemChordsAt`, rasterPack), budget `patchUserMs` 16 for an undo/redo
(`noteUserEdit`, one line in KobinEngine's undo/redo) or a pen-up's group, 6 ms for the bake's. Item 2: at rest a task
packs within PACK_MS_PER_FRAME, the strip that crosses it ends the task, `defer` (setTimeout 0) starts the next.
**Measured (jsdom):** the never-older fuzz 121 → 113–176 plans (timing-dependent), older plans 79 → 24–87, and every
(f′) left is a cell with nothing fresh at any level whose tiles are unread after a crossing (the step reads the cache
alone, the idle read waits for the quiet) or whose view job is in flight: `{unread, coming, other: 0}` asserted.
raster.pyramid 33/33, PicturePyramid.* 41/41, jobQueue 9/9, move 33, engine 29, worker 22, snapshot 11, store 16,
prefetch 6, translucent 6, phone 4, liveHold 3 — green (load 2–3, B-PYRAMID-3's quick suite beside). A first whole-dir
run hung one jest worker at 98 % CPU for 32 min (killed; the files one by one all finish): being traced.
**Decisions made:** tests that force "every patch to the workers" set `patchUserMs` 0 too; the late result of the kept
set is stored (a stand-in plate), `PicturePyramid.patch`'s case rewritten to that.
**Questions asked:** none yet (the (f′) cause goes to the report as a design question).
WHERE I AM: the raster/erase/stage suites in the background; then break-checks of 1, 2, 4 on `r-pyr/bc`; the harness.

## 2026-09-29 15:54 UTC — B-PYRAMID-3 (builder) — item 2 checkpoint: the SVG mask rule and the export barrier
**Working on:** `Renderer.render`: a landed pending mark (`targets` recorded) is drawn as nothing; a group with any member
`eraseRule.underMask` under it gets an SVG `<mask>` (white over the group's drawn box inside the scene's window, the
mark's shape black through a `<use>` of one `<defs>` copy per mark, scaled S/S_m for the thin rescale); the attribute is
set after Two.js renders (`two.bind("render")`); an unlanded mark stays ink until it lands. `thumbnails.withSvgEngine`
runs `flushErases()` after the load; the hook's export goes through it in both modes (the tab's document untouched).
**Measured:** jsdom `Renderer.eraseMask` M-1..3 and `storage/thumbnails.test` X-1 (export with a pending mark === export
after the bake, ids stripped): 4 pass. Break-checks on `scratchpad/bp3/bc` (unimported): mark drawn as ink 2 red; rule's
`underMask` dropped 1 red; no unmask 1 red; barrier removed 1 red. Headless Chromium (load 3.6–5.1, `bp3/maskcheck.js`):
a mark over a blue band and a green bar dragged under it — before, the bar's 4,000 px under the mark white; after, green,
the band masked; the rest equal to before within 77 UI-edge px; against the raster path in the ink region 215–362 of
72,000 px differ (≤ 38 levels), the same count after the bake: the mask's edge agrees with the raster's.
**Decisions made:** the SVG-mode export via `withSvgEngine` too (one export path; no bake forced on the tab's document).
**Questions asked:** none.
WHERE I AM: item 3 (below).

## 2026-09-29 15:54 UTC — B-PYRAMID-3 (builder) — item 3 checkpoint: the `?svg` retention, filed F133 and fixed
**Measured (headless Chromium, forced GC each step, the C1 reviewer's `svgdrag.js`; load 1–4):** before, a tenth of the
dense scene: 272 → 933 MB over 12 drag events (59 MB each). V8's sampling heap profiler (`bp3/svgalloc.js`): 309.5 MB
live in Two.js `BindVertices`, 59.7 MB in `pushRingAnchors`/`pushLine` — 97 groups at opacity 0 holding 756 removed
paths (391,068 anchors) in `subtractions`, which Two.js flushes only when it renders the group, and never renders one at
opacity 0. Fix: a hidden group is not rebuilt (signature stale; `needsFadeFlip` promotes the zoom that shows it). After:
213 → 257 MB over 12, flat at 265 MB from the 21st of 40; the whole scene 12 events flat at 1,861 MB (crashed before).
jsdom test in `Renderer.retention` (red without: 7 parked paths); break-checks 1 red each (skip removed; promote removed).
**Decisions made:** filed as F133 in OPEN-FLAGS (grep found no flag for the symptom), fixed, unverified by Kobin.
**Questions asked:** none.
WHERE I AM: waiting for the B-PYRAMID reviewer's end entry for item 4; meanwhile the warm-reads measurement (§5.14 item 1).

## 2026-09-29 16:04 UTC — reviewer (B-PYRAMID review) — checkpoint: items 5, 6, 8, 9, 10; the harness batch running
**Working on:** the harness batch (`r-pyr/batch.sh`, background, each run after load < 2): item 3's A/B again with the
quiet fixed (22f4c8e :3011 `pyramid=1` against 15b3738 :3012, scenario 1 ×3), scenario 6 before/after (15b3738 against
this review's frozen tree `git stash create` 9e53f06 on 8a59b9b, :3013), then §2's table on 9e53f06. Docs meanwhile.
**Built, each red first:** item 8 — a snapshot's strip was queued as a copy, so `done` never matched it: **every
thumbnail kept one prefetch/thumbnail slot in flight for the session** (with 3 workers the low cap is 2: two Scenes
thumbnails and the prefetch never dispatched again); a job carrying its own pool entry is now queued as pushed (S11,
red 1). An aborted snapshot's strip leaves the queue at once (S7b); an orphan's freed slot pumps the queue
(`setOnSlotFreed`, W19 without its manual pump); the prefetch's plan timed into `eng.list` in its row or its own;
`rasterPack`'s prepass key without the dead `q`. Items 5/6: a row-1 fuzz through the results path (3 seeds, shuffled and
late answers, step changes' refused jobs, drags, snapshots: 0 G falls, 1,030 exact draws all exact), the cut-step patch
= the whole render inside its clip (masks in the job), a pending stroke picked and unpainted.
**Measured:** break-checks on `r-pyr/bc`: items 1 (5 breaks), 2 (2), 4 (4), 8 (3), P3's D1/H4/landing (4, 3, 6 red of
90), budget (release, floor, step change: 1, 1, 2): every one red. Deletion grep: only history comments and the scale
bar's own ladder; `raster.move`'s describe and one test comment named the deleted ladder — reworded.
**Questions asked:** none yet.
WHERE I AM: DESIGN §9, A3's notes, OPEN-FLAGS, docs/ai 40- while the batch runs; then the table and the report.

## 2026-09-29 16:09 UTC — B-PYRAMID-3 (builder) — waiting for item 4: the warm reads measured (PLAN §5.14 item 1)
**Working on:** item 4's preparation (the reviewer's end entry not yet in); the docs of items 1–3 next.
**Measured (headless Chromium, raster path, frozen copy :3022 = cbca128 + my files; `bp3/warmcheck.js`):** the dense
drawing with scenario 4's lasso and drag (44 natives and frame "1" moved), the camera at depth 2, scenario 1's zoom-out
(90 ticks) and back; tile bakes (`_bakeUp`/`_bakeDown`) counted in the page, two runs each. Warm off (production today:
nothing sets `warmReads`): out 11, 10 bakes (5.9–6.0 s), back in 19, 22 (11.6–12.9 s). Every `stage.snapshot` read warm
and never cleared (LRU-bounded): out 14, 10 (6.6–7.7 s), back in 9, 10 (3.5–4.9 s). Warm cleared at each prefetch plan
(the ladder's rule): no difference from off (10/19, 10/22). Load 1.4–9 (the ms are loose; the counts are the result).
**Decisions made:** none yet on the warm reads: the numbers need them only if they are wired to every prefetch read.
**Questions asked:** the warm reads: delete them with `listFor` as dead code (production is "off" today; the back-in
re-bake, 19–22 tiles and 11.6–15.9 s of main-thread bakes here, filed as an open item for the prefetch), or keep them
and wire every prefetch snapshot read as warm (a small change in item 4)? Recommendation: wire them — the back-in bakes
halve in this scenario and the LRU cap still bounds the cache; I will build that in item 4 unless told otherwise.
WHERE I AM: DESIGN §7/§9, TEST-MAP, A3 §7, PLAN §1.5 for items 1–3 (own sentences only; the reviewer is in §9 too).

## 2026-09-29 16:26 UTC — reviewer (B-PYRAMID review) — checkpoint: item 3 answered, scenario 6 before/after
**Measured (headless Chromium 141, dense, scenario 1, the harness with the quiet fixed, interleaved):** zoom-out paper
22f4c8e `pyramid=1` 0.4 | 8.0 | 99.4 ms (load 1.9–2.6), 15b3738 0.4 | 1.8 ms (load 1.9–2.7) and 1,748 ms in a run whose
load rose 1.9 → 6.9 (another agent's work). With the earlier batch (quiet broken on P6's tree): P5 61.7 | 36.5 | 92.1,
P6 20.9 | 6.2 | 23.1. **No regression between the trees**: the builder's pair (P5 0, P6 36.6) and P6's 150 | 76 were the
spread under load plus P6's trees settling 20 s every time (the harness's quiet read a field the pool lost at P6).
Scenario 6, 15b3738 against this review's tree (cc1524a): key-to-exact 334 | 983 → 240 ms, longest task 352 | 310 →
156 ms, olderPatch 53 | 0 → 0 (blur 2.1: coarse-first now). The undo's patch is still not inline there: E clipped
16,022 (was the 20,001 cap), A 666,316 px, T 25.3 ms against 16 — coarse-first at ℓ −1 (9.6 ms) inline instead; and the
inline render's own pack was 89 ms (a new list at every commit, the prepass rebuilt), which no estimate term prices.
**Decisions made:** no bisect (nothing to bisect); the pack's cost goes to the report as a finding (a new estimate term
is a design change, not the brief's build).
**Questions asked:** none yet.
WHERE I AM: the batch's final table (two `--scenario all`, levelStep 2|3), then F79, typecheck, lint, bundles, report.

## 2026-09-29 16:32 UTC — B-PYRAMID-3 (builder) — waiting for item 4: the trial copy
**Working on:** item 4 prepared on an unimported trial copy (a tar of the live tree at 16:15, not the live tree):
`RasterRenderer` composing `[PicturePyramid z0, SvgLayer z1, OverlayLayer z2, bl-sel-edges z3]` with the shared
`LiveStrokeLayer` (hold/release) and `svgOverlay`; every prefetch read warm (`warmReads` on around `prefetchPlan`),
the plan-time clearing deleted; `Renderer`'s raster seams, `listFor`, `_buildList` and TileStore's list reads
(`content`, `contentOffCamera`, `_reroute`, the over-budget throw) deleted; the engine guards the calls one renderer has.
**Measured:** lint on the trial copy 0 errors. No suite run on it yet.
**Decisions made:** none new. The live tree's `RasterRenderer.js` and raster modules stay untouched until the
reviewer's end entry (last seen 16:26, still batching).
**Questions asked:** none.
WHERE I AM: the raster suites' ports on the trial copy (live fields → `live.held/root/tail`, `_buildList` spies →
`_render`, the chevrons seam test → `svgOverlay.renderSelChevrons`), then the prefetch-warm test and its break-check.

## 2026-09-29 16:45 UTC — reviewer (B-PYRAMID review) — checkpoint: the final table, scenario 7, one more defect
**Measured (headless, cc1524a on :3013, `--dense --scenario all` ×2, load 1.95–3.6):** 1 out paper 8.4 | 109.8 (the
second contended), blur 29 | 147, long 5 | 4; back paper 0 | 128, blur 2,916 | 3,587; 2 slow paper 0 | 0, long 16 | 11;
3 pan 0; 4 drag 33 images through the surface (5 | 4 surface composes), olderPatch 815 | 1,059, olderOther 0;
5 pen-up release 121 | 96, exact 123 | 101; 6 undo exact 264 | 203, longest task 174 | 293; **7 erase: olderOther
1,666 | 1,369** (P6's builder 869 | 853), olderPatch 1,186 | 581, blur 842 | 485, bake 7.7 | 6.3 s, stand-in cells 12 | 10.
**Found:** every strip dropped before dispatch cleared every ask (`refresh()`): a stale cell whose patch was queued
lost its ask, read as other older, was asked again at the next step, and its duplicate's own drop cleared them all
again. Fixed (`_pyrUnask`: a dropped strip forgets its own cells, none for `exact`; `refresh()` deleted), red first.
The harness now counts older cells by cause (ownWait/ownOther/unread/coming/other) and the stand-in's cells.
**Decisions made:** scenario 7 measured again, before (15b3738) and after the fix (a2240e4 on :3014), in `batch2.sh`.
**Questions asked:** none yet.
WHERE I AM: batch2 (scenario 7 ×2 each side, 1 ×2, 6 ×1); then break-checks 1f/8d/8e, typecheck, lint, bundles, report.

## 2026-09-29 19:52 UTC — orchestrator (Fable) — resumed after the seventh session-limit stop
**Working on:** the container rebooted; the tree as the two agents left it snapshot-committed as 91b191a. Both resumed
from their transcripts: the B-PYRAMID reviewer at its last items (the prefetch-reads bucket test, three break-checks,
typecheck, lint, the bundles, the report), B-PYRAMID-3 on its trial copy (item 4 lands after the reviewer's end entry).
**Measured:** load 0.05 at the resume.
**Decisions made:** none new.
**Questions asked:** none.

## 2026-09-29 19:54 UTC — reviewer (B-PYRAMID review) — resumed after the reboot: the last checks
**Working on:** everything was measured before the stop (batch2 complete: scenario 7 ×2 each side, 1 ×2, 6 ×1 on
a2240e4; `r-pyr/final.log`): break-checks 1f, 8d, 8e red 1 each; typecheck 0; the bundles built (raster 430,605 B,
b72e5be7…; scene dce304b8…). Two things left open by that run: lint's one error (mine: `raster.snapshot` S7b's
un-awaited `rejects`), and the raster/erase/stage suites hit their 25-min deadline (exit 124) — a file is stuck.
**Measured:** nothing new yet (load 0.16).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: fix S7b's lint error, find the stuck suite file (per-file runs with a deadline), then the end entry and report.

## 2026-09-29 19:53 UTC — B-PYRAMID-3 (builder) — resumed after the reboot: item 4 on the trial copy
**Working on:** item 4 stays on the trial copy (`scratchpad/bp3/i4b`, a tar of the live tree at 16:51 with the
reviewer's `_pyrUnask` fix in it) until the reviewer's end entry. Built there by five scripts (`bp3/apply4.sh`):
`RasterRenderer` composing FC1's four layers in one `_layers` list (the SVG layer and a z-3 slot for `bl-sel-edges`
walked by `setSize`/`destroy`/the release), the suites ported (`raster.liveHold` → `LiveStrokeLayer.hold`, `live.held`,
`_buildList` spies → `_render`, the chevrons via `svgOverlay`, D271 on a load, S2/MEASURE deleted with `listFor`,
S1/S3/S9 on `Stage.snapshot`, the unit suites' `ts.content` → `__oracles__/renderList.tileContent(store, …)`), the
pointers into the SVG indicator moved to `svgOverlay.js`, and `prefetch.warm.test.js` (W-1..3).
**Measured (jsdom, the trial copy, before the reboot):** the 20 ported suites 344 tests, 1 fail (LH-1 in the parallel
run; alone 3/3 pass, as before my change); lint 0 errors of mine. The quick suite on the copy hit its 25-min deadline
(exit 124: `erase.follow` 1,444 s and `sync.tabs` failed) — the same stuck-file symptom the reviewer reports on its tree.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: re-running `erase.follow` and `sync.tabs` on the live tree and on the copy (load 0.1 now) to tell a stuck
file from my change; then the break-checks (warm rule, release-in-task, one writer) on an unimported copy.

## 2026-09-29 19:59 UTC — reviewer (B-PYRAMID review) — R-PYRAMID items 1–11 — end
**Working on:** done; servers stopped, no process of mine running. Built (red first, break-checks red): items 1, 2, 4;
item 8's minors and two defects found there (the snapshot strip's leaked slot, a drop forgetting every ask).
**Measured (headless Chromium 141, dense; P6 = 15b3738 same session; load 1.8–3.6):** 1 out paper 8.4 | 109.8 | 8.5 | 6.1
(P5 0.4 | 8 | 99; P6 0.4 | 1.8); undo key-to-exact 240 | 348 | 264 | 203 | 287 ms (P6 334 | 983), longest task 156–293
(P6 352 | 310), older 0 (coarse-first); 7 erase olderOther 1,404 | 1,276 after the unask fix (P6 659 | 519): its cells
are stale own plates with no patch asked (commit → next render ≤ 100 ms), not the stand-in's case; levelStep 2|3 older 0.
jsdom: raster.pyramid 37, PicturePyramid.* 42, jobQueue 9, snapshot 13, worker 22, engine 30, move 33, liveHold 3,
erase.worker 9 — green alone; a 63-file concurrent run: 763/767, LH-1 and RV4 red there with and without item 2 (load).
typecheck 0; eslint 0 errors after my S7b fix (7 warnings, none mine); bundles raster b72e5be7… 430,605 B, scene dce304b8….
Nothing in Kobin's Chrome.
**Decisions made:** the snapshot identity and the unask fixed as item 8's minors (one line each, red first).
**Questions asked:** in the report (scenario 7's commit window, the undo's pack cost, the (f′) last resort, the drop's budget).
WHERE I AM: ended — report handed back; B-PYRAMID-3 may take `RasterRenderer.js` and the raster modules.

## 2026-09-29 20:01 UTC — B-DRAG (builder) — no writes during a drag (C2) — start
**Working on:** the brief's reading list (DESIGN §8/§10; PLAN §0 d4/d9, §1.4, §1.7, §3 rows 7–8, §5.2/5.7/5.9/5.12/5.14;
A1 §1.4, §2, §4.4 C2, §4.6, §5 step 2, §6, §8, §14; A2 §2.7, §3; A3 §6; the C1 entries), then D1 (the hold carries
the drag). Files I will be in: `KobinEngine.js` (the drag paths and the per-remove listener only; shared with
B-PYRAMID-3, re-read before every edit, small edits), `selection.js`, `Document.js`, `LevelMap.js`, `Stage.js`
(`hold`/`release`/`setDragDelta`, `_home`), `placementModel.js`, `overlays.js` (`_selTable`'s box), `oplog.js`/
`format2.js` (the `move` op's snapshots), the move/select suites and probes, `__testkit__/modelFuzz.js`; last in D1,
one edit in `RasterRenderer.js`/`rasterPack.js` (the pack rule for held items), re-read first (rule 17).
**Measured:** tree at c7fed1a; load 3.0 at the start. Scratch `scratchpad/bdrag/`, ports 3040–3049.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading; next the code's drag paths (`_beginSelectDrag`, `_dragSelection`, `_endMove`, the drop).

## 2026-09-29 20:01 UTC — orchestrator (Fable) — the B-PYRAMID review landed (c7fed1a); B-DRAG launched; PLAN §5.15
**Working on:** the B-PYRAMID review's report answered in PLAN §5.15 (the patch step at the commit's task, the pack
priced with its prepass kept across commits, and the (f′) integral to a small B-PYRAMID-4 after B-PYRAMID-3 lands; the
drop's user budget to B-DRAG's D2; the pending path at a crossing to B-PYRAMID-3's item 4). B-PYRAMID-3 told its item 4
may land (rebased onto the reviewer's final files, not copied over). B-DRAG launched (`opus-builder`, `briefs/B-DRAG.md`).
Running: B-PYRAMID-3 (item 4), B-DRAG (D1). One slot free; B-PYRAMID-4 and the two reviewers follow.
**Measured:** the review's table (its 19:59 entry): zoom-out paper 6–8.5 ms quiet; undo key-to-exact 203–348 ms, older 0;
scenario 7 olderOther 1.3–1.4 s (stale own plates awaiting the next render — proposal 6); a snapshot's strip leaking a
worker slot per thumbnail and a drop clearing every ask, both fixed.
**Decisions made:** PLAN §5.15 items 1–4.
**Questions asked:** none.

## 2026-09-29 20:10 UTC — B-PYRAMID-3 (builder) — item 4 checkpoint: RasterRenderer extends nothing (live tree)
**Working on:** item 4 applied to the live tree (on c7fed1a, the reviewer's final files) by the checked scripts, not
by copying trial files: `RasterRenderer` composes `[PicturePyramid, SvgLayer, OverlayLayer, bl-sel-edges' slot]` in one
`_layers` list; `endLive` is `LiveStrokeLayer.hold()`, the group commit's callback `release(id)`; every prefetch read
warm, `_dropTile` forgets a warm key, the plan-time clearing gone; `listFor`, `_buildList`, `TileStore.content`/
`contentOffCamera`/`_reroute` and `Renderer`'s inheritance seams deleted; the suites ported (`raster.liveHold` →
`raster/LiveStrokeLayer.hold.test.js`); `prefetch.warm.test.js` W-1..3 new.
**Measured (jsdom):** the trial copy's quick suite 191 suites, 2,140 pass, 0 fail (12 skipped); the live tree after
the apply: lint 0 errors (6 warnings, none mine), typecheck 0; raster + stage + Renderer suites 45 files, 629/629 —
with LH-1 made deterministic (its bake timer stubbed: under load the shape landed inside the flush, red 3 of 3 runs at
65 and 45 files before; green alone). `erase.follow`/`sync.tabs` green alone on both trees (the 25-min stall was load).
**Decisions made:** FC1's list holds all four (the SVG layer and a z-3 slot that sizes and drops the chevrons' `<svg>`).
**Questions asked:** none.
WHERE I AM: the coordinator's addition — a held path carried across a crossing (re-anchored into the new frame, its
group's rectangle with it), its jsdom test and break-check; then the item-4 break-checks and the round trips.

## 2026-09-29 20:40 UTC — B-DRAG (builder) — D1 progress: the drag writes nothing, the drop writes once
**Working on:** built in the live tree (mine: `Stage.js`, `placementModel.js` (`homeOf`), `KobinEngine.js` (the hold,
`_endMove`, the pointer-up), `selection.js`, `overlays.js` (the ants' decision), `report.js`): `stage.setDragDelta(d,
{frame, viewDraws})`; held natives drawn at placement + δ by `placed`/`placeNative` (hit tests, lasso) and, while the
view draws them (no plane / plane lost), by `Item.res` (the raster pack and the SVG path both read it: no edit in
`RasterRenderer`/`rasterPack` was needed so far); each δ change then commits dirt at the old and new δ. The hold is
always taken (`plane` flag); `_planeLost` switches to the view drawing instead of releasing. `_dragSelection` writes
nothing; `_dropMove` runs `_displaceMember` once per (home, picture table) and `_dragFrames` once, one op, inside one
Stage batch with the release and `mergePending(op)`; `noteUserEdit` after it (PLAN §5.15 item 2). The ants decide at
rest (`stage.atRest`) and ride the pointer from the drag's start (`listAt` gone). `_normalizeHome`/`_homeShift`/
`_restoreFrames` deleted; a cancel writes nothing.
**Measured (jsdom):** baselines on a frozen `git archive` of d206cd3: `select.stands` 12×40 480 checks, 135 selections;
`model.equivalence` 25 seeds×40, 8,071 items, 0 ulp. After: 48 move/select/stage/raster files, 28 red, every one an
assertion of a mid-drag write/shadow/mint, the pen-up normalise, or `pl.state === "land"` right after the drop (the
drop's patch now fits `patchUserMs` and lands in its own task: confirmed by removing the line on a copy — M2, RV1, F3
and 4 translucent cases green without it).
**Decisions made:** keep the merge hand-over (`mergeFrame` handler) until C3: merges still happen at the drop.
**Questions asked:** none yet.
WHERE I AM: rewriting the red tests to C2 (mid-drag: document unchanged, `placed` at +δ; after the drop: the old asserts).

## 2026-09-29 20:59 UTC — B-PYRAMID-3 (builder) — checkpoint: the held path across a crossing; the break-checks
**Working on:** the coordinator's addition, built: at a frame change `_frameStep` first carries every held path into the
new frame (`_liveCross` → `LiveStrokeLayer.cross`: the root scaled by R^Δdepth, its drawn-at origin and box mapped, the
origin re-chosen at the view centre, a waiting group's rectangle moved by `PicturePyramid.moveGroup` before the
retarget reads it); `_pyrLive` asks the document, not the table, whether a stroke is gone or pending (a crossing's table
is read at idle, so the stroke was missing from it and its path came down). Tests LH-5 (out) and LH-6 (in).
**Measured (jsdom, break-checks on unimported copies):** LH-1..6 5/5 → green; carry removed 2 red, re-anchor removed 2 red,
table-as-truth back 2 red; warm off 1 red (W-1), `framesLeft` cold 1 (W-2), a key outliving its tile 1 (W-3), warm as a
pin 1 (W-3); release a task later 3 red (`raster.pyramid` never-both and the plane's landing); a per-frame origin 1 (FC6);
the layer adopting every origin 1 (LS-3); FC1's list short 2 (FC1, the overlay's list).
**Found (not mine, pre-existing on c7fed1a, jsdom):** (a) the queue's velocity rule re-aims a view strip without a floor:
fast zoom-out steps (1–3 ms apart) sent levels −14…−21 while the view was at −4/−5, and one such plate took 5–99 s
and 1.5–8 GB inline (the 25-min "stuck suite"); (b) a pen-up group whose strips are dropped as "exact" because the
cells are in flight for another job waits the whole LIVE_HOLD_MS: two strokes back to back, the second path up 3,070 ms.
**Questions asked:** (a) and (b) to B-PYRAMID-4 (clamp the re-aimed level at `ownFloor`; a dropped group strip re-asked or
resolved) — or filed as flags by me? Recommendation: I file both in OPEN-FLAGS now, B-PYRAMID-4 fixes.
WHERE I AM: the round trips on frozen copies (c7fed1a against it with item 4), then item 5's docs, the quick suite.

## 2026-09-29 21:12 UTC — B-DRAG (builder) — D1 progress: suites ported, the fuzzes green, a pre-existing drag defect found
**Working on:** the red tests rewritten to C2 (mid-drag: document byte-equal, `placed`/`placeNative` at +δ; after
the drop: the old assertions): `move.subtree` t1/t3/t8–t10, `move.normalise` N1, `move.below` MB-5 ×2, `gesture.robustness`
F50–F52/F51, `frame.gc` G1/G8, `select.inkless` I4/I10, `raster.move` M2/RV1/RV2/F3/H1, `raster.translucent` (the drop's
patch now fits `patchUserMs`: the tests set it to 0 to see the landing, as they set `patchInlineMs`), `raster.overlay` G11
(the ants decide at rest in both renderers). New `move.drop.test.js` (12 tests). `modelFuzz.comparePictures`: a native
the oracle normalised (its stored numbers differ) is compared by its drawn box through each model's placement.
**Measured (jsdom):** `move.drop` 12/12 — per event 0 doc events, 0 re-homes, 0 settles, rev/offRev/addrEpoch/frames/undo
unchanged over 40 events (per-object, frame, both). Census (A1 §1.4 fixture, seeds 12345/777/4242, 40 × 7 px, a render
each): frames minted during the drag, pre-B-DRAG tree 211/145/239, now 0/0/0; left after GC 14/4/4 → 14/5/4 (oracle
15/5/5). Found: on the pre-B-DRAG tree the same walk put 400 of 1,250 natives one cell (32 units) off the per-object
picture (seed 777; the mover merged into a container its own trail minted); now 0 of 1,250 (test red on a copy of
d206cd3, green here). `select.stands` 12×40: 480 checks, 135 selections (= baseline). `model.equivalence` 25 seeds × 40:
1,000 checks, 8,049 items, 37 carried at 0 ulp, 16 normalised within 1.5e-8 home units.
**Decisions made:** no edit to `RasterRenderer`/`rasterPack`: the pack rule is the Stage's `Item.res`.
**Questions asked:** none.
WHERE I AM: scenario 4 in headless Chromium (pre on :3040, this tree's archive on :3041), then D1's break-checks.

## 2026-09-29 21:20 UTC — B-PYRAMID-3 (builder) — checkpoint: the round trips, the warm rule re-measured, the docs
**Working on:** item 5: the docs made true (DESIGN §9/§15, `docs/ai` 10/20/30/40, PLAN §1.5, A3 §7.2, TEST-MAP, the
oracles' README, OPEN-FLAGS F83/F120/F131 notes and the new F134/F135); the quick suite running on the live tree.
**Measured (headless Chromium, frozen copies: c7fed1a :3020 against c7fed1a + item 4 :3021, load 1.2–5.4):** the
harness's canvas ink hashes identical at its four states, two runs each; `?svg` round trip 0 px in 9 of 9 states (a
second pair 1 px, one level, in 3 states — the two after runs differ by that pixel too); the raster round trip's
screenshots 0 px in 7 of 9 states, and at the live stroke 0 px once the hold state is matched (logged: the earlier
stroke handed off in both, or held pending in both — which one depends on the run, not the tree). The shipped warm rule
(prefetch reads warm, a dropped tile forgotten) on the dense zoom-out and back: back in 8 bakes twice (3.1–3.6 s; the
all-snapshots measurement was 9–10, warm off 19–22). Worker bundles unchanged (b72e5be7…, dce304b8…); lint 0 errors;
typecheck 0.
**Decisions made:** none new. F134/F135 filed as the coordinator said.
**Questions asked:** none.
WHERE I AM: the quick suite's result, then the end entry and the report.

## 2026-09-29 21:27 UTC — B-PYRAMID-3 (builder) — items 1–5 — end
**Working on:** done. Items 1–3 as checkpointed; item 4: `RasterRenderer` extends nothing (FC1's list of four), the
live stroke's hold/release the layer's, a held path carried across a crossing, every prefetch read warm, `listFor`/
`_buildList`/`TileStore.content`/`contentOffCamera` and the inheritance seams deleted; item 5: the docs.
**Measured:** the quick suite on the live tree (item 4 + B-DRAG's D1 in flight): 190 of 192 files, 2,152 of 2,166
tests (12 skipped); red: `eraseWorkerClient` reservation (green alone, load) and `raster.pyramid`'s plane landing
("land" expected, "idle") — green on c7fed1a + item 4 alone (37/37), so B-DRAG's drop, not item 4. On the trial copy
before B-DRAG: 191 files, 2,140/2,140. Lint 0 errors, typecheck 0, bundles unchanged. Nothing in Kobin's Chrome.
**Decisions made:** as logged (FC1's z-3 slot; the document answers gone/pending; `_dropTile` forgets a warm key).
**Questions asked:** in the report (F134/F135 went to B-PYRAMID-4's brief).
WHERE I AM: ended — report handed back; `RasterRenderer.js` and the raster modules are free for B-DRAG and B-PYRAMID-4.

## 2026-09-29 21:29 UTC — B-PYRAMID-4 (builder) — the pyramid's last four rules (PLAN §5.15; F134, F135) — start
**Working on:** the brief's reading list (DESIGN §9; PLAN §0 d2, §1.2, §1.5, §5.11 item 3, §5.15, §5.17 when written;
A3 §1.4 (f′), §3.3–§3.6, §4.4; F134, F135; the review's and B-PYRAMID-3's entries), then the five rules in order:
the patch step in the commit's task, the pack priced with its prepass kept, F134's floor, F135's re-ask, (f′)'s integral.
Files I will be in: `src/engine/raster/{PicturePyramid,RasterRenderer,jobQueue,rasterPack,PyramidStore,prefetch}.js`,
the raster suites, `tools/harnesses/browser-check.js`, `DevStats.js`'s pyramid fields, DESIGN §9, A3, `docs/ai/40-`,
OPEN-FLAGS F134/F135. Not `KobinEngine.js` unless a rule needs one line there (re-read first, rule 17).
**Measured:** tree at b793360; load 2.11 / 3.58 / 3.65 at the start. Scratch `scratchpad/bp4/`, ports 3010–3019.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading; next DESIGN §9 and PLAN §5.15, then the code's commit hook and `_patchStep`.

## 2026-09-29 21:29 UTC — orchestrator (Fable) — B-PYRAMID-3 landed (b793360); B-PYRAMID-4 launched; PLAN §5.17
**Working on:** B-PYRAMID-3's report answered in PLAN §5.17 (the `Stage.js` mention of `listFor` to B-DRAG; docmaps to
the final docs pass; the dead `live` argument and the double-alpha check to B-PYRAMID-4). B-PYRAMID-4 launched
(`opus-builder`, `briefs/B-PYRAMID-4.md`: the patch step at commit, the pack priced with its prepass kept, F134's
floor, F135's dropped group strips, the (f′) integral). Running: B-DRAG (D1's browser check and break-checks),
B-PYRAMID-4. One slot free; the reviewers for B-DRAG and for B-PYRAMID-3+4 follow their reports; B-MODEL-C34 after
B-DRAG's review.
**Measured:** B-PYRAMID-3's: the `?svg` round trip 0 px in 9 of 9 states; F133 fixed (memory flat over 40 drag events);
the back-in re-bakes 8 against 19–22 with the warm reads; the quick suite 2,140/2,140 on its trial copy.
**Decisions made:** PLAN §5.17 items 1–5.
**Questions asked:** none.

## 2026-09-29 21:48 UTC — B-DRAG (builder) — D1 checkpoint: the hold carries the drag (and D2/D3 built)
**Working on:** D1 done; D2's and D3's code is in too (the drop in `_dropMove`, `_normalizeHome`/`_homeShift`/
`_restoreFrames` deleted, `noteUserEdit` at the drop; the per-remove listener and `_keepingSelection` deleted, the
selection repaired from the op by `_opUnder`/`_repairSelection` (drop, undo, redo — one `_history` path), quietly,
before the one render; `homeOf`; `withShifted`, the one box helper for `reachBox`/`frameFootprint`/`_selTable`).
Ported for the coordinator: `raster.pyramid`'s landing test (`patchUserMs` 0), `Stage.js`'s `listFor` comment.
**Measured (headless Chromium 141, dense seed 1, 3,441 natives, 45 selected; d206cd3 on :3040, 7319c2b on :3041):**
scenario 4 after the drop, reduced motion: 0 px of 1,024,000 differ with the ants, 0 with the ink alone (load 3.7).
Harness scenario 4 ×2 (load 2.9–4.6): drag long frames 26|25 → 22|23; the worst is the pointer-up, 1,775|1,852 →
2,189|2,600 ms, and `olderPatchMs` 1,081|1,090 → 1,138|1,578 (the drop's patch T 437–555 ms: over 16 as over 6, to the
workers either way). The drop timed by part: `_dropMove` 16–24 ms, the render 1.8–2.0 s both trees, and `_reselect`
358–484 ms here against 0.2 — the drop now tears off frame "1/-1,1" (a carried kid) and the repair's second ants
decision paid for it; now repaired before the render (to re-measure). That kid: the pre-B-DRAG drop left its 100
natives at x 271.99, a cell (32 units) past where the move puts them (239.99, the per-object picture) — the same
defect as the census's seed 777; filed as F136 in D4.
**Decisions made:** none new. **Questions asked:** none.
WHERE I AM: the 5,000-native delete timing (jsdom, running on both trees), then the drop re-timed and D2/D3 entries.

## 2026-09-29 21:56 UTC — B-PYRAMID-4 (builder) — progress: rules 1, 3, 5 written; F135's real mechanism found
**Working on:** rule 3 (F134) in `jobQueue._aim` (AIM_LEVELS 2, `ownFloor`); rule 1 (`PicturePyramid.noteCommit`/
`patchIfDue`: the commit hook marks the patch step due, the next compose or step runs it, else a microtask — not in the
hook, so an undo's `noteUserEdit` still sets its budget); rule 5 (`_lastResort`: (f′) unread → `olderUnreadMs`, its job
pending → `olderPatchMs`). New `raster.commit.test.js`; `jobQueue.test.js` F134; LH-7 in `LiveStrokeLayer.hold.test.js`.
**Measured (jsdom; red-before on `scratchpad/bp4/rb`, a HEAD copy with the new tests):** 5 of 14 red there (the velocity
rule's descend at 23, F134 at −19; the two commit tests: no patch step before the compose; the engine's zoom-out sent
−11/−13 with the view at −3/−5). F134's cost is `Stage.covers` → `_tileKeys` building every tile key under the cell:
−17 0.12 s, −18 0.6 s, −19 2.6–2.9 s and 1.5 GB RSS (×4 a level: the flag's 5–102 s at −19…−21). F135 reproduced on HEAD
with B-PYRAMID-3's script (3,083 ms, `timedOut` 1); logged: two pen-up groups over the same two cells, `_groupOf`
overwritten by the second, whose commit takes the first's results — the FIRST path stays 3 s over plates that already
show its stroke (both shown: a translucent stroke doubled — likely PLAN §5.17 item 4's 53,919 px). My LH-7 did not
reproduce it (fills + bake timer): it is being rewritten to the reproducing setup. Before batch (b793360 archive on
:3010, `--dense --scenario all` ×2, load 1.9 → 4.5–4.7, contended by other agents' suites): 7 olderOther 1,577 | 1,797
ms (ownOther 127 | 157 cells, coming 7 | 38), bake 8.3 | 8.1 s; 6 undo exact 260 | 281 ms; 5 release 15 | 84 ms.
**Decisions made:** F135's fix is the overlap, not the brief's dispatch re-ask (the trace's dropped strips were exact in
the store, nothing in flight): overlapping pen-up groups merge (both paths go at one commit); a result counts for a
group when packed at/after its G or exact at landing (rule 2: then the stroke never touched the cell), and a need key's
landing that does not count re-asks it inside the group — the brief's "re-asked / re-targeted at that landing".
**Questions asked:** none yet (the (f′)-pending → olderPatch choice goes to the report).
WHERE I AM: the group merge in `PicturePyramid.groupCommit`/`onResult`, then LH-7 on the reproducing setup.

## 2026-09-30 00:54 UTC — orchestrator (Fable) — the session-limit stop of 22:04 UTC; both builders resumed; R-PYRAMID-34 drafted
**Working on:** the session limit stopped B-DRAG (last action 22:03: `deleteSelection` collecting the members before the
removals, re-timing the 5,000-native delete) and B-PYRAMID-4 (last action 22:03: the F135 overlap merge in
`PicturePyramid.js` with LH-7 rewritten and measured, the raster suites started, the dead `live` argument next). The
container rebooted (uptime 0 at 00:52 UTC): every server and batch is gone, the scratchpad and the live tree's edits
survived. The tree snapshot-committed with this entry (`[skip ci]`); both builders resumed by message with that state.
`briefs/R-PYRAMID-34.md` drafted (one reviewer for B-PYRAMID-3 and 4; launched when B-PYRAMID-4 reports); R-DRAG's brief
got the browser-batch coordination line (announce a batch's start and end here; start only under load 2).
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the builders' next entries; the monitor re-armed.

## 2026-09-30 00:54 UTC — B-PYRAMID-4 (builder) — resumed after the reboot (the 22:03 session-limit stop)
**Working on:** the tree as 5f50923 left it (rules 1, 3, 5 in d2de230; the F135 merge and LH-7 in 5f50923). First the
raster suites on the live tree (cut off at the stop), then the dead `live` argument (`MovePlane.aim`/`_cut`,
`paintFamilies`; PLAN §5.17 item 3), rule 2 (the pack priced, the prepass kept across commits — keyed so a held drag's
`Item.res` and the drop's placement are seen), the after batch, PLAN §5.17 item 4's doubling in headless Chromium, the
docs, OPEN-FLAGS F134/F135, the bundles. Files as in the start entry, plus `MovePlane.js` (the dead argument).
**Measured (before the stop, jsdom):** LH-7 on the fixed tree ×3: both paths released at one commit, hold max 41 | 46 |
63 ms, 0 composes showing a stroke while its path was up, `groupsTimedOut` 0; on the HEAD-before copy (`bp4/rb`): 3,050
ms, `timedOut` 1, 12 composes drawing stroke 1's plates (level and rest cells) under its held path. Load now 0.12
(machine just rebooted).
**Decisions made:** as the orchestrator's notes: the never-both rule holds for EACH path of a merged group (one commit
publishes and releases every member; a result showing any member's stroke is never put while that path is up) — to be
written so in the docs.
**Questions asked:** none.
WHERE I AM: the raster suites on the live tree (a background run, output `bp4/suite-raster-2.log`).

## 2026-09-30 00:55 UTC — B-DRAG (builder) — resumed after the session-limit stop and the reboot
**Working on:** the tree as left (snapshot 5f50923: `deleteSelection` reads every family before its one removal batch,
`select.inkless` I11 added, I9 deleted). Before the stop, measured in jsdom (my fixture: N small shapes in frame "0" on
screen, all selected, `deleteSelection` then `undo`, SVG unless said): pre-B-DRAG (d206cd3) 1,000 → 19.8 s with 999
`_setSelection` calls, 5,000 → 585 s with 4,999 (ran beside another jest run); here 1,000 → 0.25 s, 5,000 → 3.9 s SVG /
4.6 s raster with 0 calls, then 1.9 s / 0.78 s once the families are read before the removals (the family index was
rebuilt per id between removals: O(n²)). Undo 5,000: 4.9–5.3 s SVG (two.js's render, both trees), 0.67–0.85 s raster.
**Measured:** load 0.11 at the resume; nothing running of mine (the reboot took the servers and jobs).
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: the suites for `deleteSelection`, the 5,000-native delete re-timed on both trees at a quiet load, then the
drop re-timed in Chromium (servers on :3040/:3041), the D2/D3 entries, D4's docs, the break-checks, the report.

## 2026-09-30 01:22 UTC — B-PYRAMID-4 (builder) — progress: the raster suites; where the undo's 45–64 ms pack goes
**Working on:** rule 2's design from a measurement; the dead `live` argument next with it (`rasterPack` is its home).
**Measured:** raster suites on the live tree (5f50923 + nothing new; the run matched 159 files): 1,602 pass, 1 fail —
`stage.cover` C4 (`pl._whole(pl.quick)` false), green alone 5/5 (load: 5–7 during the run). Headless Chromium, an
instrumented copy (`bp4/probe`, never the live tree) of HEAD, scenario 6 ×8 (load 2.7–6.8): the undo's patch T 18–28 ms
against 16 → coarse-first at ℓ −1 (T 8–12 ms) inline; that inline pack is 45–64 ms: the prepass 18–33 ms — its loop
0.7–9 ms, the sort 0.1, `sameFamily` 2, `famFill` 21 ms for ~1,300 families: the FAMS key at Zq 0.5 was last filled from
a prefetch snapshot's list, whose items wrap the same pieces anew, so no family matched — and the copy 21–29 ms: the job
keeps every item of its two whole cells (764 items, 3.9 M doubles, 31.5 MB) although its clips are the undone stroke's
dirt; the cull 0.7–1.7, the geometry 1.7–2.3, the masks 0. jsdom agrees in shape (2,814 items a list, all single-item
families).
**Decisions made:** rule 2 as the brief says, keyed as the data says: each item's prepass record kept by its geometry
(the memo's key) per zoom/dpr/cfg/offset — shared by the camera's and a snapshot's lists — rebuilt only when its entry,
fade, z, family, erase flag or `res` (the held drag's placement, the drop's write) changed; a family keeps its union
rule and sign while its records are the same; the pack priced as `k.pack × items` (calibrated from every pack).
**Questions asked:** the clip cull — a clipped job packing only the items that meet its clips (exact: an item whose box
misses the clip adds nothing inside it) would take the copy from 21–29 ms to the change's own; recommendation: build it
here, it is what makes the priced coarse-first fit (else the priced undo goes to the workers, stale until they land).
WHERE I AM: rewriting `prepassFor`/`famFill`/`famTake`/`sameFamily`/`famStale` in `rasterPack.js` (records by geometry).

## 2026-09-30 01:31 UTC — orchestrator (Fable) — B-PYRAMID-4's clip cull: yes, with conditions (PLAN §5.18)
**Working on:** B-PYRAMID-4's 01:22 question answered in PLAN §5.18 (the clip cull built here as the plate cull
narrowed to plate ∩ clips, the family's union routing and sign untouched; a byte-equal fuzz over random clips, two
break-checks, scenario 6's copy and T before and after, clipped jobs only, the bundles). `stage.cover` C4's load-red
goes to the B-PYRAMID-3/4 reviewer (its brief updated). The PLAN's numbering moved: B-DRAG's report → §5.19,
B-PYRAMID-4's → §5.20 (both briefs updated).
**Measured:** nothing.
**Decisions made:** the clip cull is in B-PYRAMID-4's scope.
**Questions asked:** none.
WHERE I AM: waiting for the builders' next entries.

## 2026-09-30 01:38 UTC — B-DRAG (builder) — D2 checkpoint: the drop, once
**Working on:** D2 done. `_dropMove` (selection.js): `_displaceMember` once per (home, picture table) on the composed
table, whole cells into the address, the rest into the own table less the target frame's shift; the frames by
`_dragFramesStart`/`_dragFrames` once; one op, no `base`/`after` (the codecs carry them only on older ops, for replay
and their inverses); the write, the hold's release and `mergePending(op)` one Stage batch; then `noteUserEdit`.
`_normalizeHome`, `_homeShift`, `_restoreFrames` deleted.
**Measured (jsdom unless said):** census (A1 §1.4 fixture, seeds 12345/777/4242): frames minted during the drag 211/145/
239 → 0/0/0, left after GC 14/4/4 → 14/5/4. Registration: the same 40-step walk on the frame vs every native per
object, 1,250 natives — pre-B-DRAG 400 off by 32 units at seed 777 (F136), now 0 at 777/12345/99. `move.drop` D2: the
first commit after the press holds the op, the released hold and every write. Chromium, scenario 4 (load 2.3–4.5): ink
0 px differ, with the ants 0; the drop's pointer-up 1,715–1,968 ms (pre) vs 1,526–1,861 (now), `_dropMove` 16–18 ms;
harness ×2: long frames 22|26 → 24|16, worst 1,664|1,957 → 1,738|1,755 ms, `olderPatchMs` 953|1,218 → 988|886 (the
drop's patch estimate 437–555 ms, over either budget: `noteUserEdit` changes nothing there; in jsdom's small scenes it
lands inline and the plane ends in the drop's task — the landing tests set `patchUserMs` 0 to see it).
**Decisions made:** the codecs keep carrying `base`/`after` where an older op has them (an undone replayed op's inverse
must log them); new ops never do.
**Questions asked:** none.
WHERE I AM: D3's entry, then D4's docs.

## 2026-09-30 01:39 UTC — B-DRAG (builder) — D3 checkpoint: the selection from the op
**Working on:** D3 done. `_opUnder(op)` (read before the action: the op's frames under a selected frame, its per-object
members listed or under one) and `_repairSelection` (after: `_reselect` quietly — torn frames join as frames, carried
natives as ids, ids back under a frame leave, removed ids go with the family hand-over, inkless frames leave), used by
the drop and by `undo`/`redo` (one `_history` path), before the one render. Deleted: `_keepingSelection`, the `_moving`
capture and the per-remove listener (the subscriber keeps `reset` and the merge hand-over, C3's). `deleteSelection`
reads every family before one removal batch, clears once. `placementModel.homeOf` (Stage's `_home` read);
`withShifted`, the one box helper. The ants: decided at rest; a decision still good at rest becomes the drag's.
**Measured (jsdom; my fixture: N shapes on screen in "0", all selected):** delete 1,000: 19.8 s, 999 `_setSelection`
calls → 0.25 s, 0; 5,000: 585 s, 4,999 calls (SVG, beside a jest run) → 1.29|1.51 s SVG, 0.53|0.54 s raster, 0 calls
(load 2.0); undo of 5,000 4.1–4.2 s SVG (two.js, both trees), 0.61–0.65 s raster. `select.inkless` 10/10 (I3/I5/I6/I8
count one repair an action, I11 new, I9 deleted). Chromium: the drag's first step 64–66 ms (pre, 44 pieces decided —
the first write had dropped frame "1"'s tiles from the table) → 27–33 ms (the at-rest decision of 1,044 pieces kept).
**Decisions made:** I4 kept (merges stay until C3). **Questions asked:** none.
WHERE I AM: D4 — DESIGN §1/§8/§9/§10, docs/ai 20/30/40, PLAN §1.4/§1.7, A1 §14 C2, TEST-MAP, OPEN-FLAGS (+F136).

## 2026-09-30 01:40 UTC — B-PYRAMID-4 (builder) — checkpoint: rule 2 and the clip cull built (PLAN §5.18); all five red-before
**Working on:** `rasterPack.js` — the prepass's records kept by geometry (`recFor`: rebuilt on entry/fade/z/family/erase/
`res`-by-value change; the set bounded to the last list's items at each of RECS_KEYS 8 zoom|dpr|cfg|offset keys), a
family keeps its union rule/sign while its records are the same; the clip cull in `PlateBinner` (a clipped job files an
item into a plate only where its floored pixel box meets that plate's clip; whole-cell clips cull as before); the dead
`live` gone from `packJob`/`prepassFor`/`paintFamilies`/`visibleChords`/`outsideWin`/`MovePlane.aim`/`_cut`/the renderer.
The estimate prices the pack (`packItemUs` 20 × kept items + `packListUs` 1 × list items, both calibrated from every
`_pyrPack`). F135: `_notForGroup` re-asks only when no ask since the group's G and no other job in flight is coming.
**Measured (jsdom; red-before on `bp4/rb` = adcae93's code with the new tests):** 9 of 117 red there — J4g (records by
geometry), the clip-cull fuzz, the pack's price, the two commit tests, F134's engine test, the never-older fuzz
(`olderOtherMs` 178.6 → 0 here: 117 plans, 42 older, all (f′) unread, `olderUnreadMs` 139), the two F135 unit tests
(exact-at-landing; the join) — plus jobQueue's two and LH-7 before. Live tree: raster.job 41/41, rasterCore.clip 13/13
(the fuzz: 36 seeds × 3 zooms, byte-equal inside the clip), PicturePyramid.* + raster.pyramid 82/82 (one earlier red in
a concurrent run, not reproduced ×3), raster.commit 4/4, LH 6/6, raster.move, stage.cover, raster.snapshot green.
**Decisions made:** the record set's bound is the last list per key (not a WeakMap over every piece: that would hold
entries the memo evicted); the union state kept by record identity, replaced per prepass (bounded).
**Questions asked:** none new.
WHERE I AM: the break-checks on `bp4/bc`, then the bundles, typecheck, lint, the frozen after-copy and the batch.

## 2026-09-30 02:02 UTC — B-PYRAMID-4 (builder) — checkpoint: the break-checks; the after batch running
**Working on:** the interleaved batch (`bp4/batch2.sh`: before = 39b67e2 with my five raster sources at adcae93 on
:3014, after = 39b67e2 + the live tree's changes on :3015, one frozen harness, `--dense --scenario all` ×2 each, then
the round trip ×2 each with the never-both log); meanwhile the docs (DESIGN §9, A3's dated notes, `docs/ai/40-`,
OPEN-FLAGS F134/F135 — B-DRAG has A3 and OPEN-FLAGS open too: re-read before each edit, my sections only).
**Measured (jsdom, `bp4/bc`, one guard removed at a time):** 18 of 18 red: r1 hook 2, compose 1, in-hook 2; r3 clamp
1, floor 1, both 2; r4 join 2, exact-at-landing 1, a stroke-bearing result put 1, never re-asked 1, a held cell's
second result put 1; r5 unread 2, (f′)-pending as other 1; r2 records 1, the clip margin 1, marks culled 2, unpriced 1,
uncalibrated 1. The F134 engine test made deterministic (jobMs 40, steps under 1 ms): red on adcae93 (no view strip
dispatched: all re-aimed off the lattice), green here. Bundles rebuilt: raster b72e5be7… 430,605 B, scene dce304b8…
(unchanged: the pack runs on the main thread, `rasterPack` is not in them). typecheck 0; lint 0 errors (6 warnings,
none mine). `DevStats` and `report.js` carry `olderUnreadMs`; the harness `olderUnreadMs`, `both`, `inlinePacks`,
`unread`, `packRecs`.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: the docs while the batch runs; then its table, the probe split after, the report.

## 2026-09-30 02:05 UTC — B-DRAG (builder) — D4 checkpoint and end: the tests, the docs, the break-checks
**Working on:** D4 done, and B-DRAG with it. Tests: `move.drop.test.js` (new, 14), `select.inkless` I12 (an undo that
removes a selected native drops its id), `raster.move` RV2 (the view draws the hold from the plane's loss). Docs: DESIGN
§1/§8/§9/§10, docs/ai 10/20/30/40, PLAN §1.4/§1.7, A1 §15, A2 §2.7, A3 §6, TEST-MAP (C2), OPEN-FLAGS F136 (new,
fixed) and notes on F93/F94/F100/F107/F108/F126, `select.stands.probe.js`'s comment.
**Measured:** break-checks on the unimported copy `bdrag/bc`, one line each (red/run): a write in a step 2/14;
`placed` without δ 3/22; `placeNative` without δ 2/28; the view's delta uncommitted 2/20; `res` without δ 3/24; the
release without the drawn states 1/20; a cancel merging 3/28; no `noteUserEdit` 1/14; a hold only with the plane
8/47; the plane's loss ignored 1/47 (RV2); the ants decided with δ 2/142; no at-rest reuse 1/101; the repair without
frames 1/10, without ids 1/10, none after undo/redo 4/24, none after the drop 3/24; dead ids kept 1/100 (I12).
Quick suite: 193 of 198 suites, 2,169 passed, 12 skipped, 0 failed (251 s, load 2.3 → 3.0); typecheck 0; lint 0
errors (6 warnings, in files unchanged since d206cd3); no file of mine is a worker input (esbuild metafile): bundles
not rebuilt. Fuzzes on the final tree: `model.equivalence` 25 seeds × 40, 1,000 checks, 8,049 items, 37 carried at
0 ulp, 16 normalised within 1.46e-8; `select.stands` 12 × 40, 480 checks, 133 selections (135 on d206cd3 and at
21:12: an undo that empties selected frame "0/5,7", seed 12 step 23, now drops it, where the oracle keeps it;
`inklessBoth` 2 → 0). The 5,000-native delete on d206cd3 re-run at load 3.84 → 2.57: 532 s, 4,999 calls.
**Decisions made:** the inkless rule after every undo and redo stands, as DESIGN §10 says (a frame left with no ink
leaves); A1 §15, TEST-MAP and F93's note carry the new count.
**Questions asked:** none here; "moved into" and the second parent pointer are in the report.
WHERE I AM: done. My servers on :3040/:3041 stopped; nothing of mine running. Nothing checked in Kobin's Chrome.

## 2026-09-30 02:08 UTC — orchestrator (Fable) — B-DRAG landed (D1–D4); PLAN §5.19; R-DRAG launching
**Working on:** B-DRAG's report read in full and answered in PLAN §5.19 ("moved into" kept as built and put to Kobin;
the second parent pointer not built, his decision; the inkless rule after undo/redo stands per DESIGN §10, on his
list; the drop's patch to R-PYRAMID-34's attribution and R-DRAG's `setBatch` timing; the remote-removal repair to
B-MODEL-C34; RV4, seed 777's frame count and `ownIn` to R-DRAG; `supportsDragPlane` to B-PYRAMID-4). The tree
committed as B-DRAG's landing (B-PYRAMID-4 still in progress in the raster files). R-DRAG (opus-reviewer,
`briefs/R-DRAG.md`, ports 3040–3049) launches now; B-MODEL-C34 after it ends.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: launching R-DRAG; waiting for B-PYRAMID-4's report.

## 2026-09-30 02:09 UTC — R-DRAG (reviewer) — the review of B-DRAG (items 1–9) — start
**Working on:** the reading list (preamble, `briefs/R-DRAG.md`, PLAN §0/§1.4/§1.7/§3/§5.2/§5.15/§5.19, B-DRAG's brief
and entries, then DESIGN §8/§10, A1 §1.4/§4.4 C2/§4.6/§8/§15, A2 §2.7), then the code of 8f9c073 against d206cd3.
Files I may be in (brief §3): `selection.js`, `Document.js`, `LevelMap.js`, `Stage.js`, `placementModel.js`,
`overlays.js`, `oplog.js`/`format2.js`'s move op, the move/select suites and probes, `__testkit__/modelFuzz.js`,
`eraseDescent.js`'s `ownIn` only (the rule-3 minor), DESIGN §8/§10, A1 §15, OPEN-FLAGS' move flags; `KobinEngine.js`
(shared) re-read before any one-line edit. Not mine: the raster modules, `RasterRenderer.js`, the raster suites, the
harness (B-PYRAMID-4, then its reviewer). Scratch `scratchpad/r-drag/`, ports 3040–3049.
**Measured:** tree at 8f9c073 (+ B-PYRAMID-4's uncommitted `RasterRenderer.js`, `raster.pyramid.test.js`); load 1.79.
No browser batch yet (I will announce one before it starts).
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading; next the design docs, then the diff d206cd3..8f9c073 in my files.

## 2026-09-30 02:28 UTC — R-DRAG (reviewer) — checkpoint: one major (a mixed drop moves a member twice), seed 126
**Working on:** items 1–2, 4, 8 on frozen copies (`r-drag/pre` d206cd3, `post` 8f9c073, `fix`/`fz` = the live tree + one
change each). Live tree unchanged by me so far.
**Measured (jsdom; load 2.0–3.8):** named suites on the live tree 87/87, `select.stands` 480 checks/133 selections,
`model.equivalence` 25 seeds 1,000 checks/8,049 items/16 normalised ≤ 1.46e-8 (= B-DRAG's). **Major:** a selection of a
frame R plus a per-object member X homed in R's neighbour: a drop that carries X into R's start cell lands X at 2δ
(0.6 cell: 38.4 px for 19.2; 1.4 cells: 89.6 for 44.8; a deeper member Y 70.4 for 35.2) — `_dropMove` re-homes the
members against the press lattice (into R) and then re-addresses R, which moves X again (`selection.js:676–720`). d206cd3:
0.6 cell 24 px (its last event only), 1.4 cells right. Fix on `fix`: re-address the frames first, then the members
against the lattice they left — all at +δ in 5 cases, undo/redo pictures exact; one case's undo merges R into the twin
minted in its vacated cell (F80's mechanism, picture kept, redo byte-exact). Equivalence 200 seeds: 1 red on the live
tree (seed 126 step 33) — not the model: an undo emptied a selected frame, the live repair dropped it, the oracle kept it,
a ctrl-lasso+drag then moved it in the oracle only and the op streams parted. With the oracle given the same rule after
each undo/redo (`modelFuzz`, `O._reselect([], [])`): 200 × 40 green, 8,000 checks, 55,701 items, 137 normalised.
**Decisions made:** the harness sync is a minor (mine: `modelFuzz.js`) — to apply with its note.
**Questions asked:** orchestrator — may I apply the reorder in `_dropMove` (≈10 lines moved, no new mechanism) with a
red-before `move.drop` test (red on 8f9c073 at 38.4/19.2, green after)? Recommend yes; F80 on the undo is C3's.
WHERE I AM: the `setBatch` timing (item 2), then the cancel exits (item 3) and the interleaved-drag fuzz (item 1).

## 2026-09-30 02:29 UTC — orchestrator (Fable) — R-DRAG's major: leave granted for the `_dropMove` reorder
**Working on:** R-DRAG's 02:28 checkpoint read: a mixed drop (a selected frame R plus a per-object member X homed in
R's neighbour) moved X twice — `_dropMove` re-homed the members into R against the press lattice, then re-addressed
R, which carried X again (2δ). Leave granted by message: the frames re-addressed first, then the members against the
lattice they left, with the red-before `move.drop` test over its three cases, undo/redo exact, the census and the
fuzzes re-run, the rule in the `_dropMove` comment, the registration invariant restated from the code; the undo case
that merges R into the twin minted in its vacated cell (F80's mechanism) recorded as C3's. The `modelFuzz` sync of
the oracle's reselect rule after undo/redo (seed 126 was the harness, not the model) is its minor; the frozen oracle
module stays untouched.
**Measured:** nothing.
**Decisions made:** as above; the answer to its report will be the PLAN's next section.
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-4's report and R-DRAG's next checkpoint.

## 2026-09-30 02:36 UTC — B-PYRAMID-4 (builder) — checkpoint: the final tree frozen, its batch running
**Working on:** the final after batch (`bp4/batch3.sh`: `bp4/bC` = 8ad8a2e + my uncommitted raster changes, :3016,
`--dense --scenario all` ×2, then the round trip ×2 on bC and on the before copy bA, :3014); the docs meanwhile.
**Measured (headless, before the freeze):** batch2's first after run (bB) and one probe6d pair showed my rule 2 wrong
twice, fixed before the freeze: (1) a kept record touched the memo's LRU (a Map delete + set a list item): the undo's
prepass 26 ms over 2,841 items; now no touch, as the families it replaced; (2) the pack's terms (calibrated 48–140 µs a
packed item, 2–8 µs a list item) put every coarse level over budget, and the search measured all eight: the undo's key
task 317 ms (before 117); now the search stops when the pack alone is over the budget, and the list term calibrates
only from prepasses that kept 90 % of their records. Also: a drag plane's `only`/`omit` pack adds to the records and
drops none (J4g extended); `supportsDragPlane` and its assertion deleted (the coordinator's addition). The erase bake
of scenario 7 never finished in 60 s in batch2's before-2 (old raster code on HEAD) as in bB's run: not mine — an
intermittent stall with strips queued and none in flight (the queue's state logged by `h/probe7.js`, not yet run).
Focused suites on the live tree: 13 files, 212/212. Before (bA, 39b67e2 with my raster sources at adcae93, load
1.9–3.7): 1 out paper 6 | 946, back 0 | 0; 6 undo exact 260 | 819 ms (coarse ℓ −1 inline: pack 50 ms, 764 items);
7 olderOther 1,370 | 1,573, bake 6.7 s | stalled.
**Decisions made:** these three fixes in before the one freeze (they are defects of this task's own code).
**Questions asked:** none.
WHERE I AM: A3/DESIGN/OPEN-FLAGS text while the batch runs; then its table into them, the end entry, the report.

## 2026-09-30 02:41 UTC — orchestrator (Fable) — Kobin: the reviews short, the highest-value items first
**Working on:** Kobin's instruction (02:40): keep the current reviewers relatively short and focused on the highest-value
items — the final build phase (B-MODEL-C34 and its review) and the full design check must fit in his weekly usage.
R-DRAG told by message (the reorder with leave, then items 1, 3, 4's answers and §10 check, 6; the rest dropped or one
line; one scenario 4 pair at most; hand back within ~60 min). `briefs/R-PYRAMID-34.md` trimmed: a scope block (items
3+10, 8, 11b, 7, 9, 4 first; 1/13/14/12/11 as time allows; 2/5/6 skipped), one harness run on the final tree, ~90 min.
B-MODEL-C34's reviewer will be briefed the same way.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-4's report (its batch runs) and R-DRAG's next checkpoint.

## 2026-09-30 02:47 UTC — R-DRAG (reviewer) — the review of B-DRAG — end (narrowed scope, 02:41)
**Working on:** done. In the tree: `selection.js` (`_dropMove`: the frames first, with leave), `move.drop.test.js` (D2b ×3,
D3 + tool change + redo mid-drag, F136's walk runnable on d206cd3), `__testkit__/modelFuzz.js` (the oracle takes the live
repair's two rules after undo/redo; `heldDragOp`), `move.hold.probe.js` (new), `select.stands.probe.js` (seed 43 pinned),
`model.equivalence.probe.js` (seed 126 pinned), DESIGN §8 (one clause), A1 §15 (one bullet), TEST-MAP (C2 rows).
**Measured (jsdom; load 1.9–4.7):** named suites 92/92; census during 0/0/0, left 14/5/4 (oracle 15/5/5); `select.stands`
12+[43] × 40 520 checks, 50 × 40 2,000 checks/432 selections; `model.equivalence` 20+6 × 40 1,040 checks, 200 × 40 8,000
checks/55,701 items/137 normalised ≤ 1.46e-8; `move.hold` 20 × 30: 42 drags, 291 events, 398 placement checks, all 8
exits, document byte-equal at every event. Break-checks (`r-drag/bc`): write in a step, `placed`/`placeNative` without δ,
every exit dropping — each red; the GC guard mid-drag not reached (0); members-first 3/17 red. D2b red on 8f9c073
(3/3), F136's walk red on d206cd3 (400 of 1,250 at seed 777), both green here. typecheck 0; eslint 0 on my files.
**Decisions made:** the harness (not the frozen oracle) applies DESIGN §10's repair to the oracle after undo/redo, and
cancels the oracle's drag before a deselect, tool change or delete mid-drag (d206cd3 kept its per-event writes there,
with no op; C2 writes nothing).
**Questions asked:** none new. Skipped per scope: Chromium (B-PYRAMID-4's batch unfinished), `setBatch` timing, items 5,
7, the normalised-rule break-check, RV4 and seed 777 traces, `ownIn` (same arithmetic, not identical: worker-side).
WHERE I AM: done; nothing of mine running.

## 2026-09-30 02:48 UTC — orchestrator (Fable) — R-DRAG landed (ce6f397); PLAN §5.21; B-MODEL-C34 launched
**Working on:** R-DRAG's report read and answered in PLAN §5.21 (the major fixed with leave accepted; F80 on the mixed
drop's undo and the remote removal to B-MODEL-C34; RV4 to the B-PYRAMID-3/4 reviewer; Kobin's two answers and his
three user-visible items recorded for the final summary; `ownIn` and the `setBatch` wrap to the final pass). §5.20
holds B-PYRAMID-4's place. B-MODEL-C34 (opus-builder, `briefs/B-MODEL-C34.md`, ports 3030–3039, scratch `bm34/`)
launched at ~02:52 with Kobin's constraint (one measurement pass, hand back at done-means).
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-4's report (its batch) and B-MODEL-C34's start entry.

## 2026-09-30 02:50 UTC — B-MODEL-C34 (builder) — C3 and C4 of the document model as one build — start
**Working on:** read the preamble (19 rules), `briefs/B-MODEL-C34.md`, PLAN §0/§1.7/§3/§5.2/§5.10/§5.12/§5.14/§5.16/
§5.19/§5.21, R-DRAG's end entry, DESIGN §2/§3/§7/§8/§10/§13, A1 §1.2/§1.3/§4.4/§4.6/§5/§6/§8/§9/§14/§15, OPEN-FLAGS
F94/F100/F107/F108/F124/F126; next the code the brief names. Tree at ce6f397 (+ `tools/harnesses/browser-check.js`,
not mine). Files I will be in (brief §4): `LevelMap.js`, `Document.js`, `placementModel.js`, `TileStore.js` (the
readers), `frameGc.js`, `selection.js`, `overlays.js`, `eraseDescent.js`, `erasePipeline.js` (`_cellOffset`,
`lm.merge`), `cede.js`, `legacy/modelV1.js`, `persist.js`/`format2.js`, `KobinEngine.js` (shared: re-read, small
edits), the model/move/select/erase suites and probes, `__testkit__/modelFuzz.js`, `__oracles__/README.md`, the docs.
Scratch `bm34/`, ports 3030–3039 (the frozen copies for §3's scenarios 3/4: 3040–3049 per the brief).
**Measured:** nothing yet; load 2.62. B-PYRAMID-4's browser batch is running (:3014/:3016): no batch of mine yet.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading the code — `LevelMap._take`/`_leave`/lookups, `Document`'s merge and detached paths.

## 2026-09-30 02:59 UTC — B-PYRAMID-4 (builder) — end: five rules in, F134/F135 fixed, the after batch, F137 filed
**Working on:** done. The measured tree `bp4/bC` has 479e07c's `src` (the `supportsDragPlane` deletion and the three
pre-freeze fixes in; since then only R-DRAG's tests and testkit changed there). Docs: DESIGN §9, A3's dated notes (§1.4,
§3.3, §3.4, §3.6, §4.4, §9.1; never-both holds for each path of a joined group), OPEN-FLAGS F134/F135 fixed and F137
filed, `docs/ai/10-`, `30-`, `40-`. Harness: scenario 5's release polled `renderer._liveHeld`, gone since bcba05a, so
it timed the first poll (before 12 | 13 ms, after 364 | 394 behind a 341–374 ms settle pack); now `renderer.live.held`
(not yet run).
**Measured (headless, `--dense --scenario all`, before bA ×2 | after bC ×2, load 1.9–4.4):** 1 back in paper 0 | 0 →
88 | 765 ms (F137; the first after tree 743), blur 3.2 | 3.0 → 2.2 | 3.0 s; the 16 unread cells' tiles, 15 | 19, baked in
536 | 549 ms by the reads that covered them (29–36 ms a tile), `olderUnreadMs` 0 (fresh stand-ins). 4 drag olderPatch
1,040 | 937 → 567 | 575, worst task 2,068 | 1,851 → 1,177 | 1,158. 6 undo T 17.5 (ℓ −1 inline, its pack 50 ms) | 39.4 →
31.7 | 26.8, not inline, no coarse level fits and the search measures all (key task 178 | 368 → 303 | 272 ms), exact
260 | 819 → 874 | 319 ms. 7 olderOther 1,370 | 1,573 → 254 | 78 (not 0), olderPatch 899 | 721 → 2,476 | 1,499, bake
6.7 s | not done in 60 s → 7.6 | 5.5 s, both-composes 0 | 6 → 0 | 0. Records at most 20,974 (after scenario 1), 9,264
after 4 and 6. Round trip ×2 a tree: 3 holds, 3 handoffs, 0 both-composes, nothing held at "drawn", in both trees.
jsdom: break-checks 18/18 red on the final tree; typecheck 0; lint 0 errors (6 warnings, none mine); bundles unchanged.
**Decisions made:** worse numbers attributed, not re-measured (the orchestrator's bound): F137 filed unbisected; the
undo against the first before run is rule 2's price (ℓ −1 no longer fits 16 ms) plus the coarse search's measures.
**Questions asked:** in the report — the budgeted read at the crossing (recommend no), (f′)-pending as `olderPatchMs`,
the coarse search's bound, F137's bisect, scenario 7's residual `olderOtherMs`.
WHERE I AM: ended; the report sent.

## 2026-09-30 03:01 UTC — orchestrator (Fable) — B-PYRAMID-4 landed (fea473e); PLAN §5.20; R-PYRAMID-34 launching
**Working on:** B-PYRAMID-4's report read and answered in PLAN §5.20: F137 (scenario 1's back-in paper) is the reviewer's
first item with leave to fix by bisecting the rules; the undo's regression (the priced pack sends it to the workers)
answered by the search stop (Q3 yes) and a user's coarse-first budget of 48 ms, the reviewer builds and measures both;
Q1 no, Q2 yes with the residual olderOther to classify, Q4 leave; the doubling off the pen-up rule's account. The
R-PYRAMID-34 brief re-scoped to that order (~90 min). Launching the reviewer now (ports 3020–3029); B-MODEL-C34 runs
in the model files.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: launching R-PYRAMID-34; waiting for B-MODEL-C34's checkpoints.

## 2026-09-30 03:05 UTC — R-PYRAMID-34 (reviewer) — the review of B-PYRAMID-3/4, scoped (brief's Scope block) — start
**Working on:** in the brief's order: F137's bisect and fix (frozen copies of `bp4/bA` and `bp4/bC`, scenario 1 only,
ports 3020–3029), then the undo (the coarse search's stop; the 48 ms coarse-first budget for a user's action), then
items 3/10, 8, scenario 7's residual `olderOther`, scenario 5's release, RV4/C4, reads of 7/9/4; one `--dense
--scenario all` on the final tree at the end. Files I may edit: the raster sources of the brief's §3, their suites,
the harness, DESIGN §9/A3/OPEN-FLAGS renderer flags; nothing of B-MODEL-C34's. Browser batches announced here.
**Measured:** nothing yet (load 0.27 at 03:02).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: diffing bA against bC's raster sources to plan the F137 bisect copies.

## 2026-09-30 03:06 UTC — R-PYRAMID-34 (reviewer) — browser batch b1 start (F137's bisect)
**Working on:** headless batch `r-pyr34/b1.sh`: `--dense --scenario 1` ×2 on three frozen copies of `bp4/bC`
(:3020 control, :3021 `_aim`'s two clamps off, :3023 `noteCommit` a no-op), interleaved, each run only at load < 2.
**Measured:** load 4.02 1.41 1.79 at the start.
**Decisions made:** the aim clamp and the commit-task step first (the brief's order); the records only if neither.
**Questions asked:** none.
WHERE I AM: batch b1 running; reading the undo's coarse search meanwhile.

## 2026-09-30 03:16 UTC — R-PYRAMID-34 (reviewer) — checkpoint: b1 ended at 3 runs; browser batch b2 start
**Working on:** F137. b1 (scenario 1, one run a copy): back-in paper control 654 (load 1.96→3.02), `_aim`'s clamps
off 416 (1.99→2.69), the commit-task step off 232 (1.92→5.06, B-MODEL-C34's jest) — neither rule alone (before bA 0 | 0).
b2 now: :3024 `y1` = bA with bC's `rasterPack.js` (the records), :3025 `y2` = bC with bA's `rasterPack.js`, :3020
control, `--dense --scenario 1` ×2 interleaved, each at load < 2.
**Measured:** the undo's two rules built in `PicturePyramid.patchPlan` (the search stops at the first level with no
records; a user's coarse level within USER_COARSE_FRAMES × `patchUserMs` = 48 ms; a pen-up's group searches none):
`PicturePyramid.patch` 11/11, the 2 new tests red on HEAD's source (copy `r-pyr34/rb`). Harness: `ownOther` split by cause.
**Decisions made:** the coarse budget as 3 × `patchUserMs` (tests that zero `patchUserMs` keep their meaning).
**Questions asked:** none.
WHERE I AM: batch b2 running; then scenario 6's number in the final run.

## 2026-09-30 03:17 UTC — B-MODEL-C34 (builder) — checkpoint C3a: co-resident lookups and readers (merges still run)
**Working on:** C3a done. `LevelMap`: a cell's frames are one group (resident + co-residents via the existing
`shadowOf`/`_shadows` links); `residentOf`, `cellFrames`, `sameCell`, `_kidAt`; `findCellChild`/`cellChild` look
through the group's kids (`own` flag for a mover's kids); geometry walks cells (`_cellParent`: `_ancestors`,
`isAncestor`, `chainFrom`, `commonAncestor`, `_buildPath`, `pathFrameAt`), so co-residents are one cell to the bit
and a path between them is empty; `objShift` gives F0 = the home when F0 is the home's cell; `childrenOf`/`walk` by
container; `_leave` splits a leaving subtree out of shared groups; `forget` promotes. Readers: `Document.cellList`;
`nativesIn`, `placement`, `drawnLive`; `TileStore._bakeUp`'s parent, `_ringNatives`, `_downSources`/`_addObject`
(a cell's own natives never in its tiles), `_upVia`, the reroute's live test; the idle fits; the Stage's `_ownDiff`
and frame events; `_cellOffset` by cell. The erase debug overlay already reads every frame (`doc.levels()`).
Files: LevelMap, TileStore, Document, placementModel, Stage (2 lines), KobinEngine (1 line), erasePipeline.
**Measured (jsdom, load 2.1–5.1):** 36 model/move/select/lattice/tile/stage suites 397 passed, 3 failed — all three
`LevelMap.test` cases of the old shadow model (an emptied `_shadows` now null; a lookup finds a co-resident's kid;
`walk` no longer takes the root's co-residents), rewritten in C3b with the merge's deletion. `model.equivalence`
20+6 × 40: 1,040 checks, 8,249 items, 37 carried at 0 ulp, 16 normalised ≤ 1.46e-8 (27 s); `select.stands` 12+1 × 40:
520 checks, 148 selections, `inklessBoth` 0; `move.hold` green. typecheck 0; eslint 0 on the edited files.
**Decisions made:** keep `shadowOf`/`_shadows` as the co-residency links (the stored field name stays; docs say
co-resident); geometry canonical by resident (a path through two co-residents' different containers rounded).
**Questions asked:** none.
WHERE I AM: C3b — `_take` joins the target cell's group and links kids recursively; delete the merge path.

## 2026-09-30 03:25 UTC — R-PYRAMID-34 (reviewer) — checkpoint: F137 not the pack; browser batch b3 start
**Measured (scenario 1 back-in paper, headless, one run each unless noted):** y1 (bA + bC's `rasterPack.js`) 0 (load
1.88→2.19); y2 (bC + bA's `rasterPack.js`) 109 (1.85→2.12); control 193 (1.95→2.38). Every bA-based run 0 (4 runs),
every bC-based run 88–765 (8 runs): not the records, not the aim clamp alone, not the commit-task step alone. b2 stopped
after one round. Focused raster suites on the live tree (my patchPlan change): 180/181, the one red in `raster.move`
at load 10.2, green on three reruns (129/129 at load 6) — the known load-sensitive case, name to confirm.
**Working on:** b3: :3021 `x13` (the aim clamps and the commit-task step both off), :3023 `x4` (a rest group's
result counted only when packed at or after its G, bA's rule), :3020 control, ×2 interleaved, load < 2 each.
**Decisions made:** none new. **Questions asked:** none.
WHERE I AM: b3 running; then the fix for whichever rule it names, else F137 reported with the bisect so far.

## 2026-09-30 03:32 UTC — R-PYRAMID-34 (reviewer) — checkpoint: b3 done (one round); browser batch b4 start
**Measured (scenario 1 back-in paper, one run each):** x13 (the aim clamps and the commit-task step both off) 143 (load
1.99→3.00); x4 (bA's rest-group rule) 571 (1.98→2.83); control 102 (1.92→2.92). Still neither. Crossing carry removed
on a copy: LH-5, LH-6 red (2, as B-PYRAMID-3). Scenario 7's residual: `_older` now charges an uncovered stale own
plate (the patch step skips it until its tiles are read) to `olderUnreadMs`, as (f′) is; red-before 1 (plan test on
HEAD's source); the harness names it `ownUnread` and splits the rest of `ownOther` by cause.
**Working on:** b4: :3026 `x5` (the estimate's pack terms dropped), :3027 `x6` ((f′) drawn as bA did), ×2.
**Decisions made:** none new. **Questions asked:** none.
WHERE I AM: b4 running; then the final tree's `--dense --scenario all` (git archive HEAD + my files).

## 2026-09-30 05:53 UTC — orchestrator (Fable) — the session-limit stop of ~03:35 UTC; both agents resumed
**Working on:** the session limit stopped B-MODEL-C34 (last action: C3b — `_take` joining the cell's group, the merge
path going; the harness's `pictureAt` to model the engine's idle step, then the model suites) and R-PYRAMID-34 (last
action: F137's bisect, batch b4 — the estimate's pack terms dropped, (f′) drawn as before — then two single-rule
reversions on the copies). The container rebooted (uptime 0 at 05:52): every server and batch is gone, the scratchpad
and the live tree's edits survived; the tree snapshot-committed with this entry. Both resumed by message. Per Kobin's
bound: R-PYRAMID-34 stops bisecting after b4's two reversions if they name no rule — F137 reported with the table —
and finishes the remaining items and its one final run within ~45 minutes.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: waiting for the resumed entries; the monitor re-armed.

## 2026-09-30 05:53 UTC — R-PYRAMID-34 (reviewer) — resumed after the reboot (the 03:39 session-limit stop)
**Working on:** the orchestrator's bound: F137's bisect stops (b4 read, below); then scenario 6, items 3/10, 8, 7's
residual, 5, RV4/C4, one `--dense --scenario all` on the final tree, the end entry — ~45 min. Files: `PicturePyramid.js`,
its plan/patch tests, the harness.
**Measured (b4, completed before the stop, scenario 1 back-in paper):** x5 (the estimate's pack terms dropped) 571 (load
1.86→3.41), 66 (1.91→2.08); x6 ((f′) drawn as bA did) 0 (1.96→2.49), 138 (1.92→3.20). No single rule names it:
F137 reported with the table, not fixed. Load 0.39 at 05:53 (fresh boot).
**Decisions made:** bisect stopped per the orchestrator's bound. **Questions asked:** none.
WHERE I AM: starting the final tree's dev server (:3020) for scenario 6/7/5 and the round trip.

## 2026-09-30 05:53 UTC — B-MODEL-C34 (builder) — resumed after the session-limit stop and the reboot (C3b)
**Working on:** C3b, from the tree at 9fe45f8 (my edits all there). Done before the stop: `_take` joins the target
cell's group and links kids all the way down (`_joinGroups`/`_linkKids`, the empty childless resident yields),
`_addFrame` makes a frame added at a taken cell its co-resident (ensureId, merge, load), `isUnder`/`subtreeStart`/
`walk` by container, `adoptShadow`/`unadoptShadow`/`mergePending`/`_mergeShadows`/`unmerge`/`merge*Replay` and the
`mergeFrame`/`splitFrame` events and handlers deleted (old stores' merges replay and undo through
`legacy/modelV1.js`: `mergeLive`, `mergeReplay`, `unmergeReplay`, `unmerge` over `restoreFrame`/`reparent`), the
camera handed to the resident at a refile/addFrame, GC promotes, version 3 for co-residents/private frames
(`latticeNeedsV3`), `objShift(…, mint)`: reads never mint (`_rerouteGroups`' `miss`, a snapshot not ready), the
engine prepares the camera view at the action's end (`_prepareView`) and wanted views at idle.
**Measured:** nothing since the stop; load 0.44.
**Decisions made:** as above (the pure-read exception closes by `prepare`, not by a read).
**Questions asked:** none.
WHERE I AM: `lattice.coresident.test.js` (the lattice cases the deleted LevelMap describe held), then the suites.

## 2026-09-30 05:55 UTC — R-PYRAMID-34 (reviewer) — browser batch b5 start (the final tree)
**Working on:** `r-pyr34/b5.sh`: the final tree `r-pyr34/fin` (git archive 9fe45f8, my files in) on :3020,
`--dense --scenario all` once, then one round trip (the never-both log), each at load < 2.
**Measured:** load 1.63 0.91 0.37 at the start. **Decisions made:** none. **Questions asked:** none.
WHERE I AM: b5 running (~8 min); reading items 7/9/4 meanwhile, no jest until it ends.

## 2026-09-30 06:09 UTC — R-PYRAMID-34 (reviewer) — b5 done; browser batch b6 start (scenarios 1 and 4 again)
**Measured (b5, the final tree 9fe45f8, headless, load 1.46→3.65, a builder's jest beside it):** 1 out paper 2,583, back
in 1,104 (F137); 4 drag olderPatch 2,104, the drop's row 2,175 ms (`ovl.tail` 1,174, `eng.list` 676, `eng.view` 216;
its patch T 1,882 to the workers); 5 release 98 ms, exact 105; 6 undo T 74.1, ℓ −1 41.0 admitted (one level measured),
coarse pack 56.7 ms inline, commit polled 194, exact 432; 7 olderOther 62.5 (28 cell-composes `ownOther.notAsked`, none
unread), olderPatch 2,145, bake 5.9 s, both-composes 6; round trip 3 holds, 3 handoffs, 0 both-composes. Suites: 11
raster files 192/192; lint 0 on my files; typecheck 0.
**Working on:** b6: scenarios 1 and 4 once more (both disagree with B-PYRAMID-4's table and the review's).
**Decisions made:** none. **Questions asked:** none.
WHERE I AM: b6 running; then the end entry and the report.

## 2026-09-30 06:10 UTC — B-MODEL-C34 (builder) — checkpoint C3b: no merges
**Working on:** C3b done. A frame dropped on a taken cell stays a co-resident (its kids join the cells' groups all the
way down; an empty childless resident yields); `isUnder`, `walk`, `subtreeStart`, `childrenOf` by container; the
merge path, the `mergeFrame`/`splitFrame` events and their four handlers, the selection's merge hand-over and F126's
follow deleted (legacy stores' merges replay and undo through `legacy/modelV1.js`); the camera handed to the resident at
a refile/addFrame; GC promotes; version 3 covers co-residents and private frames. Row 8's exception closed: reads call
`objShift(…, false)`; the engine mints the camera view's sources at the action's end (`_prepareView`, the render after
a placement/address/camera change); a snapshot of another view whose source is missing is not ready (`want`) and the
engine mints it at idle. Tests: `lattice.coresident.test.js` (new, 7), `move.camMerge` deleted (ported), `move.twin`,
`move.subtree` t8/t10, `select.inkless` I4, `oplog`'s merge case, `move.drop`, `LevelMap` t2 rewritten; the fuzz got
`c34` ops (dropOnto, deleteUndo, eraseDeep, lassoTorn) and `unitSelect`/`settleOracle` (the harness, not the oracle).
**Measured (jsdom, load 2.1–3.9):** 67 suites 690 passed, 0 failed. `model.equivalence` 20+6 plain: 1,040 checks, 8,249
items, as at C3a; 1+20 c34: 840 checks, 5,146 items, a co-resident with ink at 12 checks, bit-equal by place; one carried
native 2 ulp above its home (seed 20, no co-resident: two roundings) — the c34 runs allow 2. `select.stands` 1+12 c34 green.
`model.pureRead` (c34 on even seeds): 180 states, 2,048 reads, 0 frames minted, 58 snapshots not ready.
**Decisions made:** the harness selects a frame by id as the oracle's merged unit (the cell's frames), so the op streams
stay one; the oracle's pending merges are read before a comparison (its read order drew a shadow's natives twice).
**Questions asked:** none.
WHERE I AM: C3c — `removeFrameSubtree` takes the subtree out of the lattice; `insertFrameSubtree` restores it.

## 2026-09-30 06:14 UTC — R-PYRAMID-34 (reviewer) — end (scoped review; F137 bisected, not attributed)
**Working on:** done; b6 ended 06:14, dev servers stopped. Files: `PicturePyramid.js` (the undo's search stop and 48 ms
user coarse budget, a group searches none, `_older`'s unread), its patch/plan tests (+3, red-before 2 + 1 on HEAD's
source), the harness (`ownUnread`, `ownOther.*`), DESIGN §9, A3's dated note, OPEN-FLAGS F137 (the bisect table).
**Measured (b6, the final tree again, load 1.96→2.36):** 1 out 2,157, back 1,257 ms paper — no patch, no older draw
(my changes idle); `eng.list` rows 995–1,175 ms (bC 492–781): the model files changed since bC. 4 drag olderPatch 1,712;
the drop's row 2,179 ms = `ovl.tail` 1,156 + `eng.list` 674 + `eng.view` 176, its patch (T 1,372) to the workers.
**Decisions made:** F137 not fixed (bound); `unask`'s overwrite and the hidden-tab commit step reported, not fixed.
**Questions asked:** in the report.
WHERE I AM: ended; the report sent.

## 2026-09-30 06:16 UTC — orchestrator (Fable) — R-PYRAMID-34 landed (1b95eb2); PLAN §5.22; Kobin's stop after C3/C4
**Working on:** R-PYRAMID-34's report answered in PLAN §5.22 (the undo rules accepted; F137 open with its bisect table;
the final tree's `eng.list` doubling sent to B-MODEL-C34 to fix inside its build; the exact-when-it-fits threshold,
the `unask` G check, the hidden-tab step, RV4/C4 and the overlay's tail after a drop recorded as next steps). Kobin's
instruction (06:00): when C3 and C4 land, wrap up the issues being resolved and stop — no reviewer for C34, the final
design check deferred. Waiting for B-MODEL-C34's report.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: waiting for B-MODEL-C34 (C3c, C4, tests and docs, its report).

## 2026-10-04 02:30 UTC — orchestrator (Opus) — B-MODEL-C34 landed after the builder's weekly-limit stop; PLAN §5.23
**Working on:** Kobin (2026-10-04): "some additional work was done by another agent after you hit your limit, can you
review it and continue? It may be on another branch". It was on no branch: B-MODEL-C34's last edits (06:54–07:21 UTC on
2026-09-30: C3c/C4's docs, `select.remote`, the version-3 tests, timing probes, the city test being rewritten) were
uncommitted in the container, snapshot b750633; the remote held nothing newer than 3662169. Reviewed and landed without a
reviewer (Kobin's stop): PLAN §5.23 lists the repairs (21 cede tests reading one frame ported to the cell; the city lasso
sized to the reach boxes; `raster.pyramid`'s F119 race stubbed), the break-checks (all nine red, three after a test was
added), the bundle, the docs.
**Measured:** the quick suite 2,186 passed, 0 failed; `test:erase` 303 passed, 1 skipped; typecheck 0; lint 0 errors;
the city lasso 16 frames, 0 ids (oracle 48 ids); headless Chromium scenarios 1/3/4 and the round trip no worse than the
tree before C3/C4 (load 1.7–3.1). The tile fuzz at 200 + 200 seeds: 11 walks differ from the oracle (3 new with
C3c/C4), the selection fuzz at 50 + 50 one (C3b's): OPEN-FLAGS F138, open. Nothing in Kobin's Chrome.
**Decisions made:** a trial fix for seed 131 (retire a private frame's id at GC) changed nothing and was reverted;
F138 is reported, not fixed (Kobin's stop).
**Questions asked:** none.
WHERE I AM: the closing entry next; then stop.

## 2026-10-04 02:31 UTC — orchestrator (Opus) — the rebuild's build phase closed (Kobin's stop after C3/C4)
**Working on:** done; no agent running, no server or job of mine running. Landed in this phase: B-DRAG (C2) and its
review, B-PYRAMID-3 and B-PYRAMID-4 and their review, B-MODEL-C34 (C3, C4) without a review (PLAN §5.19–§5.23).
**Open, for the next session:** OPEN-FLAGS F138 (the 200-seed model fuzz: 11 walks differ from the oracle, 3 new with
C3c/C4; the selection fuzz one of C3b's age) — the model pass to run first; F137 (scenario 1's zoom-back paper,
bisected by rule without a culprit; the landed tree showed 0 ms in one run); PLAN §5.22's recorded next steps (exact
over coarse when both fit 48 ms, the `unask` G check, the hidden tab's commit step, RV4/C4, the overlay's tail after a
drop). Deferred by Kobin: a reviewer for C3/C4 and the final full-design check (the harness on every scenario, the
docmaps, the review-document rows H1/H4/D1/D-3/D272/H6, `docs/ai/10-STATUS.txt`). Nothing of this phase has been
checked in Kobin's Chrome: his list is in PLAN §5.19 items 1–3, §5.21 items 3–4 and §5.23 item 8.
**Measured:** as the entry above.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: stopped.

## 2026-10-04 02:48 UTC — orchestrator (Opus) — Kobin: the reviews and fixes; R-MODEL-C34 and B-PYRAMID-5 launching
**Working on:** Kobin's "go ahead onto the reviews and fixes" (PLAN §5.24): R-MODEL-C34 (F138's fixes, then a short C3/C4
review; ports 3030–3039, scratch `r-c34/`) and B-PYRAMID-5 (PLAN §5.22's next steps, F137, the overlay's tail; ports
3010–3019, scratch `bp5/`) launching side by side; files disjoint (model against raster); `KobinEngine.js` shared.
Browser batches announced here, each started under load 2. Then the final design check.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: launching both; the monitor re-armed.

## 2026-10-04 02:49 UTC — R-MODEL-C34 (reviewer, opus) — start: F138's fixes, then a short C3/C4 review
**Working on:** brief `briefs/R-MODEL-C34.md`. Item 1 first: reproduce each F138 seed alone (131; C3/C4 47, 198; then
29, 49, 51, 70, 87, 140, 193, 194; then select seed 34), classify (a) model defect / (b) comparison gap / (c) shared
fault, fix with a red-before test. Files I am in: the model files the brief names (`LevelMap.js`, `Document.js`,
`oplog.js`, `__testkit__/modelFuzz.js`, the model suites); `KobinEngine.js` only by small re-read edits. Scratch
`r-c34/`. Hand back by ~05:50 UTC.
**Measured:** nothing yet (load 0.07).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: reading the design and reproducing seed 131 alone.

## 2026-10-04 02:50 UTC — B-PYRAMID-5 (builder) — start (PLAN §5.22's next steps, F137, the overlay's tail)
**Working on:** the brief's six items in order: exact over coarse when both fit 48 ms; `unask`'s G check; the hidden
tab's commit step; RV4 and `stage.cover` C4 deterministic; F137 real or not (three runs a tree, landed against bA,
before any bisect); the overlay's tail after a drop measured and proposed. Files: `src/engine/raster/*` (PicturePyramid,
RasterRenderer, jobQueue), the raster suites, `stage.cover.test.js`, the harness, DESIGN §9, A3, OPEN-FLAGS F137.
`KobinEngine.js` only if needed (re-read first); `Stage.js` read only. Scratch `bp5/`, ports 3010–3019. Hand back by
~04:50 UTC. Browser batches announced here, started under load 2.
**Measured:** nothing yet (load 0.24).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: reading the code (`patchPlan`, `_coarseJob`, `unask`, `_pyrCommitStep`, `_aim`).

## 2026-10-04 02:51 UTC — orchestrator (Opus) — Kobin: the limit has reset; both agents to full scope
**Working on:** Kobin's "no need to be short/high value anymore" relayed to both agents (PLAN §5.24's addendum):
R-MODEL-C34 — every F138 difference root-caused and fixed, the fuzzes run larger, the C3/C4 review in full, R-DRAG's
skipped items; B-PYRAMID-5 — the overlay's tail after a drop fixed (`overlays.js` its), R-PYRAMID-34's skipped items,
the full measurement. Time boxes dropped.
**Measured:** nothing.
**Decisions made:** `overlays.js` to B-PYRAMID-5 (R-MODEL-C34 is not in it); `selection.js` and the drag paths stay R-MODEL-C34's.
**Questions asked:** none.
WHERE I AM: waiting for both; the final design check after.

## 2026-10-04 06:46 UTC — orchestrator (Opus) — the session-limit stop; both agents resumed
**Working on:** the session limit stopped R-MODEL-C34 (last action: break-checking a fix in the store's subtree path —
"K1 turns the new cede test red, and four F98 tests; the delete-undo-drag test stays green under K1, so next the
saver's snapshot rules") and B-PYRAMID-5 (last action: item 2, the `unask` G check, its red-before test red at
olderOther 50 ms). Neither had written a checkpoint entry. The container rebooted (uptime 0 at 06:46): every server and
job is gone; the scratchpad and the live tree's edits survived, snapshot-committed with this entry. Both resumed by message.
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the resumed entries; the monitor re-armed.

## 2026-10-04 06:47 UTC — B-PYRAMID-5 (builder) — resumed after the session-limit stop and the reboot (full scope)
**Working on:** the six items (item 6 now a fix, `overlays.js` mine), then R-PYRAMID-34's skipped items, then the full
measurement; no time box. Files: `PicturePyramid.js`, its patch test, `raster.commit`/`raster.pyramid` tests (aa97e25).
**Item 1 (exact over coarse within 48 ms):** built. `patchPlan`'s budget for a user's action (undo, redo, drop) is
USER_COARSE_FRAMES × `patchUserMs` = 48 ms for either path; a pen-up's group keeps `patchUserMs` 16 and searches no
level; the bake keeps 6. Red-before (the patch test's user-budget case: coarse taken at T 27.5); green after; the two
tests that pinned budget 16 for an undo now pin 48. Break-check and scenario 6 pending.
**Item 2 (the `unask` G check):** a job carries the G it was asked at (`_ask`, one helper for the three ask sites);
`unask(cells, G)` keeps a newer ask. Red-before test: its drop case red on HEAD (olderOther 50 ms), green with it; its
landing case still red — `_take` forgets a newer ask the same way (an older job's result landing). Fixing `_take` by
the same rule next (obvious and local; reported).
**Measured:** jsdom only so far (above). Load 0.04.
**Decisions made:** the pen-up group's inline budget stays one frame (the brief names undo, redo, a drop).
**Questions asked:** none.
WHERE I AM: `_take` keeps an ask newer than the landing's G; then items 1–2's break-checks, then item 3.

## 2026-10-04 06:48 UTC — R-MODEL-C34 (reviewer) — resumed after the session-limit stop and the reboot (full scope)
**Working on:** F138, every seed root-caused and fixed (no time box), then the larger fuzz runs, the full C3/C4 review,
R-DRAG's skipped items. Files: `__testkit__/modelFuzz.js`, `hooks/store.subtree.test.js`; scratch `zz_*` probes in `src/`
(deleted before hand-back). Next model files as seed 198 needs (`LevelMap.js`, `Document.js`, `selection.js`).
**F138 so far:** 131 (plain) and 47 (C3/C4) are one class, (c): the fuzz's store took ONE snapshot at its first reload2
and replayed every later entry with no listed set and no forced snapshots, so a frame the snapshot lacked (emptied by an
undo) replayed its whole history and both engines brought the undone native back (131: an undone cede into a private
frame whose id GC freed and a later cede took; 47: an undone subtree delete's add). The app's saver does not: it lists
frames (F98), snapshots forced and newly listed frames each write. Fixed in `modelFuzz.js` (`syncStore`: a write after
every step, the saver's rules); 131 and 47 pass alone. The app path pinned by two hook tests in `store.subtree`
(an undone cede whose private ids GC freed and a later cede took; a delete undone, then dragged): green.
**Break-checks on my copy `r-c34/bc`:** K1 (the loader replays without `frameIds`) 5 red of 8 (the cede test and 4 F98
tests); K3 (a newly listed frame not snapshotted) 2 red; K2 (no forced snapshot) 0 red, K2+K3 2 red (the delete test).
**198 (C3/C4), in progress:** a model defect candidate: after a subtree drag of a cell whose resident is empty and
whose private co-resident holds ink, a delete and its undo put the frames back at the shift of an EARLIER drag
([11840,-5120], step 13) instead of the latest ([-768,-6144], step 14); native 7 drawn at the old offset.
**Questions asked:** none.
WHERE I AM: tracing seed 198's step 17 (the delete's records' `at.shift` vs the undo's restore).

## 2026-10-04 07:18 UTC — R-MODEL-C34 (reviewer) — checkpoint: all twelve F138 differences root-caused, each alone green
**Working on:** the 200+200 tile fuzz running (load 3.3); then 50+50 selection, the larger runs, the review. Files:
`Document.js` (`removeFrameSubtree`), `selection.js` (`_dropMove`), `__testkit__/modelFuzz.js`, `select.stands.probe.js`,
`model.equivalence.probe.js`, tests `TileStore`, `move.drop`, `hooks/store.subtree`; scratch `zz_*` probes in `src/`.
**Measured (jsdom, each seed alone, all green now):** (a) live defects, 2: seed 51 — a subtree delete emits `removeFrame`
after the whole subtree left the lattice, so a kid's event names a parent that is gone, `mapRectF` null, no tile dropped:
a deleted native stayed in an ancestor's down tile (fix: each event carries the root's address; `TileStore` test red→green);
seed 70 — the drop listed its members after the frames' re-address, so a listed id whose frame was carried out of the
selected root moved twice (fix: members listed at the press; `move.drop` D2c red by 12.8 → green). (b) comparison gaps,
7: 198 (an oracle id names another place live: frame ops pick by place), 87 (units at a place hold different natives:
skipped, counted `unitApart`; a carried native read through a rerouted frame: painted within 1e-6, `rerouted`, max
9.3e-10), 29 (the live camera is handed to the resident, the oracle's rides an undone drop: `camSynced`), 140 and 194 (the
oracle's merge hands a dropped frame's selection to ids: deselect after `dropOnto`), select 34 (an id the oracle's drop
carried stands for itself). (c) 131, 47, 49: the fuzz's one-snapshot store; the app's saver (F98's listing, per-write
snapshots) does not resurrect — `syncStore`; hook test green, break-check K1 red. (d) an oracle-only fault, 193: the
oracle places a native a cell off at its home (two half cells summing to −W); counted `oracleSlip`.
**Decisions made:** each exception counted in the probe's line, with a one-line note naming the difference.
**Questions asked:** none.
WHERE I AM: reading the 200+200 tile fuzz result (`r-c34/fuzz200a.log`); next the 50+50 selection fuzz.

## 2026-10-04 07:33 UTC — B-PYRAMID-5 (builder) — checkpoint: items 1–4 built, break-checked
**Working on:** items 1–4 done in jsdom; item 5 (F137) next. Files: `PicturePyramid.js`, `RasterRenderer.js`,
`PyramidStore.js`, their tests (`PicturePyramid.patch`, `raster.commit`, `raster.pyramid`, `raster.move`),
`stage.cover.test.js`, DESIGN §9, A3 §3.3/§3.4/§4.4 notes, TEST-MAP (a new section).
**Measured (jsdom):** 1: an act's budget 48 ms for either path (red before: coarse at T 27.5). 2: one `_ask` helper
stamps `askG`; `unask` and `_take` keep a newer ask (red before: `olderOtherMs` 50 ms; the engine cases needed a
spent pack budget — an at-once dispatch is in flight exact and hides the erased ask). 3: hidden → the commit step
returns; the store's `onShow(released)` now fires at every return and runs the due step. 4: RV4 red 2 runs in 7 beside
8 busy loops (no plate at the drop: a loaded rest render > 8 ms marked the next heavy → pool after `flush`), 0 in 8
after (`restInlineMs`/`patchUserMs` 1e9 before the scene); 3×3 loops green; RV4's mid-drag check read the moved place,
which C2's hold never paints — added the home check (red without `omit`). C4 never red here (3/3 at 3, 8, 14 loops);
read unbudgeted, waits in turns. Break-checks (`bp5/bc`): 1 → 1 red; 2a–2g → 1,1,1,1,2,1,1; 3a/3b → 1,1; RV4's omit
→ 1 (was 0); C4's far read → 1. Raster suites + `stage.cover` + `move.drop`: 606/606 (37 files). typecheck 0; eslint 0
on my files. Loads 1.7–9 (busy loops mine, killed by pid).
**Decisions made:** `_take` takes the same G rule as `unask` (the landing case was red too; local); a pen-up's group
keeps 16 ms; RV4's home check added (its guard was unreached).
**Questions asked:** none.
WHERE I AM: item 5 — announce the batch, copies `landed` (git archive HEAD) and bA on ports 3010/3011, 3 × scenario 1 each.

## 2026-10-04 07:40 UTC — B-PYRAMID-5 (builder) — browser batch b1 START (item 5, F137 real or not)
**Working on:** headless Chromium, `--dense --scenario 1` × 3 on the landed tree (59f0a76, `git archive`, :3010) and × 3 on
B-PYRAMID-4's before copy bA (:3011), interleaved, one frozen harness (`bp5/h`); each run starts under load 2 (waits
up to 30 min). Dev servers Node 14, pids in `bp5/dev-301x.pid`. Script `bp5/batch1.sh`, log `bp5/batch1.log`.
**Measured:** load at start 2.9 (another agent's jest).
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for b1; meanwhile reading the overlay's tail (item 6) in `overlays.js`.

## 2026-10-04 15:38 UTC — orchestrator (Opus) — the second session-limit stop (~07:45); both agents resumed
**Working on:** the limit stopped R-MODEL-C34 (the selection fuzz at 50 + 50 green; next the camera exception's
break-check over 100 + 100 seeds) and B-PYRAMID-5 (F137's batch b1 announced, never run). The container rebooted (uptime
0 at 15:37); the tree was clean at ce474fc, every edit of both in it. Both resumed by message with their full scope.
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the resumed entries; the monitor re-armed.

## 2026-10-04 15:39 UTC — R-MODEL-C34 (reviewer) — resumed after the second stop and reboot (tree at ce474fc)
**Working on:** the exception break-checks (orchestrator 07:19), then 200+200 / 500+500 tile and 50+50 / 200+200
selection runs, the full C3/C4 review, R-DRAG's skipped items. Files as at the 07:18 checkpoint, plus
`model.fuzzRules.test.js` (new) and `select.stands.probe.js` (uses `modelFuzz.selectionInk`/`carriedAlike`).
**Measured before the stop (jsdom, load 1.9–3.4):** tile fuzz 200+200 green (16,000 checks, 110,356 items; camSynced 1,
unitApart 5, dropDeselect 38, rerouted 6 max 9.3e-10, oracleSlip 3) — on the harness before the last two narrowings, so it
reruns. Selection fuzz 50+50 green (4,000 checks, 800 selections, held 5).
**Exception break-checks on my copy `r-c34/bc` (env-gated injections):** rerouted — a 1e-3 or a W offset at a rerouted
read: seed 87 red. oracleSlip — a live −W slip beside its home: 193 red (and green before the live-pieces check: the rule
was wider than its reason, narrowed). dropDeselect — the drop's selections must stand for one ink: a dropped first frame
throws on 140, 194. held (select 34) — 34 red with a frame lost from the live selection. carriedAlike — a home a cell off
made up by its own table: `model.fuzzRules` red (bound added). Not yet biting: the camera rule (a held-back live camera
never fired over 100+100) and unitApart (a lost re-home never fired on 87): need injections that fire.
**Questions asked:** none.
WHERE I AM: a camera injection that fires (the live camera in a frame an undo moves), then unitApart's.

## 2026-10-04 15:40 UTC — B-PYRAMID-5 (builder) — resumed after the second stop and reboot; batch b1 had run (END)
**Working on:** item 5's result, then item 6 (the overlay's tail, a fix in `overlays.js`), R-PYRAMID-34's skipped
items, the full measurement. Tree at ce474fc (items 1–4 as checkpointed).
**b1 did run before the stop** (its log `bp5/batch1.log`, 07:36–07:45 by the container's clock; six runs, exit 0, each
started under load 2: 1.74–1.98 → 1.74–2.83 at the end; dev servers compiled clean; nothing re-run). Headless
Chromium, `--dense --scenario 1`, one frozen harness (HEAD's), interleaved. **Back-in `paperMs`:** landed 59f0a76
0 | 225.5 | 0.3; bA (B-PYRAMID-4's before copy) 451.9 | 141.6 | 178.2. Out: landed 26.1 | 587.9 | 3.3, bA 98.9 | 25.0 |
435.8. Unread cells on the way back 64–88 (landed), 48–80 (bA); older 0 in all.
**Decisions made:** F137's premise (paper after B-PYRAMID-4, none before) does not hold: the before copy shows the
back-in paper in 3 runs of 3. Not bisecting between two trees that both show it; tracing the paper's cells on the
landed tree instead (where it comes from, which rule), then the flag rewritten with the six numbers.
**Questions asked:** none yet (the flag's new reading goes in the report).
WHERE I AM: reading the back-in row of `h-landed-s1-2.log` for where the paper is; then item 6.

## 2026-10-04 15:50 UTC — B-PYRAMID-5 (builder) — browser batch b2 START (F137: where the back-in paper comes from)
**Working on:** headless Chromium, a traced copy of HEAD (`bp5/tr`: a log of every paper cell's sources at `_planCell`'s
(g) — own, mapped, kids, coverage, asks, the coarser chain) on :3012 with a traced harness (`bp5/ht`), `--dense
--scenario 1` up to 4 times, stopping at the first back-in paper over 50 ms; each run under load 2. Log `bp5/batch2.log`.
**Measured:** load at start 0.4.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: b2 running; reading item 6 (the overlay's tail) meanwhile.

## 2026-10-04 15:49 UTC — B-PYRAMID-5 (builder) — browser batch b2 continued (runs 5–7: the store's puts and evictions of the crossing's stand-ins)
**Working on:** F137's paper traced in run 2 (234.5 ms: frame 2 at ℓ −4..−2 after the crossing, no record at any searched level, the store at its 90-plate cap); runs 5–7 log the stand-ins' puts and evictions. Same copy (:3012), each run under load 2.
WHERE I AM: b2 runs 5–7; then the flag, then item 6.

## 2026-10-04 16:00 UTC — B-PYRAMID-5 (builder) — b2 END; browser batch b3 START (item 6: the drop's profile)
**Measured (b2):** traced HEAD copy, scenario 1 back-in paper 0 | 234.5 | 0.7 | 244 ms (runs 1, 2, 5, 6; load at start 1.31–1.92, at the end 2.9–6.6: the other agent's jest). The paper: step (d) never took a coarser cell's twin in the frame left (OPEN-FLAGS F137 rewritten); fixed in the plan, red-before tests and break-checks 2 and 1.
**Working on:** b3 — a CDP sampling profile (100 µs) of scenario 4's drop on a clean copy of HEAD (`bp5/cur`, :3013), one run under load 2.
WHERE I AM: b3; then the overlay fix.

## 2026-10-04 21:45 UTC — orchestrator (Opus) — the third session-limit stop (~16:05); both agents resumed
**Working on:** the limit stopped R-MODEL-C34 (the exception break-checks; a `normalised` break-check and fuzz runs in
flight) and B-PYRAMID-5 (F137 fixed in the compose plan with two tests; batch b3, the drop's profile, unfinished). The
container rebooted (uptime 0 at 21:44); the tree was clean at 3e215f0 with every edit of both. Both resumed by message;
B-PYRAMID-5 asked to confirm its two F137 tests fail on the old `PicturePyramid.js`.
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the resumed entries.

## 2026-10-04 21:46 UTC — R-MODEL-C34 (reviewer) — resumed after the third stop and reboot (tree at 3e215f0)
**Working on:** the two differences the larger runs found (below), then the review's measurements (bake profile, census,
city lasso, R-DRAG's timings, Chromium scenarios 3/4), docs, the suites. Files as before plus `LevelMap.js`,
`lattice.coresident.test.js`, `model.fuzzRules.test.js`, DESIGN §8/§13, docs/ai 30/40.
**Fixed since 07:45 (each red before, one test each; break-check on my copy: exactly that test red):** (a) the fuzz's
new lattice-invariant check found a private frame made a cell's resident beside a public one (`_joinGroups`: an empty
childless public frame yielded to a private mover — mid-`readdressMany` every mover has left; seeds 198, 87, 29) →
`lattice.coresident` "a private frame never keeps a cell from a public one"; (b) seed 174, hidden until places stopped
depending on root growth: a load added a parentless "0" when a subtree delete had taken "0" (`_loadFrames`), a camera
named "0" landed in it, and an undo would restore the subtree under it → "a lattice whose frame 0 was deleted loads
without a parentless 0". Harness: the cameras asserted at one place after every op (a camera apart was unseen: frames
the oracle lacks at its place were left out silently); places name the top frame by depth, grown roots dropped.
**Exception break-checks, red:** rerouted (1e-3, W), oracleSlip (live −W slip; was green before its pieces check),
dropDeselect (140, 194), held (select 34), carriedAlike (own-table bound, `model.fuzzRules`), unitApart (a mis-homed
member: 21 fires, red at seed 8; the earlier wide guard skipped it 3 times), the camera premise (a camera moved a cell at
an undo: red at seed 29 step 7), normalised (a 1e-3 placement offset: red at seeds 2, 16).
**Runs:** tile 200+200 green (16,000 checks; camSynced 1, unitApart 5, dropDeselect 38, rerouted 6 max 9.3e-10,
oracleSlip 3, normalised 276); selection 50+50 green (held 5). Tile 500+500: plain seed 416 step 13 (undo) cameras apart;
selection 200+200: C3/C4 seed 73 step 21 (subtreeDrag) oracle [5,7,8] live [8]. Both being traced.
**Questions asked:** none.
WHERE I AM: tracing tile seed 416 step 13 (plain lane), then selection seed 73.

## 2026-10-04 21:47 UTC — B-PYRAMID-5 (builder) — resumed after the third stop and reboot; b3 END (interrupted, to re-run)
**Working on:** item 6 (the drop's profile, then the overlay fix in `overlays.js`), R-PYRAMID-34's skipped items, the
full measurement. Tree at 3e215f0.
**F137's tests, confirmed:** on an unimported copy of 3e215f0 with `PicturePyramid.js` from 26e3e69 (before the fix) the
plan suite is 3 red of 27 — both F137 tests (the cell past the crossing: 6 cells paper; the budget's coarsest reserve)
and the random mixes (their oracle now has a coarser level's root twin); on the tree, 27 of 27. The first F137 test was
also red on the live file before the edit (6 paper); the second was written after it and is red with the reserve's twin
removed (break-check 5b: 1 red; 5a, the twin removed everywhere: 2 red before the second test existed).
**b3 (the drop's profile) END: interrupted** by the stop (the dev server was up, no run made); re-run now.
**Measured:** as above (jsdom). Load 0.3.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: b3 again — `bp5/cur` on :3013, one profiled scenario-4 drop under load 2.

## 2026-10-05 04:05 UTC — orchestrator (Opus) — the fourth session-limit stop (~22:00); both agents resumed
**Working on:** the limit stopped R-MODEL-C34 (tile seed 416 traced to a live camera that rode the mover — the harness's
camera rule widened, a test added; selection seed 73 being traced; larger fuzz runs in flight) and B-PYRAMID-5 (item 6:
the selection decision kept across a drop, moved by the displacement the drop wrote; "the two-line fix" pending). The
container rebooted (uptime 0 at 03:59); the tree held every edit of both, snapshot fba12b4 (pushed). Scratch dirs `r-c34/`
and `bp5/` survived; no dev servers or Chromium were left running. Both resumed by message with their remaining scope.
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the resumed entries; the monitor re-armed.

## 2026-10-05 04:02 UTC — B-PYRAMID-5 (builder) — resumed after the fourth stop and reboot (tree at fba12b4)
**Working on:** item 6's browser re-measure, then R-PYRAMID-34's skipped items, the full measurement, the report.
**On disk, checked:** both crawl-row lines are in (`rasterPerf.noteCrawl` charges no decision; a frozen tick zeroes its
paint), the kept decision in `overlays.js` (`_selDragStart`, `_selMembersAt`, `_selMovedBy`), DESIGN's indicator line.
**Item 6 so far (jsdom, before the stop):** b3's profile of the dense drop (clean HEAD copy, load 1.47→3.54): `syncWorld`
579.5 ms = `_selDecide` 548 (+ its GC); the drop's row 1,694 ms = `ovl.tail` 803 + `eng.list` 538 + `eng.pack` 170; three
"crawl" rows of 903–924 ms were each the last decision (778) and paint carried into a frozen tick — a reporting
artifact, fixed (red before: 778 in every row). The fix: a drop or a cancel keeps the drag's decision, moved by the
displacement every member was drawn away from its place at the drag's start (checked member by member, to 0.01 px; the
view inside the kept window), else decides afresh. Red before on an unimported copy with HEAD's `overlays.js`: 2 of 57
(the drop/cancel test, the member test); green 58/58. Break-checks: kept decision off 2 red, the member check 1, the
window 1, the shift out of the transform 1, the crawl decide 1, the frozen paint 1. `selection.indicator` pinned the
old re-decision ("decided afresh … when it ends"): rewritten to the new rule (same key, +60 px, a fresh decision draws
the ants at the same place to 0.005 px).
**Measured:** as above. Load now 0.22.
**Decisions made:** `OverlayLayer.js` and `rasterPerf.js` (not in my brief's list, no other agent in them) fixed for the
crawl rows: the artifact made every selection's drop look like 1–3 phantom 0.9 s tasks in the harness.
**Questions asked:** none.
WHERE I AM: b4 — scenario 4 in headless Chromium on a frozen copy of the tree against the landed one, under load 2.

## 2026-10-05 04:02 UTC — R-MODEL-C34 (reviewer) — resumed after the fourth stop and reboot (tree at fba12b4)
**Established before the stop:** tile seed 416 (plain, step 13 undo): the reverse of seed 29 — the live camera rode the
mover that took an empty cell (A1 C3: a frame keeps its identity, the camera stays in its frame), the oracle's stayed in
the frame it merged into; class (b). The camera rule made symmetric (`rode`); `lattice.coresident` "a camera inside a
dropped frame's subtree rides its undo and redo" pins the live behaviour: green, red on my copy with the live camera held
at its old place (BK_CAM3: 1 test red; the fuzz itself stays green there — the oracle agrees). Selection seed 73
(C3/C4, step 21): the subtree drag landed on a held cell, the oracle merged and handed its selection to the natives (with
families), the live frame stays a co-resident unit; class (b), `mergedAlike`; with a frame dropped from the live repair
(BK_SEL) 73 is red at step 17.
**Runs before the stop:** tile 500+500 on that harness: 9 walks differ (plain 296, 386: a carried native 2 ulp above its
home, the plain lane allows 1; C3/C4 213, 222, 231, 241, 341, 451, 476) — 39,813 checks, 274,605 items. Selection
200+200 on the final harness: green.
**Re-running / next:** each of the nine alone, classified; the live-rode branch's own break-check; `mergedAlike`'s
break-check and a pinning test; then the 500+500 and 200+200 again; the review's measurements; R-DRAG's items.
**Questions asked:** none.
WHERE I AM: tracing C3/C4 seed 213 (step 29, tapDrag: oracle 3 items, live 0).

## 2026-10-05 04:04 UTC — B-PYRAMID-5 (builder) — browser batch b4 START (item 6: the drop's frame, before against after)
**Working on:** headless Chromium, `--dense --scenario 4` ×2 on `cur` (26e3e69, :3013) and ×2 on `fin1` (fba12b4, :3014), interleaved, one frozen harness; then one profiled drop on `fin1`. Each run under load 2. Log `bp5/batch4.log`.
WHERE I AM: b4 running; R-PYRAMID-34's items meanwhile (jsdom, light).

## 2026-10-05 04:07 UTC — B-DOCMAPS (builder) — START: the Code Map, Call Graph and Call Map made true for the rebuilt tree
**Working on:** brief `review/rebuild/briefs/B-DOCMAPS.md`, items 1–8 in order. Files: `tools/docmaps/` only (scripts,
`data/`, `pages/`); no `src/`, no `docs/`, no `review/rebuild/*` but this log. Scratch `<scratchpad>/dmap/` (a
`git archive 56e36b3` copy for the body diffs); ports 3050–3059 for item 8.
**Measured:** nothing yet; tree at fba12b4 + the orchestrator's brief/PLAN edit.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading DESIGN.md §8–§10, §13 and PLAN §5.24, then a dry `inventory.py`/`extract.py` on the tree.

## 2026-10-05 04:14 UTC — R-MODEL-C34 (reviewer) — checkpoint: the 500-seed differences classified; final runs launched
**Measured (jsdom, each seed alone, load 0.2–1.8):** the nine 500+500 walks — none a live defect: C3/C4 222, 241: the
oracle's per-event frame drag landed a carried kid a cell off (F136, fixed live by A1 C2; worked by hand for 241: the
live engine puts K under R's neighbour as the arithmetic does) → the oracle drags a selection with frames in one event;
451, 213, 231, 341: the selections differed only by ids the oracle's drop carried or merged out of a dragged frame
(select 34/73's `held`) → the tile fuzz deselects both there (`heldDeselect`, opt-in); 476: the oracle's pen-up walk had
moved the cut native's stored numbers by W, so its pieces round apart (7.6e-6 home units at a vertex) → pieces of a walked
family compared by drawn box within 1e-4 (`walkedCut`); plain 296, 386: a carried native 2 ulp above its home (seed 20's
two roundings) → 2 ulp in both lanes. All nine green alone.
**Break-checks (copy `bc3`):** the live-rode camera branch — a camera riding a move the oracle never made (BK_RIDE): red
at 416 step 13; `mergedAlike` — a frame dropped from the live repair: red at 73 step 17; a live merge (BK_MERGE) is the
oracle's own behaviour, invisible to the selection fuzz by construction, red in `lattice.coresident` (3 tests, one the new
pin "a frame dropped on an inked frame's cell stays selected as itself").
**Decisions made:** each new rule counted in the probe's line, narrowed to its named difference.
**Questions asked:** none.
WHERE I AM: tile 500+500 and selection 200+200 running on the final harness (`r-c34/fuzz500c.log`, `sel200c.log`).

## 2026-10-05 08:55 UTC — orchestrator (Opus) — the fifth session-limit stop (~04:15–08:50); all three agents resumed
**Working on:** the limit stopped all three agents minutes after their resumes (R-MODEL-C34 at its 04:14 checkpoint,
B-PYRAMID-5 with batch b4 done at 04:12, B-DOCMAPS in item 1). The container rebooted (uptime 0 at 08:51); the tree was
clean at 62d7e23 with every edit. R-MODEL-C34's final runs had finished: tile 500+500 (1,015 s) one difference, seed 321
step 26 (lassoDrag): native 16, oracle 1 item, live 0 (carried) — to be traced as a possible live defect; selection
200+200 (210 s) green. All three resumed by message.
**Measured:** nothing.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: measuring the production code's size before and after the rebuild for Kobin; the monitor re-armed.

## 2026-10-05 08:54 UTC — R-MODEL-C34 (reviewer) — resumed after the fifth stop and reboot (tree at 62d7e23)
**Runs that finished before the stop (final harness, jsdom):** tile 500+500: 39,987 checks, 276,021 items, ONE difference
— plain seed 321 step 26 (lassoDrag): native 16 at "0", oracle 1 item, live 0 (carried); counts camSynced 2, unitApart
11, dropDeselect 83, heldDeselect 19, rerouted 31 (max 9.3e-10), oracleSlip 6, walkedCut 9 (max 2.3e-6), normalised 536.
Selection 200+200: green (16,000 checks, 3,188 selections, held 41).
**Next, in order:** seed 321 traced as a possible live defect first; break-checks for `heldDeselect`, `walkedCut` and the
2-ulp carry (injections in copy `bc3`: BK_SEL, BK_CUT, BK_ABOVE), and the oracle's one-event frame drag shown to be the
oracle's alone; then the review's measurements (bake profile, city lasso, R-DRAG timings, Chromium 3/4), the suites.
**Questions asked:** none.
WHERE I AM: tracing tile seed 321 (plain, step 26, lassoDrag).

## 2026-10-05 08:53 UTC — B-DOCMAPS (builder) — resumed after the session-limit stop (tree at 62d7e23)
**Item 1 had reached** (on disk, snapshotted in 9e0f7b9/62d7e23): `extract.MODFILE` keys all 153 files (19 live new:
`stg plm fgc lv1 eru cde dvl pyr pys lvl jbq pft lsl svl svo sva dvs erc shd`; oracles `rls` + 22 `m1*` for
`model-v1/`; `pic`/`pls` gone); `extract.py` resolves a `new X()` and `extends X` through the file's own import first
(the oracle's `new Document()` went to the live file) and has a second prototype group for the frozen engine;
`graph.MOD`/`MODNAME` and `newdesc.ARTICLES` carry them (new pristine slots `space`, `views`; one article per
model-v1 file); `entries_for` orders rows by source line. `extract.py` runs: 153 files, 3,649 nodes, 7,054 edges.
**Measured** (`dmap/diffsets.py`, 56e36b3 copy + the graphdata committed there): live 733 new, 355 changed (287 code),
8 text-only, 1,473 same, 264 deleted; model-v1 456 identical to their 56e36b3 described body, 442 to read (281 of
them identical to today's live body). src since fba12b4: tests/testkit/probes only, so the sets stand.
**Decisions made:** one article per model-v1 file (a multi-module article resolves a shared leaf name to one
module's row); the frozen-model statement in each article's role, never in a row.
**Questions asked:** none.
WHERE I AM: item 1 — ROLE texts for the new articles, the `pic.*`/`pls.*` entries and pristine prose removed, then
`rebuild.py` to `verify_coverage` (gaps expected) as item 1's checkpoint.

## 2026-10-05 08:54 UTC — B-PYRAMID-5 (builder) — resumed after the fifth stop; b4 END (item 6 not effective in the browser)
**Working on:** why the kept decision did not apply in scenario 4; then R-PYRAMID-34's items, the full measurement.
**b4's numbers (headless, `--dense --scenario 4`, each run started under load 2: 1.84–1.99 → 2.36–3.29 at the end):**
the drop's render row before item 6 (`cur`, 26e3e69) 1,061 | 1,028 ms with `ovl.tail` 488 | 470; after (`fin1`,
fba12b4) 1,149 | 1,071 ms with `ovl.tail` 566 | 430, and the profiled run 1,141 with 535 — `_selDecide` 338.7 ms at the
drop in its profile (548 in b3's). **Item 6's rule did not take effect in the browser**: the drop still decides afresh.
What did change: the "crawl" rows (473–456 ms of a carried decision each, three a run before) are gone after.
**Decisions made:** not reporting item 6 as done; tracing it next on a copy (`bp5/tr6`: why the kept decision is
refused — the selection replaced at the drop, a member's or a frame's displacement, the window).
**Questions asked:** none.
WHERE I AM: b5 — the traced copy on :3013, one profiled scenario-4 run that dumps the refusal's reason.

## 2026-10-05 08:58 UTC — B-DOCMAPS (builder) — checkpoint: item 1 (every file keyed) done
**Working on:** item 1 finished; item 2 next. Files: `tools/docmaps/` only.
**Measured:** `extract.py` 153 files, 3,649 nodes, 7,054 edges. 42 new articles (19 live files: slots `space`, `views`,
`paper`, `facade`, `truth`, `sh-components`; 23 oracle files in `dead`, one per model-v1 file), each with a ROLE in six
new area files (`newdesc_stage/pyramid/pyrparts/svg/model/m1.py`). Deleted: `newdesc_raster2.py` (PictureLayer and
PlateStore, 123 entries) and 134 more entries of deleted functions in 10 area files (`dmap/prune.py`, by `ast` span;
every old text kept in `dmap/oldtext.json` for the moved ones); the `ensureOutline` EXTRA. A lenient chain run
(`dmap/devrun.py`: graph's hand-edge asserts as warnings, in memory only): Code Map missing 1,626 of 3,649; audit_stale
27 pristine rows naming deleted functions (item 3); graph.py refuses 46 hand edges naming no node (item 5).
**Decisions made:** rows ordered by source line within an article (`newdesc.entries_for`), so an entry's area file does
not decide its place; the paper section's lead rewritten (the Stage's items into the pyramid's plates).
**Questions asked:** none.
WHERE I AM: item 2 — reading `src/engine/Stage.js` function by function, entries into `newdesc_stage.py`.

## 2026-10-05 09:02 UTC — R-MODEL-C34 (reviewer) — checkpoint: seed 321 was the harness's; the last break-checks red
**Seed 321 (plain, step 26):** not a live defect — my oracle-only one-event drag. The press missed the selection and
started a lasso; the oracle's selection held a frame, so it got one move, a 2-point lasso, refused (`pts >= 3`); the live
one got 3 points, applied it, and its barrier cut a pending mark's target (16 → 19). The one-event rule now applies only
when the oracle's press is on the selection (selected ink or a selected frame's mark); 321, 222, 241 green. Measured: in
seed 241's frame drag the oracle gets 1 move, the live engine 2 (its per-event path keeps its coverage).
**Break-checks (copy `bc3`, injected live defects, each red):** `heldDeselect` — a repair dropping a frame (BK_SEL): 451,
213, 231, 341 all red (each green with 1 heldDeselect uninjected). `walkedCut` — the cut's kids moved 1e-3 home units
(BK_CUT): 476 red ("drawn boxes 0.000999 units apart"); a missing kid (BK_CUTDROP): red ("oracle 1 items, live 0"). The
2-ulp carry — the excused native read above its home 2.4e-10 (~8 ulp) or 1e-9 home units off, armed from the carried
step: plain 296 red at step 10 ("no match (carried)"); 386's carried read goes through tiles, not a group, so that
injection does not reach it there.
**Questions asked:** none.
WHERE I AM: the review's timings while the CPU is free (bake profile pre vs cur, the city lasso, R-DRAG's delete and
`setBatch`), then Chromium 3/4, then the final 500+500 / 200+200 runs and the suites.

## 2026-10-05 22:28 UTC — orchestrator (Opus) — the sixth stop (~09:15–13:50); the three agents retired for fresh successors
**Why:** the last three windows gave 13–23 minutes of work each. Measured from the agents' own usage records: every
step re-read the agent's whole context — R-MODEL-C34 729k tokens a call (73 calls 08:52–09:13, 51.8M; one cache rewrite
of 698k after a 10-minute wait), B-PYRAMID-5 642k (44 calls, 27.3M), B-DOCMAPS 500k after one hour of reading code (194
calls, 62.4M). Their work is all in the tree (snapshot d438a5d) and this log, so each is replaced by a successor that
starts small: **R-MODEL-C34b** (the review's timings, the review by reading, Chromium 3/4, the final runs, docs, the
report for both), **B-PYRAMID-5b** (item 6 — the drop's member table grew 1,045 → 1,046 in the traced browser run, so
the kept decision was refused; the drawn-ink check in progress in `overlays.js` — then R-PYRAMID-34's skipped
measurements, the full measurement, the report for both), **B-DOCMAPS-2** (item 2's rest only: ~330 new functions in
files that existed at 56e36b3; items 3, 4 and 5–8 go to later fresh runs, one at a time).
**Measured:** as above. The code map's lenient chain: the remaining gaps are the oracles (~900), ~330 new functions in
existing files, 27 stale pristine rows, 46 + 84 hand edges, 90 Call Map problems.
**Decisions made:** bounded runs with fresh contexts; long waits run in the background (a wait over 5 minutes re-reads
the whole context at full price).
**Questions asked:** none.
WHERE I AM: launching the three successors.

## 2026-10-05 22:31 UTC — R-MODEL-C34b (reviewer) — start (successor of R-MODEL-C34; tree at d438a5d)
**Working on:** items 1–6 of the hand-over, in order: the review's timings (bake profile pre vs cur, the city lasso,
R-DRAG's `setBatch` and subtree delete, seed 777 after GC), the review by reading (brief §2, B-MODEL-C34 §3), Chromium
scenario 4 and the round trip, the final runs, docs, the report. Files: the model files and suites (brief §4),
`__testkit__/modelFuzz.js`, the model docs; the `src/engine/zz_*` probes (mine to delete at the end). Not mine: raster
files, `overlays.js`, `tools/docmaps/`. Scratch `r-c34/`; ports 3030–3039.
**Measured:** load 0.09 at start.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: comparing `r-c34/bp-pre-{1,2}.log` against `bp-cur-{1,2}.log`.

## 2026-10-05 22:32 UTC — B-DOCMAPS-2 (builder) — START: item 2's rest (new functions in files that existed at 56e36b3)
**Working on:** brief `review/rebuild/briefs/B-DOCMAPS.md` item 2, the ~330 new live functions in pre-existing files
(`erasePipeline`, `RasterRenderer`, `Document`, `TileStore`, `sceneIndex`, `KobinEngine`, `LevelMap`, `selection`,
`rasterCore`/`rasterPack`/`rasterWorkerClient`, `Renderer`, `offsets`, `arcPerimeter`, `overlays`, the small ones, the
UI's `DevStats`/`EraseChip`/`ScaleHud`/`SyncChip`). One file at a time: its new bodies printed by script, its entries
written to disk before the next. Files: `tools/docmaps/` only (the `newdesc_*.py` area files, `data/`). Not items 3–8.
**Measured:** nothing yet; tree at 1166608.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: refreshing `inventory.py`/`extract.py` on the tree, then the work list by file from the lenient chain.

## 2026-10-05 22:40 UTC — B-PYRAMID-5b (builder) — start (item 6's kept ant decision across a drop; R-PYRAMID-34's skipped items; the full measurement)
**Working on:** item 6, from the tree (97b9dce) and the predecessor's traces. Files: `overlays.js`, `raster.overlay.test.js`,
`selection.indicator.test.js`, DESIGN §10's indicator line; later the raster files of the brief's §3.
**Read from the traces (`bp5/h-tr6a`–`e`):** the extra entry at the drop is frame `1/-1,1`, a kid of the selected spine
frame `1` that the drop's rest re-homed under the neighbour container, so `_repairSelection` added it as a selected frame
(DESIGN §10; the mechanism `select.inkless` I6 pins). Its ink was in the selection already (under `1`); only the
selection's structure changed. tr6d: a frame keyed by its cell with its shift (`withShifted`) moves unevenly when the drop
writes a residue shift (frame `1`: [-16,16] → [224,272]×[104,144] for d = (240,120)); its content moves by d exactly.
**Decision (pending the test):** key the drawn ink independently of which frames are the selection's entries — the natives
on the list and the own members off it by id, and every frame under a selected frame (`walk`) by its own content through
its shift — so a frame torn off at the rest is the same key before and after.
**Questions asked:** none.
WHERE I AM: writing the red-before test on I6's fixture in `raster.overlay.test.js` G14.

## 2026-10-05 22:40 UTC — B-DOCMAPS-2 (builder) — checkpoint: item 2's rest, 5 files of 30 done
**Working on:** the new live functions in pre-existing files, file by file; entries into the existing area files
(`dmap/setentry.py`'s MODTARGET: `newdesc_engine.py` for lm/doc/erp, `newdesc_paper.py` ts, `newdesc_scenes.py` six).
**Measured:** `dmap/todo2.py` (new = absent from the graphdata committed at 56e36b3, file present then, outside
`__oracles__`): 302 functions in 30 files after the refresh (`inventory.py` 3,655 functions). Described so far from their
bodies: LevelMap 19, Document 26, TileStore 24, sceneIndex 23, erasePipeline 57 = 149. Lenient `verify_coverage`: those
files off the Code Map's gap list. The Call Graph half is stale for every new function: `build_graph_page.py` stops on its
layout assertion (not item 2's; noted for the report).
**Decisions made:** node ids exactly as `graphdata` names them (`doc.tableOf`, not `doc.Document.tableOf`); a getter pair
in one row where the one-liner covers both (`_keyIn · _keyOut`, `_lineageAdd · _lineageDelete`); § = DESIGN.md's numbering.
**Questions asked:** none.
WHERE I AM: selection.js (10), then KobinEngine.js (20), RasterRenderer.js (40).

## 2026-10-05 22:44 UTC — R-MODEL-C34b (reviewer) — checkpoint: item 1 (the review's timings) done; item 2 read
**Measured (jsdom; the probes `r-c34/zz_rc34_bakeprof`, `src/engine/zz_rc34_*`, `zz_rc34b_*`):** bake profile, the zoom
out and back on the dense drawing, raster path, 3 runs × 3 passes per tree (load 0.1–2.1): pass ms pre-C3/C4 mean 3,171
(2,314–3,973), current 3,284 (2,694–3,688), +3.6 %; the one `_bakeUp` a pass 2,920 → 3,012 ms (+3.2 %), C3/C4's helpers
1 ms (`sameCell` 1,413 calls). A1 §16's +12/+24 % is not reproduced: within the run-to-run spread. City lasso (F108):
16 frames, 0 ids, 12 ms (the oracle 48 ids, 9.2 ms). Census, drop on an inked cell: live 9/9/9 frames, 3 co-resident
groups; oracle 9/6/6. Seed 777 et al. after the drop's GC: live 5/14/4, oracle 5/15/5 (as A1 §16). R-DRAG: the 5,000-native
delete raster 588–642 ms, SVG 1,716–1,758; its undo 697–719 / 2,862–3,075 (load 2.1); the drop's `setBatch` wrap 211–387 ms
vs 209–385 without, 2 of 4 cached tiles dropped instead of patched.
**Found by reading + probe (pre-existing, both trees):** frame GC forgets the picture sources `_prepareView` minted
(`lm.minted` = GC candidates; `_history`/`_endMove` collect after their render): per undo or redo with a shifted frame's
ink in view, 1 frame forgotten and re-minted, 2 tile bakes, 1 plate drop (pre-C3/C4: the same, 2.3 bakes). A keep rule:
design question.
**Questions asked:** none yet (in the report).
WHERE I AM: item 3 — frozen copies of 59f0a76 and HEAD, dev servers on 3030/3031, the batch announced before it starts.

## 2026-10-05 22:45 UTC — R-MODEL-C34b (reviewer) — browser batch c1 START (item 3: scenario 4 and the round trip)
**Working on:** headless Chromium, frozen `git archive` copies: the landed tree 59f0a76 (`r-c34/landed`, :3030) and HEAD
b3c842b (`r-c34/curB`, :3031); one frozen harness (`r-c34/h`). `--dense --scenario 4` × 2 per tree interleaved, then the
plain round trip × 1 per tree; each run starts only under load 2 (waits up to 30 min), load printed. Dev servers Node 14,
pids in `r-c34/dev-303x.pid` (mine; killed by pid at the end). Script `r-c34/batchc1.sh`, log `r-c34/batchc1.log`.
**Measured:** load at announce 1.1.
**Questions asked:** none.
WHERE I AM: starting the servers; meanwhile item 2's acceptance list.

## 2026-10-05 22:45 UTC — B-PYRAMID-5b (builder) — checkpoint: item 6 rule finished (jsdom); browser batch b6 START
**Built (`overlays.js`):** `_selMembersAt` keys the ink the selection stands for — natives on the list and own members off
it by id, and every frame under a selected frame (`lm.walk`) by its own natives (`_selFrameInk`, which `_selFrameContent`
now unions) — so the torn kid is the same key before and after. The frames' cell keys (dot) are gone (tr6d: a residue
shift moves a cell with its shift unevenly). DESIGN §10's indicator sentence rewritten to the rule.
**Tests (raster.overlay G14, +2):** "a kid the drop's rest tears off a selected frame…" (I6's fixture: kept, shift 12 px,
the kept run and dot within 0.01 px of a fresh decision's) and "ink that left or entered the list…" (3 cases). File 60/60.
**Red before (unimported copy `bp5/bc`):** with the in-progress `overlays.js` (97b9dce) 1 of 60 (the torn kid); with
62d7e23's 2 of 60 (both new tests). **Break-checks:** roots only, no walk 1 red; frames by cell with shift 1; the
selection object required to be the drag's 1; off-list ink never refuses 1; the window not cut 1; entered ink not looked
at 1; no kept decision 4 (of 121, three suites); displacement from the first piece alone 1; the view-in-window check 1.
**b6 (headless, `--dense --scenario 4`):** `landed` (59f0a76, :3015) ×2 and `fin2` (the working tree at 22:55, :3016) ×2
interleaved, then one profiled drop on `fin2`; harness `bp5/h5` = `hp` + the ant decisions the drop made
(`_selDecSeq`). Each run under load 2 and with no other Chromium running (R-MODEL-C34b's c1 goes first). Log `bp5/batch6.log`.
**Questions asked:** none.
WHERE I AM: b6 running; R-PYRAMID-34's skipped items meanwhile (F134/F135's jsdom timings first).

## 2026-10-05 22:46 UTC — B-DOCMAPS-2 (builder) — checkpoint: item 2's rest, 17 files of 30 done
**Working on:** the new live functions in pre-existing files; `tools/docmaps/newdesc_{engine,paper,raster1,raster3,geom,scenes}.py` (appended
under the "2026-10-05, the rebuilt tree" header by `dmap/setentry.py`).
**Measured:** described from their bodies since the last entry: selection 10, KobinEngine 20, RasterRenderer 40, rasterCore 10,
rasterPack 10, rasterWorkerClient 10, Renderer 9, overlays 6 (B-PYRAMID-5b added `_selFrameInk` meanwhile; re-extracted:
3,656 functions), offsets 6, arcPerimeter 5, arcShape 1, biarc 1 — 278 of 303 so far. Small files left: 25 functions in 13.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: the small files (SyncChip, CanvasEditor, eraseDescent, eraseJob, oplog, persist, MovePlane, rasterJob, rasterPerf,
sceneClient, rasterWorker, reportSend, useKobinEngine), then the lenient chain's coverage and audit_stale.

## 2026-10-05 22:50 UTC — B-DOCMAPS-2 (builder) — END: item 2's rest done (303 of 303 new live functions in pre-existing files)
**Working on:** finished. Files: `tools/docmaps/newdesc_{engine,paper,raster1,raster3,geom,scenes,local,shell,report}.py` (288
entries appended by `dmap/setentry.py`; 11 more functions named in 9 shared rows such as `_keyIn · _keyOut`), the generated
`data/` and pages. Nothing under `src/`.
**Measured (lenient chain, `dmap/devrun.py`, tree at e6d2e2b + R-MODEL-C34b's uncommitted `_prepareView` key):** 3,656
functions; Code Map missing 905, every one an oracle node (item 4), 0 live; `descriptions.build()` 0 live nodes without a
description (the graph page still refuses its 905 oracle nodes); `audit_stale` 27 (pristine rows, item 3, unchanged);
`check.py` 90 problems and `graph.py` 46 + 84 hand edges (item 5, unchanged).
**Decisions made:** § in new entries is DESIGN.md's current numbering; older entries' § (e.g. LevelMap at §5/§6) appear
to follow an older design document — left for item 3.
**Questions asked:** none.
WHERE I AM: done; next run is item 3 (the 355 changed functions) from `dmap/sets.json`'s `changed` list.

## 2026-10-05 22:50 UTC — B-PYRAMID-5b (builder) — note for R-MODEL-C34b: a wait that cannot end
**Seen:** `r-c34/batchc1.sh`'s new wait (`pgrep -f "browser-check.js|headless_shell|chrome-linux"`) matches its own launcher
shell, pid 9319 (ppid 1; its command line holds the pattern), so it waits out its 60 min and then starts regardless. My
batches had the same fault and now match browsers by process name: `pgrep -x "chrome|headless_shell"`. b6 restarted with
it; it starts a run only with load under 2 and no browser of anyone's running.
WHERE I AM: b6 (scenario 4, landed against fin2) waiting for a quiet start.

## 2026-10-06 03:23 UTC — orchestrator (Opus) — the seventh stop (~22:52–03:20); all three resumed
**Measured (the agents' usage records):** the fresh successors' window, 22:30–22:52: 817 calls at ~170k context each
(141.6M tokens; the old agents' window was 311 calls at ~650k), and the orchestrator 98 calls (28.4M). Done in it: item
2's rest of the code map (303 functions), R-MODEL-C34b's items 1–2, B-PYRAMID-5b's item 6 rule with its tests and
break-checks — about three times the work of the windows before, in the same ~20–25 minutes.
**Working on:** R-MODEL-C34b (item 3, the browser batch, onwards), B-PYRAMID-5b (batch b6 onwards) and B-DOCMAPS-3 (item
3 of the code map) resumed by message; the container rebooted, the tree clean at 3e14703.
**Decisions made:** the orchestrator's monitor narrowed to end entries, questions and notes (its own wake-ups cost a
sixth of the window).
**Questions asked:** to Kobin: the code map's scope against the usage windows (the oracles' 900 descriptions; the model
for the description runs).
WHERE I AM: waiting for the agents' reports.

## 2026-10-06 03:24 UTC — B-PYRAMID-5b (builder) — resumed after the stop and reboot; b6 END (item 6 measured in the browser)
**b6 had finished before the stop** (`bp5/batch6.log`, 22:51–23:02; five runs, exit 0, each started with load under 2 and no
browser running: 0.43–1.93 at the start, 1.48–2.36 at the end). Headless Chromium, `--dense --scenario 4`, harness `bp5/h5`.
**Measured:** landed (59f0a76): one ant decision at the drop; the drop's render row 1,121 | 1,168 ms, `ovl.tail` 485 | 523;
three "crawl" rows after it, 492–621 ms each (`ovl.decide` 469 | 503 carried). The tree (`fin2`, 22:47): no decision at
the drop (`_selDecSeq` unchanged; the kept one shifted by (240, 120)); the drop's row 749 | 633 ms (764 profiled), its
top three `eng.list` 410–541, `eng.view` 118–163, `eng.pack` 53–60 — `ovl.tail` under 53; no crawl rows. The profile
(100 µs, 4 s from the drop): `_selectionAnts` 9.7 ms inclusive, `_selMovedBy` 5.9 (`_selMembersAt` 5.4), `_selTable` 2.5
(b4: `_selDecide` 338.7 at the drop). Load now 0.47.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: item 2 — the jsdom timings (F134/F135) now, then b7 (`?svg` round trips, F133) and b8 (scenarios 1, 6, 7).

## 2026-10-06 03:25 UTC — R-MODEL-C34b (reviewer) — resumed after the session-limit stop and reboot (tree at 3e14703)
**Done before the stop (in the tree):** `_prepareView`'s key counts frame GC's forgets (`KobinEngine.js`): a forget and a
mint between two renders left `frames.size` as it was and the view unprepared (F111's shape); `model.pureRead` "a frame GC
forget and a mint before the next render…" red before (the source frame missing at the render), file 3/3 green after.
Batch c1 finished at 22:58 (6 runs, exit 0, load at start 1.25–1.67, no overlap with b6's runs): scenario 4 gives no ink
measure in this harness, so its pixels are not compared yet; the round trip's are.
**Working on:** item 3's rest — scenario 4 once per tree with the composed canvas's ink read after each gesture settles
(`r-c34/h2`, a copy of the harness plus that read), servers on 3030/3031 again; then items 4–6.
**Questions asked:** none.
WHERE I AM: restarting the two dev servers over `r-c34/landed` and `r-c34/curB`; batch c2.

## 2026-10-06 03:25 UTC — B-DOCMAPS-3 (builder) — START: item 3 (the 355 changed live functions), the stale rows, the § column, the 13 rows
**Working on:** brief `review/rebuild/briefs/B-DOCMAPS.md` item 3, plus `audit_stale.py`'s 27 pristine rows, every § moved
to DESIGN.md's current numbering, and the 13 Code Map rows with nothing to open. Files: `tools/docmaps/` only (area files,
`pages/boundless-code-map.pristine.html`, the generated `data/` and pages). Nothing under `src/`.
**Measured:** tree at 3e14703 (clean after the reboot); `inventory.py`/`extract.py` re-run: 153 files, 3,656 functions,
7,073 edges, `data/` unchanged. The sets recomputed against it (`dmap/diffsets3.py` → `dmap/sets3.json`): the same 355
changed (287 code, 68 by span or calls between the last rebuild and 56e36b3) and 8 comment-only; one new since 09:00
(`ovl._selFrameInk`, already described).
**Decisions made:** the 8 comment-only functions are re-read with the 355 (the brief's "check the entry against the new
comment's claim"); the 68 span/calls ones are read whole against their entries (no older body to diff).
**Questions asked:** none.
WHERE I AM: item 3 file by file, smallest context first: the diff and the texts of `src/engine/KobinEngine.js`'s 32.

## 2026-10-06 03:26 UTC — B-PYRAMID-5b (builder) — item 2 jsdom part done; browser batches b7 then b8 START
**Measured (jsdom, the unimported copy `bp5/bc` of the tree, load 0.8–5.8: another agent's servers compiling):** F135, LH-7 three
runs: `liveHoldMsMax` 24.1 | 56.7 | 37.9 ms (B-PYRAMID-4: 41–63), `groupsTimedOut` 0, 2 handoffs, 0 composes drawing a stroke
twice, the test 88 | 166 | 106 ms. F134: `jobQueue` F134 11 | 3 | 3 ms; `raster.commit` F134 (the engine) 59 | 59 | 68 ms.
Bundles (`bp5/bundles.sh`, esbuild into the scratchpad): scene-worker dce304b8… in both trees; raster-worker landed
83283d8b… → tree 432c239e… — the input that changed is `LevelMap.js` (R-MODEL-C34's `_joinGroups` rule), not a pyramid file.
The tree's `public/raster-worker.js` was stale (a949be55…): `npm run build:worker` run, now 432c239e…, scene dce304b8….
**b7:** the `?svg` round trip (`bp3/svgtrip.js`) on c7fed1a (:3017), b793360 (:3018) and `fin2` (:3016), states diffed c7→b79
and b79→fin2; F133's memory (`bp3/svgdrag.js`, `fin2`, whole drawing, 12 events, forced GC). **b8:** `--dense --scenario` 1, 6,
7 once each, landed (:3015) against `fin2`. Every run: load under 2 and no browser running. Logs `bp5/batch7.log`, `batch8.log`.
**Questions asked:** none.
WHERE I AM: b7/b8 running; then the suites (raster, quick), typecheck, lint, the report.

## 2026-10-06 03:37 UTC — R-MODEL-C34b (reviewer) — checkpoint: item 3 (Chromium) done; batch c2 END; final runs started
**Measured (headless Chromium, frozen copies: landed 59f0a76 :3030, current = 3e14703's src :3031; each run started
under load 2 with no other browser running; c1 22:52–22:58, c2 03:29–03:35, no overlap with b6):** the round trip's
composed ink identical across the trees at every state (drawn 25,244 px hash 2642089195, zoomed out 101 px, back 25,244 px
the same hash); scenario 4 (harness `r-c34/h2`: the canvas read after each gesture settles), 2 runs a tree: after the
lasso 1,012,664 ink px, hash 3619009051, after the drop 1,012,661 px, hash 2972295975 — identical in all four runs. Paper
0 ms in every row. The drop's settle 3,377–4,377 ms landed, 2,594–3,035 current (c1+c2). Dev servers stopped (by pid).
Scratch probes deleted from `src/engine` (all `zz_*`, `__testkit__/zz_modelFuzzOld.js`). TEST-MAP's model rows extended.
**Working on:** item 4 — `r-c34/final.sh`: tile 500+500 and selection 200+200 side by side, then `test:erase`, then the
quick suite; typecheck and lint after. Worker sources unchanged since 59f0a76: no `build:worker`.
**Questions asked:** none.
WHERE I AM: waiting on `r-c34/fin-*.log`; meanwhile the OPEN-FLAGS F138 entry from `r-c34/f138b.md`.

## 2026-10-06 03:41 UTC — B-DOCMAPS-3 (builder) — checkpoint: item 3, 3 files of 45 (91 of 363 re-read)
**Working on:** item 3. Files: `tools/docmaps/newdesc_{paper,raster1}.py`, `long_{eng,view}.py`,
`pages/boundless-code-map.pristine.html` (rows), nothing under `src/`.
**Measured:** `KobinEngine.js` 32 re-read, 22 corrected (the hold, the drop, the render, undo/redo through `_history`,
the constructor's FIX naming `PlateStore`/`_drainPlates`/`_followCarries`); `Renderer.js` 29, 6 corrected (`render`'s
masks; four rows naming moved functions); `RasterRenderer.js` 30, 24 corrected (no longer a `Renderer` subclass; no
sync path, no drain; the pyramid, the queue, the Stage). Plus `rr._losePlane` (unchanged body, made false by the
engine's `_planeLost`). Lenient chain: Code Map missing 905 (the oracles), 13 rows with nothing to open, stale 27.
**Decisions made:** each correction's § is DESIGN.md's current section (§8 the drag's hold and drop, §9 the
renderer, §10 the indicator, §14 the perf rows); tools `dmap/rev3.py` (diff + texts), `setfix.py` (FIX items),
`rowfn.py`, `tally3.py`; decisions marked `# K`/`# C` in `dmap/c3_*.py`; false src comments in `dmap/srcnotes3.txt`.
**Questions asked:** none.
WHERE I AM: item 3, `src/engine/LevelMap.js` (26), then Document.js, selection.js, sceneIndex.js, TileStore.js.

## 2026-10-06 03:45 UTC — B-PYRAMID-5b (builder) — checkpoint: b7's round trips done; suites; b7's F133 run and b8 waiting for quiet
**Measured (headless, `?svg` round trip, `bp3/svgtrip.js`, one run a tree, load 0.89–1.67 at the starts):** all three mounted
the SVG renderer, no page errors; 9 of 9 states 0 px differing c7fed1a → b793360 and b793360 → the tree (`fin2`), the
screenshots 37–80 KB each (B-PYRAMID-3's claim, 0 px in 9 of 9, holds; the tree changed nothing on the SVG path).
**Suites:** the raster suites + `selection.indicator`, `move.drop`, `stage.cover`, `select.inkless` (39 files): 666 of 667
(load 2.8 → 6.5 beside R-MODEL-C34b's fuzz); the one red, in `raster.pyramid`, green alone 38/38 at load 5.5–6.1 — named
in the quick suite's run, now running. typecheck 0 errors; lint 0 errors, 5 warnings (none in my files).
**Waiting:** b7's F133 run and b8 start only under load 2 with no browser; R-MODEL-C34b's final fuzz runs hold the load at 3–6.
**Questions asked:** none.
WHERE I AM: the quick suite; then b7's F133 run and b8 when the machine is quiet; then the report.

## 2026-10-06 03:50 UTC — B-DOCMAPS-3 (builder) — checkpoint: item 3, 10 files of 45 (222 of 363 re-read)
**Working on:** item 3. Files: `tools/docmaps/newdesc_{paper,raster1,engine,scenes}.py`, `long_{eng,view,space,rest}.py`,
the pristine page's rows; nothing under `src/`.
**Measured:** 222 re-read, 110 corrected, 112 kept: LevelMap 26/10 (shadows → co-residents, `objShift`'s `mint`),
Document 26/9 (`at` a plain read again, subtrees leave the lattice), selection 22/18 (barriers, the drag writes
nothing), sceneIndex 20/4 (checked by signature, names and constants: `dmap/sigcheck.py`), TileStore 19/7,
erasePipeline 18/11 (registration, `_bakeRun`, no `_neutralUnder`/`_uncutOf`/`_bakeOne`).
**Decisions made:** sceneIndex's 16 kept entries were not read line by line (no older body exists: the file is new in
56e36b3); their names, signatures and constants match the source.
**Questions asked:** none.
WHERE I AM: item 3, `src/engine/sceneClient.js` (14), then rasterPack, rasterCore, oplog, report, overlays, rasterPerf.

## 2026-10-06 09:27 UTC — orchestrator (Opus) — the eighth stop (~03:55–08:20); all three resumed
**Working on:** R-MODEL-C34b's final runs finished before the reboot, all green (tile 500+500, 40,000 checks; selection
200+200; `test:erase` 303 passed; the quick suite 2,210 passed, 0 failed; typecheck 0; lint 0 errors) — its docs and
report left. B-PYRAMID-5b: item 6 measured in the browser, the `?svg` round trips 0 px in 9 of 9 — F133's run, scenarios 1,
6, 7, its quick suite and the report left; one `raster.pyramid` test red under load 2.8–6.5 (green alone) to be named.
B-DOCMAPS-3: item 3 at 222 of 363. The container rebooted (uptime 0 at 09:25); the tree clean at d2b139c. All three
resumed by message.
**Measured:** nothing new.
**Decisions made:** none.
**Questions asked:** none.
WHERE I AM: waiting for the reports.

## 2026-10-06 09:27 UTC — R-MODEL-C34b (reviewer) — resumed after the stop and reboot (tree at d2b139c); item 4 done
**Measured (the final runs, jsdom):** tile 500+500 green alone (955 s; the first attempt beside `test:erase` was killed
out of memory): 40,000 checks, 276,313 items, 275,533 exact, 780 carried (154 within 2 ulp), `latticeBreach` after every
op; counts camSynced 2, unitApart 11, dropDeselect 83, heldDeselect 19, rerouted 31 (≤ 9.3e-10), oracleSlip 6, walkedCut 9
(≤ 2.3e-6), normalised 536 (≤ 1.5e-8). Selection 200+200 green (16,000 checks, 3,188 selections, held 41). Quick suite
2,210 passed, 0 failed, 12 skipped; `test:erase` 303 passed, 1 skipped; typecheck 0; lint 0 errors (5 warnings, none
mine). Worker sources unchanged since 59f0a76 (no rebuild; raster 432c239e…, scene dce304b8…).
**Working on:** item 5 — the numbers into OPEN-FLAGS F138 and A1 §16; then the report.
**Questions asked:** none.
WHERE I AM: filling `RUNS`/`ROWRUNS` in `docs/OPEN-FLAGS.md` and `TILE` in A1 §16.

## 2026-10-06 09:27 UTC — B-DOCMAPS-3 (builder) — resumed after the session-limit stop (tree at d2b139c)
**Working on:** item 3 from the tree and `dmap/` (both intact): 269 of 363 re-read on disk (129 corrected, 140 kept) —
past the 03:50 checkpoint, sceneClient (14 kept), rasterPack (14, 9 corrected), rasterCore (11, 4), oplog (9, 6).
`src/` changed since 3e14703 only by a deleted testkit file, so the changed set stands.
**Questions asked:** none.
WHERE I AM: item 3, `src/engine/report.js` (9), then overlays, rasterPerf, rasterJob, rasterWorkerClient, MovePlane,
eraseDescent and the small files; then the stale rows, the § pass, the 13 rows.

## 2026-10-06 09:26 UTC — B-PYRAMID-5b (builder) — resumed after the eighth stop and reboot (tree at d2b139c+)
**Done before the stop:** b7's round trips (0 px, 9 of 9, both pairs), the raster suites, typecheck 0, lint 0 errors; the
quick suite at load 3.8 → 8.4 beside R-MODEL-C34b's fuzz: 2,209 passed, 1 failed, 12 skipped — the red is `raster.pyramid`
"a new prefetch plan supersedes the queued one…" (P1), red in 2 of 6 contended runs, green in 5 runs alone (281–300 ms;
not the 5-s timeout). Cause being traced next, under synthetic load, after the browser work.
**Now:** b7's F133 run, then b8 (scenarios 1, 6, 7, landed against `fin2`), servers on 3015/3016; load 0.23 at the start.
**Questions asked:** none.
WHERE I AM: b9 = F133 then b8 running; then the P1 test under busy loops (the failing assertion), the quick suite, the report.

## 2026-10-06 09:30 UTC — R-MODEL-C34b (reviewer) — end: the review done, F138 closed, report handed back
**Done:** OPEN-FLAGS F138 FIXED (the classified table, the final numbers, its index row); A1 §16 "Reviewed" bullet;
TEST-MAP's model rows (the 500-seed rules, the new `model.pureRead` case); DESIGN unchanged by this pass (the
predecessor's §8/§10/§13 edits stand; `_prepareView`'s key is a code-level fact). Files across the review:
`KobinEngine.js` (`_prepareView`'s key), `model.pureRead.test.js`, the `zz_*` probes and `zz_modelFuzzOld.js` deleted.
**Open, in the report:** frame GC forgets the picture sources `_prepareView` mints (a keep rule: design question);
`_camAt` unchecked against the missing frame (minor, unreached); PLAN §5.23 item 6's "10–25 % slower" not reproduced.
**Questions asked:** in the report.
WHERE I AM: done; the orchestrator lands the review from the report.

## 2026-10-06 09:45 UTC — orchestrator (Opus) — R-MODEL-C34 landed; the final design check started (R-FINAL-D)
**Working on:** R-MODEL-C34 (with C34b) landed as d16c7d4, PLAN §5.25 (F138 fixed, F139 filed: frame GC re-mints a
picture source at every undo or redo with a moved frame's ink in view). The final design check is two agents
(`briefs/R-FINAL-D.md`, the design audit and the documents; `briefs/R-FINAL-M.md`, the measurements on the final
tree): R-FINAL-D starts now (documents only), R-FINAL-M after B-PYRAMID-5 lands. Per the default given to Kobin, the
code map pauses after B-DOCMAPS-3's run until the check is done.
**Measured:** nothing.
**Decisions made:** the check split in two so each agent's context stays small.
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-5b's report and B-DOCMAPS-3's.

## 2026-10-06 09:31 UTC — R-FINAL-D (reviewer) — start: the final design audit (tree at d16c7d4+)
**Working on:** brief `briefs/R-FINAL-D.md`: 1.1 targets, 1.2 acceptance list, 1.3 deletions, 1.4 docs, 1.5 10-STATUS.
Files mine: `review/rebuild/FINAL-AUDIT.md` (new), DESIGN.md §7–§10/§13, `docs/ai/10-,20-,30-,40-`, `docs/OPEN-FLAGS.md`
(flag rows only). Not touching `src/`, `tools/`. B-PYRAMID-5's raster reading and its 10-STATUS entry left for last.
**Questions asked:** none.
WHERE I AM: reading PLAN §0–§3.

## 2026-10-06 09:33 UTC — R-FINAL-D (reviewer) — checkpoint: 1.3 done
**Done:** `review/rebuild/FINAL-AUDIT.md` created with the 1.3 table (every named mechanism gone or legacy-only; two
minors: "zoom quantum"/"sync path" stale wording in raster comments; `syncCameraOnly` kept as the camera step's name).
**Questions asked:** none.
WHERE I AM: 1.1 — the design targets table (Stage, pyramid, erase, move, SVG, pool, model, kept).

## 2026-10-06 09:34 UTC — R-FINAL-D (reviewer) — checkpoint: 1.1 done
**Done:** FINAL-AUDIT 1.1 table: every target built; differences found are recorded (mask overflow's raise in A2 §4.4's
as-built note; the patch budgets in PLAN §5.20/§5.22). No major.
**Questions asked:** none.
WHERE I AM: 1.2 — the acceptance list's ten rows against `review/rebuild/TEST-MAP.md` and the test files.

## 2026-10-06 09:50 UTC — B-DOCMAPS-3 (builder) — checkpoint: item 3 done (363 of 363 re-read: 172 corrected, 191 kept)
**Working on:** item 3 finished; the stale rows next. Files: `tools/docmaps/newdesc_*.py`, `long_*.py`, the pristine page.
**Measured:** 355 changed + 8 comment-only re-read; corrected where false, clustered in RasterRenderer 24/30, KobinEngine
22/32, selection 18/22, LevelMap 10/26, erasePipeline 10/18, rasterPack 9/14, Document 9/26; sceneClient 0/14. Three
outside the set made false by others' changes (`rr._losePlane`, `doc.cedeTileById`'s FIX and row: `eraseDescent.cedeVirtual`
is gone). Lenient chain: Code Map missing 905 (the oracles), rows with nothing to open 12 (was 13), `audit_stale` 16 (was
27; the Renderer article's four fixed with item 3).
**Decisions made:** an entry kept when the change left its claim true, even when a new behaviour is unmentioned; amended
only where cheap and the omission would mislead (e.g. `setTool`'s parked-gesture cancel).
**Questions asked:** none.
WHERE I AM: the 16 stale rows (TileStore 2, Renderer 3, engine-life 3, engine-erase 7, engine-select 1), then the § pass.

## 2026-10-06 09:35 UTC — R-FINAL-D (reviewer) — checkpoint: 1.2 done
**Done:** FINAL-AUDIT 1.2: every row's test present; rows 7 and 9 are probes (R-MODEL-C34b's 09:27 runs); row 2's oracle
is `__oracles__/renderList` (listFor gone). PLAN §3 rows 8 and 9 wording stale — to correct.
**Questions asked:** none.
WHERE I AM: 1.4 — PLAN §3 rows 8/9, then DESIGN §7–§10/§13 against the code (grep for deleted names first).

## 2026-10-06 09:37 UTC — R-FINAL-D (reviewer) — checkpoint: 1.4 in progress
**Done:** PLAN §3 rows 2/8/9 annotated as built; OPEN-FLAGS: F138/F139 anchors fixed (F139's section sat under F138's
anchor; `#f139` had no target), F80 and F111 dated notes for C3 and R-MODEL-C34b. DESIGN §7–§10/§13 and docs/ai 20/30/40
grepped for every deleted name: current (builders kept them), nothing false found so far.
**Questions asked:** none.
WHERE I AM: 1.4 — F94/F107/F108/F133–F137 index rows vs sections; then 10-STATUS (1.5).

## 2026-10-06 09:38 UTC — R-FINAL-D (reviewer) — checkpoint: 1.4 flags and 1.5 mostly done
**Done:** OPEN-FLAGS F107/F108 index rows' "where" (deleted names out, C3/C4's in). 10-STATUS: header updated 2026-10-06;
"Where the tree is" rewritten (branch pushed on rasteriser 56e36b3 — verified: origin/rasteriser = 56e36b3, 0 commits
unpushed at eee8db1; nothing deployed since 2026-09-08); entries R-DRAG, B-PYRAMID-4 + R-PYRAMID-34, C3/C4 + R-MODEL-C34.
**Left:** the B-PYRAMID-5 entry and its raster reading (after its landing, §5.26); F137's status then; FINAL-AUDIT's
corrections list and findings.
WHERE I AM: FINAL-AUDIT corrections + findings sections; then wait for the B-PYRAMID-5 landing message.

## 2026-10-06 09:40 UTC — R-FINAL-D (reviewer) — checkpoint: all but B-PYRAMID-5 done
**Done:** FINAL-AUDIT's corrections list and findings (no major; m1 stale comments, m2 `syncCameraOnly`, m3 `_camAt`,
m4 row 4's break-check unrecorded). A2 §2.11 as-built note; 00-START-HERE's branch line.
**Questions asked:** none.
WHERE I AM: waiting for the B-PYRAMID-5 landing (PLAN §5.26): then its 10-STATUS entry, F137's status, a read of its
raster changes against PLAN §5.22 items 2–3, and the report.

## 2026-10-06 09:42 UTC — R-FINAL-D (reviewer) — checkpoint: identifier check of the docs
**Done:** every backticked identifier in DESIGN §7–§10/§13 and every code-shaped name in docs/ai 20/30/40 checked against
production code by script: the only absent ones are named as deleted (`PictureLayer`, `_bakeSettled`, `_gone`,
`_buildList`, `contentOffCamera`). docs/ai 20/30/40 headers dated through the rebuild; 30's test list names the
rebuild's suites. (My earlier entries' times corrected to the clock: 09:33–09:40.)
WHERE I AM: waiting for B-PYRAMID-5's landing (PLAN §5.26; a 40-min watcher on PLAN.md).

## 2026-10-06 09:43 UTC — B-PYRAMID-5b (builder) — b8 END: scenario 7 stalled once on the tree; browser batch b10 START (the stall)
**b8 (quiet, load 1.56–1.69 at each start, one run each):** s1 out paper landed 1,401.4 | tree 14.2 ms, back in 131.3 | 0;
s6 committed 121 | 90 ms, exact 764 | 283, the inline pack coarse ℓ−1 21.8 ms | the full patch 33.8 ms; s7 `olderOther` 101.9 |
14.9 ms, `olderPatch` 1,086 | 791 — but the tree's s7 erase did not bake in 60 s (`eraseBakeMs` −1; landed 3,790 ms; the tree's
pre-stop s7 run baked): 40 strips queued [25,0,0,3,12,0], none in flight, the pool idle. jobQueue.js is unchanged since
59f0a76. F133 (`?svg`, whole drawing, forced GC): 12 events at 1,784–1,785 MB, flat; loaded 2,001, dropped 2,126; no errors.
**b10:** s7 with `bp5/h7` (the queue's `_packMs`, motion, task, free slots when the erase has not baked in 20 s, then one
kick: `frame()` + `pump()`), the tree and landed alternating, three each. Log `bp5/batch10.log`.
**Questions asked:** none.
WHERE I AM: b10 running; then the P1 test under busy loops, the quick suite, the report.

## 2026-10-06 14:23 UTC — R-FINAL-D (reviewer) — resumed after the session-limit stop (tree at 82603a4)
**State:** every edit through the 09:42 checkpoint is in the tree (FINAL-AUDIT, PLAN §3, A2 §2.11, OPEN-FLAGS, docs/ai).
B-PYRAMID-5 not landed; per the orchestrator, its part is a short last pass after §5.26.
WHERE I AM: the report without B-PYRAMID-5's part.

## 2026-10-06 14:24 UTC — orchestrator (Opus) — the ninth stop (~09:55–14:20); all three resumed
**Working on:** B-PYRAMID-5b (its b8 saw scenario 7's erase not bake in 60 s once on the tree — 40 strips queued, none in
flight, the pool idle; b10's six runs did not repeat it: told to read the queue's pump for the path, file F140, then its
last test, quick suite and report), R-FINAL-D (the audit, all but B-PYRAMID-5's part) and B-DOCMAPS-3 (the § column and
the rows; the code map pauses after it). The container rebooted (uptime 0 at 14:22); the tree clean at 82603a4.
**Measured:** nothing.
**Decisions made:** no more browser runs on the stall before the report.
**Questions asked:** none.
WHERE I AM: waiting for the three reports; R-FINAL-M after B-PYRAMID-5 lands.

## 2026-10-06 14:23 UTC — B-PYRAMID-5b (builder) — resumed after the ninth stop and reboot (tree at 82603a4)
**b10 END (before the stop):** six s7 runs with `bp5/h7`, load 0.25–1.69 at the starts: no stall — the tree's erase baked in
4,512 | 4,276 | 3,935 ms, landed 4,155 | 4,417 | 4,426. The b8 stall: 1 of 7 tree runs, 0 of 4 landed.
**Now (per the orchestrator):** no more browser runs on it — the queue's pump and frame conditions read for a path that
leaves strips queued with no pump scheduled, filed as F140; then the P1 test under busy loops, the quick suite, the report.
**Questions asked:** none.
WHERE I AM: reading `jobQueue.pump`/`_nextTask` and the renderer's pump callers for F140.

## 2026-10-06 14:23 UTC — R-FINAL-D (reviewer) — partial: report sent without B-PYRAMID-5's part
**Done:** FINAL-AUDIT.md (1.1, 1.2, 1.3 tables, the corrections, findings: no major, minors m1–m4). No suite run.
**Left:** after PLAN §5.26: B-PYRAMID-5's 10-STATUS entry, F137's status and index row, a read of its raster changes.
WHERE I AM: waiting for the orchestrator's §5.26 message.

## 2026-10-06 14:23 UTC — B-DOCMAPS-3 (builder) — resumed after the second stop (tree at 82603a4)
**Working on:** the § column (`dmap/secmap.py`: by module, DESIGN.md's current sections; its first real run refused to
write, an inserted ref did not parse — nothing written). Done before the stop: item 3 (363: 172 corrected, 191 kept), the
stale rows (`audit_stale` 0) and the rows with nothing to open (2,383 of 2,383 open).
**Questions asked:** none.
WHERE I AM: fixing `secmap.py`'s insertion, then its run, the lenient chain, and the report.

## 2026-10-06 14:28 UTC — B-DOCMAPS-3 (builder) — END: item 3, the stale rows, the § column, the rows with nothing to open
**Working on:** finished. Files: `tools/docmaps/newdesc_*.py`, `long_*.py`, `pages/boundless-code-map.pristine.html`, the
generated pages. Nothing under `src/`.
**Measured (lenient chain, `dmap/devrun.py`):** item 3 363 of 363 re-read, 172 corrected, 191 kept; `audit_stale` 0
(was 27); rows with nothing to open 0 (2,383 of 2,383 open; was 13); Code Map missing 905, all oracles (item 4);
`build_graph_page.py` refuses those 905; `graph.py` 46 hand edges naming no node and 84 not calls, `check.py` 90 (item 5).
**Decisions made:** § by what the function does, through a module → section table (`dmap/secmap.py`, run once: it is not
idempotent and refuses a second run); 811 entries and 191 of 269 pristine rows moved; the files' default refs moved too
(oracle §17 → §15, scale bar §14 → §12); the scale-bar rule rows keep their bible rung in the one-liner.
**Questions asked:** none.
WHERE I AM: done; item 4 (the oracles) and items 5–8 are the next runs'.

## 2026-10-06 14:43 UTC — B-PYRAMID-5b (builder) — end (B-PYRAMID-5 items 1–6, R-PYRAMID-34's skipped items, the measurement)
**F140 filed** (OPEN-FLAGS): by reading, `jobQueue.pump` stops at the 4-ms pack budget and schedules its next task only
when `motion.moving` is false, and `moving` is the last camera step's; at rest only `_frameStep` resets the budget, so
strips pumped after a moving last step wait for the next step. Pre-existing: `jobQueue.js`, `_pyrMotion`, `_frameStep` and
the pump callers unchanged since 59f0a76. 1 stall in 5 tree runs, 0 in 5 landed. Fix proposed, not made.
**Load-sensitive tests (`raster.pyramid`, all P1/row 1):** "the still frame…" red 2 in 10 whole-file runs beside 6–8 busy loops
("level" for "rest": the rest's inline decision by the calibrated estimate or a heavy mark) → `restInlineMs` 1e9 before the
scene (RV4's lever), 0 in 12 after. "supersedes the queued one" red in 2 multi-file runs at load 6.5–8.4, 0 in 16 alone
or in-file beside loops: assertion not captured. Row 1's pen-up groups fuzz (`seen.joins` 0) red 1 in 12 loaded runs and
in my second quick suite (started at load 5.2). Neither cause established.
**Quick suite:** 2,209 passed, 1 failed, 12 skipped twice (load 3.8→8.4: the supersede test; 5.2→3.4: the row-1 fuzz).
typecheck 0; lint 0 errors. Browser numbers in the entries above; nothing in Kobin's Chrome.
**Questions asked:** in the report (item 6's reading of DESIGN §10; F140's fix; the drop's `eng.list`).
WHERE I AM: done — the report to the orchestrator.

## 2026-10-06 14:52 UTC — orchestrator (Opus) — B-PYRAMID-5 landed; B-PYRAMID-6 (F140) launched; R-FINAL-D's last pass
**Working on:** B-PYRAMID-5 (with 5b) landed as f58d820, PLAN §5.26. F140 (filed by 5b: by reading, `pump` returns at
the pack budget while the last camera step's `moving` holds, and nothing but a step clears it — scenario 7's erase did
not bake in 1 run of 10) and the two load-sensitive `raster.pyramid` tests go to **B-PYRAMID-6** before the
measurements. R-FINAL-D resumed for its last pass (B-PYRAMID-5's 10-STATUS entry, F137's status, its raster changes
against PLAN §5.22). R-FINAL-M waits for B-PYRAMID-6; its brief now runs scenario 7 ten times on the final tree.
**Measured:** nothing.
**Decisions made:** F140 fixed before Kobin's check, not after: an erase that never bakes is the eraser failing.
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-6 and R-FINAL-D.

## 2026-10-06 14:46 UTC — R-FINAL-D (reviewer) — end: B-PYRAMID-5's part done
**Done:** 10-STATUS's B-PYRAMID-5 entry (PLAN §5.26); OPEN-FLAGS F137 FIXED (heading, dated note, index row; pipes in
the row's numbers written as "/" so the table holds); FINAL-AUDIT's B-PYRAMID-5 section (§5.22 items 2–3 and §1.2: as
designed). F140 left to B-PYRAMID-6. Nothing committed.
WHERE I AM: done.

## 2026-10-06 14:47 UTC — B-PYRAMID-6 (builder) — start: F140 (the queue stall), the two load-sensitive raster.pyramid tests
**Working on:** item 1 first — a jsdom test that ends a zoom with strips queued behind a spent pack budget and no
further step (red before), then the fix in `jobQueue.pump`. Files: `src/engine/raster/jobQueue.js` (+ its test),
`raster.pyramid.test.js`; `RasterRenderer.js` only if the fix needs it; OPEN-FLAGS F140, TEST-MAP, DESIGN §9 at the end.
**Measured:** nothing yet. Load 0.15 at start.
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: writing the red-before test in `jobQueue.test.js`.

## 2026-10-06 15:00 UTC — orchestrator (Opus) — R-FINAL-D done; B-TIDY launched beside B-PYRAMID-6
**Working on:** R-FINAL-D's audit is complete (`FINAL-AUDIT.md`: no major; every PLAN §1 target built, every §3 row's
test present, every named mechanism gone; the documents corrected; F137 marked fixed). Its source minors (stale comments
naming deleted mechanisms, `_camToLattice`'s unchecked `_camAt`, no recorded break-check for PLAN §3 row 4) go to
**B-TIDY**, in files disjoint from B-PYRAMID-6's. R-FINAL-M starts when both land.
**Measured:** nothing.
**Decisions made:** CLAUDE.md's stale test counts are left for Kobin (his file).
**Questions asked:** none.
WHERE I AM: waiting for B-PYRAMID-6 and B-TIDY.

## 2026-10-06 14:48 UTC — B-TIDY (builder) — start: FINAL-AUDIT m1, m3, m4 (stale comments, `_camAt`'s frame, PLAN §3 row 4)
**Working on:** item 1, the comments naming deleted mechanisms (`KobinEngine.js`, `selection.js`, `erasePipeline.js`,
`rasterPack.js`, `OverlayLayer.js`, `CanvasEditor.js`), each rewritten whole after reading its code; then m3's jsdom test
(red before) and fix in `_camToLattice`; then m4's break-check of `raster.familyUlp.test.js`; then the quick suite,
typecheck, lint, `build:worker`. Not in `RasterRenderer.js`, `jobQueue.js` or the raster suites (B-PYRAMID-6's).
**Measured:** nothing yet. Load 0.05 at start (container clock 14:48; the orchestrator's last entry says 15:00).
**Decisions made:** none yet.
**Questions asked:** none.
WHERE I AM: reading `KobinEngine.js` ~585 and `_endMove` ~629.

## 2026-10-06 14:53 UTC — B-TIDY (builder) — checkpoint: item 1 (m1's comments) done
**Working on:** item 1, done. Rewritten after reading the code under each: `KobinEngine.js` `_planeLost` (no "sync path":
the plane is lost when the camera leaves its frame or it has no layers, `RasterRenderer._planeStep`) and `_endMove` (no
merges: `_dropMove` records `frames` and `moves` only, A1 C3); `selection.js` `deselect` ("the hold released, nothing
written"); `erasePipeline.js` `_registerMark` (covered frames leave the lattice, `Document.removeFrameSubtree`, one bake
step each); `rasterPack.js` the quantum wording (memo per quarter octave of the job's `Zq`; also "Four rules" → five, the
F130 line's "sync path", "Two quanta", `Renderer.js:579`); `OverlayLayer.js` 22/491 (repaint on `Zq`/`mode` change, as
`show()` does); `CanvasEditor.js` DevLevers (`setLevers` applies at once: every lever is read from `cfg` on the raster path).
**Measured:** nothing (comments only).
**Decisions made:** long comments whose reasoning is still true keep it; only the false phrase is rewritten, so each
reads as written for today's code. `packJob`'s `q` is documented as carried and unread (no code change: out of brief).
**Questions asked:** none. Not mine, seen: `Stage.js:698,1210` and `TileStore.js:602` "set aside"; `curveOutline.js:428`
"zoom quantum".
WHERE I AM: item 2, finding the model test file that owns the camera's lattice rules and reading `_camToLattice`.

## 2026-10-06 14:53 UTC — B-PYRAMID-6 (builder) — checkpoint: F140 fixed in jobQueue (tests red before)
**Working on:** item 1. Files: `src/engine/raster/jobQueue.js`, `jobQueue.test.js`.
**Measured:** two new `jobQueue.test` tests red before (the real-timer one: 3 of 6 sent, no cut, after 1,006 ms; the
fake-clock one: no task asked for while moving), green after (the stalled strips go 51 ms after the zoom ends).
**Decisions made:** not the proposal alone (a motion read as rest once old): a pump that stops at the budget *inside*
the window (a cut landing 10 ms after the last step) with nothing after it still stalls. Instead the budget always asks
for the next task; while moving it is timed `MOTION_STALE_MS` (50) after the last step and starts the budget only if no
moving step came since (a newer one re-arms it; the step started the budget). The old budget test expected no task while
moving: now 1 (the backstop).
**Questions asked:** none.
WHERE I AM: raster suites, then break-checks on a copy (scratchpad), then item 2.

## 2026-10-06 14:57 UTC — B-PYRAMID-6 (builder) — checkpoint: F140 break-checks; item 2 starts
**Measured:** raster suites 35 suites, 592 passed (load 1.3–2.5). Break-checks on the unimported copy `bp6/bc`
(`bp6/bc.py`, `jobQueue.test`): no backstop (the old budget branch) 3 red of 12 — and 0 of 79 in `raster.pyramid`,
`raster.engine`, `raster.snapshot` (why F140 was invisible); the task starts the budget despite a newer moving step 1 red;
no re-arm 2 red (the real-timer test too: its 3 quick steps); no delay (`ms = 0`) 1 red.
**Decisions made:** none new.
**Questions asked:** none.
WHERE I AM: item 2 — the supersede test (raster.pyramid:145) under 3 busy loops; docs for F140 at the end.

## 2026-10-06 15:00 UTC — B-TIDY (builder) — checkpoint: item 2 (m3, `_camAt`'s frame) fixed, break-checks running
**Working on:** m3. Test `select.detachedFrame.test.js` DF-5 (the file owning "a deleted subtree leaves the lattice"
and the camera's fresh frame, DF-3): camera in G (depth 1, noted by a render), F = G's child with ink, F selected,
`cfg.frames = "raf"` (the app's), a zoom crossing into F, `deleteSelection()` inside the same frame. Red before:
`Expected: not "0/13,9"` (the camera put at G with F's coordinates) — so the path IS reachable in the app (a crossing
and a Delete inside one animation frame), not "no known path". Fix `KobinEngine.js:295`, the audit's line (fields `F`,
`root`, `chain` as named); the doc comment rewritten whole. Green after: detachedFrame 5/5, coresident 13/13.
**Measured:** the two files above, 18/18 after the fix.
**Decisions made:** the fallback stays the existing one, `ensureSpine(activeLevel || 0)`: a deleted frame has no
depth, so it is the depth-0 spine — a bigger jump than the old wrong one when G is deep (question below).
**Questions asked:** should `_camAt` be noted at every crossing (the Camera's `onCross` hook, a no-op today) so the
camera keeps its cell, as A1 says? Recommendation: yes, a later small task; not built (the brief names the guard).
WHERE I AM: break-checks (a) the guard, (b) rasterCore's family grouping for `raster.familyUlp`, on a scratch copy.

## 2026-10-06 21:33 UTC — B-PYRAMID-6 (builder) — resumed after the session-limit stop (container rebooted)
**Working on:** item 2. Tree at 7f30fa1 holds item 1 (F140 fix, tests, DESIGN §9 sentence). Before the stop: 3+3 loaded
runs (3 busy loops, raster.pyramid + PicturePyramid.patch + raster.engine): neither target test red; a third
load-sensitive test red once at load 4.8 — `raster.engine` "§8.4 rule 2" residual 4.6 ms against its 1-ms bar (a
synchronous render row: preemption, not the queue). Reading: the row-1 join needs the first pen-up group open at the
second pen-up — an inline patch (`patchPlan`: T <= budget, the calibrated estimate) closes it at once.
**Measured:** load 0.4 at resume. **Decisions made:** none new. **Questions asked:** none.
WHERE I AM: reading `patchPlan` budget/estimate for the row-1 join, then loaded runs of raster.pyramid alone.

## 2026-10-06 21:34 UTC — orchestrator (Opus) — the tenth stop (~15:05–19:20); B-PYRAMID-6 and B-TIDY resumed
**Working on:** B-PYRAMID-6 (F140 fixed in `jobQueue.js` with tests red before and four break-checks; the two
load-sensitive tests next) and B-TIDY (the comments done; `_camToLattice`'s frame check fixed — reachable in the app: a
crossing and a Delete inside one animation frame put the camera at the parent's chain with the child's coordinates, DF-5
red before; the break-checks next). The container rebooted (uptime 0 at 21:31); snapshot 7f30fa1. Both resumed. B-TIDY's
question (note `_camAt` at every crossing so a deleted frame's camera keeps its cell): a later small task, recorded.
**Measured:** nothing.
**Decisions made:** as above.
**Questions asked:** none.
WHERE I AM: waiting for both reports; then R-FINAL-M.

## 2026-10-06 21:35 UTC — B-TIDY (builder) — resumed after the stop (tree at aa34dd1, my edits in 7f30fa1)
**Working on:** what is left: item 4 (quick suite at load < 2, typecheck, lint, `build:worker` md5s), then the report.
**Measured (before the stop, scratch copy, output survived the reboot):** (a) the `_camAt.F === F` guard undone: 1 of
18 red (detachedFrame + coresident; unbroken 18/18); (b) item 3, `rasterCore.renderPlate`'s family grouping (the
`while … === fam) last++` line) removed: `raster.familyUlp` 5 of 7 red (unbroken 7/7) — green: the whole-pixel edge and
the opaque overlap/gap, where two families composite to the same bytes. Recorded in TEST-MAP's row (in 7f30fa1).
Pre-stop: typecheck 0, lint 0 errors (5 warnings, none in my lines). Load 0.37 at resume.
**Decisions made:** the onCross note is a follow-up (orchestrator's answer), not built.
**Questions asked:** none.
WHERE I AM: naming (a)'s red test on the copy, then the quick suite.

## 2026-10-06 21:37 UTC — B-PYRAMID-6 (builder) — checkpoint: item 2, both causes named, both tests levered
**Measured (probes on the copy `bp6/bc`):** row-1 join fuzz — 49 pen-ups unloaded: 40 patch inline (T median 1.15 ms
against `patchUserMs` 16) and close their group at once; joins 8 come only from the ~9 groups left open (to the workers
or waiting for missing cells); 4 loaded runs (3 busy loops, 1.6–3.9): joins 8, 6, 9, 4, the path different each run.
With `patchUserMs` 0 around the pair: joins 22, 25, 22 (load 4.0–5.1). Supersede — the rest posted at once
(`restInline` never, quiet 0): red at "planned again" (`pushed` 12, wanted > 12; 2 rest strips queued); the base run
ends its loop with the rest's 100-ms timer still pending; `restInlineMs` 1e9: green, gen 0 → 5.
**Decisions made:** test levers, not code: the prefetch waiting for the rest and an inline group patch are designed.
**Questions asked:** none.
WHERE I AM: whole-file runs of raster.pyramid (loaded, 3 loops), then item 3 (quick suite, typecheck, lint, docs).

## 2026-10-06 21:38 UTC — B-TIDY (builder) — END: FINAL-AUDIT m1, m3, m4 done
**Working on:** done. Item 1: the stale comments rewritten (`KobinEngine.js` 586, 629; `selection.js` 609;
`erasePipeline.js` 510; `rasterPack.js` 7, 15, 163, 261, 517, 613, 714, 717, 729, 947, 1287, 1308; `OverlayLayer.js` 22,
490; `CanvasEditor.js` 85). Item 2: `_camToLattice` guarded (`KobinEngine.js:295`), `select.detachedFrame` DF-5 (red
before: the camera at `"0/13,9"`, the frame it left); A1's camera paragraph and PLAN §5.25 item 4 corrected. Item 3: in
TEST-MAP (`raster.familyUlp`'s row; DF-5 added to `select.detachedFrame`'s).
**Measured:** break-checks on a scratch copy: the guard undone, 1 of 18 red (DF-5, named by a verbose re-run); the
family grouping removed, `raster.familyUlp` 5 of 7 red. Quick suite (start load 0.67; 1-min load 1.2–5.3 during it,
jest processes 5–12, so B-PYRAMID-6 may have overlapped at two samples): 196 of 201 suites passed (5 skipped), 2,213
passed + 12 skipped of 2,225, 189.9 s. Typecheck 0 errors; lint 0 errors (5 warnings, none mine). `build:worker`
exit 0; md5s unchanged, as expected for comment-only edits: raster-worker 432c239e…88738d, scene-worker dce304b8…2d93.
**Decisions made:** the fallback stays the depth-0 spine; `packJob`'s `q` documented as unread, not removed.
**Questions asked:** none open. Follow-up (orchestrator's answer): note `_camAt` at every crossing (`onCross`).
WHERE I AM: done; report sent.

## 2026-10-06 21:40 UTC — B-PYRAMID-6 (builder) — checkpoint: item 3 running
**Measured:** raster.pyramid + jobQueue whole files under 3 busy loops: 50 of 50 passed in 3 runs (load 5.0–5.7).
typecheck 0 errors; lint 0 errors (5 warnings, none in my files). Docs done: OPEN-FLAGS F140 (fixed, row + entry),
TEST-MAP (jobQueue and raster.pyramid rows), DESIGN §9 (the 50-ms rule, in 7f30fa1).
**Decisions made:** none new. **Questions asked:** none.
WHERE I AM: the quick suite started 21:39 at load 1.6 (`bp6/quick.log`); then the end entry and the report.

## 2026-10-06 21:43 UTC — B-PYRAMID-6 (builder) — end: F140 fixed, the two load-sensitive tests levered
**Measured:** the quick suite 2,213 passed, 0 failed, 12 skipped, 196 suites (21:39–21:42, load 1.6 → 3.5, nothing
else running); typecheck 0; lint 0 errors. Item 1 and 2 numbers in the entries above (14:53, 14:57, 21:37, 21:40).
**Decisions made:** F140 by a timed task, not the staleness reading alone (why in OPEN-FLAGS F140); both tests by
levers already used elsewhere (`restInlineMs` 1e9, `patchUserMs` 0), since the code paths they hit are designed.
A third load-sensitive test seen once: `raster.engine` "§8.4 rule 2" (residual 4.6 ms against 1 ms, load 4.8) — reported.
**Questions asked:** in the report.
WHERE I AM: done — the report to the orchestrator.
