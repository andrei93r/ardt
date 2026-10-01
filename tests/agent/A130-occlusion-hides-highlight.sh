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

# Obstruction gone: the highlight returns.
adrt CloseWindow "$dialog" >/dev/null 2>&1 || true
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

ensure_clean
summary
