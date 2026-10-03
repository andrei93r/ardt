#!/usr/bin/env bash
# Generated with AI for personal use.
# S27 Tab tear-off (live, best-effort). A real detach is a pointer drag on a tab
# strip (Chrome, Firefox, Zed) or a menu action (VS Code's "Move Editor into New
# Window"); neither has a stable, headless-drivable form, so this scenario is a
# DOCUMENTED MANUAL CHECK, never a flaky automated one. The nested suite keeps
# the decision covered by A155 (a grab on an unplaced window is a tear-off, not
# a move), and A158-A160 run the same no-swap/no-storm assertions per app.
#
# Set ADRT_TEAROFF_TEST=1 and drive one detach by hand while the recorder runs;
# the checklist below says exactly what must hold.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

if [ "${ADRT_TEAROFF_TEST:-0}" != "1" ]; then
  skip "S27: real tear-off is a manual drag/menu action — set ADRT_TEAROFF_TEST=1 to run it by hand"
fi

manual_row() { # app, how
  local app="$1" how="$2"
  skip "S27 manual · $app: $how — the newcomer must tile or maximise, with no swap, no clamp_to_screen/resize_retry storm and no stubborn (check DumpState/DumpDecisions)"
}

manual_row "Chrome" "drag a tab out of the tab strip and release it on the desktop"
manual_row "Firefox" "drag a tab out of the tab strip and release it on the desktop"
manual_row "Zed" "drag the editor tab out of the window"
manual_row "VS Code" "Command Palette → 'Move Editor into New Window'"

# When the user is driving the detach, watch the decision journal for a swap or
# a storm on any window created after this point and report it.
if [ "${ADRT_TEAROFF_TEST:-0}" = "1" ]; then
  since="$(appcheck_journal_seq)"
  echo
  echo "Drive the detach now. Watching 30 s for a swap or a clamp/resize storm…"
  sleep 30
  for event in swap clamp_to_screen resize_retry stubborn; do
    n="$(appcheck_decisions_since "$since" "$event" "")"
    if [ "$event" = "swap" ]; then
      if [ "${n:-1}" -eq 0 ] 2>/dev/null; then
        pass "S27: no swap was recorded for the tear-off"
      else
        fail "S27: $n swap decision(s) recorded for the tear-off"
      fi
    elif [ "${n:-99}" -le 3 ] 2>/dev/null; then
      pass "S27: no $event storm ($n)"
    else
      fail "S27: $event storm ($n)"
    fi
  done
fi

summary
