# Seamless translucent paths across tile edges — options

**Status:** discussion / recommendation. Per-stroke opacity + the opacity slider already
ship; this is about how to clip a *non-opaque* path so its tile pieces look seamless.

## The problem

A path that spans tiles is stored as one piece per tile. For **opaque** paths the pieces
can overlap harmlessly (strokes are clipped to tile ± width so adjacent pieces overlap;
the overlap is invisible because it's the same solid colour). For **translucent** paths
(opacity < 1) the split becomes visible:

- **Overlapping pieces** → the overlap region blends twice → a darker line at the seam.
- **Exactly abutting pieces** → each piece is anti-aliased along the shared edge, so the
  two AA fringes either sum to a faint double-line or leave a 1px hairline gap.

Either way you get a visible grid of seams once opacity drops below 1. The fix must make
the union of the pieces render *exactly* as the un-split path would: every pixel covered
once, at the right alpha, with consistent AA at the seam.

## Options

### A. Exact-abut + crisp seam edges
Clip every piece to the exact tile rect (no overlap) and disable AA on the path
(`shape-rendering: crispEdges`). Tile seams are axis-aligned, so killing AA there is
acceptable.
- **Pros:** minimal change (fills already abut).
- **Cons:** `crispEdges` disables AA for the *whole* path, not just the seam — curved/diagonal
  edges of the shape get jaggy. Doesn't help strokes (a clipped centerline gets a round
  cap → bulge). Rejected as a general solution.

### B. Per-object opacity GROUP, full-opacity pieces  ← recommended
Render all pieces of one object (across its tiles) at **full opacity** inside a single
group whose **group opacity** is the object's opacity. Keep pieces slightly **overlapping**
(strokes ± width as today; fills with a small overlap margin instead of exact-abut).

Why it works: SVG/Canvas group opacity is *isolated* — the children are composited
together first (overlapping opaque pieces just union, no double-blend), and the group's
opacity is applied **once** to the flattened result. So the overlap guarantees full
coverage (no gap/hairline) while the group opacity prevents the doubled-alpha seam. Object
-to-object blending is still correct because each object is its own group.

- **Pros:** correct and cheap — no Clipper at render; overlap removes gaps; group opacity
  removes double-blend; works for strokes *and* fills. Two.js maps a `Two.Group` with
  opacity to `<g opacity>`, which isolates as required.
- **Cons:** rendering must group visible pieces by object id (one `<g>` per translucent
  object) rather than a flat list; group opacity creates an offscreen compositing layer
  per translucent object (fine for a handful; watch it if thousands are on screen).

### C. Union-on-render
Keep tiles as the cache, but at render time Clipper-union the visible pieces of each object
into one path and draw that once.
- **Pros:** a single path per object → inherently seamless, minimal DOM.
- **Cons:** a Clipper union every render/pan (expensive — the thing we just optimised away);
  strokes must be outlined first to union. Too costly for interactive pan/zoom.

### D. Don't split translucent objects
Render a translucent object whole (clipped only to the viewport), not per tile.
- **Pros:** no seam at all (one path).
- **Cons:** loses the per-tile coordinate bounding that keeps deep zoom precise; fine for
  small/native translucent marks, breaks for large inherited translucent fills at depth.
  Usable only as a hybrid (small → whole, large → option B).

## Recommendation

**Option B (per-object opacity group with overlapping pieces).** It's the only one that is
both correct for strokes and fills *and* cheap at render time, and it reuses SVG's built-in
group-opacity isolation rather than fighting the rasterizer. Concretely:

1. When rendering a level, group the visible pieces by object `id`.
2. For each object, make a `Two.Group`; set its opacity to the object's opacity; add every
   piece at **full** opacity.
3. Give fills the same small overlap strokes already use (clip to tile + margin) so pieces
   cover the seam; keep storage/seam-exactness for the cache as-is.

Fallback if per-object grouping proves heavy: **D for small objects, B for large**.

I'd start with B behind the existing opacity path and test with the red/black method (draw
a translucent stroke across a tile seam, confirm uniform alpha — no darker line, no gap).
