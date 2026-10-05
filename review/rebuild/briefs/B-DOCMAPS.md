# B-DOCMAPS — the published Code Map, Call Graph and Call Map made true for the rebuilt tree (2026-10-05, orchestrator)

**Agent:** `opus-builder` (effort max). **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19 above
all — this job reads a great deal of code, so keep your own context small: work file by file, write each file's entries
to disk before reading the next, and keep a checkpoint entry current so a successor can continue from the tree and the log).
**Scratch:** `<scratchpad>/dmap/`. Ports, if you serve a page: 3050–3059.

**Read first:** `CLAUDE.md`; `tools/docmaps/README.md` (whole — it is the procedure, the traps and the form of an entry);
`docs/ai/90-MAINTENANCE.txt` (the `tools/docmaps/` part); `DESIGN.md` §8–§10 and §13 (the model, the renderer, the
selection, the store as they are now); `review/rebuild/PLAN.md` §5.24. Then the generator's own files as you need them.

## Why

The pages were last rebuilt at 56e36b3 (2026-09-25). The renderer and document-model rebuild since (266 commits on this
branch) added, deleted and rewrote most of the paint path and much of the model, so the published pages now name deleted
files (`PictureLayer.js`, `PlateStore.js`, `listFor`, `TileStore.content`/`contentOffCamera`, `_buildList`) and lack the
new ones. The orchestrator's dry run on fba12b4 (`git archive` copy): `inventory.py` finds 153 files and 3,649 functions
(the README's last count: 2,282 in 113); 1,616 functions added since 56e36b3 (895 of them in `src/engine/__oracles__/model-v1/`,
the frozen pre-C1 model the fuzzes compare against) and 264 deleted; `extract.py` stops on 42 files with no module key and
2 keys naming deleted files.

## What done is

`python tools/docmaps/rebuild.py` runs to its end on the tree at your hand-back: `verify_coverage.py` prints OK,
`audit_stale.py` prints 0, `check.py` passes (every Call Map call one the source makes), `graph.py` refuses no hand edge,
the graph layout check passes. And the prose on the pages is true: no statement the rebuild made false survives on the
Code Map's hand-authored articles, the Call Map's notes, or the logical-design page.

## Items, in order (a checkpoint entry after each)

1. **Every file keyed.** A module key in `extract.MODFILE`, a colour group and name in `graph.MOD`/`graph.MODNAME`, and an
   article (`newdesc.ARTICLES` with its slot, or `APPEND_TO` where the pristine page already has one) for each new file;
   the deleted files' keys, rows and pristine prose removed. The oracle modules stay in the not-running tail
   (`layout_mod.py`'s `ded` rule) and hidden by default.
2. **Every new live function described** (outside `__oracles__/`; about 720), by reading its code — `what` the Code Map's
   one-liner, `long` the explanation, `["-"]` where the one-liner is the whole story. A function that moved or was
   renamed may carry its old entry only after you have read the new body. Say what the function does in the design
   (DESIGN.md's terms), not a paraphrase of its lines.
3. **Every changed live function re-read**: each function present at 56e36b3 and at the tree whose body changed (diff
   the bodies by script — `inventory.py`'s offsets on both trees; a `git archive 56e36b3` copy is the old one); its entry
   corrected where the change made it false, kept where it is still true. Report the counts (changed, corrected, kept).
4. **The oracles** (`__oracles__/model-v1/`, 895; `renderList.js`, `sceneOracle.js`): one-liners suffice (`long: ["-"]`).
   Where an oracle function's body is identical to the same file's same function at 56e36b3 (script it), its 56e36b3 entry
   may be reused as is; the article heading says once that the module is the frozen pre-C1 model (A1 §14) — not each row.
   Read the rest. `renderList.js` and `sceneOracle.js`'s additions are described like live functions.
5. **The calls and flows.** `graph.py`'s hand edges that stopped being calls: each moved to where the call now is, or
   deleted (with the count of each). The Call Map's seven flows (`trees.py`): every flow that walks deleted code rewritten
   along the code as it is — the render path now goes through the Stage and the picture pyramid (DESIGN.md §9,
   `review/rebuild/A3-pyramid.md`), the drag through `stage.hold`/`setDragDelta` to `_dropMove` (A1 §15), the erase through
   the erase rule and the cuts in the job queue (A2 §4).
6. **The prose.** The pristine Code Map page's hand-written articles, the Call Map's notes, and `pages/boundless-logical-design.html`
   (hand-written, no generator): every statement the rebuild made false corrected in place, keeping the argument
   (the renderer's articles above all: the settle, the ladder, the carry, the hold, the quantum plates, the sync path;
   the model's: a shift is placement, co-residents and no merges, no read mints, a drag writes nothing until its drop,
   deleted subtrees leave the lattice). DESIGN.md is the authority on the design, the code on what exists. List each
   correction in your report (page, the old claim in a few words, the new).
7. **README.md** brought to the tree: the counts, the isolated and marks tables from this rebuild's own output, and one
   short dated paragraph on what this rebuild found and changed (the form of the 2026-09-22 one, concise).
8. **Seen in a browser**: the graph page and the Code Map in headless Chromium (a static server on :3050): Fit, no file
   block drawn empty, the hide-not-running toggle, a row expanding. Screenshots to scratch; say what was looked at. Nothing
   in Kobin's Chrome: say so.

## Files

Yours: everything under `tools/docmaps/` (scripts, data, pages). **Not yours: anything under `src/`** — you edit no
source; a source comment that misleads goes in your report. `docs/ai/*`, `DESIGN.md`, `docs/OPEN-FLAGS.md` and
`review/rebuild/*` (except your STATUS-LOG entries) are not yours either: R-MODEL-C34 (a reviewer, the model files, the
fuzz harness, `docs/ai/30`/`40`) and B-PYRAMID-5 (a builder, the raster files and `overlays.js`) run beside you and will
add or change a few functions before they land. Do the bulk now on the tree as it is; at the end re-run `rebuild.py` on
the tree as it is then and describe what they added; the orchestrator will send you their final diff for a last pass.

Publishing the pages to their claude.ai URLs is the orchestrator's, after your report — you publish nothing. Every commit
is the orchestrator's with `[skip ci]`; you commit nothing.

## Report (rule 11, under 60 lines)

`status`, `summary`, `filesChanged`, the rebuild's numbers (files, functions, calls, missing, stale, Call Map calls
checked, hand edges moved/deleted, isolated by reason), the counts of items 2–4 (described, re-read/corrected/kept,
oracle entries reused/read), the prose corrections (item 6, listed), what was seen in the browser, `decisions`,
`leastSure` (≥ 3), `questions` with recommendations, `openItems`.
