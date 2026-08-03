/**
 * Kobin report server — receives debug reports (drawing snapshot + perf log +
 * device info) POSTed from any device on the LAN by the app's Report button,
 * and writes them to boundless/.kobin-reports/ for inspection on the dev box.
 *
 * Run: node tools/report-server.js   (or: npm run report-server)
 * Listens on 0.0.0.0:3001 — a separate port so the CRA dev server on :3000
 * doesn't need a restart or proxy config.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3001;
const DIR = path.join(__dirname, "..", ".kobin-reports");
fs.mkdirSync(DIR, { recursive: true });

http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET" && (req.url === "/latest" || req.url.startsWith("/report/"))) {
        // Newest report, or one explicitly named report for regression
        // reconstruction. Keep the named route basename-only: this endpoint
        // must never become an arbitrary filesystem reader.
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
        if (!files.length) { res.writeHead(404); res.end("no reports"); return; }
        let selected = files[files.length - 1];
        if (req.url.startsWith("/report/")) {
            let requested = "";
            try { requested = decodeURIComponent(req.url.slice("/report/".length)); } catch (e) { /* bad encoding */ }
            if (!requested || path.basename(requested) !== requested || !files.includes(requested)) {
                res.writeHead(404); res.end("report not found"); return;
            }
            selected = requested;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fs.readFileSync(path.join(DIR, selected)));
        return;
    }
    if (req.method !== "POST") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("kobin report server: POST a JSON report here; GET /latest or /report/<filename>");
        return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on("end", () => {
        try {
            JSON.parse(body); // validate before writing
            const name = "report-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
            fs.writeFileSync(path.join(DIR, name), body);
            console.log(new Date().toISOString(), "saved", name, body.length, "bytes");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, file: name }));
        } catch (e) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("bad report: " + e);
        }
    });
}).listen(PORT, "0.0.0.0", () => console.log("kobin report server listening on 0.0.0.0:" + PORT));
