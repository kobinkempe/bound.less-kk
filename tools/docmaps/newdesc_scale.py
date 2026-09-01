# -*- coding: utf-8 -*-
"""Per-function entries for the scale bar — the fifteen modules of scaleBar/.

One entry carries BOTH the Code Map's one-line "what it does" and the
comprehensive explanation the graph and the expandable row show, so the two
documents cannot drift apart.

  key   the graph node id (module.function), matching graph.py's vocabulary
  fn    how the row names it
  what  the Code Map cell — one sentence, present tense
  ref   design reference, or ""
  long  the comprehensive explanation, list of paragraphs; **bold** is allowed
"""

E = {}


def add(key, fn, what, long, ref="§14"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---------------------------------------------------------------- catalog.js
add("cat.buildRungs", "buildRungs(defs)",
    "Turns a chain of size ratios into absolute unit sizes.",
    ["Walks a ladder definition and multiplies out its `ratioFromPrev` chain into real metre values.",
     "It anchors on the Planck length rather than on the metre. The definitions are written as ratios between neighbours because that is how the sizes are actually known and checked ('an inch is 25.4 mil'), and anchoring at the bottom means the smallest units — where the exponent is most extreme — are exact by construction rather than by division."])
add("cat.safeLog10Meters", "safeLog10Meters(meters)",
    "log10 of a size, without throwing at the ends of the float range.",
    ["Returns negative infinity rather than NaN for a size that has underflowed to zero, so a unit at the very bottom of the catalogue degrades to 'unimaginably small' instead of poisoning every comparison it takes part in."])
add("cat.registerUnit", "registerUnit(rung)",
    "Files one unit in the shared registry, first definition winning.",
    ["Every ladder is built independently but they share units — a metre is a metre on all of them — so the first ladder to define one fixes its physical size and later ladders adopt it.",
     "That is what keeps the ladders commensurable: two ladders can disagree about which units they *contain* and can never disagree about how big one is."])
add("cat.repairLogFactors", "repairLogFactors()",
    "Recomputes every log size once the whole registry exists.",
    ["A pass over the finished registry, replacing each unit's log size with one taken from its linear size wherever that is finite.",
     "The Planck chain is then overwritten with exact exponents from a table. Those units are separated by powers of a thousand, and multiplying the ratios out accumulates error at exactly the end of the range where there is least room for it; stating the exponents directly costs twelve lines and removes the question."])
add("cat.getUnit", "getUnit(name)", "One unit's record, or null.",
    ["The registry lookup everything else goes through."])
add("cat.unitMeters", "unitMeters(name)", "How big one unit is, in metres.",
    ["Null for an unknown name, which is how `validateScaleDef` rejects a saved scale naming a unit this build does not have."])
add("cat.unitLog10Meters", "unitLog10Meters(name)",
    "The unit's size as a log, which is what the resolver actually works in.",
    ["Soft-fails to NaN on a hot path rather than throwing. Every caller is inside a resolve that runs on each frame of a zoom, and one unknown unit should cost one reading, not the session.",
     "Falls back to computing the log from the linear size if the cached one is not finite."])
add("cat.allCatalogUnits", "allCatalogUnits()",
    "Every registered unit, smallest first.",
    ["Sorted by log size, so the picker's full table reads from the Planck length up to the largest parsec multiple without any per-caller sorting."])
add("cat.prefixNameForShort", "prefixNameForShort(short)",
    "'k' to 'kilo'.",
    ["The SI prefix table, read backwards, for building a full display name."])
add("cat.capitalizeWord", "capitalizeWord(s)", "Capitalises a word.",
    ["Used only for assembling full unit names."])
add("cat.unitFullName", "unitFullName(name)",
    "The human name for a unit: 'Kilometer', 'Astronomical Unit', 'Quecto-Planck Length'.",
    ["Assembled from the unit's kind rather than tabulated, so adding a prefixed unit needs no new name.",
     "Named exceptions come from a small table first — the bodies and the astronomical units have real names that no rule would produce.",
     "This is what makes the picker's *table* mode readable: at the point where there are too many units to show as chips, showing symbols alone would be a wall of two-letter codes."])
add("cat.allUnitsTableRows", "allUnitsTableRows()",
    "Every unit as a name / symbol / size row, for the full table.",
    ["The last rung of the unit picker, when the reader has asked for everything."])
add("cat.hasSiPrefix", "hasSiPrefix(unit)",
    "Does this unit carry an SI prefix?",
    ["Distinguishes a derived unit (km, nm) from a named one (inch, parsec, Planck length), which is what the picker's later rungs partition on."])
add("cat.isNoSiPrefix", "isNoSiPrefix(unit)", "The negation, as a named rule.",
    ["Exists as its own function because it *is* a membership rule — `NoSiPrefixUnits` is built directly on it — and reading `filter(isNoSiPrefix)` says what the rung means."])

# ------------------------------------------------------------- membership.js
add("mem.rungsFromNames", "rungsFromNames(names)",
    "Builds a ladder from a list of unit names, refusing an unknown one.",
    ["The ultra-standard ladders are written as name lists, because they are curated selections rather than ratio chains — they omit units on purpose (no yards, no mils, no light-days).",
     "**Throws on an unknown name.** A ladder is configuration, and a typo in it should stop the build rather than produce a ladder quietly missing a rung."])
add("mem.rungsFromBuilt", "rungsFromBuilt(built)",
    "Adapts an already-built ratio chain into ladder rungs.",
    ["The three ratio-chain ladders come out of `buildRungs` with their sizes already resolved; this only reshapes them and pulls each unit's log size from the shared registry so every ladder measures with the same numbers."])
add("mem.ladderForStack", "ladderForStack(ladderId)",
    "The rungs of one ladder, falling back to true-metric.",
    ["The fallback matters: an unknown ladder id should still produce a usable bar rather than nothing at all, and true-metric is the one ladder that covers the whole range with no gaps."])
add("mem.unitRank", "unitRank(name, ladderOrId)",
    "Where a unit sits on a ladder, or -1.",
    ["Rank is used as a stable tie-break in the resolver, so two candidates that are equally good by every real measure still resolve in a fixed order rather than by object iteration order."])
add("mem.laddersOwning", "laddersOwning(unit)",
    "Every ladder that contains this unit, most preferred first.",
    ["A unit can belong to several ladders — a metre is on four of them — and which ladder a pick switches you to depends on this order."])
add("mem.stackForUnit", "stackForUnit(unit)",
    "The ladder a unit belongs to when nothing else decides.",
    ["The highest-priority owner. This is how setting a scale in inches puts you on an imperial ladder without the dialog having to ask which one."])
add("mem.highestPriorityLadder", "highestPriorityLadder(ladderIds)",
    "Picks the most preferred of several ladders.",
    ["Priority is a fixed list, not a score. Where two ladders would both show the unit you asked for, the answer should not depend on how the candidates happened to be collected."])
add("mem.floorUnit", "floorUnit(ladderId)", "The smallest unit on a ladder.",
    ["Half of the fallback when no ordinary stop fits — see `extremeCandidates`."])
add("mem.ceilingUnit", "ceilingUnit(ladderId)", "The largest unit on a ladder.",
    ["The other half."])

# ------------------------------------------------------------- preference.js
add("pref.bandFor", "bandFor(ladderId, unit)",
    "The magnitudes a unit is preferred to display in, on this ladder.",
    ["The heart of the whole thing, and it is DATA rather than code: a table of per-ladder overrides over one default band of 1 to 500.",
     "It is per (ladder, unit) because the same unit is preferred over different ranges on different ladders — on the ultra-imperial ladder a mile is preferred from a quarter, on standard imperial from a half — and the reason is that the ladder decides what the neighbouring rungs are and therefore what the mile has to cover."])
add("pref.bandLogInterval", "bandLogInterval(ladderId, unit)",
    "The same band as a log-length interval.",
    ["The band is written in display magnitudes because that is how a person states it ('mm from 1 to 5'); everything downstream compares log lengths. This is the conversion, and it is done once per lookup rather than per candidate."])
add("pref.extraNiceFor", "extraNiceFor(ladderId, unit)",
    "Extra round numbers a particular unit is allowed, beyond 1/2/5.",
    ["Exists for exactly one case, and states it: the ultra-imperial ladder needs a quarter-mile, because the gap between a mile and a foot is too large for the ordinary grammar to fill sensibly."])

# --------------------------------------------------------- preferenceRange.js
add("prng.PreferenceRange", "PreferenceRange",
    "A 'this unit is preferred over this span' object.",
    ["The base of the two range kinds. A range knows its unit, its span in log space, and its priority.",
     "Making this an object rather than a pair of numbers is what let the resolver stop caring which kind of preference it was looking at: it asks each candidate which range claims it and at what priority, and the two subtypes differ only in the answer."])
add("prng.PreferenceRange.contains", "contains(logLen, eps)",
    "Is this log length inside the span?",
    ["With a relative epsilon, because the two ends of the span are computed from a unit size and a magnitude and will not land on exact values."])
add("prng.PreferenceRange.claims", "claims(stop)",
    "Does this range claim a candidate stop?",
    ["The base rule — right unit, inside the span. Both subtypes refine it."])
add("prng.PreferenceRange.kind", "kind", "What kind of range this is.",
    ["Reported in a reading's `reason`, so a bar can say why it chose what it chose."])
add("prng.StandardPreferenceRange", "StandardPreferenceRange",
    "The specification's own preferred band for a (ladder, unit).",
    ["Constructed from display magnitudes and carries them, because that is what it claims on."])
add("prng.StandardPreferenceRange.claims", "claims(stop)",
    "Claims a stop whose NICE VALUE is inside the band.",
    ["Deliberately not the log-length test the base class uses. A standard band is a statement about the number a person reads — 'a millimetre reading should be between 1 and 5' — so it is checked against the displayed value, not against the physical length."])
add("prng.StandardPreferenceRange.kind", "kind", "'standard'.", ["—"])
add("prng.UserPreferenceRange", "UserPreferenceRange",
    "The range installed when the reader picks a unit the rule would not have chosen.",
    ["Outranks every standard range and holds its unit for as long as the span lasts.",
     "Its span is not tabulated: it runs from where the reader is now to the edges of where the unit would NATURALLY be chosen, found by scanning the resolver itself (`autoSpanForUnit`). So picking a unit extends its natural territory to include where you are standing, rather than pinning it forever."])
add("prng.UserPreferenceRange.claims", "claims(stop)",
    "Forces its unit for any of its stops inside the span.",
    ["Bounded on purpose. Outside the span the automatic rule resumes, while the range stays installed — so zooming out of it and back in shows the unit again."])
add("prng.UserPreferenceRange.shouldClear", "shouldClear()",
    "Never. Zoom does not tear down a user's choice.",
    ["Always false, and kept as a method so the caller does not have to know which kind of range it is holding.",
     "This is the whole of constraint 5: a range installed by a person persists until that person does something else. An earlier design cleared it when the reading left the span, which meant zooming out and back in silently discarded a deliberate choice."])
add("prng.UserPreferenceRange.toJSON", "toJSON()",
    "The persistable form.",
    ["Unit, ladder, and the two log bounds — enough to rehydrate, and nothing that would go stale."])
add("prng.UserPreferenceRange.kind", "kind", "'user'.", ["—"])
add("prng.toUserRange", "toUserRange(obj)",
    "Rehydrates a stored plain object into a real range.",
    ["A session may arrive from React state or from a saved document as a plain object; every consumer wants the class. One conversion point rather than a defensive check at each use."])

# ------------------------------------------------------------------ ladder.js
add("lad.Ladder", "Ladder",
    "One of the five ladders, as an object that can answer for itself.",
    ["Owns its rungs in ascending physical order, its priority, its related ladders, and its per-unit preferred bands.",
     "The resolver, the rung plans and the pick logic ask a Ladder rather than threading a ladder id through free functions. The physical truth still lives in the catalogue and the band data still lives in `preference.js` — this exposes them as methods so there is one source and one caller shape."])
add("lad.Ladder.relatedIds", "relatedIds", "The ladders this one is adjacent to.",
    ["Used by the picker's first rung: the units the ladders *next door* would show at this zoom are the most useful alternatives to offer."])
add("lad.Ladder.names", "names", "Every unit name on the ladder.", ["—"])
add("lad.Ladder.has", "has(unit)", "Is this unit on the ladder?", ["—"])
add("lad.Ladder.rankOf", "rankOf(unit)", "Its position, or -1.", ["—"])
add("lad.Ladder.floorUnit", "floorUnit()", "The smallest rung.", ["—"])
add("lad.Ladder.ceilingUnit", "ceilingUnit()", "The largest rung.", ["—"])
add("lad.Ladder.neighbors", "neighbors(unit, up, down)",
    "The rungs immediately above and below a unit.",
    ["A picker rung: whatever else is offered, the next unit up and the next one down are almost always what a reader wants."])
add("lad.Ladder.unitsWithinFactor", "unitsWithinFactor(unit, factor)",
    "Every rung within a size factor of this one.",
    ["'Within fifty times' is a rung of the picker, and it is a better neighbourhood than 'the next two rungs' on a ladder whose spacing is uneven."])
add("lad.Ladder.bandFor", "bandFor(unit)", "The preferred band, from the data table.",
    ["A pass-through, so a caller holding a Ladder never has to reach for `preference.js` and pass the id back in."])
add("lad.Ladder.extraNiceFor", "extraNiceFor(unit)", "Extra round numbers for a unit.",
    ["The same pass-through, for the quarter-mile."])
add("lad.Ladder.preferenceFor", "preferenceFor(unit)",
    "The unit's standard preferred range, as an object.",
    ["Wraps the band data in a `StandardPreferenceRange` so the resolver can ask one question of both kinds of preference."])
add("lad.Ladder.candidatesAt", "candidatesAt(mpp)",
    "Every legal bar this ladder could show at this zoom.",
    ["The generator the whole resolution runs on. For each rung it works out which round numbers of that unit would produce a bar between the minimum and maximum pixel width, and emits one candidate stop per number.",
     "All of it in log space, and every extreme guarded: a rung whose magnitudes fall outside the float envelope is skipped rather than allowed to produce an infinity.",
     "It lives here rather than in the resolver so that the dependency runs one way — the resolver imports the ladder, the ladder never imports the resolver."])
add("lad.ladder", "ladder(id)", "The shared Ladder for an id.",
    ["One instance per ladder, created once. The rung lists and the rank maps are built in the constructor, and a resolve happening on every frame of a zoom should not rebuild them."])
