# bound.less — for agents

**Read `DESIGN.md` first**, then `docs/ai/00-START-HERE.txt`. The first is the
whole design in one document; the second is plain text, is the entry point for
an agent, and links everything else. This file is only the part you need before
you have read anything.

## The three things easiest to get wrong

1. **A green suite is not evidence that a change is good.** A refactor once
   passed 458 tests and was reverted as worse. Every defect that mattered this
   quarter was invisible to the suite and visible only in a browser.
2. **Do not describe the eraser as working.** Every pass so far has failed in
   real use. State what was measured.
3. **Measure paint in a real browser.** Rasterising the SVG to a canvas cannot
   see the compositing failures — that mistake cost three wrong diagnoses.

## Where things are

- The design, in one document: `DESIGN.md` (repository root).
- Live issue list: `docs/OPEN-FLAGS.md` — authoritative, edited in place.
- Status snapshot: `docs/ai/10-STATUS.txt`
- Architecture / code map / call flow: `docs/ai/20-`, `30-`, `40-`
- The plan and the backlog, everything still to do that is not a bug: `docs/ROADMAP.md`
- How to keep the docs true: `docs/ai/90-MAINTENANCE.txt`
- Design bibles and decision history: `docs/reference/`. Read the frame-lattice
  bible's **section 10 first** — it records where building it changed the
  design. `DESIGN.md` is the distillation; open a bible for the full argument.
- The published Code Map and Call Graph are generated from `tools/docmaps/`.
- History, frozen: `docs/issue-log.md`

## Commands

```bash
npm start              # dev server on :3000
npm run test:quick     # ~150 s, 1066 tests, no *.slow.test.js and no *.probe.js
npm run test:slow      # ~500 s (1,320 s beside a dev server and Chrome), 616 tests
npm run test:erase     # the slow erase suites only
npm run typecheck      # JSDoc-checked geometry (tsconfig.geometry.json); 0 errors is the bar
npm run build:worker   # esbuild bundles the erase worker into public/erase-worker.js (runs before start/build)
npm run lint           # eslint, including the layering rule (import/no-restricted-paths)
npm run report-server  # receives in-app diagnostic reports on :3001
```

Deployed at <https://bound-less-kk.web.app> — `firebase deploy --only hosting`.

## Conventions

- **Two directories are not product code, and the directory name says so:**
  `src/engine/__oracles__/` (independent implementations the shipping code is
  checked against, including the retired `KobinEngineV0`) and
  `src/engine/__testkit__/` (fixtures and harnesses). Nothing outside the test
  suites imports either, so webpack never bundles them. **Production must never
  import from `__oracles__`** — an oracle the engine depends on has stopped
  being one. The four dev routes that used to carry `[DEV]` banners were
  deleted on 2026-08-31.
- **`KobinEngine.js` is six files, one prototype.** `engine/mixin.js` copies
  `erasePipeline`, `overlays`, `selection`, `sceneOps` and `files` onto it. They
  are still the engine's methods and run with `this` bound to the engine.
- **Comments, from 2026-09-07 (Kobin):** keep new and edited comments concise. A
  comment says what the code does and the one fact a reader needs not to break
  it (a measurement, a constraint, a pointer such as "DESIGN.md §5" or
  "OPEN-FLAGS F44"). Quotes of conversations, decision histories, first
  attempts and their reversals belong in the design documents, not the code.
  No cleanup pass over the existing long comments (they record measurements
  and wrong turns that do not decay), but a comment that has to change because
  its code changed is rewritten whole to this form — not for a one-line edit
  under a comment that is still true.
- **Redundant code:** before adding a helper, look for the one that exists
  (there were two `VertexSet`s, two `reversePiece`s and three windings until
  2026-09-07). One implementation, one parameter.
- Nothing is committed or pushed unless asked.
