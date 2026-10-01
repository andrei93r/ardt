#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A96 A user workspace reorder is honoured exactly (§8): no correction, no
# tagging, no toast. Reaping stays a property, so a workspace left empty is
# pruned wherever it sits and GNOME's spare is never removed by adrt.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

notice_count() {
  adrt DumpDecisions 2000 2>/dev/null | python3 "$PARSE" 2>/dev/null | python3 -c '
import json, sys
entries = json.load(sys.stdin)
print(sum(1 for e in entries if e.get("event") == "notice"))' 2>/dev/null || echo 0
}

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
pair_ws="$(window_field "$A" workspace)"
wait_settled 15

# A third window takes the workspace to the right; GNOME keeps a spare after it.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
third_ws="$(window_field "$C" workspace)"
echo "pair on ws$pair_ws, third $C on ws$third_ws"
if [ "$pair_ws" = "$third_ws" ]; then
  skip "A96 needs the third window on its own workspace"
  ensure_clean
  summary
  exit 0
fi

notices_before="$(notice_count)"
# Reorder: drag the third's workspace in front of the pair's.
adrt SimulateWorkspaceReorder "$third_ws" "$pair_ws" >/dev/null
wait_settled 20

poll "the reorder is honoured: the third's workspace is now first" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
c = [w for w in d["windows"] if w["id"] == int("'"$C"'")]
if not a or not c:
    print("window gone"); sys.exit(1)
if not (c[0]["workspace"] < a[0]["workspace"]):
    print("order not honoured:", c[0]["workspace"], a[0]["workspace"]); sys.exit(1)
print("third now at", c[0]["workspace"], "pair at", a[0]["workspace"])
' 20

poll "both workspaces are still tiled after the reorder" '
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
byws = {}
for w in tiles:
    byws.setdefault(w["workspace"], []).append(w["rect"])
for ws, rects in byws.items():
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
               and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
                print("stacked on ws", ws); sys.exit(1)
sys.exit(0)
' 20

notices_after="$(notice_count)"
if [ "$notices_after" -le "$notices_before" ]; then
  pass "the reorder raised no notice ($notices_before -> $notices_after)"
else
  fail "the reorder raised a notice ($notices_before -> $notices_after)"
fi

check_python "the workspace count stayed bounded and a spare remains" '
import json, sys
d = json.load(sys.stdin)
if d["workspaces"] > 5:
    print("workspaces", d["workspaces"]); sys.exit(1)
print("workspaces", d["workspaces"])
'

# Reaping is a property: closing the reordered window empties its workspace and
# that workspace is pruned wherever it now sits, leaving the pair and a spare.
close_window "$C"
wait_count 2 20 || true
wait_settled 15
poll "the emptied workspace is pruned wherever it sits" '
import json, sys
d = json.load(sys.stdin)
if any(w["id"] == int("'"$C"'") for w in d["windows"]):
    print("the closed window is still tracked"); sys.exit(1)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
if not a:
    print("the pair is gone"); sys.exit(1)
if d["workspaces"] > 2:
    print("the emptied workspace was not pruned: workspaces", d["workspaces"]); sys.exit(1)
print("emptied workspace pruned; pair on ws", a[0]["workspace"])
' 20

ensure_clean
summary
