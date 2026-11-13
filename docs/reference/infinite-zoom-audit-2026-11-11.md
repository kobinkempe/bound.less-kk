# Infinite zoom — what limits depth (audit, 2026-11-11)

Kobin, 2026-11-11: "besides my Firebase size limits, is anything else stopping from actual infinite zoom? We want to be
able to say with confidence - infinite zoom is possible." This is the code read and the measurements. Each finding says
where it was measured.

## What has no depth limit, by construction

- **Coordinates.** A frame is a lattice cell; every stored coordinate is inside its frame, [−W/2, W/2), so a level
  10,000 down has the same float precision as level 0. Crossings, sideways shifts and moves are digit arithmetic on
  powers of two (`frameLattice.js`): exact at any depth.
- **The camera** is a frame plus an in-level scale and pan. Depth is an integer: exact to 2⁵³ levels.
- **The picture.** A tile below an object's home is derived from its parent's tile, a clip and a magnify per level,
  each step exact. Nothing maps a whole chain in one product (except F167's scalars, below).
- **Measured working at 84, 86, 100 and 130 levels** (jsdom, raster renderer, `src/engine/__review__/deepzoom-engine.probe.js`,
  untracked): a level-0 bar renders at its edge; drawing; a notch erased into the level-0 bar from that depth; a piece
  cut off a stroke drawn there; z-order; undo and redo; save and reload (the reloaded camera at the same depth, the
  same ink at a probe point).

## What limits it today

### 1. The zoom number is one double (F167) — fixed 2026-11-11
`LevelMap.frameFactor` multiplies one ×4096 per level, so it is exact to 85 levels and Infinity from 86 (its inverse 0
from 90). Measured (`deepzoom-engine.probe.js`): at 84 levels the label reads "2.7×10³⁰³×" and the scale bar "2e-239 qℓP";
from 86 the label read "1×" and the scale bar was frozen at "5e-257 qℓP". The scene zoom and the scale definition's
`zoomAt` are the same double (saved as JSON `null` once infinite). Every edge is ×4096, so the factor between two frames
is exactly 4096^(depth difference): the zoom is exactly `log2 = 12·depth + log2(inScale)`, a number that never overflows.

**Fixed** (OPEN-FLAGS F167): the camera carries `zoomLog10`; the label, the scale bar, a scale's anchor and the scene
labels read it past a double's range. After, same probe: 86 levels "4.6×10³¹⁰×" / "2×10⁻²⁴⁶ qℓₚ"; 100 "1.7×10³⁶¹×" /
"5×10⁻²⁹⁷ qℓₚ"; 130 "4×10⁴⁶⁹×" / "2×10⁻⁴⁰⁵ qℓₚ". Notation, compared: the exponent is grouped by thousands from 1,000
("4×10³⁶,¹²³×" at 10,000 levels) and itself scientific from a million ("10^(4.1×10¹⁵)×" at 2⁵⁰ levels). A double counts
levels exactly to 2⁵³, so the zoom never passes about 10^(3.25×10¹⁶): one exponent of an exponent is the most it
needs. Knuth's up-arrows write power towers (10↑↑n), which this zoom never reaches; they would only shorten numbers
the label never has to show.

### 2. Frame ids are full paths — fixed 2026-11-11 (F192)
An id was its parent's id plus "/i,j" (only the origin chain, the spine, has short ids "0", "1", …). Off the spine an id
grew 4–10 characters a level. Measured on the lattice alone (jsdom, `__review__/deepzoom-ids.probe.js`, one chain off
the spine, nothing drawn), before the fix:

| depth | last id | serialized lattice | `framePath`, cached | heap |
|---|---|---|---|---|
| 100 | 975 chars | 0.10 MB | 15 µs | +0.2 MB |
| 1,000 | 4,000–9,900 chars | 4–10 MB | 0.1 ms | +2 MB |
| 10,000 | 40,000–99,000 chars | 400 MB (digits 0,0); **cannot be serialized** with real digits (`RangeError: Invalid string length`) | 1–2.3 ms | +3–12 MB |

Memory is not the problem (V8 keeps the ids as ropes). The save is: every frame record and every frame key of the
natives writes its whole path, so a deep chain saves in O(depth²). And every lookup whose key is built from ids
(`framePath`'s cache key `from|to`) hashes the whole path, O(depth) a call. The ids carry information that is needed
(the digits are the position), but each frame needs only its own two digits and its parent: stored that way the save
is O(depth).

The cloud copy had a harder limit (read in the code, not measured): `canvasSync.js` puts a frame's id into the
document id of each part of its chunk (`f_<frame id>_…~i`), and the manifest maps frames by id. Firestore refuses a
document id or a field name over 1,500 bytes, which a path id passes somewhere between 150 and 370 levels down
(4–10 characters a level), so a canvas with ink that deep could not have synced.

**Fixed** (OPEN-FLAGS F192, Kobin's call: "parent + 2 digits"): an off-spine frame is named `h<code>:i,j`, the code 14
base-36 characters hashed from its parent's id, at most 27 characters at any depth. Plain counters were considered and
set aside: the raster worker mints frames on its own copy of the lattice and they are merged back by id (F67), so
counters would give one cell two names; a name computed from the parent and the cell is the same in every copy. The
tree was already pointers (`parent`, `_kids` by cell); only the names changed. Drawings keep the ids they have.
After, same probe: the last id is 19–26 characters at every depth; a 1,000-level lattice saves in 0.08–0.10 MB
(loaded in 3–4 ms) and a 10,000-level one in 0.85–1.03 MB, written in 5–15 ms and loaded in 27–30 ms. A file holding
a new name is written as version 4, which the build before it refuses as newer.

### 3. An erase far below the object it cuts makes one object per level between
To cut an object d levels above the eraser, the descent cedes the square under the eraser at every level between
(`eraseDescent.js`), so the drawing gains about one kid per level. Measured (jsdom, the notch in
`deepzoom-engine.probe.js`): 3.4 s and 88 frames with natives at 84 levels; 7.6 s and 134 at 130 — 40 → 58 ms a level,
growing. Linear or worse in the depth difference: an erase of a level-1 object from level 10,000 would make ~10,000
objects and take many minutes.

### 4. Walks are O(depth) a call
`_ancestors`, `framePath` (cached, but the cache is dropped at every mint), `nearWalk` (every level up to the root),
`chainFrom`, `isUnder`. Linear per call; fine at hundreds of levels, measurable at thousands.

### 5. An erase across a frame edge left a seam that grew below it — fixed 2026-11-11 (F182)
Not a depth limit but a seam that zooming in finds. An erase across a frame edge at its own level is cut in each
square's own coordinates, and the two kids' cut edges met a last bit apart, a gap that grew 4096× a level. Measured
(jsdom, `__review__/f182-seam.probe.js`, 21 erases at levels 1–3): 13 stepped, 38–256 px three levels below at that
level's deepest zoom and up to a million four below. The eraser's arc centres rounded when moved a whole frame, and
the two squares worked out a straight side's crossing in opposite orientations. **Fixed**: the eraser is rounded once
onto a grid whole-frame moves keep exactly, and a later square takes an earlier one's crossings of their shared side:
all 84 seam crossings 0 at every depth to four below.

### Lasso and move across levels: works
Kobin's scenario at depth (jsdom, `__review__/deepzoom-lasso.probe.js`): a mark drawn at depth d, a stroke drawn 20
levels up (8 levels up for d = 5 and 8), one lasso round both, a drag, then back in to the mark. The lasso takes the mark's frame
whole; the move is exact (the mark's box lands where it was dragged) and the mark is found again at d = 5, 8 and 40
(with a notch erased beside it), on both renderers. One thing to know when testing it: a speck 5+ levels below the
view cannot be reached by zooming about one fixed screen point (a double cannot place a screen point that finely: the
first probe aimed at the mark's box rounded to 0.01 px and landed 13,000 units off five levels down). A person
re-aims as the speck grows; the probe does the same, re-aiming at the mark on every step.

### Selecting and erasing across many levels: works
- A level-0 bar tap-selected from 84, 100 and 130 levels below its edge (jsdom, `__review__/deepzoom-select.probe.js`):
  the same ants as from 3 levels (the ink leaves the screen at the bar's edge), the drag lands as dragged, undo
  restores. The selection's ants never multiply a chain (`_selDecide` reads what is drawn); the one outline that did is
  the erase-debug overlay (`overlays.js` ~249), which now skips a level whose pixel size overflows.
- A mark drawn 10, 30, 84, 90 and 130 levels down, erased from level 0 (`__review__/deepzoom-erase-down.probe.js`):
  it lies wholly under the eraser and goes whole, in about 10 ms; undo brings it back. Both renderers.

## In Chrome, to 10,000 levels (2026-11-11 and 12)

Kobin's dev build in his Chrome (my own tab, a scratch canvas, signed in), the raster renderer. Timed in the page
(`performance.now`, a long-task observer, `E.perfLog`): the extension's window ran `requestAnimationFrame` at 2–8 Hz
while it reported itself visible, so frame rates were not measured. Camera steps were driven through the engine's own
`zoomFactorAt` and `panBy`, a crossing at a time unless said.

**What worked at every depth tried.**
- A level-1 bar's edge stayed on its pixel row from level 1 to 1,151 (screenshots at 1, 100, 1,000 and 1,001).
- The scale bar: "100 µm" at level 1, "2×10⁻²⁹⁷ qℓₚ" at 100, "10⁻³,⁵⁴⁸ qℓₚ" at 1,000, "10⁻⁵,¹⁷⁶ qℓₚ" at 1,451,
  "5×10⁻³⁶,⁰⁶¹ qℓₚ" at 10,000 (zoom 10^36,124.9).
- At level 10,000: a stroke (drawn in 87 ms), undo and redo of it, two 0.5-opacity strokes crossing (the newer on top,
  their overlap blended), a stroke cut in two places (clean gaps, the family count +1 each).
- A notch erased into the level-1 bar from 100, 1,001, 1,151, 1,301 and 1,451 levels below it; a piece cut off a
  stroke at level 100.
- Kobin's lasso scenario: a mark drawn at 10,000; the camera out to level 500 about it, where it is a point at the
  spot; a stroke drawn beside it; one lasso round both (124 ms: it took the stroke and the mark's frame); a drag of
  (−300, +200) px moved both by exactly that; then back in to the mark, re-aiming each level, to 10,000: found, never
  lost. Undo and redo of the move re-address the mark's chain and bring it back exactly (after F201).
- Save and reload at level 1,001: every object back, the first render 1.1 s (after F194). At level 10,000 (33,208
  frames): the camera back in the same frame, all 1,764 objects, renders of 19 and 625 ms; the heap peaked at 2.3 GB
  during the load and was 135 MB eight seconds later.
- Zooming out: 1,451 levels in 1.5 s, 9,500 levels in about 30 s, 10,000 to 0 in 8.9 s, and 0 to −10,000 (above the
  first root) in 0.4 s, where a stroke draws and the scale bar reads "2×10³⁶,⁰⁷⁵ Qpc"; back at 0 the level-0 drawing is
  intact. A zoom out and back in about one screen point returns to the frame's centre, not the start, past a few levels:
  a point cannot be placed that finely (re-aiming finds it, as above).
- Panning 10,000 screens and back: 3.8 s each way at level 10,000 (1,800 frames crossed), 0.1–0.7 s at level 0; a
  stroke and a level-0 bar back on exactly the same pixels.
- Z-order against a giant: a 300 px stroke drawn at 9,700, the camera 300 levels down inside it (the screen all its
  grey), a stroke drawn there shows on top, and everything drawn there before is under it; a hole erased in the giant
  from 10,000 (300 levels ceded) shows the paper (193 s frozen: F196).
- Scenes: the index lists every place drawn, −10,000 to 10,000, labelled in F167's notation ("at 6.1×10³⁶,¹²²×",
  "at 1/4.1×10³⁶,¹²¹×"); a click on a level-10,000 scene from level 0 jumps there in about 0.5 s.
- Real input: a stroke drawn with the mouse and the toolbar's pen at level 10,000 lands as one object, crisp.

**Speed at depth.** One level crossing at 10,000 takes 20–43 ms and a 100 px pan 3–4 ms (after F197). Descending
0 → 10,000 in steps of 200 crossings took 392 s; a step that large is the driver's, not a person's.

**Found in Chrome and fixed** (each with a jsdom test that fails without it):
- F193 — every crossing walked to every frame holding plates: 0.5–1.4 s a crossing at 1,000; now 7–33 ms.
- F194 — a reload at 1,001 overflowed the stack (the up chain's recursion).
- F195 — the family check of a deep cede, O(n² × depth): 152 s for 1,150 members; the same notch now 74–78 s in all.
- F197 — the four callers of the near-frame walk mapped their rect a level at a time, a path each: one down-tile bake
  at 10,000 built 10,002 paths, froze the page about 50 s, and the cache held 2 GB of paths; now 5 paths, worst task
  213 ms.
- F200 — the near-frame walk recursed a call a level below the view: drawing at 500 over the mark at 10,000 threw
  `RangeError`.
- F201 — joining and splitting co-resident chains recursed a call a level: undoing the move threw `RangeError`.

**Found, then fixed at Kobin's word (2026-11-12, jsdom; measured in Chrome the same day):**
- F196 — an erase d levels below its object patched every cached tile below each ceded piece: O(d²), in one task. A
  150-level notch 1,450 levels down froze the page 20.4 s; a 300-level cede at 10,000 froze it 193 s. Now a descent
  job cedes 8 crossings, the tiles take each job's net change (a kid's pieces renamed in the deep tiles, not derived
  again), and the family check asks no pair already joined. jsdom: a 300-level cede is 38 tasks of 16–87 ms, a
  1,000-level one 125 tasks under 50 ms. Chrome (scratch canvases): 300 levels below a stroke at level 0, 38 tasks
  (worst 82 ms), 2.0 s; 1,000 levels, 125 tasks (worst 0.18 s), 10.1 s (was one task of 158 s); the 300-level notch
  at 10,000, 38 tasks of about 0.4 s, 21.6 s (was one task of 193 s). Ink drawn at the eraser's level could be
  selected at once while each bake ran; the baking stroke waited for its bake. At 10,000, three quarters of a task
  built lattice paths to the root (`LevelMap._buildPath`, for the Stage's dirt boxes). Since 2026-11-12 a path climbs
  only the levels between its ends. Chrome, the same notch measured before and after in the same hour: median job
  200 → 90 ms, settled 13.5 → 10.0 s. What is left is the cede's own levels.
- F198 — an erase's candidate scan mapped its box to every level holding ink, through a full-depth path each: 7.6 s of
  a 19 s cut at 10,000. Now from the frames the near-frame walk reaches: the same candidates, no path a level.
  Chrome: a mark's registration at 10,000 took 0.14 s.

**Found and open:**
- F199 — the cloud manifest is one Firestore document holding the whole lattice; at 12,457 frames every push was
  refused. The local copy saved throughout.

## Beyond 10,000: 100,000 and 1,000,000 levels (2026-11-12)

Kobin, 2026-11-12: "can you do a few more powers of 10 tests? Maybe level 100K, 1M, and 100M, just to check for any
other overflows? ... What is the theoretical next breaking point?"

**Where and how.** The desktop app's built-in browser pane (Chromium 156, a 4 GB JavaScript heap), not signed in, so
the saves were local: at these depths every cloud push would have sent a 6–100 MB lattice that F199 already says is
refused. A new scratch canvas (binned after), the raster renderer. The camera went down the origin chain by
`LevelMap.ensureSpine` and `jumpTo`, as a scene click does: a level is ×4096, about 120 wheel notches, so even ten
levels a second nonstop is 3 hours to 100,000 levels and 28 hours to 1,000,000. The slow erase suite ran on the same
machine throughout, with 1.6–2.7 GB of RAM free, so the times at 1,000,000 are inflated by memory pressure.

**At 100,000 and 120,000 levels: everything tried worked.**
- The label: "9.9×10³⁶¹,²³⁵×" at 100,000, "1.6×10⁴³³,⁴⁸³×" at 120,000.
- Arriving: the chain built in 0.2 s, the first render 1.4 s, then one task of 7.8 s (the first bake tick's render
  warming the up chain a level at a time).
- At 120,000: a crossing 70–110 ms with its render, a 100 px pan 5 ms, a stroke 49 ms, undo and redo; a lasso and a
  drag (0.6 s, moved by exactly the 100 × 50 px dragged); a notch erased across the stroke (0.9 s, cut in two), undo
  and redo of it; autosave 0.25 s; a reload put the camera back at 120,000 in the same frame with every object, its
  first render 6.8 s. Heap 90–170 MB at rest.

**At 1,000,000 levels: everything tried worked, slowly. No overflow, NaN, `RangeError` or stack overflow.**
- The label: "10^(3.6×10⁶)×" (from about 277,000 levels the exponent is itself scientific, F167's notation).
- Arriving: the chain built in 12.6 s; the jump was one task of 310 s; heap 1.3–2.4 GB.
- A crossing: 0.3–0.8 s for the camera, then 10–15 s for its render (68 s the first). A 100 px pan 0.23 s, a stroke
  8.5 s, undo 0.6 s, redo 10.7 s. Each autosave 8–10 s: the whole lattice is rewritten, every save.
- A reload: back at level 1,000,001 with all 1,880,003 frames and every object after 380 s, 331 s of it one render.
- The stroke dragged at 120,000 made a second chain: a moved object's picture below its home is read through its
  unmoved address, and that chain was minted a frame a level down to the camera, 880,000 frames (1.88 million in
  all). One crossing, profiled (12.5 s): `LevelMap.objShift` walked that chain six times (8.5 s, 3.5 million
  `cellChild` calls); the rest was walks to the root (`nearWalk` 2.2 s, `rectUpChain` 1.3 s, `pointsUpChain` 1.0 s,
  `framePath`/`_ancestors`/`chainFrom` about 2.5 s). Each is O(depth) a render (OPEN-FLAGS F202).
- The gallery badge reads "1000001 levels deep", without a thousands separator.

**The lattice alone** (Node 14, `src/engine/__review__/deep-lattice.node.js`, untracked, no ink): 100,000 levels 62 MB, built in 0.24 s, saved as 5.5 MB of
JSON, loaded in 0.23 s; 1,000,000 levels 546 MB, 2.0 s, 58 MB, 2.1 s. Linear. A frame costs about 570 bytes in Node
and 465 in Chrome (whose V8 compresses pointers).

**100,000,000 levels cannot be reached in this build.** The lattice keeps one frame object per level of every chain,
all in one `Map`: 100 million frames would be about 47 GB, and V8 caps a `Map` at 2²⁴ = 16,777,216 entries (measured
in Chromium 156: "Map maximum size exceeded" at exactly that size).

## At the depth limit: 2⁵³ − 1 levels (2026-11-12, with the compact lattice)

Kobin, 2026-11-12: "run some tests at the theoretical limit ... I want to be able to say its been tested. At the limit,
calculate the actual zoom factor, rounded down to the nearest power of 10."

**Where and how.** After F202's runs (`docs/reference/compact-lattice-design-2026-11-12.md`): the desktop app's
built-in pane (Chromium 156), the dev server, not signed in (local saves), a new scratch canvas, binned after. The
camera went down by `ensureSpine(Number.MAX_SAFE_INTEGER)` and `jumpTo`, as a scene click does.

**Everything tried worked.**
- The jump: 10 ms; the lattice 2 frames (one run of 2⁵³ − 2 empty levels); heap 32 MB. The label: "10^(3.3×10¹⁶)×".
- A zoom in stopped at inScale 256, the crossing it cannot make (`MAX_DEPTH`); 20 more wheel notches changed nothing.
- A pen stroke and a partial erase, both real drags: drawn, cut in two, undo and redo. A lasso (26 ms) and a real drag
  of one piece. A crossing out to 2⁵³ − 2 and back: 0.7 and 0.2 ms of camera work, 3 frames.
- Saved locally and reloaded: the same level and view, both pieces where they were, the scene list (the index's base
  depth from the file) and the undo history; no long task after the reload.

**The zoom there**, at depth 2⁵³ − 1 = 9,007,199,254,740,991 and inScale 256: 256 × 4096^(2⁵³ − 1), whose log10 is
32,537,245,831,191,544.49, so the zoom is 10^32,537,245,831,191,544× rounded down to a power of ten (computed with
100- and 140-digit decimals, the same floor both times).

## Where it gives out, in order of depth

Measured where it says so; the rest computed from the code. Since the compact lattice (F202) a jump's chain is a few
frames at any depth; a hand zoom keeps a frame a level (its cell changes level to level), so the frame rows below are
a hand zoom's.

| Depth | What gives out | Kind |
|---|---|---|
| ~8,000–9,000 levels | Was: the cloud copy, the manifest holding the whole lattice under Firestore's 1 MiB cap (F199). Past 512 KB the lattice and frame list now go into an index chunk. | format; fixed 2026-11-12 |
| ~100,000–1,000,000 | Speed, a frame a level: every render walks the chain, and a moved object above walks its own. 1.4–7.8 s to arrive at 100,000; 10–15 s a render at 1,000,000. Through runs (a jump) a render is milliseconds at any depth (F202). | walks; a hand zoom only |
| a few million | The tab's memory: about 465 bytes a frame, a frame a level per chain, and a save or reload holds a second copy for a moment; 1.88 million frames took 1.3–2.4 GB of the 4 GB. | a hand zoom only |
| 16,777,216 frames | V8's `Map` cap: the next frame throws, whatever the memory. | hard; a hand zoom only |
| ~7–9 million frames | The "download as .json" export: one string over V8's 536,870,888 characters (measured: "Invalid string length"). Local saves go to IndexedDB without a string. | export; a hand zoom only |
| ~10¹³ levels | With a scale set, the bar's length moves in 2 % steps; 15 % at 10¹⁴; at 10¹⁵ it no longer follows the zoom. The zoom log is one double, depth × 3.61 + the in-level part, and its last bit grows with depth (computed with the app's scale-bar code, `__review__/deep-labels.node.js`). | display |
| ~10¹⁴ levels apart | The scene list measures widths from one base depth; ink that far from it is grouped and framed coarsely. | display |
| 2⁵³ − 1 ≈ 9.0×10¹⁵ levels | Depth itself: one more and `depth + 1 === depth`. The camera stops there in 1.0 (`MAX_DEPTH`); measured above. From 1.1 a depth past it is base-10¹⁵ limbs, as many as it needs, and there is no stop (`depth-overflow-design-2026-11-13.md`). | hard in 1.0; none after |
| a depth 2×10⁷ digits long (10¹⁹ ⁹⁹⁹ ⁹⁹⁹ levels) | From 1.1, the test computer: every step works in the app (its built-in pane, measured 2026-11-13), each in seconds (a crossing 9–27 s), the tab holding 2.8 of its 4.2 GB; jsdom went to 3×10⁷ digits. A step's cost grows with the depth's digits. | time and memory (1.1) |

The last two are out of reach: at ten levels a second, 10¹³ levels is 30,000 years of zooming. What would move each:
the walks become per-frame memos (each frame keeps what its walks need, extended a level at a time, as `_upTo` does
for tiles); the memory and `Map` walls need runs of empty frames kept as one record (a chain of (0, 0) cells is a
count), the same compact chain F199's fix proposes for the save; the scale bar needs the in-level zoom carried apart
from depth; depth past 2⁵³ needs a bigger integer (built after 1.0: `depth-overflow-design-2026-11-13.md`).

## Is anything else stopping infinite zoom?

**In the model, no.** Every stored coordinate is relative to its own frame, so precision does not decay with depth;
crossings and moves are exact digit arithmetic; a frame's name is the same length at every depth (F192); the zoom is
carried as its log (F167); depth is an integer exact to 2⁵³ levels. Nothing composes a whole chain into one number.

**In this build, the limits are costs that grow with depth, and every one found so far is a walk, not a wall:**
- Recursion a level deep overflowed the stack at about 1,000 (F194) and 9,500 levels (F200, F201). Those found are
  rewritten with their own stacks; any other recursion over a chain would fail the same way, and is found the same way.
- Work that was O(depth) a call became O(depth²) where a caller made a call a level (F193, F195, F197) or a scan
  visited every level (F198). The fixed ones are linear now.
- An erase far above its object makes a piece a level between (by design). Landing them was O(d²) in one task; now
  it is linear, in tasks of 8 levels (F196; in Chrome no task over 0.2 s to 1,000 levels, about 0.4 s at 10,000).
- The cloud copy's manifest grows by about 100 bytes a level of depth, whatever is drawn, and Firestore caps a
  document (F199). This is the one limit tied to Firebase besides storage size, and it is a format choice, not a
  limit of the service: the lattice can go in parts like the ink.

So: infinite zoom is possible, and at 10,000 levels drawing, navigation, selection, moves, undo, opacity and z-order
work at interactive speed. An erase across thousands of levels was not practical (F196, F198); both are fixed
(2026-11-12): in Chrome a 1,000-level notch lands in 10 s of short tasks and the 300-level notch at 10,000 in 22 s of
0.4 s tasks, where they froze the page 158 s and 193 s. Still open: the cloud copy of ink deeper than about 8,000–9,000 levels (F199).
At 100,000 levels everything tried works; at 1,000,000 it works but every render takes seconds (F202); a tab's
memory ends it at a few million levels, and no number gives out before 10¹³ (the table above).
