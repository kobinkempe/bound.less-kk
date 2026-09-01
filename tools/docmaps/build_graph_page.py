# -*- coding: utf-8 -*-
import io, json
import graph, render_graph2 as rg, descriptions, longdesc

import os
HERE = os.path.dirname(os.path.abspath(__file__))

SVG = rg.svg()
ADJ = json.dumps(rg.adjacency())
MODNAME = json.dumps(graph.MODNAME)
MODOF = json.dumps({n: n.split(".", 1)[0] for n in graph.nodes()})
MODFILE = json.dumps(rg.LM.graph._DATA["modfile"])
S = rg.stats()
DESC, _missing = descriptions.build()
assert not _missing, _missing
DESCJ = json.dumps(DESC)

# The comprehensive text, RESOLVED ONTO NODE IDS. The hand-written entries key
# a method by its class (`arc.Grid.insert`) where the node id does not need to
# (`arc.insert`, since arcPerimeter has only one `insert`). Matching on the
# module and the last segment closes that gap - about 250 functions - without
# either side having to give up its own convention.
_BY_LEAF = {}
for _k, _v in longdesc.LONG.items():
    if _k.startswith("@"):
        continue
    _m = _k.split(".", 1)[0]
    _BY_LEAF.setdefault((_m, _k.split(".")[-1]), _v)

# Last resort: the text of the Code Map ROW that covers this function. A row
# can cover four related helpers with one explanation between them, and showing
# that explanation is better than showing its one-line summary.
_BY_ROW = descriptions.long_by_name()

_LONG_NODE = {}
for _n in graph.nodes():
    _leaf = _n.split(".")[-1]
    _hit = (longdesc.LONG.get(_n)
            or _BY_LEAF.get((_n.split(".", 1)[0], _leaf))
            or _BY_ROW.get(graph.label(_n))
            or _BY_ROW.get(_leaf))
    if _hit:
        _LONG_NODE[_n] = _hit
LONGJ = json.dumps(_LONG_NODE)
_GAP = [n for n in graph.nodes() if n not in _LONG_NODE]
print("comprehensive text on %d of %d nodes%s"
      % (len(_LONG_NODE), len(graph.nodes()),
         "" if not _GAP else " - %d fall back to the Code Map line: %s"
         % (len(_GAP), ", ".join(_GAP[:6]))))

# The file picker, in the order the graph draws the bands: what the editor
# calls first, down to the vector helpers nothing else depends on.
_ORDER = []
for _li in sorted(rg.R["layers"]):
    for _row in rg.R["rows_of"][_li]:
        _ORDER.extend(_row)
FILEOPTS = "\n".join(
    '    <option value="%s">%s</option>' % (m, graph.MODNAME[m]) for m in _ORDER)

PAGE = u"""<title>The bound.less Call Graph</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
:root{
  --paper:#f2f4f6; --surface:#ffffff; --surface-2:#e9edf1;
  --ink:#191d22; --muted:#616a75; --rule:#d5dae0; --rule-strong:#b3bcc6;
  --object:#c8603f; --space:#3d6b8c; --warn:#8a6d12; --code-bg:#eef1f4;
  --k-fac:#191d22; --k-spc:#3d6b8c; --k-obj:#c8603f; --k-hlp:#7f8892;
  --k-sca:#3f7a63; --k-shl:#6c5a92; --k-ui:#8a6d12; --k-ded:#a9b2bb;
  --entry:#b3452f; --entry-ink:#ffffff; --testonly:#aab2bb; --dead:#b3452f;
  --edge:#c6ccd4; --edge-on:#c8603f; --edge-up:#3d6b8c; --grid:#e6eaee;
  --block:#e3e8ed; --block-line:#cdd4db;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --paper:#13161a; --surface:#1b1f24; --surface-2:#232830;
  --ink:#e6e9ec; --muted:#98a1ab; --rule:#2b3138; --rule-strong:#3c444d;
  --object:#e07a56; --space:#74a8cc; --warn:#cfae4e; --code-bg:#232830;
  --k-fac:#aeb6bf; --k-spc:#74a8cc; --k-obj:#e07a56; --k-hlp:#6e7781;
  --k-sca:#6fae90; --k-shl:#a292c4; --k-ui:#cfae4e; --k-ded:#4e565f;
  --entry:#e8724f; --entry-ink:#14171b; --testonly:#565e67; --dead:#e8724f;
  --edge:#333c45; --edge-on:#e07a56; --edge-up:#74a8cc; --grid:#1d2229;
  --block:#1f242b; --block-line:#2d343c;
}}
:root[data-theme="dark"]{
  --paper:#13161a; --surface:#1b1f24; --surface-2:#232830;
  --ink:#e6e9ec; --muted:#98a1ab; --rule:#2b3138; --rule-strong:#3c444d;
  --object:#e07a56; --space:#74a8cc; --warn:#cfae4e; --code-bg:#232830;
  --k-fac:#aeb6bf; --k-spc:#74a8cc; --k-obj:#e07a56; --k-hlp:#6e7781;
  --k-sca:#6fae90; --k-shl:#a292c4; --k-ui:#cfae4e; --k-ded:#4e565f;
  --entry:#e8724f; --entry-ink:#14171b; --testonly:#565e67; --dead:#e8724f;
  --edge:#333c45; --edge-on:#e07a56; --edge-up:#74a8cc; --grid:#1d2229;
  --block:#1f242b; --block-line:#2d343c;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);margin:0;
  font-family:"Source Serif 4",Georgia,serif;font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:0 20px 90px}
.mast{border-bottom:1px solid var(--rule-strong);padding:48px 0 18px;margin-bottom:22px}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);margin:0 0 14px}
h1{font-family:"IBM Plex Sans Condensed",Arial Narrow,sans-serif;font-weight:700;
  font-size:clamp(2.2rem,5vw,3.4rem);line-height:1;letter-spacing:-.015em;margin:0 0 12px}
h1 .thin{font-weight:500;color:var(--muted)}
.standfirst{font-size:1.08rem;max-width:66ch;margin:0 0 16px}
.meta{display:flex;flex-wrap:wrap;gap:6px 24px;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:11.5px;color:var(--muted)}
.meta b{color:var(--ink);font-weight:500}
.meta a{color:var(--object)}

.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;
  padding:10px 0 12px;border-bottom:1px solid var(--rule);margin-bottom:14px}
.bar .lbl{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--muted);margin-right:2px}
.bar button{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
  padding:4px 9px;border:1px solid var(--rule-strong);border-radius:3px;
  background:var(--surface);color:var(--ink);cursor:pointer}
.bar button:hover{border-color:var(--object);color:var(--object)}
.bar button.reset{border-style:dashed}
.bar input,.bar select{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
  padding:4px 8px;border:1px solid var(--rule-strong);border-radius:3px;
  background:var(--surface);color:var(--ink);min-width:170px}
.bar select{min-width:150px;cursor:pointer}
.bar .sp{flex:1 1 auto}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:10.5px;color:var(--muted)}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:9px;height:9px;border-radius:2px;display:block}
.legend .sep{width:1px;height:12px;background:var(--rule-strong);padding:0}
.legend i.sw-entry{background:var(--entry)}
.legend i.sw-test{background:none;border:1px solid var(--testonly)}
.bar .chk{display:flex;align-items:center;gap:5px;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:11px;color:var(--ink-soft);cursor:pointer;white-space:nowrap}
.bar .chk input{margin:0;cursor:pointer}
.legend i.sw-dead{background:none;border:1px dashed var(--dead);position:relative}
.legend i.sw-dead::after{content:"";position:absolute;left:0;right:0;top:50%;
  height:1px;background:var(--dead)}

.frame{border:1px solid var(--rule-strong);background:var(--surface);
  overflow:hidden;position:relative;height:min(82vh,900px);touch-action:none}
.frame.grabbing{cursor:grabbing}
.zoombar{position:absolute;right:10px;bottom:10px;display:flex;gap:5px;z-index:3}
.zoombar button{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
  min-width:28px;height:26px;padding:0 7px;border:1px solid var(--rule-strong);border-radius:3px;
  background:var(--surface);color:var(--ink);cursor:pointer;line-height:1}
.zoombar button:hover{border-color:var(--object);color:var(--object)}
.hint{position:absolute;left:10px;bottom:10px;z-index:3;pointer-events:none;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;color:var(--muted);
  background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 7px;opacity:.9}
/* The graph is WIDER THAN THE PAGE on purpose and scrolls inside .frame.
   A host reset of `svg{max-width:100%}` would shrink it to fit and make it
   unreadable, so the width is pinned here where nothing upstream can win. */
/* The SVG fills the frame and is panned and zoomed by its own viewBox, NOT by
   a transform on a promoted layer. See the header of _patch_viewbox.py: a
   promoted layer is rasterised at the current zoom, and at 2x on a 4,179px
   drawing that is a texture the compositor will not allocate, so it silently
   drops tiles and whole file blocks render empty. Driving the viewBox makes
   the rasteriser render only what is visible, at the resolution it is being
   shown at. Do not add `will-change` here. */
#cg{display:block;width:100%;height:100%;max-width:none;cursor:grab;
  background:var(--surface)}

.cg-e{fill:none;stroke:var(--edge);stroke-width:1}
/* A call inside one file is context; a call that leaves it is structure. */
.cg-e.cg-in{opacity:.30}
.cg-e.cg-out{opacity:.62}
.cg-b rect{fill:var(--block);stroke:var(--block-line);stroke-width:1}
/* File names counter-scale, so they are readable at every zoom - at "fit" they
   are the only text on the page and they are the point of that view. */
.cg-bt{font-family:"IBM Plex Sans Condensed",Arial Narrow,sans-serif;
  font-size:calc(11.5px * min(var(--ts, 1), var(--tmax, 9)));
  font-weight:600;letter-spacing:.01em;fill:currentColor;pointer-events:none}
.cg-bn{font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:calc(9.5px * min(var(--ts, 1), var(--tmax, 9)));
  fill:var(--muted);font-weight:400}
.cg-n rect{fill:var(--surface);stroke:currentColor;stroke-width:1.1}
.cg-n text{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;
  fill:var(--ink);text-anchor:middle;pointer-events:none}
.cg-n{cursor:pointer;color:var(--k-hlp)}
.cg-fac{color:var(--k-fac)} .cg-spc{color:var(--k-spc)}
.cg-obj{color:var(--k-obj)} .cg-hlp{color:var(--k-hlp)}
.cg-sca{color:var(--k-sca)} .cg-shl{color:var(--k-shl)}
.cg-ui{color:var(--k-ui)}   .cg-ded{color:var(--k-ded)}
.cg-ded rect{stroke-dasharray:2.5 2}
/* The not-running blocks lay out AFTER every live one, so hiding them removes a
   contiguous tail and leaves no holes. Fit reads getBBox(), which ignores
   display:none, so the view refits to the live graph on its own. */
#cg.hideded .cg-b.cg-ded,
#cg.hideded .cg-e.cg-ded-edge{display:none}
/* No call line. NOT the same as dead - see the note under the graph - so this
   is a quiet dot, not a warning. */
.cg-iso rect{stroke-dasharray:1.5 2.5}

/* ENTRY POINTS: where the outside world comes in. Filled rather than outlined,
   because these are the twelve or so places a reader should start and they have
   to be findable at a glance in a field of eleven hundred boxes. */
.cg-entry rect{fill:var(--entry);stroke:var(--entry);stroke-dasharray:none;
  stroke-width:1.4}
.cg-entry text{fill:var(--entry-ink);font-weight:600}

/* TEST-ONLY: present, correct, and not part of the running app. Greyed rather
   than hidden - a suite depending on it is a real constraint on changing it. */
.cg-testonly rect{fill:none;stroke:var(--testonly);stroke-width:.9}
.cg-testonly text{fill:var(--testonly)}

/* THE THREE NOTHING REFERENCES. Struck through. */
.cg-dead rect{stroke:var(--dead);stroke-dasharray:2 2}
.cg-dead text{fill:var(--dead);opacity:.75}
.cg-strike{stroke:var(--dead);stroke-width:1.3;pointer-events:none}
#cg.coarse .cg-strike{stroke-width:2.2}
.cg-n:focus{outline:none}
.cg-n:focus rect{stroke-width:2.4}

/* focus mode */
#cg.focused .cg-e{stroke:var(--edge);opacity:.07}
#cg.focused .cg-n{opacity:.18}
#cg.focused .cg-b{opacity:.4}
/* file filter: one block at full strength, the rest present but quiet */
#cg.filtered .cg-n,#cg.filtered .cg-b{opacity:.13}
#cg.filtered .cg-e{opacity:.05}
#cg.filtered .cg-n.inmod,#cg.filtered .cg-b.inmod{opacity:1}
#cg.filtered .cg-e.inmod{opacity:.75;stroke:var(--edge-up)}
/* search: every match marked, not just the one the panel jumped to */
#cg .cg-n.hit rect{stroke-width:2.6;fill:var(--surface-2)}
#cg .cg-n.hit text{font-weight:600}
/* ZOOMED OUT: a 10px label at k=0.22 is two pixels of grey. Drop the function
   labels and the overview becomes a file-level map, which is legible and is
   the thing that view is actually for. The boxes stay - they carry the shape
   and the density of each file. */
#cg.coarse .cg-n text{display:none}
/* the entries stay legible zoomed out: they are the reading order */
#cg.coarse .cg-entry text{display:block;font-size:calc(10px * min(var(--ts,1), 2.4))}
#cg.coarse .cg-n rect{stroke-width:.8}
#cg.coarse .cg-e.cg-in{opacity:.16}
#cg.focused .cg-n.up,#cg.focused .cg-n.dn,#cg.focused .cg-n.on{opacity:1}
#cg.focused .cg-e.lit-dn{stroke:var(--edge-on);opacity:1;stroke-width:1.5}
#cg.focused .cg-e.lit-up{stroke:var(--edge-up);opacity:1;stroke-width:1.5}
#cg .cg-n.on rect{stroke-width:2.6;fill:var(--surface-2)}
#cg .cg-n.on text{font-weight:600}

.panel{display:grid;gap:0;border:1px solid var(--rule-strong);border-top:none}
.panel-head{grid-template-columns:minmax(200px,260px) minmax(0,1fr)}
.panel-lists{grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.panel-head #p-desc{color:var(--ink);font-size:14.5px;max-height:190px;overflow:auto}
.panel-head #p-desc p{margin:0 0 7px}
.panel-head #p-desc p:last-child{margin-bottom:0}
ul.bul{margin:0;padding-left:17px;list-style:none}
ul.bul li{position:relative;margin:0 0 6px;line-height:1.45}
ul.bul li::before{content:"";position:absolute;left:-12px;top:.62em;
  width:4px;height:4px;border-radius:50%;background:var(--k-hlp)}
ul.bul li:last-child{margin-bottom:0}
.sec{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;letter-spacing:.08em;
  color:var(--space);border:1px solid currentColor;border-radius:2px;padding:1px 4px;margin-left:4px}
.sec:empty{display:none}
.panel > div{padding:11px 14px;border-right:1px solid var(--rule);min-width:0}
.panel > div:last-child{border-right:none}
.panel h4{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--muted);margin:0 0 6px;font-weight:500}
.panel p{margin:0;font-size:13.5px;line-height:1.45;color:var(--muted)}
.panel .who{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px;color:var(--ink)}
.panel .path{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;
  color:var(--muted);margin-top:3px;word-break:break-all}
.panel .why{font-size:12.5px;color:var(--warn);margin-top:7px;line-height:1.4}
.panel .why:empty{display:none}
.panel .mark{font-size:12.5px;margin-top:7px;line-height:1.4;color:var(--object)}
.panel .mark:empty{display:none}
.panel ul{margin:0;padding:0;list-style:none;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:11px;line-height:1.7;max-height:120px;overflow:auto}
.panel ul li a{color:var(--space);text-decoration:none;cursor:pointer}
.panel ul li a:hover{color:var(--object);text-decoration:underline}

.note{max-width:74ch;margin:22px 0 0;font-size:15px}
.note strong{font-weight:600}
table.why{border-collapse:collapse;width:100%;max-width:900px;margin:14px 0 0;font-size:13.5px}
table.why th,table.why td{border-bottom:1px solid var(--rule);padding:7px 12px 7px 0;
  text-align:left;vertical-align:top}
table.why th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;
  letter-spacing:.13em;text-transform:uppercase;color:var(--muted);font-weight:500}
table.why td:first-child{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;
  white-space:nowrap;color:var(--ink)}
table.why .n{font-variant-numeric:tabular-nums;text-align:right;padding-right:22px;width:1%}
table.why tr.hi td{color:var(--object)}
table.why tr.hi td:first-child{font-weight:600}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.87em;background:var(--code-bg);
  padding:.05em .3em;border-radius:2px}
footer{border-top:1px solid var(--rule-strong);margin-top:34px;padding-top:18px;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--muted);line-height:1.7;max-width:80ch}
footer a{color:var(--object)}
:focus-visible{outline:2px solid var(--object);outline-offset:2px}
@media (max-width:760px){ body{font-size:15px} .frame{max-height:62vh}
  /* the fixed first column starves the explanation on a phone */
  .panel-head{grid-template-columns:1fr}
  .panel-head > div{border-right:none;border-bottom:1px solid var(--rule)}
  .panel-head > div:last-child{border-bottom:none}
  .panel-lists > div{border-right:none;border-bottom:1px solid var(--rule)}
  .panel-lists > div:last-child{border-bottom:none}
}
</style>

<div class="wrap">
<header class="mast">
  <p class="eyebrow">Companion to the logical design, the code map and the call map</p>
  <h1>The bound.less<br><span class="thin">Call Graph</span></h1>
  <p class="standfirst">Every function in the codebase, and every call between them.
    <strong>__NODES__ functions</strong> across <strong>__FILES__ files</strong>, joined by
    __EDGES__ calls. Each function is drawn inside the file that defines it, and the files are
    stacked by what calls what &mdash; the editor at the top, the vector arithmetic nothing else
    depends on at the bottom. <strong>Click any function</strong> to light up everything it
    reaches and everything that reaches it, and to read what it does.</p>
  <div class="meta">
    <span>Code at <b>f92c1d1</b>, branch <b>arc-pipeline</b></span>
    <span><b>__CROSS__</b> calls cross a file boundary &middot; <b>__INSIDE__</b> stay inside one</span>
    <span><b>__ENTRIES__</b> entry points &middot; <b>__TESTONLY__</b> test-only &middot; <b>__W_DEAD__</b> unreferenced</span>
    <span>The spine instead: <a href="https://claude.ai/code/artifact/d6ac1f2b-d7b1-4b47-a8f4-d1ca1be5dcba">The Call Map</a></span>
  </div>
</header>

<div class="bar">
  <span class="lbl">Focus an entry</span>
  <button data-focus="eng.pointerDown">pointerDown</button>
  <button data-focus="eng.pointerMove">pointerMove</button>
  <button data-focus="eng.pointerUp">pointerUp</button>
  <button data-focus="eng.zoomFactorAt">zoomFactorAt</button>
  <button data-focus="eng.panBy">panBy</button>
  <button data-focus="eng._bakeTick">_bakeTick</button>
  <input id="q" type="search" placeholder="find a function..." aria-label="Find a function">
  <span class="lbl" id="qn"></span>
  <select id="mod" aria-label="Show one file">
    <option value="">every file</option>
__FILEOPTS__
  </select>
  <label class="chk"><input type="checkbox" id="hide-ded" checked> hide not running</label>
  <button class="reset" id="reset">Clear</button>
  <span class="sp"></span>
  <span class="legend">
    <span><i style="background:var(--k-fac)"></i>facade</span>
    <span><i style="background:var(--k-spc)"></i>space &amp; view</span>
    <span><i style="background:var(--k-obj)"></i>objects &amp; ink</span>
    <span><i style="background:var(--k-hlp)"></i>geometry helpers</span>
    <span><i style="background:var(--k-sca)"></i>scale bar</span>
    <span><i style="background:var(--k-shl)"></i>shell &amp; storage</span>
    <span><i style="background:var(--k-ui)"></i>pages &amp; interface</span>
    <span><i style="background:var(--k-ded)"></i>not running</span>
    <span class="sep"></span>
    <span><i class="sw-entry"></i>entry point</span>
    <span><i class="sw-test"></i>test only</span>
    <span><i class="sw-dead"></i>unreferenced</span>
  </span>
</div>

<div class="frame" id="frame">
__SVG__
  <div class="zoombar">
    <button id="z-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
    <button id="z-in" title="Zoom in" aria-label="Zoom in">+</button>
    <button id="z-fit" title="Fit the whole graph">Fit</button>
    <button id="z-1" title="Actual size">1:1</button>
  </div>
  <div class="hint" id="hint">scroll to zoom &middot; drag to pan</div>
</div>

<div class="panel panel-head">
  <div>
    <h4>Selected</h4>
    <p class="who" id="p-name">nothing selected</p>
    <p id="p-mod"></p>
    <p id="p-file" class="path"></p>
    <p id="p-why" class="why"></p>
    <p id="p-mark" class="mark"></p>
  </div>
  <div>
    <h4>What it does <span class="sec" id="p-sec"></span></h4>
    <p id="p-desc">Click any function in the graph to read what it does.</p>
  </div>
</div>
<div class="panel panel-lists">
  <div><h4>Called by <span id="p-nup"></span></h4><ul id="p-up"></ul></div>
  <div><h4>Calls <span id="p-ndn"></span></h4><ul id="p-dn"></ul></div>
  <div><h4>Reaches</h4><p id="p-reach">&mdash;</p></div>
</div>

<p class="note"><strong>Filled boxes are entry points &mdash; where the outside world comes in.</strong>
There are __ENTRIES__ of them and they are the reading order: __E_POINTER__ reached from a pointer
or wheel event, __E_KEY__ from a key press, __E_UI__ from a control in the interface,
__E_ROUTE__ components React mounts for a route, and __E_LIFE__ the browser itself calls. Every
one was found by reading the source &mdash; a call inside a registered listener, inside a JSX
handler prop, or inside an effect the interface drives &mdash; not by picking the ones that looked
important.</p>

<p class="note"><strong>Grey boxes are test-only, and three boxes are struck through.</strong>
__TESTONLY__ functions have no production caller at all; a suite is the only thing that depends on
them, which is a real constraint on changing them and worth seeing. The struck-through three are
the ones nothing in <code>src/</code> names at all: <code>Document.canRedo</code>,
<code>LevelMap._edge</code> and <code>curvePerimeter.minDist</code> — all
three resolved in the 2026-08-31 cleanup: the first was wired up to grey the
toolbar's Undo and Redo buttons, the other two deleted.</p>

<p class="note"><strong>Faint lines stay inside one file; solid ones leave it.</strong> That is
the distinction worth drawing at this scale. A block whose edges are nearly all faint is
self-contained &mdash; <code>scaleBar/catalog</code>, <code>clipperOutline</code> &mdash; and a
block with a spray of solid lines leaving it is where the coupling lives. <code>KobinEngine</code>
is the obvious one, and it is the reason the first item on the backlog is splitting it up.</p>

<p class="note"><strong>Nothing on this page calls __ISO__ of these functions, and three of
them are genuinely unused.</strong> Not the other __ISOMINUS__. A call is only drawn when it
resolves to a definite target; anything else is dropped rather than guessed at, so no incoming
line means <em>not proven</em>, never <em>not there</em>. <strong>Click a function with a dashed
outline and the panel says which case it is.</strong> The breakdown:</p>

<div class="tw"><table class="why">
  <tr><th>Why there is no line</th><th class="n">Count</th><th>What it actually means</th></tr>
  <tr><td>passed as value</td><td class="n">__W_VAL__</td><td>Exported, passed as a callback, or held somewhere &mdash; named without being called at a site the extractor reads.</td></tr>
  <tr><td>called via an object</td><td class="n">__W_OBJ__</td><td>Reached as <code>thing.method()</code> on a value whose type is not resolvable from the source. <code>EventLatency.report</code> is one: the hook calls <code>eng.eventLatency.report()</code>.</td></tr>
  <tr><td>React component</td><td class="n">__W_REACT__</td><td>React renders it as <code>&lt;Component/&gt;</code>. It is never called by name.</td></tr>
  <tr><td>getter</td><td class="n">__W_GET__</td><td><code>get inScale()</code> and friends are <em>read</em>, not called, so there is no call syntax anywhere to find.</td></tr>
  <tr><td>test only</td><td class="n">__W_TEST__</td><td>Nothing in the running app reaches it; a suite does. <code>clipperOutline.clipPolysToRect</code> is one, and its own file header says so.</td></tr>
  <tr><td>language protocol</td><td class="n">__W_MAGIC__</td><td><code>toJSON</code>. <code>JSON.stringify</code> invokes it by protocol, with the name appearing nowhere.</td></tr>
  <tr class="hi"><td>no reference at all</td><td class="n">__W_DEAD__</td><td>A function that appears exactly once in <code>src/</code>, at its own definition. The 2026-08-31 cleanup cleared the list; anything appearing here is new.</td></tr>
</table></div>

<p class="note">__HAND__ of the edges were also read off the source by hand, and the extractor
independently finds __AGREE__ of those &mdash; which is the check on whether it is reading calls
correctly rather than plausibly.</p>

<p class="note"><strong>Blocks with a dashed outline are not running</strong>, and are hidden
until you ask for them. They are 186 of the functions here &mdash; the retired
<code>KobinEngineV0</code>, the cubic-pipeline <code>curvePerimeter</code>, the polyline
<code>strokeShape</code>, and the rest of <code>src/engine/__oracles__/</code>: independent
implementations the shipping code is <em>checked against</em>, reachable only from test suites,
so webpack has never bundled any of it. They are on this page because they are in the
repository and the promise here is that every function is; they lay out below everything live
so that hiding them costs the rest of the graph nothing. The four dev routes that used to sit
alongside them were deleted on 2026-08-31.</p>

<footer>
  Every function in <code>src/</code> outside the test suites, and every call that can be read
  off the source. __SITED__ of the calls carry a <code>file:line</code> for the call site, so any
  line here can be checked against the code. Laid out offline &mdash; files layered by the calls
  between them, functions ordered inside each file by its own calls &mdash; so the page ships
  static SVG and no layout library.<br><br>
  Companions: <a href="https://claude.ai/code/artifact/e1f6fb30-dc9e-4bc0-ac0e-836e1a528b56">The Logical Design</a> ·
  <a href="https://claude.ai/code/artifact/2d3a3acd-0a89-4e2b-a161-3445bdd19756">The Code Map</a> ·
  <a href="https://claude.ai/code/artifact/d6ac1f2b-d7b1-4b47-a8f4-d1ca1be5dcba">The Call Map</a>
</footer>
</div>

<script>
(function () {
  var ADJ = __ADJ__, MODNAME = __MODNAME__, MODOF = __MODOF__, DESC = __DESC__, LONG = __LONG__;
  var MODFILE = __MODFILE__;
  // Why a function has no call line. Every one of these is a limit of reading
  // calls out of source, not a finding about the code.
  var ENTRYTEXT = {
    "pointer": "ENTRY POINT — a pointer or wheel event on the canvas reaches the engine here.",
    "keyboard": "ENTRY POINT — a key press reaches the engine here.",
    "ui": "ENTRY POINT — a control in the interface reaches the engine here.",
    "route": "ENTRY POINT — React mounts this component for a route.",
    "lifecycle": "ENTRY POINT — the browser calls this: a timer, an observer, or a window event."
  };
  var WHY = {
    "getter/setter": "No line: this is a getter. It is read as a property, so there is no call to find.",
    "language protocol": "No line: the runtime calls this, not the code — JSON.stringify invokes toJSON by protocol.",
    "called via object": "No line: it is called as a method on a value the extractor does not resolve. It IS called.",
    "React component": "No line: React renders it as <Component/>; it is never called by name.",
    "passed as value": "No line: it is passed or exported rather than called here.",
    "test only": "No line in the app: only the test suites reference it.",
    "UNREFERENCED": "Nothing calls it, and the name appears nowhere else in src/ — not even a test. One of three."
  };
  var svg = document.getElementById("cg");
  var frame = document.getElementById("frame");
  if (!svg) return;
  var CW = parseFloat(svg.getAttribute("data-w")) || 1;
  var CH = parseFloat(svg.getAttribute("data-h")) || 1;
  var LIVE_H = parseFloat(svg.getAttribute("data-live-h")) || CH;
  // the height that is actually on screen, which depends on the hide toggle
  function canvasH() { return svg.classList.contains("hideded") ? LIVE_H : CH; }

  // ---- viewport: one transform, no scrollbars -----------------------------
  var view = { k: 1, tx: 0, ty: 0 };
  var K_MIN = 0.08, K_MAX = 6;

  // screen = graph * k + t, exactly as before - only the way it is applied
  // changed. viewBox origin is the graph point at the frame's top-left, and
  // the viewBox size is the frame size in graph units, so the box always has
  // the frame's aspect and preserveAspectRatio never has anything to do.
  var COARSE_AT = 0.5;      // below this a function label is under 5px
  function apply() {
    var w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    svg.setAttribute("viewBox",
      (-view.tx / view.k).toFixed(2) + " " + (-view.ty / view.k).toFixed(2) +
      " " + (w / view.k).toFixed(2) + " " + (h / view.k).toFixed(2));
    // File names hold their size on screen. Capped, or they swallow the block
    // they label once you are zoomed in on one file.
    svg.style.setProperty("--ts", Math.min(3.2, Math.max(0.85, 1 / view.k)).toFixed(3));
    svg.classList.toggle("coarse", view.k < COARSE_AT);
  }
  function size() {
    return { w: frame.clientWidth, h: frame.clientHeight };
  }
  function fit(pad) {
    var s0 = size();
    pad = pad == null ? 18 : pad;
    var H = canvasH();
    var k = Math.min((s0.w - pad * 2) / CW, (s0.h - pad * 2) / H);
    view.k = Math.max(K_MIN, Math.min(K_MAX, k));
    view.tx = (s0.w - CW * view.k) / 2;
    view.ty = (s0.h - H * view.k) / 2;
    apply();
  }
  function zoomAbout(cx, cy, factor) {
    var k2 = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
    if (k2 === view.k) return;
    // hold the point under the cursor still: p = (c - t)/k must not move
    view.tx = cx - (cx - view.tx) * (k2 / view.k);
    view.ty = cy - (cy - view.ty) * (k2 / view.k);
    view.k = k2;
    apply();
  }
  function local(ev) {
    // clientLeft/clientTop are the BORDER widths: the SVG sits in the content
    // box, so without them every zoom is anchored a pixel off.
    var r = frame.getBoundingClientRect();
    return { x: ev.clientX - r.left - frame.clientLeft,
             y: ev.clientY - r.top - frame.clientTop };
  }
  function centreOn(id) {
    var el = nodes[id];
    if (!el) return;
    try {
      var bb = el.getBBox();                       // in graph coordinates
      var s0 = size();
      view.tx = s0.w / 2 - (bb.x + bb.width / 2) * view.k;
      view.ty = s0.h / 2 - (bb.y + bb.height / 2) * view.k;
      apply();
    } catch (e) { /* centring is a convenience, never a requirement */ }
  }

  // wheel / trackpad. ctrlKey is what a trackpad pinch reports.
  frame.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var p = local(ev);
    var d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 16;              // lines -> px
    zoomAbout(p.x, p.y, Math.pow(2, -d / (ev.ctrlKey ? 120 : 320)));
  }, { passive: false });

  // Drag to pan, two-finger pinch, and CLICK TO FOCUS — all through pointer
  // events, deliberately not through `click`.
  //
  // Two things make `click` the wrong signal here. Capturing the pointer makes
  // the browser fire `click` at the CAPTURE TARGET rather than at the element
  // under the cursor, so the node is never found and every click reads as a
  // click on empty space. And a real mouse or trackpad jitters a pixel or two
  // between press and release, so any tight "did it move?" threshold discards
  // genuine clicks as drags.
  //
  // So: remember the node under the pointer when it goes down, and act on it
  // when it comes up if the pointer stayed near where it started. Capture is
  // taken only once a drag has actually begun, so it can never interfere.
  // Generous on purpose. Clicking is the primary interaction here and panning
  // the secondary one, so a press should survive real trackpad jitter — which
  // is several pixels per axis — while any deliberate pan is far larger.
  var DRAG_SLOP = 9;                       // px before a press becomes a drag
  var pts = {}, pinch = null, moved = false;
  var downNode = null, downX = 0, downY = 0, captured = false;
  frame.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 1) {
      moved = false; captured = false;
      downX = ev.clientX; downY = ev.clientY;
      downNode = ev.target && ev.target.closest ? ev.target.closest(".cg-n") : null;
    }
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      downNode = null;                     // a two-finger gesture is never a click
      moved = true;
    }
    frame.classList.add("grabbing");
  });
  frame.addEventListener("pointermove", function (ev) {
    if (!pts[ev.pointerId]) return;
    var prev = pts[ev.pointerId];
    pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 2 && pinch) {
      var a = pts[ids[0]], b = pts[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0) {
        var r = frame.getBoundingClientRect();
        var mx = (a.x + b.x) / 2 - r.left - frame.clientLeft;
        var my = (a.y + b.y) / 2 - r.top - frame.clientTop;
        zoomAbout(mx, my, (d / pinch.d) * (pinch.k / view.k));
        pinch.d = d; pinch.k = view.k;
      }
      moved = true;
      return;
    }
    if (ids.length !== 1) return;
    var dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
    if (!moved) {
      // Still inside the slop: not a drag yet, so do not pan and do not lose
      // the click. Panning starts from HERE once it does, so there is no jump.
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) <= DRAG_SLOP) return;
      moved = true;
      try { frame.setPointerCapture(ev.pointerId); captured = true; } catch (e) {}
    }
    view.tx += dx; view.ty += dy;
    apply();
  });
  function endPointer(ev) {
    var wasLast = Object.keys(pts).length === 1 && pts[ev.pointerId];
    if (captured) {
      try { frame.releasePointerCapture(ev.pointerId); } catch (e) {}
      captured = false;
    }
    // A press that never became a drag is a click, and this is where it is
    // acted on — on the node recorded when the pointer went down.
    if (wasLast && !moved) {
      if (downNode) focus(downNode.getAttribute("data-id"), false);
      else clear();
    }
    delete pts[ev.pointerId];
    if (Object.keys(pts).length < 2) pinch = null;
    if (!Object.keys(pts).length) { frame.classList.remove("grabbing"); downNode = null; }
  }
  frame.addEventListener("pointerup", endPointer);
  frame.addEventListener("pointercancel", endPointer);

  document.getElementById("z-in").addEventListener("click", function () {
    var s0 = size(); zoomAbout(s0.w / 2, s0.h / 2, 1.35);
  });
  document.getElementById("z-out").addEventListener("click", function () {
    var s0 = size(); zoomAbout(s0.w / 2, s0.h / 2, 1 / 1.35);
  });
  document.getElementById("z-fit").addEventListener("click", function () { fit(); });
  document.getElementById("z-1").addEventListener("click", function () {
    var s0 = size();
    zoomAbout(s0.w / 2, s0.h / 2, 1 / view.k);
  });
  window.addEventListener("resize", function () { fit(); });
  var nodes = {}, i;
  var els = svg.querySelectorAll(".cg-n");
  for (i = 0; i < els.length; i++) nodes[els[i].getAttribute("data-id")] = els[i];
  var edges = svg.querySelectorAll(".cg-e");

  function walk(id, dir) {
    var seen = {}, stack = [id];
    while (stack.length) {
      var u = stack.pop();
      var next = (ADJ[dir][u] || []);
      for (var k = 0; k < next.length; k++) {
        var v = next[k];
        if (!seen[v]) { seen[v] = 1; stack.push(v); }
      }
    }
    delete seen[id];
    return seen;
  }

  function clear() {
    svg.classList.remove("focused");
    for (var id in nodes) nodes[id].classList.remove("on", "up", "dn");
    for (var j = 0; j < edges.length; j++) edges[j].classList.remove("lit-up", "lit-dn");
    set("p-name", "nothing selected"); set("p-mod", ""); set("p-file", "");
    set("p-why", ""); set("p-mark", "");
    var box0 = document.getElementById("p-desc");
    box0.innerHTML = "";
    box0.appendChild(document.createTextNode(
      "Click any function in the graph to read what it does."));
    set("p-sec", "");
    document.getElementById("p-up").innerHTML = "";
    document.getElementById("p-dn").innerHTML = "";
    set("p-nup", ""); set("p-ndn", ""); set("p-reach", "—");
  }
  function set(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }

  // Emphasis is written as **...** in the source text and turned into <strong>
  // here, so the data stays plain strings and nothing has to be trusted as HTML.
  function emph(s, into) {
    var parts = String(s).split("**");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var n = document.createTextNode(parts[i]);
      if (i % 2 === 1) { var b = document.createElement("strong"); b.appendChild(n); n = b; }
      into.appendChild(n);
    }
  }
  function writeLong(id, info) {
    var box = document.getElementById("p-desc");
    box.innerHTML = "";
    var body = LONG[id];
    if (!body || !body.length) {
      box.appendChild(document.createTextNode(info ? info.d : "No description."));
      return;
    }
    if (body.length === 1) {
      var p = document.createElement("p");
      emph(body[0], p);
      box.appendChild(p);
      return;
    }
    var lead = document.createElement("p");
    emph(body[0], lead);
    box.appendChild(lead);
    var ul = document.createElement("ul");
    ul.className = "bul";
    for (var i = 1; i < body.length; i++) {
      var li = document.createElement("li");
      emph(body[i], li);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  function listInto(id, arr) {
    var ul = document.getElementById(id);
    ul.innerHTML = "";
    arr.sort();
    for (var k = 0; k < arr.length; k++) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.textContent = arr[k];
      a.setAttribute("data-goto", arr[k]);
      a.setAttribute("tabindex", "0");
      li.appendChild(a); ul.appendChild(li);
    }
  }

  function focus(id, scroll) {
    if (!nodes[id]) return;
    clear();
    var up = walk(id, "up"), dn = walk(id, "dn");
    svg.classList.add("focused");
    nodes[id].classList.add("on");
    var k;
    for (k in up) if (nodes[k]) nodes[k].classList.add("up");
    for (k in dn) if (nodes[k]) nodes[k].classList.add("dn");
    for (var j = 0; j < edges.length; j++) {
      var a = edges[j].getAttribute("data-a"), b = edges[j].getAttribute("data-b");
      var inDn = (a === id || dn[a]) && dn[b];
      var inUp = up[a] && (b === id || up[b]);
      if (inDn) edges[j].classList.add("lit-dn");
      else if (inUp) edges[j].classList.add("lit-up");
    }
    var mod = MODOF[id] || "";
    set("p-name", id);
    set("p-mod", MODNAME[mod] || "");
    set("p-file", MODFILE[mod] || "");
    var g = nodes[id].getAttribute("data-why");
    set("p-why", g ? (WHY[g] || g) : "");
    var el = nodes[id], mk = "";
    if (el.classList.contains("cg-dead")) {
      mk = "UNREFERENCED — nothing in src/ names this, tests included.";
    } else if (el.classList.contains("cg-testonly")) {
      mk = "TEST ONLY — no production caller; a suite depends on it.";
    } else if (el.getAttribute("data-entry")) {
      mk = ENTRYTEXT[el.getAttribute("data-entry")] || "";
    }
    set("p-mark", mk);
    var info = DESC[id];
    set("p-sec", info && info.s ? info.s : "");
    writeLong(id, info);
    listInto("p-up", (ADJ.up[id] || []).slice());
    listInto("p-dn", (ADJ.dn[id] || []).slice());
    set("p-nup", "(" + (ADJ.up[id] || []).length + ")");
    set("p-ndn", "(" + (ADJ.dn[id] || []).length + ")");
    var nu = 0, nd = 0;
    for (k in up) nu++;
    for (k in dn) nd++;
    set("p-reach", nd + " downstream, " + nu + " upstream");
    if (scroll !== false) centreOn(id);
  }

  svg.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var g = ev.target.closest ? ev.target.closest(".cg-n") : null;
    if (g) { ev.preventDefault(); focus(g.getAttribute("data-id"), false); }
  });
  document.addEventListener("click", function (ev) {
    var b = ev.target.getAttribute && ev.target.getAttribute("data-focus");
    if (b) focus(b);
    var g = ev.target.getAttribute && ev.target.getAttribute("data-goto");
    if (g) focus(g);
  });
  document.getElementById("reset").addEventListener("click", function () {
    clear();
    document.getElementById("q").value = "";
    document.getElementById("mod").value = "";
    for (var id in nodes) nodes[id].classList.remove("hit");
    set("qn", "");
    applyFilter();
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") clear(); });

  var q = document.getElementById("q");
  fit();
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { fit(); });
  }
  setTimeout(function () { var h = document.getElementById("hint"); if (h) h.style.opacity = "0"; }, 6000);

  // SEARCH marks every match, not just the one the panel jumps to. With 1,103
  // functions, "which ones are called bake-something" is the more useful
  // question, and answering it with a single jump would hide the answer.
  function clearHits() {
    for (var id in nodes) nodes[id].classList.remove("hit");
    set("qn", "");
  }
  q.addEventListener("input", function () {
    var t = q.value.trim().toLowerCase();
    clearHits();
    if (!t) { clear(); return; }
    var hits = [], id;
    for (id in nodes) if (id.toLowerCase().indexOf(t) >= 0) hits.push(id);
    hits.sort();
    for (var i = 0; i < hits.length; i++) nodes[hits[i]].classList.add("hit");
    set("qn", hits.length ? hits.length + " match" + (hits.length > 1 ? "es" : "") : "no match");
    if (hits.length) { focus(hits[0]); for (var j = 0; j < hits.length; j++) nodes[hits[j]].classList.add("hit"); }
  });

  // FILE FILTER. Everything stays drawn - a block with nothing around it tells
  // you nothing about how it is wired - but only the chosen file, and the calls
  // with an end in it, stay at full strength.
  var sel = document.getElementById("mod");
  function applyFilter() {
    var m = sel.value;
    var id, j;
    for (id in nodes) nodes[id].classList.remove("inmod");
    var blocks = svg.querySelectorAll(".cg-b");
    for (j = 0; j < blocks.length; j++) blocks[j].classList.remove("inmod");
    for (j = 0; j < edges.length; j++) edges[j].classList.remove("inmod");
    if (!m) { svg.classList.remove("filtered"); return; }
    svg.classList.add("filtered");
    for (id in nodes) if (MODOF[id] === m) nodes[id].classList.add("inmod");
    for (j = 0; j < blocks.length; j++) {
      if (blocks[j].getAttribute("data-mod") === m) blocks[j].classList.add("inmod");
    }
    for (j = 0; j < edges.length; j++) {
      var a = edges[j].getAttribute("data-a"), b = edges[j].getAttribute("data-b");
      if (MODOF[a] === m || MODOF[b] === m) edges[j].classList.add("inmod");
    }
  }
  sel.addEventListener("change", applyFilter);

  // HIDE NOT RUNNING. On by default: 186 of the 1,087 functions are oracles and
  // test fixtures, 27% of the drawing area, and a reader opening this page wants
  // to see the app. Everything stays IN the page - the panel, the search and the
  // file filter still reach it - so nothing is hidden from a question that was
  // actually asked, only from the overview.
  var hideBox = document.getElementById("hide-ded");
  var DEDMODS = __DEDMODS__;
  function isDed(id) { return DEDMODS.indexOf(MODOF[id]) !== -1; }
  for (var e = 0; e < edges.length; e++) {
    var ea = edges[e].getAttribute("data-a"), eb = edges[e].getAttribute("data-b");
    if (isDed(ea) || isDed(eb)) edges[e].classList.add("cg-ded-edge");
  }
  function applyHide() {
    svg.classList.toggle("hideded", hideBox.checked);
    fit();
  }
  hideBox.addEventListener("change", applyHide);
  applyHide();
})();
</script>
"""

def build():
    p = PAGE
    p = p.replace("__SVG__", SVG)
    p = p.replace("__ADJ__", ADJ)
    p = p.replace("__MODNAME__", MODNAME)
    p = p.replace("__MODOF__", MODOF)
    p = p.replace("__DESC__", DESCJ)
    p = p.replace("__LONG__", LONGJ)
    p = p.replace("__MODFILE__", MODFILE)
    p = p.replace("__FILEOPTS__", FILEOPTS)
    p = p.replace("__DEDMODS__", json.dumps(sorted(
        m for m, g in graph.MOD.items() if g == "ded")))
    p = p.replace("__NODES__", "{:,}".format(S["nodes"]))
    p = p.replace("__EDGES__", "{:,}".format(S["edges"]))
    p = p.replace("__FILES__", str(S["files"]))
    p = p.replace("__CROSS__", str(S["cross"]))
    p = p.replace("__INSIDE__", "{:,}".format(S["inside"]))
    p = p.replace("__ISOMINUS__", str(S["uncalled"] - S["unreferenced"]))
    p = p.replace("__ISO__", str(S["uncalled"]))
    _w = S["why"]
    for _k, _tok in (("passed as value", "VAL"), ("called via object", "OBJ"),
                     ("React component", "REACT"), ("getter/setter", "GET"),
                     ("test only", "TEST"), ("language protocol", "MAGIC"),
                     ("UNREFERENCED", "DEAD")):
        p = p.replace("__W_" + _tok + "__", str(_w.get(_k, 0)))
    p = p.replace("__ENTRIES__", str(S["entries"]))
    p = p.replace("__TESTONLY__", str(S["testonly"]))
    _e = S["entrykinds"]
    for _k, _tok in (("pointer", "POINTER"), ("keyboard", "KEY"), ("ui", "UI"),
                     ("route", "ROUTE"), ("lifecycle", "LIFE")):
        p = p.replace("__E_" + _tok + "__", str(_e.get(_k, 0)))
    p = p.replace("__HAND__", str(S["hand"]))
    p = p.replace("__AGREE__", str(S["agree"]))
    p = p.replace("__SITED__", "{:,}".format(S["sited"]))
    assert "__" + "SVG__" not in p
    return p

if __name__ == "__main__":
    out = build()
    io.open(os.path.join(HERE, "pages", "boundless-call-graph.html"), "w", encoding="utf-8", newline="\n").write(out)
    print("wrote boundless-call-graph.html (%d chars)" % len(out))
