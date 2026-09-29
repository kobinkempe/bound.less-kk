#!/usr/bin/env node
/**
 * report-read.js — a dev report's headline numbers, without opening the JSON (OPEN-FLAGS F58).
 *
 *   node tools/report-read.js [latest | <file> | <name in .kobin-reports>] [--section <name>] [--list]
 *
 * Reads the v2 reports (instruments, history, a local extract; `src/engine/report.js`) and the
 * older v1 ones (the whole drawing as `snapshot`) alike. `--section raster` prints one section
 * as JSON; `--list` the newest reports. Loading a report into an engine is
 * `src/engine/__testkit__/reportReplay.js` (jsdom) or `window.__kobinReport.replayReport` (a page).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DIR = path.join(__dirname, "..", ".kobin-reports");
const REPORT_RE = /^report-[0-9TZ-]+\.json$/;

function latestReport(dir = DIR) {
    const names = fs.readdirSync(dir).filter((f) => REPORT_RE.test(f)).sort();
    return names.length ? path.join(dir, names[names.length - 1]) : null;
}
function resolveReport(arg, dir = DIR) {
    if (!arg || arg === "latest") return latestReport(dir);
    if (fs.existsSync(arg)) return arg;
    const inDir = path.join(dir, arg);
    return fs.existsSync(inDir) ? inDir : null;
}
function readReport(file) {
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return JSON.parse(buf.toString("utf8"));
}

// ---- formatting ----
const int = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n).toLocaleString("en-US") : n == null ? "-" : String(n));
const mb = (b) => (typeof b === "number" ? (b / 1048576).toFixed(b < 10485760 ? 2 : 1) + " MB" : "-");
const sci = (v) => (typeof v !== "number" || !isFinite(v) ? "-" : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : +v.toPrecision(4) + "");
const hhmmss = (t) => (t ? new Date(t).toISOString().slice(11, 19) : "--:--:--");
const shortFrame = (id) => { const s = String(id == null ? "" : id); return s.length > 36 ? "…" + s.slice(-34) : s; };
const ago = (t, now) => (t ? Math.round((now - t) / 1000) + " s ago" : "never");
const row = (label, text) => (label + "          ").slice(0, 9) + " " + text;

function uaShort(ua) {
    if (!ua) return "?";
    const b = /Edg\/(\d+)/.exec(ua) ? "Edge " + /Edg\/(\d+)/.exec(ua)[1] : /Chrome\/(\d+)/.exec(ua) ? "Chrome " + /Chrome\/(\d+)/.exec(ua)[1] : /Firefox\/(\d+)/.exec(ua) ? "Firefox " + /Firefox\/(\d+)/.exec(ua)[1] : /Safari\//.test(ua) ? "Safari" : "?";
    const os = /Android [\d.]+/.exec(ua) ? /Android [\d.]+/.exec(ua)[0] : /iPhone|iPad/.test(ua) ? "iOS" : /Windows NT/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "?";
    return b + " on " + os;
}

/** The headline lines of a report object. */
function summarise(rep, { file = null, bytes = null } = {}) {
    const L = [];
    const now = Date.now();
    const v = rep.v || 1;
    L.push(`${file ? path.basename(file) : "report"}  ${bytes != null ? mb(bytes) : ""}  v${v}  ${(rep.meta && rep.meta.when) || rep.when || "?"}${rep.meta && rep.meta.why ? "  why: " + rep.meta.why : ""}`);
    if (v < 2) return L.concat(summariseV1(rep));
    const m = rep.meta || {}, d = m.device || {}, cam = rep.camera || {}, c = rep.counts || {};
    L.push(row("device", `${uaShort(d.ua)} · ${d.window ? d.window.w + "×" + d.window.h : "?"} @${d.dpr || "?"} · ${m.renderer || "?"} · ${d.visibility || "?"}${d.cores ? ` · ${d.cores} cores` : ""}${d.memoryGB ? ` · ${d.memoryGB} GB` : ""}`));
    L.push(row("camera", `depth ${cam.depth} · frame ${shortFrame(cam.frame)} · inScale ${sci(cam.inScale)} · zoom ${sci(cam.effectiveZoom)}× · tool ${(m.engine && m.engine.tool) || "?"}`));
    L.push(row("document", `${int(c.natives)} natives in ${int(c.frames)} frames (lattice ${int(cam.latticeFrames)}) · ${int(c.pieces)} pieces · ${int(c.moved)} moved · ${int(c.marks)} marks · undo ${int(c.undo)} / redo ${int(c.redo)} · ${int(c.listed)} in the render list`));
    const b = rep.build || {};
    L.push(row("build", `${int(b.ms)} ms over ${int(b.tasks)} tasks, longest ${b.longestTask ? `${b.longestTask.ms} ms (${b.longestTask.name})` : "-"}${b.errors && Object.keys(b.errors).length ? ` · ${Object.keys(b.errors).length} section error(s)` : ""}`));
    const ex = rep.extract && rep.extract.stats;
    if (ex) {
        L.push(row("extract", `${int(ex.chosen)} of ${int(ex.candidates)} candidates in ${ex.frames ? ex.frames.length : 0} frames · visible ${int(ex.visibleIncluded)}/${int(ex.visible)} · selected ${int(ex.selectedIncluded)}/${int(ex.selected)} · est ${mb(ex.estBytes)}${ex.dropped ? ` · ${int(ex.dropped)} dropped over the cap (${int(ex.visibleDropped)} visible)` : ""} · lattice ${int(ex.latticeFrames)}${ex.latticeTrimmed ? " (trimmed)" : ""}`));
    } else L.push(row("extract", "none"));
    if (rep.drawing) L.push(row("drawing", `whole drawing sent: ${int(rep.drawing.parts)} part(s), ${int(rep.drawing.natives)} natives — ${file ? drawingState(file, rep.drawing.parts) : "?"}`));
    const ras = rep.raster || {};
    // The engine's own store first: the perf ring is a module singleton, attached to the last renderer built.
    const pic = ras.perf && ras.perf.picture, pl = ras.plates || (ras.perf && ras.perf.plates), rr = ras.renderer;
    if (pic) {
        L.push(row("paper", `the pyramid's integrals (ms): paper ${int(pic.paperMs)} · blur ${int(pic.blurMs)} · older ${int(pic.olderPatchMs)} waiting for a patch, ${int(pic.olderOtherMs)} other · ${int(pic.composes)} composes, max ${int(pic.maxImagesPerCompose)} images · level ℓ${pic.level} at S ${pic.S}, σ ${pic.s}`));
    } else if (ras.renderer === "svg") L.push(row("paper", `SVG renderer: ${int(ras.groups)} groups`));
    if (pl) L.push(row("plates", `${int(pl.plates)} plates ${mb(pl.plateBytes)} of ${mb(pl.maxBytes)} · stale ${mb(pl.staleBytes)} · pinned ${int(pl.pinned)} · in flight ${int(pl.inFlight)} · evictions ${int(pl.evictions)}`));
    if (rr) L.push(row("raster", `${int(rr.frames)} renders + ${int(rr.cameraFrames)} camera frames · jobs by priority ${rr.queue ? rr.queue.byPrio.join("/") : "-"} · refused at the pack ${int(rr.refusedCover)} · plane ${rr.plane || "-"} · live holds ${int(rr.liveHolds)}, handoffs ${int(rr.liveHandoffs)}`));
    const ins = rep.instruments || {};
    const fm = ins.frameMeter;
    if (fm) L.push(row("frames", `${int(fm.frames)} sampled, mean ${fm.meanMs} ms · ${Object.entries(fm.hist || {}).map(([k, n]) => `${k}:${n}`).join(" ")} · worst ${(fm.worst || []).slice(0, 3).map((w) => `${w.ms} ms @${hhmmss(w.t)}`).join(", ") || "-"}`));
    const lf = ins.longFrames;
    if (lf) {
        L.push(row("freezes", lf.supported ? `${int(lf.count)} long frames, ${int(lf.totalMs)} ms in all` : "long-animation-frame not supported here"));
        for (const w of (lf.recent || []).slice(-3).reverse()) L.push(row("", `recent ${w.ms} ms @${hhmmss(w.t)} · script ${w.scriptMs} · layout ${w.styleLayoutMs} · paint ${w.paintMs}${w.scripts && w.scripts[0] ? ` · ${w.scripts[0].fn || w.scripts[0].invoker || "?"} ${w.scripts[0].ms} ms` : ""}`));
        for (const w of (lf.worst || []).slice(0, 3)) L.push(row("", `worst  ${w.ms} ms @${hhmmss(w.t)} · script ${w.scriptMs} · layout ${w.styleLayoutMs} · paint ${w.paintMs}${w.scripts && w.scripts[0] ? ` · ${w.scripts[0].fn || w.scripts[0].invoker || "?"} ${w.scripts[0].ms} ms` : ""}`));
    }
    const ev = ins.eventLatency;
    if (ev && ev.worst && ev.worst.length) L.push(row("input", ev.worst.slice(0, 3).map((w) => `${w.name} ${w.ms} ms (wait ${w.waitMs}, handle ${w.handleMs}, present ${w.presentMs}) @${hhmmss(w.t)}`).join(" · ")));
    const slow = (ins.perfLog || []).slice().sort((a, b2) => b2.ms - a.ms).slice(0, 4);
    if (slow.length) L.push(row("perf log", slow.map((e) => `${e.op} ${e.ms} ms @${hhmmss(e.t)}`).join(" · ")));
    const mem = rep.memory || {};
    L.push(row("memory", `heap ${mem.heap ? `${mem.heap.usedMB}/${mem.heap.limitMB} MB` : "-"} · tiles ${mem.tiles ? `${int(mem.tiles.tiles)} (${int(mem.tiles.pieces)} pieces)` : "-"} · plates ${mem.plates ? mb(mem.plates.plateBytes) : "-"} · undo ops ${int(mem.undoOps)}`));
    const sv = rep.save;
    L.push(row("save", sv ? `autosave ${sv.autosave === false ? "OFF" : "on"} · last write ${ago(sv.lastOkAt, now)} · ${sv.dirty ? "dirty" : "clean"} · fails ${int(sv.failCount)}${sv.backoffMs ? `, next try in ${Math.round(sv.backoffMs / 1000)} s` : ""}${sv.lastFail ? ` · last fail ${hhmmss(sv.lastFail.at)} ${sv.lastFail.err || ""}` : ""} · log seq ${int(sv.logSeq)} queued ${int(sv.queued)} carried ${int(sv.carried)}` : "no saver (a second engine, or not an editor)"));
    const cl = rep.cloud;
    L.push(row("cloud", cl ? `${cl.signedIn ? "signed in" : "signed out"} · ${cl.dirty ? "dirty" : "clean"}${cl.busy ? " · pushing" : ""} · fails ${int(cl.fails)}${cl.retryInMs ? `, retry in ${Math.round(cl.retryInMs / 1000)} s` : ""}${cl.error ? ` · "${cl.error}"` : ""}` : "-"));
    const mv = rep.moves || {};
    const last = mv.recent && mv.recent[0];
    L.push(row("moves", `selection ${mv.selection ? `${mv.selection.n} ids + ${(mv.selection.frames || []).length} frames` : "none"} · drag ${mv.drag ? (mv.drag.moved ? "moving" : "pressed") : "idle"}${mv.hold ? ` (hold ${mv.hold.ids} ids)` : ""} · ${int((mv.shifts || []).length)} pending shifts · ${int((mv.shadows || []).length)} shadows${last ? ` · last move op ${last.op} seq ${last.seq}` : ""}`));
    const er = rep.erase || {};
    L.push(row("erase", `${int(er.pending)} pending marks · ${int(er.bakeJobs && er.bakeJobs.n)} bake jobs${er.inflight ? ` · cut in flight on #${er.inflight.id} for ${er.inflight.ageMs} ms` : ""} · held ${int(er.heldMs)} ms · seals ${int(er.counters && er.counters.boolSeals)} · cut refusals ${int(er.counters && er.counters.cutRefused)} · cuts ${er.worker ? `${int(er.worker.jobs)} sent, ${int(er.worker.inline)} inline, ${int(er.worker.requeued)} requeued, ${int(er.worker.lost)} lost` : "-"}`));
    const sc = rep.scenes || {};
    const ix = sc.index;
    L.push(row("scenes", `${int(sc.count)} scenes${sc.hidden != null ? ` (${int(sc.hidden)} hidden)` : ""}${ix ? ` · index ${ix.on === false ? "off" : `${ix.mode || "?"}, dirty ${int(ix.dirty)}, ${ix.inflight ? "a batch in flight" : "idle"}${ix.restoring ? ", restoring" : ""}${ix.lastApplyMs != null ? `, last apply ${Math.round(ix.lastApplyMs)} ms` : ""}`}` : ""}`));
    const errs = [...((rep.errors && rep.errors.page) || []).map((e) => ({ ...e, level: "page" })), ...((rep.errors && rep.errors.console) || [])]
        .filter((e) => e && typeof e === "object").sort((a, b2) => (a.t || 0) - (b2.t || 0)).slice(-6);
    L.push(row("errors", errs.length ? "" : "none"));
    for (const e of errs) L.push(row("", `[${hhmmss(e.t)}] ${e.level || ""} ${String(e.msg || "").slice(0, 140)}`));
    const j = ((rep.history && rep.history.journal) || []).slice(-6);
    L.push(row("journal", j.length ? j.map((e) => `${hhmmss(e.t)} ${e.kind}${e.pts ? ` (${e.pts.length} pts)` : ""} d${e.level}`).join(" · ") : "empty"));
    if (b.errors && Object.keys(b.errors).length) for (const [k, e] of Object.entries(b.errors)) L.push(row("section!", `${k}: ${e}`));
    return L;
}

function summariseV1(rep) {
    const L = [];
    const nat = rep.snapshot && rep.snapshot.natives ? rep.snapshot.natives : {};
    let n = 0;
    for (const a of Object.values(nat)) n += a.length;
    L.push(row("device", `${uaShort(rep.ua)} · ${rep.screen ? rep.screen.w + "×" + rep.screen.h + " @" + rep.screen.dpr : "?"}`));
    L.push(row("camera", rep.camera ? `level ${rep.camera.level} · inScale ${sci(rep.camera.inScale)} · zoom ${sci(rep.camera.effectiveZoom)}×` : "-"));
    L.push(row("document", `${int(n)} natives in ${Object.keys(nat).length} frames (the whole drawing, as snapshot)`));
    if (rep.frames) L.push(row("frames", `${int(rep.frames.frames)} sampled · worst ${(rep.frames.worst || []).slice(0, 3).map((w) => w.ms + " ms").join(", ")}`));
    if (rep.longFrames) L.push(row("freezes", `${int(rep.longFrames.count)} long frames · worst ${(rep.longFrames.worst || []).slice(0, 3).map((w) => w.ms + " ms").join(", ")}`));
    L.push(row("errors", `${(rep.errors || []).length}`));
    L.push(row("journal", `${(rep.journal || []).length} gestures`));
    return L;
}

function drawingState(file, planned) {
    const d = file.replace(/\.json$/, ".drawing");
    if (!fs.existsSync(d)) return "no parts on disk";
    const parts = fs.readdirSync(d).filter((f) => /^part-\d{4}\.kb2/.test(f)).length;
    return `${parts}/${planned} parts on disk${fs.existsSync(path.join(d, "manifest.json")) ? ", complete" : ", INCOMPLETE"}`;
}

function main(argv) {
    const args = argv.slice(2);
    const flag = (name) => { const i = args.indexOf("--" + name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v && !v.startsWith("--") ? 2 : 1); return v && !v.startsWith("--") ? v : true; };
    const section = flag("section");
    if (flag("list")) {
        const names = fs.readdirSync(DIR).filter((f) => REPORT_RE.test(f)).sort().reverse().slice(0, 20);
        for (const nme of names) console.log(`${nme}  ${mb(fs.statSync(path.join(DIR, nme)).size)}`);
        return 0;
    }
    const file = resolveReport(args[0]);
    if (!file) { console.error("no report: " + (args[0] || "latest") + " (in " + DIR + ")"); return 1; }
    const rep = readReport(file);
    if (section) { console.log(JSON.stringify(section === true ? Object.keys(rep) : rep[section], null, 2)); return 0; }
    for (const line of summarise(rep, { file, bytes: fs.statSync(file).size })) console.log(line);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { summarise, readReport, resolveReport, latestReport };
