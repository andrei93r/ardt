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

TEST_T0="$(date +%s)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NESTED="$ROOT/scripts/nested-shell.sh"
AGENT_DIR="$ROOT/tests/agent"
BASE_STATE="${ADRT_BASE_STATE:-${XDG_RUNTIME_DIR:-/tmp}/adrt}"
FILTER="${ADRT_SCENARIOS:-}"
# Smoke mode: run the curated subset in tests/agent/smoke.list in one
# configuration for a fast "is the build sane" signal. The full suite stays the
# release gate. `ADRT_SMOKE_LIST` points at another list; the normal glob path is
# completely untouched when neither flag is set. A missing list entry is a hard
# failure (below), never a silent drop.
SMOKE="${ADRT_SMOKE:-0}"
SMOKE_LIST="${ADRT_SMOKE_LIST:-$AGENT_DIR/smoke.list}"
# Most cores, minus headroom for the user's live session. Measured: the suite is
# ~88% scenario time, so workers are the main lever; the shared budget below still
# caps the total across concurrent runs. ADRT_WORKERS overrides this.
DEFAULT_WORKERS=$(( ($(nproc 2>/dev/null || echo 4) * 75) / 100 ))
[ "$DEFAULT_WORKERS" -lt 2 ] && DEFAULT_WORKERS=2
[ "$DEFAULT_WORKERS" -gt 12 ] && DEFAULT_WORKERS=12
WORKERS="${ADRT_WORKERS:-$DEFAULT_WORKERS}"
# A curated smoke subset is small, but covering every feature area needs a
# couple of dozen scenarios and a handful of them are slow (reorder, focus
# cycle, resize-undo), so a wider fan-out keeps the honest set inside ~30s
# while still below the normal 12-way default and the shared budget. An
# explicit ADRT_WORKERS (or ADRT_SMOKE_WORKERS) still wins, and the normal
# default is never raised.
if [ "$SMOKE" = "1" ] && [ -z "${ADRT_WORKERS:-}" ]; then
  WORKERS="${ADRT_SMOKE_WORKERS:-10}"
  [ "$WORKERS" -gt "$DEFAULT_WORKERS" ] && WORKERS="$DEFAULT_WORKERS"
fi
[ "$WORKERS" -lt 1 ] && WORKERS=1

# --------------------------------------------------------- concurrent runs
# Runs are isolated per BASE_STATE for state, and nested-shell.sh keeps each
# Shell's Wayland socket in its own state dir. What is still shared is the CPU:
# the scenarios assert geometry within a settle, so two heavy runs on one box
# starve each other and report false failures. Every coordinator advertises its
# worker count in a registry and takes only what is left of a total budget, so
# concurrent runs share the machine instead of fighting over it; a run that
# would get nothing waits for the others to finish. A dead owner's entry is
# pruned and whatever nested Shells it left behind are stopped.
NPROC="$(nproc 2>/dev/null || echo 4)"
REGISTRY="${ADRT_RUN_REGISTRY:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested-runs}"
# Leave room for the live session: nproc-2 nested Shells in total across runs, so
# a second run can still get a few workers while the first keeps its own.
BUDGET="${ADRT_MAX_NESTED_WORKERS:-$(( NPROC > 2 ? NPROC - 2 : 2 ))}"
[ "$BUDGET" -lt 2 ] && BUDGET=2
RUN_NS="$(printf '%s' "$(basename "$BASE_STATE")" | tr -c 'A-Za-z0-9_-' '-' | cut -c1-24)"
WAYLAND_NS="wayland-adrt-${RUN_NS}"
RUN_ID="$$-${RUN_NS}"
HAVE_FLOCK=0
command -v flock >/dev/null 2>&1 && HAVE_FLOCK=1
# Builds write the shared `dist/`; two runs in one checkout must not build at
# once, and a run must not read `dist/` while another rebuilds it. The build is
# serialised and its result snapshotted per run, and the workers install from
# that snapshot instead of the live `dist/`.
BUILD_LOCK="$REGISTRY/.build.lock"

registry_prune() {
  mkdir -p "$REGISTRY"
  local f pid w base d
  for f in "$REGISTRY"/*; do
    [ -e "$f" ] || continue
    read -r pid w base < "$f" 2>/dev/null || { rm -f "$f"; continue; }
    if [ -z "${pid:-}" ] || ! kill -0 "$pid" 2>/dev/null; then
      if [ -n "${base:-}" ] && [ -d "$base" ]; then
        for d in "$base"/worker-*; do
          [ -d "$d" ] || continue
          ADRT_STATE_DIR="$d" bash "$NESTED" stop >/dev/null 2>&1 || true
        done
      fi
      rm -f "$f"
    fi
  done
}

registry_live() {
  registry_prune
  local f pid w sum=0
  for f in "$REGISTRY"/*; do
    [ -e "$f" ] || continue
    read -r pid w base < "$f" 2>/dev/null || continue
    case "$w" in ''|*[!0-9]*) w=0 ;; esac
    sum=$((sum + w))
  done
  printf '%s' "$sum"
}

# Take a slot, waiting while the budget is fully in use. `flock` stops two
# coordinators reading a free budget at the same instant and both taking it.
adopt_slot() {
  local waited=0 limit="${ADRT_RUN_WAIT_S:-1800}" live allowed have_flock=0
  command -v flock >/dev/null 2>&1 && have_flock=1
  mkdir -p "$REGISTRY"
  while :; do
    if [ "$have_flock" = 1 ]; then exec 9>"$REGISTRY/.lock"; flock 9; fi
    live="$(registry_live)"
    allowed=$(( BUDGET - live ))
    if [ "$allowed" -ge 1 ]; then
      [ "$WORKERS" -gt "$allowed" ] && WORKERS="$allowed"
      printf '%s %s %s\n' "$$" "$WORKERS" "$BASE_STATE" > "$REGISTRY/$RUN_ID"
      [ "$have_flock" = 1 ] && { flock -u 9; exec 9>&-; }
      if [ "$live" -gt 0 ]; then
        echo "agent-test: $live nested worker(s) already running; taking $WORKERS of a $BUDGET budget"
      fi
      return 0
    fi
    if [ "$have_flock" = 1 ]; then flock -u 9; exec 9>&-; fi
    if [ "$waited" -ge "$limit" ]; then
      echo "agent-test: the nested-worker budget ($BUDGET) is still in use after ${waited}s" >&2
      echo "agent-test: wait for the other run, or set ADRT_ALLOW_CONCURRENT=1 to overlap anyway" >&2
      return 1
    fi
    [ "$waited" -eq 0 ] && echo "agent-test: waiting for nested-worker budget ($BUDGET); another run is active"
    sleep 2
    waited=$((waited + 2))
  done
}

scenario_files() {
  local script
  # Smoke mode: the scenario set is the curated list, in list order (the
  # sharding sort below reorders it by duration). It was resolved and validated
  # before the preflight, so a missing entry never reaches here.
  if [ "$SMOKE" = "1" ]; then
    printf '%s\n' "${SMOKE_FILES[@]}"
    return
  fi
  for script in "$AGENT_DIR"/A[0-9][0-9]*.sh; do
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
      bash "$ROOT/scripts/notify.sh" "Adrt — test FAILED" "$(basename "$script" .sh)" dialog-error critical 2 7000
      printf 'FAIL\t%s\n' "$(basename "$script" .sh)" >> "$results"
    done
    return 1
  fi
  if ! bash "$NESTED" start; then
    echo "worker ${ADRT_WORKER_INDEX}: start failed"
  fi
  bash "$NESTED" wait-adrt 60 || echo "worker ${ADRT_WORKER_INDEX}: adrt D-Bus did not appear"

  local script name output rc status t0 t1 secs
  for script in $ADRT_SCENARIO_LIST; do
    name="$(basename "$script" .sh)"
    echo
    echo "=== $name (worker ${ADRT_WORKER_INDEX}) ==="
    t0="$(date +%s.%N)"
    output="$(bash "$script" 2>&1)"
    rc=$?
    t1="$(date +%s.%N)"
    secs="$(awk "BEGIN{printf \"%.1f\", $t1 - $t0}")"
    printf '%s\n' "$output"
    # FAIL wins over SKIP: a scenario that skips one part and then fails another
    # must not be reported as a skip (that silently passed three real failures).
    if echo "$output" | grep -q '^FAIL'; then status=FAIL
    elif echo "$output" | grep -q '^SKIP'; then status=SKIP
    elif [ "$rc" -eq 0 ]; then status=PASS
    else status=FAIL
    fi
    printf '%s\t%s\t%s\n' "$status" "$name" "$secs" >> "$results"
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

# Smoke mode: resolve the curated list now, before the preflight, so a renamed
# or deleted scenario fails fast and loudly instead of being silently dropped.
# Any entry without a matching tests/agent/<id>.sh aborts the run and names it.
declare -a SMOKE_FILES=()
if [ "$SMOKE" = "1" ]; then
  if [ ! -f "$SMOKE_LIST" ]; then
    echo "agent-test: ADRT_SMOKE=1 but the smoke list is missing: $SMOKE_LIST" >&2
    exit 1
  fi
  smoke_missing=0
  while read -r smoke_id; do
    [ -n "$smoke_id" ] || continue
    case "$smoke_id" in
      *.sh) smoke_id="${smoke_id%.sh}" ;;
    esac
    if [ ! -f "$AGENT_DIR/$smoke_id.sh" ]; then
      echo "agent-test: smoke.list names '$smoke_id' but $AGENT_DIR/$smoke_id.sh does not exist" >&2
      smoke_missing=$((smoke_missing + 1))
      continue
    fi
    SMOKE_FILES+=("$AGENT_DIR/$smoke_id.sh")
  done < <(sed 's/#.*//' "$SMOKE_LIST" | awk 'NF { print $1 }')
  if [ "$smoke_missing" -ne 0 ]; then
    echo "agent-test: refusing to run smoke: $smoke_missing smoke.list entr(ies) have no scenario file" >&2
    exit 1
  fi
  if [ "${#SMOKE_FILES[@]}" -eq 0 ]; then
    echo "agent-test: smoke.list has no scenarios: $SMOKE_LIST" >&2
    exit 1
  fi
  echo "== smoke mode: ${#SMOKE_FILES[@]} scenarios from $(basename "$SMOKE_LIST") =="
fi

echo "== preflight (lint, build, core tests) =="
( cd "$ROOT" && npm run lint ) > "$BASE_STATE/lint.out" 2>&1 &
LINT_PID=$!
mkdir -p "$REGISTRY"
if [ "$HAVE_FLOCK" = 1 ]; then
  ( cd "$ROOT" && flock "$BUILD_LOCK" npm run build ) > "$BASE_STATE/build.out" 2>&1 &
else
  ( cd "$ROOT" && npm run build ) > "$BASE_STATE/build.out" 2>&1 &
fi
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

# Install from a private snapshot: another run may rebuild the shared `dist/`
# while our workers are copying it, which would otherwise hand them a half-written
# tree.
rm -rf "$BASE_STATE/dist"
cp -r "$ROOT/dist" "$BASE_STATE/dist"
export ADRT_DIST="$BASE_STATE/dist"

mapfile -t ALL < <(scenario_files)
if [ "${#ALL[@]}" -eq 0 ]; then
  echo "agent-test: no scenarios matched '${FILTER}'" >&2
  exit 1
fi
[ "$WORKERS" -gt "${#ALL[@]}" ] && WORKERS=${#ALL[@]}
if [ "${ADRT_ALLOW_CONCURRENT:-0}" = "1" ]; then
  echo "agent-test: ADRT_ALLOW_CONCURRENT=1 — overlapping other nested runs on purpose"
else
  adopt_slot || exit 3
  trap 'rm -f "$REGISTRY/$RUN_ID"' EXIT
  [ "$WORKERS" -gt "${#ALL[@]}" ] && WORKERS=${#ALL[@]}
fi
echo
bash "$ROOT/scripts/notify.sh" "Adrt — tests starting" "${#ALL[@]} scenarios, $WORKERS nested Shells" utilities-system-monitor normal 1 4000
echo "== running ${#ALL[@]} scenarios across $WORKERS nested Shells ($(( WORKERS * 100 / ( $(nproc 2>/dev/null || echo 4) ) ))% of cores) =="

export ADRT_SKIP_BUILD=1
declare -a PIDS=() LISTS=()

# Order the scenarios longest-first before round-robin, so the few slow ones land
# on different workers instead of all in one shard (measured: one shard was 108s
# against an 86s mean, and the whole run waits on it). Durations come from the
# last run; with no history the order is unchanged.
DUR_CACHE="${ADRT_DURATION_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/adrt/scenario-durations.tsv}"
declare -A DUR=()
if [ -f "$DUR_CACHE" ]; then
  while IFS=$'\t' read -r dname dsecs; do
    case "${dsecs:-}" in ''|*[!0-9.]*) continue ;; esac
    DUR["$dname"]="$dsecs"
  done < "$DUR_CACHE"
fi
if [ "${#DUR[@]}" -gt 0 ]; then
  declare -a ORDERED_ALL=()
  while IFS=$'\t' read -r _d _f; do ORDERED_ALL+=("$_f"); done < <(
    for f in "${ALL[@]}"; do
      printf '%s\t%s\n' "${DUR[$(basename "$f" .sh)]:-0}" "$f"
    done | sort -rn -s -k1,1
  )
  ALL=("${ORDERED_ALL[@]}")
fi

for ((i = 0; i < WORKERS; i++)); do
  shard=""
  for ((j = i; j < ${#ALL[@]}; j += WORKERS)); do
    shard+="${ALL[$j]} "
  done
  [ -z "$shard" ] && continue
  LISTS[$i]="$shard"
  ADRT_WORKER=1 ADRT_WORKER_INDEX="$i" \
    ADRT_STATE_DIR="$BASE_STATE/worker-$i" \
    ADRT_WAYLAND_DISPLAY="${WAYLAND_NS}-$i" \
    ADRT_SCENARIO_LIST="$shard" \
    bash "$0" > "$BASE_STATE/worker-$i.out" 2>&1 &
  PIDS[$i]=$!
done

echo "workers: ${PIDS[*]}"
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

# ------------------------------------------------------------------- merge

declare -a names=() statuses=() timed=()
failures=0
skips=0
scen_secs=0
for ((i = 0; i < WORKERS; i++)); do
  [ -n "${LISTS[$i]:-}" ] || continue
  while IFS=$'\t' read -r status name secs; do
    [ -z "${name:-}" ] && continue
    names+=("$name")
    statuses+=("$status")
    case "${secs:-}" in ''|*[!0-9.]*) secs=0 ;; esac
    timed+=("$secs $name")
    scen_secs="$(awk "BEGIN{printf \"%.1f\", $scen_secs + $secs}")"
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

# Where the wall-clock goes: the sum of scenario times against the total, and the
# slowest scenarios (the sharding critical path). Cheap to print and the numbers
# that tell us whether more workers or a shorter scenario helps.
if [ "${#timed[@]}" -gt 0 ]; then
  echo
  echo "== timing =="
  printf '%s\n' "${timed[@]}" | sort -rn | head -10 | awk '{printf "  %6ss  %s\n", $1, $2}'
  echo "wall=$(( $(date +%s) - TEST_T0 ))s  scenario-sum=$(printf '%.0f' "$scen_secs")s  workers=$WORKERS  scenarios=${#names[@]}"
  # Remember the durations so the next run can balance its shards.
  mkdir -p "$(dirname "$DUR_CACHE")"
  dtmp="$DUR_CACHE.$$"
  : > "$dtmp"
  for entry in "${timed[@]}"; do printf '%s\t%s\n' "${entry#* }" "${entry%% *}" >> "$dtmp"; done
  mv -f "$dtmp" "$DUR_CACHE"
fi

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
  echo "- Nested shells: $WORKERS in parallel, each \`gnome-shell${ADRT_DEVKIT:+ }${ADRT_DEVKIT:+--devkit} --wayland --headless --no-x11${ADRT_MONITORS:+ --virtual-monitor ${ADRT_MONITORS//:/ --virtual-monitor }}\`"
  echo "- Monitor matrix: ${ADRT_MONITORS:-1280x800} (colon-separated, applied to every worker)"
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
bash "$ROOT/scripts/notify.sh" "Adrt — tests done" "failures=$failures skips=$skips of ${#names[@]}" "$([ "$failures" -eq 0 ] && echo dialog-information || echo dialog-error)" normal 1 10000
[ "$failures" -eq 0 ] && [ "$LINT_RC" -eq 0 ] && [ "$CORE_RC" -eq 0 ]
