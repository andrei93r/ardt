#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A143 §9 float exactness: a window that was floating before a display change
# stays floating, and is restored to the exact frame and stacking it was left
# at — through a disconnect (its screen vanishes) and a reconnect (it returns).
# The rescue may move it to a valid screen so it is not lost, but the replay
# must not adapt, clamp, re-centre or re-stack it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A143-float-restore-exact: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A143 needs two monitors to exercise a float rescue"
  summary
  exit 0
fi

# A pair on the secondary, so the float has context to stack against.
spawn_window >/dev/null
wait_count 1 15 || true
A="$(list_ids)"
move_to_monitor "$A" 1 right
spawn_window >/dev/null
wait_count 2 20 || true
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | xargs)"
move_to_monitor "$B" 1 right
wait_settled 15

# A float on the same secondary. Force the float state (a cross-screen arrival
# onto a full single-workspace screen already floats, but do not depend on it).
spawn_window >/dev/null
wait_count 3 20 || true
F="$(list_ids | tr ' ' '\n' | grep -v -e "^$A$" -e "^$B$" | xargs)"
move_to_monitor "$F" 1 right
wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$F and w['monitor']==1] else 1)" || true
# Let the arrival settle before placing it: a late reconcile must not re-centre
# the float after the test has set its frame.
wait_settled 15
if [ "$(window_field "$F" layer)" != "2" ]; then adrt ToggleFloat "$F" >/dev/null; fi
wait_settled 15
# A known, exact frame well inside the secondary (1280..2080 × 0..1280) and
# clearly not the centred default (608×1088), so the assertion is meaningful.
adrt MoveWindow "$F" 1400 200 500 400 >/dev/null
wait_settled 15

export ADRT_FLOAT_ID="$F"
export ADRT_BEFORE="$(dump | python3 -c "
import json, sys
d = json.load(sys.stdin)
f = [w for w in d['windows'] if w['id'] == $F]
if not f:
    print('{}'); sys.exit(0)
w = f[0]
print(json.dumps({'rect': w['rect'], 'z': w['z'], 'monitor': w['monitor'], 'layer': w['layer'], 'workspace': w['workspace']}))
")"
echo "float before: $ADRT_BEFORE"
if [ "$ADRT_BEFORE" = "{}" ]; then fail "the float was not created"; ensure_clean; summary; exit $?; fi

# Disconnect the secondary: the float is rescued to the primary so it is not lost.
export ADRT_VANISHED="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
other = [m["connector"] for m in d["monitors"] if not m["isPrimary"]]
print(other[0] if other else "")
')"
fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null
poll "the vanished float survives the disconnect, still floating" '
import json, os, sys
d = json.load(sys.stdin)
f = [w for w in d["windows"] if w["id"] == int(os.environ["ADRT_FLOAT_ID"])]
if not f:
    print("float lost"); sys.exit(1)
if f[0]["layer"] != 2:
    print("float became a tile", f[0]["layer"]); sys.exit(1)
print("rescued float on monitor", f[0]["monitor"])
' 25

# Reconnect: the remembered float replays to its exact frame and stacking.
adrt SimulateScreens null >/dev/null
poll "the float returns to its exact frame and stacking on the reconnected screen" '
import json, os, sys
d = json.load(sys.stdin)
f = [w for w in d["windows"] if w["id"] == int(os.environ["ADRT_FLOAT_ID"])]
if not f:
    print("float lost on reconnect"); sys.exit(1)
w = f[0]
before = json.loads(os.environ["ADRT_BEFORE"])
if w["layer"] != 2:
    print("not floating after replay", w["layer"]); sys.exit(1)
if w["monitor"] != before["monitor"]:
    print("monitor", w["monitor"], "expected", before["monitor"]); sys.exit(1)
if w["rect"] != before["rect"]:
    print("rect", w["rect"], "expected", before["rect"]); sys.exit(1)
if w["z"] != before["z"]:
    print("z", w["z"], "expected", before["z"]); sys.exit(1)
print("restored exactly", w["rect"], "z", w["z"])
' 25

poll "the connector is still remembered after the replay" '
import json, os, sys
d = json.load(sys.stdin)
if os.environ["ADRT_VANISHED"] not in d.get("displayMemory", []):
    print("memory", d.get("displayMemory")); sys.exit(1)
print("memory", d.get("displayMemory"))
' 15

adrt SimulateScreens null >/dev/null
ensure_clean
summary
