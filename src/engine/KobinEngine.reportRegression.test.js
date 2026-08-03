import fs from "fs";
import path from "path";
import KobinEngine from "./KobinEngine";
import { bboxOf } from "./geometry/derive";
import { windingOfPoint, distToPolyline } from "./geometry/hittest";

jest.setTimeout(120000);

const reportDir = path.join(__dirname, "..", "..", ".kobin-reports");
const reportNames = [
    "report-2026-07-30T16-02-22-550Z.json",
    "report-2026-07-30T16-03-57-617Z.json",
    "report-2026-07-30T16-07-55-017Z.json",
];
const reportsAvailable = reportNames.every((name) =>
    fs.existsSync(path.join(reportDir, name)));

const engines = [];
const loadReport = (name) => {
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, name), "utf8"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new KobinEngine(host, {
        width: report.screen?.w || 800,
        height: report.screen?.h || 600,
    });
    engines.push(E);
    E.loadSnapshot(JSON.parse(JSON.stringify(report.snapshot)));
    return E;
};
afterEach(() => {
    while (engines.length) engines.pop().destroy();
});

const inked = (pieces, point) => pieces.some((o) =>
    o.type === "fill"
        ? windingOfPoint(o.polys, point) !== 0
        : distToPolyline(o.pts, point) <= o.lwFrame / 2);

const screenPoint = (E, p) => [
    p[0] * E.cam.inScale + E.cam.inPanX,
    p[1] * E.cam.inScale + E.cam.inPanY,
];

function renderedForKey(E, key) {
    return E._objs().filter((o) => {
        const rec = E.doc.getById(o.id);
        return rec && E.doc.editKey(rec.obj) === key;
    });
}

function projectedRecord(E, rec) {
    return rec.obj.placements?.length
        ? E.lm.projectPlacedF(rec.obj, rec.level, E.cam.frame)
        : E.lm.projectF(rec.obj, rec.level, E.cam.frame);
}

function inRect(p, rect, eps = 0) {
    return p[0] >= rect.left - eps && p[0] <= rect.right + eps &&
        p[1] >= rect.top - eps && p[1] <= rect.bottom + eps;
}

// Persistent erase cells own only their tile core. Their stored rings may carry
// seam overscan, but that overscan is never canonical ink and must not be used
// as a visibility oracle.
function recordOwnsPoint(E, rec, projected, p) {
    if (rec.obj.eraseCell) {
        const c = rec.obj.eraseCell;
        const core = E.lm.tileRect(c.frame, c.i, c.j);
        const mapped = E.lm.mapRectPlacedF(
            core, c.frame, E.cam.frame, rec.obj.placements || [],
        );
        if (!mapped || !inRect(p, mapped, 1e-9)) return false;
    }
    for (const w of projected.windows || []) {
        if (inRect(p, {
            left: w.x0, top: w.y0, right: w.x1, bottom: w.y1,
        })) return false;
    }
    return projected.type === "fill"
        ? windingOfPoint(projected.polys, p) !== 0
        : distToPolyline(projected.pts, p) <= projected.lwFrame / 2;
}

function familyCoverageDiagnostics(E, cols = 72, rows = 48) {
    const win = E._frameWindow(0);
    const keys = E._logicalKeys().filter((key) => {
        const family = E.doc.editGroup(key);
        return family.length > 1 ||
            family.some((rec) => rec.obj.placements?.length);
    });
    const rendered = new Map(keys.map((key) => [
        key, renderedForKey(E, key),
    ]));
    const canonical = new Map(keys.map((key) => [
        key,
        E.doc.editGroup(key).map((rec) => ({
            rec, projected: projectedRecord(E, rec),
        })).filter((item) => item.projected),
    ]));
    const out = [];
    for (const key of keys) {
        let truth = 0, missing = 0, extra = 0;
        const firstMissing = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const p = [
                    win.left + (x + 0.5) * (win.right - win.left) / cols,
                    win.top + (y + 0.5) * (win.bottom - win.top) / rows,
                ];
                const expected = canonical.get(key).some(({ rec, projected }) =>
                    recordOwnsPoint(E, rec, projected, p));
                const actual = inked(rendered.get(key) || [], p);
                if (expected) {
                    truth++;
                    if (!actual) {
                        missing++;
                        if (firstMissing.length < 4) firstMissing.push(p);
                    }
                } else if (actual) extra++;
            }
        }
        if (truth || missing || extra) out.push({
            key, truth, missing, extra, firstMissing,
            physical: E.doc.editGroup(key).length,
            rendered: (rendered.get(key) || []).length,
        });
    }
    return out;
}

function findRenderedInkPoint(pieces) {
    if (!pieces.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of pieces) {
        const b = bboxOf(o, null);
        const m = o.type === "fill" ? 0 : (o.lwFrame || 0) / 2;
        x0 = Math.min(x0, b.x0 - m); y0 = Math.min(y0, b.y0 - m);
        x1 = Math.max(x1, b.x1 + m); y1 = Math.max(y1, b.y1 + m);
    }
    for (let yi = 1; yi < 30; yi++) for (let xi = 1; xi < 30; xi++) {
        const p = [x0 + (x1 - x0) * xi / 30, y0 + (y1 - y0) * yi / 30];
        if (inked(pieces, p)) return p;
    }
    return null;
}

(reportsAvailable ? describe : describe.skip)("reported multi-level movement regressions", () => {
    test("latest report also passes the real drawing-file decoder", () => {
        const report = JSON.parse(fs.readFileSync(
            path.join(reportDir, reportNames[2]), "utf8",
        ));
        const host = document.createElement("div");
        document.body.appendChild(host);
        const E = new KobinEngine(host, {
            width: report.screen?.w || 800,
            height: report.screen?.h || 600,
        });
        engines.push(E);
        expect(() => E.loadDrawing(JSON.parse(JSON.stringify(report.snapshot))))
            .not.toThrow();
        expect(E._objs().length).toBeGreaterThan(0);
    });

    test.each(reportNames)("%s renders every densely sampled canonical family point", (name) => {
        const E = loadReport(name);
        const coverage = familyCoverageDiagnostics(E);
        expect(coverage.length).toBeGreaterThan(0);
        expect(coverage.filter((d) => d.missing).map((d) => ({
            key: d.key, missing: d.missing, firstMissing: d.firstMissing,
        }))).toEqual([]);
    });

    test.each([330, 349])(
        "latest report family %s survives inward/outward crossings and eviction",
        (key) => {
            const E = loadReport(reportNames[2]);
            const startPieces = renderedForKey(E, key);
            const point = findRenderedInkPoint(startPieces);
            expect(point).not.toBeNull();
            const focus = screenPoint(E, point);
            const states = [];
            const recordState = (phase, i) => {
                const hit = E._resolvedHit(...focus);
                const rec = hit == null ? null : E.doc.getById(hit);
                states.push({
                    phase, i, frame: E.cam.frame, scale: E.cam.inScale,
                    pieces: renderedForKey(E, key).length,
                    hit, hitKey: rec ? E.doc.editKey(rec.obj) : null,
                });
            };
            for (let i = 0; i < 75; i++) {
                recordState("in", i);
                E.zoomFactorAt(...focus, 1.25);
            }
            E.store.cache.clear();
            E.store.placedCache.clear();
            E.renderer.clear();
            E._render();
            recordState("deep-evicted", 0);
            for (let i = 0; i < 75; i++) {
                E.zoomFactorAt(...focus, 1 / 1.25);
                recordState("out", i);
            }
            const missing = states.filter((s) => s.hitKey !== key);
            expect(missing).toEqual([]);
        },
    );
});
