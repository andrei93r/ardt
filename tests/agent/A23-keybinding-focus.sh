#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A23 Keybinding focus through injected input: Super+Alt+L moves the focus to
# the other half of the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A23 keybinding focus: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 0.5
first="$(state_expr 'd["focused"]')"
inject_hotkey 65515 96   # Super+grave: focus cycle
wait_settled 8
second="$(state_expr 'd["focused"]')"
if [ -n "$second" ] && [ "$first" != "$second" ]; then
  pass "the focus keybinding moved the focus ($first -> $second)"
else
  fail "the focus keybinding did not move the focus (was $first, now $second)"
fi
assert_true "the border is visible on the focused window" "$(border_visible)"

ensure_clean
summary
