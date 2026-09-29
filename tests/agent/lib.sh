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

# A stable, order-independent snapshot of every tracked window's geometry.
snapshot_geometry() {
  dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted(d["windows"], key=lambda w: w["id"])
print(";".join(
    "%s:%s,%s,%s,%s@%s" % (w["id"], w["rect"]["x"], w["rect"]["y"], w["rect"]["width"], w["rect"]["height"], w["workspace"])
    for w in ws
))'
}

# Block until the geometry stops changing for three consecutive polls. This is
# what makes the scenarios safe to run many-at-once under load.
wait_settled() {
  local timeout="${1:-25}"
  local deadline=$((SECONDS + timeout)) prev="__init__" same=0 cur
  while [ "$SECONDS" -lt "$deadline" ]; do
    cur="$(snapshot_geometry)"
    if [ "$cur" = "$prev" ]; then
      same=$((same + 1))
      [ "$same" -ge 3 ] && return 0
    else
      same=0
      prev="$cur"
    fi
    sleep 0.4
  done
  return 1
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

wait_border_visible() {
  wait_for "${1:-15}" bash -c "bash '$NESTED' dbus DumpState | python3 '$PARSE' | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)[\"border\"][\"visible\"] else 1)'"
}

# Block until at least two windows are tiled without overlapping.
wait_pair_tiled() {
  local timeout="${1:-25}"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if dump | python3 -c '
import json, sys
ws = [w["rect"] for w in json.load(sys.stdin)["windows"]]
if len(ws) < 2:
    sys.exit(1)
for i in range(len(ws)):
    for j in range(i + 1, len(ws)):
        a, b = ws[i], ws[j]
        if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
            sys.exit(1)
sys.exit(0)'; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_count() {
  local target="$1"
  local timeout="${2:-20}"
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
  wait_count 1 30 || true
  spawn_window >/dev/null
  wait_count 2 30 || true
  wait_pair_tiled 25 || true
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