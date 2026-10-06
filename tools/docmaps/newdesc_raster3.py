# -*- coding: utf-8 -*-
"""Per-function entries for the raster renderer's core, wire and packer:
raster/rasterCore.js (the coverage rasteriser), raster/rasterJob.js (the job and
result wire format and the buffer pool) and raster/rasterPack.js (the render list
packed into jobs)."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/raster/rasterCore.js ----
add("rco.setDebugChecks", "setDebugChecks(on)",
    "Turns the core's debug checks on or off: an edge outside its family's declared rows throws, and so does an arc sweep past a whole turn.",
    ["Off in the shipped path. With it on, `addEdge` throws when an edge reaches rows outside the ones `beginFamily` declared (the bounded clear would miss them), and `emitArc` throws on an over-turn sweep instead of drawing its chord."],
    "§15")
add("rco.useAccumPrecision", "useAccumPrecision(kind)",
    "Swaps the accumulation buffer between Float32 and Float64, for the bench and the precision test only.",
    ["Reallocates only when the kind changes. The shipped path allocates the buffer once as `ACC_F32` says (Float32: half the memory traffic, worst error recorded as 6e-5 of coverage at 1,000 edges in a row) and never calls this."],
    "")
add("rco.accumPrecision", "accumPrecision()",
    "Which precision the accumulation buffer holds now, `f32` or `f64`.", ["-"], "")
add("rco.readAcc", "readAcc(x, y)",
    "One accumulation cell, for the tests and the bench; the running sum along a row is the coverage.", ["-"], "")
add("rco.rowRange", "rowRange(y)",
    "A row's touched-column range, [first, last], which the resolve and the bounded clear walk.",
    ["The last column is never above TW − 1: a deposit clamped at the plate's right edge sets it there, and that is what paints a clamped row out to the edge."],
    "")
add("rco.depositRun", "depositRun(y, xs, xe, d)",
    "Deposits one step of an edge inside one pixel row into the accumulation buffer, font-rs's `draw_line` arithmetic in float64, and widens the row's touched range.",
    ["`xs` and `xe` are already inside [0, TW]. A step within one column splits `d` between two cells by its mean x; a longer one spreads it over the columns it spans by their trapezoid areas. The deposit is signed area, so the running sum along the row is the coverage.",
     "The touched range's top is capped at TW − 1; the buffer's two spill columns take the writes past it, and `clearFamily` clears them."],
    "§9")
add("rco.addStep", "addStep(y, xs, xe, d)",
    "Clamps one row step of an edge to the plate's columns as a clamp of x(y), then deposits it.",
    ["The step is split where x crosses 0 and TW, and each part outside becomes a vertical deposit on that bound carrying its share of `d`. Clamping the two endpoints instead is wrong: an edge from x = −3 to 0.5 across one row covers 0.964 of pixel 0, and the endpoint clamp reports 0.750."],
    "§9")
add("rco.addEdge", "addEdge(x0, y0, x1, y1)",
    "Deposits one straight edge, in plate-local device pixels, row by row; returns 1 if it deposited anything, else 0.",
    ["Orients the edge top to bottom with a direction sign, clips it to the plate's rows and hands each row it crosses to `addStep`. A horizontal edge or one off the plate in y returns 0.",
     "A non-finite coordinate is dropped, counted in `coreStats.nonFinite`, and forces a whole-buffer clear at the end of the family: NaN defeats the comparisons that keep the touched ranges, so the bounded clear could not find its deposits."],
    "§9")
add("rco.beginFamily", "beginFamily(y0, y1)",
    "Starts a family over rows [y0, y1): resets those rows' touched-column ranges and records the rows for the debug check.",
    ["-"], "§9")
add("rco.resolveFamily", "resolveFamily(out, r, g, b, alpha, y0, y1, maskBits)",
    "Turns a family's accumulation into coverage and blends its colour onto the plate, inside the core's clip; returns the pixels it painted.",
    ["Per touched row, a running sum over the touched columns gives coverage min(|sum|, 1), carried across the columns before the clip and written only inside it. Times the family's alpha, a pixel that reaches 1 is written outright and one below it is blended source-over on the 8-bit bytes (the alpha byte too on a transparent plate). With `maskBits`, each pixel's coverage is multiplied by what the family's pending marks' masks leave there (`keepAt`): the erase rule, a pending mark drawn as nothing (DESIGN.md §7). A row whose sum is still past `TAIL_EPS` after its range is painted on to the clip's right edge.",
     "`TAIL_EPS` (1/2048) sits above the Float32 residue of a closed loop; at 1e-9 that residue painted the rest of every row of a thin shape and added 15 % to its coverage."],
    "§9")
add("rco.clearFamily", "clearFamily(y0, y1)",
    "Zeroes exactly what the family touched, each row's touched columns plus the two spill columns, or the whole buffer after a non-finite coordinate.",
    ["The bounded clear is what makes a family cost its ink rather than its area: a whole-buffer clear per family was 100–200 ms a plate at 800 families. A forced full clear is counted in `coreStats.fullClears`."],
    "§9")
add("rco.rowsTouched", "rowsTouched(y0, y1)",
    "Counts the family's rows that received a deposit, for the plate's `rowsTouched` count.", ["-"], "§15")
add("rco.pushUnionEdge", "pushUnionEdge(ax, ay, bx, by, yb0, yb1)",
    "Loads one edge, clipped to the row band [yb0, yb1), into the union pass's edge buffer; false when the buffer is full.",
    ["Stores the clipped top and bottom, the x at the top and dx/dy, with a direction sign. A non-finite edge is counted and dropped (and forces the full clear); a horizontal edge or one outside the band is skipped.",
     "The buffer holds 16,384 edges. Inside `walkRowChunked` the first `uSkip` edges that would be stored are counted and passed over, because an earlier buffer-full has already taken them."],
    "§9")
add("rco.sortCrossings", "sortCrossings(n)",
    "Sorts one sub-scanline's crossings by x, each carrying its direction; an insertion sort, as a scanline holds a handful.",
    ["-"], "")
add("rco.growXS", "growXS()",
    "Doubles the crossing buffer when a sub-scanline has more crossings than it holds, and counts it in `coreStats.xsGrown`.",
    ["-"], "")
add("rco.gatherCrossings", "gatherCrossings(ys, n, nAct)",
    "Appends the x and direction of every active union edge that spans sub-scanline `ys`; returns the new count.",
    ["-"], "§9")
add("rco.emitRuns", "emitRuns(y, n, w)",
    "Resolves one sub-scanline's crossings into its non-zero-winding runs and deposits each into row `y` at weight `w`.",
    ["Sorts the crossings, walks the winding count, and for each interval where it is non-zero deposits +w at its start and −w at its end, clamped to [0, TW]. Two cells a run however long, because the resolve's running sum carries the value across it. Overlapping rings therefore count once: the region is winding 1."],
    "§9")
add("rco.walkUnion", "walkUnion(yb0, yb1)",
    "Walks the loaded union edges down rows [yb0, yb1) at 16 sub-scanlines a row and deposits the covered runs as a winding-1 region.",
    ["Edges are bucketed by the row they start in and join an active list when the walk reaches it; each sub-scanline, at y + (k + ½)/16, goes through `gatherCrossings` and `emitRuns` at weight 1/16 times the family's union sign, and the edges that end inside the row are dropped before the next.",
     "Sixteen sub-scanlines put an edge within 1/32 device px of its true y (`UNION_K`)."],
    "§9")
add("rco.fillPaper", "fillPaper(out, r, g, b, a, rect)",
    "Paints the plate — or only its clip rect — the paper colour before any family, or transparent black for a drag-plane plate.",
    ["The plate is filled as 32-bit words from one written pixel, row by row inside a clip. An opaque plate makes a blit a copy; a transparent one (`a` 0) is un-premultiplied by `unpremultiply` at the end of the plate."],
    "§9")
add("rco.unpremultiply", "unpremultiply(out, rect)",
    "Divides a transparent plate's colour by its alpha (inside the clip rect when given), because the resolve accumulated premultiplied colour and `ImageData` is straight alpha.",
    ["Pixels at alpha 0 or 255 are left alone. Without it every antialiased edge of a drag-plane plate darkens."],
    "§9")
add("rco.widthOf", "widthOf(code)",
    "The count of numbers in one loop record by its code: 3 for a line, 8 an arc, 9 a cut line, 16 a cut arc; an unknown code reads as an arc.",
    ["The grammar of `geometry/loop.js`, repeated here as four numbers so the worker bundle carries no Loop class; the two tables must agree."],
    "")
add("rco.arcForced", "arcForced(sweep)",
    "How many halvings bring a sweep to a quarter turn or less, capped at 3: the splits made before a piece is pruned or counted.",
    ["The sagitta is infinite past a half turn and the chord-count formula is poor beyond a quarter turn, so a piece is bisected this many times before anything is asked of it. `emitArc` refuses a sweep past a whole turn, so there it is at most 2; the cap bounds a direct caller (it is exported for the tests)."],
    "§9")
add("rco.arcDepth", "arcDepth(ax, ay, bx, by, sweep)",
    "The bisection depth D for one arc piece, so that each of its 2^D chords stays within 1/16 device px of the arc, computed without a radius.",
    ["0 when the whole piece's sagitta is already within `ARC_TOL`. Otherwise the piece is split into its forced sub-arcs with `chordMidK`, and each sub-arc's chord count n ≥ θ / (2·arccos(1 − 2·tol·sin(θ/2)/L)) is rounded up to a power of two; D is the forced splits plus the deepest of those, never below the forced ones.",
     "A function of the piece and the tolerance only, never of the plate, so neighbouring plates flatten one arc to the same chords and agree at the seam. The arccos argument is clamped to [−1, 1] and D to 24 (`MAXD`, counted in `coreStats.arcClamped`); without the clamps a tiny radius gives NaN and the descent never ends. A clamped depth can miss the tolerance: measured 0.11 device px at 1e14 px of screen radius, 1.13 at 1e15."],
    "§9")
add("rco.chordOf", "chordOf(ax, ay, bx, by, ox, oy, mode, yb0, yb1)",
    "Emits a refused arc record as its straight chord, as a deposited edge or a union edge, so its loop still closes.",
    ["Takes scale-only coordinates and subtracts the plate origin, as the flattener's own chords do. Returns the edges deposited, or −1 when the union buffer is full. The chord is also the term `itemShoelace` gives such a record, so the area and the deposit agree."],
    "§9")
add("rco.emitArc", "emitArc(ax, ay, bx, by, sweep, cx, cy, ox, oy, mode, yb0, yb1)",
    "Flattens one arc piece into chords within 1/16 device px, centre-free and pruned against the plate, and deposits them or loads them for the union pass.",
    ["The gates first: a non-finite end is dropped (counted, full clear forced); a non-finite sweep or one past a whole turn is counted and drawn as its chord through `chordOf`, the over-turn throwing under the debug checks; a whole turn is split once at the antipode, the only place the record's centre is read, and is drawn as its chord when that centre is not finite.",
     "Otherwise `arcDepth` gives D and the piece is bisected on a preallocated stack with one bulge coefficient per depth (`bulgeK`, `chordMidK`). Past the forced splits each node's chord box, grown by its sagitta, is tested against the plate: a node on no row of it is dropped; one wholly to the right is dropped on the fast path and becomes a vertical edge at TW on the union path; one wholly to the left becomes a vertical edge at column 0 carrying the node's own height; at depth D the chord is emitted.",
     "Coordinates arrive scaled but not shifted, and the plate origin is subtracted per chord, so every plate computes the same chords and only the prune differs. Adds 2^D to the plate's chord count. Returns the edges deposited, or −1 when the union buffer filled. A refused record is drawn as its chord because an open outline leaks: accumulation is signed, and the recorded case painted 34,944 units of ink out to the plate's edge for an item of 7,110."],
    "§9")
add("rco.emitItem", "emitItem(job, it, rx, ry, ox, oy, Zq)",
    "Deposits every edge of one fast-path item of a job: its loops' lines and flattened arcs, or its flat rings, in plate-local device pixels.",
    ["Walks each sub-chain between its `subs` offsets and closes it back to its start. A point maps as (x + res)·Zq − the plate origin: the residual is added before the scale and the exact integer origin subtracted after, so two neighbouring plates describe a shared point to the last bit. Loop records are read by code, lines and cut lines as edges, arcs and cut arcs through `emitArc` with the scale-only coordinates. Returns the edges deposited."],
    "§9")
add("rco.itemShoelace", "itemShoelace(job, it, rx, ry, ox, oy, Zq)",
    "Twice the signed area of one item's rings in plate-local pixels, arcs included exactly: the core's fallback for a family's union sign.",
    ["Lines add the shoelace term; an arc adds its chord's term plus `arcAreaTerm`, the radius-free segment; a whole turn adds ±2πr² from its centre, because its ends coincide and would carry no sign. A record `emitArc` refuses keeps its chord's term alone, as it is drawn.",
     "`renderPlate` sums it over a family's union items only when the job declares no sign in `attr[8]` (a hand-built job)."],
    "§9")
add("rco.loadUnionItem", "loadUnionItem(job, it, rx, ry, ox, oy, Zq, yb0, yb1)",
    "Loads one union item's edges, clipped to a row band, into the union edge buffer; false when the buffer overflowed.",
    ["The same record walk and coordinate mapping as `emitItem`, with arcs flattened in union mode, so every plate loads the same edges."],
    "§9")
add("rco.loadUnionBand", "loadUnionBand(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1)",
    "Empties the edge buffer and loads every drawn union item of one family, clipped to rows [yb0, yb1); false when they do not fit.",
    ["-"], "§9")
add("rco.loadBandCounted", "loadBandCounted(job, meta, attr, first, last, ox, oy, Zq, yb0, yb1)",
    "`loadUnionBand`, keeping the guard counters' increase from the family's first load that fits.",
    ["A family's geometry is re-read once per band, per halving and per buffer-full, and each read counts the same refused records again. The first load that fits enumerates every record, so `unionPass` sets `arcOverTurn`, `nonFinite` and `arcClamped` from that load's increase and the guards count records, not passes."],
    "§15")
add("rco.walkRowChunked", "walkRowChunked(job, meta, attr, first, last, ox, oy, Zq, y)",
    "Walks one pixel row whose union edges do not fit the buffer even alone, gathering each sub-scanline's crossings over successive buffer-fulls.",
    ["For each of the 16 sub-scanlines the family's edges for the row are loaded one buffer-full at a time (`uSkip` advancing), the crossings of every fill gathered, and `emitRuns` run once on the whole row's winding, so no ink is lost (OPEN-FLAGS F75). Depositing each buffer-full's union on its own would count their overlap twice.",
     "The price is the row's geometry read 16 times per extra buffer-full, recorded at 41–43 ns an edge a pass. The chord count keeps only the one complete pass, and the extra buffer-fulls are counted in `coreStats.unionRefills`."],
    "§9")
add("rco.unionPass", "unionPass(job, first, last, ox, oy, Zq, y0, y1)",
    "Fills a family's union items over its rows as one exact-winding region, in as few row bands as the edge buffer allows.",
    ["Tries the family's whole row range and, while its edges do not fit, halves the band (counted in `unionSplits`). A band that fits goes to `walkUnion`; a single row that still does not fit goes to `walkRowChunked`; then the next band.",
     "At the end the three record guards are set from the first complete load, so a record refused once is counted once."],
    "§9")
add("rco.renderPlate", "renderPlate(job, plateIndex, out, counts, timings, clip)",
    "Paints one plate of a packed job into an RGBA buffer — only the clip's rows and columns when `clip` is given (the patch rule's dirty rectangles, A3 §3.1): `paintPlate` with the core's clip set, and reset after.",
    ["-"], "§9")

# ---- src/engine/raster/rasterJob.js ----
add("rjb.BYTES", "BYTES(a)",
    "A typed array's byte length, 0 for a missing one.", ["-"], "")
add("rjb.BufferPool", "BufferPool",
    "A free list of ArrayBuffers by power-of-two size class, so the jobs of a zoom reuse the buffers the worker hands back instead of allocating new ones.",
    ["`take` returns a view of exactly the length asked for, over a pooled buffer of its class when one is free; `give` files a returned buffer by its byte length, up to the pool's byte cap. `rasterWorkerClient` holds one of 8 MiB and passes it through the renderer to `packJob`; the worker hands the job's arrays back in the result's `recycled`."],
    "§9")
add("rjb.BufferPool.constructor", "BufferPool.constructor(maxBytes)",
    "Starts an empty pool with its byte cap, 8 MiB by default, and its take, hit and allocation counters.", ["-"], "")
add("rjb.take", "take(ctor, len)",
    "A typed-array view of `len` elements over a pooled buffer of the right size class, or over a new buffer of that class.",
    ["Counts every take, the hits and the bytes allocated for misses; `rasterWorkerClient` reports them."],
    "")
add("rjb.give", "give(b)",
    "Returns a buffer, or a view's buffer, to the free list; a detached or empty one is ignored, and one that would pass the cap is dropped.",
    ["-"], "")
add("rjb.clear", "clear()",
    "Forgets every pooled buffer; the counters are left for the caller to reset.", ["-"], "")
add("rjb.classOf", "classOf(n)",
    "The size class a request falls in: the smallest power of two from 4 KiB up that holds `n` bytes.", ["-"], "")
add("rjb.wireJob", "wireJob(job)",
    "Validates a packed job and returns it as the message to post with its transfer list, every typed array's buffer in it.",
    ['The message carries `kind: "raster-job"`, the id and zoom scalars and the nine arrays; each buffer is listed once, so nothing is copied and the main thread keeps no live view of a buffer the worker now owns. That is why `packJob` gives every job its own copies of the plate list, epochs and paper.'],
    "§9")
add("rjb.unwireJob", "unwireJob(msg)",
    "Rebuilds the job a worker reads from its message, the arrays being the transferred bytes, and validates it.", ["-"], "§9")
add("rjb.validateJob", "validateJob(job)",
    "Throws on a job whose layout would paint a wrong picture silently: short arrays, a bad kind, spans past the data, families out of paint order, sub-chains not ascending.",
    ["Checks the item count, each array's length against it, one epoch per plate, and per item its kind, its geometry and `subs` spans, at least one sub-chain, family indices ascending, and every sub-chain offset ascending and inside the item's span. The core reads a sub-chain's end from the next entry, so a short or unordered table reads a length as an offset and the ink disappears with no error. O(items + sub-chains); no geometry is read."],
    "§9")
add("rjb.wireResult", "wireResult(res)",
    "Packs a worker's result as the message to post with its transfer list: plate bitmaps or pixels, the id sets, timings, counts, guards and the job's buffers handed back.",
    ["Nulls, an empty plate's bitmap, are skipped, and each buffer is listed once. An ImageBitmap is serialisable as well as transferable, so one left out of the list is copied, 1.05 MB a plate, instead of moved."],
    "§9")
add("rjb.unwireResult", "unwireResult(msg)",
    "The result the main thread reads from a worker's message, with defaults for the recycled list and the serialisation time.", ["-"], "§9")
add("rjb.copyPlate", "copyPlate(rgba)",
    "Copies one plate's pixels out of the worker's RGBA scratch, for the path without ImageBitmap.",
    ["It has to be a copy: the scratch is reused by the next plate, `new ImageData` aliases rather than copies, and a transferred buffer is detached. 1.05 MB a plate."],
    "§9")
add("rjb.jobBytes", "jobBytes(job)",
    "The bytes of a job's typed arrays, the size of what one post transfers; the worker client records it per job.", ["-"], "§15")
add("rjb.resultBytes", "resultBytes(res)",
    "The bytes a result carries back, a bitmap plate counted at 512 × 512 × 4 and a pixel block at its own length.", ["-"], "§15")

# ---- src/engine/raster/rasterPack.js ----
add("rpk.resetPackStats", "resetPackStats()",
    "Zeroes the packer's counters, keeping the memo's live byte and entry counts.", ["-"], "§15")
add("rpk.logOnce", "logOnce(what, detail)",
    "Warns on the console once per distinct fault a session, counting every occurrence in `packStats.logs`.", ["-"], "§15")
add("rpk.setPackBudget", "setPackBudget(bytes)",
    "Sets the pack memo's byte budget and evicts down to it.",
    ["The default is 10 MiB; only the tests change it."], "")
add("rpk.packMemoBytes", "packMemoBytes()",
    "The bytes the pack memo holds now.", ["-"], "§15")
add("rpk.clearPackCaches", "clearPackCaches()",
    "Drops every memoised entry, parsed colour and pre-pass, and the logged-once set, so the next pack starts cold.",
    ["Each entry is marked dropped, so a family still holding one refills. The tests and the bench probes call it between runs."],
    "")
add("rpk.touch", "touch(item, e)",
    "Moves an entry to the young end of the memo's least-recently-used order.", ["-"], "")
add("rpk.evict", "evict()",
    "Drops the least recently used memo entries until the memo is within its byte budget, keeping at least one.",
    ["An evicted entry is marked `dropped`, so the families holding it refill and `charge` stops counting it. The memo is a Map, not a WeakMap, because it has to be walked to be capped."],
    "")
add("rpk.charge", "charge(e, bytes)",
    "Adds bytes to a live entry and to the memo's total, then evicts; an entry already evicted is not charged.",
    ["An entry evicted mid-pack is still used by the job being packed, and charging it would add bytes nothing could subtract."],
    "")
add("rpk.geomRef", "geomRef(item)",
    "The array an item's geometry lives in, a shape's loops, a fill's polys or a stroke's points: part of a memo entry's identity.", ["-"], "")
add("rpk.build", "build(item, cfg)",
    "Builds an item's pack entry by walking its geometry once: its box, each sub-chain's box and signed area, and whether its own rings need the union pass.",
    ["Hands the item to `buildShape`, `buildFill` or `buildStroke`; a shape or fill not refused then gets `e.union` from `ringsNeedUnion` and `e.area`, the sum of its rings' signed areas, which `unionSignOf` weighs the family's sign with. No coordinate is copied here; that is `flattenGeom`, on the first plate that keeps the item. The entry records `_ver`, the geometry array and `_outline` as its identity."],
    "§9")
add("rpk.scanNums", "scanNums(nums)",
    "Whether every number of an item's own geometry is finite, copying none.", ["-"], "§9")
add("rpk.buildShape", "buildShape(item, e)",
    "Fills a shape's entry: each loop's box (arc bulges included) and signed area, its numbers checked finite, the whole box and the geometry length.",
    ["Refused (`e.bad`) when it has no loops, a loop has no box, or a number is not finite. The box must carry each arc's bulge and not only its endpoints, or the family's row range misses rows the arc reaches and the bounded clear leaves them for the next family; `loopBBox` and `loopsBBox` are exact about bulges."],
    "§9")
add("rpk.numbersOf", "numbersOf(loop)",
    "A shape loop's numbers: a `Loop`'s own Float64Array, or the loop itself when it is one; anything else, a plain piece array included, throws.",
    ["-"], "§9")
add("rpk.buildFill", "buildFill(item, e)",
    "Fills a legacy fill's entry: each ring's box and signed area, every point checked finite, the whole box and the geometry length.",
    ["Refused when it has no rings or a non-finite point."], "§9")
add("rpk.buildStroke", "buildStroke(item, e, cfg)",
    "Fills a stroke's entry: a cull box that contains any band it can ship, its points checked finite, and an empty band map; every stroke is a union item.",
    ["The box takes in the samples and, for a stroke drawn as a curve (`strokeCurved`), each sample's two spline control points (`controlsFor`), since the curve lies inside them. It is padded by half the pen plus the outline fit's tolerance in frame units, then joined with the control-point box of `_outline` once the fitter has set one: a fitted outline reaches past half the pen, and a cubic lies inside its control points. The band itself is built per zoom quantum by `bandFor`, never here.",
     "A non-finite pad or point refuses the item rather than leaving a NaN box, which would be neither culled nor drawn. `e.area` stays 0; a stroke's area is its band's."],
    "§9")
add("rpk.finishEntry", "finishEntry(e)",
    "The shared tail of the shape and fill builders: refuses a non-finite box, records its magnitude and charges the entry's bytes.", ["-"], "")
add("rpk.flattenGeom", "flattenGeom(e, item)",
    "Copies an item's own coordinates into its entry, once, on the first plate that keeps it: loop numbers or ring points, with one ascending offset per sub-chain.",
    ["`subs` counts numbers for the loop grammar and points for flat rings, the layout the core and `validateJob` read. An item the cull rejects is never copied; `packStats.coordsCopied` counts what is."],
    "§9")
add("rpk.ringsNeedUnion", "ringsNeedUnion(boxes, signs, n)",
    "Decides whether one item's own rings need the exact-winding union pass: some pair of them overlaps where accumulation would miscount.",
    ["Tests every pair with `pairNeedsUnion`; past 20,000 tests it answers yes and counts `overlapCapped`. The one implementation of the per-item rule: `build` and the oracle test both call it."],
    "§9")
add("rpk.boxesOverlap", "boxesOverlap(a, i, b, j)",
    "Whether box i of one flat box array and box j of another overlap, touching edges included.", ["-"], "")
add("rpk.boxContains", "boxContains(a, i, b, j)",
    "Whether box i of one flat box array contains box j of another, edges included.", ["-"], "")
add("rpk.pairNeedsUnion", "pairNeedsUnion(ba, i, sa, bb, j, sb)",
    "Whether two rings need the union pass: their boxes overlap and they are wound alike, or wound oppositely without one box nesting inside the other.",
    ["Accumulation is exact for a hole nested in its body (the winding stays 0 or 1), which is most of what the boolean emits; sending those to the union pass was measured at 61 % of a screen's raster time at the phone camera. A zero-area ring has no winding to read and counts as wound alike."],
    "§9")
add("rpk.entryFor", "entryFor(item, cfg)",
    "An item's memoised pack entry — keyed by its piece when it is a Stage item —, rebuilt when its `_ver`, its geometry array or its `_outline` has changed.",
    ["The Stage's items carry the Document's own natives, which an edit mutates in place with a `_ver` bump, while the idle fitter sets `_outline` with none, so all three make the identity. A move must not rebuild: the placement's offset changes without a bump (OPEN-FLAGS F55), which is why the box is memoised without `res`. A replaced entry is marked dropped and its bytes subtracted; a hit moves to the young end of the LRU order."],
    "§9")
add("rpk.itemBox", "itemBox(item, cfg)",
    "An item's box in frame units without `res`, or null when it has no drawable geometry.",
    ["Read by the tests."], "§9")
add("rpk.arcChords", "arcChords(ax, ay, bx, by, sweep, tol)",
    "Estimates how many chords one arc piece would flatten into at a tolerance, by the core's own radius-free count.",
    ["1 for a zero or non-finite sweep or a sagitta already within tolerance; otherwise 2 to the power ⌈log2 n⌉, never below the quarter-turn forced splits and capped at depth 24. It takes the whole arc's count where the core takes the worst forced sub-arc's, so it can be one bisection off: it feeds a budget decision, not the tolerance."],
    "§9")
add("rpk.itemChords", "itemChords(item, Z, cfg, e)",
    "One item's estimated chords at zoom Z, memoised on its entry per zoom quantum.",
    ["A banded stroke is priced without building its band: a raw native stroke that `strokeCurved` accepts at 8 chords a point of its flattened curve (`CURVE_CHORD_MULT`, `flattenCurve` at the zoom's tolerance), any other at 12 a centreline point (`STROKE_CHORD_MULT`, near the top of the 6.75–14.74 measured); a shape sums its pieces, a line as one and an arc through `arcChords`; a fill counts its ring points. A refused entry is 0."],
    "§9")
add("rpk.visibleChords", "visibleChords(list, win, Z, cfg, cap)",
    "The chords the items in the viewport would cost at the exact zoom, stopping at `cap + 1`.",
    ["Skips refused items and those outside the window, tests each box with `res` against the viewport in frame units, and sums `itemChords`. The early exit keeps a dense screen to a few dozen items: walking all 77,317 pieces of one measured screen was 8–15 ms against a 4 ms budget."],
    "§9")
add("rpk.bandFor", "bandFor(item, q, Zq, cfg)",
    "A stroke's fillable rings at one zoom quantum, flat and wound positive, memoised on its entry by the quantum of `Zq`.",
    ["Flattened at 1/16 device px: from `_outline` through `flattenLoops` when the stroke has been fitted, else as `strokeStripNear`'s round-joined band along the line the SVG renderer strokes, which is the curve through the samples flattened by `flattenCurve` for a stroke `strokeCurved` accepts and the points themselves for a derived piece. Every ring is wound positive, so two bands of one family never cancel. Returns the geometry, offsets, box and the rings' own area, which the family sign sums; null for a refused entry, a non-stroke or an empty band.",
     "The key comes from `Zq`, never from `q` (the parameter is unused): sync and settle requests carry the camera's exact zoom under one `q`, and a band keyed on `q` was measured 1.0 device px off at a 4× sync zoom (OPEN-FLAGS F77). A cached finer band serves a coarser request, never the reverse; at most two quanta are kept per stroke, the older dropped first."],
    "§9")
add("rpk.strokeCurved", "strokeCurved(item)",
    "Whether a stroke is drawn as the curve through its samples: a native stroke with more than two, as the SVG renderer strokes it.",
    ["`buildStroke` then takes the spline's control points into the cull box, and `bandFor` bands the flattened curve instead of the sample polyline. A derived piece's points are already flat and are banded as they stand."],
    "§9")
add("rpk.flatten", "flatten(polys)",
    "`flattenLoops`'s nested rings as the flat geometry and offset pair, every ring rewritten positive, with the box and the summed area.",
    ["A negative ring is written in reverse. A family accumulates as one nonzero path, so two of its items wound against each other would cancel to a hole that no sign can repair."],
    "§9")
add("rpk.fromWriter", "fromWriter(r)",
    "The round-joined stroke writer's output trimmed to its own length, with its box and the writer's own area, which is never negative.",
    ["-"], "§9")
add("rpk.parseColour", "parseColour(css)",
    "Parses a CSS colour string once into 8-bit sRGB [r, g, b]; an unparseable one is black and logged once.",
    ["Reads #rgb, #rgba, #rrggbb and #rrggbbaa (alpha ignored), `rgb()`/`rgba()` with channels clamped, and six names (`transparent` reads as black). Memoised per string, and the returned array is shared, so a caller must not change it. `RasterRenderer` parses the paper colour with it too."],
    "§9")
add("rpk.clamp255", "clamp255(v)",
    "Rounds a colour channel and clamps it to 0–255.", ["-"], "")
add("rpk.fadeQ", "fadeQ(item, Zq, dpr, cfg)",
    "An item's fade at the plate's quantised zoom, ramped as the SVG renderer's `_fade` ramps it.",
    ["1 without a `fadeTag`; otherwise the tag read as px, `fadeTag · (Zq / dpr) / cfg.enter`, ramped from 0 at `cfg.fadeLoPx` (0.15) to 1 at `cfg.cullPx` (0.3). A non-finite reading returns 1, since a NaN alpha would paint nothing. Taken at the quantum, so the fade cannot change inside one."],
    "§9")
add("rpk.renderIdOf", "renderIdOf(item, fade)",
    "The family key an item paints under: its edit group's id at full presence, else its own id, the SVG renderer's rule.", ["-"], "§9")
add("rpk.PlateBinner", "PlateBinner",
    "A grid of per-plate item lists over one strip's plates; filing an item's box answers whether it touches any plate of the strip.",
    ["`packJob` uses `add`'s answer as its cull; `itemsFor` reads one plate's list, which the tests do."],
    "§9")
add("rpk.PlateBinner.constructor", "PlateBinner.constructor(plates, Zq, clips)",
    "Creates an empty list for each plate of the strip, records the strip's index extent, and keeps each plate's clip rect when it is drawn only in part.",
    ["-"], "§9")
add("rpk.add", "add(index, box)",
    "Files an item index into every plate of the strip its box touches — within the plate's clip when it has one; returns whether it touched any.",
    ["-"], "§9")
add("rpk.itemsFor", "itemsFor(i, j)",
    "The item indices filed into one plate, in the order they were added.", ["-"], "")
add("rpk.alloc", "alloc(pool, ctor, len)",
    "A typed array from the buffer pool when there is one, else a fresh one.", ["-"], "")
add("rpk.idOf", "idOf(x)",
    "A small per-object number for the pre-pass key, 0 for null.",
    ["Held in a WeakMap, so the key names the cfg, the live stroke and the `only`/`omit` sets by identity."], "")
add("rpk.prepassFor", "prepassFor(list, q, Zq, dpr, cfg, only, omit, offset)",
    "The strip-independent half of a pack for one render list and zoom: its families in paint order, each item with its fade and record (entry and box).",
    ["Applies `only`/`omit`, drops fully faded items (counted), groups the rest by `renderIdOf`, sorts the families by (z, render id) as the SVG renderer stacks them, and fills each (`famAdd`). Each item's record (`recFor`) is kept per render key (zoom, dpr, cfg, offset) and reused by the next list, a subset (`only`/`omit`) reading the whole list's; a family whose records are the same takes its union rule and sign from the last list (`sameRecs`). Memoised per list as well, so the strips of one request walk the families once; before it a strip cost 25 ms before its first plate on the Magnum Opus's 15,192 pieces (jsdom)."],
    "§9")
add("rpk.famFill", "famFill(f, pre, cfg)",
    "Refills a stale family's drawable items from fresh records (`recFor`, kept in the pre-pass's map) and resets its union rule and sign.",
    ["A refused record is counted in `f.rejected`; one whose coordinates pass `COORD_BOUND` is counted but still drawn (`famAdd`). The union rule and sign are left for `packJob` to take on the first strip that draws the family."],
    "§9")
add("rpk.paintFamilies", "paintFamilies(list, q, Zq, dpr, cfg)",
    "The render list's families in the pack's own paint order at one zoom, each with its items' boxes, for a caller that splits a picture by z.",
    ["The pre-pass `packJob` uses, with stale families refilled. `MovePlane` cuts the drag plane's layers on it, so the layers split exactly where the pack paints."],
    "§9")
add("rpk.famStale", "famStale(f)",
    "Whether any item of a family has been edited, fitted, evicted from the memo or given a new `res` since `famFill`.", ["-"], "§9")
add("rpk.packJob", "packJob(list, opts)",
    "Packs one strip of plates into the typed-array job the core paints: the families that touch the strip, with their items' geometry, boxes, colour, alpha, flags and union sign, and the landed marks as masks.",
    ["From the pre-pass, each family is refilled if stale, its items culled by the binner (no coordinate copied for one that misses; a plate's clip honoured), and, for a family with anything on the strip, its union rule (`familyUnion`) and sign (`unionSignOf`) taken once over all its items. A landed pending mark is not painted as ink: it becomes a mask slot, and every item under it carries the slot's bit (`maskSlots`), so the core erases what the rule says (DESIGN.md §7). Then each kept item's geometry is found (`geomOf`), the arrays are allocated once from the pool, and each item is written: family index, spans, flags, box with `res`, `res`, pen width, alpha, and the family's union sign on a union item.",
     "A family paints with its first drawn item's colour and alpha; an item that disagrees is counted and logged. Every array is the job's own copy, because `wireJob` transfers and so detaches them. The job carries the Stage generation `G` it was packed at. `opts.offset` shifts every item's `res` to put an arbitrary rectangle on one plate (the Scenes pictures) without touching a memo. A strip nothing reaches gets an empty job."],
    "§9")
add("rpk.emptyJob", "emptyJob(opts, plates, paper, pool)",
    "A job with the strip's plates and paper and no items, for a strip nothing reaches.", ["-"], "§9")
add("rpk.alphaOf", "alphaOf(o, f, fade)",
    "An item's paint alpha: its opacity, times its fade unless its family is an edit group painted at full presence.", ["-"], "§9")
add("rpk.boxWithRes", "boxWithRes(b, res)",
    "A box shifted by an item's `res`, as a new array, or the same box when there is none.", ["-"], "")
add("rpk.familyUnion", "familyUnion(drawn)",
    "Whether a family's items together need the union pass: a ring of one item and an oppositely wound ring of another whose boxes overlap without nesting.",
    ["Gathers every shape and fill ring with `res` applied (a stroke has no rings in its entry and is a union item anyway), splits them by winding with zero-area rings in both lists, and tests only opposite-wound pairs of different items with `pairNeedsUnion`, capped at 20,000 tests (then yes, counted). Alike-wound overlaps between items stay on the fast path, because the 48-unit seam pad keeps the accumulated value at least 1 inside them. An item that needs the pass by its own rings does not make its siblings union items."],
    "§9")
add("rpk.unionSignOf", "unionSignOf(all, f, q, Zq, cfg)",
    "A family's union orientation, +1 or −1, from the summed signed area of all its union items drawn or not, plus a count of its items wound against its total.",
    ["The union pass deposits with this sign, and it must be the same on every plate or one plate paints ink where its neighbour cuts a hole. An empty or zero sum gives −1. The items wound against the family's total are counted into `f.mixed` and logged once: where two such items overlap the ink cancels to a hole no sign repairs, and the bake builds such a family today (OPEN-FLAGS F76)."],
    "§9")
add("rpk.unionAreaOf", "unionAreaOf(d, q, Zq, cfg)",
    "The signed area an item weighs its family's sign with: its entry's ring area, or for a stroke the area of the band it ships.",
    ["A stroke culled from the strip in a drawn family is banded here for that number alone; `bandFor` memoises it per quantum. A stroke that ships no band weighs 0."],
    "§9")
add("rpk.geomOf", "geomOf(d, q, Zq, cfg)",
    "The flat geometry one kept item ships, with the band's own box for a stroke; null when it ships nothing.",
    ["For a shape or a fill it copies the coordinates into the entry on first use (`flattenGeom`)."],
    "§9")


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# One or two sentences per FILE in the batch: what the file is for in the design.
ROLE = {
    "src/engine/raster/rasterCore.js":
        "The coverage rasteriser that paints one 512-device-pixel plate of a packed job: signed-area "
        "accumulation in float64 into one buffer, a family at a time over its own rows, arcs flattened "
        "here and nowhere else to 1/16 device px without a centre, and a family whose rings may overlap "
        "filled as one nonzero union by exact-winding sub-scanlines (DESIGN.md §9). Pure; it runs in the "
        "raster worker and on the main thread's sync path.",
    "src/engine/raster/rasterJob.js":
        "The wire between the main thread and a raster worker: the job's and the result's typed-array "
        "layouts with their name tables, the validation that stops a malformed job painting a wrong "
        "picture, the transfer lists, the buffer pool the job's arrays come from, and the epoch rule "
        "that marks an arrived plate stale.",
    "src/engine/raster/rasterPack.js":
        "The main thread's half of the raster path: turns the render list into jobs for strips of "
        "plates, from memoised item entries (the box without `res`, the copied geometry, stroke bands "
        "per zoom quantum), families in the SVG renderer's paint order, the cull, each family's union "
        "routing and sign, colour and quantised fade. It also gives the visible chord estimate the "
        "main-thread-or-worker switch reads (DESIGN.md §9).",
}

# ---- 2026-10-05, the rebuilt tree ----
add("rco.setOcclusion", "setOcclusion(on)",
    "Turns the occlusion cull on or off — on unless a test turns it off.", ["-"], "§9")
add("rco.depositFamily", "depositFamily(job, it, last, ox, oy, Zq, y0, y1)",
    "One family's coverage into the accumulator over rows [y0, y1): its fast-path items' edges, then the union pass for its union items, signed by the family's own orientation; returns the edges deposited.",
    ["The sign must not depend on which of the family's items a plate happens to see, or one plate paints ink where its neighbour cuts a hole (D64): it is the packer's sign over every union item of the family (D90), else the shoelace summed over them all, drawn or not. So a union item and a fast-path item of one family add where they meet instead of cancelling."],
    "§9")
add("rco.coverCandidate", "coverCandidate(job, it, last, ox, oy, Zq)",
    "Whether a family could hide the whole clip: opaque, not a mark, under no live mark, its drawn boxes spanning the clip — a candidate for the occlusion cull.",
    ["-"], "§9")
add("rco.fillsPlate", "fillsPlate()",
    "Whether the coverage in the accumulator fills every pixel of the clip to COVER_MIN — the test that makes a candidate family the plate's occluder.",
    ["-"], "§9")
add("rco.keepAt", "keepAt(bits, i)",
    "What several pending marks' masks leave of pixel `i`: Π(1 − mask) over the slots in `bits`.",
    ["The core multiplies a masked family's coverage by it (DESIGN.md §7: the raster renderer draws a pending mark as nothing)."], "§7")
add("rco.resolveMask", "resolveMask(k, y0, y1)",
    "A pending mark's family resolved into mask slot `k` instead of onto the plate: its coverage as bytes, the max over its items and over the marks sharing the slot (A2 §4.4).",
    ["The slot's plane is a whole plate, cleared on first use in a plate and written and read inside the clip only. Marks share up to 16 slots exactly (DESIGN.md §7)."],
    "§7")
add("rco.mergeCrossings", "mergeCrossings(n)",
    "A bottom-up merge sort of a sub-scanline's crossing pairs by x, for more than 32 crossings: as stable as the insertion sort, so the picture is the same to the byte, where the insertion sort made a wide scribble's plate 4–16 s (F130); counted in `sortStats`.",
    ["-"], "§9")
add("rco.sortCrossingsForTest", "sortCrossingsForTest(pairs)",
    "For the tests: sorts crossing pairs through the shipped path and returns them.", ["-"], "§9")
add("rco.setClip", "setClip(c)",
    "Takes a plate's clip box; one that is not integral or not inside the plate would write other rows, so it throws.",
    ["A clipped render deposits only the clip's rows — the patch rule's dirty rectangles (A3 §3.1)."], "§9")
add("rco.paintPlate", "paintPlate(job, plateIndex, out, counts, timings)",
    "Paints one plate of a packed job: the items whose pixel box misses the plate pruned, the families listed in paint order, then pass 0 resolves the pending marks into their masks and pass 1 paints the rest, masked, from the topmost family that covers the whole clip opaquely.",
    ["The occlusion cull hides everything under an opaque family covering the clip (Kobin, 2026-09-23: 41 whole-plate backdrops a plate under the Magnum Opus's nucleus); a candidate that falls short is painted normally and its counts taken back. A family whose box misses the clip grown by 2 px is skipped whole; the pruning of items is exact, since an item missing the plate deposits nothing the resolve can read. Returns the counts (edges, families, occluded)."],
    "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rpk.outsideWin", "outsideWin(item, win)",
    "Whether an item cannot draw inside a window, read off its cached drawn box without building its pack entry — conservative: a stroke's box widened by half its width and a quarter of its extent for the curve's overshoot.",
    ["A scan that built every entry of a table larger than the memo rebuilt them all each time (the dense drawing thrashed the 10 MiB memo, B-PYRAMID-2 P5)."],
    "§9")
add("rpk.itemChordsAt", "itemChordsAt(item, Z, cfg)",
    "One item's chords at zoom Z as `visibleChords` counts them, memoised on its entry — a patch estimate's term.", ["-"], "§9")
add("rpk.recFor", "recFor(r, o, fade, cfg, offset)",
    "An item's prepass record: the old one when its entry is live and its fade, z, family, erase flag and residual are those it was built with, else a new one.",
    ["A kept record does not touch the memo's LRU: a delete and a set per list item was most of a 26 ms prepass on the dense drawing."], "§9")
add("rpk.entryLive", "entryLive(e, o)",
    "Whether a memo entry is still the item's: not evicted, built from its current geometry version and outline.", ["-"], "§9")
add("rpk.sameRes", "sameRes(a, b) · sameRecs(a, b)",
    "Two residuals equal by value; two families' record lists the same records in the same order — so a family's union routing and sign are reused from the last prepass.",
    ["-"], "§9")
add("rpk.famAdd", "famAdd(f, r, o, fade, idx)",
    "Adds an item's record to its family's drawn list, or counts its rejection: a non-finite coordinate paints nothing, and one past the coordinate bound is counted and logged once.",
    ["-"], "§9")
add("rpk.withOffset", "withOffset(own, offset)",
    "An item's residual with the pack's offset added, in frame units; the residual itself when there is none.", ["-"], "§9")
add("rpk.maskSlots", "maskSlots(items, marks)",
    "The job's mask slots (A2 §4.4): each item's masking marks by the erase rule, and each mark's slot — marks share a slot only where that is exact per family; past MASKS_MAX a mark joins the slot it over-hides the fewest families in.",
    ["The core masks a family whole, by all its items' bits, so no family whose box meets both marks may have one and not the other. A family under two marks sharing a slot reads 1 − max for (1 − a)(1 − b), which differ only where the edges overlap. Over-hiding is counted (`maskOverflow`) and never white ink, which would hide what the rule says shows (DESIGN.md §7). Returns item → its masking marks."],
    "§7")
add("rpk.familyTraits", "familyTraits(items, cfg)",
    "A family's union routing, union sign, colour and alpha as `packJob` decides them over its items in paint order — what a change of membership can flip for every item of the family (PLAN §5.1 Q15); null for a family holding a stroke.",
    ["The Stage reads it (`_traitsOf`) to tell whether a family's membership change damages all of its items' plates. A stroke family's band winding is decided per zoom quantum, hence null."],
    "§9")

# ---- 2026-10-05, the rebuilt tree ----
add("rjb.pastePatch", "pastePatch(plate, patch, clip)",
    "Writes a clipped result's pixels into a whole plate's, in place — the patch merge where there is no canvas to merge on (jsdom keeps raw pixels; A3 §3.2).",
    ["-"], "§9")
