#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A37 Overview suspends tiling: while the overview is open, windows are not
# re-tiled; closing it re-tiles once.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
adrt ActivateWindow "$a" >/dev/null
sleep 1

assert_true "overview opens" "$(adrt SimulateOverview true | python3 "$PARSE")"
sleep 1

# Move a window out of place; tiling is suspended, so it must stay put.
adrt MoveWindow "$a" 300 300 400 300 >/dev/null
sleep 2
check_python "window stayed put while the overview was open" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$a"'")]
if not w:
    print("window gone"); sys.exit(1)
x = w[0]["rect"]["x"]
if abs(x - 300) > 8:
    print("tiling ran during the overview; x =", x); sys.exit(1)
print("x", x)
'

assert_true "overview closes" "$(adrt SimulateOverview false | python3 "$PARSE")"
sleep 3
check_python "window was re-tiled after the overview closed" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
w = [x for x in d["windows"] if x["id"] == int("'"$a"'")]
if not w:
    print("window gone"); sys.exit(1)
r = w[0]["rect"]
if abs(r["x"] - 300) <= 8:
    print("still at 300; not re-tiled"); sys.exit(1)
if r["x"] < area["x"] - 1 or r["x"] + r["width"] > area["x"] + area["width"] + 1:
    print("out of area", r); sys.exit(1)
print("re-tiled at", r["x"], r["width"])
'

ensure_clean
summary
