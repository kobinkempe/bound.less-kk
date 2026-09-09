/**
 * PROBE, not a test (the suite does not run *.probe.js; see tools/harnesses/README.md):
 *
 *   node --max-old-space-size=6144 node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --testMatch "**\/memory.census.probe.js"
 *
 * Memory census (2026-09-08, ROADMAP "Memory"): what one piece, one object and one
 * renderer anchor cost on the heap, measured with a forced GC, and where the heap goes
 * at scale. Loads MEM_EXPORT (a kobin-1 JSON) when set, else draws MEM_N scribbles.
 * Held allocations are parked on KEEP and read back after the measurement: V8's
 * bytecode liveness lets a full GC collect a local whose last use is behind it.
 */
import fs from "fs";
import { mkEngine, useEngines, drawStroke, descend, eraseGesture } from "./__testkit__/harness";

jest.setTimeout(1800000);
useEngines();

const gc = (() => { try { require("v8").setFlagsFromString("--expose_gc"); return require("vm").runInNewContext("gc"); } catch (e) { return null; } })();
const heap = () => { if (gc) { gc(); gc(); gc(); } return process.memoryUsage().heapUsed; };
const MB = (b) => +(b / 1048576).toFixed(1);
const KEEP = { hold: null, n: 0 };
const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const scribble = (rnd, w, h) => {
    const n = 6 + Math.floor(rnd() * 11);
    let x = 40 + rnd() * (w - 80), y = 40 + rnd() * (h - 80);
    const pts = [[x, y]];
    for (let i = 1; i < n; i++) {
        x = Math.min(w - 20, Math.max(20, x + (rnd() - 0.5) * 120));
        y = Math.min(h - 20, Math.max(20, y + (rnd() - 0.5) * 120));
        pts.push([x, y]);
    }
    return { pts, w: 3 + rnd() * 15 };
};

function census(E) {
    let objs = 0, arcs = 0, lines = 0, loops = 0, pts = 0, chunkBoxes = 0, loopBytes = 0, tileLoopBytes = 0;
    let arcSample = null, lineSample = null;
    const srcs = new Set(); let srcTypes = {};
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) {
        objs++;
        if (o.pts) pts += o.pts.length;
        if (o.loops) for (const L of o.loops) { loops++; if (L.byteLength != null) loopBytes += L.byteLength; for (const p of L) { if (p.line) { lines++; lineSample = lineSample || p; } else { arcs++; arcSample = arcSample || p; } if (p.src != null) { const t = typeof p.src; srcTypes[t] = (srcTypes[t] || 0) + 1; if (t === "object") srcs.add(p.src); } } }
        if (o._sceneChunks) chunkBoxes += o._sceneChunks.length;
    }
    let anchors = 0, twoPaths = 0;
    const walk = (t) => { if (!t) return; if (t.vertices) { anchors += t.vertices.length; twoPaths++; } if (t.children) for (const c of t.children) walk(c); };
    for (const s of E.renderer._scenes.values()) walk(s.root);
    // Per scene: what the groups hold live, and what Two.js still parks in `subtractions`
    // (removed children kept until the next render of that group flushes them).
    const sceneDetail = [];
    for (const [key, s] of E.renderer._scenes) {
        let groups = 0, childPaths = 0, subs = 0, subAnchors = 0, rootSubs = 0;
        const walkSub = (t) => { if (!t) return; if (t.vertices) subAnchors += t.vertices.length; if (t.children) for (const c of t.children) walkSub(c); };
        for (const g of s.groups.values()) { groups++; const G = g.group; childPaths += G.children.length; subs += (G.subtractions || []).length; for (const x of (G.subtractions || [])) walkSub(x); }
        rootSubs = (s.root.subtractions || []).length; for (const x of (s.root.subtractions || [])) walkSub(x);
        sceneDetail.push({ key: String(key).slice(0, 16), groups, childPaths, subs, rootSubs, subAnchors });
    }
    const domPaths = typeof document !== "undefined" ? document.querySelectorAll("svg path").length : -1;
    let tiles = 0, tilePieces = 0;
    for (const t of E.store.cache.values()) { tiles++; for (const o of (t.objs || [])) { if (o.loops) for (const L of o.loops) { tilePieces += L.length; if (L.byteLength != null) tileLoopBytes += L.byteLength; } else if (o.polys) for (const P of o.polys) tilePieces += P.length; } }
    const undo = { objs: 0, pieces: 0 };
    const walkUndo = (x, d) => { if (!x || d > 5) return; if (Array.isArray(x)) { for (const y of x) walkUndo(y, d + 1); } else if (typeof x === "object") { if (x.loops && x.id != null) { undo.objs++; for (const L of x.loops) undo.pieces += L.length; } else for (const y of Object.values(x)) walkUndo(y, d + 1); } };
    for (const op of E.doc._undo) walkUndo(op, 0);
    const undoObjs = undo.objs, undoPieces = undo.pieces;
    return { objs, arcs, lines, pieces: arcs + lines, loops, loopBytes, tileLoopBytes, pts, chunkBoxes, srcTypes, distinctSrcObjects: srcs.size, scenes: E.renderer._scenes.size, groups: E.renderer._groups.size, twoPaths, anchors, sceneDetail, domPaths, tiles, tilePieces, undoOps: E.doc._undo.length, undoObjs, undoPieces, arcSample, lineSample };
}

const clonePiece = (p) => { const q = {}; for (const k of Object.keys(p)) { const v = p[k]; q[k] = Array.isArray(v) ? v.slice() : v; } return q; };
function unitCost(make, n = 100000) {
    KEEP.hold = null;
    const h0 = heap();
    const hold = new Array(n);
    for (let i = 0; i < n; i++) hold[i] = make(i);
    KEEP.hold = hold;
    const h1 = heap();
    KEEP.n = KEEP.hold.length;              // a use after the reading keeps it alive through it
    KEEP.hold = null; heap();
    return Math.round((h1 - h0) / n);
}

describe("memory census", () => {
    test("heap by structure", () => {
        const E = mkEngine(1504, 812);
        const out = { gc: !!gc, source: null, noRender: !!process.env.MEM_NORENDER };
        if (process.env.MEM_NORENDER) { E._render = () => {}; E.renderer.update = () => {}; E.renderer.render = () => {}; E.renderer.refreshSelection = () => {}; }
        const h0 = heap();
        const exportPath = process.env.MEM_EXPORT;
        const synthetic = !(exportPath && fs.existsSync(exportPath));
        if (!synthetic) {
            out.source = "export " + exportPath;
            let raw = JSON.parse(fs.readFileSync(exportPath, "utf8"));
            out.parsedJsonMB = MB(heap() - h0);
            const t = Date.now();
            E.loadDrawing(raw); raw = null;
            out.loadMs = Date.now() - t;
        } else {
            const N = +(process.env.MEM_N || 600);
            out.source = "synthetic N=" + N;
            const rnd = mulberry(1234);
            const t = Date.now();
            for (let i = 0; i < N; i++) { const s = scribble(rnd, 1504, 812); drawStroke(E, s.pts, s.w); }
            out.drawMs = Date.now() - t;
        }
        const hDoc = heap();
        out.afterLoadMB = MB(hDoc - h0);
        out.groupsBeforeRender = E.renderer._groups.size;
        const tR = Date.now();
        E._render();
        out.renderMs = Date.now() - tR;
        const h1 = heap();
        out.renderDeltaMB = MB(h1 - hDoc);
        const c1 = census(E);
        out.counts = { ...c1, arcSample: undefined, lineSample: undefined };
        out.pieceKeys = c1.arcSample ? Object.keys(c1.arcSample).map((k) => k + ":" + (Array.isArray(c1.arcSample[k]) ? "[" + c1.arcSample[k].length + "]" : typeof c1.arcSample[k])) : null;
        const Two = E.renderer.two.constructor;
        out.unit = {
            arcPiece: c1.arcSample ? unitCost(() => clonePiece(c1.arcSample)) : null,
            linePiece: c1.lineSample ? unitCost(() => clonePiece(c1.lineSample)) : null,
            point: unitCost((i) => [i * 0.5, i * 0.25]),
            anchor: unitCost((i) => new Two.Anchor(i, i, 1, 1, 2, 2, Two.Commands.curve)),
        };
        // Stored loops are Loops (geometry/loop.js): their bytes are counted, not estimated
        // from a piece object's cost, which is now what a transient view costs.
        const geometry = c1.loopBytes || c1.arcs * (out.unit.arcPiece || 0) + c1.lines * (out.unit.linePiece || 0);
        const renderer = c1.anchors * out.unit.anchor;
        out.estimate = {
            geometryMB: MB(geometry), loopBytesMB: MB(c1.loopBytes), tileLoopBytesMB: MB(c1.tileLoopBytes), rendererAnchorsMB: MB(renderer),
            docResidualMB: MB(hDoc - h0 - geometry), docResidualPerObjectBytes: Math.round((hDoc - h0 - geometry) / Math.max(1, c1.objs)),
            renderResidualMB: MB(h1 - hDoc - renderer), renderResidualPerGroupBytes: Math.round((h1 - hDoc - renderer) / Math.max(1, c1.groups)),
            piecesPerObject: +(c1.pieces / Math.max(1, c1.objs)).toFixed(1), anchorsPerGroup: +(c1.anchors / Math.max(1, c1.groups)).toFixed(1),
        };
        if (synthetic) {
            // Session residue: what a freshly drawn stroke leaves beyond its pieces and
            // anchors. Clear one suspect at a time and read the heap after each.
            const residue = {};
            const step = (name, fn) => { const a = heap(); try { fn(); } catch (e) { residue[name + "Err"] = String(e.message); } residue[name] = MB(a - heap()); };
            const jlen = (x) => { try { return JSON.stringify(x).length; } catch (e) { return -1; } };
            residue.sizes = { journalChars: jlen(E.journal), perfLogChars: jlen(E.perfLog), undoChars: jlen(E.doc._undo), instruments: { growth: jlen(E.growth), longFrames: jlen(E.longFrames), frameMeter: jlen(E.frameMeter), eventLatency: jlen(E.eventLatency) } };
            const anyObj = (() => { for (const k of E.doc.levels()) for (const o of E.doc.at(k)) return o; return null; })();
            residue.objectKeys = anyObj ? Object.keys(anyObj).map((k) => k + ":" + jlen(anyObj[k])) : null;
            const g0 = E.renderer._groups.values().next().value;
            residue.groupKeys = g0 ? Object.keys(g0).map((k) => k + ":" + (k === "group" ? "Two.Group" : jlen(g0[k]))) : null;
            step("journal", () => { E.journal.length = 0; });
            step("perfLog", () => { E.perfLog.length = 0; });
            step("undoRedo", () => { E.doc._undo.length = 0; E.doc._redo.length = 0; });
            step("objectCaches", () => { for (const k of E.doc.levels()) for (const o of E.doc.at(k)) for (const kk of Object.keys(o)) if (kk[0] === "_" && kk !== "_home") delete o[kk]; });
            step("instruments", () => { for (const k of ["growth", "longFrames", "frameMeter", "eventLatency"]) { const inst = E[k]; if (!inst) continue; for (const kk of Object.keys(inst)) if (Array.isArray(inst[kk])) inst[kk].length = 0; else if (inst[kk] instanceof Map) inst[kk].clear(); } });
            step("tileCache", () => { E.store.cache.clear(); });
            step("scenesDropped", () => { E.renderer._scenes.clear(); E.renderer._groups.clear(); E.renderer._order.length = 0; E.renderer.world.remove(E.renderer.world.children.slice()); E.renderer.two.update(); });
            residue.dom = { nodes: document.querySelectorAll("*").length, paths: document.querySelectorAll("svg path").length };
            let dChars = 0; for (const p of document.querySelectorAll("svg path")) dChars += (p.getAttribute("d") || "").length;
            residue.dom.dChars = dChars;
            out.sessionResidue = residue;
            // Marginal cost of the next 200 strokes, DOM included.
            {
                const rnd2 = mulberry(99);
                const a = heap(); const n0 = document.querySelectorAll("*").length;
                for (let i = 0; i < 200; i++) { const s = scribble(rnd2, 1504, 812); drawStroke(E, s.pts, s.w); }
                out.next200 = { deltaMB: MB(heap() - a), perStrokeKB: Math.round((heap() - a) / 200 / 1024), domNodesAdded: document.querySelectorAll("*").length - n0 };
            }
            E._render();
            descend(E, 1);
            E._render();
            const h2 = heap(); const c2 = census(E);
            out.afterCrossing = { deltaMB: MB(h2 - h1), scenes: c2.scenes, anchors: c2.anchors, tiles: c2.tiles, tilePieces: c2.tilePieces };
            const before = heap();
            eraseGesture(E, [[300, 400], [1200, 420]], 24); E.flushErases();
            const h3 = heap(); const c3 = census(E);
            out.afterErase = { deltaMB: MB(h3 - before), undoOps: c3.undoOps, undoObjs: c3.undoObjs, undoPieces: c3.undoPieces, objs: c3.objs, pieces: c3.pieces };
        }
        const h4a = heap();
        const tS = Date.now();
        let doc = E.serializeDrawing({});
        const h4b = heap();
        let s = JSON.stringify(doc);
        const h4c = heap();
        out.serialize = { copyMB: MB(h4b - h4a), stringMB: MB(h4c - h4b), chars: s.length, ms: Date.now() - tS };
        doc = null; s = null; heap();
        if (synthetic) {
            // Is the residue engine-owned? Destroy the engine and its host, then read the heap.
            const a = heap();
            const host = E.renderer.two.renderer.domElement && E.renderer.two.renderer.domElement.parentNode;
            const Two = E.renderer.two.constructor;
            E.destroy(); if (host && host.parentNode) host.parentNode.removeChild(host);
            let twoReach = 0; const walkTwo = (t, seen) => { if (!t || seen.has(t)) return; seen.add(t); if (t.vertices) twoReach += t.vertices.length; if (t.children) for (const c of t.children) walkTwo(c, seen); };
            const seen = new Set(); for (const inst of (Two.Instances || [])) walkTwo(inst.scene, seen);
            out.afterDestroy = { freedMB: MB(a - heap()), leftAboveBaselineMB: MB(heap() - h0), domNodes: document.querySelectorAll("*").length, twoInstances: (Two.Instances || []).length, anchorsReachableFromTwoInstances: twoReach };
            // Attribution: null the engine's fields one at a time (document, store, level map,
            // then the engine itself) and read what each release gives back. Destructive.
            const attr = {};
            const release = (label, o) => { for (const k of Object.keys(o)) { const b = heap(); o[k] = null; const d = b - heap(); if (d > 512 * 1024) attr[label + "." + k] = MB(d); } };
            release("doc", E.doc); release("store", E.store); release("lm", E.lm); release("renderer", E.renderer); release("E", E);
            attr.leftAboveBaselineMB = MB(heap() - h0);
            out.attribution = attr;
        }
        console.log("MEMORY CENSUS " + JSON.stringify(out, null, 1));
        expect(true).toBe(true);
    });
});
