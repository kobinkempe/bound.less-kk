/**
 * reportSend.js — the dev report's transport (OPEN-FLAGS F58): build (`engine/report.js`),
 * one stringify, the identity scrubbed, gzip off the main thread, POSTed in parts to
 * `tools/report-server.js` on :3001; the whole drawing, when asked for, after it as kobin-2
 * chunks. A report that cannot be sent says why and, in a page, is saved as a file.
 * Dev only: reachable from the `?dev` panel and `window.__kobinReport`.
 */
import { buildReport, drawingPlan, drawingChunk, loadReport, macroYield, DRAWING_CHUNK_BYTES } from "../engine/report";
import { byteLen } from "../engine/raster/rasterPerf";
import { perfNow } from "../engine/now";
import { compression, gunzipAs } from "../cloud/gzip";

export const REPORT_PORT = 3001;
/** One POST of the report's gzip; the server refuses a part over 32 MB. */
export const PART_BYTES = 8 << 20;
const POST_TIMEOUT_MS = 60000;

const msg = (err) => String((err && err.message) || err).slice(0, 160);

// ---- the console tap: the last 50 warnings and errors, for the report ----
const tail = [];
let tapped = false;
export function installConsoleTap(con = typeof console !== "undefined" ? console : null) {
    if (tapped || !con) return;
    tapped = true;
    for (const level of ["error", "warn"]) {
        const orig = con[level];
        if (typeof orig !== "function") continue;
        con[level] = function tap(...args) {
            try {
                const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a))).join(" ");
                tail.push({ t: Date.now(), level, msg: text.slice(0, 300) });
                if (tail.length > 50) tail.shift();
            } catch (err) { /* the tap never breaks a log */ }
            return orig.apply(this, args);
        };
    }
}
export function consoleTail() { return tail.slice(); }
function safeJson(v) { try { return JSON.stringify(v).slice(0, 300); } catch (err) { return String(v); } }

// ---- identity ----
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const APIKEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
/**
 * The report must never carry who the user is: every `secret` (the uid, the email, the name
 * the caller passes) replaced wherever it appears, and anything shaped like an email, a JWT or
 * a Google API key as well.
 */
export function scrubIdentity(text, secrets = []) {
    let out = text;
    for (const s of secrets) if (typeof s === "string" && s.length >= 4) out = out.split(s).join("[redacted]");
    // Each pattern only where its anchor occurs: the email one has no literal prefix and walks every digit run of the geometry.
    if (out.indexOf("@") >= 0) out = out.replace(EMAIL_RE, "[email]");
    if (out.indexOf("eyJ") >= 0) out = out.replace(JWT_RE, "[token]");
    if (out.indexOf("AIza") >= 0) out = out.replace(APIKEY_RE, "[key]");
    return out;
}

const utf8 = typeof TextEncoder === "function" ? new TextEncoder() : null;
function encodeText(s) {
    if (utf8) return utf8.encode(s);
    const out = new Uint8Array(byteLen(s));
    let o = 0;
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
        if (c < 0x80) out[o++] = c;
        else if (c < 0x800) { out[o++] = 0xc0 | (c >> 6); out[o++] = 0x80 | (c & 63); }
        else if (c < 0x10000) { out[o++] = 0xe0 | (c >> 12); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63); }
        else { out[o++] = 0xf0 | (c >> 18); out[o++] = 0x80 | ((c >> 12) & 63); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63); }
    }
    return out;
}

const reportId = () => new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 8);
const baseUrl = (host, base) => base || `http://${host || (typeof window !== "undefined" ? window.location.hostname : "localhost")}:${REPORT_PORT}`;

async function post(url, body, fetchFn) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), POST_TIMEOUT_MS) : null;
    try {
        const r = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, signal: ctl ? ctl.signal : undefined });
        let j = null;
        try { j = await r.json(); } catch (err) { /* a plain-text refusal */ }
        return r.ok ? { ok: true, j } : { ok: false, why: `the server said ${r.status}${j && j.error ? `: ${j.error}` : ""}` };
    } catch (err) {
        return { ok: false, why: err && err.name === "AbortError" ? "the server did not answer in 60 s" : `the report server is not reachable (${msg(err)})` };
    } finally { if (timer) clearTimeout(timer); }
}

/**
 * Build and send. `opts`: everything `buildReport` takes, plus `drawing` (send the whole
 * drawing after the report), `secrets`, `host` or `base` (the server's origin), `partBytes`,
 * `chunkBytes`, `fetch`, `onStage(label)`, `download` (false: never save a file on failure).
 * Returns what happened, with the timings of each stage. While it runs, `E._reportBusy` holds the
 * zoom-out ladder's rungs (KobinEngine._ladderRung), which ran in its yields and froze it.
 */
export async function sendDevReport(E, opts = {}) {
    if (E) E._reportBusy = true;
    try { return await sendReport(E, opts); } finally { if (E) E._reportBusy = false; }
}
async function sendReport(E, opts) {
    const res = { ok: false, why: null, id: reportId(), file: null, bytes: 0, gzBytes: 0, parts: 0, codec: null,
        buildMs: 0, longestTask: null, stringifyMs: 0, gzipMs: 0, sendMs: 0, drawing: null, saved: null };
    const stage = (s) => { try { if (opts.onStage) opts.onStage(s); } catch (err) { /* a label */ } };
    const fetchFn = opts.fetch || (typeof fetch === "function" ? fetch : null);
    const t0 = perfNow();
    let rep;
    try {
        stage("Building…");
        rep = await buildReport(E, { ...opts, id: res.id, console: opts.console || consoleTail() });
    } catch (err) { res.why = `the build failed: ${msg(err)}`; return res; }
    res.buildMs = +(perfNow() - t0).toFixed(1);
    res.longestTask = rep.build ? rep.build.longestTask : null;
    const plan = opts.drawing ? drawingPlan(E, opts.chunkBytes || DRAWING_CHUNK_BYTES) : null;
    if (plan) {
        let natives = 0;
        for (const p of plan) natives += p.objs.length;
        rep.drawing = { parts: plan.length, natives, rev: E.doc.rev };
    }
    const t1 = perfNow();
    let body = scrubIdentity(JSON.stringify(rep), opts.secrets || []);
    // The raster section's `"reportBytes":null` hole (rasterPerf.report) carries the body's size.
    body = body.replace("\"reportBytes\":null", `"reportBytes":${byteLen(body)}`);
    const raw = encodeText(body);
    body = null;
    res.bytes = raw.length;
    res.stringifyMs = +(perfNow() - t1).toFixed(1);
    stage("Compressing…");
    const codec = compression();
    res.codec = codec.name;
    const t2 = perfNow();
    let gz;
    try { gz = await codec.gzip(raw); } catch (err) { gz = raw; res.codec = "raw"; }
    const enc = res.codec === "gz1" ? "gzip" : "identity";
    res.gzBytes = gz.length;
    res.gzipMs = +(perfNow() - t2).toFixed(1);
    const url = `${baseUrl(opts.host, opts.base)}/report`;
    const PB = opts.partBytes || PART_BYTES;
    const t3 = perfNow();
    const n = Math.max(1, Math.ceil(gz.length / PB));
    res.parts = n;
    if (!fetchFn) res.why = "no fetch in this page";
    for (let i = 0; i < n && !res.why; i++) {
        stage(n > 1 ? `Sending ${i + 1}/${n}…` : "Sending…");
        const r = await post(`${url}?id=${res.id}&kind=json&part=${i}&parts=${n}&enc=${enc}`, gz.subarray(i * PB, Math.min(gz.length, (i + 1) * PB)), fetchFn);
        if (!r.ok) res.why = r.why;
        else if (r.j && r.j.file) res.file = r.j.file;
    }
    res.sendMs = +(perfNow() - t3).toFixed(1);
    if (res.why) {
        res.saved = opts.download === false ? null : saveFile(gz, `kobin-report-${res.id}.json${enc === "gzip" ? ".gz" : ""}`);
        return res;
    }
    res.ok = true;
    if (plan) res.drawing = await sendDrawing(plan, { url, id: res.id, codec, fetchFn, stage, yieldFn: opts.yieldFn || macroYield });
    return res;
}

/** The whole drawing's parts, one task each: encode, gzip, POST. */
async function sendDrawing(plan, { url, id, codec, fetchFn, stage, yieldFn }) {
    const out = { ok: false, parts: plan.length, sent: 0, bytes: 0, gzBytes: 0, encodeMs: 0, longestEncodeMs: 0, why: null };
    const enc = codec.name === "gz1" ? "gzip" : "identity";
    for (let i = 0; i < plan.length; i++) {
        stage(`Drawing ${i + 1}/${plan.length}…`);
        await yieldFn();
        const t = perfNow();
        let u8;
        try { u8 = drawingChunk(plan[i], i); } catch (err) { out.why = `part ${i} did not encode: ${msg(err)}`; return out; }
        const ms = perfNow() - t;
        out.encodeMs += ms;
        if (ms > out.longestEncodeMs) out.longestEncodeMs = +ms.toFixed(1);
        plan[i].objs = null;
        out.bytes += u8.length;
        let gz;
        try { gz = await codec.gzip(u8); } catch (err) { gz = u8; }
        out.gzBytes += gz.length;
        const r = await post(`${url}?id=${id}&kind=drawing&part=${i}&parts=${plan.length}&enc=${codec.name === "gz1" && gz !== u8 ? enc : "identity"}`, gz, fetchFn);
        if (!r.ok) { out.why = r.why; return out; }
        out.sent++;
    }
    out.encodeMs = +out.encodeMs.toFixed(1);
    out.ok = true;
    return out;
}

function saveFile(u8, name) {
    try {
        if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([u8], { type: "application/octet-stream" }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        return name;
    } catch (err) { return null; }
}

/**
 * The harness side of the loader: a report from the server (`name`, or the newest) into `E`,
 * with its whole drawing when it has one and `whole` is set. For the second-engine harness.
 */
export async function replayReport(E, { host, base, name = null, whole = true, fetch: fetchFn = fetch } = {}) {
    const root = baseUrl(host, base);
    const r = await fetchFn(name ? `${root}/file/${encodeURIComponent(name)}` : `${root}/latest`);
    const file = (r.headers && r.headers.get("X-Report-File")) || name;
    const rep = await r.json();
    let parts = null;
    if (whole && rep.drawing && rep.drawing.parts && file) {
        const list = await (await fetchFn(`${root}/list`)).json();
        const me = list.find((x) => x.name === file);
        if (me && me.drawing && me.drawing.files) {
            parts = [];
            for (const f of me.drawing.files) {
                const u8 = new Uint8Array(await (await fetchFn(`${root}/file/${encodeURIComponent(f)}`)).arrayBuffer());
                parts.push(/\.gz$/.test(f) ? await gunzipAs("gz1", u8) : u8);
            }
        }
    }
    return { report: rep, loaded: loadReport(E, rep, { drawing: parts }) };
}
