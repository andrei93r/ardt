#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A72 A genuinely pinned window (no workspace of its own) is not tiled; a window
# that only *reports* on-all-workspaces because Mutter keeps secondary-monitor
# windows visible is tiled. The distinction is the whole multi-monitor fix: with
# workspaces-only-on-primary (GNOME's default) every window on the second
# monitor used to be excluded, so it sat stacked on top of whatever was there.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
adrt ActivateWindow "$A" >/dev/null
wait_settled 15

if ! adrt SimulateSticky "$A" true | grep -q true; then
  skip "the sticky test hook is unsupported by this build"
  ensure_clean
  summary
  exit 0
fi

poll "a pinned window is not tiled" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if not w[0]["tileable"] else 1)
' 12

poll "the window left behind still fills the monitor" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 1:
    print("tiles", len(ws)); sys.exit(1)
area = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}[ws[0]["monitor"]]
r = ws[0]["rect"]
sys.exit(0 if r["width"] >= area["width"] - 40 and r["height"] >= area["height"] - 40 else 1)
' 15

adrt SimulateSticky "$A" false >/dev/null
poll "unpinning it brings it back into the tiling as an even pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = sorted(ws, key=lambda w: w["rect"]["x"])[0]["rect"], sorted(ws, key=lambda w: w["rect"]["x"])[1]["rect"]
if abs(a["width"] - b["width"]) > 4:
    print("not even:", a, b); sys.exit(1)
if a["x"] + a["width"] > b["x"] + 2:
    print("overlap:", a, b); sys.exit(1)
sys.exit(0)
' 15

ensure_clean
summary
