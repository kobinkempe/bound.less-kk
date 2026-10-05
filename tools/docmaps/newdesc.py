# -*- coding: utf-8 -*-
"""Every per-function entry, merged, plus where each one belongs on the Code Map.

An entry carries BOTH the Code Map's one-line "what it does" and the
comprehensive explanation the expandable row and the graph panel show, so the
two documents are generated from one source and cannot drift apart.

This module is also the one map from Code Map article to the modules it
documents (`ARTMOD`), which `audit_stale` checks rows against and
`descriptions` resolves a node's one-liner through.
"""
import os, re, sys, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# In order: a later file's entry for the same key wins. The 2026-09-22 files
# cover the functions the 2026-08-31 build did not name, one area each. A
# missing file is reported, not fatal: its functions then show as gaps in
# verify_coverage, which is the check that has to pass.
_NAMES = ("newdesc_scale", "newdesc_scale2", "newdesc_rules", "newdesc_shell",
          "newdesc_ui", "newdesc_oracle", "newdesc_last",
          "newdesc_geom", "newdesc_engine", "newdesc_store",
          "newdesc_paper", "newdesc_raster1", "newdesc_raster3",
          "newdesc_raster4", "newdesc_scenes", "newdesc_local", "newdesc_cloud",
          "newdesc_report",
          # 2026-10-05, the renderer and document-model rebuild's files
          "newdesc_rb_stage", "newdesc_rb_pyramid", "newdesc_rb_pyrparts", "newdesc_rb_svg",
          "newdesc_rb_model", "newdesc_rb_m1")
_SOURCES = []
for _n in _NAMES:
    if os.path.exists(os.path.join(HERE, _n + ".py")):
        _SOURCES.append(importlib.import_module(_n))
    else:
        sys.stderr.write("newdesc: %s.py is missing - its functions will show as gaps\n" % _n)

E, FIX, ROLE = {}, {}, {}
for m in _SOURCES:
    E.update(m.E)
    FIX.update(getattr(m, "FIX", {}))
    ROLE.update(getattr(m, "ROLE", {}))

# A FIX replaces what an entry said when the code under it changed. For an entry
# in `E` it is applied here; for a hand-written text (the pristine page, long_*.py)
# longdesc applies it, and a false pristine ROW is corrected in the pristine page.
# A FIX for a function that is gone removes its entry - only when the graph agrees
# it is gone, so a mistaken "gone" shows up as a gap in verify_coverage.
def _nodes():
    import json
    return set(json.load(open(os.path.join(HERE, "data", "graphdata.json")))["nodes"])


_NODES = _nodes()
for _k, _f in FIX.items():
    if (_f.get("why") or "").lower().startswith("gone") and _k in E and _k not in _NODES:
        del E[_k]
for _k, _f in FIX.items():
    if _k in E:
        if _f.get("fn"):
            E[_k]["fn"] = _f["fn"]
        if _f.get("what"):
            E[_k]["what"] = _f["what"]
        if _f.get("long"):
            E[_k]["long"] = _f["long"]
        if _f.get("ref"):
            E[_k]["ref"] = _f["ref"]

# The long descriptions, keyed exactly as the graph keys its nodes.
LONG = {k: v["long"] for k, v in E.items() if v["long"] and v["long"] != ["-"]}

# --------------------------------------------------------------------------
# The generated articles, in reading order.
# (id, heading, role sentence or None for the files' own ROLE, css class,
#  [module keys], slot)
# `slot` names the `<!-- SLOT:name -->` marker in the pristine page they replace.
# --------------------------------------------------------------------------
_R = None
ARTICLES = [
    # ---- the saved form (layer: Truth) --------------------------------------
    ("tr-format2", "format2.js", _R, "ob", ["f2"], "truth"),
    ("tr-oplog", "oplog.js", _R, "ob", ["opl"], "truth"),
    ("tr-legacy", "legacy/modelV1.js", _R, "ob", ["lv1"], "truth"),
    # ---- the stored loop, the displacement table, chord arithmetic (Ink) ---
    ("in-loop", "geometry/loop.js", _R, "ob", ["lop"], "ink"),
    ("in-offsets", "geometry/offsets.js", _R, "ob", ["off"], "ink"),
    ("in-chordmath", "geometry/chordMath.js", _R, "ob", ["chm"], "ink"),
    # ---- space: the lattice kept small ------------------------------------
    ("sp-framegc", "frameGc.js", _R, "sp", ["fgc"], "space"),
    # ---- views: the scene both renderers draw -----------------------------
    ("vw-stage", "Stage.js", _R, "sp", ["stg"], "views"),
    ("vw-placement", "placementModel.js", _R, "sp", ["plm"], "views"),
    # ---- the paper: the raster renderer -----------------------------------
    ("pa-raster", "raster/RasterRenderer.js", _R, "sp", ["rr"], "paper"),
    ("pa-pyramid", "raster/PicturePyramid.js", _R, "sp", ["pyr"], "paper"),
    ("pa-pyrstore", "raster/PyramidStore.js", _R, "sp", ["pys"], "paper"),
    ("pa-level", "raster/level.js", _R, "sp", ["lvl"], "paper"),
    ("pa-queue", "raster/jobQueue.js", _R, "sp", ["jbq"], "paper"),
    ("pa-prefetch", "raster/prefetch.js", _R, "sp", ["pft"], "paper"),
    ("pa-plate", "raster/plate.js", _R, "sp", ["plt"], "paper"),
    ("pa-pack", "raster/rasterPack.js", _R, "sp", ["rpk"], "paper"),
    ("pa-job", "raster/rasterJob.js", _R, "sp", ["rjb"], "paper"),
    ("pa-core", "raster/rasterCore.js", _R, "sp", ["rco"], "paper"),
    ("pa-workers", "raster/rasterWorkerClient.js · worker/rasterWorker.js", _R, "sp",
     ["rwc", "rwk"], "paper"),
    ("pa-move", "raster/MovePlane.js", _R, "sp", ["mvp"], "paper"),
    ("pa-live", "raster/LiveStrokeLayer.js", _R, "sp", ["lsl"], "paper"),
    ("pa-svglayer", "raster/SvgLayer.js", _R, "sp", ["svl"], "paper"),
    ("pa-svgoverlay", "raster/svgOverlay.js", _R, "sp", ["svo"], "paper"),
    ("pa-anchors", "raster/svgAnchors.js", _R, "sp", ["sva"], "paper"),
    ("pa-overlay", "raster/OverlayLayer.js", _R, "sp", ["ovy"], "paper"),
    ("pa-ants", "raster/antPaint.js", _R, "sp", ["anp"], "paper"),
    ("pa-perf", "raster/rasterPerf.js", _R, "mu", ["rpf"], "paper"),
    # ---- connectivity and hits --------------------------------------------
    ("co-antruns", "geometry/antRuns.js", _R, "mu", ["ant"], "hits"),
    # ---- the facade: the erase jobs and the report -------------------------
    ("fa-erasejob", "eraseJob.js", _R, "ob", ["ejb"], "facade"),
    ("fa-descent", "eraseDescent.js", _R, "ob", ["eds"], "facade"),
    ("fa-eraseworker", "eraseWorkerClient.js", _R, "ob", ["ewc"], "facade"),
    ("fa-eraserule", "eraseRule.js", _R, "ob", ["eru"], "facade"),
    ("fa-cede", "cede.js", _R, "ob", ["cde"], "facade"),
    ("fa-levers", "devLevers.js", _R, "mu", ["dvl"], "facade"),
    ("fa-report", "report.js", _R, "mu", ["rep"], "facade"),
    # ---- features: the scene index -----------------------------------------
    ("sc-index", "sceneIndex.js", _R, "mu", ["six"], "scenes"),
    ("sc-client", "sceneClient.js · sceneWorkerClient.js", _R, "mu", ["scc", "swc"], "scenes"),
    # ---- the scale bar, one article per module -----------------------------
    ("sb-catalog", "scaleBar/catalog.js",
     "Physical truth only: how big each unit is, what it is called, how it prefixes. No ladders, no bands, no rungs.",
     "mu", ["cat"], "scalebar"),
    ("sb-membership", "scaleBar/membership.js",
     "Which units belong together, in what order, and which ladder wins when several own a unit.",
     "mu", ["mem"], "scalebar"),
    ("sb-preference", "scaleBar/preference.js",
     "The magnitudes each unit is preferred to display in — data, per ladder and unit.",
     "mu", ["pref"], "scalebar"),
    ("sb-prefrange", "scaleBar/preferenceRange.js",
     "A preferred span as a first-class object. Two kinds, differing only in priority and in what counts as a claim.",
     "mu", ["prng"], "scalebar"),
    ("sb-ladder", "scaleBar/ladder.js",
     "One ladder as an object that answers for itself — including every legal bar it could show at a given zoom.",
     "mu", ["lad"], "scalebar"),
    ("sb-nice", "scaleBar/nice.js",
     "The round numbers a bar is allowed to show, and how a number is written down.",
     "mu", ["nic"], "scalebar"),
    ("sb-logmath", "scaleBar/logMath.js",
     "Everything on the log spine, so a range spanning sixty orders of magnitude is linear and nothing throws.",
     "mu", ["lmt"], "scalebar"),
    ("sb-resolve", "scaleBar/resolve.js",
     "The resolution: the lowest in-range number wins. One rule, replacing every handoff table the specification used to list.",
     "mu", ["rsv"], "scalebar"),
    ("sb-pick", "scaleBar/pick.js",
     "What a reader's unit pick does — switch ladders, or install a range whose edges are found by scanning the resolver.",
     "mu", ["pck"], "scalebar"),
    ("sb-session", "scaleBar/session.js",
     "The sticky per-canvas display state, and the guard that stops a stale result overwriting a fresh pick.",
     "mu", ["ses"], "scalebar"),
    ("sb-rungs", "scaleBar/rungs.js",
     "The picker's rungs: cumulative unions, with any rung that adds nothing skipped.",
     "mu", ["rng"], "scalebar"),
    ("sb-rules", "scaleBar/logicRule.js",
     "Eighteen named membership rules. The rungs are ordered lists of these objects, so a rule can move without either changing.",
     "mu", ["lrl"], "scalebar"),
    ("sb-format", "scaleBar/format.js · validate.js · index.js",
     "The visible label, the persisted definition, and the facade the editor calls.",
     "mu", ["fmt", "val", "sbi"], "scalebar"),
    # ---- the shell ---------------------------------------------------------
    ("sh-hook", "hooks/useKobinEngine.js", _R, "mu", ["hok"], "shell"),
    ("sh-report", "hooks/reportSend.js", _R, "mu", ["rps"], "shell"),
    ("sh-db", "storage/db.js", _R, "mu", ["db"], "shell"),
    ("sh-local", "storage/localCanvases.js", _R, "mu", ["loc"], "shell"),
    ("sh-foldstore", "storage/foldStore.js", _R, "mu", ["fld"], "shell"),
    ("sh-thumbs", "storage/thumbnails.js", _R, "mu", ["thm"], "shell"),
    ("sh-session", "cloud/canvasSession.js", _R, "mu", ["css"], "shell"),
    ("sh-synccore", "cloud/syncCore.js", _R, "mu", ["syn"], "shell"),
    ("sh-storagelocks", "cloud/storageLocks.js", _R, "mu", ["slk"], "shell"),
    ("sh-cloud", "cloud/canvasSync.js", _R, "mu", ["cld"], "shell"),
    ("sh-store2", "cloud/store2.js · gzip.js · lzWorker.js", _R, "mu", ["st2", "gz", "lzw"], "shell"),
    ("sh-auth", "cloud/useUser.js · cloud/firebaseApp.js",
     "Sign-in, and the connection. Both lazy, so importing them starts nothing.",
     "mu", ["usr", "fba"], "shell"),
    ("sh-pages", "Pages · App",
     "The routes, the gallery, the editor. None of it holds geometry.",
     "mu", ["app", "edt", "gal", "hom", "nfd"], "shell"),
    ("sh-components", "Components",
     "The interface primitives. There is no component library here — everything visual is one stylesheet.",
     "mu", ["brd", "btn", "inp", "sci", "cmp", "cpp", "fam", "sdd", "sdb",
            "sup", "syc", "wop", "aps", "cka", "dvs", "erc", "shd", "col",
            "reportWebVitals"], "shell"),
    # ---- not running -------------------------------------------------------
    ("nr-v0", "KobinEngineV0.js",
     "The retired pre-lattice engine, kept as the golden oracle the current one is compared against. Not on any route.",
     "mu", ["v0"], "dead"),
    ("nr-curveperim", "__oracles__/curvePerimeter.js",
     "The cubic-pipeline perimeter resolve, superseded by the arc one. Kept as the independent implementation the arc tests cross-check against.",
     "mu", ["cvp"], "dead"),
    ("nr-strokeshape", "__oracles__/strokeShape.js",
     "The polyline Minkowski bake. Retired because chording the centerline creases every bend by an angle, and an angle does not shrink with zoom.",
     "mu", ["sks"], "dead"),
    ("nr-bakestrat", "__oracles__/bakeStrategies.js",
     "The three bake schedules — when the work happens, not how it is computed. Driven by the cross-checking tests.",
     "mu", ["bks"], "dead"),
    ("nr-cede", "__oracles__/cede.js",
     "The float guillotine, superseded by the exact arc boolean. Suites still use it to make test geometry.",
     "mu", ["ced"], "dead"),
    ("nr-erase", "__oracles__/erase.js",
     "What is left of the superseded “a cut is a recipe every bake re-runs” model.",
     "mu", ["ers"], "dead"),
    ("nr-coverage", "__oracles__/coverageOracle.js", _R, "mu", ["cov"], "dead"),
    ("nr-sceneoracle", "__oracles__/sceneOracle.js", _R, "mu", ["sor"], "dead"),
    ("nr-renderlist", "__oracles__/renderList.js", _R, "mu", ["rls"], "dead"),
]
# The frozen pre-C1 model: one article per file, in the order of the live files'.
M1FILES = (("m1eng", "KobinEngine"), ("m1erp", "erasePipeline"), ("m1ovl", "overlays"),
           ("m1sel", "selection"), ("m1sco", "sceneOps"), ("m1fil", "files"),
           ("m1eds", "eraseDescent"), ("m1ewc", "eraseWorkerClient"), ("m1cde", "cede"),
           ("m1lm", "LevelMap"), ("m1gc", "frameGc"), ("m1ts", "TileStore"),
           ("m1rnd", "Renderer"), ("m1stg", "Stage"), ("m1plm", "placementModel"),
           ("m1doc", "Document"), ("m1per", "persist"), ("m1f2", "format2"),
           ("m1opl", "oplog"), ("m1off", "offsets"), ("m1scc", "sceneClient"),
           ("m1shm", "rasterShim"))
for _k, _f in M1FILES:
    ARTICLES.append(("nr-" + _k, "__oracles__/model-v1/%s.js" % _f, _R, "mu", [_k], "dead"))

# Entries for a module the pristine page documents article by article are
# appended to that article rather than given one of their own. One article per
# module, so a row cannot land twice.
APPEND_TO = {
    "frameLattice": ["fl"], "Camera": ["cam"], "LevelMap": ["lm"],
    "Document": ["doc"], "persist": ["per"], "arcPerimeter": ["arc"],
    "arcShape": ["shp"], "biarc": ["bia"], "freeze": ["frz"],
    "derive": ["der"], "connect": ["con"], "hittest": ["hit"], "lasso": ["las"],
    "clipperOutline": ["ply", "clb"], "curveOutline": ["cvo"],
    "TileStore": ["ts"], "Renderer": ["rnd"],
    # The engine is one prototype in six files; its subject articles take
    # the extra rows of the file each subject now lives in.
    "engine-diag": ["ins"],
    "engine-life": ["eng", "rmt", "mix", "now"],
    "engine-erase": ["erp"],
    "engine-select": ["sel", "ovl"],
    "engine-files": ["fil", "sco"],
}

# The pristine page's hand-written articles and every module each one's rows
# may name. The engine articles are organised by SUBJECT, so a row in one may
# name a method of any engine file.
_ENGINE = ["eng", "erp", "ovl", "sel", "sco", "fil", "ins", "rmt", "mix", "now"]
PRISTINE = {
    "frameLattice": ["fl"], "Camera": ["cam"], "LevelMap": ["lm"],
    "Document": ["doc"], "persist": ["per"], "biarc": ["bia"],
    "arcPerimeter": ["arc"], "arcShape": ["shp"], "freeze": ["frz"],
    "derive": ["der"], "TileStore": ["ts"], "Renderer": ["rnd"],
    "connect": ["con"], "hittest": ["hit"], "lasso": ["las"],
    "clipperOutline": ["ply", "clb"], "curveOutline": ["cvo"],
    "engine-diag": _ENGINE, "engine-life": _ENGINE, "engine-input": _ENGINE,
    "engine-erase": _ENGINE, "engine-select": _ENGINE, "engine-files": _ENGINE,
}

# Article id -> every module its rows may name. The one map; audit_stale and
# descriptions both read it.
ARTMOD = {k: list(v) for k, v in PRISTINE.items()}
for _a, _t, _r, _c, _m, _s in ARTICLES:
    ARTMOD[_a] = list(_m)
for _a, _m in APPEND_TO.items():
    ARTMOD.setdefault(_a, [])
    ARTMOD[_a] += [x for x in _m if x not in ARTMOD[_a]]

# The article a module's OWN entries are listed in: where its one-liners live.
HOME = {}
for _a, _t, _r, _c, _m, _s in ARTICLES:
    for _x in _m:
        HOME[_x] = _a
for _a, _m in APPEND_TO.items():
    for _x in _m:
        HOME.setdefault(_x, _a)


def role_of(article):
    """An article's role sentence: its own, or its files' ROLE texts."""
    aid, title, role, css, mods, slot = article
    if role:
        return role
    import json
    modfile = json.load(open(os.path.join(HERE, "data", "graphdata.json")))["modfile"]
    parts = [ROLE[modfile[m]] for m in mods if modfile.get(m) in ROLE]
    if not parts:
        sys.stderr.write("newdesc: article %s has no role text (no ROLE for %s)\n"
                         % (aid, ", ".join(modfile.get(m, m) for m in mods)))
        return ""
    return " ".join(parts)


def _source_line():
    import json
    uni = json.load(open(os.path.join(HERE, "data", "graphdata.json")))["universe"]
    return {m + "." + n: d["lo"] for m, names in uni.items() for n, d in names.items()}


_LINE = _source_line()


def entries_for(mods):
    """Every entry whose key is in one of these modules: module by module in the
    order given, each in source order (an entry the source no longer has last),
    so an entry's place on the page does not depend on which area file holds it."""
    out = [(k, v) for k, v in E.items() if k.split(".", 1)[0] in mods]
    out.sort(key=lambda kv: (mods.index(kv[0].split(".", 1)[0]),
                             _LINE.get(kv[0], 10 ** 9)))
    return out


# --------------------------------------------------------------------------
# SECTION-SCOPED keys, so an ambiguous leaf name resolves to the right entry.
# `wrap` exists in three modules and `bandFor` in two; enhance_codemap tries
# "@<article-id>.<name>" before it falls back to a bare-name map, so emitting
# these makes every row's lookup exact.
# --------------------------------------------------------------------------
SCOPED = {}
# scoped key -> the canonical `module.function` id, so a Code Map detail can be
# headed with the same name the call graph gives the node.
KEY_OF = {}


def body(v):
    """The explanation to show. A one-liner is still an explanation: an entry
    marked trivial falls back to its Code Map sentence rather than to nothing,
    so no function anywhere opens into a blank panel."""
    return v["long"] if (v["long"] and v["long"] not in (["-"], ["—"])) else [v["what"]]


# Explanations for functions the pristine page ALREADY has a row for, where
# the row used to be named after a sibling that has since gone. They are not in
# `E`, so they add no second row - only the missing explanation.
EXTRA = {
    ("LevelMap", "lm.framePointToScreen"): [
        "A point in one frame, in screen pixels.",
        "Two steps, and the split is the whole point: `mapPointF` carries the point into the ACTIVE frame - address arithmetic, exact, and independent of where the view happens to be - and only then does the in-frame zoom and pan turn it into pixels.",
        "It returns null rather than a guess when either frame id is unknown, because the caller is drawing an overlay and a wrong pixel is worse than no overlay.",
    ],
    ("LevelMap", "lm.effectiveZoom"): [
        "Absolute zoom: the in-frame scale times the factor from the origin spine's level-0 frame to the active one.",
        "Falls back to the in-frame scale when either frame is unknown. The scale bar reads it through `Camera.effectiveZoom`, and `sceneZoom` through the engine.",
    ],
    ("biarc", "bia.tracePath"): [
        "Lay a resolved chain into a canvas path.",
        "Straight pieces and pieces whose sagitta is under `flatTol` go down as `lineTo`; everything else as `ctx.arc`, which rasterises the true arc rather than an approximation of it.",
        "`flatTol` arrives in world units from the caller, because the caller knows the zoom and this module deliberately does not. An arc of radius 5e17 that bows less than a pixel is a straight line to the eye, and drawing it as one keeps a number the rasteriser cannot hold out of the rasteriser.",
    ],
}

# Every entry, trivial ones included, keyed as the graph keys its nodes.
FULL = {k: body(v) for k, v in E.items()}
for (_aid, _k), _long in EXTRA.items():
    FULL[_k] = _long


def _scope(aid, mods):
    for k, v in entries_for(mods):
        leaf = k.split(".")[-1]
        for form in (leaf, k.split(".", 1)[1]):
            SCOPED["@" + aid + "." + form] = body(v)
            KEY_OF["@" + aid + "." + form] = k


for (_aid, _k), _long in EXTRA.items():
    SCOPED["@" + _aid + "." + _k.split(".")[-1]] = _long
    KEY_OF["@" + _aid + "." + _k.split(".")[-1]] = _k

for _a, _t, _r, _c, _m, _s in ARTICLES:
    _scope(_a, _m)
for _aid, _mods in APPEND_TO.items():
    if _mods:
        _scope(_aid, _mods)
