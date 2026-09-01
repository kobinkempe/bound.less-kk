# -*- coding: utf-8 -*-
import io, gen, trees

HEAD = u"""<title>The bound.less Call Map</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">

<style>
:root{
  --paper:#f2f4f6; --surface:#ffffff; --surface-2:#e9edf1;
  --ink:#191d22; --muted:#616a75; --rule:#d5dae0; --rule-strong:#b3bcc6;
  --object:#c8603f; --space:#3d6b8c; --warn:#8a6d12; --code-bg:#eef1f4;
  --k-fac:#191d22; --k-spc:#3d6b8c; --k-obj:#c8603f; --k-hlp:#9aa4ae;
  --k-line:#c3cad2;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#13161a; --surface:#1b1f24; --surface-2:#232830;
    --ink:#e6e9ec; --muted:#98a1ab; --rule:#2b3138; --rule-strong:#3c444d;
    --object:#e07a56; --space:#74a8cc; --warn:#cfae4e; --code-bg:#232830;
    --k-fac:#e6e9ec; --k-spc:#74a8cc; --k-obj:#e07a56; --k-hlp:#6c7681;
    --k-line:#39424b;
  }
}
:root[data-theme="dark"]{
  --paper:#13161a; --surface:#1b1f24; --surface-2:#232830;
  --ink:#e6e9ec; --muted:#98a1ab; --rule:#2b3138; --rule-strong:#3c444d;
  --object:#e07a56; --space:#74a8cc; --warn:#cfae4e; --code-bg:#232830;
  --k-fac:#e6e9ec; --k-spc:#74a8cc; --k-obj:#e07a56; --k-hlp:#6c7681;
  --k-line:#39424b;
}

*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);margin:0;
  font-family:"Source Serif 4",Georgia,serif;font-size:16px;line-height:1.55;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px 110px}

.mast{border-bottom:1px solid var(--rule-strong);padding:52px 0 20px;margin-bottom:36px}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);margin:0 0 16px}
h1{font-family:"IBM Plex Sans Condensed",Arial Narrow,sans-serif;font-weight:700;
  font-size:clamp(2.4rem,5.4vw,3.7rem);line-height:1;letter-spacing:-.015em;margin:0 0 14px;text-wrap:balance}
h1 .thin{font-weight:500;color:var(--muted)}
.standfirst{font-size:1.1rem;max-width:64ch;margin:0 0 20px}
.mast-meta{display:flex;flex-wrap:wrap;gap:8px 26px;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:11.5px;color:var(--muted)}
.mast-meta b{color:var(--ink);font-weight:500}
.mast-meta a{color:var(--object)}

.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));
  border:1px solid var(--rule-strong);margin:24px 0 0}
.legend div{padding:12px 15px;border-right:1px solid var(--rule)}
.legend div:last-child{border-right:none}
.legend b{display:flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;margin-bottom:6px;font-weight:500;color:var(--ink)}
.legend i{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.legend p{font-size:13.5px;line-height:1.42;margin:0;color:var(--muted)}

.cols{display:grid;grid-template-columns:200px minmax(0,1fr);gap:48px;align-items:start}
nav.toc{position:sticky;top:20px;font-family:"IBM Plex Sans Condensed",Arial Narrow,sans-serif}
nav.toc h4{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);margin:0 0 7px}
nav.toc ol{list-style:none;margin:0;padding:0;counter-reset:t}
nav.toc li{counter-increment:t;margin:0 0 2px}
nav.toc a{display:flex;gap:9px;text-decoration:none;color:var(--muted);font-size:13.5px;line-height:1.35;padding:3px 0}
nav.toc a::before{content:"Fig " counter(t);font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:9.5px;color:var(--rule-strong);padding-top:3px;flex:0 0 auto;white-space:nowrap}
nav.toc a:hover,nav.toc a:focus-visible{color:var(--object)}
.toc-note{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;color:var(--muted);
  margin-top:18px;padding-top:12px;border-top:1px solid var(--rule);line-height:1.6}

main{min-width:0}
section{margin:0 0 52px;scroll-margin-top:16px}
section > p{max-width:70ch;margin:0 0 14px}
h2{font-family:"IBM Plex Sans Condensed",Arial Narrow,sans-serif;font-weight:700;font-size:1.5rem;
  letter-spacing:-.01em;margin:0 0 4px;display:flex;align-items:baseline;gap:12px;text-wrap:balance}
h2 .num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.66rem;font-weight:500;
  color:var(--object);letter-spacing:.09em;flex:0 0 auto}
.sub{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--muted);margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid var(--rule)}
.figbox{overflow-x:auto;margin:0 0 6px}
svg{display:block;max-width:100%;height:auto}
.cm-n{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;fill:var(--ink)}
.cm-c{font-family:"Source Serif 4",Georgia,serif;font-size:12.5px;fill:var(--muted)}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.87em;background:var(--code-bg);
  padding:.05em .3em;border-radius:2px}
strong{font-weight:600}
.callout{border-left:2px solid var(--object);background:var(--surface);padding:13px 17px;margin:0 0 20px;max-width:70ch}
.callout.space{border-left-color:var(--space)}
.callout p:last-child{margin-bottom:0}
.callout .lbl{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--object);display:block;margin-bottom:5px}
.callout.space .lbl{color:var(--space)}
footer{border-top:1px solid var(--rule-strong);margin-top:44px;padding-top:20px;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--muted);line-height:1.7;max-width:78ch}
footer a{color:var(--object)}
:focus-visible{outline:2px solid var(--object);outline-offset:2px}
@media (max-width:900px){
  .cols{grid-template-columns:1fr;gap:0}
  nav.toc{position:static;margin-bottom:32px;border-bottom:1px solid var(--rule);padding-bottom:16px}
  body{font-size:15px}
}
</style>
"""

INTROS = {
    "pen": u"""<p>Three entry points, one gesture. The thing worth noticing is that
        <strong>the pen builds its arc chain while you draw</strong> — <code>addSample</code> rebuilds only
        the two gaps a new sample disturbs — so what is on screen under the pen is already the
        geometry the resolve will use, and pen-up does not change the shape.</p>""",
    "bake": u"""<p>Nothing here runs on a frame. It is a timer that re-enters until its queues
        drain, standing aside while the camera moves. <strong>Outlines resolve before erasers are
        folded in</strong>, because an eraser cannot be subtracted until it has one — and neither can
        the ink beneath it.</p>""",
    "erase": u"""<p>One decision at the top governs everything below it: is the target at or below
        the level the erase was made at, or above it? At or below, the cut happens here. Above, the
        work descends instead (Fig 4).</p>""",
    "descent": u"""<p>The loop body runs once per level crossed. Every step hands ink down;
        <strong>only the last one cuts</strong>. Skipping the chain and jumping straight to the erase
        level makes the ceded tile exactly zero units wide at five crossings — a silent failure.</p>""",
    "render": u"""<p>The widest tree here, and the one with a cycle in it: <code>_bakeUp</code> calls
        itself on the parent, one level at a time. <strong>A composed long jump upward cancels
        catastrophically</strong>, which is why the chain exists at all.</p>""",
    "camera": u"""<p>Every camera gesture funnels into <code>_settle</code>, which crosses and shifts
        until the camera is in a legal state. The five <code>needs*</code> questions afterwards decide
        the only thing that matters for cost: <strong>full render, or one transform.</strong></p>""",
    "select": u"""<p>The two halves of a drag are split by depth. A member coarser than the camera
        translates normally; a member <em>deeper</em> than the camera has its <strong>address</strong>
        changed instead and its geometry never touched.</p>""",
}

def build():
    parts = [HEAD]
    parts.append(u'<div class="wrap">')
    parts.append(u"""
<header class="mast">
  <p class="eyebrow">Companion to the logical design and the code map</p>
  <h1>The bound.less<br><span class="thin">Call Map</span></h1>
  <p class="standfirst">Seven call trees, from the public entry points down to the pure
    helpers. Each one is a path the code actually takes, traced from the source rather
    than from the design.</p>
  <div class="mast-meta">
    <span>Code at <b>f92c1d1</b>, branch <b>arc-pipeline</b></span>
    <span>Traced <b>2026-08-27</b></span>
    <span><b>259</b> calls across <b>7</b> flows</span>
  </div>
  <div class="legend">
    <div><b><i style="background:var(--k-fac)"></i>The facade</b><p>KobinEngine. Routes input,
      owns the queues, holds no geometry.</p></div>
    <div><b><i style="background:var(--k-spc)"></i>Space and the view</b><p>Camera, LevelMap,
      TileStore, Renderer. Where things are, and what you see.</p></div>
    <div><b><i style="background:var(--k-obj)"></i>The object</b><p>Document, and the ink
      geometry: arcShape, arcPerimeter, biarc, freeze.</p></div>
    <div><b><i style="background:var(--k-hlp)"></i>Shared helpers</b><p>Pure functions with no
      state: derive, frameLattice, connect, lasso, clipperOutline.</p></div>
  </div>
</header>
<div class="cols">
<nav class="toc" aria-label="Contents">
  <h4>The flows</h4>
  <ol>""")
    for key, title, spec in trees.TREES:
        parts.append(u'    <li><a href="#%s">%s</a></li>' % (key, title))
    parts.append(u"""  </ol>
  <p class="toc-note">Indentation is calling depth.<br><br>
  A row is a call made by the row above it at one less indent.<br><br>
  Notes on the right say why, not what — the Code Map has what.</p>
</nav>
<main>""")

    for i, (key, title, spec) in enumerate(trees.TREES, 1):
        svg, h, rows = gen.render(spec, title)
        parts.append(u'<section id="%s">' % key)
        parts.append(u'<h2><span class="num">FIG %d</span> %s</h2>' % (i, title))
        parts.append(u'<p class="sub">%d calls &middot; %d levels deep</p>'
                     % (len(rows), max(d for d, n, k, c in rows) + 1))
        parts.append(INTROS.get(key, u""))
        parts.append(u'<div class="figbox">%s</div>' % svg)
        parts.append(u'</section>')

    parts.append(u"""
<footer>
  Traced by reading the source at f92c1d1 — call sites verified, not inferred from names.
  Recursion is marked where it happens; a call that leads into another figure says so
  rather than repeating its subtree.<br><br>
  Companions: <a href="https://claude.ai/code/artifact/e1f6fb30-dc9e-4bc0-ac0e-836e1a528b56">The
  bound.less Logical Design</a> (why any of it exists) and
  <a href="https://claude.ai/code/artifact/2d3a3acd-0a89-4e2b-a161-3445bdd19756">The bound.less
  Code Map</a> (what each function does).
</footer>
</main>
</div>
</div>""")
    return u"\n".join(parts)

if __name__ == "__main__":
    out = build()
    io.open("../boundless-call-map.html", "w", encoding="utf-8").write(out)
    print("wrote boundless-call-map.html  (%d chars)" % len(out))
