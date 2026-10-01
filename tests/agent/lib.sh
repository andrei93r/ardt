# Generaset -uo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSE="$AGENT_DIR/parse.py"
export ADRT_STATE_DIR="${ADRT_STATE_DIR:-${XDG_RUNTIME_DIR:-/tmp}/adrt-nested}"

# shellcheck source=tests/lib/common.sh
source "$AGENT_DIR/../lib/common.sh"

NESTED="$ROOT_DIR/scripts/nested-shell.sh"
TEST_CLIENT="${ADRT_TEST_CLIENT:-gnome-text-editor --new-window}"

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

# The last N decisions (journal), as JSON.
decisions_json() { adrt DumpDecisions "${1:-400}" | python3 "$PARSE"; }

# Block until a python predicate over DumpDecisions succeeds.
wait_decisions() {
  local timeout="$1" code="$2"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if decisions_json 400 | python3 -c "$code" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

poll_decisions() {
  local label="$1" code="$2" timeout="${3:-20}" out
  if wait_decisions "$timeout" "$code"; then
    pass "$label"
  else
    out="$(decisions_json 400 | python3 -c "$code" 2>&1 || true)"
    fail "$label${out:+ — $out}"
  fi
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

# Build a `SimulateScreens` fixture from the current DumpState. With `keep > 0`
# only the leftmost `keep` monitors are kept, which simulates an unplug.
screens_fixture() {
  local keep="${1:-0}"
  dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
mons = sorted(d['monitors'], key=lambda m: m['geometry']['x'])
if ${keep} > 0:
    mons = mons[:${keep}]
out = []
for m in mons:
    g = m['geometry']
    a = m.get('workArea') or g
    out.append({
        'index': m['index'], 'connector': m['connector'],
        'x': g['x'], 'y': g['y'], 'width': g['width'], 'height': g['height'],
        'isPrimary': m['isPrimary'], 'workArea': a,
    })
print(json.dumps(out))
"
}

# Move a window to another monitor with a directional move. `MoveDirection` acts
# on the focused window, so focus is re-derived as a property first; the move
# itself is confirmed by the caller's own poll, not by a clock here.
move_to_monitor() {
  local id="$1" target="$2" direction="${3:-right}"
  adrt ActivateWindow "$id" >/dev/null
  wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $id else 1)" || true
  adrt MoveDirection "$direction" >/dev/null
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
  # A headless Shell starts in the overview, and tiling is suspended there by
  # design; make sure every scenario starts with it closed.
  adrt SimulateOverview false >/dev/null 2>&1 || true
  # Never leak a workspace orientation set by a scenario.
  adrt SimulateWorkspaceOrientation false >/dev/null 2>&1 || true
  # Nor a relaxed min-size policy.
  set_setting min-size-policy respect >/dev/null 2>&1 || true
  # Nor a screen class set by a single/fixed-workspace scenario (§1).
  set_system_setting org.gnome.mutter dynamic-workspaces true >/dev/null 2>&1 || true
  set_system_setting org.gnome.mutter workspaces-only-on-primary true >/dev/null 2>&1 || true
  set_system_setting org.gnome.desktop.wm.preferences num-workspaces 4 >/dev/null 2>&1 || true
  # Nor a display fixture or remembered arrangement left by a display scenario.
  adrt SimulateScreens null >/dev/null 2>&1 || true
  adrt ForgetDisplayMemory >/dev/null 2>&1 || true
  sleep 0.5
}

# Set the number of static workspaces (dynamic workspaces off) for a scenario.
set_static_workspaces() {
  local count="$1"
  set_system_setting org.gnome.mutter dynamic-workspaces false
  set_system_setting org.gnome.desktop.wm.preferences num-workspaces "$count"
  sleep 1
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

# ------------------------------------------------------------------ injection
# Real input through the compositor's own seat (Stage 0). The nested Shell is
# started with ADRT_INJECT=1 by the harness; without it these are no-ops.

probe_json() {
  adrt ProbePlatform 2>/dev/null | python3 "$PARSE" 2>/dev/null || true
}

# probe_supports <key>: the probe JSON has a truthy <key> (nested paths with a
# dot, e.g. laters.beforeRedraw).
probe_supports() {
  probe_json | python3 -c "
import json, sys
d = json.load(sys.stdin)
for part in '$1'.split('.'):
    d = d.get(part, False) if isinstance(d, dict) else False
sys.exit(0 if d else 1)" 2>/dev/null
}

journal_tail() {
  local n="${1:-200}" filter="${2:-}"
  adrt DumpEvents "$n" "$filter" 2>/dev/null | python3 "$PARSE" 2>/dev/null || true
}

inject_pointer() {
  adrt InjectPointerMove "$1" "$2" >/dev/null 2>&1 || true
}

# One key, press or release. Keyvals are X11 keysyms (xev names): Super 65515,
# Alt 65511, Ctrl 65507, Shift 65505, grave 96, a..z = ord(letter).
# Wait until a counter has grown by at least one. A loaded machine can starve a
# periodic pass past a fixed measurement window, so measure to a budget.
wait_counter_grows() {
  local name="$1" timeout="${2:-20}" base now
  base="$(counter "$name")"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    now="$(counter "$name")"
    if [ "$now" -gt "$base" ] 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

inject_key() {
  adrt InjectKey "$1" "$2" >/dev/null 2>&1 || true
  sleep 0.15
}

# A key combination: press each in order, release in reverse. `inject_hotkey 65515 122`
# is Super+Z.
inject_hotkey() {
  local keyval
  for keyval in "$@"; do inject_key "$keyval" true; done
  sleep 0.2
  local reverse=()
  for keyval in "$@"; do reverse=("$keyval" "${reverse[@]}"); done
  for keyval in "${reverse[@]}"; do inject_key "$keyval" false; done
  sleep 0.2
}

inject_click() {
  local x="$1" y="$2"
  inject_pointer "$x" "$y"; sleep 0.25
  adrt InjectPointerButton 1 true >/dev/null 2>&1 || true; sleep 0.2
  adrt InjectPointerButton 1 false >/dev/null 2>&1 || true; sleep 0.2
}

inject_drag() {
  local x1="$1" y1="$2" x2="$3" y2="$4" steps="${5:-10}" i x y
  inject_pointer "$x1" "$y1"; sleep 0.25
  adrt InjectPointerButton 1 true >/dev/null 2>&1 || true; sleep 0.25
  for i in $(seq 1 "$steps"); do
    x=$((x1 + (x2 - x1) * i / steps))
    y=$((y1 + (y2 - y1) * i / steps))
    inject_pointer "$x" "$y"
    sleep 0.06
  done
  sleep 0.25
  adrt InjectPointerButton 1 false >/dev/null 2>&1 || true
  sleep 0.2
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