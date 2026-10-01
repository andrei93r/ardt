#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A122 §9 rescue side and order: a vanished screen on the physical right inserts
# its rescued workspaces to the right of the current one, and the pair keeps its
# order (the left window stays in slot 0).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 2 screens; on another
# count the same rules are exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A122-rescue-side-and-order: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A122 needs two monitors to exercise the rescue side"
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

# The pair's slot order on the secondary, before the unplug. The secondary may
# be landscape (slots left/right) or portrait (slots top/bottom), so the order
# is read from the slot each window actually holds, never from x alone: on a
# portrait screen both windows share the same x and an x-sort says nothing.
before="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["id"])
print(" ".join("%d:%s" % (w["id"], w.get("slot")) for w in ws))
')"
echo "slots on the secondary: $before"
viewed="$(state_expr 'd["activeWorkspace"]')"
fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null

poll_decisions "the rescued workspace is to the right, and the pair keeps its order" '
import json, sys
entries = json.load(sys.stdin)
moves = [e for e in entries if e.get("ev") == "display_move" and e.get("create") is not None]
by_id = {e.get("id"): e for e in moves}
expected = {}
for part in "'"$before"'".split():
    wid, slot = part.split(":")
    expected[int(wid)] = None if slot == "None" else int(slot)
ids = [wid for wid in expected if wid in by_id]
if len(ids) < 2:
    print("a window was not rescued", list(by_id)); sys.exit(1)
viewed = int("'"$viewed"'")
if any(m.get("workspace") != viewed + 1 for m in moves):
    print("workspace", {m.get("workspace") for m in moves}, "expected", viewed + 1); sys.exit(1)
if any(m.get("screen") != 0 for m in moves):
    print("screen", {m.get("screen") for m in moves}); sys.exit(1)
# Each rescued window keeps the slot it held on the vanished screen.
for wid in ids:
    want = expected[wid]
    if want is not None and by_id[wid].get("slot") != want:
        print("order changed", expected, [(i, by_id[i].get("slot")) for i in ids]); sys.exit(1)
print("rescued right of", viewed, "slots", expected)
' 25

adrt SimulateScreens null >/dev/null
ensure_clean
summary
