# -*- coding: utf-8 -*-
"""Comprehensive descriptions — KobinEngine (the facade)."""

L = {
"eng.pointerDown": [
 "The public entry for a press. Its only job is to time the gesture and hand off.",
 "Records a start timestamp, calls `_pointerDown` to do the actual work, and then logs the elapsed time to the operation log under the op name `pointerDown`.",
 "The timing wrapper is deliberate: input handlers are where a user feels cost, so the boundary is measured rather than the internals guessed at.",
],
"eng.pointerMove": [
 "The public entry for a drag. Times the call and delegates to `_pointerMove`.",
 "This fires many times a second, so everything inside is designed to be cheap — the pen appends one sample, the drag recomputes one displacement.",
],
"eng.pointerUp": [
 "The public entry for a release. Times the call and delegates to `_pointerUp`.",
 "Also called indirectly by the camera: crossing a level finalises any live stroke first, through a hook, so a stroke is never left half-written across two coordinate systems.",
],
"eng._pointerDown": [
 "Decides what the gesture is and starts it. Five outcomes, by tool.",
 "**Pan** — remember the start point and do nothing else.",
 "**Whole-object eraser** — mark erasing and delete whatever is under the cursor.",
 "**Area eraser** — create a background-coloured stroke through the ordinary pen pipeline. The mark appears instantly and covers what is beneath it by drawing order alone; the real cut happens later, in the background.",
 "**Select** — hit-test. On ink, start a move: flush any unbaked eraser marks over everything selected first, then turn on batch mode in the tile cache. On empty paper, start a lasso.",
 "**Pen** — allocate an id, build the stroke object at the current pen width divided by the zoom, attach a live arc chain, add it to the document as *live* (so it stays out of the spatial index while it is still growing), and hand it to the renderer.",
],
"eng._pointerMove": [
 "Extends whatever `_pointerDown` started.",
 "Pan adjusts the camera. The area eraser falls through to the pen path, because the eraser *is* a stroke.",
 "For the pen: converts the pointer to frame coordinates, pushes the sample, and feeds it to the live arc chain — which rebuilds only the two gaps the new sample disturbs, so this is constant time per point.",
 "For a straight-line pen, replaces the second point instead of appending; for a drag, calls `_dragSelection`; for a lasso, appends a point if it moved more than a pixel.",
],
"eng._pointerUp": [
 "Ends the gesture and schedules everything that follows from it.",
 "**Lasso** — apply the loop, then always redraw the selection layer, even when nothing was caught, or the loop stays painted on screen.",
 "**Drag** — re-home every moved object into the box it now sits in, then push a single undo entry for the whole drag.",
 "**Stroke** — journal the gesture *before* the samples are dropped, end the live drawing, finalise the object in the document (which indexes it and updates the tile cache), queue the perimeter resolve, and schedule the background worker.",
 "An eraser stroke additionally pushes one `eraseCommit` undo entry that all its later background work appends to, so one gesture stays one undo however many objects it eventually cuts.",
],
"eng._startPen": [
 "Attaches a live arc chain to a stroke about to be drawn.",
 "Sets the chain's tolerance from the zoom the stroke is being drawn at — a fraction of a pixel on screen right now. That matters because the swap from the drawn chain to the resolved outline is the only moment the difference between them could be visible, and at this tolerance it is sub-pixel by construction.",
 "The straight-line tool gets no live chain: it replaces its second point on every move, and an incremental chain cannot take a sample back.",
],
"eng._note": [
 "Appends an entry to the journal — the record of what the *user* did, as opposed to what the document ended up as.",
 "A stroke entry carries the pen width, the line width in frame units, and a thinned copy of the samples. An erase entry carries the eraser size and an initially empty list of cuts that the background worker fills in as it goes.",
 "This is what turns a bug report from a snapshot of wreckage into a sequence of gestures that produced it.",
],
"eng._perf": [
 "Records one operation in the rolling performance log, with the level, the in-level zoom, a wall-clock timestamp, and any extra fields the caller supplies.",
 "Below an 8 ms floor an entry is dropped unless the caller insists or trace mode is on. The floor exists because the log holds 300 entries and a single pinch would otherwise evict everything else — but it is also what once hid a session with 62 seconds elapsed and 157 ms recorded, which is why trace mode can remove it.",
],
"eng._noteFast": [
 "Aggregates a high-frequency operation instead of logging each one.",
 "Zoom and pan steps happen hundreds of times per gesture. Keeping a count, a total and a worst case costs nothing and survives in the log, where individual entries would be evicted within seconds.",
],
"erp._queueBake": [
 "Queues a drawn stroke's perimeter resolve as a job with a cursor in it.",
 "Hands the job the arc chain the live pen already built, which skips the single most expensive phase of the resolve — it was paid for a few microseconds at a time while the user drew.",
 "Deliberately leaves the pen chain attached to the object: it is what the renderer draws until the resolved outline lands, so the ink does not change shape at pen-up and again when the bake finishes.",
],
"erp._scheduleBake": [
 "Arms the single background timer.",
 "One timer, and the soonest request wins: a pending 400 ms erase timer must not delay a stroke's resolve, which wants to run immediately. If a sooner deadline arrives the existing timer is cleared and replaced.",
],
"erp._bakeTick": [
 "The background worker's entry point. Wraps the real work in timing.",
 "This is timed because it was once the largest piece of untimed main-thread work in the engine: a slice is budgeted at 8 ms but one object can cost far more, and until it was instrumented none of that reached a report.",
],
"erp._bakeTickInner": [
 "One slice of background work, then re-arms itself if anything is left.",
 "**Stands aside** while the pointer is down or a drag is in progress, and for a short window after the camera moves — but never for more than about a second and a half in total, so a restless camera cannot starve the queue.",
 "**Resolves outlines first.** An eraser cannot be subtracted until it has a resolved outline, and neither can the ink beneath it.",
 "**Then folds erasers into ink**, object by object, charging the next object at what the last one actually cost so a slice sitting at 7.9 ms does not start another expensive one. A single object costing more than the whole budget still runs, or it would be refused forever.",
 "When every object under a mark has been handled, the white mark is removed silently — undo goes through its commit entry, not through the mark.",
],
"erp._camBusy": [
 "True if the camera moved recently enough that a background slice would land on a frame the user is watching.",
 "A simple timestamp comparison against a fixed idle window. Being wrong in the cautious direction only delays work; being wrong the other way drops a frame.",
],
"erp._ensureShapeBakes": [
 "Walks the whole document and queues a resolve for any stroke that is still raw.",
 "Cheap, and it is the only thing guaranteeing no stroke is left unresolved forever — after a load, after an undo, or after a job was dropped because its object had been erased while it sat in the queue.",
],
"erp._stepShapeBakes": [
 "Runs perimeter resolves for up to a time budget, then reports whether more remain.",
 "For each queued job: check the object still exists and is still a raw stroke (it may have been undone, erased, or already resolved), step the job with whatever time is left, and if it finished, install the result.",
 "Installing means sealing any unclosed outline, replacing the stroke with its resolved shape in the document, and then checking whether the object is now too wide for its box and needs promoting a level.",
 "Triggers one render if anything changed.",
],
"erp._sealed": [
 "Guarantees a resolved outline actually closes.",
 "A stroke whose two edges fail to stitch would otherwise be stored as its two rails plus the slivers between them: no boundary, no meaningful inside, nothing painted, and a drawing that cannot be saved at all because the file format validates closure.",
 "Refusing is not an option — the stroke has to become something — so unclosed chains are stitched together and closed with straight lines, and the resulting dust is dropped.",
 "Records how much edge was fabricated. A seal a fifth of the pen wide is invisible; one at 45% of the loop's perimeter is a straight line drawn across the middle of a stroke, and the two are indistinguishable without the number.",
],
"erp._promoteOversize": [
 "Enforces the rule that an object never reaches past its box's immediate neighbours.",
 "If the object's extent exceeds one box width, it is moved to the parent level: every coordinate divided by the crossing ratio, which is a power of two, so this is a change of units and not a loss of accuracy — the mantissa is untouched and only the exponent moves.",
 "The object becomes a small, finely-detailed object one level up, where the rule holds with room to spare. Repeats until it fits, which for any real gesture is never or once.",
 "Line width and pen width are scaled to match, because they are lengths in the same units.",
],
"erp._eraseStrokes": [
 "Collects the eraser gestures that have a resolved outline, oldest first.",
 "An eraser that is still raw is not skipped, it is simply not ready — the same tick resolves outlines before it touches erases, so it arrives here a tick later.",
],
"erp._doneSet": [
 "Returns the set of object ids a given eraser gesture has already handled, creating it on first use.",
 "This is what stops an eraser reconsidering the same object repeatedly, and it doubles as the record of everything the gesture looked at, which a spent mark reports if it cut nothing.",
],
"erp._nextEraseTarget": [
 "Finds the first object beneath an eraser that it has not yet handled.",
 "Skips other eraser strokes, anything already done, and anything drawn *after* the eraser — drawing order is what makes the picture correct, so an eraser only ever cuts what was below it.",
 "Reachability is the only remaining bar. There used to be a depth guard here, and past five crossings it silently did nothing: the gesture painted, the mark was consumed, and no ink was ever removed.",
],
"erp._eraseMayTouch": [
 "A cheap rejection test: could this eraser possibly touch this object?",
 "Projects the eraser's **bounding box**, not its geometry, into the target's frame — a box maps to a box exactly, and costs a constant amount where projecting the outline rebuilds one arc per piece.",
 "The box is cached against the eraser's edit counter so it is computed once per gesture rather than once per candidate.",
 "Only has to be cheap and never wrongly negative; the boolean itself is the arbiter and its no-op guard absorbs false positives. The earlier version put a whole perimeter inside a loop that runs once per object per scan and cost 128 ms per slice on a crowded screen.",
],
"erp._eraseOp": [
 "Finds or creates the undo entry that a gesture's background cuts append to.",
 "Always called **before** the document is touched: a cut that cannot record itself must not happen, because unrecorded cuts were how duplicated, stacked geometry formed.",
 "After a reload the map is empty, so resumed baking registers a fresh entry — which also makes a resumed erase undoable again.",
],
"erp._bakeOne": [
 "Subtracts one eraser gesture from one object. The single most consequential function in the engine.",
 "**Makes both operands resolved outlines** — forcing a resolve or converting a legacy polygon fill if necessary.",
 "**Decides where the cut happens.** If the object is homed at a coarser level *and* there is a straight ancestor chain to descend, the work is handed to the descent. Otherwise the cut is made here, in place. The 'straight chain' test matters: the box tree branches, so 'finer than' and 'underneath' are different questions, and between branches there is no chain to cede along.",
 "**Works local to the subject.** Both operands are shifted so the object being cut sits near the origin — an eraser three levels above its target arrives 27 billion times its own size, and centring on *that* leaves the target's own features below the rounding.",
 "**Refuses grazing touches.** If almost no ink was removed, nothing is changed, so a tangent brush past a stroke does not churn it. The threshold is measured against the subject as well as the eraser, because 'a negligible fraction of the eraser' is nonsense once the eraser is magnified.",
 "**Culls dust**, replaces the object with the surviving regions, and — if a cut inside a multi-level family left several pieces — asks whether the object came apart.",
],
"erp._cull": [
 "Drops cut fragments thinner than one percent of the pen that drew them, and counts how many it dropped.",
 "These are the specks a cut leaves where it runs nearly tangent to an edge. Culled here rather than inside the boolean: the arithmetic is right, it is the decision to store the result as ink that is wrong.",
 "The tally exists so a test can assert the cull is doing work rather than that the case never arose.",
],
"erp._noteSeal": [
 "Counts the booleans that had to be closed with a fabricated chord.",
 "The boolean guarantees closed loops by sealing a chain the walk could not finish. That is a real if small geometric compromise, so it is counted rather than hidden — a rise here is the stitch getting worse.",
],
"erp._inkOutline": [
 "An object's painted area as polygon rings, flattened to a tolerance.",
 "Only the consumers that still speak polygons come through here — in practice the connectivity walk and nothing else. A resolved shape is flattened; a raw stroke is outlined first.",
],
"erp._inkShapeInRect": [
 "The ink of one object inside one rectangle, expressed in that rectangle's frame.",
 "One bounded frame hop, never a composed long jump, so the piece that moves into the tile and the hole left behind in the parent are cut from the very same edge.",
 "Computed local to the rectangle and translated back: at depth the rectangle's own coordinates run to 10¹³ while the rectangle is a few units wide, and every tolerance inside the clip is scaled off the numbers it is handed.",
 "**This is where the erase path diverges from the design.** It projects and clips, but never chops or freezes — so the ink arrives as unfrozen arcs, and the cut is made against curves the render chain has already replaced with straight lines.",
],
"erp._familyMembers": [
 "Every object sharing one family key, across all levels.",
 "A family is the pieces of one logical object that ended up at different levels because an erase ceded tiles downward.",
],
"erp._familyComponents": [
 "Decides whether a family is still one object, by building a graph and finding its connected components.",
 "Every member is a node. The only place two members can meet is the boundary of a ceded tile — the parent stops exactly at the rectangle and the child fills exactly the rectangle — so that boundary is where the question is asked.",
 "For each member holding a doorway, the rectangle is mapped into each one-level-coarser member's frame and both inks are asked where they touch it. Contact is compared in a perimeter parameter running 0 to 4, so the parent's units and the child's much larger ones give the same numbers and no transform is composed across the crossing.",
 "The partner is found **geometrically**, not by ancestry. Requiring a literal parent box made connectivity depend on bookkeeping: re-homing can settle two members of one object on different branches while sitting in the same place, and the object was reported as three without changing at all.",
],
"erp._resplitFamily": [
 "Re-labels a family into its connected components, and reports whether it came apart.",
 "Pure identity work — no geometry is touched, because ceding already left the parent in pieces. Severance used to need a second cut through the parent, which declined on any cut that was not dead straight, which is what a real scribbled erase always looks like.",
 "The first component keeps the original key so a selection already pointing at it stays valid; the rest get fresh keys. The key changes are recorded on the gesture's undo entry so one undo unwinds geometry and identity together.",
],
"erp._bakeRehome": [
 "Times the descent and delegates to `_bakeRehomeInner`.",
],
"erp._bakeRehomeInner": [
 "Cuts a hole in an object from a level below its own, by descending one crossing at a time.",
 "**Why the chain.** Ceding straight from the object's level to the erase level dies: the ceded rectangle is 1.9e-8 units wide at three crossings, 9.1e-12 at four, and exactly zero at five — a zero-width window is recorded and no hole ever appears. Descending, each step cedes a tile that is a fixed fraction of its parent, at every depth, forever.",
 "**Each step** maps the eraser's footprint into this frame, works out which of the object's own tiles it reaches, extracts the parent's ink inside that block, cuts the block out of the parent, and hands the ink to a new object one level down.",
 "**The block is a block, not a tile.** A gesture landing on a tile boundary spans two, and ceding only the first halves the mark exactly — measured at 19.5 px removed against a 20 px eraser, looking like a perfectly ordinary hole of the wrong size.",
 "**The block must also cover the box the next step descends into**, or the chain arrives holding half a box's ink and the rest of the erase has nothing to cut. At five crossings that showed up as a hole 18 px short against an 18 px eraser, with the chain looking perfectly healthy.",
 "Only the last step cuts. Intermediate links exist purely so the level below has something to cut into.",
],
"erp._rehomeBail": [
 "Records why a descent refused, against the gesture that made it.",
 "A refusal is otherwise invisible: the object is already in the eraser's done set, so the erase never returns to it, and if nothing else was under the gesture the mark is consumed having done nothing. That is exactly what 'I erase and then it just disappears' looks like from the outside.",
],
"erp._noteSpent": [
 "When a mark is about to be consumed having cut nothing, records what it considered.",
 "The done set is the list of everything the gesture looked at and dismissed, so writing it down turns 'the eraser did nothing' from a mystery into a list of objects with a reason beside each.",
],
"erp._forceBake": [
 "Resolves one stroke's perimeter immediately, cancelling any queued job for it.",
 "Used where an erase has reached an object that has not resolved yet — the boolean needs both operands as outlines and cannot wait for the queue.",
],
"erp._flushErasesFor": [
 "Applies every pending eraser mark that overlaps one object, right now.",
 "Called before a selection is dragged. Ink dragged out from under a mark that has not been applied yet takes its un-erased shape with it, and the mark stays behind to cut whatever arrives there instead.",
],
"erp._settleSelectionErases": [
 "The same barrier, over everything that is about to move.",
 "The single-object flush was not enough: with several objects selected, or one object whose family has a re-homed piece at another level, marks over the other members survived the drag. It also left the white mark itself on screen, hanging over the object being dragged.",
],
"erp.flushErases": [
 "Runs the background erase worker to completion. For tests, and for anywhere the document must be settled before it is inspected.",
],
"eng._render": [
 "A full render: rebuild the display list, hand it to the renderer, update, and emit status.",
 "Times itself, and pokes the frame meter — the worst stall measured so far is a cold one, opening a drawing at a deep camera, and a meter that only woke for zoom and pan would sleep straight through it.",
],
"eng._buildList": [
 "Assembles everything to draw at the active frame.",
 "Takes the cached tile pieces covering the view, adds the active frame's own objects (which are drawn live, not cached), and tags each piece with its family key so the renderer can group a multi-level object into one path.",
 "Sorts by drawing order — which is creation order, with cut pieces inheriting their source's place so a stroke stays at its original depth after being split.",
],
"eng._visibleChanged": [
 "Has the set of visible tiles changed since the last full render?",
 "This is the cheap question that decides whether a camera move needs a rebuild or just a new transform.",
],
"eng.zoomFactorAt": [
 "Zoom about a point. Wheel and pinch both arrive here.",
 "Applies the zoom to the camera, which may cross a level or step sideways into a neighbouring box.",
 "Then asks five questions: did we cross, did the visible tiles change, does a wide stroke need to flip to its outline form, has a piece crossed the fade threshold and so changed which group it belongs in, and has the view drifted far enough to need re-anchoring. **Any yes means a full render; otherwise one transform is written and nothing is rebuilt.**",
 "Finally warms the next level's tiles during idle time, and prefits outlines for strokes approaching the gate.",
],
"eng.panBy": [
 "Pan by a pixel delta. Same structure as zoom but with fewer questions to ask — only the visible tile set and re-anchoring can change.",
],
"eng._maybePrebake": [
 "While the camera is near a crossing, warms the child tiles under the view during idle time so the crossing lands on a hot cache.",
 "Safe to do early: a box's edge to its parent is fixed the first time it is crossed into and never changes, so a frame captured on the way up is as valid as the one at the crossing moment.",
],
"eng._queueIdleFits": [
 "Schedules outline fitting for wide strokes during idle time, so a stroke that is approaching the display gate has its outline ready before it needs it.",
],
"sel._hitTest": [
 "What is under this point? Returns the topmost object, or nothing.",
 "Walks the display list from the top down, testing resolved shapes by inside-ness and raw strokes by distance to their centreline with the pen width as slack.",
],
"sel._shapeHit": [
 "Is this point inside a resolved outline, allowing a little slack?",
],
"sel.select": [
 "Selects whatever is under a point, replacing the current selection.",
],
"sel._setSelection": [
 "Installs a set of ids as the selection and pulls in the rest of each object's family, so a multi-level object selects as one thing.",
 "Also records the primary id and edit key, which the selection indicator and the drag both read.",
],
"sel._toggleSelected": [
 "Adds or removes one object from the selection — the ctrl-click behaviour.",
],
"sel._selectableRects": [
 "The candidate objects for a lasso, with their rectangles in the active frame.",
],
"sel._rectInActive": [
 "One object's bounding rectangle, mapped into the active frame's coordinates.",
 "Returns nothing when the two frames have no path between them, which silently drops the object from consideration.",
],
"sel._lassoFind": [
 "Finds every object fully enclosed by a lasso, by walking the box tree rather than testing every object.",
 "Each box gets one of three answers: **out of reach** — skip it and its whole subtree; **enclosed** — take everything under it with no per-object test at all; **straddling** — ask its own spatial index and recurse.",
 "The walk goes **outward from the active box**, not down from the root, because from the root the scale factor would be enormous before the first useful comparison.",
 "What makes the pruning sound is the rule that an object never reaches past its box's immediate neighbours, so a subtree's content is inside its own box grown by one.",
 "Prunes by **location, never by depth**: something five levels down and a hundredth of a pixel across is still caught from the top.",
],
"sel._applyLasso": [
 "Turns a finished loop into a selection change.",
 "Plain: replace the selection. Ctrl with the loop overlapping the current selection: add. Ctrl with the loop drawn entirely inside the selection: remove.",
],
"sel._selectionMembers": [
 "Every object the selection covers — each selected id plus the rest of its family, de-duplicated.",
],
"sel._dragSelection": [
 "One step of a drag, and the reason a drag at depth is now safe.",
 "**Recomputed from where the drag started**, never from the previous event, so a slow drag and a fast one apply the same arithmetic to the same numbers and land in the same place.",
 "**A member coarser than or level with the camera** translates directly: the displacement measured in its units shrinks with separation, so plain translation cannot explode.",
 "**A member deeper than the camera** has the displacement expanded into whole-box steps. Everything a box or larger becomes a change of *address* — the object is re-homed into the box that many steps along, its geometry untouched — and only the sub-box remainder is added to coordinates.",
 "Every member expands the **same** displacement, so members sharing an ancestor take identical steps and their relative positions cannot drift.",
],
"sel._normalizeHome": [
 "Puts an object back inside its own box after a move.",
 "A drag at or above an object's own level puts the whole displacement into its coordinates, and enough of them walk it out of its box. Re-homing to the box that now contains it costs nothing in accuracy — neighbouring origins differ by exactly one box width, a power of two, so subtracting whole boxes is exact.",
],
"sel.deleteSelection": [
 "Removes every selected object and its family, as one undo entry.",
],
"sco._noteInkAdded": [
 "Gives a newly drawn stroke a provisional scene assignment immediately, so it belongs somewhere before the next full scene pass runs.",
],
"eng._emit": [
 "Publishes the status the interface reads: level, in-level zoom, absolute zoom, whether a crossing is near, and the object count.",
],
}
