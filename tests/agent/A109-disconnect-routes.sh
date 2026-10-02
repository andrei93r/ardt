#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A109 §9 disconnect: a vanished screen's windows are rescued to the primary,
# grouped into as many fresh workspaces as they need, adjacent to the current
# one on the physical side the screen was on; the view never moves.
#
# The screen list is a `SimulateScreens` fixture: Mutter itself does the
# physical migration on a real unplug, while adrt's plan is what this scenario
# exercises — the decision, the workspace it creates and the remembered
# connector. The live physical hotplug is the user's acceptance run (MANUAL.md).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

# This scenario describes 2 screens; on another
# count the same rules are exercised by the matrix runs, so skip with a reason.
screens="$(screen_count)"
if [ "$screens" -ne 2 ]; then
  skip "A109-disconnect-routes: needs exactly 2 screens (this harness has $screens)"
  exit 0
fi

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A109 needs two monitors to exercise a disconnect"
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

viewed="$(state_expr 'd["activeWorkspace"]')"
vanished="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
other = [m["connector"] for m in d["monitors"] if not m["isPrimary"]]
print(other[0] if other else "")
')"
echo "viewed=$viewed vanished=$vanished"

fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null

poll_decisions "the plan rescues the pair onto a fresh workspace on the primary" '
import json, sys
entries = json.load(sys.stdin)
# Only this pair: the decision log is shared with earlier scenarios on the same
# worker (e.g. A145 leaves its own rescue moves), so filter by id.
ids = {int("'"$A"'"), int("'"$B"'")}
moves = [e for e in entries if e.get("ev") == "display_move" and e.get("create") is not None and e.get("id") in ids]
if len(moves) < 2:
    print("no rescue moves", len(moves)); sys.exit(1)
if any(m.get("screen") != 0 for m in moves):
    print("not routed to the primary", [(m.get("id"), m.get("screen")) for m in moves]); sys.exit(1)
spaces = {m.get("workspace") for m in moves}
if spaces != {int("'"$viewed"'") + 1}:
    print("workspace", spaces, "expected", int("'"$viewed"'") + 1); sys.exit(1)
slots = [m.get("slot") for m in moves]
if any(s is None for s in slots) or sorted(slots) != [0, 1]:
    print("slots", slots, "expected [0, 1]"); sys.exit(1)
print("rescued", [(m.get("id"), m.get("workspace"), m.get("slot")) for m in moves])
' 25

poll "the vanished connector is remembered and the view did not move" '
import json, sys
d = json.load(sys.stdin)
if "'"$vanished"'" not in d.get("displayMemory", []):
    print("memory", d.get("displayMemory")); sys.exit(1)
if d["activeWorkspace"] != int("'"$viewed"'"):
    print("the view moved to", d["activeWorkspace"]); sys.exit(1)
primary = [m["connector"] for m in d["monitors"] if m["isPrimary"]]
conn = primary[0] if primary else ""
placements = []
for e in d.get("registry", []):
    placements += list(e.get("placements", {}).values())
if not any(p["connector"] == conn and p["slot"] in (0, 1) for p in placements):
    print("no routed placement on", conn, placements); sys.exit(1)
print("memory", d["displayMemory"], "primary", conn)
' 25

adrt SimulateScreens null >/dev/null
ensure_clean
summary
