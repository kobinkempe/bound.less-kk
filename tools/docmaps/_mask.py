# -*- coding: utf-8 -*-
"""Blank out string and comment bodies without moving a single offset.

Its own module, and deliberately importing NOTHING, because both audits need it
and one of them cannot import the other: `audit_entries` pulls in `graph`, which
validates the whole hand-edge list at import time and raises if anything has
moved. A helper that cannot be imported during a refactor is a helper that gets
copied, and this one was copied once already.

WHY MASK RATHER THAN STRIP. An earlier version of `audit_entries` ran the source
through a strip that DELETED string bodies, so
`addEventListener("pointerdown", down)` became `addEventListener(, down)` and not
one pointer entry was ever found. Quotes and comment markers stay here and only
their contents become spaces, so offsets are identical to the original and a
regex can be run on either text interchangeably - match a name on the raw
source, count braces on the masked one.

It also matters for judging what is test-only: a header comment saying a
function has no production caller left is not a use of that function, and
counting it as one is what kept `clipPolysToRect` off that list.
"""


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
                if i + 1 < n:
                    out[i + 1] = " "
                i += 2
                continue
            if c == q:
                q = None
            elif c != "\n":
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
        i += 1
    return "".join(out)
