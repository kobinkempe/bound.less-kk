import gen, trees
tot = 0
worst = 0
for key, title, spec in trees.TREES:
    svg, h, rows = gen.render(spec, title)
    bad = gen.check(rows, title)
    tot += len(rows)
    worst = max(worst, max((gen.LEFT + d * gen.INDENT + gen.NAMEDX + len(n) * gen.CHARW) for d, n, k, c in rows))
    print("%-9s rows=%3d height=%6.0f depth=%d  overflow=%s"
          % (key, len(rows), h, max(d for d, n, k, c in rows), bad if bad else "none"))
print("total rows:", tot, " widest name ends at:", round(worst), "of", gen.WIDTH)
