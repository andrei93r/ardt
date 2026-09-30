#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A54 Overview move onto a full pair: dragging a window from its own workspace
# onto a workspace that already holds a pair retiles both workspaces and never
# leaves the newcomer stacked as a fake tile.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
pair_ws="$(window_field "$A" workspace)"

# Third window gets its own workspace to the right.
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15
wait_python 25 '
import json, sys
d = json.load(sys.stdin)
ws = [w["workspace"] for w in d["windows"] if w["tileable"]]
sys.exit(0 if ws and max(ws) > int("'"$pair_ws"'") else 1)' || true
read -r third third_ws <<<"$(dump | python3 -c '
import json,sys
ws = [w for w in json.load(sys.stdin)["windows"] if w["tileable"]]
top = max(w["workspace"] for w in ws)
w = [x for x in ws if x["workspace"] == top][0]
print(w["id"], top)')"
echo "pair on ws$pair_ws, third $third on ws$third_ws"

# Drag it onto the pair's workspace, the way the overview does. During such a
# drag our per-frame refresh copies the new workspace into the surface cache
# before the `workspace-changed` signal arrives, so simulate that: the handler
# must still notice the move and retile both workspaces.
adrt MarkWorkspaceCached "$third" "$pair_ws" >/dev/null
adrt MoveToWorkspace "$third" "$pair_ws" >/dev/null
wait_settled 20

check_python "both workspaces retiled, nothing stacked" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
by_ws = {}
for w in tiles:
    by_ws.setdefault(w["workspace"], []).append(w)
if len(by_ws.get(int("'"$pair_ws"'"), [])) != 2:
    print("pair workspace holds", len(by_ws.get(int("'"$pair_ws"'"), [])), "tiles"); sys.exit(1)
for ws, group in by_ws.items():
    if len(group) > 2:
        print("workspace", ws, "holds", len(group), "tiles"); sys.exit(1)
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i]["rect"], group[j]["rect"]
            if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
               and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
                print("stacked on ws", ws, group[i]["id"], a, group[j]["id"], b); sys.exit(1)
print("tiles per workspace", {ws: len(g) for ws, g in by_ws.items()})
'

check_python "the newcomer was resolved (floated on top, not lost)" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("newcomer gone"); sys.exit(1)
w = w[0]
if w["workspace"] != int("'"$pair_ws"'"):
    print("newcomer on ws", w["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if w["layer"] != 2:
    print("newcomer not floating (layer", w["layer"], ")"); sys.exit(1)
print("newcomer floats on the pair")
'

check_python "the old workspace was emptied" '
import json, sys
d = json.load(sys.stdin)
here = [w for w in d["windows"] if w["workspace"] == int("'"$third_ws"'")]
if here:
    print("old workspace still holds", [(w["id"], w["rect"]) for w in here]); sys.exit(1)
print("old workspace empty")
'

ensure_clean
summary
