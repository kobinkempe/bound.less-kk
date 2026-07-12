# Design Option 05 — State-Machine Ladder Walker

**Status:** proposal (docs only; not adopted).  
**Authority:** [scale-bar-ruling-design-bible.md](../scale-bar-ruling-design-bible.md)  
**Acceptance:** [scale-bar-test-catalog.md](../scale-bar-test-catalog.md)  
**UX surface:** unchanged (bible §1 / constraint 9).

---

## 1. Thesis

Treat the scale-bar HUD as a **finite walker on an explicit ladder graph**, not as a free search that “remembers” the last frame via `previousHud`.

At every moment the engine holds a durable **WalkerState**: *which ladder*, *which rung (unit)*, *which nice reading on that rung*, and *which preference overlay (standard vs user range) is active*. Zoom does not re-pick from scratch; it **fires transitions** — promote, demote, stay-and-rescale, switch ladder, install/tear-down user range — until the state is consistent with the new meters-per-pixel (mpp).

Large coalesced zoom jumps are handled by a **deterministic bridge**: walk the same transition rules along a geometric mpp path from the last settled state to the target. Bridging is part of the state machine, not a React-ref hack. Correctness does not depend on intermediate frames having been rendered.

---

## 2. Metaphor

| Everyday image | Engine meaning |
|----------------|----------------|
| **Ladder** | One of five named inventories (bible §2). |
| **Rung** | A unit on that ladder (ordered by physical size). |
| **Standing on a rung** | Current HUD unit + nice value + barPx in bounds. |
| **Climb / descend** | Promote / demote to a neighbor rung (or within-rung nice step). |
| **Preferred landing zone** | Standard preferred magnitude band for that unit (§5). |
| **User tape on a rung** | User preferred range — outranks the standard band until torn down. |
| **Switching ladders** | Explicit transition; invalidates prior user tape; may install a new one (constraint 5). |
| **Bridge** | When the floor drops/rises many stories at once, the walker still climbs/descends rung-by-rung along a synthetic path — never teleports past feet into miles. |

The HUD is **always on a rung**. There is no “cold search from Planck floor” mode in normal operation. Cold start is a single **seed** transition into a valid rung, after which only walker transitions apply.

---

## 3. States

### 3.1 WalkerState (durable, ephemeral session — not doc meta)

```ts
type LadderId =
  | "standard-metric"
  | "standard-imperial"
  | "ultra-standard-metric"
  | "ultra-standard-imperial"
  | "true-metric";

type WalkerMode =
  | "auto"          // constraint 4 preference stack
  | "user-range"    // constraint 5 user preferred range active
  | "far-pin";      // pinned unit only (sci-style); release → auto/user-range

type WalkerState = {
  ladderId: LadderId;
  unit: string;           // current rung
  value: number;          // nice magnitude on that unit
  barPx: number;          // last settled bar length
  metersPerPx: number;    // mpp at last settle (bridge source)
  mode: WalkerMode;
  userRange: null | {
    unit: string;
    minMeters: number;    // inclusive physical span of the user tape
    maxMeters: number;
  };
  // far-pin only:
  pinnedUnit?: string;
};
```

**Invariants**

1. `unit` ∈ inventory(`ladderId`).
2. `BAR_PX_MIN ≤ barPx ≤ BAR_PX_MAX` after every successful settle.
3. `mode === "user-range"` iff `userRange != null`.
4. `mode === "far-pin"` implies `pinnedUnit` set; walker does not auto-promote until release.
5. Sticky `ladderId` survives shared units (`Qpc`, `AU`, …) — never re-derived from `stackForUnit(unit)` alone (F3).

### 3.2 Derived HUD (pure projection)

```ts
type ScaleHud = {
  value: number;
  unit: string;
  barPx: number;
  stack: LadderId;
  metersPerPx: number;
  displayLabel?: string;
  sciLabel?: string;
};
```

UI continues to consume `ScaleHud` only. WalkerState lives in the engine/session layer (replaces `prevHudForCalcRef` + pin/minUnit spaghetti).

### 3.3 What is *not* a state

- **`previousHud` as search seed** — eliminated as a correctness dependency.
- **`minUnit` / `minUnitZoomAt`** — replaced by preferred ranges (Q4).
- **`pinMode: "stack"` with null pin** — forbidden (F10); cross-ladder picks always land in `auto` or `user-range` with an explicit unit.

---

## 4. Transitions

All transitions are total functions:

```text
(WalkerState, Event) → WalkerState
```

Events are the only inputs that move the walker.

### 4.1 Event catalog

| Event | Source | Effect summary |
|-------|--------|----------------|
| `ZoomTo { mpp }` | engine status / effectiveZoom | Bridge + settle on current ladder under active preference |
| `PickUnit { unit }` | HUD popover | Constraint 5: switch ladder / user-range / switch-only |
| `FarPin { unit }` | picker far path (if retained) | Enter `far-pin`; sticky ladder kept |
| `ReleaseFarPin` | release predicate | Exit pin → `auto` or residual `user-range`; **ladder unchanged** |
| `SeedFromAnchor { scaleDef, mpp }` | Set scale save / first HUD | Seed rung from anchor; ladder by priority; clear user-range |
| `Clear` | Clear control | Destroy walker; UI shows zoom-only |
| `ApplyUserRange { unit, minM, maxM }` | internal from PickUnit | Enter `user-range` |
| `TearDownUserRange` | in-range unit change / ladder switch | Clear tape; usually followed by another transition |

### 4.2 Core zoom transition (`ZoomTo`)

```text
ZoomTo(targetMpp):
  if mode == far-pin:
    settle sci reading on pinnedUnit at targetMpp
    if shouldReleaseFarPin(...): emit ReleaseFarPin then ZoomTo(targetMpp)
    return

  path = bridgeMppPath(state.metersPerPx, targetMpp)  // see §4.4
  s = state
  for mpp in path:
    s = settleAtMpp(s, mpp)   // promote/demote/stay within one step budget
  return s with metersPerPx = targetMpp
```

`settleAtMpp` never searches the whole registry. It only considers:

1. **Stay** — rescale nice value on current unit; accept if bar in bounds and preference allows.
2. **Within-rung nice step** — next 1/2/5 (or inch fraction) on same unit.
3. **Promote** — neighbor rung up (larger unit) if prefer-≥1 / band exit says so.
4. **Demote** — neighbor rung down if bar would exceed max / band entry from below.

Preference order inside `settleAtMpp` (constraint 4 + 5):

1. If `user-range` and current physical size ∈ tape → **must** stay on `userRange.unit` (nice-rescaled); only leave via PickUnit / TearDown / ladder switch.
2. Else stay on **current ladder**.
3. Among in-bounds candidates on this ladder, prefer units whose reading lies in their **standard preferred band** (§5).
4. Prefer **lower number ≥ 1** on the next rung when that reading fits (e.g. `1 ft` over `10 in`).

No cross-ladder auto-walk. Ladder changes only via `PickUnit` / `SeedFromAnchor`.

### 4.3 Promote / demote (local rung moves)

```text
promote(s):  try unit = nextRung(s.ladderId, s.unit) with prefer-≥1 nice (usually 1)
demote(s):   try unit = prevRung(s.ladderId, s.unit) with largest in-bounds nice
```

Special **absorption** edges are data on ultra-standard ladders (no `yd`/`mil`/`ld`/…): e.g. ultra imperial `µm → in`, `ft → mi`, `AU → ly`, `pc` ceiling. The walker only follows edges that exist on the active ladder graph — skipping omitted units is automatic, not a special-case bridge table like as-built inch↔mil / AU↔ld hacks.

Inch fractions (3a) are **within-rung** steps on `in`, not separate rungs:  
`… → 1/8 → 1/16 → 1/32 → .01 → …` then demote edge to `mil` (standard imperial) or `µm` (ultra imperial).

### 4.4 Bridging (large jumps)

**Problem (F1, F5, F6):** Coalesced zoom delivers `mpp_new / mpp_old` ≫ 1. A single global pick can jump `10 in → mi`. As-built `bridgePreviousHudAcrossJump` + React ref is brittle when the ref is nulled.

**Proposal:** Bridging is mandatory whenever `|log(mpp_new/mpp_old)|` exceeds a config threshold (default: factor outside `[1/1.35, 1.35]`, same spirit as as-built).

```text
bridgeMppPath(from, to):
  if ratio in [1/BRIDGE_RATIO, BRIDGE_RATIO]: return [to]
  steps = []
  m = from
  while m not yet at to (max BRIDGE_MAX_STEPS):
    m = clampToward(m, to, factor=BRIDGE_RATIO)  // e.g. 1.3
    steps.push(m)
  steps.push(to)  // exact landing
  return steps
```

Each intermediate `settleAtMpp` may move **at most one rung** (plus within-rung nice). That guarantees monotonic visitation: inches → feet → yards → miles on standard imperial, even when React only paints the final frame.

**Determinism:** Same `(WalkerState, targetMpp)` ⇒ same path ⇒ same final state. No dependence on whether intermediate zooms were flushed to React (though keeping the as-built immediate `effectiveZoom` flush remains good for animation smoothness — T-Z-01).

**Cap:** If `BRIDGE_MAX_STEPS` would be exceeded (pathological Δ), fall back to **multi-rung settle**: from current rung, walk promote/demote in a loop until stable at `to`, still without leaving the ladder. Never open a full-registry cold search.

### 4.5 PickUnit (constraint 5)

```text
PickUnit(unit):
  destLadder = highestPriorityOwner(unit)   // sticky current wins if unit on current
               // else STACK_PRIORITY among owners

  if destLadder != state.ladderId:
    TearDownUserRange
    state.ladderId = destLadder
    if unit is preferred auto unit on destLadder at current mpp:  // rule 3
      mode = auto; settle on that preferred reading
    else:                                                         // rule 1 / Q5
      ApplyUserRange(unit, from=currentSize, to=standardBandEdge(unit, destLadder))
      settle on unit
    return

  // same ladder
  if unit == preferredAutoUnit(state, mpp): 
    // already preferred — no user range
    settle on unit; return

  if unit is preferred on some *other* ladder at this mpp:        // rule 3 cross-check
    // only reachable if unit also on current? usually rule 3 is cross-ladder;
    // if same-ladder, treat as non-preferred → user range
    ...

  // rule 2: non-preferred on current ladder
  ApplyUserRange(unit, from=currentSize, to=standardBandEdge(unit, ladder))
  settle on unit
```

**Teardown:** `PickUnit` to a different unit while `user-range` active and current size ∈ tape → `TearDownUserRange` then apply the new pick rules. Ladder switch always tears down first.

### 4.6 SeedFromAnchor / Clear

- **Seed:** Set `ladderId` from anchor unit via priority (constraint 7); `mode=auto`; `userRange=null`; choose initial nice reading so bar ∈ bounds (demote/promote from anchor value if needed — fixes F7 without `previousHud`).
- **Clear:** Drop WalkerState entirely; next Set scale Seeds fresh (T-X-01).
- **Redefine scale:** Seed again; wipe prefs (T-X-02).

### 4.7 Far pin

Retained as an optional UX path compatible with today’s far-pick behavior, but implemented as an explicit mode:

- Enter: `FarPin` keeps `ladderId`; does **not** null walk state (fixes F2/F5).
- While pinned: reading forced on `pinnedUnit`.
- Release: `ReleaseFarPin` → `auto` (or prior user-range if product wants — default **auto**); **never** `resetDisplayFloor()` (F4).

Near-pin-as-built can map to a short-lived user-range or a one-shot settle on the picked unit without a separate mode — prefer **user-range** so constraint 5 is the single override mechanism.

---

## 5. Types / modules

Suggested file split (names illustrative; constraint 8 = data-driven):

| Module | Responsibility |
|--------|----------------|
| `scaleBarLadders.js` | Five ladder inventories, related-ladder map, priority, unit registry, absorption edges |
| `scaleBarPreferredRanges.js` | §5 standard bands as data; `standardBandEdge(unit, ladder)`; plain/sci handoff constants |
| `scaleBarWalker.js` | WalkerState, events, `reduce(state, event)`, bridge path, settle/promote/demote |
| `scaleBarNice.js` | 1/2/5, inch fractions incl. 1/32, format labels |
| `scaleBarPicker.js` | Popover 6a–6e + Set-scale 7a–7d as ordered **rule lists** (config), not hard-wired levels |
| `scaleBar.js` | Facade: `computeScale` / `dispatch` adapting CanvasEditor → walker events → `ScaleHud` |

**Graph view of a ladder**

```ts
type LadderGraph = {
  id: LadderId;
  rungs: string[];                    // ascending
  next: Record<string, string | null>;
  prev: Record<string, string | null>;
  related: LadderId[];
};
```

Walker promote/demote only uses `next`/`prev`. Omitted ultra units simply have no node.

---

## 6. APIs

### 6.1 Primary API

```ts
// Pure reducer — testable without React
function reduceWalker(state: WalkerState | null, event: WalkerEvent, ctx: WalkerContext): WalkerState | null

type WalkerContext = {
  ladders: LadderRegistry;
  bands: PreferredRangeTable;
  config: ScaleBarConfig;       // bar bounds, bridge ratio, plain/sci, rung rules
  nowMpp: number;               // for PickUnit preference checks
};
```

### 6.2 Facade for existing call sites

```ts
function computeScale(effectiveZoom, scaleDef, walkerState, displayOpts?) → {
  hud: ScaleHud;
  nextState: WalkerState;
}

function applyUnitPick(walkerState, unit, mpp) → { hud, nextState }
function seedWalker(scaleDef, mpp) → WalkerState
function clearWalker() → null
```

CanvasEditor stores `walkerState` in a ref **or** React state, but updates it only from `nextState` returned by the facade — never by assigning `hud` back as “previousHud.” The ref is a **session handle for WalkerState**, not a search hint.

### 6.3 Picker APIs (unchanged signatures, new guts)

```ts
getUnitPickerOptions({ walkerState, mpp, moreLevel }) 
getSetScaleUnitOptions({ moreLevel, currentLadder? })
```

Membership = evaluate configured rule predicates for rung N, union, sort small→large, exclude current, skip empty, flip to table at 12 / 22.

Popover 6a “related auto-show” = run `settleAtMpp` on a **hypothetical** walker cloned onto each related ladder at the same mpp (constraint 4 only, no user-range) and take that unit (Q3) — not log-distance peers.

---

## 7. Config (constraint 8)

All retune knobs live in one config object / module exports:

| Knob | Role |
|------|------|
| `BAR_PX_MIN/MAX/TARGET` | Bounds + scoring target inside settle |
| `PLAIN_MIN/MAX` (`.001`…`5000`) | Sci handoff |
| `BRIDGE_RATIO` / `BRIDGE_MAX_STEPS` | Jump bridging |
| `NICE_NUMBERS`, inch subdivision list incl. `1/32` | Nice policy |
| `LADDER_PRIORITY` | Five-ladder order |
| `RELATED_LADDERS` | Popover + audits |
| `STANDARD_PREFERRED_BANDS[ladder][unit]` | §5 table |
| `POPOVER_RUNG_RULES[0..4]` | Ordered predicates for 6a–6e |
| `SET_SCALE_RUNG_RULES[0..3]` | Ordered predicates for 7a–7d |
| `TABLE_FLIP_POPOVER` (12) / `TABLE_FLIP_SET` (22) | UI thresholds |
| `FAR_PIN_RELEASE` | Predicate table |

Changing ultra `ly` max 500→5000 is a band-table edit only (T-R8-01) — walker core untouched.

---

## 8. Failure-mode avoidance

| ID | As-built failure | Walker mitigation |
|----|------------------|-------------------|
| **F1** | Skip feet on coarse zoom | Bridge + at-most-one-rung per bridge step; promote prefers `1 ft` via bands |
| **F2** | dm pick → Planck | PickUnit always settles on chosen unit; never clears state into full-window search |
| **F3** | Lose sticky stack at Qpc | `ladderId` is first-class state; shared units do not reassign ladder |
| **F4** | commitScaleDef resets display floor | Preference writes must not clear `ladderId`; no `resetDisplayFloor` on band handoff |
| **F5** | `previousHud` ↔ React coupling | Durable WalkerState; bridge uses `state.metersPerPx`, not last painted HUD |
| **F6** | Fine-step tests miss coalescing | Bridge path + catalog T-Z / T-F1 required in CI |
| **F7** | Cold start stuck on anchor | `SeedFromAnchor` demotes/promotes until bar in bounds |
| **F8** | Missing 1/32 | Inch within-rung list includes `1/32` then `.01` |
| **F9** | Docs/code drift | Bible + this option; ladders/bands as data matching §2/§5 |
| **F10** | null stack-pin | No such mode; PickUnit always sets unit + auto/user-range |

Anti-flicker (Q4 / T-P-07): hysteresis is the **width of preferred bands** plus “stay on rung while stay-rescale still in bounds and inside band.” No separate `minUnit` lock unless bands prove insufficient later.

---

## 9. Test mapping

How this design intends to satisfy the catalog (design-time; not yet implemented):

| Catalog area | Walker hook |
|--------------|-------------|
| **T-R1 / T-R2 / T-R3** | settle + nice + sci config; ceiling/floor rungs |
| **T-R3a / T-IN / T-F8** | inch within-rung sequence |
| **T-R4 / T-P-*** | stay-ladder + band table in `settleAtMpp` |
| **T-R5 / T-P-02** | `PickUnit` / `ApplyUserRange` / teardown transitions |
| **T-R6 / T-POP-*** | `POPOVER_RUNG_RULES`; related via hypothetical settle (Q3) |
| **T-R7 / T-SET-*** | `SET_SCALE_RUNG_RULES`; seed ladder on save |
| **T-R8** | bands/rules as data |
| **T-R9** | facade only; chrome untouched |
| **T-F1 / T-Z-*** | `bridgeMppPath` + one-rung-per-step |
| **T-F2 / T-F5 / T-F7 / T-F10** | PickUnit/Seed invariants; no null previousHud search |
| **T-F3 / T-F4** | sticky `ladderId`; release/promotion preserve it |
| **T-U-*** | ultra graphs omit nodes; absorption = missing edges; ly/pc/ft bands |
| **T-X-*** | Clear / Seed wipe |

**Unit-test shape:** pure `reduceWalker` with synthetic mpp sequences — including single-call 10× jumps — without mounting CanvasEditor. Integration tests still cover status flush (T-Z-01).

---

## 10. Tradeoffs

| Pro | Con |
|-----|-----|
| Explicit states/transitions match the product language (ladder, range, switch) | More upfront modeling than “score all candidates in a window” |
| Bridging is deterministic and ref-independent | Bridge loops add CPU on huge jumps (bounded by `BRIDGE_MAX_STEPS` + multi-rung fallback) |
| Preferred ranges unify anti-flicker and user override | Band table must stay accurate; bad edges → sticky wrong unit |
| Easy to test reducer in isolation | CanvasEditor must stop treating HUD as walk input — migration discipline |
| Ultra omissions fall out of the graph | Custom as-built special bridges go away; must re-encode intent in bands/edges |
| Picker rules as data (constraint 8) | Predicate DSL needs care so 6a–6e stay readable |

**Rejected alternatives (for this option)**

- **Global best-score pick each frame** — reintroduces skip risk and previousHud stickiness hacks.
- **minUnit lock beside ranges** — violates Q4 unless ranges fail later.
- **Log-distance peer for 6a** — contradicts Q3; this design uses related-ladder auto-show via hypothetical settle.

---

## 11. Assumptions

1. Bible §2 ladders, related map, priority, and §5 PROPOSED bands are authoritative inputs to config tables.
2. UX chrome stays identical; only membership and reading selection change (constraint 9).
3. WalkerState is **session-ephemeral** (like today’s display stack), not persisted in doc meta — unless product later asks to persist sticky ladder.
4. Auto path **never** changes ladder; only user pick / seed / clear do.
5. Far-pin remains optional compatibility; preferred long-term override mechanism is user preferred ranges.
6. As-built immediate flush on `effectiveZoom` can remain for visual smoothness; correctness does not require it.
7. Open bible items (true-metric band widths, body/astro popover 6d nuance, sci glyph style, ultra sub-ℓP floor) do not block this architecture — they are config/table edits once decided.
8. “At most one rung per bridge step” is sufficient for F1; if a single settle still needs within-rung multi-nice hops, that is allowed inside the same rung.

---

## 12. Evaluation checklist (bible §7)

- [x] UX unchanged (facade / chrome).
- [x] Five ladders + related + priority as data.
- [x] Bar bounds + extreme zoom via settle/ceiling.
- [x] 1/2/5 + inch 1/32 → `.01` + plain/sci constants.
- [x] Preference stack + user ranges + teardown; anti-flicker via bands.
- [x] Popover/dialog rungs as reorderable rule config.
- [x] No fragile `previousHud`-only correctness; bridge on WalkerState.
- [x] Sticky ladder survives shared units and pin release.
- [x] Manual picks never cold-start to Planck.
- [x] Catalog mappable 1:1 (§9).
- [x] Lives under `scale-bar-design-options/`; bible remains ruling.

---

## 13. Clarifying questions

None blocking. Architecture can proceed with §5 PROPOSED bands and bible open items deferred as table tweaks.

Optional product confirmations (non-blocking): whether far-pin survives once user-ranges cover override UX; whether sticky `ladderId` should ever persist in doc meta.
