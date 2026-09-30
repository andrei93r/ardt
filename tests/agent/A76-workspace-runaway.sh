#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A76 The exile policy must never run away. `moveToNewWorkspace` reorders
# workspaces, Mutter emits `workspaces-reordered` synchronously, and the handler
# retiled — which called straight back into the exile policy. One window was
# exiled 160 times in a second at ~1 ms per iteration and the workspace list
# reached 86, leaving the desktop unusable (the window's clone stuck on every
# workspace). Moving a window onto a full pair with the workspace to its right
# occupied is what closes that loop.
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

# The containment must be what stopped it: either the budget/cooldown refused a
# creation, or the loop never started (a bounded count is itself the proof).
if grep -q 'ws_spawn_blocked' "$(history_file)" 2>/dev/null; then
  pass "workspace creation was refused by the containment ($(grep -c 'ws_spawn_blocked' "$(history_file)") times)"
elif [ "$(state_expr 'd["workspaces"]')" -le 4 ]; then
  pass "no runaway: the workspace count never grew past 4"
else
  fail "workspaces grew to $(state_expr 'd["workspaces"]') with no containment entry"
fi

ensure_clean
summary
