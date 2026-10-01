#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A125 Long mixed run (§5, Stage 8): spawn, close, move, minimize, maximize,
# drag and workspace-switch for several minutes and assert the journal never
# records an `invariant_violated` — the packing invariant is asserted, not
# enforced, so the long run is what proves it holds under sustained churn.
# `ADRT_LONG_RUN_SECONDS` overrides the duration (default 180).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# Opt-in: a several-minute run would dominate every suite. Set `ADRT_LONG_RUN=1`
# (optionally with `ADRT_LONG_RUN_SECONDS`) to run it; otherwise it is a
# recorded skip, never a silent one.
if [ "${ADRT_LONG_RUN:-0}" != "1" ]; then
  skip "A125 long mixed run: set ADRT_LONG_RUN=1 (and optionally ADRT_LONG_RUN_SECONDS) to run it"
  summary
  exit 0
fi

duration="${ADRT_LONG_RUN_SECONDS:-180}"
ensure_clean

start=$SECONDS
iteration=0
while [ "$((SECONDS - start))" -lt "$duration" ]; do
  iteration=$((iteration + 1))
  echo "-- long-run iteration $iteration ($((SECONDS - start))s) --"

  # Spawn a pair, then a third (a new workspace on a workspace-capable screen).
  spawn_window >/dev/null; wait_count 1 15 || true
  sleep 1
  spawn_window >/dev/null; wait_count 2 15 || true
  wait_settled 12

  ids=($(list_ids))
  A="${ids[0]:-}"
  B="${ids[1]:-}"
  [ -n "$A" ] || continue

  # Maximize / unmaximize.
  adrt MaximizeWindow "$A" >/dev/null 2>&1 || true
  sleep 1.5
  adrt UnmaximizeWindow "$A" >/dev/null 2>&1 || true
  wait_settled 12

  # Minimize and restore is not available by trigger; minimize and move on.
  if [ -n "$B" ]; then
    adrt MinimizeWindow "$B" >/dev/null 2>&1 || true
    sleep 1
  fi

  # A user drag of A across B (a swap or a free-slot drop).
  adrt BeginDrag "$A" >/dev/null 2>&1 || true
  adrt MoveWindow "$A" 300 300 500 400 >/dev/null 2>&1 || true
  sleep 0.6
  adrt EndDrag "$A" >/dev/null 2>&1 || true
  wait_settled 12

  # Workspace switch and a keyboard move to the next workspace and back.
  adrt ActivateWorkspace 0 >/dev/null 2>&1 || true
  sleep 0.6
  adrt MoveFocusedToWorkspace 1 >/dev/null 2>&1 || true
  sleep 1.5
  adrt ActivateWorkspace 0 >/dev/null 2>&1 || true
  sleep 0.6

  # Add a third and a fourth, then clean up.
  spawn_window >/dev/null; wait_count 3 15 || true
  sleep 1
  spawn_window >/dev/null; wait_count 4 15 || true
  wait_settled 12

  close_all
  wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" = 0 ]" || true
  adrt ActivateWorkspace 0 >/dev/null 2>&1 || true
  adrt ResetLayoutState >/dev/null 2>&1 || true
  sleep 1
done

ensure_clean
echo "long run: $iteration iterations in $((SECONDS - start))s"

# The assertion: no packing invariant was ever violated. The history file is the
# append-only journal; the in-memory decision tail is a second witness.
journal="$(history_file)"
violations=0
if [ -f "$journal" ]; then
  # `grep -c` prints 0 and exits non-zero on no match; keep its stdout only.
  violations="$(grep -c 'invariant_violated' "$journal" 2>/dev/null)"
  [ -n "$violations" ] || violations=0
fi
assert_eq "the journal has no invariant_violated entries" "0" "$violations"

tail_violations="$(adrt DumpDecisions 400 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c '
import json, sys
try:
    entries = json.load(sys.stdin)
except Exception:
    print(0); raise SystemExit
print(sum(1 for e in entries if e.get("event") == "invariant_violated"))' 2>/dev/null || echo 0)"
assert_eq "the in-memory decision tail has no invariant_violated entries" "0" "$tail_violations"

summary
