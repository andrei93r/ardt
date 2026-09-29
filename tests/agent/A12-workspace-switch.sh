#!/usr/bin/env bash
# A12 Workspace switch: switching away hides the border and returning re-shows it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
assert_true "border visible before switching" "$(border_visible)"

adrt ActivateWorkspace 1 >/dev/null
sleep 1
assert_eq "active workspace is 1" "1" "$(state_expr 'd["activeWorkspace"]')"
assert_eq "border hidden after switching away" "false" "$(border_visible)"

adrt ActivateWorkspace 0 >/dev/null
sleep 1
adrt ActivateWindow "${ids[0]}" >/dev/null
wait_for 6 bash -c "bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)[\"border\"][\"visible\"] else 1)'" \
  && pass "border reappears after switching back" \
  || fail "border did not reappear"

ensure_clean
summary
