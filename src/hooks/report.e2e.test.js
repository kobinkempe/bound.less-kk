/**
 * report.e2e.test.js — the dev report end to end in jsdom (OPEN-FLAGS F58): the report server
 * (`tools/report-server.js`) on a free port over a temporary directory, the transport
 * (`reportSend.js`) through a fetch over Node's http, the file back into a second engine
 * (`__testkit__/reportReplay.js`), and the reader (`tools/report-read.js`).
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import zlib from "zlib";
import { Buffer } from "buffer";
import { sendDevReport, scrubIdentity } from "./reportSend";
import { setCompression } from "../cloud/gzip";
import { mkEngine, useEngines, drawStroke, eraseGesture, drag, descend, picture } from "../engine/__testkit__/harness";
import { readReportFile, drawingPartsOf, engineFromReport } from "../engine/__testkit__/reportReplay";

const { createReportServer } = require("../../tools/report-server");
const { summarise } = require("../../tools/report-read");

useEngines();
const micro = () => Promise.resolve();
const nodeGzip = { name: "gz1", gzip: async (u8) => new Uint8Array(zlib.gzipSync(Buffer.from(u8))), gunzip: async (u8) => new Uint8Array(zlib.gunzipSync(Buffer.from(u8))) };

/** `fetch` over Node's http: what the transport and the replay need of it. */
function nodeFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || "GET", headers: opts.headers || {} }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const buf = Buffer.concat(chunks);
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
                    headers: { get: (k) => res.headers[k.toLowerCase()] || null },
                    json: async () => JSON.parse(buf.toString("utf8")),
                    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
                    text: async () => buf.toString("utf8"),
                });
            });
        });
        req.on("error", reject);
        if (opts.body != null) req.write(typeof opts.body === "string" ? opts.body : Buffer.from(opts.body));
        req.end();
    });
}

let dir, server, base;
beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kobin-reports-"));
    server = createReportServer({ dir, partMax: 256 << 10, log: () => {} });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    setCompression(null);
});
const post = (q, body, headers = {}) => nodeFetch(`${base}/report${q}`, { method: "POST", body, headers: { "Content-Type": "application/octet-stream", ...headers } });

function smallDrawing() {
    const E = mkEngine();
    drawStroke(E, [[100, 100], [200, 160], [300, 120]]);
    drawStroke(E, [[420, 300], [520, 380], [600, 330]], 20, "#c00");
    drag(E, [200, 160], [240, 190]);
    descend(E, 1);
    drawStroke(E, [[380, 280], [420, 320], [460, 300]], 6, "#00c");
    E.setTool("pen");
    eraseGesture(E, [[410, 290], [430, 310]], 12);
    E._render();
    return E;
}

describe("RS — the report server", () => {
    test("RS-1 an older build's single JSON body, plain and gzip, is kept and /latest serves the newest", async () => {
        const a = await post("", JSON.stringify({ v: 1, when: "a" }), { "Content-Type": "application/json" });
        expect(a.ok).toBe(true);
        const b = await post("", zlib.gzipSync(JSON.stringify({ v: 1, when: "b" })), { "Content-Encoding": "gzip" });
        const bj = await b.json();
        expect(bj.ok).toBe(true);
        const latest = await nodeFetch(`${base}/latest`);
        expect(latest.headers.get("X-Report-File")).toBe(bj.file);
        expect((await latest.json()).when).toBe("b");
    });

    test("RS-2 a gzip report in parts, sent out of order, is reassembled in order", async () => {
        const body = JSON.stringify({ v: 2, pad: "x".repeat(50000), n: [...Array(5000).keys()] });
        const gz = zlib.gzipSync(body, { level: 0 });
        const n = 4, size = Math.ceil(gz.length / n);
        const order = [2, 0, 3, 1];
        let last = null;
        for (const i of order) last = await (await post(`?id=rs2&kind=json&part=${i}&parts=${n}&enc=gzip`, gz.subarray(i * size, (i + 1) * size))).json();
        expect(last.complete).toBe(true);
        expect(fs.readFileSync(path.join(dir, last.file), "utf8")).toBe(body);
        expect(fs.existsSync(path.join(dir, ".parts", "rs2"))).toBe(false);
    });

    test("RS-3 whole-drawing parts are kept as sent, with a manifest once complete, and listed and served", async () => {
        const j = await (await post("?id=rs3&kind=json&part=0&parts=1&enc=identity", JSON.stringify({ v: 2, drawing: { parts: 2 } }))).json();
        const p1 = await (await post("?id=rs3&kind=drawing&part=1&parts=2&enc=gzip", zlib.gzipSync("one"))).json();
        expect(p1.complete).toBe(false);
        const p0 = await (await post("?id=rs3&kind=drawing&part=0&parts=2&enc=gzip", zlib.gzipSync("zero"))).json();
        expect(p0.complete).toBe(true);
        const list = await (await nodeFetch(`${base}/list`)).json();
        const me = list.find((r) => r.name === j.file);
        expect(me.drawing.parts).toBe(2);
        expect(me.drawing.complete).toBe(true);
        const part = await nodeFetch(`${base}/file/${encodeURIComponent(me.drawing.files[0])}`);
        expect(zlib.gunzipSync(Buffer.from(await part.arrayBuffer())).toString()).toBe("zero");
    });

    test("RS-4 a part over the cap is refused with 413, nothing is kept, and the server goes on", async () => {
        const before = fs.readdirSync(dir).length;
        const r = await post("?id=rs4&kind=json&part=0&parts=1&enc=identity", Buffer.alloc(300 << 10, 65));
        expect(r.status).toBe(413);
        expect(fs.readdirSync(dir).length).toBe(before);
        expect((await nodeFetch(`${base}/latest`)).ok).toBe(true);
    });

    test("RS-5 a body that is not JSON is refused and not kept; a path outside the reports is not served", async () => {
        const names = () => fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
        const before = names();
        const r = await post("?id=rs5&kind=json&part=0&parts=1&enc=identity", "{not json");
        expect(r.status).toBe(400);
        expect(names()).toBe(before);
        const outside = path.join(dir, "..", `kobin-outside-${path.basename(dir)}.json`);
        fs.writeFileSync(outside, "{}");
        try { expect((await nodeFetch(`${base}/file/..%2F${path.basename(outside)}`)).status).toBe(404); } finally { fs.rmSync(outside, { force: true }); }
        expect((await nodeFetch(`${base}/file/report-x.drawing%2F..%2F..%2Fa.json`)).status).toBe(404);
    });
});

describe("RE — the transport, end to end", () => {
    test("RE-1 a report in gzip parts with the whole drawing lands, reads, and loads back into the same picture", async () => {
        setCompression(nodeGzip);
        const E = smallDrawing();
        E.flushErases();   // settled: a bake timer firing during the POSTs would change the source after the build read it
        const r = await sendDevReport(E, { base, fetch: nodeFetch, yieldFn: micro, partBytes: 4 << 10, drawing: true, chunkBytes: 2 << 10, download: false });
        expect(r.why).toBe(null);
        expect(r.ok).toBe(true);
        expect(r.codec).toBe("gz1");
        expect(r.parts).toBeGreaterThan(1);
        expect(r.drawing.ok).toBe(true);
        expect(r.drawing.parts).toBeGreaterThan(1);
        const file = path.join(dir, r.file);
        const rep = readReportFile(file);
        expect(rep.meta.id).toBe(r.id);
        expect(rep.drawing.parts).toBe(r.drawing.parts);
        const parts = drawingPartsOf(file);
        expect(parts.length).toBe(r.drawing.parts);
        // The extract alone, and the whole drawing, each give the source's picture at its camera.
        expect(picture(engineFromReport(rep))).toBe(picture(E));
        const W = engineFromReport(rep, { parts });
        expect(picture(W)).toBe(picture(E));
        expect(JSON.stringify(W.doc.serializeNatives())).toBe(JSON.stringify(E.doc.serializeNatives()));
        const lines = summarise(rep, { file, bytes: fs.statSync(file).size }).join("\n");
        for (const w of ["camera", "document", "extract", "drawing", "memory", "save", "moves", "erase", "journal"]) expect(lines).toContain(w);
        expect(lines).toContain("complete");
    });

    test("RE-2 the identity never reaches the file: the uid, the email and token shapes are scrubbed", async () => {
        setCompression(null);
        const E = smallDrawing();
        const uid = "Uq7xPlmN3bVc9Kd2", email = "someone.real@example.org";
        const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJ1c2VyX2lkIjoiVXE3eCJ9.c2lnbmF0dXJlLWJ5dGVz";
        const r = await sendDevReport(E, {
            base, fetch: nodeFetch, yieldFn: micro, download: false, secrets: [uid, email],
            errors: [{ t: 1, msg: `permission denied at users/${uid}/canvases for ${email}` }],
            console: [{ t: 2, level: "warn", msg: `token ${jwt} other@mail.co` }],
            cloud: { signedIn: true, error: `users/${uid}` },
        });
        expect(r.ok).toBe(true);
        const text = fs.readFileSync(path.join(dir, r.file), "utf8");
        for (const s of [uid, email, jwt, "other@mail.co"]) expect(text.includes(s)).toBe(false);
        expect(text).toContain("[redacted]");
        expect(text).toContain("[token]");
        expect(scrubIdentity("a@b.cd x", [])).toBe("[email] x");
    });

    test("RE-3 a server that cannot be reached is a report that says why", async () => {
        const E = smallDrawing();
        const r = await sendDevReport(E, { base: "http://127.0.0.1:1", fetch: nodeFetch, yieldFn: micro, download: false });
        expect(r.ok).toBe(false);
        expect(r.why).toMatch(/not reachable/);
        expect(r.bytes).toBeGreaterThan(0);
    });

    test("RE-4 the raster section's reportBytes hole carries the body's size", async () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [300, 200]]);
        let sent = null;
        const fakeFetch = async (url, o) => { sent = o.body; return { ok: true, status: 200, json: async () => ({ ok: true, file: "report-x.json" }) }; };
        // An SVG engine has no raster section: the report is sent as it is, with no hole to fill.
        const r = await sendDevReport(E, { base, fetch: fakeFetch, yieldFn: micro, download: false });
        expect(r.ok).toBe(true);
        const text = Buffer.from(sent).toString("utf8");
        expect(text).not.toContain("\"reportBytes\":null");
        const host = document.createElement("div");
        document.body.appendChild(host);
        const KobinEngine = require("../engine/KobinEngine").default;
        const R = new KobinEngine(host, { width: 800, height: 600, raster: true });
        try {
            drawStroke(R, [[100, 100], [300, 200]]);
            await sendDevReport(R, { base, fetch: fakeFetch, yieldFn: micro, download: false });
            const t2 = Buffer.from(sent).toString("utf8");
            const m = /"reportBytes":(\d+)/.exec(t2);
            expect(m).toBeTruthy();
            expect(Math.abs(+m[1] - Buffer.byteLength(t2)) <= String(m[1]).length).toBe(true);
        } finally { R.destroy(); }
    });
});

describe("RR — the reader", () => {
    test("RR-1 an older report (v1, the whole drawing as snapshot) still reads", () => {
        const lines = summarise({ v: 1, when: "2026-09-08T00:00:00Z", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0", screen: { w: 800, h: 600, dpr: 1 },
            camera: { level: 2, inScale: 3, effectiveZoom: 1e6 }, snapshot: { natives: { 0: [{}, {}], 1: [{}] } }, journal: [{}], errors: [] }).join("\n");
        expect(lines).toContain("3 natives in 2 frames");
        expect(lines).toContain("Chrome 128 on Windows");
    });
});
