/**
 * The four instruments the engine carries, and nothing else.
 *
 * Each answers a question no JS timer inside the render loop can answer on its
 * own, and each keeps a bounded ring buffer with a `report()` the diagnostic
 * bundle in `hooks/useKobinEngine.js` reads:
 *
 *   LongFrames    Chrome's own account of every slow frame - script vs style
 *                 and layout vs the paint/raster/composite remainder, with the
 *                 slowest scripts named. The frame meter cannot see any of this.
 *   EventLatency  input to pixels in three phases. The third reaches past the
 *                 main thread to the compositor, so it is the only one that
 *                 measures what the hand actually feels.
 *   GrowthLog     does the SESSION accumulate? A refresh cures the slowness, so
 *                 the suspect is heap and cache growth, not the drawing.
 *   FrameMeter    the gap between animation frames, bucketed, plus the worst
 *                 few, wall-clock stamped so a bad frame lines up against the
 *                 perf log and the journal.
 *
 * Split out of `KobinEngine.js` on 2026-08-31. They were 300 lines of the
 * engine file and share nothing with it but the constructor line that builds
 * them.
 */
import { perfNow } from "./now";

// ---- long animation frames --------------------------------------------------
// WHERE THE TIME ACTUALLY GOES, straight from the browser.
//
// The frame meter says a frame took 1.5 s; every timer in this engine says the
// work took 11 ms. That gap has cost four wrong diagnoses (paint via path
// extent, the bake guard, autosave, the move path), because a number that only
// says "something was slow" invites a guess about what.
//
// `long-animation-frame` closes it. Chrome hands back, per slow frame: how long
// was spent before rendering began (script and tasks), when style-and-layout
// started, and a per-script breakdown with function names — including how much
// of each script was FORCED style-and-layout, which is the classic invisible
// cost. Whatever is left over after script and style-and-layout is paint and
// compositing, and that subtraction is the whole point: it is the one thing no
// JavaScript timer can ever see directly.
//
// Kobin's symptom is the one this suits best: "random moments where I zoom and
// it won't render."
const LOAF_KEPT = 25;

export class LongFrames {
    constructor() {
        this.worst = [];
        this.count = 0;
        this.totalMs = 0;
        this.supported = false;
        this._obs = null;
    }
    start() {
        if (typeof PerformanceObserver !== "function") return;
        const types = PerformanceObserver.supportedEntryTypes || [];
        if (types.indexOf("long-animation-frame") < 0) return;
        try {
            this._obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) this._take(e);
            });
            this._obs.observe({ type: "long-animation-frame", buffered: true });
            this.supported = true;
        } catch (err) { this._obs = null; }
    }
    _take(e) {
        this.count++;
        this.totalMs += e.duration || 0;
        const end = e.startTime + e.duration;
        // The LoAF timeline: startTime -> renderStart -> styleAndLayoutStart -> end.
        const preRender = e.renderStart ? e.renderStart - e.startTime : e.duration;
        const render = e.renderStart ? end - e.renderStart : 0;
        const styleLayout = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0;
        const scripts = (e.scripts || []).map((sc) => ({
            ms: +(sc.duration || 0).toFixed(1),
            forcedMs: +(sc.forcedStyleAndLayoutDuration || 0).toFixed(1),
            fn: String(sc.sourceFunctionName || "").slice(0, 60),
            src: String(sc.sourceURL || "").split("/").pop().slice(0, 48),
            invoker: String(sc.invoker || "").slice(0, 60),
        })).sort((a, b) => b.ms - a.ms).slice(0, 4);
        const scriptMs = scripts.reduce((n, x) => n + x.ms, 0);
        const rec = {
            // wall clock, so a long frame lines up against `perf` and `journal`
            t: Math.round((performance.timeOrigin || 0) + e.startTime),
            ms: +(e.duration || 0).toFixed(1),
            blockingMs: +(e.blockingDuration || 0).toFixed(1),
            preRenderMs: +preRender.toFixed(1),
            renderMs: +render.toFixed(1),
            styleLayoutMs: +styleLayout.toFixed(1),
            // rendering that is NOT style-and-layout: paint, raster, compositing
            paintMs: +Math.max(0, render - styleLayout).toFixed(1),
            scriptMs: +scriptMs.toFixed(1),
            scripts,
        };
        this.worst.push(rec);
        this.worst.sort((a, b) => b.ms - a.ms);
        if (this.worst.length > LOAF_KEPT) this.worst.length = LOAF_KEPT;
    }
    report() {
        return { supported: this.supported, count: this.count,
            totalMs: +this.totalMs.toFixed(0), worst: this.worst.slice(0, LOAF_KEPT) };
    }
    stop() { try { if (this._obs) this._obs.disconnect(); } catch (err) { /* ignore */ } this._obs = null; }
}

// ---- input to pixels --------------------------------------------------------
// THE LAST BLIND SPOT. Four reports running, every stall looks the same: a frame
// of 0.6-1.5 s in which script is 0 ms, render is 0.3 ms, paint is 0.3 ms and
// the engine's own trace log holds no operation at all. The main thread is IDLE
// while the page is frozen. So the delay is not in PRODUCING a frame, it is in
// getting one PRESENTED — and presentation happens on the compositor, where no
// JavaScript timer can follow it.
//
// Event Timing is the one API that spans the whole journey. Per input it gives
// three phases, and the third is the one nothing else can see:
//   waitMs    startTime -> processingStart   (queued, main thread busy)
//   handleMs  processingStart -> processingEnd  (our JavaScript)
//   presentMs processingEnd -> startTime+duration  (rendered and put on screen)
// A wheel event with handleMs 5 and presentMs 1100 says the engine is innocent
// and the compositor is the answer. Kobin's words for it: "I zoom and it won't
// render."
const EVENT_MIN_MS = 100;   // only events worth explaining
const EVENT_KEPT = 25;

export class EventLatency {
    constructor() { this.worst = []; this.count = 0; this.supported = false; this._obs = null; }
    start() {
        if (typeof PerformanceObserver !== "function") return;
        if ((PerformanceObserver.supportedEntryTypes || []).indexOf("event") < 0) return;
        try {
            this._obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) this._take(e);
            });
            this._obs.observe({ type: "event", buffered: true, durationThreshold: EVENT_MIN_MS });
            this.supported = true;
        } catch (err) { this._obs = null; }
    }
    _take(e) {
        this.count++;
        const wait = Math.max(0, (e.processingStart || e.startTime) - e.startTime);
        const handle = Math.max(0, (e.processingEnd || 0) - (e.processingStart || 0));
        const present = Math.max(0, (e.startTime + e.duration) - (e.processingEnd || e.startTime));
        this.worst.push({
            t: Math.round((performance.timeOrigin || 0) + e.startTime),
            name: String(e.name || "").slice(0, 24),
            ms: +(e.duration || 0).toFixed(1),
            waitMs: +wait.toFixed(1),
            handleMs: +handle.toFixed(1),
            presentMs: +present.toFixed(1),
        });
        this.worst.sort((a, b) => b.ms - a.ms);
        if (this.worst.length > EVENT_KEPT) this.worst.length = EVENT_KEPT;
    }
    report() { return { supported: this.supported, count: this.count, worst: this.worst.slice() }; }
    stop() { try { if (this._obs) this._obs.disconnect(); } catch (err) { /* ignore */ } this._obs = null; }
}

// ---- what accumulates over a session ----------------------------------------
// Reported 2026-08-22, and the decisive clue in the whole investigation: the
// slowness is reproducible from a given sequence of steps, but A PAGE REFRESH
// CURES IT. Same drawing, same objects, same steps afterwards — fine. So it is
// not the document, and it is not the machine; it is something the session
// accumulates.
//
// That also explains the shape of the stall. A long animation frame with NO
// script, NO render and NO paint attributed to it is what a major garbage
// collection looks like from the inside — GC belongs to no script, so nothing
// can name it. Heap pressure grows, collections get longer, and the page halts
// for a second at a time with every timer in the engine reporting that it did
// nothing.
//
// A snapshot cannot show accumulation, so this is a SERIES: heap and the size
// of every cache that could grow, sampled while the user is active. If one of
// these climbs and never comes down, that is the leak.
const GROWTH_EVERY_MS = 2000;
const GROWTH_KEPT = 150;

export class GrowthLog {
    constructor(engine) { this.e = engine; this.samples = []; this._last = 0; }
    /** Cheap enough to call from the frame meter's poke path. */
    maybeSample() {
        const now = perfNow();
        if (now - this._last < GROWTH_EVERY_MS) return;
        this._last = now;
        const E = this.e;
        let heapMB = null;
        try {
            if (typeof performance !== "undefined" && performance.memory) {
                heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
            }
        } catch (err) { /* not everywhere */ }
        let svgNodes = null;
        try { if (typeof document !== "undefined") svgNodes = document.querySelectorAll("svg *").length; }
        catch (err) { /* ignore */ }
        const s = {
            t: Date.now(),
            heapMB,
            svgNodes,
            frames: E.lm && E.lm.frames ? E.lm.frames.size : null,
            buckets: E.doc ? E.doc.levels().length : null,
            objects: E.doc ? E.doc.levels().reduce((n, k) => n + E.doc.at(k).length, 0) : null,
            undo: E.doc && E.doc._undo ? E.doc._undo.length : null,
            redo: E.doc && E.doc._redo ? E.doc._redo.length : null,
            tiles: E.store && E.store.cache && E.store.cache.size != null ? E.store.cache.size : null,
            groups: E.renderer && E.renderer._groups ? E.renderer._groups.size : null,
            bakeJobs: E._bakeJobs ? E._bakeJobs.length : null,
        };
        this.samples.push(s);
        if (this.samples.length > GROWTH_KEPT) this.samples.shift();
    }
    report() {
        if (!this.samples.length) return { samples: [] };
        const first = this.samples[0], last = this.samples[this.samples.length - 1];
        const delta = {};
        for (const k of Object.keys(first)) {
            if (k === "t" || first[k] == null || last[k] == null) continue;
            delta[k] = last[k] - first[k];
        }
        return { spanS: Math.round((last.t - first.t) / 1000), first, last, delta,
            samples: this.samples.slice() };
    }
}

// How long one erase-bake slice may run before yielding to the browser. Same
// budget as a perimeter bake slice — see `_bakeTick`.
// ---- the frame meter --------------------------------------------------------
// THE ONLY INSTRUMENT HERE THAT SEES PAINT. Every other timer in this file wraps
// JavaScript and stops the moment the engine hands the DOM back to the browser;
// layout, rasterization and compositing all happen after that, and on a deep
// zoom they are the expensive part.
//
// Why it exists: two stalls reported 2026-08-21, one from a phone and one from a
// desktop, both felt like seconds of lag. The desktop report covered 62.3 s of
// session and accounted for 157 ms of work - 0.25%. Crossings were 2.4-4.1 ms,
// renders never passed 19.6 ms, and not one zoom step reached the 8 ms floor
// that `_perf` logs above. Every measured thing was fast, so the diagnosis had
// to be made by reasoning about what was ABSENT. This closes that hole.
//
// The gap between animation frames is the number a user actually feels, and it
// includes everything JS cannot time. Sampling runs only around interaction: a
// rAF loop that never stops would keep a phone's display pipeline awake for
// nothing, which is its own performance bug.
const FRAME_BUCKETS = [17, 33, 50, 100, 250, 500, 1000];
const FRAME_METER_IDLE_MS = 2000;
const FRAME_WORST_KEPT = 20;

export class FrameMeter {
    constructor() {
        this.buckets = new Array(FRAME_BUCKETS.length + 1).fill(0);
        this.worst = [];
        this.frames = 0;
        this.totalMs = 0;
        this.hidden = 0;      // samples dropped because the tab was not visible
        this._last = 0;
        this._raf = null;
        this._until = 0;
    }
    /** An interaction happened: sample for the next couple of seconds. */
    poke() {
        if (this.onPoke) this.onPoke();
        this._until = perfNow() + FRAME_METER_IDLE_MS;
        if (this._raf == null) this._start();
    }
    _start() {
        if (typeof requestAnimationFrame !== "function") return;
        this._last = 0;
        const tick = (ts) => {
            const now = typeof ts === "number" ? ts : perfNow();
            if (this._last) this.record(now - this._last);
            this._last = now;
            if (now >= this._until) { this._raf = null; this._last = 0; return; }
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }
    record(ms) {
        if (!(ms >= 0) || !isFinite(ms)) return;
        // rAF PAUSES WHEN THE TAB IS NOT VISIBLE, and the next callback then
        // reports the whole absence as one enormous frame. Nothing was slow; the
        // browser simply was not animating. Left uncounted, that manufactures
        // exactly the headline number a reader will chase — isolated 1-2 second
        // frames, landing near the moment someone switches away to click
        // something. Counting them cost most of a day on 2026-08-21.
        if (typeof document !== "undefined" && document.hidden) { this.hidden++; return; }
        this.frames++; this.totalMs += ms;
        let i = 0;
        while (i < FRAME_BUCKETS.length && ms > FRAME_BUCKETS[i]) i++;
        this.buckets[i]++;
        // Keep the worst few WITH a wall-clock stamp, so a bad frame can be lined
        // up against the perf log and the journal.
        if (ms > FRAME_BUCKETS[1]) {
            this.worst.push({ ms: +ms.toFixed(1), t: Date.now() });
            this.worst.sort((a, b) => b.ms - a.ms);
            if (this.worst.length > FRAME_WORST_KEPT) this.worst.length = FRAME_WORST_KEPT;
        }
    }
    report() {
        const hist = {};
        for (let i = 0; i < this.buckets.length; i++) {
            if (!this.buckets[i]) continue;
            const label = i === FRAME_BUCKETS.length
                ? ">" + FRAME_BUCKETS[FRAME_BUCKETS.length - 1]
                : "<=" + FRAME_BUCKETS[i];
            hist[label] = this.buckets[i];
        }
        return {
            frames: this.frames,
            hiddenSkipped: this.hidden,
            sampledMs: +this.totalMs.toFixed(0),
            meanMs: this.frames ? +(this.totalMs / this.frames).toFixed(1) : 0,
            hist,
            worst: this.worst.slice(0, FRAME_WORST_KEPT),
        };
    }
    stop() {
        if (this._raf != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._raf);
        this._raf = null;
    }
}
