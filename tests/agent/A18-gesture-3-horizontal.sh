#!/usr/bin/env bash
# A18 Gesture 3-finger horizontal switches workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ActivateWorkspace 0 >/dev/null
sleep 1

handled="$(adrt SimulateGesture swipe-3-horizontal 300 0 3 | python3 "$PARSE")"
assert_true "gesture was handled" "$handled"
sleep 2
assert_eq "active workspace advanced to 1" "1" "$(state_expr 'd["activeWorkspace"]')"

adrt ActivateWorkspace 0 >/dev/null
summary
