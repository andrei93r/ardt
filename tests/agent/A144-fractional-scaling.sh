#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A143 Fractional scaling (§10/§25): on a fractional-scale monitor the two tiles
# of a pair must meet at a single boundary — no sub-pixel seam and no 1 px
# overlap — and both must stay inside the work area.
#
# The scale is driven through the `SimulateScreens` fixture, which carries
# `scale` per screen exactly as Mutter reports it. The work areas are chosen off
# the scale grid (an offset origin, a width the scale does not divide), which is
# where `snapRect`'s independent rounding used to break the pair: the old plan
# gave the tiles a 1 px overlap, and the compositor's integer frames then showed
# it. The scenarios assert the *compositor's* frames, so this is the end-to-end
# check; the pure math (1.25, 1.5, 1.75, 2.0) is covered by
# tests/core/fractional-scaling.test.ts.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean

# The split is what is under test, not the gap: flush tiles so a shared edge is
# the expected result. Restore the previous base so nothing leaks to a later
# scenario in the same nested Shell (ensure_clean does not reset gaps).
orig_gap_base="$(get_setting gaps-base)"
set_setting gaps-base 0

# A single screen: the fixture replaces the screen list, so a multi-monitor
# harness needs the matrix-specific topologies, not this lane.
if [ "$(screen_count)" -ne 1 ]; then
  skip "A143-fractional-scaling: needs a single screen (SimulateScreens replaces the list)"
  summary
  exit 0
fi

# A one-screen `SimulateScreens` fixture at a fractional scale, with an explicit
# offset origin and work area.
scale_fixture() {
  local scale="$1" x="$2" width="$3"
  python3 -c "
import json
print(json.dumps([{
    'index': 0, 'connector': 'M0', 'x': $x, 'y': 0, 'width': $width, 'height': 800,
    'isPrimary': True, 'scale': $scale,
    'workArea': {'x': $x, 'y': 0, 'width': $width, 'height': 800},
}]))
"
}

# Assert the two tiles share one boundary and both lie inside the work area.
check_pair() {
  local label="$1" x="$2" width="$3"
  poll "$label" "
import json, sys
d = json.load(sys.stdin)
tiles = sorted([w for w in d['windows'] if w['tileable'] and not w['minimized'] and w['layer'] != 2],
               key=lambda w: w['rect']['x'])
if len(tiles) != 2:
    print('expected two tiles, got', len(tiles)); sys.exit(1)
a, b = tiles[0]['rect'], tiles[1]['rect']
# No seam and no overlap: one shared boundary.
if a['x'] + a['width'] != b['x']:
    print('split not reconciled', a, b, 'monitors', d['monitors'], 'gaps', d.get('gaps')); sys.exit(1)
# Inside the simulated work area, both axes.
if a['x'] < $x or b['x'] + b['width'] > $x + $width:
    print('outside horizontally', a, b); sys.exit(1)
if a['y'] < 0 or a['y'] + a['height'] > 800 or b['height'] < 0 or b['y'] + b['height'] > 800:
    print('outside vertically', a, b); sys.exit(1)
print('met at', a['x'] + a['width'])
" 25
}

# One fractional scale: set the fixture, open a pair, assert.
fractional_pair() {
  local scale="$1" x="$2" width="$3"
  adrt SimulateScreens "$(scale_fixture "$scale" "$x" "$width")" >/dev/null
  poll "the simulated monitor reports scale $scale at x=$x" '
import json, sys
m = json.load(sys.stdin)["monitors"]
sys.exit(0 if len(m) == 1 and abs(m[0]["scale"] - '"$scale"') < 1e-9
         and m[0]["geometry"]["x"] == '"$x"' else 1)' 15
  open_pair
  wait_settled 20
  check_pair "at scale $scale the pair meets exactly inside the work area" "$x" "$width"
  ensure_clean
}

# 1.25: offset origin 2, width 1278 (right edge 1280; 1278 is not a multiple of 4).
fractional_pair 1.25 2 1278
# 1.75: offset origin 1, width 1220 (not a multiple of 4).
fractional_pair 1.75 1 1220

adrt SimulateScreens null >/dev/null
set_setting gaps-base "$orig_gap_base"
ensure_clean
summary
