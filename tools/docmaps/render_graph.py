# -*- coding: utf-8 -*-
import io, json, html, collections
import graph, layout

R = layout.compute()
X, Y, W_OF = R["x"], R["y"], R["width_of"]
LAYERS, SEGS, BACK = R["layers"], R["segs"], set(R["back"])
NH = layout.NODE_H

CANVAS_W = max(X[n] + W_OF(n) / 2.0 for L in LAYERS for n in L) + 24
CANVAS_H = max(Y.values()) + 34

def pts_for(chain):
    """Waypoints down an edge: bottom of the source, dummy centres, top of the target."""
    out = []
    for i, n in enumerate(chain):
        if i == 0:
            out.append((X[n], Y[n] + NH / 2.0))
        elif i == len(chain) - 1:
            out.append((X[n], Y[n] - NH / 2.0))
        else:
            out.append((X[n], Y[n]))
    return out

def path_d(pts):
    d = ["M%.1f,%.1f" % pts[0]]
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]; x1, y1 = pts[i + 1]
        m = (y0 + y1) / 2.0
        d.append("C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (x0, m, x1, m, x1, y1))
    return " ".join(d)

def svg():
    o = []
    # No width/height/viewBox: the SVG fills its frame and everything inside
    # rides one transform on #cg-vp, so pan and zoom cost one attribute write
    # rather than a re-layout. The content's natural size travels as data-w/h
    # so "fit to the frame" can be computed without measuring the DOM.
    o.append('<svg id="cg" data-w="%.0f" data-h="%.0f" '
             'xmlns="http://www.w3.org/2000/svg" role="img" '
             'aria-label="The full bound.less call graph: 255 functions, 373 calls">'
             % (CANVAS_W, CANVAS_H))
    o.append('<g id="cg-vp">')
    o.append('<g class="cg-edges">')
    for a, b, chain in SEGS:
        cls = "cg-e" + (" cg-back" if (a, b) in BACK else "")
        o.append('<path class="%s" data-a="%s" data-b="%s" d="%s"/>'
                 % (cls, html.escape(a), html.escape(b), path_d(pts_for(chain))))
    # THE BACK EDGES. They were removed before layering (a layered graph has to
    # be acyclic) and would otherwise be missing from the drawing entirely —
    # which would make the graph quietly wrong, since all three are real calls.
    # They are drawn last, bowing out to the side so a return edge cannot be
    # mistaken for a forward one.
    for a, b in sorted(BACK):
        wa, wb = W_OF(a), W_OF(b)
        x0, y0 = X[a] + wa / 2.0, Y[a]
        x1, y1 = X[b] + wb / 2.0, Y[b]
        bow = max(58.0, abs(y1 - y0) * 0.55)
        d = "M%.1f,%.1f C%.1f,%.1f %.1f,%.1f %.1f,%.1f" % (
            x0, y0, x0 + bow, y0, x1 + bow, y1, x1, y1)
        o.append('<path class="cg-e cg-back" data-a="%s" data-b="%s" d="%s"/>'
                 % (html.escape(a), html.escape(b), d))
    o.append("</g>")
    o.append('<g class="cg-nodes">')
    for L in LAYERS:
        for n in L:
            if n.startswith("~"):
                continue
            w = W_OF(n)
            grp = graph.MOD[n.split(".", 1)[0]]
            o.append('<g class="cg-n cg-%s" data-id="%s" tabindex="0" role="button">' % (grp, html.escape(n)))
            o.append('<title>%s  (%s)</title>' % (html.escape(n), html.escape(graph.MODNAME[n.split(".",1)[0]])))
            o.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3"/>'
                     % (X[n] - w / 2.0, Y[n] - NH / 2.0, w, NH))
            o.append('<text x="%.1f" y="%.1f">%s</text>'
                     % (X[n], Y[n] + 3.6, html.escape(graph.label(n))))
            o.append("</g>")
    o.append("</g></g></svg>")
    return "\n".join(o)

def adjacency():
    dn = collections.defaultdict(list)
    up = collections.defaultdict(list)
    for a, b in graph.E:
        dn[a].append(b)
        up[b].append(a)
    return {"dn": {k: v for k, v in dn.items()}, "up": {k: v for k, v in up.items()}}

def stats():
    ind = collections.Counter(b for a, b in graph.E)
    outd = collections.Counter(a for a, b in graph.E)
    return {
        "nodes": len(graph.nodes()), "edges": len(graph.E), "layers": len(LAYERS),
        "crossings": R["xings"], "back": sorted(BACK),
        "fanin": ind.most_common(6), "fanout": outd.most_common(6),
        "sources": R["sources"],
    }

if __name__ == "__main__":
    io.open("graph.svg", "w", encoding="utf-8").write(svg())
    io.open("adj.json", "w", encoding="utf-8").write(json.dumps(adjacency()))
    s = stats()
    print("canvas %.0f x %.0f" % (CANVAS_W, CANVAS_H))
    for k in ("nodes", "edges", "layers", "crossings"):
        print("%-10s %s" % (k, s[k]))
    print("sources   ", s["sources"])
    print("top fan-in ", s["fanin"])
    print("top fan-out", s["fanout"])
