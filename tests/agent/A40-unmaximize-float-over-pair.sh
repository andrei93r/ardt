#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A40 Unmaximize onto a full pair: the window floats on top, centred, without
# completely covering the tiled pair behind it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# Retired with the v1 rule it tests: the v2 unmaximize ladder joins a neighbour
# that holds exactly one window, else parks the window minimized (A90/A91).
# There is no float-over-pair unmaximize in the model.
skip "the float-over-pair unmaximize is replaced in Stage 2 by A90/A91"
exit 0

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

# Maximize B: it gets its own workspace.
adrt MaximizeWindow "$B" >/dev/null
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

# Put a second window back on the pair's workspace, so it holds two.
adrt ActivateWorkspace "$pair_ws" >/dev/null
sleep 1
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12
if ! wait_python 15 '
import json, sys
d = json.load(sys.stdin)
here = [w for w in d["windows"] if w["tileable"] and w["workspace"] == int("'"$pair_ws"'")]
sys.exit(0 if len(here) >= 2 else 1)'; then
  fail "the pair workspace never held two windows (only $(state_expr "len([w for w in d['windows'] if w['tileable'] and w['workspace'] == $pair_ws])"))"
fi

# Return B to that workspace.
adrt UnmaximizeWindow "$B" >/dev/null

poll "the returned window floats on top without hiding the pair" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b:
    print("window gone"); sys.exit(1)
w = b[0]
if w["workspace"] != int("'"$pair_ws"'"):
    print("on ws", w["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if w["layer"] != 2:
    print("not floating (layer", w["layer"], ")"); sys.exit(1)
r = w["rect"]
area_w = area["width"] * area["height"]
if r["width"] * r["height"] >= area_w - 1:
    print("floating window still covers the whole area", r); sys.exit(1)
if r["width"] >= area["width"] - 1 or r["height"] >= area["height"] - 1:
    print("floating window spans the full monitor", r); sys.exit(1)
# The pair behind must remain visible: at least one tiled window is not fully covered.
others = [x for x in d["windows"] if x["id"] in (int("'"$A"'"),) or (x["tileable"] and x["id"] != int("'"$B"'"))]
covered = 0
for o in others:
    q = o["rect"]
    if r["x"] <= q["x"] and r["y"] <= q["y"] and r["x"] + r["width"] >= q["x"] + q["width"] and r["y"] + r["height"] >= q["y"] + q["height"]:
        covered += 1
if covered >= len(others):
    print("every tiled window is fully covered"); sys.exit(1)
print("floating", r, "over", len(others), "tiled windows")
'

ensure_clean
summary
