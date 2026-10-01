#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A153 A window that cannot occupy a tile generates no drop-assist highlight
# (§6). Dragging a dialog / popup / skip-taskbar / always-on-top window across a
# tile must show no landing zone and must not swap or tile it — the drag is a
# plain move. A managed window crossing the same tile still swaps (A32/A141), so
# this scenario is the negative side of the gate, not a weakened A141.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"

# Make `b` structurally un-tileable. `above` (an always-on-top widget) is the
# same class as a dialog, a popup and a skip-taskbar utility: the model floats it
# and never tiles it, so it can never take a slot.
adrt SimulateAbove "$b" >/dev/null

if wait_python 15 '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$b"'")), None)
sys.exit(0 if w is not None and not w["tileable"] else 1)'; then
  pass "the window is un-tileable before the drag"
else
  fail "the window never became un-tileable"
fi

read -r AX AY AW AH <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
a = next(x for x in d["windows"] if x["id"] == int("'"$a"'"))
r = a["rect"]
print(r["x"], r["y"], r["width"], r["height"])
')"

# Drag the un-tileable window squarely across the tile and hold it there.
adrt BeginDrag "$b" >/dev/null
if wait_python 8 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["drag"]["dragId"] == int("'"$b"'") else 1)'; then
  pass "the drag is live on the un-tileable window"
else
  fail "the drag never armed on the un-tileable window"
fi

adrt MoveWindow "$b" "$AX" "$AY" "$AW" "$AH" >/dev/null

# Let the move reach the compositor, so the motion tick that redraws the
# drop-assist has certainly run.
if wait_python 8 '
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d["windows"] if x["id"] == int("'"$b"'")), None)
if w is None:
    sys.exit(1)
r = w["rect"]
sys.exit(0 if (abs(r["x"] - int("'"$AX"'")) <= 6 and abs(r["y"] - int("'"$AY"'")) <= 6
               and abs(r["width"] - int("'"$AW"'")) <= 6 and abs(r["height"] - int("'"$AH"'")) <= 6) else 1)'; then
  pass "the un-tileable window followed the drag onto the tile"
else
  fail "the drag never landed the un-tileable window on the tile"
fi

# Now it must not have offered a landing. Poll for the opposite — if a highlight
# appears at all while the un-tileable window sits over the tile, the gate is
# wrong. (The negative cannot be a plain `wait_python`: "not visible" is true
# before the tick runs, so it would pass vacuously — which it did, and A153 did
# not fail on the unfixed build until this was fixed.)
if wait_python 4 '
import json, sys
sys.exit(0 if json.load(sys.stdin)["indicator"]["preview"]["visible"] else 1)'; then
  fail "a landing highlight was drawn for an un-tileable window"
else
  pass "no drop-assist highlight is drawn for an un-tileable window"
fi

adrt EndDrag "$b" >/dev/null
wait_settled 10

check_python "the drop records no swap and leaves the window un-tileable" '
import json, sys
d = json.load(sys.stdin)
if d.get("swapPairs"):
    print("swap recorded:", d["swapPairs"]); sys.exit(1)
w = next((x for x in d["windows"] if x["id"] == int("'"$b"'")), None)
if w is not None and w["tileable"]:
    print("the un-tileable window became tileable"); sys.exit(1)
print("no swap; still un-tileable")
'

ensure_clean
summary
