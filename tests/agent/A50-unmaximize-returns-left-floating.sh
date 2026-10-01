#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A50 Unmaximizing a window whose left workspace already holds a pair returns it
# there floating on top of the pair — not tiled, and not re-maximized in place.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ws="$(state_expr 'min(w["workspace"] for w in d["windows"] if w["tileable"])')"

# A third window goes to the workspace to the right and, being alone, is
# maximized there. It was not sent by the maximize policy, so the extension has
# no "previous workspace" recorded for it.
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15

third="$(dump | python3 -c '
import json,sys
ws = [w for w in json.load(sys.stdin)["windows"] if w["tileable"]]
top = max(w["workspace"] for w in ws)
print([w for w in ws if w["workspace"] == top][0]["id"])')"
third_ws="$(window_field "$third" workspace)"
echo "pair on ws$pair_ws, third $third on ws$third_ws"

if [ "$third_ws" != "$((pair_ws + 1))" ]; then
  fail "third window is on ws$third_ws, expected ws$((pair_ws + 1))"
fi

adrt UnmaximizeWindow "$third" >/dev/null

# Retired with the v1 rule: the v2 model has no float-over-pair (an unmaximized
# window joins the left workspace if it holds one window, else it is parked
# minimized). The replacement scenarios are A90/A113.
skip "the float-over-pair rule is replaced in Stage 2 (A90/A113)"
true || poll "the unmaximized window came to the left workspace floating" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("window gone"); sys.exit(1)
w = w[0]
if w["workspace"] != int("'"$pair_ws"'"):
    print("on ws", w["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if w["layer"] != 2:
    print("not floating (layer", w["layer"], ")"); sys.exit(1)
pair = [x for x in d["windows"] if x["tileable"] and x["id"] != int("'"$third"'") and x["workspace"] == int("'"$pair_ws"'")]
if len(pair) < 2:
    print("pair not on the left workspace:", len(pair)); sys.exit(1)
r = w["rect"]
if r["width"] >= d["monitors"][0]["workArea"]["width"] - 1 and r["height"] >= d["monitors"][0]["workArea"]["height"] - 1:
    print("covers the whole work area", r); sys.exit(1)
print("floats", r, "over", len(pair), "tiles on ws", w["workspace"])
' 20

# The view must follow the window back to the left workspace (the user should
# not be left looking at an empty workspace).
check_python "the view followed the window to the left workspace" '
import json, sys
d = json.load(sys.stdin)
if d["activeWorkspace"] != int("'"$pair_ws"'"):
    print("active", d["activeWorkspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
print("active", d["activeWorkspace"])
'

# The floating window sits on top of the pair: focusing a covered tile must not
# draw its highlight over the window above it.
tile="$(dump | python3 -c '
import json,sys
d = json.load(sys.stdin)
ws = int("'"$pair_ws"'")
t = [w for w in d["windows"] if w["tileable"] and w["workspace"] == ws and w["id"] != int("'"$third"'")]
print(t[0]["id"])')"
adrt ActivateWindow "$tile" >/dev/null
sleep 1
echo "focused=$(state_expr 'd["focused"]') tile=$tile third=$third"
echo "state: $(state_expr 'str(d["indicator"]["suppressed"])+" visible="+str(d["border"]["visible"])')"
if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if "occluded" in d["indicator"]["suppressed"] and not d["border"]["visible"] else 1)'; then
  pass "the highlight is hidden while the focused tile is covered"
else
  fail "border not suppressed for a covered tile (suppressed: $(state_expr 'd["indicator"]["suppressed"]'), visible: $(border_visible))"
fi

adrt CloseWindow "$third" >/dev/null 2>&1 || true
if wait_border_visible 15; then
  pass "the highlight returns once the covering window is gone"
else
  fail "border never came back (suppressed: $(state_expr 'd["indicator"]["suppressed"]'))"
fi

ensure_clean
summary
