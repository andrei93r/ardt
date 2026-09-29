#!/usr/bin/env bash
# A21 Gesture disabled: SimulateGesture returns false.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting gesture-enabled false
sleep 1

handled="$(adrt SimulateGesture swipe-3-horizontal 400 0 3 | python3 "$PARSE")"
assert_eq "gesture is ignored when disabled" "false" "$handled"

set_setting gesture-enabled true
sleep 1
summary
