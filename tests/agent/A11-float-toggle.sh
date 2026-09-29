#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A11 Float toggle: the focused/app window floats above the tiling.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ToggleFloat "${ids[0]}" >/dev/null
wait_settled 25

assert_eq "window layer is FLOATING" "2" "$(window_field "${ids[0]}" layer)"
floats="$(adrt_json GetFloats)"
if [ "$floats" != "{}" ]; then pass "float listed by GetFloats"; else fail "GetFloats is empty"; fi

adrt ToggleFloat "${ids[0]}" >/dev/null
ensure_clean
summary
