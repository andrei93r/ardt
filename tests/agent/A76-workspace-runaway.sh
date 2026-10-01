#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A76 The workspace policy must never run away. The v1 exile policy reordered
# workspaces, Mutter emitted `workspaces-reordered` synchronously, and the
# handler retiled — calling straight back into the exile policy; one window was
# exiled 160 times a second and the list reached 86. In v2 a move onto a full
# pair simply floats (§6/§34): nothing is evicted, so no loop can start. This
# asserts the bounded count and that the pair survived.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
wait_settled 15
pair_ws="$(window_field "$A" workspace)"

# A third window is exiled to the workspace to the right ...
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 15
# ... and a fourth makes that workspace a pair of its own, so the next exile has
# to append a workspace and reorder it — the reorder that used to re-enter.
spawn_window >/dev/null
wait_count 4 15 || true
wait_settled 15
D="$(list_ids | awk '{print $NF}')"
echo "test window $D; pair workspace $pair_ws"

before="$(state_expr 'd["workspaces"]')"
adrt MoveToWorkspace "$D" "$pair_ws" >/dev/null
sleep 6

poll "the workspace count stayed bounded" '
import json, sys
d = json.load(sys.stdin)
if d["workspaces"] > 8:
    print("workspaces exploded to", d["workspaces"]); sys.exit(1)
print("workspaces =", d["workspaces"], "(was '"$before"')")
' 12

poll "no two tiled windows are stacked" '
import json, sys
ids = set(int(x) for x in "'"$(list_ids)"'".split())
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["id"] in ids and w["tileable"] and not w["minimized"] and w["layer"] != 2]
for i in range(len(tiles)):
    for j in range(i + 1, len(tiles)):
        a, b = tiles[i], tiles[j]
        if a["workspace"] != b["workspace"] or a["monitor"] != b["monitor"]:
            continue
        x, y = a["rect"], b["rect"]
        if x["x"] < y["x"] + y["width"] - 2 and y["x"] < x["x"] + x["width"] - 2 \
           and x["y"] < y["y"] + y["height"] - 2 and y["y"] < x["y"] + x["height"] - 2:
            print("stacked", a["id"], x, b["id"], y); sys.exit(1)
print(len(tiles), "tiled windows, none stacked")
' 12

# Nothing is evicted: the workspace count stays bounded because a move onto a
# full workspace floats rather than creating or reordering one (§6/§34).
if [ "$(state_expr 'd["workspaces"]')" -le 4 ]; then
  pass "no runaway: the workspace count never grew past 4"
else
  fail "workspaces grew to $(state_expr 'd["workspaces"]')"
fi

poll "the moved window floated on the full workspace instead of evicting anyone" '
import json, sys
d = json.load(sys.stdin)
floats = [w for w in d["windows"] if w["layer"] == 2]
if not floats:
    print("no float: nothing took the no-room branch"); sys.exit(1)
print("floats", [w["id"] for w in floats])
' 12

ensure_clean
summary
