#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A35 Minimize: a lone window on a later workspace follows back to the previous
# one, the view follows it, and the emptied workspace is removed.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
spawn_window >/dev/null
wait_count 3 30 || true
wait_settled 30

read -r before_active before_count third_ws <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
ws=sorted({w["workspace"] for w in d["windows"]})
third=max(d["windows"], key=lambda w: w["workspace"])
print(d["activeWorkspace"], d["workspaces"], third["workspace"])
')"
third="$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(max(d["windows"], key=lambda w: w["workspace"])["id"])
')"
echo "before: active=$before_active workspaces=$before_count third=$third on ws$third_ws"

adrt MinimizeWindow "$third" >/dev/null
wait_settled 30

check_python "the window returned to the previous workspace and followed" '
import json, sys
d = json.load(sys.stdin)
third = int("'"$third"'")
w = [x for x in d["windows"] if x["id"] == third]
if not w or not w[0]["minimized"]:
    print("window is not minimized"); sys.exit(1)
if w[0]["workspace"] != int("'"$third_ws"'") - 1:
    print("window on ws", w[0]["workspace"], "expected", int("'"$third_ws"'") - 1); sys.exit(1)
if d["activeWorkspace"] != w[0]["workspace"]:
    print("view did not follow: active", d["activeWorkspace"], "window ws", w[0]["workspace"]); sys.exit(1)
print("returned to ws", w[0]["workspace"])
'

# The emptied workspace is reaped on the safety-net scan, never while active.
if wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"workspaces\"])')\" -lt '$before_count' ]"; then
  pass "the empty workspace was removed"
else
  fail "the empty workspace was not removed"
fi

ensure_clean
summary
