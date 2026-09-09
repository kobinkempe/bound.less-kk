/**
 * F66 (Kobin's reports of 2026-09-08 19:53): an eraser made in a SIBLING frame at the
 * object's own depth, over the picture of an object that had been moved by its
 * displacement table, cut nothing — the mark was consumed. `mapPointObj` chose its
 * direction by depth, so the eraser was mapped home-to-picture instead of picture-to-home
 * and landed two displacements from the ink. The home is named by id now. And the second
 * report: a hairline eraser's slivers were culled as dust against the pen's width — dust
 * is now what was invisible at the zoom the mark was drawn at (a quarter pixel there).
 */
import { mkEngine, useEngines, drawStroke, descend, drag, erase, topAt } from "./__testkit__/harness";
import { loopsArea, loopsBBox } from "./geometry/arcShape";
import { cutJob } from "./eraseJob";
import { rectLoop } from "./geometry/arcShape";

const inkAt = (E, level) => E.doc.at(level).filter((o) => !o.erase);
const area = (o) => Math.abs(loopsArea(o.loops));

describe("erasing a moved object from a sibling frame (F66)", () => {
    useEngines();

    test("the eraser's box maps into the stored coordinates by the displacement, both ways", () => {
        const E = mkEngine(800, 600);
        const A = drawStroke(E, [[200, 300], [600, 300]], 20);
        const home = E.cam.frame;
        E.doc.setOffsetsById(A.id, [[50, -30]]);           // the picture sits 50 right, 30 up, in home units
        const rec = E.doc.getById(A.id);
        // home -> home (the picture in its own frame) adds the displacement...
        const p = E.lm.mapPointObj([100, 100], home, home, rec.obj.below, home);
        expect(p).toEqual([150, 70]);
        // ...and a point of the picture given in the home maps back by subtracting it — the
        // same frame at both ends, and the direction decided by which end is the home.
        const q = E.lm.mapPointObj([150, 70], home, home, rec.obj.below, home);
        expect(q).toEqual([200, 40]);   // from == home: always home-to-picture; the caller says which end is the home
    });

    test("an eraser over the moved picture, made in the neighbouring frame, cuts the ink", () => {
        const E = mkEngine(800, 600);
        descend(E, 1);                                             // a depth-1 cell, whose neighbours are its siblings
        const A = drawStroke(E, [[300, 300], [500, 300]], 20);
        const home = E.cam.frame;
        const before = area(A);
        const b = loopsBBox(A.loops);
        // Move the object by its table so that its picture crosses into the neighbour frame:
        // the frames meet half a frame from the home's origin, and a table entry stays
        // within half a frame.
        const nb = E.lm.neighbour(home, 1, 0);
        expect(nb).toBeTruthy();
        const W = E.lm.mapPointF([0, 0], nb.id, home)[0];        // the neighbour's origin in home units
        const dx = W / 2 + 10 - (b.x0 + b.x1) / 2;                 // the stroke's centre lands 10 units into the neighbour
        E.doc.setOffsetsById(A.id, [[dx, 0]]);
        // The eraser is made IN the neighbour frame, where the picture now is: a mark whose
        // box, in the neighbour's units, covers the picture's centre.
        const pic = E.lm.mapRectObj({ left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 }, home, nb.id, E.doc.getById(A.id).obj.below, home);
        expect(pic).toBeTruthy();
        const cx = (pic.left + pic.right) / 2, h = pic.bottom - pic.top;
        E.doc.add({ type: "stroke", origin: "native", erase: true, bakePx: 1, id: E.doc.allocId(), pts: [[cx, pic.top - h], [cx, pic.bottom + h]], lwFrame: (b.y1 - b.y0), color: "#ffffff", opacity: 1, paths: [] }, nb.id);
        E.flushBakes();
        const mark = E._eraseStrokes()[0];
        expect(mark).toBeTruthy();
        // The candidate is found and the eraser's box, mapped into the stored coordinates, meets the ink.
        const t = E._nextEraseTarget(mark);
        expect(t && t.obj.id).toBe(A.id);
        E.flushErases();
        const left = inkAt(E, home);
        expect(left.length).toBe(2);                              // cut in two
        expect(left.reduce((n, o) => n + area(o), 0)).toBeLessThan(before - 100);
        expect(E._eraseStrokes()).toHaveLength(0);
    });

    test("a hairline eraser's slivers are ink, not dust", () => {
        // A 100 x 20 stroke-like rect, and an eraser comb: five hairlines 0.05 wide, 0.15 apart.
        const subject = rectLoop({ left: 0, top: 0, right: 100, bottom: 20 });
        const clip = [];
        for (let k = 0; k < 5; k++) clip.push(...rectLoop({ left: 50 + k * 0.15, top: -1, right: 50.05 + k * 0.15, bottom: 21 }));
        const pen = 20;                                            // the pen that drew the subject
        const culled = cutJob({ subject, clip, w: pen, freezeR: 1e9, graze: "cut" });                   // the pen alone: a hundredth of it
        const kept = cutJob({ subject, clip, w: pen, dustBar: 0.03, freezeR: 1e9, graze: "cut" });     // the view's bar: a quarter pixel there is 0.03
        expect(culled.kind).toBe("cut");
        expect(kept.kind).toBe("cut");
        expect(culled.regions.length).toBe(2);                     // the four 0.1-wide slivers between the hairlines fell as dust
        expect(kept.regions.length).toBe(6);                       // they are ink
        const total = kept.regions.reduce((n, g) => n + Math.abs(loopsArea(g)), 0);
        expect(total).toBeCloseTo(100 * 20 - 5 * 0.05 * 20, 3);   // exactly what the eraser swept, and no more
        expect(loopsBBox(kept.regions[0]).x0).toBeDefined();
    });
});

// F72 (found 2026-09-08 writing the op-log test): an eraser made in the object's OWN frame
// over its moved picture took the home-to-picture branch — both ends were the home — and
// landed a displacement away, cutting nothing.
describe("erasing a moved object in its own frame (F72)", () => {
    useEngines();
    test("an eraser made at the home over the moved picture cuts the ink there, and the rest stays put", () => {
        const E = mkEngine();
        const a = drawStroke(E, [[100, 300], [300, 300]], 20);
        drag(E, [200, 300], [500, 300]);
        expect(a.below).toBeTruthy();
        expect(topAt(E, 500, 300)).toBeTruthy();               // drawn where it was dragged
        erase(E, [[500, 250], [500, 350]], 30);
        expect(E.doc.getById(a.id)).toBeNull();                // cut into pieces
        expect(topAt(E, 500, 300)).toBeNull();                 // the hole is where the eraser went
        expect(topAt(E, 430, 300)).toBeTruthy();               // the rest is still where the drag left it
        expect(topAt(E, 570, 300)).toBeTruthy();
        expect(topAt(E, 200, 300)).toBeNull();                 // nothing came back to the stored bits
    });
});
