#!/usr/bin/env bash
# Generated with AI for personal use.
# S13 Moving a window between workspaces the way the overview does: both the
# origin and the target workspace must be retiled, with nothing left stacked.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 2
read -r A B <<<"$(test_pair_by_x)"
pair_ws="$(window_workspace "$A")"
echo "pair $A $B on ws$pair_ws"

# A third window takes its own workspace to the right.
spawn
wait_tests 3 15 || true
sleep 2
read -r third third_ws <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
ws = [w for w in d["windows"] if w["id"] in ids]
top = max(w["workspace"] for w in ws)
w = [x for x in ws if x["workspace"] == top][0]
print(w["id"], top)')"
echo "third $third on ws$third_ws"

if [ "$third_ws" = "$pair_ws" ]; then
  skip "the third window did not take its own workspace"
  summary
  exit 0
fi

# Move it onto the pair's workspace, exactly as an overview drag does (straight
# through Mutter, so the extension only sees `workspace-changed`).
adrt MoveToWorkspace "$third" "$pair_ws" >/dev/null

TEST_IDS="$(test_ids)" poll "both workspaces retiled, nothing stacked" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["id"] in ids and w["tileable"] and not w["minimized"] and w["layer"] != 2]
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
' 20

check_python "the newcomer is on the pair's workspace, on top and not lost" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("newcomer gone"); sys.exit(1)
w = w[0]
if w["workspace"] != int("'"$pair_ws"'"):
    print("on ws", w["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if w["layer"] != 2:
    print("not floating (layer", w["layer"], ")"); sys.exit(1)
print("floats on the pair")
'

check_python "the origin workspace was emptied" '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
here = [w for w in d["windows"] if w["id"] in ids and w["workspace"] == int("'"$third_ws"'")]
if here:
    print("origin still holds", [(w["id"], w["rect"]) for w in here]); sys.exit(1)
print("empty")
'

# And the reverse: move a pair member onto a workspace that holds one window.
# Both workspaces must retile (the target becomes a pair; the origin's survivor
# is left alone on its workspace).
adrt MoveToWorkspace "$A" "$third_ws" >/dev/null
TEST_IDS="$(test_ids)" poll "moving a pair member away retiled both workspaces" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["id"] in ids and w["tileable"] and not w["minimized"] and w["layer"] != 2]
by_ws = {}
for w in tiles:
    by_ws.setdefault(w["workspace"], []).append(w)
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
' 20

summary
