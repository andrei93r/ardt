#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A24 Keybinding float via synthetic input (requires ydotool).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! command -v ydotool >/dev/null 2>&1; then
  skip "A24 keybinding float: ydotool is not installed (would run: ydotool key super+f)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/run/ydotoold/socket}" ydotool key 125:1 33:1 33:0 125:0
wait_settled 25
assert_eq "keybinding floated the focused window" "2" "$(window_field "${ids[0]}" layer)"
ensure_clean
summary
