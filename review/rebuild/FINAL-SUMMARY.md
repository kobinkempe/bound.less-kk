# The renderer and document-model rebuild — the final check, for Kobin (2026-10-07)

**Where it is.** Branch `claude/hopeful-dirac-iotb9n` (pushed), on top of `rasteriser` at 56e36b3. The final tree is
a0b0ed4; later commits are documents only. Nothing is deployed (the last deploy is 2026-09-08). **Nothing has been
checked in your Chrome** — every number below is jsdom or headless Chromium in the cloud container, which cannot see
the GPU compositor or real pointer timing.

The two halves of the check: `FINAL-AUDIT.md` (the built code against the plan and the design documents) and
`FINAL-MEASUREMENTS.md` (69 headless Chromium runs: the final tree against 59f0a76, the tree before this last round, and
56e36b3, the tree before the rebuild). The decisions and their reasons are in `PLAN.md` §5; the history in `STATUS-LOG.md`.

## What the rebuild changed, in one line each

- **One picture path.** The picture pyramid draws every plate; the old picture layer, the quantum plates and their
  special cases (the sync path, the settle, the ladder, the carry, the hold) are deleted.
- **One list of what is drawn.** The Stage: both renderers, hit tests, the lasso and the drag all read it. The SVG
  renderer draws the same items.
- **The eraser.** A mark is document state; its cuts run in the same worker queue as the plates.
- **The document model.** A frame's leftover shift is placement, read on the fly (C1); a drag writes nothing until its
  drop, then one write (C2); frames keep their identity — a frame dropped on another's cell stays itself, nothing merges
  (C3); ink an erase tears off goes into a private frame (C4); reading never creates frames.
- **Size.** The app's code is 7 % longer (30,198 → 32,450 lines of code, comments down 4 %), with fewer mechanisms; the
  old central files shrank (`Renderer.js` −28 %, `KobinEngine.js` −25 %, `Document.js` −11 %). Most of the growth is
  in tests and in the frozen copy of the old model the tests compare against.

## The check's results

**The audit** found no major problem. All eight design targets are built; every row of the plan's acceptance list has
its test; every mechanism the plan said to remove is gone (the loaders for old saved files stay until 2026-12-31). The
documents were corrected where the code had made them false; `docs/ai/10-STATUS.txt` is current.

**The tests.** The quick suite: 2,213 passed, 0 failed. The model fuzz (the new model against the frozen old one, random
edit sequences): 500 + 500 tile walks and 200 + 200 selection walks green; every place they differ is explained and
counted, each allowance shown to catch a real defect of its shape. Typecheck and lint clean.

**The measurements** (headless Chromium; final against the tree before this round, `landed`):

| | final | landed |
|---|---|---|
| Blank paper on screen, every scenario | 0 ms | up to 0.65 s (zooming back in) |
| The picture after each gesture (scenarios 1–6) | identical on all three trees | |
| Lasso, then drag 45 objects: the drag | 1.95–2.03 s | 2.47–2.53 s |
| …the drop's frame | 0.51–0.58 s | 0.99–1.12 s |
| Erase while zooming: the erase finishes | 14 of 14 runs (3.7–4.9 s) | 5 of 5 (3.8–4.4 s); 1 stall in 10 runs on the tree just before F140's fix |

**Fixed in this last round:** the model fuzz's differences (F138: four real defects), the zoom-back paper (F137), the
erase that could stall (F140), the drop re-deciding the selection's outline (0.5–0.8 s a drop), a camera put in the
wrong place by a Delete during a zoom crossing, and the stale comments and documents.

## Found, still open

1. **F139: a pause after undo or redo.** With a moved frame's ink in view, each undo or redo waits 0.4–0.6 s for its
   first picture (the frame clean-up forgets a frame the view needs, and the next render makes it again). No blank
   paper; the same on the tree before this round.
2. **Undo's sharp picture** (scenario 6) came later in this pass (0.35 / 0.85 s against 0.17 / 0.33), the opposite of the
   previous pass's measurement. Two runs a tree: not yet a finding.
3. **F141 (minor):** a Delete in the same frame as a zoom crossing into the deleted frame now puts the camera at the top
   level (before: the wrong place one level up).
4. Smaller, untraced: the `?svg` round trip differs by 18 px in one mid-gesture shot; scenario 7's erased edge moves by a
   sub-pixel from run to run (probably the pen's event timing); scenario 1's worst frame 0.45–0.71 s (as before this
   round); 2 of 14 erase runs briefly drew a stroke and its plates together (as before).

## Decisions for you

1. **F139:** build a keep rule so the view's frames survive the clean-up? Recommended: yes, next.
2. **The drop's `setBatch` wrap:** no measured benefit with any cache the app can hold. Recommended: delete it (the plan
   already says so).
3. **"Moved into":** objects you drag belong, after the drop, to the frame of the place they land; a dragged frame keeps
   its contents; a sub-frame pushed across a cell edge becomes a child of the neighbouring frame and stays selected. Is
   that what you expect?
4. **A second parent pointer** (so a dragged frame's sub-frames stay its own for good): not built. Recommended: not
   unless you want groups that persist after deselecting.
5. **The code map pages:** three of its runs are done (every live function described and re-read). Left: the ~905
   functions of the frozen old model, the call flows, the pages' prose, then republishing. Continue, or leave the frozen
   model off the pages as the test kit is?
6. `CLAUDE.md` still says the quick suite is ~1,650 tests in 107 suites (now 2,213 in 196) — your file.
7. Deploying is yours to decide.

## Please try in your Chrome

What headless cannot show: the drag's feel and the drop; an undo after dragging a frame (the pause, a flash);
translucent ink at pen-up; a deep zoom out and back (blur, texture uploads, memory); erasing while zooming.

And the user-visible rules, each built as written:

- An undo that empties a selected frame deselects it; a redo does not bring it back.
- Undoing the cut of a selected piece selects the restored whole stroke.
- A deselect or a tool change mid-drag puts the drag back where it started.
- A frame dropped where another holds ink stays itself — it is not merged.
- A lasso over ink an erase tore takes the frames whole, not the pieces.
- Undoing a subtree delete can put the subtree back beside new ink in its cell.
- A camera left in a deleted frame moves to a fresh frame there.
