#!/usr/bin/env bash
# A12 Workspace switch: switching workspaces works and the border returns.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
adrt ActivateWorkspace 0 >/dev/null
sleep 1
adrt ActivateWorkspace 1 >/dev/null
sleep 2

assert_eq "active workspace is 1" "1" "$(state_expr 'd["activeWorkspace"]')"
wait_for 5 bash -c "bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d[\"border\"][\"visible\"] else 1)'" \
  && pass "border reappears after the switch" \
  || fail "border did not reappear"

ensure_clean
summary
