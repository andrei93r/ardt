#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A45 The workspace model: maximize gives a window its own space to the right,
# and finishing with it (closing) returns you to the left.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"

# Maximize: the window gets its own workspace to the right.
adrt MaximizeWindow "$B" >/dev/null
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b or not b[0]["maximized"]:
    sys.exit(1)
if b[0]["workspace"] != int("'"$pair_ws"'") + 1:
    print("not on the workspace to the right:", b[0]["workspace"]); sys.exit(1)
if d["activeWorkspace"] != b[0]["workspace"]:
    print("view did not follow"); sys.exit(1)' || true
check_python "maximize gave it the workspace to the right and followed" '
import json, sys
d = json.load(sys.stdin)
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b or b[0]["workspace"] != int("'"$pair_ws"'") + 1:
    print("workspace", b[0]["workspace"] if b else None); sys.exit(1)
if d["activeWorkspace"] != b[0]["workspace"]:
    print("active", d["activeWorkspace"]); sys.exit(1)
print("ws", b[0]["workspace"])
'

# Done: closing it returns you to the left (the pair's workspace) and the
# workspace it used is reaped.
before="$(state_expr 'd["workspaces"]')"
close_window "$B"

if wait_for 12 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"activeWorkspace\"])')\" = '$pair_ws' ]"; then
  pass "closing returned the view to the left"
else
  fail "view did not return left (active $(state_expr 'd["activeWorkspace"]'))"
fi

if wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"workspaces\"])')\" -lt '$before' ]"; then
  pass "the workspace to the right was reaped"
else
  fail "the workspace to the right was not reaped"
fi

ensure_clean
summary
