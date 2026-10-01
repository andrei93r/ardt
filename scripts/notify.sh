#!/usr/bin/env bash
# Generated with AI for personal use.
#
# Progress toasts on the user's real desktop.
#
#   notify.sh <title> <body> [icon] [urgency] [slot] [ttl_ms]
#
#   slot 0 = stand-alone toast (no replacement)
#   slot 1 = the progress slot: a test's start toast, and the verdict that replaces it
#   slot 2 = the failure slot: each failure replaces the last one
#
# Two toasts can therefore never pile up for one run: the verdict takes the start's
# place, and every toast expires on its own. Always exits 0: a missing notification
# daemon must never fail a test run.
set -uo pipefail

title="${1:-Adrt}"
body="${2:-}"
icon="${3:-utilities-terminal}"
urgency="${4:-normal}"
slot="${5:-0}"
ttl="${6:-4000}"

# Always the real desktop: a nested test shell has its own bus, so address the user's
# session bus explicitly instead of inheriting the nested one.
export DBUS_SESSION_BUS_ADDRESS="${ADRT_LIVE_BUS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/1000}/bus}"

args=(--app-name=Adrt --icon="$icon" --urgency="$urgency" --expire-time="$ttl")
[ "$slot" != "0" ] && args+=(--replace-id="$slot")

if command -v notify-send >/dev/null 2>&1; then
  notify-send "${args[@]}" "$title" "$body" >/dev/null 2>&1
else
  gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify Adrt "$slot" "$icon" "$title" "$body" "[]" "{}" "$ttl" >/dev/null 2>&1
fi
exit 0
