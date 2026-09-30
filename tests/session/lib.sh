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

TEST_CLIENT="${ADRT_SESSION_CLIENT:-nautilus --new-window}"

checks=0
failures=0
BASE_IDS=""
START_WS=0
USER_WS=0

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
# restore everything. The scenarios run on a workspace that holds no windows,
# so the user's own tileable windows never take part in the layouts under test.
# The lowest-index empty workspace is used, or the active one if it is empty.
pick_sandbox_workspace() {
  dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
n = d["workspaces"]
active = d["activeWorkspace"]
used = {w["workspace"] for w in d["windows"]}
if active not in used:
    print(active)
else:
    free = [i for i in range(n) if i not in used]
    print(free[-1] if free else -1)
'
}

session_begin() {
  require_adrt
  USER_WS="$(state_expr 'd["activeWorkspace"]')"
  export USER_WS
  local sandbox
  sandbox="$(pick_sandbox_workspace)"
  if [ "$sandbox" = "-1" ]; then
    echo "session: every workspace holds a window; move one to another workspace"
    echo "session: and leave one free, then re-run the live suite."
    exit 3
  fi
  START_WS="$sandbox"
  export START_WS
  adrt ActivateWorkspace "$START_WS" >/dev/null 2>&1 || true
  sleep 1
  BASE_IDS="$(list_ids)"
  export BASE_IDS
}

test_ids() {
  list_ids | python3 -c '
import os, sys
base = set(os.environ.get("BASE_IDS", "").split())
now = [w for w in sys.stdin.read().split() if w]
print(" ".join(w for w in now if w not in base))
'
}

spawn() {
  adrt SpawnWindow "${1:-$TEST_CLIENT}" >/dev/null
  sleep 1
}

count_tests() { test_ids | tr ' ' '\n' | grep -c . || true; }

# The two test windows ordered left-to-right, as "left right".
test_pair_by_x() {
  dump | python3 -c '
import json, sys
ids = set(int(x) for x in (sys.argv[1] if len(sys.argv) > 1 else "").split())
ws = sorted((w for w in json.load(sys.stdin)["windows"] if w["id"] in ids), key=lambda w: w["rect"]["x"])
print(" ".join(str(w["id"]) for w in ws[:2]))' "$(test_ids)"
}

# The test window on the highest workspace id.
test_id_on_highest_ws() {
  dump | python3 -c '
import json, sys
ids = set(int(x) for x in (sys.argv[1] if len(sys.argv) > 1 else "").split())
ws = [w for w in json.load(sys.stdin)["windows"] if w["id"] in ids]
print(max(ws, key=lambda w: w["workspace"])["id"])' "$(test_ids)"
}

# Workspace of a window id.
window_workspace() {
  dump | python3 -c '
import json, sys
w = [x for x in json.load(sys.stdin)["windows"] if x["id"] == int(sys.argv[1])]
print(w[0]["workspace"] if w else 0)' "$1"
}

wait_tests() {
  local target="$1" timeout="${2:-12}"
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
  adrt ActivateWorkspace "${USER_WS:-0}" >/dev/null 2>&1 || true
}

summary() {
  session_cleanup
  echo
  echo "checks=$checks failures=$failures"
  [ "$failures" -eq 0 ]
}
