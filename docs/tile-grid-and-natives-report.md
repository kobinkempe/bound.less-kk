# Tile grid + deep-detail behavior — report

> **⚠️ Partially overridden by the new design in `local-frames-design-bible.md`
> (2026-07-14).** The claim below that "tile coordinates stay bounded per level, so
> wide panning is precision-safe" is **false**: a pan of D units at a coarse level
> becomes D×3000^k in a level k deeper, and one measured dance put the view at
> 2.1e17 units, where float64 quantizes pen input to a 42px grid. Levels are being
> replaced by a tree of locally-anchored frames ("K-groups"); the per-frame tile
> mechanics described here otherwise remain accurate.

**Branch:** `v2` · **File:** `src/engine/KobinEngineV0.js` · Commits `7e66a06` (tiles), `daadd10` (world-anchored natives)

Covers four asks: (1) deeper levels rebake the polygonized shape, (2) deep detail
stales when zoomed out, (3) the per-level tile grid, (4) world-anchoring natives.

## 1. Deeper levels rebake the polygonized object, not the original ✅

`_crossUp` only ever reads `this._objs()` (the *current* level's objects), so once a
stroke polygonizes to a `fill` at level 1, every deeper level rebakes *that* polygon.
Verified by tracing one stroke through three crossings: `stroke → fill → fill → fill`,
same `id`, `hasPts:false` throughout, geometry = the level-1 polygon transformed +
re-clipped to the window at each level. It never re-outlines the original stroke.

## 2. Deep detail stales when zoomed out, and is remembered ✅

Already handled by the level model; verified. A detail drawn at level 1 is **not in
the active level once you cross down**, so it isn't calculated (it lives dormant in
`nativesByLevel[1]` with unchanged points). Crossing back up re-includes it. Staling
is whole-level: everything below the active level is dormant.

## 3. Per-level tile grid (KGroup map) ✅

Replaced the single fixed window per level with a fixed tile grid baked on demand.

- A tile is one screen in the level frame; right after a crossing the screen is tile
  `(0,0)`. Tiles are keyed by integer `(i,j)` in `this.tiles[level]`.
- `_crossUp` records the frame `{s,t}`, resets to base, then `_ensureTiles()` bakes the
  visible tiles (+1 ring) around the new view.
- `_bakeTile` derives a tile by transforming the parent objects into the level frame
  (`(p·s+t)/base`) and clipping to the tile rect (size gate applies). Level 1's parent
  is the complete originals; deeper levels recurse (`_ensureTilesForRegion`) to bake the
  parent tiles covering the tile's pre-image first.
- `zoomAt` / pan fault in tiles entering view (re-render only when a tile actually
  bakes). `_crossDown` discards the level's tiles.
- Tile coordinates stay bounded per level, so wide panning is precision-safe; only
  crossings rebase (~×3000).

**Seams:** strokes clip to tile ± width (clip-end caps fall off-tile; opaque pieces
overlap → seamless), fills clip to the exact tile rect (adjacent tiles abut, no gap or
double-up).

**Both target scenarios solved (tested in Chrome):**

- **(a) Pan along a deep line** — tiles faulted in 16 → 36 as we panned; geometry stayed
  present at the new view center; the diagonal line stayed continuous instead of running
  off into blank.
- **(b) Zoom out, then zoom in elsewhere** — zoomed out to level 0 (single original),
  zoomed in at a different point → level re-established with a *new* frame and the line
  re-derived correctly at the new spot.

Regression: deep up/down keeps level-0 originals byte-identical; loop-hole outline and
K-debug still work.

## 4. World-anchored natives ✅

A native drawn at level ≥1 was stored only in that level's (crossing-dependent) frame, so
returning via a different crossing misplaced it. Fix:

- At draw (`pointerUp`), store the native's **world (level-0) coords** `wpts` + world
  width `wlw`, via the inverse of the cumulative `_worldToLevel(level)` transform.
- On every `crossUp`, `_reprojectNatives(level)` re-places each native's `pts`/`lwFrame`
  from its `wpts` into the current frame. Level-0 natives have no `wpts` → never touched
  (originals stay drift-free).

**Verified:** a detail drawn at level 1 keeps **identical world coords** after a
zoom-out / zoom-in-at-a-different-point round trip (the old code would have shifted it
~1.5 world units ≈ hundreds of screen px at depth). Visually, a red detail drawn *above*
the line still sits above the line when navigated back to after re-entering elsewhere.

## Known limitations / follow-ups

- **Deep-level precision:** re-projecting a native multiplies its stored world error by
  `a ≈ 3000^level`, so positions degrade past ~level 5. Fine for practical depths; a
  tile-relative anchor (integer tile index + local coord) would remove the cliff.
- **Deep-crossing cost:** a tiled crossing bakes ~N tiles (vs the old single window), and
  large strokes polygonize per tile at a fine tolerance — so a level-2+ crossing is
  heavier than before. Candidates: cache baked tiles across crossings, coarser bake
  tolerance, or a Web Worker for Clipper.
- **Native culling:** natives aren't tile-culled (always in the render list); fine for a
  few, needs a spatial index for many.
