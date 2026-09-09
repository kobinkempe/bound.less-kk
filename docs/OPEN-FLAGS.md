# OPEN FLAGS — the live list

**New to this codebase? Start at `docs/ai/00-START-HERE.txt`** — status, architecture,
a code map and the rules, written for someone with no context. This file stays the
authority on what is actually broken.

**Hands-on testing lives in `docs/UAT.md`** — the run-it-yourself checklist, with the
environment matrix for the browsers and monitors this has not been tried on.

**Everything to do that is not a bug lives in `docs/ROADMAP.md`** — the plan, in order,
with the backlog detail and the DONE ledger. Flags are referenced from it by id.

**This is the one place open concerns live.** It is a *current state* list, not a log:
edit entries in place, delete them when they close. `docs/issue-log.md` is the historical
log and is a different thing.

Read this file at the start of any session about baking, erasing, or stroke geometry.
When summarising status for a handoff, point at this file by path.

Last updated **2026-09-08**.

**THE FRAME LATTICE IS IN (2026-08-19).** A frame is a cell of a fixed lattice, a move is
arithmetic on an address rather than a translation of geometry, and the magnify chain carries
exact arcs. That closes F25, F28, and the two failures the design was written against (F-A, the
chain flattening curves; F-B, re-entry failing on a 1 px aim error). Read
`docs/reference/frame-lattice-design-bible.md` — section 10 first, which records where building it changed
the design — before touching frames, tiles, moving or persistence. Pre-lattice files are refused,
not converted (D8).

**The arc pipeline is WIRED IN (F22).** A stroke is no longer a centerline plus a
width — it is drawn as a biarc chain, and at pen-up it RESOLVES into a perimeter
of circular arcs which becomes the object. Erasing is an exact boolean on those
arcs with no polygon library anywhere. Read F22 before touching drawing, erasing,
tiles or persistence; F21 is the geometry it stands on.

**Everything below the F21/F22 entries is HISTORY on the cubic pipeline.** A, B
and C, the bake schedules, `curvePerimeter`, `strokeShape` — none of that runs any
more. It is kept because the diagnoses in it are what led here, and because the
cubic bake survives as the independent oracle the arc tests compare against.

The labs — `/#/arcpen` (the pen), `/#/arcbake` (the resolve) and `/#/bakelab` (the
old cubic schedules) — were deleted on 2026-08-31 with the rest of the dev routes;
the measurements they produced stay in the entries below. `?dev` on a canvas URL
is the one dev surface left.

| id | what | where | sev |
|---|---|---|---|
| [F44](#f44) | ~~arcs at depth are positioned through their centre~~ — **FIXED 2026-09-06, unverified by Kobin.** His "the mark jumps at a crossing" (2026-09-04): a level-0 green stroke's boundary moved 520 px at the 4 → 5 crossing. The level-4 piece was one unfrozen arc of radius 3e15 whose endpoint sat on the tile line, so the freeze refused it; the level-5 chop solved its grid cut through a centre at 1.2e19. Synthetic: ANY curved stroke broke at its fifth crossing. Fixed by Kobin's rule: the freeze is ONE RADIUS — an arc at or above the radius whose bow over a tile's diagonal is a quarter pixel (about 8.8e12 units, the same at every level) freezes wherever it is, one below it stays an arc; the only guard is that both ends lie between the chop's lines. The arcs the gate is about to freeze are cut in their own chord frame, never through the centre. The boolean stands in for an arc by its chord by the same gate and no other test. Measured in jsdom: the three corner-probe strokes descend to level 8 holding their edge to a twentieth of a pixel at every crossing (they lost it at the fifth before), the frozen line one level down agrees with the circle through the arc's ends to 0.000 px, and no arc survives past level 3 | `geometry/freeze.js` `freezeRadius` / `chopFreezeLoops` / `chordCuts`, `arcShape.js` `straighten`, `derive.js` `freezeR` | **fixed, unverified** |
| [F45](#f45) | ~~a crossing about a view centre on a cell boundary jumped the picture one whole cell~~ — **FIXED 2026-09-05**: `_maybeShift`'s half-open frame and `_viewCell`'s rounding disagreed about the strip that belongs to the neighbour's extreme cell; `_crossUp` now steps into the child's own parent first. 8 cases in `camera.crossing.test.js` | `Camera._crossUp` | fixed |
| [F46](#f46) | ~~an erase on a curve at level 2–3, zoomed in within the level, was refused as "grazing" at random~~ — **FIXED 2026-09-05**: the grazing test compared two whole-object areas whose noise floor on a tile-spanning arc of radius 6e12 is tens of units² against a real removal of 0.23; the removal is measured locally now and `loopArea`'s segment term no longer cancels. `erase.curve.depth.test.js` | `erasePipeline._removedArea`, `arcShape.segmentTerm` | fixed |
| [F47](#f47) | ~~a descent that ceded its intermediate links and was refused at the last one reported success~~ — **FIXED 2026-09-05**: the mark was consumed and the object cut into remnants and kids with no ink removed; a last-link refusal now unwinds the steps and records itself | `erasePipeline._bakeRehomeInner` / `_unwindSteps` | fixed |
| [F48](#f48) | ~~a press while a stroke was still open abandoned that stroke~~ — **FIXED 2026-09-05** (found by driving the real pointer path in Chrome): a lost pointerup (alt-tab, the Windows key, a touch the OS took) left the stroke in the document unfinalized and with no undo op — Ctrl+Z removed the NEXT stroke. A touch that lost its up also left its id in the hook's pointer map, so every later finger was the second finger of a pinch until reload. A press now finishes the open stroke first; blur and tab-hide end the gesture and forget the pointers | `KobinEngine._pointerDown`, `hooks/useKobinEngine.js` `resetGesture` | fixed |
| [F49](#f49) | ~~Delete on a lasso selection needed one Ctrl+Z per object~~ — **FIXED 2026-09-05**: `deleteSelection` pushed an undo op per selected id; it removes every member of every selected family and pushes ONE `eraseMany` | `selection.js` `deleteSelection` | fixed |
| [F50](#f50) | ~~after a drag that carried an object into the next cell, the ants vanished and the next tap on it deselected~~ — **FIXED 2026-09-05**: `_normalizeHome` re-homed the member AFTER the drag's last render, so the render list still held it as a native of the old frame with coordinates a whole frame away — the picture was right, the hit test and the indicator read the stale list. Pen-up renders once more when anything re-homed | `KobinEngine._pointerUp` | fixed |
| [F51](#f51) | ~~undo of a move (and a pinch-cancelled drag) left the DRAG's tile phase on the object~~ — **FIXED 2026-09-05**: `snapGeometry` records `tile: null` for a never-moved object, `translateGeometry` mints a phase, and `setGeometryById` only wrote a phase that was there — so after drag + undo the coordinates were back and the chop grid was not (the one serialized field that differed). A null phase or rect in the snapshot is written back as absent now | `Document.setGeometryById` | fixed |
| [F52](#f52) | ~~ink seen from another level picked with no slack~~ — **FIXED 2026-09-05**: a derived fill piece was tested with bare `windingOfPoint` while a native shape got the 6 px slack ring; the same stroke picked at 13 px off-centre at home and missed at 9 px as a down piece. Fills get the bbox test and the ring | `selection.js` `_hitTest` | fixed |
| [F53](#f53) | ~~a render mid-stroke painted the live stroke twice~~ — **FIXED 2026-09-05**: the growing stroke is a native of the frame, so `render()` built a group for it beside the `_live` path; a highlighter's first half showed at 0.70 instead of 0.45 after Ctrl+Z, an idle outline fit or a resize landed mid-gesture (screenshot in the entry). `render()` skips `_liveModel` | `Renderer.render` | fixed |
| [F55](#f55) | ~~a move loses registration with detail three or more levels below the level it is made at~~ — **FIXED 2026-09-05, unverified by Kobin.** His "star in a corner": a small stroke drawn against a coarse object's edge four crossings down, both moved together from above. The small one moved by exact address digits; the coarse one's coordinates took the displacement with ONE float rounding at the move level, and the chain magnified that rounding by 4096 per level below: 3.25 units four levels below a home-level move, 1,229 four levels below a level-1 move. Now a move never touches a stored coordinate at any level: the displacement, snapped to 2^-10 units at the move level, lives in the object's table (`below[k]`, k ≥ 0), the tiles are unmoved space, the table's whole-frame digits say which frame a moved object's pieces are read from and its remainder is applied at paint and subtracted from every input. Measured in jsdom (`move.registration.test.js`): the coarse object's pieces four levels below the move are the same bits in the new frame, the star's bits untouched, their gap unchanged to 1e-9 | `selection.js` `_dragSelection`, `geometry/offsets.js`, `LevelMap.objShift`, `TileStore._reroute`, `derive.js deriveStep` | **fixed, unverified** |
| [F56](#f56) | ~~an erase below two moved objects flooded one of them over the whole tile~~ — **FIXED 2026-09-06, unverified by Kobin.** His reports 06-16-21/24: two objects homed at level 1, dragged at level 10, a 4-px eraser at level 10 on one of them; the other, whose ink the eraser never reached, was ceded nine levels down and its level-10 kid was a solid square where the render's piece is a wedge. Since F55 the square a link reads is the erase less the remainder, which lands in the NEIGHBOUR of the unmoved frame as often as not; the kid was homed in the camera-path frame with its ink in cell (i, j), and its child tiles were derived through the store's ring projection (an up-then-down hop that loses low bits) while the chain derived the same ink by the exact direct hop. Measured: the level-7 kid's edge 2.5 units from the chain's, 2% more ink one level down, a solid square three down. The kid is now homed in the frame that OWNS the square, holding that frame's own piece for its own cell. Replayed: the untouched object is refused at the last link and unwound (F47), the erased one's kids are the chain's pieces at every level | `erasePipeline.js` `_bakeRehomeInner` (the square's owner) | **fixed, unverified** |
| [F54](#f54) | ~~a wheel tick during a stroke ends the stroke and drops the rest of the gesture~~ — **CLOSED 2026-09-07 by Kobin's decision, not a bug**: *"It can just end like it does today. Eventually, we'd want it to keep drawing as you zoom even past a level, but that's a future feature."* `Camera.zoomFactorAt` finalizes the live stroke on every zoom; the rest of the gesture draws nothing. Drawing through a zoom, crossings included, is on the roadmap's UX list | `Camera.zoomFactorAt` | closed — by design |
| [F57](#f57) | **an eraser at depth on a big drawing never finishes, and the tab locks while it tries** — measured 2026-09-07 on Kobin's 11,497-object canvas: twelve eraser marks pending; a hand-driven bake loop ran 81 steps in 20 s at 0.64–2.5 s a step (each a `rehome` descent, 1.99 s the worst) and finished none of them; with the timers running the tab stayed unresponsive past 45 s. The slice budget is 8 ms but one target is indivisible. His "eraser bakes failing" | `erasePipeline._bakeOne` / `_bakeRehomeInner` | **high — open** |
| [F58](#f58) | **a diagnostic report of a big drawing cannot be sent** — the same canvas serialises to 92 MB (`snapshot()` 0.7 s, `JSON.stringify` 1.5 s, the heap +280 MB for the string) and the report server destroys any body over 20 MB, so the button says Failed and nothing is written. Kobin's report of 2026-09-07 | `useKobinEngine.sendReport` / `tools/report-server.js` | medium — open |
| [F59](#f59) | **a cold render of a busy view takes seconds** — the load-time render of the canvas above: 7,987 ms for 882 pieces; a warm render of the same list 87 ms (list 4, groups 69, update 14). The cost is building Two.js paths, ~9 ms a group, and every crossing into an unvisited scene pays it again. The other session measured 949 ms at 2,545 pieces | `Renderer._buildPieces` | medium — open |
| [F60](#f60) | **the scale-bar dialog's Length field is a full-width bar at the bottom of the window** — `boundless-ui.css` line 435 ends `.bl-scale-field .bl-input,` with no block, so the selector joins the `.bl-toast` rule below it and inherits `position:fixed; bottom:5rem`. Found by the other session, confirmed in the file | `src/Stylesheets/boundless-ui.css` | low — open, one line |
| [F61](#f61) | **a non-finite zoom anchor recurses until the stack overflows** — `Camera.zoomFactorAt` checks `factor` but not `sx`/`sy`; a NaN anchor makes `inPanX/Y` NaN, `cellOf` returns NaN digits, `neighbour` hands back the same frame and `cellChild` recurses on identical arguments. A real pointer is always finite; the other session hit it with its own bad input. One guard | `Camera.zoomFactorAt` / `LevelMap.cellChild` | low — open |
| [F62](#f62) | **paths are emitted with `stroke="undefined"`** — seen in the DOM of both the in-app browser and Chrome: a `setAttribute("stroke", undefined)` somewhere in the renderer's fill path. Harmless (an invalid paint is ignored) | `Renderer.js` | low — open |
| ~~F13~~ | ~~bakes wrong on dense strokes~~ — **CLOSED by F15's fix**: the arc-length window is gone entirely | `geometry/curvePerimeter.js` | closed |
| ~~F14~~ | ~~pre-culls unsound~~ — **CLOSED**: the sampled cull is replaced by a conservative bbox bound, see F19; centerline cull still off | `geometry/curvePerimeter.js` | closed |
| ~~F19~~ | ~~pre-cull dropped real boundary at large pen widths~~ — **CLOSED** | `geometry/curvePerimeter.js` | closed |
| ~~F15~~ | ~~dense + self-crossing strokes bake wrong~~ — **CLOSED**, see below | `geometry/curvePerimeter.js` | closed |
| ~~F10~~ | ~~B disagrees with A~~ — **CLOSED**: A, B and C now agree exactly on all seven cases | `geometry/bakeStrategies.js` | closed |
| ~~F18~~ | ~~fabricated edges on hairpin strokes~~ — **CLOSED**: neighbouring cubics are clipped again; hairline loops dropped | `geometry/curvePerimeter.js` | closed |
| [F20](#f20) | ~~classification leaves ~121 junctions unbalanced~~ **SOLVED by the arc pipeline (F21)** — 0 unbalanced on the same stroke | `geometry/curvePerimeter.js` | superseded |
| [F21](#f21) | **arc pipeline lands: exact offsets, closed-form crossings, exact burial oracle** — 3.8x faster, F20 gone | `geometry/arcPerimeter.js` | live |
| [F22](#f22) | **the arc pipeline is WIRED IN**: biarc pens, sliced pen-up bake, exact arc-boolean erase, arc tiles | engine-wide | live |
| [F23](#f23) | **five things Kobin reported after using it** — unclosed geometry stored, dust natives, a move over an unbaked mark, one-object-per-80ms erase, tile churn on drags | engine-wide | live |
| [F24](#f24) | CLOSED. A cut that FINISHED an earlier cut fell on coincident boundary, which the intersectors cannot see; and a biarc pen's 4.99e17-radius arcs made the distance test cancel to zero | `geometry/arcShape.js` | closed |
| ~~F28~~ | ~~the app freezes when moving half of a split object~~ — **CLOSED by the frame lattice** (2026-08-19): it was F25 wearing a different coat, and a drag no longer rewrites deep coordinates at all | `KobinEngine._dragSelection` | closed |
| [F29](#f29) | **a piece fades out of existence while zooming out** after being cut off the main piece — caught mid-fade | `Renderer._fade` / `TileStore` | **high** |
| [F30](#f30) | **an eraser is consumed without cutting anything** — the first cede at a new level did nothing; does NOT reproduce synchronously | `KobinEngine._bakeTick` | **high** |
| ~~F-Z~~ | ~~a thin, long stroke vanishes while zooming out~~ — **FIXED AND VERIFIED 2026-08-26.** Chrome drops a filled path whose features are too small IN THE COORDINATES HANDED OVER, whatever the transform; the fix rescales such an object by a power of two at pre-render and divides its group matrix by the same. Kobin confirmed it in a browser. [Full account](#f-z--a-thin-long-stroke-vanishes-while-zooming-out) — keep it, the canvas-rasterization trap in it is what cost three wrong diagnoses | `Renderer._applyThinScale` | closed |
| [F35](#f35) | **a group move displaces one member** — an object placed in a corner at level 5 was not in the corner after being moved together with smaller objects. Reported 2026-08-26, no capture yet. **Folded into F41 (2026-09-04), instrumented:** the `depth <= camDepth` branch this section suspected is gone (offsets below the home replace it), and a drag now journals every member it could not move with the reason (`skipped` on the move note). The 0.143-unit drift could NOT be replayed — the F35 snapshots carry no journal — so this waits for a fresh report, which will now explain itself. **Mechanism found 2026-09-05: it is [F55](#f55)** — F41's "registration by construction" holds at the move level and one below, not three or more below, where the one rounded addition at the move level is magnified 4096× per level; 0.143 units is that rounding three levels down. **F55 built the same day**: a move no longer touches a coordinate at any level, and the deep picture of a moved object is the same bits in the new frame. Closes when Kobin sees his corner hold | `selection.js` `_dragSelection` | **fixed with F55, unverified** |
| [F34](#f34) | ~~an erase seals CHORDS ACROSS THE SHAPE~~ — **ROOT CAUSE FOUND AND FIXED 2026-08-26**: `circleCircle` computed `h² = r1² - a²`, which is pure noise once r1 is ~1e10 and r2 is ~21. Crossings were lost or halved, so chains could not pair. Kobin's own reproduction goes from 6 failures in 21 gestures to **0 of 21**. Needs his eyes in a browser | `geometry/arcPerimeter.js` `circleCircle` | **fixed, unverified** |
| [F33](#f33) | **autosave dies silently when localStorage fills** — the drawing then exists only in the tab. **REWORKED 2026-09-02**: the document moved to IndexedDB, one record per frame, written incrementally off the document's own events; local autosave is back ON. Measured so far only on a two-stroke drawing in the in-app browser (1.7–1.9 ms a write); the phone run on the 16M-character drawing is Kobin's to take | `storage/db.js` / `hooks/useKobinEngine.js` | **reworked, unverified** |
| F32 | ~~the lasso sometimes misses objects~~ — **DIAGNOSED AND FIXED 2026-09-03**, from Kobin's phone screenshot: the containment test was on the object's BOX, so a slanted stroke whose box corners poked out of the loop was dropped while its ink lay wholly inside (the crossbar of a "t"). Where the box straddles the loop the INK itself is now asked (`_inkInsidePolygon` -> `polylineInsidePolygon`). The other thing a loop "misses" is whatever the closing chord cuts — the straight line from where the finger lifts back to where it started, which is drawn, and in that screenshot ran through "Hello" and "there". The fully-bounded rule stands | `engine/selection.js` `_lassoFind` / `geometry/lasso.js` | **fixed, unverified** |
| [F36](#f36) | **three things are called a tile and they are three APIs** — the frame cell, the object's tile grid and the render-cache square are all W across and differ only in phase convention, and they have been confused once already: a chop clipped to the cache square froze one arc to two different chords. Kobin, 2026-09-02: *a real bug, just unlikely to be caught*. **Closed as a bug by F42 (2026-09-04) and F56 (2026-09-06):** the erase no longer computes an object-tile block of its own — it reads the piece's window (`clip`) and grid phase (`tile`) off the tile store's piece — and since F56 it reads that piece from the frame that owns the square, so the erase and the render cannot disagree about a grid or a frame any more. **S1 done 2026-09-07:** one `TileGrid` value type (`frameLattice.js`) — `at(phase)` for the object's grid, `CACHE` for the render square, `range` half-open and `touching` closed, each keeping its callers' arithmetic to the bit — and `LevelMap.tileRect/tileRange`, `freeze.tileWindow/tileClipRect` and `deriveStep` go through it | `frameLattice.js` / `LevelMap.js` / `geometry/freeze.js` | closed |
| [F39](#f39) | ~~a dense selection zoomed slowly and showed solid outlines instead of ants~~ — **FIXED 2026-09-03**, third design of the day: the ants come from the render list's pieces, on arcs, nothing flattened, tile cuts skipped by the rectangle that made them; decided once per render and moved between steps by a CSS transform on a layer of their own. Overlay JavaScript per zoom step 17 → 0.8 ms; a frame with the crawl running 50 → 16.7 ms under the old budget. The budget is then removed at Kobin's instruction and the crawl's repaint becomes the cost: 50 ms a frame at the report camera, 200 at 4× in — the phone's to feel, levers in the roadmap. Same day: the lasso asks "fully bounded" of a whole family, the ants ride with a drag, and a frame is one dot only under 2 px | `engine/overlays.js` `_selectionAnts` / `_selDecide`, `geometry/antRuns.js`, `Renderer._renderSelOverlay` | closed |
| [F38](#f38) | ~~some selected objects had no ants, or partial ones, after zooming in~~ — **FIXED 2026-09-03**: the 24,000 px ant budget was a hard stop, so with many objects on screen the members after it got no indicator and the one it ran out on got part of one. Past the budget a boundary is now drawn as a plain thin outline. With it, the overlay's per-member floor on a dense sub-pixel selection went from 30 ms a render to 3.5, by deciding per FRAME: a frame under a pixel on screen is one speck, its members never visited | `engine/overlays.js` `_selectionAnts` / `Renderer._renderSelOverlay` | closed |
| [F37](#f37) | ~~a ceded tile wore ants on all four sides~~ — **FIXED 2026-09-03**: the join between a piece and the piece it was cut from was only looked for in the parent CELL. A tile ceded into the neighbouring cell (an object reaches one cell over, invariant 2) found no source, recorded no join, and its whole tile edge counted as free ink edge — "what must be the tile is showing as selected". Every member one level up is a candidate now and the arc overlap decides | `engine/overlays.js` `_familyJoinNotes` | closed |
| ~~F31~~ | ~~`repairLoops` seals each fragment separately instead of stitching them first~~ — **FIXED 2026-08-26**: it now chains fragments on the cheapest join available, bridges each join explicitly, and seals once. Measured on the two phone strokes with the `distinctSamples` fix switched off, so the same severed bakes arrive: stroke 1 went 2 loops + a phantom hole -> 1 loop, worst fabricated edge 46.39 -> 0.75 units; stroke 3 went 3 loops + a phantom hole -> 1 loop, 82.61 -> 1.02, and its **area from 38.6% too large to 0.2% under**. Both seals are now ~6-9% of the pen's own width. `_lastBakeRepair` carries `fragments/chords/worstChord/fabricated/dropped` into a phone report, which is what made the first one take a day to place. | `geometry/arcShape.js` | closed |
| ~~F25~~ | ~~dragging a deep family destroys its deepest pieces~~ — **CLOSED by the frame lattice** (2026-08-19): a move is an ADDRESS change, and a deep member's geometry is not touched | `KobinEngine._dragSelection` | closed |
| ~~F-A~~ | ~~the magnify chain flattened arcs, and every level inherited the polygon~~ — **CLOSED** (2026-08-19): tiles carry exact arcs; rendered edge error 0 px at every depth an oracle can check | `geometry/derive.js` | closed |
| ~~F-B~~ | ~~re-entry was a nearest-frame decision that failed on a 1 px aim error~~ — **CLOSED** (2026-08-19): a frame is a lattice cell, so re-entry is a lookup | `LevelMap.js` | closed |
| [F26](#f26) | ~~a cut that reaches a tile edge never parted the object~~ — **FIXED**: a point contact is a cut, not a join | `geometry/connect.js` | closed |
| [F27](#f27) | ~~an erase made in a sibling BRANCH silently skipped ink homed elsewhere~~ — **FIXED**: cut in place when there is no chain to cede along | `KobinEngine._bakeOne` | closed |
| ~~F16~~ | ~~the 3,775-point scribble takes ~2 s at pen-up~~ — **CLOSED**: 76 ms on arcs, and the bake is sliced (F22) | `geometry/curvePerimeter.js` | closed |
| ~~F17~~ | ~~B is badly wrong on real strokes~~ — **MOOT**: schedules are gone; the pen builds the chain incrementally and A resolves it | `geometry/bakeStrategies.js` | history |
| ~~F11~~ | ~~A and C cut a corner into a tight wiggle~~ — **FIXED**: the crumb cull was unsound; removed | `geometry/curvePerimeter.js` | closed |
| ~~F12~~ | ~~no harness, no real timings~~ — **DONE**: `/#/bakelab`, and 3,775-sample timings below | `src/Pages/BakeLab.js` | closed |
| ~~F1~~ | ~~`strokeShape` chords the centerline~~ — **CLOSED**: nothing chords a centerline; a stroke IS its arc perimeter (F22) | `geometry/strokeShape.js` | closed |
| ~~F2~~ | ~~the A/B/C cost numbers are void~~ — **re-measured in Chrome on the curve core**, see below | `docs/perimeter-bake-options.md` | closed |
| ~~F3~~ | ~~`strokeShape` takes a polyline; a stroke is a spline~~ — **CLOSED with F1** | `geometry/strokeShape.js` | closed |
| ~~F4~~ | ~~PR-4 documents the frozen corner as acceptable~~ — **CLOSED by F22**: a cut edge is arcs, re-flattened per level; PR-4 now measures that | `precision.slow.test.js` | closed |
| [F5](#f5) | ~~never passed a test by Kobin~~ — **HE USED IT (2026-08-15)**: "erasers seem to be mathematically exact... relatively little tile issues". Five defects reported, all in F23 | — | open |
| ~~F6~~ | ~~9 `fidelity.compare` failures predate this work~~ — **GONE**: its ground truth read `o.pts.length` on erase output; 33/33 green | `fidelity.compare.slow.test.js` | closed |
| ~~F7~~ | ~~`strokeShape` is wired to nothing~~ — still true, and now deliberate: it is oracle-only, like `curvePerimeter` and `bakeStrategies` | — | closed |
| ~~F8~~ | ~~no real-Chrome numbers~~ — **CLOSED**: the app runs; pen-up swap 233 px of 921,600, tile-seam lift 0 across 1,960 rows | — | closed |
| ~~F9~~ | ~~`_bakeOne` can still become an indivisible multi-second job~~ — **CLOSED by F22**: every bake phase is resumable | `KobinEngine.js` | closed |
| [F42](#f42) | ~~an erase nine crossings down cut the ink the screen did not show and left the ink it did~~ — **FIXED 2026-09-04, unverified by Kobin.** Report 14-50-08: five eraser strokes at level 9 cut the black underneath and none of the red or green, whose cede chains stopped at level 6 with "tile holds none of its ink". The descent recomputed each level's ink (`projectF`, then a clip in local coordinates) while the render derives it from the parent tile's stored pieces; a clip vertex is an interpolation between far, already-rounded ends, and two chains clipping on different rectangles part by 4,096× per crossing — 1,788 units at level 6, a tile at 7, straight lines only. The descent now takes each level's ink from the tile store's piece for the cache square (`_squareInk`) and mints the kid from those loops bit for bit; the window ceded is the piece's own padded window; the parent is cut in its own coordinates; the boolean passes every piece it does not cut through by reference; and a child tile whose pre-image straddles two parent squares derives each object from ONE of them (the same square the erase cedes). Measured in jsdom (`erase.depth.test.js`): the hole appears on a slanted edge at 5, 6, 7, 8 and 9 crossings; every intermediate kid's loops are the render's; a cede far above leaves the picture below bit-identical. Found on the way: F43 | `erasePipeline.js` `_bakeRehomeInner` / `_squareInk`, `Document.cedeTileById`, `arcShape.shapeBooleanOnce`, `TileStore._upPiecesOver` | **fixed, unverified** |
| [F41](#f41) | ~~a drag from three or more crossings below an object's home moves it in jumps~~ — **FIXED 2026-09-04, unverified by Kobin.** Report 14-45-44: the green object, homed one crossing down, dragged from four crossings down at 254×, sat still for 63 px and then jumped 127 px. The drag added the displacement straight into the home coordinates, three crossings down one pixel is 0.008 of their float64 step, and the move snapped to that step. The displacement now lives in the object's table of OFFSETS BELOW ITS HOME (`geometry/offsets.js`), at the camera's depth, in the camera's units, exactly as the pointer moved; the hop into that level adds it once, at that level's precision, and the tile phase moves with it; coarser levels draw the picture translated by the residual (`piece.res`); whole frames carry up as integers and the home coordinates change only by whole cells. Kobin's constraints honoured: the move is handled locally, the level above sees a translation, the home is untouched. Measured in jsdom (`move.below.test.js`): the ink follows the pointer to a millionth of a pixel at 1, 2, 3, 5 and 8 crossings; home coordinates bit-identical; slow = fast; there-and-back and undo exact; carries integer; erases at and above the drag's level land on the moved ink; a ceded family moves as one; the offsets survive a save. **Rebuilt by F55 (2026-09-05):** the table no longer enters the hop at all — it is applied at paint and inverted on inputs at every level, snapped to 2^-10 units, and has a home-level entry — because the one addition in the hop was F55 | `selection.js` `_dragSelection`, `geometry/offsets.js`, `LevelMap.objShift` / `mapPointObj`, `TileStore._reroute`, `KobinEngine._buildList` | **fixed, unverified; superseded in part by F55** |
| [F43](#f43) | ~~a cut on a long straight piece moves that piece's picture far away at depth~~ — **FIXED 2026-09-05, lines and arcs, unverified by Kobin; one arc case left to F44.** Found 2026-09-04 while pinning F42: a nick made at level 2, 300 px along an edge, moved that edge 136 units at level 6; Kobin's corner scenario measured to level 8 emptied the level-8 tile with a 12-px nick at level 3. The boolean split the line at the eraser, the new endpoint carried a rounding, and the chain magnified it 4,096× per crossing — a line defined by its two endpoints cannot be cut anywhere without being redefined everywhere; a cut arc was re-parametrised the same way. A cut piece now remembers what it was cut from — a line its canonical line (`P`/`Q`) with the surviving stretch as positions (`sa`/`sb`); an arc the arc the chain would have had at this level (`K`: angles and end points) with its stretch as positions (`ua`/`ub`) — and every cut below is computed from that. Measured in jsdom: the horizontal arm bit-identical to level 8 after the level-3 nick with its edge unmoved to the last digit, the slanted arm (an arc of radius 2.6e16 at level 4) bit-identical at 4 and 5 (`depth.corner.probe.js`); the level-6 picture bit-identical after a level-2 nick on a line, the level-4 picture after one on an arc (`erase.depth.test.js`). The one arc case left open on 2026-09-05 — the boolean chording an arc the chain kept — closed on 2026-09-06 with F44's radius gate: the chain and the boolean freeze by the same rule, and the join-arc probe case passes | `geometry/arcPerimeter.js` `cutLine` / `cutArc`, `arcShape.js` `shapeBooleanOnce` / `reanchorCutLines` / `reanchorCutArcs`, `freeze.js` `chopFreezeLoops`, `persist.js` version 2 | **fixed, unverified** |
| [F40](#f40) | ~~a blue shape one frame up "disappears" when you zoom just past the level jump~~ — **CAUSE FOUND AND FIXED 2026-09-04.** It was never where it was drawn: arcs went to the browser as quarter-turn cubics, whose error is 2.7e-4 of the radius, and this re-homed circle had a radius of 2.9 million px on screen — its edge ran 463 px outside the truth, and the level jump re-chopped the arc into thousandth-degree pieces whose cubics are exact. Arcs go as SVG arcs now (Two.js has had the command since 0.7). **Residual, measured:** the browser rebuilds an arc's centre in float32, so past a screen radius of ~1.5e8 px the edge is off by a pixel, and by 159 px at 2.4e10 — the child frame's deepest zoom — snapping back at the next crossing. A fixed 22° rule (one cubic under it, the arc command over it) was tried and measured at 15 px at its worst; Kobin: *"15 px is too much"*. What ships is the quarter-pixel plan: the arc command while its float32 centre is within the engine's tolerance (a screen radius up to 4.2 million px), else as many cubics as the sixth-root law demands, planned once per piece at the frame's deepest zoom. Measured in paint on his drawing: the edge on the truth at the child frame's deepest zoom, no jump at the crossing. **Then the window chop, the same evening:** the float32 coordinate floor (up to 2 px on a tile-spanning piece) and Chrome's habit of DROPPING a path whose cubics run beyond ~1e7 device px (his red piece: painted at inScale 64, gone at 78.8, `d` unchanged; a length split of long pieces only made more such cubics and is off) are closed together — each scene keeps a window of ±2^18 device px around the view, any area piece reaching past it is clipped to it with the tile machinery's own exact boolean before it becomes anchors, and the window is chosen again, rebuilding only the straddling groups, when the view leaves its inner half or the zoom grows fourfold. Render-only: the objects, the tiles and the saves are untouched. Measured in his Chrome: the red piece paints at 78.8 and 97 with its edge on the float64 truth, a pan of 2,100 units across the inner half cost one full render and left the edge on the truth | `Renderer` `_pushArea` / `_chopFor` / `_maybeRechop` / `needsWindowChop` / `pushArcPiece`, `geometry/arcShape.js` `planArc` / `arcCubicCount` / `chordCubic`, `geometry/antRuns.js` `runPathData`, `tools/harnesses/bigpath.html` | **fixed** |

---

## Cleanup backlog — DONE 2026-08-31

Dead or unreachable code found while tracing the live pipeline (2026-08-25).
None of it was a defect; it was all "this stopped being called and nobody removed
it". The pass ran on 2026-08-31, after the arc pipeline and the frame lattice had
settled. **X1 and X2–X4 did not close the way they were written**, and the
reasons matter more than the items did.

| id | what was planned | what happened |
|---|---|---|
| X1 | delete the old erase RECIPE module (`geometry/erase.js`) — `subtractCuts`, `cutRecord`, `eraserFootprint`, `narrowCut`, `cutsResolveIn`, `removedFraction`, the superseded "a cut is a recipe the object carries" model | **MOVED, not deleted** → `engine/__oracles__/erase.js`. `erase.contract.slow.test.js` holds 26 passing assertions against it, and X1 itself said to port them rather than drop them. Porting an oracle into the code it checks is not porting; keeping it as an oracle costs nothing, since nothing in `src/` outside the suites imports it and webpack never bundles it. |
| X2 | delete `subtractPolys` and `clipPolysToRect` once X1 went | **KEPT.** Neither has a production caller, but `geometry/lattice.test.js` uses both as the probe that measures where Clipper's integer lattice starts to drift, and `geometry/areaErase.test.js` uses `subtractPolys` for area-erase semantics. That drift is a live constraint as long as X3 stands, so the probe is not vestigial — it is the suite that bounds the one Clipper call still on a render path. |
| X3 | delete `strokeOutline`, which was believed unreachable | **NOT UNREACHABLE.** It has three callers: `Renderer._fatPolys` under `outlineMode`; `derive.bandRings` under `opts.legacyOffset`, gated on `cfg.fatWidthPx == null` and therefore reached by the V0 golden-compare in `geometry/derive.test.js`; and `__oracles__/KobinEngineV0.js` throughout. X3 said to decide V0's fate first — V0 is **kept**, as the oracle the arc pipeline is checked against, so X3 cannot close. |
| X4 | drop `clipper-lib` from `package.json` | **CANNOT**, because X3 cannot. Removing it means deleting outline mode *and* the V0 golden-compare. |

**What was done instead of X2–X4**, and it is most of the value they were after:
`geometry/clipperOutline.js` was split in two, so the name stops lying.

- `geometry/polyline.js` (465 lines) — `controlsFor`, `flattenCurve`,
  `flattenCurveNear`, `clipRingsToRect`, `clipPolylineToRect`, `decimatePolyline`,
  `strokeStripNear`, `capsulePoly`, `netRingsArea`. Pure float64, no integer
  lattice, no coordinate ceiling. **This is the half on the hot path**, and it no
  longer imports `clipper-lib` even transitively.
- `geometry/clipperBoolean.js` (219 lines) — `strokeOutline`, `subtractPolys`,
  `clipPolysToRect`, plus the `capScale`/`localFrame`/`pickScale` lattice
  bookkeeping. Its header names every remaining caller.

The dependency is one-way and stated in both files: `clipperBoolean` imports from
`polyline`, never the reverse. `grep -l clipperBoolean src/` now names every
place Clipper is still reached — six files, three of them tests — which is what
X2–X4 were really trying to make visible.

### The rest of the 2026-08-31 pass

| what | outcome |
|---|---|
| the three unreferenced functions | `LevelMap._edge` and `curvePerimeter.minDist` **deleted**. `Document.canRedo` **kept and wired up**: it and `canUndo` now ride the status payload, and the toolbar greys Undo/Redo when the stack behind them is empty. It was an unfinished feature, not dead code — the buttons existed at `CanvasEditor.js:52` and were simply always enabled. |
| `Pages/CanvasV2.js`, `BakeLab.js`, `ArcPen.js`, `ArcBake.js` | **deleted** with their routes. CanvasV2 carried its own copy of the mount/pointer/autosave/report lifecycle that `hooks/useKobinEngine.js` also has, and the same fix had had to be made twice more than once. |
| `Components/toolButton.js`, `Images/toolbarIcons/logoSmall.js`, `Stylesheets/CanvasToolBar.css` | **deleted** — orphaned by the above, and with them the last importers of `@material-ui/core`. |
| `KobinEngine.contract.test.js` | **rewritten.** It was enumerated from CanvasV2. It is now enumerated from the two real consumers — `hooks/useKobinEngine.js` and `Pages/CanvasEditor.js` — and pins the new `canUndo`/`canRedo` status fields. |
| the oracles | `KobinEngineV0`, `curvePerimeter`, `strokeShape`, `bakeStrategies`, `cede`, `erase` and their suites **moved** to `src/engine/__oracles__/`, with a README saying what each one is an oracle *for* and the rule that production must never import from there. |
| `scaleBar/testSupport.js` | **moved** to `src/engine/__testkit__/scaleBar.js`, so `src/engine/scaleBar/` holds only shipping code. |
| the other 19 "test-only" exports | **kept where they are.** They are not test helpers; they are coherent module API whose only current caller is a suite — `arcShape.intersectShape` is the sibling of `subtractShape`, `biarc.arcToCubics` is the documented rendering conversion, `derive.projectNative`/`levelFactor` are the golden-compare targets. Moving them into test files would break the modules they belong to. The Call Graph greys them, which is the durable record; 29 scattered `// TEST-ONLY` banners would drift. |
| `KobinEngine.js` | **split 3,506 → 855 lines**, the rest into `erasePipeline.js`, `overlays.js`, `selection.js`, `sceneOps.js`, `files.js` and `instruments.js`, mixed back onto the prototype by `engine/mixin.js`. Every method moved byte-identical; nothing was rewritten. |
| the docs | the bibles, handoffs, option papers, test catalogs and reports moved to `docs/reference/` (still tracked). `DESIGN.md` at the repo root is the one document to read instead. |
---

### The ERASE debug view (dev menu -> "Erase")

Everything that has gone wrong with erasing this month has been invisible on
screen: a family that would not come apart, a piece joined to the wrong
relative, a native made of nothing, a mark that never baked. All of it is
decided by connectivity across a tile boundary, and none of it is something you
can see in ink. This draws the decision.

| what you see | what it means |
|---|---|
| a real shape at **70%**, a temporary tile at **50%** | opacity is on each PATH, not on the object's group, so where two pieces of one logical object overlap it reads DARKER. They are supposed to tile, not overlap: a dark patch is a bug. The two levels also tell stored ink from a tile built for this view at a glance. |
| a **different colour per real shape** | one logical object, one colour per native it is actually made of — tiles, pieces cut by tiles, pieces still joined underneath. Assigned in first-seen order within the family, remembered by id, so nothing changes colour while you watch it. |
| **black** fill | ink that is not a shape HERE: either nothing resolved stands behind it, or it belongs to a COARSER object and this is a magnified view of it (an "up" tile). A piece stored FINER than the view — one an erase ceded — keeps its own colour, so zooming out does not blacken what you were just working on. |
| **orange** outline, 1 px | a STORED shape's own boundary, taken from the NATIVE in its own frame and mapped to screen — never from what is drawn. A shape shown at another level arrives as tile pieces each clipped to its tile, so outlining what is drawn traces the tile grid and stops dead at every seam; this runs continuously across them. |
| **green** outline, 1 px | the stretch where that piece is in CONTACT with a parent or child across their shared tile edge. **This is severance itself**: green means "these two are one object". A cut that has reached the tile edge shows as green shrinking to nothing — and the moment it becomes a single point, the family parts (F26). |
| **yellow** at 20% | an eraser mark. Marks already consumed are KEPT while the mode is on, so a gesture that appeared to do nothing can still be seen where it landed. |

**Every line on screen is green or orange, never both.** Green used to be drawn
over orange, which is two paths where the picture has one edge: a fraction of a
pixel of disagreement between them showed as a two-colour fringe that read as a
gap, and every shared edge cost twice. Now ONE walk of each stored boundary
splits it into runs — `_splitOnJoins` cuts a segment where a contact interval
starts and ends, so a side that is half joined comes out half green and half
orange instead of all of one — and each run goes to exactly one list. Both
pieces of a join draw their own share of it, which is what makes a join visible
from either level: measured live on a three-level family, `0#7`, `1#9` and
`2~1#10` all three draw green, 4 green paths and 1 orange path in the SVG, none
overlapping.

**Do a child and parent need an overlap so no seam shows when you zoom out?**
No — and the reason is worth keeping, because "add a pad" is the obvious wrong
answer. Two opaque paths that share an edge each cover part of the boundary
pixel and composite source-over, so up to a quarter of the background survives:
measured on a ceded tile, an interior pixel lifted 18-25% toward white. But
subpaths of ONE path do not seam — the rasterizer accumulates coverage across
all of them before compositing anything. `Renderer._buildPieces` merges every
piece of one logical object (grouped by `editId`) into a single path, so the cut
stays EXACT and the join still paints solid. That is what made the previous
`2/enter` pad unnecessary — it was 2 px at one zoom and 0.19 px at another,
which is what a view-dependent overlap always costs. `cedeTileById` subtracts
the tile rect from the parent exactly, and the parent's hole and the tile rect
agree to **0.00e+0 in every coordinate** across a 650-unit object; that
exactness is also what makes the contact test meaningful, since the stretches
`contactArcs` compares lie on the same line by construction. `seamPad` (1.5 px,
30 level units) survives for the cases merging cannot reach: derived tile QUADS,
and a sub-pixel down-piece that is actually FADED and so has to be its own
group. **In the debug view the merge does not apply** — every piece gets its own
colour by design — so a hairline along a tile edge THERE is the debug colouring,
not the geometry.

`KobinEngine._eraseDebugOverlay()` builds it in screen coordinates from the same
`contactArcs` / `arcOverlaps` the real severance test uses — so what is drawn is
the decision, not a second opinion about it. Two things keep it affordable, both
found by profiling rather than by guessing:

* **Clip before flattening.** A coarse object seen three levels down is 2.7e10 ×
  the window; flattened whole at the magnified view's tolerance that is tens of
  millions of points for the few hundred on screen, and it threw `RangeError:
  Maximum call stack size exceeded` out of Two.js's path constructor (`Collection`
  takes its array by `push.apply`, and apply spreads it onto the call stack).
  Now `shapeRingsInRect` clips to the view first, sub-pixel chords are dropped,
  and the anchors go in 2048 at a time regardless.
* **Cache the joins.** A join is a fact about the document, not about the camera,
  but finding one means flattening whole pieces at the rect's own lattice step.
  Keyed by member ids + `_ver`, with the visible outlines cached per (id, `_ver`,
  tolerance) whenever the object lies wholly inside the clip window: 160 ms per
  render became 61 ms cold and 31 ms warm on Kobin's own document.

### Confirmed GOOD — do not re-litigate

`curveOutline.js` already offsets correctly and already obeys Kobin's curves-not-lines
rule. Specifically:

* `curveOutline.js:257` — `chordDeviation(c) <= lineTol` is the only path that emits a
  straight line, i.e. a line is used **only where the piece genuinely is straight** at the
  tolerance in play. Everything else goes through `fitOffset` (Tiller–Hanson + measured
  error + subdivision) and comes out as fitted cubics.
* `strokeOutlineCurves` groups tangent-continuous pieces into **runs** with one cap pair
  per run, not per sample, so joins inside a run are smooth by construction.
* Tolerances are taken at the level's deepest zoom (`cfg.enter`) — the worst case a level
  ever shows.

What it does **not** do is resolve its overlapping capsule loops into a single perimeter.
That is the missing step, and it is the whole job.

---

<a id="f25"></a>
### F25 — CLOSED 2026-08-19. Dragging a deep family destroyed its deepest pieces

**What it was.** A drag translated every selected member's geometry by
`displacement x frameFactor`, which for a member k levels below the camera is
`displacement x R^k`. The members stayed beautifully registered with each other — drift under
6e-14 px at every depth — and each one's OWN SHAPE was destroyed: 0.12% of its area gone at
four levels of separation, **82.9% at five**, coordinates reaching 7.3e18. The object did not
move wrong. It came apart.

**What fixed it.** `docs/reference/frame-lattice-design-bible.md`, built 2026-08-19. A frame is a lattice
cell, so a displacement decomposes into base-4096 DIGITS and everything a whole cell or larger
is applied to the member's ADDRESS: it is re-homed into the cell that many steps along and its
geometry is not touched, because neighbouring cells' origins differ by exactly one frame and the
same local coordinates therefore describe the moved object exactly. Only the sub-cell remainder
— under one frame, at any depth — ever reaches a coordinate.

Measured at 3, 4, 5 and 6 levels of separation (`move.deep.test.js`): area **exactly**
unchanged, coordinates inside the frame, geometry **bit-identical** when the displacement lands
on a whole cell, and a slow drag bit-identical to a fast one. F28 was the same defect and closes
with it.

The original diagnosis follows, because it is what led here.

### F25 — the original report (OPEN, blocker) — HISTORICAL

This is what actually corrupted Kobin's second scenario, and it is a MOVE bug
wearing a split bug's clothes. Measured by loading his own report and dragging
the object 20 px at the top level:

| level | coordinate reach before | after one 20 px drag | area drift |
|---|---|---|---|
| 0 | 304 | 314 | 0 |
| 1 | 7,893 | 62,058 | 0 |
| 2 | 15,000 | 1.8e8 | 0 |
| 3 | 9,466 | 5.4e11 | 0.000002% |
| 4 | 15,000 | 1.6e15 | 0.0005% |
| 5 | 9,022 | **4.9e18** | **3.6%** |

A member `k` crossings down must translate by 3000^k units to keep up with the
same physical movement. At 4.9e18 a double resolves ~500 units, and the piece's
own features are a few thousand — so its geometry is rewritten with a chisel.
Its contacts then break into points, and (correctly, under F26) the family falls
apart: components went 2 -> 8 on that one drag.

**The frame tree exists to prevent exactly this** — `LevelMap`'s own header says
frames "keep every stored coordinate within ~REUSE_RADIUS of its frame's origin
BY CONSTRUCTION". A drag is the one operation that violates it.

**THE FIX WAS ALREADY DECIDED AND IS SIMPLY NOT BUILT — bible §5.1**, "position
is a per-level offset, never rewritten coordinates" (Kobin, 2026-08-03: *"I want
consistency" — every object, always*). An object's `pts` are immutable; its
position is a sparse map of per-level offsets, one small vector per level it was
ever moved at, folded into that crossing's translation on the way down:

```
x_k = (x_{k-1}·s + t.x)/base + move_k.x        ≡    t'.x = t.x + move_k.x·base
```

Every number stays screen-scale, so nothing large ever materialises. Note this
is an offset **on the object**, NOT a frame per object — the bible rules that
out explicitly ("a frame per object would have made that walk O(objects) per
tile"). An earlier draft of this entry proposed re-homing into sibling frames;
that contradicts the decision and would cost exactly what §5.1 was chosen to
avoid. §5.1 also buys move-and-move-back returning EXACTLY, and drags that no
longer bust `_bbox` / `_dispFlat` / `_flat` / `_outline`.

What HAS been built is §5.4, the residue accumulation (`_dragSelection` measures
from where the drag started and credits only what the geometry actually took),
done 2026-08-03 with `move.drag.test.js`. §5.1 was never started. The bible's own
status list says so — "`pts` are still rewritten by a move ... the deeper claims
of §5.1 are untouched" — and acceptance scenario 7, *walk a tiny deep object in
over several rounds*, is still ❌ blocked on it.

**This is NOT family-only.** `_selectableRects()` walks `doc.levels()`, the whole
document, with no cull — as bible §5.3 requires, a lasso selects "everything
fully bounded by the loop, *including objects too small to see*". Verified: an
object homed three levels down, whose bbox is 2.79e-8 frame units wide and which
is not drawn at all, is in the selectable list. So a lasso can gather a piece
arbitrarily deep and drag it from the top, which is the same arithmetic that
destroys a family member. ("Fully bounded" excludes objects far LARGER than the
view, which is the other direction and is fine.)

Where the cliff is, measured on a 1140-unit object translated by 100·3000^k and
back:

| k | offset | ulp | worst point error | area drift |
|---|---|---|---|---|
| 1-3 | 3.0e5 … 2.7e12 | ≤4.9e-4 | ≤2.4e-4 | 0.000% |
| 4 | 8.1e15 | 1.0 | 0.50 (0.044% of span) | 0.099% |
| 5 | 2.4e19 | 4.1e3 | **1460 — 128% of span** | **90%** |

`select.multilevel.slow.test.js` SM-1 pairs a level-1 object with a level-4 one
and asserts they move together — k = 3, the last column that is still exact. The
suite stops one level short of the failure, which is why it is green.

<a id="f28"></a>
### F28 — CLOSED 2026-08-19 with F25 (it was the same defect) — HISTORICAL

Kobin, 2026-08-18, report `07-15-48` — taken deliberately BEFORE the move, so the
journal is empty (a reload clears it) and the snapshot is the state the freeze
started from. Two families of **7 pieces each, one component apiece**, spanning
levels **0 through 6**: a correctly split object, which is the thing that was
being fixed all week.

Almost certainly F25 wearing a different coat. A drag translates every member by
`tx * frameFactor(camera -> that member's level)`; at six levels of separation
that is 3000^6 = 7.3e20 units, where a double resolves ~131,000 and the piece's
own features are a few thousand. What F25 measures as *drift* at k=5 becomes, at
k=6, geometry so degenerate that the boolean and the connectivity walk grind:
`_familyComponents` re-derives contacts for all 7 members on every settle, and
every one of those flattens a shape whose coordinates have lost all meaning.

**Do not fix this separately until F25 (bible 5.1, per-level offsets) is done.**
If the drag never writes a large number, there is nothing here to be slow about.
Reproduction is in hand: load `07-15-48`, select either family, drag.

<a id="f36"></a>
### F36 — three things are called a tile, and they are three APIs (CLOSED: as a bug by F42 and F56, and the S1 tidy is done)

*2026-09-07: the two ways the erase could hold its own idea of a tile are both
gone — its own grid arithmetic (F42, below) and its own choice of frame for a
square (F56) — and the three APIs are one type now. `TileGrid` in
`frameLattice.js`: `TileGrid.at(phase)` is the object's grid, `TileGrid.CACHE`
the render square's, a frame's own square is `CACHE.rect(0, 0)`; `rect`,
`range` (HALF-OPEN — a rect ending on a boundary belongs below, the rule the
chop and the cede cut on) and `span` are the object-grid arithmetic,
`touching` is the closed read the cache always used. Each method keeps the
arithmetic its callers had, to the bit — which squares a cache reads and where
an object's tiles fall are both things a saved drawing's deep picture depends
on — so the change is a change of vocabulary and of nothing a test can
measure: `objTileRect/objTileRange/objTilesRect` are wrappers over it,
`LevelMap.tileRect/tileRange` return `CACHE`'s, `freeze.tileWindow/
tileClipRect` go through `TileGrid.at`, and `deriveStep` builds the object's
grid once and asks it for the window and the clip. The design note is in
DESIGN.md's vocabulary table.*

Kobin, 2026-09-02, on the roadmap's `TileGrid` item: *"this is actually a real bug, just
unlikely to be caught."* Recorded here so it is tracked as one rather than as tidying.

Three partitions share one size, W = 131,072 units, and three near-identical APIs:

* the FRAME lattice cell — `LevelMap`, `frameLattice.cellOf` / `cellEdge`. Belongs to space.
* the OBJECT's tile grid — `frameLattice.objTileRect` / `objTileRange` / `objTilesRect` and
  `geometry/freeze.js`, phased per object. Belongs to the object; this is where a curve may
  be frozen to a line.
* the render CACHE square — `LevelMap.tileRect` / `tileRange` / `makeGrid`. Only a work unit.

The first two are load-bearing and genuinely different; the design is explicit that they
cannot be merged. But nothing in the code says which grid a rect is on except which module
the function came out of, and the phase conventions differ. It has already cost once: the
first version of the chop clipped to the cache square, which is not a tile boundary, so two
neighbouring squares froze one arc to two different chords. A repeat would not show in the
suite — it shows as a seam or a mis-frozen arc at one depth, in a browser.

**The fix** is the roadmap's S1: one `TileGrid { phase, rect(i,j), range(rect), span(cells) }`
value object, built as `TileGrid.forObject(o)` or `TileGrid.cache()`, so "which grid is
this rect on" is answered by the value, and the half-open range convention — whose absence
once took a level-1 render from 49 ms to 258 ms — lives in one place. `docs/ROADMAP.md`.

**Narrowed by F42 (2026-09-04).** The erase no longer computes an object-tile
block of its own: `_squareInk` reads the piece's window (`clip`) and grid phase
(`tile`) off the tile store, so the one place that used to hold a second copy
of the object-grid arithmetic (`objTileRange` / `objTileRect` in
`erasePipeline`) is gone and the erase and the render cannot disagree about a
grid. What remains of S1 is the value type itself — `TileGrid` for the frame
cell, the object grid and the cache square — which is tidying now rather than
a correctness fix. The `TileGrid.forObject` the plan promised was not built as
a type; the phase travels on the piece and on the object, as before.

<a id="f32"></a>
### F32 — the lasso sometimes misses objects (FIXED 2026-09-03, unverified by Kobin)

Kobin, 2026-09-03, on the phone: *"the lasso is missing objects (see my
screenshot - the t is missing)."* The letters around it turned red; the
crossbar of the "t" stayed tan.

**What the walk does was checked first, and it was not the problem.** Report
`14-21-20` loaded into the in-app browser at its own camera (level 3): a
rectangle and a 64-point ellipse drawn around all 61 objects at that frame
returned all 61, before and after the change. The frame-tree prune, the
`ENCLOSED` shortcut and the per-object query are sound.

**The containment test was on the box.** `_lassoFind` asked `rectInsidePolygon`
about each object's axis-aligned rect. A slanted stroke's rect reaches into
corners its ink never visits — the crossbar is 37 units wide, 13 tall and
slanted — so a loop passing through such a corner dropped an object whose ink
was wholly inside. Now, where the rect fails but at least meets the loop's own
box, `_inkInsidePolygon` flattens the object's outline in its own frame at about
a pixel, maps it hop by hop into the active frame, and asks
`polylineInsidePolygon`: every vertex inside and no loop edge crossing any ink
segment. Only objects that could go either way pay for it.
`select.lasso.test.js` pins it with a diagonal stroke inside a diagonal band.

**The other thing a loop "misses".** The loop is closed by a straight chord from
where the finger lifts back to where it started, and it is drawn (Two.js closes
the dashed path) — in the screenshot the loop's right-hand side appears to be
that chord, running through "Hello" and "there", and everything it cut was
excluded by the rule. That is the rule working; it is worth knowing when a loop
seems to miss.

Kobin's loop could not be replayed exactly — the screenshot's camera is not the
report's — so this stays unverified until he draws the same loop again.
Everything else read off the code on 2026-08-26 (the two silent nulls in
`_rectInActive`, the reach box) was looked at and was not involved. Kobin
added later that the crossbar was a larger shape than he had thought, so the
screenshot may not have been a clean example of the miss he has seen before;
whether that miss is still there is his to say.

#### THE FIRST CUT WAS TOO SLOW, the same day. Kobin: *"The lassos got too slow, even after the selection was completed weirdly."*

Report `15-03-53`: five `ptrUp` entries with the select tool at 0.9–1.7 s, and
66 zooms at up to 549 ms while the selection was up. Reproduced in the in-app
browser at the report's camera with a loop round the speck that holds the
drawing's 5,390 deep objects (they are four levels down and take 5,429 objects
in one loop — by the rule, an object too small to see is bounded as readily
as a visible one):

| | before | after |
|---|---|---|
| `_lassoFind` | 985 ms | 7.7 ms |
| of which the ink test | 984 ms, 12 objects | 0.6 ms, 21 objects |
| `_setSelection` (renders the overlay) | 613 ms | 172 ms |
| `_selectionAnts` | 603 ms | 116 ms |
| `_selectionMembers` | 674 ms | 12 ms |
| pointer-up through the select tool | ~1,500 ms | 74 ms |
| one zoom step with the selection up | 548 ms | 49 ms |

Two causes. **The ink test flattened at a quarter pixel and asked every loop
edge about every ring segment**: 80 ms an object on the big scribbles the loop
crossed, thousands of segments against hundreds of edges. Now the outline is
flattened at 3 px and capped at 3,000 points, the loop is decimated to 160,
the edges are bucketed into a 32x32 grid over the loop's box, and — before any
flattening — the object's own points (arc endpoints, fill vertices, stroke
samples) are asked one by one, so an object the loop crosses leaves without
being resolved. **`getById` and `editGroup` were scans of the whole document**,
and the overlay called them once per selected object: 5,429 x 5,526. The
document keeps an id map now and a family map rebuilt lazily after any change
(every change goes through `_emit`; a severance re-key, which does not, calls
`keysChanged`).

What is left in the 74 ms is the overlay itself for 5,429 members, most of them
specks. It is per render while the selection is up; the 49 ms zoom step is that.

<a id="f42"></a>
### F42 — FIXED 2026-09-04 (unverified by Kobin). An erase nine crossings down cut the ink the screen did not show and left the ink it did.

**Seen.** Kobin, 2026-09-04, on the phone, report 14-50-08: at level 9 (effective
zoom 2.8e31) five eraser strokes over a view that showed red and green. His
words: "erasers are failing too, which is surprising to me because they were
working before." The journal has every stroke as a `cede` cut with its chain of
minted pieces: the black object (home level 0) and the blue stroke (home level
5) reach level 9 in every stroke — the black's level-9 patch is smaller by
about the area of the five strokes — while the red (home level 0) and the
green (home level 1) stop at level 6 every time.

**Replayed, in jsdom, from the two reports.** The drawing as report 14-45-44
had it, his fourteen sub-step moves of the green applied in order (they change
its coordinates by whole float64 steps, which at level 9 is a different place
entirely), then his first level-9 stroke. It reproduces: black to level 9, red
and green stopped at level 6 with `_rehomeWhy = "tile holds none of its
ink"`. The render list at that view held only red before the stroke, and
only black after it.

**Where the two chains part.** The erase's descent (`_inkShapeInRect`:
`projectF` one crossing, then `clipShapeToRect` on the bare tile block, in
local coordinates about the block's centre) against the render's magnify
chain (`chopFreezeLoops` on the object's tile grid, then `shapeLoopsInRect`
on the tile padded by 48 units, about that rect's centre). Where the red's
boundary crosses the centre line of the same tile, in that level's units:

| depth | render chain | erase chain | difference |
|---|---|---|---|
| 1 | −62710.7308756185 | −62710.7308756185 | 0 |
| 2 | −2807.16984245712 | −2807.16984245711 | 1e-11 |
| 3 | −42875.6115620863 | −42875.6115621019 | 1.6e-8 |
| 4 | 47967.81279638 | 47967.8126897484 | 1.1e-4 |
| 6 | −48119.13 | −49907.72 | 1,788 |
| 7 | 22965.72 | no red in the tile | the whole tile |

Every piece from level 2 down is a straight line in both chains; the red's
only arcs are its two end caps, nowhere near these tiles. Nothing is frozen.
The two computed endpoints of the same line differ in their last bits because
the operands differ (which rectangle, which local origin), that is a real
change to the line's position, and magnification is exact, so it is carried
down and multiplied by 4,096 at every crossing. A 49-point sample of the same
tile agrees with the table: the two chains agree on every point through level
5, differ by one point at level 6, and at level 7 the render before the erase
has 31 of 49 points red while the erase chain and the render AFTER the level-6
cede have none. The cede at level 6 therefore also changed the picture: ceding
replaces the tile's ink with the kid the erase computed, and the next level's
render derives from that.

**Why it "worked before".** The cede descent was measured to five crossings
when it was built (MX-1, bible §2.1); the two chains agree to well under a
unit there. Nine is beyond anything measured, and it is where every
independent recomputation of the same geometry parts from the picture.

**Design, agreed with Kobin, not built.** The erase must not recompute the
ink: at each step of the descent it takes the tile's ink from the render
chain's own derived pieces (the tile store's, with their bits) and mints the
kid from exactly those numbers, so the next level's render derives from the
same bits the erase cut. Same-bits is the only kind of "same" there is at this
depth. Kobin: "so because it was two different functions, it was the same math
done in two different ways, with small bit differences" — yes.

**Built, 2026-09-04.** What the plan called "the shared projection" turned
out to be simpler and stricter than a shared function: the erase READS THE
STORE. `erasePipeline._squareInk(id, F, i, j)` returns what `TileStore` holds
for native `id` in cache square (i, j) of frame F — the loops of the very piece
the renderer draws there (a covering quad comes back as its rectangle), its
padded window (`clip`) and its grid phase (`tile`). `_bakeRehomeInner` cedes
per cache square: the kid IS that piece, `attachRect` is its window, the hole
cut out of the parent is that window mapped up. `_inkShapeInRect` is gone.

Three things had to change with it, each measured on the way:

* **The parent is cut in its own coordinates** (`Document.cedeTileById`, and
  `_bakeOne`'s in-place cut too). Both used to translate onto a local origin
  and back, and `(v - c) + c` is not `v`: every vertex of the parent came back
  a rounding step from where it was, which four crossings down is the whole
  remnant's picture moved. Under the lattice a native's coordinates are small
  already, so the translation bought nothing. And `shapeBooleanOnce` now
  passes every loop the cut does not reach, and every piece it does not
  split, through as the object it came in as — the straightened working copy
  is no longer what comes out.
* **A child tile whose pre-image straddles two parent squares derives each
  object from ONE of them** (`TileStore._upPiecesOver`): the square holding
  the pre-image's centre, whose padded window covers the whole pre-image (the
  pad, 48, is wider than half a cell, 16). It used to take both squares'
  pieces — the same ink, clipped on two rectangles, so not the same bits — and
  at depth the two copies were thousands of units apart, a doubled edge. The
  descent cedes that same square first, and only it when its window covers
  what the descent needs, so the kid is the piece the level below was already
  being derived from. Measured because the F42 test happened to aim at x =
  400 = 12.5 cells, a cell edge: the extreme-digit case, where a child cell is
  centred on its parent's boundary.
* **Two kids side by side at one level are joined by contact too**
  (`_familyComponents`): a gesture that straddles two squares mints one kid
  per square, the second cut from the first's remnant, and only a
  parent-child test would have called two halves of one blob two objects.

Measured (`erase.depth.test.js`): a slanted stroke (an axis-aligned edge is
immune — its clip vertex copies a coordinate — and a first draft of the test
used one and passed on the broken build), descended onto its top edge with the
aim re-found to 1e-4 px before every crossing, erased at 5, 6, 7, 8 and 9
crossings: the hole appears where the gesture was made and the ink beside it
stays; every intermediate kid was minted from loops the store already held
for that level; a cede at levels 1 and 2 with the eraser touching nothing of
the object at level 2 leaves level 6's pieces bit-identical. What the test
does NOT claim, and measured: a cut that lands on the very line the deep view
lies along moves it — 136 units at level 6 for a nick at level 2 — because the
split segment's new endpoint carries a rounding (F43).

The quick suite is green (66 suites, 966 tests) and the slow suite too (24,
606); the cede, contract, deepsever, fuzz and layered erase suites unchanged.
One slow instrument changed: `precision.slow`'s `widestGap` probed with the
strictly-inside `pieceInks` and read a 0.25 px "crack" where two kids ceded from
neighbouring cache squares now abut exactly on the square's edge — a line the
renderer paints, since the family is one path — so it uses the oracle's
seam-aware `inks`, which was written for exactly that case.
Seen in the in-app Chrome (2026-09-04, the painted SVG hit-tested with
`elementsFromPoint`): a 24 px slanted stroke, the camera taken five crossings
down its top edge, a 20 px erase across the edge: five cedes, one per crossing,
paper under the eraser, ink 80 px either side of it. Not yet seen on the phone:
Kobin's own report scenario is the acceptance.

<a id="f41"></a>
### F41 — FIXED 2026-09-04 (unverified by Kobin). A drag from three or more crossings below an object's home moves it in jumps.

*Rebuilt on 2026-09-05 by F55: the table described here stays, but it is no
longer applied inside the hop — it is applied at paint and inverted on inputs
at every level, snapped to 2^-10 units, with a home-level entry. The section
below is the account of the first build; where it says "the offset enters the
hop", read F55.*

**Seen.** Kobin, 2026-09-04, on the phone, report 14-45-44: "I am trying to
move the large green object, but it is jumpy." The green object is homed one
crossing down, about 10 units across, sitting 60,078 units from its frame's
origin; he dragged it from four crossings down, at 254× and then 44×. The
journal's move records: total displacements of 1.3e-12 and 1.8e-11 units in
the object's own frame. Pointer handling was 5 ms median, 23 ms worst — not
lag.

**Cause.** The drag's coarser-than-camera branch (`_dragSelection`: "plain
translation is exact") adds the displacement straight into the object's
coordinates. Three crossings down, one screen pixel is 5.7e-14 of the object's
units; its y coordinates cannot change by less than one float64 step at
60,000, which is 7.3e-12 units:

| zoom | y step (coordinates near 60,078) | x step (coordinates near 1,200) |
|---|---|---|
| 254× | 127 px | 4 px |
| 44× | 22 px | 0.7 px |

At 254× the object sits still for the first 63 px of vertical drag and then
jumps 127 px, while following sideways in 4 px steps. The displacement is
recomputed from the drag's start (M-4), so it does not drift; it snaps to
that grid. Two crossings of separation would give 0.03 px steps; the floor
bites at three. The displacement itself is exact; adding it to a coordinate
60,000 units from its origin is not, once it is under half a step.

**Where the design stands.** The deep-move fix made a move from ABOVE an
object's home a change of address, exact by construction, with only the
sub-cell remainder (under one frame) reaching geometry. A move from BELOW the
home was left as plain translation on the argument that the displacement
shrinks by 4,096 per level — true of the displacement, not of the sum.

**Design, agreed with Kobin, not built.** Per-object, per-level offsets BELOW
the home: for each level finer than the home, an offset in that level's
units, bounded by half a frame, so it is always an exact, small float64
number. A drag at level c adds the displacement (exact in level-c units) to
the level-c offset; when it exceeds half a frame the whole-frame part carries
up — one level-c frame is 32 units of level c−1, exact — and so on; a carry
out of the level just below the home is a whole number of cells at the home,
which is an exact integer step of the coordinates or a change of address
(`_normalizeHome`). The home coordinates never absorb a sub-cell move made
from below. Recorded on the object with its home (serialised, undone with the
drag). Applied wherever the object is projected to a level — the render
chain's per-hop projection, hit-testing, the erase — as the offset expressed
in the target level's units, which for levels at or below the offset's own is
an exact power-of-two scaling and above it is a sub-pixel translation applied
at render time, never written into the coordinates. Kobin's constraints, in
his words: "the move is only handled locally"; a move at level 8 of a level-6
object "would not affect level 6 at all"; a move at level 5 "just re-assigns
which level 5 frame the level 6 frame with the object is in"; a move at level
6 "just changes the object's coordinates within the frame, or maybe the frame
it's in if you move it far enough." The last two are what the code does now.
Cost: two floats per level per object that has been moved from below; one
addition per coordinate per hop; no per-frame work; tiles invalidate on a
move exactly as they do now. Build it inside the one projection routine F42
makes both chains share, or it becomes a third way of doing the same math.

**Audited with Kobin (2026-09-04):** with this design, an object moved at every
level 0–200 still has its tiles generated bit-identically — each level from the
previous level's stored bits by the same fixed operations, the offset adding one
rounding of half an ulp per hop — provided offsets are applied only inside the
shared per-hop projection, never composed across levels, and move the object's
tile grid with them.

**Built, 2026-09-04** — `geometry/offsets.js`, whose header is the design in
full. The object carries `below`, a sparse array indexed by depth below its
home, `below[k] = [ox, oy]` in level-k units, each in [−W/2, W/2), absent
meaning zero; keyed by depth so a re-home or a carry disturbs nothing. Where
it enters:

* **The drag** (`selection._dragSelection`): a member COARSER than the camera
  gets `addOffset(base.below, camDepth − depth, tx, ty)` — the pointer's
  displacement in the camera's units, exact — recomputed from the drag's start
  like everything else (M-4). Carries are integers: `below[k] −= n·W`,
  `below[k−1] += n·G`, and out of level 1, `n·G` home units into the
  coordinates. Level with the camera: plain translation, as before. Deeper:
  `displaceFrame`, as before. The geometry snapshot (`snapGeometry` /
  `translateGeometry` / `setGeometryById`) carries `below`, so undo, redo and
  a cancelled gesture restore it with the coordinates. A member the drag
  cannot move is journaled with the reason (`skipped`, F35).
* **The hop** (`derive.deriveStep` and `classifyUp`, through
  `TileStore._offsetInto` as `opts.offsetOf`): `transformLoopsAbout(loops,
  cx, cy, f, ox, oy)` computes `(p − c)·f + o`, one addition after the exact
  part, and the tile phase becomes `tilePhase(childTilePhase(...) + o)` so the
  chop rides with the ink. With no offset the addition of 0 leaves every bit
  as it was, which the whole quick suite confirms. An object two or more
  levels below its home arrives at a hop as PIECES of the parent's tiles, so
  `_bakeUp` fetches its pieces from the pre-image shifted back by the offset;
  a native of the cell next door is found through a query grown by half a
  cell; a change to an object with offsets invalidates its chained tiles.
* **The residual** (`KobinEngine._buildList`): every piece in the render list
  is stamped `res`, the sum over the offsets DEEPER than the active level of
  `below[m] / R^(m − k0)`, and the renderer folds it into the origin the
  anchors are taken against (`_pushArea`, `_buildInto`, `_chopFor`, `_sig`).
  The hit test, the selection rectangle, the ants (`_selDecide`,
  `_selSeamRects`), the lasso's rects and ink test, and the test oracle
  (`__testkit__/ink.js`) all read it. One level up it is up to 16 units — at
  that level's deepest zoom, thousands of pixels; two up, at most a pixel.
* **The erase**: `_eraseMayTouch` and `_bakeOne` bring the eraser into the
  object's stored coordinates through the object's offsets
  (`LevelMap.mapRectObj` / `projectLoopsObj`, less the residual at the
  eraser's level); the descent subtracts the residual from the eraser at its
  last level and maps the ceded window up through the parent's offset; a kid
  inherits `shiftDown(parent.below, 1)`, a remnant keeps the table, a
  promotion (`scaleGeometry`) shifts it up one. `_familyComponents` and the
  join notes map the doorway the same way.
* **The file**: `below: [[k, ox, oy], ...]` on the object (`serializeNatives`,
  validated in `persist.decodeNatives`, decoded in `loadNatives`); old files
  have none and mean zero.

Measured (`move.below.test.js`, 17 cases): the ink follows the pointer to
1e-6 px from 1, 2, 3, 5 and 8 crossings below the home, with the home
coordinates bit-identical and `below[n]` exactly the frame displacement; a
40-event drag lands where a 1-event one does, table and geometry and edge
alike; there and back leaves no table and bit-identical geometry; undo and
redo restore both; a drag past 0.6 W carries `[0, G]` into the level above
and leaves `ty − W` behind, and out of level 1 steps a coordinate by exactly
G; one level up the picture is translated by `ty / R` on screen and nothing
jumps; the home level shows no change; hit-testing, an erase at the drag's
level, an erase one level above it (the residual), a ceded family (every
member's table holds the same displacement at its own depth) and a save-load
round trip all see the moved picture. `move.deep` and the whole quick suite
unchanged; two tests in `move.drag` and `KobinEngine.edit` that asserted the old
behaviour — a from-below drag changing the home coordinates "by a sub-frame-unit
amount (30px / ~3000)", which is exactly the mechanism replaced — now assert the
new invariant, and `erase.matrix` MX-5 and `select.multilevel` SM-6, which
measured where a member is by mapping its STORED coordinates up, measure the
picture instead (`__testkit__/harness.js` `objPointIn`: through the offsets,
plus the residual). Seen in the in-app Chrome (2026-09-04, the painted SVG
hit-tested with `elementsFromPoint`): three crossings below a stroke's home, a
40 px drag moved its painted edge 40.000 px (39.99999999, the probe's
resolution), `below[3]` came out `[0, 320]` (40 px over the 0.125 zoom, exact)
and the home's first coordinate was untouched. Not yet felt on the phone.

What the plan got slightly wrong: the offsets did not go into a merged
projection routine, because F42 left no such routine — the erase reads the
store — so they went into the hop itself (`deriveStep`), which is the one
place every level's tiles come from, plus the residual for what the hop
cannot hold.

<a id="f43"></a>
### F43 — FIXED 2026-09-05, lines and arcs (unverified by Kobin). A cut on a long straight piece moves that piece's picture far away at depth.

*The one arc case that stayed open on 2026-09-05 (below: the boolean chording
an arc the chain kept) closed on 2026-09-06 with F44's radius gate — one
rule for the chain and the boolean — and the join-arc probe case passes with
the rest.*

**Arcs, built later the same day (Kobin: "Please fix arcs, too. Did you run
into an issue, or were you just not working on it?" — the latter: the design
below had deferred them to F44, and no attempt had failed).** A cut arc keeps
the arc it was cut from, `K` — the angles and the end points the piece would
have at this level had nothing cut it, which is exactly the piece the chain
would have made — and its own extent as positions `ua` < `ub` on K. The chop
runs on K and trims each of the chain's fragments to the piece's stretch; the
freeze is the chain's decision on the canonical fragment, and where it freezes
the piece becomes a cut LINE on that chord; after every window clip the
canonical arc is re-anchored to the fragment the chain would have clipped
(`reanchorCutArcs`, mirroring `reanchorCutLines`); the boolean straightens by
K's bulge and cuts along K's chord when it does. K is never reversed, and a
cut arc's own ends stay the points the erase made — at depth a point on a
circle of radius 1e16 recomputed through the centre is quantised by units
(F44), and mapping a point is exact. Code 3 in the file, version 2. Measured:
the slanted arm is bit-identical at 4 and 5 (it was 0.0946 off at 4); the
horizontal arm as before. In the quick suite, a nick at level 2 on the slanted
arm's arc leaves the level-4 pieces bit-identical (`erase.depth.test.js`), and
`arcShape.test.js` AS-9 pins the representation: the fragments of a notched
circle carry the uncut arc and their positions, a second cut keeps the same
K, transforms move K's ends as points, a reversal leaves K alone, and the file
gives it back bit for bit.

**The one arc case that stays open, and why it is F44's.** The boolean's
flatness test (`straighten`: `r·(1 − cos(sweep/2))`) is exactly 0 in float64
for any sweep below ~1e-8, so an erase on such an arc replaces it by its chord
whatever its real bulge — 2.1e-4 units on Kobin's join arc at level 3 (r =
4.97e12, sweep 1.84e-8) against a tolerance of 1.2e-10 — and the picture one
level down moves by up to 0.86 units, two levels down by 3,500, while the
chain, which never cut it, keeps the arc. That is the join-arc probe case
("numbers 35 vs 50" at level 4). It was tried with the bulge form the freeze
uses, which measures the bulge correctly: the join-arc case then came out
bit-identical at 5 — but the erase now had to cut the arc through a centre
1e12–1e16 units away, whose ulp (5e-4 units at level 3, 2 units at level 4)
is worse than the chord's error, and the level-4 nicks in the probe's
moderate-zoom block stopped taking ink. So the chord is the more accurate of
the two representations the boolean has at those depths, the old test stands
with a comment saying exactly this, and the case closes when F44's layer 1
makes the freeze chord the same arcs the boolean does (then the two agree and
a nick moves nothing but the nick) or its layer 3 cuts arcs without their
centre.

**The fix, built 2026-09-05 together with F55 (Kobin: "they are related and
should be updated and tested together").** A line piece carries its CANONICAL
line — `P`, `Q`, the endpoints it had when it was chopped from its parent,
before any erase — beside the stretch of it that survives, `sa`, `sb` in
[0, 1] along `P`→`Q`; `A` and `B` are `canonAt(sa)` and `canonAt(sb)`. An
eraser's boolean finds its crossings on the canonical line (`cutLine`, with
the parameter `t`) and the fragments inherit `P`/`Q` with new `sa`/`sb`
(`shareCutEnds` keeps the two sides of one cut on one number); a window clip
does the same and re-anchors its ends to the canonical line afterwards
(`clipShapeToRect` → `reanchorCutLines`); the hop maps `P`/`Q` down a level
exactly as it maps `A`/`B` (`mapLine`, ends recomputed per level). So the same
numbers reach every level below whether the line was nicked or not. A line
with no `P`/`Q` is its own canonical line, so every existing drawing reads
unchanged; a cut line is written as code 2 and makes the file version 2
(`persist.js`), which a version-1 build refuses with a clear message — only
a drawing that holds one is written that way.

**Measured.** Kobin's corner scenario (`depth.corner.probe.js`, the
horizontal-arm case, the one that reached level 8 before the fix and emptied
its tile): after a 12-px nick at level 3, the pieces at levels 5–8 are
BIT-IDENTICAL, the edge's screen position at level 8 is the same to the last
digit (280.254668604357 → 280.254668604357, 0 px moved), and the incremental
tile update matches a full rebake at every level; level 4 differs only in
structure (the kid's window lines), level 3 holds the kid. In the quick suite
(`erase.depth.test.js`): a 20-px nick at level 2, 300 px along a slanted
edge, leaves the level-6 pieces bit-identical — the case that measured 136
units on 2026-09-04. As first built (the morning's line-only version) arcs
were NOT covered: the slanted-arm case's edge at level 4 is an unfrozen arc of
radius 2.6e16, the nick re-parametrised it, and the point where its
seam-overhang line meets the padded window differed by 0.0946 units one level
below the nick; the join-arc case differed at 4 and 5. The arc build above
closed the slanted arm; the join arc is the F44 case described there, and the
probe's `expect(same)` passes for the two arms and fails for it.

*The measurement and the mechanism, as first written:*

Found 2026-09-04 while pinning F42, measured in jsdom, no browser report. A
slanted stroke at level 0, the camera six crossings down on its top edge; zoom
out to level 2 and erase a 20 px nick 300 px along the edge; zoom back: the
level-6 pieces are not the same — the edge line runs 136 units from where it
did (`erase.depth.test.js`, the second test, records the number).

The boolean splits the edge's line segment at the eraser. The new endpoint is
a crossing, rounded at level 2; the remaining segment from it to the far end
is the same line to 1e-12 units there, and the tile chain interpolates its clip
vertices from those two endpoints at every level below, magnifying the
difference 4,096× per crossing. A line defined by its two endpoints cannot be
cut anywhere without being redefined everywhere along it. Arcs are the same
(`subPiece` re-parametrises the angle); the render's own clips do it at every
level too, which is what makes the picture at depth deterministic rather than
exact, and why F42 had to reuse the render's bits.

Not a regression — the in-place cut always did this, and the old cede chain
worse — and not visible unless someone has zoomed several levels into a piece
and then cut it far away at a coarse level. The fix is a representation
change: a line (and an arc) that remembers the points that defined it, so a
cut moves only where the cut is. Not designed; nothing else on the list needs
it first.

**Measured to level 8, 2026-09-05** (`depth.corner.probe.js`, Kobin's
corner-invalidation scenario: a corner zoomed to level 8, then a 12-px nick at
level 3, 300 px along the edge — 6.8e-11 level-0 units away). The picture is
NOT bit-identical, and the divergence is geometric: level 5 differs by 3.7e-5
units (invisible), level 6 by 0.083 units, level 7 by 342 units, and at level 8
the edge has left the tile entirely — any detail drawn against that corner is
orphaned. The mechanism is exactly the one above: the cede replaced the piece
[tile edge → corner] by [notch → corner], same infinite line, different `A`,
and the next hop's cut interpolates from `A`. Axis-aligned lines are immune.
Incremental tile updates and a full rebake agree bit for bit at every level, so
this is the representation, not the cache. What has to change: every piece
carries its CANONICAL extent — the endpoints it had when it was chopped from
its parent, before any erase — and deep cuts are computed from those, the
severed extent only choosing which cuts fall inside. The F44 chord form must
use the canonical chord too, or it introduces this for arcs while fixing F44.

<a id="f48"></a>
### F48 — FIXED 2026-09-05. A press while a stroke was still open abandoned that stroke; a lost touch locked the app in pinch mode.

Found on 2026-09-05 by driving the REAL pointer path in Chrome — synthetic
`PointerEvent`s dispatched on the host, through `hooks/useKobinEngine.js`,
rather than the engine API the suites call. Two pointerdowns with no pointerup
between them: the first stroke stayed in the document as a `stroke`, in
`Document._pending` for ever (never finalized, never indexed), with NO undo op —
the op is pushed at pen-up — so Ctrl+Z removed the SECOND stroke and the orphan
stayed; `_ensureShapeBakes` later baked it to a shape, still pending. A
pointerup goes missing whenever the button is released over another window
(alt-tab, the Windows key, a system dialog) or the OS takes a touch without a
`pointercancel`. For touch the hook made it worse: the lost pointer's id stayed
in `pointers`, so `pointers.size` was already 1 and every later single finger
was "the second finger of a pinch" — nothing could be drawn until a reload.

The fix: `_pointerDown` finishes an open stroke the way a pen-up would before
starting the next (and drops a select press or lasso left behind by a tool
change mid-press — a second finger tapping the toolbar); the hook ends the
gesture and forgets every pointer on window `blur` and on the tab being hidden
(`resetGesture`: a moved select drag commits, a mere press is dropped).
Measured after the fix in Chrome: two pointerdowns give two finished strokes,
two undo ops, nothing pending. `gesture.robustness.test.js`.

<a id="f49"></a>
### F49 — FIXED 2026-09-05. Delete on a lasso selection needed one Ctrl+Z per object.

`deleteSelection` called `_eraseWhole` per selected id and each call pushed
its own undo op. Measured: lasso three strokes, Delete, three ops on the stack;
one Ctrl+Z brought back one stroke. It now removes every member of every
selected family, collects the records and pushes ONE `eraseMany`, which is what
the eraser tool already did for a family. `gesture.robustness.test.js`.

<a id="f50"></a>
### F50 — FIXED 2026-09-05. After a drag that carried an object into the next cell, the ants vanished and the next tap on it deselected.

Measured at the shallowest zoom with a stroke a thousand units inside the root
cell's right edge, dragged 1,920 units: `_normalizeHome` re-homed it to the
neighbour cell (growing a parent above the root, as designed) and shifted its
coordinates by a whole frame — AFTER `_dragSelection`'s last render. The
picture on screen was right, because a re-home is a pure change of address, but
`_lastList` still held the object as a native of the old frame with loops now a
frame away from where the list said: `_hitTest` at the ink returned null (so a
tap deselected), `_selectionAnts` found no runs (the screenshot shows the moved
stroke selected with no indicator), and both stayed that way until the next
pan, zoom or stroke. `_pointerUp` renders once more when any member re-homed.
After the fix, in Chrome: the hit test finds the object at its new place with
no other action, the list holds it as a `derived` piece, the ants are up.
`gesture.robustness.test.js`.

How often: a drag re-homes whenever the object's centre crosses a cell
boundary at its own level — at the shallowest in-level zoom a cell is 4,096 px
across, so a 400 px drag does it about one time in ten per axis.

<a id="f51"></a>
### F51 — FIXED 2026-09-05. Undo of a move — and a pinch-cancelled drag — left the drag's tile phase on the object.

`Document.snapGeometry` records `tile: null` for an object that has never had
a phase (every freshly drawn stroke); `translateGeometry` mints
`[phase(dx), phase(dy)]` for the drag; `setGeometryById(id, snapshot)` — undo's
and `cancelSelectGesture`'s way back — assigned `tile` only when the snapshot
had one. So after drag + undo the coordinates were the originals and the phase
was the drag's. Measured: the only serialized field that differed between the
object before the drag and after the undo was `tile: [1920, 0]`. The phase is
where the object is chopped and therefore where a curve may freeze (bible
D4/6.6): with it left behind, the grid no longer rides with the ink, the chops
and freezes below land elsewhere, and the deep picture after drag + undo is not
the one from before the drag — the locality rule broken by an undo. The same
applies to `attachRect`. A snapshot that carries the key with nothing in it now
writes the field back as absent. `gesture.robustness.test.js`: drag + undo and
pinch-cancel both leave the object bit-identical, phase included.

<a id="f52"></a>
### F52 — FIXED 2026-09-05. Ink seen from another level picked with no slack.

`_hitTest` gave a native shape the 6 px slack ring (`_shapeHit`) and a stroke
`+ slack`, but a `fill` — which on screen is almost always a TILE PIECE, ink
seen from a level other than its home — was tested with bare `windingOfPoint`.
Measured on the F50 stroke: picked at 13 px off its centreline at home, missed
at 9 px once shown as a down piece from the neighbour frame. Fills now get the
bounding-box test (a piece can carry thousands of vertices) and the same ring.
`gesture.robustness.test.js`.

<a id="f53"></a>
### F53 — FIXED 2026-09-05. A render that landed mid-stroke painted the live stroke twice.

The growing stroke is a native of the active frame, so `ownContent` returns it
and `Renderer.render` built a raw group for it — beside the `_live` path that
is its picture until pen-up (`_strokeMode` only chose "raw" for it; nothing
skipped it). Measured in Chrome: a highlighter stroke with Ctrl+Z pressed
mid-gesture had two paths — one at group opacity 0.45, one at stroke-opacity
0.45 — and the screenshot shows the part drawn so far at 0.70 and the rest at
0.45 until pen-up. A render lands mid-stroke from Ctrl+Z/Y, from a window
resize, and from the idle outline fit that every pen-up queues: it fires when
the pen is already down again on a fast second stroke, whenever any fat-gated
stroke exists — and at inScale 0.46 a 13 px pen is fat-gated. `render()` now
skips `_liveModel`. Measured after the fix: one path mid-stroke, the
highlighter uniform. `gesture.robustness.test.js`.

<a id="f55"></a>
### F55 — FIXED 2026-09-05 (unverified by Kobin). A move loses registration with detail three or more levels below the level it is made at.

**Built 2026-09-05, the design below as Kobin refined it.** A move is address
arithmetic and nothing else: no stored coordinate changes, at any level. The
displacement, snapped to 2^-10 units at the move level, goes into the object's
table (`geometry/offsets.js`: `below[k]` for k ≥ 0, depth 0 the home level,
carries as integers, a carry out of depth 0 a re-home to the neighbour cell —
`_dragSelection`, `Document.setOffsetsById`). The tiles are UNMOVED SPACE:
nothing about a move enters a bake (`deriveStep` has no `offsetOf` any more)
and the chain runs on the same bits before and after. Where a moved object's
picture is read from is decided when it is read: `LevelMap.objShift` turns the
table into the frame to fetch from plus a sub-frame remainder,
`TileStore._reroute` fetches the pieces from that frame over the window less
the remainder, paint applies the remainder (`piece.res`), and every input into
the object's geometry subtracts it (`mapPointObj` / `mapRectObj` /
`projectLoopsObj`: the hit test, the lasso, the eraser's rect and loops, the
cede descent's need, the family's contact test). A ceded kid takes the table
shifted to its depth (`shiftDown`, which counts each entry once — a
double-count found on the way showed as an erase at the drag level missing
the moved ink). Measured in jsdom (`move.registration.test.js`, the probe
turned into a test): the coarse object's pieces four levels below the move are
the same bits in the new frame, the star's bits untouched, their gap unchanged
to 1e-9 — the two cases in the table below now read 0 and 0; `move.below.test.js`
(17 cases) and `move.deep`, `move.drag`, `select.lasso`, `objectTiles`,
`KobinEngine.edit`, the layered/neighbourhood/multilevel slow suites re-pinned
from "the coordinates moved by d" to "the picture moved by d", read through
`objPointIn`. What it costs: one translation per piece at paint, one inverse
transform per input, both already threaded for the levels above a move.

**This changes the derivation** (see the compatibility note on `deriveStep`):
a drawing saved with an F41-era table would draw its moved objects where F41
put them only if the hop still added the offset. F41 was never deployed, so no
shipped drawing carries a table; the next deploy is still the first
compatibility event of the tile chain and needs Kobin's call (ROADMAP §2).

*The measurement and the design, as first written:*

Kobin's question (2026-09-05): draw a star in a corner of a coarse object
twenty levels down, move the object and the star together from level 2 — the
star must still be in the corner. As built it is not, and the arithmetic says
why. A move at depth j adds the displacement into the coarse object's numbers
ONCE: a plain translation of its coordinates when j is its home level, or
`below[j]` added inside the hop into level j on F41's path. Either way that one
addition rounds — by half an ulp of a coordinate at level j, up to 7e-12 units
near the frame edge — and every level below re-derives from the rounded value,
magnifying the rounding by 4096 per level. The star, a native of a deep frame,
moves by address digits and a sub-frame remainder, which reconstruct the
displacement to the last bit. So the two part: by nothing at j and j+1, by
about a hundredth of a unit at j+2, half a unit at j+3, and thousands of units
at j+4 — twenty levels down, by any number you like.

Measured in jsdom (`move.registration.probe.js`, a horizontal 20-unit stroke at
x ≈ 60,000, a 4-unit stroke drawn 30 px above its edge four crossings down,
both selected and dragged 37.3 × 13.7 px):

| move made at | small stroke at | gap change, in the deep level's units | on screen there |
|---|---|---|---|
| level 0, the home (plain translation) | level 4 | 3.25 | 832 px at the deepest zoom, 0.1 at the shallowest |
| level 1 (F41 offsets) | level 5 | 1,229 | 315,000 px at the deepest zoom, 38 at the shallowest |

The home-level number is small only because the rounded coordinate was y ≈ 290,
whose ulp is 5.7e-14; the prediction from that single rounding, printed by the
probe, matches it. The F41 number is a level-1 coordinate near the frame edge
rounding at 1.5e-11. This is not a defect in the digits or the carries, which
are exact, and F41's audit — the same stored bits always give the same tile —
still holds. It is the one rounded addition that the chain inherits. It is
also, in all likelihood, F35: an object in a corner at level 5, moved together
with smaller objects, no longer in the corner afterwards.

**The fix, designed, not built.** The displacement never touches stored
coordinates and never enters the chain. F41's table already holds it exactly —
integer frame digits per level plus a sub-frame remainder, from
`displacementDigits`, the same expansion the star's own move uses — and the
carries into whole cells stay as they are. What changes is where the remainder
is applied: at PAINT, as a translation of the derived picture (`piece.res`,
which the renderer, the hit test, the lasso and the ants already honour for
the levels above a move), and INVERTED on every input that reaches the object's
geometry (an eraser projected into its coordinates, a hit test, a lasso), at
every level from the move level down. The tile lookup below the move shifts by
the whole-frame digits, which `_bakeUp` already does for one hop. The chop
grid then rides with the object by construction, because the chop runs on
untouched bits. Result: the coarse object's picture at every level is the
pre-move picture plus an exact translation, and it parts from the star by the
paint's own rounding — 1.5e-11 units in the deep level's units, never
magnified. A home-level move needs a remainder entry at depth 0, which the
table does not have today. Cost: one translation per piece at paint, already
threaded for the levels above; one inverse transform per input.

**Kobin's refinement (2026-09-05): snap the displacement.** A raw pointer
displacement has 53 significant bits and takes five levels of 12-bit cell
digits to become whole cells. Nobody can feel that. Snapped to 2^-10 units at
the move level — a quarter pixel at that level's deepest zoom, far finer at any
shallower one — it is whole cells from THREE levels below the move: the
remainder is d itself at the move level, a multiple of 4 units one level down,
a multiple of 16,384 two down, and exactly zero after that. So the paint-time
remainder lives on two levels instead of five, and from the third level down a
move is pure cell arithmetic: a native there has its address changed and its
coordinates never touched. What snapping does NOT buy is putting the
displacement back into the hop or into a coordinate: the chain's coordinates
carry 53 bits at every level, and adding even a coarse displacement to one
drops its low bits whenever the sum's exponent grows (a coordinate at 2^14.9
plus 8 units lands in the next binade and loses a 2^-38 bit — 1,024 units four
levels down). The paint-time application stays; only the band shrinks. The
grid is fixed per level, not per zoom, so the same move gives the same digits
every time. This changes
F41 as built and its statement in `geometry/offsets.js`, and it is a change to
the derivation path (see the compatibility note on `deriveStep`).

<a id="f56"></a>
### F56 — FIXED 2026-09-06 (unverified by Kobin). An erase below two moved objects flooded one of them over the whole tile.

**Seen.** Kobin, 2026-09-06, in his Chrome on the working tree, reports
06-16-21 (after an undo) and 06-16-24 (after the redo): "I erased an object
and the whole object disappeared." Two objects homed at level 1, both dragged
eleven times at level 10 so their tables carry whole-frame digits at every
level, then a 4-px eraser scribble at level 10 on the tan one, 300 px from
the dark one's edge. Replayed in jsdom bit for bit: the tan one was ceded
nine levels and nicked correctly; the dark one — whose ink the eraser never
reached — was ceded nine levels too, and its level-10 kid was a solid square
minus the notch where the render's piece for that square is a wedge (area
1.72e10 against 1.48e10). On screen the dark colour flooded the region where
only the tan had been.

**Cause.** Since F55 the square a link reads is the erase rect less the
remainder, in the unmoved frame's numbers; a remainder up to half a frame
puts it in the unmoved frame's NEIGHBOUR as often as not. The kid was homed
in the camera-path frame F with its ink in cell (i, j) of it. Its child tiles
were then derived through the store's ring projection — a native homed next
door reaches a frame's children by an up-then-down hop, x/R + c then
(· − c')·R, which loses the low bits of x/R against the cell centre — while
the chain had derived the same ink by the exact direct hop. At depth the
only "same" is the same bits (F42): the level-7 kid's edge line ran parallel
to the chain's 2.5 units away, the level-8 kid held 2% more ink, the level-10
kid was solid. For the tan object every square was the frame's own cell
(no digits in its table) and every kid matched the chain. Before F55 the
erase's square was the camera frame's own cell except at a cell edge, which
is why it never showed.

**Fix.** A square (i, j) ≠ (0, 0) belongs to F0's neighbour: the kid is now
minted from that neighbour's own piece for its own cell (0, 0) — the very
piece the chain below reads — and homed in F's neighbour (i, j), so its
child tiles derive by the same exact hop as the chain's. The hole in the
parent maps up from the owner; the eraser is translated into the owner's
numbers; nothing else changes. Replayed on the reports: the dark object is
refused at the last link ("grazing: nothing removed") and unwound (F47), one
native, no kids, the wedge painted exactly as before; the tan one's nine kids
are the chain's covering squares, the last one the square less the notch.
Pinned as `reported.regress.test.js` RR-9 (skips when the reports are
absent). A pre-F55 test that looked for a kid in the camera frame after an
erase at a cell edge now finds it next door, where it belongs
(`move.drag.test.js` M-10).

<a id="f54"></a>
### F54 — CLOSED 2026-09-07, by decision. A wheel tick during a stroke ends the stroke and drops the rest of the gesture.

Kobin, 2026-09-07, asked which behaviour he wanted: *"It can just end like it
does today. Eventually, we'd want it to keep drawing as you zoom even past a
level, but that's a future feature, not a current bug."* So this is the
designed behaviour and the flag closes; the future feature — a stroke that
continues through a zoom, crossings included — is on the roadmap's UX list.

What was measured, kept for when that feature is built: `Camera.zoomFactorAt`
calls the `finalizeLiveStroke` hook on EVERY zoom, in-level included; the
comment on `_maybeShift` describes crossings as the thing that finalizes. A
highlighter stroke, one wheel tick after thirty moves — the stroke was
finalized on the spot, the next thirty moves drew nothing, the pointerup did
nothing. Desktop and trackpad only (a pinch mid-stroke is handled by the hook
explicitly). Continuing through an in-level zoom would be one condition in
`zoomFactorAt` (finalize only when the new scale leaves [exit, enter]) — the
live path's anchors are origin-relative and the camera is a transform on
`world`, so the path would follow. Continuing through a CROSSING is the real
feature: the live stroke would have to change frames mid-gesture.

<a id="f57"></a>
### F57 — OPEN, high. An eraser at depth on a big drawing never finishes, and the tab locks while it tries.

2026-09-08, evening — three of the four causes built out (DESIGN.md §7 "Order, gate and
the worker"): (1) the target scan walked every object of the document per mark
(0.6 ms each; five minutes a mark on the 12,849-object canvas, a second a pointer-up)
— now the spatial index, top-down by z; (2) the boolean's classifier was quadratic
(every fragment against every piece: 2.6 s a cut against a 1,205-piece eraser
perimeter) — now `RayIndex`, 175 ms; (3) the cut ran on the main thread — now one job
at a time in `public/erase-worker.js`, results applied on arrival, the barrier
synchronous. Seen in Kobin's Chrome on a scratch engine: cuts 10–16 ms in the worker,
applied in ~1 ms. NOT yet: the rehome descent's cedes still run on the main thread
(125 ms a step measured on the export). Kobin, the same evening: the descent goes to the
worker as one job per family — BUILT the same night (`eraseDescent.js`, DESIGN.md §7): the
descent runs on a virtual document, in the worker where there is one, and
`_applyDescent` swaps the family in when the steps land; a target moved meanwhile is done
again. The depth, regression and fidelity suites are the bit-exactness oracle. The "one
cede for a flooding coarse object" idea is dropped at his word. Re-measure on the canvas
itself before closing.

Measured 2026-09-07 in Kobin's Chrome on canvas `mtqha19c7qjn` (11,497 natives over 20
frames and thirteen lattice levels, drawn by another Claude session; see ROADMAP
"Saving and memory at scale"). The document carried eleven eraser marks that had never
baked, plus one of mine. A hand-driven loop of `_bakeTick()` for 20 s: 81 steps, none
under 10 ms once the shape bakes were done, 0.64–0.78 s each and 2.5 s for one, every
one a `rehome` (the cede descent, `_bakeRehomeInner`) — and the pending count stayed
at twelve. Left to its timers the tab was then unresponsive for over 45 s at a stretch.
The 8 ms slice budget cannot help: a single target is indivisible, and at a deep scene
a coarse object whose magnified band covers the whole view is a target of every eraser
stroke, each one a descent through six to eight levels of tiles.

What is NOT known yet: how many targets one of these strokes has, and whether the
0.7 s is the descent's tile baking (`_squareInk` → `_ensureUp` at every level) or the
boolean. Both are instrumented already (`perf` op `rehome`, `_rehomeWhy`); the next
step is a replay of one of these strokes in jsdom with the reports' recipe once a
report can be sent (F58). Design options are in the roadmap entry. One more
thing measured the same day: the bake runs on `setTimeout` chains, which Chrome
throttles in a hidden tab to once a second and, after five minutes, once a minute
— the other session drew this canvas from a background tab, which is the likeliest
reason eleven eraser marks were still pending when Kobin opened it. A worker
would sidestep that as well as the locking.

**Reproduced on the desktop from the phone's own document, 2026-09-07.** Report
`23-54-04` (2,996 natives, five unbaked 4-px marks at level 7) loaded into a
second engine in Kobin's Chrome and left to the timers: the five marks took
1,447 ticks and 247 s of main thread over about five minutes, with single ticks
of 109 s, 44 s, 10.8 s, 8.1 s, 7.7 s and 7.1 s — the phone's three outliers
(6.9 + 2.7 + 1.6 s, the "unexplained" line in 10-STATUS) are this. Profiled over
a 15 s window: `_bakeOne` 190 calls, 13.3 s, max 2.7 s; of that `_removedArea` —
F46's local measurement of what a cut removed, an intersection boolean on top of
the subtraction — 6.3 s; the cede descents 0.8 s. So on this document the cost
is in-place cuts of many small level-7 objects and a few tile-sized kids, and
the grazing test doubles each one. Clipping the subject to the eraser's box
before that intersection would take most of the second half away; not built.
On canvas `mtqha19c7qjn` itself, the first measurement's "every step a rehome"
is F63's doing: after the z rewrite its marks can target level-0 objects only.

**Resume, 2026-09-08.** With the kobin-2 store an interrupted erase resumes
where it left off: each bake step is a log entry, and on load the mark's done
set is rebuilt from them (`oplog.js`), so a tab closed mid-bake costs nothing
but the step in flight. Seen in Chrome: a mark left after two of four steps
finished the other two on reload. The cost of a step is unchanged.

<a id="f58"></a>
### F58 — OPEN, medium. A diagnostic report of a big drawing cannot be sent.

The same canvas: `snapshot()` takes 0.73 s and `JSON.stringify` of it 1.5 s and makes
a 92 MB string (96,455,585 bytes), lifting the heap from 587 to 869 MB. The report
server refuses any body over 20 MB (`req.destroy()`), so the fetch rejects and the
button says Failed; nothing reaches `.kobin-reports/`. Fix: the report should not carry
the whole document — a header, the journal, the instruments and only the frames the
camera has visited (or a size cap with the snapshot dropped and said so), and the
server's cap raised to match; a report that cannot be sent is a report that says why.

<a id="f59"></a>
### F59 — OPEN, medium. A cold render of a busy view takes seconds.

The load-time render of the canvas above: 7,987 ms for 882 pieces on screen; a full
render of the same list with nothing changed, 87 ms (`_buildList` 4, `render` 69,
`update` 14). So the whole cost is building the Two.js paths of 882 groups, about 9 ms
a group, and a crossing into a scene that was not retained pays it in full (the other
session measured 949 ms at 2,545 pieces). The signature memo and the one-render pen-up
of 2026-09-07 do not touch this. It is the case for a renderer that does not build a
DOM path per piece — the roadmap's "big fixes" note.

<a id="f60"></a>
### F60 — OPEN, low. The scale-bar dialog's Length field is a full-width bar at the bottom of the window.

`src/Stylesheets/boundless-ui.css` line 435 reads `.bl-scale-field .bl-input,` and
nothing follows it but a comment, so the selector joins the `.bl-toast` rule below and
the field inherits `position:fixed; bottom:5rem; left:50%; transform:translateX(-50%)`.
The other session measured the input at y=696, width 1504 while its dialog sat at
y 55–343. One line: finish the rule or delete the selector.

<a id="f61"></a>
### F61 — OPEN, low. A non-finite zoom anchor recurses until the stack overflows.

`Camera.zoomFactorAt` refuses a bad `factor` and not a bad `sx`/`sy`. The chain the
other session traced: a NaN anchor → `inPanX/inPanY` NaN → `_viewCell` → `cellOf` gives
NaN digits → `cellChild` takes the carry branch because `inDigit(NaN)` is false →
`carryDigit(NaN)` → `neighbour(id, NaN, NaN)` returns the same frame (`!NaN` is true) →
`cellChild` recurses on identical arguments. A real pointer is finite; the guard is
one argument short. Close it at either end: check the anchor beside the factor, or have
`cellChild` refuse a non-finite digit.

<a id="f62"></a>
### F62 — OPEN, low. Paths are emitted with `stroke="undefined"`.

Every filled shape path in the drawing's SVG carries `stroke="undefined"` (read off the
DOM in the in-app browser and in Chrome on 2026-09-07). An invalid paint value is
ignored, so nothing is visible; it is a `setAttribute("stroke", undefined)` in the
renderer's fill path and a few bytes per path.

<a id="f63"></a>
### F63 — FIXED IN THE DOCUMENT 2026-09-08 (`tools/zorder-compact.js`). On canvas `mtqha19c7qjn` new ink painted under everything and an eraser could only reach level-0 objects: the other session had rewritten every object's z.

Seen 2026-09-07 in Kobin's Chrome: a pen stroke and an eraser mark he made at
level 6 "failed". Both were in the document and in the render list (ids 12625
and 12581, the camera's frame, groups built). The cause is a data change the
other Claude session made and reported: `z = depth × 1e7 + id` on every object
of this canvas, then a full save, "to work around the cross-level z-order
trap". 7,726 objects carry a z above 1e7. A new object stores no z, so `_zOf`
reads its id (12,625), and the renderer sorts it under every rewritten object:
at the stroke's own points `elementsFromPoint` returns objects 7485 and 7486
(z 60,007,485 and 60,007,486); lifting the stroke's group to the top of the
SVG shows it, dark red across the bottom of the view, and putting it back
hides it again. The eraser is the same and worse: `_nextEraseTarget` skips
any object whose z is at or above the mark's, so a mark at z 12,581 lying under
86 rewritten objects at depths 1–6 — the ink he aimed at — can cut only
level-0 objects (130 eligible, plus 26 kids per level that earlier descents
minted), each one a full descent. That is why every bake step on this canvas
is a rehome (F57's first measurement) and why its marks never seem to do
anything. 36 objects drawn since the rewrite are hidden this way.

Not an engine defect by itself — the engine's rule is z = id (DESIGN.md, the
object model) and the rewrite broke it — but the engine assigns no z at
creation, so the moment a document stores z, new objects fall under. The fix
is Kobin's call: (a) restore z = id on the whole document (z − depth·1e7
recovers the id exactly, so it is reversible arithmetic), or (b) adopt
depth-major z and assign it at creation and in every cede (the roadmap's
Z-order item). Until one is done, drawing or erasing on this canvas does
nothing visible.

The same session: the tab had died with Chrome's "Out of Memory" page before
the diagnosis (F57's lock plus a 60 s IndexedDB write on the last autosave),
was reloaded from the OS, and read 691 MB of heap at load and 1,972 MB two
minutes later with the erase bake held. Its four pending marks were left
unbaked; a reload resumes them.

**Fixed in the document, 2026-09-08 (`tools/zorder-compact.js`), at Kobin's word
("just create a script to fix the zorder").** The script relabels every object's
z as its rank in the paint order the renderer already used (z, then id), 1 to
12,544, so the picture is unchanged; ids are untouched, so families, cedes and
undo are unaffected; the next id is 16,246 and a new object's z is its id, so
new ink lands on top. It posts the old z of every object to the report server
first (`.kobin-reports/report-2026-09-08T05-28-30-276Z.json`, kind
`zorder-backup`) and emits one `change` event per frame so the app's own
incremental autosave writes every frame (one write, 20 frames, 2.2 s). Verified
after a reload from the stored copy: no object without a z, min 1, max 12,544;
a pen stroke made through real pointer events sat at the top of the SVG and
painted, and undid cleanly. Two notes. Inside one session the renderer keeps
the z a group was built with, so the live page reorders only after a reload
(a stroke drawn before the reload still went under). And the fix is in the
LOCAL copy only: the cloud copy is stale because the sync cannot upload a
document this size (F64). Local wins on every open of this browser, so the
canvas is usable here; another device would pull the stale cloud copy. The
engine still assigns no z at creation, which the register's Z-order item owns.

<a id="f64"></a>
### F64 — FIXED 2026-09-08. The cloud sync of a big canvas failed inside the compressor, every 30 s, silently.

Seen on the 12,849-object canvas in Kobin's Chrome, later that day: the kobin-2 push
itself made Firestore's write stream answer `resource-exhausted: Write stream exhausted
maximum allowed queued writes` every minute for ten minutes, with the tab churning 2–3 GB,
because commits carried six 700 KiB parts and the 30 s tick started a second push while
the first ran. Now one push at a time (`CanvasEditor` `cloudBusyRef`, a 5 min deadline,
busy held until the SDK settles) and one part a commit (`canvasSync.PARTS_PER_COMMIT`):
the full push, 27 MB gzipped in 50 parts, took 120 s; the SDK still logs the error between
batches and retries through it.

**Fixed with the kobin-2 cloud copy (DESIGN.md §13).** The sync no longer
stringifies or compresses the document: it mirrors the local store, pushing
the frame snapshots newer than the cloud's and the log entries past its seq as
gzipped chunks (`CompressionStream`, no dictionary, no library) in 700 KiB
parts, the manifest last. A failed push is shown in the save bar with its size
and retried with a backoff from 1 min to 30 min, and the main-thread fallback
runs only where there is no worker at all (`lzWorker.js`). Seen in Kobin's
Chrome on a small canvas: a one-entry push is one 1.6 KB part in about a
second; wiping the local copy and reloading rebuilt the canvas, undo stack
included, from the cloud. Not yet seen: the 90 MB canvas itself, whose first
open on the new store migrates it.


Seen 2026-09-08 in Kobin's Chrome on canvas `mtqha19c7qjn` (12,542 natives, a
90 MB document): `cloud autosync failed RangeError: Too many properties to
enumerate` from lz-string's `_compress`, reached through
`encodeCanvasPayloadAsync` → `cloudSaveCanvas`, four times in four minutes.
The compressor's dictionary is a plain object and V8 refuses to enumerate it
past a few million keys, so any document over some tens of MB cannot be
uploaded at all. The only sign is a `console.warn`; the gallery shows nothing.
Each attempt also stringifies the whole document on the main thread, which is
why the tab went blank for seconds every half minute while it was open. The
cloud copy of this canvas is therefore behind the local one (the z relabel of
F63 included), and whatever the other session's "full save" uploaded is what
is there. Fix: compress per slice before chunking (each 700 KiB piece its own
lz block, or a codec that streams), and make a failed sync visible, with the
size that failed, instead of retrying the same failure every 30 s.

<a id="f65"></a>
### F65 — OPEN, medium. An object can be dragged out from under an eraser mark that never baked into it; the mark stays behind.

2026-09-08, evening — Kobin's decisions: an object under an unbaked mark cannot be
selected until the mark has baked into it (the barrier stays synchronous, and bakes an
object whose cut is in the worker on the spot); the mark's z steps down past what it
has handled so the gate is the z order; a mark whose targets are all refused is
consumed with the refusals on its journal note. Built with the erase worker (DESIGN.md
§7). His case ("the object I'm moving is a product of the erase, released while the
mark still bakes") is covered by design: a product inherits its parent's z and the mark
has already stepped below the parent. Not yet reproduced on his canvas; keep open until
he has tried it.

Kobin, 2026-09-08, late, after the F67–F74 deploy: "I'm still dragging already baked
objects under eraser bakes, which shouldn't be possible if the eraser goes down in
Z-order as it bakes." Seen on the big canvas (mtqha19c7qjn), whose z values were
rewritten by another session (F63) and whose cloud copy is still the stale one (F64),
so it may not happen in a regular file. TO CONFIRM, not to work on yet: reproduce on a
fresh canvas; if it does not reproduce there, check what `_zOf` sees for the mark and
the dragged object on his canvas.

Kobin, 2026-09-08: "selection isn't gated by eraser bakes being completed,
which is wrong - the eraser never baked into an item, but I can still move
the original object out from under the eraser stroke." No report; the canvas
is not named.

The gate exists. A select bakes every pending mark above the hit object
before it selects (`select` → `_flushErasesFor`), and a drag settles every
mark over everything in the selection before the first move, then consumes
the marks with nothing left to cut (`_beginSelectDrag` →
`_settleSelectionErases`, 2026-09-03). What he saw is a mark the gate let
through, and the code lets one through in four ways, each leaving the mark
painted over the ink and the ink free to move:

1. **z.** A mark at or below the object's z is skipped, by the rule that an
   eraser cuts only what is under it. On canvas `mtqha19c7qjn` every mark
   made before the 2026-09-08 relabel ranks below the ink it was aimed at (the
   relabel kept the paint order F63 had broken), so its four pending marks can
   still reach level-0 objects only, and a drag of anything else ignores them.
2. **The box prefilter.** `_eraseMayTouch` projects the mark's box into the
   object's frame; no overlap, or no frame path to project along, marks the
   object done for that mark.
3. **A bake that returns without a cut.** `_bakeOne` marks the object done
   first, then returns false when the eraser cannot be projected, when the
   removed area is under the graze bar, when the boolean yields nothing, or
   when `_bakeRehome` refuses. The object then counts as handled.
4. **Cost.** The flush is synchronous on the pointer path; at depth on the big
   canvas one step is 0.6–2.5 s (F57). It does run, it does not give up, so
   this one only delays the drag.

So the gate is by result: a mark that could not cut is treated as not
touching. Kobin's report says it should be by intent: a mark whose box covers
the object either blocks the drag until it has cut (with a refusal visible,
not a paper-coloured stroke that looks like ink) or travels with the ink.
Which of the four he hit needs a report: the erase note's `refused` and
`spent` and `_bakeDone` name the reason per object.

<a id="f44"></a>
### F44 — FIXED 2026-09-06 (unverified by Kobin). Arcs at depth are positioned through their centre; the freeze that should have removed them refuses every piece on a tile line.

**Built 2026-09-06, to Kobin's rule.** "Can't that just become a constant arc
radius, for the tile diagonal length, where that is true? Then you can just
gate it on if the arc radius is greater than that amount, in tile units." And:
"Erasers shouldn't need to re-calculate a freeze — if it's frozen it's frozen.
Every arc over that radius in a tile should be frozen." So the freeze is one
number: `freezeRadius(tol)`, the radius at which an arc's bow over a tile's
diagonal is exactly the tolerance (about 8.8e12 units at a quarter pixel; a
tile is the same size at every level in its own units, so it is the same
number at every level and in every cache square). At or above it an arc
freezes wherever it is in the tile; below it it stays an arc; the one guard
left is that both ends lie between the lines the chop applied, since a stub
beyond the outermost line was not cut at every line that crosses it. Nothing
else is consulted: not the piece's own bow, not the seam marks, not the
window. A nick cannot change the decision, because a fragment has its arc's
radius; neighbouring squares cannot disagree, because they hold the same
arc. The boolean's "is this arc flat" test — its own formula until now, and
one that read 0 for any sweep under ~1e-8 — is the same gate and nothing
else, so an erase stands in for an arc by its chord exactly where the chain
would have frozen it (the only arcs above the gate that can reach an erase
unfrozen are an object's home-level pen arcs, which no chop has seen).

The one piece of layer 3 the gate needed: an arc at or over the gate is about
to freeze, so its grid cuts are the ends of its frozen chords and the level
below inherits them. Found through the centre they were wrong by its float64
step, and a horizontal line across the top of such a circle turned an
8-unit step into thirty through the arcsine. Those cuts are now found in the
arc's own chord frame — the circle written from its chord and its bulge,
h(a) = ((L/2)² − a²)/(d + √(r² − a²)), a quadratic solved stably and polished
by Newton — with the cut coordinate set to the line exactly (`chordFrame`,
`chordCuts`, freeze.js). An arc under the gate is still cut through its
centre, which is at most 8.8e12 away: a thousandth of a unit.

**Measured (jsdom, `freeze.gate.test.js`, `depth.corner.probe.js`).** The join
arc, the slanted arm and a gentle curve each descend eight crossings on their
edge with the edge re-found after every crossing to within a twentieth of a
pixel; until this the two arc cases lost their edge at the fifth crossing.
The frozen line at level 4 sits on the circle through the level-3 piece's
own ends to 0.000 px. No arc survives past level 3 (radii 6e12 there, 2e16
one level down). All eleven corner-probe cases pass, the join-arc case
included — the arc half of F43. The chop's decision is pinned in
`objectTiles.test.js` OT-3 as the rule itself. What the jsdom instrument
cannot do: its winding test locates an arc through the centre, and at
r = 5e12 that is 0.9 px off the circle through the ends at the level's
deepest zoom; the gate tests locate edges the way the picture defines them
(a line, or the circle through an arc's ends), which is what the browser
draws. Not measured in a browser: Kobin's green stroke at 4 → 5 is the
acceptance.

**Layers 1 and 2 as designed below are superseded by the gate; layer 3
remains only where it is not needed** — the clip's `circleSegment`, `paramOf`
and the winding query still go through the centre, for arcs under the gate,
where the centre's step is at most a thousandth of a unit. The compatibility
consequence stands: this changes which pieces freeze in every existing
drawing (ROADMAP §2, the 1.0 decision).

**The rule's one cost, measured — decided 2026-09-07: Kobin keeps the radius rule, cost accepted.** The radius rule freezes
later than the per-piece bow did: a fragment whose own bow is under the
tolerance but whose arc is under the radius stays an arc, typically for one
or two more levels. The chop cuts arcs at every grid line and never cuts
lines, so those fragments get chopped where lines would have passed
through. `erase.layered.slow.test.js` LX-4, a 400-point wiggle with a 26-px
pen erased one crossing down: 6,687 painted pieces after the cut, where the
per-piece rule kept it under 4,000 (the bound is now 9,000; the runaway the
test guards against was 340,129). If that cost matters, the alternative is
the exact per-fragment bow with the same endpoint guard — it freezes as
early as a fragment allows, and since a cut arc's decision is taken on its
canonical fragment (F43) it is just as nick-independent and, on the object's
grid, just as window-independent; it costs a hypot and a tangent per
fragment and is one more thing to explain than "over this radius, a line".

*The measurement and the design, as first written:*

**Seen.** Kobin, 2026-09-04, in his Chrome: "zoom in a little — a level
crossing — the mark will jump." Snapshot `.kobin-reports/report-2026-09-05T04-47-50-316Z.json`,
camera level 4, inScale 207.9. The mark is the level-0 GREEN stroke's boundary
seen through semi-transparent brown and purple as a pink notch. Measured with
`elementsFromPoint` over the full fill stack: the notch's left edge moves
520.1–521.4 px at the 4 → 5 crossing on every row sampled; the right edge 0;
the brown and purple edges (F41 offsets, level `0/18,11`) under 0.1 px.

**Cause, two halves.** The level-4 render piece of the green at that edge is
ONE arc, radius 3.013e15, sweep 1.94e-11, centre (−2.66e15, 1.41e15), with its
endpoint `A` exactly on the tile line (x = −65536). Its sagitta is 1.4e-7 units
against a freeze tolerance of 4.88e-4 — yet it is not frozen, because
`freeze.js` `settle` requires `whole(boxOf(q, sag))` and the sag-grown box pokes
past the window line the piece was cut on. Every chopped piece touching the
window's outer lines is refused a freeze this way, and every seam overhang copy
is refused by design. Then the level-5 chop (`chopFreezeLoops` → `arcCuts`)
solves `u = (k − C)/r` with C ≈ 1.2e19 and evaluates `ptAt` = C + r·cos: the
result is quantised to about 2,048 units. The cut at the grid line y = 65536
landed at (−10240, 65536) instead of (0, 65536), a fabricated 10,240-unit run
along the tile edge — the 520 px. (At level 4 the arc's own endpoints are
already quantised to 0.5 units, ulp of a 2.7e15 centre, i.e. the level-4
picture is itself ~100 px off; the crossing re-rolls the dice 4,096× worse.)

**Synthetic, so it is not one drawing.** A three-point curved stroke (radius
~145 units at level 0), pen 12 and pen 40, descended on its top edge with the
aim re-found before every crossing: crossings 0→1 … 3→4 hold the edge to
0.001 px; at 4→5 it moves ~1,075 px. The level-4 piece was one arc spanning the
tile (its level-4 grid cuts were MISSED — `u` cancels), and the level-5 chop
through a centre of 1.7e20 quantised to 16,384 units. So: any curved stroke
breaks at its fifth crossing (effective zoom ~1e16). The onset rule for a new
point computed through the centre is `err_px ≈ r0 · 4096^k · 2.2e-16 · inScale`:
r0 = 145 → k = 4 already gives 8 units; r0 = 6 (a 12-px pen's cap) → k = 5;
r0 = 1e5 (the near-straight biarc of a long stroke) → k = 3, up to 380 px at
LEVEL 3 if a cut happens there. Levels 1–4 survive only because no NEW point is
computed there (inherited endpoints are exact) or the centre is still near. The
bible's 10.4c — "by the third crossing the freeze has turned everything into
lines" — is true for pieces that never touch a tile line and false for the ones
that do, which is every tile-spanning piece.

**Same class, other places, measured in the boolean floor probe.** The boolean's
cut points carry ~ulp(r) too (1.6e-5 units at r = 1e11, ~1e-3 at 6e12): harmless
for the cut, but the F44 seed for the notch's own picture below. And
`straighten`'s test `|r|(1 − cos(sweep/2))` quantises to 0 or ≥ 1.1e-16, so for
r ≥ 1e6 it is really "sweep < 2.1e-8" whatever the chord — the bible's own
"(chord/2)·tan(sweep/4), never from the centre" rule not followed.

**Fix, three layers, not built.** (1) The freeze test on the CHORD box,
inclusive of the window line — a piece with an endpoint on the line is exactly
the piece that must be allowed to freeze. (2) Chop on the ring of grid lines one
tile beyond the window, so the freeze decision is window-independent (else the
overhang copy in square i and the proper piece in square i+1 freeze
differently — a seam at depth). (3) Centre-free arithmetic in the chord frame
(M, û, n̂, L, sweep; h(a) = ((L/2)² − a²)/(d + √(r² − a²))) for `arcCuts`,
`ptAt`, `pieceBBox`, and the clip's `circleSegment` / `paramOf` / `rayCross` —
the bible's D1 without changing storage. The freeze fires at a level where r can
still be 4,096× past the 2^41 threshold, so layers 1–2 alone leave cut points
off by up to ~1,000 px. Rule: never compute a point through a centre farther
than about a chord length away.

**The compatibility question, which is Kobin's.** Layers 1–2 change WHICH
pieces freeze, and therefore the deep picture of drawings that already exist:
detail drawn against a piece that is unfrozen today would move by up to
tol · 4096^k at k levels below when that piece starts freezing. Either accept a
one-time shift in old drawings, or version the freeze rule per file.

<a id="f45"></a>
### F45 — FIXED 2026-09-05. A crossing about a view centre on a cell boundary jumped the picture one whole cell.

Found while confirming F44 synthetically: a stroke at level 0 zoomed about
screen (400, y) on an 800-wide engine — 400 px is 12.5 cells, so at level 1 the
view centre is exactly a cell's right edge. Float noise left it at
65535.9999999996: `_maybeShift` ([−W/2, W/2) half-open) said "inside this
frame", `_viewCell`/`cellOf` rounded 2047.99999 → 2048, out of range,
`cellChild` carried the digit into frame 13 and minted `0/13,9/-2048,-1792`,
and `_crossUp` applied `child.edge` — relative to frame 13 — while `this.frame`
was still 12. The pan came out one level-1 frame off, the next `_maybeShift`
"corrected" it by moving 4,096 cells, and the picture had jumped ONE LEVEL-0
CELL sideways: 32 units, 8,192 px at the crossing zoom, the ink off screen and
the render list empty. The strip [W/2 − G/2, W/2) of a frame belongs to the
NEIGHBOUR's extreme cell (cells are centred on their index, bible 10.2), and the
two functions disagreed about it — 50/50 on float noise.

When it bites: any zoom whose centre sits on a cell boundary — the default view
of a 1504-wide window (752 px = 23.5 cells), an 800-wide one, programmatic
zooms (scene `jumpTo`, load-and-settle, every test that zooms about x = 400), a
pinch whose midpoint is dead centre. The F42 tests aimed at x = 400 and
survived only because their rounding went the other way.

The fix: in `_crossUp`, when `child.parent !== this.frame`, step the camera
into `child.parent` first — its origin in this frame's units is a whole number
of frames, exact — then apply the edge. `camera.crossing.test.js`: the frame
point under the screen centre is preserved to 1e-6 units on both rounding
sides, x and y, both at once, and through three crossings in one settle.
Measured in jsdom only; the code path is the same in the browser.

<a id="f46"></a>
### F46 — FIXED 2026-09-05. An ordinary erase on an ordinary curve, three crossings down and zoomed in, was refused as "grazing" at random.

Found by Kobin's corner scenario (F43 measurement): a 12-px nick at level 3,
inScale 64, on the smoothed corner of a two-arm stroke removed NO ink. The
descent ceded levels 1 and 2 — the object became two remnants and two kids —
then at level 3 `_rehomeWhy` said "grazing: nothing removed" and the mark was
consumed (F47 is that second half).

**The boolean was fine; the area was not.** `zz_boolfloor` (since deleted; its
conclusions are in `erase.curve.depth.test.js`) subtracted a small eraser from
a slab whose top edge is an arc of radius r, endpoints on the circle, r from
1e6 to 2.6e16 and chords of 64 to 131,072: the output was structurally right at
every r — crossings found, the notch's vertices at (±rE, ~0), one loop, no
seals. What went wrong was `arcShape.loopArea` on the tile-spanning piece, two
ways: its segment term `r²(sweep − sin sweep)/2` is rounding noise once the
sweep's cubic term is below one ulp of the sweep (sweep ~2e-8, r ~6e12: ±60
units²), and a piece's endpoints are inherited exactly while its centre is
rounded, so `A`,`B` sit ~ulp(r) off the circle and the shoelace half of the
area disagrees with the arc half by ~chord·ulp(r)/2 (4.7 units² at r = 1e12,
65 at 6e12). The grazing test `before − loopsArea(after) < 1e-4·rE²` compared
two ~1e9-unit² areas whose difference had a noise floor of tens of units²
against a true removal of 0.23. The direct replay of the refused link read
removed = −24.0 with a perfectly good result loop.

Where it bites: r in [~1e11, the straighten threshold] for tile-spanning
pieces — LEVEL 3 for curves of radius 1.5–87 units at level 0 (a 12-px pen's
caps, every hand-drawn curve) and level 2 for near-straight strokes — only when
the eraser is small in level units (zoomed in within the level: at inScale 0.435
the removal is 5,000 units² and the test passes; at 64 it is 0.23 and fails).
Level-4 pieces are straightened and exact again. So the band is narrow and
sits exactly where the recursive workflow erases.

The fix: the removal is measured LOCALLY — `_removedArea` is the area of the
intersection of the two shapes, whose pieces are no longer than the eraser
(both grazing sites: the in-place cut and the cede's last link) — and
`loopArea`'s segment term is a series below 1e-2 rad (`segmentTerm`). The
second area error remains for long huge-r pieces and only matters where a
whole-object area is compared, which nothing on the erase path does now.
Measured: the level-3 nick at inScale 48+ leaves paper in the notch and ink
either side on both strokes; eight nicks at levels 1–4 at a moderate zoom still
do; `f34.repro` unchanged. Probably the mechanism behind F30 ("an eraser is
consumed without cutting anything") — that report predates the instrumentation
that would have named it.

<a id="f47"></a>
### F47 — FIXED 2026-09-05. A descent that ceded its intermediate links and was refused at the last one reported success.

`_bakeRehomeInner` returned true whenever `steps` was non-empty. Levels 1 and 2
had ceded, the last link `continue`d (any of its six reasons — here F46's
grazing), `_rehomeWhy` was left set and never read, `note.cuts` recorded a cede,
the target was in the done set, the mark was consumed. Net: one stroke became
four natives and not one unit of ink was removed, silently — F30's exact
symptom. Now a descent whose last link ceded nothing unwinds its steps (newest
first, pieces out, the replaced native back at its own index — the same walk
the undo of an erase does over `op.baked`) and records "last link refused:
<why>" against the gesture like any other refusal. The one existing test that
pinned the old behaviour (`erase.depth.test.js`, an erase touching nothing of
the object at level 2) asserted the level-1 kid EXISTED; it now asserts the
object is one native, the refusal is on the note, and the level-6 picture is
still bit-identical. A fault-injection test (`_squareInk` returning null at the
erase level) pins the unwinding: the document is identical before and after,
id for id and bit for bit.

<a id="f40"></a>
### F40 — FIXED. A shape one frame up drew 463 px from where it is, and "disappeared" at the level jump.

Kobin, 2026-09-04, on the deployed build: *"If you zoom in just a bit, you'll
see the blue shape disappears. Why?"* — and, when the first reproduction
stayed put: *"You'll need to zoom just past the level jump."*

**What it was.** Object 81 is a re-homed tile one frame above the camera: a
circle about 11 units across, sitting by the corner of the camera's cell. Seen
from the camera's frame it is 4,096 times larger — arcs of radius 22,746 units,
which at Kobin's zoom of 127 is **2.9 million px**. The renderer converted every
arc to cubics in `pieceToCubics`, one per quarter turn with the standard
4/3·tan(θ/4) handles, on a comment that called the 2e-4·r error "far inside
display tolerance". It is, while the radius on screen is under a thousand
pixels. Here the single cubic for the first 87° ran **3.65 units = 463 px
outside the true circle** across the whole width of the screen: it crossed the
left edge 319 px from the top where the true edge crosses it at 812 px, under
the green. That bulge was the blue band. At the level jump the child frame's
chop cut the arc into five pieces of about a thousandth of a radian, whose
cubics are exact to a fraction of a pixel, and the blue edge drew where it
really is — off the screen. Three things were checked before believing it:
the piece stayed in the render list through a 2.6× zoom and the crossing; its
DOM attributes did not change; and a bare SVG with the same numbers painted at
every scale in the app's own Chromium, so the browser was not dropping it.
Then the cubic was evaluated numerically at Kobin's exact camera.

**Where cubics were.** Not in the model — the design is arcs end to end — but
at the output boundary, three times: every shape and fill perimeter through
`pushShapeAnchors`, a stroke's biarc chain through `pushGapAnchors` (live and
awaiting its bake), and the selection ants' `runPathData`. The design document
recorded none of it; the belief lived in a Renderer comment ("Two.js speaks
nothing else"). It does: `Commands.arc` is SVG's `A`, serialised from
`rx`/`ry`/`xAxisRotation`/`largeArcFlag`/`sweepFlag` set on the anchor, marked
a hack in 0.7.1's source and first-class in 0.8.24, with **identical `d`
output in both** — so an upgrade buys nothing here and is a separate decision.
`curveOutline.js` (fitted cubic capsules for a fat stroke) is the one place
cubics are a representation; the renderer still routes a `type: stroke` object
without a biarc chain through it, and whether any drawn stroke still reaches
that path was not checked.

**The fix (2026-09-04).** `Renderer.pushArcPiece`: an arc is one `A` anchor,
radius as given, `sweepFlag` the sign of the engine's own sweep (the SVG flag
is the direction of increasing angle in the page's y-down frame, which is the
engine's parametrisation whichever side of the centre the radius was written
from), split once at a half turn because the command is named by its endpoints
— a full circle would draw nothing, and past π the large-arc flag alone would
carry the meaning. Nothing else is cut: Kobin, *"I don't like subdividing due
to the performance issues we've seen."* The thin rescale multiplies the radii
with the anchors, and its thickness estimate walks each arc's midpoint (a
circle of two half-arc anchors alone encloses no area). `_addFillPath` treats
an arc anchor like a curve anchor for Two's `closed` flag. The ants emit the
same `A`, radius scaled by the decision's k, `-0.00` normalised. Tests:
`antRuns.test` path data (radius scales with k, both flags, a circle is two
arcs, a full-circle piece splits, never a `C`), the indicator tests accept `A`
or a capsule's `C`, and the under-2-px test's square shrank from 60 to 30 px —
at 60 it reached 2 px at inScale 0.033, a hair over the frame's exit, and the
dot raced the crossing (passed in the suite, failed on its own, twice). Quick
suite 62/62, 916 tests.

**The float32 question, reasoned first.** The browser parses the path in
float32 and, for an arc, rebuilds the centre from the two endpoints and the
radius. Coordinates are origin-relative and bounded by the tile reach, so
their floor is the one the per-scene origin already accepts: 2^-24 × (reach ×
deepest zoom) = 393,216 × 256 × 6e-8 ≈ 3 px at the very worst. The radius is
not bounded by anything: a circle from k frames up is 4096^k times larger. The
centre error is therefore **2^-24 of the radius ON SCREEN**, R_px = r_units ×
inScale — a quantity a crossing leaves unchanged, so within a frame the error
grows linearly with zoom and is not itself a jump; the jump comes at the next
crossing, when the piece is chopped again with a smaller sweep and the browser
suddenly gets it right. Capped by the sagitta of the piece (an arc can at
worst flatten to its chord), and Skia draws a chord outright under π/10⁶ of
sweep. The worst combination is the deepest in-frame zoom (256), the piece
whose sweep the chop left small, and the largest radius the drawing offers.
The cubic's law is the opposite shape: 1.8e-5 × R_px × θ⁶ — exact for a small
sweep, hopeless for a quarter turn.

**Measured (tools/harnesses/bigpath.html, the app's Chromium, 1280×720 —
one arc under `matrix(256 …)`, the fill's edge found by bisecting
`elementFromPoint`, against the float64 circle; only rows whose chord fits the
tile reach, ≤ 1e8 px, are reachable in the app):**

| screen radius R_px | SVG arc, worst px | quarter-turn cubic, worst px |
|---|---|---|
| 1e6 | 0.08 (0.27 at 170°) | 421 at 170°, 283 at 90°, 4.7 at 45° |
| 2.9e6 (Kobin's) | 0.16 under 90°, 2.6 at 170° | 1,220 at 170° — the band |
| 1e7 | 0.46 (3.6 at 170°) | 1,644 / 613 / 47 at 45° / 0.15 at 10° |
| 1e8 | 2.7–5.2 | 425 at 45°, 2.3 at 10°, ≤ 0.01 under 1° |
| 1e9 | 5 at 1°, 41 at 0.1°, 1.9 at 0.01° | 0.29 at 1°, 0.013 at 0.1° |
| 1e10 | > 348 at 0.1°, 19 at 0.01° | 2.6 at 1°, 0.025 at 0.1° |
| 1e11 | > 190 at 0.01°; the path vanished at 45°–90° (chords far outside the reach) | 0.28 at 0.1° |

Junctions hold: two `A`s meeting at a midpoint showed no step at 1e6 and 1e8
(the browser pins each arc's end to the given point), 2 px at 1e10, 16 px at
1e11.

**Measured in the app, on Kobin's drawing, mid-piece** (an endpoint probe reads
zero, because the endpoints are pinned): the blue piece in the child frame,
sweep 0.068°, at inScale 0.07 (R_px 6.5e6): **0.31 px**. At inScale 254 (R_px
2.4e10): **159 px below the truth**. One zoom step later, in the grandchild
frame: **0.00 px** — a 159 px jump at that crossing. The error was 0.63 units
at every zoom in the frame, 2^-27 of the radius, a tenth of the single-ulp
bound. At Kobin's own camera there is no band: black meets green, and the
true blue edge is 867 px down at the left of his screen, under the green.

**Verdict.** The arc command fixes what Kobin saw and holds to a third of a
pixel up to a screen radius of about 1e7 px; past ~1.5e8 it is off by a pixel,
and at the child frame's deepest zoom on this very drawing — about twenty
times further in than where the blue vanished — it is off by 159 px and jumps
at the crossing. So it does jump, in a regime the cubic pipeline handled
exactly, while the cubic pipeline failed by 463 px where the arc is exact.
Neither alone. **The two laws cross at a fixed sweep:** 6e-8·R = 1.8e-5·R·θ⁶
at θ = 22°, whatever R. One cubic under 22° of sweep, an `A` over it, and
within the reach envelope the worst case is ~15 px by the bound (~10 by the
measured factor) at R_px ≈ 2.6e8 with a 22° piece spanning a whole tile,
falling as R⁻⁵ beyond and as R below. That is not subdivision — one command
per piece either way, plus the half-turn split the `A` needs; allowing one
split in that band alone would bring it to ~8 px, and four pieces to ~4. The
backlog task whose principle this is is D1 / ROADMAP F1 — a piece is
`{A, B, bulge}`, never hand anyone a centre and a radius for a nearly straight
arc — and a bulge-based emission is exactly the cubic branch. The freeze (F2)
does not catch it: that piece's sagitta over its tile is 4,175 px at that
zoom, nowhere near straight.

**The 22° rule, implemented (later the same day).** Kobin: *"implement the 22
degree fix. Just to confirm, that is guaranteed to always be less than a pixel
off on the screen, right?"* — it is not, and he was told so first: within the
tile-reach envelope the worst case is about 15 px, for a piece of about 22°
spanning a whole tile at a screen radius near 2.6e8 px, on top of the ~3 px
float32 floor every coordinate at the tile reach already has at the deepest
zoom; it is under a pixel for screen radii below ~1.7e7 px and above ~4.4e8.
`arcShape.ARC_COMMAND_MIN_SWEEP` (22°) and `chordCubic(p)`: one cubic from
the endpoints and sweep alone — tangents at ±sweep/2 off the chord, handle
(chord/3)·(1 + tan²(sweep/4)), the bible's cancellation-free form of the
kappa handle, verified against `pieceToCubics` to 1e-9 for every sweep under
a quarter turn and on its circle to 1e-9 for a 1e13-unit radius. The
Renderer's `pushArcPiece` and the ants' `runPathData` branch on it; the cubic
anchor's first handle is set on whatever anchor precedes it (`Two.Anchor.
AppendCurveProperties` when that anchor has none). Tests: `Renderer.arcs.
test` (six: half turns are two `A`s, a full-circle piece splits, quarter turns
and 22.5° pieces are `A`s and 20° pieces are `C`s, a cubic after a line and
after an arc carries real handles, the thin rescale scales an `A`'s radius),
`arcShape.test` (four), `antRuns.test` (the 10° cubic byte for byte). Quick
suite 63/63, 925.

**Measured in PAINT, because the hit test lied.** `document.elementFromPoint`
is Blink's analytic winding test; for a nearly horizontal cubic it solves for
the parameter at a given y in float32, which is ill-conditioned, and it
reported 17 px at a screen radius of 1e8 and 42 px at 2.6e8 where the raster
is nowhere near that (and 4 px of scatter between columns 320 px apart on a
curve that cannot bend that fast). For arcs it agreed with paint. So the
harness grew `__paintCheck`: the true edge drawn a second time in SCREEN
space (float64, no transform) as the region below it, same blue,
`mix-blend-mode: difference`, so agreement is black and any disagreement is a
sliver whose height is the error, against 1/2/4/8/16 px bars. Paint, at the
deepest zoom:

| case | painted error |
|---|---|
| cubic, 21.9°, R_px 1e7 | none visible (model 0.6 px) |
| cubic, 21.9°, R_px 1e8 | ~4 px (model 5.6) |
| cubic, 21.9°, R_px 2.6e8 — the rule's worst | ~15 px (model 14.7) |
| cubic, 0.1°, R_px 1e10 | none |
| arc, 22°, R_px 2.6e8 | ≤ 1 px |
| arc, 45°, R_px 1e8 | ~1 px |
| arc, 10°, R_px 1e9 (what the rule no longer emits) | ~40 px |

**Measured in the app, in paint, 1:1.** The blue piece in the child frame is
three cubics now (sweep 0.068°). At the frame's deepest zoom, mid-piece, the
painted edge lies on a red marker drawn at the float64 truth, within a pixel;
one step later, in the grandchild frame, it lies on the same marker: no jump.
At Kobin's camera there is no band. One wrong turn recorded: an overlay run
in an emulated 1280×720 viewport showed a 16 px band that a 1:1 re-run
against marker lines did not reproduce, and the `d` the renderer wrote,
evaluated in float64, passes through the truth to 0.25 px — the band was the
overlay's own placement, not paint.

**"15 px is too much" — the quarter-pixel plan (later still the same day).**
Kobin asked where the error could exceed three quarters of a pixel and what
the options were. Two sources, only one of them about arcs:

1. *The curve chosen.* Under the 22° rule, over 3/4 px only for screen radii
   between ~1.2e7 and ~2.6e8 px and pieces wider than ~12°.
2. *The coordinate floor.* Every coordinate reaches the browser in float32,
   relative to the scene origin at the view centre. A piece whose ENDS span a
   tile at the deepest zoom has them 5e7 px away, where float32 resolves to
   4 px, and its on-screen stretch inherits up to 2 px of that — lines and
   arcs alike. Over 3/4 px once a piece's on-screen chord passes ~2e7 px.

What ships, at Kobin's word ("I agree with your recommendation" and "can we
cheaply do a render-only tile chop for that … with as minimal
instructions/chops as needed"):

- `arcShape.planArc(p, { enter, tol, segMax })`: the arc command while
  2^-24·R_px ≤ tol — a screen radius up to 4.2 million px at the engine's
  quarter-pixel `arcTolerancePx`, one instruction, exact — else
  n = ⌈sweep·(1.8e-5·R_px/tol)^(1/6)⌉ cubics (`arcCubicCount`, each from
  `chordCubic`, no centre). R_px = r × the frame's deepest zoom, so the plan
  is made once per piece and never redone while zooming. The counts: 1 for a
  chopped sliver, 5 per quarter turn at 5.1e6 px, 9 per half turn for Kobin's
  circle one frame up, 12 per half turn at 2.6e7 px; the sixth root keeps
  them small, and the tile chop makes them fall again beyond ~1e8 px.
- `Renderer.pushLine` / `pushArcPiece`: any non-seam piece longer than
  `segMax` units is split into equal parts. segMax is the largest power of
  two under (tol·2^24 − REORIGIN_PX)/enter = 8,192 units for the default
  config, so the part on screen has its ends within 8,192 units of the
  screen and the screen is within the re-origin budget of the origin: the
  error is at most (1.5e6 + 8192·256)·2^-24 ≈ 0.22 px, whatever the pan
  (a pan past the budget re-origins and rebuilds, as before). A seam — a
  straight piece lying on the rectangle that cut it — is never split; its
  neighbour overlaps it by the seam pad, thousands of px at depth. Nor is a
  covering quad (classifyUp's solid tier): its edges are the tile's own
  boundary. Only an ancestor's ink magnified into the frame and long straight
  lines are ever that long, so the cost is a handful of anchors: Kobin's blue
  piece in the child frame is 32 cubics and 6 lines, 40 anchors.
- The ants' `runPathData` takes the same plan at the decision's scale times
  the quarter-octave a decision may drift; its runs are already clipped to
  the retained window, so no length split.
- The 22° constant is gone. `Renderer.arcs.test` (ten: the plan's constants,
  half turns and full circles as arc commands, an ordinary circle as arc
  commands whatever its sweeps, a 20,000-unit circle as 5 cubics a quarter,
  handles after any command, a 100,000-unit sliver split into 13 parts an
  edge and a tile piece's seams not at all, a covering quad not at all, a
  100,000-unit circle split by length past the law, the thin rescale), the
  arcShape planner tests (fits / count / split / plan), the ants' huge-radius
  cubic byte for byte. Quick suite 63/63, 932.

**Measured, in paint, in Kobin's own Chrome** (the pane stopped painting
frames with the Claude window behind, so a dev-server tab was opened in his
browser, used, and closed):

- The plan's former worst case, a 21.9° piece at a screen radius of 2.6e8
  px: two cubics now, and no sliver against the truth. The coordinate floor
  on a 45° line with ends 5.1e7 px out: a visible sliver of a few px unsplit,
  none with the 8,192-unit split (70 parts).
- The app, blue piece, child frame's deepest zoom, split build (32 cubics
  and 6 lines): the painted edge on the red truth marker to a pixel, and on
  the same marker one step later in the grandchild frame — no jump. **But not
  every time.** Of five captures of that state, two showed only the black
  quad and no blue at all, once in the pane and once in Chrome, while the
  DOM, the hit test and the `d` were identical throughout. In the bare
  harness, in Chrome, the exact `d` at the exact transform: **dropped at full
  raster scale, painted at half scale**; dropped with the far seams replaced
  by a near close; painted at 2.5× smaller coordinates (k = 100); painted
  when the same 32 points were written as LINES. The unsplit three-cubic
  version painted in every capture. So a path of many cubics whose control
  points lie beyond roughly 1e7 device px is something Chrome's GPU raster
  gives up on — the F-Z class, geometry right and paint gone — and the length
  split, by cutting a far-reaching arc into thirty such cubics, walks into it.

**Where that left it, mid-evening.** The plan ships and is verified. The
length split is built, tested and **off by default** (`Renderer.lengthChop`),
because a dropped shape is worse than the 2 px it removes. And the drop is
not the split's doing: Kobin's red piece in his own drawing — one arc of
radius 2.3e8 units clipped to its tile, THREE cubics, never split — painted
at inScale 64 (8.4e6 px across) and vanished at 78.8 (1.03e7 px) with its
`d` byte-identical; injected in his tab at 78.8, the exact cubic, a quad, and
sixteen sub-cubics all dropped, the arc command painted 150 px off, and
sixty-four lines painted on the truth. A tile at that zoom is 8.4 million px
wide, thousands of screens, and any piece that spans one is that big in
device px however little of it is in view. So: a path whose curves run
beyond roughly 1e7 device px is a thing Chrome's GPU raster gives up on,
whatever the curve is cut into, and the only fix is to never hand it one.

**The window chop, built the same evening.** Kobin: *"you are suggesting
just chopping instead of segmenting? If so go ahead and implement that
stopgap; just ensure that if you pan towards the end of the segment, the
next segment is loaded."* Each scene keeps a WINDOW around the view, a square
of ±2^18 = 262,144 device px at the zoom it was chosen at (±174 screens).
Any area piece — a resolved shape, a fill, a tile piece, a covering quad —
that reaches past the window is clipped to it before it becomes anchors,
with the tile machinery's own exact boolean (`shapeLoopsInRect`;
Sutherland–Hodgman for polygon pieces), so a chopped piece is the same kind
of thing as a tile piece, cut on a different rectangle. A piece inside the
window goes whole; a piece wholly outside it goes whole too, since it is
hundreds of screens off screen. The window is chosen again when the view
leaves its INNER HALF or the zoom grows fourfold, and `needsWindowChop`
promotes that camera frame to a full render, so the straddling groups are
rebuilt on the new window before its edge could reach the screen; only they
carry the window's key in their signature, so nothing else rebuilds. The
bound: the view is within half the window of its centre and within
REORIGIN_PX of the origin, and the zoom has grown at most 4×, so no anchor is
ever farther from the origin than 1.5e6 + 6·2^18 = 3.07e6 px — 0.18 px of
float32 rounding, under the quarter pixel, a third of where the raster gives
up. Render-only: the Document, the tile cache, the boolean and the saves are
untouched; the selection indicator and the erase overlay still read the whole
object. Not chopped: raw strokes (short segments, and lines survive the
raster) and fat curve-capsule outlines (cubics; no exact rect clip for them
yet).

**Measured, in Kobin's Chrome, on his drawing.** The red piece at inScale
64: one cubic and three lines, every anchor within 4,096 units of the view.
At 78.8 and at 97, where it had vanished: painted, and the float64 truth
(the arc's own centre and radius, in JS doubles, marked on screen with a
lime line) sits on the painted edge at x = 200 and x = 752; at x = 1300 the
blue shape covers it. A pan of 2,103 units across the inner half at 97 (204
steps of 1,000 px): exactly one full render, the window's key 3 → 4, the
piece rebuilt on the new window, the truth on the painted edge at x = 752
and x = 1300 (the x = 200 capture came back without its marker and was not
repeated). Then his view was put back where it was. In jsdom
(`Renderer.chop.test.js`, 8 tests): the size and the bound, the three
verdicts, the chopped cubic's ends on the true circle to a hundredth of a
unit, the view never outside the window on any of 400 pan steps or a zoom
from 32× to 200× and out to 0.05×, a re-chop rebuilding one group and not
the other, an inherited tile piece one frame down exact to a millionth of a
parent unit, and the toggle. Quick suite 64/64, 941.

<a id="f39"></a>
### F39 — CLOSED. A dense selection zoomed slowly and showed solid outlines instead of ants.

Kobin, 2026-09-03, report `16-33-20`: *"lots of solid outlines instead of
ants, which tbh does not look like it's selected. And very slow on zooming. How
do we make these ants cheaper, especially when there are so many small
objects?"* The report's zoom steps ran 150–280 ms with 5,343 objects rendered
and the whole drawing selected. This flag went through three designs in one
day; the third is what ships, and the first two are recorded because each was
measured and each taught something.

**What was wrong.** The indicator was built from the DOCUMENT: every selected
object flattened, clipped to the window, clipped again for the edge spans,
split on joins and mapped to screen, on every zoom step — 187 ms to compute and
200 ms to hand to the DOM at the report's camera — and most of it then fell
past the 24,000 px ant budget into F38's solid fallback.

**First cut, withdrawn the same afternoon.** Objects under 8 px on screen were
stamped into a screen grid whose outline was traced once, and the budget was
spent largest-first with the rest joining the grid. Fast (a zoom step went
from 237 to 25 ms), but Kobin's three screenshots showed why it was the wrong
shape: pieces inside a grouped chunk were still outlined on their own, a tile
piece past the budget became a box around its tile, and the per-ring polygon
clip that replaced the arc clipper read a hole inside out and ran border ants
the full height of the left edge. *"I'm not convinced the chunking is even
required at that level."*

**What ships.** Four things, each answering a question Kobin asked.

1. *"A core design principle is we never reference the original object."*
   The ants come from the RENDER LIST — the tile pieces already on screen —
   never from the document. Every piece now carries the rectangle that cut it
   (`piece.clip`), so a straight piece lying on it is a seam and gets no ants;
   the attach windows of a re-homed family are the same test, which is F37's
   join rule without the join notes.
2. *"I don't think we need to flatten anything."* Nothing in the overlay
   flattens. Arcs go to the browser as the cubics the ink goes as, lengths are
   analytic, the runs are cut to the retained window piece by piece (a cut of
   the boundary, no boolean), and where the ink meets the side of the screen
   is a winding scan of the boundary against that side's line
   (`geometry/antRuns.js`). The old edge-span defect cannot recur: holes are
   winding, not polygons.
3. *"How often are decisions made during zooming?"* Once per render list,
   selection, document revision, frame, origin, quarter-octave of zoom, or
   pan past the retained window. Between decisions a step is three numbers of
   a CSS transform on the layer, applied by the compositor. A step's
   JavaScript is under a millisecond.
4. *"Sub-pixel objects should be cheap: just trace the frame."* A frame whose
   selected content spans less than 2 px on screen is one dot at that content,
   and none of its members is visited — the selection table carries each
   frame's box, computed once per selection. The first version drew a ring
   around anything under 24 px, which boxed a lone 15 px stroke and a tile
   piece on its own; Kobin: *"change the frame-mark rule to only be objects
   <5px"*, and after trying 5 on the phone, *"I didn't like 5. Can we do
   2 px"*. A piece of a re-homed family never counts toward its frame's mark.

And two things measurement forced. The ants live in their own `<svg>` with
`will-change: transform`: in the drawing's `<svg>`, every frame of the crawl
re-rasterised the 5,343 objects under them (50 ms a frame; 16.7 with the layer
split, the ants themselves not measurable). And the crawl is STEPPED, sixteen
steps a cycle: the repaint of a full budget of dashed ants costs about a frame
here whatever the batching — 566 short runs in one path, one path each, or
eight per path came to the same 33 ms — so it lands on one frame in three
instead of every frame. Marching ants have always marched.

**The budget is gone.** With it, 24,000 px of ants covered about 700 of the
3,726 selected pieces on screen and the rest had none — Kobin, on seeing it:
*"it looks like a lot of the items are not properly selected"*, then *"take
off the budget"*. Every selected piece on screen now gets its ants, and what
that costs is the repaint of their length: 0.8 µs a pixel on this desktop,
measured on a canvas and again on the layer. The table below has the
consequence at two cameras; it is the phone's to feel, and the levers that
remain — a slower march on a big selection, static dashes past a size, a
WebGL layer — are in the roadmap. Two more things from the same message:
the lasso now asks "fully bounded" of a whole re-homed family (a loop around
a ceded tile alone selects nothing; it used to take the parent with it), and
the ants ride along with a drag — the decision made on the drag's first event
is translated by the pointer's travel, and the loops are cached against the
geometry they came from rather than on the piece, which for a native is the
document's own object and is rewritten in place by a move.

Measured in Kobin's Chrome (1504×812, dpr 1.5), report 16-33-20 at its camera,
all 5,526 objects selected, 5,343 rendered:

| | this morning | now |
|---|---|---|
| frame while the ants crawl, camera still, with the old 24,000 px budget | 50 ms | 16.7 ms median (the stepped repaint lands one frame in three) |
| the same with the budget off: 4,756 runs, 72,554 px at the report camera | — | 50 ms median, 100 p90 |
| the same at 4× in on the scribble: 5,029 runs, 275,820 px | — | 200 ms median |
| a decision with the budget off | — | 109 ms (117 at 4× in), plus 19 ms of DOM for 1,966 paths |
| overlay JavaScript per zoom step | 17 ms | 0.8 ms |
| a decision (once per render, quarter octave, or half-screen pan) | — | 26–47 ms |
| a pinch, zoom steps issued every frame, frames per step | not measured | 50 ms with the selection up, 50 ms without: the drawing's own repaint, the overlay adds nothing measurable (the crawl freezes while the camera moves) |
| a pan the same way | — | 33 ms with the selection, 33 without |
| ants on screen at the report camera | 105 paths, 13,600 px | every selected piece: 4,756 runs, 72,554 px |

The phone is Kobin's to feel. What is left in a zoom step is the drawing's
own repaint, which the overlay no longer adds to.

<a id="f38"></a>
### F38 — CLOSED. Some selected objects had no ants, or partial ones, after zooming in.

Kobin, 2026-09-03: *"I selected a whole bunch of objects then zoomed in. Some
of the objects weren't showing their ants, or they weren't showing correctly.
It was fairly reproducible, but it didn't happen every single time."* Report
`16-04-54`; and, from the same message, *"zooming when small, dense scenes are
selected still seems to be the issue, performance wise ... if a sub-pixel frame
is in the lasso, that's just one dot, no matter what its children are."*

**The ants had a hard budget.** `SEL_ANT_BUDGET_PX` caps the total dashed
length at 24,000 px so the 2026-08-22 stall (350,958 dashes on one rectangle)
cannot come back. It was a stop: members after it got nothing, and the one it
ran out on got part of a ring. In the in-app browser at the report's camera,
the selection Kobin made puts sixteen objects on screen and their outlines
total exactly the budget, so whoever came last had no indicator — and which
one that was depended on the zoom, hence "not every time". Past the budget the
boundary was emitted into `plain` and the renderer stroked it solid, thin,
unanimated, so that every selected object on screen kept an outline.
**Withdrawn the same day by F39:** on a dense selection that fallback was most
of what was on screen, and a solid outline "does not look like it's selected".
The answer to the budget is now grouping, not a second stroke style.

**The overlay visited every member.** 5,466 selected, most of them specks four
levels down: 30 ms a render to find that none was on screen, on every zoom
step. Kobin's rule is now the code's: a frame whose whole reach (3W) is under a
pixel on screen is one speck at its origin, decided per frame before the members
are gathered, so its members cost one map lookup each and no tag, family or join.

Measured in the in-app browser, the 16-04-54 drawing, 5,466 selected:

| | before | after |
|---|---|---|
| overlay at the report camera (16 objects on screen) | 109 ms, 38 ant runs, 24,001 px, then nothing | 82 ms, 38 ant runs + 17 plain runs (4,816 px) |
| overlay with none of them on screen | 33 ms | 3.5 ms |
| one zoom step, none on screen | 33 ms | 6 ms |
| the 5,429-object speck centred, one zoom step | — | 14 ms, 3 dots |

What was left was the tracing of the objects actually on screen — 82 ms for
sixteen big shapes, clipped to the view on every render — and the plain
fallback itself, which the next report showed to be the wrong answer for a
dense selection. Both are F39.

<a id="f37"></a>
### F37 — CLOSED. A ceded tile wore ants on all four sides.

Kobin, 2026-09-03: *"I sent a report where what must be the tile is showing as
selected, even though it should only select the parent object."* Report
`14-14-25`, family 213: piece 227 under `0/-81,-156/...`, cut from piece 225 in
`0/-82,-156` — the cell next door.

`_familyJoinNotes` looked for the piece a kid was cut from in the kid's PARENT
FRAME only. An object reaches into the neighbouring cell (invariant 2), a tile
ceded out there is addressed under the cell it sits in, and so its source lives
in a sibling of that cell's parent. No source found, no join recorded, and the
whole tile edge counted as free ink edge for the ants. Now every member one
level up is a candidate; the attach rect is mapped into that member's own frame
and the arc overlap decides, so a wrong candidate simply records nothing.

Measured in the in-app browser with the family selected at the report's camera:
before, two five-point rings — a 214 px square, one level-2 cell at that zoom;
after, no rings and a join recorded for every pair (225-223, 227-225, 228-227).
The erase-debug overlay shares the function, so its green joins are right too.

<a id="f29"></a>
### F29 — CLOSED 2026-09-07, by decision. A piece fades out of existence while zooming out

Closed on Kobin's word after the Chrome harness at the end of this entry ran
clean; reopen with a report.

Kobin, 2026-08-18: "a piece disappears as I am zooming out after it is cut off
the main piece. I caught it mid-fade." Report `07-22-12` is the one at level 2,
zoomed out (`inScale` 0.28).

There IS a fade, and it is not a bug by itself: `Renderer._fade` ramps a
down-piece's opacity to zero between `fadeLoPx` (0.15) and `cullPx` (0.3) so a
sub-pixel piece leaves quietly instead of popping. The question is why a piece
that is still a real part of the object on screen entered that ramp. Two
candidates, both cheap to check:

* `fadeTag` is `projectedSizePx` at the source frame's DEEPEST zoom, not at the
  current one, so a piece whose own frame is deep reads much smaller than it
  looks. A piece freshly CEDED to a fine level is exactly that case, and "after
  it is cut off the main piece" is precisely when it acquires one.
* The renderer puts a piece that is actually fading into its OWN group rather
  than the family's (`renderId = o.editId != null && this._fade(o) >= 1 ? ... :
  o.id`), so once it starts to fade it also stops sharing the family's opacity —
  which would make the fade visible rather than masked.

**Not reproduced in Kobin's Chrome, 2026-09-07.** The harness, run: `07-21-13`
converted, his twelve erases replayed (the last one ceding the level-1 object
into level-2 kids — "after it is cut off the main piece"), then 130 zoom-out
steps of 0.9× from level 2 to level 0, reading every group's opacity and its
`getBoundingClientRect` off the DOM at each step. Fourteen down-pieces faded on
the way out; every one measured 0.3 px or less on screen while it faded, and no
piece over 1 px ever had an opacity under 1. The two candidates above are not
tested by this: the ceded pieces here are genuinely sub-pixel where they fade.

<a id="f30"></a>
### F30 — CLOSED 2026-09-07, by decision. An eraser consumed without cutting anything (and NOT the boolean)

Closed on Kobin's word: not reproduced synchronously (2026-08-18) nor on the
timer path in his Chrome (end of this entry), and F46 and F47 have since fixed
the two mechanisms that fit it. The instrumentation stays, so a repeat
arrives with its own explanation.

Kobin, 2026-08-18: "an eraser doesn't bake (I erase and then it just
disappears)." Report `07-22-12`, gesture **e265**: a 113-unit eraser at frame 2,
`cuts: []`, and no pending mark left in the snapshot — so the mark was CONSUMED
having done nothing.

Its place in the session is the tell. He is doing the recursive workflow, and
each level goes the same way — zoom in, erase, zoom in, erase, and the first
erase after crossing into a new level CEDES:

```
e230 @L0  lw 3.56    cut 30
e233 @L0  lw 1.02    cut 231
e236 @L0  lw 0.33    cut 234
e239 @L1  lw 294.20  CEDE 237  + split      <- first erase at level 1
e244..e262 @L1       cut, seven times, each at a deeper in-level zoom
e265 @L2  lw 113.32  NOTHING                <- first erase at level 2
```

**e265 is the cede at the next crossing, and it is the one that did nothing.**

RULED OUT — the geometry. Replayed from `07-21-13`'s snapshot, all twelve
gestures reproduce his session move for move (cut, cut, cut, cede+split, seven
cuts) and **e265 cedes correctly**, taking the document from 20 natives to 23.
Replayed on the PRE-FIX boolean it also cedes. Replayed as a single gesture
against `07-22-12`'s own snapshot it cedes. The synchronous path is right.

WHAT IS LEFT is the difference between that replay and the app: the replay runs
`flushErases()`, and the app runs `_bakeTick` in 8 ms slices on a timer, deferred
whenever `_drawing || _erasing || _dragSel || _panLast`. The suspect mechanism is
the DONE SET. `_bakeOne` adds its target to the eraser's done set BEFORE it can
refuse (deliberately — it is what stops a refusing target being retried for
ever), so a refusal is permanent for that gesture; if nothing else lies under the
mark, `_bakeTick` then finds no target, and consumes the mark silently. That is
F27's shape exactly, and F27's fix only covered the sibling-branch case.

His session also recorded ONE seal in that window (`lastSeal {id: 263, open: 6}`)
that the replay does not reproduce on either build — more evidence that the app
took a path the replay does not.

**Instrumented 2026-08-18 so the next report answers it.** `_rehomeBail` records
every refusal against the gesture — `{target, level, why}`, with the reason taken
from the exact `break` that stopped the descent ("tile holds none of its ink",
"grazing: nothing removed", "cedeTileById refused", ...). `_noteSpent` records,
on any mark consumed WITHOUT cutting, the whole done set: what the gesture
considered and dismissed. A repeat of this bug now arrives with its own
explanation attached.

**Replayed in Kobin's Chrome on the timer path, 2026-09-07: NOT reproduced.**
The `07-21-13` snapshot converted to the lattice (`__testkit__/legacyFixture`),
the twelve gestures `07-22-12` adds mapped into lattice frames, each made
through `pointerDown/Move/Up` in a second engine in his tab with the bake left
to `_bakeTick`'s own timers: cut, cut, cut, cede + split, seven cuts, as in his
session. e265, made his way — the camera at level 1 on the gesture, zoomed
through the crossing so the engine minted the level-2 frame itself — ceded the
level-1 object into two level-2 kids (20 → 23 natives), nothing consumed, no
refusal but the level-0 remnant's "tile holds none of its ink". A first attempt
put the camera in the converter's level-2 frame, 6,556 frames from the view:
the screen was blank there and the erase cut in place — the converter's
anchoring (a legacy frame could sit anywhere), not the engine, and
`Camera.settle` would have re-homed it. Standing: not reproduced on either path;
F46 and F47 remain the likeliest mechanism.

<a id="f35"></a>
### F35 — a group move displaces one member (OPEN, not diagnosed)

Kobin, 2026-08-26: *"I took an object, moved it into the corner at level 5, then
moved the object with those little objects together. Now the object is not in the
corner."*

No capture, no reproduction. What follows is read off `_dragSelection`
(`engine/selection.js` since the 2026-08-31 split) rather than observed, and is
where to look first.

**A mixed-depth selection is moved by TWO DIFFERENT CODE PATHS in the same drag.**
The branch is chosen per object, by comparing that object's depth to the camera's:

* `depth <= camDepth` — plain translation, `wantX = tx * f`. No quantization
  during the drag; re-homing waits for pen-up (`_normalizeHome`).
* `depth > camDepth` — address arithmetic (`displaceFrame`). Whole cells become a
  change of frame and only the sub-cell remainder reaches geometry.

A big object at level 5 and the "little objects" beside it are on opposite sides
of that test whenever the camera sits between them. The two paths agree only if
`tx * f` and (frame change + remainder) compose to the same displacement, and a
CORNER is exactly where that composition is marginal — a cell decision resolved
one way for one member and the other way for another.

**The cheapest thing to rule out first is not arithmetic at all — it is the three
silent `continue`s.** Each drops ONE member of the drag while every other member
moves on:

```
if (depth == null) continue;                          // no depth for its frame
const f = this.lm.frameFactor(this.cam.frame, st.from);
if (f == null) continue;                              // unreachable from the camera
const put = this.lm.displaceFrame(st.from, camDepth, tx, ty);
if (!put) continue;                                   // no displaced cell
```

Nothing logs any of them. A selection that moves "together" with one member
skipped is precisely the reported symptom, and it does not require the two paths
to disagree by so much as an ulp. Instrument these three the way `_rehomeBail`
instruments the erase — record `{id, level, why}` against the gesture — and a
repeat arrives with its own explanation.

**Folded into F41 (2026-09-04), and instrumented.** The `depth <= camDepth`
branch above is the one F41 measured failing (a from-below drag wrote a
sub-float64-step displacement into the home coordinates) and it is gone: a
member coarser than the camera now takes an offset below its home, one level
with it translates, one deeper goes through the digits. Every member of a
mixed-depth drag goes through lattice arithmetic and registration is by
construction, which is what this section's "two paths compose differently at a
corner" worry needed. The three `continue`s are instrumented as this section
asked: a member the drag could not move is recorded against the gesture, and
the move's journal note carries `skipped: [{id, level, why}]`. The 0.143-unit
drift could NOT be replayed — the five F35 snapshots in `.kobin-reports/f35/`
carry no journal, only the document — so it is not proven fixed; the next
report of it arrives with its own explanation.

**Mechanism found, 2026-09-05: this is F55, and F41 did not fix it.** The
paragraph above says registration is "by construction" for every member of a
mixed-depth drag. That is true at the level the drag is made at and one level
below it, and it is what F41's tests measured. It is false three or more
levels below the move: the one addition F41 makes — the offset into the hop at
the move level — rounds by half an ulp there, and the chain magnifies that
rounding by 4096 per level while a native below moves by exact digits.
Measured in `move.registration.probe.js`: half a unit three levels below a
move, thousands four below. A corner seen at level 5 belongs to an object
homed two or three levels up, so a group moved from above that corner parts
from it by exactly this — and 0.143 units is the size of it for a move three
levels up. The fix is in F55, not here. Kobin, 2026-09-05: "I thought this was
exactly the issue we were fixing" — it was, and F41 fixed the half of it that
was under the finger. **F55 was built later the same day**: the displacement
never enters a coordinate or the hop, and the moved object's deep picture is
the same bits in its new frame (`move.registration.test.js`). The corner at
level 5 therefore moves by exactly the digits the star moves by. This closes
when Kobin sees it hold on his drawing; the report that could not be replayed
stays unreplayed.

After those: `_normalizeHome` decides an object's cell from its **bbox centre**
(`Math.round(cx / FRAME_W)`), so a large object positioned by one corner can
re-home a whole cell on pen-up. That is meant to be position-preserving — the
neighbouring origins differ by exactly `FRAME_W`, a power of two, so the
subtraction is exact — but it is the step that MOVES an object between cells at
the moment the drag ends, and "in the corner" is where its rounding is marginal.

Also worth confirming: `_selectionMembers()` expands every selected id to its
whole edit family, so a group move can carry members the user never selected.

**CAPTURED, 2026-08-26.** Six reports across the undo/redo of the move, in
`.kobin-reports/`: `18-44-46`, `18-46-45`, `18-49-23`, `18-49-30`, `18-50-01`,
`18-51-20`. Kobin reports the LAST one has the small item out of the corner and
one of the two before it has it in.

**Every report is REPLAYABLE, and that was news.** A report's `snapshot` field is
`{v:"dev-0", camera, natives, crossings}`, which `decodeDrawing` accepts through
its legacy branch — so a report is a loadable drawing, camera included. Nothing
needed converting; there was simply no reader. `src/engine/f35.render.test.js` is
that reader: it loads each snapshot at Kobin's own 1504x868 and writes the SVG,
so a reported state can be looked at instead of only described. This applies to
EVERY report ever captured, not just these.

Snapshots (~2 MB each) are in `.kobin-reports/f35/`, out of the repo tree;
the renders and a comparison page are beside them in `.kobin-reports/f35/renders/`
(they sat in `public/__f35/` until 2026-09-02, where every build was copying them
into `build/`; `f35.render.test.js` writes there now).

What the numbers say so far. The three objects are 49 (extent 3.09 x 4.17 in its
own frame, depth 4) and 47/48, which sit two levels deeper. Expressing 47's
centre in 49's frame — the offset a group move must not change:

| report | 49's centre, own frame | 47 - 49 offset |
|---|---|---|
| 18-46-45 | (-14097.954, 9131.045) | (-0.023, +0.565) |
| 18-49-23 | (-9343.833, 21759.429) | **(-0.167, +0.570)** |
| 18-49-30 | (-9343.833, 21759.429) | **(-0.167, +0.570)** |
| 18-50-01 | (-9343.976, 21759.433) | (-0.024, +0.566) |
| 18-51-20 | (24407.842, -60944.589) | (-0.024, +0.566) |

Two things fall out of that, neither yet explained:

1. **The offset changes across an undo/redo with no gesture between.** The
   journal is saturated at 40 (`move` 32, `draw` 1, `erase` 7) and IDENTICAL in
   all six reports — no new gesture was recorded. Yet between `18-49-30` and
   `18-50-01` object 49 shifted **0.143 units** in its own frame while 47/48 did
   not move at all. That is 4.6% of 49's own width, and it happened during
   undo/redo. Whatever else is wrong, an undo round-trip is not restoring the
   position exactly.

   **Kobin, 2026-09-02: the defect is in the MOVE path; undo/redo is only how it
   was observed here.** An undo replays the move's own inverse
   (`Document._undoMove` restores the geometry the drag started from), so a
   move that is not exact shows up exactly like this. Read the drift as the
   move's. There is no separate undo flag.
2. **The frame chain is rewritten between `18-50-01` and `18-51-20`.** The 4th
   segment goes `-107,-369` -> `-107,-370` — one cell — and the 5th changes
   completely, `-287,-1714` -> `1364,1550`. The relative offset survives that,
   so the re-address itself compensated correctly; but 49 lands at y = -60944
   against a cell half-width of 65536, i.e. hard against its own cell edge,
   where it had been mid-cell before.

The relative offset does NOT distinguish `18-50-01` from `18-51-20`, so whatever
Kobin is seeing in the last report is either a position relative to something
other than 47/48, or the cell-edge homing in (2). **Do not guess further from the
numbers — read it off the renders.**

<a id="f34"></a>
### F34 — CLOSED 2026-09-07, by decision. An erase seals chords across the shape

Closed on Kobin's word, on the `circleCircle` fix (6 of 21 → 0 of 21 in jsdom)
and the same 21 gestures in his Chrome (0 of 21, end of this entry). Two
things stay recorded below as facts rather than as this bug: the synthetic
straddling sweep's assembly failure at r ≥ 1e10, which never appeared in his
drawing and which F44's gate keeps out of the boolean above ~8.8e12, and the
design-correct repair, D1, dropped from the roadmap's register on 2026-09-08.

Kobin, 2026-08-26: *"The eraser was essentially a circle around the corner, but
this is how it baked."* The screenshots show the object cut by enormous
straight-edged wedges converging to needle points — nothing like a circle.

Report `18-16-24`, erase gesture **e66**, 16 px eraser (`lwFrame` 26.6) at level
2 in frame `0/-47,179/-1479,824`. The gesture worked in every other respect: it
ceded object 27 down two links and cut objects 47 and 48 in place. What failed is
the boolean on the LAST link of the cede — `subtractShape(local, clipLocal)` in
`_bakeRehome` (`engine/erasePipeline.js` since the 2026-08-31 split):

```
lastSeal: { id: 68, open: 353, area: 16380743543.8 }
boolSeals: 1
```

**353 chains could not close**, carrying 1.64e10 units² between them, and each was
sealed with a straight chord. That seal is deliberate — losing a real stretch of
boundary is worse than drawing it straight — but it was written for the odd
tangency, and the comment above it budgets for *two* chains on a Y-stroke cut by a
ring. Three orders of magnitude out.

Three things say this is systematic rather than a discrete-decision accident:

* `shapeBoolean` re-runs the whole boolean at weld radii 0.1x, 10x and 0.01x
  whenever the first pass loses area, and `_noteSeal` only fires once ALL of them
  have lost. Perturbing the tolerance moved nothing.
* The sealed regions average ~6,800 units across against an eraser 26.6 units
  wide — 250x the eraser. These are not slivers at the cut edge.
* The output carries it: piece `#70` came out with **173 loops** and `#71` with
  29, against 1 loop each for the unshattered siblings `#67` and `#69`.

Measured off the rescued file, and this is the clearest statement of the damage.
A resolved perimeter is arcs end to end, so every straight edge in one is either a
tile boundary or a seal:

| object | loops | arcs | tile edges | interior lines | longest | pen |
|---|---|---|---|---|---|---|
| 2 (healthy) | 170 | 4,146 | 0 | 170 | **0** | 1 |
| 7 (healthy) | 2 | 527 | 0 | 2 | **0** | 175 |
| **70 (damaged)** | 173 | **174** | 5 | **346** | **53,573** | 141 |
| 71 (damaged) | 29 | 403 | 0 | 112 | 344 | 141 |

A healthy object's interior lines are all ZERO length — the degenerate closing
edge on a loop that already closed. Piece 70 has **twice as many straight edges as
arcs**, roughly one arc per loop, and a single chord **53,573 units long against a
141-unit pen — 379x the width of the ink that drew it**, ~41% of the 131,072-unit
tile it sits in. That chord is the white wedge in the screenshot.

Two objects want explaining separately: `#73` and `#74`, the in-place cuts of
targets 47 and 48, carry **zero arcs** — 265 and 366 straight edges and nothing
else, at pen 35.6 and 46.9. Whether they arrived that way or were flattened by
this gesture is not yet established; their sources are gone.

**The drawing is saved** — `.kobin-reports/rescued-Testing-2026-08-26T18-24.boundless.json`,
2.1 MB, verified through `decodeDrawing` (22 objects, 472 loops). So unlike F30
this one has a real repro in hand: load it, replay e66, and watch the subtract.

Note the scale relationship, which is what the recursive workflow always
produces and is the first thing to suspect: object 27 is a level-0 native whose
ink, carried two links down, arrives in the cutting frame ~90,000x its own size,
where it meets an eraser 26.6 units across. Fine features against a huge span is
exactly where a boolean's tolerances stop meaning anything.

`lastSeal` does NOT record the weld radius or whether the retries ran. Add that —
`_noteSeal` computes a dozen diagnostic fields and keeps three.

---

**REPRODUCED OFFLINE, 2026-08-26.** `src/engine/f34.repro.test.js`, against
Kobin's own drawing pulled live from the tab after he had undone the failures
(`.kobin-reports/f34-input-pre-erase.boundless.json`). **6 of 21** aimed circular
gestures seal, with open-chain counts of 4, 16, 18, 61, 91 and 156. It gets worse
with the size of the ring: at a 160 px gesture, 4 of 7 positions fail.

*Where he erased was recovered, not guessed.* The gesture cut objects 47 and 48,
so it must have covered them; their frame address maps up into the cutting frame
at **(-58101.992, -61126.016)** — which is, to the digit, a vertex of the damaged
piece #70's own first loop. That pins the view to 1250 x 722 at inScale 1.203,
exactly what the report records.

**TWO HYPOTHESES TESTED AND KILLED.** Both were plausible and both are wrong:

* *Arc radius.* The ink arrives in the cutting frame at 430,000x the tile, with
  arcs of radius 6.49e10 against a 1.31e5 span. `f34.scale.test.js` sweeps a slab
  the size of one tile whose edges are arcs, radius 1e5 -> 1e12, and subtracts an
  eraser: **exact at every radius**, removing pi*r^2 to the decimal, zero open
  chains. Scale alone does not break it.
* *The ring shape.* "Essentially a circle around the corner" means the swept
  region is an annulus, and the seal code's own comment names a ring eraser as
  its hard case. Same sweep with a real ring perimeter: **also exact at every
  radius**. The ring alone does not break it either.

**BOTH OPERANDS ARE CLEAN WHEN THEY ARRIVE.** Measured inside the failing cede:

| | loops | pieces | broken joins |
|---|---|---|---|
| subject (`_inkShapeInRect`, both links) | 1 | 7 | **0** |
| eraser, as drawn | 2 | 192 | **0** |
| eraser, at every projection | 2 | 192 | **0** |

7 + 192 = the 199 pieces the boolean reports. Neither the tile clip nor the
magnify chain has damaged anything.

**SO THE FAULT IS INSIDE `shapeBooleanOnce`.** Its own stats on the worst case:

```
pieces=199 kept=172 loops=156 | crossings=3 overlaps=0 coincident=0
straightened=0 weld=2.926e-7 ambiguous=0 unbalanced=6
sealed=156 sealedArea=1.6382e10
```

Three things to take from that:

1. **`crossings=3` is impossible.** Two closed curves cross an even number of
   times. An odd count means the intersection set is inconsistent — a crossing
   missed, or a tangency counted once — so entries cannot be paired with exits.
2. **156 loops out of 199 pieces is one loop per piece.** The ring is essentially
   inside the subject, so the correct answer is THREE loops: the subject, plus
   the ring's outer and its island, as holes. Instead every piece was left an
   isolated fragment and sealed into its own loop.
3. **`sealedArea` 1.6382e10 is ~95% of the tile's own area (1.718e10)** — and it
   is the same ~1.639e10 in every one of Kobin's five reports. The seal is
   swallowing essentially the whole subject, which is why the result is wedges
   rather than a cut.

### ROOT CAUSE — catastrophic cancellation in `circleCircle`

`geometry/arcPerimeter.js`, the closed-form circle-circle intersection, used the
textbook form:

```js
const a = (r1 * r1 - r2 * r2 + d2) / (2 * d);
const h2 = r1 * r1 - a * a;
```

Ink carried two frame levels down arrives as arcs that are very nearly straight,
and a nearly straight arc has an ENORMOUS radius — 6.49e10 in his drawing. The
eraser cutting it has radius 21. So:

* `r1²` = 4.2e21, and one ulp of that is **9.4e5**;
* the `h²` being asked for is at most `r2²` = **441**.

The answer is two thousand times smaller than the noise in its own operands. It
comes back zero or negative, so the two intersection points collapse into one or
vanish. **That is an entry without its exit**: the fragments cannot pair, the walk
hands back chains that never close, and every piece is sealed into its own loop
with a chord across the object.

The threshold predicted by `r1²·ε > r2²` is `r1 = r2/√ε` ≈ **1.4e9**. Measured on
a straddling sweep, holding everything constant but the radius:

| r1 | crossings | loops | open chains |
|---|---|---|---|
| 1e5 – 1e7 | 0 | 3 | 0 |
| 1e8 – 1e9 | 4 | 2 | 0 |
| **1e10** | **3 — odd** | **146** | **146** |
| **1e11 – 1e12** | **0** | **145** | **145** |

It turns exactly where the arithmetic says it must. His arcs are 6.49e10, 46x
past it, and his reports said `crossings=3`.

**Why it took three wrong turns to find.** Two plausible hypotheses were tested
and killed first, and both failed for the same reason: they put the eraser WHOLLY
INSIDE the ink, where no intersection is ever computed — the classification is a
winding query and the arithmetic never touches the huge arc. Only a ring that
STRADDLES the edge forces the intersection. That fact is the real lesson here: a
scale-sensitivity test that does not make the two shapes cross proves nothing.

**The fix.** Keep every small quantity small. `u = d - r1` is O(r2) and is formed
without squaring anything; `r1 - a` follows from it by difference of two squares,
and `h²` factorises as `(r1-a)(r1+a)`. No expression holds `r1²` while wanting an
answer the size of `r2²`.

**Measured after the fix**, same drawing, same gestures: the aimed reproduction
goes from **6 of 21 gestures sealing to 0 of 21**, and crossing counts are even at
every radius. The captured operands (`.kobin-reports/f34-operands.json`, kept as
`src/engine/f34.operands.test.js`) go from `crossings=3, open=156, sealed=156,
loops=156` to `crossings=4, open=0, sealed=0, loops=2`.

**A second fault, recorded as a fact; it is not what he hit.** The synthetic straddling sweep at
r >= 1e10 now finds all four crossings but STILL fails to assemble — 146 open
chains, `unbalanced=7`. Kobin's real case is clean, so this is not what he hit,
but the assembly clearly has a second failure mode at extreme radius that the
intersection fix does not cover. F34 closed on 2026-09-07 with this noted; the
F46 probe of 2026-09-05 found a small eraser across a huge-radius edge
assembling correctly at every radius to 2.6e16, so the case is narrower than
this sweep, and the ring sweep itself has not been rerun.

### THE ARITHMETIC FIX IS A PATCH. THE REAL FAULT IS A DESIGN VIOLATION.

Kobin, 2026-08-26, on being told the render freeze and the cut are separate on
purpose: *"I think you're wrong... Once a curve turns to a line, that is the truth
from that point downward. The eraser always cuts into a local shape — that's why
the tiles are ceded... That tile would contain a true straight line, which should
be the source of truth for the real shape."*

He is right, and the bible says so in as many words. Frame-lattice bible §4.3:

> **after the freeze there is no true arc.** Nothing in the system can consult it;
> at that depth its centre is not even computable. The line is the source of truth.

and §10.4, stating the invariant that makes the whole representation safe:

> The sagitta is local. `(chord/2) * |tan(sweep/4)|` — the bulge form. **The centre
> never appears**, so section 3.1a's "no precision ceiling" is preserved and **a
> radius of 1e18 cannot spoil the test.**

The design anticipated this failure and named the rule that prevents it. Two
places break it:

1. **The freeze is wired into the render chain only.** `chopFreezeLoops` is
   reachable from `derive.js` -> `TileStore` and nowhere else. The erase path runs
   `projectF` -> `clipShapeToRect` -> `subtractShape`, and `projectF` deliberately
   keeps the arc ("an arc stays an arc: the endpoints move, the bulge does not
   change at all"). So the cut consults geometry D2 says no longer exists.
2. **`circleCircle` computes from the centre and the radius**, and squares the
   radius. That is exactly the operation §10.4 says never happens.

So the `circleCircle` rewrite is worth keeping — centre-based intersection should
not fall over — but it treats the symptom. The design-correct repair is one of:

* **Freeze on the cede path**, so the ink in a ceded tile really is the straight
  line the design says it is, and there is no circle to intersect; or
* **Intersect in bulge form**, never materialising the centre, as the rest of the
  lattice already does.

The first is what Kobin describes and is the better fit for the erase story — the
tile is ceded precisely so the eraser meets a small local shape. It would also
account for the leftover assembly failure below, because that regime (radii above
1e10 arriving at the boolean) should not exist on this path at all.

**Closed 2026-09-07 by Kobin's decision on the arithmetic fix plus the Chrome
run below; the design-correct repair, D1, was dropped from the roadmap's register on 2026-09-08.**

**Seen in Kobin's Chrome, 2026-09-07 — by Claude in his tab, not yet by his own
hand.** `f34-input-pre-erase` loaded through `loadDrawing` into a second engine,
the 21 aimed ring gestures of `f34.repro` made at the corner: **0 of 21 sealed**,
0 open chains, every one a clean cede of object 27 (the two 160-px rings off the
diagonal cut objects 47 and 48 in place, as his gesture did). The painted result
is an annulus around the corner with no slanted line over 200 px in any path;
the paper wedge at the ring's centre is the drawing's own inside corner, there
before the erase.

*Suite note, found while regression-testing this:* `perf.instrument.test.js` PI-6
("off: cheap operations stay out of the log") asserts that 40 zooms each finish
in under 8 ms, because `_perf` only logs an op at 8 ms or slower. That is a
claim about the MACHINE, not the code, and it fails whenever the box is loaded —
it went red running `test:quick` and `test:slow` concurrently and passes 21/21
on its own. Latent flake; give it a trace-mode assertion instead of a wall-clock
one.

<a id="f33"></a>
### F33 — autosave dies silently when localStorage fills (OPEN)

Kobin, 2026-08-26, mid-session: *"No I can't save it."* Report `18-16-24` carries
seven of these between 18:05 and 18:13:

```
autosave failed (storage full): Failed to execute 'setItem' on 'Storage':
Setting the value of 'kobin.canvas.mtaelfl1d4v3' exceeded the quota.
```

The write is wrapped in `try { ... } catch (err) { /* quota */ }`
(useKobinEngine.js:451). It swallows the failure, so the app goes on looking
exactly as it does when saving works. **The drawing then exists only in the
tab's memory**, and nothing on screen says so.

Measured live in his browser: 4.9 MB against Chrome's ~5 MB per-origin cap.

| | |
|---|---|
| `kobin.thumb.*` | **1.54 MB** — scene thumbnails for **14** canvases, 251 keys |
| `kobin.canvas.*` | 1.34 MB |
| `kobin.other` | 1.10 MB |
| `boundlessDrawing:*` | 0.62 MB |

The stored slot for the open canvas held **6,144 bytes** of lz1 — an early state —
while the live document serialized to **2,121,240**. Every save for eleven
minutes had failed. He was not signed in, so there was no cloud copy either. The
work was recovered by pulling `serializeDrawing()` out of the live page.

Clearing the 251 thumbnail keys freed 1.54 MB and restored headroom, but that is
housekeeping, not a fix. Three things are wrong and only the first is urgent:

1. **A failed save must be visible.** Silence is the whole defect — a warning, or
   the existing cross-device edit banner, would have cost him nothing.
2. **Thumbnails are unbounded.** 14 canvases' worth accumulate with no eviction,
   and they are regenerable — they should be first to go, automatically.
3. **A 2.1 MB drawing does not belong in a 5 MB origin budget** shared with every
   other canvas. localStorage is the wrong home for documents this size.

#### MITIGATION, 2026-08-26 — local autosave turned OFF

Kobin: *"Can you turn auto save off until we fix that? It's making this hard to
use."* `LOCAL_AUTOSAVE = false` in `hooks/useKobinEngine.js`. Flip it back to
true to restore; nothing else has to change.

**Why it was still painful after the 2026-08-25 backoff.** The backoff stops the
hot loop, not the cost. Every attempt does the entire job — serialize, stringify,
compress — before the write is allowed to throw, which is ~960 ms of blocked main
thread on a 4.1 MB document. It still fired on a schedule, and `saveOnUnload`
forces past the backoff, so every reload paid a full second for nothing.

**Two things had to be fixed first, or "autosave off" would have meant "nothing
saves at all".** Both were pre-existing and neither was caused by turning it off:

* **A failed local write took the cloud down with it.** `persistCanvas` returned
  `{local:false}` the moment `saveToLocalStorage` came back null — *before*
  reaching `cloudSaveCanvas`. So a signed-in user with a full localStorage could
  not save to their account by pressing Save. It now serializes independently and
  carries on; `saveToastFor` reports the two halves separately.
* **`cloudDirtyRef` was only ever set by a SUCCESSFUL local autosave.** With the
  quota full it never became true, so the 30-second background push never ran
  either. It is now set from document changes, which is the honest signal.

Taken together those two mean that *before this change*, a signed-in user whose
storage was full had **no working save path of any kind** — which is worse than
the flag described, and is worth knowing when it comes to fixing it properly.

**And the banner was never rendered.** `saveError` has been computed by the hook
since 2026-08-25 and no component ever displayed it, so item 1 above — "a failed
save must be visible" — was written, wired, and then invisible anyway. It is
rendered now (`.bl-savebar` in CanvasEditor), and carries the standing
"autosave is off" notice as well as real failures.

Item 1 is therefore closed. **Items 2 and 3 are what is actually left**, and item
2 (unbounded thumbnails, 1.54 MB across 251 keys) is the cheap one that would
restore enough headroom to turn autosave back on.

#### MEASURED, 2026-08-26 — the cost is COMPRESSION, not the quota

Phone report `23-54-04` (Android, Chrome 151, level 6). The 300-entry perf log
covers the last **48.6 s** before the report, and in it:

| op | calls | total | share of blocking | worst |
|---|---|---|---|---|
| **autosave** | 5 | **29.6 s** | **57%** | 6,772.8 ms |
| bake | 190 | 20.9 s | 40% | 6,900.8 ms |
| render | 94 | 1.5 s | 3% | 120.0 ms |

Every one of those five autosaves **SUCCEEDED** (`ok: 1`). This is not the quota
path at all. The worst one breaks down as:

```
serMs   31.6      serialize the document
jsonMs 108.1      JSON.stringify
packMs 6568.7  <- LZString.compressToUTF16   97% of it
putMs   64.3      the localStorage write itself
```

The document is **16.15 million characters**, packing to 3.71 MB. It grew
14.84M -> 16.15M across the log and each save got slower with it: 5.18, 5.71,
5.71, 6.27, 6.77 s, fired 6-13 s apart. A 5-7 second freeze roughly every ten
seconds.

**The browser attributes them independently.** Four of the six worst long frames
are `invoker: IdleRequestCallback` on `main.chunk.js` — which is `idleSave` and
nothing else — with style-and-layout 0 and paint under 1 ms. Pure script:

```
6277.5 ms frame -> script 6273.9  IdleRequestCallback
5761.5 ms frame -> script 5709.0  IdleRequestCallback
5731.3 ms frame -> script 5709.4  IdleRequestCallback
5230.5 ms frame -> script 5181.5  IdleRequestCallback
```

**So the fix is not "get under the quota".** Compressing a 16 MB string on the
main thread is unaffordable at any quota. Whatever replaces this has to either
not compress on the main thread (a worker), not compress at all (IndexedDB has
no 5 MB cap and takes structured data), or not rewrite the whole document every
time (incremental saves). Item 2 buys headroom; it does not make this fast.

**One thing in the same report is NOT autosave and wants its own look:** the
single worst frame of the session is **7,858.9 ms** attributed to
`dispatchDiscreteEvent` / `DIV#root.onclick` — a click handler, 7.8 s of script,
no layout, no paint. Baking is the other 40%, concentrated in three outliers
worth 11.2 s of its 20.9 s.

(The 681,970 ms and 103,452 ms entries in `frames.worst` are almost certainly the
phone backgrounding the tab — `hiddenSkipped: 0`, so the meter did not exclude
hidden time. Do not read those as freezes.)

#### REWORKED, 2026-09-02 — IndexedDB, per frame, incremental. AWAITING KOBIN'S TEST

Kobin: *"go ahead and do your autosave recommendations. Also make any changes if
needed to make sure data isn't being leaked for users."*

**What changed.** The document lives in IndexedDB (`storage/db.js`): one header
record per canvas (meta, camera, the frame lattice, the list of frame ids) and
one record per frame holding that frame's natives, as structured data. Nothing is
stringified and nothing is compressed on the way in. A save serializes only the
frames the document's own events named — every `Document` event carries its
frame — and writes them with the header in one transaction, so a torn write
cannot leave a header pointing at frames that are not there. An incremental
write with no base record is refused and retried as a full one. The saver waits
1.5 s behind the last change, never longer than 8 s from the first unsaved one,
and flushes on tab hide, pagehide and unmount. A pan or zoom with no edit is
written once it has stopped moving, for canvases that already exist on disk. A
new canvas nobody drew on is never written. Undo and redo mark everything dirty
(one silent re-key step inside an erase was not worth a new event). A failed
write backs off 8 s -> 256 s, keeps its frames in the dirty set, and shows the
bar. `LOCAL_AUTOSAVE = true`; the standing notice is gone, the failure notice
stays.

**The cloud path** keeps its format, chunking and parent-last order. The
compression now runs in a Web Worker (`cloud/lzWorker.js`, `public/lz-worker.js`)
with a main-thread fallback, and both the Save button's push and the 30 s sync
are in the perf log as `cloudSave` with `jsonMs / packMs / putMs`. They were not
timed before; on a big drawing they cost the same as the local save did.

**Leaks closed.** Forced saves on unload wrote an empty document for every new
canvas visited and left; nothing wrote them now. The gallery runs a sweep on
load: unindexed documents with ink are adopted as drafts, empty ones deleted;
frame records without a header go; backups older than a week go; thumbnails for
canvases that exist nowhere go, and the rest sit under a 12 MB LRU budget as
JPEG bytes (the old data URLs in UTF-16 were 2.7x the image); trash payloads
whose index row is gone go. The one-time migration moves every `kobin.canvas.*`,
`kobin.trash.*` and `kobin.thumb.*` key into the database and deletes it, along
with the `.bak` copies, `boundlessDrawing:*` (the deleted CanvasV2 page's) and
`kobinSnapshot`. `kobinAutosave` is left alone. The gallery shows "Using N MB of
browser storage" from `navigator.storage.estimate()` and asks once for
persistent storage.

**Measured, 2026-09-02, in the in-app browser (Chromium, an 800x450 pane).**
The migration moved two documents and two thumbnails and left localStorage with
the index, two flags and the legacy key. A new canvas left idle 6.5 s wrote
nothing. Two strokes: one full write, `serMs 0.7, putMs 1.0`, 1.7 ms. A third
stroke: an incremental write of one frame, 1.9 ms. Ctrl+Z: a full write, 1.9 ms.
A wheel zoom with no edit: a header-only write ten seconds later, 1.9 ms. Reload:
both strokes and the zoom came back, and the reload itself wrote nothing. Leaving
by Home offered the draft dialog as before.

**NOT measured**, and the reason this stays open: the 16-million-character
drawing on the phone. The done-when is unchanged — no `autosave` entry over 50 ms
there. Also unexercised outside the unit tests: the quota-failure path, and a
browser without IndexedDB (the saver then shows the failure bar on every attempt,
which is the honest outcome).

<a id="f27"></a>
### F27 — CLOSED. "Some erasures would never bake."

Kobin, pressing on a diagnosis that did not cover his symptoms. He was right.

Erasing ink homed SHALLOWER than the gesture re-homes it: the tile is cut out of
the parent and carried down. `_bakeRehome` can only do that along an ancestor
chain, and it checks — `if (!path || path.up.length || !path.down.length) return
false;`. The frame tree BRANCHES, though: a second visit to a region far from
the first mints a sibling (`2~3`, `4~6`), so "finer than" and "underneath" are
different questions, and between two branches there is no chain to cede along.

The refusal was silent, and it came after `_bakeOne` had already run
`done.add(o.id)`. That set is how an eraser remembers what it has handled, so
the object was marked done for that gesture and never revisited: the mark
painted, the baker consumed it, and the ink was never cut. Nothing logged it and
nothing retried it.

Measured on his own document (`report-2026-08-15T17-19-58`, 12 frames, 6 of them
siblings) — **8 of the 12 frames had a blind spot**:

```
erase made in 4~5: silently skips ink homed at 2 (4 objs), 3 (2 objs)
erase made in 4~6: silently skips ink homed at 2 (4 objs), 3 (2 objs)
erase made in 4~2: silently skips ink homed at 3 (2 objs), 2~3 (30 objs), 3~4 (5 objs)
erase made in 5:   silently skips ink homed at 2~3 (30 objs), 3~4 (5), 4~5 (1), 4~6 (7)
```

Ceding needs an ancestor chain; cutting does not. Where there is no chain, the
erase now falls through to the ordinary in-place cut — the eraser is projected
into the target's frame and subtracted, exactly as it is for two frames at the
same depth. The hole lands in the coarser object rather than in a tile of its
own, which is the right answer when the gesture is not underneath it.

<a id="f26"></a>
### F26 — CLOSED. A completed cut looked exactly like a join.

Kobin, 2026-08-15 pm: "some of them did split the pieces, but none of them were
split correctly." Three scenarios, before-and-after reports for each. Two
defects, both in what a family does with its tile boundary.

**1. A point contact was treated as connectivity.** Severance is read off the
tile edge: a child piece and a parent piece are joined when their ink meets on
the same stretch of the rect they share. `arcsTouch` accepted overlap-OR-ABUT,
so meeting at a single point counted. But when an erase finally cuts through to
the edge of a tile, the two pieces it leaves necessarily meet that edge **at the
same point** — the one the eraser crossed. That is the signature of a completed
cut, and it was being read as proof the object still hung together. Measured on
his simplest case, the lower half's contact with the upper parent was
`[0.19, 0.19]` — one point — against a real contact of 1.47 of the perimeter.

A join now needs a shared STRETCH. Ink has width, so anything genuinely crossing
a tile edge crosses it over an interval; the tolerance only has to exceed
rounding. Two `connect.test.js` cases asserted the old behaviour and are
rewritten: abutting contacts used to be bridged by `tol`, which dates from when
the boundary came off Clipper's integer lattice and one contact could be split
in two by quantization. The arc clip puts contacts exactly on the rect, so a gap
between two of them is a real gap.

With that alone his first scenario goes from one object to two, and every level
appears on both sides — one object split lengthwise, not a level left behind.

**2. A grazing clip minted a native made of nothing.** Where a parent's boundary
only grazes a tile, `_inkShapeInRect` returns a strip with no area — two line
pieces, out and back along the rect edge. `_bakeRehome` ceded a tile for it
anyway, and each one became a native that paints nothing, connects to nothing,
and counts as its own component of the object for ever. His third scenario
carried **fourteen** of them, all identical, one per gesture; they are why a
family of 18 pieces reported 16 components. The clip is now culled against the
pen before anything is ceded.

<a id="f24"></a>
### F24 — CLOSED. The stitch lost boundary when a cut finished an earlier cut

**FIXED 2026-08-15. Two defects, one on top of the other.** The trigger is a cut
that finishes an earlier cut; the reason it was so hard to see is that the second
defect only became visible once the first was repaired.

**1. Coincident boundary was invisible to the boolean.** `circleCircle` divides
by the distance between the two centres and `segSeg` by the cross product of the
two directions, so curves that lie ON each other report no crossing at all —
correctly, there is no isolated crossing. But "no crossings" was then read as
"nothing to do here", and the fragments were classified by a winding query taken
at a midpoint sitting exactly on the other shape's boundary, where there is no
answer to give. `pieceOverlap` now finds those stretches and cuts at their ends,
and a coincident fragment is classified by ORIENTATION instead:

|  | same direction | opposite direction |
|---|---|---|
| difference | B covers A here — the edge is gone | B is outside A here — A keeps its edge |
| intersection | the shared edge bounds A n B | nothing is in both — drop it |

The clip's copy is always dropped: where the edge survives, A's copy carries it,
and admitting both puts two fragments on one stretch and leaves the walk a
junction it cannot balance.

**2. A biarc pen writes lines down as circles of radius 4.99e17.** Fitting a
nearly-straight stretch, the pen emits an arc whose sagitta — its departure from
its own chord — is 2.5e-17 on an object spanning 3.5e4. That is thousands of
times below one ulp of the coordinates it is written in: it IS a line. Every
piece of arithmetic that treated it as a circle was then computing with a radius
five thousand billion times the object. `|m - C| - r` cancels completely (one ulp
at 4.99e17 is 64 units, so every point within 64 units reported a distance of
exactly ZERO — 45 fragments of a 146-unit eraser were declared to be lying on the
ink's boundary); its sweep is 2e-17 radians, so `paramOf` divides by a number
with no significant digits. `straighten()` converts any arc whose sagitta is
below a few ulps of the coordinates in play into a line, on the boolean's own
working copy. It changes the geometry by less than one ulp and makes all of it
exact.

**THE INVARIANT TO KEEP: an erase cannot remove more than its eraser swept.**
Width along the path, plus the round ends. That is what the failure broke, and
by four orders of magnitude — see the replay below. `erase.retrace.test.js`
asserts it on Kobin's own gestures.

**What this changes about the reports.** His e42 never severed anything. The
eraser swept 0.83 square units and the boolean removed 22,722 — the 58 chords
tore the object in half, and that is the "split" he saw. Replayed on the fixed
code the three gestures remove 987, 24 and 1 square units against swept areas of
942, 24 and 0.83, and the object stays whole. **This is the answer to "some of
them did split the pieces, but none of them were split correctly": several of
those splits were never cuts at all.**

Verified: `erase.retrace.test.js` (14 tests — the two-gesture reproduction, a
zoom x gap sweep, `pieceOverlap` unit tests, and his own session replayed from
report `20-54-08` + the gestures in `20-55-00`); the Y-junction ring eraser below
now seals nothing and an exact repeat of a ring gesture removes 0.0000; live in
the browser, the retraced cut removes 4,965 where the pen-one-unit-wider control
removes 5,209 — the inequality that used to be inverted by 13% of the object.
Full suite 66 suites / 1186 tests.

---

The original investigation follows.

**THE TRIGGER IS A CUT THAT FINISHES AN EARLIER CUT** (measured 2026-08-15).
Not depth, not tiles, not the size of the eraser. A second gesture that starts
inside the ground a previous eraser already removed and pushes past where it
stopped — which is exactly how anybody severs something they are being careful
about, and the only way to sever anything at depth, where the object is
thousands of times the eraser.

Minimal reproduction, level 0, one stroke, no tiles, no cede, two gestures:

```js
drawStroke(E, [[200, 430], [750, 450], [1300, 430]], 220);
erase(E, [[752, 300], [752, 434 - gap]], 60);   // cut in, stop short
erase(E, [[752, 380], [752, 434 + gap * 3]], 60);  // RETRACE and push through
// -> 3 open chains, sealed.  Coming at the same bridge from the FAR side
//    severs it just as thoroughly and seals nothing.
```

Held across a 9-cell sweep — in-level zoom 1x, 30x, 130x × gap 40, 8, 1 units.
Every retrace sealed; every far-side approach was clean. Kobin's own report
`20-55-00` is the same shape at depth: erases 38, 40, 42 nibble the same neck
with gestures spanning 139.7, 23.1 and 3.1 units, and the third one — the one
that finally severs, retracing the second — is the one that sealed 58 chains.
Erases 24 and 32 in the same session used SMALLER erasers (0.154 and 0.197
frame units against 0.250) and sealed nothing, so eraser scale is not the
variable.

**And the mechanism is CO-CIRCULAR boundary — proved by changing the pen by one
unit.** The edge a baked eraser leaves is a circular arc of exactly the pen's
radius. Retrace with the same pen and the new clip generates arcs of exactly
that radius along the same path, so the two boundaries do not cross, they
COINCIDE — and a boolean that decides everything by counting transversal
crossings has nothing to count. Five cuts that all sever the same object:

| second cut | pieces | ink left | seals |
|---|---|---|---|
| **same pen (60), same path** | 2 | **219,876** | **1 (2 open)** |
| wider pen (61), same path | 2 | 253,420 | 0 |
| narrower pen (45), same path | 2 | 256,985 | 0 |
| same pen, path offset 3 units | 2 | 253,580 | 0 |
| same pen, path offset 20 units | 2 | 251,651 | 0 |

A 61-unit eraser removes MORE ink than a 60-unit one, and still leaves 253,420.
The co-circular case destroyed **33,544 units, 13% of the object**, that no
eraser ever touched. One unit of pen radius, or three units of lateral offset,
and it is clean.

The retrace alone is not enough: a second gesture that stays strictly INSIDE the
channel the first one cleared is a no-op to 0.000% and seals nothing. It takes
retracing AND pushing past where the first one stopped — the point where the new
eraser's boundary leaves the old one's, which is exactly where two identical
circles part company.

So the fix is in `pieceIntersections` / the stitch: coincident (co-circular,
collinear) boundary needs handling as overlap, not as a pair of crossings.

Reduced case, in `arcShape.test.js` terms: a Y drawn with a 24-unit pen, cut by
a ring-shaped eraser gesture centred on the junction (`topology.slow.test.js`
TP-3 draws exactly this). The subtraction reports:

```
crossings 17   pieces 130   kept 52   unbalanced 2   sealed 2 (1,135 of 5,521 units)
```

**17 is the tell.** Two closed boundaries cross transversally an EVEN number of
times; an odd count means a crossing was found on one side and not the other, or
one was missed entirely. The two unbalanced vertices follow from it: a vertex
with more arrivals than departures cannot be walked through, and the two chains
that pass through them never close. What they carry is the island of ink inside
the ring — a third of the result.

Ruled out already:
* the welding radius. Retried at 0.1x, 10x and 0.01x (`shapeBoolean` does this
  automatically now when a seal was needed); the same two chains open every time.
* the crossing-parameter slack. Widening `eps` from the rounding scale to the
  welding radius changes nothing, so crossings are not being rejected for
  landing a hair outside a piece.
* the winding oracle: `ambiguous: 0`, so no query gave up and retried.

That leaves `pieceIntersections` missing a crossing (a tangency, or a crossing
exactly at a shared endpoint where only one of the two neighbouring pieces
reports it), or the burial classification keeping a set of fragments that is not
a valid boundary. **Next step: dump the 17 crossing points with the piece pairs
that produced them, and find the one whose partner is absent.** Everything the
seal does is a workaround for this.

<a id="f23"></a>
### F23 — CLOSED 2026-09-07, by decision. What an evening of real use found (2026-08-15)

Closed on Kobin's word. Items 2 to 5 were fixed at the time; item 1's stitch
defect was never reproduced, the stroke behind it is in no report (end of
item 1), and the seal keeps it from damaging a document.

Kobin drew, erased and moved things on a phone for an evening and sent six
snapshots (`.kobin-reports/report-2026-08-15T07-4*.json`, 324 to 484 natives —
the tests in `reported.regress.test.js` and `erase.fuzz.slow.test.js` load them).
His verdict on the part that was in doubt: **"the erasers seem to be
mathematically exact — when I zoom way in to a corner after erasing through
multiple objects at the same time, I don't notice any unevenness or pieces
sticking through"**, with "relatively little tile issues and performance issues".
What he did report, in the order it matters:

**1. Geometry that does not close was being STORED.** The worst of the five, and
the only one that damages a document. `ArcBakeJob` has always counted the chains
it could not stitch (`stats.openChains`) and nothing ever asked. His document
carries the result: object #418, a 39-unit pen, **871 pieces in 68 chains, every
one of them open** — 338 on one rail, 467 on the other, and 66 slivers between.
An unclosed chain is painted shut with a straight line across the object, so its
winding means nothing and it paints nothing: this is the object he watched "fade
out of existence". It also made the drawing **unsaveable**, because the file
format validates closure and refuses the whole document over one bad object.

The invariant is now enforced where geometry is MADE, so nothing downstream has
to cope with an open chain:

* `shapeBoolean` closes what its walk could not, with a chord, and reports
  `sealed` / `sealedArea`. Dropping the chain instead loses real ink: measured on
  a plain Y-stroke cut by a ring eraser, the two open chains were the island
  inside the ring — 1,135 of the shape's 5,521 units — and losing it makes the
  erase visibly do the wrong thing. A chord in a place the arithmetic had already
  given up on is the better of the two, and the count says how often it happens.
* the bake SEALS the same way (`KobinEngine._sealed`), which is what #418 needed:
  a stroke has to become something, so it is repaired, and the damage stops at
  that stroke instead of spreading into every erase made against it afterwards.
* a drawing that already carries the damage is repaired ON LOAD
  (`arcShape.repairLoops`), and an object with nothing left after repair is
  dropped rather than taken as grounds to refuse the whole file.

**Refusing was tried first and is wrong.** An erase whose boolean did not close
was made a no-op — safe for the document, and it broke two existing topology
tests outright: a ring eraser cutting a figure-of-eight at its crossing, and the
same eraser on a three-way junction, both perfectly ordinary gestures, both
silently doing nothing. Those tests had been passing WITH the open chains
stored, which is the more uncomfortable finding: an erase that produced garbage
looked identical to one that worked, from any assertion about object counts.

**The stitch bug behind it is still open.** On the Y-stroke case the boolean
reports 17 crossings between two closed shapes, where a transversal count must
be even, and two unbalanced vertices. Neither the welding radius (tried at 0.1x,
10x and 0.01x) nor the crossing-parameter slack changes it, so it is a
classification or pairing defect, not a tolerance. The seal keeps it from
damaging documents; it does not fix it. **It was the first thing to pick up
until 2026-09-07, when F23 closed by decision with it unreproduced (below).**

**2026-08-26 — is this F34? No, and the arithmetic says why.** F34 has the
identical signature (odd crossing count between closed shapes, weld retries at
0.1x/10x/0.01x changing nothing) and its cause was `circleCircle` losing
intersections to cancellation. But that only bites once `r1²`'s ulp swamps `r2²`,
i.e. above r1 ≈ 1.4e9. This case is ORDINARY scale: a 39-unit pen on a stroke
spanning ~1.5e3, so its arc radii reach maybe 1e6, `r1²` = 1e12, one ulp of that
is 2e-4, and `r2²` ≈ 400. The intersection is comfortably accurate there. **Two
different defects that present the same way** — and "odd crossing count" is
therefore a symptom to diagnose, never an identification.

A reconstruction of the case (three strokes into a junction, ring eraser over it,
`src/engine/f23.ystroke.test.js`, 8 combinations of ring radius and pen) comes
back clean — 0 seals, 0 dust. That is NOT evidence the defect is gone: the
original was measured on Kobin's own geometry and this is a guess at its shape.
It only says the reconstruction misses it. Getting the real one needs the
document, the way F34's did.

**2026-09-07, Kobin's Chrome.** The six `07-4x` reports carry no journal, so the
stroke that made #418 is gone; only its stored result exists, and it cannot be
re-baked. A reconstruction in the browser with the same 39-unit pen — three arms
into a junction, a 3,660-sample serpentine, a hairpin — baked to one loop each
with no repair, and a ring erase over the junction cut all five with 0 seals.
Standing unchanged: unreproducible without the document; the seal contains it.

**2. "Small pixel dots."** Two eraser passes a little further apart than their own
width leave a wafer of ink between them. His document has nine, the thinnest
0.028 units of mean width against a **39-unit pen** — 0.07% of the thinnest mark
that pen can make, i.e. not something a person put there. Cut components thinner
than 1% of the pen are now dropped rather than made into natives
(`arcShape.dropDust`); each one that survived was an object that got indexed,
tiled, erased against, selected, and painted as a speck.

**3/4. A move over a mark that had not baked yet.** A mark is a native at fixed
coordinates. The erase barrier covered only the object under the finger, so with
several objects selected — or one object with a re-homed piece at another level —
ink was dragged out from under a mark that had not been applied. The mark stayed
behind, went on painting white over whatever had arrived there, and then cut it.
`_settleSelectionErases` now settles every mark pending over anything in the
selection and consumes the spent ones. It carries the selection across those
bakes by REPLACEMENT (diffing the document around each bake), because ids change
when a cut splits an object and `z` is inherited by every descendant forever — a
piece split off ten minutes ago shares it and would silently join the drag.

**5. Performance.** Two separate costs, both measured on his document:

| | before | after |
|---|---|---|
| drag, 9-member family (5,810 arc pieces) | 138 ms/event | **56 ms** |
| erase across a 241-object screen | 3.5 s of white mark | **~0.9 s** |
| worst erase slice | 128 ms | **66 ms** |

* every drag event re-derived the moved geometry into **every cached tile**,
  on screen or not. Tiles the camera cannot see are dropped during a drag now
  (`TileStore.setBatch`) and rebuilt lazily if it ever goes back.
* `shapeRingsInRect` had a fast path for "no piece reaches this tile" and none
  for the opposite — a shape wholly INSIDE the tile, which is the common case
  for anything shown from a finer level, and which needs no clip at all. 5.5 ms
  per tile per member became 0.2 ms.
* the erase baker did ONE object per 80 ms tick. A gesture across a crowded
  region touches dozens of objects (94 of them, in one of his), so the ink lagged
  the gesture by seconds. It takes an 8 ms budget now, like every other sliced
  job here.
* `_eraseMayTouch` projected the eraser's whole GEOMETRY to test a bounding box,
  once per candidate object per scan. Every frame hop is a uniform scale plus a
  translation, so a box maps to a box exactly: it maps the box now.

**Still not proven.** The boolean's tolerances were also re-scaled — from the
largest magnitude in the room to the region where the two shapes actually MEET —
because a level-0 object clipped into a tile five crossings down arrives 2.4e17
times its own size and a fuzz taken from that comes to 1e5 units against a
12,330-unit rect, which would weld the result into exactly the wreck #418 is.
**That is reasoning, not a reproduction**: 70 randomized erase scenarios across
five depths behave identically with the old rule and the new one
(`erase.fuzz.slow.test.js`), so the tolerance change is hardening, and the seal
in (1) is what actually guarantees the damage cannot be stored again.

**Not reproduced at all:** the erase that "did not split the piece in two". His
own document, replayed from the snapshot immediately before it with the camera he
had, severs correctly pass by pass; so does a stroke cut through its thickness one
crossing down (which takes eleven passes, because one crossing down a 12-unit pen
is 36,000 units and a screen shows 4,700). The likeliest explanation is (1) plus
the 80 ms cadence — the cut was made, and what was on screen was seconds behind
the gesture. Ask him whether it still happens now that the mark keeps up.

<a id="f15"></a>
### F15 — CLOSED. Five separate defects, all in how the boundary was located.

Kobin's strokes baked with solid wedges bounded by long straight edges. Those
edges were fabricated: an unclosed chain gets painted shut with a straight line
across the shape, so a misjudgement of hundredths of a unit came out as a
400-unit slab. Everything below is measured.

**1. The burial window was the root cause.** Burial excluded an arc-length window
around the tested piece's OWN generating cubic, so neighbouring pieces of one
chain used *different predicates*. Where a stroke runs back alongside itself at
an arc separation near the window's edge, the window sweeps over the overlapping
ink as the generator advances and burial flips between one piece and the next —
at a chain junction, with no crossing there to cut at. It is gone; burial is a
function of position only. A hand-drawn ring went from **510 wrong of 2,038 with
31 open chains** to 0 and 0.

**2. One crossing was being reported at two different places.** Subdivision
returns the centre of the last surviving box, and its two halves are centres of
*different* boxes. For a shallow crossing the box is long and thin and the two
centres land far apart — measured at 0.05 units on a tight wiggle and **1.10
units** on a ring, both over the welding tolerance, so the two pieces cut there
never joined. Newton on `a(ta) - b(tb) = 0` now polishes every hit; disagreement
is **1e-13**. Crossings are then registered in a shared `VertexSet` so both
pieces literally use the same coordinates.

**3. The burial threshold had zero safety margin.** `margin = fitTol` exactly,
while a fitted offset may sit `fitTol` inside the true one — so a legitimate
boundary point landed precisely on the threshold. It survived only because the
oracle used to be coarse enough (r/64) that the tolerance it subtracts supplied
slack by accident. Sharpening the oracle removed the accident: the dense scribble
kept **66 boundary pieces of 11,152** and painted two thin slabs where the ink is
a solid blob. Margin is now `2 * fitTol`, and the oracle is r/512 — the only
setting clean on all seven cases (r/256 and coarser reopen the scribble).

**4. The perimeter must be BUILT finer than the tolerance it must meet.** Cuts
are made where the *fitted* offsets cross; burial is judged against the *true*
centerline. Where those disagree they disagree by the fitting error, and at a
crossing of angle θ an error of δ displaces the crossing along the curve by
δ/sin θ. A pen-drawn scrawl left six unclosed chains with dangling ends **8 to 35
units apart** — from a fitting error of 0.02. `buildTolFor` now divides the
required tolerance by 8 **and floors it at r/10,000**, the floor being what
matters because the amplification is geometric, not absolute.

**5. The walk depended on where it started.** It took the most clockwise UNUSED
departure, so an earlier loop could consume the piece a later one needed. The
turn rule was right; the greed was not. Edge-ends are now paired at each vertex
first (sweep clockwise, match each departure to the most recent arrival), which
makes `next` a bijection on pieces — its cycles ARE the loops, every piece used
once, every cycle closed, no traversal order to depend on.

**Plus a structural guarantee.** A vertex with equal in- and out-degree cannot
strand a walk, so `stitchCubics` now welds leftover +1/-1 vertex pairs within
`r/8` before walking. Unbalance means classification kept a piece whose partner
it dropped; the pair sits essentially on top of itself, and welding it moves an
endpoint only at a junction, where the union genuinely has a corner.

Also fixed on the way: the lab silently dropped whole strokes
(`getCoalescedEvents()` can return an empty array); B never welded its caps to
its body (180° junction on a stroke with no corner); B built no round joins
between cubics, so it was missing two boundary pieces on a six-sample stroke; B
judged burial from a sub-piece's midpoint *while drawing*, before the cut that
would have split it existed, and dropping is permanent — one germ of 149, 5.7
units long.

<a id="f16"></a>
### F16 — the scribble is correct but slow (1.9 s at pen-up)

3,775 samples forming a solid blob. Measured in Chrome: **1 loop, 0 open,
0.00 px worst edge error, 10 mismatched pixels of 121,265** — the best accuracy
this stroke has ever produced. The cost is the finer build tolerance from F15.4:
the offset chain is ~44,000 pieces of which ~900 carry any boundary.

Two sound options, neither tried:

* **A deep-interior fast path in the oracle.** Most `buried()` calls in the
  pre-cull are deep inside the ink and scan thousands of segments to say so. A
  coarse grid marking cells that are *definitely* buried (some segment within
  `eff - halfDiagonal` of the cell centre) answers those in one lookup and is
  conservative by construction — it only ever marks a definite yes.
* **Adaptive refinement.** Build at the required tolerance, and rebuild finer
  only if the stitcher reports vertices it could not balance. Most strokes would
  never pay. NOTE this conflicts with B: B builds incrementally and cannot
  cheaply rebuild, so A and B would stop agreeing unless B is dropped.

Do NOT reach for the centerline pre-cull for this. It is still off and still
unsound at the sampling density that makes it cheap.

<a id="f20"></a>
### F20 — the parity weld is load-bearing, and on a heavy stroke it runs out (SUPERSEDED)

**2026-08-14: this is no longer the live blocker.** It was not fixed on the cubic
pipeline; it was dissolved by changing the representation. See F21. The diagnosis
below stays because it is what pointed at the representation in the end — three
attempts to fix it *within* the cubic pipeline all failed, and the reason each
failed was the same: the crossing set could not be made exact while the offsets
were fitted approximations of the true offset.

### F20 (original diagnosis)

Kobin's 6,791-sample width-200 fill-in stroke (saved as `stroke2.json`): a big
dark wedge across the right of the shape. **12.08 % of the ink is not painted,
with 0 % painted where there is no ink** — so the outline encloses too little.

What it is NOT — all measured on that stroke:

* not the pre-cull (`kept` = 1,119 with it on and off),
* not the burial band (swept r/32 to r/4096; every setting leaves 12-28 open),
* not the fitting tolerance (`fitRefine 64` is slightly worse),
* not the neighbour-clipping rule, not the hairline filter,
* not a bad stroke — no jumps (median sample gap 7, max 72), no duplicates, and
  every centerline cubic does produce offset pieces on both sides.

What it IS: turn the parity weld OFF and the perimeter comes apart into **121
open chains**. The weld is not tidying up a handful of marginal junctions, it is
holding together 121 places where classification kept a germ whose partner it
dropped. At r/6 it heals 106 of them and 12 are out of reach; at repairTol = r it
heals all 114 but the worst weld is then **97 units on a 100-unit pen**, which is
not a repair, it is redrawing the shape.

The gap sizes form a continuum from 0.1 to 55 units with no natural cutoff, which
is the tell: there is no tolerance that separates "same junction" from
"different junction" here, so no choice of weld distance is right.

**Why this stroke.** Sample spacing 7 against r = 100, so every offset piece has
a near-duplicate a few pieces away and the whole stroke is one long near-tangency.
Burial is judged by distance to the TRUE centerline while cuts are made where the
FITTED offsets cross; wherever those two disagree the disagreement is amplified
by 1/sin(crossing angle), and on this stroke that situation arises thousands of
times. ~121 of them resolve inconsistently.

### Three fixes tried and REJECTED — do not repeat these

**1. Counting along the chain. BUILT, MEASURED, WORSE, REVERTED.**
The idea: carry a running count of how many capsules cover the current point,
changing it by +/-1 at each crossing, and keep the stretches where it is zero. At
a crossing the two sides get opposite changes, so degrees balance by construction
and the weld could be deleted.

It does not work, and the reason is worth keeping. Counting needs the crossing
set to be EXACTLY right — every crossing found once, with the right sign —
because an error accumulates into everything downstream. Judging each fragment
independently needs no such thing: a missed or duplicated crossing costs that one
fragment and nothing else. On a densely sampled stroke the offsets of
neighbouring cubics are near duplicates of each other, so the crossing set cannot
be made exact, and the count drifts. Measured with anchors re-seeding it wherever
the answer was certain, and with the COMPLETE crossing set (no pre-cull):

| | open chains | anchors disagreeing |
|---|---|---|
| judge each fragment (shipped) | 0 / 12 | — |
| count, pre-culled crossings | 38 / 20 | 157 / 95 |
| count, complete crossings | 424 / 75 | 204 / 150 |

The general lesson: **prefer the estimator that degrades locally.** Anything that
integrates along the boundary trades a bounded local error for an unbounded
global one, and this geometry cannot supply the exactness that trade needs.

**2. Simplifying the centerline first.** The input is heavily over-sampled for
the pen (7-unit spacing against a 100-unit radius), so thinning it should make
the offsets better conditioned. It barely thins: a hand stroke has tremor at
every sample, so Douglas-Peucker at the tolerance budget removes ~20 % of points
and the chain only drops 72,743 -> 57,000. Open chains 12 -> 9. Not the answer.

**3. Pairing loose ends by chain adjacency instead of distance.** Two ends belong
together when they are neighbours along the offset chain, which is a better
question than "are they close". It helps — 12 open -> 2 — but only by allowing
welds of 89 units on a 100-unit pen, which is the shape-redrawing this flag
already rules out. At safe distances it changes nothing.

Until this is solved the perimeter is sound on ordinary strokes and unreliable on
heavy fill-in ones. Do not widen `repairTolFor` to chase it.

<a id="f19"></a>
### F19 — CLOSED. The pre-cull dropped real boundary, and sampling could not fix it.

Kobin's 4,962-sample width-200 stroke baked with an unfilled diagonal band ruled
across it, plus a stray mark. Two loops were left OPEN with ~4,240-unit gaps;
their two bridge lines run nearly parallel and the strip between them cancels to
unfilled, which is what the band was.

The pre-cull was dropping **16 pieces of real boundary**. It probed each piece at
a fixed number of points per pen radius, so a 200-wide pen was probed only every
12.5 units and a shorter exposed span fell between two probes. No spacing fixes
this in principle — whatever it is, a span shorter than it can hide.

Replaced with a bound instead of samples: a piece lies wholly inside if its
BOUNDING BOX does, and the box does whenever its centre is buried by more than
half the box diagonal. One distance query, no sampling, and it can only ever be
too cautious — a piece it keeps just goes on to be classified exactly. It is also
cheaper than the eight-plus probes it replaces.

Proof it is sound now: on that stroke `kept` is **6,480 with the cull on and
6,480 with it off** (it was 6,464 before), at 1x, 13x and 100x, and the cull is
still worth 3.4x.

One junction then remained unweldable at zoom 1, 13.5 units apart against an
r/8 = 12.5 limit. `repairTolFor` is now r/6; r/4 was tried and welds nothing
further, so the extra reach buys nothing and only risks joining junctions that
are genuinely distinct.

**Not a defect:** the angular dark holes in that stroke are REAL. Toggling the
lab's new "show original stroke" button puts Chrome's own rendering underneath,
and every hole is in the same place with the same outline — the pen genuinely
left those gaps. 154 mismatched pixels of 106,072.

<a id="f18"></a>
### F18 — CLOSED. Fabricated edges on any stroke with a hairpin.

Kobin's own strokes, at width 90. The batch path left loops OPEN — measured 649-
and 654-unit gaps on a 278-sample scrawl — and the renderer joins a loose end to
its start with a straight line, so the drawing had long edges ruled clean across
it. Three causes, all now fixed:

**1. Neighbouring cubics were not clipped against each other.** The cut step
skipped any pair whose generating cubics were adjacent, assuming consecutive
offsets only ever MEET. That holds while the centerline turns gently and fails
exactly where it does not: where the pen doubles back tighter than its own
radius, the two inner offsets genuinely cross, and that crossing IS the point at
which the inside of the hairpin gets trimmed. Skipping it leaves burial flipping
across a chain junction with no cut to carry it, and an end is stranded.

Isolated by elimination on the captured stroke — finer fitting (`fitRefine 64`),
no pre-cull, and a sharper oracle all left both loops open; clipping neighbours
closed both, and dropped the unbalanced-vertex count 86 -> 60 with the worst weld
falling 4.28 -> 1.65 units. Raising the weld distance also closed them, which is
what told us it was the wrong lever: the crossing genuinely exists.

**2. Hairline strips survived as spurs.** Where two boundary curves run closer
together than the burial test can resolve, BOTH survive, and the result is a
path that goes out and comes straight back. Measured at high zoom: 29 pieces,
12.4 units of path, enclosing 0.18 — a mean width of 0.03 against a resolution of
0.10. One stroke carried 18 of these beside its 2 real loops, another 34 beside
1. `dropHairlines` removes loops whose mean width (2·area / perimeter) is under
that resolution. They paint nothing — a doubled-back strip's winding cancels — so
no pixel changes; it only stops junk being stored, tiled and erased against, and
stops it appearing as a spike once you zoom past the scale it lives at.

**3. The same filter removes the dots.** The parity weld pairs loose ends by
distance and will happily join a short piece's own two ends, collapsing it to a
closed loop of zero extent (109 of 228 loops on one stroke). Blocking that weld
was tried and is WRONG — those welds are load-bearing, and refusing them took one
stroke from 2 open chains to 7. Let the weld happen and drop the result.

Pinned by `bakeStrategies.test.js` BS-6, which replays the captured stroke at
1x, 30x, 630x and 3310x and requires one closed loop with no dots at every one.
The zoom sweep matters: this family got WORSE the further in you re-baked,
because the tolerances that tighten with zoom are not the ones that set the scale
of the defect.

Cost: clipping neighbours roughly triples the crossings found (98 -> 570 on that
stroke) and pen-up went ~150 -> ~246 ms for it.

<a id="f17"></a>
### F17 — B is badly wrong on real strokes (A and C are not)

Not "extra small loops" — that was measured on synthetic cases and understated
it. On a 278-sample stroke captured from Kobin's browser, **B got 91 % of pixels
wrong** (35,958 of 39,623) with 228 loops, 109 of them zero-extent dots. A and C
on the *identical* input: 1.2 % wrong, 5 loops. A second stroke showed the same
pattern.

B also still doubles a piece back on itself on the gentle curve (180° junction)
now that neighbouring cubics are clipped — inside an otherwise legitimate loop,
so `dropHairlines` cannot reach it. `BS-2` asserts A and C under 1° and lets B
past, deliberately.

B's incremental classify is the suspect: it judges burial from a span's midpoint
while drawing, before the cuts that would split that span exist, and dropping is
permanent. `_allBuried` samples across the span to make that conservative, but
evidently not conservatively enough once the cut set grows.

**Kobin is choosing A.** B's numbers should not be used for comparison until this
closes.

<a id="f13"></a>
### F13 — CLOSED. Burial was excluding by cubic index instead of arc length.

Kobin drew a ring and it baked into a dozen disconnected slivers. That was the real
reproduction — the scribble was the same bug, not a density-specific one.

A boundary piece sits at distance exactly r from its own generator and, because the path is
CONTINUOUS, within r of everything for a little way along the path in both directions. That
nearness is not overlap. The old rule excluded "the generating cubic plus one either side",
which is only equivalent when samples are spaced wider than the pen. A hand-drawn stroke
samples every few units against a 90-unit pen, so the window was ~40x too narrow, every rail
read as buried, and the perimeter dissolved.

Burial now excludes an ARC-LENGTH window of one pen radius either side (`arcPadFor`), which
is the right invariant: within r of arc length the path has not had room to come back on
itself.

A second error came out with it: the oracle's flattened chords lie inside the true curve by
up to `oracleTol` (r/64), which is ~35x the burial margin, so a rail read as buried by its
own neighbourhood. `buried()` now subtracts that known error, making burial conservative.

Verified in Chrome against Chrome's own stroke, raster-diffed:

| preset | pen-up | worst edge error | mismatched px |
|---|---|---|---|
| pen line (401) | 5.2 ms | **0.00 px** | 46 / 5,205 |
| tight wiggle (25) | 1.0 ms | **0.00 px** | 81 / 20,400 |
| hand-drawn ring (521) | 8.6 ms | **0.00 px** | 89 / 53,150 |
| the scribble (3,775) | 118.8 ms | **0.00 px** | 16 / 121,265 |

The residual counts are boundary antialiasing. The scribble was 107,414 wrong before.

The original description follows.

### F13 (original) — the extreme scribble bakes wrong

Measured in Chrome via `/#/bakelab`, raster-diffed against Chrome's own stroke:

| preset | pen-up | worst edge error | mismatched px |
|---|---|---|---|
| pen line (401 pts) | 9.3 ms | **0.00 px** | 46 / 5,205 |
| self-crossing (6 pts) | 1.6 ms | **0.00 px** | 212 / 56,902 |
| tight wiggle (25 pts) | 3.5 ms | **0.00 px** | 81 / 20,400 |
| **the scribble (3,775 pts)** | 399.9 ms | **277 px** | **107,414 / 121,265** |

The first three are exact (the residual is boundary antialiasing). The scribble is not: the
baked fill covers about 11 % of the ink and comes out as 214 pieces in **150 loops**, one
per row, where a serpentine with rows 3.1 apart and r = 45 is a single solid blob whose
perimeter should be one loop.

So the interior IS being buried — the per-row slivers are what survive — but the blob's
outer boundary is not being assembled. Since `cut` is 336 ms of the 400 and `classify` only
25, the suspect is the stitcher failing to chain across pieces that were cut, not the
classification.

This is NOT caused by the pre-culls (F14): it reproduces with both off. Note the unit tests
do not catch it — the densest membership case is rows 25 apart at r = 35, and this is rows
3.1 apart at r = 45. **A membership case at that density is the first thing to write.**

<a id="f14"></a>
### F14 — piece-level pre-cull is BACK ON; centerline one still off

Once F13 was fixed the piece-level pre-cull turned out to be sound after all — it was
reading a broken oracle, not sampling too coarsely. Re-enabled: **scribble 332.7 -> 118.8 ms,
ring 21 -> 8.6 ms, output identical in both cases** (same piece count, same loop count, same
0.00 px error).

The centerline pre-cull (`opts.centerlineCull`) is still off. It was worth another 3.5x and
should be retried now that the oracle is right, but it probes where a cubic's rails *will*
be rather than the fitted offset itself, so it needs its own verification pass.

The original description follows.

### F14 (original) — both pre-culls are unsound

Two culls were built, measured, and turned off. Both are correct in principle and wrong at
the sampling density that makes them cheap.

| | effect on the scribble in jest |
|---|---|
| piece-level pre-cull | 1,493 ms -> 369 ms (cut step 1,172 -> 9 ms) |
| centerline pre-cull | 369 ms -> 106 ms (offset 206 -> 10 ms) |

The centerline one probes where a cubic's rails *will* be (`c(t) +/- r * perp(tangent)`) and
skips offsetting cubics whose rails are entirely buried. A rail that pokes out between two
probes is missed. Caught in the browser: 89 % of the ink missing while every unit test
stayed green, because the tests run at a finer tolerance where nothing gets culled.

Both are behind flags (`opts.precull`, `opts.centerlineCull`). To turn either back on, the
probe spacing has to be tied to the smallest gap the ink can have rather than to the piece's
own length — and F13's membership case has to exist first, or there is no oracle that would
notice the damage.

<a id="f15"></a>
### F15 — dense AND self-crossing strokes leave open chains (BLOCKER)

Kobin drew a stroke; it baked with huge solid wedges bounded by long straight edges. The
edges were fabricated: canvas `closePath()` draws a line from a chain's dead end back to its
start, so every unclosed chain painted an invented span across the shape.

**Now reproduced in `bakeStrategies.test.js` BS-1 as "dense self-crossing"** — 380 samples,
width 90, a figure-eight. A and C score 64 wrong of 2,030. Every earlier case had density OR
self-crossing, never both, which is why the suite stayed green while the browser did not.

Measured: 834 chain pieces -> 646 kept -> **9 loops, 7 of them open**, gaps of 5 to 152
units. So classification keeps a sub-piece whose partner across the crossing was dropped,
and the walk dead-ends at that vertex.

Dropping the open chains is NOT the fix — it measured far worse (0 -> 1,172 wrong on the
self-crossing case), so they carry real boundary.

The likely cure is a deterministic planar-face pairing: at each vertex, sort all edge-ends
by angle and pair each incoming edge with the next outgoing edge in clockwise order. That
pairing is independent of traversal order, so every walk closes by construction. The current
walk picks the most counter-clockwise UNUSED departure, so an earlier loop can consume the
piece a later one needed.

Fixed on the way here, all real:
* the lab silently dropped whole strokes — `getCoalescedEvents()` can return an empty array
  and the loop over it then added nothing (only the first sample survived);
* the stitcher now snaps endpoints into a shared vertex set before walking, instead of
  matching "near my end" on coordinates computed from two different curves;
* crossings are cut on BOTH sides from one computation — `cubicIntersections(p,q)` and
  `(q,p)` subdivide differently and disagreed about how many crossings exist;
* intersection clusters merge by POSITION, not parameter: near-tangent offsets produced
  1,710 cuts from 206 pair tests, now 64.

<a id="f10"></a>
### F10 — B disagrees with A on a self-crossing stroke (BLOCKER)

`bakeStrategies.test.js` BS-1, case "self-crossing": **698 of 2,029 probe points**
classified differently from A, which is correct there (0 wrong). A and C agree exactly.

B is the incremental schedule, so the suspect is its step 3 — re-cutting live pieces
against ink that arrived later. On a stroke that crosses itself, a piece can be buried by
ink laid down much later and far away in path order, which is precisely the case the
adjacency skip must not swallow. Piece counts are close (B 146, A 149), so this is
mis-trimming, not a missing chunk.

<a id="f11"></a>
### F11 — CLOSED. The crumb cull was unsound.

A and C reported a 170 degree kink and 18 wrong points where B was perfect. The cause was
not the cut rule: **the crumb culled one genuine boundary piece of 133**, breaking the chain
into two loops which were then force-closed. The crumb records "some capsule covers this
cell entirely" and cannot express path adjacency, so a piece gets culled by the ink that
joins it smoothly.

The cull is now off by default and replaced by a pre-cull that uses the distance oracle,
which *can* express adjacency (`lo`/`hi` exclude a piece's own generator and its
neighbours). A, B and C now score 0 wrong on gentle curve, tight wiggle and dense overlap,
and the tight wiggle's worst junction fell to 0.000 degrees.

The original description follows.

### F11 (original) — A and C cut a corner into a tight wiggle that has none

Same suite, case "tight wiggle": A and C report a **170° kink and 18 wrong points**; B
reports **0° and 0 wrong**. On that stroke B is right and A is wrong.

A 170° junction means the resolve cut a piece where the boundary does not actually cross.
Suspects, in order: the cut step accepting a near-tangency cluster from
`cubicIntersections` as a real crossing; the burial margin (`fitTol`) being too coarse
where the two offsets pass close; the `gap <= 1` adjacency rule being too narrow when one
centerline cubic produces several offset pieces, so pieces that are effectively adjacent
still get clipped against each other.

Note this is the *good* kind of failure: the three schedules cross-check each other, which
is exactly why BS-1 compares them rather than testing each alone.

<a id="f12"></a>
### F12 — no visual harness, and no timings on a real-sized stroke

BS-3's numbers are on a 25-sample toy (A: draw 0.1 ms / finish 9.6 ms · B: draw 9.1 ms /
finish 0.9 ms · C: draw 1 ms / finish 6.3 ms). The shape of the answer is already visible —
A and C pay at pen-up, B pays while drawing, C's per-point cost is ~9x lower than B's — but
these are far too small to rank the schedules. Still to do: the `/bakelab` harness (draw,
pick a schedule, watch the colour flip on bake, raster-diff against Chrome's own stroke)
and a run on Kobin's 3,769-point drawing.

---

<a id="f1"></a>
### F1 — `strokeShape` chords the centerline (SUPERSEDED)

**Resolved by replacement, not by fixing `strokeShape`.** `curvePerimeter.js` resolves the
perimeter out of `curveOutline`'s offset cubics, so every emitted piece is a sub-interval of
a curve that was already smooth. Measured on a stroke with no corners in it
(`curvePerimeter.test.js` CP-2):

| | worst junction |
|---|---|
| `curvePerimeter` (curves) | **0.000°** |
| `strokeShape` (polyline), flatten 0.25 | 4.06° |
| `strokeShape`, flatten 0.0156 | 1.05° |
| `strokeShape`, flatten 0.00098 | 0.27° |

The second table is the point of the whole exercise: the polyline core's crease shrinks only
as √tolerance and never reaches zero, while the curve core is exactly zero at any tolerance.

`strokeShape.js` is still in the tree and still green; nothing should be built on it.

The original description follows, since the reasoning is what justifies the replacement.

`strokeShape.js` flattens the centerline to a polyline and takes the Minkowski sum with a
disc. That is exact *for the polyline*, but the polyline is not the stroke, and the result
creases on the inside of every bend where two offset lines meet.

The crease angle is `≈ sqrt(8·tol / R)` for centerline radius of curvature `R`, and **it
does not shrink with zoom** — an angle is scale-invariant. Measured: a tight bend
(R = 250) flattened at 0.25 units creases at **5.1°**, identically at 1×, 30× and 900×.
Crossing a level does not wash it out; chopping the stored shape into child tiles carries
the crease along unchanged.

This violates Kobin's rule (2026-08-13): *the perimeter must avoid corners; a straight
line is only allowed when the part being baked genuinely is straight.*

The outer side of a bend is fine — line → arc → line meet tangentially. Only concave
joins crease.

**Fix:** resolve `curveOutline`'s offset cubics into a perimeter instead of resolving
line/arc pieces from a chorded centerline. See `docs/perimeter-bake-options.md`.

<a id="f2"></a>
### F2 — CLOSED. Real Chrome numbers on the curve core.

All three produce the SAME shape now (0 wrong of ~2,050 probes on seven cases,
0 disagreement, every loop closed), so the schedules can finally be compared on
cost alone. Chrome, `/#/bakelab`, width 90, at zoom 1:

| stroke | | A batch | B incremental | C crumb+bake |
|---|---|---|---|---|
| scrawl, 420 pts | while drawing | 0.4 ms | **514.8 ms** | 19.6 ms |
| | at pen-up | 146.9 ms | **11.1 ms** | 108.8 ms |
| ring, 521 pts | while drawing | 0.8 ms | 208.1 ms | 20.4 ms |
| | at pen-up | 103 ms | 32 ms | 76.9 ms |
| scribble, 3,775 pts | at pen-up | 1,901 ms | — | — |

The shape of the answer is what the analysis predicted. B is the only schedule
whose pen-up is free, and it pays about 1.2 ms per sample to get there, which is
inside a pen's frame budget but not by much. C's draw cost is ~25x lower than B's
and it still pays most of A's bill at pen-up, because the oracle it pre-builds is
only ~10 % of the work.

One correction to C's premise: **the crumb it maintains is not used.** The cull
that consumed it is off (F11), so C's occupancy grid is pure overhead on every
sample. C is really "pre-build the distance oracle", and should be renamed or
have the crumb removed before the numbers are used to choose.

The original description follows.

### F2 (original) — the A/B/C cost numbers are void (BLOCKER)

Every measured cost for batch / incremental / crumb+bake was taken against the polyline
core, which F1 disqualifies. The *scheduling* question (when the work happens) is
untouched and still open; the numbers are not. They must be re-measured on the curve core.

Expect them to improve: `strokeShape`'s cost was piece-count × local crowding, and cap
circles alone were **437 ms of 479**. A run-based curve offset has few, long pieces and
almost no cap circles. What gets harder is curve-vs-curve intersection.

<a id="f3"></a>
### F3 — polyline input contract

`strokeShape` documents a polyline input, but Two.js paints a Catmull-Rom-like cubic
spline through the samples (tension 0.33, `two.js/src/utils/curves.js` → `getControlPoints`).
Feeding raw samples bakes a different shape from the one on screen — the defect
`docs/outline-fidelity-report.md` records as ~1,900 px of solid mismatch. Pinned by
`strokeShape.test.js` SS-7. Same root cause as F1; closes with it.

Measured on a 7-sample curve, 60 wide: 7 → 987 points at display fidelity; max departure
of the spline from its own chords **3.83 units**; worst edge displacement 3.77 units;
difference in AREA only **0.24 %**. That last number is the trap — any area-based test
waves this through. It is the edge position that is wrong.

<a id="f4"></a>
### F4 — PR-4 currently blesses the frozen corner

`precision.slow.test.js` PR-4 was rewritten to measure the depth-independent corner angle
(0.36°) and treat it as the accepted residual. Under F1 that is no longer the intended
behaviour. Revisit the test when F1 closes — it should assert smoothness, not measure a
tolerated crease.

<a id="f5"></a>
### F5 — the eraser has never passed a test by Kobin

Every pass so far has failed in real use. The cede refactor is merged and green
(966 tests) but its correctness in real use is **unestablished** — green tests are not
evidence here. Do not describe the eraser as working.

Related, from memory: the 2026-07-28 "deep cuts" attempt was reverted by Kobin as worse
despite a green suite. Get his acceptance criteria before claiming an improvement.

<a id="f6"></a>
### F6 — 9 pre-existing `fidelity.compare` failures

Recorded in memory as present at HEAD before this work started. Not re-verified this
session. Confirm the count before attributing any failure to new work.

<a id="f7"></a>
### F7 — `strokeShape` is wired to nothing

Nothing imports it. Wiring needs: fill natives carrying `loops`; the renderer drawing arcs
as cubics; `persist` round-tripping; the erase **difference** (a second algorithm, not
plumbing); severance/connectivity. Expected, not a defect — but do not describe the work
as integrated.

<a id="f8"></a>
### F8 — no real-Chrome numbers

Every figure for `strokeShape` is from jest. An attempt to measure in Chrome failed: port
3000 was down and CRA never finished compiling within the timeout. A temporary dev export
in `useKobinEngine.js` was added and then reverted (0 refs remain). Real-browser numbers
on Kobin's actual drawing are still outstanding.

<a id="f9"></a>
### F9 — `_bakeOne` granularity

`_bakeTick` defers one object per 80 ms slice — *between* objects, never inside one. One
object's bake was 4,469 ms of flattening plus a Clipper call, with no yield point inside
it. That is the freeze Kobin hit. Worth fixing independently of how fast the bake gets:
even at today's speeds, slicing the flatten would have turned the freeze into a stutter.


<a id="f21"></a>
### F21 — the arc pipeline (2026-08-14)

`geometry/biarc.js` + `geometry/arcPerimeter.js`, driven from `/#/arcpen` (the pen)
and `/#/arcbake` (the resolve). Kobin signed off on the pen at tolerance 0.25.

**What it is.** The centerline becomes two circular arcs per sample gap instead of
one cubic, using the same samples and the same tangents the cardinal spline has, so
it passes through every sample and leaves it in the same direction. A gap that
cannot follow the old curve within 0.25 units is halved. On real strokes that costs
2.00–2.09 arcs per gap.

**Why it matters.** The offset of an arc is a concentric arc. So:

* both edges are EXACT — no `fitTol`, no Tiller-Hanson, no subdivision-to-fit;
* consecutive offsets share an endpoint computed once per vertex, so the rail is
  watertight by construction and there are no round joins to build;
* crossings are circle-circle — one square root, no Newton polish, and no chance of
  one crossing being found twice at two slightly different places (F15's defect);
* cutting an arc at a crossing is arithmetic on the angle, so both halves share the
  crossing POINT rather than two roundings of it.

**Measured, Chrome, best of three, same thread, against schedule A on cubics:**

| stroke | arcs | cubics | speedup | open chains | unbalanced |
|---|---|---|---|---|---|
| captured stroke, 4,962 pts | 120.8 ms, 50 loops, 2,195 pieces | 456.5 ms, 50 loops, 3,923 pieces | 3.78x | 0 | 0 |
| captured fill-in, 6,791 pts (the F20 stroke) | 178.9 ms, 6 loops, 621 pieces | 587.8 ms, 19 loops, 1,066 pieces | 3.29x | 0 | 0 |

The loop counts agreeing on the first stroke is the useful corroboration — two
independent pipelines would not agree on 50 if either were wrong. F16 also goes
away: the 3,775-point scribble bakes in 76 ms, against ~2 s before.

**THE LESSON, and it is the one to carry.** The last approximation left was the
burial oracle, which flattened the centerline into a polyline. That single
tolerance was the binding constraint on the whole result:

    oracle at r/512   -> 122 open chains
    oracle at r/4096  ->  25 open chains
    oracle at r/32768 ->   0 open chains

The mechanism: every point of an offset piece is at distance exactly r from its own
generator, so an exposed piece reads exactly r and a buried one dips below. A
fragment between two crossings that are close together dips only a little, so with a
coarse oracle every shallow sliver reads as exposed, survives, and leaves a junction
with one more way in than out. Tuning the tolerance was the wrong move; point-to-arc
distance is closed form, so the oracle is now exact and the tolerance is gone. Do not
reintroduce a flattened oracle here.

**Not yet done.** Only schedule A exists on arcs; B and C do not. Nothing is wired
into the real engine — `Renderer` still consumes cubics, and `arcToCubics` is the
conversion for that (a RENDERING conversion; the arc stays the geometric truth).
Erase, cede and the tile pipeline have not been looked at.

**Float32 trap, already hit once.** A gap that is collinear to about 1e-8 — which is
what the spline's degenerate END handles produce — used to yield a real arc of radius
8e8 with a centre 1.7e9 units away. Correct in doubles, bowing 2e-8 of a unit, and
unrenderable: canvas and SVG rasterise in float32, whose quantum at 1.7e9 is 199
UNITS, so the renderer placed the arc's start hundreds of units from its own endpoint
and joined them with a line — a large visible spur at each end of a straight stroke.
`arcThrough` now classifies by sagitta, and `tracePath`/`arcPath`/`traceLoops` take a
flatness tolerance from the caller (which knows the zoom). Anything else that hands
arcs to a float32 rasteriser needs the same guard.

<a id="f22"></a>
### F22 — the arc pipeline IS the pipeline now (2026-08-14)

Kobin's instruction: make the biarc pen the standard pen, bake asynchronously at
pen-up in chunks small enough not to disturb drawing or zooming, and rebuild the
eraser on top of it. This is what that came to.

**The object model.** A native is a `stroke` only between pointer-down and the
moment its perimeter resolves — one frame, usually. After that it is a `shape`:
`loops`, closed chains of arcs and lines, plus `w`, the pen that drew it. `pts`
and `lwFrame` are DELETED. That was Kobin's call on 2026-08-13 — "you can
pre-bake all the shapes though, no need to store the original centerline" — and
it is what makes the shape the single source of truth rather than a cache that
has to be kept in agreement with something else.

`fill` survives as a NATIVE type only for drawings saved before this, and only
until something cuts one: `Document.fillToShapeById` promotes it at that moment.
Converting at LOAD was tried and reverted — one recorded drawing carries a
1.8-million-vertex fill, and turning that into arc pieces cost more than the
whole rest of the load put together. `fill` remains the ordinary type for TILE
PIECES, which are polygons by design — **NO LONGER TRUE as of 2026-08-19**: the magnify chain carries exact arcs and freezes nothing that is stored (bible section 10.4).

**What you watch appear IS the biarc chain.** `BiarcPen` runs in `pointerMove` at
O(1) a sample, and `Renderer.setLiveArcs` lays it into the live path — splicing
off only the last two gaps, which are the only ones a new sample can disturb. A
stroke that has been drawn but not yet resolved still draws from that chain
(`Renderer._buildInto`), so pen-up changes nothing on screen. Measured in Chrome:
swapping the raw chain for the resolved shape moves **233 pixels of 921,600**,
all of them antialiasing on the edge.

**The bake is a job with a cursor in it.** `ArcBakeJob.step(ms)` does bounded
work across all eight phases and publishes nothing until it is finished; the
engine steps it in 8 ms slices off the same timer the erase bakes use. Slicing is
bit-identical to running it in one go (pinned by `arcPerimeter.test.js`). This is
F9's freeze answered properly — deferring between OBJECTS was never enough, since
one heavy stroke was a single indivisible job.

Measured in Chrome, worst SLICE against the 8 ms it was asked for:

| stroke | draw, per sample | slices | worst slice | bake total |
|---|---|---|---|---|
| 400 samples, w 20 | 0.073 ms | 5 | **8.6 ms** | 38 ms |
| 1,500 samples, w 40 | 0.061 ms | 12 | **8.5 ms** | 93 ms |
| 3,000 samples, w 60 | 0.045 ms | 20 | **8.2 ms** | 157 ms |

Getting there took four goes, and the lesson is the same each time: **a chunk is
only as small as its slowest ITEM, and "item" has to mean the same thing as the
work.** A fixed 64 gave a 53.9 ms slice. Making the count adaptive was not enough
on its own — per-item cost varies by orders inside one phase, so a chunk sized
from cheap items and then handed expensive ones still overran (33.7 ms), which is
why growth is capped at 2x a step and the count is capped at 64 outright. The
unchunked TAILS were worth as much again: building the broad-phase grid,
registering twenty thousand endpoints, and allocating one cut list per piece all
sat between two chunked loops with nowhere to yield. And the last one was a
granularity mistake — the finish phase chunked over LOOPS, and a dense scribble
resolves to two loops of three thousand pieces, so a "chunk" of two items was the
entire phase.

**Tolerance.** The centerline is built to half an arc-tolerance pixel AT THE ZOOM
IT WAS DRAWN (`arcTolerancePx * 0.5 / inScale`). Kobin approved 0.25 units in the
`/#/arcpen` sandbox; this is tighter and measured free — 2.18 arcs per gap
against 2.09, on a captured 4,962-sample stroke.

**Erase.** Both operands are resolved perimeters, so an erase is one exact
boolean (`arcShape.subtractShape`) and nothing else: no polygonization, no
flatten fidelity to pick, no lattice, at any depth. The old path had to SCALE the
eraser's flatten tolerance by the magnification, because flattening a magnified
cap at frame fidelity wanted 2e8 points and took 155 seconds for one gesture; an
arc magnifies by changing one number. The tile-cede descent keeps its shape — one
crossing at a time, cutting the tile out of the parent — but every cut in it is
exact now, so a patch's contact with its tile edge is exact too and severance
reads it without a lattice tolerance.

**Tiles.** `derive.shapeRingsInRect` clips the arcs to the tile FIRST and
flattens afterwards, local to the tile and translated back. The other order is
ruinous under magnification: a x3000 radius needs ~55x the steps for the same
sagitta, so a 2,000-piece perimeter would tessellate to ~120,000 vertices per
tile before nearly all of it was thrown away. A tile that no piece reaches is
settled by ONE winding query — that is the `solid` tier, decided exactly instead
of by the anchor-disc heuristic.

**Four defects found on the way, all worth remembering:**

1. **`cubicTangent`'s degenerate-handle fallback was noisy.** The spline's end
   anchors have coincident handles, so the derivative vanishes there and the
   tangent came from a numeric difference over h = 1e-4. At frame coordinates of
   a few thousand that is 2e-5 of displacement against a 1e-12 ulp — about 4e-8
   radians of noise, and DIFFERENT at the two ends. A straight two-point stroke
   therefore had non-collinear rails and a 4e-6-unit step in its own edge:
   invisible where it is made, multiplied by 3000 at every crossing (34 units
   three levels down). The limit direction is exactly `c2 - c0` at the start and
   `c3 - c1` at the end; it is taken from the control polygon now.

2. **The winding query's graze band was scaled off the SCENE.** An eraser
   projected three crossings down is 2.7e10 times its own size, so the pair's
   span runs to 1e13 while the object being cut is 1e4 across — and a band of
   span*1e-9 is then wider than the target. Every query grazed, every fragment
   read as outside, and an erase that should have removed the object left it
   untouched. That band is a ROUNDING distance and is measured per piece off that
   piece's own magnitude now. Relatedly, `_bakeOne` centres the boolean on the
   SUBJECT rather than on the eraser, for exactly the same reason.

3. **A stroke that ends exactly where it began was capped anyway.** A circle, a
   letter O, a box, an eraser swept round something — all of them. The two
   half-turn caps then sit on the SAME circle, and two arcs of one circle have no
   transverse crossing to find, so the pair is invisible to circle-circle however
   much they overlap. That overlap is a stretch of doubled boundary where every
   point is at distance exactly r from BOTH generators, burial is a coin flip
   there, and the resolve kept fragments whose partners it dropped: measured on a
   36-sample ring, an unclosed loop of 72 pieces, which then shredded every
   boolean it was handed (74 loops and 72 open chains out of a plain
   rect-minus-ring). A closed stroke has no ends, so it now gets no caps: the
   rails close on themselves, and the seam tangent is taken ONCE as the mean of
   the two one-sided tangents the spline reports there, so `L[0]` and `L[n]` are
   the same point rather than two points a few thousandths apart. The adjacency
   skip became per-RAIL to match — a closed stroke has two closed rails, and the
   last piece of one is not a neighbour of the first piece of the other.

4. **A stroke that doubles back onto its own start got the same cap twice.**
   The ends coincide but the tangents oppose, so it is a cusp and genuinely wants
   caps — the two DIFFERENT halves of one circle. Built from the same data they
   came out identical: half the circle drawn twice and the other half not at all,
   leaving the boundary open by exactly that half. Measured: a 104-unit
   fabricated edge across a 200-unit stroke.

Both are pinned by `arcPerimeter.test.js`, which had no closed-stroke case at all
before this — the gap that let both through.

**Hairlines are dropped, as they were on the cubic path (F18.2).** A loop whose
MEAN WIDTH (2·area/perimeter) is negligible is a strip whose two sides are the
same curve traversed both ways. It paints nothing — the winding cancels — and
exists only to be stored, tiled, erased against, and counted as its own connected
component, which is how a ring cut once came apart into two objects. The bake
measures it against the PEN (`r·1e-3`), because it knows what made the shape; the
boolean measures it against the ROUNDING scale, because it does not, and a
perfectly legitimate hole can be a billionth of the object it is cut in.

**Aliasing at tile edges — measured, not assumed.** Rasterising the app's own SVG
in the browser with a vertical AND a horizontal tile seam on screen, inside solid
ink: the worst interior lift across **1,960 sampled rows and columns is 0**.
Every piece of one object still merges into a single path (`_buildPieces`), so
subpaths accumulate coverage before anything composites and there is no seam to
cover.

**Moves, verified live as well as in tests.** A lasso over two objects — one of
which has a re-homed child three thousand times finer — drags all three by the
same screen distance, each expressed in its own frame. `Document.moveById`
REPLACES a shape's loops rather than shifting coordinates in place, because
consecutive pieces share their endpoint arrays; mutating them would move every
shared point twice and tear the shape along its own seams.

**A cut edge holds its fidelity at every depth — the F4 gap, measured.** PR-4
takes the shape as it arrives a level `k` crossings away, clips it to one screen
exactly as `shapeRingsInRect` does, and measures the flatten error as the sagitta
of each sub-arc, `r(1 − cos(θ/2n))` — exact, and one pass:

| depth | chords on screen | arc edge | the same cut, frozen as a polygon |
|---|---|---|---|
| k = −1 | 172 | 0.119 px | 0 px |
| k = 0 | 981 | 0.125 px | 0.1 px |
| k = 1 | 42 | 0.122 px | **375 px** |
| k = 2 | 4 | 0.062 px | **1.1e6 px** |
| k = 3 | 4 | 0.000 px | **3.4e9 px** |

The budget is 0.125 px. The chord count FALLS with depth, which is the economy of
the whole thing: a magnified curve is flatter across a fixed window, so the
deeper you go the less there is to say about the piece you can actually see.

**The measurement itself was the last defect, and it hid behind a green bar.**
PR-4 originally found the error by flattening 200x finer and scanning for the
nearest segment. That is quadratic in the chord count, and `arcSteps` caps at
4,096 steps per arc, so at k = 3 BOTH flattens pin to the cap: the comparison
converges on itself and reports agreement where there is shared error — and it
does not terminate. **62 of 63 suites reported PASS and jest then hung for three
hours** on the 63rd, burning a core, with no failure to show for it. A suite that
cannot finish is not a suite that passes; check for the summary line, not for the
absence of FAIL. The analytic form runs in 4 s. In the same pass, the legacy
`strokeShape` perf pin turned out to be timing JIT warm-up as if it were work
(210 ms for a 45-point call that costs 4 ms warm), which sank its quadratic-cost
ratio below the point ratio on an IDLE machine — it warms up and takes the best
of three now.

**Superseded by this.** F1/F3 (`strokeShape` chords the centerline) — nothing
chords a centerline any more. `geometry/strokeShape.js`, `geometry/curvePerimeter.js`
and `geometry/bakeStrategies.js` are dead as production code and kept only as the
independent oracle the arc tests compare against. `geometry/cede.js`'s float
guillotine is unused: subtracting a rect from a resolved perimeter is the same
closed-form boolean as everything else.

**Not done.** Threading is still deliberately deferred — the work is small enough
now that a worker buys little, and `docs/perimeter-bake-options.md` section 4
explains why asynchrony against a mutable document is the real cost either way.
Schedules B and C do not exist on arcs and are not needed: the pen maintains the
chain incrementally already, which was the only part of B worth having.

---

### F66 — FIXED 2026-09-08. An eraser over a MOVED object, made in a neighbouring frame at the object's own depth, cut nothing; and a hairline eraser's slivers were culled as dust.

Kobin's reports `19-53-03`, `19-53-14` and `19-54-14` (2026-09-08): he dragged a family of
ceded kids homed in `0/19,8`, then erased over their picture from `0/20,8` at 222×; each mark
considered 70 objects, cut none, was refused on the level-0 object under it ("tile holds
none of its ink", a correct refusal: its picture is not in that square) and was consumed.
Replayed in jsdom (`erase.report.probe.js`, the snapshot plus the journal note): the
eraser's box mapped into the kids' stored coordinates landed two displacements away —
`mapPointObj`/`projectLoopsObj` chose "home to picture" or "picture to home" by DEPTH, and
an eraser made in a sibling frame at the home's own depth took the wrong branch. The home
is named by id now (every caller knew it), `erase.moved.test.js`. Replayed after the fix:
the mark cuts the kid under it, 2.61 of 10.20 units of area, exactly what it swept.

The third report: a 4 px eraser at 561,917× is a hairline 1/55 of the width of a stroke
drawn at 1×; scribbled over it, it carves the stroke into 106 slivers (faithful: 306
crossings, the removed area the hairline's own), and the dust rule then culled the slivers
thinner than a hundredth of the PEN — ink the eraser had shaped. Kobin's rule, after a
first fix (the finer of pen and eraser) still lost ink for him: "the only dust that should
disappear should be stuff that's basically invisible at the current zoom when the eraser
mark is drawn." So dust is a fragment narrower than a quarter of a pixel at the mark's own
zoom (`bakePx`), carried into the subject's units through the frame factor
(`eraseJob.dustBarFor`; `dropDust`'s third argument overrides the pen rule; a rect cut
keeps the pen rule). Replayed: 155 regions, 6.286 of 10.203 left — nothing culled but
wafers under a quarter pixel; RR-2's 0.2-unit wafer at 1× is still dust. What remains by
design: a hairline scribble leaves a comb of slivers, each its own object after the
resplit.

### F67 — FIXED 2026-09-08. A descent baked in the worker took the whole object with it: its kids were homed in a frame only the worker's lattice copy had minted.

Kobin, an hour after E7 went live in his tab: "an eraser baked and took the whole object
being erased with it" (report `20-48-33`). He had moved a 0.3-unit dot at level 0 by two
thirds of a cell, then erased over it from `0/20,8` with a 4 px scribble. The descent was
right: the dot lies inside one cell, so all of it cedes down, 353 slivers, nothing left at
level 0 — and the kids are homed a cell over, in `0/21,8`, with the remainder in their
offset table (offsets.js: the carry), drawn back into `0/20,8` by the store's reroute.
Replayed in jsdom on the snapshot with the dot put back: 284 kids, every one painted from
the camera's frame. In Chrome none were, and the report says why: the lattice has 28
frames and `0/21,8` is not one of them, while the natives have 353 objects under that key.
The descent mints frames as it walks neighbours; the in-place descent minted them in the
live lattice, the worker's descent in the copy it was handed, and `_applyDescent` added
the kids under a frame id the engine's lattice could not resolve — no depth, no frame
factor, never drawn, never found by an eraser or a pick again. The autosave then wrote
them that way.

Fixed: the job returns the frames it minted (`minted`, in `serialize()`'s shape) and
`_applyDescent` merges them into the engine's lattice before a kid is added
(`LevelMap.merge`: parents first, a known frame left alone unless it was a root that
gained a parent). A load mints any frame its natives name (`LevelMap.ensureId`, from the
id's chain; `files._mintNamedFrames` after `lm.load` in `loadSnapshot` and
`loadDrawing`), which repairs his saved document: loaded in jsdom, `0/21,8` is minted and
all 353 kids paint at the report's camera. `erase.worker.test.js`: the transport case
(the kids' frame absent before, present and painted after) and the load case. Rendering
kids whose picture lies outside their home's window was measured on the way and is fine:
the store's reroute reads the neighbour's tile at the shifted window.

### F68 — FIXED 2026-09-08. With a moved object selected, zooming out until it was too small to see made the indicator jump.

Kobin, report `21-23-56`, after moving everything on the canvas together: "the object
that is still there jumps when I zoom out, but not till it is very small and actually
invisible — I could only tell because I had it selected." The indicator shows what is
drawn: ants along the render list's pieces, shifted by each piece's residual. Once the
selected content is under 2 px on screen the frame becomes one dot, and that dot was
placed from the frame's union box of STORED bits through `mapRectF` — the offset table
ignored. His kids carry a table (F67's family, then the move-all: 2.6 level-0 units of
remainder), so the dot sat 2.6 units from the ink; the same fallback in `_selectionRect`
returned the stored box. Fixed: `_selTable` keeps one box per displacement table and
`_selFrameRect` maps each through `mapRectObj` (a translation keeps a box a box, so
members sharing a table cost one call); `_selectionRect`'s fallback is `_rectInActive`.
`selection.indicator.test.js`: a moved stroke's mark is read back from its path and sits
on the ink; kids of a moved object seen from the level above, culled from the list, are
marked where they are drawn.

The same report's other complaint, "a bunch of the smaller eraser-cut objects have
disappeared" after the move-all, did not reproduce: replayed in jsdom on the snapshot,
every one of the 1,520 objects paints where its table says, at levels 1 and 2, and the
report's own render count (1,122) is the replay's to the object. What cannot be seen at
level 1 is size: the pieces cut at level 2 are under a thousandth of a level-1 unit
across, culled by the store below 0.15 px at the level's deepest zoom, and visible again
at level 2. The lineage he cut sits half a level-0 unit left of the untouched kids, where
he had dragged it. Explained the same night by F69: a lasso around them selected nothing,
so he took them for gone.

### F69 — FIXED 2026-09-08. A lasso around moved objects or ceded kids selected nothing.

Kobin: "even tiny invisible objects should appear when I do a lasso around their general
vicinity, and since they did not, I assumed they were gone." Measured in his tab at the
end of the redo chain: a loop round the whole screen over 352 visible kids found 0; over
62 moved level-0 pieces, 0. `_lassoFind` asks each frame's spatial index for the loop's
box, and the index holds an object at its STORED bits; a displacement table draws it
elsewhere (F41/F55), so the query never returned it and the per-object test that knows
about the table was never reached. Fixed: after the frame walk, every object with a
table that the active frame can reach is judged where its picture is
(`_rectInActive`, then the ink test); an enclosed frame's "take all" skips such objects
and leaves them to that pass. `select.lasso.test.js`: a stroke dragged across the screen
is found at its new place and not its old one; kids ceded from a moved object, too
small to see, are found by a loop round them.

### F70 — FIXED 2026-09-08. After a reload, a redo brought a piece back with a table from later in its history.

Kobin's screenshot after one redo of the first erase: a small mark off to the side of the
scribble. The piece (337) had been cut out of a stroke, moved twice, then cut again; the
redo of the first cut put it back carrying the table its moves gave it, 21 units from
where it belonged. In a live session the ops and the document share object identity, so
the undo of a move resets the very object every later record holds. The op log's replay
decoded each record on its own: the first cut's record and the second cut's `removed`
were two objects with one id. Undoing the moves reset only the copy in the document;
the other kept the table and came back on redo. And the redo of the second cut removed
the document's copy while its op kept the other, so the next undo would have put back
the wrong one. Fixed: replay keeps one object per id across every record, a later
record's state winning (the state a consumed object must come back in), and a redo's
record is refreshed to the object it actually removed. `oplog.test.js`: a piece cut,
moved and cut again survives a reload with one identity and an undo history that matches
the live engine step for step.

### F71 — FIXED 2026-09-08. A redo of a move or an add wiped the store's log.

Found reading the store during F70: the canvas had three fresh snapshots and no log
entries at all, so its undo history would not have survived another reload. The log
resets on an undo or redo of an op with no seq — meant for an op from before the log, a
clear. `Document.undo` pushes `_invert(op)`, which for a move or an add is a new object
without the seq, so every redo of one read as pre-log and the saver reset the log.
Fixed: the inverse carries the seq (`_carrySeq`). `oplog.test.js`: a redo of a move is
logged as a redo, and the tick is not a full write.

### F72 — FIXED 2026-09-08. An eraser made in an object's own frame over its moved picture cut nothing.

Found writing F70's test. `mapPointObj` picks the direction of a table by which end is
the home (F66); when both ends are the home — an eraser made at level 0 over an object
dragged at level 0 — it took home-to-picture and put the eraser a displacement away.
Fixed: when both ends are the home the caller says which way (`toHome`); the eraser's
projections and the indicator's view window say "to the home", the rest map to the
picture as before. `erase.moved.test.js`: an eraser made at the home over the moved
picture cuts the ink there, and the rest stays where the drag left it.

### F73 — FIXED 2026-09-08. A selected object too small to trace, in a frame whose selected content was wide, showed nothing.

Kobin's report `22-43-41` and screenshot: the 352 slivers of the cut dot and the one
sliver he had moved half a unit away, both selected, in one frame. Zoomed in, the moved
sliver had its ring; zoomed out to level 0 it was gone while the bundle beside it kept
its ants. Replayed: the frame's selected content spans 77 px, so it is not a dot; the
sliver is in the render list and traced, but it is 0.14 px across, so every run it would
draw is under SEL_MIN_RUN_PX and it draws nothing. The frame-mark rule only ever covered a
frame that is small as a whole. Fixed: after tracing, every selected member without a run
that is not a re-homed family's kid (drawn through its family) and is under
SEL_OBJECT_DOT_PX on screen is a dot where its picture is, dots on one pixel merged into
one (`mergeClose`). In the replay the sliver gets its dot at the report's camera; a few
untraceable specks inside the traced bundle get dots among the ants. `selection.indicator.test.js`:
a speck beside a large selected stroke keeps a dot once its ring is under a half pixel.

### F74 — FIXED 2026-09-08. The set-scale dialog's Length input was drawn as a dark bar at the bottom of the screen.

Kobin's screenshot: the "This length equals..." dialog open, and the number he typed
sitting in a full-width dark strip near the bottom edge, outside the dialog. The
2026-09-01 cleanup removed the `.bl-scale-field .bl-select` rule when the unit dropdown
became a button grid, and left the selector before it dangling on its comma, so
`.bl-scale-field .bl-input` fell through to the next rule: `.bl-toast` — fixed, bottom
5rem, centred, ink background. In production since that deploy. Fixed: the rule closed
(`box-sizing: border-box; width: 100%`). Measured in his Chrome: the input is static and
inside the dialog rect.

## F-Z — a thin, long stroke vanishes while zooming out

**Status 2026-08-26: FIXED AND VERIFIED BY KOBIN IN A BROWSER.** Reproduced and
characterised in real Chrome on 2026-08-25; the mechanism below is still not
known, but the lever is, and the fix pulls it. Reported by Kobin while checking
the selection indicator: a very thin, very long stroke went "very visibly there,
very visibly gone, semi-visibly there" during a zoom-out.

The fix is a per-object power-of-two rescale at PRE-RENDER only — nothing earlier
in the engine sees it. `Renderer._applyThinScale` measures 2·area/perimeter over
a group's finished anchors, picks a power of two S, multiplies the coordinates by
S and sets the group's scale to 1/S. Painted output is identical by construction;
S is a power of two so 1/S survives Two.js's six-decimal flooring serialiser
exactly, which also caps S at 64 (1/64 = 0.015625 is the last one that does).
F-Z's feature went 0.00329 -> 0.21 path units, about 3x clear of the ~0.065
threshold. Constants `THIN_SCALE_MAX`, `THIN_TARGET_UNITS`, `THIN_COORD_MAX` in
`Renderer.js`; dev kill-switch `Renderer.thinScale = false`; seven tests in
`Renderer.thinscale.test.js`.

Kobin confirmed it on 2026-08-26. The one thing still worth watching in ordinary
use, because no test can settle it: the gate is 2·area/perimeter, and a dense
scribble is thin BY THAT MEASURE without being a thin object. If a scribble ever
looks wrong, `Renderer.thinScale = false` in the console turns the rescale off
and says whether it is this.

### READ THIS FIRST — canvas rasterization CANNOT see this bug

Every measurement that goes `SVG → Image → canvas.drawImage` renders the stroke
**correctly**, at 95–103% of its exact geometric ink, in every configuration that
fails live. The failure appears only in **live DOM compositing**. Three separate
diagnoses were talked out of the right answer by canvas measurements that could
not reproduce it — including one that "disproved" the correct explanation.

Measure this by screenshotting real Chrome. Never by rasterizing to a canvas.

A second trap: **read screenshots zoomed in.** Faint sub-pixel grey is destroyed
by JPEG compression in a full-page screenshot, which produced one confidently
reported "confirmed cliff" that was pure compression artefact. Magnify the region
before concluding anything is blank.

The Electron browser inside the Claude desktop app (Chromium 148, dpr 1) does not
reproduce it either, even in live DOM. Kobin's Chrome 151 at dpr 1.5 does.

### The reproduction

`report-2026-08-25T15-53-05-793Z`, loaded at its own camera, object **id 4**
(level 0, 15,120 × 7,273 units, ink 13.465, resolved arc perimeter, 610 pieces).
Sweeping `inScale` with everything else held still:

| inScale | ink on screen | live Chrome |
|---|---|---|
| 200 | 0.658 px | solid |
| 141 | 0.464 px | solid |
| 100 | 0.329 px | solid |
| 71 | 0.234 px | **solid** |
| **50** | **0.165 px** | **BLANK** |
| 35 | 0.115 px | fragments |
| 25 | 0.082 px | **visible again** |
| 18 | 0.059 px | visible |
| 12.5 | 0.041 px | fading |
| 6 | 0.020 px | nearly out |

There → gone → there, and **not monotonic**: 0.082 px is thinner than the blank
row and renders. This is not a perception or contrast effect.

The `d` string is **byte-identical at every row** (15,074 chars, verified by
string comparison, `matchErr` 0). Only the matrix differs. The frame stayed `-1`
throughout, so no crossing and no representation swap is involved.

### The lever — it is the size of the numbers in `d`, not the size on screen

Multiply every coordinate in `d` by F and divide the matrix's linear part by F.
The output is **pixel-identical by construction** (same 184.5 × 88.8 box, same
0.1645 px ink; `screen = a·x + c·y + e`, so scaling (x,y) and dividing (a,b,c,d)
cancels exactly). It rescues the stroke, with a sharp boundary:

| path-space width | matrix scale | live Chrome |
|---|---|---|
| 32.9 | 0.005 | visible |
| 0.329 | 0.5 | visible |
| **0.0657** | **2.50** | **visible** |
| **0.0641** | **2.56** | **BLANK** |
| 0.0329 | 5 | blank |
| **0.00329** | **50** | **blank ← what the app sends** |
| 0.0000329 | 5000 | blank |

A 2.5% window. The app hands Chrome coordinates about **20× too small** for this
feature to survive compositing. Note the boundary is NOT at matrix = 1, so
"magnification vs minification" is not the rule either.

### What is NOT the cause — do not re-litigate

- **`fadeTag` / the fade band.** `projectedSizePx` returns the bbox DIAGONAL
  (`hypot(w,h) + lwFrame`), so F-Z tags 1,049 px while its ink is 0.84 px at the
  same reference — a factor of 1,247, and `_fade` therefore never engages. That
  is a real inconsistency and worth its own entry, but it is **not this bug**,
  and Kobin's objection stands: culling on ink width alone would hide an object
  that still covers half the screen, which is worse than the symptom.
- **Geometry degeneration / winding cancellation.** The stored arc loop measures
  area 430,562 units² and effective thickness `2A/P` = 13.478 against an ink
  width of 13.465. The DOM path's own area, sampled at 40,000 points, is
  0.025650 against an expected 0.025664 — **ratio 0.9995**. Exact at every stage.
- **Sub-pixel position.** Ten translations in 1/10 px steps at inScale 50, all
  blank.
- **float32 precision / `REORIGIN_PX`.** Coordinates handed over max **2.3**
  against a 1.5e6 budget — 0.0002% used. Baking scale in does not change the
  float32 error either: the on-screen error is `C·K·2⁻²⁴`, invariant under the
  rescale above.
- **Clipper.** The stroke is a native arc perimeter and never goes through a
  boolean. (And ClipperLib has no live call site at all — see the cleanup
  backlog.)
- **Frame crossings, `cullPx`, the fat gate, degenerate rect tests.** All ruled
  out by the sweep above: same frame, same `d`, same representation.

### What is still open

**The rule.** It is not a single threshold on path-space size — at path width
0.00329 the stroke is visible at inScale 25 and at 71, and blank at 50. Nor is it
on-screen thickness alone — at a fixed 0.165 px, growing the coordinates rescues
it. The two interact, and for this path the dead zone sits near 0.165 px on
screen. The mechanism inside Skia is not identified.

**The fix direction.** Keep path-space feature sizes above roughly 0.1 units.
That is a thin-end sibling of `fatWidthPx`, which already exists for the opposite
failure (Skia mis-strokes above ~25k device px, gate at 4000). The cost is the
path cache: `d` currently survives every camera move untouched, and baking scale
means regenerating it. A quantized scale — bake the nearest power of two, leave a
residual transform in [1,2) — would regenerate once per octave instead of per
frame, and keep every feature within 2× of its on-screen size.

### F-Z — coordinate budget, and how much room "use bigger numbers" has

The fix direction is to hand the browser larger coordinates and a smaller matrix.
This is what that costs. Window 1504 x 812, so the half-diagonal is 855 px.

**What magnitudes actually go out.** Coordinates are `anchor - origin` with the
origin at the view centre, so anything you can SEE satisfies
`|coord| <= 855 / inScale`:

| inScale | max coord (visible) | text quantum on screen | float32 error on screen |
|---|---|---|---|
| 256 (`ENTER`) | 3.3 | 2.6e-4 px | 5.1e-5 px |
| 64 | 13.4 | 6.4e-5 px | 5.1e-5 px |
| 1 | 855 | 1.0e-6 px | 5.1e-5 px |
| 1/32 (`EXIT`) | 27,300 | 3.1e-8 px | 5.1e-5 px |

Measured anchor: F-Z at inScale 50 wrote a maximum coordinate of **5.30**, against
a predicted ceiling of 17 (its visible part is smaller than the window). So one
level spans coordinates of about **3 to 27,000** — a factor of 8192, which is
`ENTER/EXIT`, exactly as it must be.

**float32 error is CONSTANT and tiny.** On-screen error is
`|coord| x 2^-24 x inScale`, and `|coord|` is itself `855/inScale`, so the
`inScale` cancels: **5.1e-5 px at every zoom, at every level.** That is why the
origin rebase works, and it is the number that says precision has never been the
constraint here. (An UNCLIPPED native spanning a whole frame carries coordinates
up to `W` = 131,072; at `inScale` 256 that is 2.0 px of float32 error — but only
for points far outside the view. Visible points always have small coordinates.)

**Rescaling by S is precision-neutral.** Multiply coordinates by S and divide the
matrix by S: the float32 error is `|c|.S x 2^-24 x inScale/S` — **unchanged**.
The text quantum on screen becomes `1e-6 x inScale/S` — S times BETTER. Nothing
about precision argues against it.

**The two real bounds on S:**

- *Floor* — features must clear the compositing threshold, about 0.1 path units:
  `S >= 0.1 x inScale / feature_px`. For F-Z's 0.165 px ink that is
  `S >= 0.6 x inScale`.
- *Ceiling* — keep the largest coordinate under **2^23 = 8,388,607**. That is
  where float32 stops representing consecutive integers, and it is also exactly
  where Firefox drops an SVG path entirely (bugzilla 1314265). Gives
  `S <= 9,800 x inScale`.

Four orders of magnitude of room. **S = inScale** (path units become screen
pixels, max coordinate 855, every feature measured in px) sits comfortably inside
it; `S = 8 x inScale` (max coordinate ~6,800) gives an 8x margin on the floor and
still 1,000x of headroom on the ceiling.

**What it actually costs: the `d` string and the path cache.** At `S = 8 x inScale`
numbers go from `5.304694` (8 chars) to `6837.123456` (11), so `d` grows about
35% — F-Z's 15,074 chars becomes ~20,000. The real cost is that `d` currently
survives every camera move untouched; baking scale means regenerating it.
Quantizing S to powers of two fixes that: regenerate once per octave of zoom, and
carry a residual matrix in [1,2), which keeps every feature within 2x of its
on-screen size at all times.

**The 6-vs-3 decimal discrepancy.** Two.js v0.7.1 documents `Utils.toFixed` as "a
pretty fast toFixed(3) alternative" and then does `Math.floor(v * 1000000) / 1e6`
— six decimals. All three copies in the package (`build/two.js`,
`build/two.module.js`, `src/utils/math.js`) agree on 1e6, so the docstring is
simply stale upstream; the constant was widened and the comment was not. Two
consequences worth knowing: the quantum is an ABSOLUTE 1e-6 in path units (not
relative), so it buys 6.5 significant digits at `inScale` 256 and 10.4 at `EXIT`;
and it **floors rather than rounds**, so every coordinate carries a systematic
downward bias of up to 1e-6. Neither matters at current magnitudes — F-Z's
0.00329 ink is 3,290 quanta wide — and rescaling only improves both.

### Harnesses

`tools/harnesses/hairline/` (was `public/hairline/` until 2026-09-02, when
everything that was not the app left `public/`) — `index.html` (stroke vs filled
sliver vs filled cubic loop,
canvas-measured; useful only as the negative control that shows canvas cannot see
the bug) and `chrome.html` / `chrome2.html` / `chrome3.html` (live-DOM grids for
screenshotting in real Chrome).
