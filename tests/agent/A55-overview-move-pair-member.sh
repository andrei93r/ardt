#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A55 Overview move of a pair member onto a workspace holding one window: the
# target becomes a pair, the origin's survivor is left alone, and neither
# workspace is left with a stacked extra.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

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
echo "A=$A B=$B on ws$pair_ws, third=$third on ws$third_ws"

if [ "$third_ws" = "$pair_ws" ]; then
  skip "the third window did not take its own workspace"
  ensure_clean
  summary
  exit 0
fi

# Move a pair member onto the workspace that holds the lone window.
adrt MarkWorkspaceCached "$B" "$third_ws" >/dev/null
adrt MoveToWorkspace "$B" "$third_ws" >/dev/null
wait_settled 20

check_python "the target workspace tiled into a pair" '
import json, sys
d = json.load(sys.stdin)
here = [w for w in d["windows"]
        if w["tileable"] and not w["minimized"] and w["layer"] != 2 and w["workspace"] == int("'"$third_ws"'")]
if len(here) != 2:
    print("target holds", len(here), "tiles"); sys.exit(1)
a, b = here[0]["rect"], here[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    print("still stacked", a, b); sys.exit(1)
print("target tiled", [w["rect"] for w in here])
'

check_python "the origin workspace left its survivor alone" '
import json, sys
d = json.load(sys.stdin)
here = [w for w in d["windows"] if w["tileable"] and w["workspace"] == int("'"$pair_ws"'")]
if len(here) != 1:
    print("origin holds", len(here), "windows"); sys.exit(1)
if not here[0]["maximized"]:
    print("origin survivor not maximized"); sys.exit(1)
print("origin survivor maximized")
'

check_python "no workspace holds a stacked extra" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
by_ws = {}
for w in tiles:
    by_ws.setdefault(w["workspace"], []).append(w)
for ws, group in by_ws.items():
    if len(group) > 2:
        print("workspace", ws, "holds", len(group), "tiles"); sys.exit(1)
print({ws: len(g) for ws, g in by_ws.items()})
'

ensure_clean
summary
