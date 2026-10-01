#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A110 §9 reconnect: a remembered connector replays its previous state —
# slot occupants back into their slots, matched by instance id, clamped to the
# fresh work area. It never floats a window and never creates a workspace.
#
# Run with the two-monitor matrix; the physical dock is the user's acceptance
# run (MANUAL.md). The screen list is a `SimulateScreens` fixture.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 2 screens; on another
# count the same rules are exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A110-reconnect-replays-state: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A110 needs two monitors to exercise a reconnect"
  summary
  exit 0
fi

spawn_window >/dev/null
wait_count 1 15 || true
A="$(list_ids)"
move_to_monitor "$A" 1 right
spawn_window >/dev/null
wait_count 2 20 || true
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | xargs)"
move_to_monitor "$B" 1 right
wait_settled 15
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
sys.exit(0 if len(ws) >= 2 and all(w["monitor"] == 1 for w in ws) and len({w["workspace"] for w in ws}) == 1 else 1)' || true

# The slots the pair holds before the unplug.
before="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["rect"]["x"])
print(" ".join("%d:%s" % (w["id"], w.get("slot")) for w in ws))
')"
echo "slots before: $before"
ids_csv="$(python3 -c 'print(",".join(p.split(":")[0] for p in "'"$before"'".split()))')"
vanished="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
other = [m["connector"] for m in d["monitors"] if not m["isPrimary"]]
print(other[0] if other else "")
')"

fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null
wait_python 20 '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"]]
sys.exit(0 if len(ws) >= 2 else 1)' || true

# Reconnect: restore the real screen list and let memory replay.
adrt SimulateScreens null >/dev/null

poll "the reconnected screen replays the pair into its previous slots" '
import json, sys
d = json.load(sys.stdin)
ids = set(int(x) for x in "'"$ids_csv"'".split(","))
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) != len(ids):
    print("window lost"); sys.exit(1)
if any(w["monitor"] != 1 for w in ws):
    print("not back on the reconnected screen", [(w["id"], w["monitor"]) for w in ws]); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("pair split across workspaces"); sys.exit(1)
if any(w["layer"] == 2 for w in ws):
    print("a window was floated by replay"); sys.exit(1)
expected = {}
for part in "'"$before"'".split():
    wid, slot = part.split(":")
    expected[int(wid)] = None if slot == "None" else int(slot)
for w in ws:
    want = expected.get(w["id"])
    if want is not None and w.get("slot") != want:
        print("slot for", w["id"], "is", w.get("slot"), "expected", want); sys.exit(1)
print("replayed", [(w["id"], w.get("slot")) for w in ws])
' 25

poll "the connector is still remembered after the replay" '
import json, sys
d = json.load(sys.stdin)
mem = d.get("displayMemory", [])
if "'"$vanished"'" not in mem:
    print("memory", mem); sys.exit(1)
print("memory", mem)
' 15

ensure_clean
summary
