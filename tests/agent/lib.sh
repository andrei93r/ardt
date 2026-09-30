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

# Numeric comparison for the performance scenarios:
#   assert_num <label> <op> <value> <threshold>     e.g. assert_num "idle builds" == 0 "$delta"
assert_num() {
  local label="$1" op="$2" value="$3" threshold="$4"
  if python3 -c "
import operator, sys
ops = {'==': operator.eq, '>': operator.gt, '<': operator.lt, '>=': operator.ge, '<=': operator.le}
try:
    ok = ops['$op'](float('$value'), float('$threshold'))
except ValueError:
    ok = False
sys.exit(0 if ok else 1)
" 2>/dev/null; then
    pass "$label"
  else
    fail "$label (got '$value', expected $op $threshold)"
  fi
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

# Stage 0 diagnostics (PERFORMANCE_PLAN.md): the whole counter block, as JSON.
counters() {
  dump | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("counters", {})))'
}

# One counter's current value; prints MISSING when the counter does not exist.
counter() {
  dump | python3 -c "
import json,sys
c = json.load(sys.stdin).get('counters', {})
print(c.get('$1', 'MISSING'))
"
}

# How much a counter grew over N seconds (default 3). NAN when it is missing.
counter_delta() {
  local name="$1" secs="${2:-3}" before after
  before="$(counter "$name")"
  sleep "$secs"
  after="$(counter "$name")"
  python3 -c "
try:
    print(round(float('$after') - float('$before'), 3))
except ValueError:
    print('NAN')
"
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

# Poll a python predicate until it holds, then pass; on timeout report the
# failing state. Prefer this over sampling once when a retile may be settling.
poll() {
  local label="$1" code="$2" timeout="${3:-12}" out
  if wait_python "$timeout" "$code"; then
    pass "$label"
  else
    out="$(dump | python3 -c "$code" 2>&1 || true)"
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
  # A headless Shell starts in the overview, and tiling is suspended there by
  # design; make sure every scenario starts with it closed.
  adrt SimulateOverview false >/dev/null 2>&1 || true
  # Never leak a workspace orientation set by a scenario.
  adrt SimulateWorkspaceOrientation false >/dev/null 2>&1 || true
  # Nor a relaxed min-size policy.
  set_setting min-size-policy respect >/dev/null 2>&1 || true
  sleep 0.5
}

open_pair() {
  spawn_window >/dev/null
  wait_count 1 15 || true
  spawn_window >/dev/null
  wait_count 2 15 || true
  wait_pair_tiled 25 || true
  # Both windows must actually share a workspace. A spawn race can otherwise
  # leave one on its own workspace (maximized), which is "non-overlapping" but
  # not a pair, and makes tiling assertions flaky under load.
  wait_python 15 '
import json, sys
d = json.load(sys.stdin)
ws = [w["workspace"] for w in d["windows"] if w["tileable"]]
sys.exit(0 if len(ws) >= 2 and len(set(ws)) == 1 else 1)' || true
}

ext_dir() {
  echo "$ADRT_STATE_DIR/data/gnome-shell/extensions/adrt@adrt.dev"
}

# Set a key on another schema (e.g. org.gnome.desktop.interface) in the same
# isolated keyfile store the nested Shell reads.
set_system_setting() {
  GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ADRT_STATE_DIR/config" \
    gsettings set "$1" "$2" "$3"
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

# ydotool is only usable when ydotoold is running with /dev/uinput access.
ydotool_ready() {
  command -v ydotool >/dev/null 2>&1 || return 1
  pgrep -x ydotoold >/dev/null 2>&1 || return 1
  return 0
}

# Keyboard injection needs a compositor that owns the input seat. A nested
# headless Shell does not, so keybindings only work against the live session.
keyboard_injection_ready() {
  [ "${ADRT_TARGET:-nested}" = "session" ] || return 1
  ydotool_ready
}

summary() {
  # A scenario that still has windows must have left them tiled coherently:
  # no two tiled windows stacked, each inside its work area. Floating windows
  # (layer 2) legitimately sit above the tiles. This is what stops a
  # stacked/untiled result from passing on a narrow assertion.
  if [ "$(count_windows)" -gt 0 ]; then
    if wait_python 10 '
import json, sys
d = json.load(sys.stdin)
area = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
byws = {}
for w in tiles:
    byws.setdefault((w["monitor"], w["workspace"]), []).append(w)
for key, group in byws.items():
    a = area[key[0]]
    for w in group:
        r = w["rect"]
        if r["x"] < a["x"] - 2 or r["y"] < a["y"] - 2 or r["x"] + r["width"] > a["x"] + a["width"] + 2 or r["y"] + r["height"] > a["y"] + a["height"] + 2:
            sys.exit(1)
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            x, y = group[i]["rect"], group[j]["rect"]
            if x["x"] < y["x"] + y["width"] - 2 and y["x"] < x["x"] + x["width"] - 2 \
               and x["y"] < y["y"] + y["height"] - 2 and y["y"] < x["y"] + x["height"] - 2:
                sys.exit(1)
sys.exit(0)'; then
      pass "the tiling is coherent (no stacked tiles)"
    else
      check_python "the tiling is coherent (no stacked tiles)" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
print("tiled:", [(w["id"], w["rect"]) for w in tiles]); sys.exit(1)
'
    fi
  fi
  echo
  echo "checks=$checks failures=$failures"
  [ "$failures" -eq 0 ]
}