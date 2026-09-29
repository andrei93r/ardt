#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A22 Keybinding undo via synthetic input (requires ydotool).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! keyboard_injection_ready; then
  skip "A22 keybinding undo: needs the interactive session (a nested headless Shell has no input focus); use scripts/keybinding-test.sh"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
before="$(window_field "${ids[0]}" rect)"
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
wait_settled 25
ydotool key 125:1 44:1 44:0 125:0
wait_settled 25
after="$(window_field "${ids[0]}" rect)"
if [ "$before" = "$after" ]; then pass "keybinding undo restored rects"; else fail "keybinding undo did not restore"; fi
ensure_clean
summary
