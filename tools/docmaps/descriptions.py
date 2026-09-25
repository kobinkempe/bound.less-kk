# -*- coding: utf-8 -*-
"""Pull each function's explanation out of the published Code Map.

The Code Map is the source of truth for WHAT a function does; this keeps the two
documents from drifting, because the graph never restates a description — it
reads the one already written.

A Code Map row can cover several functions (`Grid: constructor . _key . insert`),
so a graph node resolves by trying, in order: its full label, its last segment,
then its class name.
"""
import io, re, os, json, html as H
import graph

import os
HERE = os.path.dirname(os.path.abspath(__file__))

CODEMAP = os.path.join(HERE, "pages", "boundless-code-map.html")

def _text(t):
    t = re.sub(r'<span class="pill[^"]*">(.*?)</span>', r' [\1] ', t, flags=re.S)
    t = re.sub(r'<br\s*/?>', ' ', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = H.unescape(t)
    return re.sub(r'\s+', ' ', t).strip()

def _names(fn_cell):
    """Every function name a Code Map `fn` cell refers to."""
    raw = _text(fn_cell)
    raw = re.sub(r'\[[^\]]*\]', ' ', raw)          # drop pills
    raw = re.sub(r'\b\d+ lines\b', ' ', raw)
    out = []
    for tok in re.split(r'[\s/·,]+', raw):
        tok = tok.strip().rstrip(':')
        tok = tok.split('(')[0]
        if tok and re.match(r'^[A-Za-z_][\w.]*$', tok):
            out.append(tok)
    return out

_ART = re.compile(r'<article class="file[^"]*" id="([^"]+)"')
_ROW = re.compile(
    r'<td class="fn[^"]*">(.*?)</td>\s*<td class="wt">(.*?)</td>\s*<td class="ref">(.*?)</td>', re.S)


def load():
    """-> {article id: {name: (desc, sec)}}, every row read in its article."""
    src = io.open(CODEMAP, encoding="utf-8").read()
    marks = [(m.start(), m.group(1)) for m in _ART.finditer(src)]
    by_art = {}
    for m in _ROW.finditer(src):
        art = ""
        for start, name in marks:
            if start <= m.start():
                art = name
            else:
                break
        fn, wt, ref = m.groups()
        desc, sec = _text(wt), _text(ref)
        if not desc:
            continue
        names = by_art.setdefault(art, {})
        for nm in _names(fn):
            names.setdefault(nm, (desc, sec))
            # A cell written `LevelIndex.query(rect, out)` names the method by
            # its class, but the graph node is `doc.query` - the module has
            # only one `query`, so it does not qualify. Register the leaf too,
            # or that row describes nothing.
            if "." in nm:
                names.setdefault(nm.split(".")[-1], (desc, sec))
    return by_art


def build():
    """Each node's one-liner, read ONLY from an article that documents its
    module - its own article first. `render` in RasterRenderer is not the row
    for `render` in Renderer, and a leaf matched across the whole page once
    gave the retired engine's methods the live engine's descriptions."""
    import newdesc
    by_art = load()
    out, missing = {}, []
    for nid in graph.nodes():
        mod = nid.split(".", 1)[0]
        lab = graph.label(nid)
        arts = [newdesc.HOME.get(mod)] + sorted(a for a, ms in newdesc.ARTMOD.items() if mod in ms)
        hit = None
        for art in arts:
            names = by_art.get(art, {})
            for key in (lab, lab.split(".")[-1], lab.split(".")[0]):
                if key in names:
                    hit = names[key]
                    break
            if hit:
                break
        if hit:
            out[nid] = {"d": hit[0], "s": hit[1]}
        else:
            missing.append(nid)
    return out, missing

_LK = {}


def long_key(sect, nm):
    """The LONG key that explains name `nm` in a row of article `sect`: the
    section-scoped key first, then a key of one of the modules the article
    documents. Never another module's function that happens to share a name."""
    import longdesc, newdesc
    LONG = longdesc.LONG
    if not _LK:
        for k in LONG:
            if k.startswith("@"):
                continue
            mod, rest = k.split(".", 1)
            _LK.setdefault((mod, rest), k)
            _LK.setdefault((mod, rest.split(".")[-1]), k)
    mods = newdesc.ARTMOD.get(sect, [])
    for cand in (nm, nm.split(".")[-1]):
        scoped = "@" + sect + "." + cand
        if scoped in LONG:
            return scoped
        for mod in mods:
            k = _LK.get((mod, cand)) or _LK.get((mod, cand.split(".")[-1]))
            if k:
                return k
    return None


def long_by_name():
    """{article id: {name: the comprehensive text of the row that covers it}}.

    A row can cover a group (`_d . _len . _fitDash . _poolTo`) with one
    explanation between them. The graph shows one function at a time, so
    without this every member of such a group would fall back to the row's
    one-line summary while the Code Map showed the full text for all four.
    Resolution is enhance_codemap's: `long_key`.
    """
    import longdesc
    LONG = longdesc.LONG
    src = io.open(CODEMAP, encoding="utf-8").read()
    marks = [(m.start(), m.group(1)) for m in _ART.finditer(src)]

    def section_at(pos):
        cur = ""
        for start, name in marks:
            if start <= pos:
                cur = name
            else:
                break
        return cur

    out = {}
    for m in re.finditer(r'<td class="fn[^"]*">(.*?)</td>', src, re.S):
        sect = section_at(m.start())
        names = _names(m.group(1))
        key = None
        for nm in names:
            key = long_key(sect, nm)
            if key:
                break
        if not key:
            continue
        per = out.setdefault(sect, {})
        for nm in names:
            per.setdefault(nm, LONG[key])
            per.setdefault(nm.split(".")[-1], LONG[key])
    return out


if __name__ == "__main__":
    out, missing = build()
    print("described: %d of %d" % (len(out), len(graph.nodes())))
    if missing:
        print("MISSING:")
        for m in missing:
            print("   ", m)
    lens = sorted((len(v["d"]), k) for k, v in out.items())
    print("shortest:", lens[:3])
    print("longest :", lens[-3:])
    print("no section ref:", sum(1 for v in out.values() if not v["s"]))
