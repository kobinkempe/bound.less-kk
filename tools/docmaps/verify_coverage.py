# -*- coding: utf-8 -*-
"""The check that keeps the promise: every function is on both pages.

Run it after any change to `src/`, and after regenerating either artifact. It
reads the inventory (produced by inventory.py), the published Code Map and the
published Call Graph, and prints what is named on neither.

The Code Map half is checked IN THE FILE THAT DEFINES THE FUNCTION: a function
counts as on the page only when a row of an article documenting its module
names it (`newdesc.ARTMOD`). Matching a bare name anywhere on the page let
`render` in RasterRenderer pass on the strength of Renderer's row.

A gap here is not a cosmetic problem: it means someone reading the documents
would conclude a function does not exist.
"""
import io, os, re, json, sys
import descriptions, newdesc

HERE = os.path.dirname(os.path.abspath(__file__))
CMAP = os.path.join(HERE, "pages", "boundless-code-map.html")
GRAPH = os.path.join(HERE, "pages", "boundless-call-graph.html")
INV = os.path.join(HERE, "data", "inventory.json")
DATA = os.path.join(HERE, "data", "graphdata.json")


def inventory():
    inv = json.load(open(INV))
    out = []
    for path in sorted(inv):
        for f in inv[path]:
            qual = (f["class"] + "." + f["name"]) if f["class"] else f["name"]
            out.append((path, qual, f["name"]))
    return out


def codemap_names():
    """-> ({module: names its articles' rows carry}, rows, expandable rows)"""
    s = io.open(CMAP, encoding="utf-8").read()
    art = re.compile(r'<article class="file[^"]*" id="([^"]+)"')
    marks = [(m.start(), m.group(1)) for m in art.finditer(s)]
    per_mod = {}
    for m in re.finditer(r'<td class="fn[^"]*">(.*?)</td>', s, re.S):
        sect = ""
        for start, name in marks:
            if start <= m.start():
                sect = name
            else:
                break
        for mod in newdesc.ARTMOD.get(sect, []):
            named = per_mod.setdefault(mod, set())
            for n in descriptions._names(m.group(1)):
                named.add(n)
                named.add(n.split(".")[-1])
    rows = len(re.findall(r'<td class="fn', s))
    expandable = len(re.findall(r'class="[^"]*cm-row', s))
    return per_mod, rows, expandable


def graph_names():
    """The graph page carries its node set as the MODOF map, node id -> module."""
    if not os.path.exists(GRAPH):
        return {}, 0
    s = io.open(GRAPH, encoding="utf-8").read()
    m = re.search(r'MODOF\s*=\s*(\{.*?\}),\s*DESC', s, re.S)
    if not m:
        m = re.search(r'MODOF\s*=\s*(\{.*?\});', s, re.S)
    if not m:
        return {}, 0
    try:
        modof = json.loads(m.group(1))
    except ValueError:
        return {}, 0
    per_mod = {}
    for key, mod in modof.items():
        rest = key.split(".", 1)[1]
        named = per_mod.setdefault(mod, set())
        named.add(rest)
        named.add(rest.split(".")[-1])
    return per_mod, len(modof)


def report(title, per_mod, inv, filemod):
    gaps = {}
    for path, qual, bare in inv:
        named = per_mod.get(filemod.get(path), set())
        if qual in named or bare in named:
            continue
        gaps.setdefault(path, []).append(qual)
    total = sum(len(v) for v in gaps.values())
    print("%-12s missing %d of %d" % (title, total, len(inv)))
    for path in sorted(gaps):
        g = gaps[path]
        print("  ### %s (%d)" % (path, len(g)))
        for i in range(0, len(g), 4):
            print("      " + "  ".join("%-28s" % x for x in g[i:i + 4]))
    return total


def main():
    inv = inventory()
    filemod = {v: k for k, v in json.load(open(DATA))["modfile"].items()}
    unkeyed = sorted({p for p, _q, _b in inv if p not in filemod})
    if unkeyed:
        print("files with no module key (run extract.py): %s" % ", ".join(unkeyed))
    cm, rows, expandable = codemap_names()
    gr, gnodes = graph_names()
    print("Code Map   : %d rows, %d expandable" % (rows, expandable))
    print("Call Graph : %d nodes" % gnodes)
    print()
    a = report("CODE MAP", cm, inv, filemod)
    b = report("CALL GRAPH", gr, inv, filemod)
    print()
    if rows != expandable:
        print("Code Map rows with no explanation to open: %d" % (rows - expandable))
    ok = a == b == 0 and not unkeyed and rows == expandable
    print("OK" if ok else "GAPS REMAIN")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
