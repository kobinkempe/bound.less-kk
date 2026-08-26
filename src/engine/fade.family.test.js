/**
 * FF — a family group holds only pieces that are FULLY PRESENT.
 *
 * Reported 2026-08-20, from live use: "there were many examples where the shape
 * would fade out and/or just disappear", and, caught on screen a second time,
 * "the object that's fading covered the entire window".
 *
 * The fade is meant for down-pieces on their way out: a piece carries `fadeTag`
 * (its size, not an alpha) and Renderer._fade ramps it away between 0.15 px and
 * 0.3 px on screen. Opacity lives on the GROUP, and an erase family — every
 * piece sharing one `editId` — is deliberately drawn as one group so its members
 * do not seam against each other. Grouping therefore keeps a faded member OUT of
 * the family: render() sends a piece to the family only while `_fade(o) >= 1`.
 *
 * That rule is sound. What broke it is that grouping is decided in render()
 * while the fade is a function of the LIVE CAMERA, and an ordinary zoom takes
 * the camera-only path — which reapplies opacity without regrouping. So a member
 * could sink below full presence and stay in the family anyway, and the group
 * then wore its fade on everyone's behalf.
 *
 * Measured on the reported drawing: editId 158's members ran from the root frame
 * down six levels; the group's opacity came from the deepest, microscopic member
 * while the same group held the parent, 4,486,964 px across. Zooming out ramped
 * the microscopic member 1 -> 0 and took the window-filling parent with it.
 *
 * FF-1 is the invariant. FF-2 pins the other half — that a family's opacity may
 * not depend on WHICH member represents it, since which piece sorts first is an
 * accident of the bake order and the reported drawing and the fixtures here
 * happen to sort differently.
 */
import { useEngines, mkEngine, drawStroke, descend, erase } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

/** A deep erase cedes a chain: one editId with members several levels apart. */
function familyAcrossDepths(E, depth = 8) {
    drawStroke(E, [[150, 300], [650, 300]], 60, "#1133cc");
    descend(E, depth, 400, 300);
    E.setEraserSize(26);
    erase(E, [[400, 180], [400, 420]], 26);
}

/** Zoom out to a chosen level, rendering fully at each stop. */
function outTo(E, level) {
    for (let g = 0; g < 6000 && E.activeLevel > level; g++) E.zoomAt(400, 300, 40);
    E._render();
    return E.activeLevel;
}

/** Family groups that hold a member which is no longer fully present. */
function stragglers(E) {
    const out = [];
    for (const [key, entry] of E.renderer._groups) {
        if (!entry.family) continue;
        for (const o of entry.pieces) {
            const f = E.renderer._fade(o);
            if (f < 1) out.push({ key, id: o.id, fade: +f.toFixed(3), tag: o.fadeTag, inScale: E.cam.inScale });
        }
    }
    return out;
}

/** Pieces that are fully present, belong to a family, and are NOT in it. */
function exiles(E) {
    const out = [];
    for (const [key, entry] of E.renderer._groups) {
        if (entry.family) continue;
        for (const o of entry.pieces) {
            if (o.editId == null) continue;
            const f = E.renderer._fade(o);
            if (f >= 1) out.push({ key, id: o.id, editId: o.editId, tag: o.fadeTag });
        }
    }
    return out;
}

describe("FF-1 — no family group keeps a member that has started to fade", () => {
    test("stepping down through a member's fade ramp, camera-only, evicts it", () => {
        const E = mkEngine();
        familyAcrossDepths(E);
        const level = outTo(E, 5);
        expect(level).toBe(5);

        // A family here really does span depths: it holds a member whose own
        // size ramps out inside this level, alongside members that do not.
        const tags = new Set();
        for (const entry of E.renderer._groups.values()) {
            if (!entry.family) continue;
            for (const o of entry.pieces) if (o.fadeTag != null) tags.add(o.fadeTag);
        }
        expect(tags.size).toBeGreaterThan(1);

        // Now walk the zoom out in SMALL steps. Small matters: a coarse step
        // changes the visible tile rect, which forces a full render and hides
        // the bug behind the regroup it does. These steps stay on the
        // camera-only path, which is where the reported drawing lived.
        const startLevel = E.activeLevel;
        let checked = 0;
        for (let i = 0; i < 900 && E.activeLevel === startLevel; i++) {
            E.zoomAt(400, 300, 8);
            const bad = stragglers(E);
            expect([i, bad]).toEqual([i, []]);
            checked++;
        }
        expect(checked).toBeGreaterThan(100); // the sweep actually ran
    });

    test("and on the way back in a member that recovers REJOINS the family", () => {
        // The mirror invariant, and it needs stating separately: eviction and
        // readmission are the same regroup, and a guard that only fires one way
        // leaves a recovered member stranded in its own group — where it paints
        // a hairline down the tile edge against the family it belongs to.
        const E = mkEngine();
        familyAcrossDepths(E);
        outTo(E, 4);
        const startLevel = E.activeLevel;
        let checked = 0;
        for (let i = 0; i < 900 && E.activeLevel === startLevel; i++) {
            E.zoomAt(400, 300, -8);
            expect([i, stragglers(E)]).toEqual([i, []]);
            expect([i, exiles(E)]).toEqual([i, []]);
            checked++;
        }
        expect(checked).toBeGreaterThan(100);
    });
});

describe("FF-2 — a family's opacity does not depend on which member speaks for it", () => {
    test("a microscopic member cannot drag the family's opacity down", () => {
        // Which piece lands at pieces[0] is an accident of the bake order, so a
        // group that reads its opacity off one member is a bug whether or not
        // today's ordering happens to expose it. On the reported drawing the
        // deepest member sorted first; in this fixture a native does — so the
        // representative is supplied here rather than waited for.
        //
        // This is the belt-and-braces half of the fix: even if a regroup is ever
        // missed again, a family group is painted at full presence and the
        // window-filling parent survives.
        const E = mkEngine();
        familyAcrossDepths(E);
        outTo(E, 5);

        let families = 0;
        for (const [key, entry] of E.renderer._groups) {
            if (!entry.family) continue;
            families++;
            const rep = entry.pieces[0];
            const want = rep.opacity == null ? 1 : rep.opacity;
            for (const o of entry.pieces) {
                // the member as it is, and the same member gone microscopic
                E.renderer._applyOpacity(entry, o);
                expect([key, o.id, "as-is", +entry.group.opacity.toFixed(6)]).toEqual([key, o.id, "as-is", want]);
                E.renderer._applyOpacity(entry, { ...o, fadeTag: 1e-9 });
                expect([key, o.id, "microscopic", +entry.group.opacity.toFixed(6)]).toEqual([key, o.id, "microscopic", want]);
            }
        }
        expect(families).toBeGreaterThan(0);
    });
});
