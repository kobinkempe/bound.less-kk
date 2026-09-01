# -*- coding: utf-8 -*-
"""Top-level functions, classes and class methods across the production tree.

Function-local closures are deliberately excluded: they are implementation of
the function that contains them, and the code map already covers them through
the row for that function.
"""
import os, re, json

import os
HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = "src"
SKIP = (".test.", "__testkit__")
KW = {"if", "for", "while", "switch", "catch", "return", "function", "typeof",
      "new", "do", "else", "try", "await", "yield", "in", "of", "case",
      "default", "delete", "void", "this", "super"}

BS = chr(92)


def strip_noise(line):
    """Drop line comments and string bodies with a char scanner (no regex, so
    no escaping games), leaving braces outside strings intact for depth."""
    out, i, n, q = [], 0, len(line), None
    while i < n:
        c = line[i]
        if q:
            if c == BS:
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in '"' + "'" + "`":
            q = c
            i += 1
            continue
        if c == "/" and i + 1 < n and line[i + 1] == "/":
            break
        out.append(c)
        i += 1
    return "".join(out)


def files():
    out = []
    for d, _, fs in os.walk(ROOT):
        for f in sorted(fs):
            p = os.path.join(d, f).replace(BS, "/")
            if p.endswith(".js") and not any(s in p for s in SKIP):
                out.append(p)
    return out


def scan(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    out, depth, klass, kdepth, inblock = [], 0, None, None, False
    for raw in src.split("\n"):
        s = raw.strip()
        if inblock:
            if "*/" in s:
                inblock = False
            continue
        if s.startswith("/*"):
            if "*/" not in s:
                inblock = True
            continue
        if s.startswith("//") or s.startswith("*"):
            continue
        clean = strip_noise(raw)
        if klass is not None and depth == kdepth + 1:
            mm = re.match(r'^\s*(?:static\s+|get\s+|set\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(', raw)
            if mm and mm.group(1) not in KW:
                out.append({"name": mm.group(1), "kind": "method", "class": klass})
        # TOP LEVEL, two ways. Depth counting is exact for plain JS, but a
        # JSX file can drift it - CanvasesV2 sits at depth 1 for its last
        # three hundred lines - and a drifted counter silently swallows every
        # declaration after the drift. Column zero is the second witness: this
        # codebase writes top-level declarations flush left and nothing else,
        # so either signal alone is enough to start a definition.
        if depth == 0 or (raw[:1] and raw[:1] not in " 	"):
            mc = re.match(r'(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)', s)
            if mc:
                klass, kdepth = mc.group(1), depth
                out.append({"name": mc.group(1), "kind": "class", "class": None})
            m = re.match(r'(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*[*]?\s*([A-Za-z_$][\w$]*)\s*\(', s)
            if m:
                out.append({"name": m.group(1), "kind": "function", "class": None})
            m = re.match(r'(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>', s)
            if m:
                out.append({"name": m.group(1), "kind": "arrow", "class": None})
            m = re.match(r'(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function', s)
            if m:
                out.append({"name": m.group(1), "kind": "function", "class": None})
        depth += clean.count("{") - clean.count("}")
        if klass is not None and depth <= kdepth:
            klass, kdepth = None, None
    seen, ded = set(), []
    for t in out:
        k = (t["name"], t["kind"], t["class"])
        if k in seen:
            continue
        seen.add(k)
        ded.append(t)
    return ded


inv = {}
for p in files():
    f = scan(p)
    if f:
        inv[p] = f
tot = sum(len(v) for v in inv.values())
print("files %d   top-level functions/classes/methods: %d" % (len(inv), tot))
json.dump(inv, open(os.path.join(HERE, "data", "inventory.json"), "w"), indent=0)
for p in sorted(inv):
    print("  %-48s %3d" % (p, len(inv[p])))
