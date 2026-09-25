# -*- coding: utf-8 -*-
"""The Call Map's checks: every row is a node, every parent-child pair is a call
the source makes (`graph.is_call`), and nothing overflows its figure.
Exits non-zero on any problem."""
import sys
import gen, trees

tot, worst, nprob = 0, 0, 0
for key, title, spec in trees.TREES:
    svg, h, rows = gen.render(spec, title)
    bad = gen.check(rows, title)
    probs = gen.calls(rows)
    tot += len(rows)
    nprob += len(probs) + len(bad)
    worst = max(worst, max((gen.LEFT + r[0] * gen.INDENT + gen.NAMEDX + len(r[1]) * gen.CHARW) for r in rows))
    print("%-9s rows=%3d height=%6.0f depth=%d  overflow=%s  not-calls=%d"
          % (key, len(rows), h, max(r[0] for r in rows), bad if bad else "none", len(probs)))
    for name, why in probs:
        print("    %-34s %s" % (name, why))
print("total rows:", tot, " widest name ends at:", round(worst), "of", gen.WIDTH)
print("OK" if not nprob else "PROBLEMS: %d" % nprob)
sys.exit(1 if nprob else 0)
