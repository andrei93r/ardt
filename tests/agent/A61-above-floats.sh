#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A61 A window that asks to be "always on top" floats above the tiling and keeps
# its flag. This reverses the old behaviour, where the flag was cleared and the
# window tiled anyway: the model (§16) treats it as the user's decision.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"

adrt SimulateAbove "$A" >/dev/null

poll "the flagged window floats above the tiling" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
if not a:
    print("window gone"); sys.exit(1)
if a[0]["layer"] != 2:
    print("layer", a[0]["layer"], "above", a[0]["above"]); sys.exit(1)
sys.exit(0)
' 20

poll "its flag is left as the application set it" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
sys.exit(0 if a and a[0]["above"] is True else 1)
' 15

poll "the window left behind fills the screen" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'") and w["tileable"] and not w["minimized"]]
if not b:
    print("tile missing"); sys.exit(1)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
r = b[0]["rect"]
sys.exit(0 if r["width"] >= area["width"] - 2 and r["height"] >= area["height"] - 2 else 1)
' 20

ensure_clean
summary
