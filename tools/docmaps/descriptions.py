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

def load():
    src = io.open(CODEMAP, encoding="utf-8").read()
    rows = re.findall(
        r'<td class="fn[^"]*">(.*?)</td>\s*<td class="wt">(.*?)</td>\s*<td class="ref">(.*?)</td>',
        src, re.S)
    by_name = {}
    for fn, wt, ref in rows:
        desc, sec = _text(wt), _text(ref)
        if not desc:
            continue
        for nm in _names(fn):
            by_name.setdefault(nm, (desc, sec))
            # A cell written `LevelIndex.query(rect, out)` names the method by
            # its class, but the graph node is `doc.query` - the module has
            # only one `query`, so it does not qualify. Register the leaf too,
            # or that row describes nothing.
            if "." in nm:
                by_name.setdefault(nm.split(".")[-1], (desc, sec))
    return by_name

def build():
    by_name = load()
    out, missing = {}, []
    for nid in graph.nodes():
        lab = graph.label(nid)
        for key in (lab, lab.split(".")[-1], lab.split(".")[0]):
            if key in by_name:
                d, s = by_name[key]
                out[nid] = {"d": d, "s": s}
                break
        else:
            missing.append(nid)
    return out, missing

def long_by_name():
    """name -> the comprehensive text of the Code Map row that covers it.

    A row can cover a group (`_d . _len . _fitDash . _poolTo`) with one
    explanation between them. The graph shows one function at a time, so
    without this every member of such a group would fall back to the row's
    one-line summary while the Code Map showed the full text for all four.
    Resolution matches enhance_codemap: the section-scoped key first, then the
    bare leaf.
    """
    import longdesc
    LONG = longdesc.LONG
    src = io.open(CODEMAP, encoding="utf-8").read()
    art = re.compile(r'<article class="file[^"]*" id="([^"]+)"')
    marks = [(m.start(), m.group(1)) for m in art.finditer(src)]

    def section_at(pos):
        cur = ""
        for start, name in marks:
            if start <= pos:
                cur = name
            else:
                break
        return cur

    byleaf = {}
    for k in LONG:
        byleaf.setdefault(k.split(".", 1)[1], k)

    out = {}
    for m in re.finditer(r'<td class="fn[^"]*">(.*?)</td>', src, re.S):
        sect = section_at(m.start())
        names = _names(m.group(1))
        key = None
        for nm in names:
            for cand in (nm, nm.split(".")[-1]):
                scoped = "@" + sect + "." + cand
                key = scoped if scoped in LONG else byleaf.get(cand)
                if key:
                    break
            if key:
                break
        if not key:
            continue
        for nm in names:
            out.setdefault(nm, LONG[key])
            out.setdefault(nm.split(".")[-1], LONG[key])
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
