# -*- coding: utf-8 -*-
"""Per-function entries for the shell's components and pages, and the last few
module-local helpers inside the engine."""

E = {}


def add(key, fn, what, long, ref="§13"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ------------------------------------------------------------------- routing
add("app.App", "App()", "The router: seven routes, four of them developer-only.",
    ["Hash routing, because the app is served as static files and a hash route needs no server rewrite for every depth of URL.",
     "The canvas route is KEYED on the canvas id, so moving between canvases remounts the editor and with it the engine and its autosave slot. Without the key React reuses the element and the second canvas opens inside the first one's engine."])

# ---------------------------------------------------------------- components
add("brd.BrandLogo", "BrandLogo({ to })", "The wordmark, linking home.", ["-"])
add("btn.Button", "Button({ variant, size, ... })", "The one button.",
    ["Class names only - there is no component library here. Everything visual lives in one stylesheet, which is what keeps the whole shell a few kilobytes."])
add("inp.Input", "Input({ className, ... })", "The one text input.", ["-"])
add("sci.SciText", "SciText({ text })",
    "Renders Unicode superscript exponents as real markup.",
    ["**A typographic bug fix, in a component.** The engine emits exponents as Unicode superscript characters, and fonts draw the Latin-1 ones and the U+2070 block from different designs - so an exponent like 37 comes out with mismatched size and baseline.",
     "It rewrites each run of superscript characters as plain digits inside a styled `sup`, where one design applies to all of them. The engine keeps emitting plain text and knows nothing about this."])
add("cmp.Dialog", "Dialog({ open, onOpenChange, ... })", "The modal shell.",
    ["Dismisses on Escape, and on a click that BOTH started and ended on the overlay. Testing only where the click ended means selecting text inside the dialog and releasing outside it closes it, which loses whatever was being typed."])
add("cmp.DialogHeader", "DialogHeader", "Header slot.", ["-"])
add("cmp.DialogTitle", "DialogTitle", "Title slot.", ["-"])
add("cmp.DialogDescription", "DialogDescription", "Description slot.", ["-"])
add("cmp.DialogFooter", "DialogFooter", "Footer slot, where the buttons go.", ["-"])
add("cmp.DialogContent", "DialogContent", "Body slot.", ["-"])
add("cpp.ColorPickerPopover", "ColorPickerPopover({ ... })", "The custom-colour popover.",
    ["Converts through `toHex` on the way in, because a stroke may carry an `rgb()` colour from the default pen and the picker only speaks hex."])
add("fam.FileActionsMenu", "FileActionsMenu({ ... })",
    "Download, export, open, duplicate, delete.",
    ["Every item closes the menu itself rather than relying on the click-away, so an action and a dismissal cannot race."])
add("sdd.SaveDrawingDialog", "SaveDrawingDialog({ ... })", "Names a canvas on its first save.",
    ["Re-seeds its field from the live title each time it opens. The component stays mounted, so the initial state goes stale the moment the canvas is renamed anywhere else."])
add("sdb.ScaleDragBar", "ScaleDragBar({ a, b, label, dashed })",
    "The line you drag when declaring a real-world length.",
    ["Dashed while dragging, solid once the length is pending in the dialog - so the two states of the gesture are visibly different without any text."])
add("sup.membershipTableRows", "membershipTableRows(units, excludeUnit)",
    "Rows of full name and symbol, for the picker's table mode.", ["-"])
add("sup.ScaleUnitPicker", "ScaleUnitPicker({ ... })", "The HUD's unit picker.",
    ["Chips until a rung has more units than a chip row can carry, then a full-name table - because a dozen two-letter symbols is not a menu anybody can read.",
     "The full catalogue only appears at the very last rung; every rung before it shows membership names, which are shorter and more useful."])
add("sup.ScaleUnitButtonGrid", "ScaleUnitButtonGrid({ ... })",
    "The set-scale dialog's unit grid.",
    ["The same rung machinery as the picker, with its own plan - it starts at the everyday span, because someone declaring a length is almost never working in parsecs."])
add("wop.WidthOpacityPanel", "WidthOpacityPanel({ ... })", "Width, and opacity when there is one.",
    ["One component for the pens and for the eraser; the eraser passes no opacity handler and the control simply is not there."])
add("aps.useAnchorPopoverStyle", "useAnchorPopoverStyle(anchorRef, open, gap, key, opts)",
    "Places a fixed popover against its anchor, inside the viewport.",
    ["Clamps rather than flips: a tall popover slides down over its anchor instead of running off the top of a phone.",
     "Recomputes on resize and on scroll in the capture phase, so a popover anchored to something inside a scrolling panel tracks it."])
add("cka.useClickAway", "useClickAway(onAway, ...extraRefs)",
    "Closes a popover on an outside click.",
    ["Capture phase, so it runs before the click reaches whatever it landed on.",
     "Takes extra refs, which is how a popover can treat its own opening button as 'inside' - otherwise close-then-toggle reopens it and the button feels stuck."])
add("hom.HomeV2", "HomeV2()", "The marketing page.",
    ["Three claims and a way in. It is the only page that does not touch the engine."])
add("hom.Feature", "Feature({ icon, title, text })", "One feature row.", ["-"])
add("nfd.NotFoundPage", "NotFoundPage()", "404.", ["-"])
add("gal.PopMenu", "PopMenu({ onClose, children })",
    "The gallery's dropdown.",
    ["Its click-away deliberately ignores its own anchor, leaving the dismissal to the button's own toggle. Handling both makes the menu close and immediately reopen, which reads as a stuck button."])

# ------------------------------------------------- small helpers in the engine
add("lm.cellKey", "cellKey(i, j)", "A child map's key.",
    ["Two integers as a string. The child map is keyed by cell index rather than searched, which is what makes re-entry a lookup."], "§2")
add("lm.LevelMap", "LevelMap", "The box lattice itself.",
    ["Owns the boxes, their cells and edges, and the pure transforms between them. No camera, no objects, no rendering."], "§2")
add("lm.LevelMap._centre", "_centre(key)", "One box's centre in its parent's units.",
    ["An exact integer, and the reason a descent is exact: subtracting it BEFORE scaling makes the magnification a power of two on numbers that are already commensurate."], "§2")
add("rnd.perfRendererNow", "perfRendererNow()", "Monotonic time for the render budget.", ["-"], "§9")
add("rnd.selAntScale", "selAntScale(inkPx)",
    "Shrinks the marching ants for thin ink.",
    ["The design file's band is a fixed width, which buries a three-pixel mark under its own indicator. Below a reference width the whole dash pattern scales down together.",
     "The floor is the speck's own band, so the ants never get thinner than the thing they collapse into - which also removes a discontinuity, because as a mark shrinks past being traceable the band it had is the band its speck gets."], "§9")
add("rnd.Renderer", "Renderer", "The only class that touches Two.js.",
    ["Owns the SVG scene, one persistent group per object, the per-frame diff, the per-level scene subtrees, and the selection overlay."], "§9")
add("ts.TileStore", "TileStore", "The bidirectional tile cache.",
    ["Keyed by box. Everything shown from another level comes through here, and nothing else caches derived geometry."], "§6")
add("arc.norm", "norm(d)", "An angle into a single turn.", ["-"], "§4")
add("shp.wrap", "wrap(d)", "An angle into a single turn.",
    ["The same helper as `arcPerimeter`'s, separately defined - the two modules do not import each other's private arithmetic."], "§5")
add("shp.bbHit", "bbHit(a, b)", "Do two boxes overlap?",
    ["The cheap rejection that makes the boolean cost what the GESTURE costs rather than what the drawing costs: a loop whose box misses the other shape entirely is passed straight through untouched."], "§5")
add("shp.magOf", "magOf(b)", "The largest coordinate magnitude in a box.",
    ["What the rounding scale is measured from. Taking it from the wrong box is the mistake that welded an object into 68 open chains."], "§5")
add("bia.drawFlat", "drawFlat(a, flatTol)", "Should this arc be DRAWN as a line?",
    ["Separate from whether it IS a line. The geometry holds an arc of any radius happily; canvas and SVG rasterise in float32, where a centre a few million units away cannot place its own rim to better than a unit.",
     "An arc that bows less than the tolerance is a line on screen anyway, so drawing it as one costs nothing and avoids handing the rasteriser a number it cannot hold."], "§4")
add("ply._mid", "_mid(a, b)", "The midpoint of two points.",
    ["De Casteljau's only primitive."], "§7")
add("frz.wrap", "wrap(d)", "An angle into a single turn.", ["-"], "§3")
add("cvo.sub", "sub(a, b)", "Vector difference.", ["-"], "§7")
add("cvo.addv", "addv(a, b)", "Vector sum.", ["-"], "§7")
add("cvo.mulv", "mulv(a, k)", "Vector times a scalar.", ["-"], "§7")
add("cvo.hyp", "hyp(v)", "Vector length.", ["-"], "§7")
add("cvo.perp", "perp(v)", "The left normal.", ["-"], "§7")
add("cvo.unit", "unit(v)", "The unit vector, or null for a zero one.",
    ["Returning null rather than a NaN vector is what lets the offset fitter detect a degenerate segment and borrow a neighbour's direction instead of propagating garbage."], "§7")

# ------------------------------------------------------------------- odds
add("col.toHex", "toHex(c)", "A colour as hex, whatever form it arrived in.",
    ["The colour picker only speaks hex; a stroke may carry an `rgb()` string from the default pen."])
add("reportWebVitals.reportWebVitals", "reportWebVitals(onPerfEntry)",
    "Create React App's web-vitals hook.",
    ["Boilerplate, and inert - it is called with no callback, so it never even loads the library."])
