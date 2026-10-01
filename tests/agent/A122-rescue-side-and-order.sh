#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A122 §9 rescue side and order: a vanished screen on the physical right inserts
# its rescued workspaces to the right of the current one, and the pair keeps its
# order (the left window stays in slot 0).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

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

# The left/right order on the secondary, before the unplug.
order="$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
ws = sorted([w for w in d["windows"] if w["tileable"]], key=lambda w: w["rect"]["x"])
print(" ".join(str(w["id"]) for w in ws))
')"
echo "order on the secondary: $order"
viewed="$(state_expr 'd["activeWorkspace"]')"
fixture="$(screens_fixture 1)"
adrt SimulateScreens "$fixture" >/dev/null

poll_decisions "the rescued workspace is to the right, and the pair keeps its order" '
import json, sys
entries = json.load(sys.stdin)
moves = [e for e in entries if e.get("ev") == "display_move" and e.get("create") is not None]
by_id = {e.get("id"): e for e in moves}
order = [int(x) for x in "'"$order"'".split()]
if not all(wid in by_id for wid in order):
    print("a window was not rescued", list(by_id)); sys.exit(1)
viewed = int("'"$viewed"'")
if any(m.get("workspace") != viewed + 1 for m in moves):
    print("workspace", {m.get("workspace") for m in moves}, "expected", viewed + 1); sys.exit(1)
if any(m.get("screen") != 0 for m in moves):
    print("screen", {m.get("screen") for m in moves}); sys.exit(1)
# The left window keeps slot 0, the right one slot 1.
if by_id[order[0]].get("slot") != 0 or by_id[order[1]].get("slot") != 1:
    print("order changed", order, [(i, by_id[i].get("slot")) for i in order]); sys.exit(1)
print("rescued right of", viewed, "order", order)
' 25

adrt SimulateScreens null >/dev/null
ensure_clean
summary
