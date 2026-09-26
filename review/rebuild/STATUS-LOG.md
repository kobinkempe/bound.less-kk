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
