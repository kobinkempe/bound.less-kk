/**
 * rasterPerf — the five buckets of §8, a fixed ring of main-thread tasks, and the `raster`
 * section of the report payload.
 *
 * A ROW IS ONE MAIN-THREAD TASK and not one frame (§15.3 stage 6 Q1): a render, a camera-only
 * sync, a job's arrival, a crawl tick or a settle, each carrying the `frameSeq` the work belongs
 * to — so a frame's rows join on it (§8.4 rule 1) and `mainMs` is that task's own time, which is
 * what makes `rafDelta − mainMs` mean anything.
 *
 * The ring is 400 rows: `Float32Array(400 × 40)` of timers, `Int32Array(400 × 40)` of counts and
 * `Float64Array(400)` of wall-clock stamps (a float32 holds an epoch millisecond to about two
 * minutes of precision, so `t` cannot be one). 131.2 KB, fixed, allocated on the first note so an
 * SVG-only session pays nothing. Every slot §8.1, §2.7 FC7 and §8.4 rule 2 name is reserved now:
 * adding one after a report has been read is the format change D19 forbids.
 *
 * BROWSER is attributed and never measured (D28). `br.inferred` is `rafDelta − mainMs`, patched
 * onto the row from the frame meter's own rAF loop on the NEXT tick; a row with no delta reports
 * `null`, never 0.
 *
 * Imports `now.js` and nothing else (§2.3, amended by §15.3 stage 6 Q13): `instruments.js` and
 * the report hook both read this module, and neither may pull the packer into its bundle.
 */
import { perfNow } from "../now";

// ---------------------------------------------------------------------------
// The shipped format: the ring's shape and every slot's name.
// ---------------------------------------------------------------------------

/** Rows in the ring. 400 task rows is about 3 s of gesture; the report still emits ≤ 50. */
export const ROWS = 400;
/**
 * Slots per row, both rings. 32 at the 13:20 ruling; **40** since §15.3's "Stage 5b, built
 * whole" Q1 reserved `eng.view`, `eng.lookup` and `ovl.tail`, which is 33 names against 32.
 * Widened rather than packed while the format is still unread (D19); 7 timer slots spare.
 */
export const STRIDE = 40;

/**
 * The timers, in slot order: `[name, bucket, part]`.
 *
 * `part` is what §8.4 rule 2's two sums read, and it is the thing a reader gets wrong:
 *   main      main-thread time, inside `mainMs`
 *   worker    the worker's own clock — inside `mainMs` only on a row where the inline executor
 *             ran the core on the main thread (`noteCore`, §8.1)
 *   wall      a duration the main thread was free for, inside `wallMs` and never `mainMs`
 *   inferred  subtracted, not measured: in neither sum
 *   total     §8.4 rule 2's own four numbers
 */
const TIMER_DEFS = [
    ["eng.list", "ENGINE", "main"],
    ["eng.settle", "ENGINE", "main"],
    ["eng.cull", "ENGINE", "main"],
    ["eng.band", "ENGINE", "main"],
    ["eng.pack", "ENGINE", "main"],
    // §15.3's Q1 of the "Stage 5b, built whole" entry: 5b measured the view mapping and the
    // plate-cache lookup at 1.35–1.96 ms of a 5.2–6.6 ms cold frame, inside rule 2's residual.
    // `RasterRenderer` brackets all three (D244).
    ["eng.view", "ENGINE", "main"],       // camera → view: frameFor and the layer's publish
    ["eng.lookup", "ENGINE", "main"],     // the old store's lookup: no writer since the pyramid (D19 keeps the slot)
    ["eng.clip", "ENGINE", "worker"],     // the per-piece and per-subtree prune (§8.1's note)
    ["eng.local", "ENGINE", "worker"],    // STRUCTURAL ZERO: fused into the edge loop (§8.2, D43)
    ["ras.edges", "RASTERISER", "worker"],
    ["ras.union", "RASTERISER", "worker"],
    ["ras.accum", "RASTERISER", "worker"],
    ["ras.composite", "RASTERISER", "worker"], // STRUCTURAL ZERO: the blend is inside ras.accum
    ["xfer.out", "TRANSFER", "main"],     // the post call itself (`info.postMs`)
    ["xfer.in", "TRANSFER", "main"],      // the unwire and the pool (`info.recvMs`)
    ["xfer.serialise", "TRANSFER", "worker"],
    ["br.bitmap", "BROWSER", "wall"],     // `createImageBitmap` decodes off-thread (Q6)
    ["br.blit", "BROWSER", "main"],       // the compose CALL, not the paint (Q5)
    ["br.inferred", "BROWSER", "inferred"],
    ["ovl.decide", "OVERLAY", "main"],
    ["ovl.paint", "OVERLAY", "main"],
    ["ovl.blit", "OVERLAY", "main"],
    ["ovl.tail", "OVERLAY", "main"],      // the frame's overlay tail after the picture compose
    ["ovl.live", "OVERLAY", "main"],      // reserved for stage L; zero until then
    ["queueWait", "TRANSFER", "wall"],    // queued-at → posted-at (§8.4 rule 3)
    ["queueing", "TRANSFER", "wall"],     // the client's own `queueingMs`
    ["job.recvToStart", "RASTERISER", "wall"],
    ["job.startToFinish", "RASTERISER", "wall"],
    ["mainMs", "", "total"],
    ["wallMs", "", "total"],
    ["residualMain", "", "total"],
    ["residualWall", "", "total"],
    ["rafDelta", "", "total"],
];

/** The counts, in slot order. The first six are the row's identity, not measurements. */
const COUNT_DEFS = [
    "frameSeq", "kind", "mode", "q", "sMilli", "flags",
    "platesWanted", "hits", "misses", "plateBlits",
    "jobsPosted", "jobsArrived", "platesArrived", "bytesOut", "bytesIn", "drops",
    // §8.3's eight per-plate counts, summed over the job's plates
    "items", "itemsDrawn", "families", "unionItems", "edges", "chords", "rowsTouched", "coveredPx",
    // §2.7 FC7's seven, zero until 5d and stage L land
    "antDashes", "antStamps", "antPixels", "overlayBlitPx", "overlayRepaints",
    "liveMoves", "liveDirtyPx",
];

/** Timer name → slot. `rasterPerf.add(T["eng.list"], ms)`. */
export const T = {};
/** Count name → slot. `rasterPerf.bump(C.hits, n)`. */
export const C = {};
/** The timer names in slot order, as the report prints them. */
export const TIMERS = TIMER_DEFS.map((d) => d[0]);
/** The count names in slot order. */
export const COUNTS = COUNT_DEFS.slice();
TIMER_DEFS.forEach((d, i) => { T[d[0]] = i; });
COUNT_DEFS.forEach((n, i) => { C[n] = i; });

if (TIMERS.length > STRIDE || COUNTS.length > STRIDE) {
    throw new Error("rasterPerf: more names than slots");  // caught at module load, never shipped
}

/** The two names that are zero because there is no phase, not because nothing was measured. */
const STRUCTURAL_ZEROS = ["eng.local", "ras.composite"];

/**
 * Which slots each of §8.4 rule 2's sums reads. The main and sync sums are derived from the
 * `part` column above; the WALL one is its own list because two timers belong to BOTH
 * partitions — the queued-to-blitted span contains `br.blit` (part `main`) and the worker's
 * `xfer.serialise` (part `worker`) — and one `part` value a timer cannot say that.
 * Both lists are published as `report().slots.parts` so a reader never has to guess.
 */
const MAIN_PART = TIMER_DEFS.filter((d) => d[2] === "main").map((d) => T[d[0]]);
const SYNC_PART = TIMER_DEFS.filter((d) => d[2] === "worker").map((d) => T[d[0]]);
const WALL_PART = [T["queueWait"], T["queueing"], T["job.recvToStart"], T["job.startToFinish"],
    T["xfer.serialise"], T["br.bitmap"], T["br.blit"]];
/** What `workerT` accumulates: the job's own span and the four phases `ras.plateResidual` subtracts. */
const PLATE_PART = [T["job.startToFinish"], T["eng.clip"], T["eng.local"], T["ras.edges"],
    T["ras.union"], T["ras.accum"]];

const KINDS = ["render", "camera", "arrival", "crawl", "settle"];
/** The three indices the code routes on; read from KINDS so a reorder cannot mis-route silently. */
const K_RENDER = KINDS.indexOf("render");
const K_ARRIVAL = KINDS.indexOf("arrival");
const K_CRAWL = KINDS.indexOf("crawl");
/** Append-only (D19): a row stores the index. "level" and "rest" are the picture pyramid's (A3 §4.6). */
const MODES = ["unknown", "sync", "plates", "settle", "level", "rest"];

/** `q` is a number on the raster path and a letter on the other two; the ring holds integers. */
const Q_SYNC = -1000, Q_SETTLE = -1001, Q_UNKNOWN = -1002;

const FLAG = {
    inferredPending: 1,   // waiting for the next rAF tick
    rafKnown: 2,          // a rAF delta reached this row
    shared: 4,            // several tasks in one rAF interval; the last one carries br.inferred
    spansFrames: 8,       // mainMs is longer than the interval it was patched with
    clamped: 16,          // rafDelta < Σ mainMs, so br.inferred clamped at 0
    rasOnMain: 32,        // the inline executor ran here (`noteCore`): the core's phases belong to `mainMs`
    truncated: 64,        // the row was closed by the next beginFrame, not by endFrame
    hasJob: 128,          // an arrival's numbers are on this row
};

/** §8.4 rule 2's bar: absolute, because 10 % of a 100 ms frame is five pan budgets. */
const RESIDUAL_FLOOR_MS = 1;
const RESIDUAL_FRAC = 0.1;
/** A row names one bucket only if one bucket holds this share of `mainMs` (Q10). */
const DOMINANT = 0.5;
/**
 * The BROWSER clause needs an interval this long (Chrome's own long-animation-frame threshold).
 * Under it `rafDelta − mainMs` is mostly vsync idle: a 1 ms task at 60 Hz leaves 15.7 ms that
 * is nobody's work, and without the floor 39 of 45 rows on the Magnum Opus canvas read BROWSER
 * (D267).
 */
const BROWSER_MIN_INTERVAL_MS = 50;
/** `_perf`'s floor (`KobinEngine.js:360`): under it a job is a ring row and nothing else. */
const PERF_FLOOR_MS = 8;

const MS_BUCKETS = [1, 2, 4, 8, 16, 33, 50, 100, 250, 500];
const FRAMES_KEPT = 25;      // the worst by mainMs, and the last, deduped: ≤ 50 rows
const JOBS_KEPT = 25;
const DROPS_KEPT = 8;
/** Distinct drop reasons tallied beside the 8-deep log; past this one they count as `other`. */
const DROP_WHYS_KEPT = 12;
const PENDING_MAX = 64;      // rows awaiting a rAF patch

/** §8.5: the counters that mean a record was REFUSED are named first, then the source's own order. */
const PACK_FIRST = ["nonFinite", "overBound", "mixedWinding", "mixedFamily", "rejected"];
const GUARD_FIRST = ["nonFinite", "fullClears", "arcClamped", "arcOverTurn"];

// ---------------------------------------------------------------------------
// State. Three typed arrays, allocated once on the first note and never again.
// ---------------------------------------------------------------------------

let F = null;   // Float32Array(ROWS × STRIDE) — the timers
let I = null;   // Int32Array(ROWS × STRIDE)   — the counts
let W = null;   // Float64Array(ROWS)          — wall-clock t

let head = 0, used = 0, wraps = 0;
let open = -1, openT0 = 0, openQueuedAt = 0;
let crawlTicks = 0;

let src = {};                       // what `attach` was given
let clock = perfNow;                // the monotonic clock; injected by the suite
let wall = () => Date.now();        // the wall clock; injected by the suite

const totalsT = new Float64Array(STRIDE);
const totalsC = new Float64Array(STRIDE);
/**
 * The same timers again, summed over the rows the WORKER did that work on — every row not
 * flagged `rasOnMain`. `ras.plateResidual` is a subtraction inside the worker's own job
 * (`startToFinish` less the four phases inside it), and a sync frame writes those four phases on
 * the main thread with no `startToFinish` at all: read out of `totalsT`, a light-ink session
 * reports a NEGATIVE residual (5b's third review).
 */
const workerT = new Float64Array(STRIDE);
const histMain = new Int32Array(MS_BUCKETS.length + 1);
const histWall = new Int32Array(MS_BUCKETS.length + 1);
const histPlate = new Int32Array(MS_BUCKETS.length + 1);
const kindRows = new Int32Array(KINDS.length);

const pending = new Int32Array(PENDING_MAX * 2);   // (row, frameSeq) pairs
let nPending = 0;

/**
 * The submits awaiting their arrivals (§8.4 rule 3), three parallel arrays and no per-post
 * allocation: the frameSeq, the queued-at stamp and how many of that request's strips are still
 * unaccounted for. ONE frame posts at up to three quanta under D182, so a stamp keyed by
 * `frameSeq` alone is overwritten by the next post and the first job's wait is lost (5b's third
 * review); the strip count is what tells two posts of one frame apart on the way back.
 */
const SUBMITS = 64;
const subSeq = new Int32Array(SUBMITS);
const subT = new Float64Array(SUBMITS);
const subLeft = new Int32Array(SUBMITS);
let subAt = 0, nSub = 0;

let jobs = null, nJobs = 0;         // the worst JOBS_KEPT by wallMs, filled in place
let drops = null, nDrops = 0, dropAt = 0;
const dropWhy = new Map();          // why → count: the distribution the 8-deep log cannot hold

const stats = {
    rows: 0, crawls: 0,             // per kind: `ring.byKind`
    allocs: 0,                      // typed arrays and pools this module has allocated
    orphanAdds: 0,                  // a note with no row open
    orphanEnds: 0, unclosed: 0,     // a bracket that did not close, and one closed for it
    pendingLost: 0,                 // rows that left the ring before a rAF tick reached them
    noQueuedAt: 0,                  // an arrival whose request was never seen by `noteSubmit`
    jobs: 0, staleDrops: 0, lastTickT: 0,
    overlayBytes: 0,                // FC7's byte line, from 5d's own `report().bytes`
};

const lastView = { mode: "", q: "", Zq: 0, s: 0, dpr: 0, rev: 0, frameId: "" };

function ensure() {
    if (F) return;
    F = new Float32Array(ROWS * STRIDE);
    I = new Int32Array(ROWS * STRIDE);
    W = new Float64Array(ROWS);
    jobs = [];
    for (let k = 0; k < JOBS_KEPT; k++) jobs.push(mkJobRec());
    drops = [];
    for (let k = 0; k < DROPS_KEPT; k++) drops.push(mkDropRec());
    stats.allocs += 5;
}

function mkJobRec() {
    return { t: 0, frameSeq: 0, jobId: 0, plates: 0, postedToArrivedMs: 0, queueWaitMs: 0, queueingMs: 0,
        workerMs: 0, serialiseMs: 0, postMs: 0, recvMs: 0, bytesIn: 0, bytesOut: 0,
        inline: false, stale: 0 };
}
function mkDropRec() {
    return { t: 0, why: "", before: false, jobId: 0, frameSeq: 0, q: "", frameId: "",
        plates: 0, stale: 0 };
}

// ---------------------------------------------------------------------------
// Wiring. 5b calls `attach` in the renderer's constructor and `detach` in `destroy` (Q12, H1).
// ---------------------------------------------------------------------------

/**
 * @param {object} s
 *   layer, store          the two shipped `report()` objects (`PicturePyramid`, `PyramidStore`)
 *   workerReport, pack, core, ants   the other four scalar sources — this module imports
 *                         nothing, so they come in here rather than being reached for
 *   notePerf(op, t0, extra)   the engine's own log, for the three ops of §8.5
 *   trace()               true in trace mode, so a sub-8 ms job still reaches `notePerf`
 *   now(), wall()         the two clocks; the suite injects both
 */
export function attach(s) {
    src = s || {};
    if (typeof src.now === "function") clock = src.now;
    if (typeof src.wall === "function") wall = src.wall;
}

/** Forget the sources. The ring is kept: a report sent after a teardown still has its rows. */
export function detach() { src = {}; }

/** The suite's reset, and the only way the ring is freed. */
export function reset() {
    F = null; I = null; W = null; jobs = null; drops = null;
    head = 0; used = 0; wraps = 0; open = -1; openT0 = 0; openQueuedAt = 0; crawlTicks = 0;
    nJobs = 0; nDrops = 0; dropAt = 0; nPending = 0;
    totalsT.fill(0); totalsC.fill(0); workerT.fill(0);
    histMain.fill(0); histWall.fill(0); histPlate.fill(0); kindRows.fill(0);
    subSeq.fill(0); subT.fill(0); subLeft.fill(0); subAt = 0; nSub = 0;
    dropWhy.clear();
    for (const k of Object.keys(stats)) stats[k] = 0;
    src = {}; clock = perfNow; wall = () => Date.now();
    lastView.mode = ""; lastView.q = ""; lastView.Zq = 0; lastView.s = 0;
    lastView.dpr = 0; lastView.rev = 0; lastView.frameId = "";
}

// ---------------------------------------------------------------------------
// The row: one bracketed main-thread task.
// ---------------------------------------------------------------------------

/**
 * Open a row. `kind` is one of KINDS; a `frameSeq` of 0 is what X2 exists to catch, so it is
 * written as given and the report says which rows carry one.
 */
/** `backMs`: main time this task spent before the row could open (an arrival's unwire, `xfer.in`). */
export function beginFrame(frameSeq, kind, backMs = 0) {
    ensure();
    if (open >= 0) { stats.unclosed++; closeRow(FLAG.truncated); }
    open = head;
    const base = open * STRIDE;
    F.fill(0, base, base + STRIDE);
    I.fill(0, base, base + STRIDE);
    W[open] = wall();
    openT0 = clock() - (backMs > 0 ? backMs : 0);
    openQueuedAt = 0;
    I[base + C.frameSeq] = frameSeq | 0;
    I[base + C.kind] = kindCode(kind);
    I[base + C.q] = Q_UNKNOWN;
    return open;
}

/**
 * Close the open row: `mainMs` is the bracket's own time, and the two residuals follow.
 * The engine's perf log is left for the rare slow frame — a render under its 8 ms floor is a
 * ring row and nothing else, which is why the ring exists (§8.5, `KobinEngine.js:360`).
 */
export function endFrame() {
    if (open < 0) { stats.orphanEnds++; return null; }
    const base = open * STRIDE;
    const end = clock();
    const ms = end - openT0;
    F[base + T.mainMs] = ms;
    const t0 = openT0;
    const row = closeRow(0, end);
    if (src.notePerf && I[(row * STRIDE) + C.kind] === K_RENDER
        && (ms >= PERF_FLOOR_MS || traceOn())) {
        src.notePerf("rasterRender", t0, perfExtra(row));
    }
    return row;
}

/** Add milliseconds to one timer slot of the open row (H4). */
export function add(slot, ms) {
    if (open < 0) { stats.orphanAdds++; return; }
    if (!(ms >= 0) || !isFinite(ms)) return;
    F[(open * STRIDE) + slot] += ms;
}

/** Add to one count slot of the open row. */
export function bump(slot, n) {
    if (open < 0) { stats.orphanAdds++; return; }
    I[(open * STRIDE) + slot] += n | 0;
}

/** The published view (H10): `q`, `s` and the mode on every row (§8.4 rule 5). */
export function noteView(view) {
    if (!view) return;
    lastView.mode = String(view.mode || "");
    lastView.q = view.q;
    lastView.Zq = +view.Zq || 0;
    lastView.s = +view.s || 0;
    lastView.dpr = +view.dpr || 0;
    lastView.rev = +view.rev || 0;
    lastView.frameId = String(view.frameId == null ? "" : view.frameId);
    if (open < 0) return;
    const base = open * STRIDE;
    I[base + C.q] = qCode(view.q);
    I[base + C.mode] = MODES.indexOf(lastView.mode) < 0 ? 0 : MODES.indexOf(lastView.mode);
    I[base + C.sMilli] = Math.round((+view.s || 0) * 1000);
}

/**
 * The core ran on THIS thread — the pyramid's inline executor (A3 §2.3, §2.5): its clip, edges, union and accum into
 * the open row, flagged `rasOnMain`, so §8.4 rule 2 reads them inside `mainMs` and `ras.plateResidual` leaves the row
 * out. The executor runs in camera steps and commits, never in a job's arrival row (whose phases are the worker's).
 */
export function noteCore(c) {
    if (open < 0) { stats.orphanAdds++; return; }
    I[open * STRIDE + C.flags] |= FLAG.rasOnMain;
    add(T["eng.clip"], +c.clipMs || 0);
    add(T["ras.edges"], +c.edgesMs || 0);
    add(T["ras.union"], +c.unionMs || 0);
    add(T["ras.accum"], +c.accumMs || 0);
}

/** @param {number} [endAt] the caller's own clock read, so a row is never stamped twice. */
function closeRow(extraFlags, endAt) {
    const row = open;
    const base = row * STRIDE;
    if (extraFlags) I[base + C.flags] |= extraFlags;
    // §8.4 rule 2's second total is QUEUED TO BLITTED, and it is measured, not summed: the
    // client's own `wallMs` starts at the post and stops at the arrival, so neither the queue
    // wait nor the compose is in it. Both spans are taken HERE and not in `endFrame`, so a row
    // closed by the next `beginFrame` keeps its wall partition and not only `mainMs`.
    const needEnd = extraFlags === FLAG.truncated || (openQueuedAt > 0 && !F[base + T.wallMs]);
    const end = needEnd && endAt == null ? clock() : endAt;
    if (extraFlags === FLAG.truncated) F[base + T.mainMs] = end - openT0;
    if (openQueuedAt > 0 && !F[base + T.wallMs]) F[base + T.wallMs] = end - openQueuedAt;

    const sync = (I[base + C.flags] & FLAG.rasOnMain) !== 0;
    let main = 0;
    for (const s of MAIN_PART) main += F[base + s];
    if (sync) for (const s of SYNC_PART) main += F[base + s];
    F[base + T.residualMain] = F[base + T.mainMs] - main;
    if (F[base + T.wallMs] > 0) {
        let w = 0;
        for (const s of WALL_PART) w += F[base + s];
        F[base + T.residualWall] = F[base + T.wallMs] - w;
    }

    for (let s = 0; s < TIMERS.length; s++) totalsT[s] += F[base + s];
    // Both sides of `ras.plateResidual` come from the SAME rows, so a sync frame cannot make it
    // negative and a worker job cannot leave it unexplained.
    if (!sync) for (const s of PLATE_PART) workerT[s] += F[base + s];
    for (let s = C.platesWanted; s < COUNTS.length; s++) totalsC[s] += I[base + s];
    bucketOf(histMain, F[base + T.mainMs]);
    if (F[base + T.wallMs] > 0) bucketOf(histWall, F[base + T.wallMs]);
    kindRows[I[base + C.kind]]++;
    stats.rows++;

    if (nPending < PENDING_MAX) {
        pending[nPending * 2] = row;
        pending[nPending * 2 + 1] = I[base + C.frameSeq];
        nPending++;
        I[base + C.flags] |= FLAG.inferredPending;
    } else {
        stats.pendingLost++;
    }

    head = (head + 1) % ROWS;
    if (head === 0) wraps++;
    if (used < ROWS) used++;
    open = -1;
    return row;
}

function perfExtra(row) {
    const base = row * STRIDE;
    return { frameSeq: I[base + C.frameSeq], kind: KINDS[I[base + C.kind]],
        mainMs: ms3(F[base + T.mainMs]), residualMs: ms3(F[base + T.residualMain]) };
}

// ---------------------------------------------------------------------------
// The jobs: queued-at, the arrival, the bitmap, the compose, the drop.
// ---------------------------------------------------------------------------

/**
 * A strip about to be dispatched (H5): `at` is when it was queued (the `JobQueue`'s push), so an arrival's wall
 * starts there, and `nStrips` is how many arrivals will claim the stamp.
 *
 * `nPlates` is the row's MISSES; the hits are `noteCompose`'s, so `platesWanted` is the two
 * added and nothing counts a plate twice (§8.4 rule 5).
 */
export function noteSubmit(req, nPlates, nStrips, at) {
    ensure();
    const seq = req && req.frameSeq != null ? req.frameSeq | 0 : 0;
    subSeq[subAt] = seq;
    subT[subAt] = at != null ? at : clock();
    subLeft[subAt] = Math.max(1, nStrips | 0);
    subAt = (subAt + 1) % SUBMITS;
    if (nSub < SUBMITS) nSub++;
    if (open < 0) return;
    const base = open * STRIDE;
    I[base + C.jobsPosted] += nStrips | 0;
    I[base + C.misses] += nPlates | 0;
    I[base + C.platesWanted] += nPlates | 0;
}

/**
 * The queued-at stamp that belongs to ONE arriving job: the newest submit of its `frameSeq`
 * stamped at or before that job's post which still has strips unclaimed, and — when every one of
 * them is claimed — the newest at or before the post. A frame that posts at two quanta carries
 * one `frameSeq` and two stamps, and the arrival brings back `frameSeq` and `postedAt` and no
 * `q`, so those two are what tell the posts apart (§15.3 Stage 5b Q7).
 * @returns {number} the stamp, or -1 where this frameSeq submitted nothing before the post
 */
function queuedAtFor(seq, postedAt) {
    let spent = -1;
    for (let k = 0; k < nSub; k++) {
        const at = (subAt - 1 - k + SUBMITS * 2) % SUBMITS;   // newest first: `subT` only grows
        if (subSeq[at] !== seq || subT[at] > postedAt) continue;
        if (subLeft[at] > 0) { subLeft[at]--; return subT[at]; }
        if (spent < 0) spent = at;
    }
    return spent < 0 ? -1 : subT[spent];
}

/**
 * A job's arrival (H6): the wall partition, the worker's per-plate phases and counts.
 * Reads DURATIONS only — the worker's clock origin is its own (§8.2, X6).
 */
export function noteJob(info, res) {
    ensure();
    stats.jobs++;
    if (open < 0) { stats.orphanAdds++; return; }
    const base = open * STRIDE;
    I[base + C.flags] |= FLAG.hasJob;

    const q = queuedAtFor(info.frameSeq | 0, info.postedAt);
    if (q < 0) stats.noQueuedAt++;
    else {
        if (info.postedAt > q) F[base + T.queueWait] += info.postedAt - q;
        if (!openQueuedAt || q < openQueuedAt) openQueuedAt = q;
    }

    F[base + T.queueing] += +info.queueingMs || 0;
    // `xfer.in` is this task's own unwire and pool return, so it is main-thread time on THIS
    // row. `postMs` is not: the post ran in the task that submitted, and it rides the job
    // record beside the wall partition instead (Q7). `xfer.out` is the poster's own bracket.
    F[base + T["xfer.in"]] += +info.recvMs || 0;
    F[base + T["xfer.serialise"]] += +(res && res.serialiseMs) || 0;
    I[base + C.bytesOut] += info.bytesOut | 0;
    I[base + C.bytesIn] += info.bytesIn | 0;
    I[base + C.jobsArrived] += 1;

    let workerMs = 0;
    const nPlates = res && res.plates ? res.plates.length / 2 : 0;
    if (res && res.timings && nPlates > 0) {
        // The stride is §8.2's seven and §8.3's eight; `rasterJob.js` exports both and this
        // module imports nothing, so the suite pins these two against those exports.
        const st = res.timings.length / nPlates;
        for (let p = 0; p < nPlates; p++) {
            const o = p * st;
            F[base + T["job.recvToStart"]] += res.timings[o];
            F[base + T["job.startToFinish"]] += res.timings[o + 1];
            F[base + T["eng.clip"]] += res.timings[o + 2];
            F[base + T["eng.local"]] += res.timings[o + 3];
            F[base + T["ras.edges"]] += res.timings[o + 4];
            F[base + T["ras.union"]] += res.timings[o + 5];
            F[base + T["ras.accum"]] += res.timings[o + 6];
            workerMs += res.timings[o] + res.timings[o + 1];
            bucketOf(histPlate, res.timings[o + 1]);
        }
    }
    if (res && res.counts && nPlates > 0) {
        const sc = res.counts.length / nPlates;
        for (let p = 0; p < nPlates; p++) {
            for (let k = 0; k < sc && k < 8; k++) I[base + C.items + k] += res.counts[p * sc + k];
        }
    }
    I[base + C.platesArrived] += nPlates;

    const staleN = info.stale && info.stale.stale ? info.stale.stale.length : 0;
    takeJob(info, res, workerMs, staleN, q);
    if (src.notePerf && ((+info.wallMs || 0) >= PERF_FLOOR_MS || traceOn())) {
        src.notePerf("rasterJob", info.postedAt, {
            frameSeq: info.frameSeq, plates: nPlates, wallMs: ms3(info.wallMs),
            queueingMs: ms3(info.queueingMs), bytesIn: info.bytesIn | 0,
        });
    }
}

/** `br.bitmap` (H7): a WALL duration — `createImageBitmap` decodes off-thread (Q6). */
export function noteBitmap(ms) { add(T["br.bitmap"], ms); }

/**
 * `br.blit` (H8). On the render path this is `layer.compose(hits)`; on the arrival path it is
 * the whole `onPlateBatch` bracket — the store puts, the paper fill, the blits and the re-post —
 * as `eng.clip` is the prune and not a boolean clip (§8.1's precedent).
 */
export function noteCompose(ms, plates, blits) {
    add(T["br.blit"], ms);
    if (open < 0) return;
    const base = open * STRIDE;
    I[base + C.plateBlits] += blits | 0;
    // On an ARRIVAL row the plates composed are the ones that just arrived, which
    // `platesArrived` already counts; a cache hit is a plate the render found (§8.4 rule 5).
    if (I[base + C.kind] !== K_ARRIVAL) {
        I[base + C.hits] += plates | 0;
        I[base + C.platesWanted] += plates | 0;
    }
}

/**
 * A stale or dropped job (H9), with why and with before/after dispatch (§8.4 rule 4).
 * The last 8 are kept in full and EVERY one is counted by reason (§8.5): a phone that dropped
 * 300 strips would otherwise report eight whys and one total.
 */
export function noteDrop(req, d) {
    ensure();
    stats.staleDrops++;
    if (open >= 0) I[(open * STRIDE) + C.drops] += 1;
    const r = drops[dropAt];
    r.t = wall();
    r.why = String((d && d.why) || "");
    tallyDrop(r.why);
    r.before = !!(d && d.before);
    r.jobId = (d && d.jobId) || 0;
    r.frameSeq = pick(d, req, "frameSeq", 0);
    r.q = String(pick(d, req, "q", ""));
    r.frameId = String(pick(d, req, "frameId", ""));
    r.plates = d && d.plates ? (d.plates.length / 2) | 0 : 0;
    r.stale = d && d.stale ? d.stale.length : 0;
    dropAt = (dropAt + 1) % DROPS_KEPT;
    if (nDrops < DROPS_KEPT) nDrops++;
    if (src.notePerf) {
        src.notePerf("rasterStale", clock(), { why: r.why, before: r.before, q: r.q,
            frameSeq: r.frameSeq, plates: r.plates });
    }
}

/**
 * FC7's crawl tick (H11): a 50 ms timer with no render behind it, so it is a row of its own.
 * `rep` is the layer's `report()` — `{ phases, lastPhaseMs, pixels, bytes, repaints }`, and the
 * tick's `paintMs` / `blitMs` / `mainMs`. A tick decides nothing: `decideMs` is the last decision's,
 * charged in the render row that made it (`ovl.tail`), so `ovl.decide` stays 0 here (charged in every
 * tick, a dense drop's 778 ms decision showed as 903–924 ms "crawl" rows).
 * A crawl numbers in its own NEGATIVE space, so a tick can never collide with a render's seq.
 */
export function noteCrawl(rep) {
    ensure();
    if (!rep) return null;
    if (open >= 0) { stats.unclosed++; closeRow(FLAG.truncated); }
    crawlTicks++;
    open = head;
    const base = open * STRIDE;
    F.fill(0, base, base + STRIDE);
    I.fill(0, base, base + STRIDE);
    W[open] = wall();
    openT0 = clock();
    openQueuedAt = 0;             // a tick has no job behind it, and a stale stamp would give it one
    I[base + C.frameSeq] = -crawlTicks;
    I[base + C.kind] = K_CRAWL;
    I[base + C.q] = qCode(lastView.q);
    I[base + C.mode] = Math.max(0, MODES.indexOf(lastView.mode));
    I[base + C.sMilli] = Math.round(lastView.s * 1000);

    const decide = 0;
    const paint = rep.paintMs != null ? +rep.paintMs : (+rep.lastPhaseMs || 0);
    const blit = +rep.blitMs || 0;
    const live = +rep.liveMs || 0;
    F[base + T["ovl.decide"]] = decide;
    F[base + T["ovl.paint"]] = paint;
    F[base + T["ovl.blit"]] = blit;
    F[base + T["ovl.live"]] = live;
    F[base + T.mainMs] = rep.mainMs != null ? +rep.mainMs : decide + paint + blit + live;
    I[base + C.antDashes] = rep.dashes | 0;
    I[base + C.antStamps] = rep.stamps | 0;
    I[base + C.antPixels] = rep.pixels | 0;
    I[base + C.overlayBlitPx] = rep.blitPx | 0;
    I[base + C.overlayRepaints] = rep.repaints | 0;
    I[base + C.liveMoves] = rep.liveMoves | 0;
    I[base + C.liveDirtyPx] = rep.liveDirtyPx | 0;
    if (rep.bytes != null) stats.overlayBytes = rep.bytes | 0;
    stats.crawls = crawlTicks;
    return closeRow(0);
}

/**
 * The frame meter's rAF loop (H/Q8). `br.inferred = rafDelta − Σ mainMs` of the tasks in the
 * interval, attributed to the LAST of them; the others carry the delta and a `shared` flag.
 * Nothing is inferred until a tick arrives, so a row that never gets one reports null.
 */
export function onFrame(deltaMs, ts) {
    if (!F || !nPending) return;
    if (!(deltaMs >= 0) || !isFinite(deltaMs)) { nPending = 0; return; }
    let sumMain = 0, n = 0;
    for (let k = 0; k < nPending; k++) {
        const row = pending[k * 2];
        const base = row * STRIDE;
        if (I[base + C.frameSeq] !== pending[k * 2 + 1]) continue;   // overwritten by the ring
        sumMain += F[base + T.mainMs];
        n++;
    }
    const infer = deltaMs - sumMain;
    for (let k = 0; k < nPending; k++) {
        const row = pending[k * 2];
        const base = row * STRIDE;
        if (I[base + C.frameSeq] !== pending[k * 2 + 1]) { stats.pendingLost++; continue; }
        F[base + T.rafDelta] = deltaMs;
        I[base + C.flags] |= FLAG.rafKnown;
        I[base + C.flags] &= ~FLAG.inferredPending;
        if (n > 1) I[base + C.flags] |= FLAG.shared;
        if (F[base + T.mainMs] > deltaMs) I[base + C.flags] |= FLAG.spansFrames;
        if (infer < 0) I[base + C.flags] |= FLAG.clamped;
        if (k === nPending - 1) {
            F[base + T["br.inferred"]] = infer > 0 ? infer : 0;
            totalsT[T["br.inferred"]] += infer > 0 ? infer : 0;
        }
    }
    totalsT[T.rafDelta] += deltaMs;
    stats.lastTickT = ts != null ? ts : wall();
    nPending = 0;
}

// ---------------------------------------------------------------------------
// The two projections: `GrowthLog`'s three numbers and the report's section.
// ---------------------------------------------------------------------------

/**
 * What `GrowthLog` samples instead of the SVG node count (§8.5): the plate cache's size and
 * bytes, and the packer's memo (`packStats.memoBytes`, which is NOT the session's transferred
 * bytes — `rasterWorkerReport().bytesOut` is that). Null when nothing is attached.
 */
export function growth() {
    if (!src.store && !src.pack) return null;
    let plates = null, plateBytes = null, packedBytes = null;
    if (src.store && src.store.report) {
        const r = src.store.report();
        plates = r.plates; plateBytes = r.plateBytes;
    }
    if (src.pack && src.pack.memoBytes != null) packedBytes = src.pack.memoBytes;
    return { plates, plateBytes, packedBytes };
}

/**
 * The report's `raster` section (§8.5). Bounded by construction (F58): ≤ 50 rows, ≤ 25 jobs,
 * ≤ 8 drops, histograms rather than samples, and five flat scalar objects.
 * @param {object} [opts.longFrames] the `LongFrames` instrument, joined by wall-clock overlap
 * @param {number} [opts.payloadBytes] the whole body's size where the caller already knows it.
 *   The report hook does not: it stringifies the body ONCE and patches the count into this
 *   section's own `"reportBytes":null` hole (`useKobinEngine.js`, §15.3 stage 6 addition 2).
 */
export function report(opts) {
    const o = opts || {};
    const loaf = o.longFrames && o.longFrames.report ? o.longFrames.report() : null;
    const rows = pickRows();
    const pic = src.layer && src.layer.report ? src.layer.report() : null;
    const st = src.store && src.store.report ? src.store.report() : null;
    const out = {
        v: 1,
        ring: {
            rows: ROWS, stride: STRIDE, used, wraps, open: open >= 0,
            bytes: ROWS * STRIDE * 4 * 2 + ROWS * 8,
            allocated: !!F,
            rowsWritten: stats.rows, byKind: namedInts(KINDS, kindRows),
        },
        slots: {
            timers: TIMERS.slice(), counts: COUNTS.slice(),
            spare: { timers: STRIDE - TIMERS.length, counts: STRIDE - COUNTS.length },
            zeros: STRUCTURAL_ZEROS.slice(),
            parts: {
                main: MAIN_PART.map((s) => TIMERS[s]),
                wall: WALL_PART.map((s) => TIMERS[s]),
                worker: SYNC_PART.map((s) => TIMERS[s]),
                inferred: ["br.inferred"],
            },
            kinds: KINDS.slice(), modes: MODES.slice(),
        },
        totals: totalsOf(),
        counts: countsOf(),
        hist: {
            labels: histLabels(),
            mainMs: namedInts(histLabels(), histMain),
            wallMs: namedInts(histLabels(), histWall),
            plateMs: namedInts(histLabels(), histPlate),
        },
        frames: rows.map((r) => rowOut(r, loaf)),
        worstJobs: jobsOut(),
        stale: dropsOut(),
        staleByWhy: Object.fromEntries(dropWhy),
        view: { mode: lastView.mode, q: lastView.q, Zq: lastView.Zq, s: lastView.s,
            dpr: lastView.dpr, rev: lastView.rev, frameId: lastView.frameId },
        memory: {
            plateBytes: st ? st.plateBytes : null,
            staleBytes: st && st.staleBytes != null ? st.staleBytes : null,
            canvasBytes: pic ? pic.canvasBytes : null,
            layerBytes: pic ? pic.layerBytes : null,
            packedBytes: src.pack ? src.pack.memoBytes : null,
            overlayBytes: stats.overlayBytes,
            ringBytes: ROWS * STRIDE * 4 * 2 + ROWS * 8,
        },
        picture: pic,
        plates: st,
        worker: workerOut(),
        pack: firstNamed(src.pack, PACK_FIRST),
        core: firstNamed(src.core, GUARD_FIRST),
        ants: src.ants ? { ...src.ants } : null,
        loaf: loaf ? { supported: loaf.supported, count: loaf.count, totalMs: loaf.totalMs,
            kept: loaf.worst.length } : "absent",
        meta: { ...stats },
        notes: NOTES,
        size: { sectionBytes: 0, reportBytes: o.payloadBytes != null ? o.payloadBytes : null },
    };
    // The section's own weight, measured before the number is written in — so it is short by
    // the digits of the number itself and by nothing else (§15.3 stage 6, addition 2).
    out.size.sectionBytes = byteLen(JSON.stringify(out));
    return out;
}

/**
 * F58's bar is BYTES: a string's `length` is characters and undercounts anything non-ASCII.
 * Exported because the report hook measures the WHOLE body with it (`size.reportBytes`), which
 * is the 16–92 MB half and the one an undercount would matter in.
 *
 * `TextEncoder` where there is one (92 MB in 32–38 ms, at the cost of a 92 MB array it throws
 * away); the scan where there is not — jsdom has no `TextEncoder`, and a fallback that returns
 * characters would have made every number this function reports in a test a lie. 204–277 ms on
 * the same 92 MB, allocating nothing.
 */
const utf8 = typeof TextEncoder === "function" ? new TextEncoder() : null;
export function byteLen(s) {
    if (utf8) return utf8.encode(s).length;
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length
            && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) { n += 4; i++; }
        else n += 3;   // includes a LONE surrogate: 3 bytes, as `format2.js`'s utf8Encode has it
    }
    return n;
}

/** §8.5's order: the named counters first, then whatever else the source carries, unchanged. */
function firstNamed(o, first) {
    if (!o) return null;
    const out = {};
    for (const k of first) if (o[k] !== undefined) out[k] = o[k];
    for (const k of Object.keys(o)) if (out[k] === undefined) out[k] = o[k];
    return out;
}

/** The pool's own report, with its guards put in §8.5's order. */
function workerOut() {
    if (typeof src.workerReport !== "function") return null;
    const w = src.workerReport();
    if (!w || !w.guards) return w || null;
    return { ...w, guards: firstNamed(w.guards, GUARD_FIRST) };
}

/** The sentences a reader of the JSON needs; a counter with no sentence beside it is an alarm. */
const NOTES = {
    mixedWinding: "F76: reads non-zero on an ordinary fat stroke, whose covered tiles and "
        + "uncovered ones are wound against each other. Not an alarm until F76 closes; a "
        + "broken invariant afterwards (D139).",
    overBound: "items whose drawn box passes §4.6's 2.6e5 frame units. Read off the box since "
        + "D287 (an arc's centre and radius used to trip it); non-zero is a real coordinate.",
    brInferred: "inferred by subtraction, never measured: rafDelta - mainMs, patched on the "
        + "next rAF tick. null means no tick reached the row, never a fast browser (D28). It "
        + "headlines a row only on an interval over 50 ms: under that, a 1 ms task at 60 Hz "
        + "leaves 15 ms of vsync idle that is nobody's work (D267).",
    shared: "several tasks ran in ONE rAF interval: the remainder is written to the LAST of "
        + "them, so br.inferred 0 on a row flagged `shared` says this row does not own the "
        + "remainder - never that the browser was free (D209, D248). Only that last row can be "
        + "headlined BROWSER; the others name their own top bucket.",
    engLocal: "a structural zero: the transform to plate pixels is fused into the edge loop, "
        + "so there is no phase to clock and its cost is inside ras.edges (§8.2, D43).",
    engRow: "a render row is opened by KobinEngine._render BEFORE the table's sync and closed at the "
        + "end of RasterRenderer.render, so eng.list is inside mainMs. The §5.4 plate drain runs "
        + "inside the row as well and has no slot of its own: it reads in residualMain. The "
        + "engine's update() and emit() are outside the row (§8.1).",
    unwritten: "eng.settle and eng.band have NO CALLER in the tree: slots reserved before the "
        + "format is read (D19), not phases measured at 0. The settle's timer task has a row of "
        + "its own, kind settle, and its pack and post are eng.pack and xfer.out there (D266); "
        + "eng.band is built inside packJob and its cost is in eng.pack. Each name leaves this "
        + "list when something writes it.",
    rasComposite: "a structural zero: the blend into RGBA is inside ras.accum and the paper "
        + "fill runs before the first clock read; neither has a slot of its own.",
    residual: "residualMain = mainMs - the main-part timers; residualWall = wallMs - the "
        + "wall-part ones. The bar is max(1 ms, 10 %) and a residual that is not small is "
        + "itself the finding (§8.4 rule 2).",
    loaf: "joined at report time by wall-clock overlap against the 25 worst LoAF entries only: "
        + "a row slow in these buckets but under Chrome's 50 ms LoAF threshold joins nothing, "
        + "which is not evidence of anything.",
    sMilli: "the row's stretch, stored as thousandths: report metadata, not a measurement.",
    queueWait: "queued-at is the request's own stamp, taken before the dispatch, so this span "
        + "holds that strip's own pack as well as the time it waited. A job claims the newest "
        + "stamp of its frameSeq at or before its post that still has strips unclaimed, which is "
        + "what keeps the two requests of a frame posted at two quanta apart (§8.4 rule 3).",
    core: "the MAIN thread's own guards, which move only where the inline executor runs the core on "
        + "the main thread. worker.guards is the pool's session totals: the same names, two "
        + "sources, and neither is the other's subset.",
    staleByWhy: "every drop counted by its reason; `stale` holds the last 8 in full. A "
        + "thirteenth distinct reason counts as `other` (§8.5).",
    truncated: "a row closed by the next beginFrame rather than by endFrame. mainMs and the "
        + "wall partition are taken at that moment; what is lost is whatever the task had still "
        + "to note.",
    reportBytes: "the WHOLE report body in bytes, patched into this field by the sender after "
        + "its one stringify, so it is short by the digits of the number itself. null means no "
        + "sender filled it in (F58).",
};

// ---------------------------------------------------------------------------
// Report helpers. None of this runs on the drawing path.
// ---------------------------------------------------------------------------

function pickRows() {
    if (!F || !used) return [];
    const all = [];
    for (let k = 0; k < used; k++) all.push((head - 1 - k + ROWS * 2) % ROWS);
    const last = all.slice(0, FRAMES_KEPT);
    const worst = all.slice().sort((a, b) => F[b * STRIDE + T.mainMs] - F[a * STRIDE + T.mainMs])
        .slice(0, FRAMES_KEPT);
    const seen = new Set(), out = [];
    for (const r of worst.concat(last)) { if (!seen.has(r)) { seen.add(r); out.push(r); } }
    return out.sort((a, b) => W[a] - W[b]);
}

function rowOut(row, loaf) {
    const base = row * STRIDE;
    const flags = I[base + C.flags];
    const out = {
        t: W[row],
        frameSeq: I[base + C.frameSeq],
        kind: KINDS[I[base + C.kind]],
        mode: MODES[I[base + C.mode]],
        q: qOf(I[base + C.q]),
        s: +(I[base + C.sMilli] / 1000).toFixed(3),
        mainMs: ms3(F[base + T.mainMs]),
        residualMainMs: ms3(F[base + T.residualMain]),
        timers: {}, counts: {},
        verdict: verdictFor(base),
    };
    if (F[base + T.wallMs] > 0) {
        out.wallMs = ms3(F[base + T.wallMs]);
        out.residualWallMs = ms3(F[base + T.residualWall]);
    }
    for (let s = 0; s < TIMERS.length; s++) {
        if (s === T.mainMs || s === T.wallMs || s === T.residualMain || s === T.residualWall) continue;
        if (s === T["br.inferred"] || s === T.rafDelta) continue;
        if (F[base + s] !== 0) out.timers[TIMERS[s]] = ms3(F[base + s]);
    }
    out.timers["br.inferred"] = (flags & FLAG.rafKnown) ? ms3(F[base + T["br.inferred"]]) : null;
    for (let s = C.platesWanted; s < COUNTS.length; s++) {
        if (I[base + s] !== 0) out.counts[COUNTS[s]] = I[base + s];
    }
    const fl = flagNames(flags);
    if (fl.length) out.flags = fl;
    const hit = loaf ? loafFor(W[row], F[base + T.mainMs], loaf) : null;
    if (hit) out.loaf = hit;
    return out;
}

/** §8.1's join: any LoAF entry whose interval intersects the row's, with the overlap. */
function loafFor(t, mainMs, loaf) {
    if (!loaf.supported || !loaf.worst || !loaf.worst.length) return null;
    const t1 = t + mainMs;
    let best = null, bestOv = 0;
    for (const e of loaf.worst) {
        const ov = Math.min(t1, e.t + e.ms) - Math.max(t, e.t);
        if (ov > bestOv) { bestOv = ov; best = e; }
    }
    if (!best) return null;
    return { t: best.t, ms: best.ms, paintMs: best.paintMs, scriptMs: best.scriptMs,
        overlapMs: +bestOv.toFixed(1) };
}

/**
 * Q10's rule, printed on every row: one bucket when the residual is inside max(1 ms, 10 %) and
 * one bucket holds half the attributed time — otherwise `ambiguous` and why. The residual rides
 * beside the verdict, so a row that passed on the 1 ms floor shows. A rAF delta shorter than the
 * task (two callbacks back to back around it) makes the interval unusable, not the brackets: the
 * row names its bucket with `corroborated: false` and says why (D273).
 *
 * ONE CLAUSE SITS ABOVE THE SHARE: when the rAF delta is known, the interval is over
 * `BROWSER_MIN_INTERVAL_MS` and `br.inferred` exceeds `mainMs`, the bucket is BROWSER however
 * the task's own time divides, because most of the frame happened outside the task. `share` is
 * still taken of `mainMs` (D209) and `top` still names the largest main-thread bucket, so
 * nothing is lost — a 5 ms task with 4.5 ms of `eng.cull` inside a 100 ms interval reads
 * `bucket BROWSER, top ENGINE`, which is the F39 class ("I zoom and it won't render") this
 * verdict exists to name. A 1 ms task inside a 16.7 ms interval names its own bucket (D267).
 *
 * A task inside the 1 ms floor reads `trivial`: there is nothing to attribute, and calling a
 * 0.1 ms stale arrival `ambiguous` put ten of them in every report's count (D270).
 */
function verdictFor(base) {
    const main = F[base + T.mainMs];
    const res = F[base + T.residualMain];
    const bar = Math.max(RESIDUAL_FLOOR_MS, main * RESIDUAL_FRAC);
    const sync = (I[base + C.flags] & FLAG.rasOnMain) !== 0;
    const by = {};
    let top = "", topMs = 0;
    const slots = sync ? MAIN_PART.concat(SYNC_PART) : MAIN_PART;
    for (const s of slots) {
        const v = F[base + s];
        if (v <= 0) continue;
        const b = TIMER_DEFS[s][1];
        by[b] = (by[b] || 0) + v;
        if (by[b] > topMs) { topMs = by[b]; top = b; }
    }
    const rafKnown = (I[base + C.flags] & FLAG.rafKnown) !== 0;
    const raf = rafKnown ? F[base + T.rafDelta] : null;
    const inf = rafKnown ? F[base + T["br.inferred"]] : 0;
    const residualOk = Math.abs(res) <= bar + 1e-4;
    const orderOk = !rafKnown || raf + 1e-4 >= main;
    const share = main > 0 ? topMs / main : 0;
    let bucket = "ambiguous", why = "";
    if (main <= RESIDUAL_FLOOR_MS) {
        bucket = "trivial";
        why = "inside the " + RESIDUAL_FLOOR_MS + " ms floor: nothing to attribute";
    } else if (!residualOk) {
        why = "residual " + ms3(res) + " ms over the " + ms3(bar) + " ms bar";
    } else if (inf > main && raf > BROWSER_MIN_INTERVAL_MS) {
        bucket = "BROWSER";
        why = "br.inferred " + ms3(inf) + " ms against mainMs " + ms3(main) + " ms: the frame's "
            + "time is outside this task, attributed by subtraction and never measured (D28); "
            + "top names the main-thread bucket";
    } else if (share < DOMINANT) {
        why = "no bucket over " + Math.round(DOMINANT * 100) + " %: " + (top || "none") + " "
            + Math.round(share * 100) + " %";
    } else {
        bucket = top;
        if (!orderOk) why = "rafDelta " + ms3(raf) + " ms under mainMs " + ms3(main) + " ms: the interval "
            + "is unusable and the bucket uncorroborated";
    }
    return { bucket, top: top || null, shareOfMain: +share.toFixed(3),
        residualMs: ms3(res), barMs: ms3(bar), residualOk,
        rafDeltaMs: raf == null ? null : ms3(raf), orderOk, corroborated: rafKnown && orderOk,
        buckets: msObj(by), why };
}

/** @param {number} q the queued-at this arrival claimed in `noteJob`, or -1; never a second claim. */
function takeJob(info, res, workerMs, staleN, q) {
    const ms = +info.wallMs || 0;
    let at = -1;
    if (nJobs < JOBS_KEPT) { at = nJobs++; } else {
        let worstAt = 0;
        for (let k = 1; k < JOBS_KEPT; k++) {
            if (jobs[k].postedToArrivedMs < jobs[worstAt].postedToArrivedMs) worstAt = k;
        }
        if (ms > jobs[worstAt].postedToArrivedMs) at = worstAt;
    }
    if (at < 0) return;
    const r = jobs[at];
    r.t = wall();
    r.frameSeq = info.frameSeq | 0;
    r.jobId = info.jobId | 0;
    r.plates = res && res.plates ? res.plates.length / 2 : 0;
    r.postedToArrivedMs = ms;
    r.queueWaitMs = q >= 0 && info.postedAt > q ? info.postedAt - q : 0;
    r.queueingMs = +info.queueingMs || 0;
    r.workerMs = workerMs;
    r.serialiseMs = +(res && res.serialiseMs) || 0;
    r.postMs = +info.postMs || 0;
    r.recvMs = +info.recvMs || 0;
    r.bytesIn = info.bytesIn | 0;
    r.bytesOut = info.bytesOut | 0;
    r.inline = !!info.inline;
    r.stale = staleN;
}

function jobsOut() {
    const out = [];
    for (let k = 0; k < nJobs; k++) {
        const r = jobs[k];
        // `postedToArrivedMs` is the CLIENT's own wall — posted to arrived. The row's `wallMs`
        // is queued to blitted and is a wider span; the two are not the same number.
        out.push({ t: r.t, frameSeq: r.frameSeq, jobId: r.jobId, plates: r.plates,
            postedToArrivedMs: ms3(r.postedToArrivedMs), queueWaitMs: ms3(r.queueWaitMs),
            queueingMs: ms3(r.queueingMs),
            workerMs: ms3(r.workerMs), serialiseMs: ms3(r.serialiseMs),
            // §8.1's two transfer timers, reported BESIDE the wall partition and never added to
            // it: the client's `queueingMs` is wall minus phases and already contains them (Q7).
            postMs: ms3(r.postMs), recvMs: ms3(r.recvMs),
            bytesIn: r.bytesIn, bytesOut: r.bytesOut, inline: r.inline, stale: r.stale });
    }
    return out.sort((a, b) => b.postedToArrivedMs - a.postedToArrivedMs);
}

/** Bounded by construction: a thirteenth distinct reason counts as `other`, never a new key. */
function tallyDrop(why) {
    const k = dropWhy.has(why) || dropWhy.size < DROP_WHYS_KEPT ? why : "other";
    dropWhy.set(k, (dropWhy.get(k) || 0) + 1);
}

function dropsOut() {
    const out = [];
    for (let k = 0; k < nDrops; k++) {
        const r = drops[(dropAt - 1 - k + DROPS_KEPT * 2) % DROPS_KEPT];
        out.push({ t: r.t, why: r.why, before: r.before, jobId: r.jobId, frameSeq: r.frameSeq,
            q: r.q, frameId: r.frameId, plates: r.plates, stale: r.stale });
    }
    return out;
}

function totalsOf() {
    const out = {};
    for (let s = 0; s < TIMERS.length; s++) out[TIMERS[s]] = ms3(totalsT[s]);
    // P3's per-plate residual: what start-to-finish holds beyond the four phases inside it —
    // the paper fill, which runs before the first clock read, and the loop's own overhead.
    // WORKER rows only (`workerT`): a sync frame's phases are main-thread time and have no
    // start-to-finish to come out of.
    out["ras.plateResidual"] = ms3(workerT[T["job.startToFinish"]] - workerT[T["eng.clip"]]
        - workerT[T["eng.local"]] - workerT[T["ras.edges"]] - workerT[T["ras.union"]]
        - workerT[T["ras.accum"]]);
    return out;
}

function countsOf() {
    const out = {};
    for (let s = C.platesWanted; s < COUNTS.length; s++) out[COUNTS[s]] = totalsC[s];
    return out;
}

function histLabels() {
    const out = [];
    for (const b of MS_BUCKETS) out.push("<=" + b);
    out.push(">" + MS_BUCKETS[MS_BUCKETS.length - 1]);
    return out;
}

function namedInts(names, arr) {
    const out = {};
    for (let k = 0; k < names.length; k++) if (arr[k]) out[names[k]] = arr[k];
    return out;
}

function msObj(by) {
    const out = {};
    for (const k of Object.keys(by)) out[k] = ms3(by[k]);
    return out;
}

function flagNames(flags) {
    const out = [];
    for (const k of Object.keys(FLAG)) if (flags & FLAG[k]) out.push(k);
    return out;
}

function bucketOf(hist, ms) {
    let i = 0;
    while (i < MS_BUCKETS.length && ms > MS_BUCKETS[i]) i++;
    hist[i]++;
}

function kindCode(kind) {
    const k = KINDS.indexOf(String(kind));
    return k < 0 ? 0 : k;
}

function qCode(q) {
    if (q === "s") return Q_SYNC;
    if (q === "e") return Q_SETTLE;
    const n = +q;
    return isFinite(n) && q !== "" && q != null ? Math.round(n) : Q_UNKNOWN;
}

function qOf(code) {
    if (code === Q_SYNC) return "s";
    if (code === Q_SETTLE) return "e";
    if (code === Q_UNKNOWN) return "";
    return code;
}

function pick(d, req, key, dflt) {
    if (d && d[key] != null) return d[key];
    if (req && req[key] != null) return req[key];
    return dflt;
}

function traceOn() { return typeof src.trace === "function" ? !!src.trace() : false; }

/** Three decimals: the ring is float32, which holds a millisecond to about seven digits. */
function ms3(ms) { return Math.round((+ms || 0) * 1000) / 1000; }
