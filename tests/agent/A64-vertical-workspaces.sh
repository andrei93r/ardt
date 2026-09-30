#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A64 Vertical workspaces (V-Shell / Vertical Workspaces compatibility): the
# extension picks up the layout orientation, so a pair splits 50/50 top/bottom
# and moving a window up/down swaps it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# The nested screen is small (1280x800): a stacked split leaves ~390 px each,
# below the test windows' minimum height, so the planner would (correctly) fall
# back to side by side. Ignore min sizes so the axis itself is what is tested.
set_setting min-size-policy ignore

if ! adrt SimulateWorkspaceOrientation true | grep -q true; then
  skip "orientation override unsupported by this build"
  ensure_clean
  summary
  exit 0
fi

poll "the workspace layout reports vertical" '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("workspaceLayoutRows") == -1 else 1)
' 8

open_pair
wait_settled 15

poll "the pair is stacked top/bottom" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = sorted(ws, key=lambda w: w["rect"]["y"])[0]["rect"], sorted(ws, key=lambda w: w["rect"]["y"])[1]["rect"]
if abs(a["x"] - b["x"]) > 2:
    print("not stacked: x", a["x"], b["x"]); sys.exit(1)
if a["y"] + a["height"] > b["y"] + 2:
    print("overlap: ", a, b); sys.exit(1)
if abs(a["height"] - b["height"]) > 4:
    print("not even: heights", a["height"], b["height"]); sys.exit(1)
sys.exit(0)
' 15

read -r A B <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and w["layer"] != 2]
ws.sort(key=lambda w: w["rect"]["y"])
print(ws[0]["id"], ws[1]["id"])')"

adrt ActivateWindow "$A" >/dev/null
adrt MoveDirection down >/dev/null
poll "move down swaps the stacked pair" '
import json, sys
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["y"] for w in d["windows"]}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window missing"); sys.exit(1)
sys.exit(0 if by[a] > by[b] else 1)
' 12

adrt SimulateWorkspaceOrientation false >/dev/null
poll "back to horizontal the pair is side by side" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
if abs(ws[0]["rect"]["y"] - ws[1]["rect"]["y"]) > 2:
    print("not side by side", ws[0]["rect"], ws[1]["rect"]); sys.exit(1)
sys.exit(0)
' 15

set_setting min-size-policy respect
ensure_clean
summary
