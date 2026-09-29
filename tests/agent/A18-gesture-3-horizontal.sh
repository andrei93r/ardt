#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A18 Gesture 3-finger horizontal switches workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
adrt ActivateWorkspace 0 >/dev/null
sleep 1

handled="$(adrt SimulateGesture swipe-3-horizontal 300 0 3 | python3 "$PARSE")"
assert_true "gesture was handled" "$handled"
wait_settled 12
assert_eq "active workspace advanced to 1" "1" "$(state_expr 'd["activeWorkspace"]')"

adrt ActivateWorkspace 0 >/dev/null
summary
