#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A22 Keybinding undo via synthetic input (requires ydotool).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! command -v ydotool >/dev/null 2>&1; then
  skip "A22 keybinding undo: ydotool is not installed (would run: ydotool key super+z)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
before="$(window_field "${ids[0]}" rect)"
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
wait_settled 25
YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/run/ydotoold/socket}" ydotool key 125:1 44:1 44:0 125:0
wait_settled 25
after="$(window_field "${ids[0]}" rect)"
if [ "$before" = "$after" ]; then pass "keybinding undo restored rects"; else fail "keybinding undo did not restore"; fi
ensure_clean
summary
