# -*- coding: utf-8 -*-
"""Per-function entries for the picture pyramid's compose (raster/PicturePyramid.js).
Written 2026-10-05 for the rebuilt tree."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/PicturePyramid.js":
        "The ink canvas composed from the picture pyramid (DESIGN.md §9, A3): each camera step publishes one view, "
        "plans every screen cell from one freshness-first rule list, and draws the plan directly or through one "
        "surface; it runs the rest render and the partial re-renders, holds a pen-up's results for one group commit, "
        "and keeps the paper, blur and older integrals. It posts nothing: requests leave through `onRequest`.",
}


# ---- src/engine/raster/PicturePyramid.js ----
add("pyr.cfgOr", "cfgOr(cfg, k)", "A cfg value, else the estimate's default (`EST_DEFAULTS`).", ["-"], "§9")
add("pyr.inter", "inter · meets · boxOf",
    "Rectangle helpers: the intersection (null when empty); do two meet (touching counts); a cell's box in its frame's units at zoom Z.", ["-"], "§9")
add("pyr.mkCanvas", "mkCanvas · hasOffscreen",
    "A DOM canvas (null without a document); whether OffscreenCanvas and ImageData exist (else the pyramid keeps raw pixels, as in jsdom).", ["-"], "§9")
add("pyr.PlanBudget", "PlanBudget",
    "One compose's image budget (A3 §1.5, PLAN §5.6 M1): own-grid records are drawn 1:1 and always taken; scaled stand-ins at most a cap of distinct images.",
    ["DESIGN.md §9: a compose draws at most `COMPOSE_IMAGES` (30) distinct images directly, because Chrome's 2D canvas pays ~100 ms a frame past 33 with any scaled. A refusal sends the plan to its next rule; `fork` and `adopt` try a plan on a copy. At rest the level plan's own-level plates are drawn scaled onto the rest grid, so `base` takes them as stand-ins. The cap is what keeps the store's pinned bound (M2)."],
    "§9")
add("pyr.PlanBudget.constructor", "PlanBudget.constructor(scaledCap, levelScaled)", "An empty budget with its cap of scaled images.", ["-"], "§9")
add("pyr.keep", "keep · base · take · room · fork · adopt",
    "Take an own-grid record; a plate of the view's own level (a stand-in at rest); a set of scaled records, all or none within the cap; the room left; a trial copy, and its adoption.", ["-"], "§9")
add("pyr.PicturePyramid", "PicturePyramid",
    "The picture pyramid's layer: the ink canvas, composed from the plates of levels, the rest set and the drag plane.",
    ["Each camera step publishes one view — FC2's one affine per view, X = (g − o)·σ + d, destination edges rounded to device pixels so neighbours share an edge exactly — and plans every screen cell from one rule list, freshness first (A3 §1.4): its own exact plate; the same picture from another frame's level; exact children; the finest exact coarser plate; the patch rule; the stale plate while its worker patch is pending; a stale coarser one; paper (DESIGN.md §9).",
     "Base plates are opaque, so every pixel ends with one source. It posts nothing: its requests leave through `onRequest` for the renderer's job queue and results come back through `onResult`. It keeps the paper, blur and older integrals the report reads (A3 §9.1)."],
    "§9")
add("pyr.PicturePyramid.constructor", "PicturePyramid.constructor(host, opts)",
    "Sets up the view object, the purpose generations, the estimate's constants (cfg or `EST_DEFAULTS`, calibrated online), the integrals and counters, and mounts the ink canvas.", ["-"], "§9")
add("pyr._mount", "_mount()", "Mounts the ink canvas at z-index 0, opaque (`alpha: false`), under the SVG layer.", ["-"], "§9")
add("pyr.setSize", "setSize(cssW, cssH, dpr)",
    "A resize or a dpr change: the canvas follows, the rest set goes (A3 §2.4), the surface is freed and the screen's bounds are recomputed.", ["-"], "§9")
add("pyr._sized", "_sized()", "The screen in device px, the band's floor σmin for it, and the store's pinned bound in plates.", ["-"], "§9")
add("pyr.budgetBytes", "budgetBytes()",
    "The store's byte budget for this screen (`PyramidStore.budgetBytes`): `plateViews` screens, never under the pinned bound.", ["-"], "§9")
add("pyr.setPlane", "setPlane(p)", "The drag plane to draw over the base (`MovePlane`'s layers, keyed `planeKey`), or null.", ["-"], "§9")
add("pyr.setAttention", "setAttention(x, y)",
    "The attention point in device px — the wheel or pinch focus, the last pointer — or null for the screen's centre: where the job queue deals strips from.", ["-"], "§9")
add("pyr.noteUserEdit", "noteUserEdit()",
    "Marks the commit a user's own action just made (an undo, a redo, a drop): its patch gets the user's budget.",
    ["Three frames of `patchUserMs`, 48 ms: one action, not a per-frame cost, so the exact patch is taken whenever it fits (DESIGN.md §9, PLAN §5.22 item 2)."],
    "§9")
add("pyr.setFar", "setFar(keys)", "The prefetch's far zoom-out keys: protected in the store, evicted first among the protected.", ["-"], "§9")
add("pyr.frameFor", "frameFor(cam)",
    "The camera step: the view for this camera — its level in the bounded band with hysteresis, or the rest set's grid when the camera rests on it — published once; then the still frame's rest render, the pen-up groups, the patch step and the view's requests.",
    ["The view draws from the level whose stretch σ = Z / Z(ℓ) lies in [σmin, 2^S·σmin) (DESIGN.md §9). A new level or frame moves the view's purpose generation, so queued view strips that will not be drawn are dropped at dispatch. Stillness is seen only on a frame: the caller runs one more `frameFor` after the camera stops. A change of frame or zoom discards the rest set."],
    "§9")
add("pyr._map", "_map(F, Z, S, lv)",
    "The published view, mapped once (FC2): rest mode at σ = 1 on the rest grid, else the level's grid stretched by σ; the destination snapped to device pixels, the revision moved only on a change.", ["-"], "§9")
add("pyr._publishView", "_publishView(v)",
    "Hands the store the eviction order's context (A3 §4.5): the view's frame, level and ring, the rest set, the path of frames to the root with each one's level shift, and the frame just left.", ["-"], "§9")
add("pyr._step", "_step()", "The level step S from the lever (1, 2 or 3), else the default.", ["-"], "§9")
add("pyr._onStep", "_onStep(S)",
    "A lever change of the step: every level plate of the old S goes, and the view's and the prefetch's queued jobs are dropped.", ["-"], "§9")
add("pyr.plan", "plan(v)",
    "The plan for a view: every screen cell's draws — a record or paper, its source and destination, its class (sharp, blur, older, held, paper) and whether it is exact — the plane's layers over them, and the images it uses.",
    ["`exact` marks the sources of rules (a)–(e), which PLAN §3 row 1's invariant is about. Own-grid records are drawn 1:1; the others count against `COMPOSE_IMAGES` less the plane's images. A stale draw under an open pen-up group is marked `held` (`_markHeld`)."],
    "§9")
add("pyr._planLevel", "_planLevel(v, P, B)", "The level mode's plan: every view cell the plane does not cover, planned by `_planCells`.", ["-"], "§9")
add("pyr._planCells", "_planCells(v, F, l, list, B)",
    "Plans level ℓ's cells of a frame so the image budget moves excess cells to coarser shared sources; then rule (c) — all children exact — upgrades cells while the budget takes them: paper first, then older, then blurred, nearest the attention point first.",
    ["When the budget binds, each cell not drawn sharp reserves its coarsest exact source and the cells are planned again nearest first, so the far ones fall to the shared coarse plates, not to paper (A3 §1.5)."],
    "§9")
add("pyr._coarsest", "_coarsest(v, F, l, i, j, B)",
    "The coarsest exact source within N levels above a cell not drawn sharp from its own grid — the most shared one — or null.", ["-"], "§9")
add("pyr._markHeld", "_markHeld(P)",
    "Marks a stale draw under an open pen-up group's rectangle, older than its stroke, as `held`: the current picture with the held path over it, not charged as older (A3 §3.6).", ["-"], "§9")
add("pyr._kids", "_kids(F, l, S, i, j)", "Rule (c): all 2^S × 2^S children of a cell, one level finer, exact; or null.", ["-"], "§9")
add("pyr._planCell", "_planCell(v, F, l, i, j, B, out)",
    "§1.4's lookup for one cell, in order: (a) its own exact plate; (b) the same picture from another frame's level; (d) the finest exact coarser plate — with (e), when the cell's own plate is stale over at most half its area, that plate sharp and the coarser picture over the dirty rectangles only; (f) the stale own plate; (f′) a stale coarser one; (g) paper.",
    ["The rest set a zoom left is tried before the first coarser level it is finer than (`_standInCell`). Rule (c), all children exact, is `_planCells`' upgrade. What keeps paper off the screen is this order: a stale plate is shown until its replacement lands, and a missing cell is drawn from the nearest fresh source the store holds, blurrier before older (DESIGN.md §9)."],
    "§9")
add("pyr._older", "_older(own, dst)",
    "Rule (f), a stale own plate drawn whole, classed for the integrals: unread while the camera's table lacks its tiles, waiting while a worker patch that makes it exact is asked or in flight, else neither — the `olderOtherMs` that must stay 0.", ["-"], "§9")
add("pyr._lastResort", "_lastResort(r, sub, dst, c)",
    "Rule (f′), a stale coarser stand-in for a cell with nothing fresh at any level, classed for the integrals as `_older` classes a stale own plate.", ["-"], "§9")
add("pyr._standInCell", "_standInCell(v, F, own, cb, dst, Zl, B, out)",
    "The rest set a zoom left as a cell's source, only where its plates are exact: over a stale own plate's dirty rectangles (the patch rule), else over the cell's part on screen; scaled, so its plates count against the stand-in cap.", ["-"], "§9")
add("pyr._restCover", "_restCover(F, rect)", "The kept rest set's plates over a rectangle, every one exact, or null.", ["-"], "§9")
add("pyr._mapped", "_mapped(F, l, S, i, j)",
    "Rule (b): the same picture from another frame's level, exact — a plate of one frame's level is a plate of another's by integer arithmetic on the cell digits (`level.mapCell`).", ["-"], "§9")
add("pyr._coarserExact", "_coarserExact(c, S)",
    "A coarser cell's exact picture: its own record, else its twin at another frame's level.",
    ["Past a crossing the frame left holds the coarser picture while the new frame's levels are not rendered yet (F137: the dense zoom back in drew paper with the parent's plates of that place in the store)."],
    "§9")
add("pyr._sub", "_sub(F, l, i, j, c, S)", "Where a cell lies inside a coarser plate, as a source rectangle `[sx, sy, sw, sw]` in that plate's pixels.", ["-"], "§9")
add("pyr._dirtyIn", "_dirtyIn(F, rec, padded, cb)",
    "The dirty rectangles since a plate's G that meet its tracked box: their bounding box grown by a pixel and clipped to the cell, with its area; null when the Stage's log does not reach back.", ["-"], "§9")
add("pyr._planRest", "_planRest(v, P, B)",
    "Rest mode's plan: each rest cell with a plate drawn from it — exact 1:1, or stale with the patch rule, a fresh level cover or the stale plate — over the level plan of the cells the rest set lacks.",
    ["The rest grid at an arbitrary Z never aligns with a level grid, so the level plan is drawn under the rest cells that have no rest plate (the file's header). A cell a whole dragged plane covers is not drawn."],
    "§9")
add("pyr._cover", "_cover(F, l, S, rect)",
    "A frame's level-ℓ plates over a rectangle, each exact or rule (b)'s exact mapped twin, or null — after a crossing the frame just left may hold the fresh picture.", ["-"], "§9")
add("pyr._coverOf", "_coverOf(Zg, rect, get)",
    "The plates of a grid over a rectangle, all present, with their draws clipped to it; null when one is missing or there are more than the compose's image cap.", ["-"], "§9")
add("pyr._planePlan", "_planePlan(v)",
    "The drag plane's layers for this view — records to draw after the base — and the base cells its BELOW layer replaces.",
    ["A partial plane (the selection's layers whole, the rest not) is drawn only when BELOW covers the selection's start footprint, which hides it where it was; else nothing is drawn and the selection stays in place — never the selection twice (H4, DESIGN.md §9)."],
    "§9")
add("pyr._landClip", "_landClip(v)", "The view cells a landing plane still covers: those whose own source is not exact yet.", ["-"], "§9")
add("pyr.cellFresh", "cellFresh(v, i, j)",
    "Is a view cell's own source exact: the landing's per-cell test — at the drop each cell keeps the plane until its fresh plate lands.", ["-"], "§9")
add("pyr.compose", "compose()",
    "One compose: a commit's patch step if due, then the plan, the drawn set pinned in the store, the draws — directly under `COMPOSE_IMAGES`, else through one surface — the plane over them, and the integrals charged.",
    ["The patch step runs first so no compose draws a plate a commit staled with no patch asked (PLAN §5.15). The canvas is filled with paper, then every draw lands at whole device pixels."],
    "§9")
add("pyr._paint", "_paint(ctx, d, v, toSurface)",
    "One draw into the ink canvas or the surface, destination edges rounded to whole device pixels so neighbours share an edge; paper where there is no record, nothing for a closed one.", ["-"], "§9")
add("pyr._paintPlane", "_paintPlane(ctx, P, v)",
    "The plane after the base, in paint order — BELOW, the selection translated by the drag, OVER; while landing, clipped to the cells whose base is not exact yet.", ["-"], "§9")
add("pyr._blitSurface", "_blitSurface(ctx, P, v)",
    "The surface path: the plan drawn once 1:1 at the view's grid whenever its signature changes, then blitted scaled by σ each frame.",
    ["Past `COMPOSE_IMAGES` distinct images a direct compose would cost ~100 ms a frame in Chrome's 2D canvas (DESIGN.md §9)."],
    "§9")
add("pyr._idleSurface", "_idleSurface · _freeSurface",
    "After a direct compose, free the surface once it has gone 10 s unused; free it now.", ["-"], "§9")
add("pyr._charge", "_charge(P, v)",
    "The integrals, charged forward (A3 §9.1): the last compose's paper, blur and older shares of the screen times how long it stayed up, then this compose's shares.",
    ["Older splits by cause: `olderPatchMs` while the worker job that makes the cell exact is asked or in flight, `olderUnreadMs` while its tiles are unread, `olderOtherMs` otherwise — 0 in the never-older fuzz (DESIGN.md §9). The level plan under a rest cell is charged only outside the rest cells."],
    "§9")
add("pyr._onStill", "_onStill()",
    "The first still frame: the visible rest cells rendered inline when the estimate fits `restInlineMs` (8 ms), else posted to the workers after the quiet as one group, shown when all are in.",
    ["Back at the kept set's own Z, its records are the rest set again. An inline render that ran over marks the estimate heavy, so the next similar set goes to the workers (DESIGN.md §9)."],
    "§9")
add("pyr._postRest", "_postRest()",
    "The quiet (`restQuietMs`, 100 ms) ran out with the camera still: the rest cells go to the workers as one group, and the rest set is shown when all are in.", ["-"], "§9")
add("pyr._restWant", "_restWant(F, Z)",
    "The rest cells on screen with no plate (a stale one is the patch step's), not held for a group and not asked for.", ["-"], "§9")
add("pyr._wanted", "_wanted(c)",
    "Whether a cell is to be asked for: not in a group, wanted by the store, no standing ask at or past its dirt, and covered by the camera's table.", ["-"], "§9")
add("pyr.covered", "covered(c)",
    "Whether the camera's table holds every tile under a camera-frame cell: one that does not is drawn from stand-ins and never asked for until the idle read brings its tiles in (A3 §4.2).", ["-"], "§9")
add("pyr.unask", "unask(cells, G)",
    "Cells a job asked for at G that will not come from it — its pack refused them, or its strip was dropped — asked for again once covered, unless a newer ask stands.",
    ["A job carries the G it was asked at (`askG`), so an older patch's drop or landing never leaves a newer patch's stale plate read as unasked (DESIGN.md §9; scenario 7's other older, PLAN §5.22 item 3). A pen-up group's refused cells are re-asked by the group, which keeps its path up meanwhile."],
    "§9")
add("pyr._onMove", "_onMove()", "The camera moved: a pending rest render's quiet timer is cancelled.", ["-"], "§9")
add("pyr._discardRest", "_discardRest(why)",
    "Ends the rest set — a zoom, a frame change, a resize or a dpr change — and drops its queued jobs by generation; a zoom keeps a shown set's records as the stand-in, anything else removes them.",
    ["DESIGN.md §9: a zoom keeps the rest set's records as a stand-in at their own Z — exact there, they beat a stale level plate — until the next zoom's set replaces them; a frame change, a resize or a dpr change removes them (removed, not staled: they are wrong at another frame or grid)."],
    "§9")
add("pyr.estimate", "estimate(job)",
    "The time a job would take on this thread: T = 0.73 µs an edge + 34 ns a pixel + 0.15 ms a plate (+ the union rows and a merge per plate for a patch) + the pack, with the calibrated constants.",
    ["The pack's terms — a kept item's cost and a list item's — were added when the dense undo's inline pack, 45–64 ms, was priced at 0 (PLAN §5.15 item 1)."],
    "§9")
add("pyr.calibrate", "calibrate(t)",
    "Online calibration (A3 §2.2): each of the estimate's constants moves by an EWMA from a job's own timings and counts, or a pack's, when its sample is large enough to mean something.", ["-"], "§9")
add("pyr._renderInline", "_renderInline(job)",
    "Renders a typed job's cells on this thread: the pack at the Stage's G, `renderPlate` per cell (its clip when the job has clips) into one RGBA scratch, then a bitmap — or raw pixels in jsdom; a clipped cell leaves as a patch.",
    ["A pack that refused every cell renders nothing: no cell is rendered from a table that lacks its tiles. The core's timings feed `calibrate`."],
    "§9")
add("pyr.renderNow", "renderNow(job)",
    "A typed job rendered on this thread now and landed as any result: the drag plane's stopgap for a small selection (A3 §6).", ["-"], "§9")
add("pyr._offscreen", "_offscreen · _bitmapOf",
    "The one scratch `OffscreenCanvas` (1 MiB); an RGBA plate turned into an `ImageBitmap` through it.", ["-"], "§9")
add("pyr.merge", "merge(old, patch, clip)",
    "Lands a patch in a stored plate (A3 §3.2): the old plate and the patch's rectangle drawn through the scratch into a new bitmap — or `pastePatch` into its pixels in jsdom; a paper plate is filled first.", ["-"], "§9")
add("pyr.onResult", "onResult(rec)",
    "A result from the workers or the inline executor: a rest cell of a discarded set is closed; one a group waits for is held aside when it counts — packed at or after the group's G, or exact at landing; a patch is merged into its record; anything else is put (rule 1).",
    ["A second result for a cell an open pen-up group already holds keeps the newer aside: nothing is put before the group's commit (A3 §3.6)."],
    "§9")
add("pyr._notForGroup", "_notForGroup(g, rec)",
    "A pen-up group's cell landed without what the group waits for: put only when it shows none of the group's strokes, and asked again inside the group unless a job for it is coming.",
    ["A result that showed a member's stroke would draw it twice beside its held path, which stays up until the commit — never both (A3 §3.6, F135: two groups over one cell each took the other's results)."],
    "§9")
add("pyr._hold", "_hold · _unhold",
    "Keep a result aside for a group, its bytes counted in the store's budget; give one back (closed).", ["-"], "§9")
add("pyr._take", "_take(rec)",
    "Puts a whole plate, or merges a patch into its record — the record's G raised only when the clip covers the dirt since it; the cell's ask is answered unless it is newer than the result's own (`askG`).",
    ["A patch older than its record, or with no record to land in, is a miss. A patch whose clip is the whole plate is put as a plate."],
    "§9")
add("pyr._covers", "_covers(rec, clip)",
    "Does a plate-local clip hold every dirty rectangle since the record's G, over the plate grown by a pixel (A3 §3.2)?", ["-"], "§9")
add("pyr.noteCommit", "noteCommit()",
    "A Stage commit staled what it dirtied: its patch step is due in this task — run by the next compose or camera step, else the renderer's microtask — not in the hook itself.",
    ["So no compose draws a plate a commit staled with no patch asked (PLAN §5.15 item 1). Not run in the hook because an undo's `noteUserEdit` follows its commit and sets the patch's budget (DESIGN.md §9)."],
    "§9")
add("pyr.patchIfDue", "patchIfDue() · patchDue (getter)",
    "Runs a commit's patch step unless a compose or a camera step already has; whether one is due.", ["-"], "§9")
add("pyr._patchStep", "_patchStep()",
    "The stale cells the view draws from its own grid — covered by the table, not in a group, not asked since their dirt — patched now or asked for, never left older than they must be.", ["-"], "§9")
add("pyr.patchPlan", "patchPlan(cells, dirtyRects, user)",
    "Per stale cell, the clip of the dirty rectangles since its G, and the decision: inline at full resolution when the patch fits the budget; else the finest coarser level whose patches fit, drawn over the dirty rectangles, with the full patches asked for at priority 0; else everything to the workers.",
    ["The budget: three frames of `patchUserMs` (48 ms) for a user's action — an undo, a redo, a drop — paid once, so the exact patch is taken whenever it fits; `patchUserMs` for a pen-up's group, which waits for full resolution and searches no coarser level; `patchInlineMs` (6 ms) for the patches the bake issues at every step (DESIGN.md §9, PLAN §5.22 item 2).",
     "Each coarser level costs a walk of the whole list, and the pack's terms do not shrink with the level, so over the budget on the pack alone no level is tried; the search stops at the first level with no records. The last decision is kept for the report (`lastPatch`)."],
    "§9")
add("pyr._coarseJob", "_coarseJob(F, l, S, rects)",
    "Level ℓ's cells over the dirty rectangles: a patch where the record exists, a whole render where not; null where no record exists at all.", ["-"], "§9")
add("pyr.applyPatchPlan", "applyPatchPlan(plan, group)",
    "Carries out `patchPlan`'s decision: the inline render landed, or the coarse level rendered inline and the full patches asked for, or everything asked for; the records rendered inline returned.", ["-"], "§9")
add("pyr.groupCommit", "groupCommit(id, rect, onCommit)",
    "Pen-up: the drawn cells under the stroke's box re-rendered — inline when the patch fits, else one priority-0 group whose results are held aside — and `onCommit` run in the task that publishes them, where the renderer releases the live path.",
    ["A3 §3.6: one group commit publishes the drawn cells under its box and the held SVG path is released in the same task, so no frame shows the stroke twice or not at all. A pen-up over cells an open pen-up group waits for or holds joins it (F135). A group older than `LIVE_HOLD_MS` (3 s) commits what it has (DESIGN.md §9)."],
    "§9")
add("pyr._liveOver", "_liveOver(keys)", "The open pen-up group that waits for or holds any of these cells, or null.", ["-"], "§9")
add("pyr._join", "_join(g, m, stale, missing)",
    "A pen-up over an open group's cells joins it (F135): one group, both paths released at its commit; held results the new stroke staled go back to waiting, and only cells nothing is asked for are asked; the time limit stays the first stroke's.",
    ["Two groups over one cell each took the other's results, and the first path stayed 3 s over plates already showing its stroke (jsdom)."],
    "§9")
add("pyr._absorb", "_absorb(g, o)", "Folds one pen-up group into another: its members, cells and held results.", ["-"], "§9")
add("pyr.moveGroup", "moveGroup(id, rect)",
    "A crossing carried a held path's rectangle into the view's new frame (`RasterRenderer._liveCross`): its group follows.", ["-"], "§9")
add("pyr._under", "_under · _underAll",
    "The view's own drawn cells meeting a rectangle (or several, each cell once) that are not exact: the stale records and the missing cells.", ["-"], "§9")
add("pyr._askGroup", "_askGroup(g, stale, missing)",
    "A group's cells asked for: the stale ones patched (inline when it fits), the missing ones rendered whole, at priority 0.", ["-"], "§9")
add("pyr._retarget", "_retarget()",
    "The view's drawn set moved while a pen-up group waits: it waits for the new drawn cells under its rectangles instead; what it held stays held, what is no longer drawn is let go (A3 §3.6 item 5).", ["-"], "§9")
add("pyr._reaskGroups", "_reaskGroups()", "A group's cells the pack refused, asked again inside the group once the table covers them.", ["-"], "§9")
add("pyr._openGroup", "_openGroup(id, keys, onCommit, purpose)",
    "Opens a group — a pen-up's (`live`) or a worker rest set's — over its cells, at the Stage's G.", ["-"], "§9")
add("pyr._commitGroup", "_commitGroup(g, timedOut)",
    "Every held result put or merged at once, one compose, then `onCommit` — one task, so no frame shows both or neither.", ["-"], "§9")
add("pyr._dropGroup", "_dropGroup(id)", "Abandons a group: its held results closed, its cells let go.", ["-"], "§9")
add("pyr._checkGroups", "_checkGroups()", "Groups older than `LIVE_HOLD_MS` (3 s) commit what they have.", ["-"], "§9")
add("pyr._requestView", "_requestView()",
    "The view's missing cells at its level — under the rest cells the rest set lacks, in rest mode — asked for at priority 1.", ["-"], "§9")
add("pyr._bareRange", "_bareRange(v)", "The level cell range under the rest cells with no rest plate, or null.", ["-"], "§9")
add("pyr._job", "_job(kind, prio, o)",
    "A typed job for the queue (`jobQueue.js`), with the attention point in the job's own grid pixels so its strips are dealt from there.", ["-"], "§9")
add("pyr._ask", "_ask · _request",
    "Request a job for cells at the Stage's G, which the job carries (`askG`) so a later drop or landing forgets no newer ask; hand jobs to the renderer (`onRequest`).", ["-"], "§9")
add("pyr.onStoreRelease", "onStoreRelease()",
    "The store released everything (a hidden tab): the surface, the rest set and the asks go with it.", ["-"], "§9")
add("pyr.report", "report()",
    "For the report and the Dev panel: the view (mode, level, S, σ, Z), the rest set and its stand-in, the open groups, the estimate's constants, the integrals and every counter.", ["-"], "§14")
add("pyr.destroy", "destroy()", "Stops the patch step and the rest timer, frees the surface, drops every group and removes the ink canvas.", ["-"], "§9")
add("pyr.heldBytes", "heldBytes · cellOf",
    "The bytes a result held aside for a group counts against the cap; a record's cell descriptor.", ["-"], "§9")
add("pyr.sampleOf", "sampleOf(res, U)",
    "A worker result's core timings and counts as `calibrate`'s sample, with the union rows the estimate priced the job with.", ["-"], "§9")
add("pyr.gBox", "gBox · gRect · subIn",
    "View-grid geometry: a cell at one grid zoom as view-grid pixels (exact when the ratio is a power of two); a frame-unit rectangle as view-grid pixels; the part of a source rectangle a box covers.", ["-"], "§9")
add("pyr.draw", "draw(rec, src, g, cls, exact, under)", "One draw of a plan: its record, source rectangle, view-grid destination, class and exactness.", ["-"], "§9")
add("pyr.isWhole", "isWhole · clipOf · descr",
    "Is a clip the whole plate; a frame-unit box as a plate-local clip (rounded outward and grown a pixel); a record's cell descriptor without its pixels.", ["-"], "§9")
add("pyr.planSig", "planSig(P)", "A plan's identity for the surface — which record at which G where — so the surface is redrawn only when it changes.", ["-"], "§9")
add("pyr.parseHex", "parseHex · paperPlate · fillPaper",
    "The paper colour as RGB; an opaque plate of paper; paper over a clip of the scratch (an empty patch: nothing is drawn there any more).", ["-"], "§9")
