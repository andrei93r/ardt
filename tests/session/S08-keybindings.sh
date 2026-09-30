#!/usr/bin/env bash
# Generated with AI for personal use.
# S08 Keybindings on the live session via ydotool.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

if ! command -v ydotool >/dev/null 2>&1 || ! pgrep -x ydotoold >/dev/null 2>&1; then
  skip "S12 keybindings: ydotool/ydotoold not ready"
  summary
  exit 0
fi

# The undo step needs a split-ratio change to be visible; an app with tight
# size constraints (Chrome) clamps it, so pin this scenario to Files. Chrome is
# exercised by the rotating scenarios.
spawn "$FILES"
wait_tests 1 12 || true
spawn "$FILES"
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"

# Undo (Super+Z). Pick a ratio that differs from the current one, so the
# retile actually moves the windows and pushes an undo entry.
wA="$(state_expr "next((w['rect']['width'] for w in d['windows'] if w['id']==$A),0)")"
wB="$(state_expr "next((w['rect']['width'] for w in d['windows'] if w['id']==$B),0)")"
if [ "$wA" -gt "$wB" ]; then target=0.3; else target=0.7; fi
adrt SimulateResize "$A" "$B" "$target" >/dev/null
if wait_python 12 "import json,sys
w=[x for x in json.load(sys.stdin)['windows'] if x['id']==$A]
sys.exit(0 if w and abs(w[0]['rect']['width']-$wA) > 20 else 1)"; then
  pass "resize applied before the keybinding test"
else
  fail "resize did not apply (A width $wA)"
fi
before="$(state_expr "next((w['rect']['width'] for w in d['windows'] if w['id']==$A),0)")"
ydotool key 125:1 44:1 44:0 125:0
if wait_python 12 "import json,sys
w=[x for x in json.load(sys.stdin)['windows'] if x['id']==$A]
sys.exit(0 if w and abs(w[0]['rect']['width']-$before) > 20 else 1)"; then
  pass "Super+Z undid the resize"
else
  fail "Super+Z did not undo (still $before)"
fi

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
