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

## The rule

**Production code must never import from here.** If a function in this folder
turns out to be needed by the app, move it out — do not add the import. The
whole value of an oracle is that it was written without reference to the code
it checks, and an oracle the engine depends on has stopped being one.

`tools/docmaps/inventory.py` still covers this folder, so every function here
is on the Code Map and the Call Graph like any other.
