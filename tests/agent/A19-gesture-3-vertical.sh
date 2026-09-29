#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A19 Gesture 3-finger vertical toggles the overview.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
before="$(state_expr 'str(d["overview"]).lower()')"
handled="$(adrt SimulateGesture swipe-3-vertical 0 300 3 | python3 "$PARSE")"
assert_true "gesture was handled" "$handled"
wait_settled 12
after="$(state_expr 'str(d["overview"]).lower()')"

if [ "$before" != "$after" ]; then pass "overview toggled ($before -> $after)"; else fail "overview did not toggle"; fi
# Close the overview again if it opened.
if [ "$after" = "true" ]; then adrt SimulateGesture swipe-3-vertical 0 300 3 >/dev/null; fi
summary
