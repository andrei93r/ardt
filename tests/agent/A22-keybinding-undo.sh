#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A22 Keybinding undo through injected input: Super+Z restores the ratio a
# SimulateResize changed. Runs in the nested Shell now that real input can be
# injected (Stage 0).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A22 keybinding undo: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
before="$(window_field "${ids[0]}" rect)"
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
wait_settled 12
mid="$(window_field "${ids[0]}" rect)"
if [ "$mid" = "$before" ]; then
  fail "precondition: the resize changed the geometry"
  summary
  exit 1
fi

inject_hotkey 65515 122   # Super+Z
wait_settled 12
after="$(window_field "${ids[0]}" rect)"
if [ "$before" = "$after" ]; then
  pass "the undo keybinding restored the ratio"
else
  fail "the undo keybinding did not restore ($before -> $mid -> $after)"
fi

ensure_clean
summary
