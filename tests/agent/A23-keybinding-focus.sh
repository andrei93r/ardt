#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A23 Keybinding focus via synthetic input (requires ydotool).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! keyboard_injection_ready; then
  skip "A23 keybinding focus: needs the interactive session (a nested headless Shell has no input focus); use scripts/keybinding-test.sh"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
ydotool key 125:1 106:1 106:0 125:0
wait_settled 25
focused="$(state_expr 'd["border"]["visible"]')"
assert_true "focus keybinding moved the border" "$focused"
ensure_clean
summary
