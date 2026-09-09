/**
 * types.js — the geometry vocabulary, as JSDoc typedefs (S3, 2026-09-07).
 *
 * Not a TypeScript migration. These are the eight or so shapes that get
 * confused, written down once so that a function can say which one it takes,
 * and `npm run typecheck` (tsconfig.geometry.json: `checkJs` over
 * src/engine/geometry and frameLattice.js only) can object when it is handed
 * the other one. `Rect` versus `BBox` alone pays for the file: both are four
 * numbers, both live in the engine, and `asRect()` exists in connect.js
 * precisely because they get mixed up.
 *
 * Nothing imports this module for its code; a file that wants a type says
 * `@typedef {import("./types").Rect} Rect` at its top, or names the type inline
 * as `import("./types").Rect`. The file is empty at runtime.
 */

/**
 * A straight piece of a loop, A to B. A CUT line (F43) also carries the
 * canonical line it was cut from — `P`, `Q` — and its extent as positions
 * `sa`, `sb` along it, so that every cut below is recomputed from `P`/`Q` and
 * never from the rounded ends.
 * @typedef {object} LinePiece
 * @property {true} line
 * @property {Pt} A
 * @property {Pt} B
 * @property {number} [src]   which source stroke the piece came from
 * @property {number} [ci]    the chain index, while a perimeter is being stitched
 * @property {number} [rl]    the ring it belongs to, likewise
 * @property {Pt} [P]         canonical line start (cut lines only)
 * @property {Pt} [Q]         canonical line end
 * @property {number} [sa]    position of A on P→Q, in [0, 1]
 * @property {number} [sb]    position of B on P→Q
 */

/**
 * The canonical arc a CUT arc was cut from (F43): its own angles and its own
 * end points, never reversed — a piece travelling it the other way says so
 * with the sign of its own sweep (`arcDir`).
 * @typedef {object} CanonArc
 * @property {number} a0
 * @property {number} sweep
 * @property {Pt} A
 * @property {Pt} B
 */

/**
 * A circular arc piece: centre, radius, start angle and signed sweep, plus
 * its end points carried as points (a point on a circle of radius 1e16
 * computed through the centre is quantised by units). A cut arc adds `K` and
 * its positions `ua < ub` on K, in K's direction.
 * @typedef {object} ArcPiece
 * @property {false} line
 * @property {Pt} C
 * @property {number} r
 * @property {number} a0
 * @property {number} sweep
 * @property {Pt} A
 * @property {Pt} B
 * @property {number} [src]
 * @property {number} [ci]
 * @property {number} [rl]
 * @property {CanonArc} [K]
 * @property {number} [ua]
 * @property {number} [ub]
 */

/** @typedef {LinePiece | ArcPiece} Piece */

/**
 * A closed chain of pieces: `loop[i].B` is `loop[i+1].A` and the last piece's
 * B is the first piece's A, BIT FOR BIT — consecutive pieces share the end
 * point array, which the file format and the stitch rely on.
 * @typedef {Piece[] | import("./loop").Loop} Loop
 */

/**
 * A set of loops normalised so that solid area is positive (outer loops
 * counter-clockwise, holes clockwise). `Loop[]`, and not a `Ring[]`.
 * @typedef {Loop[]} Shape
 */

/**
 * A loop while it is being built: the stitch (arcPerimeter) and the boolean's
 * walk (arcShape) hang whether it closed, and its measurements, on the array
 * itself.
 * @typedef {Piece[] & { closed?: boolean, area?: number, per?: number }} Chain
 */

/**
 * A point, `[x, y]`.
 * @typedef {number[]} Pt
 */

/**
 * A polygon: a list of points, closed implicitly. NOT a Loop — a ring has no
 * arcs and no piece structure, and the two are the reason this file exists.
 * @typedef {Pt[]} Ring
 */

/**
 * A rectangle by its edges. The tile and window vocabulary — `objTileRect`,
 * `TileGrid.rect`, `clipShapeToRect`, `padRect` — speaks this one.
 * @typedef {object} Rect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * A rectangle by its corners. The bounding-box vocabulary — `loopsBBox`,
 * `bboxOf`, `pieceBBox`'s object form — speaks this one. Both are four
 * numbers; a `Rect` handed to something expecting a `BBox` reads `undefined`
 * for every field and fails silently as "empty".
 * @typedef {object} BBox
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/**
 * A half-open range of tile indices, `i0..i1` and `j0..j1` inclusive of both
 * ends as INDICES (the half-openness is in which tile a boundary point
 * belongs to — `TileGrid.range`).
 * @typedef {object} Cells
 * @property {number} i0
 * @property {number} i1
 * @property {number} j0
 * @property {number} j1
 */

/**
 * The phase of an object's tile grid: a point of [0, W)², the offset of the
 * grid's origin from the frame's. `[0, 0]` is the cache's grid.
 * @typedef {number[]} Phase
 */

/**
 * A frame's id — a path of cell digits from the root, e.g. `"0/12,9/768,-715"`.
 * @typedef {string} FrameId
 */

export {};
