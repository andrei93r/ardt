#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A57 Keyboard-driven focus system: directional focus relative to the selected
# window (following the layout, staying on this workspace), directional move,
# fullscreen and quit.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"

focused_is() {
  wait_python "${2:-8}" '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("focused") == int("'"$1"'") else 1)'
}

adrt ActivateWindow "$A" >/dev/null
focused_is "$A" && pass "the window can be selected" || fail "ActivateWindow did not focus the window"

adrt FocusDirection right >/dev/null
focused_is "$B" && pass "focus moves right to the sibling" \
  || fail "focus right landed on $(state_expr 'd.get("focused")')"

adrt FocusDirection left >/dev/null
focused_is "$A" && pass "focus moves back left" \
  || fail "focus left landed on $(state_expr 'd.get("focused")')"

adrt FocusDirection up >/dev/null
sleep 1
focused_is "$A" 2 && pass "focus up does nothing with no window that way" \
  || fail "focus up moved to $(state_expr 'd.get("focused")')"

adrt MoveDirection right >/dev/null
poll "move right swaps the pair" '
import json, sys
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"]}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window missing", sorted(by)); sys.exit(1)
sys.exit(0 if by[a] > by[b] else 1)
' 12

adrt ToggleFullscreen "$A" >/dev/null
poll "fullscreen fills the monitor" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w:
    print("window gone"); sys.exit(1)
r = w[0]["rect"]
sys.exit(0 if r["width"] >= area["width"] - 1 and r["height"] >= area["height"] - 1 else 1)
' 12

adrt ToggleFullscreen "$A" >/dev/null
poll "leaving fullscreen re-tiles the pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) < 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    print("still stacked", a, b); sys.exit(1)
sys.exit(0)
' 12

adrt ActivateWindow "$B" >/dev/null
if focused_is "$B"; then
  adrt QuitFocused >/dev/null
  if wait_for 10 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" -lt 2 ]"; then
    pass "quit closed the focused window"
  else
    fail "quit did not close the focused window"
  fi
else
  fail "could not focus the window to quit"
fi

ensure_clean
summary
