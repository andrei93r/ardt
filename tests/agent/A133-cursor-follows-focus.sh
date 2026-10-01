#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A133 Cursor follows focus (§17): with `cursor-follows-focus` on, every focus
# change moves the pointer to the newly focused window's middle, re-derived in
# the drain. With the setting off a focus change leaves the pointer alone.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A133 cursor-follows-focus: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi
if ! probe_supports cursor.seatWarp && ! probe_supports cursor.displayWarp; then
  skip "A133 cursor-follows-focus: this Shell exposes no public pointer-warp mechanism"
  exit 0
fi

focused_is() {
  wait_python "${2:-10}" "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == int('$1') else 1)"
}

at_centre() {
  # $1 = window id; succeeds when the reported pointer is its centre.
  local id="$1"
  wait_python 15 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
p = d.get('pointer') or {}
if not w or 'x' not in p:
    sys.exit(1)
cx = w['rect']['x'] + w['rect']['width'] / 2
cy = w['rect']['y'] + w['rect']['height'] / 2
sys.exit(0 if abs(p['x'] - cx) <= 3 and abs(p['y'] - cy) <= 3 else 1)"
}

ensure_clean
set_setting cursor-follows-focus false
open_pair
ids=($(list_ids))
first="${ids[0]}"
second="${ids[1]}"

# Park the pointer on the first window (also warms the compositor pointer: the
# first synthetic move in a fresh headless Shell can drop one axis).
adrt ActivateWindow "$first" >/dev/null
focused_is "$first" || true
adrt CursorToCentre >/dev/null 2>&1 || true
sleep 0.5

# With the setting on, focusing the second window must bring the pointer with it.
set_setting cursor-follows-focus true
sleep 0.5
# The follow happens on a *focus change*, and a loaded Shell can be slow to run
# the drain, so alternate focus until the pointer arrives instead of sampling once.
followed=0
for _ in $(seq 1 6); do
  adrt ActivateWindow "$first" >/dev/null
  sleep 0.2
  adrt ActivateWindow "$second" >/dev/null
  if at_centre "$second" 3; then followed=1; break; fi
done
if [ "$followed" = 1 ]; then
  pass "with cursor-follows-focus on, the pointer follows the focus change"
else
  check_python "with cursor-follows-focus on, the pointer follows the focus change" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $second), None)
print('pointer', d.get('pointer'), 'window', (w or {}).get('rect')); sys.exit(1)"
fi

# Turning it off must stop the follow: the pointer must stay exactly where it
# was when focus moves to the other window. Comparing against the captured
# pointer (rather than the second window's centre) keeps the check honest even
# if the follow above never happened.
before_off="$(state_expr "str(d.get('pointer'))")"
set_setting cursor-follows-focus false
sleep 0.5
adrt ActivateWindow "$first" >/dev/null
focused_is "$first" || true
sleep 1.5
POINTER_BEFORE="$before_off" check_python "with cursor-follows-focus off, a focus change leaves the pointer alone" "
import os, json, sys
p = json.load(sys.stdin).get('pointer') or {}
if 'x' not in p:
    sys.exit(1)
sys.exit(0 if str(p) == os.environ['POINTER_BEFORE'] else 1)
"

set_setting cursor-follows-focus false
ensure_clean
summary
