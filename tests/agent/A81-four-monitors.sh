#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A81 Four monitors: the matrix geometry, the bar's strut on the primary only,
# and a pair that tiles inside the primary's work area. Run it with
# `ADRT_MONITORS=2560x1440:1920x1080:1080x1920:1280x720`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

expected="${ADRT_MONITORS:-1280x800}"
count="$(printf '%s' "$expected" | tr ':' '\n' | grep -c .)"
if [ "$count" -lt 4 ]; then
  skip "A81 four monitors: the harness ran with $count monitor(s); rerun with ADRT_MONITORS=2560x1440:1920x1080:1080x1920:1280x720"
  exit 0
fi

ensure_clean

label="the four monitors are reported with the harness's geometry, left to right"
if wait_python 10 "
import json, sys
specs = [s for s in '''$expected'''.split(':') if s]
d = json.load(sys.stdin)
mons = sorted(d['monitors'], key=lambda m: m['geometry']['x'])
if len(mons) != len(specs):
    print('expected', len(specs), 'monitors, got', len(mons)); sys.exit(1)
x = 0
for spec, m in zip(specs, mons):
    w, h = (int(v) for v in spec.split('@')[0].split('x'))
    g = m['geometry']
    if g['x'] != x or g['width'] != w or g['height'] != h:
        print('monitor', spec, 'reported', g); sys.exit(1)
    x += w
sys.exit(0)"; then
  pass "$label"
else
  check_python "$label" "
import json, sys
d = json.load(sys.stdin)
print('specs', '$expected', 'monitors', [(m['geometry']['x'], m['geometry']['width'], m['geometry']['height']) for m in d['monitors']])
sys.exit(1)"
fi

# The shell's top bar reserves a strut on the primary only, so the same slot is
# a different size on two screens.
label="the work area excludes the bar on the primary and nothing elsewhere"
if wait_python 10 "
import json, sys
d = json.load(sys.stdin)
mons = sorted(d['monitors'], key=lambda m: m['geometry']['x'])
for i, m in enumerate(mons):
    g, a = m['geometry'], m.get('workArea') or m['geometry']
    if i == 0:
        # The bar sits at the top of the primary: same width, same x, pushed
        # down by its strut, and strictly shorter than the monitor.
        if not (a['x'] == g['x'] and a['width'] == g['width'] and a['y'] > g['y'] and a['height'] < g['height']):
            print('primary work area does not exclude the bar:', a, g); sys.exit(1)
    else:
        if a != g:
            print('monitor', i, 'work area differs from its geometry:', a, g); sys.exit(1)
sys.exit(0)"; then
  pass "$label"
else
  check_python "$label" "
import json, sys
d = json.load(sys.stdin)
print([(m['geometry'], m.get('workArea')) for m in sorted(d['monitors'], key=lambda m: m['geometry']['x'])])
sys.exit(1)"
fi

# A pair on the primary stays inside the primary's work area.
open_pair
label="the pair tiles inside the primary's work area"
if wait_python 20 "
import json, sys
d = json.load(sys.stdin)
mons = sorted(d['monitors'], key=lambda m: m['geometry']['x'])
a = mons[0].get('workArea') or mons[0]['geometry']
tiles = [w for w in d['windows'] if w['tileable'] and not w['minimized'] and w['layer'] != 2]
if len(tiles) < 2:
    print('expected two tiles, got', len(tiles)); sys.exit(1)
for w in tiles:
    r = w['rect']
    if r['x'] < a['x'] - 2 or r['y'] < a['y'] - 2 or r['x'] + r['width'] > a['x'] + a['width'] + 2 or r['y'] + r['height'] > a['y'] + a['height'] + 2:
        print('tile outside the work area', w['id'], r, a); sys.exit(1)
sys.exit(0)"; then
  pass "$label"
else
  check_python "$label" "
import json, sys
d = json.load(sys.stdin)
print('tiles', [(w['id'], w['rect']) for w in d['windows']])
sys.exit(1)"
fi

# A window moved onto the second screen is clamped to that screen's work area
# (the second screen has no bar, so its area is the full monitor).
ids=($(list_ids))
if [ "${#ids[@]}" -ge 1 ]; then
  second_x="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
mons = sorted(d['monitors'], key=lambda m: m['geometry']['x'])
print(mons[1]['geometry']['x'] + 40)")"
  # Whatever screen the tiler settles it on, the window must fit a real work
  # area — this is the invariant that survives every layout rule.
  adrt MoveWindow "${ids[0]}" "$second_x" 40 300 200 >/dev/null 2>&1 || true
  if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
areas = [(m.get('workArea') or m['geometry']) for m in d['monitors']]
w = [x for x in d['windows'] if x['id'] == ${ids[0]}]
if not w:
    sys.exit(1)
r = w[0]['rect']
inside = any(r['x'] >= a['x'] - 2 and r['y'] >= a['y'] - 2 and r['x'] + r['width'] <= a['x'] + a['width'] + 2 and r['y'] + r['height'] <= a['y'] + a['height'] + 2 for a in areas)
sys.exit(0 if inside else 1)"; then
    pass "a moved window still fits a real work area"
  else
    check_python "a moved window still fits a real work area" "
import json, sys
d = json.load(sys.stdin)
w = [x for x in d['windows'] if x['id'] == ${ids[0]}]
print('window', w[0]['rect'] if w else None, 'areas', [(m.get('workArea') or m['geometry']) for m in d['monitors']])
sys.exit(1)"
  fi
fi

ensure_clean
summary
