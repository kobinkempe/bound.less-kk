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
    # the facade, the files mixed onto its prototype, and the erase jobs
    "eng": "fac", "erp": "fac", "ovl": "fac", "sel": "fac", "sco": "fac",
    "fil": "fac", "ins": "fac", "rmt": "fac", "mix": "fac", "now": "fac",
    "ejb": "fac", "eds": "fac", "ewc": "fac", "rep": "fac",
    "eru": "fac", "cde": "fac", "dvl": "fac",
    # space, the store, the saved form, the scene, and the scene index
    "cam": "spc", "lm": "spc", "fgc": "spc", "ts": "spc", "rnd": "spc", "fl": "spc",
    "stg": "spc", "plm": "spc",
    "per": "spc", "f2": "spc", "opl": "spc", "lv1": "spc",
    "six": "spc", "scc": "spc", "swc": "spc",
    # the raster renderer: the paper, and the SVG pieces both renderers share
    "rr": "ras", "pyr": "ras", "pys": "ras", "lvl": "ras", "jbq": "ras",
    "pft": "ras", "lsl": "ras", "svl": "ras", "svo": "ras", "sva": "ras",
    "ovy": "ras", "mvp": "ras",
    "anp": "ras", "plt": "ras", "rco": "ras", "rjb": "ras", "rpk": "ras",
    "rpf": "ras", "rwc": "ras", "rwk": "ras", "pcd": "ras", "prm": "ras", "fvw": "ras",
    # the objects themselves, and the ink pipeline
    "doc": "obj", "shp": "obj", "arc": "obj", "bia": "obj", "frz": "obj",
    "lop": "obj", "off": "obj",
    # geometry helpers
    "der": "hlp", "con": "hlp", "las": "hlp", "hit": "hlp", "ply": "hlp",
    "clb": "hlp", "cvo": "hlp", "chm": "hlp", "ant": "hlp",
    # the scale bar
    "sbi": "sca", "cat": "sca", "mem": "sca", "pref": "sca", "prng": "sca",
    "lad": "sca", "nic": "sca", "lmt": "sca", "rsv": "sca", "pck": "sca",
    "ses": "sca", "rng": "sca", "lrl": "sca", "fmt": "sca", "val": "sca",
    # the shell: lifecycle, storage, cloud
    "hok": "shl", "rps": "shl", "db": "shl", "loc": "shl", "thm": "shl", "fld": "shl",
    "cld": "shl", "css": "shl", "syn": "shl", "slk": "shl", "st2": "shl", "gz": "shl",
    "lzw": "shl", "fba": "shl", "usr": "shl",
    # pages and interface
    "app": "ui", "edt": "ui", "gal": "ui", "hom": "ui", "nfd": "ui",
    "col": "ui", "cmp": "ui", "sci": "ui", "btn": "ui", "inp": "ui",
    "brd": "ui", "cpp": "ui", "fam": "ui", "sdd": "ui", "sdb": "ui",
    "sup": "ui", "syc": "ui", "wop": "ui", "aps": "ui", "cka": "ui",
    "dvs": "ui", "erc": "ui", "shd": "ui",
    "reportWebVitals": "ui",
    # NOT RUNNING: the oracles the tests compare against.
    "v0": "ded", "cvp": "ded", "sks": "ded", "bks": "ded", "ced": "ded",
    "ers": "ded", "cov": "ded", "sor": "ded", "rls": "ded",
}
# The frozen pre-C1 model, `__oracles__/model-v1/` (A1 §14): one key per file.
M1 = {"m1eng": "KobinEngine", "m1erp": "erasePipeline", "m1ovl": "overlays",
      "m1sel": "selection", "m1sco": "sceneOps", "m1fil": "files",
      "m1eds": "eraseDescent", "m1ewc": "eraseWorkerClient", "m1cde": "cede",
      "m1lm": "LevelMap", "m1gc": "frameGc", "m1ts": "TileStore", "m1rnd": "Renderer",
      "m1stg": "Stage", "m1plm": "placementModel", "m1doc": "Document",
      "m1per": "persist", "m1f2": "format2", "m1opl": "oplog", "m1off": "offsets",
      "m1scc": "sceneClient", "m1shm": "rasterShim"}
for _k in M1:
    MOD[_k] = "ded"
MODNAME = {
    "eng": "KobinEngine", "cam": "Camera", "lm": "LevelMap", "ts": "TileStore",
    "rnd": "Renderer", "doc": "Document", "shp": "arcShape",
    "arc": "arcPerimeter", "bia": "biarc", "frz": "freeze", "der": "derive",
    "fl": "frameLattice", "con": "connect", "las": "lasso", "hit": "hittest",
    "ply": "polyline", "clb": "clipperBoolean",
    "erp": "erasePipeline", "ovl": "overlays", "sel": "selection",
    "sco": "sceneOps", "fil": "files", "ins": "instruments",
    "rmt": "rectMath", "mix": "mixin", "now": "now",
    "ejb": "eraseJob", "eds": "eraseDescent", "ewc": "eraseWorkerClient",
    "rep": "report", "eru": "eraseRule", "cde": "cede", "dvl": "devLevers",
    "fgc": "frameGc", "stg": "Stage", "plm": "placementModel", "lv1": "legacy/modelV1",
    "cvo": "curveOutline", "per": "persist", "f2": "format2", "opl": "oplog",
    "six": "sceneIndex", "scc": "sceneClient", "swc": "sceneWorkerClient",
    "rr": "raster/RasterRenderer", "pyr": "raster/PicturePyramid",
    "pys": "raster/PyramidStore", "lvl": "raster/level", "jbq": "raster/jobQueue",
    "pft": "raster/prefetch", "lsl": "raster/LiveStrokeLayer", "svl": "raster/SvgLayer",
    "svo": "raster/svgOverlay", "sva": "raster/svgAnchors", "ovy": "raster/OverlayLayer",
    "mvp": "raster/MovePlane", "anp": "raster/antPaint", "plt": "raster/plate",
    "rco": "raster/rasterCore", "rjb": "raster/rasterJob",
    "rpk": "raster/rasterPack", "rpf": "raster/rasterPerf",
    "rwc": "raster/rasterWorkerClient", "rwk": "worker/rasterWorker",
    "pcd": "raster/plateCodec", "prm": "raster/plateRam", "fvw": "raster/firstView",
    "lop": "loop", "off": "offsets", "chm": "chordMath", "ant": "antRuns",
    "sbi": "scaleBar/index", "cat": "scaleBar/catalog",
    "mem": "scaleBar/membership", "pref": "scaleBar/preference",
    "prng": "scaleBar/preferenceRange", "lad": "scaleBar/ladder",
    "nic": "scaleBar/nice", "lmt": "scaleBar/logMath",
    "rsv": "scaleBar/resolve", "pck": "scaleBar/pick",
    "ses": "scaleBar/session", "rng": "scaleBar/rungs",
    "lrl": "scaleBar/logicRule", "fmt": "scaleBar/format",
    "val": "scaleBar/validate",
    "hok": "useKobinEngine", "rps": "reportSend", "db": "storage/db",
    "loc": "localCanvases", "thm": "thumbnails", "fld": "foldStore",
    "cld": "canvasSync", "css": "canvasSession", "syn": "syncCore", "slk": "storageLocks",
    "st2": "store2", "gz": "gzip", "lzw": "lzWorker",
    "fba": "firebaseApp", "usr": "useUser",
    "app": "App", "edt": "CanvasEditor", "gal": "CanvasesV2", "hom": "HomeV2",
    "nfd": "NotFoundPage", "col": "utils/color",
    "cmp": "ui/Dialog", "sci": "ui/SciText", "btn": "ui/Button",
    "inp": "ui/Input", "brd": "BrandLogo", "cpp": "ColorPickerPopover",
    "fam": "FileActionsMenu", "sdd": "SaveDrawingDialog",
    "sdb": "ScaleDragBar", "sup": "ScaleUnitPicker", "syc": "SyncChip",
    "wop": "WidthOpacityPanel", "aps": "useAnchorPopoverStyle",
    "cka": "useClickAway", "reportWebVitals": "reportWebVitals",
    "dvs": "DevStats", "erc": "EraseChip", "shd": "ScaleHud",
    "v0": "KobinEngineV0", "cvp": "curvePerimeter", "sks": "strokeShape",
    "bks": "bakeStrategies", "ced": "__oracles__/cede", "ers": "erase",
    "cov": "coverageOracle", "sor": "sceneOracle", "rls": "renderList",
}
for _k, _f in M1.items():
    MODNAME[_k] = "model-v1/" + _f
GROUPNAME = {
    "fac": "facade", "spc": "space & view", "ras": "paper (raster)",
    "obj": "objects & ink", "hlp": "geometry helpers", "sca": "scale bar",
    "shl": "shell & storage", "ui": "pages & interface", "ded": "not running",
}

ENTRIES = ["eng.pointerDown", "eng.pointerMove", "eng.pointerUp",
           "eng.zoomFactorAt", "eng.panBy", "erp._bakeTick"]

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
    ("bia.BiarcPen.addSample", "bia.arcsForGap"),
    ("bia.BiarcPen.addSample", "bia.arcsForGap"),
    ("bia.arcsForGap", "bia.biarc"),
    ("bia.arcsForGap", "bia.gapError"),
    ("bia.biarc", "bia.arcThrough"),
    ("bia.gapError", "bia.arcDist"),
    ("rnd.setLiveArcs", "lsl.arcs"),
    ("lsl.arcs", "sva.pushGapAnchors"),
    ("rnd.pushGapAnchors", "rnd.pushArcPiece"),
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
    ("eng._pointerUp", "eng._render"),
    ("eng._pointerUp", "eng._queueIdleFits"),
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
    ("eng._bakeTickInner", "erp._registerLanded"),
    ("erp._registerLanded", "erp._registerMark"),
    ("erp._registerMark", "erp._eraseFramesPass"),
    ("erp._registerMark", "erp._candidatesUnder"),
    ("eng._bakeTickInner", "erp._bakeRun"),
    ("erp._bakeRun", "erp._serialHead"),
    ("erp._bakeRun", "erp._dispatchPair"),
    ("erp._bakeRun", "erp._spendMark"),
    ("erp._spendMark", "erp._noteSpent"),
    ("erp._spendMark", "doc.removeById"),
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
    ("erp._dispatchPair", "erp._eraseMayTouch"),
    ("eng._eraseMayTouch", "erp._eraserRectInto"),
    ("erp._eraserRectInto", "stg.placeNative"),

    # ---- the resolve ----
    ("erp._stepShapeBakes", "arc.ArcBakeJob.step"),
    ("arc.bakeArcPerimeter", "arc.ArcBakeJob.step"),
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
    ("arc._classify", "arc.verdict"),
    ("arc._classify", "arc.ptAt"),
    ("arc._stitch", "arc.VertexSet.id"),
    ("arc._finishPhase", "arc.reversePiece"),
    ("shp.repairLoops", "shp.meanWidth"),

    # ---- erasing: the cut ----
    ("erp._dispatchPair", "erp._forceBake"),
    ("erp._dispatchPair", "doc.fillToShapeById"),
    ("erp._dispatchPair", "erp._jobFor"),
    ("erp._jobFor", "lm.framePath"),
    ("erp._jobFor", "erp._descentWorld"),
    ("erp._jobFor", "erp._projected"),
    ("erp._projected", "erp._eraserLoopsInto"),
    ("erp._eraserLoopsInto", "stg.placeNative"),
    ("erp._jobFor", "ejb.dustBarFor"),
    ("erp._dispatchPair", "ewc.submit"),
    ("erp._dispatchPair", "erp._onLanded"),
    ("erp._dispatchPair", "ejb.cutJob"),
    ("erp._dispatchPair", "eds.descentJob"),
    ("ejb.cutJob", "shp.shapeBoolean"),
    ("ejb.cutJob", "shp.shapeComponents"),
    ("ejb.cutJob", "shp.dropDust"),
    ("erp._dispatchPair", "erp._applyPair"),
    ("erp._bakeRun", "erp._applyLanded"),
    ("erp._applyLanded", "erp._applyPair"),
    ("erp._applyPair", "erp._applyCut"),
    ("erp._applyCut", "shp.loopsArea"),
    ("erp._applyCut", "erp._noteSeal"),
    ("erp._applyCut", "doc.eraseReplaceById"),
    ("erp._applyCut", "erp._resplitFamily"),
    ("eng._forceBake", "arc.bakeArcPerimeter"),
    ("arc.bakeArcPerimeter", "arc.ArcBakeJob.step"),
    ("doc.fillToShapeById", "shp.shapeFromRings"),
    ("doc.fillToShapeById", "shp.normalizeLoops"),
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
    ("shp.shapeBooleanOnce", "shp.winding"),       # other.winding(m): a RayIndex
    ("shp.winding", "shp.windingOfFlat"),
    ("shp.shapeBooleanOnce", "shp.stitch"),
    ("shp.shapeBooleanOnce", "shp.dropHairlines"),
    ("shp.shapeBooleanOnce", "shp.flatPieces"),
    ("shp.shapeBooleanOnce", "arc.subPiece"),
    ("shp.shapeBooleanOnce", "shp.onCurveOf"),
    ("shp.windingOfFlat", "shp.rayCross"),
    ("shp.normalizeLoops", "shp.loopsArea"),
    ("shp.loopsArea", "shp.loopArea"),

    # ---- the descent ----
    ("erp._dispatchPair", "eng._perf"),
    ("erp._applyPair", "erp._applyDescent"),
    ("eds.descentJob", "cde.cede"),
    ("eds.descentJob", "eds.squareInkOf"),          # world.squareInk || squareInkOf
    ("eds.squareInkOf", "lm.projectF"),
    ("eds.squareInkOf", "der.classifyUp"),
    ("cde.cede", "shp.subtractShape"),
    ("erp._applyDescent", "doc.removeById"),
    ("erp._applyDescent", "doc.recordBake"),
    ("erp._applyDescent", "erp._resplitFamily"),
    ("erp._applyDescent", "erp._refuse"),
    ("erp._refuse", "erp._rehomeBail"),
    ("doc.cedeTileById", "off.shiftDown"),
    ("doc.cedeTileById", "cde.cede"),
    ("cde.cede", "shp.rectLoop"),
    ("cde.cede", "shp.dropDust"),
    ("cde.cede", "shp.shapeComponents"),
    ("cde.cede", "doc.removeById"),
    ("cde.cede", "doc.add"),
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
    ("eng._render", "eng._listWin"),
    ("eng._render", "stg.sync"),
    ("eng._render", "stg.items"),
    ("eng._render", "rnd.render"),
    ("eng._render", "rnd.update"),
    ("eng._render", "eng._emit"),
    ("eng._render", "eng._perf"),
    ("eng._listWin", "cam.frameWindow"),
    ("stg.sync", "stg._rebuild"),
    ("stg._rebuild", "stg._readMissing"),
    ("stg._readMissing", "ts.readTiles"),
    ("eng._render", "lm.tileRange"),
    ("stg._rebuild", "lm.tileRange"),
    ("ts.readTiles", "ts._ensureUp"),
    ("ts.readTiles", "ts._ensureDown"),
    ("stg.sync", "ts.setCameraPins"),
    ("ts.setCameraPins", "ts._evict"),
    ("ts._ensureUp", "ts._bakeUp"),
    ("ts._bakeUp", "ts._upPiecesOver"),
    ("ts._upPiecesOver", "ts._ensureUp"),        # the chain: recursive
    ("ts._bakeUp", "lm.rectToParent"),
    ("ts._bakeUp", "lm.tileRect"),
    ("ts._bakeUp", "ts._cellNatives"),
    ("ts._cellNatives", "doc.queryRect"),
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
    ("der.shapeRingsInRect", "shp.clipShapeToRect"),
    ("der.shapeRingsInRect", "shp.flattenShape"),
    ("der.shapeRingsInRect", "shp.insideShape"),
    ("der.shapeRingsInRect", "shp.transformLoops"),

    # ---- one step of the chain ----
    ("der.deriveStep", "shp.transformLoopsAbout"),
    ("der.deriveStep", "fl.childTilePhase"),
    ("der.deriveStep", "der.tilePhaseOf"),
    ("der.deriveStep", "der.padRect"),
    ("der.deriveStep", "frz.chopFreezeLoops"),
    ("der.deriveStep", "der.shapeLoopsInRect"),
    ("der.deriveStep", "der.bandRings"),
    ("der.deriveStep", "der.bboxOf"),
    ("ts._solid", "der.seamPad"),
    ("der.deriveStep", "clp.clipRingsToRect"),
    ("der.deriveStep", "clp.clipPolylineToRect"),
    ("frz.chopFreezeLoops", "frz.pieceSagitta"),
    ("frz.chopFreezeLoops", "frz.arcCuts"),
    ("frz.chopFreezeLoops", "frz.freezePiece"),
    ("frz.chopFreezeLoops", "arc.subPiece"),
    ("frz.chopFreezeLoops", "arc.ptAt"),
    ("der.shapeLoopsInRect", "shp.clipShapeToRect"),
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
    ("rnd._buildInto", "rnd._pushArea"),
    ("rnd._pushArea", "rnd.pushShapeAnchors"),
    ("rnd._buildInto", "rnd.pushGapAnchors"),
    ("rnd._buildInto", "rnd._buildOutlineInto"),
    ("rnd._buildOutlineInto", "cvo.strokeLoops"),
    ("rnd._buildInto", "rnd._addShapePath"),
    ("rnd.pushShapeAnchors", "rnd.pushArcPiece"),
    ("shp.shapeToCubics", "shp.pieceToCubics"),
    ("rnd._addFillPath", "rnd.mkPath"),
    ("rnd._addShapePath", "rnd.mkPath"),
    ("rnd._applyOpacity", "rnd._groupOpacity"),
    ("rnd._groupOpacity", "rnd._fade"),
    ("rnd.syncWorld", "svo.render"),
    ("rnd.syncWorld", "rnd._renderSelOverlay"),
    ("rnd._renderSelOverlay", "svo.renderSelAnts"),

    # ---- camera ----
    ("eng.zoomFactorAt", "eng._zoomBy"),
    ("eng._zoomBy", "cam.zoomFactorAt"),
    ("eng._zoomBy", "eng._pend"),
    ("eng._pend", "eng._frame"),
    ("eng._frame", "eng._zoomStep"),
    ("eng._zoomBy", "eng._zoomStep"),
    ("eng._zoomStep", "eng._tableStep"),
    ("eng._zoomStep", "eng._visibleChanged"),
    ("eng._zoomStep", "rnd.needsFatFlip"),
    ("eng._zoomStep", "rnd.needsFadeFlip"),
    ("eng._zoomStep", "rnd.needsReorigin"),
    ("eng._zoomStep", "eng._render"),
    ("eng._zoomStep", "rnd.syncCameraOnly"),
    ("eng._zoomStep", "eng._queueIdleFits"),
    ("eng._zoomStep", "eng._perf"),
    ("eng.panBy", "cam.panBy"),
    ("eng.panBy", "eng._pend"),
    ("eng._frame", "eng._panStep"),
    ("eng.panBy", "eng._panStep"),
    ("eng._panStep", "eng._tableStep"),
    ("eng._panStep", "eng._visibleChanged"),
    ("eng._panStep", "eng._render"),
    ("eng._panStep", "rnd.syncCameraOnly"),
    ("eng._panStep", "eng._perf"),
    ("eng._tableStep", "eng._render"),
    ("eng._tableStep", "eng._syncStep"),
    ("eng._syncStep", "stg.sync"),
    ("eng._syncStep", "rr.syncCameraOnly"),
    ("cam.panBy", "cam._settle"),
    ("cam.zoomFactorAt", "eng.pointerUp"),        # finalizeLiveStroke hook
    ("cam.zoomFactorAt", "cam._maybeCross"),
    ("cam._maybeCross", "cam._settle"),
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
    ("lm.cellChild", "lm._addFrame"),
    ("lm._addFrame", "fl.cellEdge"),
    ("lm._addFrame", "fl.cellCentre"),
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
    ("eng._pointerUp", "sel._selectTap"),
    ("sel._selectTap", "sel.select"),
    ("eng._pointerMove", "sel._beginSelectDrag"),
    ("sel._beginSelectDrag", "sel.select"),
    ("sel._beginSelectDrag", "erp._dragBarrier"),
    ("erp._dragBarrier", "erp._eraseBarrier"),
    ("erp._eraseBarrier", "erp._barrierAdvance"),
    ("erp._barrierAdvance", "erp._dispatchPair"),
    ("sel._beginSelectDrag", "eng._beginHold"),
    ("eng._beginHold", "stg.hold"),
    ("sel._beginSelectDrag", "sel._dragSelection"),
    ("eng._hitTest", "eng._shapeHit"),
    ("eng._hitTest", "hit.distToPolyline"),
    ("sel._shapeHit", "shp.insideTester"),
    ("shp.insideShape", "shp.windingAt"),
    ("shp.windingAt", "shp.windingOfFlat"),
    ("eng.select", "eng._setSelection"),
    ("eng._setSelection", "doc.editKey"),
    ("sel._dragSelection", "stg.setDragDelta"),
    ("eng._pointerUp", "eng._endMove"),
    ("eng._endMove", "sel._dropMove"),
    ("sel._dropMove", "ts.setBatch"),
    ("sel._dropMove", "sel._selectionMembers"),
    ("sel._dropMove", "sel._dragFramesStart"),
    ("sel._dropMove", "sel._dragFrames"),
    ("sel._dropMove", "sel._displaceMember"),
    ("sel._displaceMember", "lm.displaceFrame"),
    ("sel._dropMove", "doc.rehomeManyById"),
    ("sel._dropMove", "doc.setOffsetsById"),
    ("eng._dragSelection", "eng._render"),
    ("eng._selectionMembers", "doc.editGroup"),
    ("erp._promoteOversize", "doc.translateGeometry"),
    ("doc.setGeometryById", "doc._afterEdit"),
    ("doc.translateGeometry", "shp.translateLoops"),
    ("doc.scaleGeometry", "shp.transformLoopsAbout"),
    ("doc.moveById", "shp.translateLoops"),
    ("doc.moveById", "doc._afterEdit"),
    ("doc._afterEdit", "doc._emit"),
    ("doc.rehomeById", "doc._emit"),
    ("doc.removeById", "doc._emit"),
    ("doc.removeById", "doc._forgetIfEmpty"),
    ("sel._applyLasso", "erp._lassoBarrier"),
    ("sel._applyLasso", "sel._judgeLasso"),
    ("sel._judgeLasso", "sel._lassoFind"),
    ("sel._judgeLasso", "sel._setSelection"),
    ("eng._lassoFind", "doc.queryRect"),
    ("eng._lassoFind", "eng._rectInActive"),
    ("eng._lassoFind", "las.rectInsidePolygon"),
    ("sel._rectInActive", "stg.placeNative"),
    ("las.rectInsidePolygon", "las.pointInPolygon"),
    ("las.rectInsidePolygon", "las.polygonMissesRect"),
    ("las.polygonMissesRect", "las.segsCross"),
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
if _dropped:
    raise AssertionError(
        "%d hand edge(s) in graph.E_HAND name no node - fix each to where the "
        "code now is, or delete it:\n%s" % (len(_dropped), "\n".join(
            "  (%r, %r)%s%s" % (a, b, "" if a in _KNOWN else "   <- %s is not a node" % a,
                                "" if b in _KNOWN else "   <- %s is not a node" % b)
            for a, b in _dropped)))

# `file:line` for every extracted edge, so a claim the graph makes can be
# checked against the source without reading the whole file.
SITES = {}
for _a, _b, _sites in _DATA["edges"]:
    SITES[(_a, _b)] = _sites
    if (_a, _b) not in _seen:
        _seen.add((_a, _b))
        E.append((_a, _b))

# A hand edge whose two ends are still nodes is not proof the call still
# exists: on 2026-09-22, 61 of 373 had stopped being calls (the cut moved into
# eraseJob, the descent into eraseDescent, the select tool out of
# `_pointerDown`) while both names lived on. So every hand edge must be found
# by the extractor, or name its callee inside the caller's body, or be listed
# here with how the call is made.
INDIRECT = {
    ("doc._emit", "ts._onDoc"): "a listener the TileStore constructor registers",
    ("cam.zoomFactorAt", "eng.pointerUp"): "the camera's finalizeLiveStroke hook, set by the engine",
    ("pyr._request", "jbq.push"): "the pyramid's onRequest hook, set by RasterRenderer._pyrBuild",
    ("jbq.pump", "rr._pyrSubmit"): "the queue's pool.submit, set by RasterRenderer._pyrBuild",
    ("rr._pyrPost", "rwc.dispatch"): "rasterPool.submit, the pool object rasterWorkerClient exports",
    ("rwc.onMessage", "rr._pyrResult"): "req.onResult, the callback _pyrPost hands the pool",
}


_TEXTS = {}


def is_call(a, b):
    """Is a -> b a call the source still makes? Found by the extractor, listed
    in INDIRECT, or the callee's name appears in the caller's (masked) body.
    The Call Map's trees are checked with this too (check.py)."""
    import re
    from _mask import mask
    if (a, b) in SITES or (a, b) in INDIRECT:
        return True
    U, MF = _DATA["universe"], _DATA["modfile"]
    mod, rest = a.split(".", 1)
    d = U.get(mod, {}).get(rest)
    if not d:
        return False
    if mod not in _TEXTS:
        _TEXTS[mod] = mask(open(os.path.join(HERE, "..", "..", MF[mod]),
                                encoding="utf-8", errors="replace").read()).split("\n")
    body = "\n".join(_TEXTS[mod][d["lo"] - 1:d["hi"]])
    leaf = b.split(".")[-1]
    if leaf == "constructor":
        leaf = b.split(".")[-2]
    return bool(re.search(r"\b" + re.escape(leaf) + r"\b", body))


def _unproven():
    return [(a0, b0) for a0, b0 in E_HAND if not is_call(_fix(a0), _fix(b0))]


_stale = _unproven()
if _stale:
    raise AssertionError(
        "%d hand edge(s) in graph.E_HAND are no longer calls - the caller's body "
        "does not name the callee and the extractor does not find it. Fix each to "
        "where the call now is, delete it, or list it in INDIRECT with how it is "
        "made:\n%s" % (len(_stale), "\n".join("  (%r, %r)" % e for e in _stale)))

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
