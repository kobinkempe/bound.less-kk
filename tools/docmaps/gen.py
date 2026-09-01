# -*- coding: utf-8 -*-
"""Render an indented call tree to SVG with computed coordinates."""
import io, re, html

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
    "fac": "var(--k-fac)",   # KobinEngine — the facade
    "spc": "var(--k-spc)",   # Camera / LevelMap / TileStore / Renderer
    "obj": "var(--k-obj)",   # Document + ink geometry
    "hlp": "var(--k-hlp)",   # shared pure helpers
}

def parse(spec):
    """`  name | kind | note` -> flat list of (depth, name, kind, note)."""
    rows = []
    for raw in spec.split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        depth = (len(raw) - len(raw.lstrip(" "))) // 2
        parts = [p.strip() for p in raw.strip().split("|")]
        name = parts[0]
        kind = parts[1] if len(parts) > 1 and parts[1] else "hlp"
        note = parts[2] if len(parts) > 2 else ""
        rows.append((depth, name, kind, note))
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
    for i, (d, name, kind, note) in enumerate(rows):
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

    for i, (d, name, kind, note) in enumerate(rows):
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
    for d, name, kind, note in rows:
        tx = LEFT + d * INDENT + NAMEDX
        end = tx + len(name) * CHARW
        if note:
            nx = max(NOTE_X, end + 14)
            end = nx + len(note) * CHARW
        if end > WIDTH - 4:
            bad.append((name, round(end)))
    return bad
