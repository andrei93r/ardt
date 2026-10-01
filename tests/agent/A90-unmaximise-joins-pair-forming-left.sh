#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A90 Unmaximize joins the left workspace when it holds exactly one window
# (§4): the result is a pair, with the unmaximized window in slot 1.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

adrt MaximizeWindow "$B" >/dev/null
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
sys.exit(0 if b and b[0]["maximized"] and b[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

adrt UnmaximizeWindow "$B" >/dev/null

poll "the unmaximized window rejoined left as slot 1" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
pair = [w for w in d["windows"] if w["id"] in (int("'"$A"'"),) or w["id"] == int("'"$B"'")]
if not b:
    print("window gone"); sys.exit(1)
if b[0]["workspace"] != pair_ws or b[0]["maximized"] or b[0]["minimized"]:
    print("B state", b[0]["workspace"], b[0]["maximized"], b[0]["minimized"]); sys.exit(1)
print("joined ws", pair_ws, "-", len(pair), "windows")
' 25

poll "the two windows tile as a pair" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("not paired"); sys.exit(1)
if None in {w["slot"] for w in ws}:
    print("no slots", [(w["id"], w["slot"]) for w in ws]); sys.exit(1)
bie = [w for w in ws if w["id"] == int("'"$B"'")]
if not bie or bie[0]["slot"] != 1:
    print("the rejoining window is not in slot 1", bie); sys.exit(1)
print("pair", [(w["id"], w["slot"]) for w in ws])
' 20

ensure_clean
summary
