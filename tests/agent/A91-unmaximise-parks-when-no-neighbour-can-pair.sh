#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A91 Unmaximize parks when no neighbour can pair (§4): the left workspace holds
# two windows, so the unmaximized window moves there minimized and its own
# workspace is reaped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
pair_ws="$(window_field "${ids[0]}" workspace)"

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
third="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
sys.exit(0 if w and w[0]["maximized"] and w[0]["workspace"] != int("'"$pair_ws"'") else 1)' || true

adrt UnmaximizeWindow "$third" >/dev/null

poll "the unmaximized window is parked minimized in the left workspace" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
w = [x for x in d["windows"] if x["id"] == int("'"$third"'")]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["workspace"] != pair_ws:
    print("on ws", w[0]["workspace"], "expected", pair_ws); sys.exit(1)
if not w[0]["minimized"]:
    print("not minimized"); sys.exit(1)
print("parked on ws", pair_ws, "minimized")
' 25

poll "the workspace it left was reaped" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
print("workspaces", d["workspaces"], "active", d["activeWorkspace"])
sys.exit(0 if len({w["workspace"] for w in ws}) == 1 else 1)
' 20

ensure_clean
summary
