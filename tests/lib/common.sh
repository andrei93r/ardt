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
