# -*- coding: utf-8 -*-
"""Per-function entries for the raster path's selection-indicator canvas (raster/OverlayLayer.js),
the ant painter (raster/antPaint.js) and the raster performance ring (raster/rasterPerf.js)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/raster/OverlayLayer.js ----
add("ovy.snapPx", "snapPx(x)",
    "Rounds a device-pixel size to a whole pixel, the rule `PictureLayer` uses, so the ant canvas and the ink canvas are the same size.",
    ["-"], "§9")
add("ovy.mkCanvas", "mkCanvas(w, h)",
    "The default canvas factory: a `<canvas>` with the given backing size, or null where there is no document.",
    ["The constructor's `makeCanvas` option replaces it; the suite injects one, because jsdom's canvas has no 2-D context."])
add("ovy.mkImageData", "mkImageData(data, w, h)",
    "Wraps a buffer's own pixel array in one `ImageData`, built per resize and never per blit; null where it cannot be made.",
    ["Null when `ImageData` is absent (jsdom has no such global), when the size is empty, or when the constructor throws. The layer counts that as `noImageData`, and `blit` then writes nothing."])
add("ovy.now", "now()",
    "The layer's default clock: `performance.now()`, or `Date.now()` where there is none.",
    ["-"])
add("ovy.prefersReducedMotion", "prefersReducedMotion()",
    "Reads the OS's `prefers-reduced-motion: reduce` setting; false where `matchMedia` is absent.",
    ["Read once at construction when `opts.reducedMotion` is not given. Later changes arrive through `setReducedMotion`, whose media listener the renderer owns."],
    "§9")
add("ovy.OverlayLayer", "OverlayLayer",
    "The raster path's selection-indicator canvas: a screen-sized ant plane, four screen-edge strips and the crawl clock.",
    ["Built by `RasterRenderer._makeOverlay` on the first selection decision and pushed onto the renderer's `_layers`, so `setSize`, the plate store's release and `destroy` reach it. `show` takes the decision from `overlays._selectionAnts` (runs and marks as render-list pieces in frame units) and `PictureLayer`'s published view, paints through `antPaint.paintPhase`, and never reads the ink canvas.",
     "The plane is painted at the view of the moment and the canvas carries only the delta to the current view as a CSS transform (`s = k/k0`, translate `(t − t0·s)/dpr`), so a camera step between repaints is a style write. The canvas sits at z-index 2, above the ink and the Two.js `<svg>` and under the chevrons' SVG.",
     "Nothing in it is measured in jsdom: `getContext` returns null there and there is no `ImageData`, so the suite injects both; the compositor's cost is a browser measurement."],
    "§9")
add("ovy.OverlayLayer.constructor", "OverlayLayer.constructor(host, opts)",
    "Records the host, CSS size, dpr, reduced-motion setting and injected factories and clocks; allocates no canvas and no plane.",
    ["The canvas is made by `_mount` and the plane by `_ensurePlane`, both on the first `show`, so a tool change never pays for the plane. The view objects, the edge pseudo-runs and the `report()` object are created here once and mutated in place from then on.",
     "`opts.perf` is `rasterPerf` (the renderer passes its own `perf`); every crawl tick hands it `report()`."],
    "§9")
add("ovy.planeW", "planeW (getter)",
    "The plane's width in device pixels: CSS width × dpr, rounded.", ["-"], "§9")
add("ovy.planeH", "planeH (getter)",
    "The plane's height in device pixels: CSS height × dpr, rounded.", ["-"], "§9")
add("ovy._style", "_style(c, cssW, cssH, z)",
    "Places one overlay canvas absolutely at the host's top-left, with `transform-origin: 0 0`, no pointer events, the given z-index and CSS size.",
    ["The `0 0` origin is what makes `setTransform`'s `(s, dx, dy)` the delta between two views."],
    "§9")
add("ovy._mount", "_mount()",
    "Creates the ant canvas once, at the plane's device size and z-index 2 with `will-change: transform`, and takes its 2-D context.",
    ["Returns the existing canvas on later calls, or null when no canvas can be made, in which case `show` does nothing. The canvas carries class `bl-overlay` and `aria-hidden`.",
     "Whether the compositor then moves it without a repaint is a browser question; jsdom cannot answer it."],
    "§9")
add("ovy._mountStrips", "_mountStrips()",
    "Creates or resizes the four screen-edge strip canvases, each with its own `OverlayBuffer` and `ImageData`.",
    ["Left and right strips are the plane's height and top and bottom its width, each `max(2, ceil((ANT_LOOK.W + 1)·dpr))` device px thick: the band's width plus a pixel of ramp, taken in CSS px so a high dpr does not clip it. The right and bottom strips sit at the far edges. A strip whose size is unchanged is left as it is.",
     "Writes `stripBytes` on the report, which names the strips apart from the plane."],
    "§9")
add("ovy._ensurePlane", "_ensurePlane()",
    "Allocates the plane on first use and again only when its device size changed, then brings the four strips to size.",
    ["Each allocation builds a fresh `ImageData` over the new array, counts in `allocs` and marks the plane dirty, so the next `show` or tick repaints. `hide` never frees the plane; `onStoreRelease` and `destroy` do."],
    "§9")
add("ovy._attach", "_attach()",
    "Appends the ant canvas and the four strips to the host, once, and marks the layer shown.",
    ["-"], "§9")
add("ovy._detach", "_detach()",
    "Removes the ant canvas and the strips from the DOM and marks the layer hidden; the plane and the buffers are kept.",
    ["-"], "§9")
add("ovy.setTransform", "setTransform(s, dx, dy)",
    "The one writer of the ant canvas's CSS transform: a uniform scale `s` about its top-left and a translate in CSS px.",
    ["Also records the transform in `_t`, which `_uncoveredPx` reads, and counts `transforms` on the report. The strips are never transformed."],
    "§9")
add("ovy._applyTransform", "_applyTransform()",
    "Writes the delta from the view the plane was painted at to this step's view: `s = k/k0`, translate `(t − t0·s)/dpr`.",
    ["The paint-time view composed with this transform equals the published `k, tx, ty`, so a camera step between repaints moves the plane without painting it. A paint view whose `k` is not finite gives a scale of 1."],
    "§9")
add("ovy._readView", "_readView(view, dec)",
    "Copies the published view into the painter's view and adds the drag offset, rounded to whole device pixels.",
    ["The view maps frame units to device px (`p·k + t`) with no origin in it. `dec.off` is the drag in CSS px; rounding it makes a drag between repaints an integer translate that cannot resample the plane."],
    "§9")
add("ovy._paint", "_paint(phase, repaint)",
    "Paints one crawl phase of the held decision into the plane at the current view, resets the transform to identity and blits.",
    ["Ensures the plane first, records the paint view in `_paintAt`, and copies `paintPhase`'s dashes, stamps, pixels and time into the report. `repaint` counts a repaint, and one made while the crawl is frozen also counts in `repaintsDuringGesture`. Clears the dirty flag and `uncoveredPx` and stamps `_lastRepaintAt` for the uncovered-screen throttle."],
    "§9")
add("ovy.blit", "blit(rect)",
    "The only path from the plane's buffer to its canvas: one `putImageData` of a device-pixel rect, by default what the last paint changed.",
    ["`rect` is integers, half-open, clamped to the plane; an empty one writes nothing, so a caller that wants the whole plane passes it. Returns the pixels written and records `blitMs` and `blitPx`. Without a context or an `ImageData` (jsdom) it writes nothing and returns 0."],
    "§9")
add("ovy._paintEdges", "_paintEdges(dec, shift)",
    "Paints the screen-edge runs into the four strips at the body's own phase index and blits each strip's changed rows.",
    ["Each span of `dec.edges` becomes a one-line pseudo-run inset from its side by half the band (`ANT_LOOK.W·kt/2` CSS px). The spans are camera-screen CSS px moved by `shift`, the renderer's camera-to-published-view offset; the inset is a screen quantity and is not shifted.",
     "The strips are untransformed and repainted on every call, because an edge run is anchored to the screen and would slide off it in the transformed plane. Records the dashes as `edgeDashes`."],
    "§9")
add("ovy._edgeRun", "_edgeRun(i)",
    "The i-th reusable edge pseudo-run, one open line piece, created on first use and kept.",
    ["-"], "§9")
add("ovy._arm", "_arm()",
    "Starts the crawl timer, one tick every `ANT_STEP_MS` (50 ms), when the layer is shown with a decision and reduced motion is off.",
    ["The timer re-arms itself after each `step`; one already armed is left alone."],
    "§9")
add("ovy._disarm", "_disarm()",
    "Cancels the crawl timer and the pending resume timer.",
    ["-"], "§9")
add("ovy.freeze", "freeze()",
    "Holds the crawl's phase and restarts a timer that resumes it `SEL_CRAWL_RESUME_MS` (150 ms) later.",
    ["`show` calls it on every call, camera step or not, so the ants stand still while the camera moves and crawl again 150 ms after the last step. A frozen tick still repaints an uncovered screen."],
    "§9")
add("ovy.resume", "resume()",
    "Lets the crawl advance again; the resume timer's callback.",
    ["-"], "§9")
add("ovy.step", "step()",
    "One crawl tick: advances the phase and paints it, or while frozen only checks for an uncovered screen; either way it notes a crawl row.",
    ["Does nothing when there is no decision, the layer is hidden or reduced motion is on, so the tick itself honours reduced motion and not only the timer. The phase cycles through `ANT_PHASES` (8)."],
    "§9")
add("ovy._note", "_note()",
    "Hands the layer's `report()` to `rasterPerf.noteCrawl`, which records the tick as a crawl row of its own.",
    ["-"], "§15")
add("ovy._uncoveredPx", "_uncoveredPx()",
    "Device pixels of the screen that the transformed plane no longer covers.",
    ["The plane is exactly the screen, so a pan or a zoom-out delta uncovers a strip whose ants it never held. Computed from the last transform written."],
    "§9")
add("ovy._maybeUncovered", "_maybeUncovered()",
    "While part of the screen is uncovered, repaints at the current phase at most once per `OVERLAY_UNCOVERED_MS` (150 ms).",
    ["Records `uncoveredPx`, counts `uncoveredFrames` and keeps the worst uncovered fraction in `uncoveredWorst`, the numbers the constant is to be judged by. It runs on frozen ticks and on `show` calls that did not repaint."],
    "§9")
add("ovy.show", "show(dec, view, shift)",
    "The entry per camera step or decision change: mounts and attaches the layer, then repaints in the same turn or writes the delta transform alone.",
    ["A missing or empty decision, or no view, hides the layer. It repaints when the decision key, the thin-mark scale (`selAntScale(dec.inkPx)`), the view's quantum (`q`, `Zq`) or mode changed, or the plane is dirty; otherwise it writes the transform from the paint view. Then it freezes the crawl, arms the clock, paints the edge strips and, when it did not repaint, checks for an uncovered screen.",
     "`view` is `PictureLayer.view()`, the published mapping, never the camera. The caller is `RasterRenderer._renderSelOverlay`."],
    "§9")
add("ovy.hide", "hide()",
    "The selection went away or the tool changed: stops the clocks, detaches the canvases and forgets the decision, keeping the plane.",
    ["Keeping the plane means a tool change does not reallocate it; `onStoreRelease` and `destroy` are what free it."],
    "§9")
add("ovy.setSize", "setSize(cssW, cssH, dpr)",
    "A resize or dpr change: resizes the canvas, reallocates the plane and strips once and, if shown, repaints once.",
    ["Returns false and does nothing when the size and dpr are unchanged. Reached through the renderer's `_layers` walk."],
    "§9")
add("ovy.onStoreRelease", "onStoreRelease(reason)",
    "The plate store's release on a hidden tab: drops the plane's and the strips' buffers, so the next show or tick reallocates and repaints.",
    ["The canvases stay mounted. Reached through `RasterRenderer._onStoreRelease`'s `_layers` walk; returns `reason`."],
    "§9")
add("ovy.destroy", "destroy()",
    "Tears the layer down: stops the clocks, detaches and drops the canvases, the plane, the strips and the decision.",
    ["Called from `RasterRenderer.destroy` through its `_layers` walk."],
    "§9")
add("ovy.setReducedMotion", "setReducedMotion(v)",
    "Switches reduced motion: on, it stops the clocks and paints once at phase 0; off, it re-arms the crawl.",
    ["The renderer owns the media-query listener (`_armReducedMotion`) and calls this on each change."],
    "§9")
add("ovy.noteDecide", "noteDecide(ms)",
    "Records the selection decision's time, which the renderer measures, as the report's `decideMs`.",
    ["-"], "§15")
add("ovy.report", "report()",
    "The layer's one report object, mutated in place: per-tick paint, blit and dash numbers and cumulative repaint, uncovered and allocation counters.",
    ["`bytes` is the plane's alone and `stripBytes` the strips'. `rasterPerf.noteCrawl` reads it every tick, and the dev report's `raster.overlay` section reads it once."],
    "§15")

# ---- src/engine/raster/antPaint.js ----
add("anp.chordStep", "chordStep(rPx)",
    "The chord length that keeps an arc of radius `rPx` device px within 1/16 px of its chord: `sqrt(r/2)`.",
    ["From sagitta = c²/8R. `appendPiece` calls it with the band's outer-edge radius `R²/(R + h)`, not the centreline's."],
    "§9")
add("anp.selAntScale", "selAntScale(inkPx)",
    "The thin-mark shrink: a run's band and dash scale by `inkPx/10`, clamped to [0.7, 1]; 1 when the ink width is unknown.",
    ["Transcribed from `Renderer.js`; marks never take it. `OverlayLayer.show` repaints when it changes."],
    "§9")
add("anp.needIV", "needIV(pairs)",
    "Grows the dash-interval scratch array, by doubling, to hold `pairs` start/end pairs.",
    ["Each growth counts in `antStats.allocs`; a steady phase allocates nothing."])
add("anp.needPieces", "needPieces(n)",
    "Grows the per-piece length and flag scratch arrays, by doubling, to `n` pieces.",
    ["-"])
add("anp.needPts", "needPts(n)",
    "Grows the polyline scratch to `n` points, by doubling, keeping the points already written.",
    ["It copies, unlike the other scratch growers, because `pushPt` grows it in the middle of a polyline."])
add("anp.needExt", "needExt(n)",
    "Grows the per-vertex join-extension scratch to `n` entries, by doubling.",
    ["-"])
add("anp.needSamp", "needSamp(n)",
    "Grows the cubic-sample and cumulative-length scratch arrays to `n` samples, by doubling.",
    ["-"])
add("anp.OverlayBuffer", "OverlayBuffer",
    "The screen plane the painter owns: non-premultiplied RGBA in device px, so the blit is one `putImageData`.",
    ["Reused for the layer's life; `resize` reallocates only on a real size change. It keeps the rows the last phase painted, so the next phase clears only those, and a dirty rect of what changed since the canvas last saw it."],
    "§9")
add("anp.OverlayBuffer.constructor", "OverlayBuffer.constructor(w, h)",
    "Sets up an empty painted-row range and dirty rect and allocates the pixel array through `resize`.",
    ["-"], "§9")
add("anp.width", "width (getter)", "The buffer's width in device px.", ["-"], "§9")
add("anp.height", "height (getter)", "The buffer's height in device px.", ["-"], "§9")
add("anp.data", "data (getter)",
    "The RGBA pixel array, a `Uint8ClampedArray` of width × height × 4.", ["-"], "§9")
add("anp.bytes", "bytes (getter)",
    "The buffer's size in bytes, width × height × 4.", ["-"], "§9")
add("anp.dirty", "dirty (getter)",
    "The rect changed since the canvas last saw the plane: the rows the last clear emptied, unioned with what this phase painted.",
    ["Integers, half-open, device px; one object mutated in place. `OverlayLayer.blit` pushes it by default."],
    "§9")
add("anp.resize", "resize(w, h)",
    "Reallocates the pixel array when the rounded size differs, resetting the painted rows and the dirty rect; returns whether it did.",
    ["-"], "§9")
add("anp.clearTouched", "clearTouched()",
    "Zeroes the rows the last phase painted, and only those, and sets the dirty rect to those full-width rows.",
    ["Measured: 0.049 ms for a 200-row band. `paintPhase` calls it first, so a phase depends on nothing the buffer held."],
    "§9")
add("anp.noteRows", "noteRows(buf, y0, y1, x0, x1)",
    "Widens the buffer's painted-row range and its dirty rect to take in one stamp's pixels.",
    ["-"], "§9")
add("anp.dashIntervals", "dashIntervals(len, on, off, phase, out, fit)",
    "The lit intervals of one run at one crawl phase, as start/end pairs along its own length in device px.",
    ["A run at least one cycle long is fitted to a whole number of cycles (`n = round(len/cycle)`, the pattern scaled to fit) so no dash is a runt; a shorter run, or a mark (`fit` false), carries the full-size pattern and slides. The phase offset is `phase/8` of the run's own fitted cycle, so every run completes its cycle in the same eight steps.",
     "Returns the pairs needed and writes at most `out.length/2`; a caller given more grows its array and calls again, so no array is allocated per run. A cycle boundary landing within rounding of the run's end is not counted as a dash."],
    "§9")
add("anp.stampSegment", "stampSegment(buf, ax, ay, bx, by, h, ink)",
    "Paints one dash: a rotated rectangle of half-width `h` from A to B in device px, max-composited onto alpha.",
    ["Coverage is `clamp01(h + 0.5 − |d⊥|)` times the two axial ramps: exact for an axis-aligned edge, an approximation of area for a rotated one. Each row walks only the x span where both constraints can be non-zero. A pixel is written, in the ink's colour, only where its alpha rises; a zero-length dash paints a dot of radius `h`.",
     "The composite is `max`, not a sum, so two crossing runs paint solid, never darker. A non-finite coordinate is refused and counted in `antStats.nonFinite`."],
    "§9")
add("anp.joinExt", "joinExt(d1x, d1y, L1, d2x, d2y, L2, h)",
    "How far the two chords meeting at a join are each extended: 0.5 px of axial overlap plus the miter's reach `h·tan(turn/2)`.",
    ["The miter term fills the wedge two rectangles leave on the outside of a turn. It is capped at half the shorter chord, and a reversal takes `4h` into that cap; uncapped, a tight turn inflated a speck by 34 % (D132)."],
    "§9")
add("anp.stampPolyline", "stampPolyline(buf, pts, n, h, ink, e0, e1)",
    "Stamps a device-space polyline as one dash, each chord extended at its joins so the band has no notch where they meet.",
    ["Interior joins take `joinExt`; the two ends take `e0` and `e1`: 0 for a cap, 0.5 px where the dash carries on into a stretch not stamped here, or the seam's own join on a closed run."],
    "§9")
add("anp.stampDisc", "stampDisc(buf, cx, cy, r, ink)",
    "Paints a solid dot of radius `r`, max-composited, with the band's own one-pixel radial ramp: a speck is one disc.",
    ["Once the band's half-width reaches a circle's radius, a ring of chords closes over its own centre and leaves wedges at every join (measured 12 % short across), so a speck is stamped as a disc instead."],
    "§9")
add("anp.isCubic", "isCubic(p)",
    "Is this piece a cubic, an array of four points?", ["-"], "§9")
add("anp.isLine", "isLine(p)",
    "Is this piece a line: flagged `line`, or an arc with no finite positive radius?",
    ["The same rule as `antRuns`, so the lengths walked here match `pieceLength`'s."], "§9")
add("anp.finitePt", "finitePt(p)",
    "Is this point present, with two finite coordinates?", ["-"])
add("anp.pieceOk", "pieceOk(p)",
    "Is every number the piece is drawn from finite: a cubic's four points, a line's ends, or an arc's ends, centre, start angle and sweep?",
    ["-"], "§9")
add("anp.speckRadius", "speckRadius(pieces, h, k)",
    "The device radius of a run that is one full circle no larger than the band's half-width (a speck), or 0.",
    ["At most four arc pieces sharing one centre and one radius whose sweeps total a full turn. `circleLoop` builds every mark as two half-turns, so this recognises the marks the decision makes."],
    "§9")
add("anp.pieceBox", "pieceBox(p, k, tx, ty, out)",
    "A conservative device-space box for one piece, for the test that skips pieces off the plane.",
    ["An arc of up to a half turn takes its chord's box grown by the bulge `r·(1 − cos(sweep/2))`; a longer one takes the whole circle's box."],
    "§9")
add("anp.cubicAt", "cubicAt(p, t, k, tx, ty, out)",
    "A cubic's point at parameter `t`, mapped to device px.",
    ["A copy of `curveOutline.cubicAt` with the view folded in: this module imports only `antRuns`, so a worker can take it."],
    "§9")
add("anp.pushPt", "pushPt(n, x, y)",
    "Appends a device-space point to the polyline scratch, skipping a repeat of the last one, and returns the new count.",
    ["-"])
add("anp.appendPiece", "appendPiece(p, u0, u1, L, h, k, tx, ty, n)",
    "Appends the lit stretch [u0, u1] of one piece to the polyline being built, so a dash across several pieces is stamped as one polyline.",
    ["A line adds its two end points. An arc is walked about its own centre in chords whose outer-edge sagitta is at most 1/16 device px (`chordStep(R²/(R + h))`), each pushed out by half its sagitta so the band straddles the true circle; an arc of radius at most 1/16 px is one chord. A cubic (only an unresolved stroke's capsule outline) is sampled by `cubicSamples` and cut by the samples' own cumulative length, rescaled to `pieceLength`'s.",
     "Using the arc's centre is safe here, unlike in the ink's centre-free flattener: this is float64 over render-list coordinates the packer bounds at 2.6e5 frame units, where the cancellation is under 1e-6 device px.",
     "Stamping piece by piece instead leaves an unfilled wedge at every piece boundary: measured on a speck, 214 rather than 255 at the boundary pixel and the dot 12 % short across."],
    "§9")
add("anp.cubicSamples", "cubicSamples(p, k, tx, ty)",
    "Samples one cubic in device px at the 1/16 px bar, with cumulative lengths, and returns the segment count.",
    ["The count is `ceil(sqrt(dev/tol))` from the control points' deviation off the chord, between 1 and 256."],
    "§9")
add("anp.sampleAt", "sampleAt(ns, s, out, slot)",
    "The point at length `s` along the sampled cubic, interpolated within its segment.",
    ["-"], "§9")
add("anp.seamJoinExt", "seamJoinExt(pieces, n, firstEnd, lastStart, total, h, k, tx, ty)",
    "The join extension at a closed run's seam, from the chords that meet there, so the loop's first and last half-dashes join like any corner.",
    ["Builds the head's first chord and the tail's last with `appendPiece` itself, so they are the chords the stamp will use, and hands them to `joinExt`. Falls back to the bare 0.5 px overlap when either end's piece is off the plane or yields no chord (D132)."],
    "§9")
add("anp.samePt", "samePt(a, b)",
    "Are two points equal to a relative 1e-9, `antRuns`' own tolerance, which that module does not export?",
    ["-"])
add("anp.geometryCloses", "geometryCloses(pieces, n)",
    "Does the run end where it starts (the first finite piece's start against the last's end), for a run that carries no `closed` flag?",
    ["A mark built by `circleLoop` may carry none; without this check a speck is painted as a ring of chords instead of one disc (D134)."],
    "§9")
add("anp.paintRun", "paintRun(buf, pieces, closed, h, on, off, phase, k, tx, ty, ink, fit)",
    "Paints one run or mark: measures its pieces, places its lit intervals and stamps each lit stretch as one polyline.",
    ["A piece with a non-finite number is refused and counted; a piece whose device box misses the plane by more than the band is off-plane and not stamped, which breaks a dash there. A closed run whose dashes wrap the seam joins its first and last stretches with `seamJoinExt`, and a speck whose one dash wraps is a single `stampDisc` of radius R + h.",
     "There is no cap on the work (F38): what bounds it is the decision's cut to the retained window and the off-plane skip."],
    "§9")
add("anp.inkOf", "inkOf(css)",
    "The ink colour as `[r, g, b]`: `css.ink` as given, unpacked from 0xRRGGBB, or `SEL_INK_RGB` by default.",
    ["-"], "§9")
add("anp.paintPhase", "paintPhase(buf, dec, view, phase, css)",
    "One crawl phase of one selection decision into the buffer: clears what the last phase painted, then paints every run and mark.",
    ["Runs take the band and dash scaled by `selAntScale(dec.inkPx)` and fitted to whole cycles; marks take the fine band unscaled and unfitted, so their pattern slides across them and blinks. Band and pattern are CSS px times `css.dpr`; the geometry is frame units mapped by `view` (`p·k + t`, no origin). A non-finite view refuses the whole decision. Returns what this call placed, stamped, wrote and refused.",
     "Measured at F39's report camera (4,756 runs): 14.2–33.9 ms a phase, against 107–190 ms of raster plus 45–149 ms of packing through the general rasteriser."],
    "§9")
add("anp.resetAntStats", "resetAntStats()",
    "Zeroes the painter's counters, `antStats`.",
    ["Only the suites call it. The renderer hands `antStats` to `rasterPerf.attach` as its `ants` source, so the report carries them."],
    "§15")

# ---- src/engine/raster/rasterPerf.js ----
add("rpf.wall", "wall()",
    "The default wall clock, `Date.now()`, for row stamps; `attach` or the suite can replace it.",
    ["-"])
add("rpf.ensure", "ensure()",
    "Allocates the ring (timers, counts, wall stamps) and the job and drop record pools on the first note.",
    ["Once only, so an SVG-only session pays nothing: 400 rows × 40 slots, 131.2 KB in all. `reset` is the only thing that frees it."],
    "§15")
add("rpf.mkJobRec", "mkJobRec()",
    "One empty worst-job record, filled in place by `takeJob`.", ["-"], "§15")
add("rpf.mkDropRec", "mkDropRec()",
    "One empty drop record, filled in place by `noteDrop`.", ["-"], "§15")
add("rpf.attach", "attach(s)",
    "Takes the sources the report reads (picture layer, plate store, worker, packer, core and ant stats), the engine's perf-log hook and optional clocks.",
    ["Called in `RasterRenderer`'s constructor. The module imports only `now.js`, so these arrive here rather than being imported."],
    "§15")
add("rpf.detach", "detach()",
    "Forgets the sources; the ring and its rows are kept, so a report sent after a teardown still has them.",
    ["Called from `RasterRenderer.destroy`."], "§15")
add("rpf.reset", "reset()",
    "Frees the ring, zeroes every total, histogram, pending patch, submit stamp, drop tally and statistic, and restores the default clocks.",
    ["The suites' reset; no app code calls it."], "§15")
add("rpf.beginFrame", "beginFrame(frameSeq, kind, backMs)",
    "Opens a row for one main-thread task: clears its slots, stamps both clocks — backdated by `backMs`, main time the task spent before the row could open — and writes its `frameSeq` and kind.",
    ["A row still open is closed first and flagged `truncated`. `RasterRenderer._openRow` is the caller, for render, camera, arrival and settle tasks."],
    "§14")
add("rpf.endFrame", "endFrame()",
    "Closes the open row with `mainMs` as the bracket's own time, and sends a render row of 8 ms or more (any, in trace mode) to the engine's perf log.",
    ["Returns the row, or null with `orphanEnds` counted when no row was open."],
    "§15")
add("rpf.add", "add(slot, ms)",
    "Adds milliseconds to one timer slot of the open row; a negative or non-finite value is ignored.",
    ["With no row open it counts `orphanAdds` and records nothing. `RasterRenderer._add` maps a slot name to its index through `T`."],
    "§15")
add("rpf.bump", "bump(slot, n)",
    "Adds to one count slot of the open row, or counts an orphan when none is open.",
    ["No app code calls it; the suites do."], "§15")
add("rpf.noteView", "noteView(view)",
    "Records the published view (mode, quantum, stretch, dpr, revision, frame) and writes its quantum, mode and stretch onto the open row.",
    ["A `sync` view flags the row `rasOnMain`, so the rasteriser's phases count inside `mainMs`. The last view is kept for crawl rows, which have none of their own."],
    "§15")
add("rpf.closeRow", "closeRow(extraFlags, endAt)",
    "Finishes the open row: its wall span, both residuals, the running totals and histograms, and a place in the queue for the next rAF patch.",
    ["`residualMain` is `mainMs` less the main-part timers (and the worker-part ones in sync mode); `residualWall` is the queued-to-blitted `wallMs` less the wall-part timers. Worker rows' phases also go to `workerT`, so `ras.plateResidual` comes from one set of rows and cannot go negative on a sync frame.",
     "A truncated row takes `mainMs` and its wall span at the moment it is closed. Up to 64 rows wait for a rAF delta; past that they count as `pendingLost`."],
    "§15")
add("rpf.perfExtra", "perfExtra(row)",
    "The fields a slow render row sends to the engine's perf log: `frameSeq`, kind, `mainMs` and the main residual.",
    ["-"], "§15")
add("rpf.noteSubmit", "noteSubmit(req, nPlates, nStrips, at)",
    "Stamps a request's queued-at time (now, or `at`) before it is posted, with how many strips will arrive against it, and counts its plates as misses on the open row.",
    ["Kept in a 64-deep ring of parallel arrays, with no allocation per post. `platesWanted` is these misses plus the hits `noteCompose` adds, so no plate counts twice."],
    "§14")
add("rpf.queuedAtFor", "queuedAtFor(seq, postedAt)",
    "The queued-at stamp an arriving job claims: the newest submit of its `frameSeq`, at or before its post, with strips still unclaimed.",
    ["When every such submit is claimed it takes the newest one at or before the post, and -1 when there is none. One frame can post at more than one quantum under one `frameSeq`; the strip counts and the post time are what tell those posts apart."],
    "§15")
add("rpf.noteJob", "noteJob(info, res)",
    "Records a worker job's arrival on the open row: queue wait, transfer times, bytes, and the worker's per-plate phase timings and counts.",
    ["Reads durations only, because the worker's clock has its own origin. The earliest claimed queued-at opens the row's queued-to-blitted span. The job goes to the worst-jobs list, and one of 8 ms wall or more (any, in trace mode) to the engine's perf log as `rasterJob`. With no row open the job is counted and nothing else.",
     "The per-plate stride is read off the arrays; the suite pins it against `rasterJob.js`'s exports."],
    "§15")
add("rpf.noteBitmap", "noteBitmap(ms)",
    "Adds `createImageBitmap`'s time to `br.bitmap`, a wall duration because the decode runs off the main thread.",
    ["-"], "§15")
add("rpf.noteCompose", "noteCompose(ms, plates, blits)",
    "Adds a compose's time to `br.blit` and its blits to the row; on a non-arrival row its plates count as cache hits.",
    ["On an arrival row the plates composed are the ones that arrived, which `noteJob` has counted. On the arrival path the timed span is the whole plate-batch handler: store puts, paper fill, blits and re-post."],
    "§15")
add("rpf.noteDrop", "noteDrop(req, d)",
    "Records a stale or dropped job: a drop on the open row, a full record in an 8-deep log, a count by reason, and a `rasterStale` perf-log entry.",
    ["Every drop is tallied by its `why` (`tallyDrop`), so a session that dropped hundreds keeps the distribution beyond the last eight."],
    "§15")
add("rpf.noteCrawl", "noteCrawl(rep)",
    "Records one overlay crawl tick as a row of its own, kind `crawl`, from `OverlayLayer.report()`.",
    ["Closes a still-open row as truncated first. Crawl rows take negative `frameSeq`s, so they never collide with a render's. The tick's paint, blit and live times fill the OVERLAY timers (its decide time is not counted: 0) and its dashes, stamps, pixels, blit pixels and repaints the ant counts; `mainMs` is their sum unless the report gives one. The last published view supplies the row's mode, and `bytes` becomes the report's `overlayBytes`."],
    "§14")
add("rpf.onFrame", "onFrame(deltaMs, ts)",
    "The frame meter's rAF hook: patches the interval onto every row waiting for it and writes `br.inferred = rafDelta − Σ mainMs` onto the last of them.",
    ["BROWSER time is attributed by that subtraction, never measured. The interval's other rows are flagged `shared`; flags also mark a task longer than its interval and a remainder clamped at 0, and a row the ring has overwritten counts as `pendingLost`. A row no tick reaches reports `br.inferred` as null.",
     "`useKobinEngine` sets it as `frameMeter.onFrame`."],
    "§15")
add("rpf.growth", "growth()",
    "What the growth log samples on the raster path: the plate cache's count and bytes and the packer's memo bytes, or null with nothing attached.",
    ["`packedBytes` is the packer's memo, not the bytes transferred. Read by `instruments.js`'s growth log and by the report."],
    "§15")
add("rpf.report", "report(opts)",
    "The dev report's `raster` section: ring shape, slot names and parts, totals, histograms, up to 50 rows with verdicts, the worst jobs, the drops, memory and each source's report.",
    ["Bounded by construction (F58): at most 50 rows, 25 jobs and 8 drops, histograms rather than samples, and a `notes` object that explains the counters. Rows are joined to the `LongFrames` instrument's entries by wall-clock overlap when it is passed. `size.sectionBytes` is the section's own size; `reportBytes` is left null for `reportSend.js` to patch in after its one stringify.",
     "Read by `report.js` (`raster.perf`) and in the console as `E.renderer.perf.report()`."],
    "§15")
add("rpf.byteLen", "byteLen(s)",
    "A string's UTF-8 size in bytes, for the report's size bar (F58), because `length` counts characters.",
    ["`TextEncoder` where there is one (measured: 92 MB in 32–38 ms); otherwise a scan that allocates nothing (204–277 ms on the same 92 MB), which is what jsdom takes. A lone surrogate counts 3 bytes. `reportSend.js` measures the whole report body with it."],
    "§15")
add("rpf.firstNamed", "firstNamed(o, first)",
    "A copy of a counters object with the named keys first, in order, then the rest as they stand.",
    ["Puts the counters that mean a record was refused at the top of the `pack`, `core` and worker-guard sections."],
    "§15")
add("rpf.workerOut", "workerOut()",
    "The worker pool's own report with its guard counters put refusals first; null with no pool source.",
    ["-"], "§15")
add("rpf.pickRows", "pickRows()",
    "The ring rows the report keeps: the 25 worst by `mainMs` and the last 25, deduplicated and in time order.",
    ["-"], "§15")
add("rpf.rowOut", "rowOut(row, loaf)",
    "One ring row as report JSON: identity, `mainMs`, residuals, non-zero timers and counts, flag names, its verdict and any overlapping long frame.",
    ["`br.inferred` is null unless a rAF delta reached the row, never 0. `wallMs` appears only on a row with a queued-to-blitted span."],
    "§15")
add("rpf.loafFor", "loafFor(t, mainMs, loaf)",
    "The long-animation-frame entry that overlaps a row's interval most, with the overlap, or null.",
    ["Only the `LongFrames` instrument's kept worst entries are searched, so a row that joins none is not evidence of anything."],
    "§15")
add("rpf.verdictFor", "verdictFor(base)",
    "A row's one-word verdict: the bucket holding at least half its main-thread time, or `BROWSER`, `trivial` or `ambiguous`, with why.",
    ["`trivial` at or under 1 ms. `ambiguous` when the residual exceeds max(1 ms, 10 % of `mainMs`) or no bucket reaches half. `BROWSER` when a known rAF interval over 50 ms has `br.inferred` above `mainMs`, whatever the task's own split; `top` still names the largest main-thread bucket. A rAF delta shorter than the task leaves the bucket named with `corroborated: false`.",
     "The 50 ms floor on the BROWSER clause is there because under it `rafDelta − mainMs` is mostly vsync idle (D267)."],
    "§15")
add("rpf.takeJob", "takeJob(info, res, workerMs, staleN, q)",
    "Keeps an arrived job in the 25-slot worst-jobs list when its posted-to-arrived time beats the smallest kept.",
    ["Its queue wait comes from the stamp `noteJob` already claimed, never a second claim."],
    "§15")
add("rpf.jobsOut", "jobsOut()",
    "The kept worst jobs as report JSON, slowest first.",
    ["`postedToArrivedMs` is the client's posted-to-arrived span, narrower than the row's queued-to-blitted `wallMs`; `postMs` and `recvMs` sit beside it and are not added in."],
    "§15")
add("rpf.tallyDrop", "tallyDrop(why)",
    "Counts one drop by its reason; past 12 distinct reasons a new one counts as `other`.",
    ["-"], "§15")
add("rpf.dropsOut", "dropsOut()",
    "The last 8 drop records as report JSON, newest first.", ["-"], "§15")
add("rpf.totalsOf", "totalsOf()",
    "Session totals per timer, plus `ras.plateResidual`: the worker's job span less the four phases inside it, from worker rows only.",
    ["The residual is what a plate's start-to-finish holds beyond its phases: the paper fill before the first clock read and the loop's own overhead."],
    "§15")
add("rpf.countsOf", "countsOf()",
    "Session totals per count slot, from `platesWanted` on; the identity slots are skipped.",
    ["-"], "§15")
add("rpf.histLabels", "histLabels()",
    "The histogram bucket names, `<=1` to `<=500` and `>500` ms.", ["-"])
add("rpf.namedInts", "namedInts(names, arr)",
    "The non-zero entries of an integer array as an object keyed by name.", ["-"])
add("rpf.msObj", "msObj(by)",
    "A copy of a name-to-ms object with each value rounded to three decimals.", ["-"])
add("rpf.flagNames", "flagNames(flags)",
    "The names of the flag bits set in a row's `flags`.", ["-"])
add("rpf.bucketOf", "bucketOf(hist, ms)",
    "Counts one duration in its millisecond histogram bucket.", ["-"])
add("rpf.kindCode", "kindCode(kind)",
    "A row kind's index in `KINDS` (render, camera, arrival, crawl, settle); an unknown kind reads as render.",
    ["-"], "§15")
add("rpf.qCode", "qCode(q)",
    "Encodes a view's quantum as an integer for the ring: a number rounded, `s` (sync) and `e` (settle) as reserved negatives, anything else as unknown.",
    ["-"], "§15")
add("rpf.qOf", "qOf(code)",
    "Decodes a ring quantum back to its number, `s`, `e` or an empty string.", ["-"], "§15")
add("rpf.pick", "pick(d, req, key, dflt)",
    "A field from the drop record, else from the request, else the default.", ["-"])
add("rpf.traceOn", "traceOn()",
    "Is the engine in trace mode, per the attached `trace` source? False without one.",
    ["In trace mode a render or a job under 8 ms still reaches the perf log."], "§15")
add("rpf.ms3", "ms3(ms)",
    "Rounds milliseconds to three decimals for the report; a non-number reads 0.", ["-"])


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = []

# What each file is for in the design; the file's article heading on the Code Map.
ROLE = {
    "src/engine/raster/OverlayLayer.js":
        "The raster path's selection-indicator canvas: a screen-sized RGBA plane at z-index 2 that "
        "`antPaint` paints the ants into, four untransformed screen-edge strips, and the 50 ms crawl "
        "clock. Between repaints a camera step or a drag is a CSS transform on the canvas, and it never "
        "reads the ink canvas (DESIGN.md §9).",
    "src/engine/raster/antPaint.js":
        "The ants' painter: one crawl phase of one selection decision into a screen-sized RGBA buffer, "
        "each dash a rotated rectangle of fixed half-width max-composited onto alpha and each speck a "
        "disc, arcs stepped to 1/16 device px and nothing kept. Pure: no DOM, camera or engine, and it "
        "imports only `geometry/antRuns.js` (DESIGN.md §9, §10).",
    "src/engine/raster/rasterPerf.js":
        "The raster path's performance ring: one row per main-thread task (render, camera step, job "
        "arrival, crawl tick, settle) in fixed typed arrays, its time split into five buckets (ENGINE, "
        "RASTERISER, TRANSFER, BROWSER, OVERLAY) with a one-word verdict, and the `raster` section of the "
        "dev report. It imports only `now.js` (DESIGN.md §14).",
}

# ---- 2026-10-05, the rebuilt tree ----
add("rpf.noteCore", "noteCore(c)",
    "The raster core ran on the main thread — the pyramid's inline executor (A3 §2.3, §2.5): its clip, edges, union and accum go into the open perf row, flagged `rasOnMain`, so they count inside the frame's main-thread time.",
    ["The executor runs in camera steps and commits, never in a job's arrival row, whose phases are the worker's. An add with no open row is counted as an orphan."],
    "§14")
