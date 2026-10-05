# -*- coding: utf-8 -*-
"""Expand the Code Map so every function in the codebase has a row.

The pristine page is hand-written, article by article, for the engine and the
geometry. Everything else is generated here from `newdesc`: each
`<!-- SLOT:name -->` marker in the pristine page is replaced by the articles
`newdesc.ARTICLES` assigns to that slot, and the entries for a module the
pristine page already documents are appended to its article
(`newdesc.APPEND_TO`). Then the table of contents, the line counts, the
standfirst and the masthead are written from the source as it stands, so none
of them can go stale.

Run before enhance_codemap.py, which then attaches the long explanations.
"""
import io, os, re, json, subprocess, datetime, html as H
import newdesc

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

SRC = os.path.join(HERE, "pages", "boundless-code-map.pristine.html")
OUT = os.path.join(HERE, "pages", "boundless-code-map.expanded.html")

PILL = {
    "nr-v0": "oracle", "nr-curveperim": "oracle", "nr-strokeshape": "oracle",
    "nr-bakestrat": "oracle", "nr-cede": "test only", "nr-erase": "test only",
    "nr-coverage": "oracle", "nr-sceneoracle": "oracle", "nr-renderlist": "oracle",
}
PILL.update({a[0]: "frozen model" for a in newdesc.ARTICLES if a[0].startswith("nr-m1")})

_DATA = json.load(open(os.path.join(HERE, "data", "graphdata.json")))
MODFILE = _DATA["modfile"]


def lines_of(mods):
    """The line counts of the modules' files, as the heading shows them."""
    counts = []
    for m in mods:
        p = os.path.join(REPO, MODFILE[m])
        with io.open(p, encoding="utf-8", errors="replace") as f:
            counts.append(sum(1 for _ in f))
    if len(counts) == 1:
        return "{:,} lines".format(counts[0])
    if len(counts) <= 3:
        return " + ".join("{:,}".format(c) for c in counts) + " lines"
    return "%d files · {:,} lines".format(sum(counts)) % len(counts)


def row(key, v):
    return ('    <tr><td class="fn">%s</td><td class="wt">%s</td>'
            '<td class="ref">%s</td></tr>' % (H.escape(v["fn"]).replace("&lt;br&gt;", "<br>"),
                                              H.escape(v["what"]), H.escape(v.get("ref") or "")))


def article(a):
    aid, title, role, css, mods, slot = a
    ents = newdesc.entries_for(mods)
    role = newdesc.role_of(a)
    lines = ['<article class="file %s" id="%s">' % (css, aid),
             '  <header>',
             '    <h3>%s <span class="lines">%s</span></h3>' % (H.escape(title), lines_of(mods)),
             '    <p class="role">%s%s</p>' % (
                 ('<span class="pill %s">%s</span> ' % (
                     "dead" if PILL.get(aid) == "test only" else "key", PILL[aid]))
                 if aid in PILL else "",
                 H.escape(role)),
             '  </header>',
             '  <div class="tw"><table>',
             '    <tr><th class="fn">Function</th>'
             '<th>What it does in the design</th><th class="ref">§</th></tr>']
    for k, v in ents:
        lines.append(row(k, v))
    lines += ['  </table></div>', '</article>']
    return "\n".join(lines)


def git(*args):
    try:
        return subprocess.check_output(("git",) + args, cwd=REPO, stderr=subprocess.DEVNULL,
                                       universal_newlines=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def toc(s):
    """The contents, read off the page: one heading per layer, one link per article."""
    out = ['<nav class="toc" aria-label="Files">']
    layer_re = re.compile(r'<div class="layer">\s*<h2><span class="num">[^<]*</span>\s*([^<]+)</h2>')
    art_re = re.compile(r'<article class="file[^"]*" id="([^"]+)">\s*<header>\s*<h3>(.*?)</h3>', re.S)
    marks = sorted([(m.start(), "L", m.group(1).strip()) for m in layer_re.finditer(s)] +
                   [(m.start(), "A", (m.group(1), m.group(2))) for m in art_re.finditer(s)])
    for _pos, kind, val in marks:
        if kind == "L":
            out.append('  <h4>%s</h4>' % val)
            continue
        aid, h3 = val
        n = re.search(r'<span class="lines">(.*?)</span>', h3)
        name = re.sub(r'<span class="lines">.*?</span>', "", h3).strip()
        num = n.group(1).replace(" lines", "") if n else ""
        out.append('  <a href="#%s">%s%s</a>' % (aid, name,
                                                ('<span class="n">%s</span>' % num) if num else ""))
    out.append('</nav>')
    return "\n".join(out)


def main():
    s = io.open(SRC, encoding="utf-8").read()

    # 1. every slot becomes its generated articles
    slots = {}
    for a in newdesc.ARTICLES:
        slots.setdefault(a[5], []).append(a)
    for slot, arts in slots.items():
        mark = "<!-- SLOT:%s -->" % slot
        if s.count(mark) != 1:
            raise SystemExit("expand_codemap: the pristine page has %d %s markers"
                             % (s.count(mark), mark))
        s = s.replace(mark, "\n\n".join(article(a) for a in arts))
        print("  slot %-9s %2d article(s)" % (slot, len(arts)))
    left = re.findall(r'<!-- SLOT:([\w-]+) -->', s)
    if left:
        raise SystemExit("expand_codemap: no articles for slot(s) %s" % ", ".join(left))

    # 2. append the rows the hand-written articles do not have
    for aid, mods in newdesc.APPEND_TO.items():
        ents = newdesc.entries_for(mods)
        if not ents:
            continue
        pat = re.compile(r'(<article class="file[^"]*" id="' + aid + r'".*?)(  </table></div>)', re.S)
        m = pat.search(s)
        if not m:
            raise SystemExit("expand_codemap: no article %s to append to" % aid)
        add = "\n".join(row(k, v) for k, v in ents)
        s = s[:m.end(1)] + add + "\n" + s[m.end(1):]
        print("  appended %3d row(s) to %s" % (len(ents), aid))

    # 3. a hand-written article that documents whole files gets its line count
    #    from them (the engine's subject articles span six files and show none)
    for aid, mods in newdesc.PRISTINE.items():
        if aid.startswith("engine-"):
            continue
        s, n = re.subn(r'(<article class="file[^"]*" id="' + re.escape(aid) +
                       r'">\s*<header>\s*<h3>.*?<span class="lines">)[^<]*(</span>)',
                       lambda m: m.group(1) + lines_of(mods) + m.group(2), s, count=1, flags=re.S)

    # 4. the contents, the standfirst and the masthead, from the source as it is
    s = re.sub(r'<nav class="toc" aria-label="Files">.*?</nav>', lambda m: toc(s), s, count=1, flags=re.S)
    inv = json.load(open(os.path.join(HERE, "data", "inventory.json")))
    total = sum(len(v) for v in inv.values())
    s = re.sub(r'(<p class="standfirst">)[^<]*',
               lambda m: m.group(1) + (
                   'Every function in the codebase — %s of them, across %d files — '
                   'each mapped to the part of the design it carries out, and each opening into '
                   'a fuller explanation. Read it the way you read an index: find the thing, '
                   'then go to the section that says why it exists.'
                   % ("{:,}".format(total), len(inv))), s, count=1)
    head = git("rev-parse", "--short", "HEAD") or "unknown"
    dirty = git("status", "--porcelain", "--untracked-files=no", "--", "src")
    code_at = head + (" + working tree" if dirty else "")
    s = s.replace("__CODEAT__", code_at)
    s = s.replace("__BRANCH__", git("rev-parse", "--abbrev-ref", "HEAD") or "unknown")
    s = s.replace("__COMPILED__", datetime.date.today().isoformat())

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(s)
    print("wrote %s  (%d chars, %d rows)"
          % (os.path.basename(OUT), len(s), len(re.findall(r'<td class="fn', s))))


if __name__ == "__main__":
    main()
