#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A12 Workspace switch: the border is suppressed during the switch and returns.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_border_visible 20 || true
assert_true "border visible before switching" "$(border_visible)"

adrt ActivateWorkspace 1 >/dev/null
if wait_for 3 bash -c "bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys; sys.exit(0 if \"workspace-switch\" in json.load(sys.stdin)[\"indicator\"][\"suppressed\"] else 1)'"; then
  pass "border suppressed during the switch"
else
  fail "border was not suppressed during the switch"
fi
sleep 1
assert_eq "active workspace is 1" "1" "$(state_expr 'd["activeWorkspace"]')"
assert_eq "border hidden after switching away" "false" "$(border_visible)"

adrt ActivateWorkspace 0 >/dev/null
sleep 1
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_border_visible 20 \
  && pass "border reappears after switching back" \
  || fail "border did not reappear"

ensure_clean
summary
