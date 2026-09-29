#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A46 Finishing focuses the nearest left workspace that holds windows; when the
# left has none (removed/empty) it falls forward to the right, and the view is
# never left on a workspace that no longer exists.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
pair_ws="$(window_field "${ids[0]}" workspace)"

# Lone window on the workspace to the right, view follows.
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12
read -r third _third_ws <<<"$(dump | python3 -c '
import json,sys
d = json.load(sys.stdin)
pair = min(w["workspace"] for w in d["windows"] if w["tileable"])
extra = [w for w in d["windows"] if w["tileable"] and w["workspace"] != pair]
w = max(extra, key=lambda x: x["workspace"])
print(w["id"], w["workspace"])')"

close_window "$third"
if wait_for 12 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"activeWorkspace\"])')\" = '$pair_ws' ]"; then
  pass "finishing focused the left workspace that holds windows"
else
  fail "did not return to the left workspace (active $(state_expr 'd["activeWorkspace"]'))"
fi

check_python "the focused workspace actually has windows" '
import json, sys
d = json.load(sys.stdin)
active = d["activeWorkspace"]
if not any(w["workspace"] == active for w in d["windows"]):
    print("focused an empty workspace"); sys.exit(1)
print("focused ws", active)
'

# Rare case: close everything, including the last window on the active
# workspace. The view must never be left pointing at a removed workspace.
ensure_clean
open_pair
read -r a _ <<<"$(dump | python3 -c '
import json,sys
ws = sorted((w for w in json.load(sys.stdin)["windows"] if w["tileable"]), key=lambda w: w["rect"]["x"])
print(ws[0]["id"])')"
close_all
wait_for 12 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" = 0 ]" || true
sleep 1
check_python "the view is not stranded on a removed workspace" '
import json, sys
d = json.load(sys.stdin)
if not (0 <= d["activeWorkspace"] < d["workspaces"]):
    print("active", d["activeWorkspace"], "of", d["workspaces"]); sys.exit(1)
print("active", d["activeWorkspace"], "of", d["workspaces"])
'

ensure_clean
summary
