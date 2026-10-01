#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A93 Reaping is a property (§5): a workspace emptied by a close is removed and
# the view returns to the nearest workspace that holds windows.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ws="$(state_expr 'min(w["workspace"] for w in d["windows"] if w["tileable"])')"
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

third="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
w = max(d["windows"], key=lambda x: x["workspace"])
print(w["id"])')"
third_ws="$(window_field "$third" workspace)"
before="$(state_expr 'd["workspaces"]')"

close_window "$third"

poll "the view returned to the left workspace and the empty one was reaped" '
import json, sys
d = json.load(sys.stdin)
if d["activeWorkspace"] != int("'"$pair_ws"'"):
    print("active", d["activeWorkspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if d["workspaces"] >= int("'"$before"'"):
    print("workspaces", d["workspaces"], "expected <", int("'"$before"'")); sys.exit(1)
print("active", d["activeWorkspace"], "workspaces", d["workspaces"])
' 25

ensure_clean
summary
