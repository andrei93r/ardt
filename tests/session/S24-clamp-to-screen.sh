#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S24 Windows stay inside the screen (requested feature), on the real Shell.
# With `clamp-windows-to-screen` on, a floating window placed out of bounds — by
# negative x/y, or larger than the monitor — is pulled back inside its own
# monitor's full geometry on the next pass, and a normal tiled window is left
# alone. The setting defaults to on; the scenario restores the user's value.
#
# NOTE (not run in the nested harness): this must be verified on the live
# session after `npm run install:local` and a log back in — it exercises the
# real compositor, whose placement constraints differ from the headless Shell.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

EXT_SCHEMAS="$HOME/.local/share/gnome-shell/extensions/adrt@adrt.dev/schemas"

# Support gate: the setting, the counter and the float trigger must exist.
# `grep -q` would exit early and let gsettings die on SIGPIPE (141) under
# pipefail, flaking the gate; consume the whole list instead.
if ! gsettings --schemadir "$EXT_SCHEMAS" list-keys org.gnome.shell.extensions.adrt 2>/dev/null | grep -x 'clamp-windows-to-screen' >/dev/null; then
  skip "the running build has no clamp-windows-to-screen setting (rebuild, install, log back in)"
  summary
  exit $?
fi
if ! dump | python3 -c 'import json,sys; sys.exit(0 if "clampsApplied" in json.load(sys.stdin).get("counters", {}) else 1)' 2>/dev/null; then
  skip "the running build does not report counters.clampsApplied"
  summary
  exit $?
fi

clamp_setting() {
  gsettings --schemadir "$EXT_SCHEMAS" set org.gnome.shell.extensions.adrt clamp-windows-to-screen "$1"
}
original="$(gsettings --schemadir "$EXT_SCHEMAS" get org.gnome.shell.extensions.adrt clamp-windows-to-screen 2>/dev/null || echo true)"
clamp_setting true

# $1 = window id; succeeds when its rect lies fully inside its own monitor's
# full geometry.
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

spawn "$FILES"
wait_tests 1 15 || true
spawn "$CHROME"
wait_tests 2 15 || true
sleep 2

ids="$(test_ids)"
set -- $ids
float="$1"
tile="$2"

adrt ToggleFloat "$float" >/dev/null
if wait_python 12 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $float), None)
sys.exit(0 if w and w['layer'] == 2 else 1)"; then
  pass "the window floats above the tiling"
else
  fail "the window did not float"
  clamp_setting "$original"
  summary
  exit $?
fi

# The lone remaining tile is maximized; its geometry must not be disturbed.
tile_rect="$(state_expr "next((w['rect'] for w in d['windows'] if w['id'] == $tile), None)")"

# 1. Negative offset from the float's own monitor: pull it off the top-left
# corner. Monitor-relative coordinates so a secondary screen works too.
ox="$(state_expr "next(m['geometry']['x'] for m in d['monitors'] if m['index'] == next(w['monitor'] for w in d['windows'] if w['id'] == $float))")"
oy="$(state_expr "next(m['geometry']['y'] for m in d['monitors'] if m['index'] == next(w['monitor'] for w in d['windows'] if w['id'] == $float))")"
clamps_before="$(state_expr 'd["counters"]["clampsApplied"]')"
adrt MoveWindow "$float" "$((ox - 300))" "$((oy - 200))" 400 300 >/dev/null
poll "a float moved off the top-left corner is clamped inside its monitor" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$float"'")), None)
if not w:
    print("window gone"); sys.exit(1)
g = next((m["geometry"] for m in d["monitors"] if m["index"] == w["monitor"]), None)
r = w["rect"]
ok = g and r["x"] >= g["x"] and r["y"] >= g["y"] and r["x"] + r["width"] <= g["x"] + g["width"] and r["y"] + r["height"] <= g["y"] + g["height"]
if not ok:
    print("out of geometry", r, g); sys.exit(1)
print("inside", r)
' 20
# The counter is asserted after section 2: an off-corner move can be
# constrained by the compositor before adrt ever sees an off-screen frame, so
# section 1 legitimately may not clamp. The oversized float below always does.

# 2. Larger than the monitor: it is shrunk to the whole surface.
adrt MoveWindow "$float" 40 40 4000 3000 >/dev/null
if inside_geometry "$float" 20; then
  pass "a float larger than the monitor is shrunk inside it"
else
  fail "a float larger than the monitor stayed out of bounds"
fi

after_clamps=""
# The clamp is applied by the periodic pass, so the geometry can read clean
# before the counter moves; poll it instead of sampling once.
if wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin)['counters']['clampsApplied'] > $clamps_before else 1)"; then
  after_clamps="$(state_expr 'd["counters"]["clampsApplied"]')"
  pass "the clamp counter grew ($clamps_before -> $after_clamps)"
else
  after_clamps="$(state_expr 'd["counters"]["clampsApplied"]')"
  fail "the clamp counter did not grow ($clamps_before -> $after_clamps)"
fi

sleep 1

# 3. A normal tiled window is unaffected.
if [ "$(state_expr "next((w['rect'] for w in d['windows'] if w['id'] == $tile), None)")" = "$tile_rect" ]; then
  pass "a normal tiled window keeps its geometry"
else
  fail "the tiled window was disturbed"
fi

clamp_setting "$original"
summary
