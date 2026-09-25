# -*- coding: utf-8 -*-
"""The comprehensive per-function descriptions, merged."""
import graph, long_eng, long_space, long_view, long_ink, long_rest
import newdesc

LONG = {}
for mod in (long_eng, long_space, long_view, long_ink, long_rest):
    LONG.update(mod.L)

# The rest of the codebase - the scale bar, the shell, the interface, the
# oracles - written later, in `newdesc`. The hand-written entries above win on
# a collision, since they are the ones that were verified against the graph.
for _k, _v in newdesc.FULL.items():
    LONG.setdefault(_k, _v)
for _k, _v in newdesc.SCOPED.items():
    LONG.setdefault(_k, _v)

# A FIX (newdesc) is a correction to a text the code has made false, so it wins
# over everything, the hand-written entries included: the node's own key, any
# class-qualified key for the same function (`arc.Grid.insert` for `arc.insert`),
# and any section-scoped key that stands for it.
for _k, _f in newdesc.FIX.items():
    if not _f.get("long"):
        continue
    _mod, _leaf = _k.split(".", 1)[0], _k.split(".")[-1]
    _qualified = _k.count(".") > 1          # `mod.Class.m`: the node names its class
    for _k2 in list(LONG):
        if _k2.startswith("@"):
            if newdesc.KEY_OF.get(_k2) == _k:
                LONG[_k2] = _f["long"]
        elif (not _qualified and _k2.split(".", 1)[0] == _mod
              and _k2.split(".")[-1] == _leaf):
            LONG[_k2] = _f["long"]
    LONG[_k] = _f["long"]

# A section-scoped key is a lookup convenience, not a name. This gives back the
# canonical `module.function` id, so the Code Map heads a detail with exactly
# what the Call Graph calls that node.
KEYOF = dict(newdesc.KEY_OF)

def missing():
    return [n for n in graph.nodes() if n not in LONG]

def extra():
    return [k for k in LONG if k not in set(graph.nodes())]

if __name__ == "__main__":
    m, x = missing(), extra()
    print("described %d of %d" % (len(graph.nodes()) - len(m), len(graph.nodes())))
    print("\nMISSING (%d):" % len(m))
    for n in m: print("   ", n)
    print("\nNOT IN GRAPH (%d):" % len(x))
    for n in x: print("   ", n)
