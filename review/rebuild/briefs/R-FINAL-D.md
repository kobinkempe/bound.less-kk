# R-FINAL-D — the final design check's audit: the built tree against the design (2026-10-06, orchestrator)

**Agent:** `opus-reviewer`. **Preamble:** `review/rebuild/AGENT-PREAMBLE-CLOUD.md` (19 rules; rule 19 above all: usage
windows are short, so keep your context small — grep and line ranges, never a whole large file). **Scratch:**
`<scratchpad>/fin-d/`. **Edits: documents only** (DESIGN.md, `docs/ai/*`, `docs/OPEN-FLAGS.md`, `review/rebuild/*` design
documents); nothing under `src/` or `tools/` — a source problem is reported with its evidence.

**Read, as you need them:** `CLAUDE.md`; PLAN §0 (Kobin's decisions), §1 (the design targets 1.1–1.8), §2, §3 (the
acceptance list) and §5.19–§5.26 (what was built and decided since the last full read); `DESIGN.md` §7–§10 and §13;
`docs/ai/00-START-HERE.txt` and `90-MAINTENANCE.txt`; then the code by grep.

## 1. The audit

1. **The design targets** (PLAN §1.1–§1.8): for each, built as designed / built differently (how, and whether the
   difference is recorded in PLAN §5 or the A-documents) / not built. A line or two each, with the code that shows it.
2. **The acceptance list** (PLAN §3): each invariant's test by name, present and passing (B-PYRAMID-5's and
   R-MODEL-C34's quick-suite runs are the record: 2,210 passed, 0 failed at 03:51; the orchestrator gives you the final
   run's numbers), and break-checked where a review recorded it.
3. **The old mechanisms deleted** (PLAN §2: "each build ends with the old mechanism deleted"): grep for each mechanism
   the plan names as replaced (the quantum plates, `PictureLayer`, the sync path, the settle, the ladder, the crossing
   prebake, the carry, the hold, the `?pyramid` gate, `_renderPending`, the interim erase pool, `listFor`, `_buildList`,
   `TileStore.content`/`contentOffCamera`, `_normalizeHome`, `_keepingSelection`, the per-remove selection listener,
   merges, read mints): gone, or what is left and why (a comment, a legacy loader, an oracle).
4. **The documents true to the code**: DESIGN.md §7–§10 and §13, and `docs/ai/20-`, `30-`, `40-`: every statement the
   rebuild made false, corrected in place (a sentence each; keep the documents' voice and form); `docs/OPEN-FLAGS.md`:
   every flag the rebuild touched (F80, F94, F107, F108, F111, F133–F139) has the right status and index row.
5. **`docs/ai/10-STATUS.txt`**: the header's dates; "Where the tree is" rewritten (the branch `claude/hopeful-dirac-iotb9n`,
   on top of `rasteriser` at 56e36b3, pushed; nothing deployed since 2026-09-08); dated entries for what landed since
   2026-09-30 — R-DRAG, B-PYRAMID-4, R-PYRAMID-34, C3/C4 with R-MODEL-C34 (F138), B-PYRAMID-5 — each in the file's form
   (what changed, what was measured and where, "not seen by Kobin"), from PLAN §5.20–§5.26.

## 2. Output

`review/rebuild/FINAL-AUDIT.md` (new): the three tables of 1.1–1.3, the list of corrections made in 1.4–1.5, and the
findings (majors and minors, each with evidence). STATUS-LOG entries at start, after each part, at the end — heading
`## <date> UTC — R-FINAL-D (reviewer) — <what>`, each ending `WHERE I AM:`. Your report (rule 11, under 50 lines). Commit
nothing.

Beside you: **R-FINAL-M** (measurements in headless Chromium; no edits) and **B-DOCMAPS-3** (`tools/docmaps/` only).
