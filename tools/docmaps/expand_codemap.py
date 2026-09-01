# -*- coding: utf-8 -*-
"""Expand the Code Map so every function in the codebase has a row.

The pristine page summarised the scale bar, the shell and the not-running code
at FILE level - three articles covering 391 functions between them. This
replaces those three with per-module articles built from `newdesc.E`, and
appends the handful of rows the engine articles were missing.

Run before enhance_codemap.py, which then attaches the long explanations.
"""
import io, os, re, json, html as H
import newdesc

import os
HERE = os.path.dirname(os.path.abspath(__file__))

SRC = os.path.join(HERE, "pages", "boundless-code-map.pristine.html")
OUT = os.path.join(HERE, "pages", "boundless-code-map.expanded.html")

LINECOUNT = {
    "sb-catalog": "346 lines", "sb-membership": "167 lines",
    "sb-preference": "117 lines", "sb-prefrange": "136 lines",
    "sb-ladder": "134 lines", "sb-nice": "216 lines", "sb-logmath": "93 lines",
    "sb-resolve": "215 lines", "sb-pick": "158 lines", "sb-session": "94 lines",
    "sb-rungs": "175 lines", "sb-rules": "195 lines", "sb-format": "101 lines",
    "sh-hook": "602 lines", "sh-local": "417 lines", "sh-thumbs": "84 lines",
    "sh-cloud": "227 lines", "sh-auth": "71 lines", "sh-pages": "2,878 lines",
    "sh-components": "700 lines",
    "nr-v0": "1,152 lines", "nr-curveperim": "1,409 lines",
    "nr-strokeshape": "680 lines", "nr-bakestrat": "520 lines",
    "nr-cede": "377 lines", "nr-erase": "73 lines", "nr-labs": "1,676 lines",
    "nr-testsupport": "66 lines",
}
PILL = {
    "nr-v0": "oracle", "nr-curveperim": "oracle", "nr-strokeshape": "oracle",
    "nr-bakestrat": "oracle", "nr-cede": "test only", "nr-erase": "test only",
    "nr-labs": "dev route", "nr-testsupport": "test only",
}


def row(key, v):
    fn = v["fn"]
    what = v["what"]
    ref = v.get("ref") or ""
    return ('    <tr><td class="fn">%s</td><td class="wt">%s</td>'
            '<td class="ref">%s</td></tr>' % (fn, what, ref))


def article(aid, title, role, css, mods):
    ents = newdesc.entries_for(mods)
    lines = ['<article class="file %s" id="%s">' % (css, aid),
             '  <header>',
             '    <h3>%s%s</h3>' % (
                 title,
                 (' <span class="lines">%s</span>' % LINECOUNT[aid]) if aid in LINECOUNT else ""),
             '    <p class="role">%s%s</p>' % (
                 ('<span class="pill %s">%s</span> ' % (
                     "dead" if PILL.get(aid) in ("test only",) else "key",
                     PILL[aid])) if aid in PILL else "",
                 role),
             '  </header>',
             '  <div class="tw"><table>',
             '    <tr><th class="fn">Function</th>'
             '<th>What it does in the design</th><th class="ref">§</th></tr>']
    for k, v in ents:
        lines.append(row(k, v))
    lines += ['  </table></div>', '</article>']
    return "\n".join(lines)


def main():
    s = io.open(SRC, encoding="utf-8").read()

    # 1. the three summary articles become per-module ones
    new_scale = "\n".join(article(a, t, r, c, m) for a, t, r, c, m in newdesc.ARTICLES
                          if a.startswith("sb-"))
    new_shell = "\n".join(article(a, t, r, c, m) for a, t, r, c, m in newdesc.ARTICLES
                          if a.startswith("sh-"))
    new_dead = "\n".join(article(a, t, r, c, m) for a, t, r, c, m in newdesc.ARTICLES
                         if a.startswith("nr-"))
    for wid, repl in (("scalebar", new_scale), ("shell", new_shell), ("dead", new_dead)):
        pat = re.compile(r'<article class="file[^"]*" id="' + wid + r'".*?</article>', re.S)
        if not pat.search(s):
            print("  MISS article", wid)
            continue
        s = pat.sub(lambda m: repl, s, count=1)
        print("  replaced article %-9s with %d per-module articles"
              % (wid, repl.count("<article")))

    # 2. append the rows the engine articles were missing
    for aid, mods in newdesc.APPEND_TO.items():
        if not mods:
            continue
        ents = newdesc.entries_for(mods)
        if not ents:
            continue
        pat = re.compile(r'(<article class="file[^"]*" id="' + aid + r'".*?)(  </table></div>)', re.S)
        m = pat.search(s)
        if not m:
            print("  MISS append target", aid)
            continue
        add = "\n".join(row(k, v) for k, v in ents)
        s = s[:m.end(1)] + add + "\n" + s[m.end(1):]
        print("  appended %2d row(s) to %s" % (len(ents), aid))

    # 3. the standfirst is now a promise the page keeps - and the number in it
    #    is READ FROM THE INVENTORY, so it cannot go stale the next time a
    #    function is added.
    inv = json.load(open(os.path.join(HERE, "data", "inventory.json")))
    total = sum(len(v) for v in inv.values())
    s = re.sub(r'(<p class="standfirst">)(Over five hundred functions|Every function in the codebase)[^<]*',
               lambda m: m.group(1) + (
                   'Every function in the codebase — %s of them, across %d files — '
                   'each mapped to the part of the design it carries out, and each opening into '
                   'a fuller explanation. Read it the way you read an index: find the thing, '
                   'then go to the section that says why it exists.'
                   % ("{:,}".format(total), len(inv))), s, count=1)

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(s)
    print("wrote %s  (%d chars, %d rows)"
          % (os.path.basename(OUT), len(s), len(re.findall(r'<td class="fn', s))))


if __name__ == "__main__":
    main()
