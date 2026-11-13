# Changelog

Versions follow [semantic versioning](https://semver.org): a patch release fixes, a minor release adds, a major
release may change how something works. Drawing files keep opening across releases: every file version a release has
written opens in every later one (`src/engine/compat.files.test.js` holds one file per version).

## 1.0.0 — 2026-11-13

The first numbered release of bound.less.

- **Infinite zoom, tested at the limit.** The zoom is infinite: the only limit is the time it takes to zoom in. It has
  been tested at 10<sup>32,537,245,831,191,544</sup>× zoom, 2⁵³ − 1 levels down; even zooming from the width of the
  Milky Way to a single proton every second, getting there would take more than 28 million years. Drawing, erasing,
  selecting, moving, saving and reloading all work there.
- **Runs of empty levels.** A stretch of levels with nothing drawn is kept as one record, so a jump far down costs a
  few frames of memory at any depth, and every walk over the levels steps such a stretch at once.
- **Depth fixes** found by testing to 10,000 levels in Chrome and to 1,000,000 in the desktop app's browser: crossings,
  renders, erases and moves deep in a drawing no longer slow down or overflow with depth (OPEN-FLAGS F193–F203).
- **Cloud saves of very deep canvases.** A canvas whose list of frames would pass Firestore's 1 MiB document limit now
  saves: past 512 KB the list goes into a chunk of its own (F199).
- **The `.svgi` file.** Drawings download as `.svgi`; `.boundless` and `.boundless.json` files open as before. Each
  file records the version of the app that wrote it (`meta.appVersion`) beside its format version.
- The landing page shows the version where it said "Beta".

The history before 1.0 — the 2021 prototype and the 2026 rebuild — is in [`docs/issue-log.md`](docs/issue-log.md) and
the ledger at the end of [`docs/ROADMAP.md`](docs/ROADMAP.md).
