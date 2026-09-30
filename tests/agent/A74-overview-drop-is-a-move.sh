#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A74 An overview-style drop scales the window as well as moving it. Reading that
# as an inner-edge resize saved a bogus split ratio for the app pair, which then
# persisted — the pair came back skewed instead of 50/50 forever after. A size
# change on both axes is a move, never a resize.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
wait_settled 15

ratios_before="$(state_expr 'json.dumps(d["ratios"], sort_keys=True)')"

# Drag the window in a way that changes position *and* size, as the overview does.
adrt BeginDrag "$A" >/dev/null
adrt MoveWindow "$A" 20 60 500 500 >/dev/null
adrt EndDrag "$A" >/dev/null
wait_settled 15

poll "the drop is treated as a move: the pair is even and full height" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = (w["rect"] for w in sorted(ws, key=lambda w: w["rect"]["x"]))
if abs(a["width"] - b["width"]) > 4:
    print("split skewed:", a, b); sys.exit(1)
if a["x"] + a["width"] > b["x"] + 2:
    print("overlap:", a, b); sys.exit(1)
sys.exit(0)
' 12

check_python "no split ratio was learned from the drop" '
import json, sys
d = json.load(sys.stdin)
after = json.dumps(d["ratios"], sort_keys=True)
before = json.dumps(json.loads("'"$ratios_before"'"), sort_keys=True)
if after != before:
    print("ratios changed: %s -> %s" % (before, after)); sys.exit(1)
print("ratios unchanged:", after)
'

ensure_clean
summary
