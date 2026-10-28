/**
 * scenes.memory.probe.js — what the scene index holds on the Magnum Opus: the index (inline here; the
 * worker holds the same) and the main-thread mirror, as heap + array-buffer deltas after a settled GC.
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false --testMatch "**\/scenes.memory.probe.js"
 */
import KobinEngine from "./KobinEngine";

const fs = require("fs");
const v8 = require("v8");
const FILE = (process.env.BOUNDLESS_FIXTURE || require("path").join(require("os").homedir(), "Documents", "Claude projects", "Magnum Opus.boundless.json"));
jest.setTimeout(30 * 60 * 1000);
const log = (...a) => console.log("[scene-memory]", ...a);   // eslint-disable-line no-console
v8.setFlagsFromString("--expose_gc");
const gc = require("vm").runInNewContext("gc");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function heap() { for (let i = 0; i < 4; i++) { gc(); await sleep(30); } const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; }
const mb = (b) => (b / 1048576).toFixed(1) + " MB";

test("scene index memory on the Magnum Opus", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1504, height: 868, raster: false });
    E.loadDrawing(JSON.parse(fs.readFileSync(FILE, "utf8")));
    const C = E._sceneClient;
    C.useWorker = false;   // inline: the index in this heap, so it can be dropped on its own
    let natives = 0;
    for (const L of E.doc.levels()) natives += E.doc.count(L);
    E.doc.editGroup(0);   // the family table, built as the engine's own paths build it
    const h0 = await heap();
    E.refreshScenes();
    const h1 = await heap();
    const scenes = C.core.scenes.size;
    const wr = new global.WeakRef(C.core);
    C.core = null;   // the index goes
    const h2 = await heap();
    log("index collected " + !wr.deref());
    const sent = C.sent.size;
    for (const L of E.doc.levels()) for (const o of E.doc.list(L)) if (o._sc) o._sc = undefined;
    C.sent = new Map();
    for (const k of ["recW", "recTX", "recTY", "recHO"]) if (C[k]) C[k] = null;
    C.homes = new Map(); C.homeOf = [];   // the mirror goes
    const h3 = await heap();
    log(`natives ${natives}; scenes ${scenes}; heap + array buffers: index ${mb(h1 - h2)}, main-thread mirror ${mb(h2 - h3)} (${sent} objects), rest ${mb(h3 - h0)}`);
    E.destroy();
});
