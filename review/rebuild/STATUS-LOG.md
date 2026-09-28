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
