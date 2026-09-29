#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Autonomous agent test harness (§38.4, §40.3).
#
# Coordinator mode (default) builds and checks once, then shards the scenarios
# across N isolated nested GNOME Shells that run concurrently. Worker mode
# (`ADRT_WORKER=1`) owns one nested Shell and runs one shard. No command
# prompts for input and no TTY is required.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NESTED="$ROOT/scripts/nested-shell.sh"
AGENT_DIR="$ROOT/tests/agent"
BASE_STATE="${ADRT_BASE_STATE:-${XDG_RUNTIME_DIR:-/tmp}/adrt}"
FILTER="${ADRT_SCENARIOS:-}"
DEFAULT_WORKERS=$(( ( ($(nproc 2>/dev/null || echo 4) * 80) + 99 ) / 100 ))
[ "$DEFAULT_WORKERS" -lt 1 ] && DEFAULT_WORKERS=1
[ "$DEFAULT_WORKERS" -gt 16 ] && DEFAULT_WORKERS=16
WORKERS="${ADRT_WORKERS:-$DEFAULT_WORKERS}"
[ "$WORKERS" -lt 1 ] && WORKERS=1

scenario_files() {
  local script
  for script in "$AGENT_DIR"/A[0-9][0-9]-*.sh; do
    [ -e "$script" ] || continue
    if [ -n "$FILTER" ] && ! basename "$script" | grep -qE "$FILTER"; then
      continue
    fi
    printf '%s\n' "$script"
  done
}

# --------------------------------------------------------------------- worker

run_worker() {
  export ADRT_STATE_DIR
  local out_dir="$ADRT_STATE_DIR"
  mkdir -p "$out_dir"
  local results="$out_dir/results.txt"
  : > "$results"

  echo "worker ${ADRT_WORKER_INDEX} state=$ADRT_STATE_DIR"
  echo "worker ${ADRT_WORKER_INDEX} scenarios: $ADRT_SCENARIO_LIST"

  if ! bash "$NESTED" reset; then
    echo "worker ${ADRT_WORKER_INDEX}: reset failed"
    for script in $ADRT_SCENARIO_LIST; do
      printf 'FAIL\t%s\n' "$(basename "$script" .sh)" >> "$results"
    done
    return 1
  fi
  if ! bash "$NESTED" start; then
    echo "worker ${ADRT_WORKER_INDEX}: start failed"
  fi
  bash "$NESTED" wait-adrt 60 || echo "worker ${ADRT_WORKER_INDEX}: adrt D-Bus did not appear"

  local script name output rc status
  for script in $ADRT_SCENARIO_LIST; do
    name="$(basename "$script" .sh)"
    echo
    echo "=== $name (worker ${ADRT_WORKER_INDEX}) ==="
    output="$(bash "$script" 2>&1)"
    rc=$?
    printf '%s\n' "$output"
    if echo "$output" | grep -q '^SKIP'; then status=SKIP
    elif [ "$rc" -eq 0 ]; then status=PASS
    else status=FAIL
    fi
    printf '%s\t%s\n' "$status" "$name" >> "$results"
    if ! bash "$NESTED" status >/dev/null 2>&1; then
      echo "worker ${ADRT_WORKER_INDEX}: nested Shell died during $name; restarting"
      bash "$NESTED" start >/dev/null 2>&1 || true
      bash "$NESTED" wait-adrt 60 >/dev/null 2>&1 || true
    fi
  done
  bash "$NESTED" stop >/dev/null 2>&1 || true
  return 0
}

if [ "${ADRT_WORKER:-0}" = "1" ]; then
  run_worker
  exit $?
fi

# ---------------------------------------------------------------- coordinator

mkdir -p "$BASE_STATE"
rm -f "$BASE_STATE"/worker-*.out "$BASE_STATE"/worker-*.results.txt 2>/dev/null || true

echo "== preflight (lint, build, core tests) =="
( cd "$ROOT" && npm run lint ) > "$BASE_STATE/lint.out" 2>&1 &
LINT_PID=$!
( cd "$ROOT" && npm run build ) > "$BASE_STATE/build.out" 2>&1 &
BUILD_PID=$!
( cd "$ROOT" && npm run test:core ) > "$BASE_STATE/core.out" 2>&1 &
CORE_PID=$!

wait "$LINT_PID"; LINT_RC=$?
wait "$BUILD_PID"; BUILD_RC=$?
wait "$CORE_PID"; CORE_RC=$?

echo "lint=$LINT_RC build=$BUILD_RC test:core=$CORE_RC"
tail -n 5 "$BASE_STATE/lint.out"
tail -n 3 "$BASE_STATE/build.out"
tail -n 6 "$BASE_STATE/core.out"

if [ "$BUILD_RC" -ne 0 ]; then
  echo "agent-test: build failed; aborting" >&2
  exit 1
fi

mapfile -t ALL < <(scenario_files)
if [ "${#ALL[@]}" -eq 0 ]; then
  echo "agent-test: no scenarios matched '${FILTER}'" >&2
  exit 1
fi
[ "$WORKERS" -gt "${#ALL[@]}" ] && WORKERS=${#ALL[@]}
echo
echo "== running ${#ALL[@]} scenarios across $WORKERS nested Shells ($(( WORKERS * 100 / ( $(nproc 2>/dev/null || echo 4) ) ))% of cores) =="

export ADRT_SKIP_BUILD=1
declare -a PIDS=() LISTS=()
for ((i = 0; i < WORKERS; i++)); do
  shard=""
  for ((j = i; j < ${#ALL[@]}; j += WORKERS)); do
    shard+="${ALL[$j]} "
  done
  [ -z "$shard" ] && continue
  LISTS[$i]="$shard"
  ADRT_WORKER=1 ADRT_WORKER_INDEX="$i" \
    ADRT_STATE_DIR="$BASE_STATE/worker-$i" \
    ADRT_WAYLAND_DISPLAY="wayland-adrt-$i" \
    ADRT_SCENARIO_LIST="$shard" \
    bash "$0" > "$BASE_STATE/worker-$i.out" 2>&1 &
  PIDS[$i]=$!
done

echo "workers: ${PIDS[*]}"
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

# ------------------------------------------------------------------- merge

declare -a names=() statuses=()
failures=0
skips=0
for ((i = 0; i < WORKERS; i++)); do
  [ -n "${LISTS[$i]:-}" ] || continue
  while IFS=$'\t' read -r status name; do
    [ -z "${name:-}" ] && continue
    names+=("$name")
    statuses+=("$status")
    [ "$status" = "FAIL" ] && failures=$((failures + 1))
    [ "$status" = "SKIP" ] && skips=$((skips + 1))
  done < "$BASE_STATE/worker-$i/results.txt"
done

# Stable order by scenario id.
mapfile -t ORDERED < <(for i in "${!names[@]}"; do printf '%s|%s\n' "${names[$i]}" "${statuses[$i]}"; done | sort)

echo
echo "== results =="
for row in "${ORDERED[@]}"; do
  printf '%-6s %s\n' "${row#*|}" "${row%%|*}"
done
echo
echo "scenarios=${#names[@]} failures=$failures skips=$skips"

echo
echo "== journal scan =="
JOURNAL_ERRORS=0
for ((i = 0; i < WORKERS; i++)); do
  log="$BASE_STATE/worker-$i/shell.log"
  [ -f "$log" ] || continue
  if grep -aqE '\[adrt\] ERROR' "$log"; then
    echo "FAIL  worker-$i journal contains [adrt] ERROR"
    JOURNAL_ERRORS=$((JOURNAL_ERRORS + 1))
  fi
  # The nested Shell logs a benign gio error while clearing its
  # disable-extensions marker; ignore only that one.
  if grep -aE '\*\* ERROR|JS ERROR' "$log" | grep -qv 'gnome-shell-disable-extensions'; then
    echo "WARN  worker-$i journal contains a JS error"
  fi
done
if [ "$JOURNAL_ERRORS" -eq 0 ]; then
  echo "PASS  no [adrt] ERROR in any journal"
else
  failures=$((failures + 1))
fi

# ----------------------------------------------------------- TEST_RESULTS.md

{
  echo "# Test Results"
  echo
  echo "Generated by \`scripts/agent-test.sh\` on $(date -u +'%Y-%m-%dT%H:%M:%SZ')."
  echo
  echo "## Environment"
  echo
  echo "- Node: $(node --version 2>/dev/null || echo 'n/a')"
  echo "- GNOME Shell: $(gnome-shell --version 2>/dev/null || echo 'n/a')"
  echo "- Nested shells: $WORKERS in parallel, each \`gnome-shell --devkit --wayland --headless --no-x11 --virtual-monitor 1280x800\`"
  echo "- Sharding: round-robin across $WORKERS workers"
  echo
  echo "## Commands"
  echo
  echo '```bash'
  echo "npm run lint          # exit $LINT_RC"
  echo "npm run build         # exit $BUILD_RC"
  echo "npm run test:core     # exit $CORE_RC"
  echo "bash scripts/agent-test.sh   # ${#ALL[@]} scenarios, $WORKERS workers"
  echo '```'
  echo
  echo "## Core unit tests"
  echo
  echo '```'
  tail -n 8 "$BASE_STATE/core.out" 2>/dev/null || echo "(no output)"
  echo '```'
  echo
  echo "## Lint"
  echo
  echo '```'
  tail -n 8 "$BASE_STATE/lint.out" 2>/dev/null || echo "(no output)"
  echo '```'
  echo
  echo "## Agent scenarios"
  echo
  echo "| # | Scenario | Result |"
  echo "| - | -------- | ------ |"
  n=0
  for row in "${ORDERED[@]}"; do
    n=$((n + 1))
    echo "| $n | ${row%%|*} | ${row#*|} |"
  done
  echo
  echo "Scenarios: ${#names[@]}, failures: $failures, skipped: $skips."
  echo
  echo "## Journal excerpt"
  echo
  echo '```'
  for ((i = 0; i < WORKERS; i++)); do
    log="$BASE_STATE/worker-$i/shell.log"
    [ -f "$log" ] || continue
    grep -aE '\[adrt\]|adrt@|JS ERROR' "$log" | tail -n 10
  done
  echo '```'
  echo
  if [ "$failures" -eq 0 ]; then
    echo "**Result: GREEN** — no scenario failed and no lint/core/build failure."
  else
    echo "**Result: RED** — $failures failure(s)."
  fi
} > "$ROOT/TEST_RESULTS.md"

echo
echo "agent-test: wrote $ROOT/TEST_RESULTS.md"
[ "$failures" -eq 0 ] && [ "$LINT_RC" -eq 0 ] && [ "$CORE_RC" -eq 0 ]
