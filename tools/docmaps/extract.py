# -*- coding: utf-8 -*-
"""Extract call edges from the bound.less source, with a file:line for each.

Every edge this emits corresponds to a real call site, so the graph stays what
its header claims: read off the source, not inferred. Anything that cannot be
resolved to a known node is dropped rather than guessed.
"""
import os, re, json, collections

import os
HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = "src"
BS = chr(92)

# module key -> source file. Keys match graph.py's MOD/MODNAME vocabulary.
MODFILE = {
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
    "cam": "src/engine/Camera.js",
    "lm":  "src/engine/LevelMap.js",
    "ts":  "src/engine/TileStore.js",
    "rnd": "src/engine/Renderer.js",
    "doc": "src/engine/Document.js",
    "per": "src/engine/persist.js",
    "scn": "src/engine/scenes.js",
    "fl":  "src/engine/frameLattice.js",
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
    "loc": "src/storage/localCanvases.js",
    "thm": "src/storage/thumbnails.js",
    "cld": "src/cloud/canvasSync.js",
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
    "wop": "src/Components/editor/WidthOpacityPanel.js",
    "aps": "src/Components/editor/useAnchorPopoverStyle.js",
    "cka": "src/Components/editor/useClickAway.js",
    # not running: the oracles (src/engine/__oracles__) and the testkit
    "v0":  "src/engine/__oracles__/KobinEngineV0.js",
    "cvp": "src/engine/__oracles__/curvePerimeter.js",
    "sks": "src/engine/__oracles__/strokeShape.js",
    "bks": "src/engine/__oracles__/bakeStrategies.js",
    "ced": "src/engine/__oracles__/cede.js",
    "ers": "src/engine/__oracles__/erase.js",
    "reportWebVitals": "src/reportWebVitals.js",
    "tsp": "src/engine/__testkit__/scaleBar.js",
}
FILEMOD = {v: k for k, v in MODFILE.items()}

# `this.<field>` -> the module that field holds an instance of. Hand-written,
# because these five are assigned from an import and the assignment does not
# name the class. Everything else is learned exactly, below, from
# `this.x = new SomeClass()`.
_ENGINE_FIELDS = {"lm": "lm", "doc": "doc", "cam": "cam", "store": "ts", "renderer": "rnd"}
FIELD = {
    "ts":  {"lm": "lm", "doc": "doc"},
    "cam": {"lm": "lm"},
    "rnd": {"cam": "cam", "two": None},
    "v0":  {},
}
# Every file mixed onto the engine's prototype sees the same `this` and so the
# same five fields. Without this, `this.doc.removeById()` in erasePipeline.js
# resolved to nothing and 26 hand edges went missing.
for _m in ("eng", "erp", "ovl", "sel", "sco", "fil"):
    FIELD[_m] = dict(_ENGINE_FIELDS)

# ONE PROTOTYPE, SIX FILES. The 2026-08-31 split moved most of KobinEngine's
# methods into mixin files that `engine/mixin.js` copies back onto the same
# prototype, so `this._queueBake()` in `KobinEngine.js` reaches a method defined
# in `erasePipeline.js`. Without this the extractor loses every intra-engine
# call that now crosses a file - the hand-list agreement fell from 88% to 77%
# on the first rebuild after the split, which is what pointed at it.
PROTOTYPE = ("eng", "erp", "ovl", "sel", "sco", "fil")

KW = {"if", "for", "while", "switch", "catch", "return", "function", "typeof",
      "new", "do", "else", "try", "await", "yield", "in", "of", "case",
      "default", "delete", "void", "this", "super", "constructor"}

# The same list minus `constructor`, for DEFINITIONS. A constructor is a real
# function with real call sites in it - `KobinEngine.constructor` is where the
# five instrument classes are built - so it has to become a node. It stays in
# KW above, because `new Foo()` at a CALL site is not a call to a method named
# "constructor".
KW_DEF = KW - {"constructor"}


def strip_noise(line):
    out, i, n, q = [], 0, len(line), None
    while i < n:
        c = line[i]
        if q:
            if c == BS:
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c == '"' or c == "'" or c == "`":
            q = c
            i += 1
            continue
        if c == "/" and i + 1 < n and line[i + 1] == "/":
            break
        out.append(c)
        i += 1
    return "".join(out)


def parse(path):
    """-> (defs, imports)

    defs:    list of {name, klass, kind, lo, hi}  (1-indexed inclusive lines)
    imports: {local name -> module key}
    """
    src = open(path, encoding="utf-8", errors="replace").read()
    lines = src.split("\n")
    here = os.path.dirname(path)

    imports = {}
    for m in re.finditer(r'import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+["' + "'" + r']([^"' + "'" + r']+)["' + "'" + r']', src, re.S):
        spec = m.group(3)
        if not spec.startswith("."):
            continue
        tgt = os.path.normpath(os.path.join(here, spec)).replace(BS, "/")
        for cand in (tgt, tgt + ".js", tgt + "/index.js"):
            if cand in FILEMOD:
                mod = FILEMOD[cand]
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
                break

    defs, depth, klass, kdepth, inblock = [], 0, None, None, False
    open_defs = []
    for idx, raw in enumerate(lines, 1):
        s = raw.strip()
        if inblock:
            if "*/" in s:
                inblock = False
            continue
        if s.startswith("/*"):
            if "*/" not in s:
                inblock = True
            continue
        if s.startswith("//") or s.startswith("*"):
            depth_before = depth
        clean = strip_noise(raw)
        started = None
        if klass is not None and depth == kdepth + 1:
            mm = re.match(r'^\s*(?:static\s+|get\s+|set\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(', raw)
            if mm and mm.group(1) not in KW_DEF:
                started = {"name": mm.group(1), "klass": klass, "kind": "method"}
        # TOP LEVEL, two ways. Depth counting is exact for plain JS, but a
        # JSX file can drift it - CanvasesV2 sits at depth 1 for its last
        # three hundred lines - and a drifted counter silently swallows every
        # declaration after the drift. Column zero is the second witness: this
        # codebase writes top-level declarations flush left and nothing else,
        # so either signal alone is enough to start a definition.
        if depth == 0 or (raw[:1] and raw[:1] not in " 	"):
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
        if klass is not None and depth <= kdepth:
            klass, kdepth = None, None
    for d in open_defs:
        d["hi"] = len(lines)
        defs.append({k: d[k] for k in ("name", "klass", "kind", "lo", "hi")})
    return defs, imports, lines


def learn_fields(src, classes):
    """`this.x = new SomeClass()` -> {x: SomeClass}, for classes we know.

    EXACT, not a guess: the assignment is right there in the constructor. Only
    classes this codebase defines are kept - `new Map()` and `new Two()` tell
    us nothing about our own call graph, and mapping them would invent edges
    into a built-in.

    This is what connects the four instrument classes. `EventLatency.report`
    looked like dead code on the published graph until this existed.
    """
    out = {}
    for f, cls in re.findall(r'this\.([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Z][\w$]*)', src):
        if cls in classes:
            out[f] = classes[cls]
    return out


def main():
    universe = {}          # mod -> set of node-local names ("f", "Class.m")
    parsed = {}
    for mod, path in MODFILE.items():
        if not os.path.exists(path):
            continue
        defs, imports, lines = parse(path)
        parsed[mod] = (defs, imports, lines)
        # CANONICAL NAME, matching the convention already in graph.py: the bare
        # function name, qualified with its class only when the module defines
        # that name more than once (ChainBuilder.step vs ArcBakeJob.step).
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

    # module -> {field: module}, the hand-written map plus what was learned
    fieldmap = {}
    for mod, (defs, imports, lines) in parsed.items():
        learned = learn_fields(chr(10).join(lines), classmod)
        merged = dict(learned)
        merged.update(FIELD.get(mod, {}))      # the hand-written entries win
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

    edges = collections.Counter()
    sites = collections.defaultdict(list)
    call = re.compile(r'(?:(this)\.([A-Za-z_$][\w$]*)\.|(this|[A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)\s*\(')

    for mod, (defs, imports, lines) in parsed.items():
        # longest definitions last so an inner def wins its own lines
        ordered = sorted([d for d in defs if d["kind"] != "class"],
                         key=lambda d: (d["hi"] - d["lo"]))
        owner = {}
        for d in ordered:
            for ln in range(d["lo"], d["hi"] + 1):
                owner[ln] = d
        for ln, raw in enumerate(lines, 1):
            d = owner.get(ln)
            if not d:
                continue
            src_node = node_of(mod, d["name"], d["klass"])
            if not src_node:
                continue
            clean = strip_noise(raw)
            for m in call.finditer(clean):
                this_kw, fld, obj, fn = m.groups()
                if fn in KW:
                    continue
                dst = None
                if this_kw == "this" and fld:
                    fmod = fieldmap.get(mod, {}).get(fld)
                    if fmod:
                        # a learned field names a CLASS, so try its method first
                        cls = None
                        for cname, cmod in classmod.items():
                            if cmod == fmod and (cname + "." + fn) in universe.get(fmod, {}):
                                cls = cname
                                break
                        dst = (node_of(fmod, fn, cls) if cls else None) or node_of(fmod, fn)
                elif obj == "this":
                    dst = node_of(mod, fn, d["klass"]) or node_of(mod, fn)
                    if not dst and mod in PROTOTYPE:
                        for other in PROTOTYPE:
                            if other == mod:
                                continue
                            dst = node_of(other, fn)
                            if dst:
                                break
                elif obj:
                    if obj in imports:
                        dst = node_of(imports[obj], fn) or node_of(imports[obj], fn, obj)
                    elif obj in universe.get(mod, ()):
                        dst = node_of(mod, fn, obj)
                else:
                    dst = node_of(mod, fn, d["klass"]) or node_of(mod, fn)
                    if not dst and fn in imports:
                        dst = node_of(imports[fn], fn)
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
              open(os.path.join(HERE, "data", os.path.join(HERE, "data", "graphdata.json")), "w"), indent=0)
    per = collections.Counter(a.split(".")[0] for a, b in edges)
    for k, v in per.most_common(20):
        print("   %-5s %d" % (k, v))


if __name__ == "__main__":
    main()
