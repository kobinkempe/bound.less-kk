/**
 * The saver's side of SYNC-PLAN, from the review: a gated start, the store fence (a refused
 * write keeps the work instead of losing it), a load or a clear minting a seq, the read-only
 * guards the engine does not have, and `idle` waiting for the whole write chain.
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useKobinEngine from "./useKobinEngine";
import * as db from "../storage/db";
import { _resetDbForTests, patchCanvasHeader } from "../storage/db";
import { loadCanvasStore, claimStore, writeCanvas2, readIndex, readTrash } from "../storage/localCanvases";
import { encodeRecords, encodeEntry } from "../engine/format2";

jest.setTimeout(30000);

let api = null;
const refusals = [];
function Harness({ gated = false }) {
    api = useKobinEngine({ canvasId: "c1", gated, onRefused: (k) => refusals.push(k) });
    return <div ref={api.hostRef} />;
}
async function mount(props = {}) {
    let view;
    act(() => { view = render(<Harness {...props} />); });
    for (let i = 0; i < 100 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return view;
}
const E = () => api.engineRef.current;
const strokes = () => api.stats().strokes;
function draw(x = 100) {
    act(() => {
        const e = E();
        e.pointerDown(x, 100);
        for (let i = 1; i <= 6; i++) e.pointerMove(x + i * 12, 100 + i * 7);
        e.pointerUp();
    });
}
beforeEach(() => {
    localStorage.clear();
    window.indexedDB = new IDBFactory();
    _resetDbForTests();
    refusals.length = 0;
});

test("gated: the engine starts read-only and the saver off, until the session opens them (review minor 6)", async () => {
    const view = await mount({ gated: true });
    expect(E().readOnly).toBe(true);
    draw();
    expect(strokes()).toBe(0);
    act(() => { api.setSaving(true); api.setReadOnly(false); });
    draw();
    await act(async () => { await api.flushSave(); });
    expect((await loadCanvasStore("c1")).header.strokes).toBe(1);
    act(() => view.unmount());
});

test("a write refused by the fence keeps the work as a new canvas (review majors 1, minor 4)", async () => {
    const view = await mount();
    act(() => { api.setWriter("tabA.1"); });
    draw();
    await act(async () => { await api.flushSave(); });
    const seq = (await loadCanvasStore("c1")).header.seq;
    await claimStore("c1", "tabB.1");
    draw(300);
    let ok;
    await act(async () => { ok = await api.flushSave(); });
    expect(ok).toBe(false);
    expect(refusals).toEqual(["fenced"]);
    expect((await loadCanvasStore("c1")).header.seq).toBe(seq);
    expect(api.hasUnsaved()).toBe(true);
    let kept;
    await act(async () => { kept = await api.keepUnsaved("A — unsaved edits"); });
    expect(kept.name).toBe("A — unsaved edits");
    expect(readIndex().map((e) => e.id)).toContain(kept.id);
    expect((await loadCanvasStore(kept.id)).header.strokes).toBe(2);
    act(() => view.unmount());
});

test("a write behind the store is refused as stale, not written over it (review major 2)", async () => {
    const view = await mount();
    draw();
    await act(async () => { await api.flushSave(); });
    const s = await loadCanvasStore("c1");
    await writeCanvas2("c1", { header: { ...s.header, seq: s.header.seq + 5 }, frameIds: s.header.frameIds, entries: [] });
    act(() => { E().panBy(20, 0); });
    draw(300);
    let ok;
    await act(async () => { ok = await api.flushSave(); });
    expect(ok).toBe(false);
    expect(refusals).toEqual(["stale"]);
    expect((await loadCanvasStore("c1")).header.seq).toBe(s.header.seq + 5);
    act(() => view.unmount());
});

test("a file load and a clear mint a seq, so the cloud sees a new history (review minor 7)", async () => {
    const view = await mount();
    draw();
    draw(250);
    await act(async () => { await api.flushSave(); });
    const s1 = await loadCanvasStore("c1");
    const other = E().serializeDrawing();
    other.natives = { 0: [other.natives["0"][0]] };
    await act(async () => { await api.loadDrawingFile({ text: async () => JSON.stringify(other) }); });
    const s2 = await loadCanvasStore("c1");
    expect(s2.header.seq).toBeGreaterThan(s1.header.seq);
    for (const fid of s2.header.frameIds) expect(s2.header.frameSeq[fid]).toBe(s2.header.seq);
    expect(s2.header.strokes).toBe(1);
    act(() => { api.clear(); });
    await act(async () => { await api.flushSave(); });
    const s3 = await loadCanvasStore("c1");
    expect(s3.header.seq).toBeGreaterThan(s2.header.seq);
    act(() => view.unmount());
});

test("read-only: a file load and a delete of the selection are refused (review nit)", async () => {
    const view = await mount();
    draw();
    act(() => { E().setTool("select"); E().select(136, 121); });
    expect(E().selection && E().selection.ids.length).toBe(1);
    act(() => { E().readOnly = true; });           // a selection still up when the pen goes
    act(() => { api.setReadOnly(true); });
    const other = E().serializeDrawing();
    other.natives = {};
    let threw = null;
    await act(async () => { try { await api.loadDrawingFile({ text: async () => JSON.stringify(other) }); } catch (err) { threw = err; } });
    expect(threw).toBeTruthy();
    act(() => { E().select(136, 121); api.deleteSelection(); });
    expect(strokes()).toBe(1);
    act(() => view.unmount());
});

test("idle waits for the whole write chain, not only the write in flight (review major 1)", async () => {
    const view = await mount();
    draw();
    act(() => { api.saveLocal(); });          // one write in flight
    draw(300);                                 // lands while it is saving: owed, on the debounce
    await act(async () => { await api.idle(); });
    expect((await loadCanvasStore("c1")).header.strokes).toBe(2);
    act(() => view.unmount());
});

const okStroke = (id) => ({ type: "stroke", origin: "native", id, pts: [[0, 0], [30, 20], [60, 10]], lwFrame: 2, color: "#000", opacity: 1 });
// A stroke whose geometry runs outside its frame: its replay throws, as a damaged log's would.
const badEntry = (seq) => { const e = encodeEntry({ k: "add", level: "0", index: 0, obj: okStroke(900 + seq) }); return { seq, t: seq, op: e.op, geo: new Float64Array(1), touches: ["0"] }; };
const HEADER = (seq) => ({ format: "boundless-drawing", version: 1, meta: { name: "A" }, camera: null, crossings: {}, name: "A", strokes: 1, levels: 1, seq });
async function seedBroken() {
    await writeCanvas2("c1", { header: HEADER(2), snapshots: { 0: { ...encodeRecords([okStroke(1)]), seq: 1 } }, frameIds: ["0"], entries: [badEntry(2)], full: true, resetLog: true });
}
async function mountSpying() {
    let view;
    act(() => { view = render(<Harness />); });
    const spy = jest.spyOn(E(), "_render");
    for (let i = 0; i < 100 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    return { view, spy };
}

test("a canvas whose log will not replay renders what did load (review minor 5)", async () => {
    await seedBroken();
    const { view, spy } = await mountSpying();
    expect(api.engineReady).toBe(true);
    expect(spy).toHaveBeenCalled();
    act(() => view.unmount());
});

test("its backup has landed before the first save can write over the store (review minor 6)", async () => {
    await seedBroken();
    // The copy held until the test lets it go: a slow backup on a big canvas.
    const real = db.copyCanvas2Chunked;
    let open;
    const gate = new Promise((r) => { open = r; });
    const spy = jest.spyOn(db, "copyCanvas2Chunked").mockImplementation(async (...a) => { await gate; return real(...a); });
    let view;
    act(() => { view = render(<Harness />); });
    for (let i = 0; i < 30 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    if (api.engineReady) { draw(); await act(async () => { await api.flushSave(); }); }   // the first save, during the copy
    open();
    for (let i = 0; i < 100 && !api.engineReady; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const kept = (await readTrash()).filter((t) => t.backupOf === "c1");
    expect(kept.length).toBe(1);
    expect((await loadCanvasStore(kept[0].id)).entries.map((e) => e.seq)).toEqual([2]);   // the unopenable log, not the save's
    spy.mockRestore();
    act(() => view.unmount());
});

test("a reload that will not replay still renders, and says it failed (review minor 5)", async () => {
    await writeCanvas2("c1", { header: HEADER(1), snapshots: { 0: { ...encodeRecords([okStroke(1)]), seq: 1 } }, frameIds: ["0"], entries: [], full: true, resetLog: true });
    const { view, spy } = await mountSpying();
    await writeCanvas2("c1", { header: HEADER(2), frameIds: ["0"], entries: [badEntry(2)] });
    spy.mockClear();
    let failed = false;
    await act(async () => { try { await api.reloadFromStore({ keepCamera: true }); } catch (err) { failed = true; } });
    expect(failed).toBe(true);
    expect(spy).toHaveBeenCalled();
    act(() => view.unmount());
});

test("a header-only follow takes the scene names too (review minor 9)", async () => {
    const view = await mount();
    for (let i = 0; i < 4; i++) draw(100 + i * 60);
    await act(async () => { await api.flushSave(); });
    const scenes = E().refreshScenes();
    expect(scenes.length).toBeGreaterThan(0);
    const id = scenes[0].id;
    const h0 = (await loadCanvasStore("c1")).header;
    await patchCanvasHeader("c1", (h) => ({ ...h, meta: { ...h.meta, scenes: (h0.meta.scenes || scenes).map((x) => (x.id === id ? { ...x, name: "Harbour", pinned: true } : x)) } }));
    await act(async () => { await api.refreshMetaFromStore(); });
    expect(E().docMeta.scenes.find((x) => x.id === id).name).toBe("Harbour");
    expect(E().serializeDrawing().meta.scenes.find((x) => x.id === id).name).toBe("Harbour");
    act(() => view.unmount());
});
