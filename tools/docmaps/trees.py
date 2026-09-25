# -*- coding: utf-8 -*-
"""The Call Map's figures: `display | nodes | note`, two spaces per level (gen.py
says what the fields mean). `check.py` proves every parent-child pair is a call
the source makes, so a tree that goes stale fails the check rather than the
reader."""
TREES = []

TREES.append(("pen", "Drawing a stroke", """
pointerDown(sx, sy) | eng.pointerDown | the public entry, timed at the boundary
  _pointerDown | eng._pointerDown
    cam.screenToFrame | cam.screenToFrame | pixels -> this frame's coordinates
    doc.allocId | doc.allocId | id = creation order = drawing order
    _startPen | eng._startPen
      new BiarcPen | bia.BiarcPen | tolerance set by the zoom it is drawn at
    doc.add(o, frame, live) | doc.Document.add | live: stays out of the spatial index
    renderer.addLive | rr.addLive,rnd.addLive | the live stroke stays SVG on both renderers
    renderer.setLiveArcs | rnd.setLiveArcs
      pushGapAnchors | rnd.pushGapAnchors
        pushArcPiece | rnd.pushArcPiece | an arc command, or kappa cubics from its chord
pointerMove(sx, sy) | eng.pointerMove
  _pointerMove | eng._pointerMove
    cam.screenToFrame | cam.screenToFrame
    o._pen.addSample | bia.addSample | O(1): only the last two gaps are rebuilt
      controlsFor | ply.controlsFor | the same tangents the cardinal spline has
      arcsForGap | bia.arcsForGap | subdivide until the arc pair is in tolerance
        biarc | bia.biarc | two arcs, both end directions fixed
          arcThrough | bia.arcThrough
        gapError | bia.gapError
    renderer.setLiveArcs | rnd.setLiveArcs | the pen's own chain is what gets painted
pointerUp() | eng.pointerUp
  _pointerUp | eng._pointerUp
    _note | eng._note | journal the gesture before pts is dropped
    renderer.endLive | rr.endLive,rnd.endLive | raster: the SVG path is held until its plates land
    doc.finalize | doc.finalize | geometry is immutable from here
      _emit -> TileStore._onDoc | doc._emit>ts._onDoc | a listener, not a call site
        _addObject | ts._addObject
          _appendUp | ts._appendUp | patch tiles that inherit it magnified
          _appendDown | ts._appendDown | ...and the ones that inherit it minified
    _queueBake | erp._queueBake
      new ArcBakeJob | arc.ArcBakeJob | handed the pen's chain: phase 1 already paid
    _scheduleBake(0) | erp._scheduleBake | -> Fig 2, the bake tick
    doc.pushUndo | doc.pushUndo | one gesture, one action
    _render | eng._render | -> Fig 5
    _queueIdleFits | eng._queueIdleFits | prefit outlines off the pen-up frame
"""))

TREES.append(("bake", "Resolving strokes, and folding in erasers", """
_bakeTick | erp._bakeTick | a timer, not a frame; re-entered until the queues drain
  _bakeTickInner | erp._bakeTickInner
    _camBusy | erp._camBusy | stand aside while the camera moves, up to a starve limit
    _ensureShapeBakes | erp._ensureShapeBakes | nothing is ever left raw for ever
      _queueBake | erp._queueBake
    _stepShapeBakes | erp._stepShapeBakes | 8 ms slices
      job.step(budgetMs) | arc.ArcBakeJob.step | every phase resumable mid-item
        _centerline | arc._centerline | the pen's chain, or BiarcPen.addSample chunked
        _chain | arc._chain | both rails and both caps as one closed chain
        _oracle | arc._oracle | the burial oracle's grid
        _precull | arc._precull | pieces wholly under the pen
        _cut | arc._cut | split the chain at its own crossings
        _classify | arc._classify | keep what the pen does not cover
        _stitch | arc._stitch | walk the survivors into closed loops
        _finishPhase | arc._finishPhase | hairlines, one handedness, junction balance
      _sealed | erp._sealed | an outline that will not close is sealed, and counted
        repairLoops | shp.repairLoops | bridge the fragments, seal once, drop dust
      doc.bakeShapeById | doc.bakeShapeById | the stroke BECOMES its outline, same id
      _promoteOversize | erp._promoteOversize | invariant 2: too wide -> promote a level
        Document.scaleGeometry | doc.scaleGeometry | divide by 4096: a change of units
        doc.rehomeById | doc.rehomeById
    _eraseStrokes | erp._eraseStrokes | eraser gestures whose own outline has resolved
    _nextEraseTarget | erp._nextEraseTarget | top-down by z, from the index
      _eraseFramesPass | erp._eraseFramesPass | a frame under the mark's ink goes whole
      _candidatesUnder | erp._candidatesUnder | every reachable level's index, sorted by z
      _eraseMayTouch | erp._eraseMayTouch | project the eraser's BOX, not its geometry
    _bakeOne | erp._bakeOne | -> Fig 3
    _lowerMark | erp._lowerMark | the mark's z steps down past what it has handled
    _noteSpent | erp._noteSpent | nothing left under the mark: record what it saw
    doc.removeById | doc.removeById | the white mark has served its purpose
    _render | eng._render | -> Fig 5
"""))

TREES.append(("erase", "Erasing: the cut", """
_bakeOne(Erec, target) | erp._bakeOne
  _forceBake | erp._forceBake | both operands must be resolved outlines
    bakeArcPerimeter | arc.bakeArcPerimeter
  doc.fillToShapeById | doc.fillToShapeById | a pre-arc drawing, promoted where it pays
  _eraseOp | erp._eraseOp | the gesture's undo op, before anything is touched
  lm.framePath | lm.framePath | a pure descent, or a different branch?
  _bakeRehome | erp._bakeRehome | target is COARSER -> descend  (-> Fig 4)
  _eraserLoopsInto | erp._eraserLoopsInto | otherwise cut in place: the eraser, in the subject's stored units
    lm.projectLoopsObj | lm.projectLoopsObj | through the object's displacement table
  dustBarFor | ejb.dustBarFor | a quarter pixel at the zoom the mark was drawn at
  runCutAsync | ewc.runCutAsync | in the erase worker where there is one
  cutJob | ejb.cutJob | ...or inline: the same function either way
    subtractShape | shp.subtractShape
      shapeBoolean | shp.shapeBoolean | one retry at a different welding radius
        shapeBooleanOnce | shp.shapeBooleanOnce
          normalizeLoops | shp.normalizeLoops | one handedness; solid area positive
          straighten | shp.straighten | an arc over the freeze radius stands in as its chord
          pieceIntersections | arc.pieceIntersections | circle-circle: one square root
          pieceOverlap | shp.pieceOverlap | boundary lying exactly on boundary
          cutLine / cutArc | arc.cutLine,arc.cutArc | a cut piece keeps what it was cut from
          RayIndex | shp.RayIndex | the classifier's buckets, per ray direction
          winding (a RayIndex) | shp.winding | inside or out, at each fragment's midpoint
          stitch | shp.stitch | pair ends by angle, then walk the cycles
    intersectShape | shp.intersectShape | the removal, measured LOCALLY
    shapeComponents | shp.shapeComponents
    dropDust | shp.dropDust
  _onCutResult | erp._onCutResult | the worker's answer: still the same object?
    _applyCut | erp._applyCut
  _applyCut | erp._applyCut | the document side, on the main thread
    _noteSeal | erp._noteSeal | count the booleans that had to be sealed
    doc.eraseReplaceById | doc.eraseReplaceById | one region keeps the key; several is a split
    doc.recordBake | doc.recordBake | the step, on the gesture's op
    _resplitFamily | erp._resplitFamily | did the OBJECT come apart?
      _familyComponents | erp._familyComponents | members are nodes; doorways are the edges
        _inkOutline | erp._inkOutline
        lm.mapRectF | lm.mapRectF | the doorway, in the other member's frame
        contactArcs | con.contactArcs | where ink meets the doorway, as intervals
          sidesOf / tOn / merge | con.sidesOf,con.tOn,con.merge | perimeter 0..4, never wrapped
        arcsTouch | con.arcsTouch | THE severance test
        Groups | con.Groups | union-find
"""))

TREES.append(("descent", "Erasing below an object's own level", """
_bakeRehome | erp._bakeRehome | timed
  _bakeRehomeInner | erp._bakeRehomeInner | one job for the whole family
    _descentWorld | erp._descentWorld | the lattice and the derive parameters
    runDescentAsync | ewc.runDescentAsync | the worker gets a COPY of the lattice
    descentJob | eds.descentJob | ...or inline: nothing touches the document yet
      new VirtualDoc | eds.VirtualDoc | the target is the only real object read
      lm.framePath | lm.framePath
      lm.mapRectF | lm.mapRectF | where the erase lands in each frame down
      childTilePhase | fl.childTilePhase | the object's grid, one level down
      squareInkOf | eds.squareInkOf | called through world.squareInk
        lm.projectF | lm.projectF | a ring native, one bounded hop
        classifyUp | der.classifyUp | empty / solid / edge: the store's own rule
        solidQuad | der.solidQuad
        deriveStep | der.deriveStep | the kid IS the store's piece, bit for bit (F42)
      shapeComponents | shp.shapeComponents
      dropDust | shp.dropDust
      cutJob | ejb.cutJob | LAST level only: eraser and ink now comparable
      cedeVirtual | eds.cedeVirtual | cut the square OUT of the parent, exactly
        rectLoop | shp.rectLoop | the doorway, as an outline
        subtractShape | shp.subtractShape
        shiftDown | off.shiftDown | the kid's displacement table
    _applyDescent | erp._applyDescent | the family swapped in, with real ids
      lm.merge | lm.merge | frames the job minted on its copy come back first (F67)
      doc.removeById | doc.removeById
      doc.add | doc.Document.add
      doc.recordBake | doc.recordBake | newest last, so undo unwinds from the bottom
      _resplitFamily | erp._resplitFamily | -> Fig 3
"""))

TREES.append(("render", "Rendering a frame", """
_render | eng._render
  _buildList | eng._buildList
    cam.frameWindow | cam.frameWindow
    listFor | eng.listFor | the one render list both renderers draw
      store.content(F, win) | ts.content | every tile covering the view
        _ensureUp -> _bakeUp | ts._ensureUp>ts._bakeUp | COARSER ink, magnified
          _upPiecesOver | ts._upPiecesOver
            _ensureUp (parent) | ts._ensureUp | the chain: one level at a time, recursive
          doc.at(parent) | doc.at | settles a frame's pending shift on first read
          _ringNatives | ts._ringNatives | the eight cells around each step
            lm.peekRing | lm.peekRing | never mints a frame just from looking
            lm.projectF | lm.projectF
          classifyUp | der.classifyUp | empty / solid / edge
          _solid | ts._solid | a flooding object becomes 4 corners
          deriveStep | der.deriveStep | ONE step of the chain
            transformLoopsAbout | shp.transformLoopsAbout | cancel against the cell centre, then scale
            childTilePhase | fl.childTilePhase | the object's grid, carried down
            chopFreezeLoops | frz.chopFreezeLoops | THE CHOP AND THE FREEZE
              freezeRadius | frz.freezeRadius | one radius: frozen wherever it is
              chordCuts | frz.chordCuts | cuts in the arc's own chord frame
              freezePiece | frz.freezePiece | the chord between its OWN ends
            shapeLoopsInRect | der.shapeLoopsInRect | the clip that hands back arcs
              clipShapeToRect | shp.clipShapeToRect
            bandRings | der.bandRings | a stroke's painted band -> rings
              strokeStripNear | ply.strokeStripNear | analytic, magnification-independent
        _ensureDown -> _bakeDown | ts._ensureDown>ts._bakeDown | FINER ink, minified in one jump
          _downSources | ts._downSources | the frame tree, pruned by invariant 2
          lm.projectF | lm.projectF
          _downPieces | ts._downPieces | flattens to polygons (safe: it is a leaf)
            shapeRingsInRect | der.shapeRingsInRect | clip first, flatten after
      store.ownContent | ts.ownContent | THIS frame's objects: a plain read
  renderer.render (raster) | rr.render | the default
    _frameStep | rr._frameStep
      visibleChords | rpk.visibleChords | light enough to raster here and now?
      _renderSync | rr._renderSync | yes: the sync path, on the main thread
        packJob | rpk.packJob
        renderPlate | rco.renderPlate | our own float64 coverage rasteriser
      store.want | pls.want | no: the cached plates, and the misses
      layer.compose | pic.compose | plates onto one canvas, stale ones kept
      _post | rr._post | the misses, as jobs
        _postNow | rr._postNow
          submitPlates | rwc.submitPlates | strips, to the worker pool
            pump -> dispatch | rwc.pump>rwc.dispatch
              runJob | rwk.runJob | in the worker (inline where there is none)
                renderPlate | rco.renderPlate
  renderer.render (?svg) | rnd.render
    _activateLevel | rnd._activateLevel | swap in this level's retained subtree
    _maybeReorigin | rnd._maybeReorigin | re-anchor if the view drifted too far
    _sig | rnd._sig | same signature -> reuse the paths
    _buildPieces | rnd._buildPieces
      _buildInto | rnd._buildInto
        _pushArea | rnd._pushArea
          pushShapeAnchors | rnd.pushShapeAnchors
            pushArcPiece | rnd.pushArcPiece | one plan per piece, never per zoom
        _buildOutlineInto | rnd._buildOutlineInto | a stroke not yet resolved, as its outline
          ensureOutline -> strokeLoops | rnd.ensureOutline>cvo.strokeLoops
      _addFillPath | rnd._addFillPath
        mkPath | rnd.mkPath | never hand the library an unbounded array
    _applyThinScale | rnd._applyThinScale | rescale features too small for the rasteriser
    _applyOpacity | rnd._applyOpacity
    syncWorld | rnd.syncWorld | fold the scene origin in, in full precision
  _drainPlates | eng._drainPlates | the document's changes, to the plate cache
  _maybeLadder | eng._maybeLadder | coarse plates for the zoomed-out screens, while still
"""))

TREES.append(("camera", "Zooming and panning", """
zoomFactorAt(sx, sy, f) | eng.zoomFactorAt | zoomAt and pinchUpdate both land here
  cam.zoomFactorAt | cam.zoomFactorAt
    hooks.finalizeLiveStroke | eng.pointerUp | the hook the engine gives the camera
    _maybeCross -> _settle | cam._maybeCross>cam._settle | cross and shift until the camera is LEGAL
      _maybeShift | cam._maybeShift | the view left its cell: step sideways
        cam.centre | cam.centre
        lm.neighbour | lm.neighbour
          carryDigit | fl.carryDigit | out of range: carry up to the parent
          cellChild | lm.cellChild
      _crossUp | cam._crossUp | into the child cell the view centre falls in
        lm.ensureChild | lm.ensureChild
          _viewCell -> cellOf | lm._viewCell>fl.cellOf | a ROUND, not a floor
          cellChild | lm.cellChild
            _addFrame | lm._addFrame
              cellEdge / cellCentre | fl.cellEdge,fl.cellCentre | exact: powers of two
      _crossDown | cam._crossDown | into the cell that contains this one
        lm.ensureParentEdge | lm.ensureParentEdge
          _growRoot | lm._growRoot | grow a coarser frame above the root
  _visibleChanged | eng._visibleChanged | did the visible tile set change?
    lm.tileRange | lm.tileRange
  renderer.needsFatFlip | rnd.needsFatFlip | a wide stroke approaching the gate
  renderer.needsFadeFlip | rr.needsFadeFlip,rnd.needsFadeFlip | false on the raster path
  renderer.needsReorigin | rr.needsReorigin,rnd.needsReorigin | false on the raster path
  _render | eng._render | if anything above said yes  (-> Fig 5)
  renderer.syncCameraOnly | rr.syncCameraOnly,rnd.syncCameraOnly | otherwise: no new list
    _frameStep | rr._frameStep | raster: the same plates, recomposed
  _maybePrebake | eng._maybePrebake | the next level's plates, before the crossing
    prebakePlates | rr.prebakePlates
  _maybeLadder | eng._maybeLadder
  _queueIdleFits | eng._queueIdleFits
"""))

TREES.append(("select", "Selecting and moving", """
_pointerDown (select) | eng._pointerDown | records the press; changes nothing
  _hitTest | sel._hitTest | pressed on ink?
    _shapeHit -> insideShape | sel._shapeHit>shp.insideShape
    distToPolyline | hit.distToPolyline
_pointerMove (select) | eng._pointerMove
  _beginSelectDrag | sel._beginSelectDrag | past SELECT_DRAG_PX: a drag, or a lasso
    select | sel.select | pressed on an unselected object
    _settleSelectionErases | erp._settleSelectionErases | never drag out from under an unbaked mark
      _flushErasesFor -> _bakeOne | erp._flushErasesFor>erp._bakeOne
    store.setBatch(true) | ts.setBatch | off-screen tiles: drop, do not patch
    _dragSelection | sel._dragSelection
  _dragSelection | sel._dragSelection | recomputed from where the drag STARTED
    _selectionMembers | sel._selectionMembers
      doc.editGroup | doc.editGroup | the whole family comes too
    snapDisplacement | off.snapDisplacement | 2^-10 units at the move level
    _displaceMember | sel._displaceMember | once per home frame
      lm.displaceFrame | lm.displaceFrame | the move, in base-4096 digits
        displacementDigits | fl.displacementDigits
        applyDigits | fl.applyDigits | add to the address, with carries
      addOffset | off.addOffset | the rest goes in the displacement table
    doc.rehomeManyById | doc.rehomeManyById | whole cells: a change of ADDRESS
    doc.setOffsetsById | doc.setOffsetsById | no stored coordinate is touched
    _dragFramesStart | sel._dragFramesStart | a selected frame moves as a frame
      lm.subtreeStart | lm.subtreeStart
    _dragFrames | sel._dragFrames
      lm.moveSubtreeTargets | lm.moveSubtreeTargets | displaceFrame's arithmetic, frame by frame
      lm.readdressMany | lm.readdressMany | the parent pointers; no native moves
      doc.setFrameShift | doc.setFrameShift | the sub-cell rest, settled at first read
_pointerUp (select) | eng._pointerUp
  _selectTap | sel._selectTap | a press that never moved
    select -> _setSelection | sel.select>sel._setSelection
  _applyLasso | sel._applyLasso
    _lassoFind | sel._lassoFind | a TREE walk, outward from the active frame
      doc.queryRect | doc.queryRect | only frames straddling the loop ask per object
      rectInsidePolygon | las.rectInsidePolygon | the fast accept
      _inkInsidePolygon | sel._inkInsidePolygon | the ink itself when the box fails
    _setSelection | sel._setSelection
  _homeShift | sel._homeShift | walked out of its cell?
  _normalizeHome | sel._normalizeHome | put it back inside its own cell (invariant 2)
    doc.rehomeById / doc.moveById | doc.rehomeById,doc.moveById
  doc.pushUndo(move / moveFrames) | doc.pushUndo | one drag, one action
  _endMove | eng._endMove | the drag's one exit
"""))
