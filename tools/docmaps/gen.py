# -*- coding: utf-8 -*-
"""Render an indented call tree to SVG with computed coordinates.

A tree is written in `trees.py`, one call per line, two spaces per level:

    display | nodes | note

`nodes` names the graph node(s) the row stands for: `mod.fn`; several
alternatives joined by `,` (`frz.tileWindow,frz.tileClipRect`); a hop the
source makes through a listener or a hook as `a>b` (the row is reached through
`a`, its children are called by `b`); or `-` for a row that is not a call (a
note about state), which may have no children. The swatch colour is the
node's group in `graph.MOD`, so it cannot disagree with the Call Graph, and
`check.py` proves every parent-child pair is a call the source makes.
"""
import io, re, html
import graph

INDENT = 21.0     # px per depth level
ROW    = 20.0     # px per row
SWATCH = 7.0
NAMEDX = 13.0
TOP    = 16.0
LEFT   = 10.0
WIDTH  = 872.0
NOTE_X = 452.0    # notes start here
CHARW  = 6.35     # IBM Plex Mono ~11.5px advance

KINDS = {
    "fac": "var(--k-fac)",   # the engine: KobinEngine and the files mixed onto it
    "spc": "var(--k-spc)",   # Camera, LevelMap, TileStore, the SVG renderer, the store
    "ras": "var(--k-ras)",   # the raster renderer: the paper
    "obj": "var(--k-obj)",   # Document and the ink geometry
    "hlp": "var(--k-hlp)",   # shared pure helpers
    "shl": "var(--k-hlp)",
    "ui":  "var(--k-hlp)",
    "sca": "var(--k-hlp)",
    "ded": "var(--k-hlp)",
}


def parse(spec):
    """-> flat list of (depth, display, kind, note, nodes)"""
    rows = []
    for raw in spec.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        depth = (len(raw) - len(raw.lstrip(" "))) // 2
        parts = [p.strip() for p in raw.strip().split("|")]
        name = parts[0]
        nodes = parts[1] if len(parts) > 1 else "-"
        note = parts[2] if len(parts) > 2 else ""
        last = nodes.split(",")[0].split(">")[-1]
        kind = graph.group(last) if last != "-" and last.split(".", 1)[0] in graph.MOD else "hlp"
        rows.append((depth, name, kind, note, nodes))
    return rows


def render(spec, title):
    rows = parse(spec)
    n = len(rows)
    h = TOP + n * ROW + 8
    out = []
    out.append('<svg viewBox="0 0 %g %g" width="%g" role="img" aria-label="%s">'
               % (WIDTH, h, WIDTH, html.escape(title)))

    ys = [TOP + i * ROW for i in range(n)]

    # connectors: for each row, find its children (next rows at depth+1 until
    # depth drops to <= its own)
    for i, (d, name, kind, note, nodes) in enumerate(rows):
        kids = []
        for j in range(i + 1, n):
            dj = rows[j][0]
            if dj <= d:
                break
            if dj == d + 1:
                kids.append(j)
        if not kids:
            continue
        x = LEFT + d * INDENT + SWATCH / 2.0
        y0 = ys[i] + SWATCH / 2.0 + 2
        y1 = ys[kids[-1]]
        out.append('<path d="M%g,%g V%g" stroke="var(--k-line)" stroke-width="1" fill="none"/>'
                   % (x, y0, y1))
        for j in kids:
            cx = LEFT + rows[j][0] * INDENT
            out.append('<path d="M%g,%g H%g" stroke="var(--k-line)" stroke-width="1" fill="none"/>'
                       % (x, ys[j], cx - 1))

    for i, (d, name, kind, note, nodes) in enumerate(rows):
        y = ys[i]
        x = LEFT + d * INDENT
        col = KINDS.get(kind, KINDS["hlp"])
        out.append('<rect x="%g" y="%g" width="%g" height="%g" rx="1.5" fill="%s"/>'
                   % (x, y - SWATCH / 2.0, SWATCH, SWATCH, col))
        tx = x + NAMEDX
        out.append('<text x="%g" y="%g" class="cm-n">%s</text>'
                   % (tx, y + 3.6, html.escape(name)))
        if note:
            nx = max(NOTE_X, tx + len(name) * CHARW + 14)
            out.append('<text x="%g" y="%g" class="cm-c">%s</text>'
                       % (nx, y + 3.6, html.escape(note)))
    out.append("</svg>")
    return "\n".join(out), h, rows


def check(rows, title):
    """Report anything that would overflow the viewBox."""
    bad = []
    for d, name, kind, note, nodes in rows:
        tx = LEFT + d * INDENT + NAMEDX
        end = tx + len(name) * CHARW
        if note:
            nx = max(NOTE_X, end + 14)
            end = nx + len(note) * CHARW
        if end > WIDTH - 4:
            bad.append((name, round(end)))
    return bad


def calls(rows):
    """Every row's claim, checked against the source: (row, problem) pairs."""
    probs = []
    stack = []            # (depth, the nodes a child must be called by)
    for d, name, kind, note, nodes in rows:
        while stack and stack[-1][0] >= d:
            stack.pop()
        parents = stack[-1][1] if stack else None
        if nodes == "-":
            if parents is None:
                probs.append((name, "a non-call row at the root"))
            stack.append((d, None))
            continue
        heads, tails = [], []
        for alt in nodes.split(","):
            hop = alt.split(">")
            for x in hop:
                if x not in graph.NODES:
                    probs.append((name, "%s is not a node" % x))
            for a, b in zip(hop, hop[1:]):
                if a in graph.NODES and b in graph.NODES and not graph.is_call(a, b):
                    probs.append((name, "%s does not call %s" % (a, b)))
            heads.append(hop[0])
            tails.append(hop[-1])
        if parents is not None:
            if not parents:
                probs.append((name, "its parent row is not a call"))
            for h in heads:
                if h in graph.NODES and not any(graph.is_call(p, h) for p in parents
                                                if p in graph.NODES):
                    probs.append((name, "%s is not called by %s" % (h, " / ".join(parents))))
        stack.append((d, tails))
    return probs
