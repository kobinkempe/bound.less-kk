# -*- coding: utf-8 -*-
"""Names the Code Map claims exist, that the file it claims them in does not.

Two things make a naive diff useless. `_names` reads argument lists, so most of
the difference is parameter noise - dropped here by ignoring anything that only
appears INSIDE parentheses. And a method name is only meaningful against ITS
OWN file: `get` and `has` are defined somewhere in `src/`, but the row asserting
them sits under LevelMap, which no longer has either.

So every article is pinned to the module(s) it documents, and a claim is
checked against exactly those files.

A hit here is the worst kind of documentation bug: the page sends a reader to
look at something that is not there.
"""
import io, os, re, json, sys
import descriptions, graph

HERE = os.path.dirname(os.path.abspath(__file__))
CMAP = os.path.join(HERE, "pages", "boundless-code-map.html")
REPO = os.path.dirname(os.path.dirname(HERE))

# Article id -> the module keys it documents.
#
# The Code Map's six engine articles are organised BY SUBJECT, and since the
# 2026-08-31 split the subjects are files: `engine-erase` is `erasePipeline.js`,
# `engine-select` is `selection.js` plus the overlay geometry, `engine-files` is
# `files.js` plus `sceneOps.js`. They used to all resolve to `eng` because there
# was only one file. An article may name several modules; a row is stale only
# when NONE of them defines it.
ARTMOD = {
    "frameLattice": ["fl"], "Camera": ["cam"], "LevelMap": ["lm"],
    "Document": ["doc"], "persist": ["per"], "biarc": ["bia"],
    "arcPerimeter": ["arc"], "arcShape": ["shp"], "freeze": ["frz"],
    "derive": ["der"], "TileStore": ["ts"], "Renderer": ["rnd"],
    "connect": ["con"], "hittest": ["hit"], "lasso": ["las"],
    "clipperOutline": ["ply", "clb"], "curveOutline": ["cvo"], "scenes": ["scn"],
    "engine-diag": ["eng", "ins", "ovl"],
    # engine-life is where `newdesc.APPEND_TO` puts every engine module's extra
    # rows, so it has to accept all of them - keep these two lists in step.
    "engine-life": ["eng", "erp", "ovl", "sel", "sco", "fil",
                    "ins", "rmt", "mix", "now"],
    "engine-input": ["eng", "erp"],
    "engine-erase": ["eng", "erp"],
    "engine-select": ["eng", "sel", "ovl", "rmt"],
    "engine-files": ["eng", "fil", "sco"],
}
for _a, _t, _r, _c, _m in __import__("newdesc").ARTICLES:
    ARTMOD[_a] = _m


def outside_parens(text):
    out, depth = [], 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out)


def exported_constants(mods, modfile):
    """`export const NAME = ...` that is not a function.

    The Code Map documents the lattice constants and the seam tables in a row
    of their own, and it should: BASE, ENTER, R and W are the design. They are
    not in the function inventory, so they would read as stale names here.
    """
    out = set()
    pat = re.compile(r'^export const ([A-Z][A-Z0-9_]*)\s*=', re.M)
    for m in mods:
        path = modfile.get(m)
        if not path or not os.path.exists(path):
            continue
        out |= set(pat.findall(io.open(path, encoding="utf-8",
                                       errors="replace").read()))
    return out


def main():
    data = json.load(open(os.path.join(HERE, "data", os.path.join(HERE, "data", "graphdata.json"))))
    U = data["universe"]
    MODFILE = {k: os.path.join(REPO, v) for k, v in data["modfile"].items()}

    def known(mods, nm):
        leaf = nm.split(".")[-1]
        if leaf in exported_constants(mods, MODFILE):
            return True
        for m in mods:
            u = U.get(m, {})
            if nm in u or leaf in u:
                return True
            if any(k.endswith("." + leaf) for k in u):
                return True
        return False

    s = io.open(CMAP, encoding="utf-8").read()
    art = re.compile(r'<article class="file[^"]*" id="([^"]+)"')
    marks = [(m.start(), m.group(1)) for m in art.finditer(s)]

    def section_at(pos):
        cur = ""
        for start, name in marks:
            if start <= pos:
                cur = name
            else:
                break
        return cur

    bad, unmapped = [], set()
    for m in re.finditer(r'<td class="fn[^"]*">(.*?)</td>', s, re.S):
        sect = section_at(m.start())
        mods = ARTMOD.get(sect)
        if mods is None:
            unmapped.add(sect)
            continue
        cell = descriptions._text(m.group(1))
        for nm in descriptions._names(outside_parens(cell)):
            if not known(mods, nm):
                bad.append((sect, nm, cell))

    for sect, nm, cell in bad:
        print("  %-14s %-22s  row: %s" % (sect, nm, cell[:62]))
    if unmapped:
        print("\narticles with no module mapping: %s" % ", ".join(sorted(unmapped)))
    print("\nnames the page asserts that its own file does not define: %d" % len(bad))
    return 1 if bad or unmapped else 0


if __name__ == "__main__":
    sys.exit(main())
