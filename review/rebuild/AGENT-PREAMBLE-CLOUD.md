# Agent preamble — the renderer rebuild, cloud sessions (2026-09-25)

This is the cloud-session form of `.claude/AGENT-PREAMBLE.md` (a copy of that file is in the
tree under `.claude/`, restored from the `claude-context` branch; read it too, it is short). The
repository is Kobin Kempe's bound.less at `/home/user/bound.less-kk-private`, branch
`claude/hopeful-dirac-iotb9n` on top of `rasteriser`. Read `CLAUDE.md`, then `DESIGN.md` for the
sections your brief names, then `review/rebuild/PLAN.md`, then your brief's documents.

1. **Nothing is committed or pushed by an agent.** The orchestrator commits to the session branch.
2. **Comments** (Kobin): concise — what the code does and the one fact a reader needs not to break
   it (a measurement, a constraint, a pointer such as "DESIGN.md §9" or "PLAN §4"). No conversation
   quotes, decision histories or first attempts in code. A comment that must change because its
   code changed is rewritten whole.
3. **Helpers**: before adding one, look for the one that exists. One implementation, one parameter.
4. **Tests run through react-scripts**: `CI=true npx react-scripts test --watchAll=false <path>`
   (a bare `npx jest` finds nothing). Node 22 is the default and runs jest; the dev server needs
   Node 14 (`source /opt/nvm/nvm.sh && nvm use 14 && BROWSER=none npm start`). `npm run typecheck`
   must be 0 errors; `npm run lint` 0 errors. The quick suite (`npm run test:quick`, ~8 min here)
   is run by the orchestrator, not by agents, unless a brief says otherwise. Run whole files, not
   `-t` filters.
5. **A green suite is not evidence a change is good.** Say what was MEASURED, with the number and
   where it came from, never "works".
6. **Browsers**: there is no access to Kobin's Chrome. The container has a headless Chromium 141
   through Playwright 1.56: `node tools/harnesses/browser-check.js http://localhost:3000` against a
   running dev server prints the engine's own counters and screenshots. Headless Chromium draws with
   software GL, so the compositor's costs are invisible; scripting costs and pixels are real. The
   orchestrator runs the browser measurements; a builder may run the harness to check its own work.
7. **Worker bundles**: `npm run build:worker` after any change under `src/engine/geometry`,
   `src/engine/raster/rasterCore.js`, `rasterPack.js`, `rasterJob.js` or `src/engine/worker/`.
8. **Files**: the repo mixes CRLF and LF; keep each file's line endings. Production never imports
   `src/engine/__oracles__/` or `__testkit__/`. The layering lint rule holds (`engine/*` never
   imports `Pages/`, `hooks/`, `cloud/`, `storage/`; `geometry/*` only `geometry/*` and
   `frameLattice`).
9. **Flags**: before naming a new F-number in `docs/OPEN-FLAGS.md`, grep it for the symptom.
10. **The STATUS-LOG** is `review/rebuild/STATUS-LOG.md`: append an entry at start, every 30 minutes
    of work, at every checkpoint and at the end — heading `## <date> — <agent> — <task>`, then
    **Working on**, **Measured**, **Decisions made** (with why), **Questions asked**. Keep entries
    short; the log is read by the next agent.
11. **Your report** (the final message): `status` (done / checkpoint / blocked / partial with what is
    left), `summary`, `filesChanged`, `testsRun` (with counts), `measurements`, `decisions`,
    `leastSure` (at least three, always), `questions` (each with your recommendation), `openItems`.
12. **Questions**: a judgement call or a design-level question goes to the orchestrator with your
    recommendation; you may stop at a checkpoint for it. A question you can answer by analysis you
    can do — do it, and report the analysis.
13. **Break-checks are the builder's deliverable**: for every guard or rule, remove the guarded line
    once on an UNIMPORTED COPY (a private jest config or `--roots` pointing at a copy under the
    scratchpad), count the red tests, and record the count. Never by editing a shared source file in
    place: other agents edit the same tree.
14. **Delete what you replace.** The rebuild's point is fewer mechanisms. A component is done when
    the old mechanism is gone, not when the new one works beside it — except where PLAN.md says a
    flag keeps both for the browser comparison, and then the deletion is a named later step.
15. **Docs kept true**: when `DESIGN.md`, a plan section or a review your change makes false exists,
    fix it in the same task and say so. The design documents under `review/rebuild/` are the
    rebuild's own record; correct them too.
16. **Scratch**: the session scratchpad is `/tmp/claude-0/-home-user-bound-less-kk-private/b82730e6-76c1-5a46-a465-56b24d35c928/scratchpad`;
    write scripts with the Write tool, not shell heredocs. Node experiments: bundle a scratch entry
    that imports repo modules by absolute path with `npx esbuild <entry> --bundle --platform=node
    --format=cjs --outfile=<scratch>/out.cjs` from the repo root, then run it.
17. **Concurrency**: up to two other agents edit this tree at the same time. Your brief names the
    files that are yours; do not edit others' files, and re-read a file before you edit it. Say in
    your status entry which files you are in.
18. **No endless waiters**: any wait loop has a deadline and matches what the job really prints.
