# bound.less — roadmap

**The plan of record, and the only backlog.** Bugs live in [`OPEN-FLAGS.md`](OPEN-FLAGS.md)
and are referenced here by id, never restated. The hands-on browser checklist is
[`UAT.md`](UAT.md). Everything else that is still to do is on this page, in the order it
will be done. Edit in place; when an item finishes, move its line to the **Ledger** at the
bottom with the date.

Order set by Kobin on 2026-09-02. Last updated **2026-09-02**.

> This page replaced `docs/ai/50-TODO.txt`, `60-RECOMMENDATIONS.txt` and `70-RELEASES.txt`
> on 2026-09-02, because the todos had spread across three files plus the README and the
> status snapshot. Their text is carried below under **Detail** and **Ledger**, verbatim,
> so nothing was lost in the move. The plan at the top is the new part; the detail is the
> reference behind each line of it.

## The order

| # | phase | done when |
|---|---|---|
| 1 | **Fix autosave** | a 16-million-character document autosaves without a frame over 50 ms on the phone, measured through the existing instruments |
| 2 | **Deploy** | `main` is fast-forwarded and pushed, and `firebase deploy --only hosting` has run on a build that contains only the app |
| 3 | **Performance and bugs** | the open flags are closed in a browser and not only in Jest, the unexplained stalls are explained, and the UAT matrix has more than one row |
| 4 | **UX** | the R3 scope below is done and has been through the manual visual pass |

Underneath, one piece at a time and never blocking a phase: the **structural lane**. Every big design change that was deferred, with where and why, is in **the register** further down.

One principle set the original order and still holds: do not build on top of something
that cannot save, and do not redesign a surface you cannot regression-check. The check is
Kobin's own visual pass in a real browser; the automated version is optional and is
described in the detail below.

## 1. Fix autosave — F33

**Built 2026-09-02; awaiting Kobin's browser test.** Local autosave is back ON
(`LOCAL_AUTOSAVE = true` in `hooks/useKobinEngine.js`). The measured cost had been
compression on the main thread, not the quota: five successful autosaves cost 29.6 s of a
48.6 s window on the phone, 97% of it inside `LZString.compressToUTF16`.

- [x] Move the document off localStorage to IndexedDB (`storage/db.js`): one header record
      per canvas and one record per frame, structured data, no `JSON.stringify`, no
      compression.
- [x] Save incrementally: only the frames the document's own events named, 1.5 s behind the
      last change with an 8 s ceiling, flushed on tab hide, pagehide and unmount. Pulled in
      from "out" because the events made it nearly free.
- [x] Bound the thumbnails: JPEG bytes in their own store, least-recently-used first under a
      12 MB budget, swept for canvases that no longer exist.
- [x] Turn `LOCAL_AUTOSAVE` back on. The standing banner is gone; the failure banner stays.
- [x] Keep the cloud path as it is — same format, same chunking, parent written last — with
      the compression moved into a worker (`cloud/lzWorker.js`) and both pushes timed as
      `cloudSave` in the perf log.
- [x] Close the leaks: an untouched canvas is never written; unindexed drawn-on documents
      are adopted as drafts and empty ones deleted; backups expire after a week; thumbnails
      and trash payloads for canvases that exist nowhere go; the dead keys from deleted
      pages go with the one-time migration. The gallery shows storage usage and asks once
      for persistent storage.
- [ ] One honest save-state indicator instead of three toasts.
- [ ] **Done when** the 16-million-character drawing autosaves on the phone without a frame
      over 50 ms, read off `notePerf("autosave")` in a report. Measured so far only on a
      two-stroke drawing in the in-app browser: 1.7–1.9 ms a write, full and incremental
      alike. The measurements are in OPEN-FLAGS F33.
- Detail: R1 and proposal 8 under **Detail**.

## 2. Deploy

- [x] Commit the 2026-09-02 cleanup, the autosave fix and the 2026-09-03 selection work;
      push. **`main` was fast-forwarded to `arc-pipeline` (f6f1062) on 2026-09-03 and is the
      working branch from then on**; the 88 paths were committed on it and pushed the same
      evening, at Kobin's word.
- [x] `npm run build`, then `firebase deploy --only hosting`. `public/` holds only the app
      shell since 2026-09-02 and a clean build is 6.5 MB. **Deployed 2026-09-03** from the
      working tree (the F39 third design, budget off, 2 px frame dots; the commit above is
      still pending), at Kobin's word.
- [x] Small things worth doing with it — **two of three done 2026-09-07**: the manifest
      `theme_color` and `background_color` are the paper (`#f7f2e9`, the sRGB fallback of
      `--paper`); `window.__kobinEngine` is set only in a dev build or behind `?dev`
      (`useKobinEngine.js`). Still open: a `.gitattributes` line to normalise line
      endings, as its own commit so the diff is only endings — it needs the renormalise
      commit with it, so it waits for Kobin's word on committing.
- [ ] Run one row of the UAT matrix on a machine that is not the development one.
- [ ] **Before the true 1.0: the derivation-compatibility decision** (Kobin, 2026-09-05).
      Every deep picture in a saved drawing is derived by the tile chain and not stored,
      so any shipped change to that arithmetic (F44's layers, F43's canonical extents,
      paint-time offsets for moves) moves existing drawings' detail by 4096× per level.
      Either store what has been looked at (cede coarse objects' chains down to tiles
      that hold references, like an erase does — cost analysis owed) or version the
      derivation per drawing. The comments on `deriveStep`, `chopFreezeLoops`,
      `clipShapeToRect` and `subPiece` carry the same note; the agent memory holds the
      reminder to ask at deploy time. **The working tree already holds three such changes:
      F55 took the move offset out of the hop and F43 recomputes a cut piece's deep cuts
      from its canonical line or arc (2026-09-05, neither changes an unmoved, uncut piece's
      bits); and F44's radius gate (2026-09-06, Kobin's rule) changes WHICH pieces freeze
      — every arc over ~8.8e12 units now freezes where the old test refused it, so the
      deep picture of every existing drawing with a curved stroke zoomed past its third
      crossing shifts by up to the tolerance times 4096 per level. That is the shift the
      F44 design warned of, accepted by Kobin in asking for the gate; the next deploy is
      the first compatibility event of the tile chain, and no deployed build ever wrote a
      table or a cut piece.**

## 3. Performance and bugs

**Recommended order, 2026-09-07** (Kobin asked for it as a list: each item, what it
fixes, what the fix is). Everything above the line is jsdom-only until he has seen it.

| # | item | what it closes | what it is | size |
|---|---|---|---|---|
| 1 | **Verify by hand in Chrome** — UAT cases 9, 10, 11 | F41, F42, F43, F44, F55, F56 (all "fixed, unverified"), F35 | his two phone scenarios, the star in the corner, the nick far along an edge, the crossing jump, the erase below moved objects; every one built from a replay or a synthetic, none measured on paint | an hour, his |
| 2 | **The 1.0 compatibility decision** | the deploy gate (§2) | store what has been looked at, or version the derivation per drawing; needed before any deploy now that F44's gate shifts old drawings' deep curves | a decision, then a day either way |
| 2b | ~~**The freeze rule's cost**~~ — **decided 2026-09-07: keep the one-radius rule** (Kobin). The cost stands as measured: arcs just under the radius stay curves a level or two longer and are chopped at every grid line meanwhile, so a big stroke one crossing down paints 6,687 pieces where the per-piece bow kept it under 4,000 (LX-4). Accepted because the radius rule is the one under which an erase cannot change what freezes; if that piece count ever shows in frame time on a real drawing, the answer is the rendering item, not the rule | decided |
| 3 | ~~**Render once per pen-up, and memoise the group signature**~~ — **done 2026-09-07** | the quadratic session (per pen-up ∝ N; 0.5 s at 2,000 strokes) | the renderer memoises the measured part of a shape's signature per piece, keyed by `_ver` (`Renderer._sig`), and the shape bake no longer renders on its own — the resolved perimeter paints as the raw stroke did, so its picture waits for whatever renders next (`_stepShapeBakes` sets `_renderPending`; `flushBakes` honours it; a D9 promotion renders at once). Measured in jsdom (`perf.scale.probe.js`): per-stroke draw cost 95 → 64 ms at 250 strokes and 334 → 211 at 1,000 from the memo alone (the probe's main loop flushes bakes, which renders, so it still sees two renders a stroke); a warm render 16 → 10 and 63 → 43 ms. Human-paced (the bake tick between strokes, the probe's `paced` loop): ONE render a stroke, 120 → 62 ms a stroke at 250 and 468 → 204 at 1,000 against the same loop with two renders. What is left of a render is Two.js's own `update` walk, the list build (both O(N) by construction) and the group builds themselves | done |
| 4 | ~~**The ants' crawl with no budget**~~ — **deferred by Kobin 2026-09-07**: *"No budget for now — this is not a high priority to me right now. Long term roadmap item."* | 50–200 ms frames with a large selection | the levers stay costed in OPEN-FLAGS F39 (a march that slows with selection length, static dashes past a length, a WebGL layer) for when it is picked up | long term |
| 5 | ~~**The winding query in the chord frame**~~ — **done 2026-09-07** | the jsdom instrument's 0.9 px error on huge arcs; the boolean's classification near the gate | `rayCross` asks an arc whose radius is at least its chord in its chord frame (`chordLineRoots`, the chop's own solver with the ray's normal in place of an axis, and a residual check — a ray that misses the arc still gets roots); the seam marks are gone. `geometry/winding.chord.test.js` (WC-1..4) holds it against the centre form and against geometry on 70,000 seeded arcs | done |
| 6 | ~~**F54**~~ — **closed 2026-09-07 by Kobin's decision** | a wheel tick mid-stroke ends the stroke | *"It can just end like it does today"*; drawing through a zoom, crossings included, is a future feature on the UX list | closed |
| 7 | **F29 and F30** | a piece fading out while zooming out; an eraser consumed without cutting | both instrumented, neither reproduces; they wait for a report, which now explains itself | unknown |
| 8 | **The minify bake's flatten** and the two report outliers (a 7.9 s click, 11 s of bake) | performance items below | measure first; the outliers need their reports | medium |
| 9 | **Coverage and CI** — **CI written 2026-09-07** (`.github/workflows/ci.yml`: `typecheck` + `test:quick` on every push and pull request, `test:all` nightly; it runs once the tree is pushed) | one UAT row filled; no CI | the matrix rows are still Kobin's to fill; E1 turned out to be done already (PI-6 is a trace-mode assertion) | the rows |
| 10 | **The structural lane S1–S6 and the UX list** — **S1, S2, S3, S5 done 2026-09-07** (one `TileGrid` type; the layering lint rule; JSDoc typedefs with `npm run typecheck` over the geometry, 0 errors, and it found two wrong annotations on the way; the five duplications folded) | §4 | S4 (Renderer and CanvasEditor extractions, medium) and S6 (the toolchain, large) remain, and the UX list | S4, S6 |

**Bugs**, in the order OPEN-FLAGS ranks them. Each has its own entry there; nothing is
restated here.

| flag | state | first step |
|---|---|---|
| F57 | **open, high — 2026-09-07; three causes built out 2026-09-08** | an eraser at depth on Kobin's 11,497-object canvas never finishes: 0.64–2.5 s a bake step, every step a cede descent, twelve marks pending, the tab locked past 45 s. Reproduced on the desktop from phone report 23-54-04 on 2026-09-07: five marks, 247 s in 1,447 ticks, one tick 109 s, half of each in-place cut spent in `_removedArea`. Design options under "Saving and memory at scale" below  2026-09-08: the scan from the spatial index top-down by z, the boolean's `RayIndex` (2.6 s a cut → 175 ms), the cut in a worker; the descent in the worker too since the same night (eraseDescent.js) |
| F58 | open, medium — 2026-09-07 | a report of that canvas is a 92 MB JSON the report server refuses (20 MB cap); the report must stop carrying the whole document |
| F59 | open, medium — 2026-09-07 | a cold render of 882 pieces is 8 s (9 ms a group building Two.js paths); warm 87 ms. The case for a renderer without a DOM path per piece |
| F60, F61, F62 | open, low — 2026-09-07 | the scale dialog's dangling CSS selector; a NaN zoom anchor recursing; `stroke="undefined"` on every fill path. Found by the other session, confirmed |
| F63 | **fixed in the document 2026-09-08** | on canvas `mtqha19c7qjn` the other session had rewritten every z to depth×1e7+id, so a new stroke or mark (z = id) painted under everything and an eraser reached level-0 objects only. `tools/zorder-compact.js` relabelled z as the paint-order rank (1..12,544, ids untouched, old z backed up to a report); verified after reload with a real pen stroke on top. Local copy only: the cloud copy is stale until F64. The engine still assigns no z at creation (the Z-order item under UX) |
| F64 | **fixed 2026-09-08** | the cloud sync of a 90 MB canvas failed inside lz-string ("Too many properties to enumerate"), retried every 30 s, and said so only in the console; each try stringified the document on the main thread. Fixed by the kobin-2 cloud copy (DESIGN.md §13): frame and log chunks gzipped by CompressionStream, a push mirrors the local store instead of stringifying the document, a failed sync is shown in the save bar with its size and backed off 1–30 min, and the main-thread fallback runs only where there is no worker at all. Seen in Chrome on a small canvas: push, pull and compaction; the 90 MB canvas's migration is still to be seen |
| F65 | **open, medium — 2026-09-08; gate rebuilt the same evening** | Kobin: an object can be dragged out from under an eraser mark that never baked into it, the mark staying behind. The barrier (`_flushErasesFor`, `_settleSelectionErases`) exists and gates by result: a mark that ranks at or below the object's z, projects outside its box, grazes, or whose bake is refused counts as not touching it. Which he hit needs a report; the design question is whether a refused mark blocks the drag or travels with the ink  Built: settle before select, the mark's z stepping down with the bake, refused marks consumed (DESIGN.md §7); awaiting his try |
| F66 | **fixed 2026-09-08** | an eraser over a moved object, made in a neighbouring frame at the object's own depth, cut nothing (the moved-object mapping chose its direction by depth; the home is named by id now), and a hairline eraser's slivers were culled as dust against the pen (dust is now what was narrower than a quarter pixel at the zoom the mark was drawn at, Kobin's rule). Three reports, replayed in jsdom with `erase.report.probe.js` before and after |
| F67 | **fixed 2026-09-08** | a descent baked in the worker took the whole object with it: the kids were homed in a frame only the worker's lattice copy had minted, and the engine could not resolve their level. The job now returns the frames it minted and the apply merges them first; a load mints any frame its natives name, which repairs the document his autosave wrote. Report 20-48-33, replayed in jsdom; his saved snapshot loads with all 353 kids painted |
| F68 | **fixed 2026-09-08** | with a moved object selected, zooming out until it was too small to see made the indicator jump: the frame's dot and the selection rect's fallback were placed from the stored bits, the offset table ignored. Both go through the table now (`_selFrameRect`, `_rectInActive`). His "smaller eraser-cut objects disappeared" from the same report did not reproduce: the replay paints all 1,520 objects where their tables say; the level-2 specks are simply under the level-1 cull |
| F69 | **fixed 2026-09-08** | a lasso around moved objects or ceded kids selected nothing: the frames' spatial indexes hold an object at its stored bits and the loop never looked where its table draws it. Every object with a table is now judged where its picture is. Measured in Kobin's tab: 0 of 352 kids found before |
| F70 | **fixed 2026-09-08** | after a reload, a redo brought a cut piece back with a table from later in its history: the op log's replay decoded each record to its own object, so the undo of a move reset one copy and not the other. Replay keeps one object per id, the later record's state winning; a redo's record is the object it removed |
| F71 | **fixed 2026-09-08** | a redo of a move or an add wiped the store's log (the inverse op had no seq and read as pre-log); the undo history would not have survived a reload. The inverse carries the seq now |
| F72 | **fixed 2026-09-08** | an eraser made in an object's own frame over its moved picture cut nothing: with both ends the home, the table mapping took the home-to-picture branch. The caller names the direction now |
| F73 | **fixed 2026-09-08** | a selected object too small to trace, in a frame whose selected content was wide, showed nothing (the frame-mark rule covered only a frame small as a whole): a member without a run, under 8 px, is now a dot where its picture is. His report 22-43-41, replayed |
| F44 | **fixed 2026-09-06, unverified** | arcs at depth were positioned through their centre and the freeze refused every piece on a tile line: any curved stroke's picture was off by a screen at its fifth crossing (Kobin's crossing jump). Fixed by his rule: the freeze is one radius (an arc whose bow over a tile diagonal is a quarter pixel, ~8.8e12 units, the same at every level) with an endpoint guard; the arcs about to freeze are cut in their chord frame; the boolean uses the same gate. Measured: three curved strokes hold their edge to 1/20 px through eight crossings, no arc past level 3. His green stroke at 4 → 5 is the acceptance |
| F56 | **fixed 2026-09-06, unverified** | an erase nine crossings below two moved objects flooded the one the eraser never reached: since F55 the cede's unmoved square lands next door as often as not, and a kid homed in the camera frame with its ink in a neighbour cell derived its child tiles through the store's inexact ring projection. The kid is now homed in the square's owner frame, holding that frame's own piece. Replayed from Kobin's reports, `reported.regress.test.js` RR-9 |
| F45 | fixed 2026-09-05, jsdom only | a crossing about a view centre on a cell boundary jumped the picture one cell; `camera.crossing.test.js` |
| F46 | fixed 2026-09-05, jsdom only | an erase on a curve at level 2–3, zoomed in, was refused as grazing at random (the area comparison, not the boolean); `erase.curve.depth.test.js`. Probably F30's mechanism |
| F47 | fixed 2026-09-05, jsdom only | a partial cede reported success and left the object restructured with nothing erased; unwound now |
| F48–F53 | fixed 2026-09-05, measured in Chrome before and after | six gesture-path defects found by driving the real pointer events: a lost pointerup orphaned the stroke (and locked touch in pinch mode), Delete needed one undo per object, a re-homing drag left the hit test and the ants stale, undo left the drag's tile phase behind, tile pieces picked with no slack, a mid-stroke render painted the live stroke twice. `gesture.robustness.test.js` |
| F55 | **fixed 2026-09-05, unverified** | a move loses registration with detail three or more levels below the move level (Kobin's star in the corner; F35's mechanism): the one rounded addition at the move level was magnified 4096× per level below. Built: a move never touches a stored coordinate — the displacement, snapped to 2^-10 units, lives in the object's table, the tiles are unmoved space, the table is read at render time and inverted on inputs. `move.registration.test.js`: the deep pieces are the same bits in the new frame. Kobin's corner is the acceptance |
| F54 | closed 2026-09-07, by decision | a wheel tick mid-stroke ends the stroke; Kobin: it can end as it does today, and drawing on through a zoom — past a level too — is a future feature (UX list), not a bug |
| F42 | **fixed 2026-09-04, unverified** | the cede descent reads the tile store's piece for the square and mints the kid from those bits; Kobin's level-9 scenario on the phone is the acceptance |
| F41 | **fixed 2026-09-04, rebuilt by F55 2026-09-05, unverified** | per-level offsets below the home (`geometry/offsets.js`); since F55 applied at paint rather than in the hop; Kobin's green-object drag on the phone is the acceptance |
| F43 | **fixed 2026-09-05/06, lines and arcs, unverified** | a cut on a long piece moved its picture at depth: Kobin's corner scenario — a nick at level 3 left the level-8 tile EMPTY. Built: a cut line carries the line it was cut from (`P`/`Q`), a cut arc the arc the chain would have had (`K`) with its stretch as positions, and every cut below is computed from that. Measured: all three corner cases bit-identical at level 8 after the nick with the edge unmoved to the last digit (the join-arc case closed on 2026-09-06 with F44's gate, which makes the chain and the boolean freeze by one rule); a line at level 6 and an arc at level 3 bit-identical in the quick suite |
| F34 | **closed 2026-09-07, by decision** | `circleCircle` fixed; 0 of 21 aimed rings seal in jsdom and in Kobin's Chrome. D1, the representation change that would have made its class unreachable, was dropped from the register on 2026-09-08 |
| F35 | **fixed with F55 2026-09-05, unverified** | F41 fixed the drag under the finger and instrumented the drag (`skipped`); F55 fixed registration three or more levels below the move, which is what a corner seen at level 5 is. Closes when Kobin sees his corner hold |
| F29 | **closed 2026-09-07, by decision** | the harness (report 07-22-12 plus a zoom-out sweep) ran in Chrome: every fading piece under 0.3 px; F8 under Detail stays as a design note |
| F30 | **closed 2026-09-07, by decision** | not reproduced synchronously nor on the timer path in Chrome; F46/F47 fixed the mechanisms that fit it; still instrumented, so a repeat explains itself |
| F32 | fixed 2026-09-03, unverified | the lasso judges by ink where the box straddles the loop; Kobin to redraw the loop that missed |
| F36 | closed as a bug — F42 (2026-09-04) and F56 (2026-09-06) | the erase reads the piece's window and phase off the store, from the frame that owns the square, so it cannot disagree with the render about a tile; S1's `TileGrid` value type is what remains, a tidy |
| F5 | standing | closes only when Kobin says the eraser works |
| — | **a move is not exact** | from the F35 numbers: an object moved 0.143 units in its own frame between two reports with no gesture between. Kobin, 2026-09-02: the defect is in the move path; the undo/redo between the reports is only how it was seen. Part of F35, not a flag of its own. Cannot be replayed: those snapshots have no journal. Since F55 a move cannot change a coordinate at all, so the number cannot recur; unverified on his drawing |

**The depth floors — F41 and F42 are one job. BUILT 2026-09-04** — the ledger entry
below has what was built and measured; OPEN-FLAGS F41/F42 have the details. Where the
build departed from the plan: F42 did not merge the two projections into one routine,
it made the erase READ THE TILE STORE (`_squareInk`) and cede per cache square, so the
kid is the render's piece by identity rather than by shared arithmetic; F41's offsets
therefore went into the hop itself (`deriveStep`) plus a render-time residual, not into
a merged routine; the `TileGrid.forObject` type was not built (the phase rides on the
piece); the F35 replay was impossible (no journal in those snapshots), so F35 got its
instrumentation and waits for a report. Found on the way: F43. The plan as written,
kept for the record:

Written 2026-09-04 so the work could start cold after a compaction. Both were measured
and replayable (OPEN-FLAGS F41, F42); no code had been changed for either.

*What is wrong, in one sentence each.* F42: the erase's cede descent recomputes each
level's ink with its own arithmetic, and past five crossings any independent
recomputation parts from the render chain by 4,096× per crossing, so the eraser cuts
ink the screen does not show. F41: a drag made three or more crossings below an
object's home writes a sub-float64-step displacement into the home coordinates, which
rounds to nothing or to a whole step (127 px jumps at 254×).

*Kobin's constraints, in his words (2026-09-04).* "The move is only handled locally";
moving a level-6 object at level 8 "would affect level 7 but shouldn't make a change
to the way the tile is calculated for level 8. And it would not affect level 6 at
all." "A move at level 5 just re-assigns which level 5 frame the level 6 frame with the
object is in." "A move at level 6 just changes the object's coordinates within the
frame, or maybe the frame it's in if you move it far enough." Audit question answered
yes: with the design below, tiles for an object moved at every level 0–200 are still
generated bit-identically — each level from the previous level's stored bits by the
same fixed operations — provided the two rules under "Invariants" hold. And: "keep the
extra cost from adding up too much."

*Order.* F42 first: it produces the one projection routine every consumer shares.
Then F41 adds the offsets inside that routine. Doing F41 first would add the offsets
to `LevelMap.projectF` AND to `derive.js`, a third way of doing the same math.

*Step 1 — one projection, shared (F42).* Today the object-to-level projection exists
twice: `geometry/derive.js` `deriveStep` (~L481; `transformLoopsAbout` → `chopFreezeLoops`
→ `shapeLoopsInRect` on `objRect = padRect(tileClipRect(phase, cells), pad)`, per hop,
from the parent TILE's stored pieces — this is what the screen shows) and
`LevelMap.projectF` (L509: `transformLoopsAbout` per hop from the object's home, no
chop, no freeze — used by the erase's `_inkShapeInRect` (erasePipeline.js L596, which
then `clipShapeToRect`s the bare tile block) and by selection/hit-testing). The
eraser's descent (`_bakeRehomeInner`, L724–870: the loop over `path.down`, `R` = the
object-tile block from `objTileRange`, `inTile`, `solid`, `cedeTileById`) must take
each level's ink from the render chain's derived pieces for that tile — `TileStore`
`_ensureUp`/`_bakeUp` (L144/L156) through `content(F, rect)` (L100; note it returns
DERIVED pieces only, never `ownContent(F)` L137) — and mint the kid
(`Document.cedeTileById`, L475) from exactly those loops, so the next level's render
derives from the same bits the erase cut. Two things to settle while doing it: the
render piece is clipped to the tile padded by 48 units (`seamPad`) while the cede
wants the bare tile (the parent is cut on the bare tile — `holeInParent` — and the kid
fills it exactly; probably: kid = the render piece re-clipped to the bare tile, in the
render piece's own local frame, so its bits inside the tile are the render's); and the
render piece already carries `markSeamEnds` and the object's `tile` phase — keep them
on the kid. The in-place branch (target homed at the gesture's level) is untouched.
Then make selection/hit-testing read the same pieces where they project deeper than
the home, and retire `projectF`'s shape branch or make it call the shared routine.

*Step 2 — offsets below the home (F41).* Data: on the object, beside its home,
`below: { [depth]: [ox, oy] }` (or an array from home+1 down), each in that level's
units, |o| ≤ W/2 = 65,536; keyed by depth below the home, not by frame id, so a
change of address does not disturb them; absent means zero. Serialise with the object
(`Document.serializeNatives` L778 whitelists per type — add the field; `persist.js`
kobin-1 encode/decode/validate; old files have none). The drag: `selection.js`
`_dragSelection` L450, the `depth <= camDepth` branch (L466–474, "plain translation is
exact") — when the camera is DEEPER than the member's home, do not translate: add the
displacement, exact in camera-level units, to `below[camDepth]`; carry when |o| >
W/2 — one frame of level k is exactly 32 units of level k−1, so `below[k−1] += n·32`,
`below[k] −= n·W`; a carry out of home+1 is n·32 home units: exact integer step of the
coordinates (`Document.moveById` L277 / `translateGeometry` L355) or a change of
address (`_normalizeHome` L508). Recompute from the drag's START like today (M-4:
`st.base` = `Document.snapGeometry`, so snapshot the offsets there too). Undo: the
drag's one op restores home coordinates AND offsets. The camera-at-or-above-home
branches are unchanged (`displaceFrame` L437 digits + remainder into geometry;
`_normalizeHome`). Applying: inside the shared per-hop projection only — at the hop
into level k: `p_k = (p_{k−1} − c_k)·4096 + below[k]` (one addition, rounds once to
half an ulp of level-k coordinates, 1.5e-11 units); the object's tile phase at level k
shifts by the same offset (`childTilePhase`, frameLattice.js L231; `tile` on the
piece) so the chop and the cede cut on a grid that rides with the object. Levels AT or
ABOVE the home (own-level render, `_downPieces`/minify, hit-testing there) see the
offsets as one translation Σ below[k]/4096^(k−h), computed in float64 and applied when
building anchors — sub-pixel, never written into the coordinates, and nothing deeper
derives from it. `mapRectF`/`mapPointF` (L495/503) used by the erase to map the
eraser's rect UP to a coarser level are unaffected (they map the eraser, not the
object).

*Invariants (the audit).* (1) Offsets are applied only inside the shared per-hop
projection, in a fixed order of operations, never composed across levels for anything a
deeper tile derives from. (2) The offset moves the object's own tile grid with it at
that level. (3) The home coordinates change only by whole cells (carries) or by moves
made at or above the home. (4) Every consumer — render chain, hit-testing, erase,
minify — reads the same routine's output; nothing re-projects an object on its own.

*Tests to write.* F42: the replay (recipe below) as a jsdom test — the red and green
chains reach level 9 and the holes land in the ink the render list shows; a 49-point
sample of the same tile agrees between `store.content` and the kid at every level; the
existing cede suites stay green (`erase.cede.test.js`, `erase.contract.slow.test.js`,
`erase.deepsever.slow.test.js`, `precision.slow.test.js`). F41: `move.deep.test.js`
gains the from-below case — a drag 3, 5 and 8 crossings below the home lands within
1.5e-11 camera-level units of the pointer at every step; the home coordinates are
bit-identical before and after; a carry crosses a frame exactly; coarser levels show
the sub-pixel translation and nothing jumps at the crossing; `move.drag.test.js` for
the undo. Then measure in a browser on the phone, both reports' scenarios.

*The replay recipe (used for both diagnoses).* A report is a loadable drawing:
`E.loadSnapshot({ v: "dev-0", natives, crossings, camera })` in `mkEngine(411, 750)`.
Take `natives` from `.kobin-reports/report-2026-09-04T14-45-44-710Z.json` (before the
erases), `crossings` and the journal from `report-2026-09-04T14-50-08-725Z.json` (so
the level-9 frames exist); replay the journal's `move` entries between the two reports
with `doc.moveById(id, dx, dy)` (they are totals from the drag start, so the bits
match); set the camera to the erase entry's frame and inScale with the eraser's points
centred; drive the gesture with pointerDown/Move/Up on screen points = frame point ×
inScale + inPan, `setEraserSize(px)`, then `flushBakes()` and `flushErases()`. Wrap
`_bakeRehomeInner` to read `_rehomeWhy` — a PARTIAL cede's stop reason is not journaled
(only a full refusal is, under `note.refused`). The two reports stay in
`.kobin-reports/` on Kobin's machine (the folder is local, not in git).

*Cost budget.* Two floats per level per object that has been moved from below; one
addition per coordinate per hop; a carry loop per drag event; no per-frame work; tile
invalidation on a move exactly as today. F42 adds no work to the render and removes a
recomputation from the erase.

*Loops in F35 and F36 (Kobin, 2026-09-04: "That should loop in F35/36, right?" — yes).*
F35, a group move displacing one member, is the same branch: its section already names
the two code paths one drag uses on a mixed-depth selection, and the `depth <= camDepth`
one is exactly the branch F41 replaces. After F41 every member goes through lattice
arithmetic — digits from above, offsets from below — so registration is by
construction for all of them **at the level of the move and one below it** (correction
2026-09-05: not further down — the offset's one rounded addition in the hop is
magnified 4096× per level below the move, which is F55 and is F35's mechanism; the
"by construction" claim here was too broad), which dissolves F35's "two paths compose
differently at a corner" worry only for that case; the three silent `continue`s in `_dragSelection` get instrumented in the
same change (record `{id, level, why}` against the gesture, as `_rehomeBail` does for
the erase); and F35's own number — an object moved 0.143 units in its own frame between
two reports with no gesture between — becomes F41's acceptance test, replayed from its
snapshots in `.kobin-reports/f35/` (local, ~2 MB each; `f35.render.test.js` already
loads them) with the recipe above (0.143 units is far too large to be quantisation, so
it may yet be a separate defect; the replay decides).
F36, three things called a tile: step 1's shared projection is the place that has to say
explicitly which grid a rect is on — the object's tile grid, with its phase, and after
step 2 with F41's offset in that phase — so S1's `TileGrid.forObject(o)` is built as part
of step 1 rather than as a later tidy; the cache-square half of S1 can follow.

**Performance**

- [x] **Built 2026-09-07 — the signature memo and one render per pen-up.** `Renderer._sig`
      memoises the bbox and piece count per piece, keyed by `_ver`; `_stepShapeBakes` no longer
      renders when a perimeter resolves (the picture is the same curve; `_renderPending` is
      satisfied by the next render, `flushBakes` renders if pending, a promotion renders at
      once). jsdom, `perf.scale.probe.js`: draw cost per stroke 95 → 64 ms at 250 strokes,
      334 → 211 at 1,000; warm render 16 → 10 ms, 63 → 43; human-paced, with the bake tick
      between strokes, one render a stroke and 120 → 62 ms a stroke at 250, 468 → 204 at 1,000.
      The rest of a render is Two.js's `update`, the list build (O(N) by construction) and the
      group builds themselves. The original entry follows.
- [x] **The render is O(N) with nothing changed, and every pen-up renders twice — measured
      2026-09-05.** `Renderer.render` builds the signature of EVERY group every render
      (`loopsBBox` over every arc piece, then a string) before an unchanged group is skipped;
      a pen-up renders on `pointerUp` (the raw stroke) and again after the bake. jsdom, random
      scribbles: draw cost per stroke 95 ms at 250 strokes, 334 at 1,000 (95% of it the two
      renders); warm render 16 → 63 ms; a crossing 0.5 → 1.6 s; an erase gesture 0.6 → 1.8 s.
      Kobin's Chrome, hidden tab: per pen-up ≈ 15 ms + 0.25 ms × N (40 ms at 100 strokes, 90 at
      300 — 0.5 s at 2,000, 1.3 s at 5,000). Fixes with no trade-off: memoise the signature per
      piece (WeakMap, keyed by `_ver` and the window key) or keep a dirty set from Document
      events; render once per pen-up. `perf.scale.probe.js` is the harness (run with
      `--testMatch '**/perf.scale.probe.js'`).
- [ ] **DEFERRED by Kobin 2026-09-07 — a long-term item, not this phase's**: *"No budget
      for now — this is not a high priority to me right now."* The measurements and the
      levers below stand for when it is picked up. Written 2026-09-03 as HIGH PRIORITY:
      the crawl's repaint with no budget. The ant budget came off on 2026-09-03 at
      Kobin's instruction, so every selected piece on screen is outlined. Measured on the
      desktop, dashed ants cost ~0.8 µs a pixel a repaint and the crawl repaints 20 times
      a second: with the whole 2026-09-03 drawing selected, 72,554 px of ants at the
      report camera holds a frame at 50 ms, and 275,820 px at 4× in holds it at 200 ms.
      The phone has not been felt yet. The levers, none of them a change of dash density:
      a march that slows as the selection grows (cycle time scaled by length, so a
      repaint lands on a fraction of frames); static dashes past a length (one repaint
      per decision); or the ants on a WebGL layer, where the cost stops depending on
      length (Kobin: not yet). Costed in OPEN-FLAGS F39.
- [x] **The render-only window chop (F40's last piece) — built 2026-09-04.** Every
      coordinate reaches the browser in float32 relative to the scene origin, so a piece
      whose ends span a tile at the frame's deepest zoom carried their rounding onto its
      on-screen stretch — up to 2 px, lines and arcs alike — and Chrome's GPU raster
      DROPS a path whose curves run beyond ~1e7 device px (Kobin's red piece, three
      cubics, painted at inScale 64 and gone at 78.8; a length split only made more such
      cubics and is off). Now each scene keeps a window of ±2^18 device px around the
      view, any area piece reaching past it is clipped to it with the tile machinery's
      exact boolean, and the window is chosen again — rebuilding only the straddling
      groups — when the view leaves its inner half or the zoom grows fourfold. Measured
      in his Chrome on his drawing (OPEN-FLAGS F40). Still open under this heading: fat
      curve-capsule outlines are not chopped (cubics, no exact rect clip for them), so a
      stroke wide enough to be fat and long enough to span a tile at a frame's deepest
      zoom is the one piece that can still be that far away.
- [ ] **Does the minify bake's flatten earn its keep?** A child's content baked up into a
      parent tile is clipped and flattened once at the parent's tolerance and stored as
      a polygon (`TileStore._downPieces`). Kobin, 2026-09-03: test whether that is
      actually cheaper than keeping the arcs, or than smoothing the too-small-to-see
      detail to endpoints instead of computing a flattening. Nothing else in the
      drawing pipeline flattens.
- [ ] The unexplained 7,858.9 ms click handler in phone report 23-54-04: script only, no
      layout, no paint. Nothing accounts for it.
- [ ] The three bake outliers worth 11.2 s of the 20.9 s of bake time in the same report.
- [ ] Budgets in the perf suite, so the four instruments become regression detection
      rather than forensics: no bake slice over 16 ms on the reference document, no render
      over 50 ms at depth 6.
- [ ] Stress documents an order of magnitude past anything drawn by hand (R4).
- [ ] Multi-device: two tabs, two devices, offline, a mid-save close. The presence
      heartbeat exists; nothing tests what it is for (R4).

**Coverage**

- [ ] Cross-browser and cross-device UAT. One row of the matrix in `UAT.md` is filled.
      Firefox, Safari, dpr 1.0, dpr 2.0, software rendering and touch are unverified, and
      the F-Z fix works around a Chrome-specific threshold nobody has looked for elsewhere.
- [ ] CI: `test:quick` on push, `test:all` nightly. Possible since 2026-09-02, when the
      suites that read gitignored recordings learned to skip. Fix E1 first or it flakes.
- Automated visual regression is **optional**: Kobin runs the passes by hand. Proposal 5
  under Detail says what the automated version would take, if the manual pass ever
  becomes the bottleneck.

**Tests** (detail under E below)

- [x] E1 `perf.instrument` PI-6 asserts wall-clock time; make it a trace-mode assertion.
      **Already done when checked on 2026-09-07** — PI-6 asserts what gets LOGGED with
      trace on and off, and nothing about elapsed time; this line was stale.
- [x] E2 `App.slow.test.js` costs 195 s to assert one string. **Measured 2026-09-07: 26 s
      of test time, 43 s wall clock alone**; accepted and said so in the file (it mounts
      the whole module graph, and that is the one test that proves the app boots).
      `setupTests.js` also stubs jsdom's missing canvas `getContext`, which silences the
      "Not implemented" console.error two.js triggered in every suite.
- [x] E3 machine-dependent benches want a banner saying so — **2026-09-07**, on
      `fidelity.compare.slow` and `perf.bench.slow`.
- [x] E4 a `test:erase` script for the slow erase suites — **2026-09-07**: the nine
      `erase.*.slow` suites plus `fidelity.compare.slow`.
- [x] 68 unused-variable warnings left in test files after the 2026-09-02 lint pass —
      **2026-09-07: 70 found, 70 removed** (unused imports and declarations in 27 test
      files and the fixture; three of the removed declarations turned out to DRAW a stroke on
      their right-hand side — restored as bare statements after the slow suite caught one,
      the sweep log has the rule). `npm run lint` is the command; what remains is three
      `react-hooks/exhaustive-deps` warnings in product code (`useClickAway`,
      `CanvasEditor`), each a deliberate dependency list, left alone. The `*.probe.js`
      files and `__oracles__` now share the test override, which also cleared two
      rules-of-hooks errors the probes carried.

**Saving and memory at scale (2026-09-07)** — Kobin's canvas `mtqha19c7qjn`, drawn by another
Claude session: 11,497 objects across 20 frames and thirteen levels, 26 scenes. Measured in
his Chrome: IndexedDB holds 88 MB of a 10.8 GB quota (storage is NOT full — the guess was
localStorage, but local autosave left it on 2026-09-02); the JS heap is 587 MB at load and
869 MB after one report snapshot; the document serialises to 92 MB (F58); the load render
was 8 s (F59); twelve eraser marks never bake (F57); and `renderThumbs` builds a SECOND
engine and loads the whole drawing into it to draw each scene's thumbnail — on this drawing
that is a second copy of everything and the likeliest reason scenes can no longer be
updated (unmeasured: the tab locked on the eraser backlog before it could be). Options,
for Kobin's choice — none started:

- [ ] **Report:** stop shipping the whole document; header + journal + instruments + the
      frames the camera visited, and a size cap that says so. Raise the server's cap.
- [x] **Local save:** REBUILT 2026-09-08 as the kobin-2 store (DESIGN.md §13): frame
      snapshots as headers plus one Float64Array, an op log of results, snapshots rewritten
      only when their entries outgrow them, the undo/redo history saved, an interrupted
      erase resuming from its bake entries. `.claude/SAVE-FORMAT-PLAN.md` has the build.
- [x] **Cloud save:** REBUILT 2026-09-08 as option A on the kobin-2 store: the cloud copy
      mirrors the local one (frame chunks and log chunks, gzipped, 700 KiB parts, the
      manifest last), a push sends only what the cloud is missing, nothing is stringified.
      Measured 2026-09-08 on the 12,849-object canvas: a full push is 27 MB gzipped in 50
      parts, 120 s with one part a commit and one push at a time (six a commit plus the
      30 s tick's second push had Firestore refusing every batch for ten minutes).
      Storage blobs (option B) stay possible later; the manifest names each chunk. Still
      open here: the dev server pushes to the same Firestore as the deployed app (Kobin,
      2026-09-08), and the explicit Save still serialises the document once for the
      thumbnails.
- [ ] **Thumbnails:** render scenes in the LIVE engine (jump, rasterise, jump back — the
      camera restore is exact) or in a worker with only the scene's frames loaded; never a
      second copy of the document.
- [ ] **Memory:** MEASURED 2026-09-08 (`src/engine/memory.census.probe.js` on the exported
      canvas, forced GC, jsdom): 12,844 objects, all resolved shapes, 832,022 pieces (65 an
      object); the live heap after load with one scene is 721 MB. An arc piece is 344 B
      (an object plus three two-element arrays for 56 B of numbers), a line piece 192 B, a
      renderer anchor 488 B: geometry 259 MB, the 13 tiles of the view 373k derived pieces
      (~130 MB), one scene's 161k anchors 75 MB, the rest loops, records, indexes, Two.js
      paths and the DOM. The same document parsed from its flat save format is 49 MB. Each
      cloud attempt allocates a 61 MB copy and a 205 MB string before the compressor runs.
      Chrome read 1.7 GB at load and 2.5 GB after minutes: the rest is uncollected garbage
      from the sync loop and the bake. Design, in Kobin's order (`.claude/WORKLIST.md`):
      pieces in flat Float64Arrays per loop (BUILT 2026-09-08 as `geometry/loop.js`: jsdom
      721 -> 453 MB live, Chrome 660 -> 260 MB at load; 64 B a piece, 3.3 M heap objects become 16k,
      the save format already is this shape, and threading and the raster renderer both
      want flat buffers); the tile cache capped by pieces and dropped for frames the camera
      (DROPPED, built 2026-09-08 as `TileStore.framesLeft`; the cap is on hold)
      has left; undo bounded by bytes; then the per-drawing budget in the UI. Kobin,
      2026-09-08: the sync fix yes with a visible error; flat arrays agreed; evicting the
      frames left yes, the cap on hold; undo bounding no for now; the budget not yet. He
      proposes a save format of our own (partial saves, saved undo history, chunked
      compression, quick load); the working notes are in .claude/WORKLIST.md. A drawing
      session in jsdom adds ~1 MB a stroke on the render side (Two.js objects plus jsdom's
      DOM) and nothing in the engine's own structures; the Chrome figure is owed, and so
      is the tab's 4,345 `<path>` for 1,363 groups after a session (1,406 on a fresh load).
- [x] **The eraser at depth (F57):** BUILT in three parts 2026-09-08 (DESIGN.md §7 "Order,
      gate and the worker"): the targets from the spatial index top-down by z (the walk of
      every object per mark was the starvation), `RayIndex` in the boolean's classifier
      (2.6 s a cut → 175 ms), the cut as a job in `public/erase-worker.js`. Still open here:
      nothing of the bake on the main thread but the apply: the descent went to the worker
      the same night as one job per family (`eraseDescent.js`; the family stays invalid
      until the new family comes back and is swapped in). The "one cede for a flooding
      coarse object" idea is dropped at Kobin's word.
## 4. UX

The R3 scope, plus the product items that used to live in the README.

- [ ] Scenes: the panel, thumbnails, naming, splitting, and the story for what a scene IS
      to a user. The signature feature is currently a list of rows.
- [ ] The select and eraser tools, flagged 2026-07-07 as "weird": tap-select misses near a
      curve, selecting through a magnified fill grabs surprising objects, drag has no
      affordance, eraser size is hidden state.
- [ ] Phone layout. Every diagnostic report comes from a phone and the panels cover the
      canvas there. Not a polish item.
- [ ] First-run: the app says "Beta" and offers one hint toast that self-dismisses.
- [ ] Accessibility and keyboard: nothing is reachable by keyboard and the selection
      indicator is the only signal anything is selected.
- [ ] "Export SVG" exports the viewport, not the drawing.
- [ ] Pre-lattice files are refused, not converted. A test-only converter exists; a
      decision is owed about whether it becomes a product one, and what the format promise
      is from here.
- [ ] Product: AI-suggested scene names on Gemini's free tier. Blocked on S6.
- [ ] Product: rotation and measurement tools.
- [ ] **Z-order UI** (Kobin, 2026-09-07): a right-click, or a long press on a touch
      screen, on an object offers "Move to front" and "Move to back". Z-order today is
      creation order (`id`, and `z` on cut pieces, `Renderer._insertSorted`); the two
      commands need a per-object `z` the document owns, serialises and undoes, and the
      render list sorted by it. Not started.
- [ ] **"Erase only selected objects"** (Kobin, 2026-09-07): an eraser mode that touches
      the current selection and nothing under or over it. The erase pipeline already
      filters targets per stroke (`_nextEraseTarget`: z-below, reachable, ink nearby);
      the mode adds "and in the selection" and a way to choose it in the tool rail. Not
      started.
- [ ] Product: drawing on through a zoom, crossings included (Kobin, 2026-09-07, on
      closing F54: *"eventually, we'd want it to keep drawing as you zoom even past a
      level"*). Today a zoom mid-stroke finalizes the stroke; the in-level half is one
      condition in `Camera.zoomFactorAt`, the crossing half means the live stroke changing
      frames mid-gesture. The measurements are under OPEN-FLAGS F54.

## The structural lane

Kobin, 2026-09-02: these six, one piece at a time, each shipped behind the contract test
and the manual visual pass, never as a release of their own.

| id | item | size | detail |
|---|---|---|---|
| S1 | ~~**One `TileGrid` type**~~ — **done 2026-09-07** (`frameLattice.js`): `TileGrid.at(phase)` for the object's grid, `TileGrid.CACHE` for the render square, `rect`/`range` (half-open)/`span`/`touching` (closed)/`child`; `LevelMap.tileRect/tileRange`, `freeze.tileWindow/tileClipRect` and `deriveStep` go through it, and every method keeps its callers' arithmetic to the bit. F36 is closed with it. | done | A1, proposal 2 |
| S2 | ~~**A lint rule enforcing the layering**~~ — **done 2026-09-07**: `import/no-restricted-paths` in `package.json`'s `eslintConfig`, seventeen zones (`engine/*` never imports `Pages/`, `hooks/`, `cloud/`, `storage/`, `Components/` or `__oracles__`; `geometry/*` only `geometry/*` and `frameLattice`; `frameLattice` nothing; `LevelMap`/`Document`/`Camera` never `Renderer` or `TileStore`; `Pages/`, `hooks/`, `Components/` never `geometry/` directly). Proved to fire on a deliberate violation and quiet on the tree; tests, probes, the testkit and the oracles are exempt. `npm run lint` runs it. | done | proposal 3 |
| S3 | ~~**JSDoc typedefs plus `checkJs` on `src/engine/geometry` only.**~~ — **done 2026-09-07**: `geometry/types.js` (Piece with the F43 cut fields, Loop, Shape, Chain, Ring, Rect, BBox, Cells, Phase, FrameId) and `tsconfig.geometry.json` (`checkJs`, strictness off, geometry + `frameLattice.js`), run by `npm run typecheck` and by CI. 0 errors; the first run found 26, two of them real — `strokeOutline`'s documented options omitted the `scale` every caller passes, and `strokeLoops` declared a return type written as names — and the rest were annotations for the loops that carry `closed`/`area` on the array. Resolves D4 the other way: the TypeScript dependency is used now. | done | proposal 4 |
| S4 | **Renderer and CanvasEditor** are each over 1,200 lines. The raw-SVG selection overlay and the cloud/persistence effects are the natural first extractions. | medium | C2, C3 |
| S5 | ~~**The five small duplications**~~ — **done 2026-09-07**: B1 `curveOutline.loopsBbox` is `cubicLoopsBBox` (the erase oracle is its one reader); B2 one `VertexSet` (arcPerimeter's, with the boolean's floor on the quantum); B3 one `reversePiece` (arcPerimeter's, carrying `ci`, a cut line's `P`/`Q` and a cut arc's `K`; arcShape re-exports it); B4 `hittest.windingOfPoint` is `polyline.windingAt` re-exported (the arc-piece winding in arcShape is a different function and stays); B5 `derive.bboxOf` names the other two bbox paths and what each is for. | done | B1–B5 |
| S6 | **Toolchain**: React 17, CRA 4 and Node 14. Vite plus React 18 is about a day, plus the Jest-to-Vitest move across 85 suites, which is the part with real risk. Blocks AI scene names. | large | proposal 6, big item 9 |

## The register of deferred design changes

Written 2026-09-07 because Kobin asked where the deferred big changes had gone: they were
scattered over the "deliberately not built" block below, the levers under OPEN-FLAGS F39,
the bibles' left-open sections, `docs/reference/perimeter-bake-options.md` §4 and the
retired releases file. This table is their one home from now on. Each row says where the
decision is recorded, what it was, and whether the 2026-09-07 measurements on the
11,497-object canvas (F57–F59) change its standing. Nothing here is started.

| change | recorded in | the decision then | standing now |
|---|---|---|---|
| **A raster renderer** — the finished picture drawn into canvas or WebGL tiles, SVG kept for the live stroke, the selection and text | only as one lever for the ants (OPEN-FLAGS F39: "a WebGL layer — Kobin: not yet"); never a design item of its own | not yet | **due for a design.** F59: 8 s to build 882 SVG groups, 9 ms each, paid again at every crossing into an unretained scene; F39: the crawl's repaint grows with the ink on screen. Both are the cost of a DOM path per piece. Canvas tiles first (the tile is already the unit of work), WebGL only if canvas raster is not enough. **Folded in 2026-09-08 (Kobin):** the quantised bake scale and the fat outline's window chop, the two rows struck below, are SVG-path workarounds this renderer replaces; what it inherits is the list of browser limits they were built against: a filled path's features under ~0.1 units vanish (F-Z), a path whose cubics run past ~1e7 device px is dropped and anchors are float32 (F40), Skia mis-strokes above ~25k device px (`fatWidthPx`) |
| **Threading** — the bake, the erase descent and the boolean in a worker | `docs/reference/perimeter-bake-options.md` §4 ("smaller first, threading second, possibly never"), `HANDOFF-strokeShape.md`, OPEN-FLAGS F22's "Not done", the "deliberately not built" block | deferred: a worker hides work rather than removing it; the real cost is asynchrony against a mutable document; CRA 4 cannot bundle a worker from the app's modules | **the calculus has flipped.** F57: a single erase step at depth is 0.6–2.5 s and indivisible, and Chrome throttles the bake's timers in a hidden tab. The asynchrony cost is still real (versioned jobs, stale results discarded, a barrier before selection — `_flushErasesFor` is half of it). The bundling objection is solvable now without the toolchain move: a small esbuild step producing a classic worker script under `public/`, the way `cloud/lzWorker.js` already loads one  **BUILT for the cut 2026-09-08:** `eraseJob.js` + `eraseWorkerClient.js` + `public/erase-worker.js` (esbuild), one cut in flight, versioned results, the barrier synchronous; the descent followed the same night as one job per family (eraseDescent.js); the shape bake is still on the main thread |
| ~~**D1 — a piece as `{A, B, bulge}`** instead of centre and radius~~ | frame-lattice bible §0 D1, §10.4c, §10.9; Detail F1 | the last section-0 decision not built; a structural argument stands in for it | **dropped 2026-09-08, by Kobin:** "it isn't needed. The only limitation we are facing is the browser, and we're going to build around that with the GPU renderer. And, I want it to eventually be a line anyways, so that just builds an intermediate step." The renderer is centre-free already (`chordCubic`; the arc command carries a radius, and only while it is under 4.2e6 px on screen). The chop's grid solve still reads the stored centre, safe while no arc survives past level 3, which is F44's measurement |
| **Store what has been looked at** (cede coarse objects' chains to tiles that hold references) vs **version the derivation** | §2 above, the 1.0 gate; the F55 design notes ("cede on reference stays as a second step") | undecided | **still undecided, and it gates every deploy.** Stored bits survive a derivation change; derived ones do not |
| **The touching-arcs severance case** | frame-lattice bible §7.4 (D10), §10.9 | scoped, deliberately not built: tile the area and descend to decide contact | unchanged; nothing has needed it |
| **The seam antialiasing rule** | frame-lattice bible §7.5 | look at it | unchanged; look at it on a real drawing |
| **Frame garbage collection** | frame-lattice bible §7.8; Detail F6 | harmless leak | worth a number now: this canvas has 28 frames, and memory is the constraint (see "Saving and memory at scale") |
| ~~**A move finer than the object can hold**~~ | frame-lattice bible §7.6b; Detail F7 | the model handles it; the UI question untouched | **closed by F41/F55 as built (2026-09-05), unverified by Kobin.** §7.6b was written when such a move was to be refused; §6.8, his correction the same day, says it accumulates, and the offsets table now stores every drag at the camera's depth, snapped to 2^-10 of that level's unit, with no depth limit. Nothing is discarded, so the UI question has no subject. The drag's only refusals left are frame-tree gaps, journaled as `skipped` |
| ~~**Quantised bake scale**~~ — bake the nearest power of two and leave a residual transform, so path-space feature sizes stay in a known band | OPEN-FLAGS F-Z "What is still open" | the thin-scale fix pulls the lever at pre-render; the quantised bake was the fuller form | **struck 2026-09-08, folded into the raster renderer** (a raster tile is a bake at a fixed zoom shown through a residual scale, which is this design); the thin rescale stays until then |
| ~~**The fat outline's window chop**~~ | OPEN-FLAGS F40, the last piece | cubics have no exact rect clip | **struck 2026-09-08, folded into the raster renderer** (a tile's coordinates are local, which is what the chop fakes); never seen on a real drawing |
| **Incremental saves** | the R1 scope's OUT | built anyway on 2026-09-02 (F33) | done both halves 2026-09-08: the kobin-2 store's op log locally and its mirror in the cloud (DESIGN.md §13) |
| **Automated visual regression** | proposal 5 | optional; Kobin's manual pass is the gate | unchanged |
| **Stress documents and multi-device** | R4 | not started | the 11,497-object canvas IS the stress document now; F57–F59 are its findings |
| **The ants' crawl budget** | OPEN-FLAGS F39's levers; §3 row 4 | deferred by Kobin 2026-09-07 | long term; the raster renderer above would make it moot |
| **Scale bar v2** — preset ratio grid, explicit Auto control, anchor conversion, frozen bar length, the grouped unit picker | `docs/reference/scale-bar-v1-spec.md` "Deferred (v2+)", `scale-bar-design-decisions.md` | v2 | unchanged; product |
| **The toolchain** (S6) and the two big files (S4) | the structural lane | one piece at a time | S6 is what makes a native worker and a modern build possible; it moved up a notch with threading |
| **AI scene names** | §4 | blocked on S6 | unchanged |
| **Drawing through a zoom, crossings included** | §4, from F54's closure | future feature | unchanged |
| **Per-object z-order and the Z-order UI; erase only selected** | §4, 2026-09-07 | not started | new |

Read this table before proposing anything large: if it is here, the reasons it was
deferred are in the column that names them, and the question is whether the standing has
changed, not whether the idea is new.
Still open from the design documents: F4 to F8 under Detail; F1 (D1) dropped 2026-09-08, F7 closed by F41/F55. **F2 (freeze on the cede
path) closed on 2026-09-05 by F42 as built** — the cede hands the kid the tile store's piece,
freeze included, so the erase cuts what the render shows; bible 10.4c's "a cede stores exact
arcs" is the sentence that is now false. F3 closed by F41's `skipped` journal. F1 is F44's
layer 3 in arithmetic form. F8 is probably part of F29 (the mechanism is read off the code in
OPEN-FLAGS F29's sweep note). After any change that adds or removes a function, rebuild the
reference pages: the 2026-09-05 fixes added `Camera` nothing, `erasePipeline._removedArea`,
`_unwindSteps` and `arcShape.segmentTerm`.

Housekeeping (2026-09-07): D2, the reports folder inside the tree, is **dropped** — Kobin,
asked, left it where it is (gitignored, and every replay test finds it); D4 resolved the
other way, the TypeScript dependency runs S3's `npm run typecheck`; D5 done, the timing
dump lives in `tools/.cache/` (gitignored). Still owed: after any change that adds or
removes a function, rebuild and republish the four reference pages
(`tools/docmaps/README.md`). `verify_coverage.py` on 2026-09-07 lists the autosave rework's
functions and the 2026-09-03..07 engine work as gaps; `audit_stale.py` reports 0 stale
names. The rebuild wants their descriptions written, an afternoon.

**Deliberately not built** (moved here from `docs/ai/10-STATUS.txt` on 2026-09-02):

```text
WHAT IS DELIBERATELY NOT BUILT
    - D1 from the frame-lattice bible (DROPPED 2026-09-08 by Kobin; the
      register has his reasons): a piece is still {C, r, a0, sweep, A, B}
      rather than {A, B, bulge}. The freeze TEST never touches the centre, and a
      line is never chopped, so an arc is only ever chopped at shallow depths -
      but that is a structural argument standing in for a representation change.
      It is the last decision from section 0 outstanding, and F34's root cause is
      exactly the class of failure it would have prevented.
    - The touching-arcs severance case (frame-lattice bible §7.4). Scoped,
      understood, agreed not to build.
    - The seam antialiasing rule (§7.5). A look-at-it question, nothing measured.
    - Frame garbage collection. Abandoned cells are re-findable now, so the leak
      is harmless, but nothing collects them.
    - Threading. The bake is small enough that a worker buys little; the real
      cost is asynchrony against a mutable document.
```

## What not to put on this list

Carried from `60-RECOMMENDATIONS.txt`: what is already good and must not be refactored
away by accident, and what an organisation would do that is not worth copying here.

```text
FIRST, WHAT IS ALREADY GOOD - so none of it gets refactored away by accident

    THE LAYERING IS REAL AND IT HOLDS. frameLattice knows nothing but integers.
    arcShape and arcPerimeter know geometry and no engine. derive and freeze know
    one crossing. LevelMap knows frames and no objects. Document knows objects and
    no camera. Renderer is the only thing that has ever heard of Two.js. That
    discipline is why the arc pipeline could replace the cubic one at all, and it
    is worth more than anything below.

    THE COMMENTS ARE AN ASSET, NOT NOISE. They record measurements, wrong turns,
    and things that were ruled out. "Measured on a 4.1 MB document: ~960 ms of
    blocked main thread every 4 s" does not decay. Do not "clean them up".

    THE DESIGN BIBLES ARE ARCHITECTURE DECISION RECORDS, and better ones than most
    teams write - reasoning first, then a section recording where building it
    changed the design, then a conformance table checked line by line against what
    the owner actually said. Keep the format.

    THE REPORT PIPELINE IS THE BEST DIAGNOSTIC ASSET HERE. A phone posts its whole
    state to the dev box, and it turned out every one of those snapshots is a
    LOADABLE DRAWING. That is how F34 was pinned. Invest in it rather than around
    it.

    NOT WORTH COPYING

    Code review, RFCs, sprint ceremony, coverage targets. There is one developer.
    The bibles already do what an RFC does, and better. Coverage is a bad target
    for this codebase in particular: the tests that matter here assert on
    measured geometry, and a coverage number would reward the ones that do not.
```

## Detail

Verbatim from the three retired files, so every measurement and argument survives. Item
ids (A1, B1…, C2, D2…, E1…, F1…) are what the plan above refers to. Items marked
DONE in place are done; the ledger has the record. Where a block says "see
50-TODO A1" or "see 60-RECOMMENDATIONS 1", it means the matching section on this
page; the files no longer exist.

### Backlog items A–G (was `docs/ai/50-TODO.txt`)

```text
--------------------------------------------------------------------------------
A. THE ITEM KOBIN NAMED - one vocabulary for the three partitions
--------------------------------------------------------------------------------

A1  THREE THINGS ARE ALL CALLED A TILE AND THEY ARE DIFFERENT.            medium
    - the FRAME lattice cell            LevelMap, frameLattice cellOf/cellEdge
    - the OBJECT's tile grid            frameLattice objTileRect/objTileRange/
                                        objTilesRect + freeze.js, phased per object
    - the RENDER CACHE square           LevelMap tileRect/tileRange/makeGrid
    All three are W = 131,072 units across. The first two are load-bearing and
    genuinely different (a frame belongs to space, a tile belongs to the object);
    the third is only a work-unit. But they are three near-identical APIs with
    different phase conventions, and the confusion has already cost: the first
    version of the chop clipped to the cache square, which is not a tile
    boundary, so two neighbouring squares froze one arc to two different chords.

    They cannot be merged - the design is explicit about why. What they should
    share is a TYPE. One `TileGrid { phase, rect(i,j), range(rect), span(cells) }`
    value object, constructed as `TileGrid.forObject(o)` or `TileGrid.cache()`
    (phase 0). Then "which grid is this rect on" is answerable from the value
    rather than from which module the function came out of, and the half-open
    convention that took a level-1 render from 49 ms to 258 ms lives in one place.

--------------------------------------------------------------------------------
B. DUPLICATION - the same idea implemented more than once
--------------------------------------------------------------------------------

B1  loopsBBox (arcShape) and loopsBbox (curveOutline).                     small
    Two exported functions differing only in the case of one letter, taking
    different shapes (arc loops vs cubic loops). This is a trap with a fuse on
    it. Rename the cubic one to `cubicLoopsBBox`.

B2  VertexSet is implemented twice.                                        small
    arcShape.js and arcPerimeter.js carry near-identical copies (shared vertex
    identity by position, neighbouring cells searched). They differ only in the
    floor on the quantum. One implementation, one parameter.

B3  reversePiece/reverseLoop exist in both arcShape and arcPerimeter.       small
    arcShape's carries the freeze's seam marks; arcPerimeter's does not,
    deliberately, because a chain being resolved has none yet. That is a real
    distinction and it should be a comment on ONE function, not two functions.

B4  Three winding implementations.                                        small
    hittest.windingOfPoint (rings), polyline.windingAt (rings, exported to
    clipperBoolean in the 2026-08-31 split),
    arcShape.windingOfFlat (arc pieces). The first two are the same function.

B5  Three bbox paths: derive.bboxOf (cached on the object), arcShape.loopsBBox
    (exact, arcs included), Document._bboxNow (uncached).                  small
    Not wrong - they answer different questions - but nothing says so anywhere.
    One comment in derive.bboxOf naming the other two would do it.

B6  CanvasV2 duplicates the entire engine lifecycle.          [DONE 2026-08-31]
    DELETED, which was the second option below. Mount, pointer input, pinch,
    wheel, resize, keyboard, autosave and the report payload existed twice, and
    the autosave switch had had to be exported and imported specifically so the
    two could not drift (F33). Nothing linked to it and CanvasEditor?dev exposes
    the same panel.

--------------------------------------------------------------------------------
C. STRUCTURE - files that are doing too much
--------------------------------------------------------------------------------

C1  KobinEngine.js is 3,506 lines and 162 methods.           [DONE 2026-08-31]
    855 lines now. See the pass record at the top of this file. The rest of this
    item is left as written, because the analysis of what the file owns is what
    the split followed.

    It is described as "the public facade... it holds NO geometry or z-order
    logic of its own", and that has not been true for a long time. It owns:
    input routing, the pen, the bake scheduler, the whole erase pipeline,
    severance, selection and the lasso tree-walk, the drag, scenes, the
    selection-indicator geometry, the erase-debug overlay geometry, and four
    instrument classes. See 60-RECOMMENDATIONS.txt for the split.

C2  Renderer.js is 1,577 lines and mixes four jobs.                         medium
    Two.js scene management, the signature diff, the F-Z thin rescale, and a
    raw-SVG selection overlay that injects its own stylesheet. The overlay in
    particular is self-contained and could be its own file tomorrow.

C3  CanvasEditor.js is 1,290 lines.                                        medium
    Tool rail, scenes panel, scale HUD, six dialogs, three banners, the save
    pipeline, the cloud pull, the presence heartbeat and the draft-on-unload
    handler. The cloud/persistence effects are the natural first extraction -
    they are four useEffects and three async functions with no JSX between them.

--------------------------------------------------------------------------------
D. HYGIENE - cheap, and two of them are real risks
--------------------------------------------------------------------------------

D1  public/ IS 9.1 MB AND EVERY BYTE OF IT SHIPS.           [DONE 2026-09-02]
    CRA copies public/ into build/ verbatim, and build/ is what is deployed.
    Right now public/ holds:
      recovered/   8.2 MB   a rescued report and debug JSON
      shots/       350 KB   debug SVG dumps
      __f35/       288 KB   F35 renders and a comparison page (gitignored)
      hairline/     20 KB   the F-Z live-DOM harnesses
      arcbake-stroke.json, arcbake-stroke2.json  172 KB  lab fixtures
    DEMONSTRATED 2026-08-28: a plain `npm run build` took build/ from 6.5 MB to
    17 MB, copying recovered/, shots/, hairline/ and __f35/ verbatim. The debug
    copies were removed from build/ again immediately, and the build that was
    on disk before (dated 7 August) contained none of them - so on the evidence
    here nothing has shipped yet. But any build does this, and
    `firebase deploy --only hosting` publishes build/.
    Move everything but the lab fixtures out of public/, or gate the deploy.
    DONE 2026-09-02, see the block at the top of this file. The lab fixtures
    went too - the labs are gone and __fixtures__ holds identical copies.

D2  .kobin-reports/ is 153 MB inside the working tree.                     small
    Gitignored, so it is not in history, but it is 97% of what a naive tool sees
    when it looks at this repository - and one file in it is 16 MB. Move it
    outside the tree (the report server takes a path) and keep the last N.

D3  There is no CLAUDE.md or AGENTS.md at the repo root.    [DONE 2026-08-31]
    Everything an agent needs to know is now in docs/ai/, but nothing points at
    it from where a tool looks first. A ten-line CLAUDE.md that says "read
    docs/ai/00-START-HERE.txt" and lists the three rules that are easiest to
    break would pay for itself immediately.
    DONE 2026-08-31: CLAUDE.md at the root says exactly that, in 58 lines.

D4  typescript is a dependency and there is no TypeScript.                 small
    tsconfig.json has strict: true and the only .ts file is CRA's generated
    react-app-env.d.ts. Either drop the dependency and the config, or commit to
    type-checking the geometry (see 60-RECOMMENDATIONS.txt).

D5  .jest-times.json (288 KB) sits at the repo root.                       small
    A one-off timing dump, gitignored. Move it under a tools/ or .cache/ path.

D6  docs/scale-bar-design-options/ is 22 files and ~300 KB.   [DONE 2026-08-31]
    Moved to docs/reference/ along with everything else of its kind. Kept in
    git; the point was that it read as current while sitting beside the four
    live documents, not that it was worth less than it is.

--------------------------------------------------------------------------------
E. TESTS
--------------------------------------------------------------------------------

E1  perf.instrument.test.js PI-6 asserts wall-clock time.                  small
    "40 zooms each finish in under 8 ms" is a claim about the machine. It goes
    red whenever the box is loaded and passes 21/21 alone. Replace it with a
    trace-mode assertion about what got LOGGED, which is what it is really
    trying to say.

E2  App.slow.test.js takes 195 seconds to assert one string.               small
    A nine-line smoke test that mounts the whole app, including Two.js in jsdom.
    It is the single most expensive test in the suite by a wide margin. Either
    accept that and say so in the file, or mock the engine.

E3  fidelity.compare.slow.test.js and the perf benches are machine-dependent
    in the same way as E1. Worth an explicit "these measure this box" banner.

E4  The erase suites are the slowest thing here: deepsever 139 s, fidelity
    121 s, matrix 96 s, layered 58 s, fuzz 58 s. That is fine for a nightly and
    painful for an inner loop. A `test:erase` script would help.

--------------------------------------------------------------------------------
F. LEFT OPEN BY THE DESIGN DOCUMENTS
--------------------------------------------------------------------------------

F1  D1: a piece should be {A, B, bulge}, not {C, r, a0, sweep, A, B}.      large
    [DROPPED 2026-09-08 by Kobin - the register has his reasons.]
    The last decision from frame-lattice bible section 0 that is not built. The
    freeze TEST is already bulge-only, but chopping an arc at a grid line reads
    C and r, and F34's root cause was exactly a centre-and-radius computation
    losing everything to cancellation. Doing this would make a whole class of
    failure unreachable rather than fixed. It touches every geometry module.

F2  Freeze on the cede path.                                             medium
    Kobin, 2026-08-26, and he is right: "Once a curve turns to a line, that is
    the truth from that point downward." The freeze is wired into the render
    chain only, so the erase consults geometry the design says no longer exists.
    This is the design-correct repair for F34 and would also explain the
    leftover assembly failure at radii above 1e10.

F3  Instrument the three silent `continue`s in _dragSelection.             small
    Each drops one member of a drag while every other member moves on, and
    nothing logs any of them. Record {id, level, why} against the gesture the
    way _rehomeBail already does for the erase. This is the cheapest possible
    step on F35 and it makes the next report self-explaining.

F4  Record the weld radius and whether the retries ran in _noteSeal.       small
    It computes a dozen diagnostic fields and keeps three. F34's investigation
    needed exactly the two it drops.

F5  The seam antialiasing rule (bible 7.5). A look-at-it question.         small

F6  Frame garbage collection (bible 7.8). Abandoned cells are re-findable
    now, so the leak is harmless, but nothing collects them.               small

F7  A move finer than the object can hold (bible 7.6b). The model handles
    it; the UI shows a drag doing something the model discards.            small
    [CLOSED 2026-09-08: F41/F55 store every drag at the camera's depth, so
    nothing is discarded and the UI question has no subject.]

F8  fadeTag measures the bbox DIAGONAL while the cull is about ink WIDTH.  medium
    Noted inside F-Z and deliberately not fixed there: projectedSizePx returns
    hypot(w,h) + lwFrame, so a long thin stroke tags 1,049 px while its ink is
    0.84 px - a factor of 1,247. It is a real inconsistency, it is probably
    part of F29, and Kobin's objection stands: culling on ink width alone would
    hide an object that still covers half the screen.

--------------------------------------------------------------------------------
G. THE CLEANUP BACKLOG FROM OPEN-FLAGS (X1-X4), RESTATED
--------------------------------------------------------------------------------

G1  RESOLVED 2026-08-31, though not as written. geometry/erase.js MOVED to
    src/engine/__oracles__/erase.js rather than being deleted: the suite that
    reaches it carries 26 passing assertions, this item said to port them rather
    than drop them, and porting an oracle into the code it checks is not
    porting. It costs nothing to keep - webpack never bundles it.

G2  RESOLVED 2026-08-31, and the answer was NO. The premise was wrong:
    strokeOutline is not unreachable. Renderer._fatPolys calls it under
    outlineMode, and derive.bandRings calls it under legacyOffset, which is the
    branch geometry/derive.test.js walks to golden-compare against V0. The one
    decision this waited on - is KobinEngineV0 still wanted as an oracle - was
    answered YES, so clipper-lib stays in package.json and X2/X3/X4 stay open.

    What was done instead, and it is most of what they were after:
    geometry/clipperOutline.js split into polyline.js (465 lines, pure float64,
    no coordinate ceiling, the whole hot path) and clipperBoolean.js (219 lines,
    the three functions on Clipper's integer lattice, with every remaining
    caller named in its header). The dependency is one-way and stated in both
    files. A grep for clipperBoolean is now a complete answer to "where is
    Clipper still reached": six files, three of them tests.
```

### Architecture and process proposals 2–8 (was `docs/ai/60-RECOMMENDATIONS.txt`)

Proposal 1, the engine split, is done and sits in the ledger. Proposal 5 was corrected on
2026-09-02: visual regression is checked by hand and automating it is optional.

```text
--------------------------------------------------------------------------------
2. GIVE THE THREE PARTITIONS ONE TYPE
--------------------------------------------------------------------------------

    See 50-TODO A1. A `TileGrid` value object with an explicit phase, constructed
    as `TileGrid.forObject(o)` or `TileGrid.cache()`. The half-open range
    convention - the one whose absence took a level-1 render from 49 ms to 258 ms
    - then lives in exactly one method instead of being a property of whichever
    module you happened to call.

--------------------------------------------------------------------------------
3. ENFORCE THE LAYERING WITH A LINT RULE, NOT A CONVENTION
--------------------------------------------------------------------------------

    The layers exist and are respected. Nothing enforces them, so the first
    violation will be silent. eslint-plugin-import's no-restricted-paths, in
    package.json's eslintConfig, is about twenty lines:

      frameLattice        may import nothing
      geometry/*          may import frameLattice and geometry/*
      LevelMap, Document, Camera   may import geometry/*, not each other's
                                   internals, and never Renderer or TileStore
      TileStore, Renderer          may import the above
      KobinEngine                  may import all of engine/
      hooks/, Pages/               may import engine/ but never geometry/ directly
      engine/*                     may NEVER import from Pages/, hooks/, cloud/,
                                   storage/

    The last line is the valuable one: it is what keeps the engine testable in
    jsdom without a browser, and it currently holds by luck.

--------------------------------------------------------------------------------
4. TYPES, BUT ONLY WHERE THEY PAY
--------------------------------------------------------------------------------

    Do not migrate to TypeScript. It is a solo codebase with a large suite and a
    2021 toolchain, and the migration would cost weeks for a payoff the tests
    mostly already provide.

    DO write JSDoc typedefs for the geometry vocabulary and turn on checkJs for
    src/engine/geometry only. There are perhaps eight types and they are the ones
    that get confused:

      @typedef Piece    {line:true, A, B} | {line:false, C, r, a0, sweep, A, B}
      @typedef Loop     Piece[]   - closed: last.B === first.A, bit for bit
      @typedef Shape    Loop[]    - normalized so solid area is positive
      @typedef Ring     [x,y][]   - a polygon, NOT a Loop
      @typedef Rect     {left, top, right, bottom}
      @typedef BBox     {x0, y0, x1, y1}      <- two rectangle shapes, both live
      @typedef FrameId  string
      @typedef Phase    [px, py] in [0, W)

    Rect versus BBox alone is worth it: both are in the engine, both are four
    numbers, and asRect() exists in connect.js precisely because they get mixed
    up. tsconfig.json already has allowJs and noEmit; this is a checkJs flag and
    a handful of comment blocks, and it is reversible.

--------------------------------------------------------------------------------
5. VISUAL REGRESSION - CHECKED BY HAND; AUTOMATING IT IS OPTIONAL
--------------------------------------------------------------------------------

    CORRECTED 2026-09-02. This section used to call an automated pixel-diff gate
    "the single biggest structural gap". It is not a gap. Kobin runs visual
    regression passes himself, by hand, in a real browser, and that pass IS the
    gate the standing rule "a green suite is not evidence" leans on. Rule 3 in
    00-START-HERE - measure paint in a real browser, never by rasterising the
    SVG to a canvas - is the method. Do not list "no visual regression" as a
    todo again.

    What is still true, and is why the manual pass has to exist:

    Every defect that mattered in the last two months was invisible to the
    geometric oracle and visible only in a browser: the tile-seam hairline, the
    thin-stroke vanish (F-Z), the fat-stroke hourglass, the dashed-bbox stall.
    The handoff document says it outright - "none of them is visible to a
    geometric oracle, because they only exist at rasterization".

    IF the manual pass ever becomes the bottleneck - a UX refresh that touches
    the renderer every day, or a second contributor who cannot borrow Kobin's
    eyes - the infrastructure for automating it is nearly there already:
      - every recorded report is a loadable drawing;
      - the app can rasterize its own SVG from the page;
      - src/engine/f35.render.test.js already loads a snapshot and writes SVG.

    What would be missing is only the comparison. Playwright, six to ten fixture
    drawings chosen to cover the known failure shapes (a thin long stroke, a
    tile seam inside solid ink, a fat stroke with an inside corner, a deep cede
    chain, a selection at depth, a scribble), a zoom sweep over each, and a
    pixel diff against committed baselines. Perhaps two days of work.

    What it would buy is repetition, not judgement: the same pass on every push,
    and on browsers Kobin does not have in front of him. That is an option to
    take up when the cost of the manual pass says so, not an obligation.

--------------------------------------------------------------------------------
6. WHAT AN ORG WOULD DO THAT IS WORTH COPYING HERE, AND WHAT IS NOT
--------------------------------------------------------------------------------

    WORTH COPYING

    CI on push. One GitHub Action running test:quick, and test:all nightly. Not
    for the process - for the fact that a local run gets interrupted and a remote
    one does not, and that "62 of 63 suites passed and the 63rd hung for three
    hours" is a thing that has already happened here.

    A DEFINITION OF DONE that includes the documents. It already exists
    informally and is followed unusually well; write it down (90-MAINTENANCE has
    a version) so it survives a bad week.

    A DEPENDENCY FLOOR. react-scripts 4.0.2 and React 17 are from 2021, Node 14
    is EOL, and the README already names this as what blocks the AI scene-naming
    feature. Moving to Vite plus React 18 is roughly a day: an index.html move,
    a config file, import.meta.env for the two env vars, and jest to vitest
    (which is the only part with real risk, given 84 suites). It unblocks the
    roadmap, halves the dev-server start time, and stops the toolchain being a
    reason not to do things.

    ERROR BUDGETS ON THE THINGS THAT ALREADY HAVE INSTRUMENTS. The engine
    measures frame gaps, long frames, input latency and heap growth. Nothing
    asserts on them. Two or three budgets in the perf suite - "no bake slice over
    16 ms on the reference document", "no render over 50 ms at depth 6" - would
    convert existing instruments into regression detection for free.

    NOT WORTH COPYING

    Code review, RFCs, sprint ceremony, coverage targets. There is one developer.
    The bibles already do what an RFC does, and better. Coverage is a bad target
    for this codebase in particular: the tests that matter here assert on
    measured geometry, and a coverage number would reward the ones that do not.

--------------------------------------------------------------------------------
7. FILE STRUCTURE                                    [PARTLY DONE 2026-08-31]
--------------------------------------------------------------------------------

    The oracle directory was the part with immediate value and it is done:
    src/engine/__oracles__/ now holds KobinEngineV0, curvePerimeter, strokeShape,
    bakeStrategies, cede and erase, with their suites and a README, and nothing
    in src/ outside the tests imports any of it - confirmed against the build's
    own source maps, which list 0 of those modules. src/engine/__testkit__/ took
    scaleBar/testSupport.js for the same reason.

    The core/ render/ edit/ scenes/ scale/ grouping below was NOT done. The
    engine split made it less pressing: the file names now say what each one is,
    and moving twelve more files would have meant another 60 import rewrites for
    a second-order gain. It remains a reasonable thing to do.

    src/engine/ is 12 files plus two subdirectories, and the 12 are a mix of
    layers. If the KobinEngine split happens, group at the same time:

      engine/
        core/       Document, LevelMap, Camera, frameLattice, persist
        render/     Renderer, TileStore, and the selection overlay
        edit/       the erase, severance, selection and move services
        geometry/   unchanged
        scenes/     scenes.js and the scene service
        scale/      the current scaleBar/
        oracle/     KobinEngineV0, bakeStrategies, curvePerimeter, strokeShape,
                    cede - everything marked [TEST]/[ORACLE], in one place where
                    it cannot be mistaken for product

    That last directory is the one with immediate value even without the split:
    about 4,100 lines of non-product code currently sit alongside the engine
    (KobinEngineV0 1,152, curvePerimeter 1,409, strokeShape 680, bakeStrategies
    520, cede 377), and moving them makes "what actually runs" answerable by
    looking at the tree.
        [DONE - it is src/engine/__oracles__/.]

    Rename src/Components/toolButton.js to ToolButton.js while touching it - it
    is the only lowercase component file and it exports a lowercase component.
        [MOOT - deleted 2026-08-31 with CanvasV2, its only consumer, and with it
        the last import of @material-ui, which came out of package.json.]

--------------------------------------------------------------------------------
8. THE PRODUCT RISK THAT IS NOT AN ENGINE PROBLEM
--------------------------------------------------------------------------------

    Persistence is the thing most likely to lose a user's work, and it is
    currently OFF because it was making the app unusable (F33).

    localStorage is the wrong home for these documents and the measurements say
    so plainly: a 16-million-character document, 97% of a 6.8-second save spent
    inside LZString on the main thread, against a 5 MB per-origin cap shared with
    every other canvas and 251 thumbnail keys.

    The shape of the answer:
      - IndexedDB for the document. No 5 MB cap, and it stores structured data,
        so the JSON.stringify and the compression both go away.
      - A worker if compression is still wanted for the cloud payload.
      - Thumbnails evicted by an LRU with a hard budget, and regenerated on
        demand - they are derived data and should never compete with documents.
      - Incremental saves last, if still needed. It is the biggest change and
        the other three may make it unnecessary.

    Do this before the UX refresh. An editor that cannot save is not improved by
    a better tool rail.
```

### Release scopes R1–R4, the lane, and the big items (was `docs/ai/70-RELEASES.txt`)

The 2026-08-28 proposal. Kobin's order above supersedes its sequencing; its scopes stand
and are what phases 1, 3 and 4 point at.

```text
THE SHAPE OF THE ARGUMENT

    There are four candidate streams of work - persistence, a UX refresh, stress
    testing, and a structural refactor - and they are not equally urgent, do not
    have equal risk, and two of them are blocked by something that is not on the
    list at all.

    The ordering below comes from one principle: DO NOT BUILD ON TOP OF SOMETHING
    THAT CANNOT SAVE, AND DO NOT REDESIGN A SURFACE YOU CANNOT REGRESSION-TEST.
    Everything else follows.

    A structural refactor is deliberately NOT a release. It is a lane that runs
    underneath the others, one piece at a time, never blocking a ship date. The
    thing that makes that safe is the same thing R2 delivers.

--------------------------------------------------------------------------------
R1 - "IT SAVES"          the next deploy. 1-2 weeks.
--------------------------------------------------------------------------------

    WHY FIRST. Local autosave is currently OFF because it was freezing the app
    for 5-7 seconds every ten seconds. Before that it failed silently for eleven
    minutes and a drawing had to be rescued out of the live page by hand. A
    signed-in user with a full localStorage had no working save path of any kind.
    Nothing else on the list matters more than this and nothing built on top of
    it is safe until it is done.

    IN
      - Move the document off localStorage. IndexedDB has no 5 MB cap and takes
        structured data, so both the JSON.stringify and the LZString pass go
        away - and the compression was 97% of the cost of a 6.8-second save.
      - Bound the thumbnails. 1.54 MB across 251 keys, unevictable, competing
        with documents for the same 5 MB. They are derived data; an LRU with a
        hard budget and regeneration on demand.
      - Turn LOCAL_AUTOSAVE back on and delete the standing banner. Keep the
        failure banner - it is the thing that was missing for a month.
      - Keep the cloud path exactly as it is. It works, it is chunked, and the
        parent-written-last ordering is right.
      - The save-status surface: the bar exists now, but "Saved to your account"
        / "Saved here - cloud sync failed" / "storage is full" should be one
        honest state machine rather than three toasts.

    OUT
      - Incremental saves. It is the biggest change of the four and the other
        three may make it unnecessary. Measure again afterwards.

    DONE WHEN
      A 16-million-character document autosaves without a frame over 50 ms, on
      the phone, measured through the existing instruments.

--------------------------------------------------------------------------------
R2 - "IT IS PROVABLY RIGHT"      2-3 weeks. The unlock for everything after it.
--------------------------------------------------------------------------------

    WHY SECOND, AND WHY IT IS THE ITEM MOST LIKELY TO BE SKIPPED. Every defect
    that mattered this quarter was invisible to the test suite and visible only
    in a browser. The standing rule in this repository is "a green suite is not
    evidence" - and the gate between "the geometry is arithmetically correct"
    and "it looks right" is Kobin's own visual regression pass, by hand, in a
    real browser. That is a working gate, not a missing one (corrected
    2026-09-02); it is what caught the green refactor that was reverted as
    worse. What R2 adds is the coverage one person on one machine cannot give.

    IN
      - AUTOMATED VISUAL REGRESSION, OPTIONAL. Kobin already runs these passes
        by hand (2026-09-02). A Playwright pixel-diff version is worth building
        only if the manual pass becomes the bottleneck; 60-RECOMMENDATIONS
        section 5 records what it would take.
      - CROSS-BROWSER UAT. docs/UAT.md has an environment matrix with one row
        filled in. Firefox, Safari, dpr 1.0, dpr 2.0, software rendering and
        touch are ALL unverified. The thin-stroke fix (F-Z) works around a
        Chrome-specific compositing threshold nobody has looked for elsewhere.
      - CLOSE THE OPEN GEOMETRY FLAGS, in a browser and not only in jest:
        F35, F32. (F34, F29 and F30 closed by decision on 2026-09-07 after the
        Chrome reproduction pass.)
      - CI: test:quick on push, test:all nightly.

    DONE WHEN
      A change has been judged on more than one browser and one machine, and
      the open geometry flags have been closed in a browser, not only in jest.

--------------------------------------------------------------------------------
R3 - "IT IS PLEASANT"      the UX refresh. 3-4 weeks.
--------------------------------------------------------------------------------

    Scenes, and the editor shell around them. This is where the product gets
    better rather than more correct, and R2 is what makes it safe: a UX pass
    touches the renderer, the overlays and the layout, which is exactly the
    surface with no automated proof.

    IN
      - Scenes: the panel, the thumbnails, naming, splitting, and the story for
        what a scene IS to a user. This is the signature feature and it is
        currently a list of rows.
      - The select and eraser tools. Flagged 2026-07-07 as "weird and need to be
        made more user friendly" and never done: tap-select misses near a curve,
        selecting through a magnified fill grabs surprising objects, drag has no
        affordance, eraser size is hidden state.
      - PHONE LAYOUT. Every diagnostic report comes from a phone, and the editor
        panels cover the canvas there. This is not a polish item.
      - First-run: the app says "Beta" and offers one hint toast that
        self-dismisses after 15 seconds.

--------------------------------------------------------------------------------
R4 - "IT HOLDS UP"      stress and scale. 2 weeks, and partly continuous.
--------------------------------------------------------------------------------

    IN
      - Generated documents an order of magnitude past anything drawn by hand:
        100k objects, 20 levels deep, 50 scenes, and the same again with one
        pathological object (the 1.8-million-vertex fill already in a recording).
      - The unexplained items, with instruments already in place: the 7,858 ms
        click handler, the three bake outliers worth 11.2 s of 20.9 s.
      - Budgets in the perf suite, so the instruments become regression
        detection rather than forensics.
      - Multi-device: two tabs, two devices, offline, and a mid-save close. The
        presence heartbeat exists; nothing tests what it is for.

--------------------------------------------------------------------------------
THE LANE THAT RUNS UNDERNEATH: the structural work
--------------------------------------------------------------------------------

    Not a release, because it has no user-visible outcome and no ship date, and
    because doing it as one is how a codebase gets a three-month rewrite nobody
    can review. One piece per week, each shipped behind the existing contract
    test, in this order (see 60-RECOMMENDATIONS 1):

      1. Diagnostics out of KobinEngine          ~600 lines, no state, no risk
      2. SelectionIndicator out                  ~350 lines, pure geometry
      3. The oracle/ directory                   moves ~4,100 non-product lines
      4. The layering lint rule                  makes the boundary real
      5. TileGrid, the one type for three grids
      6. SelectionService, SceneService, BakeScheduler
      7. EraseService LAST, and only after its flags are closed

--------------------------------------------------------------------------------
THE BIG ITEMS THAT ARE EASY TO FORGET - the answer to "I think I'm forgetting
something"
--------------------------------------------------------------------------------

    1. CROSS-BROWSER AND CROSS-DEVICE IS ENTIRELY UNVERIFIED. One machine,
       Chrome 151, dpr 1.5. Firefox and Safari have never run this. That is a
       shipping fact, not a testing chore, and it belongs in R2.

    2. [CORRECTED 2026-09-02] VISUAL REGRESSION IS DONE, BY HAND. This item
       used to say there was none. Kobin runs the passes himself in a real
       browser; the automated version is optional and is described in
       60-RECOMMENDATIONS section 5.

    3. "EXPORT SVG" EXPORTS THE VIEWPORT, NOT THE DRAWING. exportSvg clones the
       live <svg>, which is one level's rendered subtree at the current zoom.
       For a product whose whole premise is that the drawing is bigger than any
       view, that is a real gap and probably a surprise to anyone who uses it.

    4. PRE-LATTICE FILES ARE REFUSED, NOT CONVERTED. That was the right call at
       the time and it was Kobin's own ("I haven't saved anything I need to
       keep"). It stops being right the moment anyone else has. There is a
       TEST-ONLY converter that works; a decision is owed about whether it ever
       becomes a product one, and about what the format promise is from here.

    5. [RESOLVED 2026-08-31] THE DEV ROUTES WERE UNGUARDED IN PRODUCTION.
       /#/bakelab, /#/arcpen, /#/arcbake and /#/v2 were routed unconditionally
       and live on the deployed site, and /#/v2 carried a second, older
       autosave path writing to the same origin quota. All four were deleted
       with their pages; ?dev on a canvas URL is the only dev surface left.

    6. [RESOLVED 2026-09-02] public/ WAS 9.1 MB AND ALL OF IT SHIPPED ON EVERY
       BUILD. 8.2 MB of it was recovered debug data, and a build on 2026-08-28
       copied all of it into build/ (6.5 MB -> 17 MB). Everything that is not
       the app shell has left public/; see 50-TODO D1 for where it went.

    7. [CORRECTED 2026-09-02 - Kobin: the drift is the MOVE path's, and the
       undo/redo between the two reports was only how it was observed. It is
       part of F35, not an undo bug.]
       UNDO IS NOT EXACT, AND THAT IS A CORRECTNESS BUG, NOT A UX ONE. From the
       F35 measurements: an object moved 0.143 units in its own frame across an
       undo/redo with no gesture in between. The undo stack is also capped at
       200 ops and cleared on load.

    8. ACCESSIBILITY AND KEYBOARD have had no pass at all. Delete/Backspace is
       bound globally on window, the canvas is not reachable by keyboard, and
       the selection indicator is the only signal that anything is selected.

    9. THE TOOLCHAIN IS THE BLOCKER FOR THE STATED ROADMAP. React 17,
       react-scripts 4.0.2 and Node 14. The README's own roadmap item -
       AI-suggested scene names - is blocked on it. A Vite migration is about a
       day, plus the jest-to-vitest move across 84 suites, and it unblocks that
       and everything else that wants a modern dependency.

    10. [RESOLVED 2026-09-01] NOTHING WAS COMMITTED. The entire state - the
        autosave switch, the save bar, the F34 fix, seven new test files and
        the cleanup pass - sat uncommitted on arc-pipeline for a quarter. It is
        f6f1062 now. main is two commits behind arc-pipeline and has nothing
        of its own, so bringing it up is a fast-forward; nothing has been
        pushed since.
```

## Ledger — done

Newest first. Recorded so nothing is re-investigated. Each block is the text that used to
sit at the top of `50-TODO.txt`, unchanged.

### 2026-09-08

    The eraser, evening (Kobin: threading first, then the gate, then the
    bake's cost; four design answers recorded in .claude/ERASE-WORKER-PLAN.md):
    the probe on his export showed the four "stuck" marks were starved by a
    scan of every object per mark (0.6 ms each) and then slow because the
    boolean's classifier was quadratic (a 641-piece object under a
    1,205-piece eraser perimeter: 2.6 s a cut, twice). Built: candidates from
    the spatial index top-down by z; the mark's z stepping below what it has
    handled (Document.setZById, a put in the log); refused targets done and
    refused marks consumed; one cut as a job (eraseJob.js) in a worker
    (public/erase-worker.js, esbuild), results versioned and applied on the
    main thread, the barrier synchronous; the rehome's boolean through the
    same job; RayIndex in the boolean (2,630 → 175 ms a cut, results
    identical). Seen in Chrome on a scratch engine: cuts 10-16 ms in the
    worker, applied in ~1 ms. Memory the same evening: retained scenes bounded
    by anchors (250k inactive), the thumbnail engine's Two instance released
    on destroy, one cloud push at a time with one part a commit.

    Flat loops (WORKLIST memory step 2; Kobin: "go ahead and do the flat
    in-memory arrays now"): a stored loop is one Float64Array in the
    snapshot grammar plus a record index (geometry/loop.js); a piece read
    is a transient view, builders are unchanged, the storage boundaries
    (Document, TileStore) flatten, a kobin-2 frame is wrapped without a
    copy. Measured after: jsdom census 453 MB live (was 721), geometry
    51 MB counted (was 259 estimated), the view's tiles 14 MB (was ~130);
    Chrome, the 12,849-object canvas, 260 MB at load (was 660, 396 after
    a collection). Quick 77/1034, slow 24/613, lint 0, typecheck 0. In
    the same tab the kobin-2 cloud push of that canvas was measured for
    the first time: with six parts a commit and the 30 s tick starting a
    second push beside the first, Firestore's write stream refused every
    batch ("exhausted maximum allowed queued writes") for ten minutes and
    the tab churned 2-3 GB; with one push at a time (a 5 min deadline)
    and one part a commit the full push, 27 MB in 50 parts, took 120 s.

    Kobin, reading the register: with F30/F34/F29/F23 closed and F57 a cost,
    the eraser has no open correctness flag; the big design items are the
    register's rows, the "Saving and memory at scale" options and the 1.0
    gate, and he asked for them as one list without duplicates (given in
    the session; the register table stays the home until he says how to
    order it). New: F65, a drag not gated by a mark that failed to bake.
    Then, going down the list: D1 struck from the register at his word ("it
    isn't needed... we're going to build around that with the GPU renderer...
    I want it to eventually be a line anyways"), and the 7.6b row (a move
    finer than the object can hold) recorded as closed by F41/F55 as built.
    The two bake refinements (quantised bake scale, the fat outline's window
    chop) struck and folded into the raster renderer row as the browser
    limits it must keep clear of. The working order from here, his: memory,
    saving, threading, the GPU renderer, the geometry questions, then the 1.0
    decision (.claude/WORKLIST.md, not committed).
    THE MEMORY CENSUS: his canvas exported from the tab (107 MB of JSON) and
    loaded in jsdom with a forced GC - 721 MB live for 832k pieces at 344 B
    an arc piece, the numbers under "Saving and memory at scale". The tab
    itself could not be measured: the failing cloud sync keeps it frozen.
    THE SAVE FORMAT, at Kobin's word ("build it the way you are imagining"):
    kobin-2, DESIGN.md §13 and .claude/SAVE-FORMAT-PLAN.md. format2.js (headers
    + one Float64Array per frame, bit-exact with kobin-1), oplog.js (entries
    with results; replay rebuilds undo/redo and a pending eraser's done set),
    db.js v2 (frames2 + log, v1 canvases migrate on their first save), the
    saver on it (snapshots only when outgrown or forced), the cloud as a mirror
    (store2.js, gzip.js, cloudPushCanvas2/cloudLoadCanvas2), the sync fix with
    a visible error (S1), and TileStore.framesLeft (memory step 3a). Seen in
    Chrome on small canvases: reload with the undo stack back, an interrupted
    erase finishing, push, pull, compaction. Owed: the 90 MB canvas's migration
    seen once; the flat in-memory arrays (WORKLIST memory step 2) not started.

### 2026-09-07

    THE CHROME REPRODUCTION PASS over the old open eraser flags, in Kobin's own
    Chrome through a second engine in his tab (nothing touched his canvas or
    its sync). F34: 0 of 21 aimed rings seal. F30: the twelve gestures replayed
    on the timer path cede as they should. F29: the zoom-out sweep fades only
    sub-pixel pieces. F23: the stroke behind #418 is not in any report; the
    39-unit reconstruction is clean. The 23-54-04 outliers are F57, reproduced
    (247 s, one tick 109 s, half of each cut in _removedArea). Details in
    OPEN-FLAGS under each flag. Kobin, on those results: F30, F34, F29 and F23
    closed by decision; F57 is the one new eraser issue.
    Evening, into 2026-09-08: his stroke and eraser "failing" on that canvas was
    the other session's z rewrite (F63), found and fixed in the document with
    tools/zorder-compact.js; the tab died Out of Memory once on the way; the
    cloud sync of that canvas fails in the compressor (F64, new).

    THE SMALL STUFF, at Kobin's word ("all the small stuff, including the API
    tidy-up"). Uncommitted, jsdom only; nothing here changes a stored bit.
    Engine: the winding query asks an arc whose radius is at least its chord in
    its chord frame (arcShape.rayCross via freeze.chordLineRoots - the chop's own
    solver with the ray's normal in place of an axis); the 0.9 px jsdom instrument
    error on huge arcs is gone; a ray that misses the arc is refused by the line
    equation's residual, whose bar sits a few thousand ulps above rounding - at a
    fraction of the chord it counted two fictional crossings and CX-4 lost a tile
    (winding.chord.test.js WC-1..4, 70,000 seeded arcs). The seam marks are gone.
    One TileGrid type (S1; F36 closed). The render signature memo, and the shape
    bake no longer renders on its own (one render per pen-up). _noteSeal keeps the
    weld radius and the retry (F4). Tidy (S5): one VertexSet, one reversePiece,
    one polygon winding, cubicLoopsBBox, the bbox paths explained. Tooling: the
    layering lint rule (S2); JSDoc typedefs and npm run typecheck (S3, 0 errors,
    two real annotation bugs found); .github/workflows/ci.yml; test:erase; lint;
    70 unused-variable warnings removed; E1 found done; E2 measured at 26 s; E3
    banners; jsdom's canvas stubbed; D5 (tools/.cache); the manifest colours; the
    dev handle gated. Kobin's decisions: F54 by design (closed; drawing through a
    zoom is a UX feature); the ants' budget long-term; D2 dropped. Not done:
    .gitattributes (its own commit), the docmaps rebuild, S4, S6, and every
    2026-09-04..07 change is unverified in a browser (UAT cases 9-12).

### 2026-09-06

    F44 / F56 - THE FREEZE IS ONE RADIUS, AND A KID LIVES WHERE ITS SQUARE IS.
    Both at Kobin's word, uncommitted, undeployed, jsdom only. F44: his rule
    for the freeze - "a constant arc radius, for the tile diagonal length,
    where [a quarter pixel] is true; gate it on if the arc radius is greater
    than that amount, in tile units" - replaces the per-piece sagitta and the
    bow-grown-box guard that refused every piece cut on a tile line. One
    number (~8.8e12 units, the same at every level), an endpoint guard, the
    arcs about to freeze cut in their own chord frame (the one part of the
    three-layer design still needed: the centre's float64 step became thirty
    units through an arcsine), and the boolean standing in for an arc by the
    same gate and no other test. F56: from his two reports of the morning -
    the cede's unmoved square (the erase less the remainder, F55) lands in
    the neighbour frame as often as not, and a kid homed in the camera frame
    with its ink next door derived its child tiles through the ring
    projection, which is not the chain's exact hop; the kid is now homed in
    the square's owner, holding the owner's own piece.
      geometry/freeze.js          freezeRadius, DEFAULT_FREEZE_R; the gate
                                  in settle/settleCut with the endpoint
                                  guard; chordFrame / chordCuts / chordPt;
                                  seam marks no longer read by the freeze.
      geometry/arcShape.js        straighten = the gate (opts.freezeR),
                                  clipShapeToRect passes it on.
      geometry/derive.js          freezeR(cfg); shapeRingsInRect /
                                  shapeLoopsInRect take opts; deriveStep
                                  threads the gate into the clip.
      erasePipeline.js            _boolOpts() on every boolean and the cede;
                                  the square's owner: neighbour(F0, i, j) and
                                  neighbour(F, i, j), the owner's (0, 0) piece,
                                  the hole mapped up from the owner.
      Document.js                 cedeTileById(..., boolOpts).
      TileStore.js                the down-bake's clip gets the gate.
      tests                       freeze.gate.test.js NEW (the radius, the
                                  chop by the radius, eight crossings on three
                                  curved strokes to 1/20 px); objectTiles OT-3
                                  re-pinned to the rule; erase.depth's arc
                                  case at level 3; reported.regress RR-9 NEW
                                  (Kobin's reports replayed); move.drag M-10
                                  (the kid next door).
    MEASURED (jsdom): three curved strokes descend eight crossings holding
    their edge to 1/20 px at every crossing (two of them lost it at the fifth
    before); the level-4 frozen line on the circle through the level-3
    piece's ends to 0.000 px; no arc survives past level 3; all 11 corner
    probe cases pass; the report replay refuses the untouched object and
    mints every kid of the other as the chain's piece. Found on the way: the
    jsdom winding instrument locates an arc through its centre and is 0.9 px
    off at r = 5e12 - the gate tests read edges the way the picture defines
    them. Nothing measured in a browser.

### 2026-09-05, evening

    F55 / F43 - MOVES AS ADDRESS ARITHMETIC, AND A LINE THAT REMEMBERS ITS
    LINE. Built together at Kobin's word ("they are related and should be
    updated and tested together"); uncommitted, undeployed, unverified by him.
    F55: a group moved from above parted from the detail drawn against it
    three or more levels down (his star in a corner; F35's mechanism) because
    the one rounded addition at the move level was magnified 4096x per level.
    Now a move never touches a stored coordinate at any level: the
    displacement, snapped to 2^-10 units at the move level (his "quarter
    pixel is good enough"), lives in the object's table, the tiles are
    unmoved space, and the table is read at render time and inverted on
    inputs. F43: a nick on a line moved the line's deep picture (the level-8
    tile empty after a level-3 nick) because the boolean redefined the line by
    its new rounded endpoint; a line piece now carries the line it was cut
    from and every deep cut is computed from that.
      geometry/offsets.js         REWRITTEN: below[k] for k >= 0 (depth 0 =
                                  the home), snapDisplacement, addOffset ->
                                  {below, cellX, cellY}, shiftAt (digits +
                                  remainder at a depth), shiftDown counting
                                  each entry once (a double-count found on
                                  the way), residual = the remainder.
      LevelMap.js                 objShift (table -> frame to read from +
                                  remainder), frameShifted, mapPointObj /
                                  mapRectObj / projectLoops / projectLoopsObj.
      TileStore.js                offset code removed from the bakes; content()
                                  routes a moved object through _reroute.
      derive.js                   deriveStep without offsetOf: nothing about a
                                  move enters the hop.
      selection.js                _dragSelection rewritten (snap, table,
                                  carries -> neighbour re-home, setOffsetsById);
                                  _rectInActive / _objPointInActive.
      Document.js                 setOffsetsById (offsetsOnly event);
                                  cedeTileById(kidBelow).
      erasePipeline.js            the descent per native through objShift
                                  (F0 / remainder / kidBelow);
                                  _familyComponents via objShift.
      arcPerimeter.js             canonical helpers, cutLine, intersectors
                                  returning t; for arcs (later the same day,
                                  Kobin: "fix arcs, too"): canonArc, arcDir,
                                  arcPos, arcPieceOf, cutArc, circleCrossSeg.
      arcShape.js                 P/Q/sa/sb on line pieces; K/ua/ub on arc
                                  pieces; mapLine / mapArc, shareCutEnds,
                                  reversePiece (K never reversed); boolean
                                  cuts on the canonical line / arc; straighten
                                  judges by K and stands in with K's chord
                                  (its r(1-cos) test reads 0 under 1e-8 sweep
                                  and chords every deep arc an erase touches
                                  - KEPT: the bulge form was tried and the
                                  centre-based cut it forces is worse, F44);
                                  clipShapeToRect + reanchorCutLines +
                                  reanchorCutArcs; encodeLoops codes 2 and 3.
      freeze.js                   chopFreezeLoops chops a cut arc as its
                                  canonical arc and trims (settleCut);
                                  markSeamEnds marks K's ends too.
      persist.js                  VERSION 2, written only when a cut line or
                                  a cut arc is in the drawing.
      tests                       move.registration.test.js NEW (the probe
                                  turned into a test); erase.depth.test.js
                                  F43 case NEW; move.below / move.deep /
                                  move.drag / select.lasso / objectTiles /
                                  KobinEngine.edit / gesture.robustness /
                                  reported.regress and the layered,
                                  neighbourhood, multilevel and contract slow
                                  suites re-pinned from "the coordinates moved"
                                  to "the picture moved" (objPointIn);
                                  persist.slow: version 1 unless needed.
    MEASURED (jsdom): move.registration - the coarse object's pieces four
    levels below a move are the same bits in the new frame, the star's bits
    untouched, the gap unchanged to 1e-9. depth.corner.probe - after the
    level-3 nick the horizontal arm is bit-identical to level 8 with its edge
    at 280.254668604357 before and after (0 px) and the slanted arm (an arc
    of r = 2.6e16 at level 4) at 4 and 5; the join arc still differs, by the
    boolean chording an arc whose sweep is under 1e-8 (F44's, see
    OPEN-FLAGS F43). erase.depth - the level-2 nick that
    moved level 6 by 136 units now leaves it bit-identical, and the same nick
    on the slanted arm's ARC leaves level 4 bit-identical. Quick suite 70
    suites / 998 tests; slow suite 24 suites / 610 tests. Nothing measured in
    a browser yet.

### 2026-09-04

    F42 / F41 - THE DEPTH FLOORS, built the same evening they were diagnosed
    (uncommitted, undeployed, not yet on the phone). F42: an erase at level 9
    cut the black under the view and not the red or green on it; the cede
    descent recomputed each level's ink and parted from the render chain by
    4,096x per crossing (1,788 units at level 6). F41: a drag from four
    crossings below a level-1 object moved it in 127 px jumps; the
    displacement went into home coordinates whose float64 step it was far
    below. Kobin's design for both, honoured: "the move is only handled
    locally"; at depth the only "same" is the same bits.
      engine/erasePipeline.js     _squareInk NEW: the tile store's piece for
                                  a native in one cache square - loops, its
                                  padded window, its grid phase; a covering
                                  quad as its rectangle. _bakeRehomeInner
                                  cedes per cache square from that piece (the
                                  kid IS it; the window ceded is its clip),
                                  the centre square first and only it when
                                  its window covers the need, every kid
                                  followed down, remnants standing in for a
                                  ceded parent for the next square;
                                  _inkShapeInRect gone. _familyComponents
                                  joins two kids at one level by contact on
                                  the abutting window. _bakeOne cuts in the
                                  subject's own coordinates. _eraserRectInto /
                                  _eraserLoopsInto NEW: the eraser through an
                                  object's offsets (F41).
      engine/Document.js          cedeTileById cuts the parent in its own
                                  coordinates (no local round trip: (v-c)+c
                                  is not v, and four crossings down that was
                                  the remnant's picture moved). `below` on the
                                  object: snapGeometry / translateGeometry /
                                  scaleGeometry / setGeometryById carry it,
                                  cede shifts it for the kid, eraseReplaceById
                                  copies it, serializeNatives / loadNatives
                                  write and read it; _offsetIds, hasOffsets(),
                                  offsetIds().
      geometry/arcShape.js        shapeBooleanOnce passes every loop the cut
                                  does not reach and every piece it does not
                                  split through as the original object, not
                                  the straightened copy. transformLoopsAbout
                                  takes an offset: (p - c) * f + o.
      engine/TileStore.js         _upPiecesOver NEW: the parent's pieces over
                                  a pre-image, and when the pre-image straddles
                                  two parent squares, each object from the ONE
                                  square holding the centre whose window covers
                                  it (two copies of the same ink, clipped on
                                  two rectangles, were thousands of units apart
                                  at depth). _offsetInto; _bakeUp fetches an
                                  offset object's pieces from the shifted
                                  pre-image; _appendUp / classifyUp / deriveStep
                                  take the offset; _ringNatives grows its query
                                  by half a cell; a change to an object with
                                  offsets invalidates its chained tiles.
      geometry/offsets.js         NEW. offsetAt, hasOffsets, cloneBelow,
                                  addOffset (with integer carries), residual,
                                  shiftDown / shiftUp, sameBelow, encodeBelow /
                                  decodeBelow. Its header is the design.
      geometry/derive.js          deriveStep: opts.offsetOf(o); the hop adds
                                  the offset once, the tile phase moves with
                                  it; classifyUp takes it; solidQuad carries
                                  `clip`.
      engine/selection.js         _dragSelection: coarser than the camera ->
                                  addOffset at the camera's depth; level with
                                  it -> translate; deeper -> digits. Members it
                                  cannot move are journaled (`skipped`, F35).
                                  _rectInActive / _objPointInActive through the
                                  offsets plus the residual; _hitTest and
                                  _selectionRect read `piece.res`.
      engine/KobinEngine.js       _buildList stamps `res` on every piece; the
                                  move note carries `below` and `skipped`.
      engine/Renderer.js          _pushArea / _buildInto / _chopFor / _sig:
                                  the residual folded into the origin.
      engine/LevelMap.js          mapPointObj / mapRectObj / projectLoopsObj:
                                  the hops through an object's offsets.
      engine/overlays.js          the ants draw pieces shifted by `res`; seam
                                  rects and join doorways through the offsets;
                                  the debug outline through the object's own
                                  picture.
      engine/persist.js           validates `below`.
      __testkit__/ink.js          the oracle honours `res`.
      tests                       erase.depth.test.js NEW (F42: 5-9 crossings
                                  on a slanted edge; kids are the render's
                                  loops; a cede far above leaves the deep
                                  picture bit-identical). move.below.test.js
                                  NEW (F41, 17 cases, listed in OPEN-FLAGS).
                                  objectTiles OT-4 updated: the attach rect is
                                  the render piece's window (object tiles the
                                  square reaches, grown by the pad). f34.repro
                                  wraps _squareInk. move.drag M-10/M-11 and
                                  KobinEngine.edit's two cross-level drags
                                  assert the new invariant (home untouched,
                                  offset holds the move); erase.matrix MX-5 and
                                  select.multilevel SM-6 measure the PICTURE
                                  (harness objPointIn); precision.slow's
                                  widestGap uses the seam-aware oracle (two
                                  kids abutting exactly on a square edge read
                                  as a 0.25 px crack the browser does not have).
      measured                    F42 holes land at 5, 6, 7, 8, 9 crossings;
                                  every intermediate kid bit-identical to the
                                  store's piece. F41 pointer-to-ink 1e-6 px at
                                  1, 2, 3, 5, 8 crossings; home coordinates
                                  unchanged; carries [0, G] and G exactly.
                                  Found: a cut on a long line moves its deep
                                  picture 136 units at level 6 (F43).
                                  Quick suite 66 suites, 966 tests; slow suite
                                  24 suites, 606 tests.

    F40 - "the blue shape disappears just past the level jump" (Kobin, on the
    deployed build). Not the shape: the cubic drawn for it. Arcs went to the
    browser as quarter-turn cubics (2.7e-4 of the radius), and a re-homed
    circle one frame up had a 2.9 million px radius on screen - 463 px of
    bulge, which the level jump's re-chop into thousandth-degree pieces took
    away. Cause proved by evaluating the cubic at his camera; the browser
    cleared by a bare-SVG harness.
      engine/Renderer.js          pushArcPiece: an arc is an SVG `A` (Two.js
                                  Commands.arc, present since 0.7, identical
                                  output in 0.8.24), split only at a half
                                  turn; pushShapeAnchors / pushGapAnchors on
                                  it; pushCubicChain and the cubic imports
                                  gone; the thin rescale scales radii and
                                  walks arc midpoints; _addFillPath treats an
                                  arc anchor as a curve for `closed`.
      geometry/antRuns.js         runPathData emits the same `A`; no
                                  pieceToCubics; `-0.00` normalised.
      tests                       antRuns path data rewritten for arcs;
                                  indicator tests accept `A` or a capsule's
                                  `C`; the under-2-px test's square 60 -> 30
                                  px (it raced the frame's exit). Quick suite
                                  62/62, 916.
      tools/harnesses/bigpath.html  NEW: one arc at a huge screen radius,
                                  `A` vs quarter-turn cubic, edge measured by
                                  bisecting elementFromPoint against float64.
      measured                    arc: 0.3 px to R_px 1e7, 3-5 at 1e8, 41 at
                                  1e9; in the app mid-piece 0.31 px at 6.5e6
                                  and 159 px at 2.4e10, snapping back at the
                                  next crossing.
    THE 22 DEGREE RULE, the same day, at Kobin's word ("implement the 22
    degree fix") after being told it is not under a pixel everywhere (~15 px
    at worst, for a 22-degree piece spanning a tile at a screen radius of
    2.6e8 px): the arc command's error grows with the radius, the cubic's
    with sweep^6, and they cross at 22 degrees whatever the radius.
      geometry/arcShape.js        ARC_COMMAND_MIN_SWEEP (22 degrees) and
                                  chordCubic: one cubic from endpoints and
                                  sweep, no centre (the bible's
                                  cancellation-free handle); chordArcMid.
      engine/Renderer.js          pushArcPiece: under 22 degrees one curve
                                  anchor, its first handle set on whatever
                                  anchor precedes it; over it the `A`.
      geometry/antRuns.js         runPathData: the same rule.
      tests                       Renderer.arcs.test (NEW, 6), arcShape.test
                                  (+4), antRuns.test (the 10-degree cubic).
                                  Quick suite 63/63, 925.
      tools/harnesses/bigpath.html  `auto` representation (the rule) and
                                  __paintCheck: the truth drawn in screen space
                                  under mix-blend-mode difference, because
                                  elementFromPoint (an analytic winding test in
                                  float32) reported 17-42 px on flat cubics
                                  where paint shows 4-15.
      measured, in paint          cubic 21.9 degrees: ~4 px at R_px 1e8, ~15
                                  at 2.6e8 (the worst case); arc 22 degrees at
                                  2.6e8 <= 1 px; in the app the child frame's
                                  piece is three cubics, the painted edge on
                                  the truth marker at the deepest zoom and
                                  after the crossing; no jump; no band at
                                  Kobin's camera.
    THEN THE QUARTER-PIXEL PLAN, at Kobin's word ("15 px is too much"; "I
    agree with your recommendation"; "can we cheaply do a render-only tile
    chop for that"): the 22-degree constant is gone.
      geometry/arcShape.js        planArc: the arc command while 2^-24 x R_px
                                  is within cfg.arcTolerancePx (a screen
                                  radius to 4.2e6 px), else arcCubicCount =
                                  ceil(sweep x (1.8e-5 R_px / tol)^(1/6))
                                  cubics; arcSplit; arcCommandFits.
      engine/Renderer.js          pushArcPiece on the plan; pushLine splits any
                                  non-seam piece longer than segMax units
                                  (largest power of two under (tol 2^24 -
                                  REORIGIN_PX)/enter = 8192) so far ends cannot
                                  carry float32 rounding onto the on-screen
                                  stretch; seams and covering quads never
                                  split; pushRingAnchors writes and splits a
                                  long closing edge.
      geometry/antRuns.js         runPathData on the plan at the decision's
                                  scale x 1.25.
      tests                       Renderer.arcs.test 10, arcShape planner 4,
                                  antRuns. Quick suite 63/63, 932.
      tools/harnesses/bigpath.html  `plan` representation, __lineCheck for the
                                  coordinate floor.
      measured, in Kobin's Chrome the plan's old worst case clean; the line
                                  floor a few px unsplit, none split; the app's
                                  split piece on the truth at the deepest zoom
                                  and across the crossing - but DROPPED by the
                                  rasteriser in two captures of five, and
                                  reproducibly in the harness at full raster
                                  scale (lines survive; 32 far cubics do not).
      Renderer.lengthChop         the length split turned OFF by default the
                                  same night: the drop is not the split's
                                  doing - Kobin's red piece, three cubics,
                                  never split, painted at 64x and vanished at
                                  78.8x with its `d` unchanged. Any path whose
                                  curves run past ~1e7 device px.
      the window chop             built the same evening at Kobin's word
                                  ("just chopping instead of segmenting ...
                                  ensure that if you pan towards the end of the
                                  segment, the next segment is loaded"):
                                  Renderer._pushArea / _chopFor / _maybeRechop
                                  / needsWindowChop, two lines in the engine's
                                  pan and zoom. A window of +-2^18 device px
                                  per scene; area pieces past it clipped with
                                  shapeLoopsInRect; re-chosen at the inner
                                  half or 4x zoom, rebuilding the straddling
                                  groups only. Render-only.
      measured, in Kobin's Chrome the red piece paints at 78.8x and 97x with
                                  its edge on the float64 truth; a 2,103-unit
                                  pan across the inner half is one full render
                                  and leaves the edge on the truth.
      tests                       Renderer.chop.test 8. Quick suite 64/64, 941.

    Two floors at depth, diagnosed from Kobin's phone reports (14-45-44 and
    14-50-08) and replayed in jsdom; no code changed. OPEN-FLAGS F41, F42.
      F41 a move from below      a drag 3+ crossings below an object's home
                                  adds a sub-ulp displacement to its
                                  coordinates: 127 px jumps at 254x, 4 px
                                  sideways. Design agreed: per-level offsets
                                  below the home, carrying up in whole cells;
                                  the home coordinates never absorb it.
      F42 an erase at depth      the cede descent and the render chain are
                                  the same math in two functions; last-bit
                                  differences grow 4096x per crossing: 1e-11
                                  units at level 2, 1,788 at level 6, a tile
                                  at 7. Straight lines only, no freeze.
                                  Design agreed: the erase reuses the render
                                  chain's pieces and their bits.

### 2026-09-03

```text
    THE SELECT TOOL, from Kobin's phone test of the autosave build (five things
    in one message; report 14-14-25 and 14-21-20):
      engine/KobinEngine.js       the select press changes nothing on the way
      engine/selection.js         down. It is recorded, then becomes a tap on
                                  the way up (_selectTap), a lasso or a move once
                                  it has travelled 8 px (_beginSelectDrag), or is
                                  dropped by the second finger of a pinch
                                  (cancelSelectGesture). With NOTHING selected a
                                  drag is always a lasso, ink under the finger
                                  or not.
      hooks/useKobinEngine.js     a second finger within 400 ms of the first
                                  cancels the press outright; past that, a drag
                                  that has moved is committed first. Kobin's
                                  call to tune once he has felt it.
      engine/KobinEngine.js       the eraser trail no longer reads penType, so
                                  it stays freehand after the line tool
                                  (o._straight is remembered on the stroke).
      geometry/lasso.js           polylineInsidePolygon; _lassoFind asks the
      engine/selection.js         INK where the box straddles the loop (F32).
      engine/overlays.js          _familyJoinNotes looks one level up in EVERY
                                  cell, not just the parent cell, so a tile
                                  ceded into the neighbouring cell has its join
                                  and no longer wears ants on all four sides
                                  (F37, closed).
      tests                       select.lasso (+3), KobinEngine.edit (+1); the
                                  shared drag() helper and twelve drags in six
                                  suites tap-select first, and SM-4 now records
                                  that a loop from below bounds the fine object
                                  drawn there, because a drag from an unselected
                                  object is a lasso now.
      .claude/launch.json         report-server entry.
      engine/Document.js          an id map (getById was a scan of every frame)
                                  and a lazily rebuilt editKey -> members map
                                  (editGroup was a scan of every object); both
                                  were called once per selected object by the
                                  overlay. keysChanged() for the severance
                                  re-key, which bypasses _emit.
      geometry/lasso.js           loopTester: the loop's edges bucketed once
      engine/selection.js         into a 32x32 grid; the ink test is one vertex
                                  inside plus no crossing, flattened at 3 px,
                                  capped at 3,000 points against a loop
                                  decimated to 160, and the object's own points
                                  are asked before anything is flattened.
    Measured in the in-app browser: report 14-14-25, family 213 selected at its
    own camera - before, two five-point rings, a 214 px square (one level-2
    cell at that zoom); after, no rings and a join recorded for every pair.
    Report 15-03-53 (Kobin: "the lassos got too slow"), a loop taking 5,429
    objects: _lassoFind 985 -> 7.7 ms, pointer-up ~1,500 -> 74 ms, a zoom step
    with the selection up 548 -> 49 ms. The table is in OPEN-FLAGS F32.
      engine/overlays.js          (F38) past the ant budget a boundary went to
      engine/Renderer.js          `plain`, stroked solid and thin (withdrawn
                                  hours later by F39 - grouping instead); and a
                                  frame under a pixel on screen is one speck,
                                  decided per frame before members are
                                  gathered (Kobin's rule). Overlay with nothing
                                  on screen 33 -> 3.5 ms; a zoom step 33 -> 6.
                                  (The ring cache is F39, below.)
    Report 14-21-20 at its camera: the lasso walk found all 61 objects with a
    rectangle and with an ellipse, before and after. Kobin's own loop could not
    be replayed (its camera is not the report's). Quick suite 877 + 4 new;
    the eleven slow suites that go through drag() pass.

    THE ANTS ON A DENSE SELECTION (F39; report 16-33-20, Kobin: "lots of
    solid outlines instead of ants ... very slow on zooming"), three designs
    in a day; the third ships:
      geometry/antRuns.js         the indicator's geometry on ARCS, nothing
                                  flattened: lengths, the seam test (a straight
                                  piece on the rectangle that cut it), path
                                  data as cubics, a boundary cut to a window
                                  piece by piece, and the edge spans as a
                                  winding scan of the boundary against each
                                  side's line. Lines, arcs and the cubic
                                  capsules of unresolved strokes.
      geometry/derive.js          every tile piece carries `clip`, the
      engine/TileStore.js         rectangle that cut it.
      engine/overlays.js          _selectionAnts rebuilt: from the RENDER LIST
                                  (never the document - Kobin's rule), decided
                                  once per list / selection / rev / frame /
                                  origin / quarter octave / half-screen pan
                                  (_selDecide), a frame under 2 px is one dot
                                  from the selection table's per-frame box
                                  (24 px and a ring at first; that boxed a lone
                                  stroke and a tile piece - Kobin: "only
                                  objects <5px", then from the phone, 2 px; a
                                  re-homed family's pieces never count toward
                                  a frame's mark), family attach windows are
                                  seams.
      engine/Document.js          `rev`, bumped on every change.
      engine/Renderer.js          the ants in their OWN <svg> layers (the
                                  drawing re-rasterised under them every frame
                                  of the crawl: 50 -> 16.7 ms), moved by a CSS
                                  transform on the layer (an inner SVG
                                  transform re-stroked every ant every step),
                                  edge runs in a second small layer, the crawl
                                  stepped 16 a cycle (a full budget's repaint
                                  is a frame here whatever the batching).
      geometry/cluster.js         DELETED with its test: the pixel-grid
                                  clustering of the first cut, withdrawn on
                                  Kobin's three screenshots.
      tests                       geometry/antRuns.test.js (20), selection
                                  indicator rewritten (30), derive golden
                                  compare strips `clip`.
    Measured in Kobin's Chrome at the report's camera, all 5,526 selected:
    overlay JS per zoom step 17 -> 0.8 ms; a frame with the crawl running
    50 -> 16.7 ms; a decision 26-47 ms - all under the old 24,000 px budget.
      engine/overlays.js          the budget REMOVED (Kobin: "take off the
                                  budget"): every selected piece on screen is
                                  outlined. 72,554 px at the report camera,
                                  a 50 ms frame while the ants crawl; 275,820
                                  px at 4x in, 200 ms. The crawl's repaint is
                                  now the open item (Performance, above).
                                  A drag translates the decision made on its
                                  first event instead of deciding again per
                                  event; the loops are cached against the
                                  geometry, not the piece (a moved native is
                                  rewritten in place - the ants had stayed).
      engine/selection.js         _lassoFind asks "fully bounded" of a whole
                                  re-homed family: a loop around a ceded tile
                                  alone selects nothing (it took the parent).
      tests                       select.lasso (+3 family), selection
                                  indicator (+2 drag; no-budget).
```

### 2026-09-02

```text
DONE IN THE 2026-09-02 PASS - recorded so it is not re-investigated

    public/ (D1). Everything that was not the app shell left it, so a build no
    longer ships 8.9 MB of debug data:
      recovered/ (8.2 MB) and shots/ (350 KB)   -> .kobin-reports/, gitignored.
                                                   They stay in git history up to
                                                   f6f1062 if ever wanted again.
      hairline/ and dsdoc/index.html            -> tools/harnesses/ (the F-Z and
                                                   selection-ant harnesses), still
                                                   tracked, never bundled.
      __f35/ (gitignored render output)         -> .kobin-reports/f35/renders/;
                                                   f35.render.test.js writes there
                                                   and creates the directory.
      arcbake-stroke.json, arcbake-stroke2.json    DELETED. Byte-identical copies
                                                   are src/engine/__fixtures__/
                                                   arc-stroke*.json, and the labs
                                                   that fetched them are gone.
    public/ now holds index.html, manifest.json, robots.txt and the four icons.

    Suites that read .kobin-reports/ without checking it exists - f34.operands,
    f34.repro, f34.winding, f35.render, reported.regress - now skip on a fresh
    clone the way Document.test / persist.slow / erase.retrace already did, and
    KOBIN_REQUIRE_REPORTS=1 makes a missing fixture fail loudly. Before this,
    `npm run test:quick` could not pass on a clone of the repository.

    hooks/useKobinEngine.js: the window keydown handler now ignores events whose
    target is an input, textarea or contenteditable. With the select tool active
    and an object selected, Backspace in the canvas-title or scene-name field
    deleted the selection instead of a character, and Ctrl+Z undid a stroke.

    Lint: the product source is clean under the CRA config. Removed the unused
    LevelMap `W` import, Renderer `SEL_UID`, resolve.js `safeExp10`/`REL_EPS`,
    and a byte-order mark on scaleBar/index.js; two `no-loop-func` sites whose
    closures run synchronously carry a one-line disable saying so. Test files
    and __testkit__ get an eslintConfig override turning off
    react-hooks/rules-of-hooks (harness.useEngines is not a hook) and
    jest/no-conditional-expect (the suites assert on measured conditions on
    purpose). Both are a package.json edit away from being reinstated.

    public/index.html no longer loads Roboto from Google Fonts: nothing used
    it - the UI is Fraunces + Karla via boundless-ui.css - and it was a
    render-blocking request on every page.

    Corrected, because the text said something no longer true:
      useKobinEngine.js     header and report comment still described CanvasV2
      localCanvases.js      "/v2 dev harness still reads" the legacy key; the
                            depth badge said levels are x3,000 (they are x4,096)
      TileStore.js          the up-chain step was written as ~3000, the
                            pre-lattice ratio
      README.md             listed "restyle" as a tool (removed 2026-08-03) and
                            said work "autosaves" to the browser while
                            LOCAL_AUTOSAVE is off (F33)
      OPEN-FLAGS.md         still dated 2026-08-26, named the deleted labs as
                            live, linked the frame-lattice bible at its old
                            path, and cited KobinEngine.js line numbers for
                            code that moved in the split
      00-START-HERE rule 7, 10-STATUS, 30-CODE-MAP (App.js routes),
      70-RELEASES items 5, 6 and 10   described the tree as uncommitted and the
                            dev routes as live
      60-RECOMMENDATIONS 5, 70-RELEASES R2 and its item 2   called an automated
                            visual-regression gate "the single biggest
                            structural gap". Kobin runs those passes by hand,
                            in a real browser, and said so on 2026-09-02; the
                            automated version is now recorded as optional.
    Not touched: D2, D4, D5 (below), and everything in OPEN-FLAGS.

    Later the same day, at Kobin's request ("cleanup/organize todos/bugs so
    they are not all over the place with files"):
      docs/ROADMAP.md   CREATED - the plan in Kobin's order (fix autosave,
                        deploy, performance and bugs, UX) with the six
                        structural items he named as the lane underneath,
                        and the three backlog files carried in verbatim.
      docs/ai/50-TODO.txt, 60-RECOMMENDATIONS.txt, 70-RELEASES.txt
                        RETIRED into it. Nothing dropped except 70's
                        "if only one thing happens this week: commit",
                        which happened on 2026-09-01.
      OPEN-FLAGS F36    ADDED - the three-tile-grids confusion, because Kobin
                        calls it a real bug, not tidying.
      10-STATUS         the open-flags section no longer restates each entry
                        (OPEN-FLAGS has them); "deliberately not built"
                        moved here. CLAUDE.md, 00-START-HERE, 90-MAINTENANCE
                        and the README now point at this file.

    Later still, the autosave rework (Kobin: "go ahead and do your autosave
    recommendations. Also make any changes if needed to make sure data isn't
    being leaked for users"):
      src/storage/db.js             NEW - IndexedDB: a header record per canvas,
                                    a record per frame, thumbnails, trash
                                    payloads and backups in their own stores;
                                    the one-time migration out of localStorage,
                                    which deletes the old keys as it goes.
      src/storage/localCanvases.js  REWRITTEN as the store's async public face;
                                    the gallery and trash indexes stay in
                                    localStorage. sweepStorage is the leak list.
      src/hooks/useKobinEngine.js   autosave rebuilt: dirty frames off document
                                    events, 1.5 s debounce / 8 s ceiling, flush
                                    on hide, pagehide and unmount, camera saved
                                    once settled, nothing written for a canvas
                                    nobody drew on. LOCAL_AUTOSAVE = true; the
                                    standing notice is gone.
      src/cloud/lzWorker.js, public/lz-worker.js, public/lz-string.min.js
                                    NEW - the cloud payload compresses in a
                                    worker, main-thread fallback.
      src/cloud/canvasSync.js       encode/decode through the worker; the save
                                    returns timings; cloudSave is in the perf
                                    log for the first time.
      src/Pages/CanvasEditor.js, CanvasesV2.js
                                    the async store; the gallery runs migrate +
                                    sweep on load, shows storage usage, asks
                                    once for persistent storage.
      src/engine/Document.js        serializeNatives(only) - optional argument.
      src/engine/files.js           serializeDrawing(meta, { frames }) - same.
      fake-indexeddb 4.0.2          devDependency; src/setupTests.js loads it.
      docs                          OPEN-FLAGS F33 (reworked) and F35 (Kobin's
                                    correction: the drift is the move's, not
                                    undo's), DESIGN 13, ai/20, 30, 40, 10-STATUS,
                                    UAT case 7, tools/docmaps/README (pages one
                                    build behind: 56 functions to describe).
    Measured in the in-app browser on a two-stroke drawing: 1.7-1.9 ms a write.
    NOT measured: the 16M-character drawing on the phone. That is the gate, and
    it is Kobin's.
```

### 2026-08-31

```text
DONE IN THE DEPLOY-READINESS PASS (2026-08-31)

    The full record, with the reasoning for each decision, is in
    docs/OPEN-FLAGS.md under "Cleanup backlog - DONE 2026-08-31".

      C1  KobinEngine.js split 3,506 -> 855 lines. Six files mixed back onto one
          prototype by engine/mixin.js; every method moved byte-identical.
      B6  CanvasV2 deleted, with BakeLab, ArcPen, ArcBake and their routes.
      D6  docs/ moved to docs/reference/ - the bibles, handoffs, option papers,
          test catalogs and reports. STILL TRACKED. DESIGN.md at the repository
          root is the one document to read instead of them.
      G1  geometry/erase.js MOVED to __oracles__/, not deleted - the suite that
          uses it holds 26 passing assertions and X1 itself said to port them
          rather than drop them, and an oracle is not something you port into
          the code it checks.
      G2  X2/X3/X4 DO NOT CLOSE, and the reason is worth keeping: strokeOutline
          is NOT unreachable. Renderer._fatPolys calls it under outlineMode, and
          derive.bandRings calls it under legacyOffset, which is the branch
          geometry/derive.test.js walks to golden-compare against V0. V0 is
          KEPT as an oracle, so clipper-lib stays. What was done instead:
          clipperOutline.js split into polyline.js (pure float64, the hot path)
          and clipperBoolean.js (the three Clipper functions), so the name stops
          lying and a grep for clipperBoolean is a complete answer to "where is
          Clipper still reached" - six files, three of them tests.

    Also: the last three unreferenced functions resolved (canRedo wired up to
    grey the toolbar's Undo/Redo, _edge and minDist deleted, and traceLoops
    which the audit surfaced once ArcBake was gone); the oracles and the
    scale-bar test fixtures moved out of the shipping tree; @material-ui out of
    package.json; and KobinEngine.contract.test.js rewritten around its real
    consumers.

    MEASURED: 1,466 tests across 85 suites pass; the production build compiles;
    the bundle is 55.3 KB smaller gzipped; and the build's source maps list 0
    modules from __oracles__, __testkit__, the labs or @material-ui.

--------------------------------------------------------------------------------
1. THE ONE STRUCTURAL CHANGE THAT MATTERS: SPLIT KobinEngine    [DONE 2026-08-31]
--------------------------------------------------------------------------------

    DONE. 3,506 lines -> 855, along roughly the lines proposed below, though not
    as collaborator objects: engine/mixin.js copies each new file's prototype
    onto KobinEngine's, so they are still the engine's methods and every one of
    them moved BYTE-IDENTICAL. That was the point - a split where nothing is
    rewritten is reviewable by reading the file list.

      erasePipeline.js  the eraser and the resumable bake        ~930 lines
      overlays.js       selection indicator + erase debug view   ~670
      selection.js      selecting, hit-testing, dragging         ~390
      instruments.js    LongFrames, EventLatency, GrowthLog,
                        FrameMeter                               ~295
      sceneOps.js       auto-scenes                              ~215
      files.js          dev-0 and kobin-1                         ~70
      mixin/now/rectMath  the small shared pieces                 ~70

    The advice below was followed and was right: the contract test WAS the safety
    net (it caught nothing, because nothing broke, which is what a safety net
    reporting green means); Diagnostics went first; the erase pipeline went last.
    Two real defects came out of the move, both import mistakes rather than logic:
    an aliased import (`R as CROSS_RATIO`) re-emitted without its alias, which
    silently yielded `undefined` and made `_promoteOversize` re-home every object
    out of the frame; and a `function perfNow()` declared AFTER the class body,
    which hoisted and so was invisible to a scan that only read the class. Both
    were caught by the suite in minutes.

    The original recommendation, left as written:

    3,506 lines, 162 methods, and its own header says it "holds NO geometry or
    z-order logic of its own". That stopped being true a long time ago. The split
    is already latent in the file's own section comments:

      EngineCore            construction, config, destroy, resize, _render,
                            _buildList, _emit                        ~250 lines
      InputRouter           pointerDown/Move/Up, the pen, cancelStroke,
                            pan/zoom/pinch entry points               ~300
      BakeScheduler         _scheduleBake, _bakeTick, _stepShapeBakes,
                            _queueBake, _forceBake, _sealed,
                            _promoteOversize, _queueIdleFits          ~300
      EraseService          _bakeOne, _bakeRehome, _nextEraseTarget,
                            _eraseMayTouch, _flushErasesFor,
                            _settleSelectionErases, flushErases       ~600
      Severance             _familyMembers, _familyComponents,
                            _resplitFamily, _familyJoinNotes          ~250
      SelectionService      _hitTest, select, _setSelection, lasso,
                            _dragSelection, _normalizeHome,
                            deleteSelection                           ~450
      SelectionIndicator    _selectionAnts, _selInkRings, _selEdgeSpans,
                            _emitAntRing - pure geometry, no state     ~350
      SceneService          refreshScenes, captureView, split, rename,
                            delete, jumpTo, sceneZoom                  ~200
      Diagnostics           LongFrames, EventLatency, GrowthLog,
                            FrameMeter, _perf, _note, journal,
                            reportFamilies, the debug overlays         ~600

    Do it as a facade preserving the existing surface, because
    KobinEngine.contract.test.js already pins exactly what the shell and the
    tests read. That test is the safety net for this refactor and it exists
    already. (It was enumerated from CanvasV2, which was deleted in the same
    pass; it is now enumerated from hooks/useKobinEngine.js and CanvasEditor.)

    DO IT ONE PIECE AT A TIME, AND DO Diagnostics AND SelectionIndicator FIRST.
    They are ~950 lines with no dependency on engine state beyond what can be
    passed in, so they are the cheapest 27% of the file to remove and they carry
    the least risk. Do NOT start with EraseService - it is where the open bugs
    are, and moving code you are also debugging costs twice.
```

### 2026-08-28

```text
DONE IN THIS PASS (2026-08-28) - recorded so it is not re-investigated

    Deleted, all verified to have no caller anywhere in src/:
      SelectionEditPanel.js, ui/Select.js and their CSS
      FileActionsMenu.useFileInputRef
      canvasSync.LEGACY_CHUNK_CHARS
      frameLattice.tileIndexOf
      arcPerimeter.boundaryChain, its unused reverseLoop, the Oracle export
      biarc.arcPath
      connect.pointAtT
      curveOutline.isFatEver
      catalog.allRegisteredUnits, logMath.logBarBounds + LN10
      membership.ladderNeighbors, membership.unitsOnLadderWithinFactor
      persist.validEdgeRec
      strokeShape._asc
      CanvasV2's local toHex (utils/color.js owns it)
      Renderer._rect (left over from the removed shimmer mask)
      LevelMap.get/has/ensureUp/ensureDown/allFrames/frameRect/mapPoint/
        mapRect/levelPointToScreen, and the dead constant re-export
      KobinEngine._eraserRadiusPx / _selectedIds / _anchorOf
      TileStore._maxContentDepth
      Document.cutById - the pre-arc centerline cut, superseded by
        eraseReplaceById, with no caller anywhere including the tests
      Document.restyleById and the restyle/restyleMany/cut/uncut undo cases -
        all four ops became unpushable when the selection style box was removed
        (2026-08-03), and select.lasso.test.js asserts on purpose that no path
        on the engine can reach a restyle
      useKobinEngine's `restyleSelection` - it forwarded to a KobinEngine method
        that does not exist, so calling it would have thrown
      two imports orphaned by the above: logMath's BAR_PX_MIN/BAR_PX_MAX and
        persist's FRAME_W (the second was already unused before this pass)
      LevelMap's TILE/TILE_DIV now re-export frameLattice's constant instead of
        multiplying it out again under a second name
      geometry/erase.js: 265 of its 338 lines - the whole superseded recipe
        model. Two helpers survive because one suite uses them as fixtures.

    Marked, because they are NOT dead but are not product either:
      [TEST-ONLY]  geometry/cede.js, geometry/erase.js, KobinEngineV0.js,
                   scaleBar/testSupport.js
      [DEV/ORACLE] geometry/bakeStrategies.js, curvePerimeter.js, strokeShape.js
      [DEV ROUTE]  Pages/BakeLab.js, ArcPen.js, ArcBake.js, CanvasV2.js
      [DEV]        KobinEngine.setDebug/setKDebug/setTileDebug/setEraseDebug,
                   the four instrument classes, notePerf/_perf/_note/journal/
                   reportFamilies, snapshot/loadSnapshot, flushBakes/flushErases,
                   useKobinEngine's debug state and sendReport,
                   Document.canUndo/canRedo

    Corrected, because the comment said something that was no longer true:
      TileStore header      "the uncle case is deferred" - it is built (bible 10.5)
      derive.js             "the parent's rings are CUT (geometry/cede.js)" -
                            Document.cedeTileById does it
      derive.js             "deriveStep is the exact port of V0._deriveInto" -
                            it has grown the shape branch and the freeze
      arcShape.js           cited KobinEngine._boolOk, which has never existed
      persist.js            a duplicated comment line naming the retired "2~1"
                            sibling frame id form
      Renderer.js           FAT_WIDTH_PX read as the live gate; cfg.fatWidthPx
                            (4000) is
      Renderer.js           "_selRectFn stays wired because the engine still
                            computes the rect" - it is set and never read
      Document.js           "geometry is immutable once finalized" - four
                            methods mutate it; the invariant is _afterEdit
      KobinEngine.js        a whole preamble above _dragSelection describing the
                            residue accumulation the lattice deleted
      CanvasV2.js           claimed to be the Home target and the v1 redirect
      LevelMap.js           TILE/TILE_DIV re-derived a constant frameLattice
                            already exports
      docs/issue-log.md     "Firebase is decommissioned" - it is live
      docs/UAT.md           case 1 described F-Z as an open failure
      docs/erase-tile-window-design-bible.md, local-frames-design-bible.md -
                            supersession banners added

    The two published pages now carry EVERY function, and are generated:
      The Code Map and the Call Graph covered 255 and 712 functions
        respectively; both now cover all 1,103 across 73 files, each with an
        explanation. tools/docmaps/ holds the generator, which reads the source
        rather than being kept in step with it by hand.
      The Call Graph was relaid out. A Sugiyama layering of 1,103 functions
        needs 4,600 dummy nodes and produces a canvas 33,000px by 1,300 - a
        25:1 strip, not a diagram. Functions are now drawn inside a block for
        the file that defines it, and the FILES are layered by the calls
        between them: 4,119 by 2,225, eleven bands, and it shows which file a
        function lives in, which the flat layering could not.
      21 names the Code Map asserted did not exist in the file it claimed them
        in - eight deleted in this pass, and thirteen that were wrong when
        written, including reverseLoop and levelPointToScreen attributed to the
        wrong file. audit_stale.py is the check that found them and it now
        reports 0; verify_coverage.py reports 0 missing on both pages.
      The graph now MARKS what it knows. 40 entry points (filled), 25
        test-only functions (grey), and the 3 unreferenced ones (struck
        through). tools/docmaps/audit_entries.py finds the entries by reading
        the source - a call inside a registered listener, inside a JSX handler
        prop, inside an effect the interface drives, or a component React
        mounts for a route - rather than by picking the ones that look
        important. That is why setTool is an entry and _bakeTick is not: the
        bake tick re-arms its own timer from inside the engine.
        Three bugs found while building it, all the same shape - a scan that
        ran past the thing it was scanning:
          - a concise arrow body has no braces, so hunting for the next `{`
            swallowed the following function. gesturePrevent ate onKey, and
            every keyboard entry was reported as a pointer entry.
          - the receiver was not checked, so `pointers.has(id)` on a Map
            resolved to scaleBar/ladder.has and was reported as an entry point
            into the scale bar.
          - "test only" was judged on the raw file, so a header comment saying
            a function has no production caller counted AS a caller. That is
            what kept clipPolysToRect off the list; it is judged on comment-
            masked source now.

      "A lot of these functions look unused" - checked. 286 of 1,103 have
        NOTHING CALLING THEM and exactly THREE are unreferenced anywhere in
        src/, tests included: Document.canRedo, LevelMap._edge, and
        curvePerimeter.minDist (a DistOracle method in the retired cubic
        pipeline). Each appears once, at its own definition. The rest break
        down as 105 called as a method on a receiver whose type is not
        resolvable from source (these ARE called - eng.pointerDown is one),
        101 passed as a value, 35 React components rendered as <Component/>,
        26 test-only, 15 getters (read, never called, so no call syntax exists
        to find), and toJSON, which JSON.stringify invokes by protocol.
        ASK IN-DEGREE, NOT DEGREE. The first version of this audit looked for
        nodes with no edges AT ALL, which skips every function that calls
        something but is called by nothing - the exact shape of an abandoned
        function. It hid 150 of them, clipperOutline.clipPolysToRect among
        them (test-only, and its own file header already said so).
        tools/docmaps/audit_isolated.py produces this; the graph marks such
        nodes with a dashed outline and names the reason in the panel.
        Also taught extract.py to resolve `this.x = new SomeClass()` exactly,
        which recovered 24 real edges (the four instrument classes among them)
        and raised agreement with the hand-read list from 86% to 88%.

      Two RENDERING defects, found by looking at the published page in
        Kobin's Chrome rather than at the file. (1) Whole file blocks drew as
        empty rectangles while their neighbours drew perfectly - not layout, as
        0 of 1,103 function boxes fall outside their block: will-change:
        transform promoted the whole 4,244x2,374 drawing into one composited
        layer, which Chrome rasterises at the current zoom, and at 2x on a 2x
        display the compositor drops tiles rather than allocate ~150 Mpx of
        texture. The page now pans and zooms by setting the root viewBox.
        (2) At "fit" (k=0.24) every label was 2.4px of grey. Function labels
        are now hidden below k=0.5, so the overview is a file-level map, and
        file names counter-scale with a per-block ceiling so they neither
        vanish nor cross into the block beside them.
        Same lesson as rule 3 in 00-START-HERE: neither was visible in the SVG.

      Two counting bugs in the tooling, both worth knowing: constructors were
        never detected (the definition scanner shared a keyword list with the
        call-site scanner, which excludes `constructor` for `new Foo()`), and
        brace-depth counting drifts in JSX, which had swallowed every top-level
        declaration after line 475 of CanvasesV2.js. Column zero is now a
        second witness alongside depth.

    Verified after every change: 867 fast tests and 598 slow tests, all green.
```
