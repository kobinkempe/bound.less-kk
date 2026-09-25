#!/usr/bin/env node
/**
 * extract-fixture.js — pull the fixtures of RASTERISER-PLAN §9.3 out of a diagnostic report
 * WITHOUT loading the report into an agent's context, and without holding it in memory: the
 * report is streamed and only the values asked for are ever parsed. `.kobin-reports/` is not in
 * git and the biggest report in it is 16 MB; the canvas the plan quotes is 92 MB.
 *
 *   node tools/extract-fixture.js list  <report.json>
 *   node tools/extract-fixture.js fz    <report.json> [--frame 0] [--id 4] [--out path]
 *   node tools/extract-fixture.js f40   <report.json> [--out path]
 *   node tools/extract-fixture.js dense <report.json> [--out path]
 *
 * `fz` and `f40` write small committed fixtures under src/engine/__fixtures__/. `dense` writes
 * the camera and the snapshot alone — everything a probe needs to build a real render list —
 * and says whether the result is small enough to commit (§9.3 puts the line at 2 MB); it
 * defaults into `.kobin-reports/`, which git does not track.
 */

const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "..", "src", "engine", "__fixtures__");
const COMMIT_LIMIT = 2 << 20;

// ---------------------------------------------------------------------------
// The scanner: one pass over the bytes, a stack of keys, and a buffer that only fills while a
// WANTED value is being read. Memory is one chunk plus one object.
// ---------------------------------------------------------------------------

/**
 * @param {string} file the report
 * @param {(pathArr: string[]) => boolean} wanted true for a value that should be parsed
 * @param {(pathArr: string[], value: any) => void} emit called with each wanted value
 */
function scan(file, wanted, emit) {
    const { StringDecoder } = require("string_decoder");
    const decoder = new StringDecoder("utf8");
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1 << 20);
    // One frame per open container. `key` is the key of the child being read (objects) and
    // `index` its position (arrays), so the stack IS the path of the value under the cursor.
    const stack = [];
    let inStr = false, esc = false, expectKey = false;
    let key = "", inKey = false;
    let cap = null, capDepth = 0, capPath = null;
    let bytes = 0, read = 0;
    const pathOf = () => stack.map((f) => (f.arr ? String(f.index) : f.key));

    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        const s = decoder.write(buf.slice(0, read));
        bytes += read;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (cap !== null) cap += c;
            if (inStr) {
                if (esc) esc = false;
                else if (c === "\\") esc = true;
                else if (c === '"') { inStr = false; inKey = false; }
                else if (inKey) key += c;
                continue;
            }
            if (c === '"') {
                inStr = true;
                if (cap === null && expectKey) { key = ""; inKey = true; expectKey = false; }
                continue;
            }
            if (c === "{" || c === "[") {
                if (cap !== null) { capDepth++; continue; }
                const p = pathOf();
                if (wanted(p)) { cap = c; capDepth = 1; capPath = p; continue; }
                stack.push({ arr: c === "[", key: null, index: 0 });
                expectKey = c === "{";
                continue;
            }
            if (c === "}" || c === "]") {
                if (cap !== null) {
                    if (--capDepth === 0) { emit(capPath, JSON.parse(cap)); cap = null; }
                    continue;
                }
                stack.pop();
                continue;
            }
            if (cap !== null) continue;
            if (c === ":") { if (stack.length) stack[stack.length - 1].key = key; continue; }
            if (c === ",") {
                const top = stack[stack.length - 1];
                if (top) { if (top.arr) top.index++; else { expectKey = true; top.key = null; } }
                continue;
            }
        }
    }
    fs.closeSync(fd);
    return bytes;
}

/** A path matcher: `["snapshot", "natives", "*", "*"]` with `*` for any one segment. */
const matcher = (pat) => (p) => p.length === pat.length && pat.every((x, i) => x === "*" || x === p[i]);

// ---------------------------------------------------------------------------
// The loop grammar, enough of it to find an arc's radius (geometry/loop.js:1-25).
// ---------------------------------------------------------------------------

const WIDTH = { 0: 3, 1: 8, 2: 9, 3: 16 };
function arcRadii(loops) {
    const out = [];
    for (const nums of loops || []) {
        for (let o = 2; o < nums.length; o += WIDTH[nums[o]] || 8) {
            const code = nums[o];
            if (code === 1 || code === 3) out.push(Math.abs(nums[o + 3]));
        }
    }
    return out;
}
const pieceCount = (loops) => (loops || []).reduce((n, nums) => {
    let c = 0;
    for (let o = 2; o < nums.length; o += WIDTH[nums[o]] || 8) c++;
    return n + c;
}, 0);

// ---------------------------------------------------------------------------
// The four modes.
// ---------------------------------------------------------------------------

function argOf(args, name, dflt) {
    const i = args.indexOf("--" + name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
}

function writeFixture(out, obj) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(obj));
    const n = fs.statSync(out).size;
    console.log("wrote " + out + " — " + (n / 1024).toFixed(1) + " KB"
        + (n > COMMIT_LIMIT ? "  (over §9.3's 2 MB line: do NOT commit this one)" : ""));
}

function modeList(file) {
    const frames = new Map();
    let camera = null, screen = null;
    const bytes = scan(file, (p) => matcher(["snapshot", "natives", "*", "*"])(p) || matcher(["camera"])(p) || matcher(["screen"])(p),
        (p, v) => {
            if (p[0] === "camera") camera = v;
            else if (p[0] === "screen") screen = v;
            else {
                const f = p[2], rec = frames.get(f) || { objects: 0, pieces: 0, strokes: 0, shapes: 0, fills: 0, maxR: 0 };
                rec.objects++;
                rec.pieces += pieceCount(v.loops);
                if (v.type === "stroke") rec.strokes++;
                else if (v.type === "fill") rec.fills++;
                else rec.shapes++;
                for (const r of arcRadii(v.loops)) if (r > rec.maxR && isFinite(r)) rec.maxR = r;
                frames.set(f, rec);
            }
        });
    console.log(path.basename(file) + " — " + (bytes / (1 << 20)).toFixed(1) + " MB streamed");
    console.log("camera " + JSON.stringify(camera) + "  screen " + JSON.stringify(screen));
    const rows = [...frames.entries()].sort((a, b) => b[1].objects - a[1].objects);
    let objects = 0, pieces = 0;
    for (const [f, r] of rows) {
        objects += r.objects; pieces += r.pieces;
        if (r.objects >= 3) {
            console.log("  " + String(r.objects).padStart(6) + " objects  " + String(r.pieces).padStart(8) + " pieces  "
                + "maxR " + r.maxR.toExponential(2) + "  " + f.slice(-40));
        }
    }
    console.log("  " + frames.size + " frames, " + objects + " natives, " + pieces + " pieces in all");
}

function modeFz(file, args) {
    const frame = argOf(args, "frame", "0"), id = +argOf(args, "id", "4");
    let found = null, camera = null;
    scan(file, (p) => matcher(["snapshot", "natives", "*", "*"])(p) || matcher(["camera"])(p),
        (p, v) => {
            if (p[0] === "camera") camera = v;
            else if (p[2] === frame && v.id === id) found = v;
        });
    if (!found) throw new Error("no object id " + id + " in frame " + frame);
    const out = argOf(args, "out", path.join(FIXTURES, "fz-object-" + id + ".json"));
    writeFixture(out, {
        note: "RASTERISER-PLAN §9.3's F-Z object: the sliver that fades. Extracted by tools/extract-fixture.js.",
        report: path.basename(file), frame, camera, pieces: pieceCount(found.loops), object: found,
    });
}

function modeF40(file, args) {
    // The red piece is the one carrying the largest arc radius in the report — the re-homed
    // circle whose radius is 2.3e8 units and whose edge float32 put 463 px away (F40).
    let best = null, bestR = 0, bestFrame = null;
    scan(file, matcher(["snapshot", "natives", "*", "*"]), (p, v) => {
        for (const r of arcRadii(v.loops)) {
            if (isFinite(r) && r > bestR) { bestR = r; best = v; bestFrame = p[2]; }
        }
    });
    if (!best) throw new Error("no arc piece in " + path.basename(file));
    const out = argOf(args, "out", path.join(FIXTURES, "f40-pieces.json"));
    writeFixture(out, {
        note: "RASTERISER-PLAN §9.3's F40 piece: the largest arc radius in this report, clipped to its tile.",
        report: path.basename(file), frame: bestFrame, radius: bestR, pieces: pieceCount(best.loops), object: best,
    });
}

function modeDense(file, args) {
    // Everything a probe needs to build a REAL render list — the camera and the document — and
    // nothing else: no perf ring, no journal, no growth samples.
    const natives = {};
    let camera = null, summary = null, screen = null, crossings = null;
    const v = "dev-0";
    // `snapshot.camera` is the engine's own camera state (activeLevel, frame, pan); the report's
    // top-level `camera` is a three-field summary and loading THAT leaves the engine at level 0.
    scan(file, (p) => matcher(["snapshot", "natives", "*", "*"])(p) || matcher(["snapshot", "camera"])(p)
        || matcher(["camera"])(p) || matcher(["screen"])(p) || matcher(["snapshot", "crossings"])(p),
        (p, val) => {
            if (p[1] === "camera") camera = val;
            else if (p[0] === "camera" && p.length === 1) summary = val;
            else if (p[0] === "screen") screen = val;
            else if (p[1] === "crossings") crossings = val;
            else { (natives[p[2]] = natives[p[2]] || []).push(val); }
        });
    const objects = Object.values(natives).reduce((n, a) => n + a.length, 0);
    const pieces = Object.values(natives).reduce((n, a) => n + a.reduce((m, o) => m + pieceCount(o.loops), 0), 0);
    const out = argOf(args, "out", path.join(__dirname, "..", ".kobin-reports", "dense-screen.json"));
    writeFixture(out, {
        note: "RASTERISER-PLAN §9.3's dense screen: the camera and the document of one report, for measurement 4.",
        report: path.basename(file), objects, pieces, screen, summary,
        snapshot: { v, camera, natives, crossings },
    });
    console.log("  " + objects + " natives, " + pieces + " pieces, camera " + JSON.stringify(camera));
}

const [, , mode, file, ...rest] = process.argv;
if (!mode || !file) {
    console.log("usage: node tools/extract-fixture.js list|fz|f40|dense <report.json> [--out path]");
    process.exit(1);
}
if (!fs.existsSync(file)) { console.error("no such report: " + file); process.exit(1); }
if (mode === "list") modeList(file);
else if (mode === "fz") modeFz(file, rest);
else if (mode === "f40") modeF40(file, rest);
else if (mode === "dense") modeDense(file, rest);
else { console.error("unknown mode " + mode); process.exit(1); }
