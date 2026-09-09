/**
 * TP — TOPOLOGY under erase.
 *
 * Connectivity is the one property of an object that cannot be read off its
 * geometry locally, and bible §3's relay answers it locally anyway. These cases
 * are the shapes where the local answer and the true answer can come apart:
 * rings, which are connected all the way round the outside of any single window;
 * junctions, where cutting one limb changes nothing and cutting two changes
 * everything; and nested islands, where the piece that comes loose is inside
 * the piece that does not.
 *
 * The asymmetry that decides every judgement call here: an object wrongly left
 * WHOLE still renders correctly and merely drags as one lump. An object wrongly
 * SEVERED comes apart under the user's hands and cannot be put back. So every
 * ambiguous case is expected to stay whole, and the tests say so explicitly
 * rather than leaving it to be inferred.
 */
import {
    useEngines, mkEngine, drawStroke, erase, drag, click, descend, camShot, camRestore, inkAt,
    raster, rasterDiff, families, painted,
} from "./__testkit__/harness";
import { pieceInks } from "./__testkit__/ink";

jest.setTimeout(300000);
useEngines();

// A closed ring of `n` segments, centred on (cx, cy).
const ringPts = (cx, cy, r, n = 48) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return pts;
};
describe("TP-1 — a ring is connected the long way round", () => {
    // Layers: complex topology (14) + multi-layer erase (3) + tile boundary (7).
    //
    // The single case the relay exists to get right. One cut in a ring leaves a
    // C: still one object, joined by going the other way. Nothing local to the
    // cut can tell you that — the two ends of the C are as separate, right
    // there, as the two halves of a severed band.
    test.each([[0], [1], [2], [3]])("one cut at depth %i leaves a C, not two arcs", (n) => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180), 26);
        expect(families(E)).toBe(1);
        const home = camShot(E);
        descend(E, n, 400, 120);                 // about the top of the ring
        erase(E, [[340, 300], [460, 300]], 26);
        expect(inkAt(E, 400, 300)).toBe(false);  // the cut is real, not a no-op
        expect(families(E)).toBe(1);
        camRestore(E, home);
        expect(families(E)).toBe(1);
    });
    test("a second cut on the far side does sever it", () => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180), 26);
        erase(E, [[400, 60], [400, 160]], 26);   // through the top
        expect(families(E)).toBe(1);
        erase(E, [[400, 440], [400, 540]], 26);  // and the bottom
        expect(families(E)).toBe(2);
        // ...and the halves really are independent.
        click(E, 220, 300);
        const left = E.selection.editId;
        click(E, 580, 300);
        expect(E.selection.editId).not.toBe(left);
    });
    test("the ring's hole is not ink, before or after the cuts", () => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180), 26);
        expect(inkAt(E, 400, 300)).toBe(false);
        erase(E, [[400, 60], [400, 160]], 26);
        expect(inkAt(E, 400, 300)).toBe(false);
        expect(inkAt(E, 220, 300)).toBe(true);
    });
});

describe("TP-2 — a gesture that does not cross the ink does not part it", () => {
    // Layers: topology (14) + multi-layer erase (3) + already-cut shapes (5) +
    // zoom consistency (17).
    //
    // NOTE what this is NOT saying. Severing an object from below its own level
    // is a design requirement and it works — see erase.deepsever.slow.test.js,
    // which parts an object homed at level 0 from one, two, three and four
    // crossings down, and does it in a SINGLE gesture when the ink is thin
    // enough. What decides it is simply whether the gesture crosses the ink at
    // the level it is made.
    //
    // This case is the negative control for that. A 40-unit ring three crossings
    // down is 1.1e12 units across against a gesture that reaches ~8e3: the erase
    // is a scratch on something the size of a continent. It removes ink and the
    // ring is still a ring, twice over, in a place where two cuts that DID go
    // through would certainly have parted it.
    //
    // Getting this direction wrong is the expensive one: an object wrongly
    // severed comes apart in the user's hands and cannot be reassembled.
    test("two deep gestures on opposite sides of a ring leave it whole", () => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180, 64), 40);
        const home = camShot(E);
        for (const [sx, sy] of [[400, 120], [400, 480]]) {
            camRestore(E, home);
            descend(E, 3, sx, sy);
            erase(E, [[400, 120], [400, 480]], 40);
            expect(inkAt(E, 400, 300)).toBe(false);   // ink really did go
            camRestore(E, home);
            expect(families(E)).toBe(1);
        }
    });
    test("...while the same two cuts at the ring's own level do part it", () => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180, 64), 40);
        erase(E, [[400, 60], [400, 170]], 30);
        expect(families(E)).toBe(1);
        erase(E, [[400, 430], [400, 540]], 30);
        expect(families(E)).toBe(2);
    });
    test("a deep cut on a ring that has already been opened still leaves it whole", () => {
        // The hard version: the ring is a C, so it is one cut from parting, and
        // the second cut is deep — the relay now has to walk a chain that ends
        // at an object which is ALREADY only just connected, and still say no.
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 180, 64), 40);
        const home = camShot(E);
        erase(E, [[400, 60], [400, 170]], 30);
        expect(families(E)).toBe(1);
        descend(E, 2, 400, 480);
        erase(E, [[400, 200], [400, 400]], 40);
        camRestore(E, home);
        expect(families(E)).toBe(1);
    });
});

describe("TP-3 — a three-way junction", () => {
    // Layers: topology (14) + free-floating pieces (12) + selection (2) +
    // erasing over multiple objects (10).
    //
    // A Y made of one stroke. Cutting one limb detaches that limb and leaves the
    // other two joined: two objects, not three, and not one. This is where a
    // naive "count the regions the boolean returned" answer and the right answer
    // differ — the boolean sees two regions either way.
    const drawY = (E, w = 24) => {
        E.setTool("pen"); E.setWidth(w);
        E.pointerDown(400, 460);
        E.pointerMove(400, 300);
        E.pointerMove(280, 160);
        E.pointerUp();
        E.setTool("pen");
        E.pointerDown(400, 300);
        E.pointerMove(520, 160);
        E.pointerUp();
    };
    test("cutting one limb gives exactly two objects", () => {
        const E = mkEngine();
        drawY(E);
        const before = families(E);
        expect(before).toBe(2);              // two strokes to start with
        erase(E, [[330, 400], [470, 400]], 20);   // across the stem, below the junction
        expect(families(E)).toBe(3);
    });
    test("a ring cut at the junction frees all three limbs AND the middle", () => {
        const E = mkEngine();
        drawY(E);
        erase(E, ringPts(400, 300, 46, 24), 22);  // an annulus right on the junction
        // The gesture is a ring, so it takes an annulus and leaves the disc
        // inside it standing: three limbs plus one island, none of them still
        // joined to any other. Four objects at least — where the naive answer
        // (count what the boolean returned at the level of the cut) is three.
        expect(families(E)).toBeGreaterThanOrEqual(4);
        expect(inkAt(E, 400, 300)).toBe(true);    // the island in the middle
        expect(inkAt(E, 400, 254)).toBe(false);   // the annulus itself
        expect(inkAt(E, 400, 440)).toBe(true);
        expect(inkAt(E, 290, 170)).toBe(true);
        expect(inkAt(E, 510, 170)).toBe(true);
        // ...and the island really is loose: drag it and nothing else follows.
        const box = { x0: 240, y0: 140, x1: 560, y1: 200 };
        const limbs = raster(E, 32, box);
        click(E, 400, 300);
        drag(E, [400, 300], [700, 520]);
        expect(rasterDiff(limbs, raster(E, 32, box)).total).toBe(0);
    });
    test("dragging one limb leaves the other two where they were", () => {
        const E = mkEngine();
        drawY(E);
        erase(E, [[330, 400], [470, 400]], 20);
        const box = { x0: 240, y0: 120, x1: 560, y1: 340 };
        const upper = raster(E, 40, box);
        click(E, 400, 470);
        drag(E, [400, 470], [700, 470]);
        expect(rasterDiff(upper, raster(E, 40, box)).total).toBe(0);
    });
});

describe("TP-4 — an island inside an island", () => {
    // Layers: topology (14) + free-floating details (12) + multi-layer erase (3)
    // + already-cut shapes (5).
    //
    // Erase a ring inside a solid blob, then a smaller ring inside what that
    // left. The innermost disc touches nothing: it is severed with no relay at
    // all. What must not happen is the two rings' leftovers being lumped into
    // one family because they were cut by the same gesture chain.
    test("each ring's leftover is its own object", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 260);   // a fat blob
        expect(families(E)).toBe(1);
        erase(E, ringPts(400, 300, 100, 40), 16);
        const after1 = families(E);
        expect(after1).toBe(2);                          // outside + inner disc
        erase(E, ringPts(400, 300, 50, 40), 12);
        expect(families(E)).toBe(3);                     // + the innermost disc
        expect(inkAt(E, 400, 300)).toBe(true);           // innermost still inked
        expect(inkAt(E, 400, 250)).toBe(false);          // ring 2 is a hole
        expect(inkAt(E, 400, 225)).toBe(true);           // annulus between them
        expect(inkAt(E, 400, 200)).toBe(false);          // ring 1 is a hole
    });
    test("dragging the innermost disc moves only it", () => {
        const E = mkEngine();
        drawStroke(E, [[300, 300], [500, 300]], 260);
        erase(E, ringPts(400, 300, 100, 40), 16);
        erase(E, ringPts(400, 300, 50, 40), 12);
        const box = { x0: 280, y0: 180, x1: 520, y1: 260 };
        const rest = raster(E, 32, box);
        click(E, 400, 300);
        drag(E, [400, 300], [400, 520]);
        expect(rasterDiff(rest, raster(E, 32, box)).total).toBe(0);
        expect(inkAt(E, 400, 520)).toBe(true);
    });
});

describe("TP-5 — a donut whose hole straddles a tile seam", () => {
    // Layers: topology (14) + tile boundary (7) + multiple tiles (13) +
    // multi-layer erase (3) + zoom consistency (17).
    //
    // A ring that is only connected THROUGH a tile the erase is ceding is the
    // adversarial case for the relay: the contact that keeps it whole is on the
    // window's boundary, which is exactly the evidence the relay reads.
    test("it stays one object, and stays a ring through a round trip", () => {
        const E = mkEngine();
        drawStroke(E, ringPts(400, 300, 200, 64), 30);
        const home = camShot(E);
        descend(E, 2, 400, 100);
        erase(E, [[360, 260], [440, 340]], 22);
        expect(families(E)).toBe(1);
        camRestore(E, home);
        const before = raster(E, 56);
        descend(E, 1, 400, 100); camRestore(E, home);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
        expect(families(E)).toBe(1);
    });
});

describe("TP-6 — a stroke that crosses itself", () => {
    // Layers: topology (14) + already-cut shape (5) + erasing over multiple
    // objects (10) + selection (2).
    //
    // A figure-of-eight has one point where four arms meet. Cutting one lobe
    // open leaves it whole (round the other lobe); cutting the crossing itself
    // is what parts it.
    const eight = (E) => {
        const pts = [];
        for (let i = 0; i <= 120; i++) {
            const t = (i / 120) * Math.PI * 2;
            pts.push([400 + 200 * Math.sin(t), 300 + 130 * Math.sin(t) * Math.cos(t)]);
        }
        drawStroke(E, pts, 22);
    };
    test("opening one lobe leaves it whole", () => {
        const E = mkEngine();
        eight(E);
        erase(E, [[600, 240], [600, 360]], 20);
        expect(families(E)).toBe(1);
    });
    test("cutting the crossing parts it", () => {
        const E = mkEngine();
        eight(E);
        erase(E, ringPts(400, 300, 40, 24), 22);
        expect(families(E)).toBeGreaterThanOrEqual(2);
    });
});

describe("TP-7 — an erase that leaves nothing but islands", () => {
    // Layers: topology (14) + long eraser path (11) + free-floating pieces (12)
    // + multi-layer erase (3).
    //
    // A comb: one gesture down the spine leaves every tooth on its own. All of
    // them are severed, all at once, in a single bake — and none of them may
    // keep the spine's identity, or selecting one would select all.
    test("every tooth becomes its own object", () => {
        const E = mkEngine();
        E.setTool("pen"); E.setWidth(18);
        E.pointerDown(160, 300);
        E.pointerMove(640, 300);
        E.pointerUp();
        for (let i = 0; i < 5; i++) drawStroke(E, [[200 + i * 100, 300], [200 + i * 100, 160]], 18);
        expect(families(E)).toBe(6);
        erase(E, [[140, 300], [660, 300]], 22);      // take the spine out
        const f = families(E);
        expect(f).toBeGreaterThanOrEqual(5);
        const keys = new Set();
        for (let i = 0; i < 5; i++) {
            click(E, 200 + i * 100, 200);
            expect(E.selection).toBeTruthy();
            keys.add(E.selection.editId);
        }
        expect(keys.size).toBe(5);                   // five separate teeth
    });
});

describe("TP-8 — a shape cut into a shape that was cut into a shape", () => {
    // Layers: already-cut shapes (5) + multi-layer erase (3) + multiple tiles
    // (13) + zoom consistency (17) + performance (1).
    //
    // Three erases at three different depths into the same object, each one
    // acting on what the previous one left. Each cut has to see the CURRENT ink,
    // not the original stroke, or holes reappear and disappear as you zoom.
    test("all three holes coexist and survive a round trip", () => {
        const E = mkEngine();
        drawStroke(E, [[80, 300], [720, 300]], 120);
        const home = camShot(E);
        erase(E, [[240, 220], [240, 300]], 22);                 // a nick, at its own level
        descend(E, 1, 400, 300); erase(E, [[400, 220], [400, 380]], 22);
        camRestore(E, home);
        descend(E, 2, 560, 300); erase(E, [[400, 220], [400, 380]], 22);
        camRestore(E, home);
        expect(inkAt(E, 240, 300)).toBe(false);
        expect(inkAt(E, 160, 300)).toBe(true);
        expect(inkAt(E, 320, 300)).toBe(true);
        const before = raster(E, 56);
        descend(E, 2, 400, 300); camRestore(E, home);
        expect(rasterDiff(before, raster(E, 56)).total).toBeLessThanOrEqual(2);
    });
    test("and the object is still ONE object throughout", () => {
        const E = mkEngine();
        drawStroke(E, [[80, 300], [720, 300]], 120);
        const home = camShot(E);
        erase(E, [[240, 220], [240, 300]], 22);                 // a nick, not a cut
        expect(families(E)).toBe(1);
        descend(E, 1, 400, 300); erase(E, [[400, 220], [400, 380]], 22);
        camRestore(E, home);
        expect(families(E)).toBe(1);
        descend(E, 2, 560, 300); erase(E, [[400, 220], [400, 380]], 22);
        camRestore(E, home);
        expect(families(E)).toBe(1);
    });
});

describe("TP-9 — severing a shape that has already ceded ground elsewhere", () => {
    // Layers: topology (14) + already-cut shapes (5) + multi-layer erase (3) +
    // selection (2) + moving (6).
    //
    // The relay treats a window it did NOT come through as a bridge: ink either
    // side of it may well be joined through the child living in it, and this
    // level cannot see that child. So a band with a deep nick in it, severed
    // somewhere else entirely, must still come apart in exactly two — and the
    // nick has to end up on the correct half.
    test("the deep nick lands on the half it belongs to", () => {
        const E = mkEngine();
        drawStroke(E, [[100, 300], [700, 300]], 70);
        const home = camShot(E);
        descend(E, 2, 250, 300);
        erase(E, [[400, 200], [400, 400]], 20);       // a nick on the LEFT half
        camRestore(E, home);
        expect(families(E)).toBe(1);
        erase(E, [[500, 200], [500, 400]], 24);       // sever, to the right of it
        expect(families(E)).toBe(2);
        // Drag the right half away; the left half and its deep nick stay put.
        click(E, 620, 300);
        const rightKey = E.selection.editId;
        drag(E, [620, 300], [620, 520]);
        expect(inkAt(E, 200, 300)).toBe(true);
        click(E, 200, 300);
        expect(E.selection.editId).not.toBe(rightKey);
        descend(E, 2, 250, 300);
        expect(inkAt(E, 400, 300)).toBe(false);       // the nick, still where it was
    });
});

describe("TP-10 — a hole big enough to swallow a neighbour", () => {
    // Layers: erasing over multiple objects (10) + moving a hole over something
    // (8) + free-floating details (12) + z-order (behaviour 5).
    test("erasing through two stacked objects leaves four pieces, correctly ordered", () => {
        const E = mkEngine();
        drawStroke(E, [[150, 300], [650, 300]], 60, "#1133cc");
        drawStroke(E, [[150, 320], [650, 320]], 60, "#cc3311");   // on top, overlapping
        erase(E, [[400, 200], [400, 420]], 24);
        expect(families(E)).toBe(4);
        expect(inkAt(E, 400, 310)).toBe(false);
        // Where they overlap, the later stroke is still the one on top.
        const list = painted(E);
        const p = E.cam.screenToFrame(250, 310);
        let top = null;
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            if (pieceInks(o, p)) { top = o; break; }
        }
        expect(top).toBeTruthy();
        expect(top.color).toBe("#cc3311");
    });
});
