/**
 * persist.js (the kobin-1 save format) — encode/decode round-trips, dev-0
 * migration, validation failures, forward-compat field preservation, and the
 * engine-level serializeDrawing/loadDrawing path (including over the real
 * report snapshots).
 */
import { loadFixture, convertLegacySnapshot, isLegacySnapshot } from "./__testkit__/legacyFixture";
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

// `windows` and `srcId` were retired on 2026-08-06 when the parent started
// being CUT rather than recording the rect it had ceded. Recordings made before
// then still carry them and a load is expected to drop them — the one and only
// difference permitted on the way back out.
const RETIRED = ["windows", "srcId"];
const stripRetired = (natives) => {
    const out = {};
    for (const l of Object.keys(natives)) {
        // A frame with no ink in it is not a frame the document keeps. They used
        // to accumulate — one per re-home, one per cede link — and cost on every
        // render for the rest of the session (Document._forgetIfEmpty). A file
        // written by a build that stranded them is repaired on the way in, so it
        // does not come back out.
        if (!natives[l].length) continue;
        out[l] = natives[l].map((o) => { const c = { ...o }; for (const k of RETIRED) delete c[k]; return c; });
    }
    return out;
};

const drawStroke = (E, pts) => {
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
};
const countNatives = (E) => Object.values(E.nativesByLevel).reduce((a, arr) => a + arr.length, 0);

// A frame is a lattice CELL, so the wire form is (id, parent, depth, i, j) —
// the edge is derived from the cell and the grid is a constant.
const sampleParts = () => ({
    camera: { activeLevel: 1, inScale: 2.5, inPanX: -30, inPanY: 12 },
    crossings: { __lattice: 1, frames: [
        { id: "0", parent: null, depth: 0, i: 0, j: 0 },
        { id: "1", parent: "0", depth: 1, i: 0, j: 0 },
    ] },
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
    test("cede ownership metadata round-trips and is validated", () => {
        // Two fields carry a re-homed piece's place in its object, and only two:
        // `editId`, the family it belongs to, and `attachRect`, the tile it
        // fills in its own frame. There is no third — the hole in the parent is
        // in the parent's geometry now, not in a rect recorded beside it.
        const parts = sampleParts();
        Object.assign(parts.natives[1][0], {
            editId: 1,
            attachRect: { x0: 1, y0: 1, x1: 10, y1: 10 },
        });
        const d = decodeDrawing(encodeDrawing(parts));
        expect(d.natives[1][0].editId).toBe(1);
        expect(d.natives[1][0].attachRect).toEqual({ x0: 1, y0: 1, x1: 10, y1: 10 });
        parts.natives[1][0].attachRect = { x0: 5, y0: 0, x1: 4, y1: 1 }; // x1 < x0
        expect(() => decodeDrawing(encodeDrawing(parts))).toThrow(/attachRect/);
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
        ["a pre-lattice crossings dict", { format: FORMAT, version: 1, natives: {}, crossings: { 1: { s: 300, t: { x: 0, y: 0 } } } }],
        ["a pre-lattice frame tree", { format: FORMAT, version: 1, natives: {}, crossings: { __frames: [{ id: "0", depth: 0, parent: null, edge: null }] } }],
        ["a frame with a non-integer cell", { format: FORMAT, version: 1, natives: {}, crossings: { __lattice: 1, frames: [{ id: "0", parent: null, depth: 0, i: 0.5, j: 0 }] } }],
    ])("decode rejects %s", (label, raw) => {
        expect(() => decodeDrawing(raw)).toThrow();
    });

    /**
     * The two below USED to be rejections, and the change is deliberate.
     *
     * Both describe damage a build before 2026-08-21 could write, and in both
     * cases refusing meant the drawing could not be opened AT ALL — a total loss
     * over a defect the live session had shrugged off. Kobin's desktop drawing
     * of that morning carried both at once, and neither had troubled him while
     * he was working in it.
     *
     * The mints are fixed (LevelMap.cellChild carries an overflowing digit;
     * frameLattice.tilePhase can no longer hand back TILE). This is only about
     * not punishing the files those bugs already wrote.
     */
    test("an out-of-range frame cell LOADS, and says so", () => {
        const raw = { format: FORMAT, version: 1, natives: {},
            crossings: { __lattice: 1, frames: [
                { id: "0", parent: null, depth: 0, i: 0, j: 0 },
                { id: "0/1198,2059", parent: "0", depth: 1, i: 1198, j: 2059 }] } };
        const out = decodeDrawing(raw);
        expect(out.crossings.__outOfRangeCells).toEqual(["0/1198,2059"]);
    });

    test("a tile phase of exactly W is normalised to 0, not refused", () => {
        // W and 0 name the same grid; the value arrives purely by float rounding.
        const raw = { format: FORMAT, version: 1, crossings: { __lattice: 1, frames: [] },
            natives: { 0: [{ type: "stroke", id: 33, pts: [[0, 0]], lwFrame: 1,
                tile: [5.3060157612372455e-25, 131072] }] } };
        const out = decodeDrawing(raw);
        expect(out.natives[0][0].tile).toEqual([5.3060157612372455e-25, 0]);
    });

    test("a tile phase that is not two finite numbers is still refused", () => {
        for (const tile of [[0], [NaN, 0], ["a", 0], 5, [0, Infinity]]) {
            const raw = { format: FORMAT, version: 1, crossings: { __lattice: 1, frames: [] },
                natives: { 0: [{ type: "stroke", id: 1, pts: [[0, 0]], lwFrame: 1, tile }] } };
            expect(() => decodeDrawing(raw)).toThrow();
        }
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
    // .kobin-reports fixtures are gitignored recordings from Kobin's devices —
    // fresh clones skip these; set KOBIN_REQUIRE_REPORTS=1 to fail loudly instead.
    const reportsDir = path.join(__dirname, "..", "..", ".kobin-reports");
    const reportFiles = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json")) : [];
    const requireReports = !!process.env.KOBIN_REQUIRE_REPORTS;
    (reportFiles.length || requireReports ? test : test.skip)("real report snapshots load as drawings", () => {
        const dir = reportsDir;
        const files = reportFiles;
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
            if (!report.snapshot || !report.snapshot.natives) continue;
            const E = mkEngine();
            // D8: a pre-lattice file is REFUSED, not converted — turned away
            // with an error that says why, and without touching the engine it
            // was handed to. A recording that never crossed a level has no
            // frame records at all and is format-neutral, so it just loads.
            let doc = report.snapshot;
            if (isLegacySnapshot(report.snapshot)) {
                expect(() => E.loadDrawing(report.snapshot)).toThrow(/pre-lattice/);
                expect(countNatives(E)).toBe(0);
                // Re-expressed in lattice coordinates (a TEST-only conversion,
                // see __testkit__/legacyFixture.js) it loads.
                doc = convertLegacySnapshot(report.snapshot);
            }
            expect(E.loadDrawing(doc)).toBe(true);
            // ...and the round trip back out is byte-stable on the natives.
            expect(E.serializeDrawing().natives).toEqual(stripRetired(doc.natives));
        }
    });
    const pixelationReportPath = path.join(reportsDir, "report-2026-07-09T05-56-11-154Z.json");
    (fs.existsSync(pixelationReportPath) || requireReports ? test : test.skip)("pixelation report snapshot loads at deep zoom level", () => {
        const reportPath = pixelationReportPath;
        expect(fs.existsSync(reportPath)).toBe(true);
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        expect(report.camera.level).toBe(-1);
        const E = mkEngine(report.screen.w, report.screen.h);
        E.setLazyOutlines(false);
        expect(loadFixture(E, report.snapshot)).toBe(true);
        // The conversion preserves DEPTH, so the camera it hands back is already
        // at the level the recording was made at. Forcing `activeLevel` here
        // would jump to the SPINE cell at that depth, which is a different place
        // — only an origin chain is named "-1".
        E.cam.inScale = report.camera.inScale;
        E._render();
        expect(E.activeLevel).toBe(-1);
        expect(E.renderer.needsFatFlip()).toBe(false);
        E.destroy(); engines.pop();
    });
});
