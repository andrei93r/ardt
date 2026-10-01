#!/usr/bin/env bash
# Generated with AI for personal use.
# Progress toasts on the user's real desktop. Always exits 0: a missing
# notification daemon must never fail a test run.
#   notify.sh "title" "body" [icon] [urgency]
set -uo pipefail
title="${1:-Adrt}"; body="${2:-}"; icon="${3:-utilities-terminal}"; urgency="${4:-normal}"
if command -v notify-send >/dev/null 2>&1; then
  notify-send --app-name=Adrt --icon="$icon" --urgency="$urgency" "$title" "$body" >/dev/null 2>&1
else
  gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify Adrt 0 "$icon" "$title" "$body" "[]" "{}" -1 >/dev/null 2>&1
fi
exit 0
