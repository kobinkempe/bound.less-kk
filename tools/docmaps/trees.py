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
    renderer.setLiveArcs | rr.setLiveArcs,rnd.setLiveArcs
      live.arcs | lsl.arcs | the tail under the pen; full chunks freeze behind it
        pushGapAnchors | sva.pushGapAnchors
          pushArcPiece | sva.pushArcPiece | an arc command, or kappa cubics from its chord
pointerMove(sx, sy) | eng.pointerMove
  _pointerMove | eng._pointerMove
    cam.screenToFrame | cam.screenToFrame
    o._pen.addSample | bia.addSample | O(1): only the last two gaps are rebuilt
      controlsFor | ply.controlsFor | the same tangents the cardinal spline has
      arcsForGap | bia.arcsForGap | subdivide until the arc pair is in tolerance
        biarc | bia.biarc | two arcs, both end directions fixed
          arcThrough | bia.arcThrough
        gapError | bia.gapError
    renderer.setLiveArcs | rr.setLiveArcs,rnd.setLiveArcs | the pen's own chain is what gets painted
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
      _registerMark | erp._registerMark | an eraser mark registers as its shape lands
      _promoteOversize | erp._promoteOversize | invariant 2: too wide -> promote a level
        Document.scaleGeometry | doc.scaleGeometry | divide by 4096: a change of units
        doc.rehomeById | doc.rehomeById
    _registerLanded | erp._registerLanded | marks whose shape landed earlier
      _registerMark | erp._registerMark | the mark's targets, found once
        _eraseFramesPass | erp._eraseFramesPass | a frame under the mark's ink goes whole
        _candidatesUnder | erp._candidatesUnder | every reachable level's index, below its z
    _bakeRun(deadline) | erp._bakeRun | pairs in the serial order, within the slice
      _serialHead | erp._serialHead | the oldest mark's next pair, top-down by (z, id)
      _applyLanded | erp._applyLanded | a landed job, applied in its turn  (-> Fig 3)
      _dispatchPair | erp._dispatchPair | the head's job built and sent  (-> Fig 3)
      _spendMark | erp._spendMark | nothing left under the mark
        _noteSpent | erp._noteSpent | record what it saw
        doc.removeById | doc.removeById | the white mark has served its purpose
      _lookahead | erp._lookahead | the pool's free slots, filled ahead of the head
    _render / _renderSoon | eng._render,erp._renderSoon | a spent mark now; a cut within ERASE_RENDER_MS
"""))

TREES.append(("erase", "Erasing: the cut", """
_dispatchPair(Erec, target) | erp._dispatchPair | one pair: its job built, then pooled or run inline
  _forceBake | erp._forceBake | both operands must be resolved outlines
    bakeArcPerimeter | arc.bakeArcPerimeter
  doc.fillToShapeById | doc.fillToShapeById | a pre-arc drawing, promoted where it pays
  _eraseMayTouch | erp._eraseMayTouch | project the eraser's BOX, not its geometry
    _eraserRectInto | erp._eraserRectInto
      stage.placeNative | stg.placeNative | the target's placement: its stored units
  _jobFor | erp._jobFor | a descent, or a cut in place
    lm.framePath | lm.framePath | homed shallower on the mark's own chain?
    _descentWorld | erp._descentWorld | yes: a descent  (-> Fig 4)
    _projected | erp._projected | no: the eraser in the target's stored units, memoised
      _eraserLoopsInto | erp._eraserLoopsInto
        stage.placeNative | stg.placeNative | through the target's picture table (F41)
    dustBarFor | ejb.dustBarFor | a quarter pixel at the zoom the mark was drawn at
  submit | ewc.submit | to the pool: cuts and plates share one queue
  _onLanded | erp._onLanded | the answer, into the reorder buffer
  cutJob | ejb.cutJob | ...or inline: the same function either way
    shapeBoolean (both) | shp.shapeBoolean | difference and intersection in one pass
      shapeBooleanOnce | shp.shapeBooleanOnce
        normalizeLoops | shp.normalizeLoops | one handedness; solid area positive
        straighten | shp.straighten | an arc over the freeze radius stands in as its chord
        pieceIntersections | arc.pieceIntersections | circle-circle: one square root
        pieceOverlap | shp.pieceOverlap | boundary lying exactly on boundary
        cutLine / cutArc | arc.cutLine,arc.cutArc | a cut piece keeps what it was cut from
        RayIndex | shp.RayIndex | the classifier's buckets, per ray direction
        winding (a RayIndex) | shp.winding | inside or out, at each fragment's midpoint
        stitch | shp.stitch | pair ends by angle, then walk the cycles
    shapeComponents | shp.shapeComponents
    dropDust | shp.dropDust
  _applyPair | erp._applyPair | the document side, strictly in the serial order
    _applyCut | erp._applyCut
      _noteSeal | erp._noteSeal | count the booleans that had to be sealed
      _eraseOp | erp._eraseOp | the gesture's undo op, before anything is touched
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
_dispatchPair (a descent) | erp._dispatchPair | the target is homed shallower on the mark's chain
  _jobFor -> _descentWorld | erp._jobFor>erp._descentWorld | the lattice and the derive parameters
  submit | ewc.submit | one descent out at a time; the worker gets a COPY of the lattice
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
    shiftDown | off.shiftDown | a kid's picture table, less its frame's shift
    cede | cde.cede | cut the square OUT of the parent, on the VirtualDoc
      rectLoop | shp.rectLoop | the doorway, as an outline
      subtractShape | shp.subtractShape
  _applyPair -> _applyDescent | erp._applyPair>erp._applyDescent | the family swapped in, with real ids
    lm.merge | lm.merge | frames the job minted on its copy come back first (F67)
    doc.removeById | doc.removeById
    doc.add | doc.Document.add
    doc.recordBake | doc.recordBake | newest last, so undo unwinds from the bottom
    _resplitFamily | erp._resplitFamily | -> Fig 3
"""))

TREES.append(("render", "Rendering a frame", """
_render | eng._render
  _camToLattice | eng._camToLattice | the camera's frame, if a delete took it, replaced
  _prepareView | eng._prepareView | the view's picture sources, minted here: no read mints
  _listWin | eng._listWin | the view's window, grown by the renderer's margin
    cam.frameWindow | cam.frameWindow
  stage.sync(F, win) | stg.sync | the scene's table over the window; one commit
    _rebuild | stg._rebuild | a new frame: the table built afresh
      lm.tileRange | lm.tileRange
      _readMissing | stg._readMissing | the window's tiles, read in one call
        store.readTiles | ts.readTiles | a miss is derived now, within the budget
          _ensureUp -> _bakeUp | ts._ensureUp>ts._bakeUp | COARSER ink, magnified
            _upPiecesOver | ts._upPiecesOver
              _ensureUp (parent) | ts._ensureUp | the chain: one level at a time, recursive
            _cellNatives | ts._cellNatives | the parent cell's natives, co-residents too
              doc.queryRect | doc.queryRect
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
    _drainQueue | stg._drainQueue | the document's and the store's events, in order
      _applyDoc / _applyTile | stg._applyDoc,stg._applyTile
    store.setCameraPins | ts.setCameraPins | the tiles it watches are the store's pins
    _commit | stg._commit | G moves only with the table
  stage.items | stg.items | the list both renderers draw
  renderer.render (raster) | rr.render | the default
    _frameStep | rr._frameStep
      pyramid.frameFor | pyr.frameFor | the view: frame, zoom and level
        levelFor | lvl.levelFor | the level whose stretch lies in the band
        _requestView | pyr._requestView | the view's missing plates, asked once
          _ask -> _request | pyr._ask>pyr._request
            onRequest -> queue.push | jbq.push | the hook RasterRenderer gives the pyramid
              strips | jbq.strips | dealt round-robin from the attention point
      queue.pump | jbq.pump | within the pack budget
        _best | jbq._best | the lowest priority; a slot kept for cuts
        _admit | jbq._admit | a strip whose purpose moved on is dropped
        pool.submit -> _pyrSubmit | rr._pyrSubmit | the pool RasterRenderer gives the queue
          _pyrPost | rr._pyrPost
            _pyrPack | rr._pyrPack | called back by the pool at dispatch
              packJob | rpk.packJob | the plates' items, from the Stage's table
            rasterPool.submit -> dispatch | rwc.dispatch | a free worker slot
              runJob | rwk.runJob | in the worker (inline where there is none)
                renderPlate | rco.renderPlate | our own float64 coverage rasteriser
                  paintPlate | rco.paintPlate
      _planeStep | rr._planeStep | the drag plane, while a selection is held
      pyramid.compose | pyr.compose | the plan's plates onto one canvas
        plan | pyr.plan
          _planLevel -> _planCells | pyr._planLevel>pyr._planCells
            _planCell | pyr._planCell | exact, an older picture, or a stand-in
        _paint | pyr._paint
      _pyrPrefetch | rr._pyrPrefetch | while the camera is still
        prefetchPlan | pft.prefetchPlan | coarser and far levels, at priority 4
  renderer.render (?svg) | rnd.render
    _activateLevel | rnd._activateLevel | swap in this level's retained subtree
    _maybeReorigin | rnd._maybeReorigin | re-anchor if the view drifted too far
    _sig | rnd._sig | same signature -> reuse the paths
    _buildPieces | rnd._buildPieces
      _buildInto | rnd._buildInto
        _pushArea | rnd._pushArea
          pushShapeAnchors | sva.pushShapeAnchors
            pushArcPiece | sva.pushArcPiece | one plan per piece, never per zoom
        _buildOutlineInto | rnd._buildOutlineInto | a stroke not yet resolved, as its outline
          strokeLoops | cvo.strokeLoops
      _addFillPath | rnd._addFillPath
        mkPath | sva.mkPath | never hand the library an unbounded array
    _applyThinScale | rnd._applyThinScale | rescale features too small for the rasteriser
    _applyOpacity | rnd._applyOpacity
    syncWorld | rnd.syncWorld | fold the scene origin in, in full precision
onMessage (a plate job's answer) | rwc.onMessage | the worker's reply, or the inline run's
  req.onResult -> _pyrResult | rr._pyrResult | the callback _pyrPost gave the pool
    _pyrLand | rr._pyrLand
      pyramid.onResult | pyr.onResult
        _take | pyr._take
          store.put | pys.put | rule 1: kept iff its G is newer
      queue.pump | jbq.pump | the slot it freed
      pyramid.compose | pyr.compose | the plate on screen
"""))

TREES.append(("camera", "Zooming and panning", """
zoomFactorAt(sx, sy, f) | eng.zoomFactorAt | zoomAt and pinchUpdate both land here
  _zoomBy | eng._zoomBy
    renderer.noteAttention | rr.noteAttention | the wheel focus or the pinch centre
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
    _pend | eng._pend | the app's frames: the step waits for the animation frame
panBy(dx, dy) | eng.panBy
  cam.panBy -> _settle | cam.panBy>cam._settle
  _pend | eng._pend
_frame | eng._frame | one step per animation frame, the latest gesture's
  _zoomStep / _panStep | eng._zoomStep,eng._panStep
    _tableStep | eng._tableStep | raster: a crossing renders; else the table is synced
      _render | eng._render | -> Fig 5
      _syncStep | eng._syncStep
        stage.sync | stg.sync | within STEP_READ_MS, unless the window is covered
        renderer.syncCameraOnly | rr.syncCameraOnly | no new list: the same plates, recomposed
          _frameStep | rr._frameStep
    _visibleChanged | eng._visibleChanged | ?svg: did the visible tile set change?
      lm.tileRange | lm.tileRange
    renderer.needsReorigin | rnd.needsReorigin | ?svg: the view drifted too far
    _render | eng._render | if anything above said yes
    renderer.syncCameraOnly | rnd.syncCameraOnly | otherwise: no new list
  _zoomStep | eng._zoomStep
    renderer.needsFatFlip | rnd.needsFatFlip | ?svg: a wide stroke approaching the gate
    renderer.needsFadeFlip | rnd.needsFadeFlip
    _queueIdleFits | eng._queueIdleFits | after a crossing
"""))

TREES.append(("select", "Selecting and moving", """
_pointerDown (select) | eng._pointerDown | records the press; changes nothing
  _hitTest | sel._hitTest | pressed on ink?
    _shapeHit -> insideTester | sel._shapeHit>shp.insideTester
    distToPolyline | hit.distToPolyline
_pointerMove (select) | eng._pointerMove
  _beginSelectDrag | sel._beginSelectDrag | past SELECT_DRAG_PX: a drag, or a lasso
    select | sel.select | pressed on an unselected object
    _dragBarrier | erp._dragBarrier | never drag out from under an unbaked mark
      _eraseBarrier | erp._eraseBarrier | the gesture parked until its cuts land
        _barrierAdvance -> _dispatchPair | erp._barrierAdvance>erp._dispatchPair
    _beginHold | eng._beginHold | the members held by the Stage
      stage.hold | stg.hold | drawn, hit and lassoed at placement plus the delta
    _dragSelection | sel._dragSelection
  _dragSelection | sel._dragSelection | from where the drag STARTED; nothing is written
    snapDisplacement | off.snapDisplacement | 2^-10 units at the move level
    stage.setDragDelta | stg.setDragDelta | the held natives drawn at the delta
    _render | eng._render | when no drag plane draws them
_pointerUp (select) | eng._pointerUp
  _selectTap | sel._selectTap | a press that never moved
    select -> _setSelection | sel.select>sel._setSelection
  _applyLasso | sel._applyLasso
    _lassoBarrier | erp._lassoBarrier | its marks' cuts land before it is judged
    _judgeLasso | sel._judgeLasso
      _lassoFind | sel._lassoFind | a TREE walk, outward from the active frame
        doc.queryRect | doc.queryRect | only frames straddling the loop ask per object
        rectInsidePolygon | las.rectInsidePolygon | the fast accept
        _inkInsidePolygon | sel._inkInsidePolygon | the ink itself when the box fails
      _setSelection | sel._setSelection
  _endMove | eng._endMove | the drag's one exit
    _dropMove | sel._dropMove | the drop: the move written once
      store.setBatch(true) | ts.setBatch | off-screen tiles: drop, do not patch
      _selectionMembers | sel._selectionMembers
        doc.editGroup | doc.editGroup | the whole family comes too
      _dragFramesStart | sel._dragFramesStart | a selected frame moves as a frame
        lm.subtreeStart | lm.subtreeStart
      _dragFrames | sel._dragFrames
        lm.moveSubtreeTargets | lm.moveSubtreeTargets | displaceFrame's arithmetic, frame by frame
        lm.readdressMany | lm.readdressMany | the parent pointers; no native moves
        doc.setFrameShift | doc.setFrameShift | the sub-cell rest: the frame's shift
      _displaceMember | sel._displaceMember | once per home frame and table
        lm.displaceFrame | lm.displaceFrame | the move, in base-4096 digits
          displacementDigits | fl.displacementDigits
          applyDigits | fl.applyDigits | add to the address, with carries
        addOffset | off.addOffset | the rest goes in the displacement table
      doc.rehomeManyById | doc.rehomeManyById | whole cells: a change of ADDRESS
      doc.setOffsetsById | doc.setOffsetsById | no stored coordinate is touched
      doc.pushUndo(move / moveFrames) | doc.pushUndo | one drag, one action
    _releaseMove | eng._releaseMove
      stage.release | stg.release | one commit: where it started and where it ends
"""))
