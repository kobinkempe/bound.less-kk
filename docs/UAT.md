# UAT — cross-browser / cross-device acceptance

Started **2026-08-25**. What has to *look right* on a machine that isn't the
development one. Engineering concerns live in `docs/OPEN-FLAGS.md`; open bugs are
fixed and tested before they reach this sheet.

Deliberately short. Add to it as the UX redesign lands.

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

Known to fail on Chrome 151 / dpr 1.5: solid at 0.234 px, blank at 0.165 px,
visible again at 0.082 px. Whether the dead zone moves, widens, or vanishes on
other browsers and other dpr is the main thing this sheet exists to find out.
(Full measurements: F-Z in `docs/OPEN-FLAGS.md`.)

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

---

## UX redesign

*(To be filled as it lands.)*
