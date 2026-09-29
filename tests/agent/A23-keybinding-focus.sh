#!/usr/bin/env bash
# A23 Keybinding focus via synthetic input (requires ydotool).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! command -v ydotool >/dev/null 2>&1; then
  skip "A23 keybinding focus: ydotool is not installed (would run: ydotool key super+Right)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/run/ydotoold/socket}" ydotool key 125:1 106:1 106:0 125:0
sleep 2
focused="$(state_expr 'd["border"]["visible"]')"
assert_true "focus keybinding moved the border" "$focused"
ensure_clean
summary
