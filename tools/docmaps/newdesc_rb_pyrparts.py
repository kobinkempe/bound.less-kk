# -*- coding: utf-8 -*-
"""Per-function entries for the pyramid's plate cache (raster/PyramidStore.js), its level
arithmetic (raster/level.js), the job queue (raster/jobQueue.js) and the prefetch
(raster/prefetch.js). Written 2026-10-05 for the rebuilt tree."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


ROLE = {
    "src/engine/raster/PyramidStore.js":
        "The pyramid's plate cache (DESIGN.md §9): level, rest and plane records under `level.js`'s keys, each with "
        "the G its job was packed at. A result lands iff its G is newer (rule 1); a plate is exact iff its G is at "
        "least its cell's `dirtySince` (rule 2). LRU by bytes with the drawn set, the plane and the protected classes "
        "evicted last; the in-flight map; the hidden-tab release.",
    "src/engine/raster/level.js":
        "The pyramid's level arithmetic: a level ℓ is the integer zoom Z(ℓ) = 2^(ℓS), the view draws from the level "
        "whose stretch lies in its band, and a plate of one frame's level is a plate of another frame's by integer "
        "arithmetic on the cell digits, never a float affine. The keys of level, rest and plane plates.",
    "src/engine/raster/jobQueue.js":
        "The one queue in front of the worker pool (DESIGN.md §9): typed jobs by priority — rest and patches, the "
        "view, the plane, cuts, the prefetch, thumbnails — cut into strips dealt round-robin from the attention point; "
        "a strip whose purpose moved on or whose cells are exact is dropped; one worker kept for cuts; a pack budget "
        "per frame or per task.",
    "src/engine/raster/prefetch.js":
        "What the pyramid fetches before the view needs it, as priority-4 jobs: the near coarser levels from the live "
        "table, the far levels and a crossing's target through budgeted snapshots, the ring at rest — no more than the "
        "cache can hold beside what is pinned. Nothing while a report sends.",
}


# ---- src/engine/raster/PyramidStore.js ----
add("pys.isPhoneBudget", "isPhoneBudget(env)",
    "The phone budget — a budget, not a capability test: 4 GB of device memory or less, or a screen under 1,200 px on its long side.", ["-"], "§9")
add("pys.viewUnit", "viewUnit(wDev, hDev)", "One view in plates (= MiB): the view's plate count at the band's floor for this screen.", ["-"], "§9")
add("pys.planeCap", "planeCap(phone)",
    "The drag plane's pin cap on this device: `MOVE_PLANE_PLATES` 40, 24 on a phone.", ["-"], "§9")
add("pys.ownBound", "ownBound(wDev, hDev)",
    "The most own-grid records a plan draws, one per view cell: the level view at the band's floor or the rest set at σ = 1 (77 on a 2560×1440@2 screen, where one view is 54).", ["-"], "§9")
add("pys.pinnedBound", "pinnedBound(wDev, hDev, phone)",
    "The pinned bound in plates (PLAN §5.6 M2): the own-grid records, `COMPOSE_IMAGES` stand-ins and the plane's cap — the most a compose can pin.", ["-"], "§9")
add("pys.budgetBytes", "budgetBytes(cfg, wDev, hDev, phone)",
    "The cache budget: `plateViews` views (3 on a desktop, 2 on a phone), never under the pinned bound nor over a ceiling that is itself never under it.",
    ["99 MiB on a 390×844@3 phone against the lever's 96: the floor wins (DESIGN.md §9)."],
    "§9")
add("pys.levelCell", "levelCell · restCell · planeCell",
    "A plate's cell descriptor — a level plate (frame, ℓ, S), a rest plate (frame, exact Z), a plane plate (layer tag, the plane's Z) — the one shape `beginJob`, `put` and the plan share.", ["-"], "§9")
add("pys.cellBox", "cellBox(c, pad)",
    "A cell's box in its frame's units, grown by a device pixel of its own grid: what a footprint is tested against (touching counts).", ["-"], "§9")
add("pys.PyramidStore", "PyramidStore",
    "The pyramid's plate cache: records by key with the G their job was packed at, the in-flight map, LRU eviction by rank, the hidden-tab release.",
    ["Rule 1 (`put`): a record is kept iff none is stored or its G is newer. Rule 2 (`exact`): r.G ≥ the cell's `dirtySince`, read at every call, since a commit can land between two composes. Every key stored or in flight is tracked by the Stage until neither holds it. Only `_remove` closes a bitmap, and marks the record dead first, so a compose holding it draws nothing (DESIGN.md §9, A3 §1.1, §4.5)."],
    "§9")
add("pys.PyramidStore.constructor", "PyramidStore.constructor(opts)",
    "The cache with its freshness source (the Stage; none: every record exact), its byte budget, and the `visibilitychange` listener: a phone releases at once when hidden, a desktop after five minutes.", ["-"], "§9")
add("pys.hidden", "hidden (getter)", "The tab is hidden: a commit's patch step waits for the return (PLAN §5.22 item 3).", ["-"], "§9")
add("pys.get", "get(key)", "The live record under a key, or undefined.", ["-"], "§9")
add("pys.exact", "exact(r)",
    "Rule 2: is the record's G at least its cell's `dirtySince`, read now (and kept on the record as `dirtyG`)?", ["-"], "§9")
add("pys.inFlightExact", "inFlightExact(key)",
    "A job for the key is in flight, not refused, and packed at or after its dirt: posting another adds nothing.", ["-"], "§9")
add("pys.wants", "wants(key)", "Does the cell still need a job: nothing exact stored and nothing exact in flight?", ["-"], "§9")
add("pys.framesWithLevels", "framesWithLevels · records", "The frames that hold level records; every live record.", ["-"], "§9")
add("pys.put", "put(rec)",
    "Rule 1: an arriving plate is kept iff nothing is stored or its G is newer; an older, equal or refused one is closed. A newer one still behind the dirt is kept and counts as stale (F106).",
    ["The record is tracked by the Stage from its own G, so a commit that landed while it was in flight leaves it stale at once."],
    "§9")
add("pys.patch", "patch(key, {bitmap, pixels, G, covers})",
    "A patch landed in a record: its new pixels, and its G raised when the patch's clip holds every dirty rectangle since the record's G; the old bitmap closed.", ["-"], "§9")
add("pys.holdBytes", "holdBytes(n)", "Results a group holds aside count against the cap (A3 §3.6): n bytes more or fewer.", ["-"], "§9")
add("pys.discard", "discard(rec)", "Closes a result that will never be put: a dropped group's, a discarded rest cell.", ["-"], "§9")
add("pys.beginJob", "beginJob(jobId, cells, G)",
    "A job packed at G for these cells: each is in flight and tracked by the Stage from now, so a commit while it travels stales its result.", ["-"], "§9")
add("pys.endJob", "endJob(jobId)", "The job came back, failed or was abandoned: its keys leave the in-flight map.", ["-"], "§9")
add("pys.setDrawn", "setDrawn · setPlanePins · pinnedCount · isPinned",
    "Pin the records the current plan draws (until the next plan), and the plane's plates (while the plane lives); count the pinned once; is a key pinned.", ["-"], "§9")
add("pys.setView", "setView(v) · view (getter)",
    "What the eviction order reads (A3 §4.5): the view's frame, level, S and ring, the rest set, the path of frames with their level shifts, the frame just left and the prefetch's far keys.", ["-"], "§9")
add("pys.setBudget", "setBudget(bytes)", "A new byte cap and one eviction pass (pins respected).", ["-"], "§9")
add("pys.dropWhere", "dropWhere(pred, spare)",
    "A hard drop: every record a predicate names is removed, and every job in flight with such a cell is refused, so it lands nothing.",
    ["Refused by job, not through the in-flight map: a job a newer one for the same key overtook is no longer in it, and its result must still land nothing."],
    "§9")
add("pys.dropFrames", "dropFrames(pred)",
    "Every record of the frames a predicate names — their id now means another place (a refile, frame GC) — except the plane's.", ["-"], "§9")
add("pys.dropAll", "dropAll()", "Everything: another document.", ["-"], "§9")
add("pys.release", "release(reason)",
    "The hidden-tab release: every record but the view frame's ℓv − 2 plates, so the return is never paper; the picture is told, so it drops its surface too.",
    ["A desktop tab releases after five minutes hidden, a phone at once (DESIGN.md §9)."],
    "§9")
add("pys.report", "report()",
    "For the report: plates and bytes, the cap, the pinned and stale counts, in flight, the tracked keys and every counter.", ["-"], "§14")
add("pys.destroy", "destroy()", "Drops everything, removes the visibility listener and clears the in-flight state.", ["-"], "§9")
add("pys.rankOf", "rankOf(r)",
    "An unpinned record's eviction rank (A3 §4.5), lowest evicted first: stale, off the view's path, finer than the view, other levels, the far prefetch, the frame just left, the near coarser levels, the rest set, the view's ring.", ["-"], "§9")
add("pys._evict", "_evict()",
    "Evicts until the cap holds — by rank, then among other levels the farthest from the view's, then least recently used; never a pinned record (a cap the pins exceed is counted).", ["-"], "§9")
add("pys._remove", "_remove(key, replacing)",
    "Takes a record out and closes its bitmap — the only path that closes a stored one; it is marked dead first, so a compose holding it draws nothing.", ["-"], "§9")
add("pys._untrackIfIdle", "_untrackIfIdle(key)", "A key neither stored nor in flight leaves the Stage's tracked set.", ["-"], "§9")
add("pys._endKey", "_endKey(key, jobId)", "A result arrived: its key is no longer in flight, for the job that holds it.", ["-"], "§9")
add("pys.closeOf", "closeOf(holder, s)", "Closes a record's bitmap, wherever it is dropped from.", ["-"], "§9")


# ---- src/engine/raster/level.js ----
add("lvl.zOf", "zOf(l, S)", "Device pixels per frame unit at level ℓ: 2^(ℓS), exact.", ["-"], "§9")
add("lvl.stepMapsFrames", "stepMapsFrames(S)",
    "Does step S keep the map between frames integral — does it divide the crossing's 12 octaves?", ["-"], "§9")
add("lvl.ownFloor", "ownFloor(S)",
    "The coarsest level of a frame's own pyramid (ℓS ≥ −8); coarser is its parent's level ℓ + 12/S.", ["-"], "§9")
add("lvl.levelFor", "levelFor(Z, S, prev, sigmaMin)",
    "The level a view at zoom Z draws from: ℓ = floor((log2 Z − log2 σmin)/S), so its stretch lies in [σmin, σmin·2^S); the previous level is kept while σ stays inside that band grown by an eighth of an octave each way.",
    ["The hysteresis is what stops the level flapping at a band edge (DESIGN.md §9)."],
    "§9")
add("lvl.stretchBand", "stretchBand(S, sigmaMin)", "The stretch band a view draws its level at, for the Dev panel.", ["-"], "§9")
add("lvl.viewPlates", "viewPlates(sigma, wDev, hDev)",
    "The most plates a view of the screen can touch at stretch σ: a span of L plates at any pan phase touches ceil(L) + 1.", ["-"], "§9")
add("lvl.sigmaMinFor", "sigmaMinFor(wDev, hDev)",
    "The band's floor σmin for a screen: 2^−½ while a view needs at most 48 plates at the hysteresis edge, else 1, else 2^½.", ["-"], "§9")
add("lvl.levelKey", "levelKey · restKey · planeKey",
    "The plate keys: a level plate (frame, ℓ, S, cell — S in it, so a lever change never serves another step's plate), a rest plate (frame, exact Z, cell), a plane plate (frame, the plane's Z, layer tag, cell). No dpr and no quantum in a key.", ["-"], "§9")
add("lvl.mapCell", "mapCell(lm, S, A, l, i, j, B)",
    "Frame A's plate at level ℓ as frame B's plate, the same picture to the bit, by integer arithmetic on the cell digits along the lattice path between them.",
    ["Up a crossing from a child at cell (ci, cj) of its parent it is the parent's level ℓ + 12/S, plate (i + ci·2^(8+ℓS), j + cj·2^(8+ℓS)); down into a child the inverse; a lateral neighbour goes through the common parent (`LevelMap.framePath`, the lattice's current addresses). Null when S does not divide 12, there is no path, or a level is coarser than the frames' own. Indices past 2^53 are BigInts — never a float affine (DESIGN.md §9)."],
    "§9")
add("lvl.coarser", "coarser(lm, S, F, l, i, j, k)",
    "The plate k levels coarser that contains frame F's plate at ℓ: floor division of the indices, stepping into the parent frame (`mapCell`) below F's own floor; null at the lattice's root.", ["-"], "§9")
add("lvl.floorDiv", "floorDiv(v, e)", "⌊v / 2^e⌋ for an integer, a Number or a BigInt.", ["-"], "§9")


# ---- src/engine/raster/jobQueue.js ----
add("jbq.JobQueue", "JobQueue",
    "The one queue in front of the worker pool: typed jobs by priority — rest and patches 0, the view 1, the plane 2, cuts 3, the prefetch 4, thumbnails 5 — cut into strips dealt round-robin from the attention point, and dispatched to free slots.",
    ["At dispatch a strip whose purpose's generation moved on, or whose cells are exact or exact in flight, is dropped; a view strip is aimed where the camera will be when it lands. One worker is kept for cuts while any is pending. It packs at most 4 ms a frame while the camera moves and 4 ms a task while it is still, so input runs between two strips (DESIGN.md §9, A3 §4.1, §4.4)."],
    "§9")
add("jbq.JobQueue.constructor", "JobQueue.constructor({pool, clock, store, gens, onDrop, defer})",
    "A queue over a pool (`size`, `free`, `submit`), with the store's `wants`, the purpose generations and the drop callback.", ["-"], "§9")
add("jbq.push", "push(jobs)", "Typed jobs in: each must carry a priority 0–5, and is cut into strips in arrival order.", ["-"], "§9")
add("jbq.strips", "strips(job)",
    "A job's strips: its cells sorted by distance from the attention point and dealt round-robin into two strips a worker, clips travelling with their cells; a cut, or a job with its own pool entry, is one strip, the object pushed.",
    ["Raising the strip count is not the lever for imbalance: one plate a strip read 1.35–1.62 against 1.44–1.54, since one plate of that screen was 15–20× the median and no strip rule splits a plate (its comment)."],
    "§9")
add("jbq.frame", "frame()", "An animation frame begins: its pack budget is fresh.", ["-"], "§9")
add("jbq.setMotion", "setMotion(m)",
    "The camera's motion for the velocity rule: whether it moves, the view at a time, the pan and zoom velocity, the attention point.", ["-"], "§9")
add("jbq.pump", "pump()",
    "Dispatches while there are free slots and strips that may run now, within the pack budget; past it the rest wait for the next frame, or at rest for a later task.", ["-"], "§9")
add("jbq.done", "done(id, ms)",
    "A strip has landed or failed: its slot is free, and a plate job's time feeds the arrival estimate the velocity rule uses.", ["-"], "§9")
add("jbq._nextTask", "_nextTask()", "At rest the pack budget is a task's: a later task starts it again and pumps what waits.", ["-"], "§9")
add("jbq.remove", "remove · clear",
    "Take one queued strip out before dispatch (an aborted snapshot); forget every queued strip (a teardown — what is in flight still answers `done`).", ["-"], "§9")
add("jbq.requeue", "requeue(id)", "A failed strip back at the head of its priority, its priority kept (H7).", ["-"], "§9")
add("jbq.pending", "pending(kind)", "Strips of a kind queued or in flight: the bake's lookahead reads the cuts'.", ["-"], "§9")
add("jbq._best", "_best()",
    "The strip to run next: the lowest priority, a barrier's then the oldest within it — never past the slot a pending cut reserves, nor past the low priorities' cap.", ["-"], "§9")
add("jbq._admit", "_admit(st)",
    "At dispatch: a strip whose purpose moved on is dropped, a view strip is aimed at the camera's arrival, and cells already exact or exact in flight are skipped; a strip left with nothing is dropped.", ["-"], "§9")
add("jbq._aim", "_aim(st)",
    "The velocity rule: the camera predicted at the strip's arrival from its pan and zoom velocity about the attention point; cells off the predicted screen skipped, and a level the camera will have left re-aimed at the one it is heading to.",
    ["At most `AIM_LEVELS` (2) levels from the view's and never under the frame's own floor (F134: unbounded, a fast zoom-out in jsdom re-aimed strips 15–20 octaves out and one plate took 5–102 s inline)."],
    "§9")
add("jbq._drop", "_drop(st, why)", "Counts a dropped strip by reason and tells the renderer (`onDrop`), which unasks its cells.", ["-"], "§9")
add("jbq.report", "report()", "For the report: strips queued and in flight by priority, the mean job time, the frame's pack time and the counters.", ["-"], "§14")


# ---- src/engine/raster/prefetch.js ----
add("pft.prefetchPlan", "prefetchPlan(view, stage, store, cfg)",
    "The prefetch's jobs at priority 4, in order: the near coarser levels ℓv − 1 and ℓv − 2 over the screen and a one-cell margin; the far levels; the crossing target near a crossing; the ring at ℓv, only at rest — no more plates than the cache has room for, and nothing while a report sends.",
    ["The near levels pack from the live table, the cells it covers only. The far levels are the view zoomed out 4^k about its centre (k = 1…11, 22 octaves: Kobin's bacteria-to-ladybird gesture is 22.5), three octaves under that view's level over 2.5 of its screens, in the parent and grandparent frames once the level is coarser than the frame's own; they and the crossing target are read off camera through `stage.snapshot` within 8 ms, and a job carries its table. A read past its budget is skipped this time; its tiles stay cached for the next (DESIGN.md §9, A3 §4.3)."],
    "§9")
add("pft.farKeysOf", "farKeysOf(jobs)", "The far levels' keys: what the store protects as its FAR class (`PicturePyramid.setFar`).", ["-"], "§9")
add("pft.roomOf", "roomOf(store)", "The plates the cache can take beside what is pinned and what is already protected.", ["-"], "§9")
