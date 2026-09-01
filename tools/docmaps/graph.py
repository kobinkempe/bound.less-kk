# -*- coding: utf-8 -*-
"""The bound.less call graph: every function, and every call that can be read
off the source.

Node ids are `module.function`, where the function part is the bare name,
qualified with its class ONLY when the module defines that name more than once
(`ChainBuilder.step` and `ArcBakeJob.step` both exist; `pointerDown` does not
need saying twice). That convention is not arbitrary - it is the one the Code
Map already used, so a node id and a Code Map row name the same thing.

There are two edge sources and they are kept apart on purpose:

  E_HAND         373 edges read by hand off the source at f92c1d1, in the order
                 a reader would want to walk them. They are the spine of the
                 document, and several - the `this.store._onDoc` hop, the bake
                 tick fan-out - are what a reader comes here for.

  graphdata.json 1,855 edges produced by `extract.py`, each carrying up to
                 three `file:line` call sites. Anything it could not resolve to
                 a known node it dropped rather than guessed, so the file is a
                 subset of the truth and never a superset of it.

`E` is their union - 1,906 calls - hand edges keeping their position so the
spine still reads in order. The extractor independently reproduces about 85% of the hand list,
which is what makes the rest - calls through `this.<field>` chains, and dynamic
dispatch it declines to guess at - worth keeping by hand.

NODES is the full inventory: 1,103 functions across 73 files, which is every
top-level function, class and method in `src/` outside the test suites; run
`python inventory.py` from the repo root to reproduce the count. A node
with no edges is still a node. Several hundred are React components, one-line
helpers and oracle-only code that nothing in the running app calls, and a graph
that quietly omitted them would be claiming they do not exist.
"""
import json, os

import os
HERE = os.path.dirname(os.path.abspath(__file__))

_DATA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    os.path.join(HERE, "data", "graphdata.json"))))

# --------------------------------------------------------------------------
# Modules. MOD is the colour group; MODNAME is what the panel calls it.
# --------------------------------------------------------------------------
MOD = {
    # the facade, and the files mixed onto its prototype
    "eng": "fac", "erp": "fac", "ovl": "fac", "sel": "fac", "sco": "fac",
    "fil": "fac", "ins": "fac", "rmt": "fac", "mix": "fac", "now": "fac",
    # space, view, and what is drawn where
    "cam": "spc", "lm": "spc", "ts": "spc", "rnd": "spc", "fl": "spc",
    "per": "spc", "scn": "spc",
    # the objects themselves, and the ink pipeline
    "doc": "obj", "shp": "obj", "arc": "obj", "bia": "obj", "frz": "obj",
    # geometry helpers
    "der": "hlp", "con": "hlp", "las": "hlp", "hit": "hlp", "ply": "hlp",
    "clb": "hlp",
    "cvo": "hlp",
    # the scale bar
    "sbi": "sca", "cat": "sca", "mem": "sca", "pref": "sca", "prng": "sca",
    "lad": "sca", "nic": "sca", "lmt": "sca", "rsv": "sca", "pck": "sca",
    "ses": "sca", "rng": "sca", "lrl": "sca", "fmt": "sca", "val": "sca",
    # the shell: lifecycle, storage, cloud
    "hok": "shl", "loc": "shl", "thm": "shl", "cld": "shl", "fba": "shl",
    "usr": "shl",
    # pages and interface
    "app": "ui", "edt": "ui", "gal": "ui", "hom": "ui", "nfd": "ui",
    "col": "ui", "cmp": "ui", "sci": "ui", "btn": "ui", "inp": "ui",
    "brd": "ui", "cpp": "ui", "fam": "ui", "sdd": "ui", "sdb": "ui",
    "sup": "ui", "wop": "ui", "aps": "ui", "cka": "ui",
    "reportWebVitals": "ui",
    # NOT RUNNING: the oracles the tests compare against, the developer labs,
    # and code kept only because a suite still builds fixtures with it.
    "v0": "ded", "cvp": "ded", "sks": "ded", "bks": "ded", "ced": "ded",
    "ers": "ded", "tsp": "ded",
}
MODNAME = {
    "eng": "KobinEngine", "cam": "Camera", "lm": "LevelMap", "ts": "TileStore",
    "rnd": "Renderer", "doc": "Document", "shp": "arcShape",
    "arc": "arcPerimeter", "bia": "biarc", "frz": "freeze", "der": "derive",
    "fl": "frameLattice", "con": "connect", "las": "lasso", "hit": "hittest",
    "ply": "polyline", "clb": "clipperBoolean",
    "erp": "erasePipeline", "ovl": "overlays", "sel": "selection",
    "sco": "sceneOps", "fil": "files", "ins": "instruments",
    "rmt": "rectMath", "mix": "mixin", "now": "now",
    "cvo": "curveOutline", "per": "persist",
    "scn": "scenes",
    "sbi": "scaleBar/index", "cat": "scaleBar/catalog",
    "mem": "scaleBar/membership", "pref": "scaleBar/preference",
    "prng": "scaleBar/preferenceRange", "lad": "scaleBar/ladder",
    "nic": "scaleBar/nice", "lmt": "scaleBar/logMath",
    "rsv": "scaleBar/resolve", "pck": "scaleBar/pick",
    "ses": "scaleBar/session", "rng": "scaleBar/rungs",
    "lrl": "scaleBar/logicRule", "fmt": "scaleBar/format",
    "val": "scaleBar/validate",
    "hok": "useKobinEngine", "loc": "localCanvases", "thm": "thumbnails",
    "cld": "canvasSync", "fba": "firebaseApp", "usr": "useUser",
    "app": "App", "edt": "CanvasEditor", "gal": "CanvasesV2", "hom": "HomeV2",
    "nfd": "NotFoundPage", "col": "utils/color",
    "cmp": "ui/Dialog", "sci": "ui/SciText", "btn": "ui/Button",
    "inp": "ui/Input", "brd": "BrandLogo", "cpp": "ColorPickerPopover",
    "fam": "FileActionsMenu", "sdd": "SaveDrawingDialog",
    "sdb": "ScaleDragBar", "sup": "ScaleUnitPicker",
    "wop": "WidthOpacityPanel", "aps": "useAnchorPopoverStyle",
    "cka": "useClickAway", "tbn": "toolButton",
    "logoSmall": "logoSmallIcon", "reportWebVitals": "reportWebVitals",
    "v0": "KobinEngineV0", "cvp": "curvePerimeter", "sks": "strokeShape",
    "bks": "bakeStrategies", "ced": "cede", "ers": "erase",
    "lab": "BakeLab", "apn": "ArcPen", "abk": "ArcBake", "cv2": "CanvasV2",
    "tsp": "__testkit__/scaleBar",
}
GROUPNAME = {
    "fac": "facade", "spc": "space & view", "obj": "objects & ink",
    "hlp": "geometry helpers", "sca": "scale bar", "shl": "shell & storage",
    "ui": "pages & interface", "ded": "not running",
}

ENTRIES = ["eng.pointerDown", "eng.pointerMove", "eng.pointerUp",
           "eng.zoomFactorAt", "eng.panBy", "eng._bakeTick"]

# --------------------------------------------------------------------------
# The hand-read spine. Written before the extractor existed, and kept because
# it is ORDERED - it walks a gesture from the pointer down into the ink - and
# because it carries the edges an extractor will not guess at.
# --------------------------------------------------------------------------
E_HAND = [
    # ---- pointer entry -> the three gesture bodies ----
    ("eng.pointerDown", "eng._pointerDown"),
    ("eng.pointerMove", "eng._pointerMove"),
    ("eng.pointerUp", "eng._pointerUp"),
    ("eng.pointerDown", "eng._perf"), ("eng.pointerMove", "eng._perf"),
    ("eng.pointerUp", "eng._perf"),

    # ---- drawing ----
    ("eng._pointerDown", "cam.screenToFrame"),
    ("eng._pointerDown", "doc.allocId"),
    ("eng._pointerDown", "eng._startPen"),
    ("eng._pointerDown", "doc.add"),
    ("eng._pointerDown", "rnd.addLive"),
    ("eng._pointerDown", "rnd.setLiveArcs"),
    ("eng._pointerDown", "rnd.update"),
    ("eng._startPen", "bia.BiarcPen.addSample"),
    ("bia.BiarcPen.addSample", "bia.splineCubics"),
    ("bia.BiarcPen.addSample", "bia.arcsForGap"),
    ("bia.arcsForGap", "bia.biarc"),
    ("bia.arcsForGap", "bia.gapError"),
    ("bia.biarc", "bia.arcThrough"),
    ("bia.gapError", "bia.arcPoint"),
    ("rnd.setLiveArcs", "rnd.pushGapAnchors"),
    ("rnd.pushGapAnchors", "shp.pieceToCubics"),
    ("eng._pointerMove", "cam.screenToFrame"),
    ("eng._pointerMove", "bia.BiarcPen.addSample"),
    ("eng._pointerMove", "rnd.setLiveArcs"),
    ("eng._pointerMove", "rnd.update"),
    ("eng._pointerMove", "eng._dragSelection"),

    # ---- pen-up ----
    ("eng._pointerUp", "eng._note"),
    ("eng._pointerUp", "rnd.endLive"),
    ("eng._pointerUp", "doc.finalize"),
    ("eng._pointerUp", "eng._queueBake"),
    ("eng._pointerUp", "eng._scheduleBake"),
    ("eng._pointerUp", "doc.pushUndo"),
    ("eng._pointerUp", "eng._noteInkAdded"),
    ("eng._pointerUp", "eng._render"),
    ("eng._pointerUp", "eng._queueIdleFits"),
    ("eng._pointerUp", "eng._normalizeHome"),
    ("eng._pointerUp", "eng._applyLasso"),
    ("eng._queueBake", "arc.ArcBakeJob"),
    ("eng._scheduleBake", "eng._bakeTick"),
    ("doc.add", "doc._emit"),
    ("doc.finalize", "doc._emit"),
    ("doc._emit", "ts._onDoc"),
    ("ts._onDoc", "ts._addObject"),
    ("ts._onDoc", "ts._removeObject"),
    ("ts._addObject", "ts._appendUp"),
    ("ts._addObject", "ts._appendDown"),
    ("ts._appendUp", "der.classifyUp"),
    ("ts._appendUp", "der.deriveStep"),
    ("ts._appendDown", "ts._downPieces"),

    # ---- the bake tick ----
    ("eng._bakeTick", "eng._bakeTickInner"),
    ("eng._bakeTick", "eng._perf"),
    ("eng._bakeTickInner", "eng._camBusy"),
    ("eng._bakeTickInner", "eng._ensureShapeBakes"),
    ("eng._bakeTickInner", "eng._stepShapeBakes"),
    ("eng._bakeTickInner", "eng._eraseStrokes"),
    ("eng._bakeTickInner", "eng._nextEraseTarget"),
    ("eng._bakeTickInner", "eng._bakeOne"),
    ("eng._bakeTickInner", "eng._noteSpent"),
    ("eng._bakeTickInner", "doc.removeById"),
    ("eng._bakeTickInner", "eng._render"),
    ("eng._bakeTickInner", "eng._scheduleBake"),
    ("eng._ensureShapeBakes", "eng._queueBake"),
    ("eng._stepShapeBakes", "arc.ArcBakeJob.step"),
    ("eng._stepShapeBakes", "eng._sealed"),
    ("eng._stepShapeBakes", "doc.bakeShapeById"),
    ("eng._stepShapeBakes", "eng._promoteOversize"),
    ("eng._stepShapeBakes", "eng._render"),
    ("eng._sealed", "shp.repairLoops"),
    ("eng._promoteOversize", "doc.scaleGeometry"),
    ("eng._promoteOversize", "doc.translateGeometry"),
    ("eng._promoteOversize", "doc.rehomeById"),
    ("eng._promoteOversize", "doc.setGeometryById"),
    ("eng._nextEraseTarget", "eng._eraseMayTouch"),
    ("eng._eraseMayTouch", "lm.mapRectF"),

    # ---- the resolve ----
    ("arc.ArcBakeJob", "arc.ArcBakeJob.step"),
    ("arc.ArcBakeJob.step", "arc._centerline"),
    ("arc.ArcBakeJob.step", "arc._chain"),
    ("arc.ArcBakeJob.step", "arc._oracle"),
    ("arc.ArcBakeJob.step", "arc._precull"),
    ("arc.ArcBakeJob.step", "arc._cut"),
    ("arc.ArcBakeJob.step", "arc._classify"),
    ("arc.ArcBakeJob.step", "arc._stitch"),
    ("arc.ArcBakeJob.step", "arc._finishPhase"),
    ("arc._centerline", "bia.BiarcPen.addSample"),
    ("arc._chain", "arc.ChainBuilder.step"),
    ("arc.ChainBuilder.step", "bia.offsetArc"),
    ("arc.ChainBuilder.step", "arc.cap"),
    ("arc._oracle", "arc.Oracle.fill"),
    ("arc.Oracle.fill", "arc.pieceBBox"),
    ("arc.Oracle.fill", "arc.Grid.insert"),
    ("arc._precull", "arc.Oracle.buried"),
    ("arc.Oracle.buried", "arc.Grid.near"),
    ("arc.Oracle.buried", "bia.arcDist"),
    ("arc._cut", "arc.Grid.near"),
    ("arc._cut", "arc.pieceIntersections"),
    ("arc._cut", "arc.paramOf"),
    ("arc._cut", "arc.VertexSet.id"),
    ("arc.pieceIntersections", "arc.circleCircle"),
    ("arc.pieceIntersections", "arc.circleSegment"),
    ("arc.pieceIntersections", "arc.segSeg"),
    ("arc._classify", "arc.subPiece"),
    ("arc._classify", "arc.Oracle.buried"),
    ("arc._classify", "arc.ptAt"),
    ("arc._stitch", "arc.VertexSet.id"),
    ("arc._finishPhase", "arc.reversePiece"),
    ("shp.repairLoops", "shp.loopArea"),
    ("shp.repairLoops", "shp.dropDust"),

    # ---- erasing: the cut ----
    ("eng._bakeOne", "eng._forceBake"),
    ("eng._bakeOne", "doc.fillToShapeById"),
    ("eng._bakeOne", "lm.framePath"),
    ("eng._bakeOne", "eng._bakeRehome"),
    ("eng._bakeOne", "lm.projectF"),
    ("eng._bakeOne", "shp.transformLoops"),
    ("eng._bakeOne", "shp.loopsBBox"),
    ("eng._bakeOne", "shp.loopsArea"),
    ("eng._bakeOne", "shp.subtractShape"),
    ("eng._bakeOne", "eng._noteSeal"),
    ("eng._bakeOne", "eng._cull"),
    ("eng._bakeOne", "shp.shapeComponents"),
    ("eng._bakeOne", "doc.eraseReplaceById"),
    ("eng._bakeOne", "eng._resplitFamily"),
    ("eng._forceBake", "arc.bakeArcPerimeter"),
    ("arc.bakeArcPerimeter", "arc.ArcBakeJob.step"),
    ("doc.fillToShapeById", "shp.shapeFromRings"),
    ("doc.fillToShapeById", "shp.normalizeLoops"),
    ("eng._cull", "shp.dropDust"),
    ("doc.eraseReplaceById", "doc.removeById"),
    ("doc.eraseReplaceById", "doc.add"),

    # ---- the boolean ----
    ("shp.subtractShape", "shp.shapeBoolean"),
    ("shp.clipShapeToRect", "shp.shapeBoolean"),
    ("shp.shapeBoolean", "shp.shapeBooleanOnce"),
    ("shp.shapeBooleanOnce", "shp.normalizeLoops"),
    ("shp.shapeBooleanOnce", "shp.straighten"),
    ("shp.shapeBooleanOnce", "shp.loopBBox"),
    ("shp.shapeBooleanOnce", "arc.Grid.insert"),
    ("shp.shapeBooleanOnce", "arc.Grid.near"),
    ("shp.shapeBooleanOnce", "arc.pieceIntersections"),
    ("shp.shapeBooleanOnce", "shp.pieceOverlap"),
    ("shp.shapeBooleanOnce", "shp.windingOfFlat"),
    ("shp.shapeBooleanOnce", "shp.stitch"),
    ("shp.shapeBooleanOnce", "shp.dropHairlines"),
    ("shp.shapeBooleanOnce", "shp.flatPieces"),
    ("shp.shapeBooleanOnce", "arc.subPiece"),
    ("shp.pieceOverlap", "shp.onCurveOf"),
    ("shp.windingOfFlat", "shp.rayCross"),
    ("shp.normalizeLoops", "shp.loopsArea"),
    ("shp.loopsArea", "shp.loopArea"),

    # ---- the descent ----
    ("eng._bakeRehome", "eng._bakeRehomeInner"),
    ("eng._bakeRehome", "eng._perf"),
    ("eng._bakeRehomeInner", "lm.framePath"),
    ("eng._bakeRehomeInner", "shp.loopsBBox"),
    ("eng._bakeRehomeInner", "lm.mapRectF"),
    ("eng._bakeRehomeInner", "fl.childTilePhase"),
    ("eng._bakeRehomeInner", "fl.objTileRange"),
    ("eng._bakeRehomeInner", "fl.objTileRect"),
    ("eng._bakeRehomeInner", "eng._inkShapeInRect"),
    ("eng._bakeRehomeInner", "eng._cull"),
    ("eng._bakeRehomeInner", "shp.subtractShape"),
    ("eng._bakeRehomeInner", "eng._noteSeal"),
    ("eng._bakeRehomeInner", "doc.cedeTileById"),
    ("eng._bakeRehomeInner", "eng._resplitFamily"),
    ("eng._bakeRehomeInner", "eng._rehomeBail"),
    ("eng._inkShapeInRect", "lm.projectF"),
    ("eng._inkShapeInRect", "shp.transformLoops"),
    ("eng._inkShapeInRect", "shp.clipShapeToRect"),
    ("doc.cedeTileById", "shp.translateLoops"),
    ("doc.cedeTileById", "shp.rectLoop"),
    ("doc.cedeTileById", "shp.subtractShape"),
    ("doc.cedeTileById", "shp.dropDust"),
    ("doc.cedeTileById", "shp.shapeComponents"),
    ("doc.cedeTileById", "doc.removeById"),
    ("doc.cedeTileById", "doc.add"),
    ("shp.translateLoops", "shp.transformLoops"),

    # ---- severance ----
    ("eng._resplitFamily", "eng._familyComponents"),
    ("eng._familyComponents", "eng._familyMembers"),
    ("eng._familyComponents", "eng._inkOutline"),
    ("eng._familyComponents", "lm.mapRectF"),
    ("eng._familyComponents", "con.contactArcs"),
    ("eng._familyComponents", "con.arcsTouch"),
    ("eng._familyComponents", "con.Groups.union"),
    ("eng._inkOutline", "shp.flattenShape"),
    ("eng._inkOutline", "cvo.strokeLoops"),
    ("con.contactArcs", "con.sidesOf"),
    ("con.contactArcs", "con.tOn"),
    ("con.contactArcs", "con.merge"),

    # ---- rendering ----
    ("eng._render", "eng._buildList"),
    ("eng._render", "rnd.render"),
    ("eng._render", "rnd.update"),
    ("eng._render", "eng._emit"),
    ("eng._render", "eng._perf"),
    ("eng._buildList", "cam.frameWindow"),
    ("eng._buildList", "ts.content"),
    ("eng._buildList", "ts.ownContent"),
    ("eng._buildList", "doc.getById"),
    ("eng._buildList", "lm.tileRange"),
    ("ts.content", "ts._ensureUp"),
    ("ts.content", "ts._ensureDown"),
    ("ts.content", "ts._evict"),
    ("ts._ensureUp", "ts._bakeUp"),
    ("ts._bakeUp", "ts._ensureUp"),              # the chain: recursive
    ("ts._bakeUp", "lm.rectToParent"),
    ("ts._bakeUp", "lm.tileRange"),
    ("ts._bakeUp", "doc.at"),
    ("ts._bakeUp", "ts._ringNatives"),
    ("ts._bakeUp", "der.classifyUp"),
    ("ts._bakeUp", "ts._solid"),
    ("ts._bakeUp", "der.deriveStep"),
    ("ts._solid", "der.solidQuad"),
    ("ts._ringNatives", "lm.peekRing"),
    ("ts._ringNatives", "doc.queryRect"),
    ("ts._ringNatives", "lm.projectF"),
    ("ts._ensureDown", "ts._bakeDown"),
    ("ts._bakeDown", "lm.frameFactor"),
    ("ts._bakeDown", "der.projectedSizePx"),
    ("ts._bakeDown", "der.bboxOf"),
    ("ts._bakeDown", "lm.mapRectF"),
    ("ts._bakeDown", "lm.projectF"),
    ("ts._bakeDown", "ts._downPieces"),
    ("ts._downPieces", "der.shapeRingsInRect"),
    ("ts._downPieces", "clp.clipRingsToRect"),
    ("ts._downPieces", "clp.clipPolylineToRect"),
    ("ts.ownContent", "doc.at"),
    ("der.shapeRingsInRect", "shp.clipShapeToRect"),
    ("der.shapeRingsInRect", "shp.flattenShape"),
    ("der.shapeRingsInRect", "shp.insideShape"),
    ("der.shapeRingsInRect", "shp.transformLoops"),

    # ---- one step of the chain ----
    ("der.deriveStep", "shp.transformLoopsAbout"),
    ("der.deriveStep", "fl.childTilePhase"),
    ("der.deriveStep", "frz.tileWindow"),
    ("der.deriveStep", "frz.tileClipRect"),
    ("der.deriveStep", "frz.chopFreezeLoops"),
    ("der.deriveStep", "der.shapeLoopsInRect"),
    ("der.deriveStep", "der.bandRings"),
    ("der.deriveStep", "der.bboxOf"),
    ("der.deriveStep", "der.seamPad"),
    ("der.deriveStep", "clp.clipRingsToRect"),
    ("der.deriveStep", "clp.clipPolylineToRect"),
    ("frz.tileWindow", "fl.objTileRange"),
    ("frz.tileClipRect", "fl.objTilesRect"),
    ("frz.chopFreezeLoops", "frz.pieceSagitta"),
    ("frz.chopFreezeLoops", "frz.arcCuts"),
    ("frz.chopFreezeLoops", "frz.freezePiece"),
    ("frz.chopFreezeLoops", "arc.subPiece"),
    ("frz.chopFreezeLoops", "arc.ptAt"),
    ("der.shapeLoopsInRect", "shp.clipShapeToRect"),
    ("der.shapeLoopsInRect", "frz.markSeamEnds"),
    ("der.shapeLoopsInRect", "shp.transformLoops"),
    ("der.bandRings", "clp.strokeStripNear"),
    ("der.bandRings", "clp.strokeOutline"),
    ("der.bandRings", "clp.flattenCurve"),
    ("der.bandRings", "clp.clipPolylineToRect"),
    ("der.bboxOf", "shp.loopsBBox"),

    # ---- the renderer ----
    ("rnd.render", "rnd._activateLevel"),
    ("rnd.render", "rnd._maybeReorigin"),
    ("rnd.render", "rnd._sig"),
    ("rnd.render", "rnd._buildPieces"),
    ("rnd.render", "rnd._applyThinScale"),
    ("rnd.render", "rnd._applyOpacity"),
    ("rnd.render", "rnd.syncWorld"),
    ("rnd.render", "rnd._insertSorted"),
    ("rnd._buildPieces", "rnd._buildInto"),
    ("rnd._buildPieces", "rnd._addFillPath"),
    ("rnd._buildInto", "rnd.pushShapeAnchors"),
    ("rnd._buildInto", "rnd.pushGapAnchors"),
    ("rnd._buildInto", "rnd._fatPolys"),
    ("rnd._buildInto", "rnd._addShapePath"),
    ("rnd.pushShapeAnchors", "shp.shapeToCubics"),
    ("shp.shapeToCubics", "shp.pieceToCubics"),
    ("rnd._fatPolys", "cvo.strokeLoops"),
    ("rnd._addFillPath", "rnd.mkPath"),
    ("rnd._addShapePath", "rnd.mkPath"),
    ("rnd._applyOpacity", "rnd._fade"),
    ("rnd.syncWorld", "rnd._renderSelection"),

    # ---- camera ----
    ("eng.zoomFactorAt", "cam.zoomFactorAt"),
    ("eng.zoomFactorAt", "eng._visibleChanged"),
    ("eng.zoomFactorAt", "rnd.needsRebake"),
    ("eng.zoomFactorAt", "rnd.needsFatFlip"),
    ("eng.zoomFactorAt", "rnd.needsFadeFlip"),
    ("eng.zoomFactorAt", "rnd.needsReorigin"),
    ("eng.zoomFactorAt", "eng._render"),
    ("eng.zoomFactorAt", "rnd.syncCameraOnly"),
    ("eng.zoomFactorAt", "eng._maybePrebake"),
    ("eng.zoomFactorAt", "eng._queueIdleFits"),
    ("eng.zoomFactorAt", "eng._perf"),
    ("eng.panBy", "cam.panBy"),
    ("eng.panBy", "eng._visibleChanged"),
    ("eng.panBy", "eng._render"),
    ("eng.panBy", "rnd.syncCameraOnly"),
    ("eng.panBy", "eng._perf"),
    ("cam.panBy", "cam._settle"),
    ("cam.zoomFactorAt", "eng.pointerUp"),        # finalizeLiveStroke hook
    ("cam.zoomFactorAt", "cam._settle"),
    ("cam._settle", "cam._maybeShift"),
    ("cam._settle", "cam._crossUp"),
    ("cam._settle", "cam._crossDown"),
    ("cam._maybeShift", "cam.centre"),
    ("cam._maybeShift", "lm.neighbour"),
    ("cam._crossUp", "lm.ensureChild"),
    ("cam._crossDown", "lm.ensureParentEdge"),
    ("lm.ensureChild", "lm._viewCell"),
    ("lm.ensureChild", "lm.cellChild"),
    ("lm._viewCell", "fl.cellOf"),
    ("lm.cellChild", "fl.cellEdge"),
    ("lm.cellChild", "fl.cellCentre"),
    ("lm.cellChild", "fl.carryDigit"),
    ("lm.cellChild", "lm.neighbour"),
    ("lm.neighbour", "fl.carryDigit"),
    ("lm.neighbour", "lm.cellChild"),
    ("lm.neighbour", "lm._growRoot"),
    ("lm.ensureParentEdge", "lm._growRoot"),
    ("eng._visibleChanged", "lm.tileRange"),
    ("rnd.needsReorigin", "rnd._driftPx"),
    ("rnd._maybeReorigin", "rnd._driftPx"),
    ("rnd.syncCameraOnly", "rnd.syncWorld"),
    ("rnd.syncCameraOnly", "rnd._applyOpacity"),

    # ---- transforms ----
    ("lm.projectF", "lm.framePath"),
    ("lm.projectF", "lm.frameFactor"),
    ("lm.projectF", "shp.transformLoops"),
    ("lm.projectF", "shp.transformLoopsAbout"),
    ("lm.mapRectF", "lm.mapPointF"),
    ("lm.mapPointF", "lm.framePath"),
    ("lm.frameFactor", "lm.framePath"),
    ("lm.framePath", "lm._buildPath"),
    ("lm.displaceFrame", "fl.displacementDigits"),
    ("lm.displaceFrame", "fl.applyDigits"),
    ("lm.displaceFrame", "lm.chainFrom"),
    ("lm.displaceFrame", "lm.neighbour"),
    ("lm.displaceFrame", "lm.frameAtChain"),
    ("lm.frameAtChain", "lm.cellChild"),
    ("fl.applyDigits", "fl.carryDigit"),

    # ---- selection and moving ----
    ("eng._pointerDown", "eng._hitTest"),
    ("eng._pointerDown", "eng.select"),
    ("eng._pointerDown", "eng._settleSelectionErases"),
    ("eng._pointerDown", "ts.setBatch"),
    ("eng._hitTest", "eng._shapeHit"),
    ("eng._hitTest", "hit.distToPolyline"),
    ("eng._shapeHit", "shp.insideShape"),
    ("shp.insideShape", "shp.windingAt"),
    ("shp.windingAt", "shp.windingOfFlat"),
    ("eng.select", "eng._setSelection"),
    ("eng._setSelection", "doc.editGroup"),
    ("eng._settleSelectionErases", "eng._flushErasesFor"),
    ("eng._flushErasesFor", "eng._bakeOne"),
    ("eng._dragSelection", "eng._selectionMembers"),
    ("eng._dragSelection", "lm.frameFactor"),
    ("eng._dragSelection", "lm.displaceFrame"),
    ("eng._dragSelection", "doc.rehomeById"),
    ("eng._dragSelection", "doc.setGeometryById"),
    ("eng._dragSelection", "eng._render"),
    ("eng._selectionMembers", "doc.editGroup"),
    ("doc.setGeometryById", "doc.translateGeometry"),
    ("doc.setGeometryById", "doc._afterEdit"),
    ("doc.translateGeometry", "shp.translateLoops"),
    ("doc.scaleGeometry", "shp.transformLoopsAbout"),
    ("doc.moveById", "shp.translateLoops"),
    ("doc.moveById", "doc._afterEdit"),
    ("doc._afterEdit", "doc._emit"),
    ("doc.rehomeById", "doc._emit"),
    ("doc.removeById", "doc._emit"),
    ("doc.add", "doc._forgetIfEmpty"),
    ("eng._normalizeHome", "lm.neighbour"),
    ("eng._normalizeHome", "doc.rehomeById"),
    ("eng._normalizeHome", "doc.moveById"),
    ("eng._normalizeHome", "der.bboxOf"),
    ("eng._applyLasso", "eng._lassoFind"),
    ("eng._applyLasso", "eng._setSelection"),
    ("eng._lassoFind", "doc.queryRect"),
    ("eng._lassoFind", "eng._rectInActive"),
    ("eng._lassoFind", "las.rectInsidePolygon"),
    ("eng._rectInActive", "lm.mapRectF"),
    ("las.rectInsidePolygon", "las.pointInPolygon"),
    ("las.rectInsidePolygon", "las.segsCross"),
]

# Eight hand-read ids predate the "qualify only when ambiguous" rule and name a
# method by its class where the module has only one of them. Renaming here,
# rather than editing the list above, keeps the spine readable as prose.
RENAME = {
    "arc.Grid.insert": "arc.insert", "arc.Grid.near": "arc.near",
    "arc.Oracle.buried": "arc.buried", "arc.Oracle.fill": "arc.fill",
    "arc.VertexSet.id": "arc.id", "bia.BiarcPen.addSample": "bia.addSample",
    "con.Groups.union": "con.union", "doc.add": "doc.Document.add",
}

NODES = list(_DATA["nodes"])
_KNOWN = set(NODES)


# A leaf name that is unique across the codebase resolves on its own. The hand
# list records CALL RELATIONSHIPS, and a function that moves to another file is
# still the same call - re-typing 200 entries after the 2026-08-31 engine split
# would have been busywork with a transcription error somewhere in it.
_BYLEAF = {}
for _n in _KNOWN:
    _BYLEAF.setdefault(_n.split(".")[-1], []).append(_n)


def _fix(n):
    n = RENAME.get(n, n)
    if n in _KNOWN:
        return n
    # The oracles carry copies of half these names (`v0._hitTest` is V0's own),
    # so they never win a remap - the hand list is about the LIVE engine.
    hits = [h for h in _BYLEAF.get(n.split(".")[-1], [])
            if MOD.get(h.split(".")[0]) != "ded"]
    return hits[0] if len(hits) == 1 else n


# --------------------------------------------------------------------------
# The union. Hand edges first, in their order; then everything the extractor
# found that the hand list did not already have.
# --------------------------------------------------------------------------
E = []
_seen = set()
_dropped = []
for _a, _b in E_HAND:
    _a, _b = _fix(_a), _fix(_b)
    if _a not in _KNOWN or _b not in _KNOWN:
        _dropped.append((_a, _b))
        continue
    if (_a, _b) not in _seen:
        _seen.add((_a, _b))
        E.append((_a, _b))
assert not _dropped, "hand edge names no node: %r" % (_dropped[:5],)

# `file:line` for every extracted edge, so a claim the graph makes can be
# checked against the source without reading the whole file.
SITES = {}
for _a, _b, _sites in _DATA["edges"]:
    SITES[(_a, _b)] = _sites
    if (_a, _b) not in _seen:
        _seen.add((_a, _b))
        E.append((_a, _b))

# How much of the hand list the extractor reproduces on its own. A fall here
# means the extractor has regressed; `python graph.py` prints it.
AGREE = sum(1 for e in ((_fix(a), _fix(b)) for a, b in E_HAND) if e in SITES)


def label(nid):
    """Short display label: drop the module prefix (colour carries it)."""
    return nid.split(".", 1)[1]


def nodes():
    return NODES


def group(nid):
    return MOD[nid.split(".", 1)[0]]


if __name__ == "__main__":
    import collections
    print("nodes  %d" % len(NODES))
    print("edges  %d  (hand %d, extracted %d)"
          % (len(E), len(E_HAND), len(SITES)))
    print("hand edges the extractor also finds: %d of %d (%.0f%%)"
          % (AGREE, len(E_HAND), 100.0 * AGREE / len(E_HAND)))
    deg = collections.Counter()
    for a, b in E:
        deg[a] += 1
        deg[b] += 1
    print("isolated (no call in or out): %d"
          % len([n for n in NODES if not deg[n]]))
    for g, c in collections.Counter(group(n) for n in NODES).most_common():
        print("   %-4s %-18s %d" % (g, GROUPNAME[g], c))
