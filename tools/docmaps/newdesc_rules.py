# -*- coding: utf-8 -*-
"""The eighteen membership rules of scaleBar/logicRule.js.

Each rule is one named idea about which units are worth offering. The rungs in
`rungs.js` are ordered lists of these objects, so a rule can move between rungs
without any of them changing - which is the configurability the specification
asks for, and the reason there are eighteen small classes here rather than one
long function with eighteen branches.
"""

E = {}


def rule(cls, fn, what, long, rung):
    """A rule class and its evaluate, as one Code Map row and two graph nodes."""
    key = "lrl." + cls
    E[key] = {"fn": cls + "<br>evaluate(ctx)", "what": what, "ref": rung,
              "long": long}
    E[key + ".evaluate"] = {"fn": cls + ".evaluate(ctx)", "what": what,
                            "ref": rung, "long": long}


def add(key, fn, what, long, ref="§14"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# ---- the helpers the rules are built on ------------------------------------
add("lrl.autoShowUnit", "autoShowUnit(ladderId, mpp, discard)",
    "What would this ladder show here, asked of a clean session?",
    ["A probe on a hypothetical session, with the user range and the incumbent discarded, so the answer is what the LADDER would do rather than what the current state happens to be doing.",
     "This is what makes the first rung of the picker useful: the most valuable alternatives to the unit you are looking at are the units the neighbouring ladders would have chosen for the same view."])
add("lrl.ladderUnitsReadingBetween", "ladderUnitsReadingBetween(ladderId, mpp, lo, hi)",
    "Units whose reading here would fall inside a numeric range.",
    ["A rung expressed as 'anything that would read between 0.1 and 500'. It catches useful units that no adjacency rule reaches, because a ladder's spacing is uneven and 'two rungs away' means very different things in different parts of it."])
add("lrl.unitsBetween", "unitsBetween(names, loUnit, hiUnit)",
    "The units between two named sizes, inclusive.",
    ["How the set-scale dialog's first rung is written - 'millimetre to mile' rather than a list that would have to be maintained."])
add("lrl.allLadderUnion", "allLadderUnion()",
    "Every unit on any ladder.",
    ["The last rung, and the honest end of pressing 'more'."])

add("lrl.LogicRule", "LogicRule<br>evaluate(ctx)",
    "The base of a membership rule: evaluate(ctx) returns unit names.",
    ["Rungs are DATA - ordered lists of these objects, in `rungs.js` - so a rule can be moved between rungs, or retuned by changing a constructor argument, without touching either the rule classes or the level machinery.",
     "The context a rule is given is small on purpose: the current unit, the current ladder, the metres per pixel, and the session. A rule that needed more than that would be reaching past its own job."])
E["lrl.LogicRule.evaluate"] = E["lrl.LogicRule"]

# ---- rung 6a: the immediate neighbourhood ----------------------------------
rule("RelatedLadderAutoShow", "evaluate(ctx)",
     "The unit each neighbouring ladder would show at this zoom.",
     ["The single most useful thing to offer, and the reason it is first: if you are reading metres and wondering what else this could be, the answer an imperial ladder would give is more interesting than the next rung up your own.",
      "Probes each related ladder on a clean session, so what comes back is that ladder's own opinion rather than an echo of yours."],
     "§14 rung 6a")
rule("CurrentLadderAuto", "evaluate(ctx)",
     "What this ladder would show with the reader's preferences discarded.",
     ["Two instances sit in the first rung, one discarding just the user range and one discarding every preference.",
      "It answers 'what would this have been if I had not asked for anything', which is exactly the option a reader wants when they are trying to undo a pick they no longer want."],
     "§14 rung 6a")
rule("CurrentLadderWithinFactor", "evaluate(ctx)",
     "Units on this ladder within a size factor of the current one.",
     ["Fifty times either way, which on these ladders is roughly the useful neighbourhood - close enough to be a sane alternative, far enough to cross a rung or two where the spacing is fine."],
     "§14 rung 6a")

# ---- rung 6b: widen -------------------------------------------------------
rule("AnyLadderAuto", "evaluate(ctx)",
     "The unit EVERY ladder would show at this zoom.",
     ["The same probe as the related-ladder rule, run across all five. It is a rung further out because most of those answers duplicate each other, and the ones that do not are genuinely exotic."],
     "§14 rung 6b")
rule("RelatedWithinFactor", "evaluate(ctx)",
     "Units on neighbouring ladders within a size factor of the current one.",
     ["The neighbourhood rule, applied sideways. This is where the imperial equivalents of a metric reading show up."],
     "§14 rung 6b")
rule("CurrentLadderReadingBand", "evaluate(ctx)",
     "Units on this ladder whose reading here would be a sensible number.",
     ["'Sensible' is 0.1 to 500, which is the range a person can read at a glance without counting digits.",
      "Expressed in terms of the reading rather than of the unit's size, so it adapts to the zoom automatically."],
     "§14 rung 6b")

# ---- rung 6c: further out --------------------------------------------------
rule("AnyLadderReadingBand", "evaluate(ctx)",
     "The same sensible-number rule, across every ladder.",
     ["The widest form of 'would this read nicely here', and the last rung before the picker starts offering whole inventories."],
     "§14 rung 6c")
rule("CurrentLadderNeighbors", "evaluate(ctx)",
     "Two rungs up and two down on this ladder.",
     ["Adjacency rather than size. Where a ladder's spacing is very uneven this reaches things the factor rule does not, and vice versa - which is why both exist."],
     "§14 rung 6c")
rule("RelatedLadderNeighbors", "evaluate(ctx)",
     "One rung up and one down on each neighbouring ladder.",
     ["Narrower than the same rule on your own ladder, because a neighbour's adjacent rungs are a weaker recommendation than your own."],
     "§14 rung 6c")

# ---- rung 6d / 7b: whole inventories ---------------------------------------
rule("AllUltraStandard", "evaluate(ctx)",
     "Every ultra-standard unit, metric and imperial.",
     ["The curated selection: the units almost everybody knows, with the specialist ones (yards, mils, light-days, the body radii) deliberately left out.",
      "It is the second rung of the set-scale dialog and a late rung of the picker, and in both places it is the point at which the answer stops being 'what suits this zoom' and becomes 'here is the standard set'."],
     "§14 rung 6d / 7b")
rule("NamedUnits", "evaluate(ctx)",
     "An explicit list of units.",
     ["An escape hatch, parameterised by its constructor. It carries the kiloparsec into a rung that would otherwise miss it, and it is the rule to reach for when a single unit needs to appear somewhere the general rules do not reach."],
     "§14 rung 6d")
rule("NoSiPrefixUnits", "evaluate(ctx)",
     "Every catalogue unit that is not an SI-prefixed derivative.",
     ["The bodies, the imperial units, the astronomical ones, the metre and the Planck length: everything with a name of its own rather than a prefix on somebody else's.",
      "A good late rung because it is short and every entry in it is memorable, where the prefixed units are numerous and interchangeable."],
     "§14 rung 6d")
rule("AllUnits", "evaluate(ctx)",
     "Everything registered on any ladder.",
     ["The end of 'more'. Past this point there is nothing left to offer, and the picker says so by not showing the button."],
     "§14 rung 6e / 7d")

# ---- set-scale rungs -------------------------------------------------------
rule("UltraStandardBetween", "evaluate(ctx)",
     "Ultra-standard units between two named sizes.",
     ["The set-scale dialog's first rung, millimetre to mile.",
      "Someone declaring 'this line is one inch' is working at human scale essentially always, and starting the dialog at parsecs would make the common case scroll."],
     "§14 rung 7a")
rule("AllLaddersBetween", "evaluate(ctx)",
     "Any-ladder units between two named sizes.",
     ["The same idea widened to every ladder, micrometre to kiloparsec - the span in which a person might plausibly be declaring a real-world length."],
     "§14 rung 7c")
rule("CurrentLadderNoSiPrefix", "evaluate(ctx)",
     "The named units of the current ladder, when there is one.",
     ["Returns nothing when no ladder is set, which is the state the set-scale dialog is in the first time it opens."],
     "§14 rung 7c")
rule("CurrentLadderSiPrefixedMeters", "evaluate(ctx)",
     "The prefixed metre units, on the true-metric ladder only.",
     ["The one ladder that carries every SI prefix, and the only place offering all of them is useful rather than overwhelming."],
     "§14 rung 7c")
