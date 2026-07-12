# Scale Bar — Blank-Slate Rebuild

## Thesis

Rebuild the scale bar as a deterministic measurement compiler: it converts one physical input (world length per screen pixel) plus an explicit display policy into a bounded, nice, labeled reading. Ladders, unit bands, user intent, popover rungs, and dialog rungs are declarative data consumed by small independent resolvers. The renderer receives a complete `ScaleReading`; it does not participate in choosing units, preserving history, or repairing skipped transitions. This replaces the coupled anchor/search-window/pin/previous-HUD walk with a single policy evaluation that is correct both on cold start and after an arbitrarily large zoom jump.

## System metaphor: an atlas with routes and territories

The unit registry is an **atlas**. A ladder is a named **route** through that atlas, in physical order, not an ownership claim for a shared unit. A preferred range is a unit's **territory** on a route: the physical interval where that unit is the preferred way to label a bounded bar. A user selection temporarily redraws one territory boundary on the active route. The reading resolver asks, “which legal signpost on this route best describes this stretch of ground?” It does not simulate travelling one rung at a time. Consequently, a zoom jump cannot skip feet, lose its route, or fall back to Planck units merely because an intermediate render was absent.

## Domain model

### Numeric foundation

`ScaleMagnitude` is a positive, normalized base-10 scientific value:

- `significand`: finite decimal in `[1, 10)`;
- `exponent10`: signed integer;
- operations required by the scale system: multiply/divide, compare, ratio, and conversion from a validated finite input;
- presentation conversion only happens after candidate selection.

Physical lengths, pixels, and unit factors use `ScaleMagnitude`, rather than relying on an IEEE-754 product to stay finite. Unit definitions may retain an exact decimal/scientific source factor and a normalized factor. This supports readings many orders below `qℓP` and above `Qpc` without `NaN`, `Infinity`, or loss of ordering. Browser zoom inputs remain finite numbers at the boundary; invalid inputs produce no reading.

### `UnitCatalog`

The canonical catalog contains one `UnitDefinition` per symbol, keyed by symbol:

- symbol, full name, physical factor in metres, family tags (`si-meter`, `planck`, `planck-prefix`, `imperial`, `body`, `astro`);
- prefix metadata and `hasSiPrefix`;
- the ordered ladder memberships in which it appears.

It exposes physical ordering, unit-factor lookup, full-name table rows, and membership queries. A unit is catalogued once even when several ladders use it, eliminating conflicting copies and “primary stack” ownership.

### `LadderDefinition` and `LadderCatalog`

Each of the five named ladders is a route with:

- `id`, display priority, and ordered `unitSymbols`;
- `relatedLadderIds`;
- a per-unit `StandardBand` reference;
- a terminal policy (`sci-below`, `sci-above`, or both).

The catalog validates at startup that every route is strictly physically increasing, all referenced units exist, every unit has a band, related-ladder links match the bible, and priority is total. It provides `ownersOf(unit)`, selecting the highest-priority owner only when there is no active route.

The five route ids are `standard-metric`, `standard-imperial`, `ultra-standard-metric`, `ultra-standard-imperial`, and `true-metric`, in the bible's priority order. The two ultra routes are actual ladders, not picker aliases.

### `ScaleDefinition`

Persisted document data is only the calibrated physical anchor:

- `knownLength`: user-entered amount and unit;
- `drawnPixels`: measured canvas line length;
- `zoomAtCalibration`.

It contains no display floor, selected route, pin, previous reading, or preference history. Validation rejects non-positive or non-finite calibration values.

### `DisplaySession`

Ephemeral editor state is explicit and small:

- `activeLadderId`: the sticky current route;
- `userRange`: absent or one `UserPreferredRange` belonging to that route;
- `lastReading`: optional observation for continuity and diagnostics, never required for correctness;
- `popoverDepth` and `setScaleDepth`.

`activeLadderId` survives shared units, rendering, far-selection release, and calibration metadata writes. Clear and a new saved scale create a fresh session.

### `PreferenceProfile`

An immutable, configuration-derived policy for a ladder:

- standard bands for all route units;
- number grammar for each unit family;
- plain/scientific boundaries;
- bar bounds and target;
- deterministic tie-break ordering.

`UserPreferredRange` is a runtime overlay:

- `ladderId`, `unitSymbol`;
- inclusive physical interval, stored as `ScaleMagnitude` world lengths;
- origin (`same-ladder` or `cross-ladder`).

The interval starts at the chosen reading's physical length and ends at the selected unit's applicable standard-band edge. It is normalized low-to-high. It is not a rank lock, zoom threshold, pin mode, or a second walking algorithm.

### `ScaleReading`

The sole engine output for a valid request:

- chosen ladder and unit;
- normalized numeric value;
- world length and computed pixel length;
- number token (`plain`, `fraction`, or `scientific`) and display label;
- diagnostics such as selected band source (`user`, `standard`, `fallback`) for tests, not chrome.

The HUD renders this immutable value. The same reading context powers popover membership.

## Resolver pipeline and data flow

### 1. Zoom to reading

`resolveReading(request)` is pure. Its request is `{ scaleDefinition, effectiveZoom, displaySession }`; its output is `ScaleReading | null`.

1. `deriveMetresPerPixel` divides the calibrated world length by drawn pixels and scales it by `zoomAtCalibration / effectiveZoom` using `ScaleMagnitude`.
2. `resolveActiveLadder` uses the session route when present; otherwise it chooses the highest-priority ladder containing the calibration unit. It never infers a route from a shared unit after the session is established.
3. `enumerateCandidates` visits every unit on that route. For each unit, `numberGrammar.candidatesNear(targetWorldLength / unitFactor)` generates the nearest legal 1/2/5 value(s), including the allowed inch fraction sequence. Terminal units also generate scientific candidates. This is bounded by a small fixed neighborhood of exponents; it is not a historical walk or a limited rank search.
4. `keepBoundedCandidates` keeps candidates whose pixel lengths lie in `[barMinPx, barMaxPx]`. If rounding around the edges leaves none, `chooseNearestBoundedCandidate` chooses the nearest legal candidate and clamps only through legal 1/2/5 quantization; configuration is validated so normal calibrated scales always have a legal bounded candidate.
5. `rankCandidates` applies the preference stack in this exact lexicographic order:
   1. active ladder (already fixed for this resolve);
   2. active user preferred range, if it contains the candidate's world length;
   3. the unit's standard preferred band, if it contains the candidate's displayed magnitude;
   4. lower displayed number that is at least one;
   5. distance from configured bar target;
   6. stable catalog order for an exact tie.
6. `formatReading` applies the unit grammar: `.001` through `5000` are plain, all other values are scientific with 1/2/5 mantissas. Inches use `1/8`, `1/16`, and `1/32`; below that fraction boundary they use decimal `.01`-style labels before their configured finer-unit handoff.

The selected reading is deterministic from the request. `lastReading` may be attached afterward for telemetry and optional exact-tie continuity, but removing it cannot change the valid candidate universe or cause an anchor/Planck fallback.

### 2. User pick to ladder and user range

`applyUnitPick(session, currentReading, pickedUnit, context)` returns a new `DisplaySession`; it does not create a “near pin,” “far pin,” or null stack pin.

1. `resolvePickDestination` first determines whether the picked unit is the preferred auto unit on any ladder at the current physical scale. If so, it selects the highest-priority such ladder, sets it active, and installs no user range.
2. Otherwise, if the picked unit belongs to the active ladder, it remains on that ladder. If not, it selects the highest-priority owner, replaces the active ladder, and clears any prior user range.
3. `resolvePickedReading` quantizes the picked unit at the current scale to a legal bounded reading. This provides a concrete physical start point and means `dm` chosen from `cm` resolves on true metric immediately, rather than starting a cold route search.
4. `buildUserRange` spans from that concrete world length to the edge of the picked unit's configured standard band in the direction away from the current auto choice. It stores the interval on the destination ladder. A same-ladder pick from inside an existing user range clears the entire overlay instead of creating another.
5. Subsequent `resolveReading` calls rank this overlay above standard territories while its interval contains the candidate. A route switch invalidates the old overlay before a new one is considered.

This makes a far unit choice a normal policy update, not a temporary scientific pin that must later be released.

### 3. HUD popover rungs

`resolvePopoverRung(readingContext, requestedDepth)` evaluates rung predicates cumulatively, then returns the first depth at or after `requestedDepth` that contributes a new unit. `readingContext` includes the current reading, active ladder, session overlay, and metres per pixel.

Each predicate returns a set of unit symbols; a shared `finalizeRung` union-deduplicates, removes the current unit, and sorts by physical size. The configuration supplies these predicates:

1. related ladders' auto readings using their own route policy; current-route auto reading with user overlay discarded; current-route auto reading with all preferences discarded; current-route units within 50×;
2. current unit on every ladder; every ladder's no-preference auto reading; related-route units within 50×; current-route units that can form `.1`–`500` readings;
3. all-route units that can form `.1`–`500` readings; ±2 units on current route; ±1 units on related routes;
4. all ultra-standard units, `kpc`, and all units without an SI prefix;
5. the whole catalog.

If a cumulative rung has more than 12 units, `presentationForRung` selects the full-name table. If more units remain beyond the depth being shown, it retains **more** as the trailing row. Popover presentation stays flat.

### 4. Set-scale dialog rungs

`resolveSetScaleRung(currentLadderId, requestedDepth)` uses a separate declarative rung plan and never reuses HUD-popover heuristics:

1. ultra-standard units from `mm` through `mi`;
2. all ultra-standard units;
3. all ladder units from `µm` through `kpc`, plus current-route non-prefixed units, plus all true-metric SI-prefixed metre units when true metric is current;
4. the whole catalog.

Rungs are cumulative, deduplicated, physically sorted, and skip empty increments. The dialog uses chips through 22 units and a full-name table only above 22. Saving a selected unit creates the calibration and seeds `activeLadderId` with its highest-priority owning ladder.

## Declarative configuration

`scaleBarPolicy` is one versioned data module, divided by concern rather than scattered special cases.

- `numeric`: bar minimum/target/maximum pixels; plain lower and upper bounds (`.001`, `5000`); scientific mantissas `[1, 2, 5]`; extreme comparison precision.
- `ladderPriority` and `ladders`: the five route inventories, related-route graph, terminal policies, and per-route unit-band ids.
- `units`: factors, names, tags, prefix metadata, and number-grammar id.
- `numberGrammars`: standard 1/2/5 grammar, inch grammar (whole, required fractions, decimal transition), and terminal scientific grammar.
- `standardBands`: explicit inclusive magnitude intervals per `(ladder, unit)`, including all bible §5 absorption bands. The ultra `ly: 1..5000`, ultra-imperial `ft: 2..5000`, and ultra `pc: 200..5000` rules are data entries, not exceptions in the resolver.
- `rungPlans`: ordered named predicate descriptors for popover and set-scale depths, plus 12/22 presentation thresholds.

Predicate descriptors are composed from a small vocabulary—`autoReading`, `routeUnitsWithinFactor`, `readableUnits`, `neighborWindow`, `tagQuery`, `unitSet`, and `allUnits`—with arguments. Moving a rule from popover rung two to three changes the plan entry, not resolver code. Policy validation rejects unknown units, invalid intervals, inverted routes, missing standard bands, duplicate rung ids, and malformed related-ladder maps.

## Avoiding F1–F10

| Failure | Rebuild protection |
|---|---|
| F1 feet skipped | Full-route candidate enumeration and lexicographic bands make `ft` a candidate on a large jump; no +1 search window or bridge is needed. |
| F2 random/Planck after manual pick | A pick immediately resolves its destination route and picked-unit reading; no null state can trigger a cold full-ladder search. |
| F3 shared-unit route loss | `activeLadderId` is session state, not inferred from a shared symbol such as `Qpc`. |
| F4 preference write clears route | Calibration persistence and display session are separate objects; no scale-definition write mutates route or overlay state. |
| F5 render/ref coupling | Correctness is a pure resolve from calibration, zoom, and session. `lastReading` is optional observation only. |
| F6 fine-step-only confidence | Large jumps use the same route-wide resolver as fine steps; tests exercise both input shapes. |
| F7 cold start anchor stickiness | Cold starts enumerate and rank all legal route candidates; the anchor does not receive special priority. |
| F8 incomplete inch chain | The inch number grammar explicitly contains `1/8`, `1/16`, `1/32`, then decimal behavior. |
| F9 documentation drift | One versioned policy schema drives inventories, bands, related routes, picker plans, and generated policy-audit fixtures. The bible/test catalog remain the approval source. |
| F10 dead null stack pin | Pins and `pinMode` do not exist in the model. Manual intent is represented only by an active route and an optional valid user range. |

## Acceptance-test mapping

| Test families | Design pieces that satisfy them |
|---|---|
| `T-R1-*`, `T-R2-*` | `ScaleMagnitude`, calibrated metres-per-pixel derivation, bounded-candidate filter, terminal scientific grammar. |
| `T-R3-*`, `T-R3a-*`, `T-IN-*` | Number grammars, plain/scientific policy, and the explicit inch fraction grammar. |
| `T-R4-*`, `T-P-*`, `T-U-03`, `T-U-06`–`T-U-09` | Active-route selection, declarative standard bands, lexicographic ranking, and ultra ladder definitions. |
| `T-R5-*`, `T-F2-*`, `T-F10-01`, `T-X-01`–`T-X-02` | `applyUnitPick`, destination resolver, world-length `UserPreferredRange`, and fresh-session lifecycle. |
| `T-R6-*`, `T-POP-*` | Cumulative configured popover predicates, skip-empty logic, current-unit exclusion, physical sorting, and 12-unit table presentation. |
| `T-R7-*`, `T-SET-*` | Independent configured set-scale rung plan, 22-unit table threshold, and priority-based initial route. |
| `T-R8-01`, `T-X-03` | Versioned `scaleBarPolicy` plus catalog/policy validation. |
| `T-R9-01` | Adapter layer retains the existing HUD, flat popover, dialog, Clear, and drag interaction; only resolver results change. |
| `T-F1-*`, `T-F5-*`, `T-F6-*`, `T-F7-*`, `T-Z-*` | Stateless route-wide candidate evaluation; large-jump and null-history tests assert identical valid resolution without a bridge/ref dependency. |
| `T-F3-*`, `T-F4-*` | Explicit `DisplaySession.activeLadderId`, isolated from calibration persistence and selection release behavior. |

## Tradeoffs and risks

- Route-wide enumeration is intentionally broader than a neighbor walk. The largest standard route has only dozens of units, and each creates a fixed number of candidates, so the work is trivial at HUD cadence. It is substantially easier to prove than transition-specific code.
- A normalized decimal type introduces implementation and test discipline. It should have a compact, heavily tested API and only convert to JavaScript numbers at UI boundaries.
- Preferred-band overlaps are product policy, not accidental scoring artifacts. The configuration must state them explicitly, and exact ties must use documented deterministic order. Acceptance fixtures should snapshot boundary behavior.
- A user range is stored in physical world-length space so it remains stable through zoom. This requires careful conversion from the selected nice reading and a clear teardown event, both supplied by `applyUnitPick`.
- “All preferences discarded” needs an explicit policy mode. It must mean no user overlay and no standard-band preference, while retaining bar bounds and number grammar; otherwise popover rules can silently inherit state.
- The proposed true-metric widths, standard body/astro widths, scientific glyph style, and ultra sub-Planck exposure remain assumptions below. They are isolated in policy data and do not alter the framework.

## Assumptions for remaining bible items

No product decision blocks this architecture. The initial policy should proceed with these documented defaults until the owner edits the ruling table:

- **True Metric:** use the bible's proposed decade-width defaults for `dm`/`dam`/`hm` and `Mm` through `Qm`.
- **Bodies and 6d:** retain the proposed standard-ladder body/astro bands; classify `R☉`, `R⊕`, `AU`, `ld`, `ly`, `pc`, and unprefixed `m`/imperial units as “without an SI prefix” for popover rung 6d. Prefixed parsecs do not qualify except explicit `kpc`.
- **Scientific style:** retain the current human-facing Unicode superscript `×10` notation, but make the formatter a `numeric` policy choice.
- **ℓP/sub-ℓP on ultra:** ultra ladders auto-walk no lower than `ℓP`; below it, the `ℓP` terminal grammar emits scientific readings. Sub-`ℓP` units remain available only through the all-units picker/table unless a later policy change adds them to ultra route inventory.
