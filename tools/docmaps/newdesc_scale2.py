# -*- coding: utf-8 -*-
"""Per-function entries, scale bar part 2: the resolution, the picks, the rungs."""

E = {}


def add(key, fn, what, long, ref="§14"):
    E[key] = {"fn": fn, "what": what, "ref": ref, "long": long}


# -------------------------------------------------------------------- nice.js
add("nic.formatSciValue", "formatSciValue(value)",
    "A number in scientific notation, with a real Unicode exponent.",
    ["Renormalises after rounding, so a mantissa that rounds up to ten becomes 1 with the exponent raised rather than being printed as 10x10^n.",
     "Emits superscript digits directly. `SciText` converts those to real markup at display time, because fonts draw the Latin-1 superscripts and the U+2070 block from different designs and an exponent like 37 comes out visibly mismatched."])
add("nic.formatScaleNumber", "formatScaleNumber(n)",
    "The displayed number: plain inside a sensible range, scientific outside it.",
    ["Thousands separators above a hundred, three significant figures below, and scientific notation outside 0.001 to 5000.",
     "The same function formats the zoom readout when no scale has been set, which is why an extreme zoom shows a power of ten rather than a fifteen-digit decimal."])
add("nic.formFor", "formFor(value)", "Plain or scientific, for one value.",
    ["One decision, made once, so the label and the candidate agree about which form the reading is in."])
add("nic.niceValuesForUnit", "niceValuesForUnit(unit, opts)",
    "The round numbers this unit may show, inside a window.",
    ["The 1/2/5 grammar, per decade, plus whatever extra values the ladder allows.",
     "**Inches are the one exception in the grammar.** Between .02 and 1 the decimals are suppressed and the fraction chain takes over - an eighth, a sixteenth, a thirty-second - because that is how inches are read. A quarter and a half come back as plain decimals, which is also how they are read.",
     "Never throws: a bad or inverted window returns nothing, and an exponent range too wide to enumerate is refused rather than looped over."])
add("nic.bestInBoundsNice", "bestInBoundsNice(unit, mpp, ...)",
    "The best round number for ONE unit at this zoom.",
    ["Quantises onto the unit you asked for rather than searching for a better one - that is the resolver's job, and this is used once the unit has already been decided, by a pick or by the extreme fallback.",
     "Scores by closeness to the bar's target width, in log space.",
     "Carries its own last-resort branch for the far ends of the range, where no ordinary candidate fits: the nearest 1/2/5 mantissa at the target exponent, bar clamped. A scale bar at the Planck length should be approximate rather than absent."])

# ----------------------------------------------------------------- logMath.js
add("lmt.log10", "log10(x)",
    "log10 that never returns NaN for a positive number.",
    ["The module exists because this engine measures from about 1e-35 metres to 1e27, and the ordinary way of writing these formulas gives out somewhere inside that range.",
     "Falls back through the natural log for subnormals, and clamps rather than returning an infinity that would propagate into everything downstream."])
add("lmt.safeExp10", "safeExp10(logX)",
    "Ten to the power, always finite and positive.",
    ["Clamped to about plus or minus 308 decades. Every conversion out of log space goes through it, so an extreme intermediate produces a very large or very small number rather than an infinity or a zero that would divide badly two lines later."])
add("lmt.targetLogLen", "targetLogLen(mpp)",
    "The log length of a bar of the target width at this zoom.",
    ["The single number the whole resolution is organised around: how long, in the world, the bar we would ideally draw is. Every candidate is scored by how close it comes to it."])
add("lmt.logLenFromNice", "logLenFromNice(niceValue, unit)",
    "The log length of 'this many of that unit'.",
    ["The log of the number plus the unit's log size - an addition rather than a multiplication, which is the point of working in log space at all."])
add("lmt.mppFromDef", "mppFromDef(scaleDef, effectiveZoom)",
    "Metres per pixel, from the saved scale and the current zoom.",
    ["The bridge between the drawing and the physical world, and the only place the two meet.",
     "Entirely in log space: the saved definition contributes a length, a unit and a bar width, the camera contributes a zoom ratio, and they are added and subtracted rather than multiplied and divided. At a zoom of 1e20 the direct form has already lost its meaning."])
add("lmt.barPxFromLogLen", "barPxFromLogLen(stopLogLen, mpp)",
    "How wide, in pixels, a given world length draws.",
    ["The inverse, used to check that a candidate actually fits between the minimum and maximum bar widths."])

# ----------------------------------------------------------------- resolve.js
add("rsv.pastIncumbentEnterEdge", "pastIncumbentEnterEdge(ladderId, unit, tLog)",
    "Has the zoom moved far enough past the current unit's band to justify changing?",
    ["The anti-flicker margin, about five per cent past the edge of the band, expressed additively in log space because a proportional margin is an addition there.",
     "It matters less than it once did. The resolution is a pure function of the zoom now - the pool is collapsed to one representative per unit before anything is ranked - so a cold resolve and a walked one agree by construction, and the wide preference bands do most of the anti-flicker work."])
add("rsv.candidatesOnLadder", "candidatesOnLadder(ladderId, mpp)",
    "Every legal bar on a ladder at this zoom.",
    ["A named export over `Ladder.candidatesAt`, kept because the tests and the picker rules read it directly."])
add("rsv.extremeCandidates", "extremeCandidates(ladderId, mpp)",
    "The fallback when nothing on the ladder fits.",
    ["Past the ends of a ladder - deep inside an atom, or out beyond the largest parsec multiple - no round number of any rung produces a bar of a sensible width.",
     "Rather than show nothing, it takes the floor or the ceiling rung, whichever the zoom is nearer, and quantises onto it with the bar clamped. The reading is then honest about the unit and approximate about the width, which is the right way round."])
add("rsv.readingFromStop", "readingFromStop(stop, mpp, reason)",
    "Packages a winning candidate as the reading the HUD renders.",
    ["Carries the reason it won - user band, standard band, prefer-one-or-more, or bounds fit - which is what makes the resolution explainable rather than magic."])
add("rsv.resolveReading", "resolveReading(mpp, session, opts)",
    "THE RULE: the lowest in-range number wins.",
    ["The centre of the scale bar, and what replaced a pile of hand-written handoff tables.",
     "**Collapse before ranking.** The pool holds many stops per unit; it is reduced to ONE representative per unit - the value that unit would actually show at this zoom - before anything is compared. That is what makes the comparison a comparison between UNITS rather than between values of one unit, and what makes the whole resolve a pure function of the zoom.",
     "**Then one rule.** A user's range wins if it claims a candidate. Otherwise a candidate inside its unit's preferred band beats one that is not. Among those, the LOWEST DISPLAYED NUMBER wins, where a value outside any band only counts if it is at least one. Ties break on closeness to the target bar width, then rank, then value.",
     "That single rule subsumes every handoff the specification used to list separately: 200 yd beats 500 ft because 200 is the lower number; a sixteenth of an inch beats 50 mil because a banded sub-one value still counts; one foot beats ten inches because both are outside a band and one is the lower value at or above one.",
     "**An all-sub-one pool pulls to the finest rung.** Below every band the honest reading is the smallest unit, not a fraction of a larger one."])

# -------------------------------------------------------------------- pick.js
add("pck.autoSpanForUnit", "autoSpanForUnit(ladderId, unit)",
    "Finds where a unit would NATURALLY be chosen, by scanning the resolver.",
    ["Sweeps sixteen decades of zoom, asking the automatic rule what it would show at each step, and records the span over which the answer is this unit.",
     "**Derived rather than tabulated, and that is the point.** The earlier design carried a table of far edges per unit which had to be maintained in step with the preference bands, and silently disagreed with them whenever one moved. Asking the resolver means the answer cannot disagree with the resolver.",
     "About four hundred probes, run once per pick - a human action - so the cost does not matter."])
add("pck.applyUnitPick", "applyUnitPick(pickedUnit, mpp, session)",
    "What happens when the reader picks a unit.",
    ["Two outcomes, and choosing between them is the whole design.",
     "**If some ladder would already show that unit here, just switch ladders.** Asking for inches where an imperial ladder would have shown inches is not an override, it is a change of system, and it should not install anything that has to be torn down later.",
     "**Otherwise install a user range.** The unit is quantised onto a legal round number and a range is installed spanning from where the reader is now out to the edges of the unit's natural territory. Zooming inside that span keeps the unit; outside it the automatic rule resumes; the range persists until another pick.",
     "A pick of a different unit tears down any existing range first, so the state cannot accumulate."])

# ----------------------------------------------------------------- session.js
add("ses.createSession", "createSession(ladderId)",
    "A fresh display session for a canvas.",
    ["Four fields: the sticky ladder, an optional user range, the incumbent unit for hysteresis, and the last reading for display. Nothing else is remembered between frames."])
add("ses.clearUserBandIfExited", "clearUserBandIfExited(session, mpp)",
    "Drops a user range that no longer has anything to claim.",
    ["A range whose unit has no in-bounds stop at all - you have zoomed past where that unit can be drawn - is spent, and holding it would keep re-asking a question that has no answer.",
     "Deliberately asymmetric: running off the fine end alone does not clear it. That is the sticky re-entry the specification asks for."])
add("ses.clearDisplayPrefs", "clearDisplayPrefs(prior, scaleDef)",
    "Resets every display preference, as setting or clearing the scale must.",
    ["The ladder comes from the anchor unit through ladder priority, so defining a scale in inches starts you on an imperial ladder.",
     "Only the scale dialog calls it. An ordinary metadata write must not, or renaming a canvas would silently discard the reader's unit choice."])
add("ses.withReading", "withReading(session, reading)",
    "Records what was just shown, for hysteresis and for the label.",
    ["Display-only bookkeeping. It never changes the ladder or the range, which is what keeps the resolution a function of the zoom rather than of the history."])
add("ses.shouldApplyScaleSessionWriteBack", "shouldApplyScaleSessionWriteBack(s, next, meta)",
    "Guards the write-back so a stale result cannot overwrite a fresh pick.",
    ["The reading is computed in a React memo and written back in an effect, so a result computed before a pick can arrive after it.",
     "It refuses any `next` that would wipe a live user range unless that `next` was computed from the current session. It fails closed when it cannot tell, because a stale unbanded result must never replace a deliberate choice."])

# ------------------------------------------------------------------- rungs.js
add("rng.evaluateRung", "evaluateRung(rules, ctx)",
    "Runs one rung's rules and unions their answers.",
    ["A rung is a list of `LogicRule` objects; this is the only thing that knows how to run one."])
add("rng.sortBySize", "sortBySize(units)",
    "Smallest to largest, non-finite sizes last.",
    ["The picker always reads in size order, whatever order the rules produced them in."])
add("rng.effectiveRungs", "effectiveRungs(plan, ctx, exclude)",
    "Turns a rung plan into the cumulative levels the reader steps through.",
    ["Each level is the union of every rung up to it, so pressing 'more' only ever adds.",
     "**A rung that adds nothing is skipped**, including a leading empty one. Otherwise 'more' would sometimes do nothing visible, which reads as a broken button."])
add("rng.popoverUnits", "popoverUnits(level, ctx)",
    "The units the HUD's unit picker offers at this rung.",
    ["Excludes the current unit - offering the reader what they are already looking at wastes the most valuable slot.",
     "Past a size threshold the display flips from chips to a full-name table, because a dozen two-letter symbols is not a menu anybody can read."])
add("rng.setScaleUnits", "setScaleUnits(level, ctx)",
    "The units the set-scale dialog offers at this rung.",
    ["A different plan from the popover's: it starts at the everyday span from millimetres to miles, because someone declaring 'this line is one inch' is almost never working in parsecs.",
     "Assigns no ladder. That happens on save, from the unit that was chosen."])

# ------------------------------------------------------------------ format.js
add("fmt.formatUnitSymbol", "formatUnitSymbol(unit)",
    "The unit's symbol, with the Planck subscript corrected.",
    ["One substitution, and it exists because the catalogue spells the Planck length with a letter that has no subscript form in the font stack."])
add("fmt.formatScaleLabel", "formatScaleLabel(reading)",
    "The visible label: the number, then the symbol.",
    ["Presentation only. Number grammar lives in `nice.js`; this assembles.",
     "Prefers whatever specialised label the reading carries - a fraction, or a scientific form - and falls back to formatting the raw value."])

# ---------------------------------------------------------------- validate.js
add("val.validateScaleDef", "validateScaleDef(raw)",
    "Accepts a saved scale definition, or rejects it whole.",
    ["Four fields and nothing else: a length, a unit, the bar width it was drawn at, and the zoom it was drawn at.",
     "Legacy `minUnit` fields from older documents are dropped rather than migrated. Preferred ranges replaced that mechanism entirely, so carrying them forward would preserve state nothing reads - which is worse than no state, because it looks meaningful."])

# ------------------------------------------------------------------- index.js
add("sbi.computeScale", "computeScale(effectiveZoom, scaleDef, session, opts)",
    "The facade: zoom in, reading out.",
    ["Three steps, and the order is the design. Convert the zoom to metres per pixel; tear down a user range that has nothing left to claim; resolve on the sticky session.",
     "Returns the session as well as the reading, because the resolve updates display-only fields, and the caller owns that state. The ladder and the range are never changed here - installing those belongs to a pick or to clearing the scale, both of which are human actions."])
