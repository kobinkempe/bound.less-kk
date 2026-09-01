# Scale Bar Redesign — Finalist Analysis

**Purpose:** select genuinely different implementation directions from options 01–08.  
**Authority:** the [ruling design bible](../scale-bar-ruling-design-bible.md) and [acceptance catalog](../scale-bar-test-catalog.md) remain binding. This document recommends an architecture; it does not replace product rules.

## Recommendation

Recommend **two finalists**, rather than presenting near-identical absolute-resolver proposals as separate choices:

1. **Finalist A — Option 03, Simple Logical Core:** a pure, absolute resolver that selects the best legal reading from the current meters-per-pixel, sticky ladder, user range, and declarative policy.
2. **Finalist B — Option 05, State-Machine Ladder Walker:** an explicit durable walker that traverses ladder transitions, including a deterministic bridge for large zoom jumps.

**Default recommendation: choose Finalist A, hardened as described below.** The bible defines an end-state preference policy (stay ladder → preferred range → lower number ≥1), and its most serious regressions are caused by historical walk state being missing or stale. A complete candidate resolver makes the required target result independent of render cadence, `previousHud`, and synthetic intermediate steps. However, Option 03's two-field state is not by itself a complete anti-flicker design: a memoryless half-open boundary is deterministic, but it will still alternate when noisy zoom crosses that boundary repeatedly. Finalist A therefore needs a minimal durable incumbent-unit/handoff state (or an equivalently explicit overlap rule) for hysteresis, while the absolute resolver remains the correctness fallback.

Choose Finalist B only if product considers **observing/retaining every intermediate unit transition** a meaningful behavioral requirement beyond the final result. The catalog is currently ambiguous here: `T-F1-01`, `T-Z-03`, and `T-Z-04` use temporal language (“appears before,” “sequence,” “passes”), even though one coalesced compute can render only the final label. Product must decide whether those assertions mean target-specific correctness at sampled mpp values or mandatory synthetic traversal. Until then, this is a real decision, not evidence that the walker is required.

Whichever finalist is selected, adopt the **catalog/policy separation from Option 07** and the **configurable rung predicates from Option 02**. Those are implementation disciplines, not a third competing unit-selection algorithm.

### Validation corrections that affect selection

1. **Do not claim that full candidate enumeration alone prevents “skipping feet.”** It guarantees that `ft` can win at target mpp values where policy says it should win. It does not guarantee that `ft` is observed during a single jump whose target is already in the `yd`/`mi` region. Only a temporal bridge can guarantee visitation.
2. **Do not equate a fixed handoff boundary with hysteresis.** A pure function of `{mpp, ladderId, userRange}` flips whenever mpp crosses its boundary. To meet Q4 / `T-P-07`, define overlapping entry/exit thresholds and retain the incumbent unit, or revise the bible/catalog to require deterministic selection rather than true anti-flicker.
3. **Treat Option 05 as needing an absolute oracle, not as self-validating.** Its local greedy transitions, bridge cap, and fallback can otherwise produce a path-dependent final state. If the oracle is used in production as the capped-jump fallback, the resulting design is a hybrid: absolute correctness with optional temporal traversal.
4. **Make cross-ladder pick resolution exact.** “Highest-priority owner” is not sufficient for constraint 5 rule 3. First find ladders on which the picked unit is the preferred auto unit at this mpp; if any, switch to the highest-priority member of that subset with no user range. Otherwise keep the active ladder when it owns the unit, or choose the highest-priority owner and install the required range.
5. **Do not pass a current-ladder user range into related-ladder probes.** Popover 6a related auto-show must evaluate a clean hypothetical session on each related ladder. Foreign user state would corrupt the result, especially for shared units.
6. **`ScaleMagnitude` is necessary but not sufficient for rule 1.** If `effectiveZoom`, anchor derivation, or unit factors have already underflowed/overflowed as JavaScript numbers, normalizing afterward cannot recover them. The numeric contract must cover the input representation and mpp derivation end to end, or rule 1 needs a stated finite test envelope.

These corrections do **not** justify a third standalone finalist. Option 07 is a required layering contract, Option 02 contributes a bounded predicate vocabulary, and 01/04/06/08 are still variants or hardening packages around absolute resolution. The honest third shape is a **hybrid**, but that is better treated as the hardened form of Finalist A (absolute winner + minimal incumbent hysteresis, optional animation bridge) or Finalist B (walker + mandatory absolute oracle), not as a separate option.

---

## Design clusters

| Cluster | Options | Shared center | Finalist treatment |
|---|---|---|---|
| **Absolute resolver / full candidate ranking** | 01, 03, 04, 06, 08 | Resolve from current mpp and explicit session policy; do not require a historical walk to be correct. | Select **03** as the least overbuilt, clearest expression. Borrow precision/config safeguards from 01, auditability from 04, purity boundaries from 06, and failure-mode contracts from 08. |
| **Durable transition walker** | 05 | A real state machine advances across adjacent rungs and bridges large jumps deterministically. | Select **05** as the one genuinely different temporal model. |
| **Configuration/layering frameworks** | 02, 07 | Make ladders, bands, picker rungs, and metadata declarative and separate physical unit truth from policy. | Do not select independently: pair the best parts with either finalist. Option 02 is heavier than needed; 07 is a strong module-boundary blueprint but deliberately leaves the core selection algorithm open. |

### Why the absolute-resolver options are near-duplicates

Options 01, 03, 04, 06, and 08 all reject the fragile `previousHud`-seeded search as the source of correctness. They enumerate (or conceptually enumerate) legal readings for the sticky ladder at the target mpp, apply the rule-4/rule-5 preference stack, and use history only optionally for ties or display continuity. Their differences are mainly:

- **01:** precision-first, comprehensive rebuild with `ScaleMagnitude`;
- **03:** smallest lexicographic core;
- **04:** the same model presented as an inspectable score vector;
- **06:** the same model presented as a pure functional pipeline;
- **08:** the same model framed as contracts that forbid F1–F10.

Recommending several would give a false sense of choice while committing the project to the same central algorithm.

---

## Evaluation basis

Both finalists must preserve the bible’s five ladders and exact inventories, bounded bar invariant, 1/2/5 grammar plus the inch `1/32` chain, sticky ladder and preferred-range semantics, user-range lifecycle, and unchanged UI chrome.

The key acceptance pressure is not ordinary fine-step zoom. It is:

- **F1/F5/F6/F7 and `T-Z-*`:** correct results after large or coalesced jumps and with no usable last reading;
- **F2/F10 and `T-R5-*`:** a manual pick must establish a concrete destination ladder/reading, never a null pin or cold Planck search;
- **F3/F4:** active ladder must survive shared units, far-pin release if retained, and display/meta writes;
- **constraint 8 and `T-R8-01`:** bands, related ladders, rungs, thresholds, and grammar constants must be data;
- **constraints 6–7:** popover and dialog membership must be declarative queries, separate from the core auto-selection algorithm;
- **constraint 9:** no visible chrome changes.

---

## Finalist A — Absolute resolver with a simple logical core

**Base design:** [Option 03 — Simple Logical Core](./03-simple-logical-core.md)

### Core idea

At each frame, derive meters-per-pixel from the calibration anchor and zoom, then resolve the winning reading from:

```text
metersPerPixel + { activeLadderId, userRange? } + policy
  → legal bounded candidates on the active ladder
  → lexicographic preference selection
  → ScaleReading
```

The active ladder is durable ephemeral session state. Auto selection never re-infers it from a shared unit. A user pick updates that state and, when required by rule 5, installs a physical user preferred range from the current size to the selected unit’s configured standard-band edge. A minimal incumbent auto unit (or explicit equivalent handoff state) may also be durable solely to implement Q4 hysteresis; deleting it must still yield a valid absolute target reading.

No bridge, `previousHud`, `minUnit`, null stack pin, or near/far pin is required to determine a valid automatic target result. Hysteresis may use a typed incumbent unit with policy-defined entry/exit thresholds, but that state must never narrow the candidate universe, seed a cold search, or be required for bounds/extreme correctness.

### Why it wins

- **Best fit for the ruling preference model.** Rule 4 is naturally a deterministic ordered selection process. Keeping the candidate scope to the active ladder makes “stay on current ladder” structural rather than a fragile weighted bonus.
- **Directly neutralizes the highest-risk target-resolution failures.** F1, F5, F6, and F7 become ordinary target-mpp tests: `ft` wins wherever its policy region wins, regardless of how the target was reached; a missing last HUD cannot change the candidate universe. This does not promise temporal visitation during a jump beyond the feet region.
- **Smallest maintainable core.** Three conceptual concerns suffice: policy/config, pure reading/pick resolver, and rung assembly. This makes it easier to map each acceptance case directly to a pure test.
- **Strong configurability without framework excess.** Bands and ordered rung predicates are data; moving a predicate between rungs does not modify selection code.
- **Correct separation of concerns.** It keeps the existing status zoom flush for responsiveness, but no longer depends on React delivering every intermediate update for correctness.

### Risks and required mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Overlapping preferred bands can make a “lexicographic” key underspecified. | `500 ft` versus `200–500 yd`, and all custom band edges, need an unambiguous winner. | Encode half-open/inclusive edges and explicit `handoffPriority` or a documented rank tie-break in policy. Snapshot every boundary in `T-R4-*`, `T-P-*`, and `T-U-*`. |
| JavaScript `number` arithmetic may become non-finite or lose ordering at the requested extreme zoom range. | Rule 1 explicitly calls out thousands of orders beyond the named endpoints. | Borrow Option 01’s normalized decimal/scientific `ScaleMagnitude` for the math boundary, or first prove the existing ratio representation stays finite across `T-R1-*`. Do not merely assume a float-based redesign is safe. |
| A broad candidate generator can accidentally omit legal decimal/scientific candidates. | That would cause bounds failures at terminal units or special inch behavior. | Define candidate generation by grammar, not an ad hoc finite list; test default 1/2/5, inch fractions/decimal transition, floors, and ceilings separately. |
| User range semantics are easy to encode in the wrong coordinate system. | Rule 5 says its endpoint is based on current physical size and a standard-band edge, and it must survive zoom. | Store the range as a normalized physical interval (meters/world length), as Option 01 proposes. Avoid Option 06’s display-value-only range unless it additionally carries the unit and converts it to physical bounds correctly. |
| A memoryless boundary is not hysteresis. | Small back-and-forth zoom noise can cross a half-open edge repeatedly and alternate units, failing Q4 / `T-P-07`. | Define per-handoff enter/exit thresholds (usually from overlapping preferred bands) and retain only the incumbent unit needed to choose the applicable threshold. Absolute resolution remains the cold-start/fallback answer. |
| Rule-5 destination selection is easy to simplify incorrectly. | Picking a shared unit that is preferred on another ladder must switch to the highest-priority ladder where it is preferred, not merely the highest-priority owner or always the current owner. | Implement destination resolution as an explicit ordered decision table and test all three rule-5 branches, including shared-unit ties. |
| Rung probes can leak active-session preferences. | A related ladder has no user range belonging to the current ladder; reusing it changes 6a membership. | Create clean hypothetical per-ladder contexts for related-auto and no-preference probes; never mutate or reuse the live session overlay. |
| Very large single-frame jumps will show only the final preferred label. | This changes internal behavior, although not specified HUD chrome. | Confirm that final-result correctness is sufficient; retain optional synthetic bridge samples strictly as animation polish, never correctness logic. |

### Borrow from non-finalists

- **Option 01:** end-to-end `ScaleMagnitude` (including zoom/mpp derivation, not only candidate math), policy schema validation, a single canonical unit catalog, and physical-world user ranges.
- **Option 02:** adopt only the named, closed predicate registry and ordered popover/dialog rung plans. Do not adopt its score weights, class hierarchy, pins, walk cursor, or bridge into Finalist A.
- **Option 04:** candidate score/breakdown diagnostics for top alternatives. Keep the actual comparison lexicographic, not additive weights.
- **Option 06:** explicit pure world-math → policy → rung-assembly boundaries.
- **Option 07:** use these concrete ownership boundaries: Unit Catalog owns identity/factors/names/tags; Ladder Membership owns inventories/priority/related graph; Preference Policy owns bands/handoffs/user-range lifecycle; Presentation Policy owns cumulative rung recipes/table thresholds; the resolver consumes them without redefining their data.
- **Option 08:** enforceable contracts: `lastReading` optional, ladder ID never inferred per frame, display-session reset separate from scale-definition writes, and mandatory large-jump tests.
- **Option 05:** only its durable state lifecycle discipline—not its transition requirement—for Clear, redefine, and optional far-pin compatibility.

---

## Finalist B — Explicit state-machine ladder walker

**Base design:** [Option 05 — State-Machine Ladder Walker](./05-state-machine-walker.md)

### Core idea

Maintain a durable `WalkerState` with active ladder, current unit/value, last meters-per-pixel, optional user range, and an explicit pin only if compatibility requires it. On zoom, a pure reducer creates a geometric bridge from old to target mpp and repeatedly applies local transitions:

```text
stay/rescale → within-rung nice step → promote neighbor → demote neighbor
```

The state machine never does the old implicit search around a post-render `previousHud`. It owns its state before rendering, preserves ladder identity across shared units, and makes coalesced traversal explicit.

### Why it wins

- **Only finalist with an explicit continuity guarantee.** If “inches must be traversed through feet before yards/miles” is intended as a temporal journey rather than only a target-resolution rule, this design states and tests that behavior directly.
- **Maps naturally to the language of ladders, rungs, transitions, and user overrides.** The model is useful for debugging transition defects because every change has an event and invariant.
- **Retains a durable session rather than an accidental React ref.** This robustly addresses F2–F5 and F10 provided the reducer, not UI code, owns all state transitions.
- **Makes an optional far-pin compatibility path explicit.** If retaining as-built far pin semantics is a product requirement, a mode-bearing state machine models release safely while preserving the ladder.

### Risks and required mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| More state and transition paths than the product rules require. | The redesign may reintroduce the historical complexity it is trying to remove. | Define an absolute fallback/verification resolver for the target mpp in tests. A bridged final state must equal the policy winner. |
| Bridge cap and pathological large jumps need a fallback. | The proposed capped bridge can otherwise leave a state that depends on step count. | Make fallback deterministic and policy-based; do not silently fall back to anchor or a narrow rank search. |
| One-rung-at-a-time promotion can encode incorrect local behavior at overlapping bands. | A local greedy decision may differ from the bible’s global preference result. | Give each transition a policy-derived guard and compare against golden target resolutions at every relevant band boundary. |
| State can become invalid after lifecycle events. | This would recreate F2/F4/F10 in a new vocabulary. | Make illegal states unrepresentable: no stack-only pin, pin always includes a unit, user-range state always belongs to the active ladder, Clear/redefine creates a new state, and scale meta writes cannot reset it. |
| A bridge does not prove the final policy winner. | Geometric microsteps plus one-rung local moves can end differently based on source state, bridge ratio, or cap; “deterministic” is not the same as bible-correct. | Require equivalence with an absolute resolver at target mpp. On cap/pathology, use that resolver as the production fallback and explicitly decide whether skipped synthetic visitation is acceptable. |
| Temporal tests are underspecified. | “Passes through” cannot be observed from a single returned HUD, while rendering every synthetic state could add unrequested animation behavior. | Split tests into target-resolution assertions and transition-trace assertions; require the latter only if product adopts mandatory traversal semantics. |
| Higher implementation and test cost. | Every event × mode × ladder edge must be tested in addition to the catalog. | Use a pure reducer and property tests for invariants, bridge determinism, bounds, ladder membership, and terminal behavior. |

### Borrow from non-finalists

- **Option 03:** an absolute candidate resolver as the walker’s specification oracle, particularly for large-jump final states and cold seeds.
- **Option 01:** precision-safe magnitude math, catalog validation, and policy-derived bands.
- **Option 02:** only declarative ordered rung plans and a compact closed predicate engine; reject numeric score weights, duplicate pin policy, and generic class machinery.
- **Option 04:** explainable preference breakdown whenever a transition promotes/demotes.
- **Option 07:** concrete ownership split: catalog (physical truth), membership (five inventories/graphs), preference (bands, handoffs, user lifecycle), and presentation (rung recipes/thresholds).
- **Option 08:** epoch/session mutation contracts and the ban on `previousHud` correctness.

---

## Approaches not selected as standalone finalists

| Option | Decision | Reason |
|---|---|---|
| **01 — Blank-Slate Rebuild** | Fold into Finalist A | Excellent precision and policy detail, but its resolver is the same absolute-resolve family as 03 and its broad rebuild has the highest delivery risk. |
| **02 — Adaptable Config + Classes** | Borrow configuration approach | Strong rule-8 answer, but classes, weights, pins, cursor, and bridge create more machinery than the core problem needs. Its weighted scoring is less auditable than a lexicographic key. |
| **04 — Scored Preference Engine** | Borrow diagnostics | Near-duplicate of 03. “Score vector” is useful for debug output, but configurable score order/weights can accidentally violate the bible’s mandated ordering. |
| **06 — Functional Pipeline** | Fold into Finalist A | Essentially 03 expressed as functional layers. Its display-value user range and sticky-ladder fallback language need the physical-range and no-auto-switch clarifications above. |
| **07 — Catalog + Policy Layers** | Adopt with either finalist | Best data architecture, not a complete choice of resolution algorithm: it permits bridge *or* full-candidate selection. |
| **08 — Failure-Mode-First** | Adopt as acceptance/contracts checklist | Excellent hardening plan, but its resolver is another absolute-resolve proposal and it retains pin/epoch machinery as a central concern. |

---

## Decisions the user must make

1. **Absolute resolve or mandatory walk/bridge?**
   - **Absolute resolve (recommended):** guaranteed correct target reading from current mpp; large jumps may visibly change directly to the final label.
   - **Walker:** preserves explicit intermediate traversal semantics; more state, transitions, and verification burden.
   - Before choosing, rewrite the ambiguous temporal catalog cases as either target-mpp matrices or required transition traces.

2. **How strong should numeric safety be?**
   - Adopt Option 01’s normalized `ScaleMagnitude` end to end, including zoom ratio / mpp derivation, for a strong rule-1 guarantee.
   - Or state a finite supported exponent envelope and prove the existing representation within it. Normalizing only after a JavaScript-number overflow is not a guarantee.

3. **How much configuration machinery?**
   - Adopt Option 07’s strict data layering plus a small, closed predicate vocabulary from Option 02 (recommended).
   - Avoid a generic plugin system, mutable score weights, or a broad class hierarchy unless a concrete bible rule needs it.

4. **Retain far-pin compatibility or normalize all picks to user ranges?**
   - The bible’s durable override mechanism is user preferred ranges; no visible badge exposes pin mode.
   - Remove pins for the cleanest model, unless existing far-pick behavior has a product requirement not captured in the bible. If retained, it must be explicit, unit-bearing, and never reset the active ladder.

5. **Define boundary policy before implementation.**
   - Confirm/encode entry versus exit thresholds and overlap winners, especially ft/yd/mi and ultra ft/mi. Half-open edges alone provide determinism, not hysteresis.
   - Resolve or explicitly default the bible’s remaining proposed items: true-metric widths, body/astro non-prefix classification, scientific label style, and ultra sub-ℓP terminal behavior.

6. **Define the physical coordinate for user ranges.**
   - State whether “current size” is the pre-pick displayed bar’s world length (the catalog currently implies this), the selected unit’s quantized bar length, or a canonical target-pixel world length.
   - Define range membership independently of arbitrary candidate bar length, then lock the choice with construction/boundary tests.

---

## Next steps after selection

1. **Record the chosen finalist and the six decisions above** in the ruling bible or a short adoption record.
2. **Create a policy data schema and validation suite first:** canonical units, five inventories, ladder priority/related graph, standard bands, grammar, and rung plans. Add audits for every bible table.
3. **Implement the pure decision seams before UI wiring:** mpp math, candidate grammar, absolute resolver (even if Finalist B is selected), pick/user-range reducer, and rung predicates.
4. **Translate every catalog ID into automated tests before deleting old walk behavior,** emphasizing `T-F1-*`, `T-F2-*`, `T-F3-*`, `T-F4-*`, `T-F5-*`, `T-F7-*`, `T-Z-*`, and `T-P-07`.
5. **Integrate through a thin adapter that preserves current HUD/popover/dialog chrome,** then run a manual constraint-9 pass.

For Finalist B specifically, add a required equivalence test: the state-machine result after any bridge must match the absolute resolver at the target mpp. This prevents the new walker from becoming another isolated heuristic system.
