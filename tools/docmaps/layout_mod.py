# -*- coding: utf-8 -*-
"""A module-blocked layout for the whole call graph.

WHY NOT THE LAYERED ONE. `layout.py` draws a Sugiyama layering, and for the
255-node spine it is the right picture: entry points at the top, pure helpers
at the bottom. Run it over all 1,103 functions and it collapses - 28 layers,
4,600 dummy nodes, and a canvas 33,000 pixels wide by 1,300 tall. A 25:1 strip
is not a diagram, it is a scroll.

WHAT THIS DOES INSTEAD. Every function is drawn inside a labelled block for the
file that defines it, and the BLOCKS are layered by the calls between files.
That keeps the same top-to-bottom reading - the editor and the hook at the top,
`clipperOutline` and the vector helpers at the bottom - at a scale where the
whole thing fits on a screen, and it adds something the flat layering could not
show: which file a function lives in, without reading its colour.

Within a block, functions are ordered by their own intra-file calls (a caller
sits above what it calls) and then poured into columns.

Everything is computed offline; the artifact ships static SVG.
"""
import collections
import graph

CHARW = 5.85           # IBM Plex Mono at 10.5px
PADX = 8.0
NODE_H = 17.0
ROW_GAP = 4.0
COL_GAP = 8.0
BLOCK_PAD = 9.0
TITLE_H = 20.0
BLOCK_GAP_X = 26.0
BLOCK_GAP_Y = 34.0
# A layer wider than this wraps onto another row of the same band. Without it
# the first band alone - every file nothing else calls, from CanvasEditor down
# to a one-line icon - runs eleven thousand pixels across.
TARGET_W = 4200.0
TARGET_ASPECT = 2.6    # a block wider than tall reads better in a wide canvas
MAX_ROWS = 26          # past this a block becomes a wall of text
TITLE_ZOOM = 1.9       # how much bigger than 1x a file name may be drawn


def width_of(nid):
    return len(graph.label(nid)) * CHARW + 2 * PADX


# ---------------------------------------------------------------------------
# 1. the module graph
# ---------------------------------------------------------------------------
def module_graph():
    """Which file calls which, and how often."""
    w = collections.Counter()
    for a, b in graph.E:
        ma, mb = a.split(".", 1)[0], b.split(".", 1)[0]
        if ma != mb:
            w[(ma, mb)] += 1
    return w


def break_cycles(nodes, out, roots):
    colour = {n: 0 for n in nodes}
    back = set()
    order = [r for r in roots if r in colour] + [n for n in nodes if n not in roots]
    for root in order:
        if colour[root] != 0:
            continue
        stack = [(root, iter(out.get(root, ())))]
        colour[root] = 1
        while stack:
            u, it = stack[-1]
            advanced = False
            for v in it:
                if colour[v] == 1:
                    back.add((u, v))
                elif colour[v] == 0:
                    colour[v] = 1
                    stack.append((v, iter(out.get(v, ()))))
                    advanced = True
                    break
            if not advanced:
                colour[u] = 2
                stack.pop()
    return back


def longest_path(nodes, edges):
    succ = collections.defaultdict(list)
    indeg = {n: 0 for n in nodes}
    for a, b in edges:
        succ[a].append(b)
        indeg[b] += 1
    layer = {n: 0 for n in nodes}
    q = collections.deque([n for n in nodes if indeg[n] == 0])
    seen = 0
    while q:
        u = q.popleft()
        seen += 1
        for v in succ[u]:
            if layer[u] + 1 > layer[v]:
                layer[v] = layer[u] + 1
            indeg[v] -= 1
            if not indeg[v]:
                q.append(v)
    assert seen == len(nodes), "cycle survived in the module graph"
    return layer


# ---------------------------------------------------------------------------
# 2. one block: order its functions, then pour them into columns
# ---------------------------------------------------------------------------
def order_within(mod, members):
    """Caller above callee, using only this file's own calls."""
    inside = [(a, b) for a, b in graph.E
              if a in members and b in members and a != b]
    out = collections.defaultdict(list)
    for a, b in inside:
        out[a].append(b)
    back = break_cycles(list(members), out, [])
    fwd = [e for e in inside if e not in back]
    lay = longest_path(list(members), fwd)
    # ties break on the source order, which is the order the file reads in
    pos = {n: i for i, n in enumerate(members)}
    return sorted(members, key=lambda n: (lay[n], pos[n]))


def shape(n):
    """Rows and columns for n functions, near TARGET_ASPECT and under MAX_ROWS."""
    if n <= 3:
        return n, 1
    rows = max(1, int(round((float(n) / TARGET_ASPECT) ** 0.5)))
    rows = min(max(rows, 1), MAX_ROWS)
    cols = (n + rows - 1) // rows
    rows = (n + cols - 1) // cols
    return rows, cols


def build_block(mod, members):
    ordered = order_within(mod, members)
    rows, cols = shape(len(ordered))
    slot = {}
    colw = [0.0] * cols
    for i, n in enumerate(ordered):
        c, r = i // rows, i % rows
        slot[n] = (c, r)
        colw[c] = max(colw[c], width_of(n))
    xoff, cx = [], BLOCK_PAD
    for c in range(cols):
        xoff.append(cx)
        cx += colw[c] + COL_GAP
    w = cx - COL_GAP + BLOCK_PAD
    used_rows = min(rows, len(ordered))
    h = TITLE_H + BLOCK_PAD + used_rows * (NODE_H + ROW_GAP) - ROW_GAP + BLOCK_PAD
    # THE FILE NAME IS THE LABEL THAT MATTERS ZOOMED OUT, so the block reserves
    # room for it at TITLE_ZOOM rather than at 1x. Without this a three-function
    # file is 90px wide, its name is drawn at the zoomed-out size to stay
    # legible, and it runs straight across its neighbour - which is exactly what
    # the crowded band of one- and two-function components did.
    titlew = len(graph.MODNAME[mod]) * 6.0 + len(str(len(ordered))) * 5.0 + 6.0
    w = max(w, titlew * TITLE_ZOOM + 2 * BLOCK_PAD)
    return {"mod": mod, "nodes": ordered, "slot": slot, "colw": colw,
            "xoff": xoff, "rows": rows, "cols": cols, "w": w, "h": h,
            "titlew": titlew}


# ---------------------------------------------------------------------------
# 3. place the blocks
# ---------------------------------------------------------------------------
def compute():
    members = collections.defaultdict(list)
    for n in graph.nodes():
        members[n.split(".", 1)[0]].append(n)
    mods = sorted(members)

    mw = module_graph()
    out = collections.defaultdict(list)
    for (a, b) in mw:
        out[a].append(b)
    roots = ["edt", "gal", "hok", "app", "eng"]
    back = break_cycles(mods, out, roots)
    fwd = [e for e in mw if e not in back]
    mlayer = longest_path(mods, fwd)

    # THE CODE THAT DOES NOT RUN GOES LAST.
    #
    # An oracle has no production caller by definition, so the layering puts it
    # in layer 0 - and `KobinEngineV0` is 77 functions, which made the retired
    # engine the widest block on a graph of what the app does, sitting in the
    # top band above everything that actually runs. The not-running modules are
    # 27% of the drawing area.
    #
    # Pushing them below every live module costs nothing (they have no edges to
    # live code, so no line gets longer) and buys two things: the graph now
    # reads top-down as the app, and the page's "hide not running" toggle
    # removes a contiguous TAIL instead of punching holes through the middle.
    live_max = max([mlayer[m] for m in mods if graph.MOD.get(m) != "ded"] or [0])
    for m in mods:
        if graph.MOD.get(m) == "ded":
            mlayer[m] = live_max + 1 + mlayer[m]

    blocks = {m: build_block(m, members[m]) for m in mods}

    # order the blocks in each layer by where their callers sit above
    layers = collections.defaultdict(list)
    for m in mods:
        layers[mlayer[m]].append(m)
    nlayers = max(layers) + 1

    up = collections.defaultdict(list)
    for (a, b) in fwd:
        up[b].append(a)

    xpos, ypos = {}, {}
    y = 0.0
    placed_x = {}
    rows_of = {}                      # layer -> list of rows, each a list of mods
    for li in range(nlayers):
        L = layers[li]
        if li == 0:
            L.sort(key=lambda m: (-len(members[m]), m))
        else:
            def bary(m):
                ps = [placed_x[p] for p in up.get(m, ()) if p in placed_x]
                return sum(ps) / float(len(ps)) if ps else 1e9
            L.sort(key=lambda m: (bary(m), m))
        # wrap the band into rows no wider than TARGET_W
        rows, cur, curw = [], [], 0.0
        for m in L:
            bw = blocks[m]["w"]
            if cur and curw + bw > TARGET_W:
                rows.append(cur)
                cur, curw = [], 0.0
            cur.append(m)
            curw += bw + BLOCK_GAP_X
        if cur:
            rows.append(cur)
        rows_of[li] = rows
        for row in rows:
            x = 0.0
            for m in row:
                xpos[m] = x
                ypos[m] = y
                placed_x[m] = x + blocks[m]["w"] / 2.0
                x += blocks[m]["w"] + BLOCK_GAP_X
            y += max(blocks[m]["h"] for m in row) + BLOCK_GAP_Y

    # centre every row, so the drawing reads as a column rather than a wedge
    total_w = 0.0
    for li in range(nlayers):
        for row in rows_of[li]:
            total_w = max(total_w, xpos[row[-1]] + blocks[row[-1]]["w"])
    for li in range(nlayers):
        for row in rows_of[li]:
            wide = xpos[row[-1]] + blocks[row[-1]]["w"]
            shift = (total_w - wide) / 2.0
            for m in row:
                xpos[m] += shift
                placed_x[m] += shift

    X, Y = {}, {}
    for m in mods:
        b = blocks[m]
        bx, by = xpos[m], ypos[m]
        for n in b["nodes"]:
            c, r = b["slot"][n]
            X[n] = bx + b["xoff"][c] + b["colw"][c] / 2.0
            Y[n] = by + TITLE_H + BLOCK_PAD + r * (NODE_H + ROW_GAP) + NODE_H / 2.0
    return {
        "blocks": blocks, "bx": xpos, "by": ypos, "layers": layers,
        "rows_of": rows_of,
        "mlayer": mlayer, "x": X, "y": Y, "w": total_w,
        "h": y - BLOCK_GAP_Y, "back": back, "modw": mw,
        "width_of": width_of,
    }


if __name__ == "__main__":
    R = compute()
    print("canvas %.0f x %.0f" % (R["w"], R["h"]))
    print("module layers: %d" % (max(R["layers"]) + 1))
    for li in sorted(R["layers"]):
        L = R["layers"][li]
        print("  %2d  %s" % (li, " ".join(graph.MODNAME[m] for m in L)))
    print("cross-file edges: %d" % sum(R["modw"].values()))
    print("module cycles broken: %d" % len(R["back"]))
