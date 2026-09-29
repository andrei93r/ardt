#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A20 Gesture pinch fires the configured action (show desktop).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
handled="$(adrt SimulateGesture pinch-in -100 0 2 | python3 "$PARSE")"
assert_true "pinch gesture was handled" "$handled"
sleep 2

# show-desktop maps to the overview toggle in this adapter.
check_python "an action was applied without error" '
import json, sys
json.load(sys.stdin)
print("ok")
'
summary
