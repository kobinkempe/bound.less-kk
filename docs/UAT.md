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

---

## UX redesign

*(To be filled as it lands.)*
