#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Autonomous agent test harness (§38.4, §40.3). Resets a nested GNOME Shell,
# installs the extension, runs every scenario in tests/agent/, and reports a
# per-scenario pass/fail table. Exits 0 when no scenario fails. No command
# prompts for input and no TTY is required.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ADRT_STATE_DIR="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}"
NESTED="$ROOT/scripts/nested-shell.sh"
AGENT_DIR="$ROOT/tests/agent"
LOG_FILE="$ADRT_STATE_DIR/shell.log"

FILTER="${ADRT_SCENARIOS:-}"

echo "== resetting the nested Shell =="
if ! bash "$NESTED" reset; then
  echo "agent-test: failed to reset the nested Shell" >&2
  exit 1
fi
if ! bash "$NESTED" start; then
  echo "agent-test: failed to start the nested Shell" >&2
  exit 1
fi
if ! bash "$NESTED" wait-adrt 40; then
  echo "agent-test: the extension never exposed its D-Bus interface" >&2
  exit 1
fi

declare -a names=()
declare -a statuses=()
failures=0
skips=0

for script in "$AGENT_DIR"/A[0-9][0-9]-*.sh; do
  [ -e "$script" ] || continue
  name="$(basename "$script" .sh)"
  if [ -n "$FILTER" ] && ! echo "$name" | grep -qE "$FILTER"; then
    continue
  fi
  echo
  echo "=== $name ==="
  output="$(bash "$script" 2>&1)"
  rc=$?
  printf '%s\n' "$output"
  names+=("$name")
  if echo "$output" | grep -q '^SKIP'; then
    statuses+=("SKIP")
    skips=$((skips + 1))
  elif [ "$rc" -eq 0 ]; then
    statuses+=("PASS")
  else
    statuses+=("FAIL")
    failures=$((failures + 1))
  fi
  if ! bash "$NESTED" status >/dev/null 2>&1; then
    echo "agent-test: nested Shell died during $name; restarting"
    bash "$NESTED" start >/dev/null 2>&1 || true
    bash "$NESTED" wait-adrt 40 >/dev/null 2>&1 || true
  fi
done

echo
echo "== journal scan =="
if [ -f "$LOG_FILE" ]; then
  if grep -qE '\[adrt\] ERROR' "$LOG_FILE"; then
    echo "FAIL  journal contains [adrt] ERROR"
    failures=$((failures + 1))
  else
    echo "PASS  no [adrt] ERROR in the journal"
  fi
  if grep -qE '\*\* ERROR|JS ERROR' "$LOG_FILE"; then
    echo "WARN  journal contains a JS error (see $LOG_FILE)"
  fi
fi

echo
echo "== results =="
for i in "${!names[@]}"; do
  printf '%-6s %s\n' "${statuses[$i]}" "${names[$i]}"
done
echo
echo "scenarios=${#names[@]} failures=$failures skips=$skips"

bash "$NESTED" stop >/dev/null 2>&1 || true

[ "$failures" -eq 0 ]
