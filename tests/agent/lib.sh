# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# Shared helpers for the autonomous agent scenarios (§40.3). Source this file;
# do not execute it directly.

set -uo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../.." && pwd)"
export ADRT_STATE_DIR="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}"
PARSE="$AGENT_DIR/parse.py"
NESTED="$ROOT_DIR/scripts/nested-shell.sh"

TEST_CLIENT="${ADRT_TEST_CLIENT:-gnome-text-editor --new-window}"

failures=0
checks=0

log() { printf '%s\n' "$*"; }

pass() {
  checks=$((checks + 1))
  printf 'PASS  %s\n' "$*"
}

fail() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf 'FAIL  %s\n' "$*"
}

skip() {
  printf 'SKIP  %s\n' "$*"
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected '$expected', got '$actual')"; fi
}

assert_true() {
  local label="$1" value="$2"
  if [ "$value" = "true" ]; then pass "$label"; else fail "$label (got '$value')"; fi
}

adrt() {
  bash "$NESTED" dbus "$@"
}

adrt_json() {
  adrt "$@" | python3 "$PARSE"
}

dump() {
  adrt DumpState | python3 "$PARSE"
}

spawn_window() {
  local command="${1:-$TEST_CLIENT}"
  adrt SpawnWindow "$command" | python3 "$PARSE"
}

close_window() {
  adrt CloseWindow "$1" >/dev/null 2>&1 || true
}

list_ids() {
  adrt ListWindows | python3 "$PARSE" | python3 -c 'import json,sys; print(" ".join(str(w["id"]) for w in json.load(sys.stdin)))'
}

count_windows() {
  dump | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["windows"]))'
}

window_field() {
  local id="$1" field="$2"
  dump | python3 -c "
import json,sys
data = json.load(sys.stdin)
for w in data['windows']:
    if w['id'] == int('$id'):
        print(w['$field'])
        break
"
}

state_expr() {
  dump | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"
}

border_visible() {
  state_expr 'str(d["border"]["visible"]).lower()'
}

wait_for() {
  local timeout="$1"; shift
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

wait_count() {
  local target="$1" timeout="${2:-20}"
  wait_for "$timeout" bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" -ge '$target' ]"
}

# Run a python snippet against the current DumpState; exit non-zero to fail.
check_python() {
  local label="$1" code="$2" out
  if out="$(dump | python3 -c "$code" 2>&1)"; then
    pass "$label${out:+ — $out}"
  else
    fail "$label${out:+ — $out}"
  fi
}

close_all() {
  local ids
  ids="$(list_ids)"
  for id in $ids; do close_window "$id"; done
}

ensure_clean() {
  close_all
  wait_for 20 bash -c "[ \"\$(bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys;print(len(json.load(sys.stdin)[\"windows\"]))')\" = 0 ]" || true
  adrt ResetLayoutState >/dev/null 2>&1 || true
  sleep 0.5
}

open_pair() {
  spawn_window >/dev/null
  wait_count 1 20 || true
  spawn_window >/dev/null
  wait_count 2 20 || true
  sleep 1
}

ext_dir() {
  echo "$ADRT_STATE_DIR/data/gnome-shell/extensions/adrt@adrt.dev"
}

set_setting() {
  GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ADRT_STATE_DIR/config" \
    GSETTINGS_SCHEMA_DIR="$(ext_dir)/schemas" \
    gsettings set org.gnome.shell.extensions.adrt "$1" "$2"
}

get_setting() {
  GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ADRT_STATE_DIR/config" \
    GSETTINGS_SCHEMA_DIR="$(ext_dir)/schemas" \
    gsettings get org.gnome.shell.extensions.adrt "$1"
}

history_file() {
  echo "$ADRT_STATE_DIR/data/adrt/history/$(date +%F).jsonl"
}

summary() {
  echo
  echo "checks=$checks failures=$failures"
  [ "$failures" -eq 0 ]
}