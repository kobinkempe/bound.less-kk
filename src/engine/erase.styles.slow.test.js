/**
 * ST — STYLE through the erase machinery.
 *
 * An erase does not just cut geometry: it retires an object and puts new ones in
 * its place, at levels it was never drawn at, possibly several times over. Every
 * one of those has to come out looking like the thing it came from. Colour and
 * opacity are the easy half; the hard half is that a TRANSLUCENT object is the
 * one case where "two pieces where there was one" is visible even when the
 * geometry is perfect — wherever the pieces overlap, the alpha compounds and a
 * dark seam appears down the middle of what should be flat colour.
 *
 * That is why tiles overlap at all (§2.5) and why the seam pad is conditional on
 * opacity. These cases pin both halves of that trade: no visible gap between
 * pieces, and no visible doubling either.
 */
import {
    useEngines, mkEngine, drawStroke, eraseGesture, erase, drag, click, pan,
    descend, camShot, camRestore, painted, inkAt, colorAt, topAt, raster,
    rasterZ, rasterDiff, families, natives, picture,
} from "./__testkit__/harness";
import KobinEngine from "./KobinEngine";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc", RED = "#cc3311", GREEN = "#118844";
const DEPTHS = [[0], [1], [2], [3]];
// Draw with a full style, not just a colour.
function drawStyled(E, pts, { width = 30, color = BLUE, opacity = 1, penType = "normal" } = {}) {
    E.setTool("pen"); E.setPenType(penType); E.setWidth(width);
    E.setColor(color); E.setOpacity(opacity);
    E.pointerDown(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) E.pointerMove(pts[i][0], pts[i][1]);
    E.pointerUp();
    E.setOpacity(1); E.setPenType("normal");
    const arr = E.doc.at(E.cam.frame);
    return arr[arr.length - 1];
}
const styleOf = (o) => [o.color, o.opacity];
const allStyles = (E) => natives(E).map((r) => styleOf(r.obj));

const STYLES = {
    opaque: { color: BLUE, opacity: 1 },
    translucent: { color: BLUE, opacity: 0.4 },
    "very faint": { color: RED, opacity: 0.08 },
    highlighter: { color: GREEN, opacity: 1, penType: "highlight" },
};
const STYLED_DEPTHS = [];
for (const s of Object.keys(STYLES)) for (const d of [0, 1, 2, 3]) STYLED_DEPTHS.push([d, s]);

describe("ST-1 — every piece an erase makes keeps the style of what it came from", () => {
    // Layers: multi-layer erase (3) + already-cut shapes (5) + free-floating
    // pieces (12) + z-order (behaviour 5).
    test.each(STYLED_DEPTHS)("depth %i, %s", (d, name) => {
        const E = mkEngine();
        const src = drawStyled(E, [[-200, 300], [1000, 300]], { ...STYLES[name], width: 90 });
        const want = styleOf(src);
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const got = allStyles(E);
        expect(got.length).toBeGreaterThan(0);
        for (const g of got) expect(g).toEqual(want);
    });
    test.each(STYLED_DEPTHS)("depth %i, %s — and after a severance too", (d, name) => {
        const E = mkEngine();
        const src = drawStyled(E, [[150, 300], [650, 300]], { ...STYLES[name], width: 60 });
        const want = styleOf(src);
        const home = camShot(E);
        if (d) { descend(E, d, 250, 300); erase(E, [[400, 250], [400, 350]], 18); camRestore(E, home); }
        erase(E, [[440, 200], [440, 400]], 26);
        expect(families(E)).toBe(2);
        for (const g of allStyles(E)) expect(g).toEqual(want);
    });
});

describe("ST-2 — a translucent object cut in two does not darken along the cut", () => {
    // Layers: already-cut shapes (5) + tile boundaries (7) + multi-layer erase
    // (3). Behaviour 5, and the one case where a perfect cut can still look wrong.
    //
    // Pieces of an OPAQUE object may overlap freely — that is how the seam
    // hairline between tiles is suppressed. Pieces of a translucent one may not:
    // two 0.4 layers read as 0.64, which is a visible dark stripe down the
    // middle of flat colour. seamPad is conditional on exactly this.
    test.each([[0], [1], [2], [3]])("depth %i: no two pieces of it overlap", (d) => {
        const E = mkEngine();
        drawStyled(E, [[-200, 300], [1000, 300]], { color: BLUE, opacity: 0.4, width: 120 });
        descend(E, d, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        // Sample densely and count how many DIFFERENT pieces paint each point.
        const list = painted(E);
        let worst = 0;
        for (let i = 0; i < 90; i++) {
            for (let j = 0; j < 60; j++) {
                const p = E.cam.screenToFrame((i + 0.5) * (800 / 90), (j + 0.5) * (600 / 60));
                let n = 0;
                for (const o of list) {
                    if (o.type !== "fill") { n += 0; continue; }
                    let w = 0;
                    for (const ring of o.polys) {
                        for (let k = 0; k < ring.length; k++) {
                            const a = ring[k], b = ring[(k + 1) % ring.length];
                            if (a[1] <= p[1]) { if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++; }
                            else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
                        }
                    }
                    if (w !== 0) n++;
                }
                if (n > worst) worst = n;
            }
        }
        expect(worst).toBeLessThanOrEqual(1);
    });
    test("...while an opaque one is allowed to overlap, and must", () => {
        // The complement. If pieces of an opaque object ever abut exactly
        // instead of overlapping, an antialiasing hairline shows between them.
        const E = mkEngine();
        drawStyled(E, [[-200, 300], [1000, 300]], { color: BLUE, opacity: 1, width: 120 });
        descend(E, 2, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        // Walk the ink and look for a hairline: any un-inked sample in the
        // middle of what should be solid colour, well clear of the hole.
        let gaps = 0;
        for (let sx = 40; sx < 300; sx += 3) if (!inkAt(E, sx, 300)) gaps++;
        expect(gaps).toBe(0);
    });
});

describe("ST-3 — opacity groups mode", () => {
    // Layers: already-cut shapes (5) + tile boundaries (7) + zoom consistency
    // (17) + performance (1).
    //
    // The mode exists so translucent ink can be composited as one group; it
    // changes the seam policy, which is exactly what an erase interacts with.
    test.each([[false], [true]])("opacityGroups=%p: the same erase gives the same ink", (og) => {
        const E = mkEngine();
        E.setOpacityGroups(og);
        drawStyled(E, [[-200, 300], [1000, 300]], { color: BLUE, opacity: 0.5, width: 120 });
        descend(E, 2, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 200, 300)).toBe(true);
        expect(inkAt(E, 600, 300)).toBe(true);
        for (const g of allStyles(E)) expect(g[1]).toBe(0.5);
    });
    test("switching the mode after an erase does not move the hole", () => {
        const E = mkEngine();
        drawStyled(E, [[-200, 300], [1000, 300]], { color: BLUE, opacity: 0.5, width: 120 });
        descend(E, 2, 400, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        const before = raster(E, 56);
        E.setOpacityGroups(true);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
        E.setOpacityGroups(false);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
    });
});

describe("ST-4 — the eraser is the background colour, and never anything else", () => {
    // Layers: erasing over multiple objects (10) + z-order (behaviour 5) +
    // performance (1, deferred bake).
    //
    // The pen's colour and opacity are live UI state. An eraser gesture started
    // while a translucent red pen is selected must not produce a translucent red
    // "eraser" that tints what it covers instead of hiding it.
    test.each([["opaque"], ["translucent"], ["highlighter"]])("with the %s pen selected", (name) => {
        const E = mkEngine();
        drawStyled(E, [[120, 300], [680, 300]], { color: BLUE, width: 120 });
        const s = STYLES[name] || STYLES.opaque;
        E.setColor(s.color); E.setOpacity(s.opacity); E.setPenType(s.penType || "normal");
        eraseGesture(E, [[400, 240], [400, 360]], 24);
        const mark = E.doc.at(E.cam.frame).find((o) => o.erase);
        expect(mark).toBeTruthy();
        expect(mark.color).toBe("#ffffff");
        expect(mark.opacity).toBe(1);
        E.flushErases();
        expect(inkAt(E, 400, 300)).toBe(false);
        for (const g of allStyles(E)) expect(g[0]).toBe(BLUE);
    });
});

describe("ST-5 — style survives the whole round trip", () => {
    // Layers: undo/save (18) + multi-layer erase (3) + topology (14).
    test.each(Object.keys(STYLES).map((k) => [k]))("%s: reload, undo, redo", (name) => {
        const E = mkEngine();
        const src = drawStyled(E, [[150, 300], [650, 300]], { ...STYLES[name], width: 80 });
        const want = styleOf(src);
        const home = camShot(E);
        descend(E, 2, 250, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        camRestore(E, home);
        erase(E, [[440, 200], [440, 400]], 26);
        const doc = JSON.parse(JSON.stringify(E.serializeDrawing({ name: "st" })));
        const host = document.createElement("div"); document.body.appendChild(host);
        const F = new KobinEngine(host, { width: 800, height: 600 });
        expect(F.loadDrawing(doc)).toBe(true);
        for (const g of allStyles(F)) expect(g).toEqual(want);
        E.undo(); E.flushErases();
        for (const g of allStyles(E)) expect(g).toEqual(want);
        E.redo(); E.flushErases();
        for (const g of allStyles(E)) expect(g).toEqual(want);
    });
});

describe("ST-6 — a straight-line stroke, erased", () => {
    // Layers: already-cut shapes (5) + multi-layer erase (3) + topology (14).
    //
    // The straight pen keeps exactly two points however far the pointer travels,
    // which is the shortest possible input to the outline builder and the one
    // most likely to fall foul of a "curved only if pts > 2" branch.
    test.each(DEPTHS)("depth %i: it cuts like any other stroke", (d) => {
        const E = mkEngine();
        E.setTool("pen"); E.setPenType("straight"); E.setWidth(60); E.setColor(RED);
        E.pointerDown(150, 300); E.pointerMove(400, 300); E.pointerMove(650, 300); E.pointerUp();
        E.setPenType("normal");
        const arr = E.doc.at(E.cam.frame); const src = arr[arr.length - 1];
        expect(src.pts.length).toBe(2);
        descend(E, d, 300, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 300, 300)).toBe(true);
        for (const g of allStyles(E)) expect(g[0]).toBe(RED);
    });
});

describe("ST-7 — a highlighter over ink, then erased", () => {
    // Layers: erasing over multiple objects (10) + z-order (behaviour 5) +
    // already-cut shapes (5) + multi-layer erase (3).
    //
    // The classic stack: dark ink with a translucent wash over it. Erasing
    // through both must leave the ink and the wash cut in the same place, with
    // the wash still on top and still translucent.
    test.each([[0], [1], [2]])("depth %i", (d) => {
        const E = mkEngine();
        drawStyled(E, [[-200, 300], [1000, 300]], { color: BLUE, width: 40 });
        const wash = drawStyled(E, [[-200, 300], [1000, 300]], { color: GREEN, width: 60, penType: "highlight" });
        expect(wash.opacity).toBeLessThan(1);
        const home = camShot(E);
        descend(E, d, 300, 300);
        erase(E, [[400, 250], [400, 350]], 18);
        // The hole is judged where it was made. A cut one crossing down is 3000x
        // finer than the ink it is in, so from the top it is correctly invisible
        // — asserting it there would be asserting the cull, not the cut.
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(colorAt(E, 200, 300)).toBe(GREEN);       // wash still on top, down here
        camRestore(E, home);
        expect(colorAt(E, 200, 300)).toBe(GREEN);       // ...and up here
        const washes = natives(E).filter((r) => r.obj.color === GREEN);
        expect(washes.length).toBeGreaterThan(0);
        for (const r of washes) expect(r.obj.opacity).toBe(wash.opacity);
    });
});
