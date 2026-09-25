/**
 * scenes.echo.probe.js — duplicate scenes on the Magnum Opus (Kobin 2026-09-23: "why are there two
 * scenes for Saturn?"): every pair of scenes whose frames show the same subject within a small zoom
 * (each frame's centre inside the other, sizes within 4×), with what made two. His saved index
 * (restored through the client) and a fresh build. Writes the tables to $ECHO_OUT (default stdout).
 *   CI=true NODE_OPTIONS=--max-old-space-size=10240 npx react-scripts test --watchAll=false --testMatch "**\/scenes.echo.probe.js"
 */
import KobinEngine from "./KobinEngine";
import { ZOOM_SPREAD } from "./sceneIndex";

const fs = require("fs");
const FILE = process.env.ECHO_FILE || "C:/Users/Surface/Documents/Claude projects/Magnum Opus.boundless.json";
jest.setTimeout(30 * 60 * 1000);
const lines = [];
const out = (s) => lines.push(s);
const SPREAD = Math.log2(ZOOM_SPREAD);

function load(fresh) {
    const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (fresh) { delete doc.meta.sceneIndex; delete doc.meta.scenes; }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, { width: 1504, height: 868, raster: false });
    E.loadDrawing(doc);
    E._sceneClient.useWorker = false;
    const t0 = Date.now();
    E.refreshScenes();
    return { E, ms: Date.now() - t0 };
}

/** Per scene: its frame, ink box, valid-ink box, widths, whether the frame is 24 widths of its thickest (the old MIN_FRAME floor). */
function describe(ix, S) {
    const bb = [Infinity, Infinity, -Infinity, -Infinity], vb = [Infinity, Infinity, -Infinity, -Infinity];
    let Tmax = 0, stray = 0, chunks = 0, thick = null;
    const several = S.members.size > 1;
    for (const m of S.members) {
        const mT = ix.XD[m.slot * 8 + 7], L = ix._locOf(m);   // XT; the filed boxes
        if (mT > Tmax) { Tmax = mT; thick = m; }
        for (let k = 0; k < m.fn; k++) {
            const o = 4 * k;
            chunks++;
            bb[0] = Math.min(bb[0], L[o]); bb[1] = Math.min(bb[1], L[o + 1]); bb[2] = Math.max(bb[2], L[o + 2]); bb[3] = Math.max(bb[3], L[o + 3]);
            if (several && m.fn >= 3 && !ix._valid(S, m, k)) { stray++; continue; }
            vb[0] = Math.min(vb[0], L[o]); vb[1] = Math.min(vb[1], L[o + 1]); vb[2] = Math.max(vb[2], L[o + 2]); vb[3] = Math.max(vb[3], L[o + 3]);
        }
    }
    const f = S.frame, min = (60 / 2250) * Tmax;
    const vw = vb[2] - vb[0], vh = vb[3] - vb[1];
    return { f, Tmax, min, floor: f && (Math.abs(f.w - min) < 1e-9 * min || Math.abs(f.h - min) < 1e-9 * min), bbW: bb[2] - bb[0], bbH: bb[3] - bb[1], vW: vw, vH: vh, stray, chunks, thickN: thick ? thick.fn : 0, thickW: thick ? ix.XD[thick.slot * 8 + 2] : 0 };
}

function pairs(E, tag) {
    const ix = E._sceneClient.core;
    const recs = new Map(E.docMeta.scenes.map((r) => [r.id, r]));
    const list = [...ix.scenes].filter((S) => S.frame);
    const D = new Map(list.map((S) => [S, describe(ix, S)]));
    const zoom = (S) => { const r = recs.get(S.idn.id); return r ? E.sceneZoom(r) : NaN; };
    out(`\n## ${tag}: ${list.length} scenes (${E.docMeta.scenes.length} rows)`);
    out("id | name | anchor depth | members | L range | frame w×h (anchor units) | valid ink / all ink | MIN floor | zoom");
    for (const S of list.sort((a, b) => a.idn.seq - b.idn.seq)) {
        const d = D.get(S);
        out(`${S.idn.id} | ${S.idn.name} | ${ix._depth(S.anchor)} | ${S.members.size} | ${S.Lmin.toFixed(1)}..${S.Lmax.toFixed(1)} | ${d.f.w.toPrecision(4)}×${d.f.h.toPrecision(4)} | ${d.vW.toPrecision(3)}×${d.vH.toPrecision(3)} / ${d.bbW.toPrecision(3)}×${d.bbH.toPrecision(3)} (${d.stray}/${d.chunks} stray) | ${d.floor ? "FLOOR" : ""} | ${zoom(S).toPrecision(2)}`);
    }
    const found = [];
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const A = list[i], B = list[j];
            const M = ix.frames.map(B.anchor, A.anchor);
            if (!M) continue;
            const a = A.frame, b0 = B.frame;
            const b = { x: b0.x * M.s + M.ox, y: b0.y * M.s + M.oy, w: b0.w * M.s, h: b0.h * M.s };
            const inside = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
            const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
            const ratio = Math.max(a.w, a.h) / Math.max(b.w, b.h);
            if (!(inside(ca, b) && inside(cb, a))) continue;
            if (ratio > 8 || ratio < 1 / 8) continue;
            found.push({ A, B, ratio });
        }
    }
    out(`\n### ${tag}: ${found.length} echo pairs (each centre inside the other, sizes within 4×)`);
    for (const { A, B, ratio } of found) {
        const [loose, tight] = ratio >= 1 ? [A, B] : [B, A];
        const r = Math.max(ratio, 1 / ratio);
        const chain = (S) => { const c = []; for (let q = S; q; q = q.parent) c.push(q); return c; };
        const ct = chain(tight), cl = chain(loose);
        const lca = ct.find((q) => cl.includes(q));
        const rel = tight.parent === loose ? "child of the looser" : loose.parent === tight ? "parent of the looser"
            : lca ? `tree: tighter ${ct.indexOf(lca)} up, looser ${cl.indexOf(lca)} up to ${lca.idn.id}` : "different roots";
        // the looser's ink outside the tighter's frame: which members
        const Mt = ix.frames.map(tight.anchor, loose.anchor), tf = tight.frame;
        const tr = { x: tf.x * Mt.s + Mt.ox - loose.ox, y: tf.y * Mt.s + Mt.oy - loose.oy, w: tf.w * Mt.s, h: tf.h * Mt.s };
        let outM = 0, outBig = 0, outMax = 0;
        for (const m of loose.members) {
            let o = false;
            const L = ix._locOf(m);
            for (let k = 0; k < m.fn; k++) { const q = 4 * k; if (L[q] < tr.x || L[q + 2] > tr.x + tr.w || L[q + 1] < tr.y || L[q + 3] > tr.y + tr.h) { o = true; break; } }
            if (o) { outM++; if (m.fn < 3) outBig++; outMax = Math.max(outMax, m.fn); }
        }
        const ex = `looser's members reaching outside the tighter's frame: ${outM} (${outBig} with < 3 chunks, the stray rule's floor; longest ${outMax} chunks)`;
        const dl = D.get(loose);
        const why = [];
        if (Math.max(tight.Lmax, loose.Lmax) - Math.min(tight.Lmin, loose.Lmin) > SPREAD + 1e-9) why.push(`widths ${Math.min(tight.Lmin, loose.Lmin).toFixed(1)}..${Math.max(tight.Lmax, loose.Lmax).toFixed(1)} span more than 16× (the tighter ${tight.Lmin.toFixed(1)}..${tight.Lmax.toFixed(1)}, the looser ${loose.Lmin.toFixed(1)}..${loose.Lmax.toFixed(1)})`);
        else why.push("widths fit one scene: two by history (never re-clustered)");
        if (dl.floor) why.push(`the looser's frame is the MIN_FRAME floor (24 widths of its thickest, a ${dl.thickN}-chunk item)`);
        if (dl.stray) why.push(`the looser has ${dl.stray} stray chunks (framed without them)`);
        if (dl.vW < dl.bbW * 0.99 || dl.vH < dl.bbH * 0.99) why.push("stray runs cut the looser's frame");
        out(`- ${loose.idn.id} (${loose.members.size}) ⟷ ${tight.idn.id} (${tight.members.size}): ${r.toFixed(2)}×; ${rel}; ${why.join("; ")}; ${ex}${loose.idn.named || tight.idn.named ? "; NAMED" : ""}`);
    }
    return found;
}

/** The panel's rows (echo pairs folded): how many, and any two still echoing (centres inside each other within 8×). */
function rowPairs(E, tag) {
    const ix = E._sceneClient.core;
    const rows = E.docMeta.scenes.filter((r) => !r.kind);
    out(`
### ${tag}: the panel lists ${rows.length} scene rows (${E.docMeta.scenes.length} rows with parts and regions) for ${ix.scenes.size} scenes`);
    for (const R of ix.rows.filter((q) => q.members.length > 1)) out(`- row ${R.S.idn.id} "${R.S.idn.name}" = ${R.members.map((m) => m.idn.id + (m === R.shown ? "*" : "")).join(" + ")} (* the frame shown)`);
    const inside = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
    let n = 0;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const A = rows[i], B = rows[j], M = ix.frames.map(B.level, A.level);
        if (!M) continue;
        const a = A.rect, b = { x: B.rect.x * M.s + M.ox, y: B.rect.y * M.s + M.oy, w: B.rect.w * M.s, h: B.rect.h * M.s };
        const ratio = Math.max(a.w, a.h) / Math.max(b.w, b.h);
        if (!inside([a.x + a.w / 2, a.y + a.h / 2], b) || !inside([b.x + b.w / 2, b.y + b.h / 2], a) || ratio > 8 || ratio < 1 / 8) continue;
        n++;
        out(`- still echoing: ${A.id} "${A.name}" ⟷ ${B.id} "${B.name}" ${Math.max(ratio, 1 / ratio).toFixed(2)}×`);
    }
    out(`rows still echoing within 8×: ${n}`);
    out("row frames: " + rows.map((r) => `${r.id} ${r.rect.w.toPrecision(4)}x${r.rect.h.toPrecision(4)}@${ix._depth(r.level)} p${E.docMeta.scenes.filter((q) => q.kind === "part" && q.parent === r.id).length}`).join("; "));
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) ix._echoes();
    out(`the rows pass: ${((Date.now() - t0) / 20).toFixed(2)} ms`);
    out("parts per scene: " + [...ix.scenes].filter((S) => S.parts && S.parts.length).map((S) => `${S.idn.id} ${S.parts.length} (row ${ix.rowOf.get(S).S.idn.id}${ix.rowOf.get(S).shown === S ? ", shown" : ""})`).join("; "));
}

test("echo pairs on the Magnum Opus", () => {
    const his = load(false);
    out(`his index restored in ${his.ms} ms`);
    pairs(his.E, "his saved index");
    rowPairs(his.E, "his saved index");
    his.E.destroy();
    const fresh = load(true);
    out(`fresh build in ${fresh.ms} ms`);
    pairs(fresh.E, "a fresh build");
    rowPairs(fresh.E, "a fresh build");
    fresh.E.destroy();
    if (process.env.ECHO_OUT) fs.writeFileSync(process.env.ECHO_OUT, lines.join("\n")); else console.log(lines.join("\n"));   // eslint-disable-line no-console
});
