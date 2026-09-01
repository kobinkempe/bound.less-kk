# -*- coding: utf-8 -*-
TREES = []

TREES.append(("pen", "Drawing a stroke", """
pointerDown(sx, sy) | fac | the public entry, timed at the boundary
  _pointerDown | fac
    cam.screenToFrame | spc | pixels -> this box's coordinates
    doc.allocId | obj | id = creation order = drawing order
    _startPen | fac
      new BiarcPen | obj | tolerance set by the zoom it is drawn at
        addSample | obj
          splineCubics | obj | the app's own spline through the samples
          arcsForGap | obj | subdivide until the arc pair is in tolerance
            biarc | obj | two arcs, both end directions fixed
              arcThrough | obj
            gapError | obj
    doc.add(o, frame, live) | obj | live: stays out of the spatial index
      _emit -> TileStore._onDoc | spc | ignored while still growing
    renderer.addLive | spc
    renderer.setLiveArcs | spc
      pushGapAnchors | spc
        pieceToCubics | obj | arcs -> curves; the library speaks nothing else
    renderer.update | spc
pointerMove(sx, sy) | fac
  _pointerMove | fac
    cam.screenToFrame | spc
    o._pen.addSample | obj | O(1): only the last two gaps are rebuilt
    renderer.setLiveArcs | spc | the pen's own chain is what gets painted
    renderer.update | spc
pointerUp() | fac
  _pointerUp | fac
    _note | fac | journal the gesture before pts is dropped
    renderer.endLive | spc
    doc.finalize | obj | geometry is immutable from here
      _emit -> TileStore._onDoc | spc
        _addObject | spc
          _appendUp | spc | patch tiles that inherit it magnified
          _appendDown | spc | ...and the ones that inherit it minified
    _queueBake | fac
      new ArcBakeJob | obj | handed the pen's chain: phase 1 already paid
    _scheduleBake(0) | fac | -> Fig 2, the bake tick
    doc.pushUndo | obj | one gesture, one action
    _noteInkAdded | fac | provisional scene assignment
    _render | fac | -> Fig 5
    _queueIdleFits | fac | prefit outlines off the pen-up frame
"""))

TREES.append(("bake", "Resolving strokes, and folding in erasers", """
_bakeTick | fac | a timer, not a frame; re-entered until the queues drain
  _bakeTickInner | fac
    _camBusy | fac | stand aside while the camera moves, up to 1.5 s
    _ensureShapeBakes | fac | nothing is ever left raw for ever
      _queueBake | fac
    _stepShapeBakes | fac | 8 ms slices
      job.step(budgetMs) | obj | ArcBakeJob: every phase resumable mid-item
        _centerline | obj | BiarcPen.addSample, chunked
        _chain | obj | ChainBuilder.step
          offsetArc | obj | THE exact offset: a concentric arc
          cap | obj | a half-turn end cap
        _oracle | obj | Oracle.fill -> pieceBBox, Grid.insert
        _precull | obj | Oracle.buried -> arcDist  (exact, no flattening)
        _cut | obj | split the chain at its own crossings
          Grid.near | obj | broad phase
          pieceIntersections | obj
            circleCircle | obj | rewritten for extreme radius ratios
            circleSegment / segSeg | obj
          paramOf | obj
          VertexSet.id | obj | ONE identity per crossing point
        _classify | obj | keep what the pen does not cover
          subPiece | obj
          Oracle.buried | obj
        _stitch | obj | walk the survivors into closed loops
        _finishPhase | obj | hairlines, one handedness, junction balance
      _sealed | fac | an outline that will not close is sealed, and counted
        repairLoops | obj | stitch fragments, bridge, seal once, drop dust
      doc.bakeShapeById | obj | the stroke BECOMES its outline, same id
      _promoteOversize | fac | invariant 2: too wide -> promote a level
        Document.scaleGeometry | obj | divide by 4096: a change of units
        doc.rehomeById | obj
    _eraseStrokes | fac | eraser gestures whose own outline has resolved
    _nextEraseTarget | fac
      _eraseMayTouch | fac | project the eraser's BOX, not its geometry
        lm.mapRectF | spc
    _bakeOne | fac | -> Fig 3
    _noteSpent | fac | if a mark cut nothing, record what it looked at
    doc.removeById | obj | the white mark has served its purpose
    _render | fac | -> Fig 5
"""))

TREES.append(("erase", "Erasing: the cut", """
_bakeOne(Erec, target) | fac
  _forceBake | fac | both operands must be resolved outlines
    bakeArcPerimeter | obj
  doc.fillToShapeById | obj | a pre-arc drawing, promoted where it pays
  lm.framePath | spc | a pure descent, or a different branch?
  _bakeRehome | fac | target is COARSER -> descend  (-> Fig 4)
  lm.projectF | spc | otherwise cut in place: bring the eraser here
    transformLoopsAbout | obj | cancel against the centre, THEN scale
  transformLoops | obj | work local to the SUBJECT, not the frame origin
  subtractShape | obj
    shapeBoolean | obj | one retry at a different welding radius
      shapeBooleanOnce | obj
        normalizeLoops | obj | one handedness; solid area positive
        straighten | obj | an arc finer than its own numbers IS a line
        loopBBox / bbHit | obj | untouched loops pass straight through
        Grid.insert / Grid.near | obj
        pieceIntersections | obj | -> circleCircle
        pieceOverlap | obj | shapes lying exactly on each other
          onCurveOf | obj
        windingOfFlat | obj | inside or out, by ray cast
          rayCross | obj | detects its own ambiguity and retries
        stitch | obj | pair ends by angle, then walk the cycles
        dropHairlines | obj
  _noteSeal | fac | count the booleans that had to be sealed
  _cull | fac
    dropDust | obj | thinner than 1% of the pen: not an object
  shapeComponents | obj
  doc.eraseReplaceById | obj | one region keeps the key; several is a split
  _resplitFamily | fac | did the OBJECT come apart?
    _familyComponents | fac | members are nodes; doorways are the edges
      _inkOutline | fac
        flattenShape | obj
      lm.mapRectF | spc | the doorway, in the other member's frame
      contactArcs | hlp | where ink meets the doorway, as intervals
        sidesOf / tOn / merge | hlp | perimeter 0..4, never wrapped
      arcsTouch | hlp | THE severance test
      Groups.union / classes | hlp | union-find
"""))

TREES.append(("descent", "Erasing below an object's own level", """
_bakeRehomeInner | fac | one crossing at a time; only the last one cuts
  lm.framePath | spc
  loopsBBox | obj | the eraser's own footprint
  lm.mapRectF | spc | where the erase lands in THIS frame
  childTilePhase | hlp | the object's grid, one level down
  objTileRange | hlp | which of ITS tiles the erase reaches
  objTileRect | hlp | ...and the block those tiles span
  _inkShapeInRect | fac | the parent's ink inside that block
    lm.projectF | spc | ONE bounded hop, never a composed jump
    transformLoops | obj | local to the rect
    clipShapeToRect | obj | exact: an arc clipped is a sub-arc
  _cull | fac
    shapeComponents | obj
    dropDust | obj | a degenerate graze is not a native
  subtractShape | obj | LAST step only: eraser and ink now comparable
  _noteSeal | fac
  doc.cedeTileById | obj
    translateLoops | obj | local to the rect, again
    rectLoop | obj | the doorway, as an outline
    subtractShape | obj | cut the tile OUT of the parent, exactly
    dropDust | obj | a sliver along the rect edge is dust
    shapeComponents | obj | the parent may fall into pieces
    doc.removeById / doc.add | obj | remnant stays; the tile's ink goes down
  _resplitFamily | fac | -> Fig 3
"""))

TREES.append(("render", "Rendering a frame", """
_render | fac
  _buildList | fac
    cam.frameWindow | spc
    store.content(F, win) | spc | every tile covering the view
      _ensureUp -> _bakeUp | spc | COARSER ink, magnified
        _ensureUp (parent) | spc | the chain: one level at a time, recursive
        doc.at(parent) | obj
        _ringNatives | spc | the uncle: the eight neighbouring boxes
          lm.peekRing | spc | never mints a box just from looking
          doc.queryRect | obj
          lm.projectF | spc
        classifyUp | hlp | empty / solid / edge
        solidQuad | hlp | a flooding object becomes 4 corners
        deriveStep | hlp | ONE step of the chain
          transformLoopsAbout | obj
          childTilePhase | hlp | the object's grid, carried down
          tileWindow / tileClipRect | obj | its tiles, not the cache square
          chopFreezeLoops | obj | THE CHOP AND THE FREEZE
            pieceSagitta | obj | bulge from local values; no centre
            arcCuts | obj | reads the stored centre  (D1 not built)
            subPiece / freezePiece | obj | the chord between its OWN ends
          shapeLoopsInRect | hlp | the clip that HANDS BACK ARCS
            clipShapeToRect | obj
            markSeamEnds | obj | the overhang is not the object's edge
          bandRings | hlp | a stroke's painted band -> rings
            strokeStripNear | hlp | analytic, magnification-independent
            strokeOutline | hlp | the ordinary offset
      _ensureDown -> _bakeDown | spc | FINER ink, minified in one jump
        projectedSizePx | hlp | measured at the level's deepest zoom
        lm.projectF | spc
        _downPieces | spc | flattens to polygons  (safe: it is a leaf)
          shapeRingsInRect | hlp | clip first, flatten after
            flattenShape | obj
    store.ownContent | spc | YOUR level's objects: a plain read
    doc.getById | obj | family key, for grouping
  renderer.render(list, level) | spc
    _activateLevel | spc | swap in this level's retained subtree
    _maybeReorigin | spc | re-anchor if the view drifted too far
    _sig | spc | same signature -> reuse the paths
    _buildPieces | spc
      _buildInto | spc
        pushShapeAnchors | spc
          shapeToCubics -> pieceToCubics | obj
        pushGapAnchors | spc | a stroke drawn but not yet resolved
        _fatPolys -> strokeLoops | hlp | very wide strokes, as outlines
      _addFillPath / _addShapePath | spc
        mkPath | spc | never hand the library an unbounded array
    _applyThinScale | spc | rescale features too small for the rasterizer
    _applyOpacity -> _fade | spc | continuous fade across the sub-pixel cull
    syncWorld | spc | fold the scene origin in, in full precision
  renderer.update | spc
  _emit | fac
"""))

TREES.append(("camera", "Zooming and panning", """
zoomFactorAt(sx, sy, f) | fac | zoomAt and pinchUpdate both land here
  frameMeter.poke | fac
  cam.zoomFactorAt | spc
    hooks.finalizeLiveStroke | fac | a crossing finalizes the live stroke
    _settle | spc | cross and shift until the camera is LEGAL
      _maybeShift | spc | the view left its box: step sideways
        hooks.holdFrame | fac | never under the pen
        cam.centre | spc
        lm.neighbour | spc
          carryDigit | hlp | out of range: carry up to the parent
          cellChild | spc
      _crossUp | spc | into the child box the view centre falls in
        lm.ensureChild | spc
          _viewCell -> cellOf | hlp | a ROUND, not a floor
          cellChild | spc
            cellEdge / cellCentre | hlp | exact: powers of two
      _crossDown | spc | into the box that contains this one
        lm.ensureParentEdge | spc
          _growRoot | spc | grow a coarser box above the root
  _visibleChanged | fac | did the visible tile set change?
    lm.tileRange | spc
  renderer.needsRebake | spc
  renderer.needsFatFlip | spc | a wide stroke approaching the gate
  renderer.needsFadeFlip | spc | a piece crossed the fully-present line
  renderer.needsReorigin | spc
  _render | fac | if anything above said yes  (-> Fig 5)
  renderer.syncCameraOnly | spc | otherwise: ONE transform, no rebuild
  _maybePrebake | fac | warm the next level's tiles while idle
  _queueIdleFits | fac
"""))

TREES.append(("select", "Selecting and moving", """
_pointerDown (select) | fac
  _hitTest | fac | pressed on ink?
    _shapeHit -> insideShape | obj
    distToPolyline | hlp
  _lasso = { pts } | fac | pressed on paper: start a loop
  select -> _setSelection | fac
    doc.editGroup | obj | the whole family comes too
  _settleSelectionErases | fac | never drag out from under an unbaked mark
    _flushErasesFor -> _bakeOne | fac
  store.setBatch(true) | spc | off-screen tiles: drop, do not patch
_pointerMove (drag) | fac
  _dragSelection | fac | recomputed from where the drag STARTED
    _selectionMembers | fac
      doc.editGroup | obj
    lm.frameFactor | spc | member coarser than the camera: plain translation
    lm.displaceFrame | spc | member DEEPER: address arithmetic
      displacementDigits | hlp | the move, in base 4096
      applyDigits | hlp | add to the address, with carries
        carryDigit | hlp
      lm.neighbour | spc | a carry off the coarse end is a real move
      frameAtChain -> cellChild | spc
    doc.rehomeById | obj | whole boxes: a change of ADDRESS, no geometry
    doc.setGeometryById | obj | only the sub-box leftover reaches geometry
      Document.translateGeometry | obj
        translateLoops | obj
  _render | fac
_pointerUp | fac
  _normalizeHome | fac | put it back inside its own box (invariant 2)
    lm.neighbour | spc
    doc.rehomeById / doc.moveById | obj
  doc.pushUndo(moveMany) | obj | one drag, one action
  _applyLasso | fac
    _lassoFind | fac | a TREE query, walking out from the active box
      doc.queryRect | obj | only boxes straddling the loop ask per object
      _rectInActive -> lm.mapRectF | spc
      rectInsidePolygon | hlp | tests the upright rect  (a known gap)
  store.setBatch(false) | spc
"""))
