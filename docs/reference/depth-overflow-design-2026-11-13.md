# Depth past 2⁵³ — a depth that grows as needed, with no limit

2026-11-13. Kobin: "think about that 2^53-1 limit - can we just add an overflow integer? What's the next limit
reached? Go ahead and add the overflow, dynamically so overflows could keep being added. Obviously the memory limit
would be a big deal too." Built on the branch `deep-overflow` after version 1.0 and released as 1.1 the same day.

Then, the same day, on the first build (a BigInt past 2⁵³, the camera stopped at 10^100,000 − 1 levels): "I don't want
that as the premise of the app is truly infinite zoom ... I'd almost rather not know what that limit could be, say the
zoom is infinite, and if someone finds an issue on their magical supercomputer, then we can just call it a bug, not a
limitation, which can be easily patched. It sounds like bigint isn't really the idea I was thinking of, if it does
indeed have a limit ... I'd just like to be able to say that I don't know of any limits to actual infinite zoom
besides the limits of your computer, and it's been tested down to some rediculous number, whatever that may be, which
we chose because we started hitting the limits of the testing computer."

## In plain words

A level's depth was an ordinary JavaScript number, which counts exactly only up to 2⁵³ − 1 (about 9 × 10¹⁵); past it,
adding 1 changes nothing, so version 1.0 stops the camera there. Now a depth stays an ordinary number while it fits,
and past 2⁵³ it becomes a list of 15-digit numbers that gains another whenever it runs out: Kobin's overflow, built
literally. **There is no deepest level and no camera stop.** Nothing below a level's record changes: ink, tiles and
coordinates are all measured from their own level, never from the top.

JavaScript's own big integers (`BigInt`) were the first build, and they have a cap: about 2³⁰ bits (10³²³ ²²⁸ ⁴⁹⁶
levels) in Chromium and in Node, measured. The list has none of its own. What a deeper depth costs is time and memory
on the computer: every step that reads a depth's digits (a level's name, a save, a crossing) takes longer the more
digits it has. That growth, measured below, is "the limits of your computer".

**Tested to:** a depth twenty million digits long, 10¹⁹ ⁹⁹⁹ ⁹⁹⁹ levels down (a zoom of 10^(3.6 × 10¹⁹ ⁹⁹⁹ ⁹⁹⁹)×), in the
app: the desktop app's built-in Chromium pane on a Surface Laptop 3 (i7-1065G7, 16 GB). Every step worked there, each in
seconds (a crossing 9–27 s, a save 11.5 s), with the tab holding 2.8 of its 4.2 GB: the test computer struggling, which
is why the testing stopped there. The test harness (jsdom, no paint) went to thirty million digits. The numbers are
under "Measured" below.

## The representation

`src/engine/depth.js`. A depth, or a count of levels, is a Number while it is a safe integer and a `Deep` outside
±(2⁵³ − 1), never otherwise.

- **A Deep** is a sign and base-10¹⁵ limbs, little-endian, each limb a Number below 10¹⁵ (exact: a sum of two limbs and
  a carry stays under 2⁵³). As many limbs as the value needs: a million-digit depth is 66,667 limbs.
- **One value, one object.** A Deep is immutable and interned: a table keyed by a hash of its limb count and its two
  ends (nearby depths differ in their low limbs) holds each value weakly (`WeakRef`, cleaned by a
  `FinalizationRegistry`), so a value computed twice is the same object while either is held. So `===`, `Map` keys
  (the spine map is keyed by depth) and ids keep working as they did for Numbers.
- **Fails loudly.** A Deep's `Symbol.toPrimitive` gives its digits for a string and throws a `TypeError` for a number
  or the default hint: `d < 5`, `d + 1`, `d - 1`, `-d`, `Math.max(d, …)` and `"x" + d` all throw. A site that was missed
  fails the first time a depth past 2⁵³ reaches it, never silently. `String(d)`, a template literal and
  `JSON.stringify` (its `toJSON`) give the digits.
- **The operations**, all exact: `add`, `sub` (two Numbers are added as Numbers, and redone in limbs when the sum is
  not a safe integer, so an ordinary depth pays one `typeof` and one `Number.isSafeInteger`); `cmp` for sorts and
  `lt`, `le`, `gt`, `ge`, `min`, `max`, `abs`, `neg` (a Number against a Deep is decided by the Deep's sign, ±Infinity
  works as a bound, and any other double past 2⁵³ is compared exactly); `toNumber` (the nearest double, ±Infinity past
  1.8 × 10³⁰⁸) for float maths that saturates anyway; `log10Abs` (from the top limbs and the length) for the zoom
  label; `parse` (a safe-integer Number, a Deep, or a canonical decimal string of any length: no sign but `-`, no
  leading zero, no spaces); `toJSON`; `isDepth`, `isBig`.
- **No BigInt anywhere in it**, and no BigInt literals or `**` in production code: CRA 4's webpack parser and the
  es2019 worker bundles reject `1n`, and a build may turn `**` into `Math.pow`. (`raster/level.js` keeps BigInt plate
  indices of its own, refused past 2²⁰ octaves; `geometry/detMath.js` reduces huge trig arguments with BigInt. Neither
  is a depth.)

**The rule:** every sum, difference and comparison of depths or level counts goes through `depth.js`, even when both
are Numbers, because two safe depths can sum past 2⁵³ and round without a sound.

**Structured clones.** `postMessage` and IndexedDB copy a Deep's fields and drop its class, so where a depth crosses
one it is written as `toJSON(d)` and parsed on arrival: the scene worker's frame records (`sceneIndex.frameRecord`, read
by `FrameTable.update`) and its saved `base`, a worker descent's minted frames (`eraseDescent`, read by
`LevelMap.merge`), and the journal's frame entries and subtree addresses (`oplog.frameFile`, `atFile`, read by
`readdressMany` and `restoreFrame`). A plain object is never mistaken for a depth: `parse` refuses it and `add` throws.

**Loops over level counts.** A walk that steps a run a level at a time stops once its numbers repeat, within about a
hundred steps, so its count is taken as `toNumber(n)` (Infinity past 1.8 × 10³⁰⁸ is as good a bound);
`frameLattice.js` may import nothing, so `powR` and `displacementDigitsSparse` read a Deep count by its sign.

## Where depth lives (the sites)

- **The lattice** (`LevelMap`): a frame's `depth`, a run's `n` and the levels within it, the spine map (keyed by
  depth), spine ids (`String(depth)`) and stretch ids (`s…:i,j*k`, k a level count), `ensureSpine`, `pathFrameAt`,
  `_frameAt`, `_unfold`, the walks' run steps, the move's `atDepth` and digit positions (`addDigitsSegs`),
  `serialize` / `load` / `merge` / `restoreFrame`, `zoomLog10` and `zoomLogLog10`.
- **The camera**: `activeLevel`. No stop: a crossing is made at every depth, either way.
- **The tiles** (`TileStore`): `_depth`, run levels keyed `K^k`, the run tile, the chain memo; `raster/level.js`'s
  segment counts; `PicturePyramid`, `RasterRenderer` (a crossing's `R^Δdepth`).
- **Selection, moves and erases**: `selection` (the drag's depth, the camera depth a move is measured at), `offsets`
  (a table is keyed by depth below the home; past an array's last index a key is the Deep's digits, read back by
  `parse`), `erasePipeline` / `eraseDescent` (the home's depth), `overlays` (the selection's dots), `placementModel`,
  `Document`, `oplog`.
- **The scene list**: `sceneIndex` (widths are measured from `base`, so a canvas's own depths stay small Numbers there;
  the base itself may be a Deep) and `sceneClient`.
- **Files**: `persist`, the cloud manifest and index (the same lattice JSON), the journal, the gallery's stats
  (`localCanvases`), reports.
- **What a person sees**: the zoom label and each scene's in the scene list (past about 5 × 10³⁰⁷ levels worked out
  from the Deep's length and leading limbs: "10^(3.6×10¹⁰⁰⁰)×"), the scale bar, the gallery's badge (the levels a
  drawing spans; past 2⁵³ in the label's form, "1.8×10¹⁹ levels deep"), the dev panel's LEVEL (past 40 digits, its
  ends and its length).

## Finding every site

The BigInt build needed only sums converted (`<` works between a Number and a BigInt). A Deep throws on comparisons
too, so every one had to be found, including those no deep test reaches. Three passes:

1. **Every exercised site, by running the whole quick suite with every depth a Deep.** A throwaway variant of
   `depth.js` (never committed) made every non-zero depth a Deep, however small, and had a coercion log its call site
   and answer with the exact Number instead of throwing, so one run listed every site any of the ~2,700 tests reaches:
   115 in production code (`LevelMap` 57, `TileStore` 15, `offsets` 14, `erasePipeline` 8, `sceneClient` 4, …), each
   converted. (The run took 1.9 hours: a stack captured at every coercion.)
2. **A static scan** (Babel's parser over `src/`): every native operator whose operand reads like a depth, and every
   variable bound to `depthOf`, `.depth`, `run.n`, `.rn` or a `depth.js` result and then used with `<`, `+`, `++`,
   `Math.*` or `Number(…)`. Two more: `KobinEngine`'s up-or-down test and the selection's dot depth (`deepAt++`).
3. **The deep tests themselves** (below), at 2⁵³ + 2, 2⁶⁴, a googol and past 10¹⁰⁰ ⁰⁰⁰ levels either way.

## Files: the app's version, 1.1

A file holds a depth past 2⁵³ as its decimal string: a frame's `depth`, a run's length, the camera's `activeLevel`,
the scene index's `base`, an offset table's depth, a journal move's frame depths. A file's depth is as long as the
file: there is no digit cap on reading one either.

**Versions (Kobin, 2026-11-13).** This first planned a version 6 for such files only, every other file staying at
version 5 or lower so that version 1.0 would still open it. Kobin chose otherwise: "Versions would always be saved as
the version of the app that saved them, so backwards-compatible code doesn't have to run for newer drawings", and
"I'm much more worried about backwards compatibility than forwards compatibility" (it is a web app: a reload brings
the newest). So this release is **1.1**, and every file it saves says `"version": "1.1"` (`persist.FILE_VERSION`, the
app's major and minor: a patch release does not change a file). A file from 1.0 or before carries a whole number (1–5,
the lowest format number it was written under then) and reads as "1.0". A file newer than the app is refused with
"this drawing was saved by a newer version of bound.less (1.2; this page is 1.1): reload to update". Version 1.0, which
reads whole numbers only, calls a 1.1 file "missing or invalid version": only a page open from before the update sees
that, and a reload fixes it. A frozen `v1.1.svgi` joins 1.0's five in `src/engine/__testkit__/compat/`, and it must open
in every later release. The cloud writes the same header, so a canvas saved by 1.1 says 1.1 there too.

## What is approximate, and stays so

- **The zoom label**: `zoomLog10` is a double. Past 2⁵³ levels it is close, not exact, and past about 5 × 10³⁰⁷ levels
  it would overflow, so the label there is worked out from the Deep and reads like 10^(3.61 × 10¹⁰⁰)×.
- **The scale bar** steps from about 10¹³ levels, as before (display only, an easy knock-out).
- **The scene list's widths** are exact near the base depth and rounded far from it, as before.

## What a person meets first, and what the computer meets

- **A hand zoom keeps a frame a level** (its cell changes level to level; Kobin's 1b: runs come from jumps), so a hand
  zoom's memory grows with the levels zoomed: about 465 bytes a level in Chrome, a few million levels in a tab's 4 GB.
  At ten levels a second that is days of zooming. A jump is a handful of frames at any depth.
- **And time to zoom.** Zooming from the width of the Milky Way to a proton every second, 2⁵³ levels take 28.8 million
  years and a googol (10¹⁰⁰) levels 3 × 10⁹¹ years. At a googol levels the zoom is 10^(3.6 × 10¹⁰⁰)×, more than a
  googolplex.

## As built (2026-11-13, the branch `deep-overflow`)

- **The module**: `depth.js` as above. Checked by `depth.test.js`: one form per value and interning (`===`, Map keys),
  exact across ±2⁵³ and across limbs, 4,000 random sums, differences and orders checked against BigInt (break-checked:
  a carry, a borrow and a sign order each broken fail it), the throws, parse and print, a million-digit depth parsed,
  carried, compared and read back.
- **The camera's stop is gone** (`Camera._atLimit`, `_scaleAboutCentre`, 1.0's `frameLattice.MAX_DEPTH`).
- **A jump far up** mints one root and a run down to the old one (`LevelMap._growRootRun`), as a jump far down does;
  1.0 minted a frame a level up.
- **Checked** (jsdom):
  - `lattice.depth.big.test.js`: a lattice 2⁵³ − 40, 2⁵³ + 7, 2⁶⁴, 10¹⁰⁰ and −10¹⁰⁰ levels down answers as the same
    lattice at the top, every map and factor bit for bit, depths exactly D₀ more, and so does its file; a run that
    straddles 2⁵³ unfolds each level at its depth under its name; a stretch of 2⁶⁰ levels is one frame whose levels are
    found by their digits; a move table keyed past 2⁵³ reads, carries, shifts and saves as one keyed 5 levels down.
  - `lattice.runs.deep.test.js`: the app's paths (jump, render, a crossing each way, a stroke, a lasso, a drag, an erase
    with undo and redo, a save and a load) at 10⁶, 10⁹, 2⁵³ − 2, 2⁵³ + 2, 2⁶⁴ and 10¹⁰⁰ levels; a hand zoom from
    2⁵³ − 3 to 2⁵³ + 3 and back, each level once and in its one form; a jump 10¹⁰⁰ levels up; at 10¹⁰⁰ ⁰⁰⁰ + 7 levels
    down and 10¹⁰⁰ ⁰⁰⁰ up, where the BigInt build stopped, a zoom crosses both ways and ink saves and loads; the scene
    list at 10¹⁰⁰ is the one at depth 1, its base saved as digits.
  - `store.deep.test.js`: a subtree drag 2⁶⁴ levels down through the store (the log replayed on opening), a download
    and a cloud push and pull.
  - `compat.files.test.js` opens 1.0's five files and the frozen `v1.1.svgi` (written once by
    `compat.fixtures.v1.1.probe.js`); `persist.slow.test.js` reads a whole-number version as 1.0 and refuses a newer
    one (break-checked).
- **What a person sees, at depth**: the scene list's label passes the zoom's log's log as the HUD's does
  (`sceneOps.sceneZoomLogLog10`; without it a scene past 5 × 10³⁰⁷ levels read "at 1×"); the gallery's badge past 2⁵³
  is `formatLog10Value` of the count (`localCanvases.depthLabel`, rendered with `SciText`; as digits it was as long as
  the depth); the dev panel's LEVEL past 40 digits is its ends and its length. Checked in the app at a 1,000-digit
  depth (below) and by `localCanvases.test.js`.

## Measured (2026-11-13)

A Surface Laptop 3 (Intel i7-1065G7, 4 cores, 16 GB). A depth N digits long is `1000…0007`; the steps are RUN-D's
(`lattice.runs.deep.test.js`): a jump there, a crossing in, out and back, a stroke, a lasso, a drag, an erase, undo,
redo, a save, a load. Milliseconds.

**In the app**: the desktop app's built-in Chromium pane (Chromium 156, a 4.2 GB heap), the dev server, local saves, a
new canvas for each depth (binned after). The hidden pane paints about once a second, so each step's render is timed by
calling the renderer. At every depth every step worked (a crossing each way, the lasso took the stroke, two pieces after
the erase, saved, reloaded at the depth with its undo history), with no console errors.

| digits | jump | cross in | cross out | back | draw | lasso | drag | erase | undo | redo | save | reload to the depth | heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 19 | 4 | 3 | 1 | 30 | 19 | 32 | 34 | 4 | 3 | 16 | — | 42 MB |
| 100,000 | 74 | 38 | 60 | 39 | 143 | 58 | 98 | 126 | 45 | 49 | 16 | 0.67 s | 71 MB |
| 1,000,000 | 805 | 439 | 940 | 981 | 202 | 80 | 203 | 286 | 183 | 123 | 533 | 2.1 s | 289 MB |
| 10,000,000 | 8,564 | 5,269 | 13,742 | 14,108 | 3,044 | 919 | 2,985 | 6,080 | 2,733 | 3,644 | 7,104 | ≤ 3.8 s | 1,858 MB |
| 20,000,000 | 14,584 | 8,925 | 25,273 | 27,053 | 5,418 | 1,422 | 4,945 | 11,534 | 5,283 | 6,836 | 11,500 | ≤ 8.2 s | 2,495 MB (2,786 after) |

At 20 million digits the tab held 2.8 of its 4.2 GB and a crossing took up to 27 s: the test computer struggling, so
the app was not tried deeper. The same day, at a
1,000-digit depth: the zoom label and the scene list read "10^(3.6×10⁹⁹⁹)×", the gallery's badge for a drawing with ink
at the top and there "10⁹⁹⁹ levels deep", the dev panel's LEVEL "1000000000…0000000007 (1,000 digits)".

**In the test harness**: jsdom, `src/engine/depth.limits.probe.js` (`DIGITS`, `MAX_MS`), Node 14 with a 4.1 GB heap and
nothing else running. Every assertion passed at every depth (the crossings reach D ± 1, ink where drawn and dragged,
erased, loaded back at D). "print" is the digits from the limbs; "save" is the whole document as one JSON string.

| digits | parse | print | add 1 | jump | cross in | cross out | draw | lasso | drag | erase | undo | redo | save | load | total | file | heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 1 | 0 | 0 | 5 | 7 | 5 | 26 | 22 | 22 | 22 | 3 | 4 | 2 | 9 | 165 | 0 MB | 171 MB |
| 10,000 | 0 | 0 | 0 | 2 | 5 | 8 | 7 | 5 | 9 | 17 | 3 | 3 | 1 | 15 | 84 | 0.1 MB | 173 MB |
| 100,000 | 2 | 4 | 0 | 9 | 8 | 17 | 9 | 8 | 12 | 21 | 4 | 5 | 4 | 42 | 158 | 1.1 MB | 178 MB |
| 1,000,000 | 27 | 18 | 2 | 38 | 85 | 109 | 31 | 9 | 20 | 82 | 17 | 28 | 41 | 392 | 960 | 11.4 MB | 215 MB |
| 3,000,000 | 53 | 44 | 5 | 84 | 227 | 292 | 86 | 44 | 47 | 195 | 45 | 64 | 168 | 1,079 | 2,561 | 34.3 MB | 464 MB |
| 10,000,000 | 201 | 250 | 8 | 186 | 680 | 931 | 191 | 55 | 116 | 568 | 137 | 198 | 559 | 3,593 | 7,980 | 114.4 MB | 886 MB |
| 30,000,000 | 511 | 713 | 49 | 593 | 2,057 | 2,941 | 896 | 286 | 379 | 1,705 | 383 | 588 | 1,823 | 10,425 | 24,393 | 343.3 MB | 2,697 MB |

**The zoom there** is inScale · 4096^depth, so its log10 is about 3.6124 × the depth: 10^(3.6 × 10⁹ ⁹⁹⁹ ⁹⁹⁹)× at ten
million digits (the label reads 10^(10^(10⁷))×), 10^(3.6 × 10¹⁹ ⁹⁹⁹ ⁹⁹⁹)× at twenty million. Zooming from the width of the
Milky Way to a proton every second (35.8 decades a second), getting to twenty million digits would take a number of
years about twenty million digits long.
