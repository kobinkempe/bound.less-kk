# tools/docmaps — the published reference pages

Three HTML pages are published from here. They are reference documents about
this codebase, generated rather than hand-maintained, so that they cannot
quietly stop being true.

| page | what it is | published at |
|---|---|---|
| `pages/boundless-code-map.html` | Every function in `src/`, in the file that defines it, each with a one-line "what it does in the design" and an expandable full explanation. | https://claude.ai/code/artifact/2d3a3acd-0a89-4e2b-a161-3445bdd19756 |
| `pages/boundless-call-graph.html` | The same functions as a graph: who calls whom, drawn inside file blocks. Click a function for its explanation, its callers, and what it reaches. | https://claude.ai/code/artifact/ee3012b4-86a3-4b0a-b232-8c73b73bd7b0 |
| `pages/boundless-call-map.html` | The six entry points as call *trees* — the reading version of the graph. | https://claude.ai/code/artifact/d6ac1f2b-d7b1-4b47-a8f4-d1ca1be5dcba |
| `pages/boundless-logical-design.html` | The design argument, not the code. Written by hand; no generator. | https://claude.ai/code/artifact/e1f6fb30-dc9e-4bc0-ac0e-836e1a528b56 |

The plain-text version of all of this, for an agent with no context, is
`docs/ai/`. These pages are the same material for a human with a screen.

## The promise these pages keep

**Every function is on both pages, with an explanation, and nothing is on them
that is not in the source.** `verify_coverage.py` proves the first half and
`audit_stale.py` proves the second. Run both after any change to `src/`; a
failure in either is a page telling a reader something false.

As of 2026-08-31: **1,087 functions across 78 files, 1,905 calls, 0 missing,
0 stale.**

## Two traps in the graph page, both measured in Chrome

**Do not put `will-change: transform` on the SVG.** It promotes the whole
4,244 x 2,374 drawing into one composited layer, which Chrome rasterises at the
current zoom — at 2x on a 2x display that is ~150 megapixels of texture for a
single layer, and the compositor drops tiles rather than allocate it. The
symptom is whole file blocks rendering as empty rectangles while their
neighbours draw perfectly, and it looks exactly like a layout bug. It is not:
`render_graph2.py` is checked mechanically, 0 of 1,103 function boxes fall
outside their block and no two blocks overlap. The page pans and zooms by
setting the root `viewBox`, so the rasteriser only ever renders the visible
region at the resolution it is shown at. This is the same class of failure as
F-Z, and the same rule applies — only a real browser can see it.

**The file name is the label that matters zoomed out.** At "fit" the graph is
at k≈0.24, so a 10px function label is 2.4px of grey. Below k=0.5 the function
labels are hidden and the overview becomes a file-level map; the file names
counter-scale so they stay readable at every zoom. Each block carries its own
`--tmax` ceiling on that counter-scale — how much bigger than 1x its name may
be drawn before it would cross into the block beside it — and `layout_mod.py`
reserves room for a name at `TITLE_ZOOM` when it sizes a block, or a
three-function file 90px wide draws its name straight across its neighbour.

## "A lot of these functions look unused"

Mostly they are not. **278 of the 1,087 have nothing calling them, and after
the 2026-08-31 cleanup none is unreferenced.** A call is drawn only when it resolves to a
definite target, so no incoming line means *not proven*, never *not there*:

| why nothing calls it | n | what it means |
|---|---|---|
| called via an object | 105 | `eng.pointerDown()`, `eng.eventLatency.report()` — the receiver's type is not resolvable from source. These ARE called. |
| passed as a value | 107 | exported, passed as a callback, or held somewhere |
| React component | 24 | rendered as `<Component/>`, never called by name |
| test only | 26 | nothing in the running app reaches it; a suite does |
| getter | 15 | `get inScale()` is *read*, so no call syntax exists anywhere |
| language protocol | 1 | `toJSON`, which `JSON.stringify` invokes by protocol |
| **no reference at all** | **0** | there were three. `Document.canRedo` was wired up (it and `canUndo` now grey the toolbar's Undo/Redo buttons); `LevelMap._edge`, `curvePerimeter.minDist` and `arcPerimeter.traceLoops` were deleted. |

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
| filled box | 34 | **entry point** — the browser, React, or a person reaches the code here. 6 pointer, 3 keyboard, 18 interface controls, 5 routed components, 2 the browser calls. |
| grey box | 26 | **test-only** — no production caller anywhere; a suite is the only thing that depends on it. |
**The not-running blocks are HIDDEN by default**, behind a *hide not running*
checkbox in the toolbar. They are 186 of the 1,087 functions and were 27% of the
drawing area, and `KobinEngineV0` - 77 functions, nothing calling it, so the
layering put it in layer 0 - was the widest block on the page, sitting above
everything that actually runs. `layout_mod.py` now pushes every `ded` module
below every live one, so they form a contiguous TAIL: hiding them leaves no
holes, and `data-live-h` on the root SVG is what Fit uses while they are hidden.
Nothing is removed from the page - search, the panel and the file filter still
reach every one of them.

| struck through | 0 | **unreferenced** — nothing in `src/` names it, tests included. The mark stays in the renderer; nothing wears it today. |
| dashed outline | 278 | nothing calls it *in the graph*. Usually a limit of reading calls from source, not a finding — see the table below. |

Entry points are found by reading the source, not by picking the ones that look
important, which is why `setTool` is on the list and `_bakeTick` is not:
`_bakeTick` re-arms its own timer from inside the engine, so nothing outside
ever calls it.

Two traps worth knowing if you touch `audit_entries.py`. A concise arrow body
(`const gesturePrevent = (e) => e.preventDefault();`) has no braces, so a scan
for the next `{` runs into the following function — that made every keyboard
entry read as a pointer entry. And the receiver has to be checked: without it,
`pointers.has(id)` on a `Map` resolved to `scaleBar/ladder.has` and was
reported as an entry point into the scale bar.

## Rebuilding, in order

Run the first two from the **repository root** (they walk `src/`); the rest
from this directory.

```
python tools/docmaps/inventory.py        # -> data/inventory.json   (1,087 functions)
python tools/docmaps/extract.py          # -> data/graphdata.json   (1,859 call edges)
cd tools/docmaps
python expand_codemap.py                 # pristine page + newdesc -> a row per function
python enhance_codemap.py                # -> pages/boundless-code-map.html
python audit_isolated.py                 # -> data/isolated.json, data/testonly.json
python audit_entries.py                  # -> data/entries.json
python build_graph_page.py               # -> pages/boundless-call-graph.html
python verify_coverage.py                # must print OK
python audit_stale.py                    # must print 0
```

**The two audits must run BEFORE `build_graph_page.py`**, because the graph
reads their output to mark the nodes. Run them after and the marks are one
build stale — which is worse than absent, since a stale mark still looks
authoritative.

Then publish each page to the URL in the table above — the same URL, so the
link Kobin has keeps working.

## What each script is

**Reading the source**

- `inventory.py` — every top-level function, class and method in `src/` outside
  the test suites. The authority on what exists. Function-local closures are
  deliberately excluded.
- `extract.py` — call edges, each with up to three `file:line` call sites.
  Resolves through imports and through `this.<field>` for the five engine
  fields. **Anything it cannot resolve to a known node it drops rather than
  guesses**, so its output is a subset of the truth, never a superset.

**The data**

- `graph.py` — the node set (from `data/graphdata.json`), the module colour
  groups, and `E`: the union of 373 hand-read edges and the extracted ones. The
  hand list is kept because it is *ordered* — it walks a gesture from the
  pointer down into the ink — and because it carries the edges an extractor
  will not guess at. Run it to print the counts and the agreement rate.
- `descriptions.py` — pulls each function's one-line description out of the
  **published Code Map**, which is why the graph never restates one.
- `longdesc.py` + `long_*.py` + `newdesc*.py` — the full explanations.
  `long_*` are the hand-written engine and geometry ones; `newdesc*` cover the
  scale bar, the shell, the interface and the not-running code, and carry both
  the one-line and the full text so the two pages cannot drift.

**The pages**

- `pages/boundless-code-map.pristine.html` — **hand-authored, and the source of
  truth for the prose.** Edit this, never the generated page.
- `expand_codemap.py` — replaces the three file-level summary articles with one
  article per module and appends the rows the engine articles were missing.
- `enhance_codemap.py` — makes every row expand into its full explanation.
- `layout_mod.py` + `render_graph2.py` + `build_graph_page.py` — the graph:
  files layered by the calls between them, functions laid out inside each file
  block, then one static SVG.
### What the 2026-08-31 cleanup changed in here

The engine split and the `clipperOutline` split moved functions between files,
and three scripts had to learn about it:

- **`extract.py`** — `PROTOTYPE` names the six files `engine/mixin.js` copies
  onto one prototype, so `this._queueBake()` in `KobinEngine.js` still resolves
  to a method defined in `erasePipeline.js`, and `FIELD` gives all six the
  engine's five collaborator fields. Without either, the hand-list agreement
  fell from 88% to 77% and 26 edges vanished — which is what the agreement
  number is FOR.
- **`graph.py`** — `_fix` now resolves a hand-edge name by its leaf when the
  module no longer holds it, preferring a live module over an oracle. The hand
  list records CALL RELATIONSHIPS; re-typing 200 entries after a file move would
  have been busywork with a transcription error in it.
- **`audit_stale.py`** — `ARTMOD` maps each article to *several* modules now,
  and must stay in step with `newdesc.APPEND_TO`.

- `layout.py` + `render_graph.py` — the older Sugiyama layering. Still used by
  the Call Map; `layout_mod.py`'s header says why it is not used for the full
  graph (28 layers, 4,600 dummy nodes, a canvas 33,000px wide).
- `build.py`, `trees.py`, `gen.py`, `check.py` — the Call Map page.

**The checks**

- `verify_coverage.py` — is every function in `inventory.json` named on both
  pages? Prints `OK` or the gaps, by file.
- `audit_stale.py` — does either page name something its own file does not
  define? Pins each article to the module it documents, so `get` under
  *LevelMap* is caught even though some other file defines a `get`.
- `audit_isolated.py` — for every function nothing calls, WHY (see below), plus
  `testonly.json`: every function with no production caller at all.
- `_mask.py` - blanks string and comment bodies while preserving every offset.
  Its own module, importing nothing, because BOTH audits need it and
  `audit_entries` cannot be imported during a refactor (it pulls in `graph`,
  which validates the hand-edge list at import time and raises). It was copied
  rather than shared once already, which is why it is a module now.
- `audit_entries.py` — where the outside world comes in. A call inside a
  registered listener, inside a JSX handler prop, inside an effect the
  interface drives, or a component React mounts for a route. 34 of them.
- `fix_stale_rows.py` — the 2026-08-28 corrections to the pristine page, kept
  as a record of what was wrong and why. It refuses to run twice.

## Adding a function

1. Write it, and run `inventory.py` and `extract.py`.
2. `verify_coverage.py` will name it as missing.
3. Add an entry to the right `newdesc_*.py` — `what` is the Code Map line,
   `long` is the expandable explanation (a list of paragraphs; `["-"]` means
   "the one-liner is the whole story" and the pages fall back to it).
4. Rebuild, and check both verifiers.

If the function belongs in a file the pristine page covers article by article
(the engine and the geometry), add it to `newdesc.APPEND_TO` instead of writing
a new article.

## Deleting a function

Delete it, rebuild, and run `audit_stale.py`. It will name every row that still
claims the function exists. Correct the **pristine** page, not the built one.
That is exactly how the 21 stale names of 2026-08-28 were found.
