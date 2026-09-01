# -*- coding: utf-8 -*-
"""Every new per-function entry, merged, plus where each one belongs.

An entry carries BOTH the Code Map's one-line "what it does" and the
comprehensive explanation the expandable row and the graph panel show, so the
two documents are generated from one source and cannot drift apart.
"""
import newdesc_scale, newdesc_scale2, newdesc_rules, newdesc_shell
import newdesc_ui, newdesc_oracle, newdesc_last

E = {}
for m in (newdesc_scale, newdesc_scale2, newdesc_rules, newdesc_shell,
          newdesc_ui, newdesc_oracle, newdesc_last):
    E.update(m.E)

# The long descriptions, keyed exactly as the graph keys its nodes.
LONG = {k: v["long"] for k, v in E.items() if v["long"] and v["long"] != ["-"]}

# --------------------------------------------------------------------------
# Which Code Map article each module's entries go in, in reading order.
# (id, heading, role sentence, css class, [module keys])
# --------------------------------------------------------------------------
ARTICLES = [
    # ---- the scale bar, one article per module -----------------------------
    ("sb-catalog", "scaleBar/catalog.js",
     "Physical truth only: how big each unit is, what it is called, how it prefixes. No ladders, no bands, no rungs.",
     "mu", ["cat"]),
    ("sb-membership", "scaleBar/membership.js",
     "Which units belong together, in what order, and which ladder wins when several own a unit.",
     "mu", ["mem"]),
    ("sb-preference", "scaleBar/preference.js",
     "The magnitudes each unit is preferred to display in — data, per ladder and unit.",
     "mu", ["pref"]),
    ("sb-prefrange", "scaleBar/preferenceRange.js",
     "A preferred span as a first-class object. Two kinds, differing only in priority and in what counts as a claim.",
     "mu", ["prng"]),
    ("sb-ladder", "scaleBar/ladder.js",
     "One ladder as an object that answers for itself — including every legal bar it could show at a given zoom.",
     "mu", ["lad"]),
    ("sb-nice", "scaleBar/nice.js",
     "The round numbers a bar is allowed to show, and how a number is written down.",
     "mu", ["nic"]),
    ("sb-logmath", "scaleBar/logMath.js",
     "Everything on the log spine, so a range spanning sixty orders of magnitude is linear and nothing throws.",
     "mu", ["lmt"]),
    ("sb-resolve", "scaleBar/resolve.js",
     "The resolution: the lowest in-range number wins. One rule, replacing every handoff table the specification used to list.",
     "mu", ["rsv"]),
    ("sb-pick", "scaleBar/pick.js",
     "What a reader's unit pick does — switch ladders, or install a range whose edges are found by scanning the resolver.",
     "mu", ["pck"]),
    ("sb-session", "scaleBar/session.js",
     "The sticky per-canvas display state, and the guard that stops a stale result overwriting a fresh pick.",
     "mu", ["ses"]),
    ("sb-rungs", "scaleBar/rungs.js",
     "The picker's rungs: cumulative unions, with any rung that adds nothing skipped.",
     "mu", ["rng"]),
    ("sb-rules", "scaleBar/logicRule.js",
     "Eighteen named membership rules. The rungs are ordered lists of these objects, so a rule can move without either changing.",
     "mu", ["lrl"]),
    ("sb-format", "scaleBar/format.js · validate.js · index.js",
     "The visible label, the persisted definition, and the facade the editor calls.",
     "mu", ["fmt", "val", "sbi"]),
    # ---- the shell ---------------------------------------------------------
    ("sh-hook", "hooks/useKobinEngine.js",
     "The engine lifecycle the product uses: mount, input wiring, tool state, and the autosave loop that is currently switched off.",
     "mu", ["hok"]),
    ("sh-local", "storage/localCanvases.js",
     "The local gallery: slots, the index, the recycle bin, duplicate and rename, overwrite protection, thumbnails, and the migration off the single legacy slot.",
     "mu", ["loc"]),
    ("sh-thumbs", "storage/thumbnails.js",
     "Scene thumbnails — and the second engine that renders them, which is the most expensive thing the editor does.",
     "mu", ["thm"]),
    ("sh-cloud", "cloud/canvasSync.js",
     "Firestore: compress, chunk, commit in groups, and write the parent record LAST so a torn save never looks complete.",
     "mu", ["cld"]),
    ("sh-auth", "cloud/useUser.js · cloud/firebaseApp.js",
     "Sign-in, and the connection. Both lazy, so importing them starts nothing.",
     "mu", ["usr", "fba"]),
    ("sh-pages", "Pages · App",
     "The routes, the gallery, the editor. None of it holds geometry.",
     "mu", ["app", "edt", "gal", "hom", "nfd"]),
    ("sh-components", "Components",
     "The interface primitives. There is no component library here — everything visual is one stylesheet.",
     "mu", ["brd", "btn", "tbn", "inp", "sci", "cmp", "cpp", "fam", "sdd", "sdb",
            "sup", "wop", "aps", "cka", "col", "logoSmall", "reportWebVitals"]),
    # ---- not running -------------------------------------------------------
    ("nr-v0", "KobinEngineV0.js",
     "The retired god-class engine, kept as the golden oracle the extracted one is compared against. Not on any route.",
     "mu", ["v0"]),
    ("nr-curveperim", "geometry/curvePerimeter.js",
     "The cubic-pipeline perimeter resolve, superseded by the arc one. Kept as the independent implementation the arc tests cross-check against.",
     "mu", ["cvp"]),
    ("nr-strokeshape", "geometry/strokeShape.js",
     "The polyline Minkowski bake. Retired because chording the centerline creases every bend by an angle, and an angle does not shrink with zoom.",
     "mu", ["sks"]),
    ("nr-bakestrat", "geometry/bakeStrategies.js",
     "The three bake schedules — when the work happens, not how it is computed. Driven by the labs and by the cross-checking tests.",
     "mu", ["bks"]),
    ("nr-cede", "geometry/cede.js",
     "The float guillotine, superseded by the exact arc boolean. Three suites still use it to make test geometry.",
     "mu", ["ced"]),
    ("nr-erase", "__oracles__/erase.js",
     "What is left of the superseded “a cut is a recipe every bake re-runs” model.",
     "mu", ["ers"]),
    ("nr-testsupport", "__testkit__/scaleBar.js",
     "Fixtures and assertions for the scale-bar suites. Nothing in the app reaches them.",
     "mu", ["tsp"]),
]

# Entries that belong in an article that already exists in the pristine page,
# appended to it rather than given a section of their own.
APPEND_TO = {
    "frameLattice": [], "Camera": ["cam"], "LevelMap": ["lm"],
    "Document": ["doc"], "arcPerimeter": ["arc"], "arcShape": ["shp"],
    "biarc": ["bia"], "freeze": ["frz"], "clipperOutline": ["ply", "clb"],
    "curveOutline": ["cvo"], "TileStore": ["ts"], "Renderer": ["rnd"],
    # The engine is six files since the 2026-08-31 split, plus four small
    # shared pieces. They are one prototype, so they are one article.
    "engine-life": ["eng", "erp", "ovl", "sel", "sco", "fil",
                    "ins", "rmt", "mix", "now"],
}


def entries_for(mods):
    """Every entry whose key is in one of these modules, in insertion order."""
    out = []
    for k, v in E.items():
        if k.split(".", 1)[0] in mods:
            out.append((k, v))
    return out


# --------------------------------------------------------------------------
# SECTION-SCOPED keys, so an ambiguous leaf name resolves to the right entry.
# `wrap` exists in three modules and `bandFor` in two; enhance_codemap tries
# "@<article-id>.<name>" before it falls back to a bare-name map, so emitting
# these makes every row's lookup exact.
# --------------------------------------------------------------------------
SCOPED = {}
# scoped key -> the canonical `module.function` id, so a Code Map detail can be
# headed with the same name the call graph gives the node.
KEY_OF = {}


def body(v):
    """The explanation to show. A one-liner is still an explanation: an entry
    marked trivial falls back to its Code Map sentence rather than to nothing,
    so no function anywhere opens into a blank panel."""
    return v["long"] if (v["long"] and v["long"] != ["-"]) else [v["what"]]


# Explanations for functions the pristine page ALREADY has a row for, where
# the row used to be named after a sibling that has since gone. They are not in
# `E`, so they add no second row - only the missing explanation.
EXTRA = {
    ("LevelMap", "lm.framePointToScreen"): [
        "A point in one frame, in screen pixels.",
        "Two steps, and the split is the whole point: `mapPointF` carries the point into the ACTIVE frame - address arithmetic, exact, and independent of where the view happens to be - and only then does the in-frame zoom and pan turn it into pixels.",
        "It returns null rather than a guess when either frame id is unknown, because the caller is drawing an overlay and a wrong pixel is worse than no overlay.",
    ],
    ("biarc", "bia.tracePath"): [
        "Lay a resolved chain into a canvas path.",
        "Straight pieces and pieces whose sagitta is under `flatTol` go down as `lineTo`; everything else as `ctx.arc`, which rasterises the true arc rather than an approximation of it.",
        "`flatTol` arrives in world units from the caller, because the caller knows the zoom and this module deliberately does not. An arc of radius 5e17 that bows less than a pixel is a straight line to the eye, and drawing it as one keeps a number the rasteriser cannot hold out of the rasteriser.",
    ],
}

# Every entry, trivial ones included, keyed as the graph keys its nodes.
FULL = {k: body(v) for k, v in E.items()}
for (_aid, _k), _long in EXTRA.items():
    FULL[_k] = _long


def _scope(aid, mods):
    for k, v in entries_for(mods):
        leaf = k.split(".")[-1]
        for form in (leaf, k.split(".", 1)[1]):
            SCOPED["@" + aid + "." + form] = body(v)
            KEY_OF["@" + aid + "." + form] = k


for (_aid, _k), _long in EXTRA.items():
    SCOPED["@" + _aid + "." + _k.split(".")[-1]] = _long
    KEY_OF["@" + _aid + "." + _k.split(".")[-1]] = _k

for _a, _t, _r, _c, _m in ARTICLES:
    _scope(_a, _m)
for _aid, _mods in APPEND_TO.items():
    if _mods:
        _scope(_aid, _mods)
