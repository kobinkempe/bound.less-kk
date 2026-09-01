# Design Option 07 — Catalog + Policy Layers

**Status:** proposal (docs only; not adopted).  
**Authority:** [scale-bar-ruling-design-bible.md](../scale-bar-ruling-design-bible.md) remains ruling until adopted.  
**Acceptance:** [scale-bar-test-catalog.md](../scale-bar-test-catalog.md)  
**UX surface:** unchanged (bible §1 / constraint 9).

---

## 1. Thesis

Treat **physical truth** and **product policy** as different kinds of data.

Today, meters-per-unit, ladder membership, preferred bands, picker rungs, and walk heuristics are tangled inside `scaleBarLadders.js` / `scaleBar.js`. That coupling is why retuning a preferred range or moving a popover rule risks rewriting the walk core (constraint 8), and why shared units lose sticky ladder identity (F3).

This design freezes one **Unit Catalog** as the sole registry of identity, meters, and display names. Everything else is a **policy layer** that *references* catalog ids:

| Layer | Owns | Does not own |
|-------|------|--------------|
| **Unit Catalog** | id → meters, names, SI-prefix metadata | which ladder includes the unit |
| **Ladder Membership** | ordered inventories + related/priority graphs | preferred magnitudes |
| **Preference Policy** | standard bands, user ranges, auto pick stack (constraints 4–5) | chip layout |
| **Presentation / Rung Policy** | popover 6a–6e, set-scale 7a–7d, table flip thresholds | meters or nice math |
| **Reading Engine** | bar bounds, 1/2/5 (3/3a), zoom→reading given policies | inventing units |

**Single source of truth:** if `m` is 1 meter and labeled `"m"` / `"meter"`, that fact exists once. Ladders list `"m"`; preference tables key `"m"`; rungs filter by predicates over catalog fields — never re-declare meters or aliases.

---

## 2. Metaphor

**Library card catalog + circulation rules.**

- The **card catalog** (Unit Catalog) is the only place a book’s ISBN, title, and physical size live.
- **Shelving plans** (Ladder Membership) say which stacks hold which books and in what order — a book can sit on multiple shelves without getting a second ISBN.
- **Checkout policy** (Preference Policy) decides which book you hand a patron at this zoom: stay on this shelf, prefer this band, prefer ≥1 of the next title, honor a temporary hold (user preferred range).
- **Display cases** (Presentation / Rung Policy) decide what appears in the front window vs the “more” drawers — they never change the ISBN table.
- The **librarian** (Reading Engine) measures the shelf length in pixels and picks a nice 1/2/5 reading from whatever policy returned.

Changing “feet preferred through 5000 on ultra-imperial” is rewriting a circulation rule, not reprinting the card for `ft`.

---

## 3. Layers / modules

```
┌─────────────────────────────────────────────────────────────┐
│  UI (CanvasEditor, ScaleUnitPicker) — chrome unchanged      │
└──────────────────────────┬──────────────────────────────────┘
                           │ queries + events
┌──────────────────────────▼──────────────────────────────────┐
│  Session Facade                                             │
│  computeScale · applyUnitPick · getPopoverUnits ·           │
│  getSetScaleUnits · clearDisplayPrefs                       │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
  UnitCatalog  LadderGraph  PrefPolicy  RungPolicy
  (truth)      (membership) (auto/user) (6a–6e / 7a–7d)
       │          │          │
       └──────────┴──────────┘
                  │
                  ▼
           ReadingEngine
           (bounds, nice, format, jump walk)
```

### 3.1 Unit Catalog (authoritative physical registry)

One map keyed by stable **unit id** (string matching today’s abbreviations where possible: `m`, `ft`, `ℓP`, `Qpc`, …).

Each entry:

| Field | Purpose |
|-------|---------|
| `id` | Canonical key used everywhere |
| `meters` | Exact SI meters (single numeric truth) |
| `shortName` / `longName` | HUD / table labels |
| `family` | e.g. `si-length`, `imperial`, `planck`, `astro-body`, `astro-distance` |
| `siPrefixBase` | optional (`m`, `pc`, `ℓP`) for “has SI prefix” / non-prefix predicates (6d, 7c) |
| `formatKind` | `plain` \| `inch-fraction` \| `sci-capable` (drives 3a without hard-coding in walk) |

**Rules:**

- No duplicate meters for the same id across files.
- Ladder files never embed `meters:` — only ids.
- Multi-ladder units (`m`, `AU`, `pc`, …) are still **one** catalog row; membership is elsewhere.
- Adding a unit = catalog row + optional membership + optional preference band. Presentation predicates reuse catalog metadata.

### 3.2 Ladder Membership (inventory + graph)

Data-only module (constraint 8):

- **Five ladders** with ascending id lists per bible §2 (including both ultra-standard inventories; omit `yd`/`mil`/`ld`/`R☉`/`R⊕` on ultra).
- **`LADDER_PRIORITY`**: Standard Metric → Standard Imperial → Ultra-standard Metric → Ultra-standard Imperial → True Metric.
- **`RELATED_LADDERS`**: exact bible table.
- Helpers: `laddersOwning(unitId)`, `resolveLadder(unitId, sticky?)`, `rankOn(ladderId, unitId)`, `neighbors(ladderId, unitId, ±n)`.

Membership does **not** store preferred magnitudes or picker levels.

### 3.3 Preference Policy (pluggable)

Implements constraints **4** and **5** (+ Q4/Q5) as pure functions over:

- current ladder + sticky ladder id  
- `metersPerPx` / candidate readings  
- standard preferred-band table (§5 PROPOSED, keyed by `(ladderId, unitId)` — bands are **per ladder**, so ultra `ft`→5000 and standard `ft`→500 coexist without forking the catalog)  
- optional **user preferred range** session state  

**Auto stack (constraint 4):**

1. Stay on current ladder.  
2. Prefer candidates inside standard (or user) preferred range for that ladder.  
3. Prefer lower number ≥ 1 when both fit.

**User overrides (constraint 5):** install / tear down user ranges; cross-ladder switch by priority; rule-3 “preferred elsewhere → switch only.” Anti-flicker = preferred ranges only (no `minUnit` lock unless later proven necessary).

Near/far pin behavior from as-built can remain a thin **session adapter** that *feeds* preference policy (pinned unit ≈ temporary hard preference) rather than a parallel walk mode — avoiding F10’s null-pin stack path.

### 3.4 Presentation / Rung Policy (pluggable)

Ordered **rung recipes** as data (arrays of named predicates), not imperative level switches:

- **Popover:** rungs 6a→6e; skip empty; exclude current; sort by catalog meters; flip to table at `> 12`.  
- **Set-scale:** rungs 7a→7d; flip at `> 22`; save resolves initial ladder via membership priority.

Predicates consume catalog + membership + preference *queries* (e.g. “related ladder auto-show at this zoom” = run preference policy on related ladder with preferences discarded / as specified — Q3), never reimplement auto choice.

### 3.5 Reading Engine

Given a resolved unit + mpp:

- Enforce `BAR_PX_MIN` / `MAX` / `TARGET` (constraint 2).  
- Emit 1/2/5 (and inch 1/8–1/16–1/32 → `.01`) with `.001`…`5000` → sci (constraint 3 / 3a).  
- **Durable walk state:** last reading + sticky ladder + user range live in an explicit session object passed into `computeScale` — not a post-render ref alone (addresses F5).  
- **Large Δzoom:** either sample intermediate mpp steps (bridge) *or* evaluate preference policy over the full candidate set on the sticky ladder so coalesced jumps cannot skip `ft` (F1/F6) without depending on React flush luck.

### 3.6 Session Facade

Single API surface for UI. UI never imports catalog meters or rung predicate internals.

---

## 4. APIs (proposed)

Names are illustrative; shape is the contract.

### Catalog

```ts
getUnit(id) -> UnitRecord | null
unitMeters(id) -> number
allUnitIds() -> string[]
hasSiPrefix(id) -> boolean
formatKind(id) -> FormatKind
```

### Membership

```ts
LADDER_IDS / LADDER_PRIORITY / RELATED_LADDERS  // data
inventory(ladderId) -> UnitId[]
laddersOwning(unitId) -> LadderId[]  // priority-sorted
resolveLadder(unitId, stickyLadderId?) -> LadderId
rank(ladderId, unitId) -> number
related(ladderId) -> LadderId[]
```

### Preference policy

```ts
standardBand(ladderId, unitId) -> { min, max } | null
pickAutoReading({
  mpp, ladderId, userRange?, previousReading?
}) -> { value, unitId, barPx, label }

applyUnitPick({
  pickedUnitId, currentLadderId, mpp, currentReading
}) -> {
  ladderId,
  userRange: UserRange | null,  // null if rule 3
  pin?: PinState                // optional adapter
}

teardownUserRangeOnInRangePick(...)
```

### Rung policy

```ts
popoverUnits({ rungIndex, ctx }) -> { units, presentation: "chips"|"table" }
setScaleUnits({ rungIndex, ctx }) -> { units, presentation: "chips"|"table" }
// ctx: mpp, currentUnit, currentLadder, related auto-show units, etc.
```

### Facade / engine

```ts
computeScale(effectiveZoom, scaleDef, session) -> HudReading
  // session: { ladderId, userRange?, previousReading?, pin? }

withSessionAfterPick(session, pickResult) -> Session
clearDisplayPrefs(session) -> Session  // Clear / redefine scale
```

**Invariant:** `computeScale` never looks up meters except via `unitMeters`. Preference and rung modules never hard-code meter literals.

---

## 5. Config (data, not code)

All retunable surfaces as declarative tables (constraint 8):

| Config blob | Contents |
|-------------|----------|
| `units.catalog.json` (or `.js` export) | id, meters, names, family, siPrefixBase, formatKind |
| `ladders.membership.js` | five inventories, priority, related |
| `preference.bands.js` | §5 PROPOSED bands keyed by ladder+unit; ultra overrides (`ly`→5000, `ft`→5000, absorption notes as band edges only) |
| `preference.constants.js` | bar px bounds, plain/sci handoff `.001`–`5000`, nice mantissas, inch subdivision list incl. `1/32` |
| `rungs.popover.js` | ordered predicate ids for 6a–6e + `TABLE_AT: 12` |
| `rungs.setScale.js` | ordered predicate ids for 7a–7d + `TABLE_AT: 22` |

**Moving a rule between rungs** = reorder / swap predicate entries in the rung config.  
**Changing ultra `ly` max 500→5000** = one band cell (T-R8-01).  
**Neighbor absorption on ultra** = absence from membership + wider bands on neighbors — not special-case promote tables scattered in the engine.

---

## 6. Failure-mode avoidance

| ID | How this design avoids it |
|----|---------------------------|
| **F1** | Preference policy evaluates on sticky ladder over a candidate set that always includes the next preferred land unit (`ft`); large jumps use engine bridge *or* full-ladder candidate scoring — not “+1 rank window + stale previousHud” alone. |
| **F2** | `applyUnitPick` always returns concrete `{ ladderId, unitId, userRange|pin }`; facade seeds `previousReading` from the pick. No cold search from Planck floor. |
| **F3** | Sticky `ladderId` is session truth; `resolveLadder` only used when sticky absent. Shared units (`Qpc`) never re-derive stack from catalog alone. |
| **F4** | Preference/meta writes update bands only; facade forbids clearing `ladderId` on promotion/release. Far-pin release clears pin, keeps ladder. |
| **F5** | Walk state is an explicit `session` argument; UI may mirror it in a ref, but correctness does not require post-render ref survival. |
| **F6** | Acceptance requires coalesced cases (T-Z-*); engine API is testable with synthetic Δmpp without React. |
| **F7** | Cold start: if anchor reading violates bar bounds, preference+engine demote/promote on sticky (or priority) ladder — catalog does not “prefer anchor forever.” |
| **F8** | Inch `formatKind` + config subdivision list includes `1/32`; presentation/format owned once. |
| **F9** | Catalog + membership + bands are the docs-aligned data; older ladder markdown yields to bible + these tables. |
| **F10** | No `pinMode: "stack"` without unit; pick API always carries unit id or user range. |

---

## 7. Test mapping

How catalog/policy layers satisfy the acceptance catalog (design-time):

| Catalog area | Covered by |
|--------------|------------|
| **T-R1 / T-R2 / T-R3 / T-IN** | ReadingEngine + catalog `formatKind` / constants config |
| **T-R4 / T-P-*** | PreferencePolicy + per-ladder bands; membership sticky ladder |
| **T-R5-*** / Q5 | `applyUnitPick` + user range lifecycle |
| **T-R6 / T-POP-*** | RungPolicy popover recipes + preference queries for related auto-show (Q3) |
| **T-R7 / T-SET-*** | RungPolicy set-scale recipes + `resolveLadder` on save |
| **T-R8** | Config-only band/rung edits; no engine rewrite |
| **T-R9** | Facade preserves chrome; no new HUD badges |
| **T-F1 / T-Z-*** | Engine jump walk + preference candidates on sticky ladder |
| **T-F2 / T-F5 / T-F7 / T-F10** | Session + pick API contracts |
| **T-F3 / T-F4** | Sticky ladder ownership outside catalog |
| **T-F8** | Catalog inch format + subdivision config |
| **T-U-*** | Membership inventories + ultra band overrides (absorption = missing ids + wide neighbor bands) |
| **T-X-*** | `clearDisplayPrefs` / redefine scale resets session policies only |

**Unit-test seams (recommended):** catalog meters snapshot; membership inventory equality to bible; band table completeness per ladder; pure `pickAutoReading` / `applyUnitPick` tables; rung predicate snapshots at fixed mpp; engine bounds + coalesced Δmpp without UI.

---

## 8. Tradeoffs

| Pro | Con |
|-----|-----|
| True single source of truth for meters/names | More modules/files than today’s two-file tangle |
| Constraint 8 retunes become data edits | Predicate DSL for rungs needs discipline (avoid Turing-complete config) |
| Sticky ladder and preference clearly separated from physics | Session object must be threaded through UI carefully (one-time wiring cost) |
| Ultra absorption expressed as membership∅ + bands, not one-off bridges | Authors must remember: omit from ladder *and* widen neighbor bands |
| Pluggable policies allow A/B of preference without touching catalog | Risk of “policy plugin” over-abstraction if more than these four layers appear |
| Tests can target layers in isolation | End-to-end still required for F1/F6 coalescing |

**Non-goals for this option:** changing HUD chrome; inventing sixth ladders; keeping as-built `minUnit` hysteresis as primary anti-flicker; embedding meters inside ladder arrays.

---

## 9. Assumptions

1. Bible §2 five ladders, related/priority tables, and §5 PROPOSED bands are the initial config payloads.  
2. UX sameness (constraint 9) holds; only membership depth and reading choice change.  
3. Preferred ranges replace `minUnit` / `minUnitZoomAt` (Q4).  
4. Unit ids remain stable string keys compatible with persisted `scaleDef.unit`.  
5. “Non-SI-prefix” / “SI-prefixed meters” predicates are derived from catalog metadata, not hard-coded id lists (lists may seed metadata once).  
6. Near/far pin can be modeled as session adapters over preference policy without a third walk algorithm.  
7. Open bible items (true-metric band widths, body/astro display in 6d, sci glyph style, ultra sub-ℓP floor) are **config values** under this architecture — they do not require a different layering. Defaults follow §5 PROPOSED until the owner edits.

---

## 10. Evaluation checklist (bible §7)

- [x] UX unchanged (facade / constraint 9)  
- [x] Five ladders + related/priority as membership data  
- [x] Bar bounds + extreme zoom in ReadingEngine  
- [x] 1/2/5 + inch 1/32 via engine + catalog formatKind  
- [x] Preference stack + user ranges as PreferencePolicy; bands = §5  
- [x] Popover/dialog rungs as reorderable RungPolicy config  
- [x] No sole dependence on fragile `previousHud` (explicit session)  
- [x] Sticky ladder survives shared units and preference writes  
- [x] Manual picks seed session (no Planck cold start)  
- [x] Test catalog mappable 1:1 to layer tests + e2e  
- [x] Docs/code alignment path: catalog+policies become implementation SoT under the bible  

---

## 11. Clarifying questions

None blocking. Open bible items (§5 #7–#10) are assumed to ship as editable config under this split; no architectural fork depends on them.
