# -*- coding: utf-8 -*-
"""Correct the Code Map rows that name functions the source no longer has.

Nineteen edits against the hand-authored pristine page. Two kinds:

  - functions deleted in the 2026-08-28 sweep (`cutById`, `restyleById`, the
    LevelMap depth facade, `tileIndexOf`), whose rows outlived them;
  - names that were wrong when written (`boundaryChain`, `arcPath`,
    `validEdgeRec`, `_anchorOf`, `_maxContentDepth`, `pointAtT`, `isFatEver`,
    `_eraserRadiusPx`, `_selectedIds`, `_rect`), plus `reverseLoop` and
    `levelPointToScreen` attributed to the wrong file.

Run against the pristine page, before expand_codemap.py. `audit_stale.py`
proves the result.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "boundless-code-map.pristine.html")
DOT = u"·"

# (what to find, what to put there, why) - the find string is matched exactly,
# once, so a silent miss is impossible.
EDITS = [
    # ---- deleted in the 2026-08-28 sweep ---------------------------------
    (u'<td class="fn">tileIndexOf(phi, x)</td>',
     None,
     "tileIndexOf went with the erase-window refactor; nothing imported it"),
    (u'<td class="fn wide">restyleById(id, patch)</td><td class="wt">Colour, opacity, width.</td><td class="ref"></td>',
     None, "restyleById deleted with the selection style box"),
    (u'<td class="fn wide">cutById(id, runs)</td>',
     None, "cutById superseded by eraseReplaceById"),
    (u'_recOf %s records %s get %s has<br>ensureUp %s ensureDown' % (DOT, DOT, DOT, DOT),
     u'_recOf %s records' % DOT,
     "get/has/ensureUp/ensureDown deleted; only the record view is left"),
    (u'The legacy per-depth record view, which snapshots, scenes and the dev tools still speak.',
     u'The legacy per-depth record view, which snapshots, scenes and the dev '
     u'tools still speak. The four accessors that used to sit beside it '
     u'(<code>get</code>, <code>has</code>, <code>ensureUp</code>, '
     u'<code>ensureDown</code>) went in the 2026-08-28 sweep: the frame '
     u'lattice made every one of them a wrapper around <code>frameFor</code>.',
     "context: why the row is shorter than it was"),
    (u'frame %s depthOf %s parentOf<br>childrenOf %s spineAt<br>pathFrameAt %s allFrames' % (DOT, DOT, DOT, DOT),
     u'frame %s depthOf %s parentOf<br>childrenOf %s spineAt %s pathFrameAt' % (DOT, DOT, DOT, DOT),
     "allFrames deleted"),
    (u'makeGrid %s grid %s tileRect<br>tileRange %s frameRect' % (DOT, DOT, DOT),
     u'makeGrid %s grid %s tileRect %s tileRange' % (DOT, DOT, DOT),
     "frameRect deleted"),
    # ---- attributed to the wrong file ------------------------------------
    (u'<td class="fn wide">mapPoint %s mapRect<br>framePointToScreen<br>levelPointToScreen</td><td class="wt">The depth-int facade over the same transforms.</td>' % DOT,
     u'<td class="fn wide">framePointToScreen(...)</td><td class="wt">A point in one frame, in <em>screen</em> pixels: <code>mapPointF</code> into the active frame, then the in-frame zoom and pan. The depth-keyed wrappers that used to sit beside it are gone; <code>Camera.levelPointToScreen</code> is the one caller and it passes a frame id.</td>',
     "mapPoint/mapRect deleted; levelPointToScreen is Camera's, not LevelMap's"),
    (u'<td class="fn">reversePiece %s reverseLoop</td>' % DOT,
     u'<td class="fn">reversePiece(p)</td>',
     "reverseLoop is arcShape's, and the arcShape article already lists it"),
    # ---- wrong when written ----------------------------------------------
    (u'<td class="fn">validEdgeRec<br>decodeCrossings(cr)</td>',
     u'<td class="fn">decodeCrossings(cr)</td>',
     "no validEdgeRec: decodeCrossings validates inline, field by field"),
    (u'<td class="fn">arcPath %s tracePath</td>' % DOT,
     u'<td class="fn">tracePath(ctx, gaps, flatTol)</td>',
     "no arcPath"),
    (u'boundaryChain(centre, r)<br>ChainBuilder: constructor<br>',
     u'ChainBuilder(centre, r): constructor<br>',
     "no boundaryChain: the ChainBuilder IS the boundary chain"),
    (u'<td class="fn">_depth %s _minContentDepth<br>_maxContentDepth</td>' % DOT,
     u'<td class="fn">_depth %s _minContentDepth</td>' % DOT,
     "no _maxContentDepth"),
    (u'_fitDash %s _poolTo %s _rect<br>' % (DOT, DOT),
     u'_fitDash %s _poolTo<br>' % DOT,
     "no _rect on the Renderer"),
    (u'<td class="fn">tOfPoint %s pointAtT<br>arcOverlaps</td>' % DOT,
     u'<td class="fn">tOfPoint %s arcOverlaps</td>' % DOT,
     "no pointAtT"),
    (u'<td class="fn">isFatEver %s strokeLoops</td><td class="wt">The display gate, and the loops the renderer paints for a wide stroke' % DOT,
     u'<td class="fn">strokeLoops(o, cfg, opts)</td><td class="wt">The loops the renderer paints for a wide stroke',
     "no isFatEver here - the display gate is the Renderer's _fatEver"),
    (u'_eraserRadiusPx %s setEraserSize<br>' % DOT,
     u'setEraserSize(px)<br>',
     "no _eraserRadiusPx: the size lives in the _eraserPx field"),
    (u'_selectedIds %s _isSelected<br>' % DOT,
     u'_isSelected(o)<br>',
     "no _selectedIds: the ids live on this.selection.ids"),
    (u'<td class="fn wide">_selectionRect %s _anchorOf</td><td class="wt">The selection box and the drag anchor.</td>' % DOT,
     u'<td class="fn wide">_selectionRect()</td><td class="wt">The selection box the Renderer draws, in the active frame.</td>',
     "no _anchorOf"),
    # ---- notation that reads as a claim ----------------------------------
    (u'activeLevel <em>get/set</em><br>',
     u'activeLevel <em>(get / set)</em><br>',
     "the bare words get and set read as two method names"),
    (u'<td class="fn wide">LevelIndex.add / .remove</td>',
     u'<td class="fn wide">LevelIndex: add(o, level)</td>',
     "remove has its own row, with the stale-box subtlety on it"),
]


def main():
    s = io.open(SRC, encoding="utf-8").read()
    if "The four accessors that used to sit beside it" in s:
        print("already applied - restore the pristine page first")
        return 1
    n = 0
    for find, repl, why in EDITS:
        c = s.count(find)
        if c != 1:
            print("  !! %d matches for: %s" % (c, find[:70]))
            continue
        if repl is None:
            # delete the whole <tr> the fragment sits in
            i = s.index(find)
            lo = s.rindex("<tr", 0, i)
            lo = s.rindex("\n", 0, lo) + 1
            hi = s.index("</tr>", i) + len("</tr>\n")
            s = s[:lo] + s[hi:]
        else:
            s = s.replace(find, repl, 1)
        n += 1
        print("  ok  %s" % why)
    io.open(SRC, "w", encoding="utf-8").write(s)
    print("applied %d of %d edits -> %s" % (n, len(EDITS), os.path.basename(SRC)))
    return 0 if n == len(EDITS) else 1


if __name__ == "__main__":
    sys.exit(main())
