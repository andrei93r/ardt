#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A32 Drag swap: dropping a tile past its sibling swaps the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
a="${ids[0]}"
b="${ids[1]}"

read -r AX AY AW AH BX BY BW BH <<<"$(dump | python3 -c '
import json,sys
d=json.load(sys.stdin)
area=d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
by={w["id"]:w["rect"] for w in d["windows"]}
b=by[int("'"$b"'")]
print(area["x"],area["y"],area["width"],area["height"],b["x"],b["y"],b["width"],b["height"])
')"
# Drop a on the far right, i.e. past b's centre, keeping b's size.
NX=$((AX + AW - BW))

adrt BeginDrag "$a" >/dev/null
adrt MoveWindow "$a" "$NX" "$AY" "$BW" "$BH" >/dev/null
sleep 1
adrt EndDrag "$a" >/dev/null
wait_settled 25

check_python "the pair is marked swapped" '
import json,sys
if not json.load(sys.stdin)["swapPairs"]:
    print("no swap pair recorded"); sys.exit(1)
print("swapped")
'

check_python "the dragged window is now on the right" '
import json,sys
d=json.load(sys.stdin)
by={w["id"]:w["rect"]["x"] for w in d["windows"]}
if not (by[int("'"$a"'")] > by[int("'"$b"'")]):
    print(by); sys.exit(1)
print("swapped sides")
'

ensure_clean
summary
