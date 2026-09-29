# `__oracles__` — reference implementations, not shipped code

Nothing in `src/` outside this folder imports anything in it, so **none of it
reaches the production bundle**. Webpack only follows what `src/index.js` can
reach; these files are reachable only from test suites.

They are kept, and kept tracked, because each one is an *oracle*: an
independent implementation of something the engine also does, written a
different way, used to check that the shipping version is right. Deleting them
would not remove a bug; it would remove the ability to notice one.

| file | what it is an oracle for | who asks it |
|---|---|---|
| `KobinEngineV0.js` | the whole pre-arc engine — polyline ink, Clipper booleans, no frame lattice | `KobinEngineV0.test.js`, `geometry/derive.test.js`, `perf.bench.slow.test.js` |
| `curvePerimeter.js` | the cubic-offset perimeter the arc pipeline replaced | `curvePerimeter.test.js`, `bakeStrategies.*` |
| `strokeShape.js` | crumb/cover bookkeeping the perimeter walk is built on | `strokeShape.test.js`, `curvePerimeter.js` |
| `bakeStrategies.js` | the three competing bakers (A/B/C), still the head-to-head bench | `bakeStrategies.test.js`, `geometry/arcPerimeter.test.js` |
| `cede.js` | rectangle ceding, against which the tile-window cut is checked | `geometry/derive.test.js`, `geometry/seams.test.js` |
| `erase.js` | the pre-bake eraser footprint | `erase.contract.slow.test.js` |
| `coverageOracle.js` | the rasteriser's coverage: exact-winding by 16 sub-scanlines a pixel row, plus the shoelace area. It is exact for any winding and any overlap, which signed-area accumulation is not, so it is what says whether `raster/rasterCore.js` painted the right fraction of each pixel | `raster/raster.oracle.test.js` |
| `renderList.js` | the render list by brute force: every tile of a rect read from the store, the moved natives read back where their picture is, the frame's live natives, stamped and sorted — `KobinEngine.listFor` as the SVG path used it until B-PYRAMID-3 (2026-09-29); `tileContent(store, …)`, the tile part alone (`TileStore.content` until B-PYRAMID-3 item 4) | `stage.equiv.test.js` and `.probe.js` (through `__testkit__/stageFuzz`), `stage.cover.test.js`, `model.pureRead.test.js`; `tileContent`: `TileStore.test.js`, `tile.patch.test.js`, `erase.depth.test.js`, `move.registration.test.js`, `depth.corner.probe.js` |
| `model-v1/` | the document model before A1's C1 (a frame's shift settled into its natives at the first read, carried across cell edges, followed by the selection): the whole engine closure frozen at 5e9b1dd (see below) | `model.equivalence.probe.js`, `select.stands.probe.js`, `hooks/store.model.test.js`, `model-v1/modelV1.test.js` |

## `model-v1/` — the model C1 replaced

A frozen copy of the engine as it was at commit 5e9b1dd (2026-09-29, B-MODEL-C1's launch): `Document`, `LevelMap`, `TileStore`, `selection`, `oplog` and every module that reads the settle or that C1 edits — `KobinEngine` and its mixins (`erasePipeline`, `overlays`, `files`, `sceneOps`), `Stage`, `placementModel`, `geometry/offsets` (as `offsets.js`), `eraseDescent`, `cede`, `eraseWorkerClient`, `frameGc`, `persist`, `format2`, `sceneClient` — plus the SVG `Renderer`, so B-PYRAMID-3's demotion cannot reach it. Only the import lines were rewritten: copies import copies, the four raster modules `KobinEngine` names go to `rasterShim.js` (the oracle runs the SVG path; its raster classes refuse construction), and everything C1 does not change (geometry, `frameLattice`, `Camera`, `eraseRule`, `eraseJob`, the raster helpers the copies call) is imported from the live tree. It is the settling model: a subtree move leaves a shift on the frame and the first `Document.at` settles it into the natives' tables, carrying across cell edges (`modelV1.test.js` pins that). It is what the tile and selection fuzzes compare the composed model against (PLAN §3 rows 7 and 9, A1 §5). Construct it as the engine: `new (require("./model-v1/KobinEngine").default)(host, opts)`.

## The rule

**Production code must never import from here.** If a function in this folder
turns out to be needed by the app, move it out — do not add the import. The
whole value of an oracle is that it was written without reference to the code
it checks, and an oracle the engine depends on has stopped being one.

`tools/docmaps/inventory.py` still covers this folder, so every function here
is on the Code Map and the Call Graph like any other.
