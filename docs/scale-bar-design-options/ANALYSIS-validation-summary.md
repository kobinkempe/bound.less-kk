# Scale Bar Finalist Analysis — Validation Summary

## Verdict

**Agree-with-fixes.** Terra correctly identified the only meaningful top-level split: absolute target resolution (Option 03 family) versus durable temporal traversal (Option 05). It also correctly treated Options 02 and 07 as supporting architecture rather than competing selection algorithms. The original analysis was too confident, however, that a stateless absolute resolver satisfies anti-flicker and that candidate enumeration alone prevents “skipping feet.”

## What changed in `ANALYSIS-finalists.md`

- Reframed the default as a **hardened Option 03**: absolute resolution remains the correctness source, with minimal typed incumbent/handoff state for real hysteresis.
- Distinguished **correct target resolution** from **mandatory temporal rung visitation**; the current `T-F1-*` / `T-Z-*` language does not cleanly decide between them.
- Added the requirement that Option 05’s bridged final state equal an absolute policy oracle, including at bridge caps and pathological jumps.
- Corrected rule-5 ladder selection: prefer the highest-priority ladder where the picked unit is auto-preferred before falling back to current/highest-owner handling.
- Required related-ladder popover probes to use clean hypothetical sessions with no foreign user range.
- Made the Option 02/07 borrow list concrete and bounded, including what **not** to borrow from Option 02.
- Tightened rule-1 numeric guidance: normalized magnitude must cover zoom/mpp derivation end to end, not normalize only after JavaScript-number overflow.
- Added the unresolved physical-coordinate question for user preferred ranges.

## Finalists

1. **Hardened Option 03 — Absolute resolver:** compute the bible-defined target winner from mpp and declarative policy, with only minimal incumbent state for handoff hysteresis and no historical search dependency.
2. **Option 05 + absolute oracle — State-machine walker:** preserve explicit transition traces through a durable reducer and bridge, while requiring its target state to match the absolute resolver.

No third standalone finalist is warranted. Option 07 is the required data/layer boundary; Option 02 supplies a closed rung-predicate vocabulary; Options 01/04/06/08 are hardening variants of the absolute family. The practical hybrid is already represented by hardening either finalist.

## Critical tradeoffs the user must decide

- Is correctness the **final preferred reading at target mpp**, or must a coalesced jump also produce an observable `in → ft → yd → mi` transition trace?
- Is a small durable incumbent-unit state acceptable for true anti-flicker, provided cold-start and target correctness remain absolute?
- Must rule 1 support effectively unbounded exponents end to end, or should the product define a finite tested zoom/exponent envelope?
- Should legacy far-pin behavior survive, or should all manual intent use bible rule-5 user ranges?
- What exactly is “current size” when constructing a user range: pre-pick displayed world length, picked-unit quantized world length, or target-pixel world length?
- What are the entry/exit thresholds and overlap winners at preferred-band handoffs?

## Risks / open bible gaps

- **Anti-flicker is underdefined:** half-open preferred bands select deterministically but do not prevent repeated flipping across a noisy boundary. True hysteresis needs different entry/exit behavior and an incumbent.
- **Temporal acceptance is ambiguous:** several tests say “appears before,” “passes,” or “sequence,” but a one-call coalesced resolve exposes only one HUD result.
- **User-range coordinates are underdefined:** candidate bars can represent different physical lengths at the same mpp, so range construction and membership need one canonical physical coordinate.
- **Extreme numeric scope is underdefined:** “thousands of orders” cannot be guaranteed if `effectiveZoom` or anchor math remains an IEEE-754 number before normalization.
- Existing bible gaps still matter: true-metric band widths, body/astro `non-SI-prefix` classification, scientific label style, and ultra sub-ℓP behavior.
- Option 05 remains vulnerable to path-dependent results unless target equivalence with an absolute oracle is a production invariant, not only a test convenience.

## Recommended next step

Choose the product semantics first: rewrite the ambiguous coalesced-zoom tests into separate **target-result** and optional **transition-trace** suites. Then adopt hardened Option 03 by default, freeze the handoff/user-range coordinate rules in the bible, and build the Option 07 catalog/membership/preference/presentation split with Option 02’s small closed predicate registry.
