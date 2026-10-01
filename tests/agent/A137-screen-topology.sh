#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A137 Screen topology, 1 to 4 screens, any arrangement. A window is walked onto
# every configured screen with the real cross-screen move and, on each, the axis
# the extension reports must match that screen's own orientation (portrait stacks
# top/bottom, landscape side by side) and the window must stay inside the screen.
# It is gated on the topology that is actually present: it runs on whatever
# ADRT_MONITORS the harness is started with (the matrix: 1, 2 or 4 screens), and
# skips above four. Complements A105's pair-on-two-screens check.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# Superseded by A142-topology-cases, which gates every canonical combination by
# its signature instead of running on whatever topology happens to be present.
skip "superseded by A142-topology-cases (gated per topology)"
exit 0

ensure_clean
nmon="$(state_expr 'len(d["monitors"])')"
if [ "$nmon" -lt 1 ] || [ "$nmon" -gt 4 ]; then
  skip "A137 covers 1 to 4 screens; this harness has $nmon"
  ensure_clean
  summary
  exit 0
fi

spawn_window >/dev/null
wait_count 1 15 || true
ID="$(list_ids | awk '{print $1}')"
if [ -z "$ID" ]; then
  fail "no test window opened"
  ensure_clean
  summary
  exit 1
fi

monitor_of() {
  state_expr "next((w['monitor'] for w in d['windows'] if w['id'] == $ID), -1)"
}

# Step the focused window one screen at a time toward @target, following the
# geometry, so it works for any edge-adjacent arrangement.
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
  check_python "screen $idx keeps its own axis and contains the window" "
import json, sys
d = json.load(sys.stdin)
m = next(x for x in d['monitors'] if x['index'] == $idx)
g = m['geometry']
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

ensure_clean
summary
