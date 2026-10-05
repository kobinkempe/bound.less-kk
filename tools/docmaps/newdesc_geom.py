# -*- coding: utf-8 -*-
"""Per-function entries for the geometry layer: arcShape, arcPerimeter, freeze, derive,
connect, lasso, polyline and curveOutline (new functions only), and the whole of loop.js,
offsets.js, chordMath.js and antRuns.js."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- src/engine/geometry/arcShape.js ----
add("shp.segmentTerm", "segmentTerm(theta)",
    "`θ − sin θ`, the circular-segment factor of an arc's area, without the cancellation that turns it into noise for a deep arc's tiny sweep.",
    ["Literal above 1e-2 rad; below it, three terms of the series, exact to double precision there. `loopArea` and the scene index's area walk read it.",
     "A level-3 arc sweeps about 2e-8 rad, whose cubic term is below one ulp of the sweep: written literally, `sweep − sin(sweep)` times r²/2 was ±60 units² of noise, and the erase's grazing test read a 12-px nick as having added ink (F46)."],
    "§7")
add("shp.RayIndex", "RayIndex",
    "One shape's pieces bucketed per ray direction, so a winding query visits only the pieces whose box straddles the ray's line.",
    ["Built by the boolean over each operand's `flatPieces`; a direction is indexed the first time a query uses it. The answer is `rayCross`'s own, piece for piece.",
     "Measured on the same cuts (DESIGN.md §7): 2,630 → 175 ms and 2,377 → 143 ms, results identical. Under 32 pieces the index is skipped and the flat scan runs."],
    "§11")
add("shp.RayIndex.constructor", "RayIndex.constructor(flat)",
    "Hold the piece list, and switch the buckets on only for 32 pieces or more and while the probe switch allows it.",
    ["Below 32 pieces the buckets cost more than they save (the fuzz suite's 20–80-piece cuts ran 9 ms with them); `stamp` then stays null and `winding` is `windingOfFlat`."],
    "§11")
add("shp._index", "_index(k)",
    "Build, once, the buckets for ray direction `k`: each piece's box projected onto the ray's normal, in up to 512 equal slots.",
    ["A piece is registered in every bucket its projected extent spans. The extent is padded by 1e-12 of the coordinates and the radius, because an arc's box comes through its centre and at a radius of 1e13 is a few thousandths off (F44): no piece that could cross a ray may be left out."],
    "§11")
add("shp._candidates", "_candidates(k, p)",
    "The pieces a ray from `p` in direction `k` could cross: the bucket its line falls in and the two either side, without repeats.",
    ["A line falling more than one bucket outside the shape's extent gets nothing. The neighbouring buckets are a margin far wider than `rayCross`'s grazing band; a stamp per piece removes duplicates without a set."],
    "§11")
add("shp.winding", "winding(p)",
    "The shape's winding number about `p`, trying each ray direction until one does not graze; null if every one does.",
    ["The loop `windingOfFlat` runs, over the candidates only. With the index off it is `windingOfFlat` itself."],
    "§11")
add("shp._setRayIndex", "_setRayIndex(on)",
    "Probe switch: off makes every `RayIndex` built afterwards the flat scan, to compare the index against it.",
    ["Read when a `RayIndex` is constructed. Only `erase.report.probe.js` calls it (`RAY_INDEX=0`)."],
    "")
add("shp.mapArc", "mapArc(p, pt, f)",
    "An arc through a similarity: centre and ends mapped, radius scaled, angles untouched; a cut arc's canonical ends are mapped with it.",
    ["A cut arc (F43) keeps its canonical angles and its positions `ua`, `ub`; only `K`'s end points move."],
    "§8")
add("shp.mapLine", "mapLine(p, pt)",
    "A line through a similarity; a cut line maps its canonical points and recomputes its ends from their positions on them.",
    ["Recomputed rather than mapped: an end an erase made carries that erase's rounding, which mapping would magnify 4096× per level. From `P`, `Q`, `sa`, `sb` the end is on the line to each level's own precision (F43)."],
    "§10")
add("shp.shareCutEnds", "shareCutEnds(loop)",
    "Write each cut line's recomputed ends into its neighbours, so a transformed loop still closes bit for bit.",
    ["Consecutive pieces must share their end points exactly; the file format and the stitch rely on it. Where two cut lines meet, the later one's start wins. Mutates and returns the loop."],
    "§10")
add("shp.arrayLike", "arrayLike(a)",
    "Is this an encoded loop: a plain array (kobin-1) or a Float64Array view of a frame's geometry (kobin-2)?",
    ["-"], "§13")
add("shp.encodedLoopsNeedV2", "encodedLoopsNeedV2(enc)",
    "Does an encoded loop set hold a cut line or a cut arc (record code 2 or 3), which the version-1 file format cannot carry?",
    ["`persist.encodeDrawing` raises the file's version when any shape needs it. Walks the records by width and stops at the first code 2 or 3."],
    "§13")
add("shp.arcCommandFits", "arcCommandFits(Rpx, tol)",
    "Is the SVG arc command within `tol` px for a circle of `Rpx` px? The browser rebuilds the centre in float32, off by 2^-24 of the radius.",
    ["True up to a screen radius of about 4.2 million px at a quarter pixel (DESIGN.md §9, F40)."],
    "§9")
add("shp.arcCubicCount", "arcCubicCount(sweep, Rpx, tol)",
    "How many kappa cubics keep an arc within `tol` px: n = ⌈sweep·(1.8e-5·Rpx/tol)^(1/6)⌉, at least one.",
    ["The sixth-root law of one cubic's error, checked numerically to 1%; at most a dozen or so for any piece the tile chop allows."],
    "§9")
add("shp.arcSplit", "arcSplit(p, n)",
    "An arc as `n` equal sub-arcs of the same circle; the first starts at A and the last ends at B.",
    ["The interior joins are computed through the centre. `n` ≤ 1 returns the piece itself."],
    "§9")
add("shp.planArc", "planArc(p, { ... })",
    "How one arc reaches the browser: the arc command while its float32 centre is within tolerance, else as many centre-free cubics as the sixth-root law asks.",
    ["Returns `{ command: 'A' | 'C', parts }`, one instruction per part, planned at the frame's deepest zoom (`enter`) so the plan never changes while zooming.",
     "An arc-command part never exceeds a half turn (the command is named by its endpoints). `segMax` also splits by length, the Renderer's float32 floor for far coordinates. Callers: `Renderer.pushArcPiece` and the ants' `runPathData`."],
    "§9")
add("shp.chordCubic", "chordCubic(p)",
    "One arc as one cubic from its end points and sweep alone — no centre, no radius.",
    ["The tangents leave the chord at ±sweep/2 and the handle is (chord/3)·(1 + tan²(sweep/4)), the cancellation-free form of 4/3·tan(θ/4)·r; through the centre, a nearly straight arc's whole bulge sits in one ulp of the centre.",
     "A line, a zero chord or a zero sweep gives the straight cubic `[A, A, B, B]`."],
    "§9")
add("shp.chordArcMid", "chordArcMid(p)",
    "An arc's midpoint from its ends and sweep, on the bulge side of the chord — `chordMath.chordMidXY` for a piece object.",
    ["The Renderer stores it on each arc anchor (`_mid`) so the thin-rescale measure counts a curve's area. `chordMath.test.js` M1 asserts the two forms are bit-identical."],
    "§9")
add("shp.reanchorCutLines", "reanchorCutLines(loops, edges)",
    "After a window clip, clip each cut line's canonical segment to the window too, so the level below sees the numbers the uncut line would have sent.",
    ["The crossings of P→Q with the window come from `lineCrossSeg` on the rect loop's own edges, the boolean's arithmetic in the same order. The ends' positions are re-expressed on the clipped segment; a piece whose ends are both clip vertices becomes a plain line, the chain's own piece (F43).",
     "A line wholly inside, or one with no crossing found, is left as it is; an unchanged loop is returned as the same array."],
    "§10")
add("shp.reanchorCutArcs", "reanchorCutArcs(loops, edges, weld)",
    "After a window clip, re-anchor each cut arc's canonical arc to the fragment the chain's own clip of it would have made.",
    ["Finds the canonical circle's crossings with the four edges (`circleCrossSeg`), accepts them with the boolean's own `weld` (a retry may have changed it) and drops any that weld onto K's ends or each other; the fragment holding the middle of the piece's stretch becomes K, the positions re-expressed on it.",
     "Does nothing without a positive `weld`. A piece that is the whole fragment, travelling K's way, comes out with no K (`arcPieceOf`)."],
    "§10")

# ---- src/engine/geometry/arcPerimeter.js ----
add("arc.canonOf", "canonOf(p)",
    "The two points a piece is cut along as a line: a cut line's `P`, `Q`, a cut arc's canonical ends, or its own ends.",
    ["The intersectors cut a line along this segment (`pieceIntersections`), so a line an erase shortened is still cut where the whole line would have been (F43)."],
    "§10")
add("arc.canonAt", "canonAt(P, Q, t)",
    "The point at position `t` on the line P→Q, the expression the intersectors use; a `t` of 0 or 1 copies the end exactly.",
    ["`mapLine` recomputes a cut line's ends with it after every transform."],
    "§10")
add("arc.canonPos", "canonPos(P, Q, pt)",
    "Where a point projects on the line P→Q, as a position; 0 for a zero-length line.",
    ["Used wherever a piece becomes a cut line on a chord: `cutLine` for a straightened cut arc, the chop's `settleCut`, and `straighten`."],
    "§10")
add("arc.cutLine", "cutLine(p, s0, s1, A, B, ta, tb)",
    "`subPiece` for a subject line the boolean cut: the fragment keeps the line it was cut from (`P`, `Q`) and its ends' positions on it.",
    ["`ta`, `tb` are the positions the intersector computed the crossing at (the third element of its point); otherwise they are interpolated from the parent's positions. A cut arc the boolean straightened is cut along its canonical chord (F43)."],
    "§10")
add("arc.canonArc", "canonArc(p)",
    "A cut arc as the uncut arc it was cut from: its centre and radius with K's angles and ends. An uncut piece is returned as it is.",
    ["Every deeper cut — the chop, the freeze, the window clip, the next erase — is computed on this, so a nick moves nothing but the nick (F43)."],
    "§10")
add("arc.arcDir", "arcDir(p)",
    "+1 when a piece travels its canonical arc the way K does, −1 the other way.",
    ["K is never reversed: a reversed piece says so with the sign of its own sweep, and its positions stay in K's direction."],
    "§10")
add("arc.arcSpan", "arcSpan(p)",
    "A piece's extent on its canonical arc, `[ua, ub]`, or `[0, 1]` for an uncut arc.",
    ["-"], "§10")
add("arc.arcPos", "arcPos(k, pt)",
    "Where a point of the circle sits along arc `k`, as a position clamped to [0, 1]: `paramOf`'s arithmetic, never null.",
    ["The boolean records it for each crossing on a subject arc, from the raw crossing before welding."],
    "§10")
add("arc.arcPieceOf", "arcPieceOf(k, lo, hi, Plo, Phi, dir)",
    "The piece covering positions [lo, hi] of arc `k`, travelling `dir`, with its end points supplied.",
    ["The whole of `k` in `k`'s direction comes back as the chain's own piece with no K, so an arc cut back to its full extent is indistinguishable from one never cut."],
    "§10")
add("arc.cutArc", "cutArc(p, s0, s1, A, B, u0, u1)",
    "`subPiece` for a subject arc the boolean cut: the fragment keeps the arc it was cut from and its stretch as positions on it.",
    ["`u0`, `u1` are the cut ends' positions on the canonical arc; an end that is the piece's own keeps that end's position. The end points are the ones the erase made, carried as points and never recomputed through a far centre (F44)."],
    "§10")
add("arc.lineCrossSeg", "lineCrossSeg(P, Q, C, D)",
    "Where the line P→Q meets the segment C→D, as `[x, y, t]` on P→Q — the boolean's own `segSeg`, exported for `reanchorCutLines`.",
    ["-"], "§10")
add("arc.circleCrossSeg", "circleCrossSeg(C, r, A, B)",
    "Where the circle (C, r) meets the segment A→B, as `[x, y, t]` — the boolean's own `circleSegment`, exported for `reanchorCutArcs`.",
    ["-"], "§10")
add("arc.now", "now()",
    "The bake's clock: `performance.now()` where there is one, else `Date.now()`.",
    ["-"], "")

# ---- src/engine/geometry/freeze.js ----
add("frz.freezeRadius", "freezeRadius(tol)",
    "The one freeze gate: the radius whose bow over a tile's diagonal is exactly `tol`; an arc at or above it is straight within `tol` anywhere in a tile.",
    ["r = ((c/2)² + tol²)/(2·tol) with c = TILE·√2. A tile is TILE units at every level and the radius maps down exactly, so it is one number everywhere — about 8.8e12 units at the engine's quarter pixel (DESIGN.md §5).",
     "The chop, the tile clip and every boolean use it, so an erase never re-decides a freeze. `DEFAULT_FREEZE_R` is it at the default tolerance."],
    "§8")
add("frz.chordFrame", "chordFrame(p)",
    "An arc written from its chord, never its centre: midpoint, chord direction, the normal towards the bulge, half-chord, radius and d = √(r² − (L/2)²).",
    ["For a positive sweep the arc bulges to the right of the chord. Null for a zero chord or a radius no larger than the half-chord.",
     "The chop uses it for arcs at or over the freeze radius, `rayCross` for minor arcs whose radius is at least the chord."],
    "§8")
add("frz.chordPt", "chordPt(f, a, axis, k)",
    "The chop's cut point at chord abscissa `a`, with the cut coordinate set to the grid line `k` exactly.",
    ["The height is h(a) = ((L/2)² − a²)/(d + √(r² − a²)), which has no cancellation. Setting the axis coordinate to `k` puts the fragment's end on the line it was cut on."],
    "§8")
add("frz.chordLineRoots", "chordLineRoots(f, nx, ny, c, steps)",
    "Chord abscissae where an arc meets the line ν·X = c, each polished by Newton steps on the exact height and returned with its residual.",
    ["A first-order quadratic in the stable form, then `steps` Newton steps. The chop asks with an axis and 3 steps, and 3 it stays: where its cuts land is a saved drawing's deep picture.",
     "A ray can miss the arc and still get roots; `rayCross` asks for more steps and drops any root whose residual is not small against the chord."],
    "§8")
add("frz.chordHit", "chordHit(f, a)",
    "The arc at chord abscissa `a`: the point, the tangent in the direction of travel, and the chord fraction.",
    ["For the winding query's crossings (`rayCross`); the chop places its points with `chordPt`."],
    "§11")
add("frz.chordCuts", "chordCuts(f, k, axis, out)",
    "Chord abscissae where an arc meets the grid line `axis = k`, strictly inside the piece.",
    ["`chordLineRoots` with the axis as the normal, so the products are exact. A root within 1e-12 of an end, as a chord fraction, is dropped: it would make a zero-length piece."],
    "§8")

# ---- src/engine/geometry/derive.js ----
add("der.freezeR", "freezeR(cfg)",
    "The freeze radius at the engine's tolerance — the gate the chop, the tile clip and every boolean share.",
    ["`freezeRadius(freezeTol(cfg))`. Handed to the boolean by the erase (`_boolOpts`) and by the tile store's shape clip, so a cut stands in for an arc by its chord exactly when the chain would freeze it."],
    "§8")

# ---- src/engine/geometry/connect.js ----
add("con.Groups.constructor", "Groups.constructor(n)",
    "A union-find over `n` ids, each its own class.",
    ["-"], "§10")

# ---- src/engine/geometry/lasso.js ----
add("las.loopTester", "loopTester(poly)",
    "The lasso loop, prepared once to answer 'is this point inside?' and 'is this ring wholly inside?' many times.",
    ["A ring is inside when its first vertex is inside (even-odd) and no ring segment crosses a loop edge. The loop's edges are bucketed into a 32 × 32 grid over its box, so a segment tests only the edges in the cells it touches; asking every pair cost 30 ms an object.",
     "`_lassoFind` builds one per lasso for the ink test an object gets when its box fails (F32). A loop of under three points answers no to everything."],
    "§12")
add("las.polygonMissesRect", "polygonMissesRect(poly, rect)",
    "Does a closed polygon's boundary stay out of a rectangle: no edge crossing a side and no vertex inside?",
    ["With one corner inside, that makes the rectangle wholly enclosed (`rectInsidePolygon`). The erase uses it to find frames lying inside a mark's flattened ink, which it takes whole (`_eraseFramesPass`)."],
    "§12")

# ---- src/engine/geometry/polyline.js ----
add("ply.strokeStripRound", "strokeStripRound(pts, width, opts)",
    "A polyline's band with round joins and caps, written flat for the rasteriser: a rectangle per segment, a fan at each turn, a half-disc at each end.",
    ["Every ring is wound positive and written into a `RingWriter`; a single point or a full reversal takes a whole disc. It needs no window, which is why it exists: the default path's caps take their span from the rect, so two plates got two caps and a hairline between them. Reached through `strokeStripNear(..., { joins: 'round', tol })`.",
     "A fan costs ⌈delta/(2·acos(1 − tol/half))⌉ chords, so a stroke thinner than the tolerance costs one per fan. The default path winds the other way, and a family mixing the two cancels to a hole (OPEN-FLAGS F76)."],
    "§9")
add("ply.fanAt", "fanAt(w, cx, cy, r, a0, delta, step)",
    "A pie slice into the ring writer: the centre, then ⌈|delta|/step⌉ chords of the circle from angle `a0`.",
    ["The outer side of a join, and each cap. Not interchangeable with `disc`, which has no centre point."],
    "§9")
add("ply.disc", "disc(w, cx, cy, r, step)",
    "A whole circle into the ring writer, with no centre point and at least three points, so a dot under the tolerance still carries ink.",
    ["-"], "§9")
add("ply.RingWriter", "RingWriter",
    "The flat ring buffer the round-join band is written into: x, y pairs in `xy`, each ring's first point in `ring`, and the band's total area.",
    ["Grows by doubling from the caller's arrays, so the caller takes the arrays back from `done()` rather than assuming its own were filled."],
    "§9")
add("ply.RingWriter.constructor", "RingWriter.constructor(out)",
    "Start on the caller's `xy` and `ring` arrays when given, else on fresh ones.",
    ["-"], "§9")
add("ply.startRing", "startRing()",
    "Begin a ring at the current point count, doubling the ring index when it is full.",
    ["-"], "§9")
add("ply.pt", "pt(x, y)",
    "Append a point, doubling the coordinate buffer when it is full.",
    ["-"], "§9")
add("ply.close", "close()",
    "Finish the ring just written: reverse it in place if it winds negative, and add its area to the band's total.",
    ["Positive is the winding of a boolean shape and of every band this path ships, and not of the default path's rings (D105, D106)."],
    "§9")
add("ply.done", "done()",
    "The written band: `{ xy, ring, rings, pts, area }`.",
    ["-"], "§9")

# ---- src/engine/geometry/curveOutline.js ----
add("cvo.cubicLoopsBBox", "cubicLoopsBBox(loops)",
    "The box of cubic loops by their control points, which contains the curve — not `arcShape.loopsBBox`, which takes arc loops.",
    ["The raster packer's stroke cull box needs a box that contains a fitted band; the erase oracle is the other caller. Empty input gives an inverted, infinite box, not null."],
    "§9")

# ---- src/engine/geometry/loop.js ----
add("lop.widthOf", "widthOf(code)",
    "How many numbers a piece record holds: 3 for a line, 8 an arc, 9 a cut line, 16 a cut arc; an unknown code reads as an arc.",
    ["-"], "§7")
add("lop.indexLoop", "indexLoop(buf)",
    "The record offsets of a loop's pieces, found by walking the records by their codes.",
    ["Under five numbers is an empty loop. It does not validate: a buffer that ends mid-record is indexed as if the last record were whole."],
    "§7")
add("lop.decodePiece", "decodePiece(a, o, A)",
    "One piece as the geometry code reads it, from the record at offset `o`, with `A` its start point.",
    ["Code 2 gives a line with its canonical `P`, `Q`, `sa`, `sb`; code 3 an arc with `K`, `ua`, `ub`. The caller passes the previous piece's `B` as `A`, so consecutive decoded pieces share the point."],
    "§7")
add("lop.encodeLoopInto", "encodeLoopInto(loop, out)",
    "Append one loop's numbers to anything with a `push`: a plain array for a kobin-1 file, `format2.F64Builder` for a kobin-2 span.",
    ["A Loop copies its buffer; piece objects are encoded, an arc with a non-finite radius as a line. One grammar, one implementation for both formats."],
    "§13")
add("lop.shiftLoopNumbers", "shiftLoopNumbers(a, dx, dy)",
    "Move every point in a loop's numbers by (dx, dy), in place: ends, centres, a cut line's `P` and `Q`, a cut arc's canonical ends.",
    ["Radii, angles and positions are untouched."],
    "§7")
add("lop.Loop", "Loop",
    "One closed loop of arc and line pieces, stored as a single Float64Array with a Uint32Array of record offsets.",
    ["The stored form of every shape's loops (DESIGN.md §3): the file's own numbers, `ax, ay` then one record per piece. A piece read is a transient view shaped like the piece objects the builders make; nothing writes through one, so a move is `translate`, which returns a new Loop.",
     "Measured on the 12,844-object canvas: an arc piece as an object was 344 B for 56 B of numbers; here it is 64 B and a 4-byte index entry."],
    "§7")
add("lop.Loop.constructor", "Loop.constructor(buf, idx)",
    "Wrap a loop's numbers, building the record index when none is given.",
    ["-"], "§7")
add("lop.is", "is(x)",
    "Is this a Loop? Only the tests ask.",
    ["-"], "§7")
add("lop.wrap", "wrap(enc)",
    "A Loop over encoded numbers: a Float64Array is used as it is, with no copy (a snapshot's span); anything else is copied.",
    ["The Document wraps a loaded native's loops with it."],
    "§13")
add("lop.from", "from(pieces)",
    "A Loop from a builder's piece array, in one counting pass and one pass filling the buffer and index together; a Loop passes through.",
    ["Every bake and every derived tile comes through here at the storage boundaries (Document, TileStore, the erase job's results). The push-then-copy form cost the fuzz suite's cede path a third of its render time."],
    "§7")
add("lop.length", "length (getter)",
    "The number of pieces.",
    ["-"], "§7")
add("lop.at", "at(i)",
    "Piece `i` as a fresh view (negative counts from the end), or undefined out of range.",
    ["Its `A` is read from the previous record's last two numbers, or the loop's start for the first piece."],
    "§7")
add("lop.toPieces", "toPieces()",
    "Every piece as a fresh view, in a plain array.",
    ["-"], "§7")
add("lop.map", "map(fn)",
    "Array-style `map` over the pieces, called with (piece, i, loop).",
    ["Each piece is a fresh view; nothing a callback writes into one reaches the loop."],
    "§7")
add("lop.forEach", "forEach(fn)",
    "Array-style `forEach` over the pieces.",
    ["-"], "§7")
add("lop.some", "some(fn)",
    "Array-style `some`, stopping at the first true.",
    ["-"], "§7")
add("lop.every", "every(fn)",
    "Array-style `every`, stopping at the first false.",
    ["-"], "§7")
add("lop.filter", "filter(fn)",
    "The pieces a predicate keeps, as a plain array of views.",
    ["-"], "§7")
add("lop.reduce", "reduce(fn, init)",
    "Array-style `reduce` over the pieces; the initial value is not optional.",
    ["-"], "§7")
add("lop.slice", "slice(a, b)",
    "Pieces `a` to `b` as a plain array of views, not a Loop.",
    ["-"], "§7")
add("lop.translate", "translate(dx, dy)",
    "The same loop moved by (dx, dy): a new Loop over a shifted copy of the numbers, sharing the index.",
    ["-"], "§7")
add("lop.toArray", "toArray()",
    "The numbers as a plain array. Only the tests call it; a kobin-1 file is written through `encodeLoopInto`.",
    ["-"], "§13")
add("lop.byteLength", "byteLength (getter)",
    "Bytes held by the numbers and the index, for the memory census.",
    ["Read by `memory.census.probe.js`."],
    "§7")

# ---- src/engine/geometry/offsets.js ----
add("off.snapDisplacement", "snapDisplacement(v)",
    "Snap a displacement to 2^-10 of the move level's unit — a quarter pixel at its deepest zoom — before it enters the table.",
    ["Exact: a multiply and a divide by a power of two. Snapped, an entry is whole cells from three levels below the move, so the paint-time remainder lives on two levels only (DESIGN.md §8). The drag calls it."],
    "§6")
add("off.offsetAt", "offsetAt(below, k)",
    "The table's entry at depth `k` below the home, or null when it is absent or zero.",
    ["-"], "§6")
add("off.hasOffsets", "hasOffsets(below)",
    "Does this table hold any non-zero entry?",
    ["-"], "§6")
add("off.cloneBelow", "cloneBelow(below)",
    "A detached copy of a table's non-zero entries, or undefined when there are none.",
    ["-"], "§6")
add("off.tidy", "tidy(out)",
    "Drop a table's zero entries, in place; undefined when nothing is left.",
    ["So an empty table has one form, undefined, never `[]`."],
    "§6")
add("off.carryOf", "carryOf(v)",
    "How many whole frames to carry so a remainder lands in [−W/2, W/2).",
    ["-"], "§6")
add("off.addOffset", "addOffset(below, k, dx, dy)",
    "Add a displacement at depth `k` and carry whole frames upward; returns the new table and the whole home frames that left depth 0.",
    ["A frame at depth m is exactly G units at depth m − 1, so every carry is integer arithmetic. The carry out of the home level (`cellX`, `cellY`) is a change of address — the native is re-homed to the neighbour cell, and nothing is ever added to a stored coordinate (F41, F55). The input table is not touched."],
    "§6")
add("off.shiftAt", "shiftAt(below, k0)",
    "The table's translation at depth `k0` below the home, split into whole cells per depth, whole home frames, and the sub-frame remainder.",
    ["Returns `{ digits, carry, rem }`: `digits[m]` the cells at depth m (1 to `k0`), `carry` the home frames, `rem` in [−W/2, W/2) at `k0` — what paint applies and inputs subtract. Above the home (`k0` < 0) only `rem` is set.",
     "Digits and remainders from entries at or above `k0` are exact (the snap); deeper entries add exact power-of-two fractions, and only their sum can round, in paint's own precision."],
    "§6")
add("off.hasDigits", "hasDigits(sh)",
    "Does a `shiftAt` result move the picture by any whole frame?",
    ["When it does not, `LevelMap` reads the picture from the object's own frame and applies only the remainder."],
    "§6")
add("off.residual", "residual(below, k0)",
    "The translation paint applies to an object's picture at depth `k0` (`piece.res`): the sub-frame remainder, or null when it is zero.",
    ["The whole-frame part is the object's address at that level (`LevelMap.objShift`), not a translation."],
    "§6")
add("off.shiftDown", "shiftDown(below, k)",
    "The table of a kid `k` levels below its parent: the parent's entries at or above the kid's level folded into its `below[0]`, the deeper ones moved up by `k`.",
    ["Only the folded entries' remainder enters the table; their whole frames are the kid's address. Folding the deeper entries into `below[0]` too counted the displacement twice — measured as an erase at the drag's level missing the moved ink by exactly the remainder. Used by the cede and by scaling down."],
    "§6")
add("off.shiftUp", "shiftUp(below)",
    "The table of the same object promoted one level up: every entry one depth deeper, the home level's included.",
    ["-"], "§6")
add("off.sameShift", "sameShift(a, b)",
    "Are two frame shifts (`[x, y]` or null) equal?",
    ["A shift is the k = 0 entry a moved frame owes its natives (DESIGN.md §8); the subtree drag and the pointer-up compare them."],
    "§6")
add("off.sameBelow", "sameBelow(a, b)",
    "Do two tables hold the same non-zero entries, absent and zero counting as equal?",
    ["-"], "§6")
add("off.encodeBelow", "encodeBelow(below)",
    "A table in its file form, `[[k, ox, oy], ...]`, or undefined when it is empty.",
    ["The form the snapshot, the op log and the phone report carry."],
    "§13")
add("off.decodeBelow", "decodeBelow(raw)",
    "A table back from its file form; throws on a malformed entry rather than guessing.",
    ["The file loader validates first."],
    "§13")

# ---- src/engine/geometry/chordMath.js ----
add("chm.bulgeK", "bulgeK(sweep)",
    "The bulge coefficient of a sweep, `tan(sweep/4)/2`: an arc's sagitta is its chord's length times this.",
    ["Each bisection halves the sweep exactly, so the rasteriser's flattener computes one `tan` per depth for every pair at that depth. `tan(sweep/2)/2` has the same shape and twice the bulge — the error `chordMath.test.js` M1 catches."],
    "§9")
add("chm.chordMidK", "chordMidK(ax, ay, bx, by, k, out)",
    "An arc's midpoint from its two ends and the bulge coefficient of its sweep, written into `out`: the chord's midpoint pushed off the chord by the sagitta.",
    ["A positive sweep is anticlockwise and bulges to the right of the chord, n̂ = (u_y, −u_x); reversed, every arc bulges the wrong way. Allocates nothing, because the flattener calls it once per chord in the worker's inner loop."],
    "§9")
add("chm.chordMidXY", "chordMidXY(ax, ay, bx, by, sweep, out)",
    "An arc's midpoint from its ends and its sweep: `chordMidK` at `bulgeK(sweep)`.",
    ["The expression `arcShape.chordArcMid` uses for a piece object."],
    "§9")
add("chm.sagittaOf", "sagittaOf(ax, ay, bx, by, sweep)",
    "How far an arc bulges from its own chord, `(|chord|/2)·|tan(sweep/4)|`, with no centre and no radius.",
    ["0 for a zero sweep; Infinity over half a turn rather than a tangent about to change sign. Shared by the chop's box (`freeze.pieceSagitta`) and the rasteriser's flattener and packer."],
    "§9")
add("chm.segRatio", "segRatio(theta)",
    "`(θ − sin θ)/(1 − cos θ)` without either cancellation: a series below 1e-2 rad, and the denominator written as 2·sin²(θ/2).",
    ["Written literally, `1 − cos θ` rounds to 0 near a whole turn and the ratio comes back Infinity. Measured against the radius form at r = 40: 5.4e-16 relative at worst for 2π − |θ| from 0.1 down to 1e-15, where the literal form is 0.08 % out at 1e-7 and Infinity below 1.5e-8 (M3)."],
    "§9")
add("chm.arcAreaTerm", "arcAreaTerm(ax, ay, bx, by, sweep)",
    "What one arc adds to a ring's shoelace sum beyond its chord, `r²(θ − sin θ)`, written from the chord and the sweep alone.",
    ["`(|chord|²/2)·segRatio(θ)`. A whole turn returns 0, because its ends coincide and the chord carries no radius: a caller summing a ring must take a full circle from its centre, `2πr²` signed by the sweep, or the ring has no area and no winding sign (`rasterCore.itemShoelace`, D60)."],
    "§9")

# ---- src/engine/geometry/antRuns.js ----
add("ant.isCubic", "isCubic(p)",
    "Is this piece a cubic `[p0, p1, p2, p3]` — the capsule outline of a stroke not yet resolved?",
    ["-"], "§12")
add("ant.isLine", "isLine(p)",
    "Is this piece straight: a line, or an arc with a non-finite or non-positive radius?",
    ["-"], "§12")
add("ant.startOf", "startOf(p)",
    "A piece's first point, cubic or not.",
    ["-"], "§12")
add("ant.pieceLength", "pieceLength(p)",
    "One piece's length: a hypot for a line, r·|sweep| for an arc, the mean of chord and control polygon for a cubic.",
    ["The canvas ant painter walks runs by this length too (`antPaint.paintRun`), so its dash phase and the lengths decided here agree."],
    "§12")
add("ant.runLength", "runLength(pieces)",
    "The length of a run or a whole loop.",
    ["The decision drops a run under half a pixel on screen by it."],
    "§12")
add("ant.onRectEdge", "onRectEdge(p, rect, eps)",
    "Does a straight piece lie along one side of `rect`, within `eps`? Then it is a cut — a tile seam or a cede window — not an edge the ink has.",
    ["Only a line can: an arc crosses or grazes a line and never runs along one. `loopRuns` stops the ants there, and the Renderer never splits such a line by length."],
    "§12")
add("ant.loopRuns", "loopRuns(loop, rects)",
    "Split one loop into runs at its seam pieces, so the ants stop at a tile cut and pick up on the next piece.",
    ["`rects` is `[{ rect, eps }]`: the tile that clipped the piece and its family's attach windows. A loop with no seam is one closed run; otherwise the runs are open, each the free edge between two cuts. Reads the loop through `at`, so a Loop or an array will do."],
    "§12")
add("ant.runPathData", "runPathData(run, ox, oy, k, plan)",
    "SVG path data for a run, relative to `(ox, oy)` and scaled by `k`, with arcs planned exactly as the ink's are.",
    ["The fold the renderer applies, so the numbers reaching the browser are screen-sized at any depth. Arcs go through `planArc` (the arc command, or `chordCubic` cubics), planned at `k` × 1.25, the drift a decision may make before it is redone. Two decimals, `-0.00` written `0.00`.",
     "Only the SVG renderer asks for it; the canvas painter keeps the pieces. Measured at F39's density: the string cost 8.24–8.92 ms and 278.1 KB a decision, the pieces 0.33–0.65 ms."],
    "§12")
add("ant.loopsBounds", "loopsBounds(loops)",
    "The axis-aligned bounds of loops — arcs exact at the cardinal angles their sweep passes, cubics by their control points; null for nothing.",
    ["-"], "§12")
add("ant.norm", "norm(a)",
    "An angle into [0, 2π).",
    ["-"], "§12")
add("ant.arcOffset", "arcOffset(p, th)",
    "How far along an arc's sweep the angle `th` falls, from 0 at its start to |sweep| at its end, or −1 when the arc does not pass it.",
    ["An angle a rounding error short of the start (1e-9 rad) reads as the start, not as a full turn away."],
    "§12")
add("ant.arcHasAngle", "arcHasAngle(p, th)",
    "Does the arc pass the angle `th`?",
    ["-"], "§12")
add("ant.edgeSpans", "edgeSpans(loops, rect, inside, inset)",
    "Where the ink meets each side of the view: its crossings with a line just inside each side, walked by winding into intervals.",
    ["Returns `{ left, right, top, bottom, covered }`, each side's spans clipped to it. The line runs `inset` inside the side because a boundary lying along the side is degenerate for a winding scan.",
     "`covered` is the view flooded: no crossing and `inside` true at the centre, or every side spanned end to end. `overlays._selEdges` draws the edge ants and chevrons from it."],
    "§12")
add("ant.spansOf", "spansOf(cross, lo, hi)",
    "Crossings `[pos, dir]` along one line, sorted and walked into the intervals of non-zero winding within [lo, hi].",
    ["Sorts `cross` in place; intervals that touch are merged."],
    "§12")
add("ant.above", "above(v, line)",
    "The half-open side test: a point exactly on the line counts as the low side, so a vertex on the line is crossed by exactly one of its two pieces.",
    ["-"], "§12")
add("ant.crossVertical", "crossVertical(p, X, out)",
    "A piece's crossings with the vertical line x = X, pushed as `[y, dir]`.",
    ["Lines by interpolation under the half-open rule, arcs analytically with `arcCrossCounts` deciding the ends, cubics by `crossCubic`."],
    "§12")
add("ant.arcCrossCounts", "arcCrossCounts(p, th, v)",
    "The half-open rule for an arc meeting a line at angle `th` with velocity `v` across it: does this crossing count?",
    ["Grazing never counts. At the arc's start it counts if the arc leaves to the high side, at its end if it arrived from it, and in between always — what the line rule says of a vertex, so a vertex is counted once whichever pieces meet there."],
    "§12")
add("ant.crossCubic", "crossCubic(c, axis, V, out)",
    "A cubic's crossings with the line `coord = V`: 24 samples along it, each sign change bisected 40 times.",
    ["Pushes `[other coordinate, dir]`. Only the capsule outline of an unresolved stroke has cubics, and few are ever on screen."],
    "§12")
add("ant.crossHorizontal", "crossHorizontal(p, Y, out)",
    "A piece's crossings with the horizontal line y = Y, pushed as `[x, dir]`.",
    ["The counterpart of `crossVertical`; `insideLoops` runs its ray through it."],
    "§12")
add("ant.insideLoops", "insideLoops(loops, pt)",
    "Is a point inside the ink? Non-zero winding from the crossings of the ray from the point towards +x.",
    ["The crossing code the edge scan uses, so lines, arcs and cubics are all answered; `edgeSpans`' covered test asks it at the view's centre."],
    "§12")
add("ant.samePt", "samePt(a, b)",
    "Are two points the same, within 1e-9 relative?",
    ["-"], "§12")
add("ant.endOf", "endOf(p)",
    "A piece's last point, cubic or not.",
    ["-"], "§12")
add("ant.inRect", "inRect(q, r)",
    "Is a point inside a rectangle, edges included?",
    ["-"], "§12")
add("ant.arcSideOffsets", "arcSideOffsets(p, axis, V, out)",
    "The offsets along an arc, strictly between its ends, where it crosses the line `axis = V`.",
    ["-"], "§12")
add("ant.clipPiece", "clipPiece(p, rect)",
    "The parts of one piece inside `rect`, in order: a line by Liang–Barsky, an arc cut where it crosses the sides, a cubic kept whole if its hull meets the rect.",
    ["An arc part is kept when its midpoint is inside and keeps the piece's own end point wherever it ends at one. A piece wholly inside comes back as itself."],
    "§12")
add("ant.clipRunToRect", "clipRunToRect(run, rect)",
    "A run cut to the window the indicator retains, as the runs of its pieces inside it; a closed run that leaves and returns is opened, its two ends joined.",
    ["The render list's pieces are cut to tiles, which can be many screens across, and the rasteriser must never be asked to dash off-screen ink: measured, 350,958 dashes on one rectangle of which a few hundred were on screen. A cut of the boundary, not of the ink, so no boolean.",
     "A closed run wholly inside stays closed."],
    "§12")
add("ant.circleLoop", "circleLoop(cx, cy, r)",
    "A circle as a loop of two half-turn arcs — the dot drawn for a frame or object too small to trace.",
    ["-"], "§12")
add("ant.rectLoopOf", "rectLoopOf(rect)",
    "A rectangle as a loop of four lines. Only the tests call it.",
    ["-"], "§12")


# The article heading for each file that is new to the pages.
ROLE = {
    "src/engine/geometry/loop.js":
        "The stored form of a loop: one Float64Array in the file's own grammar (`ax, ay`, then a record per piece, codes 0–3) with a Uint32Array of record offsets. Builders make piece arrays; the storage boundaries turn them into Loops, and every read is a transient view.",
    "src/engine/geometry/offsets.js":
        "An object's displacement table: `below[k]` for each depth at or below its home, the sub-frame part of every move, carried upward in whole frames. A move never touches a stored coordinate; paint applies the table's remainder and every input subtracts it (DESIGN.md §8).",
    "src/engine/geometry/chordMath.js":
        "The arc identities written from an arc's two ends and its sweep, never its centre: bulge, midpoint, sagitta and the area term. A leaf the raster worker imports; `arcShape.chordArcMid` and `freeze.pieceSagitta` call the same expressions.",
    "src/engine/geometry/antRuns.js":
        "The selection indicator's geometry, on the pieces the renderer draws: runs split at tile seams and cut to the retained window, their lengths and SVG path data, and where the ink meets the sides of the view. Nothing is flattened.",
}


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    "shp.transformLoops": {
        "why": "Says the seam-overhang marks survive the transform; the marks and the code that carried them were deleted (freeze.js header, DESIGN.md §2). The transform now carries F43's canonical line and arc instead.",
        "what": "Scale and shift an outline; a cut line's ends are recomputed from its canonical line and written into its neighbours, so the loop stays closed.",
        "long": ["`x → x·f + t` on every piece: centre and ends mapped, the radius scaled, the angles untouched, so a resolved perimeter crosses a level without being re-resolved.",
                 "Builds new points rather than mutating, since consecutive pieces share their endpoint arrays. A cut line maps its canonical `P`, `Q` and recomputes its ends from their positions (`mapLine`); a cut arc maps its canonical ends and keeps its positions (`mapArc`); `shareCutEnds` writes the recomputed ends into the neighbours (F43)."],
    },
    "shp.seam": {"why": "gone", "what": None, "long": None},        # the row's `seam (private)`: deleted with the seam marks
    "shp.VertexSet": {"why": "gone", "what": None, "long": None},   # one VertexSet now, arcPerimeter's (arc.VertexSet), imported by the boolean
    "shp.straighten": {
        "why": "Says an arc is straightened when its bulge is finer than its coordinates can express; the test is now the freeze radius (`R`), the chain's own gate, applied to a cut arc's canonical arc.",
        "what": "Stand in for every arc at or over the freeze radius by its chord, on the boolean's working copy — the chain's freeze gate and no other test.",
        "long": ["A cut arc is judged by its canonical arc and becomes a cut line on that arc's chord (`P`, `Q` = K's ends, positions by `canonPos`). Returns the loops and how many pieces it straightened.",
                 "The only arcs over the gate that reach the boolean unfrozen are an object's home-level pen arcs, which no chop has seen (DESIGN.md §5, §6). Wherever the cut does not reach, the originals pass through, not this copy (F42)."],
    },
    "shp.shapeBooleanOnce": {
        "why": "Its first step says an arc bulging less than its coordinates can express becomes a line; `straighten` now uses the freeze radius, and the originals, not the straightened copy, pass through where the cut does not reach.",
        "what": None,
        "long": ["One pass of the exact boolean.",
                 "**Normalise and straighten.** One handedness for both shapes; on a working copy every arc at or over the freeze radius is stood in for by its chord (`straighten`). The originals are kept beside it, and a loop or piece the cut does not reach comes out as the original (F42).",
                 "**Pass through what cannot be involved.** A loop whose box misses the other shape's box cannot cross it or be inside it, which keeps the cost proportional to the gesture rather than to the drawing.",
                 "**Cut** at every crossing and at the ends of every stretch where the two lie on top of each other, with the welding radius taken from the smaller shape and the coordinates where the two meet. A subject line keeps its canonical line (`cutLine`), a subject arc its canonical arc (`cutArc`).",
                 "**Classify** each fragment by a winding query at its midpoint against the other shape (`RayIndex`); a fragment on the shared boundary is decided by orientation. **Stitch** the survivors, drop hairlines, and seal what the walk could not close, counting it (`sealed`, `sealedArea`)."],
    },
    "shp.dropDust": {
        "why": "Says fragments under 1% of the pen are dropped; an erase now passes a view-based bar (a quarter pixel at the zoom the mark was drawn at, `eraseJob.dustBarFor`) that replaces the pen rule (F66, DESIGN.md §7).",
        "what": "Drop the components a cut leaves that are too thin to have been seen: under the erase's view bar, or, with no view, under 1% of the pen.",
        "long": ["`bar` is a quarter pixel at the zoom the mark was drawn at, in the subject's units (`eraseJob.dustBarFor`). A rect cut, or a mark with no recorded zoom, falls back to `pen × DUST_FRACTION` (0.01). Measured by mean width, which is scale-free.",
                 "A set that is dust all the way through is returned whole: deciding an object has gone belongs to the caller (F66)."],
    },
    "shp.pieceToCubics": {
        "why": "Says this is how arcs reach the drawing library, right at every zoom; no production code calls it or `shapeToCubics` — the renderer and the ants plan arcs with `planArc` and `chordCubic` (F40).",
        "what": "One arc as quarter-turn kappa cubics through its centre. Only the tests call it; the renderer plans arcs with `planArc` and `chordCubic`.",
        "long": ["Quarter-turn cubics are 2.7e-4 of the radius off (DESIGN.md §9), measured on screen as 463 px on a re-homed circle one frame up (F40), which is why no render path uses them."],
    },
    "shp.transformLoopsAbout": {
        "why": "Says it subtracts the BOX centre; it subtracts the centre it is given, which `deriveStep` passes as the child cell's centre in the parent's units (`-t/s`), then adds the offset.",
        "what": "The same similarity written so magnification is exact: subtract the cell centre before scaling, then add the offset.",
        "long": ["`(p − c)·f + o`. `p·f + t` and `(p − c)·f` are the same number and not the same computation: the first forms a large product and adds a large offset of the opposite sign, losing the low bits; the second cancels at the parent's scale, then multiplies by a power of two.",
                 "For a point inside the cell the subtraction is exact, so a descent of any depth is a chain of exact steps. `deriveStep` passes no offset (F55), and adding 0 leaves every bit as it was."],
    },
    "shp.flatPieces": {
        "why": "Says it makes a flattened copy of the boundary; it lists every piece of every loop in one array, arcs kept as arcs.",
        "what": "Every piece of every loop in one array — what the winding queries scan, arcs kept exact.",
        "long": ["-"],
    },
    "shp.windingOfFlat": {
        "why": "Says 'from a flattened copy'; the pieces are the shape's own lines and arcs, crossed exactly.",
        "what": "The winding number about a point from a piece list, trying up to eight ray directions until one does not graze.",
        "long": ["Returns null when every direction grazed, so a caller can tell 'on the boundary' from a count. The directions are golden-angle multiples, so a shape built on a grid lines up with none of them."],
    },
    "shp.windingAt": {
        "why": "Says it flattens the shape first; it only gathers the pieces (`flatPieces`) and asks `windingOfFlat`.",
        "what": "The winding number at a point over a loop set, exact on arcs.",
        "long": ["`windingOfFlat(flatPieces(loops), p)`; null when every ray grazed."],
    },
    "shp.rayCross": {
        "why": "Says it counts crossings against a flattened boundary; it crosses the ray with each line and arc exactly — a minor arc at least as large as its chord in its chord frame (`chordLineRoots`), other arcs through the centre.",
        "what": "Signed crossings of one ray with every piece of a boundary, or null when the ray grazes a vertex, a tangency or the boundary itself.",
        "long": ["Lines by a determinant. A minor arc whose radius is at least its chord is asked in its chord frame (`chordFrame`, `chordLineRoots`, `chordHit`), so a query about an arc of radius 5e12 never goes through its centre; other arcs through the centre.",
                 "The grazing band is a few ulps measured off each piece's own magnitude, never off the scene: taken from the scene, an eraser three crossings down made every query graze and the erase removed nothing.",
                 "A chord-frame root counts only if it satisfies the line to 1e-12 of the magnitudes: a ray that misses the arc still gets roots from the first-order quadratic."],
    },
    "frz.markSeamEnds": {"why": "gone", "what": None, "long": None},   # deleted with the seam marks; the freeze's endpoint guard replaces them
    "frz.arcCuts": {
        "why": "Says reading the centre is safe because a line is never chopped and everything is a line by the third crossing; the chop now sends every arc at or over the freeze radius to `chordCuts` (its chord frame), so `arcCuts` only sees arcs under the gate. The row's [divergence] tag rests on the same claim and should be rechecked against §17.",
        "what": "Where an arc under the freeze radius meets one grid line, as parameters along it, computed through its centre.",
        "long": ["Reads the stored centre and radius; each root is kept when strictly inside the piece.",
                 "Only arcs under the gate come here, whose centres are at most about 8.8e12 units away, a float64 step of about a thousandth of a unit. An arc at or over the gate is cut in its own chord frame (`chordCuts`), because it is about to freeze and the level below inherits its cut points (DESIGN.md §5)."],
    },
    "frz.chopFreezeLoops": {
        "why": "Says the render chain is its only caller and the erase never runs it (the divergence), and that a seam-marked piece is never frozen. The erase's descent derives each level through `deriveStep` too (eraseDescent.js), the seam marks were deleted, and the freeze is the one-radius gate with the endpoint guard.",
        "what": "The chop and the freeze: cut every arc on the object's own grid lines, then freeze each fragment at or over the freeze radius to its chord.",
        "long": ["Only arcs are chopped: a line cut on a grid line is two pieces of the same line. Arcs under the gate are cut through the centre (`arcCuts`), arcs at or over it in their chord frame (`chordCuts`, `chordPt`), so the cut points the level below inherits never go through a far centre.",
                 "**The gate** (DESIGN.md §5): radius at or above `freezeRadius(tol)`, and both ends between the outermost grid lines this pass applied, with slack for the centre's own rounding. A stub beyond those lines was not cut at every line crossing it and passes through unmeasured.",
                 "A cut arc (F43) is chopped as its canonical arc would be and each fragment trimmed to the piece's stretch; where the canonical fragment freezes, the piece becomes a cut line on its chord (`settleCut`).",
                 "Called only from `deriveStep`, which the tile store and the erase's descent both run. Changing where a cut lands moves every saved drawing's deep picture by 4096 per level (the compatibility note on `deriveStep`)."],
    },
    "frz.pieceSagitta": {
        "why": "Says it is what fires the freeze ('by the time a curve is straight enough for this to fire'); the freeze is now the radius gate, and this only bounds the chop's conservative box.",
        "what": "How far a piece bulges from its own chord, radius-free: `chordMath.sagittaOf` on the piece's ends and sweep.",
        "long": ["`(chord/2)·|tan(sweep/4)|`; 0 for a line, Infinity over half a turn. The chop grows a chord's box by it to bound a piece's extent without the centre.",
                 "The rasteriser's flattener uses the same expression (`chordMath.test.js` M2 asserts the two are bit-identical)."],
    },
    "der.shapeLoopsInRect": {
        "why": "Its long says it marks the ends the seam overhang made (the marks were deleted; nothing is marked). The row also says nothing along the chain is ever frozen, but `deriveStep` chop-freezes before this clip.",
        "what": "The same clip handing back arcs, so what a tile holds — and the next level inherits — stays exact.",
        "long": ["One outline's contribution to one tile as arc loops, with `shapeRingsInRect`'s two fast paths: nothing reaching the tile is settled by one winding query (a covering quad or nothing), and a shape wholly inside comes back unclipped. Works local to the tile and translates back.",
                 "A tile is built from its parent's tile, so a polygon here would become the object one level down: measured before arcs were carried, a 42-arc stroke became a 793-point polygon one level down and a five-point one two levels down, its painted edge 263 px out.",
                 "Clipping an exact arc gives an exact sub-arc, so the clip adds no approximation; the only change of representation along the chain is the freeze in `chopFreezeLoops`."],
    },
    "der.bandRings": {
        "why": "Says ordinary strokes take an offset over the whole centreline (Clipper) and only magnified ones the analytic strip. `deriveStep` passes `legacyOffset: cfg.fatWidthPx == null`, false in the engine (fatWidthPx 4000), so every band is the windowed analytic strip; the Clipper branch serves only configs without fatWidthPx (the V0 comparisons).",
        "what": "The one place a stroke's painted band becomes rings: the centreline windowed and offset by the analytic strip.",
        "long": ["Flattens a curved centreline (only the annulus that can shape the window, when the stroke is magnified far past it), optionally decimates, clips it to the window and offsets each run with `strokeStripNear`, clipping the rings to `clipRect`. Works relative to an origin at the window's centre. Called by `deriveStep` for strokes over the size gate.",
                 "Under `legacyOffset`, and not magnified, it offsets the whole centreline with Clipper instead (`strokeOutline`) — the V0 path, which the engine's config never takes. That offset goes quadratic in self-intersections (one 1,321-point stroke measured 583 s).",
                 "For a magnified curve the flatten window must be the clip rectangle, not the width-grown one: grown, the prune collapses and the recursion runs away (measured: millions of nodes, out of memory)."],
    },
    "der.deriveStep": {
        "why": "Says the shape is transformed about the box centre; it cancels against the child cell's centre (`c = -t/s`) through `transformLoopsAbout`.",
        "what": "One step of the chain, and the only place the chop and the freeze happen: transform about the cell centre, chop and freeze on the object's grid, clip to its tiles grown by the seam pad, size-gate wide strokes into bands.",
        "long": ["One step of the magnify chain: every parent object's contribution to one child tile.",
                 "**Culls** on the transformed box before any geometry. **Transforms** a shape about the child cell's centre (`transformLoopsAbout`), so magnification is exact; no move offset enters the hop (F55).",
                 "**Chops and freezes** on the object's own tile grid (`chopFreezeLoops`) and **clips** to the object's own tiles grown by the seam pad, never to the cache square, so two squares holding the same stretch hold the same bits. The tile window comes from the bare square.",
                 "**Size-gates strokes**: wide ones become bands (`bandRings`), the rest stay strokes with their centreline clipped past the padded tile. The tile store and the erase's descent both run it; every deep picture in a saved drawing is derived here, so a change is a compatibility event (the note above the function)."],
    },
    "las.rectInsidePolygon": {
        "why": "Says it is the selection test and the known gap (a slanted stroke whose box corners poke out is skipped). `_lassoFind` now asks the ink (`loopTester`, `_inkInsidePolygon`) whenever the box test fails and the boxes meet (F32), so this is the fast accept, not the whole test.",
        "what": "Is an upright rectangle wholly inside the loop? The lasso's fast accept for a frame or an object's box; the ink is asked when it fails.",
        "long": ["Exact, not a corner test: one corner inside (even-odd) plus no loop edge crossing or lying inside the rectangle (`polygonMissesRect`). For a concave loop all four corners can be inside while the boundary dips through the middle.",
                 "A frame whose box it accepts is taken whole; an object it rejects is tested on its ink when its box meets the loop's box (`selection._inkInsidePolygon`, F32)."],
    },
    "cvo.loopsBbox": {"why": "gone", "what": None, "long": None},   # renamed `cubicLoopsBBox` (described in this batch)
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]

# ---- 2026-10-05, the rebuilt tree ----
add("off.homeTranslation", "homeTranslation(below)",
    "A table's whole translation at the home depth, in home units — its whole frames and its remainder — or null when it has none.",
    ["-"], "§8")
add("off.ownTranslation", "ownTranslation(o)",
    "A native's own table's translation at its home (k = 0), without its frame's shift; null when it has none.", ["-"], "§8")
add("off.pictureTable", "pictureTable(o, shift)",
    "A native's picture table given its home frame's shift: its own table composed with the shift (A1 C1).", ["-"], "§8")
add("off.ownTableOf", "ownTableOf(o)",
    "A copy of a native's own table, as a piece cut from it or an undo entry keeps it; undefined when it has none.", ["-"], "§8")
add("off.ownTableFor", "ownTableFor(T, shift)",
    "The own table a native homed in a frame with `shift` must carry to be drawn with picture table T: T less the shift, so new ink and a ceded kid are drawn where they were put (A1 C1).",
    ["A copy. The one helper of `Document.ownFor` and the descent's kids (PLAN §5.14 item 4)."], "§8")
add("off.composeShift", "composeShift(below, shift)",
    "A native's picture table (A1 C1): its own table with its home frame's shift added at k = 0, without a carry, so the sum may reach a frame and a half; the table itself when the frame has no shift.",
    ["Exact: both terms are multiples of 2^-10 under 2^18. The shift is placement, composed on read and never written into the table (DESIGN.md §8)."],
    "§8")

# ---- 2026-10-05, the rebuilt tree ----
add("arc.sameCircle", "sameCircle(p, q, tol)",
    "Whether two arcs lie on one circle, to `tol` in centre and radius; lines never do.", ["-"], "§5")
add("arc.samePiece", "samePiece(p, q, tol)",
    "Whether two fragments between the same two vertices are the same curve travelled the same way — so an exact retrace's overlap is kept once.",
    ["-"], "§5")
add("arc.verdict", "Oracle.verdict(x, y, r, margin, src)",
    "The burial test's three-way answer for a point of the perimeter: 2 when it is inside the pen by more than the margin (buried); 1 when it sits within the margin of r from a stretch of the centreline other than its own arc and its neighbours (a tie: an exact retrace, or a copy peeling off tangentially); else 0.",
    ["A tie is kept for now and pruned later if it dead-ends (`_pruneTies`, OPEN-FLAGS F89; DESIGN.md §5)."], "§5")
add("arc._overlapCuts", "ArcBakeJob._overlapCuts(i, j, eps)",
    "Two arcs on one circle — a stroke retracing itself exactly (F89): each is cut at the other's ends that fall inside it, at those ends' own vertices, so the overlap splits into identical fragments the classification keeps once.",
    ["-"], "§5")
add("arc._pruneTies", "ArcBakeJob._pruneTies()",
    "Marks used every kept tie that dead-ends at both its vertices — the far side of a copy that peels off tangentially inside the other lap by less than the margin — so the restitch never takes it and leaves no open chain (F89).",
    ["O(kept), and run only when a tie was kept at all. So the union has winding 1 everywhere (DESIGN.md §5)."], "§5")
add("shp.insideTester", "insideTester(loops)",
    "`insideShape` for many points of one shape: its pieces indexed once, each point one bucket scan (EFF-2).", ["-"], "§6")
add("bia.closeLoop", "BiarcPen.closeLoop()",
    "A stroke that ends exactly where it began is periodic: its seam gets the handle an interior sample would, so the first and last gaps leave and arrive with one tangent and the rails' seam arcs end on their own circles (F117); returns whether it changed anything.",
    ["The live pen treats the stroke as open; the resolve calls this once. The two one-sided tangents differed by ~3e-4 rad and left four seam arcs up to 0.039 units off their circles, which the inside test read as two crossings (DESIGN.md §5)."],
    "§5")
