# -*- coding: utf-8 -*-
"""Blank out string, regex and comment bodies without moving a single offset.

Its own module, and deliberately importing NOTHING, because every reader of the
source needs it (`inventory`, `extract` and both audits) and one of them cannot
import the others: `audit_entries` pulls in `graph`, which validates the whole
hand-edge list at import time and raises if anything has moved.

WHY MASK RATHER THAN STRIP. An earlier version of `audit_entries` ran the source
through a strip that DELETED string bodies, so
`addEventListener("pointerdown", down)` became `addEventListener(, down)` and not
one pointer entry was ever found. Quotes and comment markers stay here and only
their contents become spaces, so offsets are identical to the original and a
regex can be run on either text interchangeably - match a name on the raw
source, count braces on the masked one.

Three things the brace count depends on (2026-09-22):
  - an inline `/* ... */` is a comment even mid-line. `{ /* the frame's mark */ }`
    in selection.js read as an open string that swallowed the `}` and hid 31
    methods from the inventory;
  - a quote or double-quote string ends at the line's end, so an apostrophe in
    JSX text damages one line, never the rest of the file;
  - a regex literal (`/[{'"]/`) is masked like a string. A `/` starts one only
    after an operator, an opening bracket or `return`/`typeof`/`case`, and only
    when it closes on the same line - so JSX's `</a>` and `<b />` stay code.
"""

_REGEX_BEFORE = set("(,=:[!&|?;{+-*%~^")
_REGEX_WORDS = ("return", "typeof", "case", "throw", "void", "delete", "in", "of")


def _prev_sig(out, i):
    """The last non-space character already emitted before i, and the word it ends."""
    j = i - 1
    while j >= 0 and out[j] in " \t\r\n":
        j -= 1
    if j < 0:
        return "", ""
    k = j
    while k >= 0 and (out[k].isalnum() or out[k] in "_$"):
        k -= 1
    return out[j], "".join(out[k + 1:j + 1])


def _regex_end(src, i, n):
    """The index of the closing `/` of a regex starting at i, or -1."""
    j, cls = i + 1, False
    while j < n:
        c = src[j]
        if c == "\n":
            return -1
        if c == "\\":
            j += 2
            continue
        if cls:
            if c == "]":
                cls = False
        elif c == "[":
            cls = True
        elif c == "/":
            return j if j > i + 1 else -1
        j += 1
    return -1


def mask(src):
    out = list(src)
    i, n, q, line_c, block_c = 0, len(src), None, False, False
    while i < n:
        c = src[i]
        if line_c:
            if c == "\n":
                line_c = False
            else:
                out[i] = " "
        elif block_c:
            if c == "*" and i + 1 < n and src[i + 1] == "/":
                out[i] = out[i + 1] = " "
                i += 2
                block_c = False
                continue
            if c != "\n":
                out[i] = " "
        elif q:
            if c == "\\":
                out[i] = " "
                if i + 1 < n and src[i + 1] != "\n":
                    out[i + 1] = " "
                i += 2
                continue
            if c == q:
                q = None
            elif c == "\n":
                if q != "`":
                    q = None
            else:
                out[i] = " "
        elif c in "\"'`":
            q = c
        elif c == "/" and i + 1 < n and src[i + 1] == "/":
            line_c = True
            out[i] = out[i + 1] = " "
            i += 2
            continue
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            block_c = True
            out[i] = out[i + 1] = " "
            i += 2
            continue
        elif c == "/":
            ch, word = _prev_sig(out, i)
            if ch == "" or ch in _REGEX_BEFORE or word in _REGEX_WORDS:
                e = _regex_end(src, i, n)
                if e > 0:
                    for k in range(i + 1, e):
                        out[k] = " "
                    i = e + 1
                    continue
        i += 1
    return "".join(out)
