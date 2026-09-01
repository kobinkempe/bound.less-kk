# -*- coding: utf-8 -*-
"""Where the outside world enters the system.

An entry point is a function called by the BROWSER, by REACT, or by a person
pressing something - not by another function in this graph. Those are the
places to start reading, and until now the page named only the six that were
hand-picked when the graph covered 255 functions.

This finds them from the source rather than from judgement, in four ways:

  pointer / keyboard   a call made inside a handler registered with
                       addEventListener("pointerdown", ...) and friends. The
                       handler is a function-local const, so it is found by
                       name and its body taken by brace matching.
  ui                   a call inside a JSX handler prop - onClick={...},
                       onChange={...}. A button press.
  route                a component React mounts for a route.
  lifecycle            a callback handed to setTimeout, setInterval,
                       requestAnimationFrame, or an Observer.

A call is attributed only when the method name resolves to exactly one
function, which is the rule extract.py already uses: an entry that cannot be
pinned down is left out rather than guessed at.

NOTE ON MASKING. An earlier version ran the source through `extract.strip_noise`
first, which deletes string bodies outright - so `addEventListener("pointerdown",
down)` became `addEventListener(, down)` and not one pointer entry was ever
found. `mask()` below replaces string and comment characters with spaces
instead, keeping every offset, so a name can be matched on the raw text while
braces are counted on the masked text.
"""
import io, os, re, json, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import graph

# The files that hold the outside edge of the app. Geometry is never an entry.
SHELL = ["hok", "edt", "gal", "app", "hom", "nfd",
         "cpp", "fam", "sdd", "sdb", "sup", "wop", "aps", "cka", "cmp", "btn",
         "inp", "sci", "brd"]

POINTER = ("pointerdown", "pointermove", "pointerup", "pointercancel",
           "wheel", "mousedown", "mousemove", "mouseup", "click", "dblclick",
           "gesturestart", "gesturechange", "touchstart", "touchmove",
           "touchend", "contextmenu")
KEYBOARD = ("keydown", "keyup", "keypress")
LIFECYCLE = ("resize", "beforeunload", "visibilitychange", "blur", "focus",
             "error", "unhandledrejection", "message", "online", "offline",
             "pagehide", "storage")
NOT_A_COMPONENT = {"Router", "Route", "Switch", "Redirect", "Routes", "Link",
                   "Fragment", "StrictMode", "Navigate"}
# The receiver has to BE the engine. Without this, `pointers.has(id)` on a Map
# resolved to scaleBar/ladder's `has` and `pointers.set(...)` to `Camera.set` -
# three built-in calls presented as entry points into the engine.
# `engineRef.current.setTool(...)` is how the hook reaches the engine, so the
# receiver token is `current`.
ENGINE_RECEIVERS = {"engine", "eng", "E", "current"}
DEBUG = bool(os.environ.get("DOCMAP_DEBUG"))
RANK = {"pointer": 5, "keyboard": 4, "ui": 3, "route": 2, "lifecycle": 1}


# The masker lives in its own module because `audit_isolated` needs it too and
# cannot import this one: importing `graph` (above) validates the entire
# hand-edge list and raises if anything has moved, which is exactly the moment a
# refactor needs the audits to run. See _mask.py for why masking beats stripping.
from _mask import mask


def body_from(masked, i):
    """(start, end) of the handler body beginning at or after i.

    A braced body is the balanced `{...}`. A CONCISE arrow body has no braces
    at all - `const gesturePrevent = (e) => e.preventDefault();` - and simply
    hunting for the next `{` runs straight into the following function. That
    happened: `gesturePrevent` swallowed `onKey`, so every keyboard entry was
    reported as a pointer entry. Stop at the `;` that ends the statement.
    """
    depth, k, n = 0, i, len(masked)
    while k < n:
        c = masked[k]
        if c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == "{" and depth <= 0:
            d, j = 0, k
            while k < n:
                if masked[k] == "{":
                    d += 1
                elif masked[k] == "}":
                    d -= 1
                    if d == 0:
                        return (j, k + 1)
                k += 1
            return (j, n)
        elif c == ";" and depth <= 0:
            return (i, k)
        k += 1
    return (i, n)


def main():
    data = json.load(open(os.path.join(HERE, "data", "graphdata.json")))
    U = data["universe"]
    MODFILE = data["modfile"]

    byname = collections.defaultdict(list)
    for m, names in U.items():
        for nm in names:
            byname[nm.split(".")[-1]].append(m + "." + nm)

    ENGINE_MODS = ("eng", "erp", "ovl", "sel", "sco", "fil")

    def resolve(meth):
        """The engine wins outright - `engine.pointerDown()` is not ambiguous.
        Otherwise only a name unique across the codebase is accepted.

        The engine is SIX FILES since the 2026-08-31 split (one prototype,
        `engine/mixin.js`), so `engine.deleteSelection()` is `sel.` and
        `engine.loadDrawing()` is `fil.` - checking only `eng.` lost them."""
        for m in ENGINE_MODS:
            if m + "." + meth in graph.NODES:
                return m + "." + meth
        hits = [h for h in byname.get(meth, []) if not h.startswith("v0.")]
        return hits[0] if len(hits) == 1 else None

    entries = {}

    def mark(node, kind):
        if node and (node not in entries or RANK[kind] > RANK[entries[node]]):
            entries[node] = kind

    call_re = re.compile(r'([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(')

    for mod in SHELL:
        rel = MODFILE.get(mod)
        path = os.path.join(REPO, rel or "").replace("\\", "/")
        if not rel or not os.path.exists(path):
            continue
        raw = io.open(path, encoding="utf-8", errors="replace").read()
        msk = mask(raw)

        def calls_in(span, kind):
            if not span:
                return
            for c in call_re.finditer(msk[span[0]:span[1]]):
                recv, meth = c.group(1), c.group(2)
                if recv not in ENGINE_RECEIVERS:
                    continue
                mark(resolve(meth), kind)

        # ---- 1. addEventListener("evt", handler) -------------------------
        # matched on RAW, because the mask blanks the event name
        for m in re.finditer(r'addEventListener\(\s*["\']([a-z]+)["\']\s*,\s*([A-Za-z_$][\w$]*)', raw):
            evt, fn = m.group(1), m.group(2)
            kind = ("pointer" if evt in POINTER else
                    "keyboard" if evt in KEYBOARD else
                    "lifecycle" if evt in LIFECYCLE else None)
            if not kind:
                continue
            # THE NEAREST DEFINITION BEFORE THE LISTENER, not the first in the
            # file. `down`, `move` and `up` are generic enough that the first
            # match was often a different variable, and the body taken from it
            # swallowed the rest of the file - which is why every keyboard
            # entry was showing up as a pointer entry.
            defs = [d for d in re.finditer(
                r'\b(?:const|let|var|function)\s+' + re.escape(fn) + r'\b', msk)
                if d.start() < m.start()]
            if defs:
                calls_in(body_from(msk, defs[-1].start()), kind)

        # an inline listener: addEventListener("pointerdown", (e) => { ... })
        for m in re.finditer(r'addEventListener\(\s*["\']([a-z]+)["\']\s*,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>', raw):
            evt = m.group(1)
            kind = ("pointer" if evt in POINTER else
                    "keyboard" if evt in KEYBOARD else
                    "lifecycle" if evt in LIFECYCLE else None)
            if kind:
                calls_in(body_from(msk, m.end()), kind)

        # ---- 2. JSX handler props: a button press ------------------------
        for m in re.finditer(r'\bon[A-Z][A-Za-z]*\s*=\s*(?=\{)', msk):
            calls_in(body_from(msk, m.end()), "ui")

        # ---- 2b. a method handed to a child as a callback prop -----------
        # `onWidthChange={engine.setEraserSize}` is a button press waiting to
        # happen; there is no call syntax, so the call scanner cannot see it.
        for m in re.finditer(
                r'\b[a-zA-Z]\w*\s*=\s*\{\s*(?:engine|eng|E)\.([A-Za-z_$][\w$]*)\s*\}', msk):
            mark(resolve(m.group(1)), "ui")

        # ---- 2c. an effect the interface drives --------------------------
        # `useEffect(() => { engineRef.current.setTool(tool); }, [tool])` is
        # the toolbar: a button sets React state, the effect pushes it into the
        # engine. A DEPENDENCY-FREE effect is mount work, which is lifecycle.
        for m in re.finditer(r'\buseEffect\s*\(', msk):
            span = body_from(msk, m.end())
            if not span:
                continue
            tail = msk[span[1]:span[1] + 60]
            deps = re.search(r'\[\s*([^\]]*)\]', tail)
            kind = "ui" if (deps and deps.group(1).strip()) else "lifecycle"
            if DEBUG:
                sys.stderr.write("effect %s %s %r\n"
                                 % (mod, kind, msk[span[0]:span[0] + 46]))
            calls_in(span, kind)

        # ---- 3. timers and observers ------------------------------------
        for m in re.finditer(r'\b(?:setTimeout|setInterval|requestAnimationFrame'
                             r'|new\s+\w*Observer)\s*\(', msk):
            calls_in(body_from(msk, m.end()), "lifecycle")

    # ---- 4. the routed components -------------------------------------
    # <Route path="/x"><BakeLab/></Route> and <Route element={<X/>}> both
    app = os.path.join(REPO, MODFILE["app"]).replace("\\", "/")
    asrc = io.open(app, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'<\s*([A-Z][\w$]*)', asrc):
        name = m.group(1)
        if name in NOT_A_COMPONENT:
            continue
        for cand in [n for n in graph.NODES if n.split(".")[-1] == name]:
            mark(cand, "route")

    print("entry points found: %d\n" % len(entries))
    for k in ("pointer", "keyboard", "ui", "route", "lifecycle"):
        names = sorted(n for n, v in entries.items() if v == k)
        print("---- %s (%d)" % (k, len(names)))
        for i in range(0, len(names), 3):
            print("     " + "  ".join("%-32s" % x for x in names[i:i + 3]))
        print()
    json.dump(entries, open(os.path.join(HERE, "data", "entries.json"), "w"),
              indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
