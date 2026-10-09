#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S15 Multi-monitor tiling on the live session. With workspaces-only-on-primary
# (GNOME's default) Mutter reports every window on the non-primary monitor as
# "on all workspaces"; that must not stop it being tiled. Moving a window
# between monitors must also not leave a stale classification behind.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

if [ "$(state_expr 'len(d["monitors"])')" -lt 2 ]; then
  skip "one monitor on this session: multi-monitor tiling is not exercised"
  summary
  exit 0
fi

spawn
wait_tests 1 12 || true
sleep 2
ID="$(test_ids | awk '{print $1}')"
echo "test window $ID"

read -r CUR OTHER DIRECTION <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
w = [x for x in d["windows"] if x["id"] in ids]
if not w:
    print("-1 -1 left"); raise SystemExit
cur = w[0]["monitor"]
mons = {m["index"]: m for m in d["monitors"]}
cg = mons[cur]["geometry"]
ccx, ccy = cg["x"] + cg["width"] / 2, cg["y"] + cg["height"] / 2
best = None
for m in d["monitors"]:
    if m["index"] == cur:
        continue
    g = m["geometry"]
    dx = g["x"] + g["width"] / 2 - ccx
    dy = g["y"] + g["height"] / 2 - ccy
    side = ("right" if dx > 0 else "left") if abs(dx) >= abs(dy) else ("down" if dy > 0 else "up")
    dist = dx * dx + dy * dy
    if best is None or dist < best[0]:
        best = (dist, m["index"], side)
print(cur, best[1], best[2]) if best is not None else print(cur, -1, "left")
')"
echo "monitor $CUR -> $OTHER ($DIRECTION)"

if [ "$OTHER" = "-1" ] || [ "$ID" = "" ]; then
  skip "no second monitor to move the window to"
  summary
  exit 0
fi

adrt ActivateWindow "$ID" >/dev/null
sleep 1
adrt MoveDirection "$DIRECTION" >/dev/null

poll "a window moved to the non-primary monitor stays tileable" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["monitor"] != int("'"$OTHER"'"):
    print("still on monitor", w[0]["monitor"]); sys.exit(1)
if w[0]["layer"] == 2:
    # The target screen/workspace can already hold a pair (the user\u2019s own
    # windows); the arrival ladder then floats by design (§9/A107). That is a
    # correct outcome, not the stale-sticky-flag bug this check hunts.
    print("no room on the target: arrived floating (documented)")
    sys.exit(0)
if not w[0]["tileable"]:
    print("not tileable:", w[0]["reason"]); sys.exit(1)
sys.exit(0)
' 20

poll "it is tiled inside that monitor's work area" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")][0]
area = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}[w["monitor"]]
r = w["rect"]
inside = r["x"] >= area["x"] - 2 and r["y"] >= area["y"] - 2 \
    and r["x"] + r["width"] <= area["x"] + area["width"] + 2 \
    and r["y"] + r["height"] <= area["y"] + area["height"] + 2
if not inside:
    print("rect", r, "area", area); sys.exit(1)
sys.exit(0)
' 20

# If the target screen already holds the user's windows, the return move is a
# pair operation (a swap) by design, not a monitor move — record that instead
# of failing. The non-primary sticky checks above and below remain meaningful.
others="$(dump | python3 -c "
import json,sys
d = json.load(sys.stdin); tid = int('$ID')
w = next(x for x in d['windows'] if x['id'] == tid)
print(' '.join(str(x['id']) for x in d['windows']
      if x['id'] != tid and x.get('tileable') and not x.get('minimized')
      and x.get('layer') != 2 and x['workspace'] == w['workspace']
      and x['monitor'] == w['monitor']))")"
if [ -n "$others" ]; then
  skip "moving it back: the target monitor already holds the user's windows — the return move is a pair operation by design"
else
# Moving it back must re-read its flags: a stale "on all workspaces" from the
# other monitor would leave it untileable on its own monitor. On a non-primary
# monitor the window is on *all* workspaces, so if the user switched away while
# the scenario ran it now shares a workspace with their windows and
# `MoveDirection` would swap within that pair instead of moving monitors.
# Re-select the sandbox first so it is alone again; then move it back.
adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin)['activeWorkspace'] == $START_WS else 1)" || true
case "$DIRECTION" in
  left) direction_back=right ;;
  right) direction_back=left ;;
  up) direction_back=down ;;
  down) direction_back=up ;;
esac
adrt ActivateWindow "$ID" >/dev/null
sleep 1
adrt MoveDirection "$direction_back" >/dev/null
poll "moving it back leaves it tileable too (no stale flags)" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["monitor"] != int("'"$CUR"'"):
    print("still on monitor", w[0]["monitor"]); sys.exit(1)
sys.exit(0 if w[0]["tileable"] else 1)
' 20
fi

# §9 decision 68: while the workspaces screen changes workspace, the other
# screen keeps its windows exactly as they are (slots, size) and nothing is
# notified. A screen without workspaces simply has nothing to switch.
if [ "$(state_expr 'd["workspaces"]')" -gt 1 ]; then
  adrt MoveDirection "$DIRECTION" >/dev/null
  poll "the test window is on the non-primary monitor for the switch check" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")]
sys.exit(0 if w and w[0]["monitor"] == int("'"$OTHER"'") else 1)
' 20

  before_rect="$(dump | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin)["windows"] if x["id"] == int("'"$ID"'")]
print(json.dumps(w[0]["rect"]) if w else "{}")')"

  other_ws="$(state_expr "0 if d['activeWorkspace'] != 0 else 1")"
  adrt ActivateWorkspace "$other_ws" >/dev/null
  # The switch is asynchronous: re-derive it as a property before asserting.
  wait_python 15 "import json,sys; sys.exit(0 if json.load(sys.stdin)['activeWorkspace'] == $other_ws else 1)" || true

  # Pass the previous rect through the environment: its JSON contains double
  # quotes, which cannot be embedded in the double-quoted python source.
  BEFORE_RECT="$before_rect" poll "a workspace switch leaves the non-primary window exactly as it was" '
import os, json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["monitor"] != int("'"$OTHER"'"):
    print("moved to monitor", w[0]["monitor"]); sys.exit(1)
if json.dumps(w[0]["rect"]) != os.environ["BEFORE_RECT"]:
    print("rect changed", w[0]["rect"], os.environ["BEFORE_RECT"]); sys.exit(1)
print("untouched on the non-primary monitor")
' 15

  adrt ActivateWorkspace "${START_WS:-0}" >/dev/null
fi

summary
