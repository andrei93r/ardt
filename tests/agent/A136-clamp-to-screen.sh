#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A136 Windows stay inside the screen (requested feature). With
# `clamp-windows-to-screen` on (the default), a window whose frame exceeds its
# own monitor's *full geometry* is pulled back on the lane-2 drain — including a
# floating window placed out of bounds by `MoveWindow`. A normal tiled window is
# inside its work area and is left untouched, and with the setting off an
# out-of-bounds frame is not forced back.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# $1 = window id; succeeds when its rect lies fully inside its own monitor's
# full geometry (not the work area).
inside_geometry() {
  local id="$1"
  wait_python "${2:-15}" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
if not w:
    sys.exit(1)
g = next((m['geometry'] for m in d['monitors'] if m['index'] == w['monitor']), None)
if g is None:
    sys.exit(1)
r = w['rect']
sys.exit(0 if r['x'] >= g['x'] and r['y'] >= g['y']
         and r['x'] + r['width'] <= g['x'] + g['width']
         and r['y'] + r['height'] <= g['y'] + g['height'] else 1)"
}

# $1 = window id; succeeds when its rect is NOT fully inside its monitor.
outside_geometry() {
  local id="$1"
  wait_python "${2:-5}" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $id), None)
if not w:
    sys.exit(1)
g = next((m['geometry'] for m in d['monitors'] if m['index'] == w['monitor']), None)
if g is None:
    sys.exit(1)
r = w['rect']
inside = (r['x'] >= g['x'] and r['y'] >= g['y']
          and r['x'] + r['width'] <= g['x'] + g['width']
          and r['y'] + r['height'] <= g['y'] + g['height'])
sys.exit(0 if not inside else 1)"
}

ensure_clean
set_setting clamp-windows-to-screen true

open_pair
ids=($(list_ids))
float="${ids[0]}"
tile="${ids[1]}"
wait_settled 15

if [ "$(window_field "$float" layer)" != "2" ]; then
  adrt ToggleFloat "$float" >/dev/null
  wait_settled 12
fi
if [ "$(window_field "$float" layer)" != "2" ]; then
  fail "the window could not be floated (layer $(window_field "$float" layer))"
  ensure_clean
  summary
  exit $?
fi

# Capture the tiled sibling once the float has settled: the lone remaining tile
# is maximized and must keep its geometry, untouched by the clamp.
tile_rect="$(window_field "$tile" rect)"

# The move is applied asynchronously and the frame can read back its old value
# for a moment, so "the rect is inside" is not enough on its own — it is true
# before the move even lands. Waiting for the clamp counter to rise above its
# pre-move value is the reliable signal that the pass ran; the geometry check
# then proves the result. A missing counter field (a build without the feature)
# fails the wait. `$1` is the pre-move counter, `$2` the window id.
clamp_fired() {
  local base="$1" id="$2" deadline=$((SECONDS + 20)) now
  while [ "$SECONDS" -lt "$deadline" ]; do
    now="$(counter clampsApplied)"
    case "$now" in
      ''|*[!0-9]*) : ;;
      *) [ "$now" -gt "$base" ] 2>/dev/null && return 0 ;;
    esac
    sleep 0.5
  done
  return 1
}

# 1. A float off the left/top edge (negative x/y) is moved fully inside.
clamps_before="$(counter clampsApplied)"
adrt MoveWindow "$float" -200 -150 400 300 >/dev/null
if clamp_fired "$clamps_before" "$float" && inside_geometry "$float" 5; then
  pass "a float moved off the left/top edge is clamped inside the monitor"
else
  check_python "a float moved off the left/top edge is clamped inside the monitor" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $float), None)
print('window', (w or {}).get('rect'), 'counter', d.get('counters', {}).get('clampsApplied', 'MISSING'), 'monitors', [(m['index'], m['geometry']) for m in d['monitors']])
sys.exit(1)"
fi

# 2. A float larger than the monitor is shrunk to the whole surface.
clamps_before="$(counter clampsApplied)"
adrt MoveWindow "$float" 20 20 3000 2000 >/dev/null
if clamp_fired "$clamps_before" "$float" && inside_geometry "$float" 5; then
  pass "a float larger than the monitor is shrunk inside it"
else
  check_python "a float larger than the monitor is shrunk inside it" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $float), None)
print('window', (w or {}).get('rect'), 'counter', d.get('counters', {}).get('clampsApplied', 'MISSING'), 'monitors', [(m['index'], m['geometry']) for m in d['monitors']])
sys.exit(1)"
fi

# DumpState must expose that a clamp was applied (add-only field).
assert_num "the clamp counter grew" ">" "$(counter clampsApplied)" "$clamps_before"

# Let the clamp's verification/retry settle before checking the tile and before
# the setting-off case, so a late re-apply cannot race the negative assertion.
wait_settled 12

# 3. A normal tiled window is unaffected by the clamp.
if [ "$(window_field "$tile" rect)" = "$tile_rect" ]; then
  pass "a normal tiled window keeps its geometry"
else
  fail "a normal tiled window was disturbed (was $tile_rect, now $(window_field "$tile" rect))"
fi

# 4. With the setting off, an out-of-bounds float is left alone.
set_setting clamp-windows-to-screen false
adrt MoveWindow "$float" -250 -180 400 300 >/dev/null
sleep 2
if outside_geometry "$float" 5; then
  pass "with clamp-windows-to-screen off the out-of-bounds frame is not forced back"
else
  fail "with clamp-windows-to-screen off the frame was still clamped back"
fi

set_setting clamp-windows-to-screen true
ensure_clean
summary
