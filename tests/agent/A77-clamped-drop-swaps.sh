#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A77 A dragged window can be clamped by the client, so the drop's size differs
# from the tile it started at. That must not be read as an inner-edge resize:
# a drop that lands on the sibling is a swap (§13). Reading it as a resize used
# to skew the split ratio and leave the pair unswapped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"
wait_settled 15

read -r AX AY AW AH BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"] for w in d["windows"]}
a=by[int("'"$a"'")]; b=by[int("'"$b"'")]
print(a["x"],a["y"],a["width"],a["height"],b["x"],b["y"],b["width"],b["height"])
')"

# Drop a onto b with a *different* width, as a clamped drag produces: same row
# and height, a narrower width (< 8 px tolerance would make it a resize) and the
# centre inside the sibling.
adrt BeginDrag "$a" >/dev/null
adrt MoveWindow "$a" "$((BX - 4))" "$BY" 500 "$BH" >/dev/null
sleep 1
adrt EndDrag "$a" >/dev/null

poll "a clamped drop onto the sibling still swaps the pair" '
import json, sys
d = json.load(sys.stdin)
if not d["swapPairs"]:
    print("no swap pair recorded"); sys.exit(1)
by = {w["id"]: w["rect"]["x"] for w in d["windows"]}
a, b = int("'"$a"'"), int("'"$b"'")
if a not in by or b not in by:
    print("window gone"); sys.exit(1)
if not by[a] > by[b]:
    print("not swapped:", by); sys.exit(1)
print("swapped")
' 15

poll "and the pair is tiled again, not left overlapping" '
import json, sys
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(ws) != 2:
    print("tiles", len(ws)); sys.exit(1)
x, y = ws[0]["rect"], ws[1]["rect"]
if x["x"] < y["x"] + y["width"] - 2 and y["x"] < x["x"] + x["width"] - 2:
    print("still overlapping:", x, y); sys.exit(1)
sys.exit(0)
' 15

ensure_clean
summary
