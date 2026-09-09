# UAT — cross-browser / cross-device acceptance

Started **2026-08-25**. What has to *look right* on a machine that isn't the
development one. Engineering concerns live in `docs/OPEN-FLAGS.md`; open bugs are
fixed and tested before they reach this sheet.

Deliberately short. Add to it as the UX redesign lands.

Visual regression is checked **by hand**, by Kobin, in a real browser after
changes — that pass is the gate behind rule 1 in `docs/ai/00-START-HERE.txt`
("a green suite is not evidence"), and it is why nothing on this sheet is
automated. The cases below are what that pass covers on a machine that is not
the development one.

## Record a run

```
RUN:        <date>
Browser:    <name + version>
OS:         <version>
Monitor:    <resolution, physical size>
devicePixelRatio: <value>        (type devicePixelRatio in the console)
Browser zoom:     <%>
GPU:        <WebGL renderer string, or "software">
```

## Environments still to cover

Everything so far has been checked on one machine: Chrome 151, Windows 11, Intel
Iris, dpr 1.5.

| environment | dpr | status |
|---|---|---|
| Chrome, Windows, Intel | 1.5 | done |
| Chrome, plain 1080p monitor | 1.0 | — |
| Chrome, HiDPI / Retina | 2.0 | — |
| Firefox | any | — |
| Safari / WebKit | any | — |
| Software rendering (GPU off) | any | — |
| Touch / tablet | any | — |

---

## Cases

### 1. Thin strokes fade smoothly while zooming

Zoom out slowly on a long, thin stroke. It should thin and fade **continuously**
— never blink out and come back.

**FIXED 2026-08-26 and confirmed by Kobin on Chrome 151 / dpr 1.5** — the
per-object power-of-two rescale in `Renderer._applyThinScale`. What is still
unknown is whether the dead zone it works around exists at all on other engines
and other dpr, so this case stays: the failing readings were solid at 0.234 px,
blank at 0.165 px, visible again at 0.082 px. (Full measurements: F-Z in
`docs/OPEN-FLAGS.md`.) `Renderer.thinScale = false` in the console turns the fix
off, which is how to tell whether a browser needs it.

Screenshot live and magnify before calling anything blank — faint sub-pixel grey
does not survive JPEG compression.

### 2. Tile seams are invisible

No hairline gaps, and no darker doubled lines, along tile boundaries — at any
zoom. Seam overlap is derived in frame units, so it lands differently on
different pixel densities.

### 3. Deep zoom stays sharp

Zoom out, pan several screens, zoom back in. No vertex snapping, no faceting on
curves, no pixellated strokes.

### 4. Selection indicator

Marching ants animate at a sensible speed and direction; dashes meet up around a
loop; specks blink; screen-edge chevrons appear where an object runs off-view.
The animation is CSS-driven, so timing and smoothness are browser-specific.

### 5. Colours match

The palette is authored in `oklch`. Confirm the terracotta selection ink and the
paper background look the same across engines, and degrade sensibly anywhere
`oklch` is unsupported.

### 6. Zoom and pan input

Wheel, trackpad pinch, and touch pinch all zoom smoothly and at a comparable
rate. No runaway zoom, no stalling mid-gesture.

### 7. Autosave survives a reload; storage does not creep

Added 2026-09-02 with the F33 rework. Draw a few strokes on a new canvas, wait
two seconds, reload: the strokes and the view come back. Zoom without drawing,
wait ten seconds, reload: the zoom comes back too. Open a new canvas, draw
nothing, leave: it must not appear in the gallery, and the gallery's "Using … of
browser storage" line must not climb from doing that. On the phone, background
the tab right after a stroke and reopen it later: the stroke is there. The
instrument is `notePerf("autosave")` in a report — on the big drawing, no entry
over 50 ms is the pass, and that run has not been made yet.

### 8. The select tool on a phone

Added 2026-09-03 after Kobin's phone test. With nothing selected, a drag draws
a lasso wherever it starts, ink or paper; a tap on ink selects it; a tap on
paper clears. With something selected, a drag from it moves it, a drag from
another object selects and moves that one, a drag from paper lassoes. Pinch to
zoom with the select tool active: nothing under the fingers gets selected, and
a selection made before the pinch survives it, even when the second finger
lands late. The grace is 400 ms and the drag threshold 8 px; Kobin said he
would report how it feels. A lasso drawn with its start and end far apart is
closed by the dashed chord you can see, and the rule is still "fully inside".
After the line tool, the eraser must erase along the finger, not a straight line.
Select a dozen large objects and zoom in: every one on screen keeps its ants,
on its own edge, and never along a tile cut. Nothing is ever a solid line.
Select a dense scribble and zoom out until it is under 2 px: one dot; zoom back
in and every stroke gets its own ants again, on its own edge, never a box, even
one stroke on its own — there is no budget, and with the whole drawing selected the crawl's
repaint is what you will feel (50 to 200 ms a frame on the desktop; the phone
is the test). The ants march in steps, twenty a second, and hold still while
the camera moves. Drag a selection: the ants move with it. Lasso one piece of
a re-homed object (a ceded tile, or the parent without its tile): nothing is
selected; lasso all of it and it is.

**A circle's edge stays put across a level jump (F40).** Draw a circle, zoom
in on its edge a thousandfold and more, through a level jump and on to the
next: the edge is a nearly straight line that does not move at the jump and
nothing appears or disappears beside it. Before 2026-09-04 a circle one level
up drew a band hundreds of pixels wide that vanished at the jump; the band was
the cubic's error, not the circle; and until the same evening a piece that
spanned a whole tile vanished outright past a certain zoom, because the
browser gives up on a path that large. The renderer now plans each arc once
at the frame's deepest zoom to a quarter pixel and clips anything reaching
far past the view to a window around it, re-cut as you pan or zoom. If an
edge sits visibly off, a shape vanishes at some zoom while its neighbours
stay, or a straight cut edge appears on a shape as you pan, note the zoom
(the scale bar) and whether it happened at a level jump.

### 9. Moving from below, and erasing at depth (F41, F42)

Added 2026-09-04 after Kobin's phone reports; both fixes are in jsdom only
until this is run. Draw a stroke at the top level. Zoom in on its edge through
three, four, five level jumps (the scale bar says which). Select it and drag:
the edge must follow the finger continuously — no sitting still and then
jumping (before the fix it jumped 127 px at 254× three jumps down, and did not
move at all deeper). Let go, zoom out one jump: the edge is where the drag put
it, shifted the same amount on screen. Zoom out to the top: nothing has
visibly moved. Now zoom back in five or more jumps onto the edge of a stroke
and erase across it: a hole appears exactly under the eraser and the ink
beside it stays (before the fix nothing happened past six jumps, or ink far
from the eraser vanished). Then, on the same edge, zoom out two jumps and
erase across it there: the hole appears under the eraser at that level too.
If a drag is jumpy or an erase does nothing, send a report from that view: the
move note now carries every member the drag could not move and why.

### 10. The star in the corner, and the nick far along the edge (F55, F43)

Added 2026-09-05 after Kobin's two scenarios; both fixes are in jsdom only
until this is run. **The star.** Draw a large stroke at the top level. Zoom in
on one of its corners through four or five level jumps and draw a small mark
touching the corner (the star). Zoom out to the top, or to one jump down,
select both, and drag them together a little way — an odd distance, not a
whole number of anything. Zoom back in to the corner: the star must still
touch it exactly as it did (before the fix the two parted by a few units of
that level after a top-level move and by thousands after a move made one jump
down, which is a screen or more at that zoom; F35 was this). Undo the move and
zoom in again: the same. **The nick.** Draw a long stroke at the top level and
zoom in on one point of its edge through five or six jumps; note exactly where
the edge crosses the view. Zoom out to two or three jumps down, move along the
edge a few hundred pixels, and erase a small nick across it. Zoom back in to
the same point on the edge: it must be exactly where it was (before the fix a
nick made three jumps down moved the edge by a screen at seven jumps and out of
the view entirely at eight). Curved edges are covered too, since 2026-09-06
(the freeze became one radius, F44): a nick on a curve at any level must move
nothing but the nick. A drawing saved after a nick is written as file version
2 and will not open in the build that is deployed today; say so if it matters.

### 11. The crossing jump (F44), and an erase below moved objects (F56)

Added 2026-09-06, both in jsdom only until this is run. **The crossing
jump.** Draw a curved stroke at the top level and zoom in on its edge one
level jump at a time, five, six, seven, eight jumps: at every jump the edge
must stay put on screen, to a fraction of a pixel (before the fix it moved
about a thousand pixels at the fifth jump — your green stroke at 4 → 5 in the
report of 2026-09-05 04:47). Then pan along the edge at the deepest level:
it must be one continuous line with no steps at tile boundaries. **The erase
below moved objects** (your reports of 2026-09-06 00:16): draw two large
overlapping strokes of different colours, zoom in ten jumps on a region where
only one of them is painted, drag both a few times at that depth, then erase a
small scribble on the one that is painted there. Only that one may change,
and only by the scribble; the other must keep its colour and its edge exactly
where they were (before the fix its colour flooded the whole tile). Undo and
redo must give the same picture.

### 12. A pen-up paints once (2026-09-07)

Added 2026-09-07, jsdom and a DOM check in the in-app browser only — the pane
would not paint while the window was behind another, so the picture itself
is yours. A stroke used to render twice: at pen-up as the raw stroke, and
again a few milliseconds later when its perimeter resolved; the second render
now waits for whatever renders next (the next pen-up, a zoom across a level,
an undo, an erase). Draw a stroke and let go: it must stay exactly as it was
under the pen — no flicker, no change of shape or weight, no delay — and then
draw another: the first must not change at that moment either. Draw one
stroke, wait, and zoom in within the level: it must scale like any other ink.
Draw a stroke and undo it at once: it must go. With the pen at its widest and
a long scribble (a bake of a second or more), do the same. On the phone, draw
a stroke and immediately tap it with the select tool: it must select.

---

## UX redesign

*(To be filled as it lands.)*
