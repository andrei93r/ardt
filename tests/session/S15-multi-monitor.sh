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

read -r CUR OTHER <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$(test_ids)"'".split())
w = [x for x in d["windows"] if x["id"] in ids]
if not w:
    print("-1 -1"); raise SystemExit
cur = w[0]["monitor"]
others = [m["index"] for m in d["monitors"] if m["index"] != cur]
print(cur, others[0] if others else -1)
')"
echo "monitor $CUR -> $OTHER"

if [ "$OTHER" = "-1" ] || [ "$ID" = "" ]; then
  skip "no second monitor to move the window to"
  summary
  exit 0
fi

direction=$([ "$OTHER" -lt "$CUR" ] && echo left || echo right)
adrt ActivateWindow "$ID" >/dev/null
sleep 1
adrt MoveDirection "$direction" >/dev/null

poll "a window moved to the non-primary monitor stays tileable" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$ID"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["monitor"] != int("'"$OTHER"'"):
    print("still on monitor", w[0]["monitor"]); sys.exit(1)
if not w[0]["tileable"]:
    print("not tileable:", w[0]["reason"]); sys.exit(1)
if w[0]["layer"] == 2:
    print("left floating"); sys.exit(1)
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

# Moving it back must re-read its flags: a stale "on all workspaces" from the
# other monitor would leave it untileable on its own monitor.
direction_back=$([ "$CUR" -lt "$OTHER" ] && echo left || echo right)
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

# §9 decision 68: while the workspaces screen changes workspace, the other
# screen keeps its windows exactly as they are (slots, size) and nothing is
# notified. A screen without workspaces simply has nothing to switch.
if [ "$(state_expr 'd["workspaces"]')" -gt 1 ]; then
  adrt MoveDirection "$direction" >/dev/null
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
