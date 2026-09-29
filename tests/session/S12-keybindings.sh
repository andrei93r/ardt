#!/usr/bin/env bash
# Generated with AI for personal use.
# S12 Keybindings on the live session via ydotool.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

if ! command -v ydotool >/dev/null 2>&1 || ! pgrep -x ydotoold >/dev/null 2>&1; then
  skip "S12 keybindings: ydotool/ydotoold not ready"
  summary
  exit 0
fi

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"

# Undo (Super+Z)
adrt SimulateResize "$A" "$B" 0.3 >/dev/null
sleep 1.5
before="$(dump | python3 -c 'import json,sys
d=json.load(sys.stdin)
w=[x for x in d["windows"] if x["id"]==int("'"$A"'")][0]
print(w["rect"])')"
ydotool key 125:1 44:1 44:0 125:0
sleep 1.5
after="$(dump | python3 -c 'import json,sys
d=json.load(sys.stdin)
w=[x for x in d["windows"] if x["id"]==int("'"$A"'")][0]
print(w["rect"])')"
if [ "$before" != "$after" ]; then pass "Super+Z undid the resize"; else fail "Super+Z did not undo"; fi

# Float (Super+F)
adrt ActivateWindow "$A" >/dev/null
sleep 1
ydotool key 125:1 33:1 33:0 125:0
sleep 1.5
TEST_IDS="$(test_ids)" check_python "Super+F floated the focused window" '
import os, json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w or w[0]["layer"] != 2:
    print("layer", w[0]["layer"] if w else None); sys.exit(1)
print("layer", w[0]["layer"])
'
adrt ToggleFloat "$A" >/dev/null 2>&1 || true

# Focus (Super+Alt+l)
adrt ActivateWindow "$A" >/dev/null
sleep 1
border_before="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["border"]["rect"])')"
ydotool key 125:1 56:1 38:1 38:0 56:0 125:0
sleep 1.5
border_after="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["border"]["rect"])')"
if [ "$border_before" != "$border_after" ]; then pass "Super+Alt+l moved focus"; else fail "Super+Alt+l did not move focus"; fi

summary
