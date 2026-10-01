#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A25 Settings change: the extension reacts to a GSettings change.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
original="$(get_setting gaps-base)"
set_setting gaps-base 24
sleep 1
open_pair

# §10: `gaps-base` is the split gap; the outer edges are flush (0) by default,
# so the tiles touch the work area on the outside and leave 24px between them.
check_python "gap change took effect (flush edges, 24px split)" '
import json, sys
d = json.load(sys.stdin)
ws = sorted((w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2), key=lambda w: w["rect"]["x"])
if len(ws) < 2:
    print("only", len(ws), "tiles"); sys.exit(1)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
a, b = ws[0]["rect"], ws[1]["rect"]
outer = a["x"] - area["x"]
split = b["x"] - (a["x"] + a["width"])
if outer != 0:
    print("outer left", outer, "expected 0 (flush)"); sys.exit(1)
if abs(split - 24) > 1:
    print("split", split, "expected 24"); sys.exit(1)
print("flush edges, split", split)
'

set_setting gaps-base "$original"
sleep 1
ensure_clean
summary
