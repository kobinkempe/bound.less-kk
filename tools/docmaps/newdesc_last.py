# -*- coding: utf-8 -*-
"""The last thirteen: the top-level classes, the pages, and a few helpers."""

E = {}


def add(key, fn, what, long, ref=""):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


add("eng.KobinEngine", "KobinEngine", "The facade the whole app talks to.",
    ["Wires the box lattice, the document, the camera, the tile cache and the renderer together and routes input to whichever one owns it.",
     "It was 3,506 lines and owned everything - the pen, the bake scheduler, the erase pipeline, severance, selection, scenes, the selection-indicator geometry and four instrument classes. It is 855 now; the rest moved into six files that are mixed back onto this prototype, so they are still its methods and still run with `this` bound to the engine.",
     "What is left here is roughly the shape of a gesture: construction, the compat accessors, the tool and style setters, the perf log, the render pipeline, pan and zoom, pointer input, undo and redo.",
     "Its quasi-private surface is pinned by a contract test, which is what made the split a safe refactor rather than a rewrite - the test was the thing that could tell whether a method had gone missing."], "§8")
add("erp.ErasePipeline", "ErasePipeline", "The eraser and the resumable bake behind it, as a mixin.",
    ["Never instantiated. Its prototype is copied onto KobinEngine's, so every method here runs with `this` bound to the engine.",
     "A class rather than an object literal because that made the split a MOVE: every method arrived byte-identical, comments and indentation included, with no reformatting for a reviewer to read past. `mixin.js` says why `Object.assign` cannot do the copying."], "§6")
add("ovl.Overlays", "Overlays", "The selection indicator and the erase debug view, as a mixin.",
    ["Everything the engine draws that is not ink. Same mixin arrangement as ErasePipeline."], "§9")
add("sel.Selection", "Selection", "Selecting, hit-testing and dragging, as a mixin.",
    ["Same mixin arrangement as ErasePipeline."], "§7")
add("sco.SceneOps", "SceneOps", "Auto-scenes, as a mixin.",
    ["Same mixin arrangement as ErasePipeline."], "§10")
add("fil.Files", "Files", "The two save formats, as a mixin.",
    ["kobin-1, which is what the app writes, and dev-0, which is what the diagnostic report carries. Same mixin arrangement as ErasePipeline."], "§11")
add("mix.mixin", "mixin(target, ...protos)",
    "Copies a mixin class's methods onto another prototype, and refuses to overwrite one.",
    ["`Object.assign` copies nothing here: class prototype methods are non-enumerable, so it would silently produce an engine with no methods. Descriptors also carry getters and setters intact, which a value copy would invoke and flatten.",
     "It throws when two files claim the same name, which is the check that keeps the six files honest - a method duplicated during a move fails the very first test that builds an engine, rather than shadowing its twin."], "§8")
add("now.perfNow", "perfNow()", "Monotonic time, falling back to the wall clock.",
    ["One definition for the whole engine, so every measurement in a report is on the same clock."], "§8")
add("rmt.latticeStep", "latticeStep(rect)",
    "One step of the integer lattice a boolean would round to, at this rect's scale.",
    ["Chosen from the largest magnitude in play, which is what the polygon library does internally.",
     "It matters because 'this vertex sits ON the window's edge' has to be judged at that step and not at float epsilon: at a parent's own scale one step is about a thousandth of a unit, which is three whole units - hundreds of screen pixels - down among its children."], "§5")
add("rmt.rectTol", "rectTol(r)", "Twice the lattice step: the tolerance a contact is judged at.",
    ["Used wherever the engine asks whether ink reaches a tile edge. Deriving it from the rect rather than fixing it is what makes the answer mean the same thing at every depth."], "§5")
add("rmt.rectSpan", "rectSpan(r)", "The larger side of a rect, never zero.",
    ["The denominator that turns an absolute tolerance into the normalised perimeter units contacts are compared in."], "§5")
add("ovl.mergeSpans", "mergeSpans(list, gap)",
    "Merges overlapping or nearly touching spans into the fewest runs.",
    ["Used on the screen-edge ants: a shape with several fingers of ink touching the top of the view produces several spans, and drawing each separately would put a gap between marks that are visually one run."], "§9")
add("cam.Camera", "Camera", "The view transform and the crossing state machine.",
    ["Owns the active box, the in-box zoom and the pan. Everything about WHERE you are looking; nothing about what is there."], "§2")
add("doc.Document", "Document", "The source of truth.",
    ["Every native object, the id counter that doubles as z-order, the undo stacks, and the per-box spatial index. No rendering, no camera, no tiles.",
     "Its change events carry the OLD footprint as well as the new one, which is what lets the tile cache invalidate both where an object was and where it now is - the guarantee that makes stale-tile ghosts impossible rather than merely rare."], "§3")
add("doc.LevelIndex.remove", "LevelIndex: remove(o)",
    "Takes an object out of the spatial index.",
    ["Uses the box recorded when it went IN, not its current one. An object that has moved would otherwise be removed from the cells it now occupies and left behind in the ones it used to."], "§3")
add("sks._asc0", "_asc0(a, b)", "Ascending sort comparator.", ["-"], "§17")
add("edt.CanvasEditor", "CanvasEditor()", "THE PRODUCT.",
    ["The tool rail, the scenes panel, the scale HUD and the set-scale flow, six dialogs, three banners, the save pipeline, the cloud pull, the presence heartbeat, and the developer panel behind `?dev`.",
     "The parts worth knowing: the save path serializes independently of whether the local write succeeded, so a full browser storage cannot take the cloud down with it; the cloud-dirty flag is driven off DOCUMENT CHANGES rather than off a successful local save, for the same reason; and the save notice is dismissible per KIND, so waving away 'autosave is off' does not also silence a real failure later."], "§13")
add("edt.ScaleValueDialog", "ScaleValueDialog({ ... })",
    "'This length equals...' - where a drag becomes a real-world scale.",
    ["The one place a drawing is connected to physical units. Its unit grid walks the same rung machinery as the HUD picker, starting at the everyday span."], "§14")
add("gal.CanvasesV2", "CanvasesV2()", "THE GALLERY.",
    ["Sign-in, the local and cloud listings merged by freshest timestamp, a one-way catch-up upload of canvases the account has not seen, tombstone propagation so a deletion elsewhere reaches this browser, rename, duplicate, download, delete, the recycle bin, and file import.",
     "The merge is the interesting part and it is deliberately asymmetric: a canvas this device has and the account does not is uploaded, but a canvas the account has TOMBSTONED is not - otherwise a stale device would resurrect everything anyone had deleted."], "§13")
add("gal.PopMenu", "PopMenu({ onClose, children })",
    "The kebab menu, as one component used by every row and by the page header.",
    ["Renders its children in a small floating panel and closes on an outside click or on Escape.",
     "It exists because the gallery has two kinds of menu - one on the page, one per canvas - and the close behaviour is the part that is easy to get subtly wrong twice."], "§13")
