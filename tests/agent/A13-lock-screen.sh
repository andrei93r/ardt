#!/usr/bin/env bash
# A13 Lock screen: the extension pauses and hides the indicator.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1

assert_true "SimulateSessionMode returns true" "$(adrt SimulateSessionMode unlock-dialog | python3 "$PARSE")"
sleep 1
assert_eq "extension is paused" "true" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "border is hidden" "false" "$(border_visible)"

adrt SimulateSessionMode user >/dev/null
sleep 2
assert_eq "extension resumed" "false" "$(state_expr 'str(d["paused"]).lower()')"

ensure_clean
summary
