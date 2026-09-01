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
