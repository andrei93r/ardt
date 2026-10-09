#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A130 Occlusion (§11): a window stacked above the focused tile must hide the
# active-window highlight, and both transitions must be journalled with their
# reason. The covering window is a transient dialog that does not take focus, so
# the tile stays active and the border used to be drawn straight over the dialog
# (it was only ever suppressed for a session float, never for a stack).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window "python3 $ROOT_DIR/tests/agent/cover-dialog-client.py" >/dev/null
wait_count 2 25 || true
wait_settled 15

read -r tile dialog <<<"$(dump | python3 -c '
import json,sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"]]
dialogs = [w for w in d["windows"] if w["transient"]]
if len(tiles) != 1 or len(dialogs) != 1:
    print("0 0")
else:
    print(tiles[0]["id"], dialogs[0]["id"])')"
echo "tile=$tile dialog=$dialog"

if [ "$tile" = "0" ] || [ -z "${tile:-}" ] || [ -z "${dialog:-}" ]; then
  fail "expected one tile and one transient dialog (windows: $(list_ids))"
  ensure_clean
  summary
  exit 1
fi

# Keep the tile as the active window: the dialog may have taken focus on map.
adrt ActivateWindow "$tile" >/dev/null
if ! wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["focused"] == int("'"$tile"'") else 1)'; then
  fail "the tile never became the focused window (focused=$(state_expr 'd["focused"]'))"
fi
wait_settled 10

# The premise: the dialog is genuinely above the tile and covers its centre.
check_python "the dialog is stacked above the tile" '
import json, sys
d = json.load(sys.stdin)
tile = next(w for w in d["windows"] if w["id"] == int("'"$tile"'"))
dialog = next(w for w in d["windows"] if w["id"] == int("'"$dialog"'"))
if dialog["z"] < tile["z"]:
    print("dialog z", dialog["z"], "below tile z", tile["z"]); sys.exit(1)
print("dialog z", dialog["z"], "tile z", tile["z"])
'

check_python "the dialog covers the focused tile centre" '
import json, sys
d = json.load(sys.stdin)
tile = next(w for w in d["windows"] if w["id"] == int("'"$tile"'"))
dialog = next(w for w in d["windows"] if w["id"] == int("'"$dialog"'"))
r = tile["rect"]; o = dialog["rect"]
cx = r["x"] + r["width"] / 2; cy = r["y"] + r["height"] / 2
ok = cx >= o["x"] and cx <= o["x"] + o["width"] and cy >= o["y"] and cy <= o["y"] + o["height"]
if not ok:
    print("centre", cx, cy, "not in dialog", o); sys.exit(1)
print("centre", cx, cy, "in dialog", o)
'

# The occlusion must suppress the highlight...
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d["border"]["visible"] and "occluded" in d["indicator"]["suppressed"] else 1)'; then
  pass "the highlight is hidden while a window above covers the focused tile"
else
  fail "border not suppressed for a covered tile (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

# ...and the transition must be journalled with its reason (§11).
if journal_tail 400 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "suppress" and e.get("reason") == "occluded" for e in entries) else 1)'; then
  pass "the occlusion suppression is journalled with its reason"
else
  fail "no border suppress record with reason occluded (events: $(journal_tail 20 border))"
fi

# Obstruction gone: the highlight returns. The covering window is moved off the
# tile's centre rather than closed — closing it quits the whole cover client
# (see `cover-dialog-client.py`), which would take the tile with it and leave
# nothing to highlight. A move is the same "obstruction gone" state the rule
# must react to.
adrt MoveWindow "$dialog" 0 0 200 120 >/dev/null
if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d["border"]["visible"] and "occluded" not in d["indicator"]["suppressed"] else 1)'; then
  pass "the highlight returns once the covering window is gone"
else
  fail "border never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

if journal_tail 400 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "release" and e.get("reason") == "occluded" for e in entries) else 1)'; then
  pass "the occlusion release is journalled with its reason"
else
  fail "no border release record with reason occluded (events: $(journal_tail 20 border))"
fi

# §3.3: the rule must hold for a focused *modal*, not only a tile. A transient
# dialog is not tileable, but it is the active window, so it gets the §23
# highlight; the old occlusion check only ran for a tileable focus, so a modal
# that another window covered kept a `border focus` drawn over the cover. Spawn
# the cover client's modal, focus it, then stack an always-on-top window over
# its centre and assert the highlight goes away and comes back.
ensure_clean
spawn_window "python3 $ROOT_DIR/tests/agent/cover-dialog-client.py" >/dev/null
wait_count 2 25 || true
wait_settled 15

read -r modal parent <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
modals = [w for w in d["windows"] if w["transient"] and not w["tileable"]]
tiles = [w for w in d["windows"] if w["tileable"]]
if len(modals) != 1 or len(tiles) != 1:
    print("0 0")
else:
    print(modals[0]["id"], tiles[0]["id"])')"
echo "modal=$modal parent=$parent"

if [ "$modal" = "0" ] || [ -z "${modal:-}" ] || [ "$parent" = "0" ]; then
  fail "expected one modal and one parent tile (windows: $(list_ids))"
  ensure_clean
  summary
  exit 1
fi

# Focus the modal. `onFocusChanged` clears the border for a non-tileable window
# and a later drain re-establishes it for the active window; wait for the
# highlight, do not assume the ordering.
adrt ActivateWindow "$modal" >/dev/null
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d['focused'] == $modal and d['border']['visible'] else 1)"; then
  pass "a focused modal carries the active-window highlight"
else
  fail "the focused modal was never highlighted (focused=$(state_expr 'd["focused"]'), border=$(border_visible))"
fi

# An always-on-top window over the modal's centre: the occluder must cover it.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 25 || true
occluder="$(comm -13 <(printf '%s\n' $before_ids | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
echo "occluder=$occluder"
if [ -z "${occluder:-}" ]; then
  fail "the occluding window never appeared"
  ensure_clean
  summary
  exit 1
fi
# Let the newcomer's own arrival (route + first plan) land before it is floated:
# a route still in the drain would otherwise re-slot it after the move below.
wait_settled 15
read -r mx my mw mh <<<"$(window_field "$modal" rect | python3 -c 'import ast,sys; r=ast.literal_eval(sys.stdin.read().strip()); print(r["x"], r["y"], r["width"], r["height"])')"
cx=$((mx + mw / 2))
cy=$((my + mh / 2))
ox=$((cx - 250))
oy=$((cy - 160))
adrt SimulateAbove "$occluder" >/dev/null
# `make_above` is committed by the drain, not the trigger: wait until the window
# is actually floating (a tile would be re-planed straight back) and its route
# has landed, then move it. Re-assert the move until it is over the modal, so a
# late first frame cannot leave the occluder at its old tile rect.
if ! wait_python 15 "
import json, sys
d = json.load(sys.stdin)
o = next((w for w in d['windows'] if w['id'] == $occluder), None)
sys.exit(0 if o is not None and o['layer'] == 2 and not o['tileable'] else 1)"; then
  fail "the occluding window never floated above the tiling"
fi
wait_settled 10
covers_modal() {
  wait_python 4 "
import json, sys
d = json.load(sys.stdin)
m = next((w for w in d['windows'] if w['id'] == $modal), None)
o = next((w for w in d['windows'] if w['id'] == $occluder), None)
if m is None or o is None:
    sys.exit(1)
r = m['rect']
cx = r['x'] + r['width'] / 2
cy = r['y'] + r['height'] / 2
sys.exit(0 if cx >= o['rect']['x'] and cx <= o['rect']['x'] + o['rect']['width'] and cy >= o['rect']['y'] and cy <= o['rect']['y'] + o['rect']['height'] else 1)"
}
adrt MoveWindow "$occluder" "$ox" "$oy" 500 320 >/dev/null
for _ in $(seq 1 6); do
  covers_modal && break
  adrt MoveWindow "$occluder" "$ox" "$oy" 500 320 >/dev/null
done
adrt ActivateWindow "$modal" >/dev/null

# The occluder is genuinely above and covers the modal's centre.
check_python "the always-on-top window is stacked above and covers the focused modal centre" "
import json, sys
d = json.load(sys.stdin)
m = next((w for w in d['windows'] if w['id'] == $modal), None)
o = next((w for w in d['windows'] if w['id'] == $occluder), None)
if m is None or o is None:
    print('window gone'); sys.exit(1)
r = m['rect']
cx = r['x'] + r['width'] / 2
cy = r['y'] + r['height'] / 2
covers = cx >= o['rect']['x'] and cx <= o['rect']['x'] + o['rect']['width'] and cy >= o['rect']['y'] and cy <= o['rect']['y'] + o['rect']['height']
above = o['z'] > m['z']
if d['focused'] != $modal:
    print('the modal lost focus', d['focused']); sys.exit(1)
print('modal centre', cx, cy, 'occluder', o['rect'], 'z', o['z'], '>', m['z'])
sys.exit(0 if covers and above else 1)
"

if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if not d['border']['visible'] and 'occluded' in d['indicator']['suppressed'] else 1)"; then
  pass "the occluded modal's highlight is hidden"
else
  fail "the occluded modal is still highlighted (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi
if journal_tail 500 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "suppress" and e.get("reason") == "occluded" for e in entries) else 1)'; then
  pass "the modal occlusion suppression is journalled with its reason"
else
  fail "no border suppress record with reason occluded for the modal"
fi

# Uncover the modal: the highlight returns.
close_window "$occluder"
if wait_python 15 "
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d['border']['visible'] and 'occluded' not in d['indicator']['suppressed'] else 1)"; then
  pass "the modal's highlight returns once the covering window is gone"
else
  fail "the modal highlight never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi
if journal_tail 500 border | python3 -c '
import json, sys
entries = json.load(sys.stdin)
sys.exit(0 if any(e.get("event") == "release" and e.get("reason") == "occluded" for e in entries) else 1)'; then
  pass "the modal occlusion release is journalled with its reason"
else
  fail "no border release record with reason occluded for the modal"
fi

ensure_clean
summary
