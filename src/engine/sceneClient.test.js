/**
 * The scene index through a real engine (SCENES-PLAN §7.4, §7.6): events to items, the saved
 * state in the file, a load that computes nothing, the migration of an old file, the worker path.
 */
import { useEngines, mkEngine, drawStroke, erase, drag, pan, families, descend, camShot, camRestore } from "./__testkit__/harness";
import KobinEngine from "./KobinEngine";
import { SceneIndex } from "./sceneIndex";
import { sceneGeom } from "./sceneClient";
import { setSceneTransport } from "./sceneWorkerClient";
import { OpLog } from "./oplog";

useEngines();
afterEach(() => jest.restoreAllMocks());   // a failed test's spy never leaks into the next
const BLUE = "#1133cc";
const scenes = (E) => E.refreshScenes();
function reload(E, mutate) {
    const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
    if (mutate) mutate(doc);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const F = new KobinEngine(host, { width: E.width, height: E.height });
    F.loadDrawing(doc);
    return F;
}
// Two compositions far apart at the top level.
const two = (E) => {
    drawStroke(E, [[200, 240], [420, 240]], 20, BLUE);
    drawStroke(E, [[200, 300], [420, 300]], 20, BLUE);
    pan(E, -400000, 0);
    drawStroke(E, [[200, 240], [420, 240]], 20, BLUE);
    pan(E, 400000, 0);
};

describe("the engine's scene list", () => {
    test("two compositions far apart are two scenes; each row carries a frame to jump to", () => {
        const E = mkEngine();
        two(E);
        const list = scenes(E);
        expect(list.length).toBe(2);
        for (const s of list) { expect(s.rect.w).toBeGreaterThan(0); expect(E.lm.frameFor(s.level)).toBeTruthy(); }
        const s0 = list.find((s) => s.count === 2);
        expect(E.jumpTo(s0.level, s0.rect)).toBe(true);
    });
    test("a stroke severed by an erase is still one scene (its pieces keep the scene)", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 300], [600, 300]], 40, BLUE);
        const before = scenes(E);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(families(E)).toBe(2);
        const after = scenes(E);
        expect(after.length).toBe(1);
        expect(after[0].id).toBe(before[0].id);
    });
    test("dragging a whole drawing moves its scene: same id and hash, the frame follows", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 30, BLUE);
        const [a] = scenes(E);
        drag(E, [400, 300], [460, 340]);
        const [b] = scenes(E);
        expect(b.id).toBe(a.id);
        expect(b.hash).toBe(a.hash);
        expect(b.rect.x - a.rect.x).toBeCloseTo(60 / E.cam.inScale, 6);
    });
    test("undo takes a scene away and redo brings it back with its id and name", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 30, BLUE);
        const [a] = scenes(E);
        expect(E.renameScene(a.id, "Hill")).toBe(true);
        scenes(E);
        E.undo();
        expect(scenes(E).length).toBe(0);
        E.redo();
        const [b] = scenes(E);
        expect(b.id).toBe(a.id);
        expect(b.name).toBe("Hill");
    });
});

describe("saved in the file", () => {
    test("a save carries the index; a load files the saved members straight in (no insert) and shows the same list", () => {
        const E = mkEngine();
        two(E);
        const list = scenes(E);
        E.renameScene(list[0].id, "Left");
        scenes(E);
        const F = reload(E);
        expect(F.docMeta.scenes.map((s) => s.id).sort()).toEqual(E.docMeta.scenes.map((s) => s.id).sort());   // at once, from the file
        const spy = jest.spyOn(SceneIndex.prototype, "_insert");
        const back = scenes(F);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        expect(back.map((s) => [s.id, s.name, s.count]).sort()).toEqual(E.docMeta.scenes.map((s) => [s.id, s.name, s.count]).sort());
        F.destroy();
    });
    test("an object drawn and not yet indexed when saving is listed dirty, and the load inserts it", () => {
        const E = mkEngine();
        two(E);
        scenes(E);
        drawStroke(E, [[200, 360], [420, 360]], 20, BLUE);   // no flush before the save
        const doc = E.serializeDrawing({ name: "t" });
        expect(doc.meta.sceneIndex.dirty.length).toBeGreaterThan(0);
        const F = reload(E);
        const back = scenes(F);
        expect(back.length).toBe(2);
        expect(back.reduce((a, s) => a + s.count, 0)).toBe(4);
        F.destroy();
    });
    test("a rename made after a load, before the index is restored, is kept", () => {
        const E = mkEngine();
        two(E);
        const [s0] = scenes(E);
        const F = reload(E);
        expect(F.renameScene(s0.id, "Harbour")).toBe(true);   // the stored list, the restore not yet sent
        const back = scenes(F);
        expect(back.find((s) => s.id === s0.id).name).toBe("Harbour");
        F.destroy();
    });
    test("an old file (a v2 scene list, no index) is indexed once and keeps its ids and names", () => {
        const E = mkEngine();
        two(E);
        const list = scenes(E);
        const F = reload(E, (doc) => {
            delete doc.meta.sceneIndex;
            doc.meta.scenes = list.map((s, i) => ({ ...s, id: "s" + (40 + i), name: "Old " + i, pinned: i === 0, auto: i !== 0 }));
            doc.meta.sceneSeq = 50;
        });
        const back = scenes(F);
        expect(back.map((s) => s.id).sort()).toEqual(["s40", "s41"]);
        expect(back.find((s) => s.id === "s40").name).toBe("Old 0");
        expect(back.find((s) => s.id === "s40").pinned).toBe(true);
        const G = reload(F);   // now it has an index
        expect(G.serializeDrawing().meta.sceneIndex.v).toBe(3);
        F.destroy(); G.destroy();
    });
});

describe("the worker path", () => {
    afterEach(() => setSceneTransport(null));
    test("batches go out one at a time and the list lands asynchronously", async () => {
        const posted = [];
        setSceneTransport(() => {
            const ix = new SceneIndex();
            return { post: (batch) => { posted.push(batch); return new Promise((r) => setTimeout(() => r(ix.apply(batch)), 5)); }, terminate() {} };
        });
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 30, BLUE);
        E.refreshScenes();
        await new Promise((r) => setTimeout(r, 120));
        expect(posted.length).toBeGreaterThanOrEqual(1);
        expect(E.docMeta.scenes.length).toBe(1);
        expect(E.sceneReport().mode).toBe("worker");
    });
});

describe("erase footprints (SCENES-PLAN §6 row 14b)", () => {
    const fine = (E) => {
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[380, 300], [420, 300]], 8);
        camRestore(E, home);
    };
    test("a fine eraser two levels down on a coarse stroke makes a child scene framed on the carving", () => {
        const E = mkEngine();
        fine(E);
        const list = scenes(E);
        expect(list.length).toBe(2);
        const [top, kid] = list;
        expect(kid.parent).toBe(top.id);
        const M = E.lm.frameFactor(kid.level, top.level);
        expect(kid.rect.w * M).toBeLessThan(top.rect.w / 1000);   // framed on the carving, not the stroke
    });
    test("an eraser about the ink's own width just edits its scene; a coarser one is removal", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 40, BLUE);
        erase(E, [[400, 220], [400, 380]], 26);
        expect(scenes(E).length).toBe(1);
        const F = mkEngine();
        drawStroke(F, [[100, 300], [700, 300]], 10, BLUE);
        erase(F, [[400, 220], [400, 380]], 60);
        expect(scenes(F).length).toBe(1);
        expect(F._sceneClient.foot.size).toBe(0);
    });
    test("undo takes the carving's scene away; redo brings it back with its id", () => {
        const E = mkEngine();
        fine(E);
        const kid = scenes(E)[1];
        E.undo();
        expect(scenes(E).length).toBe(1);
        E.redo(); E.flushErases();
        const back = scenes(E);
        expect(back.length).toBe(2);
        expect(back[1].id).toBe(kid.id);
    });
    test("the carving's scene survives a save and load", () => {
        const E = mkEngine();
        fine(E);
        const list = scenes(E);
        const F = reload(E);
        const back = scenes(F);
        expect(back.map((s) => [s.id, s.parent || null]).sort()).toEqual(list.map((s) => [s.id, s.parent || null]).sort());
        F.destroy();
    });
    test("a carving follows its host re-homed to another frame of its depth (review minor 11)", () => {
        const E = mkEngine();
        fine(E);
        const [top, kid] = scenes(E);
        const n = E.lm.neighbour("0", 1, 0);
        for (const o of [...E.doc.list("0")]) E.doc.rehomeById(o.id, n.id);   // the whole drawing one cell over
        const back = scenes(E);
        expect(back.map((s) => s.id).sort()).toEqual([top.id, kid.id].sort());
        expect(back.find((s) => s.id === kid.id).parent).toBe(top.id);
    });
    test("an undone carving rides the save, and a redo after a reload (the op log replayed) brings its scene back", () => {
        const E = mkEngine();
        const log = new OpLog(E);
        fine(E);
        const kid = scenes(E)[1];
        E.undo();
        expect(scenes(E).length).toBe(1);
        const entries = log.drain().entries;
        const saved = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "t" })));
        expect(saved.meta.sceneIndex.erase.length).toBeGreaterThan(0);
        expect(saved.meta.sceneIndex.erase.every((e) => e.off)).toBe(true);
        const F = mkEngine();
        F.loadDrawing({ ...saved, natives: {} });          // the store's snapshot from before the drawing, then its log
        new OpLog(F).replay(entries, {});
        expect(scenes(F).length).toBe(1);
        F.redo(); F.flushErases();
        const back = scenes(F);
        expect(back.length).toBe(2);
        expect(back.find((s) => s.parent)).toMatchObject({ id: kid.id });
    });
    test("a fresh action after an undo drops the undone carving; more than the cap drops the oldest", () => {
        const E = mkEngine();
        fine(E);
        scenes(E);
        E.undo();
        drawStroke(E, [[100, 500], [200, 500]], 10, BLUE);   // the redo branch dies
        scenes(E);
        expect(E._sceneClient.foot.size).toBe(0);
        expect(E.serializeDrawing({ name: "t" }).meta.sceneIndex.erase).toEqual([]);
        const G = mkEngine();
        G._sceneClient.footMax = 1;
        fine(G);
        const first = scenes(G).find((s) => s.parent);
        const home = camShot(G);
        descend(G, 2, 200, 300);
        erase(G, [[180, 300], [220, 300]], 8);
        camRestore(G, home);
        const list = scenes(G);
        expect(G._sceneClient.foot.size).toBe(1);
        expect(list.filter((s) => s.parent).length).toBe(1);
        expect(list.find((s) => s.id === first.id)).toBeFalsy();   // the older carving's scene went with it
    });
});

describe("ceded patches (review 2026-09-22)", () => {
    test("a drawing whose ink is all ceded patches (its remnant removed) still has a scene; the remnant back, one scene again", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        erase(E, [[380, 300], [420, 300]], 8);
        camRestore(E, home);
        const all = () => E.doc.levels().flatMap((L) => E.doc.list(L).map((o) => o));
        const patches = all().filter((o) => o.attachRect != null && !o.erase);
        expect(patches.length).toBeGreaterThan(0);
        const top = scenes(E).filter((s) => !s.parent && !s.kind);
        expect(top.length).toBe(1);
        const rem = all().filter((o) => o.attachRect == null && !o.erase && E.doc.editKey(o) === E.doc.editKey(patches[0]));
        expect(rem.length).toBeGreaterThan(0);
        for (const o of rem) E.doc.removeById(o.id);
        const left = scenes(E).filter((s) => !s.kind);
        expect(left.length).toBeGreaterThan(0);          // the patches' ink is listed
        for (const o of rem) E.doc.insertAt(o, "0");
        const back = scenes(E).filter((s) => !s.parent && !s.kind);
        expect(back.length).toBe(1);                     // the patches are storage again, in the remnant's scene
    });
});

describe("the client's compact records (2026-09-23: no chunks kept on the main thread)", () => {
    const posted = (fn) => {
        const out = [], orig = SceneIndex.prototype.apply;
        const spy = jest.spyOn(SceneIndex.prototype, "apply").mockImplementation(function (b) { out.push(b); return orig.call(this, b); });
        try { fn(); } finally { spy.mockRestore(); }
        return out.flatMap((b) => b.items || []);
    };
    test("a geometry change (the bake of a raw stroke) re-sends the object's chunks; the index holds the new ones", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[100, 300], [700, 300]], 10, BLUE, { raw: true });   // an open centreline, not yet baked
        scenes(E);
        const core = E._sceneClient.core, x = core.items.get(o.id);
        expect(x.loops).toBe(null);
        const recs = posted(() => { E.flushBakes(); scenes(E); });
        const r = recs.find((q) => q.id === o.id);
        expect(r && r.raw).toBeTruthy();                                      // sent again, with its chunks
        const g = sceneGeom(E.doc.getById(o.id).obj);
        expect(Array.from(core._rawOf(x))).toEqual(Array.from(g.raw));
        expect(x.loops).toEqual([0]);                                         // the baked outline
        expect(E._sceneClient.sent.get(o.id)).toEqual(expect.any(Number));   // a record slot, not an object
        expect(E.doc.getById(o.id).obj._sc).toBeUndefined();                  // nothing kept on the object
    });
    test("a move sends the new table only, no chunks", () => {
        const E = mkEngine();
        const o = drawStroke(E, [[300, 300], [500, 300]], 30, BLUE);
        scenes(E);
        const recs = posted(() => { drag(E, [400, 300], [460, 340]); scenes(E); });
        const r = recs.find((q) => q.id === o.id);
        expect(r).toBeTruthy();
        expect(r.raw).toBeUndefined();
        expect(r.t).toBeTruthy();
    });
});

describe("closed outlines through the client (review follow-up)", () => {
    test("a stroke's record carries its outline's loop, and the stray run across the loop's start is one run", () => {
        const E = mkEngine();
        drawStroke(E, [[3000, 300], [3030, 300]], 1, BLUE);
        drawStroke(E, [[3000, 340], [3030, 340]], 1, BLUE);
        // drawn from its free end: the outline's loop starts there, so its lonely far end is the
        // first chunk and the last (one each side of the start)
        const line = drawStroke(E, [[1500, 320], [3000, 320]], 1, BLUE);
        const posted = [];
        const orig = SceneIndex.prototype.apply;
        const spy = jest.spyOn(SceneIndex.prototype, "apply").mockImplementation(function (batch) { posted.push(batch); return orig.call(this, batch); });
        try { scenes(E); } finally { spy.mockRestore(); }
        const rec = posted.flatMap((b) => b.items || []).find((r) => r.id === line.id);
        expect(rec.loops).toEqual([0]);
        // marks within reach of the far end only: the far end is stray, so they do not join through it
        drawStroke(E, [[800, 300], [830, 300]], 1, BLUE);
        drawStroke(E, [[800, 340], [830, 340]], 1, BLUE);
        const list = scenes(E).filter((s) => !s.kind);
        expect(list.length).toBe(2);
        const x = E._sceneClient.core.items.get(line.id);
        expect(Array.from(E._sceneClient.core._validOf(x))).toEqual([0, 1, 1, 1, 0]);
    });
});

describe("echo rows through the client (Kobin 2026-09-23: two scenes for Saturn)", () => {
    test("a fat-stroke body and its fine rings around it are one row, framed on the rings", () => {
        const E = mkEngine();
        drawStroke(E, [[80, 300], [720, 300]], 64, BLUE);           // the body: two fat strokes, framed ~845 wide
        drawStroke(E, [[80, 330], [720, 330]], 64, BLUE);
        drawStroke(E, [[100, 315], [700, 315]], 2, BLUE);           // the rings, 32× thinner: a child scene
        drawStroke(E, [[400, 15], [400, 615]], 2, BLUE);
        drawStroke(E, [[100, 15], [700, 615]], 2, BLUE);
        const list = scenes(E).filter((s) => !s.kind);
        expect(E._sceneClient.core.scenes.size).toBe(2);
        expect(list.length).toBe(1);
        expect(list[0].count).toBe(5);
        const core = E._sceneClient.core, rings = core.items.get(E.doc.list("0").find((o) => o.lwFrame === 2 || o.w === 2).id).scene;
        expect(list[0].rect).toEqual(rings.frame);                     // the tighter: the rings' frame
        expect(E.renameScene(list[0].id, "Saturn")).toBe(true);         // the row's id is the body's
        const [named] = scenes(E).filter((s) => !s.kind);
        expect(named.name).toBe("Saturn");
        expect(named.rect).toEqual(core.byId.get(list[0].id).frame);    // a renamed member shows its own frame (Kobin 2026-09-23)
    });
});

describe("erase pieces are storage", () => {
    test("a piece a wide erase cut off keeps out of the drawing it lies beside (its own scene)", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [130, 300]], 1, BLUE);        // a mark
        drawStroke(E, [[130, 300], [3200, 300]], 1, BLUE);       // a long line out of it (off screen is fine)
        drawStroke(E, [[3250, 300], [3290, 300]], 1, BLUE);      // a mark at the line's far, stray end
        expect(scenes(E).filter((s) => !s.kind).length).toBe(2);
        erase(E, [[600, 300], [1700, 300]], 200);                // takes the line out from ~400 to ~1900: a gap over 900 widths
        const list = scenes(E).filter((s) => !s.kind);
        expect(list.length).toBe(3);                             // the far piece split off; it did not join the far mark
    });
});

describe("parts and regions through the file", () => {
    // 45 marks far apart (regions: more than 20 side by side) and a panorama (parts: wider than 4,500 px at 2.5 px)
    const crowd = (E) => {
        for (let i = 0; i < 45; i++) drawStroke(E, [[i * 5000, 300], [i * 5000 + 30, 300]], 1, BLUE);
        for (let i = 0; i < 40; i++) drawStroke(E, [[i * 500, 100300], [i * 500 + 300, 100500]], 1, BLUE);
    };
    test("renamed parts and regions, and the part and region counters, survive serializeDrawing and loadDrawing", () => {
        const E = mkEngine();
        crowd(E);
        const list = scenes(E);
        const part = list.find((s) => s.kind === "part"), region = list.find((s) => s.kind === "region");
        expect(part && region).toBeTruthy();
        expect(E.renameScene(part.id, "Bridge")).toBe(true);
        expect(E.renameScene(region.id, "Harbour row")).toBe(true);
        scenes(E);
        const saved = E.serializeDrawing({ name: "t" }).meta.sceneIndex;
        expect(saved.pseq).toBeGreaterThan(1);
        expect(saved.rseq).toBeGreaterThan(1);
        const F = reload(E);
        expect(F.docMeta.scenes.find((s) => s.id === region.id).kind).toBe("region");   // the stored list, before the index lands
        const back = scenes(F);
        expect(back.find((s) => s.id === part.id).name).toBe("Bridge");
        expect(back.find((s) => s.id === region.id).name).toBe("Harbour row");
        const again = F.serializeDrawing({ name: "t" }).meta.sceneIndex;
        expect([again.pseq, again.rseq]).toEqual([saved.pseq, saved.rseq]);
        // a region's picture key survives the file whole, so its thumbnail is not re-made
        expect(F.docMeta.scenes.find((s) => s.id === region.id).hash).toBe(E.docMeta.scenes.find((s) => s.id === region.id).hash);
        F.destroy();
    });
});

describe("the worker path across documents and failures", () => {
    afterEach(() => setSceneTransport(null));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /** Wait until `f()` holds (a loaded machine stretches every timer), at most `ms`. */
    const until = async (f, ms = 3000) => { for (let t = 0; t < ms && !f(); t += 10) await sleep(10); return f(); };
    /** A transport whose batches can be held back: `hold()` keeps the next ones until `release()`. */
    const heldTransport = () => {
        const T = { holding: false, held: [], posted: [], failNext: 0, terminated: 0 };
        T.hold = () => { T.holding = true; };
        T.release = () => { T.holding = false; const h = T.held.splice(0); for (const f of h) f(); };
        T.releaseHeld = () => { const h = T.held.splice(0); for (const f of h) f(); };   // keeps holding what comes next
        setSceneTransport(() => {
            const ix = new SceneIndex();
            return {
                post: (batch) => new Promise((res, rej) => {
                    T.posted.push(batch);
                    const run = () => {
                        if (T.failNext > 0) { T.failNext--; rej(new Error("scene worker failed")); return; }
                        try { res(ix.apply(batch)); } catch (e) { rej(e); }
                    };
                    if (T.holding) T.held.push(run); else setTimeout(run, 1);
                }),
                terminate() { T.terminated++; },
            };
        });
        return T;
    };
    const docOf = (draw) => { const B = mkEngine(); draw(B); return JSON.parse(JSON.stringify(B.serializeDrawing({ name: "b" }))); };
    test("a batch still out when another document loads is dropped, and the new document restores without another edit", async () => {
        const T = heldTransport();
        const E = mkEngine();
        drawStroke(E, [[100, 300], [300, 300]], 20, BLUE);
        E.refreshScenes(); await sleep(40);
        expect(E.docMeta.scenes.length).toBe(1);
        const docB = docOf((B) => { two(B); });
        T.hold();
        drawStroke(E, [[100, 340], [300, 340]], 20, BLUE);
        E.refreshScenes(); await sleep(40);
        expect(E._sceneClient.inflight).toBeTruthy();
        E.loadDrawing(JSON.parse(JSON.stringify(docB)));
        T.releaseHeld(); await sleep(60);                                     // the old batch lands; the restore is held
        const ids = new Set(Object.values(E.nativesByLevel).flat().map((o) => o.id));
        expect(E.docMeta.scenes.every((s) => s.count == null || s.count <= 4)).toBe(true);
        expect(E.docMeta.scenes.filter((s) => !s.kind).length).not.toBe(1);  // not A's list
        const during = E.serializeDrawing({ name: "c" }).meta.sceneIndex;   // a save in the window
        expect(!during || during.scenes.every((s) => require("./sceneIndex").decodeIds(s.m).every((id) => ids.has(id)))).toBe(true);
        expect(T.posted.some((b) => b.restore)).toBe(true);                   // the restore went out with no further edit
        T.release(); await sleep(150);
        expect(E.docMeta.scenes.filter((s) => !s.kind).length).toBe(2);   // B's two compositions, not A's one
        const saved = E.serializeDrawing({ name: "c" }).meta.sceneIndex;
        expect(saved.scenes.reduce((a, s) => a + s.m.length, 0)).toBeGreaterThan(0);
        for (const s of saved.scenes) for (const id of require("./sceneIndex").decodeIds(s.m)) expect(ids.has(id)).toBe(true);
    });
    test("a frame change while a batch is out is sent when it lands, with no further edit", async () => {
        const T = heldTransport();
        const E = mkEngine();
        drawStroke(E, [[100, 300], [300, 300]], 20, BLUE);
        E.refreshScenes(); await sleep(40);
        T.hold();
        drawStroke(E, [[100, 340], [300, 340]], 20, BLUE);
        E.refreshScenes(); await sleep(20);
        E.doc.setFrameShift("0", [400, 0]);   // a frames-only change (the O(1) move's remainder)
        T.release();
        const sent = () => T.posted.find((b) => (b.frames || []).some((f) => f.id === "0" && f.sx === 400));
        expect(await until(() => !!sent())).toBe(true);   // a loaded machine stretches every timer
    }, 20000);
    test("a failed batch: the worker is terminated, the saved index rebuilds inline, and the failed batch's objects are indexed again", async () => {
        const T = heldTransport();
        const E = mkEngine();
        drawStroke(E, [[100, 300], [300, 300]], 20, BLUE);
        drawStroke(E, [[100, 340], [300, 340]], 20, BLUE);
        const b = drawStroke(E, [[40100, 300], [40300, 300]], 20, BLUE);   // a far composition: its own scene
        E.refreshScenes(); await sleep(40);
        expect(E.docMeta.scenes.filter((s) => !s.kind).length).toBe(2);
        const spy = jest.spyOn(SceneIndex.prototype, "_restore");
        T.failNext = 1;
        const t = []; t[0] = [-39800, 60]; E.doc.setOffsetsById(b.id, t);   // moved whole, to land beside the first
        E.refreshScenes(); await sleep(80);
        expect(T.terminated).toBeGreaterThanOrEqual(1);
        E.refreshScenes(); await sleep(40);
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[spy.mock.calls.length - 1][0].restore.state).toBeTruthy();   // the saved index, not the old list
        spy.mockRestore();
        expect(E.docMeta.scenes.filter((s) => !s.kind).length).toBe(1);                    // the moved scene re-joined
    });
    test("SC-3 a failed batch replaces the worker; past three failures the index goes inline", async () => {
        const T = heldTransport();
        const E = mkEngine();
        drawStroke(E, [[100, 300], [300, 300]], 20, BLUE);
        E.refreshScenes(); await sleep(40);
        expect(E._sceneClient.remote).toBeTruthy();
        const fail = async (k) => {
            T.failNext = 1;
            drawStroke(E, [[100, 300 + 40 * k], [300, 300 + 40 * k]], 20, BLUE);
            E.refreshScenes();
            expect(await until(() => T.terminated >= k)).toBe(true);
            E.refreshScenes(); await sleep(40);
        };
        for (let k = 1; k <= 3; k++) {
            await fail(k);
            expect(E._sceneClient.remote).toBeTruthy();                      // red at the first: inline for the session
        }
        await fail(4);
        expect(E._sceneClient.remote).toBeNull();
        expect(E._sceneClient.core).toBeTruthy();
        expect(E.docMeta.scenes.length).toBeGreaterThan(0);
    }, 20000);
    test("a save while a load's restore is out lists nothing dirty but what changed since (review nit)", async () => {
        const docB = docOf((B) => { two(B); B.refreshScenes(); });
        const T = heldTransport();
        const E = mkEngine();
        T.hold();
        E.loadDrawing(JSON.parse(JSON.stringify(docB)));
        E.refreshScenes(); await sleep(40);
        expect(E._sceneClient.inflight && E._sceneClient.inflight.restore).toBe(true);
        expect(E.serializeDrawing({ name: "c" }).meta.sceneIndex.dirty).toEqual([]);
        const n = drawStroke(E, [[200, 420], [420, 420]], 20, BLUE);
        expect(E.serializeDrawing({ name: "c" }).meta.sceneIndex.dirty).toEqual([n.id]);
        T.release(); await sleep(60);
    });
});

describe("a settle between prep slices (review 2026-09-22, minor 9)", () => {
    test("natives prepared before and after a frame's pending shift settles reach the index as one consistent picture", () => {
        const E = mkEngine();
        const C = E._sceneClient;
        const A = [300, 360, 420].map((y) => drawStroke(E, [[100, y], [300, y]], 20, BLUE));
        pan(E, 40000, 0);                                        // K where A will be once the shift below is undone
        const K = [300, 360, 420].map((y) => drawStroke(E, [[100, y], [300, y]], 20, BLUE));
        pan(E, -40000, 0);
        pan(E, 0, -100000);
        const filler = [];
        for (let i = 0; i < 70; i++) filler.push(drawStroke(E, [[20 + (i % 10) * 70, 100 + Math.floor(i / 10) * 60], [40 + (i % 10) * 70, 100 + Math.floor(i / 10) * 60]], 2, BLUE));
        pan(E, 0, 100000);
        scenes(E);
        const sceneOf = (o) => { const x = C.core.items.get(o.id); return x && x.scene ? x.scene.idn.id : null; };
        const arch = E.docMeta.scenes.find((s) => s.id === sceneOf(A[0]));
        expect(arch && sceneOf(K[0]) !== arch.id).toBe(true);
        E.renameScene(arch.id, "Arch"); scenes(E);
        E.doc.setFrameShift("0", [40000, 0]);                    // A goes 40,000 right, K onto A's old place
        scenes(E);
        const together = [];
        const orig = SceneIndex.prototype.apply;
        const spy = jest.spyOn(SceneIndex.prototype, "apply").mockImplementation(function (batch) {
            const out = orig.call(this, batch);
            const a = this.items.get(A[0].id), k = this.items.get(K[0].id);
            if (a && k && a.scene && a.scene === k.scene) together.push(this.batchNo);
            return out;
        });
        for (const o of [...filler, ...K]) E.doc.setOffsetsById(o.id, o.below);   // dirty: the filler first, K after
        let t = 0;
        const clock = jest.spyOn(performance, "now").mockImplementation(() => (t += 50));   // a slice is 64 ids
        E._lastCamMove = -Infinity;                              // the mocked clock starts at 0: the camera is still (SC-1)
        try {
            C._cancel(); C._tick(null);
            expect(C.pending && C.pending.i < C.pending.ids.length).toBe(true);   // part-way through the prep
            E.doc.at("0");                                                           // the shift settles
            for (let g = 0; g < 20 && (C.pending || C.dirty.size); g++) { C._cancel(); C._tick(null); }
        } finally { clock.mockRestore(); }
        scenes(E);
        spy.mockRestore();
        expect(together).toEqual([]);
        const list = scenes(E);
        expect(list.find((s) => s.id === arch.id).name).toBe("Arch");
    });
});

describe("review 2026-09-22: nits", () => {
    test("an old file's migration lends only v2 scene ids (a v3 part's id is not taken for a scene)", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 240], [420, 240]], 20, BLUE);
        const [s] = scenes(E);
        const F = reload(E, (doc) => { delete doc.meta.sceneIndex; doc.meta.scenes = [{ ...s, id: "p1", kind: "part" }]; });
        const back = scenes(F).filter((r) => !r.kind);
        expect(back.length).toBe(1);
        expect(back[0].id).toMatch(/^s\d+$/);
        F.destroy();
    });
    test("the scene list is never brought up to date inside a gesture", () => {
        const E = mkEngine();
        drawStroke(E, [[200, 240], [420, 240]], 20, BLUE);   // dirty, not yet indexed
        const spy = jest.spyOn(SceneIndex.prototype, "apply");
        E.setTool("pen"); E.pointerDown(200, 300); E.pointerMove(300, 300);
        E.refreshScenes();
        expect(spy).not.toHaveBeenCalled();
        E.pointerUp(); E.flushBakes();
        E.refreshScenes();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
        expect(E.docMeta.scenes.length).toBe(1);
    });
    test("frames removed together cost one pass over what was sent", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
        const home = camShot(E);
        descend(E, 2, 400, 300);
        drawStroke(E, [[380, 300], [420, 300]], 4, BLUE);
        camRestore(E, home);
        scenes(E);
        const C = E._sceneClient;
        let passes = 0;
        class Counted extends Map { [Symbol.iterator]() { passes++; return super[Symbol.iterator](); } }
        C.sent = new Counted(C.sent);
        const events = [];
        const un = E.doc.subscribe((ev) => { if (ev.kind === "removeFrame") events.push(ev.frame); });
        E.doc.removeFrameSubtree("0");
        un();
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(scenes(E).length).toBe(0);
        expect(passes).toBe(1);
    });
    test("a z change moves the scene's picture key on (its thumbnail is re-made)", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[200, 240], [420, 240]], 20, BLUE);
        drawStroke(E, [[200, 300], [420, 300]], 20, BLUE);
        const [s] = scenes(E);
        E.doc.setZById(a.id, (a.z != null ? a.z : a.id) + 100);
        const [t] = scenes(E);
        expect(t.id).toBe(s.id);
        expect(t.hash).not.toBe(s.hash);
    });
});
