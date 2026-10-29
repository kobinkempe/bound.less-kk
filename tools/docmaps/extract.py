# -*- coding: utf-8 -*-
"""Extract call edges from the bound.less source, with a file:line for each.

Every edge this emits corresponds to a real call site, so the graph stays what
its header claims: read off the source, not inferred. Anything that cannot be
resolved to a known node is dropped rather than guessed.

Run from the repository root, after `inventory.py`. Every file the inventory
names must have a module key in MODFILE, or this stops and names the file.
"""
import os, re, json, collections, sys

from _mask import mask

HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = "src"
BS = chr(92)

# module key -> source file. Keys match graph.py's MOD/MODNAME vocabulary.
MODFILE = {
    # the engine: one prototype in six files, and what it is built from
    "eng": "src/engine/KobinEngine.js",
    "erp": "src/engine/erasePipeline.js",
    "ovl": "src/engine/overlays.js",
    "sel": "src/engine/selection.js",
    "sco": "src/engine/sceneOps.js",
    "fil": "src/engine/files.js",
    "ins": "src/engine/instruments.js",
    "rmt": "src/engine/rectMath.js",
    "mix": "src/engine/mixin.js",
    "now": "src/engine/now.js",
    "ejb": "src/engine/eraseJob.js",
    "eds": "src/engine/eraseDescent.js",
    "ewc": "src/engine/eraseWorkerClient.js",
    "rep": "src/engine/report.js",
    "eru": "src/engine/eraseRule.js",
    "cde": "src/engine/cede.js",
    "dvl": "src/engine/devLevers.js",
    # space, the store and the saved form
    "cam": "src/engine/Camera.js",
    "lm":  "src/engine/LevelMap.js",
    "fgc": "src/engine/frameGc.js",
    "ts":  "src/engine/TileStore.js",
    "rnd": "src/engine/Renderer.js",
    "stg": "src/engine/Stage.js",
    "plm": "src/engine/placementModel.js",
    "doc": "src/engine/Document.js",
    "per": "src/engine/persist.js",
    "f2":  "src/engine/format2.js",
    "opl": "src/engine/oplog.js",
    "lv1": "src/engine/legacy/modelV1.js",
    "fl":  "src/engine/frameLattice.js",
    # the scene index
    "six": "src/engine/sceneIndex.js",
    "scc": "src/engine/sceneClient.js",
    "swc": "src/engine/sceneWorkerClient.js",
    # the raster renderer: the paper
    "rr":  "src/engine/raster/RasterRenderer.js",
    "pyr": "src/engine/raster/PicturePyramid.js",
    "pys": "src/engine/raster/PyramidStore.js",
    "lvl": "src/engine/raster/level.js",
    "jbq": "src/engine/raster/jobQueue.js",
    "pft": "src/engine/raster/prefetch.js",
    "lsl": "src/engine/raster/LiveStrokeLayer.js",
    "svl": "src/engine/raster/SvgLayer.js",
    "svo": "src/engine/raster/svgOverlay.js",
    "sva": "src/engine/raster/svgAnchors.js",
    "ovy": "src/engine/raster/OverlayLayer.js",
    "mvp": "src/engine/raster/MovePlane.js",
    "anp": "src/engine/raster/antPaint.js",
    "plt": "src/engine/raster/plate.js",
    "pcd": "src/engine/raster/plateCodec.js",
    "prm": "src/engine/raster/plateRam.js",
    "fvw": "src/engine/raster/firstView.js",
    "rco": "src/engine/raster/rasterCore.js",
    "rjb": "src/engine/raster/rasterJob.js",
    "rpk": "src/engine/raster/rasterPack.js",
    "rpf": "src/engine/raster/rasterPerf.js",
    "rwc": "src/engine/raster/rasterWorkerClient.js",
    "rwk": "src/engine/worker/rasterWorker.js",
    # geometry
    "shp": "src/engine/geometry/arcShape.js",
    "arc": "src/engine/geometry/arcPerimeter.js",
    "bia": "src/engine/geometry/biarc.js",
    "frz": "src/engine/geometry/freeze.js",
    "der": "src/engine/geometry/derive.js",
    "con": "src/engine/geometry/connect.js",
    "las": "src/engine/geometry/lasso.js",
    "hit": "src/engine/geometry/hittest.js",
    "ply": "src/engine/geometry/polyline.js",
    "clb": "src/engine/geometry/clipperBoolean.js",
    "cvo": "src/engine/geometry/curveOutline.js",
    "lop": "src/engine/geometry/loop.js",
    "off": "src/engine/geometry/offsets.js",
    "chm": "src/engine/geometry/chordMath.js",
    "ant": "src/engine/geometry/antRuns.js",
    # the scale bar
    "sbi": "src/engine/scaleBar/index.js",
    "cat": "src/engine/scaleBar/catalog.js",
    "mem": "src/engine/scaleBar/membership.js",
    "pref": "src/engine/scaleBar/preference.js",
    "prng": "src/engine/scaleBar/preferenceRange.js",
    "lad": "src/engine/scaleBar/ladder.js",
    "nic": "src/engine/scaleBar/nice.js",
    "lmt": "src/engine/scaleBar/logMath.js",
    "rsv": "src/engine/scaleBar/resolve.js",
    "pck": "src/engine/scaleBar/pick.js",
    "ses": "src/engine/scaleBar/session.js",
    "rng": "src/engine/scaleBar/rungs.js",
    "lrl": "src/engine/scaleBar/logicRule.js",
    "fmt": "src/engine/scaleBar/format.js",
    "val": "src/engine/scaleBar/validate.js",
    # shell, storage, cloud
    "hok": "src/hooks/useKobinEngine.js",
    "rps": "src/hooks/reportSend.js",
    "db":  "src/storage/db.js",
    "loc": "src/storage/localCanvases.js",
    "thm": "src/storage/thumbnails.js",
    "fld": "src/storage/foldStore.js",
    "cld": "src/cloud/canvasSync.js",
    "css": "src/cloud/canvasSession.js",
    "syn": "src/cloud/syncCore.js",
    "slk": "src/cloud/storageLocks.js",
    "st2": "src/cloud/store2.js",
    "gz":  "src/cloud/gzip.js",
    "lzw": "src/cloud/lzWorker.js",
    "fba": "src/cloud/firebaseApp.js",
    "usr": "src/cloud/useUser.js",
    "edt": "src/Pages/CanvasEditor.js",
    "gal": "src/Pages/CanvasesV2.js",
    "app": "src/App.js",
    "hom": "src/Pages/HomeV2.js",
    "nfd": "src/Pages/NotFoundPage.js",
    "col": "src/utils/color.js",
    # components
    "cmp": "src/Components/ui/Dialog.js",
    "sci": "src/Components/ui/SciText.js",
    "btn": "src/Components/ui/Button.js",
    "inp": "src/Components/ui/Input.js",
    "brd": "src/Components/BrandLogo.js",
    "cpp": "src/Components/editor/ColorPickerPopover.js",
    "fam": "src/Components/editor/FileActionsMenu.js",
    "sdd": "src/Components/editor/SaveDrawingDialog.js",
    "sdb": "src/Components/editor/ScaleDragBar.js",
    "sup": "src/Components/editor/ScaleUnitPicker.js",
    "syc": "src/Components/editor/SyncChip.js",
    "wop": "src/Components/editor/WidthOpacityPanel.js",
    "aps": "src/Components/editor/useAnchorPopoverStyle.js",
    "cka": "src/Components/editor/useClickAway.js",
    "dvs": "src/Components/editor/DevStats.js",
    "erc": "src/Components/editor/EraseChip.js",
    "shd": "src/Components/editor/ScaleHud.js",
    # not running: the oracles (src/engine/__oracles__)
    "v0":  "src/engine/__oracles__/KobinEngineV0.js",
    "cvp": "src/engine/__oracles__/curvePerimeter.js",
    "sks": "src/engine/__oracles__/strokeShape.js",
    "bks": "src/engine/__oracles__/bakeStrategies.js",
    "ced": "src/engine/__oracles__/cede.js",
    "ers": "src/engine/__oracles__/erase.js",
    "cov": "src/engine/__oracles__/coverageOracle.js",
    "sor": "src/engine/__oracles__/sceneOracle.js",
    "rls": "src/engine/__oracles__/renderList.js",
    "reportWebVitals": "src/reportWebVitals.js",
}
# The frozen pre-C1 model (`__oracles__/model-v1/`, A1 §14): one key per file, `m1` + the
# live file's key where there is one, so its classes never resolve into the live ones.
for _k, _f in (("m1eng", "KobinEngine"), ("m1erp", "erasePipeline"), ("m1ovl", "overlays"),
               ("m1sel", "selection"), ("m1sco", "sceneOps"), ("m1fil", "files"),
               ("m1eds", "eraseDescent"), ("m1ewc", "eraseWorkerClient"), ("m1cde", "cede"),
               ("m1lm", "LevelMap"), ("m1gc", "frameGc"), ("m1ts", "TileStore"),
               ("m1rnd", "Renderer"), ("m1stg", "Stage"), ("m1plm", "placementModel"),
               ("m1doc", "Document"), ("m1per", "persist"), ("m1f2", "format2"),
               ("m1opl", "oplog"), ("m1off", "offsets"), ("m1scc", "sceneClient"),
               ("m1shm", "rasterShim")):
    MODFILE[_k] = "src/engine/__oracles__/model-v1/%s.js" % _f
FILEMOD = {v: k for k, v in MODFILE.items()}

# `this.<field>` -> the module(s) that field holds an instance of. Hand-written,
# because these are assigned from an import, behind a condition or a default,
# and the assignment does not name one class. Everything else is learned
# exactly, below, from `this.x = new SomeClass()`.
#
# The engine's `renderer` is a RasterRenderer by default and a Renderer under
# `?svg` (two classes, neither extending the other), so a call on it is a call
# into whichever of the two defines the method - both, when both do.
#
# A value is `module:Class` where the module defines more than one class, so
# `this.doc.add()` reaches `Document.add` and not `LevelIndex.add`.
_ENGINE_FIELDS = {"lm": "lm:LevelMap", "doc": "doc:Document", "cam": "cam:Camera",
                  "store": "ts:TileStore", "stage": "stg:Stage",
                  "renderer": ["rr:RasterRenderer", "rnd:Renderer"],
                  "plates": "pys:PyramidStore", "_sceneClient": "scc:SceneClient"}
# The frozen model's engine: its own document, lattice, tile store, scene and
# renderers (`rasterShim` stands in for the raster one), the live Camera.
_M1_FIELDS = {"lm": "m1lm:LevelMap", "doc": "m1doc:Document", "cam": "cam:Camera",
              "store": "m1ts:TileStore", "stage": "m1stg:Stage",
              "renderer": ["m1shm:RasterRenderer", "m1rnd:Renderer"],
              "plates": "m1shm:PlateStore", "_sceneClient": "m1scc:SceneClient"}
FIELD = {
    "ts":  {"lm": "lm:LevelMap", "doc": "doc:Document"},
    "cam": {"lm": "lm:LevelMap"},
    "rnd": {"cam": "cam:Camera", "two": None},
    "rr":  {"cam": "cam:Camera", "layer": "pyr:PicturePyramid",
            "_overlay": "ovy:OverlayLayer", "_plane": "mvp:MovePlane"},
    "scc": {"core": "six:SceneIndex"},
    "m1ts":  {"lm": "m1lm:LevelMap", "doc": "m1doc:Document"},
    "m1rnd": {"cam": "cam:Camera", "two": None},
    "m1scc": {"core": "six:SceneIndex"},
    "v0":  {},
}

# ONE PROTOTYPE, SIX FILES. `engine/mixin.js` copies five mixin classes onto
# KobinEngine's prototype, so `this._queueBake()` in `KobinEngine.js` reaches a
# method defined in `erasePipeline.js`. Without this the hand-list agreement
# fell from 88% to 77% (2026-08-31). The frozen model's engine is a second
# such prototype over its own six files.
PROTOTYPES = (("eng", "erp", "ovl", "sel", "sco", "fil"),
              ("m1eng", "m1erp", "m1ovl", "m1sel", "m1sco", "m1fil"))
PROTO_OF = {m: grp for grp in PROTOTYPES for m in grp}
# Every file mixed onto an engine's prototype sees the same `this` and so the
# same fields.
for _grp, _fields in zip(PROTOTYPES, (_ENGINE_FIELDS, _M1_FIELDS)):
    for _m in _grp:
        FIELD[_m] = dict(_fields)

KW = {"if", "for", "while", "switch", "catch", "return", "function", "typeof",
      "new", "do", "else", "try", "await", "yield", "in", "of", "case",
      "default", "delete", "void", "this", "super", "constructor"}

# The same list minus `constructor`, for DEFINITIONS. A constructor is a real
# function with real call sites in it, so it has to become a node. It stays in
# KW above, because `new Foo()` at a CALL site is not a call to a method named
# "constructor".
KW_DEF = KW - {"constructor"}

# A local declaration inside a definition, and a definition line's parameters.
LOCAL_DECL = re.compile(r'\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)')
PARAMS = re.compile(r'^[^(]*\(([^)]*)\)')

_Q = "[\"']"
IMPORT_NAMED = re.compile(
    r'import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+' + _Q + r'([^"\']+)' + _Q, re.S)
IMPORT_NS = re.compile(
    r'import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+' + _Q + r'([^"\']+)' + _Q)


def _target(here, spec):
    if not spec.startswith("."):
        return None
    tgt = os.path.normpath(os.path.join(here, spec)).replace(BS, "/")
    for cand in (tgt, tgt + ".js", tgt + "/index.js"):
        if cand in FILEMOD:
            return FILEMOD[cand]
    return None


def parse(path):
    """-> (defs, imports, masked lines, extends)

    defs:    list of {name, klass, kind, lo, hi}  (1-indexed inclusive lines)
    imports: {local name -> module key}; a namespace import maps its name too
    extends: {class name -> parent class name}
    """
    src = open(path, encoding="utf-8", errors="replace").read()
    here = os.path.dirname(path)

    imports = {}
    for m in IMPORT_NAMED.finditer(src):
        mod = _target(here, m.group(3))
        if not mod:
            continue
        if m.group(1):
            imports[m.group(1)] = mod
        if m.group(2):
            for p in m.group(2).split(","):
                p = p.strip()
                if not p:
                    continue
                local = p.split(" as ")[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', local):
                    imports[local] = mod
    for m in IMPORT_NS.finditer(src):
        mod = _target(here, m.group(3))
        if mod:
            imports[m.group(2)] = mod
            if m.group(1):
                imports[m.group(1)] = mod

    extends = dict(re.findall(r'class\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)', src))

    lines = mask(src).split("\n")
    defs, depth, klass, kdepth = [], 0, None, None
    open_defs = []
    for idx, clean in enumerate(lines, 1):
        s = clean.strip()
        started = None
        if klass is not None and depth == kdepth + 1:
            mm = re.match(r'^\s*(?:static\s+|get\s+|set\s+|async\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*\(', clean)
            if mm and mm.group(1) not in KW_DEF:
                started = {"name": mm.group(1), "klass": klass, "kind": "method"}
        # TOP LEVEL, two ways: depth zero, or a definition flush left (a JSX
        # file can drift the depth; see inventory.py).
        if depth == 0 or (clean[:1] and clean[:1] not in " \t"):
            mc = re.match(r'(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)', s)
            if mc:
                klass, kdepth = mc.group(1), depth
                defs.append({"name": mc.group(1), "klass": None, "kind": "class",
                             "lo": idx, "hi": idx})
            m = re.match(r'(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*[*]?\s*([A-Za-z_$][\w$]*)\s*\(', s)
            if m:
                started = {"name": m.group(1), "klass": None, "kind": "function"}
            if not started:
                m = re.match(r'(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>', s)
                if m:
                    started = {"name": m.group(1), "klass": None, "kind": "arrow"}
            if not started:
                m = re.match(r'(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function', s)
                if m:
                    started = {"name": m.group(1), "klass": None, "kind": "function"}
        if started:
            started["lo"] = idx
            started["depth"] = depth
            open_defs.append(started)
        depth += clean.count("{") - clean.count("}")
        for d in list(open_defs):
            if depth <= d["depth"] and idx > d["lo"]:
                d["hi"] = idx
                defs.append({k: d[k] for k in ("name", "klass", "kind", "lo", "hi")})
                open_defs.remove(d)
            elif depth <= d["depth"] and idx == d["lo"] and (
                    "{" in clean or clean.rstrip().endswith(";")):
                # a definition that opens and closes on its own line - a one-line
                # method `map(fn) { ... }`, or an arrow with no body braces - owns
                # that line only; left open, it took the next line's calls too
                # and chained Loop's one-liners into false edges.
                d["hi"] = idx
                defs.append({k: d[k] for k in ("name", "klass", "kind", "lo", "hi")})
                open_defs.remove(d)
        if klass is not None and depth <= kdepth:
            klass, kdepth = None, None
    for d in open_defs:
        d["hi"] = len(lines)
        defs.append({k: d[k] for k in ("name", "klass", "kind", "lo", "hi")})
    return defs, imports, lines, extends


def class_home(cls, mod, imports, classes, universe):
    """The module a class name means in `mod`: its own definition, then the
    file's import of that name, then the first module defining it. Two
    modules define `Document` (the live one and the frozen model's), so the
    global map alone sent the oracle's `new Document()` into the live file."""
    if cls in universe.get(mod, {}) and universe[mod][cls]["kind"] == "class":
        return mod
    if cls in imports:
        return imports[cls]
    return classes.get(cls)


def learn_fields(src, classes, mod=None, imports=None, universe=None):
    """`this.x = new SomeClass()` -> {x: module}, for classes we know.

    EXACT, not a guess: the assignment is right there in the constructor. Only
    classes this codebase defines are kept - `new Map()` and `new Two()` tell
    us nothing about our own call graph, and mapping them would invent edges
    into a built-in.
    """
    out = {}
    for f, cls in re.findall(r'this\.([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Z][\w$]*)', src):
        if cls not in classes:
            continue
        home = class_home(cls, mod, imports or {}, classes, universe or {})
        names = (universe or {}).get(home, {})
        out[f] = home + ":" + cls if (cls in names or not universe) else home
    return out


def check_modfile():
    """Every inventoried file needs a module key; name the ones that do not."""
    inv = json.load(open(os.path.join(HERE, "data", "inventory.json")))
    missing = sorted(p for p in inv if p not in FILEMOD)
    gone = sorted(p for p in FILEMOD if not os.path.exists(p))
    if missing or gone:
        for p in missing:
            print("  no module key in extract.MODFILE: %s (%d functions)" % (p, len(inv[p])))
        for p in gone:
            print("  extract.MODFILE names a file that is not there: %s" % p)
        sys.exit("extract.py: MODFILE is out of step with the inventory")


def main():
    check_modfile()
    universe = {}          # mod -> {node-local name ("f", "Class.m") -> def}
    parsed = {}
    for mod, path in MODFILE.items():
        defs, imports, lines, extends = parse(path)
        parsed[mod] = (defs, imports, lines, extends)
        # CANONICAL NAME: the bare function name, qualified with its class only
        # when the module defines that name more than once (ChainBuilder.step
        # vs ArcBakeJob.step).
        seen = {}
        for d in defs:
            if d["kind"] == "class":
                continue
            seen.setdefault(d["name"], []).append(d)
        names = {}
        for nm, ds in seen.items():
            if len(ds) == 1 and not (ds[0]["klass"] and nm == "constructor"):
                names[nm] = ds[0]
            else:
                for d in ds:
                    key = (d["klass"] + "." + nm) if d["klass"] else nm
                    names[key] = d
        for d in defs:
            if d["kind"] == "class":
                names.setdefault(d["name"], d)
        universe[mod] = names

    # class name -> the module that defines it, so a `new Foo()` can be resolved
    classmod = {}
    for m, names in universe.items():
        for n, d in names.items():
            if d["kind"] == "class":
                classmod.setdefault(n, m)

    # module -> parent module, from `class A extends B` where B is ours
    parent = {}
    for mod, (defs, imports, lines, extends) in parsed.items():
        for child, base in extends.items():
            home = class_home(base, mod, imports, classmod, universe) if base in classmod else None
            if home and home != mod:
                parent[mod] = home

    # module -> {field: [modules]}, the hand-written map plus what was learned
    fieldmap = {}
    for mod, (defs, imports, lines, extends) in parsed.items():
        raw = open(MODFILE[mod], encoding="utf-8", errors="replace").read()
        merged = {k: [v] for k, v in learn_fields(raw, classmod, mod, imports, universe).items()}
        for k, v in FIELD.get(mod, {}).items():      # the hand-written entries win
            merged[k] = [] if v is None else (list(v) if isinstance(v, list) else [v])
        fieldmap[mod] = merged

    def node_of(mod, name, klass=None):
        u = universe.get(mod, {})
        if klass and (klass + "." + name) in u:
            return mod + "." + klass + "." + name
        if name in u:
            d = u[name]
            # a bare name only resolves for a method if it belongs to that class
            if klass and d.get("klass") and d["klass"] != klass:
                return None
            return mod + "." + name
        return None

    def method_of(spec, fn):
        """`fn` on an instance: `spec` is `module:Class` (or a module whose one
        class is meant), falling back to the class it extends."""
        mod, _, cls = spec.partition(":")
        seen = set()
        while mod and mod not in seen:
            seen.add(mod)
            if cls:
                hit = node_of(mod, fn, cls)
            else:
                for cname, cmod in classmod.items():
                    if cmod == mod and (cname + "." + fn) in universe.get(mod, {}):
                        cls = cname
                        break
                hit = (node_of(mod, fn, cls) if cls else None) or node_of(mod, fn)
            if hit:
                return hit
            mod, cls = parent.get(mod), None
        return None

    edges = collections.Counter()
    sites = collections.defaultdict(list)
    call = re.compile(r'(?:(this)\.([A-Za-z_$][\w$]*)\.|(this|[A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)\s*\(')

    for mod, (defs, imports, lines, extends) in parsed.items():
        # longest definitions last so an inner def wins its own lines
        ordered = sorted([d for d in defs if d["kind"] != "class"],
                         key=lambda d: (d["hi"] - d["lo"]))
        owner = {}
        for d in reversed(ordered):
            for ln in range(d["lo"], d["hi"] + 1):
                owner[ln] = d
        # Names a definition declares inside itself - a local helper, a
        # parameter. A bare call to one of them is not a call to the
        # module-level function of the same name (`close()` inside
        # `clipPolylineToRect` is its own closure, not `polyline.close`).
        local = {}
        for d in ordered:
            body = "\n".join(lines[d["lo"] - 1:d["hi"]])
            names = set(LOCAL_DECL.findall(body))
            head = PARAMS.search(lines[d["lo"] - 1])
            if head:
                names |= set(re.findall(r'[A-Za-z_$][\w$]*', head.group(1)))
            names.discard(d["name"])
            local[id(d)] = names
        for ln, clean in enumerate(lines, 1):
            d = owner.get(ln)
            if not d:
                continue
            src_node = node_of(mod, d["name"], d["klass"])
            if not src_node:
                continue
            for m in call.finditer(clean):
                this_kw, fld, obj, fn = m.groups()
                if fn in KW:
                    continue
                dsts = []
                if this_kw == "this" and fld:
                    for fmod in fieldmap.get(mod, {}).get(fld, []):
                        dsts.append(method_of(fmod, fn))
                elif obj == "this":
                    dst = node_of(mod, fn, d["klass"]) or node_of(mod, fn)
                    if not dst and mod in PROTO_OF:
                        for other in PROTO_OF[mod]:
                            if other == mod:
                                continue
                            dst = node_of(other, fn)
                            if dst:
                                break
                    if not dst and mod in parent:
                        dst = method_of(parent[mod], fn)
                    dsts.append(dst)
                elif obj:
                    if obj in imports:
                        dsts.append(node_of(imports[obj], fn) or node_of(imports[obj], fn, obj))
                    elif obj in universe.get(mod, ()):
                        dsts.append(node_of(mod, fn, obj))
                elif fn not in local[id(d)]:
                    dst = node_of(mod, fn, d["klass"]) or node_of(mod, fn)
                    if not dst and fn in imports:
                        dst = node_of(imports[fn], fn)
                    dsts.append(dst)
                for dst in dsts:
                    if dst and dst != src_node:
                        edges[(src_node, dst)] += 1
                        if len(sites[(src_node, dst)]) < 3:
                            sites[(src_node, dst)].append("%s:%d" % (MODFILE[mod], ln))

    allnodes = sorted(m + "." + x for m in universe for x in universe[m])
    print("modules parsed : %d" % len(parsed))
    print("nodes in scope : %d" % len(allnodes))
    print("edges extracted: %d" % len(edges))
    json.dump({"edges": [[a, b, sites[(a, b)]] for (a, b) in sorted(edges)],
               "nodes": allnodes,
               "universe": {k: {n: {"kind": d["kind"], "klass": d["klass"],
                                    "lo": d["lo"], "hi": d["hi"]}
                                for n, d in v.items()}
                            for k, v in universe.items()},
               "modfile": MODFILE},
              open(os.path.join(HERE, "data", "graphdata.json"), "w"), indent=0)
    per = collections.Counter(a.split(".")[0] for a, b in edges)
    for k, v in per.most_common(20):
        print("   %-5s %d" % (k, v))


if __name__ == "__main__":
    main()
