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
# The move acts on the focused window: wait until it really is A, otherwise a
# loaded shell moves the wrong one (or nothing) and the poll times out.
if ! wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin)['focused'] == $A else 1)"; then
  fail "the focus did not land on the window before the move"
fi
adrt MoveDirection down >/dev/null
# The keyboard move is recorded as a swap; assert the decision too, so a slow
# apply cannot hide whether the move was understood at all.
swapped=0
for _ in $(seq 1 20); do
  if adrt DumpDecisions 200 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c "
import json, sys
entries = json.load(sys.stdin)
a, b = int('$A'), int('$B')
sys.exit(0 if any(e.get('event') == 'swap' and {e.get('a'), e.get('b')} == {a, b} for e in entries) else 1)" 2>/dev/null; then
    swapped=1
    break
  fi
  sleep 0.5
done
if [ "$swapped" = 1 ]; then
  pass "the move down was recorded as a swap"
else
  fail "the move down was never recorded as a swap"
fi

poll "move down swaps the stacked pair" '
import json, sys
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["y"] for w in d["windows"]}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window missing"); sys.exit(1)
sys.exit(0 if by[a] > by[b] else 1)
' 30

adrt SimulateWorkspaceOrientation false >/dev/null
# With the override gone the pair splits along the screen's own axis (§1): a
# portrait monitor still stacks, a landscape one goes side by side. Derive the
# expectation from the monitor, never from a hard-coded orientation.
poll "back to horizontal the pair follows the screen's own axis" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
mons = {m["index"]: m for m in d["monitors"]}
g = mons.get(ws[0]["monitor"], {}).get("geometry", {})
portrait = g.get("height", 0) > g.get("width", 0)
a, b = sorted(ws, key=lambda w: (w["rect"]["x"], w["rect"]["y"]))
if portrait:
    if abs(a["rect"]["x"] - b["rect"]["x"]) > 2 or a["rect"]["y"] + a["rect"]["height"] > b["rect"]["y"] + 2:
        print("portrait screen should stack", a["rect"], b["rect"]); sys.exit(1)
else:
    if abs(a["rect"]["y"] - b["rect"]["y"]) > 2 or a["rect"]["x"] + a["rect"]["width"] > b["rect"]["x"] + 2:
        print("landscape screen should be side by side", a["rect"], b["rect"]); sys.exit(1)
sys.exit(0)
' 15

set_setting min-size-policy respect
ensure_clean
summary
