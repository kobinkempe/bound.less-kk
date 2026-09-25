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
(heap), `scenes.echo.probe.js` (echo pairs and rows).

## What a scene is for

Two principles decide every case (Kobin, 2026-09-22): a scene **(1) lets you know about things
you cannot see from the current view without a small pan or zoom**, and **(2) shows a properly
framed picture of what is in it**, minus long stray marks. Levels are never visible: a scene may
span any number of crossings. Nothing is ever hidden from the list — a lone dot far from
everything is a scene.

## The constants (one place: `sceneIndex.js`)

| constant | value | meaning |
|---|---|---|
| `REF_STROKE_PX` | 2.5 | every distance is in px at the zoom where the stroke is this wide |
| `JOIN_PX` | 2,250 | "a small pan": ink closer than this joins — 900 widths (`REACH`) |
| `ZOOM_SPREAD` | 16 | "a small zoom": a scene holds widths within 16× (compares stroke WIDTHS; Kobin 2026-09-22: scene SIZE may be considered later) |
| `CHUNK_PX` | 1,500 | long objects are measured in pieces this long — 600 widths (`CHUNK`) |
| `STRAY_RUN_PX` | 3,000 | a lonely stretch of one object this long is stray — 2 chunks |
| `MAX_PARTS` | 12 | at most this many parts a scene (Kobin 2026-09-23) |
| `MAX_SPAN_PX` | 4,500 | a wider scene gets part records |
| `MAX_SIBLINGS` | 20 | more side-by-side scenes than this are grouped into regions |
| `FRAME_PAD` | 10 % | framing margin, of the frame's longer side |
| `MATCH_OVERLAP` | 0.5 | a kept-aside name returns to a scene covering this much of its frame |
| `ECHO_ZOOM` | 3 | nested scenes whose frames hold each other's centres within this are one row of the list |

## Items: what the index sees of an object

- **Ink** is every object except eraser marks and **re-homed patches** (`attachRect`): a patch is
  storage — the parent's ink inside a ceded tile — and makes no scene of its own (row 14) **while
  its family keeps ink outside patches**. With none left (the remnant erased or removed) the patches
  are the drawing and are indexed; an add or removal in a family that has patches re-checks them
  (review 2026-09-22; a re-key of a family is not seen).
- **Width** `w` is the thickness the ink has NOW, capped at its pen: `min(o.w, meanWidth)`
  (meanWidth = 2·area ÷ perimeter). A crumb of an erased marker reaches like a dot of its own size,
  never like the whole marker (row 14a). A stroke still raw counts at its pen (`lwFrame`); a
  pen-less fill counts its size as one chunk.
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
7. **Framing, parents, parts, regions** for the scenes that changed.

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
16× (listed as one row where their frames echo, below) (the Magnum Opus: 51 scenes nested 30 deep across 141 octaves of widths).

**Erase footprints (row 14b).** An eraser FINER than the ink it cut is detail at its own width
(Kobin: "a tiny dot eraser on a large object should become its own scene, because otherwise that
detail would be lost"). Per cut, the mark's chunks within its reach of the cut object become an
item (id −its first host piece) in a surviving piece's stored coordinates: it moves with its
host (to another frame of its depth too: a carry, a merged shadow), re-hosts in the family, goes
with the gesture's undo and comes back with its redo — after a load as well, since an undone
footprint is saved (`off`) and the op log rebuilds the redo stack — and is dropped when no piece
is left or a fresh action ends the redo branch. At most 512 footprints and 8,192 chunk records
(the oldest go first; a one-chunk footprint is ~170 bytes of the file). An eraser about the ink's
width just edits its scene (the footprint joins it); a coarser eraser is removal. One footprint
per cut, so a swipe across two drawings bridges nothing.

**Framing.** The scene's valid ink — at least one width of its thickest stroke each way, so a
single point has a frame — padded `FRAME_PAD`; a one-member scene is framed on itself. No minimum
(Kobin 2026-09-23: "a dot + 10% margin filling the screen sounds fine"; the 24-width floor that
framed a few fat strokes at 2–4× their ink is gone). A scene restored from a file whose frame or
parts differ from the saved ones gets a new picture key, so its thumbnail is made again.

**Parts.** A frame longer than `MAX_SPAN_PX` (at the thickest width) is cut in two at the
emptiest line across its long axis (an ink histogram over the middle 60 %), **the widest piece
first**, until every piece fits or there are `MAX_PARTS` 12 (Kobin 2026-09-23; one scene of the
Magnum Opus had 179): so a capped scene's parts are its most even views, and below the cap the
parts are exactly the uncapped ones. They are part records under the scene, listed in the cut
tree's order (ids `p…`, kept by overlap in the scene's own coordinates, so a rigid move keeps
them).

**Regions.** More than `MAX_SIBLINGS` scenes under one parent (or at the top) are grouped by their
frames' centres (median splits across the wider spread) into region records listed with their
scenes under them (ids `r…`, kept by the overlap of their scene sets).

**Echo rows** (Kobin 2026-09-23: "why are there two scenes for Saturn? … the larger of the two
duplicates is more accurate"). The 16× width rule cuts a subject drawn across many zooms into a
chain of nested scenes, and where a coarse scene and its detail frame the same thing, the list
showed it twice (Saturn: its body, a few fat strokes framed at the then 24-width floor, and its
rings, a child scene, framed 1.55× tighter). By principle 1 that is one entry. So the **list**
(not the index) folds them: top-down, a scene joins the row of its nearest ancestor (8
generations) when its frame and the row's tightest frame hold each other's centres at sizes
within `ECHO_ZOOM` 3× (v2's echo guard), while the row's frames span at most `ZOOM_SPREAD` 16×. A
row with a **renamed** member is that member: its id, name, frame and parts (Kobin 2026-09-23
evening). Otherwise it keeps its first (coarsest) member's id and name and shows its **tightest**
frame (in every echo on the Magnum Opus the looser frame's extra room was the floor, since gone,
or the coarse scene's short marks around the subject). It counts every member's objects; two
renamed scenes never share a row. The scenes, their parents and the saved state are unchanged;
regions group rows (keyed by the parent row's coarsest member, so a fold or a rename keeps a
region's name); a row's parts are those of the scene whose frame it shows. On the Magnum Opus:
54 scenes, 22 echo pairs → 38 rows, none echoing (SCENES-PLAN §7.8).

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
tomb, regions?, dirty, erase}`. `m` is the members as sorted ids, base-36 gaps with runs (`5.2` =
5, 6, 7; at most `MAX_IDS` 10⁷ ids in all); `e` the footprints; `dirty` the ids not yet indexed
when saved; `erase` the footprints' chunks (`off` for an undone gesture's). `meta.scenes` (the
panel's list, with each row's `kind`, `region` and picture key `hash`) is saved beside it, so a
load shows the list at once. `persist.decodeSceneIndex` is lenient: a malformed entry is dropped, a
malformed whole is no index.

**The picture key** (a row's `hash`, the thumbnail cache's key) is `vtag-version`: `version` a
global counter bumped by any change to what the scene shows (a z-order change included, not a
rigid move), `vtag` a tag drawn per session (per index and per restore). A load restarts `version`
from the saved `ver`, so without the tag an unsaved session's keys would come round again on
different pictures. A region's key is a hash of its scenes' keys; a part's, its scene's plus its
number. A save never waits on the index: it writes the last export with every id not yet indexed
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
include them → lower `STRAY_RUN_PX`. Wide scenes lack closer views → lower `MAX_SPAN_PX`. Lists
too long → lower `MAX_SIBLINGS`.
