#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A60 A workspace-switch animation that never finishes is torn down by the
# watchdog, so the desktop cannot stay doubled/frozen mid-slide.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair

# Hold the switch state open far longer than the watchdog allows.
adrt SimulateWorkspaceSwitch 6000 >/dev/null
sleep 3

if check_python "the stuck animation is torn down" '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if d.get("workspaceAnimating") is False else 1)
'; then :; else fail "animation still active"; fi

hist="$(history_file)"
# The log is buffered (history flushes within a second), so poll instead of
# racing the flush under load.
if wait_for 10 bash -c "grep -aq '\"reason\":\"switch-watchdog\"' '$hist' 2>/dev/null"; then
  pass "the watchdog recorded the teardown"
else
  fail "no watchdog teardown recorded"
fi

ensure_clean
summary
