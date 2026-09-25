/**
 * One-click start for the local servers (Kobin, 2026-09-23): the app (:3000), the report server
 * (:3001) and the fixture server (:3002). A server whose port already answers is left alone. It
 * prints the phone address, copies it to the clipboard and opens a status page with a QR code;
 * closing the window stops what it started. `start-boundless.cmd` runs it.
 *
 *   node tools/launch.js           start, wait for the app, open the status page
 *   node tools/launch.js --check   only report the address and which ports answer (starts nothing)
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVERS = [
    { name: "app", port: 3000, cmd: "npm", args: ["start"] },
    { name: "reports", port: 3001, cmd: "npm", args: ["run", "report-server"] },
    { name: "fixtures", port: 3002, cmd: "python", args: [JSON.stringify(path.join(__dirname, "fixture-server.py"))] },
];
const STATUS = path.join(__dirname, ".cache", "launcher.html");
const CHECK = process.argv.includes("--check");

const portAnswers = (port) => new Promise((res) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => { s.destroy(); res(v); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    s.setTimeout(800, () => done(false));
});

/** The laptop's private IPv4 on the home network, Wi-Fi first, virtual adapters last; null if none. */
function lanAddress() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list || []) {
            if ((a.family !== "IPv4" && a.family !== 4) || a.internal) continue;
            if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
            const score = (/wi-?fi|wlan|wireless/i.test(name) ? 2 : 0)
                - (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Bluetooth/i.test(name) ? 5 : 0);
            out.push({ address: a.address, score });
        }
    }
    out.sort((x, y) => y.score - x.score);
    return out.length ? out[0].address : null;
}

const appReady = () => new Promise((res) => {
    const req = http.get({ host: "127.0.0.1", port: 3000, path: "/", timeout: 2000 }, (r) => { r.resume(); res(r.statusCode === 200); });
    req.on("error", () => res(false));
    req.on("timeout", () => { req.destroy(); res(false); });
});

function statusPage(phone) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const phoneBlock = phone
        ? `<p class="big"><a href="${esc(phone)}">${esc(phone)}</a></p><div id="qr"></div>
<p class="note">Scan with the phone's camera (same Wi-Fi). Signing in there needs this address under
<b>Authorized domains</b> in <a href="https://console.firebase.google.com/project/bound-less-kk/authentication/settings">Firebase Auth</a>;
the address can change when the router hands out a new one.</p>`
        : `<p class="big">No Wi-Fi address found — is the laptop on the network?</p>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>bound.less servers</title>
<style>
body{font-family:system-ui,sans-serif;margin:32px;max-width:720px;color:#2b2520;background:#fbf8f2}
h1{font-size:22px;margin:0 0 20px}h2{font-size:15px;margin:28px 0 6px;color:#6b5f55;text-transform:uppercase;letter-spacing:.04em}
.big{font-size:28px;font-weight:600;margin:4px 0}.note{font-size:14px;color:#6b5f55}#qr{margin:12px 0}
a{color:#b4471f}ul{padding-left:20px;line-height:1.8}
</style></head><body>
<h1>bound.less servers are running</h1>
<p class="note">Started ${esc(new Date().toLocaleString())}. Close the "bound.less servers" window to stop them.</p>
<h2>On this computer</h2><p class="big"><a href="http://localhost:3000/#/canvases">localhost:3000</a></p>
<h2>On the phone</h2>${phoneBlock}
<h2>Reports</h2><ul>
<li>The app's Report button sends to this laptop; the files land in <code>.kobin-reports</code> in the repo, where Claude reads them.</li>
<li><a href="http://localhost:3001/list">Recent reports</a></li></ul>
${phone ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>try{new QRCode(document.getElementById("qr"),{text:${JSON.stringify(phone)},width:200,height:200});}catch(e){}</script>` : ""}
</body></html>`;
}

async function main() {
    const ip = lanAddress();
    const phone = ip ? `http://${ip}:3000/#/canvases` : null;
    const states = await Promise.all(SERVERS.map((s) => portAnswers(s.port)));
    if (CHECK) {
        console.log("phone address:", phone || "(none found)");
        SERVERS.forEach((s, i) => console.log(`${s.name} :${s.port} ${states[i] ? "answers" : "free"}`));
        fs.mkdirSync(path.dirname(STATUS), { recursive: true });
        fs.writeFileSync(STATUS, statusPage(phone));
        console.log("status page written:", STATUS);
        return;
    }
    const kids = [];
    SERVERS.forEach((s, i) => {
        if (states[i]) { console.log(`[${s.name}] already running on :${s.port} — left alone`); return; }
        const p = spawn(s.cmd, s.args, { cwd: ROOT, shell: true, env: { ...process.env, BROWSER: "none" } });
        const tag = `[${s.name}] `;
        const pipe = (stream, out) => {
            let rest = "";
            stream.on("data", (b) => {
                const lines = (rest + b.toString()).split(/\r?\n/);
                rest = lines.pop();
                for (const l of lines) if (l.trim()) out.write(tag + l + "\n");
            });
        };
        pipe(p.stdout, process.stdout); pipe(p.stderr, process.stderr);
        p.on("exit", (code) => console.log(`${tag}stopped (${code})`));
        kids.push(p);
        console.log(`${tag}starting on :${s.port}`);
    });
    const stopAll = () => {
        for (const p of kids) { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" }); } catch (e) { /* already gone */ } }
        process.exit(0);
    };
    process.on("SIGINT", stopAll);
    process.on("SIGTERM", stopAll);

    // The app compiles for a minute on a cold start.
    const t0 = Date.now();
    while (!(await appReady())) {
        if (Date.now() - t0 > 5 * 60 * 1000) { console.log("The app has not answered in 5 minutes — see the [app] lines above."); break; }
        await new Promise((r) => setTimeout(r, 2000));
    }
    fs.mkdirSync(path.dirname(STATUS), { recursive: true });
    fs.writeFileSync(STATUS, statusPage(phone));
    if (phone) { try { execSync("clip", { input: phone }); } catch (e) { /* no clipboard */ } }
    const bar = "=".repeat(64);
    console.log(`\n${bar}\n  bound.less is running.\n  This computer:  http://localhost:3000/#/canvases\n`
        + `  Phone:          ${phone || "(no Wi-Fi address found)"}${phone ? "   (copied)" : ""}\n`
        + `  Close this window to stop the servers.\n${bar}\n`);
    try { await require("open")(STATUS); } catch (e) { console.log("Status page:", STATUS); }
}

main();
