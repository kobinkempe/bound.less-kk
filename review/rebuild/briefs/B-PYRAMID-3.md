# B-PYRAMID-3 — the brief (2026-09-29, orchestrator): the SVG renderer's demotion

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19).
**Scratch:** `<scratchpad>/bp3/`.

**Read, only the parts named:** `CLAUDE.md`; `DESIGN.md` §9 (the SVG renderer's paragraph and the raster layers' list),
§7's pending-mark paragraph; `review/rebuild/PLAN.md` §0 (decision 6), §1.5, §3 row 2, §5.7 item 5, §5.8 item 2,
§5.14 items 1 and 3; `review/rebuild/A3-pyramid.md` §3.6 and §7 (whole); `review/rebuild/TEST-MAP.md` (the `Renderer.*`,
`Renderer.liveChunk`, `raster.liveHold`, `raster.translucent` rows); `src/engine/Renderer.js`'s method list (`grep -n
'^    [a-zA-Z_]*('`) and A3 §7.1's table of what `RasterRenderer` uses from it; `RasterRenderer.js`'s constructor,
`addLive`/`_releaseHeldLive`, `_syncWorldTransform`, `destroy`, `setSize`; `src/engine/eraseRule.js` (69 lines);
`src/storage/thumbnails.js` (`withSvgEngine`) and the export in `src/hooks/useKobinEngine.js` (~860–880).

## 1. What B-PYRAMID-3 is

Decision 6: the SVG renderer is kept only for the comparison view (`?svg`) and the export. A3 §7, as PLAN §1.5 states it:

- **`SvgLayer`** (one Two.js instance, z 1): a `world` group with the view's transform, a screen group for the lasso,
  the two debug groups, `update()`; it owns the SVG element's lifetime.
- **`LiveStrokeLayer`** in `SvgLayer.world`: `begin(o)`, `arcs(gaps)`, `hold(id)`, `release(id)`, `cancel()` as A3 §7.2
  lists them — the tail plus frozen chunks of `liveChunk` anchors, one origin re-chosen at the view centre, one
  writer, the opacity on the root (D-1), held paths re-anchored by the origin's move (F131); `release(id)` is what the
  pen-up group commit calls in the task that shows the stroke's plates (built in P2 as `_pyrLive`: move it here).
- **One shared overlay module** both renderers call: the lasso, `_renderTileDebug`, `_renderEraseDebug`, the
  chevrons (`_renderSelChevrons`, `_mkSelLayer`, `_ensureSelStyle`) — one implementation each (rule 3).
- **`RasterRenderer` becomes a plain class** composing `[PicturePyramid (z 0), SvgLayer (z 1), OverlayLayer (z 2),
  bl-sel-edges (z 3)]`, walked by `setSize`, `destroy` and the store's release; it stops extending `Renderer`.
  `ensureOutline` moves to the engine (it is `geometry/curveOutline`'s `strokeLoops`); the fat gate is SVG-only.
- **`Renderer`** keeps the Two.js ink path for `?svg` and the export (A3 §7.3) and reads its items from the Stage
  (`stage.items()` at the Stage's generation), so `listFor` and its off-camera branch go (PLAN §5.7 item 5): one list
  source for both renderers; with them `warmReads`/`_warm`/`clearWarm` unless the measurement of §2 item 5 keeps them.
  `Renderer` loses the raster seams (`_ovOrigin`, `setDragState`, `setPlaneState`, `endMove` stubs).
- **A pending mark in the SVG renderer** (PLAN §5.8 item 2): masked per target by the same rule (`eraseRule.underMask`)
  — an SVG mask or clip from the mark's shape applied to its masked targets' groups — instead of white ink at the
  mark's z; and the export and the thumbnails run the erase barrier first (`flushErases`), so no pending mark reaches
  an export.
- **The SVG path's retention** (the C1 review: ~57 MB kept per drag event on the dense scene, the tab crashing at the
  third event at 2.8 GB): grep `docs/OPEN-FLAGS.md` for the symptom, file it as a flag if none exists, and fix or bound
  it in the demotion (the per-object groups or the retained scenes are the suspects; measure with a forced GC as the
  C1 reviewer did: `scratchpad/r-model/svgdrag.js`).
- **The hook's gate** keeps its meaning: raster by default, `?svg` (or `?raster=0`) the SVG renderer, `setRaster`
  rewriting the URL; `thumbnails.withSvgEngine` and the export unchanged in shape (`raster: false`).

**Done means** (rule 14): `RasterRenderer` extends nothing; `listFor` and the dead warm reads are gone unless measured
needed; no overlay is drawn by two implementations; the SVG mask rule and the export barrier are in; the retention is
filed and fixed or bounded with the number; TEST-MAP's rows ported (`Renderer.liveChunk` → `LiveStrokeLayer`;
`raster.liveHold` under the new name; `Renderer.*` kept); the docs true (DESIGN §9, `docs/ai/20-`/`30-`/`40-`, PLAN
§1.5, A3 §7's dated notes, OPEN-FLAGS).

## 2. Order, with checkpoints (an entry each; the orchestrator snapshot-commits)

1. `SvgLayer`, `LiveStrokeLayer`, the shared overlay module, `Renderer` reading the Stage (the SVG path only, no
   `RasterRenderer` change yet); the `?svg` round trip in the harness pixel-identical to before (a frozen copy of the
   tree before your change on one port, your tree on another; `git archive`).
2. The SVG mask rule for a pending mark and the export barrier, with tests (a pending mark over a target and an
   object dragged under it: the target masked, the dragged object visible; an export with a pending mark equals the
   export after the bake).
3. The retention: the measurement before, the fix or the bound, the measurement after, the flag's note.
4. **Only after the B-PYRAMID reviewer's end entry** (grep `reviewer (B-PYRAMID review) — .* — end` in the STATUS-LOG;
   the orchestrator also tells you): `RasterRenderer` composed, not inherited; `ensureOutline` to the engine; the fat
   gate SVG-only; `listFor`/warm reads deleted per §5.14 item 1's measurement; the raster suites that touched the
   inheritance re-run. Until then, `RasterRenderer.js` and the raster modules are the reviewer's: do not edit them.
5. The docs; the quick suite; typecheck; lint; the bundles if a bundle input changed; the end entry; the report.

## 3. Acceptance — measured (rule 5)

The `?svg` round trip and the raster round trip pixel-identical before and after (the harness on frozen copies, load
printed); the SVG mask rule's tests; the export barrier's test; the retention number before and after with the forced
GC; break-checks (rule 13) for the mask rule, the barrier, the one-writer live layer, the release-in-the-same-task rule;
the quick suite green but for named failures; typecheck 0; lint 0 errors. Nothing in Kobin's Chrome: say so.

## 4. Files

Yours: `src/engine/Renderer.js`, new `src/engine/raster/SvgLayer.js` and `LiveStrokeLayer.js` (or under `src/engine/`
if the layering lint wants them beside `Renderer`), the new shared overlay module, `src/hooks/useKobinEngine.js` (the
gate, the export), `src/storage/thumbnails.js`, `sceneOps.js`'s export path, the `Renderer.*` suites, TEST-MAP's rows,
DESIGN §9, `docs/ai/`, A3 §7, OPEN-FLAGS' SVG flag; **from item 4 on**: `RasterRenderer.js`, `OverlayLayer.js` and the
raster suites that touch the inheritance. Shared with the B-PYRAMID reviewer until it ends (it is in
`RasterRenderer.js`, the raster modules, `MovePlane.js`, `rasterWorkerClient.js`, `eraseWorkerClient.js`, the harness,
DESIGN §9, `docs/ai/`, OPEN-FLAGS' renderer flags — re-read each shared doc before an edit, own sections only) and with
nobody else: `KobinEngine.js` (`ensureOutline`, the calls to the seams), `Stage.js` (read only), `erasePipeline.js`
(the export barrier's call). Ports 3020–3029 (Node 14 via nvm). Every commit is the orchestrator's with `[skip ci]`.

## 5. Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, `testsRun`, `measurements`, `decisions`, `leastSure` (≥ 3), `questions` with
recommendations, `openItems` (B-DRAG's, wave 3's).
