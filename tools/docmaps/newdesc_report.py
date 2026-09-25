# -*- coding: utf-8 -*-
"""Per-function entries for the dev report (src/engine/report.js, src/hooks/reportSend.js) and
the renderer's URL gate in src/hooks/useKobinEngine.js."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


D = "§15"   # how the engine watches itself

# What each file is for in the design; the file's article heading on the Code Map.
ROLE = {
    "src/engine/report.js":
        "The dev report's assembly (DESIGN.md §14, OPEN-FLAGS F58): the instruments, the save, move, erase "
        "and scene state, the recent history, and a local extract of the drawing in kobin-2 frame form that "
        "`loadReport` turns back into an engine. Built task by task with a yield between; it only reads the engine.",
    "src/hooks/reportSend.js":
        "The dev report's transport: build, one stringify with the user's identity scrubbed, gzip off the main "
        "thread, POSTed in parts to `tools/report-server.js` on :3001, and the whole drawing after it when asked. "
        "A send that fails is saved as a file. Dev only: the `?dev` panel and `window.__kobinReport`.",
    "src/hooks/useKobinEngine.js":
        "The editor's engine lifecycle: mounts the engine with the renderer the URL chooses, wires input to it, "
        "owns the tool and style state, runs the local autosave into the kobin-2 store (DESIGN.md §13), and hands "
        "the sync session its controls (read-only, saving gate, flush, reload).",
}


# ---- src/engine/report.js ----
add("rep.msg", "msg(err)",
    "An error's message cut to 200 characters, for the report's `errors` entries.",
    ["-"])
add("rep.r3", "r3(v)",
    "A finite number rounded to six significant figures; anything else returned unchanged.",
    ["-"])
add("rep.macroYield", "macroYield()",
    "A yield to the event loop through a MessageChannel, which a hidden tab does not throttle the way it throttles timers.",
    ["One shared channel: each call queues its resolver and posts a message, and the messages resolve them in order. Without `MessageChannel` it falls back to `setTimeout(0)`; Node's port is `unref`ed so a test process can exit.",
     "Chained timers in a hidden tab run once a second, and once a minute after five minutes hidden: measured 2026-09-22, a 20-task report over `setTimeout(0)` took 11 minutes to send."],
    D)
add("rep.brief", "brief(v, depth, key)",
    "A bounded JSON copy of any value: the form every free-form part of the report takes.",
    ["Keeps primitives and cuts strings at 160 characters; summarises typed arrays (`{ f64: n }`), natives (`nativeBrief`) and Maps and Sets (their size); cuts arrays to their first 20 with the count; stops three levels down. Functions and `_`-prefixed keys other than `_seq` are dropped, and an object past 24 keys ends with its key count.",
     "An array under a key starting `below` is written as a displacement table's file form (`encodeBelow`)."],
    D)
add("rep.nativeBrief", "nativeBrief(o)",
    "A native as its id, type and size, never its geometry: what `brief` writes for anything with loops, points or rings.",
    ["A shape's piece count or a stroke's point count, then `z` when it differs from the id, `editId`, the erase flag and the displacement table in its file form."],
    D)
add("rep.boxOf", "boxOf(b)",
    "A bounding box as `[x0, y0, x1, y1]` at six significant figures, or null.",
    ["-"])
add("rep.numbersOf", "numbersOf(o)",
    "How many doubles a native's kobin-2 span holds: the unit the extract's estimate and the whole drawing's parts are sized in.",
    ["One for the header count, then per loop one plus its stored numbers (a shape), per ring one plus two per point (a fill), or two per point (a stroke).",
     "Mirrors `format2.pushGeometry`'s count; a change to the span grammar changes both."],
    D)
add("rep.costOf", "costOf(o)",
    "A native's estimated bytes in the extract's JSON: 200 for its header and 17 per double.",
    ["Measured on the Magnum Opus: 16.3 bytes a double with its comma and 166 a header, which the constants round up."],
    D)
add("rep.buildReport", "buildReport(E, opts)",
    "Builds the dev report section by section, each its own task with a yield between, so no build holds the main thread whole.",
    ["In order: meta, camera, counts, raster, instruments, memory, moves, erase, scenes, save, cloud, errors and history; then the local extract (`buildExtract`, unless `opts.extract` is false) and the families it touches (`familiesOf`). `build` records the total ms, each task's ms and the longest; the headline (`headlineOf`) is computed last from the finished sections.",
     "Every section is caught: one that throws is named in `build.errors` and the rest of the report stands. The save, cloud, page-error and console sections are the caller's state, taken as given and `brief`ed.",
     "It must only read: nothing here mints a frame, settles a shift or emits a document event (DESIGN.md §14)."],
    D)
add("rep.metaOf", "metaOf(E, opts)",
    "The report's who-and-where: time, reason, renderer, route, URL flag names, device, and the engine's modes and gesture in progress.",
    ["The route is the hash with its query cut off; the query goes in as parameter names only (at most 12). Device: user agent, platform, cores, memory, touch points, online, device pixel ratio, window and engine sizes, visibility. Engine: tool, trace, pre-bake, retained scenes, opacity groups, and whether a stroke, erase, lasso or drag is under way."],
    D)
add("rep.cameraOf", "cameraOf(E, sub)",
    "Where the camera is: its state, depth, effective zoom and view, the chain of frames to the root, and its ring and children.",
    ["The chain walks parents from the camera's frame (at most 200), each with its cell, native count, child count, shift and shadow; the ring and the first 30 children carry native counts. `latticeFrames` is the lattice's size."],
    D)
add("rep.countsOf", "countsOf(E)",
    "The document in numbers: natives, pieces, shapes, strokes, fills, erase marks, frames, moved objects, undo and redo depth.",
    ["One pass over every frame's list; `byFrame` is the 40 most populated frames and `listed` the last render list's length."],
    D)
add("rep.rasterOf", "rasterOf(E, sub)",
    "The renderer's section: the raster perf ring, plate store, picture layer, move plane, overlay, ladder and drain queues; for SVG only its group count.",
    ["`perf` is `rasterPerf.report`, a module singleton attached to the last renderer built; `plates` is this engine's own store. The layer's uncovered cells are what the headline's paper figure reads."],
    D)
add("rep.instrumentsOf", "instrumentsOf(E, sub)",
    "The engine's instruments: the last 300 perfLog entries, the fast-path stats, frame meter, long frames, event latency and growth.",
    ["DESIGN.md §14 says what each measures."],
    D)
add("rep.memoryOf", "memoryOf(E, sub)",
    "Memory: the JS heap where the browser exposes it, the plate store's bytes, a census of the tile cache and the undo stack's length.",
    ["`performance.memory` is Chrome's; elsewhere `heap` is null. Without a plate store the plate figures are `rasterPerf.growth()`."],
    D)
add("rep.tileCensus", "tileCensus(store)",
    "The tile cache counted: tiles, pieces, tiles by direction (up or down), and the 12 frames whose tiles hold the most pieces.",
    ["-"],
    D)
add("rep.movesOf", "movesOf(E, sub)",
    "The move state: the selection and its first 50 members, a drag or hold in progress, the shifted and shadow frames, and the last ten move ops.",
    ["Members carry level, type, z, editId, displacement table (file form) and box; shifted and shadow frames are capped at 50 each; the recent ops are the undo stack's `move`, `moveMany` and `moveFrames`, `brief`ed."],
    D)
add("rep.eraseOf", "eraseOf(E, sub)",
    "The erase state: pending marks and their bake progress, the bake queue, the cut in flight, the seal, repair and failure counters, and the worker's stats.",
    ["Each of the first 50 marks carries its level, z, bake px, box, how many ids its bake has done and whether it is committed; `heldMs` is how long the bake has been held back."],
    D)
add("rep.scenesOf", "scenesOf(E, sub)",
    "The scenes: their count, the first 60 `brief`ed, and the scene index's own report where the engine has `sceneReport`.",
    ["-"],
    D)
add("rep.historyOf", "historyOf(E)",
    "The recent history: the gesture journal whole, the last 30 undo ops and the last 10 redo ops.",
    ["The journal is the last 40 gestures with their pointer paths (DESIGN.md §14), which is what a replay of a report drives."],
    D)
add("rep.familiesOf", "familiesOf(E, ex, run)",
    "The multi-native families the extract touches, and for each which of its members still form one connected piece.",
    ["One task finds them: every non-erase native in the extract names its edit key, one pass over all natives collects each key's members, and the first 12 with more than one member are kept. Each then gets a task of its own computing `_familyComponents`, as `reportFamilies` does for the whole drawing.",
     "A family with a moved member (a displacement table) gets no components: `_familyComponents` maps its parent through `objShift`, which can mint a frame, and the report only reads.",
     "Counting only the extract's keys avoids `editGroup`'s index over every native (measured: 218 ms cold on 42,856 natives, for no family at all)."],
    D)
add("rep.headlineOf", "headlineOf(rep)",
    "The numbers `tools/report-read.js` leads with, gathered at the top of the report.",
    ["When and why, renderer, camera frame, depth and zoom, native, piece, frame and lattice counts, the paper figures from the raster perf picture, the worst long frame, heap, pending marks, selection size, whether the save is failing, and the extract's size and whether it was cut."],
    D)
add("rep.buildExtract", "buildExtract(E, opts, run)",
    "The local extract: the natives on and around the screen in kobin-2 frame form, cut to a byte budget, with the lattice, so `loadReport` can rebuild the view.",
    ["Scores the candidates (`scorer`) in slices of 1,500 natives, chooses by tier and size within `maxBytes` (4 MB of JSON by default; `chooseNatives`), encodes each frame's chosen natives in slices of about 512 KB of estimate (joined, spans offset), then attaches the lattice (`latticeFor`). The camera and screen size go with it; `stats` counts the candidates, the chosen, the on-screen, selected and listed ones kept and dropped, and the too big.",
     "The slices are what keep it off the main thread: 16,079 cold natives scored in one task took 401 ms, and one frame's 3 MB encoded in one took 170 ms."],
    D)
add("rep.scorer", "scorer(E, zoomOut, minPx)",
    "Sets up the extract's scoring: per-frame work lists a slice at a time can `consider`, and a `finish` that adds the selection wherever it is.",
    ["A native's score is its size in screen px at the zoom-out that first brings it on screen (1 when it is on screen). Its tier is 0 on screen (in the last render list and meeting the view), 1 selected, 2 in the render list (the tile window), 3 around; a tier-3 native past `zoomOut` (4,096) or under `minPx` (0.25 px) is left out.",
     "A frame that cannot be mapped to the camera's is counted `unreachable`; one whose largest native is under `minPx` and holds nothing on screen or selected is skipped (`tinyFrames`). Otherwise its candidates are a rect query around the view plus its moved natives, or its whole list when the frame has a pending shift.",
     "A moved native is judged where its picture is: `shiftAt(below, 0)` in its home's units, plus the frame's pending shift."],
    D)
add("rep.chooseNatives", "chooseNatives(list, maxBytes)",
    "Picks the extract's natives: sorted by tier then score, each taken while the estimated bytes still fit.",
    ["Past the cap the scan goes on, since a smaller native further down may still fit. Every one left out is counted (on-screen ones separately), and one over a quarter of the budget is named in `tooBig` (up to 20). Returns the chosen ids by frame and the set of their frames."],
    D)
add("rep.latticeFor", "latticeFor(E, homes)",
    "The extract's lattice: whole up to 20,000 frames; beyond that the chains to the root of the camera's frame, its ring and every extract frame.",
    ["Only a whole lattice lets `loadReport` map every frame as the engine did; a trimmed one says so (`trimmed: { kept, of }`)."],
    D)
add("rep.drawingPlan", "drawingPlan(E, maxBytes)",
    "Cuts the whole drawing into parts of about `maxBytes` of doubles (1 MB by default), per frame, each native once: the plan for the whole-drawing opt-in.",
    ["The plan holds the natives by reference, so a part encodes them as they are when it is sent. A native larger than the cap is a part of its own.",
     "The size bounds a main-thread task: encoding is about 45 ms a MB, and 3 MB parts reached 372 ms."],
    D)
add("rep.drawingChunk", "drawingChunk(step, part)",
    "One planned part as a kobin-2 frame chunk (`format2.packChunk`) with the header `{ frame, part, objects }`.",
    ["-"],
    D)
add("rep.extractToSnapshot", "extractToSnapshot(ex, drawing)",
    "A report's drawing as a dev-0 snapshot for `loadSnapshot`: the extract's frames, or the whole drawing's parts when they are given.",
    ["`drawing` is the parts' chunk bytes, already gunzipped; each is unpacked and decoded into its frame. The camera and the lattice (`crossings`) are the extract's either way."],
    D)
add("rep.loadReport", "loadReport(E, rep, opts)",
    "Loads a report's extract, or its whole drawing, into an engine at the recorded camera and screen size.",
    ["Resizes `E` to the recorded screen unless `resize` is false, then `loadSnapshot`; returns the native and frame counts and whether it was the whole drawing. A report with no extract (a v1 report, which carried the whole document as `snapshot`) throws.",
     "Called by `reportSend.replayReport` in a page and by `__testkit__/reportReplay.js` in jsdom."],
    D)


# ---- src/hooks/reportSend.js ----
add("rps.msg", "msg(err)",
    "An error's message cut to 160 characters, for the sender's `why`.",
    ["-"])
add("rps.installConsoleTap", "installConsoleTap(con)",
    "Wraps `console.error` and `console.warn`, once, so the last 50 warnings and errors are kept for the report.",
    ["Each entry is its time, level and the arguments joined as text (an Error as name and message, anything else as JSON), cut to 300 characters. The original method still runs, and a failure inside the tap never stops a log.",
     "The hook installs it where it exposes `window.__kobinReport`: a dev build, or `?dev`."],
    D)
add("rps.consoleTail", "consoleTail()",
    "A copy of the tapped warnings and errors: the report's console section unless the caller passes its own.",
    ["-"],
    D)
add("rps.safeJson", "safeJson(v)",
    "A logged value as JSON cut to 300 characters, or `String(v)` when it will not stringify.",
    ["-"])
add("rps.scrubIdentity", "scrubIdentity(text, secrets)",
    "Takes who the user is out of the report text: each secret the caller passes, and anything shaped like an email, a JWT or a Google API key.",
    ["Secrets under four characters are ignored. Each pattern runs only where its anchor occurs (`@`, `eyJ`, `AIza`): the email pattern has no literal prefix and would otherwise walk every digit run of the geometry."],
    D)
add("rps.encodeText", "encodeText(s)",
    "A string as UTF-8 bytes: `TextEncoder` where there is one, else a hand-written encoder sized by `byteLen`.",
    ["-"])
add("rps.reportId", "reportId()",
    "A report id: the ISO time with `:` and `.` as `-`, and six random base-36 characters.",
    ["-"])
add("rps.baseUrl", "baseUrl(host, base)",
    "The report server's origin: `base` when given, else port 3001 on `host` or on the host that served the page.",
    ["So a phone on the LAN posts to the machine it loaded the app from."])
add("rps.post", "post(url, body, fetchFn)",
    "One POST of bytes to the report server with a 60 s timeout, answered as `{ ok, j }` or `{ ok: false, why }` in words.",
    ["Never throws: a refusal carries the status and the server's `error`, an abort says the server did not answer in 60 s, anything else that the server is not reachable."])
add("rps.sendDevReport", "sendDevReport(E, opts)",
    "The Report button's path: build, one stringify with identity scrubbed, gzip off the main thread, POSTed in parts, then the whole drawing when asked.",
    ["In order: `buildReport` (with this module's console tail), a `drawing` summary when the opt-in plans parts (`drawingPlan`), one `JSON.stringify` through `scrubIdentity`, the raster section's `\"reportBytes\":null` hole filled with the body's byte size, UTF-8 bytes, `compression().gzip` (the raw bytes if that throws), then POSTs of at most 8 MB each (`PART_BYTES`) as `kind=json`. Returns what happened with each stage's ms; `onStage` gets the button's label.",
     "A send that fails saves the gzip as a file (`saveFile`) unless `download` is false. The whole drawing (`sendDrawing`) goes only after the report has landed.",
     "`tools/report-server.js` refuses a part over 32 MB."],
    D)
add("rps.sendDrawing", "sendDrawing(plan, { ... })",
    "Sends the whole drawing's planned parts, one task each: encode as a kobin-2 chunk, gzip, POST as `kind=drawing`.",
    ["Yields before each part and releases its natives once encoded; the first part that fails to encode or post stops the rest and says why. Records the encode time in total and the longest, and the bytes before and after gzip."],
    D)
add("rps.saveFile", "saveFile(u8, name)",
    "Saves bytes as a download through a temporary object URL; returns the name, or null where there is no page to save from.",
    ["-"])
add("rps.replayReport", "replayReport(E, opts)",
    "The harness's loader: fetches a report from the report server (by name, or the newest) and loads it into `E`, with its whole drawing when it has one.",
    ["The drawing's part files are found through the server's `/list` entry for the report and gunzipped by name (`.gz`) before `loadReport`. Exposed as `window.__kobinReport.replayReport` for the second-engine harness."],
    D)


# ---- src/hooks/useKobinEngine.js ----
add("hok.rasterFromUrl", "rasterFromUrl(href)",
    "Decides the session's renderer from the URL: raster by default, SVG under `?svg` or an explicit `?raster=0`.",
    ["Reads the query wherever it is, in the hash (where the router keeps it) or the search. `svg=0`, `false` or `off` does not gate, and a bare `?raster` decides nothing. Both names must end at `&`, `#` or the end of the URL, so `?svgExport` or `?rasterWorkers` decide nothing.",
     "Read once, at construction: the renderer owns a canvas, a plate cache and a worker pool, so the dev panel's control rewrites the URL (`hrefWithRaster`) and reloads."],
    "§9")
add("hok.hrefWithRaster", "hrefWithRaster(href, on)",
    "The same URL with the `?svg` gate cleared (`on` true) or set (`on` false), where the query already lives.",
    ["Removes every `svg` and `raster` parameter and any `?` or `&` left dangling, then appends `svg` at the end, which is inside the hash route when there is one. The dev panel's renderer control uses it and reloads."],
    "§9")


# Existing descriptions of functions in this batch's files that are now FALSE.
FIX = {
    "hok.useKobinEngine": {
        "why": "says autosave is OFF (`LOCAL_AUTOSAVE` false); it is on, into IndexedDB and the kobin-2 store, with a restore, a sync session's controls and the raster renderer chosen by `rasterFromUrl`. The fn cell's `storageKey` parameter is now `canvasId`, beside `gated` and `onRefused`.",
        "fn": "useKobinEngine({ canvasId, onAutosave, gated, onRefused })",
        "what": None,
        "long": ["Mounts the engine into a host element with the renderer `rasterFromUrl` chooses, wires pointer, wheel, pinch, resize and keyboard input to it, owns every piece of tool and style state, and runs the local autosave into the kobin-2 store (DESIGN.md §13).",
                 "**Status is throttled to 50 ms, except zoom.** A React re-render of the whole editor per pointer event costs about twelve milliseconds, which a gesture cannot afford. Zoom changes are flushed immediately anyway, because the scale HUD reads them and a coalesced burst would make the bar skip a rung.",
                 "**Autosave** (`LOCAL_AUTOSAVE`, the kill switch, is on): a write waits 1.5 s behind the last change and never more than 8 s from the first, and flushes on tab hide, pagehide and unmount. It appends the op log's entries, snapshots only the frames an undo, redo or move forced or whose entries have outgrown their snapshot (64 KiB or a quarter of it), and compacts the log to a floor under every snapshot, the undo and redo stacks and every pending mark. A failed write keeps its entries and forced frames, is not retried for the same document state until its backoff lapses (8 s to 256 s), and shows in `saveError` and the report's errors.",
                 "**One writer (SYNC-PLAN R2).** With `gated` (the editor) the engine starts read-only and the saver closed until the sync session opens them. Every store write carries the tab's token (`setWriter`); a write the store refuses as `fenced` or `stale` closes the saver, keeps the work in memory and calls `onRefused`. For the session it returns `setReadOnly` (a gesture in progress ends as a pen-up would), `setSaving`, `flushSave`, `idle`, `hasUnsaved`, `keepUnsaved` (the document in memory saved as a new canvas), `knownSeq`, `reloadFromStore` (with `keepCamera` when following another tab or device; resolves the ms it took), `refreshMetaFromStore` (a header-only write followed without a reload: the name, the scale and scene names) and `cloudPushSource`, which reads the local store, never the live document. `onAutosave` says whether a write moved data, so a follower can tell the two apart.",
                 "The document comes back asynchronously (`loadCanvasStore`: snapshots through `loadDrawing` without a render, then the log replayed) and is rendered a task later (`renderLoaded`), so the load and a cold render are not one long task (STALL, 2026-09-23); `engineReady` waits for both. A store that will not decode is copied into the bin (`backupCanvasDoc`, awaited) before the first autosave may write over it.",
                 "Two pointers are a pinch. A stroke under 400 ms old when the second finger lands is cancelled rather than finalised, because it was the first finger arriving and not a mark; a blur or a hidden tab ends any gesture in progress as a pen-up would."],
    },
    "hok.now": {
        "why": "says it times the three parts of a save; the save now times two (serialise and write, `serMs` and `putMs`), and the same clock runs the debounce ceiling, the failure backoff and the store reload's timing",
        "what": None,
        "long": ["The saver's one clock: its serialise and write timings, the debounce ceiling, the failure backoff and the store reload's duration all read it."],
    },
}

# Functions that looked mid-edit (another agent is writing them): described as they stand.
FLUX = [
]
