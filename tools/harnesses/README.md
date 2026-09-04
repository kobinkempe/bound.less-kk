# tools/harnesses — browser measurement pages

Static pages opened directly in a browser (`file://` or any static server) to
measure something the Jest suite cannot see. None of them is part of the app,
and none is bundled: they lived under `public/` until 2026-09-02, where Create
React App copied them into `build/` and every deploy shipped them.

| page | what it measures | flag |
|---|---|---|
| `hairline/index.html` | stroke vs filled sliver vs filled cubic loop, **canvas-measured**. Useful only as the negative control that shows a canvas rasterisation cannot see the compositing failure. | F-Z |
| `hairline/chrome.html`, `chrome2.html`, `chrome3.html` | live-DOM grids of thin filled paths, for screenshotting in real Chrome and magnifying. This is how the dead zone near 0.165 px was found. | F-Z |
| `ants-measure.html` | the selection indicator's marching-ant construction, stripped to the pieces that affect ant geometry, so dash and band sizes can be read off at several zooms. Derived from `design-system/components/selection/`. | — |

The rule these exist to enforce is rule 3 in `docs/ai/00-START-HERE.txt`:
anything about paint is measured in a real browser, never by rasterising the
SVG to a canvas.
