# -*- coding: utf-8 -*-
"""A layered (Sugiyama-style) layout for the call graph.

break cycles -> assign layers -> insert dummies -> reduce crossings -> place.
Pure python, computed offline; the artifact ships static SVG.
"""
import collections, graph

CHARW = 5.85          # IBM Plex Mono at 10.5px
PADX = 9.0
NODE_H = 19.0
LAYER_GAP = 46.0      # vertical distance between layer baselines
GAP_X = 13.0          # minimum horizontal gap between boxes
DUMMY_W = 3.0

def build():
    E = list(dict.fromkeys(graph.E))
    nodes = graph.nodes()
    out = collections.defaultdict(list)
    for a, b in E:
        out[a].append(b)
    return E, nodes, out

# ---- 1. break cycles ------------------------------------------------------
def break_cycles(nodes, out, sources):
    colour = {n: 0 for n in nodes}     # 0 white, 1 grey (on stack), 2 black
    back = set()
    order = list(sources) + [n for n in nodes if n not in sources]
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

# ---- 2. layers ------------------------------------------------------------
def layer_of(nodes, edges):
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
            if indeg[v] == 0:
                q.append(v)
    assert seen == len(nodes), "cycle survived: %d of %d" % (seen, len(nodes))
    return layer

# ---- 3. dummies -----------------------------------------------------------
def add_dummies(edges, layer):
    segs = []          # (u, v, [chain of node ids])
    extra = {}
    for a, b in edges:
        span = layer[b] - layer[a]
        if span <= 1:
            segs.append((a, b, [a, b]))
            continue
        chain = [a]
        for k in range(1, span):
            d = "~%s>%s#%d" % (a, b, k)
            extra[d] = layer[a] + k
            chain.append(d)
        chain.append(b)
        segs.append((a, b, chain))
    return segs, extra

# ---- 4. ordering ----------------------------------------------------------
def order(layers, adj_up, adj_dn, rounds=14):
    def crossings(L1, L2, pos2):
        # count inversions among edge endpoints, layer L1 -> L2
        seq = []
        for u in L1:
            ts = sorted(pos2[v] for v in adj_dn.get(u, ()) if v in pos2)
            seq.extend(ts)
        cnt = 0
        for i in range(len(seq)):
            for j in range(i + 1, len(seq)):
                if seq[i] > seq[j]:
                    cnt += 1
        return cnt

    def total(ls):
        t = 0
        for i in range(len(ls) - 1):
            pos2 = {n: k for k, n in enumerate(ls[i + 1])}
            t += crossings(ls[i], ls[i + 1], pos2)
        return t

    def pair_x(L1, L2):
        pos2 = {n: k for k, n in enumerate(L2)}
        return crossings(L1, L2, pos2)

    def transpose(ls):
        """Adjacent swaps that strictly reduce crossings — the standard
        companion to the barycentre sweep, and worth more than it here."""
        improved = True
        guard = 0
        while improved and guard < 40:
            improved = False
            guard += 1
            for i in range(len(ls)):
                L = ls[i]
                for k in range(len(L) - 1):
                    before = 0.0
                    if i > 0: before += pair_x(ls[i - 1], L)
                    if i + 1 < len(ls): before += pair_x(L, ls[i + 1])
                    L[k], L[k + 1] = L[k + 1], L[k]
                    after = 0.0
                    if i > 0: after += pair_x(ls[i - 1], L)
                    if i + 1 < len(ls): after += pair_x(L, ls[i + 1])
                    if after < before:
                        improved = True
                    else:
                        L[k], L[k + 1] = L[k + 1], L[k]
        return ls

    best = [list(l) for l in layers]
    bestc = total(best)
    cur = [list(l) for l in layers]
    for r in range(rounds):
        down = (r % 2 == 0)
        rng = range(1, len(cur)) if down else range(len(cur) - 2, -1, -1)
        for i in rng:
            ref = {n: k for k, n in enumerate(cur[i - 1] if down else cur[i + 1])}
            src = adj_up if down else adj_dn
            def bary(n):
                ps = [ref[m] for m in src.get(n, ()) if m in ref]
                return sum(ps) / float(len(ps)) if ps else -1.0
            keyed = [(bary(n), k, n) for k, n in enumerate(cur[i])]
            fixed = [t for t in keyed if t[0] < 0]
            moved = sorted([t for t in keyed if t[0] >= 0])
            merged, mi, fi = [], 0, 0
            for slot in range(len(keyed)):
                if fi < len(fixed) and fixed[fi][1] == slot:
                    merged.append(fixed[fi][2]); fi += 1
                elif mi < len(moved):
                    merged.append(moved[mi][2]); mi += 1
            while fi < len(fixed): merged.append(fixed[fi][2]); fi += 1
            while mi < len(moved): merged.append(moved[mi][2]); mi += 1
            cur[i] = merged
        c = total(cur)
        if c < bestc:
            bestc = c
            best = [list(l) for l in cur]
    best = transpose([list(l) for l in best])
    return best, total(best)

# ---- 5. x placement -------------------------------------------------------
def _isotonic(a, w):
    """Least-squares non-decreasing fit of `a` with weights `w` (PAVA)."""
    vals, wts, cnt = [], [], []
    for ai, wi in zip(a, w):
        vals.append(ai); wts.append(wi); cnt.append(1)
        while len(vals) > 1 and vals[-2] > vals[-1]:
            v2, w2, c2 = vals.pop(), wts.pop(), cnt.pop()
            v1, w1, c1 = vals.pop(), wts.pop(), cnt.pop()
            vals.append((v1 * w1 + v2 * w2) / (w1 + w2))
            wts.append(w1 + w2); cnt.append(c1 + c2)
    out = []
    for v, c in zip(vals, cnt):
        out.extend([v] * c)
    return out

def place(layers, width_of, adj_up, adj_dn, passes=10):
    x = {}
    for L in layers:
        cx = 0.0
        for n in L:
            w = width_of(n)
            x[n] = cx + w / 2.0
            cx += w + GAP_X
    for p in range(passes):
        down = (p % 2 == 0)
        rng = range(len(layers)) if down else range(len(layers) - 1, -1, -1)
        for i in rng:
            L = layers[i]
            if not L:
                continue
            src = adj_up if down else adj_dn
            want, wt = [], []
            for n in L:
                ps = [x[m] for m in src.get(n, ()) if m in x]
                want.append(sum(ps) / float(len(ps)) if ps else x[n])
                wt.append(4.0 if n.startswith("~") else 1.0)   # keep long edges straight
            # minimum centre-to-centre separation, cumulated
            S, acc = [0.0], 0.0
            for k in range(len(L) - 1):
                acc += width_of(L[k]) / 2.0 + GAP_X + width_of(L[k + 1]) / 2.0
                S.append(acc)
            z = _isotonic([want[k] - S[k] for k in range(len(L))], wt)
            for k, n in enumerate(L):
                x[n] = z[k] + S[k]
    lo = min(x[n] - width_of(n) / 2.0 for L in layers for n in L)
    for n in list(x):
        x[n] -= lo
    return x

def compute():
    E, nodes, out = build()
    sources = [n for n in nodes if all(b != n for a, b in E)]
    back = break_cycles(nodes, out, sources)
    fwd = [e for e in E if e not in back]
    layer = layer_of(nodes, fwd)
    segs, extra = add_dummies(fwd, layer)

    alln = dict((n, layer[n]) for n in nodes)
    alln.update(extra)
    nlayers = max(alln.values()) + 1

    # Seed each layer in DFS pre-order from the entry points: related work ends
    # up adjacent before the barycentre sweeps ever run, which is worth several
    # hundred crossings over seeding alphabetically.
    seed, seen = {}, set()
    chain_of = {}
    for a, b, chain in segs:
        for u, v in zip(chain, chain[1:]):
            chain_of.setdefault(u, []).append(v)
    counter = [0]
    def dfs(u):
        if u in seen:
            return
        seen.add(u)
        seed[u] = counter[0]; counter[0] += 1
        for v in chain_of.get(u, ()):
            dfs(v)
    for s0 in sources:
        dfs(s0)
    for n in sorted(alln):
        dfs(n)

    layers = [[] for _ in range(nlayers)]
    for n, l in sorted(alln.items(), key=lambda kv: (kv[1], seed.get(kv[0], 1e9))):
        layers[l].append(n)

    adj_dn = collections.defaultdict(list)
    adj_up = collections.defaultdict(list)
    for a, b, chain in segs:
        for u, v in zip(chain, chain[1:]):
            adj_dn[u].append(v)
            adj_up[v].append(u)

    layers, xings = order(layers, adj_up, adj_dn)

    def width_of(n):
        if n.startswith("~"):
            return DUMMY_W
        return len(graph.label(n)) * CHARW + PADX * 2

    x = place(layers, width_of, adj_up, adj_dn)
    y = {}
    for li, L in enumerate(layers):
        for n in L:
            y[n] = 30.0 + li * LAYER_GAP
    return dict(nodes=nodes, layers=layers, x=x, y=y, width_of=width_of,
                segs=segs, back=sorted(back), layer=alln, xings=xings,
                sources=sources)

if __name__ == "__main__":
    r = compute()
    W = max(r["x"][n] + r["width_of"](n) / 2.0 for L in r["layers"] for n in L)
    H = max(r["y"].values()) + 30
    print("layers        :", len(r["layers"]))
    print("widest layer  :", max(len(L) for L in r["layers"]), "nodes")
    print("dummy nodes   :", sum(1 for L in r["layers"] for n in L if n.startswith("~")))
    print("back edges    :", len(r["back"]), r["back"])
    print("crossings     :", r["xings"])
    print("canvas        : %.0f x %.0f" % (W, H))
