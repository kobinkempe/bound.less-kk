# tools/harnesses — browser measurement pages

Static pages opened directly in a browser (`file://` or any static server) to
measure something the Jest suite cannot see. None of them is part of the app,
and none is bundled: they lived under `public/` until 2026-09-02, where Create
React App copied them into `build/` and every deploy shipped them.

| page | what it measures | flag |
|---|---|---|
| `hairline/index.html` | stroke vs filled sliver vs filled cubic loop, **canvas-measured**. Useful only as the negative control that shows a canvas rasterisation cannot see the compositing failure. | F-Z |
| `hairline/chrome.html`, `chrome2.html`, `chrome3.html` | live-DOM grids of thin filled paths, for screenshotting in real Chrome and magnifying. This is how the dead zone near 0.165 px was found. | F-Z |
| `ants-measure.html` | the selection indicator's marching-ant construction, stripped to the pieces that affect ant geometry, so dash and band sizes can be read off at several zooms. Derived from `design-system/components/selection/`. | — |
| `bigpath.html` | one arc at a huge on-screen radius under the renderer's own transform, as the shipped plan (`plan`: the arc command while its float32 centre fits a quarter pixel, else the cubics the sixth-root law demands), as the fixed 22° rule tried first (`auto`), as an SVG `A`, or as quarter-turn cubics. `__matrix()` runs the radius × sweep grid by hit-testing, which is fine for arcs and **wrong for flat cubics** (Blink's float32 winding solve); `__paintCheck()` is the one to trust: the true edge drawn in screen space under `mix-blend-mode: difference`, so any disagreement is a sliver whose height is the error, against 1–16 px bars. `__lineCheck({ half, k, seg })` is the coordinate floor on a 45° line with far ends, with and without the renderer's length split. This is where the arc's 2^-24-of-the-radius law and the cubic's θ⁶ law were measured — and where Chrome's raster was caught dropping a path of 32 far-away cubics at full scale that it paints at half scale and as lines (set `path.d` to the renderer's own `d` and vary the transform). | F40 |

The rule these exist to enforce is rule 3 in `docs/ai/00-START-HERE.txt`:
anything about paint is measured in a real browser, never by rasterising the
SVG to a canvas.

## Probes in `src/engine/*.probe.js` — measurement harnesses that are not tests

Jest files that the suite does not run (`*.probe.js` is outside CRA's test
match) because what they measure is an OPEN defect or a number, not a pass. They
need the Jest environment (the engine in jsdom, the testkit), so they live
beside the tests and run one at a time:

```bash
npx react-scripts test --watchAll=false --testMatch "**/depth.corner.probe.js"
```

| probe | what it measures | flag |
|---|---|---|
| `depth.corner.probe.js` | Kobin's corner-invalidation scenario: a stroke's corner descended to level 8, the pieces every level 3–8 holds recorded bit for bit, a 12-px nick at level 3 nearby, and the per-level comparison after (incremental tile update vs full rebake too; `worst` names the number that differs most). Also eight nicks at levels 1–4 at a moderate zoom. Since 2026-09-06 (F43's canonical pieces plus F44's one-radius freeze) all three cases PASS `expect(same)`: every one descends to level 8 without losing the edge (the two arc cases lost it at the fifth crossing until the gate) and is bit-identical there after the nick, the edge's screen position identical to the last digit. The morning-of-2026-09-05 numbers, for the record: 3.7e-5 units at 5, 0.083 at 6, 342 at 7, the tile empty at 8. It stays a probe because its value is the per-level printout. | F43, F44, F46 |
| `perf.scale.probe.js` | costs against stroke count: N random scribbles, then per-stroke draw time split into renders and bake, cold and warm render, in-level zoom and pan, a crossing, an erase across the middle, a lasso and a drag step. jsdom timings; the exponent is what to read (2026-09-05: per pen-up ∝ N, so a session is quadratic). | ROADMAP performance |
| `memory.census.probe.js` | the heap by structure, with a forced GC (`v8.setFlagsFromString` + `vm`): unit costs measured by cloning a real arc piece, line piece, point and Two.js anchor (100k each, parked on a module object so liveness analysis cannot collect them mid-reading), then the live heap after load and after render, the counts (objects, pieces, loops, anchors, tile pieces, undo retention) and the cost of `serializeDrawing` plus its JSON string. `MEM_EXPORT=<kobin-1 json>` loads a real drawing (export one from a tab with `E.serializeDrawing({})`); otherwise `MEM_N` scribbles. Run with `--runInBand` and `--max-old-space-size`. 2026-09-08 on Kobin's canvas: 721 MB live, 344 B an arc piece. | ROADMAP memory |
| `erase.stuck.probe.js` | a drawing's pending eraser marks ticked by hand (`MEM_EXPORT`, `STUCK_TICKS`): per tick which target each mark is on, per bake the target's pieces and ms by path (cut / rehome), the slowest bakes, the journal's refusals; `STUCK_PROFILE=1` times the parts of one cut (project, subtract, intersect, components, dust) on the biggest targets. 2026-09-08 on Kobin's export: the marks were starved by a scan of every object (0.6 ms each), then a 641-piece object under a 1,205-piece eraser took 2.6 s a boolean — 175 ms after `RayIndex`. | F57 |
| `erase.report.probe.js` | replays a report's eraser gestures on a report's snapshot (`REPORT_SNAP`, `REPORT_JOURNAL`, `REPORT_FRAMES` for frames minted later, `ERASE_IDS`; `RAY_INDEX=0` for the flat classifier, `CAND_DUMP=n` to print each candidate's stored box, its picture at the mark's frame and the eraser mapped into it): per bake the target, the path, the job's verdict and the regions' areas, every refusal and the descent's steps (parents, kids, levels). Found F66 in an hour from three reports. | F66, F57 |
