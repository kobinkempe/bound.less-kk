/**
 * persist.js (the kobin-1 save format) — encode/decode round-trips, dev-0
 * migration, validation failures, forward-compat field preservation, and the
 * engine-level serializeDrawing/loadDrawing path (including over the real
 * report snapshots).
 */
import fs from "fs";
import path from "path";
import { FORMAT, VERSION, encodeDrawing, decodeDrawing } from "./persist";
import KobinEngine from "./KobinEngine";

jest.setTimeout(30000);

const engines = [];
const mkEngine = (w = 800, h = 600) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const e = new KobinEngine(host, { width: w, height: h });
    engines.push(e);
    return e;
};
afterEach(() => { while (engines.length) engines.pop().destroy(); });

const drawStroke = (E, pts) => {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const countNatives = (E) => Object.values(E.nativesByLevel).reduce((a, arr) => a + arr.length, 0);

const sampleParts = () => ({
    camera: { activeLevel: 1, inScale: 2.5, inPanX: -30, inPanY: 12 },
    crossings: { 1: { s: 300, t: { x: 10, y: -4 }, grid: { w: 24000, h: 18000, ox: -8000, oy: -6000 } } },
    natives: {
        0: [{ type: "stroke", origin: "native", id: 1, pts: [[0, 0], [10, 5]], lwFrame: 13, color: "rgb(0,0,0)", opacity: 1 }],
        1: [{ type: "stroke", origin: "native", id: 3, z: 1, pts: [[5, 5], [9, 9]], lwFrame: 2, color: "#ff0000", opacity: 0.5 }],
    },
});

describe("format encode/decode", () => {
    test("encode -> decode round-trips camera, crossings, natives and meta", () => {
        const parts = sampleParts();
        const doc = encodeDrawing({ ...parts, meta: { name: "boat scene", createdAt: "2026-01-01T00:00:00.000Z" } });
        expect(doc.format).toBe(FORMAT);
        expect(doc.version).toBe(VERSION);
        expect(doc.meta.name).toBe("boat scene");
        expect(doc.meta.createdAt).toBe("2026-01-01T00:00:00.000Z");
        expect(typeof doc.meta.modifiedAt).toBe("string");
        const d = decodeDrawing(JSON.parse(JSON.stringify(doc)));
        expect(d.camera).toEqual(parts.camera);
        expect(d.crossings).toEqual(parts.crossings);
        expect(d.natives).toEqual(parts.natives);
        expect(d.meta.name).toBe("boat scene");
    });
    test("legacy dev-0 snapshots migrate", () => {
        const parts = sampleParts();
        const dev0 = { v: "dev-0", camera: parts.camera, natives: parts.natives, crossings: parts.crossings };
        const d = decodeDrawing(dev0);
        expect(d.natives).toEqual(parts.natives);
        expect(d.camera).toEqual(parts.camera);
        expect(d.meta.name).toBe("untitled");
    });
    test("unknown fields survive decode (forward compat)", () => {
        const parts = sampleParts();
        parts.natives[0][0].futureField = { anything: true };
        const d = decodeDrawing(encodeDrawing(parts));
        expect(d.natives[0][0].futureField).toEqual({ anything: true });
    });
    test("z is preserved through the natives payload", () => {
        const d = decodeDrawing(encodeDrawing(sampleParts()));
        expect(d.natives[1][0].z).toBe(1);
    });
    test("scaleDef round-trips in meta", () => {
        const scaleDef = { value: 1, unit: "in", barPx: 120, zoomAt: 42 };
        const doc = encodeDrawing({ ...sampleParts(), meta: { name: "scaled", scaleDef } });
        const d = decodeDrawing(doc);
        expect(d.meta.scaleDef).toEqual(scaleDef);
    });
    test("legacy minUnit fields are dropped from scaleDef (bible Q4)", () => {
        const scaleDef = { value: 1, unit: "in", barPx: 120, zoomAt: 42, minUnit: "ft", minUnitZoomAt: 3 };
        const doc = encodeDrawing({ ...sampleParts(), meta: { name: "scaled", scaleDef } });
        const d = decodeDrawing(doc);
        expect(d.meta.scaleDef).toEqual({ value: 1, unit: "in", barPx: 120, zoomAt: 42 });
    });
    test.each([
        ["not an object", "hello"],
        ["an array", [1, 2]],
        ["random JSON", { some: "junk" }],
        ["a newer version", { format: FORMAT, version: VERSION + 1, natives: {} }],
        ["a missing version", { format: FORMAT, natives: {} }],
        ["a bad camera", { format: FORMAT, version: 1, camera: { activeLevel: 0.5 }, natives: {} }],
        ["non-finite geometry", { format: FORMAT, version: 1, natives: { 0: [{ type: "stroke", id: 1, pts: [[0, NaN]], lwFrame: 1 }] } }],
        ["a bad stroke width", { format: FORMAT, version: 1, natives: { 0: [{ type: "stroke", id: 1, pts: [[0, 0]], lwFrame: -1 }] } }],
        ["an unknown object type", { format: FORMAT, version: 1, natives: { 0: [{ type: "blob", id: 1 }] } }],
        ["a duplicate id", { format: FORMAT, version: 1, natives: { 0: [
            { type: "stroke", id: 1, pts: [[0, 0]], lwFrame: 1 }, { type: "stroke", id: 1, pts: [[1, 1]], lwFrame: 1 }] } }],
        ["a bad crossing record", { format: FORMAT, version: 1, natives: {}, crossings: { 1: { s: 0, t: { x: 0, y: 0 } } } }],
    ])("decode rejects %s", (label, raw) => {
        expect(() => decodeDrawing(raw)).toThrow();
    });
});

describe("engine serializeDrawing / loadDrawing", () => {
    test("full engine round-trip: document, camera, crossings, ids, meta", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [200, 150], [250, 260]]);
        for (let i = 0; i < 10; i++) E.zoomAt(200, 150, -1000);
        drawStroke(E, [[400, 300], [450, 340]]);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "trip" })));
        const E2 = mkEngine();
        expect(E2.loadDrawing(doc)).toBe(true);
        expect(E2.activeLevel).toBe(E.activeLevel);
        expect(E2.inScale).toBe(E.inScale);
        expect(Object.keys(E2.crossings).sort()).toEqual(Object.keys(E.crossings).sort());
        expect(countNatives(E2)).toBe(countNatives(E));
        expect(E2.docMeta.name).toBe("trip");
        // ids never collide after a load
        const maxId = Math.max(...Object.values(E2.nativesByLevel).flat().map((o) => o.id));
        drawStroke(E2, [[100, 100], [150, 150]]);
        const ids = Object.values(E2.nativesByLevel).flat().map((o) => o.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(Math.max(...ids)).toBeGreaterThan(maxId);
        // name + createdAt persist across the next save
        const doc2 = E2.serializeDrawing();
        expect(doc2.meta.name).toBe("trip");
        expect(doc2.meta.createdAt).toBe(doc.meta.createdAt);
    });
    test("loadDrawing accepts a dev-0 autosave (migration path)", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [180, 130]]);
        const dev0 = JSON.parse(JSON.stringify(E.snapshot()));
        const E2 = mkEngine();
        expect(E2.loadDrawing(dev0)).toBe(true);
        expect(countNatives(E2)).toBe(1);
    });
    test("loadDrawing throws on junk and leaves the engine untouched", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 100], [180, 130]]);
        expect(() => E.loadDrawing({ some: "junk" })).toThrow(/not a/i);
        expect(countNatives(E)).toBe(1); // decode failed BEFORE any state change
    });
    test("real report snapshots load as drawings", () => {
        const dir = path.join(__dirname, "..", "..", ".kobin-reports");
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
            if (!report.snapshot || !report.snapshot.natives) continue;
            const E = mkEngine();
            expect(E.loadDrawing(report.snapshot)).toBe(true); // dev-0 migration
            // and the round-trip back out is byte-stable on the natives payload
            expect(E.serializeDrawing().natives).toEqual(report.snapshot.natives);
            E.destroy(); engines.pop();
        }
    });
    test("pixelation report snapshot loads at deep zoom level", () => {
        const reportPath = path.join(__dirname, "..", "..", ".kobin-reports", "report-2026-07-09T05-56-11-154Z.json");
        expect(fs.existsSync(reportPath)).toBe(true);
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        expect(report.camera.level).toBe(-1);
        const E = mkEngine(report.screen.w, report.screen.h);
        E.setLazyOutlines(false);
        expect(E.loadDrawing(report.snapshot)).toBe(true);
        E.cam.activeLevel = report.camera.level;
        E.cam.inScale = report.camera.inScale;
        E._render();
        expect(E.activeLevel).toBe(-1);
        expect(E.renderer.needsFatFlip()).toBe(false);
        E.destroy(); engines.pop();
    });
});
