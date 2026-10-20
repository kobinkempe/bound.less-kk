/**
 * review1006.perf.gcgap.probe.js — between a drop's frame GC (which forgets the view's empty picture-source frames,
 * F139's mechanism) and the next render (which mints them again), what does a camera step that does not cross do to the
 * Stage's table? A probe, not a suite (R3's whole drawing, the report's camera and selection).
 *   CI=true NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts test --watchAll=false --testMatch "**\/review1006.perf.gcgap.probe.js"
 */
import path from "path";
import KobinEngine from "./KobinEngine";
import { readReportFile, drawingPartsOf, REPORT_DIR } from "./__testkit__/reportReplay";
import { loadReport } from "./report";
import { resetRasterWorkerClient, setRasterWorkerCount, setRasterTransport } from "./raster/rasterWorkerClient";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
jest.setTimeout(30 * 60 * 1000);

function mk(w, h) {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new KobinEngine(host, { width: w, height: h, raster: true });
}

const state = (E, tag) => {
    const st = E.stage, items = st.items();
    const grouped = items.filter((it) => it.grp != null).length;
    const ids = new Set(items.map((it) => it.id));
    const m = E.store._rerouteGroups(String(E.cam.frame));
    const dirtN = st._dirtLog.length, lastDirt = dirtN ? st._dirtLog[dirtN - 1].G : null;
    log(`${tag}: G ${st.generation}; items ${items.length} (${grouped} from reroute groups, ${ids.size} natives); lattice ${E.lm.frames.size}; ` +
        `reroute: groups ${m ? m.groups.size : 0}, missing sources ${m ? m.miss.size : 0}; dirt log ${dirtN} (last G ${lastDirt}); GC forgot ${E._gcStats.forgotten}`);
    return { items: items.length, grouped, ids };
};

test("R3: a camera step after the drop's GC, then the next render", async () => {
    resetRasterWorkerClient(); setRasterWorkerCount(4);
    setRasterTransport(() => new Promise(() => {}));
    const f = path.join(REPORT_DIR, "report-2026-10-07T03-19-33-862Z.json");
    const rep = readReportFile(f);
    const E = mk(1806, 1070);
    loadReport(E, rep, { drawing: drawingPartsOf(f) });
    E.setTool("select");
    E._render();
    E.sweepFrames();
    E._setSelection(rep.moves.selection.ids, rep.moves.selection.frames, true);
    E._render();
    const s0 = state(E, "selected, rendered");
    // a drag and its drop
    const sx = E.width / 2, sy = E.height / 2;
    E._dragSel = { start: [sx, sy], moved: false };
    E._beginHold();
    for (let k = 1; k <= 10; k++) E._dragSelection(sx + 6 * k, sy + 4 * k);
    E._pointerUp();
    const s1 = state(E, "after the drop (its render, then GC)");
    // a pan that does not cross: the table's step alone
    E.panBy(3, 0);
    const s2 = state(E, "after a 3 px pan (no crossing)");
    const lost = [...s1.ids].filter((id) => !s2.ids.has(id));
    log(`natives in the table after the drop but not after the pan: ${lost.length} ${JSON.stringify(lost.slice(0, 20))}`);
    // the natives the pan added: are they displaced natives drawn at their stored (unmoved) place?
    const gained = [...s2.ids].filter((id) => !s1.ids.has(id));
    const mNow = E.store._rerouteGroups(String(E.cam.frame));
    const vw = E.cam.frameWindow(0);
    let displaced = 0, missing = 0, zeroOff = 0, onScreen = 0, withTable = 0;
    const eg = [];
    for (const id of gained) {
        const rec = E.doc.getById(id);
        if (mNow.moved.has(id)) displaced++;
        if (mNow.miss.has(id)) missing++;
        if (rec && E.doc.tableOf(rec.obj, rec.level)) withTable++;
        for (const it of E.stage.itemsOf(id)) {
            if (!it.off[0] && !it.off[1]) zeroOff++;
            const b = it.box;
            if (b.right >= vw.left && b.left <= vw.right && b.bottom >= vw.top && b.top <= vw.bottom) onScreen++;
            if (eg.length < 5) eg.push({ id, key: it.key, grp: it.grp, off: it.off, home: rec && rec.level, box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] });
        }
    }
    log(`natives the pan added: ${gained.length}; displaced (reroute 'moved') ${displaced}, source missing ${missing}, with a picture table ${withTable}; their items with zero offset ${zeroOff}, on screen ${onScreen}; e.g. ${JSON.stringify(eg)}`);
    log(`view window ${JSON.stringify([Math.round(vw.left), Math.round(vw.top), Math.round(vw.right), Math.round(vw.bottom)])}; tracked plate cells ${E.stage._cells.size}`);
    E.panBy(-3, 0);
    state(E, "after panning back");
    E._render();
    const s3 = state(E, "after the next render (re-mint)");
    const back = lost.filter((id) => s3.ids.has(id));
    log(`of those, back after the render: ${back.length}`);
    E.destroy();
    setRasterTransport(null); setRasterWorkerCount(null);
    expect(s0.items).toBeGreaterThan(0);
});
