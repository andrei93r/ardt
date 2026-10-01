#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A143 §9 exact float restore: a floated window is remembered with its exact
# rect by connector, rescued to the primary as a float on a disconnect, and
# replayed back as a float on reconnect — never tiled, never flattened. A110
# proves the tileable pair replay; this is the float half, and it asserts the
# remembered rect as well as the float flag.
#
# Run with the two-monitor matrix; the physical dock is the user's acceptance
# run (MANUAL.md). The screen list is a `SimulateScreens` fixture.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 2 screens; on another count the same rules are
# exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A143-reconnect-restores-float: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A143 needs two monitors to exercise a float reconnect"
  summary
  exit 0
fi

spawn_window >/dev/null
wait_count 1 15 || true
A="$(list_ids)"
move_to_monitor "$A" 1 right
wait_settled 12

# Float it on the second screen and remember exactly where it was.
adrt ActivateWindow "$A" >/dev/null
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $A else 1)" || true
if [ "$(window_field "$A" layer)" != "2" ]; then
  adrt ToggleFloat "$A" >/dev/null
  wait_settled 12
fi
if ! wait_python 15 "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $A), None)
sys.exit(0 if w is not None and w['monitor'] == 1 and w['layer'] == 2 else 1)"; then
  fail "the window could not be floated on the second screen"
  ensure_clean
  summary
  exit $?
fi
read -r rx ry rw rh <<<"$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
w = next(x for x in d['windows'] if x['id'] == $A)
r = w['rect']
print(r['x'], r['y'], r['width'], r['height'])
")"
vanished="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
other = [m["connector"] for m in d["monitors"] if not m["isPrimary"]]
print(other[0] if other else "")
')"
echo "floated A=$A rect=${rx},${ry} ${rw}x${rh} vanished=$vanished"

# Unplug: the vanishing connector's memory records the float at its exact rect.
fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null

# The remembered arrangement is GetDisplayMemory, not DumpState (which only
# lists connector names), so this needs its own predicate source.
memory_poll() {
  local label="$1" code="$2" limit="${3:-20}" out deadline
  deadline=$((SECONDS + limit))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if adrt GetDisplayMemory | python3 "$PARSE" | python3 -c "$code" >/dev/null 2>&1; then
      pass "$label"
      return
    fi
    sleep 0.5
  done
  out="$(adrt GetDisplayMemory | python3 "$PARSE" | python3 -c "$code" 2>&1 || true)"
  fail "$label${out:+ — $out}"
}

memory_poll "the vanished connector remembers the float and its exact rect" '
import json, sys
mem = json.load(sys.stdin)
entry = next((e for e in mem if e.get("connector") == "'"$vanished"'"), None)
if entry is None:
    print("memory", mem); sys.exit(1)
win = next((w for w in entry["windows"] if w["id"] == '"$A"'), None)
if win is None:
    print("window not remembered", entry); sys.exit(1)
if not win.get("floating"):
    print("not remembered as a float", win); sys.exit(1)
r = win.get("rect") or {}
if (r.get("x"), r.get("y"), r.get("width"), r.get("height")) != ('"$rx"', '"$ry"', '"$rw"', '"$rh"'):
    print("rect", r, "expected", ('"$rx"', '"$ry"', '"$rw"', '"$rh"')); sys.exit(1)
print("remembered float", win["id"], r)
' 20

poll_decisions "the rescue kept the float flag" '
import json, sys
entries = json.load(sys.stdin)
moves = [e for e in entries if e.get("ev") == "display_move" and e.get("id") == '"$A"']
if not moves:
    print("no display_move for the float"); sys.exit(1)
if not any(m.get("float") is True and m.get("create") is not None for m in moves):
    print("rescue moves", moves); sys.exit(1)
print("rescue float", moves[-1])
' 20

poll "the rescued float stays a float on the primary" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == '"$A"'), None)
sys.exit(0 if w is not None and w["layer"] == 2 else 1)
' 20

# Reconnect: the plan replays it through the float path (never a slot).
adrt SimulateScreens null >/dev/null

poll_decisions "the replay chose the float path" '
import json, sys
entries = json.load(sys.stdin)
moves = [e for e in entries if e.get("ev") == "display_move" and e.get("id") == '"$A"']
if not moves:
    print("no replay move for the float"); sys.exit(1)
if not any(m.get("float") is True and m.get("create") is None for m in moves):
    print("replay moves", moves); sys.exit(1)
print("replayed float", moves[-1])
' 25

poll "the window is still a float after the replay, never tiled" '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == '"$A"'), None)
if w is None:
    print("window lost"); sys.exit(1)
if w["layer"] != 2:
    print("not floating after replay", w["layer"]); sys.exit(1)
print("float replayed on monitor", w["monitor"], w["rect"])
' 25

ensure_clean
summary
