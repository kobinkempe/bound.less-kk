# -*- coding: utf-8 -*-
"""The check that keeps the promise: every function is on both pages.

Run it after any change to `src/`, and after regenerating either artifact. It
reads the inventory (produced by inv2.py), the published Code Map and the
published Call Graph, and prints what is named on neither.

A gap here is not a cosmetic problem: it means someone reading the documents
would conclude a function does not exist.
"""
import io, os, re, json, sys
import descriptions

HERE = os.path.dirname(os.path.abspath(__file__))
CMAP = os.path.join(HERE, "pages", "boundless-code-map.html")
GRAPH = os.path.join(HERE, "pages", "boundless-call-graph.html")
INV = os.path.join(HERE, "data", "inventory.json")


def inventory():
    inv = json.load(open(INV))
    out = []
    for path in sorted(inv):
        for f in inv[path]:
            qual = (f["class"] + "." + f["name"]) if f["class"] else f["name"]
            out.append((path, qual, f["name"]))
    return out


def codemap_names():
    s = io.open(CMAP, encoding="utf-8").read()
    named = set()
    for cell in re.findall(r'<td class="fn[^"]*">(.*?)</td>', s, re.S):
        for n in descriptions._names(cell):
            named.add(n)
            named.add(n.split(".")[-1])
    rows = len(re.findall(r'<td class="fn', s))
    expandable = len(re.findall(r'class="[^"]*cm-row', s))
    return named, rows, expandable


def graph_names():
    """The graph page carries its node set as the MODOF map, node id -> module."""
    if not os.path.exists(GRAPH):
        return set(), 0
    s = io.open(GRAPH, encoding="utf-8").read()
    m = re.search(r'MODOF\s*=\s*(\{.*?\}),\s*DESC', s, re.S)
    if not m:
        m = re.search(r'MODOF\s*=\s*(\{.*?\});', s, re.S)
    if not m:
        return set(), 0
    try:
        modof = json.loads(m.group(1))
    except ValueError:
        return set(), 0
    named = set()
    for key in modof:
        named.add(key)
        named.add(key.split(".")[-1])
        if "." in key:
            named.add(key.split(".", 1)[1])
    return named, len(modof)


def report(title, named, inv):
    gaps = {}
    for path, qual, bare in inv:
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
    inv = invn = inventory()
    cm, rows, expandable = codemap_names()
    gr, gnodes = graph_names()
    print("Code Map   : %d rows, %d expandable, %d names" % (rows, expandable, len(cm)))
    print("Call Graph : %d nodes, %d names" % (gnodes, len(gr)))
    print()
    a = report("CODE MAP", cm, invn)
    b = report("CALL GRAPH", gr, invn)
    print()
    print("OK" if a == b == 0 else "GAPS REMAIN")
    return 0 if a == b == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
