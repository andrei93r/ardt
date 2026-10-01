#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Run the scenarios in tests/session/ against the **live** GNOME Shell.
#
# Unlike the nested harness, this touches your real desktop: it opens its own
# test windows (and closes only those), may switch workspaces briefly, and
# restores everything at the end of each scenario. The keybinding scenario
# injects real Super+… events via ydotool.
#
# Usage:
#   bash scripts/session-test.sh                 # all scenarios
#   ADRT_SESSION_SCENARIOS='S0[12]' bash scripts/session-test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_DIR="$ROOT/tests/session"
FILTER="${ADRT_SESSION_SCENARIOS:-}"
# A curated live smoke: ADRT_SESSION_SMOKE=1 runs only tests/session/smoke.list,
# the same idea as the nested ADRT_SMOKE. A listed scenario with no file aborts
# the run rather than silently dropping it.
SMOKE="${ADRT_SESSION_SMOKE:-0}"
SMOKE_LIST="${ADRT_SESSION_SMOKE_LIST:-$SESSION_DIR/smoke.list}"

if ! gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
  --method org.adrt.Adrt.DumpState >/dev/null 2>&1; then
  echo "session-test: Adrt is not running on the session bus." >&2
  echo "  gnome-extensions enable adrt@adrt.dev   # then log out and back in" >&2
  exit 2
fi

# One live run at a time: two would drive the same desktop at once. Fail fast
# rather than block — a user-driven run should not sit silently behind another.
REGISTRY="${ADRT_RUN_REGISTRY:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested-runs}"
mkdir -p "$REGISTRY"
if command -v flock >/dev/null 2>&1; then
  exec 8>"$REGISTRY/.live.lock"
  if ! flock -n 8; then
    echo "session-test: another live run is already active." >&2
    exit 3
  fi
fi
# Advertise the run in the shared budget so concurrent nested suites leave the
# machine room (and prune this entry if the run is killed).
LIVE_RUN_ID="$$-live"
printf '%s %s %s\n' "$$" "${ADRT_LIVE_WORKERS:-2}" "$REGISTRY/.live" > "$REGISTRY/$LIVE_RUN_ID"
trap 'rm -f "$REGISTRY/$LIVE_RUN_ID"' EXIT

# Is the running module the freshly installed one? Compare the installed file's
# time with the Shell's start time. This never touches the desktop (an earlier
# version probed a D-Bus method, which opened the overview on the user's screen).
INSTALLED="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/adrt@adrt.dev/extension.js"
shell_pid="$(pgrep -x gnome-shell | head -1)"
if [ -f "$INSTALLED" ] && [ -n "$shell_pid" ]; then
  file_ts="$(stat -c %Y "$INSTALLED" 2>/dev/null || echo 0)"
  proc_ts="$(stat -c %Y "/proc/$shell_pid" 2>/dev/null || echo 0)"
  if [ "$file_ts" -gt "$proc_ts" ]; then
    echo "session-test: WARNING: the installed extension is newer than the running Shell." >&2
    echo "  Log out and back in (Wayland cannot reload the Shell), then re-run." >&2
  fi
fi

echo "session-test: running against the live session."
echo "  test windows are opened and closed by the scenarios; workspaces are restored."
echo

START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
declare -a names=() statuses=()
failures=0
skips=0

shopt -s nullglob
declare -A SMOKE_SET=()
if [ "$SMOKE" = "1" ]; then
  if [ ! -f "$SMOKE_LIST" ]; then
    echo "session-test: ADRT_SESSION_SMOKE=1 but the smoke list is missing: $SMOKE_LIST" >&2
    exit 2
  fi
  smoke_missing=0
  while read -r sid; do
    sid="${sid%%#*}"
    sid="$(printf '%s' "$sid" | awk 'NF { print $1 }')"
    [ -n "$sid" ] || continue
    SMOKE_SET["$sid"]=1
    if [ ! -f "$SESSION_DIR/$sid.sh" ]; then
      echo "session-test: smoke.list names '$sid' but $SESSION_DIR/$sid.sh does not exist" >&2
      smoke_missing=$((smoke_missing + 1))
    fi
  done < "$SMOKE_LIST"
  if [ "$smoke_missing" -ne 0 ]; then
    echo "session-test: refusing to run live smoke: $smoke_missing smoke.list entr(ies) have no scenario file" >&2
    exit 2
  fi
  echo "session-test: live smoke mode — ${#SMOKE_SET[@]} scenarios from $(basename "$SMOKE_LIST")"
  echo
fi
for script in "$SESSION_DIR"/S*.sh; do
  name="$(basename "$script" .sh)"
  if [ "$SMOKE" = "1" ]; then
    [ -n "${SMOKE_SET[$name]:-}" ] || continue
  elif [ -n "$FILTER" ] && ! echo "$name" | grep -qE "$FILTER"; then continue; fi
  echo "=== $name ==="
  output="$(bash "$script" 2>&1)"
  rc=$?
  printf '%s\n' "$output"
  names+=("$name")
  if echo "$output" | grep -q '^SKIP'; then statuses+=("SKIP"); skips=$((skips + 1))
  elif [ "$rc" -eq 0 ]; then statuses+=("PASS")
  else statuses+=("FAIL"); failures=$((failures + 1))
  fi
  echo
done

echo "== journal =="
journal=""
if command -v journalctl >/dev/null 2>&1; then
  journal="$(journalctl -b -o cat --since "$START_TS" 2>/dev/null | grep -a '\[adrt\]' || true)"
  if echo "$journal" | grep -q '\[adrt\] ERROR'; then
    echo "FAIL  journal contains [adrt] ERROR"
    failures=$((failures + 1))
  else
    echo "PASS  no [adrt] ERROR in the journal since $START_TS"
  fi
  if echo "$journal" | grep -q '\[adrt\] WARN'; then
    echo "WARN  journal contains [adrt] WARN"
  fi
  [ -n "$journal" ] && printf '%s\n' "$journal" | tail -20
else
  echo "SKIP  journalctl not available"
fi

echo
echo "== results =="
for i in "${!names[@]}"; do printf '%-6s %s\n' "${statuses[$i]}" "${names[$i]}"; done
echo
echo "scenarios=${#names[@]} failures=$failures skips=$skips"

{
  echo "# Live Session Test Results"
  echo
  echo "Generated by \`scripts/session-test.sh\` on $(date -u +'%Y-%m-%dT%H:%M:%SZ')."
  echo
  echo "GNOME Shell: $(gnome-shell --version 2>/dev/null || echo n/a)"
  echo "Started: $START_TS"
  echo
  echo "| # | Scenario | Result |"
  echo "| - | -------- | ------ |"
  n=0
  for i in "${!names[@]}"; do n=$((n + 1)); echo "| $n | ${names[$i]} | ${statuses[$i]} |"; done
  echo
  echo "Scenarios: ${#names[@]}, failures: $failures, skipped: $skips."
  echo
  echo "## Journal excerpt"
  echo
  echo '```'
  [ -n "$journal" ] && printf '%s\n' "$journal" | tail -30 || echo "(no [adrt] lines)"
  echo '```'
  if [ "$failures" -eq 0 ]; then echo; echo "**Result: GREEN**"; else echo; echo "**Result: RED** — $failures failure(s)."; fi
} > "$ROOT/TEST_RESULTS_SESSION.md"

echo
bash "$ROOT/scripts/notify.sh" "Adrt — live suite done" "failures=$failures skips=$skips (TEST_RESULTS_SESSION.md)" "$([ "$failures" -eq 0 ] && echo dialog-information || echo dialog-error)" "$([ "$failures" -eq 0 ] && echo normal || echo critical)" 1 12000
echo "session-test: wrote $ROOT/TEST_RESULTS_SESSION.md"
[ "$failures" -eq 0 ]
