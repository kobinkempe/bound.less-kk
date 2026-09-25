# -*- coding: utf-8 -*-
"""Top-level functions, classes and class methods across the production tree.

Function-local closures are deliberately excluded: they are implementation of
the function that contains them, and the code map already covers them through
the row for that function.

Test suites (`*.test.js`), probes (`*.probe.js`, run by the test runner and never
bundled) and the testkit are not the product and are not inventoried.
"""
import os, re, json

from _mask import mask

HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = "src"
SKIP = (".test.", ".probe.", "__testkit__")
KW = {"if", "for", "while", "switch", "catch", "return", "function", "typeof",
      "new", "do", "else", "try", "await", "yield", "in", "of", "case",
      "default", "delete", "void", "this", "super"}

BS = chr(92)


def files():
    out = []
    for d, _, fs in os.walk(ROOT):
        for f in sorted(fs):
            p = os.path.join(d, f).replace(BS, "/")
            if p.endswith(".js") and not any(s in p for s in SKIP):
                out.append(p)
    return out


def scan(path):
    """Definitions, read off the MASKED source: braces inside strings, regex
    literals and comments are not counted, and a definition-shaped line inside
    a comment or a template literal is not a definition."""
    src = open(path, encoding="utf-8", errors="replace").read()
    out, depth, klass, kdepth = [], 0, None, None
    for clean in mask(src).split("\n"):
        s = clean.strip()
        if klass is not None and depth == kdepth + 1:
            mm = re.match(r'^\s*(?:static\s+|get\s+|set\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(', clean)
            if mm and mm.group(1) not in KW:
                out.append({"name": mm.group(1), "kind": "method", "class": klass})
        # TOP LEVEL, two ways. Depth counting is exact for plain JS, but a
        # JSX file can drift it (an apostrophe in JSX text reads as a string).
        # Column zero is the second witness: this codebase writes top-level
        # declarations flush left and nothing else, so either signal alone is
        # enough to start a definition.
        if depth == 0 or (clean[:1] and clean[:1] not in " \t"):
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


def main():
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


if __name__ == "__main__":
    main()
