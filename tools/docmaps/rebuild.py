# -*- coding: utf-8 -*-
"""The whole rebuild, in the order README.md gives, stopping at the first failure.

    python tools/docmaps/rebuild.py        (from anywhere)

The source readers run from the repository root; everything else from here.
The audits run BEFORE the graph page, which reads their output to mark nodes.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
STEPS = [
    (REPO, "tools/docmaps/inventory.py"),
    (REPO, "tools/docmaps/extract.py"),
    (HERE, "graph.py"),
    (HERE, "expand_codemap.py"),
    (HERE, "enhance_codemap.py"),
    (HERE, "audit_isolated.py"),
    (HERE, "audit_entries.py"),
    (HERE, "build_graph_page.py"),
    (HERE, "check.py"),
    (HERE, "build.py"),
    (HERE, "verify_coverage.py"),
    (HERE, "audit_stale.py"),
]

for cwd, script in STEPS:
    r = subprocess.run([sys.executable, script], cwd=cwd, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, universal_newlines=True, encoding="utf-8")
    lines = r.stdout.rstrip().split("\n")
    print("== %s (exit %d)" % (script, r.returncode))
    for ln in (lines if r.returncode or script in ("verify_coverage.py", "audit_stale.py")
               else lines[:3]):
        if ln.startswith("      ") and r.returncode == 0:
            continue
        print("   " + ln)
    if r.returncode:
        sys.exit("rebuild stopped at %s" % script)
