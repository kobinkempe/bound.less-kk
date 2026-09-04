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

Underneath, one piece at a time and never blocking a phase: the **structural lane**.

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
- [ ] Small things worth doing with it: the manifest `theme_color` is black against a
      paper-coloured app; the debug engine handle `window.__kobinEngine` is exposed in
      production; a `.gitattributes` line to normalise line endings, as its own commit so
      the diff is only endings.
- [ ] Run one row of the UAT matrix on a machine that is not the development one.

## 3. Performance and bugs

**Bugs**, in the order OPEN-FLAGS ranks them. Each has its own entry there; nothing is
restated here.

| flag | state | first step |
|---|---|---|
| F34 | fixed in arithmetic, **not yet seen in a browser** | verify by hand; then the design-correct repair, F2 below |
| F35 | captured, undiagnosed | F3 below: log the three silent `continue`s in the drag |
| F29 | unreproduced | report 07-22-12 plus a zoom-out sweep; F8 below is probably part of it |
| F30 | unreproduced synchronously, instrumented | wait for the next report; it arrives with its own explanation |
| F32 | fixed 2026-09-03, unverified | the lasso judges by ink where the box straddles the loop; Kobin to redraw the loop that missed |
| F36 | latent | S1 below, one `TileGrid` type. Kobin, 2026-09-02: a real bug, just unlikely to be caught |
| F5 | standing | closes only when Kobin says the eraser works |
| — | **a move is not exact** | from the F35 numbers: an object moved 0.143 units in its own frame between two reports with no gesture between. Kobin, 2026-09-02: the defect is in the move path; the undo/redo between the reports is only how it was seen. Part of F35, not a flag of its own |

**Performance**

- [ ] **HIGH PRIORITY (Kobin, 2026-09-03) — the crawl's repaint with no budget.** One of
      the first items of this phase. The ant budget came off on 2026-09-03 at
      Kobin's instruction, so every selected piece on screen is outlined. Measured on the
      desktop, dashed ants cost ~0.8 µs a pixel a repaint and the crawl repaints 20 times
      a second: with the whole 2026-09-03 drawing selected, 72,554 px of ants at the
      report camera holds a frame at 50 ms, and 275,820 px at 4× in holds it at 200 ms.
      The phone has not been felt yet. The levers, none of them a change of dash density:
      a march that slows as the selection grows (cycle time scaled by length, so a
      repaint lands on a fraction of frames); static dashes past a length (one repaint
      per decision); or the ants on a WebGL layer, where the cost stops depending on
      length (Kobin: not yet). Costed in OPEN-FLAGS F39.
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

- [ ] E1 `perf.instrument` PI-6 asserts wall-clock time; make it a trace-mode assertion.
- [ ] E2 `App.slow.test.js` costs 195 s to assert one string.
- [ ] E3 machine-dependent benches want a banner saying so.
- [ ] E4 a `test:erase` script for the slow erase suites.
- [ ] 68 unused-variable warnings left in test files after the 2026-09-02 lint pass.

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

## The structural lane

Kobin, 2026-09-02: these six, one piece at a time, each shipped behind the contract test
and the manual visual pass, never as a release of their own.

| id | item | size | detail |
|---|---|---|---|
| S1 | **One `TileGrid` type** for the three things called a tile: the frame cell, the object's tile grid and the render-cache square. Same W, three near-identical APIs, different phase conventions; already confused once. **A real bug, unlikely to be caught** (Kobin), so it is also OPEN-FLAGS F36. | medium | A1, proposal 2 |
| S2 | **A lint rule enforcing the layering**, which today holds by convention. `eslint-plugin-import` `no-restricted-paths`, about twenty lines; the valuable line is that `engine/*` may never import from `Pages/`, `hooks/`, `cloud/` or `storage/`. | small | proposal 3 |
| S3 | **JSDoc typedefs plus `checkJs` on `src/engine/geometry` only.** Eight types, and `Rect` versus `BBox` alone pays for it. Not a TypeScript migration. | small | proposal 4 |
| S4 | **Renderer and CanvasEditor** are each over 1,200 lines. The raw-SVG selection overlay and the cloud/persistence effects are the natural first extractions. | medium | C2, C3 |
| S5 | **The five small duplications**: `loopsBBox`/`loopsBbox`, two `VertexSet`s, two `reversePiece`s, three winding implementations, three bbox paths. | small each | B1–B5 |
| S6 | **Toolchain**: React 17, CRA 4 and Node 14. Vite plus React 18 is about a day, plus the Jest-to-Vitest move across 85 suites, which is the part with real risk. Blocks AI scene names. | large | proposal 6, big item 9 |

Still open from the design documents, unchanged: F1 to F8 under Detail. F2 is the
design-correct repair for F34 and F3 is the cheapest step on F35; F8 is probably part of
F29.

Housekeeping, none of it urgent: D2 the 153 MB reports folder inside the tree, D4 the
unused TypeScript dependency and config, D5 the timing dump at the repo root; and after
any change that adds or removes a function, rebuild and republish the four reference pages
(`tools/docmaps/README.md`). The autosave rework of 2026-09-02 added 56 functions in four
files that the pages do not yet carry; `verify_coverage.py` names them.

**Deliberately not built** (moved here from `docs/ai/10-STATUS.txt` on 2026-09-02):

```text
WHAT IS DELIBERATELY NOT BUILT
    - D1 from the frame-lattice bible: a piece is still {C, r, a0, sweep, A, B}
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
        F34 (fixed, unverified), F35, F29, F30, F32.
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
