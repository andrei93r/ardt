#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A174 Closing the last visible window must reap a workspace that still holds a
# minimized window promptly, not on the next safety-net scan. The workspace is
# "look empty" (only minimized windows) and the reaper relocates its occupant.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ids=($(list_ids))
open_pair_ws="$(window_field "${pair_ids[0]}" workspace)"

# A third window takes its own workspace to the right; it is the neighbour the
# minimized occupant will be relocated into.
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15

pair_left="${pair_ids[0]}"
pair_right="${pair_ids[1]}"
if [ "$(window_field "$pair_left" workspace)" != "$open_pair_ws" ]; then
  pair_left="${pair_ids[1]}"
  pair_right="${pair_ids[0]}"
fi

before_count="$(state_expr 'd["workspaces"]')"

# Minimize one member: the other keeps the workspace visible, so it must stay.
adrt MinimizeWindow "$pair_left" >/dev/null
wait_settled 15

# Park the safety-net scan far away, so only the close path can reap in time.
# The current scan runs once more at its 5 s cadence and then re-arms at 60 s.
set_setting scan-interval 60000 >/dev/null 2>&1 || true
sleep 6

# Close the last visible window. The workspace now holds only the minimized
# window: visually empty, so it must be reaped and the occupant relocated.
close_window "$pair_right"

if wait_for 3 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"workspaces\"])')\" -lt '$before_count' ]"; then
  pass "the look-empty workspace was reaped without waiting for the scan"
else
  fail "the look-empty workspace was still present after the close (workspaces $(state_expr 'd["workspaces"]') > $before_count)"
fi

check_python "the minimized occupant moved to a loaded workspace and the view followed" '
import json, sys
d = json.load(sys.stdin)
left = int("'"$pair_left"'")
w = [x for x in d["windows"] if x["id"] == left]
if not w or not w[0]["minimized"]:
    print("window is not minimized"); sys.exit(1)
if d["workspaces"] >= int("'"$before_count"'"):
    print("workspace was not reaped"); sys.exit(1)
if d["activeWorkspace"] != w[0]["workspace"]:
    print("view did not follow: active", d["activeWorkspace"], "window ws", w[0]["workspace"]); sys.exit(1)
print("minimized window on ws", w[0]["workspace"], "active", d["activeWorkspace"])
'

set_setting scan-interval 5000 >/dev/null 2>&1 || true
ensure_clean
summary
