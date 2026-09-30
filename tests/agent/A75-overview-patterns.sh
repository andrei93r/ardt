#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A75 The two overview patterns that used to leave windows stacked: opening and
# closing the overview with a pair tiled, and moving one member to another
# workspace from the overview. Both must leave every workspace tiled.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
wait_settled 15

# Pattern 1: open the overview and close it again.
adrt SimulateOverview true >/dev/null
sleep 2
adrt SimulateOverview false >/dev/null
poll "the pair is still tiled after the overview is closed" '
import json, sys
d = json.load(sys.stdin)
if d["overview"]:
    print("overview still open"); sys.exit(1)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = (w["rect"] for w in sorted(ws, key=lambda w: w["rect"]["x"]))
if a["x"] + a["width"] > b["x"] + 2:
    print("stacked:", a, b); sys.exit(1)
sys.exit(0)
' 12

# Pattern 2: move one member to another workspace from the overview.
adrt SimulateOverview true >/dev/null
sleep 1
adrt MoveToWorkspace "$A" 1 >/dev/null
adrt SimulateOverview false >/dev/null
poll "both workspaces are left tiled after the overview move" '
import json, sys
d = json.load(sys.stdin)
if d["overview"]:
    print("overview still open"); sys.exit(1)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
byws = {}
for w in tiles:
    byws.setdefault(w["workspace"], []).append(w["rect"])
for ws, rects in byws.items():
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
               and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
                print("stacked on ws", ws, a, b); sys.exit(1)
if len(byws) < 2:
    print("the move did not separate the windows:", byws); sys.exit(1)
sys.exit(0)
' 15

ensure_clean
summary
