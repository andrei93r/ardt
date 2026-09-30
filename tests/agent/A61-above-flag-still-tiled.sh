#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A61 A normal window carrying the "always on top" flag is still tiled, and the
# flag is cleared so it cannot cover its sibling.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"

adrt SimulateAbove "$A" >/dev/null

poll "the flagged window is still tiled" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    print("stacked", a, b); sys.exit(1)
sys.exit(0)
' 15

poll "\"always on top\" was cleared" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w:
    print("window gone"); sys.exit(1)
sys.exit(0 if w[0].get("above") is False else 1)
' 10

ensure_clean
summary
