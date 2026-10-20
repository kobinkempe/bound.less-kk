# tools/docmaps — the published reference pages

Three HTML pages are published from here, and a fourth is kept beside them. They
are reference documents about this codebase, generated rather than
hand-maintained, so that they cannot quietly stop being true.

| page | what it is | published at |
|---|---|---|
| `pages/boundless-code-map.html` | Every function in `src/`, in the file that defines it, each with a one-line "what it does in the design" and an expandable full explanation. | https://claude.ai/artifact/9z4MfJs946VR8Gjag3Quth |
| `pages/boundless-call-graph.html` | The same functions as a graph: who calls whom, drawn inside file blocks. Click a function for its explanation, its callers, and what it reaches. | https://claude.ai/artifact/R8K96tqmcZ7fWcVWzEPjt5 |
| `pages/boundless-call-map.html` | Seven flows from the entry points as call *trees* — the reading version of the graph. Every call in them is checked against the source at build. | https://claude.ai/artifact/DGvhvcjTXVMZQ2XHLw6r6Q |
| `pages/boundless-logical-design.html` | The design argument, not the code. Written by hand; no generator. Corrected on 2026-09-22 where the code had made a statement false. | https://claude.ai/code/artifact/e1f6fb30-dc9e-4bc0-ac0e-836e1a528b56 |

The plain-text version of all of this, for an agent with no context, is
`docs/ai/`. These pages are the same material for a human with a screen.

## The promise these pages keep

**Every function is on both pages, with an explanation, and nothing is on them
that is not in the source.** `verify_coverage.py` proves the first half and
`audit_stale.py` proves the second; the Call Map's `check.py` proves every call
it draws is one the source makes. Run `rebuild.py` after any change to `src/`;
a failure in any check is a page telling a reader something false.

As of 2026-10-20: **3,772 functions across 155 files, 7,298 calls, 0 missing,
0 stale**, every Code Map row opening into an explanation, and the Call Map's
323 calls in 7 flows all calls the source makes.

### What the 2026-09-22 rebuild found and changed

The generator had not run on the source since 2026-09-08, and it was more broken
than the failure message said:

- **The inventory was blind to part of the tree.** `_mask.py` did not treat an
  inline `/* ... */` as a comment, so `{ /* the frame's mark */ }` in
  `selection.js` read as an open string and hid 29 of its 33 methods —
  `_dragSelection`, `_normalizeHome` and `_applyLasso` were never "moved or
  deleted", they were unseen. The masker now also ends a quote string at the
  line's end and masks regex literals, and `inventory.py` and `extract.py` scan
  the masked source. `*.probe.js` files are suites and are no longer inventoried.
- **61 hand-read edges had stopped being calls** while both ends lived on (the
  cut moved into `eraseJob.cutJob`, the descent into `eraseDescent`, the select
  tool out of `_pointerDown`), besides 9 that named no node. Each was fixed to
  where the call now is, and `graph.py` now refuses both kinds (see below).
- **The extractor invented edges.** A one-line method owned the next line too
  (Loop's `map → forEach → some → …`), a call to a local closure resolved to the
  module's function of the same name, and `this.doc.add()` resolved to
  `LevelIndex.add`: 66 false edges gone, and engine fields now carry their class.
- **The checks matched names anywhere.** `verify_coverage.py` passed a function
  on the strength of any row with its bare name, and `descriptions.py` gave the
  retired `KobinEngineV0`'s methods the live engine's rows. Both now look only in
  the articles that document the function's own file (`newdesc.ARTMOD`).
- **The four in-flux areas were described last** (the raster renderer, the scene
  index, sync and storage, the report), and a function whose body changed after
  it was described was described again. On 2026-09-23, once the scene and sync
  work had settled, a second pass described the 23 functions it added (among
  them a new file, `cloud/storageLocks.js`) and re-read the 61 it changed. A
  third pass took in `storage/foldStore.js`, the whole-store bin rows and the
  loop starts the scene index now carries (6 new functions, 20 changed), and
  dropped the entries of the 14 unreferenced functions once Kobin approved
  deleting them and they were gone from the source. A fourth pass, at the end
  of that day's round (the sync redesign, the stall fix, the scenes' echo fold,
  the phone and erase fixes, the paper's rounds 2 and 3), described the 53
  functions it added and re-read the 73 it changed; a last one took in the
  follow-up fixes (2 new, 13 changed).

### What the 2026-10-20 pass changed

The pages had last been built on 2026-10-06 (the graph on 2026-09-23), before the end of the
renderer and model rebuild and the `performance` branch. `graph.py` refused 84 hand edges — 46
naming functions the rebuild renamed or deleted (`_bakeOne`, `listFor`, `ts.content`,
`_normalizeHome`), 38 no longer calls: 70 were moved to where the call now is (the erase through
`_bakeRun` and `_dispatchPair`, the render through `stage.sync` and `readTiles`, the camera through
`_zoomBy` and `_tableStep`, the drag through `stage.hold` to `_dropMove`) and 14 removed, their calls
gone. One more, `eng.zoomFactorAt → cam.zoomFactorAt`, had passed `is_call` only because the callee's
name is the caller's own, and was moved too. Six of the Call Map's seven flows were rewritten along
the same paths, four of the paper's callbacks listed in `INDIRECT`. `newdesc_perf.py` describes the
110 functions the branch added (`plateCodec.js` and `plateRam.js` among them) and corrects 91 of the
111 whose bodies changed since 6efaaf4; `newdesc_rb_m1.py` covers the 905 oracle functions the
rebuild had left undescribed, 721 carrying the entry of an identical live body and 184 read.

Published 2026-10-20: the Call Map only. The Code Map (2.3 MB) and the Call Graph (4.1 MB) were
rebuilt and pass every check but were not republished — too large to review in full before
publishing — so their links still show the 2026-10-06 and 2026-09-23 builds; the current pages are
`pages/` here (the `docmaps` launch entry serves them on :3003). Later that day `internBelow`, the lazy loop
index, `_buildGroups`, the shared index box and `sharedString` (F164) were described and the pages regenerated; the Call Map's flows did not change, so it was not republished.

## Two traps in the graph page, both measured in Chrome

**Do not put `will-change: transform` on the SVG.** It promotes the whole
drawing (4,235 × 6,919 px now) into one composited layer, which Chrome rasterises at
the current zoom — at 2x on a 2x display that is well over 100 megapixels of
texture for a single layer, and the compositor drops tiles rather than allocate
it. The symptom is whole file blocks rendering as empty rectangles while their
neighbours draw perfectly, and it looks exactly like a layout bug. It is not:
`render_graph2.geometry()` checks the layout at every build (no function box
outside its block, no two blocks overlapping, no file name wider than its block)
and `build_graph_page.py` stops if it fails. The page pans and zooms by setting
the root `viewBox`, so the rasteriser only ever renders the visible region at
the resolution it is shown at. This is the same class of failure as F-Z, and the
same rule applies — only a real browser can see it.

**The file name is the label that matters zoomed out.** At "fit" the graph is
at k≈0.16, so a 10px function label is under 2px of grey. Below k=0.5 the
function labels are hidden and the overview becomes a file-level map; the file
names counter-scale so they stay readable at every zoom. Each block carries its
own `--tmax` ceiling on that counter-scale — how much bigger than 1x its name
may be drawn before it would cross into the block beside it — and
`layout_mod.py` reserves room for a name at `TITLE_ZOOM` when it sizes a block,
or a three-function file 90px wide draws its name straight across its neighbour.

## "A lot of these functions look unused"

Mostly they are not. **779 of the 3,765 have nothing calling them in the graph,
and all but 3 of them are named somewhere else in `src/`.** A call is drawn only when it resolves to
a definite target, so no incoming line means *not proven*, never *not there*:

| why nothing calls it | n | what it means |
|---|---|---|
| called via an object | 420 | `eng.pointerDown()`, `eng.eventLatency.report()` — the receiver's type is not resolvable from source. These ARE called. |
| passed as a value | 152 | exported, passed as a callback, or held somewhere |
| test only | 60 | nothing in the running app reaches it; a suite or a probe does |
| getter or setter | 109 | `get inScale()` is *read*, so no call syntax exists anywhere |
| React component | 34 | rendered as `<Component/>`, never called by name |
| language protocol | 1 | `toJSON`, which `JSON.stringify` invokes by protocol |
| **no reference at all** | **2** | in the frozen model-v1 copies `m1eng.setPreBake` and `m1ewc._checkEraseWatchdogForTests`: nothing names them (`loc.setDeviceName` deleted 2026-10-20 at Kobin's word). The 14 this row listed (`db.deleteBackup`, `db.getCanvas`, `db.getFrames2`, `db.getLogFrom`, `erp._cull`, `ewc.eraseWorkerAvailable`, `fl.objTilesRect`, `las.polylineInsidePolygon`, `lm.shadowsOf`, `lzw._resetLzWorkerForTests`, `rnd._dAll`, `swc.sceneWorkerStats`, and the oracle's `v0.setKDebug` and `v0.setOutlineMode`) were checked by hand and deleted on 2026-09-23. |

**Ask in-degree, not degree.** The first version of `audit_isolated.py` looked
for nodes with no edges *at all*, which silently skips every function that
calls something but is called by nothing — which is exactly the shape an
abandoned function has. That hid 150 of these, `clipPolysToRect` among them.

The page carries this: a function nothing calls gets a dashed outline, and
clicking it puts the specific reason in the panel. Re-read this table before
concluding anything is dead — getters, protocol methods and JSX components are
invisible to any static call graph, not just this one.

## What the marks on the graph mean

| mark | n | meaning |
|---|---|---|
| filled box | 44 | **entry point** — the browser, React, or a person reaches the code here. 7 from a pointer or wheel event, 3 from a key press, 30 from a control in the interface, 4 components React mounts for a route. |
| grey box | 58 | **test-only** — no production caller anywhere; a suite or a probe is the only thing that depends on it. |
| struck through | 3 | **unreferenced** — nothing in `src/` names it, tests included: the three in the table above. |
| dashed outline | 779 | nothing calls it *in the graph*. Usually a limit of reading calls from source, not a finding — see the table above. |

**The not-running blocks are HIDDEN by default**, behind a *hide not running*
checkbox in the toolbar: the 1,117 functions of `src/engine/__oracles__/`.
`layout_mod.py` pushes every `ded` module below every live one, so they form a
contiguous TAIL: hiding them leaves no holes, and `data-live-h` on the root SVG
is what Fit uses while they are hidden. Nothing is removed from the page —
search, the panel and the file filter still reach every one of them.

Entry points are found by reading the source, not by picking the ones that look
important, which is why `setTool` is on the list and `_bakeTick` is not:
`_bakeTick` re-arms its own timer from inside the engine, so nothing outside
ever calls it.

Three traps worth knowing if you touch `audit_entries.py`. A concise arrow body
(`const gesturePrevent = (e) => e.preventDefault();`) has no braces, so a scan
for the next `{` runs into the following function — that made every keyboard
entry read as a pointer entry. The receiver has to be checked: without it,
`pointers.has(id)` on a `Map` resolved to `scaleBar/ladder.has`. And a ref is
not an engine: `errsRef.current.push()` resolved to `format2.push` until the
ref's own name was checked (`REF_MODS`).

## Rebuilding, in order

```
python tools/docmaps/rebuild.py          # all of the below, stopping at the first failure
```

which runs, the first two from the **repository root** (they walk `src/`) and
the rest from this directory:

```
python tools/docmaps/inventory.py        # -> data/inventory.json
python tools/docmaps/extract.py          # -> data/graphdata.json (stops on a file with no module key)
cd tools/docmaps
python graph.py                          # stops on a hand edge that is not a call
python expand_codemap.py                 # pristine page + newdesc -> a row per function
python enhance_codemap.py                # -> pages/boundless-code-map.html
python audit_isolated.py                 # -> data/isolated.json, data/testonly.json
python audit_entries.py                  # -> data/entries.json
python build_graph_page.py               # -> pages/boundless-call-graph.html (stops on a broken layout)
python check.py                          # the Call Map's calls, checked against the source
python build.py                          # -> pages/boundless-call-map.html
python verify_coverage.py                # must print OK
python audit_stale.py                    # must print 0
```

**The two audits must run BEFORE `build_graph_page.py`**, because the graph
reads their output to mark the nodes. Run them after and the marks are one
build stale — which is worse than absent, since a stale mark still looks
authoritative.

Then publish each page to the URL in the table above — the same URL, so the
link Kobin has keeps working. To look at a page in Chrome first, the `docmaps`
entry in `.claude/launch.json` serves `pages/` on :3003 (the extension will not
open `file://`).

## What each script is

**Reading the source**

- `_mask.py` — blanks string, regex and comment bodies while preserving every
  offset. Every reader of the source uses it: count braces on the masked text,
  match names on the raw one. It imports nothing, because `audit_entries` must
  run even when `graph` raises.
- `inventory.py` — every top-level function, class and method in `src/` outside
  the suites, the probes and the testkit. The authority on what exists.
  Function-local closures are deliberately excluded.
- `extract.py` — call edges, each with up to three `file:line` call sites.
  `MODFILE` gives every inventoried file a module key and the script stops,
  naming the file, when one is missing. It resolves through imports (`import * as`
  included), through `this.<field>` (the engine's collaborators by class — its
  `renderer` is both `RasterRenderer` and `Renderer`), through `class A extends
  B`, and across the six files `engine/mixin.js` copies onto one prototype
  (`PROTOTYPE`). A bare call to a name the caller declares locally is not a
  call to the module's function. **Anything it cannot resolve to a known node it
  drops rather than guesses**, so its output is a subset of the truth, never a
  superset.

**The data**

- `graph.py` — the node set, the module colour groups (`MOD`; `ras` is the
  paper, `src/engine/raster/`), and `E`: the union of 414 hand-read edges and
  the extracted ones. The hand list is kept because it is *ordered* — it walks
  a gesture from the pointer down into the ink — and because it carries the
  edges an extractor will not guess at. It is checked at import: every hand
  edge must name two nodes, and must be found by the extractor, or name its
  callee in the caller's body, or be listed in `INDIRECT` with how the call is
  made (a listener, a hook). `is_call` is that test; the Call Map uses it too.
  Run it to print the counts and the agreement rate (390 of 414).
- `newdesc.py` + `newdesc_*.py` — the per-function entries, each carrying the
  Code Map's one-liner (`what`) and the full explanation (`long`), so the pages
  cannot drift apart. One file per area; the 2026-09-22 ones are `geom`,
  `engine`, `store`, `paper`, `raster1`, `raster3`, `raster4`, `scenes`, `local`,
  `cloud` and `report`, the rebuild's `rb_stage`, `rb_pyramid`, `rb_pyrparts`,
  `rb_svg`, `rb_model` and `rb_m1` (the oracles), and 2026-10-20's `perf`. An area file may carry `ROLE` (a file's article heading) and
  `FIX` (a correction to a text the code has made false; `newdesc` and
  `longdesc` apply it, and a false pristine row is corrected in the pristine
  page). `newdesc.py` also holds the one map from article to modules,
  `ARTMOD` — built from `PRISTINE`, the generated `ARTICLES` and `APPEND_TO` —
  which the checks and the one-liner lookup all read.
- `longdesc.py` + `long_*.py` — the hand-written engine and geometry
  explanations, merged with `newdesc`'s; a `FIX` wins over both.
- `descriptions.py` — reads each function's one-liner out of the **built Code
  Map**, in an article that documents its file, which is why the graph never
  restates one. `long_key` is the one resolver for a row's full text.

**The pages**

- `pages/boundless-code-map.pristine.html` — **hand-authored, and the source of
  truth for the prose.** Edit this, never the generated page. Its
  `<!-- SLOT:name -->` markers are where the generated articles go.
- `expand_codemap.py` — fills each slot with its `newdesc.ARTICLES`, appends the
  rows the hand-written articles lack (`APPEND_TO`), and writes the contents,
  the line counts, the standfirst and the masthead from the source and git.
- `enhance_codemap.py` — makes every row expand into its full explanation.
- `layout_mod.py` + `render_graph2.py` + `build_graph_page.py` — the graph:
  files layered by the calls between them, functions laid out inside each file
  block, then one static SVG; the layout is checked before the page is written.
- `trees.py` + `gen.py` + `check.py` + `build.py` — the Call Map. A tree row is
  `display | nodes | note`: the node ids it stands for (`a>b` for a hop through
  a listener or a hook, `-` for a row that is not a call), so the swatch colour
  comes from the graph and `check.py` can prove each parent calls each child.
- `layout.py` + `render_graph.py` — the older Sugiyama layering, which no page
  uses; `layout_mod.py`'s header says why (28 layers, 4,600 dummy nodes, a
  canvas 33,000px wide).

**The checks**

- `verify_coverage.py` — is every function in `inventory.json` named on both
  pages, the Code Map in an article that documents its file, and does every
  Code Map row open into an explanation? Prints `OK` or the gaps, by file.
- `audit_stale.py` — does the Code Map name something its own article's files
  do not define? A claim is checked against exactly those modules, so `get`
  under *LevelMap* is caught even though some other file defines a `get`.
- `audit_isolated.py` — for every function nothing calls, WHY (see above), plus
  `testonly.json`: every function with no production caller at all.
- `audit_entries.py` — where the outside world comes in. A call inside a
  registered listener, inside a JSX handler prop, inside an effect the
  interface drives, or a component React mounts for a route. 44 of them.
- `rebuild.py` — the whole chain above, in order.
- `fix_stale_rows.py` — the 2026-08-28 corrections to the pristine page, kept
  as a record of what was wrong and why. It refuses to run twice.

## Adding a function

1. Write it, and run `rebuild.py`: `verify_coverage.py` names it as missing.
2. Add an entry to the right `newdesc_*.py`, keyed by its node id exactly as
   `data/graphdata.json` names it — `what` is the Code Map line, `long` is the
   expandable explanation (a list of paragraphs; `["-"]` means "the one-liner is
   the whole story" and the pages fall back to it).
3. Rebuild, and check both verifiers.

A new FILE needs a module key in `extract.MODFILE`, a colour group and a name
in `graph.MOD` and `graph.MODNAME`, and an article: an entry in
`newdesc.ARTICLES` with the slot it goes in, or its module in `APPEND_TO` if
the pristine page already has an article for it.

## Deleting a function

Delete it, rebuild, and run `audit_stale.py`. It names every row that still
claims the function exists. Correct the **pristine** page (or delete the
`newdesc` entry), not the built one.
