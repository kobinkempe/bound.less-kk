# bound.less

An infinite-zoom drawing canvas. Sketch a city, zoom into a window, draw the room inside — then keep going.

**Live demo: <https://bound-less-kk.web.app>**

> **Built with AI tools — [Claude Code](https://claude.com/claude-code), [Cursor](https://cursor.com), and [Lovable](https://lovable.dev).**
> This project was an exercise in modern AI-assisted engineering — the v2 zoom engine, its test harness, and the current UI were designed, debugged, and shipped in collaboration with these tools.

![Ink sketch of a treehouse village on an infinite canvas](src/Images/ui/canvas-main.jpg)

## What it does

- **Infinite zoom** — zoom in as far as you like. The canvas re-anchors itself every ×4,096 of magnification and keeps each stroke in the coordinates of the level where it was drawn, so ink stays exactly where you drew it, at the scale you drew it, and stays exact when you erase, move, or save it. Draw detail at any depth and find it again on the way back out.
- **A full drawing kit** — pen, pencil, highlighter, and straight-line tools in six colors or a custom one; an eraser that cuts away just what it passes over, and one that removes whole objects; select, lasso, move, and delete; pan with the hand tool or two fingers, zoom with the wheel or a pinch; undo and redo across everything, kept through a reload.
- **Real-world scale** — drag across anything you've drawn and declare "this is 1 inch" (or 40 meters, or 3 miles). A scale bar then tracks every zoom, walking a ladder of sensible units from millimeters to miles as you dive and climb.
- **Scenes** — the coherent drawings hidden inside a canvas are found automatically and kept in a scene index saved with the file, updated in a background worker as you draw, erase and move, never re-clustered (spec: [`docs/reference/scenes-v3-design-bible.md`](docs/reference/scenes-v3-design-bible.md)): widths decide nesting, so fine detail inside a drawing — or carved into it by a fine eraser — is its own scene rather than lost in the zoom. Scenes get rendered thumbnails and one-tap jumps at their natural zoom, and can be renamed.
- **Local-first saving** — work saves to your browser as you draw and stays there by default; no account needed. Sign in with Google to sync canvases (thumbnails included) to your account and pick them up on any device. One tab or device edits a canvas at a time: another opens it read-only and follows along until you choose "Edit here", and if two copies were changed apart, both are kept. Drawings also export and import as `.boundless.json` files, the view exports as SVG, and a deleted canvas goes to a recycle bin.

## How the engine works

The interesting problem: browsers (and doubles) give out long before "infinite." So the engine in [`src/engine/`](src/engine) stores nothing in one global coordinate system. Space is a lattice of cells, each level ×4,096 the magnification of the last — a power of two, so crossing one spends no precision at all. Every object is stored in the cell it was drawn in, in that cell's own small coordinates, and everything shown at any other depth is *derived*, never stored:

| Piece | Job |
| --- | --- |
| `Camera` | Level-local view transform; crosses between levels when zoom passes enter/exit thresholds (with hysteresis so the boundary doesn't flicker) |
| `LevelMap` / `TileStore` | The lattice of frames, and the cross-level views derived from it: tiles chained one crossing at a time and classified empty / solid / edge, so a stroke magnified ×4,096⁵ collapses to bounded tile fills instead of exploding |
| `Document` | Objects live in their home frame, with a spatial index per frame; ids double as z-order; undo and redo |
| `geometry/` | Ink is **circular arcs**, not cubics: the offset of an arc is a concentric arc, so both edges of a stroke are exact with no fit tolerance and erasing is an exact arc boolean at any depth |
| Moving (`geometry/offsets.js`, `selection.js`) | A move never rewrites a stored coordinate: whole cells change the object's address, and the remainder lives in a small displacement table applied when the ink is drawn, so detail drawn four levels down stays registered with the shape it was drawn against. A lasso that encloses whole frames moves them as frames, not object by object, and a drag writes nothing until the drop |
| Erasing (`erasePipeline.js`, `eraseJob.js`) | An eraser is a stroke: when it lands it records the ink under it and hides exactly that. The cuts run as jobs in Web Workers and are applied in a fixed order, so the result does not depend on which worker finishes first; an erase made far below a coarse object hands the cut down one level at a time, so the hole is cut at the scale it was drawn at |
| `raster/`, `Stage` | The default renderer: the engine's own float64 coverage rasteriser fills 512-pixel plates in Web Workers, kept as a pyramid of zoom levels. A plate not yet made is stood in for by the nearest picture the store holds, blurrier before older, and work is queued by priority outward from the pointer. Both renderers draw one scene, the `Stage`, kept in step with the document |
| `Renderer` | The SVG renderer, behind `?svg` and used for SVG export: persistent per-object Two.js groups, updated by diffing, with per-level scene retention so level crossings reattach instead of rebuilding |
| `persist.js`, `format2.js`, `oplog.js` | The versioned file format (`kobin-1`) with validation, and the store behind autosave and sync (`kobin-2`): per-frame snapshots as flat float arrays plus an op log, so a save is an append, undo history survives a reload, and an interrupted erase resumes where it stopped |
| `src/cloud/` | The cloud copy mirrors the local store in gzipped chunks, its manifest written last. One editor at a time: a Web Lock on the device, a lease in the cloud, and a token on every local write, so a tab that has lost the pen writes nothing |
| `scaleBar/` | The real-unit scale system: unit catalogs, preference "ladders," and sticky per-session display choices |

The suite is about 3,200 Jest tests in about 240 files, about 2,500 of them in the quick run that CI makes on every push (the whole suite runs nightly). Beside the unit tests it holds oracles — independent implementations the shipping code is checked against, among them the whole pre-arc engine — seeded fuzzers that run random edits against a frozen copy of the previous document model, and a fidelity harness that replays recorded drawings (kept locally, not in git) and checks the rendered ink against ground truth computed straight from the document. The geometry is type-checked through JSDoc, and a lint rule enforces the layering (the engine never imports the UI; the geometry imports only itself and the lattice constants). What only a browser shows — its compositing and its frame timing — is measured in one: in Chrome, and with a headless-Chromium harness in [`tools/harnesses/`](tools/harnesses).

**[`DESIGN.md`](DESIGN.md) is the whole design in one document** — why the coordinates work the way they do, and what each decision cost to learn. The design history it was distilled from — bugs, dead ends, measured perf wins (one pathological tile bake went from 585 s to 550 ms) — is in [`docs/issue-log.md`](docs/issue-log.md) and [`docs/reference/`](docs/reference). [`review/rebuild/`](review/rebuild) is the record of the renderer and document-model rebuild of September–October 2026: its designs, its plan, the logs of the AI agents that built and reviewed it, and the final audit.

## Run it locally

Requires **Node 14** — the toolchain is an older Create React App setup (the move to Vite and React 18 is on the roadmap).

```bash
npm install
npm start            # http://localhost:3000 (bundles the Web Workers into public/ first)
npm run test:quick   # the quick Jest suite; npm run test:slow runs the slow one
npm run typecheck    # JSDoc-checked geometry
npm run lint         # eslint, including the layering rule
npm run build        # production build to build/
```

Deploys are plain Firebase Hosting: `firebase deploy --only hosting` (config in `firebase.json`).

**Working on this?** Read [`DESIGN.md`](DESIGN.md) first, then [`docs/ai/00-START-HERE.txt`](docs/ai/00-START-HERE.txt) — the current status, a code map, and the live issue list, written for someone with no context.

**Dev tools:** append `?dev` to a canvas URL (e.g. `/#/canvas/new?dev`) to reveal the engine's developer panel — live level/zoom/object readouts, the debug overlays, the renderer's levers, and the diagnostic Report button, which sends the instruments, the last 40 gestures and a loadable copy of the drawing on screen to a local report server (`npm run report-server`). `?svg` draws a canvas with the SVG renderer.

## Roadmap

The plan of record is [`docs/ROADMAP.md`](docs/ROADMAP.md): fix autosave, deploy, performance and bugs, then UX, with the structural work running underneath. Product features queued there:

- A redesign of the Scenes experience
- Public canvases with a share link, and sharing a canvas with another account
- Live editing on two devices at once, with merging
- A phone layout and keyboard access
- Z-order commands, erasing only the selection, and drawing on through a zoom
- A fuller color picker, and an indicator while a canvas loads
- AI-suggested scene names (Gemini's free tier — once the build toolchain modernizes enough for Firebase AI Logic)
- Rotation and measurement tools

## History

bound.less began in 2021 as a university team project by Michael Sawchuk, Kobin Kempe, Anuja Mehta, and Nolan Raghu, which proved out the idea but stopped at SVG's practical zoom limits. This repository is Kobin Kempe's continuation: the v2 zoom engine (the frame lattice, the arc geometry, and the raster renderer), the drawing, erasing and selection tools, the real-unit scale system, scenes, local-first saving with account sync, and the current interface.
