#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A73 A drag whose release signal never arrives (a lost grab-op-end: an overview
# drag, a Shell restart) must not disable tiling forever. Every path — reconcile,
# coherence sweep, periodic retile — skips while a drag is in flight, so a stuck
# drag used to freeze the layout until the user dragged something else.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
wait_settled 15

# Begin a drag, move the window, and never release it.
adrt BeginDrag "$A" >/dev/null
adrt MoveWindow "$A" 20 60 500 500 >/dev/null
sleep 5

poll "the abandoned drag is cleared and the pair is tiled again" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = (w["rect"] for w in sorted(ws, key=lambda w: w["rect"]["x"]))
if a["x"] + a["width"] > b["x"] + 2:
    print("overlap:", a, b); sys.exit(1)
if abs(a["height"] - b["height"]) > 4:
    print("not a full-height pair:", a, b); sys.exit(1)
sys.exit(0)
' 12

# The abandoned drop must not be interpreted: the pair keeps its 50/50 split.
check_python "the abandoned drop did not change the split ratio" '
import json, sys
d = json.load(sys.stdin)
ws = sorted([w["rect"] for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2], key=lambda r: r["x"])
if len(ws) == 2 and abs(ws[0]["width"] - ws[1]["width"]) > 4:
    print("split skewed:", ws); sys.exit(1)
print("ratio untouched (ratios=%s)" % d["ratios"])
'

ensure_clean
summary
