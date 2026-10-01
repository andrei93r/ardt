#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# topology-matrix.sh — exercise every canonical 1–4 screen topology once.
#
# The topology signature (src/core/topology.ts) says what shape the screens are
# in, independent of their pixel resolutions. The test matrix is the finite
# canonical list of those shapes (`TOPOLOGY_COMBINATIONS`): every count from one
# to four, the orientation patterns that matter, and the arrangements that
# matter (single row, single column, an L at three, a 2x2 at four).
#
# For each combination this script:
#   1. starts one nested GNOME Shell with `ADRT_MONITORS` sized to the
#      combination's orientations (the Shell lays the real virtual monitors out
#      in a row and picks the primary);
#   2. arranges those *real* virtual monitors into the combination's shape with
#      `gdctl` (a column, an L, a 2x2) — still real monitors, moved by Mutter;
#   3. checks the signature Mutter reports equals the combination's declared
#      signature; then
#   4. runs the one gated scenario (tests/agent/A138-topology-cases.sh) with
#      `ADRT_TOPO_EXPECT` set to that signature, so only the matching case runs.
#
# It never runs the full suite: only the topology scenario. Runs are sequential —
# one nested Shell at a time, which fits the shared nested-worker budget.
#
# Usage:
#   bash scripts/topology-matrix.sh                    # every combination
#   ADRT_TOPO_FILTER='4-' bash scripts/topology-matrix.sh
#   ADRT_TOPO_FILTER='2lp' bash scripts/topology-matrix.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NESTED="$ROOT/scripts/nested-shell.sh"
AGENT_DIR="$ROOT/tests/agent"
PARSE="$AGENT_DIR/parse.py"
SCENARIO="$AGENT_DIR/A138-topology-cases.sh"
STATE="${ADRT_TOPO_STATE:-${XDG_RUNTIME_DIR:-/tmp}/adrt-topology-matrix}"
FILTER="${ADRT_TOPO_FILTER:-}"
# Another lane may be running; this matrix only ever owns one nested Shell, so a
# single worker is the whole budget it asks for.
export ADRT_WORKERS="${ADRT_WORKERS:-1}"

command -v python3 >/dev/null 2>&1 || { echo "topology-matrix: python3 is required" >&2; exit 2; }
[ -f "$SCENARIO" ] || { echo "topology-matrix: missing $SCENARIO" >&2; exit 2; }

# Build once, serialised against any other run that writes dist/.
REGISTRY="${XDG_RUNTIME_DIR:-/tmp}/adrt-nested-runs"
mkdir -p "$REGISTRY"
echo "== build =="
if [ "${ADRT_SKIP_BUILD:-0}" = "1" ]; then
  ( cd "$ROOT" && npm run build >/dev/null 2>&1 ) || { echo "topology-matrix: build failed" >&2; exit 1; }
elif command -v flock >/dev/null 2>&1; then
  ( cd "$ROOT" && flock "$REGISTRY/.build.lock" npm run build )
else
  ( cd "$ROOT" && npm run build )
fi
export ADRT_SKIP_BUILD=1

# The combination list is the single source of truth in core: read it from the
# freshly built module so the script can never drift from the pure enumeration.
mapfile -t COMBOS < <(TOPO_SIG_MODULE="file://$ROOT/dist/core/topology.js" node --input-type=module -e '
const mod = await import(process.env.TOPO_SIG_MODULE);
for (const c of mod.TOPOLOGY_COMBINATIONS) {
  console.log([c.id, c.screens, c.orientations, c.arrangement, c.monitors, c.signature, c.label].join("\t"));
}')
if [ "${#COMBOS[@]}" -eq 0 ]; then
  echo "topology-matrix: no combinations found (is dist/core/topology.js built?)" >&2
  exit 1
fi

# The signature Mutter is actually reporting, computed by the same pure module.
realized_signature() {
  bash "$NESTED" dbus DumpState | python3 "$PARSE" | \
    TOPO_SIG_MODULE="file://$ROOT/dist/core/topology.js" node --input-type=module -e '
const mod = await import(process.env.TOPO_SIG_MODULE);
let body = "";
for await (const chunk of process.stdin) body += chunk;
process.stdout.write(mod.topologySignature(JSON.parse(body).monitors));
'
}

# Put the real virtual monitors into an arrangement. Screens are assigned to
# grid cells by their *orientation* (not by the order the Shell started them
# in), so the realised signature is the combination's regardless of GNOME'"'"'s
# ordering; cells are sized to their widest/tallest member, exactly as
# `comboScreens` computes.
arrange_monitors() {
  local arrangement="$1" orientations="$2" json
  json="$(bash "$NESTED" dbus DumpState | python3 "$PARSE")"
  ARRANGEMENT="$arrangement" ORIENTATIONS="$orientations" DUMP_JSON="$json" \
    DBUS_SESSION_BUS_ADDRESS="$(cat "$STATE/bus")" python3 - <<'PY'
import json, os, subprocess, sys
from collections import defaultdict, deque
arrangement = os.environ["ARRANGEMENT"]
wanted = os.environ["ORIENTATIONS"]
d = json.loads(os.environ["DUMP_JSON"])
mons = sorted(d["monitors"], key=lambda m: m["index"])
n = len(mons)
if n != len(wanted):
    raise SystemExit(f"harness has {n} monitors, combination wants {len(wanted)}")

def orientation(m):
    g = m["geometry"]
    return "P" if g["height"] > g["width"] else "L"

# Assign the wanted orientation sequence to monitors of that orientation.
avail = defaultdict(deque)
for m in mons:
    avail[orientation(m)].append(m)
ordered = []
for o in wanted:
    if not avail[o]:
        raise SystemExit(f"no {o} monitor available for the requested orientation pattern")
    ordered.append(avail[o].popleft())

cells = {
    "single": [(0, 0)],
    "row": [(i, 0) for i in range(n)],
    "column": [(0, i) for i in range(n)],
    "l": [(0, 0), (1, 0), (0, 1)],
    "grid": [(0, 0), (1, 0), (0, 1), (1, 1)],
}[arrangement]

colw, rowh = {}, {}
for (c, r), m in zip(cells, ordered):
    g = m["geometry"]
    colw[c] = max(colw.get(c, 0), g["width"])
    rowh[r] = max(rowh.get(r, 0), g["height"])

def at(c, r):
    return sum(colw.get(j, 0) for j in range(c)), sum(rowh.get(k, 0) for k in range(r))

args = ["gdctl", "set"]
for i, (m, (c, r)) in enumerate(zip(ordered, cells)):
    x, y = at(c, r)
    args += ["--logical-monitor", "--monitor", m["connector"]]
    if i == 0:
        args += ["--primary"]
    args += ["--x", str(x), "--y", str(y)]
subprocess.run(args, check=True)
PY
}

# Wait until the rearranged monitors settle on the expected signature.
wait_signature() {
  local expected="$1" timeout="${2:-20}" got
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    got="$(realized_signature)"
    [ "$got" = "$expected" ] && return 0
    sleep 0.5
  done
  return 1
}

classify() {
  local output="$1" rc="$2"
  if printf '%s\n' "$output" | grep -q '^FAIL'; then printf 'FAIL'
  elif printf '%s\n' "$output" | grep -q '^SKIP'; then printf 'SKIP'
  elif [ "$rc" -eq 0 ]; then printf 'PASS'
  else printf 'FAIL'; fi
}

# Install the extension into the matrix's own state dir once; each combination
# then only restarts the Shell with a new ADRT_MONITORS.
echo "== install =="
ADRT_STATE_DIR="$STATE" bash "$NESTED" reset >/dev/null 2>&1 || {
  echo "topology-matrix: nested install failed" >&2; exit 1; }

declare -a RESULT_IDS=() RESULT_SIGS=() RESULT_ARR=() RESULT_STATUS=() RESULT_DETAIL=()
failures=0
skips=0
total=0
printf '\n%-16s %-34s %-8s %-6s %s\n' "combination" "signature" "arrange" "result" "detail"
printf -- '---------------------------------------------------------------------------------------------\n'

for row in "${COMBOS[@]}"; do
  IFS=$'\t' read -r id screens orientations arrangement monitors signature label <<<"$row"
  if [ -n "$FILTER" ] && ! printf '%s' "$id" | grep -qE "$FILTER"; then
    continue
  fi
  total=$((total + 1))

  ADRT_STATE_DIR="$STATE" bash "$NESTED" stop >/dev/null 2>&1 || true
  export ADRT_STATE_DIR="$STATE" ADRT_MONITORS="$monitors"
  if ! bash "$NESTED" start >/dev/null 2>&1; then
    status=FAIL; detail="nested Shell failed to start"
  elif ! bash "$NESTED" wait-adrt 60 >/dev/null 2>&1; then
    status=FAIL; detail="adrt D-Bus did not appear"
  else
    if ! arrange_monitors "$arrangement" "$orientations" >/tmp/topology-arrange.err 2>&1; then
      status=FAIL; detail="gdctl could not arrange the $arrangement"
    elif ! wait_signature "$signature" 20; then
      status=FAIL; detail="wanted $signature, got $(realized_signature)"
    else
      out="$(ADRT_STATE_DIR="$STATE" ADRT_MONITORS="$monitors" ADRT_TOPO_EXPECT="$signature" \
        bash "$SCENARIO" 2>&1)"
      rc=$?
      status="$(classify "$out" "$rc")"
      detail=""
      if [ "$status" = "SKIP" ]; then
        detail="the case did not match its own topology"
      fi
      if [ "$status" = "FAIL" ]; then
        detail="$(printf '%s\n' "$out" | grep -m1 '^FAIL' | cut -c1-120)"
      fi
    fi
  fi
  bash "$NESTED" stop >/dev/null 2>&1 || true

  [ "$status" = "FAIL" ] && failures=$((failures + 1))
  [ "$status" = "SKIP" ] && skips=$((skips + 1))
  RESULT_IDS+=("$id"); RESULT_SIGS+=("$signature"); RESULT_ARR+=("$arrangement")
  RESULT_STATUS+=("$status"); RESULT_DETAIL+=("$detail")
  printf '%-16s %-34s %-8s %-6s %s\n' "$id" "$signature" "$arrangement" "$status" "$detail"
done

echo
echo "combinations=$total failures=$failures skips=$skips"
[ "$failures" -eq 0 ]
