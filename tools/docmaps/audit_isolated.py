# -*- coding: utf-8 -*-
"""Why does nothing call this function?

`extract.py` drops any call it cannot resolve to a definite target, so a node
with no INCOMING edge means NOT PROVEN, never NOT THERE. That is the honest
position, but it is useless to a reader who wants to know what is actually
dead. This sorts those nodes by why, so the page can say something specific.

THE TEST IS IN-DEGREE, NOT DEGREE. An earlier version of this script asked
which nodes had no edges AT ALL, and so never looked at a function that calls
something but is called by nothing - which is exactly what an abandoned
function looks like. `clipperOutline.clipPolysToRect` is the worked example: it
has one outgoing edge, no incoming one, no production caller, and the file
header says so. Asking the wrong question hid it and 149 others.

Buckets, in the order they are tested:

  getter/setter     `get x()` / `set x()`. Read as a property, so there is no
                    `x(` anywhere to find. The extractor CANNOT see these.
  language protocol the RUNTIME calls it: `JSON.stringify(range)` invokes
                    `toJSON` with the name appearing nowhere.
  called via object `foo.bar()` on a field or local the extractor does not
                    resolve - the four instrument classes are all reached as
                    `eng.eventLatency.report()` from the hook.
  React component   rendered as `<Foo />`, never called as `Foo(`.
  passed as value   named without being called: a callback, an export, a
                    default. Something holds it, so it is not unreferenced.
  test only         referenced only from *.test.js.
  UNREFERENCED      the name appears nowhere but its own definition.

Only the last bucket is a candidate for deletion, and even then check by hand:
a route component or a public export can be genuinely unreferenced and still
load-bearing.
"""
import io, os, re, json, sys, collections

import os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(REPO, "src")

sys.path.insert(0, HERE)
import graph
import _mask


def all_files():
    out = []
    for root, _d, fs in os.walk(SRC):
        for f in sorted(fs):
            if f.endswith(".js"):
                out.append(os.path.join(root, f).replace("\\", "/"))
    return out


def main():
    data = json.load(open(os.path.join(HERE, "data", "graphdata.json")))
    MODFILE = data["modfile"]
    U = data["universe"]

    indeg = collections.Counter()
    outdeg = collections.Counter()
    for a, b in graph.E:
        indeg[b] += 1
        outdeg[a] += 1
    iso = [n for n in graph.nodes() if not indeg[n]]

    texts = {}
    for p in all_files():
        texts[p] = io.open(p, encoding="utf-8", errors="replace").read()
    prod = {p: t for p, t in texts.items()
            if ".test." not in p and "__testkit__" not in p}

    # Names the LANGUAGE calls, never the code. `JSON.stringify(range)` invokes
    # toJSON with the name appearing nowhere - no static call graph can see it.
    MAGIC = {"toJSON", "toString", "valueOf", "then", "iterator"}

    buckets = collections.OrderedDict(
        (k, []) for k in ("getter/setter", "language protocol", "called via object",
                          "React component", "passed as value", "test only",
                          "UNREFERENCED"))

    for n in iso:
        mod, rest = n.split(".", 1)
        leaf = rest.split(".")[-1]
        own = os.path.join(REPO, MODFILE[mod]).replace("\\", "/")
        own_src = texts.get(own, "")

        # 1. an accessor is read, never called - there is no call syntax to find
        if re.search(r'\b(?:get|set)\s+' + re.escape(leaf) + r'\s*\(', own_src):
            buckets["getter/setter"].append(n)
            continue

        # 2. the RUNTIME calls it, not the code. `JSON.stringify(range)` invokes
        # toJSON with the name appearing nowhere; the round trip here is real -
        # pick.js builds a UserPreferenceRange into the scale session, the
        # session is stringified with the canvas, and session.js rehydrates it
        # through toUserRange on the way back.
        if leaf in MAGIC:
            buckets["language protocol"].append(n)
            continue

        # anything outside the defining file that mentions the name
        elsewhere_prod = [p for p, t in prod.items()
                          if p != own and re.search(r'\b' + re.escape(leaf) + r'\b', t)]
        elsewhere_test = [p for p, t in texts.items()
                          if ".test." in p and re.search(r'\b' + re.escape(leaf) + r'\b', t)]

        if elsewhere_prod:
            hit = "\n".join(prod[p] for p in elsewhere_prod)
            if re.search(r'[A-Za-z_$][\w$]*\s*\.\s*' + re.escape(leaf) + r'\s*\(', hit):
                buckets["called via object"].append(n)
            elif re.search(r'<\s*' + re.escape(leaf) + r'[\s/>]', hit):
                buckets["React component"].append(n)
            else:
                buckets["passed as value"].append(n)
            continue

        # called or rendered inside its OWN file, by something the extractor
        # could not attribute to a definition
        if re.search(r'<\s*' + re.escape(leaf) + r'[\s/>]', own_src):
            buckets["React component"].append(n)
            continue
        uses = len(re.findall(r'\b' + re.escape(leaf) + r'\b', own_src))
        if uses > 1 and re.search(r'[A-Za-z_$][\w$]*\s*\.\s*' + re.escape(leaf) + r'\s*\(', own_src):
            buckets["called via object"].append(n)
            continue

        if elsewhere_test:
            buckets["test only"].append(n)
            continue
        if uses > 1:
            buckets["passed as value"].append(n)
            continue
        buckets["UNREFERENCED"].append(n)

    print("NOTHING CALLS THEM: %d of %d  (%d have no edge at all)\n"
          % (len(iso), len(graph.nodes()),
             len([n for n in iso if not outdeg[n]])))
    for k, v in buckets.items():
        print("%-18s %3d" % (k, len(v)))
    print()
    for k, v in buckets.items():
        if not v:
            continue
        print("---- %s (%d)" % (k, len(v)))
        for i in range(0, len(v), 3):
            print("     " + "  ".join("%-34s" % x for x in v[i:i + 3]))
        print()
    json.dump({k: v for k, v in buckets.items()},
              open(os.path.join(HERE, "data", "isolated.json"), "w"), indent=1)

    # ---- test-only, over EVERY node, not just the uncalled ones ---------
    # The bucket above only sees functions nothing calls. A helper called by
    # another test-only function has an incoming edge and would be missed, so
    # the page would grey out half a group and leave the rest looking live.
    #
    # The test is textual and deliberately CONSERVATIVE: no reference in any
    # non-test file other than the one that defines it, and at least one
    # reference from a suite. A function used inside its own file by
    # production code therefore stays production, which is the right way to be
    # wrong - greying something out is a strong claim to make.
    masked = {p: _mask.mask(t) for p, t in prod.items()}
    testonly = []
    for n in graph.nodes():
        mod, rest = n.split(".", 1)
        leaf = rest.split(".")[-1]
        own = os.path.join(REPO, MODFILE[mod]).replace("\\", "/")
        pat = re.compile(r'\b' + re.escape(leaf) + r'\b')
        if any(p != own and pat.search(t) for p, t in prod.items()):
            continue
        if not any(".test." in p and pat.search(t) for p, t in texts.items()):
            continue
        # and nothing in its own file except the definition itself, counted on
        # the MASKED source - a header comment naming the function is not a use
        # of it. That distinction matters: `clipPolysToRect` says in its own
        # file that it has no production caller left, and counting that
        # sentence as a caller is what kept it off this list.
        if len(pat.findall(masked.get(own, ""))) > 1:
            continue
        testonly.append(n)
    print("")
    print("test-only across the whole graph: %d" % len(testonly))
    for i in range(0, len(testonly), 3):
        print("     " + "  ".join("%-34s" % x for x in testonly[i:i + 3]))
    json.dump(sorted(testonly),
              open(os.path.join(HERE, "data", "testonly.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
