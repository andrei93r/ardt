#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A59 A window that Adrt floated itself must never be left alone and floating:
# once the workspace has no tiles, the sweep pulls it back into the tiling and
# the lone-window rule maximizes it. The "always on top" flag Adrt sets while
# floating must be cleared with it (it leaked into the classifier before).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

# Maximize B so it takes its own workspace...
adrt MaximizeWindow "$B" >/dev/null
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

# ...come back, add a third window to the pair, then return B: it must float,
# which is what sets the "above" flag on it.
adrt ActivateWorkspace "$pair_ws" >/dev/null
sleep 1
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
third="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_settled 12
adrt UnmaximizeWindow "$B" >/dev/null
skip "the float-over-pair rule is replaced in Stage 2 (A90/A113)"
true || poll "B floats over the pair" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["layer"] == 2 else 1)
' 30

true || poll "floating set the always-on-top flag" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$B"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if w[0].get("above") is True else 1)
' 30

# Remove both tiles by their known ids; B is left alone and auto-floated.
adrt CloseWindow "$A" >/dev/null 2>&1 || true
adrt CloseWindow "$third" >/dev/null 2>&1 || true

if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["layer"] != 2 and b[0]["maximized"] else 1)'; then
  pass "the lone auto-float came back into the tiling and is maximized"
else
  fail "window not tiled ($(state_expr "[(w['id'], w['layer'], w['maximized'], w['rect']) for w in d['windows'] if w['id'] == $B]"))"
fi

poll "the leaked always-on-top flag was cleared" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$B"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if w[0].get("above") is False else 1)
' 10

poll "it fills the work area" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
w = [x for x in d["windows"] if x["id"] == int("'"$B"'")]
if not w:
    print("window gone"); sys.exit(1)
r = w[0]["rect"]
sys.exit(0 if r["width"] >= area["width"] - 2 and r["height"] >= area["height"] - 2 else 1)
' 15

ensure_clean
summary
