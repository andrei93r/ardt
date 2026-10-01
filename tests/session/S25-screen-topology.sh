#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S25 Screen topology: every connected screen keeps its own axis, for any
# arrangement (any count, any positions, any resolutions/orientations). It walks
# one test window to each monitor with the real cross-screen move and, on every
# one, asserts the axis the extension reports for that screen matches its
# orientation (portrait stacks top/bottom, landscape side by side) and the window
# is inside that screen. Gated on the topology: it skips unless the session has
# two or more screens of mixed orientation, so it does not assume a fixed layout.
# Complements A105 (the two-screen landscape+portrait case, nested).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

if [ "$(state_expr 'len(d["monitors"])')" -lt 2 ]; then
  skip "one screen on this session: the topology is not exercised"
  summary
  exit 0
fi
mixed="$(state_expr '1 if any(m["geometry"]["height"] > m["geometry"]["width"] for m in d["monitors"]) and any(m["geometry"]["width"] >= m["geometry"]["height"] for m in d["monitors"]) else 0')"
if [ "$mixed" != "1" ]; then
  skip "the connected screens share an orientation: no portrait/landscape mix to check"
  summary
  exit 0
fi

spawn "$FILES"
wait_tests 1 15 || true
ID="$(test_ids | awk '{print $1}')"
if [ -z "$ID" ]; then
  fail "no test window opened"
  summary
  exit 1
fi

monitor_of() {
  state_expr "next((w['monitor'] for w in d['windows'] if w['id'] == $ID), -1)"
}

# Step the focused window one screen at a time toward @target, following the
# geometry (works for any arrangement that is edge-adjacent along an axis).
move_to_screen() {
  local target="$1" guard=0 cur dir
  while [ "$guard" -lt 8 ]; do
    guard=$((guard + 1))
    cur="$(monitor_of)"
    [ "$cur" = "$target" ] && return 0
    dir="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
c = next((m for m in d['monitors'] if m['index'] == int('$cur')), None)
t = next((m for m in d['monitors'] if m['index'] == int('$target')), None)
if c is None or t is None:
    print('none'); raise SystemExit
cx, cy, cw, ch = c['geometry']['x'], c['geometry']['y'], c['geometry']['width'], c['geometry']['height']
tx, ty = t['geometry']['x'], t['geometry']['y']
if tx < cx:
    print('left')
elif tx >= cx + cw:
    print('right')
elif ty < cy:
    print('up')
elif ty >= cy + ch:
    print('down')
else:
    print('none')")"
    [ -z "$dir" ] || [ "$dir" = "none" ] && return 1
    adrt ActivateWindow "$ID" >/dev/null 2>&1 || true
    adrt MoveDirection "$dir" >/dev/null 2>&1 || true
    # A late apply or a not-quite-focused window can miss the first move; retry
    # the same direction rather than giving up (the guard bounds the attempts).
    if ! wait_python 12 "
import json, sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $ID), None)
sys.exit(0 if w is not None and w['monitor'] != $cur else 1)"; then
      sleep 0.5
      continue
    fi
  done
  return 1
}

mapfile -t IDXS < <(dump | python3 -c '
import json, sys
print("\n".join(str(m["index"]) for m in sorted(json.load(sys.stdin)["monitors"], key=lambda m: m["index"])))')

for idx in "${IDXS[@]}"; do
  if ! move_to_screen "$idx"; then
    fail "could not walk the test window to screen $idx"
    continue
  fi
  pass "the test window reached screen $idx"
  check_python "screen $idx keeps its own axis and contains the window" "
import json, sys
d = json.load(sys.stdin)
m = next(x for x in d['monitors'] if x['index'] == $idx)
g = m['geometry']
a = m.get('workArea') or g
axis = 'vertical' if g['height'] > g['width'] else 'horizontal'
w = next((w for w in d['windows'] if w['id'] == $ID), None)
if w is None:
    print('window gone'); sys.exit(1)
if w['axis'] != axis:
    print('axis', w['axis'], 'expected', axis, 'for', g['width'], 'x', g['height']); sys.exit(1)
r = w['rect']
if r['x'] < g['x'] - 2 or r['y'] < g['y'] - 2 or r['x'] + r['width'] > g['x'] + g['width'] + 2 or r['y'] + r['height'] > g['y'] + g['height'] + 2:
    print('outside the screen', r, g); sys.exit(1)
print('axis', w['axis'], 'inside', g)"
done

summary
