# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Shared bookkeeping for both scenario runners (agent = nested Shell, session =
# the live one). Each runner defines its own `adrt` (how a D-Bus call is made)
# and its own extras; everything here only needs `adrt` and `dump` to work, and
# is resolved at call time, so the order of sourcing does not matter.
#
# Source this from a runner library; never execute it directly.

set -uo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ROOT_DIR:-$(cd "$COMMON_DIR/../.." && pwd)}"
PARSE="${PARSE:-$ROOT_DIR/tests/agent/parse.py}"

checks=0
failures=0

log() { printf '%s\n' "$*"; }
pass() { checks=$((checks + 1)); printf 'PASS  %s\n' "$*"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf 'FAIL  %s\n' "$*"; }
skip() { printf 'SKIP  %s\n' "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected '$expected', got '$actual')"; fi
}

assert_true() {
  local label="$1" value="$2"
  if [ "$value" = "true" ]; then pass "$label"; else fail "$label (got '$value')"; fi
}

assert_num() {
  local label="$1" value="$2" op="$3" threshold="$4"
  if python3 -c "
import sys
value, threshold = float('$value' or 0), float('$threshold')
sys.exit(0 if {'<': value < threshold, '<=': value <= threshold, '>': value > threshold, '>=': value >= threshold, '==': value == threshold}[$(printf '%q' "$op")] else 1)" 2>/dev/null; then
    pass "$label"
  else
    fail "$label (got '$value', expected $op $threshold)"
  fi
}

json() { adrt "$@" | python3 "$PARSE"; }
adrt_json() { adrt "$@" | python3 "$PARSE"; }
dump() { adrt DumpState | python3 "$PARSE"; }
windows_json() { dump; }

list_ids() {
  adrt ListWindows | python3 "$PARSE" | python3 -c 'import json,sys; print(" ".join(str(w["id"]) for w in json.load(sys.stdin)))'
}

state_expr() { dump | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# ---- topology signature (src/core/topology.ts) -----------------------------
# The resolution-independent signature of the screens DumpState reports. It is
# resolved from the run's private dist snapshot (ADRT_DIST) when the agent
# harness provides one, so the signature a scenario gates on is the same code
# the extension under test was built from; a direct run falls back to the
# checkout's dist.
topology_module() {
  printf 'file://%s/core/topology.js' "${ADRT_DIST:-$ROOT_DIR/dist}"
}

topology_signature() {
  local dist="${ADRT_DIST:-$ROOT_DIR/dist}"
  if [ ! -f "$dist/core/topology.js" ]; then
    printf 'no-topology-module'
    return 1
  fi
  dump | TOPO_SIG_MODULE="file://$dist/core/topology.js" node --input-type=module -e '
const mod = await import(process.env.TOPO_SIG_MODULE);
let body = "";
for await (const chunk of process.stdin) body += chunk;
process.stdout.write(mod.topologySignature(JSON.parse(body).monitors));
'
}

# The canonical signatures the matrix enumerates, one per line.
topology_canonical_signatures() {
  local dist="${ADRT_DIST:-$ROOT_DIR/dist}"
  [ -f "$dist/core/topology.js" ] || return 1
  TOPO_SIG_MODULE="file://$dist/core/topology.js" node --input-type=module -e '
const mod = await import(process.env.TOPO_SIG_MODULE);
for (const combo of mod.TOPOLOGY_COMBINATIONS) console.log(combo.signature);
'
}

# The first hop from screen @1 toward screen @2 over the real adjacency graph:
# two screens are adjacent when they share a row or a column (one axis overlaps,
# the other meets at a seam or leaves a gap). Diagonal targets are routed
# through an intermediate, so the same walk is correct for a row, a column, an
# L or a 2x2 — not only the harness's default row.
topology_next_hop() {
  dump | python3 -c '
import json, sys
from collections import deque
d = json.load(sys.stdin)
mons = {m["index"]: m for m in d["monitors"]}
cur, target = int(sys.argv[1]), int(sys.argv[2])
def adjacent(a, b):
    ga, gb = a["geometry"], b["geometry"]
    ax1, ay1 = ga["x"] + ga["width"], ga["y"] + ga["height"]
    bx1, by1 = gb["x"] + gb["width"], gb["y"] + gb["height"]
    xov = min(ax1, bx1) - max(ga["x"], gb["x"])
    yov = min(ay1, by1) - max(ga["y"], gb["y"])
    return (xov > 0 and yov <= 0) or (yov > 0 and xov <= 0)
if cur not in mons or target not in mons:
    print("none"); raise SystemExit
prev = {cur: None}
q = deque([cur])
while q:
    u = q.popleft()
    if u == target:
        break
    for v in mons:
        if v not in prev and adjacent(mons[u], mons[v]):
            prev[v] = u
            q.append(v)
if target not in prev:
    print("none"); raise SystemExit
path = []
node = target
while node is not None:
    path.append(node); node = prev[node]
path.reverse()
if path[0] != cur or len(path) < 2:
    print("none"); raise SystemExit
nxt, here = mons[path[1]]["geometry"], mons[cur]["geometry"]
dx = (nxt["x"] + nxt["width"] / 2) - (here["x"] + here["width"] / 2)
dy = (nxt["y"] + nxt["height"] / 2) - (here["y"] + here["height"] / 2)
if abs(dx) >= abs(dy):
    print("right" if dx > 0 else "left")
else:
    print("down" if dy > 0 else "up")
' "$1" "$2"
}

# Walk a lone window to screen @2 one adjacent hop at a time, following the
# geometry. A lone window crosses an edge; retrying the same hop covers a late
# apply without a fixed sleep.
topology_move_screen() {
  local id="$1" target="$2" guard=0 cur dir
  while [ "$guard" -lt 10 ]; do
    guard=$((guard + 1))
    cur="$(dump | python3 -c "import json,sys; d=json.load(sys.stdin); print(next((w['monitor'] for w in d['windows'] if w['id'] == $id), -1))")"
    [ "$cur" = "$target" ] && return 0
    dir="$(topology_next_hop "$cur" "$target")"
    if [ -z "$dir" ] || [ "$dir" = "none" ]; then return 1; fi
    adrt ActivateWindow "$id" >/dev/null 2>&1 || true
    adrt MoveDirection "$dir" >/dev/null 2>&1 || true
    if ! wait_python 12 "
import json,sys
d = json.load(sys.stdin)
w = next((w for w in d['windows'] if w['id'] == $id), None)
sys.exit(0 if w is not None and w['monitor'] != $cur else 1)"; then
      sleep 0.5
    fi
  done
  return 1
}

# The first adjacent ordered pair of screens as "src dst direction arrival",
# where arrival is the slot an arrival from that direction takes (§3): 0 from
# left/above, 1 from right/below. "none none none -1" when the topology has no
# adjacency (a single screen).
topology_first_adjacency() {
  dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
mons = sorted(d["monitors"], key=lambda m: (m["geometry"]["y"], m["geometry"]["x"], m["index"]))
def adjacent(a, b):
    ga, gb = a["geometry"], b["geometry"]
    ax1, ay1 = ga["x"] + ga["width"], ga["y"] + ga["height"]
    bx1, by1 = gb["x"] + gb["width"], gb["y"] + gb["height"]
    xov = min(ax1, bx1) - max(ga["x"], gb["x"])
    yov = min(ay1, by1) - max(ga["y"], gb["y"])
    return (xov > 0 and yov <= 0) or (yov > 0 and xov <= 0)
for a in mons:
    for b in mons:
        if a["index"] == b["index"] or not adjacent(a, b):
            continue
        dx = (b["geometry"]["x"] + b["geometry"]["width"] / 2) - (a["geometry"]["x"] + a["geometry"]["width"] / 2)
        dy = (b["geometry"]["y"] + b["geometry"]["height"] / 2) - (a["geometry"]["y"] + a["geometry"]["height"] / 2)
        if abs(dx) >= abs(dy):
            direction = "right" if dx > 0 else "left"
        else:
            direction = "down" if dy > 0 else "up"
        arrival = 0 if direction in ("right", "down") else 1
        print(a["index"], b["index"], direction, arrival)
        raise SystemExit
print("none none none -1")'
}

# Block until a python predicate over DumpState succeeds.
wait_python() {
  local timeout="$1" code="$2"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if dump | python3 -c "$code" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

# A predicate over DumpState, settled before it is called false. A loaded shell
# applies a plan a few hundred milliseconds late, so an assertion that samples
# once is really asserting "the machine is idle" — that is what made scenarios
# flake under many workers. The budget is part of the assertion's meaning; the
# failing state is still reported, one sample after the budget.
check_python() {
  local label="$1" code="$2" budget="${ADRT_CHECK_SETTLE:-8}" out
  if wait_python "$budget" "$code"; then
    out="$(dump | python3 -c "$code" 2>&1 || true)"
    pass "$label${out:+ — $out}"
  else
    out="$(dump | python3 -c "$code" 2>&1 || true)"
    fail "$label${out:+ — $out}"
  fi
}

# Poll a predicate until it holds, then pass; on timeout report the state.
# Prefer this over sampling once whenever a retile may still be settling: it is
# what makes the scenarios safe to run many-at-once under load.
poll() {
  local label="$1" code="$2" timeout="${3:-12}" out
  if wait_python "$timeout" "$code"; then
    pass "$label"
  else
    out="$(dump | python3 -c "$code" 2>&1 || true)"
    fail "$label${out:+ — $out}"
  fi
}

# Report the counts. A runner may override this to add its own final checks
# (the agent runner asserts the tiling is coherent one last time).
summary() {
  echo
  echo "checks=$checks failures=$failures"
  [ "$failures" -eq 0 ]
}
