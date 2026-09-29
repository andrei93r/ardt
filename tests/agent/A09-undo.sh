#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A9 Undo: restores the rects captured before the retile.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
before="$(window_field "${ids[0]}" rect)"
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.25 >/dev/null
sleep 2
adrt Undo >/dev/null
sleep 2
after="$(window_field "${ids[0]}" rect)"

if [ "$before" = "$after" ]; then pass "previous rects restored"; else fail "rects differ (before '$before', after '$after')"; fi

ensure_clean
summary
