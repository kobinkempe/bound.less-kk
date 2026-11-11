# Scenes Design Bible (v3)

The definitive semantics of scenes: what a scene is, how the index keeps them, what is saved.
Supersedes the v2 bible (auto-scenes, 2026-07-12 … 2026-09-22), whose whole-drawing clustering
took 129.6 s on the Magnum Opus's first open. Kobin's rules, message by message, are in
`.claude/SCENES-PLAN.md` §6; the build spec §7; the decisions made while building §7.7. This
document is the distillation.

Code: `src/engine/sceneIndex.js` (the pure core), `src/engine/sceneClient.js` (the main thread),
`src/engine/sceneWorkerClient.js` + `src/engine/worker/sceneWorker.js` (the worker,
`public/scene-worker.js`), `src/engine/sceneOps.js` (the engine's calls). Oracle:
`src/engine/__oracles__/sceneOracle.js`. Tests: `sceneIndex.test.js`, `sceneClient.test.js`,
`scenes.erase.slow.test.js`. Probes: `scenes.first.probe.js` (times), `scenes.memory.probe.js`
(heap), `scenes.echo.probe.js` (the echo pairs of 2026-09-23); F189's in `src/engine/__review__/`
(untracked): `f189.list.probe.js` (the list on his report and the Magnum Opus backup),
`f189.synth.probe.js` (carvings and moves).

## What a scene is for

Two principles decide every case (Kobin, 2026-09-22): a scene **(1) lets you know about things
you cannot see from the current view without a small pan or zoom**, and **(2) shows a properly
framed picture of what is in it**, minus long stray marks. Levels are never visible: a scene may
span any number of crossings. Nothing is ever hidden from the list — a lone dot far from
everything is a scene. **The list is flat** (Kobin 2026-11-10: "I don't really want sub-scenes"):
every row is a view, and scenes close together share one (Rows, below).

## The constants (one place: `sceneIndex.js`)

| constant | value | meaning |
|---|---|---|
| `REF_STROKE_PX` | 2.5 | every distance is in px at the zoom where the stroke is this wide |
| `JOIN_PX` | 2,250 | "a small pan": ink closer than this joins — 900 widths (`REACH`) |
| `ZOOM_SPREAD` | 16 | "a small zoom": a scene holds widths within 16× (compares stroke WIDTHS; Kobin 2026-09-22: scene SIZE may be considered later) |
| `CHUNK_PX` | 1,500 | long objects are measured in pieces this long — 600 widths (`CHUNK`) |
| `STRAY_RUN_PX` | 3,000 | a lonely stretch of one object this long is stray — 2 chunks |
| `MAX_PARTS` | 12 | at most this many parts a scene (Kobin 2026-09-23) |
| `FRAME_PAD` | 10 % | framing margin, of the frame's longer side |
| `MATCH_OVERLAP` | 0.5 | a kept-aside name returns to a scene covering this much of its frame |
| `THUMB_PX` | 320 | a row's picture is 320 × 240 (`storage/thumbnails.js`) |
| `SEEN_PX` | 0.25 | a stroke narrower than this in the picture is too small to see (F189): a view at most 1,280 widths wide shows it (`SEEN_LOG`) |

A view is measured by `viewSide`, the width of the 4:3 picture that holds it: `max(w, 4h/3)`.
`MAX_SPAN_PX` (4,500: parts), `MAX_SIBLINGS` (20: regions) and `ECHO_ZOOM` (3: echo rows) went
with F189 (2026-11-10).

## Items: what the index sees of an object

- **Ink** is every object except eraser marks and **re-homed patches** (`attachRect`): a patch is
  storage — the parent's ink inside a ceded tile — and makes no scene of its own (row 14) **while
  its family keeps ink outside patches**. With none left (the remnant erased or removed, or a piece
  an erase cut off below its family's home) **the family's shallowest patches are the drawing** and
  are indexed; the squares ceded under them stay storage (F189: before, every member was indexed,
  each whole-cell square a scene of solid ink). An add or removal in a family that has patches
  re-checks them, and so does a re-key (a family parted or joined: every patch family is checked).
- **Width** `w` is the thickness the ink has NOW, capped at its pen: `min(o.w, meanWidth)`
  (meanWidth = 2·area ÷ perimeter). A crumb of an erased marker reaches like a dot of its own size,
  never like the whole marker (row 14a). A ceded patch counts at its thickness alone: its `o.w` is
  its family home's pen in the home's units (F84), 4,096 times too thin a level down. A stroke
  still raw counts at its pen (`lwFrame`); a pen-less fill counts its size as one chunk.
- **Absolute log width** `L = log2(w) − 12·depth(home)` compares widths across frames with no
  coordinate mapping.
- **Chunks**: boxes along the ink (a shape's outline, a stroke's centreline) of at most `CHUNK`
  widths, each with the length it covers; long lines and arcs are subdivided so a diagonal never
  becomes one bounding box. The record carries `loops`, the first chunk of each closed loop (a
  shape's outlines — every baked stroke is one — and a fill's rings; one loop is a shared `[0]`), so
  the stray rule and the insert's contact groups run around the outline.
- **Position**: stored geometry + the table's residual at the home + the home frame's pending
  shift. A move changes the last two, never the chunks.
- **Mass** (ink, for identity and order): the outline's length in pen widths — scale-free.

## The rules, in the order a batch applies them

A batch is everything that changed since the last one: frame records, item records (gone, new,
re-shaped, re-placed), renames. Changes are recorded at the Document's events and flushed at
idle, one batch at a time.

1. **Frames first.** A frame whose parent or cell changed moved its subtree; one whose shift
   changed moved its own natives. A frame that **went** (a shadow merged into its resident) hands
   what was recorded in it — scene anchors, kept-aside names, the placement's reference frame — up
   the old tree to a frame that stayed put.
2. **Placed items** (a table, a home, a shift, a translated geometry), per scene, measured in a
   frame that did not move: **every member that stays (not gone, not re-shaped) moved by one
   displacement is a rigid move** — the scene's origin follows, its content version (the thumbnail
   key) does not change, no grid cell is touched, and it **re-joins where it lands** (below).
   Otherwise the members that moved leave and are inserted again.
3. **Removals**, per scene in id order: the leaving members go; an erase's pieces (and a
   re-shaped object) are filed back into the scene of what they replaced when the width range
   allows — **storage, not new ink** (row 14) — else inserted; an emptied scene keeps its name
   aside, **unless its members moved away**: then the scene new this batch holding most of their
   ink takes its id and name (a drawing moved apart and together again stays itself); what is left
   is **split-checked**: its components, the one with the most ink keeping the id and name (tie:
   the one holding the smallest id), the others new scenes numbered in order of their smallest id.
4. **Inserts**, in id order: an item's chunks are tested against the **valid** chunks of every
   compatible scene (range with it within `ZOOM_SPREAD`) at reach `max(T_a, T_b)`, `T = 900·w`.
   Its chunk sequence is split at runs of ≥ 2 untouched chunks (around a closed outline, so where
   its loop starts changes nothing); **the group touching most decides** (tie: the one with the
   smallest chunk index); its scenes merge greedily by contact (then age) while the merged range
   fits; the item joins. Touching nothing: a new scene. So a long line from one drawing to another
   through empty paper does not merge them (row 3/4), and ink between two drawings that closes
   every gap under `JOIN_PX` does.
5. **Re-joins**: a scene moved whole merges with the compatible scenes **the ink that moved** now
   touches — its valid chunks against theirs, so a stray line never carries a nudge into a merge —
   oldest first, while the range fits. When that ink joined another scene during the inserts, that
   scene re-joins through the moved ink only, never through ink that stood still.
6. **Names reclaimed**: a scene born in this batch takes a kept-aside id and name whose frame it
   covers by `MATCH_OVERLAP` with a compatible range (undo of an erase, a split undone, a drawing
   redrawn in place). Coverage is compared rounded to 1e-9, so a tie is not decided by an ulp.
7. **Framing, parents, parts** for the scenes that changed, then the **rows** for all.

**Valid chunks (the stray rule).** In a scene of two or more members, a chunk of a member with ≥ 3
chunks is lonely when no other member's ink is within reach; a run of ≥ `STRAY_CHUNKS` lonely
chunks is stray. Stray chunks are not framed and **never bridge**: a drawing started later at the
far end of a stray line does not join through it. A member's links to other members are never
through lonely chunks (a link makes both ends non-lonely), so the stray rule changes no split.

**Merges.** Physically, the members of the scene with the deeper anchor move (tie: the smaller).
Identity: **the renamed one if exactly one was renamed** (ruled by Kobin 2026-09-22), else the one
with more ink, else the older; the other's id and name are kept aside (256 at most).

**Nesting.** An object more than 16× thinner than a scene it lies in cannot join it; it makes (or
joins) its own scene, whose **parent** is the scene whose frame holds its frame's centre with the
smallest `Lmax` above its own. A coarse picture drawn later around small ones makes them its
children, ids and names kept. A spot that keeps getting finer is a chain of nested scenes, one per
16× (the Magnum Opus: 51 scenes nested 30 deep across 141 octaves of widths). Since F189 the
parent only orders the list: a row comes right after the row its parent is in.

**Erase footprints (row 14b).** An eraser FINER than the ink it cut is detail at its own width
(Kobin: "a tiny dot eraser on a large object should become its own scene, because otherwise that
detail would be lost"). **One footprint per gesture and family**: the mark's chunks within its
reach of the cut object become an item (id −its first host piece) in the stored coordinates of a
surviving piece **in the deepest frame the gesture's cut reached** — where the eraser was drawn,
the piece with the hole (F189). A descent records a step per crossing, and the footprint is
filed again at each deeper one; before F189 it stayed in the cut shape's own frame, where three
crossings down a carving is 1e-9 of a unit and six down one point, so it could not be framed,
jumped to, pictured or moved, and an erase over two cache squares left two. It moves with its
host (to another frame of its depth too: a carry, a merged shadow), re-hosts in the family, goes
with the gesture's undo and comes back with its redo — after a load as well, since an undone
footprint is saved (`off`) and the op log rebuilds the redo stack — and is dropped when no piece
is left or a fresh action ends the redo branch. A saved footprint narrower than 256 float64 steps
at its coordinates (filed in the shape's frame before F189) is not read. At most 512 footprints
and 8,192 chunk records (the oldest go first; a one-chunk footprint is ~170 bytes of the file). An
eraser about the ink's width just edits its scene (the footprint joins it); a coarser eraser is
removal. A swipe across two drawings leaves two footprints and bridges nothing.

**Framing.** The scene's valid ink — at least one width of its thickest stroke each way, so a
single point has a frame — padded `FRAME_PAD`; a one-member scene is framed on itself. No minimum
(Kobin 2026-09-23: "a dot + 10% margin filling the screen sounds fine"; the 24-width floor that
framed a few fat strokes at 2–4× their ink is gone). A scene restored from a file whose frame or
parts differ from the saved ones gets a new picture key, so its thumbnail is made again.

**Median width.** "Most of the strokes" (Kobin 2026-11-10) is the members' absolute log width
`L` at the half-way point of the ink, weighted by the ink's length (mass · width): `S.medL`, made
with the frame. A scene's strokes can be seen in a view of side `V` when `V ≤ 1,280 · 2^medL`
(SEEN_PX). Width is a proxy for his "the thumbnail is >90% the same as if the strokes aren't
there": a quarter-pixel line in the 320-px picture, shown at the panel's 64 CSS px on a 2× screen,
darkens its pixels by about 10 %. It cannot see density: many faint strokes that together read as
shading count as faint strokes.

**Parts.** A scene whose own view is wider than its median stroke can be seen in (`_wide`) and has
two or more members is cut in two at the emptiest line across its long axis (an ink histogram over
the middle 60 %, positions as fractions of the piece's side so the scene's origin cannot move a
cut), **the widest piece first**, until every piece fits that side less the padding or there are
`MAX_PARTS` 12 (Kobin 2026-09-23; one scene of the Magnum Opus had 179). Parts carry their share of
the ink and of the members. They keep their ids (`p…`) and names by overlap in the scene's own
coordinates, so a rigid move keeps them. A wide scene is listed as its parts, with no row for the
whole unless it was renamed (Kobin: "if most of the strokes are too small to see ... then there is
no parent scene"). A wide scene that cannot be cut (one member, or one indivisible run) is a row.

## Rows: the flat list (F189, Kobin 2026-11-10)

"I don't really want sub-scenes ... if there's a high level of detail, but the zoom isn't 16x
difference, and the scenes are all close together, just show a square that contains those scenes
as the scene. The only caveat is that the strokes should be visible in the thumbnail ... then there
is no parent scene and the sibling scenes would be listed separately." `SceneIndex._rows`, every
batch, output only (the scenes, their parents and the saved state are untouched):

- **Units**: each framed scene, or a wide scene's parts (a renamed wide scene stays a unit too).
  A unit's limit is the smaller of 16 × its own view (`ZOOM_SPREAD`) and the side its median stroke
  is seen across.
- **Squares**: every pair of units whose square (the box holding both, in the coarser of their
  frames) is within both limits, found by a sweep over their centres in their root frame; joined
  **smallest square first** (Kruskal, ties by unit order), each join re-checked against every
  member's limit. Two renamed units never share a row. The visibility test is **per member**, not
  over the strokes pooled: a detail the square cannot show keeps its own row (principle 1).
- **A row** is the square of its units. It takes the id and name of its renamed unit, else of its
  coarsest (largest `Lmax`, then whole before part, then oldest); a part's name is its scene's and
  number (`Scene 4 · 2`). `count` is its units' objects. A renamed row keeps its square: the name
  does not change the picture.
- **Order**: the rows inside no other first, heaviest ink first. A row follows the row of the
  nearest coarser scene that is not in it (`_parents`; a scene listed as parts: the part holding
  the centre); siblings by ink, heaviest first; a scene's parts together, in the cut tree's order,
  then what is inside each.
- **Records** (`records()`): `{id, name, level, rect, depth: 0, hash, auto, pinned, count}`, plus
  `kind: "part"` for a row led by a part and `group` (the units' ids) for a shared row. No `parent`
  and no `region`; the panel indents nothing.
- **Picture key**: a one-unit row's is its scene's (or the part's, as before); a shared row's a hash
  of its units' keys and their places in the square, so a member moved inside it is another picture
  and the square moved whole is not.

This replaces the echo rows (2026-09-23: a scene folded into its ancestor's row when their frames
held each other's centres within 3×, the row showing the tightest frame) and the regions (more
than 20 siblings grouped by median splits). Saturn's body and rings are one row: the square
holding both. Measured: F189 in `docs/OPEN-FLAGS.md`.

## Geometry kept by the index

Per scene: its anchor (the coarsest home of its members; re-anchored when those leave), an origin,
and a grid per band `b = floor(log2 T)` with cell side `2^(b+1)`: `all[b]` holds the chunks of
bands b−5..b (what a query from band b must see), `own[b]` the chunks of band b alone (what a
finer query must see). A second pair holds only multi-chunk members, for the stray flags. A
scene's local coordinates are its anchor's less its origin, so a rigid move is one origin. A chunk
is filed in every cell its box covers, so the cost grows with the square of a chunk's span in
widths: `sceneGeom` keeps chunks at `CHUNK` widths except for an object that would need more than
`MAX_CHUNKS` of them, whose chunks grow instead (none on the Magnum Opus; an open risk for a very
long hairline piece). Memory on the Magnum Opus: SCENES-PLAN §7.8.

**Packed** (2026-09-23): a grid is, per band, an open-addressing table of cell keys to segments of
one Uint32 pool per grid, each cell's entries in insertion order (a removal shifts the rest down,
so scans visit entries in the order the Sets they replaced did); items' chunks and filed boxes are
regions of shared typed pools and their numbers one Float64 column by slot; pools and grids are
compacted between batches (in the worker, after the result is posted). The main thread keeps, per
object, only its width, table residual and home, and re-makes an object's chunks from the object
when its geometry changes. On the Magnum Opus: 79 MB → 26 MB (node), the same scenes.

Frames are records `{id, parent, depth, centre, shift}`; the similarity between two frames goes
up to a common depth and across by a Horner sum of the cell offsets, so two frames near each
other keep every partial sum small however deep their common ancestor.

## Saved in the file

`meta.sceneIndex` (kobin-1 envelope, so the kobin-2 header too): `{v: 3, seq, ver, pseq, rseq,
scenes: [{id, seq, name, named, anchor, ox, oy, version, vtag?, Lmin, Lmax, rect, m, e?, parts?}],
tomb, dirty, erase}`. `regions` (until F189) is no longer written or read; `rseq`, their counter,
is still written. `m` is the members as sorted ids, base-36 gaps with runs (`5.2` =
5, 6, 7; at most `MAX_IDS` 10⁷ ids in all); `e` the footprints; `dirty` the ids not yet indexed
when saved; `erase` the footprints' chunks (`off` for an undone gesture's). `meta.scenes` (the
panel's list, each row's `kind`, `group` and picture key `hash`) is saved beside it, so a
load shows the list at once. `persist.decodeSceneIndex` is lenient: a malformed entry is dropped, a
malformed whole is no index.

**The picture key** (a row's `hash`, the thumbnail cache's key) is `vtag-version`: `version` a
global counter bumped by any change to what the scene shows (a z-order change included, not a
rigid move), `vtag` a tag drawn per session (per index and per restore). A load restarts `version`
from the saved `ver`, so without the tag an unsaved session's keys would come round again on
different pictures. A shared row's key is a hash of its units' keys and places; a part's, its
scene's plus its number. A save never waits on the index: it writes the last export with every id not yet indexed
in `dirty` (a load's restore still out adds nothing — those ids are the export's own).

**A load computes nothing**: every object is filed straight into its saved scene; a saved scene
with no object left keeps its name aside; one that lost members is split-checked; objects the
index never saw and the `dirty` ids are inserted by the ordinary rule. **An old file** (no index)
is built once, its old scenes (v2 rows, `s<n>` ids only) lending their ids and names by frame
overlap; old scenes pointing at empty paper are dropped.

## When it runs

At idle, never while a stroke, a drag or a lasso is live, and behind the raster and erase
workers' queues for at most 3 s; one batch at a time in its own worker (inline where there is no
Worker — jsdom — where a load over 5,000 natives waits for `refreshScenes`, which never runs one
inside a gesture). The panel reads `docMeta.scenes`; `refreshScenes` starts the next batch;
`renameScene` shows at once and rides the next batch (a restore's too). Measured on the Magnum
Opus: SCENES-PLAN §7.8.

**Across documents and failures.** Every restore bumps a generation: a batch still out when
another document loads is dropped on landing, and the new document's restore goes out with no
further edit (anything owed — ids, names, footprints, a frame — is sent when a batch lands). A
failed batch terminates the worker; the index is rebuilt inline from the last export (the file's,
before any) with the failed batch's ids and everything dirty since listed `dirty`. A prep sliced
across idle callbacks reads item tables per slice and frame records at the send: when a frame
event (a settle, a merge, a refile) happened meanwhile, the ids it dirtied are prepared into the
same batch, so its halves agree. Frames removed together are scanned against `sent` once.

## Tuning guide

Scenes merge too eagerly → lower `JOIN_PX`. Detail stays in its parent when it should nest →
lower `ZOOM_SPREAD`. Too deep a nesting chain → raise `ZOOM_SPREAD`. Stray marks bridge or frames
include them → lower `STRAY_RUN_PX`. Rows share squares too readily, or wide scenes lack closer
views → raise `SEEN_PX`. Too many rows of thin strokes → lower `SEEN_PX`.
