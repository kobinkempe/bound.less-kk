# Scale Bar Redesign — Opus Bible / Risk Review

**Status:** analysis only (docs; no implementation, no git).
**Authority:** [`../scale-bar-ruling-design-bible.md`](../scale-bar-ruling-design-bible.md) rules; [`../scale-bar-test-catalog.md`](../scale-bar-test-catalog.md) is the acceptance target.
**Inputs reviewed:** bible, test catalog, options 01–08, `ANALYSIS-finalists.md`, `ANALYSIS-validation-summary.md`, and a targeted skim of as-built `scaleBar.js` / `scaleBarLadders.js`.
**Scope:** independent risk review of the redesign proposals against the bible. This document does not amend the bible; it recommends what to freeze before coding.

---

## 1. Executive take

### Do I agree with the finalist framing?

**Yes, with one sharpening.** The finalist analysis is essentially correct and its self-correction (the validation summary) fixed the two things that mattered most:

1. **Enumeration ≠ visitation.** A complete candidate resolver guarantees `ft` *can win at the target mpp where policy says it should* — it does **not** guarantee `ft` is *seen* during a single coalesced jump whose target already lands in the `yd`/`mi` region. That distinction (target vs. trace) is the single most important undecided product question and it is currently ambiguous in the catalog.
2. **A half-open boundary is not hysteresis.** A pure function of `{mpp, ladderId, userRange}` will alternate whenever noisy zoom crosses a band edge. Q4 / `T-P-07` need overlapping enter/exit thresholds plus a retained incumbent — i.e. a small amount of durable state that the "stateless resolver" options (03, 06, and the 08 contract) do not actually carry as written.

The clustering is honest: **01/03/04/06/08 are one algorithm** (absolute resolve from mpp + session policy) presented five ways; **05 is the only genuinely different temporal model**; **02/07 are layering/config disciplines, not competing selection algorithms.** Recommending "hardened 03" as default and "05 + absolute oracle" as the alternative is the right shape.

### Would I propose a different design entirely?

**No new philosophy — but I would commit 03 to a concrete spine rather than leaving it as "lexicographic key over a candidate bag."** Option 03 is correct in spirit but under-specified in exactly the three places that will actually bite (numeric range, overlap/handoff resolution, hysteresis). Left abstract, every implementer re-derives them and drifts. My recommended instantiation collapses all three into one representation:

#### Sketch: "Hardened 03, concretized" — the log-length stop line

Model the whole problem as **1-D interval lookup on a logarithmic length axis**, not as candidate generation + scoring.

**Core coordinate.** Everything physical is carried as `L = log10(worldLength_meters)`. Zoom, anchor derivation, unit factors, bar bounds, and band edges are all expressed as additions/subtractions in log space. This is the honest fix for constraint 1: a raw JS float `meters` (what the as-built registry stores — `PLANCK_LENGTH_M * cumulative ratios`) overflows past ~`1e308` and underflows past ~`1e-308`, so "thousands of orders past `qℓP`/`Qpc`" is *not* actually safe today; but `log10` of that same quantity is a small, always-finite number. Log space makes the extreme-zoom requirement trivially safe without a full `ScaleMagnitude` decimal library (though Option 01's `ScaleMagnitude` is an equally valid, heavier way to get there).

**Core types.**

```text
Stop = {
  ladderId, unit, niceValue,      // one legal 1/2/5 (or inch-fraction / sci) reading
  logLen,                          // log10(niceValue * unitMeters)  — precomputed per unit×nice
  form: "plain" | "fraction" | "sci",
  label
}

// Per ladder, per unit: the preferred interval expressed in LOG-LENGTH space,
// derived once from §5 bands (min/max magnitude × unitMeters).
PreferBand = { ladderId, unit, logLo, logHi }   // may overlap neighbors on purpose

DisplayState = {
  ladderId,                        // sticky (F3/F4)
  userBand: { unit, logLo, logHi } | null,   // physical, log-length (survives zoom)
  incumbentUnit: string | null     // ONLY for hysteresis; droppable without changing target
}
```

**Resolve.** `targetLogLen = log10(BAR_PX_TARGET * mpp)`. Candidates are the Stops on the sticky ladder whose `barPx ∈ [min,max]` (a log-window around `targetLogLen`). Selection is the bible-4 order applied as interval containment, not weighted score:

1. user band contains `targetLogLen` and stop.unit === userBand.unit,
2. stop's standard `PreferBand` contains `targetLogLen`,
3. among band hits, the **incumbent** unit wins while `targetLogLen` is still inside its band widened by ε (this is the hysteresis; ε from overlap width, not a `minUnit` lock),
4. prefer lower displayed number ≥ 1 (with 0.5 mi / inch-fraction exceptions living inside the bands, so they are already resolved by step 2),
5. bar-target proximity, then stable ladder order.

**Why this is the right sharpening, not a new option:** it is Finalist A. But by fixing the coordinate to log-length and expressing every band as a log interval, three separate risk areas become one testable geometry problem: (a) constraint 1 is safe by construction, (b) overlapping bands (`200–500 yd` over `500 ft`; ultra `ft` → `mi`) are explicit interval overlaps with a documented winner, and (c) anti-flicker is "keep the incumbent while its widened interval still contains the point," which is real hysteresis with a droppable-for-correctness incumbent. It keeps 03's small core, adopts 07's catalog/membership/policy split, and uses 02's closed rung-predicate vocabulary — exactly the borrow list the analysis recommends.

### What I'd adopt and what I'd change

- **Adopt:** hardened Option 03 as the engine; Option 07's layer boundaries (catalog = physical truth, membership = inventories/priority/related, preference = bands/handoff/user-range lifecycle, presentation = rung recipes); Option 02's *closed* predicate registry for rungs; Option 08's contracts (`lastReading` optional, ladder id never re-derived per frame, split writers for meta vs. display session, mandatory coalesced tests); Option 01's numeric discipline (as log-length or `ScaleMagnitude`) and its **correct** cross-ladder pick resolver.
- **Change:** commit to **log-length coordinates** (or `ScaleMagnitude`) rather than raw float meters; add a **typed incumbent unit** to 03's `DisplayState` (03 as written cannot pass `T-P-07`); store **user ranges in physical/log space, never display magnitudes** (rules out 06/08's display-value ranges as written); fix 03/04/06's **rule-5 destination** to "highest-priority ladder *where the unit is auto-preferred*, else highest owner + user range" (03/04/06 as written check only the single highest owner); and **rewrite the ambiguous temporal catalog cases** (`T-F1-*`, `T-Z-*`) into explicit target-mpp matrices before deleting the old walk.
- **Do not adopt:** Option 04's *configurable* score order (it can silently reorder the bible's mandated preference stack), Option 02's additive weights and near/far pins/walk-cursor/bridge, and Option 05's mandatory transition traversal *unless* product declares trace semantics a real requirement.

---

## 2. Requirement-by-requirement risk matrix

Grouping key: **AR** = absolute-resolver family (01, 03, 04, 06, 08). **Walker** = 05. **Layer** = 02, 07. Options are called out individually where they diverge.

### Ladder priority (SM → SI → UM → UI → TM)

- **All designs:** encode priority as data — low risk. It only bites at cold start / multi-owner picks.
- **Unique risk (04):** priority is a *score component* (`ladderPriority`), and the score order is config-editable — a reorder could let priority override stickiness. Keep it strictly last and non-editable.
- **Walker (05):** priority only consulted on seed/pick; auto never changes ladder — clean.
- **Shines (01/07):** priority lives in one validated membership table with `ownersOf(unit)` sorted; least chance of drift.

### Related ladders

- **AR + Walker:** all treat "related" as a data table and compute 6a "auto-show" by running the resolver on the related ladder. Correct per Q3.
- **Shared risk (all):** the related-ladder probe must run on a **clean hypothetical session** (no current-ladder user range, no incumbent). 01 and 06 explicitly enumerate on the related ladder; the risk (flagged by the analysis) is leaking the live overlay — corrupts membership for shared units. 05 clones a walker onto the related ladder; same discipline needed.
- **Data risk (all):** the related table is directional and asymmetric (e.g. SM relates to UM/TM/SI; UI relates to UM/SI). `T-X-03` audits it. Low risk if validated at startup (01/02/07 do; 03/06/08 should).

### Ultra-standard ladders (+ absorption of `yd`/`mil`/`ld`/`R☉`/`R⊕`)

- **Walker (05) uniquely shines:** absorption falls out of the graph — omitted units simply have no `next`/`prev` node, so `µm→in`, `ft→mi`, `AU→ly` are automatic with no special-case bridge. This is the cleanest expression of Q2.
- **AR + Layer:** absorption = missing inventory + widened neighbor bands (ultra `km` 1–5000, ultra `ft` 2–5000, ultra `pc` 200–5000, ultra `ly` 1–5000). Correct, but two edits must stay in sync (omit from inventory *and* widen the neighbor band); 07 explicitly warns about this coupling. Data risk, not algorithm risk.
- **Sharp risk (all): ultra `ft` handoff.** `T-U-06`/`T-P-08` require `ft` preferred through **5000** and cutover to `mi` only when `1 mi` (or `0.5 mi`) is the better nice fit — "not at 2000 ft." But `1 mi = 5280 ft` and `0.5 mi = 2640 ft`, so between ~2640 ft and ~5280 ft the `ft` band (≤5000) and the `mi` band (0.5–1) **overlap**. Every AR design resolves this only if the overlap winner is explicitly encoded; a naive "prefer lower number ≥ 1" would flip to `0.5 mi` too early. This is the single most fragile band boundary in the bible. 03 names it (`HANDOFF_NOTES`); 04 hopes prefer-≥1 handles it (it does not, cleanly); 01/07 make it a per-ladder band with explicit edge. Freeze this boundary before coding.
- **Ultra ℓP floor (open item 10):** all designs default to "`ℓP` floor for ultra auto-walk, sub-ℓP only via all-units picker." Consistent; low risk but still an open bible item.

### Constraint 1 — Zoom accuracy at extremes

- **Root reality (grounding):** as-built stores `meters` as a raw JS float (`PLANCK_LENGTH_M × cumulative ratios`) and computes `barPx = meters / mpp`. This is finite for the *named* endpoints (`Qpc ≈ 3e46 m`, `qℓP ≈ 1e-65 m`) but **not** for "thousands of orders past" them. The bible's claim that current design is "acceptable on this axis" is optimistic — extremes are handled by sci-formatting on floor/ceiling units, not by the numbers actually surviving.
- **01 uniquely shines:** `ScaleMagnitude` (normalized significand + integer exponent) makes the requirement literally true end-to-end — *if* it also covers zoom/mpp derivation, not just candidate math (the analysis's correct caveat).
- **03/04/06/08:** all keep "same numeric path as as-built" and merely *assert* it is safe. As written they inherit the float ceiling/floor. **Risk: they do not actually satisfy constraint 1 beyond the named endpoints** unless they adopt log-length or `ScaleMagnitude`. This is the main reason my recommendation forces a coordinate decision.
- **02/05/07:** silent on numeric representation; inherit whatever the core uses. Same risk.

### Constraint 2 — Bar length bounds

- **All designs:** hard filter `barPx ∈ [MIN, MAX]` before selection — structurally sound, low risk.
- **AR shared edge case:** when rounding to 1/2/5 leaves *no* in-bounds candidate on a unit, need a defined fallback (nearest legal nice on the same unit / rank-adjacent). 01 (`chooseNearestBoundedCandidate`), 03 (`extremeCandidates`), 08 (§4.3 step 5 same-ladder rank expansion) all specify it; 04/06 imply it. Low risk if the grammar (not an ad-hoc list) generates candidates.
- **Walker (05):** bounds enforced per settle step; `BRIDGE_MAX_STEPS` fallback must still land in bounds — extra path to test.

### Constraint 3 — Nice 1/2/5 + plain `.001`–`5000` → sci

- **All designs:** move this into a `NiceNumberPolicy` / grammar with `PLAIN_MIN/MAX` constants. Uniformly low risk and a clear improvement over as-built special-casing.
- **Ceiling/floor unit risk (all):** the ceiling unit must hold plain through 5000 then sci on the same unit; ultra `pc` ceiling absorbs `kpc…Qpc`. Grammar-driven candidate generation handles it; an enumerated list would miss sci candidates (`T-R3-02`). All AR docs call this out.

### Constraint 3a — Inch fractions `1/8`,`1/16`,`1/32` → decimals at `.01`

- **All designs:** encode the fraction chain in the inch grammar; every doc explicitly adds `1/32` (fixes F8, which as-built lacks). Low risk.
- **Walker (05) note:** treats fractions as within-rung nice steps on `in`, then a demote edge to `mil`/`µm` — clean and matches `T-IN-*`.
- **Interaction risk (all):** user ranges can start inside the fraction region and end in the sci region (bible's own example `2×10⁻⁵ in`–`10 in`). A range spanning fraction→decimal→sci grammars must be stored in physical/log space, not "display magnitude on the unit," or the label grammar breaks mid-range (see §3 user-range coordinates).

### Constraint 4 — Auto preference (stay ladder → preferred range → prefer ≥1)

- **AR family:** this *is* their model — a lexicographic/interval selection. Naturally correct where bands are non-overlapping.
- **Overlap under-specification (AR shared, the central risk):** the bible deliberately overlaps bands (`ft` 2–500 and `yd` 200–500 both contain 200–500). A binary `standardBandHit` key does not decide the overlap; the tiebreak must. "Prefer lower number ≥ 1" *happens* to pick `200 yd` over `500 ft` (200 < 500), but this is coincidental and does **not** generalize (e.g. ultra `ft`/`mi` overlap needs `ft` to win up to ~5000 ft even though `0.5 mi` is a lower number). So the correct resolver needs an explicit per-handoff winner, not a generic numeric rule.
  - **03:** honest about this — adds `HANDOFF_NOTES`. Good.
  - **04:** **unique weakness** — leans on `preferGteOne` sub-encoding to resolve overlaps and exposes score *order* as config, so a reorder silently breaks the mandated stack (0.5 mi must beat 5000 ft only because mi's band is a hit; if order is edited, this inverts).
  - **01/07:** per-`(ladder,unit)` bands with explicit edges — cleanest; ultra `ft`→5000 and standard `ft`→500 coexist as separate rows.
  - **06/08:** correct model, but must add the explicit handoff winner they currently gesture at.
- **Walker (05):** local greedy promote/demote can differ from the global preference at overlaps — the analysis's key caution. Needs an absolute oracle to verify each transition lands on the bible winner.
- **"Prefer ≥ 1" exceptions (all):** `0.5 mi` and inch fractions are < 1 yet preferred. This *must* be resolved by band membership dominating the ≥1 test (0.5 mi is a band hit → wins before the ≥1 rule runs). Any design that puts `preferGteOne` above `standardBandHit` breaks it — another reason 04's editable order is risky.

### Constraint 5 — User overrides (rules 1/2/3, teardown, cross-ladder user range)

- **Rule-3 destination exactness (the sharp one):** rule 3 = "unit preferred on *another* ladder → switch only, no user range." Correct resolution is: **find all ladders where the picked unit is the auto-preferred unit at this mpp; if any, switch to the highest-priority of that subset with no range; else keep current if it owns the unit, else highest owner + install range.**
  - **01 uniquely shines:** `resolvePickDestination` does exactly this ("determines whether the picked unit is the preferred auto unit on any ladder … selects the highest-priority such ladder").
  - **03/04/06:** as written compute `dest = highest-priority owner` **first**, then test preferred-ness *on that dest only*. **Bug risk:** a unit can be auto-preferred on a lower-priority owner but not on the highest owner — these designs would wrongly install a user range (or switch to the wrong ladder). Must be fixed to 01's order. (`T-R5-01`, `T-R5-05`.)
  - **05:** `PickUnit` sketch has the same "highest-priority owner" shortcut and an admittedly fuzzy same-ladder branch (its own pseudocode says "usually rule 3 is cross-ladder … if same-ladder, treat as non-preferred") — needs the exact decision table.
  - **02/07:** delegate to a `classifyPick` / `applyUnitPick` helper; correctness depends on that helper implementing the exact table — flagged, not solved.
- **Teardown (all):** "change unit while inside the user range → tear down; ladder switch → tear down then maybe reinstall." Uniformly specified across designs; low risk once the destination logic is right. (`T-R5-03`, `T-R5-04`.)
- **User-range coordinate (AR split):** 01/03 store the range in **physical world-length/meters** (survives zoom, spans grammar regions) — correct. 06/08 store **display magnitudes on the unit** — the analysis correctly flags this as fragile; a range from `2×10⁻⁵ in` to `10 in` crosses fraction→decimal→sci, and display-magnitude storage plus zoom drift invites boundary bugs. **Change 06/08 to physical/log storage.**

### Constraint 6 — Popover rungs 6a–6e

- **All designs:** model rungs as ordered predicate lists, exclude current, sort small→large, skip empty, flip to table > 12. Structurally aligned; the differences are DSL richness.
- **02 shines** (closed predicate registry with a documented `type` per rule) and **06** (typed `RungRule` union) — most auditable. 03/04/07/08 use predicate-id lists (fine). 01 composes from a small vocabulary — good.
- **Cumulative-vs-replace ambiguity (bible gap, hits all):** 6c ("2 up/2 down current, 1 up/1 down related") is tiny in isolation, which strongly implies rungs are **cumulative** (each "more" adds to the union of prior rungs). 01/06 explicitly union with all lower rungs; others imply it. **The bible does not state this explicitly** — freeze it, because it changes when the > 12 table flip triggers (cumulatively you likely hit the table by 6c/6d).
- **Rung explosion (all):** 6d = "all ultra-standard units, `kpc`, and all non-SI-prefix units" — that is a large set (all bodies, all imperial, `AU/ly/pc/in/ft/yd/mi/mil/R☉/R⊕/ld`, …). It will almost always exceed 12 and flip to table. Not a bug, but the table-flip + trailing-"more" logic must be robust and tested at 6d/6e (`T-POP-6d-01`, `T-R6-03`). Also "non-SI-prefix" is under-defined (open item 8) — all designs default to a catalog-metadata predicate; 02/07 derive it from `family`/`siPrefixBase` (best), others from ad-hoc lists (drift risk).

### Constraint 7 — Set-scale rungs 7a–7d

- **All designs:** separate rung plan from popover, flip at > 22, save sets initial ladder by priority. Low risk; symmetric to constraint 6.
- **7c complexity (all):** "all ladders µm–kpc; + current-ladder non-prefix; + if true-metric current, SI-prefixed meters on that ladder." Conditional predicates (`when: has-current-ladder`, `when: current-is-true-metric`) — 02/06 model these explicitly; others must. Modest risk of a mis-scoped conditional. (`T-SET-7c-01`.)
- **Note:** the dialog has no live reading for 7a/7b, so those rungs are pure inventory filters — trivial for every design.

### Constraint 8 — Configurability

- **02/07 shine by construction** — this is their entire thesis (declarative tables + interpreters; catalog/policy/presentation split). `T-R8-01` (ultra `ly` 500→5000 as a one-cell edit) is trivially satisfied.
- **AR family:** all claim config-first and mostly deliver (bands, rungs, priority, related, nice = data). Risk is **degree**: 03/06/08 keep the core small but must ensure the resolver never hard-codes a band or handoff (03's `HANDOFF_NOTES` is the place this could leak into code). 01 has a validated policy schema — strong.
- **04 caveat:** configurable *score order* over-satisfies constraint 8 in a dangerous direction — it makes the mandated preference order editable, which the bible does **not** want editable. Configurability should cover constants/bands/rungs, not the constraint-4 ordering itself.
- **05:** bands/rungs as data, but the transition guards live in walker code — the part most likely to need a rewrite when retuning a handoff. Weakest on constraint 8 among the serious contenders.

### Constraint 9 — UX sameness

- **All designs:** explicitly out of engine scope; return the same HUD fields and chip/table picker shape via a thin adapter. Uniformly low risk *as designed*. The real constraint-9 risk is integration drift (a new field leaking a badge), caught only by a manual pass (`T-R9-01`) — not a design differentiator.

### Preferred ranges (as the anti-flicker mechanism, Q4)

- **This is where the stateless AR options are weakest.** Bible Q4 says preferred ranges *replace* `minUnit`, and `T-P-07` demands no flip-flop under noise near a handoff.
  - **03 (as written):** `DisplayState = { ladderId, userRange }` only — **no incumbent**. Its own §4.2 admits "half-open edges + widen the band if it chatters," but a memoryless boundary provably alternates under noise. **03 fails `T-P-07` without adding incumbent state** (the analysis's central correction, and correct).
  - **06:** offers optional `bandHysteresis.relative` — a widened stay-in-band margin. This is closer, but a relative margin *without an incumbent* still flips if noise exceeds the margin symmetrically; needs incumbent to pick which side to hold.
  - **08:** declares bands the "sole anti-flicker mechanism" per Q4 but carries `lastReading` as display-only and forbids it from unit choice — so **08 as written also lacks a hysteresis incumbent** and inherits 03's gap.
  - **04:** `continuity` is a *soft* component *below* the band key. At a hard band edge the band key differs, so continuity cannot hold the incumbent across the edge → **04's continuity does not provide edge hysteresis** either. Its `bandExitEpsilon` (default 0) is the real knob and starts disabled.
  - **02:** additive `STICKINESS` weight *does* provide hysteresis (incumbent gets a bonus), but additive weights across lexicographic tiers are exactly the "score soup" the bible is trying to leave — risk of the bonus leaking across preference tiers.
  - **05 (Walker) uniquely shines:** the current rung *is* the incumbent; "stay while stay-rescale is still in bounds and in band" is natural hysteresis with no extra concept. This is 05's strongest intrinsic advantage.
- **Verdict:** Q4 is under-served by every stateless option. The fix (a typed, droppable incumbent unit with overlap-derived enter/exit) is small and is exactly what my §1 sketch adds. **Freeze the enter/exit thresholds in the bible before coding** — Q4 is currently a requirement without numbers.

### UX sameness / picker parity (constraint 9, restated as membership)

- Covered above; the membership rules (6/7) are the behavioral surface. All designs keep chrome identical and only change *which units on which depth*. No design uniquely fails; 02/06/07 are easiest to audit because membership is fully declarative.

---

## 3. Cross-cutting risks

### Float / log magnitude

The as-built registry uses raw float `meters`. "Thousands of orders past `qℓP`/`Qpc`" is not float-safe; today it only *looks* safe because sci-formatting hides it on the ceiling/floor units. **Only Option 01 (via `ScaleMagnitude`) confronts this;** 03/04/05/06/07/08 assume the existing numeric path is fine and inherit its ceiling. Recommendation: adopt **log-length coordinates** (lighter) or `ScaleMagnitude` (heavier, exact), and make the choice cover **zoom/mpp derivation end-to-end**, not just candidate math — normalizing after an IEEE-754 overflow recovers nothing. Alternatively, the bible must state a **finite supported exponent envelope** and `T-R1-*` must prove the representation within it. Right now constraint 1 is asserted, not met.

### Coalesced zoom semantics (target vs. trace)

The decisive fork. AR designs guarantee the **final preferred label at the target mpp**; they do **not** synthesize an `in → ft → yd → mi` trace during a one-call jump. Walker (05) can guarantee the trace but only correctly if its bridged final state is required to equal an absolute oracle (else path-dependent). The catalog uses temporal language (`T-F1-01` "appears before," `T-Z-03` "sequence," `T-Z-04` "passes") that a single coalesced compute cannot exhibit. **Decide now:** a scale bar is a ruler (report the length that fits — target semantics, my recommendation) or an odometer (traverse every rung — trace semantics). Then rewrite `T-F1-*`/`T-Z-*` as either target-mpp matrices or explicit transition-trace suites. This decision *is* the choice between Finalist A and Finalist B.

### User-range coordinates

Three candidate meanings of "current size" (pre-pick displayed world length / picked-unit quantized world length / target-pixel world length) yield different ranges, and candidate bars at one mpp can represent different physical lengths. Store the range as **one canonical physical (log-length or meters) interval carrying the unit**, from that world length to the unit's standard-band edge on the destination ladder. 01/03 do this; **06/08's display-magnitude storage must change.** The bible's own example (`2×10⁻⁵ in`–`10 in`) spans fraction/decimal/sci grammar, which display-magnitude storage cannot represent cleanly. Freeze the "current size" definition (`T-R5-06`, `T-R5-07`).

### Sticky ladder

All serious designs make `ladderId` durable session state and forbid per-frame `stackForUnit` (fixes F3), and split display-session writes from `scaleDef` writes (fixes F4). Low residual risk **if** the editor wiring actually threads a session object rather than a post-render ref (F5). 08's contracts and 05's reducer are the most explicit about ownership; 03/06 rely on the editor doing the right thing. Make "session updated before paint, from a real store" an integration test, not an aspiration.

### Picker rung explosion

Cumulative-vs-replace is unstated (see constraint 6). Under the likely cumulative reading, 6d/6e and 7c/7d will routinely exceed the 12/22 thresholds and render as tables — so the table-flip + trailing-"more" + skip-empty interaction is exercised on every deep open and must be tested, not assumed. "Non-SI-prefix" (6d) and the 7c conditionals need catalog-metadata predicates (02/07 best) rather than hand-maintained unit lists (drift = F9).

### Testability

- **AR family:** best — pure functions, every catalog id → one deterministic `it(...)`. 04 adds useful score-breakdown diagnostics; 08 pre-writes the contract tests. Cheapest to reach 1:1 catalog coverage.
- **05 (Walker):** roughly double the surface — reducer/transition tests **plus** a mandatory "bridged final state == absolute oracle at target mpp" equivalence suite (without it, 05 is another isolated heuristic). Property tests needed for bridge determinism, caps, and invariants.
- **02:** weights need golden anchors or they drift silently; more machinery to test.
- **All:** the coalesced suite (`T-Z-*`, `T-F6-01`) must run with `lastReading = null` and Δmpp ≥ 10×, or the fine-step tests will keep hiding F1/F6 exactly as they do today.

---

## 4. Verdict table

| # | Design | Fit to bible | Main strength | Main risk | Keep / borrow / drop |
|---|--------|--------------|---------------|-----------|----------------------|
| 01 | Blank-Slate Rebuild | **Strong** | `ScaleMagnitude` numeric safety; validated policy schema; **correct** rule-5 destination resolver; physical user ranges | Broadest rebuild = highest delivery risk; decimal type adds test discipline | **Borrow into A** (numeric math, schema validation, pick resolver, catalog) |
| 02 | Adaptable Config + Classes | **OK** | Best explicit config/predicate registry for constraint 8 | Additive score weights + pins + walk-cursor + bridge = the "score soup" the bible flees; over-machined | **Borrow** the closed rung-predicate vocabulary only; **drop** weights/pins/cursor/bridge |
| 03 | Simple Logical Core | **Strong (with fixes)** | Smallest auditable core; cleanest expression of stay-ladder + lex preference | No incumbent → fails `T-P-07`; float ceiling; rule-5 dest checks only highest owner; overlap needs explicit handoff | **KEEP as base of Finalist A**, hardened (incumbent + log-length + fixed rule-5) |
| 04 | Scored Preference Engine | **OK** | Inspectable score breakdown for debugging | **Configurable score order can reorder the mandated stack**; continuity gives no edge hysteresis; overlap resolution shaky | **Borrow** breakdown diagnostics; **drop** editable order / additive weights |
| 05 | State-Machine Walker | **OK–Strong** (only if trace is required) | Only design with real intrinsic hysteresis (current rung = incumbent) and a true transition trace; ultra absorption via missing edges | Path-dependent without an absolute oracle; local greedy ≠ global preference at overlaps; ~2× test cost; weakest on constraint 8 (guards in code) | **Keep as Finalist B** only if product declares trace semantics; require oracle equivalence |
| 06 | Functional Pipeline | **Strong (with fixes)** | Clean L1/L2/L3 purity boundaries; typed `RungRule` DSL | Display-magnitude user ranges (fragile); no incumbent (Q4 gap) | **Fold into A** (borrow layer purity); fix user-range coordinate |
| 07 | Catalog + Policy Layers | **Strong (as architecture)** | Best data/ownership split; single physical-truth catalog; absorption as membership∅ + bands | Leaves the core selection algorithm open (not a complete choice) | **Adopt with A** as the module-boundary blueprint |
| 08 | Failure-Mode-First | **Strong (as contracts)** | Enforceable contracts that structurally kill F1–F10; mandatory coalesced tests | Its resolver is another AR proposal; retains pin/epoch machinery; display-magnitude ranges + no incumbent | **Adopt** the contracts/test mandate; **fold** the resolver into A; fix user-range coordinate |

---

## 5. Recommendation

### Path to implement

**Adopt hardened Option 03 as the engine, built on Option 07's layer split, with Option 02's closed predicate registry and Option 08's contracts — instantiated on a log-length coordinate spine with a typed incumbent unit (my §1 sketch).** Reserve Option 05 as the fallback *only if* product decides transition-trace visitation is a hard requirement, and in that case require its final state to equal the absolute resolver at target mpp.

Concretely, the winning design is: absolute resolve from mpp on the sticky ladder → interval selection in bible-4 order → incumbent-based hysteresis with overlap-derived thresholds → user ranges stored in physical/log space → declarative rungs → thin adapter preserving chrome.

### What to decide first (in priority order)

1. **Target vs. trace semantics** for coalesced zoom. This picks Finalist A (target, recommended) vs. B (trace). Everything downstream depends on it. Then rewrite `T-F1-*`/`T-Z-*` accordingly.
2. **Numeric coordinate:** log-length (recommended, light) or `ScaleMagnitude` (exact, heavy) — and make it cover zoom/mpp derivation end-to-end. Or declare a finite exponent envelope and prove it.
3. **Anti-flicker thresholds:** the enter/exit (overlap) widths at each handoff, especially ft/yd/mi and ultra ft/mi. Q4 is currently a requirement with no numbers.
4. **User-range "current size" coordinate** and confirm physical/log storage.
5. **Rule-5 destination table** (highest-priority ladder *where preferred* first) as an explicit, tested decision table.

### What to freeze in the bible before coding

- **Rung cumulativity:** state explicitly that popover/set-scale rungs are cumulative unions (assumed by every option, unstated in the bible).
- **The ultra `ft`→`mi` overlap winner** (and the yd/500 ft winner) as explicit band edges, not derived from "prefer lower number."
- **Q4 enter/exit thresholds** per handoff (turns anti-flicker from prose into data).
- **Rule-5 rule-3 destination** wording tightened to "highest-priority ladder on which the picked unit is auto-preferred; else highest owner + range."
- **Remaining open items** as committed defaults or edits: true-metric `dm`/`dam`/`hm`/`Mm…Qm` widths (open item 7), body/astro non-SI-prefix classification for 6d (item 8), sci glyph style (item 9), ultra sub-ℓP floor (item 10). None block the architecture; all should be frozen so the config data is authoritative rather than "PROPOSED."
- **Far-pin fate:** decide whether legacy far-pin survives or all manual intent normalizes to user ranges (bible's stated durable mechanism). Recommend dropping pins for the cleanest model; if retained, it must be explicit, unit-bearing, and never reset the ladder.

Once 1–5 are decided and the six bible freezes are in, the implementation is a small pure core plus data tables, and every catalog id maps to a deterministic test — which is the outcome the bible's §7 is really asking for.
