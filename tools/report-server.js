/**
 * Kobin report server — receives the dev panel's Report (OPEN-FLAGS F58) from any device on
 * the LAN and writes it to .kobin-reports/.
 *
 *   POST /report?id=&kind=json&part=&parts=&enc=gzip   the report, in parts: reassembled in
 *        order and gunzipped into report-<time>.json when the last one lands
 *   POST /report?id=&kind=drawing&part=&parts=&enc=    the whole-drawing opt-in: kobin-2 frame
 *        chunks, kept as sent in report-<time>.drawing/ (a manifest when complete)
 *   POST /report  (no id)   an older build's single JSON body, gzip if Content-Encoding says so
 *   GET  /latest            the newest report-*.json (header X-Report-File names it)
 *   GET  /list              the newest 50 reports with their sizes and drawing parts
 *   GET  /file/<name>       a report, or `<report>.drawing/<part>`
 *
 * Every body streams to disk; a part over PART_MAX is refused with 413. Run:
 * node tools/report-server.js (npm run report-server), 0.0.0.0:3001, a port of its own so
 * the dev server on :3000 needs no proxy.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = 3001;
const DIR = path.join(__dirname, "..", ".kobin-reports");
const PART_MAX = 32 << 20;
const LEGACY_MAX = 512 << 20;
const VALIDATE_MAX = 64 << 20;   // a finished report up to this size is parsed before it is kept
const REPORT_RE = /^report-[0-9TZ-]+\.json$/;
const PART_FILE_RE = /^part-\d{4}\.kb2(?:\.gz)?$/;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function createReportServer({ dir = DIR, partMax = PART_MAX, legacyMax = LEGACY_MAX, log = console.log } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const partsDir = path.join(dir, ".parts");
    const reports = new Map();   // report id -> { base, at, kinds: { json|drawing: { parts, got:Set, enc } } }

    const newBase = () => {
        const first = "report-" + stamp();
        let base = first;
        const taken = (b) => fs.existsSync(path.join(dir, b + ".json")) || [...reports.values()].some((r) => r.base === b);
        for (let k = 1; taken(base); k++) base = first + "-" + k;
        return base;
    };
    const stateOf = (id) => {
        for (const [k, r] of reports) if (Date.now() - r.at > 3600e3) reports.delete(k);
        let r = reports.get(id);
        if (!r) { r = { base: newBase(), at: Date.now(), kinds: {} }; reports.set(id, r); }
        return r;
    };

    /** Stream `req` to `file`, at most `max` bytes. Resolves the byte count, or null when refused (the rest is drained). */
    const receive = (req, file, max, gunzip) => new Promise((resolve, reject) => {
        const out = fs.createWriteStream(file);
        let n = 0, over = false;
        const src = gunzip ? req.pipe(zlib.createGunzip()) : req;
        req.on("data", (c) => {
            n += c.length;
            if (!over && n > max) {
                over = true;
                src.unpipe(out); out.destroy();
                fs.rm(file, { force: true }, () => {});
                if (n > max * 4) req.destroy();
            }
        });
        req.on("end", () => { if (over) resolve(null); });
        req.on("close", () => { if (over) resolve(null); });
        req.on("error", (err) => { if (!over) reject(err); });
        if (gunzip) src.on("error", (err) => { out.destroy(); reject(err); });
        out.on("error", (err) => { if (!over) reject(err); });
        out.on("finish", () => { if (!over) resolve(n); });
        src.pipe(out);
    });

    const json = (res, code, body, headers = {}) => {
        res.writeHead(code, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(body));
    };
    const sendFile = (res, file, name) => {
        const st = fs.statSync(file);
        res.writeHead(200, { "Content-Type": name.endsWith(".json") ? "application/json" : "application/octet-stream", "Content-Length": st.size, "X-Report-File": name });
        fs.createReadStream(file).pipe(res);
    };
    const reportNames = () => fs.readdirSync(dir).filter((f) => REPORT_RE.test(f)).sort();
    const drawingOf = (name) => {
        const d = path.join(dir, name.replace(/\.json$/, ".drawing"));
        if (!fs.existsSync(d)) return null;
        const files = fs.readdirSync(d).filter((f) => PART_FILE_RE.test(f)).sort();
        let manifest = null;
        try { manifest = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")); } catch (err) { /* not complete */ }
        return { parts: files.length, complete: !!manifest, files: files.map((f) => name.replace(/\.json$/, ".drawing") + "/" + f),
            bytes: files.reduce((b, f) => b + fs.statSync(path.join(d, f)).size, 0) };
    };

    /** Validate and keep a finished report written to `tmp`. */
    const keep = (tmp, name) => {
        const size = fs.statSync(tmp).size;
        if (size <= VALIDATE_MAX) JSON.parse(fs.readFileSync(tmp, "utf8"));
        fs.renameSync(tmp, path.join(dir, name));
        return size;
    };

    async function onPart(req, res, q) {
        const id = q.get("id"), kind = q.get("kind"), enc = q.get("enc") || "identity";
        const part = +q.get("part"), parts = +q.get("parts");
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id || "") || !(kind === "json" || kind === "drawing") || !(enc === "gzip" || enc === "identity")
            || !Number.isInteger(part) || !Number.isInteger(parts) || part < 0 || parts < 1 || parts > 10000 || part >= parts) {
            req.resume();
            return json(res, 400, { ok: false, error: "bad part: id, kind (json|drawing), part < parts, enc (gzip|identity)" });
        }
        const r = stateOf(id);
        const k = r.kinds[kind] || (r.kinds[kind] = { parts, got: new Set(), enc, bytes: 0 });
        if (k.parts !== parts) { req.resume(); return json(res, 400, { ok: false, error: `parts changed mid-report (${k.parts} then ${parts})` }); }
        const tag = String(part).padStart(4, "0");
        let file;
        if (kind === "json") {
            fs.mkdirSync(path.join(partsDir, id), { recursive: true });
            file = path.join(partsDir, id, "json-" + tag);
        } else {
            const d = path.join(dir, r.base + ".drawing");
            fs.mkdirSync(d, { recursive: true });
            file = path.join(d, `part-${tag}.kb2${enc === "gzip" ? ".gz" : ""}`);
        }
        const n = await receive(req, file + ".tmp", partMax, false);
        if (n == null) return json(res, 413, { ok: false, error: `part over ${partMax} bytes` }, { Connection: "close" });
        fs.renameSync(file + ".tmp", file);
        k.got.add(part); k.bytes += n;
        const out = { ok: true, kind, part, received: k.got.size, of: parts, complete: k.got.size === parts, file: r.base + ".json" };
        if (!out.complete) return json(res, 200, out);
        if (kind === "json") {
            const tmp = path.join(dir, r.base + ".json.tmp");
            // The parts in index order, as one stream, through gunzip when they were gzipped.
            await new Promise((resolve, reject) => {
                const w = fs.createWriteStream(tmp);
                const z = enc === "gzip" ? zlib.createGunzip() : null;
                const sink = z || w;
                if (z) { z.pipe(w); z.on("error", reject); }
                w.on("finish", resolve); w.on("error", reject);
                let i = 0;
                const next = () => {
                    if (i >= parts) { sink.end(); return; }
                    const rs = fs.createReadStream(path.join(partsDir, id, "json-" + String(i++).padStart(4, "0")));
                    rs.on("error", reject);
                    rs.on("end", next);
                    rs.pipe(sink, { end: false });
                };
                next();
            }).catch((err) => { fs.rmSync(tmp, { force: true }); throw err; });
            fs.rmSync(path.join(partsDir, id), { recursive: true, force: true });
            try { out.bytes = keep(tmp, r.base + ".json"); } catch (err) {
                fs.rmSync(tmp, { force: true });
                return json(res, 400, { ok: false, error: "the report is not JSON: " + String(err.message).slice(0, 120) });
            }
            log(new Date().toISOString(), "saved", r.base + ".json", out.bytes, "bytes from", parts, "part(s),", k.bytes, "sent");
        } else {
            fs.writeFileSync(path.join(dir, r.base + ".drawing", "manifest.json"), JSON.stringify({ id, parts, enc, bytes: k.bytes, at: new Date().toISOString() }));
            log(new Date().toISOString(), "saved", r.base + ".drawing/", parts, "part(s),", k.bytes, "bytes");
        }
        return json(res, 200, out);
    }

    async function onLegacy(req, res) {
        const base = newBase();
        const tmp = path.join(dir, base + ".json.tmp");
        const gz = /gzip/i.test(req.headers["content-encoding"] || "");
        const n = await receive(req, tmp, legacyMax, gz);
        if (n == null) return json(res, 413, { ok: false, error: `report over ${legacyMax} bytes` }, { Connection: "close" });
        try { keep(tmp, base + ".json"); } catch (err) {
            fs.rmSync(tmp, { force: true });
            return json(res, 400, { ok: false, error: "bad report: " + String(err.message).slice(0, 120) });
        }
        log(new Date().toISOString(), "saved", base + ".json", n, "bytes");
        return json(res, 200, { ok: true, file: base + ".json" });
    }

    return http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "content-type, content-encoding");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "X-Report-File");
        const url = new URL(req.url, "http://localhost");
        const fail = (err) => { if (!res.headersSent) json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 160) }); else res.destroy(); };
        try {
            if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
            if (req.method === "GET" && url.pathname === "/latest") {
                const names = reportNames();
                if (!names.length) { json(res, 404, { ok: false, error: "no reports" }); return; }
                const name = names[names.length - 1];
                sendFile(res, path.join(dir, name), name);
                return;
            }
            if (req.method === "GET" && url.pathname === "/list") {
                const names = reportNames().reverse().slice(0, 50);
                json(res, 200, names.map((name) => {
                    const st = fs.statSync(path.join(dir, name));
                    return { name, bytes: st.size, mtime: st.mtime.toISOString(), drawing: drawingOf(name) };
                }));
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/file/")) {
                const name = decodeURIComponent(url.pathname.slice(6));
                const [a, b, ...rest] = name.split("/");
                const ok = !rest.length && (b == null ? REPORT_RE.test(a) : /^report-[0-9TZ-]+\.drawing$/.test(a) && (PART_FILE_RE.test(b) || b === "manifest.json"));
                const file = path.join(dir, name);
                if (!ok || !fs.existsSync(file)) { json(res, 404, { ok: false, error: "no such report file" }); return; }
                sendFile(res, file, name);
                return;
            }
            if (req.method === "POST") {
                (url.searchParams.get("id") ? onPart(req, res, url.searchParams) : onLegacy(req, res)).catch(fail);
                return;
            }
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("kobin report server: POST /report (parts: ?id&kind&part&parts&enc); GET /latest, /list, /file/<name>");
        } catch (err) { fail(err); }
    });
}

if (require.main === module) {
    createReportServer().listen(PORT, "0.0.0.0", () => console.log("kobin report server listening on 0.0.0.0:" + PORT));
}
module.exports = { createReportServer, PART_MAX, REPORT_RE };
