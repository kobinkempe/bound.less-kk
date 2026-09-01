# -*- coding: utf-8 -*-
"""Draw the module-blocked call graph as static SVG.

One <g> per function, one <path> per call, one framed block per file. Nothing
is measured in the browser: the layout is computed offline and the whole
drawing rides a single transform on #cg-vp, so pan and zoom cost one attribute
write.

Edges are classed `cg-in` (both ends in the same file) or `cg-out` (a call that
crosses a file boundary). The distinction is worth drawing: a file with only
`cg-in` edges is self-contained, and one with a spray of `cg-out` edges leaving
it is where the coupling is.
"""
import collections
import html
import json
import os
import graph
import layout_mod as LM

R = LM.compute()
NH = LM.NODE_H

# Why NOTHING CALLS this function, from audit_isolated.py. The test is
# in-degree, not degree: a function that calls something but is called by
# nothing is exactly what an abandoned function looks like, and an earlier
# version of this asked the wrong question and missed 150 of them. This carries
# the specific reason onto the node so the panel can say it.
# Entry points (audit_entries.py), the test-only functions and the three the
# source never mentions again (audit_isolated.py). All three are marked on the
# node itself so the drawing answers "where do I start" and "what is not live"
# without the reader clicking anything.
def _load(name, default):
    try:
        return json.load(open(os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "data", name)))
    except (IOError, ValueError):
        return default


ENTRY = _load("entries.json", {})
TESTONLY = set(_load("testonly.json", []))
DEAD = set(_load("isolated.json", {}).get("UNREFERENCED", []))

WHY = {}
try:
    _iso = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "data", "isolated.json")))
    for _bucket, _nodes in _iso.items():
        for _n in _nodes:
            WHY[_n] = _bucket
except (IOError, ValueError):
    pass
PAD = 30.0

# The margin is BAKED INTO THE COORDINATES rather than carried on a wrapper
# <g transform>. The page pans and zooms by setting the root viewBox, and
# `centreOn` reads a node's position with getBBox(), which reports it in the
# space its ancestors establish - so a wrapper transform would put the two in
# different spaces and centring would land 30 units off.
X = {k: v + PAD for k, v in R["x"].items()}
Y = {k: v + PAD for k, v in R["y"].items()}
BLOCKS = R["blocks"]
BX = {k: v + PAD for k, v in R["bx"].items()}
BY = {k: v + PAD for k, v in R["by"].items()}
CANVAS_W = R["w"] + 2 * PAD
CANVAS_H = R["h"] + 2 * PAD


def edge_path(a, b):
    """A call, as one cubic.

    Down the page is the normal direction, so the handles are vertical and the
    curve leaves the caller's underside. A call that goes UP - a callback, or a
    file that the layering had to cut a cycle in - leaves the caller's top and
    bows sideways, so it cannot be mistaken for a forward call at a glance.
    """
    x0, y0 = X[a], Y[a]
    x1, y1 = X[b], Y[b]
    if y1 > y0 + NH:
        p0 = (x0, y0 + NH / 2.0)
        p1 = (x1, y1 - NH / 2.0)
        m = (p0[1] + p1[1]) / 2.0
        return "M%.1f,%.1f C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (
            p0[0], p0[1], p0[0], m, p1[0], m, p1[0], p1[1])
    p0 = (x0, y0 - NH / 2.0)
    p1 = (x1, y1 - NH / 2.0)
    bow = max(34.0, abs(y1 - y0) * 0.45 + abs(x1 - x0) * 0.08)
    return "M%.1f,%.1f C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (
        p0[0], p0[1], p0[0], p0[1] - bow, p1[0], p1[1] - bow, p1[0], p1[1])


def svg():
    # The not-running blocks lay out as a contiguous TAIL (see layout_mod), so
    # the live graph is everything above the first of them. `data-live-h` is
    # that height, and it is what the page fits to while they are hidden -
    # without it, hiding the tail would just leave a third of the frame empty.
    live_h = max([BY[m] + b["h"] for m, b in BLOCKS.items()
                  if graph.MOD.get(m) != "ded"] or [CANVAS_H]) + PAD
    o = ["<svg id=\"cg\" data-w=\"%.0f\" data-h=\"%.0f\" data-live-h=\"%.0f\" "
         "xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" "
         "aria-label=\"The bound.less call graph: %d functions in %d files, "
         "%d calls\">" % (CANVAS_W, CANVAS_H, live_h, len(graph.nodes()),
                          len(BLOCKS), len(graph.E)),
         "<g id=\"cg-vp\">"]

    # ---- the file blocks, behind everything ----
    o.append('<g class="cg-blocks">')
    for m, b in sorted(BLOCKS.items(), key=lambda kv: kv[0]):
        grp = graph.MOD[m]
        o.append('<g class="cg-b cg-%s" data-mod="%s">' % (grp, html.escape(m)))
        o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="4"/>'
                 % (BX[m], BY[m], b["w"], b["h"]))
        # --tmax is this block's OWN ceiling on the counter-scale: how much
        # bigger than 1x its name may be drawn before it would run past the
        # block's right edge. The page scales every file name up as you zoom
        # out; this is what stops a narrow block's name crossing its neighbour.
        tmax = max(1.0, (b["w"] - 2 * LM.BLOCK_PAD) / max(1.0, b["titlew"]))
        o.append('<text class="cg-bt" style="--tmax:%.2f" x="%.1f" y="%.1f">'
                 '%s <tspan class="cg-bn">%d</tspan></text>'
                 % (tmax, BX[m] + LM.BLOCK_PAD, BY[m] + 14,
                    html.escape(graph.MODNAME[m]), len(b["nodes"])))
        o.append("</g>")
    o.append("</g>")

    # ---- the calls ----
    o.append('<g class="cg-edges">')
    for a, b in graph.E:
        same = a.split(".", 1)[0] == b.split(".", 1)[0]
        o.append('<path class="cg-e %s" data-a="%s" data-b="%s" d="%s"/>'
                 % ("cg-in" if same else "cg-out",
                    html.escape(a), html.escape(b), edge_path(a, b)))
    o.append("</g>")

    # ---- the functions ----
    o.append('<g class="cg-nodes">')
    for m, b in sorted(BLOCKS.items(), key=lambda kv: kv[0]):
        grp = graph.MOD[m]
        for n in b["nodes"]:
            c, _r = b["slot"][n]
            w = b["colw"][c]
            why = WHY.get(n)
            kind = ENTRY.get(n)
            cls = ["cg-n", "cg-" + grp]
            if why:
                cls.append("cg-iso")
            if kind:
                cls += ["cg-entry", "cg-in-" + kind]
            if n in TESTONLY:
                cls.append("cg-testonly")
            if n in DEAD:
                cls.append("cg-dead")
            o.append('<g class="%s" data-id="%s" data-mod="%s"%s%s '
                     'tabindex="0" role="button">'
                     % (" ".join(cls), html.escape(n), html.escape(m),
                        (' data-why="%s"' % html.escape(why)) if why else "",
                        (' data-entry="%s"' % html.escape(kind)) if kind else ""))
            o.append("<title>%s  (%s)</title>"
                     % (html.escape(n), html.escape(graph.MODNAME[m])))
            o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2.5"/>'
                     % (X[n] - w / 2.0, Y[n] - NH / 2.0, w, NH))
            o.append('<text x="%.1f" y="%.1f">%s</text>'
                     % (X[n], Y[n] + 3.4, html.escape(graph.label(n))))
            if n in DEAD:
                # Struck through, drawn rather than styled: SVG text-decoration
                # is patchy across engines and this has to be unmistakable.
                o.append('<line class="cg-strike" x1="%.1f" y1="%.1f" '
                         'x2="%.1f" y2="%.1f"/>'
                         % (X[n] - w / 2.0 + 2, Y[n], X[n] + w / 2.0 - 2, Y[n]))
            o.append("</g>")
    o.append("</g></g></svg>")
    return "\n".join(o)


def adjacency():
    dn = collections.defaultdict(list)
    up = collections.defaultdict(list)
    for a, b in graph.E:
        dn[a].append(b)
        up[b].append(a)
    return {"dn": dict(dn), "up": dict(up)}


def stats():
    ind = collections.Counter(b for a, b in graph.E)
    outd = collections.Counter(a for a, b in graph.E)
    deg = collections.Counter()
    for a, b in graph.E:
        deg[a] += 1
        deg[b] += 1
    cross = sum(1 for a, b in graph.E
                if a.split(".", 1)[0] != b.split(".", 1)[0])
    bywhy = collections.Counter(WHY.values())
    return {
        "why": dict(bywhy),
        "uncalled": sum(bywhy.values()),
        "entries": len(ENTRY),
        "entrykinds": dict(collections.Counter(ENTRY.values())),
        "testonly": len(TESTONLY),
        "dead": len(DEAD),
        "unreferenced": bywhy.get("UNREFERENCED", 0),
        "nodes": len(graph.nodes()), "edges": len(graph.E),
        "files": len(BLOCKS), "bands": max(R["layers"]) + 1,
        "cross": cross, "inside": len(graph.E) - cross,
        "isolated": len([n for n in graph.nodes() if not deg[n]]),
        "fanin": ind.most_common(6), "fanout": outd.most_common(6),
        "hand": len(graph.E_HAND), "sited": len(graph.SITES),
        "agree": graph.AGREE,
    }


if __name__ == "__main__":
    import io
    io.open("graph2.svg", "w", encoding="utf-8").write(svg())
    s = stats()
    print("canvas %.0f x %.0f" % (CANVAS_W, CANVAS_H))
    for k in ("nodes", "edges", "files", "bands", "cross", "inside", "isolated"):
        print("%-9s %s" % (k, s[k]))
    print("top fan-in ", s["fanin"])
    print("top fan-out", s["fanout"])
