# -*- coding: utf-8 -*-
"""Make every Code Map row expand into its comprehensive explanation.

The Code Map is post-processed rather than regenerated, so the prose already
written there is untouched: each row gains the list of functions it covers, a
detail row is inserted after it, and one script toggles them.
"""
import io, os, re, json, html as H
import descriptions, longdesc

import os
HERE = os.path.dirname(os.path.abspath(__file__))

# Reads the EXPANDED page (every function has a row by then) and writes the
# published one. Rebuild the chain with:  expand_codemap.py && enhance_codemap.py
SRC = os.path.join(HERE, "pages", "boundless-code-map.expanded.html")
OUT = os.path.join(HERE, "pages", "boundless-code-map.html")

def names_of(fn_cell):
    return descriptions._names(fn_cell)

def build():
    s = io.open(SRC, encoding="utf-8").read()
    if "cm-detail" in s:
        raise SystemExit("already enhanced — rebuild the Code Map first")

    LONG = longdesc.LONG
    # a row: <tr> ... <td class="fn..">NAMES</td> ... </tr>
    # `<tr ...>` with attributes, not just a bare `<tr>` — the HIGHLIGHTED rows
    # carry class="hi", and they are precisely the load-bearing ones, so a
    # pattern that missed them would skip exactly what matters most.
    row_re = re.compile(
        r'<tr(?P<attrs>\s[^>]*)?>(?P<body>(?:(?!</tr>).)*?<td class="fn[^"]*">(?P<fn>.*?)</td>.*?)</tr>',
        re.S)

    # Which file section a row sits in, so an ambiguous name like `constructor`
    # resolves to the right one. Scoped keys are written `@Section.name`.
    art_re = re.compile(r'<article class="file[^"]*" id="([^"]+)"')
    bounds = [(m.start(), m.group(1)) for m in art_re.finditer(s)]
    def section_at(pos):
        cur = ""
        for start, name in bounds:
            if start <= pos:
                cur = name
            else:
                break
        return cur

    byleaf = {}
    for k in LONG:
        byleaf.setdefault(k.split(".", 1)[1], k)

    used = [0, 0]
    def repl(m):
        whole, fn_cell = m.group("body"), m.group("fn")
        attrs = m.group("attrs") or ""
        sect = section_at(m.start())
        keys = []
        for nm in names_of(fn_cell):
            for cand in (nm, nm.split(".")[-1]):
                scoped = "@" + sect + "." + cand
                hit = scoped if scoped in LONG else byleaf.get(cand)
                if hit:
                    if hit not in keys:
                        keys.append(hit)
                    break
        used[1] += 1
        if not keys:
            return "<tr" + attrs + ">" + whole + "</tr>"
        used[0] += 1
        cols = len(re.findall(r'<td', whole))
        rid = "d%d" % used[1]
        # Merge into any class the row already carries rather than replacing it,
        # so a highlighted row stays highlighted.
        cm = re.search(r'class="([^"]*)"', attrs)
        if cm:
            rest = attrs.replace(cm.group(0), '', 1)
            head = ('<tr class="%s cm-row"%s data-detail="%s" tabindex="0" role="button" '
                    'aria-expanded="false">' % (cm.group(1), rest, rid))
        else:
            head = ('<tr%s class="cm-row" data-detail="%s" tabindex="0" role="button" '
                    'aria-expanded="false">' % (attrs, rid))
        body = []
        for k in keys:
            # Head the block with the canonical `module.function` id - the same
            # name the Call Graph gives the node - not the lookup key.
            title = longdesc.KEYOF.get(k) or (k[1:] if k.startswith("@") else k)
            body.append('<div class="cm-block"><h5>%s</h5>%s</div>'
                        % (H.escape(title), render(LONG[k])))
        detail = ('<tr class="cm-detail" id="%s" hidden><td colspan="%d">%s</td></tr>'
                  % (rid, cols, "".join(body)))
        return head + whole + "</tr>" + detail

    s = row_re.sub(repl, s)
    print("rows made expandable: %d of %d" % (used[0], used[1]))

    s = s.replace("</style>", CSS + "\n</style>", 1)
    s = s + SCRIPT
    # tell the reader
    s = s.replace(
        "<div><b>Trivial accessors</b>",
        "<div><b>Click any row</b><p>Every row opens into a fuller explanation — what the "
        "function does, in order, and why it is that way.</p></div>\n"
        "    <div><b>Trivial accessors</b>", 1)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(s)
    print("wrote", os.path.basename(OUT), len(s), "chars")

def render(body):
    def emph(t):
        parts = H.escape(t).split("**")
        out = []
        for i, p in enumerate(parts):
            if not p:
                continue
            out.append("<strong>%s</strong>" % p if i % 2 else p)
        return "".join(out)
    if len(body) == 1:
        return "<p>%s</p>" % emph(body[0])
    lis = "".join("<li>%s</li>" % emph(b) for b in body[1:])
    return "<p>%s</p><ul class=\"cm-bul\">%s</ul>" % (emph(body[0]), lis)

CSS = """
/* ---- expandable rows ---- */
tr.cm-row{cursor:pointer}
tr.cm-row:hover td{background:var(--surface-2)}
tr.cm-row td.fn{position:relative}
tr.cm-row td.fn::after{content:"+";position:absolute;right:2px;top:6px;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;color:var(--rule-strong)}
tr.cm-row[aria-expanded="true"] td.fn::after{content:"\\2212";color:var(--object)}
tr.cm-row:focus-visible td{outline:2px solid var(--object);outline-offset:-2px}
tr.cm-detail > td{background:var(--surface);padding:2px 0 14px 0}
.cm-block{border-left:2px solid var(--object);padding:10px 16px;margin:8px 0 0}
.cm-block h5{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
  font-weight:600;letter-spacing:.02em;color:var(--object);margin:0 0 7px}
.cm-block p{font-family:"Source Serif 4",Georgia,serif;font-size:14.5px;line-height:1.5;
  margin:0 0 8px;max-width:78ch;color:var(--ink)}
.cm-block p:last-child{margin-bottom:0}
ul.cm-bul{margin:0;padding-left:18px;list-style:none;max-width:78ch}
ul.cm-bul li{position:relative;margin:0 0 7px;font-family:"Source Serif 4",Georgia,serif;
  font-size:14.5px;line-height:1.5;color:var(--ink)}
ul.cm-bul li::before{content:"";position:absolute;left:-13px;top:.62em;width:4px;height:4px;
  border-radius:50%;background:var(--rule-strong)}
ul.cm-bul li:last-child{margin-bottom:0}
"""

SCRIPT = """
<script>
(function () {
  function toggle(tr) {
    var id = tr.getAttribute("data-detail");
    var d = document.getElementById(id);
    if (!d) return;
    var open = tr.getAttribute("aria-expanded") === "true";
    tr.setAttribute("aria-expanded", open ? "false" : "true");
    if (open) d.setAttribute("hidden", "");
    else d.removeAttribute("hidden");
  }
  document.addEventListener("click", function (ev) {
    var tr = ev.target.closest && ev.target.closest("tr.cm-row");
    if (tr) toggle(tr);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var tr = ev.target.closest && ev.target.closest("tr.cm-row");
    if (tr) { ev.preventDefault(); toggle(tr); }
  });
})();
</script>
"""

if __name__ == "__main__":
    build()
