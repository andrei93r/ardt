# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Helpers for the live-session scenarios. These run against the *real* GNOME
# Shell, so they only ever touch windows they spawn themselves and restore the
# workspace they started on. Source this file; do not execute it.

set -uo pipefail

SESSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SESSION_DIR/../.." && pwd)"
PARSE="$ROOT_DIR/tests/agent/parse.py"

TEST_CLIENT="${ADRT_SESSION_CLIENT:-gnome-text-editor --new-window}"

checks=0
failures=0
BASE_IDS=""
START_WS=0

log() { printf '%s\n' "$*"; }
pass() { checks=$((checks + 1)); printf 'PASS  %s\n' "$*"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf 'FAIL  %s\n' "$*"; }
skip() { printf 'SKIP  %s\n' "$*"; }

adrt() {
  gdbus call --session --dest org.adrt.Adrt --object-path /org/adrt/Adrt \
    --method "org.adrt.Adrt.$1" -- "${@:2}"
}

json() { adrt "$@" | python3 "$PARSE"; }
dump() { adrt DumpState | python3 "$PARSE"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected '$expected', got '$actual')"; fi
}

assert_true() {
  local label="$1" value="$2"
  if [ "$value" = "true" ]; then pass "$label"; else fail "$label (got '$value')"; fi
}

check_python() {
  local label="$1" code="$2" out
  if out="$(dump | python3 -c "$code" 2>&1)"; then
    pass "$label${out:+ — $out}"
  else
    fail "$label${out:+ — $out}"
  fi
}

wait_python() {
  local timeout="$1" code="$2"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if dump | python3 -c "$code" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

state_expr() { dump | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

windows_json() { dump; }

list_ids() {
  adrt ListWindows | python3 "$PARSE" | python3 -c 'import json,sys; print(" ".join(str(w["id"]) for w in json.load(sys.stdin)))'
}

require_adrt() {
  if ! adrt DumpState >/dev/null 2>&1; then
    echo "session-test: Adrt is not running on the session bus" >&2
    exit 2
  fi
}

# Before: remember existing windows and the current workspace, so cleanup can
# restore everything.
session_begin() {
  require_adrt
  BASE_IDS="$(list_ids)"
  START_WS="$(state_expr 'd["activeWorkspace"]')"
}

test_ids() {
  BASE_IDS="$BASE_IDS" list_ids | python3 -c '
import os, sys
base = set(os.environ["BASE_IDS"].split())
now = [w for w in sys.stdin.read().split() if w]
print(" ".join(w for w in now if w not in base))
'
}

spawn() {
  adrt SpawnWindow "${1:-$TEST_CLIENT}" >/dev/null
  sleep 2
}

count_tests() { test_ids | tr ' ' '\n' | grep -c . || true; }

# The two test windows ordered left-to-right, as "left right".
test_pair_by_x() {
  TEST_IDS="$(test_ids)" dump | python3 -c '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
ws = sorted((w for w in json.load(sys.stdin)["windows"] if w["id"] in ids), key=lambda w: w["rect"]["x"])
print(" ".join(str(w["id"]) for w in ws[:2]))
'
}

wait_tests() {
  local target="$1" timeout="${2:-25}"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(count_tests)" -ge "$target" ] && return 0
    sleep 0.5
  done
  return 1
}

close_tests() {
  local id
  for id in $(test_ids); do adrt CloseWindow "$id" >/dev/null 2>&1 || true; done
}

session_cleanup() {
  close_tests
  adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true
}

summary() {
  session_cleanup
  echo
  echo "checks=$checks failures=$failures"
  [ "$failures" -eq 0 ]
}
